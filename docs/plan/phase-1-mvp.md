# Phase 1: MVP, "Unified library for 2 tools"

**Goal:** a user with an existing Claude Code setup can import it, manage agents, skills, and commands in AMC, equip skills to agents, deploy the same items to Codex, and **never lose a file**.

**Estimate:** 9–11 weeks. **Release:** v0.1.0 (Windows).

| Milestone | Track | Estimate | Depends on |
|-----------|-------|----------|------------|
| M1.1 Library service | Core | 1 wk | P0 |
| M1.2 Resolver & validator | Core | 1 wk | M1.1 |
| M1.3 Adapters (Claude Code, Codex) | Core | 1.5 wks | M1.2 |
| M1.4 Deployer | Core | 2 wks | M1.3 |
| M1.5 Desktop shell, IPC, index | App | 1 wk | P0 |
| M1.6 Library UI & item editor | App | 2 wks | M1.5 (mock API), M1.3 (preview) |
| M1.7 Deploy UI | App | 1.5 wks | M1.4, M1.6 |
| M1.8 Import | Core + App | 1.5 wks | M1.4 |
| M1.9 Dashboard & onboarding | App | 1 wk | M1.7, M1.8 |
| M1.10 Hardening & release | Both | 1 wk | all |

---

## M1.1: Library service

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.1.1 | Library layout & bootstrap | `library/bootstrap.ts`: create `~/.amc/{library,state,snapshots,logs}` and the `library/{agents,skills,commands}` folders | Idempotent; works with a custom root path |
| T1.1.2 | CRUD API | `LibraryService`: `list(kind)`, `get(id)`, `create(draft)`, `update(id, patch)`, `rename(id, newSlug)`, `delete(id)`, `duplicate(id)` | Slug uniqueness enforced. Rename moves the folder and keeps `id` stable. Delete is refused while other items reference the item |
| T1.1.3 | ID generation | `id = <kind>.<slug>` at creation time and **never** changed afterwards, even on rename | Test: rename a skill → agents that reference it still resolve |
| T1.1.4 | Versioning | Auto-bump patch on content change, or an explicit bump via API. `updatedAt` metadata | A metadata-only edit (tags) doesn't bump the version |
| T1.1.5 | Git history | `GitService` (isomorphic-git): init the repo, auto-commit on each save with the message `amc: update skill.security-checklist (1.3.0)`, `log(itemPath)`, `show(rev, path)`, `restore(rev, itemPath)` | History for one item lists only its commits. Restore creates a new commit |
| T1.1.6 | Item templates | Built-in starter templates per kind (e.g. "Checklist skill", "Reviewer agent", "Slash command with args") as data in core | `create({ template })` yields a valid item |

> **M1.1 outcome (2026-09-25):** done in `packages/core/src/library/` (`bootstrap.ts`, `service.ts`, `git.ts`, `templates.ts`, `versioning.ts`). Decisions beyond the table:
> - `createdAt`/`updatedAt` live in `amc.yaml` as optional ISO fields. Metadata-only fields (`tags`, `author`, `license`, timestamps) never bump the version. Rename counts as a content change (it changes deployed file names), so it bumps patch.
> - A freed slug gets a suffixed id (`skill.sec-2`) if a renamed item still holds `skill.sec`.
> - Each commit carries an `Amc-Item: <id>` trailer. `history(id)` filters on it, so an item's history survives renames. `restore` lives in `LibraryService`: it finds the item at the old revision by id (not by folder), keeps the current slug, and writes a new version.
> - `LibraryService` depends on a `LibraryHistory` interface (`NoHistory` for `MemFs` tests). `GitService` is the only core code that touches disk without `FsPort`, because isomorphic-git needs a node-style fs client.

