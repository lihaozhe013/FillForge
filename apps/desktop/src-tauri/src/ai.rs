use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use fillforge_domain::error::{AppError, AppResult};
use fillforge_domain::model::{
    AiConnectionInput, AiConnectionList, AiConnectionSummary, AiModelDiscoveryRequest,
    AiModelProfile, AiProtocol, ModelDiscoveryResult,
};
use fillforge_domain::runs::RunRepository;
use fillforge_domain::storage::write_json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use ulid::Ulid;
use url::Url;

mod discovery;

const KEYRING_SERVICE: &str = "com.fillforge.ai";
const MAX_REQUEST_BYTES: usize = 50 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConnections {
    schema_version: u32,
    default_connection_id: Option<String>,
    connections: Vec<StoredConnection>,
}

impl Default for StoredConnections {
    fn default() -> Self {
        Self {
            schema_version: 1,
            default_connection_id: None,
            connections: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConnection {
    id: String,
    name: String,
    protocol: AiProtocol,
    base_url: String,
    models: Vec<AiModelProfile>,
    default_model: String,
}

#[derive(Clone, Debug)]
struct SourceFile {
    filename: String,
    media_type: String,
    bytes: Vec<u8>,
}

#[derive(Clone)]
pub struct AiConnectionStore {
    path: PathBuf,
}

impl AiConnectionStore {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            path: config_dir.join("ai-connections.json"),
        }
    }

    fn load(&self) -> AppResult<StoredConnections> {
        if !self.path.exists() {
            return Ok(StoredConnections::default());
        }
        let bytes = fs::read(&self.path)?;
        let stored: StoredConnections = serde_json::from_slice(&bytes).map_err(|_| {
            AppError::new(
                "invalid_ai_config",
                "AI connection settings could not be read.",
            )
        })?;
        if stored.schema_version != 1 {
            return Err(AppError::new(
                "invalid_ai_config",
                "AI connection settings use an unsupported version.",
            ));
        }
        Ok(stored)
    }

    fn save_store(&self, stored: &StoredConnections) -> AppResult<()> {
        write_json(&self.path, stored)
    }

    fn entry(id: &str) -> AppResult<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, id).map_err(|_| {
            AppError::new(
                "credential_store_unavailable",
                "The operating system could not open its secure credential store.",
            )
        })
    }

    fn read_key(id: &str) -> AppResult<Option<String>> {
        match Self::entry(id)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AppError::new(
                "credential_store_unavailable",
                "The operating system could not read this saved AI key.",
            )),
        }
    }

    pub fn list(&self) -> AppResult<AiConnectionList> {
        let stored = self.load()?;
        let connections = stored
            .connections
            .into_iter()
            .map(|connection| {
                Ok(AiConnectionSummary {
                    has_api_key: Self::read_key(&connection.id)?.is_some(),
                    id: connection.id,
                    name: connection.name,
                    protocol: connection.protocol,
                    base_url: connection.base_url,
                    models: connection.models,
                    default_model: connection.default_model,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        Ok(AiConnectionList {
            connections,
            default_connection_id: stored.default_connection_id,
        })
    }

    pub fn save(&self, input: AiConnectionInput) -> AppResult<AiConnectionList> {
        let mut stored = self.load()?;
        let id = input.id.unwrap_or_else(|| Ulid::new().to_string());
        if !valid_connection_id(&id) {
            return Err(AppError::new(
                "invalid_identifier",
                "The AI connection id is invalid.",
            ));
        }
        let name = input.name.trim();
        if name.is_empty() || name.encode_utf16().count() > 160 {
            return Err(AppError::validation(
                "Enter a connection name with 1 to 160 characters.",
                json!({"field":"name"}),
            ));
        }
        let base_url = normalize_base_url(&input.base_url)?;
        validate_models(&input.models, &input.default_model)?;

        let previous_key = Self::read_key(&id)?;
        let next_key = input.api_key.filter(|key| !key.trim().is_empty());
        if let Some(key) = &next_key {
            if key.encode_utf16().count() > 4096 {
                return Err(AppError::validation(
                    "The API key is too long.",
                    json!({"field":"apiKey"}),
                ));
            }
            Self::entry(&id)?.set_password(key).map_err(|_| {
                AppError::new(
                    "credential_store_unavailable",
                    "The operating system could not save this AI key.",
                )
            })?;
        } else if input.remove_api_key {
            match Self::entry(&id)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => {
                    return Err(AppError::new(
                        "credential_store_unavailable",
                        "The operating system could not remove this AI key.",
                    ))
                }
            }
        }

        let connection = StoredConnection {
            id: id.clone(),
            name: name.to_string(),
            protocol: input.protocol,
            base_url,
            models: input.models,
            default_model: input.default_model,
        };
        if let Some(current) = stored.connections.iter_mut().find(|item| item.id == id) {
            *current = connection;
        } else {
            stored.connections.push(connection);
        }
        if stored.default_connection_id.is_none() {
            stored.default_connection_id = Some(id.clone());
        }
        if let Err(error) = self.save_store(&stored) {
            match previous_key {
                Some(key) => {
                    let _ = Self::entry(&id).and_then(|entry| {
                        entry
                            .set_password(&key)
                            .map_err(|_| AppError::internal("Credential rollback failed."))
                    });
                }
                None => {
                    let _ = Self::entry(&id).and_then(|entry| {
                        entry
                            .delete_credential()
                            .map_err(|_| AppError::internal("Credential rollback failed."))
                    });
                }
            }
            return Err(error);
        }
        self.list()
    }

    pub fn delete(&self, id: &str) -> AppResult<AiConnectionList> {
        if !valid_connection_id(id) {
            return Err(AppError::new(
                "invalid_identifier",
                "The AI connection id is invalid.",
            ));
        }
        let mut stored = self.load()?;
        if !stored
            .connections
            .iter()
            .any(|connection| connection.id == id)
        {
            return Err(AppError::new(
                "ai_connection_not_found",
                "The AI connection could not be found.",
            ));
        }
        let previous_key = Self::read_key(id)?;
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => {
                return Err(AppError::new(
                    "credential_store_unavailable",
                    "The operating system could not remove this AI key.",
                ));
            }
        }
        stored.connections.retain(|connection| connection.id != id);
        if stored.default_connection_id.as_deref() == Some(id) {
            stored.default_connection_id = stored
                .connections
                .first()
                .map(|connection| connection.id.clone());
        }
        if let Err(error) = self.save_store(&stored) {
            if let Some(key) = previous_key {
                let _ = Self::entry(id).and_then(|entry| {
                    entry
                        .set_password(&key)
                        .map_err(|_| AppError::internal("Credential rollback failed."))
                });
            }
            return Err(error);
        }
        self.list()
    }

    pub fn set_default(&self, id: Option<String>) -> AppResult<AiConnectionList> {
        let mut stored = self.load()?;
        if id.as_ref().is_some_and(|id| {
            !stored
                .connections
                .iter()
                .any(|connection| &connection.id == id)
        }) {
            return Err(AppError::new(
                "ai_connection_not_found",
                "The AI connection could not be found.",
            ));
        }
        stored.default_connection_id = id;
        self.save_store(&stored)?;
        self.list()
    }

    fn get_connection(&self, id: &str) -> AppResult<StoredConnection> {
        let stored = self.load()?;
        stored
            .connections
            .into_iter()
            .find(|connection| connection.id == id)
            .ok_or_else(|| {
                AppError::new(
                    "ai_connection_not_found",
                    "The AI connection could not be found.",
                )
            })
    }

    fn default_connection(&self) -> AppResult<(StoredConnection, Option<String>)> {
        let stored = self.load()?;
        let id = stored.default_connection_id.ok_or_else(|| {
            AppError::new(
                "ai_connection_not_configured",
                "Choose an AI connection in Settings before extracting a document.",
            )
        })?;
        let connection = stored
            .connections
            .into_iter()
            .find(|connection| connection.id == id)
            .ok_or_else(|| {
                AppError::new(
                    "ai_connection_not_configured",
                    "Choose an AI connection in Settings before extracting a document.",
                )
            })?;
        Ok((connection, Self::read_key(&id)?))
    }

    pub async fn discover_models(
        &self,
        request: AiModelDiscoveryRequest,
    ) -> AppResult<ModelDiscoveryResult> {
        discovery::discover_models(self, request).await
    }

    pub async fn test_connection(&self, request: AiModelDiscoveryRequest) -> AppResult<()> {
        discovery::test_connection(self, request).await
    }

    pub async fn extract_run(
        &self,
        repository: &RunRepository,
        id: &str,
        prompt: &str,
    ) -> AppResult<String> {
        let (connection, api_key) = self.default_connection()?;
        let model = connection
            .models
            .iter()
            .find(|profile| profile.model == connection.default_model)
            .ok_or_else(|| {
                AppError::new(
                    "invalid_ai_config",
                    "The default model is missing from its connection.",
                )
            })?;
        let files = load_source_files(repository, id)?;
        if files.is_empty() {
            return Err(AppError::validation(
                "Add at least one source file before extracting.",
                json!({"field":"attachments"}),
            ));
        }
        let endpoint = normalize_base_url(&connection.base_url)?;
        let payload = build_extraction_payload(connection.protocol, &model.model, prompt, &files)?;
        let url = match connection.protocol {
            AiProtocol::Responses => format!("{endpoint}/responses"),
            AiProtocol::ChatCompletions => format!("{endpoint}/chat/completions"),
        };
        let response = client()?
            .post(url)
            .headers(auth_headers(api_key.as_deref())?)
            .json(&payload)
            .send()
            .await
            .map_err(ai_transport_error)?;
        if !response.status().is_success() {
            return Err(ai_status_error(response.status().as_u16(), true));
        }
        let value = read_json_response(response).await?;
        extract_response_text(connection.protocol, &value)
    }
}

fn valid_connection_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.len() == 26
        && bytes.first().is_some_and(|byte| (b'0'..=b'7').contains(byte))
        && bytes[1..].iter().all(|byte| {
            matches!(*byte, b'0'..=b'9' | b'A'..=b'H' | b'J'..=b'K' | b'M'..=b'N' | b'P'..=b'T' | b'V'..=b'Z')
        })
}

