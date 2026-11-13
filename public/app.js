import { StoryBoard } from './board.js';
import { CanvasMenu, divider, menuRow } from './canvas-menu.js';
import { createCommerceUI } from './commerce-ui.js';
import { demoProject } from './demo.js';
import { EmotionChart } from './emotion.js';
import { projectHome } from './home.js';
import { playOpening } from './launch.js';
import { enterWorkspace } from './login.js';
import { methodGuide, methodPicker } from './method-picker.js';
import { methodFor, stageFor } from './methods.js';
import { createModelUI } from './model-ui.js';
import { NodeComposer, canGenerate } from './node-composer.js';
import { createScriptImport } from './script-import.js';
import { BEATS, COLUMN, FORMATS, IDEA_DIRECTIONS, LINK_LIMIT, NODE_HEIGHT, NODE_LIMIT, NODE_TYPES, PROMPT_LIMIT, STROKE_LIMIT, beatName,
  cleanText, ideaPositions, isIdeaCount, isIdeaDirection, mainlineNodes, makeNode, newId, newProject, normalizeProject, pinNode,
  positionFor, removeNodes, upstreamNodes } from './story.js';
import { $, button, escape, field, icon, iconButton, signed } from './ui.js';

playOpening();
const login = await enterWorkspace();
const projectKey = `zhimu.projects.${login.account.id}.v1`;
const legacyModelKey = `zhimu.models.${login.account.id}.v1`;
const modal = $('#modal');
const importFile = $('#import-file');
const idData = id => `data-id="${escape(id)}"`;
const value = (data, name) => String(data.get(name) ?? '').trim();

const canvasState = {
  screen: 'home', selected: null, selection: new Set(), roundId: null, optionIndex: 0, recent: new Set(),
  generation: null, assessment: null, arriving: false, chartOpen: true,
};
const history = { undo: [], redo: [] };
let invalidStorage = false;
const library = readLibrary();
let project = library.projects.find(item => item.id === library.active);
let pendingDraft = null;
let draftTimer;
let saveTimer;
let toastTimer;
let menuPoint;
let methodSelection;
const chart = new EmotionChart();
const menu = new CanvasMenu();
const composer = new NodeComposer();
const board = new StoryBoard({
  selection: selectNodes, move: moveNodes, edit: editNode, connect, references: referencesDialog, menu: canvasMenu,
  createMenu: nodePicker, closeMenu: () => menu.close(), viewportChanged: updateViewport,
  place: placeNode, stroke: addStroke, drop: openFile, notice: toast,
});
const modelUI = createModelUI({ modal, show: showModal, api, legacyKey: legacyModelKey, notice: toast, onChange: () => {
  if (canvasState.screen === 'canvas') { saveDraft(); renderCanvas(); }
} });
const commerce = createCommerceUI({ modal, show: showModal, api, notice: toast, onChange: (access, changed) => {
  $('#method-gift').hidden = access.unlocked;
  if (changed && canvasState.screen === 'canvas') { saveDraft(); renderCanvas(); }
} });
const scriptImport = createScriptImport({ modal, show: showModal, headers: login.headers, api,
  profiles: modelUI.ordinary, defaultProfile: modelUI.defaultProfile, useProfile: profile => useProfile(profile, scriptImport.open),
  onApply: applyImport, notice: toast });

function nodeById(id) { return project?.nodes.find(node => node.id === id); }
function focus() { return nodeById(canvasState.selected); }

function migrate(raw) {
  const next = normalizeProject(raw);
  if (!next.referenceNodesMigrated) {
    const x = Math.min(0, ...next.nodes.map(node => node.x)) - COLUMN;
    const y = Math.min(0, ...next.nodes.map(node => node.y));
    const metadata = [
      ['premise', { kind: 'text', title: '项目梗概', script: next.premise, x, y }],
      ['constraints', { kind: 'setting', title: '共享设定', script: next.constraints, x, y: y + NODE_HEIGHT + 44 }],
    ];
    for (const [key, item] of metadata) {
      if (!item.script || next.nodes.length >= NODE_LIMIT) continue;
      const node = makeNode(item);
      next.nodes.push(node);
      next.referenceNodeIds[key] = node.id;
    }
    next.referenceNodesMigrated = true;
  }
  for (const round of next.proposals) {
    if (round.focus) continue;
    const match = mainlineNodes(next).find(node => node.beat === round.beat) || next.nodes.find(node => node.kind === 'plot');
    if (match) round.focus = match.id;
  }
  return next;
}

function readLibrary() {
  try {
    const raw = localStorage.getItem(projectKey);
    if (raw) {
      const data = JSON.parse(raw);
      const projects = data.projects.map(migrate);
      return { projects, active: projects.find(item => item.id === data.active)?.id ?? projects[0]?.id ?? null };
    }
  } catch { invalidStorage = true; }
  return { projects: [migrate(demoProject())], active: 'rain-demo' };
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 4600);
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    if (invalidStorage) {
      const old = localStorage.getItem(projectKey);
      if (old) localStorage.setItem(`${projectKey}.recovery`, old);
      invalidStorage = false;
    }
    localStorage.setItem(projectKey, JSON.stringify(library));
  }
  catch { toast('本机空间不足或保存被禁用。可导出项目 JSON 保存这次编辑。'); }
}

function replaceProject(next, record = true, defer = false) {
  if (record) {
    history.undo.push(project);
    if (history.undo.length > 25) history.undo.shift();
    history.redo.length = 0;
  }
  library.projects[library.projects.findIndex(item => item.id === next.id)] = next;
  project = next;
  if (defer) saveTimer ??= setTimeout(persist, 260);
  else persist();
}

function commit(change) {
  saveDraft();
  const next = structuredClone(project);
  change(next);
  replaceProject(next);
  if (canvasState.screen === 'canvas') renderCanvas();
  else renderHome();
}

function saveDraft() {
  clearTimeout(draftTimer);
  const draft = pendingDraft;
  pendingDraft = null;
  const old = draft && nodeById(draft.id);
  if (!old) return false;
  const title = cleanText(draft.title, 100) || NODE_TYPES[old.kind].title;
  const key = canGenerate(old) ? 'prompt' : 'script';
  const body = cleanText(draft.body, key === 'prompt' ? PROMPT_LIMIT : 30000);
  const updates = { title, [key]: body };
  if (old.kind === 'idea') updates.prompt = cleanText(draft.ideaPrompt, PROMPT_LIMIT);
  if (Object.entries(updates).every(([field, value]) => old[field] === value)) return false;
  const nodes = project.nodes.map(node => node.id === old.id ? { ...node, ...updates } : node);
  replaceProject({ ...project, nodes }, true, true);
  return true;
}

