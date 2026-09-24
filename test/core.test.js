import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clusterTabs, duplicateGroups, exportMap, inspectUrl, restoreProject, validateTabDataset } from '../src/core.js';
import { sampleTabs } from '../src/sample.js';

const tabs = [
  { id: 'root', title: 'Storage guide', url: 'https://docs.example.test/storage?utm_source=fixture' },
  { id: 'child', title: 'Quota guide', url: 'https://docs.example.test/storage/quota', openerId: 'root', note: 'Check eviction details.' },
  { id: 'other', title: '<Browser issue>', url: 'https://issues.example.test/42?token=synthetic' }
];

test('selected tab datasets are bounded and normalised', () => {
  const result = validateTabDataset(tabs);
  assert.equal(result.length, 3);
  assert.equal(result[1].openerId, 'root');
  assert.throws(() => validateTabDataset([]), /at least one/i);
  assert.throws(() => validateTabDataset([{ id: 'x', title: 'File', url: 'file:///tmp/x' }]), /HTTP and HTTPS/i);
});

test('clustering exposes navigation-lineage and exact-host rationales', () => {
  const clusters = clusterTabs(tabs);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0].tabs.map(({ id }) => id), ['root', 'child']);
  assert.match(clusters[0].rationale, /opened-from/i);
  assert.match(clusters[1].rationale, /exact host/i);
});

test('URL inspection identifies privacy-sensitive query and local addresses', () => {
  assert.equal(inspectUrl(tabs[0].url).hasQuery, true);
  assert.equal(inspectUrl('http://localhost:8080/test').local, true);
  assert.equal(inspectUrl('http://localhost./test').networkScope, 'local-name');
  assert.equal(inspectUrl('http://dev.local./test').networkScope, 'local-name');
  assert.equal(inspectUrl('http://172.31.2.4/test').networkScope, 'private');
  assert.equal(inspectUrl('http://169.254.2.4/test').networkScope, 'link-local');
  assert.equal(inspectUrl('http://[fd12::1]/test').networkScope, 'IPv6 unique-local');
  assert.equal(inspectUrl('http://[fe80::1]/test').networkScope, 'IPv6 link-local');
  assert.match(inspectUrl('http://[::ffff:127.0.0.1]/test').networkScope, /IPv4-mapped loopback/);
  const sensitive = inspectUrl('https://person:secret@example.test/path?q=1#section');
  assert.equal(sensitive.hasCredentials, true);
  assert.equal(sensitive.hasFragment, true);
  assert.equal(sensitive.warnings.length, 3);
});

test('default exports strip queries and safely escape hostile captured titles', () => {
  const project = { name: 'Storage research', tabs, clusters: clusterTabs(tabs) };
  const json = exportMap(project, 'json');
  const html = exportMap(project, 'html');
  assert.doesNotMatch(json, /utm_source|token=synthetic/);
  assert.doesNotMatch(html, /<Browser issue>/);
  assert.match(html, /&lt;Browser issue&gt;/);
  assert.match(exportMap(project, 'markdown'), /Grouping basis:/);
});

