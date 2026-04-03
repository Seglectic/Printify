(function () {
  // ╭──────────────────────────╮
  // │  Shared builder state    │
  // ╰──────────────────────────╯
  const DEFAULT_CANVAS_SIZE = {
    width: 425,
    height: 200,
  };

  const parsePxSize = pxSize => {
    const match = String(pxSize || '').match(/^(\d+)x(\d+)$/i);

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
      closeSelector: '#labelBuilderClose',
      cancelSelector: '#labelBuilderCancel',
      resetSelector: '#labelBuilderReset',
      printSelector: '#labelBuilderPrint',
      copiesSelector: '#labelBuilderCopies',
      canvasId: 'labelCanvas',
      onPrint: async () => {},
      onError: () => {},
    }, options || {});

    const root = document.querySelector(settings.rootSelector);
    const title = document.querySelector(settings.titleSelector);
    const copy = document.querySelector(settings.copySelector);
    const size = document.querySelector(settings.sizeSelector);
    const closeButton = document.querySelector(settings.closeSelector);
    const cancelButton = document.querySelector(settings.cancelSelector);
    const resetButton = document.querySelector(settings.resetSelector);
    const printButton = document.querySelector(settings.printSelector);
    const copiesInput = document.querySelector(settings.copiesSelector);

    if (!root || !window.fabric) return null;

    let currentPrinter = null;
    let canvas = null;
    let defaultTextbox = null;

    const ensureCanvas = () => {
      if (canvas) return canvas;

      canvas = new window.fabric.Canvas(settings.canvasId, {
        preserveObjectStacking: true,
        backgroundColor: '#ffffff',
      });

      return canvas;
    };

    const buildDefaultTextbox = (canvasWidth, canvasHeight) => new window.fabric.Textbox('Click to Edit Text', {
      left: Math.round(canvasWidth * 0.12),
      top: Math.round(canvasHeight * 0.38),
      width: Math.round(canvasWidth * 0.76),
      fontSize: Math.max(24, Math.round(canvasHeight * 0.16)),
      fontFamily: 'Arial',
      fill: '#111111',
      backgroundColor: '#eef4ef',
      textAlign: 'center',
      editable: true,
      transparentCorners: false,
      cornerStyle: 'circle',
      cornerColor: '#1f6f43',
      borderColor: '#1f6f43',
      borderScaleFactor: 2,
      padding: 8,
    });

    const resetCanvas = printer => {
      const builderCanvas = ensureCanvas();
      const { width, height } = parsePxSize(printer?.pxSize);

      builderCanvas.clear();
      builderCanvas.setDimensions({ width, height });
      builderCanvas.backgroundColor = '#ffffff';

      defaultTextbox = buildDefaultTextbox(width, height);
      builderCanvas.add(defaultTextbox);
      builderCanvas.setActiveObject(defaultTextbox);
      defaultTextbox.enterEditing();
      defaultTextbox.selectAll();
      builderCanvas.requestRenderAll();

      if (size) size.textContent = `${width} x ${height} px`;
      if (copy) copy.textContent = `Build a label sized for ${printer.displayName}, then send it through the standard image print flow.`;
    };

    const close = () => {
      root.classList.remove('is-open');
    };

    const open = printer => {
      currentPrinter = printer;
      if (!currentPrinter) return;

      if (title) title.textContent = `${printer.displayName} Builder`;
      if (copiesInput) copiesInput.value = '1';

      resetCanvas(printer);
      root.classList.add('is-open');
    };

    const print = async () => {
      if (!currentPrinter) return;

      const builderCanvas = ensureCanvas();
      builderCanvas.discardActiveObject();
      builderCanvas.requestRenderAll();

      const copies = Math.max(1, Number.parseInt(copiesInput?.value || '1', 10) || 1);

      builderCanvas.getElement().toBlob(async blob => {
        try {
          if (!blob) throw new Error('Could not render the label canvas.');

          const labelFile = new File([blob], 'label.png', { type: 'image/png' });
          await settings.onPrint(currentPrinter, [labelFile], {
            printCount: copies,
          });
          close();
        } catch (error) {
          settings.onError(error);
        }
      });
    };

    closeButton?.addEventListener('click', close);
    cancelButton?.addEventListener('click', close);
    resetButton?.addEventListener('click', () => {
      if (currentPrinter) resetCanvas(currentPrinter);
    });
    printButton?.addEventListener('click', print);
    root.addEventListener('click', event => {
      if (event.target === root) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && root.classList.contains('is-open')) close();
    });

    return {
      open,
      close,
    };
  }

  window.createPrintifyLabelBuilder = createPrintifyLabelBuilder;
}());
