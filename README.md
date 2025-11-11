# Description Service

Cloudflare Worker for LLM-based wiki-style description generation for the Arke Institute photo archive.

## Features

- **Description Generation**: Creates encyclopedia-style markdown descriptions using GPT-OSS-20B
- **Archivist Perspective**: Generates clear, factual, neutral descriptions suitable for archival materials
- **Structured Output**: Follows a consistent structure (Overview, Background, Contents, Scope)

## Endpoint

### POST /summarize

Generate a wiki-style markdown description for a directory and its contents.

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

## Description Format

The service generates descriptions in the following structure:

```markdown
# [Title]

## Overview
What this is (form, dates, scope)

## Background
Relevant context about creation/provenance

## Contents
What's in it, key subjects and details

## Scope
Coverage (dates, geography, topics, what's included/excluded)
```

Descriptions are:
- 200-350 words
- Encyclopedia/library catalog style
- Objective and factual
- Based on provided source materials

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy

# Set API key
wrangler secret put DEEPINFRA_API_KEY
```

## Configuration

Environment variables are set in `wrangler.jsonc`:
- `DEEPINFRA_BASE_URL`: DeepInfra API endpoint
- `MODEL_NAME`: openai/gpt-oss-20b
- `MAX_TOKENS`: 3072
- `DEEPINFRA_API_KEY`: Set as secret via wrangler CLI
