# 04 — User Experience

## 1. UX principles

1. **Relationships are visible.** Wherever an item appears, you can see what it uses and what uses it.
2. **Preview before commit.** Every edit can be previewed as the actual file each tool will receive.
3. **Plain language first, YAML second.** Forms for newcomers, raw file editing for power users. Both edit the same data.
4. **Status at a glance.** Colored sync states (see [03 §6](03-tool-adapters-and-deployment.md#6-drift-detection)) appear consistently across the app.
5. **Keyboard-first.** A command palette (`Ctrl+K`) reaches every item and action.

## 2. Information architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ AMC   [Ctrl+K Search / run action…]                   Profile: Deep work ▾│
├───────────────┬──────────────────────────────────────────────────────────┤
│ ◉ Dashboard   │                                                          │
│               │                                                          │
│ LIBRARY       │                                                          │
│ ◇ Agents   12 │                  (main content area)                     │
│ ◇ Skills   34 │                                                          │
│ ◇ Commands 21 │                                                          │
│ ◇ Workflows 4 │                                                          │
│               │                                                          │
│ DEPLOY        │                                                          │
│ ▣ Targets     │                                                          │
│ ▦ Matrix      │                                                          │
│ ⟲ History     │                                                          │
│               │                                                          │
│ ⇩ Import      │                                                          │
│ ⬒ Packs       │                                                          │
│ ⚙ Settings    │                                                          │
└───────────────┴──────────────────────────────────────────────────────────┘
```

## 3. Screens

### 3.1 Dashboard
- **Detected tools** shown as cards: install status, version, and item counts per scope.
- **Health panel:** drifted files, broken references, outdated deployments, foreign files waiting for adoption. Each has a one-click fix.
- **Context budget:** an estimated token cost of always-loaded content (skill descriptions + inlined skills) per target, which helps users spot bloated global setups.
- **Recent activity:** edits, deploys, imports.

### 3.2 Library list (Agents / Skills / Commands / Workflows)
- Table/grid toggle, full-text search, and filters by tag, tool, deploy status, and author.
- Columns: name, description, version, *used by* count, *deployed to* icons, last modified.
- Bulk actions: deploy, tag, export to pack, delete (blocked while other items still use the target).

### 3.3 Item editor (the main workspace)

```
┌─ Agent: Code Reviewer  v1.3.0 ────────────────────────── [Validate] [Deploy ▾]┐
│ ┌─ Details ─┬─ Prompt ─┬─ Skills ─┬─ Tools & Model ─┬─ Relations ─┬─ History ┐│
│ │                                                                             ││
│ │  Equipped skills                         Preview as: [Claude Code ▾]        ││
│ │  ┌─────────────────────────────────┐    ┌──────────────────────────────────┐││
│ │  │ ⠿ Security Checklist  on-demand▾│    │ ---                              │││
│ │  │ ⠿ Style Guide         always   ▾│    │ name: code-reviewer              │││
│ │  │ + Add skill…                    │    │ description: Reviews code for …  │││
│ │  └─────────────────────────────────┘    │ tools: Read, Grep, Glob          │││
│ │  Prompt size: ~1,850 tokens              │ model: opus                      │││
│ │  ⚠ Codex: tool permissions dropped      │ ---                              │││
│ │                                          │ You are a senior reviewer…       │││
│ │                                          └──────────────────────────────────┘││
│ └─────────────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Left:** structured form with Monaco markdown editor for prompt/body fields.
- **Right:** live **compiled preview** per tool, with a tool switcher, adaptation warnings, and a diff against what's currently deployed.
- **Relations tab:** a mini-graph of "uses" and "used by".
- **History tab:** git log for this item with diff and restore.
- **Raw mode** toggle edits `amc.yaml` + body directly.

### 3.4 Composer (visual workflow builder)
This is the flagship feature and where AMC fixes messy combining.

```
┌─ Workflow: Feature Delivery ─────────────────────────────── [Preview] [Deploy]┐
│ Palette          │                                                            │
│ ▸ Agents         │   ┌──────────┐   plan   ┌─────────────┐  ✋approve        │
│   • Planner      │   │ /ship-   │────────▶│ Planner     │──────┐             │
│   • Implementer  │   │ feature  │          │ +req-analys │      ▼             │
│ ▸ Commands       │   └──────────┘          └─────────────┘  ┌─────────────┐   │
│   • review-pr    │                                           │ Implementer │   │
│ ▸ Skills         │        fail (max 2) ┌──────────────┐     │ +style-guide│   │
│   • security…    │      ┌───────────── │ /review-pr   │◀────└─────────────┘   │
│                  │      ▼              └──────────────┘                       │
│                  │  (Implementer)            │ pass                            │
│                  │                           ▼                                 │
│                  │                     ┌──────────┐                            │
│                  │                     │ Writer   │                            │
│                  │                     └──────────┘                            │
├──────────────────┴────────────────────────────────────────────────────────────┤
│ Inspector: step "implement" · agent: Implementer · input: plan · gate: approval│
└────────────────────────────────────────────────────────────────────────────────┘
```

- Drag agents, commands, and skills from the palette. Drop a **skill onto an agent node** to equip it for that step only. Connect nodes to define order and handoffs.
- The Inspector edits step instructions, inputs/outputs, gates, and loop limits.
- **Preview** shows the compiled result per tool (orchestrator command + sub-agents, or a single procedural command), with adaptation notes.
- The canvas and the YAML are two views of one model, and edits in either stay in sync.

### 3.5 Targets
- Lists every tool × scope. Project targets are grouped by registered project.
- Per target: path, detected version, capability matrix, active profile, managed/foreign counts.
- Actions: register project, set active profile, re-scan, open folder, "Sync all".

### 3.6 Deployment matrix
A grid with **items as rows** and **targets as columns**. Each cell shows a status icon, and clicking a cell toggles deployment for that item and target. Shadowing (a project copy overriding the global one) is shown with a link icon. This screen answers "what's installed where".

### 3.7 Deploy plan & history
- **Plan dialog:** a grouped list of creates, updates, deletes, and conflicts with a per-file diff viewer. Confirm or cancel.
- **History:** a timeline of deploys, each with a report, adaptations, and a **Revert** button.

### 3.8 Import wizard
Steps: **Detect → Scan → Review candidates (dedupe groups, relationship suggestions) → Adopt**. Every step shows counts and can be undone until the final "Adopt".

### 3.9 Packs
Export selected items with their dependencies into a `.amcpack` (zip with a manifest) or into a git repo folder. Import from a file, folder, or git URL. Before install, AMC shows a **security review** that lists any scripts included and their trust level.

## 4. Key user journeys

### J1 — First launch (onboarding)
1. Welcome → choose the library location (default `~/.amc/library`).
2. AMC detects tools: "Found Claude Code, Codex CLI, Cursor".
3. Offer to import: "Found 47 items across 3 tools (12 likely duplicates)". The user goes through the import wizard.
4. Land on the Dashboard with health issues highlighted. No files have been changed on disk yet.

### J2 — Create a skill and deploy it to all tools
1. Skills → **New** → pick a template (e.g. "Checklist skill").
2. Fill in name and description. The editor coaches the user on writing a good trigger description.
3. Write the body and check the Claude Code and Codex previews.
4. Choose **Deploy ▾ → Global: all detected tools**, review the plan (3 creates), and confirm. Done in under 30 seconds.

### J3 — Equip an agent with skills (the problem case)
1. Open **Code Reviewer** → **Skills** tab → add *Security Checklist* (on-demand) and *Style Guide* (always).
2. The preview shows the generated "Available skills" block and the inlined style guide. The token count updates.
3. Deploy. Every tool gets a correct, tool-specific version with no copy-paste.

### J4 — Build a workflow
1. Workflows → **New** → the canvas opens with an entry command node.
2. Drag in Planner → Implementer → `/review-pr` → Writer and set the approval gate plus the fail loop.
3. Preview per tool, then deploy. Users now type `/ship-feature ABC-123` in Claude Code.

### J5 — Resolve drift
1. The Dashboard shows "🟠 2 drifted files". The user edited `code-reviewer.md` directly in `~/.claude`.
2. Open it and see a 3-way diff. Choose **Pull back** to accept the edit into the library and bump the version.
3. AMC offers to redeploy the updated item to the other tools that have it.

### J6 — Switch profile for a project
1. Targets → *Claude Code / Project `D:\work\api`* → Profile: **Backend**.
2. The plan shows 6 deploys and 3 removals. Confirm, and the project gets exactly the intended set.

## 5. Visual design direction
- Dark and light themes that follow the OS by default.
- A dense, developer-tool aesthetic (in the spirit of VS Code or Linear): monospace for paths and IDs, restrained color reserved for status.
- Consistent kind colors and icons: **Agent** (persona icon), **Skill** (puzzle piece), **Command** (slash), **Workflow** (flow nodes).
