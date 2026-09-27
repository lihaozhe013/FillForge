use crate::config::DEFAULT_PROMPT_VERSION;
use crate::error::{AppError, AppResult};
use crate::model::{
    AppErrorDto, ExtractionIssue, ExtractionResult, ExtractionStatus, FieldDefinition,
    FieldDefinitions, FieldType, GeneratedPrompt, TemplateSchema,
};
use chrono::NaiveDate;
use indexmap::IndexMap;
use regex::Regex;
use serde_json::{Map, Value};

fn build_issue(
    field: &str,
    code: &str,
    message: String,
    message_key: Option<&str>,
    mut message_args: IndexMap<String, String>,
) -> ExtractionIssue {
    message_args.insert("field".to_string(), field.to_string());
    ExtractionIssue {
        field: field.to_string(),
        code: code.to_string(),
        message,
        message_key: message_key.map(str::to_string),
        message_args: Some(message_args),
    }
}

fn message_args(entries: impl IntoIterator<Item = (String, String)>) -> IndexMap<String, String> {
    entries.into_iter().collect()
}

pub fn build_expected_json(fields: &FieldDefinitions) -> String {
    let mut shape = Map::new();
    for (key, field) in fields {
        let value_type = match field.field_type {
            FieldType::Number => "number or null".to_string(),
            FieldType::Boolean => "boolean or null".to_string(),
            FieldType::Date => format!(
                "date string ({}) or null",
                field
                    .output
                    .as_ref()
                    .and_then(|o| o.format.as_ref())
                    .map(String::as_str)
                    .unwrap_or("YYYY-MM-DD")
            ),
            FieldType::String => "string or null".to_string(),
        };
        shape.insert(key.clone(), serde_json::json!({"value":value_type,"status":"found | not_found | ambiguous","evidence":"short supporting text or null"}));
    }
    serde_json::to_string_pretty(&Value::Object(shape)).unwrap_or_else(|_| "{}".to_string())
}

fn describe_field(key: &str, field: &FieldDefinition) -> String {
    let kind = match field.field_type {
        FieldType::String => "string",
        FieldType::Number => "number",
        FieldType::Date => "date",
        FieldType::Boolean => "boolean",
    };
    let mut lines = vec![
        key.to_string(),
        format!("Meaning: {}", field.label),
        format!("Type: {kind}"),
        format!("Required: {}", if field.required { "yes" } else { "no" }),
    ];
    if let Some(description) = &field.description {
        lines.push(format!("Description: {description}"));
    }
    if let Some(instruction) = field
        .extraction
        .as_ref()
        .map(|e| e.instruction.trim())
        .filter(|s| !s.is_empty())
    {
        lines.push("Extraction rule:".to_string());
        lines.push(instruction.to_string());
    }
    lines.join("\n")
}

pub fn build_extraction_prompt(
    template: &TemplateSchema,
    prompt_version: Option<&str>,
) -> AppResult<GeneratedPrompt> {
    if template.fields.is_empty() {
        return Err(AppError::new("validation_failed", format!("Template \"{}\" has no configured fields; configure fields before generating a prompt.", template.id)));
    }
    let expected_json = build_expected_json(&template.fields);
    let requested_fields = template
        .fields
        .iter()
        .map(|(key, field)| describe_field(key, field))
        .collect::<Vec<_>>()
        .join("\n\n");
    let sections = [
        "You are a structured document information extractor.",
        "",
        "Inspect the documents/images supplied by the user.",
        "",
        "Extract only the requested fields.",
        "",
        "Do not guess.",
        "",
        "If a field cannot be reliably determined, set its value to null and describe why through the status and evidence fields.",
        "",
        "Requested fields:",
        "",
        &requested_fields,
        "",
        "For every field, determine one status: found, not_found, or ambiguous.",
        "",
        "Return valid JSON only, with no commentary before or after it.",
        "",
        "Expected format:",
        "",
        &expected_json,
    ];
    Ok(GeneratedPrompt {
        prompt: format!("{}\n", sections.join("\n")),
        expected_json,
        prompt_version: prompt_version.unwrap_or(DEFAULT_PROMPT_VERSION).to_string(),
    })
}

