/**
 * Safe JSON parse — returns null instead of throwing on invalid input.
 */
export function safeParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Pretty-print an object to indented JSON.
 */
export function prettyJson(data: unknown, indent = 2): string {
  return JSON.stringify(data, null, indent);
}

/**
 * Extract a JSON block from text that may be wrapped in markdown fences.
 *
 * Handles these common LLM output patterns:
 *   ```json\n{...}\n```
 *   ```\n{...}\n```
 *   raw JSON (no fences)
 *
 * Returns the raw JSON string (not parsed), or the original text if
 * no fenced block is found.
 */
export function extractJsonBlock(text: string): string {
  const trimmed = text.trim();

  // Match ```json ... ``` or ``` ... ``` (with optional language tag)
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // If the text starts with { or [, assume it's already raw JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  // Last resort: try to find the first { and last } to extract embedded JSON
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  // Give up — return original text, let caller handle the parse error
  return trimmed;
}

/**
 * Attempt to parse JSON from an LLM response that may include markdown fences.
 * Combines extractJsonBlock + safeParse.
 */
export function parseLLMJson<T = unknown>(text: string): T | null {
  const cleaned = extractJsonBlock(text);
  return safeParse<T>(cleaned);
}
