import ora from 'ora';
import type { ResolvedHost } from '../config.js';

export interface HostResult {
  host: string;
  succeeded: string[];
  errors: string[];
  unreachable: boolean;
}

export async function timed<T>(
  _label: string,
  fn: () => Promise<T>,
): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

export type HostOperation = (host: ResolvedHost) => Promise<HostResult>;

function printResult(r: HostResult): void {
  if (r.unreachable) {
    ora({ prefixText: '  ' }).fail(`${r.host} — unreachable`);
    return;
  }

  if (r.errors.length === 0) {
    ora({ prefixText: '  ' }).succeed(`${r.host} — ${r.succeeded.join(', ')}`);
  } else if (r.succeeded.length > 0) {
    ora({ prefixText: '  ' }).warn(r.host);
    console.log(`      \x1b[32m✔\x1b[0m ${r.succeeded.join(', ')}`);
    for (const err of r.errors) {
      console.log(`      \x1b[31m✖\x1b[0m ${err}`);
    }
  } else {
    ora({ prefixText: '  ' }).fail(r.host);
    for (const err of r.errors) {
      console.log(`      \x1b[31m✖\x1b[0m ${err}`);
    }
  }
}

export async function runParallel(
  label: string,
  hosts: ResolvedHost[],
  operation: HostOperation,
): Promise<HostResult[]> {
  if (hosts.length === 0) {
    console.log('No hosts configured.');
    return [];
  }

  console.log(`${label}:`);

  const total = hosts.length;
  let completed = 0;
  let errorCount = 0;

  const spinner = ora({ prefixText: '  ' });

  function updateSpinner(): void {
    const errStr = errorCount > 0 ? `, ${errorCount} with errors` : '';
    spinner.text = `${completed}/${total} complete${errStr}`;
  }

  updateSpinner();
  spinner.start();

  const results: HostResult[] = [];
  await Promise.all(
    hosts.map(async (host) => {
      const result = await operation(host);
      completed++;
      if (result.errors.length > 0) errorCount++;
      results.push(result);
      updateSpinner();
    }),
  );

  spinner.stop();

  // Print in original host order
  const ordered = hosts.map((h) => results.find((r) => r.host === h.name)!);
  for (const result of ordered) {
    printResult(result);
  }

  const succeeded = ordered.filter((r) => r.errors.length === 0).length;
  const partial = ordered.filter(
    (r) => !r.unreachable && r.errors.length > 0 && r.succeeded.length > 0,
  ).length;
  const failed = ordered.filter(
    (r) => r.unreachable || (r.succeeded.length === 0 && r.errors.length > 0),
  ).length;

  console.log();
  const summary = [
    `${succeeded} ok`,
    partial > 0 ? `${partial} partial` : '',
    failed > 0 ? `${failed} failed` : '',
  ]
    .filter(Boolean)
    .join(', ');
  ora({ prefixText: '  ' }).succeed(`${label} complete (${summary})`.replace(/^\n/, ''));

  return ordered;
}
