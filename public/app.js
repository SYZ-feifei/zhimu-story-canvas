import { StoryBoard } from './board.js';
import { demoProject } from './demo.js';
import { EmotionChart } from './emotion.js';
import { projectHome } from './home.js';
import { enterWorkspace } from './login.js';
import { createScriptImport } from './script-import.js';
import { ANGLES, BEATS, DEVELOPMENT_ORDER, FORMATS, NODE_LIMIT, PROVIDERS, alternateNodes, arrange, beatName, beatNode,
  cleanText, mainlineNodes, makeNode, newId, newProject, normalizeProject, pinNode, positionFor, removeNode } from './story.js';
import { $, button, enabled, escape, field, icon, iconButton, signed } from './ui.js';

const login = await enterWorkspace();
const PROJECT_KEY = `zhimu.projects.${login.account.id}.v1`;
const MODEL_KEY = `zhimu.models.${login.account.id}.v1`;
const modal = $('#modal');
const importFile = $('#import-file');
const valueOf = (data, name) => String(data.get(name) ?? '').trim();
const dataId = id => `data-id="${escape(id)}"`;
const nodeById = id => project.nodes.find(node => node.id === id);
const focused = () => nodeById(state.selected);
const aiBeat = () => state.scope === 'next' ? 'scene' : state.beat;
const alternatives = () => alternateNodes(project, state.panel === 'ai' ? aiBeat() : state.beat, focused());
const focusName = () => focused()?.title || beatName(state.beat);
const projectId = () => project.id;

let hadInvalidStorage = false;
function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      const projects = stored.projects.map(normalizeProject);
      if (projects.length) return { projects, active: projects.some(item => item.id === stored.active) ? stored.active : projects[0].id };
    }
  } catch { hadInvalidStorage = true; }
  return { projects: [demoProject()], active: 'rain-demo' };
}

function loadModels() {
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_KEY) || '{}');
    if (Array.isArray(raw.profiles)) return { active: cleanText(raw.active, 90), profiles: raw.profiles.filter(profile =>
      profile && /^[a-zA-Z0-9_-]{1,90}$/.test(profile.id) && profile.id !== 'env' && Object.hasOwn(PROVIDERS, profile.provider)).map(profile => ({
      id: profile.id, name: cleanText(profile.name, 80), provider: profile.provider, model: cleanText(profile.model, 180), base: cleanText(profile.base, 500),
    })) };
  } catch { /* A project remains usable when model preferences cannot be read. */ }
  return { active: '', profiles: [] };
}

const library = loadProjects();
const models = loadModels();
const keys = new Map();
let environmentModel = null;
let project = library.projects.find(item => item.id === library.active);
const state = {
  screen: 'home',
  selected: beatNode(project, 'C')?.id ?? project.nodes[0]?.id ?? null,
  beat: beatNode(project, 'C') ? 'C' : project.nodes[0]?.beat ?? 'C',
  panel: 'ai', view: 'board', mainlineOnly: false, linking: false, linkStart: null, angle: 'beat', scope: 'beat', request: '',
  chartOpen: true, generation: null, assessment: null, recent: [],
};
const history = { undo: [], redo: [] };
const board = new StoryBoard({ select: id => selectNode(id, 'detail'), move: moveNode });
const chart = new EmotionChart();
let toastTimer;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 4600);
}

function persist() {
  const element = $('#save-state');
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(library));
    element.innerHTML = `${icon('check-circle')}已保存至本机`;
    element.classList.remove('error');
  } catch {
    element.innerHTML = `${icon('warning-circle')}本机保存失败`;
    element.classList.add('error');
    toast('本机存储空间不足或被禁用。请导出项目 JSON 保留当前编辑。');
  }
}

function persistModels() {
  try { localStorage.setItem(MODEL_KEY, JSON.stringify(models)); }
  catch { toast('模型设置暂时有效。本机存储不可用。'); }
}

function replaceProject(next) {
  library.projects[library.projects.findIndex(item => item.id === project.id)] = next;
  project = next;
}

function commit(change, reset = false) {
  const next = structuredClone(project);
  change(next);
  history.undo.push(project);
  if (history.undo.length > 25) history.undo.shift();
  history.redo.length = 0;
  replaceProject(next);
  persist();
  render(reset);
}

function navigateHistory(direction) {
  const next = history[direction].pop();
  if (!next) return;
  history[direction === 'undo' ? 'redo' : 'undo'].push(project);
  replaceProject(next);
  persist();
  render();
}

function switchProject(id) {
  const next = library.projects.find(item => item.id === id);
  if (!next) return;
  state.generation?.controller.abort();
  state.assessment?.controller.abort();
  project = next;
  library.active = id;
  history.undo.length = history.redo.length = 0;
  const first = beatNode(project, 'C') || mainlineNodes(project)[0] || project.nodes[0];
  Object.assign(state, { screen: 'canvas', selected: first?.id ?? null, beat: first?.beat ?? 'C', panel: 'ai', view: 'board', linking: false,
    linkStart: null, mainlineOnly: false, scope: 'beat', request: '', generation: null, assessment: null, recent: [] });
  closeModal();
  persist();
  render(true);
}

function selectNode(id, panel = 'detail', jump = false) {
  const node = nodeById(id);
  if (!node) return;
  if (state.linking && !jump) {
    if (!state.linkStart) {
      state.linkStart = id;
      render();
      return;
    }
    if (state.linkStart === id) { toast('请选择另一张节点作为连线终点。'); return; }
    const from = state.linkStart;
    state.linking = false;
    state.linkStart = null;
    if (project.links.some(link => link.from === from && link.to === id)) { render(); toast('这条因果连线已存在。'); return; }
    if (project.links.length >= 1500) { render(); toast('因果连线已达到项目上限。'); return; }
    state.selected = id;
    state.beat = node.beat;
    state.panel = 'detail';
    commit(next => next.links.push({ from, to: id }));
    toast('已添加因果连线');
    return;
  }
  state.selected = id;
  state.beat = node.beat;
  state.scope = 'beat';
  state.panel = panel;
  if (!project.mainline.includes(id)) state.mainlineOnly = false;
  if (jump) state.view = 'board';
  render();
  board.reveal(id);
}

function chooseBeat(beat) {
  const node = beatNode(project, beat) || project.nodes.find(item => item.beat === beat);
  state.beat = beat;
  state.selected = node?.id ?? null;
  state.panel = 'ai';
  state.scope = 'beat';
  state.linking = false;
  state.linkStart = null;
  if (node && !project.mainline.includes(node.id)) state.mainlineOnly = false;
  render();
  if (node) board.reveal(node.id);
}

