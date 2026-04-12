(function () {
  const activeLayers = new Set();

  const applyOverlayState = () => {
    if (!document.body) {
      return;
    }

    document.body.classList.toggle('printify-client-overlay-open', activeLayers.size > 0);
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
