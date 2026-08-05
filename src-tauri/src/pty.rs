use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

pub struct Recorder {
    pub file: BufWriter<File>,
    pub start: Instant,
}

struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    recorder: Arc<Mutex<Option<Recorder>>>,
}

pub struct PtyManager {
    next_id: AtomicU64,
    handles: Mutex<HashMap<String, PtyHandle>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            handles: Mutex::new(HashMap::new()),
        }
    }

    pub fn recorder_for(&self, id: &str) -> Option<Arc<Mutex<Option<Recorder>>>> {
        self.handles.lock().unwrap().get(id).map(|h| h.recorder.clone())
    }
}

#[derive(Serialize, Clone)]
struct OutputEvent {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct ExitEvent {
    id: String,
}

fn default_shell_command() -> CommandBuilder {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd
    }
    #[cfg(windows)]
    {
        let cmd = CommandBuilder::new("powershell.exe");
        cmd
    }
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    cwd: String,
    rows: u16,
    cols: u16,
    env: HashMap<String, String>,
    program: Option<String>,
    args: Vec<String>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = match program {
        Some(p) => {
            let mut c = CommandBuilder::new(p);
            for a in args {
                c.arg(a);
            }
            c.env("TERM", "xterm-256color");
            c.env("COLORTERM", "truecolor");
            c
        }
        None => default_shell_command(),
    };
    cmd.cwd(std::path::PathBuf::from(&cwd));
    for (k, v) in env {
        cmd.env(k, v);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst).to_string();
    drop(pair.slave);

    let recorder: Arc<Mutex<Option<Recorder>>> = Arc::new(Mutex::new(None));
    let rec_thread = recorder.clone();
    let thread_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let b64 = STANDARD.encode(&buf[..n]);
                    if let Ok(mut guard) = rec_thread.lock() {
                        if let Some(rec) = guard.as_mut() {
                            let t = rec.start.elapsed().as_secs_f64();
                            let _ = writeln!(rec.file, "[{:.3},\"o\",\"{}\"]", t, b64);
                        }
                    }
                    let event = OutputEvent {
                        id: thread_id.clone(),
                        data: b64,
                    };
                    if app.emit("pty://output", event).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        if let Ok(mut guard) = rec_thread.lock() {
            if let Some(mut rec) = guard.take() {
                let _ = rec.file.flush();
            }
        }
        let _ = app.emit("pty://exit", ExitEvent { id: thread_id });
    });

    let handle = PtyHandle {
        writer,
        master: pair.master,
        child,
        recorder,
    };
    state.handles.lock().unwrap().insert(id.clone(), handle);
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, id: String, data: Vec<u8>) -> Result<(), String> {
    let mut handles = state.handles.lock().unwrap();
    match handles.get_mut(&id) {
        Some(h) => h.writer.write_all(&data).map_err(|e| e.to_string()),
        None => Err("pty not found".to_string()),
    }
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let handles = state.handles.lock().unwrap();
    match handles.get(&id) {
        Some(h) => h
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string()),
        None => Err("pty not found".to_string()),
    }
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, id: String) -> Result<(), String> {
    let mut handles = state.handles.lock().unwrap();
    if let Some(mut h) = handles.remove(&id) {
        let _ = h.child.kill();
        let _ = h.child.wait();
    }
    Ok(())
}
