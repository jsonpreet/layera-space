use crate::pty::{PtyManager, Recorder};
use serde::Serialize;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

fn sessions_dir(app: &AppHandle, workspace_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("sessions")
        .join(workspace_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[tauri::command]
pub fn session_begin(
    app: AppHandle,
    state: State<'_, PtyManager>,
    id: String,
    workspace_id: String,
    title: String,
    rows: u16,
    cols: u16,
) -> Result<String, String> {
    let dir = sessions_dir(&app, &workspace_id)?;
    let path = dir.join(format!("{}-{}.cast", now_ms(), id));
    let file = File::create(&path).map_err(|e| e.to_string())?;
    let mut w = BufWriter::new(file);
    let header = serde_json::json!({
        "version": 2,
        "encoding": "base64",
        "width": cols,
        "height": rows,
        "timestamp": now_ms() / 1000,
        "title": title,
        "pane": id,
    });
    writeln!(w, "{}", header).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())?;

    let recorder = state
        .recorder_for(&id)
        .ok_or_else(|| "pty not found".to_string())?;
    *recorder.lock().unwrap() = Some(Recorder {
        file: w,
        start: Instant::now(),
    });

    Ok(path.to_string_lossy().to_string())
}

fn read_header(path: &std::path::Path) -> Option<serde_json::Value> {
    use std::io::{BufRead, BufReader};
    let file = File::open(path).ok()?;
    let mut line = String::new();
    BufReader::new(file).read_line(&mut line).ok()?;
    serde_json::from_str(line.trim()).ok()
}

#[derive(Serialize)]
pub struct SessionMeta {
    pub path: String,
    pub title: String,
    pub started_at: u64,
    pub size: u64,
}

#[tauri::command]
pub fn list_sessions(app: AppHandle, workspace_id: String) -> Result<Vec<SessionMeta>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("sessions")
        .join(&workspace_id);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(vec![]),
    };
    let mut out = vec![];
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("cast") {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let mut title = String::from("session");
        let mut started_at: u64 = 0;
        // Only the header line is needed. Reading whole casts here made opening
        // the history menu cost the full size of every recording on disk.
        if let Some(v) = read_header(&path) {
            if let Some(t) = v.get("title").and_then(|x| x.as_str()) {
                title = t.to_string();
            }
            started_at = v.get("timestamp").and_then(|x| x.as_u64()).unwrap_or(0);
        }
        out.push(SessionMeta {
            path: path.to_string_lossy().to_string(),
            title,
            started_at,
            size,
        });
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.started_at));
    Ok(out)
}

#[tauri::command]
pub fn read_session(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 24 * 1024 * 1024 {
        return Err("session too large to replay".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}
