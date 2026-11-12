import { randomBytes } from 'node:crypto';
import { normalizeGuide } from '../public/methods.js';
import { RequestError } from './ai.mjs';

const validRegion = id => id === 'cn' || id === 'usd';
const keyPattern = /^[A-Za-z0-9_-]{43}$/;
const empty = { regions: [], order: null, guide: null };
export const noCommerce = () => ({ configured: false, unlocked: false, preview: false, ...empty });

export function createCommerceClient({ origin, authorGuide, vault, open, fetcher = fetch }) {
  const url = origin ? new URL(origin) : null;
  if (url && (url.href !== url.origin + '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')))) {
    throw new Error('Invalid checkout origin');
  }
  const configured = Boolean(url);
  const preview = !configured && authorGuide ? normalizeGuide(authorGuide) : null;
  const publicState = (state = empty) => ({ configured, unlocked: Boolean(state.guide), preview: Boolean(preview),
    regions: state.regions || [], order: state.order ? { region: state.order.region, payable: Boolean(state.order.checkout) } : null,
    guide: state.guide || preview });

  async function call(path, key, payload) {
    if (!configured) throw new RequestError('收银台尚未上线。');
    try {
      const response = await fetcher(url.origin + path, {
        ...(payload === undefined ? {} : { method: 'POST', body: JSON.stringify(payload) }),
        headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}),
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok) throw new RequestError(data.error || '收银台暂时不可用。', response.status);
      return data;
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError('无法连接收银台，请稍后重试。', 502);
    }
  }

  function verified(key, response) {
    const regions = Array.isArray(response.regions) ? response.regions.filter(validRegion) : [];
    let order = null;
    if (validRegion(response.order?.region)) {
      const checkout = response.order.checkout;
      if (checkout) {
        const link = new URL(checkout);
        if (link.origin !== url.origin || !/^\/checkout\/[a-f0-9]{32}$/.test(link.pathname) || link.search || link.hash) {
          throw new RequestError('收银台返回了无效的订单地址。', 502);
        }
      }
      order = { region: response.order.region, checkout };
    }
    return { key, order, regions, guide: response.unlocked === true ? normalizeGuide(response.guide) : null };
  }

  async function refresh(accountId) {
    if (!configured) return publicState();
    return publicState(await vault.update(accountId, async state => {
      if (state.key) return verified(state.key, await call('/api/access', state.key));
      const { regions } = await call('/api/offers');
      return { ...state, regions: Array.isArray(regions) ? regions.filter(validRegion) : [] };
    }));
  }

  return {
    configured,
    async status(accountId) { return publicState(await vault.get(accountId)); },
    async guide(accountId) { return (await vault.get(accountId)).guide || preview; },
    refresh,
    async buy(accountId, region) {
      if (!configured) throw new RequestError('收银台尚未上线。');
      if (!validRegion(region)) throw new RequestError('请选择支付地区。');
      await vault.update(accountId, state => state.key ? state : { ...state, key: randomBytes(32).toString('base64url') });
      const next = await vault.update(accountId, async state => verified(state.key, await call('/api/order', state.key, { region })));
      if (next.order?.checkout) await open(next.order.checkout);
      return publicState(next);
    },
    async reopen(accountId) {
      const next = await refresh(accountId);
      const state = await vault.get(accountId);
      if (state.order?.checkout) await open(state.order.checkout);
      return next;
    },
    async cancel(accountId) {
      return publicState(await vault.update(accountId, async state =>
        state.key ? verified(state.key, await call('/api/cancel', state.key, {})) : state));
    },
    async restore(accountId, key) {
      if (!keyPattern.test(key || '')) throw new RequestError('恢复码格式无效。');
      return publicState(await vault.update(accountId, async state => {
        if (state.order) throw new RequestError('请先处理当前未完成的订单。');
        const restored = verified(key, await call('/api/access', key));
        if (!restored.guide) throw new RequestError('该恢复码没有已确认的购买记录。');
        return restored;
      }));
    },
    async recovery(accountId) {
      const state = await vault.get(accountId);
      if (!state.guide || !state.key) throw new RequestError('购买确认后可查看恢复码。');
      return { key: state.key };
    },
  };
}
