import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assess, modelProfile, RequestError, suggest, testModel } from './lib/ai.mjs';
import { documentExport, EXPORT_MIME } from './lib/documents.mjs';
import { normalizeProject } from './public/story.js';

try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const root = fileURLToPath(new URL('./', import.meta.url));
const publicRoot = resolve(root, 'public');
const port = Number(process.env.PORT || 3742);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 到 65535 的整数。');
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const vendor = new Map([
  ['/vendor/icons/style.css', 'node_modules/@phosphor-icons/web/src/regular/style.css'],
  ['/vendor/icons/Phosphor.woff2', 'node_modules/@phosphor-icons/web/src/regular/Phosphor.woff2'],
  ['/vendor/icons/Phosphor.woff', 'node_modules/@phosphor-icons/web/src/regular/Phosphor.woff'],
  ['/vendor/icons/Phosphor.ttf', 'node_modules/@phosphor-icons/web/src/regular/Phosphor.ttf'],
  ['/vendor/geist.woff2', 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'],
]);
const serverModel = process.env.STORY_AI_MODEL ? {
  provider: process.env.STORY_AI_PROVIDER || 'openai', base: process.env.STORY_AI_BASE_URL,
  model: process.env.STORY_AI_MODEL, apiKey: process.env.STORY_AI_API_KEY,
} : null;

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function bodyJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new RequestError('请求格式应为 JSON。', 415);
  const limit = 20 * 1024 * 1024;
  if (Number(request.headers['content-length']) > limit) throw new RequestError('项目数据过大。', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new RequestError('项目数据过大。', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RequestError('无法读取请求数据。');
  }
}

function checkedProject(value) {
  try { return normalizeProject(value); } catch (error) { throw new RequestError(error.message); }
}

async function serveApi(request, response, pathname) {
  if (pathname === '/api/config' && request.method === 'GET') {
    let profile = null;
    if (serverModel) {
      try {
        const configured = modelProfile(serverModel);
        profile = { id: 'env', name: '本机环境配置', provider: configured.provider, model: configured.model };
      } catch { /* Leave an incomplete profile unavailable in the selector. */ }
    }
    return json(response, 200, { profile });
  }
  if (request.method !== 'POST') throw new RequestError('接口不存在。', 404);
  if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) throw new RequestError('请从枝幕页面提交请求。', 403);
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new RequestError('请从枝幕页面提交请求。', 403);
  const input = await bodyJson(request);
  if (pathname.startsWith('/api/export/')) {
    const format = pathname.slice('/api/export/'.length);
    if (!Object.hasOwn(EXPORT_MIME, format)) throw new RequestError('该导出格式不受支持。');
    const project = checkedProject(input.project);
    const content = await documentExport(project, format);
    response.writeHead(200, { 'Content-Type': EXPORT_MIME[format], 'Content-Length': content.length, 'Cache-Control': 'no-store' });
    return response.end(content);
  }
  if (!['/api/ai/test', '/api/ai/suggest', '/api/ai/assess'].includes(pathname)) throw new RequestError('接口不存在。', 404);
  const profile = modelProfile(input.profile?.id === 'env' ? serverModel ?? {} : input.profile ?? {});
  const abort = new AbortController();
  response.once('close', () => { if (!response.writableEnded) abort.abort(); });
  if (pathname === '/api/ai/test') {
    await testModel(profile, abort.signal);
    return json(response, 200, { ok: true });
  }
  const project = checkedProject(input.project);
  if (pathname === '/api/ai/suggest') return json(response, 200, { options: await suggest(profile, project, input, abort.signal) });
  return json(response, 200, { marks: await assess(profile, project, abort.signal) });
}

async function serve(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (!allowedHosts.has(request.headers.host)) throw new RequestError('请从本机地址访问枝幕。', 403);
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { throw new RequestError('地址格式有误。'); }
  if (pathname.startsWith('/api/')) return serveApi(request, response, pathname);
  if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError('请求方法不受支持。', 405);
  const type = mime[extname(pathname === '/' ? '/index.html' : pathname)];
  const vendorPath = vendor.get(pathname);
  const path = vendorPath ? resolve(root, vendorPath) : resolve(publicRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!type || (!vendorPath && !path.startsWith(publicRoot + sep))) throw new RequestError('页面不存在。', 404);
  let bytes;
  try { bytes = await readFile(path); } catch { throw new RequestError('页面不存在。', 404); }
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

const server = createServer((request, response) => {
  serve(request, response).catch(error => {
    if (response.destroyed || response.writableEnded) return;
    if (!(error instanceof RequestError)) console.error('应用错误', error.name, error.code || '');
    json(response, error.status || 500, { error: error instanceof RequestError ? error.message : '应用处理失败，请稍后重试。' });
  });
});
server.listen(port, '127.0.0.1', () => console.log(`枝幕已启动 http://127.0.0.1:${port}`));
