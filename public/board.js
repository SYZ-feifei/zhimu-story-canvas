import { NODE_HEIGHT, NODE_TYPES, NODE_WIDTH, STROKE_POINTS } from './story.js';
import { stageFor } from './methods.js';
import { boundsOf, clamp, drawInk, drawMinimap, drawWires } from './board-drawing.js';
import { $, escape, icon } from './ui.js';

const VIEW = 1, WIRES = 2, INK = 4, GESTURE = 8, MAP = 16, CHROME = 32;
const VIEW_FRAME = VIEW | WIRES | INK | MAP | CHROME;
const nodeElement = element => element?.closest('.story-node');
const overlay = element => element?.closest('[data-board-overlay]');
const additive = event => event.shiftKey || event.ctrlKey || event.metaKey;

function faceMarkup(node, type, summary, stage, model, pinned, busy) {
  const details = [stage, model].filter(Boolean).join(' · ');
  return `<span class="node-type"><span>${icon(type.icon)}${type.label}</span>${pinned ? '<span class="mainline-tag">主线</span>' : ''}</span>
    <strong class="node-title">${escape(node.title)}</strong>
    <span class="node-summary${summary ? '' : ' is-empty'}">${escape(summary || '点击编辑')}</span>
    ${busy ? '<span class="node-meta">正在生成…</span>' : details ? `<span class="node-meta" title="${escape(details)}">
    ${icon(stage ? 'compass' : 'cpu')}${escape(details)}</span>` : ''}`;
}

