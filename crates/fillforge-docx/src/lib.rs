mod inspect;

use docx_template::{DocxFile, Placeholders, Replacements, Value};
use fillforge_domain::docx::{DocumentRenderer, RenderInput, TemplateInspection};
use fillforge_domain::{AppError, AppResult};
use std::io::Cursor;

#[derive(Clone, Copy, Debug, Default)]
pub struct RustDocxRenderer;

impl DocumentRenderer for RustDocxRenderer {
    fn inspect(&self, document: &[u8]) -> AppResult<TemplateInspection> {
        inspect::inspect_document(document)
    }

    fn render(&self, input: RenderInput<'_>) -> AppResult<Vec<u8>> {
        let inspection = inspect::inspect_document(input.document).map_err(|error| {
            AppError::new(
                "docx_render_failed",
                format!("DOCX rendering failed: {}", error.message),
            )
        })?;
        if !inspection.unsupported_tags.is_empty() {
            return Err(AppError::new(
                "template_placeholders_unsupported",
                "Use simple lowercase English placeholders such as {invoice_number}.",
            )
            .with_details(serde_json::json!(inspection.unsupported_tags)));
        }
        let patterns = inspection
            .placeholders
            .iter()
            .map(|key| format!("{{{key}}}"))
            .collect::<Vec<_>>();
        let values = inspection
            .placeholders
            .iter()
            .map(|key| {
                let value = input
                    .values
                    .get(key)
                    .map(fillforge_domain::extraction::json_object_to_string)
                    .unwrap_or_default();
                Value::from_text(&value)
            })
            .collect::<Vec<_>>();
        let template = DocxFile::from_reader(Cursor::new(input.document)).map_err(|error| {
            AppError::new(
                "docx_render_failed",
                format!("DOCX rendering failed: {error}"),
            )
        })?;
        let placeholders = Placeholders::from_iter(patterns);
        let replacements = Replacements::from_iter(values);
        let mut document_template =
            docx_template::DocxTemplate::new(template, placeholders, replacements);
        document_template.render().map_err(|error| {
            AppError::new(
                "docx_render_failed",
                format!("DOCX rendering failed: {error}"),
            )
        })
    }
}

pub use inspect::inspect_document;
