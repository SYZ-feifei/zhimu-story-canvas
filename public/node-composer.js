import { NODE_TYPES, PROMPT_LIMIT } from './story.js';
import { $, button, escape, icon, iconButton } from './ui.js';

const idData = id => `data-id="${escape(id)}"`;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const animation = (element, name) => {
  element.classList.add(name);
  element.addEventListener('animationend', () => element.classList.remove(name), { once: true });
};

export const canGenerate = node => node && ['plot', 'agent'].includes(node.kind);

function resultMarkup(rounds, round, index, arriving) {
  if (!round) return '';
  const option = round.options[index];
  return `<div class="composer-output${arriving ? ' is-arriving' : ''}">
    <div class="composer-candidates">${round.options.map((_, n) => button('show-candidate', `方案 ${n + 1}`, {
      style: 'compact quiet', data: idData(n), extra: `aria-pressed="${n === index}"`,
    })).join('')}${rounds.length > 1 ? `<select class="composer-model" id="round-select" aria-label="生成记录">
      ${rounds.map((item, n) => `<option value="${item.id}"${round.id === item.id ? ' selected' : ''}>第 ${n + 1} 轮${item.modelSource ? ` · ${escape(item.modelSource)}` : ''}</option>`).join('')}</select>` : ''}</div>
    <div class="composer-result"><strong>${escape(option.title)}</strong><p>${escape(option.action)}</p>
      <div class="composer-actions">${button('candidate-detail', '查看方案', { style: 'quiet compact' })}
        ${button('branch-candidate', '创建分支', { glyph: 'git-branch', style: 'compact' })}
        ${button('apply-candidate', '应用到节点', { glyph: 'check', style: 'primary compact' })}</div>
    </div></div>`;
}

export class NodeComposer {
  constructor() {
    this.element = $('#node-composer');
    this.nodeId = null;
  }

