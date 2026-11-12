import { createDecipheriv, createHmac, randomBytes, sign, timingSafeEqual, verify } from 'node:crypto';

export const offers = {
  cn: { label: '中国大陆', display: '¥1.00', currency: 'CNY', amount: 100, expires: 900 },
  usd: { label: '美元结算地区', display: 'US$1.00', currency: 'USD', amount: 100, expires: 86400 },
};
const invalid = () => new Error('Payment provider returned an invalid order.');
const textTime = () => Math.floor(Date.now() / 1000);
const timestampOK = value => /^\d{9,12}$/.test(value || '') && Math.abs(textTime() - Number(value)) < 300;

function sameHex(left, right) {
  return /^[a-f0-9]{64}$/.test(left || '') && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function stripeProvider({ key, webhookSecret, publicOrigin, fetcher = fetch }) {
  async function request(path, options) {
    const response = await fetcher('https://api.stripe.com/v1/checkout/sessions' + path, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { ...options?.headers, Authorization: 'Bearer ' + key },
    });
    if (!response.ok) { await response.body?.cancel(); throw invalid(); }
    return response.json();
  }

  return {
    async create(order) {
      const checkout = publicOrigin + '/checkout/' + order.id;
      const result = await request('', {
        method: 'POST', headers: { 'Idempotency-Key': 'zhimu-' + order.id },
        body: new URLSearchParams({
          mode: 'payment', client_reference_id: order.id, 'metadata[order_id]': order.id,
          success_url: checkout + '?returned=1', cancel_url: checkout + '?returned=1',
          'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': String(offers.usd.amount),
          'line_items[0][price_data][product_data][name]': 'Zhimu Screenwriting Methods',
        }),
      });
      const url = new URL(result.url);
      if (!/^cs_[\w-]{8,200}$/.test(result.id || '') || url.origin !== 'https://checkout.stripe.com') throw invalid();
      return { providerId: result.id, checkout: url.href };
    },
    async status(order) {
      const result = await request('/' + encodeURIComponent(order.provider_id));
      if (result.id !== order.provider_id || result.client_reference_id !== order.id ||
        result.mode !== 'payment' || result.currency !== 'usd' || result.amount_total !== offers.usd.amount) throw invalid();
      if (result.status === 'complete' && result.payment_status === 'paid') return 'paid';
      return result.status === 'expired' ? 'expired' : 'pending';
    },
    async close(order) {
      await request('/' + encodeURIComponent(order.provider_id) + '/expire', { method: 'POST' });
    },
    notice(headers, raw) {
      const signature = String(headers['stripe-signature'] || '').split(',');
      const timestamp = signature.find(part => part.startsWith('t='))?.slice(2);
      if (!timestampOK(timestamp)) throw invalid();
      const expected = createHmac('sha256', webhookSecret).update(timestamp + '.').update(raw).digest('hex');
      if (!signature.filter(part => part.startsWith('v1=')).some(part => sameHex(part.slice(3), expected))) throw invalid();
      const event = JSON.parse(raw);
      if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return null;
      const session = event.data?.object;
      return { id: session?.client_reference_id, providerId: session?.id };
    },
  };
}

export function wechatProvider({ appid, mchid, merchantSerial, merchantKey, platformSerial, platformKey, apiKey, publicOrigin, fetcher = fetch }) {
  const platformOrigin = 'https://api.mch.weixin.qq.com';
  const apiSecret = Buffer.from(apiKey, 'utf8');
  if (apiSecret.length !== 32) throw new Error('WeChat Pay API v3 key must be 32 bytes.');

  function verifyReply(headers, raw) {
    const { signature, nonce, time, serial } = headers;
    if (serial !== platformSerial || !timestampOK(time) || typeof nonce !== 'string' || !nonce || !signature) throw invalid();
    const content = Buffer.concat([Buffer.from(time + '\n' + nonce + '\n'), Buffer.from(raw), Buffer.from('\n')]);
    if (!verify('RSA-SHA256', content, platformKey, Buffer.from(signature, 'base64'))) throw invalid();
  }

  async function request(method, path, payload) {
    const body = payload ? JSON.stringify(payload) : '';
    const time = String(textTime()), nonce = randomBytes(16).toString('hex');
    const signature = sign('RSA-SHA256', Buffer.from([method, path, time, nonce, body, ''].join('\n')), merchantKey).toString('base64');
    const response = await fetcher(platformOrigin + path, {
      method, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Zhimu-Checkout/1',
        'Wechatpay-Serial': platformSerial,
        Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${time}",serial_no="${merchantSerial}"`,
      },
    });
    const raw = Buffer.from(await response.arrayBuffer());
    verifyReply({ signature: response.headers.get('Wechatpay-Signature'), serial: response.headers.get('Wechatpay-Serial'),
      time: response.headers.get('Wechatpay-Timestamp'), nonce: response.headers.get('Wechatpay-Nonce') }, raw);
    if (!response.ok) {
      const error = invalid();
      if (raw.length) error.providerCode = JSON.parse(raw).code;
      throw error;
    }
    return raw.length ? JSON.parse(raw) : {};
  }

  const orderPath = order => '/v3/pay/transactions/out-trade-no/' + order.id;
  return {
    async create(order) {
      const result = await request('POST', '/v3/pay/transactions/native', {
        appid, mchid, out_trade_no: order.id, description: '枝幕创作方法包',
        notify_url: publicOrigin + '/hooks/wechat', time_expire: new Date(order.expiry * 1000).toISOString().replace('.000Z', 'Z'),
        amount: { total: offers.cn.amount, currency: offers.cn.currency },
      });
      if (!/^weixin:\/\/wxpay\//.test(result.code_url || '') || result.code_url.length > 1000) throw invalid();
      return { providerId: order.id, checkout: result.code_url };
    },
    async status(order) {
      let result;
      try { result = await request('GET', orderPath(order) + '?' + new URLSearchParams({ mchid })); }
      catch (error) { if (error.providerCode === 'ORDER_NOT_EXIST') return 'missing'; throw error; }
      if (result.out_trade_no !== order.id || result.mchid !== mchid || result.appid !== appid) throw invalid();
      if (result.trade_state === 'SUCCESS') {
        if (result.amount?.currency !== offers.cn.currency || result.amount?.total !== offers.cn.amount) throw invalid();
        return 'paid';
      }
      return ['CLOSED', 'REVOKED', 'PAYERROR'].includes(result.trade_state) ? 'expired' : 'pending';
    },
    async close(order) {
      await request('POST', orderPath(order) + '/close', { mchid });
    },
    notice(headers, raw) {
      verifyReply({ signature: headers['wechatpay-signature'], serial: headers['wechatpay-serial'],
        time: headers['wechatpay-timestamp'], nonce: headers['wechatpay-nonce'] }, raw);
      const event = JSON.parse(raw);
      if (event.event_type !== 'TRANSACTION.SUCCESS') return null;
      const resource = event.resource;
      if (resource?.algorithm !== 'AEAD_AES_256_GCM') throw invalid();
      const ciphertext = Buffer.from(resource.ciphertext, 'base64');
      const decrypt = createDecipheriv('aes-256-gcm', apiSecret, resource.nonce);
      decrypt.setAuthTag(ciphertext.subarray(-16));
      decrypt.setAAD(Buffer.from(resource.associated_data || ''));
      const result = JSON.parse(Buffer.concat([decrypt.update(ciphertext.subarray(0, -16)), decrypt.final()]));
      if (result.mchid !== mchid || result.appid !== appid) throw invalid();
      return { id: result.out_trade_no };
    },
  };
}
