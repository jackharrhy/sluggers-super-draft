# Experimental Linux runner profile

This optional profile combines the same Starworks Python runner with a pinned
Dolphin 2606/Selkies image, an internal Wayland compositor and PulseAudio
session, and FFmpeg. It is intentionally separate from the root development
Compose stack: native Windows, macOS, and Linux stations remain the supported
path until the hardware acceptance matrix is complete.

The image is currently `linux/amd64` only because the pinned upstream Dolphin
container removed ARM64 support. It contains no game image, extracted game
files, content-pack output, credentials, or RTMP URL. `/starworks-data` must be a
host mount controlled by the operator. The RTMP destination is a Compose secret
read through `STARWORKS_RTMP_URL_FILE`; it is not placed in image history or
ordinary environment output.

## Build and inspect

```shell
cd deploy/runner
cp .env.example .env
mkdir -p secrets data
printf '%s' 'rtmps://publisher.example/live/replace-me' > secrets/rtmp-url
docker compose config
docker compose build runner
docker compose up -d runner
```

The Selkies operator desktop is bound to `https://127.0.0.1:3001`. GPU and input
devices are passed explicitly; change the two device paths for the target host.
The image's PulseAudio session carries Dolphin audio to both Selkies and the
FFmpeg capture input. Do not expose port 3001 to an untrusted network.

The container health check verifies the pinned Dolphin version, FFmpeg, and the
installed Python runner. During execution, the ordinary runner heartbeat adds
separate Dolphin, bridge, recording, and publishing component states; the web
operations screen is the authoritative lease and stream-health view.

## Decision gate

This profile is packaging, not evidence that unattended operation is ready. It
graduates only after all of the following pass on a documented Linux host:

1. A user-owned, supported RMBE01 dump builds and boots with hardware GPU access.
2. A real Wii input path works without broad `--privileged` access.
3. The Dolphin Memory Engine bridge completes its build/version/attempt-nonce
   handshake from inside the container.
4. A representative match records and publishes to a disposable RTMP endpoint
   while telemetry continues through a forced publisher failure.
5. Restart recovery does not claim or execute a second attempt.

Stock Dolphin documents Linux support and the `--batch`, `--user`, `--exec`, and
video-backend CLI controls used by Starworks. The source pin is tag `2606`,
commit `6094cfcf7b8fba733b3116fdf3414d51c1c0e4a4`. The derived base image is pinned
by OCI digest rather than a moving tag:

- <https://github.com/dolphin-emu/dolphin>
- <https://hub.docker.com/r/linuxserver/dolphin/tags>
- <https://docs.linuxserver.io/images/docker-baseimage-selkies/>

Starworks source remains MIT. A built image also contains Dolphin and therefore
includes GPL-2.0-or-later software and its notices; do not describe the combined
image itself as MIT-only.
