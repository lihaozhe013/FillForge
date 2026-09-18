# FillForge Project Specification

| Property | Value                                                        |
| -------- | ------------------------------------------------------------ |
| Status   | Normative                                                    |
| Version  | 1.0                                                          |
| Scope    | MVP baseline                                                 |
| Audience | Maintainers, contributors, reviewers, and automation authors |

FillForge is a local-first desktop application for configuring DOCX templates, collecting structured
values from external AI-assisted extraction, reviewing those values, and rendering deterministic
Microsoft Word documents.

The MVP deliberately uses a manual model handoff: the application generates a prompt, the user runs
that prompt with any suitable external AI tool, and the user imports the returned JSON. This
document defines the product contract, technical boundaries, persisted formats, security rules, and
acceptance criteria for that workflow.

## 1. Normative language

The keywords below are normative:

- **MUST**: required for conformance.
- **MUST NOT**: prohibited.
- **SHOULD**: recommended unless a documented reason requires otherwise.
- **MAY**: optional and compatible with this specification.

This document is the normative specification. The README is an operational guide and MUST remain
consistent with this document. Code and tests are the executable implementation of the requirements.

## 2. Product scope

### 2.1 MVP objective

The MVP MUST support this complete local workflow:

1. Import a DOCX template.
2. Discover its placeholders, including placeholders split across Word XML runs.
3. Configure business fields, extraction instructions, normalization, validation, and bindings.
4. Persist the template configuration as human-readable YAML.
5. Create a run and copy optional source evidence into the run.
6. Generate and persist a deterministic extraction prompt.
7. Import raw JSON returned by an external AI tool, including an obvious Markdown JSON fence.
8. Preserve the original extraction result.
9. Review, correct, reject, or fill values manually.
10. Normalize and validate the reviewed business record.
11. Resolve template bindings and render a DOCX deterministically.
12. Retain the run and all generated output as inspectable filesystem artifacts.
13. Reopen templates and runs after restarting the application.

### 2.2 MVP requirement matrix

| ID        | Requirement                                                                                   | Status      |
| --------- | --------------------------------------------------------------------------------------------- | ----------- |
| FF-MVP-01 | Electron desktop application with React, Vite, and typed preload IPC                          | Implemented |
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
| FF-MVP-12 | Direct model calls, agent runtime, MCP server, cloud sync, and authentication                 | Deferred    |

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
| Template import   | User-selected DOCX                   | Template directory and initial YAML | template.docx, template.yaml           |
| Inspection        | Template DOCX and YAML               | Placeholder report                  | No new canonical artifact              |
| Run creation      | Template ID and optional evidence    | Run metadata and copied evidence    | metadata.json, input/                  |
| Prompt generation | Template schema and prompt version   | Prompt plus expected JSON shape     | prompt.md                              |
| Extraction import | Raw user-pasted text                 | Parsed extraction result and issues | extraction.json                        |
| Review            | Extraction result and final values   | Review record and issues            | review.json                            |
| Normalization     | Extraction plus review               | Business values                     | normalized.json                        |
| Rendering         | Valid normalized values and bindings | Versioned DOCX                      | output/result-XXX.docx and result.docx |

## 4. Technical baseline

### 4.1 Required stack

| Concern                       | Requirement                                                |
| ----------------------------- | ---------------------------------------------------------- |
| Package manager               | pnpm only                                                  |
| External runtime              | Node.js 26.x; the root engine requirement is Node.js >= 26 |
| Language                      | TypeScript 7.x with strict type checking                   |
| Desktop runtime               | Electron 44.x                                              |
| Renderer UI                   | React 19 and Vite                                          |
| Runtime validation            | Zod                                                        |
| Human-authored persistence    | YAML                                                       |
| Machine-generated persistence | JSON                                                       |
| DOCX engine                   | Docxtemplater behind a FillForge renderer interface        |
| DOCX archive support          | PizZip                                                     |
| Tests                         | Vitest                                                     |

