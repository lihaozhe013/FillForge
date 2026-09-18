# FillForge AI Agent Prompt

This page contains a self-contained super prompt for advanced users. Copy the entire
[Prompt](#prompt) section below, paste it into a coding agent (Claude Code, Cursor, Codex CLI, or
similar), and point the agent at an existing Word document. The agent will analyze the document,
generate a complete FillForge template (DOCX with placeholders plus `template.yaml`) directly into
the FillForge data directory, self-verify with the FillForge CLI, and hand you a finished template
that only needs your acceptance inside the application.

Everything after the `## Prompt` heading is the text to copy. Replace the two placeholders in the
"Inputs" section before sending, or let the agent ask you for them.

## Prompt

You are configuring a document template for **FillForge**, a local-first desktop application that
renders deterministic Microsoft Word documents. FillForge is used only as a placeholder-substitution
engine: your job is to produce the complete template pair (a DOCX with `{placeholder}` markers and a
`template.yaml` configuration) directly on the filesystem. The user will open FillForge afterwards
and only needs to review and accept your work.

Read this entire prompt before doing anything. Follow every rule exactly; FillForge validates files
strictly and rejects anything that violates its schema.

### Inputs

Ask the user for any input that is missing:

1. `SOURCE_DOCUMENT`: absolute path to an existing Word document (a filled-in or blank `.docx`)
   whose layout should become the template. Never modify this file.
2. `TEMPLATE_ID`: a stable machine identifier for the new template. If the user does not supply one,
   derive it from the document kind (for example `invoice`, `sales_contract`, `receipt`). It MUST
   match `^[a-z0-9][a-z0-9._-]*$` (lowercase snake_case or kebab-case, starting with a letter or
   digit).
3. `FILLFORGE_HOME` (optional): if the user sets this environment variable for FillForge, all paths
   below are relative to it instead of the OS home directory. Ask which home root to use if unclear.

### FillForge concepts

A template separates three concepts:

| Concept          | Meaning                                                     | Example                                        |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Business field   | A value with meaning, type, and validation, defined in YAML | `invoice_date`                                 |
| DOCX placeholder | A named position in the Word document                       | `{invoice_year}`                               |
| Binding          | Maps a placeholder to a field, optionally with a transform  | `invoice_year` from `invoice_date` (date_year) |

One field may feed several placeholders through deterministic transforms (for example one
`invoice_date` field producing `{invoice_year}`, `{invoice_month}`, and `{invoice_day}`, or one
`total_amount` field also producing `{total_amount_uppercase}` via `chinese_currency_uppercase`).

At runtime FillForge generates an extraction prompt from the fields, an external AI tool returns a
JSON value per field, a human reviews it, and FillForge normalizes, validates, resolves bindings,
and renders the DOCX. You are building the template half of that pipeline.

### Storage layout (where files MUST go)

FillForge has no database; the filesystem is the only source of truth. Templates live here:

```text
<home>/.local/fillforge/templates/<TEMPLATE_ID>/
├── template.docx     the Word template with {placeholders}
└── template.yaml     the configuration (schema_version 1)
```

`<home>` is the OS home directory (`~`), or the value of `FILLFORGE_HOME` when the user set it. The
template list is a directory scan, so placing these two files is all the "registration" needed; no
index, manifest, or extra file may be created.

Hard constraints:

- Write ONLY inside `templates/<TEMPLATE_ID>/`. Never create, modify, or delete anything under
  `runs/`, `exports/`, `cache/`, `logs/`, or `~/.config/fillforge/config.yaml`.
- `template.yaml`'s `id` MUST equal the directory name exactly, and `document.file` MUST be the
  relative path `template.docx` resolving inside that directory.
- Never modify `SOURCE_DOCUMENT`. Copy or transform it into `template.docx`.
- No JavaScript expressions, code, or executable content anywhere in YAML.

### template.yaml reference

Exact shape (schema_version MUST be the literal `1`):

```yaml
schema_version: 1

id: invoice
name: Invoice
description: Extract invoice values and render a completed invoice

document:
  file: template.docx

fields:
  invoice_number:
    label: Invoice number
    description: The number explicitly labelled as the invoice number
    type: string
    required: true
    extraction:
      instruction: Find the value labelled Invoice number. Do not confuse it with the invoice code.
    normalization:
      trim: true
      remove_spaces: true
    validation:
      regex: '^[0-9A-Za-z-]+$'

  invoice_date:
    label: Invoice date
    type: date
    required: true
    output:
      format: YYYY-MM-DD
    validation:
      date_format: YYYY-MM-DD

  total_amount:
    label: Total amount
    type: number
    required: true
    validation:
      minimum: 0

bindings:
  invoice_number:
    source: invoice_number
  invoice_year:
    source: invoice_date
    transform: date_year
  invoice_month:
    source: invoice_date
    transform: date_month
  invoice_day:
    source: invoice_date
    transform: date_day
  total_amount:
    source: total_amount
  total_amount_uppercase:
    source: total_amount
    transform: chinese_currency_uppercase
```

