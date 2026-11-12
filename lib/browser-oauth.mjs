import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { RequestError } from './ai.mjs';

const random = () => randomBytes(32).toString('base64url');

export function browserAuthorization({ open, endpoint, parameters, signal, path = '/auth/callback' }) {
  const state = random();
  const nonce = random();
  const verifier = random();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return new Promise((resolve, reject) => {
    let finished = false;
    let redirect;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      server.close();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new RequestError('账号授权已取消。', 400));
    const server = createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!redirect || request.method !== 'GET' || request.headers.host !== new URL(redirect).host || url.pathname !== path) {
        response.writeHead(404).end();
        return;
      }
      if (url.searchParams.get('state') !== state || finished) {
        response.writeHead(400).end('Invalid authorization state.');
        return;
      }
      const code = url.searchParams.get('code');
      const denied = !code || url.searchParams.has('error');
      const message = denied ? '授权未完成。请返回枝幕重试。' : '已收到授权，请回到枝幕查看连接结果。';
      response.writeHead(denied ? 400 : 200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'", Connection: 'close',
      }).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>枝幕</title><h1>${message}</h1></html>`);
      if (denied) finish(new RequestError('授权未完成，或用户拒绝了授权。', 400));
      else finish(null, { code, clientId: url.searchParams.get('client_id'), redirect, verifier, nonce });
    });
    const timer = setTimeout(() => finish(new RequestError('授权等待超时，请重试。', 408)), 180000);
    server.once('error', () => finish(new RequestError('无法启动本机授权窗口。', 500)));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    server.listen(0, '127.0.0.1', () => {
      if (finished) return;
      redirect = `http://127.0.0.1:${server.address().port}${path}`;
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ ...parameters, response_type: 'code', redirect_uri: redirect, state, nonce,
        code_challenge: challenge, code_challenge_method: 'S256' });
      Promise.resolve().then(() => open(url.href)).catch(() => finish(new RequestError('无法打开系统浏览器。', 500)));
    });
  });
}
