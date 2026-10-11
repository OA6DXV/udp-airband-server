const CONFIG_MAGIC = 'OPC1';
const PACKET_MAGIC = 'OPU1';
const DECODER_SAMPLE_RATE = 48000;
const MAX_PENDING_PACKETS = 16;

export function parseOpusTransportFrame(input) {
  const bytes = toUint8Array(input);
  if (bytes.length < 4) throw new RangeError('Opus transport frame is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = readMagic(bytes);

  if (magic === CONFIG_MAGIC) {
    if (bytes.length < 32) throw new RangeError('Opus config frame is too short');
    const inputSampleRate = view.getUint32(4, true);
    const channels = bytes[8];
    const frameDurationMs = view.getUint16(9, true);
    const descriptionLength = view.getUint16(11, true);
    if (![8000, 16000].includes(inputSampleRate)) throw new RangeError('Opus input sample rate is not supported');
    if (channels !== 1) throw new RangeError('Realtime Opus must be mono');
    if (frameDurationMs !== 20) throw new RangeError('Realtime Opus frame duration must be 20 ms');
    if (descriptionLength < 19 || bytes.length !== 13 + descriptionLength) {
      throw new RangeError('Opus identification header length is invalid');
    }
    const description = bytes.slice(13);
    if (readMagic(description) !== 'Opus' || String.fromCharCode(...description.subarray(0, 8)) !== 'OpusHead') {
      throw new RangeError('Opus identification header is invalid');
    }
    if (description[8] !== 1 || description[9] !== channels) {
      throw new RangeError('Opus identification header does not match its config');
    }
    return { type: 'config', inputSampleRate, channels, frameDurationMs, description };
  }

  if (magic === PACKET_MAGIC) {
    if (bytes.length <= 8) throw new RangeError('Opus packet frame has no packet data');
    return {
      type: 'packet',
      sequence: view.getUint32(4, true),
      timestampUs: view.getUint32(4, true) * 20000,
      durationUs: 20000,
      data: bytes.slice(8),
    };
  }
  throw new TypeError('Unknown Opus transport frame');
}

export async function supportsOpusAudioDecoder(AudioDecoderCtor = globalThis.AudioDecoder) {
  if (!AudioDecoderCtor || typeof AudioDecoderCtor.isConfigSupported !== 'function') return false;
  try {
    const support = await AudioDecoderCtor.isConfigSupported({
      codec: 'opus',
      sampleRate: DECODER_SAMPLE_RATE,
      numberOfChannels: 1,
    });
    return Boolean(support && support.supported);
  } catch {
    return false;
  }
}

export class OpusWebCodecsDecoder {
  constructor(options = {}) {
    this.AudioDecoderCtor = options.AudioDecoderCtor || globalThis.AudioDecoder;
    this.EncodedAudioChunkCtor = options.EncodedAudioChunkCtor || globalThis.EncodedAudioChunk;
    this.onPcm = options.onPcm || (() => {});
    this.onError = options.onError || (() => {});
    this.onSequenceGap = options.onSequenceGap || (() => {});
    this.decoder = null;
    this.pendingPackets = [];
    this.configurePromise = null;
    this.generation = 0;
    this.lastSequence = null;
    this.expectedTimestampUs = null;
    this.closed = false;
    this.resetDiagnostics();
  }

  resetDiagnostics() {
    this.receivedPackets = 0;
    this.missingPackets = 0;
    this.duplicatePackets = 0;
    this.droppedPackets = 0;
    this.submittedPackets = 0;
    this.decodedBlocks = 0;
    this.decodedSamples = 0;
    this.concealedSamples = 0;
    this.outputSampleRate = 0;
  }

  diagnostics() {
    return {
      receivedPackets: this.receivedPackets,
      missingPackets: this.missingPackets,
      duplicatePackets: this.duplicatePackets,
      droppedPackets: this.droppedPackets,
      submittedPackets: this.submittedPackets,
      pendingPackets: this.pendingPackets.length,
      decodeQueueSize: this.decoder?.decodeQueueSize || 0,
      decodedBlocks: this.decodedBlocks,
      decodedSamples: this.decodedSamples,
      concealedSamples: this.concealedSamples,
      outputSampleRate: this.outputSampleRate,
    };
  }

  push(input) {
    if (this.closed) return Promise.resolve(false);
    let frame;
    try {
      frame = parseOpusTransportFrame(input);
    } catch (error) {
      this.onError(error);
      return Promise.reject(error);
    }
    if (frame.type === 'config') return this.configure(frame);
    this.queuePacket(frame);
    if (this.decoder && this.decoder.state === 'configured') this.decodePending();
    return this.configurePromise || Promise.resolve(Boolean(this.decoder));
  }

  configure(configuration) {
    const generation = ++this.generation;
    this.closeDecoder();
    this.pendingPackets = [];
    this.lastSequence = null;
    this.expectedTimestampUs = null;
    this.closed = false;
    this.resetDiagnostics();
    const decoderConfig = {
      codec: 'opus',
      sampleRate: DECODER_SAMPLE_RATE,
      numberOfChannels: 1,
      description: configuration.description,
    };

    this.configurePromise = this.isConfigSupported(decoderConfig)
      .then((supported) => {
        if (generation !== this.generation || this.closed) return false;
        if (!supported) throw new Error('This browser does not support the realtime Opus decoder');
        const decoder = new this.AudioDecoderCtor({
          output: (audioData) => this.handleAudioData(audioData, generation),
          error: (error) => this.handleDecoderError(error, generation),
        });
        decoder.configure(decoderConfig);
        this.decoder = decoder;
        this.decodePending();
        return true;
      })
      .catch((error) => {
        if (generation === this.generation && !this.closed) this.onError(error);
        throw error;
      })
      .finally(() => {
        if (generation === this.generation) this.configurePromise = null;
      });
    return this.configurePromise;
  }

  async isConfigSupported(configuration) {
    if (!this.AudioDecoderCtor || typeof this.AudioDecoderCtor.isConfigSupported !== 'function') return false;
    try {
      const support = await this.AudioDecoderCtor.isConfigSupported(configuration);
      return Boolean(support && support.supported);
    } catch {
      return false;
    }
  }

  queuePacket(packet) {
    this.receivedPackets += 1;
    if (this.lastSequence !== null) {
      const expected = (this.lastSequence + 1) >>> 0;
      const missing = (packet.sequence - expected) >>> 0;
      if (missing > 0 && missing < 0x80000000) {
        this.missingPackets += missing;
        this.onSequenceGap(missing);
      }
      if (missing >= 0x80000000) {
        this.duplicatePackets += 1;
        return;
      }
    }
    this.lastSequence = packet.sequence;
    this.pendingPackets.push(packet);
    while (this.pendingPackets.length > MAX_PENDING_PACKETS) {
      this.pendingPackets.shift();
      this.droppedPackets += 1;
    }
  }

  decodePending() {
    if (!this.decoder || this.decoder.state !== 'configured') return;
    while (this.pendingPackets.length && this.decoder.decodeQueueSize < MAX_PENDING_PACKETS) {
      const packet = this.pendingPackets.shift();
      try {
        this.submittedPackets += 1;
        this.decoder.decode(new this.EncodedAudioChunkCtor({
          type: 'key',
          timestamp: packet.timestampUs,
          duration: packet.durationUs,
          data: packet.data,
        }));
      } catch (error) {
        this.handleDecoderError(error, this.generation);
        return;
      }
    }
  }

  handleAudioData(audioData, generation) {
    if (generation !== this.generation || this.closed) {
      audioData.close();
      return;
    }
    try {
      const frames = audioData.numberOfFrames;
      const channels = audioData.numberOfChannels;
      const sampleRate = audioData.sampleRate;
      const timestampUs = Number.isFinite(audioData.timestamp) ? audioData.timestamp : null;
      const samples = copyAudioDataToInterleavedFloat32(audioData);
      this.decodedBlocks += 1;
      this.decodedSamples += frames;
      this.outputSampleRate = sampleRate;
      if (timestampUs !== null && this.expectedTimestampUs !== null) {
        const gapUs = timestampUs - this.expectedTimestampUs;
        if (gapUs > 2000 && gapUs <= 200000) {
          const silenceFrames = Math.round(gapUs * sampleRate / 1000000);
          if (silenceFrames > 0) {
            this.concealedSamples += silenceFrames;
            this.onPcm(new Float32Array(silenceFrames * channels), silenceFrames, sampleRate, channels);
          }
        }
      }
      this.onPcm(samples, frames, sampleRate, channels);
      this.expectedTimestampUs = (timestampUs === null ? this.expectedTimestampUs || 0 : timestampUs)
        + Math.round(frames * 1000000 / sampleRate);
      this.decodePending();
    } catch (error) {
      this.handleDecoderError(error, generation);
    } finally {
      audioData.close();
    }
  }

  handleDecoderError(error, generation) {
    if (generation !== this.generation || this.closed) return;
    this.onError(error instanceof Error ? error : new Error(String(error)));
  }

  closeDecoder() {
    if (!this.decoder) return;
    try {
      if (this.decoder.state !== 'closed') this.decoder.close();
    } catch {
      // The browser may already have closed the decoder after an error.
    }
    this.decoder = null;
  }

  close() {
    this.closed = true;
    this.generation += 1;
    this.pendingPackets = [];
    this.configurePromise = null;
    this.lastSequence = null;
    this.expectedTimestampUs = null;
    this.closeDecoder();
  }
}

function copyAudioDataToInterleavedFloat32(audioData) {
  const frames = audioData.numberOfFrames;
  const channels = audioData.numberOfChannels;
  const interleaved = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const plane = new Float32Array(frames);
    audioData.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
    for (let frame = 0; frame < frames; frame += 1) interleaved[frame * channels + channel] = plane[frame];
  }
  return interleaved;
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Opus transport data must be an ArrayBuffer or typed array');
}

function readMagic(bytes) {
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}