function navigateHistory(direction) {
  saveDraft();
  const next = history[direction].pop();
  if (!next) return;
  history[direction === 'undo' ? 'redo' : 'undo'].push(project);
  replaceProject(next, false);
  assignSelection([...canvasState.selection].filter(nodeById));
  canvasState.optionIndex = 0;
  renderCanvas();
}

function stopJobs() {
  canvasState.generation?.controller.abort();
  canvasState.assessment?.controller.abort();
  canvasState.generation = canvasState.assessment = null;
}

function renderHome() {
  $('#workspace-screen').hidden = true;
  $('#home-header').hidden = false;
  $('#home-screen').hidden = false;
  $('#home-screen').innerHTML = projectHome(library.projects);
  document.title = '枝幕 · 剧本创作画布';
}

function goHome() {
  saveDraft();
  stopJobs();
  menu.close();
  board.cancelLink();
  closeModal();
  canvasState.screen = 'home';
  assignSelection([]);
  composer.render({ node: null });
  renderHome();
}

function openProject(id) {
  const next = library.projects.find(item => item.id === id);
  if (!next) return;
  saveDraft();
  stopJobs();
  menu.close();
  closeModal();
  board.cancelLink();
  project = library.projects.find(item => item.id === id);
  library.active = id;
  Object.assign(canvasState, { screen: 'canvas', recent: new Set(), arriving: false });
  assignSelection([]);
  changeTool('select');
  history.undo.length = history.redo.length = 0;
  $('#home-header').hidden = $('#home-screen').hidden = true;
  $('#workspace-screen').hidden = false;
  document.title = `${project.title} · 枝幕`;
  if (!invalidStorage) persist();
  renderCanvas();
  board.fit();
  board.viewport.focus({ preventScroll: true });
}

function nodeRounds(id) { return project.proposals.filter(round => round.focus === id); }
function currentRound(rounds = nodeRounds(canvasState.selected)) {
  return rounds.find(round => round.id === canvasState.roundId) || rounds.at(-1);
}

function ideaBranches(source) {
  const connected = new Set(project.links.filter(link => link.from === source.id).map(link => link.to));
  return project.nodes.filter(node => node.kind === 'idea' && node.origin === source.id && connected.has(node.id));
}

function drawCards() {
  const models = modelUI.ordinary();
  board.update(project, { selected: canvasState.selection, generating: canvasState.generation?.nodeId,
    recent: canvasState.recent, modelLabel: node => modelUI.modelName(node, models) });
  canvasState.recent = new Set();
}

function renderCanvas() {
  $('#canvas-empty').hidden = project.nodes.length > 0;
  const activeMethod = methodFor(project.method);
  $('#current-method span').textContent = activeMethod.name;
  $('[data-action=group-nodes]', board.viewport).disabled = canvasState.selection.size < 2;
  const scroll = $('#chart-scroll');
  scroll.hidden = !canvasState.chartOpen;
  const toggle = $('#chart-toggle');
  const label = canvasState.chartOpen ? '折叠曲线' : '展开曲线';
  toggle.setAttribute('aria-expanded', String(canvasState.chartOpen));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  toggle.innerHTML = icon(canvasState.chartOpen ? 'caret-down' : 'caret-up');
  const assessButton = $('#assess-button');
  assessButton.disabled = !project.mainline.length;
  assessButton.innerHTML = canvasState.assessment ? `${icon('stop')}<span>停止标注</span>` : `${icon('sparkle')}<span>AI 标注</span>`;
  drawCards();
  chart.update(project, canvasState.selected);
  const node = focus();
  const rounds = node ? nodeRounds(node.id) : [];
  const round = currentRound(rounds);
  const refs = node ? project.links.filter(link => link.to === node.id).map(link => nodeById(link.from)).filter(Boolean) : [];
  composer.render({ node, refs, indirect: node ? Math.max(0, upstreamNodes(project, [node.id]).length - refs.length) : 0,
    models: modelUI.ordinary(), profile: modelUI.forNode(node), job: canvasState.generation, rounds, round,
    method: methodFor(project.method, commerce.access.guide), guided: Boolean(commerce.access.guide),
    index: Math.min(canvasState.optionIndex, (round?.options.length || 1) - 1), arriving: canvasState.arriving,
    children: node?.kind === 'idea' ? ideaBranches(node) : [] });
  canvasState.arriving = false;
  composer.position(board);
}

function assignSelection(ids) {
  const selection = new Set(ids);
  const changed = selection.size !== canvasState.selection.size || [...selection].some(id => !canvasState.selection.has(id));
  canvasState.selection = selection;
  canvasState.selected = selection.size === 1 ? selection.values().next().value : null;
  if (changed) Object.assign(canvasState, { roundId: null, optionIndex: 0, arriving: false });
  return changed;
}

function selectNodes(ids) {
  const saved = saveDraft();
  if (assignSelection([...ids].filter(nodeById)) || saved) renderCanvas();
}

function selectNode(id, reveal = false) {
  selectNodes(id ? [id] : []);
  if (reveal) board.reveal(id);
}

function moveNodes(ids, dx, dy) {
  if (!dx && !dy) { selectNodes(ids); return; }
  saveDraft();
  assignSelection(ids);
  const nodes = project.nodes.map(node => canvasState.selection.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node);
  replaceProject({ ...project, nodes }, true, true);
  renderCanvas();
}

function updateViewport(zoom, moving) {
  const display = `${Math.round(zoom * 100)}%`;
  const label = $('#zoom-value');
  if (label.textContent !== display) label.textContent = display;
  if (!moving) composer.position(board);
}

function changeTool(tool) {
  board.setTool(tool);
  for (const control of board.viewport.querySelectorAll('[data-action=board-tool]')) {
    control.setAttribute('aria-pressed', String(control.dataset.id === tool));
  }
}

function placeNode(kind, clientX, clientY) {
  changeTool('select');
  createNode(kind, { clientX, clientY });
}

function addStroke(points) {
  if (project.strokes.length >= STROKE_LIMIT) { toast('画笔标注已达到项目上限。可先清除已有标注。'); return; }
  commit(next => next.strokes.push(points.map(point => point.map(value => Math.round(value * 10) / 10))));
}

function showModal(title, body, wide = false) {
  menu.close();
  modal.classList.toggle('wide-modal', wide);
  modal.innerHTML = `<header class="modal-header"><h2 id="modal-title">${escape(title)}</h2>${iconButton('close-modal', '关闭', 'x')}</header>
    <div class="modal-body">${body}</div>`;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}

function closeModal() { if (modal.open) modal.close(); }

