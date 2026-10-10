'use strict';

const path = require('path');

let native;
let loadError;
try {
  native = require(path.join(__dirname, '..', 'build', 'Release', 'opus_native.node'));
} catch (error) {
  loadError = error;
}

function isAvailable() {
  if (!native) return false;
  try {
    const encoder = native.createEncoder(8000, 1, 12000);
    encoder.close();
    return true;
  } catch (error) {
    loadError = error;
    return false;
  }
}

function createEncoder(sampleRate, channels, bitrate) {
  if (!native) throw loadError || new Error('Native libopus addon is not built');
  return native.createEncoder(sampleRate, channels, bitrate);
}

module.exports = { createEncoder, isAvailable, availabilityError: () => loadError?.message || 'Unknown libopus loading error' };
