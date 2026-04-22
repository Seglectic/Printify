// ╭──────────────────────────╮
// │  snapping.js             │
// │  Canvas-guide snapping   │
// │  primitives for moving   │
// │  and scaling objects     │
// ╰──────────────────────────╯
(function () {
  const namespace = window.PrintifyLabelBuilder = window.PrintifyLabelBuilder || {};

  namespace.register('snapping', ctx => {
    const { constants, state } = ctx;

    const clearSnapLocks = () => {
      state.snapLocks.vertical = null;
      state.snapLocks.horizontal = null;
    };

    const clearSnapOverlay = () => {
      if (!state.snapOverlayCanvas || !state.snapOverlayContext) {
        return;
      }

      state.snapOverlayContext.clearRect(0, 0, state.snapOverlayCanvas.width, state.snapOverlayCanvas.height);
    };

    const resetSnapGuides = () => {
      state.snapGuides.vertical = null;
      state.snapGuides.horizontal = null;
      clearSnapLocks();
      clearSnapOverlay();
      state.canvas?.requestRenderAll?.();
    };

    const renderSnapGuides = () => {
      ctx.syncSnapOverlayViewport();
      const { vertical, horizontal } = state.snapGuides;
      const overlayCanvas = state.snapOverlayCanvas;
      const overlayContext = state.snapOverlayContext;
      const themeColors = ctx.utils.getBuilderThemeColors();

      if (!overlayCanvas || !overlayContext) {
        return;
      }

      clearSnapOverlay();

      if (vertical === null && horizontal === null) {
        return;
      }

      overlayContext.save();
      const viewportScale = Math.max(0.2, Number(state.currentViewportScale) || 1);
      const outlineWidth = Math.max(1.25, Math.min(3, 1.6 / viewportScale));
      const innerWidth = Math.max(0.75, Math.min(1.5, 0.9 / viewportScale));
      const dashLength = Math.max(3, Math.min(6, 4 / viewportScale));
      const drawGuideLine = (fromX, fromY, toX, toY) => {
        overlayContext.beginPath();
        overlayContext.moveTo(fromX, fromY);
        overlayContext.lineTo(toX, toY);

        // A crisp dark outline keeps guides readable against the builder's
        // white label surface, then the themed stroke sits on top.
        overlayContext.strokeStyle = themeColors.guideOutline;
        overlayContext.lineWidth = outlineWidth;
        overlayContext.setLineDash([dashLength, dashLength]);
        overlayContext.stroke();

        overlayContext.beginPath();
        overlayContext.moveTo(fromX, fromY);
        overlayContext.lineTo(toX, toY);
        overlayContext.strokeStyle = themeColors.accent;
        overlayContext.lineWidth = innerWidth;
        overlayContext.setLineDash([dashLength, dashLength]);
        overlayContext.stroke();
      };

      const getRenderPosition = (position, maxPosition) => {
        const inset = constants.SNAP_GUIDE_INSET_PX;
        const safeMax = Math.max(1, maxPosition);
        const edgePosition = Math.max(inset, safeMax - inset);

        if (position <= 0) return inset;
        if (position >= safeMax) return edgePosition;
        return position;
      };

      if (vertical !== null) {
        const verticalPosition = getRenderPosition(vertical, overlayCanvas.width);
        drawGuideLine(verticalPosition, 0, verticalPosition, overlayCanvas.height);
      }

      if (horizontal !== null && horizontal > 0 && horizontal < overlayCanvas.height) {
        const horizontalPosition = getRenderPosition(horizontal, overlayCanvas.height);
        drawGuideLine(0, horizontalPosition, overlayCanvas.width, horizontalPosition);
      }

      overlayContext.restore();
    };

    const getRenderedObjectMetrics = object => {
      const centerPoint = object.getCenterPoint();
      const boundingRect = object.getBoundingRect();
      const renderedWidth = Math.max(
        1,
        Number.isFinite(boundingRect?.width)
          ? boundingRect.width
          : (Number.isFinite(object.getScaledWidth?.())
            ? object.getScaledWidth()
            : ((object.width || 1) * (object.scaleX || 1)))
      );
      const renderedHeight = Math.max(
        1,
        Number.isFinite(boundingRect?.height)
          ? boundingRect.height
          : (Number.isFinite(object.getScaledHeight?.())
            ? object.getScaledHeight()
            : ((object.height || 1) * (object.scaleY || 1)))
      );

      return {
        centerX: centerPoint.x,
        centerY: centerPoint.y,
        renderedWidth,
        renderedHeight,
      };
    };

    const getGuideCandidates = object => {
      const builderCanvas = ctx.ensureCanvas();
      const canvasWidth = builderCanvas.getWidth();
      const canvasHeight = builderCanvas.getHeight();
      const {
        centerX,
        centerY,
        renderedWidth,
        renderedHeight,
      } = getRenderedObjectMetrics(object);

      const buildAxisCandidates = (guides, points) => guides.flatMap(guide => points.map(point => ({
        key: `${guide.key}:${point.key}`,
        position: guide.position,
        point: point.value,
      })));

      const verticalGuides = [
        { key: 'left-guide', position: 0 },
        { key: 'center-guide', position: canvasWidth / 2 },
        { key: 'right-guide', position: canvasWidth },
      ];
      const verticalPoints = [
        { key: 'left-edge', value: centerX - (renderedWidth / 2) },
        { key: 'center-point', value: centerX },
        { key: 'right-edge', value: centerX + (renderedWidth / 2) },
      ];
      const horizontalGuides = [
        { key: 'top-guide', position: 0 },
        { key: 'middle-guide', position: canvasHeight / 2 },
        { key: 'bottom-guide', position: canvasHeight },
      ];
      const horizontalPoints = [
        { key: 'top-edge', value: centerY - (renderedHeight / 2) },
        { key: 'middle-point', value: centerY },
        { key: 'bottom-edge', value: centerY + (renderedHeight / 2) },
      ];

      return {
        verticalCandidates: buildAxisCandidates(verticalGuides, verticalPoints),
        horizontalCandidates: buildAxisCandidates(horizontalGuides, horizontalPoints),
      };
    };

    const getNearestGuide = (candidates, threshold) => {
      let nearestGuide = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      candidates.forEach(candidate => {
        const distance = Math.abs(candidate.position - candidate.point);
        if (distance <= threshold && distance < nearestDistance) {
          nearestGuide = candidate;
          nearestDistance = distance;
        }
      });

      return nearestGuide;
    };

    const previewCanvasGuides = object => {
      if (!object || object instanceof window.fabric.ActiveSelection) {
        resetSnapGuides();
        return;
      }

      const guideThreshold = constants.SNAP_THRESHOLD_PX;
      const {
        verticalCandidates,
        horizontalCandidates,
      } = getGuideCandidates(object);

      const nearestVerticalGuide = getNearestGuide(verticalCandidates, guideThreshold);
      const nearestHorizontalGuide = getNearestGuide(horizontalCandidates, guideThreshold);

      state.snapGuides.vertical = nearestVerticalGuide ? nearestVerticalGuide.position : null;
      state.snapGuides.horizontal = nearestHorizontalGuide ? nearestHorizontalGuide.position : null;
    };

    const applyCanvasGuideSnap = object => {
      if (!object || object instanceof window.fabric.ActiveSelection) {
        resetSnapGuides();
        return;
      }

      // V1 only snaps against canvas guides. Keeping this separate makes it
      // much easier to add object-to-object snapping later without disturbing
      // the rest of the builder runtime.
      const guideThreshold = constants.SNAP_THRESHOLD_PX;
      const releaseThreshold = constants.SNAP_RELEASE_DISTANCE_PX;

      const {
        verticalCandidates,
        horizontalCandidates,
      } = getGuideCandidates(object);

      let nextLeft = object.left || 0;
      let nextTop = object.top || 0;
      let nextVerticalGuide = null;
      let nextHorizontalGuide = null;
      let skipVerticalSnap = false;
      let skipHorizontalSnap = false;
      let didOverrideLeft = false;
      let didOverrideTop = false;

      const activeVerticalLock = state.snapLocks.vertical;
      if (activeVerticalLock) {
        const lockedCandidate = verticalCandidates.find(candidate => candidate.key === activeVerticalLock.candidateKey);
        const guideDistance = lockedCandidate
          ? Math.abs(activeVerticalLock.guide - lockedCandidate.point)
          : Number.POSITIVE_INFINITY;
        if (guideDistance <= releaseThreshold && lockedCandidate) {
          nextLeft += activeVerticalLock.guide - lockedCandidate.point;
          nextVerticalGuide = activeVerticalLock.guide;
          didOverrideLeft = true;
        } else {
          state.snapLocks.vertical = null;
          skipVerticalSnap = true;
        }
      }

      const activeHorizontalLock = state.snapLocks.horizontal;
      if (activeHorizontalLock) {
        const lockedCandidate = horizontalCandidates.find(candidate => candidate.key === activeHorizontalLock.candidateKey);
        const guideDistance = lockedCandidate
          ? Math.abs(activeHorizontalLock.guide - lockedCandidate.point)
          : Number.POSITIVE_INFINITY;
        if (guideDistance <= releaseThreshold && lockedCandidate) {
          nextTop += activeHorizontalLock.guide - lockedCandidate.point;
          nextHorizontalGuide = activeHorizontalLock.guide;
          didOverrideTop = true;
        } else {
          state.snapLocks.horizontal = null;
          skipHorizontalSnap = true;
        }
      }

      if (nextVerticalGuide === null && !skipVerticalSnap) {
        const nearestVerticalGuide = getNearestGuide(verticalCandidates, guideThreshold);
        if (nearestVerticalGuide) {
          nextLeft += nearestVerticalGuide.position - nearestVerticalGuide.point;
          nextVerticalGuide = nearestVerticalGuide.position;
          didOverrideLeft = true;
          state.snapLocks.vertical = {
            guide: nearestVerticalGuide.position,
            candidateKey: nearestVerticalGuide.key,
          };
        }
      }

      if (nextHorizontalGuide === null && !skipHorizontalSnap) {
        const nearestHorizontalGuide = getNearestGuide(horizontalCandidates, guideThreshold);
        if (nearestHorizontalGuide) {
          nextTop += nearestHorizontalGuide.position - nearestHorizontalGuide.point;
          nextHorizontalGuide = nearestHorizontalGuide.position;
          didOverrideTop = true;
          state.snapLocks.horizontal = {
            guide: nearestHorizontalGuide.position,
            candidateKey: nearestHorizontalGuide.key,
          };
        }
      }

      if (nextVerticalGuide === null) {
        state.snapLocks.vertical = null;
      }

      if (nextHorizontalGuide === null) {
        state.snapLocks.horizontal = null;
      }

      if (didOverrideLeft || didOverrideTop) {
        object.set({
          ...(didOverrideLeft ? { left: nextLeft } : {}),
          ...(didOverrideTop ? { top: nextTop } : {}),
        });
        object.setCoords();
      }

      state.snapGuides.vertical = nextVerticalGuide;
      state.snapGuides.horizontal = nextHorizontalGuide;
    };

    const bindSnappingEvents = () => {
      const builderCanvas = ctx.ensureCanvas();

      // Guide drawing is rendered on Fabric's top context so it never pollutes
      // exported images or template thumbnails. The overlay lives outside
      // Fabric's own transform layer so guide cleanup never stomps handles.
      builderCanvas.on('object:moving', event => {
        applyCanvasGuideSnap(event.target);
      });
      builderCanvas.on('object:scaling', event => {
        clearSnapLocks();
        previewCanvasGuides(event.target);
      });
      builderCanvas.on('object:rotating', () => {
        resetSnapGuides();
      });
      builderCanvas.on('object:modified', () => {
        resetSnapGuides();
      });
      builderCanvas.on('before:selection:cleared', () => {
        resetSnapGuides();
      });
      builderCanvas.on('selection:cleared', () => {
        resetSnapGuides();
      });
      builderCanvas.on('mouse:out', () => {
        resetSnapGuides();
      });
      builderCanvas.on('mouse:up', () => {
        resetSnapGuides();
      });
      builderCanvas.on('after:render', () => {
        renderSnapGuides();
      });
    };

    return {
      bindSnappingEvents,
      resetSnapGuides,
    };
  });
}());
