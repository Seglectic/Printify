// ╭────────────────────────────╮
// │  Template Schema           │
// │  Migrates saved builder    │
// │  documents without Fabric. │
// ╰────────────────────────────╯
export const CURRENT_TEMPLATE_SCHEMA_VERSION = '1.1';

const migrateTextObject = (object, sourceVersion) => ({
  ...object,
  verticalAlign: ['top', 'middle', 'bottom'].includes(object?.verticalAlign)
    ? object.verticalAlign
    : (sourceVersion === '1.0' ? 'top' : 'middle'),
});

export const migrateTemplateDocument = document => {
  if (!document || typeof document !== 'object') {
    throw new Error('Template document is invalid.');
  }

  const sourceVersion = String(document.schemaVersion || '1.0');
  if (!['1.0', CURRENT_TEMPLATE_SCHEMA_VERSION].includes(sourceVersion)) {
    throw new Error(`Template schema ${sourceVersion} is not supported.`);
  }

  return {
    ...document,
    schemaVersion: CURRENT_TEMPLATE_SCHEMA_VERSION,
    objects: Array.isArray(document.objects)
      ? document.objects.map(object => object?.type === 'text'
        ? migrateTextObject(object, sourceVersion)
        : { ...object })
      : [],
  };
};
