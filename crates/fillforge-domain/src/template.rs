use crate::docx::{DocumentRenderer, TemplateInspection};
use crate::error::{AppError, AppResult};
use crate::model::{
    FieldDefinition, FieldType, PlaceholderReport, TemplateBinding, TemplateDocument,
    TemplateSchema, TemplateSummary,
};
use crate::paths::is_path_inside;
use crate::storage::{copy_collision_avoiding, list_subdirectories, read_yaml, write_yaml};
use indexmap::IndexMap;
use serde_yaml_ng::Value as YamlValue;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use ulid::Ulid;
use unicode_normalization::UnicodeNormalization;

const CONFIG_FILE: &str = "template.yaml";
const DOCUMENT_FILE: &str = "template.docx";

#[derive(Clone, Debug)]
pub struct TemplateRepository {
    templates_dir: PathBuf,
}

impl TemplateRepository {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            templates_dir: path.as_ref().to_path_buf(),
        }
    }

    fn validate_id(id: &str) -> AppResult<()> {
        if id.is_empty()
            || !id.as_bytes()[0].is_ascii_lowercase() && !id.as_bytes()[0].is_ascii_digit()
            || !id.bytes().all(|c| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'_' | b'-')
            })
        {
            return Err(AppError::new(
                "invalid_identifier",
                format!("Template identifier \"{id}\" is invalid."),
            ));
        }
        Ok(())
    }

    fn template_dir(&self, id: &str) -> AppResult<PathBuf> {
        Self::validate_id(id)?;
        Ok(self.templates_dir.join(id))
    }
    fn config_path(&self, id: &str) -> AppResult<PathBuf> {
        Ok(self.template_dir(id)?.join(CONFIG_FILE))
    }

    pub fn load(&self, id: &str) -> AppResult<TemplateSchema> {
        let file = self.config_path(id)?;
        if !file.exists() {
            return Err(AppError::new(
                "template_not_found",
                format!("Template \"{id}\" was not found."),
            ));
        }
        let yaml: YamlValue = read_yaml(&file).map_err(|error| {
            AppError::new(
                "invalid_template_schema",
                format!("Template \"{id}\" has an invalid configuration schema."),
            )
            .with_details(serde_json::json!(error.message))
        })?;
        let version = yaml
            .get("schema_version")
            .and_then(YamlValue::as_u64)
            .unwrap_or(0);
        if version != 1 {
            return Err(AppError::new("unsupported_schema_version", format!("template.yaml uses schema version {version}, but this application only supports version 1.")));
        }
        let schema: TemplateSchema = serde_yaml_ng::from_value(yaml).map_err(|error| {
            AppError::new(
                "invalid_template_schema",
                format!("Template \"{id}\" has an invalid configuration schema."),
            )
            .with_details(serde_json::json!(error.to_string()))
        })?;
        if schema.id != id {
            return Err(AppError::validation(
                "Template id does not match its directory.",
                serde_json::json!({"directoryId":id,"schemaId":schema.id}),
            ));
        }
        validate_schema(&schema)?;
        self.resolve_document_path(id, &schema, false)?;
        Ok(schema)
    }

    pub fn list(&self) -> AppResult<Vec<TemplateSummary>> {
        let mut output = Vec::new();
        for dir in list_subdirectories(&self.templates_dir)? {
            let Some(id) = dir.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            match self.load(id) {
                Ok(schema) => {
                    let document = self.resolve_document_path(id, &schema, false)?;
                    output.push(TemplateSummary {
                        id: schema.id,
                        name: schema.name,
                        description: schema.description,
                        has_document: document.is_file(),
                    });
                }
                Err(error)
                    if [
                        "invalid_template_schema",
                        "unsupported_schema_version",
                        "validation_failed",
                        "invalid_identifier",
                    ]
                    .contains(&error.code.as_str()) =>
                {
                    output.push(TemplateSummary {
                        id: id.to_string(),
                        name: id.to_string(),
                        description: Some(format!(
                            "Unreadable template configuration: {}",
                            error.code
                        )),
                        has_document: dir.join(DOCUMENT_FILE).is_file(),
                    });
                }
                Err(error) if error.code == "template_not_found" => {}
                Err(error) => return Err(error),
            }
        }
        Ok(output)
    }

    pub fn create(
        &self,
        id: &str,
        name: &str,
        description: Option<String>,
        source: &Path,
        fields: IndexMap<String, FieldDefinition>,
        bindings: IndexMap<String, TemplateBinding>,
    ) -> AppResult<TemplateSchema> {
        Self::validate_id(id)?;
        if name.trim().is_empty() {
            return Err(AppError::new(
                "validation_failed",
                "Template name must not be empty.",
            ));
        }
        let dir = self.template_dir(id)?;
        if dir.exists() {
            return Err(AppError::new(
                "template_already_exists",
                format!("Template \"{id}\" already exists."),
            ));
        }
        fs::create_dir_all(&self.templates_dir)?;
        let staging = self
            .templates_dir
            .join(format!(".import-{id}-{}", random_suffix()));
        fs::create_dir(&staging)?;
        let result = (|| {
            copy_collision_avoiding(source, &staging, DOCUMENT_FILE)?;
            let schema = TemplateSchema {
                schema_version: 1,
                id: id.to_string(),
                name: name.to_string(),
                description,
                document: TemplateDocument {
                    file: DOCUMENT_FILE.to_string(),
                },
                fields,
                bindings: Some(bindings),
            };
            validate_schema(&schema)?;
            write_yaml(&staging.join(CONFIG_FILE), &schema)?;
            if dir.exists() {
                return Err(AppError::new(
                    "template_already_exists",
                    format!("Template \"{id}\" already exists."),
                ));
            }
            fs::rename(&staging, &dir)?;
            Ok(schema)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }

    pub fn save_schema(&self, id: &str, schema: &TemplateSchema) -> AppResult<()> {
        Self::validate_id(id)?;
        validate_schema(schema)?;
        if schema.id != id {
            return Err(AppError::validation(
                "Template id does not match its directory.",
                serde_json::json!({"directoryId":id,"schemaId":schema.id}),
            ));
        }
        let dir = self.template_dir(id)?;
        if !dir.exists() {
            return Err(AppError::new(
                "template_not_found",
                format!("Template \"{id}\" was not found."),
            ));
        }
        self.resolve_document_path(id, schema, false)?;
        write_yaml(&dir.join(CONFIG_FILE), schema)
    }

    pub fn duplicate(&self, id: &str) -> AppResult<TemplateSchema> {
        let source = self.load(id)?;
        let target_id = format!("{}-{}", source.id, random_suffix());
        let target_dir = self.template_dir(&target_id)?;
        fs::create_dir_all(&target_dir)?;
        let source_dir = self.template_dir(id)?;
        let copied = fs::copy(
            source_dir.join(&source.document.file),
            target_dir.join(&source.document.file),
        );
        if let Err(error) = copied {
            let _ = fs::remove_dir_all(&target_dir);
            return Err(error.into());
        }
        let mut copy = source;
        copy.id = target_id;
        copy.name = format!("{} (copy)", copy.name);
        if let Err(error) = write_yaml(&target_dir.join(CONFIG_FILE), &copy) {
            let _ = fs::remove_dir_all(&target_dir);
            return Err(error);
        }
        Ok(copy)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let dir = self.template_dir(id)?;
        if !dir.exists() {
            return Err(AppError::new(
                "template_not_found",
                format!("Template \"{id}\" was not found."),
            ));
        }
        fs::remove_dir_all(dir)?;
        Ok(())
    }

    pub fn document_path(&self, id: &str) -> AppResult<PathBuf> {
        let schema = self.load(id)?;
        let path = self.resolve_document_path(id, &schema, true)?;
        Ok(path)
    }

    fn resolve_document_path(
        &self,
        id: &str,
        schema: &TemplateSchema,
        require_file: bool,
    ) -> AppResult<PathBuf> {
        let dir = self.template_dir(id)?;
        let relative = Path::new(&schema.document.file);
        let normalized = dir.join(relative);
        if relative.is_absolute()
            || relative.components().any(|part| {
                matches!(
                    part,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
            || !is_path_inside(&dir, &normalized)
        {
            return Err(AppError::validation(
                "Template document path must stay inside the template directory.",
                serde_json::json!({"templateId":id}),
            ));
        }
        if require_file && !normalized.exists() {
            return Err(AppError::new(
                "template_document_missing",
                format!("The document file for template \"{id}\" is missing."),
            ));
        }
        if normalized.exists() {
            let real_dir = fs::canonicalize(&dir)?;
            let real_file = fs::canonicalize(&normalized)?;
            if !is_path_inside(&real_dir, &real_file) {
                return Err(AppError::validation(
                    "Template document symlinks must stay inside the template directory.",
                    serde_json::json!({"templateId":id}),
                ));
            }
        }
        Ok(normalized)
    }
}

#[derive(Clone)]
pub struct TemplateService {
    pub repository: Arc<TemplateRepository>,
    renderer: Arc<dyn DocumentRenderer>,
}

impl TemplateService {
    pub fn new(repository: Arc<TemplateRepository>, renderer: Arc<dyn DocumentRenderer>) -> Self {
        Self {
            repository,
            renderer,
        }
    }
    pub fn list_templates(&self) -> AppResult<Vec<TemplateSummary>> {
        self.repository.list()
    }
    pub fn load_template(&self, id: &str) -> AppResult<TemplateSchema> {
        self.repository.load(id)
    }
    pub fn read_template_document(&self, id: &str) -> AppResult<Vec<u8>> {
        Ok(fs::read(self.repository.document_path(id)?)?)
    }

    pub fn import_template(&self, source: &Path) -> AppResult<TemplateSchema> {
        let bytes = fs::read(source)?;
        let inspection = self.renderer.inspect(&bytes)?;
        require_supported_placeholders(&inspection)?;
        let name = source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("template")
            .to_string();
        let id = slugify_id(&name);
        let mut fields = IndexMap::new();
        let mut bindings = IndexMap::new();
        for placeholder in inspection.placeholders {
            fields.insert(
                placeholder.clone(),
                FieldDefinition {
                    label: placeholder.clone(),
                    field_type: FieldType::String,
                    required: false,
                    ..FieldDefinition::default()
                },
            );
            bindings.insert(
                placeholder.clone(),
                TemplateBinding {
                    source: placeholder,
                    transform: None,
                },
            );
        }
        self.repository
            .create(&id, &name, None, source, fields, bindings)
    }

    pub fn inspect_template(&self, id: &str) -> AppResult<PlaceholderReport> {
        let schema = self.repository.load(id)?;
        let document = fs::read(self.repository.document_path(id)?)?;
        let inspection = self.renderer.inspect(&document)?;
        Ok(placeholder_report(&inspection, &schema))
    }

    pub fn sync_placeholders(
        &self,
        id: &str,
        draft: Option<TemplateSchema>,
    ) -> AppResult<TemplateSchema> {
        let has_draft = draft.is_some();
        let mut schema = match draft {
            Some(value) => value,
            None => self.repository.load(id)?,
        };
        if schema.id != id {
            return Err(AppError::validation(
                "Template id does not match the requested template.",
                serde_json::json!({"requestedId":id,"schemaId":schema.id}),
            ));
        }
        let bytes = fs::read(self.repository.document_path(id)?)?;
        let inspection = self.renderer.inspect(&bytes)?;
        let placeholders = require_supported_placeholders(&inspection)?;
        let mut changed = false;
        let bindings = schema.bindings.get_or_insert_with(IndexMap::new);
        for placeholder in placeholders {
            if !schema.fields.contains_key(&placeholder) {
                schema.fields.insert(
                    placeholder.clone(),
                    FieldDefinition {
                        label: placeholder.clone(),
                        field_type: FieldType::String,
                        required: false,
                        ..FieldDefinition::default()
                    },
                );
                changed = true;
            }
            if !bindings.contains_key(&placeholder) {
                bindings.insert(
                    placeholder.clone(),
                    TemplateBinding {
                        source: placeholder,
                        transform: None,
                    },
                );
                changed = true;
            }
        }
        if changed || has_draft {
            self.repository.save_schema(id, &schema)?;
        }
        Ok(schema)
    }

    pub fn duplicate_template(&self, id: &str) -> AppResult<TemplateSummary> {
        let schema = self.repository.duplicate(id)?;
        Ok(TemplateSummary {
            has_document: self.repository.document_path(&schema.id).is_ok(),
            id: schema.id,
            name: schema.name,
            description: schema.description,
        })
    }
}

pub fn validate_schema(schema: &TemplateSchema) -> AppResult<()> {
    if schema.schema_version != 1 {
        return Err(AppError::new(
            "unsupported_schema_version",
            "Template schema version is not supported.",
        ));
    }
    if schema.id.is_empty()
        || !schema
            .id
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        || !schema.id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '_' | '-')
        })
        || schema.name.is_empty()
        || schema.document.file.is_empty()
    {
        return Err(AppError::validation(
            "Template configuration is invalid.",
            serde_json::json!([{"message":"id, name, and document.file must be valid and non-empty"}]),
        ));
    }
    let invalid_fields = schema
        .fields
        .iter()
        .filter(|(_, field)| field.label.is_empty())
        .map(|(key, _)| serde_json::json!({"path":["fields",key,"label"],"message":"String must contain at least 1 character(s)"}))
        .collect::<Vec<_>>();
    if !invalid_fields.is_empty() {
        return Err(AppError::validation(
            "Template configuration is invalid.",
            serde_json::json!(invalid_fields),
        ));
    }
    for (placeholder, binding) in schema.bindings.iter().flat_map(|items| items.iter()) {
        if !schema.fields.contains_key(&binding.source) {
            return Err(AppError::validation(
                format!(
                    "Binding source \"{}\" is not a configured field.",
                    binding.source
                ),
                serde_json::json!({"bindings":{placeholder:{"source":binding.source}}}),
            ));
        }
    }
    Ok(())
}

fn require_supported_placeholders(inspection: &TemplateInspection) -> AppResult<Vec<String>> {
    let unsupported = inspection
        .unsupported_tags
        .iter()
        .cloned()
        .chain(
            inspection
                .placeholders
                .iter()
                .filter(|value| !is_simple_placeholder(value))
                .cloned(),
        )
        .collect::<std::collections::BTreeSet<_>>();
    if !unsupported.is_empty() {
        return Err(AppError::new(
            "template_placeholders_unsupported",
            "Use simple lowercase English placeholders such as {invoice_number}.",
        )
        .with_details(serde_json::json!(unsupported)));
    }
    let placeholders = inspection
        .placeholders
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if placeholders.is_empty() {
        return Err(AppError::new("template_placeholders_missing", "Add at least one placeholder such as {invoice_number} to the DOCX, then import it again."));
    }
    Ok(placeholders)
}

pub fn is_simple_placeholder(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some('a'..='z'))
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn placeholder_report(
    inspection: &TemplateInspection,
    schema: &TemplateSchema,
) -> PlaceholderReport {
    let bindings = schema.bindings.as_ref();
    let referenced = bindings
        .into_iter()
        .flat_map(|items| items.iter())
        .filter(|(key, _)| inspection.placeholders.contains(key))
        .map(|(_, binding)| binding.source.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    PlaceholderReport {
        placeholders: inspection.placeholders.clone(),
        unconfigured: inspection
            .placeholders
            .iter()
            .filter(|key| !bindings.is_some_and(|items| items.contains_key(*key)))
            .cloned()
            .collect(),
        unreferenced: schema
            .fields
            .keys()
            .filter(|key| !referenced.contains(key.as_str()))
            .cloned()
            .collect(),
        unsupported_tags: (!inspection.unsupported_tags.is_empty())
            .then(|| inspection.unsupported_tags.clone()),
    }
}

fn slugify_id(name: &str) -> String {
    let normalized = name
        .nfkd()
        .filter(|c| !matches!(c, '\u{0300}'..='\u{036f}'))
        .collect::<String>();
    let mut slug = String::new();
    let mut dash = false;
    for ch in normalized.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !dash && !slug.is_empty() {
            slug.push('-');
            dash = true;
        }
        if slug.len() >= 48 {
            break;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        format!("template-{}", random_suffix())
    } else {
        slug
    }
}

fn random_suffix() -> String {
    Ulid::new().to_string()[..6].to_ascii_lowercase()
}
