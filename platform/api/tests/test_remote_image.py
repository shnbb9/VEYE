"""The meal-photo link fetcher: a member's pasted link must never become a way
into anyone's network (server-side request forgery), and must still fetch a
real picture from the public internet.

No test touches the network. A fake resolver says what each host "resolves"
to, and a fake connector sends every allowed connection to a small web server
running in this process — so the checks are made on the addresses the
fetcher believes it is reaching, and the bytes it reads are real HTTP.
"""

from __future__ import annotations

import io
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PIL import Image

from app.core.config import Settings
from app.storage.remote_image import LinkRefused, RemoteImageFetcher, is_public

PUBLIC = "93.184.216.34"


def png_bytes() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 80, 20)).save(out, format="PNG")
    return out.getvalue()


PNG = png_bytes()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def _send(self, status, body=b"", kind="image/png", headers=None, length=True):
        self.send_response(status)
        if kind:
            self.send_header("Content-Type", kind)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        if length:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 - the stdlib's name
        self.server.seen.append((self.path, self.headers.get("Host")))
        routes = {
            "/photo.png": lambda: self._send(200, PNG),
            "/page.html": lambda: self._send(200, b"<html>a recipe blog</html>", "text/html; charset=utf-8"),
            "/anim.gif": lambda: self._send(200, b"GIF89a....", "image/gif"),
            "/big-declared": lambda: self._send(200, b"x" * 10, "image/png", {"Content-Length": "999999999"}, length=False),
            "/big-streamed": lambda: self._send(200, b"x" * 5000, "image/png", length=False),
            "/to-photo": lambda: self._send(302, b"", None, {"Location": "/photo.png"}),
            "/to-internal": lambda: self._send(302, b"", None, {"Location": "http://internal.example.com/photo.png"}),
            "/loop": lambda: self._send(302, b"", None, {"Location": "/loop"}),
            "/missing": lambda: self._send(404, b"not here", "text/plain"),
        }
        routes.get(self.path.split("?")[0], lambda: self._send(404, b"", "text/plain"))()


@pytest.fixture
def server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.seen = []
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield httpd
    httpd.shutdown()
    httpd.server_close()


def fetcher(server, dns: dict[str, list[str]], *, max_bytes=1_000_000, trusted=frozenset()) -> RemoteImageFetcher:
    reached: list[tuple[str, int]] = []

    def resolve(host, port):
        if host not in dns:
            raise socket.gaierror("no such host")
        return dns[host]

    def connect(address, port, timeout):
        reached.append((address, port))
        return socket.create_connection(server.server_address, timeout=timeout)

    made = RemoteImageFetcher(max_bytes=max_bytes, resolve=resolve, connect=connect, trusted_hosts=frozenset(trusted))
    made.reached = reached  # type: ignore[attr-defined]
    return made


# ---- the picture arrives ------------------------------------------------------------

def test_a_picture_on_a_public_website_is_fetched(server):
    got = fetcher(server, {"images.example.com": [PUBLIC]})
    assert got.fetch("http://images.example.com/photo.png") == PNG
    assert got.reached == [(PUBLIC, 80)], "connected to the address that was checked"
    assert server.seen[-1] == ("/photo.png", "images.example.com")


def test_a_redirect_to_a_picture_is_followed(server):
    assert fetcher(server, {"images.example.com": [PUBLIC]}).fetch("http://images.example.com/to-photo") == PNG


# ---- the address --------------------------------------------------------------------

@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://images.example.com/photo.png", "javascript:alert(1)",
    "data:image/png;base64,iVBORw0KGgo=", "gopher://images.example.com/", "images.example.com/photo.png", "", "   ",
])
def test_only_web_links_are_followed(server, url):
    with pytest.raises(LinkRefused) as refused:
        fetcher(server, {"images.example.com": [PUBLIC]}).fetch(url)
    assert refused.value.status_code == 422
    assert server.seen == []


