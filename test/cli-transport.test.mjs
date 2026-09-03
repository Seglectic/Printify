// ╭────────────────────────────╮
// │  CLI Transport Tests       │
// │  Locks down constrained    │
// │  tape-driver arguments.    │
// ╰────────────────────────────╯
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildCliArgs,
  isPtouchPrintCommand,
  supportsNativeTapeCopies,
} = require('../lib/cliTransport');

const makeTapePrinter = overrides => ({
  displayName: 'Tape test',
  printMode: 'cli',
  cliCommand: 'ptouch-print',
  cliArgs: ['--image', '{file}', '--pad', '{lengthMm}'],
  output: 'png',
  size: 'tape',
  tapes: [24],
  defaultTape: 24,
  density: '135',
  acceptedKinds: ['image'],
  isTape: true,
  ...overrides,
});

test('precut is injected once for ptouch-print and placeholders still resolve', () => {
  const args = buildCliArgs('/tmp/label.png', makeTapePrinter(), {
    tapeWidthMm: 24,
    lengthMm: 60,
  });

  assert.deepEqual(args, ['--precut', '--image', '/tmp/label.png', '--pad', '60']);
  assert.equal(isPtouchPrintCommand('/usr/bin/ptouch-print'), true);
  assert.equal(isPtouchPrintCommand('C:\\Tools\\ptouch-print.exe'), true);
});

test('explicit precut arguments are not duplicated', () => {
  const args = buildCliArgs('/tmp/label.png', makeTapePrinter({
    cliArgs: ['--precut', '--image', '{file}'],
  }));

  assert.deepEqual(args, ['--precut', '--image', '/tmp/label.png']);
});

test('precut is not injected for non-tape or unrelated CLI printers', () => {
  assert.deepEqual(
    buildCliArgs('/tmp/label.png', makeTapePrinter({ isTape: false })),
    ['--image', '/tmp/label.png', '--pad', '']
  );
  assert.deepEqual(
    buildCliArgs('/tmp/label.png', makeTapePrinter({ cliCommand: 'some-other-command' })),
    ['--image', '/tmp/label.png', '--pad', '']
  );
});

test('multiple P-Touch copies use the native chained-copy path with a final cut', () => {
  const printer = makeTapePrinter();
  const args = buildCliArgs('/tmp/label.png', printer, { cliCopies: 4 });

  assert.deepEqual(
    args,
    ['--copies', '4', '--precut', '--image', '/tmp/label.png', '--pad', '']
  );
  assert.equal(args.includes('--chain'), false);
  assert.equal(supportsNativeTapeCopies(printer), true);
  assert.equal(supportsNativeTapeCopies(makeTapePrinter({ isTape: false })), false);
});
