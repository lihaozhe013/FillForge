use super::{
    ai_status_error, auth_headers, client_with_timeout, normalize_base_url, read_json_response,
    AiConnectionStore,
};
use fillforge_domain::error::{AppError, AppResult};
use fillforge_domain::model::{
    AiModelDiscoveryRequest, AiProtocol, ModelDiscoveryResult, ModelDiscoverySource,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::future::Future;
use std::time::Duration;

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_MODELS: usize = 4096;

struct EffectiveConnection {
    protocol: AiProtocol,
    base_url: String,
    model: Option<String>,
    api_key: Option<String>,
}

fn resolve_request(
    store: &AiConnectionStore,
    request: AiModelDiscoveryRequest,
) -> AppResult<EffectiveConnection> {
    let saved_connection = request
        .id
        .as_deref()
        .map(|id| store.get_connection(id))
        .transpose()?;
    let should_read_saved_key = request.use_saved_api_key
        && request
            .api_key
            .as_deref()
            .is_none_or(|api_key| api_key.trim().is_empty());
    let saved_key = if should_read_saved_key {
        request
            .id
            .as_deref()
            .map(AiConnectionStore::read_key)
            .transpose()?
            .flatten()
    } else {
        None
    };
    let saved = saved_connection.map(|connection| (connection, saved_key));
    resolve_request_parts(request, saved)
}

fn resolve_request_parts(
    request: AiModelDiscoveryRequest,
    saved: Option<(super::StoredConnection, Option<String>)>,
) -> AppResult<EffectiveConnection> {
    if request
        .base_url
        .as_ref()
        .is_some_and(|base_url| base_url.encode_utf16().count() > 2048)
        || request
            .model
            .as_ref()
            .is_some_and(|model| model.encode_utf16().count() > 256)
        || request
            .api_key
            .as_ref()
            .is_some_and(|api_key| api_key.encode_utf16().count() > 4096)
    {
        return Err(AppError::validation(
            "The AI connection request contains a value that is too long.",
            json!({"field":"connection"}),
        ));
    }
    let protocol = request
        .protocol
        .or_else(|| saved.as_ref().map(|(connection, _)| connection.protocol))
        .ok_or_else(|| {
            AppError::validation(
                "Choose an AI protocol before discovering models.",
                json!({"field":"protocol"}),
            )
        })?;
    let base_url = request
        .base_url
        .or_else(|| {
            saved
                .as_ref()
                .map(|(connection, _)| connection.base_url.clone())
        })
        .ok_or_else(|| {
            AppError::validation(
                "Enter an AI endpoint before discovering models.",
                json!({"field":"baseUrl"}),
            )
        })?;
    let model = match request.model {
        Some(model) => non_empty(model),
        None => saved
            .as_ref()
            .and_then(|(connection, _)| non_empty(connection.default_model.clone())),
    };
    let api_key = request
        .api_key
        .filter(|key| !key.trim().is_empty())
        .or_else(|| {
            request
                .use_saved_api_key
                .then(|| saved.as_ref().and_then(|(_, key)| key.clone()))
                .flatten()
        });

    Ok(EffectiveConnection {
        protocol,
        base_url: normalize_base_url(&base_url)?,
        model,
        api_key,
    })
}

fn non_empty(value: String) -> Option<String> {
    let value = value.trim().to_string();
    (!value.is_empty()).then_some(value)
}

pub(super) async fn discover_models(
    store: &AiConnectionStore,
    request: AiModelDiscoveryRequest,
) -> AppResult<ModelDiscoveryResult> {
    let connection = resolve_request(store, request)?;
    let client = client_with_timeout(Duration::from_secs(120))?;
    with_timeout(DISCOVERY_TIMEOUT, async move {
        let listing = list_models(&client, &connection).await;
        match listing {
            Ok(result) => Ok(result),
            Err(error) if error.code == "ai_request_timeout" => Err(error),
            Err(_list_error) if connection.protocol == AiProtocol::Responses => {
                let Some(model) = connection.model.as_deref() else {
                    return Err(AppError::new(
                        "ai_model_required_for_fallback",
                        "Enter a model name to verify this Responses endpoint when it cannot list models.",
                    ));
                };
                validate_responses_model(&client, &connection, model).await
            }
            Err(error) => Err(error),
        }
    })
    .await
}

pub(super) async fn test_connection(
    store: &AiConnectionStore,
    request: AiModelDiscoveryRequest,
) -> AppResult<()> {
    let connection = resolve_request(store, request)?;
    let model = connection.model.clone().ok_or_else(|| {
        AppError::validation(
            "Choose or discover a model before testing this connection.",
            json!({"field":"model"}),
        )
    })?;
    let client = client_with_timeout(Duration::from_secs(120))?;
    with_timeout(DISCOVERY_TIMEOUT, async move {
        test_connection_request(&client, &connection, &model).await
    })
    .await
}

async fn with_timeout<T, F>(duration: Duration, future: F) -> AppResult<T>
where
    F: Future<Output = AppResult<T>>,
{
    tokio::time::timeout(duration, future)
        .await
        .map_err(|_| timeout_error())?
}

async fn list_models(
    client: &reqwest::Client,
    connection: &EffectiveConnection,
) -> AppResult<ModelDiscoveryResult> {
    let response = client
        .get(format!("{}/models", connection.base_url))
        .header(reqwest::header::ACCEPT, "application/json")
        .headers(auth_headers(connection.api_key.as_deref())?)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                timeout_error()
            } else {
                AppError::new(
                    "ai_connection_failed",
                    "The AI service could not be reached while listing models.",
                )
            }
        })?;
    if !response.status().is_success() {
        return Err(ai_status_error(response.status().as_u16(), false));
    }
    let value = read_json_response(response).await?;
    let models = parse_models(&value)?;
    if models.0.is_empty() {
        return Err(AppError::new(
            "ai_models_empty",
            "The AI service returned no models.",
        ));
    }
    Ok(ModelDiscoveryResult {
        models: models.0,
        truncated: models.1,
        source: ModelDiscoverySource::Catalog,
    })
}

