import { cleanEffort, effortChoices, effortLabel, validEffort } from './reasoning.js';
import { AGENT_HISTORY_LIMIT, AGENT_REFERENCE_LIMIT, AGENT_REPLY_LIMIT, NODE_TYPES, PROMPT_LIMIT, cleanText, recentChat } from './story.js';
import { $, button, escape, icon } from './ui.js';

export function createAgentChat({ api, storageKey, profiles, selectedIds, readProject, openSettings, saveNote, notice, onLayout }) {
  const panel = $('#agent-panel');
  const toggle = $('#agent-toggle');
  const model = $('#agent-model');
  const effort = $('#agent-effort');
  const messages = $('#agent-messages');
  const references = $('#agent-references');
  const form = $('#agent-form');
  const input = $('#agent-input');
  const sendButton = $('#agent-send');
  const stopButton = $('#agent-stop');
  const addButton = $('#agent-add-selection');
  const errorLine = $('#agent-error');
  const cached = new Map();
  let projectId, state;
  let job = null;
  let error = '';

  input.maxLength = PROMPT_LIMIT;

  function load(id) {
    try {
      const raw = JSON.parse(localStorage.getItem(`${storageKey}.${id}`) || '{}');
      const messages = [];
      const history = Array.isArray(raw.messages) ? raw.messages.slice(-AGENT_HISTORY_LIMIT) : [];
      for (let index = 0; index + 1 < history.length; index += 2) {
        const [question, answer] = history.slice(index, index + 2);
        const userText = cleanText(question?.text, PROMPT_LIMIT);
        const reply = cleanText(answer?.text, AGENT_REPLY_LIMIT);
        if (question?.role !== 'user' || answer?.role !== 'assistant' || !userText || !reply) continue;
        messages.push({ role: 'user', text: userText, refs: readRefs(question.refs) },
          { role: 'assistant', text: reply, refs: readRefs(answer.refs), modelId: cleanText(answer.modelId, 90),
            model: cleanText(answer.model, 180), effort: cleanEffort(answer.effort) });
      }
      return { messages: recentChat(messages), refs: readRefs(raw.refs), draft: typeof raw.draft === 'string' ? raw.draft.slice(0, PROMPT_LIMIT) : '',
        modelId: cleanText(raw.modelId, 90), effort: cleanEffort(raw.effort) };
    } catch { return { messages: [], refs: [], draft: '', modelId: '', effort: '' }; }
  }

  function readRefs(raw) {
    return Array.isArray(raw) ? [...new Set(raw.filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,90}$/.test(id)))]
      .slice(0, AGENT_REFERENCE_LIMIT) : [];
  }

  function persist() {
    if (!projectId || !state) return;
    try { localStorage.setItem(`${storageKey}.${projectId}`, JSON.stringify(state)); }
    catch { notice('本机存储空间不足，Agent 对话暂留在当前窗口。'); }
  }

  function setVisible(open) {
    const changed = open !== !panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (changed) onLayout(open);
    if (open) {
      update();
      renderMessages(true);
      input.focus({ preventScroll: true });
    } else {
      if (changed) {
        persist();
        toggle.focus({ preventScroll: true });
      }
    }
  }

  function leave() {
    job?.controller.abort();
    job = null;
    persist();
    state = null;
    projectId = null;
    error = '';
    toggle.classList.remove('is-working');
    setVisible(false);
  }

  function enter(id) {
    if (projectId) leave();
    projectId = id;
    if (!cached.has(id)) cached.set(id, load(id));
    state = cached.get(id);
    input.value = state.draft;
    update();
  }

  function forget(id) {
    cached.delete(id);
    try { localStorage.removeItem(`${storageKey}.${id}`); } catch { /* The project itself is managed separately. */ }
  }

  function update() {
    if (!state) return;
    toggle.classList.toggle('is-working', Boolean(job));
    if (panel.hidden) return;
    const available = profiles();
    const nextModel = state.modelId || available[0]?.id || '';
    const selected = available.find(profile => profile.id === nextModel);
    const known = Boolean(selected);
    const options = `${known ? '' : `<option value="">${available.length ? '请选择模型' : '先在用户设置接入模型'}</option>`}
      ${available.map(profile => `<option value="${escape(profile.id)}">${escape(profile.name || profile.model)}</option>`).join('')}`;
    if (model.dataset.options !== options) { model.innerHTML = options; model.dataset.options = options; }
    model.value = known ? nextModel : '';
    model.disabled = Boolean(job) || !available.length;
    const levels = effortChoices(selected);
    const levelOptions = levels.map(([id, label]) => `<option value="${escape(id)}">${escape(label)}</option>`).join('');
    if (effort.dataset.options !== levelOptions) { effort.innerHTML = levelOptions; effort.dataset.options = levelOptions; }
    effort.closest('label').hidden = !levels.length;
    effort.value = validEffort(selected, state.effort);
    effort.disabled = Boolean(job);
    const project = readProject(false);
    const byId = new Map((project?.nodes || []).map(node => [node.id, node]));
    const attached = state.refs.map(id => byId.get(id)).filter(Boolean);
    const chips = attached.map(node => `<span class="ref-chip"><button type="button" class="ref-link" data-action="reveal-node"
        data-id="${escape(node.id)}" title="定位参考 ${escape(node.title)}">${icon(NODE_TYPES[node.kind].icon)}<span>${escape(node.title)}</span></button>
        <button type="button" data-action="agent-detach" data-id="${escape(node.id)}" aria-label="移除参考 ${escape(node.title)}">${icon('x')}</button></span>`).join('');
    if (references.dataset.chips !== chips) { references.innerHTML = chips; references.dataset.chips = chips; }
    const attachedIds = new Set(attached.map(node => node.id));
    addButton.disabled = !selectedIds().some(id => byId.has(id) && !attachedIds.has(id));
    syncSend();
  }

  function syncSend() {
    sendButton.hidden = Boolean(job);
    sendButton.disabled = !input.value.trim();
    stopButton.hidden = !job;
    errorLine.hidden = !error;
    if (errorLine.textContent !== error) errorLine.textContent = error;
  }

  function renderMessages(scrollToEnd) {
    if (!state || panel.hidden) return;
    const transcript = [...state.messages, ...(job ? [job.question] : [])];
    messages.innerHTML = transcript.map((message, index) => {
      const user = message.role === 'user';
      return `<article class="agent-message${user ? ' is-user' : ''}">
        <div class="agent-message-meta"><strong>${user ? '你' : 'Agent'}</strong>
          ${user ? '' : `<span>${escape(message.model)}</span>${message.effort ? `<span>· ${escape(effortLabel(message.effort))}</span>` : ''}`}</div>
        <p class="agent-message-text">${escape(message.text)}</p>
        ${user ? '' : button('agent-save-note', '存为点子', { glyph: 'lightbulb', style: 'quiet compact', data: `data-id="${index}"` })}</article>`;
    }).join('') || `<div class="agent-empty">${icon('chat-circle-dots')}<strong>从一个创作问题开始</strong>
      <span>可引用画布里的点子、人物设定和剧情。</span></div>`;
    if (job) messages.insertAdjacentHTML('beforeend', `<p class="activity-status"><span class="activity-dots"><span></span></span>Agent 正在回复</p>`);
    if (scrollToEnd) messages.scrollTop = messages.scrollHeight;
  }

  function attach(ids) {
    if (!state) return;
    setVisible(true);
    const byId = new Set((readProject(false)?.nodes || []).map(node => node.id));
    const next = [...new Set([...state.refs.filter(id => byId.has(id)), ...ids.filter(id => byId.has(id))])];
    if (next.length > AGENT_REFERENCE_LIMIT) notice(`一次可引用 ${AGENT_REFERENCE_LIMIT} 个画布节点。`);
    state.refs = next.slice(0, AGENT_REFERENCE_LIMIT);
    persist();
    update();
  }

  async function send() {
    if (!state || job) return;
    const text = cleanText(input.value, PROMPT_LIMIT);
    if (!text) return;
    const profile = profiles().find(item => item.id === model.value);
    if (!profile) {
      error = profiles().length ? '请先选择这轮对话使用的模型。' : '请先在用户设置接入模型。';
      syncSend();
      if (!model.disabled) model.focus();
      return;
    }
    const project = readProject(true);
    if (project?.id !== projectId) return;
    const ids = new Set(project.nodes.map(node => node.id));
    const refs = state.refs.filter(id => ids.has(id));
    const controller = new AbortController();
    const question = { role: 'user', text, refs };
    const current = { controller, question };
    job = current;
    state.modelId = profile.id;
    const level = validEffort(profile, state.effort);
    error = '';
    persist();
    update();
    renderMessages(true);
    try {
      const transcript = [...state.messages, question].map(({ role, text }) => ({ role, text }));
      const response = await api('/api/ai/chat', { profile: { id: profile.id }, project, reasoningEffort: level,
        referenceIds: refs, messages: transcript }, controller.signal);
      const { reply } = await response.json();
      if (job !== current || controller.signal.aborted) return;
      const textReply = cleanText(reply, AGENT_REPLY_LIMIT);
      if (!textReply) throw new Error('模型没有返回可用回复。请重试。');
      state.messages = recentChat([...state.messages, question, { role: 'assistant', text: textReply, refs,
        modelId: profile.id, model: profile.name || profile.model, effort: level }]);
      if (cleanText(input.value, PROMPT_LIMIT) === text) { input.value = ''; state.draft = ''; }
      persist();
    } catch (issue) {
      if (job === current && !controller.signal.aborted) error = issue.message;
    } finally {
      if (job === current) {
        job = null;
        update();
        renderMessages(true);
      }
    }
  }

  input.addEventListener('input', () => {
    if (!state) return;
    state.draft = input.value;
    if (error) error = '';
    syncSend();
  });
  input.addEventListener('blur', persist);
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    form.requestSubmit();
  });
  form.addEventListener('submit', event => { event.preventDefault(); void send(); });
  model.addEventListener('change', () => {
    if (!state || job) return;
    state.modelId = model.value;
    state.effort = '';
    error = '';
    persist();
    update();
  });
  effort.addEventListener('change', () => {
    if (!state || job) return;
    state.effort = validEffort(profiles().find(profile => profile.id === model.value), effort.value);
    persist();
  });

  function action(name, control) {
    switch (name) {
      case 'agent-toggle': setVisible(panel.hidden); return true;
      case 'agent-close': setVisible(false); return true;
      case 'agent-settings': openSettings(); return true;
      case 'agent-add-selection': attach(selectedIds()); return true;
      case 'agent-stop':
        if (job) { job.controller.abort(); job = null; update(); renderMessages(true); }
        return true;
      case 'agent-detach':
        if (state) { state.refs = state.refs.filter(id => id !== control.dataset.id); persist(); update(); }
        return true;
      case 'agent-save-note': {
        const message = state?.messages[Number(control.dataset.id)];
        if (message?.role === 'assistant') saveNote(message);
        return true;
      }
      default: return false;
    }
  }

  return { action, attach, enter, leave, forget, persist, update,
    handleEscape: target => {
      if (panel.hidden || !panel.contains(target)) return false;
      setVisible(false);
      return true;
    } };
}
