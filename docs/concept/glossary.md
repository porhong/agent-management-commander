# Glossary

| Term | Definition |
|------|------------|
| **Adapter** | Module that converts between AMC's canonical format and one AI tool's native files; also detects and scans that tool |
| **Adaptation / Degradation** | A change the compiler made because a target tool lacks a feature (e.g. inlining a skill); always reported |
| **Adopt** | Import a foreign file into the library and take ownership of it |
| **Agent** | A persona: system prompt + tool permissions + model hint + equipped skills |
| **Canonical format** | AMC's tool-neutral representation of an item (`amc.yaml` + content files) |
| **Capability matrix** | Per-tool declaration of which features it supports natively |
| **Command** | A user-triggered prompt template with arguments; may target an agent and preload skills |
| **Compile** | Pure transformation of a resolved item into native files for a target |
| **Conflict** | A planned write would hit a foreign file at the same path |
| **Dependency closure** | An item plus everything it (transitively) references |
| **Deployment** | Record that a specific item version is installed into a target, with file hashes |
| **Drift** | A deployed, owned file differs from what AMC last wrote |
| **Equip** | Attach a skill to an agent (`on-demand` or `always`) |
| **Foreign file** | A file in a target folder that AMC does not own |
| **Item** | Any Agent, Skill, Command, or Workflow |
| **Library** | The git-backed folder (`~/.amc/library`) holding all canonical items; the source of truth |
| **Lockfile** | `.amc-lock.json` in a target root listing files AMC owns and their hashes |
| **Pack** | A shareable bundle of items plus dependencies (`.amcpack` or git folder) |
| **Plan** | The previewed set of creates/updates/deletes/conflicts before a deploy is applied |
| **Profile** | Named set of items to enable on a target; switching applies the difference |
| **Pull back** | Accept a drifted file's changes into the library via 3-way merge |
| **Scope** | Global (user-wide) or Project (one folder) |
| **Shadowing** | A project-scope item overriding a global item with the same slug |
| **Skill** | Reusable instructions (+ optional scripts/resources) loaded on demand |
| **Snapshot** | Backup of files taken before a deploy, enabling rollback |
| **Target** | A Tool + Scope pair where items are deployed |
| **Tool** | A supported AI application (Claude Code, Codex CLI, Gemini CLI, …) |
| **Workflow** | Ordered chain of steps (agents/commands with handoffs and gates) compiled into tool-runnable form |
