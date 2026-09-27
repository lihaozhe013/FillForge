# FillForge Project Specification

| Property | Value                                                        |
| -------- | ------------------------------------------------------------ |
| Status   | Normative                                                    |
| Version  | 1.0                                                          |
| Scope    | Guided document creation MVP                                 |
| Audience | Maintainers, contributors, reviewers, and automation authors |

FillForge is a local-first desktop application for configuring DOCX templates, extracting structured
values from selected source files through a user-configured AI connection, reviewing those values,
and rendering deterministic Microsoft Word documents. An Advanced prompt and JSON import workflow
remains available for manual model handoff. This document defines the product contract, technical
boundaries, persisted formats, security rules, and acceptance criteria for these workflows.

## 1. Normative language

The keywords below are normative:

- **MUST**: required for conformance.
- **MUST NOT**: prohibited.
- **SHOULD**: recommended unless a documented reason requires otherwise.
- **MAY**: optional and compatible with this specification.

This document is the normative specification. The README is an operational guide and MUST remain
consistent with this document. The Rust and TypeScript source is the executable implementation of the requirements.

## 2. Product scope

### 2.1 MVP objective

The MVP MUST support this guided document workflow:

1. Import a DOCX template.
2. Discover its placeholders, including placeholders split across Word XML runs.
3. Configure business fields, extraction instructions, normalization, validation, and bindings.
4. Persist the template configuration as human-readable YAML.
5. Select a template and source files; cancellation MUST NOT create a run.
6. Create the run only after sources are selected and persist a deterministic extraction prompt.
7. On explicit user action, send only the selected source files and extraction prompt to the default
   AI connection, then parse its response through the existing extraction validation.
8. Allow Advanced prompt generation and raw JSON import, including an obvious Markdown JSON fence.
9. Preserve the original extraction result.
10. Review, correct, reject, or fill values manually.
11. Save review, normalize and validate the business record, and create a DOCX in one guided action.
12. Retain the run and generated output as inspectable filesystem artifacts until the user clears
    local history; deletion MUST preserve every generated DOCX.
13. Reopen templates and runs after restarting the application.

### 2.2 MVP requirement matrix

| ID        | Requirement                                                                                   | Status      |
| --------- | --------------------------------------------------------------------------------------------- | ----------- |
| FF-MVP-01 | Tauri 2 desktop application with React, Vite, and typed invoke API                                | Implemented |
| FF-MVP-02 | DOCX import and run-safe placeholder inspection                                               | Implemented |
| FF-MVP-03 | YAML-backed template and field configuration                                                  | Implemented |
| FF-MVP-04 | Deterministic prompt and expected JSON generation                                             | Implemented |
| FF-MVP-05 | Manual JSON extraction import with schema and semantic validation                             | Implemented |
| FF-MVP-06 | Immutable original extraction plus separate human review                                      | Implemented |
| FF-MVP-07 | Normalization, business validation, binding transforms, and DOCX rendering                    | Implemented |
| FF-MVP-08 | Versioned run artifacts and restart-safe history                                              | Implemented |
| FF-MVP-09 | Application settings for theme, editor options, and prompt version                            | Implemented |
| FF-MVP-10 | CLI access to inspection, prompt generation, validation, and rendering                        | Implemented |
| FF-MVP-11 | Native Help menu with links to the User Guide, AI Agent Prompt, specification, and repository | Implemented |
| FF-MVP-12 | Guided one-time Run page with Advanced prompt and JSON tools                                 | Implemented |
| FF-MVP-13 | Responses and Chat Completions connections with system credential storage                   | Implemented |
| FF-MVP-14 | History drawer, per-run deletion, and clear-all with DOCX preservation                        | Implemented |
| FF-MVP-15 | Agent runtime, MCP server, cloud sync, accounts, and authentication                           | Deferred    |

A feature is not considered part of the MVP merely because an interface or future seam exists.

## 3. User workflow contract

The application MUST preserve the following separation:

```text
Source evidence
      ↓
Extraction prompt and schema
      ↓
Structured extraction result
      ↓
Human review and business validation
      ↓
Normalized business record
      ↓
Template bindings and transforms
      ↓
Rendered DOCX
```

The application MUST NOT treat the product as a direct image-to-Word replacement pipeline. The
structured business record is a first-class domain object and is the boundary between extraction and
rendering.

| Stage             | Input                                | Output                              | Persistence                            |
| ----------------- | ------------------------------------ | ----------------------------------- | -------------------------------------- |
| Template import   | User-selected DOCX                   | Template with fields and bindings from placeholders | template.docx, template.yaml |
| Inspection        | Template DOCX and YAML               | Placeholder report                  | No new canonical artifact              |
| Run creation      | Template ID and optional evidence    | Run metadata and copied evidence    | metadata.json, input/                  |
| Prompt generation | Template schema and prompt version   | Prompt plus expected JSON shape     | prompt.md                              |
| Extraction import | Raw user-pasted text                 | Parsed extraction result and issues | extraction.json                        |
| Review            | Extraction result and final values   | Review record and issues            | review.json                            |
| Normalization     | Extraction plus review               | Business values                     | normalized.json                        |
| Rendering         | Valid normalized values and bindings | Versioned DOCX                      | output/result-XXX.docx and result.docx |

