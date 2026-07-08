import os
import hashlib
import json
import re
import shutil
import subprocess

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths
import node_helpers
from aiohttp import web
from server import PromptServer

try:
    import cv2
except ImportError:
    cv2 = None


VIDEO_EXTENSIONS = ["webm", "mp4", "mkv", "gif", "mov"]
BIGMAX = 2**31 - 1
AICOSER_UPLOAD_SUBFOLDER = "aicoser_uploads"
_AICOSER_FFMPEG_PATH = None


def _empty_audio(sample_rate=44100):
    return {"waveform": torch.zeros((1, 2, 0), dtype=torch.float32), "sample_rate": int(sample_rate)}


def _ffmpeg_path():
    global _AICOSER_FFMPEG_PATH
    if _AICOSER_FFMPEG_PATH is not None:
        return _AICOSER_FFMPEG_PATH
    paths = []
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
        imageio_path = get_ffmpeg_exe()
        if imageio_path:
            paths.append(imageio_path)
    except Exception:
        pass
    system_path = shutil.which("ffmpeg")
    if system_path:
        paths.append(system_path)
    if os.path.isfile("ffmpeg"):
        paths.append(os.path.abspath("ffmpeg"))
    if os.path.isfile("ffmpeg.exe"):
        paths.append(os.path.abspath("ffmpeg.exe"))
    _AICOSER_FFMPEG_PATH = paths[0] if paths else ""
    return _AICOSER_FFMPEG_PATH


def _read_video_audio(video_path, start_time=0, duration=0):
    ffmpeg = _ffmpeg_path()
    if not ffmpeg:
        print(f"[AICoser_LoadVideoUpload] warn audio skipped, ffmpeg not found, video={video_path}")
        return _empty_audio()
    args = [ffmpeg, "-i", video_path]
    if start_time > 0:
        args += ["-ss", str(start_time)]
    if duration > 0:
        args += ["-t", str(duration)]
    try:
        res = subprocess.run(args + ["-f", "f32le", "-"], capture_output=True, check=True)
        stderr = res.stderr.decode("utf-8", errors="ignore")
        match = re.search(r", (\d+) Hz, (\w+), ", stderr)
        sample_rate = int(match.group(1)) if match else 44100
        channel_name = match.group(2) if match else "stereo"
        channels = {"mono": 1, "stereo": 2}.get(channel_name, 2)
        if not res.stdout:
            print(f"[AICoser_LoadVideoUpload] warn audio empty, video={video_path}, startTime={start_time}, duration={duration}")
            return _empty_audio(sample_rate)
        audio = torch.frombuffer(bytearray(res.stdout), dtype=torch.float32)
        usable = (audio.numel() // channels) * channels
        if usable <= 0:
            return _empty_audio(sample_rate)
        audio = audio[:usable].reshape((-1, channels)).transpose(0, 1).unsqueeze(0)
        return {"waveform": audio, "sample_rate": sample_rate}
    except Exception as e:
        print(f"[AICoser_LoadVideoUpload] warn audio extract failed, video={video_path}, startTime={start_time}, duration={duration}, error={e}")
        return _empty_audio()


def _list_input_videos():
    input_dir = folder_paths.get_input_directory()
    files = []
    for root, _, names in os.walk(input_dir):
        for name in names:
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if ext not in VIDEO_EXTENSIONS:
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, input_dir).replace("\\", "/")
            files.append(rel)
    return sorted(files)


def _target_video_size(width, height, custom_width, custom_height):
    if custom_width <= 0 and custom_height <= 0:
        return width, height
    if custom_width > 0 and custom_height > 0:
        return int(custom_width), int(custom_height)
    if custom_width > 0:
        return int(custom_width), max(1, int(round(height * (custom_width / width))))
    return max(1, int(round(width * (custom_height / height)))), int(custom_height)


