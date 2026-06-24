import type {
  FinalAppSpec,
  ValidationIssue,
  ValidationReport,
  ValidationSummary,
  AffectedComponent,
  Feature,
} from '../types';

// ─── P6: Validation Engine (deterministic) ──────────────────────────────────

/**
 * P6: Run deterministic validation rules against a FinalAppSpec.
 *
 * Three tiers of checks:
 *   A) Structural — broken references between layers
 *   B) Cross-layer — feature coverage completeness
 *   C) Logical — semantic consistency
 *
 * Returns a ValidationReport with machine-readable issue codes.
 * No LLM calls — pure rule evaluation.
 */
export function validateSpec(
  spec: FinalAppSpec,
  iteration: number = 1
): ValidationReport {
  const issues: ValidationIssue[] = [];
  let issueCounter = 0;

  function emit(
    tier: ValidationIssue['tier'],
    severity: ValidationIssue['severity'],
    code: string,
    message: string,
    affected: AffectedComponent[],
    suggestedFix: string,
    autoFixable: boolean
  ): void {
    issueCounter++;
    issues.push({
      id: `val_${String(issueCounter).padStart(3, '0')}`,
      tier,
      severity,
      code,
      message,
      affectedComponents: affected,
      suggestedFix,
      autoFixable,
    });
  }

  const { intentIR, appGraphIR } = spec;
  const featureIds = new Set(intentIR.features.map((f) => f.id));
  const entityIds = new Set(intentIR.entities.map((e) => e.id));
  const endpointIds = new Set(appGraphIR.apiEndpoints.map((ep) => ep.id));
  const modelEntityIds = new Set(appGraphIR.dataModels.map((m) => m.sourceEntityId));
  const pageFeatureIds = new Set(appGraphIR.pages.map((p) => p.sourceFeatureId));

  // ─── A) Structural validation ───────────────────────────────────────────

  // A1: Page dataBindings must reference existing endpoints
  for (const page of appGraphIR.pages) {
    for (const binding of page.dataBindings) {
      if (!endpointIds.has(binding)) {
        emit(
          'structural', 'error', 'PAGE_MISSING_ENDPOINT',
          `Page "${page.id}" references endpoint "${binding}" which does not exist`,
          [{ layer: 'ui', id: page.id }, { layer: 'api', id: binding }],
          `Remove broken binding or create the missing endpoint "${binding}"`,
          true
        );
      }
    }
  }

  // A2: Page sourceFeatureId must reference an existing feature
  for (const page of appGraphIR.pages) {
    if (!featureIds.has(page.sourceFeatureId)) {
      emit(
        'structural', 'error', 'PAGE_UNKNOWN_FEATURE',
        `Page "${page.id}" references feature "${page.sourceFeatureId}" which does not exist`,
        [{ layer: 'ui', id: page.id }, { layer: 'intent', id: page.sourceFeatureId }],
        `Update page sourceFeatureId to reference a valid feature`,
        false
      );
    }
  }

  // A3: Endpoint sourceEntityId must reference an existing entity (when non-empty)
  for (const ep of appGraphIR.apiEndpoints) {
    if (ep.sourceEntityId && !entityIds.has(ep.sourceEntityId)) {
      emit(
        'structural', 'error', 'ENDPOINT_UNKNOWN_ENTITY',
        `Endpoint "${ep.id}" references entity "${ep.sourceEntityId}" which does not exist`,
        [{ layer: 'api', id: ep.id }, { layer: 'intent', id: ep.sourceEntityId }],
        `Update endpoint sourceEntityId to reference a valid entity or clear it`,
        false
      );
    }
  }

  // A4: DataModel sourceEntityId must reference an existing entity
  for (const model of appGraphIR.dataModels) {
    if (!entityIds.has(model.sourceEntityId)) {
      emit(
        'structural', 'error', 'MODEL_UNKNOWN_ENTITY',
        `Data model "${model.id}" references entity "${model.sourceEntityId}" which does not exist`,
        [{ layer: 'db', id: model.id }, { layer: 'intent', id: model.sourceEntityId }],
        `Update model sourceEntityId to reference a valid entity`,
        false
      );
    }
  }

  // A5: AuthConfig planGating must reference real feature IDs
  for (const gate of appGraphIR.authConfig.planGating) {
    for (const featId of gate.gatedFeatures) {
      if (!featureIds.has(featId)) {
        emit(
          'structural', 'warning', 'AUTH_GATE_UNKNOWN_FEATURE',
          `Plan gate "${gate.plan}" references feature "${featId}" which does not exist`,
          [{ layer: 'auth', id: 'auth_config' }, { layer: 'intent', id: featId }],
          `Remove unknown feature from plan gate or create the missing feature`,
          false
        );
      }
    }
  }

  // ─── B) Cross-layer consistency ─────────────────────────────────────────

  // B1: CRUD features should have at least one page, one endpoint, and one data model
  const crudFeatures = intentIR.features.filter((f) => f.category === 'crud');
  for (const feat of crudFeatures) {
    const hasPage = appGraphIR.pages.some((p) => p.sourceFeatureId === feat.id);
    const hasEndpoint = appGraphIR.apiEndpoints.some((ep) =>
      ep.path.includes(extractEntitySlug(feat))
    );
    const hasModel = appGraphIR.dataModels.some((m) =>
      m.tableName.includes(extractEntitySlug(feat))
    );

    if (!hasPage) {
      emit(
        'cross_layer', 'error', 'CRUD_MISSING_PAGE',
        `CRUD feature "${feat.name}" has no corresponding page`,
        [{ layer: 'intent', id: feat.id }],
        `Create a list/detail page for "${feat.name}"`,
        true
      );
    }
    if (!hasEndpoint) {
      emit(
        'cross_layer', 'error', 'CRUD_MISSING_ENDPOINT',
        `CRUD feature "${feat.name}" has no corresponding API endpoints`,
        [{ layer: 'intent', id: feat.id }],
        `Create CRUD endpoints for "${feat.name}"`,
        true
      );
    }
    if (!hasModel) {
      emit(
        'cross_layer', 'warning', 'CRUD_MISSING_MODEL',
        `CRUD feature "${feat.name}" has no corresponding data model`,
        [{ layer: 'intent', id: feat.id }],
        `Create a data model for "${feat.name}"`,
        true
      );
    }
  }

  // B2: Auth feature should have login page + auth endpoints
  const authFeatures = intentIR.features.filter((f) => f.category === 'auth');
  for (const feat of authFeatures) {
    const hasLoginPage = appGraphIR.pages.some(
      (p) => p.route.includes('login') && p.sourceFeatureId === feat.id
    );
    const hasAuthEndpoint = appGraphIR.apiEndpoints.some(
      (ep) => ep.path.includes('/api/auth/')
    );

    if (!hasLoginPage) {
      emit(
        'cross_layer', 'error', 'AUTH_MISSING_LOGIN_PAGE',
        `Auth feature "${feat.name}" has no login page`,
        [{ layer: 'intent', id: feat.id }],
        `Create a login page for the auth feature`,
        true
      );
    }
    if (!hasAuthEndpoint) {
      emit(
        'cross_layer', 'error', 'AUTH_MISSING_ENDPOINTS',
        `Auth feature "${feat.name}" has no auth API endpoints`,
        [{ layer: 'intent', id: feat.id }],
        `Create login/register/logout endpoints`,
        true
      );
    }
  }

  // B3: Billing-gated features should have billing page + billing endpoints
  const billingFeatures = intentIR.features.filter((f) => f.category === 'billing');
  for (const feat of billingFeatures) {
    const hasBillingPage = appGraphIR.pages.some(
      (p) => p.route.includes('billing') || p.route.includes('subscription')
    );
    const hasBillingEndpoint = appGraphIR.apiEndpoints.some(
      (ep) => ep.path.includes('/api/billing/')
    );

    if (!hasBillingPage) {
      emit(
        'cross_layer', 'error', 'BILLING_MISSING_PAGE',
        `Billing feature "${feat.name}" has no billing page`,
        [{ layer: 'intent', id: feat.id }],
        `Create a billing/subscription page`,
        true
      );
    }
    if (!hasBillingEndpoint) {
      emit(
        'cross_layer', 'error', 'BILLING_MISSING_ENDPOINTS',
        `Billing feature "${feat.name}" has no billing API endpoints`,
        [{ layer: 'intent', id: feat.id }],
        `Create billing/subscription endpoints`,
        true
      );
    }
  }

  // B4: Dashboard/analytics feature should have dashboard page + endpoint
  const dashFeatures = intentIR.features.filter(
    (f) => f.category === 'dashboard' || f.category === 'analytics'
  );
  for (const feat of dashFeatures) {
    const hasDashPage = appGraphIR.pages.some(
      (p) => p.route.includes('dashboard') || p.layout === 'dashboard'
    );
    const hasDashEndpoint = appGraphIR.apiEndpoints.some(
      (ep) => ep.path.includes('dashboard') || ep.path.includes('analytics')
    );

    if (!hasDashPage) {
      emit(
        'cross_layer', 'error', 'DASHBOARD_MISSING_PAGE',
        `Dashboard feature "${feat.name}" has no dashboard page`,
        [{ layer: 'intent', id: feat.id }],
        `Create a dashboard page`,
        true
      );
    }
    if (!hasDashEndpoint) {
      emit(
        'cross_layer', 'error', 'DASHBOARD_MISSING_ENDPOINT',
        `Dashboard feature "${feat.name}" has no analytics/stats endpoint`,
        [{ layer: 'intent', id: feat.id }],
        `Create dashboard statistics endpoints`,
        true
      );
    }
  }

  // ─── C) Logical validation ──────────────────────────────────────────────

  // C1: Analytics/dashboard endpoints should require auth
  const dashEndpoints = appGraphIR.apiEndpoints.filter(
    (ep) => ep.path.includes('dashboard') || ep.path.includes('analytics')
  );
  for (const ep of dashEndpoints) {
    if (!ep.auth.required) {
      emit(
        'semantic', 'warning', 'ANALYTICS_MISSING_AUTH',
        `Analytics endpoint "${ep.path}" does not require authentication`,
        [{ layer: 'api', id: ep.id }],
        `Set auth.required = true on analytics endpoints`,
        true
      );
    }
  }

  // C2: Roles defined but no auth feature present
  if (intentIR.roles.length > 0) {
    const hasAuthFeature = intentIR.features.some((f) => f.category === 'auth');
    if (!hasAuthFeature) {
      emit(
        'semantic', 'warning', 'ROLES_WITHOUT_AUTH',
        `${intentIR.roles.length} roles are defined but no auth feature exists`,
        intentIR.roles.map((r) => ({ layer: 'intent' as const, id: r.id })),
        `Add an authentication feature to support role-based access`,
        false
      );
    }
  }

  // C3: Data models with foreign keys referencing non-existent tables
  const tableNames = new Set(appGraphIR.dataModels.map((m) => m.tableName));
  for (const model of appGraphIR.dataModels) {
    for (const fk of model.foreignKeys) {
      if (!tableNames.has(fk.referencesTable)) {
        emit(
          'semantic', 'warning', 'FK_UNKNOWN_TABLE',
          `Model "${model.tableName}" has FK referencing table "${fk.referencesTable}" which does not exist`,
          [{ layer: 'db', id: model.id }],
          `Create the referenced table or remove the foreign key`,
          false
        );
      }
    }
  }

  // ─── Rule A: ROLE_RULE_NOT_ENFORCED ───────────────────────────────────────
  const knownRoles = intentIR.roles.map((r) => r.name.toLowerCase());
  if (knownRoles.length > 0) {
    for (const rule of intentIR.businessRules) {
      const lower = rule.description.toLowerCase();
      for (const role of knownRoles) {
        const rolePlural = `${role}s`;
        if (lower.includes(role) || lower.includes(rolePlural)) {
          const matchedResources: { key: string; name: string }[] = [];
          if (lower.includes('analytic') || lower.includes('report') || lower.includes('dashboard')) {
            matchedResources.push({ key: 'analytics', name: 'Analytics' });
            matchedResources.push({ key: 'dashboard', name: 'Dashboard' });
          }
          if (lower.includes('order')) {
            matchedResources.push({ key: 'order', name: 'Order' });
          }
          if (lower.includes('invoice')) {
            matchedResources.push({ key: 'invoice', name: 'Invoice' });
          }
          if (lower.includes('contact')) {
            matchedResources.push({ key: 'contact', name: 'Contact' });
          }
          if (lower.includes('billing') || lower.includes('payment') || lower.includes('subscription')) {
            matchedResources.push({ key: 'billing', name: 'Billing' });
          }

          const isAccessControl = lower.includes('can') ||
            lower.includes('access') ||
            lower.includes('see') ||
            lower.includes('view') ||
            lower.includes('edit') ||
            lower.includes('only') ||
            lower.includes('restrict') ||
            lower.includes('allow') ||
            lower.includes('role');

          if (isAccessControl && matchedResources.length > 0) {
            for (const res of matchedResources) {
              const matchedPages = appGraphIR.pages.filter(
                (p) => p.route.includes(res.key) || p.title.toLowerCase().includes(res.key) || p.layout === res.key
              );
              const matchedEndpoints = appGraphIR.apiEndpoints.filter(
                (ep) => ep.path.toLowerCase().includes(res.key)
              );

              const pageEnforced = matchedPages.some((p) => p.requiredRoles.includes(role));
              const endpointEnforced = matchedEndpoints.some((ep) => ep.auth.roles?.includes(role));

              const hasPagesOrEndpoints = matchedPages.length > 0 || matchedEndpoints.length > 0;
              if (hasPagesOrEndpoints && !pageEnforced && !endpointEnforced) {
                emit(
                  'semantic', 'warning', 'ROLE_RULE_NOT_ENFORCED',
                  `${res.name} is role-restricted in intent but AppGraph does not enforce ${role}-only access.`,
                  [
                    { layer: 'intent', id: rule.id },
                    ...matchedPages.map((p) => ({ layer: 'ui' as const, id: p.id })),
                    ...matchedEndpoints.map((ep) => ({ layer: 'api' as const, id: ep.id })),
                  ],
                  `Configure requiredRoles on ${res.name} pages and auth.roles on ${res.name} endpoints to include "${role}"`,
                  false
                );
              }
            }
          }
        }
      }
    }
  }

  // ─── Rule B: BILLING_MISSING_MODEL ────────────────────────────────────────
  const hasBillingFeature = intentIR.features.some((f) => f.category === 'billing');
  const hasBillingEndpoints = appGraphIR.apiEndpoints.some(
    (ep) => ep.path.includes('/api/billing') || ep.path.includes('subscribe') || ep.path.includes('cancel') || ep.path.includes('subscription')
  );

  if (hasBillingFeature || hasBillingEndpoints) {
    const billingTables = ['subscriptions', 'payments', 'plans', 'billing_accounts'];
    const hasBillingModel = appGraphIR.dataModels.some((m) =>
      billingTables.includes(m.tableName.toLowerCase())
    );

    if (!hasBillingModel) {
      const billingFeat = intentIR.features.find((f) => f.category === 'billing');
      const billingEp = appGraphIR.apiEndpoints.find((ep) => ep.path.includes('billing'));
      emit(
        'cross_layer', 'warning', 'BILLING_MISSING_MODEL',
        `Billing features or endpoints exist, but no supporting billing data model is defined.`,
        [
          ...(billingFeat ? [{ layer: 'intent' as const, id: billingFeat.id }] : []),
          ...(billingEp ? [{ layer: 'api' as const, id: billingEp.id }] : []),
        ],
        `Create a data model table for billing (e.g., subscriptions, payments, or billing_accounts)`,
        false
      );
    }
  }

  // ─── Build report ───────────────────────────────────────────────────────

  const summary: ValidationSummary = {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
    autoFixable: issues.filter((i) => i.autoFixable).length,
  };

  const status: ValidationReport['status'] =
    summary.errors > 0 ? 'failed'
      : summary.warnings > 0 ? 'passed_with_warnings'
      : 'passed';

  return {
    status,
    issues,
    summary,
    checkedAt: new Date().toISOString(),
    iterationCount: iteration,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractEntitySlug(feat: Feature): string {
  return feat.name.replace(/-management$|-tracking$|-crud$/, '');
}
