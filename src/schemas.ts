import { z } from 'zod';

// ─── Shared Enum Schemas ─────────────────────────────────────────────────────

export const RequirementCategorySchema = z.enum([
  'auth', 'authorization', 'data_entity', 'ui_view',
  'api_action', 'business_rule', 'integration', 'infrastructure',
]);

export const FeatureCategorySchema = z.enum([
  'auth', 'dashboard', 'crud', 'analytics', 'integration',
  'billing', 'workflow', 'admin', 'other',
]);

export const ComplexitySchema = z.enum(['simple', 'moderate', 'complex']);

export const AccessLevelSchema = z.enum(['full', 'read', 'none', 'conditional']);

export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'DELETE']);

export const ColumnTypeSchema = z.enum([
  'uuid', 'string', 'text', 'integer', 'decimal',
  'boolean', 'timestamp', 'json',
]);

export const ComponentTypeSchema = z.enum([
  'table', 'form', 'chart', 'card',
  'stat-widget', 'modal', 'list',
]);

export const PageLayoutSchema = z.enum([
  'dashboard', 'form', 'list-detail', 'auth', 'settings',
]);

export const SeveritySchema = z.enum(['error', 'warning', 'info']);

export const ValidationTierSchema = z.enum(['structural', 'cross_layer', 'semantic']);

export const RepairStrategySchema = z.enum(['auto_fix', 'regenerate', 'escalate']);

export const RefRelationSchema = z.enum(['consumes', 'persists_to', 'guarded_by']);

export const LayerSchema = z.enum(['ui', 'api', 'db', 'auth']);

export const LayerWithIntentSchema = z.enum(['ui', 'api', 'db', 'auth', 'intent']);

// ─── Shared Field Schemas ────────────────────────────────────────────────────

export const FieldSpecSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
});

// ─── Artifact 1: ExtractionResult ───────────────────────────────────────────

export const ExtractedRequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: RequirementCategorySchema,
  priority: z.enum(['must', 'should', 'nice']),
});

export const ExtractionResultSchema = z.object({
  rawPrompt: z.string(),
  complexity: ComplexitySchema,
  requirements: z.array(ExtractedRequirementSchema),
});

// ─── Artifact 3: AssumptionLedgerEntry (defined before EnrichmentResult) ────

export const AssumptionLedgerEntrySchema = z.object({
  id: z.string(),
  assumption: z.string(),
  reason: z.string(),
  alternative: z.string(),
  confidence: z.number().min(0).max(1),
  relatedRequirements: z.array(z.string()),
});

// ─── Artifact 2: EnrichmentResult ───────────────────────────────────────────

export const EnrichedRequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: RequirementCategorySchema,
  source: z.enum(['explicit', 'inferred']),
  inferredFrom: z.string().optional(),
});

export const ConflictEntrySchema = z.object({
  id: z.string(),
  requirementIds: z.array(z.string()),
  description: z.string(),
  severity: SeveritySchema,
  suggestedResolution: z.string(),
});

export const EnrichmentResultSchema = z.object({
  requirements: z.array(EnrichedRequirementSchema),
  assumptions: z.array(AssumptionLedgerEntrySchema),
  conflicts: z.array(ConflictEntrySchema),
});

// ─── Artifact 4: IntentIR ───────────────────────────────────────────────────

export const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: FeatureCategorySchema,
  sourceRequirementIds: z.array(z.string()),
  gatedBy: z.string().optional(),
});

export const DomainEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceRequirementIds: z.array(z.string()),
});

export const BusinessRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  sourceRequirementIds: z.array(z.string()),
});

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  sourceRequirementIds: z.array(z.string()),
});

export const IntentIRSchema = z.object({
  appName: z.string(),
  description: z.string(),
  features: z.array(FeatureSchema),
  entities: z.array(DomainEntitySchema),
  roles: z.array(RoleSchema),
  businessRules: z.array(BusinessRuleSchema),
  assumptions: z.array(AssumptionLedgerEntrySchema),
  ambiguities: z.array(z.string()),
  conflicts: z.array(z.string()),
});

// ─── Artifact 5: AppGraphIR ────────────────────────────────────────────────

export const ComponentNodeSchema = z.object({
  id: z.string(),
  type: ComponentTypeSchema,
  dataSource: z.string().optional(),
});

export const PageNodeSchema = z.object({
  id: z.string(),
  route: z.string(),
  title: z.string(),
  layout: PageLayoutSchema,
  components: z.array(ComponentNodeSchema),
  requiredAuth: z.boolean(),
  requiredRoles: z.array(z.string()),
  dataBindings: z.array(z.string()),
  sourceFeatureId: z.string(),
});

export const EndpointNodeSchema = z.object({
  id: z.string(),
  method: HttpMethodSchema,
  path: z.string(),
  description: z.string(),
  requestBody: z.array(FieldSpecSchema).optional(),
  responseBody: z.array(FieldSpecSchema),
  auth: z.object({
    required: z.boolean(),
    roles: z.array(z.string()).optional(),
  }),
  sourceEntityId: z.string(),
});

export const ColumnSpecSchema = z.object({
  name: z.string(),
  type: ColumnTypeSchema,
  nullable: z.boolean(),
  unique: z.boolean(),
  defaultValue: z.string().optional(),
});

export const ForeignKeySpecSchema = z.object({
  column: z.string(),
  referencesTable: z.string(),
  referencesColumn: z.string(),
  onDelete: z.enum(['cascade', 'set_null', 'restrict']),
});

