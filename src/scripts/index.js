(function () {
  // ╭──────────────────────────╮
  // │  Shared constants        │
  // ╰──────────────────────────╯
  const APP_VERSION = '2.2.1';
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
  const OVERSIZE_WARNING_RATIO = 1.5;
  const THEME_STORAGE_KEY = 'printify-theme';

  const appState = {
    printers: [],
    pageHits: 0,
    printCounter: 0,
    serverVersion: 'Unknown',
    feedbackTimer: null,
    clippyAgent: null,
    labelBuilder: null,
    openPrinterId: null,
  };

  const dragDepth = new Map();
  const printerGrid = document.getElementById('printerGrid');
  const footer = document.getElementById('footer');
  const feedback = document.getElementById('feedback');
  const confirmLayer = document.getElementById('confirmLayer');
  const confirmVideo = document.getElementById('confirmVideo');
  const themeToggle = document.getElementById('themeToggle');

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

  const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const getFileExtension = fileName => {
    const segments = String(fileName || '').toLowerCase().split('.');
    return segments.length > 1 ? segments.pop() : '';
  };

  const parsePxSize = pxSize => {
    const match = String(pxSize || '').match(/^(\d+)x(\d+)$/i);

    if (!match) return null;

    return {
      width: Number.parseInt(match[1], 10),
      height: Number.parseInt(match[2], 10),
    };
  };

  const prettyPrinterKinds = acceptedKinds => (
    acceptedKinds.map(kind => PRINTIFY_FILE_KINDS[kind]?.label || kind.toUpperCase())
  );

  const getFileKindToneClass = fileKind => {
    if (fileKind === 'pdf') return 'printer-card__kind-bubble--pdf';
    if (fileKind === 'image') return 'printer-card__kind-bubble--image';
    if (fileKind === 'zip') return 'printer-card__kind-bubble--zip';
    return '';
  };

  const getPrinterById = printerId => appState.printers.find(printer => printer.id === printerId);

  const formatPixels = ({ width, height }) => `${Math.round(width)}x${Math.round(height)}px`;

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

    if (appState.clippyAgent && typeof appState.clippyAgent.speak === 'function') {
      appState.clippyAgent.speak(message);
    }
  };

  const applyTheme = theme => {
    const nextTheme = theme === 'light' ? 'light' : 'dark';

    if (nextTheme === 'dark') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }

    if (themeToggle) {
      const isDark = nextTheme === 'dark';
      themeToggle.textContent = isDark ? '☀︎' : '☾';
      themeToggle.setAttribute('aria-pressed', String(isDark));
      themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      themeToggle.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
  };

  const bootTheme = () => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    applyTheme(savedTheme || 'dark');

    themeToggle?.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      applyTheme(nextTheme);
    });
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
      footer.textContent = '';
      typeWrite(footer, `Client v${APP_VERSION}`, 40);
      window.setTimeout(() => {
        typeWrite(footer, ` | Server v${serverData.version}`, 40);
      }, 1200);
    });

  const loadPrinters = () => fetch('/printers')
    .then(response => response.json())
    .then(payload => {
      appState.printers = payload.printers || [];
      renderPrinters(appState.printers);
    });

  // ╭──────────────────────────╮
  // │  Printer rendering       │
  // ╰──────────────────────────╯
  const buildAcceptValue = acceptedKinds => {
    const accepts = [];

    if (acceptedKinds.includes('pdf')) accepts.push('.pdf,application/pdf');
    if (acceptedKinds.includes('image')) accepts.push('image/png,image/jpeg,image/jpg,image/tiff,image/webp,.png,.jpg,.jpeg,.tif,.tiff,.webp');
    if (acceptedKinds.includes('zip')) accepts.push('.zip,application/zip,application/x-zip,application/x-zip-compressed,application/octet-stream');

    return accepts.join(',');
  };

  const renderPrinters = printers => {
    if (!printers.length) {
      printerGrid.innerHTML = `
        <article class="printer-card printer-card--empty">
          <p class="printer-card__empty-copy">No printers are configured on the server.</p>
        </article>
      `;
      return;
    }

    printerGrid.innerHTML = printers.map((printer, index) => `
      <article
        class="printer-card${appState.openPrinterId === printer.id ? ' is-open' : ''}"
        data-role="printer-card"
        data-printer-id="${printer.id}"
        style="--card-index:${index};"
        role="button"
        tabindex="0"
        aria-expanded="${appState.openPrinterId === printer.id ? 'true' : 'false'}"
      >
        <div class="printer-card__overlay" aria-hidden="true"></div>
        <p class="printer-card__name">${escapeHtml(printer.displayName)}</p>
        <div class="printer-card__body">
          <img class="printer-card__icon" src="${printer.iconUrl || '/favicon.ico'}" alt="${escapeHtml(printer.displayName)}">
        </div>
        <div class="printer-card__details">
          <p class="printer-card__hint">Drop files anywhere on this card</p>
          <div class="printer-card__kind-bubbles">
            ${(printer.acceptedKinds || []).map(fileKind => `
              <span class="printer-card__kind-bubble ${getFileKindToneClass(fileKind)}">${escapeHtml(PRINTIFY_FILE_KINDS[fileKind]?.label || fileKind.toUpperCase())}</span>
            `).join('')}
          </div>
          <div class="printer-card__actions">
            <button class="printer-card__button printer-card__button--primary" type="button" data-role="choose-files" data-printer-id="${printer.id}">Choose Files</button>
            ${printer.labelBuilder ? `<button class="printer-card__button printer-card__button--secondary" type="button" data-role="label-builder" data-printer-id="${printer.id}">Label Builder</button>` : ''}
          </div>
        </div>
        <input class="printer-card__file-input" data-role="file-input" data-printer-id="${printer.id}" type="file" multiple accept="${buildAcceptValue(printer.acceptedKinds || [])}">
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

  const loadImageDimensions = file => new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read dimensions for ${file.name}`));
    };

    image.src = objectUrl;
  });

  const loadPdfDimensions = async (file, printerDensity) => {
    if (!window.pdfjsLib) return null;

    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/scripts/vendor/pdf-2.16.105.worker.min.js';
    }

    const pdfBytes = await file.arrayBuffer();
    const pdfDocument = await window.pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const firstPage = await pdfDocument.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    const density = Number.parseInt(printerDensity || '72', 10) || 72;

    return {
      width: (viewport.width * density) / 72,
      height: (viewport.height * density) / 72,
    };
  };

  const getBestOversizeRatio = (dimensions, target) => {
    const directRatio = Math.max(dimensions.width / target.width, dimensions.height / target.height);
    const rotatedRatio = Math.max(dimensions.width / target.height, dimensions.height / target.width);
    return Math.min(directRatio, rotatedRatio);
  };

  const buildOversizeWarnings = async (printer, files) => {
    const targetSize = parsePxSize(printer?.pxSize);
    if (!targetSize) return [];

    const warnings = [];

    for (const file of files) {
      const fileKind = detectFileKind(file);
      if (!fileKind || fileKind === 'zip') continue;

      try {
        let dimensions = null;

        if (fileKind === 'image') {
          dimensions = await loadImageDimensions(file);
        }

        if (fileKind === 'pdf') {
          dimensions = await loadPdfDimensions(file, printer.density);
        }

        if (!dimensions) continue;

        const oversizeRatio = getBestOversizeRatio(dimensions, targetSize);

        if (oversizeRatio >= OVERSIZE_WARNING_RATIO) {
          warnings.push(`${file.name}: ${formatPixels(dimensions)} vs target ${formatPixels(targetSize)}`);
        }
      } catch (error) {
        console.warn(error);
      }
    }

    return warnings;
  };

  const confirmOversizeFiles = async (printer, files) => {
    const warnings = await buildOversizeWarnings(printer, files);
    if (!warnings.length) return true;

    const previewLines = warnings.slice(0, 3);
    const remainingCount = warnings.length - previewLines.length;
    const warningMessage = [
      `${printer.displayName} is configured for ${printer.pxSize}.`,
      'Some files look much larger than that target size:',
      ...previewLines.map(line => `- ${line}`),
      remainingCount > 0 ? `- and ${remainingCount} more` : null,
      '',
      'Continue anyway?',
    ].filter(Boolean).join('\n');

    return window.confirm(warningMessage);
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

      if (!fileKind || !(printer.acceptedKinds || []).includes(fileKind)) {
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

    const shouldContinue = await confirmOversizeFiles(printer, files);
    if (!shouldContinue) return;

    const groupedFiles = groupFilesByKind(printer, files);
    await uploadGroupedFiles(printer, groupedFiles, extraFields);
    showConfirm(`${printer.displayName} job sent`);
  };

  // ╭──────────────────────────╮
  // │  UI events               │
  // ╰──────────────────────────╯
  const setCardHighlight = (card, isHighlighted) => {
    if (!card) return;
    card.classList.toggle('is-highlighted', isHighlighted);
  };

  const resetCardDragState = card => {
    if (!card) return;
    dragDepth.delete(card);
    setCardHighlight(card, false);
  };

  const setOpenPrinter = printerId => {
    appState.openPrinterId = printerId;
    printerGrid.querySelectorAll('[data-role="printer-card"]').forEach(card => {
      const isOpen = card.getAttribute('data-printer-id') === printerId;
      card.classList.toggle('is-open', isOpen);
      card.setAttribute('aria-expanded', String(isOpen));
    });
  };

  const bindPrinterEvents = () => {
    printerGrid.addEventListener('click', event => {
      const chooseFilesButton = event.target.closest('[data-role="choose-files"]');
      if (chooseFilesButton) {
        event.stopPropagation();
        const input = printerGrid.querySelector(`[data-role="file-input"][data-printer-id="${chooseFilesButton.getAttribute('data-printer-id')}"]`);
        input?.click();
        return;
      }

      const labelBuilderButton = event.target.closest('[data-role="label-builder"]');
      if (labelBuilderButton) {
        event.stopPropagation();
        const printer = getPrinterById(labelBuilderButton.getAttribute('data-printer-id'));
        appState.labelBuilder?.open(printer);
        return;
      }

      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;
      const printerId = card.getAttribute('data-printer-id');
      setOpenPrinter(appState.openPrinterId === printerId ? null : printerId);
    });

    printerGrid.addEventListener('keydown', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const printerId = card.getAttribute('data-printer-id');
        setOpenPrinter(appState.openPrinterId === printerId ? null : printerId);
      }
    });

    printerGrid.addEventListener('change', async event => {
      const input = event.target.closest('[data-role="file-input"]');
      if (!input || !input.files?.length) return;

      try {
        await handlePrinterFiles(input.getAttribute('data-printer-id'), Array.from(input.files));
      } catch (error) {
        showFeedback(error.message);
      } finally {
        input.value = '';
      }
    });

    printerGrid.addEventListener('dragenter', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      event.preventDefault();
      const nextDepth = (dragDepth.get(card) || 0) + 1;
      dragDepth.set(card, nextDepth);
      setCardHighlight(card, true);
    });

    printerGrid.addEventListener('dragover', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setCardHighlight(card, true);
    });

    printerGrid.addEventListener('dragleave', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      const nextDepth = Math.max((dragDepth.get(card) || 1) - 1, 0);

      if (nextDepth === 0) {
        resetCardDragState(card);
        return;
      }

      dragDepth.set(card, nextDepth);
    });

    printerGrid.addEventListener('drop', async event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      event.preventDefault();
      resetCardDragState(card);

      try {
        await handlePrinterFiles(
          card.getAttribute('data-printer-id'),
          Array.from(event.dataTransfer?.files || [])
        );
      } catch (error) {
        showFeedback(error.message);
      }
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

  const bootLabelBuilder = () => {
    if (typeof window.createPrintifyLabelBuilder !== 'function') return;

    appState.labelBuilder = window.createPrintifyLabelBuilder({
      onPrint: (printer, files, extraFields) => handlePrinterFiles(printer.id, files, extraFields),
      onError: error => showFeedback(error.message),
    });
  };

  const bootClippy = () => {
    if (!window.clippy) return;

    window.clippy.load('Clippy', agent => {
      appState.clippyAgent = agent;
      if (typeof agent.pinToCorner === 'function') {
        agent.pinToCorner({
          right: 15,
          bottom: 15,
        });
      }
      agent.show();
      window.setTimeout(() => agent.reposition(), 80);

      window.setTimeout(() => {
        const line = window.PrintifyQuippy?.getRandomBootLine({
          printCounter: appState.printCounter,
          pageHits: appState.pageHits,
          printers: appState.printers,
        }) || 'I appear to be between remarks at the moment.';

        agent.speak(line);
      }, 3200);
    });
  };

  // ╭──────────────────────────╮
  // │  Boot sequence           │
  // ╰──────────────────────────╯
  const boot = async () => {
    bootTheme();
    bindPrinterEvents();
    bootLogDrawer();
    bootLabelBuilder();

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
