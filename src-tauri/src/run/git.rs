use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

fn git(args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Run git with a private index file so the user's own staging area is never
/// touched by anything the run engine does.
fn git_with_index(index: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .env("GIT_INDEX_FILE", index)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn repo_root(dir: &str) -> Option<String> {
    git(&["-C", dir, "rev-parse", "--show-toplevel"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Refuse to snapshot a repo with a huge untracked surface — a stray
/// node_modules outside .gitignore would otherwise stall every run on `add -A`.
const MAX_UNTRACKED: usize = 5000;

fn too_dirty(root: &str) -> bool {
    git(&["-C", root, "status", "--porcelain", "--untracked-files=normal"])
        .map(|s| s.lines().count() > MAX_UNTRACKED)
        .unwrap_or(false)
}

/// Write a tree object capturing the working directory exactly as it is now,
/// including untracked files and respecting .gitignore.
///
/// Deliberately not `git status` diffing, which cannot see content changes to
/// files that were already dirty before the run started.
pub fn snapshot_tree(root: &str, index_path: &Path) -> Result<String, String> {
    if too_dirty(root) {
        return Err("too many untracked files to snapshot".to_string());
    }
    let _ = std::fs::remove_file(index_path);
    git_with_index(index_path, &["-C", root, "read-tree", "HEAD"])
        // An unborn HEAD (a fresh repo with no commits) has nothing to read.
        .or_else(|_| git_with_index(index_path, &["-C", root, "read-tree", "--empty"]))?;
    git_with_index(index_path, &["-C", root, "add", "-A"])?;
    let tree = git_with_index(index_path, &["-C", root, "write-tree"])?;
    let _ = std::fs::remove_file(index_path);
    Ok(tree.trim().to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// A / M / D / R
    pub status: String,
    pub added: u32,
    pub deleted: u32,
}

pub fn diff_numstat(root: &str, base: &str, after: &str) -> Vec<FileChange> {
    let mut changes: Vec<FileChange> = vec![];

    let name_status = git(&["-C", root, "diff", "--name-status", base, after]).unwrap_or_default();
    for line in name_status.lines() {
        let mut parts = line.split('\t');
        let Some(status) = parts.next() else { continue };
        // Renames carry both the old and new path; the new one is what matters.
        let path = parts.next_back().unwrap_or_default();
        if path.is_empty() {
            continue;
        }
        changes.push(FileChange {
            path: path.to_string(),
            status: status.chars().next().unwrap_or('M').to_string(),
            added: 0,
            deleted: 0,
        });
    }

    let numstat = git(&["-C", root, "diff", "--numstat", base, after]).unwrap_or_default();
    for line in numstat.lines() {
        let mut parts = line.split('\t');
        let added = parts.next().unwrap_or("0");
        let deleted = parts.next().unwrap_or("0");
        let path = parts.next_back().unwrap_or_default();
        if let Some(c) = changes.iter_mut().find(|c| c.path == path) {
            // Binary files report "-" rather than a count.
            c.added = added.parse().unwrap_or(0);
            c.deleted = deleted.parse().unwrap_or(0);
        }
    }
    changes
}

pub fn diff_patch(root: &str, base: &str, after: &str) -> String {
    git(&["-C", root, "diff", base, after]).unwrap_or_default()
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn git_root(dir: String) -> Option<String> {
    repo_root(&dir)
}

#[tauri::command]
pub fn git_show(root: String, rev: String, path: String) -> Result<String, String> {
    let spec = format!("{rev}:{path}");
    // A path absent from that revision is a legitimate answer (a new file), not
    // an error the UI should surface.
    Ok(git(&["-C", &root, "show", &spec]).unwrap_or_default())
}

/// Restore specific paths from a revision — the safe primitive behind "revert
/// this file", replacing the old "write HEAD's contents over it" approach.
#[tauri::command]
pub fn git_take_files(root: String, rev: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<String> = vec![
        "-C".into(),
        root.clone(),
        "checkout".into(),
        rev,
        "--".into(),
    ];
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    git(&refs).map(|_| ())
}

/// Apply a patch with 3-way merge so conflicts are reported rather than
/// silently failing.
#[tauri::command]
pub fn git_apply(root: String, patch: String, reverse: bool) -> Result<(), String> {
    use std::io::Write;
    let mut args: Vec<&str> = vec!["-C", &root, "apply", "--3way"];
    if reverse {
        args.push("--reverse");
    }
    args.push("-");
    let mut child = Command::new("git")
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(patch.as_bytes()).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_init(dir: String) -> Result<String, String> {
    git(&["-C", &dir, "init"])?;
    repo_root(&dir).ok_or_else(|| "git init did not produce a repository".to_string())
}

/// A commit capturing the working tree as the user currently sees it, without
/// touching HEAD, the index or the working tree.
///
/// Builders branch from this instead of from HEAD, so uncommitted work is
/// carried into every worktree rather than appearing as a mass deletion.
#[tauri::command]
pub fn git_wave_base(root: String, index_path: String) -> Result<String, String> {
    let tree = snapshot_tree(&root, Path::new(&index_path))?;
    let head = git(&["-C", &root, "rev-parse", "HEAD"]).ok();
    let mut args: Vec<String> = vec!["-C".into(), root.clone(), "commit-tree".into(), tree];
    if let Some(h) = head {
        let h = h.trim().to_string();
        if !h.is_empty() {
            args.push("-p".into());
            args.push(h);
        }
    }
    args.push("-m".into());
    args.push("layera: wave base".into());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    Ok(git(&refs)?.trim().to_string())
}

#[tauri::command]
pub fn worktree_add(
    root: String,
    path: String,
    branch: String,
    base: String,
) -> Result<String, String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    git(&["-C", &root, "worktree", "add", "-b", &branch, &path, &base])?;
    Ok(path)
}

#[tauri::command]
pub fn worktree_remove(root: String, path: String) -> Result<(), String> {
    // Never fail the caller because a worktree was already gone.
    let _ = git(&["-C", &root, "worktree", "remove", "--force", &path]);
    let _ = git(&["-C", &root, "worktree", "prune"]);
    Ok(())
}

#[tauri::command]
pub fn worktree_list(root: String) -> Result<Vec<String>, String> {
    Ok(git(&["-C", &root, "worktree", "list", "--porcelain"])?
        .lines()
        .filter_map(|l| l.strip_prefix("worktree "))
        .map(|s| s.to_string())
        .collect())
}

/// Commit everything in a worktree under an explicit identity.
///
/// Agents do not reliably commit, and the user may have no git identity set;
/// `-c` supplies one for this command alone rather than writing their config.
#[tauri::command]
pub fn worktree_commit(path: String, message: String) -> Result<String, String> {
    git(&["-C", &path, "add", "-A"])?;
    let _ = git(&[
        "-C",
        &path,
        "-c",
        "user.name=Layera Space",
        "-c",
        "user.email=layera@localhost",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        &message,
    ]);
    Ok(git(&["-C", &path, "rev-parse", "HEAD"])?.trim().to_string())
}

#[tauri::command]
pub fn git_branch_delete(root: String, branch: String) -> Result<(), String> {
    git(&["-C", &root, "branch", "-D", &branch]).map(|_| ())
}

#[tauri::command]
pub fn git_branches(root: String, prefix: String) -> Result<Vec<String>, String> {
    Ok(git(&["-C", &root, "branch", "--format=%(refname:short)"])?
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| prefix.is_empty() || s.starts_with(&prefix))
        .collect())
}

#[tauri::command]
pub fn git_diff_files(
    root: String,
    base: String,
    after: String,
) -> Result<Vec<FileChange>, String> {
    Ok(diff_numstat(&root, &base, &after))
}

#[tauri::command]
pub fn git_diff_patch(root: String, base: String, after: String) -> Result<String, String> {
    Ok(diff_patch(&root, &base, &after))
}
