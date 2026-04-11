(function () {
  // ╭──────────────────────────╮
  // │  Shared builder state    │
  // ╰──────────────────────────╯
  const DEFAULT_CANVAS_SIZE = {
    width: 425,
    height: 200,
  };
  const DEFAULT_CODE_FALLBACK_LABEL = 'Printify';
  const DEFAULT_TEXTBOX_PLACEHOLDER = 'Click to Edit';
  const DEFAULT_SERIAL_DIGITS = 2;
  const DEFAULT_TAPE_LENGTH_MM = 60;
  const MIN_TAPE_LENGTH_MM = 8;
  const TAPE_EXPORT_PADDING_MM = 4;
  const BUILDER_MODAL_CLOSE_MS = 220;
  const BUILDER_HANDLE_BASE_SIZE = 12;
  const BUILDER_HANDLE_TOUCH_SIZE = 22;
  const BUILDER_ROTATION_SNAP_ANGLE = 45;
  const BUILDER_ROTATION_SNAP_THRESHOLD = 8;

  const mmToPixels = (millimeters, density) => {
    const numericMillimeters = Number(millimeters);
    const numericDensity = Number(density);

    if (!Number.isFinite(numericMillimeters) || numericMillimeters <= 0 || !Number.isFinite(numericDensity) || numericDensity <= 0) {
      return null;
    }

    return Math.max(1, Math.round((numericMillimeters / 25.4) * numericDensity));
  };

  const normalizeTapeLengthMm = value => {
    const parsedValue = Number.parseInt(value, 10);
    return Number.isFinite(parsedValue) ? Math.max(MIN_TAPE_LENGTH_MM, parsedValue) : DEFAULT_TAPE_LENGTH_MM;
  };

  const getResolvedDefaultTapeWidth = printer => {
    const configuredTapes = Array.isArray(printer?.tapes) ? printer.tapes : [];
    const preferredTape = Number.parseInt(printer?.lastTapeWidthMm, 10);
    const defaultTape = Number.parseInt(printer?.defaultTape, 10);

    if (configuredTapes.includes(preferredTape)) {
      return preferredTape;
    }

    if (configuredTapes.includes(defaultTape)) {
      return defaultTape;
    }

    return configuredTapes[0] || null;
  };

  const getPrinterCanvasSize = printer => {
    if (printer?.isTape) {
      const tapeWidthMm = getResolvedDefaultTapeWidth(printer) || 12;
      const tapeHeightPx = mmToPixels(tapeWidthMm, printer?.density);
      const tapeLengthPx = mmToPixels(DEFAULT_TAPE_LENGTH_MM, printer?.density);

      if (Number.isFinite(tapeHeightPx) && Number.isFinite(tapeLengthPx)) {
        return {
          width: tapeLengthPx,
          height: tapeHeightPx,
        };
      }
    }

    if (Number.isFinite(printer?.sizePxWidth) && Number.isFinite(printer?.sizePxHeight)) {
      return {
        width: printer.sizePxWidth,
        height: printer.sizePxHeight,
      };
    }

    const match = String(printer?.sizePx || '').match(/^(\d+)x(\d+)$/i);

    if (!match) return DEFAULT_CANVAS_SIZE;

    return {
      width: Number.parseInt(match[1], 10),
      height: Number.parseInt(match[2], 10),
    };
  };

  function createPrintifyLabelBuilder(options) {
    const settings = Object.assign({
      rootSelector: '#labelBuilder',
      titleSelector: '#labelBuilderTitle',
      copySelector: '#labelBuilderCopy',
      sizeSelector: '#labelBuilderSize',
      enterConfirmSelector: '#labelBuilderEnterConfirm',
      closeSelector: '#labelBuilderClose',
      cancelSelector: '#labelBuilderCancel',
      resetSelector: '#labelBuilderReset',
      printSelector: '#labelBuilderPrint',
      previewSelector: '[data-role="label-builder-preview"]',
      monochromePreviewSelector: '#labelBuilderMonochromePreview',
      monochromePreviewShellSelector: '#labelBuilderMonochromePreviewShell',
      monochromePreviewImageSelector: '#labelBuilderMonochromePreviewImage',
      copiesSelector: '#labelBuilderCopies',
      textCardSelector: '#labelBuilderTextCard',
      imageCardSelector: '#labelBuilderImageCard',
      qrCardSelector: '#labelBuilderQrCard',
      fontSelector: '#labelBuilderFont',
      fontSizeSelector: '#labelBuilderFontSize',
      autoFitSelector: '#labelBuilderAutoFit',
      textSerialEnabledSelector: '#labelBuilderTextSerialEnabled',
      textSerialValueSelector: '#labelBuilderTextSerialValue',
      textSerialDigitsSelector: '#labelBuilderTextSerialDigits',
      textSerialValueFieldSelector: '#labelBuilderTextSerialValueField',
      qrFormatSelector: '#labelBuilderQrFormat',
      qrTextSelector: '#labelBuilderQrText',
      codeSerialEnabledSelector: '#labelBuilderCodeSerialEnabled',
      codeSerialValueSelector: '#labelBuilderCodeSerialValue',
      codeSerialDigitsSelector: '#labelBuilderCodeSerialDigits',
      codeSerialValueFieldSelector: '#labelBuilderCodeSerialValueField',
      imageInputSelector: '#labelBuilderImageInput',
      addImageSelector: '#labelBuilderAddImage',
      canvasWrapSelector: '.printify-builder__canvas-wrap',
      canvasShellSelector: '.printify-builder__canvas-shell',
      addTextSelector: '#labelBuilderAddText',
      addQrSelector: '#labelBuilderAddQr',
      tapeControlsSelector: '#labelBuilderTapeControls',
      tapeWidthSelector: '#labelBuilderTapeWidth',
      tapeLengthSelector: '#labelBuilderTapeLength',
      tapeAutoLengthSelector: '#labelBuilderTapeAutoLength',
      fitImageHeightSelector: '#labelBuilderFitImageHeight',
      alignLeftSelector: '#labelBuilderAlignLeft',
      alignCenterSelector: '#labelBuilderAlignCenter',
      alignRightSelector: '#labelBuilderAlignRight',
      canvasId: 'labelCanvas',
      onPrint: async () => {},
      onError: () => {},
      closeOnPrint: true,
    }, options || {});

    const root = document.querySelector(settings.rootSelector);
    const title = root?.querySelector(settings.titleSelector);
    const copy = root?.querySelector(settings.copySelector);
    const size = root?.querySelector(settings.sizeSelector);
    const enterConfirm = root?.querySelector(settings.enterConfirmSelector);
    const closeButton = root?.querySelector(settings.closeSelector);
    const cancelButton = root?.querySelector(settings.cancelSelector);
    const resetButton = root?.querySelector(settings.resetSelector);
    const printButton = root?.querySelector(settings.printSelector);
    const previewButtons = Array.from(root?.querySelectorAll(settings.previewSelector) || []);
    const monochromePreviewButton = root?.querySelector(settings.monochromePreviewSelector);
    const monochromePreviewShell = root?.querySelector(settings.monochromePreviewShellSelector);
    const monochromePreviewImage = root?.querySelector(settings.monochromePreviewImageSelector);
    const copiesInput = root?.querySelector(settings.copiesSelector);
    const textCard = root?.querySelector(settings.textCardSelector);
    const imageCard = root?.querySelector(settings.imageCardSelector);
    const qrCard = root?.querySelector(settings.qrCardSelector);
    const fontSelect = root?.querySelector(settings.fontSelector);
    const fontSizeInput = root?.querySelector(settings.fontSizeSelector);
    const autoFitInput = root?.querySelector(settings.autoFitSelector);
    const textSerialEnabledInput = root?.querySelector(settings.textSerialEnabledSelector);
    const textSerialValueInput = root?.querySelector(settings.textSerialValueSelector);
    const textSerialDigitsInput = root?.querySelector(settings.textSerialDigitsSelector);
    const textSerialValueField = root?.querySelector(settings.textSerialValueFieldSelector);
    const qrFormatSelect = root?.querySelector(settings.qrFormatSelector);
    const qrTextInput = root?.querySelector(settings.qrTextSelector);
    const codeSerialEnabledInput = root?.querySelector(settings.codeSerialEnabledSelector);
    const codeSerialValueInput = root?.querySelector(settings.codeSerialValueSelector);
    const codeSerialDigitsInput = root?.querySelector(settings.codeSerialDigitsSelector);
    const codeSerialValueField = root?.querySelector(settings.codeSerialValueFieldSelector);
    const imageInput = root?.querySelector(settings.imageInputSelector);
    const addImageButton = root?.querySelector(settings.addImageSelector);
    const canvasWrap = root?.querySelector(settings.canvasWrapSelector);
    const canvasShell = root?.querySelector(settings.canvasShellSelector);
    const addTextButton = root?.querySelector(settings.addTextSelector);
    const addQrButton = root?.querySelector(settings.addQrSelector);
    const tapeControls = root?.querySelector(settings.tapeControlsSelector);
    const tapeWidthSelect = root?.querySelector(settings.tapeWidthSelector);
    const tapeLengthInput = root?.querySelector(settings.tapeLengthSelector);
    const tapeAutoLengthInput = root?.querySelector(settings.tapeAutoLengthSelector);
    const fitImageHeightButton = root?.querySelector(settings.fitImageHeightSelector);
    const alignLeftButton = root?.querySelector(settings.alignLeftSelector);
    const alignCenterButton = root?.querySelector(settings.alignCenterSelector);
    const alignRightButton = root?.querySelector(settings.alignRightSelector);

    if (!root || !window.fabric) return null;

    let currentPrinter = null;
    let canvas = null;
    let defaultTextbox = null;
    let isSyncingFontInput = false;
    let isSyncingFontSizeInput = false;
    let isSyncingAutoFitInput = false;
    let isSyncingTextSerialInput = false;
    let isSyncingCodeSerialInput = false;
    let isSyncingQrInput = false;
    let qrUpdateTimer = null;
    let pendingStateCommit = Promise.resolve();
    let isSerialPreviewActive = false;
    let isMonochromePreviewActive = false;
    let monochromePreviewUrl = null;
    let monochromePreviewRequestId = 0;
    let lastSelectedTextObject = null;
    let lastSelectedCodeObject = null;
    let lastSerialValue = 1;
    let lastSerialDigits = DEFAULT_SERIAL_DIGITS;
    let lastBuilderStatePrinterKey = null;
    let enterPrintArmed = false;
    let enterPrintTimer = null;
    let currentTapeWidthMm = null;
    let currentTapeLengthMm = DEFAULT_TAPE_LENGTH_MM;
    let tapeMinimumLengthMm = DEFAULT_TAPE_LENGTH_MM;
    let tapeAutoLengthEnabled = true;
    let currentViewportScale = 1;
    let closeAnimationTimer = null;
    let openAnimationFrame = null;

    const ensureCanvas = () => {
      if (canvas) return canvas;

      canvas = new window.fabric.Canvas(settings.canvasId, {
        preserveObjectStacking: true,
        backgroundColor: '#ffffff',
        enableRetinaScaling: false,
        uniformScaling: true,
        uniScaleKey: null,
      });

      return canvas;
    };

    const getCanvasControlSizing = () => {
      const pageZoom = Math.max(0.2, Number(window.visualViewport?.scale) || 1);
      const effectiveScale = Math.max((currentViewportScale || 1) * pageZoom, 0.12);
      const controlScale = Math.max(1, Math.min(5, 1 / effectiveScale));
      return {
        cornerSize: Math.round(BUILDER_HANDLE_BASE_SIZE * controlScale),
        touchCornerSize: Math.round(BUILDER_HANDLE_TOUCH_SIZE * controlScale),
      };
    };

    const updateCanvasControlAppearance = () => {
      const builderCanvas = ensureCanvas();
      const { cornerSize, touchCornerSize } = getCanvasControlSizing();

      builderCanvas.getObjects().forEach(object => {
        object.set({
          cornerSize,
          touchCornerSize,
        });
        object.setCoords();
      });
    };

    const applyCanvasViewportScale = () => {
      const builderCanvas = ensureCanvas();
      const container = builderCanvas.wrapperEl;
      const lowerCanvas = builderCanvas.lowerCanvasEl;
      const upperCanvas = builderCanvas.upperCanvasEl;

      if (!canvasShell || !container || !lowerCanvas || !upperCanvas) return;

      const logicalWidth = builderCanvas.getWidth();
      const logicalHeight = builderCanvas.getHeight();
      const shellStyles = window.getComputedStyle(canvasShell);
      const horizontalPadding = (
        Number.parseFloat(shellStyles.paddingLeft || '0')
        + Number.parseFloat(shellStyles.paddingRight || '0')
      );
      const availableWidth = Math.max(240, canvasShell.clientWidth - horizontalPadding);
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || logicalHeight;
      const availableHeight = Math.max(180, Math.floor(viewportHeight * 0.46));
      const displayScale = Math.min(1, availableWidth / logicalWidth, availableHeight / logicalHeight);
      const displayWidth = Math.max(1, Math.round(logicalWidth * displayScale));
      const displayHeight = Math.max(1, Math.round(logicalHeight * displayScale));
      currentViewportScale = displayScale;

      [container, lowerCanvas, upperCanvas].forEach(element => {
        element.style.width = `${displayWidth}px`;
        element.style.height = `${displayHeight}px`;
      });

      updateCanvasControlAppearance();
      syncMonochromePreviewViewport();
      builderCanvas.calcOffset();
      builderCanvas.requestRenderAll();
    };

    const syncMonochromePreviewViewport = () => {
      const builderCanvas = ensureCanvas();
      const container = builderCanvas.wrapperEl;

      if (!canvasWrap || !container || !monochromePreviewShell) return;

      monochromePreviewShell.style.left = `${container.offsetLeft}px`;
      monochromePreviewShell.style.top = `${container.offsetTop}px`;
      monochromePreviewShell.style.width = `${container.offsetWidth}px`;
      monochromePreviewShell.style.height = `${container.offsetHeight}px`;
    };

    const isCodeObject = object => object?.printifyObjectType === 'code';
    const isImageObject = object => object?.printifyObjectType === 'image';
    const isTapePrinter = printer => Boolean(printer?.isTape);
    const isArrowNudgeKey = key => key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';

    const applyBuilderObjectDefaults = object => {
      if (!object) return object;
      const { cornerSize, touchCornerSize } = getCanvasControlSizing();

      object.set({
        transparentCorners: false,
        cornerStyle: 'circle',
        cornerColor: '#1f6f43',
        borderColor: '#1f6f43',
        borderScaleFactor: 2,
        cornerSize,
        touchCornerSize,
        snapAngle: BUILDER_ROTATION_SNAP_ANGLE,
        snapThreshold: BUILDER_ROTATION_SNAP_THRESHOLD,
      });

      if (object.controls?.mtr) {
        object.controls.mtr.cursorStyleHandler = () => 'grab';
      }

      return object;
    };

    const getCurrentTapeCanvasSize = printer => {
      const tapeWidthMm = currentTapeWidthMm || getResolvedDefaultTapeWidth(printer) || 12;
      const tapeLengthMm = normalizeTapeLengthMm(currentTapeLengthMm);
      const width = mmToPixels(tapeLengthMm, printer?.density);
      const height = mmToPixels(tapeWidthMm, printer?.density);

      return {
        width: Number.isFinite(width) ? width : DEFAULT_CANVAS_SIZE.width,
        height: Number.isFinite(height) ? height : DEFAULT_CANVAS_SIZE.height,
      };
    };

    const describeBuilderSize = printer => {
      const builderCanvas = ensureCanvas();

      if (!isTapePrinter(printer)) {
        return `${builderCanvas.getWidth()} x ${builderCanvas.getHeight()} px`;
      }

      const exportLengthMm = getTapeExportLengthMm(printer);
      const lengthLabel = tapeAutoLengthEnabled
        ? `${exportLengthMm}mm auto`
        : `${normalizeTapeLengthMm(currentTapeLengthMm)}mm`;

      return `${currentTapeWidthMm}mm tape • ${lengthLabel} • ${builderCanvas.getWidth()} x ${builderCanvas.getHeight()} px`;
    };

    const refreshBuilderMeta = () => {
      if (currentPrinter && size) {
        size.textContent = describeBuilderSize(currentPrinter);
      }
    };

    const syncTapeControls = printer => {
      const tapeMode = isTapePrinter(printer);

      if (tapeControls) {
        tapeControls.hidden = !tapeMode;
        tapeControls.style.display = tapeMode ? '' : 'none';
      }

      if (!tapeMode) {
        return;
      }

      if (tapeWidthSelect) {
        const printerTapes = Array.isArray(printer?.tapes) ? printer.tapes : [];
        tapeWidthSelect.innerHTML = printerTapes.map(tapeWidth => (
          `<option value="${tapeWidth}">${tapeWidth} mm</option>`
        )).join('');

        if (currentTapeWidthMm && printerTapes.includes(currentTapeWidthMm)) {
          tapeWidthSelect.value = String(currentTapeWidthMm);
        }
      }

      if (tapeLengthInput) {
        tapeLengthInput.value = String(normalizeTapeLengthMm(tapeMinimumLengthMm));
        tapeLengthInput.disabled = false;
      }

      if (tapeAutoLengthInput) {
        tapeAutoLengthInput.checked = tapeAutoLengthEnabled;
      }
    };

    const persistTapePreference = async printer => {
      if (!isTapePrinter(printer) || !currentTapeWidthMm) {
        return;
      }

      try {
        await fetch(`/printers/${encodeURIComponent(printer.id)}/preferences/tape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tapeWidthMm: currentTapeWidthMm,
          }),
        });
      } catch (error) {
        // Keep tape preference persistence best-effort so the builder stays usable offline.
      }
    };

    const getContentBounds = () => {
      const builderCanvas = ensureCanvas();
      const objects = builderCanvas.getObjects().filter(object => !object.excludeFromExport);

      if (!objects.length) {
        return null;
      }

      const bounds = objects
        .map(object => object.getBoundingRect())
        .filter(boundary => Number.isFinite(boundary?.left) && Number.isFinite(boundary?.top));

      if (!bounds.length) {
        return null;
      }

      const right = Math.max(...bounds.map(boundary => boundary.left + boundary.width));
      const bottom = Math.max(...bounds.map(boundary => boundary.top + boundary.height));

      return { right, bottom };
    };

    const getRequiredTapeLengthMm = printer => {
      const bounds = getContentBounds();
      const density = Number(printer?.density);
      const paddingPx = mmToPixels(TAPE_EXPORT_PADDING_MM, density) || 0;

      if (!bounds || !Number.isFinite(density) || density <= 0) {
        return normalizeTapeLengthMm(tapeMinimumLengthMm);
      }

      return Math.max(
        normalizeTapeLengthMm(tapeMinimumLengthMm),
        Math.ceil(((bounds.right + paddingPx) / density) * 25.4)
      );
    };

    const getTapeExportLengthMm = printer => (
      isTapePrinter(printer)
        ? normalizeTapeLengthMm(currentTapeLengthMm)
        : null
    );

    const getPrinterCanvasMetrics = printer => (
      isTapePrinter(printer)
        ? getCurrentTapeCanvasSize(printer)
        : getPrinterCanvasSize(printer)
    );

    const applyTapeCanvasSize = async printer => {
      if (!printer || !isTapePrinter(printer)) {
        return;
      }

      const builderCanvas = ensureCanvas();
      const { width, height } = getCurrentTapeCanvasSize(printer);

      builderCanvas.setDimensions({ width, height });
      builderCanvas.getObjects().forEach(object => {
        if (object instanceof window.fabric.Textbox) {
          object.frameWidth = Math.max(48, Math.min(object.frameWidth || object.width || 0, width));
          object.frameHeight = Math.max(32, Math.min(object.frameHeight || object.height || 0, height));
          object.width = object.frameWidth;
          if (object.autoFitText) {
            fitTextboxFontToFrame(object);
          } else {
            object.initDimensions();
          }
        }

        const bounds = object.getBoundingRect();
        const nextLeft = Math.max(0, Math.min(object.left || 0, width - bounds.width));
        const nextTop = Math.max(0, Math.min(object.top || 0, height - bounds.height));

        object.set({
          left: Math.round(nextLeft),
          top: Math.round(nextTop),
        });
        object.setCoords();
      });

      refreshBuilderMeta();
      applyCanvasViewportScale();
      builderCanvas.requestRenderAll();
      await persistTapePreference(printer);
    };

    const syncAutoFitTapeCanvas = async () => {
      if (!currentPrinter || !isTapePrinter(currentPrinter) || !tapeAutoLengthEnabled) {
        return;
      }

      const requiredLengthMm = getRequiredTapeLengthMm(currentPrinter);
      const nextLengthMm = Math.max(normalizeTapeLengthMm(tapeMinimumLengthMm), requiredLengthMm);

      if (nextLengthMm === normalizeTapeLengthMm(currentTapeLengthMm)) {
        refreshBuilderMeta();
        return;
      }

      currentTapeLengthMm = nextLengthMm;
      await applyTapeCanvasSize(currentPrinter);
    };

    const resolveBuilderVersionLabel = () => {
      const clientVersion = String(window.PRINTIFY_CLIENT_VERSION || '').trim();
      return clientVersion ? `${DEFAULT_CODE_FALLBACK_LABEL} v${clientVersion}` : DEFAULT_CODE_FALLBACK_LABEL;
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

    const normalizeSerialValue = value => {
      const parsedValue = Number.parseInt(value, 10);
      return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 1;
    };

    const normalizeSerialDigits = value => {
      const parsedValue = Number.parseInt(value, 10);
      return Number.isFinite(parsedValue) ? Math.max(1, parsedValue) : DEFAULT_SERIAL_DIGITS;
    };

    const getSerialTokenDigits = sourceText => {
      const match = String(sourceText || '').match(/\{(x+)\}/i);
      return match ? match[1].length : DEFAULT_SERIAL_DIGITS;
    };

    const replaceSerialTokenDigits = (sourceText, digits) => String(sourceText || '').replace(/\{x+\}/gi, `{${'x'.repeat(normalizeSerialDigits(digits))}}`);

    const removeSerialTokens = sourceText => String(sourceText || '').replace(/\s*\{x+\}\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();

    const appendSerialToken = (sourceText, digits = DEFAULT_SERIAL_DIGITS) => {
      const normalizedText = String(sourceText || '');
      const nextToken = `{${'x'.repeat(normalizeSerialDigits(digits))}}`;
      if (/\{x+\}/i.test(normalizedText)) return replaceSerialTokenDigits(normalizedText, digits);
      if (!normalizedText.trim()) return nextToken;
      return `${normalizedText} ${nextToken}`;
    };

    const rememberSerialSettings = (serialValue, serialDigits) => {
      lastSerialValue = normalizeSerialValue(serialValue);
      lastSerialDigits = normalizeSerialDigits(serialDigits);
    };

    const getPrinterStateKey = printer => String(printer?.id || printer?.key || printer?.name || printer?.displayName || '');

    const applySerialTokens = (sourceText, serialValue) => String(sourceText || '').replace(/\{(x+)\}/gi, (_, digits) => (
      String(normalizeSerialValue(serialValue)).padStart(digits.length, '0')
    ));

    const renderSerialText = (sourceText, serialEnabled, serialValue) => (
      serialEnabled ? applySerialTokens(sourceText, serialValue) : String(sourceText || '')
    );

    const ensureTextboxSerialState = textbox => {
      if (!(textbox instanceof window.fabric.Textbox)) return textbox;

      textbox.serialEnabled = Boolean(textbox.serialEnabled);
      textbox.serialCurrentValue = normalizeSerialValue(textbox.serialCurrentValue);
      if (typeof textbox.serialTemplateText !== 'string') {
        textbox.serialTemplateText = String(textbox.text || '');
      }

      return textbox;
    };

    const ensureCodeSerialState = codeObject => {
      if (!isCodeObject(codeObject)) return codeObject;

      codeObject.serialEnabled = Boolean(codeObject.serialEnabled);
      codeObject.serialCurrentValue = normalizeSerialValue(codeObject.serialCurrentValue);
      codeObject.codeText = String(codeObject.codeText || '');

      return codeObject;
    };

    const ensureSerialState = object => {
      if (object instanceof window.fabric.Textbox) return ensureTextboxSerialState(object);
      if (isCodeObject(object)) return ensureCodeSerialState(object);
      return object;
    };

    const refreshTextboxSerialPreview = (textObject, options = {}) => {
      if (!(textObject instanceof window.fabric.Textbox)) return;

      ensureTextboxSerialState(textObject);
      if (textObject.isEditing) return;

      const nextText = options.useRenderedText
        ? renderSerialText(textObject.serialTemplateText, textObject.serialEnabled, textObject.serialCurrentValue)
        : textObject.serialTemplateText;

      textObject.set('text', nextText);
      textObject.isPlaceholderText = false;
      textObject.width = textObject.frameWidth || textObject.width;

      if (textObject.autoFitText) {
        fitTextboxFontToFrame(textObject);
      } else {
        textObject.initDimensions();
      }

      textObject.setCoords();
      if (!options.skipRender) ensureCanvas().requestRenderAll();
    };

    const syncPreviewButton = () => {
      previewButtons.forEach(previewButton => {
        previewButton.classList.toggle('is-active', isSerialPreviewActive);
        previewButton.disabled = !currentPrinter;
      });

      if (monochromePreviewButton) {
        const isMonochromePrinter = Boolean(currentPrinter?.monochrome);
        monochromePreviewButton.hidden = !isMonochromePrinter;
        monochromePreviewButton.disabled = !isMonochromePrinter;
        monochromePreviewButton.classList.toggle('is-active', isMonochromePreviewActive);
      }
    };

    const revokeMonochromePreviewUrl = () => {
      if (!monochromePreviewUrl) return;
      URL.revokeObjectURL(monochromePreviewUrl);
      monochromePreviewUrl = null;
    };

    const hideMonochromePreview = () => {
      revokeMonochromePreviewUrl();
      if (monochromePreviewImage) monochromePreviewImage.removeAttribute('src');
      if (monochromePreviewShell) monochromePreviewShell.hidden = true;
    };

    const showMonochromePreview = blob => {
      revokeMonochromePreviewUrl();
      monochromePreviewUrl = URL.createObjectURL(blob);
      if (monochromePreviewImage) monochromePreviewImage.src = monochromePreviewUrl;
      if (monochromePreviewShell) monochromePreviewShell.hidden = false;
    };

    const clearEnterPrintPrompt = () => {
      enterPrintArmed = false;
      window.clearTimeout(enterPrintTimer);
      if (enterConfirm) enterConfirm.hidden = true;
    };

    const showEnterPrintPrompt = () => {
      enterPrintArmed = true;
      if (enterConfirm) enterConfirm.hidden = false;
      window.clearTimeout(enterPrintTimer);
      enterPrintTimer = window.setTimeout(() => {
        clearEnterPrintPrompt();
      }, 2200);
    };

    const syncFontInput = textObject => {
      if (!fontSelect) return;

      isSyncingFontInput = true;
      fontSelect.value = textObject?.fontFamily || 'Arial';
      fontSelect.disabled = !textObject;
      isSyncingFontInput = false;
    };

    const syncFontSizeInput = textObject => {
      if (!fontSizeInput) return;

      isSyncingFontSizeInput = true;
      fontSizeInput.value = textObject?.fontSize ? String(Math.round(textObject.fontSize)) : '';
      fontSizeInput.disabled = !textObject;
      isSyncingFontSizeInput = false;
    };

    const syncAutoFitInput = textObject => {
      if (!autoFitInput) return;

      isSyncingAutoFitInput = true;
      autoFitInput.checked = Boolean(textObject?.autoFitText);
      autoFitInput.disabled = !textObject;
      isSyncingAutoFitInput = false;
    };

    const syncTextSerialInputs = textObject => {
      if (!textSerialEnabledInput || !textSerialValueInput || !textSerialValueField) return;

      const preparedTextbox = textObject instanceof window.fabric.Textbox ? ensureTextboxSerialState(textObject) : null;

      isSyncingTextSerialInput = true;
      textSerialEnabledInput.checked = Boolean(preparedTextbox?.serialEnabled);
      textSerialEnabledInput.disabled = !preparedTextbox;
      textSerialValueField.hidden = !(preparedTextbox?.serialEnabled);
      textSerialValueInput.value = String(preparedTextbox?.serialCurrentValue || 1);
      textSerialValueInput.disabled = !preparedTextbox?.serialEnabled;
      if (textSerialDigitsInput) {
        textSerialDigitsInput.value = String(getSerialTokenDigits(preparedTextbox?.serialTemplateText || preparedTextbox?.text || ''));
        textSerialDigitsInput.disabled = !preparedTextbox?.serialEnabled;
      }
      isSyncingTextSerialInput = false;
    };

    const syncCodeSerialInputs = codeObject => {
      if (!codeSerialEnabledInput || !codeSerialValueInput || !codeSerialValueField) return;

      const preparedCodeObject = isCodeObject(codeObject) ? ensureCodeSerialState(codeObject) : null;

      isSyncingCodeSerialInput = true;
      codeSerialEnabledInput.checked = Boolean(preparedCodeObject?.serialEnabled);
      codeSerialEnabledInput.disabled = !preparedCodeObject;
      codeSerialValueField.hidden = !(preparedCodeObject?.serialEnabled);
      codeSerialValueInput.value = String(preparedCodeObject?.serialCurrentValue || 1);
      codeSerialValueInput.disabled = !preparedCodeObject?.serialEnabled;
      if (codeSerialDigitsInput) {
        codeSerialDigitsInput.value = String(getSerialTokenDigits(preparedCodeObject?.codeText || ''));
        codeSerialDigitsInput.disabled = !preparedCodeObject?.serialEnabled;
      }
      isSyncingCodeSerialInput = false;
    };

    const syncAlignmentButtons = textObject => {
      const buttons = [
        [alignLeftButton, 'left'],
        [alignCenterButton, 'center'],
        [alignRightButton, 'right'],
      ];

      buttons.forEach(([button, value]) => {
        if (!button) return;
        button.disabled = !textObject;
        button.classList.toggle('is-active', textObject?.textAlign === value);
      });
    };

    const syncCodeInputs = codeObject => {
      if (!qrTextInput || !qrFormatSelect) return;

      isSyncingQrInput = true;
      qrTextInput.value = codeObject?.codeText || '';
      qrTextInput.disabled = !codeObject;
      qrFormatSelect.value = codeObject?.codeFormat || 'qrcode';
      qrFormatSelect.disabled = !codeObject;
      isSyncingQrInput = false;
    };

    const syncTextControls = activeObject => {
      const textObject = activeObject instanceof window.fabric.Textbox ? activeObject : null;
      const imageObject = isImageObject(activeObject) ? activeObject : null;
      const codeObject = isCodeObject(activeObject) ? activeObject : null;

      if (textObject) lastSelectedTextObject = textObject;
      if (codeObject) lastSelectedCodeObject = codeObject;

      if (textCard) textCard.hidden = !textObject;
      if (imageCard) imageCard.hidden = !imageObject;
      if (qrCard) qrCard.hidden = !codeObject;
      syncFontInput(textObject);
      syncFontSizeInput(textObject);
      syncAutoFitInput(textObject);
      syncTextSerialInputs(textObject);
      syncAlignmentButtons(textObject);
      syncCodeInputs(codeObject);
      syncCodeSerialInputs(codeObject);
    };

    const fitTextboxFontToFrame = textObject => {
      if (!(textObject instanceof window.fabric.Textbox)) return;
      if (!textObject.autoFitText) return;
      if (!textObject.text?.trim()) return;

      const minSize = 8;
      const configuredMaxSize = Number.isFinite(textObject.maxAutoFitFontSize)
        ? Math.round(textObject.maxAutoFitFontSize)
        : Math.round(textObject.fontSize || minSize);
      const frameMaxSize = Math.round((textObject.frameHeight || textObject.height || 0) * 0.6);
      const maxSize = Math.max(minSize, Math.min(configuredMaxSize, frameMaxSize));
      const availableWidth = Math.max(12, (textObject.frameWidth || textObject.width) - (textObject.padding * 2));
      const availableHeight = Math.max(12, (textObject.frameHeight || textObject.height) - (textObject.padding * 2));
      const lockedLeft = textObject.left;
      const lockedTop = textObject.top;

      const measure = () => {
        textObject.set('width', textObject.frameWidth || textObject.width);
        textObject.initDimensions();
        const lineWidths = Array.isArray(textObject.__lineWidths) ? textObject.__lineWidths : [];
        const maxLineWidth = lineWidths.length ? Math.max(...lineWidths) : 0;
        const textHeight = typeof textObject.measureTextHeight === 'function' ? textObject.measureTextHeight() : textObject.height;

        return {
          maxLineWidth,
          textHeight,
        };
      };

      let nextSize = Math.max(minSize, Math.min(maxSize, Math.round(textObject.fontSize || minSize)));
      textObject.set('fontSize', nextSize);
      let metrics = measure();

      while (nextSize > minSize && (metrics.maxLineWidth > availableWidth || metrics.textHeight > availableHeight)) {
        nextSize -= 1;
        textObject.set('fontSize', nextSize);
        metrics = measure();
      }

      while (nextSize < maxSize) {
        textObject.set('fontSize', nextSize + 1);
        const nextMetrics = measure();
        if (nextMetrics.maxLineWidth > availableWidth || nextMetrics.textHeight > availableHeight) break;
        nextSize += 1;
        metrics = nextMetrics;
      }

      textObject.set('fontSize', nextSize);
      textObject.initDimensions();
      textObject.set({
        left: lockedLeft,
        top: lockedTop,
      });
    };

    const getEditableTextObject = () => {
      const activeObject = ensureCanvas().getActiveObject();
      return activeObject instanceof window.fabric.Textbox ? activeObject : null;
    };

    const getEditableCodeObject = () => {
      const activeObject = ensureCanvas().getActiveObject();
      return isCodeObject(activeObject) ? activeObject : null;
    };

    const hasCanvasObject = object => Boolean(object) && ensureCanvas().getObjects().includes(object);

    const getTextboxForControls = () => {
      const activeTextbox = getEditableTextObject();
      if (activeTextbox) return activeTextbox;
      return hasCanvasObject(lastSelectedTextObject) ? lastSelectedTextObject : null;
    };

    const getCodeObjectForControls = () => {
      const activeCodeObject = getEditableCodeObject();
      if (activeCodeObject) return activeCodeObject;
      return hasCanvasObject(lastSelectedCodeObject) ? lastSelectedCodeObject : null;
    };

    const attachTextboxFrameBehavior = textbox => {
      const baseCalcTextHeight = textbox.calcTextHeight.bind(textbox);

      textbox.isPlaceholderText = false;
      textbox.autoFitText = textbox.autoFitText !== false;
      textbox.maxAutoFitFontSize = Number.isFinite(textbox.maxAutoFitFontSize)
        ? Math.max(8, Math.round(textbox.maxAutoFitFontSize))
        : Math.max(8, Math.round(textbox.fontSize || 8));
      textbox.frameWidth = Math.max(textbox.frameWidth || 0, textbox.width || 0);
      textbox.frameHeight = Math.max(textbox.frameHeight || 0, textbox.height || 0);
      textbox.measureTextHeight = () => baseCalcTextHeight();
      textbox.calcTextHeight = function () {
        return Math.max(baseCalcTextHeight(), this.frameHeight || 0);
      };
      textbox.splitByGrapheme = false;
      ensureTextboxSerialState(textbox);
      textbox.on('editing:exited', () => {
        ensureTextboxSerialState(textbox);
        textbox.serialTemplateText = String(textbox.text || '');
        refreshTextboxSerialPreview(textbox, { skipRender: true });
        syncTextControls(textbox);
        ensureCanvas().requestRenderAll();
      });
      textbox.width = textbox.frameWidth;
      textbox.initDimensions();
      textbox.setCoords();

      return textbox;
    };

    const applyTextboxPlaceholder = (textbox, placeholderText = DEFAULT_TEXTBOX_PLACEHOLDER) => {
      if (!(textbox instanceof window.fabric.Textbox)) return textbox;

      textbox.maxAutoFitFontSize = Math.max(8, Math.round(textbox.fontSize || 8));
      textbox.serialTemplateText = placeholderText;
      textbox.set('text', placeholderText);
      textbox.isPlaceholderText = true;
      textbox.initDimensions();
      textbox.setCoords();
      return textbox;
    };

    const buildTextbox = (canvasWidth, canvasHeight, overrides = {}) => attachTextboxFrameBehavior(applyBuilderObjectDefaults(new window.fabric.Textbox(Object.prototype.hasOwnProperty.call(overrides, 'text') ? overrides.text : '', {
      left: Math.round(canvasWidth * 0.08),
      top: Math.round(canvasHeight * 0.08),
      width: Math.round(canvasWidth * 0.76),
      fontSize: 35,
      fontFamily: 'Arial',
      fontWeight: '700',
      fill: '#111111',
      textAlign: 'center',
      editable: true,
      cursorColor: '#1f6f43',
      cursorWidth: 2,
      selectionColor: 'rgba(31, 111, 67, 0.2)',
      transparentCorners: false,
      cornerStyle: 'circle',
      cornerColor: '#1f6f43',
      borderColor: '#1f6f43',
      borderScaleFactor: 2,
      padding: 10,
      frameHeight: Math.max(56, Math.round(canvasHeight * 0.82)),
      ...overrides,
    })));

    const focusTextbox = textObject => {
      const builderCanvas = ensureCanvas();
      lastSelectedTextObject = textObject;
      builderCanvas.setActiveObject(textObject);
      syncTextControls(textObject);
      builderCanvas.requestRenderAll();
    };

    const focusObject = object => {
      const builderCanvas = ensureCanvas();
      if (object instanceof window.fabric.Textbox) lastSelectedTextObject = object;
      if (isCodeObject(object)) lastSelectedCodeObject = object;
      builderCanvas.setActiveObject(object);
      syncTextControls(object || null);
      builderCanvas.requestRenderAll();
    };

    const beginTextboxEditing = textObject => {
      if (!(textObject instanceof window.fabric.Textbox)) return;

      ensureTextboxSerialState(textObject);
      if (textObject.isPlaceholderText) {
        textObject.set('text', '');
        textObject.serialTemplateText = '';
        textObject.isPlaceholderText = false;
        textObject.initDimensions();
        textObject.setCoords();
      } else if (textObject.serialEnabled) {
        textObject.set('text', textObject.serialTemplateText);
        textObject.initDimensions();
        textObject.setCoords();
      }

      textObject.enterEditing();
      textObject.selectAll();
      syncTextControls(textObject);
      ensureCanvas().requestRenderAll();
    };

    const addTextbox = () => {
      const builderCanvas = ensureCanvas();
      const textboxCount = builderCanvas.getObjects().filter(object => object instanceof window.fabric.Textbox).length;
      const fontSize = Math.max(24, Math.round(builderCanvas.getHeight() * 0.18));
      const topStep = Math.max(34, Math.round(fontSize * 1.35));
      const textbox = buildTextbox(builderCanvas.getWidth(), builderCanvas.getHeight(), {
        text: '',
        top: Math.round(builderCanvas.getHeight() * 0.12) + (textboxCount * topStep),
        fontSize,
        frameHeight: Math.max(48, Math.round(builderCanvas.getHeight() * 0.34)),
        autoFitText: false,
      });

      builderCanvas.add(textbox);
      focusTextbox(textbox);
      beginTextboxEditing(textbox);
      refreshBuilderMeta();
      void syncAutoFitTapeCanvas();
    };

    const updateSelectedTextbox = updates => {
      const textObject = getTextboxForControls();
      if (!textObject) return;

      textObject.set(updates);
      textObject.isPlaceholderText = false;
      if (Object.prototype.hasOwnProperty.call(updates, 'fontSize')) {
        textObject.maxAutoFitFontSize = Math.max(8, Math.round(updates.fontSize || textObject.fontSize || 8));
      }
      textObject.frameWidth = Math.max(textObject.frameWidth || textObject.width || 0, 48);
      textObject.frameHeight = Math.max(textObject.frameHeight || 0, 32);
      textObject.width = textObject.frameWidth;
      if (textObject.autoFitText) fitTextboxFontToFrame(textObject);
      textObject.initDimensions();
      textObject.setCoords();
      syncTextControls(textObject);
      ensureCanvas().requestRenderAll();
      void syncAutoFitTapeCanvas();
    };

    const queueStateCommit = work => {
      pendingStateCommit = pendingStateCommit
        .catch(() => {})
        .then(() => work());
      return pendingStateCommit;
    };

    const readFileAsDataUrl = file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read the image file.'));
      reader.readAsDataURL(file);
    });

    const loadImageElement = source => new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not decode the image file.'));
      element.src = source;
    });

    const buildCodeSourceUrl = (codeText, codeFormat) => {
      const builderCanvas = ensureCanvas();
      const codeSize = Math.max(256, Math.round(Math.max(builderCanvas.getWidth(), builderCanvas.getHeight())));
      const codeUrl = new URL('/label-builder/code', window.location.origin);
      codeUrl.searchParams.set('text', codeText);
      codeUrl.searchParams.set('format', codeFormat || 'qrcode');
      codeUrl.searchParams.set('size', String(codeSize));
      return codeUrl.toString();
    };

    const fitObjectToCanvas = object => {
      const builderCanvas = ensureCanvas();
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

    const addImageFromFile = async file => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        settings.onError(new Error('Please choose an image file.'));
        return;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const imageElement = await loadImageElement(dataUrl);
        const FabricImageCtor = window.fabric.FabricImage || window.fabric.Image;
        const image = new FabricImageCtor(imageElement);
        applyBuilderObjectDefaults(image).set({
          printifyObjectType: 'image',
        });
        fitObjectToCanvas(image);
        ensureCanvas().add(image);
        focusObject(image);
        refreshBuilderMeta();
        void syncAutoFitTapeCanvas();
      } catch (error) {
        settings.onError(new Error('Could not load that image into the label builder.'));
      }
    };

    const buildCodeImage = async (codeText, codeFormat = 'qrcode', rawCodeText = '') => {
      const codeSourceUrl = buildCodeSourceUrl(codeText, codeFormat);
      const imageElement = await loadImageElement(codeSourceUrl);
      const FabricImageCtor = window.fabric.FabricImage || window.fabric.Image;
      const codeImage = new FabricImageCtor(imageElement);

      applyBuilderObjectDefaults(codeImage).set({
        codeText: rawCodeText,
        codeFormat,
        renderedCodeText: codeText,
        serialEnabled: false,
        serialCurrentValue: 1,
        printifyObjectType: 'code',
      });

      return codeImage;
    };

    const addQrCode = async () => {
      const builderCanvas = ensureCanvas();
      const defaultCodeText = resolveFallbackCodeText('qrcode');

      try {
        const codeImage = await buildCodeImage(defaultCodeText, 'qrcode', '');
        fitObjectToCanvas(codeImage);
        builderCanvas.add(codeImage);
        focusObject(codeImage);
        window.setTimeout(() => {
          if (!qrTextInput) return;
          qrTextInput.focus();
          qrTextInput.select();
        }, 0);
      } catch (error) {
        settings.onError(new Error('Could not generate a QR code for the label builder.'));
      }
    };

    const updateCodeObject = async (codeObject, nextCodeText, nextCodeFormat, options = {}) => {
      if (!isCodeObject(codeObject)) return;

      ensureCodeSerialState(codeObject);
      const normalizedFormat = nextCodeFormat || codeObject.codeFormat || 'qrcode';
      const normalizedText = String(nextCodeText || '').trim();
      const serialValue = normalizeSerialValue(Object.prototype.hasOwnProperty.call(options, 'serialCurrentValue')
        ? options.serialCurrentValue
        : codeObject.serialCurrentValue);
      const previewSerializedText = Boolean(options.useRenderedText);
      const renderedInputText = renderSerialText(
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
        if (!options.skipControlSync) syncTextControls(codeObject);
        ensureCanvas().requestRenderAll();
        return;
      }

      if (normalizedText && !compatibleText && options.skipIncompatibleInput) {
        codeObject.set('codeText', normalizedText);
        if (!options.skipControlSync) syncTextControls(codeObject);
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
        const nextImageElement = await loadImageElement(buildCodeSourceUrl(renderedText, normalizedFormat));

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
        if (!options.skipControlSync) syncTextControls(codeObject);
        ensureCanvas().requestRenderAll();
      } catch (error) {
        settings.onError(new Error('Could not update that code object.'));
      }
    };

    const updateSelectedCode = async (nextCodeText, nextCodeFormat, options = {}) => {
      const codeObject = getCodeObjectForControls();
      if (!codeObject) return;

      await updateCodeObject(codeObject, nextCodeText, nextCodeFormat, options);
    };

    const commitTextboxState = (textObject, options = {}) => {
      if (!(textObject instanceof window.fabric.Textbox)) return;

      ensureTextboxSerialState(textObject);

      if (typeof textObject.exitEditing === 'function' && textObject.isEditing && options.exitEditing) {
        textObject.exitEditing();
        return;
      }

      if (textObject.isEditing) {
        textObject.serialTemplateText = String(textObject.text || '');
        return;
      }

      refreshTextboxSerialPreview(textObject, {
        skipRender: options.skipRender,
        useRenderedText: options.useRenderedText,
      });
    };

    const applyTextboxSerialDigits = (textObject, digits, options = {}) => {
      if (!(textObject instanceof window.fabric.Textbox)) return;

      ensureTextboxSerialState(textObject);
      const nextTemplateText = replaceSerialTokenDigits(textObject.serialTemplateText || textObject.text || '', digits);
      textObject.serialTemplateText = nextTemplateText;

      if (textObject.isEditing) {
        textObject.set('text', nextTemplateText);
        textObject.initDimensions();
        textObject.setCoords();
        if (!options.skipRender) ensureCanvas().requestRenderAll();
        return;
      }

      refreshTextboxSerialPreview(textObject, {
        skipRender: options.skipRender,
      });
    };

    const commitCodeObjectState = async (codeObject, options = {}) => {
      if (!isCodeObject(codeObject)) return;

      ensureCodeSerialState(codeObject);
      window.clearTimeout(qrUpdateTimer);

      const nextCodeText = options.useControlValues !== false
        ? (qrTextInput?.value ?? codeObject.codeText ?? '')
        : (codeObject.codeText || '');
      const nextCodeFormat = options.useControlValues !== false
        ? (qrFormatSelect?.value || codeObject.codeFormat || 'qrcode')
        : (codeObject.codeFormat || 'qrcode');

      await updateCodeObject(codeObject, nextCodeText, nextCodeFormat, {
        preserveWhenBlank: true,
        skipIncompatibleInput: true,
        skipControlSync: options.skipControlSync,
        useRenderedText: options.useRenderedText,
      });
    };

    const commitObjectState = async (object, options = {}) => {
      if (object instanceof window.fabric.Textbox) {
        commitTextboxState(object, options);
        return;
      }

      if (isCodeObject(object)) {
        await commitCodeObjectState(object, options);
      }
    };

    const applyCodeSerialDigits = async (codeObject, digits) => {
      if (!isCodeObject(codeObject)) return;

      ensureCodeSerialState(codeObject);
      const nextCodeText = replaceSerialTokenDigits(codeObject.codeText || '', digits);
      await updateCodeObject(codeObject, nextCodeText, codeObject.codeFormat || 'qrcode', {
        preserveWhenBlank: true,
        skipIncompatibleInput: true,
      });
    };

    const fitSelectedImageToLabelHeight = () => {
      const builderCanvas = ensureCanvas();
      const imageObject = builderCanvas.getActiveObject();

      if (!isImageObject(imageObject)) return;

      const intrinsicWidth = imageObject.width || 1;
      const intrinsicHeight = imageObject.height || 1;
      const nextScale = builderCanvas.getHeight() / intrinsicHeight;
      const renderedWidth = intrinsicWidth * nextScale;

      imageObject.set({
        scaleX: nextScale,
        scaleY: nextScale,
        top: 0,
        left: Math.round((builderCanvas.getWidth() - renderedWidth) / 2),
      });
      imageObject.setCoords();
      builderCanvas.requestRenderAll();
      void syncAutoFitTapeCanvas();
    };

    const bakeTextboxScale = event => {
      const textObject = event?.target;

      if (!(textObject instanceof window.fabric.Textbox)) return;

      if (event.e?.shiftKey) {
        const nextFontSize = Math.max(8, Math.round(textObject.fontSize * Math.max(textObject.scaleX, textObject.scaleY)));

        textObject.set({
          fontSize: nextFontSize,
          autoFitText: false,
          scaleX: 1,
          scaleY: 1,
        });
        textObject.maxAutoFitFontSize = nextFontSize;
      } else {
        const nextWidth = Math.max(56, Math.round(textObject.width * textObject.scaleX));
        const nextHeight = Math.max(32, Math.round((textObject.frameHeight || textObject.height) * textObject.scaleY));

        textObject.set({
          frameWidth: nextWidth,
          width: nextWidth,
          frameHeight: nextHeight,
          scaleX: 1,
          scaleY: 1,
        });
        if (textObject.autoFitText) fitTextboxFontToFrame(textObject);
      }

      textObject.initDimensions();
      textObject.setCoords();
      syncTextControls(textObject);
      ensureCanvas().requestRenderAll();
    };

    const getSerialObjects = () => ensureCanvas().getObjects().filter(object => {
      ensureSerialState(object);
      return Boolean(object?.serialEnabled);
    });

    const applySerialPreviewForCopy = async copyOffset => {
      const builderCanvas = ensureCanvas();

      for (const object of builderCanvas.getObjects()) {
        if (object instanceof window.fabric.Textbox) {
          ensureTextboxSerialState(object);
          if (!object.serialEnabled) continue;

          object.serialCurrentValue = normalizeSerialValue(object.serialCurrentValue);
          refreshTextboxSerialPreview(object, {
            skipRender: true,
            useRenderedText: true,
          });
          object.set('text', renderSerialText(object.serialTemplateText, true, object.serialCurrentValue + copyOffset));
          object.width = object.frameWidth || object.width;
          if (object.autoFitText) {
            fitTextboxFontToFrame(object);
          } else {
            object.initDimensions();
          }
          object.setCoords();
          continue;
        }

        if (!isCodeObject(object) || !object.serialEnabled) continue;

        await updateCodeObject(object, object.codeText || '', object.codeFormat || 'qrcode', {
          preserveWhenBlank: true,
          serialCurrentValue: object.serialCurrentValue + copyOffset,
          skipControlSync: true,
          useRenderedText: true,
        });
      }

      builderCanvas.requestRenderAll();
    };

    const restoreSerialPreviewState = async () => {
      const builderCanvas = ensureCanvas();

      for (const object of builderCanvas.getObjects()) {
        if (object instanceof window.fabric.Textbox) {
          ensureTextboxSerialState(object);
          if (object.serialEnabled) {
            refreshTextboxSerialPreview(object, { skipRender: true });
          } else if (!object.isEditing) {
            object.set('text', object.serialTemplateText);
            object.width = object.frameWidth || object.width;
            if (object.autoFitText) {
              fitTextboxFontToFrame(object);
            } else {
              object.initDimensions();
            }
            object.setCoords();
          }
          continue;
        }

        if (!isCodeObject(object) || !object.serialEnabled) continue;

        await updateCodeObject(object, object.codeText || '', object.codeFormat || 'qrcode', {
          preserveWhenBlank: true,
          skipControlSync: true,
          useRenderedText: false,
        });
      }

      builderCanvas.requestRenderAll();
    };

    const advanceSerialObjects = copies => {
      getSerialObjects().forEach(object => {
        object.serialCurrentValue = normalizeSerialValue(object.serialCurrentValue) + copies;
      });
    };

    const startSerialPreview = async () => {
      if (isSerialPreviewActive) return;

      await pendingStateCommit.catch(() => {});
      await commitObjectState(ensureCanvas().getActiveObject(), {
        exitEditing: true,
        skipControlSync: true,
      });

      isSerialPreviewActive = true;
      syncPreviewButton();
      await applySerialPreviewForCopy(0);
    };

    const stopSerialPreview = async () => {
      if (!isSerialPreviewActive) return;

      isSerialPreviewActive = false;
      syncPreviewButton();
      await restoreSerialPreviewState();
      syncTextControls(ensureCanvas().getActiveObject() || null);
    };

    const buildBackendPreviewLabelFile = async () => {
      const shouldRenderSerialState = !isSerialPreviewActive && getSerialObjects().length > 0;
      return withCanvasExportState(async () => {
        if (shouldRenderSerialState) {
          await applySerialPreviewForCopy(0);
        }

        try {
          return await buildCanvasLabelFile();
        } finally {
          if (shouldRenderSerialState) {
            await restoreSerialPreviewState();
          }
        }
      });
    };

    const requestMonochromePreview = async file => {
      const formData = new FormData();
      formData.append('imgFile', file, file.name);

      const response = await fetch(`/printers/${encodeURIComponent(currentPrinter.id)}/preview/monochrome`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Preview failed for ${currentPrinter.displayName}`);
      }

      return response.blob();
    };

    const startMonochromePreview = async () => {
      if (!currentPrinter?.monochrome || isMonochromePreviewActive) return;

      const requestId = monochromePreviewRequestId + 1;
      monochromePreviewRequestId = requestId;
      isMonochromePreviewActive = true;
      syncPreviewButton();

      try {
        const previewFile = await buildBackendPreviewLabelFile();
        const previewBlob = await requestMonochromePreview(previewFile);

        if (!isMonochromePreviewActive || monochromePreviewRequestId !== requestId) {
          return;
        }

        showMonochromePreview(previewBlob);
      } catch (error) {
        if (isMonochromePreviewActive && monochromePreviewRequestId === requestId) {
          await stopMonochromePreview();
          settings.onError(new Error('Could not prepare the backend monochrome preview.'));
        }
      }
    };

    const stopMonochromePreview = async () => {
      if (!isMonochromePreviewActive && monochromePreviewShell?.hidden !== false) return;

      monochromePreviewRequestId += 1;
      isMonochromePreviewActive = false;
      hideMonochromePreview();
      syncPreviewButton();
    };

    const withCanvasExportState = async callback => {
      const builderCanvas = ensureCanvas();
      const activeObject = builderCanvas.getActiveObject();
      const objectControls = builderCanvas.getObjects().map(object => ({
        object,
        hasBorders: object.hasBorders,
        hasControls: object.hasControls,
      }));

      await pendingStateCommit.catch(() => {});
      await commitObjectState(activeObject, {
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
        syncTextControls(builderCanvas.getActiveObject() || null);
        builderCanvas.requestRenderAll();
      }
    };

    const buildCanvasLabelFile = async (copyIndex = null) => {
      const builderCanvas = ensureCanvas();
      builderCanvas.renderAll();
      const exportWidth = isTapePrinter(currentPrinter)
        ? (mmToPixels(getTapeExportLengthMm(currentPrinter), currentPrinter?.density) || builderCanvas.getWidth())
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

    const resetCanvas = printer => {
      const builderCanvas = ensureCanvas();
      const { width, height } = getPrinterCanvasMetrics(printer);
      isSerialPreviewActive = false;
      isMonochromePreviewActive = false;
      hideMonochromePreview();

      builderCanvas.clear();
      builderCanvas.setDimensions({ width, height });
      builderCanvas.backgroundColor = '#ffffff';

      defaultTextbox = applyTextboxPlaceholder(buildTextbox(width, height));
      lastSelectedTextObject = defaultTextbox;
      lastSelectedCodeObject = null;
      builderCanvas.add(defaultTextbox);
      focusTextbox(defaultTextbox);
      updateCanvasControlAppearance();
      builderCanvas.requestRenderAll();
      applyCanvasViewportScale();
      syncTapeControls(printer);

      refreshBuilderMeta();
      if (copy) {
        copy.textContent = isTapePrinter(printer)
          ? `Build a tape label for ${printer.displayName}. Tape width sets label height, and length can expand to fit the content.`
          : `Build a label sized for ${printer.displayName}, then send it through the standard image print flow.`;
      }
      clearEnterPrintPrompt();
      syncPreviewButton();
    };

    const restoreBuilderSession = printer => {
      const builderCanvas = ensureCanvas();
      const { width, height } = getPrinterCanvasMetrics(printer);

      builderCanvas.setDimensions({ width, height });
      builderCanvas.backgroundColor = '#ffffff';
      builderCanvas.getObjects().forEach(applyBuilderObjectDefaults);
      updateCanvasControlAppearance();
      applyCanvasViewportScale();
      syncTapeControls(printer);

      refreshBuilderMeta();
      if (copy) {
        copy.textContent = isTapePrinter(printer)
          ? `Build a tape label for ${printer.displayName}. Tape width sets label height, and length can expand to fit the content.`
          : `Build a label sized for ${printer.displayName}, then send it through the standard image print flow.`;
      }
      clearEnterPrintPrompt();
      syncPreviewButton();
      builderCanvas.requestRenderAll();
      syncTextControls(builderCanvas.getActiveObject() || null);
    };

    const close = () => {
      clearEnterPrintPrompt();
      isSerialPreviewActive = false;
      void stopMonochromePreview();
      syncPreviewButton();
      window.clearTimeout(closeAnimationTimer);
      if (openAnimationFrame) {
        window.cancelAnimationFrame(openAnimationFrame);
        openAnimationFrame = null;
      }
      root.classList.remove('is-open');
      root.classList.add('is-closing');
      closeAnimationTimer = window.setTimeout(() => {
        root.classList.remove('is-mounted', 'is-closing');
      }, BUILDER_MODAL_CLOSE_MS);
    };

    const open = printer => {
      currentPrinter = printer;
      if (!currentPrinter) return;
      isMonochromePreviewActive = false;
      hideMonochromePreview();
      const nextPrinterKey = getPrinterStateKey(currentPrinter);
      const isRestoringSamePrinter = lastBuilderStatePrinterKey && lastBuilderStatePrinterKey === nextPrinterKey && ensureCanvas().getObjects().length > 0;

      if (!isRestoringSamePrinter) {
        currentTapeWidthMm = isTapePrinter(printer) ? getResolvedDefaultTapeWidth(printer) : null;
        currentTapeLengthMm = DEFAULT_TAPE_LENGTH_MM;
        tapeMinimumLengthMm = DEFAULT_TAPE_LENGTH_MM;
        tapeAutoLengthEnabled = true;
      }

      if (title) title.textContent = `${printer.displayName} Builder`;

      window.clearTimeout(closeAnimationTimer);
      root.classList.remove('is-closing');
      root.classList.add('is-mounted');
      if (isRestoringSamePrinter) {
        restoreBuilderSession(printer);
      } else {
        if (copiesInput) copiesInput.value = '1';
        resetCanvas(printer);
        lastBuilderStatePrinterKey = nextPrinterKey;
      }
      syncPreviewButton();
      openAnimationFrame = window.requestAnimationFrame(() => {
        applyCanvasViewportScale();
        openAnimationFrame = window.requestAnimationFrame(() => {
          root.classList.add('is-open');
          openAnimationFrame = null;
        });
      });
    };

    const print = async () => {
      if (!currentPrinter) return;
      clearEnterPrintPrompt();
      if (isSerialPreviewActive) await stopSerialPreview();
      if (isMonochromePreviewActive) await stopMonochromePreview();

      const copies = Math.max(1, Number.parseInt(copiesInput?.value || '1', 10) || 1);
      const hasSerialObjects = getSerialObjects().length > 0;

      try {
        await withCanvasExportState(async () => {
          let files = [];
          let requestedPrintCount = copies;

          if (hasSerialObjects) {
            requestedPrintCount = 1;
            for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
              await applySerialPreviewForCopy(copyIndex);
              files.push(await buildCanvasLabelFile(copyIndex));
            }
          } else {
            files = [await buildCanvasLabelFile()];
          }

          await settings.onPrint(currentPrinter, files, {
            printCount: requestedPrintCount,
            tapeWidthMm: isTapePrinter(currentPrinter) ? currentTapeWidthMm : null,
            lengthMm: isTapePrinter(currentPrinter) ? getTapeExportLengthMm(currentPrinter) : null,
          });

          if (hasSerialObjects) {
            advanceSerialObjects(copies);
          }
          await restoreSerialPreviewState();
        });

        if (settings.closeOnPrint) close();
      } catch (error) {
        await restoreSerialPreviewState();
        settings.onError(error);
      }
    };

    const deleteActiveObject = () => {
      const builderCanvas = ensureCanvas();
      const activeObject = builderCanvas.getActiveObject();

      if (!activeObject) return false;
      if (activeObject instanceof window.fabric.ActiveSelection) {
        activeObject.getObjects().forEach(object => builderCanvas.remove(object));
      } else {
        if (activeObject === lastSelectedTextObject) lastSelectedTextObject = null;
        if (activeObject === lastSelectedCodeObject) lastSelectedCodeObject = null;
        builderCanvas.remove(activeObject);
      }

      builderCanvas.discardActiveObject();
      syncTextControls(null);
      builderCanvas.requestRenderAll();
      refreshBuilderMeta();
      return true;
    };

    const nudgeActiveObject = key => {
      const builderCanvas = ensureCanvas();
      const activeObject = builderCanvas.getActiveObject();

      if (!activeObject) return false;

      const delta = {
        ArrowUp: { left: 0, top: -1 },
        ArrowDown: { left: 0, top: 1 },
        ArrowLeft: { left: -1, top: 0 },
        ArrowRight: { left: 1, top: 0 },
      }[key];

      if (!delta) return false;

      const applyDelta = object => {
        object.set({
          left: Math.round((object.left || 0) + delta.left),
          top: Math.round((object.top || 0) + delta.top),
        });
        object.setCoords();
      };

      if (activeObject instanceof window.fabric.ActiveSelection) {
        activeObject.getObjects().forEach(applyDelta);
        activeObject.setCoords();
      } else {
        applyDelta(activeObject);
      }

      builderCanvas.requestRenderAll();
      refreshBuilderMeta();
      void syncAutoFitTapeCanvas();
      return true;
    };

    const bindCanvasEvents = () => {
      const builderCanvas = ensureCanvas();

      builderCanvas.on('selection:created', event => {
        syncTextControls(event.selected?.[0] || null);
        void syncAutoFitTapeCanvas();
      });

      builderCanvas.on('selection:updated', event => {
        for (const object of event.deselected || []) {
          queueStateCommit(() => commitObjectState(object, {
            skipControlSync: true,
            skipRender: true,
            useControlValues: false,
          }));
        }
        syncTextControls(event.selected?.[0] || null);
        void syncAutoFitTapeCanvas();
      });

      builderCanvas.on('selection:cleared', event => {
        for (const object of event.deselected || []) {
          queueStateCommit(() => commitObjectState(object, {
            skipControlSync: true,
            skipRender: true,
            useControlValues: false,
          }));
        }
        syncTextControls(null);
        void syncAutoFitTapeCanvas();
      });

      builderCanvas.on('text:changed', event => {
        if (event.target instanceof window.fabric.Textbox) {
          ensureTextboxSerialState(event.target);
          event.target.serialTemplateText = String(event.target.text || '');
          event.target.isPlaceholderText = false;
          event.target.width = event.target.frameWidth || event.target.width;
          if (event.target.autoFitText) fitTextboxFontToFrame(event.target);
        }
        syncTextControls(event.target || null);
        refreshBuilderMeta();
        void syncAutoFitTapeCanvas();
      });

      builderCanvas.on('mouse:down', event => {
        if (!(event.target instanceof window.fabric.Textbox)) return;
        if (!event.target.isPlaceholderText) return;
        builderCanvas.setActiveObject(event.target);
        beginTextboxEditing(event.target);
      });

      builderCanvas.on('object:modified', event => {
        bakeTextboxScale(event);
        refreshBuilderMeta();
        void syncAutoFitTapeCanvas();
      });

      builderCanvas.on('object:rotating', event => {
        if (!event.target) return;
        applyBuilderObjectDefaults(event.target);
      });

      builderCanvas.on('mouse:dblclick', event => {
        if (!(event.target instanceof window.fabric.Textbox)) return;
        builderCanvas.setActiveObject(event.target);
        beginTextboxEditing(event.target);
      });
    };

    bindCanvasEvents();
    syncPreviewButton();

    fontSelect?.addEventListener('change', () => {
      if (isSyncingFontInput) return;
      updateSelectedTextbox({
        fontFamily: fontSelect.value || 'Arial',
      });
    });

    fontSizeInput?.addEventListener('input', () => {
      if (isSyncingFontSizeInput) return;

      const parsedValue = Number.parseInt(fontSizeInput.value || '', 10);
      if (!Number.isFinite(parsedValue)) return;

      if (autoFitInput) autoFitInput.checked = false;
      updateSelectedTextbox({
        fontSize: Math.max(8, parsedValue),
        autoFitText: false,
      });
    });

    autoFitInput?.addEventListener('change', () => {
      if (isSyncingAutoFitInput) return;

      const textObject = getTextboxForControls();
      if (!textObject) return;

      textObject.set('autoFitText', autoFitInput.checked);
      if (textObject.autoFitText) fitTextboxFontToFrame(textObject);
      textObject.initDimensions();
      textObject.setCoords();
      syncTextControls(textObject);
      ensureCanvas().requestRenderAll();
    });

    textSerialEnabledInput?.addEventListener('change', () => {
      if (isSyncingTextSerialInput) return;

      const textObject = getTextboxForControls();
      if (!textObject) return;

      ensureTextboxSerialState(textObject);
      textObject.serialTemplateText = textObject.isEditing ? String(textObject.text || '') : String(textObject.serialTemplateText || textObject.text || '');
      textObject.serialEnabled = textSerialEnabledInput.checked;

      if (textObject.serialEnabled) {
        textObject.serialCurrentValue = lastSerialValue;
        if (!/\{x+\}/i.test(textObject.serialTemplateText || '')) {
          const nextTemplateText = appendSerialToken(
            textObject.serialTemplateText,
            lastSerialDigits
          );
          textObject.serialTemplateText = nextTemplateText;
          if (textObject.isEditing) {
            textObject.set('text', nextTemplateText);
            textObject.initDimensions();
            textObject.setCoords();
          }
        } else {
          textObject.serialTemplateText = replaceSerialTokenDigits(textObject.serialTemplateText, lastSerialDigits);
        }
      } else {
        const nextTemplateText = removeSerialTokens(textObject.serialTemplateText);
        textObject.serialTemplateText = nextTemplateText;
        if (textObject.isEditing) {
          textObject.set('text', nextTemplateText);
          textObject.initDimensions();
          textObject.setCoords();
        }
      }

      refreshTextboxSerialPreview(textObject);
      syncTextControls(textObject);
    });

    textSerialValueInput?.addEventListener('input', () => {
      if (isSyncingTextSerialInput) return;

      const textObject = getEditableTextObject();
      if (!textObject) return;

      ensureTextboxSerialState(textObject);
      textObject.serialCurrentValue = normalizeSerialValue(textSerialValueInput.value);
      rememberSerialSettings(textObject.serialCurrentValue, textSerialDigitsInput?.value);
      refreshTextboxSerialPreview(textObject);
      syncTextControls(textObject);
    });
    textSerialDigitsInput?.addEventListener('input', () => {
      if (isSyncingTextSerialInput) return;

      const textObject = getTextboxForControls();
      if (!textObject) return;

      rememberSerialSettings(textObject.serialCurrentValue, textSerialDigitsInput.value);
      applyTextboxSerialDigits(textObject, textSerialDigitsInput.value);
      syncTextControls(textObject);
    });

    addImageButton?.addEventListener('click', () => {
      imageInput?.click();
    });
    imageInput?.addEventListener('change', async () => {
      const [file] = Array.from(imageInput.files || []);
      await addImageFromFile(file);
      imageInput.value = '';
    });

    addTextButton?.addEventListener('click', addTextbox);
    addQrButton?.addEventListener('click', addQrCode);
    fitImageHeightButton?.addEventListener('click', fitSelectedImageToLabelHeight);
    alignLeftButton?.addEventListener('click', () => updateSelectedTextbox({ textAlign: 'left' }));
    alignCenterButton?.addEventListener('click', () => updateSelectedTextbox({ textAlign: 'center' }));
    alignRightButton?.addEventListener('click', () => updateSelectedTextbox({ textAlign: 'right' }));
    tapeWidthSelect?.addEventListener('change', async () => {
      if (!currentPrinter || !isTapePrinter(currentPrinter)) return;

      const nextTapeWidthMm = Number.parseInt(tapeWidthSelect.value, 10);
      if (!Number.isFinite(nextTapeWidthMm)) return;

      currentTapeWidthMm = nextTapeWidthMm;
      await applyTapeCanvasSize(currentPrinter);
    });
    tapeLengthInput?.addEventListener('input', async () => {
      if (!currentPrinter || !isTapePrinter(currentPrinter)) return;

      tapeMinimumLengthMm = normalizeTapeLengthMm(tapeLengthInput.value);
      currentTapeLengthMm = tapeAutoLengthEnabled
        ? Math.max(tapeMinimumLengthMm, getRequiredTapeLengthMm(currentPrinter))
        : tapeMinimumLengthMm;
      refreshBuilderMeta();
      await applyTapeCanvasSize(currentPrinter);
    });
    tapeAutoLengthInput?.addEventListener('change', () => {
      if (!currentPrinter || !isTapePrinter(currentPrinter)) return;

      tapeAutoLengthEnabled = Boolean(tapeAutoLengthInput.checked);
      currentTapeLengthMm = tapeAutoLengthEnabled
        ? Math.max(tapeMinimumLengthMm, getRequiredTapeLengthMm(currentPrinter))
        : tapeMinimumLengthMm;
      refreshBuilderMeta();
      void syncAutoFitTapeCanvas();
    });
    qrTextInput?.addEventListener('input', () => {
      if (isSyncingQrInput) return;

      const codeObject = getCodeObjectForControls();
      if (!codeObject) return;

      window.clearTimeout(qrUpdateTimer);
      qrUpdateTimer = window.setTimeout(() => {
        updateSelectedCode(qrTextInput.value || '', qrFormatSelect?.value || codeObject.codeFormat, {
          preserveWhenBlank: true,
          skipIncompatibleInput: true,
        });
      }, 500);
    });
    qrFormatSelect?.addEventListener('change', () => {
      if (isSyncingQrInput) return;

      const codeObject = getCodeObjectForControls();
      if (!codeObject) return;

      updateSelectedCode(qrTextInput?.value || codeObject.codeText || '', qrFormatSelect.value || 'qrcode');
    });
    codeSerialEnabledInput?.addEventListener('change', () => {
      if (isSyncingCodeSerialInput) return;

      const codeObject = getCodeObjectForControls();
      if (!codeObject) return;

      ensureCodeSerialState(codeObject);
      codeObject.serialEnabled = codeSerialEnabledInput.checked;
      codeObject.serialCurrentValue = codeObject.serialEnabled ? lastSerialValue : normalizeSerialValue(codeObject.serialCurrentValue);

      const nextCodeText = codeObject.serialEnabled
        ? appendSerialToken(codeObject.codeText || '', lastSerialDigits)
        : removeSerialTokens(codeObject.codeText || '');

      updateCodeObject(codeObject, nextCodeText, codeObject.codeFormat || 'qrcode', {
        preserveWhenBlank: true,
      });
    });
    codeSerialValueInput?.addEventListener('input', () => {
      if (isSyncingCodeSerialInput) return;

      const codeObject = getCodeObjectForControls();
      if (!codeObject) return;

      ensureCodeSerialState(codeObject);
      codeObject.serialCurrentValue = normalizeSerialValue(codeSerialValueInput.value);
      rememberSerialSettings(codeObject.serialCurrentValue, codeSerialDigitsInput?.value);
      updateCodeObject(codeObject, codeObject.codeText || '', codeObject.codeFormat || 'qrcode', {
        preserveWhenBlank: true,
      });
    });
    codeSerialDigitsInput?.addEventListener('input', () => {
      if (isSyncingCodeSerialInput) return;

      const codeObject = getCodeObjectForControls();
      if (!codeObject) return;

      rememberSerialSettings(codeObject.serialCurrentValue, codeSerialDigitsInput.value);
      applyCodeSerialDigits(codeObject, codeSerialDigitsInput.value);
    });

    canvasShell?.addEventListener('dragenter', event => {
      event.preventDefault();
      canvasShell.classList.add('is-drop-target');
    });
    canvasShell?.addEventListener('dragover', event => {
      event.preventDefault();
      canvasShell.classList.add('is-drop-target');
    });
    canvasShell?.addEventListener('dragleave', event => {
      if (event.target === canvasShell) {
        canvasShell.classList.remove('is-drop-target');
      }
    });
    canvasShell?.addEventListener('drop', async event => {
      event.preventDefault();
      canvasShell.classList.remove('is-drop-target');
      const [file] = Array.from(event.dataTransfer?.files || []);
      await addImageFromFile(file);
    });

    closeButton?.addEventListener('click', close);
    cancelButton?.addEventListener('click', close);
    resetButton?.addEventListener('click', () => {
      clearEnterPrintPrompt();
      void stopMonochromePreview();
      if (currentPrinter) {
        currentTapeWidthMm = isTapePrinter(currentPrinter) ? getResolvedDefaultTapeWidth(currentPrinter) : null;
        currentTapeLengthMm = DEFAULT_TAPE_LENGTH_MM;
        tapeMinimumLengthMm = DEFAULT_TAPE_LENGTH_MM;
        tapeAutoLengthEnabled = true;
        resetCanvas(currentPrinter);
        lastBuilderStatePrinterKey = getPrinterStateKey(currentPrinter);
      }
    });
    printButton?.addEventListener('click', print);
    previewButtons.forEach(previewButton => {
      previewButton.addEventListener('pointerdown', async event => {
        event.preventDefault();
        await startSerialPreview();
      });
      previewButton.addEventListener('keydown', async event => {
        if (event.repeat) return;
        if (event.key !== ' ' && event.key !== 'Enter') return;

        event.preventDefault();
        await startSerialPreview();
      });
      previewButton.addEventListener('keyup', async event => {
        if (event.key !== ' ' && event.key !== 'Enter') return;

        event.preventDefault();
        await stopSerialPreview();
      });
      previewButton.addEventListener('blur', async () => {
        await stopSerialPreview();
      });
    });
    monochromePreviewButton?.addEventListener('pointerdown', async event => {
      event.preventDefault();
      await startMonochromePreview();
    });
    monochromePreviewButton?.addEventListener('keydown', async event => {
      if (event.repeat) return;
      if (event.key !== ' ' && event.key !== 'Enter') return;

      event.preventDefault();
      await startMonochromePreview();
    });
    monochromePreviewButton?.addEventListener('keyup', async event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;

      event.preventDefault();
      await stopMonochromePreview();
    });
    monochromePreviewButton?.addEventListener('blur', async () => {
      await stopMonochromePreview();
    });
    window.addEventListener('pointerup', async () => {
      await stopSerialPreview();
      await stopMonochromePreview();
    });
    window.addEventListener('pointercancel', async () => {
      await stopSerialPreview();
      await stopMonochromePreview();
    });
    window.addEventListener('blur', async () => {
      await stopSerialPreview();
      await stopMonochromePreview();
    });
    window.addEventListener('resize', () => {
      if (!root.classList.contains('is-open')) return;
      applyCanvasViewportScale();
    });
    window.visualViewport?.addEventListener('resize', () => {
      if (!root.classList.contains('is-open')) return;
      applyCanvasViewportScale();
    });
    document.addEventListener('keydown', event => {
      if (!root.classList.contains('is-open')) return;

      const activeTextbox = getEditableTextObject();
      const isEditingTextbox = Boolean(activeTextbox?.isEditing);
      const isTypingIntoField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

      if (event.key === 'Escape') {
        if (enterPrintArmed) {
          clearEnterPrintPrompt();
          return;
        }
        close();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isEditingTextbox || isTypingIntoField) return;

        event.preventDefault();

        if (enterPrintArmed) {
          print();
          return;
        }

        showEnterPrintPrompt();
        return;
      }

      clearEnterPrintPrompt();

      if (isArrowNudgeKey(event.key) && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditingTextbox && !isTypingIntoField) {
        if (nudgeActiveObject(event.key)) {
          event.preventDefault();
        }
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !isEditingTextbox && !isTypingIntoField) {
        if (deleteActiveObject()) {
          event.preventDefault();
        }
      }
    });

    return {
      open,
      close,
    };
  }

  window.createPrintifyLabelBuilder = createPrintifyLabelBuilder;
}());
