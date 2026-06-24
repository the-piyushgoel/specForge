import type {
  EnrichmentResult,
  EnrichedRequirement,
  IntentIR,
  Feature,
  DomainEntity,
  BusinessRule,
  Role,
  FeatureCategory,
} from '../types';
import { slugify } from '../lib/ids';

// ─── P3: IntentIR Builder (deterministic) ───────────────────────────────────

/**
 * P3: Build the IntentIR from enriched requirements.
 *
 * Compiles the enriched requirements into a lightweight normalized
 * representation of "what the app wants to be".
 * No LLM calls — pure data transformation.
 */
export function buildIntentIR(enrichment: EnrichmentResult): IntentIR {
  const reqs = enrichment.requirements;
  const grouped = groupByCategory(reqs);

  const roles = buildRoles(grouped.authorization ?? [], grouped.auth ?? []);
  let features = buildFeatures(reqs);
  const entities = buildEntities(reqs, features);

  // 2) Synthesize missing CRUD features for major entities like 'contact'
  for (const ent of entities) {
    const coveredByFeature = features.some(
      (f) => f.name.includes(ent.name) || f.name === `${ent.name}-management`
    );
    if (!coveredByFeature && !['user'].includes(ent.name)) {
      features.push({
        id: `feat_${ent.name}-management`,
        name: `${ent.name}-management`,
        category: 'crud',
        sourceRequirementIds: [...ent.sourceRequirementIds],
      });
    }
  }

  // 3) Merge fragmented features (billing, auth, dashboard)
  features = mergeFeatures(features);

  // 4) Ensure some business rules are captured (including authz rules)
  const businessRules = buildBusinessRules(
    grouped.business_rule ?? [],
    grouped.authorization ?? []
  );

  return {
    appName: deriveAppName(reqs),
    description: deriveDescription(features, entities, roles),
    features,
    entities,
    roles,
    businessRules,
    assumptions: enrichment.assumptions,
    ambiguities: [], // placeholder for future expansion
    conflicts: enrichment.conflicts.map((c) => c.description),
  };
}

// ─── Helpers: grouping ───────────────────────────────────────────────────────

type CategoryGroup = Partial<Record<string, EnrichedRequirement[]>>;

function groupByCategory(reqs: EnrichedRequirement[]): CategoryGroup {
  const groups: CategoryGroup = {};
  for (const req of reqs) {
    (groups[req.category] ??= []).push(req);
  }
  return groups;
}

// ─── Helpers: entity building ────────────────────────────────────────────────

function extractEntityName(text: string): string {
  const lower = text.toLowerCase().trim();

  // Match "X management / module / entity / CRUD / handling / records / data"
  const suffixPattern = /^([\w\s]+?)\s+(?:management|module|entity|system|service|crud|operations|handling|records|data|tracking|storage)\b/i;
  const match = lower.match(suffixPattern);
  if (match) return normalize(match[1]);

  // Match "manage X" / "store X" / "track X"
  const prefixPattern = /^(?:manage|store|track|handle|maintain)\s+([\w\s]+)/i;
  const match2 = lower.match(prefixPattern);
  if (match2) return normalize(match2[1]);

  // Fall back to first 1-2 significant words
  const words = lower
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => !STOP_WORDS.has(w));
  return normalize(words.slice(0, 2).join(' '));
}

function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, '_').replace(/s$/, ''); // rough singularize
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'to', 'of', 'in',
  'on', 'by', 'is', 'are', 'be', 'from', 'that', 'this', 'it',
  'ability', 'support', 'feature', 'capability', 'functionality',
]);

