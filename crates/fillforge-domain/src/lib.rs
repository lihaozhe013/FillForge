pub mod app;
pub mod config;
pub mod docx;
pub mod error;
pub mod extraction;
pub mod model;
pub mod paths;
pub mod runs;
pub mod storage;
pub mod template;

pub use app::AppContext;
pub use config::ConfigRepository;
pub use docx::{DocumentRenderer, RenderInput, TemplateInspection};
pub use error::{AppError, AppResult};
pub use model::*;
pub use paths::{app_paths, AppPaths};
pub use runs::{RunRepository, RunService};
pub use template::{TemplateRepository, TemplateService};
