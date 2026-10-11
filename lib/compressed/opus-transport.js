'use strict';

function encodeOpusConfigFrame({ inputSampleRate, channels, frameDurationMs, description }) {
  if (!Buffer.isBuffer(description) || description.length < 19 || description.length > 65535) {
    throw new RangeError('Opus identification header is invalid');
  }
  const frame = Buffer.alloc(13 + description.length);
  frame.write('OPC1', 0, 4, 'ascii');
  frame.writeUInt32LE(inputSampleRate, 4);
  frame.writeUInt8(channels, 8);
  frame.writeUInt16LE(frameDurationMs, 9);
  frame.writeUInt16LE(description.length, 11);
  description.copy(frame, 13);
  return frame;
}

function encodeOpusPacketFrame({ sequence, data }) {
  if (!Buffer.isBuffer(data) || data.length === 0) throw new RangeError('Opus packet must not be empty');
  const frame = Buffer.alloc(8 + data.length);
  frame.write('OPU1', 0, 4, 'ascii');
  frame.writeUInt32LE(sequence >>> 0, 4);
  data.copy(frame, 8);
  return frame;
}

module.exports = { encodeOpusConfigFrame, encodeOpusPacketFrame };
