// ╭────────────────────────────╮
// │  lib/plugins/assistant     │
// │  Shared assistant assets   │
// │  for mascot + dialogue     │
// ╰────────────────────────────╯
const path = require('path');

const PLUGIN_ID = 'assistant';
const AVAILABLE_MASCOTS = [
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
];
const DEFAULT_MASCOT = 'Clippy';
const DEFAULT_CONFIG = {
  enabled: true,
  mascot: DEFAULT_MASCOT,
};
const CONFIG_HELP_COMMENT = `Mascots: ${AVAILABLE_MASCOTS.join(', ')}`;

const createPlugin = ({ pluginDir, parsedConfig = {} }) => {
  let enabled = true;
  let mascot = DEFAULT_MASCOT;

  const resolveMascot = nextParsedConfig => {
    const configuredMascot = String(nextParsedConfig?.plugins?.[PLUGIN_ID]?.mascot || '').trim();

    if (AVAILABLE_MASCOTS.includes(configuredMascot)) {
      return configuredMascot;
    }

    const legacyMascot = String(nextParsedConfig?.assistant || '').trim();

    if (AVAILABLE_MASCOTS.includes(legacyMascot)) {
      return legacyMascot;
    }

    return DEFAULT_MASCOT;
  };

  const syncConfig = nextParsedConfig => {
    parsedConfig = nextParsedConfig;
    const pluginConfig = parsedConfig?.plugins?.[PLUGIN_ID] || null;
    const legacyAssistantDisabled = parsedConfig?.assistant === 'none' || parsedConfig?.clippy === false;
    enabled = !legacyAssistantDisabled && pluginConfig?.enabled !== false;
    mascot = resolveMascot(parsedConfig);
  };

  syncConfig(parsedConfig);

  return {
    id: PLUGIN_ID,
    publicDir: path.join(pluginDir, 'src'),
    defaultConfig: DEFAULT_CONFIG,
    configHelpComment: CONFIG_HELP_COMMENT,
    syncConfig,
    isEnabled: () => enabled,
    getMascot: () => mascot,
  };
};

module.exports = {
  createPlugin,
};
