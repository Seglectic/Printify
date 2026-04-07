(function () {
  // ╭──────────────────────────╮
  // │  Shared constants        │
  // ╰──────────────────────────╯
  const APP_VERSION = '2.5.0';
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
  const DUPLICATE_LOOKBACK_MINUTES = 24 * 60;
  const DUPLICATE_WHITELIST_STORAGE_KEY = 'printify-duplicate-whitelist';
  const DUPLICATE_WHITELIST_DURATION_MS = 24 * 60 * 60 * 1000;
  const DUPLICATE_PROMPTS = [
    'This file has been printed recently, send it?',
    'File printed within the last 24 hours, print again?',
    'This one already went through today. Send it?',
    'Recent match found for this file. Run another?',
    'This document was already printed not long ago. Send it anyway?',
    'Looks like this file has been used recently. Print once more?',
    'Duplicate in the last day detected. Send it through?',
    'This print job shows up in the last 24 hours. Print again?',
    'A recent copy of this file was already sent. Queue another one?',
    'This document has a fresh print history. Send it again?',
  ];

  const appState = {
    printers: [],
    pageHits: 0,
    printCounter: 0,
    serverVersion: 'Unknown',
    clippyEnabled: true,
    feedbackTimer: null,
    clippyAgent: null,
    labelBuilder: null,
    logDrawer: null,
    openPrinterId: null,
  };

  const dragDepth = new Map();
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
  const pickRandomPrompt = () => DUPLICATE_PROMPTS[Math.floor(Math.random() * DUPLICATE_PROMPTS.length)];

  const formatPixels = ({ width, height }) => `${Math.round(width)}x${Math.round(height)}px`;

  const formatPercent = value => {
    if (!Number.isFinite(value)) return '0';
    const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  const showFeedback = message => {
    if (appState.clippyEnabled && appState.clippyAgent && typeof appState.clippyAgent.speak === 'function') {
      appState.clippyAgent.speak(message);
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
  const loadVersion = () => fetch('/version')
    .then(response => response.json())
    .then(serverData => {
      appState.serverVersion = serverData.version;
      appState.pageHits = serverData.pageHits;
      appState.printCounter = serverData.printCounter;
      appState.clippyEnabled = serverData.clippy !== false;
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
      const parsedEntries = Array.isArray(parsedValue)
        ? parsedValue
        : [];
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

  const createFileChecksum = async file => {
    const fileBytes = await file.arrayBuffer();
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', fileBytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  };

  const loadRecentLogJobs = () => {
    const url = new URL('/logs/recent', window.location.origin);
    url.searchParams.set('lookBack', String(DUPLICATE_LOOKBACK_MINUTES));

    return fetch(url.toString())
      .then(response => response.json())
      .then(payload => Array.isArray(payload.jobs) ? payload.jobs : []);
  };

  const buildDuplicateChecksByFile = async files => {
    const recentJobs = await loadRecentLogJobs();
    const recentJobsByChecksum = new Map();

    recentJobs.forEach(job => {
      if (!job?.chksum) return;
      if (!recentJobsByChecksum.has(job.chksum)) {
        recentJobsByChecksum.set(job.chksum, job);
      }
    });

    const duplicateChecks = new Map();

    for (const file of files) {
      const fileKind = detectFileKind(file);

      if (!fileKind || fileKind === 'zip') continue;

      const checksum = await createFileChecksum(file);
      const recentMatch = recentJobsByChecksum.get(checksum) || null;

      duplicateChecks.set(file, {
        checksum,
        recentMatch,
      });
    }

    return duplicateChecks;
  };

  const confirmDuplicateFiles = async files => {
    const duplicateChecks = await buildDuplicateChecksByFile(files);

    for (const file of files) {
      const duplicateCheck = duplicateChecks.get(file);

      if (!duplicateCheck?.recentMatch) continue;
      if (isDuplicateChecksumWhitelisted(duplicateCheck.checksum)) continue;

      const accepted = await showPromptCard({
        tone: 'warning',
        eyebrow: 'Recent Match',
        title: 'Duplicate Detected',
        message: pickRandomPrompt(),
        subtext: 'You will not be warned again for this file.',
        confirmLabel: 'Send It',
        cancelLabel: 'Cancel',
      });

      if (!accepted) {
        return null;
      }

      whitelistDuplicateChecksum(duplicateCheck.checksum);
    }

    return duplicateChecks;
  };

  const getRequestedReprintCopyCount = (fileKind, extraFields = {}) => {
    if (fileKind !== 'image') return 1;

    const requestedCopies = Number.parseInt(extraFields.printCount || extraFields.copyCount, 10);
    return Number.isFinite(requestedCopies)
      ? Math.min(Math.max(requestedCopies, 1), 50)
      : 1;
  };

  const tryDirectReprint = async (duplicateCheck, fileKind, extraFields = {}) => {
    if (!duplicateCheck?.recentMatch) return false;

    const response = await fetch('/logs/reprint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timestamp: duplicateCheck.recentMatch.timestamp,
        printerId: duplicateCheck.recentMatch.printerId,
        chksum: duplicateCheck.recentMatch.chksum,
        copyCount: getRequestedReprintCopyCount(fileKind, extraFields),
      }),
    });

    return response.ok;
  };

  const uploadGroupedFiles = async (printer, groupedFiles, extraFields = {}, duplicateChecks = new Map()) => {
    const groupEntries = Object.entries(groupedFiles);

    if (!groupEntries.length) {
      throw new Error('No valid files were supplied.');
    }

    for (const [fileKind, files] of groupEntries) {
      const filesNeedingUpload = [];

      for (const file of files) {
        const duplicateCheck = duplicateChecks.get(file);
        const canReuseExistingFile = duplicateCheck?.recentMatch
          && duplicateCheck.recentMatch.printerId === printer.id;

        if (!canReuseExistingFile) {
          filesNeedingUpload.push(file);
          continue;
        }

        const reusedExistingFile = await tryDirectReprint(duplicateCheck, fileKind, extraFields);

        if (!reusedExistingFile) {
          filesNeedingUpload.push(file);
        }
      }

      if (!filesNeedingUpload.length) {
        continue;
      }

      const routePath = filesNeedingUpload.length > 1
        ? `/${printer.id}/${fileKind}/multi`
        : `/${printer.id}/${fileKind}`;
      const formData = new FormData();

      filesNeedingUpload.forEach(file => {
        formData.append(PRINTIFY_FILE_KINDS[fileKind].fieldName, file, file.name);
      });

      const jobMetaList = filesNeedingUpload.map(file => {
        const duplicateCheck = duplicateChecks.get(file);

        if (!duplicateCheck) {
          return {};
        }

        if (!duplicateCheck.recentMatch) {
          return {
            chksum: duplicateCheck.checksum,
          };
        }

        return {
          chksum: duplicateCheck.checksum,
          isReprint: true,
          reprintSourceTimestamp: duplicateCheck.recentMatch.timestamp || null,
        };
      });

      Object.entries(extraFields).forEach(([fieldName, fieldValue]) => {
        if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
          formData.append(fieldName, fieldValue);
        }
      });

      formData.append('jobMetaList', JSON.stringify(jobMetaList));

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
    const duplicateChecks = await confirmDuplicateFiles(Array.from(files));

    if (duplicateChecks === null) {
      return;
    }

    await uploadGroupedFiles(printer, groupedFiles, extraFields, duplicateChecks);
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

  const isFileDragEvent = event => {
    const transferTypes = event.dataTransfer?.types;

    if (!transferTypes) return false;

    return Array.from(transferTypes).includes('Files');
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

  const bootLabelBuilder = () => {
    if (typeof window.createPrintifyLabelBuilder !== 'function') return;

    appState.labelBuilder = window.createPrintifyLabelBuilder({
      onPrint: (printer, files, extraFields) => handlePrinterFiles(printer.id, files, extraFields),
      onError: error => showFeedback(error.message),
    });
  };

  const bootClippy = () => {
    if (!appState.clippyEnabled) return;
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
