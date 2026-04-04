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

  const humanJoin = values => {
    const cleanValues = values.filter(Boolean);

    if (!cleanValues.length) return '';
    if (cleanValues.length === 1) return cleanValues[0];
    if (cleanValues.length === 2) return `${cleanValues[0]} and ${cleanValues[1]}`;

    return `${cleanValues.slice(0, -1).join(', ')}, and ${cleanValues[cleanValues.length - 1]}`;
  };

  const buildCapabilityLines = printers => (
    (printers || [])
      .filter(printer => printer && printer.displayName && Array.isArray(printer.acceptedKinds) && printer.acceptedKinds.length)
      .flatMap(printer => {
        const fileKinds = humanJoin(
          printer.acceptedKinds.map(kind => (
            FILE_KIND_LABELS[kind]?.sentence || `${String(kind || '').toUpperCase()} files`
          ))
        );
        const builderStatus = printer.labelBuilder ? 'It even has a label builder.' : 'No label builder though.';
        const sizeNote = printer.pxSize ? `Its target size is ${printer.pxSize}.` : 'It has chosen not to discuss dimensions.';

        return [
          `Did you know the ${printer.displayName} can take ${fileKinds}?`,
          `${printer.displayName} is standing by. No pressure.`,
          `${printer.displayName} accepts ${fileKinds}. ${builderStatus}`,
          `${printer.displayName} is configured for ${fileKinds}. ${sizeNote}`,
          `The ${printer.displayName} can handle ${fileKinds}. That seems useful.`,
        ];
      })
  );

  const buildStatLines = ({ printCounter, pageHits }) => {
    const lines = [];

    if (Number.isFinite(printCounter)) {
      lines.push(`We've printed over ${printCounter} files. That's a lot of trust.`);
      lines.push(`${printCounter} files printed so far. I assume all of them were urgent.`);
      lines.push(`${printCounter} files have gone through here.`);
      lines.push(`Print count: ${printCounter}.`);
      lines.push(`${printCounter} prints so far. Better than zero, arguably.`);
    }

    if (Number.isFinite(pageHits)) {
      lines.push(`${pageHits} visits. I feel perceived.`);
      lines.push(`${pageHits} hits and somehow I'm still not on payroll.`);
      lines.push(`${pageHits} visits so far. People continue to test fate.`);
      lines.push(`Page hits: ${pageHits}. Interest remains inconveniently measurable.`);
      lines.push(`${pageHits} visits to this page. A niche kind of fame.`);
    }

    if (Number.isFinite(printCounter) && Number.isFinite(pageHits) && pageHits > 0) {
      const printRate = Math.round((printCounter / pageHits) * 100);
      lines.push(`${printCounter} prints across ${pageHits} visits.`);
      lines.push(`${pageHits} visits, ${printCounter} prints. Hm.`);
      lines.push(`Roughly ${printRate}% of visits end in printing. The rest were probably reconnaissance.`);
    }

    return lines;
  };

  const buildGeneralLines = () => ([
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
  ]);

  const getBootLines = context => ([
    ...buildStatLines(context || {}),
    ...buildCapabilityLines(context?.printers),
    ...buildGeneralLines(),
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
