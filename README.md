# FillForge

FillForge is a local-first desktop application for configuring DOCX templates, importing structured
values produced by an external AI tool, reviewing those values, and rendering deterministic
Microsoft Word documents.

The MVP intentionally uses a manual AI handoff: FillForge generates the prompt and expected JSON,
the user runs them with a multimodal model of choice, and the user pastes the JSON back into the
application. No model provider is called by the application.

[SPEC.md](SPEC.md) is the normative project specification. The detailed
[User Guide](docs/USER_GUIDE.md) covers Word template authoring, template.yaml configuration,
extraction JSON, review, rendering, and troubleshooting. This README covers the shortest path from
checkout to a working development environment.

## Status

The MVP vertical slice is implemented and tested:

- Electron 44 desktop app with React, Vite, TypeScript, sandboxed preload, and typed IPC.
- DOCX import and placeholder inspection that handles Word XML run boundaries.
- YAML-backed template definitions for fields, extraction instructions, validation, normalization,
  and bindings.
- Deterministic extraction prompts and expected JSON previews.
- Fenced or plain JSON import with schema and semantic validation.
- Review records that preserve model values separately from human final values.
- Versioned, filesystem-backed run artifacts and DOCX outputs.
- CLI commands that reuse the desktop application services.
- Settings for theme, advanced editor fields, and prompt version.
- English user documentation available from the Help menu and GitHub.
- A complete end-to-end example template (DOCX + YAML + sample extraction JSON) under
  [examples/](examples/README.md), exercised by the integration tests.

## MVP workflow

```text
DOCX template
    ↓
Inspect placeholders and configure business fields
    ↓
Generate prompt and expected JSON
    ↓
Run the prompt with an external AI tool
    ↓
Paste and validate the returned JSON
    ↓
Review, correct, or fill values
    ↓
Normalize, bind, and render DOCX
```

A run keeps the prompt, original extraction, review, normalized record, copied source evidence, and
all generated outputs so the operation can be inspected or resumed later.

## Prerequisites

- Node.js 26.x or later; Node 26 is the project baseline.
- pnpm.
- No database, Docker service, Python runtime, Java runtime, or LibreOffice installation is needed
  for MVP development.

The repository uses pnpm exclusively and must retain pnpm-lock.yaml.

## Development

```bash
pnpm install
pnpm dev
```

The root quality commands are:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format
pnpm format:check
pnpm test
pnpm test:watch
```

Before submitting a change that affects application behavior, run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

## Examples

[examples/invoice/](examples/invoice/README.md) ships a ready-made Word template together with its
`template.yaml`, a simulated source document, and a sample extraction JSON. It mirrors the User
Guide walkthrough, is validated by `tests/integration/examples.test.ts` on every test run, and can
be imported directly to try the full workflow:

```bash
pnpm fixtures  # regenerate the example DOCX (and test fixtures) after editing examples/make-example.ts
```

## CLI

The CLI uses the same services as the desktop app:

```bash
pnpm tsx packages/tools/src/index.ts inspect-template <templateId>
pnpm tsx packages/tools/src/index.ts extract-fields <templateId>
pnpm tsx packages/tools/src/index.ts validate-fields <templateId> <extraction.json>
pnpm tsx packages/tools/src/index.ts render-document <runId>
```

Set FILLFORGE_HOME to an isolated logical home root for tests or portable runs:

```bash
FILLFORGE_HOME=/tmp/fillforge-test pnpm test
```

## Filesystem storage

FillForge has no SQL or embedded database. The filesystem is the canonical source of truth and every
domain artifact is an ordinary inspectable file.

```text
<home>/.config/fillforge/config.yaml

<home>/.local/fillforge/
├── templates/<template-id>/
│   ├── template.docx
│   └── template.yaml
├── runs/<run-ulid>/
│   ├── metadata.json
│   ├── input/
│   ├── prompt.md
│   ├── extraction.json
│   ├── review.json
│   ├── normalized.json
│   └── output/
│       ├── result-001.docx
│       └── result.docx
├── exports/
├── cache/
└── logs/
```

Configuration is stored under .config/fillforge. Application data is stored under .local/fillforge.
FILLFORGE_HOME changes the home root while preserving this layout. Templates and source evidence are
copied into application-owned directories; original files are not modified.

Prompt and extraction artifacts are immutable. Human corrections live in review.json, and
normalized.json is rebuilt when review data changes. Each render retains a versioned result and
updates result.docx to mirror the newest result.

## Architecture

```text
apps/desktop
├── electron/       main process, preload, dialogs, and typed IPC
└── src/            React renderer

packages/
├── schema/         Zod contracts and domain types
├── core/           paths, atomic writes, config, IDs, and errors
├── docx/           renderer boundary and Docxtemplater adapter
├── templates/      template repository, inspection, and bindings
├── extraction/     prompt, parser, validation, and normalization
├── runs/           run artifacts, review, and render orchestration
└── tools/          CLI commands over the same services
```

The renderer has no unrestricted Node.js or filesystem access. The main process validates IPC
payloads before invoking application services. DOCX rendering is deterministic and Docxtemplater is
isolated behind the DocumentRenderer interface.

## Scope boundaries

The MVP does not include direct model-provider APIs, OCR, embeddings, RAG, cloud storage, accounts,
authentication, telemetry, analytics, collaboration, sync, agent runtimes, MCP servers, browser
automation, automatic uploads, or automatic email sending.

Future integrations must use the existing typed service boundaries and preserve the filesystem,
review, validation, and rendering invariants defined in [SPEC.md](SPEC.md).

## Documentation

The desktop application's Help menu provides:

- [User Guide](https://github.com/lihaozhe013/FillForge/blob/main/docs/USER_GUIDE.md)
- [Project Specification](https://github.com/lihaozhe013/FillForge/blob/main/SPEC.md)
- [FillForge on GitHub](https://github.com/lihaozhe013/FillForge)

The User Guide is also available locally at [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Privacy

- Documents, prompts, extraction results, and rendered files stay local by default.
- FillForge does not upload source evidence or call model APIs automatically.
- Logs must not contain complete documents, image/PDF contents, credentials, or API keys.
- Any future external transmission must be explicit in the UI and have an approved secret-storage
  design.

## License

[MIT](LICENSE)
