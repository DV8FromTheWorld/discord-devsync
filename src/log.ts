const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function fmt(color: string, prefix: string, msg: string, tag?: string): string {
  const tagStr = tag ? `${DIM}[${tag}]${RESET} ` : '';
  return `${color}${prefix}${RESET} ${tagStr}${msg}`;
}

export function info(msg: string, tag?: string): void {
  console.log(fmt(CYAN, 'INFO', msg, tag));
}

export function success(msg: string, tag?: string): void {
  console.log(fmt(GREEN, ' OK ', msg, tag));
}

export function warn(msg: string, tag?: string): void {
  console.log(fmt(YELLOW, 'WARN', msg, tag));
}

export function error(msg: string, tag?: string): void {
  console.error(fmt(RED, 'ERR ', msg, tag));
}
