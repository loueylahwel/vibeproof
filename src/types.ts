export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Track = 'repo' | 'web';

export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  track: Track;
  /** Repo-relative path with line, git commit + path, or a URL. */
  location: string;
  /** Always redacted. Never contains a full secret value. */
  evidence: string;
  description: string;
  remediation: string;
  owasp: string;
  cwe: string;
}

export interface ScanReport {
  tool: string;
  version: string;
  target: string;
  track: Track;
  startedAt: string;
  finishedAt: string;
  findings: Finding[];
  notes: string[];
}
