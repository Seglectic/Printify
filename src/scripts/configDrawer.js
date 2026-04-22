(function () {
  const setClientOverlayActive = (layerName, isActive) => {
    window.printifyClientOverlay?.setActive?.(layerName, isActive);
  };
  const quickConfig = document.getElementById('quickConfig');
  const quickConfigBody = document.getElementById('quickConfigBody');

  // ╭──────────────────────────╮
  // │  Shared drawer markup    │
  // ╰──────────────────────────╯
  const buildConfigMarkup = () => `
    <div class="printify-config-drawer__scrim" data-role="scrim"></div>
    <aside class="printify-config-drawer__panel" data-role="panel">
      <div class="printify-config-drawer__header">
        <div class="printify-config-drawer__header-top">
          <h2 class="printify-config-drawer__title">Printify Config</h2>
          <button class="printify-config-drawer__close" type="button" data-role="close">Close</button>
        </div>
        <p class="printify-config-drawer__subhead">Direct access to the live config. Save writes back to <code>config/config.yaml</code> and updates the running system right away.</p>
      </div>
      <div class="printify-config-drawer__body">
        <div class="printify-config-drawer__toolbar">
          <div class="printify-config-drawer__meta" data-role="meta">config/config.yaml</div>
          <div class="printify-config-drawer__actions">
            <button class="printify-config-drawer__button printify-config-drawer__button--secondary" type="button" data-role="reload">Reload</button>
            <button class="printify-config-drawer__button printify-config-drawer__button--primary" type="button" data-role="save">Save</button>
          </div>
        </div>
        <textarea class="printify-config-drawer__editor" data-role="editor" spellcheck="false" aria-label="config/config.yaml editor"></textarea>
        <p class="printify-config-drawer__status" data-role="status"></p>
      </div>
    </aside>
  `;

  // ╭──────────────────────────╮
  // │  Drawer factory          │
  // ╰──────────────────────────╯
  function createPrintifyConfigDrawer(rootSelector, options) {
    const settings = Object.assign({
      configUrl: '/config',
      audioUrl: '/media/nami.mp3',
      accessSequence: [
        { keys: ['arrowup', 'w'], display: 'up' },
        { keys: ['arrowup', 'w'], display: 'up' },
        { keys: ['arrowdown', 's'], display: 'down' },
        { keys: ['arrowdown', 's'], display: 'down' },
        { keys: ['arrowleft', 'a'], display: 'left' },
        { keys: ['arrowright', 'd'], display: 'right' },
        { keys: ['arrowleft', 'a'], display: 'left' },
        { keys: ['arrowright', 'd'], display: 'right' },
        { keys: ['b'], display: 'b' },
        { keys: ['a'], display: 'a' },
        { keys: ['enter'], display: 'start' },
      ],
    }, options || {});

    const root = document.querySelector(rootSelector);

    if (!root) return null;
    if (root.__printifyConfigDrawerInstance) return root.__printifyConfigDrawerInstance;
    if (!root.innerHTML.trim()) root.innerHTML = buildConfigMarkup();

    const scrim = root.querySelector('[data-role="scrim"]');
    const panel = root.querySelector('[data-role="panel"]');
    const close = root.querySelector('[data-role="close"]');
    const reload = root.querySelector('[data-role="reload"]');
    const save = root.querySelector('[data-role="save"]');
    const editor = root.querySelector('[data-role="editor"]');
    const status = root.querySelector('[data-role="status"]');
    const audio = new window.Audio(settings.audioUrl);
    audio.volume = 0.2;
    let isOpen = false;
    let accessHandle = null;
    let shortcutUnlocked = false;
    let quickConfigShortcut = null;
    let quickConfigShortcutMeta = null;
    let quickConfigShortcutButton = null;

    const setStatus = message => {
      if (status) status.textContent = message || '';
    };

    const notifyQuickConfigChanged = () => {
      window.dispatchEvent(new window.CustomEvent('printify-quick-config-updated'));
    };

    const syncQuickConfigShortcut = () => {
      if (!quickConfigShortcut || !quickConfigShortcutMeta || !quickConfigShortcutButton) {
        return;
      }

      quickConfigShortcut.hidden = !shortcutUnlocked;
      quickConfigShortcutButton.textContent = isOpen ? 'Close Drawer' : 'Open Drawer';
      quickConfigShortcutButton.title = isOpen
        ? 'Close config drawer'
        : 'Open config drawer';
      quickConfigShortcutMeta.textContent = isOpen
        ? 'Live config editor is open.'
        : 'Live config editor unlocked.';
      notifyQuickConfigChanged();
    };

    const ensureQuickConfigShortcut = () => {
      if (!quickConfigBody) {
        return null;
      }

      if (!quickConfigShortcut) {
        quickConfigShortcut = document.createElement('div');
        quickConfigShortcut.className = 'printify-quick-config__section printify-quick-config__section--config';
        quickConfigShortcut.hidden = true;
        quickConfigShortcut.innerHTML = `
          <div class="printify-quick-config__copy">
            <p class="printify-quick-config__label">Config</p>
            <p class="printify-quick-config__meta" data-role="quick-config-meta">Live config editor unlocked.</p>
          </div>
          <button class="printify-quick-config__action printify-quick-config__action--config" type="button" data-role="quick-config-button">Open Drawer</button>
        `;

        quickConfigBody.appendChild(quickConfigShortcut);
        quickConfigShortcutMeta = quickConfigShortcut.querySelector('[data-role="quick-config-meta"]');
        quickConfigShortcutButton = quickConfigShortcut.querySelector('[data-role="quick-config-button"]');
        quickConfigShortcutButton?.addEventListener('click', () => {
          if (isOpen) {
            setOpenState(false);
            return;
          }

          openDrawer();
        });
      }

      syncQuickConfigShortcut();
      return quickConfigShortcut;
    };

    const unlockQuickConfigShortcut = () => {
      shortcutUnlocked = true;
      ensureQuickConfigShortcut();
    };

    const setOpenState = nextOpenState => {
      isOpen = nextOpenState;
      panel?.classList.toggle('is-open', nextOpenState);
      scrim?.classList.toggle('is-open', nextOpenState);
      setClientOverlayActive('config-drawer', nextOpenState);
      syncQuickConfigShortcut();

      if (nextOpenState) {
        window.setTimeout(() => {
          editor?.focus();
        }, 60);
      }
    };

    const loadConfig = async () => {
      setStatus('Loading config/config.yaml...');

      try {
        const response = await fetch(settings.configUrl);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || 'Could not load config/config.yaml');
        }

        if (editor) editor.value = payload.rawConfig || '';
        setStatus('Loaded config/config.yaml');
      } catch (error) {
        setStatus(error.message);
      }
    };

    const saveConfig = async () => {
      setStatus('Saving config/config.yaml...');
      if (save) save.disabled = true;

      try {
        const response = await fetch(settings.configUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            rawConfig: editor?.value || '',
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || 'Config save failed');
        }

        setStatus('Saved config/config.yaml. Changes are live now.');
      } catch (error) {
        setStatus(error.message);
      } finally {
        if (save) save.disabled = false;
      }
    };

    const playKonamiAudio = () => {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    };

    const openDrawer = ({ playAudio = false } = {}) => {
      if (playAudio) {
        playKonamiAudio();
      }

      setOpenState(true);
      loadConfig();
    };

    scrim?.addEventListener('click', () => {
      setOpenState(false);
    });

    close?.addEventListener('click', () => {
      setOpenState(false);
    });

    reload?.addEventListener('click', () => {
      loadConfig();
    });

    save?.addEventListener('click', () => {
      saveConfig();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isOpen) {
        setOpenState(false);
      }
    });

    accessHandle = window.printifyInput?.registerSequence?.({
      id: 'config-drawer-access',
      steps: settings.accessSequence,
      disableOnMatch: true,
      onMatch: () => {
        window.printifyFooterDrawer?.setSequencePreview?.([]);
        unlockQuickConfigShortcut();
        openDrawer({ playAudio: true });
      },
      onProgress: state => {
        window.printifyFooterDrawer?.setSequencePreview?.(state?.matchedSteps || []);
      },
    }) || null;

    const api = {
      open: openDrawer,
      close: () => setOpenState(false),
      reload: loadConfig,
      save: saveConfig,
      destroy: () => accessHandle?.unregister?.(),
    };

    root.__printifyConfigDrawerInstance = api;

    return api;
  }

  window.createPrintifyConfigDrawer = createPrintifyConfigDrawer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createPrintifyConfigDrawer('#printifyConfigDrawer');
    });
  } else {
    createPrintifyConfigDrawer('#printifyConfigDrawer');
  }
}());