## 4. Technical baseline

### 4.1 Required stack

| Concern                       | Requirement                                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| Package manager               | pnpm for the frontend workspace                                       |
| Build-time JavaScript runtime | Node.js 26.x or later                                                 |
| Desktop runtime               | Tauri 2 and Rust stable                                               |
| Renderer UI                   | React 19 and Vite                                                     |
| Renderer contracts            | TypeScript generated from Rust domain types                           |
| Native WebView                | Windows WebView2 and macOS WKWebView supplied by the operating system |
| Human-authored persistence    | YAML                                                                  |
| Machine-generated persistence | JSON                                                                  |
| DOCX engine                   | Rust `docx-template` at a fixed Git revision                          |
| Installer targets             | Windows x64 NSIS and macOS ARM DMG                                     |
| Updates                       | Manual download and installation; no in-app updater                   |

Node.js and pnpm are build-time requirements only. Installed applications MUST NOT require Node.js
or bundle Chromium. The Rust workspace MUST contain Cargo.lock. The repository MUST contain
pnpm-lock.yaml and MUST NOT contain package-lock.json, yarn.lock, bun.lock, bun.lockb, or a second
JavaScript package manager configuration.

### 4.2 Required quality commands

The following root commands MUST remain available:

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm format
pnpm format:check
cargo check --workspace
pnpm build:win:x64
pnpm build:mac:arm64
```

The migration CI MUST typecheck the interface, compile the Rust workspace, and build both target
installers. It MUST NOT run automated tests. Release-level acceptance also requires manual checks of
existing templates and runs, DOCX rendering, and all four CLI commands.

### 4.3 Platform policy

The canonical storage layout MUST be identical on supported platforms and MUST NOT be silently
replaced with AppData, Application Support, or another platform-specific application-data root.
The first packaged targets are Windows x64 NSIS and macOS ARM DMG. Packages are unsigned and
macOS packages are not notarized. Users download and install updates manually. Before installing the
Tauri package on Windows, users MUST uninstall the previous Electron package.

Tauri MUST use the operating system's WebView and MUST NOT package a Chromium runtime. Native dialogs,
system file operations, menus, and logging MUST remain in the Rust desktop process.

## 5. Architecture and package boundaries

### 5.1 Runtime boundary

```text
React renderer (WebView)
      │
      │ typed Tauri invoke API
      ▼
Tauri commands and native services (Rust)
      │
      ▼
Shared Rust domain services
      ├── configuration and filesystem storage
      ├── templates and placeholder inspection
      ├── extraction, validation, and normalization
      ├── run lifecycle and review
      └── DOCX inspection and rendering adapter

Rust CLI ────────────────┘
```

The renderer MUST NOT have unrestricted Node.js, shell, or filesystem access. Domain logic MUST NOT
depend on React, Tauri command state, or renderer state. The same domain services MUST serve the
Tauri commands and CLI.

### 5.2 Workspace responsibilities

| Package or directory          | Responsibility                                                         | Required boundary                         |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| `crates/fillforge-domain`     | Models, paths, persistence, configuration, templates, extraction, runs | Shared business rules; no UI dependency   |
| `crates/fillforge-docx`       | DOCX placeholder inspection and Rust rendering adapter                | DOCX implementation types stay in crate   |
| `crates/fillforge-cli`        | Four CLI commands and TypeScript type generation                      | Calls shared Rust domain services         |
| `apps/desktop/src-tauri`      | Tauri commands, dialogs, menu, opener, logging, and packaging          | Native access stays in desktop process    |
| `apps/desktop/src`            | React views, renderer state, bridge, generated types                   | Calls only the documented invoke API     |

### 5.3 Dependency rules

1. Shared business rules and persisted models belong in `crates/fillforge-domain`.
2. Filesystem access belongs in the domain repositories or explicitly owned Tauri services.
3. UI code MUST call application operations through the Tauri invoke bridge.
4. CLI commands MUST call the same services as the desktop application.
5. TypeScript contracts MUST be generated from Rust domain types and MUST NOT be edited manually.
6. Provider-specific AI code MUST NOT be added to the domain crate.
7. A database repository, cloud service, agent runtime, or MCP server MUST NOT be introduced without
   an explicit product decision.
8. Files over 1,000 lines MUST be considered for decomposition before adding a new responsibility.

## 6. Canonical persistence

### 6.1 Source of truth

The filesystem is the only canonical persistence layer. FillForge MUST NOT use a database for
templates, runs, configuration, review data, or rendered output.

The following are explicitly prohibited as canonical storage:

- SQLite, PostgreSQL, MySQL, LevelDB, and other SQL or embedded databases.
- IndexedDB, PouchDB, and Dexie.
- Prisma, Drizzle, TypeORM, Sequelize, or equivalent persistence ORMs.
- A single aggregate state file containing all templates and runs.
- A persisted index that cannot be rebuilt from ordinary artifacts.

A rebuildable cache MAY be added later, but it MUST remain disposable and non-canonical.

### 6.2 Canonical paths

The path module in `crates/fillforge-domain/src/paths.rs` MUST be the single source of truth.

```text
<home>/.config/fillforge/config.yaml
<home>/.config/fillforge/ai-connections.json

