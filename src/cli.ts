#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { startDashboard } from './dashboard/server.js';
import { writePdf } from './report/pdf.js';
import { normalizeWebTarget, runScan, VERSION, type ScanOutput } from './run.js';
import { combinedPrompt } from './prompts.js';
import { SEVERITY_ORDER, type ScanReport, type Severity } from './types.js';
import { OwnershipError, verifyOwnership, type Verification } from './verify.js';

const HELP = `vibeproof ${VERSION} - security scanner for vibe-coded web apps (academic project)

Usage:
  vibeproof dashboard    [--port 4173]          local web dashboard on 127.0.0.1
  vibeproof repo <path | public repo link>  [--out report.pdf] [--json report.json] [--no-history] [--npm-audit]
  vibeproof web  <url>   [--supabase-url <url>] [--max-bundles 30] [--max-tables 25]
                     [--out report.pdf] [--json report.json]
  vibeproof verify <url>                        show the ownership token for a domain
  vibeproof report <scan.json> --out report.pdf
  vibeproof prompt <scan.json> [--min-severity high] [--rule VP-DB-001]
                                            print a fix prompt for your AI coding agent

Repositories:
  A link to a public repository on GitHub, GitLab, Bitbucket or Codeberg is
  downloaded to a temporary folder, scanned and deleted. Private repositories
  are never fetched with your credentials: download them and pass the folder.

Ownership:
  Web scans run only on domains you have proven you own: publish the token from
  "vibeproof verify <url>" as a file on the site or as a DNS TXT record. Apps on
  localhost need no verification. Reports never contain full secret values.
`;

function printVerification(v: Verification): void {
  console.log(`\n${v.verified ? 'Verified' : 'Not verified'}: ${v.host}${v.method ? ` (${v.method})` : ''}`);
  if (v.verified) return;
  for (const c of v.checks) console.log(`  - ${c}`);
  console.log(`\nProve you own ${v.host} with either option, then run the scan again:\n`);
  console.log(`  1. File   ${v.fileUrl}\n           containing: ${v.token}\n`);
  console.log(`  2. DNS    TXT record on ${v.host}\n           value: ${v.dnsRecord}\n`);
}

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
      'supabase-url': { type: 'string' },
      'max-bundles': { type: 'string', default: '30' },
      'max-tables': { type: 'string', default: '25' },
      port: { type: 'string' },
      'min-severity': { type: 'string' },
      rule: { type: 'string' },
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

  if (command === 'verify') {
    const v = await verifyOwnership(normalizeWebTarget(target));
    printVerification(v);
    return v.verified ? 0 : 2;
  }

  if (command === 'web') {
    try {
      printSummary(await runScan({
        track: 'web',
        target: normalizeWebTarget(target),
        supabaseUrl: values['supabase-url'],
        maxBundles: Number(values['max-bundles']),
        maxTables: Number(values['max-tables']),
        pdfPath: values.out,
        jsonPath: values.json,
      }));
    } catch (err) {
      if (!(err instanceof OwnershipError)) throw err;
      console.error(err.message);
      printVerification(err.verification);
      return 2;
    }
    return 0;
  }

  if (command === 'prompt') {
    const report = JSON.parse(readFileSync(target, 'utf8')) as ScanReport;
    const min = values['min-severity'] as Severity | undefined;
    if (min && !SEVERITY_ORDER.includes(min)) {
      console.error(`--min-severity must be one of: ${SEVERITY_ORDER.join(', ')}`);
      return 1;
    }
    const picked = report.findings.filter((f) =>
      (!min || SEVERITY_ORDER.indexOf(f.severity) <= SEVERITY_ORDER.indexOf(min)) && (!values.rule || f.ruleId === values.rule));
    if (!picked.length) {
      console.error('No findings match.');
      return 1;
    }
    process.stdout.write(`${combinedPrompt(report, picked)}\n`);
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
