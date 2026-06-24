"""
Spaced Repetition Engine — SM-2 with enhancements.
Implements the SuperMemo SM-2 algorithm with:
- Quality mapping from response confidence, time, and correctness
- Retention prediction via forgetting curve
- Interleaving optimizer
- Adaptive ease factor
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Any, Optional
from enum import Enum


class ReviewQuality(Enum):
    """SM-2 quality of recall, mapped from real performance signals."""
    AGAIN = 0  # Complete blackout
    HARD = 1  # Incorrect, but remembered upon seeing answer
    FAIR = 2  # Incorrect, but easy to recall
    GOOD = 3  # Correct with some effort
    EASY = 4  # Correct with no difficulty
    PERFECT = 5  # Perfect, instant response


@dataclass
class SRItem:
    """A single spaced repetition item (card/topic)."""
    topic: str
    student_id: str
    ease_factor: float = 2.5
    interval_hours: float = 24.0
    repetition_count: int = 0
    next_review_at: str = ""
    last_reviewed_at: str = ""
    difficulty: float = 0.5  # 0.0-1.0, affects load estimation
    total_reviews: int = 0
    correct_streak: int = 0
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def __post_init__(self):
        if not self.next_review_at:
            self.next_review_at = (
                datetime.utcnow() + timedelta(hours=self.interval_hours)
            ).isoformat()


@dataclass
class SRSchedule:
    """Computed schedule for a student's reviews."""
    items: list[dict[str, Any]]
    total_due: int
    estimated_minutes: int
    topics: list[str]


