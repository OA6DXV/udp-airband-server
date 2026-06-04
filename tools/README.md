# Tools

Small helper scripts for testing UDP Airband Server without running RTLSDR-Airband.

The example stream in `streams.example.json` includes a `test` feed on UDP port `8690`, `8000 Hz`, mono. These tools use that target by default, so they are useful for checking whether the server, browser player, waveform, level meter, and bandwidth display are working before connecting a real receiver.

Spanish documentation is available in [`README.es.md`](README.es.md).

## `tone.py`

`tone.py` generates a continuous 1 kHz sine tone as 32-bit little-endian float PCM and sends it by UDP to `127.0.0.1:8690`.

Use it for a quick signal-path test. Start UDP Airband Server with the example stream configuration, open `/test`, press `Start Audio`, and run:

```bash
python3 tools/tone.py
```

The script has no command-line arguments. Stop it with `Ctrl+C`.

What it does internally:

- generates 8000 Hz mono audio
- creates 125 ms chunks
- packs samples as `f32le`
- sends each chunk to UDP port `8690`
- sleeps between chunks so the stream behaves like real-time audio

## `file-to-udp.py`

`file-to-udp.py` reads an audio file through `ffmpeg`, filters it for voice-band testing, converts it to `f32le` PCM, and sends timed UDP chunks to the server.

Use it when you want a more realistic test than a sine tone, for example a recorded voice clip or a sample radio transmission.

The script applies:

- high-pass filter at 300 Hz
- low-pass filter at 3000 Hz
- configurable volume
- output format: 32-bit little-endian float PCM
- real-time pacing based on sample rate, channels, and bytes per sample

Basic example:

```bash
python3 tools/file-to-udp.py sample.wav
```

Loop a file into the default `test` stream:

```bash
python3 tools/file-to-udp.py sample.mp3 --loop
```

Send to a different host or port:

```bash
python3 tools/file-to-udp.py sample.wav --ip 192.0.2.10 --port 8690
```

Match a different stream format:

```bash
python3 tools/file-to-udp.py sample.wav --rate 16000 --channels 1
```

Lower or raise the level:

```bash
python3 tools/file-to-udp.py sample.wav --volume 0.25
```

Available arguments:

- `input_file`: audio file to read.
- `--ip`: destination IP address. Default: `127.0.0.1`.
- `--port`: destination UDP port. Default: `8690`.
- `--rate`: output sample rate. Default: `8000`.
- `--channels`: output channel count. Default: `1`.
- `--volume`: ffmpeg volume multiplier. Default: `0.35`.
- `--loop`: restart the file when it reaches the end.

`file-to-udp.py` requires `ffmpeg` in `PATH`.
