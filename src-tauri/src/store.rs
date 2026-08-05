use std::fs;
use std::io::Write;
use tauri::{AppHandle, Manager};

fn store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("store.json"))
}

#[tauri::command]
pub fn store_load(app: AppHandle) -> Result<String, String> {
    let path = store_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(_) => Ok("{}".to_string()),
    }
}

#[tauri::command]
pub fn store_save(app: AppHandle, json: String) -> Result<(), String> {
    let path = store_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}
