# Status

Where the build actually stands, what is proven, and what is not.
Last updated at the end of the Phase 2-6 implementation pass.

## Gate

```
npm run check
```
tsc + 77 vitest + cargo check + clippy (-D warnings) + 41 Rust tests. **Green.**

- 77 frontend tests: layout tree (19), board round-trip (12), scheduler and
  graph runner (29), memory selection and handoffs (17)
- 32 Rust unit tests: output parsers against real captured CLI output, runner
  argv/flags, frontmatter, wiki-link extraction
- 9 Rust integration tests: git snapshots and worktrees against real temp repos

## Built and working

| Area | State |
|---|---|
| Run engine | Headless claude / codex / opencode / shell, batched event stream, transcripts, runner fallback, cancellation by process group, 10-min timeout |
| Diff capture | Temp-index git tree snapshots; proven by test not to touch HEAD, the index or the working tree |
| Composer rail | Chat / Plan / Build sharing a thread, runner picker, live log, cancel, explicit flag display, ⌘J |
| Board | `.layera/tasks/board.md`, migrates the old JSON board to `.bak`, run/pane link chips |
| Diff review | Per-file and whole-run revert against the pre-run tree |
| Agent graph | React Flow editor, topological scheduler, parallel builders in git worktrees, verifier with retry, wave preset |
| Memory | `.layera/memory/**`, wiki-link index, force-directed graph, deterministic context injection, mechanical handoff notes |
| Skills | Library with file / URL / git import, three bundled skills seeded on first run |
| Packaging | dmg + nsis targets, metadata, resources, production CSP |

Verified live: the app launches, all pane kinds open and persist, the store
migrates v1 → v2, bundled skills seed correctly, no panics in the log.

## Known issues

### 1. Runner path selection has no UI — **this is the active blocker for codex**

`settings.runnerPaths` exists end-to-end in the store and the run engine, and
`detect_runners` returns each CLI's path *and version*, but nothing surfaces it.
A half-written `Runners` section for `SettingsPopover.tsx` was the next task.

This matters concretely on this machine:

- `codex` on PATH is **0.132.0** (Homebrew).
- `~/.codex/config.toml` line 3 has `model_reasoning_effort = "max"`.
- 0.132.0 rejects `max` and **refuses to load the config at all**, so codex dies
  instantly with `Error loading config.toml: unknown variant \`max\``.
- The ChatGPT desktop app bundles **0.147.0-alpha** at
  `/Applications/ChatGPT.app/Contents/Resources/codex`, which runs that same
  config fine (verified: returns `agent_message` and `turn.completed`).

Three ways out, in order of preference:

1. Build the Runners settings UI and point codex at the bundled 0.147 binary.
2. `brew upgrade codex` so PATH has a version that understands `max`.
3. Change line 3 of `~/.codex/config.toml` to `"xhigh"` — but the desktop app
   put `max` there deliberately, so this trades one tool's config for another's.

Not done automatically: silently injecting `-c model_reasoning_effort=xhigh`
would override a deliberate setting without saying so, and it does not fully
work anyway (the models cache carries `max` too).

### 2. opencode is slower than the default expectations

`opencode run` took over three minutes on the first invocation in a cold
directory, then seconds afterwards. It works and parses correctly (there is a
test against its real output), but the 10-minute run timeout is the only guard.
Worth a visible "no output for N seconds" hint in the rail.

### 3. Unverified end-to-end

These are built and unit-tested but have **not** been exercised through the GUI:

- A full graph run with real parallel builders in worktrees.
- The verifier retry loop against a real failing check.
- Aggregator comparison of competing builder branches — the scheduler produces
  the branches and diffs, but there is no aggregator comparison panel yet; the
  aggregator node currently runs as an ordinary summarising node.
- `npm run build:mac` / `build:win` have never been run, so no installer exists
  and the production CSP has not been exercised against Monaco and React Flow.
  This is the highest-value next check — see `docs/SMOKE.md`.

### 4. Smaller gaps

- No devtools pane (planned as a verification harness; the rail covered it).
- Self-hosted fonts were dropped at the user's request; the app uses system
  stacks. `plan.md` line 32 still asks for distinctive type.
- The graph is one-per-workspace (`default.json`); no multi-graph picker.
- `git_apply --3way` conflicts surface as an error string with no resolution UI.
- Memory injection has no per-run override in the composer; it uses the enabled
  directories and the character budget silently.
- Skills are global, not per-workspace.

## Fixed during this pass

Bugs found and fixed that predated it:

- **Browser pane never worked** — `create_webview` is gated behind Tauri's
  `unstable` feature, which was not enabled. Every `new Webview()` was rejecting
  into a swallowed `console.error`.
- **Everything rendered twice** — `React.StrictMode` runs effects twice in dev,
  and `init()` guarded on `ready`, which is only set *after* awaiting. Both
  passes registered a `pty://output` listener, so every chunk was written to the
  terminal twice. Now guarded by a synchronous module flag.
- **Editor Reject destroyed new files** — it wrote `fs_git_head`'s result over
  the file, and that result is `""` for anything untracked.
- **PTY handles leaked** — only `pty_kill` removed them, so every naturally
  exited terminal kept its writer, master and child forever.
- **Agent detection could mis-map paths** — `command -v` prints nothing for a
  missing binary, so results were shifted onto the wrong names.
- **Hook install was falsely idempotent** — it keyed on the substring `layera`,
  which any unrelated path in the user's config could satisfy.
- **Cast recordings had the wrong geometry** — recording started before the
  terminal had fitted, stamping every header 80×24.
- **Popovers were invisible over a browser pane** — native child webviews paint
  above the React tree.
- `fs_write_text`'s temp path replaced the file extension rather than appending.
- `list_sessions` read every cast file in full just to get its header.
- Nothing killed headless runs or PTYs when the app quit.
