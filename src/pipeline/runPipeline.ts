import type {
  PipelineResult,
  PipelineArtifacts,
  StageTrace,
  FinalAppSpec,
  RepairPatchLog,
} from '../types';
import { createRunDir, writeArtifact, STAGE_FILES } from '../lib/fsArtifacts';
import { resetAllIds } from '../lib/ids';
import { runExtract } from './extract';
import { runEnrich } from './enrich';
import { buildIntentIR } from './intent';
import { buildAppGraphIR } from './appGraph';
import { assembleAppSpec } from './assemble';
import { validateSpec } from './validate';
import { repairSpec } from './repair';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_REPAIR_ITERATIONS = 2;

// ─── Stage runner helper ─────────────────────────────────────────────────────

type StageCallback = (trace: StageTrace) => void;

async function runStage<T>(
  stageId: string,
  stageName: string,
  fn: () => Promise<T> | T,
  onStage?: StageCallback
): Promise<{ result: T; trace: StageTrace }> {
  const startedAt = new Date();
  try {
    const result = await fn();
    const trace: StageTrace = {
      stage: stageId,
      name: stageName,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: 'success',
    };
    onStage?.(trace);
    return { result, trace };
  } catch (err) {
    const trace: StageTrace = {
      stage: stageId,
      name: stageName,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    onStage?.(trace);
    throw err;
  }
}

// ─── Pipeline orchestrator ───────────────────────────────────────────────────

/**
 * Run the full SpecForge pipeline:
 *   P1 Extract → P2 Enrich → P3 IntentIR → P4 AppGraphIR
 *   → P5 Assemble → P6 Validate ⇄ P7 Repair → Output
 *
 * All intermediate artifacts are persisted to disk under artifacts/{runId}/.
 */
export async function runPipeline(
  rawPrompt: string,
  onStage?: StageCallback
): Promise<PipelineResult> {
  resetAllIds();
  const pipelineStart = Date.now();
  const runDir = await createRunDir(rawPrompt);
  const traces: StageTrace[] = [];

  // ── P1: Extract ────────────────────────────────────────
  const { result: extraction, trace: t1 } = await runStage(
    'P1_EXTRACT',
    'Requirement Extraction',
    () => runExtract(rawPrompt),
    onStage
  );
  traces.push(t1);
  await writeArtifact(runDir, STAGE_FILES.extraction, extraction);

  // ── P2: Enrich ─────────────────────────────────────────
  const { result: enrichment, trace: t2 } = await runStage(
    'P2_ENRICH',
    'Enrichment + Assumptions',
    () => runEnrich(extraction),
    onStage
  );
  traces.push(t2);
  await writeArtifact(runDir, STAGE_FILES.enrichment, enrichment);

  // ── P3: IntentIR ───────────────────────────────────────
  const { result: intentIR, trace: t3 } = await runStage(
    'P3_INTENT',
    'IntentIR Construction',
    () => buildIntentIR(enrichment),
    onStage
  );
  traces.push(t3);
  await writeArtifact(runDir, STAGE_FILES.intentIR, intentIR);

  // ── P4: AppGraphIR ─────────────────────────────────────
  const { result: appGraphIR, trace: t4 } = await runStage(
    'P4_APPGRAPH',
    'AppGraphIR Construction',
    () => buildAppGraphIR(intentIR),
    onStage
  );
  traces.push(t4);
  await writeArtifact(runDir, STAGE_FILES.appGraphIR, appGraphIR);

  // ── P5: Assemble FinalAppSpec ──────────────────────────
  const { result: appSpec, trace: t5 } = await runStage(
    'P5_ASSEMBLE',
    'AppSpec Assembly',
    () => assembleAppSpec(extraction, enrichment, intentIR, appGraphIR, rawPrompt),
    onStage
  );
  traces.push(t5);

  // ── P6: Validate ───────────────────────────────────────
  const { result: initialValidation, trace: t6 } = await runStage(
    'P6_VALIDATE',
    'Spec Validation',
    () => validateSpec(appSpec, 1),
    onStage
  );
  traces.push(t6);

  // ── P7: Repair loop ────────────────────────────────────
  let currentSpec = appSpec;
  let currentValidation = initialValidation;
  const repairLogs: RepairPatchLog[] = [];

  const hasAutoFixable = currentValidation.issues.some((i) => i.autoFixable);

  if (hasAutoFixable) {
    for (let iter = 1; iter <= MAX_REPAIR_ITERATIONS; iter++) {
      const fixableIssues = currentValidation.issues.filter((i) => i.autoFixable);
      if (fixableIssues.length === 0) break;

      const { result: repairResult, trace: tRepair } = await runStage(
        `P7_REPAIR_${iter}`,
        `Repair Pass ${iter}`,
        () => repairSpec(currentSpec, fixableIssues, iter),
        onStage
      );
      traces.push(tRepair);

      currentSpec = repairResult.repairedSpec;

      // Re-validate after repair
      const { result: reValidation, trace: tReVal } = await runStage(
        `P6_REVALIDATE_${iter}`,
        `Re-validation ${iter}`,
        () => validateSpec(currentSpec, iter + 1),
        onStage
      );
      traces.push(tReVal);

      // Update patch log with actual post-repair error count
      repairResult.patchLog.postRepairErrors = reValidation.summary.errors;
      repairLogs.push(repairResult.patchLog);

      currentValidation = reValidation;

      // If clean, stop repairing
      if (reValidation.summary.errors === 0 && !reValidation.issues.some((i) => i.autoFixable)) {
        break;
      }
    }
  }

  // ── Finalize the spec ──────────────────────────────────
  currentSpec.validation = currentValidation;
  currentSpec.repairLog = repairLogs;

  // Update metadata counts after potential repairs
  currentSpec.metadata.totalEndpoints = currentSpec.appGraphIR.apiEndpoints.length;
  currentSpec.metadata.totalTables = currentSpec.appGraphIR.dataModels.length;
  currentSpec.metadata.totalPages = currentSpec.appGraphIR.pages.length;

  // ── Write all backend artifacts ────────────────────────
  await writeArtifact(runDir, STAGE_FILES.appSpec, currentSpec);
  await writeArtifact(runDir, STAGE_FILES.validation, currentValidation);
  if (repairLogs.length > 0) {
    await writeArtifact(runDir, STAGE_FILES.repair, repairLogs);
  }

  const artifacts: PipelineArtifacts = {
    extraction,
    enrichment,
    intentIR,
    appGraphIR,
    appSpec: currentSpec,
  };

  // ── Write final result ─────────────────────────────────
  const result: PipelineResult = {
    runId: runDir.split(/[\\/]/).pop() ?? 'unknown',
    rawPrompt,
    traces,
    artifacts,
    totalDurationMs: Date.now() - pipelineStart,
  };

  await writeArtifact(runDir, STAGE_FILES.result, result);

  return result;
}

// ─── Development helper ──────────────────────────────────────────────────────

/**
 * Quick test runner — invoke with: npx tsx src/pipeline/runPipeline.ts
 *
 * Runs the pipeline against the CRM sample prompt and prints a summary.
 */
async function main() {
  const { CRM_PROMPT } = await import('../fixtures/samplePrompts');

  console.log('═══ SpecForge Pipeline (P1–P7) ═══\n');
  console.log(`Prompt: "${CRM_PROMPT}"\n`);

  const result = await runPipeline(CRM_PROMPT, (trace) => {
    const icon = trace.status === 'success' ? '✅' : '❌';
    console.log(`  ${icon} ${trace.name} (${trace.durationMs}ms)`);
  });

  const { extraction, enrichment, intentIR, appSpec } = result.artifacts;

  console.log('\n─── Results ───');
  console.log(`Run ID:       ${result.runId}`);
  console.log(`Duration:     ${result.totalDurationMs}ms`);
  console.log(`Complexity:   ${extraction.complexity}`);
  console.log(`\nExtracted:    ${extraction.requirements.length} requirements`);
  console.log(
    `Enriched:     ${enrichment.requirements.length} total (${enrichment.requirements.filter((r) => r.source === 'inferred').length} inferred)`
  );
  console.log(`Assumptions:  ${enrichment.assumptions.length}`);
  console.log(`Conflicts:    ${enrichment.conflicts.length}`);
  console.log(`\nIntentIR:`)
  console.log(`  App name:   ${intentIR.appName}`);
  console.log(`  Features:   ${intentIR.features.length}`);
  console.log(`  Entities:   ${intentIR.entities.length}`);
  console.log(`  Roles:      ${intentIR.roles.length}`);
  console.log(`  Biz rules:  ${intentIR.businessRules.length}`);

  console.log(`\nFinal AppSpec:`);
  console.log(`  Pages:      ${appSpec.metadata.totalPages}`);
  console.log(`  Endpoints:  ${appSpec.metadata.totalEndpoints}`);
  console.log(`  Models:     ${appSpec.metadata.totalTables}`);
  console.log(`  Validation: ${appSpec.validation.status}`);
  console.log(`  Repairs:    ${appSpec.repairLog.length} pass(es)`);

  console.log('\n─── Assumption Ledger ───');
  for (const asm of enrichment.assumptions) {
    const bar = '█'.repeat(Math.round(asm.confidence * 10)) + '░'.repeat(10 - Math.round(asm.confidence * 10));
    console.log(`  [${bar}] ${asm.confidence.toFixed(1)} — ${asm.assumption}`);
    console.log(`           Reason: ${asm.reason}`);
    console.log(`           Alt:    ${asm.alternative}`);
  }

  console.log(`\nArtifacts saved to: ${result.runId}`);
}

// Run if executed directly
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('runPipeline') || process.argv[1].includes('run_pipeline'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('\n❌ Pipeline failed:', err.message);
    process.exit(1);
  });
}