pub fn strip_markdown_fences(raw: &str) -> String {
    let text = raw.trim();
    if !text.starts_with("```") {
        return text.to_string();
    }
    let Some(opening_end) = text.find('\n') else {
        return text.to_string();
    };
    let closing_start = text.rfind("```").unwrap_or(0);
    if closing_start <= opening_end {
        return text.to_string();
    }
    text[opening_end + 1..closing_start].trim().to_string()
}

pub fn parse_extraction(raw: &str) -> AppResult<ExtractionResult> {
    let text = strip_markdown_fences(raw);
    let value: Value = serde_json::from_str(&text).map_err(|error| {
        AppError::new(
            "extraction_parse_failed",
            format!("The pasted extraction result is not valid JSON: {error}"),
        )
        .with_details(serde_json::json!({
            "messageKey": "details.invalidJsonSyntax",
            "messageArgs": {
                "line": error.line().to_string(),
                "column": error.column().to_string()
            },
            "message": error.to_string()
        }))
    })?;
    let Some(object) = value.as_object() else {
        return Err(AppError::validation(
            "The extraction result does not match the expected structure (fields need value, status, evidence).",
            serde_json::json!([{
                "messageKey": "details.expectedExtractionObject",
                "message": "Expected an object of fields."
            }]),
        ));
    };
    let mut result = IndexMap::new();
    let mut issues = Vec::new();
    for (key, field) in object {
        let Some(field) = field.as_object() else {
            issues.push(serde_json::json!({
                "path": [key],
                "messageKey": "details.expectedObject",
                "message": "Expected an object."
            }));
            continue;
        };
        let value = field.get("value");
        let status = field.get("status").and_then(Value::as_str);
        let evidence = field.get("evidence");
        if value.is_none() || status.is_none() || evidence.is_none() {
            issues.push(serde_json::json!({
                "path": [key],
                "messageKey": "details.requiredExtractionProperties",
                "messageArgs": {"field": key},
                "message": "Each field needs value, status, and evidence."
            }));
            continue;
        }
        let status = match status.unwrap_or_default() {
            "found" => ExtractionStatus::Found,
            "not_found" => ExtractionStatus::NotFound,
            "ambiguous" => ExtractionStatus::Ambiguous,
            other => {
                issues.push(serde_json::json!({
                    "path": [key, "status"],
                    "messageKey": "details.unknownExtractionStatus",
                    "messageArgs": {"status": other},
                    "message": format!("Unknown extraction status: {other}")
                }));
                continue;
            }
        };
        let evidence = match evidence.unwrap_or(&Value::Null) {
            Value::Null => None,
            Value::String(text) => Some(text.clone()),
            _ => {
                issues.push(serde_json::json!({
                    "path": [key, "evidence"],
                    "messageKey": "details.invalidEvidence",
                    "messageArgs": {"field": key},
                    "message": "Evidence must be a string or null."
                }));
                continue;
            }
        };
        result.insert(
            key.clone(),
            crate::model::ExtractedField {
                value: value.cloned().unwrap_or(Value::Null),
                status,
                evidence,
            },
        );
    }
    if !issues.is_empty() {
        return Err(AppError::validation("The extraction result does not match the expected structure (fields need value, status, evidence).", Value::Array(issues)));
    }
    Ok(result)
}

fn is_blank(value: &Value) -> bool {
    value.is_null() || value.as_str().is_some_and(|text| text.trim().is_empty())
}

pub fn parse_date_parts(value: &Value) -> Option<(String, String, String)> {
    let text = value.as_str()?.trim();
    let date_re = Regex::new(r"^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$").ok()?;
    let captures = date_re.captures(text)?;
    let year = captures.get(1)?.as_str().parse::<i32>().ok()?;
    let month = captures.get(2)?.as_str().parse::<u32>().ok()?;
    let day = captures.get(3)?.as_str().parse::<u32>().ok()?;
    NaiveDate::from_ymd_opt(year, month, day)?;
    Some((
        captures[1].to_string(),
        format!("{month:02}"),
        format!("{day:02}"),
    ))
}

fn format_date(parts: &(String, String, String), format: &str) -> String {
    format
        .replace("YYYY", &parts.0)
        .replace("MM", &parts.1)
        .replace("DD", &parts.2)
}