def _read_video_metadata(video_path):
    if cv2 is None:
        raise RuntimeError("opencv-python is required for AICoser_LoadVideoUpload")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"video could not be opened: {video_path}")

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
        if fps <= 0:
            fps = 24.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        duration = float(frame_count / fps) if frame_count > 0 and fps > 0 else 0.0
        return {
            "fps": fps,
            "frame_count": frame_count,
            "duration": duration,
            "width": width,
            "height": height,
        }
    finally:
        cap.release()


@PromptServer.instance.routes.get("/aicoser/video_metadata")
async def aicoser_video_metadata(request):
    video = request.query.get("filename") or request.query.get("video") or ""
    if not video:
        return web.json_response({"error": "filename is required"}, status=400)
    if not folder_paths.exists_annotated_filepath(video):
        return web.json_response({"error": f"Invalid video file: {video}"}, status=404)
    try:
        video_path = folder_paths.get_annotated_filepath(video)
        meta = _read_video_metadata(video_path)
        meta["filename"] = video
        return web.json_response(meta)
    except Exception as e:
        print(f"[AICoser_LoadVideoUpload] video metadata failed, video={video}, error={e}")
        return web.json_response({"error": str(e)}, status=500)


def _delete_aicoser_uploaded_video(video, video_path):
    input_dir = os.path.abspath(folder_paths.get_input_directory())
    target_path = os.path.abspath(video_path)
    allowed_dir = os.path.abspath(os.path.join(input_dir, AICOSER_UPLOAD_SUBFOLDER))

    try:
        common = os.path.commonpath([allowed_dir, target_path])
    except ValueError:
        print(f"[AICoser_LoadVideoUpload] skip delete: invalid path video={video} path={video_path}")
        return False

    if common != allowed_dir:
        print(f"[AICoser_LoadVideoUpload] skip delete: not in {AICOSER_UPLOAD_SUBFOLDER} video={video} path={video_path}")
        return False

    if not os.path.isfile(target_path):
        print(f"[AICoser_LoadVideoUpload] skip delete: file missing video={video} path={video_path}")
        return False

    try:
        os.remove(target_path)
        print(f"[AICoser_LoadVideoUpload] deleted uploaded video video={video} path={video_path}")
        return True
    except Exception as e:
        print(f"[AICoser_LoadVideoUpload] failed to delete uploaded video video={video} path={video_path} error={e}")
        return False


def _read_video_frames(video_path, force_rate, custom_width, custom_height, frame_load_cap, skip_first_frames, select_every_nth):
    if cv2 is None:
        raise RuntimeError("opencv-python is required for AICoser_LoadVideoUpload")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"video could not be opened: {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    if fps <= 0:
        fps = 24.0

    source_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    source_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    source_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    source_duration = float(source_frame_count / fps) if source_frame_count > 0 else 0.0

    skip_first_frames = max(0, int(skip_first_frames or 0))
    select_every_nth = max(1, int(select_every_nth or 1))
    frame_load_cap = max(0, int(frame_load_cap or 0))
    force_rate = float(force_rate or 0)

    target_fps = fps if force_rate <= 0 else force_rate
    sample_interval = max(1, int(round(fps / target_fps))) if force_rate > 0 else 1
    effective_step = max(1, sample_interval * select_every_nth)

    if skip_first_frames > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, skip_first_frames)

    frames = []
    evaluated = skip_first_frames
    loaded = 0
    target_width = source_width
    target_height = source_height

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if (evaluated - skip_first_frames) % effective_step != 0:
            evaluated += 1
            continue

        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        if target_width <= 0 or target_height <= 0:
            target_height, target_width = frame.shape[:2]

        new_width, new_height = _target_video_size(target_width, target_height, int(custom_width or 0), int(custom_height or 0))
        if new_width != frame.shape[1] or new_height != frame.shape[0]:
            frame = cv2.resize(frame, (new_width, new_height), interpolation=cv2.INTER_AREA)

        frames.append(frame.astype(np.float32) / 255.0)
        loaded += 1
        evaluated += 1

        if frame_load_cap > 0 and loaded >= frame_load_cap:
            break

    cap.release()

    if not frames:
        raise RuntimeError("No frames generated")

    images = torch.from_numpy(np.stack(frames, axis=0))
    loaded_height = int(images.shape[1])
    loaded_width = int(images.shape[2])
    loaded_fps = fps / effective_step if effective_step > 0 else fps
    audio_start_time = skip_first_frames / fps if fps > 0 else 0
    audio_duration = len(frames) / loaded_fps if frame_load_cap > 0 and loaded_fps > 0 else 0
    audio = _read_video_audio(video_path, audio_start_time, audio_duration)
    video_info = {
        "source_fps": fps,
        "source_frame_count": source_frame_count,
        "source_duration": source_duration,
        "source_width": source_width,
        "source_height": source_height,
        "loaded_fps": loaded_fps,
        "loaded_frame_count": len(frames),
        "loaded_duration": len(frames) / loaded_fps if loaded_fps > 0 else 0,
        "loaded_width": loaded_width,
        "loaded_height": loaded_height,
        "skip_first_frames": skip_first_frames,
        "select_every_nth": select_every_nth,
    }
    return images, len(frames), audio, video_info, video_info


