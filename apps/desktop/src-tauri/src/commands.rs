use crate::ai::AiConnectionStore;
use crate::logger::AppLogger;
use crate::menu::install_menu;
use fillforge_domain::model::{
    AiConnectionInput, AiModelDiscoveryRequest, AiReasoningEffort, AppErrorDto, AppLanguageSetting,
    AppTheme, ClearRunsResult, CreateDocumentResult, GeneratedPrompt, ImportExtractionResult,
    ResolvedAppConfig, ReviewSaveResult, RunDeleteFailure, RunDeleteResult, RunMetadata,
    TemplateSchema, TemplateSummary,
};
use fillforge_domain::{AppContext, AppError, AppResult};
use indexmap::IndexMap;
use rfd::FileDialog;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

pub struct DesktopState {
    pub context: AppContext,
    pub logger: AppLogger,
    pub ai_connections: AiConnectionStore,
    pub active_runs: Mutex<HashSet<String>>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum IpcResult<T: Serialize> {
    Success { ok: bool, data: T },
    Failure { ok: bool, error: AppErrorDto },
}

fn respond<T: Serialize>(
    state: &DesktopState,
    feature: &str,
    operation: &str,
    result: AppResult<T>,
) -> IpcResult<T> {
    match result {
        Ok(data) => IpcResult::Success { ok: true, data },
        Err(error) => {
            state.logger.event(
                "error",
                &format!("{operation} failed: {} {}", error.code, error.message),
            );
            state.logger.feature(
                feature,
                &format!("{operation} failed: {} {}", error.code, error.message),
            );
            IpcResult::Failure {
                ok: false,
                error: AppErrorDto {
                    code: error.code,
                    message: error.message,
                    details: error.details,
                },
            }
        }
    }
}

fn parse_input<T: DeserializeOwned>(input: Option<Value>) -> AppResult<T> {
    let Some(input) = input else {
        return Err(AppError::validation(
            "Invalid request payload.",
            serde_json::json!([{"message":"Expected an input object."}]),
        ));
    };
    serde_json::from_value(input).map_err(|error| {
        AppError::validation(
            "Invalid request payload.",
            serde_json::json!([{"message":error.to_string()}]),
        )
    })
}

fn validate_template_identifier(id: &str, path: &str) -> AppResult<()> {
    let mut characters = id.chars();
    let valid = characters
        .next()
        .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        && characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '_' | '-')
        });
    if valid {
        Ok(())
    } else {
        Err(AppError::validation(
            "Invalid request payload.",
            serde_json::json!([{"path":[path],"message":"Template id must be a stable machine identifier."}]),
        ))
    }
}

fn validate_run_identifier(id: &str, path: &str) -> AppResult<()> {
    let bytes = id.as_bytes();
    let valid = bytes.len() == 26
        && bytes
            .first()
            .is_some_and(|byte| (b'0'..=b'7').contains(byte))
        && bytes[1..].iter().all(|byte| {
            matches!(*byte, b'0'..=b'9' | b'A'..=b'H' | b'J'..=b'K' | b'M'..=b'N' | b'P'..=b'T' | b'V'..=b'Z')
        });
    if valid {
        Ok(())
    } else {
        Err(AppError::validation(
            "Invalid request payload.",
            serde_json::json!([{"path":[path],"message":"Run id must be a valid ULID."}]),
        ))
    }
}

