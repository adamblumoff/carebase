#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const VALID_ENVS = ['development', 'production'];

const modeArg = process.argv[2] || 'development';
if (!VALID_ENVS.includes(modeArg)) {
  console.error(`Usage: node scripts/run-backend.js <${VALID_ENVS.join('|')}>`);
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendDev = spawn('npm', ['run', 'dev', '--workspace=backend'], {
  cwd: dirname(scriptDir),
  env: { ...process.env, CAREBASE_ENV: modeArg },
  stdio: 'inherit'
});

backendDev.on('exit', (code) => {
  process.exit(code ?? 0);
});
