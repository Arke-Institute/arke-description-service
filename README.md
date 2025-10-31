# arke-description-service

Cloudflare Worker that performs bottom-up LLM-based summarization of directory hierarchies for the Arke Institute photo archive.

## Overview

This service receives aggregated information about a directory (OCR text from images, descriptions from subdirectories, manual metadata) and generates:
- A markdown description summarizing the directory's contents
- Structured PINAX metadata (Dublin Core-based schema)
- Validation of metadata completeness and correctness
- Token usage and cost tracking

## Architecture

- **Runtime**: Cloudflare Workers (edge compute)
- **LLM Provider**: DeepInfra (OpenAI-compatible API)
- **Models**:
  - `openai/gpt-oss-20b` - Markdown description generation
  - `mistralai/Mistral-Small-3.2-24B-Instruct-2506` - Structured metadata extraction (with JSON mode)
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

## API Endpoints

This service provides three endpoints:

1. **POST /summarize** - Generate markdown descriptions
2. **POST /extract-metadata** - Extract structured PINAX metadata
3. **POST /validate-metadata** - Validate metadata completeness

---

## 1. Generate Wiki-Style Description

**POST /summarize**

Generates comprehensive wiki-style markdown documentation for a directory using GPT-OSS-20B.

Accepts flexible text content from any file format (JSON, XML, TXT, CSV, etc.) and generates rich, encyclopedic-style articles with sections, tables, lists, and narrative context.

### Request Format

```json
{
  "directory_name": "Summer_1985_California",
  "files": [
    {
      "name": "family_notes.txt",
      "content": "Summer vacation 1985\nSanta Monica beach trips..."
    },
    {
      "name": "photo_metadata.json",
      "content": "{\"location\": \"California\", \"dates\": [\"1985-06-15\", \"1985-08-20\"]}"
    },
    {
      "name": "itinerary.xml",
      "content": "<?xml version=\"1.0\"?>\n<trip><destination>Los Angeles</destination>...</trip>"
    }
  ]
}
```

**Key Features:**
- `files`: Array of text files with any format (JSON, XML, TXT, CSV, Markdown, etc.)
- Each file has a `name` (identifier) and `content` (raw text)
- The LLM intelligently parses all formats and synthesizes a comprehensive wiki article
- Generates rich markdown with sections, tables, lists, and contextual narrative
- Wikipedia-style encyclopedic approach

### Response Format

```json
{
  "description": "# Summer 1985 California Family Vacation\n\n## Overview\n\nThis collection documents...\n\n## Timeline\n\n| Date | Event | Location |\n|------|-------|----------|\n...",
  "cost_usd": 0.00142,
  "tokens": 856
}
```

**Output includes:**
- Comprehensive markdown document (no metadata extraction)
- Cost and token usage for tracking

---

## 2. Extract PINAX Metadata

**POST /extract-metadata**

Extracts structured metadata following the PINAX schema (Dublin Core-based) using Mistral-Small with JSON mode.

Accepts flexible text content from any file format (JSON, XML, TXT, CSV, etc.) and intelligently extracts metadata.

### Request Format

```json
{
  "directory_name": "1931_Empire_State_Building_Construction",
  "files": [
    {
      "name": "metadata.json",
      "content": "{\"photographer\": \"Lewis Hine\", \"year\": 1931, \"location\": \"New York City\"}"
    },
    {
      "name": "description.txt",
      "content": "A collection of photographs documenting the construction of the Empire State Building..."
    },
    {
      "name": "notes.xml",
      "content": "<?xml version=\"1.0\"?>\n<note><date>May 1931</date><location>Manhattan</location></note>"
    }
  ],
  "access_url": "https://arke.institute/collections/empire-state-building-1931",
  "manual_metadata": {
    "rights": "Public Domain",
    "institution": "Arke Institute"
  }
}
```

**Key Features:**
- `files`: Array of text files with any format (JSON, XML, TXT, CSV, Markdown, etc.)
- Each file has a `name` (identifier) and `content` (raw text)
- The LLM intelligently parses all formats and extracts relevant metadata
- `manual_metadata`: Optional overrides that take precedence over LLM extraction

### Response Format

```json
{
  "metadata": {
    "id": "01K8VTAYRQH4JRCFX8C1FWE566",
    "title": "Empire State Building Construction Photographs",
    "type": "Collection",
    "creator": "Lewis Hine",
    "institution": "Arke Institute",
    "created": "1931",
    "language": "en",
    "subjects": [
      "Empire State Building",
      "Construction",
      "Labor",
      "Photography",
      "Architecture",
      "New York City"
    ],
    "description": "A collection of photographs documenting the construction of the Empire State Building during 1930-1931.",
    "access_url": "https://arke.institute/collections/empire-state-building-1931",
    "source": "PINAX",
    "rights": "Public Domain",
    "place": "New York City"
  },
  "validation": {
    "valid": true,
    "missing_required": [],
    "warnings": [],
    "field_validations": {
      "id": "✓ Valid ULID format",
      "type": "✓ Valid DCMI Type",
      "created": "✓ Valid year format (YYYY)",
      "language": "✓ Valid BCP-47 language code",
      "access_url": "✓ Valid URL"
    }
  },
  "cost_usd": 0.0001181,
  "tokens": 825,
  "model": "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
}
```

