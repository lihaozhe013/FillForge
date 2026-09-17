# SPEC.md

## 1. Project Overview

Build a local-first desktop application for configuring, filling, reviewing, and rendering Microsoft
Word `.docx` templates.

The product is centered around this workflow:

```text
DOCX template
    ↓
discover placeholders
    ↓
configure semantic field definitions
    ↓
generate an AI extraction prompt/schema
    ↓
user gives the prompt + source documents/images to an AI
    ↓
AI returns structured JSON
    ↓
user pastes/imports JSON into this application
    ↓
validate + review + correct
    ↓
deterministically render DOCX
```

The first version MUST NOT require an integrated AI agent.

The first version MUST be useful even when the user manually copies the generated prompt into
ChatGPT, Claude, Gemini, or another multimodal model and pastes the resulting JSON back into the
app.

The architecture MUST, however, make future integration with:

- direct model APIs,
- multimodal models,
- MCP,
- OpenAI Agents SDK,
- Mastra,
- other agent runtimes,

straightforward without rewriting the domain model or document engine.

The key abstraction is:

```text
Unstructured Evidence
        ↓
Extraction Schema
        ↓
Structured Record
        ↓
Validation / Human Review
        ↓
Template Binding
        ↓
DOCX
```

Do NOT architect the application as:

```text
image → AI → Word replacement
```

The structured record between AI extraction and document rendering is a first-class domain object.

---

# 2. Hard Technical Constraints

These constraints are deliberate. Do not replace them without explicit instruction.

## Runtime and tooling

Use:

```text
Node.js 26.x
pnpm
TypeScript 7.x
Electron 44.x
React
Vite
Zod
Docxtemplater
PizZip
YAML
```

As of project creation:

```text
Node.js 26.x       development/tooling baseline
TypeScript 7.x     compiler
Electron 44.x      desktop runtime
```

Node 26 is the required external development runtime.

Note that Electron embeds its own Node runtime. Electron 44 currently embeds Node 24.x. Application
code that executes inside Electron main/preload processes MUST therefore avoid depending on Node
26-only runtime APIs unless that code executes in an external Node process.

Use Node 26 for:

- pnpm scripts,
- development tooling,
- build scripts,
- test runner where appropriate,
- CLI utilities executed outside Electron.

Electron main/preload code must remain compatible with Electron's bundled Node runtime.

Use pnpm only.

Do NOT introduce:

- Bun,
- Yarn,
- npm lockfiles,
- Deno.

The repository must contain:

```text
pnpm-lock.yaml
```

and MUST NOT contain:

```text
package-lock.json
yarn.lock
bun.lock
bun.lockb
```

---

# 3. No Database

This is a hard architectural constraint.

DO NOT add:

```text
SQLite
PostgreSQL
MySQL
LevelDB
IndexedDB as canonical storage
PouchDB
Dexie as canonical storage
Prisma
Drizzle
TypeORM
Sequelize
```

Do not introduce a database "for future scalability".

Do not create an abstraction whose only purpose is to make adding SQL easier later.

The filesystem is the source of truth.

Persistent application data MUST be represented as ordinary inspectable files and directories.

Preferred formats:

```text
YAML   → human-authored configuration
JSON   → machine-generated records
MD     → human-readable prompt/instructions when useful
DOCX   → templates and generated documents
images → source evidence
PDF    → source evidence
```

The filesystem layout itself is part of the product design.

Advantages we explicitly want:

- transparent storage,
- easy backup,
- easy copying,
- easy debugging,
- Git-friendly template configuration,
- easy synchronization,
- no hidden DB state,
- agent/CLI friendliness,
- straightforward future MCP exposure.

If indexing eventually becomes necessary, an index may be added later as a disposable cache.

It MUST NOT become canonical storage.

An index should always be rebuildable from the files.

---

# 4. Cross-platform Filesystem Policy

Do NOT use operating-system-specific application-data conventions.

In particular, do NOT use:

```text
%APPDATA%
%LOCALAPPDATA%
AppData/Roaming
AppData/Local
~/Library/Application Support
Electron app.getPath("userData")
```

as canonical storage.

Use the same logical paths on Linux, macOS, and Windows.

Resolve `~` using the current user's home directory.

Configuration:

```text
~/.config/docufill/
```

User data:

```text
~/.local/docufill/
```

Canonical paths:

```text
~/.config/docufill/config.yaml

~/.local/docufill/templates/
~/.local/docufill/runs/
~/.local/docufill/exports/
~/.local/docufill/cache/
```

Even on Windows, use:

```text
<HOME>/.config/docufill
<HOME>/.local/docufill
```

Do not silently translate these into Windows AppData directories.

Implement a single path module:

```text
packages/core/src/paths.ts
```

It should expose functions similar to:

```ts
export interface AppPaths {
  home: string;
  configDir: string;
  configFile: string;
  dataDir: string;
  templatesDir: string;
  runsDir: string;
  exportsDir: string;
  cacheDir: string;
}

export function getAppPaths(): AppPaths;
```

Use:

```ts
os.homedir();
```

for resolving the user's home directory.

Tests MUST be able to override the home/data root without touching the real user's files.

For example:

