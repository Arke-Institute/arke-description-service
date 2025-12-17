/**
 * Description Batch Durable Object - SQLite-backed for 10GB storage (vs 128KB KV limit)
 *
 * Processes a batch of PIs in parallel:
 * 1. Fetch context from IPFS for each PI
 * 2. Generate descriptions using LLM (with retry)
 * 3. Upload descriptions to IPFS
 * 4. Update entities with new versions
 * 5. Callback to orchestrator with results
 *
 * Uses SQLite storage to handle large context data that exceeded KV limits.
 */

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  ProcessRequest,
  Phase,
  CallbackPayload,
  DescriptionContext,
} from '../types';
import { IPFSClient } from '../services/ipfs-client';
import { fetchDescriptionContext } from '../lib/context-fetcher';
import { generateDescription } from '../lib/description-generator';

export class DescriptionBatchDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private ipfsClient: IPFSClient;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ipfsClient = new IPFSClient(env.IPFS_WRAPPER);
  }

  /**
   * Initialize SQL tables if needed
   */
  private initTables(): void {
    if (this.initialized) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS batch_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        batch_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        custom_prompt TEXT,
        phase TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        callback_retry_count INTEGER DEFAULT 0,
        global_error TEXT
      );

      CREATE TABLE IF NOT EXISTS pi_list (
        pi TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS pi_state (
        pi TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        description TEXT,
        description_cid TEXT,
        new_tip TEXT,
        new_version INTEGER,
        error TEXT
      );

      -- Store context files separately (can be large)
      CREATE TABLE IF NOT EXISTS pi_context_files (
        pi TEXT NOT NULL,
        idx INTEGER NOT NULL,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY (pi, idx)
      );

      CREATE TABLE IF NOT EXISTS pi_context_meta (
        pi TEXT PRIMARY KEY,
        directory_name TEXT NOT NULL
      );
    `);

    this.initialized = true;
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
    this.initTables();
    const body = (await request.json()) as ProcessRequest;

    // Check if already processing
    const existingRows = [...this.sql.exec('SELECT phase FROM batch_state WHERE id = 1')];
    if (existingRows.length > 0) {
      const phase = existingRows[0].phase as Phase;
      if (phase !== 'DONE' && phase !== 'ERROR') {
        return Response.json({
          status: 'already_processing',
          chunk_id: body.chunk_id,
          phase,
        });
      }
      // Clear old state for reprocessing
      this.clearAllTables();
    }

    if (!body.pis || body.pis.length === 0) {
      return Response.json({ error: 'Missing pis array' }, { status: 400 });
    }

    const chunkId = `${body.batch_id}:${body.chunk_id}`;
    console.log(`[Description:${chunkId}] Starting batch with ${body.pis.length} PIs`);

    // Initialize batch state
    this.sql.exec(
      `INSERT INTO batch_state (id, batch_id, chunk_id, custom_prompt, phase, started_at, callback_retry_count)
       VALUES (1, ?, ?, ?, 'PROCESSING', ?, 0)`,
      body.batch_id,
      body.chunk_id,
      body.custom_prompt || null,
      new Date().toISOString()
    );

    // Initialize PI list and states
    for (const pi of body.pis) {
      this.sql.exec('INSERT INTO pi_list (pi) VALUES (?)', pi);
      this.sql.exec(
        'INSERT INTO pi_state (pi, status, retry_count) VALUES (?, ?, 0)',
        pi,
        'pending'
      );
    }

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
   */
  private async handleStatus(): Promise<Response> {
    this.initTables();

    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    if (stateRows.length === 0) {
      return Response.json({ status: 'not_found' });
    }
    const state = stateRows[0];

    // Count statuses
    const countRows = [...this.sql.exec(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total
      FROM pi_state
    `)];
    const counts = countRows[0];

    return Response.json({
      status: (state.phase as string).toLowerCase(),
      phase: state.phase,
      progress: {
        total: counts?.total || 0,
        pending: counts?.pending || 0,
        processing: counts?.processing || 0,
        done: counts?.done || 0,
        failed: counts?.failed || 0,
      },
    });
  }

  /**
   * Alarm handler - Process state machine
   */
  async alarm(): Promise<void> {
    this.initTables();

    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    if (stateRows.length === 0) return;
    const state = stateRows[0];

    const chunkId = `${state.batch_id}:${state.chunk_id}`;

    try {
      switch (state.phase as Phase) {
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
      this.sql.exec(
        "UPDATE batch_state SET phase = 'CALLBACK', global_error = ? WHERE id = 1",
        (error as Error).message
      );
      await this.scheduleNextAlarm();
    }
  }

  /**
   * PROCESSING phase: Fetch context and generate descriptions for all PIs
   */
  private async processPhase(): Promise<void> {
    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    const state = stateRows[0];
    const chunkId = `${state.batch_id}:${state.chunk_id}`;
    const maxRetries = parseInt(this.env.MAX_RETRIES_PER_PI || '3');

    // Get pending PIs
    const pendingRows = [...this.sql.exec(
      "SELECT pi FROM pi_state WHERE status IN ('pending', 'processing')"
    )];

    if (pendingRows.length === 0) {
      // All done processing, move to publishing
      console.log(`[Description:${chunkId}] Processing complete, moving to PUBLISHING`);
      this.sql.exec("UPDATE batch_state SET phase = 'PUBLISHING' WHERE id = 1");
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Description:${chunkId}] Processing ${pendingRows.length} PIs in parallel`);

    // Mark all as processing
    for (const row of pendingRows) {
      this.sql.exec("UPDATE pi_state SET status = 'processing' WHERE pi = ?", row.pi);
    }

    // Process all in parallel
    const results = await Promise.allSettled(
      pendingRows.map((row) => this.processPI(row.pi as string, state))
    );

    // Update states based on results
    for (let i = 0; i < pendingRows.length; i++) {
      const pi = pendingRows[i].pi as string;
      const result = results[i];

      if (result.status === 'fulfilled') {
        // Store description
        this.sql.exec(
          "UPDATE pi_state SET status = 'done', description = ? WHERE pi = ?",
          result.value.description,
          pi
        );
        // Clear context to save space
        this.sql.exec('DELETE FROM pi_context_files WHERE pi = ?', pi);
        this.sql.exec('DELETE FROM pi_context_meta WHERE pi = ?', pi);
        console.log(`[Description:${chunkId}] ✓ ${pi.slice(-8)}`);
      } else {
        const errorMsg = result.reason?.message || 'Unknown error';
        const retryRows = [...this.sql.exec('SELECT retry_count FROM pi_state WHERE pi = ?', pi)];
        const currentRetry = (retryRows[0]?.retry_count as number) || 0;
        const newRetry = currentRetry + 1;

        if (newRetry >= maxRetries) {
          this.sql.exec(
            "UPDATE pi_state SET status = 'error', retry_count = ?, error = ? WHERE pi = ?",
            newRetry,
            errorMsg,
            pi
          );
          // Clear context on error too
          this.sql.exec('DELETE FROM pi_context_files WHERE pi = ?', pi);
          this.sql.exec('DELETE FROM pi_context_meta WHERE pi = ?', pi);
          console.error(`[Description:${chunkId}] ✗ ${pi.slice(-8)} (max retries): ${errorMsg}`);
        } else {
          this.sql.exec(
            "UPDATE pi_state SET status = 'pending', retry_count = ? WHERE pi = ?",
            newRetry,
            pi
          );
          console.warn(`[Description:${chunkId}] ⟳ ${pi.slice(-8)} retry ${newRetry}/${maxRetries}`);
        }
      }
    }

    await this.scheduleNextAlarm();
  }

  /**
   * Process a single PI: fetch context and generate description
   */
  private async processPI(
    pi: string,
    state: Record<string, SqlStorageValue>
  ): Promise<{ description: string }> {
    // Check if context is cached
    let context: DescriptionContext;
    const metaRows = [...this.sql.exec('SELECT directory_name FROM pi_context_meta WHERE pi = ?', pi)];

    if (metaRows.length > 0) {
      // Load cached context
      const fileRows = [...this.sql.exec(
        'SELECT filename, content FROM pi_context_files WHERE pi = ? ORDER BY idx',
        pi
      )];
      context = {
        directory_name: metaRows[0].directory_name as string,
        files: fileRows.map((r) => ({
          filename: r.filename as string,
          content: r.content as string,
        })),
      };
    } else {
      // Fetch context from IPFS
      context = await fetchDescriptionContext(pi, this.ipfsClient);

      // Cache it for potential retries
      this.sql.exec(
        'INSERT OR REPLACE INTO pi_context_meta (pi, directory_name) VALUES (?, ?)',
        pi,
        context.directory_name
      );
      for (let i = 0; i < context.files.length; i++) {
        this.sql.exec(
          'INSERT INTO pi_context_files (pi, idx, filename, content) VALUES (?, ?, ?, ?)',
          pi,
          i,
          context.files[i].filename,
          context.files[i].content
        );
      }
    }

    // Generate description
    const description = await generateDescription(
      context,
      state.custom_prompt as string | undefined,
      this.env
    );

    console.log(`[Description] Generated for ${pi.slice(-8)}: ${description.length} chars`);
    return { description };
  }

  /**
   * PUBLISHING phase: Upload descriptions to IPFS and update entities
   */
  private async publishPhase(): Promise<void> {
    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    const state = stateRows[0];
    const chunkId = `${state.batch_id}:${state.chunk_id}`;

    // Get PIs that have descriptions but haven't been published yet
    const toPublish = [...this.sql.exec(`
      SELECT pi, description FROM pi_state
      WHERE status = 'done' AND description IS NOT NULL AND description_cid IS NULL
    `)];

    if (toPublish.length === 0) {
      // All published, move to callback
      console.log(`[Description:${chunkId}] Publishing complete, moving to CALLBACK`);
      this.sql.exec("UPDATE batch_state SET phase = 'CALLBACK' WHERE id = 1");
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Description:${chunkId}] Publishing ${toPublish.length} descriptions`);

    // Publish in parallel
    const results = await Promise.allSettled(
      toPublish.map((row) => this.publishPI(row.pi as string, row.description as string))
    );

    // Update states
    for (let i = 0; i < toPublish.length; i++) {
      const pi = toPublish[i].pi as string;
      const result = results[i];

      if (result.status === 'fulfilled') {
        this.sql.exec(
          'UPDATE pi_state SET description_cid = ?, new_tip = ?, new_version = ? WHERE pi = ?',
          result.value.cid,
          result.value.tip,
          result.value.ver,
          pi
        );
        console.log(`[Description:${chunkId}] ✓ Published ${pi.slice(-8)} v${result.value.ver}`);
      } else {
        // Publishing failed - mark as error
        this.sql.exec(
          "UPDATE pi_state SET status = 'error', error = ? WHERE pi = ?",
          `Publish failed: ${result.reason?.message}`,
          pi
        );
        console.error(`[Description:${chunkId}] ✗ Publish ${pi.slice(-8)}: ${result.reason?.message}`);
      }
    }

    await this.scheduleNextAlarm();
  }

  /**
   * Publish a single PI's description to IPFS
   */
  private async publishPI(
    pi: string,
    description: string
  ): Promise<{ cid: string; tip: string; ver: number }> {
    // Upload description to IPFS
    const cid = await this.ipfsClient.uploadContent(description, 'description.md');

    // Append version with CAS retry
    const maxRetries = 5;
    const baseDelay = 100;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Fetch fresh tip before each attempt
        const entity = await this.ipfsClient.getEntity(pi);
        const freshTip = entity.tip;

        const result = await this.ipfsClient.appendVersion(
          pi,
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
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 50;
          console.log(`[Description] CAS conflict for ${pi.slice(-8)}, retry in ${Math.round(delay)}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Failed to publish ${pi} after ${maxRetries} attempts`);
  }

  /**
   * CALLBACK phase: Send results to orchestrator
   */
  private async callbackPhase(): Promise<void> {
    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    const state = stateRows[0];
    const chunkId = `${state.batch_id}:${state.chunk_id}`;
    const maxRetries = parseInt(this.env.MAX_CALLBACK_RETRIES || '3');

    // Get all PI states
    const piStates = [...this.sql.exec('SELECT * FROM pi_state')];

    const succeeded = piStates.filter((p) => p.status === 'done' && p.new_tip);
    const failed = piStates.filter((p) => p.status === 'error');

    const payload: CallbackPayload = {
      batch_id: state.batch_id as string,
      chunk_id: state.chunk_id as string,
      status: failed.length === 0 ? 'success' : succeeded.length === 0 ? 'error' : 'partial',
      results: piStates.map((p) => ({
        pi: p.pi as string,
        status: (p.status === 'done' && p.new_tip ? 'success' : 'error') as 'success' | 'error',
        new_tip: p.new_tip as string | undefined,
        new_version: p.new_version as number | undefined,
        error: p.error as string | undefined,
      })),
      summary: {
        total: piStates.length,
        succeeded: succeeded.length,
        failed: failed.length,
        processing_time_ms: Date.now() - new Date(state.started_at as string).getTime(),
      },
      error: state.global_error as string | undefined,
    };

    try {
      const callbackPath = `/callback/description/${state.batch_id}`;
      console.log(`[Description:${chunkId}] Sending callback via service binding`);

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

      console.log(`[Description:${chunkId}] Callback sent: ${succeeded.length} succeeded, ${failed.length} failed`);
      this.sql.exec(
        "UPDATE batch_state SET phase = 'DONE', completed_at = ? WHERE id = 1",
        new Date().toISOString()
      );
      await this.scheduleNextAlarm(); // Will trigger cleanup
    } catch (error) {
      const retryCount = ((state.callback_retry_count as number) || 0) + 1;

      if (retryCount >= maxRetries) {
        console.error(`[Description:${chunkId}] Callback failed after ${maxRetries} retries`);
        this.sql.exec(
          "UPDATE batch_state SET phase = 'DONE', completed_at = ?, callback_retry_count = ? WHERE id = 1",
          new Date().toISOString(),
          retryCount
        );
        await this.scheduleNextAlarm();
      } else {
        console.warn(`[Description:${chunkId}] Callback failed, will retry`);
        this.sql.exec('UPDATE batch_state SET callback_retry_count = ? WHERE id = 1', retryCount);
        const delay = 1000 * Math.pow(2, retryCount);
        await this.ctx.storage.setAlarm(Date.now() + delay);
      }
    }
  }

  /**
   * Clear all tables
   */
  private clearAllTables(): void {
    this.sql.exec('DELETE FROM batch_state');
    this.sql.exec('DELETE FROM pi_list');
    this.sql.exec('DELETE FROM pi_state');
    this.sql.exec('DELETE FROM pi_context_files');
    this.sql.exec('DELETE FROM pi_context_meta');
  }

  /**
   * Cleanup: Clear DO storage after completion
   */
  private async cleanup(): Promise<void> {
    const stateRows = [...this.sql.exec('SELECT batch_id, chunk_id FROM batch_state WHERE id = 1')];
    const chunkId = stateRows.length > 0
      ? `${stateRows[0].batch_id}:${stateRows[0].chunk_id}`
      : 'unknown';
    console.log(`[Description:${chunkId}] Cleaning up DO storage`);
    this.clearAllTables();
  }

  /**
   * Schedule next alarm
   */
  private async scheduleNextAlarm(): Promise<void> {
    const delay = parseInt(this.env.ALARM_INTERVAL_MS || '100');
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }
}
