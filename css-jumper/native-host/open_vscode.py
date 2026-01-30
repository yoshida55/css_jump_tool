#!/usr/bin/env python
# -*- coding: utf-8 -*-
import sys
import json
import struct
import os

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def send_message(message):
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def main():
    message = read_message()
    if message and 'url' in message:
        url = message['url']
        os.startfile(url)  # コンソール非表示でURLを開く
        send_message({'success': True})
    else:
        send_message({'success': False, 'error': 'No URL provided'})

if __name__ == '__main__':
    main()
