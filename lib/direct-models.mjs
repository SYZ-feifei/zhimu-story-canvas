import { createHash, randomUUID } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { RequestError } from './ai.mjs';
import { browserAuthorization } from './browser-oauth.mjs';

export const DIRECT_IDS = { chatgpt: 'signin-chatgpt', gemini: 'signin-gemini' };
const directProfile = /^signin-(chatgpt|gemini)(?:-([a-f0-9]{24}))?$/;
export const isDirectProfileId = id => typeof id === 'string' && directProfile.test(id);
const modelHash = id => createHash('sha256').update(id).digest('hex').slice(0, 24);
const openai = {
  issuer: 'https://auth.openai.com',
  authorize: 'https://auth.openai.com/api/accounts/authorize',
  token: 'https://auth.openai.com/api/accounts/oauth/token',
  jwks: 'https://auth.openai.com/.well-known/jwks.json',
  discovery: 'https://auth.openai.com/.well-known/openid-configuration',
  base: 'https://api.openai.com/v1',
};
const google = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  base: 'https://generativelanguage.googleapis.com/v1beta',
};
const openaiScopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const geminiScopes = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever';
const providerNames = { chatgpt: 'ChatGPT', gemini: 'Gemini · Google Cloud' };

function googleCredentials(input) {
  const fields = input?.client?.installed || input?.client;
  const clientId = String(fields?.client_id || '').trim();
  const secret = String(fields?.client_secret || '').trim();
  const project = String(input?.project || fields?.project_id || '').trim();
  if (!/^[\w-]{8,200}\.apps\.googleusercontent\.com$/.test(clientId) ||
    !/^[\w-]{6,250}$/.test(secret) || !/^(?:[a-z][a-z0-9-]{4,62}[a-z0-9]|[0-9]{6,24})$/.test(project)) {
    throw new RequestError('请选择 Google OAuth 桌面客户端 JSON，并填写已启用 Gemini API 的 Cloud 项目 ID。');
  }
  return { clientId, secret, project };
}

function parseTokens(raw, previous) {
  const expires = Number(raw?.expires_in);
  if (typeof raw?.access_token !== 'string' || !raw.access_token || !Number.isFinite(expires) || expires <= 0) {
    throw new RequestError('服务商未返回有效的授权。请重新连接。');
  }
  const scopes = typeof raw.scope === 'string' ? raw.scope.split(/\s+/) : previous?.scopes || [];
  return { access: raw.access_token, refresh: raw.refresh_token || previous?.refresh || '',
    expiresAt: Date.now() + expires * 1000, scopes };
}

function requirePlan(scopes) {
  if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) {
    throw new RequestError('此 ChatGPT 账号未授权使用计划内模型。请检查账号资格和授权范围。');
  }
}

function publicEntry(id, data, ready, pending) {
  const models = (data?.models || []).map(model => ({ ...model, profileId: DIRECT_IDS[id] + '-' + modelHash(model.id) }));
  return { id, name: providerNames[id], ready, pending, connected: Boolean(data?.model),
    model: data?.model || '', models, project: id === 'gemini' ? data?.settings?.project || '' : '' };
}

