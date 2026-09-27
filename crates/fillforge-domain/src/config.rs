use crate::error::{AppError, AppResult};
use crate::model::{
    AppConfig, AppLanguageSetting, AppTheme, EditorConfig, ExtractionConfig, ResolvedAppConfig,
    UiConfig,
};
use crate::storage::{read_yaml, write_yaml};
use std::path::{Path, PathBuf};

pub const DEFAULT_PROMPT_VERSION: &str = "fillforge-extraction-v1";

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            ui: None,
            editor: None,
            extraction: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ConfigRepository {
    config_file: PathBuf,
}

impl ConfigRepository {
    pub fn new(config_file: impl AsRef<Path>) -> Self {
        Self {
            config_file: config_file.as_ref().to_path_buf(),
        }
    }

    pub fn load(&self) -> AppResult<AppConfig> {
        if !self.config_file.exists() {
            return Ok(AppConfig::default());
        }
        let config: AppConfig = read_yaml(&self.config_file).map_err(|error| {
            AppError::new("invalid_config", "The YAML file could not be parsed.")
                .with_details(serde_json::json!({"cause": error.message}))
        })?;
        if config.schema_version != 1 {
            return Err(AppError::new("unsupported_schema_version", format!("config.yaml uses schema version {}, but this application only supports version 1.", config.schema_version)));
        }
        if let Some(version) = config
            .extraction
            .as_ref()
            .and_then(|e| e.prompt_version.as_ref())
        {
            let length = version.encode_utf16().count();
            if length == 0 || length > 100 {
                return Err(AppError::new("invalid_config", "The FillForge configuration is invalid.").with_details(serde_json::json!([{"path":["extraction","prompt_version"],"message":"Expected 1 to 100 characters."}])));
            }
        }
        Ok(config)
    }

    pub fn save(&self, config: &AppConfig) -> AppResult<()> {
        if config.schema_version != 1 {
            return Err(AppError::new(
                "invalid_config",
                "The FillForge configuration is invalid.",
            ));
        }
        if let Some(version) = config
            .extraction
            .as_ref()
            .and_then(|e| e.prompt_version.as_ref())
        {
            let length = version.encode_utf16().count();
            if length == 0 || length > 100 {
                return Err(AppError::new(
                    "invalid_config",
                    "Prompt version must contain 1 to 100 characters.",
                ));
            }
        }
        write_yaml(&self.config_file, config)
    }

    pub fn load_resolved(&self) -> AppResult<ResolvedAppConfig> {
        Ok(resolve_config(&self.load()?))
    }
}

pub fn resolve_config(config: &AppConfig) -> ResolvedAppConfig {
    ResolvedAppConfig {
        theme: config
            .ui
            .as_ref()
            .and_then(|ui| ui.theme.clone())
            .unwrap_or(AppTheme::System),
        language: config
            .ui
            .as_ref()
            .and_then(|ui| ui.language.clone())
            .unwrap_or(AppLanguageSetting::System),
        show_advanced_fields: config
            .editor
            .as_ref()
            .and_then(|editor| editor.show_advanced_fields)
            .unwrap_or(false),
        prompt_version: config
            .extraction
            .as_ref()
            .and_then(|extract| extract.prompt_version.clone())
            .unwrap_or_else(|| DEFAULT_PROMPT_VERSION.to_string()),
    }
}

pub fn config_from_resolved(value: &ResolvedAppConfig) -> AppConfig {
    AppConfig {
        schema_version: 1,
        ui: Some(UiConfig {
            theme: Some(value.theme.clone()),
            language: Some(value.language.clone()),
        }),
        editor: Some(EditorConfig {
            show_advanced_fields: Some(value.show_advanced_fields),
        }),
        extraction: Some(ExtractionConfig {
            prompt_version: Some(value.prompt_version.clone()),
        }),
    }
}

pub fn resolve_locale(language: &AppLanguageSetting, system_locale: &str) -> &'static str {
    match language {
        AppLanguageSetting::En => "en",
        AppLanguageSetting::ZhCn => "zh-CN",
        AppLanguageSetting::System if system_locale.to_lowercase().starts_with("zh") => "zh-CN",
        AppLanguageSetting::System => "en",
    }
}