The repository MUST contain pnpm-lock.yaml. It MUST NOT contain package-lock.json, yarn.lock,
bun.lock, bun.lockb, or a second package manager configuration.

Electron embeds its own Node runtime. Main-process and preload code MUST remain compatible with the
Node runtime shipped by the selected Electron version and MUST NOT assume Node 26-only APIs. Node 26
is the baseline for development tools, tests, builds, and the external CLI.

### 4.2 Required quality commands

The following root commands MUST remain available:

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm format
pnpm format:check
pnpm test
pnpm test:watch
```

A change is ready for review only when the relevant quality commands pass. Changes to domain,
persistence, IPC, or rendering code SHOULD run the full set.

### 4.3 Platform policy

The canonical storage layout MUST be identical on Linux, macOS, and Windows. The implementation MUST
NOT silently replace it with AppData, Application Support, Electron userData, or another
platform-specific application-data root.

The application MAY use native Electron dialogs and shell integration for user-selected files. Those
APIs MUST NOT redefine canonical storage.

## 5. Architecture and package boundaries

### 5.1 Runtime boundary

```text
React renderer
      │
      │ narrow typed contextBridge API
      ▼
Electron preload
      │
      │ validated IPC
      ▼
Electron main
      │
      ▼
Application services
      ├── schema
      ├── core filesystem and configuration
      ├── templates
      ├── extraction
      ├── runs
      └── DOCX renderer
```

The renderer MUST NOT have unrestricted Node.js or filesystem access. Domain logic MUST NOT depend
on React, Electron, or renderer state.

### 5.2 Workspace responsibilities

| Package or directory  | Responsibility                                                              | Required boundary                                          |
| --------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| packages/schema       | Zod schemas and shared domain types                                         | No filesystem or Electron dependency                       |
| packages/core         | Paths, atomic writes, filesystem helpers, IDs, configuration, domain errors | Canonical storage and safety primitives                    |
| packages/docx         | DocumentRenderer interface and Docxtemplater implementation                 | Docxtemplater types do not leak into domain packages       |
| packages/templates    | Template repository, import, inspection report, and bindings                | Owns template lifecycle                                    |
| packages/extraction   | Prompt generation, result parsing, validation, and normalization            | Provider-neutral extraction logic                          |
| packages/runs         | Run repository, artifact lifecycle, review, and rendering orchestration     | Owns run lifecycle and immutability rules                  |
| packages/tools        | CLI commands over the same application services                             | Must not duplicate business rules                          |
| apps/desktop/electron | Main process, preload, IPC validation, dialogs, and safe shell operations   | Only renderer-facing process with direct filesystem access |
| apps/desktop/src      | React views and renderer state                                              | Must use the preload API                                   |

### 5.3 Dependency rules

1. Shared contracts belong in packages/schema.
2. Filesystem access belongs in packages/core or an explicitly owned repository.
3. UI code MUST call application operations through the preload API.
4. CLI commands MUST call the same services as the desktop application.
5. Provider-specific AI code MUST NOT be added to the domain packages.
6. A database repository, cloud service, agent runtime, or MCP server MUST NOT be introduced without
   an explicit product decision.
7. Files over 1,000 lines MUST be considered for decomposition before adding a new responsibility.

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

The path module in packages/core/src/paths.ts MUST be the single source of truth.

```text
<home>/.config/fillforge/config.yaml

<home>/.local/fillforge/templates/
<home>/.local/fillforge/runs/
<home>/.local/fillforge/exports/
<home>/.local/fillforge/cache/
<home>/.local/fillforge/logs/
```

The home root is resolved from the FILLFORGE_HOME environment variable when present; otherwise it is
resolved with the operating system home-directory API. FILLFORGE_HOME overrides the logical home
root, not the layout beneath it.

The application MUST be able to initialize this layout without deleting existing data. Tests MUST
use an isolated root and MUST NOT write to the developer's real FillForge directories.

### 6.3 Directory layout

```text
<home>/.config/fillforge/
└── config.yaml

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

