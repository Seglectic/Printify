(function () {
  // ╭────────────────────────────╮
  // │  Shared touch affordances  │
  // ╰────────────────────────────╯
  // Phones have no right-click and no hover, so a few desktop-only gestures need
  // a touch equivalent. Register them through `window.printifyTouch` rather than
  // sprinkling one-off pointer listeners around, the same way hidden key
  // sequences go through `window.printifyInput`.
  //
  // - `isCoarsePointer()`: true when the primary pointer is a finger
  // - `onLongPress(element, handler)`: press-and-hold as a right-click stand-in
  //
  // A `printify-coarse-pointer` class is mirrored onto <body> so stylesheets can
  // adapt copy and hit targets without duplicating the media query everywhere.
  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE_PX = 10;
  const COARSE_POINTER_CLASS = 'printify-coarse-pointer';

  const coarsePointerQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)')
    : null;

  const isCoarsePointer = () => Boolean(coarsePointerQuery?.matches);

  const syncCoarsePointerClass = () => {
    document.body?.classList.toggle(COARSE_POINTER_CLASS, isCoarsePointer());
  };

  // Older WebKit only exposes the deprecated addListener form.
  if (coarsePointerQuery) {
    if (typeof coarsePointerQuery.addEventListener === 'function') {
      coarsePointerQuery.addEventListener('change', syncCoarsePointerClass);
    } else if (typeof coarsePointerQuery.addListener === 'function') {
      coarsePointerQuery.addListener(syncCoarsePointerClass);
    }
  }

  const onLongPress = (element, handler, options) => {
    if (!element || typeof handler !== 'function') {
      return { destroy() {} };
    }

    const holdMs = Number.isFinite(options?.holdMs) ? options.holdMs : LONG_PRESS_MS;
    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let didFire = false;

    const clearPressTimer = () => {
      if (pressTimer === null) return;
      window.clearTimeout(pressTimer);
      pressTimer = null;
    };

    const handlePointerDown = event => {
      // Mouse users already have a real context menu; leave them alone so the
      // existing contextmenu handlers stay the single desktop path.
      if (event.pointerType === 'mouse') return;

      didFire = false;
      startX = event.clientX;
      startY = event.clientY;

      clearPressTimer();
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        didFire = true;
        handler(event);
      }, holdMs);
    };

    // A drag is a scroll, not a long press.
    const handlePointerMove = event => {
      if (pressTimer === null) return;

      if (Math.abs(event.clientX - startX) > MOVE_TOLERANCE_PX
        || Math.abs(event.clientY - startY) > MOVE_TOLERANCE_PX) {
        clearPressTimer();
      }
    };

    const handlePointerUp = () => {
      clearPressTimer();
    };

    // Swallow the click that follows a completed hold, so the element's normal
    // tap action does not also run on top of the menu we just opened.
    const handleClick = event => {
      if (!didFire) return;
      didFire = false;
      event.preventDefault();
      event.stopPropagation();
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointercancel', handlePointerUp);
    element.addEventListener('pointerleave', handlePointerUp);
    element.addEventListener('click', handleClick, true);

    return {
      destroy() {
        clearPressTimer();
        element.removeEventListener('pointerdown', handlePointerDown);
        element.removeEventListener('pointermove', handlePointerMove);
        element.removeEventListener('pointerup', handlePointerUp);
        element.removeEventListener('pointercancel', handlePointerUp);
        element.removeEventListener('pointerleave', handlePointerUp);
        element.removeEventListener('click', handleClick, true);
      },
    };
  };

  window.printifyTouch = window.printifyTouch || {
    isCoarsePointer,
    onLongPress,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncCoarsePointerClass);
  } else {
    syncCoarsePointerClass();
  }
}());