function moveNode(id, x, y) {
  commit(next => {
    const node = next.nodes.find(item => item.id === id);
    if (node) Object.assign(node, { x: Math.round(x), y: Math.round(y) });
  });
}

function renderSidebar() {
  const settled = DEVELOPMENT_ORDER.filter(beat => beatNode(project, beat)).length;
  $('#sidebar').innerHTML = `
    <div class="section-label"><h2>项目</h2><div>${iconButton('projects', '项目列表', 'folders')}${iconButton('new-project', '新建项目', 'plus')}</div></div>
    <article class="project-card">
      ${project.cover === 'rain' ? '<div class="project-cover" role="img" aria-label="雨夜窗口与红伞"><span class="sample-label">示例</span></div>' : ''}
      <div class="project-info"><div class="project-title"><h1 title="${escape(project.title)}">${escape(project.title)}</h1>${iconButton('edit-project', '编辑项目资料', 'pencil-simple')}</div>
      <div class="project-title"><span class="project-format">${project.format}</span></div>
      <p>${escape(project.premise || '填写一句话梗概，给故事一个出发点。')}</p></div>
    </article>
    <section class="side-section">
      <div class="section-label"><h2>四拍推演</h2><span class="hint">${settled} / 4 已锁定</span></div>
      <div class="develop-order"><span>发散顺序</span><strong>C → B → A → D</strong></div>
      <div class="beat-list">${DEVELOPMENT_ORDER.map(beat => {
        const slot = BEATS[beat];
        const locked = beatNode(project, beat);
        return `<button type="button" class="beat-row tone-${slot.color}" data-action="choose-beat" data-id="${beat}" aria-pressed="${state.beat === beat}">
          <span class="beat-letter">${beat}</span><span class="beat-meta"><strong>${slot.name}</strong><small>${escape(locked?.title || '待确定')}</small></span>${icon(locked ? 'lock-key' : 'circle-dashed')}</button>`;
      }).join('')}</div>
    </section>
    <section class="side-note"><div class="section-label"><h2>共享设定</h2>${iconButton('edit-project', '编辑共享设定', 'pencil-simple')}</div><p>${escape(project.constraints || '所有节点的模型都会读取这里的人物、关系和规则。')}</p></section>
    ${project.sourceName ? `<section class="side-note"><div class="section-label"><h2>导入来源</h2>${iconButton('analysis-notes', '查看结构分析', 'file-text')}</div><p>${escape(project.sourceName)}</p></section>` : ''}`;
}

function renderOutline() {
  if (state.view !== 'outline') return;
  const mainline = mainlineNodes(project);
  $('#outline').innerHTML = `<div class="outline-header"><h2>${mainline.length} 个主线节点</h2><span>用上下箭头调整叙事顺序</span></div>
    ${mainline.length ? `<ol class="outline-list">${mainline.map((node, i) => `<li class="outline-item${node.id === state.selected ? ' is-selected' : ''}">
      <span class="outline-index">${String(i + 1).padStart(2, '0')}</span><span class="node-pill tone-${BEATS[node.beat].color}">${BEATS[node.beat].short}</span>
      <button class="outline-jump" data-action="node" ${dataId(node.id)}><strong>${escape(node.title)}</strong><small>${escape(node.action || '待填写情节')}</small></button>
      ${iconButton('up-node', '上移节点', 'caret-up', `${dataId(node.id)}${enabled(i > 0)}`)}${iconButton('down-node', '下移节点', 'caret-down', `${dataId(node.id)}${enabled(i < mainline.length - 1)}`)}
    </li>`).join('')}</ol>` : '<p class="empty-note">从画布上选一个节点，再将它纳入主线。</p>'}`;
}

const allProfiles = () => [...(environmentModel ? [environmentModel] : []), ...models.profiles];
const activeProfile = () => allProfiles().find(profile => profile.id === models.active) || allProfiles()[0];
const profileFor = (node = focused()) => node?.modelId ? allProfiles().find(profile => profile.id === node.modelId) : activeProfile();
const profileName = profile => profile?.name || profile?.model || '选择模型';
const roundsFor = () => project.proposals.filter(round => round.focus === state.selected && round.beat === aiBeat() && round.scope === state.scope);
let returnToImport = false;
const scriptImport = createScriptImport({ modal, show: openModal, headers: login.headers, api, profiles: allProfiles,
  defaultProfile: activeProfile, useProfile: profile => {
    const payload = modelPayload(profile);
    if (!payload) returnToImport = true;
    return payload;
  }, onApply: applyScript, notice: toast });

function applyScript(result) {
  const next = newProject(result);
  for (const [index, plot] of result.nodes.entries()) {
    const node = makeNode({ ...plot, modelId: result.modelId, modelSource: result.modelSource,
      origin: next.nodes.at(-1)?.id, x: index * 230, y: 0 });
    next.nodes.push(node);
    next.mainline.push(node.id);
  }
  library.projects.push(next);
  switchProject(next.id);
  state.recent = next.mainline;
  render();
  toast(`剧本已拆为 ${next.nodes.length} 个主线节点`);
}

function modelPicker() {
  const available = allProfiles();
  const node = focused();
  const active = node ? node.modelId || '' : activeProfile()?.id;
  return `<div class="field"><label for="model-select">${node ? '此节点的模型' : '默认模型'}</label><div class="model-row"><select class="model-select" id="model-select" aria-label="当前 AI 模型" ${enabled(available.length > 0)}>
    ${node && available.length ? `<option value="">跟随默认 · ${escape(profileName(activeProfile()))}</option>` : ''}
    ${node?.modelId && !profileFor(node) ? `<option value="${node.modelId}" selected>此配置待重新接入</option>` : ''}
    ${available.length ? available.map(profile => `<option value="${profile.id}" ${profile.id === active ? 'selected' : ''}>${escape(profileName(profile))} · ${PROVIDERS[profile.provider].label}</option>`).join('') : '<option>尚未接入模型</option>'}</select>${button(node ? 'node-model' : 'models', '模型设置', { glyph: 'sliders-horizontal', style: 'secondary compact', data: node ? dataId(node.id) : '' })}</div></div>`;
}

function branchRows() {
  const related = alternatives();
  return `<div class="section-label"><h3>画布备选 <span class="hint">${related.length}</span></h3>${related.length ? button('compare', '对比分支', { glyph: 'columns', style: 'light compact' }) : ''}</div>
    <div class="branch-stack">${related.length ? related.map((node, i) => `<button type="button" class="branch-row" data-action="jump-node" ${dataId(node.id)}>
      <span class="branch-letter">${i + 1}</span><span><strong>${escape(node.title)}</strong><small>${escape(node.consequence || node.action || '打开节点')}</small></span>${icon('caret-right')}
    </button>`).join('') : '<p class="empty-note">在当前节拍生成候选，或手动添加备选节点。</p>'}</div>`;
}

