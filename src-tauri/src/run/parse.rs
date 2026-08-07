use super::runner::Runner;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Stdout,
    Stderr,
    Assistant,
    Thinking,
    Tool,
    ToolResult,
    Usage,
    Result,
    Error,
    /// A line we could not interpret. Never dropped — shown as-is.
    Raw,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub seq: u64,
    pub t: f64,
    pub kind: EventKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

impl RunEvent {
    pub fn new(kind: EventKind, text: Option<String>) -> Self {
        Self {
            seq: 0,
            t: 0.0,
            kind,
            text,
            tool: None,
            data: None,
            truncated: false,
        }
    }
}

/// Look a value up by trying several paths in order.
///
/// A CLI renaming a field then costs one extra entry in a constant, rather than
/// a parser rewrite. Numeric segments index into arrays.
fn pick<'a>(v: &'a Value, paths: &[&[&str]]) -> Option<&'a Value> {
    'next: for path in paths {
        let mut cur = v;
        for seg in *path {
            let next = match seg.parse::<usize>() {
                Ok(i) => cur.get(i),
                Err(_) => cur.get(*seg),
            };
            match next {
                Some(n) => cur = n,
                None => continue 'next,
            }
        }
        if !cur.is_null() {
            return Some(cur);
        }
    }
    None
}

fn pick_str(v: &Value, paths: &[&[&str]]) -> Option<String> {
    pick(v, paths).and_then(|x| x.as_str().map(|s| s.to_string()))
}

pub trait LineParser: Send {
    fn parse(&mut self, line: &str, out: &mut Vec<RunEvent>);
    /// Best final answer seen, used when a runner offers no dedicated channel.
    fn final_text(&self) -> Option<String>;
    /// (recognised, unrecognised) line counts.
    fn health(&self) -> (u32, u32);
}

/// Passthrough for plain-text output and shell commands.
#[derive(Default)]
pub struct PlainParser {
    last: Option<String>,
    ok: u32,
}

impl LineParser for PlainParser {
    fn parse(&mut self, line: &str, out: &mut Vec<RunEvent>) {
        if !line.trim().is_empty() {
            self.last = Some(line.to_string());
        }
        self.ok += 1;
        out.push(RunEvent::new(EventKind::Stdout, Some(line.to_string())));
    }
    fn final_text(&self) -> Option<String> {
        self.last.clone()
    }
    fn health(&self) -> (u32, u32) {
        (self.ok, 0)
    }
}

#[derive(Default)]
struct Counters {
    ok: u32,
    fallback: u32,
}

/// Shared JSONL handling: every runner emits one JSON object per line, so the
/// only real difference is which fields carry the text.
struct JsonlParser {
    /// Retained so per-runner special cases can be added without a rewrite.
    #[allow(dead_code)]
    runner: Runner,
    counters: Counters,
    last_assistant: Option<String>,
    result: Option<String>,
}

const ASSISTANT_TEXT: &[&[&str]] = &[
    // claude: {"type":"assistant","message":{"content":[{"type":"text","text":...}]}}
    &["message", "content", "0", "text"],
    // codex: {"msg":{"type":"agent_message","message":"..."}} and newer item shapes
    &["msg", "message"],
    &["item", "text"],
    &["item", "message"],
    // opencode and generic deltas
    &["part", "text"],
    &["delta", "text"],
    &["text"],
    &["message"],
    &["content"],
];

const THINKING_TEXT: &[&[&str]] = &[
    &["message", "content", "0", "thinking"],
    &["msg", "text"],
    &["item", "reasoning"],
    &["thinking"],
    &["reasoning"],
];

const TOOL_NAME: &[&[&str]] = &[
    &["message", "content", "0", "name"],
    &["msg", "command"],
    &["item", "name"],
    &["tool"],
    &["name"],
    &["tool_name"],
];

const RESULT_TEXT: &[&[&str]] = &[
    &["result"],
    &["msg", "last_agent_message"],
    &["item", "text"],
    &["output"],
];

impl JsonlParser {
    fn new(runner: Runner) -> Self {
        Self {
            runner,
            counters: Counters::default(),
            last_assistant: None,
            result: None,
        }
    }

    /// Every type-ish field on the line, joined.
    ///
    /// Deliberately not "first match wins": codex nests the meaningful type
    /// under `item.type` while the outer `type` only says `item.completed`, so
    /// stopping at the first hit misclassifies the line.
    fn type_of(v: &Value) -> String {
        const TYPE_PATHS: &[&[&str]] = &[
            &["type"],
            &["msg", "type"],
            &["item", "type"],
            &["event"],
            &["kind"],
            &["subtype"],
        ];
        TYPE_PATHS
            .iter()
            .filter_map(|p| pick_str(v, &[p]))
            .collect::<Vec<_>>()
            .join("|")
    }
}

