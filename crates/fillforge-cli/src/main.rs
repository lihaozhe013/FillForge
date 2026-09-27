use fillforge_docx::RustDocxRenderer;
use fillforge_domain::extraction::{normalize_extraction, parse_extraction, validate_extraction};
use fillforge_domain::{AppContext, AppError, AppResult};
use std::fs;
use std::sync::Arc;
const HELP: &str = "FillForge CLI\n\nUsage: fillforge <command> [args]\n\nCommands:\n  inspect-template <templateId>            List DOCX placeholders and configuration gaps\n  extract-fields <templateId>              Print the deterministic extraction prompt\n  validate-fields <templateId> <file.json> Validate extraction JSON and print normalized values\n  render-document <runId>                  Render a run's reviewed values to DOCX\n\nEnvironment:\n  FILLFORGE_HOME    Override the data home (default: the user's home directory)";
fn run(args: &[String]) -> AppResult<String> {
    let Some(command) = args.first().map(String::as_str) else {
        return Ok(HELP.to_string());
    };
    if command == "help" || command == "--help" || command == "-h" {
        return Ok(HELP.to_string());
    }
    let context = AppContext::create_default(Arc::new(RustDocxRenderer))?;
    match command {
        "inspect-template" => {
            let id = required(args.get(1), "inspect-template requires a template id")?;
            let template = context.template_service.load_template(id)?;
            let report = context.template_service.inspect_template(id)?;
            let mut lines = vec![
                format!("Template: {} ({})", template.name, template.id),
                format!("Placeholders ({}):", report.placeholders.len()),
            ];
            lines.extend(
                report
                    .placeholders
                    .iter()
                    .map(|value| format!("  - {value}")),
            );
            if !report.unconfigured.is_empty() {
                lines.push(format!(
                    "Unconfigured placeholders: {}",
                    report.unconfigured.join(", ")
                ));
            }
            if !report.unreferenced.is_empty() {
                lines.push(format!(
                    "Configured but unreferenced fields: {}",
                    report.unreferenced.join(", ")
                ));
            }
            Ok(lines.join("\n"))
        }
        "extract-fields" => {
            let id = required(args.get(1), "extract-fields requires a template id")?;
            let template = context.template_service.load_template(id)?;
            let config = context.load_settings()?;
            let generated = fillforge_domain::extraction::build_extraction_prompt(
                &template,
                Some(&config.prompt_version),
            )?;
            Ok(format!(
                "{}\n---\n\nExpected JSON structure:\n\n{}\n",
                generated.prompt, generated.expected_json
            ))
        }
        "validate-fields" => {
            let id = required(
                args.get(1),
                "validate-fields requires a template id and a JSON file",
            )?;
            let path = required(
                args.get(2),
                "validate-fields requires a template id and a JSON file",
            )?;
            let template = context.template_service.load_template(id)?;
            let raw = fs::read_to_string(path)?;
            let result = parse_extraction(&raw)?;
            let issues = validate_extraction(&result, &template);
            if issues.is_empty() {
                let values = normalize_extraction(&result, &template.fields);
                Ok(format!("OK: the extraction result satisfies the template configuration.\nNormalized values:\n{}", serde_json::to_string_pretty(&values).unwrap_or_else(|_| "{}".to_string())))
            } else {
                let mut lines = vec![format!("Found {} issue(s):", issues.len())];
                lines.extend(issues.iter().map(|issue| {
                    format!("  - [{}] {}: {}", issue.code, issue.field, issue.message)
                }));
                Ok(lines.join("\n"))
            }
        }
        "render-document" => {
            let id = required(args.get(1), "render-document requires a run id")?;
            let output = context.run_service.render_run(id)?;
            Ok(format!(
                "Rendered {}\nPath: {}",
                output.filename, output.path
            ))
        }
        other => Err(AppError::new(
            "invalid_command",
            format!("Unknown command: {other}\n\n{HELP}"),
        )),
    }
}
fn required<'a>(value: Option<&'a String>, message: &str) -> AppResult<&'a str> {
    value
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("invalid_command", message))
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match run(&args) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("{}: {}", error.code, error.message);
            std::process::exit(1);
        }
    }
}
