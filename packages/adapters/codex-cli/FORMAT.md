# OpenAI Codex CLI: verified on-disk format

> **Verified:** 2026-09-25 against the official docs. `developers.openai.com/codex/*` now redirects to `learn.chatgpt.com/docs/*`.
> Local `~/.codex` was **not** read. Fixtures: [`fixtures/codex-cli/`](../../../fixtures/codex-cli/).
> Items marked **UNCONFIRMED** must be checked against a live Codex install before M1.3 (T1.3.5).

## 1. Roots

| What           | Location                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex home     | `~/.codex/`, relocated by **`CODEX_HOME`**                                                                                                        |
| User skills    | **`~/.agents/skills/<name>/`**. This folder is shared with other Agent-Skills tools. The legacy `~/.codex/skills` is UNCONFIRMED as still scanned |
| Repo skills    | `.agents/skills/` in every folder from the cwd up to the repo root                                                                                |
| Custom agents  | `~/.codex/agents/*.toml` (personal) and `.codex/agents/*.toml` (project)                                                                          |
| Custom prompts | `~/.codex/prompts/*.md`. Top level only, **user scope only**                                                                                      |
| Instructions   | `~/.codex/AGENTS.md` (or `AGENTS.override.md`) plus per-directory `AGENTS.md`                                                                     |

## 2. Skills (native, Agent Skills spec)

Source: https://learn.chatgpt.com/docs/build-skills, https://agentskills.io/specification

- `SKILL.md` frontmatter requires `name` and `description`. The spec limits:
  - `name`: 1–64 characters, `[a-z0-9-]`, and it must match the folder name
  - `description`: 1–1,024 characters
- Optional spec keys are `license`, `compatibility`, `metadata`, and `allowed-tools`. Whether Codex honors them is UNCONFIRMED.
- Supporting folders: `scripts/`, `references/`, `assets/`.
- Optional `agents/openai.yaml` holds:
  - `interface`: `display_name`, `short_description`, icons, `brand_color`, `default_prompt`
  - `policy.allow_implicit_invocation`
  - `dependencies.tools[]`
- Invoked explicitly with `$skill-name`, or implicitly when the description matches.
- Symlinked skill folders are followed. Changes are hot-detected.
- Per-skill disable: in `config.toml`, add `[[skills.config]] path = "…/SKILL.md"` with `enabled = false`.

## 3. Custom agents (native, TOML)

Source: https://learn.chatgpt.com/docs/agent-configuration/subagents

