const EMU_STYLE_ID = 'printify-emu-styles';
const EMU_VENDOR_SCRIPT_ID = 'printify-emu-vendor';
const EMU_KEY_BINDINGS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  a: ['KeyK', 'KeyX'],
  b: ['KeyJ', 'KeyZ'],
  start: ['Enter'],
  select: ['ShiftLeft', 'ShiftRight'],
};
const NO_SAVE_SUPPORT_MESSAGE = 'This ROM does not expose battery-backed save RAM.';

let activePopup = null;
let vendorLoadPromise = null;

const loadStyles = () => {
  if (document.getElementById(EMU_STYLE_ID)) {
    return;
  }

  const link = document.createElement('link');
  link.id = EMU_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = '/plugins/emu/client/emu.css';
  document.head.appendChild(link);
};

const loadVendorBundle = () => {
  if (window.gameboy?.Gameboy) {
    return Promise.resolve(window.gameboy.Gameboy);
  }

  if (vendorLoadPromise) {
    return vendorLoadPromise;
  }

  vendorLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(EMU_VENDOR_SCRIPT_ID);

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.gameboy?.Gameboy), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Could not load emulator runtime.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = EMU_VENDOR_SCRIPT_ID;
    script.src = '/plugins/emu/vendor/gameboy.js';
    script.async = true;
    script.onload = () => {
      if (!window.gameboy?.Gameboy) {
        reject(new Error('Game Boy runtime did not initialize.'));
        return;
      }

      resolve(window.gameboy.Gameboy);
    };
    script.onerror = () => reject(new Error('Could not load emulator runtime.'));
    document.head.appendChild(script);
  });

  return vendorLoadPromise;
};

const formatStatus = value => String(value || '').trim();
const toUint8Array = value => {
  if (!value) {
    return null;
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(0));
  }

  return null;
};

const getSaveSignature = saveBytes => {
  const saveView = toUint8Array(saveBytes);

  if (!saveView?.length) {
    return null;
  }

  let checksum = 0;

  for (let index = 0; index < saveView.length; index += 1) {
    checksum = (checksum + saveView[index] * (index + 1)) % 2147483647;
  }

  return `${saveView.length}:${checksum}`;
};

const formatBytes = value => {
  const numericValue = Number(value) || 0;

  if (numericValue <= 0) {
    return 'Empty';
  }

  if (numericValue < 1024) {
    return `${numericValue} B`;
  }

  return `${(numericValue / 1024).toFixed(1)} KB`;
};

const formatDate = value => {
  if (!value) return 'Empty';

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Saved';
  }

  return parsedDate.toLocaleString();
};

const createDebugSavePayload = romId => {
  const encoder = new TextEncoder();
  const header = encoder.encode(`PRINTIFY-EMU-DEBUG:${romId}:${new Date().toISOString()}`);
  const payload = new Uint8Array(0x2000);
  payload.fill(0);
  payload.set(header.slice(0, payload.length));
  return payload;
};

const cloneArrayBuffer = value => {
  const saveView = toUint8Array(value);

  if (!saveView) {
    return null;
  }

  const clonedBytes = new Uint8Array(saveView.length);
  clonedBytes.set(saveView);
  return clonedBytes.buffer;
};

class PrintifyEmuPopup {
  constructor(pluginConfig, options = {}) {
    this.pluginConfig = pluginConfig;
    this.options = options;
    this.destroyed = false;
    this.isClosing = false;
    this.saveTimer = null;
    this.savePollTimer = null;
    this.currentStatus = '';
    this.keyState = new Set();
    this.queuedSave = Promise.resolve();
    this.library = null;
    this.selectedRomId = null;
    this.selectedSlotNumber = null;
    this.activeRom = null;
    this.activeSlot = null;
    this.lastObservedSaveSignature = null;
    this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
    this.handleDocumentKeyUp = this.handleDocumentKeyUp.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handleGlobalKeyDown = this.handleGlobalKeyDown.bind(this);
  }

  async open() {
    loadStyles();
    this.renderShell();
    this.setStatus('Loading emulator library...');
    await this.loadLibrary();
  }

