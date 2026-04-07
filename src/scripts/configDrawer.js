(function () {
  // ╭──────────────────────────╮
  // │  Shared drawer markup    │
  // ╰──────────────────────────╯
  const buildConfigMarkup = () => `
    <div class="printify-config-drawer__scrim" data-role="scrim"></div>
    <aside class="printify-config-drawer__panel" data-role="panel">
      <div class="printify-config-drawer__header">
        <div class="printify-config-drawer__header-top">
          <h2 class="printify-config-drawer__title">Config Drawer</h2>
          <button class="printify-config-drawer__close" type="button" data-role="close">Close</button>
        </div>
        <p class="printify-config-drawer__subhead">Direct access to the live config file. Save writes back to <code>config.yaml</code>; Printify must be restarted for changes to apply.</p>
      </div>
      <div class="printify-config-drawer__body">
        <div class="printify-config-drawer__toolbar">
          <div class="printify-config-drawer__meta" data-role="meta">config.yaml</div>
          <div class="printify-config-drawer__actions">
            <button class="printify-config-drawer__button printify-config-drawer__button--secondary" type="button" data-role="reload">Reload</button>
            <button class="printify-config-drawer__button printify-config-drawer__button--primary" type="button" data-role="save">Save</button>
          </div>
        </div>
        <textarea class="printify-config-drawer__editor" data-role="editor" spellcheck="false" aria-label="config.yaml editor"></textarea>
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
      konamiCode: [
        ['arrowup', 'w'],
        ['arrowup', 'w'],
        ['arrowdown', 's'],
        ['arrowdown', 's'],
        ['arrowleft', 'a'],
        ['arrowright', 'd'],
        ['arrowleft', 'a'],
        ['arrowright', 'd'],
        ['b'],
        ['a'],
        ['enter'],
      ],
    }, options || {});

    const root = document.querySelector(rootSelector);

    if (!root) return null;
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
    let keyBuffer = [];

    const setStatus = message => {
      if (status) status.textContent = message || '';
    };

    const setOpenState = nextOpenState => {
      isOpen = nextOpenState;
      panel?.classList.toggle('is-open', nextOpenState);
      scrim?.classList.toggle('is-open', nextOpenState);

      if (nextOpenState) {
        window.setTimeout(() => {
          editor?.focus();
        }, 60);
      }
    };

    const loadConfig = async () => {
      setStatus('Loading config.yaml...');

      try {
        const response = await fetch(settings.configUrl);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || 'Could not load config.yaml');
        }

        if (editor) editor.value = payload.rawConfig || '';
        setStatus('Loaded config.yaml');
      } catch (error) {
        setStatus(error.message);
      }
    };

    const saveConfig = async () => {
      setStatus('Saving config.yaml...');
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

        setStatus('Saved config.yaml. Restart Printify to apply changes.');
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

    const openDrawer = () => {
      playKonamiAudio();
      setOpenState(true);
      loadConfig();
    };

    const normalizeKey = key => String(key || '').toLowerCase();

    const handleKonamiKey = event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const normalizedKey = normalizeKey(event.key);
      keyBuffer = [...keyBuffer, normalizedKey].slice(-settings.konamiCode.length);

      const matches = settings.konamiCode.every((acceptedKeys, index) => (
        acceptedKeys.includes(keyBuffer[index])
      ));

      if (matches) {
        keyBuffer = [];
        openDrawer();
      }
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
        return;
      }

      handleKonamiKey(event);
    });

    return {
      open: openDrawer,
      close: () => setOpenState(false),
      reload: loadConfig,
      save: saveConfig,
    };
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
