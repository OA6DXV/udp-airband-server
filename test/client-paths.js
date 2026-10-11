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

const multiSource = fs.readFileSync(path.join(__dirname, '../assets/multi.js'), 'utf8');
const multiTranslations = vm.runInNewContext(multiSource.match(/const translations = [\s\S]*?\n};/)[0] + '\ntranslations');
for (const language of ['en', 'es']) {
  assert.equal(multiTranslations[language].realTimeMode, 'RAW Audio');
  assert.equal(multiTranslations[language].compatibleMode, 'Normal Mode');
  assert.equal(multiTranslations[language].realTimeNoticeTitle, 'RAW Audio');
  assert.equal(multiTranslations[language].compatibleNoticeTitle, 'Normal Mode');
}
const multiRouteSetup = multiSource.match(/const configuredBasePath = [\s\S]*?(?=const allStreams =)/)?.[0];
assert.ok(multiRouteSetup, 'multistream route setup must exist');
const multiWsProtocol = multiSource.match(/function wsProtocol\(\) \{[^}]+\}/)?.[0];
assert.ok(multiWsProtocol, 'multistream WebSocket protocol helper must exist');

function resolveMultiRoutes(baseHref, pathname, protocol = 'https:') {
  const location = { origin: `${protocol}//liveatc.example`, protocol, host: 'liveatc.example', pathname };
  const document = {
    // CSP base-uri 'none' leaves baseURI pointing at /multi, not the application root.
    baseURI: `${location.origin}${pathname}?streams=testing,aqp-twr`,
    querySelector: () => baseHref === null ? null : { getAttribute: () => baseHref },
  };
  return JSON.parse(JSON.stringify(vm.runInNewContext(
    multiRouteSetup + multiWsProtocol + `\n({
      appBasePath,
      control: appWebSocketUrl('testing/control'),
      audio: appWebSocketUrl('testing/audio'),
      adpcm: appWebSocketUrl('testing/adpcm'),
      secondControl: appWebSocketUrl('aqp-twr/control'),
      nativeAudio: appPath('multi/native.aac'),
      nativeGain: appPath('/multi/native-gain'),
      home: appPath(''),
    })`,
    { URL, document, location },
  )));
}

function expectedMultiRoutes(basePath, wsProtocol = 'wss') {
  return {
    appBasePath: basePath,
    control: `${wsProtocol}://liveatc.example${basePath}testing/control`,
    audio: `${wsProtocol}://liveatc.example${basePath}testing/audio`,
    adpcm: `${wsProtocol}://liveatc.example${basePath}testing/adpcm`,
    secondControl: `${wsProtocol}://liveatc.example${basePath}aqp-twr/control`,
    nativeAudio: `${basePath}multi/native.aac`,
    nativeGain: `${basePath}multi/native-gain`,
    home: basePath,
  };
}

assert.deepEqual(resolveMultiRoutes('/', '/multi'), expectedMultiRoutes('/'));
assert.deepEqual(resolveMultiRoutes('/', '/multi/'), expectedMultiRoutes('/'));
assert.deepEqual(resolveMultiRoutes(null, '/multi'), expectedMultiRoutes('/'));
assert.deepEqual(resolveMultiRoutes('/development/', '/development/multi'), expectedMultiRoutes('/development/'));
assert.deepEqual(resolveMultiRoutes('/development', '/development/multi'), expectedMultiRoutes('/development/'));
assert.deepEqual(resolveMultiRoutes('/', '/multi', 'http:'), expectedMultiRoutes('/', 'ws'));

console.log('Client path tests passed');
