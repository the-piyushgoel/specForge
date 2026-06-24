import OpenAI from 'openai';
import { z } from 'zod';
import { extractJsonBlock } from '../lib/json';

// ─── Configuration ───────────────────────────────────────────────────────────

const MODEL = process.env.SPECFORGE_MODEL ?? 'gpt-4o';
export const MOCK_LLM = process.env.MOCK_LLM === 'true';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not set. Add it to .env.local or your environment.'
      );
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

// ─── Low-level model call ────────────────────────────────────────────────────

/**
 * Raw LLM call. Returns the model's text response.
 * All higher-level functions go through this so provider swaps are one-line.
 */
export async function callModel(
  system: string,
  user: string,
  opts?: { model?: string; temperature?: number }
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: opts?.model ?? MODEL,
    temperature: opts?.temperature ?? 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error('LLM returned an empty response');
  }
  return text;
}

// ─── Mocking ─────────────────────────────────────────────────────────────────

export type PipelineStage = 'extract' | 'enrich';

function getMockResponse(stage: PipelineStage): string {
  if (stage === 'extract') {
    return JSON.stringify({
      complexity: "moderate",
      requirements: [
        { id: "req_001", text: "User login and accounts", category: "auth", priority: "must" },
        { id: "req_002", text: "Contacts management", category: "data_entity", priority: "must" },
        { id: "req_003", text: "Admin CRM dashboard with analytics", category: "ui_view", priority: "should" },
        { id: "req_004", text: "Role-based access control", category: "authorization", priority: "must" },
        { id: "req_005", text: "Premium plan with payments", category: "integration", priority: "must" }
      ]
    });
  }

  if (stage === 'enrich') {
    return JSON.stringify({
      requirements: [
        { id: "req_001", text: "User login and accounts", category: "auth", source: "explicit" },
        { id: "req_002", text: "Contacts management", category: "data_entity", source: "explicit" },
        { id: "req_003", text: "Admin CRM dashboard with analytics", category: "ui_view", source: "explicit" },
        { id: "req_004", text: "Role-based access control", category: "authorization", source: "explicit" },
        { id: "req_005", text: "Premium plan with payments", category: "integration", source: "explicit" },
        { id: "inf_001", text: "Password reset flow", category: "auth", source: "inferred", inferredFrom: "req_001" },
        { id: "inf_002", text: "Subscription tiers and billing", category: "integration", source: "inferred", inferredFrom: "req_005" },
        { id: "inf_003", text: "User session management", category: "auth", source: "inferred", inferredFrom: "req_001" },
        { id: "inf_004", text: "Admin and User roles", category: "authorization", source: "inferred", inferredFrom: "req_004" }
      ],
      assumptions: [
        {
          id: "asm_001",
          assumption: "Login via email and password",
          reason: "Most common default when OAuth is not specified",
          alternative: "SSO or OAuth via Google",
          confidence: 0.8,
          relatedRequirements: ["req_001"]
        },
        {
          id: "asm_002",
          assumption: "Stripe for payments",
          reason: "Standard industry default for premium subscriptions",
          alternative: "PayPal or Braintree",
          confidence: 0.7,
          relatedRequirements: ["req_005"]
        }
      ],
      conflicts: [
        {
          id: "cfl_001",
          requirementIds: ["req_004", "req_005"],
          description: "Not clear if premium plans apply to individual users or the entire role/team.",
          severity: "warning",
          suggestedResolution: "Assume premium plans apply to the individual user account level."
        }
      ]
    });
  }

  throw new Error("No mock available for stage: " + stage);
}

// ─── Schema-validated call ───────────────────────────────────────────────────

export interface CallWithSchemaOpts<T> {
  system: string;
  user: string;
  schema: z.ZodSchema<T>;
  maxRetries?: number;
  model?: string;
  temperature?: number;
  stage?: PipelineStage; // For mock mode routing
}

/**
 * Call the LLM and validate the response against a Zod schema.
 *
 * On validation failure, retries up to `maxRetries` times with the Zod
 * error messages injected into the prompt so the model can self-correct.
 */
export async function callWithSchema<T>(
  opts: CallWithSchemaOpts<T>
): Promise<T> {
  const { system, user, schema, maxRetries = 2, model, temperature, stage } = opts;
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userPrompt =
      attempt === 0
        ? user
        : `${user}\n\n--- VALIDATION ERROR FROM PREVIOUS ATTEMPT ---\nFix these issues and return corrected JSON:\n${lastError}`;

    let raw: string;
    
    if (MOCK_LLM) {
      if (!stage) throw new Error("Mock mode requires 'stage' to be passed to callWithSchema");
      // Simulate network delay
      await new Promise(r => setTimeout(r, 500));
      raw = getMockResponse(stage);
    } else {
      raw = await callModel(system, userPrompt, { model, temperature });
    }

    // Handle markdown-wrapped JSON
    const cleaned = extractJsonBlock(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      lastError = `JSON parse error: ${(parseErr as Error).message}\nRaw output started with: ${cleaned.slice(0, 200)}`;
      if (attempt === maxRetries) {
        throw new Error(
          `LLM output is not valid JSON after ${maxRetries + 1} attempts.\n${lastError}`
        );
      }
      continue;
    }

    const result = schema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // Format Zod errors for the retry prompt
    lastError = result.error.issues
      .map(
        (issue) =>
          `- Path: ${issue.path.join('.')}, Error: ${issue.message} (expected: ${(issue as any).expected ?? 'N/A'})`
      )
      .join('\n');

    if (attempt === maxRetries) {
      throw new Error(
        `LLM output failed schema validation after ${maxRetries + 1} attempts.\nErrors:\n${lastError}`
      );
    }
  }

  // TypeScript: unreachable, but satisfies the compiler
  throw new Error('Unexpected: exhausted retries');
}
