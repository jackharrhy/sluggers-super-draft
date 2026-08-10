# syntax=docker/dockerfile:1.7

ARG STARWORKS_RUNNER_PLATFORM=linux/amd64
FROM ghcr.io/astral-sh/uv:0.12.0@sha256:606e70c71c852d03f611b1e56a195d08648507018a7057fab82c4974c4eae105 AS uv
FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7 AS runner-build

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /source
COPY contracts/fixtures ./contracts/fixtures
COPY contracts/generated ./contracts/generated
COPY runner ./runner
ENV UV_PROJECT_ENVIRONMENT=/opt/starworks
RUN uv sync --project /source/runner --frozen --no-dev --no-editable

FROM --platform=${STARWORKS_RUNNER_PLATFORM} lscr.io/linuxserver/dolphin:2606-ls75@sha256:439d9a5dfc4cfdc23bd1f3f48f47429701160f1a4044b585bca326710aa54681

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --from=runner-build /usr/local /usr/local
COPY --from=runner-build /opt/starworks /opt/starworks

ENV PATH="/opt/starworks/bin:${PATH}"

LABEL org.opencontainers.image.title="Starworks experimental Linux runner" \
      org.opencontainers.image.description="Dolphin 2606, Selkies, FFmpeg, and the Starworks Python runner" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later"

VOLUME ["/config", "/starworks-data"]

HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=4 \
  CMD QT_QPA_PLATFORM=offscreen /usr/games/dolphin-emu --version | grep -q '2606' \
    && ffmpeg -version >/dev/null \
    && /opt/starworks/bin/python -c 'import starworks_runner'
