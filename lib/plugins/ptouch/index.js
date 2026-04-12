// ╭────────────────────────────╮
// │  lib/plugins/ptouch        │
// │  Server-side ptouch-print  │
// │  availability poller       │
// ╰────────────────────────────╯
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 2500;
const PT_TOUCH_COMMAND = 'ptouch-print';

const toNormalizedCommandName = value => path.basename(String(value || '').trim()).toLowerCase();

const resolveTargetPrinterIds = parsedConfig => {
  const configuredPrinterIds = Object.entries(parsedConfig?.printers || {})
    .filter(([, printerConfig]) => (
      toNormalizedCommandName(printerConfig?.cliCommand) === PT_TOUCH_COMMAND
    ))
    .map(([printerId]) => printerId);

  const configuredPluginPrinterIds = Array.isArray(parsedConfig?.plugins?.ptouch?.printerIds)
    ? parsedConfig.plugins.ptouch.printerIds
      .map(printerId => String(printerId || '').trim())
      .filter(Boolean)
    : [];

  return Array.from(new Set([
    ...configuredPluginPrinterIds,
    ...configuredPrinterIds,
  ]));
};

const resolveIntervalMs = pluginConfig => {
  const rawIntervalMs = pluginConfig?.intervalMs ?? pluginConfig?.pollMs;
  const rawIntervalSeconds = pluginConfig?.intervalSeconds ?? pluginConfig?.pollSeconds;
  const numericIntervalMs = Number.parseInt(rawIntervalMs, 10);
  const numericIntervalSeconds = Number.parseFloat(rawIntervalSeconds);

  if (Number.isFinite(numericIntervalMs) && numericIntervalMs >= 250) {
    return numericIntervalMs;
  }

  if (Number.isFinite(numericIntervalSeconds) && numericIntervalSeconds > 0) {
    return Math.max(250, Math.round(numericIntervalSeconds * 1000));
  }

  return DEFAULT_INTERVAL_MS;
};

const resolveTimeoutMs = pluginConfig => {
  const numericTimeoutMs = Number.parseInt(pluginConfig?.timeoutMs, 10);
  return Number.isFinite(numericTimeoutMs) && numericTimeoutMs >= 250
    ? numericTimeoutMs
    : DEFAULT_TIMEOUT_MS;
};

const parseMediaWidthMm = outputText => {
  const match = String(outputText || '').match(/(?:media|tape)\s+width[^0-9]{0,20}(\d{1,2})\s*mm/i);
  return match ? Number.parseInt(match[1], 10) : null;
};

const probePtouchState = ({ timeoutMs }) => new Promise(resolve => {
  execFile(PT_TOUCH_COMMAND, ['--info'], {
    encoding: 'utf8',
    timeout: timeoutMs,
  }, (error, stdout = '', stderr = '') => {
    if (error) {
      resolve({
        online: false,
        mediaWidthMm: null,
        errorCode: error.code || null,
        errorMessage: error.message || 'ptouch-print probe failed',
        output: `${stdout}\n${stderr}`.trim(),
      });
      return;
    }

    const output = `${stdout}\n${stderr}`.trim();

    resolve({
      online: true,
      mediaWidthMm: parseMediaWidthMm(output),
      errorCode: null,
      errorMessage: null,
      output,
    });
  });
});