- One TOML file per agent. **Required:** `name` (the identity, not the filename), `description`, `developer_instructions`.
- Optional: any `config.toml` key, such as `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, or `skills.config`.
- The built-ins are `default`, `worker`, and `explorer`. A custom agent with the same name overrides a built-in.
- Known issue: roles in a project `.codex/config.toml` aren't available to `spawn_agent` (openai/codex#14579). This doesn't affect agent files.

## 4. Custom prompts (commands): **deprecated**

Source: https://learn.chatgpt.com/docs/custom-prompts

- Frontmatter keys: `description`, `argument-hint`. Invoked as `/prompts:<file>`.
- Placeholders:
  - positional `$1`–`$9`
  - `$ARGUMENTS` for all arguments
  - **named uppercase `$FILE`**, passed as `FILE=value`
  - `$$` for a literal `$`
- There is no project scope, and Codex must be restarted to pick up edits. The docs recommend skills instead.

## 5. AGENTS.md

Source: https://learn.chatgpt.com/docs/agent-configuration/agents-md

- Global: the first non-empty file of `AGENTS.override.md` or `AGENTS.md` in Codex home.
- Project: in each directory from the git root to the cwd, the first of `AGENTS.override.md`, `AGENTS.md`, or a name listed in `project_doc_fallback_filenames`.
- Files are joined root first. The combined size is capped by **`project_doc_max_bytes`, 32 KiB by default**.

## 6. Permissions and profiles

Source: https://learn.chatgpt.com/docs/config-file/config-reference, …/config-advanced

- **Permissions are coarse.** `sandbox_mode` is one of `read-only`, `workspace-write`, or `danger-full-access`. `approval_policy` is set too. **There is no per-prompt or per-skill tool allow-list.** Per-agent settings are possible through the agent TOML.
- **Profiles** (Codex 0.134 and later) are separate files, `$CODEX_HOME/<name>.config.toml`, selected with `--profile`. The older `[profiles.x]` tables aren't read anymore.

## 7. Capability decision (feeds `CapabilityMatrix`, M1.3)

| Canonical feature                | Status                 | Codex output                                                                                                                                |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill                            | **Native**             | `~/.agents/skills/<slug>/SKILL.md` (+ files) · project: `.agents/skills/`                                                                   |
| Agent                            | **Native**             | `~/.codex/agents/<slug>.toml` (`developer_instructions` = prompt body)                                                                      |
| Agent → skill `on-demand`        | **Native**             | Nothing to emit (skills are globally discoverable)                                                                                          |
| Agent → skill `always`           | **Degraded**           | Skill body inlined into `developer_instructions`                                                                                            |
| Command (global)                 | **Native, deprecated** | `~/.codex/prompts/<slug>.md`, with an adaptation note                                                                                       |
| Command (project)                | **Degraded**           | Compiled as a repo skill (invoked `$slug`), because prompts have no project scope                                                           |
| Named command args               | **Native**             | `{{pr}}` → `$PR`. `{{args}}` → `$ARGUMENTS`                                                                                                 |
| Tool permissions (agent)         | **Degraded**           | `sandbox_mode`: `read-only` unless the agent allows `write`/`edit`/`shell`, which maps to `workspace-write`. **Never `danger-full-access`** |
| Tool permissions (skill/command) | **Unsupported**        | Dropped, with a warning                                                                                                                     |
| Model hint                       | **Native**             | Tier → configurable OpenAI model table (default values UNCONFIRMED)                                                                         |
| Instructions / always-on rules   | **Native**             | Managed regions in `AGENTS.md` (T1.3.6), counted against the 32 KiB limit                                                                   |

## 8. Implications for AMC

- **`~/.agents/skills` is shared.** Other tools read it, and on this machine Claude Code does too, through junctions. A skill deployed there is effectively installed for every tool that reads it. The deploy plan and the deployment matrix must show that, and dedupe must treat such a skill as one item with multiple consumers.
- Codex agents are TOML, so we need a TOML parser and serializer. The candidate is `smol-toml`. That work belongs to M1.3.

## 9. AMC mapping (implemented in `src/`, M1.3)

- **Roots.** A target writes into two roots:
  - `codex`: `~/.codex` (or `$CODEX_HOME`); in projects, `<project>/.codex`.
  - `agents`: `~/.agents`; in projects, `<project>/.agents`.
  - Custom prompts are scanned and written at global scope only.
- **Agent TOML layout.** `stringifyAgentToml` writes plain keys first, then `developer_instructions` as a `'''` multi-line literal (falling back to an escaped string if the text contains `'''` or control characters), then tables.
- **Tools.** `sandbox_mode` comes from `tools.allow`. It is `workspace-write` if the list includes `write`, `edit`, `shell`, or `shell:<x>` (except `shell:readonly`), and `read-only` otherwise. It is never `danger-full-access`. A native `sandbox_mode` is kept exactly in `compat.overrides.codex-cli.sandbox_mode` and is never inferred back into tools.
- **Models.** The tier → model table is **empty by default** (`createCodexAdapter(host, { models })`). An unmapped tier omits `model` and reports `agent.model.unmapped`. A native model that isn't in the table goes to `…model`.
- **Prompt templates.**
  - `$ARGUMENTS` ↔ `{{args}}`.
  - `$1`–`$9` ↔ `{{arg1}}`–`{{arg9}}`. Higher positions compile to `$ARGUMENTS`, with an adaptation.
  - `$NAME` ↔ `{{name}}`.
  - `$$` ↔ a literal `$`. On compile, any literal `$` followed by `[A-Z0-9$]` is escaped as `$$`.
- **Project commands** become `agents:skills/<slug>/SKILL.md`. Placeholders become `<name>`, preceded by an argument list. A validator rule rejects a project command whose slug a skill already uses, or whose description exceeds 1,024 characters.
- **Degradations** are all reported as `adaptations[]`:
  - always-on skills (with their dependencies) are inlined into `developer_instructions`
  - `delegatesTo` and command → agent/preload become prompt text
  - the tool deny list, per-skill and per-command tools, and triggers are dropped
- **Known gap.** A prompt named argument called `$ARGS` or `$ARG<N>` would collide with canonical `{{args}}`/`{{argN}}`. This hasn't been seen in practice.