export const DataModelNodeSchema = z.object({
  id: z.string(),
  tableName: z.string(),
  columns: z.array(ColumnSpecSchema),
  primaryKey: z.string(),
  foreignKeys: z.array(ForeignKeySpecSchema),
  timestamps: z.boolean(),
  sourceEntityId: z.string(),
});

export const PlanGateRuleSchema = z.object({
  plan: z.string(),
  gatedFeatures: z.array(z.string()),
});

export const AuthConfigSchema = z.object({
  strategy: z.enum(['jwt', 'session']),
  providers: z.array(z.enum(['email', 'google', 'github'])),
  roles: z.array(z.string()),
  planGating: z.array(PlanGateRuleSchema),
});

export const AppGraphIRSchema = z.object({
  pages: z.array(PageNodeSchema),
  apiEndpoints: z.array(EndpointNodeSchema),
  dataModels: z.array(DataModelNodeSchema),
  authConfig: AuthConfigSchema,
});

// ─── Artifact 6: FinalAppSpec ──────────────────────────────────────────────

export const CrossReferenceSchema = z.object({
  sourceLayer: LayerSchema,
  sourceId: z.string(),
  targetLayer: LayerSchema,
  targetId: z.string(),
  relation: RefRelationSchema,
});

export const SpecMetadataSchema = z.object({
  appName: z.string(),
  generatedAt: z.string(),
  pipelineVersion: z.string(),
  promptHash: z.string(),
  complexity: ComplexitySchema,
  totalFeatures: z.number(),
  totalEndpoints: z.number(),
  totalTables: z.number(),
  totalPages: z.number(),
});

// ─── Artifact 7: ValidationIssue ───────────────────────────────────────────

export const AffectedComponentSchema = z.object({
  layer: LayerWithIntentSchema,
  id: z.string(),
});

export const ValidationIssueSchema = z.object({
  id: z.string(),
  tier: ValidationTierSchema,
  severity: SeveritySchema,
  code: z.string(),
  message: z.string(),
  affectedComponents: z.array(AffectedComponentSchema),
  suggestedFix: z.string(),
  autoFixable: z.boolean(),
});

// ─── Artifact 8: ValidationReport ──────────────────────────────────────────

export const ValidationSummarySchema = z.object({
  errors: z.number(),
  warnings: z.number(),
  infos: z.number(),
  autoFixable: z.number(),
});

export const ValidationReportSchema = z.object({
  status: z.enum(['passed', 'failed', 'passed_with_warnings']),
  issues: z.array(ValidationIssueSchema),
  summary: ValidationSummarySchema,
  checkedAt: z.string(),
  iterationCount: z.number(),
});

// ─── Artifact 9: RepairPatchLog ────────────────────────────────────────────

export const RepairPatchSchema = z.object({
  targetIssueId: z.string(),
  strategy: RepairStrategySchema,
  targetLayer: LayerSchema,
  targetId: z.string(),
  description: z.string(),
  applied: z.boolean(),
});

export const RepairPatchLogSchema = z.object({
  iteration: z.number(),
  patches: z.array(RepairPatchSchema),
  preRepairErrors: z.number(),
  postRepairErrors: z.number(),
  timestamp: z.string(),
});

// ─── FinalAppSpec (assembled after validation schemas are defined) ──────────

export const FinalAppSpecSchema = z.object({
  metadata: SpecMetadataSchema,
  intentIR: IntentIRSchema,
  appGraphIR: AppGraphIRSchema,
  crossReferences: z.array(CrossReferenceSchema),
  assumptions: z.array(AssumptionLedgerEntrySchema),
  conflicts: z.array(ConflictEntrySchema),
  validation: ValidationReportSchema,
  repairLog: z.array(RepairPatchLogSchema),
});

// ─── Pipeline Execution Schemas ────────────────────────────────────────────

export const StageTraceSchema = z.object({
  stage: z.string(),
  name: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number(),
  status: z.enum(['success', 'error']),
  error: z.string().optional(),
});

export const PipelineArtifactsSchema = z.object({
  extraction: ExtractionResultSchema,
  enrichment: EnrichmentResultSchema,
  intentIR: IntentIRSchema,
  appGraphIR: AppGraphIRSchema,
  appSpec: FinalAppSpecSchema,
});

export const PipelineResultSchema = z.object({
  runId: z.string(),
  rawPrompt: z.string(),
  traces: z.array(StageTraceSchema),
  artifacts: PipelineArtifactsSchema,
  totalDurationMs: z.number(),
});

// ─── LLM-facing subsets ────────────────────────────────────────────────────
// These are the schemas used as structured-output targets in LLM calls.
// They omit fields the LLM shouldn't generate (e.g., rawPrompt is injected by P1).

/** P1 target: LLM returns only complexity + requirements, rawPrompt is injected */
export const P1_LLMOutputSchema = z.object({
  complexity: ComplexitySchema,
  requirements: z.array(ExtractedRequirementSchema),
});

/** P2 target: LLM returns enriched requirements + assumptions + conflicts */
export const P2_LLMOutputSchema = EnrichmentResultSchema;

/** P3 target: LLM returns the full IntentIR */
export const P3_LLMOutputSchema = IntentIRSchema;

/** P4 target: LLM returns the full AppGraphIR */
export const P4_LLMOutputSchema = AppGraphIRSchema;
