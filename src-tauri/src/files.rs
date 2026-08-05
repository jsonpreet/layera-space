use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn fs_read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Sibling temp path for an atomic write.
///
/// `with_extension("tmp")` *replaces* the extension, so `board.json` and
/// `board.md` both collide on `board.tmp`. Appending keeps them distinct.
pub fn temp_sibling(p: &Path) -> std::path::PathBuf {
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "layera".to_string());
    p.with_file_name(format!(".{name}.layera-tmp"))
}

pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = temp_sibling(path);
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn fs_write_text(path: String, content: String) -> Result<(), String> {
    write_atomic(Path::new(&path), &content)
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn fs_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
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

#[derive(Serialize)]
pub struct HeadFile {
    /// Whether the path exists in HEAD at all.
    pub tracked: bool,
    pub in_repo: bool,
    pub content: String,
}

/// HEAD contents *and* whether a committed version actually exists.
///
/// `fs_git_head` returns an empty string both for "not committed" and for "an
/// empty committed file", which let the editor's Reject action overwrite a
/// brand-new untracked file with nothing and destroy it. Callers that intend to
/// revert must check `tracked` first.
#[tauri::command]
pub fn fs_git_head_state(path: String) -> Result<HeadFile, String> {
    let miss = |in_repo: bool| HeadFile {
        tracked: false,
        in_repo,
        content: String::new(),
    };
    let file = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let Some(parent) = file.parent() else {
        return Ok(miss(false));
    };
    let root_output = Command::new("git")
        .args(["-C", parent.to_string_lossy().as_ref(), "rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| e.to_string())?;
    if !root_output.status.success() {
        return Ok(miss(false));
    }
    let root = fs::canonicalize(String::from_utf8_lossy(&root_output.stdout).trim())
        .map_err(|e| e.to_string())?;
    let Ok(relative) = file.strip_prefix(&root) else {
        return Ok(miss(true));
    };
    let spec = format!("HEAD:{}", relative.to_string_lossy().replace('\\', "/"));
    let root_str = root.to_string_lossy();
    let output = Command::new("git")
        .args(["-C", root_str.as_ref(), "show", &spec])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Ok(miss(true));
    }
    Ok(HeadFile {
        tracked: true,
        in_repo: true,
        content: String::from_utf8_lossy(&output.stdout).to_string(),
    })
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

/// Per-workspace storage for workspaces with no project folder on disk.
/// Generalises `kanban_fallback_path` to any file name (boards, graphs, notes).
#[tauri::command]
pub fn workspace_data_path(
    app: AppHandle,
    workspace_id: String,
    name: String,
) -> Result<String, String> {
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("invalid name".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("workspaces")
        .join(&workspace_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name).to_string_lossy().to_string())
}
