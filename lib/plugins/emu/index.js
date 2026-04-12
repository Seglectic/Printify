// ╭────────────────────────────╮
// │  lib/plugins/emu/index.js  │
// │  Game Boy client plugin    │
// │  manifest + ROM/save       │
// │  library helpers           │
// ╰────────────────────────────╯
const fs = require('fs');
const path = require('path');


// ┌────────────────────┐
// │  Shared helpers    │
// └────────────────────┘
const sanitizeLeafName = (value, fallback) => {
  const normalizedValue = path.basename(String(value || '').trim());
  return normalizedValue || fallback;
};

const ensureDirectory = directoryPath => {
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
};

const isRomFile = fileName => ['.gb', '.gbc'].includes(path.extname(fileName).toLowerCase());
const createSlug = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  || 'rom';


// ┌────────────────────┐
// │  Plugin factory    │
// └────────────────────┘
const createPlugin = ({
  pluginDir,
  parsedConfig = {},
}) => {
  const romDirectory = ensureDirectory(path.join(pluginDir, 'ROM'));
  const saveDirectory = ensureDirectory(path.join(pluginDir, 'SAVES'));
  const plugin = {
    id: 'emu',
    title: 'Game Boy',
    isClientPlugin: true,
    publicDir: path.join(pluginDir, 'src'),
    enabled: false,
    triggerCode: '123',
    scriptUrl: '/plugins/emu/client/launcher.js',
    mountId: 'printify-emu-root',
    defaultConfig: {
      enabled: false,
      rom: 'tetris.gb',
      save: 'tetris.sav',
      triggerCode: '123',
    },
  };

  const getRomList = () => {
    const clientPluginConfig = parsedConfig.clientPluginConfig || {};
    const emuConfig = clientPluginConfig.emu || {};
    const preferredRom = sanitizeLeafName(emuConfig.rom || '', '');
    const romEntries = fs.readdirSync(romDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && isRomFile(entry.name))
      .map(entry => {
        const romFileName = entry.name;
        const romBaseName = path.parse(romFileName).name;
        const romId = createSlug(romBaseName);
        const romFilePath = path.join(romDirectory, romFileName);
        const romStats = fs.statSync(romFilePath);
        const romSaveDir = ensureDirectory(path.join(saveDirectory, romId));
        const saveSlots = Array.from({ length: 9 }, (_, slotIndex) => {
          const slotNumber = slotIndex + 1;
          const saveFileName = `slot-${slotNumber}.sav`;
          const saveFilePath = path.join(romSaveDir, saveFileName);
          const saveExists = fs.existsSync(saveFilePath);
          const saveStats = saveExists ? fs.statSync(saveFilePath) : null;

          return {
            slot: slotNumber,
            label: `Slot ${slotNumber}`,
            fileName: saveFileName,
            filePath: saveFilePath,
            exists: saveExists,
            sizeBytes: saveStats?.size || 0,
            updatedAt: saveStats?.mtime.toISOString() || null,
          };
        });

        return {
          id: romId,
          fileName: romFileName,
          displayName: romBaseName,
          filePath: romFilePath,
          sizeBytes: romStats.size,
          updatedAt: romStats.mtime.toISOString(),
          saveSlots,
        };
      })
      .sort((left, right) => {
        if (left.fileName === preferredRom) return -1;
        if (right.fileName === preferredRom) return 1;
        return left.displayName.localeCompare(right.displayName);
      });

    return romEntries;
  };

  plugin.syncConfig = nextParsedConfig => {
    parsedConfig = nextParsedConfig;
    const emuConfig = parsedConfig?.plugins?.emu || {};
    plugin.enabled = emuConfig.enabled === true;
    plugin.triggerCode = String(emuConfig.triggerCode || '123');
  };
  plugin.isEnabled = () => plugin.enabled;

  plugin.shouldApplyIsolationHeaders = requestPath => {
    const normalizedPath = String(requestPath || '');

    return (
      normalizedPath === '/'
      || normalizedPath === '/index.html'
      || normalizedPath.startsWith('/plugins/emu/')
      || normalizedPath === '/client-plugins/emu'
      || normalizedPath.startsWith('/client-plugins/emu/')
    );
  };

  plugin.getLibrary = () => {
    const roms = getRomList();

    return {
      defaultRomId: roms[0]?.id || null,
      roms: roms.map(rom => ({
        id: rom.id,
        fileName: rom.fileName,
        displayName: rom.displayName,
        sizeBytes: rom.sizeBytes,
        updatedAt: rom.updatedAt,
        romUrl: `/client-plugins/emu/rom/${encodeURIComponent(rom.id)}`,
        saveSlots: rom.saveSlots.map(slot => ({
          slot: slot.slot,
          label: slot.label,
          exists: slot.exists,
          sizeBytes: slot.sizeBytes,
          updatedAt: slot.updatedAt,
          saveUrl: `/client-plugins/emu/save/${encodeURIComponent(rom.id)}/${slot.slot}`,
        })),
      })),
    };
  };

  plugin.findRom = romId => {
    return getRomList().find(rom => rom.id === String(romId || '').trim()) || null;
  };

  plugin.findSaveSlot = (romId, slotValue) => {
    const rom = plugin.findRom(romId);
    const slotNumber = Number.parseInt(slotValue, 10);

    if (!rom || !Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 9) {
      return null;
    }

    const saveSlot = rom.saveSlots.find(slot => slot.slot === slotNumber);

    return saveSlot
      ? {
        rom,
        slot: saveSlot,
      }
      : null;
  };

  plugin.syncConfig(parsedConfig);
  return plugin;
};

module.exports = {
  createPlugin,
};
