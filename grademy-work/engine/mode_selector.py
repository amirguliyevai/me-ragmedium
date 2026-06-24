"""
Mode Selection Optimizer — Personalized activity type selection.
Scores candidate activity modes based on student history, pedagogical
appropriateness, and session context to select the best mode for each activity.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


# Pedagogical appropriateness scores by learning stage
STAGE_MODE_SCORES: dict[str, dict[str, float]] = {
    "new": {
        "explanation": 1.0,
        "interactive_canvas": 0.8,
        "flashcard": 0.6,
        "multiple_choice": 0.4,
        "free_response": 0.2,
        "fill_blank": 0.3,
        "matching": 0.5,
        "problem_solving": 0.1,
    },
    "learning": {
        "multiple_choice": 0.9,
        "flashcard": 0.85,
        "fill_blank": 0.7,
        "matching": 0.6,
        "problem_solving": 0.5,
        "free_response": 0.4,
        "explanation": 0.5,
        "interactive_canvas": 0.5,
    },
    "review": {
        "flashcard": 1.0,
        "multiple_choice": 0.9,
        "fill_blank": 0.8,
        "problem_solving": 0.7,
        "free_response": 0.6,
        "matching": 0.5,
        "explanation": 0.2,
        "interactive_canvas": 0.4,
    },
    "mastery": {
        "problem_solving": 1.0,
        "free_response": 0.9,
        "interactive_canvas": 0.8,
        "fill_blank": 0.6,
        "multiple_choice": 0.5,
        "flashcard": 0.3,
        "matching": 0.4,
        "explanation": 0.1,
    },
}


@dataclass
class ModeScore:
    """Score breakdown for a candidate activity mode."""
    mode: str
    total_score: float
    historical_performance: float  # 30%
    pedagogical_fit: float  # 20%
    learner_preference: float  # 15%
    diversity_bonus: float  # 25%
    speed_adjustment: float  # 10%


@dataclass
class ModeSelectionResult:
    """Result of mode selection for an activity."""
    selected_mode: str
    scores: list[ModeScore]
    confidence: float


class ModeSelectionOptimizer:
    """
    Selects the best activity mode for a given context using 5 signals:
    1. Historical performance with this mode (30%)
    2. Pedagogical appropriateness for learning stage (20%)
    3. Learner memory preferences (15%)
    4. Mode diversity bonus (never same mode twice in a row) (25%)
    5. Speed/cram adjustment (10%)
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self._mode_history: dict[str, list[str]] = {}  # student_id -> recent modes
        self._mode_performance: dict[str, dict[str, list[float]]] = {}  # student_id -> mode -> scores

    def select_mode(
        self,
        student_id: str,
        learning_stage: str,
        speed_setting: str = "normal",  # cram | normal | thorough
        available_modes: Optional[list[str]] = None,
    ) -> ModeSelectionResult:
        """
        Select the best mode for the current activity.
        """
        if available_modes is None:
            available_modes = [
                "multiple_choice", "flashcard", "fill_blank",
                "free_response", "matching", "problem_solving",
                "explanation", "interactive_canvas",
            ]

        recent_modes = self._mode_history.get(student_id, [])
        mode_performance = self._mode_performance.get(student_id, {})

        scores = []
        for mode in available_modes:
            historical = self._score_historical_performance(mode, mode_performance)
            pedagogical = self._score_pedagogical_fit(mode, learning_stage)
            preference = self._score_learner_preference(mode, student_id)
            diversity = self._score_diversity(mode, recent_modes)
            speed_adj = self._score_speed_adjustment(mode, speed_setting)

            total = (
                0.30 * historical
                + 0.20 * pedagogical
                + 0.15 * preference
                + 0.25 * diversity
                + 0.10 * speed_adj
            )

            scores.append(ModeScore(
                mode=mode,
                total_score=round(total, 4),
                historical_performance=round(historical, 3),
                pedagogical_fit=round(pedagogical, 3),
                learner_preference=round(preference, 3),
                diversity_bonus=round(diversity, 3),
                speed_adjustment=round(speed_adj, 3),
            ))

        # Sort by total score
        scores.sort(key=lambda s: s.total_score, reverse=True)
        selected = scores[0].mode

        # Update history
        if student_id not in self._mode_history:
            self._mode_history[student_id] = []
        self._mode_history[student_id].append(selected)
        if len(self._mode_history[student_id]) > 20:
            self._mode_history[student_id] = self._mode_history[student_id][-20:]

        # Confidence based on score gap between top 2
        confidence = 0.5
        if len(scores) >= 2:
            gap = scores[0].total_score - scores[1].total_score
            confidence = min(0.95, 0.5 + gap * 5)

        return ModeSelectionResult(
            selected_mode=selected,
            scores=scores,
            confidence=round(confidence, 2),
        )

    def record_mode_performance(
        self, student_id: str, mode: str, accuracy: float
    ) -> None:
        """Record how well a student performed with a given mode."""
        if student_id not in self._mode_performance:
            self._mode_performance[student_id] = {}
        if mode not in self._mode_performance[student_id]:
            self._mode_performance[student_id][mode] = []

        self._mode_performance[student_id][mode].append(accuracy)
        # Keep last 30 entries per mode
        if len(self._mode_performance[student_id][mode]) > 30:
            self._mode_performance[student_id][mode] = self._mode_performance[student_id][mode][-30:]

    def _score_historical_performance(
        self, mode: str, mode_performance: dict[str, list[float]]
    ) -> float:
        """Score based on student's historical accuracy with this mode."""
        history = mode_performance.get(mode, [])
        if not history:
            return 0.5  # Unknown → neutral
        # Weighted average: recent performances count more
        weights = [1.0 + 0.1 * i for i in range(len(history))]
        weighted = sum(a * w for a, w in zip(history, weights))
        return weighted / sum(weights)

    def _score_pedagogical_fit(self, mode: str, learning_stage: str) -> float:
        """Score based on how appropriate the mode is for the learning stage."""
        stage_scores = STAGE_MODE_SCORES.get(learning_stage, STAGE_MODE_SCORES["learning"])
        return stage_scores.get(mode, 0.5)

    def _score_learner_preference(self, mode: str, student_id: str) -> float:
        """Score based on learner's stated preferences."""
        # This would integrate with the learning profile's preferred_activity_types
        # For now, return neutral — enhanced in personalization integration
        return 0.5

    def _score_diversity(self, mode: str, recent_modes: list[str]) -> float:
        """Score based on mode diversity (penalize recent repeats)."""
        if not recent_modes:
            return 1.0  # No history → full diversity

        # Count how many of the last 5 activities used this mode
        recent_5 = recent_modes[-5:]
        usage_count = recent_5.count(mode)

        if usage_count == 0:
            return 1.0  # Not used recently → great
        elif usage_count == 1:
            return 0.7
        elif usage_count == 2:
            return 0.4
        else:
            return 0.1  # Used too much → penalize

    def _score_speed_adjustment(self, mode: str, speed_setting: str) -> float:
        """Score based on speed/cram setting."""
        cram_modes = {"flashcard": 1.0, "multiple_choice": 0.9, "fill_blank": 0.7}
        thorough_modes = {"problem_solving": 1.0, "free_response": 0.9, "interactive_canvas": 0.8}

        if speed_setting == "cram":
            return cram_modes.get(mode, 0.5)
        elif speed_setting == "thorough":
            return thorough_modes.get(mode, 0.5)
        else:
            return 0.7  # Normal → slight preference for active modes
