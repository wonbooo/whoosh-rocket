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
    rgb = rgba[:, :, :3]
    dark = rgb.max(axis=2) <= 28
    labeled, _ = ndimage.label(dark)
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
    brightness = rgb.max(axis=2).astype(np.int16)
    edge = ndimage.binary_dilation(background) & ~background & (brightness <= 70)
    alpha = np.full(background.shape, 255, dtype=np.uint8)
    alpha[background] = 0
    alpha[edge] = np.clip((brightness[edge] - 28) * 255 // 42, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = alpha
    return Image.fromarray(rgba)


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
    rest.thumbnail((720, 1200), Image.Resampling.LANCZOS)
    rest.save(os.path.join(LOGO_DIR, "rest.png"), optimize=True)
    print("rest", rest.size)

    side = max(salute_box[2] - salute_box[0], salute_box[3] - salute_box[1])
    icon = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    pose = knock_out(Image.open(salute).crop(salute_box))
    icon.paste(pose, ((side - pose.width) // 2, (side - pose.height) // 2), pose)
    icon = icon.resize((1024, 1024), Image.Resampling.LANCZOS)
    icon.save(os.path.join(PUBLIC, "icon.png"), optimize=True)
    print("icon", icon.size)

    video = next(
        os.path.join(folder, name)
        for name in os.listdir(folder)
        if name.endswith(".mp4") and "方案" in name
    )
    target = os.path.join(LOGO_DIR, "sequence.mp4")
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
