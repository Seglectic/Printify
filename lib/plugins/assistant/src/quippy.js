(function () {
  const FILE_KIND_LABELS = {
    pdf: {
      chip: 'PDF',
      sentence: 'PDF files',
    },
    image: {
      chip: 'Image',
      sentence: 'image files',
    },
    zip: {
      chip: 'ZIP',
      sentence: 'ZIP files',
    },
  };

  const SOURCE_TYPE_TO_FILE_KIND = {
    'log-reprint': 'pdf',
    'log-reprint-bundled': 'pdf',
    'upload-pdf': 'pdf',
    'upload-pdf-bundled': 'pdf',
    'upload-image': 'image',
    'upload-image-bundled': 'image',
    'upload-zip': 'zip',
    'upload-zip-pdf': 'zip',
  };

  const GENERAL_LINES = [
    'The printers appear to be operational. For now.',
    'This all seems relatively under control.',
    'I assume the next file is the important one.',
    'The Logs button exists if you enjoy specifics.',
    'Thermal printers remain committed to contrast and disappointment.',
    'Everything looks fine, hopefully not temporary.',
    "I'm here in case the silence becomes suspicious.",
    'The drag-and-drop zones are the large obvious parts.',
    'If a printer misbehaves, it will probably act innocent.',
    'There are easier ways to spend an afternoon, admittedly.',
    'It looks like you are trying to print something.',
    'It looks like you are trying to kill a tree.',
    'It looks like you are trying to trust a printer.',
    'It looks like you are trying to do this quickly.',
    'It looks like you are trying to pretend this is routine.',
    'I am choosing to believe the next job is well-formatted.',
    'Someone gave these printers responsibilities. Bold.',
    'This interface remains one drag away from consequences.',
    'I support the workflow emotionally, if not mechanically.',
    'Every print queue starts with optimism.',
    'The machines are quiet, which is either good or suspicious.',
  ];

  const STAT_TEMPLATES = [
    'We have logged $printcount prints so far.',
    '$printcount prints. A measurable amount of confidence.',
    '$pagehits visits and $printcount prints. The ratio remains interesting.',
    'About $printrate of visits end in printing.',
    'Today alone: $todayprints prints and $todayhits visits.',
    'Server data version $dataversion is keeping score.',
    '$pagehits page hits. I do notice these things.',
    '$printcount prints across $pagehits visits. Not bad for a printer page.',
    '$todayprints prints today. Busy little operation.',
    '$todayhits visits today. Word gets around.',
    'The paper tally is sitting at $scorearea.',
    '$scorepages pages adds up to about $scorearea of paper.',
  ];

  const LAST_PRINT_TEMPLATES = [
    'The last completed job was $lastfile on $lastprinter.',
    'Most recently, $lastfile went through $lastprinter.',
    'Last print was a $lastkind sent to $lastprinter.',
    '$lastprinter handled $lastfile most recently.',
    'Latest result: $lastresult. Very official.',
    'The most recent job used the $lastmode path. Naturally.',
    '$lastfile was the last thing to leave here with purpose.',
    'The last print landed at $lasttimeago. Time moves strangely around printers.',
    'Most recent route was $lastroute, which sounds confident enough.',
    '$lastprinter last touched $lastfile at $lasttimeago.',
    'The latest successful job was $lastkind on $lastprinter via $lastmode.',
    '$lastbundlecount items were bundled into the latest job. Efficient, if a little dramatic.',
  ];

  // Keep the tree math deliberately rough and only mention it once the result is material.
  const TREE_REFERENCE_PAGE_COUNT = 8333;
  const LETTER_PAGE_AREA_SQUARE_MM = 215.9 * 279.4;
  const TREE_REFERENCE_AREA_SQUARE_MM = TREE_REFERENCE_PAGE_COUNT * LETTER_PAGE_AREA_SQUARE_MM;
  const SQUARE_FEET_PER_SQUARE_METER = 10.76391041671;
  const SQUARE_MILLIMETERS_PER_SQUARE_METER = 1_000_000;
  // Area references:
  // - Thomas Jefferson Building: 600,000 sq ft (Library of Congress)
  // - James Madison Memorial Building: 2.1 million sq ft (Architect of the Capitol)
  // - Library of Congress building portfolio: 4.4 million sq ft (Architect of the Capitol)
  // The 400 sq ft studio is an intentionally human-scale benchmark, not a formal average.
  const AREA_COMPARISONS = [
    {
      id: 'studio',
      label: 'a 400-square-foot studio apartment',
      squareFeet: 400,
    },
    {
      id: 'jefferson',
      label: 'the Thomas Jefferson Building at the Library of Congress',
      squareFeet: 600_000,
    },
    {
      id: 'madison',
      label: 'the James Madison Memorial Building at the Library of Congress',
      squareFeet: 2_100_000,
    },
    {
      id: 'loc-campus',
      label: 'the Library of Congress building portfolio under the Architect of the Capitol',
      squareFeet: 4_400_000,
    },
  ].map(comparison => ({
    ...comparison,
    squareMeters: comparison.squareFeet / SQUARE_FEET_PER_SQUARE_METER,
    squareMillimeters: (comparison.squareFeet / SQUARE_FEET_PER_SQUARE_METER) * SQUARE_MILLIMETERS_PER_SQUARE_METER,
  }));

  const pickOne = values => {
    const cleanValues = (values || []).filter(Boolean);
    if (!cleanValues.length) return null;
    return cleanValues[Math.floor(Math.random() * cleanValues.length)];
  };

  const describePrinterSize = printer => {
    const physicalSize = printer?.size && printer?.units
      ? `${printer.size} ${printer.units}`
      : null;
    const pixelSize = printer?.sizePx
      ? `${printer.sizePx}px`
      : null;

    if (physicalSize && pixelSize) return `${physicalSize} (${pixelSize})`;
    return physicalSize || pixelSize || 'an undisclosed size';
  };

  const toLocalDateKey = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getTodayStats = dailyStats => {
    const todayKey = toLocalDateKey(new Date());
    return dailyStats?.[todayKey] || null;
  };

  const formatTimeAgo = timestamp => {
    if (!timestamp) return null;

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;

    const diffMs = Date.now() - date.getTime();
    const absDiffMs = Math.abs(diffMs);
    const minutes = Math.round(absDiffMs / 60000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  const formatTreeCount = areaSquareMm => {
    const numericArea = Number(areaSquareMm);

    if (!Number.isFinite(numericArea) || numericArea < 0) {
      return null;
    }

    return (numericArea / TREE_REFERENCE_AREA_SQUARE_MM).toFixed(1);
  };

  const formatAreaSquareMeters = areaSquareMm => {
    const numericArea = Number(areaSquareMm);

    if (!Number.isFinite(numericArea) || numericArea <= 0) {
      return null;
    }

    const areaSquareMeters = numericArea / SQUARE_MILLIMETERS_PER_SQUARE_METER;
    const maximumFractionDigits = areaSquareMeters < 10
      ? 2
      : (areaSquareMeters < 100 ? 1 : 0);

    return `${areaSquareMeters.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    })} m²`;
  };

  const describeTreeEquivalent = areaSquareMm => {
    const treeCount = Number(formatTreeCount(areaSquareMm));

    if (!Number.isFinite(treeCount) || treeCount < 0.5) {
      return null;
    }

    if (treeCount < 1.5) {
      return 'roughly one tree';
    }

    return `about ${Math.round(treeCount).toLocaleString()} trees`;
  };

  const getLargestAreaComparison = areaSquareMm => {
    const numericArea = Number(areaSquareMm);

    if (!Number.isFinite(numericArea) || numericArea <= 0) {
      return null;
    }

    return AREA_COMPARISONS
      .filter(comparison => numericArea >= comparison.squareMillimeters)
      .sort((left, right) => right.squareMillimeters - left.squareMillimeters)[0] || null;
  };

  const guessFileKindFromFilename = fileName => {
    const normalizedName = String(fileName || '').toLowerCase();
    if (!normalizedName) return null;
    if (normalizedName.endsWith('.zip')) return 'zip';
    if (/\.(png|jpg|jpeg|tif|tiff|webp)$/.test(normalizedName)) return 'image';
    if (normalizedName.endsWith('.pdf')) return 'pdf';
    return null;
  };

  const getJobFileKind = job => (
    SOURCE_TYPE_TO_FILE_KIND[job?.sourceType] || guessFileKindFromFilename(job?.originalFilename)
  );

  const buildVariableResolvers = context => {
    const todayStats = getTodayStats(context?.dailyStats);
    const lastPrintJob = context?.lastPrintJob || null;
    const lastPrintKind = getJobFileKind(lastPrintJob);
    const totalPages = Number.isFinite(context?.pageCounter) ? context.pageCounter : null;
    const actualPages = Number.isFinite(context?.actualPageCounter) ? context.actualPageCounter : null;
    const testingPages = Number.isFinite(context?.testingPageCounter) ? context.testingPageCounter : null;
    const totalAreaSquareMm = Number.isFinite(context?.paperAreaSquareMm) ? context.paperAreaSquareMm : null;
    const actualAreaSquareMm = Number.isFinite(context?.actualPaperAreaSquareMm) ? context.actualPaperAreaSquareMm : null;
    const testingAreaSquareMm = Number.isFinite(context?.testingPaperAreaSquareMm) ? context.testingPaperAreaSquareMm : null;
    const scorePages = context?.testing ? totalPages : actualPages;
    const scoreAreaSquareMm = context?.testing ? totalAreaSquareMm : actualAreaSquareMm;

    return {
      printcount: () => (
        Number.isFinite(context?.printCounter) ? String(context.printCounter) : null
      ),
      pagehits: () => (
        Number.isFinite(context?.pageHits) ? String(context.pageHits) : null
      ),
      printrate: () => (
        Number.isFinite(context?.printCounter)
        && Number.isFinite(context?.pageHits)
        && context.pageHits > 0
          ? `${Math.round((context.printCounter / context.pageHits) * 100)}%`
          : null
      ),
      todayprints: () => (
        Number.isFinite(todayStats?.prints) ? String(todayStats.prints) : null
      ),
      todayhits: () => (
        Number.isFinite(todayStats?.pageHits) ? String(todayStats.pageHits) : null
      ),
      scorepages: () => (
        Number.isFinite(scorePages) ? String(scorePages) : null
      ),
      scorearea: () => formatAreaSquareMeters(scoreAreaSquareMm),
      actualpages: () => (
        Number.isFinite(actualPages) ? String(actualPages) : null
      ),
      actualarea: () => formatAreaSquareMeters(actualAreaSquareMm),
      testingpages: () => (
        Number.isFinite(testingPages) && testingPages > 0 ? String(testingPages) : null
      ),
      testingarea: () => (
        Number.isFinite(testingAreaSquareMm) && testingAreaSquareMm > 0
          ? formatAreaSquareMeters(testingAreaSquareMm)
          : null
      ),
      scoretrees: () => formatTreeCount(scoreAreaSquareMm),
      actualtrees: () => (
        Number.isFinite(actualAreaSquareMm) && actualPages > 0 ? formatTreeCount(actualAreaSquareMm) : null
      ),
      testingtrees: () => (
        Number.isFinite(testingAreaSquareMm) && testingPages > 0 ? formatTreeCount(testingAreaSquareMm) : null
      ),
      dataversion: () => context?.serverDataVersion || null,
      lastfile: () => lastPrintJob?.originalFilename || null,
      lastprinter: () => lastPrintJob?.printerName || lastPrintJob?.printerId || null,
      lastresult: () => lastPrintJob?.result || null,
      lastmode: () => lastPrintJob?.printMode || null,
      lastroute: () => lastPrintJob?.sourceRoute || null,
      lastkind: () => (
        lastPrintKind ? FILE_KIND_LABELS[lastPrintKind]?.sentence || `${lastPrintKind} files` : null
      ),
      lasttimeago: () => formatTimeAgo(context?.lastPrintAt || lastPrintJob?.timestamp),
      lastbundlecount: () => (
        Number.isFinite(lastPrintJob?.bundledSourceCount) && lastPrintJob.bundledSourceCount > 1
          ? String(lastPrintJob.bundledSourceCount)
          : null
      ),
    };
  };

  const renderTemplate = (template, context, lineContext) => {
    const resolvers = buildVariableResolvers(context);
    const lineState = {};
    let missingVariable = false;

    const rendered = template.replace(/\$([a-z]+)/gi, (match, variableName) => {
      const normalizedName = String(variableName || '').toLowerCase();
      let value = null;

      if (normalizedName === 'printer') {
        value = lineContext?.printer?.displayName || lineContext?.printer?.printerName || lineContext?.printer?.id || null;
      } else if (normalizedName === 'printersize') {
        value = describePrinterSize(lineContext?.printer);
      } else if (normalizedName === 'buildernote') {
        value = lineContext?.printer?.labelBuilder
          ? 'It even has a label builder.'
          : 'No label builder though.';
      } else if (normalizedName === 'filekinds') {
        if (!lineState.fileKind) {
          lineState.fileKind = pickOne(lineContext?.printer?.acceptedKinds);
        }

        value = lineState.fileKind
          ? FILE_KIND_LABELS[lineState.fileKind]?.sentence || `${lineState.fileKind} files`
          : null;
      } else {
        const resolver = resolvers[normalizedName];
        value = resolver ? resolver() : match;
      }

      if (value === null || value === '') {
        missingVariable = true;
        return '';
      }

      return value;
    });

    if (missingVariable) return null;

    const normalized = rendered.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
    return normalized.length ? normalized : null;
  };

  const buildTemplateLines = (templates, context) => (
    templates
      .map(template => renderTemplate(template, context, null))
      .filter(Boolean)
  );

  const buildAreaLines = context => {
    const totalAreaSquareMm = Number.isFinite(context?.paperAreaSquareMm) ? context.paperAreaSquareMm : 0;
    const actualAreaSquareMm = Number.isFinite(context?.actualPaperAreaSquareMm) ? context.actualPaperAreaSquareMm : 0;
    const testingAreaSquareMm = Number.isFinite(context?.testingPaperAreaSquareMm) ? context.testingPaperAreaSquareMm : 0;
    const scoreAreaSquareMm = context?.testing ? totalAreaSquareMm : actualAreaSquareMm;
    const scoreAreaLabel = formatAreaSquareMeters(scoreAreaSquareMm);
    const scoreComparison = getLargestAreaComparison(scoreAreaSquareMm);
    const testingComparison = getLargestAreaComparison(testingAreaSquareMm);
    const lines = [];

    if (scoreComparison && scoreAreaLabel) {
      lines.push(`You've printed enough paper to cover ${scoreComparison.label}.`);
      lines.push(`${scoreAreaLabel} is enough paper to cover ${scoreComparison.label}.`);
    }

    if (testingComparison && testingAreaSquareMm > 0) {
      lines.push(`Testing alone has chewed through enough paper to cover ${testingComparison.label}.`);
    } else if (testingAreaSquareMm >= 1 * SQUARE_MILLIMETERS_PER_SQUARE_METER) {
      const testingAreaLabel = formatAreaSquareMeters(testingAreaSquareMm);
      if (testingAreaLabel) {
        lines.push(`Testing alone has burned through ${testingAreaLabel} of paper.`);
      }
    }

    return lines;
  };

  const buildTreeLines = context => {
    const totalAreaSquareMm = Number.isFinite(context?.paperAreaSquareMm) ? context.paperAreaSquareMm : 0;
    const actualAreaSquareMm = Number.isFinite(context?.actualPaperAreaSquareMm) ? context.actualPaperAreaSquareMm : 0;
    const testingAreaSquareMm = Number.isFinite(context?.testingPaperAreaSquareMm) ? context.testingPaperAreaSquareMm : 0;
    const scoreAreaSquareMm = context?.testing ? totalAreaSquareMm : actualAreaSquareMm;
    const scorePages = Number.isFinite(context?.testing ? context?.pageCounter : context?.actualPageCounter)
      ? (context?.testing ? context.pageCounter : context.actualPageCounter)
      : null;
    const scoreTrees = describeTreeEquivalent(scoreAreaSquareMm);
    const actualTrees = describeTreeEquivalent(actualAreaSquareMm);
    const testingTrees = describeTreeEquivalent(testingAreaSquareMm);
    const lines = [];

    if (scoreTrees) {
      lines.push(`Paper math puts the total at ${scoreTrees}.`);
      if (Number.isFinite(scorePages)) {
        lines.push(`${scorePages.toLocaleString()} pages comes out to ${scoreTrees}.`);
      }
    }

    if (actualTrees && context?.testing) {
      lines.push(`Real print jobs alone amount to ${actualTrees}.`);
    }

    if (testingTrees) {
      lines.push(`Testing mode alone has chewed through ${testingTrees}.`);
    }

    return lines.filter(Boolean);
  };

  const getBootLines = context => ([
    ...buildTemplateLines(STAT_TEMPLATES, context || {}),
    ...buildAreaLines(context || {}),
    ...buildTreeLines(context || {}),
    ...buildTemplateLines(LAST_PRINT_TEMPLATES, context || {}),
    ...GENERAL_LINES,
  ]);

  const getRandomBootLine = context => {
    const lines = getBootLines(context).filter(Boolean);

    if (!lines.length) {
      return 'I have nothing to say, which is honestly new for me.';
    }

    return lines[Math.floor(Math.random() * lines.length)];
  };

  window.PrintifyQuippy = {
    getBootLines,
    getRandomBootLine,
  };
}());
