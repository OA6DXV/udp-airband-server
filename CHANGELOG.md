# Changelog

## 1.8 - 2026-07-29

### English

- Added hardened Web Admin authentication with SQLite-backed sessions, CSRF protection, rate limiting, ALTCHA challenge support, secure/insecure admin modes, and HTTPS reverse-proxy support.
- Added multi-administrator account management from the server CLI, including create, password change, enable/disable, soft delete, lifecycle timestamps, hidden password prompts, and weak-password warnings.
- Added per-admin audit tracking for Web Admin changes, including administrator username, audit IP, session start/end timestamps, close reason, total changes, and a pre-change stream snapshot for future rollback.
- Added automatic first-run generation of private Web Admin secrets in `data/admin-secrets.env`, with startup guidance for backups and custom secret timing.
- Made SQLite the exclusive runtime database for listener metrics, Last Heard, geolocation, and Web Admin authentication.
- Changed `--migrate` to a one-way legacy JSON-to-SQLite import with timestamped JSON backups, SQLite integrity checks, and safe archival of stale JSON leftovers.
- Improved `server.conf` handling so local values survive updates, missing settings are appended through a temporary `server.conf.tmp`, and startup stops once configuration is upgraded for review.
- Added Web Admin certificate tooling with `--generate-cert`, OpenSSL self-signed certificate generation, direct HTTPS support, and clear warnings when secure admin mode requires HTTPS through certificates or a reverse proxy.

### Espanol

- Se agrego autenticacion reforzada para Web Admin con sesiones en SQLite, proteccion CSRF, limites de intentos, desafios ALTCHA, modos admin seguro/inseguro y soporte para HTTPS detras de reverse proxy.
- Se agrego gestion de multiples administradores desde la CLI del servidor, incluyendo creacion, cambio de contrasena, enable/disable, baja logica, timestamps de ciclo de vida, entrada oculta de contrasena y warnings para contrasenas debiles.
- Se agrego auditoria por administrador para cambios en Web Admin, incluyendo username, IP de auditoria, timestamps de inicio/fin de sesion, motivo de cierre, total de cambios y snapshot previo para rollback futuro.
- Se agrego generacion automatica de secretos privados de Web Admin en `data/admin-secrets.env`, con guia de inicio para backups y momento adecuado para secretos personalizados.
- SQLite paso a ser la unica base de datos de ejecucion para metricas de listeners, Last Heard, geolocalizacion y autenticacion de Web Admin.
- `--migrate` ahora importa solo de JSON heredado a SQLite, con backups JSON fechados, verificacion de integridad SQLite y archivado seguro de JSON sobrantes.
- Se mejoro el manejo de `server.conf` para conservar valores locales, agregar opciones faltantes mediante `server.conf.tmp` temporal y detener el arranque cuando la configuracion fue actualizada para que el usuario la revise.
- Se agrego tooling de certificados para Web Admin con `--generate-cert`, generacion self-signed con OpenSSL, HTTPS directo y warnings claros cuando el modo admin seguro requiere HTTPS por certificados o reverse proxy.

## 1.7-preview - Unreleased

### English

- Added the Web Admin server on a separate configurable port, with live `streams.json` editing, validation, safe writes, UDP rebinding, reload/revert/discard actions, and rollback on failed stream configuration changes.
- Added runtime-aware server controls for console and `systemd` deployments, including restart/shutdown warnings and online/offline recovery status in Web Admin.
- Added persistent administration metrics with a 12-hour unique-user chart and privacy-preserving listener geography based on anonymized ipwhois geolocation.
- Added Google GeoChart listener geography with country totals, leading city breakdowns, localized tooltips, and selectable country details.
- Added dynamic stream-configuration notifications so label-only changes update active pages without interrupting audio, while incompatible changes stop affected players and guide listeners back to the refreshed home page.
- Added EN/ES Web Admin translations and documented Web Admin usage in the English and Spanish README files.
- Changed the default Web Admin port to `8584` and removed the public `/status` API surface.

### Espanol

- Se agrego el servidor Web Admin en un puerto configurable separado, con edicion en vivo de `streams.json`, validacion, escritura segura, reapertura de UDP, acciones reload/revert/discard y rollback ante configuraciones de stream fallidas.
- Se agregaron controles de servidor conscientes del entorno para ejecuciones en consola y `systemd`, con advertencias de reinicio/apagado y estado online/offline recuperable en Web Admin.
- Se agregaron metricas administrativas persistentes con grafica de usuarios unicos de 12 horas y geografia de oyentes con privacidad basada en geolocalizacion ipwhois anonimizada.
- Se agrego Google GeoChart para geografia de oyentes con totales por pais, desglose de ciudades principales, tooltips localizados y detalle seleccionable por pais.
- Se agregaron notificaciones dinamicas de configuracion para que cambios solo de etiqueta actualicen paginas activas sin cortar audio, mientras que cambios incompatibles detienen reproductores afectados y guian al listener al home actualizado.
- Se agregaron traducciones EN/ES para Web Admin y documentacion de uso en los README en ingles y espanol.
- Se cambio el puerto predeterminado de Web Admin a `8584` y se elimino la superficie publica de API `/status`.

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
- Improved Multi Stream Compatible Mode behavior across desktop and mobile, including clearer Realtime/Compatible mode switching.
- Improved individual stream startup: playback can start from the informational notice, mute/unmute states are clearer, and Last Heard stays in seconds for up to 20 seconds.
- Added per-tab acknowledgements for individual and Multi Stream mode notices while keeping playback defaults device-based on each new session.
- Improved Multi Stream selection requirements and clarified mode defaults for individual and Multi Stream playback.

