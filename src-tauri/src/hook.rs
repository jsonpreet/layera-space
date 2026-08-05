use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct HookServer {
    pub port: u16,
}

#[derive(Serialize, Clone)]
pub struct HookEvent {
    pub pane_id: String,
    pub agent: String,
    pub event: String,
}

fn find_subseq(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn handle_conn(mut stream: TcpStream, app: AppHandle) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 2048];
    let body_start: Option<usize>;
    let mut content_length: usize = 0;

    loop {
        let n = match stream.read(&mut tmp) {
            Ok(0) => return,
            Ok(n) => n,
            Err(_) => return,
        };
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_subseq(&buf, b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&buf[..pos]).to_lowercase();
            for line in headers.lines() {
                if let Some(v) = line.strip_prefix("content-length:") {
                    content_length = v.trim().parse().unwrap_or(0);
                }
            }
            body_start = Some(pos + 4);
            break;
        }
        if buf.len() > 16384 {
            return;
        }
    }

    let start = body_start.unwrap();
    while buf.len() < start + content_length {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(_) => break,
        }
    }

    let end = (start + content_length).min(buf.len());
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf[start..end]) {
        let event = HookEvent {
            pane_id: v
                .get("pane_id")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            agent: v
                .get("agent")
                .and_then(|x| x.as_str())
                .unwrap_or("unknown")
                .to_string(),
            event: v
                .get("event")
                .and_then(|x| x.as_str())
                .unwrap_or("done")
                .to_string(),
        };
        if !event.pane_id.is_empty() {
            let _ = app.emit("agent://hook", event);
        }
    }

    let _ = stream.write_all(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
    );
}

pub fn start(app: AppHandle) -> Result<HookServer, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(stream) = stream {
                let app = app.clone();
                std::thread::spawn(move || handle_conn(stream, app));
            }
        }
    });
    Ok(HookServer { port })
}

#[tauri::command]
pub fn hook_url(state: tauri::State<'_, HookServer>) -> String {
    format!("http://127.0.0.1:{}", state.port)
}

pub fn hooks_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let hooks = dir.join("hooks");
    std::fs::create_dir_all(&hooks).map_err(|e| e.to_string())?;
    Ok(hooks)
}

const NOTIFY_SH: &str = r#"#!/bin/sh
# Layera Space completion notifier. Safe to remove.
[ -z "$LAYERA_HOOK_URL" ] && exit 0
AGENT="${1:-unknown}"
EVENT="${2:-done}"
curl -fsS -m 2 -X POST "$LAYERA_HOOK_URL/hook" \
  -H "content-type: application/json" \
  -d "{\"pane_id\":\"${LAYERA_PANE_ID:-}\",\"agent\":\"$AGENT\",\"event\":\"$EVENT\"}" \
  >/dev/null 2>&1 || true
exit 0
"#;

const NOTIFY_CMD: &str = "@echo off\r\nrem Layera Space completion notifier. Safe to remove.\r\nif \"%LAYERA_HOOK_URL%\"==\"\" exit /b 0\r\ncurl -fsS -m 2 -X POST \"%LAYERA_HOOK_URL%/hook\" -H \"content-type: application/json\" -d \"{\\\"pane_id\\\":\\\"%LAYERA_PANE_ID%\\\",\\\"agent\\\":\\\"%1\\\",\\\"event\\\":\\\"%~2\\\"}\" >nul 2>&1\r\nexit /b 0\r\n";

#[derive(Serialize)]
pub struct HookInstallStatus {
    pub claude: String,
    pub codex: String,
    pub notify_script: String,
}

fn home_dir() -> Result<std::path::PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .map_err(|_| "no home dir".to_string())
}

fn write_notify_scripts(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = hooks_dir(app)?;
    let sh = dir.join("notify.sh");
    std::fs::write(&sh, NOTIFY_SH).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&sh).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&sh, perms).map_err(|e| e.to_string())?;
    }
    let cmd = dir.join("notify.cmd");
    std::fs::write(&cmd, NOTIFY_CMD).map_err(|e| e.to_string())?;
    Ok(sh)
}

const MARKER: &str = "layera";

fn install_claude_hook(script: &std::path::Path) -> String {
    let home = match home_dir() {
        Ok(h) => h,
        Err(e) => return format!("skipped: {e}"),
    };
    let settings_path = home.join(".claude").join("settings.json");
    let mut settings: serde_json::Value = match std::fs::read_to_string(&settings_path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(v) => v,
            Err(_) => return "skipped: could not parse ~/.claude/settings.json".to_string(),
        },
        Err(_) => serde_json::json!({}),
    };

    let raw = settings.to_string();
    if raw.contains(MARKER) {
        return "already installed".to_string();
    }

    #[cfg(unix)]
    let command = format!("sh \"{}\" claude stop", script.display());
    #[cfg(windows)]
    let command = format!(
        "cmd /c \"{}\" claude stop",
        script.with_extension("cmd").display()
    );

    let entry = serde_json::json!({
        "hooks": [{ "type": "command", "command": command }]
    });

    let hooks = settings
        .as_object_mut()
        .map(|o| o.entry("hooks").or_insert_with(|| serde_json::json!({})));
    let Some(hooks) = hooks.and_then(|h| h.as_object_mut()) else {
        return "skipped: unexpected settings.json shape".to_string();
    };
    let stop = hooks
        .entry("Stop")
        .or_insert_with(|| serde_json::json!([]));
    let Some(stop_arr) = stop.as_array_mut() else {
        return "skipped: unexpected Stop hook shape".to_string();
    };
    stop_arr.push(entry);

    if let Some(parent) = settings_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(
        &settings_path,
        serde_json::to_string_pretty(&settings).unwrap_or_default(),
    ) {
        Ok(_) => "installed".to_string(),
        Err(e) => format!("failed: {e}"),
    }
}

fn install_codex_hook(script: &std::path::Path) -> String {
    let home = match home_dir() {
        Ok(h) => h,
        Err(e) => return format!("skipped: {e}"),
    };
    let config_path = home.join(".codex").join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();

    if existing.contains(MARKER) {
        return "already installed".to_string();
    }
    for line in existing.lines() {
        let t = line.trim();
        if t.starts_with("notify") && t.contains('=') {
            return "skipped: notify already configured in ~/.codex/config.toml".to_string();
        }
    }

    #[cfg(unix)]
    let line = format!(
        "notify = [\"sh\", \"{}\", \"codex\"]\n",
        script.display().to_string().replace('\\', "\\\\")
    );
    #[cfg(windows)]
    let line = format!(
        "notify = [\"cmd\", \"/c\", \"{}\", \"codex\"]\n",
        script
            .with_extension("cmd")
            .display()
            .to_string()
            .replace('\\', "\\\\")
    );

    let mut out = existing;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&line);

    if let Some(parent) = config_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&config_path, out) {
        Ok(_) => "installed".to_string(),
        Err(e) => format!("failed: {e}"),
    }
}

#[tauri::command]
pub fn install_hooks(app: AppHandle) -> Result<HookInstallStatus, String> {
    let script = write_notify_scripts(&app)?;
    Ok(HookInstallStatus {
        claude: install_claude_hook(&script),
        codex: install_codex_hook(&script),
        notify_script: script.display().to_string(),
    })
}