function formFooter(label = '保存') {
  return `<p class="modal-error" role="alert" hidden></p><div class="modal-footer">
    ${button('close-modal', '取消')}<button type="submit" class="button primary">${escape(label)}</button></div>`;
}

async function api(path, body, signal) {
  const response = await fetch(path, body === undefined ? { headers: login.headers, signal } : {
    method: 'POST', headers: { ...login.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '请求失败，请重试。');
  return response;
}

function useProfile(profile, back) {
  if (profile) return { id: profile.id };
  modelUI.open(back);
  return null;
}

function below(control, right = false) {
  const rect = control.getBoundingClientRect();
  return { clientX: right ? rect.right - 224 : rect.left, clientY: rect.bottom + 6, anchor: control };
}

function canvasMenu(point) {
  menuPoint = point;
  const group = project.groups.find(item => item.id === point.groupId);
  if (group) {
    selectNodes(group.nodes);
    menu.show(point, [menuRow('rename-group', '重命名分组', 'note-pencil', { id: group.id }),
      menuRow('ungroup', '取消分组', 'stack', { id: group.id }), divider,
      menuRow('delete-selection', `删除 ${group.nodes.length} 个节点`, 'trash', { trailing: 'Delete', danger: true })].join(''));
    return;
  }
  const node = nodeById(point.nodeId);
  if (node) {
    if (!canvasState.selection.has(node.id)) selectNode(node.id);
    const anchor = $('.node-face', board.elements.get(node.id));
    if (canvasState.selection.size > 1) {
      menu.show({ ...point, anchor }, [menuRow('group-nodes', '将所选节点分组', 'stack'), divider,
        menuRow('delete-selection', `删除 ${canvasState.selection.size} 个节点`, 'trash', { trailing: 'Delete', danger: true })].join(''));
      return;
    }
    const pinned = project.mainline.includes(node.id);
    menu.show({ ...point, anchor }, [
      menuRow('edit-node', '编辑节点', 'note-pencil', { id: node.id }),
      menuRow('references', '添加参考', 'link-simple', { id: node.id }),
      node.kind === 'idea' ? menuRow('develop-idea', '展开为剧情节点', 'git-branch', { id: node.id }) : '',
      node.kind === 'plot' ? menuRow('toggle-mainline', pinned ? '移出主线' : '纳入主线', 'list-numbers', { id: node.id }) : '',
      node.kind === 'plot' ? menuRow('edit-score', '标注情绪与张力', 'wave-sine', { id: node.id }) : '',
      divider, menuRow('delete-node', '删除节点', 'trash', { id: node.id, trailing: 'Delete', danger: true }),
    ].join(''));
  } else {
    menu.show(point, [
      menuRow('node-picker', '添加节点', 'plus', { trailing: 'Insert' }),
      menuRow('script-import', '导入剧本', 'upload-simple'),
      divider,
      menuRow('method', '创作方法', 'compass', { trailing: methodFor(project.method).id === 'free' ? '' : '已选' }),
      menuRow('mainline', '主线大纲', 'list-bullets'),
      menuRow('export', '导出', 'export'),
      menuRow('fit', '适配画布', 'corners-out'),
      project.strokes.length ? menuRow('clear-ink', '清除画笔标注', 'eraser') : '',
      divider,
      menuRow('undo', '撤销', 'arrow-counter-clockwise', { trailing: 'Ctrl+Z', disabled: !history.undo.length && !pendingDraft }),
      menuRow('redo', '重做', 'arrow-clockwise', { trailing: 'Ctrl+Shift+Z', disabled: !history.redo.length }),
    ].join(''));
  }
}

function nodePicker(point) {
  menuPoint = point;
  menu.show(point, `<div class="menu-title">${point.sourceId ? '新建并接入参考' : '添加节点'}</div>
    <input type="search" class="menu-search" id="node-search" aria-label="搜索节点类型" placeholder="搜索节点">
    ${Object.entries(NODE_TYPES).map(([id, type]) => menuRow('create-node', type.label, type.icon, { id })).join('')}`, { search: true });
}

function createNode(kind, point = menuPoint) {
  if (!Object.hasOwn(NODE_TYPES, kind) || !point) return;
  if (board.tool !== 'select') changeTool('select');
  if (project.nodes.length >= NODE_LIMIT) { toast('该项目已达到 500 个节点。'); return; }
  const sourceId = nodeById(point.sourceId)?.id;
  if (sourceId && project.links.length >= LINK_LIMIT) { toast('该项目已达到连线上限。'); return; }
  const position = point.position || board.toWorld(point.clientX, point.clientY);
  const node = makeNode({ kind, title: NODE_TYPES[kind].title, x: Math.round(position.x), y: Math.round(position.y),
    modelId: kind === 'agent' ? 'agent' : null });
  assignSelection([node.id]);
  canvasState.recent = new Set([node.id]);
  commit(next => {
    next.nodes.push(node);
    if (sourceId) next.links.push({ from: sourceId, to: node.id });
  });
  board.reveal(node.id);
  const title = $('#composer-title');
  title.focus({ preventScroll: true });
  title.select();
}

function connect(from, to) {
  if (!nodeById(from) || !nodeById(to)) return;
  if (from === to || upstreamNodes(project, [from]).some(node => node.id === to)) { toast('这条线会让参考循环。'); return; }
  if (project.links.some(link => link.from === from && link.to === to)) { toast('此参考已接入。'); return; }
  if (project.links.length >= LINK_LIMIT) { toast('该项目已达到连线上限。'); return; }
  saveDraft();
  assignSelection([to]);
  commit(next => next.links.push({ from, to }));
}

function developIdea(id) {
  saveDraft();
  const source = nodeById(id);
  if (source?.kind !== 'idea') return;
  if (project.nodes.length >= NODE_LIMIT || project.links.length >= LINK_LIMIT) {
    toast('当前项目已达到节点或连线上限。');
    return;
  }
  const node = makeNode({ kind: 'plot', title: source.title === NODE_TYPES.idea.title ? '展开点子' : source.title,
    origin: source.id, prompt: '把连入的点子发展成一段剧情，写清人物的行动、遇到的阻力和场尾变化。',
    ...positionFor(project, 'scene', source) });
  assignSelection([node.id]);
  canvasState.recent = new Set([node.id]);
  commit(next => {
    next.nodes.push(node);
    next.links.push({ from: source.id, to: node.id });
  });
  board.reveal(node.id);
}

function deleteNodes(ids) {
  const selected = new Set([...ids].filter(nodeById));
  if (!selected.size) return;
  if (selected.has(canvasState.generation?.nodeId)) {
    canvasState.generation.controller.abort();
    canvasState.generation = null;
  }
  assignSelection([...canvasState.selection].filter(id => !selected.has(id)));
  commit(next => removeNodes(next, selected));
  board.viewport.focus({ preventScroll: true });
  toast(`已删除 ${selected.size} 个节点，按 Ctrl+Z 撤回。`);
}

function groupNodes() {
  const ids = canvasState.selection;
  if (ids.size < 2) return;
  if (project.groups.some(group => group.nodes.length === ids.size && group.nodes.every(id => ids.has(id)))) return;
  commit(next => {
    next.groups = next.groups.map(group => ({ ...group, nodes: group.nodes.filter(id => !ids.has(id)) })).filter(group => group.nodes.length >= 2);
    next.groups.push({ id: newId(), title: '节点分组', nodes: [...ids] });
  });
  board.viewport.focus({ preventScroll: true });
}

function groupDialog(id) {
  const group = project.groups.find(item => item.id === id);
  if (!group) return;
  showModal('重命名分组', `<form data-form="group" ${idData(id)}>${field('title', '名称', group.title, { required: true, max: 80 })}${formFooter()}</form>`);
}

function findNodes() {
  showModal('查找节点', `${field('find-canvas-node', '节点名或内容', '', { placeholder: '输入关键词' })}
    <div id="find-node-results" class="find-node-results"></div>`);
  updateFoundNodes('');
  $('#field-find-canvas-node').focus();
}

function updateFoundNodes(input) {
  const query = input.trim().toLocaleLowerCase();
  const results = project.nodes.filter(node => [node.title, node.action, node.script, node.prompt].some(text => text.toLocaleLowerCase().includes(query)));
  $('#find-node-results').innerHTML = results.slice(0, 35).map(node => `<button type="button" class="list-row" data-action="reveal-node" ${idData(node.id)}>
    ${icon(NODE_TYPES[node.kind].icon)}<span class="list-label"><strong>${escape(node.title)}</strong><small>${NODE_TYPES[node.kind].label}</small></span></button>`).join('') || '<p class="muted">没有匹配的节点。</p>';
}

function referencesDialog(id) {
  selectNode(id);
  const target = focus();
  if (!target) return;
  const refs = upstreamNodes(project, [id]);
  const direct = new Set(project.links.filter(link => link.to === id).map(link => link.from));
  const downstream = new Set([id]);
  const queue = [id];
  for (let index = 0; index < queue.length; index += 1) {
    for (const link of project.links) {
      if (link.from === queue[index] && !downstream.has(link.to)) {
        downstream.add(link.to);
        queue.push(link.to);
      }
    }
  }
  const existing = refs.map(node => `<div class="list-row">${icon(NODE_TYPES[node.kind].icon)}
    <span class="list-label"><strong>${escape(node.title)}</strong><small>${direct.has(node.id) ? '直接参考' : '上游参考'}</small></span>
    ${direct.has(node.id) ? iconButton('disconnect-reference', `移除参考 ${node.title}`, 'x', idData(node.id)) : ''}</div>`).join('');
  const choices = project.nodes.filter(node => !downstream.has(node.id) && !direct.has(node.id));
  showModal('节点参考', `${existing ? `<div class="reference-list">${existing}</div>` : ''}
    <section class="settings-section${existing ? ' has-references' : ''}"><div class="section-label"><h3>接入已有节点</h3></div>
      <div class="reference-list">${choices.map(node => `<button type="button" class="list-row" data-action="connect-reference" ${idData(node.id)}>
      ${icon(NODE_TYPES[node.kind].icon)}<span class="list-label"><strong>${escape(node.title)}</strong><small>${NODE_TYPES[node.kind].label}</small></span>${icon('plus')}</button>`).join('')
      || '<p class="muted">画布上没有可接入的节点。</p>'}</div></section>`);
}

function projectDialog(id) {
  const item = library.projects.find(entry => entry.id === id);
  showModal(item ? '编辑项目' : '新建画布', `<form data-form="project" ${item ? idData(item.id) : ''}>
    ${field('title', '项目名称', item?.title, { required: true, placeholder: '给故事起个名字' })}
    ${field('format', '作品体量', item?.format || '短片', { type: 'select', choices: FORMATS.map(format => [format, format]) })}
    ${formFooter(item ? '保存' : '创建画布')}</form>`);
}

function methodDialog(first = false, selected = first ? 'three-act' : project.method) {
  methodSelection = { first, selected };
  showModal('选择创作方法', methodPicker(selected, first, methodOptions(selected)), true);
}

function methodOptions(id) {
  const used = new Set(project.nodes.filter(node => node.methodStage && (node.action || node.script)).map(node => node.methodStage));
  return { guide: commerce.access.guide, unlocked: commerce.access.unlocked, preview: commerce.access.preview,
    used, current: id === project.method ? focus()?.methodStage : '' };
}

function addStarterQuestion() {
  const node = focus();
  const input = $('#composer-body');
  if (!node || !input) return;
  const guide = commerce.access.guide;
  if (!guide) return;
  const method = methodFor(project.method, guide);
  const starter = stageFor(method.id, node.methodStage, guide)?.question || method.start;
  if (!input.value.includes(starter)) {
    input.value = [input.value.trimEnd(), starter].filter(Boolean).join('\n').slice(0, PROMPT_LIMIT);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.focus({ preventScroll: true });
}

const plotFields = [
  ['action', '情节动作', 2400], ['reason', '前因', 1400], ['consequence', '后果', 1400],
  ['clue', '伏笔与回收', 1200], ['tradeoff', '联动修改', 1200], ['fixedDetails', '沿用细节', 1600],
  ['evidence', '原文依据', 500], ['script', '场景正文', 30000],
];

function editNode(id) {
  selectNode(id);
  const node = focus();
  if (!canGenerate(node)) { $('#composer-body')?.focus(); return; }
  const pinned = project.mainline.includes(id);
  const textField = ([key, label, max]) => field(key, label, node[key], { type: 'textarea', max, rows: key === 'script' ? 5 : 2 });
  showModal(`编辑${NODE_TYPES[node.kind].label}节点`, `<form data-form="node" ${idData(id)}>
    ${field('title', '节点标题', node.title, { required: true })}
    ${node.kind === 'plot' && node.beat !== 'scene' ? field('beat', '原节拍', node.beat, { type: 'select', choices: Object.entries(BEATS).map(([key, beat]) => [key, beat.name]) }) : ''}
    ${plotFields.slice(0, 3).map(textField).join('')}
    <details class="editor-details"><summary>伏笔、沿用细节与场景正文</summary>${plotFields.slice(3).map(textField).join('')}</details>
    ${pinned ? '<p class="field-hint">主线的每个固定节拍保留一个节点。</p>' : ''}
    ${formFooter('保存节点')}</form>`);
}

function scoreDialog(id) {
  const node = nodeById(id);
  if (node?.kind !== 'plot') return;
  showModal('标注情绪与张力', `<p>${escape(node.title)}。分值留空表示待标注。</p><form data-form="score" ${idData(id)}>
    <div class="modal-grid">${field('valence', '情绪（−5 到 +5）', node.valence ?? '', { type: 'number', min: -5, upper: 5 })}
    ${field('tension', '张力（0 到 10）', node.tension ?? '', { type: 'number', min: 0, upper: 10 })}</div>
    ${field('emotionNote', '标注依据', node.emotionNote, { type: 'textarea', max: 800 })}
    ${formFooter()}</form>`);
}

function mainlineDialog() {
  const nodes = mainlineNodes(project);
  showModal('主线大纲', `<div class="mainline-list">${nodes.map((node, index) =>
    `<div class="list-row"><span class="hint">${index + 1}</span><span class="list-label"><strong>${escape(node.title)}</strong>
    <small>${escape(stageFor(project.method, node.methodStage)?.label || beatName(node.beat))} · 情绪 ${signed(node.valence)} · 张力 ${node.tension ?? '待标注'}</small></span>
    ${button('reorder-up', '上移', { style: 'quiet compact', data: idData(node.id), disabled: index === 0 })}
    ${button('reorder-down', '下移', { style: 'quiet compact', data: idData(node.id), disabled: index === nodes.length - 1 })}
    ${iconButton('edit-score', '标注情绪与张力', 'wave-sine', idData(node.id))}</div>`).join('')
    || '<p class="muted">右键点击剧情节点，选择「纳入主线」。</p>'}</div>`);
}

function toggleMainline(id) {
  const node = nodeById(id);
  if (node?.kind !== 'plot') return;
  const included = project.mainline.includes(id);
  commit(next => {
    if (included) next.mainline = next.mainline.filter(item => item !== id);
    else pinNode(next, next.nodes.find(item => item.id === id));
  });
  toast(included ? '已移出主线' : '已纳入主线');
}

function reorder(id, delta) {
  const index = project.mainline.indexOf(id);
  const to = index + delta;
  if (index < 0 || to < 0 || to >= project.mainline.length) return;
  commit(next => { [next.mainline[index], next.mainline[to]] = [next.mainline[to], next.mainline[index]]; });
  mainlineDialog();
}

function confirmDeleteProject(id, title) {
  showModal('删除项目', `<p>删除「${escape(title)}」？</p><div class="modal-footer">
    ${button('close-modal', '取消')}${button('confirm-project-delete', '删除', { style: 'danger', data: idData(id) })}
    </div>`);
}

function signature(snapshot, targets) {
  const ids = new Set(targets);
  for (const node of upstreamNodes(snapshot, targets)) ids.add(node.id);
  const nodes = snapshot.nodes.filter(node => ids.has(node.id)).map(({ x, y, ...node }) => node);
  const links = snapshot.links.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  return JSON.stringify([snapshot.format, snapshot.method, targets, nodes, links]);
}

async function generate() {
  const selected = focus();
  const isIdea = selected?.kind === 'idea';
  if (canvasState.generation || (!isIdea && !canGenerate(selected))) return;
  saveDraft();
  const node = focus();
  const model = modelUI.forNode(node);
  const profile = useProfile(model);
  if (!profile) return;
  if (isIdea && !hasRoomForIdeas(node.ideaCount)) return;
  if (!isIdea && !node.prompt && ![node, ...upstreamNodes(project, [node.id])].some(item => item.action || item.script || item.fixedDetails || item.consequence)) {
    toast('填写生成要求，或接入有内容的参考节点。');
    $('#composer-body')?.focus();
    return;
  }
  const controller = new AbortController();
  const job = { controller, nodeId: node.id, projectId: project.id };
  const snapshot = project;
  const context = signature(snapshot, [node.id]);
  canvasState.generation = job;
  renderCanvas();
  try {
    const input = { profile, project: snapshot, focusId: node.id };
    if (isIdea) Object.assign(input, { ideaCount: node.ideaCount, ideaDirection: node.ideaDirection });
    else input.request = node.prompt;
    const response = await api(isIdea ? '/api/ai/brainstorm' : '/api/ai/suggest', input, controller.signal);
    const result = await response.json();
    if (canvasState.generation !== job || project.id !== job.projectId || !nodeById(job.nodeId)) return;
    saveDraft();
    const changed = signature(project, [node.id]) !== context;
    if (isIdea) {
      placeIdeas(node.id, result.ideas, model, changed);
      return;
    }
    const round = { id: newId(), focus: node.id, beat: node.beat, methodStage: node.methodStage, scope: 'beat', label: node.title,
      modelSource: model.name || model.model, modelId: model.id, options: result.options };
    canvasState.generation = null;
    if (canvasState.selected === node.id) Object.assign(canvasState, { roundId: round.id, optionIndex: 0, arriving: true });
    commit(next => {
      next.proposals.push(round);
      const target = next.nodes.find(item => item.id === node.id);
      target.modelId ||= profile.id;
    });
    if (changed) toast('生成期间引用或节点发生变化，本轮结果已作为候选保留。');
    else if (canvasState.selected !== node.id) toast(`「${node.title}」的方案已生成`);
  } catch (error) {
    if (canvasState.generation === job) toast(controller.signal.aborted ? '生成已停止' : error.message);
  } finally {
    if (canvasState.generation === job) {
      canvasState.generation = null;
      saveDraft();
      renderCanvas();
    }
  }
}

function hasRoomForIdeas(count) {
  if (project.nodes.length + count <= NODE_LIMIT && project.links.length + count <= LINK_LIMIT) return true;
  toast('画布剩余空间不足，请减少点子数量或先删除不用的节点。');
  return false;
}

function placeIdeas(sourceId, ideas, model, changed) {
  if (!hasRoomForIdeas(ideas.length)) return;
  const source = nodeById(sourceId);
  const positions = ideaPositions(project, source, ideas.length);
  const children = ideas.map(({ title, body }, index) => makeNode({ kind: 'idea', title, script: body, origin: sourceId,
    modelId: model.id, modelSource: model.name || model.model, ...positions[index] }));
  const showBatch = canvasState.selected === sourceId && !board.gesture;
  canvasState.generation = null;
  if (showBatch) assignSelection([]);
  canvasState.recent = new Set(children.map(node => node.id));
  commit(next => {
    next.nodes.push(...children);
    next.links.push(...children.map(node => ({ from: sourceId, to: node.id })));
    next.nodes.find(node => node.id === sourceId).modelId ||= model.id;
  });
  if (showBatch) {
    board.fit([sourceId, ...children.map(node => node.id)]);
    board.viewport.focus({ preventScroll: true });
  }
  toast(`已生成 ${children.length} 个点子节点。${changed ? '本轮使用了发散开始时的素材。' : '按 Ctrl+Z 可整批撤回。'}`);
}

function chooseIdeaDirection(direction, refocus = false) {
  const node = focus();
  if (node?.kind !== 'idea' || !isIdeaDirection(direction)) return;
  if (direction !== node.ideaDirection) {
    commit(next => { next.nodes.find(item => item.id === node.id).ideaDirection = direction; });
  }
  if (refocus) $(`#idea-tab-${direction}`)?.focus({ preventScroll: true });
}

function chosenCandidate() {
  const round = currentRound();
  if (!round) return null;
  const index = Math.min(canvasState.optionIndex, round.options.length - 1);
  return { round, option: round.options[index] };
}

function candidateDetail() {
  const picked = chosenCandidate();
  if (!picked) return;
  const { option } = picked;
  showModal(option.title, `<div class="analysis-result">
    ${plotFields.filter(([key]) => option[key]).map(([key, label]) =>
      `<div class="analysis-note"><h4>${label}</h4><p>${escape(option[key])}</p></div>`).join('')}
    ${option.valence !== null || option.tension !== null ? `<p>情绪 ${signed(option.valence)} · 张力 ${option.tension ?? '待标注'} ${escape(option.emotionNote)}</p>` : ''}
    <div class="modal-footer">${button('branch-candidate', '创建分支', { glyph: 'git-branch' })}
      ${button('apply-candidate', '应用到节点', { glyph: 'check', style: 'primary' })}</div></div>`);
}

function useCandidate(branch) {
  saveDraft();
  const picked = chosenCandidate();
  const current = focus();
  if (!picked || !current) return;
  const { round, option } = picked;
  if (branch && (project.nodes.length >= NODE_LIMIT || project.links.length >= LINK_LIMIT)) {
    toast('当前项目已达到节点或连线上限。');
    return;
  }
  closeModal();
  if (branch) {
    const node = makeNode({ ...option, kind: 'plot', beat: round.beat, methodStage: round.methodStage, origin: current.id, modelSource: round.modelSource,
      modelId: round.modelId === 'agent' ? null : round.modelId, ...positionFor(project, round.beat, current) });
    assignSelection([node.id]);
    canvasState.recent = new Set([node.id]);
    commit(next => {
      next.nodes.push(node);
      next.links.push({ from: current.id, to: node.id });
    });
    board.reveal(node.id);
    toast('已创建并连接分支');
  } else {
    commit(next => {
      const node = next.nodes.find(item => item.id === current.id);
      Object.assign(node, option, { script: option.script || node.script, evidence: option.evidence || node.evidence, modelSource: round.modelSource });
    });
    toast('已应用到节点');
  }
}

async function assess() {
  if (canvasState.assessment) { canvasState.assessment.controller.abort(); return; }
  saveDraft();
  if (!project.mainline.length) return;
  const profile = useProfile((focus()?.kind === 'plot' && modelUI.forNode(focus())) || modelUI.defaultProfile());
  if (!profile) return;
  const controller = new AbortController();
  const job = { controller, projectId: project.id };
  const snapshot = project;
  const context = signature(snapshot, snapshot.mainline);
  canvasState.assessment = job;
  canvasState.chartOpen = true;
  renderCanvas();
  try {
    const response = await api('/api/ai/assess', { profile, project: snapshot }, controller.signal);
    const { marks } = await response.json();
    if (canvasState.assessment !== job || project.id !== job.projectId) return;
    saveDraft();
    if (signature(project, project.mainline) !== context) {
      toast('主线或参考已修改，请重新标注。');
      return;
    }
    const byId = new Map(marks.map(({ id, ...mark }) => [id, mark]));
    canvasState.assessment = null;
    commit(next => {
      for (const node of next.nodes) if (byId.has(node.id)) Object.assign(node, byId.get(node.id));
    });
    toast(`已标注 ${marks.length} 个主线节点`);
  } catch (error) {
    if (canvasState.assessment === job) toast(controller.signal.aborted ? '已停止标注' : error.message);
  } finally {
    if (canvasState.assessment === job) {
      canvasState.assessment = null;
      saveDraft();
      renderCanvas();
    }
  }
}

function addProject(item, chooseMethod = false) {
  library.projects.push(item);
  openProject(item.id);
  if (invalidStorage) persist();
  if (chooseMethod) methodDialog(true);
}

function applyImport(result) {
  const imported = newProject(result);
  for (const [index, plot] of result.nodes.entries()) {
    const node = makeNode({ ...plot, modelId: result.modelId, modelSource: result.modelSource,
      origin: imported.nodes.at(-1)?.id, x: index * COLUMN, y: 0 });
    imported.nodes.push(node);
    imported.mainline.push(node.id);
  }
  addProject(migrate(imported), true);
  toast(`剧本已拆为 ${imported.mainline.length} 个主线节点`);
}

async function openFile(file) {
  if (!file) return;
  if (!/\.json$/i.test(file.name)) {
    scriptImport.open();
    void scriptImport.read(file);
    return;
  }
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('项目文件超出 20 MB。');
    const next = migrate(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
    next.id = newId();
    addProject(next);
    toast('项目备份已导入');
  } catch (error) { toast(error instanceof SyntaxError ? '文件不是可读取的 JSON。' : error.message); }
}

const formats = { docx: ['Word', 'file-doc'], pdf: ['PDF', 'file-pdf'], md: ['Markdown', 'text-aa'],
  txt: ['纯文本', 'file-text'], json: ['项目 JSON', 'archive'] };

function exportDialog() {
  saveDraft();
  showModal('导出', `<p>文档包含主线、情绪标注和沿用的参考。项目 JSON 可恢复整张画布。</p>
    <div class="settings-list">${Object.entries(formats).map(([id, [label, glyph]]) =>
      `<button type="button" class="list-row" data-action="download" ${idData(id)}>${icon(glyph)}
      <span class="list-label"><strong>${label}</strong></span><small class="hint">.${id}</small></button>`).join('')}</div>`);
}

async function download(format, control) {
  if (!Object.hasOwn(formats, format)) return;
  saveDraft();
  const snapshot = project;
  const title = snapshot.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70).replace(/[. ]+$/, '') || '枝幕项目';
  control.disabled = true;
  try {
    const blob = format === 'json' ? new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
      : await (await api(`/api/export/${format}`, { project: snapshot })).blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title}${format === 'json' ? '' : '_主线大纲'}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (control.isConnected) closeModal();
  } catch (error) { toast(error.message); }
  finally { control.disabled = false; }
}

modal.addEventListener('submit', event => {
  const form = event.target;
  const type = form.dataset.form;
  if (!['project', 'node', 'score', 'method', 'group'].includes(type)) return;
  event.preventDefault();
  const data = new FormData(form);
  const id = form.dataset.id;
  if (type === 'group') {
    const title = value(data, 'title');
    if (!title || !project.groups.some(item => item.id === id)) return;
    closeModal();
    commit(next => { next.groups.find(item => item.id === id).title = title; });
    return;
  }
  if (type === 'method') {
    const method = methodFor(value(data, 'method'));
    if (method.id !== 'free' && !commerce.access.guide?.[method.id]) {
      commerce.open(() => methodDialog(methodSelection.first, method.id));
      return;
    }
    closeModal();
    if (method.id !== project.method) commit(next => { next.method = method.id; });
    board.viewport.focus({ preventScroll: true });
    return;
  }
  if (type === 'project') {
    const title = value(data, 'title');
    if (!title) {
      const error = $('.modal-error', form);
      error.textContent = '请输入项目名称。';
      error.hidden = false;
      return;
    }
    const format = value(data, 'format');
    const item = library.projects.find(entry => entry.id === id);
    closeModal();
    if (!item) addProject({ ...newProject({ title, format }), referenceNodesMigrated: true }, true);
    else {
      Object.assign(item, { title, format });
      persist();
      renderHome();
    }
    return;
  }
  if (!nodeById(id)) return;
  closeModal();
  commit(next => {
    const node = next.nodes.find(item => item.id === id);
    if (type === 'score') {
      const valence = value(data, 'valence'), tension = value(data, 'tension');
      Object.assign(node, { valence: valence ? Number(valence) : null, tension: tension ? Number(tension) : null,
        emotionNote: value(data, 'emotionNote') });
      return;
    }
    const beat = value(data, 'beat');
    const wasPinned = next.mainline.includes(id);
    const hasPeer = beat !== 'scene' && mainlineNodes(next).some(item => item.id !== id && item.beat === beat);
    if (node.kind === 'plot' && Object.hasOwn(BEATS, beat) && !(wasPinned && hasPeer)) node.beat = beat;
    node.title = value(data, 'title') || node.title;
    for (const [key] of plotFields) node[key] = value(data, key);
  });
});

document.addEventListener('input', event => {
  if (event.target.id === 'field-find-canvas-node') { updateFoundNodes(event.target.value); return; }
  if (event.target.id === 'node-search') {
    const query = event.target.value.trim().toLowerCase();
    for (const row of menu.element.querySelectorAll('[data-action=create-node]')) {
      row.hidden = ![row.dataset.id, row.textContent].some(word => word.toLowerCase().includes(query));
    }
    menu.place();
    return;
  }
  if (!['composer-body', 'composer-title', 'idea-prompt'].includes(event.target.id) || !focus()) return;
  pendingDraft = { id: canvasState.selected, title: $('#composer-title').value, body: $('#composer-body').value,
    ideaPrompt: $('#idea-prompt')?.value };
  if (event.target.id === 'composer-body') {
    composer.adjustText();
    composer.position(board);
  }
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { if (saveDraft() && !board.gesture) drawCards(); }, 540);
});