<home>/.local/fillforge/templates/
<home>/.local/fillforge/runs/
<home>/.local/fillforge/exports/
<home>/.local/fillforge/exports/preserved-runs/<run-ulid>/
<home>/.local/fillforge/cache/
<home>/.local/fillforge/logs/
```

The home root is resolved from the FILLFORGE_HOME environment variable when present; otherwise it is
resolved with the operating system home-directory API. FILLFORGE_HOME overrides the logical home
root, not the layout beneath it.

The application MUST initialize this layout without deleting existing data. Development and
validation workflows SHOULD use an isolated `FILLFORGE_HOME` root and MUST NOT write to unrelated
FillForge data directories.

### 6.3 Directory layout

```text
<home>/.config/fillforge/
├── config.yaml
└── ai-connections.json             versioned metadata only; no API keys

<home>/.local/fillforge/
├── templates/
│   └── <template-id>/
│       ├── template.docx
│       ├── template.yaml
│       └── README.md                  optional human notes
├── runs/
│   └── <run-ulid>/
│       ├── metadata.json
│       ├── input/
│       │   └── copied source evidence
│       ├── prompt.md
│       ├── extraction.json
│       ├── review.json
│       ├── normalized.json
│       └── output/
│           ├── result-001.docx
│           ├── result-002.docx
│           └── result.docx             newest output mirror
├── exports/
│   └── preserved-runs/
│       └── <run-ulid>/              preserved DOCX outputs
├── cache/
└── logs/
```

Template directories MUST contain the application-owned copy of the DOCX. Runtime run artifacts MUST
NOT be stored inside a template directory.

### 6.4 Atomic writes

Mutable YAML and JSON files MUST be written through the atomic-write helper. The implementation MUST
write a temporary file in the target directory, close it, and rename it into place. Rendered binary
artifacts MUST use the same recoverable write strategy.

The application MUST NOT mutate a large aggregate state file to represent ordinary domain changes.

### 6.5 Schema version policy

Every persisted YAML or JSON domain file MUST include a numeric schema_version. Current supported
versions are:

- config.yaml: 1
- template.yaml: 1
- metadata.json: 1
- extraction.json wrapper: 1
- review.json: 1
- normalized.json: 1
- ai-connections.json: 1

prompt.md is a human-readable artifact rather than a YAML/JSON domain file. Its prompt version is
recorded in metadata.json and its expected JSON block is stored with the prompt.

On load, the application MUST:

1. Parse the file.
2. Reject an explicitly unsupported newer schema version.
3. Validate the parsed value against the corresponding Rust domain model and semantic rules.
4. Reject an ID that does not match its containing directory where applicable.
5. Avoid silently rewriting files on application startup.

Future shape changes MUST use explicit migrations such as migrateTemplateV1ToV2. Migrations MUST
preserve the original file until the migration policy explicitly permits replacement.

## 7. Domain data contracts

### 7.1 Identifiers

- Template IDs MUST match ^[a-z0-9][a-z0-9._-]*$.
- Template IDs MUST be stable machine identifiers and SHOULD use lowercase snake_case or kebab-case.
- Run IDs MUST be ULIDs accepted by the current run ID schema: 26 Crockford Base32 characters,
  beginning with a timestamp character in the range 0–7.
- Display labels MUST NOT be used as identifiers.
- Repository methods MUST validate IDs before constructing paths.

### 7.2 Template schema

A template configuration MUST have this shape:

```yaml
schema_version: 1
id: invoice
name: Invoice
description: Extract invoice data and render a completed document

document:
  file: template.docx

fields:
  invoice_number:
    label: Invoice number
    description: The number explicitly labelled as the invoice number
    type: string
    required: true
    extraction:
      instruction: Do not confuse the invoice number with the invoice code.
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
  invoice_date:
    source: invoice_date
  total_amount:
    source: total_amount
