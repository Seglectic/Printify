// ╭────────────────────────────╮
// │  Label Builder Model Tests │
// │  Locks down text geometry  │
// │  and template migrations.  │
// ╰────────────────────────────╯
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  getVerticalTextOffset,
  isTextFrameOverflowing,
  normalizeTextFrameSize,
  normalizeVerticalAlign,
} from '../src/scripts/labelBuilder/model/textFrame.mjs';
import {
  CURRENT_TEMPLATE_SCHEMA_VERSION,
  migrateTemplateDocument,
} from '../src/scripts/labelBuilder/model/templateSchema.mjs';
import {
  getAutoGrowingTextFrameWidth,
  getTapeLengthFromDrag,
} from '../src/scripts/labelBuilder/model/tapeGeometry.mjs';

const require = createRequire(import.meta.url);
const { createLabelTemplateStore } = require('../lib/labelTemplateStore');

test('text frame dimensions and vertical offsets stay deterministic', () => {
  assert.deepEqual(normalizeTextFrameSize({ width: 10, height: 12 }), { width: 56, height: 32 });
  assert.equal(getVerticalTextOffset({ alignment: 'top', contentHeight: 20, frameHeight: 80 }), 0);
  assert.equal(getVerticalTextOffset({ alignment: 'middle', contentHeight: 20, frameHeight: 80 }), 30);
  assert.equal(getVerticalTextOffset({ alignment: 'bottom', contentHeight: 20, frameHeight: 80 }), 60);
  assert.equal(normalizeVerticalAlign('sideways'), 'middle');
});

test('overflow detection accounts for the editable frame padding', () => {
  assert.equal(isTextFrameOverflowing({ contentHeight: 60, frameHeight: 80, padding: 10 }), false);
  assert.equal(isTextFrameOverflowing({ contentHeight: 61, frameHeight: 80, padding: 10 }), true);
});

test('tape drag and text growth respect physical scale and minimums', () => {
  assert.equal(getTapeLengthFromDrag({
    startLengthMm: 60,
    deltaClientPx: 135,
    viewportScale: 1,
    density: 135,
  }), 85);
  assert.equal(getTapeLengthFromDrag({
    startLengthMm: 60,
    deltaClientPx: 40,
    viewportScale: 1,
    density: 135,
    resizeFromCenter: true,
  }), 75);
  assert.equal(getTapeLengthFromDrag({
    startLengthMm: 10,
    deltaClientPx: -500,
    viewportScale: 1,
    density: 135,
  }), 8);
  assert.equal(getAutoGrowingTextFrameWidth({
    naturalTextWidth: 180.2,
    padding: 10,
    minimumFrameWidth: 120,
  }), 201);
});

test('schema 1.0 text keeps its previous top alignment during migration', () => {
  const migrated = migrateTemplateDocument({
    schemaVersion: '1.0',
    objects: [{ type: 'text', text: 'Legacy' }, { type: 'image', sourceUrl: 'data:image/png;base64,AA==' }],
  });

  assert.equal(migrated.schemaVersion, CURRENT_TEMPLATE_SCHEMA_VERSION);
  assert.equal(migrated.objects[0].verticalAlign, 'top');
  assert.equal(migrated.objects[1].sourceUrl, 'data:image/png;base64,AA==');
});

test('schema 1.1 round trips supported vertical alignment', () => {
  const source = {
    schemaVersion: '1.1',
    objects: [{ type: 'text', text: 'Current', verticalAlign: 'bottom' }],
  };

  assert.deepEqual(migrateTemplateDocument(source), source);
  assert.throws(
    () => migrateTemplateDocument({ schemaVersion: '9.0', objects: [] }),
    /not supported/
  );
});

test('remote template storage advertises schema 1.1', () => {
  const templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printify-label-templates-'));

  try {
    const store = createLabelTemplateStore({ templatesDir });
    const result = store.saveTemplate({
      name: 'Model Test',
      document: {
        schemaVersion: '1.1',
        objects: [{ type: 'text', verticalAlign: 'middle' }],
      },
    });
    const loaded = store.loadTemplate(result.template.path);

    assert.equal(loaded.schemaVersion, '1.1');
    assert.equal(loaded.document.schemaVersion, '1.1');
  } finally {
    fs.rmSync(templatesDir, { recursive: true, force: true });
  }
});
