"""
Gamification Engine — Streaks, XP, achievements, and goals.
Provides motivation and engagement incentives for students.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Any, Optional


# ── Level System ─────────────────────────────────────────────────────────────

LEVEL_XP_CURVE = lambda level: int(100 * (1.5 ** level))
MAX_LEVEL = 15


def xp_for_level(level: int) -> int:
    """XP required to reach a given level from level-1."""
    return LEVEL_XP_CURVE(level)


def level_from_xp(total_xp: int) -> int:
    """Calculate level from total XP."""
    if total_xp < 0:
        return 0
    cumulative = 0
    for lvl in range(1, MAX_LEVEL + 1):
        cumulative += xp_for_level(lvl)
        if total_xp < cumulative:
            return max(0, lvl - 1)
    return MAX_LEVEL


# ── Achievements ─────────────────────────────────────────────────────────────

ACHIEVEMENTS = [
    # Streak achievements
    {"id": "streak_3", "name": "Three-Peat", "description": "3-day study streak", "category": "streak", "threshold": 3, "badge": "🔥"},
    {"id": "streak_7", "name": "Week Warrior", "description": "7-day study streak", "category": "streak", "threshold": 7, "badge": "⚡"},
    {"id": "streak_14", "name": "Fortnight Focus", "description": "14-day study streak", "category": "streak", "threshold": 14, "badge": "🌟"},
    {"id": "streak_30", "name": "Monthly Master", "description": "30-day study streak", "category": "streak", "threshold": 30, "badge": "👑"},
    # Session achievements
    {"id": "sessions_10", "name": "Getting Started", "description": "Complete 10 sessions", "category": "session", "threshold": 10, "badge": "📚"},
    {"id": "sessions_50", "name": "Dedicated Learner", "description": "Complete 50 sessions", "category": "session", "threshold": 50, "badge": "🎓"},
    {"id": "sessions_100", "name": "Century Club", "description": "Complete 100 sessions", "category": "session", "threshold": 100, "badge": "💯"},
    # Review achievements
    {"id": "reviews_100", "name": "Review Rookie", "description": "Complete 100 reviews", "category": "review", "threshold": 100, "badge": "📝"},
    {"id": "reviews_500", "name": "Review Pro", "description": "Complete 500 reviews", "category": "review", "threshold": 500, "badge": "📋"},
    {"id": "reviews_1000", "name": "Review Master", "description": "Complete 1000 reviews", "category": "review", "threshold": 1000, "badge": "🏆"},
    # Mastery achievements
    {"id": "mastery_5", "name": "First Mastery", "description": "Master 5 topics", "category": "mastery", "threshold": 5, "badge": "⭐"},
    {"id": "mastery_20", "name": "Knowledge Seeker", "description": "Master 20 topics", "category": "mastery", "threshold": 20, "badge": "🌠"},
    {"id": "mastery_50", "name": "Polymath", "description": "Master 50 topics", "category": "mastery", "threshold": 50, "badge": "🏅"},
    # Special achievements
    {"id": "perfect_session", "name": "Perfect Score", "description": "100% accuracy in a session", "category": "special", "threshold": 1, "badge": "💎"},
    {"id": "speed_demon", "name": "Speed Demon", "description": "10 correct answers under 3 seconds each", "category": "special", "threshold": 10, "badge": "⚡"},
    {"id": "night_owl", "name": "Night Owl", "description": "Study after midnight", "category": "special", "threshold": 1, "badge": "🦉"},
    {"id": "early_bird", "name": "Early Bird", "description": "Study before 6 AM", "category": "special", "threshold": 1, "badge": "🐦"},
]


@dataclass
class Achievement:
    """A single achievement definition."""
    id: str
    name: str
    description: str
    category: str
    threshold: int
    badge: str


@dataclass
class GamificationState:
    """Current gamification state for a student."""
    total_xp: int = 0
    level: int = 1
    current_streak: int = 0
    longest_streak: int = 0
    last_study_date: str = ""
    total_sessions: int = 0
    total_reviews: int = 0
    mastered_topics: int = 0
    achievements_unlocked: list[str] = field(default_factory=list)
    daily_xp: int = 0
    daily_goal_xp: int = 50
    daily_goal_met: bool = False
    streak_grace_days: int = 2


class GamificationEngine:
    """
    Manages gamification elements:
    - XP and leveling system
    - Streak tracking with grace periods
    - Achievement unlocking
    - Daily goals
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.daily_goal_xp = config.get("daily_goal_xp", 50)
        self.streak_grace_days = config.get("streak_grace_days", 2)
        self.xp_base_per_activity = config.get("xp_base_per_activity", 10)
        self._states: dict[str, GamificationState] = {}

    def init_student(self, student_id: str) -> GamificationState:
        """Initialize gamification state for a new student."""
        if student_id not in self._states:
            self._states[student_id] = GamificationState(
                daily_goal_xp=self.daily_goal_xp,
                streak_grace_days=self.streak_grace_days,
            )
        return self._states[student_id]

    def record_session(self, student_id: str, session_data: dict[str, Any]) -> dict[str, Any]:
        """
        Record a completed session and update all gamification state.
        Returns a summary of what happened (XP gained, achievements unlocked, etc).
        """
        state = self.init_student(student_id)

        # Calculate XP
        xp_gained = self._calculate_xp(session_data)
        state.total_xp += xp_gained
        state.daily_xp += xp_gained
        state.total_sessions += 1

        # Update level
        new_level = level_from_xp(state.total_xp)
        leveled_up = new_level > state.level
        state.level = new_level

        # Update streak
        streak_event = self._update_streak(state)

        # Update review count
        review_count = session_data.get("review_count", 0)
        state.total_reviews += review_count

        # Update mastered topics
        mastered = session_data.get("mastered_count", 0)
        state.mastered_topics += mastered

        # Check daily goal
        goal_met = state.daily_xp >= state.daily_goal_xp
        goal_just_met = goal_met and not state.daily_goal_met
        state.daily_goal_met = goal_met

        # Check achievements
        new_achievements = self._check_achievements(state, session_data)

        return {
            "xp_gained": xp_gained,
            "total_xp": state.total_xp,
            "level": state.level,
            "leveled_up": leveled_up,
            "current_streak": state.current_streak,
            "longest_streak": state.longest_streak,
            "streak_event": streak_event,
            "daily_goal_met": goal_just_met,
            "daily_xp": state.daily_xp,
            "daily_goal_xp": state.daily_goal_xp,
            "new_achievements": new_achievements,
            "total_reviews": state.total_reviews,
            "mastered_topics": state.mastered_topics,
        }

    def get_state(self, student_id: str) -> dict[str, Any]:
        """Get the current gamification state for a student."""
        state = self.init_student(student_id)
        xp_to_next = xp_for_level(state.level + 1) if state.level < MAX_LEVEL else 0
        xp_in_current = state.total_xp - sum(
            xp_for_level(l) for l in range(1, state.level + 1)
        ) if state.level > 0 else state.total_xp

        return {
            "level": state.level,
            "total_xp": state.total_xp,
            "xp_to_next_level": xp_to_next,
            "xp_in_current_level": max(0, xp_in_current),
            "progress_pct": round(xp_in_current / max(xp_to_next, 1) * 100, 1),
            "current_streak": state.current_streak,
            "longest_streak": state.longest_streak,
            "total_sessions": state.total_sessions,
            "total_reviews": state.total_reviews,
            "mastered_topics": state.mastered_topics,
            "achievements": len(state.achievements_unlocked),
            "achievement_list": state.achievements_unlocked,
            "daily_xp": state.daily_xp,
            "daily_goal_xp": state.daily_goal_xp,
            "daily_goal_met": state.daily_goal_met,
        }

    def get_leaderboard_data(self, student_id: str) -> dict[str, Any]:
        """Get data for leaderboard display."""
        state = self.init_student(student_id)
        return {
            "student_id": student_id,
            "level": state.level,
            "total_xp": state.total_xp,
            "current_streak": state.current_streak,
            "total_sessions": state.total_sessions,
            "mastered_topics": state.mastered_topics,
        }

    def _calculate_xp(self, session_data: dict[str, Any]) -> int:
        """Calculate XP earned from a session."""
        base_xp = 0

        # XP per activity completed
        activities_completed = session_data.get("activities_completed", 0)
        base_xp += activities_completed * self.xp_base_per_activity

        # Accuracy bonus
        accuracy = session_data.get("accuracy", 0.5)
        if accuracy >= 0.9:
            base_xp = int(base_xp * 1.3)  # 30% bonus for high accuracy
        elif accuracy >= 0.75:
            base_xp = int(base_xp * 1.15)

        # Streak bonus
        streak = session_data.get("current_streak", 0)
        streak_multiplier = 1.0 + min(0.5, streak * 0.05)  # Up to 50% bonus
        base_xp = int(base_xp * streak_multiplier)

        # Level scaling (higher levels get slightly less XP to prevent runaway)
        level = session_data.get("level", 1)
        level_scale = max(0.5, 1.0 - (level - 1) * 0.02)
        base_xp = int(base_xp * level_scale)

        # Minimum XP for completing a session
        return max(5, base_xp)

    def _update_streak(self, state: GamificationState) -> str:
        """Update streak tracking. Returns streak event type."""
        today = datetime.utcnow().date().isoformat()

        if state.last_study_date == today:
            return "already_logged"  # Already studied today

        last_date = datetime.fromisoformat(state.last_study_date).date() if state.last_study_date else None
        today_date = datetime.utcnow().date()

        if last_date is None:
            # First session
            state.current_streak = 1
            state.last_study_date = today
            return "started"

        days_since = (today_date - last_date).days

        if days_since == 1:
            # Consecutive day
            state.current_streak += 1
            state.longest_streak = max(state.longest_streak, state.current_streak)
            state.last_study_date = today
            return "continued"
        elif days_since <= state.streak_grace_days:
            # Within grace period (e.g., missed 1 day)
            state.current_streak += 1
            state.longest_streak = max(state.longest_streak, state.current_streak)
            state.last_study_date = today
            return "grace_saved"
        else:
            # Streak broken
            state.current_streak = 1
            state.last_study_date = today
            return "reset"

    def _check_achievements(
        self, state: GamificationState, session_data: dict[str, Any]
    ) -> list[dict[str, str]]:
        """Check and unlock any newly earned achievements."""
        new_achievements = []

        for achievement_def in ACHIEVEMENTS:
            aid = achievement_def["id"]
            if aid in state.achievements_unlocked:
                continue

            unlocked = False
            category = achievement_def["category"]
            threshold = achievement_def["threshold"]

            if category == "streak" and state.current_streak >= threshold:
                unlocked = True
            elif category == "session" and state.total_sessions >= threshold:
                unlocked = True
            elif category == "review" and state.total_reviews >= threshold:
                unlocked = True
            elif category == "mastery" and state.mastered_topics >= threshold:
                unlocked = True
            elif category == "special":
                if aid == "perfect_session" and session_data.get("accuracy", 0) == 1.0:
                    unlocked = True
                elif aid == "speed_demon":
                    fast_count = session_data.get("fast_correct_count", 0)
                    if fast_count >= threshold:
                        unlocked = True
                elif aid == "night_owl":
                    hour = session_data.get("session_hour", 12)
                    if hour >= 0 and hour < 6:
                        unlocked = True
                elif aid == "early_bird":
                    hour = session_data.get("session_hour", 12)
                    if 5 <= hour < 6:
                        unlocked = True

            if unlocked:
                state.achievements_unlocked.append(aid)
                new_achievements.append({
                    "id": aid,
                    "name": achievement_def["name"],
                    "description": achievement_def["description"],
                    "badge": achievement_def["badge"],
                })

        return new_achievements
