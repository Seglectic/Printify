// ╭──────────────────────────────────────────────╮
// │  lib/plugins/xometry-packing-slip            │
// │  Detects Xometry packing slips, offers to    │
// │  prune zero-quantity detail pages, and folds │
// │  a spilled "Verified by" page back onto the  │
// │  previous sheet                              │
// ╰──────────────────────────────────────────────╯
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const pdfjs = require('pdfjs-dist/legacy/build/pdf');

const PLUGIN_ID = 'xometry-packing-slip';
const DEFAULT_CONFIG = {
  enabled: false,
  printerIds: [],
};
const CONFIG_HELP_COMMENT = 'Prompts to prune zero-quantity Xometry packing-slip pages and folds spilled sign-off lines back onto one page.';
const FOOTER_MASK_HEIGHT = 22;
const FOOTER_MASK_VERTICAL_INSET = 4;
const FOOTER_MASK_WIDTH = 108;
const FOOTER_MASK_RIGHT_INSET = 10;

// Xometry's WeasyPrint slips start the cover ~1.6" down the page, so the
// trailing "Verified by / Order" lines often spill onto a sheet of their own.
// Geometry comes from text positions, so the allowances below cover the
// non-text marks (logo, table borders) that text extraction can't see.
const FOOTER_BAND_HEIGHT = 36;
const MIN_TOP_MARGIN = 36;
const COVER_LOGO_ALLOWANCE = 30;
const BODY_TOP_ALLOWANCE = 8;
const TABLE_BORDER_ALLOWANCE = 8;
const OVERFLOW_STRIP_PADDING = 4;
const OVERFLOW_GAP = 10;
const OVERFLOW_PAGE_PATTERN = /^verified by[\s_]*order:\s*[a-z0-9-]+$/i;

const normalizeText = value => String(value || '')
  .replace(/\s+/g, ' ')
  .trim();

const normalizePrinterIds = value => Array.isArray(value)
  ? value.map(printerId => String(printerId || '').trim()).filter(Boolean)
  : [];

const buildRewrittenPdfPath = (sourceFilePath, suffix) => path.join(
  path.dirname(sourceFilePath),
  `${Date.now()}-${path.parse(sourceFilePath).name}-xometry-${suffix}.pdf`
);

const maskPrunedPageFooter = page => {
  const { width } = page.getSize();

  // Xometry adds a bottom-right "Page X of X" footer that exposes removed sheets.
  page.drawRectangle({
    x: Math.max(0, width - FOOTER_MASK_WIDTH - FOOTER_MASK_RIGHT_INSET),
    y: 0,
    width: FOOTER_MASK_WIDTH + FOOTER_MASK_RIGHT_INSET,
    height: FOOTER_MASK_HEIGHT + FOOTER_MASK_VERTICAL_INSET,
    color: rgb(1, 1, 1),
    borderWidth: 0,
    opacity: 1,
  });
};

// Summarizes one page as text plus the vertical extent of its body and footer,
// all in PDF user-space (origin bottom-left).
const measurePage = (page, textContent) => {
  const [viewLeft, viewBottom, width, height] = page.view;
  const bodyItems = [];
  let footerTop = 0;

  textContent.items.forEach(item => {
    if (!normalizeText(item.str)) {
      return;
    }

    const baseline = item.transform[5];
    const fontSize = Math.abs(item.transform[3]) || item.height || 0;
    const top = baseline + fontSize;

    if (top <= FOOTER_BAND_HEIGHT) {
      footerTop = Math.max(footerTop, top);
      return;
    }

    bodyItems.push({ str: item.str, top, bottom: baseline - fontSize * 0.3 });
  });

  return {
    text: normalizeText(textContent.items.map(item => item.str).join(' ')),
    bodyText: normalizeText(bodyItems.map(item => item.str).join(' ')),
    isPlainView: viewLeft === 0 && viewBottom === 0,
    width,
    height,
    footerTop: footerTop || FOOTER_BAND_HEIGHT,
    contentTop: bodyItems.length ? Math.max(...bodyItems.map(item => item.top)) : null,
    contentBottom: bodyItems.length ? Math.min(...bodyItems.map(item => item.bottom)) : null,
  };
};

