import { createHmac, randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Ownership verification for live web scans, the same idea as Google Search
 * Console: the scanner gives each domain a token, and the owner proves control
 * by publishing it, either as a file on the site or as a DNS TXT record.
 * Tokens are derived from a local secret, so nothing has to be stored per domain.
 */

export const VERIFY_FILE_PATH = '/.well-known/vibeproof-verification.txt';
export const DNS_PREFIX = 'vibeproof-verification=';

export interface Verification {
  verified: boolean;
  /** How ownership was proven, when verified. */
  method?: 'local' | 'file' | 'dns';
  host: string;
  token: string;
  fileUrl: string;
  dnsRecord: string;
  /** What was checked and what was found, shown to the user when verification fails. */
  checks: string[];
}

export class OwnershipError extends Error {
  constructor(public readonly verification: Verification) {
    super(`Ownership of ${verification.host} is not verified.`);
  }
}

function keyFile(): string {
  return process.env.VIBEPROOF_KEY_FILE ?? path.join(os.homedir(), '.config', 'vibeproof', 'key');
}

/** Key used before the project was renamed. Reused so existing tokens stay valid. */
const LEGACY_KEY_FILE = path.join(os.homedir(), '.config', 'vscan', 'key');

function localSecret(): Buffer {
  const file = keyFile();
  if (!existsSync(file) && !process.env.VIBEPROOF_KEY_FILE && existsSync(LEGACY_KEY_FILE)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, readFileSync(LEGACY_KEY_FILE, 'utf8'), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
}

function tokenHex(host: string): string {
  return createHmac('sha256', localSecret()).update(host.toLowerCase()).digest('hex').slice(0, 32);
}

export function tokenFor(host: string): string {
  return 'vibeproof-' + tokenHex(host);
}

/** Every value that proves ownership of host, including the pre-rename "vscan" format. */
function acceptedValues(host: string): string[] {
  const hex = tokenHex(host);
  return [`vibeproof-${hex}`, `${DNS_PREFIX}vibeproof-${hex}`, `vscan-${hex}`, `vscan-verification=vscan-${hex}`];
}

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

export interface VerifyOptions {
  /** Treat localhost as owned (default true). Tests turn this off to exercise the file check. */
  trustLocal?: boolean;
  timeoutMs?: number;
}

export async function verifyOwnership(targetUrl: string, opts: VerifyOptions = {}): Promise<Verification> {
  const url = new URL(targetUrl);
  const host = url.hostname.toLowerCase();
  const token = tokenFor(host);
  const checks: string[] = [];
  const result: Verification = {
    verified: false,
    host,
    token,
    fileUrl: `${url.origin}${VERIFY_FILE_PATH}`,
    dnsRecord: `${DNS_PREFIX}${token}`,
    checks,
  };

  if ((opts.trustLocal ?? true) && isLocalHost(host)) return { ...result, verified: true, method: 'local' };

  try {
    const res = await fetch(result.fileUrl, { redirect: 'follow', signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
    if (res.ok && (await res.text()).includes(token)) return { ...result, verified: true, method: 'file' };
    checks.push(res.ok ? 'File found, but it does not contain the token.' : `File: HTTP ${res.status}.`);
  } catch (err) {
    checks.push(`File: not reachable (${(err as Error).name === 'TimeoutError' ? 'timeout' : 'connection failed'}).`);
  }

  // Accept the full record value or the bare token, in the current or pre-rename format.
  const accepted = acceptedValues(host);
  const matches = (record: string) => accepted.includes(record.replace(/^"|"$/g, '').trim());
  const { records, source } = await lookupTxt(host);
  if (records.some(matches)) return { ...result, verified: true, method: 'dns' };
  const ours = records.filter((r) => /vibeproof|vscan/.test(r));
  checks.push(ours.length
    ? `DNS (${source}): a verification record exists but its value does not match. Found: ${ours.join(', ')}`
    : `DNS (${source}): ${records.length} TXT record(s), none with the token.`);

  return result;
}

/**
 * Read TXT records straight from the domain's authoritative nameservers, so a
 * record the owner just added is seen immediately instead of after the local
 * resolver's cache expires. Falls back to the system resolver.
 */
async function lookupTxt(host: string): Promise<{ records: string[]; source: string }> {
  const join = (rows: string[][]) => rows.map((parts) => parts.join(''));
  try {
    const labels = host.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const zone = labels.slice(i).join('.');
      let nameservers: string[];
      try {
        nameservers = await dns.resolveNs(zone);
      } catch {
        continue; // no NS at this level, try the parent zone
      }
      const ips = (await Promise.all(nameservers.slice(0, 3).map((ns) => dns.resolve4(ns).catch(() => [] as string[])))).flat();
      if (!ips.length) break;
      const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
      resolver.setServers(ips.slice(0, 4));
      return { records: join(await resolver.resolveTxt(host)), source: `authoritative ${nameservers[0]}` };
    }
  } catch {
    // fall through to the system resolver
  }
  try {
    return { records: join(await dns.resolveTxt(host)), source: 'system resolver' };
  } catch {
    return { records: [], source: 'system resolver' };
  }
}
