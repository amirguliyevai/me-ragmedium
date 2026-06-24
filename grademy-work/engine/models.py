"""
Grademy Study Session Engine — Shared data models and enums.
These are the canonical definitions used across all engine modules.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from enum import Enum


# ── Enums ─────────────────────────────────────────────────────────────────────

class SessionMode(Enum):
    LESSON = "lesson"
    PRACTICE = "practice"
    REVIEW = "review"
    EXAM = "exam"
    CHAT = "chat"
    CANVAS = "canvas"


class ActivityType(Enum):
    MULTIPLE_CHOICE = "multiple_choice"
    FREE_RESPONSE = "free_response"
    FLASHCARD = "flashcard"
    FILL_BLANK = "fill_blank"
    MATCHING = "matching"
    EXPLANATION = "explanation"
    PROBLEM_SOLVING = "problem_solving"
    INTERACTIVE_CANVAS = "interactive_canvas"


# ── Data Classes ──────────────────────────────────────────────────────────────

@dataclass
class LearningProfile:
    """Individual student's learning preferences and capabilities."""
    preferred_modes: list[str] = field(default_factory=list)
    learning_speed: float = 0.5  # 0.0 (slow) - 1.0 (fast)
    preferred_activity_types: list[str] = field(default_factory=list)
    weak_topics: list[str] = field(default_factory=list)
    strong_topics: list[str] = field(default_factory=list)
    topic_scores: dict[str, float] = field(default_factory=dict)  # topic -> mastery score (0-1)
    avg_session_minutes: int = 25
    preferred_difficulty: float = 0.5
    streak_days: int = 0
    total_study_time_hours: float = 0.0
    last_session_at: Optional[str] = None


@dataclass
class Student:
    id: str
    name: str
    profile: LearningProfile = field(default_factory=LearningProfile)
    created_at: str = ""


@dataclass
class ActivityLoad:
    """Cognitive load estimate for a single activity."""
    base_load: float          # 0-1 inherent difficulty
    mode_multiplier: float    # context adjustment
    difficulty_factor: float  # 0-1 from activity difficulty
    total_load: float         # final computed load (0-1)
    estimated_minutes: float  # time estimate


@dataclass
class StudyActivity:
    id: str
    type: ActivityType
    topic: str
    difficulty: float  # 0.0 - 1.0
    cognitive_load: ActivityLoad
    content: dict[str, Any]
    created_at: str = ""


@dataclass
class SessionResponse:
    activity_id: str
    student_id: str
    is_correct: bool
    response_time_ms: int
    confidence: float  # 0.0 - 1.0 student self-reported
    timestamp: str = ""
    quality: Any = None  # ReviewQuality, computed from performance


@dataclass
class StudySession:
    id: str
    student_id: str
    mode: SessionMode
    started_at: str = ""
    ended_at: Optional[str] = None
    activities: list[StudyActivity] = field(default_factory=list)
    responses: list[SessionResponse] = field(default_factory=list)
    engagement_score: float = 0.5
    cognitive_load_avg: float = 0.0
    quality_score: float = 0.0

    def __post_init__(self):
        if not self.started_at:
            self.started_at = datetime.utcnow().isoformat()  # computed at session end