## M1.2: Resolver & validator

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.2.1 | Reference graph | `buildGraph(items)` → nodes and edges (`equips`, `uses-agent`, `preloads`, `dependsOn`) with reverse index | `usedBy(id)` and `uses(id)` are correct on fixture libraries |
| T1.2.2 | Closure & cycles | `resolveClosure(ids)` → ordered `ResolvedItem[]` (dependencies first). Tarjan's SCC to detect cycles | A cycle is reported with its full path (`a → b → c → a`) |
| T1.2.3 | ResolvedItem | Referenced items embedded (for example, an agent with its equipped skills' manifests and bodies) so that `compile` stays pure | Adapters never touch the library directly |
| T1.2.4 | Validator framework | `Rule { id, severity, check(ctx) → Issue[] }`. Issues carry `itemId`, `path` (field), `targetId?`, message, and optional `fix` | Rules can be registered by adapters (per-target rules) |
| T1.2.5 | Initial rules | The rules in [concept 05 §6](../concept/05-architecture.md#6-validation-rules-initial-set) **plus** the secret scanner (regex set for common key formats) and the path-safety check on slugs | Each rule has passing and failing fixtures |

> **M1.2 outcome (2026-09-25):** done in `packages/core/src/resolver/` and `packages/core/src/validator/`. Decisions beyond the table:
> - Edge relations are `equips`, `delegates-to`, `uses-agent`, `preloads`, and `depends-on`. Each edge carries its manifest field path (`skills.1.ref`), so issues point at the field and the "remove reference" fix drops only that entry.
> - `resolveClosure` throws `REF_BROKEN`/`REF_CYCLE`. Callers run the validator first to get the same problems as issues. Shared dependencies are the same `ResolvedItem` object.
> - Issues carry `blocking`: always true for errors, and also true for untrusted skill scripts, which are a warning that blocks deploy. A fix is data (`{ itemId, fields }`) applied through `LibraryService.update`.
> - Per-tool rules come from factories that adapters register in M1.3: `descriptionLimitRule(toolId, limit, severity)` and `slugNamingRule(toolId, check)`. The core path-safety rule rejects Windows device names (`con`, `nul`, `lpt1`, …), which pass the slug regex.
> - The inline-size threshold is 40,000 characters (body + always-on skills + their dependencies). `unused-item` runs only when deploy data is passed in, which happens once M1.4 exists.

## M1.3: Adapters (Claude Code, Codex CLI)

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.3.1 | Adapter SDK | `packages/core/src/adapter/`: the `ToolAdapter` interface, `CapabilityMatrix`, `CompiledFile { relPath, content, itemId, adaptations[] }`, `AdapterRegistry`, and **shared degradation helpers** (inline skills, "Available skills" block, args conversion) | Two adapters build on it without duplicated logic |
| T1.3.2 | Claude Code: detect | Find `~/.claude` (respect `CLAUDE_CONFIG_DIR` if set), try `claude --version` (timeout 3s, optional) | Works when the CLI isn't on `PATH` but the folder exists |
| T1.3.3 | Claude Code: compile | Agent → `agents/<slug>.md`. Skill → `skills/<slug>/SKILL.md` plus copied `references/` and `scripts/`. Command → `commands/<slug>.md` with `{{args}}` → `$ARGUMENTS`. Tool and model mapping tables | Golden snapshot tests for every fixture item |
| T1.3.4 | Claude Code: scan & parse | Enumerate native files for a scope. Parse into canonical drafts, putting unknown frontmatter into `compat.overrides.claude-code.raw` | Round-trip test from P0-07 is extended and still green |
| T1.3.5 | Codex: detect / compile / scan / parse | Per [codex-cli/FORMAT.md §7](../../packages/adapters/codex-cli/FORMAT.md): native TOML agents (`smol-toml`), skills in the shared `~/.agents/skills`, deprecated prompts at global scope, project commands compiled as skills, `sandbox_mode` as the only permission control | Golden tests. Every degradation appears in `adaptations[]` |
| T1.3.6 | Managed `AGENTS.md` sections | If Codex needs content inside a **shared** file such as `AGENTS.md`, AMC writes only between markers `<!-- amc:begin <id> -->…<!-- amc:end <id> -->` and never touches text outside them | Tests: user text above, below, and between blocks survives compile → apply → re-apply |
| T1.3.7 | Project scope | `paths(scope)` for the project scope of both tools. `Target = { toolId, scope: 'global' } \| { toolId, scope: 'project', root }` | A project target writes only under its root |

> **M1.3 outcome (2026-09-25):** SDK in `packages/core/src/adapter/`; adapters in `packages/adapters/{claude-code,codex-cli}`. Decisions beyond the table:
> - **Multi-root targets.** `paths(target)` returns named roots, and each `CompiledFile`/`NativeGroup` names its root. Codex needs two roots (`~/.codex` and `~/.agents`); Claude Code has one. The deployer (M1.4) keeps one lockfile per root. `~/.agents` can be shared by several tools' targets.
> - **Adapter inputs.** Adapters are built from an injected `AdapterHost` (`fs`, `home`, `env`, `runVersion`), so detection and scanning are testable. `compile(ResolvedItem, Target)` replaced `compile(LibraryItem)`, so compiled output uses a referenced item's *current* slug after a rename.
> - **Canonical positional placeholders are 1-based** (`{{arg1}}` is the first argument). Claude Code's `$N` is confirmed 0-based, so `$0` ↔ `{{arg1}}`. The old compile emitted 1-based `$N` for named arguments, which was off by one. Claude named arguments are now native (`arguments:` + `$name`).
> - **T1.3.6** provides the mechanism (`spliceRegion`/`readRegion`/`listRegions`, and `CompiledFile.region`), with property tests for S7. No Phase 1 compile output needs a region yet, since always-on skills are inlined into agent TOML. Broken markers raise `REGION_MALFORMED` instead of being guessed at.
> - **New rules:** `template-placeholders` (core); `claude-code:skill-listing-length`; `description-limit:codex-cli:skill` and `codex-cli:project-command-as-skill`.
>
> **Note on T1.3.6:** ownership is tracked at the **file** level in the concept docs. Shared files need **region-level ownership**. The lockfile records `{ kind: "region", markerId, sha256 }` for these entries.

## M1.4: Deployer

This is the most safety-critical milestone. See [engineering-practices §5](engineering-practices.md#5-safety-invariants-must-never-break).

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.4.1 | Lockfile | Read, write, and migrate `.amc-lock.json` (schema-versioned). Mirrored into the index. Recover the lockfile from the index if it's deleted | A corrupt lockfile → the target is marked "needs attention", with **no writes** |
| T1.4.2 | Plan | `plan(selection, targets)` → `DeployPlan`: per target, `creates / updates / deletes / conflicts / unchanged`, each with before/after content. Includes the `readHashes` of every file the plan looked at and a `planId` | Pure, apart from reads. Deterministic ordering |
| T1.4.3 | Delete detection | Owned files that belong to items no longer selected for the target → `delete` entries (only if the lockfile says AMC owns them) | Foreign files never appear as deletes |
| T1.4.4 | Conflicts | A write would hit a foreign path → `conflict` with resolutions `adopt-replace \| rename \| skip`. Drifted owned file → `conflict` with `overwrite \| skip` (pull-back comes in Phase 2) | Apply refuses to run while conflicts are unresolved |
| T1.4.5 | Apply | Re-verify `readHashes` (stale plan → reject). Snapshot affected files. Atomic writes (temp file in the same dir, then rename, with retry and backoff for Windows `EBUSY`/`EPERM`). Update the lockfile last | Crash-simulation test: kill the process between writes → the next run detects an incomplete deploy from the journal and offers rollback |
| T1.4.6 | Deploy journal | `state/journal/<deployId>.json` written before apply, marked complete after | Recovery flow covered by test |
| T1.4.7 | Snapshots & rollback | `snapshots/<deployId>/` plus a manifest. `rollback(deployId)` = a new plan that restores the previous contents (so it also goes through plan → apply). Pruning policy (50 deploys / 30 days) | Rollback of a rollback works. Pruning never deletes the latest snapshot |
| T1.4.8 | Line endings & encoding | Preserve the existing file's EOL on update, default LF, UTF-8 without BOM | Tests with CRLF fixtures |
| T1.4.9 | Deploy records | Deployment rows in the index (`itemId, version, targetId, files[], deployedAt, deployId`) | The matrix query (M1.7) is a single SQL query |

```ts
// Core shape the UI and CLI both consume
interface DeployPlan {
  planId: string;
  createdAt: string;
  targets: TargetPlan[];
  readHashes: Record<string /*abs path*/, string | null /*absent*/>;
  issues: Issue[];              // validation results; errors block apply
}
interface TargetPlan {
  targetId: string;
  changes: Array<
    | { op: 'create' | 'update' | 'delete'; relPath: string; itemId: string; before?: string; after?: string; adaptations: Adaptation[] }
    | { op: 'conflict'; relPath: string; reason: 'foreign' | 'drifted'; options: ConflictResolution[] }
  >;
}
```

## M1.5: Desktop shell, IPC, index

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.5.1 | Hardened window | `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, block navigation and `window.open`, single-instance lock | Electron security checklist items are covered by a test or an assertion |
| T1.5.2 | IPC contract | `apps/desktop/src/shared/ipc-contract.ts`: each channel is `{ input: ZodSchema, output: ZodSchema }`. `router.ts` in main validates the input and serializes errors. The typed `window.amc` in preload is generated from the contract | Unknown channel → rejected. Invalid payload → typed error. **The renderer cannot pass arbitrary paths** except through dialog-returned tokens |
| T1.5.3 | Event bus | Main → renderer subscription channel for `scan.progress`, `deploy.progress`, and `library.changed` | UI updates without polling |
| T1.5.4 | Index store | `IndexStore` interface. SQLite implementation with migrations, tables `items`, `relations`, `deployments`, `lock_files`, FTS5 `items_fts`. `rebuild()` from library plus lockfiles | Deleting `index.sqlite` → the app rebuilds it on start with identical query results |
| T1.5.5 | Worker offload | Scans, rebuilds, and plan computation run in an Electron `utilityProcess`, with progress events | The UI stays at 60fps during a 1,000-item rebuild (manual perf check) |
| T1.5.6 | Settings & logging | `settings.json` (Zod-validated), rotating log files in `~/.amc/logs`, and a "Copy diagnostics" action | Logs never contain file *contents*, only paths and hashes |
| T1.5.7 | Mock API | `renderer/src/mocks/amc-mock.ts` implementing the contract with fixture data, enabled by `VITE_AMC_MOCK=1` | UI track can develop without a real core |

## M1.6: Library UI & item editor

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.6.1 | App frame | Sidebar per [concept 04 §2](../concept/04-user-experience.md#2-information-architecture), routing (TanStack Router or React Router), theme (OS-following dark/light), kind icons and colors | Keyboard navigable |
| T1.6.2 | Command palette | `Ctrl+K`: fuzzy search items (FTS-backed) and actions (New skill, Deploy…, Import…) | Opens in <100ms with 1,000 items |
| T1.6.3 | Library list | Table view with columns, filters, and FTS search. Bulk select → deploy / tag / delete | Virtualized. Delete is disabled when the item is referenced (tooltip explains why) |
| T1.6.4 | Editor: forms | Tabs: Details, Prompt/Body (Monaco markdown), Skills (agent only: add, reorder, mode toggle), Tools & Model, Arguments (command only) | Form ↔ `amc.yaml` stay consistent. Unsaved-changes guard |
| T1.6.5 | Editor: raw mode | Monaco YAML with JSON Schema hints (from P0-05) alongside the body | Switching form ↔ raw keeps edits. Invalid YAML blocks the switch back with a clear message |
| T1.6.6 | Compiled preview | Right pane: tool switcher → `compile` output (via IPC, debounced 300ms), adaptation warnings, token estimate, and a diff vs. the deployed version | Preview updates within 500ms of typing on a typical item |
| T1.6.7 | Validation surface | Inline field errors, plus an issues panel with "Fix" actions where the rule provides one | Every rule from T1.2.5 renders correctly |
| T1.6.8 | Relations & history tabs | Relations: plain lists of "uses" and "used by" (a graph view is deferred). History: git log, diff, and restore | Restore creates a commit and refreshes the editor |

## M1.7: Deploy UI

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.7.1 | Targets screen | Detected tools × scopes. Register a project folder (directory picker). Per-target settings (auto-apply: ask / when-no-conflicts) | Removing a project target never deletes files, it only stops managing them (with an option to also clean up owned files via a plan) |
| T1.7.2 | Deploy entry points | "Deploy ▾" in the editor, bulk deploy from the list, matrix cell toggle. All of them create a **plan** | No code path writes without a plan |
| T1.7.3 | Plan dialog | Grouped changes, per-file Monaco diff, adaptation list, conflict resolution controls, blocking issues, and "Apply" | Apply is disabled until conflicts are resolved. Shows a stale-plan error and a re-plan button |
| T1.7.4 | Deployment matrix | Items × targets grid with status cells (in sync / outdated / missing / not deployed). Clicking a cell opens a plan | Uses a single index query and stays virtualized for 500 × 10 |
| T1.7.5 | History | Deploy timeline, report detail (files, adaptations), and Revert (→ rollback plan) | Revert shows the plan like any other deploy |

## M1.8: Import

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.8.1 | Scan service | Run `scan()` for all detected tools, the global scope, and registered projects, with progress events | 500 native files are scanned in <3s on SSD |
| T1.8.2 | Dedupe | Group candidates by normalized slug, then by content similarity (normalized-body hash first, then Jaccard over line shingles ≥ 0.85). Choose a canonical source per group, with the others as "same item, other tool" | Fixture with the same skill in Claude Code and Codex → one group |
| T1.8.3 | Relationship suggestions | Regex and mention detection of other candidates' slugs in bodies → suggested links with evidence snippets | Suggestions are never auto-applied |
| T1.8.4 | Adopt | Write library items. Record the **existing** native files in the target lockfiles as-is (their current hash) | **Zero** bytes changed in target folders after adopt (safety test) |
| T1.8.5 | Import wizard UI | Detect → Scan → Review (groups, conflicts in naming, suggestions with accept/reject) → Adopt → Summary | Can go back through steps. Cancel leaves no trace |

## M1.9: Dashboard & onboarding

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.9.1 | Onboarding | Welcome → library location → tool detection → "Import now / later" → dashboard | Re-runnable from Settings. Never writes to tool folders |
| T1.9.2 | Dashboard | Tool cards, health panel (broken refs, outdated deployments, missing owned files, foreign files, failed/incomplete deploys), recent activity | Each health item links to a fix action |
| T1.9.3 | Periodic status check | On focus and every N minutes: hash owned files vs. lockfile → update statuses (a full watcher comes in Phase 2) | A manual edit in `~/.claude` shows up as "drifted" within one refresh |

## M1.10: Hardening & release 0.1.0

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T1.10.1 | E2E suite | Playwright `_electron` tests for journeys J1, J2, J3, J5-lite (detect drift + overwrite), and rollback. Runs against a temp `HOME` | Green on Windows CI |
| T1.10.2 | Dogfood | Use AMC to manage the developer's own real setup for one week. File issues | No data-loss issue open |
| T1.10.3 | Packaging | electron-builder NSIS installer, per-user install, app icon, file associations (none yet) | Clean install and uninstall. Uninstall keeps `~/.amc` |
| T1.10.4 | Signing & updates | Authenticode signing (needs certificate), `electron-updater` with GitHub Releases | Update from 0.1.0-beta.1 → beta.2 works |
| T1.10.5 | Docs | README (install, first run, concepts in 5 minutes) and a `CHANGELOG.md` | — |
| T1.10.6 | License | **Blocked on Q6.** Add `LICENSE` and third-party notices (`license-checker`) | — |

## Phase 1 exit criteria

1. Journeys J1, J2, and J3 work end to end on Windows with the real Claude Code and Codex.
2. All safety invariants pass. Dogfooding for one week produced no data-loss bugs.
3. Deleting `~/.amc/state` fully recovers from the library plus the lockfiles.
4. A signed installer and auto-update are working.
