# Phase 0: Foundations (spike)

**Goal:** remove the biggest unknowns before any real feature work. The unknowns are real tool formats, the Electron + native module toolchain, and whether the canonical model can round-trip actual user files.

**Estimate:** 1.5–2 weeks. **Exit criteria:** see §3.

## 1. Tasks

### P0-01: Verify Claude Code formats *(1 day)*
- **Do:** read current Claude Code docs and inspect a real `~/.claude` and a project `.claude/`. Record:
  - Agents: `agents/*.md` frontmatter keys (`name`, `description`, `tools`, `model`, …), accepted values, and the list of tool names
  - Skills: `skills/<name>/SKILL.md` frontmatter (`name`, `description`, `allowed-tools`?), nested files, and name rules
  - Commands: `commands/*.md` frontmatter (`description`, `argument-hint`, `allowed-tools`, `model`), `$ARGUMENTS` / `$1…`, namespacing through subfolders
  - How plugins and `settings.json` interact. This is out of scope to manage, but we need to know it's there.
- **Deliverable:** `packages/adapters/claude-code/FORMAT.md` with a "verified on <date>, version <x>" header, plus example files in `fixtures/claude-code/`.
- **Acceptance:** every field in the Claude Code adapter's capability matrix is backed by a doc link or an observed example.

### P0-02: Verify Codex CLI formats *(1–2 days)*
- **Do:** same process for Codex:
  - `~/.codex/prompts/*.md` (custom prompts: args syntax, frontmatter)
  - `AGENTS.md` layering (global and project)
  - Whether native skills exist and where
  - Whether any agent or profile concept exists (`config.toml` profiles?)