prompt.md is a human-readable artifact rather than a YAML/JSON domain file. Its prompt version is
recorded in metadata.json and its expected JSON block is stored with the prompt.

On load, the application MUST:

1. Parse the file.
2. Reject an explicitly unsupported newer schema version.
3. Validate the parsed value with the corresponding Zod schema.
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

DOCX placeholders MUST use Docxtemplater-compatible names such as:

```text
{invoice_number}
{invoice_date}
{total_amount}
```

The inspection implementation MUST be DOCX-aware and MUST detect a visible placeholder split across
Word XML runs. A naive regular expression over a single raw XML string is not sufficient.

Inspection returns:

- placeholders: every discovered placeholder, returned in normalized key order;
- unconfigured: discovered placeholders with no binding entry;
- unreferenced: configured fields not referenced by a binding for a discovered placeholder.

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

Secrets MUST NOT be written to config.yaml by the MVP.

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

The DOCX implementation MUST be hidden behind this domain boundary:

```ts
export interface TemplateInspection {
  placeholders: string[];
}

export interface RenderInput {
  document: Uint8Array;
  values: Record<string, unknown>;
}

export interface DocumentRenderer {
  inspect(document: Uint8Array): Promise<TemplateInspection>;
  render(input: RenderInput): Promise<Uint8Array>;
}
```

Docxtemplater and PizZip MAY be used inside packages/docx. Their implementation types MUST NOT
become part of the template, extraction, or run contracts.

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

1. Import MUST copy the selected DOCX to templates/<id>/template.docx.
2. The application MUST continue to work if the original source file is later moved or deleted.
3. Template import MUST initialize an empty fields and bindings mapping.
4. Save MUST validate the complete template schema and ensure the configured document path stays
   inside the template directory.
5. Duplicate MUST copy the directory, assign a valid new ID, and update the schema ID.
6. Delete MUST remove only the selected template directory.
7. Listing SHOULD continue when an individual template is unreadable; the unreadable entry MAY be
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
3. The parser MUST validate the field-object shape with Zod.
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
- Run listing MUST be newest-first by created_at.
- An unreadable run MUST NOT be modified or silently repaired during listing.
- The application MUST be able to reopen a valid run and load its metadata, prompt, expected JSON,
  extraction, review, normalized record, and generated outputs. The UI MUST display the user-facing
  run stages and generated outputs; normalized.json remains an inspectable service artifact.
- Source evidence MUST be copied into input/ and MUST NOT be modified in place.
- Attachment filename collisions MUST be resolved with a deterministic suffix such as -2, -3.

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

## 10. Desktop IPC contract

### 10.1 API surface

The preload MUST expose a narrow window.fillforge API with these operation groups:

| Group     | Operations                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------ |
| templates | list, import, load, saveSchema, inspect, duplicate, delete, promptPreview                        |
| settings  | load, save                                                                                       |
| runs      | create, list, load, generatePrompt, importExtraction, saveReview, normalize, render, attachFiles |
| system    | openPath, showItemInFolder, exportCopy                                                           |

Renderer code MUST NOT call ipcRenderer directly. All IPC channels MUST be validated in the main
process with Zod before invoking a service.

### 10.2 Channels and payloads

Current channels are:

```text
templates:list
templates:import
templates:load
templates:update-schema
templates:inspect
templates:duplicate
templates:delete
templates:prompt-preview

settings:load
settings:save

runs:create
runs:list
runs:load
runs:generate-prompt
runs:import-extraction
runs:save-review
runs:normalize
runs:render
runs:attach-files

system:open-path
system:show-item-in-folder
system:export-copy
```

Boundary requirements:

- Empty operations MUST accept no meaningful payload.
- ID-bearing operations MUST validate template IDs or ULID run IDs with shared schemas.
- runs:create MUST accept only the template ID from the renderer; attachment paths MUST NOT be
  supplied by renderer payloads.
