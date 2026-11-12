import { FORMATS, PROVIDERS } from './story.js';
import { $, button, escape, icon, field } from './ui.js';

function splitScript(text, size = 16000) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline > start + size / 2) end = newline + 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

export function createScriptImport({ modal, show, headers, api, profiles, defaultProfile, useProfile, onApply, notice }) {
  const fileInput = $('#script-file');
  const state = { filename: '', text: '', format: '短片', model: '', status: '', error: '', task: null, result: null, checked: new Set() };
  const visible = () => modal.open && Boolean($('#script-import-dialog', modal));

  function open() {
    const available = profiles();
    if (!available.some(profile => profile.id === state.model)) state.model = defaultProfile()?.id || available[0]?.id || '';
    const busy = Boolean(state.task);
    const choices = available.map(profile => [profile.id, `${profile.name || profile.model} · ${PROVIDERS[profile.provider].label}`]);
    show('导入剧本', `<div id="script-import-dialog">
      <button type="button" class="script-drop" data-action="script-pick" ${busy ? 'disabled' : ''}>
        ${icon(state.text ? 'file-text' : 'upload-simple')}<strong>${escape(state.filename || '选择或拖入剧本文档')}</strong>
        <small>${state.text ? `${state.text.length.toLocaleString('zh-CN')} 字符已读取` : 'Word DOCX、文字版 PDF、Markdown、TXT、Fountain'}</small></button>
      <div class="modal-grid import-config">
        ${field('script-format', '作品体量', state.format, { type: 'select', choices: FORMATS.map(value => [value, value]) })}
        ${field('script-model', '分析模型', state.model, { type: 'select', choices: choices.length ? choices : [['', '选择模型配置']] })}
      </div>
      ${state.error ? `<p class="modal-error" role="alert">${escape(state.error)}</p>` : ''}
      ${state.status ? `<div class="activity-status import-status" role="status">${busy ? '<span class="activity-dots"></span>' : icon('check-circle')}${escape(state.status)}</div>` : ''}
      ${state.result ? renderResult() : ''}
      <div class="modal-footer">
        ${busy ? button('script-cancel', '取消任务', { glyph: 'x' }) : button('script-analyze', state.result ? '重新拆解' : '拆解结构', { glyph: 'sparkle', style: state.result ? 'secondary' : 'primary', disabled: !state.text })}
        ${state.result && !busy ? button('script-apply', '应用为新项目', { glyph: 'graph', style: 'primary', disabled: !state.checked.size }) : ''}
      </div></div>`, Boolean(state.result));
    if (busy) $('#field-script-format', modal).disabled = $('#field-script-model', modal).disabled = true;
  }

  function renderResult() {
    const result = state.result;
    return `<section class="analysis-result"><h3>${escape(result.title)}</h3><p>${escape(result.premise)}</p>
      ${result.analysisNotes ? `<div class="analysis-note"><h4>结构诊断</h4><p>${escape(result.analysisNotes)}</p></div>` : ''}
      ${result.constraints ? `<div class="analysis-note"><h4>共享设定</h4><p>${escape(result.constraints)}</p></div>` : ''}
      <div class="section-label"><h3>选中要应用的节点</h3><span class="hint">${state.checked.size} / ${result.nodes.length}</span></div>
      <div class="analysis-nodes">${result.nodes.map((node, index) => `<label class="analysis-node">
        <input type="checkbox" data-analysis-index="${index}" ${state.checked.has(index) ? 'checked' : ''} ${state.task ? 'disabled' : ''}>
        <div><h4>${escape(node.title)}</h4>
        <p>${escape(node.action)}</p>${node.consequence ? `<p><strong>后果</strong> ${escape(node.consequence)}</p>` : ''}
        ${node.evidence ? `<blockquote>${escape(node.evidence)}</blockquote>` : '<p class="field-hint">原文依据待核对</p>'}</div></label>`).join('')}</div></section>`;
  }

  const redraw = () => { if (visible()) open(); };

  async function read(file) {
    if (!file || state.task) return;
    state.error = '';
    if (file.size > 16 * 1024 * 1024) { state.error = '文件超过 16 MB，请导入较小的副本。'; redraw(); return; }
    const controller = new AbortController();
    state.task = controller;
    state.filename = file.name;
    state.text = '';
    state.result = null;
    state.status = '正在读取文档正文…';
    redraw();
    try {
      const response = await fetch('/api/import/extract', { method: 'POST', headers: { ...headers,
        'Content-Type': 'application/octet-stream', 'X-Script-Name': encodeURIComponent(file.name) }, body: file, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '文档读取失败。');
      state.text = result.text;
      state.status = '正文读取完成';
    } catch (error) {
      state.error = controller.signal.aborted ? '读取已取消。' : error.message;
      state.status = '';
    } finally { state.task = null; redraw(); }
  }

  async function analyze() {
    if (!state.text || state.task) return;
    const selected = profiles().find(profile => profile.id === state.model);
    const profile = useProfile(selected);
    if (!profile) return;
    const controller = new AbortController();
    state.task = controller;
    state.error = '';
    const parts = splitScript(state.text);
    const summaries = [];
    try {
      if (parts.length > 1) {
        for (const [i, text] of parts.entries()) {
          state.status = `正在提取第 ${i + 1} / ${parts.length} 段的场景和线索…`;
          redraw();
          summaries.push(await (await api('/api/ai/analyze-part', { profile, text, part: i + 1 }, controller.signal)).json());
        }
      }
      state.status = parts.length > 1 ? '各段已读取，正在合并故事结构…' : '正在识别节拍、因果与原文依据…';
      redraw();
      const result = await (await api('/api/ai/analyze-script', { profile, filename: state.filename, source: state.text,
        format: state.format, parts: summaries }, controller.signal)).json();
      state.result = { ...result, sourceName: state.filename, modelId: selected.id, modelSource: selected.name || selected.model };
      state.checked = new Set(result.nodes.map((_, i) => i));
      state.status = `结构拆解完成 · ${result.nodes.length} 个节点`;
      if (!visible()) notice('剧本结构分析已完成，可重新打开导入窗口查看。');
    } catch (error) {
      state.error = controller.signal.aborted ? '分析已取消。' : error.message;
      state.status = '';
    } finally { state.task = null; redraw(); }
  }

  function apply() {
    if (!state.result || state.task || !state.checked.size) return;
    const result = { ...state.result, nodes: state.result.nodes.filter((_, i) => state.checked.has(i)) };
    onApply(result);
    Object.assign(state, { filename: '', text: '', status: '', error: '', result: null, checked: new Set() });
  }

  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    void read(file);
  });
  modal.addEventListener('dragover', event => {
    const zone = event.target.closest('.script-drop');
    if (!zone || state.task) return;
    event.preventDefault();
    zone.classList.add('is-over');
  });
  modal.addEventListener('dragleave', event => event.target.closest('.script-drop')?.classList.remove('is-over'));
  modal.addEventListener('drop', event => {
    const zone = event.target.closest('.script-drop');
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('is-over');
    void read(event.dataTransfer.files[0]);
  });
  modal.addEventListener('change', event => {
    const control = event.target;
    if (control.id === 'field-script-model') state.model = control.value;
    if (control.id === 'field-script-format') state.format = control.value;
    if (control.dataset.analysisIndex !== undefined) {
      const index = Number(control.dataset.analysisIndex);
      if (control.checked) state.checked.add(index);
      else state.checked.delete(index);
      $('[data-action=script-apply]', modal).disabled = !state.checked.size;
      $('.analysis-result .section-label .hint', modal).textContent = `${state.checked.size} / ${state.result.nodes.length}`;
    }
  });
  return { open, read, pick: () => fileInput.click(), analyze, cancel: () => state.task?.abort(), apply };
}
