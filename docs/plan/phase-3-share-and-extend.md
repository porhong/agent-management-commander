# Phase 3: Share & extend

**Goal:** let people share their setups safely, script AMC from the terminal (including from AI agents themselves), and support any tool through the Generic adapter.

**Estimate:** 4–6 weeks. **Release:** v0.3.0.

## M3.1: Packs *(1.5 wks)*

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T3.1.1 | Pack format | `.amcpack` = zip containing `pack.yaml` (name, version, author, items[], requires[]) and item folders in library layout. A git folder with the same layout is also a valid pack | Schema-validated. Zip-slip protection (no `..` or absolute paths) |
| T3.1.2 | Export | Select items → closure is included automatically. Secret scan blocks export on hits unless overridden | Exported pack imports cleanly into an empty library |
| T3.1.3 | Import & security review | Sources: file, folder, git URL (shallow clone to temp). The review screen lists items, **every script in full**, permission requests (`tools.allow` widening), and ID collisions (merge / rename / skip) | Scripts arrive as `trust: untrusted`. Nothing executes and nothing deploys automatically |
| T3.1.4 | Trust workflow | Mark a script as reviewed (records the hash). A content change resets it to untrusted | Deploy blocks untrusted scripts unless approved per deploy |
| T3.1.5 | Pack updates | Items remember their `origin` (pack + version). "Check for updates" on git-sourced packs → a diff and the review screen again | Local edits to pack items are detected (3-way merge reuses M2.3) |

## M3.2: `amc` CLI *(1.5 wks)*

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T3.2.1 | CLI package | `packages/cli` (commander or citty) built on core and adapters, with **no Electron**. Uses the same `~/.amc` and the same index (with WAL mode and a file lock between app and CLI) | The app and CLI can run at the same time safely |
| T3.2.2 | Commands | `amc list [kind]`, `amc show <id>`, `amc new <kind> <slug>`, `amc validate`, `amc plan <ids> --target <t>`, `amc deploy … [--yes]`, `amc status`, `amc rollback <deployId>`, `amc import --scan` | `--json` output on every command for agent and script use |
| T3.2.3 | Safety parity | `deploy` without `--yes` prints the plan and asks. Conflicts always need an explicit `--resolve path=skip\|rename\|adopt` | The same safety invariant tests run against the CLI |
| T3.2.4 | Distribution | npm package `@amc/cli`, plus "Install CLI to PATH" from the desktop app's settings | — |
| T3.2.5 | Agent skill | Ship a built-in skill, `skill.amc-cli`, that teaches AI agents how to use `amc` | Deployable like any other skill |

## M3.3: Generic & OpenCode adapters *(1 wk)*

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T3.3.1 | Generic adapter | A user-defined target: root folder, per-kind path pattern (`{{slug}}.md`), and a Handlebars template per kind with access to the resolved item. Capability matrix chosen by the user | A custom target created in the UI deploys correctly and shows a template preview |
| T3.3.2 | Template sandboxing | Templates are logic-less (Handlebars with no custom helpers from users) and output paths are validated by the path-safety rule | A crafted template can't escape the root |
| T3.3.3 | OpenCode adapter | Verify (P0-01 pattern), then implement | Golden tests |

## M3.4: Context budget & template gallery *(1 wk)*

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T3.4.1 | Token estimator | Approximate tokenizer (e.g. `js-tiktoken` or a chars/4 heuristic with a disclaimer) for the **always-loaded** content per target: skill descriptions, inlined skills, `AGENTS.md` regions | The dashboard shows per-target totals and the top contributors |
| T3.4.2 | Budget warnings | A configurable threshold per target produces a warning in the plan | — |
| T3.4.3 | Template gallery | Templates as library items (`kind: template`). A gallery screen, templates in packs, and "Save as template" | — |

## Phase 3 exit criteria

1. Exporting a pack from one machine and importing it on another reproduces the same deployments.
2. An AI agent (for example, Claude Code using `skill.amc-cli`) can list, create, and deploy a skill through the CLI with `--json`.
3. A Generic target works for a tool AMC doesn't know about.

## Beyond Phase 3

See [concept 06 §1, Phase 4](../concept/06-roadmap-and-open-questions.md#phase-4--future-ideas-not-committed). Before any of those ideas are planned in detail, they should be re-evaluated against the usage data and feedback from v0.1–v0.3.
