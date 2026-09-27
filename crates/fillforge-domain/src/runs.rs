use crate::error::{AppError, AppResult};
use crate::extraction::{
    build_extraction_prompt, normalize_values, parse_extraction, resolve_bindings,
    validate_business_values, validate_extraction, validate_reviewed_values,
};
use crate::model::{
    AttachmentMetadata, ExtractionResult, ImportExtractionResult, NormalizedRecord,
    RenderedArtifact, ReviewDecision, ReviewSaveResult, ReviewedField, ReviewedRecord,
    RunArtifacts, RunDeleteResult, RunDetails, RunMetadata, RunOutput, RunSummary, TemplateSchema,
};
use crate::storage::{
    atomic_write, copy_collision_avoiding, list_subdirectories, read_json, write_json,
};
use crate::template::TemplateService;
use chrono::{SecondsFormat, Utc};
use indexmap::IndexMap;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use ulid::Ulid;

const METADATA_FILE: &str = "metadata.json";
const PROMPT_FILE: &str = "prompt.md";
const EXTRACTION_FILE: &str = "extraction.json";
const REVIEW_FILE: &str = "review.json";
const NORMALIZED_FILE: &str = "normalized.json";
const INPUT_DIR: &str = "input";
const OUTPUT_DIR: &str = "output";
const LATEST_OUTPUT: &str = "result.docx";

#[derive(Clone, Debug)]
pub struct RunAttachmentInput {
    pub path: PathBuf,
    pub original_filename: String,
    pub media_type: String,
}

#[derive(Clone, Debug)]
pub struct CreateRunInput {
    pub template_id: String,
    pub template_schema_version: u32,
    pub prompt_version: String,
}

#[derive(Clone, Debug)]
struct PromptArtifact {
    prompt: String,
    expected_json: String,
}

#[derive(Clone, Debug)]
pub struct RunRepository {
    runs_dir: PathBuf,
}

