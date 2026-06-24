"""
Personalization Engine — Learning profiles, engagement tracking, and AI tutor context.
Adapts the study experience to each individual student.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Any, Optional
from enum import Enum


class LearningMode(Enum):
    VISUAL = "visual"
    AUDITORY = "auditory"
    READING = "reading"
    KINESTHETIC = "kinesthetic"


@dataclass
class LearningProfile:
    """Individual student's learning preferences and capabilities."""
    preferred_modes: list[str] = field(default_factory=list)
    learning_speed: float = 0.5  # 0.0 (slow) - 1.0 (fast)
    preferred_activity_types: list[str] = field(default_factory=list)
    weak_topics: list[str] = field(default_factory=list)
    strong_topics: list[str] = field(default_factory=list)
    avg_session_minutes: int = 25
    preferred_difficulty: float = 0.5
    streak_days: int = 0
    total_study_time_hours: float = 0.0
    last_session_at: Optional[str] = None


@dataclass
class EngagementState:
    """Real-time engagement tracking."""
    current_score: float = 0.5
    trend: float = 0.0  # positive = improving, negative = declining
    consecutive_correct: int = 0
    consecutive_wrong: int = 0
    time_since_last_interaction: float = 0.0  # seconds
    session_duration_seconds: float = 0.0
    response_times_ms: list[float] = field(default_factory=list)
    confidence_history: list[float] = field(default_factory=list)


