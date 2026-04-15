// ╭────────────────────────────╮
// │  lib/plugins/presence      │
// │  Linux USB availability    │
// │  poller for printers       │
// ╰────────────────────────────╯
const { execFile } = require('child_process');

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 2500;
const RESERVED_CONFIG_KEYS = new Set([
  'enabled',
  'intervalMs',
  'intervalSeconds',
  'pollMs',
  'pollSeconds',
  'timeoutMs',
]);

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

const normalizePatternList = value => (
  Array.isArray(value) ? value : [value]
)
  .map(pattern => String(pattern || '').trim())
  .filter(Boolean);

const compileRules = pluginConfig => Object.entries(pluginConfig || {})
  .filter(([key]) => !RESERVED_CONFIG_KEYS.has(key))
  .map(([printerId, rawPatterns]) => {
    const patterns = normalizePatternList(rawPatterns);

    try {
      return {
        printerId,
        matchers: patterns.map(pattern => new RegExp(pattern, 'i')),
      };
    } catch (error) {
      return {
        printerId,
        matchers: [],
        error,
      };
    }
  })
  .filter(rule => rule.printerId);

const probeLinuxUsb = ({ timeoutMs }) => new Promise(resolve => {
  execFile('lsusb', [], {
    encoding: 'utf8',
    timeout: timeoutMs,
  }, (error, stdout = '', stderr = '') => {
    resolve({
      output: `${stdout}\n${stderr}`.trim(),
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
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
  let enabled = false;
  let currentRules = [];
  let currentIntervalMs = DEFAULT_INTERVAL_MS;
  let currentTimeoutMs = DEFAULT_TIMEOUT_MS;
  let lastObservedSignature = null;
  let lastProbeFailureSignature = null;
  let trackedPrinterIds = new Set();
  let testingEnabled = Boolean(runtimeConfig?.getOption?.('testing'));
  let hasLoggedStartup = false;
  let hasLoggedUnsupportedPlatform = false;
  let hasLoggedTestingOverride = false;

  const clearPollTimer = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const releaseTrackedPrinters = () => {
    const hadTrackedPrinters = trackedPrinterIds.size > 0;
    trackedPrinterIds.forEach(printerId => {
      serverSave?.setPrinterOnline?.(printerId, true);
    });
    trackedPrinterIds = new Set();
    return hadTrackedPrinters;
  };

  const releaseUntrackedPrinters = nextRules => {
    const nextPrinterIds = new Set(nextRules.map(rule => rule.printerId));
    let changed = false;

    trackedPrinterIds.forEach(printerId => {
      if (nextPrinterIds.has(printerId)) {
        return;
      }

      serverSave?.setPrinterOnline?.(printerId, true);
      trackedPrinterIds.delete(printerId);
      changed = true;
    });

    return changed;
  };

  const buildStateSignature = states => JSON.stringify(states.map(state => ({
    printerId: state.printerId,
    online: Boolean(state.online),
  })));

  const buildProbeFailureSignature = probeResult => JSON.stringify({
    errorCode: probeResult?.errorCode || null,
    errorMessage: probeResult?.errorMessage || null,
  });

  const applyStates = states => {
    states.forEach(state => {
      trackedPrinterIds.add(state.printerId);
      serverSave?.setPrinterOnline?.(state.printerId, state.online);
    });
  };

  const runPoll = async () => {
    if (!enabled || polling || currentRules.length === 0) {
      return;
    }

    polling = true;

    try {
      const probeResult = await probeLinuxUsb({
        timeoutMs: currentTimeoutMs,
      });

      if (probeResult.errorMessage) {
        const failureSignature = buildProbeFailureSignature(probeResult);
        if (failureSignature !== lastProbeFailureSignature) {
          errorLogStamp(`presence plugin lsusb probe failed: ${probeResult.errorMessage}`);
        }

        lastProbeFailureSignature = failureSignature;
        if (releaseTrackedPrinters()) {
          reloadPrinters('server-plugin-presence-release');
        }
        return;
      }

      lastProbeFailureSignature = null;

      const observedStates = currentRules.map(rule => ({
        printerId: rule.printerId,
        online: rule.matchers.some(matcher => matcher.test(probeResult.output)),
      }));
      const nextStates = observedStates.map(state => ({
        ...state,
        online: testingEnabled ? true : state.online,
      }));
      const previousSignature = lastObservedSignature;
      const nextSignature = buildStateSignature(nextStates);

      applyStates(nextStates);

      if (testingEnabled && observedStates.some(state => !state.online) && !hasLoggedTestingOverride) {
        logStamp('presence plugin is running in testing mode, so missing USB devices will not hide printers from the UI.');
        hasLoggedTestingOverride = true;
      }

      if (previousSignature !== nextSignature) {
        lastObservedSignature = nextSignature;
        logStamp(
          'presence plugin detected state change: '
          + nextStates.map(state => `${state.printerId}=${state.online ? 'online' : 'offline'}`).join(', ')
          + `${testingEnabled ? ' [testing override]' : ''}`
        );
        reloadPrinters('server-plugin-presence');
      }

      if (!hasLoggedStartup) {
        hasLoggedStartup = true;
        logStamp(
          `presence plugin polling ${currentRules.map(rule => rule.printerId).join(', ')} every ${currentIntervalMs}ms`
          + `${testingEnabled ? ' with testing-mode availability override enabled' : ''}.`
        );
      }
    } finally {
      polling = false;
    }
  };

  const syncConfig = parsedConfig => {
    const pluginConfig = parsedConfig?.plugins?.presence || null;
    testingEnabled = parsedConfig?.testing ?? Boolean(runtimeConfig?.getOption?.('testing'));

    if (process.platform !== 'linux') {
      enabled = false;
      clearPollTimer();
      if (releaseTrackedPrinters()) {
        reloadPrinters('server-plugin-presence-release');
      }

      if (!hasLoggedUnsupportedPlatform) {
        logStamp('presence plugin is Linux-only for now; USB availability polling is disabled on this platform.');
        hasLoggedUnsupportedPlatform = true;
      }

      return;
    }

    if (!pluginConfig || pluginConfig.enabled === false) {
      enabled = false;
      clearPollTimer();
      if (releaseTrackedPrinters()) {
        reloadPrinters('server-plugin-presence-release');
      }
      currentRules = [];
      lastObservedSignature = null;
      lastProbeFailureSignature = null;
      hasLoggedStartup = false;
      hasLoggedTestingOverride = false;
      return;
    }

    const nextRules = compileRules(pluginConfig);
    nextRules
      .filter(rule => rule.error)
      .forEach(rule => {
        errorLogStamp(`presence plugin ignored invalid regex for "${rule.printerId}": ${rule.error.message}`);
      });

    currentRules = nextRules.filter(rule => rule.matchers.length > 0);
    if (releaseUntrackedPrinters(currentRules)) {
      reloadPrinters('server-plugin-presence-release');
    }

    if (currentRules.length === 0) {
      enabled = false;
      clearPollTimer();
      if (releaseTrackedPrinters()) {
        reloadPrinters('server-plugin-presence-release');
      }
      lastObservedSignature = null;
      hasLoggedStartup = false;
      return;
    }

    enabled = true;
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
    id: 'presence',
    defaultConfig: {
      enabled: false,
      intervalSeconds: 5,
    },
    configHelpComment: 'Linux USB presence. Add printerId: "regex from lsusb" to hide it when absent.',
    syncConfig,
    stop() {
      enabled = false;
      clearPollTimer();
      releaseTrackedPrinters();
    },
  };
};

module.exports = {
  createPlugin,
};