const createPlugin = ({
  runtimeConfig,
  serverSave,
  reloadPrinters,
  logStamp = () => {},
  errorLogStamp = () => {},
}) => {
  let pollTimer = null;
  let polling = false;
  let currentTargetPrinterIds = [];
  let currentIntervalMs = DEFAULT_INTERVAL_MS;
  let currentTimeoutMs = DEFAULT_TIMEOUT_MS;
  let lastObservedState = null;
  let testingEnabled = Boolean(runtimeConfig?.getOption?.('testing'));
  let enabled = false;
  let disabledByFailure = false;
  let hasLoggedStartup = false;
  let lastProbeFailureSignature = null;
  let hasLoggedTestingOverride = false;

  const clearPollTimer = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const buildStateSignature = state => JSON.stringify({
    online: Boolean(state?.online),
    mediaWidthMm: Number.isFinite(state?.mediaWidthMm) ? state.mediaWidthMm : null,
  });

  const buildProbeFailureSignature = state => JSON.stringify({
    errorCode: state?.errorCode || null,
    errorMessage: state?.errorMessage || null,
  });

  const getEffectiveState = nextState => ({
    ...nextState,
    online: testingEnabled ? true : Boolean(nextState?.online),
  });

  const disablePlugin = reason => {
    if (disabledByFailure) {
      return;
    }

    disabledByFailure = true;
    enabled = false;
    clearPollTimer();
    errorLogStamp(`ptouch server plugin disabled: ${reason}`);
  };

  const applyObservedState = nextState => {
    currentTargetPrinterIds.forEach(printerId => {
      serverSave?.setPrinterOnline?.(printerId, nextState.online);

      if (Number.isFinite(nextState.mediaWidthMm)) {
        serverSave?.setPrinterPreference?.(printerId, 'lastTapeWidthMm', nextState.mediaWidthMm);
      }
    });
  };

  const runPoll = async () => {
    if (!enabled || polling || currentTargetPrinterIds.length === 0) {
      return;
    }

    polling = true;

    try {
      const observedState = await probePtouchState({
        timeoutMs: currentTimeoutMs,
      });
      const nextState = getEffectiveState(observedState);
      const previousSignature = buildStateSignature(lastObservedState);
      const nextSignature = buildStateSignature(nextState);
      const failureSignature = buildProbeFailureSignature(observedState);

      applyObservedState(nextState);

      if (observedState.errorMessage) {
        if (failureSignature !== lastProbeFailureSignature) {
          errorLogStamp(`ptouch server plugin probe failed: ${observedState.errorMessage}`);
        }

        lastProbeFailureSignature = failureSignature;
        disablePlugin(
          observedState.errorCode === 'ENOENT'
            ? 'could not find "ptouch-print"; plugin stopped to avoid stale state'
            : 'probe command failed; plugin stopped to avoid stale state'
        );
        return;
      } else {
        lastProbeFailureSignature = null;
      }

      if (testingEnabled && observedState.online === false && !hasLoggedTestingOverride) {
        logStamp('ptouch server plugin is running in testing mode, so probe failures will not hide the printer from the UI.');
        hasLoggedTestingOverride = true;
      }

      if (previousSignature !== nextSignature) {
        lastObservedState = nextState;
        logStamp(
          `ptouch server plugin detected state change: ${nextState.online ? 'online' : 'offline'}`
          + `${Number.isFinite(nextState.mediaWidthMm) ? ` (${nextState.mediaWidthMm}mm)` : ''}`
          + `${testingEnabled && observedState.online === false ? ' [testing override]' : ''}`
        );
        reloadPrinters('server-plugin-ptouch');
      } else {
        lastObservedState = nextState;
      }

      if (!hasLoggedStartup) {
        hasLoggedStartup = true;
        logStamp(
          `ptouch server plugin polling ${currentTargetPrinterIds.join(', ')} every ${currentIntervalMs}ms`
          + `${testingEnabled ? ' with testing-mode availability override enabled' : ''}.`
        );
      }
    } catch (error) {
      errorLogStamp('ptouch server plugin poll failed:', error.message);
    } finally {
      polling = false;
    }
  };

  const syncConfig = parsedConfig => {
    const pluginConfig = parsedConfig?.plugins?.ptouch || null;
    const nextTargetPrinterIds = resolveTargetPrinterIds(parsedConfig);
    testingEnabled = parsedConfig?.testing ?? Boolean(runtimeConfig?.getOption?.('testing'));

    if (!pluginConfig || pluginConfig.enabled === false || nextTargetPrinterIds.length === 0) {
      enabled = false;
      disabledByFailure = false;
      clearPollTimer();
      lastObservedState = null;
      lastProbeFailureSignature = null;
      hasLoggedStartup = false;
      hasLoggedTestingOverride = false;
      currentTargetPrinterIds = nextTargetPrinterIds;
      return;
    }

    disabledByFailure = false;
    enabled = true;
    currentTargetPrinterIds = nextTargetPrinterIds;
    currentTimeoutMs = resolveTimeoutMs(pluginConfig);

    const nextIntervalMs = resolveIntervalMs(pluginConfig);

    if (!pollTimer || nextIntervalMs !== currentIntervalMs) {
      clearPollTimer();
      currentIntervalMs = nextIntervalMs;
      pollTimer = setInterval(runPoll, currentIntervalMs);
    }

    void runPoll();
  };

  return {
    id: 'ptouch',
    defaultConfig: {
      enabled: true,
      intervalSeconds: 5,
    },
    syncConfig,
    stop() {
      disabledByFailure = false;
      enabled = false;
      clearPollTimer();
    },
  };
};

module.exports = {
  createPlugin,
};
