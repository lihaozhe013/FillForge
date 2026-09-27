// Generated from Rust domain types by `cargo run -p fillforge-cli --bin export-types`. Do not edit manually.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type FieldType = "string" | "number" | "date" | "boolean";

export type FieldExtraction = { instruction: string, };

export type FieldNormalization = { trim?: boolean, remove_spaces?: boolean, };

export type FieldValidation = { regex?: string, minimum?: number, maximum?: number, date_format?: string, enum?: Array<string>, };

export type FieldOutput = { format?: string, };

export type FieldDefinition = { label: string, description?: string, type: FieldType, required: boolean, extraction?: FieldExtraction, normalization?: FieldNormalization, validation?: FieldValidation, output?: FieldOutput, };

export type TemplateBinding = { source: string, transform?: string, };

export type TemplateDocument = { file: string, };

export type TemplateSchema = { schema_version: number, id: string, name: string, description?: string, document: TemplateDocument, fields: { [key in string]: FieldDefinition }, bindings?: { [key in string]: TemplateBinding }, };

export type TemplateSummary = { id: string, name: string, description?: string, hasDocument: boolean, };

export type PlaceholderReport = { placeholders: Array<string>, unconfigured: Array<string>, unreferenced: Array<string>, unsupportedTags?: Array<string>, };

export type AppLanguageSetting = "system" | "en" | "zh-CN";

export type AppTheme = "system" | "light" | "dark";

export type AppConfig = { schema_version: number, ui?: UiConfig, editor?: EditorConfig, extraction?: ExtractionConfig, };

export type UiConfig = { theme?: AppTheme, language?: AppLanguageSetting, };

export type EditorConfig = { show_advanced_fields?: boolean, };

export type ExtractionConfig = { prompt_version?: string, reasoning_effort?: AiReasoningEffort, };

export type AiReasoningEffort = "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ResolvedAppConfig = { theme: AppTheme, language: AppLanguageSetting, showAdvancedFields: boolean, promptVersion: string, reasoningEffort: AiReasoningEffort, };

export type AiProtocol = "responses" | "chat-completions";

export type AiModelProfile = { id: string, model: string, label?: string, };

export type AiConnectionInput = { id?: string, name: string, protocol: AiProtocol, baseUrl: string, models: Array<AiModelProfile>, defaultModel: string, apiKey?: string, removeApiKey: boolean, };

export type AiConnectionSummary = { id: string, name: string, protocol: AiProtocol, baseUrl: string, models: Array<AiModelProfile>, defaultModel: string, hasApiKey: boolean, };

export type AiConnectionList = { connections: Array<AiConnectionSummary>, defaultConnectionId?: string, };

export type AiModelDiscoveryRequest = { id?: string, protocol?: AiProtocol, baseUrl?: string, model?: string, apiKey?: string, useSavedApiKey: boolean, };

export type ModelDiscoverySource = "catalog" | "validatedModel";

export type ModelDiscoveryResult = { models: Array<string>, truncated: boolean, source: ModelDiscoverySource, };

export type RunDeleteResult = { preservedDocumentCount: number, preservedDirectory?: string, };

export type CreateDocumentResult = { review: ReviewedRecord, issues: Array<ExtractionIssue>, output?: RenderedArtifact, };

export type RunDeleteFailure = { id: string, code: string, message: string, };

export type ClearRunsResult = { deletedCount: number, preservedDocumentCount: number, failures: Array<RunDeleteFailure>, };

export type ExtractionStatus = "found" | "not_found" | "ambiguous";

export type ExtractedField = { value: JsonValue, status: ExtractionStatus, evidence: string | null, };

export type PersistedExtraction = { schema_version: number, result: { [key in string]: ExtractedField }, };

export type AttachmentMetadata = { filename: string, original_filename: string, media_type: string, };

export type RunMetadata = { schema_version: number, id: string, created_at: string, template_id: string, template_schema_version: number, prompt_version: string, attachments: Array<AttachmentMetadata>, };

export type RunArtifacts = { prompt: boolean, extraction: boolean, review: boolean, normalized: boolean, output: boolean, };

export type RunSummary = { id: string, createdAt: string, templateId: string, artifacts: RunArtifacts, };

export type ReviewDecision = "accepted" | "corrected" | "rejected" | "filled_manually";

export type ReviewedField = { model_value: JsonValue, final_value: JsonValue, decision: ReviewDecision, };

export type ReviewedRecord = { schema_version: number, fields: { [key in string]: ReviewedField }, };

export type NormalizedRecord = { schema_version: number, values: { [key in string]: JsonValue }, };

export type ExtractionIssue = { field: string, code: string, message: string, messageKey?: string, messageArgs?: { [key in string]: string }, };

export type RenderedArtifact = { path: string, filename: string, };

export type GeneratedPrompt = { prompt: string, expectedJson: string, promptVersion: string, };

export type RunOutput = { filename: string, path: string, };

export type RunDetails = { metadata: RunMetadata, prompt: string | null, expectedJson: string | null, extraction: { [key in string]: ExtractedField } | null, review: ReviewedRecord | null, normalized: { [key in string]: JsonValue } | null, outputs: Array<RunOutput>, };

export type AppErrorDto = { code: string, message: string, details?: JsonValue, };

export type ImportExtractionResult = { result: { [key in string]: ExtractedField }, issues: Array<ExtractionIssue>, };

export type ReviewSaveResult = { review: ReviewedRecord, issues: Array<ExtractionIssue>, };

export type ExtractionResult = PersistedExtraction['result'];