impl RunRepository {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            runs_dir: path.as_ref().to_path_buf(),
        }
    }

    pub fn run_dir(&self, id: &str) -> AppResult<PathBuf> {
        if !is_valid_ulid(id) {
            return Err(AppError::new(
                "invalid_identifier",
                format!("Run identifier \"{id}\" is invalid."),
            ));
        }
        Ok(self.runs_dir.join(id))
    }

    fn file_path(&self, id: &str, file: &str) -> AppResult<PathBuf> {
        Ok(self.run_dir(id)?.join(file))
    }

    pub fn create(&self, input: CreateRunInput) -> AppResult<RunMetadata> {
        let id = Ulid::new().to_string();
        let dir = self.run_dir(&id)?;
        fs::create_dir_all(dir.join(INPUT_DIR))?;
        fs::create_dir_all(dir.join(OUTPUT_DIR))?;
        let metadata = RunMetadata {
            schema_version: 1,
            id,
            created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            template_id: input.template_id,
            template_schema_version: input.template_schema_version,
            prompt_version: input.prompt_version,
            attachments: Vec::new(),
        };
        write_json(&dir.join(METADATA_FILE), &metadata)?;
        Ok(metadata)
    }

    pub fn load(&self, id: &str) -> AppResult<RunMetadata> {
        let file = self.file_path(id, METADATA_FILE)?;
        if !file.exists() {
            return Err(AppError::new(
                "run_not_found",
                format!("Run \"{id}\" was not found."),
            ));
        }
        let raw: Value = read_json(&file).map_err(|error| {
            AppError::new(
                "invalid_run_artifact",
                format!("Run artifact \"{METADATA_FILE}\" is invalid."),
            )
            .with_details(serde_json::json!(error.message))
        })?;
        let version = raw
            .get("schema_version")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if version != 1 {
            return Err(AppError::new("unsupported_schema_version", format!("metadata.json uses schema version {version}, but this application only supports version 1.")));
        }
        let metadata: RunMetadata = serde_json::from_value(raw).map_err(|error| {
            AppError::new(
                "invalid_run_artifact",
                format!("Run artifact \"{METADATA_FILE}\" is invalid."),
            )
            .with_details(serde_json::json!(error.to_string()))
        })?;
        if metadata.id != id {
            return Err(AppError::new(
                "invalid_run_artifact",
                "Run metadata id does not match its directory.",
            )
            .with_details(serde_json::json!({"directoryId":id,"metadataId":metadata.id})));
        }
        Ok(metadata)
    }

    pub fn list(&self) -> AppResult<Vec<RunSummary>> {
        let mut summaries = Vec::new();
        for dir in list_subdirectories(&self.runs_dir)? {
            let Some(id) = dir.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if let Ok(metadata) = self.load(id) {
                summaries.push(RunSummary {
                    id: metadata.id.clone(),
                    created_at: metadata.created_at.clone(),
                    template_id: metadata.template_id.clone(),
                    artifacts: self.describe_artifacts(id)?,
                });
            }
        }
        summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(summaries)
    }

    pub fn list_ids(&self) -> AppResult<Vec<String>> {
        Ok(list_subdirectories(&self.runs_dir)?
            .into_iter()
            .filter_map(|dir| dir.file_name()?.to_str().map(str::to_string))
            .filter(|id| is_valid_ulid(id))
            .collect())
    }

    pub fn delete_preserving_outputs(
        &self,
        id: &str,
        exports_dir: &Path,
    ) -> AppResult<RunDeleteResult> {
        let dir = self.run_dir(id)?;
        let metadata = fs::symlink_metadata(&dir).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AppError::new("run_not_found", format!("Run \"{id}\" was not found."))
            } else {
                error.into()
            }
        })?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(AppError::new(
                "invalid_run_directory",
                "The run directory is not a regular directory.",
            ));
        }
        let canonical_runs = fs::canonicalize(&self.runs_dir)?;
        let canonical_run = fs::canonicalize(&dir)?;
        if canonical_run.parent() != Some(canonical_runs.as_path()) {
            return Err(AppError::new(
                "invalid_run_directory",
                "The run directory is outside the application run folder.",
            ));
        }

        let output_dir = dir.join(OUTPUT_DIR);
        let mut preserved_directory = None;
        let mut preserved_document_count = 0;
        if output_dir.exists() {
            let output_metadata = fs::symlink_metadata(&output_dir)?;
            if !output_metadata.is_dir() || output_metadata.file_type().is_symlink() {
                return Err(AppError::new(
                    "output_preservation_failed",
                    "The run output folder is not a regular directory.",
                ));
            }
            let outputs = self.list_outputs(id)?;
            if !outputs.is_empty() {
                fs::create_dir_all(exports_dir)?;
                let exports_metadata = fs::symlink_metadata(exports_dir)?;
                if !exports_metadata.is_dir() || exports_metadata.file_type().is_symlink() {
                    return Err(AppError::new(
                        "output_preservation_failed",
                        "The export folder is not a regular directory.",
                    ));
                }
                let canonical_exports = fs::canonicalize(exports_dir)?;
                let archive_parent = exports_dir.join("preserved-runs");
                if !archive_parent.exists() {
                    fs::create_dir(&archive_parent)?;
                }
                let archive_parent_metadata = fs::symlink_metadata(&archive_parent)?;
                if !archive_parent_metadata.is_dir()
                    || archive_parent_metadata.file_type().is_symlink()
                {
                    return Err(AppError::new(
                        "output_preservation_failed",
                        "The saved documents folder is not a regular directory.",
                    ));
                }
                let canonical_archive_parent = fs::canonicalize(&archive_parent)?;
                if canonical_archive_parent.parent() != Some(canonical_exports.as_path()) {
                    return Err(AppError::new(
                        "output_preservation_failed",
                        "The saved documents folder is outside the application export folder.",
                    ));
                }
                let archive_dir = archive_parent.join(id);
                if !archive_dir.exists() {
                    fs::create_dir(&archive_dir)?;
                }
                let archive_metadata = fs::symlink_metadata(&archive_dir)?;
                if !archive_metadata.is_dir() || archive_metadata.file_type().is_symlink() {
                    return Err(AppError::new(
                        "output_preservation_failed",
                        "The saved documents folder is not a regular directory.",
                    ));
                }
                let canonical_archive = fs::canonicalize(&archive_dir)?;
                if canonical_archive.parent() != Some(canonical_archive_parent.as_path()) {
                    return Err(AppError::new(
                        "output_preservation_failed",
                        "The saved documents folder is outside the application export folder.",
                    ));
                }
                for filename in outputs {
                    let source = output_dir.join(&filename);
                    let source_metadata = fs::symlink_metadata(&source)?;
                    if !source_metadata.is_file() || source_metadata.file_type().is_symlink() {
                        return Err(AppError::new(
                            "output_preservation_failed",
                            "A generated document is not a regular file.",
                        ));
                    }
                    preserve_output(&source, &archive_dir.join(&filename))?;
                    preserved_document_count += 1;
                }
                preserved_directory = Some(archive_dir.to_string_lossy().into_owned());
            }
        }
        fs::remove_dir_all(&dir)?;
        Ok(RunDeleteResult {
            preserved_document_count,
            preserved_directory,
        })
    }

    fn describe_artifacts(&self, id: &str) -> AppResult<RunArtifacts> {
        let dir = self.run_dir(id)?;
        Ok(RunArtifacts {
            prompt: dir.join(PROMPT_FILE).exists(),
            extraction: dir.join(EXTRACTION_FILE).exists(),
            review: dir.join(REVIEW_FILE).exists(),
            normalized: dir.join(NORMALIZED_FILE).exists(),
            output: !self.list_outputs(id)?.is_empty(),
        })
    }

    pub fn save_prompt(&self, id: &str, prompt: &str, expected_json: &str) -> AppResult<()> {
        self.load(id)?;
        let file = self.file_path(id, PROMPT_FILE)?;
        if file.exists() {
            return Err(AppError::new(
                "artifact_immutable",
                format!("Artifact \"{PROMPT_FILE}\" already exists and cannot be replaced."),
            ));
        }
        let content = format!("{prompt}\n---\n\nExpected JSON structure:\n\n{expected_json}\n");
        atomic_write(&file, content.as_bytes())
    }

    fn read_prompt_artifact(&self, id: &str) -> AppResult<Option<PromptArtifact>> {
        self.load(id)?;
        let file = self.file_path(id, PROMPT_FILE)?;
        if !file.exists() {
            return Ok(None);
        }
        let text = fs::read_to_string(file)?;
        let marker = "\n---\n\nExpected JSON structure:\n\n";
        Ok(Some(match text.find(marker) {
            None => PromptArtifact {
                prompt: text,
                expected_json: String::new(),
            },
            Some(index) => PromptArtifact {
                prompt: text[..index].to_string(),
                expected_json: text[index + marker.len()..].trim().to_string(),
            },
        }))
    }

    pub fn save_extraction(&self, id: &str, extraction: &ExtractionResult) -> AppResult<()> {
        self.load(id)?;
        let file = self.file_path(id, EXTRACTION_FILE)?;
        if file.exists() {
            return Err(AppError::new(
                "artifact_immutable",
                format!("Artifact \"{EXTRACTION_FILE}\" already exists and cannot be replaced."),
            ));
        }
        write_json(
            &file,
            &serde_json::json!({"schema_version":1,"result":extraction}),
        )
    }

    pub fn read_extraction(&self, id: &str) -> AppResult<Option<ExtractionResult>> {
        let raw = self.read_json_artifact(id, EXTRACTION_FILE)?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let version = raw
            .get("schema_version")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if version != 1 {
            return Err(AppError::new("unsupported_schema_version", format!("extraction.json uses schema version {version}, but this application only supports version 1.")));
        }
        let result = raw
            .get("result")
            .ok_or_else(|| invalid_artifact(EXTRACTION_FILE, "Missing result field."))?;
        parse_extraction(&result.to_string())
            .map(Some)
            .map_err(|error| invalid_artifact(EXTRACTION_FILE, &error.message))
    }

    pub fn save_review(&self, id: &str, review: &ReviewedRecord) -> AppResult<()> {
        self.load(id)?;
        write_json(&self.file_path(id, REVIEW_FILE)?, review)
    }

    pub fn read_review(&self, id: &str) -> AppResult<Option<ReviewedRecord>> {
        let raw = self.read_json_artifact(id, REVIEW_FILE)?;
        raw.map(|value| {
            serde_json::from_value(value)
                .map_err(|error| invalid_artifact(REVIEW_FILE, &error.to_string()))
        })
        .transpose()
    }

    pub fn save_normalized(&self, id: &str, values: &IndexMap<String, Value>) -> AppResult<()> {
        self.load(id)?;
        write_json(
            &self.file_path(id, NORMALIZED_FILE)?,
            &NormalizedRecord {
                schema_version: 1,
                values: values.clone(),
            },
        )
    }

    pub fn read_normalized(&self, id: &str) -> AppResult<Option<NormalizedRecord>> {
        let raw = self.read_json_artifact(id, NORMALIZED_FILE)?;
        raw.map(|value| {
            serde_json::from_value(value)
                .map_err(|error| invalid_artifact(NORMALIZED_FILE, &error.to_string()))
        })
        .transpose()
    }

    pub fn clear_normalized(&self, id: &str) -> AppResult<()> {
        self.load(id)?;
        let file = self.file_path(id, NORMALIZED_FILE)?;
        if file.exists() {
            fs::remove_file(file)?;
        }
        Ok(())
    }

    pub fn save_output(&self, id: &str, document: &[u8]) -> AppResult<RenderedArtifact> {
        self.load(id)?;
        let dir = self.run_dir(id)?.join(OUTPUT_DIR);
        fs::create_dir_all(&dir)?;
        let mut latest = 0u32;
        for entry in fs::read_dir(&dir)? {
            let Some(name) = entry
                .ok()
                .and_then(|item| item.file_name().into_string().ok())
            else {
                continue;
            };
            if let Some(number) = name
                .strip_prefix("result-")
                .and_then(|s| s.strip_suffix(".docx"))
                .and_then(|s| s.parse::<u32>().ok())
            {
                latest = latest.max(number);
            }
        }
        let filename = format!("result-{:03}.docx", latest + 1);
        let target = dir.join(&filename);
        atomic_write(&target, document)?;
        atomic_write(&dir.join(LATEST_OUTPUT), document)?;
        Ok(RenderedArtifact {
            path: target.to_string_lossy().into_owned(),
            filename,
        })
    }

    pub fn list_outputs(&self, id: &str) -> AppResult<Vec<String>> {
        let dir = self.run_dir(id)?.join(OUTPUT_DIR);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut entries = fs::read_dir(dir)?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name == LATEST_OUTPUT || is_versioned_output(name))
            .collect::<Vec<_>>();
        entries.sort();
        Ok(entries)
    }

    pub fn add_attachment(
        &self,
        id: &str,
        source: &Path,
        original_filename: &str,
    ) -> AppResult<AttachmentMetadata> {
        self.load(id)?;
        let original = safe_filename(original_filename, source);
        let destination =
            copy_collision_avoiding(source, &self.run_dir(id)?.join(INPUT_DIR), &original)?;
        let metadata = AttachmentMetadata {
            filename: destination
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            original_filename: original.clone(),
            media_type: media_type_for_filename(&original).to_string(),
        };
        let mut run = self.load(id)?;
        run.attachments.push(metadata.clone());
        write_json(&self.file_path(id, METADATA_FILE)?, &run)?;
        Ok(metadata)
    }

    fn read_json_artifact(&self, id: &str, filename: &str) -> AppResult<Option<Value>> {
        self.load(id)?;
        let file = self.file_path(id, filename)?;
        if !file.exists() {
            return Ok(None);
        }
        let raw = read_json(&file).map_err(|error| invalid_artifact(filename, &error.message))?;
        Ok(Some(raw))
    }
}

