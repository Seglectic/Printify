(function () {
  // ╭──────────────────────────╮
  // │  Footer plugin host     │
  // ╰──────────────────────────╯
  // This drawer is intended to be the shared "wildcard" surface for client
  // plugins that want a persistent home inside the main index page instead of
  // creating one-off overlays. Plugins can register a surface with a stable id,
  // title, tab label, desired height, and a mounted HTMLElement. The drawer
  // keeps those panes alive while hidden so heavyweight surfaces such as the
  // DMG emulator can be swept away and brought back without losing in-memory
  // state. Multiple registered plugin panes appear as tabs on the footer rail
  // itself so they feel like docked panels instead of nested drawer controls.
  const setClientOverlayActive = (layerName, isActive) => {
    window.printifyClientOverlay?.setActive?.(layerName, isActive);
  };
  const isTypingContext = target => {
    if (!target || !(target instanceof Element)) return false;

    if (target.closest('input, textarea, select, [contenteditable="true"]')) {
      return true;
    }

    return target.getAttribute('contenteditable') === 'true';
  };

  const DEFAULT_SURFACE_ID = '__default__';

  const buildFooterDrawerMarkup = () => `
    <div class="printify-footer-drawer__scrim" data-role="scrim"></div>
    <aside class="printify-footer-drawer__panel" data-role="panel" aria-hidden="true">
      <div class="printify-footer-drawer__header">
        <div class="printify-footer-drawer__heading">
          <p class="printify-footer-drawer__eyebrow" data-role="eyebrow"></p>
          <h2 class="printify-footer-drawer__title" data-role="title"></h2>
        </div>
        <div class="printify-footer-drawer__header-actions">
          <button class="printify-footer-drawer__close" type="button" data-role="close">Close</button>
        </div>
      </div>
      <div class="printify-footer-drawer__body" data-role="body">
        <div class="printify-footer-drawer__surface-host" data-role="surface-host"></div>
      </div>
    </aside>
  `;

  function createPrintifyFooterDrawer(rootSelector, options) {
    const settings = Object.assign({
      footerSelector: '#footer',
      layerName: 'footer-drawer',
      typeSpeed: 40,
      secondaryDelayMs: 1200,
      defaultHeight: 'min(50vh, 540px)',
    }, options || {});

    const root = document.querySelector(rootSelector);
    const footer = document.querySelector(settings.footerSelector);

    if (!root || !footer) return null;
    if (root.__printifyFooterDrawerInstance) return root.__printifyFooterDrawerInstance;
    if (!root.innerHTML.trim()) root.innerHTML = buildFooterDrawerMarkup();

    const scrim = root.querySelector('[data-role="scrim"]');
    const panel = root.querySelector('[data-role="panel"]');
    const eyebrow = root.querySelector('[data-role="eyebrow"]');
    const title = root.querySelector('[data-role="title"]');
    const body = root.querySelector('[data-role="body"]');
    const surfaceHost = root.querySelector('[data-role="surface-host"]');
    const close = root.querySelector('[data-role="close"]');

    footer.innerHTML = `
      <div class="printify-footer__tabs-rail" data-role="tabs-rail" hidden>
        <div class="printify-footer__tabs" data-role="tabs"></div>
      </div>
      <div class="printify-footer__left" data-role="left" aria-hidden="true"></div>
      <div class="printify-footer__status" data-role="status" aria-live="polite"></div>
      <div class="printify-footer__right" data-role="right"></div>
    `;

    const footerTabsRail = footer.querySelector('[data-role="tabs-rail"]');
    const tabs = footer.querySelector('[data-role="tabs"]');
    const footerLeft = footer.querySelector('[data-role="left"]');
    const footerStatus = footer.querySelector('[data-role="status"]');
    const footerRight = footer.querySelector('[data-role="right"]');

    let isOpen = false;
    let versionTypeTimers = [];
    let statusTypeTimers = [];
    let activeSurfaceId = DEFAULT_SURFACE_ID;
    const surfaces = new Map();

    const clearVersionTypeTimers = () => {
      versionTypeTimers.forEach(timerId => window.clearTimeout(timerId));
      versionTypeTimers = [];
    };

    const clearStatusTypeTimers = () => {
      statusTypeTimers.forEach(timerId => window.clearTimeout(timerId));
      statusTypeTimers = [];
    };

    const typeWrite = (text, delayMs, writer) => {
      String(text || '').split('').forEach((char, index) => {
        const timerId = window.setTimeout(() => {
          writer(char);
        }, delayMs + (settings.typeSpeed * index));
        return timerId;
      });
    };

    const typeWriteVersion = (text, delayMs) => {
      String(text || '').split('').forEach((char, index) => {
        const timerId = window.setTimeout(() => {
          footerRight.textContent += char;
        }, delayMs + (settings.typeSpeed * index));
        versionTypeTimers.push(timerId);
      });
    };

    const typeWriteStatus = text => {
      if (!footerStatus) {
        return;
      }

      clearStatusTypeTimers();
      footerStatus.textContent = '';
      footerStatus.classList.toggle('is-visible', Boolean(text));

      String(text || '').split('').forEach((char, index) => {
        const timerId = window.setTimeout(() => {
          footerStatus.textContent += char;
        }, settings.typeSpeed * index);
        statusTypeTimers.push(timerId);
      });
    };

    const clearStatusText = () => {
      clearStatusTypeTimers();
      if (!footerStatus) {
        return;
      }

      footerStatus.textContent = '';
      footerStatus.classList.remove('is-visible');
    };

    const getSurfaceList = () => Array.from(surfaces.values());

    const getActiveSurface = () => (
      surfaces.get(activeSurfaceId)
      || getSurfaceList()[0]
      || null
    );

    const normalizeHeight = heightValue => {
      const normalizedValue = String(heightValue || '').trim();
      return normalizedValue || settings.defaultHeight;
    };

    const readSurfaceText = (value, fallback = '') => {
      if (value === undefined || value === null) {
        return fallback;
      }

      return String(value).trim();
    };

    const setPanelHeight = heightValue => {
      const normalizedHeight = normalizeHeight(heightValue);
      panel?.style.setProperty('--printify-footer-drawer-height', normalizedHeight);
      footer?.style.setProperty('--printify-footer-drawer-height', normalizedHeight);
    };

    const notifyActiveSurfaceVisibility = nextOpenState => {
      const activeSurface = getActiveSurface();
      if (!activeSurface?.onVisibilityChange) {
        return;
      }

      activeSurface.onVisibilityChange(nextOpenState);
    };

    const renderTabs = () => {
      const surfaceList = getSurfaceList();

      if (!tabs || !footerTabsRail) {
        return;
      }

      if (surfaceList.length <= 1) {
        footerTabsRail.hidden = true;
        tabs.innerHTML = '';
        return;
      }

      footerTabsRail.hidden = false;
      tabs.innerHTML = surfaceList.map(surface => `
        <button
          class="printify-footer-drawer__tab${surface.id === activeSurfaceId ? ' is-active' : ''}"
          type="button"
          data-role="tab"
          data-surface-id="${surface.id}"
        >${surface.tabLabel}</button>
      `).join('');

      tabs.querySelectorAll('[data-role="tab"]').forEach(button => {
        button.addEventListener('click', () => {
          api.activateSurface(button.getAttribute('data-surface-id'));
        });
      });
    };

    const syncSurfaceState = () => {
      const activeSurface = getActiveSurface();
      const surfaceList = getSurfaceList();

      surfaceHost.hidden = !activeSurface;
      body.classList.toggle('has-surface', Boolean(activeSurface));
      panel.classList.toggle('has-surface', Boolean(activeSurface));

      if (!activeSurface && surfaceList.length) {
        activeSurfaceId = surfaceList[0].id;
        return syncSurfaceState();
      }

      if (!activeSurface) {
        panel.classList.add('is-empty');
        body.classList.add('is-empty');
        eyebrow.textContent = '';
        title.textContent = '';
        title.hidden = true;
        eyebrow.hidden = true;
        setPanelHeight(settings.defaultHeight);
        renderTabs();
        return;
      }

      panel.classList.remove('is-empty');
      body.classList.remove('is-empty');
      eyebrow.textContent = activeSurface.eyebrow;
      eyebrow.hidden = !activeSurface.eyebrow;
      title.textContent = activeSurface.title;
      title.hidden = !String(activeSurface.title || '').trim();
      setPanelHeight(activeSurface.height);

      surfaceList.forEach(surface => {
        if (!surface.pane) {
          return;
        }

        const isActive = surface.id === activeSurfaceId;
        surface.pane.hidden = !isActive;
        surface.pane.classList.toggle('is-active', isActive);
      });

      renderTabs();

      if (isOpen) {
        typeWriteStatus(activeSurface.statusLabel || activeSurface.eyebrow || activeSurface.tabLabel || '');
      }
    };

    const setOpenState = nextOpenState => {
      if (isOpen === nextOpenState) {
        return;
      }

      isOpen = nextOpenState;
      scrim?.classList.toggle('is-open', nextOpenState);
      panel?.classList.toggle('is-open', nextOpenState);
      footer?.classList.toggle('is-open', nextOpenState);
      panel?.setAttribute('aria-hidden', nextOpenState ? 'false' : 'true');
      setClientOverlayActive(settings.layerName, nextOpenState);
      notifyActiveSurfaceVisibility(nextOpenState);

      if (nextOpenState) {
        const activeSurface = getActiveSurface();
        typeWriteStatus(activeSurface?.statusLabel || activeSurface?.eyebrow || activeSurface?.tabLabel || '');
      } else {
        clearStatusText();
      }
    };

    const setVersionText = (clientVersion, serverVersion) => {
      clearVersionTypeTimers();
      footerRight.textContent = '';

      const clientText = clientVersion ? `Client v${clientVersion}` : '';
      const serverText = serverVersion ? ` | Server v${serverVersion}` : '';

      typeWriteVersion(clientText, 0);

      if (serverText) {
        typeWriteVersion(serverText, settings.secondaryDelayMs);
      }
    };

    const FOOTER_INPUT_ICON_TOKENS = new Set(['up', 'down', 'left', 'right', 'a', 'b', 'start']);

    const setSequencePreview = tokens => {
      if (!footerLeft) return;

      const normalizedTokens = Array.isArray(tokens)
        ? tokens.map(token => String(token || '').trim().toLowerCase()).filter(Boolean)
        : [];

      footerLeft.innerHTML = normalizedTokens.map(token => {
        if (FOOTER_INPUT_ICON_TOKENS.has(token)) {
          return `
            <span class="printify-footer__input-icon printify-footer__input-icon--${token}" aria-hidden="true"></span>
          `;
        }

        return `
          <span class="printify-footer__input-badge">${token.toUpperCase()}</span>
        `;
      }).join('');
      footerLeft.classList.toggle('is-visible', normalizedTokens.length > 0);
    };

    const registerSurface = surfaceConfig => {
      // Surfaces are long-lived by default. Registering the same id again is
      // treated as an update so plugins can refresh metadata without remounting
      // or losing their existing DOM state.
      const surfaceId = String(surfaceConfig?.id || '').trim();

      if (!surfaceId) {
        throw new Error('Footer drawer surfaces need a stable id.');
      }

      const existingSurface = surfaces.get(surfaceId);
      const nextSurface = Object.assign({}, existingSurface || {}, {
        id: surfaceId,
        title: readSurfaceText(surfaceConfig?.title, existingSurface?.title || ''),
        eyebrow: readSurfaceText(surfaceConfig?.eyebrow, existingSurface?.eyebrow || ''),
        statusLabel: readSurfaceText(
          surfaceConfig?.statusLabel,
          existingSurface?.statusLabel || surfaceConfig?.eyebrow || surfaceConfig?.tabLabel || surfaceConfig?.title || ''
        ),
        tabLabel: readSurfaceText(surfaceConfig?.tabLabel, existingSurface?.tabLabel || surfaceConfig?.title || 'Surface') || 'Surface',
        height: normalizeHeight(surfaceConfig?.height),
        onVisibilityChange: typeof surfaceConfig?.onVisibilityChange === 'function'
          ? surfaceConfig.onVisibilityChange
          : existingSurface?.onVisibilityChange || null,
        content: surfaceConfig?.content || existingSurface?.content || null,
      });

      if (!existingSurface) {
        nextSurface.pane = document.createElement('section');
        nextSurface.pane.className = 'printify-footer-drawer__surface';
        nextSurface.pane.dataset.surfaceId = surfaceId;
        nextSurface.pane.hidden = true;
        surfaceHost.appendChild(nextSurface.pane);
      } else {
        nextSurface.pane = existingSurface.pane;
      }

      if (nextSurface.content instanceof HTMLElement && nextSurface.content.parentElement !== nextSurface.pane) {
        nextSurface.pane.innerHTML = '';
        nextSurface.pane.appendChild(nextSurface.content);
      }

      surfaces.set(surfaceId, nextSurface);

      if (!activeSurfaceId || activeSurfaceId === DEFAULT_SURFACE_ID) {
        activeSurfaceId = surfaceId;
      }

      syncSurfaceState();
      return nextSurface;
    };

    const unregisterSurface = surfaceId => {
      const normalizedSurfaceId = String(surfaceId || '').trim();
      const existingSurface = surfaces.get(normalizedSurfaceId);

      if (!existingSurface) {
        return;
      }

      if (normalizedSurfaceId === activeSurfaceId && isOpen) {
        existingSurface.onVisibilityChange?.(false);
      }

      existingSurface.pane?.remove();
      surfaces.delete(normalizedSurfaceId);

      if (activeSurfaceId === normalizedSurfaceId) {
        activeSurfaceId = getSurfaceList()[0]?.id || DEFAULT_SURFACE_ID;
      }

      syncSurfaceState();
    };

    footer.addEventListener('dblclick', event => {
      event.preventDefault();

      if (isOpen) {
        setOpenState(false);
        return;
      }

      if (!getSurfaceList().length) {
        setOpenState(true);
        return;
      }

      if (!surfaces.has(activeSurfaceId)) {
        activeSurfaceId = getSurfaceList()[0].id;
        syncSurfaceState();
      }

      setOpenState(true);
    });

    scrim?.addEventListener('click', () => {
      setOpenState(false);
    });

    close?.addEventListener('click', () => {
      setOpenState(false);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isOpen) {
        setOpenState(false);
        return;
      }

      if (event.key === 'Tab' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (isTypingContext(event.target)) {
          return;
        }

        event.preventDefault();

        if (isOpen) {
          setOpenState(false);
          return;
        }

        if (!getSurfaceList().length) {
          setOpenState(true);
          return;
        }

        if (!surfaces.has(activeSurfaceId)) {
          activeSurfaceId = getSurfaceList()[0].id;
          syncSurfaceState();
        }

        setOpenState(true);
      }
    });

    setPanelHeight(settings.defaultHeight);
    syncSurfaceState();

    const api = {
      open: () => setOpenState(true),
      close: () => setOpenState(false),
      isOpen: () => isOpen,
      setVersionText,
      setSequencePreview,
      registerSurface,
      unregisterSurface,
      activateSurface(surfaceId, options = {}) {
        const normalizedSurfaceId = String(surfaceId || '').trim();
        let shouldNotifyShownSurface = false;

        if (normalizedSurfaceId && surfaces.has(normalizedSurfaceId)) {
          if (isOpen && normalizedSurfaceId !== activeSurfaceId) {
            const previousSurface = getActiveSurface();
            previousSurface?.onVisibilityChange?.(false);
            shouldNotifyShownSurface = true;
          } else if (isOpen && normalizedSurfaceId === activeSurfaceId) {
            shouldNotifyShownSurface = true;
          }

          activeSurfaceId = normalizedSurfaceId;
          syncSurfaceState();
        }

        if (shouldNotifyShownSurface && isOpen) {
          getActiveSurface()?.onVisibilityChange?.(true);
        }

        if (options.open !== false) {
          setOpenState(true);
        }
      },
      getActiveSurfaceId: () => activeSurfaceId,
      hasSurface: surfaceId => surfaces.has(String(surfaceId || '').trim()),
      getSurfaceCount: () => surfaces.size,
    };

    root.__printifyFooterDrawerInstance = api;
    window.printifyFooterDrawer = api;

    return api;
  }

  window.createPrintifyFooterDrawer = createPrintifyFooterDrawer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createPrintifyFooterDrawer('#printifyFooterDrawer');
    });
  } else {
    createPrintifyFooterDrawer('#printifyFooterDrawer');
  }
}());