function generatedRows() {
  return roundsFor().slice().reverse().map(round => `<div class="inspector-divider"></div><div class="section-label"><h3>AI 候选</h3><span class="hint">${escape(round.modelSource || '模型')}</span></div>
    <div class="branch-stack">${round.options.map((option, i) => {
      const data = `data-round="${round.id}" ${dataId(i)}`;
      return `<article class="candidate"><h4>${escape(option.title)}</h4><p>${escape(option.action)}</p>${option.consequence ? `<p>后果　${escape(option.consequence)}</p>` : ''}
        ${option.fixedDetails ? `<p>沿用细节　${escape(option.fixedDetails)}</p>` : ''}<div class="candidate-actions">
        ${button('add-candidate', '应用为分支', { glyph: 'plus', style: 'secondary compact', data })}
        ${button('pin-candidate', '应用到主线', { style: 'primary compact', data })}${iconButton('discard-candidate', '略过候选', 'x', data)}</div></article>`;
    }).join('')}</div>`).join('');
}

function renderAi() {
  const target = aiBeat();
  const beat = BEATS[target];
  const busy = Boolean(state.generation);
  return `<div class="focus-card tone-${beat.color}"><span class="node-pill">${target === 'scene' ? icon('film-strip') : target} ${state.scope === 'next' ? '后续情节' : beat.name}</span>
    <h3>${escape(focused()?.title || '从故事梗概开始')}</h3><p>${escape(beat.hint)}</p></div>
    ${focused() && state.beat !== 'scene' ? `<div class="field"><span class="field-label">发散目标</span><div class="angles">${[['beat', '同拍备选'], ['next', '后续情节']].map(([id, label]) => button('scope', label, { style: 'secondary angle', data: dataId(id), extra: `aria-pressed="${state.scope === id}"` })).join('')}</div></div>` : ''}
    <div class="field"><span class="field-label">发散角度</span><div class="angles">${Object.entries(ANGLES).map(([key, label]) => button('angle', label, { style: 'secondary angle', data: dataId(key), extra: `aria-pressed="${state.angle === key}"` })).join('')}</div></div>
    <div class="field"><label for="ai-request">本轮要求 <small>选填</small></label><textarea id="ai-request" rows="2" maxlength="1600" placeholder="例如保留红伞，把揭晓动作交给来客。">${escape(state.request)}</textarea></div>
    ${modelPicker()}<div class="run-action">${button('generate', busy ? '正在读取上下文并发散…' : '生成 3 个分支', { glyph: busy ? 'spinner-gap' : 'sparkle', style: 'primary wide', disabled: busy })}${busy ? iconButton('cancel-generation', '取消生成', 'x') : ''}</div>
    ${busy ? `<div class="activity-status" role="status"><span class="activity-dots"></span>${escape(state.generation.modelSource)} · ${escape(state.generation.label)}</div>` : ''}
    ${generatedRows()}<div class="inspector-divider"></div>${branchRows()}`;
}

const detailFields = [['action', '情节动作'], ['reason', '前因'], ['consequence', '后果'], ['clue', '伏笔与回收'], ['tradeoff', '联动修改'],
  ['fixedDetails', '沿用细节'], ['evidence', '原文依据'], ['script', '场景正文']];

function renderDetail() {
  const node = focused();
  if (!node) return `<p class="empty-note">选择画布上的剧情节点查看详情。</p>${button('add-node', '添加节点', { glyph: 'plus' })}`;
  const beat = BEATS[node.beat];
  const settled = project.mainline.includes(node.id);
  const links = project.links.filter(link => link.from === node.id || link.to === node.id);
  return `<div class="focus-card tone-${beat.color}"><span class="node-pill">${beat.name} · ${settled ? '已纳入主线' : '备选'}</span><h3>${escape(node.title)}</h3></div>
    ${node.modelSource ? `<p class="node-provenance">${icon('sparkle')}由 ${escape(node.modelSource)} 生成</p>` : ''}
    <div class="detail-actions">${button('edit-node', '编辑', { glyph: 'pencil-simple', style: 'secondary compact' })}
    ${settled ? button('unpin', '移出主线', { glyph: 'lock-key-open', style: 'light compact' }) : button('pin', node.beat === 'scene' ? '纳入主线' : '锁定本拍', { glyph: 'lock-key', style: 'primary compact', data: dataId(node.id) })}
    ${button('next-scene', '续写情节', { glyph: 'arrow-bend-down-right', style: 'light compact' })}</div>
    ${detailFields.filter(([key]) => node[key]).map(([key, label]) => `<div class="detail-block"><h4>${label}</h4><p>${escape(node[key])}</p></div>`).join('')}
    ${node.fixedDetails ? button('keep-detail', '存入项目共享设定', { glyph: 'bookmark-simple', style: 'light compact' }) : ''}
    <div class="inspector-divider"></div><div class="section-label"><h3>情绪标注</h3>${button('edit-score', '编辑分值', { style: 'light compact' })}</div>
    <div class="score-chips"><span class="score-chip">情绪 ${signed(node.valence)}</span><span class="score-chip tension">张力 ${node.tension === null ? '待标注' : `${node.tension}/10`}</span></div>
    ${node.emotionNote ? `<p class="empty-note">${escape(node.emotionNote)}</p>` : ''}
    ${links.length ? `<div class="inspector-divider"></div><div class="section-label"><h3>因果连线</h3></div>${links.map(link => `<div class="relation-row"><span>${escape(nodeById(link.from)?.title)} → ${escape(nodeById(link.to)?.title)}</span>${iconButton('remove-link', '移除此连线', 'x', `data-from="${link.from}" data-to="${link.to}"`)}</div>`).join('')}` : ''}
    ${alternatives().length ? `<div class="inspector-divider"></div>${branchRows()}` : ''}`;
}

function renderInspector() {
  const inspector = $('#inspector');
  const scroll = inspector.scrollTop;
  inspector.innerHTML = `<div class="inspector-head"><h2>${icon('sparkle')}编剧台</h2></div>
    <div class="inspector-tabs" aria-label="编剧台视图"><button type="button" data-action="panel-ai" aria-pressed="${state.panel === 'ai'}">AI 发散</button><button type="button" data-action="panel-detail" aria-pressed="${state.panel === 'detail'}">节点详情</button></div>
    ${state.panel === 'ai' ? renderAi() : renderDetail()}`;
  inspector.scrollTop = scroll;
}