document.addEventListener('change', event => {
  if (event.target.name === 'method' && event.target.form?.dataset.form === 'method') {
    methodSelection.selected = event.target.value;
    const guide = $('#method-guide');
    guide.innerHTML = methodGuide(event.target.value, methodOptions(event.target.value));
    guide.scrollTop = 0;
    $('#apply-method').textContent = !commerce.access.guide && event.target.value !== 'free' ? '解锁后应用' : '应用方法';
  } else if (event.target.id === 'node-stage' && canGenerate(focus())) {
    if (!commerce.access.guide) return;
    const id = canvasState.selected;
    const stage = stageFor(project.method, event.target.value);
    commit(next => { next.nodes.find(node => node.id === id).methodStage = stage?.id || ''; });
  } else if (event.target.id === 'node-model' && ['plot', 'idea'].includes(focus()?.kind)) {
    const id = canvasState.selected;
    const modelId = event.target.value || null;
    commit(next => { next.nodes.find(node => node.id === id).modelId = modelId; });
  } else if (event.target.id === 'idea-count' && focus()?.kind === 'idea') {
    const id = canvasState.selected;
    const count = Number(event.target.value);
    if (isIdeaCount(count)) commit(next => { next.nodes.find(node => node.id === id).ideaCount = count; });
  } else if (event.target.id === 'round-select') {
    saveDraft();
    canvasState.roundId = event.target.value;
    canvasState.optionIndex = 0;
    renderCanvas();
  }
});

