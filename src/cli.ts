#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { scanRepo } from './checks/repo.js';
import { scanWeb } from './checks/web.js';
import { writePdf } from './report/pdf.js';
import { SEVERITY_ORDER, type ScanReport, type Track } from './types.js';

const TOOL = 'vibe-security-scanner';
const VERSION = '0.1.0';

const HELP = `vscan ${VERSION} - security scanner for vibe-coded web apps (academic project)

Usage:
  vscan repo <path>  [--out report.pdf] [--json report.json] [--no-history] [--npm-audit]
  vscan web  <url>   --authorized [--supabase-url <url>] [--max-bundles 30] [--max-tables 25]
                     [--out report.pdf] [--json report.json]
  vscan report <scan.json> --out report.pdf

Rules of engagement:
  The web command only sends GET requests, but it still touches a live system.
  Run it only against apps you own or have written permission to test, and pass
  --authorized to confirm that. Reports never contain full secret values.
`;

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function outputPaths(track: Track, out?: string, json?: string): { pdf: string; json: string } {
  const pdf = out ?? path.join('reports', `${track}-${stamp()}.pdf`);
  return { pdf, json: json ?? pdf.replace(/\.pdf$/i, '') + '.json' };
}

async function finish(report: ScanReport, out?: string, json?: string): Promise<void> {
  const paths = outputPaths(report.track, out, json);
  mkdirSync(path.dirname(path.resolve(paths.pdf)), { recursive: true });
  mkdirSync(path.dirname(path.resolve(paths.json)), { recursive: true });
  writeFileSync(paths.json, JSON.stringify(report, null, 2));
  await writePdf(report, paths.pdf);

  const counts = SEVERITY_ORDER.map((s) => `${s}: ${report.findings.filter((f) => f.severity === s).length}`).join('  ');
  console.log(`\n${report.findings.length} finding(s)  ${counts}`);
  for (const f of report.findings) console.log(`  [${f.severity.toUpperCase().padEnd(8)}] ${f.ruleId}  ${f.title}\n             ${f.location}`);
  console.log(`\nPDF report:  ${paths.pdf}\nJSON data:   ${paths.json}`);
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      json: { type: 'string' },
      'no-history': { type: 'boolean', default: false },
      'npm-audit': { type: 'boolean', default: false },
      authorized: { type: 'boolean', default: false },
      'supabase-url': { type: 'string' },
      'max-bundles': { type: 'string', default: '30' },
      'max-tables': { type: 'string', default: '25' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, target] = positionals;

  if (values.help || !command || !target) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  const startedAt = new Date().toISOString();

  if (command === 'repo') {
    const result = await scanRepo(target, { history: !values['no-history'], npmAudit: values['npm-audit'] });
    await finish({ tool: TOOL, version: VERSION, target: path.resolve(target), track: 'repo', startedAt, finishedAt: new Date().toISOString(), ...result }, values.out, values.json);
    return 0;
  }

  if (command === 'web') {
    if (!values.authorized) {
      console.error('Refusing to scan: pass --authorized to confirm you own this app or have written permission to test it.');
      return 2;
    }
    const result = await scanWeb(target, {
      supabaseUrl: values['supabase-url'],
      maxBundles: Number(values['max-bundles']),
      maxTables: Number(values['max-tables']),
      timeoutMs: 15_000,
    });
    result.notes.unshift('Operator confirmed authorization to test this target (--authorized).');
    await finish({ tool: TOOL, version: VERSION, target, track: 'web', startedAt, finishedAt: new Date().toISOString(), ...result }, values.out, values.json);
    return 0;
  }

  if (command === 'report') {
    if (!values.out) {
      console.error('report needs --out <file.pdf>');
      return 1;
    }
    const report = JSON.parse(readFileSync(target, 'utf8')) as ScanReport;
    await writePdf(report, values.out);
    console.log(`PDF report: ${values.out}`);
    return 0;
  }

  console.log(HELP);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  },
);
