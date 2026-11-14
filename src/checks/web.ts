import { makeFinding } from '../findings.js';
import { scanSecrets, type SecretHit } from '../secrets.js';
import type { Finding } from '../types.js';
import { decodeJwtPayload } from '../util.js';
import type { CheckResult } from './repo.js';

export interface WebOptions {
  /** Supabase project URL, if it cannot be discovered from the bundle (self-hosted, custom domain). */
  supabaseUrl?: string;
  maxBundles: number;
  maxTables: number;
  timeoutMs: number;
}

const USER_AGENT = 'vscan-research/0.1 (read-only academic security scan)';

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
  /\.from\(\s*["'`]([A-Za-z_]\w*)["'`]\s*\)/g,
  /\/rest\/v1\/([A-Za-z_]\w*)/g,
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

  // 1. Page and response headers
  const page = await readOnlyGet(target.href, opts.timeoutMs);
  notes.push(`Page ${target.href} returned HTTP ${page.status}.`);
  findings.push(...checkHeaders(page.headers, target));

  // 2. Same-origin JavaScript bundles
  const sources: { url: string; text: string }[] = [{ url: target.href, text: page.body }];
  const thirdParty = new Set<string>();
  for (const m of page.body.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const src = new URL(m[1], target.href);
    if (src.origin !== origin) {
      thirdParty.add(src.host);
      continue;
    }
    if (sources.length > opts.maxBundles) {
      notes.push(`Bundle limit (${opts.maxBundles}) reached; remaining scripts skipped.`);
      break;
    }
    const res = await readOnlyGet(src.href, opts.timeoutMs);
    if (res.status === 200) sources.push({ url: src.href, text: res.body });
    else notes.push(`Script ${src.pathname} returned HTTP ${res.status}.`);
  }
  notes.push(`Scanned ${sources.length - 1} same-origin script(s) plus the HTML page.`);
  if (thirdParty.size) notes.push(`Third-party scripts not scanned: ${[...thirdParty].join(', ')}.`);

  // 3. Secrets, keys, Supabase config and table names in shipped code
  const supabaseUrls = new Set<string>();
  if (opts.supabaseUrl) supabaseUrls.add(new URL(opts.supabaseUrl).origin);
  const anonKeys = new Set<string>();
  const tables = new Set<string>();

  for (const src of sources) {
    for (const hit of scanSecrets(src.text)) addSecret(hit, hit.line > 1 ? `${src.url} (line ${hit.line})` : src.url);
    for (const m of src.text.matchAll(SUPABASE_URL_REGEX)) supabaseUrls.add(m[0]);
    for (const m of src.text.matchAll(JWT_REGEX)) {
      if (decodeJwtPayload(m[0])?.role === 'anon') anonKeys.add(m[0]);
    }
    for (const re of TABLE_REGEXES) for (const m of src.text.matchAll(re)) tables.add(m[1]);

    // 4. Source maps
    const mapRef = /[#@]\s*sourceMappingURL=(\S+)/.exec(src.text);
    if (mapRef && !mapRef[1].startsWith('data:')) {
      const mapUrl = new URL(mapRef[1], src.url);
      if (mapUrl.origin === origin) {
        const res = await readOnlyGet(mapUrl.href, opts.timeoutMs);
        if (res.status === 200 && /"mappings"\s*:/.test(res.body)) {
          const fileCount = /"sources"\s*:\s*\[([^\]]*)\]/.exec(res.body)?.[1].split(',').filter(Boolean).length ?? 0;
          addOnce(`map:${mapUrl.href}`, makeFinding('VSC-WEB-005', 'web', mapUrl.href, `Source map served with HTTP 200 (${fileCount} original source file(s) listed).`));
        }
      }
    }
  }

  // 5. Live Supabase RLS probe: one GET with limit=1 per table, values never stored
  const anonKey = [...anonKeys][0];
  for (const sbUrl of supabaseUrls) {
    if (!anonKey) {
      notes.push(`Supabase project ${sbUrl} found but no anon key in shipped code; table probe skipped.`);
      continue;
    }
    if (!tables.size) {
      notes.push(`Supabase project ${sbUrl} found but no table names in shipped code; table probe skipped.`);
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
        findings.push(makeFinding('VSC-DB-005', 'web', `${sbUrl}/rest/v1/${table}`,
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

  // 6. Files that should never be served
  const env = await readOnlyGet(`${origin}/.env`, opts.timeoutMs).catch(() => null);
  if (env && env.status === 200 && !/<html/i.test(env.body) && /^\s*[A-Z][A-Z0-9_]*\s*=/m.test(env.body)) {
    const names = [...env.body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]);
    findings.push(makeFinding('VSC-WEB-006', 'web', `${origin}/.env`, `Environment file served. Variable names: ${names.slice(0, 12).join(', ')}.`, 'critical'));
    for (const hit of scanSecrets(env.body)) addSecret(hit, `${origin}/.env (line ${hit.line})`);
  }
  const gitHead = await readOnlyGet(`${origin}/.git/HEAD`, opts.timeoutMs).catch(() => null);
  if (gitHead && gitHead.status === 200 && /^ref:\s/.test(gitHead.body.trim())) {
    findings.push(makeFinding('VSC-WEB-006', 'web', `${origin}/.git/HEAD`, 'Git metadata is served; the repository may be downloadable.'));
  }

  return { findings, notes };
}

export function checkHeaders(headers: Headers, target: URL): Finding[] {
  const out: Finding[] = [];
  const loc = target.href;
  const csp = headers.get('content-security-policy') ?? '';
  if (!csp) out.push(makeFinding('VSC-WEB-001', 'web', loc, 'Header absent: Content-Security-Policy.'));
  if (target.protocol === 'https:' && !headers.get('strict-transport-security')) {
    out.push(makeFinding('VSC-WEB-002', 'web', loc, 'Header absent: Strict-Transport-Security.'));
  }
  if (!headers.get('x-frame-options') && !/frame-ancestors/i.test(csp)) {
    out.push(makeFinding('VSC-WEB-003', 'web', loc, 'Headers absent: X-Frame-Options and CSP frame-ancestors.'));
  }
  if ((headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') {
    out.push(makeFinding('VSC-WEB-004', 'web', loc, 'Header absent or not "nosniff": X-Content-Type-Options.'));
  }
  return out;
}
