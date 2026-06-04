# UDP Airband Server

Receives one or more RTLSDR-Airband `udp_stream` outputs and plays them in a web browser from a single web server.

Each stream is raw 32-bit little-endian floating-point PCM:

- Mono: `L L L ...`
- Stereo: interleaved `L R L R ...`
- Sample rate: `8000 Hz` by default, or `16000 Hz` if RTLSDR-Airband was built with `NFM`

## Configuration

Copy the example files and edit them for your server:

```bash
cp server.example.conf server.conf
cp streams.example.json streams.json
```

Main files:

- `server.js`: Node.js application entry point. It starts UDP listeners, HTTP/HTTPS servers, WebSocket routes, status endpoints, and compressed audio backends.
- `server.example.conf`: example server-level configuration for UDP bind defaults, web ports, SSL/TLS paths, and compressed audio settings.
- `streams.example.json`: example input-stream configuration. This is where feed names, labels, UDP ports, sample rates, and channel counts are defined.
- `index.html`: stream player HTML shell.
- `assets/style.css`: stream player styling.
- `assets/app.js`: browser-side audio, UI, status, language, waveform, and reconnect logic.
- `lib/`: server modules for configuration, stream loading, listener tracking, WebSocket framing, and compressed audio backends.
- `tools/`: helper scripts for sending test audio into UDP inputs.

`server.conf` controls server-level settings:

```conf
[udp]
host = 0.0.0.0

[web]
host = 0.0.0.0
port = 8585

[streams]
file = streams.json

[ssl]
enabled = false
key =
cert =

[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 40
```

`streams.json` is the only place that defines feeds, UDP ports, sample rate, and channel count:

```json
{
  "streams": [
    {
      "name": "tower",
      "label": "Tower 118.100",
      "udpPort": 8686,
      "sampleRate": 8000,
      "channels": 1
    },
    {
      "name": "test",
      "label": "Testing UDP Input",
      "udpPort": 8690,
      "sampleRate": 8000,
      "channels": 1
    }
  ]
}
```

Then run the server:

```bash
npm start
```

Open:

```text
http://SERVER_IP:8585/
http://SERVER_IP:8585/tower
http://SERVER_IP:8585/test
```

Click `Start Audio`. Browsers require a user gesture before audio playback starts.

You can also use custom config paths:

```bash
npm start -- \
  --server-config /etc/udp-airband-server/server.conf \
  --config /etc/udp-airband-server/streams.json
```

## HTTPS / TLS

The server can listen with HTTPS directly when you enable SSL and provide a certificate and private key in `server.conf`:

```conf
[ssl]
enabled = true
host = 0.0.0.0
port = 8443
key = /etc/letsencrypt/live/example.com/privkey.pem
cert = /etc/letsencrypt/live/example.com/fullchain.pem
redirect_http_to_https = false
```

Then open:

```text
https://SERVER_IP:8443/main
```

The plain HTTP listener is still started by default so existing deployments do not break. Use firewall or reverse-proxy rules if you want HTTPS only exposed publicly.

## Status API

The server exposes JSON status endpoints:

```text
http://SERVER_IP:8585/status
http://SERVER_IP:8585/status/main
```

Status includes UDP counters, uncompressed/compressed client counts, active listener count, per-listener modes, last activity time, and whether TLS/compressed audio are available.

## RTLSDR-Airband output config

Each Airband output should send to the UDP port assigned to that stream.

```conf
outputs: (
  {
    type = "udp_stream";
    dest_address = "127.0.0.1";
    dest_port = 8686;
    continuous = true;
  }
);
```

For the example test stream:

```conf
outputs: (
  {
    type = "udp_stream";
    dest_address = "127.0.0.1";
    dest_port = 8690;
    continuous = true;
  }
);
```

## Test tools

The `tools/` directory contains helper scripts for sending synthetic or file-based audio to the example `test` UDP stream on port `8690`.

See `tools/README.md` for usage details.

In RAW mode, the player forwards UDP packets as WebSocket binary frames, so latency stays low and the browser receives the same float PCM shape as the original stream.

## Uncompressed and compressed modes

The browser can play either:

- `Uncompressed`: the original float32 PCM stream over WebSocket.
- `Compressed`: low-latency IMA ADPCM over WebSocket by default.

Desktop browsers open in `Uncompressed` by default. Mobile browsers open in `Compressed` by default so iPhone and Android users can test the lower-bandwidth path immediately.

ADPCM is designed for intermittent RTLSDR-Airband UDP output. The server sends compressed frames only when UDP audio arrives, so idle squelch periods do not consume audio bandwidth. Each ADPCM frame includes its own decoder state, allowing newly connected clients or clients after a silence gap to resynchronize immediately.

The ADPCM encoder keeps its adaptive state across active UDP packets and resets after idle gaps. It also applies a light smoothing stage before encoding to reduce granular quantization noise and harsh high-frequency artifacts from radio bursts.

Compressed mode defaults to:

```conf
[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 40
```

Use a smaller ADPCM frame size for slightly lower packet duration, or a larger one for slightly less WebSocket overhead:

```conf
[compressed]
adpcm_frame_ms = 20
```

Supported compressed codecs are:

- `adpcm`: default, low latency, no `ffmpeg` required.
- `opus`: Opus/WebM over WebSocket or HTTP fallback, requires `ffmpeg`.
- `aac`: AAC over WebSocket/MediaSource, requires `ffmpeg`.
- `hls`: experimental HLS/AAC route, requires `ffmpeg`. This path is currently kept in the codebase but is on hold while ADPCM is tested as the mobile-friendly compressed mode.

To use one of the ffmpeg-backed codecs:

```conf
[compressed]
codec = opus
```

Install `ffmpeg` on Ubuntu only if you want to use `opus`, `aac`, or `hls`:

```bash
sudo apt install ffmpeg
```

To disable all compressed audio, set this in `server.conf`:

```conf
[compressed]
enabled = false
```

The default Opus bitrate is `24k`. Override it in `server.conf` when `codec = opus`:

```conf
[compressed]
opus_bitrate = 16k
```

The default AAC bitrate is `32k`. Override it when `codec = aac` or `codec = hls`:

```conf
[compressed]
aac_bitrate = 24k
```

For ADPCM listeners, the server sends no audio frames while UDP is idle. The browser keeps the connection open and locally displays silence until new UDP audio arrives.

For ffmpeg-backed compressed listeners, the server can send compressed silence while UDP is idle so media decoders keep the stream open when RTLSDR-Airband uses `continuous = false`.

The silence keepalive interval defaults to `1000 ms`. Override it with:

```conf
[compressed]
keepalive_ms = 100
```

## Player controls

The stream page shows listener count, UDP/stream state, buffering, bandwidth, last transmission time, mode, gain, waveform, and audio level.

When the stream has been validated by at least one UDP packet, the status changes to `Connected`. Pressing `Connected` switches the page to `Reconnect`, closes only the audio stream socket, and stops bandwidth consumption without closing the web page or the control/status connection. Pressing `Reconnect` resumes the same mode that was active before pausing.

The main page lists all configured feeds under `Realtime Airband Streams`, shows the active user count, language selector, route, channel/sample-rate information, and the server-side last transmission time for each feed.
