import { fileURLToPath } from 'node:url';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';
import { beatName, mainlineNodes } from '../public/story.js';

const font = fileURLToPath(new URL('./fonts/NotoSansSC-Regular.otf', import.meta.url));

function outline(project) {
  const blocks = [{ kind: 'title', text: project.title }, { kind: 'meta', text: `剧本开发大纲 · ${project.format}` }];
  if (project.premise) blocks.push({ kind: 'section', text: '故事梗概' }, { kind: 'body', text: project.premise });
  if (project.constraints) blocks.push({ kind: 'section', text: '已定设定' }, { kind: 'body', text: project.constraints });
  blocks.push({ kind: 'section', text: '主线大纲' });
  const mainline = mainlineNodes(project);
  if (!mainline.length) blocks.push({ kind: 'body', text: '主线尚未建立。' });
  for (const [index, node] of mainline.entries()) {
    blocks.push({ kind: 'node', text: `${String(index + 1).padStart(2, '0')}  ${node.title}  ·  ${beatName(node.beat)}` });
    for (const [label, value] of [['情节', node.action], ['前因', node.reason], ['后果', node.consequence],
      ['伏笔与回收', node.clue], ['联动修改', node.tradeoff]]) {
      if (value) blocks.push({ kind: 'body', text: value, label });
    }
    if (node.valence !== null || node.tension !== null) {
      const values = [node.valence === null ? null : `情绪 ${node.valence > 0 ? '+' : ''}${node.valence}`,
        node.tension === null ? null : `张力 ${node.tension}/10`, node.emotionNote].filter(Boolean);
      blocks.push({ kind: 'body', text: values.join(' · '), label: '情绪标注' });
    }
    if (node.script) blocks.push({ kind: 'body', text: node.script, label: '场景正文' });
  }
  return blocks;
}

function markdown(blocks) {
  const headings = { title: '# ', section: '## ', node: '### ' };
  return blocks.map(block => `${headings[block.kind] || ''}${block.label ? `**${block.label}**　` : ''}${block.text}`).join('\n\n') + '\n';
}

function word(blocks, title) {
  const headings = { title: HeadingLevel.TITLE, section: HeadingLevel.HEADING_1, node: HeadingLevel.HEADING_2 };
  const sizes = { title: 44, meta: 20, section: 30, node: 25, body: 22 };
  const font = { ascii: 'Aptos', eastAsia: 'Microsoft YaHei', hAnsi: 'Aptos', cs: 'Aptos' };
  const children = blocks.flatMap(block => block.text.split('\n').map((line, i) => new Paragraph({
    heading: headings[block.kind],
    keepNext: Boolean(headings[block.kind]),
    spacing: { after: block.kind === 'body' ? 105 : 160, before: ['node', 'section'].includes(block.kind) ? 180 : 0, line: 340 },
    children: [
      ...(block.label && i === 0 ? [new TextRun({ text: `${block.label}　`, bold: true, font, color: '302954', size: sizes[block.kind] })] : []),
      new TextRun({ text: line, font, color: block.kind === 'meta' ? '686278' : '201D28', size: sizes[block.kind], bold: Boolean(headings[block.kind]) }),
    ],
  })));
  return Packer.toBuffer(new Document({
    title, creator: '枝幕', description: '剧本开发大纲',
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1100, left: 1160, right: 1160 } } }, children }],
  }));
}

function pdf(blocks, title) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 54, info: { Title: title, Creator: '枝幕', Subject: '剧本开发大纲' } });
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.font(font);
    const sizes = { title: 24, meta: 10, section: 16, node: 13, body: 10.8 };
    for (const block of blocks) {
      if (['node', 'section'].includes(block.kind)) {
        if (document.y > document.page.height - document.page.margins.bottom - 70) document.addPage();
        else document.moveDown(0.5);
      }
      const value = block.label ? `${block.label}　${block.text}` : block.text;
      document.fontSize(sizes[block.kind]).fillColor(block.kind === 'meta' ? '#686278' : '#201D28').text(value, { lineGap: 4 });
      document.moveDown(block.kind === 'title' ? 0.25 : 0.44);
    }
    document.end();
  });
}

export const EXPORT_MIME = {
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf',
};

export async function documentExport(project, format) {
  const blocks = outline(project);
  if (format === 'docx') return word(blocks, project.title);
  if (format === 'pdf') return pdf(blocks, project.title);
  if (format === 'md') return Buffer.from(markdown(blocks), 'utf8');
  return Buffer.from(blocks.map(block => block.label ? `${block.label}　${block.text}` : block.text).join('\n\n') + '\n', 'utf8');
}