fn parse_models(value: &Value) -> AppResult<(Vec<String>, bool)> {
    let entries = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.as_array())
        .ok_or_else(|| {
            AppError::new(
                "ai_connection_failed",
                "The AI service returned an unsupported model list.",
            )
        })?;
    let mut models = Vec::new();
    let mut seen = HashSet::with_capacity(MAX_MODELS);
    for entry in entries {
        let id = entry
            .as_str()
            .or_else(|| entry.get("id").and_then(Value::as_str));
        let Some(id) = id.filter(|id| !id.is_empty() && id.len() <= 256) else {
            continue;
        };
        if seen.contains(id) {
            continue;
        }
        if models.len() == MAX_MODELS {
            return Ok((models, true));
        }
        let id = id.to_string();
        seen.insert(id.clone());
        models.push(id);
    }
    Ok((models, false))
}

async fn validate_responses_model(
    client: &reqwest::Client,
    connection: &EffectiveConnection,
    model: &str,
) -> AppResult<ModelDiscoveryResult> {
    let response = client
        .post(format!("{}/responses", connection.base_url))
        .headers(auth_headers(connection.api_key.as_deref())?)
        .json(&json!({
            "model": model,
            "input": [{"role":"user","content":"Reply with OK."}],
            "stream": false,
            "store": false
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                timeout_error()
            } else {
                AppError::new(
                    "ai_connection_failed",
                    "The Responses endpoint could not be reached while verifying the model.",
                )
            }
        })?;
    if !response.status().is_success() {
        return Err(ai_status_error(response.status().as_u16(), false));
    }
    Ok(ModelDiscoveryResult {
        models: vec![model.to_string()],
        truncated: false,
        source: ModelDiscoverySource::ValidatedModel,
    })
}

async fn test_connection_request(
    client: &reqwest::Client,
    connection: &EffectiveConnection,
    model: &str,
) -> AppResult<()> {
    let (url, body) = match connection.protocol {
        AiProtocol::Responses => (
            format!("{}/responses", connection.base_url),
            json!({
                "model": model,
                "input": [{"role":"user","content":"Reply with OK."}],
                "stream": false,
                "store": false
            }),
        ),
        AiProtocol::ChatCompletions => (
            format!("{}/chat/completions", connection.base_url),
            json!({
                "model": model,
                "messages": [{"role":"user","content":"Reply with OK."}],
                "stream": false
            }),
        ),
    };
    let response = client
        .post(url)
        .headers(auth_headers(connection.api_key.as_deref())?)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                timeout_error()
            } else {
                AppError::new(
                    "ai_connection_failed",
                    "The AI service could not be reached. Check the connection and try again.",
                )
            }
        })?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(ai_status_error(response.status().as_u16(), false))
    }
}

