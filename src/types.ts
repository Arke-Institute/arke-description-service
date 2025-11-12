/**
 * Type definitions for description-service
 */

export interface Env {
  DEEPINFRA_API_KEY: string;
  DEEPINFRA_BASE_URL: string;
  MODEL_NAME: string;
  MAX_TOKENS: number;
  CONTEXT_WINDOW_TOKENS?: number;
  SAFETY_MARGIN_RATIO?: number;
}

export interface TextFile {
  name: string;      // File name or identifier
  content: string;   // Raw text content
}

export interface SummarizeRequest {
  directory_name: string;
  files: TextFile[];           // Array of text files with raw content
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
