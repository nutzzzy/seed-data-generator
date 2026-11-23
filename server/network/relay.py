#!/usr/bin/env python3
"""
Seed Data Generator network relay (unprivileged helper).

Node cannot pin a socket to a network interface, so the app starts this helper on 127.0.0.1 and sends selected HTTPS
requests through it with HTTP CONNECT. For each tunnel the helper opens the outbound socket pinned to the interface
named in the Proxy-Authorization user name, then only copies bytes. TLS stays end to end between the app and the
remote server: the helper never sees request contents, headers or tokens, and certificate checks happen in the app.

Pinning per platform (no root, no system changes):
  Linux   SO_BINDTODEVICE (unprivileged since kernel 5.7 for an unbound socket)
  macOS   IP_BOUND_IF / IPV6_BOUND_IF (interface index)
  Windows IP_UNICAST_IF / IPV6_UNICAST_IF (interface index)

Security: listens on loopback only; every tunnel must carry the random token given in SEED_RELAY_TOKEN; the interface
name is validated; nothing is logged except short error codes. Exits when the parent closes stdin.
"""
import asyncio
import base64
import hmac
import os
import re
import socket
import struct
import sys

TOKEN = os.environ.get("SEED_RELAY_TOKEN", "")
IFACE_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,32}$")
HOST_RE = re.compile(r"^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.\-]{1,253}):(\d{1,5})$")
CONNECT_TIMEOUT = 15
MAX_HEAD = 8192
# Manual verification only: logs "host:port via interface -> result" to stderr (never headers or tokens).
DEBUG = os.environ.get("SEED_RELAY_DEBUG") == "1"


def debug(msg):
    if DEBUG:
        print(msg, file=sys.stderr, flush=True)


class RelayError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def pin(sock, family, iface):
    """Pins an unconnected socket to the interface; raises RelayError when the OS refuses or the interface is gone."""
    try:
        if sys.platform.startswith("linux"):
            sock.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_BINDTODEVICE", 25), iface.encode() + b"\0")
        elif sys.platform == "darwin":
            index = socket.if_nametoindex(iface)
            if family == socket.AF_INET6:
                sock.setsockopt(socket.IPPROTO_IPV6, 125, index)  # IPV6_BOUND_IF
            else:
                sock.setsockopt(socket.IPPROTO_IP, 25, index)  # IP_BOUND_IF
        elif sys.platform == "win32":
            index = int(iface)
            if family == socket.AF_INET6:
                sock.setsockopt(socket.IPPROTO_IPV6, 31, index)  # IPV6_UNICAST_IF (host order)
            else:
                sock.setsockopt(socket.IPPROTO_IP, 31, struct.unpack("<I", struct.pack(">I", index))[0])  # IP_UNICAST_IF (network order)
        else:
            raise RelayError(501, "unsupported-platform")
    except RelayError:
        raise
    except (OSError, ValueError):
        raise RelayError(502, "interface-unavailable")


async def open_pinned(host, port, iface):
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise RelayError(502, "dns-failed")
    last = RelayError(502, "connect-failed")
    for family, kind, proto, _, addr in infos:
        sock = socket.socket(family, kind, proto)
        sock.setblocking(False)
        try:
            pin(sock, family, iface)
            await asyncio.wait_for(loop.sock_connect(sock, addr), CONNECT_TIMEOUT)
            return sock
        except RelayError as err:
            sock.close()
            last = err
            if err.code != "connect-failed":
                break
        except (OSError, asyncio.TimeoutError):
            sock.close()
            last = RelayError(502, "connect-failed")
    raise last


def parse_head(head):
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split(" ")
    if len(parts) != 3 or parts[0] != "CONNECT":
        raise RelayError(405, "connect-only")
    target = HOST_RE.match(parts[1])
    if not target or not 0 < int(target.group(2)) < 65536:
        raise RelayError(400, "bad-target")
    auth = None
    for line in lines[1:]:
        name, _, value = line.partition(":")
        if name.strip().lower() == "proxy-authorization":
            auth = value.strip()
    if not auth or not auth.lower().startswith("basic "):
        raise RelayError(407, "auth-required")
    try:
        user, _, password = base64.b64decode(auth[6:], validate=True).decode().partition(":")
    except Exception:
        raise RelayError(407, "auth-required")
    if not hmac.compare_digest(password.encode(), TOKEN.encode()):
        raise RelayError(407, "auth-required")
    if not IFACE_RE.match(user):
        raise RelayError(400, "bad-interface")
    return target.group(1).strip("[]"), int(target.group(2)), user


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (OSError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except OSError:
            pass


async def handle(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
        if len(head) > MAX_HEAD:
            raise RelayError(431, "head-too-large")
        host, port, iface = parse_head(head[:-4])
        sock = await open_pinned(host, port, iface)
    except RelayError as err:
        debug(f"tunnel refused: {err.code}")
        extra = 'Proxy-Authenticate: Basic realm="seed-relay"\r\n' if err.status == 407 else ""
        writer.write(f"HTTP/1.1 {err.status} Relay\r\nX-Seed-Relay-Error: {err.code}\r\n{extra}Content-Length: 0\r\nConnection: close\r\n\r\n".encode())
        await writer.drain()
        writer.close()
        return
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, OSError):
        writer.close()
        return
    debug(f"tunnel {host}:{port} via {iface} -> connected")
    up_reader, up_writer = await asyncio.open_connection(sock=sock)
    writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
    await writer.drain()
    await asyncio.gather(pipe(reader, up_writer), pipe(up_reader, writer))


async def watch_parent():
    """Exit when the app closes our stdin (the app stopped or crashed)."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, sys.stdin.buffer.read)
    os._exit(0)


async def main():
    if len(TOKEN) < 32:
        print("ERROR token", flush=True)
        sys.exit(2)
    server = await asyncio.start_server(handle, "127.0.0.1", 0, limit=MAX_HEAD)
    print(f"READY {server.sockets[0].getsockname()[1]}", flush=True)
    asyncio.ensure_future(watch_parent())
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
