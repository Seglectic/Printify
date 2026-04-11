(function () {
  // ╭──────────────────────────╮
  // │  Shared constants        │
  // ╰──────────────────────────╯
  const APP_VERSION = '2.7.1';
  window.PRINTIFY_CLIENT_VERSION = APP_VERSION;
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
  const DUPLICATE_WHITELIST_STORAGE_KEY = 'printify-duplicate-whitelist';
  const DUPLICATE_WHITELIST_DURATION_MS = 24 * 60 * 60 * 1000;
  const DUPLICATE_PROMPTS = [
    'This file has been printed recently, send it?',
    'File printed within the last 31 days, print again?',
    'Recent match found for this file. Run another print?',
    'This document was already printed not long ago. Send it anyway?',
    'Looks like this file has been used recently. Print one more time?',
    'A recent copy of this file was already sent to this printer. Queue another one?',
    'This document has a fresh print history for this printer. Send it again?',
  ];

  const appState = {
    printers: [],
    pageHits: 0,
    printCounter: 0,
    exactPrintCounter: 0,
    pageCounter: 0,
    actualPrintCounter: 0,
    actualPageCounter: 0,
    testingPrintCounter: 0,
    testingPageCounter: 0,
    paperAreaSquareMm: 0,
    actualPaperAreaSquareMm: 0,
    testingPaperAreaSquareMm: 0,
    serverVersion: 'Unknown',
    serverDataVersion: 'Unknown',
    testing: false,
    lastStartedAt: null,
    lastPrintAt: null,
    lastPrintJob: null,
    dailyStats: {},
    assistant: 'Clippy',
    feedbackTimer: null,
    assistantAgent: null,
    labelBuilder: null,
    logDrawer: null,
    clientPluginsById: {},
    clientPluginModules: {},
    hiddenTriggerBuffer: '',
    hiddenTriggerTimer: null,
    openPrinterId: null,
    statsSocket: null,
    statsSocketReconnectTimer: null,
    statsRefreshTimer: null,
  };

  const dragDepth = new Map();
  const appShell = document.querySelector('.printify-app');
  const printerGrid = document.getElementById('printerGrid');
  const footer = document.getElementById('footer');
  const feedback = document.getElementById('feedback');
  const confirmLayer = document.getElementById('confirmLayer');
  const confirmVideo = document.getElementById('confirmVideo');
  const promptLayer = document.getElementById('promptLayer');
  const promptCard = document.getElementById('promptCard');
  const promptEyebrow = document.getElementById('promptEyebrow');
  const promptTitle = document.getElementById('promptTitle');
  const promptMessage = document.getElementById('promptMessage');
  const promptSubtext = document.getElementById('promptSubtext');
  const promptCancel = document.getElementById('promptCancel');
  const promptConfirm = document.getElementById('promptConfirm');
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

  const formatWholeNumber = value => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return '0';
    }

    return numericValue.toLocaleString();
  };

  const getSixDigitCounter = value => {
    const numericValue = Math.max(0, Math.floor(Number(value) || 0));
    return String(numericValue).padStart(6, '0').slice(-6);
  };

  const buildPrinterCounterMarkup = value => {
    const digits = getSixDigitCounter(value).split('');
    const firstSignificantIndex = digits.findIndex(digit => digit !== '0');

    return digits.map((digit, index) => `
      <span class="printer-card__counter-digit${firstSignificantIndex !== -1 && index < firstSignificantIndex ? ' is-leading' : ''}" aria-hidden="true">
        <span class="printer-card__counter-digit-face">${digit}</span>
      </span>
    `).join('');
  };

  const getPrinterDisplayPageCount = printer => {
    const actualPageCounter = Number.isFinite(printer?.actualPageCounter)
      ? printer.actualPageCounter
      : 0;
    const combinedPageCounter = Number.isFinite(printer?.pageCounter)
      ? printer.pageCounter
      : actualPageCounter;

    return appState.testing
      ? combinedPageCounter
      : actualPageCounter;
  };

  const getPrinterDisplayAreaSquareMm = printer => {
    const actualAreaSquareMm = Number.isFinite(printer?.actualPaperAreaSquareMm)
      ? printer.actualPaperAreaSquareMm
      : 0;
    const combinedAreaSquareMm = Number.isFinite(printer?.paperAreaSquareMm)
      ? printer.paperAreaSquareMm
      : actualAreaSquareMm;

    return appState.testing
      ? combinedAreaSquareMm
      : actualAreaSquareMm;
  };

  const formatAreaSquareMm = value => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return '0';
    }

    return Math.round(numericValue).toLocaleString();
  };

  const buildPrinterCounterTooltip = printer => {
    const numericPageCount = Math.max(0, Math.floor(Number(getPrinterDisplayPageCount(printer)) || 0));
    const pageCount = formatWholeNumber(numericPageCount);
    const pageLabel = numericPageCount === 1 ? 'page' : 'pages';
    const areaSquareMm = formatAreaSquareMm(getPrinterDisplayAreaSquareMm(printer));
    return `${pageCount} ${pageLabel} printed\n(${areaSquareMm}mm²)`;
  };

  const getFileExtension = fileName => {
    const segments = String(fileName || '').toLowerCase().split('.');
    return segments.length > 1 ? segments.pop() : '';
  };

  const getPrinterTargetSize = printer => {
    if (printer?.isTape) {
      const tapeWidth = Number.parseInt(printer.lastTapeWidthMm || printer.defaultTape || printer.tapes?.[0], 10);
      const density = Number(printer?.density);

      if (Number.isFinite(tapeWidth) && Number.isFinite(density) && density > 0) {
        return {
          width: Math.round((60 / 25.4) * density),
          height: Math.round((tapeWidth / 25.4) * density),
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

    if (!match) return null;

    return {
      width: Number.parseInt(match[1], 10),
      height: Number.parseInt(match[2], 10),
    };
  };

  const getPrinterPaperRatio = printer => {
    const targetSize = getPrinterTargetSize(printer);

    if (targetSize?.width > 0 && targetSize?.height > 0) {
      return `${targetSize.width} / ${targetSize.height}`;
    }

    const sizeMatch = String(printer?.size || '').match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);

    if (sizeMatch) {
      return `${sizeMatch[1]} / ${sizeMatch[2]}`;
    }

    return '4 / 6';
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

  const pickRandomPrompt = () => DUPLICATE_PROMPTS[Math.floor(Math.random() * DUPLICATE_PROMPTS.length)];
  const formatPixels = ({ width, height }) => `${Math.round(width)}x${Math.round(height)}px`;

  const formatPercent = value => {
    if (!Number.isFinite(value)) return '0';
    const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  const showFeedback = message => {
    if (appState.assistant !== 'none' && appState.assistantAgent && typeof appState.assistantAgent.speak === 'function') {
      appState.assistantAgent.speak(message);
      return;
    }

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

  };

  const showPromptCard = ({
    tone = 'warning',
    eyebrow = 'Warning',
    title = 'Heads up',
    message = '',
    subtext = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
  }) => new Promise(resolve => {
    if (!promptLayer || !promptCard || !promptEyebrow || !promptTitle || !promptMessage || !promptCancel || !promptConfirm) {
      resolve(window.confirm(message || title));
      return;
    }

    let settled = false;
    let previousFocus = document.activeElement;

    const finish = accepted => {
      if (settled) return;
      settled = true;

      promptLayer.hidden = true;
      promptCard.classList.remove('printify-prompt__card--warning');
      document.removeEventListener('keydown', handleKeyDown);
      promptCancel.removeEventListener('click', cancel);
      promptConfirm.removeEventListener('click', confirm);
      promptLayer.removeEventListener('click', handleBackdropClick);

      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }

      resolve(accepted);
    };

    const cancel = () => finish(false);
    const confirm = () => finish(true);
    const handleBackdropClick = event => {
      if (event.target === promptLayer) {
        cancel();
      }
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        confirm();
      }
    };

    promptCard.classList.toggle('printify-prompt__card--warning', tone === 'warning');
    promptEyebrow.textContent = eyebrow;
    promptTitle.textContent = title;
    promptMessage.textContent = message;
    if (promptSubtext) {
      promptSubtext.textContent = subtext;
      promptSubtext.hidden = !subtext;
    }
    promptCancel.textContent = cancelLabel;
    promptConfirm.textContent = confirmLabel;
    promptLayer.hidden = false;

    document.addEventListener('keydown', handleKeyDown);
    promptCancel.addEventListener('click', cancel);
    promptConfirm.addEventListener('click', confirm);
    promptLayer.addEventListener('click', handleBackdropClick);

    window.setTimeout(() => {
      promptConfirm.focus();
    }, 0);
  });

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
  const syncPrinterStatBadges = () => {
    Array.from(printerGrid?.querySelectorAll('[data-role="printer-card"]') || []).forEach(card => {
      const printerId = card.getAttribute('data-printer-id');
      const printer = getPrinterById(printerId);
      const pageTotal = card.querySelector('.printer-card__page-total');

      if (!printer || !pageTotal) return;

      const displayCount = getPrinterDisplayPageCount(printer);

      pageTotal.innerHTML = buildPrinterCounterMarkup(displayCount);
      pageTotal.setAttribute('aria-label', `Successful pages printed: ${formatWholeNumber(displayCount)}`);
      pageTotal.setAttribute('title', buildPrinterCounterTooltip(printer));
      pageTotal.setAttribute('data-counter-tooltip', buildPrinterCounterTooltip(printer));
    });
  };

  const applyServerData = (serverData, { updateFooter = false, patchPrinterStats = false } = {}) => {
    if (!serverData || typeof serverData !== 'object') {
      return;
    }

    appState.serverVersion = serverData.version;
    appState.pageHits = serverData.pageHits;
    appState.printCounter = serverData.printCounter;
    appState.exactPrintCounter = Number.isFinite(serverData.exactPrintCounter)
      ? serverData.exactPrintCounter
      : serverData.printCounter;
    appState.pageCounter = Number.isFinite(serverData.pageCounter) ? serverData.pageCounter : 0;
    appState.actualPrintCounter = Number.isFinite(serverData.actualPrintCounter) ? serverData.actualPrintCounter : 0;
    appState.actualPageCounter = Number.isFinite(serverData.actualPageCounter) ? serverData.actualPageCounter : 0;
    appState.testingPrintCounter = Number.isFinite(serverData.testingPrintCounter) ? serverData.testingPrintCounter : 0;
    appState.testingPageCounter = Number.isFinite(serverData.testingPageCounter) ? serverData.testingPageCounter : 0;
    appState.paperAreaSquareMm = Number.isFinite(serverData.paperAreaSquareMm) ? serverData.paperAreaSquareMm : 0;
    appState.actualPaperAreaSquareMm = Number.isFinite(serverData.actualPaperAreaSquareMm) ? serverData.actualPaperAreaSquareMm : 0;
    appState.testingPaperAreaSquareMm = Number.isFinite(serverData.testingPaperAreaSquareMm) ? serverData.testingPaperAreaSquareMm : 0;
    appState.serverDataVersion = serverData.dataVersion || 'Unknown';
    appState.testing = Boolean(serverData.testing);
    appState.lastStartedAt = serverData.lastStartedAt || null;
    appState.lastPrintAt = serverData.lastPrintAt || null;
    appState.lastPrintJob = serverData.lastPrintJob || null;
    appState.dailyStats = serverData.dailyStats || {};
    appState.assistant = serverData.assistant || 'Clippy';

    if (patchPrinterStats && serverData.printers && appState.printers.length) {
      appState.printers = appState.printers.map(printer => ({
        ...printer,
        ...(serverData.printers[printer.id] || {}),
      }));
      syncPrinterStatBadges();
    }

    if (updateFooter) {
      footer.textContent = '';
      typeWrite(footer, `Client v${APP_VERSION}`, 40);
      window.setTimeout(() => {
        typeWrite(footer, ` | Server v${serverData.version}`, 40);
      }, 1200);
    }
  };

  const loadVersion = options => fetch('/version')
    .then(response => response.json())
    .then(serverData => {
      applyServerData(serverData, options);
      return serverData;
    });

  const loadPrinters = ({ preserveExisting = false } = {}) => fetch('/printers')
    .then(response => response.json())
    .then(payload => {
      appState.printers = payload.printers || [];
      renderPrinters(appState.printers, { preserveExisting });
    });

  const loadClientPlugins = () => fetch('/client-plugins')
    .then(response => response.json())
    .then(payload => {
      const plugins = Array.isArray(payload?.plugins) ? payload.plugins : [];

      appState.clientPluginsById = plugins.reduce((pluginMap, pluginConfig) => {
        if (pluginConfig?.id) {
          pluginMap[pluginConfig.id] = pluginConfig;
        }

        return pluginMap;
      }, {});
    });

  const refreshServerState = () => loadVersion({ patchPrinterStats: true });
  const refreshPrinterState = () => loadPrinters({ preserveExisting: true })
    .then(() => loadVersion({ patchPrinterStats: true }));
  const queueServerStateRefresh = () => {
    if (appState.statsRefreshTimer) {
      window.clearTimeout(appState.statsRefreshTimer);
    }

    appState.statsRefreshTimer = window.setTimeout(() => {
      appState.statsRefreshTimer = null;
      refreshServerState().catch(() => {});
    }, 350);
  };
  const queuePrinterStateRefresh = () => {
    if (appState.statsRefreshTimer) {
      window.clearTimeout(appState.statsRefreshTimer);
    }

    appState.statsRefreshTimer = window.setTimeout(() => {
      appState.statsRefreshTimer = null;
      refreshPrinterState().catch(() => {});
    }, 350);
  };

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

  const buildPrinterCardInnerMarkup = printer => `
    <div class="printer-card__overlay" aria-hidden="true"></div>
    <div class="printer-card__file-count" data-role="file-count" style="--printer-file-count-ratio:${getPrinterPaperRatio(printer)};" aria-hidden="true">
      <span class="printer-card__file-count-text">
        <span class="printer-card__file-count-number">1</span>
      </span>
    </div>
    <p class="printer-card__name">${escapeHtml(printer.displayName)}</p>
    <div class="printer-card__body">
      <img class="printer-card__icon" src="${printer.iconUrl || '/favicon.ico'}" alt="${escapeHtml(printer.displayName)}">
      <p class="printer-card__page-total" aria-label="Successful pages printed: ${escapeHtml(formatWholeNumber(getPrinterDisplayPageCount(printer)))}" title="${escapeHtml(buildPrinterCounterTooltip(printer))}" data-counter-tooltip="${escapeHtml(buildPrinterCounterTooltip(printer))}">${buildPrinterCounterMarkup(getPrinterDisplayPageCount(printer))}</p>
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
  `;

  const buildPrinterCardMarkup = (printer, index) => `
    <article
      class="printer-card${appState.openPrinterId === printer.id ? ' is-open' : ''}"
      data-role="printer-card"
      data-printer-id="${printer.id}"
      style="--card-index:${index};"
      role="button"
      tabindex="0"
      aria-expanded="${appState.openPrinterId === printer.id ? 'true' : 'false'}"
    >
      ${buildPrinterCardInnerMarkup(printer)}
    </article>
  `;

  const syncPrinterCard = (card, printer, index) => {
    const isOpen = appState.openPrinterId === printer.id;
    const preservedClasses = {
      highlighted: card.classList.contains('is-highlighted'),
      invalid: card.classList.contains('is-drop-invalid'),
      clearing: card.classList.contains('is-drop-clearing'),
      entering: card.classList.contains('is-entering'),
      removing: card.classList.contains('is-removing'),
    };

    card.setAttribute('data-printer-id', printer.id);
    card.setAttribute('style', `--card-index:${index};`);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-expanded', String(isOpen));
    card.classList.toggle('is-open', isOpen);
    card.innerHTML = buildPrinterCardInnerMarkup(printer);
    card.classList.toggle('is-highlighted', preservedClasses.highlighted);
    card.classList.toggle('is-drop-invalid', preservedClasses.invalid);
    card.classList.toggle('is-drop-clearing', preservedClasses.clearing);
    card.classList.toggle('is-entering', preservedClasses.entering);
    card.classList.toggle('is-removing', preservedClasses.removing);
  };

  const createPrinterCardElement = (printer, index, { instant = false } = {}) => {
    const template = document.createElement('template');
    template.innerHTML = buildPrinterCardMarkup(printer, index).trim();
    const card = template.content.firstElementChild;

    if (instant) {
      card.classList.add('printer-card--instant', 'is-entering');
      window.requestAnimationFrame(() => {
        card.classList.remove('is-entering');
      });
    }

    return card;
  };

  const renderPrinters = (printers, { preserveExisting = false } = {}) => {
    if (appState.openPrinterId && !printers.some(printer => printer.id === appState.openPrinterId)) {
      appState.openPrinterId = null;
    }

    if (!printers.length) {
      printerGrid.innerHTML = `
        <article class="printer-card printer-card--empty">
          <p class="printer-card__empty-copy">No printers are configured on the server.</p>
        </article>
      `;
      return;
    }

    if (!preserveExisting) {
      printerGrid.innerHTML = printers.map((printer, index) => buildPrinterCardMarkup(printer, index)).join('');
      window.requestAnimationFrame(() => {
        updatePrinterGridVerticalOffset();
      });
      return;
    }

    const existingCards = new Map(
      Array.from(printerGrid.querySelectorAll('[data-role="printer-card"]'))
        .map(card => [card.getAttribute('data-printer-id'), card])
    );

    printerGrid.querySelector('.printer-card--empty')?.remove();

    let insertionCursor = printerGrid.firstElementChild;

    printers.forEach((printer, index) => {
      const existingCard = existingCards.get(printer.id);

      if (existingCard) {
        syncPrinterCard(existingCard, printer, index);
        if (existingCard !== insertionCursor) {
          printerGrid.insertBefore(existingCard, insertionCursor);
        }
        existingCards.delete(printer.id);
        insertionCursor = existingCard.nextElementSibling;
        return;
      }

      const nextCard = createPrinterCardElement(printer, index, { instant: true });
      printerGrid.insertBefore(nextCard, insertionCursor);
      insertionCursor = nextCard.nextElementSibling;
    });

    existingCards.forEach(card => {
      resetCardDragState(card);
      card.classList.add('printer-card--instant', 'is-removing');
      window.setTimeout(() => {
        if (card.isConnected) {
          card.remove();
          updatePrinterGridVerticalOffset();
        }
      }, 130);
    });

    window.requestAnimationFrame(() => {
      updatePrinterGridVerticalOffset();
    });
  };

  const updatePrinterGridVerticalOffset = () => {
    if (!appShell || !printerGrid) return;

    const cards = Array.from(printerGrid.querySelectorAll('[data-role="printer-card"]'));
    if (!cards.length) {
      appShell.style.setProperty('--printify-app-top-pad', '88px');
      return;
    }

    const gridHeight = Math.ceil(printerGrid.getBoundingClientRect().height);
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const nextTopPad = Math.max(88, Math.floor((viewportHeight - gridHeight) / 2));
    appShell.style.setProperty('--printify-app-top-pad', `${nextTopPad}px`);
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
    const targetSize = getPrinterTargetSize(printer);
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
          warnings.push({
            fileName: file.name,
            dimensions,
            targetSize,
            oversizeRatio,
          });
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

    const largestWarning = warnings.reduce((currentLargest, warning) => (
      !currentLargest || warning.oversizeRatio > currentLargest.oversizeRatio
        ? warning
        : currentLargest
    ), null);

    const extraWarningCount = warnings.length - 1;
    const oversizePercent = formatPercent((largestWarning.oversizeRatio - 1) * 100);
    const warningMessage = [
      `File resolution is ${oversizePercent}% larger than the configured pixel area for the ${printer.displayName} (${formatPixels(largestWarning.dimensions)} vs ${formatPixels(largestWarning.targetSize)})`,
      extraWarningCount > 0 ? `${extraWarningCount} more file${extraWarningCount === 1 ? '' : 's'} also exceed that target.` : null,
      '',
      'Print anyway?',
    ].filter(Boolean).join('\n');

    return showPromptCard({
      tone: 'warning',
      eyebrow: '🚨 Warning',
      title: 'Print Size Mismatch',
      message: warningMessage,
      confirmLabel: 'Send It',
      cancelLabel: 'Cancel',
    });
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

  const readDuplicateWhitelist = () => {
    try {
      const rawValue = window.localStorage.getItem(DUPLICATE_WHITELIST_STORAGE_KEY);
      const now = Date.now();
      const parsedValue = JSON.parse(rawValue || '[]');
      const parsedEntries = Array.isArray(parsedValue) ? parsedValue : [];
      const activeEntries = parsedEntries.filter(entry => (
        entry
        && typeof entry.checksum === 'string'
        && Number.isFinite(entry.expiresAt)
        && entry.expiresAt > now
      ));

      if (activeEntries.length !== parsedEntries.length) {
        window.localStorage.setItem(DUPLICATE_WHITELIST_STORAGE_KEY, JSON.stringify(activeEntries));
      }

      return activeEntries;
    } catch (error) {
      window.localStorage.removeItem(DUPLICATE_WHITELIST_STORAGE_KEY);
      return [];
    }
  };

  const writeDuplicateWhitelist = entries => {
    window.localStorage.setItem(DUPLICATE_WHITELIST_STORAGE_KEY, JSON.stringify(entries));
  };

  const whitelistDuplicateChecksum = checksum => {
    if (!checksum) return;

    const now = Date.now();
    const nextEntries = readDuplicateWhitelist()
      .filter(entry => entry.checksum !== checksum);

    nextEntries.push({
      checksum,
      expiresAt: now + DUPLICATE_WHITELIST_DURATION_MS,
    });

    writeDuplicateWhitelist(nextEntries);
  };

  const isDuplicateChecksumWhitelisted = checksum => (
    readDuplicateWhitelist().some(entry => entry.checksum === checksum)
  );

  const resolvePendingDuplicates = async (printer, uploadResult) => {
    if (!uploadResult?.needsConfirmation || !uploadResult.sessionId) {
      return uploadResult;
    }

    const duplicates = Array.isArray(uploadResult.duplicates) ? uploadResult.duplicates : [];
    const duplicatesByChecksum = new Map();
    const approvedItemIds = [];

    duplicates.forEach(duplicate => {
      const checksumKey = duplicate.checksum || duplicate.id;
      const groupedDuplicates = duplicatesByChecksum.get(checksumKey) || [];
      groupedDuplicates.push(duplicate);
      duplicatesByChecksum.set(checksumKey, groupedDuplicates);
    });

    for (const groupedDuplicates of duplicatesByChecksum.values()) {
      const sampleDuplicate = groupedDuplicates[0];

      if (sampleDuplicate.checksum && isDuplicateChecksumWhitelisted(sampleDuplicate.checksum)) {
        groupedDuplicates.forEach(duplicate => {
          approvedItemIds.push(duplicate.id);
        });
        continue;
      }

      const accepted = await showPromptCard({
        tone: 'warning',
        eyebrow: 'Recent Match',
        title: 'Duplicate Detected',
        message: pickRandomPrompt(),
        subtext: `Matched ${sampleDuplicate.originalFilename} on ${printer.displayName}. Approving it suppresses repeat warnings for 24 hours in this browser.`,
        confirmLabel: 'Send It',
        cancelLabel: 'Cancel',
      });

      if (!accepted) {
        continue;
      }

      if (sampleDuplicate.checksum) {
        whitelistDuplicateChecksum(sampleDuplicate.checksum);
      }

      groupedDuplicates.forEach(duplicate => {
        approvedItemIds.push(duplicate.id);
      });
    }

    const response = await fetch(`/ingest/${encodeURIComponent(uploadResult.sessionId)}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        approvedItemIds,
      }),
    });

    if (!response.ok) {
      throw new Error(`Duplicate confirmation failed for ${printer.displayName}`);
    }

    const confirmedResult = await response.json();

    return {
      ...uploadResult,
      printedCount: Number(uploadResult.printedCount || 0) + Number(confirmedResult.printedCount || 0),
      skippedCount: Number(uploadResult.skippedCount || 0) + Number(confirmedResult.skippedCount || 0),
      skippedDuplicates: [
        ...(Array.isArray(uploadResult.skippedDuplicates) ? uploadResult.skippedDuplicates : []),
        ...(Array.isArray(confirmedResult.skippedDuplicates) ? confirmedResult.skippedDuplicates : []),
      ],
      needsConfirmation: false,
      duplicates: [],
    };
  };

  const uploadGroupedFiles = async (printer, groupedFiles, extraFields = {}) => {
    const groupEntries = Object.entries(groupedFiles);
    const uploadResults = [];

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

      uploadResults.push(await resolvePendingDuplicates(printer, await response.json()));
    }

    return uploadResults;
  };

  const handlePrinterFiles = async (printerId, files, extraFields = {}) => {
    const printer = getPrinterById(printerId);

    if (!printer) throw new Error(`Unknown printer: ${printerId}`);

    const shouldContinue = await confirmOversizeFiles(printer, files);
    if (!shouldContinue) return;

    const groupedFiles = groupFilesByKind(printer, files);
    const uploadResults = await uploadGroupedFiles(printer, groupedFiles, extraFields);
    await refreshServerState();
    const skippedCount = uploadResults.reduce((total, result) => (
      total + Number(result?.skippedCount || 0)
    ), 0);
    const printedCount = uploadResults.reduce((total, result) => (
      total + Number(result?.printedCount || 0)
    ), 0);

    if (printedCount && skippedCount) {
      showConfirm(`${printer.displayName}: ${printedCount} sent, ${skippedCount} duplicate skipped`);
      return;
    }

    if (printedCount) {
      showConfirm(`${printer.displayName} job sent`);
      return;
    }

    if (skippedCount) {
      showFeedback(`${printer.displayName}: duplicate skipped`);
      return;
    }

    showFeedback(`${printer.displayName}: no files sent`);
  };

  // ╭──────────────────────────╮
  // │  UI events               │
  // ╰──────────────────────────╯
  const clearCardDragReset = card => {
    if (!card?._dragResetTimer) return;
    window.clearTimeout(card._dragResetTimer);
    card._dragResetTimer = null;
  };

  const setCardFileCount = (card, fileCount) => {
    const badge = card?.querySelector('[data-role="file-count"]');
    const label = badge?.querySelector('.printer-card__file-count-number');

    if (!badge || !label || !Number.isFinite(fileCount) || fileCount <= 1) {
      if (badge) {
        badge.classList.remove('is-visible');
        badge.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    label.textContent = String(fileCount);
    badge.classList.add('is-visible');
    badge.setAttribute('aria-hidden', 'false');
  };

  const setCardHighlight = (card, isHighlighted) => {
    if (!card) return;
    clearCardDragReset(card);
    const highlightMode = isHighlighted === true ? 'compatible' : isHighlighted;
    card.classList.remove('is-drop-clearing');
    card.classList.toggle('is-highlighted', Boolean(highlightMode));
    card.classList.toggle('is-drop-invalid', highlightMode === 'invalid');
  };

  const resetCardDragState = card => {
    if (!card) return;
    dragDepth.delete(card);
    setCardFileCount(card, 0);
    clearCardDragReset(card);

    const wasInvalid = card.classList.contains('is-drop-invalid');

    card.classList.remove('is-highlighted');

    if (!wasInvalid) {
      card.classList.remove('is-drop-invalid');
      card.classList.remove('is-drop-clearing');
      return;
    }

    card.classList.remove('is-drop-invalid');
    card.classList.add('is-drop-clearing');
    card._dragResetTimer = window.setTimeout(() => {
      card.classList.remove('is-drop-clearing');
      card._dragResetTimer = null;
    }, 180);
  };

  const setOpenPrinter = printerId => {
    appState.openPrinterId = printerId;
    printerGrid.querySelectorAll('[data-role="printer-card"]').forEach(card => {
      const isOpen = card.getAttribute('data-printer-id') === printerId;
      card.classList.toggle('is-open', isOpen);
      card.setAttribute('aria-expanded', String(isOpen));
    });
  };

  const isFileDragEvent = event => {
    const transferTypes = event.dataTransfer?.types;

    if (!transferTypes) return false;

    return Array.from(transferTypes).includes('Files');
  };

  const detectDraggedFileKinds = event => {
    const dragItems = Array.from(event.dataTransfer?.items || []);
    const draggedFiles = Array.from(event.dataTransfer?.files || []);
    const detectedKinds = new Set();

    dragItems.forEach(item => {
      if (item.kind !== 'file') return;

      const mimeType = String(item.type || '').trim().toLowerCase();

      if (mimeType === 'application/pdf') {
        detectedKinds.add('pdf');
        return;
      }

      if (mimeType.startsWith('image/')) {
        detectedKinds.add('image');
        return;
      }

      if (ZIP_MIME_TYPES.has(mimeType)) {
        detectedKinds.add('zip');
      }
    });

    draggedFiles.forEach(file => {
      const detectedKind = detectFileKind(file);
      if (detectedKind) detectedKinds.add(detectedKind);
    });

    return detectedKinds;
  };

  const detectDraggedFileCount = event => {
    const dragItems = Array.from(event.dataTransfer?.items || [])
      .filter(item => item.kind === 'file');

    if (dragItems.length) {
      return dragItems.length;
    }

    const draggedFiles = Array.from(event.dataTransfer?.files || []);
    return draggedFiles.length;
  };

  const getCardDragHighlightMode = (card, event) => {
    if (!card || !isFileDragEvent(event)) {
      return false;
    }

    const printer = getPrinterById(card.getAttribute('data-printer-id'));
    const draggedKinds = detectDraggedFileKinds(event);

    if (!printer || !draggedKinds.size) {
      return true;
    }

    const acceptsAllDraggedKinds = Array.from(draggedKinds).every(fileKind => (
      (printer.acceptedKinds || []).includes(fileKind)
    ));

    return acceptsAllDraggedKinds ? 'compatible' : 'invalid';
  };

  const closeLogDrawerForFileDrag = event => {
    if (!isFileDragEvent(event)) return;
    if (!appState.logDrawer || typeof appState.logDrawer.close !== 'function') return;
    appState.logDrawer.close();
  };

  const bindPrinterEvents = () => {
    document.addEventListener('dragenter', closeLogDrawerForFileDrag);

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

    document.addEventListener('click', event => {
      if (!appState.openPrinterId) return;
      if (event.target.closest('[data-role="printer-card"]')) return;
      setOpenPrinter(null);
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
      setCardFileCount(card, detectDraggedFileCount(event));
      setCardHighlight(card, getCardDragHighlightMode(card, event));
    });

    printerGrid.addEventListener('dragover', event => {
      const card = event.target.closest('[data-role="printer-card"]');
      if (!card) return;

      event.preventDefault();
      const highlightMode = getCardDragHighlightMode(card, event);
      setCardFileCount(card, detectDraggedFileCount(event));
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = highlightMode === 'invalid' ? 'none' : 'copy';
      }
      setCardHighlight(card, highlightMode);
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
      closeLogDrawerForFileDrag(event);
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
      appState.logDrawer = window.createPrintifyLogDrawer(PRINTIFY_LOG_ROUTE);
    }
  };

  const bootStatsSocket = () => {
    if (!('WebSocket' in window)) return;

    const reconnectDelayMs = 2500;
    const connect = () => {
      if (
        appState.statsSocket
        && (
          appState.statsSocket.readyState === window.WebSocket.OPEN
          || appState.statsSocket.readyState === window.WebSocket.CONNECTING
        )
      ) {
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new window.WebSocket(`${protocol}//${window.location.host}/ws/logs`);
      appState.statsSocket = socket;

      socket.addEventListener('message', event => {
        let payload = null;

        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          payload = null;
        }

        if (payload?.type === 'printers-updated') {
          queuePrinterStateRefresh();
          return;
        }

        queueServerStateRefresh();
      });

      socket.addEventListener('close', () => {
        if (appState.statsSocket === socket) {
          appState.statsSocket = null;
        }

        if (appState.statsSocketReconnectTimer) return;

        appState.statsSocketReconnectTimer = window.setTimeout(() => {
          appState.statsSocketReconnectTimer = null;
          connect();
        }, reconnectDelayMs);
      });

      socket.addEventListener('error', () => {
        socket.close();
      });
    };

    connect();
  };

  const bootLabelBuilder = () => {
    if (typeof window.createPrintifyLabelBuilder !== 'function') return;

    appState.labelBuilder = window.createPrintifyLabelBuilder({
      onPrint: (printer, files, extraFields) => handlePrinterFiles(printer.id, files, extraFields),
      onError: error => showFeedback(error.message),
      closeOnPrint: false,
    });
  };

  const isTypingContext = target => {
    if (!target || !(target instanceof Element)) return false;

    if (target.closest('input, textarea, select, [contenteditable="true"]')) {
      return true;
    }

    return target.getAttribute('contenteditable') === 'true';
  };

  const resetHiddenTriggerBuffer = () => {
    appState.hiddenTriggerBuffer = '';

    if (appState.hiddenTriggerTimer) {
      window.clearTimeout(appState.hiddenTriggerTimer);
      appState.hiddenTriggerTimer = null;
    }
  };

  const queueHiddenTriggerReset = () => {
    if (appState.hiddenTriggerTimer) {
      window.clearTimeout(appState.hiddenTriggerTimer);
    }

    appState.hiddenTriggerTimer = window.setTimeout(() => {
      resetHiddenTriggerBuffer();
    }, 1200);
  };

  const loadClientPluginModule = async pluginConfig => {
    const scriptUrl = String(pluginConfig?.scriptUrl || '').trim();

    if (!scriptUrl) {
      throw new Error(`Client plugin "${pluginConfig?.id || 'unknown'}" is missing a script URL.`);
    }

    if (!appState.clientPluginModules[scriptUrl]) {
      appState.clientPluginModules[scriptUrl] = import(scriptUrl);
    }

    return appState.clientPluginModules[scriptUrl];
  };

  const activateClientPlugin = async pluginId => {
    const pluginConfig = appState.clientPluginsById[pluginId];

    if (!pluginConfig) {
      throw new Error(`Client plugin "${pluginId}" is not enabled.`);
    }

    const pluginModule = await loadClientPluginModule(pluginConfig);

    if (typeof pluginModule.activatePlugin !== 'function') {
      throw new Error(`Client plugin "${pluginId}" does not expose an activatePlugin() entry.`);
    }

    return pluginModule.activatePlugin(pluginConfig, {
      showFeedback,
    });
  };

  const bindClientPluginTriggers = () => {
    document.addEventListener('keydown', async event => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingContext(event.target)) return;

      const key = String(event.key || '');

      if (key.length !== 1) {
        return;
      }

      const nextBuffer = `${appState.hiddenTriggerBuffer}${key}`.slice(-12);
      appState.hiddenTriggerBuffer = nextBuffer;
      queueHiddenTriggerReset();

      const enabledPlugins = Object.values(appState.clientPluginsById);
      const matchedPlugin = enabledPlugins.find(pluginConfig => (
        pluginConfig?.triggerCode
        && nextBuffer.endsWith(String(pluginConfig.triggerCode))
      ));

      if (!matchedPlugin) {
        return;
      }

      resetHiddenTriggerBuffer();

      try {
        await activateClientPlugin(matchedPlugin.id);
      } catch (error) {
        showFeedback(error.message || 'Could not open client plugin.');
        console.error(error);
      }
    });
  };

  const bootClippy = () => {
    if (appState.assistant === 'none') return;
    if (!window.clippy) return;

    window.clippy.load(appState.assistant, agent => {
      appState.assistantAgent = agent;
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
          printCounter: appState.exactPrintCounter || appState.printCounter,
          pageCounter: appState.pageCounter,
          actualPrintCounter: appState.actualPrintCounter,
          actualPageCounter: appState.actualPageCounter,
          testingPrintCounter: appState.testingPrintCounter,
          testingPageCounter: appState.testingPageCounter,
          paperAreaSquareMm: appState.paperAreaSquareMm,
          actualPaperAreaSquareMm: appState.actualPaperAreaSquareMm,
          testingPaperAreaSquareMm: appState.testingPaperAreaSquareMm,
          testing: appState.testing,
          pageHits: appState.pageHits,
          printers: appState.printers,
          serverVersion: appState.serverVersion,
          serverDataVersion: appState.serverDataVersion,
          lastStartedAt: appState.lastStartedAt,
          lastPrintAt: appState.lastPrintAt,
          lastPrintJob: appState.lastPrintJob,
          dailyStats: appState.dailyStats,
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
    bindClientPluginTriggers();
    bootLogDrawer();
    bootLabelBuilder();
    bootStatsSocket();

    try {
      await Promise.all([
        loadVersion({ updateFooter: true }),
        loadPrinters(),
        loadClientPlugins(),
      ]);
      window.addEventListener('resize', updatePrinterGridVerticalOffset);
      bootClippy();
    } catch (error) {
      showFeedback('Could not load printer configuration from the server.');
      console.error(error);
    }
  };

  boot();
}());
