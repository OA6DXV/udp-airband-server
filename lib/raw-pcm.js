'use strict';

function createRawPcmFramer(options = {}) {
  const frameMs = options.frameMs || 20;
  const gapResetMs = options.gapResetMs || 500;
  const now = options.now || Date.now;
  const pendingBufferField = options.pendingBufferField || 'rawPendingBuffer';
  const lastInputAtField = options.lastInputAtField || 'rawLastInputAt';

  function push(stream, input) {
    const currentTime = now();
    if (stream[lastInputAtField] && currentTime - stream[lastInputAtField] > gapResetMs) {
      stream[pendingBufferField] = Buffer.alloc(0);
    }
    stream[lastInputAtField] = currentTime;

    const samplesPerFrame = Math.max(1, Math.round(stream.sampleRate * frameMs / 1000));
    const frameBytes = samplesPerFrame * stream.channels * Float32Array.BYTES_PER_ELEMENT;
    const currentPending = stream[pendingBufferField];
    const pending = currentPending && currentPending.length ? Buffer.concat([currentPending, input]) : input;
    const completeBytes = pending.length - (pending.length % frameBytes);
    const frames = [];
    for (let offset = 0; offset < completeBytes; offset += frameBytes) {
      frames.push(Buffer.from(pending.subarray(offset, offset + frameBytes)));
    }
    stream[pendingBufferField] = Buffer.from(pending.subarray(completeBytes));
    return frames;
  }

  function reset(stream) {
    stream[pendingBufferField] = Buffer.alloc(0);
    stream[lastInputAtField] = 0;
  }

  return { push, reset };
}

module.exports = { createRawPcmFramer };
