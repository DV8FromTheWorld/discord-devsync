#!/usr/bin/env tsx
import { run } from './src/cli.js';
import { getLogFilePath, logDetail } from './src/log.js';
import { cleanupMux } from './src/ssh.js';
import { hasText } from './src/text.js';

process.on('exit', cleanupMux);

try {
  await run(process.argv.slice(2));
} catch (err) {
  console.error(err);
  logDetail('fatal', err instanceof Error ? (err.stack ?? err.message) : String(err));
  const logPath = getLogFilePath();
  if (hasText(logPath)) {
    console.error(`\nLog: ${logPath}`);
  }
  process.exit(1);
}