test('Markdown export neutralises authored syntax and removes URL credentials', () => {
  const hostile = [{ id: 'one', title: '[label](javascript:alert(1))', url: 'https://user:secret@example.test/a_(b)?keep=yes#part', note: '# heading\n- item' }];
  const markdown = exportMap({ name: '# Map', tabs: hostile, clusters: clusterTabs(hostile) }, 'markdown', { stripQuery: false });
  assert.doesNotMatch(markdown, /user:secret/);
  assert.doesNotMatch(markdown, /\]\(javascript:/);
  assert.match(markdown, /\\# Map/);
  assert.match(markdown, /%28b%29/);
});

test('duplicate detection reports exact normalised addresses', () => {
  const duplicated = [...tabs, { id: 'copy', title: 'Copy', url: tabs[2].url }];
  assert.deepEqual(duplicateGroups(duplicated)[0].ids, ['other', 'copy']);
});

test('restored maps keep note edits across reloads and in exports', () => {
  const saved = JSON.parse(JSON.stringify({ name: 'Saved map', tabs, clusters: clusterTabs(tabs).map((cluster) => ({ ...cluster, name: `Renamed ${cluster.name}` })) }));
  const restored = restoreProject(saved);
  const child = restored.clusters[0].tabs.find(({ id }) => id === 'child');
  assert.equal(child, restored.tabs.find(({ id }) => id === 'child'));
  child.note = 'Edited after reload.';
  assert.match(exportMap(restored, 'json'), /Edited after reload\./);
  const reloaded = restoreProject(JSON.parse(JSON.stringify(restored)));
  assert.equal(reloaded.tabs.find(({ id }) => id === 'child').note, 'Edited after reload.');
  assert.equal(reloaded.name, 'Saved map');
  assert.deepEqual(reloaded.clusters.map(({ name }) => name), ['Renamed Storage guide', 'Renamed issues.example.test']);
});

test('restoring recovers notes that earlier versions saved only on cluster copies', () => {
  const saved = JSON.parse(JSON.stringify({ name: 'Saved map', tabs, clusters: clusterTabs(tabs) }));
  saved.clusters[0].tabs[1].note = 'Only saved on the cluster copy.';
  assert.equal(restoreProject(saved).tabs.find(({ id }) => id === 'child').note, 'Only saved on the cluster copy.');
  assert.throws(() => restoreProject(null), /must be an object/);
});

test('opener cycles form one lineage rooted at the earliest tab in the cycle', () => {
  const cyclic = [
    { id: 'a', title: 'A', url: 'https://a.example.test/', openerId: 'b' },
    { id: 'b', title: 'B', url: 'https://b.example.test/', openerId: 'a' },
    { id: 'c', title: 'C', url: 'https://c.example.test/', openerId: 'a' }
  ];
  const clusters = clusterTabs(cyclic);
  assert.deepEqual(clusters.map(({ id }) => id), ['lineage:a']);
  assert.deepEqual(clusters[0].tabs.map(({ id }) => id), ['a', 'b', 'c']);
  assert.deepEqual(clusterTabs([...cyclic].reverse()).map(({ id }) => id), ['lineage:b']);
  assert.deepEqual(clusterTabs([{ id: 'self', title: 'Self', url: 'https://a.example.test/', openerId: 'self' }]).map(({ id }) => id), ['host:a.example.test']);
});

test('URL inspection flags private-network names and leaves public names alone', () => {
  for (const address of ['http://nas.lan/', 'http://intranet.corp/', 'http://router.home.arpa/', 'http://build.internal/', 'http://media.home/', 'http://printer/']) {
    assert.equal(inspectUrl(address).networkScope, 'local-name', address);
  }
  for (const address of ['https://example.com/', 'https://docs.example.test/', 'https://lan.example.com/', 'https://corp.example.org/']) {
    assert.equal(inspectUrl(address).local, false, address);
  }
  assert.equal(inspectUrl('http://10.1.2.3/').networkScope, 'private');
  assert.equal(inspectUrl('http://0x7f.1/').networkScope, 'loopback-or-unspecified');
});

test('long root titles and host names still cluster and export', () => {
  const host = `${'sub'.repeat(40)}.example.test`;
  const long = [
    { id: 'root', title: 'T'.repeat(300), url: 'https://a.example.test/' },
    { id: 'child', title: 'Child', url: 'https://a.example.test/child', openerId: 'root' },
    { id: 'far', title: 'Far', url: `https://${host}/` },
    { id: 'emoji', title: '😀'.repeat(100), url: 'https://b.example.test/' },
    { id: 'reply', title: 'Reply', url: 'https://b.example.test/reply', openerId: 'emoji' }
  ];
  const clusters = clusterTabs(long);
  assert.deepEqual(clusters.map(({ name }) => name.length <= 120 && name.endsWith('…')), [true, true, true]);
  assert.ok(clusters[2].name.isWellFormed());
  assert.equal(clusters[1].id, `host:${host}`);
  for (const format of ['json', 'markdown', 'html']) assert.doesNotThrow(() => exportMap({ name: 'Long names', tabs: long, clusters }, format), format);
});

test('validation accepts numeric ids, blank titles and ids that clash with generated ones', () => {
  const result = validateTabDataset([
    { id: 'tab-2', title: '   ', url: 'https://a.example.test/' },
    { title: 'Second', url: 'https://b.example.test/' },
    { id: 41, title: 'Numbered', url: 'https://c.example.test/' },
    { id: 42, title: 'Child', url: 'https://c.example.test/child', openerId: 41 }
  ]);
  assert.equal(result[0].title, 'Untitled page');
  assert.equal(result[1].id, 'tab-2-2');
  assert.deepEqual(result.slice(2).map(({ id, openerId }) => [id, openerId]), [['41', ''], ['42', '41']]);
  assert.throws(() => validateTabDataset([{ id: 'x', title: 7, url: 'https://a.example.test/' }]), /title must be text/);
  assert.throws(() => validateTabDataset([{ id: 'x', url: 'https://a.example.test/' }, { id: 'x', url: 'https://b.example.test/' }]), /Duplicate tab id: x/);
});

test('blank map and cluster names export with defaults', () => {
  const clusters = clusterTabs(tabs).map((cluster) => ({ ...cluster, name: '   ' }));
  const exported = JSON.parse(exportMap({ name: '  ', tabs, clusters }, 'json'));
  assert.equal(exported.name, 'Untitled investigation');
  assert.deepEqual(exported.clusters.map(({ name }) => name), ['Cluster 1', 'Cluster 2']);
  assert.equal(restoreProject({ name: '  ', tabs }).name, 'Untitled investigation');
});

test('the fixture file matches the in-app synthetic sample', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/selected-tabs.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture, sampleTabs);
  assert.deepEqual(clusterTabs(fixture).map(({ id }) => id), ['lineage:storage-root', 'host:privacy.example.test', 'host:localhost']);
});
