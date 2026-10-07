/**
 * A tiny PDF writer, used only to build the demo dataset.
 *
 * Demo receipts are generated as real PDFs with a real text layer, so the demo runs
 * through the same upload → extract → match pipeline a customer's files do. Nothing is
 * pre-filled: if the parser can't read a generated receipt, the demo shows that honestly.
 */

function escapePdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function makeReceiptPdf(lines: string[]): Buffer {
  const fontSize = 11;
  const leading = 15;
  const startY = 780;

  const textOps = lines
    .map((line, i) => `BT /F1 ${fontSize} Tf 56 ${startY - i * leading} Td (${escapePdfText(line)}) Tj ET`)
    .join('\n');

  const content = `q\n${textOps}\nQ`;
  const contentBuf = Buffer.from(content, 'latin1');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${contentBuf.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
