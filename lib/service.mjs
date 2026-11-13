import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { analyzePart, analyzeScript, assess, brainstorm, develop, modelProfile, RequestError, suggest, testModel } from './ai.mjs';
import { documentExport, EXPORT_MIME } from './documents.mjs';
import { extractScript } from './import.mjs';
import { createModelSettings } from './model-settings.mjs';
import { normalizeProject } from '../public/story.js';
import { DIRECT_IDS, isDirectProfileId } from './direct-models.mjs';
import { noCommerce } from './commerce-client.mjs';

const contentHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const vendor = new Map([
  ['/vendor/icons/style.css', 'node_modules/@phosphor-icons/web/src/regular/style.css'],
  ['/vendor/icons/Phosphor.woff2', 'node_modules/@phosphor-icons/web/src/regular/Phosphor.woff2'],
  ['/vendor/icons/Phosphor.woff', 'node_modules/@phosphor-icons/web/src/regular/Phosphor.woff'],
  ['/vendor/icons/Phosphor.ttf', 'node_modules/@phosphor-icons/web/src/regular/Phosphor.ttf'],
  ['/vendor/geist.woff2', 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'],
]);

export function loadLocalModel(envPath) {
  try { process.loadEnvFile(envPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!process.env.STORY_AI_MODEL) return null;
  return { provider: process.env.STORY_AI_PROVIDER || 'openai', base: process.env.STORY_AI_BASE_URL,
    model: process.env.STORY_AI_MODEL, apiKey: process.env.STORY_AI_API_KEY };
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { ...contentHeaders, 'Cache-Control': 'no-store' } });
}

