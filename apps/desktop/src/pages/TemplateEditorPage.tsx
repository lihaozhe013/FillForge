import type { FieldDefinition, PlaceholderReport, TemplateSchema } from "@docufill/schema";
import { useEffect, useMemo, useState } from "react";
import type { Navigate } from "../App";
import { ErrorBanner, Section } from "../components/ui";
import { copyToClipboard, extractError, useAsyncData } from "../hooks/useAsyncData";

const FIELD_TYPES = ["string", "number", "date", "boolean"] as const;
const TRANSFORMS = [
  "",
  "identity",
  "date_year",
  "date_month",
  "date_day",
  "trim",
  "uppercase",
  "lowercase",
  "chinese_currency_uppercase",
] as const;

export function TemplateEditorPage({
  templateId,
  navigate,
}: {
  templateId: string;
  navigate: Navigate;
}) {
  const loaded = useAsyncData(() => window.docufill.templates.load(templateId), [templateId]);
  const inspection = useAsyncData(
    () => window.docufill.templates.inspect(templateId),
    [templateId],
  );
  const preview = useAsyncData(
    () => window.docufill.templates.promptPreview(templateId),
    [templateId],
  );

  const [draft, setDraft] = useState<TemplateSchema | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data) {
      setDraft(structuredClone(loaded.data));
    }
  }, [loaded.data]);

  const report: PlaceholderReport | null = inspection.data ?? null;

  const allPlaceholderKeys = useMemo(() => {
    const keys = new Set<string>(report?.placeholders ?? []);
    for (const key of Object.keys(draft?.bindings ?? {})) {
      keys.add(key);
    }
    return [...keys].sort();
  }, [report, draft]);

  if (loaded.error) {
    return (
      <div className="page">
        <ErrorBanner error={loaded.error} />
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="page">
        <p className="empty-hint">Loading template…</p>
      </div>
    );
  }

  function updateField(key: string, patch: Partial<FieldDefinition>) {
    if (!draft) return;
    const current = draft.fields[key];
    if (!current) return;
    setSaved(false);
    setDraft({
      ...draft,
      fields: {
        ...draft.fields,
        [key]: { ...current, ...patch },
      },
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await window.docufill.templates.saveSchema(draft.id, draft);
      setSaved(true);
      inspection.reload();
      preview.reload();
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{draft.name}</h1>
        <div className="page-actions">
          <button onClick={() => navigate({ page: "newRun", templateId: draft.id })}>
            New run
          </button>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </header>

      <ErrorBanner error={error ?? inspection.error} />

      <Section title="General">
        <div className="form-grid">
          <label>
            Id
            <input value={draft.id} disabled />
          </label>
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => {
                setSaved(false);
                setDraft({ ...draft, name: event.target.value });
              }}
            />
          </label>
          <label>
            Description
            <input
              value={draft.description ?? ""}
              onChange={(event) => {
                setSaved(false);
                setDraft({
                  ...draft,
                  ...(event.target.value === ""
                    ? { description: undefined }
                    : { description: event.target.value }),
                });
              }}
            />
          </label>
          <label>
            Document
            <input value={draft.document.file} disabled />
          </label>
        </div>
      </Section>

      <Section
        title="DOCX placeholders"
        actions={
          <button
            className="link"
            onClick={() => {
              inspection.reload();
            }}
          >
            re-inspect
          </button>
        }
      >
        {report && (
          <div className="report">
            <div>
              Detected: <code>{report.placeholders.join(", ") || "none"}</code>
            </div>
            {report.unconfigured.length > 0 && (
              <div className="warn-text">
                Not bound yet: <code>{report.unconfigured.join(", ")}</code>
              </div>
            )}
            {report.unreferenced.length > 0 && (
              <div className="warn-text">
                Configured but unreferenced: <code>{report.unreferenced.join(", ")}</code>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title={`Fields (${Object.keys(draft.fields).length})`}>
        <div className="field-list">
          {Object.entries(draft.fields).map(([key, field]) => (
            <div className="field-card" key={key}>
              <div className="field-card-header">
                <code>{key}</code>
                <button
                  className="link danger"
                  onClick={() => {
                    setSaved(false);
                    const fields = { ...draft.fields };
                    delete fields[key];
                    setDraft({ ...draft, fields });
                  }}
                >
                  remove field
                </button>
              </div>
              <div className="form-grid">
                <label>
                  Display name (label)
                  <input
                    value={field.label}
                    onChange={(event) => updateField(key, { label: event.target.value })}
                  />
                </label>
                <label>
                  Meaning (description)
                  <input
                    value={field.description ?? ""}
                    onChange={(event) =>
                      updateField(key, {
                        description: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label>
                  Type
                  <select
                    value={field.type}
                    onChange={(event) =>
                      updateField(key, { type: event.target.value as FieldDefinition["type"] })
                    }
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) => updateField(key, { required: event.target.checked })}
                  />
                  Required
                </label>
                <label className="span-2">
                  AI extraction instruction
                  <textarea
                    rows={2}
                    value={field.extraction?.instruction ?? ""}
                    onChange={(event) =>
                      updateField(key, {
                        extraction:
                          event.target.value === ""
                            ? undefined
                            : { instruction: event.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Validation regex
                  <input
                    value={field.validation?.regex ?? ""}
                    placeholder="^[0-9A-Za-z-]+$"
                    onChange={(event) =>
                      updateField(key, {
                        validation:
                          event.target.value === "" ? undefined : { regex: event.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Output date format
                  <input
                    value={field.output?.format ?? ""}
                    placeholder="YYYY-MM-DD"
                    disabled={field.type !== "date"}
                    onChange={(event) =>
                      updateField(key, {
                        output:
                          event.target.value === "" ? undefined : { format: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={field.normalization?.trim ?? false}
                    onChange={(event) =>
                      updateField(key, {
                        normalization: { ...field.normalization, trim: event.target.checked },
                      })
                    }
                  />
                  Normalize: trim
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={field.normalization?.remove_spaces ?? false}
                    onChange={(event) =>
                      updateField(key, {
                        normalization: {
                          ...field.normalization,
                          remove_spaces: event.target.checked,
                        },
                      })
                    }
                  />
                  Normalize: remove spaces
                </label>
              </div>
            </div>
          ))}
        </div>
        <AddFieldRow
          onAdd={(key) => {
            setSaved(false);
            setDraft({
              ...draft,
              fields: {
                ...draft.fields,
                [key]: { label: key, type: "string", required: true },
              },
            });
          }}
        />
      </Section>

      <Section title="Bindings (DOCX placeholder ← business field)">
        <table className="table">
          <thead>
            <tr>
              <th>DOCX placeholder</th>
              <th>Source field</th>
              <th>Transform</th>
            </tr>
          </thead>
          <tbody>
            {allPlaceholderKeys.map((placeholder) => {
              const binding = draft.bindings?.[placeholder];
              return (
                <tr key={placeholder}>
                  <td>
                    <code>{placeholder}</code>
                  </td>
                  <td>
                    <select
                      value={binding?.source ?? ""}
                      onChange={(event) => {
                        setSaved(false);
                        const source = event.target.value;
                        const bindings = { ...(draft.bindings ?? {}) };
                        if (source === "") {
                          delete bindings[placeholder];
                        } else {
                          bindings[placeholder] = {
                            source,
                            ...(binding?.transform ? { transform: binding.transform } : {}),
                          };
                        }
                        setDraft({ ...draft, bindings });
                      }}
                    >
                      <option value="">— not bound —</option>
                      {Object.keys(draft.fields).map((fieldKey) => (
                        <option key={fieldKey} value={fieldKey}>
                          {fieldKey}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={binding?.transform ?? ""}
                      disabled={!binding}
                      onChange={(event) => {
                        if (!draft || !binding) return;
                        setSaved(false);
                        const transform = event.target.value;
                        const bindings = { ...(draft.bindings ?? {}) };
                        bindings[placeholder] =
                          transform === ""
                            ? { source: binding.source }
                            : { source: binding.source, transform };
                        setDraft({ ...draft, bindings });
                      }}
                    >
                      {TRANSFORMS.map((transform) => (
                        <option key={transform} value={transform}>
                          {transform === "" ? "(none)" : transform}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section
        title="Prompt preview"
        actions={
          preview.data && (
            <button
              className="link"
              onClick={() => void copyToClipboard(preview.data?.prompt ?? "")}
            >
              copy prompt
            </button>
          )
        }
      >
        {preview.loading && <p className="empty-hint">Loading…</p>}
        {preview.data ? (
          <pre className="prompt-preview">{preview.data.prompt}</pre>
        ) : (
          !preview.loading && (
            <p className="empty-hint">
              Configure at least one field to generate the extraction prompt.
            </p>
          )
        )}
      </Section>
    </div>
  );
}

function AddFieldRow({ onAdd }: { onAdd: (key: string) => void }) {
  const [key, setKey] = useState("");
  const valid = /^[a-z0-9_]+$/.test(key);
  return (
    <div className="add-field-row">
      <input
        placeholder="new_field_key (snake_case)"
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <button
        disabled={!valid}
        onClick={() => {
          onAdd(key);
          setKey("");
        }}
      >
        Add field
      </button>
      {!valid && key.length > 0 && (
        <span className="muted">Use lowercase letters, digits, and _</span>
      )}
    </div>
  );
}
