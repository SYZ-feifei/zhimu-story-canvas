import { STORY_METHODS, methodFor } from './methods.js';
import { button, escape, icon } from './ui.js';

export function methodGuide(id, { guide, preview, used = new Set(), current } = {}) {
  const method = methodFor(id, guide);
  const locked = Boolean(method.stages.length && !guide?.[method.id]);
  const upcoming = current || method.stages.find(stage => !used.has(stage.id))?.id;
  return `<h3>${escape(method.name)}</h3>
    ${method.author ? `<p class="method-author">${escape(method.author)}</p>` : ''}
    <p>${escape(method.approach)}</p>
    ${preview && method.stages.length ? '<p class="field-hint">本机作者预览</p>' : ''}
    <div class="method-start">${icon('lightbulb')}<div><strong>从这里开始</strong><p>${escape(method.start)}</p></div></div>
    ${locked ? '<p class="field-hint">可试看第一阶段。解锁后可将完整指引应用到节点。</p>' : ''}
    ${method.stages.length ? `<ol class="method-stages">${method.stages.map((stage, index) => {
      const content = locked ? (index === 0 ? method.sample : null) : stage;
      const marker = used.has(stage.id) ? '已有内容' : stage.id === upcoming && !locked ? '当前建议' : '';
      return `<li${stage.id === upcoming && !locked ? ' class="is-current"' : ''}>
        <div class="method-stage-title"><strong>${escape(stage.label)}</strong>${marker ? `<small>${marker}</small>` : ''}</div>
        ${content ? `<p>${escape(content.question)}</p><dl>
          <dt>要写什么</dt><dd>${escape(content.work)}</dd><dt>写完检查</dt><dd>${escape(content.check)}</dd></dl>` : ''}
      </li>`;
    }).join('')}</ol>` : ''}`;
}

export function methodPicker(id, first, options) {
  const ordered = [...STORY_METHODS.slice(1), STORY_METHODS[0]];
  const { guide, unlocked } = options;
  return `<form data-form="method"><div class="method-layout">
    <fieldset class="method-choices" aria-label="选择创作方法">${ordered.map(method =>
      `<label class="method-choice"><input type="radio" name="method" value="${method.id}"${method.id === id ? ' checked' : ''}>
        <span><strong>${escape(method.name)}</strong><small>${escape(method.fit)}</small></span>
        ${method.stages.length && !guide ? icon('lock-key') : ''}</label>`).join('')}</fieldset>
    <section class="method-guide" id="method-guide" aria-label="方法简介">${methodGuide(id, options)}</section>
  </div><div class="modal-footer method-footer">${button('method-pricing', unlocked ? '查看恢复码' : '创作方法礼包', { glyph: unlocked ? 'key' : 'gift', style: 'quiet compact' })}
    <div>${button('close-modal', first ? '跳过' : '取消', { style: 'quiet' })}
      <button id="apply-method" type="submit" class="button primary">${!guide && id !== 'free' ? '解锁后应用' : '应用方法'}</button></div></div></form>`;
}
