#!/usr/bin/env python3
import argparse
import socket
import subprocess
import time

BYTES_PER_SAMPLE = 4  # f32le = 32-bit floating-point little-endian


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_file")
    parser.add_argument("--ip", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8690)
    parser.add_argument("--rate", type=int, default=8000)
    parser.add_argument("--channels", type=int, default=1)
    parser.add_argument("--chunk-ms", type=float, default=20.0)
    parser.add_argument("--volume", default="0.35")
    parser.add_argument("--loop", action="store_true")
    args = parser.parse_args()

    if not 5 <= args.chunk_ms <= 1000:
        parser.error("--chunk-ms must be between 5 and 1000")
    if args.rate <= 0 or args.channels not in (1, 2):
        parser.error("--rate must be positive and --channels must be 1 or 2")
    chunk_frames = max(1, round(args.rate * args.chunk_ms / 1000))
    chunk_bytes = chunk_frames * args.channels * BYTES_PER_SAMPLE
    if chunk_bytes > 65507:
        parser.error("--chunk-ms produces a packet larger than the UDP limit")

    audio_filter = (
        f"highpass=f=300,"
        f"lowpass=f=3000,"
        f"volume={args.volume}"
    )

    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    destination = (args.ip, args.port)

    print(f"Sending {args.input_file} as f32le UDP to {args.ip}:{args.port} "
          f"in {args.chunk_ms:g} ms chunks", flush=True)

    next_send_at = time.monotonic()

    while True:
        ffmpeg = subprocess.Popen(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel", "error",
                "-i", args.input_file,
                "-af", audio_filter,
                "-ac", str(args.channels),
                "-ar", str(args.rate),
                "-f", "f32le",
                "pipe:1",
            ],
            stdout=subprocess.PIPE,
        )

        while True:
            data = ffmpeg.stdout.read(chunk_bytes)
            if not data:
                break

            udp_socket.sendto(data, destination)

            duration = len(data) / (args.rate * args.channels * BYTES_PER_SAMPLE)
            next_send_at += duration
            time.sleep(max(0, next_send_at - time.monotonic()))

        ffmpeg.wait()

        if not args.loop:
            break


if __name__ == "__main__":
    main()