Top-level properties:

| Property       | Required | Notes                                                                                                 |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| schema_version | Yes      | Literal `1`                                                                                           |
| id             | Yes      | Must equal the template directory name; regex above                                                   |
| name           | Yes      | Non-empty human-facing name (any language)                                                            |
| description    | No       | Human-facing explanation (any language)                                                               |
| document.file  | Yes      | `template.docx`                                                                                       |
| fields         | Yes      | Mapping of snake_case field keys to definitions; must be non-empty for prompt generation              |
| bindings       | No       | Mapping of placeholder names to `{source, transform?}`; every `source` MUST be a configured field key |

Field properties:

| Property                    | Required | Notes                                                                    |
| --------------------------- | -------- | ------------------------------------------------------------------------ |
| label                       | Yes      | Non-empty human-facing name                                              |
| description                 | No       | Extra semantic context, included in the AI extraction prompt             |
| type                        | No       | `string` (default), `number`, `date`, or `boolean`                       |
| required                    | No       | Defaults to `true`                                                       |
| extraction.instruction      | No       | Free text telling the extractor what to look for and what NOT to confuse |
| normalization.trim          | No       | Trim surrounding whitespace                                              |
| normalization.remove_spaces | No       | Remove ordinary spaces from strings                                      |
| validation.regex            | No       | String pattern; quote it in YAML                                         |
| validation.minimum          | No       | Inclusive numeric lower bound                                            |
| validation.maximum          | No       | Inclusive numeric upper bound                                            |
| validation.date_format      | No       | Required date representation, e.g. `YYYY-MM-DD`                          |
| validation.enum             | No       | List of allowed strings                                                  |
| output.format               | No       | Date format applied during normalization                                 |

Binding transforms — the complete allowed registry (deterministic, no code):

`identity`, `date_year`, `date_month`, `date_day`, `trim`, `uppercase`, `lowercase`,
`chinese_currency_uppercase`

`date_year` returns a 4-digit year, `date_month`/`date_day` return zero-padded 2-digit parts, and
`chinese_currency_uppercase` converts a number to Chinese uppercase currency text
(e.g. 壹佰贰拾叁元肆角伍分). Omit `transform` for a direct field-to-placeholder mapping.

YAML hygiene: spaces only (no tabs), quote regex and any string containing YAML punctuation, unique
field keys and binding keys. Labels, descriptions, and instructions may be written in the user's
language.

### DOCX placeholder rules

Placeholders are plain Docxtemplater text markers:

- One pair of braces, key hugging the braces: `{invoice_number}`, never `{ invoice_number }`,
  `<<invoice_number>>`, `{{invoice_number}}`, or `{发票号码}`.
- Keys are stable lowercase ASCII snake_case identifiers. Human-facing text belongs in
  `template.yaml` labels, not in placeholders.
- No loops, conditionals, Word content controls, mail-merge fields, or field codes. MVP rendering is
  flat substitution only.
