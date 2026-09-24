// Synthetic research session behind "Use synthetic fixture". fixtures/selected-tabs.json holds the same data.
export const sampleTabs = [
  { id: 'storage-root', title: 'Web Storage overview', url: 'https://developer.example.test/storage?campaign=demo', capturedAt: '2026-07-24T01:00:00Z' },
  { id: 'idb', title: 'Indexed database specification', url: 'https://standards.example.test/indexed-db', openerId: 'storage-root' },
  { id: 'quota', title: 'Storage quotas and eviction', url: 'https://developer.example.test/storage/quota', openerId: 'storage-root' },
  { id: 'issue', title: 'Quota behaviour discussion', url: 'https://issues.example.test/browser/184?session=synthetic', openerId: 'quota' },
  { id: 'privacy', title: 'Storage privacy considerations', url: 'https://privacy.example.test/browser-storage', note: 'Compare partitioning language.' },
  { id: 'local', title: 'Local test harness', url: 'http://localhost:8080/storage-harness?token=example-only' }
];
