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
          <div class="printify-log-drawer__window-picker">
            <button class="printify-log-drawer__window-button" type="button" data-role="window-button">60 minutes</button>
            <div class="printify-log-drawer__window-menu" data-role="window-menu" hidden></div>
          </div>
        </div>
      </div>
      <div class="printify-log-drawer__list" data-role="list">
        <div class="printify-log-drawer__empty">Loading recent print jobs...</div>
      </div>
      <div class="printify-log-drawer__batch" data-role="batch">
        <button class="printify-log-drawer__batch-button" type="button" data-role="batch-button">
          <span>REPRINT</span>
          <span>BATCH</span>
        </button>
        <label class="printify-log-drawer__batch-field" for="printifyLogDrawerBatchCopies">
          Copies
          <input class="printify-log-drawer__batch-input" id="printifyLogDrawerBatchCopies" data-role="batch-copies" type="number" min="1" max="50" value="1">
        </label>
        <p class="printify-log-drawer__batch-status" data-role="batch-status"></p>
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
    <div class="printify-log-drawer__confirm-pane" data-role="confirm-pane" hidden>
      <div class="printify-log-drawer__confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="printifyLogDrawerConfirmTitle" aria-describedby="printifyLogDrawerConfirmMessage">
        <p class="printify-log-drawer__confirm-eyebrow">Batch Reprint</p>
        <h3 class="printify-log-drawer__confirm-title" id="printifyLogDrawerConfirmTitle">Confirm batch reprint</h3>
        <p class="printify-log-drawer__confirm-message" id="printifyLogDrawerConfirmMessage" data-role="confirm-message"></p>
        <div class="printify-log-drawer__confirm-actions">
          <button class="printify-log-drawer__confirm-button printify-log-drawer__confirm-button--secondary" type="button" data-role="confirm-cancel">Cancel</button>
          <button class="printify-log-drawer__confirm-button printify-log-drawer__confirm-button--primary" type="button" data-role="confirm-submit">Reprint</button>
        </div>
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

    const now = new Date();
    const isToday = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();

    if (!isToday) {
      const sameYear = date.getFullYear() === now.getFullYear();

      return date.toLocaleDateString([], sameYear
        ? {
            month: 'short',
            day: 'numeric',
          }
        : {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
    }

    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatDetailedTimestamp = timestamp => {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) return null;

    return date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
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

    if (!checksum || checksum.length !== 64) return `<span class="printify-log-drawer__checksum-text">${safeChecksum}</span>`;

    return `
      <span class="printify-log-drawer__checksum-label">HASH</span>
      <span class="printify-log-drawer__checksum-text">${safeChecksum.slice(0, 8)}...${safeChecksum.slice(-8)}</span>
    `;
  };

  const formatJobKind = job => {
    switch (job?.sourceType) {
      case 'log-reprint':
      case 'log-reprint-bundled':
        return 'Reprint';
      case 'upload-pdf':
        return 'Uploaded PDF';
      case 'upload-pdf-bundled':
        return 'Bundled PDF';
      case 'upload-image':
        return 'Uploaded Image';
      case 'upload-image-bundled':
        return 'Bundled Image';
      case 'upload-zip-pdf':
        return 'ZIP PDF';
      default:
        return job?.sourceType || 'Unknown';
    }
  };

  const formatCopiesValue = job => {
    const totalCopies = Number.parseInt(job?.totalCopies, 10);
    const copyIndex = Number.parseInt(job?.copyIndex, 10);

    if (Number.isFinite(copyIndex) && Number.isFinite(totalCopies) && totalCopies > 1) {
      return `${copyIndex} of ${totalCopies}`;
    }

    if (Number.isFinite(totalCopies) && totalCopies > 0) {
      return String(totalCopies);
    }

    return '1';
  };

  const formatRelativeFilePath = filePath => {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/');

    if (!normalizedPath) return null;

    const uploadsIndex = normalizedPath.toLowerCase().lastIndexOf('/uploads/');

    if (uploadsIndex !== -1) {
      return normalizedPath.slice(uploadsIndex + '/uploads/'.length);
    }

    return normalizedPath.replace(/^\/+/, '');
  };

  const formatFileSize = fileSizeBytes => {
    const size = Number(fileSizeBytes);

    if (!Number.isFinite(size) || size < 0) return null;
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 ** 3) return `${(size / (1024 ** 2)).toFixed(1)} MB`;
    return `${(size / (1024 ** 3)).toFixed(1)} GB`;
  };

  // ╭──────────────────────────╮
  // │  Drawer factory          │
  // ╰──────────────────────────╯
  function createPrintifyLogDrawer(rootSelector, options) {
    const LOOKBACK_OPTIONS = [30, 60, 360, 720, 1440, 2880, 10080];
    const WINDOW_STORAGE_KEY = 'printify-log-window';
    const settings = Object.assign({
      recentLogsUrl: '/logs/recent',
      originalLogUrl: '/logs/original',
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
    const windowMenu = root.querySelector('[data-role="window-menu"]');
    const previewPane = root.querySelector('[data-role="preview-pane"]');
    const batch = root.querySelector('[data-role="batch"]');
    const batchButton = root.querySelector('[data-role="batch-button"]');
    const batchCopies = root.querySelector('[data-role="batch-copies"]');
    const batchStatus = root.querySelector('[data-role="batch-status"]');
    const previewTitle = root.querySelector('[data-role="preview-title"]');
    const previewImage = root.querySelector('[data-role="preview-image"]');
    const previewMeta = root.querySelector('[data-role="preview-meta"]');
    const previewCopies = root.querySelector('[data-role="preview-copies"]');
    const previewStatus = root.querySelector('[data-role="preview-status"]');
    const previewClose = root.querySelector('[data-role="preview-close"]');
    const previewOpen = root.querySelector('[data-role="preview-open"]');
    const previewPrint = root.querySelector('[data-role="preview-print"]');
    const confirmPane = root.querySelector('[data-role="confirm-pane"]');
    const confirmMessage = root.querySelector('[data-role="confirm-message"]');
    const confirmCancel = root.querySelector('[data-role="confirm-cancel"]');
    const confirmSubmit = root.querySelector('[data-role="confirm-submit"]');

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
    const selectedJobKeys = new Set();
    const highlightedJobKeys = new Map();
    const highlightDurationMs = 1800;
    let pendingBatchReprint = null;
    const getCurrentWindowMinutes = () => LOOKBACK_OPTIONS[currentWindowIndex] || 60;
    const formatWindowLabel = windowMinutes => {
      if (windowMinutes < 60) return `${windowMinutes} minutes`;
      if (windowMinutes === 60) return 'hour';
      if (windowMinutes === 1440) return 'day';
      if (windowMinutes === 2880) return '2 days';
      if (windowMinutes === 10080) return 'week';
      if (windowMinutes % 1440 === 0) {
        const days = windowMinutes / 1440;
        return days === 1 ? 'day' : `${days} days`;
      }
      if (windowMinutes % 60 === 0) return `${windowMinutes / 60} hours`;
      return `${windowMinutes} minutes`;
    };
    const closeWindowMenu = () => {
      if (!windowMenu) return;
      windowMenu.hidden = true;
      windowButton?.setAttribute('aria-expanded', 'false');
    };
    const openWindowMenu = () => {
      if (!windowMenu) return;
      renderWindowMenu();
      windowMenu.hidden = false;
      windowButton?.setAttribute('aria-expanded', 'true');
    };
    const toggleWindowMenu = () => {
      if (!windowMenu) return;

      if (windowMenu.hidden) {
        openWindowMenu();
      } else {
        closeWindowMenu();
      }
    };
    const setCurrentWindowMinutes = windowMinutes => {
      const nextIndex = LOOKBACK_OPTIONS.indexOf(windowMinutes);

      if (nextIndex === -1) return;

      currentWindowIndex = nextIndex;
      window.localStorage.setItem(WINDOW_STORAGE_KEY, String(getCurrentWindowMinutes()));
      syncWindowUi();
      queueRecentLogReload();
    };
    const renderWindowMenu = () => {
      if (!windowMenu) return;

      windowMenu.innerHTML = LOOKBACK_OPTIONS.map(windowMinutes => {
        const isActive = getCurrentWindowMinutes() === windowMinutes;

        return `
          <button
            class="printify-log-drawer__window-option${isActive ? ' is-active' : ''}"
            type="button"
            data-role="window-option"
            data-window-minutes="${windowMinutes}"
          >
            ${escapeHtml(formatWindowLabel(windowMinutes))}
          </button>
        `;
      }).join('');
    };

    const syncWindowUi = () => {
      const windowMinutes = getCurrentWindowMinutes();
      if (subhead) subhead.textContent = `Recent print logs from the last ${formatWindowLabel(windowMinutes)}.`;
      if (windowButton) windowButton.textContent = formatWindowLabel(windowMinutes);
      renderWindowMenu();
    };

    const getJobKey = job => [
      job.jobId || '',
      job.timestamp || '',
      job.printerId || '',
      job.originalFilename || '',
      job.chksum || '',
    ].join('|');
    const sortJobsNewestFirst = jobs => jobs
      .slice()
      .sort((leftJob, rightJob) => {
        const rightTime = Date.parse(rightJob.timestamp);
        const leftTime = Date.parse(leftJob.timestamp);

        if (rightTime !== leftTime) {
          return rightTime - leftTime;
        }

        return String(rightJob.jobId || '').localeCompare(String(leftJob.jobId || ''));
      });
    const isReprintJob = job => Boolean(job && (job.isReprint || job.sourceType === 'log-reprint'));
    const formatJobFilename = job => {
      const originalFilename = String(job?.originalFilename || 'Unnamed file');
      const totalCopies = Number.parseInt(job?.totalCopies, 10);

      if (!isReprintJob(job) || !Number.isFinite(totalCopies) || totalCopies <= 1) {
        return originalFilename;
      }

      if (/\sx\d+(\.[^./\\]+)?$/i.test(originalFilename)) {
        return originalFilename;
      }

      const extensionMatch = originalFilename.match(/(\.[^./\\]+)$/);

      if (!extensionMatch) {
        return `${originalFilename} x${totalCopies}`;
      }

      const extension = extensionMatch[1];
      const baseName = originalFilename.slice(0, -extension.length);
      return `${baseName} x${totalCopies}${extension}`;
    };
    const buildOriginalLookupUrl = job => {
      const url = new URL(settings.originalLogUrl, window.location.origin);
      url.searchParams.set('chksum', String(job.chksum || ''));

      if (job.timestamp) {
        url.searchParams.set('beforeTimestamp', String(job.timestamp));
      }

      return url.toString();
    };
    const findOriginalJobInCurrentList = job => sortJobsNewestFirst(currentJobs)
      .find(candidateJob => (
        candidateJob
        && !isReprintJob(candidateJob)
        && candidateJob.chksum
        && candidateJob.chksum === job.chksum
        && (!job.timestamp || Date.parse(candidateJob.timestamp) < Date.parse(job.timestamp))
      )) || null;
    const upsertCurrentJob = job => {
      const jobsByKey = new Map(currentJobs.map(currentJob => [getJobKey(currentJob), currentJob]));
      jobsByKey.set(getJobKey(job), job);
      renderLogs(sortJobsNewestFirst(Array.from(jobsByKey.values())));
      syncPreviewPane();
    };
    const scrollToJobKey = jobKey => {
      highlightedJobKeys.set(jobKey, Date.now() + highlightDurationMs);
      expandedJobKeys.add(jobKey);
      renderLogs(currentJobs);

      window.requestAnimationFrame(() => {
        const selectorValue = window.CSS?.escape
          ? window.CSS.escape(jobKey)
          : jobKey.replace(/["\\]/g, '\\$&');
        const targetCard = list.querySelector(`[data-job-key="${selectorValue}"]`);

        if (!targetCard) return;

        targetCard.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    };
    const jumpToOriginalLog = job => {
      if (!isReprintJob(job) || !job.chksum) return Promise.resolve();

      const localOriginalJob = findOriginalJobInCurrentList(job);

      if (localOriginalJob) {
        scrollToJobKey(getJobKey(localOriginalJob));
        return Promise.resolve();
      }

      return fetch(buildOriginalLookupUrl(job))
        .then(async response => {
          if (!response.ok) {
            throw new Error(await response.text() || 'Original log entry not found');
          }

          return response.json();
        })
        .then(payload => {
          if (!payload.job) return;
          upsertCurrentJob(payload.job);
          scrollToJobKey(getJobKey(payload.job));
        })
        .catch(() => {});
    };

    const renderDetailsMarkup = job => {
      const details = [
        ['Status', job.result],
        ['Job Kind', formatJobKind(job)],
        ['Reprint', isReprintJob(job)],
        ...(isReprintJob(job) && job.reprintSourceTimestamp
          ? [['Original Print Time', formatDetailedTimestamp(job.reprintSourceTimestamp)]]
          : []),
        ['Copies', formatCopiesValue(job)],
        ['File Size', formatFileSize(job.fileSizeBytes)],
        ['File Path', formatRelativeFilePath(job.filePath)],
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
    const getSelectedJobs = () => currentJobs.filter(job => selectedJobKeys.has(getJobKey(job)));
    const getSelectedReprintJobs = () => getSelectedJobs()
      .filter(job => job && job.filePath && job.printerId && job.chksum && job.timestamp);
    const normalizeCopyCount = rawValue => {
      const copyCount = Number.parseInt(rawValue, 10);

      return Number.isFinite(copyCount)
        ? Math.min(Math.max(copyCount, 1), 50)
        : 1;
    };
    const formatPlural = (count, singular, plural = `${singular}s`) => (
      count === 1 ? singular : plural
    );
    const buildBatchReprintRequests = (jobs, requestedCopyCount) => {
      const groupedRequests = new Map();

      jobs
        .filter(job => job && job.filePath && job.printerId && job.chksum && job.timestamp)
        .forEach(job => {
          const requestKey = `${job.printerId}::${job.chksum}`;
          const currentRequest = groupedRequests.get(requestKey);
          const jobTime = Date.parse(job.timestamp) || 0;

          if (!currentRequest) {
            groupedRequests.set(requestKey, {
              timestamp: job.timestamp,
              printerId: job.printerId,
              chksum: job.chksum,
              copyCount: requestedCopyCount,
              selectedCount: 1,
              sourceJob: job,
            });
            return;
          }

          currentRequest.copyCount += requestedCopyCount;
          currentRequest.selectedCount += 1;

          const currentSourceTime = Date.parse(currentRequest.timestamp) || 0;
          const shouldPreferJob = (
            (!isReprintJob(job) && isReprintJob(currentRequest.sourceJob))
            || (
              Boolean(!isReprintJob(job)) === Boolean(!isReprintJob(currentRequest.sourceJob))
              && jobTime < currentSourceTime
            )
          );

          if (shouldPreferJob) {
            currentRequest.timestamp = job.timestamp;
            currentRequest.sourceJob = job;
          }
        });

      return Array.from(groupedRequests.values());
    };
    const resetPreviewCopies = () => {
      if (previewCopies) previewCopies.value = '1';
    };
    const resetBatchCopies = () => {
      if (batchCopies) batchCopies.value = '1';
    };
    const closeConfirmPane = () => {
      pendingBatchReprint = null;
      if (confirmPane) confirmPane.hidden = true;
    };
    const syncBatchUi = () => {
      const selectedCount = getSelectedJobs().length;
      const shouldShowBatch = selectedCount >= 2;

      if (batch) batch.classList.toggle('is-visible', shouldShowBatch);
      if (batchButton) batchButton.disabled = selectedCount < 2;

      if (!shouldShowBatch) {
        resetBatchCopies();
        if (batchStatus) batchStatus.textContent = '';
      }
    };
    const submitBatchReprint = jobs => {
      const normalizedCopyCount = normalizeCopyCount(batchCopies?.value);
      const batchRequests = buildBatchReprintRequests(jobs, normalizedCopyCount);
      const selectedCount = jobs.filter(job => job && job.filePath && job.printerId && job.chksum && job.timestamp).length;

      if (!batchRequests.length) {
        if (batchStatus) batchStatus.textContent = 'No selected jobs can be reprinted.';
        closeConfirmPane();
        return Promise.resolve();
      }

      if (batchCopies) batchCopies.value = String(normalizedCopyCount);
      if (batchButton) batchButton.disabled = true;
      if (confirmSubmit) confirmSubmit.disabled = true;
      if (batchStatus) {
        batchStatus.textContent = `Sending ${selectedCount} ${formatPlural(selectedCount, 'document')} as ${batchRequests.length} ${formatPlural(batchRequests.length, 'job')}...`;
      }

      return Promise.all(batchRequests.map(request => (
        fetch(settings.reprintUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timestamp: request.timestamp,
            printerId: request.printerId,
            chksum: request.chksum,
            copyCount: request.copyCount,
          }),
        }).then(async response => {
          if (!response.ok) {
            throw new Error(await response.text() || 'Reprint failed');
          }

          return response.json();
        })
      )))
        .then(() => {
          if (batchStatus) {
            batchStatus.textContent = `Queued ${selectedCount} ${formatPlural(selectedCount, 'document')} as ${batchRequests.length} ${formatPlural(batchRequests.length, 'job')}.`;
          }
          queueRecentLogReload();
          closeConfirmPane();
        })
        .catch(error => {
          if (batchStatus) batchStatus.textContent = error.message;
        })
        .finally(() => {
          if (batchButton) batchButton.disabled = getSelectedJobs().length < 2;
          if (confirmSubmit) confirmSubmit.disabled = false;
        });
    };
    const openBatchConfirm = jobs => {
      const normalizedCopyCount = normalizeCopyCount(batchCopies?.value);
      const selectedCount = jobs.length;
      const batchRequests = buildBatchReprintRequests(jobs, normalizedCopyCount);

      pendingBatchReprint = jobs;
      if (confirmMessage) {
        confirmMessage.textContent = `${selectedCount} ${formatPlural(selectedCount, 'Document')} will be reprinted as ${batchRequests.length} ${formatPlural(batchRequests.length, 'job')} for up to ${normalizedCopyCount} ${formatPlural(normalizedCopyCount, 'time')} each.`;
      }
      if (confirmPane) confirmPane.hidden = false;
    };
    const toggleCardSelection = jobKey => {
      if (!jobKey) return;

      if (selectedJobKeys.has(jobKey)) {
        selectedJobKeys.delete(jobKey);
      } else {
        selectedJobKeys.add(jobKey);
      }

      renderLogs(currentJobs);
      syncBatchUi();
    };
    const toggleCardDetails = jobKey => {
      if (!jobKey) return;

      if (expandedJobKeys.has(jobKey)) {
        expandedJobKeys.delete(jobKey);
      } else {
        expandedJobKeys.add(jobKey);
      }

      renderLogs(currentJobs);
    };
    const openPreviewForJobKey = jobKey => {
      const job = findJobByKey(jobKey);

      if (!job?.previewUrl) return;

      selectedPreviewJobKey = jobKey;
      syncPreviewPane();
    };

    const formatPreviewMeta = job => [
      job.displayName || job.printerName || job.printerId,
      formatTimestamp(job.timestamp),
      job.result || 'Unknown result',
    ].filter(Boolean).join(' | ');

    const closePreviewPane = () => {
      selectedPreviewJobKey = null;
      if (previewPane) previewPane.hidden = true;
      if (previewStatus) previewStatus.textContent = '';
      resetPreviewCopies();
    };

    const syncPreviewPane = () => {
      if (!previewPane) return;

      const job = selectedPreviewJobKey ? findJobByKey(selectedPreviewJobKey) : null;

      if (!job || !job.previewUrl) {
        closePreviewPane();
        return;
      }

      previewPane.hidden = false;
      previewTitle.textContent = formatJobFilename(job);
      previewTitle.title = formatJobFilename(job);
      previewImage.src = job.previewUrl;
      previewImage.alt = `Preview for ${formatJobFilename(job) || 'print job'}`;
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
        syncBatchUi();
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
        const isSelected = selectedJobKeys.has(jobKey);
        const iconPath = job.iconUrl || printerIconsById[job.printerId] || '/favicon.ico';
        const printerLabel = escapeHtml(job.displayName || job.printerName || job.printerId || 'Unknown printer');

        return `
          <article class="printify-log-drawer__card${isNew ? ' is-new' : ''}${isOpen ? ' is-open' : ''}${isSelected ? ' is-selected' : ''}" data-role="log-card" data-job-key="${escapeHtml(jobKey)}">
            <div class="printify-log-drawer__row">
              <div class="printify-log-drawer__icon-stack">
                <button class="printify-log-drawer__icon-button" type="button" data-role="details-toggle" title="Toggle print details">
                  <img class="printify-log-drawer__icon" src="${iconPath}" alt="${printerLabel}">
                </button>
                <div class="printify-log-drawer__time">${escapeHtml(formatTimestamp(job.timestamp))}</div>
              </div>
              <div class="printify-log-drawer__main">
                <h3 class="printify-log-drawer__filename">${escapeHtml(formatJobFilename(job))}</h3>
                <div class="printify-log-drawer__summary">
                  <div class="printify-log-drawer__summary-main">
                    <div class="printify-log-drawer__printer">${printerLabel}</div>
                    <div class="printify-log-drawer__checksum">
                      <button class="printify-log-drawer__checksum-button" type="button" data-role="checksum-select" title="${escapeHtml(job.chksum || 'Checksum unavailable')}">
                        ${formatChecksumMarkup(job.chksum)}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              ${job.previewUrl ? `
                <div class="printify-log-drawer__preview-stack">
                  <button class="printify-log-drawer__preview-trigger" type="button" data-role="preview-trigger"><img class="printify-log-drawer__preview" src="${escapeHtml(job.previewUrl)}" alt="Preview for ${escapeHtml(formatJobFilename(job) || 'print job')}" loading="lazy"></button>
                  ${isReprintJob(job)
                    ? '<button class="printify-log-drawer__reprint-stamp" type="button" data-role="original-jump" title="Jump to original print">REPRINTED</button>'
                    : ''}
                </div>
              ` : ''}
            </div>
            <div class="printify-log-drawer__details">${renderDetailsMarkup(job)}</div>
          </article>
        `;
      }).join('');

      previousJobKeys = nextJobKeys;
      syncBatchUi();
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

      if (!isOpen) {
        closeConfirmPane();
      }
    };

    const openDrawer = () => {
      closeWindowMenu();
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

    windowButton.addEventListener('contextmenu', event => {
      event.preventDefault();
      toggleWindowMenu();
    });

    windowMenu?.addEventListener('click', event => {
      const windowOption = event.target.closest('[data-role="window-option"]');

      if (!windowOption) return;

      setCurrentWindowMinutes(Number.parseInt(windowOption.getAttribute('data-window-minutes'), 10));
      closeWindowMenu();
    });

    scrim.addEventListener('click', () => {
      setOpenState(false);
    });

    list.addEventListener('click', event => {
      const originalJump = event.target.closest('[data-role="original-jump"]');

      if (originalJump) {
        event.stopPropagation();
        const card = originalJump.closest('[data-role="log-card"]');
        const job = card ? findJobByKey(card.getAttribute('data-job-key')) : null;
        void jumpToOriginalLog(job);
        return;
      }

      const detailsToggle = event.target.closest('[data-role="details-toggle"]');

      if (detailsToggle) {
        event.stopPropagation();
        const card = detailsToggle.closest('[data-role="log-card"]');
        if (!card) return;
        toggleCardDetails(card.getAttribute('data-job-key'));
        return;
      }

      const previewTrigger = event.target.closest('[data-role="preview-trigger"]');

      if (previewTrigger) {
        event.stopPropagation();
        const card = previewTrigger.closest('[data-role="log-card"]');
        if (!card) return;
        const jobKey = card.getAttribute('data-job-key');

        if (selectedPreviewJobKey === jobKey && !previewPane?.hidden) {
          closePreviewPane();
          return;
        }

        openPreviewForJobKey(jobKey);
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

      if (event.detail !== 1) return;

      toggleCardSelection(jobKey);
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

    batchButton?.addEventListener('click', () => {
      const selectedJobs = getSelectedReprintJobs();

      if (selectedJobs.length < 2) {
        if (batchStatus) batchStatus.textContent = 'Select at least two reprintable jobs.';
        return;
      }

      if (selectedJobs.length > 2) {
        openBatchConfirm(selectedJobs);
        return;
      }

      void submitBatchReprint(selectedJobs);
    });

    batchCopies?.addEventListener('change', () => {
      batchCopies.value = String(normalizeCopyCount(batchCopies.value));
    });

    confirmCancel?.addEventListener('click', () => {
      closeConfirmPane();
    });

    confirmSubmit?.addEventListener('click', () => {
      if (!pendingBatchReprint?.length) {
        closeConfirmPane();
        return;
      }

      void submitBatchReprint(pendingBatchReprint);
    });

    document.addEventListener('click', event => {
      const clickedWindowButton = event.target.closest('[data-role="window-button"]');
      const clickedWindowMenu = event.target.closest('[data-role="window-menu"]');

      if (!clickedWindowButton && !clickedWindowMenu) {
        closeWindowMenu();
      }

      if (previewPane?.hidden) return;

      const clickedInsidePreview = event.target.closest('[data-role="preview-pane"]');
      const clickedPreviewTrigger = event.target.closest('[data-role="preview-trigger"]');
      const clickedInsideConfirm = event.target.closest('[data-role="confirm-pane"]');

      if (clickedInsidePreview || clickedPreviewTrigger || clickedInsideConfirm) return;

      closePreviewPane();
    });

    list.addEventListener('dblclick', event => {
      const checksumButton = event.target.closest('[data-role="checksum-select"]');

      if (checksumButton) {
        event.stopPropagation();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(checksumButton);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }

      const card = event.target.closest('[data-role="log-card"]');

      if (!card) return;
      if (event.target.closest('[data-role="preview-trigger"], [data-role="details-toggle"], [data-role="original-jump"]')) return;

      const jobKey = card.getAttribute('data-job-key');
      event.stopPropagation();
      openPreviewForJobKey(jobKey);
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
        if (!windowMenu?.hidden) {
          closeWindowMenu();
          return;
        }

        if (!previewPane?.hidden) {
          closePreviewPane();
          return;
        }

        if (!confirmPane?.hidden) {
          closeConfirmPane();
          return;
        }

        setOpenState(false);
      }
    });

    syncWindowUi();
    closeWindowMenu();
    syncBatchUi();
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
