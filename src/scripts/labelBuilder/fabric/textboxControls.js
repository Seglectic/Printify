// ╭────────────────────────────╮
// │  Textbox Fabric Controls   │
// │  Resizes text frames live  │
// │  without scaling glyphs.   │
// ╰────────────────────────────╯
import { normalizeTextFrameSize } from '../model/textFrame.mjs';

export const createTextboxFrameControls = ({ fabric, onFrameChange }) => {
  const resizeFrame = axes => (eventData, transform, x, y) => {
    const textbox = transform.target;
    const localPoint = fabric.controlsUtils.getLocalPoint(
      transform,
      transform.originX,
      transform.originY,
      x,
      y
    );
    const currentSize = normalizeTextFrameSize({
      width: textbox.frameWidth || textbox.width,
      height: textbox.frameHeight || textbox.height,
    });
    const horizontalFactor = transform.originX === 'center' ? 2 : 1;
    const verticalFactor = transform.originY === 'center' ? 2 : 1;
    const strokePadding = Number(textbox.strokeWidth || 0) / (textbox.strokeUniform ? textbox.scaleX : 1);

    if (eventData?.shiftKey && axes === 'both') {
      const sizeRatio = Math.max(
        Math.abs(localPoint.x) / Math.max(1, currentSize.width),
        Math.abs(localPoint.y) / Math.max(1, currentSize.height)
      );
      const nextFontSize = Math.max(8, Math.round((textbox.fontSize || 8) * Math.max(0.25, sizeRatio)));
      textbox.set({ fontSize: nextFontSize, autoFitText: false });
      textbox.maxAutoFitFontSize = nextFontSize;
    } else {
      const nextSize = normalizeTextFrameSize({
        width: axes === 'height'
          ? currentSize.width
          : (Math.abs((localPoint.x * horizontalFactor) / textbox.scaleX) - strokePadding),
        height: axes === 'width'
          ? currentSize.height
          : (Math.abs((localPoint.y * verticalFactor) / textbox.scaleY) - strokePadding),
      });
      textbox.set({
        frameWidth: nextSize.width,
        frameHeight: nextSize.height,
        width: nextSize.width,
        scaleX: 1,
        scaleY: 1,
      });
    }

    onFrameChange(textbox);
    return true;
  };

  const controls = fabric.controlsUtils.createTextboxDefaultControls();
  const anchored = handler => fabric.controlsUtils.wrapWithFireEvent(
    'resizing',
    fabric.controlsUtils.wrapWithFixedAnchor(handler)
  );
  const verticalResize = anchored(resizeFrame('height'));
  const cornerResize = anchored(resizeFrame('both'));

  controls.mt = new fabric.Control({
    x: 0,
    y: -0.5,
    actionHandler: verticalResize,
    actionName: 'resizing',
    cursorStyle: 'ns-resize',
  });
  controls.mb = new fabric.Control({
    x: 0,
    y: 0.5,
    actionHandler: verticalResize,
    actionName: 'resizing',
    cursorStyle: 'ns-resize',
  });
  ['tl', 'tr', 'br', 'bl'].forEach(controlName => {
    controls[controlName].actionHandler = cornerResize;
    controls[controlName].actionName = 'resizing';
  });

  return controls;
};
