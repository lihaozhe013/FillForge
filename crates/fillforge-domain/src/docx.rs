use crate::{AppResult, ExtractionIssue};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Debug, Default)]
pub struct TemplateInspection {
    pub placeholders: Vec<String>,
    pub unsupported_tags: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct RenderInput<'a> {
    pub document: &'a [u8],
    pub values: &'a indexmap::IndexMap<String, Value>,
}

pub trait DocumentRenderer: Send + Sync {
    fn inspect(&self, document: &[u8]) -> AppResult<TemplateInspection>;
    fn render(&self, input: RenderInput<'_>) -> AppResult<Vec<u8>>;
}

pub fn sorted_unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    values
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn placeholder_issue(issues: &[ExtractionIssue]) -> Option<Value> {
    (!issues.is_empty()).then(|| serde_json::to_value(issues).unwrap_or(Value::Null))
}
