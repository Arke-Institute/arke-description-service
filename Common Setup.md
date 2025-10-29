 Common Setup

  from openai import OpenAI

  client = OpenAI(
      api_key=api_key,
      base_url="https://api.deepinfra.com/v1/openai"
  )


2. GPT-OSS-20B (LLM Service)

  Model: openai/gpt-oss-20bLocation: lib/llm.py:28

  Input Format

  Standard text-only chat completions:

  response = client.chat.completions.create(
      model="openai/gpt-oss-20b",
      messages=[
          {"role": "system", "content": system_prompt},
          {"role": "user", "content": user_prompt}
      ],
      max_tokens=2048,
      temperature=0.3
  )

  The prompts include:
  - System prompt: Instructions for the archivist role (different for
  leaf vs aggregation nodes)
  - User prompt: Contains the content to catalog (OCR text, metadata,
  child descriptions) plus context

  Output Format (lib/llm.py:92-101)

  {
      'description': str,        # Full markdown description
      'title': str,              # Extracted title (from # Header)
      'summary': str,            # First ~400 chars of content
      'tokens': int,             # Total tokens used
      'prompt_tokens': int,      # Input tokens
      'completion_tokens': int,  # Output tokens
      'cost_usd': float,         # Estimated cost
      'model': str               # Model name
  }

  Pricing: Same as olmOCR
  - Input: $0.03 per 1M tokens
  - Output: $0.14 per 1M tokens

  ---