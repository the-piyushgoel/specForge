import type {
  ExtractionResult,
  EnrichmentResult,
  IntentIR,
  AppGraphIR,
  FinalAppSpec,
  CrossReference,
  SpecMetadata,
  ValidationReport,
} from '../types';
import { simpleHash } from '../lib/ids';

// ─── P5: FinalAppSpec Assembler (deterministic) ─────────────────────────────

/**
 * P5: Assemble all pipeline artifacts into a single FinalAppSpec.
 *
 * Builds cross-references between layers (UI ↔ API ↔ DB ↔ Auth)
 * and packages everything into the canonical output artifact.
 *
 * Pure deterministic transformation. No LLM calls.
 */
export function assembleAppSpec(
  extraction: ExtractionResult,
  enrichment: EnrichmentResult,
  intentIR: IntentIR,
  appGraphIR: AppGraphIR,
  rawPrompt: string
): FinalAppSpec {
  const crossReferences = buildCrossReferences(appGraphIR);
  const metadata = buildMetadata(intentIR, appGraphIR, extraction, rawPrompt);

  return {
    metadata,
    intentIR,
    appGraphIR,
    crossReferences,
    assumptions: enrichment.assumptions,
    conflicts: enrichment.conflicts,
    // Placeholder — validation + repair will fill these in later
    validation: emptyValidationReport(),
    repairLog: [],
  };
}

// ─── Cross-reference builder ─────────────────────────────────────────────────

function buildCrossReferences(graph: AppGraphIR): CrossReference[] {
  const refs: CrossReference[] = [];

  // page → endpoint (consumes)
  for (const page of graph.pages) {
    for (const epId of page.dataBindings) {
      refs.push({
        sourceLayer: 'ui',
        sourceId: page.id,
        targetLayer: 'api',
        targetId: epId,
        relation: 'consumes',
      });
    }
  }

  // endpoint → data model (persists_to)
  const entityToModel = new Map(
    graph.dataModels.map((m) => [m.sourceEntityId, m.id])
  );

  for (const ep of graph.apiEndpoints) {
    if (ep.sourceEntityId) {
      const modelId = entityToModel.get(ep.sourceEntityId);
      if (modelId) {
        refs.push({
          sourceLayer: 'api',
          sourceId: ep.id,
          targetLayer: 'db',
          targetId: modelId,
          relation: 'persists_to',
        });
      }
    }
  }

  // page → auth (guarded_by) — for pages requiring auth or specific roles
  for (const page of graph.pages) {
    if (page.requiredAuth || page.requiredRoles.length > 0) {
      refs.push({
        sourceLayer: 'ui',
        sourceId: page.id,
        targetLayer: 'auth',
        targetId: 'auth_config',
        relation: 'guarded_by',
      });
    }
  }

  // endpoint → auth (guarded_by) — for auth-required endpoints
  for (const ep of graph.apiEndpoints) {
    if (ep.auth.required) {
      refs.push({
        sourceLayer: 'api',
        sourceId: ep.id,
        targetLayer: 'auth',
        targetId: 'auth_config',
        relation: 'guarded_by',
      });
    }
  }

  return refs;
}

// ─── Metadata builder ────────────────────────────────────────────────────────

function buildMetadata(
  intentIR: IntentIR,
  graph: AppGraphIR,
  extraction: ExtractionResult,
  rawPrompt: string
): SpecMetadata {
  return {
    appName: intentIR.appName,
    generatedAt: new Date().toISOString(),
    pipelineVersion: '0.1.0',
    promptHash: simpleHash(rawPrompt),
    complexity: extraction.complexity,
    totalFeatures: intentIR.features.length,
    totalEndpoints: graph.apiEndpoints.length,
    totalTables: graph.dataModels.length,
    totalPages: graph.pages.length,
  };
}

// ─── Empty validation report (placeholder before P6) ─────────────────────────

function emptyValidationReport(): ValidationReport {
  return {
    status: 'passed',
    issues: [],
    summary: { errors: 0, warnings: 0, infos: 0, autoFixable: 0 },
    checkedAt: new Date().toISOString(),
    iterationCount: 0,
  };
}
