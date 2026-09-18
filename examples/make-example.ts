import fs from 'node:fs/promises';
import path from 'node:path';
import PizZip from 'pizzip';

// Regenerates examples/invoice/invoice-template.docx. The checked-in file is
// byte-exact; run `pnpm fixtures` after changing this script.
const EXAMPLES_DIR = path.resolve(import.meta.dirname);

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

interface RunOptions {
  bold?: boolean;
  sizeHalfPoints?: number;
}

function run(text: string, options: RunOptions = {}): string {
  const properties = [
    options.bold ? '<w:b/>' : '',
    options.sizeHalfPoints ? `<w:sz w:val="${options.sizeHalfPoints}"/>` : ''
  ]
    .filter(Boolean)
    .join('');
  const runProperties = properties ? `<w:rPr>${properties}</w:rPr>` : '';
  return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(
  runs: string,
  options: { align?: 'center'; spaceBeforeHalfPoints?: number } = {}
): string {
  const paragraphProperties: string[] = [];
  if (options.align) {
    paragraphProperties.push(`<w:jc w:val="${options.align}"/>`);
  }
  if (options.spaceBeforeHalfPoints) {
    paragraphProperties.push(
      `<w:spacing w:before="${options.spaceBeforeHalfPoints}" w:after="${options.spaceBeforeHalfPoints}"/>`
    );
  }
  const properties = paragraphProperties.length
    ? `<w:pPr>${paragraphProperties.join('')}</w:pPr>`
    : '';
  return `<w:p>${properties}${runs}</w:p>`;
}

function cell(content: string, widthTwentieths: number): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${widthTwentieths}" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
}

function row(cells: string): string {
  return `<w:tr>${cells}</w:tr>`;
}

const LABEL_WIDTH = 3400;
const VALUE_WIDTH = 5660;

function detailRow(label: string, placeholderRuns: string, boldLabel = false): string {
  return row(
    cell(paragraph(run(label, { bold: boldLabel })), LABEL_WIDTH) +
      cell(paragraph(placeholderRuns), VALUE_WIDTH)
  );
}

function table(rows: string): string {
  return (
    `<w:tbl><w:tblPr>` +
    `<w:tblW w:w="9060" w:type="dxa"/>` +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
      .join('') +
    '</w:tblBorders>' +
    '</w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${LABEL_WIDTH}"/><w:gridCol w:w="${VALUE_WIDTH}"/></w:tblGrid>` +
    rows +
    '</w:tbl>'
  );
}

function buildDocumentXml(): string {
  const body = [
    paragraph(run('INVOICE', { bold: true, sizeHalfPoints: 40 }), { align: 'center' }),
    paragraph(run('Sample document used by the FillForge examples; see examples/README.md.'), {
      spaceBeforeHalfPoints: 240
    }),
    table(
      [
        detailRow('Invoice number', run('{invoice_number}'), true),
        detailRow(
          'Invoice date',
          run('{invoice_year}') +
            run('-') +
            run('{invoice_month}') +
            run('-') +
            run('{invoice_day}')
        ),
        detailRow('Seller', run('{seller_name}')),
        detailRow('Buyer', run('{buyer_name}')),
        detailRow('Total amount', run('{total_amount}')),
        detailRow('Amount in words', run('{total_amount_uppercase}', { bold: true }))
      ].join('')
    ),
    paragraph(run('Thank you for your business.'), { spaceBeforeHalfPoints: 240 })
  ].join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`
  );
}

function buildDocx(documentXml: string): Uint8Array {
  // A fixed entry date keeps regeneration byte-for-byte reproducible.
  const date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    { date }
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    { date }
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    { date }
  );
  zip.file('word/document.xml', documentXml, { date });
  return new Uint8Array(zip.generate({ type: 'nodebuffer' }));
}

const target = path.join(EXAMPLES_DIR, 'invoice', 'invoice-template.docx');
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, buildDocx(buildDocumentXml()));
console.log('wrote invoice/invoice-template.docx');
