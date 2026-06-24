"""
Real-Time Adaptation Engine — Detects patterns and recommends immediate changes.
Monitors for: engagement decline, stuck/rushing behavior, overload, momentum shifts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class AdaptationRecommendation:
    """A single adaptation recommendation for the session."""
    action: str  # reduce_difficulty, increase_difficulty, suggest_break, switch_mode, offer_explanation, continue
    reason: str
    confidence: float  # 0-1 how confident we are
    details: dict[str, Any] = field(default_factory=dict)


class AdaptationEngine:
    """
    Real-time adaptation engine that monitors session state and provides
    immediate recommendations to improve learning effectiveness.
    
    Detects:
    - Engagement decline (boredom/disengagement)
    - Stuck pattern (consecutive failures)
    - Rushing pattern (too fast, low confidence)
    - Cognitive overload
    - High performance (opportunity to increase difficulty)
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.engagement_drop_threshold = config.get("engagement_drop_threshold", 0.15)
        self.stuck_threshold_failures = config.get("stuck_threshold_failures", 3)
        self.rushing_threshold_seconds = config.get("rushing_threshold_seconds", 2)
        self.overload_consecutive_high = config.get("overload_consecutive_high", 5)

    def evaluate(self, session: Any, student: Any) -> dict[str, Any]:
        """
        Evaluate the current session state and return adaptation signals.
        Called after every response submission.
        """
        recommendations: list[AdaptationRecommendation] = []

        # 1. Check for stuck pattern
        stuck_rec = self._check_stuck(session)
        if stuck_rec:
            recommendations.append(stuck_rec)

        # 2. Check for rushing
        rushing_rec = self._check_rushing(session)
        if rushing_rec:
            recommendations.append(rushing_rec)

        # 3. Check engagement decline
        engagement_rec = self._check_engagement(session)
        if engagement_rec:
            recommendations.append(engagement_rec)

        # 4. Check for overload
        overload_rec = self._check_overload(session)
        if overload_rec:
            recommendations.append(overload_rec)

        # 5. Check for high performance (opportunity)
        performance_rec = self._check_high_performance(session)
        if performance_rec:
            recommendations.append(performance_rec)

        # Determine primary recommendation
        primary = self._select_primary(recommendations)

        return {
            "reduce_difficulty": primary.action == "reduce_difficulty" if primary else False,
            "increase_difficulty": primary.action == "increase_difficulty" if primary else False,
            "suggest_break": primary.action == "suggest_break" if primary else False,
            "switch_mode": primary.action == "switch_mode" if primary else False,
            "struggling": primary.action == "offer_explanation" if primary else False,
            "recommendations": [
                {"action": r.action, "reason": r.reason, "confidence": r.confidence}
                for r in recommendations
            ],
            "primary": primary.action if primary else "continue",
        }

    def _check_stuck(self, session: Any) -> Optional[AdaptationRecommendation]:
        """Detect consecutive failures (stuck pattern)."""
        responses = session.responses[-self.stuck_threshold_failures * 2:]
        if len(responses) < self.stuck_threshold_failures:
            return None

        recent = responses[-self.stuck_threshold_failures:]
        if all(not r.is_correct for r in recent):
            return AdaptationRecommendation(
                action="offer_explanation",
                reason=f"Student failed {self.stuck_threshold_failures} consecutive items",
                confidence=0.9,
                details={"consecutive_failures": self.stuck_threshold_failures},
            )
        return None

    def _check_rushing(self, session: Any) -> Optional[AdaptationRecommendation]:
        """Detect rushing (very fast responses with low correctness)."""
        responses = session.responses[-5:]
        if len(responses) < 3:
            return None

        fast_count = sum(
            1 for r in responses
            if r.response_time_ms < self.rushing_threshold_seconds * 1000
        )
        if fast_count >= 3:
            accuracy = sum(1 for r in responses if r.is_correct) / len(responses)
            if accuracy < 0.5:
                return AdaptationRecommendation(
                    action="reduce_difficulty",
                    reason="Student is rushing with low accuracy",
                    confidence=0.75,
                    details={
                        "fast_responses": fast_count,
                        "accuracy": round(accuracy, 2),
                    },
                )
        return None

    def _check_engagement(self, session: Any) -> Optional[AdaptationRecommendation]:
        """Detect engagement decline."""
        if len(session.responses) < 5:
            return None

        # Compare first half vs second half engagement signals
        mid = len(session.responses) // 2
        first_half = session.responses[:mid]
        second_half = session.responses[mid:]

        first_accuracy = sum(1 for r in first_half if r.is_correct) / max(len(first_half), 1)
        second_accuracy = sum(1 for r in second_half if r.is_correct) / max(len(second_half), 1)

        first_avg_time = sum(r.response_time_ms for r in first_half) / max(len(first_half), 1)
        second_avg_time = sum(r.response_time_ms for r in second_half) / max(len(second_half), 1)

        # Declining accuracy + increasing time = disengagement
        accuracy_drop = first_accuracy - second_accuracy
        time_increase = (second_avg_time - first_avg_time) / max(first_avg_time, 1)

        if accuracy_drop > self.engagement_drop_threshold or time_increase > 0.5:
            return AdaptationRecommendation(
                action="switch_mode",
                reason="Engagement declining — switch activity type",
                confidence=min(0.9, accuracy_drop + time_increase * 0.3),
                details={
                    "accuracy_drop": round(accuracy_drop, 3),
                    "time_increase_pct": round(time_increase * 100, 1),
                },
            )
        return None

    def _check_overload(self, session: Any) -> Optional[AdaptationRecommendation]:
        """Detect cognitive overload."""
        if len(session.responses) < self.overload_consecutive_high:
            return None

        # Check if recent activities have high cognitive load
        recent_loads = [
            a.cognitive_load.total_load
            for a in session.activities[-self.overload_consecutive_high:]
        ]
        if recent_loads and all(l > 0.7 for l in recent_loads):
            return AdaptationRecommendation(
                action="suggest_break",
                reason=f"{self.overload_consecutive_high} consecutive high-load activities",
                confidence=0.8,
                details={"avg_load": round(sum(recent_loads) / len(recent_loads), 3)},
            )
        return None

    def _check_high_performance(self, session: Any) -> Optional[AdaptationRecommendation]:
        """Detect sustained high performance (opportunity to level up)."""
        responses = session.responses[-8:]
        if len(responses) < 5:
            return None

        accuracy = sum(1 for r in responses if r.is_correct) / len(responses)
        avg_time = sum(r.response_time_ms for r in responses) / len(responses)
        avg_confidence = sum(r.confidence for r in responses) / len(responses)

        if accuracy >= 0.85 and avg_time < 10000 and avg_confidence > 0.7:
            return AdaptationRecommendation(
                action="increase_difficulty",
                reason="Sustained high performance — ready for harder content",
                confidence=min(0.95, accuracy),
                details={
                    "accuracy": round(accuracy, 3),
                    "avg_time_ms": round(avg_time),
                    "avg_confidence": round(avg_confidence, 2),
                },
            )
        return None

    def _select_primary(
        self, recommendations: list[AdaptationRecommendation]
    ) -> Optional[AdaptationRecommendation]:
        """Select the highest-priority recommendation."""
        if not recommendations:
            return None

        # Priority order
        priority = {
            "offer_explanation": 5,   # Most urgent — student is stuck
            "suggest_break": 4,        # Prevent burnout
            "reduce_difficulty": 3,    # Help student recover
            "switch_mode": 2,          # Change pace
            "increase_difficulty": 1,  # Opportunity (least urgent)
        }

        recommendations.sort(
            key=lambda r: (priority.get(r.action, 0), r.confidence),
            reverse=True,
        )
        return recommendations[0]
