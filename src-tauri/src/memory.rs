use crate::files::write_atomic;
use regex::Regex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

/// The vault layout. Each folder is a kind of memory an agent can be handed.
pub const DIRS: [&str; 5] = ["context", "tasks", "handoffs", "decisions", "bugs"];

const README: &str = r#"# Layera memory

Markdown notes this project's agents can be given as context.

- `context/`   — how this project works: architecture, conventions, gotchas
- `tasks/`     — what is in flight
- `handoffs/`  — what one agent leaves for the next
- `decisions/` — choices made, and why
- `bugs/`      — known problems and their shape

Link notes with `[[note-name]]`. Links are indexed and drawn as a graph, and
linked notes are pulled in alongside whatever you mention explicitly.

These are plain files. Edit them in any editor; commit them with the project.
"#;

fn link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\]\[]+)\]\]").unwrap())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub path: String,
    /// Path relative to the vault root, e.g. `context/architecture.md`.
    pub rel: String,
    pub dir: String,
    /// Slug used by wiki-links: the file name without its extension.
    pub name: String,
    pub title: String,
    pub links: Vec<String>,
    pub modified: u64,
    pub size: u64,
    pub excerpt: String,
}

pub fn vault_dir(folder: &str) -> PathBuf {
    Path::new(folder).join(".layera").join("memory")
}

#[tauri::command]
pub fn memory_init(folder: String) -> Result<String, String> {
    let root = vault_dir(&folder);
    for dir in DIRS {
        std::fs::create_dir_all(root.join(dir)).map_err(|e| e.to_string())?;
    }
    let readme = root.join("README.md");
    if !readme.exists() {
        write_atomic(&readme, README)?;
    }
    Ok(root.to_string_lossy().to_string())
}

fn title_of(content: &str, fallback: &str) -> String {
    for line in content.lines().take(20) {
        if let Some(rest) = line.trim().strip_prefix("# ") {
            if !rest.trim().is_empty() {
                return rest.trim().to_string();
            }
        }
    }
    fallback.to_string()
}

fn excerpt_of(content: &str) -> String {
    let text: String = content
        .lines()
        .filter(|l| !l.trim().starts_with('#') && !l.trim().is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");
    text.chars().take(180).collect()
}

/// Index every note in the vault, extracting `[[wiki-links]]`.
///
/// Link extraction happens here rather than in the UI so indexing 500 notes
/// costs one call instead of 500 round trips across the IPC boundary.
#[tauri::command]
pub fn memory_index(folder: String) -> Result<Vec<Note>, String> {
    let root = vault_dir(&folder);
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut notes = vec![];

    for entry in WalkDir::new(&root)
        .max_depth(3)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if name == "README" {
            continue;
        }
        let dir = rel.split('/').next().unwrap_or("").to_string();
        let dir = if dir == rel { String::new() } else { dir };

        let links: Vec<String> = link_re()
            .captures_iter(&content)
            .map(|c| c[1].trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();

        let meta = entry.metadata().ok();
        notes.push(Note {
            path: path.to_string_lossy().to_string(),
            rel,
            dir,
            title: title_of(&content, &name),
            name,
            links,
            modified: meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
            size: meta.map(|m| m.len()).unwrap_or(0),
            excerpt: excerpt_of(&content),
        });
    }

    notes.sort_by_key(|n| std::cmp::Reverse(n.modified));
    Ok(notes)
}

#[tauri::command]
pub fn memory_write(folder: String, rel: String, content: String) -> Result<String, String> {
    if rel.contains("..") {
        return Err("invalid note path".to_string());
    }
    let path = vault_dir(&folder).join(&rel);
    write_atomic(&path, &content)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn memory_delete(folder: String, rel: String) -> Result<(), String> {
    if rel.contains("..") {
        return Err("invalid note path".to_string());
    }
    let path = vault_dir(&folder).join(&rel);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub rel: String,
    pub title: String,
    pub line: usize,
    pub text: String,
}

#[tauri::command]
pub fn memory_search(folder: String, query: String) -> Result<Vec<SearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(vec![]);
    }
    let notes = memory_index(folder)?;
    let mut hits = vec![];
    for note in notes {
        let Ok(content) = std::fs::read_to_string(&note.path) else {
            continue;
        };
        for (i, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                hits.push(SearchHit {
                    rel: note.rel.clone(),
                    title: note.title.clone(),
                    line: i + 1,
                    text: line.trim().chars().take(160).collect(),
                });
                if hits.len() > 200 {
                    return Ok(hits);
                }
            }
        }
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_wiki_links() {
        let text = "See [[architecture]] and [[the parser]].\nNot a [link](url).";
        let found: Vec<String> = link_re()
            .captures_iter(text)
            .map(|c| c[1].to_string())
            .collect();
        assert_eq!(found, vec!["architecture", "the parser"]);
    }

    #[test]
    fn ignores_single_brackets_and_empty_links() {
        let text = "[not a link] and [[]] and [[ok]]";
        let found: Vec<String> = link_re()
            .captures_iter(text)
            .map(|c| c[1].to_string())
            .filter(|s| !s.trim().is_empty())
            .collect();
        assert_eq!(found, vec!["ok"]);
    }

    #[test]
    fn title_prefers_the_first_heading() {
        assert_eq!(title_of("# Real title\n\nbody", "fallback"), "Real title");
        assert_eq!(title_of("no heading here", "fallback"), "fallback");
        // An empty heading is not a title.
        assert_eq!(title_of("# \n# Second", "fallback"), "Second");
    }

    #[test]
    fn excerpt_skips_headings_and_blank_lines() {
        let text = "# Title\n\n\nFirst line.\nSecond line.";
        let excerpt = excerpt_of(text);
        assert!(excerpt.starts_with("First line."));
        assert!(!excerpt.contains('#'));
    }
}