pub fn normalize_field(field: &FieldDefinition, value: &Value) -> Value {
    if value.is_null() {
        return Value::Null;
    }
    match field.field_type {
        FieldType::String => {
            let Some(text) = value.as_str() else {
                return value.clone();
            };
            let mut normalized = text.to_string();
            if field
                .normalization
                .as_ref()
                .and_then(|v| v.trim)
                .unwrap_or(false)
            {
                normalized = normalized.trim().to_string();
            }
            if field
                .normalization
                .as_ref()
                .and_then(|v| v.remove_spaces)
                .unwrap_or(false)
            {
                normalized = normalized.replace(' ', "");
            }
            Value::String(normalized)
        }
        FieldType::Number => {
            if value.is_number() {
                return value.clone();
            }
            if let Some(text) = value.as_str() {
                let normalized = text.trim();
                if normalized.is_empty() {
                    return Value::Null;
                }
                return normalized
                    .parse::<f64>()
                    .ok()
                    .filter(|n| n.is_finite())
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .unwrap_or_else(|| value.clone());
            }
            value.clone()
        }
        FieldType::Date => {
            if value.as_str().is_some_and(|text| text.trim().is_empty()) {
                return Value::Null;
            }
            match parse_date_parts(value) {
                Some(parts) => Value::String(format_date(
                    &parts,
                    field
                        .output
                        .as_ref()
                        .and_then(|o| o.format.as_deref())
                        .unwrap_or("YYYY-MM-DD"),
                )),
                None => value.clone(),
            }
        }
        FieldType::Boolean => match value {
            Value::Bool(_) => value.clone(),
            Value::String(text) if text == "true" => Value::Bool(true),
            Value::String(text) if text == "false" => Value::Bool(false),
            Value::String(text) if text.trim().is_empty() => Value::Null,
            _ => value.clone(),
        },
    }
}

pub fn normalize_values(
    values: &IndexMap<String, Value>,
    fields: &FieldDefinitions,
) -> IndexMap<String, Value> {
    let mut out = IndexMap::new();
    for (key, value) in values {
        if let Some(field) = fields.get(key) {
            let normalized = normalize_field(field, value);
            if !normalized.is_null() {
                out.insert(key.clone(), normalized);
            }
        }
    }
    out
}

pub fn normalize_extraction(
    result: &ExtractionResult,
    fields: &FieldDefinitions,
) -> IndexMap<String, Value> {
    let values = result
        .iter()
        .map(|(key, field)| (key.clone(), field.value.clone()))
        .collect();
    normalize_values(&values, fields)
}

fn value_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn type_issue(key: &str, field: &FieldDefinition, value: &Value) -> Option<ExtractionIssue> {
    if is_blank(value) {
        return None;
    }
    let actual = value_type_name(value);
    let expected = match field.field_type {
        FieldType::String => "string",
        FieldType::Number => "number",
        FieldType::Date => "date",
        FieldType::Boolean => "boolean",
    };
    let valid = match field.field_type {
        FieldType::String => value.is_string(),
        FieldType::Number => value.as_f64().is_some_and(f64::is_finite),
        FieldType::Date => value.is_string(),
        FieldType::Boolean => value.is_boolean(),
    };
    if valid {
        return None;
    }
    let actual_desc = if let Some(text) = value.as_str() {
        format!("\"{}\"", text.chars().take(40).collect::<String>())
    } else {
        actual.to_string()
    };
    Some(build_issue(
        key,
        "type_mismatch",
        format!("Field \"{key}\" should be a {expected}, but received {actual_desc}."),
        None,
        message_args([
            ("expected".to_string(), expected.to_string()),
            ("actual".to_string(), actual_desc),
        ]),
    ))
}

fn rule_issue(
    field: &str,
    message: String,
    message_key: &str,
    message_args: IndexMap<String, String>,
) -> ExtractionIssue {
    build_issue(
        field,
        "rule_violation",
        message,
        Some(message_key),
        message_args,
    )
}

