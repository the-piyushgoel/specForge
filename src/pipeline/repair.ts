import type {
  FinalAppSpec,
  ValidationIssue,
  RepairPatch,
  RepairPatchLog,
  PageNode,
  EndpointNode,
  DataModelNode,
  ComponentNode,
  ColumnSpec,
  ColumnType,
} from '../types';

// ─── P7: Repair Engine (deterministic) ──────────────────────────────────────

/**
 * P7: Apply deterministic repairs to a FinalAppSpec based on validation issues.
 *
 * Targets only auto-fixable issues with known repair strategies.
 * Returns a new (patched) FinalAppSpec and a repair log.
 *
 * No LLM calls — pure targeted patching.
 */
export function repairSpec(
  spec: FinalAppSpec,
  issues: ValidationIssue[],
  iteration: number
): { repairedSpec: FinalAppSpec; patchLog: RepairPatchLog } {
  const autoFixable = issues.filter((i) => i.autoFixable);
  const patches: RepairPatch[] = [];

  // Deep clone the mutable parts of the spec
  const pages = [...spec.appGraphIR.pages.map((p) => ({ ...p, dataBindings: [...p.dataBindings], components: [...p.components] }))];
  const endpoints = [...spec.appGraphIR.apiEndpoints.map((ep) => ({ ...ep, auth: { ...ep.auth } }))];
  const models = [...spec.appGraphIR.dataModels.map((m) => ({ ...m, columns: [...m.columns], foreignKeys: [...m.foreignKeys] }))];
  const authConfig = {
    ...spec.appGraphIR.authConfig,
    planGating: [...spec.appGraphIR.authConfig.planGating],
  };

  for (const issue of autoFixable) {
    const patch = applyRepair(issue, pages, endpoints, models, spec);
    if (patch) {
      patches.push(patch);
    }
  }

  const preRepairErrors = issues.filter((i) => i.severity === 'error').length;

  const repairedSpec: FinalAppSpec = {
    ...spec,
    appGraphIR: {
      pages,
      apiEndpoints: endpoints,
      dataModels: models,
      authConfig,
    },
  };

  const patchLog: RepairPatchLog = {
    iteration,
    patches,
    preRepairErrors,
    postRepairErrors: -1, // will be filled by re-validation
    timestamp: new Date().toISOString(),
  };

  return { repairedSpec, patchLog };
}

// ─── Repair dispatch ─────────────────────────────────────────────────────────

function applyRepair(
  issue: ValidationIssue,
  pages: PageNode[],
  endpoints: EndpointNode[],
  models: DataModelNode[],
  spec: FinalAppSpec
): RepairPatch | null {
  switch (issue.code) {
    case 'PAGE_MISSING_ENDPOINT':
      return repairBrokenDataBinding(issue, pages, endpoints);

    case 'CRUD_MISSING_PAGE':
      return repairMissingCrudPage(issue, pages, endpoints, spec);

    case 'CRUD_MISSING_ENDPOINT':
      return repairMissingCrudEndpoints(issue, endpoints, spec);

    case 'CRUD_MISSING_MODEL':
      return repairMissingCrudModel(issue, models, spec);

    case 'AUTH_MISSING_LOGIN_PAGE':
      return repairMissingAuthPage(issue, pages, endpoints);

    case 'AUTH_MISSING_ENDPOINTS':
      return repairMissingAuthEndpoints(issue, endpoints);

    case 'BILLING_MISSING_PAGE':
      return repairMissingBillingPage(issue, pages, endpoints);

    case 'BILLING_MISSING_ENDPOINTS':
      return repairMissingBillingEndpoints(issue, endpoints);

    case 'DASHBOARD_MISSING_PAGE':
      return repairMissingDashboardPage(issue, pages, endpoints);

    case 'DASHBOARD_MISSING_ENDPOINT':
      return repairMissingDashboardEndpoints(issue, endpoints);

    case 'ANALYTICS_MISSING_AUTH':
      return repairAnalyticsAuth(issue, endpoints);

    default:
      return null;
  }
}

// ─── Individual repair handlers ──────────────────────────────────────────────

function repairBrokenDataBinding(
  issue: ValidationIssue,
  pages: PageNode[],
  endpoints: EndpointNode[]
): RepairPatch | null {
  // Find the page and remove the broken binding
  const pageComp = issue.affectedComponents.find((c) => c.layer === 'ui');
  const brokenEpComp = issue.affectedComponents.find((c) => c.layer === 'api');
  if (!pageComp || !brokenEpComp) return null;

  const page = pages.find((p) => p.id === pageComp.id);
  if (!page) return null;

  // Try to find a matching endpoint by similar path pattern
  const brokenId = brokenEpComp.id;
  const matchingEp = endpoints.find((ep) => ep.id === brokenId);

  if (matchingEp) {
    // Endpoint exists, binding just wasn't connected — no fix needed
    return null;
  }

  // Remove the broken binding
  page.dataBindings = page.dataBindings.filter((b) => b !== brokenId);

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'ui',
    targetId: pageComp.id,
    description: `Removed broken data binding "${brokenId}" from page "${pageComp.id}"`,
    applied: true,
  };
}