export class StoryBoard {
  constructor(actions) {
    this.actions = actions;
    this.viewport = $('#viewport');
    this.world = $('#world');
    this.nodeLayer = $('#nodes');
    this.groupLayer = $('#groups');
    this.canvas = $('#wires');
    this.ink = $('#ink');
    this.box = $('#selection-box');
    this.minimap = $('#minimap');
    this.nodes = new Map();
    this.elements = new Map();
    this.visuals = new Map();
    this.groupElements = new Map();
    this.groups = [];
    this.strokes = [];
    this.links = [];
    this.mainline = new Set();
    this.selected = new Set();
    this.previewSelection = new Set();
    this.zoom = 1;
    this.x = this.y = this.width = this.height = this.dirty = this.frame = 0;
    this.gesture = this.link = this.offset = null;
    this.tool = 'select';
    this.space = false;
    this.viewport.addEventListener('pointerdown', event => this.start(event));
    this.viewport.addEventListener('pointermove', event => this.pointerMove(event));
    this.viewport.addEventListener('pointerup', event => this.finish(event));
    this.viewport.addEventListener('pointercancel', () => this.resetGesture());
    this.viewport.addEventListener('wheel', event => this.wheel(event), { passive: false });
    this.viewport.addEventListener('contextmenu', event => {
      if (overlay(event.target)) return;
      event.preventDefault();
      this.cancelLink();
      this.actions.menu({ clientX: event.clientX, clientY: event.clientY, nodeId: nodeElement(event.target)?.dataset.id,
        groupId: event.target.closest('[data-group]')?.dataset.group, anchor: event.target.closest('button') || this.viewport });
    });
    this.viewport.addEventListener('dblclick', event => {
      if (this.tool !== 'select') return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (overlay(hit) || hit?.closest('[data-port],[data-group]')) return;
      const element = nodeElement(hit);
      if (element) this.actions.edit(element.dataset.id);
      else this.actions.createMenu({ clientX: event.clientX, clientY: event.clientY, anchor: this.viewport });
    });
    this.viewport.addEventListener('click', event => {
      if (event.detail || overlay(event.target)) return;
      const group = this.groups.find(item => item.id === event.target.closest('[data-group]')?.dataset.group);
      if (group) { this.actions.selection(group.nodes); return; }
      const node = nodeElement(event.target);
      if (!node) return;
      const port = event.target.closest('[data-port]')?.dataset.port;
      if (port) this.usePort(port, node.dataset.id);
      else this.pick(node.dataset.id, additive(event));
    });
    this.viewport.addEventListener('dragover', event => {
      if (!overlay(event.target) && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
    });
    this.viewport.addEventListener('drop', event => {
      if (overlay(event.target) || !event.dataTransfer.files.length) return;
      event.preventDefault();
      this.actions.drop(event.dataTransfer.files[0]);
    });
    this.minimap.addEventListener('click', event => this.navigateMap(event));
    new ResizeObserver(() => this.draw(VIEW_FRAME)).observe(this.viewport);
  }

  update(project, { selected, generating, recent, modelLabel }) {
    if (this.project !== project) {
      const reset = this.project?.id !== project.id;
      if (reset) this.resetGesture();
      this.project = project;
      this.nodes = new Map(project.nodes.map(node => [node.id, node]));
      this.groups = project.groups;
      this.strokes = project.strokes;
      this.links = project.links;
      this.mainline = new Set(project.mainline);
      this.incoming = new Set(this.links.map(edge => edge.to));
      this.outgoing = new Set(this.links.map(edge => edge.from));
      for (const [id, element] of this.elements) {
        if (this.nodes.has(id)) continue;
        element.remove();
        this.elements.delete(id);
        this.visuals.delete(id);
      }
      if (this.link && !this.nodes.has(this.link.id)) this.cancelLink();
      this.updateGroups();
      this.draw(WIRES | INK | MAP | CHROME);
    }
    this.updateSelection(selected);
    for (const node of this.nodes.values()) {
      const type = NODE_TYPES[node.kind];
      const busy = node.id === generating;
      const summary = (node.action || node.script || node.prompt).slice(0, 420);
      const model = modelLabel(node);
      const stage = stageFor(project.method, node.methodStage)?.label;
      const pinned = this.mainline.has(node.id);
      const content = [node.kind, node.title, summary, model, stage, pinned, busy];
      const previous = this.visuals.get(node.id);
      let element = this.elements.get(node.id);
      if (!element) {
        element = document.createElement('article');
        element.dataset.id = node.id;
        element.innerHTML = `<button type="button" class="node-face"></button>
          <button type="button" class="node-port port-in" data-port="in" title="输入参考">${icon('plus')}</button>
          <button type="button" class="node-port port-out" data-port="out" title="拖出一条参考线">${icon('plus')}</button>`;
        this.nodeLayer.append(element);
        this.elements.set(node.id, element);
      }
      if (!previous || previous.x !== node.x || previous.y !== node.y) {
        element.style.left = `${node.x}px`;
        element.style.top = `${node.y}px`;
      }
      if (!previous || content.some((value, i) => value !== previous.content[i])) {
        if (previous) element.classList.remove(`kind-${previous.content[0]}`);
        element.classList.add('story-node', `kind-${node.kind}`);
        element.classList.toggle('is-generating', busy);
        const face = element.firstElementChild;
        face.setAttribute('aria-label', type.label + '，' + node.title);
        face.innerHTML = faceMarkup(node, type, summary, stage, model, pinned, busy);
        element.children[1].setAttribute('aria-label', node.title + '的输入端口');
        element.children[2].setAttribute('aria-label', node.title + '的输出端口');
      }
      element.children[1].classList.toggle('is-connected', this.incoming.has(node.id));
      element.children[2].classList.toggle('is-connected', this.outgoing.has(node.id));
      if (!previous) this.markSelected(node.id, this.selected.has(node.id));
      if (recent.has(node.id)) {
        element.classList.add('is-new');
        element.firstElementChild.addEventListener('animationend', () => element.classList.remove('is-new'), { once: true });
      }
      this.visuals.set(node.id, { x: node.x, y: node.y, content });
    }
  }

  updateSelection(ids) {
    const next = new Set(ids);
    if (this.selected.size === next.size && [...this.selected].every(id => next.has(id))) return;
    for (const id of this.selected) if (!next.has(id)) this.markSelected(id, false);
    for (const id of next) if (!this.selected.has(id)) this.markSelected(id, true);
    this.selected = next;
    this.draw(WIRES);
  }

  markSelected(id, value) {
    const element = this.elements.get(id);
    if (!element) return;
    element.classList.toggle('is-selected', value);
    element.firstElementChild.setAttribute('aria-pressed', String(value));
  }

  updateGroups() {
    const seen = new Set();
    for (const group of this.groups) {
      seen.add(group.id);
      let element = this.groupElements.get(group.id);
      if (!element) {
        element = document.createElement('div');
        element.className = 'node-group';
        const label = document.createElement('button');
        label.type = 'button';
        label.dataset.group = group.id;
        label.className = 'group-label';
        element.append(label);
        this.groupLayer.append(element);
        this.groupElements.set(group.id, element);
      }
      element.firstElementChild.textContent = group.title;
    }
    for (const [id, element] of this.groupElements) {
      if (seen.has(id)) continue;
      element.remove();
      this.groupElements.delete(id);
    }
    this.positionGroups();
  }

  positionGroups() {
    for (const group of this.groups) {
      const element = this.groupElements.get(group.id);
      const bounds = boundsOf(group.nodes.map(id => this.position(id)).filter(Boolean), 15);
      if (!bounds) continue;
      element.style.left = `${bounds.left}px`;
      element.style.top = `${bounds.top}px`;
      element.style.width = `${bounds.right - bounds.left}px`;
      element.style.height = `${bounds.bottom - bounds.top}px`;
    }
  }

  position(id) {
    const node = this.nodes.get(id);
    if (!node || !this.offset?.ids.has(id)) return node;
    return { x: node.x + this.offset.x, y: node.y + this.offset.y };
  }

  toWorld(clientX, clientY, rect = this.viewport.getBoundingClientRect()) {
    return { x: (clientX - rect.left - this.x) / this.zoom, y: (clientY - rect.top - this.y) / this.zoom };
  }

  nodeRect(id) { return this.elements.get(id)?.getBoundingClientRect(); }

  available() {
    const rect = this.viewport.getBoundingClientRect();
    return { width: rect.width, top: 73, bottom: $('#emotion-panel').getBoundingClientRect().top - rect.top - 16 };
  }

  fit() {
    const { width, top, bottom } = this.available();
    const height = Math.max(140, bottom - top);
    const all = boundsOf([...this.nodes.values()]);
    if (!all) {
      this.zoom = 1;
      this.x = width / 2;
      this.y = top + height / 2;
    } else {
      this.zoom = clamp(Math.min((width - 126) / (all.right - all.left), (height - 42) / (all.bottom - all.top), 1.13), 0.12, 1.13);
      this.x = (width - (all.left + all.right) * this.zoom) / 2;
      this.y = top + (height - (all.top + all.bottom) * this.zoom) / 2;
    }
    this.draw(VIEW_FRAME);
  }

  reveal(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    const { width, top, bottom } = this.available();
    const x = this.x + node.x * this.zoom;
    const y = this.y + node.y * this.zoom;
    this.x += clamp(x, 52, Math.max(52, width - NODE_WIDTH * this.zoom - 52)) - x;
    this.y += clamp(y, top, Math.max(top, bottom - NODE_HEIGHT * this.zoom)) - y;
    this.draw(VIEW_FRAME);
  }

  zoomAt(value, clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const point = this.toWorld(clientX, clientY, rect);
    this.zoom = clamp(value, 0.12, 2.5);
    this.x = clientX - rect.left - point.x * this.zoom;
    this.y = clientY - rect.top - point.y * this.zoom;
    this.draw(VIEW_FRAME);
  }

  zoomBy(factor) {
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(factor ? this.zoom * factor : 1, rect.left + rect.width / 2, rect.top + rect.height * 0.4);
  }

  wheel(event) {
    if (overlay(event.target) || this.gesture) return;
    event.preventDefault();
    this.actions.closeMenu();
    if (event.shiftKey) {
      this.x -= event.deltaY || event.deltaX;
      this.draw(VIEW_FRAME);
    } else {
      const unit = event.deltaMode === 1 ? 15 : 1;
      this.zoomAt(this.zoom * Math.exp(-event.deltaY * unit * 0.0016), event.clientX, event.clientY);
    }
  }

  setSpace(down) {
    this.space = down;
    this.viewport.classList.toggle('can-pan', down || this.tool === 'hand');
  }

  setTool(tool) {
    this.resetGesture();
    this.tool = tool;
    this.viewport.dataset.tool = tool;
    this.setSpace(this.space);
    this.viewport.focus({ preventScroll: true });
  }

  start(event) {
    if (this.gesture || overlay(event.target) || event.button > 1) return;
    this.actions.closeMenu();
    this.viewport.focus({ preventScroll: true });
    const rect = this.viewport.getBoundingClientRect();
    const id = nodeElement(event.target)?.dataset.id;
    const group = this.groups.find(item => item.id === event.target.closest('[data-group]')?.dataset.group);
    const port = event.target.closest('[data-port]')?.dataset.port;
    const g = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect, moved: false, additive: additive(event) };
    const pan = this.space || this.tool === 'hand' || event.button === 1;
    event.preventDefault();
    if (pan) Object.assign(g, { type: 'pan', x: this.x, y: this.y });
    else if (this.tool === 'ink') {
      const point = this.toWorld(event.clientX, event.clientY, rect);
      Object.assign(g, { type: 'ink', points: [[point.x, point.y]] });
    } else if (this.tool === 'note' || this.tool === 'text') g.type = 'place';
    else if (port === 'in') { this.usePort(port, id); return; }
    else if (port === 'out') Object.assign(g, { type: 'wire', id, port });
    else if (group || id) Object.assign(g, { type: 'nodes', id, ids: new Set(group?.nodes || (this.selected.has(id) ? this.selected : [id])), group: Boolean(group) });
    else g.type = 'box';
    this.gesture = g;
    this.viewport.setPointerCapture(event.pointerId);
  }

