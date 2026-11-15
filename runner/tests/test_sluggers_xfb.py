import pytest
from starworks_runner.games.sluggers.bridge.layout import BridgeProtocolError
from starworks_runner.games.sluggers.xfb import (
    VI_STATE_ADDRESS,
    VI_STATE_SIZE,
    XFB_HEIGHT_OFFSET,
    XFB_POINTER_OFFSET,
    XFB_WIDTH_OFFSET,
    XfbFrameReader,
)


class FakeMemory:
    def __init__(self, state: bytes, pixels: bytes) -> None:
        self.state = state
        self.pixels = pixels

    def read(self, address: int, size: int) -> bytes:
        if address == VI_STATE_ADDRESS:
            return self.state[:size]
        return self.pixels[:size]


def vi_state(*, address: int, width: int, height: int) -> bytes:
    value = bytearray(VI_STATE_SIZE)
    value[XFB_POINTER_OFFSET : XFB_POINTER_OFFSET + 4] = address.to_bytes(4, "big")
    value[XFB_WIDTH_OFFSET : XFB_WIDTH_OFFSET + 2] = width.to_bytes(2, "big")
    value[XFB_HEIGHT_OFFSET : XFB_HEIGHT_OFFSET + 2] = height.to_bytes(2, "big")
    return bytes(value)


def test_xfb_reader_decodes_two_yuyv_pixels() -> None:
    width = 320
    height = 200
    pair = bytes((16, 128, 235, 128))
    pixels = pair * (width * height // 2)
    reader = XfbFrameReader(
        FakeMemory(vi_state(address=0x90001000, width=width, height=height), pixels)
    )

    frame = reader.read()
    image = frame.to_rgb()

    assert frame.address == 0x90001000
    assert image.size == (width, height)
    assert image.getpixel((0, 0)) == (0, 0, 0)
    assert image.getpixel((1, 0)) == (255, 255, 255)


@pytest.mark.parametrize(
    ("address", "width", "height"),
    ((0, 640, 448), (0x90001000, 641, 448), (0x90001000, 640, 0)),
)
def test_xfb_reader_rejects_unready_or_invalid_vi_state(
    address: int, width: int, height: int
) -> None:
    reader = XfbFrameReader(
        FakeMemory(vi_state(address=address, width=width, height=height), b"")
    )

    with pytest.raises(BridgeProtocolError):
        reader.read()