fn preserve_output(source: &Path, target: &Path) -> AppResult<()> {
    match fs::symlink_metadata(target) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(AppError::new(
                    "output_preservation_failed",
                    "A saved document destination is not a regular file.",
                ));
            }
            if fs::read(source)? == fs::read(target)? {
                return Ok(());
            }
            return Err(AppError::new(
                "output_preservation_failed",
                "A saved document with the same name already exists and has different contents.",
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let parent = target
        .parent()
        .ok_or_else(|| AppError::internal("The saved document has no parent directory."))?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        target.file_name().unwrap_or_default().to_string_lossy(),
        Ulid::new()
    ));
    fs::copy(source, &temp)?;
    let result = fs::rename(&temp, target);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    Ok(())
}

fn invalid_artifact(filename: &str, message: &str) -> AppError {
    AppError::new(
        "invalid_run_artifact",
        format!("Run artifact \"{filename}\" is invalid."),
    )
    .with_details(serde_json::json!(message))
}
fn is_versioned_output(name: &str) -> bool {
    name.strip_prefix("result-")
        .and_then(|s| s.strip_suffix(".docx"))
        .is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
}
fn safe_filename(name: &str, source: &Path) -> String {
    Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .or_else(|| source.file_name().and_then(|s| s.to_str()))
        .unwrap_or("attachment")
        .to_string()
}
fn media_type_for_filename(filename: &str) -> &'static str {
    match Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        _ => "application/octet-stream",
    }
}
fn is_valid_ulid(id: &str) -> bool {
    id.len() == 26
        && id.as_bytes()[0].is_ascii_digit()
        && id.as_bytes()[0] <= b'7'
        && id
            .bytes()
            .all(|c| "0123456789ABCDEFGHJKMNPQRSTVWXYZ".as_bytes().contains(&c))
}

