# Agent Management Commander

You write an agent, a skill or a command once. AMC keeps the original, compiles a correct version
for each AI tool you use, and shows you exactly what would change before it writes anything.

It is a desktop app for Windows, macOS and Linux. Today it speaks Claude Code and Codex CLI.

> **Status: 0.1.0.** The first release. It is usable and it is careful — every write goes through
> a plan you review, and every deploy can be reverted — but it is young. Back up anything you
> would hate to lose, as with any new tool that touches your files.

## Why

If you use more than one AI coding tool, you have probably copied the same "review this code"
prompt into `~/.claude/agents/`, `~/.codex/`, and a note somewhere. Then you improved one of them.

AMC keeps one canonical copy and deals with the differences: Claude Code lists an agent's skills
in YAML frontmatter, Codex has no such field and needs them inlined into TOML, one tool's
placeholder is `$1` where another's is `{{arg1}}`. When a tool cannot do something, AMC says so
in the plan rather than quietly dropping it.

## Install

Download `amc-0.1.0-setup.exe` from the releases page and run it. It installs for the current
user only — no administrator prompt — and uninstalling leaves your library alone.

To build it yourself, see [Developing](#developing).

## First run

1. **Welcome.** AMC shows where your library will live and what tools it found on this machine.
2. **Import.** It reads what is already in those tool folders and proposes library items,
   grouping the same thing found in two tools into one. **It writes nothing back.** You choose
   what to keep and what to call it.
3. **The dashboard.** What is installed where, and anything that needs attention.

Nothing has been written to any tool folder at this point, and nothing will be until you apply a
plan.

## Five minutes of concepts

**The library is the source of truth.** It lives in `~/.amc/library` and it is a normal git repo
of normal folders. Each item is a folder with `amc.yaml` and one content file. You can read it,
back it up, or walk away with it. Your tools' folders are _deploy targets_: they receive compiled
copies, and AMC treats what it finds there as yours unless you tell it otherwise.

**Four kinds of item.**

| Kind        | What it is                                          |
| ----------- | --------------------------------------------------- |
| **Skill**   | Knowledge or a procedure an agent can draw on       |
| **Agent**   | A specialist you hand work to, equipped with skills |
| **Command** | A prompt you trigger by name, with arguments        |
| Workflow    | Several steps in order — Phase 2                    |

**Items reference each other; they are never copy-pasted.** An agent points at a skill by a
stable id like `skill.security-checklist`. Rename the skill and the reference still holds.
Deploying the agent brings its skills along.

**Nothing is written without a plan.** Every write — deploying, adopting a file AMC found,
reverting — produces a plan first: every file that would change, a diff on request, and a
decision to make wherever AMC would touch something it does not own. Applying it takes a snapshot
first, so it can be undone from History.

**AMC only owns what it wrote.** Each target folder gets an `.amc-lock.json` recording the files
AMC put there and their hashes. Anything else in that folder is _foreign_ and is never modified.
If you edit a deployed file by hand, AMC notices on its next check and says so rather than
overwriting you.

## Where things are

| Path                      | What                                                 |
| ------------------------- | ---------------------------------------------------- |
| `~/.amc/library`          | Your items. A git repo. The only thing that matters. |
| `~/.amc/state`            | Settings and a rebuildable search index              |
| `~/.amc/snapshots`        | What each deploy replaced, so it can be reverted     |
| `~/.amc/logs`             | Rotating JSON logs                                   |
| `<target>/.amc-lock.json` | What AMC owns in that tool folder                    |

Deleting `~/.amc/state` loses nothing: it rebuilds from the library and the lockfiles.

## Developing

Requires [Bun](https://bun.sh) and Node 24 (see `.nvmrc`).

```sh
bun install
bun run dev          # the app, with hot reload
bun run test         # unit and component tests
bun run e2e          # the user journeys, through the real app
bun run lint && bun run typecheck && bun run format:check
bun run build:win    # a Windows installer in apps/desktop/release/
```

`CLAUDE.md` is the orientation for the codebase: the architecture, the toolchain constraints, and
the safety invariants any change to the deploy, import or drift code has to keep.

The design notes are in [`docs/concept/`](docs/concept/) and the task-by-task plan, with what was
decided and why, is in [`docs/plan/`](docs/plan/).

## License

MIT — see [LICENSE](LICENSE). The packages AMC is built on keep their own licenses, listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (regenerate with `bun run notices`).

## What is not here yet

Workflows, tools beyond Claude Code and Codex CLI, sharing an item with someone else, a file
watcher (drift is checked when the window regains focus and every few minutes), and auto-update.
[`docs/concept/06-roadmap-and-open-questions.md`](docs/concept/06-roadmap-and-open-questions.md)
has the rest.
