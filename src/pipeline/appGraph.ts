import type {
  IntentIR,
  Feature,
  DomainEntity,
  Role,
  BusinessRule,
  AppGraphIR,
  PageNode,
  EndpointNode,
  DataModelNode,
  AuthConfig,
  ColumnSpec,
  ComponentNode,
  ForeignKeySpec,
  PlanGateRule,
  HttpMethod,
  PageLayout,
  ComponentType,
  ColumnType,
} from '../types';

// ─── P4: AppGraphIR Builder (deterministic) ─────────────────────────────────

/**
 * P4: Compile IntentIR into AppGraphIR.
 *
 * Produces the first implementation-facing architecture skeleton:
 *   - pages / UI surfaces
 *   - API endpoints
 *   - data models / tables
 *   - auth/access config
 *
 * Pure deterministic transformation. No LLM calls.
 */
export function buildAppGraphIR(intent: IntentIR): AppGraphIR {
  const entityMap = new Map(intent.entities.map((e) => [e.id, e]));
  const ruleIndex = buildRuleIndex(intent.businessRules, intent.roles, intent.features);

  const dataModels = buildDataModels(intent.entities, intent.roles);
  const endpoints = buildEndpoints(intent.features, intent.entities, intent.roles, ruleIndex);
  const pages = buildPages(intent.features, intent.entities, intent.roles, endpoints, ruleIndex);
  const authConfig = buildAuthConfig(intent);

  return { pages, apiEndpoints: endpoints, dataModels, authConfig };
}

// ─── Rule index ──────────────────────────────────────────────────────────────

interface RuleIndex {
  roleGates: Map<string, string[]>;   // featureCategory → role names that gate it
  planGates: Map<string, string>;     // featureId → plan name
}

function buildRuleIndex(rules: BusinessRule[], roles: Role[], features: Feature[]): RuleIndex {
  const roleGates = new Map<string, string[]>();
  const planGates = new Map<string, string>();

  const knownRoles = roles.map((r) => r.name.toLowerCase());
  if (!knownRoles.includes('admin')) knownRoles.push('admin');
  if (!knownRoles.includes('user')) knownRoles.push('user');
  if (!knownRoles.includes('manager')) knownRoles.push('manager');
  if (!knownRoles.includes('staff')) knownRoles.push('staff');
  if (!knownRoles.includes('customer')) knownRoles.push('customer');

  const addRoleGate = (resource: string, role: string) => {
    const existing = roleGates.get(resource) ?? [];
    if (!existing.includes(role)) {
      roleGates.set(resource, [...existing, role]);
    }
  };

  const matchResource = (text: string): string[] => {
    const resources: string[] = [];
    const lower = text.toLowerCase();
    if (lower.includes('analytic') || lower.includes('report') || lower.includes('dashboard')) {
      resources.push('analytics', 'dashboard');
    }
    if (lower.includes('order')) {
      resources.push('order');
    }
    if (lower.includes('invoice')) {
      resources.push('invoice');
    }
    if (lower.includes('contact')) {
      resources.push('contact');
    }
    if (lower.includes('billing') || lower.includes('payment') || lower.includes('subscription')) {
      resources.push('billing');
    }
    return resources;
  };

  for (const rule of rules) {
    const lower = rule.description.toLowerCase();

    for (const role of knownRoles) {
      const rolePlural = `${role}s`;
      const hasRole = lower.includes(role) || lower.includes(rolePlural);
      if (!hasRole) continue;

      const matchedResources = matchResource(lower);
      for (const res of matchedResources) {
        if (
          lower.includes('can') ||
          lower.includes('access') ||
          lower.includes('see') ||
          lower.includes('view') ||
          lower.includes('edit') ||
          lower.includes('only') ||
          lower.includes('restrict') ||
          lower.includes('allow') ||
          lower.includes('role')
        ) {
          addRoleGate(res, role);
        }
      }
    }
  }

  for (const feat of features) {
    const lowerName = feat.name.toLowerCase();
    for (const role of knownRoles) {
      if (
        lowerName.includes(`${role}-only`) ||
        lowerName.includes(`${role}only`) ||
        lowerName.startsWith(`${role}-`) ||
        lowerName.includes(`${role} dashboard`) ||
        lowerName.includes(`${role}dashboard`)
      ) {
        if (feat.category === 'analytics' || feat.category === 'dashboard') {
          addRoleGate('analytics', role);
          addRoleGate('dashboard', role);
        } else {
          addRoleGate(feat.category, role);
          addRoleGate(feat.name.replace(/-management$|-tracking$|-crud$/, ''), role);
        }
      }
    }
  }

  return { roleGates, planGates };
}

// ─── Data models ─────────────────────────────────────────────────────────────