export function createDirectModels({ vault, open, allowChatgpt, googleConfig, fetcher = fetch }) {
  let builtInGoogle = null;
  if (googleConfig) builtInGoogle = googleCredentials(googleConfig);
  const attempts = new Map();
  const allowed = id => id === 'gemini' || (id === 'chatgpt' && allowChatgpt);
  const keyFor = (id, provider) => id + '/' + provider;
  const describe = id => id === 'chatgpt' ? 'ChatGPT' : 'Google';

  async function requestJson(url, options, message) {
    try {
      const timeout = AbortSignal.timeout(20000);
      const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      const response = await fetcher(url, { ...options, redirect: 'error', signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new RequestError(`${message}（HTTP ${response.status}）。`, 502);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(message + '，请检查网络后重试。', 502);
    }
  }

  function exchange(id, values, signal) {
    return requestJson(id === 'chatgpt' ? openai.token : google.token,
      { method: 'POST', body: new URLSearchParams(values), signal }, `${describe(id)} 授权交换失败`);
  }

  async function listModels(id, data, signal) {
    const headers = { Authorization: 'Bearer ' + data.tokens.access };
    if (id === 'gemini') headers['x-goog-user-project'] = data.settings.project;
    const catalog = await requestJson((id === 'chatgpt' ? openai.base : google.base) + '/models', { headers, signal },
      id === 'chatgpt' ? '读取此 ChatGPT 账号可用模型失败' : '读取 Gemini 模型失败，请检查 Cloud 项目权限和 Gemini API');
    const entries = id === 'chatgpt'
      ? (catalog.models || []).filter(model => model.visibility === 'list').map(model => [model.slug, model.display_name])
      : (catalog.models || []).filter(model => model.supportedGenerationMethods?.includes('generateContent')).map(model => [model.name?.replace(/^models\//, ''), model.displayName]);
    const modelPattern = id === 'gemini' ? /^[\w.-]{1,180}$/ : /^[\w./-]{1,180}$/;
    const models = entries.filter(([key]) => typeof key === 'string' && modelPattern.test(key))
      .slice(0, 100).map(([key, label]) => ({ id: key, name: String(label || key).slice(0, 120) }));
    if (!models.length) throw new RequestError('当前账号没有可供枝幕使用的模型。');
    return models;
  }

  async function connectChatgpt(account, previous, signal) {
    const host = account.host;
    const client = previous?.clientId || 'dynamic_agent_client';
    const auth = await browserAuthorization({ open, endpoint: openai.authorize, signal, parameters: {
      client_id: client, ext_agent_host_id: host, scope: openaiScopes, resource: openai.base,
      ...(previous?.clientId ? { ...(previous.idToken ? { id_token_hint: previous.idToken } : {}) } : { agent_name_hint: '枝幕 Zhimu' }),
    } });
    const clientId = previous?.clientId || auth.clientId;
    if (!/^oaiapp_[\w-]{6,150}$/.test(clientId || '') || (auth.clientId && clientId !== auth.clientId)) {
      throw new RequestError('ChatGPT 返回的注册编号无效，请重新授权。');
    }
    const raw = await exchange('chatgpt', { grant_type: 'authorization_code', client_id: clientId, code: auth.code,
      code_verifier: auth.verifier, redirect_uri: auth.redirect, resource: openai.base }, signal);
    const tokens = parseTokens(raw);
    requirePlan(tokens.scopes);
    const jwks = await requestJson(openai.jwks, { signal }, '读取 OpenAI 身份验证公钥失败');
    let identity;
    try {
      ({ payload: identity } = await jwtVerify(raw.id_token, createLocalJWKSet(jwks), {
        issuer: openai.issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
      }));
      if (identity.nonce !== auth.nonce || typeof identity.sub !== 'string' || !identity.sub ||
          (previous?.subject && previous.subject !== identity.sub)) throw new Error();
    } catch { throw new RequestError('ChatGPT 返回的身份未通过验证。请重新连接。'); }
    return { clientId, subject: identity.sub, idToken: raw.id_token, tokens };
  }

  async function connectGemini(settings, signal) {
    const auth = await browserAuthorization({ open, endpoint: google.authorize, signal, parameters: {
      client_id: settings.clientId, scope: geminiScopes, access_type: 'offline', prompt: 'consent select_account',
    } });
    const raw = await exchange('gemini', { grant_type: 'authorization_code', client_id: settings.clientId,
      client_secret: settings.secret, code: auth.code, code_verifier: auth.verifier, redirect_uri: auth.redirect }, signal);
    return { settings, tokens: parseTokens(raw) };
  }

  async function connect(accountId, id, input, signal) {
    if (!allowed(id)) throw new RequestError('此发行模式需要先开通 OpenAI 合作接入。');
    const key = keyFor(accountId, id);
    if (attempts.has(key)) throw new RequestError('此账号正在等待浏览器授权。');
    const controller = new AbortController();
    attempts.set(key, controller);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const account = await vault.update(accountId, previous =>
        id === 'chatgpt' && !previous.host ? { ...previous, host: 'urn:uuid:' + randomUUID() } : previous);
      const previous = account[id];
      const settings = id === 'gemini' && (input?.client ? googleCredentials(input) : previous?.settings || builtInGoogle);
      if (id === 'gemini' && !settings) throw new RequestError('请先配置 Google OAuth 桌面客户端。');
      const result = id === 'chatgpt' ? await connectChatgpt(account, previous, combined) : await connectGemini(settings, combined);
      const models = await listModels(id, result, combined);
      if (combined.aborted) throw new RequestError('账号授权已取消。');
      const model = models.find(item => item.id === previous?.model)?.id || models[0].id;
      await vault.update(accountId, current => ({ ...current, [id]: { ...result, models, model } }));
    } finally { attempts.delete(key); }
  }

  async function current(accountId, id) {
    if (!allowed(id)) throw new RequestError('此发行模式需要先开通 OpenAI 合作接入。');
    const account = await vault.update(accountId, async current => {
      const data = current[id];
      if (!data?.model) throw new RequestError('请先在用户设置连接该账号。');
      if (data.tokens.expiresAt > Date.now() + 90000) return current;
      if (!data.tokens.refresh) throw new RequestError('账号授权已过期，请在用户设置重新连接。', 401);
      const provider = id === 'chatgpt' ? { client_id: data.clientId, resource: openai.base }
        : { client_id: data.settings.clientId, client_secret: data.settings.secret };
      const raw = await exchange(id, { grant_type: 'refresh_token', refresh_token: data.tokens.refresh, ...provider });
      const tokens = parseTokens(raw, data.tokens);
      if (id === 'chatgpt') requirePlan(tokens.scopes);
      return { ...current, [id]: { ...data, tokens } };
    });
    return account[id];
  }

  async function revoke(id, data) {
    if (!data?.tokens.refresh) return false;
    try {
      let endpoint = google.revoke;
      if (id === 'chatgpt') {
        ({ revocation_endpoint: endpoint } = await requestJson(openai.discovery, {}, '读取 OpenAI 授权端点失败'));
        if (new URL(endpoint).origin !== openai.issuer) return false;
      }
      const body = new URLSearchParams({ token: data.tokens.refresh, ...(id === 'chatgpt'
        ? { token_type_hint: 'refresh_token', client_id: data.clientId } : {}) });
      const response = await fetcher(endpoint, { method: 'POST', body, signal: AbortSignal.timeout(5000), redirect: 'error' });
      await response.body?.cancel();
      return response.ok;
    } catch { return false; }
  }

  return {
    async list(accountId) {
      const account = await vault.get(accountId);
      return Object.keys(DIRECT_IDS).map(id => ({ ...publicEntry(id, allowed(id) ? account[id] : null, allowed(id), attempts.has(keyFor(accountId, id))),
        setup: id === 'gemini' && !builtInGoogle && !account.gemini?.settings }));
    },
    connect,
    cancel(accountId, id) { attempts.get(keyFor(accountId, id))?.abort(); },
    async disconnect(accountId, id) {
      attempts.get(keyFor(accountId, id))?.abort();
      let removed;
      await vault.update(accountId, previous => {
        const { [id]: data, ...rest } = previous;
        removed = data;
        return rest;
      });
      return { revoked: await revoke(id, removed) };
    },
    async choose(accountId, id, model) {
      await vault.update(accountId, account => {
        const data = account[id];
        if (!allowed(id) || !data?.models.some(item => item.id === model)) throw new RequestError('请选择账号中可用的模型。');
        return { ...account, [id]: { ...data, model } };
      });
    },
    async refresh(accountId, id) {
      const data = await current(accountId, id);
      const models = await listModels(id, data);
      await vault.update(accountId, account => {
        if (!account[id]) return account;
        return { ...account, [id]: { ...account[id], models, model: models.some(model => model.id === account[id].model) ? account[id].model : models[0].id } };
      });
    },
    async resolve(accountId, profileId) {
      const [, id, hash] = profileId.match(directProfile) || [];
      const data = await current(accountId, id);
      const model = hash ? data.models.find(item => modelHash(item.id) === hash)?.id : data.model;
      if (!model) throw new RequestError('该账号已无此模型，请为节点重新选择模型。');
      const base = id === 'chatgpt' ? openai.base : google.base;
      return { provider: id === 'chatgpt' ? 'openai' : 'gemini', mode: id === 'chatgpt' ? 'responses' : 'google-oauth',
        accessToken: data.tokens.access, project: data.settings?.project, base, model };
    },
  };
}
