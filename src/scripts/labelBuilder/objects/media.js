// ╭──────────────────────────╮
// │  objects/media.js        │
// │  Shared image/code media │
// │  fitting helpers and     │
// │  imported image support  │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('mediaObjects', ctx => {
    const { settings } = ctx;

    const fitObjectToCanvas = object => {
      const builderCanvas = ctx.ensureCanvas();
      const availableWidth = builderCanvas.getWidth() * 0.72;
      const availableHeight = builderCanvas.getHeight() * 0.72;
      const width = object.width || 1;
      const height = object.height || 1;
      const scale = Math.min(availableWidth / width, availableHeight / height, 1);

      object.set({
        left: Math.round((builderCanvas.getWidth() - (width * scale)) / 2),
        top: Math.round((builderCanvas.getHeight() - (height * scale)) / 2),
        scaleX: scale,
        scaleY: scale,
      });
      object.setCoords();
    };

    const applyVisualObjectLayoutPreset = layoutMode => {
      const builderCanvas = ctx.ensureCanvas();
      const activeObject = builderCanvas.getActiveObject();

      if (!ctx.isImageObject(activeObject) && !ctx.isCodeObject(activeObject)) return;

      const intrinsicWidth = activeObject.width || 1;
      const intrinsicHeight = activeObject.height || 1;
      const widthRatio = layoutMode === 'fill' ? 0.84 : 0.58;
      const heightRatio = layoutMode === 'fill' ? 0.84 : 0.58;
      const availableWidth = builderCanvas.getWidth() * widthRatio;
      const availableHeight = builderCanvas.getHeight() * heightRatio;
      const nextScale = Math.min(availableWidth / intrinsicWidth, availableHeight / intrinsicHeight, 1);
      const renderedWidth = intrinsicWidth * nextScale;
      const renderedHeight = intrinsicHeight * nextScale;

      activeObject.set({
        scaleX: nextScale,
        scaleY: nextScale,
        left: Math.round((builderCanvas.getWidth() - renderedWidth) / 2),
        top: Math.round((builderCanvas.getHeight() - renderedHeight) / 2),
      });
      activeObject.setCoords();
      ctx.syncTextControls(activeObject);
      builderCanvas.requestRenderAll();
      void ctx.syncAutoFitTapeCanvas();
    };

    const addImageFromFile = async file => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        settings.onError(new Error('Please choose an image file.'));
        return;
      }

      // Persist the source data URL on the Fabric image so template saves can
      // round-trip browser-local images without introducing a new asset layer.
      try {
        const dataUrl = await ctx.utils.readFileAsDataUrl(file);
        const imageElement = await ctx.utils.loadImageElement(dataUrl);
        const FabricImageCtor = window.fabric.FabricImage || window.fabric.Image;
        const image = new FabricImageCtor(imageElement);
        ctx.applyBuilderObjectDefaults(image).set({
          printifyObjectType: 'image',
          sourceUrl: dataUrl,
        });
        fitObjectToCanvas(image);
        ctx.ensureCanvas().add(image);
        ctx.focusObject(image);
        ctx.refreshBuilderMeta();
        void ctx.syncAutoFitTapeCanvas();
      } catch (error) {
        settings.onError(new Error('Could not load that image into the label builder.'));
      }
    };

    return {
      addImageFromFile,
      applyVisualObjectLayoutPreset,
      fitObjectToCanvas,
    };
  });
}());