function render(reset = false) {
  if (state.selected && !focused()) state.selected = null;
  if (state.linkStart && !nodeById(state.linkStart)) state.linkStart = null;
  const onCanvas = state.screen === 'canvas';
  $('#home-screen').hidden = onCanvas;
  $('#workspace-screen').hidden = !onCanvas;
  $('#export-button').hidden = !onCanvas;
  $('#save-state').hidden = !onCanvas;
  $('#crumb-title').textContent = onCanvas ? project.title : '项目首页';
  if (!onCanvas) $('#home-screen').innerHTML = projectHome(library.projects);
  $('#models-button').title = activeProfile()?.name || '接入 AI 模型';
  $('#board-tab').setAttribute('aria-pressed', state.view === 'board');
  $('#outline-tab').setAttribute('aria-pressed', state.view === 'outline');
  $('#viewport').hidden = state.view !== 'board';
  $('#outline').hidden = state.view !== 'outline';
  $('#undo').disabled = !history.undo.length;
  $('#redo').disabled = !history.redo.length;
  $('#link-button').setAttribute('aria-pressed', state.linking);
  $('#filter-button').setAttribute('aria-pressed', state.mainlineOnly);
  $('#filter-button span').textContent = state.mainlineOnly ? '仅主线' : '全图';
  $('#cause-legend').hidden = !project.links.length || state.mainlineOnly;
  $('#canvas-status').textContent = state.linking ? (state.linkStart ? '点选连线终点' : '点选连线起点') : `${project.nodes.length} 个节点 · ${project.mainline.length} 个主线`;
  const empty = $('#canvas-empty');
  empty.hidden = state.mainlineOnly ? Boolean(project.mainline.length) : Boolean(project.nodes.length);
  if (!empty.hidden) empty.innerHTML = `${icon('graph')}<h3>${state.mainlineOnly ? '主线还是空的' : '把第一个剧情放上画布'}</h3><p>${state.mainlineOnly ? '切回全图，选一个节点纳入主线。' : '从反转底牌开始，或者添加你已经想到的开场与情节。'}</p>${button(state.mainlineOnly ? 'filter' : 'add-node', state.mainlineOnly ? '显示全图' : '添加节点', { glyph: state.mainlineOnly ? 'graph' : 'plus', style: 'primary' })}`;
  $('#emotion-panel').classList.toggle('collapsed', !state.chartOpen);
  $('#chart-scroll').hidden = !state.chartOpen;
  $('#chart-toggle').innerHTML = icon(state.chartOpen ? 'caret-down' : 'caret-up');
  $('#chart-toggle').setAttribute('aria-expanded', state.chartOpen);
  $('#chart-toggle').setAttribute('aria-label', state.chartOpen ? '折叠曲线' : '展开曲线');
  $('#chart-toggle').title = state.chartOpen ? '折叠曲线' : '展开曲线';
  $('#assess-button').disabled = !project.mainline.length;
  $('#assess-button span').textContent = state.assessment ? '取消标注' : 'AI 标注';
  renderSidebar();
  renderOutline();
  renderInspector();
  const recent = state.recent;
  state.recent = [];
  board.update(project, { selected: state.selected, mainlineOnly: state.mainlineOnly, linking: state.linking, linkStart: state.linkStart,
    generating: state.generation?.focus, recent, modelLabel: node => profileName(profileFor(node)), reset });
  chart.update(project, state.selected);
}

function openModal(title, body, wide = false) {
  modal.classList.toggle('wide-modal', wide);
  modal.innerHTML = `<header class="modal-header"><h2 id="modal-title">${escape(title)}</h2>${iconButton('close-modal', '关闭', 'x')}</header><div class="modal-body">${body}</div>`;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}

function closeModal() { if (modal.open) modal.close(); }
function formFooter(label = '保存', start = '') {
  return `<p class="modal-error" role="alert" hidden></p><div class="modal-footer">${start}${button('close-modal', '取消')}<button type="submit" class="button primary">${escape(label)}</button></div>`;
}

function projectsDialog() {
  const list = library.projects.map(item => `<button class="list-row${item.id === project.id ? ' is-active' : ''}" data-action="select-project" ${dataId(item.id)}>${icon('folder')}<span class="list-label"><strong>${escape(item.title)}</strong><small>${item.format} · ${item.nodes.length} 个节点</small></span>${icon(item.id === project.id ? 'check' : 'caret-right')}</button>`).join('');
  openModal('项目', `<div class="project-list">${list}</div><div class="modal-footer">${button('import', '导入备份', { glyph: 'archive' })}${button('script-import', '导入剧本', { glyph: 'upload-simple' })}${button('new-project', '新建项目', { glyph: 'plus', style: 'primary' })}</div>`);
}

function projectDialog(editing) {
  const item = editing ? project : {};
  openModal(editing ? '编辑项目' : '新建故事', `<form data-form="${editing ? 'edit-project' : 'new-project'}">
    ${field('title', '项目名称', item.title, { required: true, placeholder: '给故事起个名字' })}
    ${field('format', '作品体量', item.format || '短片', { type: 'select', choices: FORMATS.map(format => [format, format]) })}
    ${field('premise', '故事梗概', item.premise, { type: 'textarea', max: 5000, rows: 3, placeholder: '谁在什么处境里，要做出什么选择？' })}
    ${field('constraints', '共享设定', item.constraints, { type: 'textarea', max: 5000, rows: 3, placeholder: '后续模型都要沿用的人物、关系、时空或剧情事实' })}
    ${formFooter(editing ? '保存' : '创建项目', editing ? button('delete-project', '删除项目', { style: 'danger' }) : '')}</form>`);
}

function scoreFields(node) {
  return `<div class="modal-grid">${field('valence', '情绪（−5 到 +5）', node?.valence ?? '', { type: 'number', min: -5, upper: 5 })}
    ${field('tension', '张力（0 到 10）', node?.tension ?? '', { type: 'number', min: 0, upper: 10 })}</div>
    ${field('emotionNote', '标注依据', node?.emotionNote, { type: 'textarea', max: 800, placeholder: '这一拍结束时，观众为什么会有这种感受？' })}`;
}