```

The schema contract is:

- document.file MUST be a non-empty relative path that resolves inside the template directory.
- fields MUST be a mapping of field keys to field definitions.
- Field types are string, number, date, and boolean.
- required defaults to true when omitted.
- extraction.instruction is optional free text.
- normalization supports trim and remove_spaces.
- validation supports regex, minimum, maximum, date_format, and enum.
- output.format is optional and is used for date formatting.
- bindings map DOCX placeholder names to a configured field source.
- A binding source MUST refer to a configured field.
- JavaScript expressions MUST NOT be stored in YAML.
- Configuration MUST NOT be evaluated with eval or an equivalent dynamic execution mechanism.

Field keys SHOULD use stable snake_case names. Human-facing labels, descriptions, and extraction
instructions MAY use any language.

### 7.3 DOCX placeholders and inspection

DOCX placeholders use single braces and simple lowercase English keys:

```text
{invoice_number}
{invoice_date}
{total_amount}
```

Automatic import and sync MUST accept keys matching `^[a-z][a-z0-9_]*$`. Tags with filters, loops,
conditions, spaces, or other expressions MUST be reported as unsupported and MUST prevent rendering.
The checker MUST detect placeholders split across Word XML runs and inspect the document body,
headers, and footers. A naive regular expression over a single raw XML string is not sufficient.

The Rust DOCX adapter MUST use the fixed `xamgore/docx-template` Git revision, preserve the original
document formatting, and convert values such as booleans to text before rendering. Missing and null
values render as empty text. Unsupported tags MUST produce a clear validation error.

Inspection returns:

- placeholders: every discovered placeholder, returned in normalized key order;
- unconfigured: discovered placeholders with no binding entry;
- unreferenced: configured fields not referenced by a binding for a discovered placeholder.
- unsupportedTags: non-empty tags outside the simple placeholder grammar.

A configured field and a DOCX placeholder are separate concepts. A one-to-one mapping is permitted
but MUST NOT be assumed by the domain model.

### 7.4 Application configuration

config.yaml MUST use this shape:

```yaml
schema_version: 1
ui:
  theme: system
editor:
  show_advanced_fields: false
extraction:
  prompt_version: fillforge-extraction-v1
