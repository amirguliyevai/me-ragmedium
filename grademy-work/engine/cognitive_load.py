"""
Cognitive Load Balancer — Prevents overwhelm, optimizes session composition.
Estimates mental effort per activity and manages session flow.
"""

from __future__ import annotations

from typing import Any

from engine.models import ActivityType, SessionMode, ActivityLoad


# ── Activity Load Estimation ────────────────────────────────────────────────

# Base cognitive load by activity type (0-1)
BASE_LOAD: dict[ActivityType, float] = {
    ActivityType.FLASHCARD: 0.2,
    ActivityType.MULTIPLE_CHOICE: 0.3,
    ActivityType.MATCHING: 0.35,
    ActivityType.FILL_BLANK: 0.45,
    ActivityType.FREE_RESPONSE: 0.55,
    ActivityType.PROBLEM_SOLVING: 0.7,
    ActivityType.EXPLANATION: 0.6,
    ActivityType.INTERACTIVE_CANVAS: 0.5,
}

# Mode multipliers
MODE_MULTIPLIERS: dict[SessionMode, float] = {
    SessionMode.LESSON: 0.8,      # Guided, lower load
    SessionMode.PRACTICE: 1.0,    # Standard
    SessionMode.REVIEW: 0.7,      # Easier, familiar
    SessionMode.EXAM: 1.3,        # High stakes
    SessionMode.CHAT: 0.4,        # Conversational
    SessionMode.CANVAS: 0.6,      # Interactive
}


class CognitiveLoadBalancer:
    """
    Manages cognitive load during study sessions:
    - Classifies activity load
    - Tracks cumulative session load
    - Detects overload conditions
    - Recommends break points
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.max_load = config.get("max_load", 0.85)
        self.break_threshold = config.get("break_threshold", 0.75)
        self.sessions_before_break = config.get("sessions_before_break", 8)

    def classify_load(
        self, activity_type: ActivityType, difficulty: float, mode: SessionMode = SessionMode.PRACTICE
    ) -> ActivityLoad:
        """Classify the cognitive load of an activity."""
        base = BASE_LOAD.get(activity_type, 0.5)
        mode_mult = MODE_MULTIPLIERS.get(mode, 1.0)

        # Difficulty contributes 0-0.3 extra load
        difficulty_factor = difficulty * 0.3

        total = min(1.0, base * mode_mult + difficulty_factor)
        estimated_minutes = 2 + int(difficulty * 8)  # 2-10 minutes

        return ActivityLoad(
            base_load=base,
            mode_multiplier=mode_mult,
            difficulty_factor=difficulty_factor,
            total_load=round(total, 3),
            estimated_minutes=estimated_minutes,
        )

    def estimate_current_load(self, session: Any) -> float:
        """
        Estimate the current cumulative cognitive load of a session.
        Uses a weighted average that penalizes consecutive high-load activities.
        """
        if not session.activities:
            return 0.0

        loads = []
        for activity in session.activities:
            loads.append(activity.cognitive_load.total_load)

        if not loads:
            return 0.0

        # Weighted average: recent activities count more
        weights = [1.0 + 0.1 * i for i in range(len(loads))]
        weighted_sum = sum(l * w for l, w in zip(loads, weights))
        avg = weighted_sum / sum(weights)

        # Penalize consecutive high-load streaks
        consecutive_high = 0
        max_consecutive = 0
        for load in loads:
            if load > self.break_threshold:
                consecutive_high += 1
                max_consecutive = max(max_consecutive, consecutive_high)
            else:
                consecutive_high = 0

        streak_penalty = min(0.2, max_consecutive * 0.05)
        return round(min(1.0, avg + streak_penalty), 3)

    def should_suggest_break(self, session: Any) -> bool:
        """Determine if the student should take a break."""
        current_load = self.estimate_current_load(session)
        if current_load > self.max_load:
            return True

        # Check if too many activities completed without a break
        completed = len(session.responses)
        if completed > 0 and completed % self.sessions_before_break == 0:
            return True

        return False

    def target_load_for_student(self, student: Any) -> float:
        """
        Determine the optimal target cognitive load for a student.
        Based on their learning speed and recent performance.
        """
        speed = getattr(student.profile, "learning_speed", 0.5)
        # Faster students can handle higher load
        # Range: 0.5 (slow) to 0.85 (fast)
        return round(0.5 + speed * 0.35, 3)

    def optimize_session_composition(
        self, activities: list[Any], target_load: float
    ) -> list[Any]:
        """
        Reorder activities to maintain sustainable cognitive load.
        Pattern: alternate high-load and low-load activities.
        """
        if not activities:
            return activities

        # Sort by load
        sorted_acts = sorted(
            activities, key=lambda a: a.cognitive_load.total_load, reverse=True
        )

        # Interleave: high, low, high, low...
        result = []
        left = 0
        right = len(sorted_acts) - 1

        while left <= right:
            if left == right:
                result.append(sorted_acts[left])
            else:
                result.append(sorted_acts[left])   # high
                result.append(sorted_acts[right])  # low
            left += 1
            right -= 1

        return result

    def get_load_report(self, session: Any) -> dict[str, Any]:
        """Generate a cognitive load report for the current session."""
        current = self.estimate_current_load(session)
        completed = len(session.responses)
        total = len(session.activities)

        return {
            "current_load": current,
            "max_load": self.max_load,
            "utilization": round(current / max(self.max_load, 0.01), 2),
            "activities_completed": completed,
            "activities_remaining": total - completed,
            "break_recommended": self.should_suggest_break(session),
            "status": (
                "overload" if current > self.max_load
                else "high" if current > self.break_threshold
                else "optimal" if current > 0.3
                else "low"
            ),
        }
