import { $, escape, icon } from './ui.js';

export const menuRow = (action, label, glyph, { id, trailing, disabled, danger } = {}) => `
  <button type="button" role="menuitem" data-action="${action}"${id ? ` data-id="${escape(id)}"` : ''}${disabled ? ' disabled' : ''}
    ${danger ? ' class="danger"' : ''}>${icon(glyph)}<span>${escape(label)}</span>${trailing ? `<span class="menu-trailing">${escape(trailing)}</span>` : ''}</button>`;
export const divider = '<div class="menu-rule" role="separator"></div>';

export class CanvasMenu {
  constructor() {
    this.element = $('#canvas-menu');
    this.anchor = null;
    this.position = null;
    this.element.addEventListener('keydown', event => this.navigate(event));
    document.addEventListener('pointerdown', event => {
      if (!this.element.contains(event.target) && !this.anchor?.contains(event.target)) this.close();
    }, true);
    window.addEventListener('resize', () => this.place());
  }

  get open() { return !this.element.hidden; }

  show({ clientX, clientY, anchor }, html, { search = false } = {}) {
    this.close();
    this.anchor = anchor;
    this.position = [clientX, clientY];
    if (anchor?.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', 'true');
    this.element.innerHTML = html;
    this.element.hidden = false;
    this.place();
    const input = search ? $('.menu-search', this.element) : null;
    if (input) input.focus({ preventScroll: true });
    else this.items()[0]?.focus({ preventScroll: true });
  }

  place() {
    if (!this.open || !this.position) return;
    const [x, y] = this.position;
    const edge = 8;
    const { offsetWidth, offsetHeight } = this.element;
    this.element.style.left = `${Math.max(edge, Math.min(x, window.innerWidth - offsetWidth - edge))}px`;
    this.element.style.top = `${Math.max(edge, Math.min(y, window.innerHeight - offsetHeight - edge))}px`;
  }

  close(restore = false) {
    if (!this.open) return false;
    if (this.anchor?.hasAttribute('aria-expanded')) this.anchor.setAttribute('aria-expanded', 'false');
    this.element.hidden = true;
    if (restore && this.anchor?.isConnected) this.anchor.focus({ preventScroll: true });
    this.anchor = this.position = null;
    return true;
  }

  items() {
    return [...this.element.querySelectorAll('[role=menuitem]:not(:disabled):not([hidden])')];
  }

  navigate(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); return; }
    if (event.key === 'Tab') { this.close(true); return; }
    const items = this.items();
    if (!items.length) return;
    if (event.key === 'Enter' && event.target.matches('.menu-search')) {
      event.preventDefault();
      items[0].click();
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    if (event.target.matches('.menu-search') && ['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }
}