importFile.addEventListener('change', () => {
  const [file] = importFile.files;
  importFile.value = '';
  void openFile(file);
});

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  const { action, id } = control.dataset;
  const wasMenuItem = menu.element.contains(control);
  if (wasMenuItem) menu.close();
  if (modelUI.action(action, control)) return;
  if (commerce.action(action, control)) return;
  switch (action) {
    case 'home': goHome(); break;
    case 'account':
      if (menu.open && menu.anchor === control) menu.close(true);
      else menu.show(below(control, true), [
        menuRow('user-settings', '用户设置', 'gear-six'), divider, menuRow('logout', '退出登录', 'sign-out'),
      ].join(''));
      break;
    case 'user-settings': saveDraft(); modelUI.open(); break;
    case 'logout': saveDraft(); if (saveTimer) persist(); stopJobs(); void login.logout(); break;
    case 'new-project': projectDialog(); break;
    case 'method': saveDraft(); methodDialog(); break;
    case 'method-pricing': commerce.open(control.closest('form[data-form=method]')
      ? () => methodDialog(methodSelection.first, methodSelection.selected) : undefined); break;
    case 'method-starter': addStarterQuestion(); break;
    case 'edit-project': projectDialog(id); break;
    case 'project-menu':
      if (menu.open && menu.anchor === control) menu.close(true);
      else menu.show(below(control, true), [
        menuRow('edit-project', '编辑项目', 'note-pencil', { id }),
        menuRow('delete-project', '删除项目', 'trash', { id, danger: true }),
      ].join(''));
      break;
    case 'select-project': openProject(id); break;
    case 'delete-project': {
      const item = library.projects.find(entry => entry.id === id);
      if (item) confirmDeleteProject(id, item.title);
      break;
    }
    case 'confirm-project-delete':
      library.projects = library.projects.filter(item => item.id !== id);
      if (library.active === id) library.active = library.projects[0]?.id ?? null;
      project = library.projects.find(item => item.id === library.active);
      persist();
      closeModal();
      renderHome();
      break;
    case 'close-modal': closeModal(); break;
    case 'import': importFile.click(); break;
    case 'script-import': scriptImport.open(); break;
    case 'script-pick': scriptImport.pick(); break;
    case 'script-analyze': void scriptImport.analyze(); break;
    case 'script-cancel': scriptImport.cancel(); break;
    case 'script-apply': scriptImport.apply(); break;
    case 'node-picker': nodePicker(menuPoint); break;
    case 'dock-add': {
      const anchor = control.getBoundingClientRect(), rect = board.viewport.getBoundingClientRect();
      nodePicker({ clientX: anchor.right - 224, clientY: Math.max(12, anchor.top - 260), anchor: control,
        position: board.toWorld(rect.left + rect.width * .46, rect.top + rect.height * .38) });
      break;
    }
    case 'create-node': createNode(id); break;
    case 'board-tool': changeTool(id); break;
    case 'group-nodes': groupNodes(); break;
    case 'rename-group': groupDialog(id); break;
    case 'ungroup': commit(next => { next.groups = next.groups.filter(item => item.id !== id); }); break;
    case 'clear-ink': commit(next => { next.strokes = []; }); break;
    case 'find-node': findNodes(); break;
    case 'reveal-node': closeModal(); selectNode(id, true); board.viewport.focus({ preventScroll: true }); break;
    case 'close-composer': selectNode(null); board.viewport.focus({ preventScroll: true }); break;
    case 'edit-node': editNode(id); break;
    case 'delete-node': deleteNodes([id]); break;
    case 'delete-selection': deleteNodes(canvasState.selection); break;
    case 'references': referencesDialog(id); break;
    case 'connect-reference':
      closeModal();
      connect(id, canvasState.selected);
      break;
    case 'disconnect':
    case 'disconnect-reference':
      commit(next => { next.links = next.links.filter(edge => edge.from !== id || edge.to !== canvasState.selected); });
      if (action === 'disconnect-reference') referencesDialog(canvasState.selected);
      break;
    case 'toggle-mainline': toggleMainline(id); break;
    case 'mainline': mainlineDialog(); break;
    case 'reorder-up': reorder(id, -1); break;
    case 'reorder-down': reorder(id, 1); break;
    case 'edit-score': scoreDialog(id); break;
    case 'chart-node': selectNode(id, true); break;
    case 'toggle-chart': saveDraft(); canvasState.chartOpen = !canvasState.chartOpen; renderCanvas(); break;
    case 'fit': board.fit(); board.viewport.focus({ preventScroll: true }); break;
    case 'zoom-in': board.zoomBy(1.2); break;
    case 'zoom-out': board.zoomBy(1 / 1.2); break;
    case 'zoom-reset': board.zoomBy(); break;
    case 'minimap': control.setAttribute('aria-pressed', String(board.toggleMap())); break;
    case 'undo': navigateHistory('undo'); break;
    case 'redo': navigateHistory('redo'); break;
    case 'generate':
    case 'brainstorm': void generate(); break;
    case 'idea-direction': chooseIdeaDirection(id, true); break;
    case 'view-idea-branches': {
      const source = focus();
      if (source?.kind === 'idea') {
        selectNode(null);
        board.fit([source.id, ...ideaBranches(source).map(node => node.id)]);
        board.viewport.focus({ preventScroll: true });
      }
      break;
    }
    case 'develop-idea': developIdea(id); break;
    case 'cancel-generation': canvasState.generation?.controller.abort(); break;
    case 'show-candidate': saveDraft(); canvasState.optionIndex = Number(id); renderCanvas(); break;
    case 'candidate-detail': candidateDetail(); break;
    case 'branch-candidate': useCandidate(true); break;
    case 'apply-candidate': useCandidate(false); break;
    case 'assess': void assess(); break;
    case 'export': exportDialog(); break;
    case 'download': void download(id, control); break;
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.id === 'field-find-canvas-node') {
    event.preventDefault();
    $('#find-node-results button')?.click();
    return;
  }
  if (modal.open || canvasState.screen !== 'canvas' || event.defaultPrevented) return;
  const modified = event.ctrlKey || event.metaKey;
  if (modified && event.key === 'Enter' && composer.element.contains(event.target)) {
    event.preventDefault();
    void generate();
    return;
  }
  const ideaTab = event.target.closest?.('[data-action=idea-direction]');
  if (ideaTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const directions = Object.keys(IDEA_DIRECTIONS);
    const index = directions.indexOf(ideaTab.dataset.id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? directions.length - 1
      : (index + (event.key === 'ArrowLeft' ? -1 : 1) + directions.length) % directions.length;
    event.preventDefault();
    chooseIdeaDirection(directions[next], true);
    return;
  }
  if (event.key === 'Escape') {
    if (menu.close(true)) return;
    if (board.gesture) board.resetGesture();
    else if (!board.cancelLink()) {
      if (board.tool !== 'select') changeTool('select');
      else if (canvasState.selection.size) { selectNode(null); board.viewport.focus({ preventScroll: true }); }
    }
    return;
  }
  if (menu.open || event.target.matches?.('input,textarea,select,[contenteditable=true]')) return;
  const key = event.key.toLowerCase();
  if (modified && ['y', 'z'].includes(key)) {
    event.preventDefault();
    navigateHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
  } else if (modified && key === 'f') {
    event.preventDefault();
    findNodes();
  } else if (key === 'delete' && canvasState.selection.size) {
    event.preventDefault();
    deleteNodes(canvasState.selection);
  } else if (!modified && ['v', 'h', 'p'].includes(key)) {
    event.preventDefault();
    changeTool({ v: 'select', h: 'hand', p: 'ink' }[key]);
  } else if (key === 'insert') {
    event.preventDefault();
    const rect = board.viewport.getBoundingClientRect();
    nodePicker({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height * 0.38, anchor: board.viewport });
  } else if (key === ' ' && !event.target.closest?.('button')) {
    event.preventDefault();
    board.setSpace(true);
  }
});
document.addEventListener('keyup', event => { if (event.key === ' ') board.setSpace(false); });
window.addEventListener('blur', () => { board.setSpace(false); saveDraft(); if (saveTimer) persist(); });
window.addEventListener('pagehide', () => { saveDraft(); if (saveTimer) persist(); });

renderHome();
if (invalidStorage) toast('旧项目无法读取。当前显示示例，旧数据仍在本机。');
else persist();
void modelUI.refresh();
void commerce.initialize();
