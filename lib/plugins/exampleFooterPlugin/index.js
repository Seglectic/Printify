// ╭────────────────────────────────────────────╮
// │  lib/plugins/exampleFooterPlugin/index.js  │
// │  Example footer-hosted client plugin       │
// │  boilerplate + hidden code activation      │
// ╰────────────────────────────────────────────╯
const path = require('path');

const PLUGIN_ID = 'exampleFooterPlugin';
const DEFAULT_CODE = 'life';
const DEFAULT_CONFIG = {
  enabled: true,
  code: DEFAULT_CODE,
};

const createPlugin = ({ pluginDir, parsedConfig = {} }) => {
  const plugin = {
    id: PLUGIN_ID,
    title: 'Conway Life',
    isClientPlugin: true,
    publicDir: path.join(pluginDir, 'src'),
    enabled: true,
    code: DEFAULT_CODE,
    scriptUrl: `/plugins/${PLUGIN_ID}/client/launcher.js`,
    mountId: 'printify-life-root',
    defaultConfig: DEFAULT_CONFIG,
  };

  plugin.syncConfig = nextParsedConfig => {
    parsedConfig = nextParsedConfig;
    const pluginConfig = parsedConfig?.plugins?.[PLUGIN_ID] || {};
    plugin.enabled = pluginConfig.enabled !== false;
    plugin.code = String(pluginConfig.code || DEFAULT_CODE);
  };

  plugin.isEnabled = () => plugin.enabled;

  plugin.syncConfig(parsedConfig);
  return plugin;
};

module.exports = {
  createPlugin,
};
