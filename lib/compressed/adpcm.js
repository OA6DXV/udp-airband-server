'use strict';

const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
  19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
  337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
  5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const BURST_RESET_MS = 500;
const SMOOTHING_ALPHA = 0.62;

function encodeAdpcmFrames(stream, input, frameMs) {
  const totalSamples = input.length / 4;
  const totalFrames = totalSamples / stream.channels;
  if (!Number.isInteger(totalFrames) || totalFrames < 1) return [];

  const maxFrames = Math.max(2, Math.round(stream.sampleRate * frameMs / 1000));
  const now = Date.now();
  if (!stream.adpcmLastInputAt || now - stream.adpcmLastInputAt > BURST_RESET_MS) {
    stream.adpcmState = null;
    stream.adpcmFilterState = null;
  }
  stream.adpcmLastInputAt = now;

  const chunks = [];
  for (let offsetFrame = 0; offsetFrame < totalFrames; offsetFrame += maxFrames) {
    const frames = Math.min(maxFrames, totalFrames - offsetFrame);
    chunks.push(encodeAdpcmFrame(stream, input, offsetFrame, frames));
  }
  return chunks;
}

function encodeAdpcmFrame(stream, input, offsetFrame, frames) {
  const channels = stream.channels;
  const headerBytes = 20 + channels * 4;
  const payloadSamples = Math.max(0, (frames - 1) * channels);
  const payloadBytes = Math.ceil(payloadSamples / 2);
  const output = Buffer.alloc(headerBytes + payloadBytes);
  const states = [];
  const priorStates = stream.adpcmState || [];

  output.write('ADP1', 0, 4, 'ascii');
  output.writeUInt8(channels, 4);
  output.writeUInt8(4, 5);
  output.writeUInt16LE(headerBytes, 6);
  output.writeUInt32LE(stream.sampleRate, 8);
  output.writeUInt32LE(stream.adpcmSequence >>> 0, 12);
  output.writeUInt16LE(frames, 16);
  output.writeUInt16LE(payloadBytes, 18);
  stream.adpcmSequence = (stream.adpcmSequence + 1) >>> 0;

  for (let channel = 0; channel < channels; channel += 1) {
    const predictor = readPcm16(stream, input, offsetFrame, channel, channels);
    const index = priorStates[channel] ? priorStates[channel].index : 0;
    states.push({ predictor, index });
    const stateOffset = 20 + channel * 4;
    output.writeInt16LE(predictor, stateOffset);
    output.writeUInt8(index, stateOffset + 2);
    output.writeUInt8(0, stateOffset + 3);
  }

  let nibbleIndex = 0;
  for (let frame = 1; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = readPcm16(stream, input, offsetFrame + frame, channel, channels);
      const code = encodeNibble(sample, states[channel]);
      const byteOffset = headerBytes + Math.floor(nibbleIndex / 2);
      if (nibbleIndex % 2 === 0) {
        output[byteOffset] = code;
      } else {
        output[byteOffset] |= code << 4;
      }
      nibbleIndex += 1;
    }
  }

  stream.adpcmState = states.map((state) => ({ predictor: state.predictor, index: state.index }));
  return output;
}

function readPcm16(stream, input, frame, channel, channels) {
  const sample = input.readFloatLE((frame * channels + channel) * 4);
  const smoothed = smoothSample(stream, sample, channel, channels);
  return clamp(Math.round(Math.max(-1, Math.min(1, smoothed)) * 32767), -32768, 32767);
}

function smoothSample(stream, sample, channel, channels) {
  if (!stream.adpcmFilterState) {
    stream.adpcmFilterState = new Array(channels).fill(null);
  }
  const previous = stream.adpcmFilterState[channel];
  const filtered = previous === null ? sample : previous + SMOOTHING_ALPHA * (sample - previous);
  stream.adpcmFilterState[channel] = filtered;
  return filtered;
}

function encodeNibble(sample, state) {
  const step = STEP_TABLE[state.index];
  let diff = sample - state.predictor;
  let code = 0;
  if (diff < 0) {
    code = 8;
    diff = -diff;
  }

  let tempStep = step;
  if (diff >= tempStep) {
    code |= 4;
    diff -= tempStep;
  }
  tempStep >>= 1;
  if (diff >= tempStep) {
    code |= 2;
    diff -= tempStep;
  }
  tempStep >>= 1;
  if (diff >= tempStep) {
    code |= 1;
  }

  let delta = step >> 3;
  if (code & 4) delta += step;
  if (code & 2) delta += step >> 1;
  if (code & 1) delta += step >> 2;
  state.predictor = clamp(state.predictor + ((code & 8) ? -delta : delta), -32768, 32767);
  state.index = clamp(state.index + INDEX_TABLE[code], 0, STEP_TABLE.length - 1);
  return code & 0x0f;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  encodeAdpcmFrames,
};
