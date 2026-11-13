import { DECISION_LIMIT, MAX_SCENES, MIN_SCENES, SYNOPSIS_LIMIT, cleanText } from './story.js';
import { $, button, escape, field, icon } from './ui.js';

const operations = {
  question: { title: '接着写', pending: '正在找一个值得决定的问题', verb: '给我一个问题' },
  synopsis: { title: '整理为故事梗概', pending: '正在整理选中的路线', verb: '生成梗概' },
  scenes: { title: '拆成分场', pending: '正在拆成分场', verb: '生成分场' },
  draft: { title: '写成场景正文', pending: '正在写这一场', verb: '生成正文' },
};

export function createDevelopment({ modal, show, close, api, profiles, openSettings, read, isCurrent, apply, notice }) {
  let session;

  function stop() {
    session?.controller?.abort();
    session = null;
  }

  function active(state) {
    return session === state && modal.open && Boolean($('#development-panel', modal));
  }

  function valid(state) {
    if (isCurrent(state)) return true;
    state.stale = true;
    render(state);
    return false;
  }

  function render(state, moveFocus = false) {
    const { operation, sources, result, pending, stale, error } = state;
    const mode = operations[operation];
    const profilesAvailable = profiles();
    const busy = Boolean(state.controller);
    const sourceLabel = sources.length === 1 ? sources[0].title : `主线 · ${sources.length} 个剧情节点`;
    const models = field('modelId', '使用模型', state.modelId, {
      type: 'select', required: true, choices: [['', '选择模型'], ...profilesAvailable.map(item => [item.id, item.name || item.model])],
    });
    let body;
    if (stale) {
      body = `<p class="modal-error" role="alert">素材或主线顺序已改动。重新读取后可以继续。</p>
        <div class="modal-footer">${button('development-restart', '读取最新素材', { glyph: 'arrow-clockwise', style: 'primary' })}</div>`;
    } else if (busy) {
      body = `<p class="activity-status" role="status"><span class="activity-dots"><span></span><span></span><span></span></span>
        ${escape(pending)}</p><div class="modal-footer">${button('development-stop', '停止', { glyph: 'stop' })}</div>`;
    } else if (result && operation === 'question') {
      body = decisionMarkup(state);
    } else if (result) {
      body = resultMarkup(state);
    } else {
      const canRequest = operation === 'scenes' ? Boolean(sources[0].script)
        : state.hasMaterial || (['question', 'draft'].includes(operation) && Boolean(state.prompt));
      const count = operation === 'scenes' ? field('count', '分场数量', String(state.count), { type: 'select',
        choices: Array.from({ length: MAX_SCENES - MIN_SCENES + 1 }, (_, index) => {
          const count = String(MIN_SCENES + index);
          return [count, `${count} 场`];
        }),
      }) : '';
      const prompt = {
        question: '先确定一个会改变剧情的人物选择。',
        synopsis: '梗概会写到结尾。你可以修改后再存到画布。',
        scenes: '每场包括要发生的事、前因和场尾变化。',
        draft: '生成本场的动作与对白，应用前可编辑。',
      }[operation];
      body = `<p class="development-intro">${escape(canRequest ? prompt : operation === 'scenes' ? '先在梗概节点写下故事内容。' :
        '先在节点里写一点故事，或连入一个有内容的参考。')}</p>
        <form data-form="development-generate">${profilesAvailable.length ? `<div class="${count ? 'modal-grid' : ''}">${models}${count}</div>` :
        '<p class="field-hint">在用户设置连接一个模型后即可生成。</p>'}
        <div class="modal-footer">${profilesAvailable.length ? `<button type="submit" class="button primary"${canRequest ? '' : ' disabled'}>${mode.verb}</button>`
        : button('development-models', '用户设置', { glyph: 'gear-six', style: 'primary' })}</div></form>`;
    }
    show(mode.title, `<section id="development-panel" aria-label="${mode.title}">
      <div class="development-source">${icon(sources.length > 1 ? 'list-numbers' : 'git-branch')}<span>${escape(sourceLabel)}</span></div>
      ${error && !stale ? `<p class="modal-error" role="alert">${escape(error)}</p>` : ''}${body}</section>`, true);
    if (moveFocus) $('[data-development-focus]', modal)?.focus({ preventScroll: true });
  }

  function open(operation, ids, mainline = false) {
    stop();
    const context = read(ids, mainline);
    if (!context?.sources.length) return;
    const state = { ...context, operation, mainline, modelId: context.model?.id || '',
      count: context.snapshot.format === '短片' ? 4 : context.snapshot.format === '短剧' ? 5 : 8 };
    session = state;
    render(state);
    if (operation === 'question' && state.modelId && (state.hasMaterial || state.prompt)) void request(state, operation);
  }

  async function request(state, operation, details = {}) {
    if (!active(state) || state.controller || !valid(state)) return;
    if (!profiles().some(profile => profile.id === state.modelId)) {
      state.modelId = '';
      state.error = '请选一个可用的模型后再试。';
      render(state);
      return;
    }
    const controller = new AbortController();
    state.controller = controller;
    state.pending = operation === 'answer' ? '正在把你的决定接成下一场' : operations[operation].pending;
    state.error = '';
    render(state);
    try {
      const response = await api('/api/ai/develop', { profile: { id: state.modelId }, project: state.snapshot,
        operation, sourceIds: state.ids, ...details }, controller.signal);
      const result = await response.json();
      if (!active(state) || state.controller !== controller) return;
      state.controller = null;
      if (!valid(state)) return;
      if (operation === 'answer') state.scene = result.scene;
      else state.result = result;
      render(state, true);
    } catch (error) {
      if (!active(state) || state.controller !== controller) return;
      state.controller = null;
      state.error = controller.signal.aborted ? '' : error.message;
      render(state);
    }
  }

  function decide(state, answer, index) {
    const choice = state.result?.choices[index];
    if (!choice && !answer) return;
    if (answer) {
      state.answer = answer;
      void request(state, 'answer', { question: state.result.question, answer });
      return;
    }
    state.scene = {
      title: choice.title,
      sceneHeading: choice.sceneHeading,
      action: `${choice.action}\n${choice.response}`,
      reason: choice.reason,
      consequence: choice.consequence,
    };
    render(state, true);
  }

  function commit(state, result, placement) {
    if (!valid(state)) return;
    const message = apply(state, result, placement, profiles().find(profile => profile.id === state.modelId));
    if (!message) return;
    stop();
    close();
    notice(message);
  }

  modal.addEventListener('submit', event => {
    const form = event.target;
    const type = form.dataset.form;
    if (!type?.startsWith('development-') || !session || !active(session)) return;
    event.preventDefault();
    const state = session;
    const data = new FormData(form);
    if (type === 'development-generate') {
      state.modelId = data.get('modelId');
      if (state.operation === 'scenes') state.count = Number(data.get('count'));
      void request(state, state.operation, state.operation === 'scenes' ? { count: state.count } : {});
    } else if (type === 'development-answer') {
      const answer = cleanText(data.get('answer'), DECISION_LIMIT);
      if (answer) decide(state, answer, -1);
      else $('#field-answer', form).focus();
    } else if (type === 'development-save') {
      const result = state.scene ? { ...state.scene } : { ...state.result };
      for (const name of ['title', 'body', 'script', 'sceneHeading', 'action', 'reason', 'consequence']) {
        if (data.has(name)) result[name] = String(data.get(name)).trim();
      }
      const required = state.scene ? ['title', 'action', 'reason', 'consequence']
        : state.operation === 'synopsis' ? ['title', 'body'] : state.operation === 'draft' ? ['script'] : [];
      if (required.some(name => !result[name])) {
        const issue = $('.development-save-error', form);
        issue.textContent = '请把必填内容写完整。';
        issue.hidden = false;
        return;
      }
      commit(state, result, data.get('placement'));
    }
  });

  modal.addEventListener('close', () => { if (!modal.open) stop(); });

  function action(name, control) {
    if (!name.startsWith('development-')) return false;
    const state = session;
    if (!state || !active(state)) return true;
    if (name === 'development-models') {
      stop();
      openSettings();
    } else if (name === 'development-stop') state.controller?.abort();
    else if (name === 'development-restart') open(state.operation, state.ids, state.mainline);
    else if (name === 'development-choice') decide(state, '', Number(control.dataset.id));
    else if (name === 'development-new-question') void request(state, 'question', { previousQuestion: state.result.question });
    else if (name === 'development-back') {
      state.scene = null;
      if (state.operation !== 'question') state.result = null;
      state.error = '';
      render(state);
    }
    return true;
  }

  return { open, stop, action };
}