function buildEntities(reqs: EnrichedRequirement[], features: Feature[]): DomainEntity[] {
  const entityMap = new Map<string, DomainEntity>();

  // 1. Start with explicit data_entity requirements
  for (const req of reqs) {
    if (req.category === 'data_entity') {
      const name = extractEntityName(req.text);
      if (!name) continue;

      if (!entityMap.has(name)) {
        entityMap.set(name, {
          id: `ent_${name}`,
          name,
          sourceRequirementIds: [req.id],
        });
      } else {
        entityMap.get(name)!.sourceRequirementIds.push(req.id);
      }
    }
  }

  // 2. Fallback: infer entities only from CRUD / management-style features
  for (const feat of features) {
    if (feat.category !== 'crud' && !feat.name.endsWith('-management')) continue;
    const name = extractEntityName(feat.name);
    if (name && !entityMap.has(name)) {
      entityMap.set(name, {
        id: `ent_${name}`,
        name,
        sourceRequirementIds: [...feat.sourceRequirementIds],
      });
    }
  }

  // 3. Fallback: ensure 'user' exists if there's authentication
  if (!entityMap.has('user') && features.some((f) => f.category === 'auth')) {
    entityMap.set('user', {
      id: 'ent_user',
      name: 'user',
      sourceRequirementIds: [],
    });
  }

  return Array.from(entityMap.values());
}

// ─── Helpers: role building ──────────────────────────────────────────────────

const KNOWN_ROLES = ['admin', 'member', 'user', 'editor', 'viewer', 'manager', 'moderator', 'owner', 'guest'];

function buildRoles(
  authzReqs: EnrichedRequirement[],
  authReqs: EnrichedRequirement[]
): Role[] {
  const roleMap = new Map<string, Role>();

  const allReqs = [...authzReqs, ...authReqs];
  
  for (const req of allReqs) {
    const text = req.text.toLowerCase();
    for (const roleName of KNOWN_ROLES) {
      if (text.includes(roleName)) {
        if (!roleMap.has(roleName)) {
          roleMap.set(roleName, {
            id: `role_${roleName}`,
            name: roleName,
            description: `${roleName.charAt(0).toUpperCase() + roleName.slice(1)} role`,
            sourceRequirementIds: [req.id],
          });
        } else {
          roleMap.get(roleName)!.sourceRequirementIds.push(req.id);
        }
      }
    }
  }

  // Ensure minimum roles if any auth/authz exists but none were explicitly found
  if (allReqs.length > 0 && roleMap.size === 0) {
    roleMap.set('admin', {
      id: 'role_admin',
      name: 'admin',
      description: 'Admin role',
      sourceRequirementIds: allReqs.map(r => r.id),
    });
    roleMap.set('member', {
      id: 'role_member',
      name: 'member',
      description: 'Member role',
      sourceRequirementIds: allReqs.map(r => r.id),
    });
  }

  return Array.from(roleMap.values());
}

// ─── Helpers: feature building ───────────────────────────────────────────────

function deriveFeatureCategory(name: string, text: string): FeatureCategory {
  const lowerName = name.toLowerCase();
  const lowerText = text.toLowerCase();

  if (lowerName.includes('auth') || lowerName.includes('login') || lowerName.includes('signup')) return 'auth';
  if (lowerName.includes('dashboard') || lowerText.includes('dashboard')) return 'dashboard';
  if (lowerName.includes('analytic') || lowerName.includes('report') || lowerText.includes('analytic')) return 'analytics';
  if (lowerText.includes('pay') || lowerText.includes('bill') || lowerText.includes('stripe') || lowerText.includes('subscription')) return 'billing';
  if (lowerText.includes('integrat') || lowerText.includes('api ') || lowerText.includes('sync') || lowerText.includes('webhook')) return 'integration';
  if (lowerName.includes('admin')) return 'admin';
  if (lowerText.includes('approval') || lowerText.includes('workflow')) return 'workflow';
  
  if (lowerText.includes('manage') || lowerText.includes('create') || lowerText.includes('crud') || lowerText.includes('list')) return 'crud';

  return 'other';
}

function buildFeatures(reqs: EnrichedRequirement[]): Feature[] {
  const featureMap = new Map<string, Feature>();
  
  // Create features from ui_view, api_action, integration, auth
  for (const req of reqs) {
    if (!['ui_view', 'api_action', 'integration', 'auth'].includes(req.category)) continue;

    let name = extractFeatureName(req.text);
    if (req.category === 'auth') name = 'authentication';
    
    if (!name) continue;

    if (!featureMap.has(name)) {
      featureMap.set(name, {
        id: `feat_${name}`,
        name,
        category: deriveFeatureCategory(name, req.text),
        sourceRequirementIds: [req.id],
        gatedBy: extractGating(req.text),
      });
    } else {
      featureMap.get(name)!.sourceRequirementIds.push(req.id);
      
      // Promote category if it was "other"
      const current = featureMap.get(name)!;
      if (current.category === 'other') {
        current.category = deriveFeatureCategory(name, req.text);
      }
    }
  }

  return Array.from(featureMap.values());
}

