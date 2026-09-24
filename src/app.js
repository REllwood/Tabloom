import { buildProject, clusterTabs, duplicateGroups, exportMap, inspectUrl, readImport, restoreProject } from './core.js';
import { sampleTabs } from './sample.js';

const storageKey = 'tabloom:v0.1';

const elements = {
  dataset: document.querySelector('#dataset'),
  file: document.querySelector('#dataset-file'),
  preview: document.querySelector('#capture-preview'),
  previewRows: document.querySelector('#preview-rows'),
  previewSummary: document.querySelector('#preview-summary'),
  status: document.querySelector('#capture-status'),
  cancel: document.querySelector('#cancel-job'),
  dialogStatus: document.querySelector('#dialog-job-status'),
  dialogCancel: document.querySelector('#dialog-cancel-job'),
  name: document.querySelector('#map-name'),
  map: document.querySelector('#map-view'),
  outline: document.querySelector('#outline-view'),
  empty: document.querySelector('#empty-map'),
  mapSummary: document.querySelector('#map-summary'),
  mapViewButton: document.querySelector('#map-view-button'),
  outlineViewButton: document.querySelector('#outline-view-button'),
  exportButton: document.querySelector('#export-button'),
  stripQuery: document.querySelector('#strip-query'),
  dialog: document.querySelector('#review-dialog'),
  review: document.querySelector('#review-content')
};

let pendingImport = null;
let pendingSource = null;
let project = { version: 1, name: 'Untitled investigation', tabs: [], clusters: [] };
let activeController = null;
let outlineSelected = false;

function invalidateImportPreview(message = 'Import source changed. Preview the current fields before confirming.') {
  pendingImport = null;
  pendingSource = null;
  elements.preview.hidden = true;
  if (message) status(message);
}

function status(message, loading = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('loading', loading);
  elements.cancel.hidden = !loading;
  elements.dialogStatus.textContent = message;
  elements.dialogStatus.classList.toggle('loading', loading);
  elements.dialogStatus.hidden = !elements.dialog.open && !loading;
  elements.dialogCancel.hidden = !loading;
}

async function runJob(label, work) {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  status(`Loading: ${label}`, true);
  const cancelled = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  });
  cancelled.catch(() => {});
  try {
    const value = await Promise.race([work(), cancelled]);
    status(`${label} complete.`);
    return value;
  } catch (error) {
    // A job replaced by a newer one stays quiet so it does not overwrite the newer job's status.
    if (activeController === controller) status(error.name === 'AbortError' ? `${label} cancelled. Existing map unchanged.` : `${label} failed: ${error.message}`);
    return null;
  } finally {
    if (activeController === controller) activeController = null;
  }
}

function parseDataset(text) {
  if (text.length > 300_000) throw new RangeError('The JSON import is limited to 300,000 characters.');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SyntaxError('The selected-tab dataset is not valid JSON.');
  }
  return readImport(value);
}

function renderPreview(imported) {
  const { tabs } = imported;
  elements.previewRows.replaceChildren();
  let warningCount = 0;
  for (const tab of tabs) {
    const inspection = inspectUrl(tab.url);
    warningCount += inspection.warnings.length;
    const row = document.createElement('tr');
    const title = document.createElement('td');
    title.textContent = tab.title;
    const address = document.createElement('td');
    address.textContent = tab.url;
    const fields = document.createElement('td');
    const fieldNames = ['title', 'url', ...(tab.openerId ? ['openerId'] : []), ...(tab.capturedAt ? ['capturedAt'] : []), ...(tab.note ? ['note'] : [])];
    fields.textContent = `Captured: ${fieldNames.join(', ')}.`;
    for (const message of inspection.warnings) {
      const warning = document.createElement('p');
      warning.className = 'warning';
      warning.textContent = message;
      fields.append(warning);
    }
    row.append(title, address, fields);
    elements.previewRows.append(row);
  }
  const restored = imported.fromExport ? `Tabloom export${imported.name ? ` “${imported.name}”` : ''}: its map name and cluster names will be restored. ` : '';
  elements.previewSummary.textContent = `${restored}${tabs.length} selected ${tabs.length === 1 ? 'tab' : 'tabs'}; ${warningCount} privacy ${warningCount === 1 ? 'warning' : 'warnings'}. Page bodies, cookies, form values and browsing history are not fields in this import.`;
  elements.preview.hidden = false;
}

function persist() {
  project.name = elements.name.value.trim().slice(0, 120) || 'Untitled investigation';
  localStorage.setItem(storageKey, JSON.stringify(project));
  elements.mapSummary.textContent = `${project.tabs.length} selected tabs stored locally in this browser profile.`;
}