const DEFAULT_FIELDS: Record<string, ColumnSpec[]> = {
  user: [
    col('id', 'uuid', false, true),
    col('email', 'string', false, true),
    col('name', 'string', false, false),
    col('password_hash', 'string', false, false),
    col('role', 'string', false, false),
  ],
  contact: [
    col('id', 'uuid', false, true),
    col('name', 'string', false, false),
    col('email', 'string', true, false),
    col('phone', 'string', true, false),
    col('owner_id', 'uuid', false, false),
  ],
  subscription: [
    col('id', 'uuid', false, true),
    col('user_id', 'uuid', false, false),
    col('plan', 'string', false, false),
    col('status', 'string', false, false),
    col('renews_at', 'timestamp', true, false),
  ],
};

function col(name: string, type: ColumnType, nullable: boolean, unique: boolean): ColumnSpec {
  return { name, type, nullable, unique };
}

function buildDataModels(entities: DomainEntity[], roles: Role[]): DataModelNode[] {
  const models: DataModelNode[] = [];

  for (const entity of entities) {
    const known = DEFAULT_FIELDS[entity.name];
    const columns: ColumnSpec[] = known
      ? [...known]
      : [
          col('id', 'uuid', false, true),
          col('name', 'string', false, false),
        ];

    const foreignKeys: ForeignKeySpec[] = [];

    // Link contact.owner_id → users.id
    if (entity.name === 'contact') {
      foreignKeys.push({
        column: 'owner_id',
        referencesTable: 'users',
        referencesColumn: 'id',
        onDelete: 'cascade',
      });
    }

    // Link subscription.user_id → users.id
    if (entity.name === 'subscription') {
      foreignKeys.push({
        column: 'user_id',
        referencesTable: 'users',
        referencesColumn: 'id',
        onDelete: 'cascade',
      });
    }

    models.push({
      id: `model_${entity.name}`,
      tableName: `${entity.name}s`, // simple pluralize
      columns,
      primaryKey: 'id',
      foreignKeys,
      timestamps: true,
      sourceEntityId: entity.id,
    });
  }

  return models;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

function buildEndpoints(
  features: Feature[],
  entities: DomainEntity[],
  roles: Role[],
  ruleIndex: RuleIndex
): EndpointNode[] {
  const endpoints: EndpointNode[] = [];
  const entityMap = new Map(entities.map((e) => [e.name, e]));

  for (const feat of features) {
    switch (feat.category) {
      case 'auth':
        endpoints.push(
          endpoint('ep_login', 'POST', '/api/auth/login', 'User login', '', false),
          endpoint('ep_register', 'POST', '/api/auth/register', 'User registration', '', false),
          endpoint('ep_logout', 'POST', '/api/auth/logout', 'User logout', '', true),
          endpoint('ep_me', 'GET', '/api/auth/me', 'Get current user', '', true),
        );
        break;

      case 'crud': {
        const entityName = extractEntityFromFeature(feat);
        const entity = entityMap.get(entityName);
        const entityId = entity?.id ?? '';
        const plural = `${entityName}s`;
        const prefix = entityName.slice(0, 3);

        endpoints.push(
          endpoint(`ep_${entityName}_list`, 'GET', `/api/${plural}`, `List ${plural}`, entityId, true),
          endpoint(`ep_${entityName}_get`, 'GET', `/api/${plural}/:id`, `Get ${entityName} by ID`, entityId, true),
          endpoint(`ep_${entityName}_create`, 'POST', `/api/${plural}`, `Create ${entityName}`, entityId, true),
          endpoint(`ep_${entityName}_update`, 'PUT', `/api/${plural}/:id`, `Update ${entityName}`, entityId, true),
          endpoint(`ep_${entityName}_delete`, 'DELETE', `/api/${plural}/:id`, `Delete ${entityName}`, entityId, true),
        );
        break;
      }

      case 'dashboard':
      case 'analytics': {
        const gatedRoles = ruleIndex.roleGates.get('analytics') ?? ruleIndex.roleGates.get('dashboard');
        endpoints.push(
          endpoint('ep_dashboard_stats', 'GET', '/api/dashboard/stats', 'Dashboard statistics', '', true, gatedRoles),
          endpoint('ep_analytics', 'GET', '/api/analytics', 'Analytics data', '', true, gatedRoles),
        );
        break;
      }

      case 'billing':
        endpoints.push(
          endpoint('ep_subscription_current', 'GET', '/api/billing/subscription', 'Get current subscription', '', true),
          endpoint('ep_subscription_create', 'POST', '/api/billing/subscribe', 'Create subscription', '', true),
          endpoint('ep_subscription_cancel', 'POST', '/api/billing/cancel', 'Cancel subscription', '', true),
        );
        break;
    }
  }

  return dedupeById(endpoints);
}

function endpoint(
  id: string,
  method: HttpMethod,
  path: string,
  description: string,
  sourceEntityId: string,
  authRequired: boolean,
  roles?: string[]
): EndpointNode {
  return {
    id,
    method,
    path,
    description,
    responseBody: [],
    auth: {
      required: authRequired,
      roles: roles?.length ? roles : undefined,
    },
    sourceEntityId,
  };
}

// ─── Pages ───────────────────────────────────────────────────────────────────

function buildPages(
  features: Feature[],
  entities: DomainEntity[],
  roles: Role[],
  endpoints: EndpointNode[],
  ruleIndex: RuleIndex
): PageNode[] {
  const pages: PageNode[] = [];

  for (const feat of features) {
    switch (feat.category) {
      case 'auth':
        pages.push(
          page('page_login', '/login', 'Login', 'auth', [comp('login_form', 'form')], false, [], feat.id,
            endpointIdsForPaths(endpoints, ['/api/auth/login'])),
          page('page_register', '/register', 'Register', 'auth', [comp('register_form', 'form')], false, [], feat.id,
            endpointIdsForPaths(endpoints, ['/api/auth/register'])),
        );
        break;

      case 'crud': {
        const entityName = extractEntityFromFeature(feat);
        const plural = `${entityName}s`;

        pages.push(
          page(
            `page_${entityName}_list`, `/${plural}`, `${capitalize(plural)}`, 'list-detail',
            [comp(`${entityName}_table`, 'table')],
            true, [], feat.id,
            endpointIdsForPaths(endpoints, [`/api/${plural}`])
          ),
          page(
            `page_${entityName}_detail`, `/${plural}/:id`, `${capitalize(entityName)} Detail`, 'form',
            [comp(`${entityName}_form`, 'form'), comp(`${entityName}_card`, 'card')],
            true, [], feat.id,
            endpointIdsForPaths(endpoints, [`/api/${plural}/:id`])
          ),
        );
        break;
      }

      case 'dashboard':
      case 'analytics': {
        const gatedRoles = ruleIndex.roleGates.get('analytics') ?? ruleIndex.roleGates.get('dashboard') ?? [];
        pages.push(
          page('page_dashboard', '/dashboard', 'Dashboard', 'dashboard',
            [comp('stats_overview', 'stat-widget'), comp('activity_chart', 'chart')],
            true, gatedRoles, feat.id,
            endpointIdsForPaths(endpoints, ['/api/dashboard/stats', '/api/analytics'])
          ),
        );
        break;
      }

      case 'billing': {
        pages.push(
          page('page_billing', '/billing', 'Billing & Subscription', 'settings',
            [comp('plan_card', 'card'), comp('payment_form', 'form')],
            true, [], feat.id,
            endpointIdsForPaths(endpoints, ['/api/billing/subscription', '/api/billing/subscribe'])
          ),
        );
        break;
      }
    }
  }

  return dedupeById(pages);
}

function page(
  id: string,
  route: string,
  title: string,
  layout: PageLayout,
  components: ComponentNode[],
  requiredAuth: boolean,
  requiredRoles: string[],
  sourceFeatureId: string,
  dataBindings: string[]
): PageNode {
  return { id, route, title, layout, components, requiredAuth, requiredRoles, dataBindings, sourceFeatureId };
}

function comp(id: string, type: ComponentType, dataSource?: string): ComponentNode {
  return { id, type, dataSource };
}

// ─── Auth config ─────────────────────────────────────────────────────────────

function buildAuthConfig(intent: IntentIR): AuthConfig {
  const hasAuth = intent.features.some((f) => f.category === 'auth');
  const hasBilling = intent.features.some((f) => f.category === 'billing');

  const planGating: PlanGateRule[] = [];

  // Collect features with explicit gating
  for (const feat of intent.features) {
    if (feat.gatedBy) {
      const existing = planGating.find((p) => p.plan === feat.gatedBy);
      if (existing) {
        existing.gatedFeatures.push(feat.id);
      } else {
        planGating.push({ plan: feat.gatedBy, gatedFeatures: [feat.id] });
      }
    }
  }

  return {
    strategy: 'jwt',
    providers: ['email'],
    roles: intent.roles.map((r) => r.name),
    planGating,
  };
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function extractEntityFromFeature(feat: Feature): string {
  // "contact-management" → "contact", "order-tracking" → "order"
  return feat.name.replace(/-management$|-tracking$|-crud$/, '');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function endpointIdsForPaths(endpoints: EndpointNode[], paths: string[]): string[] {
  return endpoints
    .filter((ep) => paths.includes(ep.path))
    .map((ep) => ep.id);
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
