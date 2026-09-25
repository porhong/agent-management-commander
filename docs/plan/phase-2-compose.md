# Phase 2: Compose

**Goal:** make combining agents, skills, and commands visual and reliable with **Workflows** and the **Composer**. Also handle real-world drift gracefully, add profiles, and extend to three more tools.

**Estimate:** 7–9 weeks. **Release:** v0.2.0 (Windows, macOS, Linux).

| Milestone | Estimate | Depends on |
|-----------|----------|------------|
| M2.1 Workflow model & compiler | 1.5 wks | Phase 1 |
| M2.2 Composer UI | 2 wks | M2.1 |
| M2.3 Drift watcher & pull-back | 1.5 wks | Phase 1 |
| M2.4 Profiles | 1 wk | Phase 1 |
| M2.5 Adapters: Gemini CLI, Copilot, Cursor | 2 wks (parallelizable) | Phase 1 |
| M2.6 Project libraries (Q7) | 0.5–1 wk | M2.4 |
| M2.7 Cross-platform release | 0.5 wk | all |

M2.3, M2.4, and M2.5 don't depend on M2.1 or M2.2, so a second developer can take them.

---

## M2.1: Workflow model & compiler

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T2.1.1 | Workflow schema | Zod schema for `workflow.*` per [concept 02 §6](../concept/02-domain-model.md): entry command, steps (`agent` or `command` ref, `instructions`, `input`/`output` handoff names, `gate: user-approval`, `onFail: { goto, maxLoops }`), optional per-step `equip` skills | Invalid graphs are rejected: unknown step refs, `goto` to a missing step, unreachable steps, loops without `maxLoops` |
| T2.1.2 | Graph validation rules | New rules: handoff output consumed before it's produced, `maxLoops` > 5 warning, total inlined size | Each rule has fixtures |
| T2.1.3 | Orchestrator compiler | For tools with `subAgentDelegation`: emit the entry command as an orchestrator prompt ("Step 1: delegate to `planner` with … Save output as `plan` … Stop and ask for approval…") plus make sure every referenced agent and skill is in the closure | Golden tests for Claude Code |
| T2.1.4 | Procedural compiler | For tools without sub-agents: one command that contains the steps in sequence with inlined personas ("Now act as Implementer: …"). Marked **Adapted** | Golden tests for Codex. The adaptation list explains what was lost |
| T2.1.5 | Support levels | Each (workflow, target) pair gets **Full / Adapted / Not invocable**, shown in the matrix and the preview | `commands: 'none'` tools → Not invocable, and the deploy is blocked for that target |
| T2.1.6 | Step-scoped skills | Skills equipped on a step (not the agent) are injected only into that step's delegation instructions | A test confirms the agent file itself is unchanged |

## M2.2: Composer UI

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T2.2.1 | Canvas | React Flow canvas with node types: Entry command, Agent step, Command step, End. Edge types: sequence (with handoff label), fail-loop (dashed, with max count) | Pan, zoom, minimap, auto-layout (elkjs) |
| T2.2.2 | Palette & drag-drop | Library palette (search). Drag an agent or command → step node. **Drop a skill on a step** → step-scoped equip | Drop targets are highlighted. An invalid drop explains why |
| T2.2.3 | Inspector | Step form: instructions (Monaco), input/output names, gate toggle, onFail target and max loops | Edits update the canvas immediately |
| T2.2.4 | Two-way YAML sync | Canvas ↔ `amc.yaml` share one model. Positions are stored in `layout.json` (not in the manifest) | Editing YAML re-renders the canvas. Layout-only changes don't bump the version |
| T2.2.5 | Preview & deploy | Per-tool compiled preview (orchestrator vs. procedural) with the support-level badge. Deploy goes through the standard plan | Journey J4 passes as E2E |
| T2.2.6 | Relations graph | Reuse the canvas renderer read-only for the item editor's Relations tab (deferred from T1.6.8) | — |

