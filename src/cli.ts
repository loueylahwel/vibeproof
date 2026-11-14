#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { startDashboard } from './dashboard/server.js';
import { writePdf } from './report/pdf.js';
import { runScan, VERSION, type ScanOutput } from './run.js';
import { SEVERITY_ORDER, type ScanReport } from './types.js';

const HELP = `vscan ${VERSION} - security scanner for vibe-coded web apps (academic project)

Usage:
  vscan dashboard    [--port 4173]          local web dashboard on 127.0.0.1
  vscan repo <path>  [--out report.pdf] [--json report.json] [--no-history] [--npm-audit]
  vscan web  <url>   --authorized [--supabase-url <url>] [--max-bundles 30] [--max-tables 25]
                     [--out report.pdf] [--json report.json]
  vscan report <scan.json> --out report.pdf

Rules of engagement:
  The web command only sends GET requests, but it still touches a live system.
  Run it only against apps you own or have written permission to test, and pass
  --authorized to confirm that. Reports never contain full secret values.
`;

function printSummary({ report, pdfPath, jsonPath }: ScanOutput): void {
  const counts = SEVERITY_ORDER.map((s) => `${s}: ${report.findings.filter((f) => f.severity === s).length}`).join('  ');
  console.log(`\n${report.findings.length} finding(s)  ${counts}`);
  for (const f of report.findings) console.log(`  [${f.severity.toUpperCase().padEnd(8)}] ${f.ruleId}  ${f.title}\n             ${f.location}`);
  console.log(`\nPDF report:  ${pdfPath}\nJSON data:   ${jsonPath}`);
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
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, target] = positionals;

  if (command === 'dashboard') {
    await startDashboard({ port: values.port ? Number(values.port) : undefined });
    return -1; // keep running
  }

  if (values.help || !command || !target) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  if (command === 'repo') {
    printSummary(await runScan({ track: 'repo', target, history: !values['no-history'], npmAudit: values['npm-audit'], pdfPath: values.out, jsonPath: values.json }));
    return 0;
  }

  if (command === 'web') {
    if (!values.authorized) {
      console.error('Refusing to scan: pass --authorized to confirm you own this app or have written permission to test it.');
      return 2;
    }
    printSummary(await runScan({
      track: 'web',
      target,
      authorized: true,
      supabaseUrl: values['supabase-url'],
      maxBundles: Number(values['max-bundles']),
      maxTables: Number(values['max-tables']),
      pdfPath: values.out,
      jsonPath: values.json,
    }));
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
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err: unknown) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  },
);