class BatchLoadImages:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image_list": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                    },
                ),
                "max_images": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
                "mode": (["batch", "single"], {"default": "batch"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
            }
        }

    CATEGORY = "ComfyUI-AICoser-Tools"

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "filenames")
    FUNCTION = "load_images"

    def load_images(self, image_list: str, max_images: int, mode: str, index: int):
        names = [x.strip() for x in (image_list or "").splitlines()]
        names = [x for x in names if x]

        if max_images and max_images > 0:
            names = names[:max_images]

        if mode == "single":
            if index < 0:
                index = 0
            if index >= len(names):
                index = len(names) - 1
            names = [names[index]]

        if len(names) == 0:
            raise ValueError("image_list is empty")

        output_images = []
        output_names = []

        excluded_formats = ["MPO"]

        for name in names:
            if not folder_paths.exists_annotated_filepath(name):
                continue

            image_path = folder_paths.get_annotated_filepath(name)
            img = node_helpers.pillow(Image.open, image_path)

            w, h = None, None
            frames = []

            for i in ImageSequence.Iterator(img):
                i = node_helpers.pillow(ImageOps.exif_transpose, i)

                if i.mode == "I":
                    i = i.point(lambda p: p * (1 / 255))
                pil_image = i.convert("RGB")

                if len(frames) == 0:
                    w = pil_image.size[0]
                    h = pil_image.size[1]

                if pil_image.size[0] != w or pil_image.size[1] != h:
                    continue

                arr = np.array(pil_image).astype(np.float32) / 255.0
                tensor = torch.from_numpy(arr)[None,]
                frames.append(tensor)

            if len(frames) == 0:
                continue

            if len(frames) > 1 and img.format not in excluded_formats:
                image_tensor = torch.cat(frames, dim=0)
            else:
                image_tensor = frames[0]

            output_images.append(image_tensor)
            output_names.append(name)

        if len(output_images) == 0:
            raise ValueError("No valid images found")

        output_image = torch.cat(output_images, dim=0)
        return (output_image, "\n".join(output_names))

    @classmethod
    def IS_CHANGED(s, image_list: str, max_images: int, mode: str, index: int):
        m = hashlib.sha256()
        names = [x.strip() for x in (image_list or "").splitlines()]
        names = [x for x in names if x]
        if max_images and max_images > 0:
            names = names[:max_images]

        if mode == "single":
            if index < 0:
                index = 0
            if index >= len(names):
                index = len(names) - 1
            names = names[:1] if len(names) == 0 else [names[index]]

        m.update(str(mode).encode("utf-8"))
        m.update(str(index).encode("utf-8"))
        m.update(str(max_images).encode("utf-8"))
        for name in names:
            m.update(name.encode("utf-8"))
            if folder_paths.exists_annotated_filepath(name):
                image_path = folder_paths.get_annotated_filepath(name)
                if os.path.isfile(image_path):
                    with open(image_path, "rb") as f:
                        m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, image_list: str, max_images: int, mode: str, index: int):
        names = [x.strip() for x in (image_list or "").splitlines()]
        names = [x for x in names if x]
        if max_images and max_images > 0:
            names = names[:max_images]

        if mode == "single":
            if len(names) == 0:
                return "image_list is empty"
            if index < 0:
                return "index must be >= 0"
            if index >= len(names):
                return f"index out of range (0..{len(names)-1})"

        if len(names) == 0:
            return "image_list is empty"

        valid = False
        for name in names:
            if folder_paths.exists_annotated_filepath(name):
                valid = True
                break

        if not valid:
            return "No valid images in image_list"

        return True


