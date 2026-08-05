use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn fs_read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_text(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, p).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", ".git", "build", ".next"];

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let mut out = vec![];
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        out.push(FsEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
pub fn fs_git_head(path: String) -> Result<String, String> {
    let file = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let parent = file
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?;
    let parent_str = parent.to_string_lossy();
    let root_output = Command::new("git")
        .args(["-C", parent_str.as_ref(), "rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| e.to_string())?;
    if !root_output.status.success() {
        return Ok(String::new());
    }

    let root = fs::canonicalize(
        String::from_utf8_lossy(&root_output.stdout)
            .trim(),
    )
    .map_err(|e| e.to_string())?;
    let relative = match file.strip_prefix(&root) {
        Ok(path) => path.to_string_lossy().replace('\\', "/"),
        Err(_) => return Ok(String::new()),
    };
    let root_str = root.to_string_lossy();
    let spec = format!("HEAD:{relative}");
    let output = Command::new("git")
        .args(["-C", root_str.as_ref(), "show", &spec])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Ok(String::new());
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kanban_fallback_path(app: AppHandle, workspace_id: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("kanban");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{workspace_id}.json")).to_string_lossy().to_string())
}