#[cfg(test)]
mod tests {
    use super::{CreateRunInput, RunRepository};
    use std::fs;
    use std::path::{Path, PathBuf};
    use ulid::Ulid;

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join("fillforge-run-delete-tests")
                .join(Ulid::new().to_string());
            fs::create_dir_all(&path).expect("create test root");
            Self(path)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn new_run(root: &TestRoot) -> (RunRepository, PathBuf, String) {
        let runs_dir = root.path("runs");
        let exports_dir = root.path("exports");
        let repository = RunRepository::new(&runs_dir);
        let run = repository
            .create(CreateRunInput {
                template_id: "invoice".to_string(),
                template_schema_version: 1,
                prompt_version: "test".to_string(),
            })
            .expect("create run");
        (repository, exports_dir, run.id)
    }

    #[test]
    fn delete_preserves_every_version_and_latest_output() {
        let root = TestRoot::new();
        let (repository, exports_dir, id) = new_run(&root);
        repository
            .save_output(&id, b"first document")
            .expect("save first output");
        repository
            .save_output(&id, b"second document")
            .expect("save second output");

        let result = repository
            .delete_preserving_outputs(&id, &exports_dir)
            .expect("preserve and delete run");

        assert_eq!(result.preserved_document_count, 3);
        assert!(!repository.run_dir(&id).expect("run path").exists());
        let archive = exports_dir.join("preserved-runs").join(id);
        assert_eq!(
            fs::read(archive.join("result-001.docx")).unwrap(),
            b"first document"
        );
        assert_eq!(
            fs::read(archive.join("result-002.docx")).unwrap(),
            b"second document"
        );
        assert_eq!(
            fs::read(archive.join("result.docx")).unwrap(),
            b"second document"
        );
    }

