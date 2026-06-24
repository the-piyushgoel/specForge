import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ARTIFACTS_ROOT = path.resolve(process.cwd(), 'artifacts');

/**
 * Creates a timestamped run directory under artifacts/.
 * Returns the absolute path to the run directory.
 *
 * Directory format: artifacts/20260623-183012-build-a-crm/
 */
export async function createRunDir(prompt: string): Promise<string> {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14); // "20260623183012"
  const formatted = `${timestamp.slice(0, 8)}-${timestamp.slice(8)}`; // "20260623-183012"

  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  const dirName = `${formatted}-${slug}`;
  const runDir = path.join(ARTIFACTS_ROOT, dirName);

  await mkdir(runDir, { recursive: true });
  return runDir;
}

/**
 * Writes a JSON artifact to the run directory.
 * File is named with a numeric prefix for ordering: "1-extraction.json"
 */
export async function writeArtifact(
  runDir: string,
  name: string,
  data: unknown
): Promise<string> {
  const filePath = path.join(runDir, `${name}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

/**
 * Reads a previously written artifact from the run directory.
 * Returns parsed JSON.
 */
export async function readArtifact<T = unknown>(
  runDir: string,
  name: string
): Promise<T> {
  const filePath = path.join(runDir, `${name}.json`);
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Lists all run directories under artifacts/, most recent first.
 */
export async function listRuns(): Promise<string[]> {
  if (!existsSync(ARTIFACTS_ROOT)) return [];

  const { readdir } = await import('fs/promises');
  const entries = await readdir(ARTIFACTS_ROOT, { withFileTypes: true });

  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse();
}

/** Stage file names used by the orchestrator, in pipeline order */
export const STAGE_FILES = {
  extraction:  '1-extraction',
  enrichment:  '2-enrichment',
  intentIR:    '3-intentIR',
  appGraphIR:  '4-appGraphIR',
  appSpec:     '5-appSpec',
  validation:  '6-validation',
  repair:      '7-repair',
  result:      '8-result',
} as const;
