import { $, button, escape, field, icon } from './ui.js';

const prices = [
  { id: 'cn', region: '中国大陆', price: '¥1.00', channel: '微信支付' },
  { id: 'usd', region: '美元结算地区', price: 'US$1.00', channel: 'Stripe Checkout' },
];

export function createCommerceUI({ modal, show, api, onChange, notice }) {
  let access = { configured: false, unlocked: false, preview: false, regions: [], order: null, guide: null };
  let returnTo;
  let busy = '';
  let issue = '';
  let poll;

  const visible = () => modal.open && Boolean($('#method-checkout', modal));
  const setAccess = next => {
    const before = access.unlocked;
    const changed = before !== next.unlocked || access.preview !== next.preview;
    access = next;
    onChange(access, changed);
    return !before && access.unlocked;
  };

  function panel() {
    clearTimeout(poll);
    const pending = access.order;
    const pricing = `<p>一次解锁整套创作方法和阶段指引。</p><div class="price-tiers">${prices.map(({ id, region, price, channel }) => {
      const active = access.regions.includes(id);
      return `<div class="price-tier"><span>${region}</span><strong>${price}</strong><small>${channel} · 一次性</small>
        ${button('commerce-buy', '购买', { style: 'primary compact', disabled: !active || Boolean(busy) || Boolean(pending), data: `data-id="${id}"` })}</div>`;
    }).join('')}</div>
    ${pending ? `<div class="checkout-pending"><p>已有${escape(prices.find(price => price.id === pending.region)?.region || '')}订单，正在等待支付确认。</p>
      <div class="modal-footer">${button('commerce-cancel', '取消未支付订单', { style: 'quiet compact', disabled: Boolean(busy) })}
        ${button('commerce-reopen', '打开收银台', { style: 'compact', disabled: Boolean(busy) || !pending.payable })}
        ${button('commerce-refresh', '检查支付', { style: 'primary compact', disabled: Boolean(busy) })}</div></div>`
      : !access.configured ? '<p class="field-hint">正式收款渠道尚未开通。可先查看创作方法的阶段预览。</p>'
        : '<p class="field-hint">在系统浏览器付款。支付确认后，枝幕会自动解锁。</p>'}`;
    show('创作方法礼包', `<div id="method-checkout" class="price-preview">
      ${access.unlocked ? `<div class="activity-status">${icon('check-circle')}创作方法已解锁</div>
        <p class="field-hint">保存恢复码可在其他电脑恢复已购方法。</p>` : pricing}
      ${busy ? `<p class="activity-status checkout-feedback" role="status"><span class="activity-dots"><span></span></span>${escape(busy)}</p>` : ''}
      ${issue ? `<p class="modal-error checkout-feedback" role="alert">${escape(issue)}</p>` : ''}
      <div class="modal-footer">
        ${access.unlocked ? button('commerce-recovery', '查看恢复码', { glyph: 'key', style: 'compact' })
          : access.configured ? button('commerce-restore-form', '恢复已购', { style: 'quiet compact' }) : ''}
        ${returnTo ? button('commerce-back', '返回创作方法', { glyph: 'arrow-left' }) : ''}
      </div></div>`);
    if (pending && !busy) poll = setTimeout(() => { if (visible()) void perform('refresh', {}, '', true); }, 4500);
  }

  async function initialize() {
    try { setAccess(await (await api('/api/method-access')).json()); }
    catch (error) { notice(error.message); }
  }

  function open(back) {
    returnTo = back;
    issue = '';
    panel();
    if (access.configured) void perform('refresh', {}, '正在检查购买状态…');
  }

  async function perform(operation, payload = {}, status = '', silent = false) {
    if (busy) return;
    clearTimeout(poll);
    busy = status || '正在检查购买状态…';
    issue = '';
    if (!silent && visible()) panel();
    try {
      const result = await (await api('/api/method-access/' + operation, payload)).json();
      if (setAccess(result)) notice('创作方法已解锁');
      if (operation === 'restore' && modal.open && $('form[data-form=restore-methods]', modal)) panel();
    } catch (error) {
      issue = error.message;
      if (operation === 'restore') {
        const line = $('#restore-method-error', modal);
        if (line) { line.textContent = error.message; line.hidden = false; }
      } else if (!visible() && !silent) notice(error.message);
    } finally {
      busy = '';
      if (visible()) panel();
    }
  }

  function restoreForm() {
    show('恢复已购创作方法', `<form data-form="restore-methods">
      ${field('restore-code', '恢复码', '', { type: 'password', required: true, max: 43 })}
      <p id="restore-method-error" class="modal-error" role="alert" hidden></p>
      <div class="modal-footer">${button('commerce-return', '返回', { style: 'quiet' })}<button type="submit" class="button primary">恢复购买</button></div></form>`);
  }

  async function recovery() {
    try {
      const result = await (await api('/api/method-access/recovery', {})).json();
      if (!visible()) return;
      show('创作方法恢复码', `<p>请妥善保存。持有恢复码的账号可以恢复购买。</p>
        ${field('recovery-code', '恢复码', result.key, { max: 43 })}
        <div class="modal-footer">${button('commerce-return', '返回', { style: 'quiet' })}
          ${button('commerce-copy', '复制恢复码', { style: 'primary' })}</div>`);
      $('#field-recovery-code').readOnly = true;
    } catch (error) { notice(error.message); }
  }

  modal.addEventListener('close', () => clearTimeout(poll));
  modal.addEventListener('submit', event => {
    if (event.target.dataset.form !== 'restore-methods') return;
    event.preventDefault();
    void perform('restore', { key: new FormData(event.target).get('restore-code').trim() }, '正在恢复购买…');
  });

  function action(name, control) {
    switch (name) {
      case 'commerce-buy': void perform('buy', { region: control.dataset.id }, '正在打开收银台…'); return true;
      case 'commerce-refresh': void perform('refresh', {}, '正在检查支付…'); return true;
      case 'commerce-reopen': void perform('reopen', {}, '正在打开收银台…'); return true;
      case 'commerce-cancel': void perform('cancel', {}, '正在取消订单…'); return true;
      case 'commerce-restore-form': restoreForm(); return true;
      case 'commerce-recovery': void recovery(); return true;
      case 'commerce-return': issue = ''; panel(); return true;
      case 'commerce-back': returnTo?.(); return true;
      case 'commerce-copy': {
        const input = $('#field-recovery-code', modal);
        void navigator.clipboard.writeText(input.value).then(() => notice('恢复码已复制'), () => input.select());
        return true;
      }
      default: return false;
    }
  }

  return { initialize, open, action, get access() { return access; } };
}