    #[test]
    fn delete_without_outputs_removes_run_without_creating_archive() {
        let root = TestRoot::new();
        let (repository, exports_dir, id) = new_run(&root);

        let result = repository
            .delete_preserving_outputs(&id, &exports_dir)
            .expect("delete empty run");

        assert_eq!(result.preserved_document_count, 0);
        assert!(result.preserved_directory.is_none());
        assert!(!exports_dir.join("preserved-runs").exists());
        assert!(!repository.run_dir(&id).expect("run path").exists());
    }

    #[test]
    fn preservation_collision_leaves_run_intact() {
        let root = TestRoot::new();
        let (repository, exports_dir, id) = new_run(&root);
        repository
            .save_output(&id, b"generated document")
            .expect("save output");
        let archive = exports_dir.join("preserved-runs").join(&id);
        fs::create_dir_all(&archive).expect("create archive");
        fs::write(archive.join("result-001.docx"), b"different document").expect("write collision");

        let result = repository.delete_preserving_outputs(&id, &exports_dir);

        assert!(result.is_err());
        assert!(repository.run_dir(&id).expect("run path").exists());
        assert_eq!(repository.list_outputs(&id).unwrap().len(), 2);
    }

    #[test]
    fn invalid_id_is_rejected_without_touching_run_storage() {
        let root = TestRoot::new();
        let (repository, exports_dir, id) = new_run(&root);

        assert!(repository
            .delete_preserving_outputs("../outside", &exports_dir)
            .is_err());
        assert!(repository.run_dir(&id).expect("run path").exists());
    }

