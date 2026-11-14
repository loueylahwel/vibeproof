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

export const VERIFY_FILE_PATH = '/.well-known/vscan-verification.txt';
export const DNS_PREFIX = 'vscan-verification=';

export interface Verification {
  verified: boolean;
  /** How ownership was proven, when verified. */
  method?: 'local' | 'file' | 'dns';
  host: string;
  token: string;
  fileUrl: string;
  dnsRecord: string;
}

export class OwnershipError extends Error {
  constructor(public readonly verification: Verification) {
    super(`Ownership of ${verification.host} is not verified.`);
  }
}

function keyFile(): string {
  return process.env.VSCAN_KEY_FILE ?? path.join(os.homedir(), '.config', 'vscan', 'key');
}

function localSecret(): Buffer {
  const file = keyFile();
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
}

export function tokenFor(host: string): string {
  return 'vscan-' + createHmac('sha256', localSecret()).update(host.toLowerCase()).digest('hex').slice(0, 32);
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
  const result: Verification = {
    verified: false,
    host,
    token,
    fileUrl: `${url.origin}${VERIFY_FILE_PATH}`,
    dnsRecord: `${DNS_PREFIX}${token}`,
  };

  if ((opts.trustLocal ?? true) && isLocalHost(host)) return { ...result, verified: true, method: 'local' };

  try {
    const res = await fetch(result.fileUrl, { redirect: 'follow', signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
    if (res.ok && (await res.text()).includes(token)) return { ...result, verified: true, method: 'file' };
  } catch {
    // unreachable or no file; try DNS
  }

  try {
    const records = (await dns.resolveTxt(host)).map((parts) => parts.join(''));
    if (records.some((r) => r.trim() === result.dnsRecord)) return { ...result, verified: true, method: 'dns' };
  } catch {
    // no TXT records
  }

  return result;
}