```

Supported values:

- ui.theme: system, light, or dark.
- editor.show_advanced_fields: boolean.
- extraction.prompt_version: a non-empty string no longer than 100 characters.

Missing optional sections resolve to the defaults above. A missing config file MUST load defaults;
first launch MUST NOT require an empty configuration file to exist.

Secrets MUST NOT be written to config.yaml or ai-connections.json. AI API keys MUST be stored in the
operating system credential store by the Rust backend. The UI MUST receive only whether a key is
saved, never the key itself. If secure credential storage is unavailable, saving a key MUST fail;
plaintext fallback storage is prohibited.

AI connection metadata MUST be stored in ai-connections.json with schema_version 1. The file MUST
contain named connections, protocol, validated endpoint URL, available models, each connection's
default model, and the application default connection ID.

### 7.5 Run metadata

metadata.json MUST contain:

```json
{
  "schema_version": 1,
  "id": "01K5A000000000000000000000",
  "created_at": "2026-09-16T12:30:00.000Z",
  "template_id": "invoice",
  "template_schema_version": 1,
  "prompt_version": "fillforge-extraction-v1",
  "attachments": [
    {
      "filename": "invoice.png",
      "original_filename": "invoice.png",
      "media_type": "image/png"
    }
  ]
}
```

The run ID MUST equal its directory name. Attachments MUST record the stored filename, the sanitized
original filename, and the detected or supplied media type.

### 7.6 Extraction contract

The external AI exchange uses an unwrapped field mapping:

```json
{
  "invoice_number": {
    "value": "12345678",
    "status": "found",
    "evidence": "Invoice number: 12345678"
  },
  "invoice_date": {
    "value": "2026-09-16",
    "status": "found",
    "evidence": "Invoice date: 2026-09-16"
  },
  "total_amount": {
    "value": null,
    "status": "ambiguous",
    "evidence": null
  }
}
```

Each field MUST contain value, status, and evidence:

- status MUST be found, not_found, or ambiguous.
- evidence MUST be a short supporting text or null.
- value MUST match the configured field type when present.
- value MUST be null when status is not_found or ambiguous.
- The extractor MUST NOT be treated as an authoritative source of confidence scores.
- The prompt MUST instruct the model not to guess and to return JSON only.

The persisted extraction artifact wraps that exchange:

```json
{
  "schema_version": 1,
  "result": {
    "invoice_number": {
      "value": "12345678",
      "status": "found",
      "evidence": "Invoice number: 12345678"
    }
  }
}
```

The application MUST preserve the parsed model result as an immutable extraction artifact. Semantic
validation issues MAY be returned to the UI while retaining the parsed artifact for review.

### 7.7 Review contract

review.json MUST contain:

```json
{
  "schema_version": 1,
  "fields": {
    "invoice_number": {
      "model_value": "12345678",
      "final_value": "12345679",
      "decision": "corrected"
    }
  }
}
```

Allowed decisions are accepted, corrected, rejected, and filled_manually.

The review builder MUST preserve model_value and MUST NOT overwrite extraction.json. It MUST include
configured template fields so a missing model field can be filled or rejected explicitly. The normal
effective value is final_value when a review entry exists, otherwise the model value.

### 7.8 Normalized record

normalized.json MUST contain:

```json
{
  "schema_version": 1,
  "values": {
    "invoice_date": "2026-09-16",
    "total_amount": 1234.5
  }
}
```

This is a derived artifact. It MUST be rebuilt from the current extraction and review records before
rendering. A review save MUST invalidate an existing normalized artifact.

Normalization is deterministic and best-effort:

- strings MAY be trimmed and have ordinary spaces removed according to field configuration;
- numeric strings MAY be converted to finite numbers;
- boolean strings true and false MAY be converted to booleans;
- calendar dates MAY be normalized to output.format or YYYY-MM-DD;
- blank values and null values are omitted from the normalized values mapping;
- values that cannot be normalized remain available for validation to reject.

### 7.9 Document renderer boundary

The Rust domain crate MUST depend on a renderer boundary that accepts document bytes and normalized
values and returns rendered bytes. The DOCX adapter MUST remain in `crates/fillforge-docx`; its
implementation types MUST NOT become part of template, extraction, or run persistence contracts.
The adapter MUST support placeholders in the body, headers, footers, and tables, including markers
split across Word runs.

### 7.10 Binding transforms

Binding keys are DOCX placeholders and binding.source is a business field. Transforms MUST be
deterministic and MUST NOT call an AI provider.

The MVP registry contains:

- identity
- date_year
- date_month
- date_day
- trim
- uppercase
- lowercase
- chinese_currency_uppercase

An unknown transform MUST NOT silently execute arbitrary code. A missing source value MAY leave the
placeholder unresolved for validation to report before rendering.

## 8. Behavioral requirements

### 8.1 Template lifecycle

1. Import MUST inspect the selected DOCX before creating a template and copy it to
   templates/<id>/template.docx only when inspection succeeds.
2. Import MUST require at least one supported placeholder and MUST reject unsupported tags before
   creating a template.
3. For every unique supported placeholder, import MUST create a field with the same key and label,
   type `string`, and `required: false`, plus a binding whose source is that same key.
4. The application MUST continue to work if the original source file is later moved or deleted.
5. Syncing placeholders MUST add only missing same-key fields and bindings while preserving existing
   field definitions, non-identity bindings, and transforms.
6. Save MUST validate the complete template schema and ensure the configured document path stays
   inside the template directory.
7. Duplicate MUST copy the directory, assign a valid new ID, and update the schema ID.
8. Delete MUST remove only the selected template directory.
9. Listing SHOULD continue when an individual template is unreadable; the unreadable entry MAY be
   surfaced with a safe diagnostic instead of hiding healthy templates.

### 8.2 Prompt generation

1. Prompt generation MUST be a pure function of the template schema and prompt version.
2. A template with no configured fields MUST be rejected with a useful error.
3. The prompt MUST describe each field's key, label, type, required status, description, and
   extraction instruction where present.
4. The expected JSON structure MUST be generated from the same field definitions.
5. The prompt MUST be written once per run. Repeated generation MUST return the existing prompt.
6. prompt.md MUST contain the prompt and the expected JSON structure.
7. Changing the application setting MUST affect new runs; an existing run MUST retain its recorded
   prompt version and immutable prompt artifact.

### 8.3 Extraction import

1. The input MUST be raw JSON or JSON surrounded by an obvious json Markdown fence.
2. The parser MUST reject malformed JSON with a safe parse error.
3. The parser MUST validate the field-object shape against the Rust extraction model.
4. Semantic validation MUST report missing required fields, unknown fields, type errors, invalid
   dates, status/value conflicts, and configured rule violations.
5. extraction.json MUST be write-once. A second import into the same run MUST be rejected.
6. The parsed extraction MAY be stored even when semantic issues exist; rendering MUST remain
   blocked until the effective business values pass validation.

### 8.4 Review and normalization

1. Review MUST be available only after an extraction exists.
2. The UI MUST show value, status, evidence, and validation issues where available.
3. A user MUST be able to accept, edit, clear, or manually fill a value.
4. review.json MUST be atomically written and schema-validated.
5. Saving review MUST invalidate normalized.json.
6. Normalization MUST use final reviewed values when available.
7. Normalization MUST run again before every render; a stale or missing normalized artifact MUST NOT
   be trusted as the render input.

### 8.5 Rendering and output

1. Rendering MUST load the run's template by template_id.
2. Rendering MUST validate all configured business fields immediately before DOCX generation.
3. Rendering MUST reject required blanks, wrong types, invalid calendar dates, regex failures,
   numeric range failures, date-format failures, enum failures, and unknown effective fields.
4. Binding resolution MUST happen after business normalization and before DOCX rendering.
5. The renderer MUST be deterministic for the same template bytes and resolved values.
6. Every render MUST create the next result-XXX.docx version and retain previous versions.
7. result.docx MUST be an exact copy of the newest versioned output.
8. Rendered output MUST remain inside the run output directory.

### 8.6 Run history

- Run directories MUST be independently inspectable.
- Run listing MUST be newest-first by created_at. The main Run page MUST expose history through a
  small labeled button rather than a separate prominent run-history page.
- An unreadable run MUST NOT be modified or silently repaired during listing.
- The application MUST be able to reopen a valid run and load its metadata, prompt, expected JSON,
  extraction, review, normalized record, and generated outputs. The UI MUST display the user-facing
  run stages and generated outputs; normalized.json remains an inspectable service artifact.
- Source evidence MUST be copied into input/ and MUST NOT be modified in place.
- Attachment filename collisions MUST be resolved with a deterministic suffix such as -2, -3.
- The Run page MUST guide users through template selection, source selection, extraction, editable
  value review, and document creation. Run IDs, local paths, JSON, prompt versions, and normalization
  controls MUST remain out of the main flow. Prompt and JSON import tools MUST be in a collapsed
  Advanced section.
- A run MUST be created only after at least one source file is selected. Canceling the native picker
  MUST leave no run.
- Source inputs MUST support images, PDFs, UTF-8 text, and Markdown with a 50 MiB combined file-size
  limit. Extraction MUST NOT start until the user chooses Extract with AI. At that point, only the
  selected source files and generated extraction prompt may be sent to the configured provider.
- AI responses MUST be parsed through the existing extraction validation. Provider failures,
  timeouts, and malformed output MUST leave the run available for retry or Advanced import.
- Create document MUST save the current review, rebuild normalized values, apply business validation,
  and render the DOCX as one guided action.
- Before deleting a run or clearing all history, the application MUST preserve every regular
  result-XXX.docx and result.docx under exports/preserved-runs/<run-ulid>/. Existing identical
  preserved copies MAY be reused; a name collision with different content MUST fail safely.
- A run MUST remain intact when any output cannot be preserved. Clear all MUST report per-run
  failures and offer to open the saved documents folder. Successful deletion MUST remove that run's
  metadata, inputs, prompt, extraction, review, normalized data, and output directory. Copies
  exported elsewhere MUST remain untouched.
- Clear history removes local run data only. It MUST NOT claim to delete data retained by an
  external AI provider.

## 9. Validation rules

Validation is a domain concern and MUST be reusable from the desktop and CLI.

| Rule              | Required behavior                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| required          | Blank, null, or missing values are invalid for required fields.                                                  |
| type              | string, finite number, boolean, or date string as configured.                                                    |
| date              | Date fields MUST represent a real calendar date, not only a syntactically valid string.                          |
| regex             | The configured regular expression MUST match the string representation. Invalid regex configuration is an issue. |
| minimum / maximum | Numeric values MUST remain within configured inclusive bounds.                                                   |
| date_format       | A date MUST round-trip through the configured token format.                                                      |
| enum              | The value MUST equal one configured enum string.                                                                 |
| unknown field     | A value not configured in the template is an issue.                                                              |

Extraction-level rules additionally apply:

- A required field missing from the extraction result is an issue.
- A not_found or ambiguous field with a non-empty value is an issue.
- A required not_found or ambiguous field is an issue.
- A found field is validated against its field definition.
- Optional missing fields MAY proceed to review but cannot be rendered if their final state violates
  another configured rule.

Review validation MAY normalize review input before checking it. Rendering validation MUST check the
normalized business values without weakening the template contract.

## 10. Tauri command contract

### 10.1 API surface

The renderer MUST preserve existing `window.fillforge` method names and DTO shapes through a
small TypeScript bridge over Tauri's `invoke` API. Rust MUST implement these 35 operations while
retaining existing run commands for compatibility:

| Group          | Operations                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------- |
| templates      | list, import, load, saveSchema, inspect, syncPlaceholders, duplicate, delete, promptPreview    |
| settings       | load, save                                                                                     |
| aiConnections | list, save, delete, setDefault, discoverModels, test                                             |
| runs           | create, startWithFiles, list, load, delete, clearAll, generatePrompt, extractWithAi,            |
|                | importExtraction, saveReview, createDocument, normalize, render, attachFiles                    |
| system         | openPath, showItemInFolder, exportCopy, openSavedDocuments                                     |

TypeScript contracts MUST be generated from Rust domain models and MUST NOT be edited manually. The
bridge MUST preserve the response envelope `{ ok: true, data }` or `{ ok: false, error }` and existing
error codes. Rust MUST validate command inputs and MUST return safe error details without exposing
arbitrary stack traces.

### 10.2 Command payloads

- Empty operations MUST accept no meaningful payload.
- ID-bearing operations MUST validate template IDs or ULID run IDs.
- `runs:create` MUST accept only the template ID from the renderer; attachment paths MUST NOT be
  supplied by renderer payloads.
- `runs:start-with-files` MUST accept only a template ID and MUST obtain files from a native picker.
  Cancellation or an empty selection MUST NOT create a run. The backend MUST enforce the combined
  50 MiB input limit before persisting the run.
- `runs:extract-with-ai` MUST use the application's default AI connection and a prompt generated by
  the existing extraction service. It MUST send only the run's selected attachments and that prompt.
- `runs:create-document` MUST save the supplied review, validate it, normalize values, and render
  the DOCX as one guarded operation. Validation issues MUST be returned without rendering.
- `runs:delete` and `runs:clear-all` MUST preserve DOCX outputs before removing run data. A run
  currently being processed MUST remain intact and be reported as a failure by clear-all.
- `ai-connections:save` MUST accept connection metadata and an optional API key, store the key only
  through the operating system credential store, and return no key material.
- `ai-connections:discover-models` and `ai-connections:test` MUST support both saved connections
  and unsaved drafts. Draft endpoint, protocol, model, and key values MUST remain transient. Model
  discovery MUST return no more than 4,096 unique model IDs and identify whether it returned a
  catalog or verified a single configured model.
- `runs:import-extraction` MUST reject empty input and inputs longer than 2,000,000 UTF-16 code units.
- `settings:save` MUST validate theme, language, advanced-field flag, and a trimmed prompt version
  between 1 and 100 characters.
- Errors from command input parsing MUST be converted to a stable FillForge error response.

### 10.3 Native file operations

The Tauri Rust process owns native dialogs for DOCX import, source attachments, and export.

System open, reveal, and export operations MUST:

1. Accept only a path selected from an application result or another trusted native flow.
2. Resolve the path and verify it is inside the FillForge data directory.
3. Resolve symlinks and verify the real path remains inside that directory.
4. Require an existing regular file for open, reveal, and export source operations. The dedicated
   openSavedDocuments operation MAY open the preserved-runs directory itself.
5. Permit export to a user-selected destination from the native save dialog.

The renderer MUST NOT be given a general-purpose file read/write API.

### 10.4 Help menu

The desktop application MUST install a native application menu with a Help submenu linking to the User
Guide, AI Agent Prompt, specification, and repository. Each entry MUST open its destination with the
operating system's external browser through the Tauri opener plugin. The Help menu MUST NOT read
arbitrary local files or expose a filesystem API to the renderer.

## 11. Security and privacy

- Tauri's WebView MUST have no unrestricted Node.js, shell, or filesystem access.
- Tauri capabilities MUST grant only core and opener permissions required by the UI.
- The TypeScript bridge MUST expose only the documented FillForge API.
- Path construction MUST validate identifiers and prevent traversal.
- Template document paths MUST remain inside the template directory, including after symlink
  resolution.
- Data file paths used by system operations MUST remain inside the data directory, including after
  symlink resolution.
- Imported templates and attachments MUST be copied; the originals MUST not be modified.
- Source evidence and prompts MUST NOT be transmitted automatically. They MAY be sent only after the
  user chooses Extract with AI and only to the configured connection.
- Model discovery MUST first request the endpoint's model catalog. If a Responses endpoint cannot
  provide a usable catalog, discovery MAY send a minimal model verification request only after the
  user chooses Discover models. Verification requests MUST use `store: false` and MUST NOT include
  source files or extraction prompts. A discovery and its optional verification MUST finish within
  15 seconds.
- Connection testing MAY send a minimal verification request only after the user chooses Test
  connection. It MUST NOT include source files or extraction prompts.
- Provider endpoints MUST use HTTPS, except HTTP MAY be used for loopback addresses on this computer.
  Redirects MUST NOT forward an API key to another endpoint.
- Responses requests and Chat Completions requests MUST use their protocol-specific documented file
  payload formats. A model or endpoint that rejects a file type MUST produce a clear retryable error.
- API keys MUST never be written to logs, config files, error messages, or API responses. Requests
  and responses MUST NOT be logged with document or prompt contents.
- The MVP MUST NOT include telemetry, analytics, authentication, or a cloud backend.
- Logs MUST avoid full document contents, image/PDF bytes, secrets, API keys, and credentials.
- Debug logs MAY be written to debug-logs/; release logs belong in the configured per-user log
  directory. The summary debug.log SHOULD be checked before a feature-specific debug log when
  diagnosing a failure.
- Clearing local run history MUST NOT claim to erase data already retained by a provider.

## 12. CLI contract

The CLI MUST assemble the same services as the desktop application and MUST NOT contain a second
implementation of domain behavior. It is built as a Rust binary:

```bash
cargo run -p fillforge-cli -- inspect-template <templateId>
cargo run -p fillforge-cli -- extract-fields <templateId>
cargo run -p fillforge-cli -- validate-fields <templateId> <extraction.json>
cargo run -p fillforge-cli -- render-document <runId>
```

Command semantics:

- `inspect-template` prints discovered placeholders and configuration gaps.
- `extract-fields` prints the deterministic prompt and expected JSON structure.
- `validate-fields` parses and validates an extraction file without mutating a run; on success, the
  CLI also prints normalized values.
- `render-document` renders an existing run using the run service and writes output under its run
  directory.

All commands MUST honor `FILLFORGE_HOME`.

## 13. Build and release gates

The migration's build gates are:

```bash
pnpm typecheck
cargo check --workspace
pnpm build:win:x64
pnpm build:mac:arm64
```

The CI workflow MUST build a Windows x64 NSIS installer and a macOS ARM DMG and upload both as
workflow artifacts. It MUST NOT run automated tests. A push to `publish` MAY update the existing
`nightly` prerelease and checksums after both platform builds succeed. A manual workflow dispatch
MUST upload artifacts only and MUST NOT publish or update a release.

The packages use manual download and installation. The workflow MUST NOT configure signing,
notarization, or an in-app updater.

## 14. MVP acceptance criteria

Acceptance MUST confirm:

1. Launch the installed desktop app without a Node.js installation.
2. Open an existing template and run from the pre-migration data directory.
3. Import `examples/invoice/invoice-template.docx` and confirm its simple placeholders are discovered.
4. Confirm placeholders in the document body, headers, and footers are inspected.
5. Cancel the source file picker and confirm no run was created; then complete the one-time run flow
   with a configured mock AI endpoint and review at least one field.
6. Confirm the model value stays unchanged, the final value is saved in `review.json`, and the output
   appears as both a numbered file and `result.docx`.
7. Reopen the rendered DOCX in Word or a compatible viewer and verify the template's formatting.
8. Run `inspect-template`, `extract-fields`, `validate-fields`, and `render-document` against the
   same data root using the Rust CLI.
9. Confirm the Help menu opens the documentation links in the system browser.
10. Delete a run with multiple DOCX versions and confirm every version and latest copy is preserved.
11. Clear history with a simulated preservation failure and confirm failed runs remain available and
    the UI offers Open saved documents.
12. Confirm unsupported file types, timeouts, malformed AI responses, invalid IDs, symlinks, and an
    active run leave local data safe and produce a clear status.
13. Confirm the Windows NSIS and macOS ARM DMG artifacts are present and non-empty.

## 15. Explicit non-goals and future seams

The following are outside the MVP and MUST NOT be added as incidental infrastructure:

- OCR, embeddings, vector databases, RAG, or cloud document processing;
- agent runtimes, MCP servers, browser automation, or workflow graph editors;
- user accounts, authentication, collaboration, sync, or remote storage;
- SQL or embedded databases and background job queues;
- automatic email sending, uploads, or external workflow execution;
- Go, Python, Java, .NET, Docker, or LibreOffice runtime requirements.

The provider-neutral extraction seam MAY be extended through an interface like:

```ts
export interface Attachment {
  id: string;
  path: string;
  mediaType: string;
}

