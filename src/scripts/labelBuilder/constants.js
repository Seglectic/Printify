// ╭──────────────────────────╮
// │  constants.js            │
// │  Shared builder defaults │
// │  and schema/version      │
// │  constants               │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {
    modules: {},
  };

  namespace.register = namespace.register || function registerLabelBuilderModule(moduleName, factory) {
    namespace.modules[moduleName] = factory;
  };

  namespace.constants = {
    DEFAULT_CANVAS_SIZE: {
      width: 425,
      height: 200,
    },
    DEFAULT_CODE_FALLBACK_LABEL: 'Printify',
    DEFAULT_TEXTBOX_PLACEHOLDER: 'Click to Edit',
    DEFAULT_SERIAL_DIGITS: 2,
    MAX_SERIAL_DIGITS: 12,
    DEFAULT_TAPE_LENGTH_MM: 60,
    MIN_TAPE_LENGTH_MM: 8,
    TAPE_EXPORT_PADDING_MM: 4,
    BUILDER_MODAL_CLOSE_MS: 220,
    BUILDER_HANDLE_BASE_SIZE: 12,
    BUILDER_HANDLE_TOUCH_SIZE: 22,
    BUILDER_ROTATION_SNAP_ANGLE: 45,
    BUILDER_ROTATION_SNAP_THRESHOLD: 8,
    TEMPLATE_SCHEMA_VERSION: '1.0',
    LOCAL_TEMPLATE_STORAGE_KEY: 'printify-label-builder-templates',
    BUILDER_HISTORY_LIMIT: 10,
    SNAP_THRESHOLD_PX: 8,
    SNAP_RELEASE_DISTANCE_PX: 15,
    SNAP_GUIDE_INSET_PX: 4,
    SNAP_GUIDE_COLOR: 'rgba(31, 111, 67, 0.78)',
  };
}());
