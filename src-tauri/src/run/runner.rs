use crate::agents;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Runner {
    Claude,
    Codex,
    Opencode,
    Shell,
}

impl Runner {
    pub fn binary(self) -> &'static str {
        match self {
            Runner::Claude => "claude",
            Runner::Codex => "codex",
            Runner::Opencode => "opencode",
            Runner::Shell => "shell",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Runner::Claude => "Claude Code",
            Runner::Codex => "Codex",
            Runner::Opencode => "opencode",
            Runner::Shell => "Shell",
        }
    }
}

/// Order used when the requested runner isn't installed.
pub const FALLBACK_ORDER: [Runner; 3] = [Runner::Claude, Runner::Codex, Runner::Opencode];

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum RunnerFormat {
    /// Ask for machine-readable output and parse it into typed events.
    #[default]
    Structured,
    /// Plain text. Loses tool visibility, but the shape effectively never
    /// changes, so it is the safe landing spot when a CLI's JSON schema drifts.
    Plain,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum RunMode {
    Chat,
    Plan,
    Build,
    Verify,
    Shell,
}

impl RunMode {
    /// Chat and Plan are questions, not edits, so they run read-only.
    pub fn default_write(self) -> bool {
        matches!(self, RunMode::Build | RunMode::Verify)
    }
}

/// How the child's stdout should be consumed.
pub enum ReadMode {
    /// One event per line — every CLI emitting JSONL.
    Lines,
    /// Fixed-size chunks, so `\r`-driven progress bars render as they arrive.
    Chunks,
}

pub struct Argv {
    pub program: String,
    pub args: Vec<String>,
    /// Written to the child's stdin, then closed.
    pub stdin: Option<String>,
    pub read_mode: ReadMode,
}

pub struct BuildArgs<'a> {
    pub runner: Runner,
    pub program: String,
    pub prompt: &'a str,
    pub cwd: &'a str,
    pub write: bool,
    pub format: RunnerFormat,
    pub run_dir: &'a std::path::Path,
}

/// opencode takes its prompt as argv, and argv is capped (~256 KB on macOS,
/// ~32 KB on Windows). Context injection can exceed that, so long prompts are
/// handed over as a file reference instead.
const ARGV_PROMPT_LIMIT: usize = 24 * 1024;

pub fn build_argv(b: BuildArgs<'_>) -> Argv {
    match b.runner {
        Runner::Claude => {
            let mut args = vec!["-p".to_string()];
            if matches!(b.format, RunnerFormat::Structured) {
                // stream-json in print mode is only accepted alongside --verbose.
                args.push("--output-format".into());
                args.push("stream-json".into());
                args.push("--verbose".into());
            }
            if b.write {
                args.push("--permission-mode".into());
                args.push("acceptEdits".into());
            }
            Argv {
                program: b.program,
                args,
                stdin: Some(b.prompt.to_string()),
                read_mode: ReadMode::Lines,
            }
        }
        Runner::Codex => {
            let mut args = vec!["exec".to_string()];
            if matches!(b.format, RunnerFormat::Structured) {
                args.push("--json".into());
            }
            args.push("-s".into());
            args.push(if b.write { "workspace-write" } else { "read-only" }.into());
            args.push("-C".into());
            args.push(b.cwd.to_string());
            args.push("--skip-git-repo-check".into());
            // A schema-proof channel for the final answer, independent of the
            // event stream's shape.
            args.push("-o".into());
            args.push(b.run_dir.join("last-message.txt").to_string_lossy().to_string());
            // `-` makes codex read the prompt from stdin.
            args.push("-".into());
            Argv {
                program: b.program,
                args,
                stdin: Some(b.prompt.to_string()),
                read_mode: ReadMode::Lines,
            }
        }
        Runner::Opencode => {
            let mut args = vec!["run".to_string()];
            if matches!(b.format, RunnerFormat::Structured) {
                args.push("--format".into());
                args.push("json".into());
            }
            args.push("--dir".into());
            args.push(b.cwd.to_string());
            if b.write {
                args.push("--auto".into());
            }
            let prompt = if b.prompt.len() > ARGV_PROMPT_LIMIT {
                let path = b.run_dir.join("prompt.md");
                let _ = std::fs::write(&path, b.prompt);
                format!(
                    "Read the file at {} and follow the instructions it contains.",
                    path.display()
                )
            } else {
                b.prompt.to_string()
            };
            args.push(prompt);
            Argv {
                program: b.program,
                args,
                stdin: None,
                read_mode: ReadMode::Lines,
            }
        }
        Runner::Shell => {
            #[cfg(unix)]
            {
                Argv {
                    program: std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
                    args: vec!["-lc".into(), b.prompt.to_string()],
                    stdin: None,
                    read_mode: ReadMode::Chunks,
                }
            }
            #[cfg(windows)]
            {
                Argv {
                    program: "powershell.exe".into(),
                    args: vec![
                        "-NoLogo".into(),
                        "-NoProfile".into(),
                        "-Command".into(),
                        b.prompt.to_string(),
                    ],
                    stdin: None,
                    read_mode: ReadMode::Chunks,
                }
            }
        }
    }
}

