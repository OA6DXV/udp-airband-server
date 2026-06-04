'use strict';

const { compressedInputArgs } = require('./opus-websocket');

function aacWebSocketArgs(stream, aacBitrate) {
  return compressedInputArgs(stream).concat([
    '-c:a', 'aac',
    '-b:a', aacBitrate,
    '-ar', '16000',
    '-flush_packets', '1',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration', '20000',
    '-f', 'mp4',
    'pipe:1',
  ]);
}

module.exports = {
  aacWebSocketArgs,
};
