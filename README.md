# FillForge

Local-first desktop application for configuring, filling, reviewing, and rendering Microsoft Word
`.docx` templates.

## What the project does

FillForge sits between AI extraction and deterministic document rendering:

```text
DOCX template
    ↓ discover placeholders
configure semantic field definitions
    ↓ generate an AI extraction prompt
user gives the prompt + source documents/images to an AI
    ↓ AI returns structured JSON
user pastes the JSON into FillForge
    ↓ validate + review + correct
deterministically render DOCX
```

The first version deliberately has no integrated AI agent. It is useful today with ChatGPT, Claude,
Gemini, or any other multimodal model: copy the generated prompt, attach your document, paste the
JSON back. The architecture keeps the extraction interface and tool contracts ready for future
direct model APIs, agent runtimes, and MCP exposure without rewriting the domain model.

## Current status

MVP vertical slice implemented and tested:

- Electron 44 desktop app (React + Vite renderer, sandboxed preload, typed IPC)
- DOCX import, placeholder discovery (safe across XML run boundaries)
- Semantic field configuration persisted as human-readable `template.yaml`
- Deterministic extraction-prompt generation (`fillforge-extraction-v1`)
- AI result import with Markdown-fence tolerance and Zod validation
- Review step that preserves the original model output separately from human-corrected values
- Binding transforms (date parts, case, trim, Chinese currency uppercase)
- Deterministic DOCX rendering via Docxtemplater + PizZip
- Complete run history stored as plain files

## Prerequisites

- Node.js 26.x
- pnpm (only; the repo must not contain npm/yarn/bun lockfiles)

## Development

```bash
pnpm install
pnpm dev        # start the Electron desktop app with hot reload
```

Other commands:

```bash
pnpm build        # build all workspace packages and the desktop app
pnpm typecheck    # TypeScript 7, strict mode, across every package
pnpm format       # Prettier (the source of truth for code style)
pnpm format:check # Prettier check, e.g. before committing
pnpm lint         # Biome lint rules (formatting is handled by Prettier)
pnpm test         # Vitest unit + integration tests
```

CLI utilities run outside Electron with the external Node 26 runtime:

```bash
pnpm tsx packages/tools/src/index.ts inspect-template <templateId>
pnpm tsx packages/tools/src/index.ts extract-fields <templateId>
pnpm tsx packages/tools/src/index.ts validate-fields <templateId> <extraction.json>
pnpm tsx packages/tools/src/index.ts render-document <runId>
```

Set `FILLFORGE_HOME` to redirect the entire data root (used by tests):

```bash
FILLFORGE_HOME=/tmp/fillforge-test pnpm test
```

## Filesystem layout

There is **no SQL database** — the filesystem is the only source of truth, and every artifact is an
ordinary inspectable file.

```text
~/.config/fillforge/config.yaml      # application configuration

~/.local/fillforge/templates/<id>/   # one directory per template
├── template.docx                   # copied on import, never modified
├── template.yaml                   # field definitions + bindings
└── README.md                       # optional human notes

~/.local/fillforge/runs/<ulid>/      # one self-contained directory per run
├── metadata.json                   # schema-versioned run metadata
├── input/                          # source evidence (images/PDFs), untouched
├── prompt.md                       # generated extraction prompt (immutable)
├── extraction.json                 # original AI output (immutable)
├── review.json                     # human decisions: accepted/corrected/…
├── normalized.json                 # normalized business record
└── output/
    ├── result-001.docx             # every render is versioned and retained
    ├── result-002.docx
    └── result.docx                 # always mirrors the newest render

~/.local/fillforge/exports/          # default export target
~/.local/fillforge/cache/            # disposable caches only, never canonical
~/.local/fillforge/logs/             # release-build logs
```

The same logical paths are used on Linux, macOS, and Windows — no OS-specific AppData/Application
Support indirection. `FILLFORGE_HOME` overrides the home directory for tests and portable use.

## MVP workflow

1. Import a DOCX template; placeholders are detected (Docxtemplater handles text split across XML
   runs).
2. Configure field meanings, types, extraction rules, validation, and normalization; the app writes
   readable `template.yaml`.
3. Create a run and optionally attach source evidence (copied into `input/`).
4. Copy the generated prompt and expected JSON shape.
5. Give prompt + documents to any AI; paste the JSON back.
6. Review: values, status, evidence; edit or fill values by hand. The model output stays untouched
   in `extraction.json`; corrections go to `review.json`.
7. Normalize and render. Output DOCX files are versioned under `output/`.
8. Reopen any run later; everything is still there as plain files.

## Architecture overview

```text
apps/desktop            Electron 44 app
├── electron/           main process, sandboxed preload, typed IPC handlers
└── src/                React + Vite renderer (no Node access)

packages/
├── schema/             Zod domain schemas (template, field, extraction, run)
├── core/               paths, atomic writes, filesystem helpers, ids, errors
├── docx/               DocumentRenderer boundary + Docxtemplater implementation
├── templates/          template repository, service, bindings, transforms
├── extraction/         prompt builder, result parser, validator, normalizer
├── runs/               run repository, review workflow, render service
└── tools/              CLI wrapping the same services used by the UI
```

Key invariants:

- The renderer process never gets unrestricted Node/filesystem access; all operations go through
  typed IPC validated with Zod in the main process.
- Persisted YAML/JSON files are schema-versioned and validated on load.
- Docxtemplater is an implementation detail behind the `DocumentRenderer` interface, so future
  engines can be swapped in.
- Business fields are decoupled from DOCX placeholders through a binding and transform registry.
- Mutations of mutable files are atomic (write temp → fsync → rename).
- Core operations (list templates, generate prompt, render document, …) are plain service calls
  shaped like tools, ready for future CLI/MCP/agent reuse without owning business logic.

## Privacy / local-first behavior

- Documents stay local: generating a prompt, copying it, and importing AI JSON are all local
  operations.
- Nothing is uploaded automatically; there is no telemetry and no analytics.
- The MVP never contacts model APIs. When direct integration is added later, external transmission
  will be explicit in the UI.
- Do not log full documents, images, PDFs, or credentials. Debug builds write summaries into
  `debug-logs/` (release builds into the per-user data directory).
