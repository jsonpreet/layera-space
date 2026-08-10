# Layera Space

A local-first **agent development environment**: a multi-workspace terminal grid
for Claude Code, Codex and opencode, plus a headless run engine powering chat,
plans, a visual agent graph with parallel builders and a verifier loop, project
memory, skills, a task board, session replay, browser preview and an editor.

Everything runs against the CLIs you already have installed. **No API keys are
stored in the app.**

macOS and Windows · Tauri v2 · React + TypeScript · Rust

---

## Running it

```bash
npm install
npm run tauri dev      # the app, with hot reload
npm run check          # tsc + vitest + cargo check + clippy + cargo test
```

Building an installer:

```bash
npm run build:mac      # universal .dmg (arm64 + x64)
npm run build:win      # NSIS installer
```

Unsigned macOS builds are quarantined by Gatekeeper. To run one locally:

```bash
xattr -dr com.apple.quarantine "/Applications/Layera Space.app"
```

## What it needs

At least one of `claude`, `codex` or `opencode` on your `PATH` (the app also
looks in `~/.local/bin`, Homebrew, Volta, asdf, bun and `~/.opencode/bin`).
`git` is required for run diffs and for parallel builders. `curl` is used to
import a skill from a URL.

---

## How it fits together

### The run engine

Every non-interactive feature — chat, plans, builds, graph nodes, verifiers —
is one abstraction: spawn an installed CLI headlessly and stream structured
events back.

```
claude    →  claude -p --output-format stream-json --verbose   (prompt on stdin)
codex     →  codex exec --json -s <sandbox> -C <cwd> -o <file> -
opencode  →  opencode run --format json --dir <cwd> [--auto] <prompt>
shell     →  sh -lc / powershell -Command
```

If the chosen runner isn't installed, the engine falls back to the next one and
says so in the UI.

**Output parsing degrades rather than breaks.** CLI JSON schemas change between
versions, so: an unrecognised line becomes a `raw` event instead of an error;
the transcript stores the untouched line alongside the parsed event so old runs
can be re-parsed by a later version; fields are looked up through a list of
candidate paths, so a rename costs one entry rather than a rewrite; and a run
whose output stops being recognised is flagged instead of silently mangled.

**Events are batched** (16 ms / 64 events). Three parallel builders streaming
line-by-line would otherwise flood the IPC channel and lock the window.

### Seeing what a run changed

Diffs are captured by writing a git tree from a **temporary index** before and
after the run:

```
GIT_INDEX_FILE=<tmp> git read-tree HEAD && git add -A && git write-tree
```

This is exact, includes untracked files, respects `.gitignore`, and — unlike
diffing `git status` — still sees edits to files that were already modified
before the run. Your index, HEAD and working tree are never touched. There is a
test that asserts exactly that.

### Parallel builders

A coordinator fans one task out to several builders at once, each in its own
git worktree so they cannot overwrite each other. Builders branch from a
**wave base**: a commit built from your working tree as it currently stands,
via `commit-tree`, without touching HEAD. Uncommitted work therefore carries
into every worktree instead of appearing as a mass deletion.

The aggregator diffs each builder's branch against that base so you can compare
and take one. Worktrees are removed afterwards; **branches are kept** — agent
work is never deleted automatically.

A fresh worktree has no `node_modules`, so builder nodes take a setup command
and can link dependencies in from the main folder.

### Memory

`.layera/memory/{context,tasks,handoffs,decisions,bugs}/*.md` inside the
project — plain Markdown, committed with your code. Notes link to each other
with `[[wiki-links]]`, which are indexed and drawn as a force-directed graph.

Context selection is **deterministic and explainable**, not embedding search:
notes you name with `@name`, then their linked neighbours, then recent notes in
the enabled folders, up to a character budget. The composer shows exactly what
was included.

### Skills

Markdown instruction files with optional frontmatter, kept in the app data
directory. Import from a file, a URL, or a git repo. Enabled skills are
prepended to composer runs as context — **a skill is text handed to the model,
never anything that gets executed**.

---

## Layout

```
src/
  store/      one zustand store, composed from slices
  lib/        pure logic: layout, board, scheduler, graphRunner, memory, run client
  components/ panes, the composer rail, the graph editor
src-tauri/src/
  run/        the run engine: runner, parse, record, git
  pty.rs      interactive terminals (portable-pty)
  hook.rs     localhost completion-hook server + installer
  memory.rs   the note vault
  skills.rs   the skill library
```

Files written into your project:

```
.layera/tasks/board.md      the task board
.layera/graphs/default.json the agent graph
.layera/memory/**/*.md      project memory
```

Transcripts, session recordings and worktrees live in the app data directory,
not in your repo.

## Tests

```
npm test                                        # 77 frontend tests
cargo test --manifest-path src-tauri/Cargo.toml # 40 Rust tests
```

The ones that matter most: the board parser round-trips (a lossy one would eat
your tasks), the graph runner's fan-out and retry logic runs headlessly against
an injected fake API, the output parsers are asserted against **real captured
CLI output**, and the git layer is tested against real temp repositories.
