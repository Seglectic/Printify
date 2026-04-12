(function () {
  // ╭──────────────────────────╮
  // │  Confirm indicator UI    │
  // ╰──────────────────────────╯
  // Printer-local upload indicators:
  const CONFIRM_INDICATOR_SIZE = 72;      // Confirm canvas in CSS px
  const CONFIRM_INDICATOR_RING_SIZE = 12; // How many indicators fit in one orbit around a card
  const CONFIRM_INDICATOR_RING_GAP = 30;  // Spacing between each orbit around the card
  const ID_DEBUG_PREFIX = '[id-debug]';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (start, end, progress) => start + ((end - start) * progress);
  const easeOutCubic = value => 1 - ((1 - value) ** 3);
  const easeOutBack = value => {
    const overshoot = 1.70158;
    const shifted = value - 1;
    return 1 + ((overshoot + 1) * (shifted ** 3)) + (overshoot * (shifted ** 2));
  };

  const isWorkingState = state => ['queued', 'uploading', 'processing', 'printing'].includes(state);
  const debugIdLog = (...args) => {
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug(ID_DEBUG_PREFIX, ...args);
    }
  };

  const drawWorkingDots = (context, now) => {
    const center = CONFIRM_INDICATOR_SIZE / 2;
    const dotCount = 5;
    const orbitalRadiusX = 12;
    const orbitalRadiusY = orbitalRadiusX * 0.8;
    const dotRadius = 2.8;
    const time = now / 260;

    context.save();
    context.fillStyle = 'rgba(255, 252, 246, 0.96)';

    for (let index = 0; index < dotCount; index += 1) {
      const phase = time + ((index / dotCount) * Math.PI * 2);
      const orbitalTilt = index % 2 === 0 ? 1 : -1;
      const x = center + (Math.cos(phase) * orbitalRadiusX);
      const y = center + (Math.sin(phase) * orbitalRadiusY * orbitalTilt);
      const depth = ((Math.sin(phase - (Math.PI / 3)) + 1) / 2);
      const radius = dotRadius * (0.75 + (depth * 0.35));
      const opacity = 0.38 + (0.58 * depth);

      context.globalAlpha = opacity;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  };

  const getConfirmIndicatorPalette = state => {
    if (state === 'error') {
      return {
        stroke: '#d94d52',
        uploadFill: '#f07b7f',
        settleFill: '#d94d52',
        mark: '#fff7f7',
        track: 'rgba(217, 77, 82, 0.18)',
      };
    }

    return {
      stroke: '#2c8b55',
      uploadFill: '#f6c97b',
      settleFill: '#64d47b',
      mark: '#f4fff6',
      track: 'rgba(100, 212, 123, 0.14)',
    };
  };

  const createPrintifyConfirmSystem = ({
    confirmLayer,
    getPrinterCardElement,
  } = {}) => {
    const state = {
      indicatorsById: new Map(),
      frame: null,
      sequence: 0,
    };

    const getIndicators = () => Array.from(state.indicatorsById.values());

    const getPrinterCardCenter = printerId => {
      const card = getPrinterCardElement?.(printerId);

      if (!card) {
        return null;
      }

      const rect = card.getBoundingClientRect();

      return {
        width: rect.width,
        height: rect.height,
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
      };
    };

    const positionIndicator = indicator => {
      const samePrinterIndicators = getIndicators()
        .filter(entry => entry.printerId === indicator.printerId)
        .sort((left, right) => left.order - right.order);
      const index = samePrinterIndicators.findIndex(entry => entry.id === indicator.id);
      const center = getPrinterCardCenter(indicator.printerId);

      if (!center || index === -1) {
        return;
      }

      const ringIndex = Math.floor(index / CONFIRM_INDICATOR_RING_SIZE);
      const slotIndex = index % CONFIRM_INDICATOR_RING_SIZE;
      const slotCount = Math.min(CONFIRM_INDICATOR_RING_SIZE, samePrinterIndicators.length - (ringIndex * CONFIRM_INDICATOR_RING_SIZE));
      const angle = (-Math.PI / 2) + ((slotIndex / Math.max(slotCount, 1)) * Math.PI * 2);
      const radius = (Math.max(center.width, center.height) * 0.36) + 22 + (ringIndex * CONFIRM_INDICATOR_RING_GAP);

      indicator.canvas.style.left = `${center.x + (Math.cos(angle) * radius)}px`;
      indicator.canvas.style.top = `${center.y + (Math.sin(angle) * radius)}px`;
    };

    const drawMark = (context, markType, progress, color) => {
      if (progress <= 0) {
        return;
      }

      const center = CONFIRM_INDICATOR_SIZE / 2;
      const checkPoints = [
        [center - 13, center + 1],
        [center - 4, center + 10],
        [center + 12, center - 10],
      ];
      const errorPoints = [
        [center - 12, center - 12],
        [center + 12, center + 12],
        [center + 12, center - 12],
        [center - 12, center + 12],
      ];

      context.save();
      context.strokeStyle = color;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = 5;

      if (markType === 'error') {
        const firstStrokeProgress = clamp(progress * 1.6, 0, 1);
        const secondStrokeProgress = clamp((progress - 0.28) * 1.6, 0, 1);

        context.beginPath();
        context.moveTo(errorPoints[0][0], errorPoints[0][1]);
        context.lineTo(
          lerp(errorPoints[0][0], errorPoints[1][0], firstStrokeProgress),
          lerp(errorPoints[0][1], errorPoints[1][1], firstStrokeProgress)
        );
        context.stroke();

        if (secondStrokeProgress > 0) {
          context.beginPath();
          context.moveTo(errorPoints[2][0], errorPoints[2][1]);
          context.lineTo(
            lerp(errorPoints[2][0], errorPoints[3][0], secondStrokeProgress),
            lerp(errorPoints[2][1], errorPoints[3][1], secondStrokeProgress)
          );
          context.stroke();
        }
      } else {
        const path = new Path2D();
        path.moveTo(checkPoints[0][0], checkPoints[0][1]);
        path.lineTo(checkPoints[1][0], checkPoints[1][1]);
        path.lineTo(checkPoints[2][0], checkPoints[2][1]);
        context.setLineDash([64]);
        context.lineDashOffset = 64 * (1 - progress);
        context.stroke(path);
      }

      context.restore();
    };

    const markIndicatorRemoving = indicator => {
      if (!indicator || indicator.state === 'removing') {
        return;
      }

      const currentState = indicator.state;
      indicator.state = 'removing';
      indicator.removingAt = performance.now();
      indicator.resultState = indicator.resultState || (currentState === 'error' ? 'error' : 'success');
    };

    const drawIndicator = (indicator, now) => {
      const context = indicator.context;
      const visualState = indicator.state === 'removing'
        ? (indicator.resultState || 'success')
        : indicator.state;
      const age = now - indicator.createdAt;
      const settledAge = indicator.settledAt ? now - indicator.settledAt : 0;
      const isSettled = visualState === 'success' || visualState === 'error';
      const isError = visualState === 'error';
      const appearProgress = clamp(age / 180, 0, 1);
      const exitProgress = indicator.state === 'removing'
        ? clamp((now - indicator.removingAt) / 220, 0, 1)
        : 0;
      const opacity = indicator.state === 'removing'
        ? 1 - easeOutCubic(exitProgress)
        : 1;
      const scale = indicator.state === 'removing'
        ? 1 - (0.16 * easeOutCubic(exitProgress))
        : easeOutBack(appearProgress);

      indicator.displayProgress += (indicator.progress - indicator.displayProgress) * 0.22;
      indicator.displayProgress = clamp(indicator.displayProgress, 0, 1);

      const palette = getConfirmIndicatorPalette(visualState);
      const outlineProgress = isSettled
        ? 1
        : clamp(indicator.displayProgress, 0.08, 1);
      const uploadFillProgress = isSettled
        ? 1
        : clamp(indicator.displayProgress, 0, 1);
      const settleFillProgress = isSettled
        ? (isError ? 1 : clamp((settledAge - 40) / 140, 0, 1))
        : 0;
      const markProgress = isSettled
        ? (isError ? clamp((settledAge - 40) / 110, 0, 1) : clamp((settledAge - 120) / 120, 0, 1))
        : 0;

      context.save();
      context.clearRect(0, 0, CONFIRM_INDICATOR_SIZE, CONFIRM_INDICATOR_SIZE);
      context.globalAlpha = opacity;
      context.translate(CONFIRM_INDICATOR_SIZE / 2, CONFIRM_INDICATOR_SIZE / 2);
      context.scale(scale, scale);
      context.translate(-(CONFIRM_INDICATOR_SIZE / 2), -(CONFIRM_INDICATOR_SIZE / 2));

      context.beginPath();
      context.arc(36, 36, 27, 0, Math.PI * 2);
      context.strokeStyle = palette.track;
      context.lineWidth = 7;
      context.stroke();

      context.beginPath();
      context.arc(36, 36, 27, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * outlineProgress));
      context.strokeStyle = palette.stroke;
      context.lineWidth = 7;
      context.lineCap = 'round';
      context.stroke();

      if (!isError) {
        context.beginPath();
        context.arc(36, 36, 21 * easeOutCubic(uploadFillProgress), 0, Math.PI * 2);
        context.fillStyle = palette.uploadFill;
        context.fill();
      }

      if (settleFillProgress > 0) {
        context.beginPath();
        context.arc(36, 36, 21 * easeOutCubic(settleFillProgress), 0, Math.PI * 2);
        context.fillStyle = palette.settleFill;
        context.fill();
      }

      if (isWorkingState(visualState)) {
        drawWorkingDots(context, now);
      }

      drawMark(
        context,
        isError ? 'error' : 'success',
        easeOutCubic(markProgress),
        palette.mark
      );
      context.restore();

      const holdDurationMs = isError ? 1800 : 900;
      const shouldAutoRemove = isSettled && !indicator.managedByServer;

      if (shouldAutoRemove && settledAge >= holdDurationMs && indicator.state !== 'removing') {
        indicator.state = 'removing';
        indicator.removingAt = now;
      }

      return indicator.state !== 'removing' || exitProgress < 1;
    };

    const stepIndicators = now => {
      getIndicators().forEach(positionIndicator);

      getIndicators().forEach(indicator => {
        const shouldKeep = drawIndicator(indicator, now);

        if (!shouldKeep) {
          indicator.canvas.remove();
          state.indicatorsById.delete(indicator.id);
        }
      });

      if (!state.indicatorsById.size) {
        state.frame = null;
        return;
      }

      state.frame = window.requestAnimationFrame(stepIndicators);
    };

    const ensureLoop = () => {
      if (state.frame || !confirmLayer) {
        return;
      }

      state.frame = window.requestAnimationFrame(stepIndicators);
    };

    const ensureIndicator = (printerId, indicatorId) => {
      const normalizedId = String(indicatorId || '').trim() || `confirm-${Date.now()}-${state.sequence}`;
      const existingIndicator = state.indicatorsById.get(normalizedId);

      if (existingIndicator) {
        if (printerId) {
          existingIndicator.printerId = printerId;
        }

        return existingIndicator;
      }

      if (!confirmLayer) {
        return null;
      }

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const pixelRatio = window.devicePixelRatio || 1;

      canvas.className = 'printify-confirm__indicator';
      canvas.width = Math.round(CONFIRM_INDICATOR_SIZE * pixelRatio);
      canvas.height = Math.round(CONFIRM_INDICATOR_SIZE * pixelRatio);
      canvas.style.width = `${CONFIRM_INDICATOR_SIZE}px`;
      canvas.style.height = `${CONFIRM_INDICATOR_SIZE}px`;
      context.scale(pixelRatio, pixelRatio);
      confirmLayer.appendChild(canvas);

      const indicator = {
        id: normalizedId,
        order: state.sequence,
        printerId,
        canvas,
        context,
        state: 'uploading',
        resultState: null,
        createdAt: performance.now(),
        settledAt: null,
        removingAt: null,
        progress: 0.02,
        displayProgress: 0.02,
        managedByServer: false,
      };

      state.sequence += 1;
      state.indicatorsById.set(indicator.id, indicator);
      debugIdLog('indicator registered', `id=${indicator.id}`, `printer=${printerId || 'none'}`, 'managedByServer=false');
      ensureLoop();
      return indicator;
    };

    const createController = indicator => ({
      setProgress(value) {
        if (!indicator) {
          return;
        }

        indicator.progress = clamp(value, 0.02, 1);
      },
      setState(nextState, nextProgress) {
        if (!indicator) {
          return;
        }

        indicator.state = nextState;
        indicator.resultState = nextState === 'success' || nextState === 'error'
          ? nextState
          : indicator.resultState;

        if (Number.isFinite(nextProgress)) {
          indicator.progress = clamp(nextProgress, 0.02, 1);
        }

        if (nextState === 'success' || nextState === 'error') {
          indicator.progress = 1;
          indicator.settledAt = performance.now();
        }

        ensureLoop();
      },
      isManagedByServer() {
        return Boolean(indicator?.managedByServer);
      },
      settle(nextState) {
        if (!indicator) {
          return;
        }

        indicator.progress = 1;
        indicator.state = nextState;
        indicator.resultState = nextState;
        indicator.settledAt = performance.now();
        ensureLoop();
      },
    });

    const getServerIndicatorId = job => {
      const groupId = String(job?.groupId || job?.clientJobId || '').trim();
      const jobId = String(job?.id || '').trim();
      return groupId || jobId || null;
    };

    const mergeJobGroup = jobs => {
      const groupedJobs = Array.isArray(jobs) ? jobs.filter(Boolean) : [];

      if (!groupedJobs.length) {
        return null;
      }

      const hasError = groupedJobs.some(job => String(job?.state || '').trim().toLowerCase() === 'error');
      const hasWorkingJob = groupedJobs.some(job => {
        const stateName = String(job?.statusIcon || job?.state || '').trim().toLowerCase();
        return isWorkingState(stateName);
      });
      const allSettled = groupedJobs.every(job => {
        const stateName = String(job?.state || '').trim().toLowerCase();
        return stateName === 'success' || stateName === 'error';
      });
      const progressValues = groupedJobs
        .map(job => Number(job?.progress))
        .filter(Number.isFinite);
      const statusIcon = hasError
        ? 'error'
        : (hasWorkingJob ? 'working' : (allSettled ? 'success' : 'processing'));

      return {
        id: getServerIndicatorId(groupedJobs[0]),
        printerId: groupedJobs.find(job => job?.printerId)?.printerId || null,
        statusIcon,
        state: hasError
          ? 'error'
          : (hasWorkingJob ? 'printing' : (allSettled ? 'success' : 'processing')),
        progress: progressValues.length ? Math.max(...progressValues) : null,
      };
    };

    return {
      createIndicator(printerId, options = {}) {
        const indicator = ensureIndicator(printerId, options.id);

        if (!indicator) {
          return {
            setProgress() {},
            setState() {},
            settle() {},
          };
        }

        indicator.printerId = printerId;

        if (options.state) {
          indicator.state = options.state;
        }

        if (Number.isFinite(options.progress)) {
          indicator.progress = clamp(options.progress, 0.02, 1);
          indicator.displayProgress = indicator.progress;
        }

        if (options.managedByServer) {
          indicator.managedByServer = true;
        }

        ensureLoop();
        return createController(indicator);
      },
      syncJobs(jobs) {
        const visibleJobIds = new Set();
        const groupedJobs = new Map();

        (Array.isArray(jobs) ? jobs : []).forEach(job => {
          const indicatorId = getServerIndicatorId(job);

          if (!indicatorId) {
            return;
          }

          if (!groupedJobs.has(indicatorId)) {
            groupedJobs.set(indicatorId, []);
          }

          groupedJobs.get(indicatorId).push(job);
        });

        Array.from(groupedJobs.entries()).forEach(([indicatorId, groupedEntries]) => {
          const mergedJob = mergeJobGroup(groupedEntries);

          if (!mergedJob) {
            return;
          }

          const existingIndicator = state.indicatorsById.get(indicatorId);
          const indicator = existingIndicator || ensureIndicator(mergedJob.printerId || null, indicatorId);

          if (!indicator) {
            return;
          }

          visibleJobIds.add(indicator.id);
          indicator.printerId = mergedJob.printerId || indicator.printerId || null;
          indicator.managedByServer = true;
          debugIdLog(
            'indicator sync',
            `jobId=${indicatorId}`,
            `printer=${indicator.printerId || 'none'}`,
            `existing=${Boolean(existingIndicator)}`,
            `state=${mergedJob.state || 'unknown'}`,
            `groupSize=${groupedEntries.length}`
          );
          const jobProgress = Number(mergedJob.progress);
          if (Number.isFinite(jobProgress)) {
            indicator.progress = clamp(jobProgress, 0.02, 1);
          }

          const nextState = String(mergedJob.statusIcon || mergedJob.state || 'uploading').trim().toLowerCase();
          if (nextState === 'success' || nextState === 'error') {
            if (indicator.resultState !== nextState) {
              indicator.settledAt = performance.now();
            }

            indicator.resultState = nextState;
            if (indicator.state !== 'removing') {
              indicator.state = nextState;
            }
            indicator.progress = 1;
          } else {
            indicator.state = isWorkingState(nextState) ? nextState : 'processing';
            indicator.resultState = null;
            indicator.settledAt = null;
          }
        });

        getIndicators()
          .filter(indicator => indicator.managedByServer && !visibleJobIds.has(indicator.id))
          .forEach(indicator => {
            debugIdLog('indicator unsynced', `id=${indicator.id}`, `printer=${indicator.printerId || 'none'}`);
            markIndicatorRemoving(indicator);
          });

        ensureLoop();
      },
      uploadFormDataWithProgress({ routePath, formData, onProgress }) {
        return new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();

          request.open('POST', routePath, true);
          request.responseType = 'json';

          request.upload.addEventListener('progress', event => {
            if (!event.lengthComputable) {
              return;
            }

            onProgress?.(event.total > 0 ? (event.loaded / event.total) : 0);
          });

          request.addEventListener('error', () => {
            reject(new Error('Upload failed before the server responded'));
          });

          request.addEventListener('abort', () => {
            reject(new Error('Upload was cancelled'));
          });

          request.addEventListener('load', () => {
            let payload = request.response;
            let responseText = '';

            try {
              if (typeof request.responseText === 'string') {
                responseText = request.responseText;
              }
            } catch (error) {
              responseText = '';
            }

            if (payload === null && responseText) {
              try {
                payload = JSON.parse(responseText);
              } catch (error) {
                payload = null;
              }
            }

            if (request.status < 200 || request.status >= 300) {
              const failureMessage = (
                payload?.message
                || payload?.error
                || responseText
                || `Upload failed (${request.status})`
              );
              reject(new Error(String(failureMessage).trim() || `Upload failed (${request.status})`));
              return;
            }

            resolve(payload || {});
          });

          request.send(formData);
        });
      },
    };
  };

  window.createPrintifyConfirmSystem = createPrintifyConfirmSystem;
})();
