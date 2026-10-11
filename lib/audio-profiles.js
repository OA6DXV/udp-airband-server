'use strict';

// Permanent profiles. These are implementation constants, not server.conf settings.
module.exports = Object.freeze({
  ADPCM_FRAME_MS: 40,
  OPUS_FRAME_MS: 20,
  OPUS_BITRATE_8K: '20k',
  OPUS_BITRATE_16K: '32k',
  WORKLET_TARGET_LATENCY_MS: 100,
});