fn timeout_error() -> AppError {
    AppError::new(
        "ai_request_timeout",
        "Model discovery or connection testing timed out after 15 seconds.",
    )
}

#[cfg(test)]
mod tests {
    use super::{
        discover_models, parse_models, resolve_request_parts, test_connection, with_timeout,
        MAX_MODELS,
    };
    use crate::ai::{AiConnectionStore, StoredConnection, KEYRING_SERVICE};
    use fillforge_domain::model::{
        AiConnectionInput, AiModelDiscoveryRequest, AiModelProfile, AiProtocol,
        ModelDiscoverySource,
    };
    use serde_json::json;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::thread::{self, JoinHandle};
    use std::time::Duration;
    use ulid::Ulid;

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("fillforge-discovery-{}", Ulid::new()));
            fs::create_dir_all(&path).expect("create discovery test root");
            Self(path)
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

    fn request(protocol: AiProtocol, base_url: String) -> AiModelDiscoveryRequest {
        AiModelDiscoveryRequest {
            id: None,
            protocol: Some(protocol),
            base_url: Some(base_url),
            model: None,
            api_key: None,
            use_saved_api_key: false,
        }
    }

    fn mock_server(replies: Vec<(u16, String)>) -> (String, JoinHandle<Vec<(String, String)>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind discovery mock endpoint");
        let address = listener.local_addr().expect("read discovery mock address");
        let handle = thread::spawn(move || {
            replies
                .into_iter()
                .map(|(status, body)| {
                    let (mut stream, _) = listener.accept().expect("accept discovery request");
                    let request = read_request(&mut stream);
                    let reason = if status < 400 { "OK" } else { "Error" };
                    let response = format!(
                        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(), body
                    );
                    stream
                        .write_all(response.as_bytes())
                        .expect("write discovery response");
                    request
                })
                .collect()
        });
        (format!("http://{address}/v1"), handle)
    }

    fn read_request(stream: &mut TcpStream) -> (String, String) {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let count = stream.read(&mut chunk).expect("read discovery request");
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

    #[test]
    fn parses_deduplicated_model_catalogs_and_accepts_top_level_arrays() {
        let (models, truncated) = parse_models(&json!([
            {"id":"model-a"},
            {"id":"model-b"},
            {"id":"model-a"},
            {"name":"ignored"},
            "model-c"
        ]))
        .expect("parse model catalog");
        assert_eq!(models, ["model-a", "model-b", "model-c"]);
        assert!(!truncated);
    }

    #[test]
    fn bounds_catalogs_at_the_shared_ipc_limit() {
        let entries = (0..=MAX_MODELS)
            .map(|index| json!({"id":format!("model-{index}")}))
            .collect::<Vec<_>>();
        let (models, truncated) =
            parse_models(&json!({"data":entries})).expect("parse bounded model catalog");
        assert_eq!(models.len(), MAX_MODELS);
        assert!(truncated);
    }

    #[test]
    fn unsaved_chat_connection_discovers_models_from_the_current_draft() {
        let root = TestRoot::new();
        let (endpoint, server) = mock_server(vec![(
            200,
            json!({"data":[{"id":"model-a"},{"id":"model-b"}]}).to_string(),
        )]);
        let store = AiConnectionStore::new(&root.0);
        let mut request = request(AiProtocol::ChatCompletions, endpoint);
        request.api_key = Some("draft-secret".to_string());

        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        let result = runtime
            .block_on(discover_models(&store, request))
            .expect("discover models from unsaved draft");
        let requests = server.join().expect("join discovery mock server");

        assert_eq!(result.models, ["model-a", "model-b"]);
        assert_eq!(result.source, ModelDiscoverySource::Catalog);
        assert!(requests[0].0.starts_with("GET /v1/models"));
        assert!(requests[0]
            .0
            .to_ascii_lowercase()
            .contains("authorization: bearer draft-secret"));
    }

    #[test]
    fn saved_connection_uses_its_credential_with_the_current_draft_endpoint() {
        let root = TestRoot::new();
        let secret = format!("fillforge-discovery-key-{}", Ulid::new());
        let (endpoint, server) =
            mock_server(vec![(200, json!({"data":[{"id":"model-a"}]}).to_string())]);
        let store = AiConnectionStore::new(&root.0);
        let saved = store
            .save(AiConnectionInput {
                id: None,
                name: "Saved local connection".to_string(),
                protocol: AiProtocol::Responses,
                base_url: "https://saved.example/v1".to_string(),
                models: vec![AiModelProfile {
                    id: "saved-model".to_string(),
                    model: "saved-model".to_string(),
                    label: None,
                }],
                default_model: "saved-model".to_string(),
                api_key: Some(secret.clone()),
                remove_api_key: false,
            })
            .expect("save test connection");
        let id = saved.connections[0].id.clone();
        let _key_cleanup = KeyCleanup(id.clone());
        let mut request = request(AiProtocol::ChatCompletions, endpoint.clone());
        request.id = Some(id);
        request.model = Some("draft-model".to_string());
        request.use_saved_api_key = true;

        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        runtime
            .block_on(discover_models(&store, request))
            .expect("discover using saved key and draft endpoint");
        let requests = server.join().expect("join discovery mock server");

        assert!(requests[0].0.starts_with("GET /v1/models"));
        assert!(requests[0]
            .0
            .to_ascii_lowercase()
            .contains(&format!("authorization: bearer {secret}").to_ascii_lowercase()));
    }

    #[test]
    fn responses_catalog_failure_verifies_the_current_model_without_storing_it() {
        let root = TestRoot::new();
        let (endpoint, server) = mock_server(vec![
            (404, "not listed".to_string()),
            (200, json!({"id":"response-1"}).to_string()),
        ]);
        let store = AiConnectionStore::new(&root.0);
        let mut request = request(AiProtocol::Responses, endpoint);
        request.model = Some("draft-model".to_string());
        request.api_key = Some("draft-secret".to_string());

        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        let result = runtime
            .block_on(discover_models(&store, request))
            .expect("verify configured Responses model");
        let requests = server.join().expect("join discovery mock server");

        assert_eq!(result.models, ["draft-model"]);
        assert_eq!(result.source, ModelDiscoverySource::ValidatedModel);
        assert!(requests[0].0.starts_with("GET /v1/models"));
        assert!(requests[1].0.starts_with("POST /v1/responses"));
        assert!(requests[1]
            .0
            .to_ascii_lowercase()
            .contains("authorization: bearer draft-secret"));
        let body: serde_json::Value = serde_json::from_str(&requests[1].1).expect("parse request");
        assert_eq!(body["model"], "draft-model");
        assert_eq!(body["stream"], false);
        assert_eq!(body["store"], false);
        assert_eq!(body["input"][0]["content"], "Reply with OK.");
        assert!(body.get("files").is_none());
    }

    #[test]
    fn responses_empty_and_malformed_catalogs_use_the_model_verification_fallback() {
        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        for catalog in [json!({"data": []}), json!({"unexpected": true})] {
            let root = TestRoot::new();
            let (endpoint, server) = mock_server(vec![
                (200, catalog.to_string()),
                (200, json!({"id":"response-1"}).to_string()),
            ]);
            let store = AiConnectionStore::new(&root.0);
            let mut request = request(AiProtocol::Responses, endpoint);
            request.model = Some("draft-model".to_string());
            let result = runtime
                .block_on(discover_models(&store, request))
                .expect("fallback after unusable model catalog");
            let requests = server.join().expect("join discovery mock server");
            assert_eq!(result.source, ModelDiscoverySource::ValidatedModel);
            assert_eq!(requests.len(), 2);
            assert!(requests[1].0.starts_with("POST /v1/responses"));
        }
    }

    #[test]
    fn responses_catalog_failure_without_a_model_has_an_actionable_error() {
        let root = TestRoot::new();
        let (endpoint, server) = mock_server(vec![(404, "not listed".to_string())]);
        let store = AiConnectionStore::new(&root.0);
        let request = request(AiProtocol::Responses, endpoint);
        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        let error = runtime
            .block_on(discover_models(&store, request))
            .expect_err("model name required for fallback");
        let requests = server.join().expect("join discovery mock server");

        assert_eq!(requests.len(), 1);
        assert_eq!(error.code, "ai_model_required_for_fallback");
        assert!(error.message.contains("Enter a model name"));
    }

    #[test]
    fn failed_responses_verification_returns_authentication_error() {
        let root = TestRoot::new();
        let (endpoint, server) = mock_server(vec![
            (404, "not listed".to_string()),
            (401, "provider details are not exposed".to_string()),
        ]);
        let store = AiConnectionStore::new(&root.0);
        let mut request = request(AiProtocol::Responses, endpoint);
        request.model = Some("draft-model".to_string());
        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        let error = runtime
            .block_on(discover_models(&store, request))
            .expect_err("authentication failure expected");
        let requests = server.join().expect("join discovery mock server");

        assert_eq!(requests.len(), 2);
        assert_eq!(error.code, "ai_authentication_failed");
        assert!(!error.message.contains("provider details"));
    }

    #[test]
    fn chat_catalog_errors_do_not_fall_back_to_a_request() {
        let root = TestRoot::new();
        let (endpoint, server) = mock_server(vec![(404, "not listed".to_string())]);
        let store = AiConnectionStore::new(&root.0);
        let request = request(AiProtocol::ChatCompletions, endpoint);
        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        let error = runtime
            .block_on(discover_models(&store, request))
            .expect_err("Chat Completions catalog error");
        let requests = server.join().expect("join discovery mock server");

        assert_eq!(requests.len(), 1);
        assert_eq!(error.code, "ai_endpoint_not_found");
    }

    #[test]
    fn saved_draft_values_override_saved_connection_values_and_can_suppress_its_key() {
        let saved = StoredConnection {
            id: "saved-connection".to_string(),
            name: "Saved".to_string(),
            protocol: AiProtocol::Responses,
            base_url: "https://saved.example/v1".to_string(),
            models: vec![AiModelProfile {
                id: "saved-model".to_string(),
                model: "saved-model".to_string(),
                label: None,
            }],
            default_model: "saved-model".to_string(),
        };
        let request = AiModelDiscoveryRequest {
            id: Some(saved.id.clone()),
            protocol: Some(AiProtocol::ChatCompletions),
            base_url: Some("http://localhost:9912/v1".to_string()),
            model: Some("draft-model".to_string()),
            api_key: None,
            use_saved_api_key: false,
        };
        let connection =
            resolve_request_parts(request, Some((saved, Some("saved-secret".to_string()))))
                .expect("resolve edited saved connection");

        assert_eq!(connection.protocol, AiProtocol::ChatCompletions);
        assert_eq!(connection.base_url, "http://localhost:9912/v1");
        assert_eq!(connection.model.as_deref(), Some("draft-model"));
        assert_eq!(connection.api_key, None);
    }

    #[test]
    fn connection_test_can_use_an_unsaved_draft() {
        let root = TestRoot::new();
        let (endpoint, server) = mock_server(vec![(200, "{}".to_string())]);
        let store = AiConnectionStore::new(&root.0);
        let mut request = request(AiProtocol::ChatCompletions, endpoint);
        request.model = Some("draft-model".to_string());
        request.api_key = Some("draft-secret".to_string());
        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        runtime
            .block_on(test_connection(&store, request))
            .expect("test unsaved connection");
        let requests = server.join().expect("join discovery mock server");
        assert!(requests[0].0.starts_with("POST /v1/chat/completions"));
        let body: serde_json::Value = serde_json::from_str(&requests[0].1).expect("parse request");
        assert_eq!(body["model"], "draft-model");
        assert_eq!(body["stream"], false);
    }

    #[test]
    fn discovery_timeout_is_bounded() {
        let runtime = tokio::runtime::Runtime::new().expect("create discovery runtime");
        let result = runtime.block_on(with_timeout(Duration::from_millis(1), async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Ok::<_, fillforge_domain::AppError>(())
        }));
        assert_eq!(
            result.expect_err("timeout expected").code,
            "ai_request_timeout"
        );
    }
}
