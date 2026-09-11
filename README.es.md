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

`server.conf` controla como escucha este servidor web y desde donde carga la lista de streams. Si el archivo no existe, el servidor lo genera al iniciar desde una plantilla predeterminada interna:

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

Campos importantes:

- `[udp].host`: direccion UDP predeterminada para streams que no definan su propio `udpHost`.
- `[web].host` y `[web].port`: direccion y puerto para la interfaz web. El mismo puerto se usa para HTTP o HTTPS segun `[ssl]`.
- `[admin].enabled`: activa el servidor Web Admin separado. Esta en `true` por defecto y queda enlazado a loopback salvo que cambies `[admin].host`.
- `[admin].secure`: cuando esta en `true`, Web Admin corre sobre HTTPS usando `[admin].key` y `[admin].cert`, y los desafios ALTCHA permanecen activos. Cuando esta en `false`, Web Admin corre por HTTP y ALTCHA se desactiva porque los navegadores requieren HTTPS o localhost para ese desafio. Los rate limits siguen activos, pero la proteccion contra fuerza bruta se reduce.
- `[admin].host` y `[admin].port`: direccion y puerto de Web Admin. Conserva el host loopback predeterminado salvo que el acceso este protegido por un tunel SSH o reverse proxy autenticado.
- `[streams].file`: archivo JSON que define los feeds.
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
- `[audio].worklet_streaming`: activa la entrega persistente mediante AudioWorklet para streams individuales raw y ADPCM. Los navegadores incompatibles o contextos inseguros usan automaticamente el scheduler anterior.
- `[compressed].adpcm_pacing`: espacia los frames ADPCM codificados segun su cadencia para que paquetes UDP grandes no lleguen al navegador como una rafaga.
- `[compressed].enabled`: usa `false` para desactivar todos los modos comprimidos y su logica de transcoding/framing.
- `[compressed].codec`: backend del modo comprimido. `adpcm` es la opcion predeterminada de baja latencia y no requiere `ffmpeg`.

Las metricas de ejecucion, los valores Last Heard, la geolocalizacion y la autenticacion de Web Admin se guardan exclusivamente en SQLite, de forma predeterminada en `data/localdb.sqlite`. En Node.js 22.13+ (incluido Node 24), el modulo integrado `node:sqlite` se usa automaticamente sin warnings ni paquetes adicionales. Las instalaciones antiguas de Node.js deben instalar el driver de compatibilidad con `npm install better-sqlite3`.

Si una actualizacion detecta los archivos heredados `data/user-history.json`, `data/last-heard.json` o `data/geo-cache.json`, el inicio muestra una advertencia de migracion. Detiene el servidor y ejecuta:

```bash
node server.js --migrate
```

La migracion es unidireccional de JSON a SQLite. Pide confirmacion `Y/N`, combina los registros heredados con la base SQLite y mueve los JSON originales a una carpeta con fecha dentro de `data/legacy-json-backups/`. Ya no se admite migrar de SQLite a JSON.

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

`server.conf` es local y queda ignorado por Git, por lo que los cambios de produccion no se sobrescriben con `git pull`. Si el archivo no existe, el arranque escribe un nuevo `server.conf` desde la plantilla predeterminada interna y muestra un bloque de warning visible. Cuando versiones nuevas agregan opciones, el servidor escribe esa plantilla interna en `server.conf.tmp`, agrega solo las claves faltantes al `server.conf` local y elimina el temporal al terminar. Los valores locales existentes se conservan. Si falta `streams.json`, el servidor muestra un warning e inicia un stream interno `test` en el puerto UDP `8690`, mono, `8000 Hz`.

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

La pagina de administracion corre por defecto en un puerto separado solo en loopback y no se publica desde el puerto del reproductor. Puede configurarse en `server.conf`. Para acceso por IP privada como ZeroTier, genera un certificado self-signed para que el navegador trate la pagina como contexto seguro:

```bash
node server.js --generate-cert
```

Luego inicia el servidor y abre Web Admin con `https://HOST:8584/`. El generador usa `openssl`, crea `certs/admin.key` y `certs/admin.crt`, actualiza `[admin]` y pregunta si tambien quieres usar el mismo certificado en el servidor publico de streams. Activar SSL para el reproductor publico es opcional y normalmente innecesario detras de un reverse proxy.

```conf
[admin]
enabled = true
host = 127.0.0.1
port = 8584
secure = true
key = certs/admin.key
cert = certs/admin.crt
```

Web Admin requiere al menos un administrador habilitado guardado en la misma base SQLite de ejecucion. La autenticacion permite multiples cuentas de administrador con contrasenas scrypt, sesiones SQLite del lado del servidor, proteccion CSRF, limites por cuenta/IP y ALTCHA Proof-of-Work v2 autohospedado despues de tres logins fallidos. Los tokens de sesion y secretos ALTCHA nunca se guardan en el almacenamiento del navegador.

