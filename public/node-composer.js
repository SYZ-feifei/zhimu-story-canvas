import { IDEA_DIRECTIONS, IDEA_LIMIT, NODE_TYPES, PROMPT_LIMIT } from './story.js';
import { $, button, escape, icon, iconButton } from './ui.js';

const idData = id => `data-id="${escape(id)}"`;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const animation = (element, name) => {
  element.classList.add(name);
  element.addEventListener('animationend', () => element.classList.remove(name), { once: true });
};

export const canGenerate = node => node && ['plot', 'agent'].includes(node.kind);

function ideaDirectionPicker(active, busy) {
  return `<div class="idea-options"><div class="idea-directions" role="tablist" aria-label="发散方向">
    ${Object.entries(IDEA_DIRECTIONS).map(([id, direction]) => `<button type="button" role="tab" id="idea-tab-${id}"
      data-action="idea-direction" data-id="${id}" aria-controls="idea-panel-${id}" aria-selected="${active === id}"
      tabindex="${active === id ? 0 : -1}"${busy ? ' disabled' : ''}>${escape(direction.label)}</button>`).join('')}
    </div>${Object.entries(IDEA_DIRECTIONS).map(([id, direction]) => `<p class="idea-direction-hint" role="tabpanel" id="idea-panel-${id}"
      aria-labelledby="idea-tab-${id}"${active === id ? '' : ' hidden'}>${escape(direction.guidance)}</p>`).join('')}
    <label class="idea-brief"><span>补充要求</span><input class="composer-model" id="idea-prompt" type="text" maxlength="${PROMPT_LIMIT}"
      placeholder="例如 保留人物关系，试试不同结局"></label></div>`;
}

function ideaCountPicker(count, busy) {
  return `<label class="idea-count"><span>数量</span><select class="composer-model" id="idea-count"${busy ? ' disabled' : ''}>
    ${Array.from({ length: IDEA_LIMIT }, (_, index) => `<option value="${index + 1}"${index + 1 === count ? ' selected' : ''}>${index + 1} 条</option>`).join('')}
    </select></label>`;
}

function ideaChildren(children) {
  if (!children.length) return '';
  return `<div class="composer-output idea-children"><div class="idea-children-header"><strong>发散结果 <span>${children.length}</span></strong>
    ${button('view-idea-branches', '查看分支', { glyph: 'corners-out', style: 'quiet compact' })}</div>
    <div class="idea-child-list">${children.map(child => `<button class="idea-child" type="button" data-action="reveal-node" ${idData(child.id)}>
      ${icon('lightbulb')}<span>${escape(child.title)}</span>${icon('arrow-up-right')}</button>`).join('')}</div></div>`;
}

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

  render({ node, refs, indirect, models, profile, job, rounds, round, index, arriving, method, guided: hasGuide, children }) {
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
    const isIdea = node.kind === 'idea';
    const hasModel = generates || isIdea;
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
    const placeholder = isIdea ? '写下一句灵感、一个人物或一段剧情，也可直接交给模型发散…'
      : node.kind === 'setting' ? '写入需要下游遵守的人物、关系、规则或已定事实…' : '写入正文或参考素材…';
    const prompt = stage?.question || (guided ? method.start : '描述这一拍的目标、冲突或想发散的方向…');
    this.element.innerHTML = `<div class="composer-top">${icon(type.icon)}
      <input class="composer-title" id="composer-title" value="${escape(node.title)}" aria-label="节点标题" maxlength="100">
      ${generates ? iconButton('edit-node', '编辑节点详情', 'note-pencil', idData(node.id)) : ''}
      ${isIdea ? iconButton('develop-idea', '展开为剧情节点', 'git-branch', idData(node.id)) : ''}
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
        aria-label="${isIdea ? '点子正文' : generates ? '生成要求' : '节点正文'}"
        placeholder="${escape(generates ? prompt : placeholder)}">${escape(generates ? node.prompt : node.script)}</textarea>
      ${isIdea ? ideaDirectionPicker(node.ideaDirection, busy) : ''}
      ${hasModel ? `<div class="composer-toolbar${isIdea ? ' idea-toolbar' : ''}">
        <div class="composer-actions">${modelControl}${(!models.length || (!profile && node.kind === 'agent')) ? button('user-settings', '用户设置', { style: 'quiet compact' }) : ''}
          ${isIdea ? ideaCountPicker(node.ideaCount, busy) : ''}</div>
        ${busy ? `<div class="composer-actions"><span class="composer-state" role="status"><span class="activity-dots"><span></span></span>${isIdea ? '正在发散' : '正在生成'}</span>
          ${iconButton('cancel-generation', '停止生成', 'stop')}</div>`
          : button(isIdea ? 'brainstorm' : 'generate', isIdea ? '发散点子' : '生成', { glyph: isIdea ? 'sparkle' : 'arrow-up', style: 'primary compact',
            disabled: Boolean(job), extra: `title="Ctrl+Enter ${isIdea ? '发散点子' : '生成'}"` })}
        </div>${isIdea ? ideaChildren(children) : resultMarkup(rounds, round, index, arriving)}` : ''}`;
    if (isIdea) $('#idea-prompt', this.element).value = node.prompt;
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
