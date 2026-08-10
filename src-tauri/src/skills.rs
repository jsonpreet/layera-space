use crate::files::write_atomic;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub path: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub content: String,
}

pub fn skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("skills");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Read the `name:`/`description:` keys out of YAML-ish frontmatter.
///
/// Deliberately not a YAML parser: a skill is a markdown file with at most a
/// handful of flat keys, and an unparseable header should degrade to a usable
/// skill rather than an error.
fn frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let mut name = None;
    let mut description = None;
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (name, description);
    }
    for line in trimmed.lines().skip(1) {
        let line = line.trim();
        if line == "---" {
            break;
        }
        if let Some(rest) = line.strip_prefix("name:") {
            name = Some(rest.trim().trim_matches(['"', '\'']).to_string());
        } else if let Some(rest) = line.strip_prefix("description:") {
            description = Some(rest.trim().trim_matches(['"', '\'']).to_string());
        }
    }
    (name, description)
}

fn read_skill(path: &std::path::Path, source: &str) -> Option<Skill> {
    let content = std::fs::read_to_string(path).ok()?;
    let stem = path.file_stem()?.to_string_lossy().to_string();
    let (name, description) = frontmatter(&content);
    Some(Skill {
        id: stem.clone(),
        path: path.to_string_lossy().to_string(),
        name: name.unwrap_or_else(|| stem.clone()),
        description: description.unwrap_or_default(),
        source: source.to_string(),
        content,
    })
}

/// Copy the skills bundled with the app into the user's library on first run.
///
/// Only ever fills gaps: a bundled skill the user edited or deleted is left
/// alone rather than being restored on every launch.
pub fn seed_bundled(app: &AppHandle) -> Result<(), String> {
    let dir = skills_dir(app)?;
    let marker = dir.join(".seeded");
    if marker.exists() {
        return Ok(());
    }
    if let Ok(resources) = app.path().resource_dir() {
        let source = resources.join("resources").join("skills");
        if let Ok(entries) = std::fs::read_dir(&source) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                let target = dir.join(entry.file_name());
                if !target.exists() {
                    let _ = std::fs::copy(&path, &target);
                }
            }
        }
    }
    let _ = std::fs::write(&marker, "");
    Ok(())
}

#[tauri::command]
pub fn skills_list(app: AppHandle) -> Result<Vec<Skill>, String> {
    let dir = skills_dir(&app)?;
    let _ = seed_bundled(&app);
    let mut out = vec![];
    for entry in WalkDir::new(&dir).max_depth(3).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let source = path
            .strip_prefix(&dir)
            .ok()
            .and_then(|p| p.parent())
            .map(|p| p.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "local".to_string());
        if let Some(skill) = read_skill(path, &source) {
            out.push(skill);
        }
    }
    out.sort_by_key(|s| s.name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub fn skill_import_file(app: AppHandle, path: String) -> Result<Skill, String> {
    let source = std::path::Path::new(&path);
    let content = std::fs::read_to_string(source).map_err(|e| e.to_string())?;
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "not a file".to_string())?;
    let target = skills_dir(&app)?.join(&name);
    write_atomic(&target, &content)?;
    read_skill(&target, "local").ok_or_else(|| "could not read the imported skill".to_string())
}

/// Fetch over HTTP by shelling out to curl.
///
/// Avoids adding an HTTP client and a network capability for one feature; curl
/// is already a dependency of the completion-notify script, and ships with
/// Windows 10 1803+.
#[tauri::command]
pub fn skill_import_url(app: AppHandle, url: String) -> Result<Skill, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http and https URLs can be imported.".to_string());
    }
    let out = Command::new("curl")
        .args(["-fsSL", "--max-time", "20", &url])
        .output()
        .map_err(|e| format!("curl could not run: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Download failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let content = String::from_utf8_lossy(&out.stdout).to_string();
    if content.trim().is_empty() {
        return Err("That URL returned nothing.".to_string());
    }
    let stem = url
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or("skill")
        .split('?')
        .next()
        .unwrap_or("skill")
        .trim_end_matches(".md")
        .to_string();
    let target = skills_dir(&app)?.join(format!("{stem}.md"));
    write_atomic(&target, &content)?;
    read_skill(&target, "url").ok_or_else(|| "could not read the imported skill".to_string())
}

#[tauri::command]
pub fn skill_import_git(app: AppHandle, url: String) -> Result<Vec<Skill>, String> {
    let dir = skills_dir(&app)?;
    let name = url
        .trim_end_matches(".git")
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or("repo")
        .to_string();
    let target = dir.join(&name);
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    let out = Command::new("git")
        .args(["clone", "--depth", "1", &url, &target.to_string_lossy()])
        .output()
        .map_err(|e| format!("git could not run: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    // Nothing from the clone should be executed, and its history is noise.
    let _ = std::fs::remove_dir_all(target.join(".git"));
    skills_list(app).map(|all| all.into_iter().filter(|s| s.source == name).collect())
}

#[tauri::command]
pub fn skill_delete(app: AppHandle, path: String) -> Result<(), String> {
    let dir = skills_dir(&app)?;
    let target = std::path::Path::new(&path);
    // Only ever delete inside the skills directory.
    if !target.starts_with(&dir) {
        return Err("That file is outside the skills library.".to_string());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(target).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn skill_save(app: AppHandle, id: String, content: String) -> Result<Skill, String> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("invalid skill id".to_string());
    }
    let target = skills_dir(&app)?.join(format!("{id}.md"));
    write_atomic(&target, &content)?;
    read_skill(&target, "local").ok_or_else(|| "could not read the skill".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_flat_frontmatter_keys() {
        let (name, description) = frontmatter(
            "---\nname: Code review\ndescription: Reviews a diff carefully\ntags: [a, b]\n---\n\nBody",
        );
        assert_eq!(name.as_deref(), Some("Code review"));
        assert_eq!(description.as_deref(), Some("Reviews a diff carefully"));
    }

    #[test]
    fn strips_surrounding_quotes() {
        let (name, _) = frontmatter("---\nname: \"Quoted\"\n---\n");
        assert_eq!(name.as_deref(), Some("Quoted"));
    }

    #[test]
    fn a_skill_without_frontmatter_is_still_valid() {
        let (name, description) = frontmatter("# Just markdown\n\nDo the thing.");
        assert!(name.is_none());
        assert!(description.is_none());
    }

    #[test]
    fn stops_at_the_closing_delimiter() {
        // A `name:` in the body must not be mistaken for metadata.
        let (name, _) = frontmatter("---\nname: Real\n---\n\nname: not metadata\n");
        assert_eq!(name.as_deref(), Some("Real"));
    }
}