const extractPages = async filePath => {
  const sourceBytes = new Uint8Array(await fs.promises.readFile(filePath));
  const loadingTask = pdfjs.getDocument({
    data: sourceBytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    verbosity: 0,
  });
  const pdfDocument = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pages.push(measurePage(page, textContent));
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
};

const parseCarrier = coverPageText => {
  const match = String(coverPageText || '').match(/\bcarrier:\s*(fedex|ups)\b/i);
  if (!match) {
    return null;
  }

  return match[1].toLowerCase() === 'fedex' ? 'FedEx' : 'UPS';
};

const parseOrderId = coverPageText => {
  const match = String(coverPageText || '').match(/\border id\s+([a-z0-9-]+)/i);
  return match ? match[1] : null;
};

const parsePartPageQuantity = pageText => {
  const match = String(pageText || '').match(/\bquantity\s+(\d+)\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
};

// Plans folding the last kept page into the one before it, when the last page
// holds only the "Verified by / Order" lines and the host page has enough
// empty top margin to slide up and make room. Returns null rather than risk
// clipping anything.
const planOverflowMerge = (pages, keepPageIndexes) => {
  if (keepPageIndexes.length < 2) {
    return null;
  }

  const overflowIndex = keepPageIndexes[keepPageIndexes.length - 1];
  const hostIndex = keepPageIndexes[keepPageIndexes.length - 2];
  const overflowPage = pages[overflowIndex];
  const hostPage = pages[hostIndex];

  if (
    !overflowPage?.contentTop
    || !hostPage?.contentTop
    || !overflowPage.isPlainView
    || !hostPage.isPlainView
    || overflowPage.width !== hostPage.width
    || overflowPage.height !== hostPage.height
    || !OVERFLOW_PAGE_PATTERN.test(overflowPage.bodyText)
  ) {
    return null;
  }

  const strip = {
    top: overflowPage.contentTop + OVERFLOW_STRIP_PADDING,
    bottom: overflowPage.contentBottom - OVERFLOW_STRIP_PADDING,
  };
  const stripHeight = strip.top - strip.bottom;
  const footerTop = Math.max(hostPage.footerTop, overflowPage.footerTop);
  const hostBottom = hostPage.contentBottom - TABLE_BORDER_ALLOWANCE;
  const hostTop = hostPage.contentTop + (hostIndex === 0 ? COVER_LOGO_ALLOWANCE : BODY_TOP_ALLOWANCE);
  const stripY = footerTop + OVERFLOW_GAP;
  const lift = Math.max(0, stripY + stripHeight + OVERFLOW_GAP - hostBottom);

  if (hostTop + lift > hostPage.height - MIN_TOP_MARGIN) {
    return null;
  }

  return {
    hostIndex,
    overflowIndex,
    lift,
    footerTop,
    strip,
    stripY,
  };
};

const analyzePackingSlip = pages => {
  const pageTexts = (Array.isArray(pages) ? pages : []).map(page => page.text);
  const normalizedPageTexts = pageTexts;
  const coverPageText = normalizeText(normalizedPageTexts[0] || '').toLowerCase();
  const allText = normalizeText(normalizedPageTexts.join(' ')).toLowerCase();

  if (!coverPageText.includes('packing slip') || !allText.includes('xometry')) {
    return null;
  }

  const wastePageIndexes = normalizedPageTexts.reduce((indexes, pageText, pageIndex) => {
    if (pageIndex === 0) {
      return indexes;
    }

    const normalizedPageText = String(pageText || '').toLowerCase();
    const isPartPage = normalizedPageText.includes('ordered part') && normalizedPageText.includes('quantity');
    const quantity = parsePartPageQuantity(pageText);

    if (isPartPage && quantity === 0) {
      indexes.push(pageIndex);
    }

    return indexes;
  }, []);

  const wastePageIndexSet = new Set(wastePageIndexes);
  const keepPageIndexes = normalizedPageTexts
    .map((pageText, pageIndex) => pageIndex)
    .filter(pageIndex => !wastePageIndexSet.has(pageIndex));
  const overflowMerge = planOverflowMerge(pages, keepPageIndexes);

  return {
    carrier: parseCarrier(coverPageText),
    orderId: parseOrderId(coverPageText),
    totalPageCount: normalizedPageTexts.length,
    wastePageIndexes,
    wastePageCount: wastePageIndexes.length,
    keepPageIndexes,
    keepPageCount: keepPageIndexes.length - (overflowMerge ? 1 : 0),
    overflowMerge,
  };
};

const addMergedHostPage = async ({ outputDocument, sourcePages, overflowMerge }) => {
  const hostPage = sourcePages[overflowMerge.hostIndex];
  const overflowPage = sourcePages[overflowMerge.overflowIndex];
  const { width, height } = hostPage.getSize();
  const bodyClipBottom = overflowMerge.footerTop + 2;
  const [body, footer, strip] = await Promise.all([
    outputDocument.embedPage(hostPage, { left: 0, bottom: bodyClipBottom, right: width, top: height }),
    outputDocument.embedPage(hostPage, { left: 0, bottom: 0, right: width, top: bodyClipBottom }),
    outputDocument.embedPage(overflowPage, {
      left: 0,
      bottom: overflowMerge.strip.bottom,
      right: width,
      top: overflowMerge.strip.top,
    }),
  ]);
  const mergedPage = outputDocument.addPage([width, height]);

  mergedPage.drawPage(body, { x: 0, y: bodyClipBottom + overflowMerge.lift });
  mergedPage.drawPage(strip, { x: 0, y: overflowMerge.stripY });
  mergedPage.drawPage(footer, { x: 0, y: 0 });
};

const createRewrittenPdf = async ({
  sourceFilePath,
  keepPageIndexes,
  overflowMerge = null,
  suffix,
}) => {
  const sourceBytes = await fs.promises.readFile(sourceFilePath);
  const sourceDocument = await PDFDocument.load(sourceBytes);
  const sourcePages = sourceDocument.getPages();
  const outputDocument = await PDFDocument.create();
  const outputFilePath = buildRewrittenPdfPath(sourceFilePath, suffix);

  for (const pageIndex of keepPageIndexes) {
    if (overflowMerge && pageIndex === overflowMerge.overflowIndex) {
      continue;
    }

    if (overflowMerge && pageIndex === overflowMerge.hostIndex) {
      await addMergedHostPage({ outputDocument, sourcePages, overflowMerge });
      continue;
    }

    const [copiedPage] = await outputDocument.copyPages(sourceDocument, [pageIndex]);
    outputDocument.addPage(copiedPage);
  }

  outputDocument.getPages().forEach(maskPrunedPageFooter);

  const outputBytes = await outputDocument.save();
  await fs.promises.writeFile(outputFilePath, outputBytes);

  return {
    filePath: outputFilePath,
    pageCount: outputDocument.getPageCount(),
  };
};

const buildRewrittenItem = async ({ item, rewrittenPdf, sourceType, extraJobMeta = {} }) => {
  const rewrittenFileStats = await fs.promises.stat(rewrittenPdf.filePath);

  return {
    ...item,
    file: {
      ...item.file,
      path: rewrittenPdf.filePath,
      filename: path.basename(rewrittenPdf.filePath),
      size: rewrittenFileStats.size,
    },
    jobMeta: {
      ...item.jobMeta,
      checksumFilePath: rewrittenPdf.filePath,
      fileSizeBytes: rewrittenFileStats.size,
      sourceType,
      chksum: null,
      ...extraJobMeta,
    },
  };
};

const createPlugin = ({ pluginDir, parsedConfig = {} }) => {
  let enabled = false;
  let printerIds = [];

  const syncConfig = nextParsedConfig => {
    parsedConfig = nextParsedConfig;
    const pluginConfig = parsedConfig?.plugins?.[PLUGIN_ID] || {};
    enabled = pluginConfig.enabled === true;
    printerIds = normalizePrinterIds(pluginConfig.printerIds);
  };

  const isTargetPrinter = printerId => printerIds.includes(String(printerId || '').trim());

  const analyzeTargetUpload = async ({ item, fileKind, printerConfig }) => {
    if (!enabled || fileKind !== 'pdf' || !isTargetPrinter(printerConfig?.id)) {
      return null;
    }

    const sourceFilePath = String(item?.file?.path || '').trim();

    if (!sourceFilePath || path.extname(sourceFilePath).toLowerCase() !== '.pdf') {
      return null;
    }

    return analyzePackingSlip(await extractPages(sourceFilePath));
  };

  syncConfig(parsedConfig);

  return {
    id: PLUGIN_ID,
    publicDir: path.join(pluginDir, 'public'),
    defaultConfig: DEFAULT_CONFIG,
    configHelpComment: CONFIG_HELP_COMMENT,
    syncConfig,
    isEnabled: () => enabled,
    async inspectUpload({
      item,
      fileKind,
      printerConfig,
    } = {}) {
      const analysis = await analyzeTargetUpload({ item, fileKind, printerConfig });

      if (!analysis?.wastePageCount) {
        return null;
      }

      return {
        wastePageCount: analysis.wastePageCount,
        keepPageCount: analysis.keepPageCount,
        prompt: {
          eyebrow: 'Xometry Review',
          title: 'Xometry - Packing Slip Waste Detected',
          message: `${analysis.wastePageCount} waste page${analysis.wastePageCount === 1 ? '' : 's'} contain only zero-quantity part sheets. Prune them before printing?`,
          subtext: `Keeping ${analysis.keepPageCount} printable page${analysis.keepPageCount === 1 ? '' : 's'} including the cover sheet.${analysis.carrier ? ` Carrier: ${analysis.carrier}.` : ''}`,
          logoUrl: `/plugins/${PLUGIN_ID}/xometry-logo.svg`,
          confirmLabel: 'Prune',
          secondaryLabel: 'Print Original',
          cancelLabel: 'Cancel',
        },
        analysis,
      };
    },
    // Runs only when no prompt was raised, so this is the overflow fold alone.
    async prepareUpload({
      item,
      fileKind,
      printerConfig,
    } = {}) {
      const analysis = await analyzeTargetUpload({ item, fileKind, printerConfig });

      if (!analysis?.overflowMerge || analysis.wastePageCount) {
        return null;
      }

      const compactedPdf = await createRewrittenPdf({
        sourceFilePath: item.file.path,
        keepPageIndexes: analysis.keepPageIndexes,
        overflowMerge: analysis.overflowMerge,
        suffix: 'compacted',
      });

      return {
        item: await buildRewrittenItem({
          item,
          rewrittenPdf: compactedPdf,
          sourceType: 'upload-pdf-xometry-compacted',
          extraJobMeta: {
            xometryCarrier: analysis.carrier,
            xometryOrderId: analysis.orderId,
          },
        }),
      };
    },
    async resolvePendingUploadAction({
      action,
      item,
      intervention,
    } = {}) {
      if (action !== 'prune') {
        return { item };
      }

      const analysis = intervention?.analysis || {};
      const wastePageIndexes = Array.isArray(analysis.wastePageIndexes)
        ? analysis.wastePageIndexes
        : [];

      if (!wastePageIndexes.length || !Array.isArray(analysis.keepPageIndexes)) {
        return { item };
      }

      const prunedPdf = await createRewrittenPdf({
        sourceFilePath: item.file.path,
        keepPageIndexes: analysis.keepPageIndexes,
        overflowMerge: analysis.overflowMerge || null,
        suffix: 'pruned',
      });

      return {
        cleanupAfterSuccessPaths: [item.file.path],
        item: await buildRewrittenItem({
          item,
          rewrittenPdf: prunedPdf,
          sourceType: 'upload-pdf-xometry-pruned',
          extraJobMeta: {
            xometryCarrier: analysis.carrier || null,
            xometryOrderId: analysis.orderId || null,
            xometryWastePageCount: wastePageIndexes.length,
          },
        }),
      };
    },
  };
};

module.exports = {
  createPlugin,
};
