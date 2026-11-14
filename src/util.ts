import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const MAX_FILE_BYTES = 1_000_000;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage',
  '.turbo', '.vercel', '.nuxt', '.svelte-kit',
]);

/** Mask a secret so reports never contain the full value. */
export function redact(value: string): string {
  if (value.length <= 10) return '[redacted]';
  return `${value.slice(0, 4)}...${value.slice(-2)} [redacted, ${value.length} chars]`;
}

/** Short hash used to deduplicate the same secret across files and commits. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** Skip obvious examples so templates do not produce noise. */
export function isPlaceholder(value: string): boolean {
  return /example|placeholder|your[_-]|xxxx|changeme|change_me|<[^>]+>|\$\{|dummy|sample|fake/i.test(value);
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Decode the payload of a JWT without verifying it. Returns null if malformed. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const obj: unknown = JSON.parse(json);
    return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function walkFiles(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Read a text file. Returns null for large or binary files. */
export async function readText(file: string): Promise<string | null> {
  const info = await stat(file);
  if (info.size > MAX_FILE_BYTES) return null;
  const buf = await readFile(file);
  if (buf.subarray(0, 2000).includes(0)) return null;
  return buf.toString('utf8');
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
