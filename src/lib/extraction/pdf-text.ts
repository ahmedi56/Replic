/**
 * Minimal PDF text-layer reader.
 *
 * Most receipts that arrive as PDFs (emailed invoices, accounting exports) carry a real
 * text layer, and reading it is far more accurate than OCR-ing a render of the page.
 * This walks the content streams, inflates the Flate-compressed ones, and pulls the
 * strings out of the text-showing operators.
 *
 * It intentionally does not try to be a full PDF parser: if a document is a scan with no
 * text layer, this returns null and the caller falls back to an OCR provider.
 */
import zlib from 'node:zlib';

const STREAM_RE = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g;

function inflate(buf: Buffer): Buffer | null {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync, zlib.gunzipSync]) {
    try {
      return fn(buf);
    } catch {
      /* try the next encoding */
    }
  }
  return null;
}

/** Decode a PDF literal string, resolving escapes and octal codes. */
function decodeLiteral(s: string): string {
  return s.replace(/\\(n|r|t|b|f|\(|\)|\\|[0-7]{1,3})/g, (_, g: string) => {
    switch (g) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '(': return '(';
      case ')': return ')';
      case '\\': return '\\';
      default: return String.fromCharCode(parseInt(g, 8));
    }
  });
}

function decodeHex(s: string): string {
  const clean = s.replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 || code === 10 || code === 13) out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Pull text out of one content stream, preserving line structure.
 * Vertical text-positioning operators (Td, TD, T-star) become newlines so labels stay on
 * their own lines — the receipt parser relies on line layout.
 */
function textFromContent(content: string): string {
  const out: string[] = [];
  let line = '';

  const tokenRe = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\[[^\]]*\]|T[djDJ*]|Td|TD|TJ|Tj|'|"|BT|ET/g;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(content)) !== null) {
    const tok = m[0];

    if (tok.startsWith('(')) {
      line += decodeLiteral(tok.slice(1, -1));
    } else if (tok.startsWith('<') && !tok.startsWith('<<')) {
      line += decodeHex(tok.slice(1, -1));
    } else if (tok.startsWith('[')) {
      // TJ array: strings interleaved with kerning numbers. Large negative kerns are gaps.
      const parts = tok.slice(1, -1);
      const inner = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|-?\d+(?:\.\d+)?/g;
      let im: RegExpExecArray | null;
      while ((im = inner.exec(parts)) !== null) {
        const t = im[0];
        if (t.startsWith('(')) line += decodeLiteral(t.slice(1, -1));
        else if (t.startsWith('<')) line += decodeHex(t.slice(1, -1));
        else if (Number(t) < -180) line += '  '; // wide kern reads as column separation
      }
    } else if (tok === 'Td' || tok === 'TD' || tok === 'T*' || tok === "'" || tok === '"' || tok === 'ET') {
      if (line.trim()) out.push(line.trimEnd());
      line = '';
    }
  }
  if (line.trim()) out.push(line.trimEnd());
  return out.join('\n');
}

export function extractPdfText(buffer: Buffer): string | null {
  const latin = buffer.toString('latin1');
  const chunks: string[] = [];

  STREAM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STREAM_RE.exec(latin)) !== null) {
    const rawStream = Buffer.from(m[1], 'latin1');
    const inflated = inflate(rawStream);
    const content = inflated ? inflated.toString('latin1') : m[1];
    if (!/\bTj\b|\bTJ\b|\bBT\b/.test(content)) continue;
    const text = textFromContent(content);
    if (text.trim()) chunks.push(text);
  }

  const joined = chunks.join('\n').replace(/\u0000/g, '').trim();
  // A handful of stray glyphs is not a text layer.
  if (joined.replace(/\s/g, '').length < 12) return null;
  return joined;
}

export function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}
