/**
 * Description Batch Durable Object
 *
 * Processes a batch of PIs in parallel:
 * 1. Fetch context from IPFS for each PI
 * 2. Generate descriptions using LLM (with retry)
 * 3. Upload descriptions to IPFS
 * 4. Update entities with new versions
 * 5. Callback to orchestrator with results
 */

import { DurableObject } from 'cloudflare:workers';
import {
  Env,
  ProcessRequest,
  BatchState,
  PIState,
  Phase,
  CallbackPayload,
} from '../types';
import { IPFSClient } from '../services/ipfs-client';
import { fetchDescriptionContext } from '../lib/context-fetcher';
import { generateDescription } from '../lib/description-generator';

export class DescriptionBatchDO extends DurableObject<Env> {
  private state: BatchState | null = null;
  private ipfsClient: IPFSClient;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ipfsClient = new IPFSClient(env.IPFS_WRAPPER);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/process') {
      return this.handleProcess(request);
    }

    if (url.pathname === '/status') {
      return this.handleStatus();
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  /**
   * Handle POST /process - Start batch processing
   */
  private async handleProcess(request: Request): Promise<Response> {
    const body = (await request.json()) as ProcessRequest;

    // Check if already processing
    await this.loadState();
    if (this.state && this.state.phase !== 'DONE' && this.state.phase !== 'ERROR') {
      return Response.json({
        status: 'already_processing',
        chunk_id: this.state.chunk_id,
        phase: this.state.phase,
      });
    }

    const chunkId = `${body.batch_id}:${body.chunk_id}`;
    console.log(`[Description:${chunkId}] Starting batch with ${body.pis.length} PIs`);

    // Initialize state
    this.state = {
      batch_id: body.batch_id,
      chunk_id: body.chunk_id,
      callback_url: body.callback_url,
      r2_prefix: body.r2_prefix,
      custom_prompt: body.custom_prompt,
      phase: 'PROCESSING',
      started_at: new Date().toISOString(),
      pis: body.pis.map((p) => ({
        pi: p.pi,
        current_tip: p.current_tip,
        status: 'pending' as const,
        retry_count: 0,
      })),
      callback_retry_count: 0,
    };

    await this.saveState();

    // Schedule immediate processing
    await this.ctx.storage.setAlarm(Date.now() + 100);

    return Response.json({
      status: 'accepted',
      chunk_id: body.chunk_id,
      total_pis: body.pis.length,
    });
  }

  /**
   * Handle GET /status - Return current status
   * Note: Only load from storage if state is null to avoid clobbering
   * in-memory state during async processing
   */
  private async handleStatus(): Promise<Response> {
    if (!this.state) {
      await this.loadState();
    }

    if (!this.state) {
      return Response.json({ status: 'not_found' });
    }

    const pending = this.state.pis.filter((p) => p.status === 'pending').length;
    const processing = this.state.pis.filter((p) => p.status === 'processing').length;
    const done = this.state.pis.filter((p) => p.status === 'done').length;
    const failed = this.state.pis.filter((p) => p.status === 'error').length;

    return Response.json({
      status: this.state.phase.toLowerCase(),
      phase: this.state.phase,
      progress: {
        total: this.state.pis.length,
        pending,
        processing,
        done,
        failed,
      },
    });
  }

  /**
   * Alarm handler - Process state machine
   */
  async alarm(): Promise<void> {
    await this.loadState();
    if (!this.state) return;

    const chunkId = `${this.state.batch_id}:${this.state.chunk_id}`;

    try {
      switch (this.state.phase) {
        case 'PROCESSING':
          await this.processPhase();
          break;
        case 'PUBLISHING':
          await this.publishPhase();
          break;
        case 'CALLBACK':
          await this.callbackPhase();
          break;
        case 'DONE':
        case 'ERROR':
          await this.cleanup();
          break;
      }
    } catch (error) {
      console.error(`[Description:${chunkId}] Alarm error:`, error);
      this.state.phase = 'ERROR';
      this.state.global_error = (error as Error).message;
      await this.saveState();
      // Move to callback to report error
      this.state.phase = 'CALLBACK';
      await this.saveState();
      await this.scheduleNextAlarm();
    }
  }

  /**
   * PROCESSING phase: Fetch context and generate descriptions for all PIs
   */
  private async processPhase(): Promise<void> {
    const chunkId = `${this.state!.batch_id}:${this.state!.chunk_id}`;
    const maxRetries = parseInt(this.env.MAX_RETRIES_PER_PI || '3');

    // Get pending PIs
    const pending = this.state!.pis.filter((p) => p.status === 'pending');

    if (pending.length === 0) {
      // All done processing, move to publishing
      console.log(`[Description:${chunkId}] Processing complete, moving to PUBLISHING`);
      this.state!.phase = 'PUBLISHING';
      await this.saveState();
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Description:${chunkId}] Processing ${pending.length} PIs in parallel`);

    // Mark all as processing
    for (const pi of pending) {
      pi.status = 'processing';
    }
    await this.saveState();

    // Process all in parallel
    const results = await Promise.allSettled(
      pending.map((pi) => this.processPI(pi))
    );

    // Update states based on results
    for (let i = 0; i < pending.length; i++) {
      const pi = pending[i];
      const result = results[i];

      if (result.status === 'fulfilled') {
        pi.status = 'done';
        pi.description = result.value.description;
        console.log(`[Description:${chunkId}] ✓ ${pi.pi}`);
      } else {
        pi.retry_count++;
        const errorMsg = result.reason?.message || 'Unknown error';

        if (pi.retry_count >= maxRetries) {
          pi.status = 'error';
          pi.error = errorMsg;
          console.error(
            `[Description:${chunkId}] ✗ ${pi.pi} (max retries ${maxRetries}): ${errorMsg}`
          );
        } else {
          pi.status = 'pending'; // Will retry on next alarm
          console.warn(
            `[Description:${chunkId}] ⟳ ${pi.pi} retry ${pi.retry_count}/${maxRetries}: ${errorMsg}`
          );
        }
      }
    }

    await this.saveState();
    await this.scheduleNextAlarm();
  }

  /**
   * Process a single PI: fetch context and generate description
   */
  private async processPI(pi: PIState): Promise<{ description: string }> {
    // Fetch context if not cached
    if (!pi.context) {
      pi.context = await fetchDescriptionContext(pi.pi, this.ipfsClient);
    }

    // Generate description
    const description = await generateDescription(
      pi.context,
      this.state!.custom_prompt,
      this.env
    );

    console.log(`[Description] Generated description for ${pi.pi}: ${description.length} chars`);
    return { description };
  }

  /**
   * PUBLISHING phase: Upload descriptions to IPFS and update entities
   */
  private async publishPhase(): Promise<void> {
    const chunkId = `${this.state!.batch_id}:${this.state!.chunk_id}`;

    // Get PIs that have descriptions but haven't been published yet
    const toPublish = this.state!.pis.filter(
      (p) => p.status === 'done' && p.description && !p.description_cid
    );

    if (toPublish.length === 0) {
      // All published, move to callback
      console.log(`[Description:${chunkId}] Publishing complete, moving to CALLBACK`);
      this.state!.phase = 'CALLBACK';
      await this.saveState();
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Description:${chunkId}] Publishing ${toPublish.length} descriptions`);

    // Publish in parallel
    const results = await Promise.allSettled(
      toPublish.map((pi) => this.publishPI(pi))
    );

    // Update states
    for (let i = 0; i < toPublish.length; i++) {
      const pi = toPublish[i];
      const result = results[i];

      if (result.status === 'fulfilled') {
        pi.description_cid = result.value.cid;
        pi.new_tip = result.value.tip;
        pi.new_version = result.value.ver;
        console.log(`[Description:${chunkId}] ✓ Published ${pi.pi} v${pi.new_version}`);
      } else {
        // Publishing failed - mark as error
        pi.status = 'error';
        pi.error = `Publish failed: ${result.reason?.message}`;
        console.error(`[Description:${chunkId}] ✗ Publish ${pi.pi}: ${pi.error}`);
      }
    }

    await this.saveState();
    await this.scheduleNextAlarm();
  }

  /**
   * Publish a single PI's description to IPFS
   *
   * Uses CAS retry pattern: fetch fresh tip before each attempt.
   * This handles cases where the entity tip changed after orchestrator sent the request
   * (e.g., parent-child relationship establishment updates child tips).
   */
  private async publishPI(
    pi: PIState
  ): Promise<{ cid: string; tip: string; ver: number }> {
    // Upload description to IPFS (only once, CID is deterministic)
    const cid = await this.ipfsClient.uploadContent(pi.description!, 'description.md');

    // Append version with CAS retry - fetch fresh tip on each attempt
    const maxRetries = 5;
    const baseDelay = 100;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Fetch fresh tip before each attempt (critical for CAS success)
        const entity = await this.ipfsClient.getEntity(pi.pi);
        const freshTip = entity.tip;

        const result = await this.ipfsClient.appendVersion(
          pi.pi,
          freshTip,
          { 'description.md': cid },
          'Added description'
        );

        return { cid, tip: result.tip, ver: result.ver };
      } catch (error: any) {
        const isCASFailure =
          error.message?.includes('409') ||
          error.message?.includes('CAS') ||
          error.message?.includes('expected tip');

        if (isCASFailure && attempt < maxRetries - 1) {
          // Exponential backoff with jitter
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 50;
          console.log(
            `[Description] CAS conflict for ${pi.pi}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Non-CAS error or final attempt
        throw error;
      }
    }

    throw new Error(`Failed to publish ${pi.pi} after ${maxRetries} attempts`);
  }

  /**
   * CALLBACK phase: Send results to orchestrator
   */
  private async callbackPhase(): Promise<void> {
    const chunkId = `${this.state!.batch_id}:${this.state!.chunk_id}`;
    const maxRetries = parseInt(this.env.MAX_CALLBACK_RETRIES || '3');

    // Build callback payload
    const succeeded = this.state!.pis.filter(
      (p) => p.status === 'done' && p.new_tip
    );
    const failed = this.state!.pis.filter((p) => p.status === 'error');

    const payload: CallbackPayload = {
      batch_id: this.state!.batch_id,
      chunk_id: this.state!.chunk_id,
      status:
        failed.length === 0
          ? 'success'
          : succeeded.length === 0
            ? 'error'
            : 'partial',
      results: this.state!.pis.map((pi) => ({
        pi: pi.pi,
        status: pi.status === 'done' && pi.new_tip ? 'success' : 'error',
        new_tip: pi.new_tip,
        new_version: pi.new_version,
        error: pi.error,
      })),
      summary: {
        total: this.state!.pis.length,
        succeeded: succeeded.length,
        failed: failed.length,
        processing_time_ms:
          Date.now() - new Date(this.state!.started_at).getTime(),
      },
      error: this.state!.global_error,
    };

    try {
      // Use service binding to call orchestrator
      const callbackPath = `/callback/description/${this.state!.batch_id}`;
      console.log(
        `[Description:${chunkId}] Sending callback via service binding to ${callbackPath}`
      );

      const resp = await this.env.ORCHESTRATOR.fetch(
        `https://orchestrator${callbackPath}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!resp.ok) {
        throw new Error(`Callback failed: ${resp.status} ${await resp.text()}`);
      }

      console.log(
        `[Description:${chunkId}] Callback sent: ${succeeded.length} succeeded, ${failed.length} failed`
      );
      this.state!.phase = 'DONE';
      this.state!.completed_at = new Date().toISOString();
      await this.saveState();
      await this.scheduleNextAlarm(); // Will trigger cleanup
    } catch (error) {
      this.state!.callback_retry_count++;

      if (this.state!.callback_retry_count >= maxRetries) {
        console.error(
          `[Description:${chunkId}] Callback failed after ${maxRetries} retries, giving up`
        );
        this.state!.phase = 'DONE'; // Mark done anyway, log the failure
        this.state!.completed_at = new Date().toISOString();
        await this.saveState();
        await this.scheduleNextAlarm();
      } else {
        console.warn(
          `[Description:${chunkId}] Callback failed (attempt ${this.state!.callback_retry_count}/${maxRetries}), will retry: ${(error as Error).message}`
        );
        await this.saveState();
        // Retry with backoff
        const delay = 1000 * Math.pow(2, this.state!.callback_retry_count);
        await this.ctx.storage.setAlarm(Date.now() + delay);
      }
    }
  }

  /**
   * Cleanup: Clear DO storage after completion
   */
  private async cleanup(): Promise<void> {
    const chunkId = this.state
      ? `${this.state.batch_id}:${this.state.chunk_id}`
      : 'unknown';
    console.log(`[Description:${chunkId}] Cleaning up DO storage`);
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  /**
   * Load state from DO storage
   */
  private async loadState(): Promise<void> {
    this.state = (await this.ctx.storage.get<BatchState>('state')) || null;
  }

  /**
   * Save state to DO storage
   */
  private async saveState(): Promise<void> {
    if (this.state) {
      await this.ctx.storage.put('state', this.state);
    }
  }

  /**
   * Schedule next alarm
   */
  private async scheduleNextAlarm(): Promise<void> {
    const delay = parseInt(this.env.ALARM_INTERVAL_MS || '100');
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }
}
