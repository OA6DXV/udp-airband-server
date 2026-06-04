# Changelog

## 1.3-preview - Unreleased

### Added

- Added `tools/tone.py` for sending a continuous 1 kHz f32le UDP test tone to the example `test` stream.
- Added `tools/file-to-udp.py` for converting audio files through `ffmpeg` and sending them as timed f32le UDP chunks.
- Added `tools/README.md` with tool descriptions and execution examples.

### Changed

- Updated the development version string to `1.3-preview`.
- Updated the second example stream from `atis` to `test` with label `Testing UDP Input`, UDP port `8690`, 8000 Hz, mono.
- Updated the main README with concise descriptions of the project files and moved test-tool instructions to `tools/README.md`.
- Matched the main page user counter and language selector styling to the stream page.

## 1.2 - 2026-06-04

Production release focused on making compressed mobile playback usable without relying on the experimental HLS/AAC path.

### Added

- Added low-latency IMA ADPCM over WebSocket as the default `Compressed` codec.
- Added ADPCM frames with decoder state so clients can resync after silence gaps or late joins.
- Added `Idle` / `Reconnect` behavior to stop only the audio data stream without closing the page.
- Added the `Realtime Airband Streams` main page with active users, language selection, route/channel/sample-rate details, and last transmission time per feed.
- Added `CHANGELOG.md`.

### Changed

- Desktop browsers default to `Uncompressed`; mobile browsers default to `Compressed`.
- ADPCM sends audio frames only while UDP audio is present, reducing bandwidth during closed-squelch idle periods.
- ADPCM keeps adaptive state across active audio and uses light smoothing to reduce granular noise and harsh high-frequency artifacts.
- Gain/start controls were moved below the statistics area and above the waveform.
- The status box becomes a green `Connected` button after valid UDP is confirmed, then a yellow `Reconnect` button while idle.
- `Reconnect` resumes the same mode that was active before entering `Idle`.
- Production release workflow now keeps ongoing work in `development` and promotes release commits to `main`.

### Deferred

- HLS/AAC remains in the codebase as an experimental compressed backend, but production testing is paused while ADPCM is evaluated as the lower-latency mobile-friendly compressed path.
- WebRTC/Opus remains a future candidate for a more complete real-time compressed transport.

## 1.1 - 2026-06-03

Feature preview release that introduced the larger UI/configuration refactor and the first iOS compressed-audio experiments.

### Added

- Added English/Spanish UI language selection.
- Added local and UTC clock boxes.
- Added server-level configuration through `server.conf`, including UDP/web bind settings, SSL certificate paths, and compressed audio controls.
- Added optional HTTPS/TLS support directly in the Node server.
- Added configurable compressed codec backends and ffmpeg settings.
- Added experimental iOS compressed playback paths using AAC and native HLS.
- Added frontend asset separation with `assets/style.css` and `assets/app.js`.
- Added modular server internals under `lib/`, including `lib/compressed/`.

### Changed

- Changed visible audio mode labels from `RAW` / `OPUS` to `Uncompressed` / `Compressed`.
- Raised maximum gain to 150%.
- Refined last heard labels to show `Now`, then seconds ago, then the last transmission clock time.
- Reduced compressed silence keepalive bandwidth for ffmpeg-backed compressed modes.
- Improved compressed playback startup, live-buffer trimming, bandwidth reporting, buffered time display, waveform, and level meter behavior.

### Fixed

- Fixed mode button text not updating before audio start.
- Fixed stale compressed reconnect behavior.
- Fixed uncompressed waveform remaining frozen after UDP audio stopped.
- Fixed server crash caused by compressed client writability checks when an expected socket was missing.
- Improved HLS segment serving resilience while testing iOS compatibility.

### Note

- The 1.1 release line exposed important mobile compressed-audio issues, so the project continued on `development` until the 1.2 ADPCM production release.

## 1.0.1 - 2026-06-03

First production preview.

### Added

- Added the initial Node-managed web player for RTLSDR-Airband UDP float PCM streams.
- Added multi-feed stream configuration through `streams.js` / stream JSON data.
- Added uncompressed float32 PCM playback over WebSocket.
- Added basic web UI with stream status, buffering, bandwidth, mode, gain, waveform, and level meter.
- Added active listener counting and listener status tracking.
- Added server-side last heard tracking so newly connected users can see recent frequency activity.
- Added TLS/HTTPS support and certificate configuration.

### Changed

- Reported software version as `1.0.1` for the first preview release.
- Began treating `main` as the production release branch.

### Fixed

- Fixed status reporting so `Connected` is only shown after UDP audio is actually received.
- Added backpressure handling and active-listener cleanup to avoid stale clients.
