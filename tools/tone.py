#!/usr/bin/env python3
import math, socket, struct, time

rate = 8000
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
n = 0

while True:
    samples = [0.2 * math.sin(2 * math.pi * 1000 * (n + i) / rate)
               for i in range(rate // 8)]
    n += len(samples)

    sock.sendto(
        struct.pack('<%df' % len(samples), *samples),
        ('127.0.0.1', 8690)
    )

    time.sleep(0.125)
