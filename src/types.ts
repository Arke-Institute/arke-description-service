/**
 * Type definitions for description-service
 */

// === Environment ===

export interface Env {
  // Secrets
  DEEPINFRA_API_KEY: string;

  // LLM Config
  DEEPINFRA_BASE_URL: string;
  MODEL_NAME: string;
  MAX_TOKENS: number;
  CONTEXT_WINDOW_TOKENS?: number;
  SAFETY_MARGIN_RATIO?: number;

  // DO Config
  MAX_RETRIES_PER_PI?: string;
  MAX_CALLBACK_RETRIES?: string;
  ALARM_INTERVAL_MS?: string;

  // Bindings
  STAGING_BUCKET: R2Bucket;
  IPFS_WRAPPER: Fetcher;
  ORCHESTRATOR: Fetcher;
  DESCRIPTION_BATCH_DO: DurableObjectNamespace;
}

// === Batch Processing Request/Response ===

export interface ProcessRequest {
  batch_id: string;
  chunk_id: string;
  callback_url?: string;  // Optional - service binding is preferred
  r2_prefix: string;
  custom_prompt?: string;

  pis: Array<{
    pi: string;
    current_tip: string;
  }>;
}

export interface CallbackPayload {
  batch_id: string;
  chunk_id: string;
  status: 'success' | 'partial' | 'error';

  results: Array<{
    pi: string;
    status: 'success' | 'error';
    new_tip?: string;
    new_version?: number;
    error?: string;
  }>;

  summary: {
    total: number;
    succeeded: number;
    failed: number;
    processing_time_ms: number;
  };

  error?: string;
}

// === DO State Types ===

export type Phase = 'PENDING' | 'PROCESSING' | 'PUBLISHING' | 'CALLBACK' | 'DONE' | 'ERROR';

export interface PIState {
  pi: string;
  current_tip: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  retry_count: number;

  // Fetched context (cached for retries)
  context?: DescriptionContext;

  // Result
  description?: string;
  description_cid?: string;
  new_tip?: string;
  new_version?: number;

  // Error
  error?: string;
}

export interface BatchState {
  // Identity
  batch_id: string;
  chunk_id: string;
  callback_url?: string;  // Optional - service binding is preferred
  r2_prefix: string;
  custom_prompt?: string;

  // State machine
  phase: Phase;
  started_at: string;
  completed_at?: string;

  // PIs
  pis: PIState[];

  // Callback tracking
  callback_retry_count: number;

  // Global error
  global_error?: string;
}

// === Context Types ===

export interface DescriptionContext {
  directory_name: string;
  files: Array<{ filename: string; content: string }>;
}

// === Legacy Types (for existing /summarize endpoint) ===

export interface TextFile {
  name: string;      // File name or identifier
  content: string;   // Raw text content
}

export interface SummarizeRequest {
  directory_name: string;
  files: TextFile[];           // Array of text files with raw content
  custom_prompt?: string;      // Optional custom instructions for this specific request
}

export interface SummarizeResponse {
  description: string;         // Markdown/wiki-style description
}

export interface LLMResponse {
  description: string;
  title: string;
  summary: string;
  tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  model: string;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens: number;
  temperature: number;
}

export interface OpenAIUsage {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: OpenAIUsage;
}

export interface TokenizedFile {
  name: string;
  content: string;
  tokens: number;
  originalTokens: number;
}

export interface TruncationConfig {
  contextWindowTokens: number;
  maxOutputTokens: number;
  safetyMarginRatio: number;
  systemPromptTokens: number;
  userPromptTemplateTokens: number;
}

export interface TruncationResult {
  files: TokenizedFile[];
  totalTokensBefore: number;
  totalTokensAfter: number;
  targetTokens: number;
  deficit: number;
  protectionMode: boolean;
  filesProtected: number;
  filesTruncated: number;
}