fn validate_models(models: &[AiModelProfile], default_model: &str) -> AppResult<()> {
    if models.is_empty() || models.len() > 256 {
        return Err(AppError::validation(
            "Add between 1 and 256 models to this connection.",
            json!({"field":"models"}),
        ));
    }
    let mut ids = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    for model in models {
        if model.id.trim().is_empty()
            || model.id.len() > 100
            || model.model.trim().is_empty()
            || model.model.len() > 256
            || !ids.insert(model.id.clone())
            || !names.insert(model.model.clone())
        {
            return Err(AppError::validation(
                "Each model needs a unique id and model name.",
                json!({"field":"models"}),
            ));
        }
    }
    if !models.iter().any(|model| model.model == default_model) {
        return Err(AppError::validation(
            "Choose a model from this connection as the default.",
            json!({"field":"defaultModel"}),
        ));
    }
    Ok(())
}

pub(super) fn normalize_base_url(raw: &str) -> AppResult<String> {
    let mut url = Url::parse(raw.trim()).map_err(|_| {
        AppError::validation(
            "Enter a valid HTTPS AI endpoint.",
            json!({"field":"baseUrl"}),
        )
    })?;
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let parsed_ip = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>();
    let loopback = host == "localhost" || parsed_ip.is_ok_and(|ip| ip.is_loopback());
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::validation("AI endpoints must use HTTPS, or HTTP on this computer, and must not include credentials, a query, or a fragment.", json!({"field":"baseUrl"})));
    }
    let mut path = url.path().trim_end_matches('/').to_string();
    for suffix in ["/chat/completions", "/responses", "/models"] {
        if path.ends_with(suffix) {
            path.truncate(path.len() - suffix.len());
            break;
        }
    }
    if path.is_empty() {
        path = "/v1".to_string();
    }
    url.set_path(&path);
    let base = url.as_str().trim_end_matches('/').to_string();
    Ok(base)
}

