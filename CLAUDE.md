# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Agent Management Commander (AMC)** is an Electron desktop app for managing AI-agent assets across tools such as Claude Code, Codex CLI, Gemini CLI, Copilot, and Cursor. Those assets are agents, skills, commands, and workflows.

Phase 0 is complete (see the outcome table in `docs/plan/phase-0-foundations.md`), and **Phase 1** (`docs/plan/phase-1-mvp.md`) is next. Before starting work, read:

- `docs/concept/`: what and why (start with `README.md`, then `02-domain-model.md` and `03-tool-adapters-and-deployment.md`)
- `docs/plan/`: the phased task list with task IDs (`P0-NN`, `T<phase>.<milestone>.<n>`) and acceptance criteria. Work should map to a task ID, and branch names follow `feat/<task-id>-short-name`.

## Commands

Bun workspaces monorepo (Bun is the package manager and script runner). The tool CLIs and the app run on Node 24 (`.nvmrc`). Workspaces are `apps/desktop`, `packages/core`, and `packages/adapters/*`.

- `bun run dev`: run the Electron app (electron-vite, hot reload). The first run downloads the Electron binary, because Electron 44 has no postinstall.
- `bun run build:win`: package the Windows NSIS installer into `apps/desktop/release/`. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` for unsigned local builds.
- `bun run lint`, `bun run typecheck` (`tsc` per package), `bun run format:check`, `bun run format`
- `bun run test`: runs all Vitest tests from the single root `vitest.config.ts`. **Not `bun test`**, which starts Bun's own test runner and fails.
  - One file or folder: `bunx vitest run packages/adapters/claude-code`
  - One test by name: `bunx vitest run -t "round-trips every fixture"`
  - Update golden snapshots **only after reviewing the diff**: `bunx vitest run -u`
- `bun run --filter @amc/core schema`: regenerate `packages/core/schema/*.json` after changing Zod manifests. A test fails if they are stale.
- `AMC_REAL_HOME=1 bunx vitest run packages/adapters/claude-code`: opt-in, **read-only** round-trip against the real `~/.claude`. All other tests use fixtures, `MemFs`, or temp dirs.
- `AMC_SMOKE=1 "<app>.exe"`: the headless smoke mode. The packaged app prints a JSON probe (versions, SQLite/FTS5) and exits. CI uses this.

## Toolchain constraints (don't "upgrade" past these without checking)

- **TypeScript 6.0**, not 7, because typescript-eslint doesn't support 7 yet. **Vite 7**, because electron-vite 5 needs it. `@vitejs/plugin-react` 5.x.
- **Tests run under Node through Vitest, not Bun.** The app ships on Electron's Node, and `node:sqlite` is a Node module, so tests must use the same runtime. Only package scripts (for example the schema generator) run directly on Bun.
- Bun uses its isolated linker: packages live in `node_modules/.bun/` and are symlinked into place, so phantom (undeclared) dependencies don't resolve. Packages whose install scripts must run go in root `trustedDependencies`.
- **SQLite is the built-in `node:sqlite`.** Don't add native modules like better-sqlite3: they need an MSVC toolchain that isn't installed.
- Workspace packages export TypeScript source (`"exports": "./src/index.ts"`). `electron.vite.config.ts` must list them in `externalizeDeps.exclude` so they get bundled.
- The desktop package is CommonJS output (no `"type": "module"`) because the sandboxed preload can't be ESM.
- `fixtures/**` are byte-exact test data (`-text` in `.gitattributes`, and Prettier ignores them). Don't reformat them.

## Architecture (the big picture)

- **The library is the source of truth.** Canonical items live in `~/.amc/library`, which is a git repo managed by isomorphic-git. Each item is a folder: `amc.yaml` (manifest) plus a content file (`SKILL.md`, `prompt.md`, or `template.md`). Tool folders like `~/.claude` are **deploy targets** that only receive compiled output. `~/.amc/state/index.sqlite` is a rebuildable cache and never authoritative.
- **Items reference each other by stable ID** (`kind.slug`, e.g. `skill.security-checklist`). The ID never changes on rename. Composition is always an explicit reference, never copy-paste:
  - agent → skills (`on-demand` or `always`)
  - command → agent and preloaded skills
  - workflow → steps
  - skill → `dependsOn` other skills
- **Adapters** (`packages/adapters/<tool>`) implement `ToolAdapter` (`packages/core/src/adapter/types.ts`): `detect`, `capabilities`, `rules`, `paths`, `scan`, `parse`, `compile`. They are built from an injected `AdapterHost` (fs, home, env, runVersion).
  - `compile` must stay **pure**: it takes a `ResolvedItem` (references embedded) plus a `Target` and returns `CompiledFile[]`. Adapters never touch the library.
  - A target has **named roots** (Codex: `codex` = `~/.codex`, `agents` = `~/.agents`). Every compiled or scanned file names its root.
  - Canonical positional placeholders are 1-based (`{{arg1}}` is the first argument). Claude Code's `$N` is 0-based.
  - If a tool lacks a feature, the adapter applies a degradation and reports it as an `adaptation`. Permissions are never widened silently.
- **Lossless round-trips through `compat.overrides.<tool>`:**
  - Canonical fields hold abstract values: permissions like `read`, `search`, `shell`, and model tiers `fast`, `balanced`, `powerful`.
  - When mapping a native value is lossy, the adapter stores the exact native value under the same key in the override block, and `compile` prefers it.
  - Unmodeled frontmatter goes to `…raw`.
  - Each adapter documents its mapping in `FORMAT.md` §8. Round-trip equality is **semantic** (frontmatter values plus body), not byte-level.
- **Command templates** use `{{args}}` and `{{name}}` placeholders. A literal `{{` is escaped as `\{{` (`packages/core/src/adapter/placeholders.ts`).
- **Links:** skill folders reached through a symlink or junction (common with `~/.agents/skills`) are read but never written through.
- **The deploy pipeline** runs: resolve closure → validate → compile → **plan** → snapshot → atomic write → lockfile.
  - No code path writes to a target without a plan.
  - The plan carries `readHashes`, and apply rejects a stale plan.
- **Ownership** is recorded in `.amc-lock.json` in each target root.
  - Files outside the lockfile are _foreign_, and AMC never modifies them.
  - For shared files like `AGENTS.md`, AMC owns only the regions between `<!-- amc:begin <id> -->` and `<!-- amc:end <id> -->`.
- **Package boundaries:**
  - `packages/core` and `packages/adapters/*` must never import `electron` (enforced by lint).
  - All core file I/O goes through `FsPort`, so it can be tested with `MemFs`.
  - The app and the future `packages/cli` consume core only through `packages/core/src/index.ts`.
- **Electron security:**
  - The renderer is sandboxed, with no Node access.
  - Every IPC channel is declared in `apps/desktop/src/shared/ipc-contract.ts` and Zod-validated in main.
  - There is no generic filesystem channel, and the renderer never passes arbitrary paths.

## Non-negotiable safety invariants

`docs/plan/engineering-practices.md` §5 lists invariants S1–S8, such as "never write a path not in the lockfile", "snapshot before write", "adopt/import writes nothing to targets", and "no write outside the target root". Any change to deploy, import, drift, or pack code must keep these tests passing and should add a test tied to the relevant invariant.

## Unverified facts

Claude Code and Codex formats are verified in `packages/adapters/{claude-code,codex-cli}/FORMAT.md`, although items there marked UNCONFIRMED still need checking. Other tools' paths in the concept docs are assumptions. Before implementing an adapter, verify them against current tool docs and real folders. Record the results in `packages/adapters/<tool>/FORMAT.md`, with fixtures in `fixtures/<tool>/`.