  pointerMove(event) {
    const g = this.gesture;
    if (this.link && !g) {
      this.link.point = this.toWorld(event.clientX, event.clientY);
      this.draw(WIRES);
    }
    if (!g || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.startX, dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < (g.type === 'ink' ? 2 : 5)) return;
    if (!g.moved && ['pan', 'nodes', 'box', 'ink'].includes(g.type)) this.viewport.classList.add('is-gesturing');
    g.moved = true;
    if (g.type === 'wire') {
      this.link = { id: g.id, point: this.toWorld(event.clientX, event.clientY, g.rect) };
      this.viewport.classList.add('is-linking');
      this.draw(WIRES);
    } else if (g.type === 'pan') {
      this.x = g.x + dx;
      this.y = g.y + dy;
      this.viewport.classList.add('is-panning');
      this.draw(VIEW_FRAME);
    } else if (g.type === 'nodes') {
      this.offset = { ids: g.ids, x: dx / this.zoom, y: dy / this.zoom };
      this.draw(GESTURE | WIRES);
    } else if (g.type === 'box') {
      g.box = this.selectionBounds(g, event.clientX, event.clientY);
      this.draw(GESTURE);
    } else if (g.type === 'ink') {
      const next = this.toWorld(event.clientX, event.clientY, g.rect);
      const last = g.points.at(-1);
      if (Math.hypot(next.x - last[0], next.y - last[1]) * this.zoom >= 2 && g.points.length < STROKE_POINTS) {
        g.points.push([next.x, next.y]);
      }
      this.draw(INK);
    }
  }

