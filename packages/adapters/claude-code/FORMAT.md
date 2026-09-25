# Claude Code — verified on-disk format

> **Verified:** 2026-09-25 against the official docs (code.claude.com/docs) and a real Windows `~/.claude`.
> Re-verify on each adapter release (see [engineering-practices](../../../docs/plan/engineering-practices.md)).
> Fixtures: [`fixtures/claude-code/`](../../../fixtures/claude-code/).

## 1. Roots

| Scope   | Root                                   | Notes                                                                                                       |
| ------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Global  | `~/.claude/` (`%USERPROFILE%\.claude`) | Relocated wholesale by **`CLAUDE_CONFIG_DIR`**. Source: https://code.claude.com/docs/en/claude-directory.md |
| Project | `<project>/.claude/`                   |                                                                                                             |

## 2. Agents (subagents): `agents/**/*.md`

Source: https://code.claude.com/docs/en/sub-agents.md

- Markdown with YAML frontmatter. **Subfolders are scanned recursively.** Identity is the `name` field, not the filename. On duplicates, the first loaded wins.
- Required keys: `name` (can't start with `-` or contain `:`) and `description`.
- Optional keys:
  - `tools` and `disallowedTools`: a comma-separated string or a YAML list
  - `model`: `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`
  - `skills`: skills to preload at startup
  - also `permissionMode`, `maxTurns`, `mcpServers`, `hooks`, `memory`, `background`, `omitClaudeMd`, `effort`, `isolation`, `color`, `initialPrompt`, `experimental`

## 3. Skills: `skills/<dir>/SKILL.md`

Source: https://code.claude.com/docs/en/skills.md

- The folder name becomes the `/slash` name. `name` defaults to the folder name.
- `description` plus `when_to_use` can be **at most 1,536 characters** combined.
- Optional keys: `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths`, `shell`, `metadata`, `license`, `compatibility`.
- Supporting files (`references/`, `scripts/`, anything else) are loaded only when the skill references them.

## 4. Commands: `commands/**/*.md`

Source: https://code.claude.com/docs/en/claude-directory.md

- Single Markdown files. Subfolders act as namespaces, but the command name is still the file's base name.
- Frontmatter uses the same keys as skills, minus `name`. Frontmatter is optional, and so is `description`.
- Placeholders are `$ARGUMENTS` and positional `$N`. It is **UNCONFIRMED** whether the first positional is `$0` or `$1`, because the docs mention `$0`. AMC keeps indices exactly as written (`$N` becomes `{{argN}}` and back), so round-trips are safe either way.
- `` !`cmd` `` (shell output injection) and `@path` (file reference) pass through untouched in the body.

## 5. Tools and permission syntax

Source: https://code.claude.com/docs/en/permissions.md

- Built-in tools include Read, Write, Edit, NotebookEdit, Grep, Glob, LSP, Bash, PowerShell, WebFetch, WebSearch, Agent, Skill, and TodoWrite. The full list is in the source.
- Rules take the form `Tool(specifier)`, for example `Bash(git diff:*)` or `Read(/src/**)`. MCP tools are named `mcp__<server>__<tool>`.

## 6. Plugins and tool-managed content (never adopted or written by AMC)

- **Plugins** are marked by `.claude-plugin/plugin.json`. Their components are namespaced as `plugin:name`.
- **`skills/synced/<org>_<id>/…`** holds skills synced from claude.ai, with a `manifest.json`. Claude manages this folder, and the scanner skips it (`TOOL_MANAGED_SKILL_DIRS`).

## 7. Observed on a real machine

- Skill folders in `~/.claude/skills/` can be **Windows junctions** into `~/.agents/skills/`, the shared Agent Skills location that Codex also reads. In that case the same skill is visible to both tools through one folder.
  - The scanner follows links for **reading** and marks them `linked: true`.
  - The deployer must never write through a link (invariant S4, which uses realpath).
  - Import dedupe must recognize the shared target.
- Real frontmatter uses plain, single-quoted, double-quoted, and `>-` folded scalars. Round-trip equality is therefore **semantic**, not byte-level.
- One real skill description is about 1,200 characters, which is over the Agent Skills limit of 1,024. The canonical limit is 1,536, and stricter per-tool limits are validator rules.
- A skill body may contain a second `---` block, such as pasted frontmatter. Only the first block counts as frontmatter.

## 8. AMC mapping (implemented in `src/`)

| Native                                        | Canonical                                                                                            | Lossless storage when mapping is lossy      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| agent `name`                                  | `slug` (sanitized)                                                                                   | `compat.overrides.claude-code.name`         |
| filename ≠ `<slug>.md` / nested               | —                                                                                                    | `…path`                                     |
| `tools` / `disallowedTools` / `allowed-tools` | `tools.allow` / `tools.deny` / `allowedTools` (abstract: `read`, `search`, `shell`, `mcp:<server>`…) | exact original value under the same key     |
| `model: opus/sonnet/haiku/inherit`            | `model.preferred: powerful/balanced/fast/inherit`                                                    | other values (`fable`, full IDs) → `…model` |
| agent `skills:` (preload)                     | `skills[].mode: always`                                                                              | `…skills` if names aren't slugs             |
| `$ARGUMENTS` / `$N`                           | `{{args}}` / `{{argN}}`                                                                              | literal `{{` escaped as `\{{`               |
| missing `description`                         | derived from the first body line                                                                     | `…derivedDescription: true` (not emitted)   |
| any other frontmatter key                     | —                                                                                                    | `…raw` (verbatim passthrough)               |
