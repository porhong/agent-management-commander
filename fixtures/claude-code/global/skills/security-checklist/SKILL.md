---
name: security-checklist
description: Use when reviewing code for security issues such as injection, authz gaps, secrets and unsafe deserialization.
when_to_use: reviewing pull requests, touching auth code
allowed-tools: Read Grep Bash(git diff:*)
license: MIT
metadata:
  owner: security-team
  reviewed: 2026-09-01
---

# Security checklist

- [ ] Inputs validated
- [ ] No secrets in code — run `scripts/scan-secrets.ps1`
- See [OWASP notes](references/owasp.md)
