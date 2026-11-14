import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile, unlink } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTrack, normalizeWebTarget, runScan, VERSION } from '../run.js';
import { OwnershipError } from '../verify.js';
import { SEVERITY_ORDER, type ScanReport, type Severity } from '../types.js';

/**
 * Local dashboard. It can read files on this machine and start scans, so it is
 * locked down: it listens on 127.0.0.1 only, rejects foreign Host headers
 * (DNS rebinding), and requires a custom header on every state-changing request
 * so another website cannot trigger scans through the browser (CSRF).
 */

const STATIC_DIR = fileURLToPath(new URL('../../dashboard/', import.meta.url));
const STATIC_FILES: Record<string, string> = {
  '/': 'index.html',
  '/app.js': 'app.js',
  '/styles.css': 'styles.css',
};
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_BODY = 64 * 1024;

export interface DashboardOptions {
  port?: number;
  reportsDir?: string;
  quiet?: boolean;
}

export interface Dashboard {
  url: string;
  close: () => Promise<void>;
}

export interface ReportSummary {
  id: string;
  target: string;
  track: string;
  finishedAt: string;
  total: number;
  counts: Record<Severity, number>;
  rating: Severity | 'none';
  hasPdf: boolean;
}

function summarize(id: string, report: ScanReport, hasPdf: boolean): ReportSummary {
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, report.findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  return {
    id,
    target: report.target,
    track: report.track,
    finishedAt: report.finishedAt,
    total: report.findings.length,
    counts,
    rating: SEVERITY_ORDER.find((s) => counts[s] > 0) ?? 'none',
    hasPdf,
  };
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export async function startDashboard(opts: DashboardOptions = {}): Promise<Dashboard> {
  const reportsDir = path.resolve(opts.reportsDir ?? 'reports');
  let busy = false;
  let allowedHosts = new Set<string>();

  const send = (res: http.ServerResponse, status: number, body: string | Buffer, type = 'application/json; charset=utf-8', extra: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': type, ...SECURITY_HEADERS, ...extra });
    res.end(body);
  };
  const json = (res: http.ServerResponse, status: number, data: unknown) => send(res, status, JSON.stringify(data));

  const readJson = async (req: http.IncomingMessage): Promise<Record<string, unknown>> => {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new Error('Request body too large.');
      chunks.push(chunk as Buffer);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Expected a JSON object.');
    return data as Record<string, unknown>;
  };

  const loadReport = async (id: string): Promise<ScanReport | null> => {
    if (!ID_RE.test(id)) return null;
    try {
      return JSON.parse(await readFile(path.join(reportsDir, `${id}.json`), 'utf8')) as ScanReport;
    } catch {
      return null;
    }
  };

  const listReports = async (): Promise<ReportSummary[]> => {
    const files = await readdir(reportsDir).catch(() => [] as string[]);
    const out: ReportSummary[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      const report = await loadReport(id);
      if (!report || !Array.isArray(report.findings)) continue;
      out.push(summarize(id, report, existsSync(path.join(reportsDir, `${id}.pdf`))));
    }
    return out.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!allowedHosts.has(req.headers.host ?? '')) return json(res, 403, { error: 'Host not allowed.' });
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) return json(res, 403, { error: 'Cross-origin request refused.' });
      if (req.headers['x-vibeproof'] !== '1') return json(res, 403, { error: 'Missing x-vibeproof header.' });
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;

    if (method === 'GET' && STATIC_FILES[p]) {
      const file = path.join(STATIC_DIR, STATIC_FILES[p]);
      return send(res, 200, await readFile(file), MIME[path.extname(file)]);
    }

    if (method === 'GET' && p === '/api/info') {
      return json(res, 200, { version: VERSION, reportsDir, busy, cwd: process.cwd() });
    }

    if (method === 'GET' && p === '/api/reports') return json(res, 200, await listReports());

    let m = /^\/api\/reports\/([^/]+)$/.exec(p);
    if (m && method === 'GET') {
      const report = await loadReport(m[1]);
      return report ? json(res, 200, { id: m[1], ...report }) : json(res, 404, { error: 'Report not found.' });
    }
    if (m && method === 'DELETE') {
      const id = m[1];
      if (!ID_RE.test(id) || !(await loadReport(id))) return json(res, 404, { error: 'Report not found.' });
      await unlink(path.join(reportsDir, `${id}.json`));
      await unlink(path.join(reportsDir, `${id}.pdf`)).catch(() => undefined);
      return json(res, 200, { deleted: id });
    }

    m = /^\/reports\/([^/]+)\.(pdf|json)$/.exec(p);
    if (m && method === 'GET') {
      const [, id, ext] = m;
      const file = path.join(reportsDir, `${id}.${ext}`);
      if (!ID_RE.test(id) || !existsSync(file)) return json(res, 404, { error: 'File not found.' });
      const disposition = url.searchParams.has('download') ? 'attachment' : 'inline';
      res.writeHead(200, {
        'content-type': ext === 'pdf' ? 'application/pdf' : 'application/json; charset=utf-8',
        'content-disposition': `${disposition}; filename="${id}.${ext}"`,
        ...SECURITY_HEADERS,
      });
      createReadStream(file).pipe(res);
      return;
    }

    if (method === 'POST' && p === '/api/scan') {
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'Send JSON.' });
      if (busy) return json(res, 409, { error: 'A scan is already running. Wait for it to finish.' });
      const body = await readJson(req);
      const target = typeof body.target === 'string' ? body.target.trim() : '';
      if (!target) return json(res, 400, { error: 'Enter a repository path or a URL.' });
      const track = body.track === 'repo' || body.track === 'web' ? body.track : detectTrack(target);
      busy = true;
      try {
        const out = await runScan({
          track,
          target: track === 'repo' ? expandHome(target) : normalizeWebTarget(target),
          history: body.history !== false,
          npmAudit: body.npmAudit === true,
          supabaseUrl: typeof body.supabaseUrl === 'string' && body.supabaseUrl.trim() ? body.supabaseUrl.trim() : undefined,
        }, reportsDir);
        const id = path.basename(out.jsonPath, '.json');
        return json(res, 200, summarize(id, out.report, true));
      } catch (err) {
        if (err instanceof OwnershipError) return json(res, 403, { error: err.message, verification: err.verification });
        return json(res, 400, { error: (err as Error).message });
      } finally {
        busy = false;
      }
    }

    return json(res, 404, { error: 'Not found.' });
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) json(res, 500, { error: (err as Error).message });
      else res.end();
    });
  });

  const requested = opts.port ?? Number(process.env.PORT ?? 4173);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requested, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const url = `http://localhost:${port}`;
  if (!opts.quiet) console.log(`vibeproof dashboard running at ${url}  (reports: ${reportsDir})\nPress Ctrl+C to stop.`);
  return { url, close: () => new Promise((r) => server.close(() => r())) };
}
