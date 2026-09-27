use fillforge_domain::docx::TemplateInspection;
use fillforge_domain::{AppError, AppResult};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::BTreeSet;
use std::io::{Cursor, Read};
use zip::ZipArchive;

pub fn inspect_document(document: &[u8]) -> AppResult<TemplateInspection> {
    let cursor = Cursor::new(document);
    let mut archive = ZipArchive::new(cursor).map_err(|error| {
        AppError::new(
            "docx_inspection_failed",
            format!("The DOCX template could not be inspected: {error}"),
        )
    })?;
    let mut paragraphs = Vec::new();
    let mut found_main = false;
    for index in 0..archive.len() {
        let mut part = archive.by_index(index).map_err(|error| {
            AppError::new(
                "docx_inspection_failed",
                format!("The DOCX template could not be inspected: {error}"),
            )
        })?;
        let name = part.name().to_string();
        if name == "word/document.xml" {
            found_main = true;
        }
        if name != "word/document.xml"
            && !(name.starts_with("word/header") && name.ends_with(".xml"))
            && !(name.starts_with("word/footer") && name.ends_with(".xml"))
        {
            continue;
        }
        let mut xml = String::new();
        part.read_to_string(&mut xml).map_err(|error| {
            AppError::new(
                "docx_inspection_failed",
                format!("The DOCX template could not be inspected: {error}"),
            )
        })?;
        paragraphs.extend(extract_paragraphs(&xml)?);
    }
    if !found_main {
        return Err(AppError::new(
            "docx_inspection_failed",
            "The DOCX template does not contain word/document.xml.",
        ));
    }

    let mut placeholders = BTreeSet::new();
    let mut unsupported = BTreeSet::new();
    for paragraph in paragraphs {
        let mut brace_depth = 0usize;
        for character in paragraph.chars() {
            match character {
                '{' => brace_depth += 1,
                '}' if brace_depth == 0 => {
                    unsupported.insert("(unmatched closing brace)".to_string());
                }
                '}' => brace_depth -= 1,
                _ => {}
            }
        }
        if brace_depth > 0 {
            unsupported.insert("(unclosed tag)".to_string());
        }

        let mut cursor = 0;
        while let Some(open_offset) = paragraph[cursor..].find('{') {
            let start = cursor + open_offset;
            let Some(close_offset) = paragraph[start + 1..].find('}') else {
                break;
            };
            let end = start + close_offset + 1;
            let raw = &paragraph[start + 1..end];
            if raw.contains('{') || raw.contains('}') {
                unsupported.insert(format!("{{{raw}}}"));
            } else {
                if is_simple_key(raw) {
                    placeholders.insert(raw.to_string());
                } else {
                    unsupported.insert(if raw.trim().is_empty() {
                        "(empty tag)".to_string()
                    } else {
                        raw.trim().to_string()
                    });
                }
            }
            cursor = end + 1;
        }
    }
    Ok(TemplateInspection {
        placeholders: placeholders.into_iter().collect(),
        unsupported_tags: unsupported.into_iter().collect(),
    })
}

fn extract_paragraphs(xml: &str) -> AppResult<Vec<String>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().check_end_names = true;
    let mut paragraphs = Vec::new();
    let mut paragraph = String::new();
    let mut in_paragraph = false;
    let mut in_text = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(tag)) => match tag.local_name().as_ref() {
                b"p" => {
                    in_paragraph = true;
                    paragraph.clear();
                }
                b"t" if in_paragraph => in_text = true,
                b"tab" if in_paragraph => paragraph.push('\t'),
                b"br" if in_paragraph => paragraph.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(tag)) => match tag.local_name().as_ref() {
                b"tab" if in_paragraph => paragraph.push('\t'),
                b"br" if in_paragraph => paragraph.push('\n'),
                _ => {}
            },
            Ok(Event::Text(text)) if in_text => {
                let unescaped = text.unescape().map_err(|error| {
                    AppError::new(
                        "docx_inspection_failed",
                        format!("The DOCX template could not be inspected: {error}"),
                    )
                })?;
                paragraph.push_str(&unescaped);
            }
            Ok(Event::CData(text)) if in_text => {
                paragraph.push_str(&String::from_utf8_lossy(text.as_ref()))
            }
            Ok(Event::End(tag)) => match tag.local_name().as_ref() {
                b"t" => in_text = false,
                b"p" if in_paragraph => {
                    paragraphs.push(paragraph.clone());
                    in_paragraph = false;
                    in_text = false;
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(AppError::new(
                    "docx_inspection_failed",
                    format!("The DOCX template could not be inspected: {error}"),
                ))
            }
        }
    }
    Ok(paragraphs)
}

fn is_simple_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some('a'..='z'))
        && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
}
