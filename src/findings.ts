import { getRule } from './rules.js';
import type { Finding, Severity, Track } from './types.js';

export function makeFinding(
  ruleId: string,
  track: Track,
  location: string,
  evidence: string,
  severity?: Severity,
): Finding {
  const rule = getRule(ruleId);
  return {
    ruleId,
    title: rule.title,
    severity: severity ?? rule.defaultSeverity,
    track,
    location,
    evidence,
    description: rule.description,
    remediation: rule.remediation,
    owasp: rule.owasp,
    cwe: rule.cwe,
  };
}
