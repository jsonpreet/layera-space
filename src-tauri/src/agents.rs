use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

#[derive(Serialize, Clone, Default)]
pub struct RunnerInfo {
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Resolving a binary spawns a login shell, which costs ~100ms. A graph run can
/// resolve a runner per node, so the answer is memoized until `force`d.
fn cache() -> &'static Mutex<HashMap<String, RunnerInfo>> {
    static CACHE: OnceLock<Mutex<HashMap<String, RunnerInfo>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `command -v` prints *nothing* for a missing binary, so mapping its stdout
/// lines onto `names` positionally silently shifts every result after the first
/// missing one. Echoing a placeholder guarantees one line per probe.
const MISSING: &str = "-";

fn probe_shell(names: &[String]) -> Option<HashMap<String, Option<String>>> {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let script = names
            .iter()
            .map(|n| format!("command -v {n} 2>/dev/null || echo '{MISSING}'"))
            .collect::<Vec<_>>()
            .join("\n");
        let out = Command::new(&shell).args(["-lc", &script]).output().ok()?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() != names.len() {
            // Shell noise (a profile that prints banners) broke the 1:1 mapping.
            // Fall back to the directory scan rather than guess.
            return None;
        }
        let mut result = HashMap::new();
        for (name, line) in names.iter().zip(lines) {
            let t = line.trim();
            let found = if t == MISSING || t.is_empty() || !t.starts_with('/') {
                None
            } else {
                Some(t.to_string())
            };
            result.insert(name.clone(), found);
        }
        Some(result)
    }
    #[cfg(windows)]
    {
        let mut result = HashMap::new();
        for name in names {
            let mut found: Option<String> = None;
            if let Ok(out) = Command::new("where.exe").arg(name).output() {
                if out.status.success() {
                    found = String::from_utf8_lossy(&out.stdout)
                        .lines()
                        .next()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                }
            }
            result.insert(name.clone(), found);
        }
        Some(result)
    }
}

fn search_dirs() -> Vec<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let mut dirs: Vec<PathBuf> = vec![];
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }

    #[cfg(unix)]
    {
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            dirs.push(PathBuf::from(extra));
        }
        for extra in [
            format!("{home}/.local/bin"),
            format!("{home}/bin"),
            format!("{home}/.volta/bin"),
            format!("{home}/.asdf/shims"),
            format!("{home}/.bun/bin"),
            format!("{home}/.opencode/bin"),
        ] {
            dirs.push(PathBuf::from(extra));
        }
    }

    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(PathBuf::from(format!("{appdata}\\npm")));
        }
        dirs.push(PathBuf::from(format!("{home}\\.local\\bin")));
    }

    dirs
}

fn scan_dirs(name: &str) -> Option<String> {
    for dir in search_dirs() {
        for candidate in [dir.join(name), dir.join(format!("{name}.exe"))] {
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn detect_sync(names: Vec<String>) -> HashMap<String, Option<String>> {
    let mut result = probe_shell(&names).unwrap_or_default();
    for name in &names {
        if matches!(result.get(name), Some(Some(_))) {
            continue;
        }
        result.insert(name.clone(), scan_dirs(name));
    }
    result
}

fn read_version(path: &str) -> Option<String> {
    let out = Command::new(path).arg("--version").output().ok()?;
    let text = if out.stdout.is_empty() {
        String::from_utf8_lossy(&out.stderr).to_string()
    } else {
        String::from_utf8_lossy(&out.stdout).to_string()
    };
    let line = text.lines().find(|l| !l.trim().is_empty())?;
    Some(line.trim().to_string())
}

/// Memoized absolute path for a runner binary, or None if it isn't installed.
pub fn which(name: &str) -> Option<String> {
    if let Ok(c) = cache().lock() {
        if let Some(info) = c.get(name) {
            return info.path.clone();
        }
    }
    let path = detect_sync(vec![name.to_string()])
        .remove(name)
        .flatten();
    let version = path.as_deref().and_then(read_version);
    if let Ok(mut c) = cache().lock() {
        c.insert(
            name.to_string(),
            RunnerInfo {
                path: path.clone(),
                version,
            },
        );
    }
    path
}

/// Recorded on every run record so a CLI upgrade that breaks output parsing is
/// diagnosable after the fact. Wired up by the run engine.
#[allow(dead_code)]
pub fn runner_version(name: &str) -> Option<String> {
    which(name);
    cache().lock().ok()?.get(name)?.version.clone()
}

#[tauri::command]
pub async fn detect_agents(
    names: Vec<String>,
) -> Result<HashMap<String, Option<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let found = detect_sync(names.clone());
        if let Ok(mut c) = cache().lock() {
            for (name, path) in &found {
                let version = path.as_deref().and_then(read_version);
                c.insert(
                    name.clone(),
                    RunnerInfo {
                        path: path.clone(),
                        version,
                    },
                );
            }
        }
        found
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn detect_runners(
    names: Vec<String>,
    force: bool,
) -> Result<HashMap<String, RunnerInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if force {
            if let Ok(mut c) = cache().lock() {
                c.clear();
            }
        }
        let mut out = HashMap::new();
        for name in names {
            which(&name);
            let info = cache()
                .lock()
                .ok()
                .and_then(|c| c.get(&name).cloned())
                .unwrap_or_default();
            out.insert(name, info);
        }
        out
    })
    .await
    .map_err(|e| e.to_string())
}
