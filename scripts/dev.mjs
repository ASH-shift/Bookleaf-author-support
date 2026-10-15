// Runs the API server and the Vite dev server side by side for local development.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  spawn(npm, ['run', 'dev', '--workspace', 'server'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(npm, ['run', 'dev', '--workspace', 'client'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];

const shutdown = () => procs.forEach((p) => p.kill());
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
procs.forEach((p) => p.on('exit', (code) => { if (code) shutdown(); }));
