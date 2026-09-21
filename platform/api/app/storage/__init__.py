"""Object storage boundary for member media (profile photos today; uploaded
care videos later). One abstraction, swappable implementations: the local
file store for development and tests, a cloud bucket (GCS is the client's
likely target) once the production project exists. Nothing binds the
application to a vendor SDK."""
