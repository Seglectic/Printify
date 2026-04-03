(function () {
  // ╭──────────────────────────╮
  // │  Shared constants        │
  // ╰──────────────────────────╯
  const APP_VERSION = '2.0.0';
  const PRINTIFY_LOG_ROUTE = '#printifyLogDrawer';
  const PRINTIFY_FILE_KINDS = {
    pdf: {
      fieldName: 'pdfFile',
      label: 'PDF',
    },
    image: {
      fieldName: 'imgFile',
      label: 'Image',
    },
    zip: {
      fieldName: 'zipFile',
      label: 'ZIP',
    },
  };
  const ZIP_MIME_TYPES = new Set([
    'application/zip',
    'application/x-zip',
    'application/x-zip-compressed',
    'application/octet-stream',
  ]);
  const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp']);
  const ZIP_EXTENSIONS = new Set(['zip']);

  const appState = {
    printers: [],
    pageHits: 0,
    printCounter: 0,
    serverVersion: 'Unknown',
    feedbackTimer: null,
    labelPrinterId: null,
    labelCanvas: null,
    labelAgent: null,
  };

  const printerGrid = document.getElementById('printerGrid');
  const footer = document.getElementById('footer');
  const pageHitsValue = document.getElementById('pageHitsValue');
  const printCounterValue = document.getElementById('printCounterValue');
  const printerCountValue = document.getElementById('printerCountValue');
  const feedback = document.getElementById('feedback');
  const builder = document.getElementById('labelBuilder');
  const builderTitle = document.getElementById('labelBuilderTitle');
  const builderClose = document.getElementById('labelBuilderClose');
  const builderCancel = document.getElementById('labelBuilderCancel');
  const builderPrint = document.getElementById('labelBuilderPrint');
  const builderCopies = document.getElementById('labelBuilderCopies');
  const confirmLayer = document.getElementById('confirmLayer');
  const confirmVideo = document.getElementById('confirmVideo');

  // ╭──────────────────────────╮
  // │  Formatting helpers      │
  // ╰──────────────────────────╯
  const typeWrite = (element, text, speed) => {
    for (let index = 0; index < text.length; index += 1) {
      window.setTimeout(() => {
        element.textContent += text.charAt(index);
      }, speed * index);
    }
  };

  const getFileExtension = fileName => {
    const segments = String(fileName || '').toLowerCase().split('.');
    return segments.length > 1 ? segments.pop() : '';
  };

  const prettyPrinterKinds = acceptedKinds => (
    acceptedKinds.map(kind => PRINTIFY_FILE_KINDS[kind]?.label || kind.toUpperCase())
  );

  const getPrinterById = printerId => appState.printers.find(printer => printer.id === printerId);

  const showFeedback = message => {
    feedback.textContent = message;
    feedback.classList.add('is-visible');

    if (appState.feedbackTimer) window.clearTimeout(appState.feedbackTimer);
    appState.feedbackTimer = window.setTimeout(() => {
      feedback.classList.remove('is-visible');
    }, 2400);
  };

  const showConfirm = message => {
    showFeedback(message);

    if (!confirmVideo) return;

    confirmLayer.classList.add('is-visible');
    confirmVideo.currentTime = 0;
    confirmVideo.playbackRate = 2;
    confirmVideo.play().catch(() => {});

    window.setTimeout(() => {
      confirmLayer.classList.remove('is-visible');
    }, 700);

    if (appState.labelAgent && typeof appState.labelAgent.speak === 'function') {
      appState.labelAgent.speak(message);
    }
  };

  // ╭──────────────────────────╮
  // │  Server bootstrap        │
  // ╰──────────────────────────╯
  const loadVersion = () => fetch('/version')
    .then(response => response.json())
    .then(serverData => {
      appState.serverVersion = serverData.version;
      appState.pageHits = serverData.pageHits;
      appState.printCounter = serverData.printCounter;
      pageHitsValue.textContent = String(serverData.pageHits);
      printCounterValue.textContent = String(serverData.printCounter);
      typeWrite(footer, `Client v${APP_VERSION}`, 40);
      window.setTimeout(() => {
        typeWrite(footer, ` | Server v${serverData.version}`, 40);
      }, 1200);
    });

  const loadPrinters = () => fetch('/printers')
    .then(response => response.json())
    .then(payload => {
      appState.printers = payload.printers || [];
      printerCountValue.textContent = String(appState.printers.length);
      renderPrinters(appState.printers);
    });

  // ╭──────────────────────────╮
  // │  Printer rendering       │
  // ╰──────────────────────────╯
  const buildPrinterDescription = printer => {
    if (printer.enableLabelBuilder) {
      return 'Drop image files, choose them from disk, or open the built-in label canvas for quick edits and bundled Dymo output.';
    }

    return `Accepts ${prettyPrinterKinds(printer.acceptedKinds).join(', ')} uploads from the shared browser queue.`;
  };

  const buildAcceptValue = acceptedKinds => {
    const accepts = [];

    if (acceptedKinds.includes('pdf')) accepts.push('.pdf,application/pdf');
    if (acceptedKinds.includes('image')) accepts.push('image/png,image/jpeg,image/jpg,image/tiff,image/webp,.png,.jpg,.jpeg,.tif,.tiff,.webp');
    if (acceptedKinds.includes('zip')) accepts.push('.zip,application/zip,application/x-zip,application/x-zip-compressed,application/octet-stream');

    return accepts.join(',');
  };

  const renderPrinters = printers => {
    if (!printers.length) {
      printerGrid.innerHTML = '<article class="printer-card"><p class="printer-card__copy">No printers are configured on the server.</p></article>';
      return;
    }

    printerGrid.innerHTML = printers.map(printer => `
      <article class="printer-card" data-printer-id="${printer.id}">
        <header class="printer-card__header">
          <img class="printer-card__icon" src="${printer.iconUrl || '/favicon.ico'}" alt="${printer.displayName}">
          <div>
            <h2 class="printer-card__title">${printer.displayName}</h2>
            <p class="printer-card__driver">${printer.driverName}</p>
          </div>
        </header>
        <p class="printer-card__copy">${buildPrinterDescription(printer)}</p>
        <ul class="printer-card__kinds">
          ${prettyPrinterKinds(printer.acceptedKinds).map(kind => `<li class="printer-card__kind">${kind}</li>`).join('')}
        </ul>
        <div class="printer-card__drop" data-role="dropzone" data-printer-id="${printer.id}">
          <p class="printer-card__drop-title">Drop files here</p>
          <p class="printer-card__drop-copy">The server picks the right route from printer ID, file kind, and single-vs-multi upload count.</p>
        </div>
        <div class="printer-card__actions">
          <button class="printer-card__button printer-card__button--primary" type="button" data-role="browse" data-printer-id="${printer.id}">Choose Files</button>
          ${printer.enableLabelBuilder ? `<button class="printer-card__button printer-card__button--secondary" type="button" data-role="label-builder" data-printer-id="${printer.id}">Open Label Builder</button>` : ''}
        </div>
        <input class="printer-card__input" data-role="input" data-printer-id="${printer.id}" type="file" multiple accept="${buildAcceptValue(printer.acceptedKinds)}">
      </article>
    `).join('');
  };

  // ╭──────────────────────────╮
  // │  Upload routing          │
  // ╰──────────────────────────╯
  const detectFileKind = file => {
    const mimeType = String(file.type || '').toLowerCase();
    const extension = getFileExtension(file.name);

    if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
    if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
    if (ZIP_MIME_TYPES.has(mimeType) || ZIP_EXTENSIONS.has(extension)) return 'zip';

    return null;
  };

  const groupFilesByKind = (printer, files) => {
    const groupedFiles = {
      pdf: [],
      image: [],
      zip: [],
    };
    const unsupportedFiles = [];

    Array.from(files).forEach(file => {
      const fileKind = detectFileKind(file);

      if (!fileKind || !printer.acceptedKinds.includes(fileKind)) {
        unsupportedFiles.push(file.name);
        return;
      }

      groupedFiles[fileKind].push(file);
    });

    if (unsupportedFiles.length) {
      throw new Error(`Unsupported for ${printer.displayName}: ${unsupportedFiles.join(', ')}`);
    }

    return Object.fromEntries(
      Object.entries(groupedFiles).filter(([, grouped]) => grouped.length > 0)
    );
  };

  const uploadGroupedFiles = async (printer, groupedFiles, extraFields = {}) => {
    const groupEntries = Object.entries(groupedFiles);

    if (!groupEntries.length) {
      throw new Error('No valid files were supplied.');
    }

    for (const [fileKind, files] of groupEntries) {
      const routePath = files.length > 1
        ? `/${printer.id}/${fileKind}/multi`
        : `/${printer.id}/${fileKind}`;
      const formData = new FormData();

      files.forEach(file => {
        formData.append(PRINTIFY_FILE_KINDS[fileKind].fieldName, file, file.name);
      });

      Object.entries(extraFields).forEach(([fieldName, fieldValue]) => {
        if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
          formData.append(fieldName, fieldValue);
        }
      });

      const response = await fetch(routePath, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed for ${printer.displayName} (${fileKind})`);
      }
    }
  };

  const handlePrinterFiles = async (printerId, files, extraFields = {}) => {
    const printer = getPrinterById(printerId);

    if (!printer) throw new Error(`Unknown printer: ${printerId}`);

    const groupedFiles = groupFilesByKind(printer, files);
    await uploadGroupedFiles(printer, groupedFiles, extraFields);
    showConfirm(`${printer.displayName} job sent`);
  };

  // ╭──────────────────────────╮
  // │  Label builder           │
  // ╰──────────────────────────╯
  const ensureLabelCanvas = () => {
    if (appState.labelCanvas || !window.fabric) return;

    appState.labelCanvas = new window.fabric.Canvas('labelCanvas');
    const textBox = new window.fabric.Textbox('Click to Edit Text', {
      top: 80,
      left: 50,
      width: 300,
      fontSize: 40,
      fontFamily: 'Arial',
      editable: true,
      fill: 'black',
      backgroundColor: 'white',
      borderColor: 'gray',
      cornerColor: 'blue',
      cornerSize: 6,
      transparentCorners: false,
    });

    appState.labelCanvas.add(textBox);
    appState.labelCanvas.setActiveObject(textBox);
  };

  const openLabelBuilder = printerId => {
    const printer = getPrinterById(printerId);

    if (!printer || !printer.enableLabelBuilder) return;

    ensureLabelCanvas();
    if (!appState.labelCanvas) {
      showFeedback('Label builder assets are unavailable in this browser.');
      return;
    }

    appState.labelPrinterId = printerId;
    builderTitle.textContent = printer.displayName;
    builder.classList.add('is-open');
  };

  const closeLabelBuilder = () => {
    builder.classList.remove('is-open');
  };

  const printBuilderLabel = () => {
    if (!appState.labelCanvas || !appState.labelPrinterId) return;

    appState.labelCanvas.discardActiveObject();
    appState.labelCanvas.requestRenderAll();

    window.setTimeout(() => {
      appState.labelCanvas.getElement().toBlob(async blob => {
        try {
          if (!blob) throw new Error('Could not render the label canvas.');
          const labelFile = new File([blob], 'label.png', { type: 'image/png' });
          await handlePrinterFiles(appState.labelPrinterId, [labelFile], {
            printCount: builderCopies.value,
          });
          closeLabelBuilder();
        } catch (error) {
          showFeedback(error.message);
        }
      });
    }, 80);
  };

  // ╭──────────────────────────╮
  // │  UI events               │
  // ╰──────────────────────────╯
  const bindPrinterEvents = () => {
    printerGrid.addEventListener('click', event => {
      const browseButton = event.target.closest('[data-role="browse"]');
      const builderButton = event.target.closest('[data-role="label-builder"]');

      if (browseButton) {
        const input = printerGrid.querySelector(`[data-role="input"][data-printer-id="${browseButton.getAttribute('data-printer-id')}"]`);
        if (input) input.click();
      }

      if (builderButton) {
        openLabelBuilder(builderButton.getAttribute('data-printer-id'));
      }
    });

    printerGrid.addEventListener('change', async event => {
      const input = event.target.closest('[data-role="input"]');

      if (!input || !input.files || !input.files.length) return;

      try {
        await handlePrinterFiles(input.getAttribute('data-printer-id'), Array.from(input.files));
      } catch (error) {
        showFeedback(error.message);
      } finally {
        input.value = '';
      }
    });

    printerGrid.addEventListener('dragover', event => {
      const dropzone = event.target.closest('[data-role="dropzone"]');

      if (!dropzone) return;

      event.preventDefault();
      dropzone.classList.add('is-highlighted');
    });

    printerGrid.addEventListener('dragleave', event => {
      const dropzone = event.target.closest('[data-role="dropzone"]');

      if (!dropzone) return;
      dropzone.classList.remove('is-highlighted');
    });

    printerGrid.addEventListener('drop', async event => {
      const dropzone = event.target.closest('[data-role="dropzone"]');

      if (!dropzone) return;

      event.preventDefault();
      dropzone.classList.remove('is-highlighted');

      try {
        await handlePrinterFiles(dropzone.getAttribute('data-printer-id'), Array.from(event.dataTransfer.files || []));
      } catch (error) {
        showFeedback(error.message);
      }
    });
  };

  const bindBuilderEvents = () => {
    builderClose.addEventListener('click', closeLabelBuilder);
    builderCancel.addEventListener('click', closeLabelBuilder);
    builderPrint.addEventListener('click', printBuilderLabel);
    builder.addEventListener('click', event => {
      if (event.target === builder) closeLabelBuilder();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && builder.classList.contains('is-open')) closeLabelBuilder();
    });
  };

  // ╭──────────────────────────╮
  // │  Log drawer + Clippy     │
  // ╰──────────────────────────╯
  const bootLogDrawer = () => {
    if (typeof window.createPrintifyLogDrawer === 'function') {
      window.createPrintifyLogDrawer(PRINTIFY_LOG_ROUTE);
    }
  };

  const bootClippy = () => {
    if (!window.clippy) return;

    window.clippy.load('Clippy', agent => {
      appState.labelAgent = agent;
      agent.show();

      window.setTimeout(() => {
        const sayings = [
          `We've printed over ${appState.printCounter} files.`,
          `This page has had ${appState.pageHits} visits.`,
          `Use the log drawer in the top left to inspect recent jobs.`,
        ];

        agent.speak(sayings[Math.floor(Math.random() * sayings.length)]);
      }, 3200);
    });
  };

  // ╭──────────────────────────╮
  // │  Boot sequence           │
  // ╰──────────────────────────╯
  const boot = async () => {
    bindPrinterEvents();
    bindBuilderEvents();
    bootLogDrawer();

    try {
      await Promise.all([loadVersion(), loadPrinters()]);
      bootClippy();
    } catch (error) {
      showFeedback('Could not load printer configuration from the server.');
      console.error(error);
    }
  };

  boot();
}());
