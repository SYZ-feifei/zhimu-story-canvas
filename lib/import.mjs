import { extname } from 'node:path';
import { RequestError } from './ai.mjs';

const maxText = 180000;

function textEncoding(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
}

function inspectZip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length) throw new RequestError('Word 文件不是可读取的 DOCX。');
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  let total = 0;
  for (let i = 0; i < entries; i += 1) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new RequestError('Word 文件的目录已损坏。');
    total += bytes.readUInt32LE(offset + 24);
    if (total > 100 * 1024 * 1024) throw new RequestError('Word 文件的解压内容过大。', 413);
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}

async function readPdf(bytes, signal) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pkg = new URL('./', import.meta.resolve('pdfjs-dist/package.json'));
  const folder = name => new URL(`${name}/`, pkg).href;
  const task = getDocument({ data: new Uint8Array(bytes), cMapUrl: folder('cmaps'), cMapPacked: true,
    standardFontDataUrl: folder('standard_fonts'), wasmUrl: folder('wasm'), disableFontFace: true, useSystemFonts: false,
    isEvalSupported: false, useWorkerFetch: false, enableXfa: false });
  try {
    const pdf = await task.promise;
    const pages = [];
    let length = 0;
    for (let page = 1; page <= pdf.numPages; page += 1) {
      signal?.throwIfAborted();
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join('');
      length += text.length;
      if (length > maxText) throw new RequestError('正文超过 18 万字符，请按集或章节分别导入。', 413);
      pages.push(text);
    }
    return pages.join('\n\n');
  } finally { await task.destroy(); }
}

export async function extractScript(bytes, filename, signal) {
  const ext = extname(filename).toLowerCase();
  let text;
  try {
    if (ext === '.docx') {
      inspectZip(bytes);
      const { default: mammoth } = await import('mammoth');
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } else if (ext === '.pdf') text = await readPdf(bytes, signal);
    else if (['.md', '.txt', '.fountain'].includes(ext)) text = textEncoding(bytes);
    else throw new RequestError('请选择 DOCX、文字版 PDF、Markdown、TXT 或 Fountain 文件。', 415);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (signal?.aborted) throw new RequestError('读取已取消。', 499);
    if (error.name === 'PasswordException') throw new RequestError('请选择可直接打开的 PDF 副本。');
    throw new RequestError('无法读取这份文档，请核对文件格式和内容。');
  }
  text = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (!text) throw new RequestError('文档没有可读取的正文。扫描件请使用已识别文字的版本。');
  if (text.length > maxText) throw new RequestError('正文超过 18 万字符，请按集或章节分别导入。', 413);
  return { text, characters: text.length };
}
