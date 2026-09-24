export const MAX_TABS = 100;
const MAX_TITLE = 300;
const MAX_URL = 2_048;
const MAX_NOTE = 2_000;

export function datasetDigest(value) {
  if (typeof value !== 'string') throw new TypeError('The import source must be text.');
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function boundedString(value, label, maximum, required = false) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new TypeError(`${label} must be text.`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) throw new RangeError(`${label} cannot be empty.`);
  if (trimmed.length > maximum) throw new RangeError(`${label} exceeds ${maximum} characters.`);
  return trimmed;
}

// Blank text falls back to a default instead of failing validation; other types still fail.
function blankToEmpty(value) {
  return typeof value === 'string' ? value.trim() : value;
}

// Browser tab APIs report tab ids as numbers.
function idText(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
}

function clip(text, maximum) {
  if (text.length <= maximum) return text;
  const clipped = text.slice(0, maximum - 1).replace(/[\uD800-\uDBFF]$/u, '');
  return `${clipped.trimEnd()}…`;
}

export function normaliseUrl(value) {
  const raw = boundedString(value, 'URL', MAX_URL, true);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RangeError(`Invalid URL: ${raw.slice(0, 80)}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new RangeError('Only HTTP and HTTPS tab addresses are accepted.');
  return parsed.href;
}

export function validateTabDataset(value) {
  if (!Array.isArray(value)) throw new TypeError('The imported dataset must be a JSON array.');
  if (value.length === 0) throw new RangeError('Select at least one tab before import.');
  if (value.length > MAX_TABS) throw new RangeError(`At most ${MAX_TABS} selected tabs can be imported.`);
  const suppliedIds = new Set(value.map((candidate) => blankToEmpty(idText(candidate?.id))).filter((id) => typeof id === 'string'));
  const ids = new Set();
  const tabs = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError(`Tab ${index + 1} must be an object.`);
    let generatedId = `tab-${index + 1}`;
    for (let suffix = 2; suppliedIds.has(generatedId); suffix += 1) generatedId = `tab-${index + 1}-${suffix}`;
    const id = boundedString(idText(candidate.id) ?? generatedId, `Tab ${index + 1} id`, 100, true);
    if (ids.has(id)) throw new RangeError(`Duplicate tab id: ${id}`);
    ids.add(id);
    return {
      id,
      title: boundedString(blankToEmpty(candidate.title) || 'Untitled page', `Tab ${index + 1} title`, MAX_TITLE, true),
      url: normaliseUrl(candidate.url),
      openerId: boundedString(idText(candidate.openerId), `Tab ${index + 1} openerId`, 100),
      note: boundedString(candidate.note, `Tab ${index + 1} note`, MAX_NOTE),
      capturedAt: boundedString(candidate.capturedAt, `Tab ${index + 1} capturedAt`, 80)
    };
  });
  return tabs.map((tab) => ({ ...tab, openerId: ids.has(tab.openerId) ? tab.openerId : '' }));
}

function classifyIpv4(hostname) {
  const parts = hostname.split('.');
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || !octets.every((part, index) => Number.isInteger(part) && part >= 0 && part <= 255 && String(part) === parts[index])) return 'public';
  const [first, second] = octets;
  if (first === 127 || first === 0) return 'loopback-or-unspecified';
  if (first === 169 && second === 254) return 'link-local';
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127)) return 'private';
  return 'public';
}

// Names that only resolve on a local network: RFC 6761, RFC 6762, RFC 8375, ICANN's private-use .internal,
// and the undelegated suffixes most often used on home and office networks.
const LOCAL_NAME_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa', 'lan', 'home', 'corp'];

function isLocalName(hostname) {
  return !hostname.includes('.') || LOCAL_NAME_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

export function inspectUrl(value) {
  const url = new URL(normaliseUrl(value));
  const hostname = url.hostname.replace(/^\[|\]$/gu, '').replace(/\.+$/u, '').toLocaleLowerCase('en-AU');
  let networkScope = 'public';
  if (/^[\d.]+$/u.test(hostname)) {
    networkScope = classifyIpv4(hostname);
  } else if (!hostname.includes(':')) {
    networkScope = isLocalName(hostname) ? 'local-name' : 'public';
  } else {
    const firstGroup = Number.parseInt(hostname.split(':')[0] || '0', 16);
    if (hostname === '::' || hostname === '::1') networkScope = 'IPv6 loopback-or-unspecified';
    else if ((firstGroup & 0xfe00) === 0xfc00) networkScope = 'IPv6 unique-local';
    else if ((firstGroup & 0xffc0) === 0xfe80) networkScope = 'IPv6 link-local';
    else if (hostname.startsWith('::ffff:')) {
      const mapped = hostname.slice('::ffff:'.length);
      let mappedAddress = mapped;
      if (!mapped.includes('.')) {
        const groups = mapped.split(':').filter(Boolean);
        const high = Number.parseInt(groups.at(-2) ?? '0', 16);
        const low = Number.parseInt(groups.at(-1) ?? '0', 16);
        if (Number.isFinite(high) && Number.isFinite(low)) mappedAddress = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
      }
      const mappedScope = classifyIpv4(mappedAddress);
      networkScope = mappedScope === 'public' ? 'public' : `IPv4-mapped ${mappedScope}`;
    }
  }
  const hasCredentials = Boolean(url.username || url.password);
  const local = networkScope !== 'public';
  return {
    hostname: url.hostname,
    hasQuery: Boolean(url.search),
    hasFragment: Boolean(url.hash),
    hasCredentials,
    networkScope,
    local,
    warnings: [
      ...(url.search ? ['Query string may contain identifiers or secrets.'] : []),
      ...(url.hash ? ['Fragment identifier will disclose an in-page location if retained.'] : []),
      ...(hasCredentials ? ['Embedded URL credentials are sensitive and will be removed from every export.'] : []),
      ...(local ? [`${networkScope} address may expose local infrastructure and may not work for recipients.`] : [])
    ]
  };
}

export function privacySafeUrl(value, stripQuery = true) {
  const url = new URL(normaliseUrl(value));
  url.username = '';
  url.password = '';
  if (stripQuery) {
    url.search = '';
    url.hash = '';
  }
  return url.href;
}

function rootFor(tab, byId, order) {
  const path = [];
  const positions = new Map();
  let current = tab;
  while (true) {
    positions.set(current.id, path.length);
    path.push(current);
    const opener = byId.get(current.openerId);
    if (!opener) return current;
    if (positions.has(opener.id)) {
      // Every tab that reaches an opener cycle shares its earliest member as the root.
      return path.slice(positions.get(opener.id)).reduce((earliest, member) => (order.get(member.id) < order.get(earliest.id) ? member : earliest));
    }
    current = opener;
  }
}

export function clusterTabs(value) {
  const tabs = validateTabDataset(value);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const order = new Map(tabs.map((tab, index) => [tab.id, index]));
  const roots = new Map(tabs.map((tab) => [tab.id, rootFor(tab, byId, order)]));
  const lineageCounts = new Map();
  for (const root of roots.values()) lineageCounts.set(root.id, (lineageCounts.get(root.id) ?? 0) + 1);
  const clusters = new Map();
  for (const tab of tabs) {
    const root = roots.get(tab.id);
    const url = new URL(tab.url);
    const followsLineage = (lineageCounts.get(root.id) ?? 0) > 1;
    const key = followsLineage ? `lineage:${root.id}` : `host:${url.hostname}`;
    if (!clusters.has(key)) {
      clusters.set(key, {
        id: key,
        name: clip(followsLineage ? root.title : url.hostname, 120),
        rationale: followsLineage
          ? `Grouped because these tabs descend from “${root.title}” through opened-from relationships.`
          : `Grouped because these tabs share the exact host ${url.hostname}.`,
        basis: followsLineage ? 'navigation lineage' : 'exact host',
        tabs: []
      });
    }
    clusters.get(key).tabs.push(tab);
  }
  return [...clusters.values()];
}

export function restoreProject(stored) {
  if (!stored || typeof stored !== 'object') throw new TypeError('The stored map must be an object.');
  const storedClusters = Array.isArray(stored.clusters) ? stored.clusters.filter((cluster) => cluster && typeof cluster === 'object') : [];
  // Earlier versions saved note edits made after a reload only on the cluster copies of each tab.
  const clusterNotes = new Map(storedClusters.flatMap((cluster) => (Array.isArray(cluster.tabs) ? cluster.tabs : []))
    .filter((tab) => tab && typeof tab.id === 'string' && typeof tab.note === 'string')
    .map((tab) => [tab.id, tab.note]));
  const storedTabs = Array.isArray(stored.tabs)
    ? stored.tabs.map((tab) => (tab && typeof tab === 'object' && clusterNotes.has(tab.id) ? { ...tab, note: clusterNotes.get(tab.id) } : tab))
    : stored.tabs;
  const names = new Map(storedClusters.filter((cluster) => typeof cluster.name === 'string').map((cluster) => [cluster.id, cluster.name.slice(0, 120)]));
  const clusters = clusterTabs(storedTabs).map((cluster) => ({ ...cluster, name: names.get(cluster.id) ?? cluster.name }));
  return {
    version: 1,
    name: (typeof stored.name === 'string' && stored.name.trim().slice(0, 120)) || 'Untitled investigation',
    tabs: clusters.flatMap(({ tabs }) => tabs),
    clusters
  };
}

export function duplicateGroups(value) {
  const tabs = validateTabDataset(value);
  const groups = new Map();
  for (const tab of tabs) {
    const canonical = privacySafeUrl(tab.url, false);
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical).push(tab.id);
  }
  return [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([url, ids]) => ({ url, ids }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function escapeMarkdown(value) {
  return String(value)
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/([\\`*_{}\[\]()<>#+.!|>-])/gu, '\\$1');
}

function markdownDestination(value) {
  const encoded = { '<': '%3C', '>': '%3E', '(': '%28', ')': '%29', '\\': '%5C' };
  return `<${String(value).replace(/[<>()\\]/gu, (character) => encoded[character])}>`;
}

export function exportMap(project, format, options = {}) {
  if (!project || typeof project !== 'object') throw new TypeError('A project is required for export.');
  const tabs = validateTabDataset(project.tabs);
  const clusterSource = Array.isArray(project.clusters) ? project.clusters : clusterTabs(tabs);
  const stripQuery = options.stripQuery !== false;
  const title = boundedString(blankToEmpty(project.name) || 'Untitled investigation', 'Map name', 120, true);
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const clusters = clusterSource.map((cluster, index) => ({
    id: boundedString(blankToEmpty(cluster.id) || `cluster-${index + 1}`, 'Cluster id', 300, true),
    name: boundedString(blankToEmpty(cluster.name) || `Cluster ${index + 1}`, 'Cluster name', 120, true),
    rationale: boundedString(blankToEmpty(cluster.rationale) || 'Manually arranged by the user.', 'Cluster rationale', 500, true),
    tabs: (cluster.tabs ?? []).map((item) => tabById.get(typeof item === 'string' ? item : item.id)).filter(Boolean)
  }));
  const safeClusters = clusters.map((cluster) => ({
    ...cluster,
    tabs: cluster.tabs.map((tab) => ({ ...tab, url: privacySafeUrl(tab.url, stripQuery) }))
  }));

  if (format === 'json') return JSON.stringify({ version: 1, name: title, clusters: safeClusters }, null, 2);
  if (format === 'markdown') {
    const lines = [`# ${escapeMarkdown(title)}`, '', `Exported from an explicitly imported set of ${tabs.length} selected tabs.`, ''];
    for (const cluster of safeClusters) {
      lines.push(`## ${escapeMarkdown(cluster.name)}`, '', `Grouping basis: ${escapeMarkdown(cluster.rationale)}`, '');
      for (const tab of cluster.tabs) {
        lines.push(`- [${escapeMarkdown(tab.title)}](${markdownDestination(tab.url)})${tab.note ? ` — ${escapeMarkdown(tab.note)}` : ''}`);
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  }
  if (format === 'html') {
    const sections = safeClusters.map((cluster) => `<section><h2>${escapeHtml(cluster.name)}</h2><p>${escapeHtml(cluster.rationale)}</p><ul>${cluster.tabs.map((tab) => `<li><a href="${escapeHtml(tab.url)}">${escapeHtml(tab.title)}</a>${tab.note ? `<p>${escapeHtml(tab.note)}</p>` : ''}</li>`).join('')}</ul></section>`).join('');
    return `<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{max-width:54rem;margin:3rem auto;padding:0 1rem;font:16px/1.55 system-ui;color:#17233a}section{border-top:2px solid #17233a;padding:1rem 0}a{color:#76451b}p{max-width:70ch}</style><main><h1>${escapeHtml(title)}</h1><p>Local static export from ${tabs.length} explicitly selected tabs.</p>${sections}</main></html>`;
  }
  throw new RangeError('Unsupported map export format.');
}