- **Deliverable:** `packages/adapters/codex-cli/FORMAT.md` and `fixtures/codex-cli/`.
- **Acceptance:** a decision table with a **native / degraded / unsupported** status for Agent, Skill, Command, agent→skill link, tool permissions, and model. It updates [concept 03 §2](../concept/03-tool-adapters-and-deployment.md#2-initial-tool-coverage) wherever it contradicts the concept.

### P0-03: Scaffold the monorepo *(2 days)*
- **Do:**
  - Set up pnpm workspaces with Node 22 LTS. Use TypeScript project references and a strict base `tsconfig`.
  - Create `apps/desktop` from **electron-vite** (React + TS template), then add Tailwind and shadcn/ui.
  - Create empty packages: `packages/core` and `packages/adapters/claude-code` and `codex-cli`.
  - Set up tooling: ESLint (flat config, typescript-eslint), Prettier, and Vitest (workspace mode).
  - Add an `import/no-restricted-paths` rule (or `eslint-plugin-boundaries`) so that **`packages/*` can never import `electron`**.
  - Add GitHub Actions CI (lint, typecheck, and test on `windows-latest` and `ubuntu-latest`).
- **Toolchain probe:**
  - Add `better-sqlite3` to `apps/desktop` and build a packaged app with electron-builder (`install-app-deps`).
  - Open a database in the main process and run an FTS5 query.
  - If this fails on CI, record the fallback decision (see the [README risks](README.md#5-top-risks-to-watch-during-implementation)).
- **Deliverable:** `pnpm dev` launches a window, and `pnpm build:win` produces an unsigned installer that runs.
- **Acceptance:** CI is green, the packaged app shows "SQLite OK (FTS5)", and the ESLint boundary rule fails a deliberate `import 'electron'` in core.

### P0-04: Filesystem port and test harness *(1 day)*
- **Do:** define `FsPort` in core. **All** core file I/O goes through it, so core can be tested in memory and the safety tests can spy on writes.
  ```ts
  interface FsPort {
    readFile(p: string): Promise<Buffer>;
    writeFileAtomic(p: string, data: Buffer | string): Promise<void>; // temp + rename
    rm(p: string): Promise<void>;
    readdir(p: string, opts?: { recursive?: boolean }): Promise<DirEntry[]>;
    stat(p: string): Promise<Stat | null>;
    mkdirp(p: string): Promise<void>;
  }
  ```
  - Implementations: `NodeFs` (real) and `MemFs` (built on `memfs`).
  - Also add `hashFile` (sha256) and `normalizeEol` helpers.
- **Deliverable:** `packages/core/src/fs/*` with tests.
- **Acceptance:** one contract test suite passes against both `NodeFs` (in a temp dir) and `MemFs`.

### P0-05: Canonical schemas *(2 days)*
- **Do:** write Zod schemas for `Skill`, `Agent`, and `Command` manifests (`amc.yaml`), following [concept 02](../concept/02-domain-model.md):
  - Common fields
  - `compat.exclude` and `compat.overrides.<tool>.raw` passthrough
  - The `ref` format (`kind.slug`)
  - Semver `version`
- Also generate JSON Schema from Zod (`zod-to-json-schema`) and save it to `packages/core/schema/*.json`. The YAML editor in M1.6 will use it for hints.
- **Deliverable:** `packages/core/src/model/{common,skill,agent,command,ref}.ts` and generated schemas.
- **Acceptance:** valid and invalid fixture manifests are accepted and rejected with readable error paths.

### P0-06: Library item read/write *(1.5 days)*
- **Do:** implement `readItem(dir)` → `LibraryItem` (manifest + body + extra files) and `writeItem(item)` → files, for all three kinds.
  - YAML output must be **stable**: key order, quoting, and trailing newline.
  - The design must guarantee `write(read(x)) === x` byte-for-byte for files AMC produced.
- **Deliverable:** `packages/core/src/library/item-io.ts`.
- **Acceptance:** a property test (fast-check) over generated items shows that write → read → write is idempotent.

### P0-07: Round-trip proof for Claude Code *(2 days)*
- **Do:** write the first draft of the Claude Code adapter's `parse` and `compile`, covering agents, skills, and commands.
- **Deliverable:** round-trip test over `fixtures/claude-code/` plus an opt-in test against the developer's real `~/.claude`, with `AMC_REAL_HOME=1`, **read-only**.
- **Acceptance:**
  - `compile(parse(native))` is **semantically equal** to `native`: same frontmatter keys and values, same body after whitespace normalization.
  - Any intentional difference is listed in `FORMAT.md`.

### P0-08: Write down Phase 0 findings *(0.5 day)*
- **Do:** update the concept docs where the findings contradicted them, mainly [03 §2](../concept/03-tool-adapters-and-deployment.md) and the capability matrices. Close Q1, Q3, and Q5 in [06](../concept/06-roadmap-and-open-questions.md).
- **Acceptance:** no remaining *(verify)* markers for Claude Code or Codex.

## 2. Resulting repo layout after Phase 0

```
agent-management-commander/
├── apps/desktop/                     # electron-vite app (window + SQLite probe)
├── packages/
│   ├── core/src/{fs,model,library}/
│   ├── core/schema/*.json            # generated JSON Schema
│   └── adapters/{claude-code,codex-cli}/{src,FORMAT.md}
├── fixtures/{claude-code,codex-cli}/ # real-world-shaped sample folders
├── docs/{concept,plan}/
├── .github/workflows/ci.yml
├── package.json          # Bun workspaces
├── tsconfig.base.json
└── eslint.config.js
```

## 3. Outcome (2026-09-25)

| Task | Result |
|------|--------|
| P0-01 | ✅ [claude-code/FORMAT.md](../../packages/adapters/claude-code/FORMAT.md) and fixtures |
| P0-02 | ✅ [codex-cli/FORMAT.md](../../packages/adapters/codex-cli/FORMAT.md) and fixtures. **This changed the concept:** Codex has native TOML agents and native skills in the shared `~/.agents/skills`, and its custom prompts are deprecated |
| P0-03 | ✅ The scaffold is in place, and the lint boundary rule is verified. **Deviations:** Node **24** LTS (not 22). TypeScript **6.0**, because typescript-eslint doesn't support TS 7 yet. Vite **7**, because electron-vite 5 needs it. **SQLite uses built-in `node:sqlite`**, because better-sqlite3 had no prebuilt binary and the machine has no MSVC toolchain. `node:sqlite` with FTS5 is verified in Node 24, in Electron 44, and in the packaged app (`AMC_SMOKE=1`). **Package manager switched from pnpm to Bun** (2026-09-25): Bun workspaces with the isolated linker, while Vitest and the tool CLIs still run on Node 24 |
| P0-04 | ✅ `FsPort`, `NodeFs` (atomic write with Windows retry), and `MemFs` (op log). One contract suite runs against both |
| P0-05 | ✅ Zod schemas and generated JSON Schema (`packages/core/schema/`). The description limit is 1,536 (Claude's), not 1,024, because real skills exceed 1,024. Model hints are abstract tiers |
| P0-06 | ✅ `readItem`/`writeItem` with stable YAML. A property test shows write → read → write is byte-identical |
| P0-07 | ✅ The Claude Code parse/compile round-trip passes for all fixtures and for the real `~/.claude` (4 skills, all Windows junctions into `~/.agents/skills`) |
| P0-08 | ✅ Concept 03, 05, and 06 are updated. Q1, Q3, and Q5 are closed |

Findings that feed Phase 1:
- Skills reached through **junctions/symlinks** are common. `scan` marks them `linked`. The deployer must refuse to write through links (S4, using realpath), and import dedupe must spot shared targets.
- `~/.agents/skills` is **shared by several tools**. Deploying there installs the skill for all of them, and the matrix must show that.
- The first positional argument in Claude commands may be `$0` or `$1` (UNCONFIRMED). Round-trips keep the indices exactly, but named-argument mapping waits for verification in M1.3.

## 4. Exit criteria (all must hold)

1. The Claude Code and Codex formats are documented as verified, with fixtures.
2. The round-trip test passes on the Claude Code fixtures and the real `~/.claude`.
3. The packaged Windows build runs and uses better-sqlite3 (or the documented fallback).
4. CI is green on Windows and Linux, and the boundary lint rule is enforced.
5. Q1, Q3, and Q5 are closed.