fn field_rule_issues(key: &str, field: &FieldDefinition, value: &Value) -> Vec<ExtractionIssue> {
    if is_blank(value) {
        return Vec::new();
    }
    let mut issues = Vec::new();
    let text = match value {
        Value::String(v) => v.clone(),
        _ => value.to_string(),
    };
    if matches!(field.field_type, FieldType::Date)
        && value.is_string()
        && parse_date_parts(value).is_none()
    {
        issues.push(build_issue(
            key,
            "invalid_date",
            format!("Field \"{key}\" is not a valid calendar date."),
            None,
            IndexMap::new(),
        ));
    }
    let Some(rules) = &field.validation else {
        return issues;
    };
    if let Some(pattern) = &rules.regex {
        match Regex::new(pattern) {
            Ok(regex) if !regex.is_match(&text) => issues.push(rule_issue(
                key,
                format!("Field \"{key}\" must match the pattern {pattern}."),
                "issues.rules.regex",
                message_args([("pattern".to_string(), pattern.clone())]),
            )),
            Err(_) => issues.push(build_issue(
                key,
                "invalid_validation_rule",
                format!("Field \"{key}\" has an invalid regular expression rule."),
                None,
                IndexMap::new(),
            )),
            _ => {}
        }
    }
    if rules.minimum.is_some() || rules.maximum.is_some() {
        if let Some(numeric) = value
            .as_f64()
            .or_else(|| value.as_str().and_then(|v| v.parse::<f64>().ok()))
            .filter(|v| v.is_finite())
        {
            if rules.minimum.is_some_and(|minimum| numeric < minimum) {
                issues.push(rule_issue(
                    key,
                    format!(
                        "Field \"{key}\" must be at least {}.",
                        rules.minimum.unwrap_or_default()
                    ),
                    "issues.rules.minimum",
                    message_args([(
                        "minimum".to_string(),
                        rules.minimum.unwrap_or_default().to_string(),
                    )]),
                ));
            }
            if rules.maximum.is_some_and(|maximum| numeric > maximum) {
                issues.push(rule_issue(
                    key,
                    format!(
                        "Field \"{key}\" must be at most {}.",
                        rules.maximum.unwrap_or_default()
                    ),
                    "issues.rules.maximum",
                    message_args([(
                        "maximum".to_string(),
                        rules.maximum.unwrap_or_default().to_string(),
                    )]),
                ));
            }
        }
    }
    if let Some(date_format) = &rules.date_format {
        if value.is_string()
            && parse_date_parts(value)
                .is_none_or(|parts| format_date(&parts, date_format) != text.trim())
        {
            issues.push(rule_issue(
                key,
                format!("Field \"{key}\" must use the date format {date_format}."),
                "issues.rules.dateFormat",
                message_args([("format".to_string(), date_format.clone())]),
            ));
        }
    }
    if let Some(allowed) = &rules.r#enum {
        if !allowed.contains(&text) {
            issues.push(rule_issue(
                key,
                format!("Field \"{key}\" must be one of: {}.", allowed.join(", ")),
                "issues.rules.enum",
                message_args([("values".to_string(), allowed.join(", "))]),
            ));
        }
    }
    issues
}

pub fn validate_field_value(
    key: &str,
    field: &FieldDefinition,
    value: &Value,
    normalize: bool,
) -> Vec<ExtractionIssue> {
    let normalized;
    let candidate = if normalize {
        normalized = normalize_field(field, value);
        &normalized
    } else {
        value
    };
    if is_blank(candidate) {
        return if field.required {
            vec![build_issue(
                key,
                "required_value_missing",
                format!("Required field \"{key}\" ({}) has no value.", field.label),
                None,
                message_args([("label".to_string(), field.label.clone())]),
            )]
        } else {
            Vec::new()
        };
    }
    if let Some(issue) = type_issue(key, field, candidate) {
        return vec![issue];
    }
    field_rule_issues(key, field, candidate)
}

fn unknown_field_issues(
    values: impl Iterator<Item = String>,
    template: &TemplateSchema,
) -> Vec<ExtractionIssue> {
    values
        .filter(|key| !template.fields.contains_key(key))
        .map(|field| {
            build_issue(
                &field,
                "unknown_field",
                format!(
                    "Field \"{field}\" is not configured in template \"{}\".",
                    template.id
                ),
                None,
                message_args([("template".to_string(), template.id.clone())]),
            )
        })
        .collect()
}

