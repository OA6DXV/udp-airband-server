'use strict';

const assert = require('node:assert/strict');
const { loadStreamsFromConfig } = require('../lib/streams');

const sections = ['arequipa', 'cusco', 'pisco'].map((id) => ({ id, name: id }));
const streams = [
  ['cusco-app', 'cusco'], ['ungrouped-a', ''], ['arequipa-twr', 'arequipa'],
  ['pisco-twr', 'pisco'], ['cusco-twr', 'cusco'], ['arequipa-gnd', 'arequipa'],
  ['ungrouped-b', ''],
].map(([name, sectionId], index) => ({ name, sectionId, udpPort: 9000 + index, sampleRate: 8000, channels: 1 }));

const names = (items, groups = sections) => loadStreamsFromConfig({ sections: groups, streams: items }, { defaultUdpHost: '0.0.0.0' }).map((stream) => stream.name);
const original = JSON.stringify(streams);
assert.deepEqual(names(streams), ['arequipa-twr', 'arequipa-gnd', 'cusco-app', 'cusco-twr', 'pisco-twr', 'ungrouped-a', 'ungrouped-b']);
assert.deepEqual(names(streams, [sections[2], sections[0], sections[1]]), ['pisco-twr', 'arequipa-twr', 'arequipa-gnd', 'cusco-app', 'cusco-twr', 'ungrouped-a', 'ungrouped-b']);
assert.deepEqual(names([...streams].reverse()), ['arequipa-gnd', 'arequipa-twr', 'cusco-twr', 'cusco-app', 'pisco-twr', 'ungrouped-b', 'ungrouped-a']);
assert.equal(JSON.stringify(streams), original, 'normalization must not mutate the supplied configuration');
assert.deepEqual(names(streams.map((stream) => ({ ...stream, sectionId: '' })), []), streams.map((stream) => stream.name));
assert.throws(() => names([...streams, { ...streams[0], sectionId: 'missing' }]), /Unknown section ID/);
console.log('Section order, stable internal order, unsectioned placement and invalid assignments passed');
