"""Authenticated encryption for a visitor's saved questionnaire.

The complete answers and the result are health information about someone who
has no account yet, so nothing health-related about a prospect is stored in
clear: the whole payload is AES-256-GCM under a managed key, with the record's
own id as associated data. A ciphertext copied onto another row does not
decrypt there, and a byte changed anywhere is refused rather than misread.

Keys come from `VEYE_PROSPECT_ENCRYPTION_KEYS` (Secret Manager in a real
deployment): a comma-separated `kid:base64key` list whose first entry encrypts
and every entry decrypts, so a key can be rotated without rewriting old rows
first. Locally, with nothing configured, a fixed development key is used — it
is in this public repository and protects nothing, which is why production
refuses to save anything without a configured key instead of falling back.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

FORMAT = "v1"
DEVELOPMENT_KEY_ID = "local-dev"
# Not a secret. Deliberately derived from a phrase that says what it is.
_DEVELOPMENT_KEY = hashlib.sha256(b"veye local development prospect key - not a secret").digest()


class CipherError(Exception):
    """A ciphertext that cannot be opened: unknown key, wrong row, or tampered."""


class CipherNotConfigured(Exception):
    """Production has no encryption key, so nothing may be saved."""


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class AnswerCipher:
    def __init__(self, keys: dict[str, bytes], active_key_id: str) -> None:
        if active_key_id not in keys:
            raise ValueError("The active key id must be one of the keys.")
        for kid, key in keys.items():
            if len(key) != 32:
                raise ValueError(f"Key {kid!r} must be 32 bytes (AES-256).")
            if not kid or "." in kid or ":" in kid:
                raise ValueError("A key id must be non-empty and contain no '.' or ':'.")
        self._keys = dict(keys)
        self.active_key_id = active_key_id

    @property
    def is_development_key(self) -> bool:
        return self.active_key_id == DEVELOPMENT_KEY_ID

    @classmethod
    def from_config(cls, raw: str | None, *, production: bool) -> "AnswerCipher":
        if not raw or not raw.strip():
            if production:
                raise CipherNotConfigured("VEYE_PROSPECT_ENCRYPTION_KEYS is not set.")
            return cls({DEVELOPMENT_KEY_ID: _DEVELOPMENT_KEY}, DEVELOPMENT_KEY_ID)
        keys: dict[str, bytes] = {}
        order: list[str] = []
        for item in raw.split(","):
            item = item.strip()
            if not item:
                continue
            kid, sep, encoded = item.partition(":")
            if not sep:
                raise ValueError("Each key is written kid:base64key.")
            try:
                key = base64.b64decode(encoded.strip(), validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError(f"Key {kid.strip()!r} is not valid base64.") from exc
            keys[kid.strip()] = key
            order.append(kid.strip())
        if not order:
            raise ValueError("No keys were given.")
        if production and DEVELOPMENT_KEY_ID in keys:
            raise CipherNotConfigured("The development key may not be used in production.")
        return cls(keys, order[0])

    def encrypt(self, data: bytes, *, aad: bytes) -> str:
        nonce = os.urandom(12)
        sealed = AESGCM(self._keys[self.active_key_id]).encrypt(nonce, data, aad)
        return f"{FORMAT}.{self.active_key_id}.{_b64(nonce + sealed)}"

    def decrypt(self, token: str, *, aad: bytes) -> bytes:
        try:
            fmt, kid, body = token.split(".", 2)
        except ValueError as exc:
            raise CipherError("Unrecognised ciphertext.") from exc
        if fmt != FORMAT or kid not in self._keys:
            raise CipherError("Unknown ciphertext format or key.")
        try:
            raw = _unb64(body)
            return AESGCM(self._keys[kid]).decrypt(raw[:12], raw[12:], aad)
        except (InvalidTag, ValueError, binascii.Error) as exc:
            raise CipherError("The ciphertext does not open under its key for this record.") from exc
