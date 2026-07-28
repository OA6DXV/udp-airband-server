# Changelog

## 1.8-unstable - Unreleased

### English

- Added secure Web Admin authentication with hardened sessions, CSRF protection, login rate limiting, and challenge handling.
- Made SQLite the exclusive runtime database for listener metrics, Last Heard, geolocation, and Web Admin authentication.
- Changed `--migrate` to a one-way legacy JSON-to-SQLite import that preserves the source files in a timestamped backup directory.
- Added a startup warning when legacy JSON runtime data still needs migration, while Node.js 22.13+ uses built-in `node:sqlite` silently and older runtimes receive `better-sqlite3` installation guidance.

### Espanol

- Se agrego autenticacion segura para Web Admin con sesiones reforzadas, proteccion CSRF, limites de intentos de login y sistema de desafios.
- SQLite paso a ser la unica base de datos de ejecucion para metricas de listeners, Last Heard, geolocalizacion y autenticacion de Web Admin.
- `--migrate` ahora importa unicamente de JSON heredado a SQLite y conserva los archivos originales en una carpeta de respaldo con fecha.
- Se agrego una alerta al detectar datos JSON pendientes de migracion; Node.js 22.13+ usa `node:sqlite` sin avisos y los runtimes antiguos reciben instrucciones para instalar `better-sqlite3`.

## 1.7-preview - Unreleased

### English

- Started the 1.7 preview cycle.
- Added a Web Admin server on a separate loopback-only port, configurable from `[admin]` in `server.conf` or overridden at startup with `--webserver PORT` / `--webadmin PORT`.
- Added live `streams.json` editing from Web Admin, including validation, safe file writes, UDP socket rebinding, rollback on bind failure, and listener-preserving display-name updates.
- Added a `Reload streams` action for applying disk changes without a full server restart, with a pending-change pulse after saved stream edits.
- Added a `Discard changes` action to restore the latest loaded stream configuration before applying edits.
- Added runtime-aware server controls: console runs are shown as shutdown actions, while `systemd` runs show restart warnings intended for auto-restarting services.
- Added Web Admin online/restarting/offline status handling that recovers automatically when the server comes back.
- Added EN/ES language switching to Web Admin.
- Added persistent unique-user history with a 12-hour administration chart.
- Added `--help` / `-h` command-line documentation and refined Web Admin action buttons so Apply/Discard only enable when stream configuration really changed.
- Added selectable JSON or SQLite runtime persistence for connected-user history and Last Heard values.
- Added bidirectional, non-destructive `--migrate [json|sqlite]` storage migration with destination-data merging, interactive `Y/N` confirmation, automatic opposite-backend selection when no target is provided, and automatic `[storage].backend` updates in `server.conf`.
- Kept JSON as the default runtime storage backend for compatibility, while recommending SQLite at startup with a readable warning block and Node.js version-specific migration guidance.
- Added privacy-preserving ipwhois geolocation enabled by default with `/24` IPv4 and `/48` IPv6 anonymization, a 30-day JSON/SQLite cache, local-address exclusion, request deduplication, and rate-limit backoff.
- Added ISO country-code storage to the geolocation cache so Web Admin maps can use aggregated country/city data later.
- Extended storage migration to carry the geolocation cache bidirectionally without replacing newer destination records.
- Added a Web Admin stream-configuration revert button for restoring the state that existed before the last applied change.
- Changed the default Web Admin port to `8584`, removed the public `/status` API, and moved the reserved future API key setting to `[geo].key`.
- Added live stream-configuration notifications: label changes update open hub, single-player, and Multi Stream pages without interrupting audio, while incompatible stream changes stop affected players and guide listeners back to the refreshed home page.
- Refined Web Admin change notices so display-name-only edits do not request reloads, while unnecessary reloads ask for confirmation before interrupting listeners.
- Refined the Web Admin connected-user chart scale and added a placeholder connected-users detail page.
- Added a privacy-preserving Google GeoChart to Web Admin with country totals, up to three leading cities in localized tooltips, and selectable country details.
- Documented Web Admin usage in both English and Spanish README files.

### Espanol