impl LineParser for JsonlParser {
    fn parse(&mut self, line: &str, out: &mut Vec<RunEvent>) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return;
        }
        let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
            // Not JSON at all: a banner, a warning, or a schema change. Keep it.
            self.counters.fallback += 1;
            out.push(RunEvent::new(EventKind::Raw, Some(line.to_string())));
            return;
        };

        let ty = JsonlParser::type_of(&v);
        let has = |needle: &str| ty.contains(needle);

        // Errors first: they matter more than the shape they arrive in.
        if has("error") || v.get("is_error").and_then(|x| x.as_bool()) == Some(true) {
            self.counters.ok += 1;
            let text = pick_str(&v, &[&["error"], &["message"], &["result"]])
                .unwrap_or_else(|| trimmed.to_string());
            let mut ev = RunEvent::new(EventKind::Error, Some(text));
            ev.data = Some(v);
            out.push(ev);
            return;
        }

        if has("result") || has("turn.completed") || has("task_complete") {
            self.counters.ok += 1;
            if let Some(text) = pick_str(&v, RESULT_TEXT) {
                self.result = Some(text.clone());
                let mut ev = RunEvent::new(EventKind::Result, Some(text));
                ev.data = Some(v);
                out.push(ev);
            } else {
                let mut ev = RunEvent::new(EventKind::Result, None);
                ev.data = Some(v);
                out.push(ev);
            }
            return;
        }

        if has("reasoning") || has("thinking") {
            if let Some(text) = pick_str(&v, THINKING_TEXT) {
                self.counters.ok += 1;
                out.push(RunEvent::new(EventKind::Thinking, Some(text)));
                return;
            }
        }

        if has("tool") || has("command") || has("exec") || has("patch") {
            self.counters.ok += 1;
            let name = pick_str(&v, TOOL_NAME).unwrap_or_else(|| ty.clone());
            let kind = if ty.contains("result") || ty.contains("output") || ty.contains("end") {
                EventKind::ToolResult
            } else {
                EventKind::Tool
            };
            let mut ev = RunEvent::new(kind, None);
            ev.tool = Some(name);
            ev.data = Some(v);
            out.push(ev);
            return;
        }

        // Claude reports usage and rate limits as their own line types.
        if has("usage") || has("rate_limit") {
            self.counters.ok += 1;
            let mut ev = RunEvent::new(EventKind::Usage, None);
            ev.data = Some(v);
            out.push(ev);
            return;
        }

        if has("assistant") || has("message") || has("agent") || has("text") {
            // A claude assistant line can carry tool_use rather than text.
            let content_type = pick_str(&v, &[&["message", "content", "0", "type"]]);
            if content_type.as_deref() == Some("tool_use") {
                self.counters.ok += 1;
                let mut ev = RunEvent::new(EventKind::Tool, None);
                ev.tool = pick_str(&v, TOOL_NAME);
                ev.data = Some(v);
                out.push(ev);
                return;
            }
            if let Some(text) = pick_str(&v, ASSISTANT_TEXT) {
                self.counters.ok += 1;
                self.last_assistant = Some(text.clone());
                out.push(RunEvent::new(EventKind::Assistant, Some(text)));
                return;
            }
        }

        // Session banners, init handshakes and other bookkeeping: recognised,
        // but nothing a person needs in the log.
        if has("system") || has("session") || has("init") || has("hook") {
            self.counters.ok += 1;
            return;
        }

        self.counters.fallback += 1;
        out.push(RunEvent::new(EventKind::Raw, Some(line.to_string())));
    }

    fn final_text(&self) -> Option<String> {
        self.result.clone().or_else(|| self.last_assistant.clone())
    }

    fn health(&self) -> (u32, u32) {
        (self.counters.ok, self.counters.fallback)
    }
}

pub fn parser_for(runner: Runner, structured: bool) -> Box<dyn LineParser> {
    if !structured || runner == Runner::Shell {
        Box::<PlainParser>::default()
    } else {
        Box::new(JsonlParser::new(runner))
    }
}

