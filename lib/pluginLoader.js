// ╭────────────────────────────╮
// │  pluginLoader.js           │
// │  Unified plugin manager    │
// │  for client and server     │
// │  plugin capabilities       │
// ╰────────────────────────────╯
const fs = require('fs');
const path = require('path');
const express = require('express');

const createPluginManager = ({
  rootDir,
  runtimeConfig,
  serverSave,
  reloadPrinters = () => {},
  logStamp = () => {},
  errorLogStamp = () => {},
}) => {
  const pluginsDir = path.join(rootDir, 'lib', 'plugins');
  const plugins = {};
  const staticMounts = new Set();

  if (fs.existsSync(pluginsDir)) {
    fs.readdirSync(pluginsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .forEach(entry => {
        const pluginDir = path.join(pluginsDir, entry.name);
        const pluginEntryPath = path.join(pluginDir, 'index.js');

        if (!fs.existsSync(pluginEntryPath)) {
          return;
        }

        try {
          const pluginModule = require(pluginEntryPath);

          if (typeof pluginModule.createPlugin !== 'function') {
            return;
          }

          const plugin = pluginModule.createPlugin({
            rootDir,
            pluginDir,
            parsedConfig: runtimeConfig?.readParsedConfig ? runtimeConfig.readParsedConfig() : {},
            runtimeConfig,
            serverSave,
            reloadPrinters,
            logStamp,
            errorLogStamp,
          });

          if (!plugin?.id) {
            errorLogStamp(`Plugin in "${pluginDir}" did not return an id.`);
            return;
          }

          plugins[plugin.id] = plugin;
        } catch (error) {
          errorLogStamp(`Plugin "${entry.name}" failed to load:`, error.message);
        }
      });
  }

  const pluginDefaultsById = Object.fromEntries(
    Object.values(plugins)
      .filter(plugin => plugin?.defaultConfig && typeof plugin.defaultConfig === 'object')
      .map(plugin => [plugin.id, {
        config: plugin.defaultConfig,
        helpComment: plugin.configHelpComment || '',
      }])
  );

  if (Object.keys(pluginDefaultsById).length > 0) {
    runtimeConfig?.ensurePluginConfigs?.(pluginDefaultsById);
  }

  const syncFromConfig = () => {
    const parsedConfig = runtimeConfig?.readParsedConfig
      ? runtimeConfig.readParsedConfig()
      : {};
    Object.values(plugins).forEach(plugin => {
      try {
        plugin.syncConfig?.(parsedConfig);
      } catch (error) {
        errorLogStamp(`Plugin "${plugin.id}" failed during config sync:`, error.message);
      }
    });
  };

  syncFromConfig();
  logStamp(`Plugin manager ready with ${Object.keys(plugins).length} discovered plugin${Object.keys(plugins).length === 1 ? '' : 's'}`);

  return {
    registerStaticRoutes(app) {
      Object.values(plugins).forEach(plugin => {
        const publicDir = String(plugin.publicDir || '').trim();

        if (!publicDir || staticMounts.has(plugin.id)) {
          return;
        }

        app.use(`/plugins/${plugin.id}`, express.static(publicDir));
        staticMounts.add(plugin.id);
      });
    },
    syncFromConfig,
    stopAll() {
      Object.values(plugins).forEach(plugin => {
        try {
          plugin.stop?.();
        } catch (error) {
          errorLogStamp(`Plugin "${plugin.id}" failed to stop cleanly:`, error.message);
        }
      });
    },
    getEnabledPluginList() {
      return Object.values(plugins)
        .filter(plugin => plugin.isClientPlugin && (typeof plugin.isEnabled !== 'function' || plugin.isEnabled()))
        .map(plugin => ({
          id: plugin.id,
          title: plugin.title,
          code: plugin.code,
          scriptUrl: plugin.scriptUrl,
          mountId: plugin.mountId,
          libraryUrl: `/client-plugins/${plugin.id}/library`,
        }));
    },
    getPlugin(pluginId) {
      return plugins[String(pluginId || '').trim()] || null;
    },
    isEnabled(pluginId) {
      const plugin = plugins[String(pluginId || '').trim()] || null;
      return Boolean(plugin?.isClientPlugin && (typeof plugin.isEnabled !== 'function' || plugin.isEnabled()));
    },
    shouldApplyIsolationHeaders(requestPath) {
      return Object.values(plugins).some(plugin => (
        plugin.isClientPlugin
        && (typeof plugin.isEnabled !== 'function' || plugin.isEnabled())
        && typeof plugin.shouldApplyIsolationHeaders === 'function'
        && plugin.shouldApplyIsolationHeaders(requestPath)
      ));
    },
  };
};

module.exports = {
  createPluginLoader: createPluginManager,
  createPluginManager,
};
