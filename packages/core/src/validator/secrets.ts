/**
 * Key-like strings that should never live in the library, which is a git repo users may push
 * (docs/concept/05 §7.5). Patterns favour precision: a noisy scanner gets ignored.
 */
export const SECRET_PATTERNS: ReadonlyArray<{ id: string; name: string; re: RegExp }> = [
  { id: 'private-key', name: 'private key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', name: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    id: 'github-token',
    name: 'GitHub token',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  },
  { id: 'anthropic-key', name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  {
    id: 'openai-key',
    name: 'OpenAI API key',
    re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{40,}/,
  },
  { id: 'google-api-key', name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'slack-token', name: 'Slack token', re: /\bxox[abposr]-[0-9A-Za-z-]{10,}/ },
  { id: 'stripe-key', name: 'Stripe secret key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/ },
];

export interface SecretHit {
  patternId: string;
  name: string;
  /** 1-based. */
  line: number;
  /** First characters only, so the issue never repeats the secret. */
  preview: string;
}

/** Skips binary content (a NUL byte in the first 8 KB). */
export const looksBinary = (data: Buffer): boolean => data.subarray(0, 8192).includes(0);

export function scanForSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  text.split(/\r?\n/).forEach((lineText, i) => {
    for (const p of SECRET_PATTERNS) {
      const m = p.re.exec(lineText);
      if (m)
        hits.push({ patternId: p.id, name: p.name, line: i + 1, preview: `${m[0].slice(0, 6)}…` });
    }
  });
  return hits;
}
