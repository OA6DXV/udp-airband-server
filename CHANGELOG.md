# Changelog

## 1.2 - 2026-06-04

### Added

- Added the `development` branch workflow and promoted this release to `main` only after the feature set was ready for production.
- Added server-level configuration through `server.conf`, including UDP/web bind settings, SSL certificate paths, and compressed audio controls.
- Added optional HTTPS/TLS support directly in the Node server.
- Added active listener tracking and real-time user counts.
- Added server-side last transmission tracking so new visitors can see recent activity even if they did not hear the transmission live.
- Added English/Spanish UI language selection.
- Added local and UTC clocks.
- Added `Idle` / `Reconnect` behavior so listeners can stop the audio data stream without closing the page.
- Added low-latency IMA ADPCM over WebSocket as the default `Compressed` codec for mobile clients.

### Changed

- Split the frontend into `index.html`, `assets/style.css`, and `assets/app.js`.
- Split server internals into `lib/` modules, including `lib/compressed/` for compressed audio backends.
- Desktop browsers now default to `Uncompressed`; mobile browsers default to `Compressed`.
- `Compressed` now uses ADPCM by default and no longer requires `ffmpeg`.
- ADPCM sends frames only when UDP audio is present, reducing bandwidth during closed-squelch idle periods.
- ADPCM frames include decoder state for quick resync after silence gaps or late client joins.
- ADPCM now keeps adaptive state during active audio and applies light smoothing to reduce granular noise and harsh high-frequency artifacts.
- Main stream list now shows `Realtime Airband Streams`, active users, language selection, route/channel/sample-rate details, and last transmission time without showing UDP ports.
- Gain/start controls were moved below the statistics area and above the waveform.
- Last heard labels now show `Now`, then seconds ago, then the last transmission clock time.
- Maximum gain is now 150%.
- UI labels changed from `RAW` / `OPUS` to `Uncompressed` / `Compressed`.

### Fixed

- Fixed stream status reporting so `Connected` is only shown after the server has actually received UDP audio.
- Fixed the waveform staying frozen in uncompressed mode after UDP audio stops.
- Fixed compressed mode UI updates, bandwidth reporting, buffered time display, waveform, and level meter behavior.
- Fixed stale reconnect behavior so `Reconnect` resumes the same mode that was active before entering `Idle`.
- Fixed a server crash caused by compressed client writability checks when an expected socket was missing.
- Improved HLS segment serving resilience while testing iOS compatibility.

### Deferred

- HLS/AAC remains in the codebase as an experimental compressed backend, but production testing is paused while ADPCM is evaluated as the lower-latency mobile-friendly compressed path.
- WebRTC/Opus remains a future candidate for a more complete real-time compressed transport.