### Espanol

- Se mejoro la reproduccion AAC Compatible acercando el audio nativo al borde en vivo al iniciar Multi Stream y reproductores individuales.
- Se mejoro el comportamiento de Multi Stream Compatible Mode en escritorio y movil, incluyendo cambio mas claro entre modos Realtime/Compatible.
- Se mejoro el inicio de streams individuales: el audio puede arrancar desde el aviso informativo, mute/unmute es mas claro, y Last Heard se mantiene en segundos hasta 20 segundos.
- Se agrego memoria por pestana para avisos de modo en streams individuales y Multi Stream, manteniendo los modos por defecto segun el dispositivo en cada nueva sesion.
- Se mejoraron los requisitos de seleccion de Multi Stream y se aclararon los modos predeterminados para reproduccion individual y Multi Stream.

## 1.4 - 2026-06-11

### English

- Added the first Multi Stream workflow for selecting two or more configured streams from the main page and playing them from a dedicated `/multi` page.
- Added per-stream Multi Stream controls, total playback bandwidth, active users, language selection, local/UTC time, last heard, level metering, and gain control.
- Added an experimental native AAC background-audio path for Multi Stream that mixes selected streams server-side through a browser-native `<audio>` element.
- Added public API hardening by disabling `/status` by default and removing home-page status polling.
- Fixed noisy production logs from expected client/proxy socket closes by moving them to debug-only events.
- Fixed Multi Stream user counting so one browser session remains one user across selected streams.

### Espanol

- Se agrego el primer flujo Multi Stream para seleccionar dos o mas streams configurados desde la pagina principal y reproducirlos desde una pagina dedicada `/multi`.
- Se agregaron controles por stream en Multi Stream, ancho de banda total, usuarios activos, idioma, hora local/UTC, last heard, medidor de nivel y ganancia.
- Se agrego una ruta experimental AAC nativa para audio en background en Multi Stream, mezclando streams seleccionados en el servidor mediante un `<audio>` nativo del navegador.
- Se endurecio la API publica desactivando `/status` por defecto y eliminando el polling de status desde el home.
- Se corrigio el ruido en logs de produccion por cierres esperados de sockets de clientes/proxies, moviendolos a eventos solo debug.
- Se corrigio el conteo de usuarios en Multi Stream para que una sesion de navegador cuente como un solo usuario aunque escuche varios streams.

## 1.3 - 2026-06-04

Release focused on documentation, operational readiness, safer public status output, and service-friendly configuration/logging.

### English

- Added test tools under `tools/` for generating UDP tones and sending audio files as timed float PCM UDP chunks.
- Added full English and Spanish documentation for RTLSDR-Airband UDP audio, server configuration, HTTPS/TLS, logging, test tools, and deployment basics.
- Added `server.conf` as the default editable server configuration file and a built-in fallback `test` stream on UDP port `8690`.
- Added structured startup logging, configurable log levels, optional timestamps/colors, manual `-D` debug mode, and ffmpeg stderr capture for compressed-mode debugging.
- Added security headers and hardened public status/control payloads so UDP bind addresses, ports, listener identifiers, client IDs, and raw counters are not exposed.
- Added safe handling for malformed percent-encoded request paths.
- Added `package-lock.json` and verified the release with syntax checks and `npm audit --omit=dev`.

### Espanol

- Se agregaron herramientas en `tools/` para generar tonos UDP y enviar archivos de audio como bloques UDP float PCM temporizados.
- Se agrego documentacion completa en ingles y espanol sobre audio UDP de RTLSDR-Airband, configuracion del servidor, HTTPS/TLS, logging, herramientas de prueba y despliegue basico.
- Se agrego `server.conf` como archivo editable de configuracion por defecto y un stream fallback `test` en el puerto UDP `8690`.
- Se agrego logging estructurado de arranque, niveles configurables, timestamps/colores opcionales, modo debug manual `-D` y captura de stderr de ffmpeg para depurar modos comprimidos.
- Se agregaron headers de seguridad y se endurecieron los payloads publicos de status/control para no exponer direcciones UDP, puertos, identificadores de listeners, client IDs ni contadores raw.
- Se agrego manejo seguro de rutas malformadas con porcentajes invalidados.
- Se agrego `package-lock.json` y se verifico el release con checks de sintaxis y `npm audit --omit=dev`.

