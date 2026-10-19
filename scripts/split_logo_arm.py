from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "icon.png"


def main() -> None:
    image = np.array(Image.open(SRC))
    height, width = image.shape[:2]
    opaque = image[:, :, 3] > 16
    rgb = image[:, :, :3].astype(np.int16)
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    visor = (
        (blue > 170)
        & (green > 160)
        & (red > 145)
        & ((blue - red) < 90)
        & (green + 25 > red)
    )

    polygon = Image.new("L", (width, height), 0)
    ImageDraw.Draw(polygon).polygon(
        [
            (145, 248),
            (448, 248),
            (448, 328),
            (400, 360),
            (355, 430),
            (348, 478),
            (210, 505),
            (140, 470),
            (140, 300),
        ],
        fill=255,
    )
    arm = opaque & (np.array(polygon) > 0)
    glove = (
        (image[:, :, 3] > 80)
        & (red > 210)
        & (green > 210)
        & (blue > 200)
        & (np.arange(height)[:, None] < 360)
        & (np.arange(height)[:, None] > 190)
        & (np.arange(width)[None, :] < 470)
        & (np.arange(width)[None, :] > 300)
    )
    cuff = (
        (image[:, :, 3] > 80)
        & (red > 130)
        & (red < 220)
        & (green < 150)
        & (blue > 120)
        & (blue < 210)
        & (np.arange(height)[:, None] > 250)
        & (np.arange(height)[:, None] < 420)
        & (np.arange(width)[None, :] < 460)
    )
    extra = opaque & (glove | cuff) & ~visor
    for _ in range(48):
        grown = ndimage.binary_dilation(arm) & extra & ~arm
        if not grown.any():
            break
        arm |= grown

    glass = (
        (blue > 205)
        & (green > 205)
        & (red < 235)
        & (blue > red + 12)
        & (np.arange(height)[:, None] < 330)
    )
    arm &= ~glass
    fringe = ndimage.binary_dilation(arm, iterations=2) & (image[:, :, 3] > 0) & ~arm
    arm |= fringe & ~glass

    ys, xs = np.where(arm)
    print("pixels", int(arm.sum()))
    print("bbox", int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    for y in range(280, 400, 8):
        left = np.flatnonzero(opaque[y] & (np.arange(width) < 460))
        got = np.flatnonzero(arm[y])
        print(
            y,
            "opaque",
            (int(left[0]), int(left[-1])) if left.size else None,
            "arm",
            (int(got[0]), int(got[-1])) if got.size else None,
        )

    joint = arm & (np.arange(height)[:, None] > 430) & (np.arange(height)[:, None] < 500)
    joint_ys, joint_xs = np.where(joint)
    pivot_x = int(np.percentile(joint_xs, 92))
    pivot_y = int(np.median(joint_ys))
    print("pivot", pivot_x, pivot_y)

    yy, xx = np.ogrid[:height, :width]
    shoulder = (xx - pivot_x) ** 2 + (yy - pivot_y) ** 2 <= 24**2
    body = image.copy()
    body[arm & ~shoulder, 3] = 0
    arm_only = np.zeros_like(image)
    arm_only[arm] = image[arm]

    stacked = body.copy()
    cover = arm_only[:, :, 3] > 0
    stacked[cover] = arm_only[cover]
    diff = np.abs(stacked.astype(int) - image.astype(int)).max()
    print("composite diff", int(diff))

    Image.fromarray(arm_only).save(ROOT / "public" / "logo-arm.png")
    Image.fromarray(body).save(ROOT / "public" / "logo-body.png")
    Image.fromarray(arm_only).resize((420, 420), Image.Resampling.BOX).save(
        ROOT / "public" / "_arm_preview.png"
    )
    Image.fromarray(body).resize((420, 420), Image.Resampling.BOX).save(
        ROOT / "public" / "_body_preview.png"
    )


if __name__ == "__main__":
    main()