fn client() -> AppResult<reqwest::Client> {
    client_with_timeout(Duration::from_secs(120))
}

pub(super) fn client_with_timeout(timeout: Duration) -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| {
            AppError::new(
                "ai_connection_failed",
                "The AI request could not be prepared.",
            )
        })
}

pub(super) fn auth_headers(api_key: Option<&str>) -> AppResult<reqwest::header::HeaderMap> {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(api_key) = api_key {
        let value =
            reqwest::header::HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|_| {
                AppError::new(
                    "invalid_ai_config",
                    "The saved AI key contains invalid characters.",
                )
            })?;
        headers.insert(reqwest::header::AUTHORIZATION, value);
    }
    Ok(headers)
}

fn ai_transport_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        return AppError::new(
            "ai_request_timeout",
            "The AI service did not respond within 120 seconds. Try again or choose a faster model.",
        );
    }
    AppError::new(
        "ai_connection_failed",
        "The AI service could not be reached. Check the connection and try again.",
    )
}

pub(super) fn ai_status_error(status: u16, extraction: bool) -> AppError {
    match status {
        400 | 415 | 422 if extraction => AppError::new(
            "ai_file_type_rejected",
            "The selected model or endpoint rejected a source file type or request format. Try another model or use Advanced import.",
        ),
        401 | 403 => AppError::new(
            "ai_authentication_failed",
            "The AI service rejected the connection credentials. Check the saved API key.",
        ),
        404 => AppError::new(
            "ai_endpoint_not_found",
            "The AI endpoint or selected model was not found. Check the endpoint and model settings.",
        ),
        429 => AppError::new(
            "ai_rate_limited",
            "The AI service is temporarily rate limited. Wait a moment and try again.",
        ),
        _ => AppError::new(
            "ai_connection_failed",
            format!("The AI service returned HTTP {status}. Check the connection and model settings."),
        ),
    }
}

