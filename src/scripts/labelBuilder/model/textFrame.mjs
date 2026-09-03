// ╭────────────────────────────╮
// │  Text Frame Model          │
// │  Normalizes editable text  │
// │  geometry and alignment.   │
// ╰────────────────────────────╯
export const MIN_TEXT_FRAME_WIDTH = 56;
export const MIN_TEXT_FRAME_HEIGHT = 32;

export const normalizeVerticalAlign = value => (
  ['top', 'middle', 'bottom'].includes(value) ? value : 'middle'
);

export const normalizeTextFrameSize = ({ width, height } = {}) => ({
  width: Math.max(MIN_TEXT_FRAME_WIDTH, Math.round(Number(width) || MIN_TEXT_FRAME_WIDTH)),
  height: Math.max(MIN_TEXT_FRAME_HEIGHT, Math.round(Number(height) || MIN_TEXT_FRAME_HEIGHT)),
});

export const getVerticalTextOffset = ({
  alignment,
  contentHeight,
  frameHeight,
} = {}) => {
  const availableSpace = Math.max(0, (Number(frameHeight) || 0) - (Number(contentHeight) || 0));

  if (normalizeVerticalAlign(alignment) === 'bottom') return availableSpace;
  if (normalizeVerticalAlign(alignment) === 'middle') return availableSpace / 2;
  return 0;
};

export const isTextFrameOverflowing = ({
  contentHeight,
  frameHeight,
  padding = 0,
} = {}) => (
  (Number(contentHeight) || 0) > Math.max(0, (Number(frameHeight) || 0) - ((Number(padding) || 0) * 2))
);