class PromptQueue:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompts_json": (
                    "STRING",
                    {
                        "default": "[]",
                        "hidden": True,
                    },
                ),
                "index": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
            }
            ,
            "optional": {
                "prompts": ("STRING", {"forceInput": True}),
            },
        }

    CATEGORY = "ComfyUI-AICoser-Tools"

    RETURN_TYPES = ("STRING", "INT", "INT")
    RETURN_NAMES = ("prompt", "index", "total")
    FUNCTION = "get_prompt"

    def get_prompt(self, prompts_json: str, index: int, prompts=None):
        items = None
        upstream_missing = False

        if prompts is not None:
            # Some dynamic upstreams/frontends may pass empty placeholders ("" or []) during runtime.
            # Prefer falling back to prompts_json (cached/imported list) rather than crashing.
            if isinstance(prompts, str) and prompts.strip() == "":
                upstream_missing = True
                prompts = None
            elif isinstance(prompts, list) and len(prompts) == 0:
                upstream_missing = True
                prompts = None

        if prompts is not None:
            if isinstance(prompts, list):
                items = ["" if x is None else str(x) for x in prompts]
            else:
                items = [str(prompts)]
        else:
            try:
                items = json.loads(prompts_json or "[]")
            except json.JSONDecodeError as e:
                raise ValueError(f"prompts_json is not valid JSON: {e}")

            if not isinstance(items, list):
                raise ValueError("prompts_json must be a JSON array")

            if upstream_missing and len(items) == 0:
                raise ValueError("upstream prompts is empty")

        total = len(items)
        if total == 0:
            raise ValueError("prompt list is empty")

        if index < 0:
            index = 0
        if index >= total:
            index = total - 1

        prompt = items[index]
        if prompt is None:
            prompt = ""
        if not isinstance(prompt, str):
            prompt = str(prompt)

        return (prompt, int(index), int(total))

    @classmethod
    def IS_CHANGED(cls, prompts_json: str, index: int, prompts=None):
        m = hashlib.sha256()
        if prompts is not None:
            if isinstance(prompts, list):
                m.update(json.dumps(prompts, ensure_ascii=False).encode("utf-8"))
            else:
                m.update(str(prompts).encode("utf-8"))
        else:
            m.update((prompts_json or "").encode("utf-8"))
        m.update(str(index).encode("utf-8"))
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, prompts_json: str, index: int, prompts=None):
        if prompts is not None:
            # If upstream is dynamically connected (e.g. llama), ComfyUI may validate with an empty string
            # before the upstream node actually produces text. In that case, skip validation here.
            if prompts == "":
                return True

            # Some frontends may pass an empty list placeholder during validation.
            if isinstance(prompts, list) and len(prompts) == 0:
                return True

            # Dynamic upstream may pass a placeholder string that is only whitespace/newlines.
            if isinstance(prompts, str) and prompts.strip() == "":
                return True

            items = prompts if isinstance(prompts, list) else [prompts]
            if len(items) == 0:
                return "prompt list is empty"
        else:
            # Dynamic upstream may not be injected into prompt JSON during validation.
            # If prompts_json is default/empty, skip validation and defer to runtime.
            if (prompts_json is None) or (str(prompts_json).strip() in ("", "[]")):
                return True
            try:
                items = json.loads(prompts_json or "[]")
            except json.JSONDecodeError:
                return "prompts_json is not valid JSON"

            if not isinstance(items, list):
                return "prompts_json must be a JSON array"

            if len(items) == 0:
                return "prompt list is empty"

        if index < 0:
            return "index must be >= 0"

        return True


