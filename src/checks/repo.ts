import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { makeFinding } from '../findings.js';
import { scanSecrets, type SecretHit } from '../secrets.js';
import type { Finding } from '../types.js';
import { auditEdgeFunctions, auditFirebase, auditSupabaseSql, stripSqlComments, type TextFile } from './backend.js';
import { lineOf, readText, toPosix, walkFiles } from '../util.js';

const execFileP = promisify(execFile);

export interface RepoOptions {
  /** Scan every added line in the full git history. */
  history: boolean;
  /** Run npm audit (needs network and a package-lock.json). */
  npmAudit: boolean;
}

export interface CheckResult {
  findings: Finding[];
  notes: string[];
}

const CODE_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html)$/i;
const SERVER_PATH = /(^|\/)(api|server|functions|scripts|migrations|supabase\/functions|netlify\/functions|lib\/server)(\/|$)|\.server\.[jt]sx?$|(^|\/)middleware\.[jt]s$/i;
const PUBLIC_SECRET_ENV = /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|NUXT_PUBLIC_|EXPO_PUBLIC_|PUBLIC_)[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE_ROLE|SERVICE_KEY|ADMIN_KEY|PASSWORD|API_KEY|TOKEN)[A-Z0-9_]*\b/g;
/** Names that look secret but are public by design (Firebase web key, Supabase anon/publishable key). */
const PUBLIC_BY_DESIGN = /FIREBASE_API_KEY|PUBLISHABLE|ANON_KEY/;
/** References to a Supabase key that bypasses RLS, under its common names. */
const SERVICE_ROLE_REF = /service_role|SERVICE_KEY|ADMIN_KEY/gi;

function isEnvFile(name: string): boolean {
  return /^\.env(\..+)?$/.test(name) && !/\.(example|sample|template|dist)$/i.test(name);
}

