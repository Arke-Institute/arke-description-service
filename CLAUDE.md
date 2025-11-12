# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Cloudflare Worker service that generates wiki-style archival descriptions using LLM (GPT-OSS-20B via DeepInfra). It receives directory information and text file contents, then produces structured markdown descriptions suitable for the Arke Institute photo archive.

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

This is a simple, focused service with clear separation of concerns:

**Entry Point (`src/index.ts`)**
- Single HTTP endpoint: `POST /summarize`
- Request validation and CORS handling
- Environment variable validation (DEEPINFRA_API_KEY, DEEPINFRA_BASE_URL, MODEL_NAME)
- Routes requests to the summarizer module

**Request Flow**
1. `index.ts` validates the request and environment
2. `summarizer.ts` orchestrates the description generation
3. `prompts.ts` generates system and user prompts from the request data
4. `truncation.ts` applies progressive tax algorithm to fit files within token budget
5. `llm.ts` calls the DeepInfra API and processes the response
6. Response flows back with the generated markdown description

**LLM Integration (`src/llm.ts`)**
- Calls DeepInfra's OpenAI-compatible API
- Uses `openai/gpt-oss-20b` model with temperature 0.3
- Calculates costs: $0.03/M input tokens, $0.14/M output tokens
- Extracts title and summary from generated markdown

**Prompt Engineering (`src/prompts.ts`)**
- System prompt defines the "archivist" role and output structure
- User prompt includes directory name and formatted file contents
- Target output: 200-350 words with 4 sections (Overview, Background, Contents, Scope)
- Uses progressive tax truncation algorithm to intelligently manage file sizes within token limits

**Token Management (`src/truncation.ts`)**
- Implements a "progressive tax" truncation algorithm (see PROGRESSIVE-TAX-ALGORITHM.md)
- Protects small files from truncation when possible
- Distributes truncation burden proportionally among large files
- Token budget calculation: `(CONTEXT_WINDOW - system_prompt - user_template - output) × SAFETY_MARGIN`
- Default context window: 131,000 tokens
- Default safety margin: 70% (prevents edge cases near token limits)
- Ensures all requests fit within model's context window without API errors

**Configuration (`wrangler.jsonc`)**
- Deployed to: `description.arke.institute`
- Environment variables:
  - `DEEPINFRA_BASE_URL`: DeepInfra API endpoint
  - `MODEL_NAME`: LLM model identifier (openai/gpt-oss-20b)
  - `MAX_TOKENS`: Maximum output tokens (3072)
  - `CONTEXT_WINDOW_TOKENS`: Model's input context window (131000)
  - `SAFETY_MARGIN_RATIO`: Safety margin for token budget (0.7 = 70%)
- Observability enabled for monitoring

## Request/Response Schema

**Request:**
```json
{
  "directory_name": "string",
  "files": [
    {
      "name": "string",
      "content": "string"
    }
  ]
}
```

**Response:**
```json
{
  "description": "# Title\n\n## Overview\n...\n\n## Background\n...\n\n## Contents\n...\n\n## Scope\n..."
}
```

## TypeScript Configuration

- Target: ES2022 with ESM modules
- Uses bundler module resolution for Cloudflare Workers
- Strict mode enabled
- No file emission (handled by Wrangler)
- Cloudflare Workers types included

## Testing

Tests are configured via Vitest. Run with `npm test`.
