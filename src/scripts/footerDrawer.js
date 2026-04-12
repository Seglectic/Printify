(function () {
  const setClientOverlayActive = (layerName, isActive) => {
    window.printifyClientOverlay?.setActive?.(layerName, isActive);
  };

  const buildFooterDrawerMarkup = () => `
    <div class="printify-footer-drawer__scrim" data-role="scrim"></div>
    <aside class="printify-footer-drawer__panel" data-role="panel" aria-hidden="true">
      <div class="printify-footer-drawer__header">
        <p class="printify-footer-drawer__eyebrow">Footer Panel</p>
        <button class="printify-footer-drawer__close" type="button" data-role="close">Close</button>
      </div>
      <div class="printify-footer-drawer__body">
        <h2 class="printify-footer-drawer__title">Footer drawer standby</h2>
        <p class="printify-footer-drawer__copy">Reserved for future projects.</p>
      </div>
    </aside>
  `;

  function createPrintifyFooterDrawer(rootSelector, options) {
    const settings = Object.assign({
      footerSelector: '#footer',
      layerName: 'footer-drawer',
      typeSpeed: 40,
      secondaryDelayMs: 1200,
    }, options || {});

    const root = document.querySelector(rootSelector);
    const footer = document.querySelector(settings.footerSelector);

    if (!root || !footer) return null;
    if (root.__printifyFooterDrawerInstance) return root.__printifyFooterDrawerInstance;
    if (!root.innerHTML.trim()) root.innerHTML = buildFooterDrawerMarkup();

    const scrim = root.querySelector('[data-role="scrim"]');
    const panel = root.querySelector('[data-role="panel"]');
    const close = root.querySelector('[data-role="close"]');
    footer.innerHTML = `
      <div class="printify-footer__left" data-role="left" aria-hidden="true"></div>
      <div class="printify-footer__right" data-role="right"></div>
    `;
    const footerLeft = footer.querySelector('[data-role="left"]');
    const footerRight = footer.querySelector('[data-role="right"]');
    let isOpen = false;
    let typeTimers = [];

    const clearTypeTimers = () => {
      typeTimers.forEach(timerId => window.clearTimeout(timerId));
      typeTimers = [];
    };

    const typeWrite = (text, delayMs) => {
      String(text || '').split('').forEach((char, index) => {
        const timerId = window.setTimeout(() => {
          footerRight.textContent += char;
        }, delayMs + (settings.typeSpeed * index));
        typeTimers.push(timerId);
      });
    };

    const setOpenState = nextOpenState => {
      isOpen = nextOpenState;
      scrim?.classList.toggle('is-open', nextOpenState);
      panel?.classList.toggle('is-open', nextOpenState);
      panel?.setAttribute('aria-hidden', nextOpenState ? 'false' : 'true');
      setClientOverlayActive(settings.layerName, nextOpenState);
    };

    const setVersionText = (clientVersion, serverVersion) => {
      clearTypeTimers();
      footerRight.textContent = '';

      const clientText = clientVersion ? `Client v${clientVersion}` : '';
      const serverText = serverVersion ? ` | Server v${serverVersion}` : '';

      typeWrite(clientText, 0);

      if (serverText) {
        typeWrite(serverText, settings.secondaryDelayMs);
      }
    };

    const setSequencePreview = tokens => {
      if (!footerLeft) return;

      const normalizedTokens = Array.isArray(tokens)
        ? tokens.map(token => String(token || '').trim().toLowerCase()).filter(Boolean)
        : [];

      footerLeft.innerHTML = normalizedTokens.map(token => `
        <span class="printify-footer__input-icon printify-footer__input-icon--${token}" aria-hidden="true"></span>
      `).join('');
      footerLeft.classList.toggle('is-visible', normalizedTokens.length > 0);
    };

    footer.addEventListener('dblclick', event => {
      event.preventDefault();
      setOpenState(!isOpen);
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
      }
    });

    const api = {
      open: () => setOpenState(true),
      close: () => setOpenState(false),
      setVersionText,
      setSequencePreview,
      isOpen: () => isOpen,
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
