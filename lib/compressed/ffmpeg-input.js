'use strict';

function compressedInputArgs(stream) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', 'nobuffer',
    '-f', 'f32le',
    '-ar', String(stream.sampleRate),
    '-ac', String(stream.channels),
    '-i', 'pipe:0',
    '-vn',
  ];
}

module.exports = { compressedInputArgs };