  selectionBounds(g, x, y) {
    return { left: Math.min(x, g.startX), top: Math.min(y, g.startY), right: Math.max(x, g.startX), bottom: Math.max(y, g.startY) };
  }

  inBox(g, bounds) {
    const a = this.toWorld(bounds.left, bounds.top, g.rect);
    const b = this.toWorld(bounds.right, bounds.bottom, g.rect);
    return [...this.nodes.values()].filter(node => node.x <= b.x && node.x + NODE_WIDTH >= a.x &&
      node.y <= b.y && node.y + NODE_HEIGHT >= a.y).map(node => node.id);
  }

  finish(event) {
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    this.pointerMove(event);
    const offset = this.offset;
    this.clearGesture();
    if (g.type === 'wire') {
      if (!g.moved) { this.usePort(g.port, g.id); return; }
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const target = nodeElement(hit)?.dataset.id;
      this.cancelLink();
      if (!hit || !this.viewport.contains(hit) || overlay(hit)) return;
      if (target) this.actions.connect(g.id, target);
      else this.actions.createMenu({ clientX: event.clientX, clientY: event.clientY, sourceId: g.id, anchor: this.viewport });
    } else if (g.type === 'nodes') {
      if (offset) this.actions.move([...offset.ids], Math.round(offset.x), Math.round(offset.y));
      else if (g.group) this.actions.selection(g.ids);
      else this.pick(g.id, g.additive);
    } else if (g.type === 'box') {
      this.cancelLink();
      if (g.box) {
        const ids = this.inBox(g, g.box);
        this.actions.selection(g.additive ? new Set([...this.selected, ...ids]) : ids);
      } else if (!g.additive) this.actions.selection([]);
    } else if (g.type === 'ink' && g.points.length > 1) this.actions.stroke(g.points);
    else if (g.type === 'place' && !g.moved) this.actions.place(this.tool, event.clientX, event.clientY);
  }