  render({ node, refs, indirect, models, profile, job, rounds, round, index, arriving, method, guided: hasGuide }) {
    if (!node) {
      this.element.hidden = true;
      this.nodeId = null;
      this.element.replaceChildren();
      return;
    }
    const previous = this.element.contains(document.activeElement) ? document.activeElement : null;
    const changed = this.nodeId !== node.id;
    this.nodeId = node.id;
    const focused = !changed && previous?.id ? { id: previous.id, start: previous.selectionStart, end: previous.selectionEnd } : null;
    const generates = canGenerate(node);
    const busy = job?.nodeId === node.id;
    const type = NODE_TYPES[node.kind];
    const methodStage = generates && method.stages.length > 0;
    const guided = methodStage && hasGuide;
    const stage = guided && method.stages.find(item => item.id === node.methodStage);
    const modelControl = node.kind === 'agent'
      ? `<span class="composer-agent">${icon('sparkle')}${escape(profile?.name || 'Agent')}</span>`
      : `<select class="composer-model" id="node-model" aria-label="生成模型"${busy ? ' disabled' : ''}>
        ${!profile ? `<option value="">${models.length ? '选择模型' : '尚未配置模型'}</option>` : ''}
        ${models.map(item => `<option value="${item.id}"${profile?.id === item.id ? ' selected' : ''}>${escape(item.name || item.model)}</option>`).join('')}</select>`;
    const placeholder = node.kind === 'setting' ? '写入需要下游遵守的人物、关系、规则或已定事实…' : '写入正文或参考素材…';
    const prompt = stage?.question || (guided ? method.start : '描述这一拍的目标、冲突或想发散的方向…');
    this.element.innerHTML = `<div class="composer-top">${icon(type.icon)}
      <input class="composer-title" id="composer-title" value="${escape(node.title)}" aria-label="节点标题" maxlength="100">
      ${generates ? iconButton('edit-node', '编辑节点详情', 'note-pencil', idData(node.id)) : ''}
      ${iconButton('close-composer', '关闭节点编辑', 'x')}</div>
      <div class="composer-refs">
        ${button('references', '添加参考', { glyph: 'plus', style: 'quiet compact', data: idData(node.id) })}
        ${refs.map(ref => `<span class="ref-chip" title="${escape(ref.title)}">${icon(NODE_TYPES[ref.kind].icon)}
          <span>${escape(ref.title)}</span><button type="button" data-action="disconnect" ${idData(ref.id)}
          aria-label="移除参考 ${escape(ref.title)}">${icon('x')}</button></span>`).join('')}
        ${indirect ? `<span class="hint" title="沿已有连线传入的间接参考">另含 ${indirect} 个上游</span>` : ''}
      </div>
      ${guided ? `<div class="composer-method"><select class="composer-model" id="node-stage" aria-label="创作方法阶段"${busy ? ' disabled' : ''}>
        <option value="">${escape(method.name)} · 自选阶段</option>
        ${method.stages.map(item => `<option value="${item.id}"${stage?.id === item.id ? ' selected' : ''}>${escape(item.label)}</option>`).join('')}</select>
        ${button('method-starter', '加入起步问题', { glyph: 'lightbulb', style: 'quiet compact', disabled: busy })}</div>` : ''}
      ${stage ? `<details class="composer-stage-guide"><summary>阶段指引</summary><dl><dt>要写什么</dt><dd>${escape(stage.work)}</dd>
        <dt>写完检查</dt><dd>${escape(stage.check)}</dd></dl></details>` : ''}
      ${methodStage && !guided ? `<div class="composer-method"><span class="field-hint">${escape(method.name)}</span>${button('method-pricing', '解锁阶段指引', { glyph: 'lock-key', style: 'quiet compact' })}</div>` : ''}
      <textarea class="composer-input" id="composer-body" rows="2" maxlength="${generates ? PROMPT_LIMIT : 30000}"
        aria-label="${generates ? '生成要求' : '节点正文'}"
        placeholder="${escape(generates ? prompt : placeholder)}">${escape(generates ? node.prompt : node.script)}</textarea>
      ${generates ? `<div class="composer-toolbar">
        <div class="composer-actions">${modelControl}${(!models.length && node.kind === 'plot') || (!profile && node.kind === 'agent') ? button('user-settings', '用户设置', { style: 'quiet compact' }) : ''}</div>
        ${busy ? `<div class="composer-actions"><span class="composer-state" role="status"><span class="activity-dots"><span></span></span>正在生成</span>
          ${iconButton('cancel-generation', '停止生成', 'stop')}</div>`
          : button('generate', '生成', { glyph: 'arrow-up', style: 'primary compact', disabled: Boolean(job), extra: 'title="Ctrl+Enter 生成"' })}
        </div>${resultMarkup(rounds, round, index, arriving)}` : ''}`;
    this.element.hidden = false;
    this.adjustText();
    if (changed) animation(this.element, 'is-appearing');
    if (focused) {
      const control = $(`#${focused.id}`, this.element);
      if (control && !control.disabled) {
        control.focus({ preventScroll: true });
        if (Number.isInteger(focused.start) && ['INPUT', 'TEXTAREA'].includes(control.tagName)) control.setSelectionRange(focused.start, focused.end);
      }
    }
  }

  adjustText() {
    const input = $('#composer-body', this.element);
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(67, input.scrollHeight + 2), 154)}px`;
  }

  position(board) {
    if (this.element.hidden) return;
    const node = board.nodeRect(this.nodeId);
    if (!node) return;
    const bounds = board.viewport.getBoundingClientRect();
    const top = 69;
    const bottom = $('#emotion-panel').getBoundingClientRect().top - bounds.top - 12;
    const left = node.left - bounds.left;
    const right = node.right - bounds.left;
    const start = node.top - bounds.top;
    const end = node.bottom - bounds.top;
    this.element.style.visibility = right < 0 || left > bounds.width || end < 0 || start > bounds.height ? 'hidden' : '';
    if (this.element.style.visibility) return;
    this.element.style.maxHeight = `${Math.max(135, Math.min(445, bottom - top))}px`;
    const { offsetWidth: width, offsetHeight: height } = this.element;
    const gap = 13;
    const limit = bounds.width - width - 12;
    let x = (left + right - width) / 2;
    let y = end + gap;
    if (y + height > bottom) {
      if (start - height - gap >= top) y = start - height - gap;
      else if (right + width + gap < bounds.width - 8 || left - width - gap > 8) {
        x = right + width + gap < bounds.width - 8 ? right + gap : left - width - gap;
        y = start + (node.height - height) / 2;
      } else {
        y = bottom - end >= start - top ? bottom - height : top;
      }
    }
    this.element.style.left = `${clamp(x, 12, limit)}px`;
    this.element.style.top = `${clamp(y, top, bottom - height)}px`;
  }
}
