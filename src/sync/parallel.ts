import ora from 'ora';
import type { ResolvedHost } from '../config.js';

export async function timed<T>(
  _label: string,
  fn: () => Promise<T>,
): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

export async function runParallel<T extends { host: string; unreachable: boolean }>(
  label: string,
  hosts: ResolvedHost[],
  operation: (host: ResolvedHost) => Promise<T>,
  printResult: (result: T) => void,
): Promise<T[]> {
  if (hosts.length === 0) {
    console.log('No hosts configured.');
    return [];
  }

  console.log(`${label}:`);

  const total = hosts.length;
  let completed = 0;

  const spinner = ora({ prefixText: '  ' });

  function updateSpinner(): void {
    spinner.text = `${completed}/${total} complete`;
  }

  updateSpinner();
  spinner.start();

  const results: T[] = [];
  await Promise.all(
    hosts.map(async (host) => {
      const result = await operation(host);
      completed++;
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

  const ok = ordered.filter((r) => !r.unreachable).length;
  const failed = ordered.filter((r) => r.unreachable).length;

  console.log();
  const summary = [`${ok} ok`, failed > 0 ? `${failed} failed` : ''].filter(Boolean).join(', ');
  ora({ prefixText: '  ' }).succeed(`${label} complete (${summary})`.replace(/^\n/, ''));

  return ordered;
}
