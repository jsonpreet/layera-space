mod agents;
mod files;
mod hook;
mod memory;
mod pty;
pub mod run;
mod session;
mod skills;
mod store;

use tauri::Manager;
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Url;

#[tauri::command]
fn browser_navigate(app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    let parsed = url.parse::<Url>().map_err(|e| e.to_string())?;
    let main_wv = app
        .get_webview_window("main")
        .ok_or_else(|| "window not found".to_string())?;
    let window = main_wv.as_ref().window();
    let webview = window
        .webviews()
        .into_iter()
        .find(|w| w.label() == label)
        .ok_or_else(|| "webview not found".to_string())?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let server = hook::start(handle).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(server);

            let app_menu = SubmenuBuilder::new(app, "Layera Space")
                .item(&PredefinedMenuItem::quit(app, None)?)
                .build()?;
            let edit = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;
            let menu = MenuBuilder::new(app).items(&[&app_menu, &edit]).build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .manage(pty::PtyManager::new())
        .manage(run::RunManager::new())
        .invoke_handler(tauri::generate_handler![
            run::run_start,
            run::run_cancel,
            run::run_cancel_all,
            run::run_live,
            run::runs_reconcile,
            run::record::run_list,
            run::record::run_read_transcript,
            run::record::run_patch,
            run::record::runs_gc,
            run::git::git_root,
            run::git::git_init,
            run::git::git_show,
            run::git::git_take_files,
            run::git::git_apply,
            run::git::git_wave_base,
            run::git::git_diff_files,
            run::git::git_diff_patch,
            run::git::worktree_add,
            run::git::worktree_remove,
            run::git::worktree_list,
            run::git::worktree_commit,
            run::git::git_branch_delete,
            run::git::git_branches,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            store::store_load,
            store::store_save,
            agents::detect_agents,
            agents::detect_runners,
            hook::hook_url,
            hook::hook_status,
            hook::install_hooks,
            hook::uninstall_hooks,
            session::session_begin,
            session::list_sessions,
            session::read_session,
            files::fs_read_text,
            files::fs_write_text,
            files::fs_list_dir,
            files::fs_git_head,
            files::fs_git_head_state,
            files::workspace_data_path,
            files::fs_exists,
            files::fs_delete,
            files::fs_mkdir,
            files::fs_rename,
            memory::memory_init,
            memory::memory_index,
            memory::memory_write,
            memory::memory_delete,
            memory::memory_search,
            skills::skills_list,
            skills::skill_import_file,
            skills::skill_import_url,
            skills::skill_import_git,
            skills::skill_delete,
            skills::skill_save,
            files::kanban_fallback_path,
            browser_navigate
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Nothing spawned by the app should outlive the window.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                app.state::<run::RunManager>().kill_all();
                app.state::<pty::PtyManager>().kill_all();
            }
        });
}
