// ╭────────────────────────────╮
// │  runtimeConfig.js          │
// │  Reads and updates the     │
// │  global runtime options    │
// │  stored in config/         │
// ╰────────────────────────────╯
const fs   = require('fs');
const path = require('path');
const YAML = require('yaml');
const { spawnSync } = require('child_process');


// ┌─────────────────┐
// │  Project paths  │
// └─────────────────┘
const rootDir = path.resolve(__dirname, '..');
const configDir = path.join(rootDir, 'config');
const configPath = path.join(configDir, 'config.yaml');
const exampleConfigPath = path.join(configDir, '_exampleConfig.yaml');
const iconsDir = path.join(configDir, 'icons');
const fontsDir = path.join(configDir, 'fonts');


// ┌────────────────────┐
// │  Global option map │
// └────────────────────┘
const getDefaultImPath = () => {
  if (process.platform === 'win32') {
    return 'C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/convert.exe';
  }

  // ImageMagick 7 prefers "magick" on macOS and many Linux installs.
  // Fall back to "convert" for older ImageMagick 6 setups that still ship it.
  if (hasRunnableCommand('magick')) {
    return 'magick';
  }

  return 'convert';
};

const hasRunnableCommand = commandName => {
  const probe = spawnSync(commandName, ['-version'], {
    encoding: 'utf8',
  });

  return !probe.error && probe.status === 0;
};

const globalOptionDefinitions = {
  port: {
    parse(value) {
      const parsedValue = Number.parseInt(String(value), 10);

      if (!Number.isInteger(parsedValue) || parsedValue <= 0 || parsedValue > 65535) {
        throw new Error('port must be an integer between 1 and 65535');
      }

      return parsedValue;
    },
    read(parsedConfig) {
      return parsedConfig.port ?? 8020;
    },
    requiresRestart: true,
  },
  testing: {
    parse(value) {
      return parseBoolean(value, 'testing');
    },
    read(parsedConfig) {
      return parsedConfig.testing ?? true;
    },
    requiresRestart: false,
  },
  assistant: {
    parse(value) {
      return parseAssistant(value);
    },
    read(parsedConfig) {
      if (parsedConfig.assistant !== undefined) {
        return parseAssistant(parsedConfig.assistant, { allowLegacyNone: true });
      }

      return 'Clippy';
    },
    requiresRestart: false,
  },
  fileWatchReload: {
    parse(value) {
      return parseBoolean(value, 'fileWatchReload');
    },
    read(parsedConfig) {
      return parsedConfig.fileWatchReload ?? true;
    },
    requiresRestart: false,
  },
  imPath: {
    parse(value) {
      const normalizedValue = String(value ?? '').trim();
      return normalizedValue || null;
    },
    read(parsedConfig) {
      return parsedConfig.imPath || getDefaultImPath();
    },
    requiresRestart: true,
  },
};

function parseBoolean(value, optionName) {
  const normalizedValue = String(value).trim().toLowerCase();

  if (['true', 'on', 'yes', '1'].includes(normalizedValue)) {
    return true;
  }

  if (['false', 'off', 'no', '0'].includes(normalizedValue)) {
    return false;
  }

  throw new Error(`${optionName} must be true/false`);
}

const assistantNames = new Set([
  'Bonzi',
  'Clippy',
  'F1',
  'Genie',
  'Genius',
  'Links',
  'Merlin',
  'Peedy',
  'Rocky',
  'Rover',
]);

function parseAssistant(value, { allowLegacyNone = false } = {}) {
  const normalizedValue = String(value ?? '').trim();

  if (allowLegacyNone && normalizedValue === 'none') {
    return 'Clippy';
  }

  if (!assistantNames.has(normalizedValue)) {
    throw new Error(`assistant must be one of: ${Array.from(assistantNames).join(', ')}`);
  }

  return normalizedValue;
}

const ensureTrailingNewline = rawConfig => (
  rawConfig.endsWith('\n') ? rawConfig : `${rawConfig}\n`
);

