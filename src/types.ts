/**
 * Type definitions for arke-description-service
 */

export interface Env {
  DEEPINFRA_API_KEY: string;
  DEEPINFRA_BASE_URL: string;
  MODEL_NAME: string;
}

export interface ChildOCR {
  name: string;
  text: string;
}

export interface ChildDescription {
  name: string;
  description: string;
  metadata: any;
}

export interface SummarizeRequest {
  directory_name: string;
  manual_metadata?: any;
  children_ocr: ChildOCR[];
  children_descriptions: ChildDescription[];
}

export interface SummarizeResponse {
  description: string;
  metadata: any;
  cost_usd: number;
  tokens: number;
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
