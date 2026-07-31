import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  readFileSync,
  statSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// config.ts resolves DATA_DIR from $HOME the moment its module graph loads, so HOME has
// to point at a throwaway directory before the dynamic imports below — a static import
// would be hoisted above this setup and pick up the real data dir.
const fakeHome = mkdtempSync(resolve(tmpdir(), 'devsync-merge-kb-'));
const dataDir = resolve(fakeHome, 'data');
mkdirSync(resolve(fakeHome, '.config', 'devsync'), { recursive: true });
mkdirSync(dataDir, { recursive: true });
writeFileSync(resolve(fakeHome, '.config', 'devsync', 'data-dir'), dataDir);
process.env.HOME = fakeHome;

const { REMOTES_DIR, MERGED_DIR } = await import('../src/config.js');
const { mergeKbDirectories } = await import('../src/sync/merge-kb.js');

const mergedKb = resolve(MERGED_DIR, 'discord-kb');

// Every case below uses non-markdown files on purpose: markdown goes through the merge
// engine, which can shell out to Claude. The last-modified-wins path never does.
const PATCH = 'fix.patch';

// Fixed points on the clock, so "newer than the other host but older than the copy" is
// expressible — that gap is where the mtime regression used to hide.
const NOW = Math.floor(Date.now() / 1000);
const ONE_HOUR_AGO = NOW - 3600;
const TWO_HOURS_AGO = NOW - 7200;

function writeRemoteFile(host: string, name: string, contents: string, mtimeSeconds: number): void {
  const kbDir = resolve(REMOTES_DIR, host, 'discord-kb');
  mkdirSync(kbDir, { recursive: true });
  const path = resolve(kbDir, name);
  writeFileSync(path, contents);
  utimesSync(path, mtimeSeconds, mtimeSeconds);
}

function readMerged(name: string): string {
  return readFileSync(resolve(mergedKb, name), 'utf-8');
}

function mergedMtimeSeconds(name: string): number {
  return Math.floor(statSync(resolve(mergedKb, name)).mtimeMs / 1000);
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

test('copies a non-markdown file into merged', async () => {
  writeRemoteFile('hostA', PATCH, 'from A\n', TWO_HOURS_AGO);

  const change = await mergeKbDirectories();

  assert.equal(readMerged(PATCH), 'from A\n');
  assert.deepEqual(
    change?.files?.map((file) => ({ name: file.name, type: file.type })),
    [{ name: PATCH, type: '+' }],
  );
});

test('stamps the copy with the source mtime rather than the time of the copy', async () => {
  writeRemoteFile('hostA', PATCH, 'from A\n', TWO_HOURS_AGO);

  await mergeKbDirectories();

  // If this were the copy time it would be ~NOW, and every remote would look older than
  // merged forever after.
  assert.equal(mergedMtimeSeconds(PATCH), TWO_HOURS_AGO);
});

test('takes a newer version from another host even when its mtime predates the last copy', async () => {
  // The regression: hostA lands first, then hostB turns out to hold a newer version whose
  // mtime is still older than the moment hostA's copy was written. Comparing against the
  // copy time stranded hostB's content permanently.
  writeRemoteFile('hostA', PATCH, 'from A\n', TWO_HOURS_AGO);
  await mergeKbDirectories();

  writeRemoteFile('hostB', PATCH, 'from B\n', ONE_HOUR_AGO);
  const change = await mergeKbDirectories();

  assert.equal(readMerged(PATCH), 'from B\n');
  assert.equal(mergedMtimeSeconds(PATCH), ONE_HOUR_AGO);
  assert.deepEqual(
    change?.files?.map((file) => ({ name: file.name, type: file.type })),
    [{ name: PATCH, type: '~' }],
  );
});

test('picks the newest version when several hosts disagree', async () => {
  writeRemoteFile('hostA', PATCH, 'from A\n', TWO_HOURS_AGO);
  writeRemoteFile('hostB', PATCH, 'from B\n', NOW);
  writeRemoteFile('hostC', PATCH, 'from C\n', ONE_HOUR_AGO);

  await mergeKbDirectories();

  assert.equal(readMerged(PATCH), 'from B\n');
});

test('attributes the copy to the host it came from', async () => {
  writeRemoteFile('hostA', PATCH, 'from A\n', TWO_HOURS_AGO);
  writeRemoteFile('hostB', PATCH, 'from B\n', NOW);

  const change = await mergeKbDirectories();

  assert.equal(change?.files?.[0]?.note, 'from hostB');
});

test('reports nothing when a second run finds no changes', async () => {
  writeRemoteFile('hostA', PATCH, 'from A\n', TWO_HOURS_AGO);
  await mergeKbDirectories();

  const change = await mergeKbDirectories();

  assert.equal(change, null);
  assert.equal(readMerged(PATCH), 'from A\n');
});

test('excludes OS and editor junk files', async () => {
  writeRemoteFile('hostA', '.DS_Store', 'finder junk\n', NOW);
  writeRemoteFile('hostA', 'Thumbs.db', 'windows junk\n', NOW);
  writeRemoteFile('hostA', 'desktop.ini', 'windows junk\n', NOW);

  const change = await mergeKbDirectories();

  assert.equal(change, null);
  assert.equal(existsSync(resolve(mergedKb, '.DS_Store')), false);
  assert.equal(existsSync(resolve(mergedKb, 'Thumbs.db')), false);
  assert.equal(existsSync(resolve(mergedKb, 'desktop.ini')), false);
});

test('excludes junk nested in subdirectories', async () => {
  writeRemoteFile('hostA', PATCH, 'from A\n', TWO_HOURS_AGO);
  const nested = resolve(REMOTES_DIR, 'hostA', 'discord-kb', 'notes');
  mkdirSync(nested, { recursive: true });
  writeFileSync(resolve(nested, '.DS_Store'), 'finder junk\n');

  await mergeKbDirectories();

  assert.equal(existsSync(resolve(mergedKb, 'notes', '.DS_Store')), false);
});

test('skips the journal and curiosity directories', async () => {
  writeRemoteFile('hostA', PATCH, 'from A\n', TWO_HOURS_AGO);
  for (const dir of ['journal', 'curiosity']) {
    const path = resolve(REMOTES_DIR, 'hostA', 'discord-kb', dir);
    mkdirSync(path, { recursive: true });
    writeFileSync(resolve(path, 'entry.bin'), 'not merged\n');
  }

  await mergeKbDirectories();

  assert.equal(existsSync(resolve(mergedKb, 'journal', 'entry.bin')), false);
  assert.equal(existsSync(resolve(mergedKb, 'curiosity', 'entry.bin')), false);
});

test('preserves nested paths and byte-exact binary content', async () => {
  const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x7f]);
  const kbDir = resolve(REMOTES_DIR, 'hostA', 'discord-kb', 'assets');
  mkdirSync(kbDir, { recursive: true });
  writeFileSync(resolve(kbDir, 'diagram.png'), binary);
  utimesSync(resolve(kbDir, 'diagram.png'), TWO_HOURS_AGO, TWO_HOURS_AGO);

  await mergeKbDirectories();

  const copied = readFileSync(resolve(mergedKb, 'assets', 'diagram.png'));
  assert.deepEqual(copied, binary);
});
