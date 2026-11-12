import { NODE_HEIGHT, NODE_WIDTH } from './story.js';
import { canvasContext } from './ui.js';

export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function boundsOf(nodes, padding = 0) {
  if (!nodes.length) return null;
  return {
    left: Math.min(...nodes.map(node => node.x)) - padding,
    top: Math.min(...nodes.map(node => node.y)) - padding,
    right: Math.max(...nodes.map(node => node.x)) + NODE_WIDTH + padding,
    bottom: Math.max(...nodes.map(node => node.y)) + NODE_HEIGHT + padding,
  };
}

function traceWire(path, x1, y1, x2, y2, bend, arrow) {
  path.moveTo(x1, y1);
  path.bezierCurveTo(x1 + bend, y1, x2 - bend, y2, x2, y2);
  if (!arrow) return;
  path.moveTo(x2 - 12, y2 - 3);
  path.lineTo(x2 - 8, y2);
  path.lineTo(x2 - 12, y2 + 3);
}

export function drawWires(board) {
  const { canvas, width, height, zoom, selected, mainline, links, link, x, y } = board;
  const ctx = canvasContext(canvas, width, height);
  const paths = [new Path2D(), new Path2D(), new Path2D()];
  for (const { from, to } of links) {
    const a = board.position(from), b = board.position(to);
    if (!a || !b) continue;
    const x1 = x + (a.x + NODE_WIDTH) * zoom, y1 = y + (a.y + NODE_HEIGHT / 2) * zoom;
    const x2 = x + b.x * zoom, y2 = y + (b.y + NODE_HEIGHT / 2) * zoom;
    const bend = clamp(Math.abs(x2 - x1) * 0.5, 40, 210);
    if ((y1 < -8 && y2 < -8) || (y1 > height + 8 && y2 > height + 8) ||
      Math.max(x1 + bend, x2) < -16 || Math.min(x1, x2 - bend) > width + 16) continue;
    const style = selected.has(from) || selected.has(to) ? 2 : mainline.has(from) && mainline.has(to) ? 1 : 0;
    traceWire(paths[style], x1, y1, x2, y2, bend, zoom >= 0.45);
  }
  const colors = ['#554c66', '#8573ad', '#c3a9ff'];
  for (const [index, path] of paths.entries()) {
    ctx.strokeStyle = colors[index];
    ctx.lineWidth = index === 2 ? 1.75 : 1.25;
    ctx.stroke(path);
  }
  const start = link && board.position(link.id);
  if (!start) return;
  const x1 = x + (start.x + NODE_WIDTH) * zoom;
  const x2 = x + link.point.x * zoom;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = colors[2];
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  traceWire(ctx, x1, y + (start.y + NODE_HEIGHT / 2) * zoom, x2, y + link.point.y * zoom, clamp(Math.abs(x2 - x1) * 0.5, 40, 210), false);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawInk(board) {
  const pending = board.gesture?.type === 'ink' ? board.gesture.points : [];
  board.ink.hidden = !board.strokes.length && !pending.length;
  if (board.ink.hidden) return;
  const ctx = canvasContext(board.ink, board.width, board.height);
  ctx.strokeStyle = '#f1c38b';
  ctx.lineWidth = clamp(2.25 * board.zoom, 1.1, 5);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const line of [...board.strokes, pending]) {
    for (const [i, point] of line.entries()) {
      const x = board.x + point[0] * board.zoom, y = board.y + point[1] * board.zoom;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

export function drawMinimap(board) {
  const map = board.minimap;
  if (map.hidden || !board.nodes.size) return null;
  const width = map.clientWidth, height = map.clientHeight;
  const ctx = canvasContext(map, width, height);
  const shown = { left: -board.x / board.zoom, top: -board.y / board.zoom };
  shown.right = shown.left + board.width / board.zoom;
  shown.bottom = shown.top + board.height / board.zoom;
  const all = boundsOf([...board.nodes.values()], 20);
  const left = Math.min(shown.left, all.left), top = Math.min(shown.top, all.top);
  const right = Math.max(shown.right, all.right), bottom = Math.max(shown.bottom, all.bottom);
  const scale = Math.min((width - 14) / (right - left), (height - 14) / (bottom - top));
  const ox = (width - (right - left) * scale) / 2, oy = (height - (bottom - top) * scale) / 2;
  ctx.fillStyle = '#6a5a84';
  for (const node of board.nodes.values()) {
    ctx.fillRect(ox + (node.x - left) * scale, oy + (node.y - top) * scale,
      Math.max(2, NODE_WIDTH * scale), Math.max(2, NODE_HEIGHT * scale));
  }
  ctx.strokeStyle = '#d7bcff';
  ctx.strokeRect(ox + (shown.left - left) * scale, oy + (shown.top - top) * scale,
    (shown.right - shown.left) * scale, (shown.bottom - shown.top) * scale);
  return { left, top, ox, oy, scale };
}
