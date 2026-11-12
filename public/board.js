import { BEATS, NODE_HEIGHT, NODE_WIDTH, connections } from './story.js';
import { $, canvasContext, escape, icon } from './ui.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const connectorColor = { main: '#8d70df', option: '#ad97cd', cause: '#378f80' };

function bounds(nodes) {
  if (!nodes.length) return { left: 0, top: 0, right: NODE_WIDTH, bottom: NODE_HEIGHT };
  return { left: Math.min(...nodes.map(node => node.x)), top: Math.min(...nodes.map(node => node.y)),
    right: Math.max(...nodes.map(node => node.x)) + NODE_WIDTH, bottom: Math.max(...nodes.map(node => node.y)) + NODE_HEIGHT };
}

function wire(context, from, to, kind, zoom) {
  const vertical = Math.abs(to.y - from.y) > NODE_HEIGHT * 0.75 &&
    (kind === 'option' || Math.abs(to.x - from.x) < NODE_WIDTH * 0.8);
  const direction = vertical ? Math.sign(to.y - from.y) || 1 : Math.sign(to.x - from.x) || 1;
  const start = vertical ? [from.x + NODE_WIDTH / 2, from.y + (direction > 0 ? NODE_HEIGHT : 0)]
    : [from.x + (direction > 0 ? NODE_WIDTH : 0), from.y + NODE_HEIGHT / 2];
  const end = vertical ? [to.x + NODE_WIDTH / 2, to.y + (direction > 0 ? 0 : NODE_HEIGHT)]
    : [to.x + (direction > 0 ? 0 : NODE_WIDTH), to.y + NODE_HEIGHT / 2];
  const bend = direction * (vertical ? Math.max(24, Math.abs(end[1] - start[1]) * 0.5) : Math.max(16, Math.abs(end[0] - start[0]) * 0.45));
  context.strokeStyle = connectorColor[kind];
  context.fillStyle = connectorColor[kind];
  context.lineWidth = (kind === 'main' ? 1.75 : 1.35) / zoom;
  context.setLineDash(kind === 'main' ? [] : kind === 'option' ? [5 / zoom, 4 / zoom] : [2 / zoom, 4 / zoom]);
  context.beginPath();
  context.moveTo(...start);
  if (vertical) context.bezierCurveTo(start[0], start[1] + bend, end[0], end[1] - bend, ...end);
  else context.bezierCurveTo(start[0] + bend, start[1], end[0] - bend, end[1], ...end);
  context.stroke();
  context.setLineDash([]);
  const arrow = 5 / zoom;
  const [x, y] = end;
  context.beginPath();
  context.moveTo(x, y);
  if (vertical) {
    context.lineTo(x - arrow * 0.62, y - direction * arrow);
    context.lineTo(x + arrow * 0.62, y - direction * arrow);
  } else {
    context.lineTo(x - direction * arrow, y - arrow * 0.62);
    context.lineTo(x - direction * arrow, y + arrow * 0.62);
  }
  context.closePath();
  context.fill();
}