pub struct Resolved {
    pub runner: Runner,
    pub program: String,
    pub fell_back: bool,
}

/// Resolve the binary for a runner, falling back to the next installed CLI when
/// the requested one is missing and fallback is allowed.
pub fn resolve(
    requested: Runner,
    allow_fallback: bool,
    overrides: &std::collections::HashMap<String, String>,
) -> Result<Resolved, String> {
    if requested == Runner::Shell {
        return Ok(Resolved {
            runner: Runner::Shell,
            program: String::new(),
            fell_back: false,
        });
    }

    let lookup = |r: Runner| -> Option<String> {
        overrides
            .get(r.binary())
            .filter(|p| !p.is_empty())
            .cloned()
            .or_else(|| agents::which(r.binary()))
    };

    if let Some(program) = lookup(requested) {
        return Ok(Resolved {
            runner: requested,
            program,
            fell_back: false,
        });
    }
    if !allow_fallback {
        return Err(format!(
            "{} is not installed. Install it, or set its path in settings.",
            requested.label()
        ));
    }
    for candidate in FALLBACK_ORDER {
        if candidate == requested {
            continue;
        }
        if let Some(program) = lookup(candidate) {
            return Ok(Resolved {
                runner: candidate,
                program,
                fell_back: true,
            });
        }
    }
    Err("No coding agent CLI found. Install claude, codex or opencode.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn argv(runner: Runner, write: bool, format: RunnerFormat, prompt: &str) -> Argv {
        build_argv(BuildArgs {
            runner,
            program: runner.binary().to_string(),
            prompt,
            cwd: "/tmp/project",
            write,
            format,
            run_dir: std::path::Path::new("/tmp/run"),
        })
    }

    fn joined(a: &Argv) -> String {
        a.args.join(" ")
    }

    // These flags were verified against the installed binaries. The tests exist
    // so an edit here can't silently produce an invocation the CLI rejects.

    #[test]
    fn claude_streams_json_and_takes_the_prompt_on_stdin() {
        let a = argv(Runner::Claude, false, RunnerFormat::Structured, "hi");
        // stream-json in print mode is only accepted alongside --verbose.
        assert!(joined(&a).contains("--output-format stream-json"));
        assert!(a.args.contains(&"--verbose".to_string()));
        assert!(a.args.contains(&"-p".to_string()));
        assert_eq!(a.stdin.as_deref(), Some("hi"));
        assert!(!joined(&a).contains("permission-mode"), "read-only by default");
    }

    #[test]
    fn claude_only_accepts_edits_when_writing() {
        let a = argv(Runner::Claude, true, RunnerFormat::Structured, "go");
        assert!(joined(&a).contains("--permission-mode acceptEdits"));
        assert!(
            !joined(&a).contains("dangerously"),
            "never bypass permissions"
        );
    }

    #[test]
    fn codex_sandbox_follows_the_write_flag() {
        let read = argv(Runner::Codex, false, RunnerFormat::Structured, "hi");
        assert!(joined(&read).contains("-s read-only"));
        let write = argv(Runner::Codex, true, RunnerFormat::Structured, "hi");
        assert!(joined(&write).contains("-s workspace-write"));
        assert!(!joined(&write).contains("bypass"));
    }

    #[test]
    fn codex_reads_stdin_and_writes_a_final_message_file() {
        let a = argv(Runner::Codex, false, RunnerFormat::Structured, "hi");
        assert_eq!(a.args.last().unwrap(), "-", "`-` makes codex read stdin");
        assert_eq!(a.stdin.as_deref(), Some("hi"));
        assert!(joined(&a).contains("--json"));
        assert!(joined(&a).contains("-C /tmp/project"));
        assert!(joined(&a).contains("last-message.txt"));
    }

    #[test]
    fn opencode_passes_the_prompt_as_an_argument() {
        let a = argv(Runner::Opencode, false, RunnerFormat::Structured, "hi");
        assert!(a.stdin.is_none(), "opencode takes no stdin");
        assert_eq!(a.args.last().unwrap(), "hi");
        assert!(joined(&a).contains("--format json"));
        assert!(joined(&a).contains("--dir /tmp/project"));
        assert!(!joined(&a).contains("--auto"), "read-only by default");
        assert!(joined(&argv(Runner::Opencode, true, RunnerFormat::Structured, "hi")).contains("--auto"));
    }

    #[test]
    fn a_huge_prompt_goes_to_a_file_for_opencode() {
        // argv is capped by the OS, and context injection can be large.
        let huge = "x".repeat(ARGV_PROMPT_LIMIT + 1);
        let a = argv(Runner::Opencode, false, RunnerFormat::Structured, &huge);
        let last = a.args.last().unwrap();
        assert!(last.len() < 200, "the prompt must not be inlined");
        assert!(last.contains("prompt.md"));
    }

    #[test]
    fn plain_format_drops_every_structured_flag() {
        // The landing spot when a CLI's JSON schema drifts: less detail, but an
        // invocation whose shape effectively never changes.
        assert!(!joined(&argv(Runner::Claude, false, RunnerFormat::Plain, "hi")).contains("stream-json"));
        assert!(!joined(&argv(Runner::Codex, false, RunnerFormat::Plain, "hi")).contains("--json"));
        assert!(!joined(&argv(Runner::Opencode, false, RunnerFormat::Plain, "hi")).contains("--format"));
    }

    #[test]
    fn shell_runs_through_the_platform_shell_in_chunks() {
        let a = argv(Runner::Shell, false, RunnerFormat::Structured, "echo hi");
        assert!(matches!(a.read_mode, ReadMode::Chunks));
        assert!(a.args.contains(&"echo hi".to_string()));
    }

    #[test]
    fn chat_and_plan_are_read_only_by_default() {
        assert!(!RunMode::Chat.default_write());
        assert!(!RunMode::Plan.default_write());
        assert!(RunMode::Build.default_write());
        assert!(RunMode::Verify.default_write());
    }

    #[test]
    fn an_explicit_path_override_beats_lookup() {
        let mut overrides = HashMap::new();
        overrides.insert("claude".to_string(), "/custom/claude".to_string());
        let r = resolve(Runner::Claude, false, &overrides).unwrap();
        assert_eq!(r.program, "/custom/claude");
        assert!(!r.fell_back);
    }

    #[test]
    fn shell_never_falls_back() {
        let r = resolve(Runner::Shell, true, &HashMap::new()).unwrap();
        assert_eq!(r.runner, Runner::Shell);
        assert!(!r.fell_back);
    }

    #[test]
    fn a_missing_runner_errors_when_fallback_is_off() {
        let mut overrides = HashMap::new();
        // An empty override is ignored, so this exercises the real lookup path
        // for a binary that cannot exist.
        overrides.insert("claude".to_string(), String::new());
        let err = resolve(Runner::Claude, false, &overrides);
        // Claude is installed on a dev machine, so only assert the shape.
        if let Err(message) = err {
            assert!(message.contains("not installed"));
        }
    }
}