    #[test]
    fn symlink_output_destination_leaves_run_intact() {
        let root = TestRoot::new();
        let (repository, exports_dir, id) = new_run(&root);
        repository
            .save_output(&id, b"generated document")
            .expect("save output");
        let archive = exports_dir.join("preserved-runs").join(&id);
        fs::create_dir_all(&archive).expect("create archive");
        let outside = root.path("outside.docx");
        fs::write(&outside, b"outside file").expect("write outside file");
        let destination = archive.join("result-001.docx");
        if create_file_symlink(&outside, &destination).is_err() {
            return;
        }

        assert!(repository
            .delete_preserving_outputs(&id, &exports_dir)
            .is_err());
        assert!(repository.run_dir(&id).expect("run path").exists());
        assert_eq!(fs::read(&outside).unwrap(), b"outside file");
    }

    #[cfg(windows)]
    fn create_file_symlink(source: &Path, destination: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(source, destination)
    }

    #[cfg(unix)]
    fn create_file_symlink(source: &Path, destination: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(source, destination)
    }
}

#[derive(Clone)]
pub struct RunService {
    repository: Arc<RunRepository>,
    templates: Arc<TemplateService>,
    renderer: Arc<dyn crate::docx::DocumentRenderer>,
    prompt_version: Arc<RwLock<String>>,
}

impl RunService {
    pub fn new(
        repository: Arc<RunRepository>,
        templates: Arc<TemplateService>,
        renderer: Arc<dyn crate::docx::DocumentRenderer>,
        prompt_version: String,
    ) -> Self {
        Self {
            repository,
            templates,
            renderer,
            prompt_version: Arc::new(RwLock::new(prompt_version)),
        }
    }

    pub fn set_prompt_version(&self, version: String) {
        if let Ok(mut current) = self.prompt_version.write() {
            *current = version;
        }
    }

    pub fn create_run(&self, template_id: &str) -> AppResult<RunMetadata> {
        let template = self.templates.load_template(template_id)?;
        let prompt_version = self
            .prompt_version
            .read()
            .map(|s| s.clone())
            .unwrap_or_else(|_| crate::config::DEFAULT_PROMPT_VERSION.to_string());
        self.repository.create(CreateRunInput {
            template_id: template.id,
            template_schema_version: template.schema_version,
            prompt_version,
        })
    }

    pub fn list_runs(&self) -> AppResult<Vec<RunSummary>> {
        self.repository.list()
    }

    pub fn get_run(&self, id: &str) -> AppResult<RunDetails> {
        let metadata = self.repository.load(id)?;
        let prompt = self.repository.read_prompt_artifact(id)?;
        let extraction = self.repository.read_extraction(id)?;
        let review = self.repository.read_review(id)?;
        let normalized = self
            .repository
            .read_normalized(id)?
            .map(|record| record.values);
        let outputs = self
            .repository
            .list_outputs(id)?
            .into_iter()
            .map(|filename| RunOutput {
                path: self
                    .repository
                    .run_dir(id)
                    .map(|dir| {
                        dir.join(OUTPUT_DIR)
                            .join(&filename)
                            .to_string_lossy()
                            .into_owned()
                    })
                    .unwrap_or_default(),
                filename,
            })
            .collect();
        Ok(RunDetails {
            metadata,
            prompt: prompt.as_ref().map(|p| p.prompt.clone()),
            expected_json: prompt.map(|p| p.expected_json),
            extraction,
            review,
            normalized,
            outputs,
        })
    }

    pub fn add_attachment(
        &self,
        id: &str,
        path: &Path,
        filename: &str,
    ) -> AppResult<AttachmentMetadata> {
        self.repository.add_attachment(id, path, filename)
    }

    pub fn generate_prompt(&self, id: &str) -> AppResult<String> {
        if let Some(prompt) = self.repository.read_prompt_artifact(id)? {
            return Ok(prompt.prompt);
        }
        let metadata = self.repository.load(id)?;
        let template = self.load_run_template(&metadata)?;
        let generated = build_extraction_prompt(&template, Some(&metadata.prompt_version))?;
        self.repository
            .save_prompt(id, &generated.prompt, &generated.expected_json)?;
        Ok(generated.prompt)
    }

    pub fn import_extraction(&self, id: &str, raw: &str) -> AppResult<ImportExtractionResult> {
        if self.repository.read_extraction(id)?.is_some() {
            return Err(AppError::new(
                "artifact_immutable",
                format!("Artifact \"{EXTRACTION_FILE}\" already exists and cannot be replaced."),
            ));
        }
        let metadata = self.repository.load(id)?;
        let template = self.load_run_template(&metadata)?;
        let result = parse_extraction(raw)?;
        let issues = validate_extraction(&result, &template);
        self.repository.save_extraction(id, &result)?;
        Ok(ImportExtractionResult { result, issues })
    }

