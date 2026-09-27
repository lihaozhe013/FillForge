# FillForge

FillForge is a local-first desktop application for filling DOCX templates from source documents.
Choose a template and source files, extract values with a configured AI connection, review the values,
and create a formatted Word document in one guided run.

The desktop app uses Tauri 2 with a React/Vite interface and a Rust backend. Tauri uses the operating
system WebView on Windows and macOS; the packaged application does not include Node.js or Chromium.
The Rust domain services are shared by the desktop app and the CLI. See [SPEC.md](SPEC.md) for the
product contract and [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for template authoring and app usage.

## Current capabilities

- Import DOCX templates and discover single-brace placeholders, including placeholders split across
  Word runs and located in the document body, headers, or footers.
- Configure fields, extraction instructions, validation, normalization, and placeholder bindings in
  YAML.
- Extract source documents through a configurable Responses or Chat Completions AI connection, or
  use the advanced prompt and JSON import workflow with an external AI tool.
- Import and validate extracted JSON, review or correct the values, and render formatted DOCX files.
- Keep source files, prompts, extraction results, reviews, and versioned output files in inspectable
  local storage. Clearing run history preserves all generated DOCX files.
- Store AI API keys in the operating system credential store and connection metadata in a versioned
  configuration file.
- Use the same Rust business services through the desktop UI or the four CLI commands.

## Development requirements

- Node.js 26.x or later and pnpm for the React/Vite build.
- Rust stable for the desktop backend and CLI.
- Tauri's native platform prerequisites for local desktop packaging. Windows uses WebView2; macOS
  uses WKWebView.

Node.js is a build-time requirement. It is not needed to run an installed FillForge application.

```bash
pnpm install
pnpm dev
```

Useful build and verification commands:

```bash
pnpm typecheck
cargo check --workspace
pnpm build:win:x64       # Windows x64 NSIS installer
pnpm build:mac:arm64     # macOS ARM DMG
```

The GitHub workflow builds both installers and uploads them as workflow artifacts. A push to the
`publish` branch also updates the `nightly` prerelease; a manual workflow run only creates artifacts.

When moving from the old Electron installer to the Tauri installer on Windows, uninstall the
Electron version before installing the Tauri version.

## CLI

The CLI is a Rust binary and uses the same storage and application services as the desktop app:

```bash
cargo run -p fillforge-cli -- --help
cargo run -p fillforge-cli -- inspect-template <templateId>
cargo run -p fillforge-cli -- extract-fields <templateId>
cargo run -p fillforge-cli -- validate-fields <templateId> <extraction.json>
cargo run -p fillforge-cli -- render-document <runId>
```

Regenerate the TypeScript contract from the Rust domain types with:

```bash
pnpm types:generate
```

Set `FILLFORGE_HOME` to use a separate home root:

```bash
FILLFORGE_HOME=/tmp/fillforge-demo cargo run -p fillforge-cli -- inspect-template invoice
```

## Local storage

The filesystem is the canonical source of truth. The existing Electron data layout and schema version
remain unchanged, so Tauri opens existing templates and runs in place without a bulk migration.

```text
<home>/.config/fillforge/config.yaml
<home>/.config/fillforge/ai-connections.json

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
│   └── preserved-runs/<run-ulid>/
│       ├── result-001.docx
│       └── result.docx
├── cache/
└── logs/
```

AI API keys are held in the operating system credential store; they are not written to either
configuration file.

`FILLFORGE_HOME` changes the home root while preserving this layout. Templates and source evidence are
copied into application-owned directories; original files are not modified. Prompt and extraction
artifacts are immutable. Human corrections live in `review.json`, and `normalized.json` is rebuilt
when review data changes. Each render retains a numbered result and updates `result.docx` to mirror
the newest output.

Development builds write the summary log to `debug-logs/debug.log` and feature logs to
`debug-logs/debug-{feature}.log`. Packaged builds write logs under the data directory's `logs/`.
Each log rotates at 2 MiB and retains one previous session.

## Repository layout

```text
apps/desktop/                 React/Vite interface and Tauri configuration
apps/desktop/src-tauri/       Tauri commands, native menus, dialogs, and logging
crates/fillforge-domain/      Shared Rust models, persistence, templates, extraction, and runs
crates/fillforge-docx/        Rust DOCX inspection and rendering adapter
crates/fillforge-cli/         CLI and TypeScript contract generator
examples/                     Invoice template and sample extraction data
```

The DOCX engine is `xamgore/docx-template`, pinned to a Git revision in Cargo. Its rendering adapter
checks placeholders before rendering and preserves the original document package and formatting.
Values, including booleans, are rendered as text. Unsupported template tags are reported and block
rendering.

## Documentation

- [User Guide](docs/USER_GUIDE.md)
- [AI Agent Prompt](docs/AI_AGENT_PROMPT.md)
- [Project Specification](SPEC.md)
- [Invoice example](examples/README.md)

## Privacy and scope

Documents, prompts, extraction results, and rendered files stay local until the user chooses
**Extract with AI**. At that point, FillForge sends only the selected source files and generated
extraction prompt to the configured AI provider. Logs must not contain complete documents, image or
PDF contents, credentials, or API keys. Clearing local run history does not remove data retained by
an external AI provider.

The MVP does not include OCR, embeddings, RAG, cloud storage, accounts, authentication, telemetry,
analytics, collaboration, sync, agent runtimes, MCP servers, browser automation, automatic uploads,
or automatic email sending.

## License

[MIT](LICENSE)
