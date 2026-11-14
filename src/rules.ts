import type { Severity } from './types.js';

export interface Rule {
  id: string;
  title: string;
  defaultSeverity: Severity;
  description: string;
  remediation: string;
  owasp: string;
  cwe: string;
}

/** Central catalogue. Every finding the scanner can produce maps to one rule here. */
export const RULES: Record<string, Rule> = {
  'VSC-SEC-001': {
    id: 'VSC-SEC-001',
    title: 'Private key material exposed',
    defaultSeverity: 'critical',
    description: 'A private cryptographic key is present in readable source or history.',
    remediation: 'Revoke and regenerate the key. Remove it from the code and from git history (for example with git filter-repo), then load keys from a secret manager.',
    owasp: 'A02:2021 Cryptographic Failures',
    cwe: 'CWE-321',
  },
  'VSC-SEC-002': {
    id: 'VSC-SEC-002',
    title: 'Live API secret key exposed',
    defaultSeverity: 'critical',
    description: 'A provider secret key (payment, cloud, source hosting, or AI API) is hard-coded or committed.',
    remediation: 'Revoke the key in the provider dashboard now, issue a new one, store it in a server-side environment variable or secret manager, and purge it from git history.',
    owasp: 'A02:2021 Cryptographic Failures',
    cwe: 'CWE-798',
  },
  'VSC-SEC-003': {
    id: 'VSC-SEC-003',
    title: 'Hard-coded credential',
    defaultSeverity: 'high',
    description: 'A credential-like value is assigned to a key, secret, or password variable in source code.',
    remediation: 'Move the value to a server-side environment variable or secret manager, rotate it, and check the git history for copies.',
    owasp: 'A07:2021 Identification and Authentication Failures',
    cwe: 'CWE-798',
  },
  'VSC-ENV-001': {
    id: 'VSC-ENV-001',
    title: 'Environment file committed to git',
    defaultSeverity: 'high',
    description: 'A .env file is tracked by git, so its values are in the repository and its history.',
    remediation: 'Remove the file from the index (git rm --cached), add it to .gitignore, rotate every value it contained, and commit a .env.example with placeholder values instead.',
    owasp: 'A05:2021 Security Misconfiguration',
    cwe: 'CWE-540',
  },
  'VSC-ENV-002': {
    id: 'VSC-ENV-002',
    title: 'Secret-named variable has a public build prefix',
    defaultSeverity: 'high',
    description: 'Variables with a prefix such as NEXT_PUBLIC_ or VITE_ are inlined into the browser bundle at build time. A name that suggests a secret means the value is likely shipped to every visitor.',
    remediation: 'Rename the variable without the public prefix, read it only in server code (API routes, server actions, edge functions), and rotate the value if it was built into a deployed bundle.',
    owasp: 'A05:2021 Security Misconfiguration',
    cwe: 'CWE-200',
  },
  'VSC-ENV-003': {
    id: 'VSC-ENV-003',
    title: 'No dependency lockfile',
    defaultSeverity: 'low',
    description: 'package.json exists without a lockfile, so installed dependency versions are not pinned and cannot be audited reliably.',
    remediation: 'Run the package manager install command and commit the generated lockfile.',
    owasp: 'A06:2021 Vulnerable and Outdated Components',
    cwe: 'CWE-1104',
  },
  'VSC-DB-001': {
    id: 'VSC-DB-001',
    title: 'Table without row level security',
    defaultSeverity: 'high',
    description: 'A table in the public schema is created without "enable row level security". In Supabase, the anon API key can then read and write its rows directly.',
    remediation: 'Run "alter table <name> enable row level security;" and add policies that restrict access to the rows each user should see.',
    owasp: 'A01:2021 Broken Access Control',
    cwe: 'CWE-284',
  },
  'VSC-DB-002': {
    id: 'VSC-DB-002',
    title: 'Row level security policy allows all rows',
    defaultSeverity: 'high',
    description: 'A policy uses "using (true)" or "with check (true)" for anonymous, public, or any authenticated user. Any caller matching the role can access every row.',
    remediation: 'Replace "true" with a condition tied to the user, such as auth.uid() = user_id. Restrict writes to the owner or to a server-side role.',
    owasp: 'A01:2021 Broken Access Control',
    cwe: 'CWE-284',
  },
  'VSC-DB-004': {
    id: 'VSC-DB-004',
    title: 'Supabase service_role key referenced in code that may reach the browser',
    defaultSeverity: 'high',
    description: 'The service_role key bypasses all row level security. It is referenced in a file that is not in a server-only path. Verify that the file is never bundled for the browser.',
    remediation: 'Use the service_role key only in server-side code. Move the call to an API route, server action, or edge function, and keep the file out of client components.',
    owasp: 'A01:2021 Broken Access Control',
    cwe: 'CWE-200',
  },
  'VSC-DB-005': {
    id: 'VSC-DB-005',
    title: 'Table readable with the public anon key',
    defaultSeverity: 'high',
    description: 'A live probe with the anon key (taken from shipped JavaScript) returned at least one row from this table. Rows are readable by anyone who loads the site.',
    remediation: 'Enable row level security on the table and add policies for each role. Re-test to confirm the anon key now receives no rows.',
    owasp: 'A01:2021 Broken Access Control',
    cwe: 'CWE-284',
  },
  'VSC-DB-006': {
    id: 'VSC-DB-006',
    title: 'Supabase service_role key exposed',
    defaultSeverity: 'critical',
    description: 'A JWT whose role claim is service_role is present in source, history, or shipped JavaScript. Anyone holding it can read and write every table, bypassing RLS.',
    remediation: 'Rotate the JWT secret or regenerate the service_role key in the Supabase dashboard immediately, then remove the value from code and history and audit recent database activity.',
    owasp: 'A02:2021 Cryptographic Failures',
    cwe: 'CWE-798',
  },
  'VSC-WEB-001': {
    id: 'VSC-WEB-001',
    title: 'Missing Content-Security-Policy header',
    defaultSeverity: 'medium',
    description: 'The page response has no Content-Security-Policy header, so injected scripts are not restricted.',
    remediation: 'Send a Content-Security-Policy header that allows only the script sources the app needs.',
    owasp: 'A05:2021 Security Misconfiguration',
    cwe: 'CWE-693',
  },
  'VSC-WEB-002': {
    id: 'VSC-WEB-002',
    title: 'Missing Strict-Transport-Security header',
    defaultSeverity: 'low',
    description: 'The HTTPS response has no HSTS header, so browsers may first connect over plain HTTP.',
    remediation: 'Send "Strict-Transport-Security: max-age=31536000; includeSubDomains".',
    owasp: 'A05:2021 Security Misconfiguration',
    cwe: 'CWE-319',
  },
  'VSC-WEB-003': {
    id: 'VSC-WEB-003',
    title: 'Clickjacking protection missing',
    defaultSeverity: 'low',
    description: 'Neither X-Frame-Options nor a CSP frame-ancestors directive is set, so the page can be framed by another site.',
    remediation: 'Send "Content-Security-Policy: frame-ancestors \'none\'" or "X-Frame-Options: DENY".',
    owasp: 'A05:2021 Security Misconfiguration',
    cwe: 'CWE-1021',
  },
  'VSC-WEB-004': {
    id: 'VSC-WEB-004',
    title: 'Missing X-Content-Type-Options header',
    defaultSeverity: 'low',
    description: 'The response does not set X-Content-Type-Options: nosniff, so browsers may guess content types.',
    remediation: 'Send "X-Content-Type-Options: nosniff".',
    owasp: 'A05:2021 Security Misconfiguration',
    cwe: 'CWE-693',
  },
  'VSC-WEB-005': {
    id: 'VSC-WEB-005',
    title: 'Source maps publicly accessible',
    defaultSeverity: 'medium',
    description: 'A JavaScript source map is served publicly. It reveals the original source code, comments, and internal paths.',
    remediation: 'Disable production source maps (or restrict them to error-tracking services) and redeploy.',
    owasp: 'A05:2021 Security Misconfiguration',
    cwe: 'CWE-540',
  },
  'VSC-WEB-006': {
    id: 'VSC-WEB-006',
    title: 'Sensitive file publicly reachable',
    defaultSeverity: 'high',
    description: 'A file that should never be served (an environment file or git metadata) is reachable over HTTP.',
    remediation: 'Block the path at the web server or hosting layer, rotate any secrets that were exposed, and redeploy from a clean build output.',
    owasp: 'A05:2021 Security Misconfiguration',
    cwe: 'CWE-538',
  },
  'VSC-DEP-001': {
    id: 'VSC-DEP-001',
    title: 'Dependencies with known critical or high vulnerabilities',
    defaultSeverity: 'high',
    description: 'npm audit reports known vulnerabilities in production dependencies.',
    remediation: 'Run npm audit fix, or upgrade the affected packages to patched versions. Review the advisories for exploitability.',
    owasp: 'A06:2021 Vulnerable and Outdated Components',
    cwe: 'CWE-1104',
  },
};

export function getRule(id: string): Rule {
  const rule = RULES[id];
  if (!rule) throw new Error(`Unknown rule id: ${id}`);
  return rule;
}