function nodeDialog(node, nextScene = false) {
  const beat = nextScene ? 'scene' : node?.beat ?? state.beat;
  const pinned = Boolean(node && project.mainline.includes(node.id));
  openModal(node ? '编辑剧情节点' : nextScene ? '添加后续情节' : '添加剧情节点', `<form data-form="node" ${node ? dataId(node.id) : ''}>
    <div class="modal-grid">${field('title', '节点标题', node?.title, { required: true, placeholder: '写一个能认出来的剧情动作' })}
    ${pinned ? `<div class="field"><span class="field-label">所属节拍</span><span class="node-pill tone-${BEATS[beat].color}">${beatName(beat)}</span><input name="beat" type="hidden" value="${beat}"></div>` : field('beat', '所属节拍', beat, { type: 'select', choices: Object.entries(BEATS).map(([key, value]) => [key, value.name]) })}</div>
    ${field('action', '情节动作', node?.action, { type: 'textarea', max: 2400, placeholder: '人物做了什么？' })}
    ${field('reason', '前因', node?.reason, { type: 'textarea', max: 1400, placeholder: '为什么偏偏在这时做？' })}
    ${field('consequence', '后果', node?.consequence, { type: 'textarea', max: 1400, placeholder: '谁的处境发生了变化？' })}
    <details ${node?.clue || node?.tradeoff || node?.fixedDetails || node?.script ? 'open' : ''} class="editor-details"><summary>伏笔、沿用细节与场景正文</summary>
    ${field('clue', '伏笔与回收', node?.clue, { type: 'textarea', max: 1200 })}${field('tradeoff', '联动修改', node?.tradeoff, { type: 'textarea', max: 1200 })}
    ${field('fixedDetails', '沿用细节', node?.fixedDetails, { type: 'textarea', max: 1600 })}
    ${node?.evidence ? field('evidence', '原文依据', node.evidence, { type: 'textarea', max: 500 }) : ''}
    ${field('script', '场景正文', node?.script, { type: 'textarea', max: 30000, rows: 5 })}</details>
    <details class="editor-details"><summary>情绪与张力</summary>${scoreFields(node)}</details>
    ${node ? '' : '<label class="check-label"><input type="checkbox" name="pin">创建后纳入主线</label>'}
    <input type="hidden" name="origin" value="${escape(nextScene || !node ? state.selected : node.origin)}">
    ${formFooter(node ? '保存节点' : '添加节点', node ? button('delete-node', '删除节点', { style: 'danger', data: dataId(node.id) }) : '')}</form>`);
}

function scoreDialog() {
  const node = focused();
  if (!node) return;
  openModal('编辑情绪标注', `<p>${escape(node.title)}。分值用于创作比较，留空表示待标注。</p><form data-form="score" ${dataId(node.id)}>${scoreFields(node)}${formFooter()}</form>`);
}

function compareDialog() {
  const target = state.panel === 'ai' ? aiBeat() : state.beat;
  const current = target === 'scene' ? null : beatNode(project, target);
  const list = [...(current ? [current] : []), ...alternatives()];
  if (!list.length) return;
  openModal(`对比分支 · ${beatName(target)}`, `<div class="compare-grid">${list.map(node => {
    const settled = project.mainline.includes(node.id);
    return `<article class="compare-card${settled ? ' current' : ''}"><span class="node-pill tone-${BEATS[node.beat].color}">${settled ? '当前主线' : '备选'}</span>
      <h3>${escape(node.title)}</h3><dl>${detailFields.filter(([key]) => key !== 'script').map(([key, label]) => `<dt>${label}</dt><dd>${escape(node[key] || '待补充')}</dd>`).join('')}
      <dt>情绪与张力</dt><dd>${signed(node.valence)} · ${node.tension === null ? '待标注' : `${node.tension}/10`}</dd></dl>
      ${settled ? button('jump-node', '回到节点', { data: dataId(node.id) }) : button('pin', node.beat === 'scene' ? '纳入主线' : '锁定为本拍', { style: 'primary', data: dataId(node.id) })}</article>`;
  }).join('')}</div>`, true);
}

function modelsDialog(target = null) {
  const node = nodeById(target);
  const nodeData = node ? `data-target="${node.id}"` : '';
  const active = node ? node.modelId : activeProfile()?.id;
  const list = allProfiles().map(profile => `<div class="list-row${profile.id === active ? ' is-active' : ''}">${icon('cpu')}
    <span class="list-label"><strong>${escape(profile.name || profile.model)}</strong><small>${PROVIDERS[profile.provider].label} · ${escape(profile.model)}</small></span>
    ${profile.id !== 'env' ? iconButton('edit-model', '编辑模型', 'pencil-simple', `${dataId(profile.id)} ${nodeData}`) : ''}
    ${profile.id !== active ? button(node ? 'bind-model' : 'select-model', '使用', { style: 'light compact', data: `${dataId(profile.id)} ${nodeData}` }) : '<span class="project-format">当前</span>'}</div>`).join('');
  openModal(node ? '为节点选择模型' : '模型设置', `<p>${node ? escape(node.title) : '保存多个模型配置。节点可独立选择配置，并读取同一个项目的剧情与共享设定。'}</p>
    <div class="profile-list">${list || '<p class="empty-note">目前还没有模型配置。</p>'}</div><div class="modal-footer">
    ${node?.modelId ? button('bind-model', '跟随默认', { data: `${dataId('')} ${nodeData}` }) : ''}
    ${button('new-model', '添加模型', { glyph: 'plus', style: 'primary', data: nodeData })}</div>`);
}

function modelDialog(profile = null, target = null) {
  const provider = profile?.provider || 'openai';
  openModal(profile ? '编辑模型配置' : '添加模型配置', `<form data-form="model" ${profile ? dataId(profile.id) : ''} data-target="${escape(target)}">
    <div class="modal-grid">${field('name', '配置名称', profile?.name, { max: 80, placeholder: '例如常用模型' })}
    ${field('provider', '接口类型', provider, { type: 'select', choices: Object.entries(PROVIDERS).map(([key, value]) => [key, value.label]) })}</div>
    ${field('base', 'API Base URL', profile?.base || PROVIDERS[provider].base, { max: 500, required: true })}
    ${field('model', '模型 ID', profile?.model, { max: 180, required: true, placeholder: '服务商或 Ollama 中显示的模型 ID' })}
    ${field('apiKey', 'API Key', '', { type: 'password', max: 2000, placeholder: profile && keys.has(profile.id) ? '留空沿用本页密钥' : '本机 Ollama 可留空' })}
    <p class="field-hint">密钥在本次打开期间有效。模型任务会将当前项目的共享剧情发送到所选服务。</p>
    <div class="detail-actions">${button('test-model', '测试连接', { glyph: 'plug', style: 'secondary compact' })}</div>
    ${formFooter('保存并使用', profile ? button('remove-model', '删除配置', { style: 'danger', data: dataId(profile.id) }) : '')}</form>`);
}

