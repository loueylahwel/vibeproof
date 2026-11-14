import type { Severity } from './types.js';
import { decodeJwtPayload, fingerprint, isPlaceholder, lineOf, redact } from './util.js';

export interface SecretHit {
  ruleId: string;
  patternName: string;
  severity: Severity;
  /** 1-based line within the scanned text. */
  line: number;
  /** Redacted, safe to show in a report. */
  evidence: string;
  /** Hash of the raw value, used for deduplication. The raw value is not kept. */
  fingerprint: string;
}

interface Pattern {
  name: string;
  ruleId: string;
  severity: Severity;
  regex: RegExp;
  /** If set, capture group 1 is the secret value. Otherwise the whole match is. */
  valueInGroup1?: boolean;
}

const PATTERNS: Pattern[] = [
  {
    name: 'Supabase secret key (sb_secret_)',
    ruleId: 'VP-DB-006',
    severity: 'critical',
    regex: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: 'Private key block',
    ruleId: 'VP-SEC-001',
    severity: 'critical',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    name: 'AWS access key ID',
    ruleId: 'VP-SEC-002',
    severity: 'critical',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: 'Stripe live secret key',
    ruleId: 'VP-SEC-002',
    severity: 'critical',
    regex: /\bsk_live_[0-9a-zA-Z]{16,}\b/g,
  },
  {
    name: 'GitHub token',
    ruleId: 'VP-SEC-002',
    severity: 'critical',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    name: 'OpenAI API key',
    ruleId: 'VP-SEC-002',
    severity: 'high',
    regex: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g,
  },
  {
    name: 'Slack token',
    ruleId: 'VP-SEC-002',
    severity: 'high',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    name: 'Hard-coded credential assignment',
    ruleId: 'VP-SEC-003',
    severity: 'high',
    regex: /\b(?:api[_-]?key|secret[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/gi,
    valueInGroup1: true,
  },
];

// A JWT is three base64url segments. Only the role claim matters for scoring.
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** Find secret-like values in text. Raw values never leave this function. */
export function scanSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];

  for (const token of text.matchAll(JWT_REGEX)) {
    const payload = decodeJwtPayload(token[0]);
    if (payload?.role === 'service_role') {
      hits.push({
        ruleId: 'VP-DB-006',
        patternName: 'Supabase service_role JWT',
        severity: 'critical',
        line: lineOf(text, token.index ?? 0),
        evidence: redact(token[0]),
        fingerprint: fingerprint(token[0]),
      });
    }
  }

  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const value = pattern.valueInGroup1 ? match[1] : match[0];
      if (!value || isPlaceholder(value)) continue;
      hits.push({
        ruleId: pattern.ruleId,
        patternName: pattern.name,
        severity: pattern.severity,
        line: lineOf(text, match.index ?? 0),
        evidence: redact(value),
        fingerprint: fingerprint(value),
      });
    }
  }

  return hits;
}
