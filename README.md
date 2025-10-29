# arke-description-service

Cloudflare Worker that performs bottom-up LLM-based summarization of directory hierarchies for the Arke Institute photo archive.

## Overview

This service receives aggregated information about a directory (OCR text from images, descriptions from subdirectories, manual metadata) and generates:
- A markdown description summarizing the directory's contents
- Structured metadata (dates, locations, people, events, etc.)
- Token usage and cost tracking

## Architecture

- **Runtime**: Cloudflare Workers (edge compute)
- **LLM Provider**: DeepInfra (OpenAI-compatible API)
- **Model**: `openai/gpt-oss-20b`
- **Integration**: Called via Cloudflare Service Bindings from orchestrator

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Secrets

Set your DeepInfra API key as a Cloudflare secret:

```bash
npx wrangler secret put DEEPINFRA_API_KEY
```

When prompted, paste your API key.

### 3. Local Development

Run the worker locally:

```bash
npm run dev
```

This starts a local server at `http://localhost:8787`

### 4. Deploy to Cloudflare

```bash
npm run deploy
```

## Usage

### API Endpoint

**POST /summarize**

### Request Format

```json
{
  "directory_name": "Summer_1985",
  "manual_metadata": {
    "year": 1985,
    "season": "summer"
  },
  "children_ocr": [
    {
      "name": "IMG_001.jpg",
      "text": "Beach vacation, Santa Monica..."
    },
    {
      "name": "IMG_002.jpg",
      "text": "Family picnic at the park..."
    }
  ],
  "children_descriptions": [
    {
      "name": "Week_1",
      "description": "# First Week of Summer\n\nFamily activities...",
      "metadata": {
        "dates": ["1985-06-01", "1985-06-07"],
        "location": "California"
      }
    }
  ]
}
```

### Response Format

```json
{
  "description": "# Summer 1985\n\nA collection of family photos...",
  "metadata": {
    "year": 1985,
    "season": "summer",
    "dates": ["1985-06-01", "1985-08-31"],
    "locations": ["Santa Monica", "California"],
    "themes": ["family", "vacation", "beach"]
  },
  "cost_usd": 0.00142,
  "tokens": 856
}
```

## Integration with Orchestrator

The orchestrator worker calls this service via Service Binding:

**In orchestrator's wrangler.jsonc:**

```jsonc
{
  "services": [
    {
      "binding": "DESCRIPTION_SERVICE",
      "service": "arke-description-service"
    }
  ]
}
```

**In orchestrator code:**

```typescript
const response = await env.DESCRIPTION_SERVICE.fetch(
  new Request('http://internal/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
);

const result = await response.json();
```

## File Structure

```
arke-description-service/
├── src/
│   ├── index.ts          # Worker entry point
│   ├── types.ts          # TypeScript interfaces
│   ├── llm.ts            # LLM API client
│   ├── prompts.ts        # Prompt generation
│   └── summarizer.ts     # Main logic
├── wrangler.jsonc        # Cloudflare config
├── tsconfig.json         # TypeScript config
├── package.json          # Dependencies
└── README.md             # This file
```

## Environment Variables

Configured in `wrangler.jsonc`:

- `DEEPINFRA_BASE_URL`: API endpoint (default: `https://api.deepinfra.com/v1/openai`)
- `MODEL_NAME`: LLM model (default: `openai/gpt-oss-20b`)
- `DEEPINFRA_API_KEY`: API key (secret, set via `wrangler secret put`)

## Pricing

Based on `gpt-oss-20b` pricing:
- Input: $0.03 per 1M tokens
- Output: $0.14 per 1M tokens

Costs are tracked per request and returned in the response.

## Testing

Test the deployed worker:

```bash
curl -X POST https://arke-description-service.YOUR-SUBDOMAIN.workers.dev/summarize \
  -H "Content-Type: application/json" \
  -d '{
    "directory_name": "test",
    "manual_metadata": {},
    "children_ocr": [
      {"name": "test.jpg", "text": "Sample OCR text"}
    ],
    "children_descriptions": []
  }'
```

## Troubleshooting

### "DEEPINFRA_API_KEY not configured"

Make sure you've set the secret:

```bash
npx wrangler secret put DEEPINFRA_API_KEY
```

### "LLM API error"

Check that:
1. Your API key is valid
2. The `DEEPINFRA_BASE_URL` is correct
3. The model name is available on DeepInfra

### TypeScript errors during development

Install dependencies first:

```bash
npm install
```

## Development Notes

- Worker has a 50ms CPU time limit on free tier (30s on paid)
- LLM API calls don't count toward CPU time (they're I/O)
- No cold starts unlike AWS Lambda
- Responses are cached at the edge automatically