```text
DOCUFILL_HOME=/tmp/docufill-test
```

or an equivalent dependency-injected path provider.

---

# 5. Security Boundary

Electron security must be conservative.

Renderer MUST NOT get unrestricted Node.js access.

Use:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true where practical
```

Use a preload script with a narrow `contextBridge` API.

Architecture:

```text
React Renderer
      │
      │ typed IPC
      ▼
Electron Preload
      │
      ▼
Electron Main
      │
      ▼
Core packages
      │
      ├── filesystem
      ├── DOCX
      ├── schema
      └── extraction logic
```

Do NOT expose:

```ts
require;
process;
fs;
child_process;
```

directly to renderer code.

Renderer UI should call typed application operations.

Example:

```ts
window.docufill.templates.list();
window.docufill.templates.import();
window.docufill.templates.updateSchema();
window.docufill.runs.create();
window.docufill.runs.importExtraction();
window.docufill.runs.render();
```

IPC payloads must be validated with Zod at process boundaries.

Do not trust renderer input merely because it came from our own UI.

---

# 6. Repository Structure

Use a pnpm workspace.

Preferred structure:

```text
docufill/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.json
├── biome.json
│
├── apps/
│   └── desktop/
│       ├── package.json
│       ├── electron/
│       │   ├── main.ts
│       │   ├── preload.ts
│       │   ├── ipc/
│       │   └── window.ts
│       │
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── pages/
│       │   ├── components/
│       │   ├── hooks/
│       │   └── styles/
│       │
│       └── vite.config.ts
│
├── packages/
│   ├── schema/
│   │   └── src/
│   │       ├── template.ts
│   │       ├── field.ts
│   │       ├── extraction.ts
│   │       ├── run.ts
│   │       └── index.ts
│   │
│   ├── core/
│   │   └── src/
│   │       ├── paths.ts
│   │       ├── filesystem.ts
│   │       ├── atomic-write.ts
│   │       ├── ids.ts
│   │       └── errors.ts
│   │
│   ├── templates/
│   │   └── src/
│   │       ├── repository.ts
│   │       ├── inspect.ts
│   │       ├── bindings.ts
│   │       └── service.ts
│   │
│   ├── docx/
│   │   └── src/
│   │       ├── renderer.ts
│   │       ├── docxtemplater-renderer.ts
│   │       ├── inspector.ts
│   │       └── errors.ts
│   │
│   ├── extraction/
│   │   └── src/
│   │       ├── prompt-builder.ts
│   │       ├── result-parser.ts
│   │       ├── validator.ts
│   │       └── normalizer.ts
│   │
│   ├── runs/
│   │   └── src/
│   │       ├── repository.ts
│   │       ├── service.ts
│   │       └── review.ts
│   │
│   └── tools/
│       └── src/
│           ├── inspect-template.ts
│           ├── extract-fields.ts
│           ├── validate-fields.ts
│           ├── render-document.ts
│           └── index.ts
│
└── tests/
    ├── fixtures/
    │   ├── templates/
    │   └── extraction/
    └── integration/
```

Do not over-fragment packages immediately if it makes initial development cumbersome.

However, maintain these logical boundaries even if some packages are temporarily combined.

---

# 7. TypeScript 7

Use TypeScript 7.

Do not configure the project as if it were TypeScript 5.

Important TypeScript 7 behavior must be accounted for.

Use strict typing.

Do not disable strict mode.

Explicitly configure:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": []
  }
}
```

Individual packages should specify required globals explicitly.

For Node/Electron packages:

```json
{
  "compilerOptions": {
    "types": ["node"]
  }
}
```

Renderer packages should not accidentally inherit Node globals.

Avoid tooling that requires TypeScript's old programmatic compiler API unless verified compatible
with TypeScript 7.

Prefer Biome for formatting and basic linting instead of making ESLint/typescript-eslint part of the
critical path.

Required scripts should include:

```text
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm format
pnpm test
```

`pnpm typecheck` must use TypeScript 7.

---

# 8. Core Domain Model

The main domain concepts are:

```text
Template
FieldDefinition
TemplateBinding
ExtractionSchema
ExtractionResult
ReviewedRecord
Run
Artifact
```

Do not make DOCX placeholders themselves the central business model.

Separate:

```text
DOCX placeholder
Business field
Extracted value
```

They may be 1:1 in simple cases, but the architecture must not assume this.

Example:

```text
Business field:
invoice_date = 2026-09-16

DOCX bindings:
invoice_year  ← invoice_date.year
invoice_month ← invoice_date.month
invoice_day   ← invoice_date.day
```

Another example:

```text
Business field:
total_amount = 1234.50

DOCX binding:
amount_uppercase
    ← chineseCurrencyUppercase(total_amount)
```

The pipeline must therefore be:

```text
AI extraction
      ↓
business record
      ↓
normalization
      ↓
validation
      ↓
binding transforms
      ↓
DOCX placeholders
```

---

# 9. Template Storage Format

Each template is a directory.

Example:

```text
~/.local/docufill/templates/invoice-cn/
├── template.docx
├── template.yaml
└── README.md
```

`README.md` is optional.

Do not put runtime extraction data inside template directories.