/// True once enough lines have gone unrecognised to say the output shape has
/// drifted away from what this parser understands.
pub fn is_degraded(ok: u32, fallback: u32) -> bool {
    let total = ok + fallback;
    total > 5 && fallback * 2 > total
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(runner: Runner, lines: &[&str]) -> (Vec<RunEvent>, Box<dyn LineParser>) {
        let mut p = parser_for(runner, true);
        let mut out = vec![];
        for l in lines {
            p.parse(l, &mut out);
        }
        (out, p)
    }

    fn kinds(events: &[RunEvent]) -> Vec<&EventKind> {
        events.iter().map(|e| &e.kind).collect()
    }

    // Captured from claude 2.1.222 via:
    //   claude -p "Reply with exactly: hi" --output-format stream-json --verbose
    const CLAUDE_ASSISTANT: &str = r#"{"type":"assistant","message":{"model":"claude-opus-5","type":"message","role":"assistant","content":[{"type":"text","text":"hi"}]},"session_id":"a"}"#;
    const CLAUDE_INIT: &str = r#"{"type":"system","subtype":"init","cwd":"/tmp","session_id":"a","tools":["Bash"]}"#;
    const CLAUDE_HOOK: &str = r#"{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup","session_id":"a"}"#;
    const CLAUDE_RATE: &str = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"},"session_id":"a"}"#;
    const CLAUDE_RESULT: &str = r#"{"type":"result","subtype":"success","is_error":false,"duration_ms":4200,"num_turns":1,"result":"hi","session_id":"a"}"#;
    const CLAUDE_TOOL: &str = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]},"session_id":"a"}"#;

    #[test]
    fn parses_a_real_claude_session() {
        let (events, parser) = run(
            Runner::Claude,
            &[
                CLAUDE_HOOK,
                CLAUDE_INIT,
                CLAUDE_ASSISTANT,
                CLAUDE_RATE,
                CLAUDE_RESULT,
            ],
        );
        // Banners are recognised but produce no log noise.
        assert_eq!(
            kinds(&events),
            vec![&EventKind::Assistant, &EventKind::Usage, &EventKind::Result]
        );
        assert_eq!(events[0].text.as_deref(), Some("hi"));
        assert_eq!(parser.final_text().as_deref(), Some("hi"));
        assert_eq!(parser.health().1, 0, "no line should go unrecognised");
    }

    #[test]
    fn recognises_claude_tool_use() {
        let (events, _) = run(Runner::Claude, &[CLAUDE_TOOL]);
        assert_eq!(kinds(&events), vec![&EventKind::Tool]);
        assert_eq!(events[0].tool.as_deref(), Some("Bash"));
    }

    #[test]
    fn surfaces_errors() {
        let (events, _) = run(
            Runner::Claude,
            &[r#"{"type":"result","is_error":true,"result":"boom"}"#],
        );
        assert_eq!(kinds(&events), vec![&EventKind::Error]);
        assert_eq!(events[0].text.as_deref(), Some("boom"));
    }

    #[test]
    fn codex_agent_message_shape() {
        let (events, parser) = run(
            Runner::Codex,
            &[r#"{"id":"0","msg":{"type":"agent_message","message":"done"}}"#],
        );
        assert_eq!(kinds(&events), vec![&EventKind::Assistant]);
        assert_eq!(parser.final_text().as_deref(), Some("done"));
    }

    #[test]
    fn codex_item_shape() {
        let (events, _) = run(
            Runner::Codex,
            &[r#"{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}"#],
        );
        assert_eq!(kinds(&events), vec![&EventKind::Assistant]);
        assert_eq!(events[0].text.as_deref(), Some("ok"));
    }

    // The whole point of the ladder: unknown input degrades, never crashes and
    // never silently disappears.
    #[test]
    fn unknown_json_survives_as_raw() {
        let (events, parser) = run(Runner::Claude, &[r#"{"totally":"new","shape":1}"#]);
        assert_eq!(kinds(&events), vec![&EventKind::Raw]);
        assert_eq!(parser.health(), (0, 1));
    }

    #[test]
    fn non_json_survives_as_raw() {
        let (events, _) = run(Runner::Claude, &["Warning: something happened"]);
        assert_eq!(kinds(&events), vec![&EventKind::Raw]);
        assert_eq!(events[0].text.as_deref(), Some("Warning: something happened"));
    }

    #[test]
    fn blank_lines_are_dropped() {
        let (events, _) = run(Runner::Claude, &["", "   "]);
        assert!(events.is_empty());
    }

    #[test]
    fn degradation_needs_a_majority_and_a_sample() {
        assert!(!is_degraded(0, 1), "one odd line is not a schema change");
        assert!(!is_degraded(5, 3));
        assert!(is_degraded(2, 6));
    }

    #[test]
    fn plain_parser_keeps_every_line_and_the_last_one() {
        let mut p = parser_for(Runner::Shell, false);
        let mut out = vec![];
        for l in ["building", "", "done"] {
            p.parse(l, &mut out);
        }
        assert_eq!(out.len(), 3);
        assert_eq!(p.final_text().as_deref(), Some("done"));
    }

    #[test]
    fn pick_indexes_into_arrays() {
        let v: Value = serde_json::from_str(r#"{"a":{"b":[{"c":"x"}]}}"#).unwrap();
        assert_eq!(pick_str(&v, &[&["a", "b", "0", "c"]]).as_deref(), Some("x"));
        assert_eq!(pick_str(&v, &[&["a", "b", "9", "c"]]), None);
    }
}
