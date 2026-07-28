'use strict';

function aggregateGeoStats(records) {
  const countries = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const code = String(record && record.countryCode || '').trim().toUpperCase();
    const country = String(record && record.country || '').trim();
    const city = String(record && record.city || '').trim();
    if (!/^[A-Z]{2}$/.test(code) || !country || country === 'Local IP') continue;

    let entry = countries.get(code);
    if (!entry) {
      entry = {
        code,
        country,
        listeners: 0,
        cities: new Map(),
      };
      countries.set(code, entry);
    }

    entry.listeners += 1;
    if (city && city !== 'Local IP') {
      entry.cities.set(city, (entry.cities.get(city) || 0) + 1);
    }
  }

  const result = Array.from(countries.values(), (entry) => {
    const cities = Array.from(entry.cities, ([city, listeners]) => ({ city, listeners }))
      .sort((left, right) => (
        right.listeners - left.listeners
        || left.city.localeCompare(right.city, 'en')
      ));
    return {
      code: entry.code,
      country: entry.country,
      listeners: entry.listeners,
      topCities: cities.slice(0, 3),
    };
  }).sort((left, right) => (
    right.listeners - left.listeners
    || left.country.localeCompare(right.country, 'en')
  ));

  return {
    countries: result,
    totalListeners: result.reduce((sum, entry) => sum + entry.listeners, 0),
  };
}

module.exports = {
  aggregateGeoStats,
};
