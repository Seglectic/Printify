// ╭────────────────────────────╮
// │  Remote Template Adapter   │
// │  Owns label-template HTTP  │
// │  requests and API errors.  │
// ╰────────────────────────────╯
const readError = async (response, fallbackMessage) => {
  const payload = await response.json().catch(() => ({}));
  return new Error(payload.error || fallbackMessage);
};

export const createRemoteTemplateApi = () => ({
  async list(directoryPath = '') {
    const response = await fetch(`/label-builder/templates/remote?path=${encodeURIComponent(directoryPath)}`);
    if (!response.ok) throw await readError(response, 'Could not list remote templates.');
    return response.json();
  },

  async load(templatePath) {
    const response = await fetch(`/label-builder/templates/remote/file?path=${encodeURIComponent(templatePath)}`);
    if (!response.ok) throw await readError(response, 'Could not load remote template.');
    return response.json();
  },

  async save(payload) {
    const response = await fetch('/label-builder/templates/remote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw await readError(response, 'Could not save remote template.');
    return response.json();
  },

  async createFolder(directoryPath, name) {
    const response = await fetch('/label-builder/templates/remote/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directoryPath, name }),
    });
    if (!response.ok) throw await readError(response, 'Could not create remote folder.');
    return response.json();
  },

  async delete(templatePath) {
    const response = await fetch(`/label-builder/templates/remote/file?path=${encodeURIComponent(templatePath)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await readError(response, 'Could not delete remote template.');
    return response.json();
  },

  async deleteFolder(directoryPath) {
    const response = await fetch(`/label-builder/templates/remote/folders?path=${encodeURIComponent(directoryPath)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await readError(response, 'Could not delete remote folder.');
    return response.json();
  },
});
