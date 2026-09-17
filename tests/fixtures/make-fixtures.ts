import fs from 'node:fs/promises';
import path from 'node:path';
import PizZip from 'pizzip';

const FIXTURES_DIR = path.resolve(import.meta.dirname);

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function buildDocumentXml(paragraphs: string[]): string {
  const body = paragraphs
    .map(
      (paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

/**
 * Build a minimal but valid DOCX (Office Open XML WordprocessingDocument).
 * The placeholder text lives in single runs; use splitRuns() for tags that
 * must span multiple runs.
 */
function buildDocx(paragraphs: string[]): Uint8Array {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  zip.file('word/document.xml', buildDocumentXml(paragraphs));
  return new Uint8Array(zip.generate({ type: 'nodebuffer' }));
}

/**
 * Produce a paragraph where the placeholder text is split across two runs,
 * which is what Word does when a user edits part of a tag. Inspection must
 * still find the placeholder.
 */
function splitRuns(firstHalf: string, secondHalf: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(firstHalf)}</w:t></w:r><w:r><w:t xml:space="preserve">${escapeXml(secondHalf)}</w:t></w:r></w:p>`;
}

async function writeDocx(relativePath: string, paragraphs: string[]) {
  const target = path.join(FIXTURES_DIR, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buildDocx(paragraphs));
  console.log(`wrote ${relativePath}`);
}

await writeDocx('templates/simple/simple-template.docx', [
  'Title: {title}',
  'Date: {date}',
  'Prepared for: {client_name}'
]);

{
  // One paragraph whose tag text is deliberately split across two runs,
  // which is what Word produces when a user edits part of a tag.
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${splitRuns('Split: {customer_', 'name} ends here')}<w:sectPr/></w:body></w:document>`
  );
  const target = path.join(FIXTURES_DIR, 'templates/simple/split-run-template.docx');
  await fs.writeFile(target, new Uint8Array(zip.generate({ type: 'nodebuffer' })));
  console.log('wrote templates/simple/split-run-template.docx');
}

await writeDocx('templates/invoice/invoice-template.docx', [
  '发票号码：{invoice_number}',
  '开票日期：{invoice_date}',
  '销售方：{seller_name}',
  '价税合计：{total_amount}'
]);

console.log('fixtures regenerated');