pub fn validate_business_values(
    values: &IndexMap<String, Value>,
    template: &TemplateSchema,
) -> Vec<ExtractionIssue> {
    let mut issues = unknown_field_issues(values.keys().cloned(), template);
    for (key, field) in &template.fields {
        issues.extend(validate_field_value(
            key,
            field,
            values.get(key).unwrap_or(&Value::Null),
            false,
        ));
    }
    issues
}

pub fn validate_reviewed_values(
    values: &IndexMap<String, Value>,
    template: &TemplateSchema,
) -> Vec<ExtractionIssue> {
    let mut issues = unknown_field_issues(values.keys().cloned(), template);
    for (key, field) in &template.fields {
        issues.extend(validate_field_value(
            key,
            field,
            values.get(key).unwrap_or(&Value::Null),
            true,
        ));
    }
    issues
}

pub fn validate_extraction(
    result: &ExtractionResult,
    template: &TemplateSchema,
) -> Vec<ExtractionIssue> {
    let mut issues = unknown_field_issues(result.keys().cloned(), template);
    for (key, field) in &template.fields {
        let Some(extracted) = result.get(key) else {
            if field.required {
                issues.push(build_issue(
                    key,
                    "missing_field",
                    format!("Required field \"{key}\" is missing from the extraction result."),
                    None,
                    IndexMap::new(),
                ));
            }
            continue;
        };
        if matches!(
            extracted.status,
            ExtractionStatus::NotFound | ExtractionStatus::Ambiguous
        ) {
            if !is_blank(&extracted.value) {
                let status = if matches!(extracted.status, ExtractionStatus::NotFound) {
                    "not_found"
                } else {
                    "ambiguous"
                };
                issues.push(build_issue(
                    key,
                    "status_value_conflict",
                    format!(
                        "Field \"{key}\" has status \"{}\" but a non-empty value.",
                        status
                    ),
                    None,
                    message_args([("status".to_string(), status.to_string())]),
                ));
            }
            if field.required {
                let status = if matches!(extracted.status, ExtractionStatus::NotFound) {
                    "not_found"
                } else {
                    "ambiguous"
                };
                let code = if status == "not_found" {
                    "required_not_found"
                } else {
                    "required_ambiguous"
                };
                issues.push(build_issue(
                    key,
                    code,
                    format!("Required field \"{key}\" was reported as {status}."),
                    None,
                    IndexMap::new(),
                ));
            }
            continue;
        }
        issues.extend(validate_field_value(key, field, &extracted.value, false));
    }
    issues
}

pub fn normalize_and_validate(
    values: &IndexMap<String, Value>,
    fields: &FieldDefinitions,
) -> IndexMap<String, Value> {
    normalize_values(values, fields)
}

pub fn json_object_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Bool(v) => v.to_string(),
        Value::Number(v) => v.to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_extraction, validate_field_value};
    use crate::model::{FieldDefinition, FieldType, FieldValidation};
    use serde_json::json;

    #[test]
    fn validation_issues_include_localization_keys_and_dynamic_values() {
        let field = FieldDefinition {
            label: "Amount".to_string(),
            field_type: FieldType::Number,
            validation: Some(FieldValidation {
                minimum: Some(3.0),
                ..FieldValidation::default()
            }),
            ..FieldDefinition::default()
        };

        let issues = validate_field_value("amount", &field, &json!(2), false);

        assert_eq!(issues.len(), 1);
        assert_eq!(
            issues[0].message_key.as_deref(),
            Some("issues.rules.minimum")
        );
        let args = issues[0].message_args.as_ref().unwrap();
        assert_eq!(args.get("field").map(String::as_str), Some("amount"));
        assert_eq!(args.get("minimum").map(String::as_str), Some("3"));
    }

    #[test]
    fn invalid_json_errors_include_localized_syntax_details() {
        let error = parse_extraction("{").unwrap_err();

        assert_eq!(error.code, "extraction_parse_failed");
        let details = error.details.unwrap();
        assert_eq!(details["messageKey"], "details.invalidJsonSyntax");
        assert_eq!(details["messageArgs"]["line"], "1");
    }
}

