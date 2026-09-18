FROM python:3.12-slim

LABEL io.veye.local=true

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY . .
# The [ai] extra installs the optional Groq and Langfuse SDKs so a development
# key in the ignored env file is enough to switch them on. Neither is required.
RUN pip install --no-cache-dir ".[ai]"

EXPOSE 8000
