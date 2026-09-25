# 06 — Roadmap, Risks & Open Questions

## 1. Phased delivery

### Phase 0 — Foundations (spike)
- Verify current file formats and paths for Claude Code and Codex CLI (the P0 adapters). Record findings in the adapter docs.
- Scaffold the monorepo (electron-vite, `core`, `adapters`, `desktop`).
- Write Zod schemas for Agent, Skill, and Command, plus the library read/write round-trip.
- **Exit criteria:** round-trip test passes for a real `~/.claude` folder: parse → canonical → compile gives files equivalent to the originals.

### Phase 1 — MVP: "Unified library for 2 tools"
- Library CRUD for **Agents, Skills, Commands** with the form editor, Monaco, and a per-tool compiled preview.
- Explicit **agent → skills** and **command → agent/skills** references, with resolver and validator.
- **Claude Code + Codex CLI** adapters at **global + project** scope.
- Deploy pipeline: plan → apply → lockfile → snapshots → rollback.
- Import wizard: detect, scan, dedupe, adopt.
- Dashboard with health checks; deployment matrix.
- Library git history (auto-commit).
- **Exit criteria:** a user with an existing Claude Code setup can import it, manage it, deploy the same skills to Codex, and never lose a file.

### Phase 2 — "Compose"
- **Workflows** with the visual **Composer** (React Flow), step handoffs, gates, and loop-back.
- Workflow compilation to orchestrator (sub-agent tools) and procedural (command-only tools) forms.
- Drift detection with watcher + 3-way merge "pull back".
- **Profiles** per target.
- Adapters: **Gemini CLI, GitHub Copilot, Cursor**.

### Phase 3 — "Share & extend"
- **Packs** export/import (file, folder, git URL) with security review.
- `amc` **CLI** built on the same core.
- **Generic adapter** (user-defined folder + template); OpenCode adapter.
- Context-budget estimator; template gallery.

### Phase 4 — Future ideas (not committed)
- **MCP server management** alongside agents (agents often depend on MCP tools).
- **Test harness:** run a command or workflow through a tool's headless CLI (e.g. `claude -p`) against a sample repo and snapshot the output. This brings evals to prompts.
- **AMC as MCP server** so agents can discover and install skills themselves.
- Community pack registry.
- Multi-machine sync via a git remote with conflict UI.
- Usage insights: which skills are actually invoked (where tools expose logs).

## 2. Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tool formats change frequently | Adapters break, output ignored | Adapter version metadata; snapshot tests; format verification checklist per release; Generic adapter as fallback |
| Users edit deployed files directly | Constant drift, lost edits | First-class drift + "pull back" 3-way merge, not overwrite-by-default |
| Overwriting a user's hand-made file | Loss of trust (fatal) | Lockfile ownership, conflicts require explicit choice, snapshots before every write |
| Canonical model too generic, loses tool-specific power | Power users stay on raw files | `compat.overrides.<tool>` escape hatch with raw frontmatter passthrough |
| Workflow compilation produces unreliable behavior in weaker targets | Workflows "work" in one tool, not another | Show compiled form + adaptation notes; mark support level per target (Full / Adapted / Not invocable) |
| Malicious skills from shared packs | Code execution via agent scripts | Trust levels, mandatory review for scripts, permission-widening warnings |
| Scope creep into "yet another agent runtime" | Delays MVP | Non-goals in [01 §5](01-vision-and-problem.md#5-non-goals-for-v1) are enforced; runtime features only as Phase 4 ideas |

## 3. Open questions (decisions needed)

| # | Question | Options | Leaning |
|---|----------|---------|---------|
| Q1 | Canonical skill format: invent our own or adopt the `SKILL.md` convention directly? | Own format / SKILL.md + `amc.yaml` sidecar | **SKILL.md body + `amc.yaml` sidecar**: closest to an emerging standard, keeps AMC metadata separate |
| Q2 | Library location default | `~/.amc/library` / Documents / user-chosen at onboarding | `~/.amc/library`, changeable at onboarding |
| Q3 | Git engine | isomorphic-git (bundled) / system git | isomorphic-git by default, system git if detected (for remotes & credentials) |
| Q4 | Is a workflow deployable to tools without sub-agents at all? | Yes, degraded / No, block | Yes, degraded, with clear "Adapted" label |
| Q5 | Should the renderer UI library be shadcn/ui or something like Mantine? | shadcn/ui / Mantine / Fluent | shadcn/ui (flexible, dense, themable) |
| Q6 | License & distribution | Open source (MIT) / source-available / closed | *Owner decision* |
| Q7 | Do we support per-project *library* (items that live in a repo, not in `~/.amc`)? | Global library only / also project libraries | Phase 2: allow mounting a repo folder as an additional library source |
| Q8 | Naming of the composed unit | Workflow / Recipe / Playbook / Mission | **Workflow** (matches user mental model) |
| Q9 | Auto-apply on library save? | Always ask / auto when no conflicts / per-target setting | Per-target setting, default "ask" |

## 4. Next steps

1. Review and confirm the domain model ([02](02-domain-model.md)). It's the foundation for everything else.
2. Settle Q1, Q3, Q5, and Q6.
3. Start Phase 0: verify Claude Code and Codex formats, scaffold the monorepo, and write schemas and round-trip tests.
