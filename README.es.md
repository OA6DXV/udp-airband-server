# UDP Airband Server
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/OA6DXV/udp-airband-server)

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

## Instalacion

Clona el repositorio e instala las dependencias de Node.js:

```bash
git clone https://github.com/OA6DXV/udp-airband-server.git
cd udp-airband-server
npm install
```

Copia la configuracion de streams de ejemplo:

```bash
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

[admin]
host = 127.0.0.1
port = 8584
enabled = false

[streams]
file = streams.json

[storage]
backend = sqlite
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
- `[web].host` y `[web].port`: direccion y puerto para la interfaz web. El mismo puerto se usa para HTTP o HTTPS segun `[ssl]`.
- `[admin].enabled`: activa el servidor Web Admin separado. Se mantiene en `false` por defecto.
- `[admin].host` y `[admin].port`: direccion y puerto de Web Admin. Conserva el host loopback predeterminado salvo que el acceso este protegido por un tunel SSH o reverse proxy autenticado.
- `[streams].file`: archivo JSON que define los feeds.
- `[storage].backend`: backend de persistencia para el historial de usuarios conectados, los valores Last Heard y el cache de geolocalizacion. Los valores soportados son `sqlite` (predeterminado) y `json`.
- `[storage].sqlite_file`: ruta de la base SQLite. Las rutas relativas se resuelven dentro del directorio de datos de ejecucion (`data/` de forma predeterminada).
- `[geo].enabled`: activa la geolocalizacion server-side mediante ipwhois. Esta activada por defecto y mantiene las IP publicas anonimizadas antes de guardarlas.
- `[geo].key`: reservado para futuros proveedores de geolocalizacion que requieran API key. ipwhois no requiere una, asi que puede quedar vacio.
- `[geo].cache_ttl_days`: vuelve a consultar la ubicacion de redes publicas despues de 30 dias de forma predeterminada.
- `[geo].timeout_ms`: tiempo maximo permitido para una consulta. La consulta nunca bloquea la conexion de un listener.
- `[geo].ipv4_anonymize` y `[geo].ipv6_anonymize`: documentan las politicas obligatorias de anonimizacion `/24` y `/48`.
- `[logging].level`: nivel de logging amigable para servicio. Valores soportados: `off`, `error`, `warn`, `info` y `debug`. El valor predeterminado es `info`.
- `[logging].timestamps`: usa `true` para anteponer timestamps ISO. Con `systemd`, normalmente puede quedar en `false` porque `journalctl` ya agrega timestamps.
- `[logging].colors`: usa `true` para colorear logs en terminal. Mantenlo en `false` para logs normales de servicio con `systemd`.
- `[ssl]`: modo HTTPS opcional para el mismo host y puerto de `[web]`. Activalo y define rutas validas `key` y `cert` cuando quieras que Node.js sirva TLS directamente. Si SSL esta activado pero faltan las rutas del certificado o son invalidas, el servidor muestra un warning y cae a HTTP en el mismo puerto.
- `[compressed].enabled`: usa `false` para desactivar todos los modos comprimidos y su logica de transcoding/framing.
- `[compressed].codec`: backend del modo comprimido. `adpcm` es la opcion predeterminada de baja latencia y no requiere `ffmpeg`.

SQLite guarda los datos de ejecucion en `data/localdb.sqlite` de forma predeterminada. El almacenamiento JSON sigue disponible con `[storage].backend = json` y utiliza `data/user-history.json`, `data/last-heard.json` y `data/geo-cache.json`. En versiones de Node.js sin el modulo SQLite integrado, ejecuta `npm install` para instalar el driver de compatibilidad opcional `better-sqlite3`.

Cuando `[storage].backend = sqlite` y se encuentran archivos JSON antiguos, el servidor los importa automaticamente al iniciar, muestra el warning `storage_auto_migrated_json_to_sqlite` y conserva los JSON originales sin borrarlos. Define `[storage].backend = json` si prefieres mantener el backend JSON anterior.

Para migrar datos existentes, primero detiene el servidor en ejecucion y usa uno de estos comandos:

```bash
# JSON a SQLite
node server.js --migrate sqlite

# SQLite a JSON
node server.js --migrate json
```

`--migrate` sin valor utiliza `[storage].backend` como destino. La migracion combina los datos que ya existan en el destino, conserva los valores Last Heard y de geolocalizacion mas recientes, mantiene los puntos del historial y no borra el origen. Despues de verificar el resultado, cambia `[storage].backend` al backend deseado e inicia el servidor normalmente.

### Geolocalizacion Opcional Y Privacidad

Cuando `[geo].enabled = true`, el servidor puede usar [ipwhois](https://ipwhois.io/) para guardar en cache unicamente el pais y la ciudad devueltos para la red de un listener. El pais y la ciudad se almacenan exactamente como los entrega el proveedor y no se traducen.

La IP publica completa solo se usa temporalmente en memoria para realizar la consulta y nunca se escribe en JSON, SQLite ni en los logs de la aplicacion. Antes de persistirla, una IPv4 se reduce a su red `/24` (`8.8.8.45` pasa a `8.8.8.0`) y una IPv6 a `/48`. El cache evita consultas repetidas y se renueva despues de 30 dias. Si una renovacion falla, se conserva la ubicacion anterior.

Las direcciones privadas, loopback, link-local y otras direcciones no publicas nunca se envian a ipwhois. Se almacenan sin truncar con `Local IP` como pais y ciudad. La geolocalizacion es best-effort: un timeout, error del proveedor o limite de consultas nunca retrasa ni rechaza una conexion de audio.

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

`server.conf` viene incluido en el repositorio con la configuracion predeterminada del servidor, para que el usuario pueda verlo y editarlo directamente. Si se elimina, el servidor inicia con valores predeterminados internos y muestra un warning. Si falta `streams.json`, el servidor muestra un warning e inicia un stream interno `test` en el puerto UDP `8690`, mono, `8000 Hz`.

Configura el nivel normal del servicio en `server.conf`:

```conf
[logging]
level = info
timestamps = false
colors = false
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

