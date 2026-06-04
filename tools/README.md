# Tools

Small helper scripts for testing UDP Airband Server without RTLSDR-Airband.

The example stream in `streams.example.json` includes a `test` feed on UDP port `8690`, 8000 Hz, mono. These tools use that target by default.

## `tone.py`

Generates a continuous 1 kHz sine tone as 32-bit little-endian float PCM and sends it by UDP to `127.0.0.1:8690`.

Use it for a quick signal-path test: if the server is running with the example streams, open `/test`, press `Start Audio`, and run:

```bash
python3 tools/tone.py
```

The script has no command-line arguments. Stop it with `Ctrl+C`.

## `file-to-udp.py`

Reads an audio file through `ffmpeg`, filters it for voice-band testing, converts it to f32le PCM, and sends timed UDP chunks to the server.

The script applies:

- high-pass filter at 300 Hz
- low-pass filter at 3000 Hz
- configurable volume
- output format: 32-bit little-endian float PCM

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

`file-to-udp.py` requires `ffmpeg` in `PATH`.
