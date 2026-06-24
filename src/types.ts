// ─── Shared Enums ────────────────────────────────────────────────────────────

export type RequirementCategory =
  | 'auth'
  | 'authorization'
  | 'data_entity'
  | 'ui_view'
  | 'api_action'
  | 'business_rule'
  | 'integration'
  | 'infrastructure';

export type FeatureCategory =
  | 'auth'
  | 'dashboard'
  | 'crud'
  | 'analytics'
  | 'integration'
  | 'billing'
  | 'workflow'
  | 'admin'
  | 'other';

export type Complexity = 'simple' | 'moderate' | 'complex';

export type AccessLevel = 'full' | 'read' | 'none' | 'conditional';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type ColumnType =
  | 'uuid' | 'string' | 'text' | 'integer' | 'decimal'
  | 'boolean' | 'timestamp' | 'json';

export type ComponentType =
  | 'table' | 'form' | 'chart' | 'card'
  | 'stat-widget' | 'modal' | 'list';

export type PageLayout =
  | 'dashboard' | 'form' | 'list-detail'
  | 'auth' | 'settings';

export type Severity = 'error' | 'warning' | 'info';

export type ValidationTier = 'structural' | 'cross_layer' | 'semantic';

export type RepairStrategy = 'auto_fix' | 'regenerate' | 'escalate';

export type RefRelation = 'consumes' | 'persists_to' | 'guarded_by';

// ─── Shared Field Types ──────────────────────────────────────────────────────

export interface FieldSpec {
  name: string;
  type: string;
  required: boolean;
}

// ─── Artifact 1: ExtractionResult (P1) ──────────────────────────────────────

export interface ExtractedRequirement {
  id: string;
  text: string;
  category: RequirementCategory;
  priority: 'must' | 'should' | 'nice';
}

export interface ExtractionResult {
  rawPrompt: string;
  complexity: Complexity;
  requirements: ExtractedRequirement[];
}

// ─── Artifact 2: EnrichmentResult (P2) ──────────────────────────────────────

export interface EnrichedRequirement {
  id: string;
  text: string;
  category: RequirementCategory;
  source: 'explicit' | 'inferred';
  inferredFrom?: string; // ID of the original requirement that triggered inference
}

export interface ConflictEntry {
  id: string;
  requirementIds: string[];
  description: string;
  severity: Severity;
  suggestedResolution: string;
}

export interface EnrichmentResult {
  requirements: EnrichedRequirement[];
  assumptions: AssumptionLedgerEntry[];
  conflicts: ConflictEntry[];
}

// ─── Artifact 3: AssumptionLedgerEntry (P2) ─────────────────────────────────

export interface AssumptionLedgerEntry {
  id: string;
  assumption: string;
  reason: string;
  alternative: string;
  confidence: number; // 0.0 – 1.0
  relatedRequirements: string[];
}

// ─── Artifact 4: IntentIR (P3) ─────────────────────────────────────────────

export interface Feature {
  id: string;
  name: string;
  category: FeatureCategory;
  sourceRequirementIds: string[];
  gatedBy?: string;
}

export interface DomainEntity {
  id: string;
  name: string;
  sourceRequirementIds: string[];
}

export interface BusinessRule {
  id: string;
  description: string;
  sourceRequirementIds: string[];
}

export interface Role {
  id: string;
  name: string;
  description: string;
  sourceRequirementIds: string[];
}

export interface IntentIR {
  appName: string;
  description: string;
  features: Feature[];
  entities: DomainEntity[];
  roles: Role[];
  businessRules: BusinessRule[];
  assumptions: AssumptionLedgerEntry[];
  ambiguities: string[];
  conflicts: string[];
}

// ─── Artifact 5: AppGraphIR (P4) ───────────────────────────────────────────

// UI layer
export interface ComponentNode {
  id: string;
  type: ComponentType;
  dataSource?: string; // endpoint ID
}

export interface PageNode {
  id: string;
  route: string;
  title: string;
  layout: PageLayout;
  components: ComponentNode[];
  requiredAuth: boolean;
  requiredRoles: string[];
  dataBindings: string[];    // endpoint IDs this page consumes
  sourceFeatureId: string;   // ← traceability to IntentIR
}

// API layer
export interface EndpointNode {
  id: string;
  method: HttpMethod;
  path: string;
  description: string;
  requestBody?: FieldSpec[];
  responseBody: FieldSpec[];
  auth: {
    required: boolean;
    roles?: string[];
  };
  sourceEntityId: string; // ← traceability to IntentIR
}

