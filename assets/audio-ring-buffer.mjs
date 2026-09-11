const DEFAULT_TARGET_LATENCY_MS = 80;
const DEFAULT_HIGH_WATER_MS = 500;
const DEFAULT_CAPACITY_SECONDS = 4;
const DEFAULT_MAX_DRIFT = 0.004;

export class MonoPcmRingBuffer {
  constructor(options = {}) {
    this.underruns = 0;
    this.overflows = 0;
    this.resets = 0;
    this.droppedFrames = 0;
    this.receivedFrames = 0;
    this.renderedFrames = 0;
    this.maxBufferedFrames = 0;
    this.lastCorrection = 0;
    this.configured = false;
    if (options.inputSampleRate !== undefined) this.configure(options);
  }

  configure({
    inputSampleRate,
    channels = 1,
    targetLatencyMs = DEFAULT_TARGET_LATENCY_MS,
    highWaterMs = DEFAULT_HIGH_WATER_MS,
    capacitySeconds = DEFAULT_CAPACITY_SECONDS,
    maxDrift = DEFAULT_MAX_DRIFT,
  }) {
    if (!Number.isInteger(inputSampleRate) || inputSampleRate < 1000 || inputSampleRate > 96000) {
      throw new RangeError('inputSampleRate must be an integer between 1000 and 96000');
    }
    if (![1, 2].includes(channels)) throw new RangeError('channels must be 1 or 2');
    if (!Number.isFinite(targetLatencyMs) || targetLatencyMs <= 0) throw new RangeError('targetLatencyMs must be positive');
    if (!Number.isFinite(highWaterMs) || highWaterMs <= targetLatencyMs) throw new RangeError('highWaterMs must exceed targetLatencyMs');
    if (!Number.isFinite(capacitySeconds) || capacitySeconds <= highWaterMs / 1000) throw new RangeError('capacitySeconds must exceed highWaterMs');
    if (!Number.isFinite(maxDrift) || maxDrift < 0 || maxDrift > 0.02) throw new RangeError('maxDrift must be between 0 and 0.02');

    this.inputSampleRate = inputSampleRate;
    this.inputChannels = channels;
    this.targetFrames = Math.max(2, Math.round(inputSampleRate * targetLatencyMs / 1000));
    this.highWaterFrames = Math.max(this.targetFrames + 2, Math.round(inputSampleRate * highWaterMs / 1000));
    this.capacityFrames = Math.max(this.highWaterFrames + 2, Math.round(inputSampleRate * capacitySeconds));
    this.maxDrift = maxDrift;
    this.buffer = new Float32Array(this.capacityFrames);
    this.configured = true;
    this.reset();
  }

  reset() {
    if (!this.configured) return;
    this.readFrame = 0;
    this.writeFrame = 0;
    this.started = false;
    this.lastCorrection = 0;
    this.resets += 1;
  }

  appendInterleaved(samples, frames, channels = this.inputChannels) {
    if (!this.configured) throw new Error('ring buffer is not configured');
    if (!(samples instanceof Float32Array)) throw new TypeError('samples must be a Float32Array');
    if (channels !== this.inputChannels) throw new RangeError('channel count does not match configuration');
    if (!Number.isInteger(frames) || frames < 1 || samples.length !== frames * channels) {
      throw new RangeError('sample length does not match frames and channels');
    }

    for (let frame = 0; frame < frames; frame += 1) {
      let mono = samples[frame * channels];
      if (channels === 2) mono = (mono + samples[frame * channels + 1]) * 0.5;
      if (!Number.isFinite(mono)) mono = 0;
      this.buffer[this.writeFrame % this.capacityFrames] = clamp(mono, -1, 1);
      this.writeFrame += 1;
    }

    this.receivedFrames += frames;
    const bufferedBeforeTrim = this.availableFrames();
    this.maxBufferedFrames = Math.max(this.maxBufferedFrames, Math.min(this.capacityFrames, Math.ceil(bufferedBeforeTrim)));
    if (bufferedBeforeTrim > this.highWaterFrames) {
      const keepFrames = Math.min(this.targetFrames, this.capacityFrames - 2, this.writeFrame);
      const nextReadFrame = this.writeFrame - keepFrames;
      this.droppedFrames += Math.max(0, Math.floor(nextReadFrame - this.readFrame));
      this.readFrame = nextReadFrame;
      this.started = false;
      this.overflows += 1;
    }
  }

  render(output, outputSampleRate) {
    if (!(output instanceof Float32Array)) throw new TypeError('output must be a Float32Array');
    output.fill(0);
    if (!this.configured || !Number.isFinite(outputSampleRate) || outputSampleRate <= 0) return;

    if (!this.started) {
      if (this.availableFrames() < this.targetFrames) return;
      this.started = true;
    }

    const buffered = this.availableFrames();
    const errorRatio = (buffered - this.targetFrames) / Math.max(1, this.targetFrames);
    this.lastCorrection = clamp(errorRatio * 0.0015, -this.maxDrift, this.maxDrift);
    const step = this.inputSampleRate / outputSampleRate * (1 + this.lastCorrection);
    let rendered = 0;

    for (let index = 0; index < output.length; index += 1) {
      if (this.writeFrame - this.readFrame < 2) {
        this.readFrame = this.writeFrame;
        this.started = false;
        this.lastCorrection = 0;
        this.underruns += 1;
        break;
      }

      const baseFrame = Math.floor(this.readFrame);
      const fraction = this.readFrame - baseFrame;
      const first = this.buffer[baseFrame % this.capacityFrames];
      const second = this.buffer[(baseFrame + 1) % this.capacityFrames];
      output[index] = first + (second - first) * fraction;
      this.readFrame += step;
      rendered += 1;
    }

    this.renderedFrames += rendered;
  }

  availableFrames() {
    if (!this.configured) return 0;
    return Math.max(0, this.writeFrame - this.readFrame);
  }

  diagnostics() {
    return {
      inputSampleRate: this.inputSampleRate || 0,
      inputChannels: this.inputChannels || 0,
      bufferedFrames: Math.max(0, Math.floor(this.availableFrames())),
      maxBufferedFrames: this.maxBufferedFrames,
      targetFrames: this.targetFrames || 0,
      highWaterFrames: this.highWaterFrames || 0,
      capacityFrames: this.capacityFrames || 0,
      underruns: this.underruns,
      overflows: this.overflows,
      resets: this.resets,
      droppedFrames: this.droppedFrames,
      receivedFrames: this.receivedFrames,
      renderedFrames: this.renderedFrames,
      correction: this.lastCorrection,
      started: Boolean(this.started),
    };
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