function restore() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    project = restoreProject(JSON.parse(raw));
    elements.name.value = project.name;
    renderProject();
    status('Recovered the locally stored research map.');
  } catch (error) {
    status(`Stored map could not be recovered: ${error.message}`);
  }
}

function nodeElement(tab) {
  const article = document.createElement('article');
  article.className = 'node';
  const heading = document.createElement('h3');
  heading.textContent = tab.title;
  const link = document.createElement('a');
  link.href = tab.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = tab.url;
  article.append(heading, link);
  const inspection = inspectUrl(tab.url);
  for (const message of inspection.warnings) {
    const warning = document.createElement('p');
    warning.className = 'warning';
    warning.textContent = message;
    article.append(warning);
  }
  const label = document.createElement('label');
  label.htmlFor = `note-${tab.id}`;
  label.textContent = 'Research note';
  const note = document.createElement('textarea');
  note.id = `note-${tab.id}`;
  note.maxLength = 2000;
  note.value = tab.note;
  note.placeholder = 'Why does this page matter?';
  note.addEventListener('input', () => {
    tab.note = note.value.slice(0, 2000);
    try {
      persist();
      renderOutline();
    } catch (error) {
      status(`Note remains in this page but local save failed: ${error.message}`);
    }
  });
  article.append(label, note);
  return article;
}

function renderMap() {
  elements.map.replaceChildren();
  const generatedNames = new Map(clusterTabs(project.tabs).map((cluster) => [cluster.id, cluster.name]));
  project.clusters.forEach((cluster, index) => {
    const section = document.createElement('section');
    section.className = 'cluster';
    const name = document.createElement('input');
    name.className = 'cluster-name';
    name.value = cluster.name;
    name.maxLength = 120;
    name.setAttribute('aria-label', `Cluster ${index + 1} name`);
    // Clearing a name returns the cluster to the name Tabloom generated for it.
    name.addEventListener('blur', () => {
      if (!name.value.trim()) name.value = cluster.name;
    });
    name.addEventListener('input', () => {
      cluster.name = name.value.trim() ? name.value.slice(0, 120) : generatedNames.get(cluster.id) ?? `Cluster ${index + 1}`;
      try {
        persist();
        renderOutline();
      } catch (error) {
        status(`Cluster name remains in this page but local save failed: ${error.message}`);
      }
    });
    const rationale = document.createElement('p');
    rationale.className = 'rationale';
    rationale.textContent = cluster.rationale;
    section.append(name, rationale);
    for (const tab of cluster.tabs) section.append(nodeElement(tab));
    elements.map.append(section);
  });
}

function renderOutline() {
  elements.outline.replaceChildren();
  for (const cluster of project.clusters) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = cluster.name;
    const rationale = document.createElement('p');
    rationale.textContent = cluster.rationale;
    const list = document.createElement('ol');
    for (const tab of cluster.tabs) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = tab.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = tab.title;
      item.append(link);
      if (tab.note) {
        const note = document.createElement('p');
        note.textContent = tab.note;
        item.append(note);
      }
      list.append(item);
    }
    section.append(heading, rationale, list);
    elements.outline.append(section);
  }
}

function renderProject() {
  elements.empty.hidden = project.tabs.length > 0;
  showView();
  elements.exportButton.disabled = project.tabs.length === 0;
  renderMap();
  renderOutline();
  elements.mapSummary.textContent = `${project.tabs.length} selected tabs in ${project.clusters.length} explainable ${project.clusters.length === 1 ? 'cluster' : 'clusters'}.`;
}

function showView() {
  elements.mapViewButton.setAttribute('aria-pressed', String(!outlineSelected));
  elements.outlineViewButton.setAttribute('aria-pressed', String(outlineSelected));
  elements.mapViewButton.classList.toggle('selected', !outlineSelected);
  elements.outlineViewButton.classList.toggle('selected', outlineSelected);
  elements.map.hidden = outlineSelected || project.tabs.length === 0;
  elements.outline.hidden = !outlineSelected || project.tabs.length === 0;
}

function switchView(outline) {
  outlineSelected = outline;
  showView();
}

function openDialog() {
  // A finished job's status would otherwise linger in the dialog the next time it opens.
  elements.dialogStatus.hidden = !activeController;
  elements.dialog.showModal();
}

