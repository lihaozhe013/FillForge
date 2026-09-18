# FillForge User Guide

This guide explains how to create a Word template that FillForge can inspect and render, how to
write the matching template.yaml configuration, and how to complete an extraction-to-DOCX run.

[Open this guide on GitHub](https://github.com/lihaozhe013/FillForge/blob/main/docs/USER_GUIDE.md)

For the normative architecture, persistence, security, and acceptance requirements, see the
[project specification](../SPEC.md).

## 1. What FillForge does

FillForge separates document extraction from document rendering:

```text
Word template + field configuration
                ↓
        deterministic prompt
                ↓
 external AI tool returns JSON
                ↓
     review and validation in FillForge
                ↓
       deterministic DOCX output
```

FillForge does not call an AI provider in the MVP. You copy the generated prompt to ChatGPT, Claude,
Gemini, or another multimodal tool, attach the source material there, and paste the JSON response
back into FillForge.

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

FillForge stores canonical data in ordinary files:

```text
<home>/.config/fillforge/config.yaml
<home>/.local/fillforge/templates/
<home>/.local/fillforge/runs/
<home>/.local/fillforge/exports/
<home>/.local/fillforge/cache/
<home>/.local/fillforge/logs/
```

The application does not use a database. Imported templates and source evidence are copied into
FillForge-owned directories; the original files are not modified.

For tests or an isolated portable workspace, set FILLFORGE_HOME. It changes the logical home root
while preserving the .config/fillforge and .local/fillforge layout:

```bash
FILLFORGE_HOME=/tmp/fillforge-demo pnpm test
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

A ready-made copy of this example document, together with the configuration written in section 4.2,
ships in the repository under [examples/invoice](../examples/README.md).

### 3.2 Placeholder rules

Use plain Docxtemplater-compatible placeholders:

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

A placeholder may be bold, italic, colored, or placed in a table cell. The inserted value inherits
the formatting around the placeholder according to Word and Docxtemplater behavior.

For predictable results:

1. Type a complete placeholder such as {invoice_number}.
2. Apply the desired formatting after the placeholder exists.
3. Do not insert Word content controls, mail-merge fields, or custom field codes in place of the
   plain placeholder.
4. Do not depend on loops, conditions, or custom Docxtemplater filters in the MVP.
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
4. Open the imported template.
5. Review the detected placeholder report.
6. Resolve every unconfigured placeholder by adding a binding.
7. Resolve every unreferenced field that should appear in the document.

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

The following configuration matches the Word example above. The identical pair (this YAML plus a
fillable DOCX) is checked in under [examples/invoice](../examples/README.md) and covered by the
integration tests, so you can import it instead of typing it out:

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

Import the DOCX from Templates. FillForge creates a stable template ID and an initial YAML file with
empty fields and bindings.

### Step 2: Configure fields

For each business value:

1. Add or open a field.
2. Choose a stable key such as invoice_number.
3. Enter a human-facing label.
4. Explain what the value means.
5. Choose the type.
6. Mark it required or optional.
7. Add an extraction instruction when similar values may be confused.
8. Add normalization and validation rules when needed.
9. Save the template.

The extraction instruction should identify the correct source, not ask the model to format a DOCX.
For example:

```text
Find the value explicitly labelled Invoice number. Do not use the invoice code.
```

### Step 3: Configure bindings

For every placeholder in Word:

1. Use the placeholder name as the binding key.
2. Select the business field as source.
3. Add a transform only when deterministic formatting is required.
4. Save the template.
5. Inspect again and confirm there are no unexpected unconfigured placeholders.

Example:

```yaml
bindings:
  invoice_year:
    source: invoice_date
    transform: date_year
```

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

### 6.1 Create a run

1. Open Runs or choose New Run from a template.
2. Select the configured template.
3. Create the run.
4. Attach source images, PDFs, text files, or Markdown files if you want evidence copied into the
   run directory.

Attached files are copied into input/. FillForge never modifies the original source file.

### 6.2 Generate the prompt

Choose Generate prompt. FillForge creates a prompt that contains:

- the extractor role;
- instructions not to guess;
- each field key, meaning, type, and required state;
- field-specific extraction rules;
- the expected JSON structure;
- the allowed statuses.

Choose Copy prompt and optionally Copy expected JSON.

The prompt is generated once for a run. Later changes to the application prompt-version setting
affect new runs, not an existing run.

### 6.3 Use an external AI tool

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
    "value": "INV-20260917",
    "status": "found",
    "evidence": "Invoice number: INV-20260917"
  },
  "invoice_date": {
    "value": "2026-09-17",
    "status": "found",
    "evidence": "Invoice date: 2026-09-17"
  },
  "seller_name": {
    "value": "Northwind Supplies",
    "status": "found",
    "evidence": "Seller: Northwind Supplies"
  },
  "buyer_name": {
    "value": "Contoso Retail",
    "status": "found",
    "evidence": "Buyer: Contoso Retail"
  },
  "total_amount": {
    "value": 1234.5,
    "status": "found",
    "evidence": "Total amount: 1,234.50"
  }
}
```

Some tools wrap JSON in a Markdown fence. FillForge accepts this form:

````text
```json
{
  "invoice_number": {
    "value": "INV-20260917",
    "status": "found",
    "evidence": "Invoice number: INV-20260917"
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
      "model_value": "INV-20260917",
      "final_value": "INV-20260917",
      "decision": "accepted"
    },
    "total_amount": {
      "model_value": 1234.5,
      "final_value": 1234.5,
      "decision": "accepted"
    }
  }
}
```

To clear a value, remove its final value in the review input. A required blank will prevent
rendering; an optional blank can render as an empty placeholder.

Saving a review invalidates normalized.json. This prevents a previous normalized value from being
used after a correction.

## 8. Normalize and render the DOCX

Choose Normalize to inspect the normalized business record, or choose Normalize + Render DOCX.

Before rendering, FillForge:

1. Loads the current extraction.
2. Applies the final reviewed values where available.
3. Applies field normalization.
4. Validates required fields, types, dates, regex rules, ranges, date formats, and enums.
5. Resolves bindings and deterministic transforms.
6. Renders the copied DOCX.
7. Saves a versioned output.

Rendering is blocked when a required or invalid value remains. Fix the review value or update the
template configuration, then save the review and render again.

Every render retains its own version:

```text
runs/<run-ulid>/output/
├── result-001.docx
├── result-002.docx
└── result.docx
```

result.docx always mirrors the newest version. Previous versioned files remain available for
comparison and audit.

Use Open to open a generated document, Show in folder to reveal it, or Export copy to save a copy
through the native file dialog.

## 9. Inspect the stored run

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

## 10. CLI workflow

The CLI uses the same services as the desktop application:

```bash
pnpm tsx packages/tools/src/index.ts inspect-template <templateId>
pnpm tsx packages/tools/src/index.ts extract-fields <templateId>
pnpm tsx packages/tools/src/index.ts validate-fields <templateId> <extraction.json>
pnpm tsx packages/tools/src/index.ts render-document <runId>
```

The extraction JSON supplied to validate-fields is the unwrapped AI response, not the persisted
extraction.json wrapper.

Use an isolated root:

```bash
FILLFORGE_HOME=/tmp/fillforge-demo pnpm tsx packages/tools/src/index.ts inspect-template invoice
```

Command output:

- inspect-template lists placeholders, unconfigured placeholders, and unreferenced fields.
- extract-fields prints the prompt and expected JSON structure.
- validate-fields reports semantic issues and prints normalized values on success.
- render-document renders the run under its output directory.

## 11. Troubleshooting

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

## 12. Practical template checklist

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

## 13. Related documentation

- [Project specification](../SPEC.md)
- [Repository README](../README.md)
- [License](../LICENSE)
