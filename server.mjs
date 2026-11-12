import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createService, loadLocalModel } from './lib/service.mjs';
import { createAccounts } from './lib/accounts.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const service = createService(root, loadLocalModel(fileURLToPath(new URL('.env', import.meta.url))), createAccounts(join(root, '.local-preview')));
const port = Number(process.env.PORT || 3742);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 到 65535 的整数。');
const allowedHosts = new Set(['127.0.0.1', 'localhost'].flatMap(host => port === 80 ? [host, `${host}:${port}`] : [`${host}:${port}`]));

const server = createServer(async (request, response) => {
  const host = request.headers.host;
  const origin = allowedHosts.has(host) ? new URL(`http://${host}`).origin : null;
  if (!origin || (request.headers.origin && request.headers.origin !== origin)) {
    response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: '请从本机地址访问枝幕。' }));
    return;
  }
  const controller = new AbortController();
  response.once('close', () => { if (!response.writableEnded) controller.abort(); });
  try {
    const url = new URL(request.url, origin);
    if (url.origin !== origin) throw new Error('Unexpected request origin');
    const body = ['GET', 'HEAD'].includes(request.method) ? null : Readable.toWeb(request);
    const reply = await service(new Request(url, { method: request.method, headers: request.headers, body, duplex: 'half', signal: controller.signal }));
    if (response.destroyed) return;
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(reply.body ? Buffer.from(await reply.arrayBuffer()) : undefined);
  } catch {
    if (!response.destroyed) { response.writeHead(400); response.end(); }
  }
});
server.listen(port, '127.0.0.1', () => console.log(`枝幕开发预览 http://127.0.0.1:${port}`));
