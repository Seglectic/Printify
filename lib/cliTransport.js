// ╭──────────────────────────╮
// │  CLI Transport           │
// │  Builds constrained args │
// │  for printer utilities.  │
// ╰──────────────────────────╯

const getCommandBasename = command => (
  String(command || '').trim().split(/[\\/]/).pop().toLowerCase()
);

const isPtouchPrintCommand = command => (
  ['ptouch-print', 'ptouch-print.exe'].includes(getCommandBasename(command))
);

const supportsNativeTapeCopies = printerConfig => (
  Boolean(
    printerConfig?.isTape
    && printerConfig.printMode === 'cli'
    && isPtouchPrintCommand(printerConfig.cliCommand)
  )
);

const interpolateCliArg = (arg, filePath, jobMeta = {}) => (
  String(arg)
    .replaceAll('{file}', filePath)
    .replaceAll('{tapeWidthMm}', jobMeta.tapeWidthMm ? String(jobMeta.tapeWidthMm) : '')
    .replaceAll('{lengthMm}', jobMeta.lengthMm ? String(jobMeta.lengthMm) : '')
);

const buildCliArgs = (filePath, printerConfig, jobMeta = {}) => {
  const cliArgs = (printerConfig.cliArgs || []).map(arg => (
    interpolateCliArg(arg, filePath, jobMeta)
  ));
  const nativeCopyCount = Number.parseInt(jobMeta.cliCopies, 10);
  const hasCopyArgument = cliArgs.some(arg => (
    arg === '--copies' || arg.startsWith('--copies=')
  ));

  // ptouch-print's pre-cut removes the unavoidable leader before a label,
  // while its normal final cut still leaves one-off jobs ready to collect.
  if (
    supportsNativeTapeCopies(printerConfig)
    && !cliArgs.includes('--precut')
  ) {
    cliArgs.unshift('--precut');
  }

  // Native copies chain every intermediate label inside one USB session and
  // restore the normal feed/cut for the last one. A literal --chain would
  // leave that final label inside the printer.
  if (
    supportsNativeTapeCopies(printerConfig)
    && Number.isFinite(nativeCopyCount)
    && nativeCopyCount > 1
    && !hasCopyArgument
  ) {
    cliArgs.unshift('--copies', String(Math.min(nativeCopyCount, 50)));
  }

  return cliArgs;
};

module.exports = {
  buildCliArgs,
  isPtouchPrintCommand,
  supportsNativeTapeCopies,
};