Instala las dependencias antes de activar Web Admin:

```bash
npm install
```

Si `ADMIN_AUTH_SECRET` y `ADMIN_ALTCHA_SECRET` no existen, el primer arranque de Web Admin crea `data/admin-secrets.env` con valores privados aleatorios y reutiliza ese archivo en los siguientes inicios. Manten este archivo privado e incluyelo en tus respaldos.

Para despliegues de produccion administrados, tambien puedes proporcionar los secretos manualmente en un archivo de entorno protegido:

```bash
sudo install -m 600 -o airband -g airband /dev/null /etc/udp-airband-admin.env
printf 'ADMIN_AUTH_SECRET=%s\n' "$(openssl rand -base64 48)" | sudo tee -a /etc/udp-airband-admin.env >/dev/null
printf 'ADMIN_ALTCHA_SECRET=%s\n' "$(openssl rand -base64 48)" | sudo tee -a /etc/udp-airband-admin.env >/dev/null
printf 'ADMIN_TRUSTED_PROXIES=127.0.0.1,::1\n' | sudo tee -a /etc/udp-airband-admin.env >/dev/null
```

Usa `node server.js --help` para mostrar la referencia completa de comandos, incluyendo Web Admin, TLS, migracion, logging y flags de cuentas administradoras. La gestion basica de administradores se hace desde la linea de comandos del servidor:

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

Cambiar la contrasena, deshabilitar o eliminar una cuenta cierra inmediatamente sus sesiones activas. La eliminacion pide confirmacion en la terminal y se conserva como baja logica auditable. SQLite almacena las fechas de creacion, modificacion y eliminacion. Un username eliminado puede recrearse despues con `--createuser`.

Si se omite `--password` o se pasa sin valor, el comando solicita la contrasena sin mostrarla, parecido a las herramientas de cuentas de Linux. Las contrasenas proporcionadas directamente con `--password VALUE` pueden quedar en el historial del shell o aparecer brevemente en la lista de procesos. Las contrasenas de administrador requieren al menos 5 caracteres; las que parezcan debiles se aceptan con una advertencia para no bloquear instalaciones privadas de laboratorio. Para el primer administrador o cuenta principal, el comando compatible `npm run admin:setup` tambien solicita la contrasena interactivamente sin mostrarla. Las rutas personalizadas pueden indicarse con `--server-config`, `--data-dir` y `--sqlite-file`.

Si usas el archivo de entorno protegido, agregalo al servicio `systemd`:

```ini
[Service]
EnvironmentFile=/etc/udp-airband-admin.env
```

La lista completa de variables y valores seguros esta en [`.env.example`](.env.example). Ambos secretos deben contener al menos 32 bytes y ser diferentes. Si Web Admin esta activo, el inicio falla cuando los secretos, limites, parametros ALTCHA o proxies confiables son inseguros. La sesion predeterminada dura 8 horas y vence tras 30 minutos de inactividad. Estos limites se configuran con `session_ttl_seconds` y `session_idle_seconds` dentro de `[admin]` en `server.conf`; las variables de entorno equivalentes tienen prioridad cuando existen. Los limites de login son 20 intentos por IP y 15 por cuenta cada 15 minutos. La generacion de desafios permite 10 por IP y 10 por cuenta cada minuto. Al excederlos se responde HTTP `429` con `Retry-After`.

### Reverse proxy y Cloudflare

Manten Node enlazado a `127.0.0.1:8584`; no publiques ese puerto en el firewall. Cloudflare debe usar **Full (strict)** hacia un certificado valido en Apache. Apache puede recibir HTTPS publico y comunicarse con Node por HTTP sobre loopback. Activa `proxy`, `proxy_http`, `headers` y `remoteip`, y configura el virtual host de esta forma:

```apache
RemoteIPHeader CF-Connecting-IP
# Agrega cada rango IPv4 e IPv6 actual de Cloudflare como RemoteIPTrustedProxy.
RemoteIPTrustedProxy 173.245.48.0/20
# ...los demas rangos actuales de Cloudflare...

ProxyPreserveHost On
ProxyPass        / http://127.0.0.1:8584/
ProxyPassReverse / http://127.0.0.1:8584/

# Sobrescribe; nunca agregues valores enviados por el cliente.
RequestHeader set X-Forwarded-For "expr=%{REMOTE_ADDR}"
RequestHeader set X-Forwarded-Host "expr=%{HTTP_HOST}"
RequestHeader set X-Forwarded-Proto "https"
```

