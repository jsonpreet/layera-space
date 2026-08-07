use super::git::FileChange;
use super::runner::{RunMode, Runner};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Running,
    Ok,
    Error,
    Cancelled,
    Timeout,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub run_id: String,
    pub workspace_id: String,
    pub runner: Runner,
    pub requested_runner: Runner,
    #[serde(default)]
    pub runner_version: Option<String>,
    pub mode: RunMode,
    #[serde(default)]
    pub label: Option<String>,
    pub prompt_preview: String,
    pub cwd: String,
    pub dir: String,
    pub transcript_path: String,
    pub status: RunStatus,
    #[serde(default)]
    pub exit_code: Option<i32>,
    pub started_at: u64,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub base_tree: Option<String>,
    #[serde(default)]
    pub after_tree: Option<String>,
    #[serde(default)]
    pub repo_root: Option<String>,
    #[serde(default)]
    pub files_changed: Vec<FileChange>,
    #[serde(default)]
    pub parser_degraded: bool,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub graph_run_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub worktree: Option<String>,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn runs_root(app: &AppHandle, workspace_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runs")
        .join(workspace_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn run_dir(app: &AppHandle, workspace_id: &str, run_id: &str) -> Result<PathBuf, String> {
    let dir = runs_root(app, workspace_id)?.join(run_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Append-only index. One line when a run starts, one when it ends; readers
/// keep the last entry per id. Crash-safe with no locking.
pub fn append_index(app: &AppHandle, record: &RunRecord) -> Result<(), String> {
    let path = runs_root(app, &record.workspace_id)?.join("index.jsonl");
    let line = serde_json::to_string(record).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

pub fn write_meta(dir: &Path, record: &RunRecord) -> Result<(), String> {
    let json = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    crate::files::write_atomic(&dir.join("meta.json"), &json)
}

pub fn read_index(app: &AppHandle, workspace_id: &str) -> Vec<RunRecord> {
    let Ok(path) = runs_root(app, workspace_id).map(|d| d.join("index.jsonl")) else {
        return vec![];
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return vec![];
    };
    let mut by_id: std::collections::HashMap<String, RunRecord> = std::collections::HashMap::new();
    let mut order: Vec<String> = vec![];
    for line in text.lines() {
        if let Ok(rec) = serde_json::from_str::<RunRecord>(line) {
            if !by_id.contains_key(&rec.run_id) {
                order.push(rec.run_id.clone());
            }
            by_id.insert(rec.run_id.clone(), rec);
        }
    }
    let mut out: Vec<RunRecord> = order.into_iter().filter_map(|id| by_id.remove(&id)).collect();
    out.sort_by_key(|r| std::cmp::Reverse(r.started_at));
    out
}

/// A run left `running` on disk with no live process behind it was interrupted
/// by a crash or a quit; report it honestly rather than as still going.
pub fn reconcile_orphans(app: &AppHandle, workspace_id: &str, live: &[String]) {
    let records = read_index(app, workspace_id);
    for mut rec in records {
        if rec.status == RunStatus::Running && !live.contains(&rec.run_id) {
            rec.status = RunStatus::Cancelled;
            rec.summary = Some("Interrupted — the app closed while this run was going".into());
            let _ = append_index(app, &rec);
            if let Ok(dir) = run_dir(app, workspace_id, &rec.run_id) {
                let _ = write_meta(&dir, &rec);
            }
        }
    }
}

const KEEP_RUNS: usize = 200;
const KEEP_BYTES: u64 = 500 * 1024 * 1024;

fn dir_size(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .flatten()
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

/// Trim old runs so the transcript store cannot grow without bound.
#[tauri::command]
pub fn runs_gc(app: AppHandle, workspace_id: String) -> Result<usize, String> {
    let root = runs_root(&app, &workspace_id)?;
    let records = read_index(&app, &workspace_id);

    let mut keep: Vec<&RunRecord> = vec![];
    let mut total = 0u64;
    for rec in &records {
        if keep.len() >= KEEP_RUNS || total > KEEP_BYTES {
            break;
        }
        total += dir_size(&root.join(&rec.run_id));
        keep.push(rec);
    }

    let keep_ids: std::collections::HashSet<&str> =
        keep.iter().map(|r| r.run_id.as_str()).collect();
    let mut removed = 0;
    for entry in fs::read_dir(&root).into_iter().flatten().flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !keep_ids.contains(name.as_str()) {
            let _ = fs::remove_dir_all(entry.path());
            removed += 1;
        }
    }

    // Rewrite the index compacted so it doesn't grow forever either.
    let kept: Vec<String> = keep
        .iter()
        .filter_map(|r| serde_json::to_string(r).ok())
        .collect();
    let _ = crate::files::write_atomic(&root.join("index.jsonl"), &(kept.join("\n") + "\n"));
    Ok(removed)
}

#[tauri::command]
pub fn run_list(app: AppHandle, workspace_id: String) -> Result<Vec<RunRecord>, String> {
    Ok(read_index(&app, &workspace_id))
}

#[tauri::command]
pub fn run_read_transcript(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 24 * 1024 * 1024 {
        return Err("transcript too large to open here".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_patch(app: AppHandle, workspace_id: String, run_id: String) -> Result<String, String> {
    let path = run_dir(&app, &workspace_id, &run_id)?.join("patch.diff");
    Ok(fs::read_to_string(path).unwrap_or_default())
}