Example `template.yaml`:

```yaml
schema_version: 1

id: invoice-cn
name: 中国发票
description: 从中国发票提取信息并生成目标文档

document:
  file: template.docx

fields:
  invoice_number:
    label: 发票号码
    description: 发票上明确标注的发票号码
    type: string
    required: true

    extraction:
      instruction: >
        找到明确标记为“发票号码”的值。 不要将“发票代码”作为发票号码。

    normalization:
      trim: true
      remove_spaces: true

    validation:
      regex: '^[0-9A-Za-z-]+$'

  invoice_date:
    label: 开票日期
    description: 发票票面上的开票日期
    type: date
    required: true

    extraction:
      instruction: >
        提取票面上标记为开票日期的日期。

    output:
      format: YYYY-MM-DD

  seller_name:
    label: 销售方名称
    description: 销售方企业名称
    type: string
    required: true

    extraction:
      instruction: >
        从销售方区域提取企业名称。 不要返回购买方名称。

  total_amount:
    label: 价税合计
    description: 发票最终含税总金额
    type: number
    required: true

    extraction:
      instruction: >
        提取价税合计的小写金额。 不要返回税额或未税金额。

bindings:
  invoice_number:
    source: invoice_number

  invoice_date:
    source: invoice_date

  seller_name:
    source: seller_name

  total_amount:
    source: total_amount
```

The exact schema may evolve, but preserve this separation.

---

# 10. Schema Versioning

Every persisted YAML/JSON domain file MUST have:

```yaml
schema_version: 1
```

or:

```json
{
  "schema_version": 1
}
```

Do not silently change persisted file shapes.

Future migrations should use explicit code:

```ts
migrateTemplateV1ToV2();
```

The application should reject unsupported newer schema versions with a clear error.

Do not automatically mutate files merely because the application launched.

---

# 11. Placeholder Convention

Use a clear placeholder syntax in DOCX:

```text
{invoice_number}
{invoice_date}
{seller_name}
{total_amount}
```

Use Docxtemplater-compatible syntax.

Avoid placeholder IDs such as:

```text
{占位符1}
{占位符2}
```

Field keys should be stable machine identifiers.

Preferred convention:

```text
snake_case
```

Examples:

```text
invoice_number
invoice_date
buyer_name
seller_name
total_amount
```

Labels and descriptions may be Chinese or any other language.

The stable key must not depend on the human-facing label.

---

# 12. DOCX Inspection

The app should support importing a `.docx` and discovering placeholders.

Workflow:

```text
Import DOCX
    ↓
inspect template
    ↓
discover placeholder keys
    ↓
compare against template.yaml
    ↓
show unconfigured placeholders
```

Do NOT parse DOCX placeholders using a naive regex over `word/document.xml`.

Word may split visible text across XML runs.

Prefer Docxtemplater's parser/inspection mechanisms or another DOCX-aware approach capable of
handling run boundaries.

For each detected placeholder, show configuration fields:

```text
Key
Label
Description
Type
Required
Extraction instruction
Validation
Normalization
```

Example UI:

```text
Detected placeholder:

invoice_number

Display name:
[ 发票号码 ]

Meaning:
[ 发票上明确标注的发票号码 ]

AI extraction instruction:
[ 提取“发票号码”，不要提取“发票代码” ]

Type:
[ string ▼ ]

Required:
[x]
```

Saving this writes `template.yaml`.

---

# 13. DocumentRenderer Interface

Docxtemplater is an implementation detail.

Do not let Docxtemplater types leak through domain packages.

Define an interface approximately like:

```ts
export interface TemplateInspection {
  placeholders: string[];
}

export interface DocumentRenderer {
  inspect(document: Uint8Array): Promise<TemplateInspection>;

  render(input: { document: Uint8Array; values: Record<string, unknown> }): Promise<Uint8Array>;
}
```

Implement:

```text
DocxtemplaterRenderer
```

using:

```text
docxtemplater
pizzip
```

Future engines must be swappable.

Possible future implementations:

```text
RustDocumentRenderer
LibreOfficeDocumentRenderer
RemoteDocumentRenderer
```

None need to be implemented now.

---

# 14. Prompt Generation

The application must generate a complete extraction prompt from `template.yaml`.

Users should not need to write prompt engineering manually.

For a template such as:

```yaml
fields:
  invoice_number:
    label: 发票号码
    type: string
    extraction:
      instruction: 不要和发票代码混淆
```

generate a prompt conceptually similar to:

```text
You are a structured document information extractor.

Inspect the documents/images supplied by the user.

Extract only the requested fields.

Do not guess.

If a field cannot be reliably determined, return null.

Requested fields:

invoice_number
Meaning: 发票号码
Type: string
Extraction rule:
不要和发票代码混淆

Return valid JSON only.

Expected format:

{
  "invoice_number": {
    "value": "string or null",
    "status": "found | not_found | ambiguous",
    "evidence": "short supporting text or null"
  }
}
```

Prompt generation must be deterministic for a given:

```text
template schema version
prompt generator version
```

Record a `prompt_version`.

Example:

```text
docufill-extraction-v1
```

Do not make generated prompts dependent on UI code.