pub(super) async fn read_json_response(response: reqwest::Response) -> AppResult<Value> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err(AppError::new(
            "ai_response_invalid",
            "The AI service returned a response that was too large.",
        ));
    }
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(ai_transport_error)?;
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(AppError::new(
                "ai_response_invalid",
                "The AI service returned a response that was too large.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| {
        AppError::new(
            "ai_response_invalid",
            "The AI service did not return a valid response.",
        )
    })
}

fn load_source_files(repository: &RunRepository, id: &str) -> AppResult<Vec<SourceFile>> {
    let metadata = repository.load(id)?;
    let run_dir = repository.run_dir(id)?;
    let canonical_run = fs::canonicalize(&run_dir)?;
    let mut files = Vec::new();
    let mut total_bytes = 0usize;
    for attachment in metadata.attachments {
        let filename = Path::new(&attachment.filename)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                AppError::new("invalid_run_artifact", "A source file name is invalid.")
            })?;
        if filename != attachment.filename {
            return Err(AppError::new(
                "invalid_run_artifact",
                "A source file name is invalid.",
            ));
        }
        let path = run_dir.join("input").join(filename);
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(AppError::new(
                "invalid_run_artifact",
                "A source file is not a regular file.",
            ));
        }
        let canonical = fs::canonicalize(&path)?;
        if !canonical.starts_with(&canonical_run) {
            return Err(AppError::new(
                "invalid_run_artifact",
                "A source file is outside its run folder.",
            ));
        }
        total_bytes = total_bytes.saturating_add(metadata.len() as usize);
        if total_bytes > MAX_REQUEST_BYTES {
            return Err(AppError::validation(
                "Selected source files exceed the 50 MB combined limit.",
                json!({"field":"attachments"}),
            ));
        }
        let extension = Path::new(filename)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let media_type = match extension.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "pdf" => "application/pdf",
            "txt" => "text/plain",
            "md" => "text/markdown",
            _ => {
                return Err(AppError::validation(
                    "One of the selected file types is not supported.",
                    json!({"file":filename}),
                ))
            }
        };
        let bytes = fs::read(path)?;
        total_bytes = total_bytes
            .saturating_sub(metadata.len() as usize)
            .saturating_add(bytes.len());
        if total_bytes > MAX_REQUEST_BYTES {
            return Err(AppError::validation(
                "Selected source files exceed the 50 MB combined limit.",
                json!({"field":"attachments"}),
            ));
        }
        files.push(SourceFile {
            filename: filename.to_string(),
            media_type: media_type.to_string(),
            bytes,
        });
    }
    Ok(files)
}