function mergeFeatures(features: Feature[]): Feature[] {
  const merged = new Map<string, Feature>();
  for (const f of features) {
    let key = f.name;
    
    // Normalize fragmented billing/auth/dashboard features
    if (f.category === 'billing') key = 'billing-subscriptions';
    else if (f.category === 'auth') key = 'authentication';
    else if (f.category === 'dashboard' || f.category === 'analytics') key = 'dashboard-analytics';

    if (!merged.has(key)) {
      merged.set(key, { ...f, name: key });
    } else {
      const existing = merged.get(key)!;
      existing.sourceRequirementIds = Array.from(new Set([...existing.sourceRequirementIds, ...f.sourceRequirementIds]));
      if (f.gatedBy && !existing.gatedBy) existing.gatedBy = f.gatedBy;
    }
  }
  return Array.from(merged.values());
}

function extractFeatureName(text: string): string {
  const lower = text.toLowerCase().trim();

  // Strip common prefixes
  const cleaned = lower
    .replace(/^(?:user|admin|system)\s+/i, '')
    .replace(/\s+(?:page|screen|view|panel|section|module|feature|capability|functionality)\s*$/i, '');

  const words = cleaned
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => !STOP_WORDS.has(w));

  return slugify(words.slice(0, 3).join(' '));
}

function extractGating(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('premium')) return 'premium';
  if (lower.includes('pro plan') || lower.includes('pro tier')) return 'pro';
  if (lower.includes('enterprise')) return 'enterprise';
  if (lower.includes('paid')) return 'paid';
  return undefined;
}

// ─── Helpers: business rules ─────────────────────────────────────────────────

const RULE_LIKE_KEYWORDS = [
  'can', 'cannot', 'access', 'visible', 'restricted',
  'role-based', 'permission', 'only', 'allowed', 'forbidden',
  'must', 'require', 'limit',
];

function isRuleLike(text: string): boolean {
  const lower = text.toLowerCase();
  return RULE_LIKE_KEYWORDS.some((kw) => lower.includes(kw));
}

function buildBusinessRules(
  ruleReqs: EnrichedRequirement[],
  authzReqs: EnrichedRequirement[]
): BusinessRule[] {
  // Include all explicit business_rule requirements
  // Include authz requirements only if they read like access-control rules
  const filtered = [
    ...ruleReqs,
    ...authzReqs.filter((req) => isRuleLike(req.text)),
  ];
  return filtered.map((req, i) => ({
    id: `rule_${String(i + 1).padStart(3, '0')}`,
    description: req.text,
    sourceRequirementIds: [req.id],
  }));
}

// ─── Helpers: app name & description ─────────────────────────────────────────

function deriveAppName(reqs: EnrichedRequirement[]): string {
  const allText = reqs.map((r) => r.text).join(' ').toLowerCase();

  const patterns: [RegExp, string][] = [
    [/\bcrm\b/i, 'CRM'],
    [/\bproject\s*manage/i, 'Project Management Tool'],
    [/\be-?commerce\b|\bonline\s*store\b|\bshop\b/i, 'E-Commerce Platform'],
    [/\bsocial\b|\bcommunity\b/i, 'Social Platform'],
    [/\bblog\b|\bcms\b/i, 'Content Management System'],
    [/\binventory\b/i, 'Inventory Management System'],
    [/\btask\b.*\bmanage/i, 'Task Manager'],
    [/\bhr\b|\bhuman\s*resource/i, 'HR Management System'],
  ];

  for (const [pattern, name] of patterns) {
    if (pattern.test(allText)) return name;
  }

  return 'Application';
}

function deriveDescription(
  features: Feature[],
  entities: DomainEntity[],
  roles: Role[]
): string {
  const parts = [
    `${features.length} feature${features.length !== 1 ? 's' : ''}`,
    `${entities.length} data entit${entities.length !== 1 ? 'ies' : 'y'}`,
    `${roles.length} role${roles.length !== 1 ? 's' : ''}`,
  ];
  return `Application specification with ${parts.join(', ')}`;
}
