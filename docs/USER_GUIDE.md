# FillForge User Guide

This guide explains how to create a Word template that FillForge can inspect and render, how to
write the matching template.yaml configuration, and how to complete an extraction-to-DOCX run.

[Open this guide on GitHub](https://github.com/lihaozhe013/FillForge/blob/main/docs/USER_GUIDE.md)

For the normative architecture, persistence, security, and acceptance requirements, see the
[project specification](../SPEC.md).

## 1. What FillForge does

FillForge guides one document from source files to a finished Word file:

```text
Word template + field configuration
                ↓
        selected source files
                ↓
   extract and review values
                ↓
       generated DOCX output
```

FillForge can call a configured AI connection after you choose **Extract with AI**. Only the
selected source files and extraction prompt are sent to that provider. You can also use the Advanced
prompt and JSON tools to complete extraction with an external AI tool yourself.

A FillForge template has three separate concepts:

| Concept          | Meaning                                              | Example                                        |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------- |
| Business field   | A value with meaning, type, and validation rules     | invoice_date                                   |
| DOCX placeholder | A named position in the Word document                | {invoice_year}                                 |
| Binding          | The rule that maps a business field to a placeholder | invoice_year from invoice_date using date_year |

Keeping these concepts separate lets one extracted value populate several document positions. For
example, one invoice_date field can provide the year, month, and day placeholders.

## 2. First launch and storage

Start the desktop application with:

```bash
pnpm install
pnpm dev
```

Development requires Node.js 26 or later, pnpm, and Rust stable. An installed FillForge app uses the
system WebView and does not require Node.js. On Windows, uninstall the earlier Electron version
before installing the Tauri version.

FillForge stores canonical data in ordinary files:

```text
<home>/.config/fillforge/config.yaml
<home>/.config/fillforge/ai-connections.json
Operating system credential store (AI API keys)
<home>/.local/fillforge/templates/
<home>/.local/fillforge/runs/
<home>/.local/fillforge/exports/
<home>/.local/fillforge/cache/
<home>/.local/fillforge/logs/
```

The application does not use a database. Imported templates and source evidence are copied into
FillForge-owned directories; the original files are not modified. Connection metadata is stored in a
versioned JSON file. API keys are stored in the operating system credential store and are never
written to that JSON file. FillForge reports an error if secure key storage is unavailable.

For an isolated workspace, set FILLFORGE_HOME. It changes the logical home root
while preserving the .config/fillforge and .local/fillforge layout:

```bash
FILLFORGE_HOME=/tmp/fillforge-demo pnpm dev
```

## 3. Prepare the Word document

### 3.1 Create a DOCX template

Use Microsoft Word to create a normal document. You can use paragraphs, headings, tables, and
ordinary Word formatting. Put a stable placeholder wherever FillForge should insert a value.

A simple invoice document might look like this:

```text
INVOICE

Invoice number: {invoice_number}
Invoice date: {invoice_year}-{invoice_month}-{invoice_day}

Seller: {seller_name}
Buyer: {buyer_name}

Total amount: {total_amount}
Amount in words: {total_amount_uppercase}
```

Save the document as a DOCX file, for example invoice-template.docx. FillForge copies this file when
you import it, so you can move or delete the original after import.

A ready-made copy of this example document, its configuration, and a source image ships in the
repository under [examples/invoice](../examples/README.md).

### 3.2 Placeholder rules

Use plain single-brace FillForge placeholders:

```text
{invoice_number}
{seller_name}
{total_amount}
```

Follow these rules:

| Rule                              | Correct          | Avoid                      |
| --------------------------------- | ---------------- | -------------------------- |
| Use stable machine keys           | {invoice_number} | {Invoice Number}           |
| Prefer lowercase snake_case       | {buyer_name}     | {买方名称}                 |
| Use one pair of braces            | {total_amount}   | <<total_amount>>           |
| Keep the key inside the braces    | {invoice_date}   | { invoice_date }           |
| Keep labels out of the key        | {seller_name}    | {sellerNameLabel}          |
| Use the same key in configuration | invoice_date     | a translated display label |

The key is an internal identifier. The human-facing label belongs in template.yaml. Changing a label
should not require changing the Word placeholder unless the binding itself changes.

Do not use placeholders with spaces, punctuation, or localized display text. Template IDs and field
keys are easier to maintain when they are stable ASCII identifiers.

### 3.3 Formatting placeholders in Word

A placeholder may be bold, italic, colored, or placed in a table cell. The Rust DOCX renderer
replaces the placeholder text while retaining the surrounding document formatting. It inspects the
body, headers, and footers, and recognizes placeholders split across Word runs.

For predictable results:

1. Type a complete placeholder such as {invoice_number}.
2. Apply the desired formatting after the placeholder exists.
3. Do not insert Word content controls, mail-merge fields, or custom field codes in place of the
   plain placeholder.
4. Do not use loops, conditions, filters, or other unsupported template tags in the MVP.
5. Put a placeholder in the exact location where the final text should appear.
6. Use a table when labels and values need aligned columns.
7. Test long values, multi-line values, and empty optional values in a sample run.

FillForge uses a DOCX-aware inspector that can recognize text split across Word XML runs. However,
typing the complete placeholder in one operation and formatting it consistently makes a template
easier to inspect and maintain.

For example, this is a good table layout:

```text
Field                 Value
Invoice number        {invoice_number}
Seller                {seller_name}
Total                 {total_amount}
```

The Word document contains the layout and presentation. The YAML configuration contains meaning,
extraction rules, validation, normalization, and mapping. Do not put business rules into the
placeholder text.

### 3.4 Import the Word document

In the desktop application:

1. Open Templates.
2. Choose Import DOCX.
3. Select invoice-template.docx.
4. FillForge checks the document and creates a same-named field and binding for each supported
   placeholder.
5. The imported template opens automatically. Review the fields and set any values that should be
   numeric, dates, or required.

The imported copy is stored at:

```text
<home>/.local/fillforge/templates/<template-id>/template.docx
```

The associated configuration is stored beside it as template.yaml.

## 4. Write template.yaml

### 4.1 Where the file lives

Each template has its own directory:

```text
<home>/.local/fillforge/templates/<template-id>/
├── template.docx
└── template.yaml
```

The Template Editor writes template.yaml for you. Manual editing is also supported for advanced
configuration, version control, or sharing a template with another user.

After a manual edit, reload or reopen the template so FillForge can validate the file.

YAML is indentation-sensitive:

- Use spaces, not tabs.
- Keep child properties indented consistently.
- Put quotes around regular expressions and strings containing YAML punctuation.
- Keep field keys and binding keys unique.
- Do not add JavaScript expressions or executable code.

### 4.2 Complete invoice example

The following configuration matches the Word example above. The files are checked in under
[examples/invoice](../examples/README.md), so you can import the DOCX and apply this configuration.
Importing `invoice-template.docx` generates the template ID `invoice-template` from its filename.

```yaml
schema_version: 1

id: invoice-template
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
    description: The date printed as the invoice date
    type: date
    required: true
    extraction:
      instruction: Extract the date labelled Invoice date.
    output:
      format: YYYY-MM-DD
    validation:
      date_format: YYYY-MM-DD

  seller_name:
    label: Seller name
    description: The legal or display name of the seller
    type: string
    required: true
    extraction:
      instruction: Extract the seller name, not the buyer name.
    normalization:
      trim: true

  buyer_name:
    label: Buyer name
    description: The legal or display name of the buyer
    type: string
    required: true
    extraction:
      instruction: Extract the buyer name, not the seller name.
    normalization:
      trim: true

  total_amount:
    label: Total amount
    description: The final amount including tax
    type: number
    required: true
    extraction:
      instruction: Extract the final total amount, not the tax amount or pre-tax amount.
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

  seller_name:
    source: seller_name

  buyer_name:
    source: buyer_name

  total_amount:
    source: total_amount

  total_amount_uppercase:
    source: total_amount
    transform: chinese_currency_uppercase
```

Important details in this example:

- id is the stable template identifier and must begin with a lowercase letter or number.
- document.file points to the copied DOCX inside the template directory.
- fields describes business values, not necessarily every placeholder.
- bindings uses placeholder names as keys and field keys as source values.
- invoice_date is one business field with three derived placeholders.
- total_amount_uppercase is a deterministic transform of total_amount.
- Every binding source must refer to a configured field.

### 4.3 Top-level properties

| Property       | Required | Purpose                                                        |
| -------------- | -------- | -------------------------------------------------------------- |
| schema_version | Yes      | Persisted schema version; current value is 1                   |
| id             | Yes      | Stable machine identifier for the template                     |
| name           | Yes      | Human-facing template name                                     |
| description    | No       | Human-facing explanation                                       |
| document.file  | Yes      | Relative DOCX path inside the template directory               |
| fields         | Yes      | Mapping of business field keys to field definitions            |
| bindings       | No       | Mapping of DOCX placeholders to business fields and transforms |

### 4.4 Field properties

| Property                    | Required | Purpose                                                       |
| --------------------------- | -------- | ------------------------------------------------------------- |
| label                       | Yes      | Human-facing field name                                       |
| description                 | No       | Additional semantic context                                   |
| type                        | No       | string, number, date, or boolean; defaults to string          |
| required                    | No       | Whether a non-blank final value is required; defaults to true |
| extraction.instruction      | No       | Field-specific instruction included in the AI prompt          |
| normalization.trim          | No       | Trim surrounding whitespace                                   |
| normalization.remove_spaces | No       | Remove ordinary spaces from strings                           |
| validation.regex            | No       | Regular expression rule                                       |
| validation.minimum          | No       | Inclusive numeric lower bound                                 |
| validation.maximum          | No       | Inclusive numeric upper bound                                 |
| validation.date_format      | No       | Required date representation                                  |
| validation.enum             | No       | Allowed string values                                         |
| output.format               | No       | Date format used during normalization                         |

### 4.5 Choosing the field type

The type controls the JSON value expected from the external AI tool:

```json
{
  "customer_name": {
    "value": "Acme Corporation",
    "status": "found",
    "evidence": "Customer: Acme Corporation"
  },
  "quantity": {
    "value": 12,
    "status": "found",
    "evidence": "Quantity: 12"
  },
  "invoice_date": {
    "value": "2026-09-17",
    "status": "found",
    "evidence": "Date: 2026-09-17"
  },
  "is_paid": {
    "value": true,
    "status": "found",
    "evidence": "Paid: Yes"
  }
}
```

Use a JSON number for number fields, not a quoted number. Use a JSON boolean for boolean fields, not
a quoted true or false. Dates are strings and must represent real calendar dates.

Review input is more forgiving: numeric strings and the strings true or false can be normalized
during review. The extraction contract should still ask the external AI tool to return the
configured type directly.

### 4.6 Validation examples

String pattern:

```yaml
validation:
  regex: '^[A-Z]{2}-[0-9]{8}$'
```

Numeric range:

```yaml
type: number
validation:
  minimum: 0
  maximum: 1000000
```

Allowed values:

```yaml
type: string
validation:
  enum:
    - pending
    - paid
    - cancelled
```

Date format:

```yaml
type: date
output:
  format: YYYY-MM-DD
validation:
  date_format: YYYY-MM-DD
```

A validation failure is not silently repaired. FillForge reports the field and rule so the user can
correct the extraction or review value.

### 4.7 Binding and transform examples

Direct mapping:

```yaml
bindings:
  seller_name:
    source: seller_name
```

Date parts:

```yaml
bindings:
  issue_year:
    source: issue_date
    transform: date_year
  issue_month:
    source: issue_date
    transform: date_month
  issue_day:
    source: issue_date
    transform: date_day
```

Text transforms:

```yaml
bindings:
  normalized_name:
    source: seller_name
    transform: trim
  name_uppercase:
    source: seller_name
    transform: uppercase
```

Chinese currency uppercase:

```yaml
bindings:
  amount_uppercase:
    source: total_amount
    transform: chinese_currency_uppercase
```

The built-in transforms are deterministic:

- identity
- date_year
- date_month
- date_day
- trim
- uppercase
- lowercase
- chinese_currency_uppercase

Do not encode custom JavaScript in YAML.

## 5. Configure a template in the application

### Step 1: Import

Import the DOCX from Templates. FillForge inspects it before saving and creates a field and same-name
binding for every unique placeholder such as `{invoice_number}`. The imported template opens
automatically. Templates without a supported placeholder, damaged DOCX files, and unsupported
expressions are rejected before a template is created.

### Step 2: Configure fields

Imported fields start as optional text fields, with the placeholder key as their label. For each
field that needs different settings:

1. Select its type and required status in the main field list.
2. Open Advanced settings to add a human-facing label, meaning, extraction instruction, validation,
   and normalization rules.
3. Save the template.

The extraction instruction should identify the correct source, not ask the model to format a DOCX.
For example:

```text
Find the value explicitly labelled Invoice number. Do not use the invoice code.
```

### Step 3: Sync or customize bindings

Simple placeholders already have same-name bindings. If the DOCX has changed since import, choose
Sync placeholders. This adds missing same-name fields and bindings while preserving existing field
settings, custom sources, and transforms. Repeating the sync is safe.

Advanced settings expose the binding table for specialized mappings. For example, a date can feed a
year-only placeholder with a deterministic transform:

```yaml
bindings:
  invoice_year:
    source: invoice_date
    transform: date_year
```

Add a transform only when deterministic formatting is required, then save the template.

### Step 4: Preview the prompt

Open the prompt preview to confirm:

- every requested field is present;
- labels and descriptions are correct;
- extraction instructions are unambiguous;
- required flags are correct;
- date and type expectations are clear;
- expected JSON uses the same field keys as template.yaml.

If the template has no configured fields, prompt generation is rejected. Add fields first.

## 6. Run the extraction workflow

### 6.1 Start and complete a run

1. Open **Run** and choose a document template.
2. Choose one or more source images, PDFs, text files, or Markdown files. Canceling the file picker
   does not create a run.
3. Choose **Extract with AI**. FillForge sends the selected source files and generated extraction
   prompt to the default AI connection. The combined source files may not exceed 50 MB.
4. Review the labeled values, correct any mistakes, and expand **View AI result and evidence** when
   you want to see the source details.
5. Choose **Create document**. FillForge saves the review, validates and normalizes the values, and
   renders the DOCX. Correct any inline validation errors and try again if required fields are
   missing or invalid.
6. Choose **Open document** or **Save a copy**. Choose **Start another run** to clear the page; the
   finished run remains available under the small **History** button.

FillForge supports PDF, common image formats, UTF-8 text, and Markdown inputs. Some AI models or
compatible endpoints may reject specific file types. FillForge reports the provider error so you can
choose another model or use the Advanced tools.

### 6.2 Configure an AI connection

Open **Settings → AI connections** to set a global **Reasoning effort** and add a named connection.
The reasoning selection applies to every document extraction request. **Provider default** leaves
the choice to the model; the model and endpoint must support any explicit level you select. Choose
the Responses or Chat Completions protocol, enter an HTTPS endpoint (HTTP is allowed for loopback
endpoints on this computer), then choose **Discover models**. Search the results and add the models
you want to keep; you can also enter a model ID yourself. Select a default model and save the
connection. You can discover or test an unsaved connection before saving it. Choose a default AI
connection at the top of the settings page. Save settings at the top of the AI connections page to
apply the reasoning selection. The Run page uses the default connection and does not ask you to
select a model for each document.

If a Responses endpoint cannot list models, discovery can verify the model ID you entered by
sending a small request with no files and `store: false`. **Test connection** sends a small request
with no files for either protocol. These requests go to the endpoint shown in the connection
settings.

The API key is stored in the operating system credential store. The key field only indicates whether
a key has been saved; FillForge never returns the saved key to the UI. If the operating system
cannot securely store credentials, the connection cannot be saved with that key.

### 6.3 Use the Advanced prompt and JSON tools

Expand **Advanced tools** on the Run page to generate or copy the prompt and expected JSON, or import
a prepared extraction result. The prompt contains:

- the extractor role and instructions not to guess;
- each field key, meaning, type, and required state;
- field-specific extraction rules;
- the expected JSON structure and allowed statuses.

To complete extraction with another AI service:

Open the multimodal AI tool of your choice:

1. Paste the FillForge prompt.
2. Attach the same source documents or images.
3. Ask the tool to return JSON only.
4. Do not ask it to edit the Word document.
5. Do not ask it to return YAML.
6. Copy the complete JSON response.

The expected contract for each field is:

```json
{
  "field_key": {
    "value": "typed value or null",
    "status": "found",
    "evidence": "short text supporting the value"
  }
}
```

Allowed statuses are found, not_found, and ambiguous. If the source does not provide a reliable
value, use null and explain the situation through status and evidence. Do not invent a value.

### 6.4 Example AI result

For the invoice example, a valid response could be:

```json
{
  "invoice_number": {
    "value": "INV-2026-00418",
    "status": "found",
    "evidence": "Invoice number: INV-2026-00418"
  },
  "invoice_date": {
    "value": "2026-03-17",
    "status": "found",
    "evidence": "Invoice date: 2026-03-17"
  },
  "seller_name": {
    "value": "Northwind Trading Co., Ltd.",
    "status": "found",
    "evidence": "Seller: Northwind Trading Co., Ltd."
  },
  "buyer_name": {
    "value": "Contoso Studio LLC",
    "status": "found",
    "evidence": "Buyer: Contoso Studio LLC"
  },
  "total_amount": {
    "value": 18650.65,
    "status": "found",
    "evidence": "Total incl. tax: 18,650.65"
  }
}
```

Some tools wrap JSON in a Markdown fence. FillForge accepts this form:

````text
```json
{
  "invoice_number": {
    "value": "INV-2026-00418",
    "status": "found",
    "evidence": "Invoice number: INV-2026-00418"
  }
}
```
````

Do not paste the persisted extraction.json wrapper into the import box. The import box expects the
unwrapped field mapping shown above.

### 6.5 Import and resolve issues

In the run page:

1. Paste the copied response.
2. Choose Import extraction.
3. Read all validation notes.
4. Correct the source JSON or continue to review the flagged values.

FillForge reports issues such as:

| Issue                 | Meaning                                      | Action                                            |
| --------------------- | -------------------------------------------- | ------------------------------------------------- |
| malformed JSON        | The response cannot be parsed                | Fix punctuation or copy the complete response     |
| missing_field         | A required field is absent                   | Ask the AI again or fill it during review         |
| unknown_field         | The response contains a field not configured | Remove it or add the field intentionally          |
| type_mismatch         | The JSON value has the wrong type            | Return a number/boolean/date in the expected form |
| invalid_date          | The date is not a real calendar date         | Correct the date                                  |
| status_value_conflict | not_found or ambiguous contains a value      | Set value to null                                 |
| required_not_found    | A required value was not found               | Verify the source or fill it manually             |
| rule_violation        | A configured validation rule failed          | Correct the value or the template rule            |

The parsed extraction is saved as extraction.json and is immutable. Importing a second extraction
into the same run is rejected so the original model result remains auditable.

## 7. Review values

The review table shows:

- configured field label and key;
- AI value;
- extraction status;
- evidence;
- editable final value;
- prior review decision when one exists.

For each field, choose one of these outcomes:

| Decision        | Use when                                           |
| --------------- | -------------------------------------------------- |
| accepted        | The AI value is correct                            |
| corrected       | The AI found a value but it needs editing          |
| rejected        | The AI value should not be used                    |
| filled_manually | The AI did not provide a value and you entered one |

The application preserves the model value in review.json and never rewrites extraction.json.

Example review record:

```json
{
  "schema_version": 1,
  "fields": {
    "invoice_number": {
      "model_value": "INV-2026-00418",
      "final_value": "INV-2026-00418",
      "decision": "accepted"
    },
    "total_amount": {
      "model_value": 18650.65,
      "final_value": 18650.65,
      "decision": "accepted"
    }
  }
}
```

To clear a value, remove its final value in the review input. A required blank will prevent
rendering; an optional blank can render as an empty placeholder.

Saving a review invalidates normalized.json. This prevents a previous normalized value from being
used after a correction.

## 8. Create the DOCX

Choose **Create document** on the Run page. FillForge performs these steps together:

1. Loads the current extraction.
2. Applies the final reviewed values where available.
3. Applies field normalization.
4. Validates required fields, types, dates, regex rules, ranges, date formats, and enums.
5. Resolves bindings and deterministic transforms.
6. Renders the copied DOCX.
7. Saves a versioned output.

Rendering is blocked when a required or invalid value remains. Fix the inline value or update the
template configuration, then choose Create document again. After rendering, choose Open document,
Save a copy, or Start another run.

Every render retains its own version:

```text
runs/<run-ulid>/output/
├── result-001.docx
├── result-002.docx
└── result.docx
```

result.docx always mirrors the newest version. Previous versioned files remain available for
comparison and audit until the run is deleted.

## 9. Manage run history

Open run history with the small **History** button in the Run page. Reopen a run, delete one run, or
clear all run history from the drawer. Deleting a run copies every generated numbered DOCX and the
latest result.docx into:

```text
<home>/.local/fillforge/exports/preserved-runs/<run-ulid>/
```

If preserving any DOCX fails, FillForge leaves that run intact. If clearing all history encounters
failures, failed runs stay in history and the drawer offers **Open saved documents**. Files already
exported to other locations are not changed. Clearing run history removes local run data only and
does not remove data retained by an external AI provider.

## 10. Inspect the stored run

A completed run has this shape:

```text
<home>/.local/fillforge/runs/<run-ulid>/
├── metadata.json
├── input/
│   └── copied source evidence
├── prompt.md
├── extraction.json
├── review.json
├── normalized.json
└── output/
    ├── result-001.docx
    └── result.docx
```

Artifact behavior:

| Artifact        | Mutable?                  | Meaning                                                             |
| --------------- | ------------------------- | ------------------------------------------------------------------- |
| metadata.json   | Updated for attachments   | Run identity, template version, prompt version, attachment metadata |
| input/          | No                        | Copies of source evidence                                           |
| prompt.md       | No after first generation | Prompt and expected JSON structure                                  |
| extraction.json | No                        | Parsed original AI result                                           |
| review.json     | Yes                       | Human decisions and final values                                    |
| normalized.json | Derived                   | Current normalized business record                                  |
| result-XXX.docx | No                        | Retained render version                                             |
| result.docx     | Replaced as latest mirror | Copy of the newest versioned render                                 |

All YAML and JSON domain files are schema-versioned. Unsupported newer versions are rejected rather
than silently rewritten.

## 11. CLI workflow

The Rust CLI uses the same services as the desktop application:

```bash
cargo run -p fillforge-cli --bin fillforge -- inspect-template <templateId>
cargo run -p fillforge-cli --bin fillforge -- extract-fields <templateId>
cargo run -p fillforge-cli --bin fillforge -- validate-fields <templateId> <extraction.json>
cargo run -p fillforge-cli --bin fillforge -- render-document <runId>
```

The extraction JSON supplied to validate-fields is the unwrapped AI response, not the persisted
extraction.json wrapper.

Use an isolated root after importing the template with the desktop app configured to use the same
`FILLFORGE_HOME` value:

```bash
FILLFORGE_HOME=/tmp/fillforge-demo cargo run -p fillforge-cli --bin fillforge -- inspect-template invoice-template
```

Command output:

- inspect-template lists placeholders, unconfigured placeholders, and unreferenced fields.
- extract-fields prints the prompt and expected JSON structure.
- validate-fields reports semantic issues and prints normalized values on success.
- render-document renders the run under its output directory.

## 12. Troubleshooting

### The placeholder is not detected

Check that:

- the file is a DOCX, not a PDF or a renamed text file;
- the placeholder uses ordinary braces;
- the key contains no spaces;
- the placeholder is not a Word content control or mail-merge field;
- the document was saved after editing;
- the expected key is not a loop or conditional marker.

FillForge handles placeholders split across Word XML runs, but inspect the imported copy and verify
the report before configuring bindings.

### The editor shows an unconfigured placeholder

The Word document contains a placeholder with no binding entry. Add a binding whose key exactly
matches the placeholder:

```yaml
bindings:
  invoice_number:
    source: invoice_number
```

The source must also exist under fields.

### The editor shows an unreferenced field

The field exists in template.yaml but no discovered placeholder maps to it. Either add a placeholder
and binding to the Word document or remove the unused field.

### Prompt generation says there are no fields

The fields mapping is empty or the manual YAML edit was not saved. Add at least one field and reopen
the template.

### JSON import fails

Make sure the pasted content is:

- complete JSON;
- an object, not a prose explanation;
- unwrapped as the expected field mapping;
- optionally enclosed in one simple Markdown fence;
- within the application input size limit.

Remove commentary before and after the JSON. FillForge does not attempt aggressive recovery of
arbitrary malformed text.

### A number is rejected

Use a JSON number:

```json
"value": 1234.5
```

not a quoted string:

```json
"value": "1,234.50"
```

A review input may accept a numeric string for normalization, but the extraction contract should
return the correct type.

### A date is rejected

Use a real calendar date in the configured format, for example:

```json
"value": "2026-09-17"
```

Dates such as 2026-02-30 are invalid even if they match a YYYY-MM-DD pattern.

### A required field blocks rendering

Open the validation notes and review table. Required fields cannot be blank, not_found, or ambiguous
at render time. Correct the value, fill it manually, or mark the field optional only when that
matches the business requirement.

### The original AI result changed

It should not. extraction.json is write-once. Human corrections belong in review.json. If the
artifact is malformed on disk, preserve it for diagnosis and inspect the run logs rather than
editing it as a shortcut.

### The output cannot be opened or exported

Use an output path returned by FillForge. System file operations accept files inside the FillForge
data directory and reject missing files, directories, traversal paths, and symlinks that resolve
outside the data directory.

### Configuration is rejected

Check:

- schema_version is 1;
- id matches the template directory name;
- document.file is relative and points inside the template directory;
- every binding source exists under fields;
- regex and enum values are valid YAML;
- indentation uses spaces.

### Where are logs?

Debug builds write logs to debug-logs/ in the project working directory. Packaged builds write logs
under the FillForge data log directory. debug.log contains a summary of warnings and errors;
debug-feature.log contains feature-specific details. Logs rotate at approximately 2 MB.

## 13. Practical template checklist

Before sharing or using a template, confirm:

- [ ] The Word file is saved as DOCX.
- [ ] Every placeholder uses a stable lowercase machine key.
- [ ] No placeholder depends on loops, conditions, content controls, or mail merge.
- [ ] Every placeholder has a binding.
- [ ] Every binding source is a configured field.
- [ ] Every required field can be found in the source or filled during review.
- [ ] Number fields return JSON numbers.
- [ ] Boolean fields return JSON booleans.
- [ ] Date fields use real calendar dates.
- [ ] Regular expressions and enum values are tested with representative data.
- [ ] Long text, empty optional values, and repeated renders have been tested.
- [ ] The generated DOCX has the expected formatting.
- [ ] The template.yaml file is backed up or version-controlled.

## 14. Related documentation

- [Project specification](../SPEC.md)
- [Repository README](../README.md)
- [License](../LICENSE)
