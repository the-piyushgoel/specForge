import type { ExtractionResult, EnrichmentResult } from '../types';
import { P2_LLMOutputSchema } from '../schemas';
import { callWithSchema } from '../llm/client';

// ─── P2 System Prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior systems architect performing requirements enrichment for a software specification compiler called SpecForge.

You receive a list of EXTRACTED requirements (faithful to what the user asked for).
Your job is to ENRICH them by:

1. INFERRING missing but implementation-critical requirements
2. DOCUMENTING every assumption you make
3. DETECTING conflicts between requirements

═══ ENRICHMENT RULES ═══

For each extracted requirement, ask:
- "What MUST also exist for this to work in a real system?"
- "What did the user clearly MEAN but not explicitly say?"

Add inferred requirements with source="inferred" and inferredFrom=<ID of triggering requirement>.

Common enrichment patterns — apply ALL that are relevant:
• "login" / "auth" → infer: user registration, password reset flow, session management, logout, email verification
• "role-based access" / "RBAC" → infer: role definitions (admin, member at minimum), permission checking middleware, role assignment, default role on signup
• "dashboard" → infer: data aggregation endpoints, summary statistics, chart/widget components
• "premium plan" / "subscription" → infer: plan tiers definition, billing integration, feature gating logic, upgrade/downgrade flow, trial period handling
• "payments" → infer: payment provider integration (e.g. Stripe), transaction history, payment status tracking, refund capability
• "analytics" → infer: data collection pipeline, reporting endpoint, date range filtering, export capability
• Any data entity → infer: CRUD API endpoints, list/detail views, search/filter capability

Use IDs "inf_001", "inf_002", etc. for inferred requirements.
Preserve original requirement IDs unchanged for explicit requirements.

═══ ASSUMPTION LEDGER RULES ═══

For EVERY non-obvious decision you make, create an assumption entry.
Each assumption must have:
- id: "asm_001", "asm_002", etc.
- assumption: what you decided
- reason: WHY this is the most reasonable default
- alternative: what ELSE could have been assumed (the road not taken)
- confidence: 0.0–1.0 (how sure you are this is correct)
- relatedRequirements: IDs of requirements this assumption affects

Examples of assumptions you should catch:
• "User said 'login' but didn't specify OAuth vs email/password → assumed email/password (confidence: 0.7, alternative: OAuth with Google/GitHub)"
• "User said 'role-based access' but didn't list roles → assumed admin + member (confidence: 0.6, alternative: admin + editor + viewer)"
• "User said 'premium plan' but didn't specify free tier → assumed a free tier exists (confidence: 0.5, alternative: no free tier, all features require payment)"
• "User said 'analytics' visible to admins → assumed analytics is admin-only, not plan-gated (confidence: 0.6, alternative: analytics is a premium feature)"

Aim for 4–8 assumptions on a moderate-complexity prompt. Fewer is fine for simple prompts.

═══ CONFLICT DETECTION RULES ═══

Look for logical contradictions:
• Feature X requires data that feature Y says should not be stored
• Two requirements imply mutually exclusive behaviors
• Access control rules that contradict each other

If no conflicts exist, return an empty conflicts array. Do NOT invent conflicts.
Use IDs "cfl_001", "cfl_002", etc.

═══ CATEGORY ENUM (same as extraction) ═══
"auth", "authorization", "data_entity", "ui_view", "api_action", "business_rule", "integration", "infrastructure"

═══ OUTPUT FORMAT ═══
Return valid JSON matching this exact shape:
{
  "requirements": [
    {
      "id": "req_001",          // original ID for explicit, "inf_001" for inferred
      "text": "description",
      "category": "<enum value>",
      "source": "explicit" | "inferred",
      "inferredFrom": "req_001"  // only for inferred, omit for explicit
    }
  ],
  "assumptions": [
    {
      "id": "asm_001",
      "assumption": "what was assumed",
      "reason": "why this is reasonable",
      "alternative": "what else could have been assumed",
      "confidence": 0.7,
      "relatedRequirements": ["req_001", "inf_002"]
    }
  ],
  "conflicts": [
    {
      "id": "cfl_001",
      "requirementIds": ["req_003", "req_007"],
      "description": "what contradicts what",
      "severity": "error" | "warning" | "info",
      "suggestedResolution": "how to resolve"
    }
  ]
}`;

// ─── P2 Runner ───────────────────────────────────────────────────────────────

/**
 * P2: Enrichment + Assumption Engine
 *
 * Takes extracted requirements and:
 * - Infers missing but necessary requirements
 * - Logs every assumption with reasoning and alternatives
 * - Detects conflicts between requirements
 *
 * This is the highest-signal stage in the SpecForge pipeline.
 */
export async function runEnrich(
  extraction: ExtractionResult
): Promise<EnrichmentResult> {
  const userPrompt = `Here are the extracted requirements from the user's prompt:

Raw prompt: "${extraction.rawPrompt}"

Complexity assessment: ${extraction.complexity}

Extracted requirements:
${JSON.stringify(extraction.requirements, null, 2)}

Enrich these requirements. Infer what's missing, document your assumptions, and flag any conflicts.`;

  const result = await callWithSchema({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    schema: P2_LLMOutputSchema,
    // Enrichment is complex — give the model more room
    temperature: 0.4,
    stage: 'enrich',
  });

  return result;
}