Cuando `-D` esta activo, los encoders basados en ffmpeg como Opus, AAC y HLS se inician con logging debug de ffmpeg y su salida `stderr` se imprime. `-D` tambien activa timestamps y colores automaticamente para ejecuciones manuales en terminal. Sin `-D`, ffmpeg queda en nivel de errores y el comportamiento de timestamps/colores viene desde `server.conf`, para que los logs del servicio no se inunden.

## Administracion Web

La pagina de administracion esta desactivada por defecto y no se publica desde el puerto del reproductor. Puede activarse de forma persistente en `server.conf`:

```conf
[admin]
host = 127.0.0.1
port = 8584
enabled = true
```

Tambien puede habilitarse para una ejecucion indicando un puerto separado:

```bash
node server.js --webserver 8584
```

`--webserver PUERTO` tiene prioridad sobre `[admin].enabled` y `[admin].port`. El log de inicio muestra `webadmin_config_override` para dejar claro que los valores de la linea de comandos reemplazaron al archivo de configuracion. La forma anterior `--webadmin PUERTO` se conserva como alias compatible.

El servidor admin usa `[admin].host`, cuyo valor predeterminado es `127.0.0.1`. Para abrirlo de forma segura desde otra computadora, crea un tunel SSH:

```bash
ssh -L 8584:127.0.0.1:8584 usuario@IP_DEL_SERVIDOR
```

Luego abre `http://127.0.0.1:8584/` en el navegador local. No expongas este puerto directamente a internet: la pagina puede agregar, editar y eliminar feeds, cambiar hosts y puertos UDP, sample rates, canales y solicitar el reinicio del servidor.

Al aplicar cambios se valida la configuracion completa, se actualiza `streams.json` y se vuelven a enlazar las entradas UDP sin reiniciar Node. El boton amarillo **Reload streams** vuelve a leer los cambios hechos directamente en `streams.json` y los aplica con la misma validacion y restauracion ante errores. Los cambios que solo modifican nombres visibles conservan los listeners actuales. Los cambios de rutas o entradas de audio reconectan las sesiones de audio del navegador. Si no se puede abrir un puerto UDP nuevo, se restauran tanto la configuracion anterior en ejecucion como el archivo.

La grafica de usuarios conectados utiliza el contador interno de clientes unicos del servidor en lugar de analizar logs. Las muestras de un minuto se conservan durante 12 horas en el backend JSON o SQLite seleccionado.

El boton de reinicio envia una senal de cierre controlado despues de pedir confirmacion. Web Admin detecta `systemd` mediante el entorno de ejecucion y avisa si el servicio debe configurarse para reinicio automatico o si el proceso iniciado en consola tendra que arrancarse manualmente. Una unidad de `systemd` debe incluir, por ejemplo:

```ini
[Service]
ExecStart=/usr/bin/node /opt/udp-airband-server/server.js --webserver 8584
Restart=on-failure
```

Luego abre la pagina principal:

```text
http://SERVER_IP:8585/
```

Abre una pagina de stream y presiona `Start Audio`. Los navegadores requieren una accion del usuario antes de permitir audio.

## HTTPS / TLS

El servidor puede servir HTTPS directamente en el mismo host y puerto configurado en `[web]`.

```conf
[web]
host = 0.0.0.0
port = 8585

[ssl]
enabled = true
key = /etc/letsencrypt/live/example.com/privkey.pem
cert = /etc/letsencrypt/live/example.com/fullchain.pem
```

Para pruebas locales, puedes crear un certificado autogenerado:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout selfsigned.key \
  -out selfsigned.crt \
  -days 365 \
  -subj "/CN=localhost"
```

Luego apunta `server.conf` a esos archivos:

```conf
[ssl]
enabled = true
key = /opt/udp-airband-server/selfsigned.key
cert = /opt/udp-airband-server/selfsigned.crt
```

Luego abre:

```text
https://SERVER_IP:8585/
```

Cuando SSL esta activo, el player cambia de HTTP a HTTPS en `[web].port`; no inicia un segundo listener HTTP. Si `enabled = true` pero `key` o `cert` falta, no se puede leer o apunta a un archivo inexistente, el servidor muestra `ssl_fallback_http` e inicia HTTP en el mismo puerto.

Los navegadores mostraran una advertencia con certificados autogenerados porque no son confiables por defecto. Esto sirve para pruebas locales, pero para acceso publico se recomienda un certificado confiable, como Let's Encrypt.

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

La ultima transmision es detectada por el servidor y se guarda en el backend JSON o SQLite seleccionado, asi la pagina principal y nuevos oyentes pueden ver la ultima actividad conocida incluso despues de reiniciar el servidor.

La pagina principal lista todos los feeds configurados bajo `Real-time Airband audio streams`, muestra usuarios activos, selector de idioma, ruta, informacion de canales/sample rate y la ultima transmision detectada por el servidor para cada feed.

## Herramientas De Prueba

La carpeta `tools/` contiene scripts auxiliares para enviar audio sintetico o basado en archivos al stream UDP de ejemplo `test` en el puerto `8690`.

Consulta [`tools/README.es.md`](tools/README.es.md) para detalles de uso en espanol, o [`tools/README.md`](tools/README.md) para la version en ingles.