function repairMissingCrudPage(
  issue: ValidationIssue,
  pages: PageNode[],
  endpoints: EndpointNode[],
  spec: FinalAppSpec
): RepairPatch | null {
  const featComp = issue.affectedComponents.find((c) => c.layer === 'intent');
  if (!featComp) return null;

  const feat = spec.intentIR.features.find((f) => f.id === featComp.id);
  if (!feat) return null;

  const entityName = feat.name.replace(/-management$|-tracking$|-crud$/, '');
  const plural = `${entityName}s`;
  const listBindings = endpoints
    .filter((ep) => ep.path === `/api/${plural}`)
    .map((ep) => ep.id);

  pages.push({
    id: `page_${entityName}_list`,
    route: `/${plural}`,
    title: capitalize(plural),
    layout: 'list-detail',
    components: [{ id: `${entityName}_table`, type: 'table' }],
    requiredAuth: true,
    requiredRoles: [],
    dataBindings: listBindings,
    sourceFeatureId: feat.id,
  });

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'ui',
    targetId: `page_${entityName}_list`,
    description: `Created list page for CRUD feature "${feat.name}"`,
    applied: true,
  };
}

function repairMissingCrudEndpoints(
  issue: ValidationIssue,
  endpoints: EndpointNode[],
  spec: FinalAppSpec
): RepairPatch | null {
  const featComp = issue.affectedComponents.find((c) => c.layer === 'intent');
  if (!featComp) return null;

  const feat = spec.intentIR.features.find((f) => f.id === featComp.id);
  if (!feat) return null;

  const entityName = feat.name.replace(/-management$|-tracking$|-crud$/, '');
  const plural = `${entityName}s`;
  const entity = spec.intentIR.entities.find((e) => e.name === entityName);
  const entityId = entity?.id ?? '';

  const newEndpoints: EndpointNode[] = [
    ep(`ep_${entityName}_list`, 'GET', `/api/${plural}`, `List ${plural}`, entityId),
    ep(`ep_${entityName}_get`, 'GET', `/api/${plural}/:id`, `Get ${entityName}`, entityId),
    ep(`ep_${entityName}_create`, 'POST', `/api/${plural}`, `Create ${entityName}`, entityId),
    ep(`ep_${entityName}_update`, 'PUT', `/api/${plural}/:id`, `Update ${entityName}`, entityId),
    ep(`ep_${entityName}_delete`, 'DELETE', `/api/${plural}/:id`, `Delete ${entityName}`, entityId),
  ];

  // Only add endpoints that don't already exist
  const existingIds = new Set(endpoints.map((e) => e.id));
  for (const ne of newEndpoints) {
    if (!existingIds.has(ne.id)) {
      endpoints.push(ne);
    }
  }

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'api',
    targetId: `ep_${entityName}_*`,
    description: `Created CRUD endpoints for feature "${feat.name}"`,
    applied: true,
  };
}

function repairMissingCrudModel(
  issue: ValidationIssue,
  models: DataModelNode[],
  spec: FinalAppSpec
): RepairPatch | null {
  const featComp = issue.affectedComponents.find((c) => c.layer === 'intent');
  if (!featComp) return null;

  const feat = spec.intentIR.features.find((f) => f.id === featComp.id);
  if (!feat) return null;

  const entityName = feat.name.replace(/-management$|-tracking$|-crud$/, '');
  const entity = spec.intentIR.entities.find((e) => e.name === entityName);
  if (!entity) return null;

  const existing = models.find((m) => m.sourceEntityId === entity.id);
  if (existing) return null;

  models.push({
    id: `model_${entityName}`,
    tableName: `${entityName}s`,
    columns: [
      colSpec('id', 'uuid', false, true),
      colSpec('name', 'string', false, false),
    ],
    primaryKey: 'id',
    foreignKeys: [],
    timestamps: true,
    sourceEntityId: entity.id,
  });

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'db',
    targetId: `model_${entityName}`,
    description: `Created data model for "${entityName}"`,
    applied: true,
  };
}

function repairMissingAuthPage(
  issue: ValidationIssue,
  pages: PageNode[],
  endpoints: EndpointNode[]
): RepairPatch | null {
  const featComp = issue.affectedComponents.find((c) => c.layer === 'intent');
  if (!featComp) return null;

  const loginBindings = endpoints
    .filter((ep) => ep.path === '/api/auth/login')
    .map((ep) => ep.id);

  pages.push({
    id: 'page_login',
    route: '/login',
    title: 'Login',
    layout: 'auth',
    components: [{ id: 'login_form', type: 'form' }],
    requiredAuth: false,
    requiredRoles: [],
    dataBindings: loginBindings,
    sourceFeatureId: featComp.id,
  });

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'ui',
    targetId: 'page_login',
    description: 'Created login page for auth feature',
    applied: true,
  };
}

