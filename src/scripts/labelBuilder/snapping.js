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

    const resetSnapGuides = () => {
      state.snapGuides.vertical = null;
      state.snapGuides.horizontal = null;
    };

    const renderSnapGuides = () => {
      const builderCanvas = ctx.ensureCanvas();
      const { vertical, horizontal } = state.snapGuides;
      const topContext = builderCanvas.contextTop;

      if (!topContext || (!vertical && !horizontal)) {
        return;
      }

      topContext.save();
      topContext.strokeStyle = constants.SNAP_GUIDE_COLOR;
      topContext.lineWidth = 1;
      topContext.setLineDash([5, 5]);

      if (vertical !== null) {
        topContext.beginPath();
        topContext.moveTo(vertical, 0);
        topContext.lineTo(vertical, builderCanvas.getHeight());
        topContext.stroke();
      }

      if (horizontal !== null) {
        topContext.beginPath();
        topContext.moveTo(0, horizontal);
        topContext.lineTo(builderCanvas.getWidth(), horizontal);
        topContext.stroke();
      }

      topContext.restore();
    };

    const applyCanvasGuideSnap = object => {
      if (!object || object instanceof window.fabric.ActiveSelection) {
        resetSnapGuides();
        return;
      }

      // V1 only snaps against canvas guides. Keeping this separate makes it
      // much easier to add object-to-object snapping later without disturbing
      // the rest of the builder runtime.
      const builderCanvas = ctx.ensureCanvas();
      const bounds = object.getBoundingRect();
      const canvasWidth = builderCanvas.getWidth();
      const canvasHeight = builderCanvas.getHeight();
      const guideThreshold = constants.SNAP_THRESHOLD_PX;

      const verticalCandidates = [
        { position: 0, point: bounds.left },
        { position: canvasWidth / 2, point: bounds.left + (bounds.width / 2) },
        { position: canvasWidth, point: bounds.left + bounds.width },
      ];
      const horizontalCandidates = [
        { position: 0, point: bounds.top },
        { position: canvasHeight / 2, point: bounds.top + (bounds.height / 2) },
        { position: canvasHeight, point: bounds.top + bounds.height },
      ];

      let nextLeft = object.left || 0;
      let nextTop = object.top || 0;
      let nextVerticalGuide = null;
      let nextHorizontalGuide = null;

      verticalCandidates.forEach(candidate => {
        const distance = Math.abs(candidate.position - candidate.point);
        if (distance <= guideThreshold && (nextVerticalGuide === null || distance < Math.abs(nextVerticalGuide - candidate.point))) {
          nextLeft += candidate.position - candidate.point;
          nextVerticalGuide = candidate.position;
        }
      });

      horizontalCandidates.forEach(candidate => {
        const distance = Math.abs(candidate.position - candidate.point);
        if (distance <= guideThreshold && (nextHorizontalGuide === null || distance < Math.abs(nextHorizontalGuide - candidate.point))) {
          nextTop += candidate.position - candidate.point;
          nextHorizontalGuide = candidate.position;
        }
      });

      object.set({
        left: Math.round(nextLeft),
        top: Math.round(nextTop),
      });
      object.setCoords();
      state.snapGuides.vertical = nextVerticalGuide;
      state.snapGuides.horizontal = nextHorizontalGuide;
    };

    const bindSnappingEvents = () => {
      const builderCanvas = ctx.ensureCanvas();

      // Guide drawing is rendered on Fabric's top context so it never pollutes
      // exported images or template thumbnails.
      builderCanvas.on('object:moving', event => {
        applyCanvasGuideSnap(event.target);
      });
      builderCanvas.on('object:scaling', event => {
        applyCanvasGuideSnap(event.target);
      });
      builderCanvas.on('object:modified', () => {
        resetSnapGuides();
      });
      builderCanvas.on('selection:cleared', () => {
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
