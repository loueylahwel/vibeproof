import { makeFinding } from '../findings.js';
import type { Finding, Severity } from '../types.js';
import { lineOf } from '../util.js';

/**
 * Static checks for backend configuration that vibe-coded apps ship alongside
 * their front end: Supabase storage, privileged SQL functions, edge functions,
 * and Firebase security rules.
 */

export interface TextFile {
  rel: string;
  text: string;
}

export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '');
}

const WRITE_COMMANDS = new Set(['insert', 'update', 'delete', 'all']);

function policyRoles(body: string): string[] {
  const m = /\bto\s+([\w\s,]+?)(?=\s+using\b|\s+with\b|$)/i.exec(body);
  return m ? m[1].toLowerCase().split(/[\s,]+/).filter(Boolean) : ['public'];
}

function policyCommand(body: string): string {
  return (/\bfor\s+(select|insert|update|delete|all)\b/i.exec(body)?.[1] ?? 'all').toLowerCase();
}

/* ---------------- Supabase storage and privileged functions ---------------- */

export function auditSupabaseSql(files: TextFile[], notes: string[]): Finding[] {
  const findings: Finding[] = [];
  const all = files.map((f) => ({ ...f, text: stripSqlComments(f.text) }));
  const everything = all.map((f) => f.text).join('\n;\n');

  let definerCount = 0;
  for (const { rel, text } of all) {
    // Storage policies
    const storagePolicy = /create\s+policy\s+("[^"]*"|\w+)\s+on\s+"?storage"?\."?objects"?([^;]*);/gi;
    for (const m of text.matchAll(storagePolicy)) {
      const [, name, body] = m;
      const roles = policyRoles(body);
      const command = policyCommand(body);
      const checksUser = /auth\.uid\s*\(\)|auth\.jwt\s*\(\)|auth\.role\s*\(\)|auth\.email\s*\(\)/i.test(body);
      if (checksUser) continue;
      const anon = roles.includes('anon') || roles.includes('public');
      const write = WRITE_COMMANDS.has(command);
      let severity: Severity | null = null;
      if (anon) severity = write ? 'critical' : 'medium';
      else if (roles.includes('authenticated') && write) severity = 'medium';
      if (!severity) continue;
      const bucket = /bucket_id\s*=\s*'([^']+)'/i.exec(body)?.[1];
      findings.push(makeFinding('VP-STO-001', 'repo', `${rel}:${lineOf(text, m.index ?? 0)}`,
        `Policy ${name} on storage.objects${bucket ? ` (bucket "${bucket}")` : ' (all buckets)'}: for ${command}, to ${roles.join(', ')}, no check of the user.`, severity));
    }

    // Public buckets created in migrations
    const bucketInsert = /insert\s+into\s+"?storage"?\."?buckets"?\s*\(([^)]*)\)\s*values\s*([\s\S]*?);/gi;
    for (const m of text.matchAll(bucketInsert)) {
      const cols = m[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase());
      const iPublic = cols.indexOf('public');
      const iId = cols.indexOf('id') >= 0 ? cols.indexOf('id') : cols.indexOf('name');
      if (iPublic < 0) continue;
      for (const tuple of m[2].matchAll(/\(([^)]*)\)/g)) {
        const values = tuple[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
        if (values[iPublic]?.toLowerCase() === 'true') {
          findings.push(makeFinding('VP-STO-002', 'repo', `${rel}:${lineOf(text, m.index ?? 0)}`, `Bucket "${values[iId] ?? '?'}" is created with public = true.`));
        }
      }
    }

    // security definer functions
    const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;
    for (const m of text.matchAll(fnRe)) {
      const schema = (m[1] ?? 'public').toLowerCase();
      const name = m[2];
      const start = m.index ?? 0;
      const tagMatch = /\$(\w*)\$/g;
      tagMatch.lastIndex = start;
      const open = tagMatch.exec(text);
      let attrs: string;
      if (open) {
        const tag = open[0];
        const bodyEnd = text.indexOf(tag, open.index + tag.length);
        const after = bodyEnd < 0 ? text.length : bodyEnd + tag.length;
        const semi = text.indexOf(';', after);
        attrs = text.slice(start, open.index) + ' ' + text.slice(after, semi < 0 ? text.length : semi);
      } else {
        const semi = text.indexOf(';', start);
        attrs = text.slice(start, semi < 0 ? text.length : semi);
      }
      if (!/security\s+definer/i.test(attrs)) continue;
      definerCount++;
      const location = `${rel}:${lineOf(text, start)}`;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const searchPathSet = /set\s+search_path/i.test(attrs)
        || new RegExp(String.raw`alter\s+function\s+(?:"?\w+"?\.)?"?${escaped}"?\b[^;]*set\s+search_path`, 'i').test(everything);
      if (!searchPathSet) {
        findings.push(makeFinding('VP-DB-008', 'repo', location, `Function ${schema}.${name} is security definer and does not set search_path.`));
      }

      if (schema !== 'public' || /returns\s+(?:trigger|event_trigger)\b/i.test(attrs)) continue;
      const revokeRe = new RegExp(String.raw`revoke\s[^;]*?\bon\s+(?:function\s+(?:"?public"?\.)?"?${escaped}"?\b|all\s+functions\s+in\s+schema\s+public)[^;]*\bfrom\s+([^;]+);`, 'gi');
      const revokedFromAnon = [...everything.matchAll(revokeRe)].some((r) => /\banon\b/i.test(r[1]));
      if (!revokedFromAnon) {
        findings.push(makeFinding('VP-DB-007', 'repo', location,
          `Function public.${name} is security definer and EXECUTE is not revoked from anon; callable at /rest/v1/rpc/${name}.`));
      }
    }
  }
  if (definerCount) notes.push(`SQL audit: ${definerCount} security definer function(s) found.`);
  return findings;
}