Implement prompt generation in:

```text
packages/extraction/
```

---

# 15. AI Output Contract

Do not ask AI models to edit YAML.

Do not ask AI models to modify DOCX.

Do not ask AI models to produce a final document.

AI's role is:

```text
unstructured evidence
        ↓
structured extraction result
```

Expected output:

```json
{
  "invoice_number": {
    "value": "12345678",
    "status": "found",
    "evidence": "发票号码：12345678"
  },
  "invoice_date": {
    "value": "2026-09-16",
    "status": "found",
    "evidence": "开票日期：2026年09月16日"
  },
  "seller_name": {
    "value": null,
    "status": "ambiguous",
    "evidence": null
  }
}
```

Minimum status values:

```text
found
not_found
ambiguous
```

Do NOT rely on model-generated numeric confidence as authoritative.

Evidence is more useful than arbitrary confidence values.

Confidence may be added later but is not required.

---

# 16. Extraction Import

MVP does not require model API integration.

Required workflow:

```text
Template
   ↓
Generate Prompt
   ↓
[Copy Prompt]
   ↓
user opens AI application
   ↓
user attaches source image/PDF
   ↓
AI returns JSON
   ↓
user copies JSON
   ↓
[Paste AI Result]
   ↓
application parses + validates result
```

The UI should accept:

```text
raw JSON
```

and tolerate surrounding Markdown fences such as:

````text
```json
{ ... }
````

````

Strip obvious Markdown fences before parsing.

Do NOT attempt aggressive recovery of badly malformed arbitrary text in MVP.

If JSON is malformed, show a useful parse error.

The user should be able to correct it manually.

---

# 17. Review UI

AI output MUST NOT immediately produce a final document.

Always provide a review step.

Example:

```text
┌─────────────────────────────────────────────┐
│ 发票号码                                    │
│ 12345678                            ✓ found │
│ Evidence: 发票号码：12345678                │
├─────────────────────────────────────────────┤
│ 开票日期                                    │
│ 2026-09-16                          ✓ found │
│ Evidence: 开票日期：2026年09月16日           │
├─────────────────────────────────────────────┤
│ 销售方名称                                  │
│ [____________________________]              │
│                                    ambiguous │
└─────────────────────────────────────────────┘
````

Users must be able to:

- accept values,
- edit values,
- fill missing values,
- clear values,
- see evidence,
- see validation errors.

Keep:

```text
model value
final reviewed value
```

separate.

Do not overwrite the original model extraction.

---

# 18. Run Storage

Each execution is stored as a self-contained directory.

Example:

```text
~/.local/docufill/runs/01K5A.../
├── metadata.json
├── input/
│   ├── invoice.jpg
│   └── supporting.pdf
├── prompt.md
├── extraction.json
├── review.json
├── normalized.json
└── output/
    └── result.docx
```

Some files may not exist until the corresponding stage has happened.

Example `metadata.json`:

```json
{
  "schema_version": 1,
  "id": "01K5A...",
  "created_at": "2026-09-16T12:30:00.000Z",
  "template_id": "invoice-cn",
  "template_schema_version": 1,
  "prompt_version": "docufill-extraction-v1"
}
```

Use sortable IDs.

ULID is preferred.

UUIDv7 is also acceptable.

Do not use sequential numeric database-style IDs.

---

# 19. Immutable Evidence

Preserve AI input/output information for debugging and future evaluation.

Do not rewrite:

```text
prompt.md
extraction.json
```

after review.

Human corrections go in:

```text
review.json
```

Example:

```json
{
  "schema_version": 1,
  "fields": {
    "invoice_number": {
      "model_value": "12345678",
      "final_value": "12345679",
      "decision": "corrected"
    },
    "invoice_date": {
      "model_value": "2026-09-16",
      "final_value": "2026-09-16",
      "decision": "accepted"
    }
  }
}
```

Allowed decisions:

```text
accepted
corrected
rejected
filled_manually
```

This data will later become the evaluation dataset.

It is valuable product data.

Preserve it.

---

# 20. Atomic File Writes

Avoid corrupting YAML/JSON files if the process crashes.

For mutable files:

```text
write temporary file
fsync/close where appropriate
rename into place
```

Provide an atomic write helper.

Conceptually:

```ts
await atomicWriteFile(target, JSON.stringify(value, null, 2));
```

Do not implement application state through repeated mutation of one giant JSON file.

Bad:

```text
~/.local/docufill/state.json
```

containing every template and run.

Good:

```text
templates/<id>/...
runs/<id>/...
```

One logical entity should have its own files/directory.

---

# 21. Repository Interfaces

Filesystem operations should be behind domain-oriented repository APIs.

This is NOT a database abstraction.

Example:

```ts
export interface TemplateRepository {
  list(): Promise<TemplateSummary[]>;

  load(id: string): Promise<Template>;

  create(input: CreateTemplateInput): Promise<Template>;

  saveSchema(id: string, schema: TemplateSchema): Promise<void>;

  delete(id: string): Promise<void>;
}
```

Implementation:

```text
FileTemplateRepository
```

Similarly:

```ts
export interface RunRepository {
  create(...): Promise<Run>;
  load(id: string): Promise<Run>;
  list(...): Promise<RunSummary[]>;
  saveExtraction(...): Promise<void>;
  saveReview(...): Promise<void>;
}
```

Do NOT add:

```text
SqlTemplateRepository
SqlRunRepository
```

unless explicitly requested in the future.

---

# 22. In-memory Indexing

For MVP, listing runs/templates can simply scan directories.

Example:

```ts
await fs.readdir(paths.templatesDir, {
  withFileTypes: true
});
```

If performance becomes noticeable, maintain an in-memory index during application lifetime.

Do not prematurely persist indexes.

The expected early scale is small enough for filesystem scanning.

---

# 23. Template Binding

AI field definitions and DOCX placeholders must be decoupled.

Example:

```yaml
bindings:
  invoice_number:
    source: invoice_number

  year:
    source: invoice_date
    transform: date_year

  month:
    source: invoice_date
    transform: date_month

  day:
    source: invoice_date
    transform: date_day

  amount_uppercase:
    source: total_amount
    transform: chinese_currency_uppercase
```

Implement a transform registry:

```ts
export type BindingTransform = (value: unknown) => unknown;
```

Initial transforms may include:

```text
identity
date_year
date_month
date_day
trim
uppercase
lowercase
```

`chinese_currency_uppercase` may be added if useful.

Transforms must be deterministic.

AI should never be used for deterministic formatting.

---

# 24. Validation

Validation happens before rendering.

Possible rules:

```text
required
type
regex
minimum
maximum
date format
enum
```

Use Zod internally where appropriate.

Template YAML should remain implementation-neutral.

Example:

```yaml
validation:
  regex: '^[0-9]{8,20}$'
```

Do not store JavaScript expressions in YAML.

Do not `eval()` configuration.

---

# 25. Zod as Runtime Boundary

Persisted files MUST be validated when loaded.

IPC messages MUST be validated.

AI extraction results MUST be validated.

Examples:

```text
YAML → parse → Zod → domain object

JSON → parse → Zod → extraction result

IPC → Zod → service call
```

Do not scatter unchecked:

```ts
as SomeType
```

through the application.

Prefer:

```ts
SomeSchema.parse(value);
```

or:

```ts
SomeSchema.safeParse(value);
```

depending on context.

---

# 26. Error Handling

Define domain errors.

Examples:

```text
TemplateNotFoundError
InvalidTemplateSchemaError
DocxInspectionError
DocxRenderError
ExtractionParseError
ValidationError
UnsupportedSchemaVersionError
```

Errors exposed to renderer should be serialized into a safe structure:

```ts
interface AppErrorDto {
  code: string;
  message: string;
  details?: unknown;
}
```

Do not expose arbitrary Electron/Node stack traces to end users.

During development, stacks should remain available in logs/devtools.

---

# 27. Logging

Keep logging simple.

Do not add an observability platform.

Logs may be written to:

```text
~/.local/docufill/logs/
```

or emitted to stdout during development.

Avoid logging complete sensitive documents by default.

Do not log:

```text
entire images
entire PDFs
API keys
full AI credentials
```

Log IDs and operation metadata instead.

---

# 28. Settings

Application configuration lives in:

```text
~/.config/docufill/config.yaml
```

Example:

```yaml
schema_version: 1

ui:
  theme: system

editor:
  show_advanced_fields: false

extraction:
  prompt_version: docufill-extraction-v1
```

Future AI provider configuration may look like:

```yaml
ai:
  provider: openai
  model: some-model
```

Secrets MUST NOT be written directly into this YAML unless explicitly required.

When direct model integration is implemented, use a proper secret strategy.

Do not implement AI provider credentials in the MVP unless required.

---

# 29. MVP Screens

Implement the following primary views.

## Home

Show:

```text
Templates
Recent runs
Import template
```

## Template List

Show available template directories.

Actions:

```text
Create
Import DOCX
Open
Duplicate
Delete
```

## Template Editor

Sections:

```text
General
Fields
Bindings
Prompt Preview
DOCX placeholders
```

The editor should detect:

```text
placeholders present in DOCX but missing from config
fields configured but no longer referenced
```

## New Run

Select template.

Optionally attach source materials for keeping with the run.

Generate prompt.

Buttons:

```text
Copy Prompt
Copy Expected JSON Schema
Paste AI Result
```

## Extraction Review

Review/edit extracted values.

Display:

```text
field label
value
status
evidence
validation state
```

## Render

Render final `.docx`.

Save under:

```text
run/output/
```

Provide:

```text
Open output
Show in folder
Export copy
```

---

# 30. MVP Scope

The first usable milestone MUST support:

1. Start Electron desktop app.
2. Initialize `~/.config/docufill` and `~/.local/docufill`.
3. Import a DOCX template.
4. Detect placeholders.
5. Create/edit semantic field configuration.
6. Persist template configuration as YAML.
7. Generate extraction prompt.
8. Copy extraction prompt.
9. Paste AI-generated JSON.
10. Parse and validate extraction result.
11. Review/edit values.
12. Save original AI result separately from reviewed result.
13. Bind reviewed fields to DOCX placeholders.
14. Generate final DOCX.
15. Preserve the complete run as filesystem artifacts.
16. Reopen an old run and inspect what happened.