export interface ExtractionRequest {
  templateId: string;
  fields: FieldDefinition[];
  attachments: Attachment[];
}

export interface Extractor {
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}
```

The desktop provider adapter MUST return the same domain extraction contract and MUST NOT move
business validation or rendering responsibility into the provider.

Future MCP or agent integrations MUST consume the same typed application services used by the UI and
CLI. They MUST define workspace permissions and path exposure before implementation.

## 16. Change control

A change that modifies a persisted shape, security boundary, command contract, rendering semantics,
or MVP acceptance criterion MUST update this document, the affected Rust models and generated
TypeScript contracts, and the README where applicable.

Contributors MUST:

1. Keep normative requirements in this document rather than in ad hoc task notes.
2. Keep the Rust workspace boundaries and canonical paths intact.
3. Use explicit migrations for supported persisted-shape changes.
4. Use English for source comments, documentation, generated project files, and commit messages.
5. Use Conventional Commits for commit messages.

Decisions requiring explicit product approval include any new persistence root, database, cloud
backend, authentication, telemetry, agent runtime, MCP runtime, sidecar process, platform-specific
canonical storage, or external transmission beyond the explicit Extract with AI action and selected
connection implemented here.

The implementation status in Section 2 is the baseline for this specification. If code and this
document disagree, the mismatch MUST be resolved by either correcting the implementation or
recording and approving a specification change; it MUST NOT remain ambiguous.
