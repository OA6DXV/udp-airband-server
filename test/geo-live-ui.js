'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function run() {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const node = {
      attributes: {}, listeners: {}, children: [], value: '', hidden: false,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); },
      append(...children) { this.children.push(...children); },
    };
    elements.set(id, node);
    return node;
  }
  const requests = [];
  const timers = new Map();
  const draws = [];
  let timerId = 0, instances = 0, loads = 0, select;
  const google = {
    charts: { load() { loads += 1; }, setOnLoadCallback(callback) { callback(); } },
    visualization: {
      DataTable: class {
        addColumn() {}
        addRows(rows) { this.rows = rows; }
        setFormattedValue() {}
      },
      GeoChart: class {
        constructor() { instances += 1; }
        draw(data) { draws.push(data.rows); }
        getSelection() { return [{ row: 0 }]; }
      },
      events: { addListener(chart, name, callback) { select = callback; } },
    },
  };
  const context = vm.createContext({
    AbortController, google,
    document: {
      documentElement: {}, getElementById: element,
      querySelector: element, querySelectorAll: () => [], createElement: () => element(Symbol()),
    },
    window: { google, addEventListener() {}, location: { replace() { throw new Error('Unexpected redirect'); } } },
    localStorage: { getItem: () => 'en', setItem() {} },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      if (url === '/api/auth/status') return Promise.resolve({ ok: true, json: async () => ({ authenticated: true }) });
      return new Promise((resolve) => requests.push({ url, options, resolve }));
    },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const complete = async (request, countries) => {
    request.resolve({ ok: true, status: 200, json: async () => ({ countries }) });
    await flush();
  };
  const country = { code: 'PE', country: 'Peru', listeners: 2, topCities: [{ city: 'Lima', listeners: 2 }] };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../admin/users.js'), 'utf8'), context);
  await flush();
  assert.strictEqual(requests[0].url, '/api/users/geo');
  element('liveGeoButton').listeners.click();
  assert.strictEqual(requests[0].options.signal.aborted, true);
  assert.strictEqual(requests[1].url, '/api/users/geo?mode=live');
  assert.strictEqual(element('liveGeoButton').attributes['aria-pressed'], 'true');
  await complete(requests[1], [country]);
  await complete(requests[0], [{ ...country, listeners: 99 }]);
  assert.strictEqual(draws.at(-1)[0][1], 2, 'late historical response must not replace live counts');
  assert.strictEqual(loads, 1);
  select();
  assert.strictEqual(element('countryDetail').hidden, false);
  const [id, timer] = Array.from(timers).find(([, item]) => item.delay === 3000);
  timers.delete(id);
  timer.callback();
  await complete(requests[2], []);
  assert.strictEqual(element('countryDetail').hidden, true, 'disconnected country must clear the detail panel');
  assert.strictEqual(draws.at(-1).length, 0);
  assert.strictEqual(instances, 1, 'polling must reuse the chart and its selection listener');
  element('liveGeoButton').listeners.click();
  assert.strictEqual(requests[3].url, '/api/users/geo');
  assert.strictEqual(element('liveGeoButton').attributes['aria-pressed'], 'false');
  await complete(requests[3], [{ ...country, listeners: 99 }]);
  assert.strictEqual(draws.at(-1)[0][1], 99);
  assert(!Array.from(timers.values()).some((item) => item.delay === 3000), 'historical mode must stop live polling');
  console.log('Live geography UI polling, mode switching, stale response and empty map tests passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