function repairMissingAuthEndpoints(
  issue: ValidationIssue,
  endpoints: EndpointNode[]
): RepairPatch | null {
  const existingIds = new Set(endpoints.map((e) => e.id));
  const authEps: EndpointNode[] = [
    ep('ep_login', 'POST', '/api/auth/login', 'User login', '', false),
    ep('ep_register', 'POST', '/api/auth/register', 'User registration', '', false),
    ep('ep_logout', 'POST', '/api/auth/logout', 'User logout', ''),
    ep('ep_me', 'GET', '/api/auth/me', 'Get current user', ''),
  ];

  for (const ae of authEps) {
    if (!existingIds.has(ae.id)) {
      endpoints.push(ae);
    }
  }

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'api',
    targetId: 'ep_auth_*',
    description: 'Created auth endpoints (login, register, logout, me)',
    applied: true,
  };
}

function repairMissingBillingPage(
  issue: ValidationIssue,
  pages: PageNode[],
  endpoints: EndpointNode[]
): RepairPatch | null {
  const featComp = issue.affectedComponents.find((c) => c.layer === 'intent');
  if (!featComp) return null;

  const billingBindings = endpoints
    .filter((ep) => ep.path.includes('/api/billing/'))
    .map((ep) => ep.id);

  pages.push({
    id: 'page_billing',
    route: '/billing',
    title: 'Billing & Subscription',
    layout: 'settings',
    components: [{ id: 'plan_card', type: 'card' }, { id: 'payment_form', type: 'form' }],
    requiredAuth: true,
    requiredRoles: [],
    dataBindings: billingBindings,
    sourceFeatureId: featComp.id,
  });

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'ui',
    targetId: 'page_billing',
    description: 'Created billing page',
    applied: true,
  };
}

function repairMissingBillingEndpoints(
  issue: ValidationIssue,
  endpoints: EndpointNode[]
): RepairPatch | null {
  const existingIds = new Set(endpoints.map((e) => e.id));
  const billingEps: EndpointNode[] = [
    ep('ep_subscription_current', 'GET', '/api/billing/subscription', 'Get current subscription', ''),
    ep('ep_subscription_create', 'POST', '/api/billing/subscribe', 'Create subscription', ''),
    ep('ep_subscription_cancel', 'POST', '/api/billing/cancel', 'Cancel subscription', ''),
  ];

  for (const be of billingEps) {
    if (!existingIds.has(be.id)) {
      endpoints.push(be);
    }
  }

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'api',
    targetId: 'ep_billing_*',
    description: 'Created billing endpoints',
    applied: true,
  };
}

function repairMissingDashboardPage(
  issue: ValidationIssue,
  pages: PageNode[],
  endpoints: EndpointNode[]
): RepairPatch | null {
  const featComp = issue.affectedComponents.find((c) => c.layer === 'intent');
  if (!featComp) return null;

  const dashBindings = endpoints
    .filter((ep) => ep.path.includes('dashboard') || ep.path.includes('analytics'))
    .map((ep) => ep.id);

  pages.push({
    id: 'page_dashboard',
    route: '/dashboard',
    title: 'Dashboard',
    layout: 'dashboard',
    components: [{ id: 'stats_overview', type: 'stat-widget' }, { id: 'activity_chart', type: 'chart' }],
    requiredAuth: true,
    requiredRoles: [],
    dataBindings: dashBindings,
    sourceFeatureId: featComp.id,
  });

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'ui',
    targetId: 'page_dashboard',
    description: 'Created dashboard page',
    applied: true,
  };
}

function repairMissingDashboardEndpoints(
  issue: ValidationIssue,
  endpoints: EndpointNode[]
): RepairPatch | null {
  const existingIds = new Set(endpoints.map((e) => e.id));
  const dashEps: EndpointNode[] = [
    ep('ep_dashboard_stats', 'GET', '/api/dashboard/stats', 'Dashboard statistics', ''),
    ep('ep_analytics', 'GET', '/api/analytics', 'Analytics data', ''),
  ];

  for (const de of dashEps) {
    if (!existingIds.has(de.id)) {
      endpoints.push(de);
    }
  }

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'api',
    targetId: 'ep_dashboard_*',
    description: 'Created dashboard/analytics endpoints',
    applied: true,
  };
}

function repairAnalyticsAuth(
  issue: ValidationIssue,
  endpoints: EndpointNode[]
): RepairPatch | null {
  const epComp = issue.affectedComponents.find((c) => c.layer === 'api');
  if (!epComp) return null;

  const endpoint = endpoints.find((e) => e.id === epComp.id);
  if (!endpoint) return null;

  endpoint.auth.required = true;

  return {
    targetIssueId: issue.id,
    strategy: 'auto_fix',
    targetLayer: 'api',
    targetId: epComp.id,
    description: `Set auth.required = true on endpoint "${endpoint.path}"`,
    applied: true,
  };
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function ep(
  id: string,
  method: EndpointNode['method'],
  path: string,
  description: string,
  sourceEntityId: string,
  authRequired: boolean = true
): EndpointNode {
  return {
    id,
    method,
    path,
    description,
    responseBody: [],
    auth: { required: authRequired },
    sourceEntityId,
  };
}

function colSpec(name: string, type: ColumnType, nullable: boolean, unique: boolean): ColumnSpec {
  return { name, type, nullable, unique };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
