import os
import shutil
import subprocess

import imageio_ffmpeg
import numpy as np
from PIL import Image
from scipy import ndimage

DOWNLOADS = r"C:\Users\W\Downloads"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PUBLIC = os.path.join(ROOT, "public")
LOGO_DIR = os.path.join(PUBLIC, "logo")


def detail_dir() -> str:
    return next(
        os.path.join(DOWNLOADS, name)
        for name in os.listdir(DOWNLOADS)
        if os.path.isdir(os.path.join(DOWNLOADS, name)) and "细" in name
    )


def knock_out(image: Image.Image) -> Image.Image:
    rgba = np.array(image.convert("RGBA"))
    rgb = rgba[:, :, :3].astype(np.int16)
    brightness = rgb.max(axis=2)
    saturation = brightness - rgb.min(axis=2)
    neutral_dark = (brightness <= 52) & (saturation <= 24)
    labeled, _ = ndimage.label(neutral_dark)
    border = np.unique(
        np.concatenate(
            [
                labeled[0, :],
                labeled[-1, :],
                labeled[:, 0],
                labeled[:, -1],
            ]
        )
    )
    background = np.isin(labeled, border[border != 0])

    holes = (brightness <= 14) & ~background
    hole_labels, hole_count = ndimage.label(holes)
    for label in range(1, hole_count + 1):
        region = hole_labels == label
        if int(region.sum()) >= 60:
            background |= region

    fringe = ndimage.binary_dilation(background, iterations=2) & ~background
    background |= fringe & (brightness <= 72) & (saturation <= 28)

    alpha = np.full(background.shape, 255, dtype=np.uint8)
    alpha[background] = 0
    crumbs = (alpha > 0) & (brightness <= 40) & (saturation <= 16)
    crumb_labels, crumb_count = ndimage.label(crumbs)
    for label in range(1, crumb_count + 1):
        region = crumb_labels == label
        if int(region.sum()) < 40:
            alpha[region] = 0
    rgba[:, :, 3] = alpha
    return Image.fromarray(rgba)


def resize_alpha(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    source = np.array(image.convert("RGBA")).astype(np.float32)
    color = source[:, :, :3] * (source[:, :, 3:4] / 255)
    premul = Image.fromarray(np.dstack([color, source[:, :, 3]]).astype(np.uint8), "RGBA")
    resized = np.array(premul.resize(size, Image.Resampling.LANCZOS)).astype(np.float32)
    alpha = resized[:, :, 3:4]
    visible = alpha[:, :, 0] > 8
    resized[:, :, :3][visible] = np.clip(
        resized[:, :, :3][visible] * 255 / alpha[:, :, 0][visible][:, None],
        0,
        255,
    )
    resized[:, :, 3][~visible] = 0
    brightness = resized[:, :, :3].max(axis=2)
    saturation = brightness - resized[:, :, :3].min(axis=2)
    fringe = (resized[:, :, 3] < 230) & (brightness <= 96) & (saturation <= 32)
    resized[:, :, 3][fringe] = 0
    return knock_out(Image.fromarray(resized.astype(np.uint8), "RGBA"))


def content_box(path: str) -> tuple[int, int, int, int]:
    rgb = np.array(Image.open(path).convert("RGB"))
    height, width = rgb.shape[:2]
    mask = rgb.max(axis=2) > 18
    corner = np.zeros_like(mask)
    corner[int(height * 0.9) :, int(width * 0.75) :] = True
    ys, xs = np.where(mask & ~corner)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def main() -> None:
    folder = detail_dir()
    stills = [
        os.path.join(folder, name)
        for name in os.listdir(folder)
        if name.lower().endswith(".jpg")
    ]
    salute = next(path for path in stills if not os.path.basename(path).startswith("Keyframe"))
    boxes = [content_box(path) for path in stills]
    union = (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )
    sample = Image.open(stills[0])
    width, height = sample.size
    print("frame", width, height)
    print("union", union)
    print(
        "fractions",
        {
            "x": round(union[0] / width, 4),
            "y": round(union[1] / height, 4),
            "w": round((union[2] - union[0]) / width, 4),
            "h": round((union[3] - union[1]) / height, 4),
        },
    )

    os.makedirs(LOGO_DIR, exist_ok=True)
    salute_box = content_box(salute)
    rest = knock_out(Image.open(salute).crop(salute_box))
    scale = min(720 / rest.width, 1200 / rest.height, 1)
    rest = resize_alpha(rest, (round(rest.width * scale), round(rest.height * scale)))
    rest.save(os.path.join(LOGO_DIR, "rest.png"), optimize=True)
    print("rest", rest.size)

    side = max(salute_box[2] - salute_box[0], salute_box[3] - salute_box[1])
    icon = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    pose = knock_out(Image.open(salute).crop(salute_box))
    icon.paste(pose, ((side - pose.width) // 2, (side - pose.height) // 2), pose)
    icon = resize_alpha(icon, (1024, 1024))
    icon.save(os.path.join(PUBLIC, "icon.png"), optimize=True)
    print("icon", icon.size)

    video = next(
        os.path.join(folder, name)
        for name in os.listdir(folder)
        if name.endswith(".mp4") and "方案" in name
    )
    target = os.path.join(LOGO_DIR, "sequence.mp4")
    if os.path.exists(target):
        print("video kept", os.path.getsize(target))
        return
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.check_call(
        [
            ffmpeg,
            "-y",
            "-i",
            video,
            "-an",
            "-vf",
            "scale=420:-2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "28",
            "-movflags",
            "+faststart",
            target,
        ]
    )
    print("video", os.path.getsize(target))

    for name in ("logo-arm.png", "logo-body.png"):
        stale = os.path.join(PUBLIC, name)
        if os.path.exists(stale):
            os.remove(stale)
    shutil.rmtree(os.path.join(ROOT, "scripts", "_video_samples"), ignore_errors=True)


if __name__ == "__main__":
    main()