// DB layer
export interface ColumnSpec {
  name: string;
  type: ColumnType;
  nullable: boolean;
  unique: boolean;
  defaultValue?: string;
}

export interface ForeignKeySpec {
  column: string;
  referencesTable: string;
  referencesColumn: string;
  onDelete: 'cascade' | 'set_null' | 'restrict';
}

export interface DataModelNode {
  id: string;
  tableName: string;
  columns: ColumnSpec[];
  primaryKey: string;
  foreignKeys: ForeignKeySpec[];
  timestamps: boolean;
  sourceEntityId: string; // ← traceability to IntentIR
}

// Auth layer
export interface PlanGateRule {
  plan: string;
  gatedFeatures: string[];
}

export interface AuthConfig {
  strategy: 'jwt' | 'session';
  providers: ('email' | 'google' | 'github')[];
  roles: string[];
  planGating: PlanGateRule[];
}

// Root
export interface AppGraphIR {
  pages: PageNode[];
  apiEndpoints: EndpointNode[];
  dataModels: DataModelNode[];
  authConfig: AuthConfig;
}

// ─── Artifact 6: FinalAppSpec (P5 assembly) ────────────────────────────────

export interface CrossReference {
  sourceLayer: 'ui' | 'api' | 'db' | 'auth';
  sourceId: string;
  targetLayer: 'ui' | 'api' | 'db' | 'auth';
  targetId: string;
  relation: RefRelation;
}

export interface SpecMetadata {
  appName: string;
  generatedAt: string;
  pipelineVersion: string;
  promptHash: string;
  complexity: Complexity;
  totalFeatures: number;
  totalEndpoints: number;
  totalTables: number;
  totalPages: number;
}

export interface FinalAppSpec {
  metadata: SpecMetadata;
  intentIR: IntentIR;
  appGraphIR: AppGraphIR;
  crossReferences: CrossReference[];
  assumptions: AssumptionLedgerEntry[];
  conflicts: ConflictEntry[];
  validation: ValidationReport;
  repairLog: RepairPatchLog[];
}

// ─── Artifact 7: ValidationIssue (P6) ──────────────────────────────────────

export interface AffectedComponent {
  layer: 'ui' | 'api' | 'db' | 'auth' | 'intent';
  id: string;
}

export interface ValidationIssue {
  id: string;
  tier: ValidationTier;
  severity: Severity;
  code: string; // machine-readable: "BROKEN_DATA_BINDING", etc.
  message: string;
  affectedComponents: AffectedComponent[];
  suggestedFix: string;
  autoFixable: boolean;
}

// ─── Artifact 8: ValidationReport (P6) ─────────────────────────────────────

export interface ValidationSummary {
  errors: number;
  warnings: number;
  infos: number;
  autoFixable: number;
}

export interface ValidationReport {
  status: 'passed' | 'failed' | 'passed_with_warnings';
  issues: ValidationIssue[];
  summary: ValidationSummary;
  checkedAt: string;
  iterationCount: number;
}

// ─── Artifact 9: RepairPatchLog (P7) ───────────────────────────────────────

export interface RepairPatch {
  targetIssueId: string;
  strategy: RepairStrategy;
  targetLayer: 'ui' | 'api' | 'db' | 'auth';
  targetId: string;
  description: string;
  applied: boolean;
}

export interface RepairPatchLog {
  iteration: number;
  patches: RepairPatch[];
  preRepairErrors: number;
  postRepairErrors: number;
  timestamp: string;
}

// ─── Pipeline Execution Types ──────────────────────────────────────────────

export interface StageTrace {
  stage: string;     // "P1_EXTRACT", "P2_ENRICH", etc.
  name: string;      // "Requirement Extraction"
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'success' | 'error';
  error?: string;
}

/** All intermediate artifacts from a pipeline run, keyed by stage */
export interface PipelineArtifacts {
  extraction: ExtractionResult;
  enrichment: EnrichmentResult;
  intentIR: IntentIR;
  appGraphIR: AppGraphIR;
  appSpec: FinalAppSpec;
}

/** Complete result of a full pipeline run */
export interface PipelineResult {
  runId: string;
  rawPrompt: string;
  traces: StageTrace[];
  artifacts: PipelineArtifacts;
  totalDurationMs: number;
}
