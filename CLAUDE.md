# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Cloudflare Worker service that generates wiki-style archival descriptions using LLM (Qwen3-32B via DeepInfra). It uses a Durable Object pattern to process batches of entities (PIs) in parallel with retry logic and callbacks to the orchestrator.

## Development Commands

```bash
# Install dependencies
npm install

# Run locally (starts Wrangler dev server)
npm run dev

# Build TypeScript (type checking only, no emit)
npm run build

# Run tests
npm test

# Deploy to Cloudflare Workers
npm run deploy
```

## Setting Secrets

The service requires a DeepInfra API key. For local development, store it in `.dev.vars`:

```bash
DEEPINFRA_API_KEY=your_key_here
```

For production deployment:

```bash
wrangler secret put DEEPINFRA_API_KEY
```

## Architecture

### Batch Processing Pattern

The service uses the AI Service DO pattern (see `SERVICE_DO_PATTERN.md` in ai-services root):

```
Orchestrator DO
      │
      │  POST /process { batch_id, chunk_id, pis[], callback_url }
      ▼
┌─────────────────────────────────────────────────────────────┐
│                  Description Service Worker                  │
│                                                              │
│  Routes:                                                     │
│  - POST /process     → Creates/triggers DescriptionBatchDO  │
│  - GET /status/:b/:c → Returns DO status                    │
│  - GET /health       → Health check                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│              DescriptionBatchDO (one per chunk)             │
│                                                              │
│  State Machine:                                              │
│  PROCESSING → PUBLISHING → CALLBACK → DONE                  │
│                                                              │
│  For each PI in parallel:                                    │
│  1. Fetch context from IPFS (pinax, cheimarros, children)   │
│  2. Generate description via LLM (with retry)               │
│  3. Upload description.md to IPFS                           │
│  4. Append version to entity                                │
│                                                              │
│  When all PIs complete:                                      │
│  - POST callback to orchestrator with results               │
│  - Cleanup DO storage                                        │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── index.ts                      # Worker entry point, routing
├── types.ts                      # TypeScript interfaces
├── durable-objects/
│   └── DescriptionBatchDO.ts     # Main DO class
├── services/
│   └── ipfs-client.ts            # IPFS wrapper API client
├── lib/
│   ├── context-fetcher.ts        # Fetches context from IPFS
│   ├── description-generator.ts  # LLM call wrapper
│   └── retry.ts                  # Exponential backoff utility
├── prompts.ts                    # System/user prompt generation
├── truncation.ts                 # Progressive tax truncation
└── llm.ts                        # DeepInfra API client
```

### Bindings

- `STAGING_BUCKET` (R2) - Staging bucket for intermediate files
- `IPFS_WRAPPER` (Service) - IPFS wrapper API for entity operations
- `DESCRIPTION_BATCH_DO` (DO) - Durable Object namespace

## API Endpoints

### POST /process - Start Batch Processing

**Request:**
```json
{
  "batch_id": "batch_01HXYZ789",
  "chunk_id": "0",
  "callback_url": "https://orchestrator.example.com/callback/batch_01HXYZ789/description",
  "r2_prefix": "staging/batch_01HXYZ789/",
  "custom_prompt": "Focus on historical significance",
  "pis": [
    { "pi": "01HXYZ789ABC", "current_tip": "bafy..." },
    { "pi": "01HXYZ789DEF", "current_tip": "bafy..." }
  ]
}
```

**Response:**
```json
{
  "status": "accepted",
  "chunk_id": "0",
  "total_pis": 2
}
```

### GET /status/:batchId/:chunkId - Check Status

**Response:**
```json
{
  "status": "processing",
  "phase": "PROCESSING",
  "progress": {
    "total": 10,
    "pending": 3,
    "processing": 2,
    "done": 4,
    "failed": 1
  }
}
```

### Callback Payload (sent to orchestrator)

```json
{
  "batch_id": "batch_01HXYZ789",
  "chunk_id": "0",
  "status": "success",
  "results": [
    {
      "pi": "01HXYZ789ABC",
      "status": "success",
      "new_tip": "bafy...",
      "new_version": 5
    },
    {
      "pi": "01HXYZ789DEF",
      "status": "error",
      "error": "LLM timeout after 3 retries"
    }
  ],
  "summary": {
    "total": 2,
    "succeeded": 1,
    "failed": 1,
    "processing_time_ms": 12500
  }
}
```

## Configuration

### Environment Variables (`wrangler.jsonc`)

**LLM Configuration:**
- `DEEPINFRA_BASE_URL`: DeepInfra API endpoint
- `MODEL_NAME`: LLM model identifier (Qwen/Qwen3-32B)
- `MAX_TOKENS`: Maximum output tokens (3072)
- `CONTEXT_WINDOW_TOKENS`: Model's input context window (131000)
- `SAFETY_MARGIN_RATIO`: Safety margin for token budget (0.7 = 70%)

**DO Configuration:**
- `MAX_RETRIES_PER_PI`: Max retries for each PI (default: 3)
- `MAX_CALLBACK_RETRIES`: Max callback retry attempts (default: 3)
- `ALARM_INTERVAL_MS`: Delay between alarm iterations (default: 100)

## Context Fetching

The DO fetches all context from IPFS (not R2 staging):

1. **Entity** - Get entity metadata and component CIDs
2. **pinax.json** - Structured metadata from PINAX phase
3. **cheimarros.json** - Knowledge graph from Cheimarros phase
4. **\*.ref.json** - Refs with OCR text (fetched via IPFS CIDs)
5. **Child descriptions** - description.md from each child entity
6. **Previous description** - For reprocessing context

## Retry Logic

- **Per-PI retries**: Exponential backoff (1s, 2s, 4s, ...) up to MAX_RETRIES_PER_PI
- **Callback retries**: Exponential backoff up to MAX_CALLBACK_RETRIES
- **Failed PIs**: Marked as error, included in callback, don't block other PIs

## Testing

Tests are configured via Vitest. Run with `npm test`.

### Manual Testing

```bash
# Start dev server
npm run dev

# Test health endpoint
curl http://localhost:8787/health

# Submit batch (requires IPFS entities to exist)
curl -X POST http://localhost:8787/process \
  -H "Content-Type: application/json" \
  -d '{
    "batch_id": "test_batch",
    "chunk_id": "0",
    "callback_url": "https://example.com/callback",
    "r2_prefix": "staging/test/",
    "pis": [{"pi": "...", "current_tip": "..."}]
  }'

# Check status
curl http://localhost:8787/status/test_batch/0
```