- runs:import-extraction MUST reject empty input and inputs longer than 2,000,000 characters.
- settings:save MUST validate theme, advanced-field flag, and a trimmed prompt version between 1 and
  100 characters.
- IPC responses MUST use either { ok: true, data } or { ok: false, error }.
- Error DTOs MUST contain code and message and MAY contain safe details. Arbitrary Node/Electron
  errors and stack traces MUST NOT be sent to the renderer.

### 10.3 Native file operations

The main process owns native dialogs for DOCX import, source attachment, and export.

System open, reveal, and export operations MUST:

1. Accept only a path selected from an application result or another trusted main-process flow.
2. Resolve the path and verify it is inside the FillForge data directory.
3. Resolve symlinks and verify the real path remains inside that directory.
4. Require an existing regular file for open, reveal, and export source operations.
5. Permit export to a user-selected destination from the native save dialog.

The renderer MUST NOT be given a general-purpose file read/write API.

### 10.4 Help menu

The desktop application MUST install a native application menu with a Help submenu. Help MUST
provide these entries:

| Menu item             | Destination                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| User Guide            | https://github.com/lihaozhe013/FillForge/blob/main/docs/USER_GUIDE.md      |
| AI Agent Prompt       | https://github.com/lihaozhe013/FillForge/blob/main/docs/AI_AGENT_PROMPT.md |
| Project Specification | https://github.com/lihaozhe013/FillForge/blob/main/SPEC.md                 |
| FillForge on GitHub   | https://github.com/lihaozhe013/FillForge                                   |

Each entry MUST open its destination with the operating system's external browser through Electron
shell integration. The Help menu MUST NOT read arbitrary local files or expose a filesystem API to
the renderer. The URLs are intentionally pinned to the main branch so a packaged application keeps a
stable documentation entry point.

## 11. Security and privacy

- BrowserWindow MUST use contextIsolation: true, nodeIntegration: false, sandbox: true where
  supported, and webSecurity: true.
- The preload MUST expose only the documented FillForge API.
- Path construction MUST validate identifiers and prevent traversal.
- Template document paths MUST remain inside the template directory, including after symlink
  resolution.
- Data file paths used by system operations MUST remain inside the data directory, including after
  symlink resolution.
- Imported templates and attachments MUST be copied; the originals MUST not be modified.
- The MVP MUST NOT upload documents, images, PDFs, prompts, or extracted values automatically.
- The MVP MUST NOT include telemetry, analytics, authentication, or a cloud backend.
- Logs MUST avoid full document contents, image/PDF bytes, secrets, API keys, and credentials.
- Debug logs MAY be written to debug-logs/; release logs belong in the configured per-user log
  directory. The summary debug.log SHOULD be checked before a feature-specific debug log when
  diagnosing a failure.
- Future direct AI integration MUST make external transmission explicit and MUST define secret
  storage before implementation.

## 12. CLI contract

The CLI MUST assemble the same services as the desktop application and MUST NOT contain a second
implementation of domain behavior.

```bash
pnpm tsx packages/tools/src/index.ts inspect-template <templateId>
pnpm tsx packages/tools/src/index.ts extract-fields <templateId>
pnpm tsx packages/tools/src/index.ts validate-fields <templateId> <extraction.json>
pnpm tsx packages/tools/src/index.ts render-document <runId>
```

Command semantics:

- inspect-template prints discovered placeholders and configuration gaps.
- extract-fields prints the deterministic prompt and expected JSON structure.
- validate-fields parses and validates an extraction file without mutating a run; on success, the
  current CLI also prints normalized values.
- render-document renders an existing run using the run service and writes output under its run
  directory.

All commands MUST honor FILLFORGE_HOME.

## 13. Testing and release gates

### 13.1 Required test coverage

Tests MUST use temporary or environment-overridden roots and MUST cover:

