mod ai;
mod commands;
mod logger;
mod menu;

use commands::DesktopState;
use fillforge_docx::RustDocxRenderer;
use fillforge_domain::paths::{app_paths, ensure_app_directories};
use fillforge_domain::AppContext;
use logger::AppLogger;
use std::sync::Arc;

pub fn run() {
    let paths = app_paths();
    let logger = AppLogger::new(&paths.logs_dir);
    if let Err(error) = ensure_app_directories(&paths) {
        logger.event("error", &format!("Startup failed: {error}"));
        return;
    }
    let context = match AppContext::create_with_paths(paths, Arc::new(RustDocxRenderer)) {
        Ok(context) => context,
        Err(error) => {
            logger.event(
                "error",
                &format!("Startup failed: {} {}", error.code, error.message),
            );
            return;
        }
    };
    logger.event(
        "info",
        &format!("Data directory: {}", context.paths.data_dir.display()),
    );
    logger.event(
        "info",
        &format!("Log directory: {}", logger.base_dir().display()),
    );
    let startup_language = context
        .load_settings()
        .map(|config| config.language)
        .unwrap_or_default();
    let panic_logger = logger.clone();
    std::panic::set_hook(Box::new(move |info| {
        panic_logger.event("error", &format!("Unhandled panic: {info}"));
    }));
    let ai_connections = ai::AiConnectionStore::new(&context.paths.config_dir);
    let state = DesktopState {
        context,
        logger,
        ai_connections,
        active_runs: std::sync::Mutex::new(std::collections::HashSet::new()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(move |app| {
            menu::install_menu(&app.handle(), &startup_language)?;
            Ok(())
        })
        .on_menu_event(|app, event| menu::handle_menu_event(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            commands::templates_list,
            commands::templates_import,
            commands::templates_load,
            commands::templates_save_schema,
            commands::templates_inspect,
            commands::templates_sync_placeholders,
            commands::templates_duplicate,
            commands::templates_delete,
            commands::templates_prompt_preview,
            commands::settings_load,
            commands::settings_save,
            commands::runs_create,
            commands::runs_start_with_files,
            commands::runs_list,
            commands::runs_load,
            commands::runs_delete,
            commands::runs_clear_all,
            commands::runs_generate_prompt,
            commands::runs_extract_with_ai,
            commands::runs_import_extraction,
            commands::runs_save_review,
            commands::runs_create_document,
            commands::runs_normalize,
            commands::runs_render,
            commands::runs_attach_files,
            commands::ai_connections_list,
            commands::ai_connections_save,
            commands::ai_connections_delete,
            commands::ai_connections_set_default,
            commands::ai_connections_discover_models,
            commands::ai_connections_test,
            commands::system_open_path,
            commands::system_show_item_in_folder,
            commands::system_export_copy,
            commands::system_open_saved_documents,
        ])
        .run(tauri::generate_context!())
        .expect("FillForge desktop runtime failed");
}
