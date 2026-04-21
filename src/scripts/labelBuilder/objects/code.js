// ╭──────────────────────────╮
// │  objects/code.js         │
// │  QR/barcode generation,  │
// │  validation, and serial  │
// │  aware code-object state │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('codeObjects', ctx => {
    const { constants, refs, settings, state } = ctx;

    const resolveBuilderVersionLabel = () => {
      const clientVersion = String(window.PRINTIFY_CLIENT_VERSION || '').trim();
      return clientVersion ? `${constants.DEFAULT_CODE_FALLBACK_LABEL} v${clientVersion}` : constants.DEFAULT_CODE_FALLBACK_LABEL;
    };

    const buildNumericVersionCode = totalDigits => {
      const clientVersion = String(window.PRINTIFY_CLIENT_VERSION || '').trim();
      const versionParts = clientVersion
        .split('.')
        .map(part => Number.parseInt(part, 10))
        .filter(Number.isFinite)
        .slice(0, 3);

      while (versionParts.length < 3) versionParts.push(0);

      const numericBody = versionParts.map(part => String(part).padStart(3, '0')).join('');
      const prefix = totalDigits === 12 ? '271' : '27';
      return `${prefix}${numericBody}`.slice(0, totalDigits);
    };

    const resolveFallbackCodeText = codeFormat => {
      switch (codeFormat) {
        case 'ean13':
          return buildNumericVersionCode(12);
        case 'upca':
          return buildNumericVersionCode(11);
        case 'code39':
          return resolveBuilderVersionLabel().toUpperCase().replace(/[.]/g, ' ');
        default:
          return resolveBuilderVersionLabel();
      }
    };

    const getCompatibleCodeText = (nextCodeText, codeFormat) => {
      const normalizedText = String(nextCodeText || '').trim();
      if (!normalizedText) return null;

      switch (codeFormat) {
        case 'ean13':
          return /^\d{12,13}$/.test(normalizedText) ? normalizedText : null;
        case 'upca':
          return /^\d{11,12}$/.test(normalizedText) ? normalizedText : null;
        case 'code39': {
          const normalizedCode39Text = normalizedText.toUpperCase();
          return /^[0-9A-Z \-.$/+%]+$/.test(normalizedCode39Text) ? normalizedCode39Text : null;
        }
        default:
          return normalizedText;
      }
    };

    const ensureCodeSerialState = codeObject => {
      if (!ctx.isCodeObject(codeObject)) return codeObject;

      codeObject.serialEnabled = Boolean(codeObject.serialEnabled);
      codeObject.serialCurrentValue = ctx.utils.normalizeSerialValue(codeObject.serialCurrentValue);
      codeObject.codeText = String(codeObject.codeText || '');

      return codeObject;
    };

    const buildCodeSourceUrl = (codeText, codeFormat) => {
      const builderCanvas = ctx.ensureCanvas();
      const codeSize = Math.max(256, Math.round(Math.max(builderCanvas.getWidth(), builderCanvas.getHeight())));
      const codeUrl = new URL('/label-builder/code', window.location.origin);
      codeUrl.searchParams.set('text', codeText);
      codeUrl.searchParams.set('format', codeFormat || 'qrcode');
      codeUrl.searchParams.set('size', String(codeSize));
      return codeUrl.toString();
    };

    const buildCodeImage = async (codeText, codeFormat = 'qrcode', rawCodeText = '') => {
      const codeSourceUrl = buildCodeSourceUrl(codeText, codeFormat);
      const imageElement = await ctx.utils.loadImageElement(codeSourceUrl);
      const FabricImageCtor = window.fabric.FabricImage || window.fabric.Image;
      const codeImage = new FabricImageCtor(imageElement);

      ctx.applyBuilderObjectDefaults(codeImage).set({
        codeText: rawCodeText,
        codeFormat,
        renderedCodeText: codeText,
        serialEnabled: false,
        serialCurrentValue: 1,
        printifyObjectType: 'code',
      });

      return codeImage;
    };

    const updateCodeObject = async (codeObject, nextCodeText, nextCodeFormat, options = {}) => {
      if (!ctx.isCodeObject(codeObject)) return;

      // Code objects are image-backed, so every logical text/format change
      // regenerates the underlying bitmap while preserving layout on canvas.
      ensureCodeSerialState(codeObject);
      const normalizedFormat = nextCodeFormat || codeObject.codeFormat || 'qrcode';
      const normalizedText = String(nextCodeText || '').trim();
      const serialValue = ctx.utils.normalizeSerialValue(Object.prototype.hasOwnProperty.call(options, 'serialCurrentValue')
        ? options.serialCurrentValue
        : codeObject.serialCurrentValue);
      const previewSerializedText = Boolean(options.useRenderedText);
      const renderedInputText = ctx.utils.renderSerialText(
        normalizedText,
        previewSerializedText && codeObject.serialEnabled,
        serialValue
      ).trim();
      const compatibleText = getCompatibleCodeText(renderedInputText, normalizedFormat);
      const shouldPreserveWhenBlank = Boolean(options.preserveWhenBlank);

      if (!normalizedText && shouldPreserveWhenBlank) {
        codeObject.set({
          codeText: '',
          codeFormat: normalizedFormat,
        });
        if (!options.skipControlSync) ctx.syncTextControls(codeObject);
        ctx.ensureCanvas().requestRenderAll();
        return;
      }

      if (normalizedText && !compatibleText && options.skipIncompatibleInput) {
        codeObject.set('codeText', normalizedText);
        if (!options.skipControlSync) ctx.syncTextControls(codeObject);
        return;
      }

      const renderedText = compatibleText || resolveFallbackCodeText(normalizedFormat);
      const storedText = normalizedText;

      const renderedWidth = (codeObject.width || 1) * (codeObject.scaleX || 1);
      const renderedHeight = (codeObject.height || 1) * (codeObject.scaleY || 1);
      const lockedValues = {
        left: codeObject.left,
        top: codeObject.top,
        angle: codeObject.angle || 0,
      };

      try {
        const nextImageElement = await ctx.utils.loadImageElement(buildCodeSourceUrl(renderedText, normalizedFormat));

        codeObject.setElement(nextImageElement);
        codeObject.set({
          width: nextImageElement.naturalWidth || nextImageElement.width,
          height: nextImageElement.naturalHeight || nextImageElement.height,
          scaleX: renderedWidth / (nextImageElement.naturalWidth || nextImageElement.width || 1),
          scaleY: renderedHeight / (nextImageElement.naturalHeight || nextImageElement.height || 1),
          codeText: storedText,
          codeFormat: normalizedFormat,
          renderedCodeText: renderedText,
          ...lockedValues,
        });
        codeObject.setCoords();
        if (!options.skipControlSync) ctx.syncTextControls(codeObject);
        ctx.ensureCanvas().requestRenderAll();
      } catch (error) {
        settings.onError(new Error('Could not update that code object.'));
      }
    };

    const updateSelectedCode = async (nextCodeText, nextCodeFormat, options = {}) => {
      const codeObject = ctx.getCodeObjectForControls();
      if (!codeObject) return;

      await updateCodeObject(codeObject, nextCodeText, nextCodeFormat, options);
    };

    const commitCodeObjectState = async (codeObject, options = {}) => {
      if (!ctx.isCodeObject(codeObject)) return;

      ensureCodeSerialState(codeObject);
      window.clearTimeout(state.qrUpdateTimer);

      const nextCodeText = options.useControlValues !== false
        ? (refs.qrTextInput?.value ?? codeObject.codeText ?? '')
        : (codeObject.codeText || '');
      const nextCodeFormat = options.useControlValues !== false
        ? (refs.qrFormatSelect?.value || codeObject.codeFormat || 'qrcode')
        : (codeObject.codeFormat || 'qrcode');

      await updateCodeObject(codeObject, nextCodeText, nextCodeFormat, {
        preserveWhenBlank: true,
        skipIncompatibleInput: true,
        skipControlSync: options.skipControlSync,
        useRenderedText: options.useRenderedText,
      });
    };

    const applyCodeSerialDigits = async (codeObject, digits) => {
      if (!ctx.isCodeObject(codeObject)) return;

      ensureCodeSerialState(codeObject);
      const nextCodeText = ctx.utils.replaceSerialTokenDigits(codeObject.codeText || '', digits);
      await updateCodeObject(codeObject, nextCodeText, codeObject.codeFormat || 'qrcode', {
        preserveWhenBlank: true,
        skipIncompatibleInput: true,
      });
    };

    const addQrCode = async () => {
      const builderCanvas = ctx.ensureCanvas();
      const defaultCodeText = resolveFallbackCodeText('qrcode');

      try {
        const codeImage = await buildCodeImage(defaultCodeText, 'qrcode', '');
        ctx.fitObjectToCanvas(codeImage);
        builderCanvas.add(codeImage);
        ctx.focusObject(codeImage);
        window.setTimeout(() => {
          if (!refs.qrTextInput) return;
          refs.qrTextInput.focus();
          refs.qrTextInput.select();
        }, 0);
      } catch (error) {
        settings.onError(new Error('Could not generate a QR code for the label builder.'));
      }
    };

    return {
      addQrCode,
      applyCodeSerialDigits,
      buildCodeImage,
      buildCodeSourceUrl,
      commitCodeObjectState,
      ensureCodeSerialState,
      getCompatibleCodeText,
      resolveFallbackCodeText,
      updateCodeObject,
      updateSelectedCode,
    };
  });
}());
