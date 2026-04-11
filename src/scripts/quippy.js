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
    'The label builder is still here for your tiny rectangle ambitions.',
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

  const CAPABILITY_TEMPLATES = [
    '$printer can take $filekinds.',
    '$printer is configured for $filekinds.',
    '$printer is standing by for $filekinds.',
    'If you hand $printer some $filekinds, it should cope.',
    '$printer speaks fluent $filekinds.',
    '$printer is tuned for $filekinds at $printersize.',
    '$printer takes $filekinds. $buildernote',
    'The $printer can handle $filekinds. That seems useful.',
    '$printer is sized for $printersize and apparently willing to accept $filekinds.',
    '$printer remains available for $filekinds, assuming everyone behaves.',
  ];

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

  const buildCapabilityLines = printers => (
    (printers || [])
      .filter(printer => printer && printer.displayName && Array.isArray(printer.acceptedKinds) && printer.acceptedKinds.length)
      .flatMap(printer => (
        CAPABILITY_TEMPLATES
          .map(template => renderTemplate(template, null, { printer }))
          .filter(Boolean)
      ))
  );

  const buildTemplateLines = (templates, context) => (
    templates
      .map(template => renderTemplate(template, context, null))
      .filter(Boolean)
  );

  const getBootLines = context => ([
    ...buildTemplateLines(STAT_TEMPLATES, context || {}),
    ...buildTemplateLines(LAST_PRINT_TEMPLATES, context || {}),
    ...buildCapabilityLines(context?.printers),
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