class AICoser_TextList:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text1": ("STRING", {"forceInput": True}),
                "text2": ("STRING", {"forceInput": True}),
                "text3": ("STRING", {"forceInput": True}),
                "text4": ("STRING", {"forceInput": True}),
            },
        }

    CATEGORY = "ComfyUI-AICoser-Tools"

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("texts",)
    FUNCTION = "build"

    def build(self, text1=None, text2=None, text3=None, text4=None):
        items = []
        for t in (text1, text2, text3, text4):
            if t is None:
                continue
            if isinstance(t, list):
                items.extend(["" if x is None else str(x) for x in t])
            else:
                items.append(str(t))

        items = [x for x in items if x is not None]
        return (items,)

    @classmethod
    def IS_CHANGED(cls, text1=None, text2=None, text3=None, text4=None):
        m = hashlib.sha256()
        for t in (text1, text2, text3, text4):
            if t is None:
                continue
            if isinstance(t, list):
                m.update(json.dumps(t, ensure_ascii=False).encode("utf-8"))
            else:
                m.update(str(t).encode("utf-8"))
        return m.digest().hex()


class AICoser_SplitLines:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text": ("STRING", {"forceInput": True}),
                "ignore_empty": ("BOOLEAN", {"default": True}),
                "trim": ("BOOLEAN", {"default": True}),
                "split_escaped_newline": ("BOOLEAN", {"default": True}),
                "split_html_br": ("BOOLEAN", {"default": True}),
            },
        }

    CATEGORY = "ComfyUI-AICoser-Tools"

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("texts",)
    FUNCTION = "split"

    def split(
        self,
        text=None,
        ignore_empty: bool = True,
        trim: bool = True,
        split_escaped_newline: bool = True,
        split_html_br: bool = True,
    ):
        if text is None:
            return ([],)

        if isinstance(text, list):
            parts = []
            for x in text:
                if x is None:
                    continue
                s = str(x)
                parts.append(s)
            return (parts,)

        s = str(text)

        if split_html_br:
            s = re.sub(r"<\s*br\s*/?\s*>", "\n", s, flags=re.IGNORECASE)

        has_real_newline = (
            "\n" in s
            or "\r" in s
            or "\u2028" in s
            or "\u2029" in s
            or "\u0085" in s
        )

        if split_escaped_newline and not has_real_newline:
            s = s.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n")

        s = (
            s.replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\u2028", "\n")
            .replace("\u2029", "\n")
            .replace("\u0085", "\n")
        )

        lines = s.split("\n")
        if trim:
            lines = [x.strip() for x in lines]
        if ignore_empty:
            lines = [x for x in lines if x != ""]

        return (lines,)

    @classmethod
    def IS_CHANGED(
        cls,
        text=None,
        ignore_empty: bool = True,
        trim: bool = True,
        split_escaped_newline: bool = True,
        split_html_br: bool = True,
    ):
        m = hashlib.sha256()
        if isinstance(text, list):
            m.update(json.dumps(text, ensure_ascii=False).encode("utf-8"))
        else:
            m.update(str(text).encode("utf-8"))
        m.update(str(int(bool(ignore_empty))).encode("utf-8"))
        m.update(str(int(bool(trim))).encode("utf-8"))
        m.update(str(int(bool(split_escaped_newline))).encode("utf-8"))
        m.update(str(split_html_br).encode("utf-8"))
        return m.digest().hex()


