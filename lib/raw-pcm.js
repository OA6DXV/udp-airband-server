'use strict';

function createRawPcmFramer(options = {}) {
  const frameMs = options.frameMs || 20;
  const gapResetMs = options.gapResetMs || 500;
  const now = options.now || Date.now;

  function push(stream, input) {
    const currentTime = now();
    if (stream.rawLastInputAt && currentTime - stream.rawLastInputAt > gapResetMs) {
      stream.rawPendingBuffer = Buffer.alloc(0);
    }
    stream.rawLastInputAt = currentTime;

    const samplesPerFrame = Math.max(1, Math.round(stream.sampleRate * frameMs / 1000));
    const frameBytes = samplesPerFrame * stream.channels * Float32Array.BYTES_PER_ELEMENT;
    const pending = stream.rawPendingBuffer && stream.rawPendingBuffer.length
      ? Buffer.concat([stream.rawPendingBuffer, input])
      : input;
    const completeBytes = pending.length - (pending.length % frameBytes);
    const frames = [];
    for (let offset = 0; offset < completeBytes; offset += frameBytes) {
      frames.push(Buffer.from(pending.subarray(offset, offset + frameBytes)));
    }
    stream.rawPendingBuffer = Buffer.from(pending.subarray(completeBytes));
    return frames;
  }

  function reset(stream) {
    stream.rawPendingBuffer = Buffer.alloc(0);
    stream.rawLastInputAt = 0;
  }

  return { push, reset };
}

module.exports = { createRawPcmFramer };