## 1.2 - 2026-06-04

Production release focused on making compressed mobile playback usable without relying on the experimental HLS/AAC path.

### English

- Added low-latency IMA ADPCM over WebSocket as the default `Compressed` codec, including decoder state for resync after silence gaps or late joins.
- Added `Idle` / `Reconnect` behavior to stop only the audio data stream without closing the page.
- Added the `Realtime Airband Streams` main page with active users, language selection, stream details, and last transmission time per feed.
- Changed desktop browsers to default to `Uncompressed` and mobile browsers to default to `Compressed`.
- Reduced compressed idle bandwidth by sending ADPCM frames only while UDP audio is present.
- Improved ADPCM audio quality with adaptive state and light smoothing.
- Established the release workflow where ongoing work stays in `development` and production releases are promoted to `main`.
- Deferred HLS/AAC and WebRTC/Opus while ADPCM was evaluated as the lower-latency compressed path.

### Espanol

- Se agrego IMA ADPCM de baja latencia sobre WebSocket como codec `Compressed` por defecto, incluyendo estado de decoder para resincronizar tras silencios o ingresos tardios.
- Se agrego comportamiento `Idle` / `Reconnect` para detener solo el flujo de datos de audio sin cerrar la pagina.
- Se agrego la pagina principal `Realtime Airband Streams` con usuarios activos, idioma, detalles de streams y hora de ultima transmision por feed.
- Se cambio el default de escritorio a `Uncompressed` y el de moviles a `Compressed`.
- Se redujo el ancho de banda en reposo enviando frames ADPCM solo cuando hay audio UDP.
- Se mejoro la calidad ADPCM con estado adaptativo y suavizado ligero.
- Se establecio el flujo de releases donde el trabajo continuo queda en `development` y produccion se promueve a `main`.
- Se dejaron HLS/AAC y WebRTC/Opus como candidatos futuros mientras ADPCM se evaluaba como ruta comprimida de menor latencia.

## 1.1 - 2026-06-03

Feature preview release that introduced the larger UI/configuration refactor and the first iOS compressed-audio experiments.

### English

- Added English/Spanish UI language selection, local/UTC clocks, server-level configuration through `server.conf`, optional HTTPS/TLS, configurable compressed backends, and ffmpeg settings.
- Added experimental iOS compressed playback paths using AAC and native HLS.
- Split frontend assets into `assets/style.css` and `assets/app.js`.
- Modularized server internals under `lib/`, including compressed backends under `lib/compressed/`.
- Changed mode labels from `RAW` / `OPUS` to `Uncompressed` / `Compressed`, raised maximum gain to 150%, and refined Last Heard behavior.
- Improved compressed startup, live-buffer trimming, bandwidth reporting, buffered time display, waveform, and level meter behavior.
- Fixed mode text updates, compressed reconnect behavior, frozen uncompressed waveform after UDP stopped, and a compressed-client writability crash.

### Espanol

- Se agrego seleccion de idioma EN/ES, relojes local/UTC, configuracion global mediante `server.conf`, HTTPS/TLS opcional, backends comprimidos configurables y opciones ffmpeg.
- Se agregaron rutas experimentales de reproduccion comprimida en iOS usando AAC y HLS nativo.
- Se separaron assets frontend en `assets/style.css` y `assets/app.js`.
- Se modularizaron internals del servidor bajo `lib/`, incluyendo backends comprimidos bajo `lib/compressed/`.
- Se cambiaron las etiquetas `RAW` / `OPUS` a `Uncompressed` / `Compressed`, se aumento la ganancia maxima a 150% y se refino Last Heard.
- Se mejoro el inicio comprimido, recorte de buffer en vivo, reporte de ancho de banda, tiempo buffered, waveform y medidor de nivel.
- Se corrigieron actualizaciones del texto de modo, reconexion comprimida, waveform uncompressed congelado al parar UDP y un crash de writability en clientes comprimidos.

## 1.0.1 - 2026-06-03

First production preview.

### English

- Added the initial Node-managed web player for RTLSDR-Airband UDP float PCM streams.
- Added multi-feed stream configuration through `streams.js` / stream JSON data.
- Added uncompressed float32 PCM playback over WebSocket.
- Added basic web UI with stream status, buffering, bandwidth, mode, gain, waveform, and level meter.
- Added active listener counting and server-side Last Heard tracking.
- Added TLS/HTTPS support and certificate configuration.

### Espanol

- Se agrego el primer reproductor web manejado por Node para streams UDP float PCM de RTLSDR-Airband.
- Se agrego configuracion multi-feed mediante `streams.js` / datos JSON de streams.
- Se agrego reproduccion PCM float32 sin comprimir sobre WebSocket.
- Se agrego una UI basica con estado del stream, buffering, ancho de banda, modo, ganancia, waveform y medidor de nivel.
- Se agrego conteo de listeners activos y seguimiento server-side de Last Heard.
- Se agrego soporte TLS/HTTPS y configuracion de certificados.
