use crate::config::{config_from_resolved, ConfigRepository};
use crate::docx::DocumentRenderer;
use crate::error::AppResult;
use crate::model::{AppConfig, ResolvedAppConfig};
use crate::paths::{app_paths, ensure_app_directories, AppPaths};
use crate::{RunRepository, RunService, TemplateRepository, TemplateService};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppContext {
    pub paths: AppPaths,
    pub config_repository: ConfigRepository,
    pub template_service: Arc<TemplateService>,
    pub run_repository: Arc<RunRepository>,
    pub run_service: RunService,
}

impl AppContext {
    pub fn create_default(renderer: Arc<dyn DocumentRenderer>) -> AppResult<Self> {
        Self::create_with_paths(app_paths(), renderer)
    }

    pub fn create_with_paths(
        paths: AppPaths,
        renderer: Arc<dyn DocumentRenderer>,
    ) -> AppResult<Self> {
        ensure_app_directories(&paths)?;
        let config_repository = ConfigRepository::new(&paths.config_file);
        let config = config_repository.load_resolved()?;
        let template_repository = Arc::new(TemplateRepository::new(&paths.templates_dir));
        let template_service =
            Arc::new(TemplateService::new(template_repository, renderer.clone()));
        let run_repository = Arc::new(RunRepository::new(&paths.runs_dir));
        let run_service = RunService::new(
            run_repository.clone(),
            template_service.clone(),
            renderer,
            config.prompt_version,
        );
        Ok(Self {
            paths,
            config_repository,
            template_service,
            run_repository,
            run_service,
        })
    }

    pub fn load_settings(&self) -> AppResult<ResolvedAppConfig> {
        self.config_repository.load_resolved()
    }

    pub fn save_settings(&self, value: ResolvedAppConfig) -> AppResult<ResolvedAppConfig> {
        self.config_repository.save(&config_from_resolved(&value))?;
        let resolved = self.config_repository.load_resolved()?;
        self.run_service
            .set_prompt_version(resolved.prompt_version.clone());
        Ok(resolved)
    }

    pub fn load_raw_config(&self) -> AppResult<AppConfig> {
        self.config_repository.load()
    }
}