  pick(id, multiple) {
    if (!multiple) { this.actions.selection([id]); return; }
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.actions.selection(next);
  }

  clearGesture() {
    const offset = this.offset;
    if (offset) for (const id of offset.ids) {
      const element = this.elements.get(id);
      if (element) element.style.transform = '';
    }
    this.gesture = this.offset = null;
    if (offset) this.positionGroups();
    this.viewport.classList.remove('is-panning', 'is-gesturing');
    this.box.hidden = true;
    this.highlightBox([]);
    this.draw(WIRES | INK | CHROME);
  }

  resetGesture() {
    const pointer = this.gesture?.pointerId;
    this.clearGesture();
    if (pointer !== undefined && this.viewport.hasPointerCapture(pointer)) this.viewport.releasePointerCapture(pointer);
    this.cancelLink();
  }

  usePort(port, id) {
    if (port === 'in') {
      if (this.link) {
        const from = this.link.id;
        this.cancelLink();
        this.actions.connect(from, id);
      } else this.actions.references(id);
      return;
    }
    if (this.link?.id === id) { this.cancelLink(); return; }
    const node = this.nodes.get(id);
    if (!node) return;
    this.link = { id, point: { x: node.x + NODE_WIDTH + 30 / this.zoom, y: node.y + NODE_HEIGHT / 2 } };
    this.viewport.classList.add('is-linking');
    this.actions.notice('选择目标节点的输入端口，Esc 取消。');
    this.draw(WIRES);
  }

  cancelLink() {
    if (!this.link) return false;
    this.link = null;
    this.viewport.classList.remove('is-linking');
    this.draw(WIRES);
    return true;
  }

  highlightBox(ids) {
    const next = new Set(ids);
    for (const id of this.previewSelection) if (!next.has(id)) this.elements.get(id)?.classList.remove('is-preview');
    for (const id of next) if (!this.previewSelection.has(id)) this.elements.get(id)?.classList.add('is-preview');
    this.previewSelection = next;
  }

  paintGesture() {
    const g = this.gesture;
    if (g?.box) {
      const { left, top, right, bottom } = g.box;
      this.box.hidden = false;
      this.box.style.transform = `translate(${left - g.rect.left}px, ${top - g.rect.top}px)`;
      this.box.style.width = `${right - left}px`;
      this.box.style.height = `${bottom - top}px`;
      this.highlightBox(this.inBox(g, g.box));
    }
    if (this.offset) {
      for (const id of this.offset.ids) {
        const element = this.elements.get(id);
        if (element) element.style.transform = `translate(${this.offset.x}px, ${this.offset.y}px)`;
      }
      this.positionGroups();
    }
  }

  toggleMap() {
    this.minimap.hidden = !this.minimap.hidden;
    this.draw(MAP);
    return !this.minimap.hidden;
  }

  navigateMap(event) {
    if (!this.mapTransform) return;
    const { left, top, ox, oy, scale } = this.mapTransform;
    const point = { x: left + (event.offsetX - ox) / scale, y: top + (event.offsetY - oy) / scale };
    this.x = this.width / 2 - point.x * this.zoom;
    this.y = this.height * 0.42 - point.y * this.zoom;
    this.draw(VIEW_FRAME);
  }

  draw(dirty) {
    this.dirty |= dirty;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.paint());
  }

  paint() {
    this.frame = 0;
    const dirty = this.dirty;
    this.dirty = 0;
    if (dirty & VIEW || !this.width) {
      this.width = this.viewport.clientWidth;
      this.height = this.viewport.clientHeight;
    }
    if (!this.width || !this.height) return;
    if (dirty & VIEW) {
      const grid = (this.zoom > 0.55 ? 24 : 48) * this.zoom;
      this.viewport.style.setProperty('--grid-step', `${grid}px`);
      this.viewport.style.setProperty('--grid-x', `${this.x % grid}px`);
      this.viewport.style.setProperty('--grid-y', `${this.y % grid}px`);
      this.world.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.zoom})`;
    }
    if (dirty & GESTURE) this.paintGesture();
    if (dirty & WIRES) drawWires(this);
    if (dirty & INK) drawInk(this);
    if (dirty & MAP) this.mapTransform = drawMinimap(this);
    if (dirty & CHROME) this.actions.viewportChanged(this.zoom, Boolean(this.gesture?.moved));
  }
}