fn validate_system_path(path: &str) -> AppResult<()> {
    if path.is_empty() {
        return Err(AppError::validation(
            "Invalid request payload.",
            serde_json::json!([{"path":["path"],"message":"String must contain at least 1 character(s)"}]),
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct IdInput {
    pub id: String,
}

#[derive(Deserialize)]
pub struct TemplateSchemaInput {
    pub id: String,
    pub schema: TemplateSchema,
}

#[derive(Deserialize)]
pub struct TemplateSyncInput {
    pub id: String,
    pub schema: Option<TemplateSchema>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CreateRunInput {
    pub template_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunInput {
    pub template_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDefaultAiInput {
    pub default_connection_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ExtractionInput {
    pub id: String,
    pub raw: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewInput {
    pub id: String,
    pub final_values: IndexMap<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub theme: AppTheme,
    pub language: AppLanguageSetting,
    pub show_advanced_fields: bool,
    pub prompt_version: String,
    #[serde(default)]
    pub reasoning_effort: AiReasoningEffort,
}

#[derive(Deserialize)]
pub struct SystemPathInput {
    pub path: String,
}

async fn pick_file(
    title: String,
    filter_name: String,
    extensions: &'static [&'static str],
) -> AppResult<Option<PathBuf>> {
    tauri::async_runtime::spawn_blocking(move || {
        FileDialog::new()
            .set_title(title)
            .add_filter(&filter_name, extensions)
            .pick_file()
    })
    .await
    .map_err(|error| AppError::internal(error.to_string()))
}

async fn pick_files(
    title: String,
    filter_name: String,
    extensions: &'static [&'static str],
) -> AppResult<Option<Vec<PathBuf>>> {
    tauri::async_runtime::spawn_blocking(move || {
        FileDialog::new()
            .set_title(title)
            .add_filter(&filter_name, extensions)
            .pick_files()
    })
    .await
    .map_err(|error| AppError::internal(error.to_string()))
}

async fn save_file(
    title: String,
    filter_name: String,
    directory: PathBuf,
    filename: String,
) -> AppResult<Option<PathBuf>> {
    tauri::async_runtime::spawn_blocking(move || {
        FileDialog::new()
            .set_title(title)
            .set_directory(directory)
            .set_file_name(filename)
            .add_filter(&filter_name, &["docx"])
            .save_file()
    })
    .await
    .map_err(|error| AppError::internal(error.to_string()))
}

#[tauri::command]
pub fn templates_list(state: State<'_, DesktopState>) -> IpcResult<Vec<TemplateSummary>> {
    respond(
        &state,
        "templates",
        "templates:list",
        state.context.template_service.list_templates(),
    )
}

#[tauri::command]
pub async fn templates_import(
    state: State<'_, DesktopState>,
) -> Result<IpcResult<Option<TemplateSummary>>, ()> {
    let is_chinese = state
        .context
        .load_settings()
        .map(|c| c.language == AppLanguageSetting::ZhCn)
        .unwrap_or(false);
    let (title, filter_name) = if is_chinese {
        ("导入 DOCX 模板", "Word 文档")
    } else {
        ("Import DOCX template", "Word Documents")
    };
    let result = match pick_file(title.to_string(), filter_name.to_string(), &["docx"]).await {
        Err(error) => Err(error),
        Ok(None) => Ok(None),
        Ok(Some(path)) => match state.context.template_service.import_template(&path) {
            Err(error) => Err(error),
            Ok(schema) => state
                .context
                .template_service
                .list_templates()
                .map(|items| items.into_iter().find(|item| item.id == schema.id)),
        },
    };
    Ok(respond(&state, "templates", "templates:import", result))
}

#[tauri::command]
pub fn templates_load(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<TemplateSchema> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_template_identifier(&input.id, "id")?;
        state.context.template_service.load_template(&input.id)
    });
    respond(&state, "templates", "templates:load", result)
}

#[tauri::command]
pub fn templates_save_schema(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<()> {
    let result = parse_input::<TemplateSchemaInput>(input).and_then(|input| {
        validate_template_identifier(&input.id, "id")?;
        state
            .context
            .template_service
            .repository
            .save_schema(&input.id, &input.schema)
    });
    respond(&state, "templates", "templates:update-schema", result)
}

#[tauri::command]
pub fn templates_inspect(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<fillforge_domain::model::PlaceholderReport> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_template_identifier(&input.id, "id")?;
        state.context.template_service.inspect_template(&input.id)
    });
    respond(&state, "templates", "templates:inspect", result)
}

#[tauri::command]
pub fn templates_sync_placeholders(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<TemplateSchema> {
    let result = parse_input::<TemplateSyncInput>(input).and_then(|input| {
        validate_template_identifier(&input.id, "id")?;
        state
            .context
            .template_service
            .sync_placeholders(&input.id, input.schema)
    });
    respond(&state, "templates", "templates:sync-placeholders", result)
}

#[tauri::command]
pub fn templates_duplicate(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<TemplateSummary> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_template_identifier(&input.id, "id")?;
        state.context.template_service.duplicate_template(&input.id)
    });
    respond(&state, "templates", "templates:duplicate", result)
}

#[tauri::command]
pub fn templates_delete(state: State<'_, DesktopState>, input: Option<Value>) -> IpcResult<()> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_template_identifier(&input.id, "id")?;
        state.context.template_service.repository.delete(&input.id)
    });
    respond(&state, "templates", "templates:delete", result)
}

#[tauri::command]
pub fn templates_prompt_preview(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<Option<GeneratedPrompt>> {
    let result = parse_input::<IdInput>(input)
        .and_then(|input| {
            validate_template_identifier(&input.id, "id")?;
            state.context.template_service.load_template(&input.id)
        })
        .and_then(|template| {
            let config = state.context.load_settings()?;
            match fillforge_domain::extraction::build_extraction_prompt(
                &template,
                Some(&config.prompt_version),
            ) {
                Ok(generated) => Ok(Some(generated)),
                Err(_error) if template.fields.is_empty() => Ok(None),
                Err(error) => Err(error),
            }
        });
    respond(&state, "templates", "templates:prompt-preview", result)
}

#[tauri::command]
pub fn settings_load(state: State<'_, DesktopState>) -> IpcResult<ResolvedAppConfig> {
    respond(
        &state,
        "settings",
        "settings:load",
        state.context.load_settings(),
    )
}

#[tauri::command]
pub fn settings_save(
    app: AppHandle,
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<ResolvedAppConfig> {
    let result = parse_input::<SettingsInput>(input).and_then(|mut input| {
        input.prompt_version = input.prompt_version.trim().to_string();
        let prompt_version_length = input.prompt_version.encode_utf16().count();
        if prompt_version_length == 0 || prompt_version_length > 100 {
            return Err(AppError::validation(
                "Invalid request payload.",
                serde_json::json!([{"path":["promptVersion"],"message":"Expected 1 to 100 characters."}]),
            ));
        }
        state.context.save_settings(ResolvedAppConfig {
            theme: input.theme,
            language: input.language,
            show_advanced_fields: input.show_advanced_fields,
            prompt_version: input.prompt_version,
            reasoning_effort: input.reasoning_effort,
        })
    }).map(|config| {
            if let Err(error) = install_menu(&app, &config.language) {
                state.logger.event(
                    "warn",
                    &format!("Could not update application menu: {error}"),
                );
            }
            config
        });
    respond(&state, "settings", "settings:save", result)
}

#[tauri::command]
pub fn runs_create(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<fillforge_domain::model::RunMetadata> {
    let result = parse_input::<CreateRunInput>(input).and_then(|input| {
        validate_template_identifier(&input.template_id, "templateId")?;
        state.context.run_service.create_run(&input.template_id)
    });
    respond(&state, "runs", "runs:create", result)
}

#[tauri::command]
pub async fn runs_start_with_files(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> Result<IpcResult<Option<RunMetadata>>, ()> {
    let input = match parse_input::<StartRunInput>(input) {
        Ok(input) => input,
        Err(error) => return Ok(respond(&state, "runs", "runs:start-with-files", Err(error))),
    };
    if let Err(error) = validate_template_identifier(&input.template_id, "templateId") {
        return Ok(respond(&state, "runs", "runs:start-with-files", Err(error)));
    }
    let is_chinese = state
        .context
        .load_settings()
        .map(|config| config.language == AppLanguageSetting::ZhCn)
        .unwrap_or(false);
    let (title, filter_name) = if is_chinese {
        ("选择来源文件", "来源文件")
    } else {
        ("Choose source files", "Source files")
    };
    let result = match pick_files(
        title.to_string(),
        filter_name.to_string(),
        &["jpg", "jpeg", "png", "webp", "gif", "pdf", "txt", "md"],
    )
    .await
    {
        Err(error) => Err(error),
        Ok(None) => Ok(None),
        Ok(Some(paths)) if paths.is_empty() => Ok(None),
        Ok(Some(paths)) => {
            let mut total = 0u64;
            let mut failure = None;
            for path in &paths {
                match fs::metadata(path) {
                    Ok(metadata) if metadata.is_file() => {
                        total = total.saturating_add(metadata.len());
                        if total > 50 * 1024 * 1024 {
                            failure = Some(AppError::validation(
                                "Selected source files exceed the 50 MB combined limit.",
                                serde_json::json!({"field":"attachments"}),
                            ));
                            break;
                        }
                    }
                    _ => {
                        failure = Some(AppError::validation(
                            "A selected source is not a regular file.",
                            serde_json::json!({}),
                        ));
                        break;
                    }
                }
            }
            match failure {
                Some(error) => Err(error),
                None => (|| -> AppResult<Option<RunMetadata>> {
                    let run = state.context.run_service.create_run(&input.template_id)?;
                    let mut failure = None;
                    for path in &paths {
                        let filename = path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or("source-file");
                        if let Err(error) = state
                            .context
                            .run_service
                            .add_attachment(&run.id, path, filename)
                        {
                            failure = Some(error);
                            break;
                        }
                    }
                    if let Some(error) = failure {
                        let _ = state
                            .context
                            .run_repository
                            .delete_preserving_outputs(&run.id, &state.context.paths.exports_dir);
                        Err(error)
                    } else {
                        state
                            .context
                            .run_service
                            .get_run(&run.id)
                            .map(|details| Some(details.metadata))
                    }
                })(),
            }
        }
    };
    Ok(respond(&state, "runs", "runs:start-with-files", result))
}

#[tauri::command]
pub fn runs_list(
    state: State<'_, DesktopState>,
) -> IpcResult<Vec<fillforge_domain::model::RunSummary>> {
    respond(
        &state,
        "runs",
        "runs:list",
        state.context.run_service.list_runs(),
    )
}

#[tauri::command]
pub fn runs_load(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<fillforge_domain::model::RunDetails> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_run_identifier(&input.id, "id")?;
        state.context.run_service.get_run(&input.id)
    });
    respond(&state, "runs", "runs:load", result)
}

struct ActiveRunGuard<'a> {
    active_runs: &'a Mutex<HashSet<String>>,
    id: String,
}

impl Drop for ActiveRunGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active_runs.lock() {
            active.remove(&self.id);
        }
    }
}