const exportFormats = { docx: ['Word 文档', '可继续改写的主线大纲'], pdf: ['PDF', '适合发给合作者阅读'], md: ['Markdown', '保留章节结构和场景正文'], txt: ['纯文本', '兼容普通文本编辑器'], json: ['项目 JSON', '保留全部节点、备选、连线和情绪标注'] };

function exportDialog() {
  openModal('导出', `<div class="export-list">${Object.entries(exportFormats).map(([format, [label, description]]) => `<button class="list-row" data-action="download" ${dataId(format)}>${icon(format === 'json' ? 'archive' : 'file-text')}<span class="list-label"><strong>${label}</strong><small>${description}</small></span><span class="project-format">.${format}</span></button>`).join('')}</div>`);
}

async function api(path, payload, signal) {
  const response = await fetch(path, { method: 'POST', headers: { ...login.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `本机服务返回 HTTP ${response.status}。`);
  }
  return response;
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function download(format, control) {
  if (!Object.hasOwn(exportFormats, format)) return;
  const title = project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70).replace(/[. ]+$/, '') || '枝幕项目';
  control.disabled = true;
  try {
    const blob = format === 'json' ? new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
      : await (await api(`/api/export/${format}`, { project })).blob();
    downloadFile(blob, `${title}${format === 'json' ? '' : '_主线大纲'}.${format}`);
    closeModal();
    toast(`已导出 ${exportFormats[format][0]}`);
  } catch (error) { toast(error.message || '导出失败。'); }
  finally { control.disabled = false; }
}

function modelPayload(profile, target = null) {
  if (!profile) { modelsDialog(target); return null; }
  if (profile.id === 'env') return { id: 'env' };
  let local = false;
  try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.base).hostname); } catch { /* Server validates the address. */ }
  const apiKey = keys.get(profile.id) || '';
  if (!apiKey && !local) {
    modelDialog(profile, target);
    showFormError($('form', modal), '请填写该配置的 API Key。');
    return null;
  }
  return { ...profile, apiKey };
}

async function generate() {
  if (state.generation) return;
  if (!project.premise && !focused()?.action && !state.request.trim() && !mainlineNodes(project).some(node => node.action)) {
    toast('先填写故事梗概、情节动作或本轮要求。');
    return;
  }
  const selectedModel = profileFor();
  const profile = modelPayload(selectedModel, state.selected);
  if (!profile) return;
  const controller = new AbortController();
  const job = { controller, projectId: project.id, focus: state.selected, beat: aiBeat(), scope: state.scope,
    label: focusName(), modelId: selectedModel.id, modelSource: profileName(selectedModel) };
  const payload = { profile, project, beat: job.beat, focusId: job.focus, angle: state.angle, request: state.request };
  state.generation = job;
  render();
  try {
    const { options } = await (await api('/api/ai/suggest', payload, controller.signal)).json();
    if (state.generation !== job || projectId() !== job.projectId) return;
    if (job.focus && !nodeById(job.focus)) { toast('焦点节点已删除。'); return; }
    const { controller: _controller, projectId: _projectId, ...context } = job;
    commit(next => next.proposals.push({ id: newId(), ...context, options }));
    toast(`「${job.label}」已生成 3 个候选，可选择应用。`);
  } catch (error) {
    if (!controller.signal.aborted && state.generation === job) toast(error.message || '生成失败。');
  } finally {
    if (state.generation === job) { state.generation = null; render(); }
  }
}

function discardCandidate(roundId, index, project) {
  const round = project.proposals.find(item => item.id === roundId);
  if (!round) return;
  round.options.splice(index, 1);
  if (!round.options.length) project.proposals = project.proposals.filter(item => item.id !== roundId);
}

function placeCandidate(roundId, index, pin) {
  const result = project.proposals.find(round => round.id === roundId);
  const option = result?.options[index];
  if (!option) return;
  if (project.nodes.length >= NODE_LIMIT) { toast('项目已达到节点上限。'); return; }
  const origin = nodeById(result.focus);
  const node = makeNode({ ...option, beat: result.beat, origin: origin?.id, modelId: result.modelId,
    modelSource: result.modelSource, ...positionFor(project, result.beat, origin) });
  state.mainlineOnly = false;
  state.view = 'board';
  state.recent = [node.id];
  if (pin || !origin) {
    state.beat = node.beat;
    state.selected = node.id;
    state.scope = 'beat';
    state.panel = 'detail';
  }
  commit(next => {
    next.nodes.push(node);
    if (pin) pinNode(next, node);
    discardCandidate(roundId, index, next);
  });
  board.reveal(node.id);
  toast(pin ? '已应用到主线。后续模型会读取此节点。' : '已应用为备选分支。');
}

const storySignature = item => JSON.stringify([item.premise, item.constraints, item.format, mainlineNodes(item).map(({ x, y, ...node }) => node)]);

async function assess() {
  if (state.assessment) { state.assessment.controller.abort(); toast('已取消情绪标注'); return; }
  if (!project.mainline.length) return;
  const profile = modelPayload(profileFor(), state.selected);
  if (!profile) return;
  const controller = new AbortController();
  const job = { controller, id: project.id, signature: storySignature(project) };
  state.assessment = job;
  state.chartOpen = true;
  render();
  try {
    const { marks } = await (await api('/api/ai/assess', { profile, project }, controller.signal)).json();
    if (state.assessment !== job || projectId() !== job.id) return;
    if (job.signature !== storySignature(project)) { toast('主线在标注期间发生修改，请重新标注。'); return; }
    const byId = new Map(marks.map(mark => [mark.id, mark]));
    commit(next => {
      for (const node of next.nodes) {
        const mark = byId.get(node.id);
        if (mark) Object.assign(node, { valence: mark.valence, tension: mark.tension, emotionNote: mark.emotionNote });
      }
    });
    toast(`已标注 ${marks.length} 个主线节点，可在节点详情手动调整。`);
  } catch (error) {
    if (!controller.signal.aborted && state.assessment === job) toast(error.message || '标注失败。');
  } finally {
    if (state.assessment === job) { state.assessment = null; render(); }
  }
}

function makeMainline(id) {
  const node = nodeById(id);
  if (!node || project.mainline.includes(id)) return;
  closeModal();
  state.beat = node.beat;
  state.selected = id;
  state.scope = 'beat';
  state.panel = 'detail';
  commit(next => pinNode(next, next.nodes.find(item => item.id === id)));
  board.reveal(id);
  toast(node.beat === 'scene' ? '已纳入主线' : `已锁定${beatName(node.beat)}，原方案保留在画布上。`);
}

