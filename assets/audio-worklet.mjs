import { MonoPcmRingBuffer } from './audio-ring-buffer.mjs';

const TELEMETRY_INTERVAL_SECONDS = 0.5;
const MAX_PACKET_SECONDS = 1;

class AirbandPcmProcessor extends AudioWorkletProcessor {
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
        this.ring = new MonoPcmRingBuffer({
          inputSampleRate: message.inputSampleRate,
          channels: message.channels,
          targetLatencyMs: message.targetLatencyMs,
          highWaterMs: message.highWaterMs,
          capacitySeconds: message.capacitySeconds,
          maxDrift: message.maxDrift,
        });
        this.postDiagnostics('configured');
        return;
      }
      if (message.type === 'reset') {
        if (this.ring) this.ring.reset();
        this.postDiagnostics('reset');
        return;
      }
      if (message.type !== 'samples' || !this.ring) throw new TypeError('unsupported message or unconfigured processor');
      if (!(message.buffer instanceof ArrayBuffer)) throw new TypeError('samples buffer must be an ArrayBuffer');
      if (!Number.isInteger(message.frames) || message.frames < 1) throw new RangeError('frames must be a positive integer');
      if (message.frames > this.ring.inputSampleRate * MAX_PACKET_SECONDS) throw new RangeError('sample packet is too large');
      const expectedBytes = message.frames * this.ring.inputChannels * Float32Array.BYTES_PER_ELEMENT;
      if (message.buffer.byteLength !== expectedBytes) throw new RangeError('sample packet length is invalid');
      this.ring.appendInterleaved(new Float32Array(message.buffer), message.frames);
    } catch (error) {
      this.invalidMessages += 1;
      this.port.postMessage({ type: 'worklet-error', message: error.message, invalidMessages: this.invalidMessages });
    }
  }

  process(inputs, outputs) {
    const channels = outputs[0] || [];
    const output = channels[0];
    if (!output) return true;

    if (this.ring) this.ring.render(output, sampleRate);
    else output.fill(0);
    for (let channel = 1; channel < channels.length; channel += 1) channels[channel].set(output);

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

registerProcessor('airband-pcm', AirbandPcmProcessor);

export { AirbandPcmProcessor };