pub fn builtin_transform(value: &Value, transform: Option<&str>) -> Value {
    if value.is_null() {
        return Value::Null;
    }
    match transform.unwrap_or("identity") {
        "date_year" => parse_date_parts(value)
            .map(|v| Value::String(v.0))
            .unwrap_or(Value::String(String::new())),
        "date_month" => parse_date_parts(value)
            .map(|v| Value::String(v.1))
            .unwrap_or(Value::String(String::new())),
        "date_day" => parse_date_parts(value)
            .map(|v| Value::String(v.2))
            .unwrap_or(Value::String(String::new())),
        "trim" => value
            .as_str()
            .map(|v| Value::String(v.trim().to_string()))
            .unwrap_or_else(|| value.clone()),
        "uppercase" => value
            .as_str()
            .map(|v| Value::String(v.to_uppercase()))
            .unwrap_or_else(|| value.clone()),
        "lowercase" => value
            .as_str()
            .map(|v| Value::String(v.to_lowercase()))
            .unwrap_or_else(|| value.clone()),
        "chinese_currency_uppercase" => Value::String(chinese_currency_uppercase(value)),
        _ => value.clone(),
    }
}

pub fn resolve_bindings(
    values: &IndexMap<String, Value>,
    bindings: Option<&IndexMap<String, crate::model::TemplateBinding>>,
) -> IndexMap<String, Value> {
    let mut output = IndexMap::new();
    for (placeholder, binding) in bindings.into_iter().flat_map(|items| items.iter()) {
        if let Some(value) = values.get(&binding.source) {
            output.insert(
                placeholder.clone(),
                builtin_transform(value, binding.transform.as_deref()),
            );
        }
    }
    output
}

fn chinese_group(mut value: u32) -> String {
    let digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    let units = ["仟", "佰", "拾", ""];
    let raw = format!("{value:04}");
    let mut out = String::new();
    let mut pending_zero = false;
    for (index, byte) in raw.bytes().enumerate() {
        let digit = (byte - b'0') as usize;
        if digit == 0 {
            pending_zero = true;
            continue;
        }
        if pending_zero && !out.is_empty() {
            out.push('零');
        }
        out.push_str(digits[digit]);
        out.push_str(units[index]);
        pending_zero = false;
    }
    let _ = &mut value;
    out
}

fn chinese_integer(mut yuan: u64) -> String {
    if yuan == 0 {
        return "零".to_string();
    }
    let units = ["", "万", "亿"];
    let mut groups = Vec::new();
    while yuan > 0 {
        groups.push((yuan % 10_000) as u32);
        yuan /= 10_000;
    }
    let mut out = String::new();
    let mut pending_zero = false;
    for index in (0..groups.len()).rev() {
        let value = groups[index];
        if value == 0 {
            pending_zero = true;
            continue;
        }
        if pending_zero && !out.is_empty() {
            out.push('零');
        }
        out.push_str(&chinese_group(value));
        out.push_str(units.get(index).copied().unwrap_or(""));
        pending_zero = false;
    }
    out
}

pub fn chinese_currency_uppercase(value: &Value) -> String {
    let amount = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) if !text.trim().is_empty() => text.trim().parse().ok(),
        _ => None,
    };
    let Some(amount) = amount.filter(|v| v.is_finite()) else {
        return String::new();
    };
    let negative = amount < 0.0;
    let cents = (amount.abs() * 100.0).round() as u64;
    let yuan = cents / 100;
    let jiao = ((cents / 10) % 10) as usize;
    let fen = (cents % 10) as usize;
    let digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    let mut out = if negative {
        "负".to_string()
    } else {
        String::new()
    };
    if yuan > 0 || (jiao == 0 && fen == 0) {
        out.push_str(&chinese_integer(yuan));
        out.push('元');
    }
    if jiao > 0 {
        out.push_str(digits[jiao]);
        out.push('角');
    }
    if fen > 0 {
        if jiao == 0 && yuan > 0 {
            out.push('零');
        }
        out.push_str(digits[fen]);
        out.push('分');
    }
    if fen == 0 {
        out.push_str("整");
    }
    out
}

pub fn app_error_dto(error: &AppError) -> AppErrorDto {
    AppErrorDto {
        code: error.code.clone(),
        message: error.message.clone(),
        details: error.details.clone(),
    }
}
