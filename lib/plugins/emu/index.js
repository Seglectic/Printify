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
  rootDir,
  parsedConfig = {},
}) => {
  const clientPluginConfig = parsedConfig.clientPluginConfig || {};
  const emuConfig = clientPluginConfig.emu || {};
  const romDirectory = ensureDirectory(path.join(rootDir, 'src', 'plugins', 'emu', 'ROM'));
  const saveDirectory = ensureDirectory(path.join(rootDir, 'src', 'plugins', 'emu', 'SAVES'));

  const getRomList = () => {
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

  return {
    id: 'emu',
    title: 'Game Boy',
    triggerCode: String(emuConfig.triggerCode || '123'),
    scriptUrl: '/plugins/emu/client/launcher.js',
    mountId: 'printify-emu-root',
    shouldApplyIsolationHeaders(requestPath) {
      const normalizedPath = String(requestPath || '');

      return (
        normalizedPath === '/'
        || normalizedPath === '/index.html'
        || normalizedPath.startsWith('/plugins/emu/')
        || normalizedPath === '/client-plugins/emu'
        || normalizedPath.startsWith('/client-plugins/emu/')
      );
    },
    getLibrary() {
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
    },
    findRom(romId) {
      return getRomList().find(rom => rom.id === String(romId || '').trim()) || null;
    },
    findSaveSlot(romId, slotValue) {
      const rom = this.findRom(romId);
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
    },
  };
};

module.exports = {
  createPlugin,
};