### PINAX Schema Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (ULID/UUID) | ✅ | Stable source record ID (auto-generated if not provided) |
| `title` | string | ✅ | Display title |
| `type` | string (DCMI Type) | ✅ | Resource type: Collection, Dataset, Event, Image, InteractiveResource, MovingImage, PhysicalObject, Service, Software, Sound, StillImage, Text |
| `creator` | string or string[] | ✅ | People/organizations who created the item |
| `institution` | string | ✅ | Owning/issuing institution |
| `created` | string (YYYY or YYYY-MM-DD) | ✅ | Creation date of the item |
| `language` | string (BCP-47) | ❌ | Language code (e.g., "en", "en-US", "fr-CA") |
| `subjects` | string[] | ❌ | Keywords/topics for searchability |
| `description` | string | ❌ | Short abstract/summary |
| `access_url` | string (URL) | ✅ | Click-through link to the resource |
| `source` | string | ❌ | Source system label (defaults to "PINAX") |
| `rights` | string | ❌ | Rights statement |
| `place` | string or string[] | ❌ | Geographic location(s) |

---

## 3. Validate Metadata

**POST /validate-metadata**

Validates PINAX metadata for completeness and correctness without calling the LLM.

### Request Format

```json
{
  "metadata": {
    "id": "01K8VTAYRQH4JRCFX8C1FWE566",
    "title": "Empire State Building Construction Photographs",
    "type": "Collection",
    "creator": "Lewis Hine",
    "institution": "Arke Institute",
    "created": "1931",
    "access_url": "https://arke.institute/collections/empire-state-building-1931"
  }
}
```

### Response Format

```json
{
  "valid": true,
  "missing_required": [],
  "warnings": [
    "Consider adding a description for better discoverability",
    "Consider adding subjects/keywords for better searchability"
  ],
  "field_validations": {
    "id": "✓ Valid ULID format",
    "type": "✓ Valid DCMI Type",
    "created": "✓ Valid year format (YYYY)",
    "access_url": "✓ Valid URL"
  }
}
```

### Validation Rules

- **Required fields**: id, title, type, creator, institution, created, access_url
- **ID format**: Must be a valid ULID (26 chars) or UUID (8-4-4-4-12 format)
- **Type**: Must be a valid DCMI Type vocabulary term
- **Date**: Must be YYYY or YYYY-MM-DD format
- **Language**: Must be a valid BCP-47 code (e.g., "en", "en-US")
- **URL**: Must be a valid HTTP/HTTPS URL

---

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
│   ├── index.ts                # Worker entry point (routes all endpoints)
│   ├── types.ts                # TypeScript interfaces (includes PINAX types)
│   ├── llm.ts                  # LLM API client (description generation)
│   ├── llm-metadata.ts         # Metadata LLM client (JSON mode extraction)
│   ├── prompts.ts              # Prompt generation (descriptions)
│   ├── summarizer.ts           # Description generation logic
│   ├── metadata-extractor.ts  # Metadata extraction orchestration
│   └── metadata-validator.ts  # PINAX schema validation
├── wrangler.jsonc              # Cloudflare config
├── tsconfig.json               # TypeScript config
├── package.json                # Dependencies
├── pinax-schema.md             # PINAX metadata schema reference
└── README.md                   # This file
```

## Environment Variables

Configured in `wrangler.jsonc`:

- `DEEPINFRA_BASE_URL`: API endpoint (default: `https://api.deepinfra.com/v1/openai`)
- `MODEL_NAME`: LLM model (default: `openai/gpt-oss-20b`)
- `DEEPINFRA_API_KEY`: API key (secret, set via `wrangler secret put`)

## Pricing

### Description Generation (`gpt-oss-20b`)
- Input: $0.03 per 1M tokens
- Output: $0.14 per 1M tokens
- Average cost: ~$0.001-0.002 per description

### Metadata Extraction (`mistralai/Mistral-Small-3.2-24B-Instruct-2506`)
- Input: ~$0.10 per 1M tokens (estimate)
- Output: ~$0.30 per 1M tokens (estimate)
- Average cost: ~$0.0001-0.0002 per extraction

All costs are tracked per request and returned in the response.

## Testing

### Test Wiki Description Generation

```bash
curl -X POST http://localhost:8787/summarize \
  -H "Content-Type: application/json" \
  -d '{
    "directory_name": "test_collection",
    "files": [
      {
        "name": "notes.txt",
        "content": "Sample collection from summer 1985"
      },
      {
        "name": "metadata.json",
        "content": "{\"location\": \"California\", \"people\": [\"John\", \"Mary\"]}"
      }
    ]
  }'
```

### Test Metadata Extraction

```bash
curl -X POST http://localhost:8787/extract-metadata \
  -H "Content-Type: application/json" \
  -d @test-metadata-request.json
```

Example test file (`test-metadata-request.json`):
```json
{
  "directory_name": "1931_Empire_State_Building",
  "files": [
    {
      "name": "metadata.json",
      "content": "{\"photographer\": \"Lewis Hine\", \"year\": 1931}"
    },
    {
      "name": "description.txt",
      "content": "Construction photos showing workers on steel beams..."
    }
  ],
  "access_url": "https://example.com/item/123",
  "manual_metadata": {
    "institution": "Arke Institute"
  }
}
```

### Test Metadata Validation

```bash
curl -X POST http://localhost:8787/validate-metadata \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": {
      "id": "01K8VTAYRQH4JRCFX8C1FWE566",
      "title": "Test Item",
      "type": "Image",
      "creator": "John Doe",
      "institution": "Test Institute",
      "created": "2024",
      "access_url": "https://example.com/item/1"
    }
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