async function readBody(request, limit = 20 * 1024 * 1024) {
  if (Number(request.headers.get('content-length')) > limit) throw new RequestError('项目数据过大。', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body || []) {
    size += chunk.byteLength;
    if (size > limit) throw new RequestError('项目数据过大。', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function bodyJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new RequestError('请求格式应为 JSON。', 415);
  const bytes = await readBody(request);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RequestError('无法读取请求数据。');
  }
}

function checkedProject(value) {
  try { return normalizeProject(value); } catch (error) { throw new RequestError(error.message); }
}

async function api(request, pathname, serverModel, accounts, modelSettings, { directModels, commerce }) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestError('请从枝幕提交请求。', 403);
  if (pathname === '/api/account/status' && request.method === 'GET') return json(await accounts.status(request));
  if (request.method === 'POST' && pathname === '/api/account/register') return json(await accounts.register(await bodyJson(request)), 201);
  if (request.method === 'POST' && pathname === '/api/account/login') return json(await accounts.login(await bodyJson(request)));
  if (request.method === 'POST' && pathname === '/api/account/logout') {
    const account = accounts.session(request);
    if (account) for (const id of Object.keys(DIRECT_IDS)) directModels?.cancel(account.id, id);
    return json(accounts.logout(request));
  }
  const account = accounts.session(request);
  if (!account) throw new RequestError('请登录枝幕。', 401);
  if (pathname === '/api/model-settings' && request.method === 'GET') return json(await modelSettings.list(account.id));
  if (pathname === '/api/direct-models' && request.method === 'GET') return json({ connections: await directModels?.list(account.id) || [] });
  if (pathname === '/api/method-access' && request.method === 'GET') return json(await commerce?.status(account.id) || noCommerce());
  if (pathname === '/api/config' && request.method === 'GET') {
    let profile = null;
    if (serverModel) {
      try {
        const configured = modelProfile(serverModel);
        profile = { id: 'env', name: '本机环境配置', provider: configured.provider, model: configured.model };
      } catch { /* Leave an incomplete profile unavailable in the selector. */ }
    }
    return json({ profile });
  }
  if (request.method !== 'POST') throw new RequestError('接口不存在。', 404);
  if (pathname === '/api/import/extract') {
    if (request.headers.get('content-type') !== 'application/octet-stream') throw new RequestError('请选择需要读取的剧本文件。', 415);
    let filename;
    try { filename = decodeURIComponent(request.headers.get('x-script-name') || ''); }
    catch { throw new RequestError('无法识别文件名。'); }
    return json(await extractScript(await readBody(request, 16 * 1024 * 1024), filename, request.signal));
  }
  const input = await bodyJson(request);
  if (pathname.startsWith('/api/direct-models/')) {
    if (!directModels || !Object.hasOwn(DIRECT_IDS, input.id)) throw new RequestError('该账号连接暂不可用。');
    const operation = pathname.slice('/api/direct-models/'.length);
    if (operation === 'connect') await directModels.connect(account.id, input.id, input, request.signal);
    else if (operation === 'choose') await directModels.choose(account.id, input.id, input.model);
    else if (operation === 'refresh') await directModels.refresh(account.id, input.id);
    else if (operation === 'cancel') directModels.cancel(account.id, input.id);
    else if (operation === 'disconnect') return json(await directModels.disconnect(account.id, input.id));
    else throw new RequestError('接口不存在。', 404);
    return json({ connections: await directModels.list(account.id) });
  }
  if (pathname.startsWith('/api/method-access/')) {
    const operation = pathname.slice('/api/method-access/'.length);
    if (!commerce) return json(noCommerce());
    if (operation === 'refresh') return json(await commerce.refresh(account.id));
    if (operation === 'buy') return json(await commerce.buy(account.id, input.region));
    if (operation === 'reopen') return json(await commerce.reopen(account.id));
    if (operation === 'cancel') return json(await commerce.cancel(account.id));
    if (operation === 'restore') return json(await commerce.restore(account.id, input.key));
    if (operation === 'recovery') return json(await commerce.recovery(account.id));
    throw new RequestError('接口不存在。', 404);
  }
  if (pathname === '/api/model-settings/save') return json(await modelSettings.save(account.id, input.profile));
  if (pathname === '/api/model-settings/remove') return json(await modelSettings.remove(account.id, input.id));
  if (pathname.startsWith('/api/export/')) {
    const format = pathname.slice('/api/export/'.length);
    if (!Object.hasOwn(EXPORT_MIME, format)) throw new RequestError('该导出格式不受支持。');
    const content = await documentExport(checkedProject(input.project), format);
    return new Response(content, { headers: { ...contentHeaders, 'Content-Type': EXPORT_MIME[format], 'Cache-Control': 'no-store' } });
  }
  if (!['/api/ai/test', '/api/ai/suggest', '/api/ai/brainstorm', '/api/ai/develop', '/api/ai/assess', '/api/ai/analyze-part', '/api/ai/analyze-script'].includes(pathname)) throw new RequestError('接口不存在。', 404);
  const profileId = input.profile?.id;
  const profile = profileId === 'env' ? modelProfile(serverModel ?? {})
    : directModels && isDirectProfileId(profileId) ? await directModels.resolve(account.id, profileId)
      : pathname === '/api/ai/test' && input.profile?.provider ? await modelSettings.testDraft(account.id, input.profile)
        : await modelSettings.resolve(account.id, profileId);
  if (pathname === '/api/ai/test') {
    await testModel(profile, request.signal);
    return json({ ok: true });
  }
  if (pathname === '/api/ai/analyze-part') return json(await analyzePart(profile, input, request.signal));
  if (pathname === '/api/ai/analyze-script') return json(await analyzeScript(profile, input, request.signal));
  const project = checkedProject(input.project);
  if (pathname === '/api/ai/brainstorm') return json({ ideas: await brainstorm(profile, project, input, request.signal) });
  if (pathname === '/api/ai/develop') return json(await develop(profile, project, input, request.signal, await commerce?.guide(account.id)));
  if (pathname === '/api/ai/suggest') {
    if (project.nodes.find(node => node.id === input.focusId)?.kind === 'agent' && profileId !== 'agent') {
      throw new RequestError('请在用户设置配置 Agent 接口。');
    }
    return json({ options: await suggest(profile, project, input, request.signal, await commerce?.guide(account.id)) });
  }
  return json({ marks: await assess(profile, project, request.signal) });
}

export function createService(root, serverModel, accounts, modelSettings = createModelSettings(), options = {}) {
  const publicRoot = resolve(root, 'public');
  return async (request) => {
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url).pathname); }
      catch { throw new RequestError('地址格式有误。'); }
      if (pathname.startsWith('/api/')) return await api(request, pathname, serverModel, accounts, modelSettings, options);
      if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError('请求方法不受支持。', 405);
      if (pathname === '/') pathname = '/index.html';
      const type = mime[extname(pathname)];
      const vendorPath = vendor.get(pathname);
      const path = vendorPath ? resolve(root, vendorPath) : resolve(publicRoot, `.${pathname}`);
      if (!type || (!vendorPath && !path.startsWith(publicRoot + sep))) throw new RequestError('页面不存在。', 404);
      let bytes;
      try { bytes = await readFile(path); } catch { throw new RequestError('页面不存在。', 404); }
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: { ...contentHeaders,
        'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' } });
    } catch (error) {
      if (!(error instanceof RequestError)) console.error('应用错误', error.name, error.code || '');
      return json({ error: error instanceof RequestError ? error.message : '应用处理失败，请稍后重试。' }, error.status || 500);
    }
  };
}
