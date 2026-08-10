# Layera Space — Full Plan

## Progress
- [x] Phase 1 — Core workspace app (M0-M5): scaffold, PTY core, workspaces (colors/titles/pins/folders/persistence), grid + zoom + agent launcher, completion detection (Claude Stop hook + bell + idle fallback; Codex skipped where user already has a notify), sounds + native notifications
- [x] Phase 2 — Session capture + dev surface (capture, replay, restore, run history, dock mode, browser preview, editor; headless transcripts, Markdown board with run/pane links, run-aware proposal review)
- [x] Phase 3 — Run engine + composer rail
- [x] Phase 4 — Visual Agent Graph, waves, verifier
- [x] Phase 5 — Memory + skills
- [x] Phase 6 — Packaging config (bundle targets, metadata, CSP, README) — **installer not yet produced/verified**

See `STATUS.md` for what is built, what is unverified, and what is still open.

---

**A local-first ADE (Agent Development Environment): multi-workspace terminal grid for opencode/Claude/Codex, plus a headless run engine powering chat, plans, a visual agent graph with parallel builders and a verifier loop, project memory, skills, kanban, replay, browser preview and a Monaco editor. macOS + Windows, Tauri v2 + React + TS.**

## Decisions (locked)
- **Framework**: Tauri v2 + React + TypeScript (Vite)
- **Agent layout**: Grid + zoom (both)
- **Completion detection**: Hooks + idle fallback
- **Chat model access**: via installed CLIs (claude -p, codex exec, opencode run) — no API keys in app
- **Skills marketplace**: local-first library (bundled + import from file/URL/git)
- **Phase order**: as phased below (each phase ships a usable app)
- **App name**: Layera Space

## Stack
- Tauri v2 (Rust) · React 18 + TS + Vite · Tailwind v4 · Zustand
- **portable-pty** (wezterm crate) + **xterm.js** (`@xterm/xterm`, fit/webgl addons) for interactive panes and the terminal dock
- **React Flow** for the visual agent graph editor
- **Monaco** (`@monaco-editor/react`) for editor + diffs
- Tauri core Webview API for browser preview panes
- **tauri-plugin-notification** + Web Audio for completion alerts
- Session logs in **asciinema cast v2 format** (replay for free)
- Self-hosted distinctive fonts (no default Google rotation)

## Core architecture: the Run Engine
Everything new (chat, build, graph, waves, verifier) sits on one abstraction — headless execution of the installed CLIs:

```
Runner abstraction
  claude   → claude -p "<prompt>" --output-format stream-json
  codex    → codex exec "<prompt>" --json
  opencode → opencode run "<prompt>"
  shell    → arbitrary command

RunEngine (Rust)
  spawn_run(runner, prompt, cwd, context_injection)
  → streams structured events → UI (rail/graph logs)
  → records transcript + files changed (git diff before/after)
  → exit status, duration
Auto-fallback: if chosen runner missing, try next installed runner
```

This same engine powers: Chat rail, Build mode, graph nodes, parallel waves, verifier checks.

## Data model
```
Workspace:  id, title, color, pinned, folder, layout, panes[], graphId
Pane:       id, kind: agent|shell|browser|editor|kanban|replay, agent?, title
Graph:      id, nodes[{id,type,runner,promptTemplate,config}], edges[]
GraphRun:   id, graphId, nodeRuns[{nodeId,runId,status,retries}]
Run:        id, runner, mode: interactive|headless, prompt, transcriptPath,
            castPath?, filesChanged[], status, startedAt, durationMs
MemoryNote: path, links[] (derived from [[wiki-links]])
Skill:      id, name, source: bundled|local|url, content
Settings:   sounds, notifications, idleThreshold, hooksInstalled, runnerPaths
```

Persisted as JSON in the app data dir (debounced saves); memory/tasks as plain Markdown inside the project folder under `.layera/`.

---

