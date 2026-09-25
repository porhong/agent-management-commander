# Changelog

Notable changes to Agent Management Commander. Dates are the release date; versions follow
[semantic versioning](https://semver.org).

## 0.1.0 — 2026-09-25

The first release. One library, compiled for Claude Code and Codex CLI, with every write
reviewed before it happens.

### Library

- Items live in `~/.amc/library` as plain folders — `amc.yaml` plus one content file — in a git
  repo AMC commits to on every save. Version history, diffs and restore are built on it.
- Skills, agents and commands, referencing each other by a stable id that survives renaming.
- An editor with per-kind forms, a raw `amc.yaml` mode with field completion, validation shown
  inline and as an issue list, relations, and history.
- A compiled preview beside the editor that shows exactly what each tool would receive,
  recompiled from what you are typing rather than from what is saved.
- Full-text search over the library and a `Ctrl+K` palette over items and actions.

### Tools

- **Claude Code** and **Codex CLI** adapters: detection, reading what is there, and compiling
  to each tool's own format. Where a tool cannot express something, the difference is applied as
  a documented adaptation and reported in the plan rather than dropped silently.
- Round-trips are lossless: values a tool spells differently are kept verbatim under
  `compat.overrides`, and unmodeled fields are preserved.

### Deploying

- Every write is a plan first: the files that would change, a diff on request, the adaptations,
  and a decision wherever AMC would touch something it does not own.
- Ownership is recorded per target in `.amc-lock.json`. Files AMC did not write are never
  modified, and within shared files like `AGENTS.md` only the region between its own markers is.
- Snapshots before every write, an atomic write order, a journal that survives a crash, and
  revert from History.
- A matrix of items against targets, per-target settings, and project folders alongside the
  global scopes.

### Importing

- Reads what your tools already have and proposes library items, grouping the same thing found
  in several tools into one by name and then by content similarity.
- Links one item's prose implies are offered with the line they came from, never applied on
  their own; links a file already declared are carried over.
- **Import writes nothing to a tool folder.** Recording that AMC now owns those files is a
  separate plan you review.

### Keeping track

- A dashboard whose health rows each name something real and carry one action.
- Drift checking: every file AMC owns is hashed against what it wrote, when the window regains
  focus and every five minutes, so an edit made in a tool folder shows up rather than being
  quietly overwritten on the next deploy.
- First-run onboarding, re-runnable from Settings, which writes nothing but the flag saying it
  was seen.

### Release

- MIT licensed, with third-party notices generated from the installed dependency tree.
- A per-user Windows installer (NSIS). Uninstalling leaves `~/.amc` alone.
- Checks GitHub Releases for a newer version, off by a setting. It is the only network request
  AMC makes, and nothing is downloaded or installed unless you ask for it.

### Known limits

- Workflows are not built yet.
- Only Claude Code and Codex CLI are supported.
- Drift is checked on a timer, not watched; a file watcher comes in Phase 2.
- The Windows installer is not signed yet, so SmartScreen will warn on first run. Update checks
  are wired but unverified until the first release is published and signed.
