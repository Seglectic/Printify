// ╭──────────────────────────────────────────────╮
// │  lib/plugins/xometry-packing-slip            │
// │  Detects Xometry packing slips and offers    │
// │  to prune zero-quantity detail pages         │
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
const CONFIG_HELP_COMMENT = 'Prompts to prune zero-quantity Xometry packing-slip pages before printing.';
const FOOTER_MASK_HEIGHT = 22;
const FOOTER_MASK_VERTICAL_INSET = 4;
const FOOTER_MASK_WIDTH = 108;
const FOOTER_MASK_RIGHT_INSET = 10;

const normalizeText = value => String(value || '')
  .replace(/\s+/g, ' ')
  .trim();

const normalizePrinterIds = value => Array.isArray(value)
  ? value.map(printerId => String(printerId || '').trim()).filter(Boolean)
  : [];

const buildPrunedPdfPath = sourceFilePath => path.join(
  path.dirname(sourceFilePath),
  `${Date.now()}-${path.parse(sourceFilePath).name}-xometry-pruned.pdf`
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

const extractPageTexts = async filePath => {
  const sourceBytes = new Uint8Array(await fs.promises.readFile(filePath));
  const loadingTask = pdfjs.getDocument({
    data: sourceBytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    verbosity: 0,
  });
  const pdfDocument = await loadingTask.promise;
  const pageTexts = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = normalizeText(textContent.items.map(item => item.str).join(' '));
      pageTexts.push(pageText);
    }
  } finally {
    await loadingTask.destroy();
  }

  return pageTexts;
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

const analyzePackingSlip = pageTexts => {
  const normalizedPageTexts = Array.isArray(pageTexts) ? pageTexts : [];
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

  if (!wastePageIndexes.length) {
    return null;
  }

  return {
    carrier: parseCarrier(coverPageText),
    orderId: parseOrderId(coverPageText),
    totalPageCount: normalizedPageTexts.length,
    wastePageIndexes,
    wastePageCount: wastePageIndexes.length,
    keepPageCount: normalizedPageTexts.length - wastePageIndexes.length,
  };
};

const createPrunedPdf = async ({ sourceFilePath, wastePageIndexes }) => {
  const sourceBytes = await fs.promises.readFile(sourceFilePath);
  const sourceDocument = await PDFDocument.load(sourceBytes);
  const prunedDocument = await PDFDocument.create();
  const wastePageIndexSet = new Set(wastePageIndexes);
  const keepPageIndexes = sourceDocument.getPageIndices().filter(pageIndex => !wastePageIndexSet.has(pageIndex));
  const prunedFilePath = buildPrunedPdfPath(sourceFilePath);
  const copiedPages = await prunedDocument.copyPages(sourceDocument, keepPageIndexes);

  copiedPages.forEach(page => {
    maskPrunedPageFooter(page);
    prunedDocument.addPage(page);
  });

  const prunedBytes = await prunedDocument.save();
  await fs.promises.writeFile(prunedFilePath, prunedBytes);

  return {
    filePath: prunedFilePath,
    pageCount: keepPageIndexes.length,
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
      if (!enabled || fileKind !== 'pdf' || !isTargetPrinter(printerConfig?.id)) {
        return null;
      }

      const sourceFilePath = String(item?.file?.path || '').trim();

      if (!sourceFilePath || path.extname(sourceFilePath).toLowerCase() !== '.pdf') {
        return null;
      }

      const pageTexts = await extractPageTexts(sourceFilePath);
      const analysis = analyzePackingSlip(pageTexts);

      if (!analysis) {
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
    async resolvePendingUploadAction({
      action,
      item,
      intervention,
    } = {}) {
      if (action !== 'prune') {
        return { item };
      }

      const wastePageIndexes = Array.isArray(intervention?.analysis?.wastePageIndexes)
        ? intervention.analysis.wastePageIndexes
        : [];

      if (!wastePageIndexes.length) {
        return { item };
      }

      const prunedPdf = await createPrunedPdf({
        sourceFilePath: item.file.path,
        wastePageIndexes,
      });
      const prunedFileStats = await fs.promises.stat(prunedPdf.filePath);

      return {
        cleanupAfterSuccessPaths: [item.file.path],
        item: {
          ...item,
          file: {
            ...item.file,
            path: prunedPdf.filePath,
            filename: path.basename(prunedPdf.filePath),
            size: prunedFileStats.size,
          },
          jobMeta: {
            ...item.jobMeta,
            checksumFilePath: prunedPdf.filePath,
            fileSizeBytes: prunedFileStats.size,
            sourceType: 'upload-pdf-xometry-pruned',
            chksum: null,
            xometryCarrier: intervention?.analysis?.carrier || null,
            xometryOrderId: intervention?.analysis?.orderId || null,
            xometryWastePageCount: wastePageIndexes.length,
          },
        },
      };
    },
  };
};

module.exports = {
  createPlugin,
};
