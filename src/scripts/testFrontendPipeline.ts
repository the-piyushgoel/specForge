import 'dotenv/config';
import { runPipeline } from '../pipeline/runPipeline';
import { CRM_PROMPT } from '../fixtures/samplePrompts';
import { MOCK_LLM } from '../llm/client';
import { assembleAppSpec } from '../pipeline/assemble';
import { validateSpec } from '../pipeline/validate';
import { repairSpec } from '../pipeline/repair';

async function main() {
  console.log('🚀 Starting SpecForge Full Pipeline Test');
  console.log('════════════════════════════════════════════');
  if (MOCK_LLM) {
    console.log('🧪 MODE: MOCK_LLM is ACTIVE (Skipping OpenAI)');
  } else {
    console.log('🌐 MODE: REAL PROVIDER (Using OpenAI)');
  }
  console.log(`Prompt: "${CRM_PROMPT}"\n`);

  try {
    const result = await runPipeline(CRM_PROMPT, (trace) => {
      const icon = trace.status === 'success' ? '✅' : '❌';
      console.log(`  ${icon} [${trace.stage}] ${trace.name} (${trace.durationMs}ms)`);
      if (trace.error) {
        console.error(`      Error: ${trace.error}`);
      }
    });

    const { extraction, enrichment, intentIR, appGraphIR, appSpec } = result.artifacts;

    console.log('\n📊 Pipeline Summary');
    console.log('════════════════════════════════════════════');
    console.log(`Run ID:              ${result.runId}`);
    console.log(`Total Duration:      ${result.totalDurationMs}ms`);
    console.log(`Prompt Complexity:   ${extraction.complexity}`);
    
    console.log('\n1️⃣  Extraction (P1)');
    console.log(`  Explicit Reqs:     ${extraction.requirements.length}`);
    
    console.log('\n2️⃣  Enrichment (P2)');
    const inferredCount = enrichment.requirements.filter((r) => r.source === 'inferred').length;
    console.log(`  Total Reqs:        ${enrichment.requirements.length} (${inferredCount} inferred)`);
    console.log(`  Assumptions:       ${enrichment.assumptions.length}`);
    console.log(`  Conflicts:         ${enrichment.conflicts.length}`);
    
    console.log('\n3️⃣  IntentIR (P3)');
    console.log(`  App Name:          ${intentIR.appName}`);
    console.log(`  Features:          ${intentIR.features.length}`);
    console.log(`  Entities:          ${intentIR.entities.length}`);
    console.log(`  Roles:             ${intentIR.roles.length}`);
    console.log(`  Business Rules:    ${intentIR.businessRules.length}`);

    console.log('\n4️⃣  AppGraphIR (P4)');
    console.log(`  Pages:             ${appGraphIR.pages.length}`);
    console.log(`  API Endpoints:     ${appGraphIR.apiEndpoints.length}`);
    console.log(`  Data Models:       ${appGraphIR.dataModels.length}`);

    console.log('\n5️⃣  FinalAppSpec (P5)');
    console.log(`  Cross-References:  ${appSpec.crossReferences.length}`);
    console.log(`  Final Pages:       ${appSpec.metadata.totalPages}`);
    console.log(`  Final Endpoints:   ${appSpec.metadata.totalEndpoints}`);
    console.log(`  Final Models:      ${appSpec.metadata.totalTables}`);

    // ── Validation summary ────────────────────────────────
    const v = appSpec.validation;
    console.log('\n6️⃣  Validation (P6)');
    const statusIcon = v.status === 'passed' ? '✅' : v.status === 'passed_with_warnings' ? '⚠️' : '❌';
    console.log(`  Status:            ${statusIcon} ${v.status}`);
    console.log(`  Errors:            ${v.summary.errors}`);
    console.log(`  Warnings:          ${v.summary.warnings}`);
    console.log(`  Infos:             ${v.summary.infos}`);
    console.log(`  Auto-fixable:      ${v.summary.autoFixable}`);
    console.log(`  Iterations:        ${v.iterationCount}`);

    if (v.issues.length > 0) {
      console.log('\n  Issues:');
      for (const issue of v.issues) {
        const sev = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
        console.log(`    ${sev} [${issue.code}] ${issue.message}`);
      }
    }

    // ── Repair summary ────────────────────────────────────
    console.log('\n7️⃣  Repair (P7)');
    if (appSpec.repairLog.length === 0) {
      console.log('  No repairs needed.');
    } else {
      for (const log of appSpec.repairLog) {
        console.log(`  Pass ${log.iteration}: ${log.patches.length} patches (${log.preRepairErrors} → ${log.postRepairErrors} errors)`);
        for (const patch of log.patches) {
          const icon = patch.applied ? '🔧' : '⏭️';
          console.log(`    ${icon} [${patch.targetLayer}] ${patch.description}`);
        }
      }
    }

    // ── Architecture overview ─────────────────────────────
    console.log('\n📐 Architecture Overview');
    console.log('────────────────────────────────────────────');

    if (appSpec.appGraphIR.pages.length > 0) {
      console.log('\n  Pages:');
      for (const p of appSpec.appGraphIR.pages) {
        const roles = p.requiredRoles.length ? ` [${p.requiredRoles.join(',')}]` : '';
        const lock = p.requiredAuth ? '🔒' : '🔓';
        console.log(`    ${lock} ${p.route.padEnd(22)} ${p.title}${roles}`);
      }
    }

    if (appSpec.appGraphIR.apiEndpoints.length > 0) {
      console.log('\n  Endpoints:');
      for (const ep of appSpec.appGraphIR.apiEndpoints) {
        const lock = ep.auth.required ? '🔒' : '🔓';
        console.log(`    ${lock} ${ep.method.padEnd(6)} ${ep.path.padEnd(30)} ${ep.description}`);
      }
    }

    if (appSpec.appGraphIR.dataModels.length > 0) {
      console.log('\n  Data Models:');
      for (const dm of appSpec.appGraphIR.dataModels) {
        console.log(`    📦 ${dm.tableName} (${dm.columns.length} cols, ${dm.foreignKeys.length} FKs)`);
      }
    }

    console.log('\n  Auth Config:');
    console.log(`    Strategy:        ${appSpec.appGraphIR.authConfig.strategy}`);
    console.log(`    Providers:       [${appSpec.appGraphIR.authConfig.providers.join(', ')}]`);
    console.log(`    Roles:           [${appSpec.appGraphIR.authConfig.roles.join(', ')}]`);
    console.log(`    Plan Gates:      ${appSpec.appGraphIR.authConfig.planGating.length}`);

    console.log('\n📁 Artifacts written to:');
    console.log(`  artifacts/${result.runId}/`);
    
    console.log('\n✨ Full pipeline completed successfully.');

    // ── SCENARIO B: Broken Demo Case ──────────────────────────────────────
    console.log('\n\n🚀 Starting Scenario B: Broken Demo (Validation & Repair)');
    console.log('════════════════════════════════════════════');
    
    // Deep clone the AppGraphIR to prevent mutating Scenario A artifacts
    const brokenAppGraphIR = JSON.parse(JSON.stringify(appGraphIR));
    
    // Break the specification:
    // 1. Remove the login page (triggers AUTH_MISSING_LOGIN_PAGE, auto-fixable)
    brokenAppGraphIR.pages = brokenAppGraphIR.pages.filter((p: any) => p.id !== 'page_login');
    
    // 2. Remove the contact CRUD pages (triggers CRUD_MISSING_PAGE, auto-fixable)
    brokenAppGraphIR.pages = brokenAppGraphIR.pages.filter((p: any) => !p.id.includes('contact'));

    console.log('⚠️  Intentionally removed "page_login" and all contact pages from AppGraphIR.');

    // Assemble the broken spec
    const brokenSpec = assembleAppSpec(
      extraction,
      enrichment,
      intentIR,
      brokenAppGraphIR,
      CRM_PROMPT
    );

    console.log('\n🔍 Running Validation on Broken Spec...');
    const brokenValidation = validateSpec(brokenSpec, 1);
    console.log(`  Initial Status:    ❌ ${brokenValidation.status}`);
    console.log(`  Errors:            ${brokenValidation.summary.errors}`);
    console.log(`  Warnings:          ${brokenValidation.summary.warnings}`);
    console.log(`  Auto-fixable:      ${brokenValidation.summary.autoFixable}`);

    if (brokenValidation.issues.length > 0) {
      console.log('  Issues found:');
      for (const issue of brokenValidation.issues) {
        const icon = issue.severity === 'error' ? '🔴' : '🟡';
        console.log(`    ${icon} [${issue.code}] ${issue.message} (Auto-fixable: ${issue.autoFixable})`);
      }
    }

    // Filter auto-fixable issues
    const fixableIssues = brokenValidation.issues.filter((i) => i.autoFixable);
    
    if (fixableIssues.length > 0) {
      console.log(`\n🔧 Applying ${fixableIssues.length} auto-repair patches...`);
      const { repairedSpec, patchLog } = repairSpec(brokenSpec, fixableIssues, 1);
      
      for (const patch of patchLog.patches) {
        const icon = patch.applied ? '🔧' : '⏭️';
        console.log(`    ${icon} [${patch.targetLayer}] ${patch.description}`);
      }

      console.log('\n🔍 Re-running Validation on Repaired Spec...');
      const postRepairValidation = validateSpec(repairedSpec, 2);
      const statusIcon = postRepairValidation.status === 'passed' ? '✅' : postRepairValidation.status === 'passed_with_warnings' ? '⚠️' : '❌';
      console.log(`  Final Status:      ${statusIcon} ${postRepairValidation.status}`);
      console.log(`  Errors:            ${postRepairValidation.summary.errors}`);
      console.log(`  Warnings:          ${postRepairValidation.summary.warnings}`);

      if (postRepairValidation.issues.length > 0) {
        console.log('  Remaining Issues:');
        for (const issue of postRepairValidation.issues) {
          const icon = issue.severity === 'error' ? '🔴' : '🟡';
          console.log(`    ${icon} [${issue.code}] ${issue.message}`);
        }
      }
    } else {
      console.log('\n  No auto-fixable issues found to repair.');
    }

  } catch (error) {
    console.error('\n❌ Pipeline failed during execution:');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}

main();
