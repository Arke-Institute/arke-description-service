 Summary: arke-description-service Expectations

  The arke-description-service performs bottom-up LLM-based summarization of
  directory hierarchies. It's more complex than the OCR service!

  Input Structure

  - HTTP Method: POST to /summarize endpoint
  - Headers: Content-Type: application/json
  - Body: JSON matching this structure:

  {
    directory_name: string;           // Name of the directory
    manual_metadata: any;             // User-provided metadata.json (if exists)
    children_ocr: [                   // OCR text from child images
      { name: string, text: string },
      ...
    ],
    children_descriptions: [          // Descriptions from child subdirectories
      {
        name: string,
        description: string,          // From child's description.md
        metadata: any                 // From child's metadata.json
      },
      ...
    ]
  }

  Output Structure

  JSON response:
  {
    description: string;    // Markdown description of the directory
    metadata: any;          // Structured metadata (JSON object)
    cost_usd: number;       // Cost of the LLM call
    tokens: number;         // Tokens consumed
  }

  Responsibilities

  1. Synthesize information from OCR text, child descriptions, and manual
  metadata
  2. Generate a markdown description that summarizes the directory's contents
  3. Extract/infer structured metadata (dates, locations, people, events, etc.)
  4. Track LLM costs and token usage for billing/monitoring

  Processing Pattern

  The service receives aggregated information from children and must:
  - Understand context from OCR text of images in this directory
  - Incorporate summaries from subdirectories already processed
  - Respect any manual metadata provided by users
  - Generate coherent descriptions that roll up child information

  Integration Details

  - Called via Service Binding (DESCRIPTION_SERVICE)
  - Processes directories bottom-up (deepest first)
  - Batches of 5 directories processed in parallel (configurable via
  BATCH_SIZE_SUMMARIZATION)
  - Results saved to R2: description.md and metadata.json
  - Same as OCR service: the HTTP POST endpoint works perfectly with service
  bindings!

  The orchestrator expects the service deployed as arke-description-service
  worker (per wrangler.jsonc:48-50).