import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scanRepo } from './checks/repo.js';
import { scanWeb } from './checks/web.js';
import { writePdf } from './report/pdf.js';
import type { ScanReport, Track } from './types.js';
import { cloneRemote, parseRepoUrl } from './remote.js';
import { OwnershipError, verifyOwnership } from './verify.js';

/** A repository link or a local path is a repository scan; any other URL or bare domain is a web scan. */
export function detectTrack(target: string): Track {
  const t = target.trim();
  // Links to a repository on GitHub, GitLab, Bitbucket or Codeberg are repository scans.
  try {
    if (parseRepoUrl(t)) return 'repo';
  } catch {
    return 'repo'; // SSH link: the repository scan explains why it cannot be used
  }
  if (/^https?:\/\//i.test(t)) return 'web';
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t) && !t.startsWith('.') && !t.includes('\\')) return 'web';
  return 'repo';
}

export function normalizeWebTarget(target: string): string {
  const t = target.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export const TOOL = 'vibeproof';
export const VERSION = '0.3.0';

export interface ScanRequest {
  track: Track;
  target: string;
  /** repo: scan full git history (default true) */
  history?: boolean;
  /** repo: run npm audit (default false) */
  npmAudit?: boolean;
  supabaseUrl?: string;
  maxBundles?: number;
  maxTables?: number;
  /** PDF output path. JSON goes next to it unless jsonPath is set. */
  pdfPath?: string;
  jsonPath?: string;
}

export interface ScanOutput {
  report: ScanReport;
  pdfPath: string;
  jsonPath: string;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Run one scan and write its JSON and PDF. Shared by the CLI and the dashboard. */
export async function runScan(req: ScanRequest, reportsDir = 'reports'): Promise<ScanOutput> {
  const startedAt = new Date().toISOString();
  let result;
  let target = req.target;

  if (req.track === 'repo') {
    const remote = parseRepoUrl(req.target);
    const options = { history: req.history ?? true, npmAudit: req.npmAudit ?? false };
    if (remote) {
      const clone = await cloneRemote(remote, options);
      try {
        result = await scanRepo(clone.dir, options);
      } finally {
        await clone.cleanup();
      }
      result.notes.unshift(clone.note, 'Scan only repositories you own or are allowed to test.');
      target = remote.display;
    } else {
      target = path.resolve(req.target);
      result = await scanRepo(target, options);
    }
  } else if (req.track === 'web') {
    const verification = await verifyOwnership(req.target);
    if (!verification.verified) throw new OwnershipError(verification);
    result = await scanWeb(req.target, {
      supabaseUrl: req.supabaseUrl || undefined,
      maxBundles: req.maxBundles ?? 30,
      maxTables: req.maxTables ?? 25,
      timeoutMs: 15_000,
      // Only the lab demo sets this, so its Firestore check stays on this computer.
      firestoreBase: process.env.VIBEPROOF_FIRESTORE_BASE || undefined,
    });
    result.notes.unshift(verification.method === 'local'
      ? 'Target runs on this computer; ownership assumed.'
      : `Ownership of ${verification.host} verified by ${verification.method === 'dns' ? 'DNS TXT record' : 'verification file'} before scanning.`);
  } else {
    throw new Error(`Unknown scan type: ${String(req.track)}`);
  }

  const report: ScanReport = {
    tool: TOOL,
    version: VERSION,
    target,
    track: req.track,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...result,
  };

  const pdfPath = req.pdfPath ?? path.join(reportsDir, `${req.track}-${stamp()}.pdf`);
  const jsonPath = req.jsonPath ?? pdfPath.replace(/\.pdf$/i, '') + '.json';
  mkdirSync(path.dirname(path.resolve(pdfPath)), { recursive: true });
  mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  await writePdf(report, pdfPath);
  return { report, pdfPath, jsonPath };
}
