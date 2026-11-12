import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function secureAccountStore(directory, { protect, unprotect }) {
  const values = new Map();
  const writes = new Map();
  const reads = new Map();
  const pathFor = id => join(directory, id + '.sealed');

  async function read(id) {
    if (!values.has(id)) {
      if (!reads.has(id)) reads.set(id, (async () => {
        try { values.set(id, JSON.parse(await unprotect(await readFile(pathFor(id), 'utf8')))); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          values.set(id, {});
        } finally { reads.delete(id); }
      })());
      await reads.get(id);
    }
    return values.get(id);
  }

  async function write(id, next) {
    const sealed = await protect(JSON.stringify(next));
    await mkdir(directory, { recursive: true });
    const pending = join(directory, '.' + id + '-' + randomUUID() + '.tmp');
    try {
      await writeFile(pending, sealed, { mode: 0o600 });
      await rename(pending, pathFor(id));
      values.set(id, next);
    } finally { await rm(pending, { force: true }); }
  }

  return {
    async get(id) {
      await writes.get(id);
      return read(id);
    },
    update(id, change) {
      const job = (writes.get(id) || Promise.resolve()).then(async () => {
        const previous = await read(id);
        const next = await change(previous);
        if (previous !== next) await write(id, next);
        return next;
      });
      const tail = job.catch(() => {});
      writes.set(id, tail);
      return job.finally(() => { if (writes.get(id) === tail) writes.delete(id); });
    },
  };
}
