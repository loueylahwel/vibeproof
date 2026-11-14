import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scanRepo } from './checks/repo.js';
import { scanWeb } from './checks/web.js';
import { writePdf } from './report/pdf.js';
import type { ScanReport, Track } from './types.js';

export const TOOL = 'vibe-security-scanner';
export const VERSION = '0.2.0';

export interface ScanRequest {
  track: Track;
  target: string;
  /** repo: scan full git history (default true) */
  history?: boolean;
  /** repo: run npm audit (default false) */
  npmAudit?: boolean;
  /** web: operator confirms ownership or written permission. Required for web scans. */
  authorized?: boolean;
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
    target = path.resolve(req.target);
    result = await scanRepo(target, { history: req.history ?? true, npmAudit: req.npmAudit ?? false });
  } else if (req.track === 'web') {
    if (req.authorized !== true) {
      throw new Error('Web scans need confirmation that you own the app or have written permission to test it.');
    }
    result = await scanWeb(req.target, {
      supabaseUrl: req.supabaseUrl || undefined,
      maxBundles: req.maxBundles ?? 30,
      maxTables: req.maxTables ?? 25,
      timeoutMs: 15_000,
    });
    result.notes.unshift('Operator confirmed authorization to test this target.');
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
