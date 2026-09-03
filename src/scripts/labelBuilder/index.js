// ╭────────────────────────────╮
// │  Label Builder Entry       │
// │  Composes the editor from  │
// │  explicit feature modules. │
// ╰────────────────────────────╯
import { constants } from './constants.js';
import { createBuilderRefs, defaultSettings } from './dom.js';
import { createBuilderState } from './state.js';
import { utils } from './utils.js';
import createCanvasRuntime from './canvasRuntime.js';
import createTextboxObjects from './objects/textbox.js';
import createCodeObjects from './objects/code.js';
import createMediaObjects from './objects/media.js';
import createControls from './controls.js';
import createPreview from './preview.js';
import createExport from './export.js';
import createTemplates from './templates.js';
import createHistory from './history.js';
import createSession from './session.js';
import createSnapping from './snapping.js';
import createTapeResize from './tapeResize.js';
import createEvents from './events.js';

const moduleFactories = [
  createCanvasRuntime,
  createTextboxObjects,
  createCodeObjects,
  createMediaObjects,
  createControls,
  createPreview,
  createExport,
  createTemplates,
  createHistory,
  createSession,
  createSnapping,
  createTapeResize,
  createEvents,
];

export const createPrintifyLabelBuilder = (options = {}) => {
  const settings = Object.assign({}, defaultSettings, options);
  const refs = createBuilderRefs(settings);

  if (!refs.root || !window.fabric) {
    return null;
  }

  const ctx = {
    constants,
    fabric: window.fabric,
    refs,
    settings,
    state: createBuilderState(),
    utils,
  };

  moduleFactories.forEach(factory => {
    Object.assign(ctx, factory(ctx) || {});
  });

  // Feature factories may extend the composition context only during boot.
  // Runtime state remains mutable inside ctx.state, but service contracts do not.
  Object.freeze(ctx);

  ctx.bindCanvasEvents();
  ctx.bindControlInputs();
  ctx.bindTemplateEvents();
  ctx.bindSnappingEvents();
  ctx.bindTapeResizeEvents();
  ctx.bindDomEvents();
  ctx.syncPreviewButton();
  ctx.syncHistoryButtons();

  return {
    close: ctx.close,
    open: ctx.open,
  };
};
