'use strict';

function opusHttpArgs(stream, opusBitrate) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', 'nobuffer',
    '-f', 'f32le',
    '-ar', String(stream.sampleRate),
    '-ac', String(stream.channels),
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libopus',
    '-application', 'lowdelay',
    '-b:a', opusBitrate,
    '-vbr', 'on',
    '-dtx', '1',
    '-frame_duration', '20',
    '-compression_level', '0',
    '-flush_packets', '1',
    '-max_delay', '0',
    '-page_duration', '20000',
    '-f', 'ogg',
    'pipe:1',
  ];
}

function opusWebSocketArgs(stream, opusBitrate) {
  return compressedInputArgs(stream).concat([
    '-c:a', 'libopus',
    '-application', 'lowdelay',
    '-b:a', opusBitrate,
    '-vbr', 'on',
    '-dtx', '1',
    '-frame_duration', '20',
    '-compression_level', '0',
    '-flush_packets', '1',
    '-max_delay', '0',
    '-cluster_time_limit', '40',
    '-cluster_size_limit', '4096',
    '-f', 'webm',
    'pipe:1',
  ]);
}

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

module.exports = {
  compressedInputArgs,
  opusHttpArgs,
  opusWebSocketArgs,
};
