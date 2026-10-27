import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['backend/server.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: '3000' } }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.config.mjs'], { stdio: 'inherit' })];
const stop = () => children.forEach(child => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach(child => child.on('exit', code => { stop(); process.exitCode = code || 0; }));