That is MVP.

---

# 31. Explicit Non-goals for MVP

Do NOT implement unless needed for the above workflow:

```text
Agent runtime
MCP server
direct OpenAI API
direct Anthropic API
direct Gemini API
OCR pipeline
vector database
embeddings
RAG
cloud accounts
user authentication
sync server
team collaboration
SQL
background job queue
plugin marketplace
automatic email sending
automatic file upload
browser automation
workflow graph editor
```

Do not build abstractions solely to support hypothetical future features.

Leave clean seams instead.

---

# 32. Future AI Integration Boundary

Even though MVP does not invoke models directly, define an extraction interface that future
providers can implement.

Example:

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

Do NOT implement provider-specific details in domain packages.

Possible future implementations:

```text
OpenAIExtractor
AnthropicExtractor
GeminiExtractor
```

The manual MVP flow can conceptually be:

```text
ManualExternalExtractor
```

but it does not need to literally implement asynchronous model execution.

---

# 33. Future Agent Runtime Boundary

Core application operations should already resemble tools.

Implement application services that can later be wrapped without redesign.

Target operations:

```text
list_templates
inspect_template
get_template_schema
create_run
generate_extraction_prompt
validate_extraction
save_review
render_document
get_run
list_runs
```

Each operation should have:

```text
typed input
typed output
Zod schema
deterministic behavior where applicable
```

Future:

```text
Desktop UI ─┐
CLI ────────┼── Core Tools
MCP ────────┤
Agent ──────┘
```

Do not make the Agent runtime own business logic.

Correct future architecture:

```text
Agent runtime
      ↓
tools
      ↓
application services
      ↓
domain
```

Incorrect:

```text
Agent runtime
      ↓
random callbacks containing business logic
```

---

# 34. Future MCP Support

Do NOT implement MCP during MVP.

However, tool contracts should be easy to expose later.

Potential future MCP tools:

```text
inspect_template
get_template_schema
generate_extraction_prompt
validate_fields
render_document
```

Filesystem paths should not be blindly exposed to remote clients.

When MCP is eventually added, security and workspace permissions must be designed explicitly.

---

# 35. Future Agent Runtime Options

Do not commit to one runtime now.

Potential future candidates include:

```text
OpenAI Agents SDK
Mastra
custom thin orchestration
other TypeScript runtimes
```

The application should not need structural changes to adopt one.

Agent runtimes should consume the same core tool contracts used by the desktop UI.

---

# 36. UI Technology

Use:

```text
React
TypeScript
Vite
```

Keep UI dependencies moderate.

Do not introduce a giant component framework merely to accelerate the first screen.

A lightweight component set is acceptable.

Choose one coherent styling approach.

Examples:

```text
plain CSS modules
Tailwind
small headless component library
```

Avoid mixing multiple styling systems.

Functionality matters more than visual polish during initial implementation.

Still, the application should feel like a desktop product, not an admin dashboard.

---

# 37. State Management

Do not add Redux by default.

Prefer:

```text
React local state
context where appropriate
small query/cache abstraction if genuinely useful
```

Persistent application state belongs in files through main-process services.

Renderer state is not canonical.

Do not duplicate entire filesystem state into a giant frontend store.

---

# 38. IPC Design

Use explicit channels or a typed RPC-like wrapper.

Example namespaces:

```text
templates:list
templates:import
templates:load
templates:update-schema
templates:inspect

runs:create
runs:list
runs:load
runs:save-extraction
runs:save-review
runs:render
```

Prefer a preload API such as:

```ts
interface DocufillApi {
  templates: {
    list(): Promise<TemplateSummary[]>;
    import(): Promise<TemplateSummary | null>;
    load(id: string): Promise<Template>;
    saveSchema(id: string, schema: TemplateSchema): Promise<void>;
  };

  runs: {
    create(input: CreateRunInput): Promise<Run>;
    load(id: string): Promise<Run>;
    importExtraction(id: string, raw: string): Promise<ExtractionResult>;
    saveReview(id: string, review: ReviewedRecord): Promise<void>;
    render(id: string): Promise<RenderedArtifact>;
  };
}
```

Generate/share DTO schemas where useful.

---

# 39. File Dialogs

Use Electron-native file dialogs for:

```text
Import DOCX
Attach image
Attach PDF
Export DOCX
```

Do not give renderer arbitrary filesystem access.

The main process controls file access.

When importing a template, COPY the original DOCX into:

```text
~/.local/docufill/templates/<id>/template.docx
```

The application should not depend on the original source file continuing to exist.

---

# 40. Source Attachments

If the user chooses to preserve evidence for a run, copy it into:

```text
runs/<run-id>/input/
```

Do not modify the original file.

Avoid filename collisions.

Example:

```text
invoice.jpg
invoice-2.jpg
supporting.pdf
```

Preserve original names where practical.

Record attachment metadata in `metadata.json`.

---

# 41. Render Output

Generated documents belong in:

```text
runs/<run-id>/output/
```

Default name:

```text
result.docx
```

If rerendering, either:

```text
result.docx
```

may be atomically replaced, or versioned outputs may be created:

```text
result-001.docx
result-002.docx
```

Pick one simple policy for MVP and document it.

Prefer retaining previous outputs if implementation remains simple.

---

# 42. Testing Strategy

Tests are required for domain-critical functionality.

Use Node's built-in test runner or Vitest.

Choose one.

Tests must cover at minimum:

## Schema

```text
valid template config
invalid template config
unsupported schema version
```

## Prompt generation

Given a fixture template schema, generated prompt should be deterministic.

Use snapshot/golden tests where appropriate.

## Extraction parser

Test:

````text
plain JSON
JSON inside ```json fence
missing field
invalid type
not_found
ambiguous
malformed JSON
````

## Binding transforms

Test deterministic transforms.

## DOCX rendering

Have fixture `.docx` templates.

Verify generated documents contain expected replacements.

Where byte-for-byte comparison is inappropriate, inspect generated DOCX ZIP/XML content
semantically.

## Filesystem repository

Run against a temporary fake home.

Never touch the developer's real:

```text
~/.config/docufill
~/.local/docufill
```

during tests.

---

# 43. Fixture-driven Development

Create fixtures early.

At minimum:

```text
tests/fixtures/templates/simple/
tests/fixtures/templates/invoice/
tests/fixtures/extraction/
```

Create a tiny DOCX with placeholders such as:

```text
发票号码：{invoice_number}
日期：{invoice_date}
销售方：{seller_name}
金额：{total_amount}
```

Use it throughout integration tests.

---

# 44. Developer Experience

The project must be runnable with:

```bash
pnpm install
pnpm dev
```

Nothing else should be required for basic development.

Do not require:

```text
Docker
database server
Python
Java
.NET runtime
Rust toolchain
Go toolchain
LibreOffice
```

for MVP development.

A fresh machine with:

```text
Node 26
pnpm
```

should be sufficient.

---

# 45. Package Scripts

Root scripts should eventually support:

```json
{
  "scripts": {
    "dev": "...",
    "build": "...",
    "typecheck": "...",
    "lint": "...",
    "format": "...",
    "test": "...",
    "test:watch": "..."
  }
}
```

Do not create clever shell scripts for tasks pnpm can express clearly.

Keep Windows compatibility in mind for package scripts.

Avoid shell syntax that assumes Bash unless the script is explicitly a Node script.

---

# 46. Formatting / Linting

Use Biome unless a concrete incompatibility appears.

The project should have one command for checking:

```bash
pnpm lint
```

and one for formatting:

```bash
pnpm format
```

Do not waste significant initial effort building a huge lint rule set.

Priorities:

```text
correctness
types
tests
clarity
```

---

# 47. Dependencies

Keep production dependencies small.

Expected initial dependencies approximately include:

```text
react
react-dom
zod
yaml
docxtemplater
pizzip
```

Electron/build tooling:

```text
electron
vite
typescript
@types/node
@types/react
@types/react-dom
```

plus whatever minimal Electron/Vite integration is selected.

Use the latest compatible stable versions.

Do not pin to old package generations without a reason.

Avoid abandoned packages.

Before adding a dependency, ask:

```text
Can Node/Electron/React already do this adequately?
```

Do not reimplement mature DOCX ZIP/template behavior manually merely to reduce dependencies.

---

# 48. Coding Style

Prefer explicit straightforward TypeScript.

Avoid enterprise-style abstraction layers.

Avoid classes unless they genuinely improve the model.

Prefer:

```ts
type
interface
function
small service objects
```

over complicated inheritance.

Use domain names consistently.

Good:

```ts
TemplateSchema;
FieldDefinition;
ExtractionResult;
ReviewedRecord;
TemplateBinding;
```

Bad:

```ts
DataManager;
Processor;
Helper;
CommonService;
Utils2;
```

Do not create generic "utils" dumping grounds.

---

# 49. Comments

Comments should explain:

```text
why
constraints
non-obvious DOCX behavior
format compatibility
security assumptions
```

Do not comment obvious syntax.

Where a workaround exists because of:

```text
Electron behavior
DOCX XML behavior
TypeScript 7 behavior
```

document the reason.

---

# 50. README Requirements

README should include:

```text
What the project does
Current status
Prerequisites
Development
Build
Filesystem layout
MVP workflow
Architecture overview
Privacy/local-first behavior
```

Explicitly document:

```text
Configuration:
~/.config/docufill

