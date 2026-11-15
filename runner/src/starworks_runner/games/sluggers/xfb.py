from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from PIL import Image

from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError

# Independently mapped against the exact RMBE01 DOL. The SDK
# VISetNextFrameBuffer function at 0x805AF54C stores its framebuffer pointer at
# 0x807312A0. The adjacent VI state supplies the configured width and height.
VI_STATE_ADDRESS = 0x80731270
XFB_POINTER_OFFSET = 0x30
XFB_WIDTH_OFFSET = 0x12
XFB_HEIGHT_OFFSET = 0x14
VI_STATE_SIZE = 0x60


class MemoryReader(Protocol):
    def read(self, address: int, size: int) -> bytes: ...


@dataclass(frozen=True)
class XfbFrame:
    address: int
    width: int
    height: int
    yuyv: bytes

    def to_rgb(self) -> Image.Image:
        """Decode Wii YUYV 4:2:2 pixels into an RGB Pillow image."""

        rgb = bytearray(self.width * self.height * 3)
        destination = 0
        for source in range(0, len(self.yuyv), 4):
            y0, cb, y1, cr = self.yuyv[source : source + 4]
            rgb[destination : destination + 3] = _ycbcr_to_rgb(y0, cb, cr)
            rgb[destination + 3 : destination + 6] = _ycbcr_to_rgb(y1, cb, cr)
            destination += 6
        return Image.frombytes("RGB", (self.width, self.height), bytes(rgb))


class XfbFrameReader:
    """Read the game's current external framebuffer directly through DME."""

    def __init__(self, transport: MemoryReader) -> None:
        self.transport = transport

    def read(self) -> XfbFrame:
        state = self.transport.read(VI_STATE_ADDRESS, VI_STATE_SIZE)
        if len(state) != VI_STATE_SIZE:
            raise BridgeProtocolError("Sluggers VI state read was short")
        address = int.from_bytes(
            state[XFB_POINTER_OFFSET : XFB_POINTER_OFFSET + 4], "big"
        )
        width = int.from_bytes(state[XFB_WIDTH_OFFSET : XFB_WIDTH_OFFSET + 2], "big")
        height = int.from_bytes(state[XFB_HEIGHT_OFFSET : XFB_HEIGHT_OFFSET + 2], "big")
        if width < 320 or width > 720 or width % 2 or height < 200 or height > 576:
            raise BridgeProtocolError(
                f"Sluggers XFB dimensions are not ready: {width}x{height}"
            )
        size = width * height * 2
        if not _is_guest_ram_range(address, size):
            raise BridgeProtocolError(
                f"Sluggers XFB pointer is not in Wii RAM: 0x{address:08X}"
            )
        pixels = self.transport.read(address, size)
        if len(pixels) != size:
            raise BridgeProtocolError("Sluggers XFB pixel read was short")
        return XfbFrame(address=address, width=width, height=height, yuyv=pixels)


def _is_guest_ram_range(address: int, size: int) -> bool:
    end = address + size
    return (0x80000000 <= address < end <= 0x81800000) or (
        0x90000000 <= address < end <= 0x94000000
    )


def _ycbcr_to_rgb(y: int, cb: int, cr: int) -> bytes:
    luminance = max(0, y - 16)
    blue_difference = cb - 128
    red_difference = cr - 128

    def clamp(value: int) -> int:
        return max(0, min(255, value))

    return bytes(
        (
            clamp((298 * luminance + 409 * red_difference + 128) >> 8),
            clamp(
                (298 * luminance - 100 * blue_difference - 208 * red_difference + 128)
                >> 8
            ),
            clamp((298 * luminance + 516 * blue_difference + 128) >> 8),
        )
    )
