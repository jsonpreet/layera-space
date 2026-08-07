pub mod git;
pub mod parse;
pub mod record;
pub mod runner;

use parse::{is_degraded, parser_for, EventKind, RunEvent};
use record::{
    append_index, now_ms, run_dir, write_meta, RunRecord, RunStatus,
};
use runner::{build_argv, resolve, BuildArgs, ReadMode, RunMode, Runner, RunnerFormat};
use serde::{Deserialize, Serialize};
use shared_child::SharedChild;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContextBlock {
    pub label: String,
    pub content: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunSpec {
    pub run_id: String,
    pub workspace_id: String,
    pub runner: Runner,
    pub prompt: String,
    pub cwd: String,
    pub mode: RunMode,
    #[serde(default)]
    pub write: Option<bool>,
    #[serde(default = "default_true")]
    pub allow_fallback: bool,
    #[serde(default)]
    pub context: Vec<ContextBlock>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub graph_run_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default = "default_true")]
    pub capture_diff: bool,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub runner_paths: HashMap<String, String>,
    #[serde(default)]
    pub plain: bool,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub worktree: Option<String>,
}

fn default_true() -> bool {
    true
}

const DEFAULT_TIMEOUT_MS: u64 = 10 * 60 * 1000;
/// A single tool result can carry a whole file; cap what one line may cost.
const MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpawnPayload {
    run_id: String,
    runner: Runner,
    requested_runner: Runner,
    fell_back: bool,
    program: String,
    args: Vec<String>,
    cwd: String,
    started_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EventsPayload {
    run_id: String,
    events: Vec<RunEvent>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitPayload {
    run_id: String,
    record: RunRecord,
}

struct Live {
    child: Arc<SharedChild>,
    cancelled: Arc<AtomicBool>,
    workspace_id: String,
}

#[derive(Default)]
pub struct RunManager {
    live: Mutex<HashMap<String, Live>>,
}

impl RunManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn live_ids(&self) -> Vec<String> {
        self.live
            .lock()
            .map(|l| l.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Terminate a run's whole process group and wait briefly for it to die.
    fn stop(&self, run_id: &str) -> bool {
        let Some(live) = self.live.lock().ok().and_then(|mut l| l.remove(run_id)) else {
            return false;
        };
        live.cancelled.store(true, Ordering::SeqCst);
        kill_tree(&live.child);
        true
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = self.live_ids();
        for id in ids {
            self.stop(&id);
        }
    }
}

/// Kill the process *group*, not just the child: the CLIs spawn helpers of
/// their own, and killing only the parent leaves those orphaned.
fn kill_tree(child: &Arc<SharedChild>) {
    #[cfg(unix)]
    {
        let pid = child.id() as i32;
        unsafe {
            libc_kill(-pid, 15); // SIGTERM to the group
        }
        std::thread::sleep(Duration::from_millis(300));
        if child.try_wait().ok().flatten().is_none() {
            unsafe {
                libc_kill(-pid, 9); // SIGKILL
            }
        }
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .output();
    }
    let _ = child.kill();
}

#[cfg(unix)]
extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

/// Compose the prompt actually sent, with any injected context ahead of it.
fn render_prompt(spec: &RunSpec) -> String {
    if spec.context.is_empty() {
        return spec.prompt.clone();
    }
    let mut out = String::new();
    for block in &spec.context {
        out.push_str(&format!(
            "<context source=\"{}\">\n{}\n</context>\n\n",
            block.label.replace('"', "'"),
            block.content
        ));
    }
    out.push_str(&spec.prompt);
    out
}

struct Sink {
    app: AppHandle,
    run_id: String,
    seq: AtomicU64,
    start: Instant,
    transcript: Mutex<std::io::BufWriter<std::fs::File>>,
    pending: Mutex<Vec<RunEvent>>,
    last_flush: Mutex<Instant>,
}

const FLUSH_EVERY: usize = 64;
const FLUSH_MS: u128 = 16;

impl Sink {
    fn push(&self, mut ev: RunEvent, raw: Option<&str>) {
        ev.seq = self.seq.fetch_add(1, Ordering::SeqCst);
        ev.t = self.start.elapsed().as_secs_f64();

        // The transcript keeps the untouched line alongside the parsed event, so
        // a future version can re-parse old runs with a better parser.
        if let Ok(mut w) = self.transcript.lock() {
            let mut line = serde_json::to_value(&ev).unwrap_or_default();
            if let (Some(obj), Some(raw)) = (line.as_object_mut(), raw) {
                obj.insert("raw".into(), serde_json::Value::String(raw.to_string()));
            }
            let _ = writeln!(w, "{line}");
        }

        let mut flush = None;
        if let Ok(mut pending) = self.pending.lock() {
            pending.push(ev);
            let due = self
                .last_flush
                .lock()
                .map(|t| t.elapsed().as_millis() >= FLUSH_MS)
                .unwrap_or(true);
            if pending.len() >= FLUSH_EVERY || due {
                flush = Some(std::mem::take(&mut *pending));
            }
        }
        if let Some(events) = flush {
            self.emit(events);
        }
    }

    fn emit(&self, events: Vec<RunEvent>) {
        if events.is_empty() {
            return;
        }
        if let Ok(mut t) = self.last_flush.lock() {
            *t = Instant::now();
        }
        // Batched: three verbose builders streaming line-by-line would otherwise
        // flood the IPC channel and lock up the webview.
        let _ = self.app.emit(
            "run://events",
            EventsPayload {
                run_id: self.run_id.clone(),
                events,
            },
        );
    }

    fn flush(&self) {
        let events = self
            .pending
            .lock()
            .map(|mut p| std::mem::take(&mut *p))
            .unwrap_or_default();
        self.emit(events);
        if let Ok(mut w) = self.transcript.lock() {
            let _ = w.flush();
        }
    }
}

#[tauri::command]
pub fn run_start(
    app: AppHandle,
    _state: State<'_, RunManager>,
    spec: RunSpec,
) -> Result<RunRecord, String> {
    let dir = run_dir(&app, &spec.workspace_id, &spec.run_id)?;
    let resolved = resolve(spec.runner, spec.allow_fallback, &spec.runner_paths)?;

    let prompt = render_prompt(&spec);
    let _ = std::fs::write(dir.join("prompt.txt"), &prompt);

    let write = spec.write.unwrap_or_else(|| spec.mode.default_write());
    let format = if spec.plain {
        RunnerFormat::Plain
    } else {
        RunnerFormat::Structured
    };
    let cwd = spec.worktree.clone().unwrap_or_else(|| spec.cwd.clone());

    let argv = build_argv(BuildArgs {
        runner: resolved.runner,
        program: resolved.program.clone(),
        prompt: &prompt,
        cwd: &cwd,
        write,
        format,
        run_dir: &dir,
    });

    let started_at = now_ms();
    let transcript_path = dir.join("transcript.jsonl");
    let record = RunRecord {
        run_id: spec.run_id.clone(),
        workspace_id: spec.workspace_id.clone(),
        runner: resolved.runner,
        requested_runner: spec.runner,
        runner_version: crate::agents::runner_version(resolved.runner.binary()),
        mode: spec.mode,
        label: spec.label.clone(),
        prompt_preview: spec.prompt.chars().take(200).collect(),
        cwd: cwd.clone(),
        dir: dir.to_string_lossy().to_string(),
        transcript_path: transcript_path.to_string_lossy().to_string(),
        status: RunStatus::Running,
        exit_code: None,
        started_at,
        duration_ms: 0,
        base_tree: None,
        after_tree: None,
        repo_root: None,
        files_changed: vec![],
        parser_degraded: false,
        summary: None,
        graph_run_id: spec.graph_run_id.clone(),
        node_id: spec.node_id.clone(),
        branch: spec.branch.clone(),
        worktree: spec.worktree.clone(),
    };
    append_index(&app, &record)?;
    write_meta(&dir, &record)?;

    let _ = app.emit(
        "run://spawn",
        SpawnPayload {
            run_id: spec.run_id.clone(),
            runner: resolved.runner,
            requested_runner: spec.runner,
            fell_back: resolved.fell_back,
            program: argv.program.clone(),
            args: argv.args.clone(),
            cwd: cwd.clone(),
            started_at,
        },
    );

    let started = record.clone();
    std::thread::spawn(move || {
        supervise(app, spec, record, argv, dir, cwd, format);
    });
    Ok(started)
}

#[allow(clippy::too_many_arguments)]
fn supervise(
    app: AppHandle,
    spec: RunSpec,
    mut record: RunRecord,
    argv: runner::Argv,
    dir: PathBuf,
    cwd: String,
    format: RunnerFormat,
) {
    let started = Instant::now();

    // ---- git snapshot before ------------------------------------------------
    let repo_root = if spec.capture_diff {
        git::repo_root(&cwd)
    } else {
        None
    };
    if let Some(root) = &repo_root {
        record.repo_root = Some(root.clone());
        match git::snapshot_tree(root, &dir.join("idx.before")) {
            Ok(tree) => record.base_tree = Some(tree),
            Err(_) => record.repo_root = None, // snapshot refused; skip the diff
        }
    }

    // ---- spawn --------------------------------------------------------------
    let mut cmd = std::process::Command::new(&argv.program);
    cmd.args(&argv.args)
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }
    // Own process group, so cancelling reaches the CLI's children too.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let child = match SharedChild::spawn(&mut cmd) {
        Ok(c) => Arc::new(c),
        Err(e) => {
            finish(
                &app,
                &dir,
                record,
                RunStatus::Error,
                None,
                started.elapsed(),
                Some(format!("Could not start {}: {e}", argv.program)),
                false,
            );
            return;
        }
    };

    let cancelled = Arc::new(AtomicBool::new(false));
    if let Some(state) = app.try_state::<RunManager>() {
        if let Ok(mut live) = state.live.lock() {
            live.insert(
                spec.run_id.clone(),
                Live {
                    child: child.clone(),
                    cancelled: cancelled.clone(),
                    workspace_id: spec.workspace_id.clone(),
                },
            );
        }
    }

    let Ok(file) = std::fs::File::create(&record.transcript_path) else {
        finish(
            &app,
            &dir,
            record,
            RunStatus::Error,
            None,
            started.elapsed(),
            Some("Could not open the transcript for writing".into()),
            false,
        );
        return;
    };
    let sink = Arc::new(Sink {
        app: app.clone(),
        run_id: spec.run_id.clone(),
        seq: AtomicU64::new(0),
        start: started,
        transcript: Mutex::new(std::io::BufWriter::new(file)),
        pending: Mutex::new(vec![]),
        last_flush: Mutex::new(Instant::now()),
    });

    if let (Some(text), Some(mut stdin)) = (argv.stdin.as_ref(), child.take_stdin()) {
        let _ = stdin.write_all(text.as_bytes());
        // Dropping closes the pipe, which is what tells the CLI the prompt ended.
    }

    // ---- readers ------------------------------------------------------------
    let parser = Arc::new(Mutex::new(parser_for(
        record.runner,
        matches!(format, RunnerFormat::Structured),
    )));

    let out_handle = child.take_stdout().map(|stdout| {
        let sink = sink.clone();
        let parser = parser.clone();
        let lines = matches!(argv.read_mode, ReadMode::Lines);
        std::thread::spawn(move || {
            if lines {
                read_lines(stdout, |line, truncated| {
                    let mut events = vec![];
                    if let Ok(mut p) = parser.lock() {
                        p.parse(&line, &mut events);
                    }
                    for mut ev in events {
                        ev.truncated = truncated;
                        sink.push(ev, Some(&line));
                    }
                });
            } else {
                read_chunks(stdout, |chunk| {
                    sink.push(RunEvent::new(EventKind::Stdout, Some(chunk)), None);
                });
            }
        })
    });

    let err_handle = child.take_stderr().map(|stderr| {
        let sink = sink.clone();
        std::thread::spawn(move || {
            read_lines(stderr, |line, truncated| {
                let mut ev = RunEvent::new(EventKind::Stderr, Some(line));
                ev.truncated = truncated;
                sink.push(ev, None);
            });
        })
    });

    // ---- wait, with a timeout ----------------------------------------------
    let timeout = Duration::from_millis(spec.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    let timed_out;
    let exit = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                timed_out = false;
                break Some(status);
            }
            Ok(None) => {
                if started.elapsed() > timeout {
                    timed_out = true;
                    kill_tree(&child);
                    break child.wait().ok();
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                timed_out = false;
                break None;
            }
        }
    };

    if let Some(h) = out_handle {
        let _ = h.join();
    }
    if let Some(h) = err_handle {
        let _ = h.join();
    }
    sink.flush();

    if let Some(state) = app.try_state::<RunManager>() {
        if let Ok(mut live) = state.live.lock() {
            live.remove(&spec.run_id);
        }
    }

    // ---- git snapshot after -------------------------------------------------
    if let (Some(root), Some(base)) = (record.repo_root.clone(), record.base_tree.clone()) {
        if let Ok(after) = git::snapshot_tree(&root, &dir.join("idx.after")) {
            if after != base {
                record.files_changed = git::diff_numstat(&root, &base, &after);
                let patch = git::diff_patch(&root, &base, &after);
                let _ = std::fs::write(dir.join("patch.diff"), patch);
            }
            record.after_tree = Some(after);
        }
    }

    // ---- outcome ------------------------------------------------------------
    let (ok, fallback) = parser.lock().map(|p| p.health()).unwrap_or((0, 0));
    let degraded = is_degraded(ok, fallback);
    if degraded {
        sink.push(
            RunEvent::new(
                EventKind::Error,
                Some(format!(
                    "{} produced output this version does not recognise — showing it raw. Its CLI may have changed.",
                    record.runner.label()
                )),
            ),
            None,
        );
        sink.flush();
    }

    let summary = std::fs::read_to_string(dir.join("last-message.txt"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| parser.lock().ok().and_then(|p| p.final_text()));

    let code = exit.as_ref().and_then(|s| s.code());
    let status = if cancelled.load(Ordering::SeqCst) {
        RunStatus::Cancelled
    } else if timed_out {
        RunStatus::Timeout
    } else if code == Some(0) {
        RunStatus::Ok
    } else {
        RunStatus::Error
    };

    finish(
        &app,
        &dir,
        record,
        status,
        code,
        started.elapsed(),
        summary,
        degraded,
    );
}

#[allow(clippy::too_many_arguments)]
fn finish(
    app: &AppHandle,
    dir: &std::path::Path,
    mut record: RunRecord,
    status: RunStatus,
    exit_code: Option<i32>,
    elapsed: Duration,
    summary: Option<String>,
    degraded: bool,
) {
    record.status = status;
    record.exit_code = exit_code;
    record.duration_ms = elapsed.as_millis() as u64;
    record.summary = summary;
    record.parser_degraded = degraded;
    let _ = write_meta(dir, &record);
    let _ = append_index(app, &record);
    let _ = app.emit(
        "run://exit",
        ExitPayload {
            run_id: record.run_id.clone(),
            record,
        },
    );
}

fn read_lines<R: Read + Send + 'static>(reader: R, mut on_line: impl FnMut(String, bool)) {
    let mut buf = BufReader::new(reader);
    loop {
        let mut bytes: Vec<u8> = Vec::new();
        match buf.read_until(b'\n', &mut bytes) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        while bytes.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
            bytes.pop();
        }
        let truncated = bytes.len() > MAX_LINE_BYTES;
        if truncated {
            bytes.truncate(MAX_LINE_BYTES);
        }
        on_line(String::from_utf8_lossy(&bytes).to_string(), truncated);
    }
}