## Phase 1 — Core workspace app
1. **Scaffold**: Tauri v2 + Vite + React + Tailwind, window chrome, app icon, name "Layera Space"
2. **PTY core**: Rust pty manager (portable-pty: spawn/resize/write/kill) + xterm panes, plain shells working with resize
3. **Workspaces**: sidebar, create/rename/delete, color picker (palette + custom hex), titles, pinning (pinned group floats top), project folder per workspace (folder picker; agents spawn with that cwd), JSON persistence
4. **Grid + zoom + agent launcher**: resizable splits (horizontal/vertical), pane zoom (maximize/restore), detect `claude`/`codex`/`opencode` on PATH + common locations (`~/.local/bin`, npm/brew prefixes), one-click spawn with `LAYERA_PANE_ID` + `LAYERA_HOOK_URL` env, not-installed states show exact install command, plain shell panes per OS (zsh/pwsh/cmd)
5. **Completion detection**: localhost HTTP hook server on random port at startup
   - Claude Code: idempotently installs a `Stop` hook into `~/.claude/settings.json` that POSTs to the hook server (env-routed to the right pane)
   - Codex: installs `notify` entry in `~/.codex/config.toml` (fires on `agent-turn-complete`)
   - opencode: bell capture (xterm `onBell`) + idle fallback; plugin hook as follow-up
   - Generic fallback: output-idle detector (activity burst → N seconds silence → "likely done"), debounce + cooldown
   - Per-pane status LEDs
6. **Alerts**: bundled completion sounds (selectable, mutable per global + per-workspace), native notifications carrying workspace color/title + agent name, click notification → focus app + switch to workspace/pane

## Phase 2 — Session capture + dev surface
7. **Session recording**
   - [x] Every PTY pane records cast-v2 logs.
   - [x] Run history list per workspace.
   - [ ] Headless runs record transcripts (requires the Phase 3 Run Engine).
8. **Session replay**: xterm-based player, timeline scrubber, speed control, replay any past run [x]
9. **Terminal dock polish**: layout modes (grid / dock-at-bottom) [x]
10. **Kanban task board**
   - [x] Per-workspace Todo / Doing / Done board with custom columns.
   - [ ] Cards link to runs/panes.
   - [ ] Stored as plain Markdown under `.layera/tasks/` (current implementation uses JSON).
11. **Browser preview pane**: multiwebview pane with URL bar + reload, aimed at `localhost:*` dev servers [x]
12. **Monaco editor**: file tree of workspace folder, open/edit/save, HEAD diff, and Accept/Reject actions [x]; per-run file changes remain with the run engine

## Phase 3 — Run engine + composer rail
13. **Run engine** (per architecture above): headless runners, streaming events, fallback, transcripts, file-change capture
14. **Chat / Build / Plan rail** (right rail, one composer, mode switch keeps thread):
    - **Chat**: Q&A via selected runner (streaming), runner picker
    - **Plan**: step-by-step plan generation → save to memory/tasks or push to kanban
    - **Build**: simple mode (one runner implements the task headlessly, live log in rail) or graph mode (hands prompt to the graph)

## Phase 4 — Visual Agent Graph, waves, verifier
15. **Graph editor** (React Flow): node types = Planner, Coordinator, Builder, Aggregator, Verifier, Prompt, Shell; drag/wire; per-node runner + prompt template; graph saved per workspace as JSON
16. **Graph scheduler**: topological execution, parallel branches, per-node status + logs, run history replayable per node
17. **Parallel builder waves**: coordinator fans one task out to N builders (default 3) across installed runners simultaneously; builders isolated via git worktrees/branches; aggregator node merges/compares outputs (diff view)
18. **Verifier + auto-retry**: verifier node checks result (tests/lint/prompt-based review), on FAIL loops feedback to builders up to max retries, on PASS marks run complete; notification + sound on final result

## Phase 5 — Memory + skills
19. **Memory vault**: `.layera/memory/{context,tasks,handoffs,decisions,bugs}/*.md` per project; markdown editor UI; auto-injection of relevant context into headless runs (configurable); agent-to-agent handoff notes
20. **Memory graph**: `[[wiki-link]]` extraction → force-directed visualization, click-to-open note
21. **Skills marketplace (local-first)**: skill = markdown instruction file with frontmatter; bundled curated set + import from file/URL/git repo; skills attach to graph nodes or the composer; library in app data dir (hosted index later as static JSON, no server)

## Phase 6 — Packaging
22. macOS `.dmg` (arm64 + x64), Windows NSIS installer, icons, metadata; auto-updater wiring optional

---

## Risks / notes
- Headless CLI flags (`claude -p`, `codex exec`, `opencode run`) change across versions → pin detection + graceful degradation
- Parallel builders editing one repo → isolate via git worktrees/branches per builder, merge in aggregator (prevents clobbering)
- Hook installs touch `~/.claude` / `~/.codex` configs: idempotent, reversible, disclosed in settings
- Tauri PTY plumbing (portable-pty + event channel) is the main early technical risk → validated in Phase 1 step 2
- Windows needs WebView2 (bundled by installer); macOS signing/notarization deferred (local dev builds first)
- This is a large product; phases are the sequencing — each phase ships a usable app
