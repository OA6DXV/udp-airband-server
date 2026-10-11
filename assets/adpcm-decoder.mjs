const adpcmIndexTable = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const adpcmStepTable = [
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

export function decodeAdpcmFrame(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 24
    || view.getUint8(0) !== 0x41
    || view.getUint8(1) !== 0x44
    || view.getUint8(2) !== 0x50
    || view.getUint8(3) !== 0x31) {
    return null;
  }

  const channels = view.getUint8(4);
  const headerBytes = view.getUint16(6, true);
  const sampleRate = view.getUint32(8, true);
  const frames = view.getUint16(16, true);
  const payloadBytes = view.getUint16(18, true);
  if (![1, 2].includes(channels) || headerBytes !== 20 + channels * 4 || frames < 1
    || sampleRate < 1000 || sampleRate > 96000 || frames > sampleRate
    || view.getUint8(5) !== 4
    || payloadBytes !== Math.ceil((frames - 1) * channels / 2)
    || view.byteLength !== headerBytes + payloadBytes) {
    return null;
  }

  const states = [];
  const samples = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const stateOffset = 20 + channel * 4;
    const predictor = view.getInt16(stateOffset, true);
    const index = view.getUint8(stateOffset + 2);
    if (index >= adpcmStepTable.length) return null;
    states.push({ predictor, index });
    samples[channel] = predictor / 32768;
  }

  let nibbleIndex = 0;
  for (let frame = 1; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const byteValue = view.getUint8(headerBytes + Math.floor(nibbleIndex / 2));
      const code = nibbleIndex % 2 === 0 ? byteValue & 0x0f : byteValue >> 4;
      const sample = decodeAdpcmNibble(code, states[channel]);
      samples[frame * channels + channel] = sample / 32768;
      nibbleIndex += 1;
    }
  }

  return { samples, frames, channels, sampleRate };
}

function decodeAdpcmNibble(code, state) {
  const step = adpcmStepTable[state.index] || 7;
  let delta = step >> 3;
  if (code & 4) delta += step;
  if (code & 2) delta += step >> 1;
  if (code & 1) delta += step >> 2;
  state.predictor = clamp(state.predictor + ((code & 8) ? -delta : delta), -32768, 32767);
  state.index = clamp(state.index + adpcmIndexTable[code], 0, adpcmStepTable.length - 1);
  return state.predictor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
