'use strict';

const OGG_CAPTURE_PATTERN = Buffer.from('OggS', 'ascii');
const OPUS_HEAD_PATTERN = Buffer.from('OpusHead', 'ascii');
const OPUS_TAGS_PATTERN = Buffer.from('OpusTags', 'ascii');
const MAX_OGG_PACKET_BYTES = 64 * 1024;

function createOggOpusPacketParser(options = {}) {
  const frameDurationMs = Number(options.frameDurationMs) || 20;
  if (!Number.isInteger(frameDurationMs) || frameDurationMs < 5 || frameDurationMs > 120) {
    throw new RangeError('Ogg Opus frame duration must be between 5 and 120 ms');
  }
  let buffered = Buffer.alloc(0);
  let packetParts = [];
  let packetLength = 0;
  let hasOpusHead = false;
  let preSkipSamples = 0;

  function push(input) {
    if (!Buffer.isBuffer(input)) throw new TypeError('Ogg input must be a Buffer');
    if (input.length) buffered = buffered.length ? Buffer.concat([buffered, input]) : input;
    const output = [];

    while (buffered.length >= 27) {
      const captureAt = buffered.indexOf(OGG_CAPTURE_PATTERN);
      if (captureAt < 0) {
        if (buffered.length > 3) throw new Error('Ogg capture pattern was not found');
        break;
      }
      if (captureAt > 0) buffered = buffered.subarray(captureAt);
      if (buffered.length < 27) break;
      if (buffered[4] !== 0) throw new Error(`Unsupported Ogg bitstream version ${buffered[4]}`);

      const segmentCount = buffered[26];
      const headerLength = 27 + segmentCount;
      if (buffered.length < headerLength) break;
      let bodyLength = 0;
      for (let index = 0; index < segmentCount; index += 1) bodyLength += buffered[27 + index];
      const pageLength = headerLength + bodyLength;
      if (buffered.length < pageLength) break;

      const continued = (buffered[5] & 0x01) !== 0;
      if (!continued && packetLength > 0) {
        packetParts = [];
        packetLength = 0;
      }

      const pagePackets = [];
      let bodyOffset = headerLength;
      for (let index = 0; index < segmentCount; index += 1) {
        const segmentLength = buffered[27 + index];
        if (segmentLength) {
          packetParts.push(buffered.subarray(bodyOffset, bodyOffset + segmentLength));
          packetLength += segmentLength;
          if (packetLength > MAX_OGG_PACKET_BYTES) throw new Error('Ogg packet exceeded the supported size');
        }
        bodyOffset += segmentLength;

        if (segmentLength < 255) {
          const packet = packetParts.length === 1
            ? Buffer.from(packetParts[0])
            : Buffer.concat(packetParts, packetLength);
          packetParts = [];
          packetLength = 0;
          pagePackets.push(packet);
        }
      }

      handlePagePackets(pagePackets, buffered.readBigUInt64LE(6), output);
      buffered = buffered.subarray(pageLength);
    }

    return output;
  }

  function handlePagePackets(packets, granulePosition, output) {
    const audioPackets = packets.filter((packet) => !isOpusHead(packet) && !isOpusTags(packet));
    let audioPacketIndex = 0;
    for (const packet of packets) {
      if (isOpusHead(packet)) {
        if (packet.length < 19 || packet[8] !== 1 || packet[9] < 1 || packet[9] > 2) {
          throw new Error('Invalid Opus identification header');
        }
        hasOpusHead = true;
        preSkipSamples = packet.readUInt16LE(10);
        output.push({ type: 'config', description: Buffer.from(packet) });
        continue;
      }
      if (isOpusTags(packet)) continue;
      if (!hasOpusHead) throw new Error('Opus audio packet arrived before its identification header');
      if (!packet.length) continue;

      const pageEndSamples = granulePosition === 0xffffffffffffffffn
        ? 0n
        : granulePosition - BigInt(preSkipSamples);
      const samplesAfterPacket = BigInt(audioPackets.length - audioPacketIndex - 1) * BigInt(frameDurationMs * 48);
      const packetStartSamples = pageEndSamples - samplesAfterPacket - BigInt(frameDurationMs * 48);
      const timestampUs = packetStartSamples > 0n
        ? Number(packetStartSamples * 1000000n / 48000n)
        : 0;
      audioPacketIndex += 1;
      output.push({ type: 'packet', data: Buffer.from(packet), timestampUs });
    }
  }

  function isOpusHead(packet) {
    return packet.length >= OPUS_HEAD_PATTERN.length && packet.subarray(0, OPUS_HEAD_PATTERN.length).equals(OPUS_HEAD_PATTERN);
  }

  function isOpusTags(packet) {
    return packet.length >= OPUS_TAGS_PATTERN.length && packet.subarray(0, OPUS_TAGS_PATTERN.length).equals(OPUS_TAGS_PATTERN);
  }

  function reset() {
    buffered = Buffer.alloc(0);
    packetParts = [];
    packetLength = 0;
    hasOpusHead = false;
    preSkipSamples = 0;
  }

  return { push, reset };
}

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

module.exports = { createOggOpusPacketParser, encodeOpusConfigFrame, encodeOpusPacketFrame };