Descarga todos los rangos actuales desde `https://www.cloudflare.com/ips/`; el unico rango mostrado arriba es solo un ejemplo de sintaxis. Ejecuta `apache2ctl configtest` antes de recargar Apache. `ADMIN_TRUSTED_PROXIES` debe contener unicamente la direccion o CIDR del proxy que se conecta directamente a Node. Si Apache esta en el mismo servidor, conserva `127.0.0.1,::1`. No pongas los rangos de Cloudflare ahi salvo que Cloudflare se conecte directamente a Node.

Node ignora `CF-Connecting-IP`, `X-Forwarded-For`, `X-Forwarded-Host` y `X-Forwarded-Proto` cuando el peer inmediato no es confiable. El proxy debe sobrescribir los encabezados reenviados para que un navegador no pueda elegir su IP de rate limit. Un `X-Forwarded-Proto: https` confiable marca la cookie como `Secure`, pero mantiene HTTP en el tramo interno Apache-Node; Node no redirige esa solicitud interna.

El flujo persistente es: los intentos 1-3 comprueban la contrasena sin ALTCHA; el tercer fallo activa el desafio; el intento 4 y todos los posteriores deben consumir un desafio nuevo y de vida corta antes de calcular la contrasena. Esperar o cambiar de IP no desactiva el requisito. Solo un login correcto reinicia el contador. Un login correcto invalida las sesiones anteriores de esa misma cuenta, sin afectar a los demas administradores. Cada login queda en el historial local SQLite con username, IP del cliente sin truncar, timestamps de inicio/fin, motivo de cierre y total de cambios exitosos en streams. El primer cambio guarda un unico snapshot previo para un futuro rollback por sesion; los cambios posteriores no reemplazan esa base.

Tambien puede moverse a otro puerto para una ejecucion:

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

La grafica de usuarios conectados utiliza el contador interno de clientes unicos del servidor en lugar de analizar logs. Las muestras de un minuto se conservan durante 12 horas en SQLite.

El boton de reinicio envia una senal de cierre controlado despues de pedir confirmacion. Web Admin detecta `systemd` mediante el entorno de ejecucion y avisa si el servicio debe configurarse para reinicio automatico o si el proceso iniciado en consola tendra que arrancarse manualmente. Una unidad de `systemd` debe incluir, por ejemplo:

```ini
[Service]
ExecStart=/usr/bin/node /opt/udp-airband-server/server.js --webserver 8584
EnvironmentFile=/etc/udp-airband-admin.env
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

Para streams individuales, el navegador puede reproducir:

- `Uncompressed`: PCM float32 original sobre WebSocket. Es el modo predeterminado en navegadores de escritorio y alimenta directamente al AudioWorklet persistente cuando esta disponible.
- `Compressed`: IMA ADPCM de baja latencia sobre WebSocket por defecto. Es el modo predeterminado en navegadores moviles; el PCM decodificado alimenta al mismo AudioWorklet.

El AudioWorklet mantiene un ring buffer mono acotado, remuestrea continuamente a la frecuencia real de salida y aplica una correccion limitada de deriva de reloj. Inicia cerca de un objetivo de 80 ms y descarta audio viejo si la cola supera 500 ms. AudioWorklet requiere un contexto seguro fuera de localhost. Si no puede cargarse, la reproduccion vuelve automaticamente al scheduler anterior por paquetes. AAC, Opus, HLS y Multi Stream conservan sus rutas actuales.

La reproduccion persistente mediante AudioWorklet continuo con la pantalla bloqueada en el iPhone probado, pero esto no garantiza background universal. iOS todavia puede suspender la red, el contexto de audio o la pagina segun la version del navegador, el estado de energia y la duracion del silencio de radio.

ADPCM esta pensado para audio de radio intermitente. El servidor solo envia frames comprimidos cuando llega audio UDP, asi que los periodos con squelch cerrado no consumen ancho de banda de audio. Cada frame ADPCM incluye suficiente estado de decodificacion para que nuevos clientes, o clientes luego de un silencio, puedan resincronizarse rapidamente.

El modo comprimido predeterminado es:

```conf
[compressed]
enabled = true
codec = adpcm
adpcm_frame_ms = 20
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

La ultima transmision es detectada por el servidor y se guarda en SQLite, asi la pagina principal y nuevos oyentes pueden ver la ultima actividad conocida incluso despues de reiniciar el servidor.

La pagina principal lista todos los feeds configurados bajo `Real-time Airband audio streams`, muestra usuarios activos, selector de idioma, ruta, informacion de canales/sample rate y la ultima transmision detectada por el servidor para cada feed.

## Herramientas De Prueba

La carpeta `tools/` contiene scripts auxiliares para enviar audio sintetico o basado en archivos al stream UDP de ejemplo `test` en el puerto `8690`.

Consulta [`tools/README.es.md`](tools/README.es.md) para detalles de uso en espanol, o [`tools/README.md`](tools/README.md) para la version en ingles.
