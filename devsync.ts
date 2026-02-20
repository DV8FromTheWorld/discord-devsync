#!/usr/bin/env tsx
import { run } from './src/cli.js';
import { cleanupMux } from './src/ssh.js';

process.on('exit', cleanupMux);

run(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