const parseRawConfig = rawConfig => YAML.parse(rawConfig) || {};

const ensureConfigLayout = () => {
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(fontsDir, { recursive: true });

  if (!fs.existsSync(configPath)) {
    if (!fs.existsSync(exampleConfigPath)) {
      throw new Error('Missing config/_exampleConfig.yaml; cannot create config/config.yaml');
    }

    const exampleConfig = fs.readFileSync(exampleConfigPath, 'utf8');
    fs.writeFileSync(configPath, ensureTrailingNewline(exampleConfig), 'utf8');
  }
};

ensureConfigLayout();

const readRawConfig = () => fs.readFileSync(configPath, 'utf8');

const readParsedConfig = () => parseRawConfig(readRawConfig());

const readConfigDocument = () => {
  const rawConfig = readRawConfig();
  const document = YAML.parseDocument(rawConfig);

  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  return document;
};

const readGlobalOptions = parsedConfig => Object.fromEntries(
  Object.entries(globalOptionDefinitions).map(([optionName, optionDefinition]) => (
    [optionName, optionDefinition.read(parsedConfig)]
  ))
);

const clonePlainValue = value => JSON.parse(JSON.stringify(value));
const normalizePluginDefaultEntry = entry => (
  entry?.config && typeof entry.config === 'object'
    ? {
      config: entry.config,
      helpComment: String(entry.helpComment || '').trim(),
    }
    : {
      config: entry,
      helpComment: '',
    }
);

const mergeMissingPluginDefaults = (document, targetNode, defaultConfig) => {
  if (!targetNode || typeof targetNode.has !== 'function' || typeof targetNode.set !== 'function') {
    return false;
  }

  let changed = false;

  Object.entries(defaultConfig || {}).forEach(([key, value]) => {
    if (targetNode.has(key)) {
      const existingNode = targetNode.get(key, true);
      const shouldRecurse = (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && existingNode
        && typeof existingNode.has === 'function'
        && typeof existingNode.set === 'function'
      );

      if (shouldRecurse) {
        changed = mergeMissingPluginDefaults(document, existingNode, value) || changed;
      }

      return;
    }

    targetNode.set(key, document.createNode(clonePlainValue(value)));
    changed = true;
  });

  return changed;
};

const formatYamlComment = comment => String(comment || '')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => ` ${line}`)
  .join('\n');

