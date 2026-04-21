// ╭──────────────────────────╮
// │  export.js               │
// │  Export-safe canvas      │
// │  rendering and print     │
// │  handoff                 │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('export', ctx => {
    const { refs, settings, state } = ctx;

    const withCanvasExportState = async callback => {
      const builderCanvas = ctx.ensureCanvas();
      const activeObject = builderCanvas.getActiveObject();
      const objectControls = builderCanvas.getObjects().map(object => ({
        object,
        hasBorders: object.hasBorders,
        hasControls: object.hasControls,
      }));

      // Printing and previews both rely on this helper so "hide controls,
      // exit edit mode, render clean image, then restore interaction state"
      // stays consistent in one place.
      await state.pendingStateCommit.catch(() => {});
      await ctx.commitObjectState(activeObject, {
        exitEditing: true,
        skipControlSync: true,
      });

      builderCanvas.getObjects().forEach(object => {
        if (typeof object.exitEditing === 'function') object.exitEditing();
        object.set({
          hasBorders: false,
          hasControls: false,
        });
      });
      builderCanvas.discardActiveObject();
      builderCanvas.renderAll();

      try {
        return await callback({ activeObject });
      } finally {
        objectControls.forEach(({ object, hasBorders, hasControls }) => {
          object.set({ hasBorders, hasControls });
        });
        if (activeObject) builderCanvas.setActiveObject(activeObject);
        ctx.syncTextControls(builderCanvas.getActiveObject() || null);
        builderCanvas.requestRenderAll();
      }
    };

    const buildCanvasLabelFile = async (copyIndex = null) => {
      const builderCanvas = ctx.ensureCanvas();
      builderCanvas.renderAll();
      const exportWidth = ctx.isTapePrinter(state.currentPrinter)
        ? (ctx.utils.mmToPixels(ctx.getTapeExportLengthMm(state.currentPrinter), state.currentPrinter?.density) || builderCanvas.getWidth())
        : builderCanvas.getWidth();
      const exportHeight = builderCanvas.getHeight();

      const blob = await new Promise(resolve => {
        builderCanvas.lowerCanvasEl.toBlob(resolve);
      });

      if (!blob) {
        throw new Error('Could not render the label canvas.');
      }

      const logicalCanvas = document.createElement('canvas');
      logicalCanvas.width = exportWidth;
      logicalCanvas.height = exportHeight;
      const logicalContext = logicalCanvas.getContext('2d');

      if (!logicalContext) {
        throw new Error('Could not prepare the label image.');
      }

      logicalContext.fillStyle = '#ffffff';
      logicalContext.fillRect(0, 0, logicalCanvas.width, logicalCanvas.height);
      logicalContext.drawImage(
        builderCanvas.lowerCanvasEl,
        0,
        0,
        builderCanvas.lowerCanvasEl.width,
        builderCanvas.lowerCanvasEl.height,
        0,
        0,
        builderCanvas.getWidth(),
        exportHeight
      );

      const normalizedBlob = await new Promise(resolve => {
        logicalCanvas.toBlob(resolve, 'image/png');
      });

      if (!normalizedBlob) {
        throw new Error('Could not normalize the label image.');
      }

      const suffix = copyIndex === null ? '' : `-${String(copyIndex + 1).padStart(3, '0')}`;
      return new File([normalizedBlob], `label${suffix}.png`, { type: 'image/png' });
    };

    const print = async () => {
      if (!state.currentPrinter) return;

      // Serial objects turn one requested print job into multiple exported
      // image files. Keep that behavior explicit here so future template or
      // batching work does not accidentally collapse it.
      ctx.clearEnterPrintPrompt();
      if (state.isSerialPreviewActive) await ctx.stopSerialPreview();
      if (state.isMonochromePreviewActive) await ctx.stopMonochromePreview();

      const copies = Math.max(1, Number.parseInt(refs.copiesInput?.value || '1', 10) || 1);
      const hasSerialObjects = ctx.getSerialObjects().length > 0;

      try {
        await withCanvasExportState(async () => {
          let files = [];
          let requestedPrintCount = copies;

          if (hasSerialObjects) {
            requestedPrintCount = 1;
            for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
              await ctx.applySerialPreviewForCopy(copyIndex);
              files.push(await buildCanvasLabelFile(copyIndex));
            }
          } else {
            files = [await buildCanvasLabelFile()];
          }

          await settings.onPrint(state.currentPrinter, files, {
            printCount: requestedPrintCount,
            tapeWidthMm: ctx.isTapePrinter(state.currentPrinter) ? state.currentTapeWidthMm : null,
            lengthMm: ctx.isTapePrinter(state.currentPrinter) ? ctx.getTapeExportLengthMm(state.currentPrinter) : null,
            invertPrint: state.invertPrintEnabled ? '1' : null,
          });

          if (hasSerialObjects) {
            ctx.advanceSerialObjects(copies);
          }
          await ctx.restoreSerialPreviewState();
        });

        if (settings.closeOnPrint) ctx.close();
      } catch (error) {
        await ctx.restoreSerialPreviewState();
        settings.onError(error);
      }
    };

    return {
      buildCanvasLabelFile,
      print,
      withCanvasExportState,
    };
  });
}());
