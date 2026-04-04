(function () {
  // ╭──────────────────────────╮
  // │  Shared drawer markup    │
  // ╰──────────────────────────╯
  const buildDrawerMarkup = () => `
    <button class="printify-log-drawer__toggle" type="button" data-role="toggle">Logs</button>
    <div class="printify-log-drawer__scrim" data-role="scrim"></div>
    <aside class="printify-log-drawer__panel" data-role="panel">
      <div class="printify-log-drawer__header">
        <div class="printify-log-drawer__header-top">
          <h2 class="printify-log-drawer__title">Printify Logs</h2>
          <button class="printify-log-drawer__close" type="button" data-role="close">Close</button>
        </div>
        <div class="printify-log-drawer__toolbar">
          <p class="printify-log-drawer__subhead" data-role="subhead">Recent print logs from the last 60 minutes.</p>
          <button class="printify-log-drawer__window-button" type="button" data-role="window-button">60 minutes</button>
        </div>
      </div>
      <div class="printify-log-drawer__list" data-role="list">
        <div class="printify-log-drawer__empty">Loading recent print jobs...</div>
      </div>
    </aside>
    <div class="printify-log-drawer__preview-pane" data-role="preview-pane" hidden>
      <div class="printify-log-drawer__preview-card">
        <div class="printify-log-drawer__preview-header">
          <div>
            <p class="printify-log-drawer__preview-eyebrow">Logged Preview</p>
            <h3 class="printify-log-drawer__preview-title" data-role="preview-title">Print Preview</h3>
          </div>
          <button class="printify-log-drawer__preview-close" type="button" data-role="preview-close">Close</button>
        </div>
        <div class="printify-log-drawer__preview-body">
          <img class="printify-log-drawer__preview-image" data-role="preview-image" alt="">
          <div class="printify-log-drawer__preview-meta" data-role="preview-meta"></div>
        </div>
        <div class="printify-log-drawer__preview-actions">
          <label class="printify-log-drawer__preview-field" for="printifyLogDrawerCopies">
            Copies
            <input class="printify-log-drawer__preview-input" id="printifyLogDrawerCopies" data-role="preview-copies" type="number" min="1" max="50" value="1">
          </label>
          <button class="printify-log-drawer__preview-button printify-log-drawer__preview-button--secondary" type="button" data-role="preview-open">Open Image</button>
          <button class="printify-log-drawer__preview-button printify-log-drawer__preview-button--primary" type="button" data-role="preview-print">Reprint</button>
        </div>
        <p class="printify-log-drawer__preview-status" data-role="preview-status"></p>
      </div>
    </div>
  `;

  // ╭──────────────────────────╮
  // │  Text formatting         │
  // ╰──────────────────────────╯
  const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const formatTimestamp = timestamp => {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) return 'Unknown time';

    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatDetailValue = value => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  };

  const formatChecksumMarkup = checksum => {
    const safeChecksum = escapeHtml(checksum || 'Checksum unavailable');

    if (!checksum || checksum.length !== 64) return safeChecksum;

    return [
      `<span class="printify-log-drawer__checksum-line">${safeChecksum.slice(0, 32)}</span>`,
      `<span class="printify-log-drawer__checksum-line">${safeChecksum.slice(32, 64)}</span>`,
    ].join('');
  };

  // ╭──────────────────────────╮
  // │  Drawer factory          │
  // ╰──────────────────────────╯
  function createPrintifyLogDrawer(rootSelector, options) {
    const LOOKBACK_OPTIONS = [30, 60, 360, 720, 1440];
    const WINDOW_STORAGE_KEY = 'printify-log-window';
    const settings = Object.assign({
      recentLogsUrl: '/logs/recent',
      printersUrl: '/printers',
      reprintUrl: '/logs/reprint',
      websocketPath: '/ws/logs',
      reconnectDelayMs: 2500,
    }, options || {});

    const root = document.querySelector(rootSelector);

    if (!root) return null;
    if (!root.innerHTML.trim()) root.innerHTML = buildDrawerMarkup();

    const panel = root.querySelector('[data-role="panel"]');
    const scrim = root.querySelector('[data-role="scrim"]');
    const list = root.querySelector('[data-role="list"]');
    const toggle = root.querySelector('[data-role="toggle"]');
    const close = root.querySelector('[data-role="close"]');
    const subhead = root.querySelector('[data-role="subhead"]');
    const windowButton = root.querySelector('[data-role="window-button"]');
    const previewPane = root.querySelector('[data-role="preview-pane"]');
    const previewTitle = root.querySelector('[data-role="preview-title"]');
    const previewImage = root.querySelector('[data-role="preview-image"]');
    const previewMeta = root.querySelector('[data-role="preview-meta"]');
    const previewCopies = root.querySelector('[data-role="preview-copies"]');
    const previewStatus = root.querySelector('[data-role="preview-status"]');
    const previewClose = root.querySelector('[data-role="preview-close"]');
    const previewOpen = root.querySelector('[data-role="preview-open"]');
    const previewPrint = root.querySelector('[data-role="preview-print"]');

    let logSocket = null;
    let reconnectTimer = null;
    let reloadTimer = null;
    let currentJobs = [];
    const storedWindowMinutes = Number.parseInt(window.localStorage.getItem(WINDOW_STORAGE_KEY), 10);
    let currentWindowIndex = LOOKBACK_OPTIONS.indexOf(
      LOOKBACK_OPTIONS.includes(storedWindowMinutes) ? storedWindowMinutes : 60
    );
    let printerIconsById = {};
    let selectedPreviewJobKey = null;
    let previousJobKeys = new Set();
    const expandedJobKeys = new Set();
    const highlightedJobKeys = new Map();
    const highlightDurationMs = 1800;
    const getCurrentWindowMinutes = () => LOOKBACK_OPTIONS[currentWindowIndex] || 60;
    const formatWindowLabel = windowMinutes => {
      if (windowMinutes < 60) return `${windowMinutes} minutes`;
      if (windowMinutes === 60) return 'hour';
      if (windowMinutes % 60 === 0) return `${windowMinutes / 60} hours`;
      return `${windowMinutes} minutes`;
    };

    const syncWindowUi = () => {
      const windowMinutes = getCurrentWindowMinutes();
      if (subhead) subhead.textContent = `Recent print logs from the last ${formatWindowLabel(windowMinutes)}.`;
      if (windowButton) windowButton.textContent = formatWindowLabel(windowMinutes);
    };

    const getJobKey = job => [
      job.timestamp || '',
      job.printerId || '',
      job.originalFilename || '',
      job.chksum || '',
    ].join('|');

    const renderDetailsMarkup = job => {
      const details = [
        ['Printer', job.displayName || job.printerName],
        ['Result', job.result],
        ['Testing', job.testing],
        ['Print Mode', job.printMode],
        ['Source Type', job.sourceType],
        ['Source Route', job.sourceRoute],
        ['Stored Name', job.storedFilename],
        ['Archive', job.sourceArchiveName],
        ['Bundled Pages', job.bundledSourceCount],
        ['Copy', job.copyIndex],
        ['Total Copies', job.totalCopies],
        ['File Path', job.filePath],
        ['Transport', job.transportResponse],
        ['Error', job.error],
      ].filter(([, value]) => formatDetailValue(value) !== null);

      if (!details.length) return '';

      return details.map(([label, value]) => `
        <div class="printify-log-drawer__detail">
          <div class="printify-log-drawer__detail-label">${escapeHtml(label)}</div>
          <div class="printify-log-drawer__detail-value">${escapeHtml(formatDetailValue(value))}</div>
        </div>
      `).join('');
    };

    const findJobByKey = jobKey => currentJobs.find(job => getJobKey(job) === jobKey) || null;

    const formatPreviewMeta = job => [
      job.displayName || job.printerName || job.printerId,
      formatTimestamp(job.timestamp),
      job.result || 'Unknown result',
    ].filter(Boolean).join(' | ');

    const closePreviewPane = () => {
      selectedPreviewJobKey = null;
      if (previewPane) previewPane.hidden = true;
      if (previewStatus) previewStatus.textContent = '';
    };

    const syncPreviewPane = () => {
      if (!previewPane) return;

      const job = selectedPreviewJobKey ? findJobByKey(selectedPreviewJobKey) : null;

      if (!job || !job.previewUrl) {
        closePreviewPane();
        return;
      }

      previewPane.hidden = false;
      previewTitle.textContent = job.originalFilename || 'Print Preview';
      previewImage.src = job.previewUrl;
      previewImage.alt = `Preview for ${job.originalFilename || 'print job'}`;
      previewMeta.textContent = formatPreviewMeta(job);
      previewOpen.disabled = false;
      previewPrint.disabled = !job.filePath || !job.printerId || !job.chksum;
      previewStatus.textContent = previewPrint.disabled ? 'This preview can be inspected, but the original file is no longer available for reprint.' : '';
    };

    const pruneHighlightedJobKeys = () => {
      const now = Date.now();

      highlightedJobKeys.forEach((expiresAt, jobKey) => {
        if (expiresAt <= now) highlightedJobKeys.delete(jobKey);
      });
    };

    const renderLogs = jobs => {
      currentJobs = jobs;

      if (!jobs.length) {
        previousJobKeys = new Set();
        highlightedJobKeys.clear();
        list.innerHTML = `<div class="printify-log-drawer__empty">No print jobs were logged in the last ${formatWindowLabel(getCurrentWindowMinutes())}.</div>`;
        return;
      }

      pruneHighlightedJobKeys();
      const nextJobKeys = new Set(jobs.map(getJobKey));

      list.innerHTML = jobs.map(job => {
        const jobKey = getJobKey(job);
        const justArrived = previousJobKeys.size > 0 && !previousJobKeys.has(jobKey);

        if (justArrived) highlightedJobKeys.set(jobKey, Date.now() + highlightDurationMs);

        const isNew = highlightedJobKeys.has(jobKey);
        const isOpen = expandedJobKeys.has(jobKey);
        const iconPath = job.iconUrl || printerIconsById[job.printerId] || '/favicon.ico';
        const printerLabel = escapeHtml(job.displayName || job.printerName || job.printerId || 'Unknown printer');

        return `
          <article class="printify-log-drawer__card${isNew ? ' is-new' : ''}${isOpen ? ' is-open' : ''}" data-role="log-card" data-job-key="${escapeHtml(jobKey)}">
            <div class="printify-log-drawer__row">
              <img class="printify-log-drawer__icon" src="${iconPath}" alt="${printerLabel}">
              <div class="printify-log-drawer__main">
                <h3 class="printify-log-drawer__filename">${escapeHtml(job.originalFilename || 'Unnamed file')}</h3>
                <div class="printify-log-drawer__meta">${printerLabel} | ${escapeHtml(formatTimestamp(job.timestamp))}</div>
              </div>
              ${job.previewUrl ? `<button class="printify-log-drawer__preview-trigger" type="button" data-role="preview-trigger"><img class="printify-log-drawer__preview" src="${escapeHtml(job.previewUrl)}" alt="Preview for ${escapeHtml(job.originalFilename || 'print job')}" loading="lazy"></button>` : ''}
            </div>
            <div class="printify-log-drawer__checksum">
              <button class="printify-log-drawer__checksum-button" type="button" data-role="checksum-select">
                ${formatChecksumMarkup(job.chksum)}
              </button>
            </div>
            <div class="printify-log-drawer__details">${renderDetailsMarkup(job)}</div>
          </article>
        `;
      }).join('');

      previousJobKeys = nextJobKeys;
    };

    const loadPrinters = () => fetch(settings.printersUrl)
      .then(response => response.json())
      .then(payload => {
        printerIconsById = Object.fromEntries(
          (payload.printers || []).map(printer => [printer.id, printer.iconUrl || '/favicon.ico'])
        );
      })
      .catch(() => {
        printerIconsById = {};
      });

    const loadRecentLogs = () => {
      const url = new URL(settings.recentLogsUrl, window.location.origin);
      url.searchParams.set('lookBack', String(getCurrentWindowMinutes()));

      return fetch(url.toString())
      .then(response => response.json())
      .then(payload => {
        renderLogs(payload.jobs || []);
        syncPreviewPane();
      })
      .catch(() => {
        list.innerHTML = '<div class="printify-log-drawer__empty">Could not load recent log data from the server.</div>';
      });
    };

    const queueRecentLogReload = () => {
      if (reloadTimer) window.clearTimeout(reloadTimer);

      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        loadRecentLogs();
      }, 500);
    };

    const setOpenState = isOpen => {
      panel.classList.toggle('is-open', isOpen);
      scrim.classList.toggle('is-open', isOpen);
      toggle.classList.toggle('is-hidden', isOpen);
    };

    const openDrawer = () => {
      setOpenState(true);
      return loadPrinters().finally(loadRecentLogs);
    };

    const scheduleReconnect = () => {
      if (reconnectTimer) return;

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectLogSocket();
      }, settings.reconnectDelayMs);
    };

    const connectLogSocket = () => {
      if (!('WebSocket' in window)) return;
      if (logSocket && (logSocket.readyState === window.WebSocket.OPEN || logSocket.readyState === window.WebSocket.CONNECTING)) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      logSocket = new window.WebSocket(`${protocol}//${window.location.host}${settings.websocketPath}`);

      logSocket.addEventListener('message', () => {
        loadRecentLogs();
      });

      logSocket.addEventListener('close', () => {
        scheduleReconnect();
      });

      logSocket.addEventListener('error', () => {
        if (logSocket) logSocket.close();
      });
    };

    // ╭──────────────────────────╮
    // │  Event wiring            │
    // ╰──────────────────────────╯
    toggle.addEventListener('click', () => {
      const shouldOpen = !panel.classList.contains('is-open');

      if (shouldOpen) {
        openDrawer();
      } else {
        setOpenState(false);
      }
    });

    close.addEventListener('click', () => {
      setOpenState(false);
    });

    windowButton.addEventListener('click', () => {
      currentWindowIndex = (currentWindowIndex + 1) % LOOKBACK_OPTIONS.length;
      window.localStorage.setItem(WINDOW_STORAGE_KEY, String(getCurrentWindowMinutes()));
      syncWindowUi();
      queueRecentLogReload();
    });

    scrim.addEventListener('click', () => {
      setOpenState(false);
    });

    list.addEventListener('click', event => {
      const previewTrigger = event.target.closest('[data-role="preview-trigger"]');

      if (previewTrigger) {
        event.stopPropagation();
        const card = previewTrigger.closest('[data-role="log-card"]');
        if (!card) return;
        selectedPreviewJobKey = card.getAttribute('data-job-key');
        syncPreviewPane();
        return;
      }

      const checksumButton = event.target.closest('[data-role="checksum-select"]');

      if (checksumButton) {
        event.stopPropagation();
        return;
      }

      const card = event.target.closest('[data-role="log-card"]');

      if (!card) return;

      const jobKey = card.getAttribute('data-job-key');

      if (expandedJobKeys.has(jobKey)) {
        expandedJobKeys.delete(jobKey);
      } else {
        expandedJobKeys.add(jobKey);
      }

      renderLogs(currentJobs);
    });

    previewClose?.addEventListener('click', () => {
      closePreviewPane();
    });

    previewOpen?.addEventListener('click', () => {
      const job = selectedPreviewJobKey ? findJobByKey(selectedPreviewJobKey) : null;
      if (!job?.previewUrl) return;
      window.open(job.previewUrl, '_blank', 'noopener,noreferrer');
    });

    previewPrint?.addEventListener('click', () => {
      const job = selectedPreviewJobKey ? findJobByKey(selectedPreviewJobKey) : null;

      if (!job || !job.printerId || !job.chksum || !job.timestamp) return;

      const copyCount = Number.parseInt(previewCopies?.value, 10);
      const normalizedCopyCount = Number.isFinite(copyCount)
        ? Math.min(Math.max(copyCount, 1), 50)
        : 1;

      previewPrint.disabled = true;
      previewStatus.textContent = normalizedCopyCount > 1
        ? `Sending ${normalizedCopyCount} copies...`
        : 'Sending reprint...';

      fetch(settings.reprintUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timestamp: job.timestamp,
          printerId: job.printerId,
          chksum: job.chksum,
          copyCount: normalizedCopyCount,
        }),
      })
        .then(async response => {
          if (!response.ok) {
            throw new Error(await response.text() || 'Reprint failed');
          }

          return response.json();
        })
        .then(payload => {
          previewStatus.textContent = payload.copyCount > 1
            ? `Queued ${payload.copyCount} copies.`
            : 'Queued 1 copy.';
          queueRecentLogReload();
        })
        .catch(error => {
          previewStatus.textContent = error.message;
        })
        .finally(() => {
          previewPrint.disabled = false;
        });
    });

    document.addEventListener('click', event => {
      if (previewPane?.hidden) return;

      const clickedInsidePreview = event.target.closest('[data-role="preview-pane"]');
      const clickedPreviewTrigger = event.target.closest('[data-role="preview-trigger"]');

      if (clickedInsidePreview || clickedPreviewTrigger) return;

      closePreviewPane();
    });

    list.addEventListener('dblclick', event => {
      const checksumButton = event.target.closest('[data-role="checksum-select"]');

      if (!checksumButton) return;

      event.stopPropagation();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(checksumButton);
      selection.removeAllRanges();
      selection.addRange(range);
    });

    document.addEventListener('keydown', event => {
      const isTypingTarget = ['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable;

      if (isTypingTarget && event.key !== 'Escape') return;

      if (event.key === 'ArrowLeft') {
        const shouldOpen = !panel.classList.contains('is-open');

        if (shouldOpen) {
          openDrawer();
        } else {
          setOpenState(false);
        }

        return;
      }

      if (event.key === 'Escape') {
        if (!previewPane?.hidden) {
          closePreviewPane();
          return;
        }

        setOpenState(false);
      }
    });

    syncWindowUi();
    loadRecentLogs();
    connectLogSocket();

    return {
      open: openDrawer,
      close: () => setOpenState(false),
      reload: loadRecentLogs,
    };
  }

  window.createPrintifyLogDrawer = createPrintifyLogDrawer;
}());