## M2.3: Drift watcher & pull-back

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T2.3.1 | Watcher | `WatchService` using `@parcel/watcher` (native, fast on Windows) on all managed target roots plus the library. Debounced and coalesced. Falls back to periodic checks | Survives a folder being deleted and recreated. CPU is idle when nothing changes |
| T2.3.2 | Library external edits | Edits made to `~/.amc/library` outside AMC (e.g. in VS Code) → reindex plus an auto-commit prompt | The index reflects the change within 1s |
| T2.3.3 | 3-way merge engine | `merge3(base = last deployed, ours = library compiled, theirs = disk)` on **compiled** text. Then **reverse-map** the result into canonical fields (body, and frontmatter → manifest) through the adapter's `parse` | Clean merges apply automatically. Conflicts produce hunks for the UI |
| T2.3.4 | Pull-back UI | Monaco 3-way merge view. Accept → library update, version bump, and commit. Then offer "redeploy to other targets that have this item" | Journey J5 passes as E2E |
| T2.3.5 | Detach | Remove from the lockfile (the file becomes foreign), with a record in history | Detached files are never touched again |
| T2.3.6 | Base content storage | Keep the last deployed content (not just the hash) for owned files. This is the merge base, stored in `state/deployed/<target>/<hash>` with deduplication | Pruned along with snapshots |

## M2.4: Profiles

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T2.4.1 | Profile model | `profiles/<name>.yaml`: an include list of item refs and tags (`tag:backend`), plus excludes | Resolved profile = explicit closure |
| T2.4.2 | Active profile per target | Setting a profile → a plan with creates and deletes to match it exactly (owned files only) | Journey J6 passes as E2E |
| T2.4.3 | Profile UI | Profile editor (checklist + tag rules), switcher in the header and on the target card | — |

## M2.5: Adapters: Gemini CLI, GitHub Copilot, Cursor

For each adapter, repeat the Phase 0 verification (P0-01 pattern → `FORMAT.md` + fixtures), then implement detect, compile, scan, and parse with golden tests.

| ID | Adapter | Specific concerns |
|----|---------|-------------------|
| T2.5.1 | Gemini CLI | TOML commands (`@iarna/toml` or `smol-toml`), `{{args}}` mapping, `GEMINI.md` managed regions, extensions |
| T2.5.2 | GitHub Copilot | The user-level location is inside **VS Code user data** (differs per OS and for Insiders). Project level is `.github/`. Handle `*.prompt.md`, `*.instructions.md`, and `*.agent.md` |
| T2.5.3 | Cursor | Rules `.mdc` with `description` / `globs` / `alwaysApply` → skill mapping. Commands folder. Some global settings may live in the app DB (not files), so mark them unsupported rather than hacking around it |
| T2.5.4 | Capability docs | Update [concept 03 §2](../concept/03-tool-adapters-and-deployment.md#2-initial-tool-coverage) with verified rows and remove the *(verify)* markers | — |

## M2.6: Project libraries (Q7)

| ID | Task | Deliverables | Acceptance |
|----|------|--------------|------------|
| T2.6.1 | Additional library sources | Mount a repo folder (e.g. `<project>/.amc/`) as an extra library with the same layout. IDs are namespaced by source when they collide | Items show a source badge. Git history uses that repo |
| T2.6.2 | Shadowing | A project item overrides a global item with the same slug for that project's targets, and the matrix shows it | Per [concept 02](../concept/02-domain-model.md) shadowing rules |

## M2.7: Cross-platform release 0.2.0

- Build on macOS (sign and notarize) and Linux (AppImage and deb).
- Run the full E2E suite on all three operating systems in CI.
- Test path handling across `%APPDATA%`, `~/Library/Application Support`, and XDG.

## Phase 2 exit criteria

1. Journeys J4, J5, and J6 pass as E2E on all three operating systems.
2. A workflow built in the Composer runs correctly in Claude Code (Full) and Codex (Adapted), confirmed manually.
3. The five adapters have verified `FORMAT.md` files and green golden tests.
