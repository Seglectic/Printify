// ╭────────────────────────────╮
// │  tui.js                    │
// │  Lightweight terminal UI   │
// │  for runtime-safe config   │
// │  updates during local runs │
// ╰────────────────────────────╯
const fs = require('fs');
const path = require('path');
const readline = require('readline');


// ┌───────────────────────┐
// │  Terminal detection   │
// └───────────────────────┘
const hasInteractiveTerminal = () => Boolean(
  process.stdin.isTTY
  && process.stdout.isTTY
);

const exitApplication = () => {
  process.exit(0);
};


// ┌──────────────────────┐
// │  TUI bootstrapping   │
// └──────────────────────┘
const createTui = ({
  runtimeConfig,
  logsDir,
  uploadsDir,
  logStore,
  logStats,
  deduplicator,
  ingestService,
  onLogsPurged = () => {},
  logStamp,
  errorLogStamp,
}) => {
  if (!hasInteractiveTerminal()) {
    return {
      start() {},
    };
  }

  let cli = null;
  let started = false;

  const formatValue = value => (
    value === null || value === undefined ? 'null' : JSON.stringify(value)
  );

  const showHelp = () => {
    logStamp('TUI commands:');
    logStamp('  help                      Show available commands');
    logStamp('  show                      Print current global options');
    logStamp('  set <option> <value>      Update port, testing, assistant, or imPath');
    logStamp('  toggle testing            Toggle testing mode');
    logStamp('  reload                    Re-read config/config.yaml into runtime state');
    logStamp('  purge                     Clear all logs and uploads after confirmation');
    logStamp('  exit                      Close the terminal UI prompt');
  };

  const showOptions = () => {
    const options = runtimeConfig.getGlobalOptions();

    logStamp('Current global options:');
    Object.entries(options).forEach(([optionName, value]) => {
      logStamp(`  ${optionName}: ${formatValue(value)}`);
    });
  };

  const showChange = change => {
    const restartNote = change.requiresRestart ? ' (restart required)' : ' (applied live)';
    logStamp(`Updated ${change.option}: ${formatValue(change.previousValue)} -> ${formatValue(change.value)}${restartNote}`);
  };

  const toggleOption = optionName => {
    if (optionName !== 'testing') {
      throw new Error('toggle supports only testing');
    }

    const currentValue = runtimeConfig.getOption(optionName);
    return runtimeConfig.updateGlobalOption(optionName, String(!currentValue));
  };

  const ensureDirectory = async directoryPath => {
    await fs.promises.mkdir(directoryPath, { recursive: true });
  };

  const removeDirectoryContents = async directoryPath => {
    await ensureDirectory(directoryPath);
    const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });

    await Promise.all(entries.map(entry => (
      entry.name === '.gitkeep'
        ? Promise.resolve()
        : fs.promises.rm(path.join(directoryPath, entry.name), {
          recursive: true,
          force: true,
        })
    )));
  };

  const askYesNo = promptText => new Promise(resolve => {
    cli.question(promptText, response => {
      resolve(String(response || '').trim().toLowerCase());
    });
  });

  const purgeAllData = async () => {
    const response = await askYesNo(
      'Purge all logs and uploads? This cannot be undone. [y/N] '
    );

    if (!['y', 'yes'].includes(response)) {
      logStamp('Purge cancelled.');
      return;
    }

    if (ingestService?.purgePendingSessions) {
      await ingestService.purgePendingSessions();
    }

    await Promise.all([
      logStore?.purgeAll ? logStore.purgeAll() : removeDirectoryContents(logsDir),
      removeDirectoryContents(uploadsDir),
    ]);

    if (deduplicator?.purgeAll) {
      deduplicator.purgeAll();
    }

    if (logStats?.purgeAll) {
      logStats.purgeAll();
    }

    onLogsPurged();
    logStamp('Purged all logs and uploads.');
  };

  const handleCommand = async line => {
    const trimmedLine = String(line || '').trim();

    if (!trimmedLine) {
      return;
    }

    const [command, ...args] = trimmedLine.split(/\s+/);

    switch (command.toLowerCase()) {
      case 'help':
        showHelp();
        return;
      case 'show':
      case 'status':
        showOptions();
        return;
      case 'set': {
        if (args.length < 2) {
          throw new Error('usage: set <option> <value>');
        }

        const optionName = args[0];
        const rawValue = trimmedLine.replace(/^set\s+\S+\s+/i, '');
        const change = runtimeConfig.updateGlobalOption(optionName, rawValue);
        showChange(change);
        return;
      }
      case 'toggle': {
        if (args.length !== 1) {
          throw new Error('usage: toggle <testing>');
        }

        const change = toggleOption(args[0]);
        showChange(change);
        return;
      }
      case 'reload': {
        const result = runtimeConfig.reloadFromDisk();

        if (result.changes.length === 0) {
          logStamp('Reloaded config/config.yaml with no runtime changes.');
        } else {
          result.changes.forEach(showChange);
        }

        return;
      }
      case 'purge':
        await purgeAllData();
        return;
      case 'exit':
      case 'quit':
        cli.close();
        return;
      default:
        throw new Error(`Unknown command "${command}". Type "help" for usage.`);
    }
  };

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      cli = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'printify> ',
      });

      logStamp('Interactive TUI enabled. Type "help" for commands.');
      cli.prompt();

      cli.on('line', async line => {
        try {
          await handleCommand(line);
        } catch (error) {
          errorLogStamp(`TUI: ${error.message}`);
        }

        cli.prompt();
      });

      cli.on('close', () => {
        logStamp('Interactive TUI closed.');
      });

      cli.on('SIGINT', () => {
        exitApplication();
      });
    },
  };
};

const promptForAlternativePort = async ({
  blockedPort,
  runtimeConfig,
  logStamp,
  errorLogStamp,
}) => {
  if (!hasInteractiveTerminal()) {
    return null;
  }

  const suggestedPort = Math.min(Number(blockedPort) + 1, 65535);
  const cli = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = promptText => new Promise(resolve => {
    cli.question(promptText, resolve);
  });

  cli.on('SIGINT', () => {
    exitApplication();
  });

  try {
    while (true) {
      const response = await ask(
        `Port ${blockedPort} is already in use.\nEnter a new port to save to config/config.yaml [${suggestedPort}],\npress Enter to use it, or type "q" to quit:\n> `
      );
      const trimmedResponse = String(response || '').trim();

      if (trimmedResponse.toLowerCase() === 'q' || trimmedResponse.toLowerCase() === 'quit') {
        return null;
      }

      const requestedPort = trimmedResponse || String(suggestedPort);

      try {
        const change = runtimeConfig.updateGlobalOption('port', requestedPort);
        logStamp(`Saved port ${change.value} to config/config.yaml.`);
        return change.value;
      } catch (error) {
        errorLogStamp(`Port update failed: ${error.message}`);
      }
    }
  } finally {
    cli.close();
  }
};

module.exports = {
  createTui,
  hasInteractiveTerminal,
  promptForAlternativePort,
};
