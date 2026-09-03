// ╭────────────────────────────╮
// │  Tape Geometry             │
// │  Converts pointer travel   │
// │  and text width into tape  │
// │  dimensions.               │
// ╰────────────────────────────╯
export const getTapeLengthFromDrag = ({
  startLengthMm,
  deltaClientPx,
  viewportScale,
  density,
  minimumLengthMm = 8,
  resizeFromCenter = false,
}) => {
  const safeScale = Math.max(0.01, Number(viewportScale) || 1);
  const safeDensity = Math.max(0.01, Number(density) || 1);
  const anchorMultiplier = resizeFromCenter ? 2 : 1;
  const deltaMm = (((Number(deltaClientPx) || 0) * anchorMultiplier) / safeScale / safeDensity) * 25.4;

  return Math.max(minimumLengthMm, Math.round((Number(startLengthMm) || minimumLengthMm) + deltaMm));
};

export const getAutoGrowingTextFrameWidth = ({
  naturalTextWidth,
  padding = 0,
  minimumFrameWidth = 48,
}) => Math.max(
  48,
  Math.round(Number(minimumFrameWidth) || 0),
  Math.ceil((Number(naturalTextWidth) || 0) + ((Number(padding) || 0) * 2))
);