    pub fn save_review(
        &self,
        id: &str,
        final_values: &IndexMap<String, Value>,
    ) -> AppResult<ReviewSaveResult> {
        let extraction = self.repository.read_extraction(id)?.ok_or_else(|| {
            AppError::validation(
                "No extraction result has been imported for this run yet.",
                serde_json::json!({"runId":id}),
            )
        })?;
        let metadata = self.repository.load(id)?;
        let template = self.load_run_template(&metadata)?;
        let mut keys = IndexMap::new();
        for key in extraction
            .keys()
            .chain(final_values.keys())
            .chain(template.fields.keys())
        {
            keys.insert(key.clone(), ());
        }
        let mut fields = IndexMap::new();
        for key in keys.keys() {
            let model_value = extraction
                .get(key)
                .map(|entry| entry.value.clone())
                .unwrap_or(Value::Null);
            let final_value = final_values
                .get(key)
                .cloned()
                .unwrap_or_else(|| model_value.clone());
            let decision = decide_review(&model_value, &final_value);
            fields.insert(
                key.clone(),
                ReviewedField {
                    model_value,
                    final_value,
                    decision,
                },
            );
        }
        let record = ReviewedRecord {
            schema_version: 1,
            fields,
        };
        let reviewed_values = record
            .fields
            .iter()
            .map(|(key, field)| (key.clone(), field.final_value.clone()))
            .collect::<IndexMap<_, _>>();
        let issues = validate_reviewed_values(&reviewed_values, &template);
        self.repository.save_review(id, &record)?;
        self.repository.clear_normalized(id)?;
        Ok(ReviewSaveResult {
            review: record,
            issues,
        })
    }

    pub fn build_normalized(&self, id: &str) -> AppResult<IndexMap<String, Value>> {
        let extraction = self.repository.read_extraction(id)?.ok_or_else(|| {
            AppError::validation(
                "No extraction result has been imported for this run yet.",
                serde_json::json!({"runId":id}),
            )
        })?;
        let metadata = self.repository.load(id)?;
        let template = self.load_run_template(&metadata)?;
        let review = self.repository.read_review(id)?;
        let mut effective = IndexMap::new();
        for key in extraction
            .keys()
            .chain(review.as_ref().into_iter().flat_map(|r| r.fields.keys()))
        {
            let value = review
                .as_ref()
                .and_then(|r| r.fields.get(key))
                .map(|field| &field.final_value)
                .or_else(|| extraction.get(key).map(|field| &field.value));
            if let Some(value) = value.filter(|value| !value.is_null()) {
                effective.insert(key.clone(), value.clone());
            }
        }
        let normalized = normalize_values(&effective, &template.fields);
        self.repository.save_normalized(id, &normalized)?;
        Ok(normalized)
    }

    pub fn render_run(&self, id: &str) -> AppResult<RenderedArtifact> {
        let metadata = self.repository.load(id)?;
        let template = self.load_run_template(&metadata)?;
        let values = self.build_normalized(id)?;
        let issues = validate_business_values(&values, &template);
        if !issues.is_empty() {
            return Err(AppError::new(
                "validation_failed",
                "The run is not ready to render; review the flagged fields first.",
            )
            .with_details(serde_json::to_value(issues).unwrap_or(Value::Null)));
        }
        let document = self.templates.read_template_document(&template.id)?;
        let resolved = resolve_bindings(&values, template.bindings.as_ref());
        let rendered = self.renderer.render(crate::docx::RenderInput {
            document: &document,
            values: &resolved,
        })?;
        self.repository.save_output(id, &rendered)
    }

    fn load_run_template(&self, metadata: &RunMetadata) -> AppResult<TemplateSchema> {
        self.templates.load_template(&metadata.template_id)
    }
}

fn decide_review(model: &Value, final_value: &Value) -> ReviewDecision {
    if model.is_null() && !final_value.is_null() {
        return ReviewDecision::FilledManually;
    }
    if !model.is_null() && final_value.is_null() {
        return ReviewDecision::Rejected;
    }
    if model == final_value {
        ReviewDecision::Accepted
    } else {
        ReviewDecision::Corrected
    }
}
