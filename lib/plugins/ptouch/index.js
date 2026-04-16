// ╭────────────────────────────╮
// │  lib/plugins/ptouch        │
// │  Server-side ptouch-print  │
// │  availability poller       │
// ╰────────────────────────────╯
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 2500;
const PLUGIN_ID = 'ptouch';
const PT_TOUCH_COMMAND = 'ptouch-print';
const DEFAULT_CONFIG = {
  enabled: true,
  intervalSeconds: 5,
};
const CONFIG_HELP_COMMENT = 'Watches ptouch-print for the tape printer and keeps tape width fresh.';

const toNormalizedCommandName = value => path.basename(String(value || '').trim()).toLowerCase();

const resolveTargetPrinterIds = parsedConfig => {
  const configuredPrinterIds = Object.entries(parsedConfig?.printers || {})
    .filter(([, printerConfig]) => (
      toNormalizedCommandName(printerConfig?.cliCommand) === PT_TOUCH_COMMAND
    ))
    .map(([printerId]) => printerId);

  const configuredPluginPrinterIds = Array.isArray(parsedConfig?.plugins?.ptouch?.printerIds)
    ? parsedConfig.plugins[PLUGIN_ID].printerIds
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
  const match = String(outputText || '').match(/media width\s*=\s*(\d{1,2})\s*mm/i);
  return match ? Number.parseInt(match[1], 10) : null;
};

const parseMaxPrintWidthPx = outputText => {
  const match = String(outputText || '').match(/maximum printing width(?: for this tape)? is\s*(\d+)\s*px/i);
  return match ? Number.parseInt(match[1], 10) : null;
};

const parsePrinterDetected = outputText => /found on usb bus/i.test(String(outputText || ''));
const parseNoPrinterDetected = outputText => /no p-?touch printer found on usb/i.test(String(outputText || ''));

const probePtouchState = ({ timeoutMs }) => new Promise(resolve => {
  execFile(PT_TOUCH_COMMAND, ['--info'], {
    encoding: 'utf8',
    timeout: timeoutMs,
  }, (error, stdout = '', stderr = '') => {
    const output = `${stdout}\n${stderr}`.trim();
    const printerDetected = parsePrinterDetected(output);
    const noPrinterDetected = parseNoPrinterDetected(output);

    if (error) {
      if (error.code !== 'ENOENT' && noPrinterDetected) {
        resolve({
          online: false,
          mediaWidthMm: parseMediaWidthMm(output),
          maxPrintWidthPx: parseMaxPrintWidthPx(output),
          printerDetected: false,
          noPrinterDetected: true,
          errorCode: null,
          errorMessage: null,
          output,
        });
        return;
      }

      resolve({
        online: false,
        mediaWidthMm: null,
        maxPrintWidthPx: null,
        printerDetected,
        noPrinterDetected,
        errorCode: error.code || null,
        errorMessage: error.message || 'ptouch-print probe failed',
        output,
      });
      return;
    }

    resolve({
      online: printerDetected,
      mediaWidthMm: parseMediaWidthMm(output),
      maxPrintWidthPx: parseMaxPrintWidthPx(output),
      printerDetected,
      noPrinterDetected,
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
    maxPrintWidthPx: Number.isFinite(state?.maxPrintWidthPx) ? state.maxPrintWidthPx : null,
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

      if (observedState.noPrinterDetected) {
        logStamp('ptouch server plugin did not find a connected label maker. Leaving the plugin active so it can detect the printer when it returns.');
      } else if (!observedState.printerDetected) {
        errorLogStamp('ptouch server plugin did not find a connected label maker in the "--info" output. Plugin stopped to avoid stale state.');
        disablePlugin('no connected ptouch printer was reported by "ptouch-print --info"');
        return;
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
          + `${Number.isFinite(nextState.maxPrintWidthPx) ? ` (${nextState.maxPrintWidthPx}px max)` : ''}`
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
    const pluginConfig = parsedConfig?.plugins?.[PLUGIN_ID] || null;
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
    id: PLUGIN_ID,
    defaultConfig: DEFAULT_CONFIG,
    configHelpComment: CONFIG_HELP_COMMENT,
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