fn acquire_run<'a>(state: &'a DesktopState, id: &str) -> AppResult<ActiveRunGuard<'a>> {
    acquire_active_run(&state.active_runs, id)
}

fn acquire_active_run<'a>(
    active_runs: &'a Mutex<HashSet<String>>,
    id: &str,
) -> AppResult<ActiveRunGuard<'a>> {
    let mut active = active_runs
        .lock()
        .map_err(|_| AppError::internal("Run operation state is unavailable."))?;
    if !active.insert(id.to_string()) {
        return Err(AppError::new(
            "run_busy",
            "This document is being processed. Try again when it finishes.",
        ));
    }
    Ok(ActiveRunGuard {
        active_runs,
        id: id.to_string(),
    })
}

#[tauri::command]
pub fn runs_delete(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<RunDeleteResult> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_run_identifier(&input.id, "id")?;
        acquire_run(&state, &input.id)?;
        let _active_run = acquire_run(&state, &input.id)?;
        state
            .context
            .run_repository
            .delete_preserving_outputs(&input.id, &state.context.paths.exports_dir)
    });
    respond(&state, "runs", "runs:delete", result)
}

#[tauri::command]
pub fn runs_clear_all(state: State<'_, DesktopState>) -> IpcResult<ClearRunsResult> {
    let result = state.context.run_repository.list_ids().and_then(|ids| {
        let mut summary = ClearRunsResult {
            deleted_count: 0,
            preserved_document_count: 0,
            failures: Vec::new(),
        };
        for id in ids {
            match acquire_run(&state, &id) {
                Err(error) => summary.failures.push(RunDeleteFailure {
                    id,
                    message: error.message,
                }),
                Ok(_active_run) => {
                    let deleted = state
                        .context
                        .run_repository
                        .delete_preserving_outputs(&id, &state.context.paths.exports_dir);
                    match deleted {
                        Ok(deleted) => {
                            summary.deleted_count += 1;
                            summary.preserved_document_count += deleted.preserved_document_count;
                        }
                        Err(error) => summary.failures.push(RunDeleteFailure {
                            id,
                            message: error.message,
                        }),
                    }
                }
            }
        }
        Ok(summary)
    });
    respond(&state, "runs", "runs:clear-all", result)
}

