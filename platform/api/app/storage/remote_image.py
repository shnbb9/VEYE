"""Fetching a picture from a link a member pasted, without becoming a way into
anyone's network.

The link is the member's text, so this is an outbound request on behalf of
untrusted input (server-side request forgery). The rules:

* http or https only, on the default ports, with no credentials in the link;
* the host must resolve ONLY to public internet addresses (`is_global`).
  Loopback, private ranges, link-local (169.254.169.254 is the cloud metadata
  service), carrier-grade NAT, multicast and reserved space are refused, and
  an IPv4 address dressed as IPv6 is judged as the IPv4 address it is;
* the connection goes to the address that was checked — there is no second
  lookup between the check and the connect, so DNS rebinding cannot swap it
  — and TLS is verified for the host name;
* at most three redirects, each checked the same way;
* a hard size cap read in chunks, a per-read timeout and an overall deadline;
* a web page is refused with words that say how to get the picture's own
  address. Whatever arrives is still decoded and rebuilt like an upload.

`trusted_hosts` exists for the local stack only (its own containers, so the
browser suite can prove the link journey without the internet); production
clears it in Settings.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import time
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import SplitResult, urljoin, urlsplit

MAX_URL_LENGTH = 2048
MAX_REDIRECTS = 3
READ_TIMEOUT = 5.0
DEADLINE = 15.0
CHUNK = 64 * 1024
DEFAULT_PORTS = {"http": 80, "https": 443}
REDIRECTS = {301, 302, 303, 307, 308}
ACCEPTED_TYPES = {"image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"}
USER_AGENT = "VeyeImageFetch/1.0"


class LinkRefused(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


Resolver = Callable[[str, int], list[str]]
Connector = Callable[[str, int, float], socket.socket]


def resolve_host(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


def open_connection(address: str, port: int, timeout: float) -> socket.socket:
    return socket.create_connection((address, port), timeout=timeout)


def is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


@dataclass(frozen=True)
class _Target:
    scheme: str
    host: str
    port: int
    default_port: int
    path: str
    trusted: bool


@dataclass
class RemoteImageFetcher:
    max_bytes: int
    resolve: Resolver = resolve_host
    connect: Connector = open_connection
    trusted_hosts: frozenset[str] = field(default_factory=frozenset)
    tls: ssl.SSLContext | None = None

    def fetch(self, url: str) -> bytes:
        deadline = time.monotonic() + DEADLINE
        current = (url or "").strip()
        for _ in range(MAX_REDIRECTS + 1):
            target = self._check(current)
            status, location, body = self._get(target, deadline)
            if status in REDIRECTS:
                if not location:
                    raise LinkRefused(422, "That link did not lead to a picture.")
                current = urljoin(current, location)
                continue
            return body
        raise LinkRefused(422, "That link redirects too many times. Open the picture itself and copy its address.")

    # ---- the address ------------------------------------------------------------
    def _check(self, url: str) -> _Target:
        if not url or len(url) > MAX_URL_LENGTH or any(ch.isspace() for ch in url):
            raise LinkRefused(422, "Paste the address of a picture — it starts with https://.")
        parts: SplitResult = urlsplit(url)
        scheme = (parts.scheme or "").lower()
        if scheme not in DEFAULT_PORTS:
            raise LinkRefused(422, "Use a link that starts with https:// (or http://).")
        if parts.username is not None or parts.password is not None:
            raise LinkRefused(422, "Links with a user name or password in them are not accepted.")
        host = (parts.hostname or "").lower().rstrip(".")
        if not host:
            raise LinkRefused(422, "That link has no website in it.")
        try:
            explicit = parts.port
        except ValueError as exc:
            raise LinkRefused(422, "That link's address is not valid.") from exc
        default_port = DEFAULT_PORTS[scheme]
        port = explicit or default_port
        trusted = host in self.trusted_hosts or f"{host}:{port}" in self.trusted_hosts
        if port != default_port and not trusted:
            raise LinkRefused(422, "Links to unusual ports are not accepted.")
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        return _Target(scheme, host, port, default_port, path, trusted)

    def _addresses(self, target: _Target) -> list[str]:
        try:
            found = self.resolve(target.host, target.port)
        except (socket.gaierror, UnicodeError, OSError) as exc:
            raise LinkRefused(422, "That website could not be found.") from exc
        if not found:
            raise LinkRefused(422, "That website could not be found.")
        try:
            public = all(is_public(address) for address in found)
        except ValueError as exc:
            raise LinkRefused(422, "That website could not be found.") from exc
        if not public and not target.trusted:
            raise LinkRefused(422, "That link points to a private or local address, which Veye does not fetch.")
        return found

    # ---- the request ------------------------------------------------------------
    def _get(self, target: _Target, deadline: float) -> tuple[int, str | None, bytes]:
        address = self._addresses(target)[0]
        timeout = max(0.5, min(READ_TIMEOUT, deadline - time.monotonic()))
        try:
            sock = self.connect(address, target.port, timeout)
        except (socket.timeout, TimeoutError) as exc:
            raise LinkRefused(504, "That website took too long to answer.") from exc
        except OSError as exc:
            raise LinkRefused(422, "That website could not be reached.") from exc
        try:
            if target.scheme == "https":
                context = self.tls or ssl.create_default_context()
                sock = context.wrap_socket(sock, server_hostname=target.host)
            conn = http.client.HTTPConnection(target.host, target.port, timeout=timeout)
            conn.sock = sock  # already connected to the address that was checked
            host_header = f"[{target.host}]" if ":" in target.host else target.host
            if target.port != target.default_port:
                host_header += f":{target.port}"
            conn.putrequest("GET", target.path, skip_host=True, skip_accept_encoding=True)
            conn.putheader("Host", host_header)
            conn.putheader("User-Agent", USER_AGENT)
            conn.putheader("Accept", "image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.5")
            conn.putheader("Accept-Encoding", "identity")
            conn.putheader("Connection", "close")
            conn.endheaders()
            response = conn.getresponse()
            if response.status in REDIRECTS:
                return response.status, response.getheader("Location"), b""
            if response.status != 200:
                raise LinkRefused(422, f"That link did not return a picture (the website answered {response.status}).")
            kind = (response.getheader("Content-Type") or "").split(";", 1)[0].strip().lower()
            if kind.startswith("text/") or kind in {"application/xhtml+xml", "application/json"}:
                raise LinkRefused(415, "That link opens a web page, not a picture. Open the picture itself and copy its address.")
            if kind.startswith("image/") and kind not in ACCEPTED_TYPES:
                raise LinkRefused(415, "Please use a JPG, PNG or WebP picture.")
            length = response.getheader("Content-Length")
            if length and length.isdigit() and int(length) > self.max_bytes:
                raise LinkRefused(413, self._too_large())
            return response.status, None, self._read(response, deadline)
        except LinkRefused:
            raise
        except (socket.timeout, TimeoutError) as exc:
            raise LinkRefused(504, "That website took too long to send the picture.") from exc
        except (ssl.SSLError, ssl.CertificateError) as exc:
            raise LinkRefused(422, "That website's secure connection could not be verified.") from exc
        except (OSError, http.client.HTTPException) as exc:
            raise LinkRefused(422, "That website could not be reached.") from exc
        finally:
            try:
                sock.close()
            except OSError:
                pass

    def _read(self, response: http.client.HTTPResponse, deadline: float) -> bytes:
        chunks: list[bytes] = []
        total = 0
        while True:
            if time.monotonic() > deadline:
                raise LinkRefused(504, "That website took too long to send the picture.")
            chunk = response.read(CHUNK)
            if not chunk:
                break
            total += len(chunk)
            if total > self.max_bytes:
                raise LinkRefused(413, self._too_large())
            chunks.append(chunk)
        if not total:
            raise LinkRefused(422, "That link returned nothing.")
        return b"".join(chunks)

    def _too_large(self) -> str:
        return f"The picture is too large. Please use one under {self.max_bytes // 1_000_000} MB."