fn read_chunks<R: Read + Send + 'static>(mut reader: R, mut on_chunk: impl FnMut(String)) {
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => on_chunk(String::from_utf8_lossy(&buf[..n]).to_string()),
        }
    }
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn run_cancel(state: State<'_, RunManager>, run_id: String) -> Result<bool, String> {
    Ok(state.stop(&run_id))
}

#[tauri::command]
pub fn run_cancel_all(state: State<'_, RunManager>, workspace_id: Option<String>) -> usize {
    let ids: Vec<String> = state
        .live
        .lock()
        .map(|l| {
            l.iter()
                .filter(|(_, v)| {
                    workspace_id
                        .as_ref()
                        .is_none_or(|w| &v.workspace_id == w)
                })
                .map(|(k, _)| k.clone())
                .collect()
        })
        .unwrap_or_default();
    let mut n = 0;
    for id in ids {
        if state.stop(&id) {
            n += 1;
        }
    }
    n
}

#[tauri::command]
pub fn run_live(state: State<'_, RunManager>) -> Vec<String> {
    state.live_ids()
}

/// Called at startup: mark runs the app never got to finish.
#[tauri::command]
pub fn runs_reconcile(
    app: AppHandle,
    state: State<'_, RunManager>,
    workspace_id: String,
) -> Result<(), String> {
    record::reconcile_orphans(&app, &workspace_id, &state.live_ids());
    Ok(())
}
