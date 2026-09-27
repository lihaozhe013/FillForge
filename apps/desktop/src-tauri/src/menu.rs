use fillforge_domain::config::resolve_locale;
use fillforge_domain::model::AppLanguageSetting;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

const REPOSITORY_URL: &str = "https://github.com/lihaozhe013/FillForge";
const USER_GUIDE_URL: &str =
    "https://github.com/lihaozhe013/FillForge/blob/main/docs/USER_GUIDE.md";
const SPECIFICATION_URL: &str = "https://github.com/lihaozhe013/FillForge/blob/main/SPEC.md";
const AI_AGENT_PROMPT_URL: &str =
    "https://github.com/lihaozhe013/FillForge/blob/main/docs/AI_AGENT_PROMPT.md";

pub fn install_menu<R: Runtime>(
    app: &AppHandle<R>,
    language: &AppLanguageSetting,
) -> tauri::Result<()> {
    let locale = resolve_locale(
        language,
        &std::env::var("LANG").unwrap_or_else(|_| "en".to_string()),
    );
    let (file, edit, view, help) = if locale == "zh-CN" {
        ("文件", "编辑", "视图", "帮助")
    } else {
        ("File", "Edit", "View", "Help")
    };
    let (guide, prompt, spec, github) = if locale == "zh-CN" {
        ("用户指南", "AI 代理提示", "项目规范", "在 GitHub 上查看")
    } else {
        (
            "User Guide",
            "AI Agent Prompt",
            "Project Specification",
            "FillForge on GitHub",
        )
    };
    let file_menu = SubmenuBuilder::new(app, file).close_window().build()?;
    let edit_menu = SubmenuBuilder::new(app, edit)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, view)
        .minimize()
        .maximize()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, help)
        .text("help_user_guide", guide)
        .text("help_ai_prompt", prompt)
        .text("help_specification", spec)
        .separator()
        .text("help_github", github)
        .build()?;
    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = SubmenuBuilder::new(app, "FillForge")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(app)
            .item(&app_menu)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&view_menu)
            .item(&help_menu)
            .build()?
    };
    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let url = match id {
        "help_user_guide" => USER_GUIDE_URL,
        "help_ai_prompt" => AI_AGENT_PROMPT_URL,
        "help_specification" => SPECIFICATION_URL,
        "help_github" => REPOSITORY_URL,
        _ => return,
    };
    if let Err(error) = app.opener().open_url(url, None::<&str>) {
        eprintln!("Could not open Help link: {error}");
    }
}