/* ---------------- Supabase edge functions ---------------- */

const CALLER_CHECK = /auth\.getUser\s*\(|getClaims\s*\(|jwtVerify\s*\(|verifyJwt|jwt\.verify\s*\(/i;
const SIGNATURE_CHECK = /signature|constructEvent|timingSafeEqual|crypto\.subtle\.verify|svix|webhook[_-]?secret/i;

export function auditEdgeFunctions(files: TextFile[], notes: string[]): Finding[] {
  const findings: Finding[] = [];
  const fns = new Map<string, TextFile[]>();
  let shared = '';
  for (const f of files) {
    const m = /^supabase\/functions\/([^/]+)\//.exec(f.rel);
    if (!m) continue;
    if (m[1] === '_shared') shared += `\n${f.text}`;
    else if (!m[1].startsWith('.') && !m[1].startsWith('_')) fns.set(m[1], [...(fns.get(m[1]) ?? []), f]);
  }
  if (!fns.size) return findings;

  const config = files.find((f) => f.rel === 'supabase/config.toml')?.text ?? '';
  const jwtOff = new Set<string>();
  for (const m of config.matchAll(/\[functions\.("?)([\w-]+)\1\]([\s\S]*?)(?=\n\s*\[|$)/g)) {
    if (/^\s*verify_jwt\s*=\s*false/m.test(m[3])) jwtOff.add(m[2]);
  }

  for (const [name, parts] of fns) {
    const code = parts.map((p) => p.text).join('\n') + (parts.some((p) => p.text.includes('_shared')) ? shared : '');
    const entry = parts.find((p) => /\/index\.[jt]sx?$/.test(p.rel))?.rel ?? parts[0].rel;
    const checked = CALLER_CHECK.test(code) || SIGNATURE_CHECK.test(code);
    const usesServiceRole = /service_role/i.test(code);
    const open = jwtOff.has(name);
    if (usesServiceRole && !checked) {
      findings.push(makeFinding('VP-FN-001', 'repo', entry,
        `Function "${name}" uses the service_role key and never verifies the caller${open ? '; JWT verification is also off, so it needs no key at all' : ''}.`,
        open ? 'critical' : 'high'));
    } else if (open && !checked) {
      findings.push(makeFinding('VP-FN-002', 'repo', entry, `Function "${name}" has verify_jwt = false in supabase/config.toml and no auth or signature check in its code.`));
    }
  }
  notes.push(`Edge functions: ${fns.size} found, ${jwtOff.size} with JWT verification turned off.`);
  return findings;
}

/* ---------------- Firebase security rules ---------------- */

const FIREBASE_WRITE = /\b(write|create|update|delete)\b/;

export function auditFirebase(files: TextFile[], notes: string[]): Finding[] {
  const findings: Finding[] = [];
  let checked = 0;

  for (const { rel, text: raw } of files) {
    const base = rel.split('/').pop() ?? rel;
    if (base.endsWith('.rules') && /service\s+(cloud\.firestore|firebase\.storage)|rules_version/.test(raw)) {
      checked++;
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
      for (const m of text.matchAll(/\ballow\s+([\w\s,]+?)\s*(?::\s*if\s+([^;]+))?;/g)) {
        const ops = m[1].trim().replace(/\s+/g, ' ');
        const cond = m[2]?.trim().replace(/\s+/g, ' ');
        const before = text.slice(0, m.index ?? 0);
        const path = [...before.matchAll(/match\s+(\/\S+)\s*\{/g)].pop()?.[1] ?? '?';
        const shown = `match ${path}: allow ${ops}${cond ? `: if ${cond}` : ''};`;
        const location = `${rel}:${lineOf(text, m.index ?? 0)}`;
        if (!cond || /^true$/i.test(cond)) {
          findings.push(makeFinding('VP-FB-001', 'repo', location, shown, FIREBASE_WRITE.test(ops) ? 'critical' : 'high'));
        } else if (/request\.time\s*<\s*timestamp\.date/i.test(cond)) {
          findings.push(makeFinding('VP-FB-002', 'repo', location, shown));
        }
      }
    }

    if (base === 'database.rules.json') {
      checked++;
      let rules: unknown;
      try {
        rules = JSON.parse(raw.replace(/^\s*\/\/[^\n]*/gm, ''));
      } catch {
        notes.push(`${rel} could not be parsed as JSON.`);
        continue;
      }
      const walk = (node: unknown, trail: string) => {
        if (typeof node !== 'object' || node === null) return;
        for (const [key, value] of Object.entries(node)) {
          if (key === '.read' || key === '.write') {
            const shown = `"${trail || '/'}" ${key}: ${JSON.stringify(value)}`;
            if (value === true || value === 'true') {
              findings.push(makeFinding('VP-FB-001', 'repo', rel, shown, key === '.write' ? 'critical' : 'high'));
            } else if (typeof value === 'string' && /\bnow\s*</.test(value)) {
              findings.push(makeFinding('VP-FB-002', 'repo', rel, shown));
            }
          } else if (!key.startsWith('.')) {
            walk(value, `${trail}/${key}`);
          }
        }
      };
      walk((rules as { rules?: unknown }).rules ?? rules, '');
    }
  }
  if (checked) notes.push(`Firebase: ${checked} rules file(s) checked.`);
  return findings;
}