function reorder(id, offset) {
  const index = project.mainline.indexOf(id);
  const to = index + offset;
  if (index < 0 || to < 0 || to >= project.mainline.length) return;
  commit(next => {
    [next.mainline[index], next.mainline[to]] = [next.mainline[to], next.mainline[index]];
    const first = next.nodes.find(node => node.id === next.mainline[index]);
    const second = next.nodes.find(node => node.id === next.mainline[to]);
    [first.x, second.x] = [second.x, first.x];
    [first.y, second.y] = [second.y, first.y];
  });
}

function confirmDelete(label, description, action, id) {
  openModal(label, `<p>${escape(description)}</p><div class="modal-footer">${button('close-modal', '取消')}${button(action, label, { style: 'danger', data: dataId(id) })}</div>`);
}

function showFormError(form, message) {
  const element = $('.modal-error', form);
  element.textContent = message;
  element.hidden = false;
}

function readModel(form) {
  const data = new FormData(form);
  const id = form.dataset.id || newId();
  const provider = valueOf(data, 'provider');
  const model = valueOf(data, 'model');
  const base = valueOf(data, 'base');
  let url;
  try { url = new URL(base); } catch { throw new Error('API Base URL 格式有误。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error('请输入 HTTPS 接口地址或本机 HTTP 地址。');
  if (!model) throw new Error('请填写模型 ID。');
  const previous = models.profiles.find(item => item.id === id);
  const sameEndpoint = previous?.provider === provider && previous.base.replace(/\/+$/, '') === base.replace(/\/+$/, '');
  const apiKey = valueOf(data, 'apiKey') || (sameEndpoint ? keys.get(id) : '') || '';
  return { profile: { id, name: valueOf(data, 'name') || model, provider, base, model }, apiKey };
}

async function checkModel(control) {
  const form = control.closest('form');
  if (!form?.reportValidity()) return;
  control.disabled = true;
  control.textContent = '测试中…';
  try {
    const { profile, apiKey } = readModel(form);
    await api('/api/ai/test', { profile: { ...profile, apiKey } });
    if (form.isConnected) { $('.modal-error', form).hidden = true; toast('模型连接成功'); }
  } catch (error) { if (form.isConnected) showFormError(form, error.message); }
  finally { if (control.isConnected) { control.disabled = false; control.innerHTML = `${icon('plug')}测试连接`; } }
}

function valuesForScore(data) {
  return { valence: valueOf(data, 'valence') === '' ? null : Number(data.get('valence')),
    tension: valueOf(data, 'tension') === '' ? null : Number(data.get('tension')), emotionNote: valueOf(data, 'emotionNote') };
}

modal.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const type = form.dataset.form;
  const id = form.dataset.id;
  if (type === 'model') {
    try {
      const { profile, apiKey } = readModel(form);
      models.profiles = [...models.profiles.filter(item => item.id !== profile.id), profile];
      models.active = profile.id;
      if (apiKey) keys.set(profile.id, apiKey);
      else keys.delete(profile.id);
      persistModels();
      closeModal();
      if (nodeById(form.dataset.target)) bindModel(form.dataset.target, profile.id);
      else render();
      if (returnToImport) { returnToImport = false; scriptImport.open(); }
      toast(`已选择模型 ${profile.name}`);
    } catch (error) { showFormError(form, error.message); }
    return;
  }
  if (type === 'new-project' || type === 'edit-project') {
    const input = { title: valueOf(data, 'title'), format: valueOf(data, 'format'), premise: valueOf(data, 'premise'), constraints: valueOf(data, 'constraints') };
    if (!input.title) { showFormError(form, '请输入项目名称。'); return; }
    if (type === 'new-project') {
      const next = newProject(input);
      library.projects.push(next);
      switchProject(next.id);
    } else { closeModal(); commit(next => Object.assign(next, input)); }
    return;
  }
  if (type === 'score') {
    if (!nodeById(id)) return;
    closeModal();
    commit(next => Object.assign(next.nodes.find(item => item.id === id), valuesForScore(data)));
    return;
  }
  if (type !== 'node') return;
  const old = nodeById(id);
  if (!old && project.nodes.length >= NODE_LIMIT) { showFormError(form, '项目已达到节点上限。'); return; }
  const title = valueOf(data, 'title');
  if (!title) { showFormError(form, '请输入节点标题。'); return; }
  const beat = valueOf(data, 'beat');
  const origin = nodeById(valueOf(data, 'origin'));
  const position = old ? { x: old.x, y: old.y } : positionFor(project, beat, origin);
  const node = makeNode({ id: old?.id, modelId: old?.modelId, modelSource: old?.modelSource, beat, title, origin: old ? old.origin : origin?.id, ...position,
    ...Object.fromEntries(detailFields.map(([key]) => [key, valueOf(data, key)])), ...valuesForScore(data) });
  state.selected = node.id;
  state.beat = node.beat;
  state.scope = 'beat';
  state.panel = 'detail';
  if (!old) state.recent = [node.id];
  if (!old) { state.view = 'board'; state.mainlineOnly = false; }
  closeModal();
  commit(next => {
    if (old) next.nodes[next.nodes.findIndex(item => item.id === old.id)] = node;
    else next.nodes.push(node);
    if (data.has('pin')) pinNode(next, node);
  });
  board.reveal(node.id);
});

document.addEventListener('input', event => {
  if (event.target.id === 'ai-request') state.request = event.target.value;
});
document.addEventListener('change', event => {
  if (event.target.id === 'model-select') {
    if (focused()) bindModel(state.selected, event.target.value);
    else { models.active = event.target.value; persistModels(); render(); }
  }
  if (event.target.id === 'field-provider' && event.target.closest('form[data-form="model"]')) $('#field-base', modal).value = PROVIDERS[event.target.value].base;
});

function bindModel(id, profileId) {
  const node = nodeById(id);
  if (!node || (profileId && !allProfiles().some(profile => profile.id === profileId))) return;
  closeModal();
  if (state.selected !== id) state.scope = 'beat';
  state.selected = id;
  state.beat = node.beat;
  state.panel = 'ai';
  if ((node.modelId || '') === profileId) { render(); return; }
  commit(next => { next.nodes.find(item => item.id === id).modelId = profileId || null; });
  toast(profileId ? `节点已选择 ${profileName(profileFor())}` : '节点已跟随默认模型');
}