function decisionMarkup({ scene, result, answer }) {
  if (scene) return resultMarkup({ operation: 'question', scene });
  return `<h3 class="development-question" tabindex="-1" data-development-focus>${escape(result.question)}</h3>
    <div class="development-choices">${result.choices.map((choice, index) => `<button type="button" class="development-choice"
      data-action="development-choice" data-id="${index}"><span class="development-choice-text"><strong>${escape(choice.title)}</strong>
      <span>${escape(choice.action)}</span><span class="development-response">${escape(choice.response)}</span>
      <span class="development-outcome">场尾 · ${escape(choice.consequence)}</span></span>${icon('arrow-bend-down-right')}</button>`).join('')}</div>
    <form data-form="development-answer" class="development-answer">
      ${field('answer', '我有别的写法', answer, { type: 'textarea', max: DECISION_LIMIT, required: true, placeholder: '写下你想让人物怎么做' })}
      <div class="development-answer-actions">
        ${button('development-new-question', '换个问题', { glyph: 'arrow-clockwise', style: 'quiet' })}
        <button type="submit" class="button secondary">${icon('arrow-right')}用我的选择继续</button>
      </div>
    </form>`;
}

function resultMarkup({ operation, result, scene, snapshot }) {
  let body, label;
  if (scene) {
    body = `${field('title', '下一场标题', scene.title, { required: true })}
      ${field('sceneHeading', '内外景、地点与时段', scene.sceneHeading, { max: 140 })}
      ${field('action', '人物行动与回应', scene.action, { type: 'textarea', required: true, max: 2400 })}
      ${field('reason', '前因', scene.reason, { type: 'textarea', required: true, max: 1400 })}
      ${field('consequence', '场尾变化', scene.consequence, { type: 'textarea', required: true, max: 1400 })}`;
    label = '接出剧情节点';
  } else if (operation === 'synopsis') {
    body = `${field('title', '梗概标题', result.title, { required: true })}
      ${field('body', '故事梗概', result.body, { type: 'textarea', max: SYNOPSIS_LIMIT, required: true, rows: 9 })}`;
    label = '建立梗概节点';
  } else if (operation === 'scenes') {
    const placement = [['canvas', '只建立画布节点'], ['append', '按顺序加入主线末尾']];
    if (snapshot.mainline.length) placement.push(['replace', '把这组分场设为主线']);
    body = `<ol class="development-scenes">${result.scenes.map(scene => `<li><strong>${escape(scene.title)}</strong>
      <span class="field-hint">${escape(scene.sceneHeading)}</span><p>${escape(scene.action)}</p>
      <p class="field-hint">前因 · ${escape(scene.reason)}</p>
      <p class="development-outcome">场尾 · ${escape(scene.consequence)}</p></li>`).join('')}</ol>
      ${field('placement', '采纳方式', 'canvas', { type: 'select', choices: placement })}`;
    label = `建立 ${result.scenes.length} 张分场卡`;
  } else {
    body = field('script', '场景正文草稿', result.script, { type: 'textarea', max: 30000, rows: 12, required: true });
    label = '应用到场景正文';
  }
  return `<form data-form="development-save">
    <p class="development-draft" tabindex="-1" data-development-focus>${scene ? '下一场草稿' : '待采纳草稿'}</p>
    ${body}<p class="modal-error development-save-error" role="alert" hidden></p><div class="modal-footer">
      ${button('development-back', scene ? '回到人物选择' : '返回生成设置', { style: 'quiet' })}
      <button type="submit" class="button primary">${escape(label)}</button></div></form>`;
}