fn build_extraction_payload(
    protocol: AiProtocol,
    model: &str,
    prompt: &str,
    files: &[SourceFile],
) -> AppResult<Value> {
    let mut content = Vec::new();
    content.push(match protocol {
        AiProtocol::Responses => json!({"type":"input_text","text":prompt}),
        AiProtocol::ChatCompletions => json!({"type":"text","text":prompt}),
    });
    for file in files {
        let encoded = STANDARD.encode(&file.bytes);
        if file.media_type.starts_with("text/") {
            let text = std::str::from_utf8(&file.bytes).map_err(|_| {
                AppError::validation(
                    "A text source file is not valid UTF-8.",
                    json!({"file":file.filename}),
                )
            })?;
            content.push(match protocol {
                AiProtocol::Responses => json!({"type":"input_text","text":format!("Source file: {}\n{}",file.filename,text)}),
                AiProtocol::ChatCompletions => json!({"type":"text","text":format!("Source file: {}\n{}",file.filename,text)}),
            });
        } else if file.media_type == "application/pdf" {
            let data = format!("data:{};base64,{}", file.media_type, encoded);
            content.push(match protocol {
                AiProtocol::Responses => {
                    json!({"type":"input_file","filename":file.filename,"file_data":data})
                }
                AiProtocol::ChatCompletions => {
                    json!({"type":"file","file":{"filename":file.filename,"file_data":data}})
                }
            });
        } else {
            let data = format!("data:{};base64,{}", file.media_type, encoded);
            content.push(match protocol {
                AiProtocol::Responses => json!({"type":"input_image","image_url":data}),
                AiProtocol::ChatCompletions => json!({"type":"image_url","image_url":{"url":data}}),
            });
        }
    }
    Ok(match protocol {
        AiProtocol::Responses => {
            json!({"model":model,"input":[{"role":"user","content":content}],"store":false})
        }
        AiProtocol::ChatCompletions => {
            json!({"model":model,"messages":[{"role":"user","content":content}]})
        }
    })
}