def test_credentials_and_unusual_ports_are_refused(server):
    got = fetcher(server, {"images.example.com": [PUBLIC]})
    with pytest.raises(LinkRefused, match="user name or password"):
        got.fetch("http://someone:secret@images.example.com/photo.png")
    with pytest.raises(LinkRefused, match="unusual ports"):
        got.fetch("http://images.example.com:8080/photo.png")
    assert server.seen == []


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.10", "169.254.169.254",  # the cloud metadata service
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
])
def test_private_and_local_addresses_are_never_reached(server, address):
    got = fetcher(server, {"sneaky.example.com": [address]})
    with pytest.raises(LinkRefused, match="private or local address"):
        got.fetch("http://sneaky.example.com/photo.png")
    assert got.reached == [] and server.seen == []


def test_one_private_address_among_public_ones_is_enough_to_refuse(server):
    got = fetcher(server, {"split.example.com": [PUBLIC, "10.9.8.7"]})
    with pytest.raises(LinkRefused, match="private or local address"):
        got.fetch("https://split.example.com/photo.png")
    assert got.reached == []


def test_a_redirect_into_a_private_network_is_refused(server):
    got = fetcher(server, {"images.example.com": [PUBLIC], "internal.example.com": ["10.1.2.3"]})
    with pytest.raises(LinkRefused, match="private or local address"):
        got.fetch("http://images.example.com/to-internal")
    assert got.reached == [(PUBLIC, 80)], "the private hop was never connected to"


def test_redirects_are_limited(server):
    with pytest.raises(LinkRefused, match="redirects too many times"):
        fetcher(server, {"images.example.com": [PUBLIC]}).fetch("http://images.example.com/loop")


def test_an_unknown_or_unreachable_website_says_so(server):
    with pytest.raises(LinkRefused, match="could not be found"):
        fetcher(server, {}).fetch("http://nowhere.example.com/photo.png")

    def refuse(address, port, timeout):
        raise ConnectionRefusedError()

    blocked = RemoteImageFetcher(max_bytes=1000, resolve=lambda host, port: [PUBLIC], connect=refuse)
    with pytest.raises(LinkRefused, match="could not be reached"):
        blocked.fetch("http://images.example.com/photo.png")


# ---- what comes back ---------------------------------------------------------------

def test_a_web_page_is_refused_with_words_that_say_what_to_do(server):
    with pytest.raises(LinkRefused) as refused:
        fetcher(server, {"blog.example.com": [PUBLIC]}).fetch("http://blog.example.com/page.html")
    assert refused.value.status_code == 415
    assert "web page, not a picture" in refused.value.detail and "copy its address" in refused.value.detail


def test_unsupported_pictures_and_missing_ones_are_refused(server):
    got = fetcher(server, {"images.example.com": [PUBLIC]})
    with pytest.raises(LinkRefused, match="JPG, PNG or WebP"):
        got.fetch("http://images.example.com/anim.gif")
    with pytest.raises(LinkRefused, match="answered 404"):
        got.fetch("http://images.example.com/missing")


def test_too_large_is_refused_whether_declared_or_streamed(server):
    got = fetcher(server, {"images.example.com": [PUBLIC]}, max_bytes=1000)
    with pytest.raises(LinkRefused) as declared:
        got.fetch("http://images.example.com/big-declared")
    assert declared.value.status_code == 413
    with pytest.raises(LinkRefused) as streamed:
        got.fetch("http://images.example.com/big-streamed")
    assert streamed.value.status_code == 413


# ---- the local stack's own containers, and never in production ----------------------

def test_a_trusted_local_host_may_be_private_and_on_its_own_port(server):
    got = fetcher(server, {"web": ["172.18.0.5"]}, trusted={"web:3000"})
    assert got.fetch("http://web:3000/photo.png") == PNG
    assert got.reached == [("172.18.0.5", 3000)]
    with pytest.raises(LinkRefused, match="private or local address"):
        fetcher(server, {"web": ["172.18.0.5"]}).fetch("http://web/photo.png")


def test_production_never_trusts_a_private_host_whatever_the_env_file_says():
    assert Settings(database_url="sqlite://", environment="production",
                    remote_image_trusted_hosts="web:3000").remote_image_trusted_host_set == frozenset()
    assert Settings(database_url="sqlite://", environment="local",
                    remote_image_trusted_hosts="web:3000, host.docker.internal").remote_image_trusted_host_set == {"web:3000", "host.docker.internal"}


def test_the_public_address_rule_itself():
    assert is_public(PUBLIC) and is_public("2606:4700:4700::1111")
    for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:192.168.0.1", "ff02::1"):
        assert not is_public(address), address
