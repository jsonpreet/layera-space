# Smoke checklist

Manual passes that automated tests can't cover in a GUI app. Append-only — run
the whole list before shipping, never reset it.

Start with `npm run check` (tsc + vitest + cargo check + clippy + cargo test).
Everything below assumes the app is running via `npm run tauri dev`.

## Foundations

- [ ] Browser pane loads `localhost:<your dev server>` and renders a live page.
      (This is gated behind the Tauri `unstable` feature — if it silently shows
      nothing, that feature has been dropped from `Cargo.toml`.)
- [ ] With a browser pane open, open the workspace context menu and the Launch
      menu. Both must be **visible above** the pane, not hidden behind it.
- [ ] Open a shell pane, resize the window, then replay it from History. The
      replay's geometry matches the pane, not a default 80×24.
- [ ] Close a pane; its process is gone from `ps`.
- [ ] Quit the app mid-run:
      `ps aux | grep -E "claude|codex|opencode|layera-space" | grep -v grep`
      must be empty.

## Editor

- [ ] Create a **new, uncommitted** file, edit it, press Diff, then Reject. It
      must offer to delete the file — never silently empty it.
- [ ] Reject on a tracked file restores the committed version.

## Composer rail

- [ ] ⌘J toggles the rail. It stays open across a workspace switch, and the
      thread survives.
- [ ] Chat: ask a question. Tokens stream in; the log expands and follows.
- [ ] The flag line under the composer matches the mode: read-only in Chat and
      Plan, `acceptEdits` / `workspace-write` only in Build with the toggle on.
- [ ] Stop cancels a run mid-flight; the message settles as `cancelled`, not an
      error, and any partial edits are still captured.
- [ ] Pick a runner that isn't installed. The reply is labelled as having
      fallen back, naming both runners.
- [ ] Plan mode produces a step list; "Send to board" adds those steps as cards.

## Board

- [ ] `.layera/tasks/board.md` is readable and editable in any text editor.
- [ ] Edit the file outside the app, reopen the pane, and the change is there.
- [ ] A pre-existing `board.json` is converted once, and left as `board.json.bak`.

## Run review

- [ ] A Build run that changes files shows a "N files changed" row; clicking it
      opens the diff pane.
- [ ] The diff's left side is the file **before the run**, not HEAD. Verify by
      leaving an unrelated edit uncommitted before running — it must not appear
      in the run's diff.
- [ ] Revert one file, keep another. `git status` afterwards shows exactly what
      you expect.
- [ ] "Revert all" undoes the whole run.

## Graph

- [ ] Add nodes, wire them, drag them; reopen the pane and the layout persisted.
- [ ] Connecting a node back to its own ancestor is refused with a message.
- [ ] Run the wave preset in a git repo with **uncommitted changes**. Each
      builder's worktree contains those changes; the main working tree is
      untouched throughout.
- [ ] Node borders track state: running, done, failed.
- [ ] Make the verifier fail (`false` as its check command) with maxRetries 1 —
      the builders re-run exactly once, then the graph reports failure.
- [ ] Stop a running graph. No orphan processes; `git worktree list` shows only
      what you expect.
- [ ] Try a wave in a folder that is not a git repo: it must refuse with an
      explanation, not run builders on top of each other.

## Memory and skills

- [ ] Opening the Memory pane creates `.layera/memory/` with its five folders.
- [ ] Create two notes and link one to the other with `[[name]]`; the Links view
      draws the connection.
- [ ] Mention a note with `@name` in the composer — that note and its neighbours
      are the ones injected.
- [ ] A graph node that changes files leaves a note in `memory/handoffs/`.
- [ ] The three bundled skills appear on first launch. Enabling one changes what
      the next run is given.
- [ ] Delete a bundled skill; it does not come back on the next launch.

## Alerts and hooks

- [ ] A run finishing while the window is unfocused plays a sound and posts a
      notification; one finishing while you are watching it does neither.
- [ ] Settings shows hook install state. Uninstall removes only Layera's own
      entries from `~/.claude/settings.json` and `~/.codex/config.toml`.
- [ ] Re-running the install is idempotent — no duplicate entries.

## Packaging

- [ ] `npm run build:mac` produces a `.dmg` that installs and launches.
- [ ] The production build (with its stricter CSP) still renders the editor,
      the diff view and the graph — those need workers and inline styles.