class SpacedRepetitionEngine:
    """
    SM-2 based spaced repetition with enhancements:
    - Adaptive ease factor (bounded 1.3 - 3.0)
    - Response time quality modifier
    - Confidence-weighted quality
    - Forgetting curve retention prediction
    - Interleaving-aware scheduling
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.initial_interval_hours = config.get("initial_interval_hours", 24)
        self.min_interval_hours = config.get("min_interval_hours", 4)
        self.max_interval_days = config.get("max_interval_days", 90)
        self.easy_bonus = config.get("easy_bonus", 1.3)
        self.hard_penalty = config.get("hard_penalty", 0.6)
        self.target_retention = config.get("target_retention", 0.9)
        self._items: dict[str, dict[str, SRItem]] = {}  # student_id -> topic -> item

    def init_student(self, student_id: str) -> None:
        if student_id not in self._items:
            self._items[student_id] = {}

    def add_item(self, student_id: str, topic: str, difficulty: float = 0.5) -> SRItem:
        """Add a new topic for spaced repetition."""
        self.init_student(student_id)
        if topic in self._items[student_id]:
            return self._items[student_id][topic]

        item = SRItem(
            topic=topic,
            student_id=student_id,
            difficulty=difficulty,
            interval_hours=self.initial_interval_hours,
        )
        self._items[student_id][topic] = item
        return item

    def update_item(
        self,
        student_id: str,
        topic: str,
        quality: ReviewQuality,
        response_time_ms: int = 10000,
    ) -> SRItem:
        """
        Update an item after a review using SM-2 algorithm.
        Quality is adjusted based on response time.
        """
        self.init_student(student_id)
        item = self._items[student_id].get(topic)
        if not item:
            item = self.add_item(student_id, topic)

        # Adjust quality based on response time
        adjusted_quality = self._adjust_quality_for_time(quality, response_time_ms)

        # SM-2 ease factor update
        q = adjusted_quality.value
        old_ef = item.ease_factor
        new_ef = old_ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        item.ease_factor = max(1.3, min(3.0, new_ef))

        # Interval update
        if q < 3:
            # Failed — reset
            item.repetition_count = 0
            item.interval_hours = self.min_interval_hours
            item.correct_streak = 0
        else:
            item.repetition_count += 1
            item.correct_streak += 1

            if item.repetition_count == 1:
                item.interval_hours = self.initial_interval_hours
            elif item.repetition_count == 2:
                item.interval_hours = self.initial_interval_hours * self.easy_bonus
            else:
                item.interval_hours *= item.ease_factor

            # Apply easy bonus for high quality
            if q >= 4:
                item.interval_hours *= self.easy_bonus
            elif q <= 2:
                item.interval_hours *= self.hard_penalty

        # Cap interval
        max_hours = self.max_interval_days * 24
        item.interval_hours = max(self.min_interval_hours, min(max_hours, item.interval_hours))

        # Update timestamps
        now = datetime.utcnow()
        item.last_reviewed_at = now.isoformat()
        item.next_review_at = (now + timedelta(hours=item.interval_hours)).isoformat()
        item.total_reviews += 1

        return item

    def get_due_reviews(
        self, student_id: str, limit: int = 10
    ) -> list[dict[str, Any]]:
        """Get items due for review, sorted by urgency."""
        self.init_student(student_id)
        now = datetime.utcnow()
        due = []

        for topic, item in self._items[student_id].items():
            review_time = datetime.fromisoformat(item.next_review_at)
            if review_time <= now:
                hours_overdue = (now - review_time).total_seconds() / 3600
                urgency = hours_overdue / max(item.interval_hours, 1)
                due.append({
                    "topic": topic,
                    "difficulty": item.difficulty,
                    "interval_days": item.interval_hours / 24,
                    "repetition_count": item.repetition_count,
                    "ease_factor": round(item.ease_factor, 2),
                    "hours_overdue": round(hours_overdue, 1),
                    "urgency": round(urgency, 3),
                })

        # Sort by urgency (most overdue first)
        due.sort(key=lambda x: x["urgency"], reverse=True)
        return due[:limit]

    def predict_retention(self, student_id: str, topic: str) -> float:
        """
        Predict retention probability using the forgetting curve.
        R(t) = e^(-t/S) where S is stability (interval * ease_factor).
        """
        self.init_student(student_id)
        item = self._items[student_id].get(topic)
        if not item or not item.last_reviewed_at:
            return 0.5  # Unknown

        hours_since = (datetime.utcnow() - datetime.fromisoformat(
            item.last_reviewed_at
        )).total_seconds() / 3600

        stability = item.interval_hours * item.ease_factor
        retention = math.exp(-hours_since / max(stability, 1))
        return round(max(0.0, min(1.0, retention)), 4)

    def get_schedule(self, student_id: str, days_ahead: int = 7) -> SRSchedule:
        """Get a study schedule for the next N days."""
        self.init_student(student_id)
        now = datetime.utcnow()
        end = now + timedelta(days=days_ahead)

        items = []
        total_minutes = 0
        topics = set()

        for topic, item in self._items[student_id].items():
            review_time = datetime.fromisoformat(item.next_review_at)
            if review_time <= end:
                estimated_min = max(2, int(15 * item.difficulty))
                items.append({
                    "topic": topic,
                    "due_at": item.next_review_at,
                    "difficulty": item.difficulty,
                    "estimated_minutes": estimated_min,
                })
                total_minutes += estimated_min
                topics.add(topic)

        items.sort(key=lambda x: x["due_at"])
        return SRSchedule(
            items=items,
            total_due=len(items),
            estimated_minutes=total_minutes,
            topics=sorted(topics),
        )

    def get_stats(self, student_id: str) -> dict[str, Any]:
        """Get overall SR statistics for a student."""
        self.init_student(student_id)
        items = list(self._items[student_id].values())

        if not items:
            return {"total_items": 0, "mastered": 0, "learning": 0}

        mastered = sum(1 for i in items if i.repetition_count >= 5 and i.ease_factor >= 2.5)
        learning = sum(1 for i in items if 0 < i.repetition_count < 5)
        avg_ef = sum(i.ease_factor for i in items) / len(items)

        return {
            "total_items": len(items),
            "mastered": mastered,
            "learning": learning,
            "not_started": len(items) - mastered - learning,
            "avg_ease_factor": round(avg_ef, 2),
            "avg_interval_days": round(
                sum(i.interval_hours for i in items) / max(len(items), 1) / 24, 1
            ),
        }

    def _adjust_quality_for_time(
        self, base: ReviewQuality, response_time_ms: int
    ) -> ReviewQuality:
        """Adjust review quality based on response time."""
        if base in (ReviewQuality.EASY, ReviewQuality.PERFECT):
            if response_time_ms > 15000:
                return ReviewQuality.GOOD  # Slow even though correct
            return base
        elif base == ReviewQuality.GOOD:
            if response_time_ms < 5000:
                return ReviewQuality.EASY
            elif response_time_ms > 20000:
                return ReviewQuality.HARD
            return base
        elif base == ReviewQuality.HARD:
            if response_time_ms > 30000:
                return ReviewQuality.AGAIN
            return base
        return base
