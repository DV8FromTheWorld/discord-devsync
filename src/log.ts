import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';

import { DATA_DIR } from './config.js';
import { hasText } from './text.js';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let _level: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  _level = level;
}

export function setVerbose(v: boolean): void {
  if (v) {
    _level = 'debug';
  }
}

export function isVerbose(): boolean {
  return _level === 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[_level];
}

// ─── File log ───────────────────────────────────────────────────
//
// The console honours _level, but the file always records everything at debug detail.
// A sync that fails halfway is exactly when the verbose trail is wanted, and by then it
// is too late to re-run with --verbose: the remotes have already been overwritten by the
// next pull. Writes are appended synchronously so a hard exit still leaves a usable file.

const LOGS_DIR = resolve(DATA_DIR, 'logs');
const MAX_LOG_FILES = 20;
// eslint-disable-next-line no-control-regex -- \x1b is the ANSI escape we are stripping
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

let logFilePath: string | null = null;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

function appendToLog(text: string): void {
  if (!hasText(logFilePath)) {
    return;
  }
  try {
    appendFileSync(logFilePath, text);
  } catch {
    // Logging must never be the reason a command fails.
    logFilePath = null;
  }
}

function record(level: LogLevel, msg: string): void {
  appendToLog(`${new Date().toISOString()}  ${level.padEnd(5)}  ${stripAnsi(msg)}\n`);
}

/** Delete the oldest log files, keeping the most recent MAX_LOG_FILES. */
function pruneOldLogs(): void {
  try {
    const logs = readdirSync(LOGS_DIR)
      .filter((name) => name.endsWith('.log'))
      .sort(); // ISO-8601 prefixes sort chronologically
    for (const stale of logs.slice(0, Math.max(0, logs.length - MAX_LOG_FILES))) {
      unlinkSync(resolve(LOGS_DIR, stale));
    }
  } catch {
    /* pruning is best-effort */
  }
}

/**
 * Open a log file for this run. Returns the path, or null if it could not be created.
 * Safe to call more than once; the first call wins.
 */
export function initFileLog(commandLine: string): string | null {
  if (hasText(logFilePath)) {
    return logFilePath;
  }
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = commandLine
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    logFilePath = resolve(LOGS_DIR, `${stamp}${hasText(slug) ? `-${slug}` : ''}.log`);
    appendToLog(
      `# devsync ${commandLine}\n# started ${new Date().toISOString()}\n# pid ${process.pid}\n\n`
    );
    pruneOldLogs();
    return logFilePath;
  } catch {
    logFilePath = null;
    return null;
  }
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

/**
 * Record detail that is too noisy for the console — subprocess output, prompts, stack
 * traces. Never printed; only ever written to the log file.
 */
export function logDetail(label: string, detail: string): void {
  if (!hasText(logFilePath) || !hasText(detail)) {
    return;
  }
  const indented = stripAnsi(detail)
    .trimEnd()
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  appendToLog(`${new Date().toISOString()}  detail ${label}\n${indented}\n`);
}

export function debug(msg: string): void {
  record('debug', msg);
  if (shouldLog('debug')) {
    console.error(`${DIM}${msg}${RESET}`);
  }
}

export function info(msg: string): void {
  record('info', msg);
  if (shouldLog('info')) {
    console.log(msg);
  }
}

export function success(msg: string): void {
  record('info', msg);
  if (shouldLog('info')) {
    console.log(`${GREEN}${msg}${RESET}`);
  }
}

export function warn(msg: string): void {
  record('warn', msg);
  if (shouldLog('warn')) {
    console.log(`${YELLOW}${msg}${RESET}`);
  }
}

export function error(msg: string): void {
  record('error', msg);
  console.error(`${RED}${msg}${RESET}`);
}
