import { PROVIDERS, cleanText, newId } from './story.js';
import { $, button, escape, field, icon } from './ui.js';

const idData = id => `data-id="${escape(id)}"`;
const description = profile => `${PROVIDERS[profile.provider].label} · ${profile.model}`;

function legacyModels(key) {
  try {
    const { profiles, active } = JSON.parse(localStorage.getItem(key) || '{}');
    return {
      active: cleanText(active, 90),
      profiles: Array.isArray(profiles) ? profiles.filter(profile => profile && /^[a-zA-Z0-9_-]{1,90}$/.test(profile.id) &&
        !['env', 'agent'].includes(profile.id) && Object.hasOwn(PROVIDERS, profile.provider)) : [],
    };
  } catch { return { active: '', profiles: [] }; }
}

export function createModelUI({ modal, show, api, legacyKey, notice, onChange }) {
  const legacy = legacyModels(legacyKey);
  let profiles = [];
  let connections = [];
  let directPending = '';
  let environment = null;
  let persistent = true;
  let loaded = false;
  let issue = '';
  let returnTo;
  let busy = false;

  const directProfiles = () => connections.filter(item => item.connected).flatMap(item => {
    const preferred = item.models.find(model => model.id === item.model);
    const models = preferred ? [preferred, ...item.models.filter(model => model !== preferred)] : item.models;
    return models.map(model => ({ id: model.profileId, name: `${item.name} · ${model.name}`,
      provider: item.id === 'chatgpt' ? 'openai' : 'gemini', mode: item.id === 'chatgpt' ? 'responses' : 'google-oauth', model: model.id }));
  });
  const ordinary = () => [...directProfiles(), ...profiles.filter(profile => profile.id !== 'agent'), ...(environment ? [environment] : [])];
  const defaultProfile = () => ordinary().find(profile => profile.id === legacy.active) || ordinary()[0] || null;
  const agent = () => profiles.find(profile => profile.id === 'agent');
  const agentProfiles = (models = ordinary()) => agent() ? [agent(), ...models] : models;
  const forNode = (node, models = ordinary()) => {
    const choices = node?.kind === 'agent' ? agentProfiles(models) : models;
    if (node?.modelId) return choices.find(profile => profile.id === node.modelId);
    return (node?.kind === 'agent' && agent()) || choices.find(profile => profile.id === legacy.active) || choices[0];
  };

  async function refresh() {
    const results = await Promise.allSettled([
      api('/api/model-settings').then(response => response.json()),
      api('/api/config').then(response => response.json()),
      api('/api/direct-models').then(response => response.json()),
    ]);
    if (results[0].status === 'fulfilled') ({ profiles, persistent } = results[0].value);
    issue = results[0].status === 'rejected' ? results[0].reason.message : '';
    environment = results[1].status === 'fulfilled' ? results[1].value.profile : null;
    if (results[2].status === 'fulfilled') ({ connections } = results[2].value);
    loaded = true;
    onChange();
    if (modal.open && $('#user-settings-panel', modal)) drawList();
  }

  function modelRow(profile, inherited = false) {
    return `<div class="list-row">${icon(profile.id === 'agent' ? 'sparkle' : 'cpu')}<span class="list-label">
      <strong>${escape(profile.name || profile.model)}</strong><small>${escape(description(profile))}${inherited ? ' · 待重新保存' : ''}</small></span>
      ${profile.id === 'env' ? '<small class="hint">环境配置</small>' : button('edit-model', '编辑', { style: 'quiet compact', data: idData(profile.id) })}</div>`;
  }

  function drawList() {
    const inherited = legacy.profiles.filter(item => !profiles.some(profile => profile.id === item.id));
    const regular = [...ordinary().filter(profile => !profile.id.startsWith('signin-')).map(profile => modelRow(profile)),
      ...inherited.map(profile => modelRow(profile, true))].join('');
    show('用户设置', `<div id="user-settings-panel">
      <section class="settings-section">
        <div class="section-label"><h3>账号直连</h3></div>
        <div class="settings-list">${connections.map(directRow).join('') || '<p class="muted">桌面版支持在系统浏览器授权模型账号。</p>'}</div>
      </section>
      <section class="settings-section">
        <div class="section-label"><h3>API 模型</h3>${button('add-model', '添加模型', { glyph: 'plus', style: 'quiet compact' })}</div>
        ${issue ? `<p class="modal-error" role="alert">${escape(issue)}</p>` : ''}
        <div class="settings-list">${regular || `<p class="muted">${loaded ? '添加模型后，可在剧情节点中选择。' : '正在读取本机设置…'}</p>`}</div>
      </section>
      <section class="settings-section">
        <div class="section-label"><h3>Agent 接口</h3>${agent() ? '' : button('edit-model', '配置 Agent', { glyph: 'plus', style: 'quiet compact', data: idData('agent') })}</div>
        ${agent() ? modelRow(agent()) : '<p class="muted">可为 Agent 配置独立接口，也可选用已经连接的模型。</p>'}
      </section>
      ${loaded && !persistent ? '<p class="field-hint">开发预览的接口设置在预览服务重启后清空。</p>' : ''}
      ${returnTo ? `<div class="modal-footer">${button('model-return', '返回导入剧本', { glyph: 'arrow-left' })}</div>` : ''}</div>`);
  }

  function directRow(connection) {
    const { id, ready, connected, setup, pending } = connection;
    const waiting = pending || directPending === id;
    const description = connected ? connection.models.find(model => model.id === connection.model)?.name || connection.model
      : !ready ? '收费发行需开通 OpenAI 合作接入'
        : id === 'chatgpt' ? '使用符合资格的 ChatGPT 账号计划' : '授权 Google Cloud 项目中的 Gemini API';
    const action = waiting ? button('direct-cancel', '取消等待', { style: 'quiet compact', data: idData(id) })
      : connected ? button('direct-manage', '管理', { style: 'quiet compact', data: idData(id) })
        : ready ? button(setup ? 'direct-setup' : 'direct-connect', id === 'chatgpt' ? 'Continue with ChatGPT' : setup ? '配置 Google OAuth' : '连接 Google 账号',
          { style: 'compact', data: idData(id) }) : '';
    return `<div class="list-row">${icon(id === 'chatgpt' ? 'open-ai-logo' : 'google-logo')}<span class="list-label">
      <strong>${escape(connection.name)}</strong><small>${waiting ? '请在系统浏览器完成授权…' : escape(description)}</small></span>${action}</div>`;
  }

  function googleSetup() {
    show('用户设置 / Gemini 账号', `<form data-form="google-oauth">
      <p class="field-hint">使用已启用 Gemini API 的 Google Cloud 项目。选择该项目的 OAuth 桌面客户端 JSON，再在浏览器授权。</p>
      ${field('project', 'Cloud 项目 ID', '', { max: 80, placeholder: '留空时使用 JSON 中的 project_id' })}
      <div class="field"><label for="google-oauth-file">OAuth 桌面客户端 JSON</label><input type="file" id="google-oauth-file" accept=".json,application/json" required></div>
      <p class="modal-error" role="alert" hidden></p><div class="modal-footer">${button('model-back', '返回设置', { style: 'quiet' })}
      <button type="submit" class="button primary">打开浏览器授权</button></div></form>`);
  }

  function manageDirect(id) {
    const connection = connections.find(item => item.id === id);
    if (!connection?.connected) { drawList(); return; }
    show(`用户设置 / ${connection.name}`, `<form data-form="direct-model" ${idData(id)}>
      ${connection.project ? `<p class="field-hint">Cloud 项目 ${escape(connection.project)}</p>` : ''}
      ${field('account-model', '默认模型', connection.model, { type: 'select', choices: connection.models.map(model => [model.id, model.name]) })}
      <div class="modal-footer">${button('direct-disconnect', '断开账号', { style: 'danger quiet', data: idData(id) })}
        ${button('direct-refresh', '刷新模型列表', { style: 'quiet', data: idData(id) })}
        ${button('model-back', '返回设置', { style: 'quiet' })}<button type="submit" class="button primary">使用模型</button></div></form>`);
  }

  async function connectDirect(id, configuration = {}) {
    if (directPending) return;
    directPending = id;
    drawList();
    try {
      const response = await api('/api/direct-models/connect', { id, ...configuration });
      ({ connections } = await response.json());
      notice('模型账号已连接');
    } catch (error) { notice(error.message); }
    finally {
      directPending = '';
      onChange();
      if (modal.open && $('#user-settings-panel', modal)) drawList();
    }
  }

  async function directOperation(operation, id, details = {}) {
    try {
      const response = await api(`/api/direct-models/${operation}`, { id, ...details });
      const data = await response.json();
      if (operation === 'disconnect') {
        await refresh();
        if (modal.open && $('form[data-form=direct-model]', modal)) drawList();
        notice(data.revoked ? '账号已断开' : '本机连接已断开，远程授权可在服务商设置中管理');
      } else if (operation !== 'cancel') {
        ({ connections } = data);
        onChange();
        if (modal.open && $('form[data-form=direct-model]', modal)) {
          if (operation === 'choose') drawList();
          else manageDirect(id);
        }
      }
    } catch (error) { notice(error.message); }
  }

  function open(back) {
    returnTo = back;
    drawList();
    if (!loaded || issue) void refresh();
  }

  function edit(id) {
    const profile = profiles.find(item => item.id === id) || legacy.profiles.find(item => item.id === id);
    const provider = profile?.provider || 'openai';
    const credentialHint = profile?.hasKey ? '留空沿用同地址已保存的 Key' : '填写 API Key，本机接口可留空';
    show(id === 'agent' ? '用户设置 / Agent 接口' : '用户设置 / 模型接口', `<form data-form="model" ${idData(id || newId())}>
      ${field('name', '显示名称', profile?.name || (id === 'agent' ? 'Agent' : ''), { max: 80, placeholder: '用于在节点中识别此接口' })}
      ${field('provider', '接口类型', provider, { type: 'select', choices: Object.entries(PROVIDERS).map(([key, item]) => [key, item.label]) })}
      ${field('base', 'API Base URL', profile?.base || PROVIDERS[provider].base, { required: true, max: 500 })}
      ${field('model', '模型 ID', profile?.model, { max: 180, required: true, placeholder: '服务商提供的模型 ID' })}
      <div id="model-effort-override"${['openai', 'ollama'].includes(provider) ? '' : ' hidden'}>
        ${field('reasoningLevels', '推理档位（可选）', Array.isArray(profile?.reasoningLevels) ? profile.reasoningLevels.join(', ') : profile?.reasoningLevels, {
          max: 220, placeholder: '自动识别，或填写 low, medium, high',
        })}
        <p class="field-hint">兼容接口可按服务商文档填写原生档位，用逗号分隔。填 off 可隐藏档位。</p>
      </div>
      ${field('apiKey', 'API Key', '', { type: 'password', max: 2000, placeholder: credentialHint })}
      <p class="modal-error" role="alert" hidden></p><p class="activity-status" role="status" hidden></p>
      <div class="modal-footer">${profile ? button('remove-model', '移除接口', { style: 'danger quiet' }) : ''}
        ${button('model-back', '返回设置', { style: 'quiet' })}${button('test-model', '测试连接', { glyph: 'plugs-connected' })}
        <button class="button primary" type="submit">保存接口</button></div></form>`);
  }

  function currentProfile(form) {
    const { reasoningLevels, ...values } = Object.fromEntries(new FormData(form));
    const levels = reasoningLevels?.trim();
    return { id: form.dataset.id, ...values,
      ...(['openai', 'ollama'].includes(values.provider) && levels ? { reasoningLevels: levels === 'off' ? 'off' :
        levels.split(/[,，\s]+/).filter(Boolean) } : {}) };
  }

  async function change(form, operation) {
    if (busy || (operation !== 'remove' && !form.reportValidity())) return;
    const errorLine = $('.modal-error', form);
    const activity = $('.activity-status', form);
    const profile = currentProfile(form);
    busy = true;
    errorLine.hidden = true;
    activity.hidden = false;
    activity.innerHTML = `<span class="activity-dots"><span></span></span>${operation === 'test' ? '正在测试接口…' : '正在保存设置…'}`;
    const controls = [...form.querySelectorAll('button,input,select')];
    for (const control of controls) control.disabled = true;
    try {
      if (operation === 'test') {
        await api('/api/ai/test', { profile });
        activity.textContent = '连接成功';
      } else {
        const response = await api(`/api/model-settings/${operation}`, operation === 'save' ? { profile } : { id: profile.id });
        ({ profiles, persistent } = await response.json());
        issue = '';
        legacy.profiles = legacy.profiles.filter(item => item.id !== profile.id);
        try { localStorage.setItem(legacyKey, JSON.stringify(legacy)); } catch { /* The saved configuration stays in the main process. */ }
        onChange();
        if (modal.open && form.isConnected) drawList();
        notice(operation === 'save' ? '接口已保存' : '接口已移除');
      }
    } catch (error) {
      activity.hidden = true;
      errorLine.textContent = error.message;
      errorLine.hidden = false;
      if (!form.isConnected) notice(error.message);
    } finally {
      busy = false;
      for (const control of controls) control.disabled = false;
    }
  }

  modal.addEventListener('change', event => {
    if (event.target.id === 'field-provider' && event.target.form?.dataset.form === 'model') {
      $('#field-base', event.target.form).value = PROVIDERS[event.target.value].base;
      $('#model-effort-override', event.target.form).hidden = !['openai', 'ollama'].includes(event.target.value);
    }
  });
  modal.addEventListener('submit', event => {
    const form = event.target;
    if (form.dataset.form === 'direct-model') {
      event.preventDefault();
      void directOperation('choose', form.dataset.id, { model: new FormData(form).get('account-model') });
      return;
    }
    if (form.dataset.form === 'google-oauth') {
      event.preventDefault();
      void (async () => {
        const file = $('#google-oauth-file', form).files[0];
        try {
          if (!file || file.size > 128 * 1024) throw new Error();
          const client = JSON.parse(await file.text());
          if (!client.installed) throw new Error();
          await connectDirect('gemini', { client, project: new FormData(form).get('project') });
        } catch {
          const line = $('.modal-error', form);
          line.textContent = '请选择 Google Cloud 下载的 OAuth 桌面客户端 JSON。';
          line.hidden = false;
        }
      })();
      return;
    }
    if (form.dataset.form !== 'model') return;
    event.preventDefault();
    void change(event.target, 'save');
  });

  function action(name, control) {
    switch (name) {
      case 'direct-connect': void connectDirect(control.dataset.id); return true;
      case 'direct-setup': googleSetup(); return true;
      case 'direct-manage': manageDirect(control.dataset.id); return true;
      case 'direct-cancel': void directOperation('cancel', control.dataset.id); return true;
      case 'direct-disconnect': void directOperation('disconnect', control.dataset.id); return true;
      case 'direct-refresh': void directOperation('refresh', control.dataset.id); return true;
      case 'add-model': edit(); return true;
      case 'edit-model': edit(control.dataset.id); return true;
      case 'model-back': drawList(); return true;
      case 'model-return': returnTo?.(); return true;
      case 'test-model': void change(control.form, 'test'); return true;
      case 'remove-model': void change(control.form, 'remove'); return true;
      default: return false;
    }
  }

  return { refresh, open, action, ordinary, agentProfiles, defaultProfile, forNode,
    modelName: (node, models) => (node?.modelId || node?.kind === 'agent') ? forNode(node, models)?.name || node?.modelSource : node?.modelSource };
}