function download(content, extension, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `tabloom-map.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking the address straight after the click can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

async function reviewExport() {
  const review = await runJob('reviewing export-sensitive fields', async () => ({
    queries: project.tabs.filter((tab) => inspectUrl(tab.url).hasQuery).length,
    fragments: project.tabs.filter((tab) => inspectUrl(tab.url).hasFragment).length,
    credentials: project.tabs.filter((tab) => inspectUrl(tab.url).hasCredentials).length,
    local: project.tabs.filter((tab) => inspectUrl(tab.url).local).length,
    notes: project.tabs.filter((tab) => tab.note).length,
    duplicates: duplicateGroups(project.tabs).length
  }));
  if (!review) return;
  elements.review.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'review-list';
  for (const text of [
    `${review.queries} addresses contain query strings${elements.stripQuery.checked ? ' and they will be stripped' : ' and they will be retained'}.`,
    `${review.fragments} addresses contain fragments${elements.stripQuery.checked ? ' and they will be stripped' : ' and they will be retained'}.`,
    `${review.credentials} addresses contain embedded credentials; credentials are removed from every export.`,
    `${review.local} local or private-network addresses will be present.`,
    `${review.notes} user notes will be present.`,
    `${review.duplicates} duplicate address groups were detected.`
  ]) {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  }
  const boundary = document.createElement('p');
  boundary.textContent = 'Exports include only this confirmed selected-tab dataset. They do not include page bodies, cookies, form values or browsing history.';
  const actions = document.createElement('div');
  actions.className = 'export-options';
  for (const [label, format, extension, type] of [
    ['Download Markdown outline', 'markdown', 'md', 'text/markdown;charset=utf-8'],
    ['Download JSON map', 'json', 'json', 'application/json;charset=utf-8'],
    ['Download self-contained HTML', 'html', 'html', 'text/html;charset=utf-8']
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', async () => {
      const output = await runJob(`preparing ${format} export`, async () => exportMap({ ...project, name: elements.name.value }, format, { stripQuery: elements.stripQuery.checked }));
      if (output) download(output, extension, type);
    });
    actions.append(button);
  }
  elements.review.append(list, boundary, actions);
  openDialog();
}

document.querySelector('#preview-import').addEventListener('click', async () => {
  const sourceText = elements.dataset.value;
  const imported = await runJob('validating selected-tab fields', async () => parseDataset(sourceText));
  if (imported) {
    pendingImport = imported;
    pendingSource = sourceText;
    renderPreview(imported);
  }
});
document.querySelector('#load-sample').addEventListener('click', () => {
  invalidateImportPreview('');
  elements.dataset.value = JSON.stringify(sampleTabs, null, 2);
  status('Synthetic fixture loaded. Preview it before confirming.');
  elements.dataset.focus();
});
elements.file.addEventListener('change', async () => {
  const file = elements.file.files?.[0];
  if (!file) return;
  elements.file.value = '';
  const text = await runJob('reading local JSON file', async () => {
    if (file.size > 300_000) throw new RangeError('The JSON file is limited to 300,000 bytes.');
    return file.text();
  });
  if (text !== null) {
    invalidateImportPreview('');
    elements.dataset.value = text;
    status('Local JSON loaded. Preview its fields before confirming.');
  }
});
document.querySelector('#confirm-import').addEventListener('click', async () => {
  if (pendingSource !== elements.dataset.value) {
    invalidateImportPreview('The import source changed after preview. Preview the current fields before confirming.');
    return;
  }
  const built = await runJob('building explainable clusters', async () => buildProject({ ...pendingImport, name: pendingImport.name || elements.name.value }));
  if (!built) return;
  project = built;
  elements.name.value = project.name;
  try {
    persist();
    renderProject();
    elements.preview.hidden = true;
    status(`Confirmed ${project.tabs.length} selected tabs. The map is stored locally.`);
  } catch (error) {
    status(`The map is available in this page but local storage failed: ${error.message}`);
    renderProject();
  }
});
elements.dataset.addEventListener('input', () => invalidateImportPreview());
elements.name.addEventListener('input', () => {
  if (project.tabs.length) {
    try { persist(); } catch (error) { status(`Map name remains in this page but local save failed: ${error.message}`); }
  }
});
elements.mapViewButton.addEventListener('click', () => switchView(false));
elements.outlineViewButton.addEventListener('click', () => switchView(true));
elements.exportButton.addEventListener('click', reviewExport);
document.querySelector('#privacy-button').addEventListener('click', () => {
  elements.review.replaceChildren();
  const text = document.createElement('p');
  text.textContent = project.tabs.length
    ? `This local map currently contains ${project.tabs.length} selected titles, addresses, opener relationships and user notes. It contains no page bodies, cookies, form values or full browsing history.`
    : 'No dataset is stored. This prototype reads only JSON that you explicitly paste or choose.';
  elements.review.append(text);
  openDialog();
});
elements.cancel.addEventListener('click', () => activeController?.abort());
elements.dialogCancel.addEventListener('click', () => activeController?.abort());

restore();
