// ╭──────────────────────────╮
// │  preview.js              │
// │  Serial preview and      │
// │  backend monochrome      │
// │  preview lifecycle       │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('preview', ctx => {
    const { refs, settings, state } = ctx;

    const revokeMonochromePreviewUrl = () => {
      if (!state.monochromePreviewUrl) return;
      URL.revokeObjectURL(state.monochromePreviewUrl);
      state.monochromePreviewUrl = null;
    };

    const hideMonochromePreview = () => {
      revokeMonochromePreviewUrl();
      if (refs.monochromePreviewImage) refs.monochromePreviewImage.removeAttribute('src');
      if (refs.monochromePreviewShell) refs.monochromePreviewShell.hidden = true;
    };

    const showMonochromePreview = blob => {
      revokeMonochromePreviewUrl();
      state.monochromePreviewUrl = URL.createObjectURL(blob);
      if (refs.monochromePreviewImage) refs.monochromePreviewImage.src = state.monochromePreviewUrl;
      if (refs.monochromePreviewShell) refs.monochromePreviewShell.hidden = false;
    };

    const ensureSerialState = object => {
      if (object instanceof window.fabric.Textbox) return ctx.ensureTextboxSerialState(object);
      if (ctx.isCodeObject(object)) return ctx.ensureCodeSerialState(object);
      return object;
    };

    const getSerialObjects = () => ctx.ensureCanvas().getObjects().filter(object => {
      ensureSerialState(object);
      return Boolean(object?.serialEnabled);
    });

    const commitObjectState = async (object, options = {}) => {
      if (object instanceof window.fabric.Textbox) {
        ctx.commitTextboxState(object, options);
        return;
      }

      if (ctx.isCodeObject(object)) {
        await ctx.commitCodeObjectState(object, options);
      }
    };

    const applySerialPreviewForCopy = async copyOffset => {
      const builderCanvas = ctx.ensureCanvas();

      // Preview mutates live canvas objects temporarily rather than cloning the
      // whole document, so restoreSerialPreviewState must remain its partner.
      for (const object of builderCanvas.getObjects()) {
        if (object instanceof window.fabric.Textbox) {
          ctx.ensureTextboxSerialState(object);
          if (!object.serialEnabled) continue;

          object.serialCurrentValue = ctx.utils.normalizeSerialValue(object.serialCurrentValue);
          ctx.refreshTextboxSerialPreview(object, {
            skipRender: true,
            useRenderedText: true,
          });
          object.set('text', ctx.utils.renderSerialText(object.serialTemplateText, true, object.serialCurrentValue + copyOffset));
          object.width = object.frameWidth || object.width;
          if (object.autoFitText) {
            ctx.fitTextboxFontToFrame(object);
          } else {
            object.initDimensions();
          }
          object.setCoords();
          continue;
        }

        if (!ctx.isCodeObject(object) || !object.serialEnabled) continue;

        await ctx.updateCodeObject(object, object.codeText || '', object.codeFormat || 'qrcode', {
          preserveWhenBlank: true,
          serialCurrentValue: object.serialCurrentValue + copyOffset,
          skipControlSync: true,
          skipHistory: true,
          useRenderedText: true,
        });
      }

      builderCanvas.requestRenderAll();
    };

    const restoreSerialPreviewState = async () => {
      const builderCanvas = ctx.ensureCanvas();

      for (const object of builderCanvas.getObjects()) {
        if (object instanceof window.fabric.Textbox) {
          ctx.ensureTextboxSerialState(object);
          if (object.serialEnabled) {
            ctx.refreshTextboxSerialPreview(object, { skipRender: true });
          } else if (!object.isEditing) {
            object.set('text', object.serialTemplateText);
            object.width = object.frameWidth || object.width;
            if (object.autoFitText) {
              ctx.fitTextboxFontToFrame(object);
            } else {
              object.initDimensions();
            }
            object.setCoords();
          }
          continue;
        }

        if (!ctx.isCodeObject(object) || !object.serialEnabled) continue;

        await ctx.updateCodeObject(object, object.codeText || '', object.codeFormat || 'qrcode', {
          preserveWhenBlank: true,
          skipControlSync: true,
          skipHistory: true,
          useRenderedText: false,
        });
      }

      builderCanvas.requestRenderAll();
    };

    const advanceSerialObjects = copies => {
      getSerialObjects().forEach(object => {
        object.serialCurrentValue = ctx.utils.normalizeSerialValue(object.serialCurrentValue) + copies;
      });
    };

    const startSerialPreview = async () => {
      if (state.isSerialPreviewActive) return;

      await state.pendingStateCommit.catch(() => {});
      await commitObjectState(ctx.ensureCanvas().getActiveObject(), {
        exitEditing: true,
        skipControlSync: true,
      });

      state.isSerialPreviewActive = true;
      ctx.syncPreviewButton();
      await applySerialPreviewForCopy(0);
    };

    const stopSerialPreview = async () => {
      if (!state.isSerialPreviewActive) return;

      state.isSerialPreviewActive = false;
      ctx.syncPreviewButton();
      await restoreSerialPreviewState();
      ctx.syncTextControls(ctx.ensureCanvas().getActiveObject() || null);
    };

    const buildBackendPreviewLabelFile = async () => {
      const shouldRenderSerialState = !state.isSerialPreviewActive && getSerialObjects().length > 0;

      // Export preview uses the same "safe export state" path as printing so
      // controls/borders/edit sessions cannot leak into preview images.
      return ctx.withCanvasExportState(async () => {
        if (shouldRenderSerialState) {
          await applySerialPreviewForCopy(0);
        }

        try {
          return await ctx.buildCanvasLabelFile();
        } finally {
          if (shouldRenderSerialState) {
            await restoreSerialPreviewState();
          }
        }
      });
    };

    const requestMonochromePreview = async file => {
      const formData = new FormData();
      const previewFields = settings.getMonochromePreviewFields(state.currentPrinter) || {};
      formData.append('imgFile', file, file.name);
      Object.entries(previewFields).forEach(([fieldName, fieldValue]) => {
        if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
          formData.append(fieldName, fieldValue);
        }
      });

      const response = await fetch(`/printers/${encodeURIComponent(state.currentPrinter.id)}/preview/monochrome`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Preview failed for ${state.currentPrinter.displayName}`);
      }

      return response.blob();
    };

    const startMonochromePreview = async () => {
      if (!state.currentPrinter?.monochrome || state.isMonochromePreviewActive) return;

      const requestId = state.monochromePreviewRequestId + 1;
      state.monochromePreviewRequestId = requestId;
      state.isMonochromePreviewActive = true;
      ctx.syncPreviewButton();

      try {
        const previewFile = await buildBackendPreviewLabelFile();
        const previewBlob = await requestMonochromePreview(previewFile);

        if (!state.isMonochromePreviewActive || state.monochromePreviewRequestId !== requestId) {
          return;
        }

        showMonochromePreview(previewBlob);
      } catch (error) {
        if (state.isMonochromePreviewActive && state.monochromePreviewRequestId === requestId) {
          await stopMonochromePreview();
          settings.onError(new Error('Could not prepare the backend monochrome preview.'));
        }
      }
    };

    const stopMonochromePreview = async () => {
      if (!state.isMonochromePreviewActive && refs.monochromePreviewShell?.hidden !== false) return;

      state.monochromePreviewRequestId += 1;
      state.isMonochromePreviewActive = false;
      hideMonochromePreview();
      ctx.syncPreviewButton();
    };

    return {
      advanceSerialObjects,
      applySerialPreviewForCopy,
      buildBackendPreviewLabelFile,
      commitObjectState,
      ensureSerialState,
      getSerialObjects,
      hideMonochromePreview,
      restoreSerialPreviewState,
      showMonochromePreview,
      startMonochromePreview,
      startSerialPreview,
      stopMonochromePreview,
      stopSerialPreview,
    };
  });
}());
