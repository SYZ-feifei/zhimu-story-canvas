import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RequestError } from './ai.mjs';

const scrypt = promisify(derive);
const publicAccount = ({ id, name }) => ({ id, name });

export function createAccounts(directory) {
  const path = join(directory, 'accounts.json');
  const sessions = new Map();
  let writes = Promise.resolve();

  async function accounts() {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  function tokenOf(request) { return request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]; }
  function session(request) { return sessions.get(tokenOf(request)) || null; }
  function signIn(account) {
    const token = randomBytes(32).toString('hex');
    const identity = publicAccount(account);
    sessions.set(token, identity);
    return { token, account: identity };
  }

  async function register(input) {
    const name = typeof input.name === 'string' ? input.name.normalize('NFC').trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (name.length < 2 || name.length > 32 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new RequestError('账号名称需为 2 到 32 个可见字符。');
    if (password.length < 8 || password.length > 200) throw new RequestError('密码需为 8 到 200 个字符。');
    const key = name.toLowerCase();
    const job = writes.then(async () => {
      const entries = await accounts();
      if (entries.some(entry => entry.key === key)) throw new RequestError('这个账号名已存在。', 409);
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      const account = { id: randomUUID(), name, key, salt, hash };
      await mkdir(directory, { recursive: true });
      const pending = `${path}.${randomUUID()}.tmp`;
      await writeFile(pending, JSON.stringify([...entries, account]), { mode: 0o600 });
      await rename(pending, path);
      return signIn(account);
    });
    writes = job.catch(() => {});
    return job;
  }

  async function login(input) {
    const name = typeof input.name === 'string' ? input.name.normalize('NFC').trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const account = (await accounts()).find(entry => entry.key === name);
    if (!account || !password || password.length > 200 ||
        !timingSafeEqual(await scrypt(password, account.salt, 64), Buffer.from(account.hash, 'hex'))) {
      throw new RequestError('账号或密码有误。', 401);
    }
    return signIn(account);
  }

  return { session, register, login,
    status: async request => ({ account: session(request), hasAccounts: Boolean((await accounts()).length) }),
    logout: request => { sessions.delete(tokenOf(request)); return { ok: true }; },
  };
}