class AICoser_PromptTemplate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "template": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                    },
                ),
            },
            "optional": {
                "text1": ("STRING", {"forceInput": True}),
                "text2": ("STRING", {"forceInput": True}),
                "text3": ("STRING", {"forceInput": True}),
                "text4": ("STRING", {"forceInput": True}),
                "text5": ("STRING", {"forceInput": True}),
                "text6": ("STRING", {"forceInput": True}),
                "text7": ("STRING", {"forceInput": True}),
                "text8": ("STRING", {"forceInput": True}),
            },
        }

    CATEGORY = "ComfyUI-AICoser-Tools"

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "replace_text"

    def replace_text(self, template, text1="", text2="", text3="", text4="", text5="", text6="", text7="", text8=""):
        texts = [text1, text2, text3, text4, text5, text6, text7, text8]
        max_depth = 10

        def _resolve(s, depth):
            if depth >= max_depth:
                return s
            def _replacer(m):
                n = int(m.group(1))
                if 1 <= n <= len(texts):
                    val = texts[n - 1]
                    return _resolve(str(val) if val is not None else "", depth + 1)
                return m.group(0)
            return re.sub(r"@(\d+)", _replacer, s)

        result = _resolve(template or "", 0)
        return (result,)

    @classmethod
    def IS_CHANGED(cls, template, **kwargs):
        m = hashlib.sha256()
        m.update(str(template or "").encode("utf-8"))
        for i in range(1, 9):
            m.update(str(kwargs.get(f"text{i}", "")).encode("utf-8"))
        return m.digest().hex()


class AICoser_TextBox:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                    },
                ),
            }
        }

    CATEGORY = "ComfyUI-AICoser-Tools"

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "output_text"

    def output_text(self, text):
        return (text or "",)

    @classmethod
    def IS_CHANGED(cls, text):
        m = hashlib.sha256()
        m.update(str(text or "").encode("utf-8"))
        return m.digest().hex()


class AICoser_LoadVideoUpload:
    @classmethod
    def INPUT_TYPES(cls):
        files = _list_input_videos()
        if not files:
            files = [""]
        return {
            "required": {
                "video": (files,),
                "force_rate": ("FLOAT", {"default": 0, "min": 0, "max": 240, "step": 1}),
                "custom_width": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 8}),
                "custom_height": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 8}),
                "frame_load_cap": ("INT", {"default": 0, "min": 0, "max": BIGMAX, "step": 1}),
                "skip_first_frames": ("INT", {"default": 0, "min": 0, "max": BIGMAX, "step": 1}),
                "select_every_nth": ("INT", {"default": 1, "min": 1, "max": BIGMAX, "step": 1}),
                "preview_fps": ("FLOAT", {"default": 24, "min": 1, "max": 240, "step": 1}),
                "delete_after_load": ("BOOLEAN", {"default": False}),
            }
        }

    CATEGORY = "ComfyUI-AICoser-Tools"
    RETURN_TYPES = ("IMAGE", "INT", "AUDIO", "AICOSER_VIDEOINFO", "VHS_VIDEOINFO")
    RETURN_NAMES = ("images", "frame_count", "audio", "video_info", "vhs_video_info")
    FUNCTION = "load_video"

    def load_video(self, video, force_rate, custom_width, custom_height, frame_load_cap, skip_first_frames, select_every_nth, preview_fps, delete_after_load=False):
        if not video:
            raise ValueError("video is empty")
        if not folder_paths.exists_annotated_filepath(video):
            raise ValueError(f"Invalid video file: {video}")
        video_path = folder_paths.get_annotated_filepath(video)
        result = _read_video_frames(video_path, force_rate, custom_width, custom_height, frame_load_cap, skip_first_frames, select_every_nth)
        if delete_after_load:
            _delete_aicoser_uploaded_video(video, video_path)
        return result

    @classmethod
    def IS_CHANGED(cls, video, **kwargs):
        if not video or not folder_paths.exists_annotated_filepath(video):
            return ""
        video_path = folder_paths.get_annotated_filepath(video)
        m = hashlib.sha256()
        with open(video_path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                m.update(chunk)
        for key in ("force_rate", "custom_width", "custom_height", "frame_load_cap", "skip_first_frames", "select_every_nth", "delete_after_load"):
            m.update(str(kwargs.get(key, "")).encode("utf-8"))
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, video, **kwargs):
        if not video:
            return "video is empty"
        if not folder_paths.exists_annotated_filepath(video):
            return f"Invalid video file: {video}"
        return True