async function gitOut(cwd: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', cwd, ...args], { maxBuffer, timeout: 180_000 });
  return stdout;
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    return (await gitOut(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

export async function scanRepo(rootInput: string, opts: RepoOptions): Promise<CheckResult> {
  const root = path.resolve(rootInput);
  if (!existsSync(root)) throw new Error(`Path not found: ${root}`);

  const findings: Finding[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  const addOnce = (key: string, finding: Finding) => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  const addSecret = (hit: SecretHit, location: string) =>
    addOnce(`secret:${hit.fingerprint}`, makeFinding(hit.ruleId, 'repo', location, `${hit.patternName}: ${hit.evidence}`, hit.severity));

  const inGit = await isGitRepo(root);
  const tracked = inGit
    ? new Set((await gitOut(root, ['ls-files', '-z'])).split('\0').filter(Boolean))
    : null;
  if (!inGit) notes.push('Target is not a git repository: tracked-file and history checks were skipped.');

  const files = await walkFiles(root);
  const sqlFiles: TextFile[] = [];
  const backendFiles: TextFile[] = [];
  let scanned = 0;

  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    const base = path.basename(file);

    if (isEnvFile(base)) {
      if (tracked?.has(rel)) {
        addOnce(`env:${rel}`, makeFinding('VP-ENV-001', 'repo', rel, `${rel} is tracked by git.`));
      } else if (!tracked) {
        notes.push(`Environment file present on disk (tracking not verifiable): ${rel}`);
      }
    }

    const text = await readText(file);
    if (text === null) continue;
    scanned++;

    for (const hit of scanSecrets(text)) addSecret(hit, `${rel}:${hit.line}`);

    for (const m of text.matchAll(PUBLIC_SECRET_ENV)) {
      if (PUBLIC_BY_DESIGN.test(m[0])) continue;
      addOnce(`pubenv:${m[0]}:${rel}`, makeFinding('VP-ENV-002', 'repo', `${rel}:${lineOf(text, m.index ?? 0)}`, `Variable name: ${m[0]}`));
    }

    if (CODE_EXT.test(base) && !SERVER_PATH.test(rel) && !/['"]server-only['"]/.test(text)) {
      const m = SERVICE_ROLE_REF.exec(text);
      SERVICE_ROLE_REF.lastIndex = 0;
      if (m) {
        const line = lineOf(text, m.index);
        const snippet = text.split('\n')[line - 1]?.trim().slice(0, 120) ?? '';
        addOnce(`svc:${rel}`, makeFinding('VP-DB-004', 'repo', `${rel}:${line}`, snippet.replace(/eyJ[\w.-]+/g, '[jwt redacted]')));
      }
    }

    if (base.toLowerCase().endsWith('.sql')) sqlFiles.push({ rel, text });
    if (rel.startsWith('supabase/') || base.endsWith('.rules') || base === 'database.rules.json') backendFiles.push({ rel, text });
  }
  notes.push(`Scanned ${scanned} text files (${files.length} files total, build and dependency folders skipped).`);

  findings.push(...auditSql(sqlFiles, notes));
  findings.push(...auditSupabaseSql(sqlFiles, notes));
  findings.push(...auditEdgeFunctions(backendFiles, notes));
  findings.push(...auditFirebase(backendFiles, notes));

  if (existsSync(path.join(root, 'package.json'))) {
    const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'];
    if (!lockfiles.some((f) => existsSync(path.join(root, f)))) {
      findings.push(makeFinding('VP-ENV-003', 'repo', 'package.json', 'No lockfile found next to package.json.'));
    }
  }

  if (inGit && opts.history) {
    try {
      const before = findings.length;
      scanHistory(await gitOut(root, ['log', '--all', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=commit %H'], 512 * 1024 * 1024), addSecret);
      notes.push(`Git history scanned (all branches). ${findings.length - before} secret(s) found only in history.`);
    } catch (err) {
      notes.push(`Git history scan failed: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  if (opts.npmAudit) findings.push(...(await npmAudit(root, notes)));

  return { findings, notes };
}

function scanHistory(log: string, addSecret: (hit: SecretHit, location: string) => void): void {
  let commit = '';
  let file = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7, 19);
    else if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+')) {
      for (const hit of scanSecrets(line.slice(1))) addSecret(hit, `git history, commit ${commit}, ${file}`);
    }
  }
}

const PUBLIC_TABLE = String.raw`(?:"?public"?\.)?"?([A-Za-z_][\w]*)"?`;

/** Text inside the parentheses after "using" or "with check", with nested parentheses balanced. */
function clause(body: string, keyword: 'using' | 'with check'): string | null {
  const m = new RegExp(String.raw`\b${keyword.replace(' ', String.raw`\s+`)}\s*\(`, 'i').exec(body);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < body.length && depth > 0; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') depth--;
  }
  return body.slice(start, i - 1);
}

/** Lower-case, no whitespace, no outer parentheses, "(select auth.x())" unwrapped. */
function normalizeCondition(cond: string): string {
  let c = cond.toLowerCase().replace(/\s+/g, '').replace(/\(select(auth\.\w+\(\))\)/g, '$1');
  while (/^\(.*\)$/.test(c) && clauseBalanced(c.slice(1, -1))) c = c.slice(1, -1);
  return c;
}

function clauseBalanced(c: string): boolean {
  let depth = 0;
  for (const ch of c) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

function isTrue(cond: string | null): boolean {
  return cond !== null && normalizeCondition(cond) === 'true';
}

const ANY_SIGNED_IN_USER = new Set([
  "auth.role()='authenticated'",
  "'authenticated'=auth.role()",
  'auth.uid()isnotnull',
  'auth.jwt()isnotnull',
  "auth.role()<>'anon'",
  "auth.role()!='anon'",
]);

function trustsAnyUser(cond: string | null): boolean {
  return cond !== null && ANY_SIGNED_IN_USER.has(normalizeCondition(cond));
}

/** Static audit of Supabase/Postgres migrations for missing or permissive RLS. */
export function auditSql(files: { rel: string; text: string }[], notes: string[]): Finding[] {
  const findings: Finding[] = [];
  const created = new Map<string, string>(); // table -> location
  const rlsEnabled = new Set<string>();

  const createRe = new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?([A-Za-z_]\w*)"?`, 'gi');
  const rlsRe = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${PUBLIC_TABLE}\s+enable\s+row\s+level\s+security`, 'gi');
  // Schema is captured so storage.objects and other schemas are not mistaken for public tables.
  const policyRe = new RegExp(String.raw`create\s+policy\s+("[^"]*"|\w+)\s+on\s+(?:"?(\w+)"?\.)?"?([A-Za-z_]\w*)"?([^;]*);`, 'gi');

  for (const { rel, text: raw } of files) {
    const text = stripSqlComments(raw);
    for (const m of text.matchAll(createRe)) {
      const schema = (m[1] ?? 'public').toLowerCase();
      if (schema !== 'public') continue;
      const table = m[2];
      if (!created.has(table)) created.set(table, `${rel}:${lineOf(text, m.index ?? 0)}`);
    }
    for (const m of text.matchAll(rlsRe)) rlsEnabled.add(m[1]);

    for (const m of text.matchAll(policyRe)) {
      const [, name, schemaName, table, body] = m;
      if ((schemaName ?? 'public').toLowerCase() !== 'public') continue;
      const usingCond = clause(body, 'using');
      const checkCond = clause(body, 'with check');
      const command = (/\bfor\s+(select|insert|update|delete|all)\b/i.exec(body)?.[1] ?? 'all').toLowerCase();
      const rolesMatch = /\bto\s+([\w\s,]+?)(?=\s+using\b|\s+with\b|$)/i.exec(body);
      const roles = rolesMatch ? rolesMatch[1].toLowerCase().split(/[\s,]+/).filter(Boolean) : ['public'];
      const isWrite = command !== 'select';
      const isAnon = roles.includes('anon') || roles.includes('public');
      const isAuthed = roles.includes('authenticated');

      let severity: 'critical' | 'high' | null = null;
      let why = 'condition is true';
      if (isTrue(usingCond) || isTrue(checkCond)) {
        if (isAnon) severity = isWrite ? 'critical' : 'high';
        else if (isAuthed && isWrite) severity = 'high';
      } else if (['update', 'delete', 'all'].includes(command) && trustsAnyUser(usingCond) && (isAnon || isAuthed)) {
        // Any signed-in user may change or delete every row, not only their own.
        severity = 'high';
        why = 'condition only checks that the user is signed in';
      }
      if (!severity) continue;

      findings.push(makeFinding('VP-DB-002', 'repo', `${rel}:${lineOf(text, m.index ?? 0)}`,
        `Policy ${name} on table "${table}": for ${command}, to ${roles.join(', ')}, ${why}.`, severity));
    }
  }

  for (const [table, location] of created) {
    if (!rlsEnabled.has(table)) {
      findings.push(makeFinding('VP-DB-001', 'repo', location, `Table "${table}" is created without "enable row level security".`));
    }
  }

  if (files.length) {
    notes.push(`SQL audit: ${files.length} file(s), ${created.size} public table(s), ${rlsEnabled.size} with RLS enabled. Changes made in the Supabase dashboard are not visible to this check.`);
  } else {
    notes.push('No SQL migration files found: database access rules could not be checked from the repository.');
  }
  return findings;
}

async function npmAudit(root: string, notes: string[]): Promise<Finding[]> {
  if (!existsSync(path.join(root, 'package-lock.json'))) {
    notes.push('npm audit skipped: no package-lock.json.');
    return [];
  }
  let stdout = '';
  try {
    stdout = (await execFileP('npm', ['audit', '--omit=dev', '--json'], { cwd: root, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (err) {
    // npm audit exits non-zero when it finds vulnerabilities; the JSON is still on stdout.
    stdout = (err as { stdout?: string }).stdout ?? '';
  }
  try {
    const counts = JSON.parse(stdout)?.metadata?.vulnerabilities ?? {};
    const critical = Number(counts.critical ?? 0);
    const high = Number(counts.high ?? 0);
    notes.push(`npm audit: ${critical} critical, ${high} high, ${Number(counts.moderate ?? 0)} moderate, ${Number(counts.low ?? 0)} low.`);
    if (critical + high === 0) return [];
    return [makeFinding('VP-DEP-001', 'repo', 'package-lock.json',
      `npm audit (production dependencies): ${critical} critical, ${high} high. Run "npm audit" for the advisory list.`,
      critical > 0 ? 'critical' : 'high')];
  } catch {
    notes.push('npm audit output could not be parsed (offline or registry error).');
    return [];
  }
}
