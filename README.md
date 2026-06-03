# UDP Airband Server

Receives RTLSDR-Airband `udp_stream` packets and plays them in a web browser.

The expected stream is raw 32-bit little-endian floating-point PCM:

- Mono: `L L L ...`
- Stereo: interleaved `L R L R ...`
- Sample rate: `8000 Hz` by default, or `16000 Hz` if RTLSDR-Airband was built with `NFM`

## Run

```bash
npm start -- --udp-port 7355 --http-port 8080 --sample-rate 8000 --channels 1
```

Then open:

```text
http://127.0.0.1:8080/
```

Click `Start Audio`. Browsers require a user gesture before audio playback starts.

## RTLSDR-Airband output config

Example mono output:

```conf
outputs: (
  {
    type = "udp_stream";
    dest_address = "127.0.0.1";
    dest_port = 7355;
    continuous = true;
  }
);
```

For stereo channels, run the bridge with:

```bash
npm start -- --udp-port 7355 --http-port 8080 --sample-rate 8000 --channels 2
```

If RTLSDR-Airband was built with `NFM`, use `--sample-rate 16000`.

## Quick synthetic test

From WSL/Linux, send a 1 kHz float32 tone:

```bash
python3 - <<'PY'
import math, socket, struct, time
rate = 8000
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
while True:
    samples = [0.2 * math.sin(2 * math.pi * 1000 * n / rate) for n in range(rate // 8)]
    sock.sendto(struct.pack('<%df' % len(samples), *samples), ('127.0.0.1', 7355))
    time.sleep(0.125)
PY
```

The player forwards UDP packets as WebSocket binary frames. It does not transcode to Opus or WAV, so latency stays low and the browser receives the same float PCM shape as the original stream.
