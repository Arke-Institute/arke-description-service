/**
 * description-service
 *
 * Cloudflare Worker that performs LLM-based description generation
 * for the Arke Institute photo archive.
 */

import type { Env, SummarizeRequest } from './types';
import { generateDescription } from './summarizer';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed. Use POST.' }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Route handling
    const url = new URL(request.url);

    // Main /summarize endpoint
    if (url.pathname !== '/summarize') {
      return new Response(
        JSON.stringify({
          error: `Not found. Available endpoint: POST /summarize`
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    try {
      // Parse request body
      let body: SummarizeRequest;
      try {
        body = await request.json() as SummarizeRequest;
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON in request body' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      }

      // Validate environment variables
      if (!env.DEEPINFRA_API_KEY) {
        throw new Error('DEEPINFRA_API_KEY not configured');
      }
      if (!env.DEEPINFRA_BASE_URL) {
        throw new Error('DEEPINFRA_BASE_URL not configured');
      }
      if (!env.MODEL_NAME) {
        throw new Error('MODEL_NAME not configured');
      }

      // Generate description
      const result = await generateDescription(body, env);

      // Return success response
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (error) {
      // Log error for debugging
      console.error('Error processing request:', error);

      // Return error response
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return new Response(
        JSON.stringify({
          error: errorMessage,
          timestamp: new Date().toISOString()
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }
};
