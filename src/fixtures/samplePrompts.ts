/**
 * Sample prompts for testing the SpecForge pipeline.
 *
 * 3 normal prompts that exercise the full pipeline.
 * 2 edge-case prompts that stress ambiguity handling + conflict detection.
 */

// ─── Normal prompts ──────────────────────────────────────────────────────────

export const CRM_PROMPT =
  'Build a CRM with login, contacts, dashboard, role-based access, ' +
  'premium plan with payments. Admins can see analytics.';

export const PROJECT_MANAGEMENT_PROMPT =
  'Build a project management tool with user login, projects, tasks, ' +
  'team members, and an admin dashboard with analytics. ' +
  'Premium users can export reports.';

export const ECOMMERCE_PROMPT =
  'Build an e-commerce store with product listings, shopping cart, ' +
  'checkout with Stripe payments, order tracking, user accounts, ' +
  'and an admin panel for managing inventory and viewing sales analytics.';

// ─── Edge-case prompts ───────────────────────────────────────────────────────

/** Deliberately vague — forces heavy assumption generation */
export const VAGUE_PROMPT =
  'Build an app for managing stuff with users and some kind of dashboard.';

/** Contains conflicting requirements — forces conflict detection */
export const CONFLICTING_PROMPT =
  'Build a social platform where all posts are public and visible to everyone. ' +
  'Users should have private profiles that hide all their activity. ' +
  'The admin dashboard should show all user activity in real time. ' +
  'No user data should be stored on the server for privacy compliance.';

// ─── All prompts as a named list (for UI sample buttons) ────────────────────

export const SAMPLE_PROMPTS = [
  { label: 'CRM App', prompt: CRM_PROMPT },
  { label: 'Project Manager', prompt: PROJECT_MANAGEMENT_PROMPT },
  { label: 'E-Commerce', prompt: ECOMMERCE_PROMPT },
  { label: 'Vague (edge case)', prompt: VAGUE_PROMPT },
  { label: 'Conflicting (edge case)', prompt: CONFLICTING_PROMPT },
] as const;
