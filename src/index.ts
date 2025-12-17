/**
 * description-service
 *
 * Cloudflare Worker that performs LLM-based description generation
 * for the Arke Institute photo archive.
 *
 * Endpoints:
 * - POST /process     - Batch processing via Durable Object (new)
 * - GET  /status/:batchId/:chunkId - Check DO status (new)
 * - GET  /health      - Health check
 */

import type { Env, ProcessRequest } from './types';
import { DescriptionBatchDO } from './durable-objects/DescriptionBatchDO';

// Export DO for Cloudflare Workers runtime
export { DescriptionBatchDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // POST /process - Start batch processing via DO
    if (request.method === 'POST' && url.pathname === '/process') {
      try {
        const body = (await request.json()) as ProcessRequest;

        // Validate required fields
        if (!body.batch_id || !body.chunk_id || !body.pis?.length) {
          return Response.json(
            { error: 'Missing required fields: batch_id, chunk_id, pis' },
            { status: 400, headers: corsHeaders() }
          );
        }

        // Note: callback_url is optional - service binding (ORCHESTRATOR) is preferred

        // Validate environment
        if (!env.DEEPINFRA_API_KEY) {
          return Response.json(
            { error: 'DEEPINFRA_API_KEY not configured' },
            { status: 500, headers: corsHeaders() }
          );
        }

        // Get or create DO for this batch chunk
        const doName = `description:${body.batch_id}:${body.chunk_id}`;
        const doId = env.DESCRIPTION_BATCH_DO.idFromName(doName);
        const stub = env.DESCRIPTION_BATCH_DO.get(doId);

        // Forward request to DO
        const doRequest = new Request('https://internal/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const response = await stub.fetch(doRequest);
        const result = await response.json();

        return Response.json(result, {
          status: response.status,
          headers: corsHeaders(),
        });
      } catch (error) {
        console.error('[Description] Process error:', error);
        return Response.json(
          { error: (error as Error).message },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    // GET /status/:batchId/:chunkId - Check DO status
    if (request.method === 'GET' && url.pathname.startsWith('/status/')) {
      const parts = url.pathname.split('/');
      const batchId = parts[2];
      const chunkId = parts[3];

      if (!batchId || !chunkId) {
        return Response.json(
          { error: 'Missing batchId or chunkId in path' },
          { status: 400, headers: corsHeaders() }
        );
      }

      try {
        const doName = `description:${batchId}:${chunkId}`;
        const doId = env.DESCRIPTION_BATCH_DO.idFromName(doName);
        const stub = env.DESCRIPTION_BATCH_DO.get(doId);

        const response = await stub.fetch(new Request('https://internal/status'));
        const result = await response.json();

        return Response.json(result, {
          status: response.status,
          headers: corsHeaders(),
        });
      } catch (error) {
        console.error('[Description] Status error:', error);
        return Response.json(
          { error: (error as Error).message },
          { status: 500, headers: corsHeaders() }
        );
      }
    }

    // GET /health - Health check
    if (request.method === 'GET' && url.pathname === '/health') {
      const checks: Record<string, string> = {
        service: 'ok',
        deepinfra: env.DEEPINFRA_API_KEY ? 'configured' : 'missing',
        ipfs_wrapper: env.IPFS_WRAPPER ? 'bound' : 'missing',
        staging_bucket: env.STAGING_BUCKET ? 'bound' : 'missing',
        do_namespace: env.DESCRIPTION_BATCH_DO ? 'bound' : 'missing',
      };

      const allOk = Object.values(checks).every(
        (v) => v === 'ok' || v === 'configured' || v === 'bound'
      );

      return Response.json(
        { status: allOk ? 'ok' : 'degraded', checks },
        { status: allOk ? 200 : 503, headers: corsHeaders() }
      );
    }

    // 404 for unknown routes
    return Response.json(
      {
        error: 'Not found',
        available_endpoints: [
          'POST /process',
          'GET /status/:batchId/:chunkId',
          'GET /health',
        ],
      },
      { status: 404, headers: corsHeaders() }
    );
  },
};

function corsHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
}