- Se inicio el ciclo preview de 1.7.
- Se agrego un servidor Web Admin en un puerto separado solo en loopback, configurable desde `[admin]` en `server.conf` o sobrescrito al iniciar con `--webserver PUERTO` / `--webadmin PUERTO`.
- Se agrego edicion en vivo de `streams.json` desde Web Admin, con validacion, escritura segura del archivo, reapertura de sockets UDP, restauracion ante errores de bind y cambios de nombres visibles sin interrumpir listeners.
- Se agrego la accion `Reload streams` para aplicar cambios desde disco sin reiniciar todo el servidor, con parpadeo pendiente despues de guardar ediciones.
- Se agrego la accion `Discard changes` para restaurar la ultima configuracion cargada antes de aplicar cambios.
- Se agregaron controles de servidor segun el entorno: en consola se muestran como apagado, mientras que bajo `systemd` se muestran advertencias de reinicio pensadas para servicios con auto-restart.
- Se agrego estado online/restarting/offline en Web Admin con recuperacion automatica cuando el servidor vuelve.
- Se agrego selector de idioma EN/ES en Web Admin.
- Se agrego historial persistente de usuarios unicos con una grafica administrativa de 12 horas.
- Se agrego documentacion de flags con `--help` / `-h` y se ajustaron los botones Apply/Discard para activarse solo cuando la configuracion de streams realmente cambio.
- Se agrego persistencia seleccionable JSON o SQLite para el historial de usuarios conectados y los valores Last Heard.
- Se agrego migracion bidireccional y no destructiva con `--migrate [json|sqlite]`, combinando los datos existentes en el destino, confirmacion interactiva `Y/N`, seleccion automatica del backend contrario cuando no se indica destino y actualizacion automatica de `[storage].backend` en `server.conf`.
- Se mantuvo JSON como backend de almacenamiento predeterminado por compatibilidad, recomendando SQLite al iniciar con un bloque de warning legible segun la version de Node.js.
- Se agrego geolocalizacion ipwhois activada por defecto con privacidad, anonimizacion IPv4 `/24` e IPv6 `/48`, cache JSON/SQLite de 30 dias, exclusion de direcciones locales, deduplicacion de consultas y pausa ante limites de la API.
- Se agrego almacenamiento de codigo ISO de pais al cache de geolocalizacion para que luego Web Admin pueda usar datos agregados por pais/ciudad en mapas.
- Se amplio la migracion para transferir el cache de geolocalizacion en ambas direcciones sin reemplazar registros mas recientes en el destino.
- Se agrego un boton en Web Admin para revertir la configuracion de streams al estado anterior al ultimo cambio aplicado.
- Se cambio el puerto predeterminado de Web Admin a `8584`, se elimino la API publica `/status` y se movio el campo reservado de API key futura a `[geo].key`.
- Se agregaron notificaciones en vivo de configuracion: los cambios de etiqueta actualizan el hub, reproductores individuales y Multi Stream sin interrumpir el audio, mientras que los cambios incompatibles detienen los reproductores afectados y guian al listener de vuelta a la pagina principal actualizada.
- Se ajustaron los avisos de Web Admin para que cambios solo de nombre visible no pidan recarga, mientras que recargas innecesarias pidan confirmacion antes de interrumpir listeners.
- Se ajusto la escala del grafico de usuarios conectados en Web Admin y se agrego una pagina base para el detalle de usuarios conectados.
- Se agrego un Google GeoChart con privacidad a Web Admin, con totales por pais, hasta tres ciudades principales en tooltips localizados y detalle seleccionable por pais.
- Se documento el uso de Web Admin en los README en ingles y espanol.

## 1.6 - 2026-07-26

### English

- Added persistent server-side Last Heard storage in `data/last-heard.json`, so stream activity survives server restarts.
- Added active-session disconnect/restart notices for single-stream and Multi Stream pages.
- Restored the DeepWiki link in the English and Spanish README files.

### Espanol

- Se agrego persistencia server-side de Last Heard en `data/last-heard.json`, para que la actividad de streams sobreviva reinicios del servidor.
- Se agregaron avisos de desconexion/reinicio para sesiones activas en paginas single-stream y Multi Stream.
- Se restauro el link de DeepWiki en los README en ingles y espanol.

## 1.5 - 2026-07-01

### English

- Improved Compatible AAC playback by seeking native browser audio closer to the live edge on startup for Multi Stream and individual players.
- Refined Multi Stream Compatible Mode with the same compact per-stream layout on desktop and mobile, plus clearer Realtime/Compatible mode controls.
- Improved individual stream startup: playback can start from the informational notice, mute/unmute states are clearer, and Last Heard stays in seconds for up to 20 seconds.
- Added per-tab acknowledgements for individual and Multi Stream mode notices while keeping playback defaults device-based on each new session.
- Updated the main page title to `Real-Time Airband Audio`, improved Multi Stream selection requirements, and polished compatible-mode orange states.

### Espanol

- Se mejoro la reproduccion AAC Compatible acercando el audio nativo al borde en vivo al iniciar Multi Stream y reproductores individuales.
- Se refino Multi Stream Compatible Mode con el mismo diseno compacto por stream en escritorio y movil, ademas de controles Realtime/Compatible mas claros.
- Se mejoro el inicio de streams individuales: el audio puede arrancar desde el aviso informativo, mute/unmute es mas claro, y Last Heard se mantiene en segundos hasta 20 segundos.
- Se agrego memoria por pestana para avisos de modo en streams individuales y Multi Stream, manteniendo los modos por defecto segun el dispositivo en cada nueva sesion.
- Se actualizo el titulo principal a `Real-Time Airband Audio`, se mejoro el requisito de seleccion de Multi Stream y se pulieron los estados naranjas del modo Compatible.

## 1.4 - 2026-06-11

### Added

- Added the first Multi Stream preview workflow for selecting two or more configured streams from the main page.
- Added a dedicated `/multi` player page with per-stream cards, shared status controls, total playback bandwidth, users, language selection, and local/UTC time.
- Added per-stream audio controls for mode selection, start/mute, last heard, and a combined level meter plus gain slider.
- Added `[api] enabled = false` to `server.conf`, automatic config migration for missing default settings, and `-A` to manually enable public `/status` endpoints.
- Added an unstable native AAC background-audio path for `/multi` that mixes selected streams server-side and plays them through a real `<audio>` element.
- Added server-side per-stream gain updates for the native `/multi` AAC mixer as a first step toward independent background-mode volume control.

### Changed

- Updated the software version to `1.4`.
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