#[tauri::command]
pub async fn runs_extract_with_ai(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> Result<IpcResult<ImportExtractionResult>, ()> {
    let result = match parse_input::<IdInput>(input) {
        Ok(input) => match validate_run_identifier(&input.id, "id")
            .and_then(|_| acquire_run(&state, &input.id))
        {
            Err(error) => Err(error),
            Ok(_active_run) => {
                async {
                    let details = state.context.run_service.get_run(&input.id)?;
                    if details.extraction.is_some() {
                        return Err(AppError::new(
                            "artifact_immutable",
                            "An extraction already exists for this document.",
                        ));
                    }
                    let prompt = state.context.run_service.generate_prompt(&input.id)?;
                    let reasoning_effort = state.context.load_settings()?.reasoning_effort;
                    let raw = state
                        .ai_connections
                        .extract_run(
                            &state.context.run_repository,
                            &input.id,
                            &prompt,
                            reasoning_effort,
                        )
                        .await?;
                    state.context.run_service.import_extraction(&input.id, &raw)
                }
                .await
            }
        },
        Err(error) => Err(error),
    };
    Ok(respond(&state, "runs", "runs:extract-with-ai", result))
}

#[tauri::command]
pub fn ai_connections_list(
    state: State<'_, DesktopState>,
) -> IpcResult<fillforge_domain::model::AiConnectionList> {
    respond(
        &state,
        "ai",
        "ai-connections:list",
        state.ai_connections.list(),
    )
}

#[tauri::command]
pub fn ai_connections_save(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<fillforge_domain::model::AiConnectionList> {
    let result =
        parse_input::<AiConnectionInput>(input).and_then(|input| state.ai_connections.save(input));
    respond(&state, "ai", "ai-connections:save", result)
}

#[tauri::command]
pub fn ai_connections_delete(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<fillforge_domain::model::AiConnectionList> {
    let result =
        parse_input::<IdInput>(input).and_then(|input| state.ai_connections.delete(&input.id));
    respond(&state, "ai", "ai-connections:delete", result)
}

#[tauri::command]
pub fn ai_connections_set_default(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<fillforge_domain::model::AiConnectionList> {
    let result = parse_input::<SetDefaultAiInput>(input).and_then(|input| {
        state
            .ai_connections
            .set_default(input.default_connection_id)
    });
    respond(&state, "ai", "ai-connections:set-default", result)
}

#[tauri::command]
pub async fn ai_connections_discover_models(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> Result<IpcResult<fillforge_domain::model::ModelDiscoveryResult>, ()> {
    let result = match parse_input::<AiModelDiscoveryRequest>(input) {
        Ok(input) => state.ai_connections.discover_models(input).await,
        Err(error) => Err(error),
    };
    Ok(respond(
        &state,
        "ai",
        "ai-connections:discover-models",
        result,
    ))
}

#[tauri::command]
pub async fn ai_connections_test(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> Result<IpcResult<()>, ()> {
    let result = match parse_input::<AiModelDiscoveryRequest>(input) {
        Ok(input) => state.ai_connections.test_connection(input).await,
        Err(error) => Err(error),
    };
    Ok(respond(&state, "ai", "ai-connections:test", result))
}

#[tauri::command]
pub fn runs_generate_prompt(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<String> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_run_identifier(&input.id, "id")?;
        let _active_run = acquire_run(&state, &input.id)?;
        state.context.run_service.generate_prompt(&input.id)
    });
    respond(&state, "runs", "runs:generate-prompt", result)
}

#[tauri::command]
pub fn runs_import_extraction(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<ImportExtractionResult> {
    let result = parse_input::<ExtractionInput>(input).and_then(|input| {
        validate_run_identifier(&input.id, "id")?;
        if input.raw.is_empty() {
            return Err(AppError::validation(
                "Invalid request payload.",
                serde_json::json!([{"path":["raw"],"message":"String must contain at least 1 character(s)"}]),
            ));
        }
        if input.raw.encode_utf16().count() > 2_000_000 {
            return Err(AppError::validation(
                "Invalid request payload.",
                serde_json::json!([{"path":["raw"],"message":"Must contain at most 2000000 characters."}]),
            ));
        }
        let _active_run = acquire_run(&state, &input.id)?;
        state
            .context
            .run_service
            .import_extraction(&input.id, &input.raw)
    });
    respond(&state, "runs", "runs:import-extraction", result)
}

#[tauri::command]
pub fn runs_save_review(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<ReviewSaveResult> {
    let result = parse_input::<ReviewInput>(input).and_then(|input| {
        validate_run_identifier(&input.id, "id")?;
        let _active_run = acquire_run(&state, &input.id)?;
        state
            .context
            .run_service
            .save_review(&input.id, &input.final_values)
    });
    respond(&state, "runs", "runs:save-review", result)
}

#[tauri::command]
pub fn runs_create_document(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<CreateDocumentResult> {
    let result = parse_input::<ReviewInput>(input).and_then(|input| {
        validate_run_identifier(&input.id, "id")?;
        let _active_run = acquire_run(&state, &input.id)?;
        let saved = state
            .context
            .run_service
            .save_review(&input.id, &input.final_values)?;
        if !saved.issues.is_empty() {
            return Ok(CreateDocumentResult {
                review: saved.review,
                issues: saved.issues,
                output: None,
            });
        }
        let output = state.context.run_service.render_run(&input.id)?;
        Ok(CreateDocumentResult {
            review: saved.review,
            issues: saved.issues,
            output: Some(output),
        })
    });
    respond(&state, "runs", "runs:create-document", result)
}

#[tauri::command]
pub fn runs_normalize(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<IndexMap<String, Value>> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_run_identifier(&input.id, "id")?;
        let _active_run = acquire_run(&state, &input.id)?;
        state.context.run_service.build_normalized(&input.id)
    });
    respond(&state, "runs", "runs:normalize", result)
}

#[tauri::command]
pub fn runs_render(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<fillforge_domain::model::RenderedArtifact> {
    let result = parse_input::<IdInput>(input).and_then(|input| {
        validate_run_identifier(&input.id, "id")?;
        let _active_run = acquire_run(&state, &input.id)?;
        state.context.run_service.render_run(&input.id)
    });
    respond(&state, "runs", "runs:render", result)
}

#[tauri::command]
pub async fn runs_attach_files(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> Result<IpcResult<Option<Vec<fillforge_domain::model::AttachmentMetadata>>>, ()> {
    let input = match parse_input::<IdInput>(input) {
        Ok(input) => match validate_run_identifier(&input.id, "id") {
            Ok(()) => input,
            Err(error) => return Ok(respond(&state, "runs", "runs:attach-files", Err(error))),
        },
        Err(error) => return Ok(respond(&state, "runs", "runs:attach-files", Err(error))),
    };
    let _active_run = match acquire_run(&state, &input.id) {
        Ok(active) => active,
        Err(error) => return Ok(respond(&state, "runs", "runs:attach-files", Err(error))),
    };
    let is_chinese = state
        .context
        .load_settings()
        .map(|c| c.language == AppLanguageSetting::ZhCn)
        .unwrap_or(false);
    let (title, filter_name) = if is_chinese {
        ("附加来源材料", "证据文件")
    } else {
        ("Attach source material", "Evidence")
    };
    let result = match pick_files(
        title.to_string(),
        filter_name.to_string(),
        &["jpg", "jpeg", "png", "webp", "gif", "pdf", "txt", "md"],
    )
    .await
    {
        Err(error) => Err(error),
        Ok(None) => Ok(None),
        Ok(Some(paths)) => {
            let mut attachments = Vec::new();
            let mut failure = None;
            for path in paths {
                let filename = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("attachment")
                    .to_string();
                match state
                    .context
                    .run_service
                    .add_attachment(&input.id, &path, &filename)
                {
                    Ok(attachment) => attachments.push(attachment),
                    Err(error) => {
                        failure = Some(error);
                        break;
                    }
                }
            }
            match failure {
                Some(error) => Err(error),
                None => Ok(Some(attachments)),
            }
        }
    };
    Ok(respond(&state, "runs", "runs:attach-files", result))
}

fn require_data_file(raw: &str, data_dir: &Path, action: &str) -> AppResult<PathBuf> {
    let candidate = PathBuf::from(raw);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()?.join(candidate)
    };
    let message = format!("Only files inside the FillForge data directory can be {action}.");
    let real_root = fs::canonicalize(data_dir)
        .map_err(|_| AppError::validation(message.clone(), serde_json::json!({"path":raw})))?;
    let real_target = fs::canonicalize(&absolute)
        .map_err(|_| AppError::validation("File not found.", serde_json::json!({"path":raw})))?;
    if !real_target.starts_with(&real_root) {
        return Err(AppError::validation(
            message,
            serde_json::json!({"path":raw}),
        ));
    }
    if !fs::metadata(&real_target)?.is_file() {
        return Err(AppError::validation(
            "The selected path is not a file.",
            serde_json::json!({"path":raw}),
        ));
    }
    Ok(real_target)
}

#[tauri::command]
pub fn system_open_path(
    app: AppHandle,
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<bool> {
    let result = parse_input::<SystemPathInput>(input).and_then(|input| {
        validate_system_path(&input.path)?;
        require_data_file(&input.path, &state.context.paths.data_dir, "opened").and_then(|path| {
            app.opener()
                .open_path(path.to_string_lossy().to_string(), None::<&str>)
                .map(|_| true)
                .map_err(|error| {
                    AppError::validation(
                        "The file could not be opened.",
                        serde_json::json!({"path":path,"error":error.to_string()}),
                    )
                })
        })
    });
    respond(&state, "system", "system:open-path", result)
}

#[tauri::command]
pub fn system_show_item_in_folder(
    app: AppHandle,
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> IpcResult<()> {
    let result = parse_input::<SystemPathInput>(input).and_then(|input| {
        validate_system_path(&input.path)?;
        require_data_file(&input.path, &state.context.paths.data_dir, "revealed").and_then(|path| {
            app.opener().reveal_item_in_dir(path).map_err(|error| {
                AppError::validation(
                    "The file could not be revealed.",
                    serde_json::json!({"path":input.path,"error":error.to_string()}),
                )
            })
        })
    });
    respond(&state, "system", "system:show-item-in-folder", result)
}

#[tauri::command]
pub async fn system_export_copy(
    state: State<'_, DesktopState>,
    input: Option<Value>,
) -> Result<IpcResult<Option<String>>, ()> {
    let input = match parse_input::<SystemPathInput>(input) {
        Ok(input) => match validate_system_path(&input.path) {
            Ok(()) => input,
            Err(error) => return Ok(respond(&state, "system", "system:export-copy", Err(error))),
        },
        Err(error) => return Ok(respond(&state, "system", "system:export-copy", Err(error))),
    };
    let result = match require_data_file(&input.path, &state.context.paths.data_dir, "exported") {
        Err(error) => Err(error),
        Ok(source) => {
            let filename = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("result.docx")
                .to_string();
            let is_chinese = state
                .context
                .load_settings()
                .map(|c| c.language == AppLanguageSetting::ZhCn)
                .unwrap_or(false);
            let (title, filter_name) = if is_chinese {
                ("导出 Word 文档副本", "Word 文档")
            } else {
                ("Export Word document copy", "Word Documents")
            };
            match save_file(
                title.to_string(),
                filter_name.to_string(),
                state.context.paths.exports_dir.clone(),
                filename,
            )
            .await
            {
                Err(error) => Err(error),
                Ok(None) => Ok(None),
                Ok(Some(target)) => match fs::copy(&source, &target) {
                    Ok(_) => Ok(Some(target.to_string_lossy().into_owned())),
                    Err(error) => Err(AppError::new("internal_error", error.to_string())),
                },
            }
        }
    };
    Ok(respond(&state, "system", "system:export-copy", result))
}

#[tauri::command]
pub fn system_open_saved_documents(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> IpcResult<()> {
    let directory = state.context.paths.exports_dir.join("preserved-runs");
    let result = fs::create_dir_all(&directory)
        .map_err(AppError::from)
        .and_then(|_| {
            app.opener()
                .open_path(directory.to_string_lossy().to_string(), None::<&str>)
                .map_err(|_| {
                    AppError::new(
                        "open_saved_documents_failed",
                        "The saved documents folder could not be opened.",
                    )
                })
        });
    respond(&state, "system", "system:open-saved-documents", result)
}

#[cfg(test)]
mod active_run_tests {
    use super::acquire_active_run;
    use std::collections::HashSet;
    use std::sync::Mutex;

    #[test]
    fn processing_run_cannot_be_acquired_twice_and_releases_on_drop() {
        let active_runs = Mutex::new(HashSet::new());
        let active = acquire_active_run(&active_runs, "01K5A000000000000000000000")
            .expect("acquire active run");

        let error = match acquire_active_run(&active_runs, "01K5A000000000000000000000") {
            Err(error) => error,
            Ok(_guard) => panic!("duplicate operation should be rejected"),
        };
        assert_eq!(error.code, "run_busy");

        drop(active);
        assert!(acquire_active_run(&active_runs, "01K5A000000000000000000000").is_ok());
    }
}