fn extract_response_text(protocol: AiProtocol, value: &Value) -> AppResult<String> {
    if protocol == AiProtocol::ChatCompletions {
        if let Some(text) = value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
        {
            return Ok(text.to_string());
        }
        if let Some(parts) = value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_array)
        {
            let text = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<String>();
            if !text.is_empty() {
                return Ok(text);
            }
        }
    } else if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Ok(text.to_string());
    } else if let Some(items) = value.get("output").and_then(Value::as_array) {
        for item in items {
            if let Some(parts) = item.get("content").and_then(Value::as_array) {
                let text = parts
                    .iter()
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .collect::<String>();
                if !text.is_empty() {
                    return Ok(text);
                }
            }
        }
    }
    Err(AppError::new(
        "ai_response_invalid",
        "The AI service returned no extraction result. Try again or use Advanced import.",
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        ai_status_error, ai_transport_error, build_extraction_payload, client_with_timeout,
        extract_response_text, normalize_base_url, AiConnectionStore, SourceFile, KEYRING_SERVICE,
    };
    use fillforge_domain::docx::{DocumentRenderer, RenderInput, TemplateInspection};
    use fillforge_domain::model::{
        AiConnectionInput, AiModelProfile, AiProtocol, FieldDefinition, FieldType, TemplateBinding,
    };
    use fillforge_domain::{RunRepository, RunService, TemplateRepository, TemplateService};
    use indexmap::IndexMap;
    use serde_json::json;
    use serde_json::Value;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::thread::{self, JoinHandle};
    use std::time::Duration;
    use ulid::Ulid;

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join("fillforge-ai-tests")
                .join(Ulid::new().to_string());
            fs::create_dir_all(&path).expect("create AI test root");
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

    struct KeyCleanup(String);

    impl Drop for KeyCleanup {
        fn drop(&mut self) {
            if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &self.0) {
                let _ = entry.delete_credential();
            }
        }
    }

    struct MockRenderer;

    impl DocumentRenderer for MockRenderer {
        fn inspect(&self, _: &[u8]) -> fillforge_domain::AppResult<TemplateInspection> {
            Ok(TemplateInspection {
                placeholders: vec!["invoice_number".to_string()],
                unsupported_tags: Vec::new(),
            })
        }

        fn render(&self, input: RenderInput<'_>) -> fillforge_domain::AppResult<Vec<u8>> {
            let value = input
                .values
                .get("invoice_number")
                .map(Value::to_string)
                .unwrap_or_default();
            Ok(format!("mock-docx:{value}").into_bytes())
        }
    }

    fn mock_server(response: Value, delay: Duration) -> (String, JoinHandle<(String, String)>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock AI endpoint");
        let address = listener.local_addr().expect("mock endpoint address");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept AI request");
            let (request, body) = read_http_request(&mut stream);
            thread::sleep(delay);
            let response = response.to_string();
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            );
            let _ = stream.write_all(reply.as_bytes());
            (request, body)
        });
        (format!("http://{address}/v1"), handle)
    }

    fn read_http_request(stream: &mut TcpStream) -> (String, String) {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let count = stream.read(&mut chunk).expect("read AI request");
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..count]);
            if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&bytes[..header_end]);
                let content_length = header
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or_default();
                if bytes.len() >= header_end + 4 + content_length {
                    let body = String::from_utf8_lossy(
                        &bytes[header_end + 4..header_end + 4 + content_length],
                    )
                    .to_string();
                    return (header.to_string(), body);
                }
            }
        }
        (String::from_utf8_lossy(&bytes).to_string(), String::new())
    }

    fn source(filename: &str, media_type: &str, bytes: &[u8]) -> SourceFile {
        SourceFile {
            filename: filename.to_string(),
            media_type: media_type.to_string(),
            bytes: bytes.to_vec(),
        }
    }

    #[test]
    fn responses_payload_uses_file_and_image_input_parts() {
        let files = [
            source("contract.pdf", "application/pdf", b"pdf bytes"),
            source("photo.png", "image/png", b"image bytes"),
            source("notes.md", "text/markdown", b"hello"),
        ];

        let payload = build_extraction_payload(AiProtocol::Responses, "model-a", "prompt", &files)
            .expect("build Responses request");

        let content = payload
            .pointer("/input/0/content")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(content[0]["type"], "input_text");
        assert_eq!(content[1]["type"], "input_file");
        assert_eq!(content[1]["filename"], "contract.pdf");
        assert!(content[1]["file_data"]
            .as_str()
            .unwrap()
            .starts_with("data:application/pdf;base64,"));
        assert_eq!(content[2]["type"], "input_image");
        assert!(content[2]["image_url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(content[3]["type"], "input_text");
        assert!(content[3]["text"]
            .as_str()
            .unwrap()
            .contains("Source file: notes.md"));
        assert_eq!(payload["store"], false);
    }

    #[test]
    fn chat_completions_payload_uses_documented_file_parts() {
        let files = [
            source("contract.pdf", "application/pdf", b"pdf bytes"),
            source("photo.jpg", "image/jpeg", b"image bytes"),
            source("notes.txt", "text/plain", b"hello"),
        ];

        let payload =
            build_extraction_payload(AiProtocol::ChatCompletions, "model-b", "prompt", &files)
                .expect("build Chat Completions request");

        let content = payload
            .pointer("/messages/0/content")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(content[1]["type"], "file");
        assert_eq!(content[1]["file"]["filename"], "contract.pdf");
        assert!(content[1]["file"]["file_data"]
            .as_str()
            .unwrap()
            .starts_with("data:application/pdf;base64,"));
        assert_eq!(content[2]["type"], "image_url");
        assert!(content[2]["image_url"]["url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/jpeg;base64,"));
        assert_eq!(content[3]["type"], "text");
        assert!(content[3]["text"]
            .as_str()
            .unwrap()
            .contains("Source file: notes.txt"));
    }

    #[test]
    fn endpoint_validation_allows_https_and_loopback_http_only() {
        assert_eq!(
            normalize_base_url("https://example.com").unwrap(),
            "https://example.com/v1"
        );
        assert_eq!(
            normalize_base_url("http://localhost:1234/v1/responses").unwrap(),
            "http://localhost:1234/v1"
        );
        assert!(normalize_base_url("http://127.12.0.9:1234/v1").is_ok());
        assert!(normalize_base_url("http://[::1]:1234/v1").is_ok());
        assert!(normalize_base_url("http://example.com/v1").is_err());
        assert!(normalize_base_url("https://user:secret@example.com/v1").is_err());
    }

    #[test]
    fn extraction_rejects_provider_file_errors_with_actionable_message() {
        let error = ai_status_error(415, true);
        assert_eq!(error.code, "ai_file_type_rejected");
        assert!(error.message.contains("source file type"));
        assert_eq!(ai_status_error(415, false).code, "ai_connection_failed");
    }

    #[test]
    fn malformed_provider_output_is_rejected_for_retry() {
        let error = extract_response_text(AiProtocol::Responses, &serde_json::json!({"output":[]}))
            .expect_err("missing extraction output should fail");
        assert_eq!(error.code, "ai_response_invalid");
    }

    #[test]
    fn local_mock_endpoint_completes_extraction_review_and_render_flow() {
        let root = TestRoot::new();
        let secret = format!("fillforge-test-key-{}", Ulid::new());
        let template_document = root.path("template.docx");
        fs::write(&template_document, b"mock template").expect("write mock template");

        let renderer: Arc<dyn DocumentRenderer> = Arc::new(MockRenderer);
        let template_repository = Arc::new(TemplateRepository::new(root.path("templates")));
        let mut fields = IndexMap::new();
        fields.insert(
            "invoice_number".to_string(),
            FieldDefinition {
                label: "Invoice number".to_string(),
                field_type: FieldType::String,
                required: true,
                ..FieldDefinition::default()
            },
        );
        let mut bindings = IndexMap::new();
        bindings.insert(
            "invoice_number".to_string(),
            TemplateBinding {
                source: "invoice_number".to_string(),
                transform: None,
            },
        );
        template_repository
            .create(
                "invoice",
                "Invoice",
                None,
                &template_document,
                fields,
                bindings,
            )
            .expect("create test template");
        let template_service =
            Arc::new(TemplateService::new(template_repository, renderer.clone()));
        let run_repository = Arc::new(RunRepository::new(root.path("runs")));
        let run_service = RunService::new(
            run_repository.clone(),
            template_service,
            renderer,
            "test-prompt".to_string(),
        );
        let source = root.path("invoice.txt");
        fs::write(&source, "Invoice number: INV-17").expect("write source file");
        let run = run_service.create_run("invoice").expect("create run");
        run_service
            .add_attachment(&run.id, &source, "invoice.txt")
            .expect("attach source file");
        let prompt = run_service
            .generate_prompt(&run.id)
            .expect("generate prompt");

        let (endpoint, server) = mock_server(
            json!({
                "output_text": "{\"invoice_number\":{\"value\":\"INV-17\",\"status\":\"found\",\"evidence\":\"Invoice number: INV-17\"}}"
            }),
            Duration::ZERO,
        );
        let connections = AiConnectionStore::new(&root.path("config"));
        let connection_list = connections
            .save(AiConnectionInput {
                id: None,
                name: "Local test endpoint".to_string(),
                protocol: AiProtocol::Responses,
                base_url: endpoint,
                models: vec![AiModelProfile {
                    id: "mock-model".to_string(),
                    model: "mock-model".to_string(),
                    label: Some("Mock model".to_string()),
                }],
                default_model: "mock-model".to_string(),
                api_key: Some(secret.clone()),
                remove_api_key: false,
            })
            .expect("save mock connection");
        let connection_id = connection_list.connections[0].id.clone();
        let _key_cleanup = KeyCleanup(connection_id.clone());
        assert!(connection_list.connections[0].has_api_key);
        let config = fs::read_to_string(root.path("config/ai-connections.json"))
            .expect("read connection metadata");
        assert!(!config.contains(&secret));

        let runtime = tokio::runtime::Runtime::new().expect("create AI test runtime");
        let raw = runtime
            .block_on(connections.extract_run(&run_repository, &run.id, &prompt))
            .expect("extract through mock endpoint");
        let (headers, request_body) = server.join().expect("mock server thread");
        assert!(headers.contains("POST /v1/responses"));
        assert!(headers
            .to_ascii_lowercase()
            .contains(&format!("authorization: bearer {secret}").to_ascii_lowercase()));
        let request: Value = serde_json::from_str(&request_body).expect("parse captured request");
        assert_eq!(
            request
                .pointer("/input/0/content/0/text")
                .and_then(Value::as_str),
            Some(prompt.as_str())
        );
        assert!(request
            .pointer("/input/0/content/1/text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("Invoice number: INV-17"));

        let imported = run_service
            .import_extraction(&run.id, &raw)
            .expect("validate and store AI result");
        assert!(imported.issues.is_empty());
        let corrected = serde_json::Value::String("INV-17-CORRECTED".to_string());
        let review = run_service
            .save_review(
                &run.id,
                &IndexMap::from([("invoice_number".to_string(), corrected)]),
            )
            .expect("save corrected review");
        assert!(review.issues.is_empty());
        let output = run_service
            .render_run(&run.id)
            .expect("render reviewed document");
        assert_eq!(
            fs::read(output.path).unwrap(),
            b"mock-docx:\"INV-17-CORRECTED\""
        );
        assert_eq!(run_repository.list_outputs(&run.id).unwrap().len(), 2);
        connections
            .delete(&connection_id)
            .expect("remove mock connection");
    }

    #[test]
    fn provider_timeout_is_reported_as_retryable_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind slow AI endpoint");
        let address = listener.local_addr().expect("slow endpoint address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept slow request");
            let _ = read_http_request(&mut stream);
            thread::sleep(Duration::from_millis(120));
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        });
        let request = client_with_timeout(Duration::from_millis(20))
            .expect("create short-timeout client")
            .get(format!("http://{address}/slow"));
        let runtime = tokio::runtime::Runtime::new().expect("create timeout test runtime");
        let error = runtime
            .block_on(async move { request.send().await })
            .expect_err("request should time out");
        assert_eq!(ai_transport_error(error).code, "ai_request_timeout");
        server.join().expect("slow endpoint thread");
    }
}
