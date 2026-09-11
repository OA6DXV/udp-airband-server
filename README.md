# UDP Airband Server
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/OA6DXV/udp-airband-server)

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

## Installation

Clone the repository and install the Node.js dependencies:

```bash
git clone https://github.com/OA6DXV/udp-airband-server.git
cd udp-airband-server
npm install
```

Copy the example stream configuration:

```bash
cp streams.example.json streams.json
```

## Server Configuration

`server.conf` controls how this web server listens and where it loads the stream list from. If the file is missing, the server generates it from an internal default template at startup:

```conf
[udp]
host = 0.0.0.0

[web]
host = 0.0.0.0
port = 8585

[admin]
host = 127.0.0.1
port = 8584
enabled = true
secure = false
key =
cert =

[streams]
file = streams.json

[storage]
sqlite_file = localdb.sqlite

[geo]
enabled = true
provider = ipwhois
key =
cache_ttl_days = 30
timeout_ms = 1500
ipv4_anonymize = /24
ipv6_anonymize = /48

[logging]
level = info
timestamps = false
colors = false

[ssl]
enabled = false
key =
cert =

[audio]
worklet_streaming = true
raw_pacing = true

[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 20
adpcm_pacing = true
ffmpeg = ffmpeg
opus_bitrate = 24k
aac_bitrate = 32k
keepalive_ms = 1000
```

Important fields:

- `[udp].host`: default UDP bind address used by streams that do not define their own `udpHost`.
- `[web].host` and `[web].port`: bind address and port for the browser interface. The same port is used for HTTP or HTTPS depending on `[ssl]`.
- `[admin].enabled`: enables the separate Web Admin server. It is `true` by default and binds to loopback unless you change `[admin].host`.
- `[admin].secure`: when `true`, Web Admin runs over HTTPS using `[admin].key` and `[admin].cert`, and ALTCHA challenges remain enabled. When `false`, Web Admin runs over HTTP and ALTCHA is disabled because browsers require HTTPS or localhost for that challenge. Rate limits remain active, but brute-force protection is reduced.
- `[admin].host` and `[admin].port`: bind address and port for Web Admin. Keep the default loopback host unless access is protected by an SSH tunnel or authenticated reverse proxy.
- `[streams].file`: JSON file that defines the feeds.
- `[storage].sqlite_file`: SQLite database path. Relative paths are resolved inside the runtime data directory (`data/` by default).
- `[geo].enabled`: enables server-side IP geolocation through ipwhois. It is enabled by default and keeps public IPs anonymized before storage.
- `[geo].key`: reserved for future geolocation providers that require an API key. ipwhois does not require one, so this can remain empty.
- `[geo].cache_ttl_days`: rechecks public network locations after 30 days by default.
- `[geo].timeout_ms`: maximum time allowed for a geolocation request. Lookups never block a listener connection.
- `[geo].ipv4_anonymize` and `[geo].ipv6_anonymize`: document the enforced `/24` and `/48` public-IP anonymization policies.
- `[logging].level`: service-friendly logging level. Supported values are `off`, `error`, `warn`, `info`, and `debug`. The default is `info`.
- `[logging].timestamps`: set to `true` to prepend ISO timestamps. With `systemd`, this can usually stay `false` because `journalctl` already adds timestamps.
- `[logging].colors`: set to `true` to color terminal logs. Keep it `false` for normal `systemd` service logs.
- `[ssl]`: optional HTTPS mode for the same `[web]` host and port. Enable it and provide valid `key` and `cert` paths when you want Node.js to serve TLS directly. If SSL is enabled but the certificate paths are missing or invalid, the server logs a warning and falls back to HTTP on the same port.
- `[audio].worklet_streaming`: enables the persistent AudioWorklet delivery path for individual raw and ADPCM streams. Unsupported or insecure browser contexts automatically use the legacy scheduler.
- `[audio].raw_pacing`: splits raw PCM into 20 ms frames and spaces them at their media cadence so large UDP packets do not reach the browser as a burst.
- `[compressed].adpcm_pacing`: spaces encoded ADPCM frames at their media cadence so large UDP packets do not reach the browser as a burst.
- `[compressed].enabled`: set to `false` to disable all compressed modes and their transcoding/framing logic.
- `[compressed].codec`: compressed mode backend. `adpcm` is the default low-latency option and does not require `ffmpeg`.

Runtime metrics, Last Heard values, geolocation data, and Web Admin authentication are stored exclusively in SQLite at `data/localdb.sqlite` by default. On Node.js 22.13+ (including Node 24), the built-in `node:sqlite` module is used automatically with no warning or extra package. Older Node.js installations must install the compatibility driver with `npm install better-sqlite3`.

If an upgrade detects legacy `data/user-history.json`, `data/last-heard.json`, or `data/geo-cache.json` files, startup prints a migration warning. Stop the server and run:

```bash
node server.js --migrate
```

Migration is one-way from JSON to SQLite. It asks for `Y/N` confirmation, merges legacy records into the SQLite database, and moves the source JSON files into a timestamped `data/legacy-json-backups/` directory. SQLite-to-JSON migration is no longer supported.

### Optional Geolocation And Privacy

When `[geo].enabled = true`, the server can use [ipwhois](https://ipwhois.io/) to cache only the country and city returned for a listener network. Country and city are stored exactly as returned by the provider and are not translated.

The complete public IP is used only in memory for the outgoing lookup and is never written to JSON, SQLite, or application logs. Before persistence, IPv4 addresses are reduced to a `/24` network (`8.8.8.45` becomes `8.8.8.0`) and IPv6 addresses to `/48`. Cached results avoid repeated requests and are refreshed after 30 days. If a refresh fails, the previous cached location remains available.

Private, loopback, link-local, and other non-public addresses are never sent to ipwhois. They are stored as-is with `Local IP` for both country and city. Geolocation is best-effort: timeouts, provider errors, or rate limits never delay or reject an audio connection.

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

For manual troubleshooting, start with `-D` to enable full debug output from the server and ffmpeg-backed encoders:

```bash
node server.js -D \
  --server-config /etc/udp-airband-server/server.conf \
  --config /etc/udp-airband-server/streams.json
```

Use `-D` only when running the server directly in a terminal. It forces debug logging, enables timestamps for terminal output, and can produce a lot of ffmpeg output. It is not recommended for the normal `systemd` service command.

## Logging

The server logs to stdout/stderr, so `systemd` automatically stores the output in `journalctl`.

The default `info` level is intentionally soft enough for service use. It shows startup lines, stream binds, player URLs, connection/disconnection events, warnings, and errors. It does not print full ffmpeg encoder debug output.

`server.conf` is local and ignored by Git, so production edits are not overwritten by `git pull`. If the file is missing, startup writes a new `server.conf` from the built-in default template and prints a visible warning block. When new settings are added in later versions, the server writes that internal template to `server.conf.tmp`, appends only missing keys to the local `server.conf`, and removes the temporary file afterwards. Existing local values are preserved. If `streams.json` is missing, the server logs a warning and starts a built-in `test` stream on UDP port `8690`, mono, `8000 Hz`.

Configure the normal service log level in `server.conf`:

```conf
[logging]
level = info
timestamps = false
colors = false
```

Use `warn` or `error` for quieter service logs:

```conf
[logging]
level = warn
```

Use `debug` in the config only if you really want persistent debug logs in `journalctl`. For temporary troubleshooting, prefer running manually with `-D`:

```bash
node server.js -D --server-config server.conf --config streams.json
```

When `-D` is active, ffmpeg-backed encoders such as Opus, AAC, and HLS are started with ffmpeg debug logging and their `stderr` output is printed. `-D` also enables timestamps and colors automatically for manual terminal runs. Without `-D`, ffmpeg stays at error-level logging and timestamp/color behavior comes from `server.conf`, so service logs do not get flooded.

## Web Admin

The administration page runs on a separate loopback-only port by default and is not served from the public player port. It can be configured in `server.conf`. For private IP access such as ZeroTier, generate a self-signed certificate so browsers treat the page as a secure context:

```bash
node server.js --generate-cert
```

Then start the server and open Web Admin with `https://HOST:8584/`. The generator uses `openssl`, creates `certs/admin.key` and `certs/admin.crt`, updates `[admin]`, and asks whether the public stream server should use the same certificate too. Enabling SSL for the public player is optional and usually unnecessary behind a reverse proxy.

```conf
[admin]
enabled = true
host = 127.0.0.1
port = 8584
secure = true
key = certs/admin.key
cert = certs/admin.crt
```

Web Admin requires at least one enabled administrator stored in the same SQLite runtime database. Authentication supports multiple administrator accounts with scrypt password hashing, server-side SQLite sessions, CSRF protection, account/IP rate limits, and self-hosted ALTCHA Proof-of-Work v2 after three failed logins. Session tokens and ALTCHA secrets are never stored in browser storage.

Install dependencies before enabling Web Admin:

```bash
npm install
```

If `ADMIN_AUTH_SECRET` and `ADMIN_ALTCHA_SECRET` are not provided, the first Web Admin startup creates `data/admin-secrets.env` with private random values and reuses that file on later starts. Keep this file private and include it in backups.

For managed production deployments, you may provide the secrets yourself in a root-owned environment file:

```bash
sudo install -m 600 -o airband -g airband /dev/null /etc/udp-airband-admin.env
printf 'ADMIN_AUTH_SECRET=%s\n' "$(openssl rand -base64 48)" | sudo tee -a /etc/udp-airband-admin.env >/dev/null
printf 'ADMIN_ALTCHA_SECRET=%s\n' "$(openssl rand -base64 48)" | sudo tee -a /etc/udp-airband-admin.env >/dev/null
printf 'ADMIN_TRUSTED_PROXIES=127.0.0.1,::1\n' | sudo tee -a /etc/udp-airband-admin.env >/dev/null
```

Use `node server.js --help` to print the complete command reference, including Web Admin, TLS, migration, logging, and administrator account flags. Basic administrator account management is handled from the server CLI:

```bash
node server.js --createuser USER
node server.js --createuser USER --password 'PASSWORD'
node server.js --modifyuser USER --password
node server.js --modifyuser USER --password 'NEW_PASSWORD'
node server.js --modifyuser USER disable
node server.js --modifyuser USER enable
node server.js --deleteuser USER
node server.js --listusers
```

Changing a password, disabling, or deleting an account immediately closes that account's active sessions. Deletion requires terminal confirmation and is retained as an auditable soft deletion. Creation, modification, and deletion timestamps are stored in SQLite. A deleted username can later be recreated with `--createuser`.

If `--password` is omitted or passed without a value, the command prompts for the password without echo, similar to Linux account tools. Passwords supplied directly with `--password VALUE` may be retained in shell history or briefly visible in the process list. Administrator passwords require at least 5 characters; weak-looking passwords are accepted with a warning so private lab installs are not blocked. For the first or primary administrator, the compatibility command `npm run admin:setup` also prompts interactively without echo. Custom paths can be passed with `--server-config`, `--data-dir`, and `--sqlite-file`.

If you use the protected environment file, add it to the `systemd` service:

```ini
[Service]
EnvironmentFile=/etc/udp-airband-admin.env
```

The complete list of supported authentication settings and safe defaults is in [`.env.example`](.env.example). Both secrets must contain at least 32 bytes and must be different. Startup fails while Web Admin is enabled if secrets, rate limits, ALTCHA parameters, or trusted-proxy ranges are unsafe. The default session lasts 8 hours with a 30-minute inactivity timeout. These limits can be set with `session_ttl_seconds` and `session_idle_seconds` under `[admin]` in `server.conf`; the matching environment variables override the file when present. Login limits are 20 attempts per IP and 15 per account in 15 minutes. Challenge generation is limited to 10 per IP and 10 per account per minute. Responses over those limits use HTTP `429` and `Retry-After`.

### Reverse proxy and Cloudflare

Keep Node bound to `127.0.0.1:8584`; do not expose that port in the firewall. Cloudflare should use **Full (strict)** to a valid certificate on Apache. Apache may proxy HTTPS publicly to Node over loopback HTTP. Enable `proxy`, `proxy_http`, `headers`, and `remoteip`, then configure the virtual host along these lines:

```apache
RemoteIPHeader CF-Connecting-IP
# Add every current Cloudflare IPv4 and IPv6 range as RemoteIPTrustedProxy.
RemoteIPTrustedProxy 173.245.48.0/20
# ...remaining current Cloudflare ranges...

ProxyPreserveHost On
ProxyPass        / http://127.0.0.1:8584/
ProxyPassReverse / http://127.0.0.1:8584/

# Overwrite, never append, the values passed to Node.
RequestHeader set X-Forwarded-For "expr=%{REMOTE_ADDR}"
RequestHeader set X-Forwarded-Host "expr=%{HTTP_HOST}"
RequestHeader set X-Forwarded-Proto "https"
```

Download the complete, current Cloudflare ranges from `https://www.cloudflare.com/ips/`; the single range above is only a syntax example. Run `apache2ctl configtest` before reloading Apache. `ADMIN_TRUSTED_PROXIES` must contain only the address or CIDR of the proxy that connects directly to Node. With Apache on the same host, keep `127.0.0.1,::1`. Do not put Cloudflare ranges there unless Cloudflare connects directly to Node.

Node ignores `CF-Connecting-IP`, `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` when the immediate peer is not trusted. The proxy must overwrite forwarded headers so a browser cannot choose its own rate-limit IP. A trusted `X-Forwarded-Proto: https` marks the session cookie `Secure` while preserving HTTP on the internal Apache-to-Node hop; Node does not redirect that internal request.

The failed-login flow is persistent: attempts 1-3 check the password without ALTCHA; the third failure enables the challenge requirement; attempt 4 and every later attempt must consume a fresh, short-lived challenge before password hashing. Waiting or changing IP does not clear it. Only a successful login resets the account counter. A successful login invalidates previous sessions for that same administrator account, without affecting other administrators. Each login is retained in the local SQLite audit history with its administrator username, untruncated client IP, start/end timestamps, close reason, and successful stream-change count. The first change stores one pre-change stream snapshot for future session-level rollback; later changes do not replace that baseline.

It can also be moved to another port for one run:

```bash
node server.js --webserver 8584
```

`--webserver PORT` takes priority over `[admin].enabled` and `[admin].port`. The startup log reports `webadmin_config_override` so it is clear that command-line values replaced the configuration file. The older `--webadmin PORT` spelling remains available as a compatible alias.

The admin server uses `[admin].host`, which defaults to `127.0.0.1`. Open it securely from another computer with an SSH tunnel:

```bash
ssh -L 8584:127.0.0.1:8584 user@SERVER_IP
```

Then open `http://127.0.0.1:8584/` in the local browser. Do not expose this port directly to the internet: the page can add, edit, and remove feeds, change UDP hosts, ports, sample rates, and channel counts, and request a server restart.

Applying stream changes validates the complete configuration, updates `streams.json`, and rebinds UDP inputs without restarting Node. The yellow **Reload streams** button rereads changes made directly to `streams.json` and applies them through the same validation and rollback path. Display-name-only changes preserve current listeners. Changes to routes or audio inputs reconnect affected browser audio sessions. If a new UDP port cannot be bound, the previous runtime configuration and file are restored.

The connected-user chart uses the server's internal unique client counter instead of parsing logs. One-minute samples are retained for 12 hours in SQLite.

The restart button sends the process a graceful termination signal after confirmation. Web Admin detects `systemd` from its runtime environment and warns whether the service must be configured for automatic restart or the console process will need to be started manually. A `systemd` unit should include, for example:

```ini
[Service]
ExecStart=/usr/bin/node /opt/udp-airband-server/server.js --webserver 8584
EnvironmentFile=/etc/udp-airband-admin.env
Restart=on-failure
```

Then open the home page:

```text
http://SERVER_IP:8585/
```

Open a stream page, then press `Start Audio`. Browsers require a user gesture before audio playback can begin.

## HTTPS / TLS

The server can serve HTTPS directly on the same host and port configured in `[web]`.

```conf
[web]
host = 0.0.0.0
port = 8585

[ssl]
enabled = true
key = /etc/letsencrypt/live/example.com/privkey.pem
cert = /etc/letsencrypt/live/example.com/fullchain.pem
```

For local testing, you can create a self-signed certificate:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout selfsigned.key \
  -out selfsigned.crt \
  -days 365 \
  -subj "/CN=localhost"
```

Then point `server.conf` to those files:

```conf
[ssl]
enabled = true
key = /opt/udp-airband-server/selfsigned.key
cert = /opt/udp-airband-server/selfsigned.crt
```

Then open:

```text
https://SERVER_IP:8585/
```

When SSL is active, the player switches from HTTP to HTTPS on `[web].port`; it does not start a second HTTP listener. If `enabled = true` but `key` or `cert` is missing, unreadable, or points to a non-existing file, the server logs `ssl_fallback_http` and starts HTTP on the same port instead.

Browsers will warn about self-signed certificates because they are not trusted by default. This is acceptable for local testing, but a trusted certificate, such as Let's Encrypt, is recommended for public access.

## Uncompressed And Compressed Modes

For individual streams, the browser can play either:

- `Uncompressed`: original float32 PCM over WebSocket. This is the default on desktop browsers and feeds the persistent AudioWorklet directly when available.
- `Compressed`: low-latency IMA ADPCM over WebSocket by default. This is the default on mobile browsers; decoded PCM feeds the same AudioWorklet.

The AudioWorklet keeps a bounded mono ring buffer, resamples continuously to the device output rate, and applies limited clock-drift correction. It starts near an 80 ms target and discards stale audio if the queue exceeds 200 ms. AudioWorklet requires a secure browser context outside localhost. If it cannot be loaded, playback falls back automatically to the previous per-packet scheduler. AAC, Opus, HLS, and Multi Stream keep their existing playback paths.

Persistent AudioWorklet playback continued with the screen locked on the tested iPhone, but this is not a universal background-playback guarantee. iOS may still suspend network delivery, the audio context, or the page depending on browser version, power state, and the duration of radio silence.

ADPCM is designed for intermittent radio audio. The server sends compressed frames only when UDP audio arrives, so idle squelch periods do not consume audio bandwidth. Each ADPCM frame includes enough decoder state for new clients, or clients after a silence gap, to resynchronize quickly.

Compressed mode defaults to:

```conf
[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 20
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

Last transmission time is tracked by the server and persisted in SQLite, so the home page and new listeners can still see the latest known activity after a server restart.

The home page lists all configured feeds under `Real-time Airband audio streams`, shows the active user count, language selector, route, channel/sample-rate information, and the server-side last transmission time for each feed.

## Test Tools

The `tools/` directory contains helper scripts for sending synthetic or file-based audio to the example `test` UDP stream on port `8690`.

See [`tools/README.md`](tools/README.md) for usage details.
