# UDP Airband Server

[Documento en espanol aqui](README.es.md)

UDP Airband Server is a small Node.js web server for listening to one or more [RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband) UDP audio outputs from a browser.

RTLSDR-Airband is an open-source airband receiver and streaming daemon. It uses SDR receivers to demodulate analog AM/NFM voice channels, commonly aviation frequencies, and can send each received channel to several outputs such as Icecast, PulseAudio, files, or raw UDP audio. See the [RTLSDR-Airband project](https://github.com/rtl-airband/RTLSDR-Airband) and its [UDP output documentation](https://github.com/rtl-airband/RTLSDR-Airband/wiki/Configuring-UDP-outputs) for the upstream receiver side.

This project sits after RTLSDR-Airband. RTLSDR-Airband receives and demodulates the radio signal, then sends raw audio samples by UDP. UDP Airband Server receives those UDP packets, tracks stream state, and exposes a browser player with listener counts, last transmission time, waveform, level meter, uncompressed playback, and a low-bandwidth compressed mode.

The goal is a simple private web listener for local or remote airband feeds: run RTLSDR-Airband near the antenna, send each channel as UDP audio to this server, then open the web page from a phone, tablet, or desktop browser.

## What Is UDP Audio?

RTLSDR-Airband `udp_stream` sends audio samples directly over UDP/IP. There is no playlist, media container, metadata protocol, or reconnect negotiation in the UDP stream itself. It is just raw PCM sample data sent to an IP address and port.

For this server, each UDP stream is expected to be 32-bit little-endian floating-point PCM:

- Mono: `L L L ...`
- Stereo: interleaved `L R L R ...`
- Sample rate: usually `8000 Hz`, or `16000 Hz` when RTLSDR-Airband was built with NFM support

The useful part of this approach is latency and simplicity. RTLSDR-Airband can keep using its native UDP output, while this server handles the browser-specific work: WebSockets, compressed audio framing, status display, language selection, active users, and web UI.

## Files

- `server.js`: Node.js entry point. It starts the UDP listeners, HTTP/HTTPS web server, stream routes, status handling used by the UI, and compressed-audio backends.
- `server.example.conf`: example server-level configuration. Copy it to `server.conf` and set web bind addresses, ports, SSL/TLS certificate paths, and compressed-audio options.
- `streams.example.json`: example stream configuration. Copy it to `streams.json`; this is where feed names, labels, UDP ports, sample rates, and channel counts are defined.
- `index.html`: stream player HTML shell used for each individual feed page.
- `assets/style.css`: CSS for the stream player and responsive UI.
- `assets/app.js`: browser-side player logic: audio decoding/playback, UI state, status updates, language switching, waveform, level meter, bandwidth display, and reconnect/idle behavior.
- `assets/favicon.ico`: browser icon served by all pages.
- `lib/config.js`: parser and defaults for `server.conf`.
- `lib/streams.js`: stream configuration loader and main feed-list page renderer.
- `lib/listeners.js`: active-listener tracking shared by the web UI and server state.
- `lib/clients.js`: client helpers for stream connections.
- `lib/websocket.js`: WebSocket framing and helpers.
- `lib/compressed/`: compressed audio implementations. ADPCM is the default; Opus, AAC, and HLS are kept as optional or experimental backends.
- `tools/`: helper scripts for generating test UDP audio without RTLSDR-Airband.

## Installation

Clone the repository and install the Node.js dependencies:

```bash
git clone https://github.com/OA6DXV/udp-airband-server.git
cd udp-airband-server
npm install
```

Copy the example configuration files:

```bash
cp server.example.conf server.conf
cp streams.example.json streams.json
```

## Server Configuration

`server.conf` controls how this web server listens and where it loads the stream list from:

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
host = 0.0.0.0
port = 8443
key =
cert =
redirect_http_to_https = false

[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 40
ffmpeg = ffmpeg
opus_bitrate = 24k
aac_bitrate = 32k
keepalive_ms = 1000
```

Important fields:

- `[udp].host`: default UDP bind address used by streams that do not define their own `udpHost`.
- `[web].host` and `[web].port`: HTTP bind address and port for the browser interface.
- `[streams].file`: JSON file that defines the feeds.
- `[ssl]`: optional HTTPS listener. Enable it and provide `key` and `cert` paths when you want Node.js to serve TLS directly.
- `[compressed].enabled`: set to `false` to disable all compressed modes and their transcoding/framing logic.
- `[compressed].codec`: compressed mode backend. `adpcm` is the default low-latency option and does not require `ffmpeg`.

`streams.json` defines the actual feeds:

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

Important fields:

- `name`: URL-safe stream id. A stream named `tower` is available at `/tower`.
- `label`: display name shown in the UI.
- `udpPort`: UDP port where this server listens for RTLSDR-Airband audio.
- `sampleRate`: sample rate of the incoming float PCM audio.
- `channels`: `1` for mono or `2` for stereo/interleaved input.
- `udpHost`: optional per-stream UDP bind address. When omitted, `[udp].host` is used.

The sample configuration creates:

```text
http://SERVER_IP:8585/
http://SERVER_IP:8585/tower
http://SERVER_IP:8585/test
```

## RTLSDR-Airband Configuration

In RTLSDR-Airband, each channel that should appear in the web player must have an `udp_stream` output pointing to this server.

If RTLSDR-Airband and UDP Airband Server run on the same host:

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

If RTLSDR-Airband runs on a different machine, use the IP address of the machine running UDP Airband Server:

```conf
outputs: (
  {
    type = "udp_stream";
    dest_address = "192.0.2.25";
    dest_port = 8686;
    continuous = true;
  }
);
```

For the example `test` stream:

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

The `dest_port` value in RTLSDR-Airband must match `udpPort` in `streams.json`. The sample rate and channel count in `streams.json` must also match the audio produced by RTLSDR-Airband.

`continuous = true` is recommended because it keeps the receiver output active and makes browser playback easier to keep synchronized. The server still tracks actual UDP activity and reports `Waiting for UDP` until at least one packet is received.

## Starting The Server

Start with the default local config files:

```bash
npm start
```

Or pass explicit config paths:

```bash
npm start -- \
  --server-config /etc/udp-airband-server/server.conf \
  --config /etc/udp-airband-server/streams.json
```

Then open the home page:

```text
http://SERVER_IP:8585/
```

Open a stream page, then press `Start Audio`. Browsers require a user gesture before audio playback can begin.

## HTTPS / TLS

The server can serve HTTPS directly when SSL is enabled:

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
https://SERVER_IP:8443/
```

The HTTP listener still starts by default so existing deployments do not break. Use firewall rules or a reverse proxy if you want only HTTPS exposed publicly.

## Uncompressed And Compressed Modes

The browser can play either:

- `Uncompressed`: original float32 PCM over WebSocket. This is the default on desktop browsers.
- `Compressed`: low-latency IMA ADPCM over WebSocket by default. This is the default on mobile browsers.

ADPCM is designed for intermittent radio audio. The server sends compressed frames only when UDP audio arrives, so idle squelch periods do not consume audio bandwidth. Each ADPCM frame includes enough decoder state for new clients, or clients after a silence gap, to resynchronize quickly.

Compressed mode defaults to:

```conf
[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 40
```

Supported compressed codecs:

- `adpcm`: default, low latency, no `ffmpeg` required.
- `opus`: Opus/WebM over WebSocket or HTTP fallback, requires `ffmpeg`.
- `aac`: AAC over WebSocket/MediaSource, requires `ffmpeg`.
- `hls`: experimental HLS/AAC route, requires `ffmpeg`. This path is kept in the codebase but is currently on hold while ADPCM is tested as the mobile-friendly compressed mode.

Install `ffmpeg` only if you want to use `opus`, `aac`, or `hls`:

```bash
sudo apt install ffmpeg
```

To disable compressed audio completely:

```conf
[compressed]
enabled = false
```

## Player Controls

The stream page shows listener count, UDP/stream state, buffering, bandwidth, last transmission time, mode, gain, waveform, and audio level.

When the stream has been validated by at least one UDP packet, the status changes to `Connected`. Pressing `Connected` switches the page to `Push to Reconnect`, closes only the audio stream socket, and stops bandwidth consumption without closing the web page or the control/status connection. Pressing `Push to Reconnect` resumes the same mode that was active before pausing.

The home page lists all configured feeds under `Real-time Airband audio streams`, shows the active user count, language selector, route, channel/sample-rate information, and the server-side last transmission time for each feed.

## Test Tools

The `tools/` directory contains helper scripts for sending synthetic or file-based audio to the example `test` UDP stream on port `8690`.

See [`tools/README.md`](tools/README.md) for usage details.
