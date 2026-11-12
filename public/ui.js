export const $ = (selector, root = document) => root.querySelector(selector);

export function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export const icon = (name) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
export const signed = (value) => value === null ? '待标注' : `${value > 0 ? '+' : ''}${value}`;
export const enabled = (condition) => condition ? '' : ' disabled';

export function button(action, label, { glyph, style = 'secondary', data = '', disabled = false, extra = '' } = {}) {
  return `<button type="button" class="button ${style}" data-action="${action}" ${data}${enabled(!disabled)} ${extra}>${glyph ? icon(glyph) : ''}${escape(label)}</button>`;
}

export function iconButton(action, label, glyph, data = '', extra = '') {
  return `<button type="button" class="icon-button ${extra}" data-action="${action}" ${data} title="${escape(label)}" aria-label="${escape(label)}">${icon(glyph)}</button>`;
}

export function field(name, label, value = '', options = {}) {
  const { type = 'text', max = 100, placeholder = '', required = false, min = '', upper = '', rows = 2, choices = [] } = options;
  const attributes = `id="field-${name}" name="${name}" placeholder="${escape(placeholder)}"${required ? ' required' : ''}`;
  let input;
  if (type === 'textarea') input = `<textarea ${attributes} maxlength="${max}" rows="${rows}">${escape(value)}</textarea>`;
  else if (type === 'select') input = `<select ${attributes}>${choices.map(([key, text]) => `<option value="${escape(key)}"${key === value ? ' selected' : ''}>${escape(text)}</option>`).join('')}</select>`;
  else input = `<input ${attributes} type="${type}" value="${escape(value)}" ${type === 'number' ? `min="${min}" max="${upper}" step="1"` : `maxlength="${max}"`} ${type === 'password' ? 'autocomplete="off" spellcheck="false"' : ''}>`;
  return `<div class="field"><label for="field-${name}">${escape(label)}</label>${input}</div>`;
}

export function canvasContext(canvas, width, height) {
  const dpi = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = [Math.round(width * dpi), Math.round(height * dpi)];
  if (canvas.width !== pixels[0] || canvas.height !== pixels[1]) [canvas.width, canvas.height] = pixels;
  const context = canvas.getContext('2d');
  context.setTransform(dpi, 0, 0, dpi, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}
