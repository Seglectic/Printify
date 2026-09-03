// ╭────────────────────────────╮
// │  Tape Resize Handle        │
// │  Maps the label's cut edge │
// │  to manual tape length.    │
// ╰────────────────────────────╯
import {
  getAutoGrowingTextFrameWidth,
  getTapeLengthFromDrag,
} from './model/tapeGeometry.mjs';

export default function createTapeResize(ctx) {
  const { constants, refs, state } = ctx;

  const syncTapeResizeHandle = printer => {
    if (!refs.tapeResizeHandle) return;

    const isTape = ctx.isTapePrinter(printer);
    refs.tapeResizeHandle.hidden = !isTape;
    ctx.ensureCanvas().wrapperEl?.classList.toggle('has-tape-resize', isTape);
    if (!isTape) return;

    const canvasContainer = ctx.ensureCanvas().wrapperEl;
    if (canvasContainer && refs.tapeResizeHandle.parentElement !== canvasContainer) {
      canvasContainer.appendChild(refs.tapeResizeHandle);
    }

    const lengthMm = ctx.utils.normalizeTapeLengthMm(state.currentTapeLengthMm);
    refs.tapeResizeHandle.setAttribute('aria-valuenow', String(lengthMm));
    refs.tapeResizeHandle.setAttribute('aria-valuetext', `${lengthMm} millimeters`);
    const valueLabel = refs.tapeResizeHandle.querySelector('.printify-builder__tape-resize-value');
    if (valueLabel) valueLabel.textContent = `${lengthMm} mm`;
  };

  const applyManualLength = lengthMm => {
    if (!ctx.isTapePrinter(state.currentPrinter)) return;

    state.tapeMinimumLengthMm = ctx.utils.normalizeTapeLengthMm(lengthMm);
    state.currentTapeLengthMm = state.tapeAutoLengthEnabled
      ? Math.max(state.tapeMinimumLengthMm, ctx.getRequiredTapeLengthMm(state.currentPrinter))
      : state.tapeMinimumLengthMm;
    if (refs.tapeLengthInput) refs.tapeLengthInput.value = String(state.currentTapeLengthMm);
    syncTapeResizeHandle(state.currentPrinter);
    void ctx.applyTapeCanvasSize(state.currentPrinter, { persistPreference: false });
  };

  const finishResize = event => {
    const drag = state.tapeResizeDrag;
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;

    state.tapeResizeDrag = null;
    refs.tapeResizeHandle?.classList.remove('is-dragging');
    if (refs.tapeResizeHandle?.hasPointerCapture?.(drag.pointerId)) {
      refs.tapeResizeHandle.releasePointerCapture(drag.pointerId);
    }
    void ctx.recordHistoryCheckpoint();
  };

  const bindTapeResizeEvents = () => {
    const handle = refs.tapeResizeHandle;
    if (!handle) return;

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !ctx.isTapePrinter(state.currentPrinter)) return;

      event.preventDefault();
      state.tapeResizeDrag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startLengthMm: ctx.utils.normalizeTapeLengthMm(state.currentTapeLengthMm),
        viewportScale: state.currentViewportScale,
      };
      handle.setPointerCapture?.(event.pointerId);
      handle.classList.add('is-dragging');
    });

    handle.addEventListener('pointermove', event => {
      const drag = state.tapeResizeDrag;
      if (!drag || event.pointerId !== drag.pointerId) return;

      event.preventDefault();
      applyManualLength(getTapeLengthFromDrag({
        startLengthMm: drag.startLengthMm,
        deltaClientPx: event.clientX - drag.startClientX,
        viewportScale: drag.viewportScale,
        density: state.currentPrinter?.density,
        minimumLengthMm: constants.MIN_TAPE_LENGTH_MM,
        resizeFromCenter: true,
      }));
    });

    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !ctx.isTapePrinter(state.currentPrinter)) return;

      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const step = event.shiftKey ? 5 : 1;
      applyManualLength(state.tapeMinimumLengthMm + (direction * step));
      void ctx.recordHistoryCheckpoint();
    });
  };

  return {
    bindTapeResizeEvents,
    getAutoGrowingTextFrameWidth,
    syncTapeResizeHandle,
  };
}
