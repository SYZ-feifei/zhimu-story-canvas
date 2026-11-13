import { methodFor, normalizeStage } from './methods.js';

export const BEATS = {
  A: { name: '失衡开场', short: '开场', color: 'blue', hint: '用一个反常动作入戏，埋下后来会变义的细节。' },
  B: { name: '误导与施压', short: '施压', color: 'amber', hint: '改变角色的处境，让观众依据真实线索得出暂时的误判。' },
  C: { name: '反转底牌', short: '反转', color: 'violet', hint: '先确定藏在表象之下的真相，以及揭晓它的动作。' },
  D: { name: '兑现与尾钩', short: '收束', color: 'green', hint: '回收前置细节，让人物的最后一次选择留下余味。' },
  scene: { name: '情节节点', short: '情节', color: 'slate', hint: '写清角色的选择怎样改变了后续处境。' },
};

export const DEVELOPMENT_ORDER = ['C', 'B', 'A', 'D'];
export const STORY_ORDER = ['A', 'B', 'C', 'D'];
export const FORMATS = ['短片', '短剧', '长片', '剧集', '其他'];
export const PROVIDERS = {
  openai: { label: 'OpenAI 兼容', base: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic', base: 'https://api.anthropic.com/v1' },
  gemini: { label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta' },
  ollama: { label: 'Ollama', base: 'http://127.0.0.1:11434/v1' },
};
export const NODE_TYPES = {
  text: { label: '文本', icon: 'text-aa', title: '文本节点' },
  idea: { label: '点子', icon: 'lightbulb', title: '新点子' },
  setting: { label: '共享设定', icon: 'bookmark-simple', title: '共享设定' },
  synopsis: { label: '梗概', icon: 'paragraph', title: '故事梗概' },
  plot: { label: '剧情', icon: 'film-strip', title: '剧情节点' },
  agent: { label: 'Agent', icon: 'sparkle', title: 'Agent' },
};
export const PROMPT_LIMIT = 8000;
export const NODE_WIDTH = 192;
export const NODE_HEIGHT = 148;
export const COLUMN = 230;
export const NODE_LIMIT = 500;
export const LINK_LIMIT = 1500;
export const STROKE_LIMIT = 250;
export const STROKE_POINTS = 450;
export const IDEA_LIMIT = 8;
export const DEFAULT_IDEA_COUNT = 3;
export const MIN_SCENES = 2;
export const MAX_SCENES = 12;
export const DECISION_LIMIT = 800;
export const SYNOPSIS_LIMIT = 5000;
export const IDEA_DIRECTIONS = {
  auto: { label: '模型自由想', guidance: '自由选择切入点。围绕现有素材找出不同的故事可能。素材很少或为空时，直接提出各自能独立成立的故事种子。' },
  plot: { label: '剧情走向', guidance: '给出不同的触发事件、人物决定或后续走向，并说明它会怎样改变局势。' },
  character: { label: '人物关系', guidance: '从人物的欲望、利益或关系变化切入，让具体行为引起另一人的回应。' },
  conflict: { label: '冲突与两难', guidance: '设计主角要争取的目标和对立力量，让不同选择分别产生看得见的代价。' },
  suspense: { label: '悬念反转', guidance: '用已出现或可以提前埋下的线索改变观众理解，并说明真相会如何影响人物行动。' },
  scene: { label: '场景构想', guidance: '提出能落成一场戏的处境，写清谁来到哪里、采取什么行动，以及场尾发生的变化。' },
};

export const isIdeaCount = count => Number.isInteger(count) && count >= 1 && count <= IDEA_LIMIT;
export const isIdeaDirection = direction => typeof direction === 'string' && Object.hasOwn(IDEA_DIRECTIONS, direction);

const idPattern = /^[a-zA-Z0-9_-]{1,90}$/;
export const newId = () => globalThis.crypto.randomUUID();
export const cleanText = (value, limit) => typeof value === 'string' ? value.slice(0, limit).trim() : '';
export const beatName = (beat) => BEATS[beat]?.name ?? BEATS.scene.name;
export function mainlineNodes(project) {
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  return project.mainline.map(id => nodes.get(id)).filter(Boolean);
}
export const beatNode = (project, beat) => mainlineNodes(project).find(node => node.beat === beat);

export function score(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function plotContent(raw = {}) {
  return {
    title: cleanText(raw.title, 100) || '未命名情节',
    action: cleanText(raw.action, 2400),
    reason: cleanText(raw.reason, 1400),
    consequence: cleanText(raw.consequence, 1400),
    clue: cleanText(raw.clue, 1200),
    tradeoff: cleanText(raw.tradeoff, 1200),
    fixedDetails: cleanText(raw.fixedDetails, 1600),
    script: cleanText(raw.script, 30000),
    evidence: cleanText(raw.evidence, 500),
    valence: score(raw.valence, -5, 5),
    tension: score(raw.tension, 0, 10),
    emotionNote: cleanText(raw.emotionNote, 800),
  };
}

export function makeNode(raw = {}) {
  const legacyNote = raw.kind === 'note';
  const kind = legacyNote ? 'idea' : Object.hasOwn(NODE_TYPES, raw.kind) ? raw.kind : 'plot';
  const content = plotContent(raw);
  if (kind === 'idea' && (!cleanText(raw.title, 100) || (legacyNote && content.title === '便签'))) content.title = NODE_TYPES.idea.title;
  return {
    id: idPattern.test(raw.id ?? '') ? raw.id : newId(),
    kind,
    beat: Object.hasOwn(BEATS, raw.beat) ? raw.beat : 'scene',
    methodStage: normalizeStage(raw.methodStage),
    ...content,
    ...(kind === 'idea' ? {
      ideaCount: isIdeaCount(raw.ideaCount) ? raw.ideaCount : DEFAULT_IDEA_COUNT,
      ideaDirection: isIdeaDirection(raw.ideaDirection) ? raw.ideaDirection : 'auto',
    } : {}),
    ...(kind === 'plot' ? {
      sceneHeading: cleanText(raw.sceneHeading, 140),
      audienceInfo: cleanText(raw.audienceInfo, 800),
      emotionTrigger: cleanText(raw.emotionTrigger, 800),
      reviewStory: raw.reviewStory === true,
      reviewEmotion: raw.reviewEmotion === true,
    } : {}),
    prompt: cleanText(raw.prompt, PROMPT_LIMIT),
    modelId: idPattern.test(raw.modelId ?? '') ? raw.modelId : null,
    modelSource: cleanText(raw.modelSource, 120),
    origin: idPattern.test(raw.origin ?? '') ? raw.origin : null,
    x: Number.isFinite(raw.x) ? raw.x : 0,
    y: Number.isFinite(raw.y) ? raw.y : 0,
  };
}

export function newProject(raw = {}) {
  return {
    schema: 1,
    id: newId(),
    title: cleanText(raw.title, 100) || '未命名故事',
    format: FORMATS.includes(raw.format) ? raw.format : '短片',
    method: methodFor(raw.method).id,
    premise: cleanText(raw.premise, 5000),
    constraints: cleanText(raw.constraints, 5000),
    analysisNotes: cleanText(raw.analysisNotes, 4000),
    sourceName: cleanText(raw.sourceName, 255),
    cover: null,
    referenceNodesMigrated: false,
    referenceNodeIds: {},
    nodes: [],
    mainline: [],
    links: [],
    groups: [],
    strokes: [],
    proposals: [],
  };
}

export function normalizeProject(raw) {
  if (!raw || raw.schema !== 1 || !Array.isArray(raw.nodes) || !Array.isArray(raw.mainline) || !Array.isArray(raw.links)) {
    throw new Error('请选择枝幕导出的项目 JSON。');
  }
  if (raw.nodes.length > NODE_LIMIT || raw.links.length > LINK_LIMIT) throw new Error('项目中的节点或连线超出导入上限。');
  const nodes = [];
  const ids = new Set();
  for (const item of raw.nodes) {
    if (!item || typeof item.id !== 'string' || !idPattern.test(item.id) || ids.has(item.id)) {
      throw new Error('项目中存在无效或重复的节点编号。');
    }
    ids.add(item.id);
    nodes.push(makeNode(item));
  }
  const seenBeats = new Set();
  const mainline = [];
  for (const id of new Set(raw.mainline)) {
    const node = nodes.find(item => item.id === id);
    if (!node || node.kind !== 'plot' || (node.beat !== 'scene' && seenBeats.has(node.beat))) continue;
    seenBeats.add(node.beat);
    mainline.push(id);
  }
  const links = [];
  const linkIds = new Set();
  for (const link of raw.links) {
    if (!link || link.from === link.to || !ids.has(link.from) || !ids.has(link.to)) continue;
    const key = `${link.from}/${link.to}`;
    if (!linkIds.has(key)) {
      links.push({ from: link.from, to: link.to });
      linkIds.add(key);
    }
  }
  const groups = [];
  const groupIds = new Set();
  const grouped = new Set();
  for (const group of Array.isArray(raw.groups) ? raw.groups.slice(0, NODE_LIMIT) : []) {
    if (!group || typeof group.id !== 'string' || !idPattern.test(group.id) || groupIds.has(group.id) || !Array.isArray(group.nodes)) continue;
    const members = [...new Set(group.nodes.filter(id => ids.has(id) && !grouped.has(id)))];
    if (members.length < 2) continue;
    groups.push({ id: group.id, title: cleanText(group.title, 80) || '节点分组', nodes: members });
    groupIds.add(group.id);
    members.forEach(id => grouped.add(id));
  }
  const strokes = (Array.isArray(raw.strokes) ? raw.strokes.slice(0, STROKE_LIMIT) : [])
    .filter(Array.isArray).map(points => points.slice(0, STROKE_POINTS).filter(point =>
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))).filter(points => points.length > 1);
  for (const node of nodes) if (!ids.has(node.origin) || node.origin === node.id) node.origin = null;
  const seenRounds = new Set();
  const proposals = [];
  for (const round of Array.isArray(raw.proposals) ? raw.proposals : []) {
    if (!round || typeof round.id !== 'string' || !idPattern.test(round.id) || seenRounds.has(round.id) ||
        (round.focus && !ids.has(round.focus)) || !Array.isArray(round.options)) continue;
    const options = round.options.filter(option => option && typeof option === 'object').slice(0, 3).map(plotContent);
    if (!options.length) continue;
    seenRounds.add(round.id);
    proposals.push({ id: round.id, focus: round.focus || null, beat: Object.hasOwn(BEATS, round.beat) ? round.beat : 'scene',
      methodStage: normalizeStage(round.methodStage),
      scope: round.scope === 'next' ? 'next' : 'beat', label: cleanText(round.label, 120), modelSource: cleanText(round.modelSource, 120),
      modelId: typeof round.modelId === 'string' && idPattern.test(round.modelId) ? round.modelId : null, options });
  }
  return {
    schema: 1,
    id: typeof raw.id === 'string' && idPattern.test(raw.id) ? raw.id : newId(),
    title: cleanText(raw.title, 100) || '未命名故事',
    format: FORMATS.includes(raw.format) ? raw.format : '短片',
    method: methodFor(raw.method).id,
    premise: cleanText(raw.premise, 5000),
    constraints: cleanText(raw.constraints, 5000),
    analysisNotes: cleanText(raw.analysisNotes, 4000),
    sourceName: cleanText(raw.sourceName, 255),
    cover: raw.cover === 'rain' ? 'rain' : null,
    referenceNodesMigrated: raw.referenceNodesMigrated === true,
    referenceNodeIds: Object.fromEntries(['premise', 'constraints'].filter(key => typeof raw.referenceNodeIds?.[key] === 'string' &&
      idPattern.test(raw.referenceNodeIds[key])).map(key => [key, raw.referenceNodeIds[key]])),
    nodes, mainline, links, proposals, groups, strokes,
  };
}

function overlapsAt(nodes, x, y) {
  return nodes.some(node => Math.abs(x - node.x) < NODE_WIDTH + 14 && Math.abs(y - node.y) < NODE_HEIGHT + 14);
}

export function positionFor(project, beat, focus) {
  const stage = STORY_ORDER.indexOf(beat);
  const hasPeer = stage >= 0 && project.nodes.some(node => node.beat === beat);
  const preferred = stage >= 0 && !hasPeer
    ? { x: stage * COLUMN, y: 0 }
    : focus ? { x: focus.x + (beat === 'scene' ? COLUMN : 0), y: focus.y + (beat === 'scene' ? 0 : 248) }
      : { x: 0, y: 0 };
  for (let row = 0; row <= project.nodes.length; row += 1) {
    for (const column of [0, 1, -1, 2, -2]) {
      const x = preferred.x + column * COLUMN;
      const y = preferred.y + row * (NODE_HEIGHT + 40);
      if (!overlapsAt(project.nodes, x, y)) return { x, y };
    }
  }
  return preferred;
}

export function ideaPositions(project, source, count) {
  const positions = [];
  const rowsPerColumn = count <= 3 ? count : Math.ceil(count / 2);
  const columnCount = Math.ceil(count / rowsPerColumn);
  for (let index = 0; index < count; index += 1) {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const rows = Math.min(rowsPerColumn, count - column * rowsPerColumn);
    positions.push({
      x: source.x + (column + 1) * (COLUMN + 26),
      y: source.y + (row - (rows - 1) / 2) * (NODE_HEIGHT + 42),
    });
  }
  const step = (COLUMN + 26) * columnCount;
  for (let block = 0; block <= project.nodes.length; block += 1) {
    const shift = block * step;
    if (positions.every(({ x, y }) => !overlapsAt(project.nodes, x + shift, y))) {
      return positions.map(({ x, y }) => ({ x: x + shift, y }));
    }
  }
  return positions;
}

export function pinNode(project, node) {
  if (node.kind !== 'plot' || project.mainline.includes(node.id)) return false;
  const existing = node.beat === 'scene' ? null : beatNode(project, node.beat);
  if (existing) {
    project.mainline[project.mainline.indexOf(existing.id)] = node.id;
    return true;
  }
  const stage = STORY_ORDER.indexOf(node.beat);
  const followingStage = stage >= 0 ? mainlineNodes(project).findIndex(item => STORY_ORDER.indexOf(item.beat) > stage) : -1;
  const originIndex = node.origin ? project.mainline.indexOf(node.origin) : -1;
  const insertAt = stage >= 0 && followingStage >= 0 ? followingStage
    : stage < 0 && originIndex >= 0 ? originIndex + 1 : project.mainline.length;
  project.mainline.splice(insertAt, 0, node.id);
  return true;
}

export function removeNode(project, id) {
  removeNodes(project, new Set([id]));
}

export function removeNodes(project, ids) {
  project.nodes = project.nodes.filter(node => !ids.has(node.id));
  project.mainline = project.mainline.filter(id => !ids.has(id));
  project.links = project.links.filter(link => !ids.has(link.from) && !ids.has(link.to));
  project.proposals = (project.proposals || []).filter(round => !ids.has(round.focus));
  project.groups = (project.groups || []).map(group => ({ ...group, nodes: group.nodes.filter(id => !ids.has(id)) }))
    .filter(group => group.nodes.length >= 2);
  for (const node of project.nodes) if (ids.has(node.origin)) node.origin = null;
}

export function upstreamNodes(project, targets) {
  const seen = new Set(targets);
  const incoming = new Map();
  for (const { from, to } of project.links) {
    if (!incoming.has(to)) incoming.set(to, []);
    incoming.get(to).push(from);
  }
  const queue = [...seen];
  for (let index = 0; index < queue.length; index += 1) {
    for (const source of incoming.get(queue[index]) || []) {
      if (seen.has(source)) continue;
      seen.add(source);
      queue.push(source);
    }
  }
  for (const target of targets) seen.delete(target);
  return project.nodes.filter(node => seen.has(node.id));
}

export function storyMaterial(node) {
  return { id: node.id, kind: node.kind, title: node.title, sceneHeading: node.sceneHeading, action: node.action,
    reason: node.reason, consequence: node.consequence, clue: node.clue, tradeoff: node.tradeoff,
    fixedDetails: node.fixedDetails, evidence: node.evidence, script: node.script };
}

export function developmentContext(project, ids) {
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  const route = ids.map(id => nodes.get(id)).filter(Boolean);
  const references = upstreamNodes(project, ids);
  const included = new Set([...ids, ...references.map(node => node.id)]);
  return { format: project.format, route: route.map(storyMaterial), references: references.map(storyMaterial),
    links: project.links.filter(({ from, to }) => included.has(from) && included.has(to)) };
}

export const hasStory = node => Boolean(node.action || node.reason || node.consequence || node.clue || node.fixedDetails || node.script);

const revisionFields = ['title', 'sceneHeading', 'action', 'reason', 'consequence', 'clue', 'fixedDetails', 'script', 'evidence'];

export function markStoryRevisions(before, next) {
  const priorNodes = new Map(before.nodes.map(node => [node.id, node]));
  const edited = new Set(next.nodes.filter(node => {
    const old = priorNodes.get(node.id);
    return old && (hasStory(old) || hasStory(node)) && revisionFields.some(key => old[key] !== node[key]);
  }).map(node => node.id));
  const affected = new Set();
  const beforeLinks = new Set(before.links.map(({ from, to }) => `${from}/${to}`));
  const afterLinks = new Set(next.links.map(({ from, to }) => `${from}/${to}`));
  for (const { from, to } of before.links) if (!afterLinks.has(`${from}/${to}`)) affected.add(to);
  for (const { from, to } of next.links) if (priorNodes.has(to) && !beforeLinks.has(`${from}/${to}`)) affected.add(to);
  const outgoing = new Map();
  for (const { from, to } of next.links) {
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(to);
  }
  const reached = new Set([...edited, ...affected]);
  for (const id of reached) {
    for (const child of outgoing.get(id) || []) {
      affected.add(child);
      reached.add(child);
    }
  }
  const oldMainline = new Set(before.mainline);
  for (const [index, id] of next.mainline.entries()) {
    if (before.mainline[index] !== id && oldMainline.has(id)) affected.add(id);
  }
  let earlierChanged = false;
  const reviewMarks = new Set();
  for (const [index, id] of next.mainline.entries()) {
    if (earlierChanged && oldMainline.has(id)) reviewMarks.add(id);
    earlierChanged ||= reached.has(id) || before.mainline[index] !== id;
  }
  if (!affected.size && !edited.size && !reviewMarks.size) return;
  next.nodes = next.nodes.map(node => {
    if (node.kind !== 'plot' || !priorNodes.has(node.id)) return node;
    const reviewStory = node.reviewStory || affected.has(node.id);
    const hasMark = node.valence !== null || node.tension !== null || node.emotionNote || node.audienceInfo || node.emotionTrigger;
    const reviewEmotion = node.reviewEmotion || Boolean(hasMark && (edited.has(node.id) || affected.has(node.id) || reviewMarks.has(node.id)));
    return reviewStory === node.reviewStory && reviewEmotion === node.reviewEmotion ? node : { ...node, reviewStory, reviewEmotion };
  });
}

export function arrange(project) {
  const ordered = mainlineNodes(project);
  for (const [index, node] of ordered.entries()) {
    node.x = index * COLUMN;
    node.y = 0;
  }
  const seen = new Map();
  let loose = 0;
  for (const node of project.nodes) {
    if (project.mainline.includes(node.id)) continue;
    const parent = beatNode(project, node.beat) || ordered.find(item => item.id === node.origin);
    if (!parent) {
      node.x = (loose % Math.max(ordered.length, 4)) * COLUMN;
      node.y = (ordered.length ? 248 : 0) + Math.floor(loose / Math.max(ordered.length, 4)) * (NODE_HEIGHT + 45);
      loose += 1;
      continue;
    }
    const count = seen.get(parent.id) || 0;
    seen.set(parent.id, count + 1);
    node.x = parent.x;
    node.y = 248 + count * (NODE_HEIGHT + 45);
  }
  const placed = [...ordered];
  for (const node of project.nodes.filter(item => !project.mainline.includes(item.id))) {
    while (placed.some(item => item.x === node.x && item.y === node.y)) node.y += NODE_HEIGHT + 45;
    placed.push(node);
  }
}
