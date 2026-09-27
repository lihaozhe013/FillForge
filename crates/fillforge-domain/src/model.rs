use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum FieldType {
    String,
    Number,
    Date,
    Boolean,
}

impl Default for FieldType {
    fn default() -> Self {
        Self::String
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(rename_all = "camelCase")]
pub struct FieldExtraction {
    pub instruction: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(rename_all = "snake_case")]
pub struct FieldNormalization {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub trim: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub remove_spaces: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(rename_all = "snake_case")]
pub struct FieldValidation {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub regex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub minimum: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub maximum: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub date_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub r#enum: Option<Vec<String>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct FieldOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub format: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct FieldDefinition {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub field_type: FieldType,
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub extraction: Option<FieldExtraction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub normalization: Option<FieldNormalization>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub validation: Option<FieldValidation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub output: Option<FieldOutput>,
}

impl Default for FieldDefinition {
    fn default() -> Self {
        Self {
            label: String::new(),
            description: None,
            field_type: FieldType::default(),
            required: true,
            extraction: None,
            normalization: None,
            validation: None,
            output: None,
        }
    }
}

pub type FieldDefinitions = IndexMap<String, FieldDefinition>;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct TemplateBinding {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transform: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct TemplateDocument {
    pub file: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct TemplateSchema {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub document: TemplateDocument,
    pub fields: FieldDefinitions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bindings: Option<IndexMap<String, TemplateBinding>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TemplateSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub has_document: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PlaceholderReport {
    pub placeholders: Vec<String>,
    pub unconfigured: Vec<String>,
    pub unreferenced: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unsupported_tags: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AppLanguageSetting {
    System,
    En,
    #[serde(rename = "zh-CN")]
    #[ts(rename = "zh-CN")]
    ZhCn,
}

impl Default for AppLanguageSetting {
    fn default() -> Self {
        Self::System
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum AppTheme {
    System,
    Light,
    Dark,
}

impl Default for AppTheme {
    fn default() -> Self {
        Self::System
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct AppConfig {
    pub schema_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ui: Option<UiConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub editor: Option<EditorConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub extraction: Option<ExtractionConfig>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct UiConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub theme: Option<AppTheme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub language: Option<AppLanguageSetting>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct EditorConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub show_advanced_fields: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct ExtractionConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prompt_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reasoning_effort: Option<AiReasoningEffort>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[ts(rename_all = "kebab-case")]
pub enum AiReasoningEffort {
    #[default]
    Default,
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ResolvedAppConfig {
    pub theme: AppTheme,
    pub language: AppLanguageSetting,
    pub show_advanced_fields: bool,
    pub prompt_version: String,
    pub reasoning_effort: AiReasoningEffort,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[ts(rename_all = "kebab-case")]
pub enum AiProtocol {
    Responses,
    ChatCompletions,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AiModelProfile {
    pub id: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AiConnectionInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    pub name: String,
    pub protocol: AiProtocol,
    pub base_url: String,
    pub models: Vec<AiModelProfile>,
    pub default_model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub remove_api_key: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AiConnectionSummary {
    pub id: String,
    pub name: String,
    pub protocol: AiProtocol,
    pub base_url: String,
    pub models: Vec<AiModelProfile>,
    pub default_model: String,
    pub has_api_key: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AiConnectionList {
    pub connections: Vec<AiConnectionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default_connection_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AiModelDiscoveryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub protocol: Option<AiProtocol>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub api_key: Option<String>,
    #[serde(default = "use_saved_key_by_default")]
    pub use_saved_api_key: bool,
}

fn use_saved_key_by_default() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ModelDiscoverySource {
    Catalog,
    ValidatedModel,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ModelDiscoveryResult {
    pub models: Vec<String>,
    pub truncated: bool,
    pub source: ModelDiscoverySource,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RunDeleteResult {
    pub preserved_document_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub preserved_directory: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CreateDocumentResult {
    pub review: ReviewedRecord,
    pub issues: Vec<ExtractionIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub output: Option<RenderedArtifact>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RunDeleteFailure {
    pub id: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ClearRunsResult {
    pub deleted_count: usize,
    pub preserved_document_count: usize,
    pub failures: Vec<RunDeleteFailure>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ExtractionStatus {
    Found,
    NotFound,
    Ambiguous,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct ExtractedField {
    pub value: Value,
    pub status: ExtractionStatus,
    pub evidence: Option<String>,
}
pub type ExtractionResult = IndexMap<String, ExtractedField>;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct PersistedExtraction {
    pub schema_version: u32,
    pub result: ExtractionResult,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct AttachmentMetadata {
    pub filename: String,
    pub original_filename: String,
    pub media_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct RunMetadata {
    pub schema_version: u32,
    pub id: String,
    pub created_at: String,
    pub template_id: String,
    pub template_schema_version: u32,
    pub prompt_version: String,
    #[serde(default)]
    pub attachments: Vec<AttachmentMetadata>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RunArtifacts {
    pub prompt: bool,
    pub extraction: bool,
    pub review: bool,
    pub normalized: bool,
    pub output: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub created_at: String,
    pub template_id: String,
    pub artifacts: RunArtifacts,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ReviewDecision {
    Accepted,
    Corrected,
    Rejected,
    FilledManually,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct ReviewedField {
    pub model_value: Value,
    pub final_value: Value,
    pub decision: ReviewDecision,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct ReviewedRecord {
    pub schema_version: u32,
    pub fields: IndexMap<String, ReviewedField>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct NormalizedRecord {
    pub schema_version: u32,
    pub values: IndexMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ExtractionIssue {
    pub field: String,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message_args: Option<IndexMap<String, String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RenderedArtifact {
    pub path: String,
    pub filename: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GeneratedPrompt {
    pub prompt: String,
    pub expected_json: String,
    pub prompt_version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RunOutput {
    pub filename: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RunDetails {
    pub metadata: RunMetadata,
    pub prompt: Option<String>,
    pub expected_json: Option<String>,
    pub extraction: Option<ExtractionResult>,
    pub review: Option<ReviewedRecord>,
    pub normalized: Option<IndexMap<String, Value>>,
    pub outputs: Vec<RunOutput>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AppErrorDto {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub details: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ImportExtractionResult {
    pub result: ExtractionResult,
    pub issues: Vec<ExtractionIssue>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ReviewSaveResult {
    pub review: ReviewedRecord,
    pub issues: Vec<ExtractionIssue>,
}
