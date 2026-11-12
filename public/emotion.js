import { BEATS, mainlineNodes } from './story.js';
import { stageFor } from './methods.js';
import { $, canvasContext, escape, signed } from './ui.js';

function segments(points, field, ordinate) {
  const result = [];
  let line = [];
  for (const point of points) {
    if (point.node[field] !== null) line.push([point.x, ordinate(point.node[field])]);
    else if (line.length) { result.push(line); line = []; }
  }
  if (line.length) result.push(line);
  return result;
}

function trace(context, line) {
  context.moveTo(...line[0]);
  for (let i = 1; i < line.length; i += 1) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const half = (x0 + x1) / 2;
    context.bezierCurveTo(half, y0, half, y1, x1, y1);
  }
}

export class EmotionChart {
  constructor() {
    this.plot = $('#chart-plot');
    this.canvas = $('#chart');
    this.points = $('#chart-points');
    this.scroll = $('#chart-scroll');
    this.nodes = [];
    new ResizeObserver(() => this.draw()).observe(this.scroll);
  }

  update(project, selected) {
    const nodes = mainlineNodes(project);
    const focus = project.mainline.includes(selected) ? selected : null;
    const signature = JSON.stringify([project.method, focus, nodes.map(({ id, title, beat, methodStage, valence, tension, emotionNote }) =>
      [id, title, beat, methodStage, valence, tension, emotionNote])]);
    if (this.signature === signature) return;
    this.signature = signature;
    this.nodes = nodes;
    this.method = project.method;
    this.selected = focus;
    this.draw();
  }

  draw() {
    if (!this.scroll.clientWidth || !this.scroll.clientHeight) return;
    const width = Math.max(this.scroll.clientWidth - 15, this.nodes.length * 44 + 78);
    this.plot.style.width = `${width}px`;
    const height = this.plot.clientHeight;
    const context = canvasContext(this.canvas, width, height);
    const top = 12, bottom = height - 24, left = 37, right = width - 37;
    const y = normalized => bottom - normalized * (bottom - top);
    context.font = '10px Geist, Microsoft YaHei UI, sans-serif';
    context.textBaseline = 'middle';
    for (const [value, l, r] of [[1, '+5', '10'], [0.5, '0', '5'], [0, '−5', '0']]) {
      context.strokeStyle = '#3a3345';
      context.lineWidth = 1;
      context.setLineDash(value === 0.5 ? [3, 3] : []);
      context.beginPath(); context.moveTo(left, y(value)); context.lineTo(right, y(value)); context.stroke();
      context.setLineDash([]);
      context.textAlign = 'right'; context.fillStyle = '#b2a1d0'; context.fillText(l, left - 6, y(value));
      context.textAlign = 'left'; context.fillStyle = '#d0a67f'; context.fillText(r, right + 6, y(value));
    }
    if (!this.nodes.length) {
      this.points.innerHTML = '<div class="chart-message">将剧情节点纳入主线后，即可标注情绪和张力。</div>';
      return;
    }
    const step = (right - left) / this.nodes.length;
    const points = this.nodes.map((node, index) => ({ node, x: left + step * (index + 0.5) }));
    for (const [index, { node, x }] of points.entries()) {
      if (node.id === this.selected) {
        context.fillStyle = '#ab8dde2b';
        context.fillRect(x - 9, top, 18, bottom - top);
      }
      context.textAlign = 'center'; context.fillStyle = node.id === this.selected ? '#e1cdfb' : '#b2a6c3';
      const label = node.beat === 'scene' ? String(index + 1).padStart(2, '0') : `${node.beat} ${BEATS[node.beat].short}`;
      context.fillText(label, x, bottom + 13);
    }
    for (const [field, color, normalize] of [['valence', '#bca6ff', v => (v + 5) / 10], ['tension', '#e4ad77', v => v / 10]]) {
      for (const line of segments(points, field, value => y(normalize(value)))) {
        if (field === 'valence' && line.length > 1) {
          const gradient = context.createLinearGradient(0, top, 0, bottom);
          gradient.addColorStop(0, '#beaaf44b'); gradient.addColorStop(1, '#beaaf404');
          context.beginPath(); trace(context, line); context.lineTo(line.at(-1)[0], bottom); context.lineTo(line[0][0], bottom);
          context.closePath(); context.fillStyle = gradient; context.fill();
        }
        context.strokeStyle = color;
        context.lineWidth = field === 'valence' ? 2 : 1.65;
        context.setLineDash(field === 'tension' ? [5, 3] : []);
        context.beginPath(); trace(context, line); context.stroke();
        context.setLineDash([]);
        for (const [x, ordinate] of line) {
          context.beginPath(); context.arc(x, ordinate, 3.4, 0, Math.PI * 2); context.fillStyle = '#25202c'; context.fill(); context.stroke();
        }
      }
    }
    this.points.innerHTML = points.map(({ node, x }) => {
      const stage = stageFor(this.method, node.methodStage);
      const label = `${node.title}${stage ? `，${stage.label}` : ''}，情绪 ${signed(node.valence)}，张力 ${node.tension ?? '待标注'}${node.emotionNote ? `。${node.emotionNote}` : ''}`;
      return `<button type="button" class="chart-point" data-action="chart-node" data-id="${node.id}" title="${escape(label)}" aria-label="${escape(label)}" style="left:${x - step / 2}px;width:${step}px"></button>`;
    }).join('');
  }
}
