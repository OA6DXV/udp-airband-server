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
      "name": "atis",
      "label": "ATIS 127.800",
      "udpPort": 8687,
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
http://SERVER_IP:8585/atis
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

For a second stream:

```conf
outputs: (
  {
    type = "udp_stream";
    dest_address = "127.0.0.1";
    dest_port = 8687;
    continuous = true;
  }
);
```

## Quick synthetic test

From WSL/Linux, send a 1 kHz float32 tone to the `tower` stream:

```bash
python3 - <<'PY'
import math, socket, struct, time
rate = 8000
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
n = 0
while True:
    samples = [0.2 * math.sin(2 * math.pi * 1000 * (n + i) / rate) for i in range(rate // 8)]
    n += len(samples)
    sock.sendto(struct.pack('<%df' % len(samples), *samples), ('127.0.0.1', 8686))
    time.sleep(0.125)
PY
```

In RAW mode, the player forwards UDP packets as WebSocket binary frames, so latency stays low and the browser receives the same float PCM shape as the original stream.

## Uncompressed and compressed modes

The browser can play either:

- `Uncompressed`: the original float32 PCM stream over WebSocket.
- `Compressed`: low-latency IMA ADPCM over WebSocket by default.

ADPCM is designed for intermittent RTLSDR-Airband UDP output. The server sends compressed frames only when UDP audio arrives, so idle squelch periods do not consume audio bandwidth. Each ADPCM frame includes its own decoder state, allowing newly connected clients or clients after a silence gap to resynchronize immediately.

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
- `hls`: experimental HLS/AAC route, requires `ffmpeg`.

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
