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
  if (v) _level = 'debug';
}

export function isVerbose(): boolean {
  return _level === 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[_level];
}

export function debug(msg: string): void {
  if (shouldLog('debug')) {
    console.error(`${DIM}${msg}${RESET}`);
  }
}

export function info(msg: string): void {
  if (shouldLog('info')) {
    console.log(msg);
  }
}

export function success(msg: string): void {
  if (shouldLog('info')) {
    console.log(`${GREEN}${msg}${RESET}`);
  }
}

export function warn(msg: string): void {
  if (shouldLog('warn')) {
    console.log(`${YELLOW}${msg}${RESET}`);
  }
}

export function error(msg: string): void {
  console.error(`${RED}${msg}${RESET}`);
}