export class StoryBoard {
  constructor({ select, move }) {
    this.viewport = $('#viewport');
    this.wires = $('#wires');
    this.world = $('#world');
    this.minimap = $('#minimap');
    this.zoomLabel = $('#zoom-value');
    this.select = select;
    this.move = move;
    this.view = { x: 0, y: 0, zoom: 1 };
    this.nodes = [];
    this.fitted = false;
    this.gesture = null;
    this.viewport.addEventListener('pointerdown', event => this.pointerDown(event));
    this.viewport.addEventListener('pointermove', event => this.pointerMove(event));
    this.viewport.addEventListener('pointerup', event => this.pointerEnd(event, false));
    this.viewport.addEventListener('pointercancel', event => this.pointerEnd(event, true));
    this.viewport.addEventListener('wheel', event => this.wheel(event), { passive: false });
    this.world.addEventListener('click', event => {
      const node = event.target.closest('[data-node]');
      if (node && event.detail === 0 && !event.target.closest('[data-action]')) this.select(node.dataset.node);
    });
    this.minimap.addEventListener('click', event => {
      if (!this.map) return;
      const rect = this.minimap.getBoundingClientRect();
      const x = (event.clientX - rect.left - this.map.x) / this.map.scale;
      const y = (event.clientY - rect.top - this.map.y) / this.map.scale;
      this.center(x, y);
    });
    this.minimap.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); this.fit(); } });
    this.resize = new ResizeObserver(() => this.fitted ? this.draw() : this.fit(true));
    this.resize.observe(this.viewport);
  }

  update(project, { selected, mainlineOnly, linking, linkStart, generating, recent = [], modelLabel, reset = false }) {
    this.nodes = mainlineOnly ? project.nodes.filter(node => project.mainline.includes(node.id)) : project.nodes;
    this.edges = connections(project, mainlineOnly);
    this.selected = selected;
    this.viewport.classList.toggle('is-linking', linking);
    let alternate = 0;
    this.world.innerHTML = this.nodes.map(node => {
      const index = project.mainline.indexOf(node.id);
      const option = index < 0;
      const beat = BEATS[node.beat];
      if (option) alternate += 1;
      return `<article class="story-node tone-${beat.color}${option ? ' is-option' : ''}${node.id === selected ? ' is-selected' : ''}${node.id === linkStart ? ' is-link-start' : ''}${node.id === generating ? ' is-generating' : ''}${recent.includes(node.id) ? ' is-recent' : ''}" data-node="${node.id}" style="left:${node.x}px;top:${node.y}px">
        <button type="button" class="node-face" aria-pressed="${node.id === selected}"><span class="story-node-head"><span class="node-pill">${node.beat === 'scene' ? icon('film-strip') : node.beat} ${beat.short}</span><span class="node-number">${option ? `备选 ${alternate}` : `${icon('lock-key')} ${String(index + 1).padStart(2, '0')}`}</span></span>
        <strong title="${escape(node.title)}">${escape(node.title)}</strong><span class="node-summary">${escape(node.action || '添加剧情动作')}</span></button>
        <div class="story-node-footer"><button type="button" class="node-model" data-action="node-model" data-id="${node.id}" title="为此节点选择模型">${icon('cpu')}<span>${escape(modelLabel(node))}</span>${icon('caret-down')}</button>
        <button type="button" class="node-ai" data-action="node-ai" data-id="${node.id}" aria-label="从${escape(node.title)}发散" title="AI 发散">${icon(node.id === generating ? 'spinner-gap' : 'sparkle')}</button></div>
      </article>`;
    }).join('');
    if (reset) this.fitted = false;
    if (this.fitted) this.draw();
    else this.fit(true);
  }

  pointerDown(event) {
    if ((event.button !== 0 && event.button !== 1) || this.gesture) return;
    if (event.target.closest('.canvas-top,.canvas-bottom,.canvas-empty,[data-action]')) return;
    const target = event.target.closest('[data-node]');
    const node = event.button === 0 && target ? this.nodes.find(item => item.id === target.dataset.node) : null;
    event.preventDefault();
    this.gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, viewX: this.view.x, viewY: this.view.y, node, target, moved: false };
    this.viewport.setPointerCapture(event.pointerId);
  }

  pointerMove(event) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    if (gesture.node && this.viewport.classList.contains('is-linking')) return;
    gesture.moved = true;
    if (gesture.node) {
      this.viewport.classList.add('is-dragging');
      gesture.position = { ...gesture.node, x: gesture.node.x + dx / this.view.zoom, y: gesture.node.y + dy / this.view.zoom };
      gesture.target.style.left = `${gesture.position.x}px`;
      gesture.target.style.top = `${gesture.position.y}px`;
      gesture.target.style.zIndex = '5';
    } else {
      this.viewport.classList.add('is-panning');
      this.view.x = gesture.viewX + dx;
      this.view.y = gesture.viewY + dy;
    }
    this.draw();
  }

  pointerEnd(event, cancelled) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    this.gesture = null;
    this.viewport.classList.remove('is-dragging', 'is-panning');
    if (!gesture.node) return;
    if (!cancelled && gesture.position) this.move(gesture.node.id, gesture.position.x, gesture.position.y);
    else if (!cancelled && !gesture.moved) this.select(gesture.node.id);
    else {
      gesture.target.style.left = `${gesture.node.x}px`;
      gesture.target.style.top = `${gesture.node.y}px`;
      gesture.target.style.zIndex = '';
      this.draw();
    }
  }

  wheel(event) {
    event.preventDefault();
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport.clientHeight : 1;
    if (event.ctrlKey || event.metaKey) {
      const rect = this.viewport.getBoundingClientRect();
      this.zoomTo(this.view.zoom * Math.exp(-event.deltaY * factor * 0.0025), event.clientX - rect.left, event.clientY - rect.top);
      return;
    }
    this.view.x -= (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * factor;
    this.view.y -= (event.shiftKey ? 0 : event.deltaY) * factor;
    this.draw();
  }

  fit(preferFocus = false) {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (!width || !height) return;
    const { left, top, right, bottom } = bounds(this.nodes);
    const margin = width < 600 ? 18 : 35;
    const zoom = clamp(Math.min((width - margin * 2) / (right - left), (height - 118) / (bottom - top)), 0.005, 1.05);
    this.view = { zoom, x: (width - (right - left) * zoom) / 2 - left * zoom,
      y: Math.max(48, (height - (bottom - top) * zoom) / 2 - 10) - top * zoom };
    const focus = preferFocus && width < 530 && zoom < 0.72 ? this.nodes.find(node => node.id === this.selected) : null;
    if (focus) {
      const scale = 0.84;
      this.view = { zoom: scale, x: width / 2 - (focus.x + NODE_WIDTH / 2) * scale,
        y: Math.max(64, height * 0.23) - focus.y * scale };
    }
    this.fitted = true;
    this.draw();
  }

  zoomTo(value, x = this.viewport.clientWidth / 2, y = this.viewport.clientHeight / 2) {
    const zoom = clamp(value, 0.005, 2.8);
    this.view.x = x - (x - this.view.x) * zoom / this.view.zoom;
    this.view.y = y - (y - this.view.y) * zoom / this.view.zoom;
    this.view.zoom = zoom;
    this.draw();
  }

  center(x, y) {
    this.view.x = this.viewport.clientWidth / 2 - x * this.view.zoom;
    this.view.y = this.viewport.clientHeight / 2 - y * this.view.zoom;
    this.draw();
  }

  reveal(id) {
    const node = this.nodes.find(item => item.id === id);
    if (!node || !this.viewport.clientWidth || !this.viewport.clientHeight) return;
    const { x, y, zoom } = this.view;
    const sx = x + node.x * zoom;
    const sy = y + node.y * zoom;
    if (sx < 8 || sy < 40 || sx + NODE_WIDTH * zoom > this.viewport.clientWidth - 8 || sy + NODE_HEIGHT * zoom > this.viewport.clientHeight - 38) {
      this.center(node.x + NODE_WIDTH / 2, node.y + NODE_HEIGHT / 2);
    }
  }

  draw() {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (!width || !height) return;
    const { x, y, zoom } = this.view;
    this.world.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
    let grid = 21 * zoom;
    while (grid < 12) grid *= 2;
    this.viewport.style.backgroundSize = `${grid}px ${grid}px`;
    this.viewport.style.backgroundPosition = `${x % grid}px ${y % grid}px`;
    this.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    const canvas = canvasContext(this.wires, width, height);
    canvas.translate(x, y);
    canvas.scale(zoom, zoom);
    const nodes = this.gesture?.position ? this.nodes.map(node => node.id === this.gesture.position.id ? this.gesture.position : node) : this.nodes;
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const edge of this.edges || []) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (from && to) wire(canvas, from, to, edge.kind, zoom);
    }
    this.drawMap(nodes, width, height);
  }

  drawMap(nodes, width, height) {
    const w = this.minimap.clientWidth;
    const h = this.minimap.clientHeight;
    if (!w || !h) return;
    const context = canvasContext(this.minimap, w, h);
    const { left, top, right, bottom } = bounds(nodes);
    const scale = Math.min((w - 12) / (right - left), (h - 12) / (bottom - top));
    const x = (w - (right - left) * scale) / 2 - left * scale;
    const y = (h - (bottom - top) * scale) / 2 - top * scale;
    this.map = { x, y, scale };
    for (const node of nodes) {
      context.fillStyle = node.id === this.selected ? '#8064df' : '#d8cbed';
      context.beginPath();
      context.roundRect(x + node.x * scale, y + node.y * scale, NODE_WIDTH * scale, NODE_HEIGHT * scale, 1.6);
      context.fill();
    }
    context.strokeStyle = '#a28cdb';
    context.lineWidth = 0.85;
    const rect = [x - this.view.x / this.view.zoom * scale, y - this.view.y / this.view.zoom * scale,
      width / this.view.zoom * scale, height / this.view.zoom * scale];
    context.strokeRect(...rect);
  }
}
