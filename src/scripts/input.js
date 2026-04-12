(function () {
  // ╭──────────────────────────╮
  // │  Shared input sequences  │
  // ╰──────────────────────────╯
  // Register hidden key sequences through `window.printifyInput.registerSequence(...)`.
  // Each sequence accepts:
  // - `id`: stable unique name
  // - `steps`: ordered array like `{ keys: ['arrowup', 'w'], display: 'up' }`
  // - `onProgress(state)`: optional callback while the sequence is being entered
  // - `onMatch(event)`: optional callback when the full sequence completes
  // - `timeoutMs`: optional inactivity timeout before progress resets
  // The returned handle exposes `reset()` and `unregister()` so callers can reuse
  // the same matcher pattern for other subtle input-driven features.
  const normalizeKey = key => String(key || '').toLowerCase();

  const isTypingContext = target => {
    if (!target || !(target instanceof Element)) return false;

    if (target.closest('input, textarea, select, [contenteditable="true"]')) {
      return true;
    }

    return target.getAttribute('contenteditable') === 'true';
  };

  function createPrintifyInputManager(options) {
    const settings = Object.assign({
      timeoutMs: 1600,
    }, options || {});

    const sequences = new Map();
    let sequenceId = 0;

    const clearResetTimer = sequence => {
      if (!sequence?.resetTimer) return;
      window.clearTimeout(sequence.resetTimer);
      sequence.resetTimer = null;
    };

    const emitProgress = sequence => {
      sequence.onProgress?.({
        id: sequence.id,
        progress: sequence.progress,
        totalSteps: sequence.steps.length,
        matchedSteps: sequence.steps.slice(0, sequence.progress).map(step => step.display).filter(Boolean),
      });
    };

    const resetSequence = sequence => {
      if (!sequence) return;
      clearResetTimer(sequence);
      sequence.progress = 0;
      emitProgress(sequence);
    };

    const queueReset = sequence => {
      clearResetTimer(sequence);
      sequence.resetTimer = window.setTimeout(() => {
        sequence.resetTimer = null;
        sequence.progress = 0;
        emitProgress(sequence);
      }, sequence.timeoutMs);
    };

    const handleKeydown = event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (isTypingContext(event.target)) return;

      const normalizedKey = normalizeKey(event.key);

      sequences.forEach(sequence => {
        const expectedKeys = sequence.steps[sequence.progress]?.keys || [];
        const startKeys = sequence.steps[0]?.keys || [];
        const matchesExpected = expectedKeys.includes(normalizedKey);
        const matchesStart = startKeys.includes(normalizedKey);

        if (matchesExpected) {
          sequence.progress += 1;
          emitProgress(sequence);

          if (sequence.progress >= sequence.steps.length) {
            sequence.onMatch?.(event);
            resetSequence(sequence);
            return;
          }

          queueReset(sequence);
          return;
        }

        if (matchesStart) {
          sequence.progress = 1;
          emitProgress(sequence);
          queueReset(sequence);
          return;
        }

        if (sequence.progress > 0) {
          resetSequence(sequence);
        }
      });
    };

    document.addEventListener('keydown', handleKeydown);

    return {
      registerSequence(config) {
        const steps = Array.isArray(config?.steps)
          ? config.steps
            .map(step => ({
              keys: Array.isArray(step?.keys) ? step.keys.map(normalizeKey).filter(Boolean) : [],
              display: step?.display || '',
            }))
            .filter(step => step.keys.length)
          : [];

        if (!steps.length) {
          return {
            reset() {},
            unregister() {},
          };
        }

        const sequence = {
          id: config?.id || `sequence-${sequenceId += 1}`,
          steps,
          progress: 0,
          timeoutMs: Number.isFinite(config?.timeoutMs) ? config.timeoutMs : settings.timeoutMs,
          onMatch: typeof config?.onMatch === 'function' ? config.onMatch : null,
          onProgress: typeof config?.onProgress === 'function' ? config.onProgress : null,
          resetTimer: null,
        };

        sequences.set(sequence.id, sequence);
        emitProgress(sequence);

        return {
          reset() {
            resetSequence(sequence);
          },
          unregister() {
            resetSequence(sequence);
            sequences.delete(sequence.id);
          },
        };
      },
    };
  }

  window.createPrintifyInputManager = createPrintifyInputManager;
  window.printifyInput = window.printifyInput || createPrintifyInputManager();
}());
