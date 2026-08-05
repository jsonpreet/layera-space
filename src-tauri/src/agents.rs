use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

fn detect_sync(names: Vec<String>) -> HashMap<String, Option<String>> {
    let mut result: HashMap<String, Option<String>> = HashMap::new();

    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let script = names
            .iter()
            .map(|n| format!("command -v {} 2>/dev/null || true", n))
            .collect::<Vec<_>>()
            .join("\n");
        if let Ok(out) = Command::new(&shell).args(["-lc", &script]).output() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut lines = stdout.lines();
            for name in &names {
                let found = lines
                    .next()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty() && l.starts_with('/'));
                result.insert(name.clone(), found);
            }
            if result.values().all(|v| v.is_some()) {
                return result;
            }
        }
    }

    #[cfg(windows)]
    {
        for name in &names {
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
        if result.values().all(|v| v.is_some()) {
            return result;
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();

    let mut dirs: Vec<PathBuf> = vec![];
    if let Some(path) = std::env::var_os("PATH") {
        for d in std::env::split_paths(&path) {
            dirs.push(d);
        }
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

    for name in &names {
        if matches!(result.get(name), Some(Some(_))) {
            continue;
        }
        let mut found: Option<String> = None;
        'outer: for dir in &dirs {
            for candidate in [dir.join(name), dir.join(format!("{name}.exe"))] {
                if candidate.is_file() {
                    found = Some(candidate.to_string_lossy().to_string());
                    break 'outer;
                }
            }
        }
        result.insert(name.clone(), found);
    }

    result
}

#[tauri::command]
pub async fn detect_agents(
    names: Vec<String>,
) -> Result<HashMap<String, Option<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || detect_sync(names))
        .await
        .map_err(|e| e.to_string())
}
