# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Agent Management Commander (AMC)** is an Electron desktop app for managing AI-agent assets across tools such as Claude Code, Codex CLI, Gemini CLI, Copilot, and Cursor. Those assets are agents, skills, commands, and workflows.

The repo currently contains **only design docs**, and no code has been scaffolded yet. Before starting any work, read:
- `docs/concept/`: what and why (start with `README.md`, then `02-domain-model.md` and `03-tool-adapters-and-deployment.md`)
- `docs/plan/`: the phased task list with task IDs (`P0-NN`, `T<phase>.<milestone>.<n>`) and acceptance criteria. Work should map to a task ID, and branch names follow `feat/<task-id>-short-name`.

The next work is **Phase 0** (`docs/plan/phase-0-foundations.md`). When the monorepo is scaffolded (P0-03), replace the "Planned commands" section below with the real commands.

## Planned commands (from the plan; not yet available)

- `pnpm dev`: run the Electron app (electron-vite)
- `pnpm build:win`: package the Windows installer (electron-builder)
- `pnpm vitest run <path-or-pattern>`: run tests (Vitest workspace); `pnpm vitest run -t "<name>"` runs a single test
- `AMC_REAL_HOME=1`: opt-in, **read-only** tests against the developer's real `~/.claude` and `~/.codex`. All other tests must use an isolated temp `HOME`.

## Architecture (the big picture)

- **The library is the source of truth.** Canonical items live in `~/.amc/library`, which is a git repo managed by isomorphic-git. Each item is a folder: `amc.yaml` (manifest) plus a content file (`SKILL.md`, `prompt.md`, or `template.md`). Tool folders like `~/.claude` are **deploy targets** that only receive compiled output. `~/.amc/state/index.sqlite` is a rebuildable cache and never authoritative.
- **Items reference each other by stable ID** (`kind.slug`, e.g. `skill.security-checklist`). The ID never changes on rename. Composition is always an explicit reference, never copy-paste:
  - agent → skills (`on-demand` or `always`)
  - command → agent and preloaded skills
  - workflow → steps
  - skill → `dependsOn` other skills
- **Adapters** (`packages/adapters/<tool>`) implement `ToolAdapter`: `detect`, `capabilities`, `paths`, `scan`, `compile`, `parse`.
  - `compile` must stay **pure**: it takes a `ResolvedItem` and returns `CompiledFile[]`, and adapters never touch the library.
  - If a tool lacks a feature, the adapter applies a degradation and reports it as an `adaptation`. Permissions are never widened silently.
  - Unknown native fields are preserved in `compat.overrides.<tool>.raw`.
- **The deploy pipeline** runs: resolve closure → validate → compile → **plan** → snapshot → atomic write → lockfile.
  - No code path writes to a target without a plan.
  - The plan carries `readHashes`, and apply rejects a stale plan.
- **Ownership** is recorded in `.amc-lock.json` in each target root.
  - Files outside the lockfile are *foreign*, and AMC never modifies them.
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

Tool file paths and formats in the concept docs that are marked *(verify)* are assumptions. Check them against current tool docs and real folders before implementing an adapter. Record the verified results in `packages/adapters/<tool>/FORMAT.md` with fixtures in `fixtures/<tool>/`.