- valid and invalid config, template, run, extraction, review, and normalized schemas;
- unsupported schema versions;
- invalid and traversal-prone identifiers and document paths;
- placeholder inspection across Word XML run boundaries;
- deterministic prompt output and expected JSON output;
- plain JSON, fenced JSON, malformed JSON, missing fields, wrong types, not_found, and ambiguous
  extraction cases;
- blank strings, numeric coercion, boolean coercion, and invalid calendar dates;
- all built-in binding transforms;
- immutable prompt and extraction artifacts;
- review persistence, normalized invalidation, and restart reads;
- versioned outputs and newest-output mirroring;
- typed IPC payload validation;
- safe system path operations;
- an end-to-end DOCX workflow using fixtures.

### 13.2 Quality gates

Before merging a change, run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

A failure in a domain-critical gate MUST be fixed or explicitly documented before merge.

## 14. MVP acceptance criteria

The following scenario is the release-level acceptance test:

1. Launch the desktop application with only Node.js 26.x and pnpm installed.
2. Import the invoice DOCX fixture.
3. Confirm the application discovers invoice_number, invoice_date, seller_name, and total_amount,
   including any split-run placeholder in the fixture.
4. Configure field definitions and bindings, then confirm template.yaml is readable and versioned.
5. Create a run and attach a source image or PDF; confirm the evidence is copied into input/.
6. Generate a prompt; confirm the prompt and expected JSON are visible and prompt.md is immutable.
7. Paste valid JSON, including a fenced response in one test; confirm extraction.json is persisted
   once and issues are displayed when applicable.
8. Review at least one field; confirm model_value remains unchanged, final_value is stored in
   review.json, and normalized.json is invalidated.
9. Attempt rendering with an invalid required value; confirm rendering is rejected with field
   issues.
10. Correct the value and render; confirm result-001.docx and result.docx exist and are identical.
11. Render again; confirm a new version is retained and result.docx mirrors the newest version.
12. Restart the application; confirm the template, run, review, and output remain available from
    ordinary files without a database.
13. Open Help > User Guide and confirm it opens the public GitHub documentation page.
14. Run the CLI inspection, validation, and rendering commands against the same isolated root.

## 15. Explicit non-goals and future seams

The following are outside the MVP and MUST NOT be added as incidental infrastructure:

- direct OpenAI, Anthropic, Gemini, or other model-provider calls;
- OCR, embeddings, vector databases, RAG, or cloud document processing;
- agent runtimes, MCP servers, browser automation, or workflow graph editors;
- user accounts, authentication, collaboration, sync, or remote storage;
- SQL or embedded databases and background job queues;
- automatic email sending, uploads, or external workflow execution;
- Rust, Go, Python, Java, .NET, Docker, or LibreOffice runtime requirements.

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

The MVP does not invoke this interface. Future providers MUST return the same domain extraction
contract and MUST NOT move business validation or rendering responsibility into the provider.

Future MCP or agent integrations MUST consume the same typed application services used by the UI and
CLI. They MUST define workspace permissions and path exposure before implementation.

## 16. Change control

A change that modifies a persisted shape, security boundary, IPC contract, rendering semantics, or
MVP acceptance criterion MUST update this document, the affected schemas/tests, and the README where
applicable.

Contributors MUST:

1. Keep normative requirements in this document rather than in ad hoc task notes.
2. Add or update tests for behavior changes.
3. Keep package boundaries and canonical paths intact.
4. Use explicit migrations for supported persisted-shape changes.
5. Use English for source comments, documentation, generated project files, and commit messages.
6. Use Conventional Commits for commit messages.

Decisions requiring explicit product approval include any new persistence root, database, cloud
backend, authentication, telemetry, direct AI dependency, agent runtime, MCP runtime, sidecar
process, platform-specific canonical storage, or external transmission of user documents.

The implementation status in Section 2 is the baseline for this specification. If code and this
document disagree, the mismatch MUST be resolved by either correcting the implementation or
recording and approving a specification change; it MUST NOT remain ambiguous.