function keepDetail() {
  const detail = focused()?.fixedDetails;
  if (!detail || project.constraints.includes(detail)) { toast('这条细节已在共享设定中。'); return; }
  const nextText = [project.constraints, detail].filter(Boolean).join('\n');
  if (nextText.length > 5000) { toast('共享设定已达字数上限，请先整理项目设定。'); return; }
  commit(next => { next.constraints = nextText; });
  toast('已保存到项目共享设定');
}

importFile.addEventListener('change', async () => {
  const [file] = importFile.files;
  importFile.value = '';
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('项目文件超出 20 MB。');
    const next = normalizeProject(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
    next.id = newId();
    library.projects.push(next);
    switchProject(next.id);
    toast('项目已导入');
  } catch (error) { toast(error instanceof SyntaxError ? '文件不是可读取的 JSON。' : error.message); }
});

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  const { action, id } = control.dataset;
  switch (action) {
    case 'close-modal': closeModal(); break;
    case 'home': state.screen = 'home'; state.linking = false; state.linkStart = null; closeModal(); render(); break;
    case 'account': openModal('本机账号', `<p>${escape(login.account.name)}</p><div class="modal-footer">${button('logout', '退出登录', { glyph: 'sign-out', style: 'secondary' })}</div>`); break;
    case 'analysis-notes': openModal('剧本结构分析', `<p>${escape(project.sourceName)}</p><div class="detail-block"><p>${escape(project.analysisNotes || '结构已整理为主线节点。')}</p></div>`); break;
    case 'logout': void login.logout(); break;
    case 'projects': projectsDialog(); break;
    case 'new-project': projectDialog(false); break;
    case 'edit-project': projectDialog(true); break;
    case 'select-project': switchProject(id); break;
    case 'delete-project': confirmDelete('删除项目', `将从本机移除《${project.title}》及其节点。`, 'confirm-delete-project', project.id); break;
    case 'confirm-delete-project': {
      library.projects = library.projects.filter(item => item.id !== id);
      if (!library.projects.length) library.projects.push(demoProject());
      switchProject(library.projects[0].id);
      toast('已删除项目');
      break;
    }
    case 'import': importFile.click(); break;
    case 'script-import': returnToImport = false; scriptImport.open(); break;
    case 'script-pick': scriptImport.pick(); break;
    case 'script-analyze': void scriptImport.analyze(); break;
    case 'script-cancel': scriptImport.cancel(); break;
    case 'script-apply': scriptImport.apply(); break;
    case 'choose-beat': chooseBeat(id); break;
    case 'add-node': nodeDialog(null); break;
    case 'next-scene': nodeDialog(null, true); break;
    case 'edit-node': if (focused()) nodeDialog(focused()); break;
    case 'edit-score': scoreDialog(); break;
    case 'delete-node': confirmDelete('删除节点', `将移除「${nodeById(id)?.title || ''}」和它的连线，可撤销。`, 'confirm-delete-node', id); break;
    case 'confirm-delete-node': closeModal(); commit(next => removeNode(next, id)); toast('已删除节点'); break;
    case 'node': selectNode(id); break;
    case 'jump-node': closeModal(); selectNode(id, 'detail', true); break;
    case 'chart-node': selectNode(id, 'detail', true); break;
    case 'pin': makeMainline(id); break;
    case 'unpin': if (focused()) commit(next => { next.mainline = next.mainline.filter(nodeId => nodeId !== state.selected); }); break;
    case 'up-node': reorder(id, -1); break;
    case 'down-node': reorder(id, 1); break;
    case 'compare': compareDialog(); break;
    case 'board': case 'outline': state.view = action; state.linking = false; state.linkStart = null; render(); break;
    case 'panel-ai': case 'panel-detail': state.panel = action.slice(6); renderInspector(); $('#inspector').scrollTop = 0; break;
    case 'angle': state.angle = id; renderInspector(); break;
    case 'scope': state.scope = id; renderInspector(); break;
    case 'link':
      state.linking = !state.linking; state.linkStart = null; state.view = 'board';
      if (state.linking) state.mainlineOnly = false;
      render(); break;
    case 'remove-link': commit(next => { next.links = next.links.filter(link => link.from !== control.dataset.from || link.to !== control.dataset.to); }); break;
    case 'filter': state.mainlineOnly = !state.mainlineOnly; render(true); break;
    case 'undo': case 'redo': navigateHistory(action); break;
    case 'fit': board.fit(); break;
    case 'arrange': commit(arrange, true); break;
    case 'zoom-in': board.zoomTo(board.view.zoom * 1.16); break;
    case 'zoom-out': board.zoomTo(board.view.zoom / 1.16); break;
    case 'zoom-reset': board.zoomTo(1); break;
    case 'toggle-chart': state.chartOpen = !state.chartOpen; render(); break;
    case 'models': modelsDialog(); break;
    case 'node-model': modelsDialog(id); break;
    case 'node-ai': selectNode(id, 'ai', true); break;
    case 'bind-model': bindModel(control.dataset.target, id); break;
    case 'keep-detail': keepDetail(); break;
    case 'new-model': modelDialog(null, control.dataset.target); break;
    case 'edit-model': modelDialog(models.profiles.find(item => item.id === id), control.dataset.target); break;
    case 'select-model': models.active = id; persistModels(); renderInspector(); modelsDialog(); break;
    case 'remove-model':
      models.profiles = models.profiles.filter(item => item.id !== id); keys.delete(id);
      if (models.active === id) models.active = '';
      persistModels(); render(); modelsDialog(); break;
    case 'test-model': void checkModel(control); break;
    case 'generate': void generate(); break;
    case 'cancel-generation': state.generation?.controller.abort(); toast('已取消生成'); break;
    case 'add-candidate': case 'pin-candidate': placeCandidate(control.dataset.round, Number(id), action === 'pin-candidate'); break;
    case 'discard-candidate': commit(next => discardCandidate(control.dataset.round, Number(id), next)); break;
    case 'assess': void assess(); break;
    case 'export': exportDialog(); break;
    case 'download': void download(id, control); break;
  }
});

document.addEventListener('keydown', event => {
  if (modal.open || event.target.matches?.('input,textarea,select,[contenteditable=true]')) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
    event.preventDefault();
    navigateHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
  }
  if (key === 'escape' && state.linking) { state.linking = false; state.linkStart = null; render(); }
});

render(true);
if (hadInvalidStorage) {
  $('#save-state').innerHTML = `${icon('warning-circle')}项目读取失败`;
  $('#save-state').classList.add('error');
  toast('本机旧项目无法读取，当前显示示例。');
} else persist();
fetch('/api/config', { headers: login.headers }).then(response => response.ok ? response.json() : {}).then(({ profile }) => {
  environmentModel = profile || null;
  render();
}).catch(() => {});
