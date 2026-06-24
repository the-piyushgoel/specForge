/**
 * ID generators for SpecForge pipeline artifacts.
 *
 * All generators produce deterministic, sequential, human-readable IDs.
 * Each generator maintains its own counter so different artifact types
 * get independent sequences: val_001, val_002 / rep_001, rep_002 / etc.
 */

function createIdGenerator(prefix: string) {
  let counter = 0;

  return {
    /** Generate the next sequential ID */
    next(): string {
      counter++;
      return `${prefix}_${String(counter).padStart(3, '0')}`;
    },

    /** Reset the counter (useful between pipeline runs) */
    reset(): void {
      counter = 0;
    },

    /** Peek at what the next ID will be without incrementing */
    peek(): string {
      return `${prefix}_${String(counter + 1).padStart(3, '0')}`;
    },
  };
}

// ─── Exported generators ─────────────────────────────────────────────────────

/** Validation issue IDs: val_001, val_002, ... */
export const valId = createIdGenerator('val');

/** Repair patch IDs: rep_001, rep_002, ... */
export const repId = createIdGenerator('rep');

/** Requirement IDs: req_001, req_002, ... */
export const reqId = createIdGenerator('req');

/** Inferred requirement IDs: inf_001, inf_002, ... */
export const infId = createIdGenerator('inf');

/** Assumption IDs: asm_001, asm_002, ... */
export const asmId = createIdGenerator('asm');

/** Conflict IDs: cfl_001, cfl_002, ... */
export const cflId = createIdGenerator('cfl');

/**
 * Reset all ID generators. Call this at the start of each pipeline run
 * so IDs are consistent and start from 001.
 */
export function resetAllIds(): void {
  valId.reset();
  repId.reset();
  reqId.reset();
  infId.reset();
  asmId.reset();
  cflId.reset();
}

// ─── Slug helper ─────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a string.
 * "Contact Management" → "contact-management"
 */
export function slugify(text: string, maxLength = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);
}

/**
 * Simple hash of a string, returns a short hex string.
 * Used for prompt hashing in SpecMetadata — not cryptographic.
 */
export function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Convert to 32bit integer
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
