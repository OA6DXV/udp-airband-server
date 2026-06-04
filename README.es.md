# UDP Airband Server

[English document here](README.md)

UDP Airband Server es un pequeno servidor web en Node.js para escuchar desde el navegador una o mas salidas UDP de [RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband).

RTLSDR-Airband es un receptor y daemon de streaming airband de codigo abierto. Usa receptores SDR para demodular canales de voz analogicos AM/NFM, comunmente frecuencias aeronauticas, y puede enviar cada canal recibido a varias salidas como Icecast, PulseAudio, archivos o audio UDP crudo. Revisa el [proyecto RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband) y su [documentacion de salida UDP](https://github.com/rtl-airband/RTLSDR-Airband/wiki/Configuring-UDP-outputs) para la parte del receptor.

Este proyecto va despues de RTLSDR-Airband. RTLSDR-Airband recibe y demodula la senal de radio, luego envia muestras de audio crudas por UDP. UDP Airband Server recibe esos paquetes UDP, mantiene el estado del stream y expone un reproductor web con contador de usuarios, ultima transmision, grafica de onda, medidor de nivel, reproduccion sin compresion y modo comprimido de menor ancho de banda.

El objetivo es tener un listener web privado y simple para feeds airband locales o remotos: ejecutas RTLSDR-Airband cerca de la antena, envias cada canal como audio UDP a este servidor y abres la pagina desde un telefono, tablet o navegador de escritorio.

## Que Es El Audio UDP?

La salida `udp_stream` de RTLSDR-Airband envia muestras de audio directamente sobre UDP/IP. No hay playlist, contenedor multimedia, protocolo de metadata ni negociacion de reconexion dentro del stream UDP. Es simplemente data PCM cruda enviada a una direccion IP y puerto.

Para este servidor, cada stream UDP debe ser PCM float de 32 bits little-endian:

- Mono: `L L L ...`
- Stereo: interleaved `L R L R ...`
- Sample rate: normalmente `8000 Hz`, o `16000 Hz` cuando RTLSDR-Airband fue compilado con soporte NFM

La utilidad de este enfoque es la baja latencia y la simplicidad. RTLSDR-Airband puede seguir usando su salida UDP nativa, mientras este servidor se encarga del trabajo especifico del navegador: WebSockets, audio comprimido, estado visual, selector de idioma, usuarios activos e interfaz web.

## Archivos

- `server.js`: punto de entrada de Node.js. Inicia los listeners UDP, el servidor HTTP/HTTPS, rutas de stream, estado usado por la UI y backends de audio comprimido.
- `server.example.conf`: configuracion de ejemplo a nivel servidor. Copialo como `server.conf` y define direcciones de escucha, puertos, rutas de certificado SSL/TLS y opciones de audio comprimido.
- `streams.example.json`: configuracion de streams de ejemplo. Copialo como `streams.json`; aqui se definen nombres de feeds, labels, puertos UDP, sample rates y cantidad de canales.
- `index.html`: estructura HTML del reproductor para cada pagina individual de stream.
- `assets/style.css`: estilos CSS del reproductor y la UI responsive.
- `assets/app.js`: logica del navegador: decodificacion/reproduccion de audio, estado de UI, actualizaciones de estado, cambio de idioma, grafica de onda, medidor de nivel, bandwidth y reconnect/idle.
- `assets/favicon.ico`: icono del navegador servido por todas las paginas.
- `lib/config.js`: parser y valores predeterminados de `server.conf`.
- `lib/streams.js`: carga la configuracion de streams y renderiza la pagina principal de feeds.
- `lib/listeners.js`: seguimiento de usuarios activos compartido por la UI y el estado del servidor.
- `lib/clients.js`: helpers para clientes de stream.
- `lib/websocket.js`: helpers y framing de WebSocket.
- `lib/compressed/`: implementaciones de audio comprimido. ADPCM es el valor predeterminado; Opus, AAC y HLS quedan como backends opcionales o experimentales.
- `tools/`: scripts auxiliares para generar audio UDP de prueba sin RTLSDR-Airband.

## Instalacion

Clona el repositorio e instala las dependencias de Node.js:

```bash
git clone https://github.com/OA6DXV/udp-airband-server.git
cd udp-airband-server
npm install
```

Copia los archivos de configuracion de ejemplo:

```bash
cp server.example.conf server.conf
cp streams.example.json streams.json
```

## Configuracion Del Servidor

`server.conf` controla como escucha este servidor web y desde donde carga la lista de streams:

```conf
[udp]
host = 0.0.0.0

[web]
host = 0.0.0.0
port = 8585

[streams]
file = streams.json

[logging]
level = info
timestamps = false

[ssl]
enabled = false
host = 0.0.0.0
port = 8443
key =
cert =
redirect_http_to_https = false

[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 40
ffmpeg = ffmpeg
opus_bitrate = 24k
aac_bitrate = 32k
keepalive_ms = 1000
```

Campos importantes:

- `[udp].host`: direccion UDP predeterminada para streams que no definan su propio `udpHost`.
- `[web].host` y `[web].port`: direccion y puerto HTTP para la interfaz web.
- `[streams].file`: archivo JSON que define los feeds.
- `[logging].level`: nivel de logging amigable para servicio. Valores soportados: `off`, `error`, `warn`, `info` y `debug`. El valor predeterminado es `info`.
- `[logging].timestamps`: usa `true` para anteponer timestamps ISO. Con `systemd`, normalmente puede quedar en `false` porque `journalctl` ya agrega timestamps.
- `[ssl]`: listener HTTPS opcional. Activalo y define las rutas `key` y `cert` cuando quieras que Node.js sirva TLS directamente.
- `[compressed].enabled`: usa `false` para desactivar todos los modos comprimidos y su logica de transcoding/framing.
- `[compressed].codec`: backend del modo comprimido. `adpcm` es la opcion predeterminada de baja latencia y no requiere `ffmpeg`.

`streams.json` define los feeds:

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

Campos importantes:

- `name`: id seguro para URL. Un stream llamado `tower` queda disponible en `/tower`.
- `label`: nombre visible en la UI.
- `udpPort`: puerto UDP donde este servidor escucha el audio de RTLSDR-Airband.
- `sampleRate`: sample rate del audio PCM float entrante.
- `channels`: `1` para mono o `2` para stereo/interleaved.
- `udpHost`: direccion UDP opcional por stream. Si se omite, se usa `[udp].host`.

La configuracion de ejemplo crea:

```text
http://SERVER_IP:8585/
http://SERVER_IP:8585/tower
http://SERVER_IP:8585/test
```

## Configuracion De RTLSDR-Airband

En RTLSDR-Airband, cada canal que quieras mostrar en el reproductor web debe tener una salida `udp_stream` apuntando a este servidor.

Si RTLSDR-Airband y UDP Airband Server corren en el mismo host:

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

Si RTLSDR-Airband corre en otra maquina, usa la IP de la maquina donde corre UDP Airband Server:

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

Para el stream de ejemplo `test`:

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

El valor `dest_port` en RTLSDR-Airband debe coincidir con `udpPort` en `streams.json`. El sample rate y la cantidad de canales en `streams.json` tambien deben coincidir con el audio producido por RTLSDR-Airband.

Se recomienda `continuous = true` porque mantiene activa la salida del receptor y ayuda a que la reproduccion en navegador se mantenga sincronizada. El servidor igual detecta actividad UDP real y muestra `Waiting for UDP` hasta recibir al menos un paquete.

## Iniciar El Servidor

Inicia usando los archivos locales predeterminados:

```bash
npm start
```

O pasa rutas explicitas:

```bash
npm start -- \
  --server-config /etc/udp-airband-server/server.conf \
  --config /etc/udp-airband-server/streams.json
```

Para diagnostico manual, inicia con `-D` para activar salida debug completa del servidor y de los encoders basados en ffmpeg:

```bash
node server.js -D \
  --server-config /etc/udp-airband-server/server.conf \
  --config /etc/udp-airband-server/streams.json
```

Usa `-D` solo cuando ejecutes el servidor directamente en una terminal. Fuerza logging debug, activa timestamps para la salida de terminal y puede generar mucha salida de ffmpeg. No se recomienda para el comando normal del servicio `systemd`.

## Logging

El servidor escribe logs en stdout/stderr, asi que `systemd` guarda automaticamente esa salida en `journalctl`.

El nivel predeterminado `info` es intencionalmente suave para uso como servicio. Muestra lineas de arranque, streams cargados, URLs del player, conexiones/desconexiones, warnings y errores. No imprime todo el debug de los encoders ffmpeg.

Configura el nivel normal del servicio en `server.conf`:

```conf
[logging]
level = info
timestamps = false
```

Usa `warn` o `error` para logs mas silenciosos en servicio:

```conf
[logging]
level = warn
```

Usa `debug` en la configuracion solo si realmente quieres logs debug persistentes en `journalctl`. Para diagnostico temporal, es mejor correr manualmente con `-D`:

```bash
node server.js -D --server-config server.conf --config streams.json
```

Cuando `-D` esta activo, los encoders basados en ffmpeg como Opus, AAC y HLS se inician con logging debug de ffmpeg y su salida `stderr` se imprime. `-D` tambien activa timestamps automaticamente para ejecuciones manuales en terminal. Sin `-D`, ffmpeg queda en nivel de errores y el comportamiento de timestamps viene desde `server.conf`, para que los logs del servicio no se inunden.

Luego abre la pagina principal:

```text
http://SERVER_IP:8585/
```

Abre una pagina de stream y presiona `Start Audio`. Los navegadores requieren una accion del usuario antes de permitir audio.

## HTTPS / TLS

El servidor puede servir HTTPS directamente cuando SSL esta activado:

```conf
[ssl]
enabled = true
host = 0.0.0.0
port = 8443
key = /etc/letsencrypt/live/example.com/privkey.pem
cert = /etc/letsencrypt/live/example.com/fullchain.pem
redirect_http_to_https = false
```

Luego abre:

```text
https://SERVER_IP:8443/
```

El listener HTTP sigue iniciando por defecto para no romper despliegues existentes. Usa reglas de firewall o un reverse proxy si quieres exponer publicamente solo HTTPS.

## Modos Uncompressed Y Compressed

El navegador puede reproducir:

- `Uncompressed`: PCM float32 original sobre WebSocket. Es el modo predeterminado en navegadores de escritorio.
- `Compressed`: IMA ADPCM de baja latencia sobre WebSocket por defecto. Es el modo predeterminado en navegadores moviles.

ADPCM esta pensado para audio de radio intermitente. El servidor solo envia frames comprimidos cuando llega audio UDP, asi que los periodos con squelch cerrado no consumen ancho de banda de audio. Cada frame ADPCM incluye suficiente estado de decodificacion para que nuevos clientes, o clientes luego de un silencio, puedan resincronizarse rapidamente.

El modo comprimido predeterminado es:

```conf
[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 40
```

Codecs comprimidos soportados:

- `adpcm`: predeterminado, baja latencia, no requiere `ffmpeg`.
- `opus`: Opus/WebM sobre WebSocket o fallback HTTP, requiere `ffmpeg`.
- `aac`: AAC sobre WebSocket/MediaSource, requiere `ffmpeg`.
- `hls`: ruta HLS/AAC experimental, requiere `ffmpeg`. Esta ruta se conserva en el codigo pero actualmente queda en espera mientras se prueba ADPCM como modo comprimido amigable para moviles.

Instala `ffmpeg` solo si quieres usar `opus`, `aac` o `hls`:

```bash
sudo apt install ffmpeg
```

Para desactivar completamente el audio comprimido:

```conf
[compressed]
enabled = false
```

## Controles Del Reproductor

La pagina del stream muestra contador de usuarios, estado UDP/stream, buffered, bandwidth, ultima transmision, modo, ganancia, grafica de onda y nivel de audio.

Cuando el stream fue validado por al menos un paquete UDP, el estado cambia a `Connected`. Al presionar `Connected`, la pagina cambia a `Push to Reconnect`, cierra solo el socket de audio y detiene el consumo de bandwidth sin cerrar la pagina ni la conexion de control/estado. Al presionar `Push to Reconnect`, se reanuda el mismo modo que estaba activo antes de pausar.

La pagina principal lista todos los feeds configurados bajo `Real-time Airband audio streams`, muestra usuarios activos, selector de idioma, ruta, informacion de canales/sample rate y la ultima transmision detectada por el servidor para cada feed.

## Herramientas De Prueba

La carpeta `tools/` contiene scripts auxiliares para enviar audio sintetico o basado en archivos al stream UDP de ejemplo `test` en el puerto `8690`.

Consulta [`tools/README.es.md`](tools/README.es.md) para detalles de uso en espanol, o [`tools/README.md`](tools/README.md) para la version en ingles.
