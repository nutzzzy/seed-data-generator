import { execFile } from 'node:child_process';

const cache = new Map<string, Promise<string[] | null>>();

/**
 * Finds a Python 3.8+ interpreter for the relay helper. Each candidate is a fixed command (e.g. ["py", "-3"]);
 * nothing comes from user input. `-I` (isolated mode) keeps the environment and current folder out of the helper.
 */
export function findPython(candidates: (string | string[])[]): Promise<string[] | null> {
  const key = JSON.stringify(candidates);
  let found = cache.get(key);
  if (!found) {
    found = (async () => {
      for (const c of candidates) {
        const [bin, ...args] = Array.isArray(c) ? c : [c];
        const ok = await new Promise<boolean>((resolve) => {
          execFile(bin, [...args, '-I', '-c', 'import sys; print(sys.version_info >= (3, 8))'], { timeout: 5000 }, (err, stdout) =>
            resolve(!err && stdout.trim() === 'True'),
          );
        });
        if (ok) return [bin, ...args, '-I'];
      }
      return null;
    })();
    cache.set(key, found);
  }
  return found;
}
