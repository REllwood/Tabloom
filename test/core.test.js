import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterTabs, datasetDigest, duplicateGroups, exportMap, inspectUrl, restoreProject, validateTabDataset } from '../src/core.js';

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

test('dataset digests change whenever the reviewed source text changes', () => {
  assert.equal(datasetDigest('[1]'), datasetDigest('[1]'));
  assert.notEqual(datasetDigest('[1]'), datasetDigest('[1 ]'));
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
