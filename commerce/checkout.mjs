import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';
import { normalizeGuide } from '../public/methods.js';
import { offers } from './providers.mjs';

const orderPattern = /^[a-f0-9]{32}$/;
const accountPattern = /^Bearer ([A-Za-z0-9_-]{43})$/;
const now = () => Math.floor(Date.now() / 1000);

class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function send(response, data, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(data));
}

async function bytes(request, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError('请求太大。', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function createCheckout({ database, publicOrigin, providers, guide: rawGuide }) {
  const guide = normalizeGuide(rawGuide);
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, region TEXT NOT NULL, state TEXT NOT NULL,
      provider_id TEXT, checkout TEXT, expiry INTEGER NOT NULL, created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_owner ON orders(owner, created);
    CREATE TABLE IF NOT EXISTS entitlements (owner TEXT PRIMARY KEY, order_id TEXT NOT NULL, granted INTEGER NOT NULL);`);
  const byId = db.prepare('SELECT * FROM orders WHERE id=?');
  const latest = db.prepare("SELECT * FROM orders WHERE owner=? AND state IN ('creating','pending') ORDER BY created DESC, rowid DESC LIMIT 1");
  const entitled = db.prepare('SELECT order_id FROM entitlements WHERE owner=?');
  const insert = db.prepare("INSERT INTO orders(id,owner,region,state,expiry,created) VALUES(?,?,?,'creating',?,?)");
  const updateProvider = db.prepare("UPDATE orders SET provider_id=?, checkout=?, state='pending' WHERE id=? AND state='creating'");
  const state = db.prepare('UPDATE orders SET state=? WHERE id=?');
  const grant = db.prepare('INSERT OR IGNORE INTO entitlements(owner,order_id,granted) VALUES(?,?,?)');
  const queues = new Map();
  const recentQuery = new Map();
  const orderRate = new Map();
  const regions = Object.keys(offers).filter(region => providers[region]);

  function serialized(owner, action) {
    const job = (queues.get(owner) || Promise.resolve()).then(action);
    const tail = job.catch(() => {});
    queues.set(owner, tail);
    return job.finally(() => { if (queues.get(owner) === tail) queues.delete(owner); });
  }

  function checkRate(request) {
    const time = now();
    for (const [key, rate] of orderRate) if (rate.until < time) orderRate.delete(key);
    const ip = request.socket.remoteAddress || 'local';
    const rate = orderRate.get(ip) || { count: 0, until: time + 60 };
    if (++rate.count > 60) throw new HttpError('请求过于频繁，请稍后再试。', 429);
    orderRate.set(ip, rate);
  }

  function markPaid(order) {
    db.exec('BEGIN IMMEDIATE');
    try {
      state.run('paid', order.id);
      grant.run(order.owner, order.id, now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  async function reconcile(order, force = false) {
    const provider = providers[order.region];
    if (!provider || (!order.provider_id && order.region === 'usd')) return order;
    const time = now();
    for (const [key, value] of recentQuery) if (time - value > 10) recentQuery.delete(key);
    if (!force && time - (recentQuery.get(order.id) || 0) < 3) return order;
    recentQuery.set(order.id, time);
    const result = await provider.status(order);
    if (result === 'paid') markPaid(order);
    else if (result === 'expired' || (result === 'missing' && order.expiry <= time)) state.run('expired', order.id);
    else if (order.region === 'cn' && order.expiry <= time && result === 'pending') {
      try { await provider.close(order); } catch { /* A concurrent payment can complete just before closing. */ }
      const after = await provider.status(order);
      if (after === 'paid') markPaid(order);
      else if (after === 'expired') state.run('expired', order.id);
    }
    return byId.get(order.id);
  }

  function snapshot(owner, pending) {
    if (entitled.get(owner)) return { unlocked: true, order: null, guide, regions };
    const order = pending && ['creating', 'pending'].includes(pending.state) ? {
      region: pending.region, checkout: pending.checkout ? publicOrigin + '/checkout/' + pending.id : '',
    } : null;
    return { unlocked: false, order, regions };
  }

  async function create(owner, region) {
    if (!regions.includes(region)) throw new HttpError('该地区的支付渠道尚未开通。', 409);
    if (entitled.get(owner)) return snapshot(owner);
    let order = latest.get(owner);
    if (order) order = await reconcile(order, true);
    if (entitled.get(owner)) return snapshot(owner);
    if (order && ['creating', 'pending'].includes(order.state) && order.region !== region) {
      throw new HttpError('已有另一地区的订单。可先取消未支付订单。', 409);
    }
    if (!order || order.state === 'expired') {
      const id = randomBytes(16).toString('hex');
      const time = now();
      insert.run(id, owner, region, time + offers[region].expires, time);
      order = byId.get(id);
    }
    if (order.state === 'creating') {
      const created = await providers[region].create(order);
      updateProvider.run(created.providerId, created.checkout, order.id);
      order = byId.get(order.id);
    }
    return snapshot(owner, order);
  }

  async function cancel(owner) {
    const order = latest.get(owner);
    if (!order || entitled.get(owner)) return snapshot(owner);
    const checked = await reconcile(order, true);
    if (!['creating', 'pending'].includes(checked.state)) return snapshot(owner);
    const provider = providers[checked.region];
    if (!provider) throw new HttpError('此订单渠道暂不可用。', 409);
    if (checked.region === 'usd' && !checked.provider_id) {
      const created = await provider.create(checked);
      updateProvider.run(created.providerId, created.checkout, checked.id);
    }
    const current = byId.get(checked.id);
    try { await provider.close(current); } catch { /* Query the provider before deciding whether this order is closed. */ }
    const result = await provider.status(current);
    if (result === 'paid') markPaid(current);
    else if (['missing', 'expired'].includes(result)) state.run('expired', current.id);
    else throw new HttpError('订单还在处理，请稍后检查。', 409);
    return snapshot(owner);
  }

  async function page(response, order, returned) {
    if (!order) throw new HttpError('未找到该订单。', 404);
    let instructions = '<p>请返回枝幕检查支付状态。</p>';
    if (order.state === 'paid') instructions = '<p>款项已确认。返回枝幕即可使用创作方法。</p>';
    else if (order.state === 'expired') instructions = '<p>订单已关闭。请从枝幕重新下单。</p>';
    else if (order.state === 'pending' && !returned) {
      if (order.region === 'usd') instructions = `<a href="${escape(order.checkout)}" rel="noopener noreferrer">前往 Stripe 收银台</a>`;
      else instructions = `<img src="${await QRCode.toDataURL(order.checkout, { margin: 2, width: 260 })}" alt="微信支付二维码"><p>用微信扫一扫，付款后返回枝幕。</p>`;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'",
    }).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>枝幕收银台</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15131a;color:#f5edf8;font:16px system-ui,sans-serif}
      main{text-align:center;background:#25202c;border:1px solid #483852;border-radius:16px;padding:30px;max-width:440px}
      p{color:#d8c9e0}strong{display:block;font-size:27px;margin:12px}a{display:inline-block;background:#dcc7ff;color:#22172e;padding:12px 20px;border-radius:8px;text-decoration:none}
      img{display:block;max-width:100%;margin:14px auto;border-radius:6px}</style>
      <main><h1>解锁枝幕创作方法</h1><strong>${offers[order.region].display}</strong>${instructions}</main></html>`);
  }

  async function route(request, response) {
    const url = new URL(request.url, publicOrigin);
    const { pathname } = url;
    if (request.method === 'GET' && pathname === '/api/offers') return send(response, { regions });
    if (request.method === 'GET' && pathname.startsWith('/checkout/')) {
      const id = pathname.slice(10);
      return page(response, orderPattern.test(id) && byId.get(id), url.searchParams.has('returned'));
    }
    if (request.method === 'POST' && ['/hooks/stripe', '/hooks/wechat'].includes(pathname)) {
      const region = pathname.endsWith('stripe') ? 'usd' : 'cn';
      const provider = providers[region];
      if (!provider) throw new HttpError('支付渠道未配置。', 404);
      const body = await bytes(request);
      let notice;
      try { notice = provider.notice(request.headers, body); }
      catch { throw new HttpError('支付通知未通过验证。', 400); }
      const order = notice && orderPattern.test(notice.id || '') && byId.get(notice.id);
      if (order && order.region === region && (!notice.providerId || notice.providerId === order.provider_id)) {
        await serialized(order.owner, async () => {
          const current = byId.get(order.id);
          if (current.state !== 'paid') await reconcile(current, true);
        });
      }
      return response.writeHead(204).end();
    }
    if (!['/api/access', '/api/order', '/api/cancel'].includes(pathname)) throw new HttpError('页面不存在。', 404);
    const credential = String(request.headers.authorization || '').match(accountPattern)?.[1];
    if (!credential) throw new HttpError('缺少购买凭据。', 401);
    const owner = createHash('sha256').update(credential).digest('hex');
    if (request.method === 'GET' && pathname === '/api/access') {
      return send(response, await serialized(owner, async () => {
        if (entitled.get(owner)) return snapshot(owner);
        const order = latest.get(owner);
        return snapshot(owner, order ? await reconcile(order) : null);
      }));
    }
    if (request.method === 'POST' && pathname === '/api/order') {
      checkRate(request);
      let body;
      try { body = JSON.parse(await bytes(request, 4096)); } catch { throw new HttpError('订单参数无效。', 400); }
      return send(response, await serialized(owner, () => create(owner, body?.region)));
    }
    if (request.method === 'POST' && pathname === '/api/cancel') return send(response, await serialized(owner, () => cancel(owner)));
    throw new HttpError('请求方法不支持。', 405);
  }

  return {
    handle(request, response) {
      void route(request, response).catch(error => {
        if (!response.headersSent) send(response, { error: error instanceof HttpError ? error.message : '支付渠道暂时不可用，请稍后检查。' }, error.status || 502);
        else response.end();
      });
    },
    close: () => db.close(),
  };
}
