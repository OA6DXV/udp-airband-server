import { MonoPcmRingBuffer } from './audio-ring-buffer.mjs';

const MAX_PACKET_SECONDS = 1;
const TELEMETRY_INTERVAL_SECONDS = 0.5;

class OpusPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = null;
    this.invalidMessages = 0;
    this.framesUntilTelemetry = Math.max(1, Math.round(sampleRate * TELEMETRY_INTERVAL_SECONDS));
    this.port.onmessage = ({ data }) => this.handleMessage(data);
  }

  handleMessage(message) {
    try {
      if (!message || typeof message !== 'object') throw new TypeError('message must be an object');
      if (message.type === 'configure') {
        this.ring = new MonoPcmRingBuffer(message);
        this.postDiagnostics('configured');
        return;
      }
      if (message.type === 'reset') {
        if (this.ring) this.ring.reset();
        this.postDiagnostics('reset');
        return;
      }
      if (message.type !== 'samples' || !this.ring) throw new TypeError('worklet is not configured');
      if (!(message.buffer instanceof ArrayBuffer)) throw new TypeError('sample buffer must be an ArrayBuffer');
      const channels = message.channels || this.ring.inputChannels;
      if (!Number.isInteger(message.frames) || message.frames < 1 || message.frames > this.ring.inputSampleRate * MAX_PACKET_SECONDS) {
        throw new RangeError('sample frame count is invalid');
      }
      if (message.buffer.byteLength !== message.frames * channels * Float32Array.BYTES_PER_ELEMENT) {
        throw new RangeError('sample buffer length is invalid');
      }
      this.ring.appendInterleaved(new Float32Array(message.buffer), message.frames, channels);
    } catch (error) {
      this.invalidMessages += 1;
      this.port.postMessage({ type: 'worklet-error', message: error.message, invalidMessages: this.invalidMessages });
    }
  }

  process(inputs, outputs) {
    const outputChannels = outputs[0] || [];
    const output = outputChannels[0];
    if (!output) return true;
    const wasStarted = Boolean(this.ring && this.ring.started);
    if (this.ring) this.ring.render(output, sampleRate);
    else output.fill(0);
    for (let channel = 1; channel < outputChannels.length; channel += 1) outputChannels[channel].set(output);

    if (this.ring && wasStarted !== this.ring.started) this.postDiagnostics(this.ring.started ? 'started' : 'underrun');
    this.framesUntilTelemetry -= output.length;
    if (this.framesUntilTelemetry <= 0) {
      this.framesUntilTelemetry += Math.max(1, Math.round(sampleRate * TELEMETRY_INTERVAL_SECONDS));
      this.postDiagnostics('periodic');
    }
    return true;
  }

  postDiagnostics(reason) {
    this.port.postMessage({
      type: 'worklet-diagnostics',
      reason,
      outputSampleRate: sampleRate,
      invalidMessages: this.invalidMessages,
      ...(this.ring ? this.ring.diagnostics() : {}),
    });
  }
}

registerProcessor('opus-pcm', OpusPcmProcessor);
