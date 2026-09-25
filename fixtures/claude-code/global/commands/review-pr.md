---
description: Review a pull request for correctness and security
argument-hint: "[pr-number] [focus]"
allowed-tools: Bash(git diff:*), Bash(gh pr view:*), Read
---

Review pull request $1 with focus on $2.

Full arguments: $ARGUMENTS

Template engines use {{ double braces }} literally here; keep them intact.
