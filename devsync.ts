#!/usr/bin/env tsx
import { run } from './src/cli.js';
import { cleanupMux } from './src/ssh.js';
import { logDetail, getLogFilePath } from './src/log.js';

process.on('exit', cleanupMux);

run(process.argv.slice(2)).catch((err) => {
  console.error(err);
  logDetail('fatal', err instanceof Error ? (err.stack ?? err.message) : String(err));
  const logPath = getLogFilePath();
  if (logPath) console.error(`\nLog: ${logPath}`);
  process.exit(1);
});
