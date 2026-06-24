"""
Grademy Study Session Engine
============================
Core orchestrator for the AI tutoring system.
Spaced repetition, personalization, cognitive load balancing, and real-time adaptation.
"""

from __future__ import annotations

import math
import json
import hashlib
from datetime import datetime, timedelta
from dataclasses import dataclass, field, asdict
from typing import Any, Optional
from enum import Enum
from pathlib import Path

from engine.models import (
    SessionMode, ActivityType, Student, StudyActivity,
    SessionResponse, StudySession, LearningProfile, ActivityLoad,
)
from engine.spaced_repetition import SpacedRepetitionEngine, ReviewQuality
from engine.personalization import PersonalizationEngine
from engine.cognitive_load import CognitiveLoadBalancer
from engine.adaptation import AdaptationEngine
from engine.analytics import SessionAnalytics
from engine.gemini_integration import GeminiTutor


# ── Session Engine ────────────────────────────────────────────────────────────

class StudySessionEngine:
    """
    Orchestrates the full study session lifecycle:
    1. Initialize session with personalization
    2. Select activities (spaced repetition + interleaving)
    3. Monitor cognitive load and engagement
    4. Adapt in real-time
    5. Generate content via Gemini
    6. Track analytics
    """

    VERSION = "1.0.0"
    SESSION_GRACE_SECONDS = 300  # 5 min gap within same session

    def __init__(self, config_path: Optional[Path] = None):
        self.config = self._load_config(config_path)
        self.sr_engine = SpacedRepetitionEngine(self.config.get("sr", {}))
        self.personalization = PersonalizationEngine(self.config.get("personalization", {}))
        self.cognitive_balancer = CognitiveLoadBalancer(self.config.get("cognitive_load", {}))
        self.adaptation = AdaptationEngine(self.config.get("adaptation", {}))
        self.analytics = SessionAnalytics(self.config.get("analytics", {}))
        self.gemini = GeminiTutor(self.config.get("gemini", {}))
        self._active_sessions: dict[str, StudySession] = {}
        self._student_store: dict[str, Student] = {}

    # ── Student Management ─────────────────────────────────────────────────

    def register_student(self, student: Student) -> Student:
        self._student_store[student.id] = student
        self.personalization.init_profile(student)
        self.sr_engine.init_student(student.id)
        return student

    def get_student(self, student_id: str) -> Optional[Student]:
        return self._student_store.get(student_id)

    # ── Session Lifecycle ───────────────────────────────────────────────────

    def start_session(
        self,
        student_id: str,
        mode: SessionMode = SessionMode.PRACTICE,
        topic: Optional[str] = None,
        duration_minutes: int = 30,
    ) -> StudySession:
        student = self._student_store.get(student_id)
        if not student:
            raise ValueError(f"Student {student_id} not found. Register first.")

        session_id = self._generate_id(student_id, mode.value)

        session = StudySession(
            id=session_id,
            student_id=student_id,
            mode=mode,
        )

        # Determine session composition based on personalization + SR
        target_load = self.cognitive_balancer.target_load_for_student(student)
        review_items = self.sr_engine.get_due_reviews(
            student_id, limit=10, include_fatigue_check=True
        )

        # Mix: 60% new/practice, 40% review (spaced repetition)
        review_count = min(len(review_items), max(2, int(duration_minutes * 0.4)))
        new_count = max(0, duration_minutes - review_count)

        activities: list[StudyActivity] = []

        # Add spaced repetition reviews
        for item in review_items[:review_count]:
            activity = self._build_review_activity(item, student)
            activities.append(activity)

        # Add new content
        if mode in (SessionMode.LESSON, SessionMode.PRACTICE):
            for i in range(new_count):
                difficulty = self._calculate_target_difficulty(student)
                activity = self._build_practice_activity(
                    student, topic=topic, difficulty=difficulty, index=i
                )
                activities.append(activity)

        # Apply interleaving: mix topics
        if len(activities) > 3:
            activities = self._interleave(activities)

        # Apply cognitive load optimization
        activities = self.cognitive_balancer.optimize_session_composition(
            activities, target_load
        )

        session.activities = activities
        self._active_sessions[session_id] = session

        return session

    def submit_response(
        self, session_id: str, response: SessionResponse
    ) -> dict[str, Any]:
        """Process a student response and return adaptation recommendations."""
        session = self._active_sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found.")

        student = self._student_store[session.student_id]

        # Map performance to review quality
        response.quality = self._map_to_review_quality(response)
        session.responses.append(response)

        # Update spaced repetition state
        activity = next(
            (a for a in session.activities if a.id == response.activity_id), None
        )
        if activity:
            self.sr_engine.update_item(
                student_id=session.student_id,
                topic=activity.topic,
                quality=response.quality,
                response_time_ms=response.response_time_ms,
                confidence=response.confidence,
            )

        # Update personalization
        self.personalization.record_response(student, response, activity)

        # Update engagement (with session duration for fatigue detection)
        self.personalization.update_session_duration(session)
        engagement = self.personalization.compute_engagement(session)
        session.engagement_score = engagement

        # Check cognitive load
        current_load = self.cognitive_balancer.estimate_current_load(session)
        session.cognitive_load_avg = current_load

        # Real-time adaptation
        adaptation = self.adaptation.evaluate(session, student)

        return {
            "correct": response.is_correct,
            "quality": response.quality.value if response.quality else None,
            "engagement": round(engagement, 3),
            "cognitive_load": round(current_load, 3),
            "adaptation": adaptation,
            "next_recommendation": self._recommend_next(session, adaptation),
        }

    def end_session(self, session_id: str) -> dict[str, Any]:
        """Finalize a session and return analytics."""
        session = self._active_sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found.")

        session.ended_at = datetime.utcnow().isoformat()
        session.quality_score = self.analytics.compute_session_quality(session)
        student = self._student_store[session.student_id]

        result = self.analytics.generate_session_report(session, student)

        # Clean up
        del self._active_sessions[session_id]

        return result

    # ── AI Tutor Integration ───────────────────────────────────────────────

    def generate_explanation(
        self, session_id: str, activity_id: str
    ) -> dict[str, Any]:
        """Generate an AI explanation for a wrong answer via Gemini."""
        session = self._active_sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found.")

        activity = next(
            (a for a in session.activities if a.id == activity_id), None
        )
        if not activity:
            raise ValueError(f"Activity {activity_id} not found.")

        student = self._student_store[session.student_id]
        context = self.personalization.build_tutor_context(student)

        return self.gemini.explain(activity, context)

    def generate_hint(self, session_id: str, activity_id: str) -> str:
        """Generate a progressive hint for the current activity."""
        session = self._active_sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found.")

        activity = next(
            (a for a in session.activities if a.id == activity_id), None
        )
        if not activity:
            raise ValueError(f"Activity {activity_id} not found.")

        student = self._student_store[session.student_id]
        context = self.personalization.build_tutor_context(student)

        return self.gemini.hint(activity, context)

    # ── Private Helpers ─────────────────────────────────────────────────────

    def _generate_id(self, *parts: str) -> str:
        raw = "|".join(parts) + "|" + datetime.utcnow().isoformat()
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def _calculate_target_difficulty(self, student: Student) -> float:
        """Target ~70-80% success rate (desirable difficulty)."""
        perf = self.personalization.recent_performance(student.id)
        if perf is None:
            return 0.5
        # If doing too well, increase difficulty; if struggling, decrease
        if perf > 0.85:
            return min(1.0, perf + 0.05)
        elif perf < 0.65:
            return max(0.1, perf - 0.05)
        return perf

    def _build_review_activity(
        self, sr_item: dict[str, Any], student: Student
    ) -> StudyActivity:
        """Build a review activity from a spaced repetition item."""
        topic = sr_item.get("topic", "unknown")
        difficulty = sr_item.get("difficulty", 0.5)

        return StudyActivity(
            id=self._generate_id("review", topic),
            type=ActivityType.FLASHCARD,
            topic=topic,
            difficulty=difficulty,
            cognitive_load=self.cognitive_balancer.classify_load(
                ActivityType.FLASHCARD, difficulty
            ),
            content={
                "type": "review",
                "interval_days": sr_item.get("interval_days", 0),
                "repetition_count": sr_item.get("repetition_count", 0),
            },
        )

    def _build_practice_activity(
        self,
        student: Student,
        topic: Optional[str],
        difficulty: float,
        index: int,
    ) -> StudyActivity:
        """Build a new practice activity based on personalization."""
        preferred_modes = student.profile.preferred_activity_types
        if preferred_modes:
            activity_type = ActivityType(preferred_modes[index % len(preferred_modes)])
        else:
            activity_type = ActivityType.MULTIPLE_CHOICE

        target_topic = topic or self.personalization.suggest_topic(student.id)

        return StudyActivity(
            id=self._generate_id("practice", target_topic, str(index)),
            type=activity_type,
            topic=target_topic,
            difficulty=difficulty,
            cognitive_load=self.cognitive_balancer.classify_load(
                activity_type, difficulty
            ),
            content={
                "type": "practice",
                "adaptive": True,
                "target_success_rate": 0.75,
            },
        )

    def _interleave(self, activities: list[StudyActivity]) -> list[StudyActivity]:
        """Interleave topics for better retention (mix different subjects)."""
        from collections import defaultdict
        import random

        by_topic: dict[str, list[StudyActivity]] = defaultdict(list)
        for a in activities:
            by_topic[a.topic].append(a)

        result = []
        topics = list(by_topic.keys())
        random.shuffle(topics)

        while any(by_topic[t] for t in topics):
            for topic in topics:
                if by_topic[topic]:
                    result.append(by_topic[topic].pop(0))

        return result

    def _map_to_review_quality(self, response: SessionResponse) -> ReviewQuality:
        """Map performance metrics to SM-2 quality score (0-5)."""
        if not response.is_correct:
            if response.response_time_ms > 30000:
                return ReviewQuality.AGAIN  # took too long and wrong
            return ReviewQuality.HARD  # wrong but maybe close

        if response.response_time_ms < 5000 and response.confidence > 0.8:
            return ReviewQuality.EASY
        elif response.response_time_ms < 10000:
            return ReviewQuality.GOOD
        else:
            return ReviewQuality.HARD  # correct but slow

    def _recommend_next(
        self, session: StudySession, adaptation: dict[str, Any]
    ) -> dict[str, Any]:
        rec: dict[str, Any] = {"action": "continue"}

        if adaptation.get("reduce_difficulty"):
            rec["action"] = "reduce_difficulty"
            rec["message"] = "Let's try something a bit easier."
        elif adaptation.get("increase_difficulty"):
            rec["action"] = "increase_difficulty"
            rec["message"] = "Great job! Ready for a challenge?"
        elif adaptation.get("suggest_break"):
            rec["action"] = "suggest_break"
            rec["message"] = "You've been working hard. Time for a short break?"
        elif adaptation.get("switch_mode"):
            rec["action"] = "switch_mode"
            rec["target_mode"] = adaptation.get("target_mode", "review")
        elif adaptation.get("struggling"):
            rec["action"] = "offer_explanation"
            rec["message"] = "Let me explain this one."

        return rec

    def _load_config(self, path: Optional[Path]) -> dict[str, Any]:
        if path and path.exists():
            return json.loads(path.read_text())
        return self._default_config()

    @staticmethod
    def _default_config() -> dict[str, Any]:
        return {
            "sr": {
                "initial_interval_hours": 24,
                "min_interval_hours": 4,
                "max_interval_days": 90,
                "easy_bonus": 1.3,
                "hard_penalty": 0.6,
                "target_retention": 0.9,
            },
            "personalization": {
                "engagement_window": 10,
                "momentum_decay_days": 7,
                "learning_speed_default": 0.5,
            },
            "cognitive_load": {
                "max_load": 0.85,
                "break_threshold": 0.75,
                "sessions_before_break": 8,
            },
            "adaptation": {
                "engagement_drop_threshold": 0.15,
                "stuck_threshold_failures": 3,
                "rushing_threshold_seconds": 2,
                "overload_consecutive_high": 5,
            },
            "analytics": {
                "quality_weights": {
                    "accuracy": 0.35,
                    "engagement": 0.25,
                    "cognitive_efficiency": 0.20,
                    "response_time": 0.20,
                }
            },
            "gemini": {
                "model": "gemini-2.0-flash",
                "temperature": 0.7,
                "max_tokens": 1024,
                "safety_level": "moderate",
            },
        }
