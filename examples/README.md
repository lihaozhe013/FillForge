# FillForge example: Invoice template

A complete, self-contained example that mirrors the invoice walkthrough in
[docs/USER_GUIDE.md](../docs/USER_GUIDE.md). It shows the full pipeline: DOCX with placeholders,
`template.yaml` with fields / validation / bindings, an AI-style extraction answer, and a rendered
result.

## Files

| File                            | Role                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `invoice/invoice-template.docx` | Word template with eight `{placeholder}` tags in a table (headings, borders, bold runs).                            |
| `invoice/template.yaml`         | Matching configuration: five business fields, bindings, and transforms (`date_year`, `chinese_currency_uppercase`). |
| `invoice/source-text.txt`       | Simulated OCR text of the paper invoice; paste it next to the generated prompt into any AI tool.                    |
| `invoice/extraction-input.json` | The "AI answer" you can import directly to skip the manual handoff.                                                 |

The template renders one invoice value into several placeholders: `invoice_date` becomes
`{invoice_year}-{invoice_month}-{invoice_day}`, and `total_amount` also feeds the bold
`{total_amount_uppercase}` cell through the `chinese_currency_uppercase` transform.

## Try it in the desktop app

1. Templates -> Import DOCX -> pick `invoice/invoice-template.docx`. Imported documents are always
   stored as `template.docx`, so if the imported template id differs from `invoice`, set `id:` in
   the copy of `template.yaml` accordingly.
2. Replace the generated `template.yaml` in `<home>/.local/fillforge/templates/<id>/` with
   `invoice/template.yaml` (or rebuild the same configuration in the editor; the guide's sections
   3-4 walk through it).
3. Open the placeholder report: all eight placeholders should be bound, with no unconfigured
   placeholders and no unreferenced fields.
4. Create a run, generate the prompt, and either paste `invoice/source-text.txt` into your AI tool
   or skip straight to importing `invoice/extraction-input.json`.
5. Accept the reviewed values and render; the result DOCX shows the filled table.

## Verify with the test suite

`tests/integration/examples.test.ts` imports this exact set of files, inspects the DOCX, generates
the prompt, imports the extraction JSON, reviews, renders, and asserts the output text. Examples
therefore stay correct automatically:

```sh
pnpm test
```

## Regenerating the DOCX

`invoice/invoice-template.docx` is produced byte-for-byte by `examples/make-example.ts`:

```sh
pnpm fixtures
```
