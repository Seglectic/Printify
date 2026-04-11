// ╭────────────────────────────╮
// │  pluginLoader.js           │
// │  Discovers optional        │
// │  client plugins under      │
// │  lib/plugins/              │
// ╰────────────────────────────╯
const fs = require('fs');
const path = require('path');


// ┌────────────────────┐
// │  Loader factory    │
// └────────────────────┘
const createPluginLoader = ({
  rootDir,
  enabledPluginIds = [],
  parsedConfig = {},
  logStamp = () => {},
  errorLogStamp = () => {},
}) => {
  const pluginsDir = path.join(rootDir, 'lib', 'plugins');
  const enabledSet = new Set((enabledPluginIds || []).map(pluginId => String(pluginId || '').trim()).filter(Boolean));
  const plugins = {};

  if (fs.existsSync(pluginsDir)) {
    fs.readdirSync(pluginsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .forEach(entry => {
        const pluginId = entry.name;
        const pluginEntryPath = path.join(pluginsDir, pluginId, 'index.js');

        if (!fs.existsSync(pluginEntryPath)) {
          return;
        }

        try {
          // Plugin modules own their own metadata + helper methods.
          const pluginModule = require(pluginEntryPath);

          if (typeof pluginModule.createPlugin !== 'function') {
            errorLogStamp(`Plugin "${pluginId}" is missing createPlugin() in ${pluginEntryPath}`);
            return;
          }

          const pluginConfig = pluginModule.createPlugin({
            rootDir,
            parsedConfig,
          });

          if (!pluginConfig?.id) {
            errorLogStamp(`Plugin "${pluginId}" did not return an id.`);
            return;
          }

          plugins[pluginConfig.id] = pluginConfig;
        } catch (error) {
          errorLogStamp(`Plugin "${pluginId}" failed to load:`, error.message);
        }
      });
  }

  logStamp(`Plugin loader ready with ${Object.keys(plugins).length} discovered plugin${Object.keys(plugins).length === 1 ? '' : 's'}`);

  return {
    getEnabledPluginList() {
      return Object.values(plugins)
        .filter(pluginConfig => enabledSet.has(pluginConfig.id))
        .map(pluginConfig => ({
          id: pluginConfig.id,
          title: pluginConfig.title,
          triggerCode: pluginConfig.triggerCode,
          scriptUrl: pluginConfig.scriptUrl,
          mountId: pluginConfig.mountId,
          libraryUrl: `/client-plugins/${pluginConfig.id}/library`,
        }));
    },
    getPlugin(pluginId) {
      return plugins[String(pluginId || '').trim()] || null;
    },
    isEnabled(pluginId) {
      return enabledSet.has(String(pluginId || '').trim());
    },
    shouldApplyIsolationHeaders(requestPath) {
      return Object.values(plugins).some(pluginConfig => (
        enabledSet.has(pluginConfig.id)
        && typeof pluginConfig.shouldApplyIsolationHeaders === 'function'
        && pluginConfig.shouldApplyIsolationHeaders(requestPath)
      ));
    },
  };
};

module.exports = {
  createPluginLoader,
};
