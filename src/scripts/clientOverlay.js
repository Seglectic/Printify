(function () {
  const activeLayers = new Set();
  const BLUR_EXCLUDED_LAYERS = new Set([
    'footer-drawer',
  ]);

  const applyOverlayState = () => {
    if (!document.body) {
      return;
    }

    const hasBlurEligibleLayer = Array.from(activeLayers)
      .some(layerName => !BLUR_EXCLUDED_LAYERS.has(layerName));

    document.body.classList.toggle('printify-client-overlay-open', hasBlurEligibleLayer);
  };

  window.printifyClientOverlay = {
    setActive(layerName, isActive) {
      const normalizedLayerName = String(layerName || '').trim();

      if (!normalizedLayerName) {
        return;
      }

      if (isActive) {
        activeLayers.add(normalizedLayerName);
      } else {
        activeLayers.delete(normalizedLayerName);
      }

      applyOverlayState();
    },
    isActive(layerName) {
      return activeLayers.has(String(layerName || '').trim());
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyOverlayState, { once: true });
  } else {
    applyOverlayState();
  }
}());