- Placeholders may be bold/colored/inside table cells; the rendered value inherits surrounding
  formatting. A placeholder may be split across Word XML runs (FillForge's inspector handles this),
  but keep each `{key}` inside a single text run when you generate the file.

### Generating template.docx

Preferred strategy — **in-place substitution** (preserves 100% of the original formatting):

1. Copy `SOURCE_DOCUMENT` to a scratch location and unzip it (a DOCX is a ZIP; `word/document.xml`
   holds the body).
2. Read the text of `word/document.xml` and identify every value that varies per document instance
   (numbers, dates, names, amounts, addresses, references). Note that a visible value may be split
   across several `<w:t>` runs.
3. Replace each variable value with a single `{snake_case_key}` placeholder inside one `<w:t>`
   element (merge split runs if needed). Keep all surrounding layout, styles, tables, headers, and
   footers untouched. Escape XML special characters properly.
4. Re-zip preserving all original parts (`[Content_Types].xml`, `_rels/`, styles, theme, etc.) and
   write the result to `templates/<TEMPLATE_ID>/template.docx`.
5. Verify the DOCX opens as a valid ZIP and that `word/document.xml` is well-formed XML.

Fallback strategy — **generate from scratch** (only when the source is not a usable DOCX, e.g. the
user gave you a PDF, image, or description): build a minimal OOXML package with PizZip (or any ZIP
library) containing `[Content_Types].xml`, `_rels/.rels`, `word/_rels/document.xml.rels`, and
`word/document.xml` with `<w:p>`/`w:r`/`w:t` paragraphs and `<w:tbl>` tables. The FillForge
repository file `examples/make-example.ts` is a complete working reference for this exact approach.

### Extraction contract (for context and smoke testing)

At runtime the external AI tool must return an unwrapped JSON mapping, one entry per field:

```json
{
  "invoice_number": {
    "value": "INV-20260917",
    "status": "found",
    "evidence": "Invoice number: INV-20260917"
  },
  "total_amount": { "value": 1234.5, "status": "found", "evidence": "Total amount: 1,234.50" },
  "buyer_name": { "value": null, "status": "not_found", "evidence": null }
}
```

- `status` is `found`, `not_found`, or `ambiguous`; `value` MUST be `null` unless `status` is
  `found`.
- `value` must already have the configured JSON type: real numbers for `number` fields (not quoted
  strings), real booleans for `boolean` fields, `YYYY-MM-DD`-style real calendar dates for `date`
  fields.

### Workflow

Execute these steps in order:

1. **Analyze the source.** Unzip `SOURCE_DOCUMENT`, extract the visible text from
   `word/document.xml` (including tables, headers, footers), and list every value that would change
   between document instances versus fixed boilerplate. If the document's purpose is ambiguous, ask
   the user before proceeding.
2. **Design the schema.** For each variable value decide: field key (snake_case), label, type,
   required flag, extraction instruction (disambiguate similar values, e.g. "not the invoice code"),
   normalization, and validation rules. Design placeholders and bindings, using transforms where one
   field feeds multiple positions (date parts, uppercase amount, case changes). Prefer fewer,
   well-typed business fields over one field per placeholder.
3. **Build `template.docx`** using the in-place strategy (or the fallback) and write it to
   `<home>/.local/fillforge/templates/<TEMPLATE_ID>/template.docx`. Create the directory if needed.
4. **Write `template.yaml`** beside it, following the reference above exactly.
5. **Self-verify with the CLI** if a FillForge repository checkout is available (ask the user for
   its path; run from the repo root, with `pnpm install` already done):

   ```bash
   FILLFORGE_HOME=<home-root-or-omit> pnpm tsx packages/tools/src/index.ts inspect-template <TEMPLATE_ID>
   FILLFORGE_HOME=<home-root-or-omit> pnpm tsx packages/tools/src/index.ts extract-fields <TEMPLATE_ID>
   ```

   `inspect-template` must report every placeholder with **zero unconfigured placeholders and zero
   unreferenced fields**; `extract-fields` must produce a prompt covering all fields. Fix and re-run
   until clean. Omit `FILLFORGE_HOME` when writing to the real OS home.

6. **Smoke-test validation.** Write a sample unwrapped extraction JSON (contract above) with
   plausible values for every field to a scratch file, then run:

   ```bash
   FILLFORGE_HOME=<home-root-or-omit> pnpm tsx packages/tools/src/index.ts validate-fields <TEMPLATE_ID> <sample.json>
   ```

   It must report no issues and print normalized values. If any rule rejects a realistic value,
   adjust the rule (or the field), not the sample.

7. **No repository available?** Then step 5–6 are optional: re-read both files yourself, check the
   YAML against the schema reference line by line (id matches directory, every binding source
   exists, only registry transforms, valid YAML syntax), and confirm the DOCX is a well-formed ZIP
   whose `word/document.xml` contains exactly the intended `{placeholders}`.

### Final report

When done, report to the user:

- The template directory path and both file paths.
- A table of fields (key, label, type, required, validation summary).
- A table of bindings (placeholder → field, transform).
- Which values from the source document were treated as variable and which as fixed boilerplate.
- CLI verification results (or the manual checks performed when no repo was available).
- Next steps for the user: open FillForge → Templates → select `<TEMPLATE_ID>` → review the
  placeholder report → create a run → generate the prompt → extract with an external AI tool →
  review and render.

### Acceptance checklist

Before declaring completion, confirm:

- [ ] `template.docx` and `template.yaml` exist in
      `<home>/.local/fillforge/templates/<TEMPLATE_ID>/` and nothing else was written outside that
      directory.
- [ ] `SOURCE_DOCUMENT` is byte-identical to before (never modified).
- [ ] `schema_version: 1`; `id` equals the directory name and matches the ID regex.
- [ ] `document.file: template.docx`.
- [ ] Every `{placeholder}` in the DOCX has a binding entry; every binding `source` is a configured
      field; every transform is in the registry.
- [ ] Placeholders are plain single-brace snake_case keys with no spaces or localized text.
- [ ] Required fields are genuinely required; number/date/boolean types match realistic values.
- [ ] Regex and enum rules were tested against representative values.
- [ ] YAML uses spaces, quoted regex, and contains no code.
- [ ] CLI inspection (or the manual equivalent) is clean.
