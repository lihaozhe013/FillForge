use serde_json::Value;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Clone, Debug, Error)]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<Value>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn validation(message: impl Into<String>, details: Value) -> Self {
        Self::new("validation_failed", message).with_details(details)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal_error", message)
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::internal(error.to_string())
    }
}