Application data:
~/.local/docufill
```

Explicitly document that no SQL database is used.

---

# 51. Privacy Model

Default assumption:

```text
documents remain local
```

MVP should not upload anything automatically.

Generating a prompt is local.

Copying a prompt is local.

Importing AI JSON is local.

When direct AI integration is added later, the UI must make external transmission explicit.

Do not silently introduce telemetry.

Do not add analytics in MVP.

---

# 52. Initial Implementation Order

Implement in this order.

## Phase 1 — Skeleton

Create:

```text
pnpm workspace
Electron
React
Vite
TypeScript 7
Biome
test setup
```

Verify:

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

all work.

## Phase 2 — Filesystem foundation

Implement:

```text
getAppPaths()
directory initialization
atomic writes
template repository
run repository
schema validation
```

Add tests using temporary roots.

## Phase 3 — DOCX engine

Implement:

```text
DocumentRenderer
DocxtemplaterRenderer
placeholder inspection
DOCX rendering
```

Add fixture DOCX integration tests.

## Phase 4 — Template editor

Implement:

```text
import DOCX
detect placeholders
edit field semantics
save template.yaml
binding editor
```

## Phase 5 — Prompt workflow

Implement:

```text
prompt builder
prompt preview
copy prompt
expected output preview
```

## Phase 6 — Extraction import

Implement:

```text
paste JSON
Markdown fence stripping
Zod validation
error display
save extraction.json
```

## Phase 7 — Human review

Implement:

```text
field review UI
evidence display
edit values
validation
review.json
normalized.json
```

## Phase 8 — Rendering

Implement:

```text
binding resolution
transforms
DOCX rendering
output storage
open/show output
```

## Phase 9 — Run history

Implement:

```text
scan run directories
recent runs
open previous run
view extraction/review/output
```

Do not jump ahead to Agent integration before these are functional.

---

# 53. MVP Acceptance Test

The MVP is successful when this exact scenario works:

1. User launches the application.
2. User imports `invoice-template.docx`.
3. Application detects:

```text
invoice_number
invoice_date
seller_name
total_amount
```

4. User configures field meanings.
5. Application writes a readable `template.yaml`.
6. User starts a run.
7. User optionally attaches `invoice.jpg`.
8. Application generates a prompt.
9. User copies prompt.
10. User opens an external multimodal AI.
11. User sends prompt + `invoice.jpg`.
12. AI returns JSON.
13. User pastes JSON into Docufill.
14. Application validates it.
15. Application displays extracted values and evidence.
16. User corrects one field.
17. Original model value remains preserved.
18. Corrected value is persisted separately.
19. Application renders the DOCX deterministically.
20. User opens the result.
21. Closing and reopening the application preserves all template/run information using ordinary
    files only.

No database may be required for this test.

---

# 54. Architecture Invariants

These are more important than implementation details.

Never violate them casually.

```text
1. Filesystem is canonical storage.

2. No SQL database.

3. ~/.config/docufill stores configuration.

4. ~/.local/docufill stores user data.

5. AI produces structured data, not Word files.

6. Original AI output is preserved.

7. Human-reviewed values are separate.

8. DOCX rendering is deterministic.

9. Business fields are separate from DOCX placeholders.

10. Domain logic is independent of Electron UI.

11. Agent runtimes do not own business logic.

12. Core operations are naturally tool-shaped.

13. Renderer has no unrestricted filesystem/Node access.

14. Persisted structures are versioned.

15. A run should be inspectable by opening its directory in a file manager/text editor.
```

---

# 55. Decisions the Agent May Make Independently

The coding agent may choose reasonable implementations for:

```text
component library
CSS approach
test runner
Electron/Vite integration package
exact IPC helper structure
ULID implementation
small UI details
error presentation
```

provided they obey all architecture constraints above.

Do not stop to ask for approval over trivial implementation choices.

Prefer making a sensible decision, implementing it cleanly, and documenting it.

---

# 56. Decisions Requiring Explicit Approval

Do NOT independently introduce:

```text
database
cloud backend
authentication
telemetry
direct AI provider dependency
agent runtime
MCP runtime
Rust sidecar
Go service
Python process
LibreOffice dependency
new persistence root
Windows AppData storage
macOS Application Support storage
```

These require explicit product decisions.

---

# 57. First Task

Start implementation now.

The first development goal is:

```text
A runnable Electron + React + TypeScript 7 application
with the filesystem foundation and one end-to-end
DOCX placeholder replacement fixture.
```

Proceed as follows:

```text
1. Initialize pnpm workspace.
2. Create Electron desktop application.
3. Configure TypeScript 7.
4. Configure Biome.
5. Configure tests.
6. Implement ~/.config/docufill and ~/.local/docufill path resolution.
7. Implement filesystem directory initialization.
8. Define initial Zod domain schemas.
9. Add Docxtemplater + PizZip.
10. Create a fixture DOCX.
11. Implement placeholder inspection.
12. Implement deterministic replacement.
13. Add automated integration test.
14. Build minimal UI to import a DOCX and display detected placeholders.
15. Run typecheck/tests/build and fix all failures.
16. Update README with actual working commands and architecture.
```

Do not begin Agent integration.

Do not add a database.

Do not add speculative infrastructure.

Get this vertical slice working first:

```text
DOCX
 ↓
placeholder inspection
 ↓
field display
 ↓
structured values
 ↓
DOCX render
```

Once that works cleanly, continue toward the complete MVP workflow described above.

---

# 58. Completion Discipline

After each meaningful implementation stage:

1. Run type checking.
2. Run tests.
3. Run formatting/lint checks.
4. Build the application when relevant.
5. Fix actual failures before moving on.
6. Keep README synchronized with reality.

Do not claim functionality exists unless it is implemented and tested.

Do not leave critical paths as placeholder TODOs while moving to later phases.

Favor a small working vertical slice over many unfinished abstractions.

The immediate priority is a functional local-first desktop product, not a framework.
