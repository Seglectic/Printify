(function () {
  const FILE_KIND_LABELS = {
    pdf: 'PDF',
    image: 'image',
    zip: 'ZIP',
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
          printer.acceptedKinds.map(kind => FILE_KIND_LABELS[kind] || String(kind || '').toUpperCase())
        );

        return [
          `Did you know the ${printer.displayName} can take ${fileKinds} files? You do now.`,
          `${printer.displayName} is standing by for ${fileKinds}. No pressure.`,
          `Fun fact: ${printer.displayName} speaks fluent ${fileKinds}.`,
        ];
      })
  );

  const buildStatLines = ({ printCounter, pageHits }) => {
    const lines = [];

    if (Number.isFinite(printCounter)) {
      lines.push(`We've printed over ${printCounter} files. That's a lot of trust.`);
      lines.push(`${printCounter} files printed so far. I assume all of them were urgent.`);
    }

    if (Number.isFinite(pageHits)) {
      lines.push(`This page has had ${pageHits} visits. I feel perceived.`);
      lines.push(`${pageHits} visits and somehow I'm still not in the org chart.`);
    }

    return lines;
  };

  const buildGeneralLines = () => ([
    'Use the Logs button if you want the receipts without the drama.',
    'Drag a file onto a printer card. It is deeply satisfying.',
    'I am not judging your label layout. I am archiving it emotionally.',
    'Somewhere, a printer is warming up and pretending not to be nervous.',
    'If this all works on the first try, act natural.',
    'I remain available for unhelpful commentary and highly specific encouragement.',
    'Thermal printers love confidence. And high-contrast artwork.',
    'You can ignore me, but I will process that in my own way.',
    'This dashboard has fewer distractions now. I took that personally.',
    'I respect a clean print queue the way some people respect sunsets.',
    'You bring the files. The printers bring the mechanical suspense.',
    'I would say stay calm, but that has never helped anybody print faster.',
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
