'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const routeSetup = source.match(/const configuredBasePath = [\s\S]*?const streamName = [^\n]+;/)?.[0];
assert.ok(routeSetup, 'client route setup must exist');

function resolveRoutes(baseHref, pathname) {
  const location = {
    origin: 'https://liveatc.example',
    protocol: 'https:',
    host: 'liveatc.example',
    pathname,
  };
  const document = {
    // Safari may report the document path here; the explicit <base> is authoritative.
    baseURI: `https://liveatc.example${pathname}`,
    querySelector: () => baseHref === null ? null : { getAttribute: () => baseHref },
  };
  return vm.runInNewContext(
    routeSetup + '\n({ appBasePath, streamName, control: appWebSocketUrl(streamName + "/control"), audio: appWebSocketUrl(streamName + "/audio") })',
    { URL, document, location, decodeURIComponent },
  );
}

assert.deepEqual(
  JSON.parse(JSON.stringify(resolveRoutes('/', '/testing'))),
  {
    appBasePath: '/',
    streamName: 'testing',
    control: 'wss://liveatc.example/testing/control',
    audio: 'wss://liveatc.example/testing/audio',
  },
);
assert.equal(resolveRoutes('/opus/', '/opus/testing').control, 'wss://liveatc.example/opus/testing/control');
assert.equal(resolveRoutes('/opus', '/opus/testing').audio, 'wss://liveatc.example/opus/testing/audio');
assert.equal(resolveRoutes(null, '/testing').control, 'wss://liveatc.example/testing/control');

console.log('Client path tests passed');
