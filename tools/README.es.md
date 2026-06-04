# Herramientas

Scripts auxiliares pequenos para probar UDP Airband Server sin ejecutar RTLSDR-Airband.

El stream de ejemplo en `streams.example.json` incluye un feed `test` en el puerto UDP `8690`, `8000 Hz`, mono. Estas herramientas usan ese destino por defecto, asi que sirven para comprobar si el servidor, reproductor web, grafica de onda, medidor de nivel y lectura de bandwidth funcionan antes de conectar un receptor real.

English documentation is available in [`README.md`](README.md).

## `tone.py`

`tone.py` genera un tono senoidal continuo de 1 kHz como PCM float de 32 bits little-endian y lo envia por UDP a `127.0.0.1:8690`.

Usalo para una prueba rapida de toda la ruta de audio. Inicia UDP Airband Server con la configuracion de ejemplo, abre `/test`, presiona `Start Audio` y ejecuta:

```bash
python3 tools/tone.py
```

El script no tiene argumentos de linea de comandos. Detenlo con `Ctrl+C`.

Que hace internamente:

- genera audio mono a 8000 Hz
- crea bloques de 125 ms
- empaqueta muestras como `f32le`
- envia cada bloque al puerto UDP `8690`
- espera entre bloques para comportarse como audio en tiempo real

## `file-to-udp.py`

`file-to-udp.py` lee un archivo de audio usando `ffmpeg`, lo filtra para pruebas de voz, lo convierte a PCM `f32le` y envia bloques UDP temporizados al servidor.

Usalo cuando quieras una prueba mas realista que un tono, por ejemplo un clip de voz grabado o una transmision de radio de muestra.

El script aplica:

- high-pass filter at 300 Hz
- low-pass filter at 3000 Hz
- volumen configurable
- formato de salida: PCM float de 32 bits little-endian
- temporizacion en tiempo real basada en sample rate, canales y bytes por muestra

Ejemplo basico:

```bash
python3 tools/file-to-udp.py sample.wav
```

Repetir un archivo en loop hacia el stream `test` predeterminado:

```bash
python3 tools/file-to-udp.py sample.mp3 --loop
```

Enviar a otro host o puerto:

```bash
python3 tools/file-to-udp.py sample.wav --ip 192.0.2.10 --port 8690
```

Coincidir con otro formato de stream:

```bash
python3 tools/file-to-udp.py sample.wav --rate 16000 --channels 1
```

Bajar o subir el nivel:

```bash
python3 tools/file-to-udp.py sample.wav --volume 0.25
```

Argumentos disponibles:

- `input_file`: archivo de audio a leer.
- `--ip`: direccion IP de destino. Default: `127.0.0.1`.
- `--port`: puerto UDP de destino. Default: `8690`.
- `--rate`: sample rate de salida. Default: `8000`.
- `--channels`: cantidad de canales de salida. Default: `1`.
- `--volume`: multiplicador de volumen de ffmpeg. Default: `0.35`.
- `--loop`: reinicia el archivo cuando llega al final.

`file-to-udp.py` requiere `ffmpeg` en `PATH`.