const formatYamlInlineComment = comment => {
  const normalizedComment = String(comment || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ');

  return normalizedComment ? ` ${normalizedComment}` : '';
};

const findMapPairByKey = (yamlMap, keyName) => (
  Array.isArray(yamlMap?.items)
    ? yamlMap.items.find(item => String(item?.key?.value ?? item?.key ?? '').trim() === keyName)
    : null
);

const diffOptions = (previousOptions, nextOptions) => Object.keys(globalOptionDefinitions)
  .filter(optionName => previousOptions[optionName] !== nextOptions[optionName])
  .map(optionName => ({
    option: optionName,
    previousValue: previousOptions[optionName],
    value: nextOptions[optionName],
    requiresRestart: globalOptionDefinitions[optionName].requiresRestart,
    appliedLive: !globalOptionDefinitions[optionName].requiresRestart,
  }));

const createRuntimeConfig = () => {
  let currentOptions = readGlobalOptions(readParsedConfig());

  const syncParsedConfig = parsedConfig => {
    const nextOptions = readGlobalOptions(parsedConfig);
    const changes = diffOptions(currentOptions, nextOptions);
    currentOptions = nextOptions;
    return changes;
  };

  const setRawConfig = rawConfig => {
    const parsedConfig = parseRawConfig(rawConfig);
    fs.writeFileSync(configPath, ensureTrailingNewline(rawConfig), 'utf8');
    const changes = syncParsedConfig(parsedConfig);

    return {
      changes,
      options: { ...currentOptions },
    };
  };

  const updateGlobalOption = (optionName, rawValue) => {
    const optionDefinition = globalOptionDefinitions[optionName];

    if (!optionDefinition) {
      throw new Error(`Unknown global option "${optionName}"`);
    }

    const document = readConfigDocument();
    const nextValue = optionDefinition.parse(rawValue);
    document.set(optionName, nextValue);

    const result = setRawConfig(String(document));
    const changedOption = result.changes.find(change => change.option === optionName) || {
      option: optionName,
      previousValue: currentOptions[optionName],
      value: nextValue,
      requiresRestart: optionDefinition.requiresRestart,
      appliedLive: !optionDefinition.requiresRestart,
    };

    return {
      ...changedOption,
      options: result.options,
    };
  };

  const ensurePluginConfigs = (pluginDefaultsById = {}) => {
    const document = readConfigDocument();
    let pluginsNode = document.get('plugins', true);
    let changed = false;

    if (!pluginsNode || typeof pluginsNode.has !== 'function' || typeof pluginsNode.set !== 'function') {
      // A blank "plugins:" parses as null until the first plugin adds defaults.
      // Upgrade it to a writable YAML map before merging plugin entries.
      pluginsNode = document.createNode({});
      document.set('plugins', pluginsNode);
      changed = true;
    }

    Object.entries(pluginDefaultsById).forEach(([pluginId, defaultEntry]) => {
      const { config: defaultConfig, helpComment } = normalizePluginDefaultEntry(defaultEntry);
      const formattedHelpComment = formatYamlComment(helpComment);
      const formattedInlineComment = formatYamlInlineComment(helpComment);

      if (!pluginId || !defaultConfig || typeof defaultConfig !== 'object') {
        return;
      }

      if (!pluginsNode.has(pluginId)) {
        const pluginNode = document.createNode(clonePlainValue(defaultConfig));
        pluginsNode.set(pluginId, pluginNode);
        const pluginPair = findMapPairByKey(pluginsNode, pluginId);
        if (formattedInlineComment && pluginPair) {
          pluginPair.key = document.createNode(pluginId);
          pluginPair.key.comment = formattedInlineComment;
        }

        changed = true;
        return;
      }

      const pluginNode = pluginsNode.get(pluginId, true);
      const pluginPair = findMapPairByKey(pluginsNode, pluginId);
      const hasInlineComment = Boolean(pluginPair?.key?.comment);
      const hasLegacyCommentBefore = Boolean(pluginNode?.commentBefore);

      if (formattedInlineComment && pluginPair && !hasInlineComment) {
        if (!pluginPair.key || typeof pluginPair.key !== 'object') {
          pluginPair.key = document.createNode(pluginId);
        }

        pluginPair.key.comment = formattedInlineComment;
        changed = true;
      }

      if (hasLegacyCommentBefore) {
        pluginNode.commentBefore = null;
        changed = true;
      }

      if (mergeMissingPluginDefaults(document, pluginNode, defaultConfig)) {
        changed = true;
      }
    });

    if (!changed) {
      return {
        changed: false,
        changes: [],
        options: { ...currentOptions },
      };
    }

    const result = setRawConfig(String(document));
    return {
      changed: true,
      changes: result.changes,
      options: result.options,
    };
  };

  return {
    rootDir,
    configDir,
    configPath,
    exampleConfigPath,
    iconsDir,
    fontsDir,
    getDefaultImPath,
    getGlobalOptions: () => ({ ...currentOptions }),
    getOption: optionName => currentOptions[optionName],
    readRawConfig,
    readParsedConfig,
    reloadFromDisk: () => ({
      changes: syncParsedConfig(readParsedConfig()),
      options: { ...currentOptions },
    }),
    ensurePluginConfigs,
    saveRawConfig: setRawConfig,
    updateGlobalOption,
  };
};

module.exports = {
  rootDir,
  configDir,
  configPath,
  exampleConfigPath,
  iconsDir,
  fontsDir,
  getDefaultImPath,
  readRawConfig,
  readParsedConfig,
  createRuntimeConfig,
};
