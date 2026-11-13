import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { modelProfile, RequestError } from './ai.mjs';
import { cleanText } from '../public/story.js';

const identifier = /^[a-zA-Z0-9_-]{1,90}$/;
const publicProfile = ({ id, name, provider, base, model, reasoningLevels, protectedKey }) =>
  ({ id, name, provider, base, model, reasoningLevels, hasKey: Boolean(protectedKey) });
const sameEndpoint = (left, right) => left && left.provider === right.provider && left.base === right.base;

export function createModelSettings({ directory, protect, unprotect } = {}) {
  const memory = new Map();
  const writes = new Map();
  const persistent = Boolean(directory);

  async function read(accountId) {
    if (!persistent) return memory.get(accountId) || [];
    try {
      const data = JSON.parse(await readFile(join(directory, `${accountId}.json`), 'utf8'));
      if (!Array.isArray(data.profiles)) throw new Error('Invalid profiles');
      return data.profiles;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new RequestError('本机模型设置读取失败。', 500);
    }
  }

  async function write(accountId, profiles) {
    if (!persistent) { memory.set(accountId, profiles); return; }
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${accountId}.json`);
    const pending = join(directory, `.${accountId}-${randomUUID()}.tmp`);
    try {
      await writeFile(pending, JSON.stringify({ profiles }), { mode: 0o600 });
      await rename(pending, file);
    } finally { await rm(pending, { force: true }); }
  }

  function update(accountId, change) {
    const next = (writes.get(accountId) || Promise.resolve()).then(async () => {
      const profiles = await change(await read(accountId));
      await write(accountId, profiles);
      return { profiles: profiles.map(publicProfile), persistent };
    });
    const tail = next.catch(() => {});
    writes.set(accountId, tail);
    return next.finally(() => { if (writes.get(accountId) === tail) writes.delete(accountId); });
  }

  async function decrypt(value) {
    if (!value) return '';
    if (!persistent) return value;
    try { return await unprotect(value); }
    catch { throw new RequestError('本机凭据无法解密，请在用户设置重新填写 API Key。', 400); }
  }

  async function encrypt(value) {
    if (!value) return '';
    if (!persistent) return value;
    try { return await protect(value); }
    catch { throw new RequestError('本机暂时无法保护 API Key。请重新打开枝幕后再试。', 500); }
  }

  return {
    async list(accountId) { return { profiles: (await read(accountId)).map(publicProfile), persistent }; },
    save(accountId, raw) {
      if (!raw || typeof raw.id !== 'string' || !identifier.test(raw.id) || raw.id === 'env' || raw.id.startsWith('signin-')) throw new RequestError('模型配置编号无效。');
      const { apiKey, ...connection } = modelProfile(raw, { allowMissingKey: true });
      const name = cleanText(raw.name, 80) || (raw.id === 'agent' ? 'Agent' : connection.model);
      return update(accountId, async (profiles) => {
        const old = profiles.find(profile => profile.id === raw.id);
        const protectedKey = apiKey ? await encrypt(apiKey) : sameEndpoint(old, connection) ? old.protectedKey : '';
        const saved = { ...connection, id: raw.id, name, protectedKey };
        return old ? profiles.map(profile => profile.id === saved.id ? saved : profile) : [...profiles, saved];
      });
    },
    remove(accountId, id) { return update(accountId, profiles => profiles.filter(profile => profile.id !== id)); },
    async resolve(accountId, id) {
      const profile = (await read(accountId)).find(item => item.id === id);
      if (!profile) throw new RequestError('请先在用户设置配置接口。');
      return modelProfile({ ...profile, apiKey: await decrypt(profile.protectedKey) });
    },
    async testDraft(accountId, raw) {
      const draft = modelProfile(raw, { allowMissingKey: true });
      const saved = (await read(accountId)).find(item => item.id === raw.id);
      return modelProfile({ ...draft, apiKey: draft.apiKey || (sameEndpoint(saved, draft) ? await decrypt(saved.protectedKey) : '') });
    },
  };
}