class PersonalizationEngine:
    """
    Manages student personalization:
    - Learning profile initialization and updates
    - Engagement state tracking and prediction
    - Topic strength/weakness detection
    - AI tutor context building
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.engagement_window = config.get("engagement_window", 10)
        self.momentum_decay_days = config.get("momentum_decay_days", 7)
        self.learning_speed_default = config.get("learning_speed_default", 0.5)
        self._profiles: dict[str, LearningProfile] = {}
        self._engagement: dict[str, EngagementState] = {}
        self._history: dict[str, list[dict[str, Any]]] = {}  # student_id -> responses

    def init_profile(self, student: Any) -> LearningProfile:
        """Initialize a new student's profile with defaults."""
        profile = LearningProfile(
            learning_speed=self.learning_speed_default,
            preferred_activity_types=["multiple_choice", "flashcard"],
        )
        self._profiles[student.id] = profile
        self._engagement[student.id] = EngagementState()
        self._history[student.id] = []
        return profile

    def record_response(
        self,
        student: Any,
        response: Any,
        activity: Any,
    ) -> None:
        """Record a student response and update personalization."""
        sid = student.id
        if sid not in self._history:
            self._history[sid] = []

        self._history[sid].append({
            "activity_id": response.activity_id,
            "topic": activity.topic if activity else "unknown",
            "is_correct": response.is_correct,
            "response_time_ms": response.response_time_ms,
            "confidence": response.confidence,
            "timestamp": response.timestamp,
        })

        # Update engagement state
        eng = self._engagement.get(sid)
        if eng:
            if response.is_correct:
                eng.consecutive_correct += 1
                eng.consecutive_wrong = 0
            else:
                eng.consecutive_wrong += 1
                eng.consecutive_correct = 0
            eng.response_times_ms.append(response.response_time_ms)
            eng.confidence_history.append(response.confidence)

        # Update profile
        profile = self._profiles.get(sid)
        if profile and activity:
            self._update_topic_strength(profile, activity.topic, response.is_correct)

    def compute_engagement(self, session: Any) -> float:
        """
        Compute real-time engagement score (0-1) based on:
        - Response time trends
        - Correctness patterns
        - Confidence levels
        - Session duration (fatigue detection)
        - Streak patterns
        """
        sid = session.student_id
        eng = self._engagement.get(sid)
        if not eng:
            return 0.5

        responses = session.responses
        if not responses:
            return eng.current_score

        # Recent window
        recent = responses[-self.engagement_window:]

        # Accuracy component (35%)
        accuracy = sum(1 for r in recent if r.is_correct) / len(recent)

        # Response time component (25%) — faster = more engaged
        avg_time = sum(r.response_time_ms for r in recent) / len(recent)
        # Normalize: 5s = 1.0, 30s+ = 0.0
        time_score = max(0.0, min(1.0, 1.0 - (avg_time - 5000) / 25000))

        # Confidence component (25%)
        avg_confidence = sum(r.confidence for r in recent) / len(recent)

        # Response time acceleration (15%) — is the student speeding up or slowing down?
        time_trend_bonus = 0.0
        if len(recent) >= 4:
            first_half_time = sum(r.response_time_ms for r in recent[:len(recent)//2]) / (len(recent)//2)
            second_half_time = sum(r.response_time_ms for r in recent[len(recent)//2:]) / (len(recent) - len(recent)//2)
            if second_half_time < first_half_time:
                time_trend_bonus = 0.05  # speeding up = engaged
            else:
                time_trend_bonus = -0.05  # slowing down = losing focus

        # Streak bonus
        streak_bonus = 0.0
        if eng.consecutive_correct >= 5:
            streak_bonus = 0.1
        elif eng.consecutive_correct >= 3:
            streak_bonus = 0.05
        elif eng.consecutive_wrong >= 3:
            streak_bonus = -0.15

        # Fatigue penalty: long sessions lose engagement
        fatigue_penalty = 0.0
        if eng.session_duration_seconds > 0:
            # After 20 minutes, start penalizing
            minutes = eng.session_duration_seconds / 60
            if minutes > 20:
                fatigue_penalty = min(0.2, (minutes - 20) / 60 * 0.2)

        raw = (
            0.35 * accuracy
            + 0.25 * time_score
            + 0.25 * avg_confidence
            + 0.15 * (0.5 + time_trend_bonus)  # base 0.5 for neutral trend
            + streak_bonus
            - fatigue_penalty
        )
        score = max(0.0, min(1.0, raw))

        # Smooth with previous score (avoid jarring jumps)
        eng.current_score = 0.7 * score + 0.3 * eng.current_score
        eng.trend = eng.current_score - score

        return round(eng.current_score, 4)

    def recent_performance(self, student_id: str, window: int = 20) -> Optional[float]:
        """Get recent accuracy rate (0-1)."""
        history = self._history.get(student_id, [])
        if not history:
            return None
        recent = history[-window:]
        if not recent:
            return None
        return sum(1 for r in recent if r["is_correct"]) / len(recent)

    def suggest_topic(self, student_id: str) -> str:
        """Suggest the next topic to study based on weaknesses and due reviews."""
        profile = self._profiles.get(student_id)
        if not profile:
            return "general"

        # Prioritize weak topics
        if profile.weak_topics:
            return profile.weak_topics[0]

        # Otherwise cycle through strong topics or use a default
        if profile.strong_topics:
            return profile.strong_topics[0]

        return "general"

    def build_tutor_context(self, student: Any) -> dict[str, Any]:
        """Build context dict for the AI tutor (Gemini)."""
        sid = student.id
        profile = self._profiles.get(sid, LearningProfile())
        eng = self._engagement.get(sid, EngagementState())
        perf = self.recent_performance(sid)

        return {
            "student_name": student.name,
            "learning_speed": profile.learning_speed,
            "preferred_modes": profile.preferred_modes,
            "weak_topics": profile.weak_topics,
            "strong_topics": profile.strong_topics,
            "current_engagement": eng.current_score,
            "recent_accuracy": perf,
            "streak_days": profile.streak_days,
            "total_study_hours": profile.total_study_time_hours,
            "avg_response_time_ms": (
                sum(eng.response_times_ms[-10:]) / max(len(eng.response_times_ms[-10:]), 1)
                if eng.response_times_ms else 10000
            ),
        }

    def _update_topic_strength(
        self, profile: LearningProfile, topic: str, is_correct: bool
    ) -> None:
        """Move topics between weak/strong lists based on performance."""
        if is_correct:
            if topic in profile.weak_topics:
                profile.weak_topics.remove(topic)
            if topic not in profile.strong_topics:
                profile.strong_topics.append(topic)
        else:
            if topic in profile.strong_topics:
                profile.strong_topics.remove(topic)
            if topic not in profile.weak_topics:
                profile.weak_topics.append(topic)

    def get_profile(self, student_id: str) -> Optional[LearningProfile]:
        return self._profiles.get(student_id)

    def get_engagement(self, student_id: str) -> Optional[EngagementState]:
        return self._engagement.get(student_id)

    def update_session_duration(self, session: Any) -> None:
        """Update the session duration for fatigue tracking."""
        sid = session.student_id
        eng = self._engagement.get(sid)
        if eng and session.started_at:
            from datetime import datetime
            start = datetime.fromisoformat(session.started_at)
            eng.session_duration_seconds = (
                datetime.utcnow() - start
            ).total_seconds()

    def get_momentum_score(self, student_id: str) -> float:
        """
        Cross-session momentum score (0-1).
        Based on recency and consistency of study sessions.
        """
        profile = self._profiles.get(student_id)
        if not profile or not profile.last_session_at:
            return 0.0

        days_since = (datetime.utcnow() - datetime.fromisoformat(
            profile.last_session_at
        )).total_seconds() / 86400

        if days_since > self.momentum_decay_days:
            return 0.0

        recency = 1.0 - (days_since / self.momentum_decay_days)
        consistency = min(1.0, profile.streak_days / 30)
        return round(0.6 * recency + 0.4 * consistency, 4)
