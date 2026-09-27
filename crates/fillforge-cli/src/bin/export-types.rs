use fillforge_domain::model::*;
use std::fs;
use std::path::PathBuf;
use ts_rs::{Config, TS};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let target = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("apps/desktop/src/lib/generated-types.ts"));
    let config = Config::default();
    let mut declarations = Vec::new();
    macro_rules! add_type { ($($ty:ty),+ $(,)?) => { $(declarations.push(format!("export {}", <$ty>::decl(&config)));)+ }; }
    add_type!(
        FieldType,
        FieldExtraction,
        FieldNormalization,
        FieldValidation,
        FieldOutput,
        FieldDefinition,
        TemplateBinding,
        TemplateDocument,
        TemplateSchema,
        TemplateSummary,
        PlaceholderReport,
        AppLanguageSetting,
        AppTheme,
        AppConfig,
        UiConfig,
        EditorConfig,
        ExtractionConfig,
        ResolvedAppConfig,
        AiProtocol,
        AiModelProfile,
        AiConnectionInput,
        AiConnectionSummary,
        AiConnectionList,
        AiModelDiscoveryRequest,
        ModelDiscoverySource,
        ModelDiscoveryResult,
        RunDeleteResult,
        CreateDocumentResult,
        RunDeleteFailure,
        ClearRunsResult,
        ExtractionStatus,
        ExtractedField,
        PersistedExtraction,
        AttachmentMetadata,
        RunMetadata,
        RunArtifacts,
        RunSummary,
        ReviewDecision,
        ReviewedField,
        ReviewedRecord,
        NormalizedRecord,
        ExtractionIssue,
        RenderedArtifact,
        GeneratedPrompt,
        RunOutput,
        RunDetails,
        AppErrorDto,
        ImportExtractionResult,
        ReviewSaveResult
    );
    let mut output = String::from("// Generated from Rust domain types by `cargo run -p fillforge-cli --bin export-types`. Do not edit manually.\n\nexport type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };\n\n");
    output.push_str(&declarations.join("\n\n"));
    output.push_str("\n\nexport type ExtractionResult = PersistedExtraction['result'];\n");
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target, output)?;
    Ok(())
}
