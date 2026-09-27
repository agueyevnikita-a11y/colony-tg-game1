import { loadEnvFile } from 'node:process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Match Next.js file precedence; variables supplied by the host always win.
export function loadProjectEnv(directory = fileURLToPath(new URL('../', import.meta.url))) {
  const mode = process.env.NODE_ENV || 'development';
  const files = [
    `.env.${mode}.local`,
    ...(mode === 'test' ? [] : ['.env.local']),
    `.env.${mode}`,
    '.env',
  ];
  for (const file of files) {
    try {
      loadEnvFile(join(directory, file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

loadProjectEnv();
