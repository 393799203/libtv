// Resolve Vite's @/ alias while using Node's native TypeScript test support.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidate;
    if (specifier.startsWith('@/')) candidate = path.join(sourceRoot, specifier.slice(2));
    else if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
      candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (candidate) {
      for (const extension of ['', '.ts', '.tsx', '/index.ts']) {
        if (existsSync(candidate + extension) && path.extname(candidate + extension)) {
          return nextResolve(pathToFileURL(candidate + extension).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
