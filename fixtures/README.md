# Fixtures

Real-world-shaped tool folders used by adapter golden and round-trip tests. These files are
**test data**: they must keep their exact bytes (`.gitattributes` marks them `-text`, so the CRLF
fixture stays CRLF). Do not reformat.

| Folder | Mirrors |
|--------|---------|
| `claude-code/global/` | `~/.claude` (agents, skills incl. tool-managed `synced/`, commands) |
| `codex-cli/codex-home/` | `~/.codex` (`agents/*.toml`, deprecated `prompts/`, `AGENTS.md` with an AMC-managed region, profile file) |
| `codex-cli/agents-home/` | `~/.agents` (shared user skills) |
| `codex-cli/project/` | a repo with `.agents/skills`, `.codex/agents`, `AGENTS.md` |
