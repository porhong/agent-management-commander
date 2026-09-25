# 01 — Vision & Problem

## 1. The problem

AI coding tools now share the same three extension concepts, but each tool implements them differently:

| Concept | What it is | How it shows up today |
|---------|-----------|------------------------|
| **Agent** (sub-agent, custom agent, mode, chat mode) | A persona with its own system prompt, tool permissions, and model preference | `~/.claude/agents/*.md`, `.github/agents/*.agent.md`, `~/.config/opencode/agent/*.md`, … |
| **Skill** | A reusable package of instructions, plus optional scripts and reference files, that the model loads when relevant | `~/.claude/skills/<name>/SKILL.md`, `~/.codex/skills/…`, Cursor rules, … |
| **Command** (slash command, custom prompt, workflow) | A named prompt template the user triggers, often with arguments | `~/.claude/commands/*.md`, `~/.codex/prompts/*.md`, `~/.gemini/commands/*.toml`, … |

### Pain points we observed

1. **Scattered storage.** Each tool uses its own folder, file format, and frontmatter keys. A user with three tools has at least 9 locations to manage, more once project-scoped copies are counted.
2. **Composition is implicit and fragile.** To make "a code-review command that runs the reviewer agent using the security-checklist skill", people:
   - copy skill text into the agent prompt (the copies then drift apart), or
   - write "use the X skill" in prose and hope the model complies, or
   - depend on a file name that breaks when someone renames it.

   No single place shows how the pieces connect.
3. **Duplication across tools.** The same agent gets hand-ported into Claude Code, Codex, and Copilot formats. When one copy is fixed, the other copies stay broken.
4. **No inventory or health view.** Users can't easily answer:
   - Which skills are installed globally?
   - Which project overrides which global command?
   - Which agent references a skill that no longer exists?
5. **Unsafe experimentation.** Trying a new skill means editing live config folders. There's no undo, versioning, or staging.
6. **Sharing is manual.** Handing a teammate a workflow means zipping several folders and writing install instructions.

## 2. Vision

> **AMC is the control center for everything you teach your AI agents.** You build agents, skills, and commands once, wire them together into workflows on a visual canvas, and deploy them to every AI tool on your machine with one click. AMC keeps them in sync, versions them, and tells you what's installed where.

### The shift AMC makes

| Today | With AMC |
|-------|----------|
| Files live inside each tool's config folder | Files live in **one library**; tool folders are *deploy targets* |
| Composition = copy-paste or prose hints | Composition = **declared references** that AMC resolves and compiles |
| One format per tool, hand-ported | One **canonical format**, auto-converted by **adapters** |
| "What's installed?" = browsing folders | **Deployment matrix**: item × tool × scope, with drift status |
| Edit live, hope for the best | Edit → validate → preview per tool → deploy → roll back if needed |

## 3. Target users

| Persona | Description | Primary need |
|---------|-------------|--------------|
| **Power user / solo developer** (primary) | Uses 2–4 AI coding tools daily and has built up dozens of custom agents, skills, and commands | One place to manage everything, sync across tools, stop duplicating |
| **Workflow designer** | Builds multi-step processes (plan → implement → review → ship) out of agents and skills | A visual composer that makes connections explicit and testable |
| **Team lead** | Wants a consistent set of agents and commands across the team | Export, share, and import packs; project-scope deployment |
| **Newcomer** | Has heard of skills and agents but finds the folder conventions confusing | Guided creation with templates, validation, and plain-language explanations |

## 4. Goals

- **G1 — Unified library:** create, edit, search, tag, and version agents, skills, and commands in one place.
- **G2 — Explicit composition:** declare relationships (agent → skills, command → agent + skills, workflow → steps) and see them as a graph.
- **G3 — Multi-tool deployment:** render and install to any supported AI tool at **global** (user) or **project** scope.
- **G4 — Discover & adopt:** scan the PC for existing agent, skill, and command files and import them into the library without losing anything.
- **G5 — Safety:** validation, dry-run previews, ownership tracking, drift detection, and one-click rollback.
- **G6 — Shareability:** export and import **Packs** (bundles of items and their dependencies).

## 5. Non-goals (for v1)

- **Not an agent runtime.** AMC doesn't run LLMs or execute agents. The AI tools themselves do that. (Test-running through a tool's CLI is a later idea; see [06](06-roadmap-and-open-questions.md).)
- **Not a chat client.**
- **Not a cloud service.** v1 is local-first with no account. Sync between machines happens through git or exported packs.
- **Not an MCP server manager** in v1, although MCP configuration is a natural v2 extension because agents often depend on MCP tools.
- **No marketplace hosting** in v1. It can import from git URLs and local packs only.

## 6. Success criteria

| Metric | Target |
|--------|--------|
| Time to deploy one new skill to 3 tools | < 30 seconds (vs. several minutes of manual porting) |
| Existing items successfully auto-imported on first scan | ≥ 90% without manual fixes |
| Destroyed or overwritten user files not owned by AMC | **Zero** (hard requirement) |
| Broken references detected before deploy | 100% (validation blocks the deploy) |
| New tool adapter effort | ≤ 1 adapter module + tests, no core changes |