  renderShell() {
    this.root = document.createElement('div');
    this.root.className = 'printify-emu';
    this.root.innerHTML = `
      <div class="printify-emu__backdrop" data-role="emu-close"></div>
      <section class="printify-emu__window" role="dialog" aria-modal="true" aria-labelledby="printifyEmuTitle">
        <header class="printify-emu__header">
          <div>
            <p class="printify-emu__eyebrow">Optional Client Plugin</p>
            <h2 class="printify-emu__title" id="printifyEmuTitle">Game Boy</h2>
          </div>
          <button class="printify-emu__close" type="button" data-role="emu-close" aria-label="Close emulator">Close</button>
        </header>
        <div class="printify-emu__launcher" data-role="emu-launcher">
          <section class="printify-emu__launcher-pane printify-emu__launcher-pane--roms">
            <div class="printify-emu__pane-header">
              <p class="printify-emu__pane-eyebrow">ROM Library</p>
              <p class="printify-emu__pane-copy">Pick a cartridge to browse its save slots.</p>
            </div>
            <div class="printify-emu__rom-grid" data-role="emu-rom-grid"></div>
          </section>
          <section class="printify-emu__launcher-pane printify-emu__launcher-pane--saves">
            <div class="printify-emu__pane-header">
              <p class="printify-emu__pane-eyebrow">Save Slots</p>
              <p class="printify-emu__pane-copy" data-role="emu-slot-copy">Select a ROM to see its 3x3 save grid.</p>
            </div>
            <div class="printify-emu__slot-grid" data-role="emu-slot-grid"></div>
          </section>
        </div>
        <div class="printify-emu__launcher-actions" data-role="emu-launcher-actions">
          <button class="printify-emu__button printify-emu__button--start" type="button" data-role="emu-start">Start Selected Game</button>
        </div>
        <div class="printify-emu__body" data-role="emu-game" hidden>
          <div class="printify-emu__screen-shell">
            <canvas class="printify-emu__screen" width="160" height="144"></canvas>
          </div>
          <aside class="printify-emu__panel">
            <p class="printify-emu__status" data-role="emu-status">Standing by...</p>
            <div class="printify-emu__actions">
              <button class="printify-emu__button" type="button" data-role="emu-save">Save</button>
              <button class="printify-emu__button printify-emu__button--secondary" type="button" data-role="emu-audio">Enable Audio</button>
            </div>
            <div class="printify-emu__actions printify-emu__actions--debug">
              <button class="printify-emu__button printify-emu__button--secondary" type="button" data-role="emu-inspect-save">Inspect Save RAM</button>
              <button class="printify-emu__button printify-emu__button--secondary" type="button" data-role="emu-write-test-save">Write Test Save</button>
            </div>
            <div class="printify-emu__controls" data-role="emu-controls">
              <p><strong>D-pad:</strong> Arrow Keys or WASD</p>
              <p><strong>B / A:</strong> J,K or Z,X</p>
              <p><strong>Start / Select:</strong> Enter / Shift</p>
              <p data-role="emu-session-meta"><strong>Session:</strong> Not started</p>
              <p data-role="emu-debug-meta"><strong>Save Debug:</strong> Not inspected</p>
            </div>
          </aside>
        </div>
      </section>
    `;

    document.body.appendChild(this.root);

    this.launcher = this.root.querySelector('[data-role="emu-launcher"]');
    this.launcherActions = this.root.querySelector('[data-role="emu-launcher-actions"]');
    this.gameShell = this.root.querySelector('[data-role="emu-game"]');
    this.romGrid = this.root.querySelector('[data-role="emu-rom-grid"]');
    this.slotGrid = this.root.querySelector('[data-role="emu-slot-grid"]');
    this.slotCopy = this.root.querySelector('[data-role="emu-slot-copy"]');
    this.startButton = this.root.querySelector('[data-role="emu-start"]');
    this.statusNode = this.root.querySelector('[data-role="emu-status"]');
    this.sessionMeta = this.root.querySelector('[data-role="emu-session-meta"]');
    this.canvas = this.root.querySelector('canvas');
    this.canvasContext = this.canvas.getContext('2d');
    this.saveButton = this.root.querySelector('[data-role="emu-save"]');
    this.audioButton = this.root.querySelector('[data-role="emu-audio"]');
    this.inspectSaveButton = this.root.querySelector('[data-role="emu-inspect-save"]');
    this.writeTestSaveButton = this.root.querySelector('[data-role="emu-write-test-save"]');
    this.debugMeta = this.root.querySelector('[data-role="emu-debug-meta"]');
    this.closeButtons = Array.from(this.root.querySelectorAll('[data-role="emu-close"]'));

    this.closeButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.close();
      });
    });

    this.startButton.addEventListener('click', () => {
      this.startSelectedSession();
    });

    this.saveButton.addEventListener('click', () => {
      this.persistSave('Save pushed to server.');
    });

    this.audioButton.addEventListener('click', () => {
      this.enableAudio();
    });

    this.inspectSaveButton.addEventListener('click', () => {
      this.inspectSaveRam();
    });

    this.writeTestSaveButton.addEventListener('click', () => {
      this.writeTestSave();
    });

    if (!window.crossOriginIsolated) {
      this.audioButton.disabled = true;
      this.audioButton.title = 'Audio needs a secure, cross-origin isolated page.';
    }
  }

  async loadLibrary() {
    const response = await fetch(this.pluginConfig.libraryUrl, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Could not load emulator ROM library.');
    }

    this.library = await response.json();
    const firstRom = this.library?.roms?.[0] || null;

    if (!firstRom) {
      this.setStatus('No ROMs found in lib/plugins/emu/ROM.');
      this.renderLauncher();
      return;
    }

    this.selectedRomId = this.library.defaultRomId || firstRom.id;
    this.selectedSlotNumber = 1;
    this.renderLauncher();
    this.setStatus('Pick a ROM and save slot, then load the game.');
  }

  renderLauncher() {
    const roms = Array.isArray(this.library?.roms) ? this.library.roms : [];
    const selectedRom = this.getSelectedRom();
    const saveSlots = Array.isArray(selectedRom?.saveSlots) ? selectedRom.saveSlots : [];

    this.romGrid.innerHTML = roms.map(rom => `
      <button
        class="printify-emu__grid-card${rom.id === this.selectedRomId ? ' is-selected' : ''}"
        type="button"
        data-role="emu-rom"
        data-rom-id="${this.escapeHtml(rom.id)}"
      >
        <span class="printify-emu__grid-icon" aria-hidden="true">GB</span>
        <span class="printify-emu__grid-title">${this.escapeHtml(rom.displayName)}</span>
        <span class="printify-emu__grid-meta">${this.escapeHtml(rom.fileName)}</span>
      </button>
    `).join('');

    this.slotCopy.textContent = selectedRom
      ? `Choose one of nine save slots for ${selectedRom.displayName}.`
      : 'Select a ROM to see its 3x3 save grid.';

    this.slotGrid.innerHTML = saveSlots.map(slot => `
      <button
        class="printify-emu__slot-card${slot.slot === this.selectedSlotNumber ? ' is-selected' : ''}"
        type="button"
        data-role="emu-slot"
        data-slot="${slot.slot}"
      >
        <span class="printify-emu__slot-icon" aria-hidden="true">S${slot.slot}</span>
        <span class="printify-emu__slot-label">${this.escapeHtml(slot.label)}</span>
        <span class="printify-emu__slot-meta">${slot.exists ? this.escapeHtml(formatBytes(slot.sizeBytes)) : 'Empty'}</span>
        <span class="printify-emu__slot-stamp">${slot.exists ? this.escapeHtml(formatDate(slot.updatedAt)) : 'Unused'}</span>
      </button>
    `).join('');

    this.startButton.disabled = !selectedRom || !this.selectedSlotNumber;

    this.romGrid.querySelectorAll('[data-role="emu-rom"]').forEach(button => {
      button.addEventListener('click', () => {
        this.selectedRomId = button.getAttribute('data-rom-id');
        this.selectedSlotNumber = 1;
        this.renderLauncher();
      });
    });

    this.slotGrid.querySelectorAll('[data-role="emu-slot"]').forEach(button => {
      button.addEventListener('click', () => {
        this.selectedSlotNumber = Number.parseInt(button.getAttribute('data-slot'), 10) || 1;
        this.renderLauncher();
      });
    });
  }

  getSelectedRom() {
    return (this.library?.roms || []).find(rom => rom.id === this.selectedRomId) || null;
  }

  getSelectedSlot() {
    return this.getSelectedRom()?.saveSlots?.find(slot => slot.slot === this.selectedSlotNumber) || null;
  }

  async startSelectedSession() {
    const selectedRom = this.getSelectedRom();
    const selectedSlot = this.getSelectedSlot();

    if (!selectedRom || !selectedSlot) {
      this.setStatus('Choose a ROM and a save slot first.');
      return;
    }

    this.activeRom = selectedRom;
    this.activeSlot = selectedSlot;
    this.root.classList.add('is-playing');
    this.launcher.hidden = true;
    this.launcherActions.hidden = true;
    this.gameShell.hidden = false;
    this.sessionMeta.textContent = `Session: ${selectedRom.displayName} • ${selectedSlot.label}`;
    this.debugMeta.textContent = 'Save Debug: Session booting';
    this.setStatus(`Loading ${selectedRom.displayName} on ${selectedSlot.label}...`);

    const Gameboy = await loadVendorBundle();

    if (this.destroyed) {
      return;
    }

    await this.bootGameboy(Gameboy, selectedRom, selectedSlot);
  }

  async bootGameboy(Gameboy, romConfig, slotConfig) {
    this.gameboy = new Gameboy();
    this.gameboy.keyboardManager.left = '__printify_disabled__';
    this.gameboy.keyboardManager.right = '__printify_disabled__';
    this.gameboy.keyboardManager.up = '__printify_disabled__';
    this.gameboy.keyboardManager.down = '__printify_disabled__';
    this.gameboy.keyboardManager.a = '__printify_disabled__';
    this.gameboy.keyboardManager.b = '__printify_disabled__';
    this.gameboy.keyboardManager.start = '__printify_disabled__';
    this.gameboy.keyboardManager.select = '__printify_disabled__';

    const originalRunFrame = this.gameboy.runFrame.bind(this.gameboy);
    this.gameboy.runFrame = time => {
      if (this.destroyed) {
        return;
      }

      originalRunFrame(time);
    };

    this.gameboy.onFrameFinished(imageData => {
      if (!this.destroyed) {
        this.canvasContext.putImageData(imageData, 0, 0);
      }
    });

    const [romBuffer, saveBytes] = await Promise.all([
      this.fetchArrayBuffer(romConfig.romUrl, 'Could not load ROM from server.'),
      this.loadSaveBytes(slotConfig.saveUrl),
    ]);

    if (this.destroyed) {
      return;
    }

    this.gameboy.loadGame(romBuffer);
    this.syncSaveCapability();

    if (saveBytes) {
      this.gameboy.setCartridgeSaveRam(cloneArrayBuffer(saveBytes));
      this.lastObservedSaveSignature = getSaveSignature(saveBytes);
      this.setStatus(`Loaded ${saveBytes.length} bytes from ${slotConfig.label}.`);
    } else if (this.hasSaveSupport()) {
      this.lastObservedSaveSignature = null;
      this.setStatus(`${slotConfig.label} is empty. Starting a fresh game.`);
    } else {
      this.setStatus(`${romConfig.displayName} loaded. ${NO_SAVE_SUPPORT_MESSAGE}`);
    }

    if (this.hasSaveSupport()) {
      this.gameboy.setOnWriteToCartridgeRam(() => {
        this.queueAutosave();
      });
      this.startSavePolling();
      this.inspectSaveRam();
    }

    this.attachKeyboard();
    this.gameboy.run();

    if (this.hasSaveSupport()) {
      this.setStatus(`Playing ${romConfig.displayName} on ${slotConfig.label}. Autosave armed.`);
      return;
    }

    this.setStatus(`Playing ${romConfig.displayName}. Save support is unavailable for this ROM.`);
  }

  attachKeyboard() {
    document.addEventListener('keydown', this.handleDocumentKeyDown, true);
    document.addEventListener('keyup', this.handleDocumentKeyUp, true);
    document.addEventListener('keydown', this.handleGlobalKeyDown);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  detachKeyboard() {
    document.removeEventListener('keydown', this.handleDocumentKeyDown, true);
    document.removeEventListener('keyup', this.handleDocumentKeyUp, true);
    document.removeEventListener('keydown', this.handleGlobalKeyDown);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.keyState.clear();
    this.applyInputState();
  }

  handleGlobalKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.close();
  }

  handleDocumentKeyDown(event) {
    if (!this.root || !this.isMappedCode(event.code)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.keyState.add(event.code);
    this.applyInputState();
  }

  handleDocumentKeyUp(event) {
    if (!this.root || !this.isMappedCode(event.code)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.keyState.delete(event.code);
    this.applyInputState();
  }

  handleWindowBlur() {
    this.keyState.clear();
    this.applyInputState();
  }

  isMappedCode(code) {
    return Object.values(EMU_KEY_BINDINGS).some(bindingList => bindingList.includes(code));
  }

  applyInputState() {
    if (!this.gameboy?.input) {
      return;
    }

    this.gameboy.input.isPressingUp = EMU_KEY_BINDINGS.up.some(code => this.keyState.has(code));
    this.gameboy.input.isPressingDown = EMU_KEY_BINDINGS.down.some(code => this.keyState.has(code));
    this.gameboy.input.isPressingLeft = EMU_KEY_BINDINGS.left.some(code => this.keyState.has(code));
    this.gameboy.input.isPressingRight = EMU_KEY_BINDINGS.right.some(code => this.keyState.has(code));
    this.gameboy.input.isPressingA = EMU_KEY_BINDINGS.a.some(code => this.keyState.has(code));
    this.gameboy.input.isPressingB = EMU_KEY_BINDINGS.b.some(code => this.keyState.has(code));
    this.gameboy.input.isPressingStart = EMU_KEY_BINDINGS.start.some(code => this.keyState.has(code));
    this.gameboy.input.isPressingSelect = EMU_KEY_BINDINGS.select.some(code => this.keyState.has(code));
  }

  async fetchArrayBuffer(url, errorMessage) {
    const response = await fetch(url, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(errorMessage);
    }

    return response.arrayBuffer();
  }

  async loadSaveBytes(saveUrl) {
    const response = await fetch(saveUrl, {
      cache: 'no-store',
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      throw new Error('Could not load server save.');
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  queueAutosave() {
    if (!this.hasSaveSupport()) {
      return;
    }

    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.persistSave(`Autosaved to ${this.activeSlot?.label || 'server slot'}.`);
    }, 900);
  }

  startSavePolling() {
    if (this.savePollTimer) {
      window.clearInterval(this.savePollTimer);
    }

    this.savePollTimer = window.setInterval(() => {
      if (!this.hasSaveSupport() || !this.gameboy?.getCartridgeSaveRam) {
        return;
      }

      const saveBytes = this.gameboy.getCartridgeSaveRam();
      const nextSignature = getSaveSignature(saveBytes);

      if (!nextSignature || nextSignature === this.lastObservedSaveSignature) {
        return;
      }

      this.lastObservedSaveSignature = nextSignature;
      this.queueAutosave();
    }, 2500);
  }

  async persistSave(successMessage) {
    if (!this.hasSaveSupport()) {
      this.setStatus(NO_SAVE_SUPPORT_MESSAGE);
      return;
    }

    if (!this.activeSlot?.saveUrl) {
      this.setStatus('No active save slot selected.');
      return;
    }

    const saveBytes = this.gameboy.getCartridgeSaveRam();
    const saveView = toUint8Array(saveBytes);

    if (!saveView || !saveView.length) {
      this.setStatus('No save data to write yet.');
      return;
    }

    this.setStatus(`Saving to ${this.activeSlot.label}...`);

    this.queuedSave = this.queuedSave.then(async () => {
      const response = await fetch(this.activeSlot.saveUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: saveView,
      });

      if (!response.ok) {
        throw new Error('Could not persist save file.');
      }

      const savePayload = await response.json().catch(() => null);
      const savedBytes = Number(savePayload?.bytes || saveView.length || 0);
      this.lastObservedSaveSignature = getSaveSignature(saveView);
      this.setStatus(successMessage || `Saved ${savedBytes} bytes to ${this.activeSlot.label}.`);
      this.setDebugMeta(`Save Debug: wrote ${savedBytes} bytes to ${this.activeSlot.label}`);
      this.updateActiveSlotAfterSave(savedBytes);
      this.renderLauncher();
    }).catch(error => {
      this.setStatus(error.message || 'Save failed.');
      this.setDebugMeta(`Save Debug: write failed (${error.message || 'unknown error'})`);
      throw error;
    });

    try {
      await this.queuedSave;
    } catch (error) {
      console.error(error);
    }
  }

  updateActiveSlotAfterSave(sizeBytes) {
    if (!this.activeSlot) {
      return;
    }

    this.activeSlot.exists = true;
    this.activeSlot.sizeBytes = sizeBytes;
    this.activeSlot.updatedAt = new Date().toISOString();

    const selectedRom = this.getSelectedRom();
    const slotIndex = selectedRom?.saveSlots?.findIndex(slot => slot.slot === this.activeSlot.slot);

    if (selectedRom && slotIndex >= 0) {
      selectedRom.saveSlots[slotIndex] = {
        ...selectedRom.saveSlots[slotIndex],
        exists: true,
        sizeBytes,
        updatedAt: this.activeSlot.updatedAt,
      };
    }
  }

  async enableAudio() {
    if (!window.crossOriginIsolated) {
      this.setStatus('Audio still unavailable: open Printify from a secure, isolated origin.');
      return;
    }

    try {
      await this.gameboy?.apu?.enableSound?.();
      this.setStatus('Audio enabled when browser security allows it.');
    } catch (error) {
      this.setStatus('Audio could not be enabled in this browser.');
    }
  }

  hasSaveSupport() {
    return Boolean(this.gameboy?.cartridge?.ramSize);
  }

  setDebugMeta(message) {
    if (this.debugMeta) {
      this.debugMeta.textContent = message;
    }
  }

  inspectSaveRam() {
    if (!this.gameboy?.cartridge) {
      this.setDebugMeta('Save Debug: cartridge not loaded yet');
      return;
    }

    const cartridge = this.gameboy.cartridge;
    const saveBytes = typeof this.gameboy.getCartridgeSaveRam === 'function'
      ? this.gameboy.getCartridgeSaveRam()
      : null;
    const saveView = toUint8Array(saveBytes);
    const byteLength = saveView?.length || 0;
    const signature = getSaveSignature(saveBytes) || 'none';
    this.setDebugMeta(
      `Save Debug: type=${cartridge.typeName || 'unknown'} ram=${cartridge.ramSize || 0} bytes=${byteLength} sig=${signature}`
    );
  }

  async writeTestSave() {
    if (!this.activeSlot?.saveUrl || !this.activeRom?.id) {
      this.setDebugMeta('Save Debug: no active slot selected');
      return;
    }

    const testPayload = createDebugSavePayload(this.activeRom.id);

    this.setStatus(`Writing test save to ${this.activeSlot.label}...`);

    const response = await fetch(this.activeSlot.saveUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: testPayload,
    });

    if (!response.ok) {
      this.setDebugMeta('Save Debug: test save write failed');
      this.setStatus('Test save write failed.');
      return;
    }

    this.updateActiveSlotAfterSave(testPayload.length);
    this.renderLauncher();
    this.setDebugMeta(`Save Debug: test file wrote ${testPayload.length} bytes`);
    this.setStatus(`Test save wrote ${testPayload.length} bytes to ${this.activeSlot.label}.`);
  }

  syncSaveCapability() {
    if (!this.saveButton) {
      return;
    }

    const saveSupported = this.hasSaveSupport();
    this.saveButton.disabled = !saveSupported;
    this.saveButton.title = saveSupported ? 'Persist the current slot to the server.' : NO_SAVE_SUPPORT_MESSAGE;
  }

  setStatus(message) {
    this.currentStatus = formatStatus(message);

    if (this.statusNode) {
      this.statusNode.textContent = this.currentStatus || 'Standing by...';
    }

    if (typeof this.options.showFeedback === 'function' && this.currentStatus) {
      this.options.showFeedback(this.currentStatus);
    }
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async close() {
    if (this.destroyed || this.isClosing) {
      return;
    }

    this.isClosing = true;

    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (this.savePollTimer) {
      window.clearInterval(this.savePollTimer);
      this.savePollTimer = null;
    }

    this.detachKeyboard();
    this.root?.remove();
    this.destroyed = true;

    if (activePopup === this) {
      activePopup = null;
    }

    if (this.hasSaveSupport()) {
      this.persistSave('Session saved before closing.').catch(error => {
        console.error(error);
      });
    }
  }
}

export const activatePlugin = async (pluginConfig, options = {}) => {
  if (activePopup) {
    return activePopup;
  }

  activePopup = new PrintifyEmuPopup(pluginConfig, options);

  try {
    await activePopup.open();
    return activePopup;
  } catch (error) {
    activePopup?.root?.remove();
    activePopup = null;
    throw error;
  }
};
