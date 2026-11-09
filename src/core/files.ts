import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function checkFileSize(bytes: number): void {
  if (bytes > MAX_FILE_BYTES) throw new Error('Il file supera il limite di 10 MB.');
}

export async function optionalRead(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Il percorso non indica un file regolare.');
    checkFileSize(info.size);
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    return join(await realpath(dirname(absolute)), basename(absolute));
  }
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

// A common lock coordinates the CLI and desktop, including symlink aliases.
export async function withFileLock<T>(file: string, work: (path: string) => Promise<T>): Promise<T> {
  const path = await canonicalPath(file);
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(path, {
      realpath: false, lockfilePath: `${path}.kcm-lock`, stale: 10000, update: 3000,
      retries: { retries: 60, minTimeout: 100, maxTimeout: 100, factor: 1 },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new Error('Kubeconfig occupato da un’altra operazione. Riprova tra qualche secondo.');
    throw error;
  }
  try {
    return await work(path);
  } finally { await release(); }
}