class AICoser_VideoInfo:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_info": ("AICOSER_VIDEOINFO",),
            }
        }

    CATEGORY = "ComfyUI-AICoser-Tools"
    RETURN_TYPES = ("FLOAT", "INT", "FLOAT", "INT", "INT", "FLOAT", "INT", "FLOAT", "INT", "INT")
    RETURN_NAMES = (
        "source_fps",
        "source_frame_count",
        "source_duration",
        "source_width",
        "source_height",
        "loaded_fps",
        "loaded_frame_count",
        "loaded_duration",
        "loaded_width",
        "loaded_height",
    )
    FUNCTION = "get_video_info"

    def get_video_info(self, video_info):
        keys = ["fps", "frame_count", "duration", "width", "height"]
        source_info = [video_info[f"source_{key}"] for key in keys]
        loaded_info = [video_info[f"loaded_{key}"] for key in keys]
        return (*source_info, *loaded_info)


class VNCCS_PositionControl:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "azimuth": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 360,
                        "step": 45,
                        "display": "slider",
                        "tooltip": "Angle of the camera around the subject (0=Front, 90=Right, 180=Back)",
                    },
                ),
                "elevation": (
                    "INT",
                    {
                        "default": 0,
                        "min": -30,
                        "max": 60,
                        "step": 30,
                        "display": "slider",
                        "tooltip": "Vertical angle of the camera (-30=Low, 0=Eye Level, 60=High)",
                    },
                ),
                "distance": (["close-up", "medium shot", "wide shot"], {"default": "medium shot"}),
                "include_trigger": ("BOOLEAN", {"default": True, "tooltip": "Include <sks> trigger word"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    CATEGORY = "VNCCS"
    FUNCTION = "generate_prompt"

    def generate_prompt(self, azimuth, elevation, distance, include_trigger):
        azimuth = int(azimuth) % 360

        azimuth_map = {
            0: "front view",
            45: "front-right quarter view",
            90: "right side view",
            135: "back-right quarter view",
            180: "back view",
            225: "back-left quarter view",
            270: "left side view",
            315: "front-left quarter view",
        }

        if azimuth > 337.5:
            closest_azimuth = 0
        else:
            closest_azimuth = min(azimuth_map.keys(), key=lambda x: abs(x - azimuth))
        az_str = azimuth_map[closest_azimuth]

        elevation_map = {
            -30: "low-angle shot",
            0: "eye-level shot",
            30: "elevated shot",
            60: "high-angle shot",
        }
        closest_elevation = min(elevation_map.keys(), key=lambda x: abs(x - elevation))
        el_str = elevation_map[closest_elevation]

        parts = []
        if include_trigger:
            parts.append("<sks>")
        parts.append(az_str)
        parts.append(el_str)
        parts.append(distance)

        return (" ".join(parts),)


class VNCCS_VisualPositionControl(VNCCS_PositionControl):
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "camera_data": ("STRING", {"default": "{}", "hidden": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    CATEGORY = "VNCCS"
    FUNCTION = "generate_prompt_from_json"

    def generate_prompt_from_json(self, camera_data):
        try:
            data = json.loads(camera_data)
        except json.JSONDecodeError:
            data = {"azimuth": 0, "elevation": 0, "distance": "medium shot", "include_trigger": True}

        return self.generate_prompt(
            data.get("azimuth", 0),
            data.get("elevation", 0),
            data.get("distance", "medium shot"),
            data.get("include_trigger", True),
        )
