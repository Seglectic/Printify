// ╭──────────────────────────╮
// │  history.js              │
// │  Builder undo/redo       │
// │  snapshots using the     │
// │  builder document model  │
// ╰──────────────────────────╯
export default function createHistory(ctx) {
    const { constants, state } = ctx;

    const getSelectedObjectIndex = () => {
      const activeObject = ctx.ensureCanvas().getActiveObject();

      if (!activeObject || activeObject instanceof ctx.fabric.ActiveSelection) {
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
      window.clearTimeout(state.historyCheckpointTimer);
      state.historyCheckpointTimer = null;

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
      if (options.cancelPending !== false) {
        window.clearTimeout(state.historyCheckpointTimer);
        state.historyCheckpointTimer = null;
      }

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

    const queueHistoryCheckpoint = () => {
      window.clearTimeout(state.historyCheckpointTimer);
      state.historyCheckpointTimer = window.setTimeout(() => {
        state.historyCheckpointTimer = null;
        void recordHistoryCheckpoint({ cancelPending: false });
      }, constants.BUILDER_HISTORY_IDLE_MS);
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

      const restored = await restoreHistoryEntry(previousEntry);
      if (!restored) return false;

      state.historyPast = state.historyPast.slice(0, -1);
      state.historyFuture = [...state.historyFuture, currentEntry];
      syncHistoryUi();
      return true;
    };

    const redoHistory = async () => {
      if (!canRedoHistory()) {
        return false;
      }

      const nextEntry = state.historyFuture[state.historyFuture.length - 1];
      const restored = await restoreHistoryEntry(nextEntry);
      if (!restored) return false;

      state.historyFuture = state.historyFuture.slice(0, -1);
      state.historyPast = [...state.historyPast, nextEntry].slice(-constants.BUILDER_HISTORY_LIMIT);
      syncHistoryUi();
      return true;
    };

    return {
      canRedoHistory,
      canUndoHistory,
      queueHistoryCheckpoint,
      recordHistoryCheckpoint,
      redoHistory,
      resetHistory,
      undoHistory,
    };
}
