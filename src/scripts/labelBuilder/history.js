// ╭──────────────────────────╮
// │  history.js              │
// │  Builder undo/redo       │
// │  snapshots using the     │
// │  builder document model  │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('history', ctx => {
    const { constants, state } = ctx;

    const getSelectedObjectIndex = () => {
      const activeObject = ctx.ensureCanvas().getActiveObject();

      if (!activeObject || activeObject instanceof window.fabric.ActiveSelection) {
        return -1;
      }

      return ctx.ensureCanvas().getObjects().indexOf(activeObject);
    };

    const buildHistoryEntry = () => ({
      selectionIndex: getSelectedObjectIndex(),
      document: ctx.serializeCanvasToDocument(ctx.ensureCanvas(), state, {
        includeThumbnail: false,
        includeTimestamps: false,
      }),
    });

    const getHistoryFingerprint = entry => JSON.stringify({
      canvas: entry.document.canvas,
      builderState: entry.document.builderState,
      objects: entry.document.objects,
    });

    const clearHistoryFuture = () => {
      state.historyFuture = [];
    };

    const syncHistoryUi = () => {
      ctx.syncHistoryButtons?.();
    };

    const canUndoHistory = () => state.historyPast.length > 1 && !state.isRestoringHistory;
    const canRedoHistory = () => state.historyFuture.length > 0 && !state.isRestoringHistory;

    const clearStrayTextboxFocus = () => {
      const activeTextbox = ctx.getEditableTextObject?.();
      const activeElement = document.activeElement;
      const isFabricHiddenTextarea = activeElement instanceof window.HTMLTextAreaElement
        && Boolean(
          activeTextbox?.hiddenTextarea === activeElement
          || activeElement.getAttribute('data-fabric-hiddentextarea') !== null
        );

      if (isFabricHiddenTextarea && !activeTextbox?.isEditing) {
        activeElement.blur();
      }
    };

    const restoreHistoryEntry = async entry => {
      if (!entry?.document) {
        return false;
      }

      state.isRestoringHistory = true;

      try {
        ctx.clearEnterPrintPrompt();
        await ctx.stopSerialPreview();
        await ctx.stopMonochromePreview();
        syncHistoryUi();
        await ctx.withCanvasTransitionMask(async () => {
          await ctx.hydrateCanvasFromDocument(entry.document, ctx, {
            selectionIndex: entry.selectionIndex,
            skipHistoryReset: true,
          });
        });
      } finally {
        state.isRestoringHistory = false;
        clearStrayTextboxFocus();
        syncHistoryUi();
      }

      return true;
    };

    const recordHistoryCheckpoint = async (options = {}) => {
      if (!state.currentPrinter || state.isRestoringHistory || state.isSerialPreviewActive || state.isMonochromePreviewActive) {
        return false;
      }

      const entry = buildHistoryEntry();
      const fingerprint = getHistoryFingerprint(entry);
      const latestEntry = state.historyPast[state.historyPast.length - 1];

      if (!options.force && latestEntry && latestEntry.fingerprint === fingerprint) {
        return false;
      }

      state.historyPast = [
        ...state.historyPast,
        {
          ...entry,
          fingerprint,
        },
      ].slice(-constants.BUILDER_HISTORY_LIMIT);
      clearHistoryFuture();
      syncHistoryUi();
      return true;
    };

    const resetHistory = async () => {
      state.historyPast = [];
      clearHistoryFuture();
      await recordHistoryCheckpoint({ force: true });
      syncHistoryUi();
    };

    const undoHistory = async () => {
      if (!canUndoHistory()) {
        return false;
      }

      const currentEntry = state.historyPast[state.historyPast.length - 1];
      const previousEntry = state.historyPast[state.historyPast.length - 2];

      state.historyPast = state.historyPast.slice(0, -1);
      state.historyFuture = [...state.historyFuture, currentEntry];
      syncHistoryUi();
      return restoreHistoryEntry(previousEntry);
    };

    const redoHistory = async () => {
      if (!canRedoHistory()) {
        return false;
      }

      const nextEntry = state.historyFuture[state.historyFuture.length - 1];
      state.historyFuture = state.historyFuture.slice(0, -1);
      state.historyPast = [...state.historyPast, nextEntry].slice(-constants.BUILDER_HISTORY_LIMIT);
      syncHistoryUi();
      return restoreHistoryEntry(nextEntry);
    };

    return {
      canRedoHistory,
      canUndoHistory,
      recordHistoryCheckpoint,
      redoHistory,
      resetHistory,
      undoHistory,
    };
  });
}());
