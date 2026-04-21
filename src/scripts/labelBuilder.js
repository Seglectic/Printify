// ╭──────────────────────────╮
// │  labelBuilder.js         │
// │  Builder composition     │
// │  root that assembles the │
// │  ordered plain scripts   │
// ╰──────────────────────────╯
(function () {
  function createPrintifyLabelBuilder(options) {
    const namespace = window.PrintifyLabelBuilder;
    const settings = Object.assign({}, namespace.dom.defaultSettings, options || {});
    const refs = namespace.dom.createBuilderRefs(settings);

    if (!refs.root || !window.fabric) {
      return null;
    }

    const ctx = {
      constants: namespace.constants,
      dom: namespace.dom,
      refs,
      settings,
      state: namespace.state.createBuilderState(),
      utils: namespace.utils,
    };

    // Script load order stays explicit because this part of the app still uses
    // classic browser scripts rather than ES modules.
    const moduleOrder = [
      'canvasRuntime',
      'textboxObjects',
      'codeObjects',
      'mediaObjects',
      'controls',
      'preview',
      'export',
      'templates',
      'history',
      'session',
      'snapping',
      'events',
    ];

    moduleOrder.forEach(moduleName => {
      const factory = namespace.modules[moduleName];
      if (typeof factory === 'function') {
        Object.assign(ctx, factory(ctx) || {});
      }
    });

    ctx.bindCanvasEvents();
    ctx.bindControlInputs();
    ctx.bindTemplateEvents();
    ctx.bindSnappingEvents();
    ctx.bindDomEvents();
    ctx.syncPreviewButton();
    ctx.syncHistoryButtons();

    return {
      open: ctx.open,
      close: ctx.close,
    };
  }

  window.createPrintifyLabelBuilder = createPrintifyLabelBuilder;
}());
