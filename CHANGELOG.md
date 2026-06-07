# Changelog

## 1.4-preview - Unreleased

### Added

- Added the first Multi Stream preview workflow for selecting two or more configured streams from the main page.
- Added a dedicated `/multi` player page with per-stream cards, shared status controls, total playback bandwidth, users, language selection, and local/UTC time.
- Added per-stream audio controls for mode selection, start/mute, last heard, and a combined level meter plus gain slider.
- Added `[api] enabled = false` to `server.conf`, automatic config migration for missing default settings, and `-A` to manually enable public `/status` endpoints.
- Added an unstable native AAC background-audio path for `/multi` that mixes selected streams server-side and plays them through a real `<audio>` element.
- Added server-side per-stream gain updates for the native `/multi` AAC mixer as a first step toward independent background-mode volume control.

### Changed

- Updated the software version to `1.4-preview`.
- The main page now shows a Multi Stream card only when two or more streams are configured.
- Expected client/proxy socket closes such as `EPIPE` and `ECONNRESET` are now logged as debug-only `client_socket_closed` events instead of production warnings.
- Multi Stream selection now uses a slower border-only breathing animation on stream cards, and the `/multi` page now embeds stream configuration as valid JSON.
- Once a stream is selected, the `Start Multi Stream` card pulses from its normal background to green every 2 seconds.
- Public `/status` endpoints are disabled by default, and the home page no longer polls status over HTTP.
- Multi Stream now counts the same browser session as one user across selected streams, shows dB on the level meter, and only reveals the gain percentage while hovering or interacting with the slider.
- Pressing `Select streams` again exits Multi Stream selection when no streams have been selected.
- Multi Stream cards now use a compact mobile portrait layout and show stream name plus last heard in one line.
- Multi Stream now exposes global Uncompressed/Compressed mode buttons above the stream list.

## 1.3 - 2026-06-04

Release focused on documentation, operational readiness, safer public status output, and service-friendly configuration/logging.

### Added

- Added `tools/tone.py` for sending a continuous 1 kHz f32le UDP test tone to the example `test` stream.
- Added `tools/file-to-udp.py` for converting audio files through `ffmpeg` and sending them as timed f32le UDP chunks.
- Added English and Spanish tool documentation with descriptions, execution examples, and argument reference.
- Added full English and Spanish README documentation covering RTLSDR-Airband, UDP audio, server configuration, RTLSDR-Airband `udp_stream` setup, HTTPS/TLS, self-signed certificates, logging, and test tools.
- Added `server.conf` as the default editable server configuration file.
- Added a built-in fallback `test` stream on UDP port `8690` when `streams.json` is missing.
- Added favicon support for all pages.
- Added project/version footer on the main page linked to the GitHub repository.
- Added startup log lines showing each stream bind, route, label, channel count, and sample rate.
- Added configurable service logging with levels, optional timestamps, optional colors, and a manual `-D` debug mode.
- Added ffmpeg process logging for Opus/AAC/HLS debugging, including stderr capture in debug mode.
- Added security headers for HTML, JSON, assets, and error responses.
- Added `package-lock.json` so dependency auditing can run reproducibly.

### Changed

- Updated the software version to `1.3`.
- Updated the second example stream from `atis` to `test` with label `Testing UDP Input`, UDP port `8690`, 8000 Hz, mono.
- Updated the main README with concise descriptions of the project files and moved test-tool instructions to `tools/README.md`.
- Matched the main page user counter and language selector styling to the stream page.
- Changed SSL behavior so enabling SSL switches the web player to HTTPS on the same `[web].port` instead of starting a second HTTPS listener. If certificates are missing or invalid, the server logs a warning and falls back to HTTP.
- Changed startup summary logging so the final `INFO startup` line appears after the `Web player` line.
- Changed `INFO` and `DEBUG` console logs to remain uncolored; `WARN` is yellow and `ERROR` is red when colors are enabled.
- Changed missing `server.conf` handling to warn and continue with built-in defaults, while the repository now ships with `server.conf` by default.

### Security

- Removed UDP bind host, UDP port, raw client counts, packet counters, byte counters, listener lists, and client IDs from public `/status`, `/status/:stream`, and control WebSocket config/stats payloads.
- Added safe handling for malformed percent-encoded request paths; invalid paths now return `400 Bad Request` instead of being decoded unsafely.
- Added `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a Content Security Policy header.

### Verified

- Ran syntax checks for server and browser JavaScript.
- Ran `npm audit --omit=dev` with zero reported vulnerabilities.
- Dynamically verified public status and control WebSocket payloads do not expose UDP IP/port or listener identifiers.
- Verified malformed URL handling, security headers, HLS segment path rejection, and SSL fallback behavior.

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
