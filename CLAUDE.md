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
4. `llm.ts` calls the DeepInfra API and processes the response
5. Response flows back with the generated markdown description

**LLM Integration (`src/llm.ts`)**
- Calls DeepInfra's OpenAI-compatible API
- Uses `openai/gpt-oss-20b` model with temperature 0.3
- Calculates costs: $0.03/M input tokens, $0.14/M output tokens
- Extracts title and summary from generated markdown

**Prompt Engineering (`src/prompts.ts`)**
- Files are truncated to 800 characters each to manage token usage
- System prompt defines the "archivist" role and output structure
- User prompt includes directory name and formatted file contents
- Target output: 200-350 words with 4 sections (Overview, Background, Contents, Scope)

**Configuration (`wrangler.jsonc`)**
- Deployed to: `description.arke.institute`
- Environment variables: DEEPINFRA_BASE_URL, MODEL_NAME, MAX_TOKENS (3072)
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
