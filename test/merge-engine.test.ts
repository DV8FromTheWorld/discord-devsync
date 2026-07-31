import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// See test/merge-kb.test.ts — HOME must be redirected before the module graph loads.
const fakeHome = mkdtempSync(resolve(tmpdir(), 'devsync-merge-engine-'));
const dataDir = resolve(fakeHome, 'data');
mkdirSync(resolve(fakeHome, '.config', 'devsync'), { recursive: true });
mkdirSync(dataDir, { recursive: true });
writeFileSync(resolve(fakeHome, '.config', 'devsync', 'data-dir'), dataDir);
process.env.HOME = fakeHome;

// The engine shells out to the `claude` CLI for multi-way conflicts. Shadow it with a stub
// that always fails, so these tests can never reach the real Claude: any case that routes
// to a Claude merge shows up as a recorded conflict instead of a live API call. The rest of
// PATH stays intact because the diff generation needs `diff`.
const stubBin = resolve(fakeHome, 'bin');
mkdirSync(stubBin, { recursive: true });
writeFileSync(resolve(stubBin, 'claude'), '#!/bin/sh\necho "stub claude: refusing" >&2\nexit 1\n');
chmodSync(resolve(stubBin, 'claude'), 0o755);
process.env.PATH = `${stubBin}:${process.env.PATH ?? ''}`;

const { REMOTES_DIR, MERGED_DIR } = await import('../src/config.js');
const { mergeItems, fileMergeOps } = await import('../src/sync/merge-engine.js');
const { loadConflicts } = await import('../src/sync/changes.js');

const FILE = 'notes.md';
const mergedPath = () => resolve(MERGED_DIR, FILE);

const NOW = Math.floor(Date.now() / 1000);
const ONE_HOUR_AGO = NOW - 3600;
const TWO_HOURS_AGO = NOW - 7200;

function writeWithMtime(path: string, contents: string, mtimeSeconds: number): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
  utimesSync(path, mtimeSeconds, mtimeSeconds);
}

function writeMerged(contents: string, mtimeSeconds: number): void {
  writeWithMtime(mergedPath(), contents, mtimeSeconds);
}

function writeRemote(host: string, contents: string, mtimeSeconds: number): string {
  const path = resolve(REMOTES_DIR, host, FILE);
  writeWithMtime(path, contents, mtimeSeconds);
  return path;
}

function runMerge(remotePaths: string[]) {
  return mergeItems(
    [{ name: FILE, mergedPath: mergedPath(), remotePaths, conflictKey: `test:${FILE}` }],
    {
      label: 'test',
      ops: fileMergeOps,
      allowedTools: 'Read,Write',
      onClaudeFail: 'conflict',
      buildPrompt: () => 'unused — claude is unreachable in tests',
    },
  );
}

beforeEach(() => {
  rmSync(REMOTES_DIR, { recursive: true, force: true });
  rmSync(MERGED_DIR, { recursive: true, force: true });
  mkdirSync(REMOTES_DIR, { recursive: true });
  mkdirSync(MERGED_DIR, { recursive: true });
});

after(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

test('copies the sole updated remote', async () => {
  writeMerged('base\n', TWO_HOURS_AGO);
  const remote = writeRemote('hostA', 'edited by A\n', NOW);

  const change = await runMerge([remote]);

  assert.equal(readFileSync(mergedPath(), 'utf-8'), 'edited by A\n');
  assert.equal(change?.files?.[0]?.type, '~');
});

test('ignores a remote that is newer but byte-identical to merged', async () => {
  writeMerged('base\n', TWO_HOURS_AGO);
  // Same content, newer mtime — the shape rsync leaves behind after a re-fetch.
  const remote = writeRemote('hostA', 'base\n', NOW);

  const change = await runMerge([remote]);

  assert.equal(change, null);
  assert.equal(readFileSync(mergedPath(), 'utf-8'), 'base\n');
});

test('treats one real edit alongside an identical-but-newer remote as a plain copy', async () => {
  // The regression: workspace2 was byte-identical to merged with an mtime 4s newer, and
  // alpha held the only real edit. Counting workspace2 as a competing version turned a
  // straight copy into a two-way Claude merge — which then failed and killed the sync.
  writeMerged('base\n', TWO_HOURS_AGO);
  const identicalButNewer = writeRemote('workspace2', 'base\n', ONE_HOUR_AGO);
  const genuinelyEdited = writeRemote('alpha', 'base\nreal edit from alpha\n', NOW);

  const change = await runMerge([identicalButNewer, genuinelyEdited]);

  assert.equal(readFileSync(mergedPath(), 'utf-8'), 'base\nreal edit from alpha\n');
  assert.equal(change?.files?.[0]?.type, '~');
  // No Claude call was attempted, so nothing should have been recorded as a conflict.
  assert.deepEqual(loadConflicts(), []);
  assert.equal(change?.files?.[0]?.conflict, undefined);
});

test('skips entirely when every newer remote matches merged', async () => {
  writeMerged('base\n', TWO_HOURS_AGO);
  const a = writeRemote('hostA', 'base\n', ONE_HOUR_AGO);
  const b = writeRemote('hostB', 'base\n', NOW);

  const change = await runMerge([a, b]);

  assert.equal(change, null);
  assert.deepEqual(loadConflicts(), []);
});

test('still routes genuinely divergent hosts to a Claude merge', async () => {
  // Guards against the identical-content filter over-reaching: two hosts with different
  // real edits must still reach the Claude path. The stub always fails, so a recorded
  // conflict is the observable proof the merge was attempted.
  writeMerged('base\n', TWO_HOURS_AGO);
  const a = writeRemote('hostA', 'base\nedit from A\n', ONE_HOUR_AGO);
  const b = writeRemote('hostB', 'base\nedit from B\n', NOW);

  const change = await runMerge([a, b]);

  assert.equal(change?.files?.[0]?.conflict, true);
  const conflicts = loadConflicts();
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].hosts.sort(), ['hostA', 'hostB']);
  // merged/ must be left untouched when the merge could not be completed.
  assert.equal(readFileSync(mergedPath(), 'utf-8'), 'base\n');
});

test('copies when several hosts made the same edit', async () => {
  writeMerged('base\n', TWO_HOURS_AGO);
  const a = writeRemote('hostA', 'base\nsame edit\n', ONE_HOUR_AGO);
  const b = writeRemote('hostB', 'base\nsame edit\n', NOW);

  const change = await runMerge([a, b]);

  assert.equal(readFileSync(mergedPath(), 'utf-8'), 'base\nsame edit\n');
  assert.equal(change?.files?.[0]?.conflict, undefined);
  assert.deepEqual(loadConflicts(), []);
});

test('creates merged from a remote when no merged version exists', async () => {
  const remote = writeRemote('hostA', 'brand new\n', NOW);

  const change = await runMerge([remote]);

  assert.equal(existsSync(mergedPath()), true);
  assert.equal(readFileSync(mergedPath(), 'utf-8'), 'brand new\n');
  assert.equal(change?.files?.[0]?.type, '+');
});

test('ignores remotes older than merged', async () => {
  writeMerged('newer base\n', NOW);
  const remote = writeRemote('hostA', 'stale content\n', TWO_HOURS_AGO);

  const change = await runMerge([remote]);

  assert.equal(change, null);
  assert.equal(readFileSync(mergedPath(), 'utf-8'), 'newer base\n');
});
