#!/usr/bin/env python3
"""
Content Hub — FastAPI Backend Server
=====================================
Media upload & categorization, B-roll AI analysis scaffold,
FFmpeg-based video editing pipeline, content calendar CRUD,
and pipeline stats — all running on port 8110.

Architecture: file-based JSON persistence, subprocess FFmpeg,
             asynchronous job processing via threading.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------

BASE_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
MEDIA_DIR = BASE_DIR / "media"
IMAGES_DIR = MEDIA_DIR / "images"
BROLL_DIR = MEDIA_DIR / "broll"
VIDEOS_DIR = MEDIA_DIR / "videos"
EXPORTS_DIR = MEDIA_DIR / "exports"
STATIC_DIR = BASE_DIR / "static"
MEDIA_LIBRARY_FILE = BASE_DIR / "media_library.json"
CALENDAR_FILE = BASE_DIR / "content_calendar.json"
EDIT_JOBS_FILE = BASE_DIR / "edit_jobs.json"
FFMPEG_BIN = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
FFPROBE_BIN = shutil.which("ffprobe") or "/usr/bin/ffprobe"

# Ensure the chosen ffmpeg has subtitle-filter support (libass).
# The linuxbrew ffmpeg 8.0.1+ omits it; fall back to the system one.
def _check_ffmpeg_capabilities(path: str) -> str:
    """Return the ffmpeg binary path if usable, or fall back to a known-good one."""
    try:
        r = subprocess.run(
            [path, "-filters"], capture_output=True, text=True, timeout=10
        )
        if "subtitles" not in r.stdout and "subtitles" not in r.stderr:
            # Try the system ffmpeg instead
            for candidate in ("/usr/bin/ffmpeg", "/bin/ffmpeg"):
                if candidate != path and os.path.exists(candidate):
                    r2 = subprocess.run(
                        [candidate, "-filters"], capture_output=True, text=True, timeout=10
                    )
                    if "subtitles" in r2.stdout or "subtitles" in r2.stderr:
                        return candidate
    except (subprocess.SubprocessError, OSError):
        pass
    return path


FFMPEG_BIN = _check_ffmpeg_capabilities(FFMPEG_BIN)

# Allowed extensions per media type
ALLOWED_EXTENSIONS: Dict[str, set[str]] = {
    "image": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"},
    "broll": {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"},
    "video": {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"},
}

MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024  # 2 GB

# ---------------------------------------------------------------------------
# JSON helpers (atomic writes)
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> list | dict:
    if not path.exists():
        return [] if path.suffix == "json" else {}
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return [] if path.suffix == "json" else {}
    return data


def _write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(".tmp." + path.name)
    try:
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2, default=str)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def _ensure_dirs() -> None:
    for d in (IMAGES_DIR, BROLL_DIR, VIDEOS_DIR, EXPORTS_DIR, STATIC_DIR):
        d.mkdir(parents=True, exist_ok=True)


_ensure_dirs()

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class MediaType(str, Enum):
    image = "image"
    broll = "broll"
    video = "video"


class MediaItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: MediaType
    filename: str
    original_filename: str
    filepath: str  # relative to BASE_DIR
    size_bytes: int
    mime_type: str
    tags: list[str] = Field(default_factory=list)
    broll_analysis: Optional[dict] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


class CalendarStatus(str, Enum):
    draft = "draft"
    planned = "planned"
    recorded = "recorded"
    editing = "editing"
    review = "review"
    published = "published"
    archived = "archived"


class CalendarItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str = ""
    scheduled_date: str  # ISO date YYYY-MM-DD
    platform: str = "unknown"
    status: CalendarStatus = CalendarStatus.draft
    post_type: str = "text"  # text, video, carousel
    hook: str = ""  # The hook/title line
    body: str = ""  # Main body for text posts
    script: str = ""  # Script for video posts
    visual_cues: str = ""  # Visual notes/direction for video posts
    draft_url: str = ""
    tags: list[str] = Field(default_factory=list)
    media_ids: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

    @field_validator("scheduled_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("scheduled_date must be in YYYY-MM-DD format")
        return v


class EditJobStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class EditJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_media_id: str
    broll_ids: list[str] = Field(default_factory=list)
    instructions: str = ""
    status: EditJobStatus = EditJobStatus.pending
    progress: float = 0.0  # 0-100
    output_filename: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Content Hub API",
    version="1.0.0",
    description="Backend for the Content Hub — media management, editing pipeline, and content calendar.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def _get_media_library() -> list[dict]:
    data = _read_json(MEDIA_LIBRARY_FILE)
    return data if isinstance(data, list) else []


def _save_media_library(lib: list[dict]) -> None:
    _write_json(MEDIA_LIBRARY_FILE, lib)


def _get_calendar() -> list[dict]:
    data = _read_json(CALENDAR_FILE)
    return data if isinstance(data, list) else []


def _save_calendar(cal: list[dict]) -> None:
    _write_json(CALENDAR_FILE, cal)


def _get_edit_jobs() -> list[dict]:
    data = _read_json(EDIT_JOBS_FILE)
    return data if isinstance(data, list) else []


def _save_edit_jobs(jobs: list[dict]) -> None:
    _write_json(EDIT_JOBS_FILE, jobs)


def _find_media_by_id(media_id: str) -> Optional[dict]:
    lib = _get_media_library()
    for item in lib:
        if item["id"] == media_id:
            return item
    return None


def _find_calendar_by_id(item_id: str) -> Optional[dict]:
    cal = _get_calendar()
    for item in cal:
        if item["id"] == item_id:
            return item
    return None


def _find_edit_job_by_id(job_id: str) -> Optional[dict]:
    jobs = _get_edit_jobs()
    for j in jobs:
        if j["id"] == job_id:
            return j
    return None


def _update_media_in_library(media_id: str, updates: dict) -> Optional[dict]:
    lib = _get_media_library()
    for i, item in enumerate(lib):
        if item["id"] == media_id:
            item.update(updates)
            item["updated_at"] = datetime.utcnow().isoformat() + "Z"
            lib[i] = item
            _save_media_library(lib)
            return item
    return None


def _get_mime_type(filename: str) -> str:
    mime, _ = mimetypes.guess_type(filename)
    return mime or "application/octet-stream"


def _get_extension(filename: str) -> str:
    _, ext = os.path.splitext(filename.lower())
    return ext


def _validate_media_type(file_type: str, filename: str) -> tuple[bool, str]:
    ext = _get_extension(filename)
    allowed = ALLOWED_EXTENSIONS.get(file_type, set())
    if ext not in allowed:
        return False, f"Extension '{ext}' not allowed for type '{file_type}'. Allowed: {', '.join(sorted(allowed))}"
    return True, ""


def _get_target_dir(file_type: str) -> Path:
    return {
        "image": IMAGES_DIR,
        "broll": BROLL_DIR,
        "video": VIDEOS_DIR,
    }.get(file_type, IMAGES_DIR)


def _get_dir_name(file_type: str) -> str:
    """Return the directory name for a given media type."""
    mapping = {"image": "images", "broll": "broll", "video": "videos"}
    return mapping.get(file_type, file_type)


def _build_media_item(
    file_type: str,
    original_filename: str,
    stored_filename: str,
    size_bytes: int,
    tags: list[str],
) -> MediaItem:
    dir_name = _get_dir_name(file_type)
    return MediaItem(
        type=MediaType(file_type),
        filename=stored_filename,
        original_filename=original_filename,
        filepath=str(MEDIA_DIR.relative_to(BASE_DIR) / dir_name / stored_filename),
        size_bytes=size_bytes,
        mime_type=_get_mime_type(original_filename),
        tags=tags,
    )


# ---------------------------------------------------------------------------
# Background FFmpeg job runner
# ---------------------------------------------------------------------------

def _run_ffmpeg_job(job_id: str) -> None:
    """Execute the editing pipeline for a given job in a background thread."""
    job = _find_edit_job_by_id(job_id)
    if not job:
        return

    try:
        # Mark as running
        _update_edit_job(job_id, {"status": EditJobStatus.running.value, "progress": 0.0, "started_at": datetime.utcnow().isoformat() + "Z"})

        source = _find_media_by_id(job["source_media_id"])
        if not source:
            raise RuntimeError(f"Source media {job['source_media_id']} not found.")

        source_path = BASE_DIR / source["filepath"]
        if not source_path.exists():
            raise RuntimeError(f"Source file not found at {source_path}")

        # --- Stage 1: Silence removal (only if video has audio) ---
        job_id_short = job["id"][:8]
        stage1_output = EXPORTS_DIR / f"{job_id_short}_silence_removed.mp4"
        _update_edit_job(job_id, {"progress": 5.0})

        has_audio = _probe_has_audio(source_path)
        if has_audio:
            # Remove silence using FFmpeg's silenceremove filter.
            # Parameters: start_periods=1, start_duration=0.05, start_threshold=-50dB,
            # stop_periods=-1 (same as start), stop_duration=0.05, stop_threshold=-50dB
            silence_cmd = [
                FFMPEG_BIN, "-y", "-i", str(source_path),
                "-af", "silenceremove=1:0.05:-50dB:1:0.05:-50dB",
                "-c:v", "libx264", "-preset", "fast", "-crf", "22",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                str(stage1_output),
            ]
            _run_subprocess(silence_cmd, "Silence removal")
            stage1_success = stage1_output.exists()
        else:
            # No audio stream — copy source directly as stage1 output
            shutil.copy2(str(source_path), str(stage1_output))
            stage1_success = True
        _update_edit_job(job_id, {"progress": 30.0})

        # --- Stage 2: Caption generation (SRT + burn-in) ---
        stage2_input = stage1_output if stage1_output.exists() else source_path
        stage2_srt = EXPORTS_DIR / f"{job_id_short}_captions.srt"
        stage2_with_captions = EXPORTS_DIR / f"{job_id_short}_with_captions.mp4"

        # Generate a simple SRT placeholder (we'll wire AI ASR later)
        _generate_placeholder_srt(stage2_srt, source_path)
        _update_edit_job(job_id, {"progress": 50.0})

        # Burn subtitles into video using SRT embedded as subtitles filter.
        # We keep it simple: default subtitle styling, no force_style to avoid
        # complex filter-graph escaping issues with newer FFmpeg versions.
        # Future enhancement: use an ASS style file for custom formatting.
        subtitle_filter = f"subtitles={stage2_srt}"
        caption_cmd = [
            FFMPEG_BIN, "-y", "-i", str(stage2_input),
            "-vf", subtitle_filter,
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(stage2_with_captions),
        ]
        _run_subprocess(caption_cmd, "Caption burn-in")
        _update_edit_job(job_id, {"progress": 70.0})

        # --- Stage 3: B-roll embedding ---
        broll_ids = job.get("broll_ids", [])
        if broll_ids:
            broll_dir = BROLL_DIR
            # Build overlay filter for b-roll clips (PIP style, bottom-right)
            filter_chains = []
            input_idx = 1  # 0 is main video
            overlay_labels = []
            broll_inputs = [str(stage2_with_captions)]

            for idx, broll_id in enumerate(broll_ids):
                broll_meta = _find_media_by_id(broll_id)
                if not broll_meta:
                    continue
                broll_path = BASE_DIR / broll_meta["filepath"]
                if not broll_path.exists():
                    continue
                broll_inputs.append(str(broll_path))

                # Scale to 25% width, overlay bottom-right with padding
                scale_w = f"iw*0.25"
                overlay_x = f"W-overlay_w-20"
                overlay_y = f"H-overlay_h-20"
                label_bare = f"broll{idx}"
                label = f"[{label_bare}]"
                filter_chains.append(
                    f"[{idx}:v]scale={scale_w}:-1{label}"
                )
                overlay_labels.append(label_bare)

            if overlay_labels:
                # Build the overlay filter chain.
                # FFmpeg syntax: [main][overlay]overlay=x:y[output]
                link_parts = []
                for i, label in enumerate(overlay_labels):
                    overlay_x = "W-overlay_w-20"
                    overlay_y = "H-overlay_h-20"
                    out_label = f"[vout{i}]" if i < len(overlay_labels) - 1 else "[vout]"
                    link_parts.append(
                        f"[0:v][{label}]overlay={overlay_x}:{overlay_y}{out_label}"
                    )
                filter_complex = "; ".join(filter_chains)
                filter_complex += ";" + "; ".join(link_parts)

                broll_output = EXPORTS_DIR / f"{job_id_short}_broll_embedded.mp4"
                broll_cmd = [
                    FFMPEG_BIN, "-y",
                ]
                for inp in broll_inputs:
                    broll_cmd.extend(["-i", inp])
                broll_cmd.extend([
                    "-filter_complex", filter_complex,
                    "-map", "[vout]",
                ])
                # Only map audio if the source has an audio stream
                broll_cmd.extend(["-map", "0:a?"])
                broll_cmd.extend([
                    "-c:v", "libx264", "-preset", "fast", "-crf", "22",
                    "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart",
                    str(broll_output),
                ])
                _run_subprocess(broll_cmd, "B-roll embedding")
                final_output = broll_output
            else:
                final_output = stage2_with_captions
        else:
            final_output = stage2_with_captions

        # --- Final: rename to job-based output ---
        final_name = f"{job_id_short}_rendered.mp4"
        final_path = EXPORTS_DIR / final_name
        if final_output != final_path:
            if final_path.exists():
                final_path.unlink()
            shutil.move(str(final_output), str(final_path))

        # Clean up intermediate files
        for f in [stage1_output, stage2_srt, stage2_with_captions]:
            if f.exists() and f != final_path:
                f.unlink(missing_ok=True)

        _update_edit_job(job_id, {
            "status": EditJobStatus.completed.value,
            "progress": 100.0,
            "output_filename": final_name,
            "completed_at": datetime.utcnow().isoformat() + "Z",
        })

    except Exception as exc:
        _update_edit_job(job_id, {
            "status": EditJobStatus.failed.value,
            "error_message": str(exc),
            "completed_at": datetime.utcnow().isoformat() + "Z",
        })


def _update_edit_job(job_id: str, updates: dict) -> None:
    jobs = _get_edit_jobs()
    for i, j in enumerate(jobs):
        if j["id"] == job_id:
            j.update(updates)
            j["updated_at"] = datetime.utcnow().isoformat() + "Z"
            jobs[i] = j
            _save_edit_jobs(jobs)
            return


def _run_subprocess(cmd: list[str], stage_name: str) -> None:
    """Run an FFmpeg subprocess and raise on failure."""
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=3600,  # 1 hour max per stage
    )
    if proc.returncode != 0:
        stderr_tail = proc.stderr[-2000:] if proc.stderr else "(no stderr)"
        raise RuntimeError(
            f"{stage_name} failed (code {proc.returncode}): {stderr_tail}"
        )


def _generate_placeholder_srt(srt_path: Path, video_path: Path) -> None:
    """Generate a placeholder SRT file until AI ASR is wired in."""
    # Probe video duration
    duration_secs = _probe_duration(video_path)
    if duration_secs is None:
        duration_secs = 60  # fallback

    # Generate a single placeholder caption for the whole video
    lines = []
    start = 0
    chunk = min(duration_secs, 30)
    idx = 1
    while start < duration_secs:
        end = min(start + chunk, duration_secs)
        lines.append(str(idx))
        lines.append(f"{_secs_to_srt(start)} --> {_secs_to_srt(end)}")
        lines.append("[Caption pending — AI ASR not yet wired]")
        lines.append("")
        start = end
        idx += 1

    srt_path.parent.mkdir(parents=True, exist_ok=True)
    with open(srt_path, "w") as f:
        f.write("\n".join(lines))


def _secs_to_srt(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _probe_duration(path: Path) -> Optional[float]:
    try:
        cmd = [
            FFPROBE_BIN, "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            str(path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except (ValueError, subprocess.TimeoutExpired, OSError):
        pass
    return None


def _probe_has_audio(path: Path) -> bool:
    """Check if a media file has at least one audio stream."""
    try:
        cmd = [
            FFPROBE_BIN, "-v", "error",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            str(path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return any(line.strip() == "audio" for line in result.stdout.splitlines())
    except (subprocess.TimeoutExpired, OSError):
        pass
    return False


def _take_screenshot(video_path: Path, output_dir: Path, timestamp: float = 1.0) -> Optional[Path]:
    """Extract a single frame from a video at the given timestamp."""
    output_path = output_dir / f"screenshot_{uuid.uuid4().hex[:8]}.jpg"
    cmd = [
        FFMPEG_BIN, "-y",
        "-ss", str(timestamp),
        "-i", str(video_path),
        "-vframes", "1",
        "-q:v", "2",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode == 0 and output_path.exists():
        return output_path
    return None


# ---------------------------------------------------------------------------
# API Routes — Media
# ---------------------------------------------------------------------------

@app.post("/api/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    type: str = Form(...),
    tags: str = Form(""),
):
    """Upload a media file. Type must be 'image', 'broll', or 'video'."""
    if type not in ("image", "broll", "video"):
        raise HTTPException(status_code=400, detail=f"Invalid type '{type}'. Must be 'image', 'broll', or 'video'.")

    original_filename = file.filename or "unknown"
    valid, err_msg = _validate_media_type(type, original_filename)
    if not valid:
        raise HTTPException(status_code=400, detail=err_msg)

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds maximum upload size (2GB).")

    # Generate unique filename
    ext = _get_extension(original_filename)
    unique_name = f"{uuid.uuid4().hex}{ext}"
    target_dir = _get_target_dir(type)
    target_path = target_dir / unique_name

    # Write file
    try:
        with open(target_path, "wb") as f:
            f.write(content)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {e}")

    # Parse tags
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    # Build metadata
    item = _build_media_item(type, original_filename, unique_name, len(content), tag_list)
    item_dict = item.model_dump()

    # Persist
    lib = _get_media_library()
    lib.append(item_dict)
    _save_media_library(lib)

    return {"status": "ok", "media": item_dict}


@app.get("/api/media/list")
async def list_media(type: Optional[str] = Query(None)):
    """List media items, optionally filtered by type."""
    lib = _get_media_library()
    if type:
        if type not in ("image", "broll", "video"):
            raise HTTPException(status_code=400, detail=f"Invalid type '{type}'.")
        lib = [item for item in lib if item.get("type") == type]
    # Sort newest first
    lib.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"status": "ok", "media": lib, "count": len(lib)}


@app.get("/api/media/{media_id}/file")
async def serve_media_file(media_id: str):
    """Serve the raw media file for download/playback."""
    item = _find_media_by_id(media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found.")

    file_path = BASE_DIR / item["filepath"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Media file not found on disk.")

    return FileResponse(
        path=str(file_path),
        media_type=item.get("mime_type", "application/octet-stream"),
        filename=item.get("original_filename", file_path.name),
    )


@app.delete("/api/media/{media_id}")
async def delete_media(media_id: str):
    """Delete a media item and its file."""
    item = _find_media_by_id(media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found.")

    file_path = BASE_DIR / item["filepath"]
    if file_path.exists():
        file_path.unlink()

    # Remove analysis screenshots if present
    analysis = item.get("broll_analysis", {})
    if analysis:
        screenshot_path = analysis.get("screenshot_path")
        if screenshot_path:
            sp = BASE_DIR / screenshot_path
            if sp.exists():
                sp.unlink(missing_ok=True)

    lib = _get_media_library()
    lib = [m for m in lib if m["id"] != media_id]
    _save_media_library(lib)

    return {"status": "ok", "message": f"Media {media_id} deleted."}


# ---------------------------------------------------------------------------
# API Routes — B-roll Analysis
# ---------------------------------------------------------------------------

@app.post("/api/media/broll/analyze/{media_id}")
async def analyze_broll(media_id: str):
    """Take a screenshot of a b-roll video and store analysis metadata.
    AI categorization will be wired in a future iteration."""
    item = _find_media_by_id(media_id)
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found.")
    if item.get("type") != "broll":
        raise HTTPException(status_code=400, detail="Item is not a b-roll video.")

    video_path = BASE_DIR / item["filepath"]
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found on disk.")

    # Take screenshot at 1 second mark
    screenshots_dir = MEDIA_DIR / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = _take_screenshot(video_path, screenshots_dir)

    analysis: dict[str, Any] = {
        "analyzed_at": datetime.utcnow().isoformat() + "Z",
        "screenshot_path": str(screenshot_path.relative_to(BASE_DIR)) if screenshot_path else None,
        "duration_secs": _probe_duration(video_path),
        "ai_categorization": None,  # Reserved for AI wiring
        "ai_labels": [],             # Reserved for AI wiring
        "notes": "AI analysis not yet wired — placeholder metadata only.",
    }

    updated = _update_media_in_library(media_id, {"broll_analysis": analysis})
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update media metadata.")

    return {"status": "ok", "media_id": media_id, "analysis": analysis}


# ---------------------------------------------------------------------------
# API Routes — Content Calendar
# ---------------------------------------------------------------------------

@app.post("/api/calendar/items")
async def create_calendar_item(item: CalendarItem):
    """Create a new content calendar entry."""
    cal = _get_calendar()
    # Ensure unique ID
    item_dict = item.model_dump()
    cal.append(item_dict)
    _save_calendar(cal)
    return {"status": "ok", "item": item_dict}


@app.get("/api/calendar/items")
async def list_calendar_items(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    """List calendar entries, optionally filtered by date range and/or status."""
    cal = _get_calendar()

    # Validate date params if provided
    if start_date:
        try:
            datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date must be YYYY-MM-DD")
    if end_date:
        try:
            datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="end_date must be YYYY-MM-DD")

    if start_date:
        cal = [c for c in cal if c.get("scheduled_date", "") >= start_date]
    if end_date:
        cal = [c for c in cal if c.get("scheduled_date", "") <= end_date]
    if status:
        cal = [c for c in cal if c.get("status") == status]

    cal.sort(key=lambda x: x.get("scheduled_date", ""))
    return {"status": "ok", "items": cal, "count": len(cal)}


@app.put("/api/calendar/items/{item_id}")
async def update_calendar_item(item_id: str, updates: dict):
    """Update a calendar entry (status, draft, etc.)."""
    cal = _get_calendar()
    found = False
    for i, c in enumerate(cal):
        if c["id"] == item_id:
            # Only allow updating specific fields
            allowed_fields = {"title", "description", "scheduled_date", "platform", "status", "draft_url", "tags", "media_ids", "post_type", "hook", "body", "script", "visual_cues", "draft_content"}
            for key, value in updates.items():
                if key in allowed_fields:
                    cal[i][key] = value
            cal[i]["updated_at"] = datetime.utcnow().isoformat() + "Z"
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail="Calendar item not found.")

    _save_calendar(cal)
    return {"status": "ok", "item": cal[i]}


@app.delete("/api/calendar/items/{item_id}")
async def delete_calendar_item(item_id: str):
    """Delete a calendar entry."""
    cal = _get_calendar()
    cal = [c for c in cal if c["id"] != item_id]
    _save_calendar(cal)
    return {"status": "ok", "message": f"Calendar item {item_id} deleted."}


# ---------------------------------------------------------------------------
# API Routes — Edit Pipeline
# ---------------------------------------------------------------------------

@app.post("/api/edit/create")
async def create_edit_job(job: EditJob):
    """Create a new video editing job. The pipeline runs asynchronously."""
    # Validate source media exists
    source = _find_media_by_id(job.source_media_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source media {job.source_media_id} not found.")
    if source.get("type") not in ("video", "broll"):
        raise HTTPException(status_code=400, detail="Source must be a video or b-roll file.")

    # Validate b-roll IDs if provided
    for bid in job.broll_ids:
        broll = _find_media_by_id(bid)
        if not broll:
            raise HTTPException(status_code=404, detail=f"B-roll media {bid} not found.")
        if broll.get("type") != "broll":
            raise HTTPException(status_code=400, detail=f"Media {bid} is not b-roll type.")

    job_dict = job.model_dump()
    jobs = _get_edit_jobs()
    jobs.append(job_dict)
    _save_edit_jobs(jobs)

    # Launch background processing
    thread = threading.Thread(target=_run_ffmpeg_job, args=(job.id,), daemon=True)
    thread.start()

    return {"status": "ok", "job": job_dict, "message": "Edit job created and processing started."}


@app.delete("/api/edit/{job_id}")
async def delete_edit_job(job_id: str):
    """Delete an edit job and its output file."""
    jobs = _get_edit_jobs()
    job = _find_edit_job_by_id(job_id)
    if not job:
        raise HTTPException(404, "Edit job not found")
    # Remove output file if exists
    if job.get("output_filename"):
        out_path = EXPORTS_DIR / job["output_filename"]
        if out_path.exists():
            out_path.unlink(missing_ok=True)
    jobs[:] = [j for j in jobs if j.get("id") != job_id]
    _save_edit_jobs(jobs)
    return {"success": True, "message": "Edit job deleted"}


@app.get("/api/edit/list")
async def list_edit_jobs(status: Optional[str] = Query(None)):
    """List all edit jobs, optionally filtered by status."""
    jobs = _get_edit_jobs()
    if status:
        jobs = [j for j in jobs if j.get("status") == status]
    jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"status": "ok", "jobs": jobs, "count": len(jobs)}


@app.get("/api/edit/{job_id}/status")
async def get_edit_job_status(job_id: str):
    """Check the status and progress of an edit job."""
    job = _find_edit_job_by_id(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Edit job not found.")
    return {"status": "ok", "job": job}


@app.get("/api/edit/{job_id}/download")
async def download_rendered_video(job_id: str):
    """Download the rendered output of a completed edit job."""
    job = _find_edit_job_by_id(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Edit job not found.")
    if job.get("status") != "completed":
        raise HTTPException(status_code=400, detail=f"Job status is '{job.get('status')}', not 'completed'.")
    if not job.get("output_filename"):
        raise HTTPException(status_code=404, detail="No output filename recorded for this job.")

    output_path = EXPORTS_DIR / job["output_filename"]
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Rendered output file not found on disk.")

    return FileResponse(
        path=str(output_path),
        media_type="video/mp4",
        filename=f"rendered_{job_id[:8]}.mp4",
    )


# ---------------------------------------------------------------------------
# API Routes — Stats
# ---------------------------------------------------------------------------

@app.get("/api/platforms")
async def list_platforms():
    """List all configured publishing platforms (X, LinkedIn, IG, Pinterest, Bluesky, etc)."""
    pf = Path(__file__).parent / "platforms.json"
    if not pf.exists():
        return {"status": "ok", "platforms": []}
    with open(pf) as f:
        return {"status": "ok", "platforms": json.load(f)}

@app.get("/api/stats")
async def get_pipeline_stats():
    """Return an overview of the entire pipeline's state."""
    lib = _get_media_library()
    cal = _get_calendar()
    jobs = _get_edit_jobs()

    # Media counts
    images = [m for m in lib if m.get("type") == "image"]
    brolls = [m for m in lib if m.get("type") == "broll"]
    videos = [m for m in lib if m.get("type") == "video"]

    # B-roll analyzed count
    broll_analyzed = [m for m in brolls if m.get("broll_analysis") is not None]

    # Calendar stats
    now = date.today().isoformat()
    upcoming = [c for c in cal if c.get("scheduled_date", "") >= now]
    past = [c for c in cal if c.get("scheduled_date", "") < now]
    status_counts: dict[str, int] = {}
    for c in cal:
        s = c.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1

    # Edit job stats
    job_status_counts: dict[str, int] = {}
    for j in jobs:
        s = j.get("status", "unknown")
        job_status_counts[s] = job_status_counts.get(s, 0) + 1

    # Disk usage
    total_media_size = sum(m.get("size_bytes", 0) for m in lib)

    return {
        "status": "ok",
        "media": {
            "total": len(lib),
            "images": len(images),
            "broll": len(brolls),
            "videos": len(videos),
            "broll_analyzed": len(broll_analyzed),
            "total_size_bytes": total_media_size,
            "total_size_mb": round(total_media_size / (1024 * 1024), 2),
        },
        "calendar": {
            "total": len(cal),
            "upcoming": len(upcoming),
            "past": len(past),
            "by_status": status_counts,
        },
        "edit_jobs": {
            "total": len(jobs),
            "by_status": job_status_counts,
        },
        "system": {
            "ffmpeg": shutil.which("ffmpeg") is not None,
            "media_dirs_exist": all(
                d.exists() for d in (IMAGES_DIR, BROLL_DIR, VIDEOS_DIR, EXPORTS_DIR)
            ),
        },
    }


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    print(f"📦 Content Hub API starting on http://0.0.0.0:8110")
    uvicorn.run(
        "content_hub_api:app",
        host="0.0.0.0",
        port=8110,
        reload=False,
        log_level="info",
    )
