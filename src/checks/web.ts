import { makeFinding } from '../findings.js';
import { scanSecrets, type SecretHit } from '../secrets.js';
import type { Finding, Progress } from '../types.js';
import { decodeJwtPayload } from '../util.js';
import type { CheckResult } from './repo.js';

export interface WebOptions {
  /** Supabase project URL, if it cannot be discovered from the bundle (self-hosted, custom domain). */
  supabaseUrl?: string;
  maxBundles: number;
  maxTables: number;
  timeoutMs: number;
  /** Firestore REST base URL. Tests point it at a local server. */
  firestoreBase?: string;
  progress?: Progress;
}

const USER_AGENT = 'vibeproof/0.3 (read-only academic security scan)';

interface HttpResult {
  status: number;
  headers: Headers;
  body: string;
}

/**
 * The only network primitive in the browser track. It can only send GET requests,
 * so the scanner cannot modify data on the target even by mistake.
 */
async function readOnlyGet(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<HttpResult> {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.text()).slice(0, 5_000_000);
  return { status: res.status, headers: res.headers, body };
}

const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SUPABASE_URL_REGEX = /https:\/\/[a-z0-9]{20}\.supabase\.co\b/g;
const TABLE_REGEXES = [
  /(?<!storage\s*)\.from\(\s*["'`]([A-Za-z_]\w*)["'`]\s*\)/g,
  /\/rest\/v1\/([A-Za-z_]\w*)/g,
];
const BUCKET_REGEXES = [
  /\.storage\s*\.from\(\s*["'`]([\w.-]+)["'`]\s*\)/g,
  /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([\w.-]+)\//g,
];
const FIRESTORE_COLLECTION_REGEXES = [
  /\b(?:collection|doc)\(\s*\w+\s*,\s*["'`]([\w-]+)["'`]/g,
  /\.collection\(\s*["'`]([\w-]+)["'`]\s*\)/g,
];

export async function scanWeb(targetInput: string, opts: WebOptions): Promise<CheckResult> {
  const target = new URL(targetInput);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be scanned.');
  }
  const origin = target.origin;
  const findings: Finding[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const addOnce = (key: string, f: Finding) => {
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };
  const addSecret = (hit: SecretHit, location: string) =>
    addOnce(`secret:${hit.fingerprint}`, makeFinding(hit.ruleId, 'web', location, `${hit.patternName}: ${hit.evidence}`, hit.severity));

  const step = opts.progress ?? (() => undefined);
  // 1. Page and response headers
  step('Loading the page');
  const page = await readOnlyGet(target.href, opts.timeoutMs);
  notes.push(`Page ${target.href} returned HTTP ${page.status}.`);
  findings.push(...checkHeaders(page.headers, target));

  // 2. Same-origin JavaScript: script tags, modulepreload links, and every chunk
  //    those scripts load later (dynamic import(), Vite preload lists, Next.js chunks).
  const sources: { url: string; text: string }[] = [{ url: target.href, text: page.body }];
  const thirdParty = new Set<string>();
  const queue: URL[] = [];
  const queued = new Set<string>();
  const enqueue = (ref: string, relativeTo: string) => {
    let url: URL;
    try {
      url = new URL(ref, relativeTo);
    } catch {
      return;
    }
    if (url.origin !== origin) {
      thirdParty.add(url.host);
      return;
    }
    url.hash = '';
    if (!queued.has(url.href)) {
      queued.add(url.href);
      queue.push(url);
    }
  };
  for (const m of page.body.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) enqueue(m[1], target.href);
  for (const m of page.body.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/gi)) enqueue(m[1], target.href);

  step('Reading JavaScript bundles');
  let lazy = 0;
  while (queue.length) {
    if (sources.length > opts.maxBundles) {
      notes.push(`Bundle limit (${opts.maxBundles}) reached; ${queue.length} script(s) not scanned.`);
      break;
    }
    const src = queue.shift() as URL;
    const res = await readOnlyGet(src.href, opts.timeoutMs).catch(() => null);
    if (res?.status !== 200 || /^\s*</.test(res.body)) {
      notes.push(`Script ${src.pathname} ${res ? `returned HTTP ${res.status}` : 'could not be fetched'}${res?.status === 200 ? ' (HTML, not JavaScript)' : ''}.`);
      continue;
    }
    sources.push({ url: src.href, text: res.body });
    const before = queue.length;
    for (const ref of chunkReferences(res.body)) enqueue(ref.path, ref.fromRoot ? `${origin}/` : src.href);
    lazy += queue.length - before;
  }
  notes.push(`Scanned ${sources.length - 1} same-origin script(s) plus the HTML page${lazy ? `, including ${lazy} lazily loaded chunk(s)` : ''}.`);
  if (thirdParty.size) notes.push(`Third-party scripts not scanned: ${[...thirdParty].join(', ')}.`);

  // 3. Secrets, keys, Supabase config and table names in shipped code
  step('Looking for secrets and source maps');
  const supabaseUrls = new Set<string>();
  if (opts.supabaseUrl) supabaseUrls.add(new URL(opts.supabaseUrl).origin);
  const anonKeys = new Set<string>();
  const tables = new Set<string>();
  const buckets = new Set<string>();

  for (const src of sources) {
    for (const hit of scanSecrets(src.text)) addSecret(hit, hit.line > 1 ? `${src.url} (line ${hit.line})` : src.url);
    for (const m of src.text.matchAll(SUPABASE_URL_REGEX)) supabaseUrls.add(m[0]);
    for (const m of src.text.matchAll(JWT_REGEX)) {
      if (decodeJwtPayload(m[0])?.role === 'anon') anonKeys.add(m[0]);
    }
    for (const re of TABLE_REGEXES) for (const m of src.text.matchAll(re)) tables.add(m[1]);
    for (const re of BUCKET_REGEXES) for (const m of src.text.matchAll(re)) buckets.add(m[1]);

    // 4. Source maps
    const mapRef = /[#@]\s*sourceMappingURL=(\S+)/.exec(src.text);
    if (mapRef && !mapRef[1].startsWith('data:')) {
      const mapUrl = new URL(mapRef[1], src.url);
      if (mapUrl.origin === origin) {
        const res = await readOnlyGet(mapUrl.href, opts.timeoutMs);
        if (res.status === 200 && /"mappings"\s*:/.test(res.body)) {
          const fileCount = /"sources"\s*:\s*\[([^\]]*)\]/.exec(res.body)?.[1].split(',').filter(Boolean).length ?? 0;
          addOnce(`map:${mapUrl.href}`, makeFinding('VP-WEB-005', 'web', mapUrl.href, `Source map served with HTTP 200 (${fileCount} original source file(s) listed).`));
        }
      }
    }
  }

  // 5. Live Supabase RLS probe: one GET with limit=1 per table, values never stored
  const anonKey = [...anonKeys][0];
  if (supabaseUrls.size) step('Probing the Supabase API (read-only)');
  for (const sbUrl of supabaseUrls) {
    if (!anonKey) {
      notes.push(`Supabase project ${sbUrl} found but no anon key in shipped code; table probe skipped.`);
      continue;
    }
    const anonHeaders = { apikey: anonKey, authorization: `Bearer ${anonKey}`, accept: 'application/json' };

    // Schema discovery: the REST root may list every exposed table, including ones the bundle never names.
    const root = await readOnlyGet(`${sbUrl}/rest/v1/`, opts.timeoutMs, { ...anonHeaders, accept: 'application/openapi+json, application/json' }).catch(() => null);
    if (root?.status === 200) {
      try {
        const paths = Object.keys((JSON.parse(root.body) as { paths?: Record<string, unknown> }).paths ?? {});
        const listed = paths.map((p) => p.slice(1)).filter((n) => /^[A-Za-z_]\w*$/.test(n));
        const rpcs = paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5));
        if (listed.length || rpcs.length) {
          const hidden = listed.filter((n) => !tables.has(n));
          listed.forEach((n) => tables.add(n));
          findings.push(makeFinding('VP-DB-009', 'web', `${sbUrl}/rest/v1/`,
            `Schema lists ${listed.length} table(s) or view(s) and ${rpcs.length} function(s): ${listed.slice(0, 12).join(', ')}${listed.length > 12 ? ', ...' : ''}.`));
          if (hidden.length) notes.push(`Tables found only through the API schema (not named in shipped code): ${hidden.join(', ')}.`);
          if (rpcs.length) notes.push(`Database functions exposed at /rest/v1/rpc (not called; calling them needs POST): ${rpcs.join(', ')}.`);
        }
      } catch {
        // not an OpenAPI document
      }
    }

    // Storage buckets named in shipped code: GET bucket metadata only (listing files needs POST).
    for (const bucket of [...buckets].slice(0, 10)) {
      const res = await readOnlyGet(`${sbUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, opts.timeoutMs, anonHeaders).catch(() => null);
      if (res?.status !== 200) continue;
      try {
        if ((JSON.parse(res.body) as { public?: boolean }).public === true) {
          findings.push(makeFinding('VP-STO-002', 'web', `${sbUrl}/storage/v1/bucket/${bucket}`, `Bucket "${bucket}" is public: every file in it is downloadable by URL.`));
        }
      } catch {
        // ignore
      }
    }

    if (!tables.size) {
      notes.push(`Supabase project ${sbUrl} found but no table names in shipped code or API schema; table probe skipped.`);
      continue;
    }
    const list = [...tables].slice(0, opts.maxTables);
    const protectedTables: string[] = [];
    const emptyTables: string[] = [];
    for (const table of list) {
      const url = `${sbUrl}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`;
      let res: HttpResult;
      try {
        res = await readOnlyGet(url, opts.timeoutMs, { apikey: anonKey, authorization: `Bearer ${anonKey}`, accept: 'application/json' });
      } catch (err) {
        notes.push(`Probe of table ${table} failed: ${(err as Error).message}`);
        continue;
      }
      if (res.status !== 200) {
        protectedTables.push(`${table} (HTTP ${res.status})`);
        continue;
      }
      let rows: unknown;
      try {
        rows = JSON.parse(res.body);
      } catch {
        continue;
      }
      if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
        const columns = Object.keys(rows[0] as object);
        findings.push(makeFinding('VP-DB-005', 'web', `${sbUrl}/rest/v1/${table}`,
          `Anon key returned a row (probe used limit=1). Columns exposed: ${columns.join(', ')}. Row values were not stored.`));
      } else {
        emptyTables.push(table);
      }
    }
    notes.push(`Supabase probe on ${sbUrl}: ${list.length} table(s) tested with the anon key using GET only.`);
    if (protectedTables.length) notes.push(`Tables that refused the anon key: ${protectedTables.join(', ')}.`);
    if (emptyTables.length) notes.push(`Tables that answered with no rows (RLS filter or empty table): ${emptyTables.join(', ')}.`);
  }
  if (!supabaseUrls.size) notes.push('No Supabase project URL found in shipped code.');

  // 5b. Firebase: unauthenticated read-only requests to the backend named in the app's own config
  const allCode = sources.map((s) => s.text).join('\n');
  const projectId = /projectId\s*:\s*["']([\w-]+)["']/.exec(allCode)?.[1];
  const databaseUrl = /databaseURL\s*:\s*["'](https?:\/\/[^"']+)["']/.exec(allCode)?.[1];
  if (projectId || databaseUrl) {
    step('Probing Firebase (read-only)');
    notes.push(`Firebase config found${projectId ? ` (project ${projectId})` : ''}.`);
    if (databaseUrl) {
      const res = await readOnlyGet(`${databaseUrl.replace(/\/$/, '')}/.json?shallow=true`, opts.timeoutMs).catch(() => null);
      if (res?.status === 200 && res.body.trim() !== 'null') {
        let keys: string[] = [];
        try {
          const data: unknown = JSON.parse(res.body);
          keys = typeof data === 'object' && data !== null ? Object.keys(data) : [];
        } catch {
          // ignore
        }
        findings.push(makeFinding('VP-FB-003', 'web', `${databaseUrl}/.json`,
          `Realtime Database root readable without signing in. Top-level keys: ${keys.slice(0, 12).join(', ') || '(value)'}. Values were not stored.`));
      } else if (res) {
        notes.push(`Realtime Database root refused anonymous read (HTTP ${res.status}).`);
      }
    }
    if (projectId) {
      const collections = new Set<string>();
      for (const re of FIRESTORE_COLLECTION_REGEXES) for (const m of allCode.matchAll(re)) collections.add(m[1]);
      const refused: string[] = [];
      for (const col of [...collections].slice(0, 10)) {
        const url = `${opts.firestoreBase ?? 'https://firestore.googleapis.com'}/v1/projects/${projectId}/databases/(default)/documents/${encodeURIComponent(col)}?pageSize=1`;
        const res = await readOnlyGet(url, opts.timeoutMs).catch(() => null);
        if (res?.status !== 200) {
          refused.push(`${col} (${res ? `HTTP ${res.status}` : 'no response'})`);
          continue;
        }
        try {
          const docs = (JSON.parse(res.body) as { documents?: { fields?: Record<string, unknown> }[] }).documents ?? [];
          if (docs.length) {
            findings.push(makeFinding('VP-FB-003', 'web', `firestore: ${projectId}/${col}`,
              `Collection "${col}" returned a document without signing in. Fields exposed: ${Object.keys(docs[0].fields ?? {}).join(', ') || '(none)'}. Values were not stored.`));
          }
        } catch {
          // ignore
        }
      }
      if (collections.size) notes.push(`Firestore: ${collections.size} collection(s) named in shipped code tested anonymously.`);
      if (refused.length) notes.push(`Firestore collections that refused anonymous read: ${refused.join(', ')}.`);
    }
  }

  // 6. Files that should never be served
  step('Checking for exposed files');
  const env = await readOnlyGet(`${origin}/.env`, opts.timeoutMs).catch(() => null);
  if (env && env.status === 200 && !/<html/i.test(env.body) && /^\s*[A-Z][A-Z0-9_]*\s*=/m.test(env.body)) {
    const names = [...env.body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]);
    findings.push(makeFinding('VP-WEB-006', 'web', `${origin}/.env`, `Environment file served. Variable names: ${names.slice(0, 12).join(', ')}.`, 'critical'));
    for (const hit of scanSecrets(env.body)) addSecret(hit, `${origin}/.env (line ${hit.line})`);
  }
  const gitHead = await readOnlyGet(`${origin}/.git/HEAD`, opts.timeoutMs).catch(() => null);
  if (gitHead && gitHead.status === 200 && /^ref:\s/.test(gitHead.body.trim())) {
    findings.push(makeFinding('VP-WEB-006', 'web', `${origin}/.git/HEAD`, 'Git metadata is served; the repository may be downloadable.'));
  }

  return { findings, notes };
}

/**
 * Script paths a bundle may load later. Dynamic import() paths are relative to
 * the bundle; Vite preload lists ("assets/x.js") and Next.js chunk paths
 * ("_next/static/chunks/x.js") are relative to the site root.
 */
export function chunkReferences(code: string): { path: string; fromRoot: boolean }[] {
  const refs: { path: string; fromRoot: boolean }[] = [];
  for (const m of code.matchAll(/\bimport\(\s*["'`]([^"'`\s]+\.m?js)["'`]\s*\)/g)) refs.push({ path: m[1], fromRoot: false });
  for (const m of code.matchAll(/["'`]\/?((?:assets|_next\/static\/chunks)\/[\w.\-/[\]]+\.m?js)["'`]/g)) refs.push({ path: m[1], fromRoot: true });
  return refs;
}

export function checkHeaders(headers: Headers, target: URL): Finding[] {
  const out: Finding[] = [];
  const loc = target.href;
  const csp = headers.get('content-security-policy') ?? '';
  if (!csp) out.push(makeFinding('VP-WEB-001', 'web', loc, 'Header absent: Content-Security-Policy.'));
  if (target.protocol === 'https:' && !headers.get('strict-transport-security')) {
    out.push(makeFinding('VP-WEB-002', 'web', loc, 'Header absent: Strict-Transport-Security.'));
  }
  if (!headers.get('x-frame-options') && !/frame-ancestors/i.test(csp)) {
    out.push(makeFinding('VP-WEB-003', 'web', loc, 'Headers absent: X-Frame-Options and CSP frame-ancestors.'));
  }
  if ((headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') {
    out.push(makeFinding('VP-WEB-004', 'web', loc, 'Header absent or not "nosniff": X-Content-Type-Options.'));
  }
  return out;
}
