"""
Personalized Forgetting Curve — Per-student memory stability estimation.
Uses Maximum Likelihood Estimation (MLE) to fit individual forgetting curves
and blends SM-2 intervals with personalized optimal intervals.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class RecallObservation:
    """A single observed recall event."""
    topic: str
    interval_days: float
    was_correct: bool
    quality: int
    timestamp: str = ""
    mode: str = "practice"


@dataclass
class ForgettingCurveProfile:
    """A student's personalized forgetting curve parameters."""
    stability_days: float = 10.0  # S — memory stability in days
    decay_rate: float = 0.1  # λ = 1/S
    forgetter_type: str = "average"  # accelerated/fast/average/slow/exceptional
    confidence: float = 0.1  # How confident we are in the estimate
    observation_count: int = 0
    last_updated: str = ""
    target_retention: float = 0.9


class PersonalizedForgettingCurve:
    """
    Estimates per-student memory stability using MLE and blends SM-2
    intervals with personalized optimal intervals.
    
    Model: R(t) = e^(-λt) where λ = 1/S (S = memory stability in days)
    
    Classification:
    - accelerated: λ ≥ 0.4 (S < 2.5 days)
    - fast: λ ≥ 0.25 (S < 4 days)
    - average: λ ≥ 0.12 (S < 8.3 days)
    - slow: λ ≥ 0.07 (S < 14.3 days)
    - exceptional: λ < 0.07 (S ≥ 14.3 days)
    """

    FORGETTER_THRESHOLDS = [
        (0.4, "accelerated"),
        (0.25, "fast"),
        (0.12, "average"),
        (0.07, "slow"),
        (0.0, "exceptional"),
    ]

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.min_observations = config.get("min_observations", 5)
        self.default_stability = config.get("default_stability_days", 10.0)
        self.blend_weight = config.get("blend_weight", 0.5)
        self._profiles: dict[str, ForgettingCurveProfile] = {}
        self._observations: dict[str, list[RecallObservation]] = {}

    def init_student(self, student_id: str) -> ForgettingCurveProfile:
        """Initialize a student's forgetting curve profile."""
        if student_id not in self._profiles:
            self._profiles[student_id] = ForgettingCurveProfile(
                stability_days=self.default_stability,
                decay_rate=1.0 / self.default_stability,
                confidence=0.1,
            )
            self._observations[student_id] = []
        return self._profiles[student_id]

    def record_observation(
        self,
        student_id: str,
        topic: str,
        interval_days: float,
        was_correct: bool,
        quality: int = 3,
        mode: str = "practice",
    ) -> None:
        """Record a recall observation for a student."""
        self.init_student(student_id)
        obs = RecallObservation(
            topic=topic,
            interval_days=interval_days,
            was_correct=was_correct,
            quality=quality,
            timestamp=datetime.utcnow().isoformat(),
            mode=mode,
        )
        self._observations[student_id].append(obs)

        # Re-fit the curve if enough observations
        if len(self._observations[student_id]) >= self.min_observations:
            self._fit_curve(student_id)

    def predict_retention(self, student_id: str, topic: str, interval_days: float) -> float:
        """
        Predict retention probability for a given topic and interval.
        R(t) = e^(-λt)
        """
        profile = self._profiles.get(student_id)
        if not profile:
            return 0.5

        return math.exp(-profile.decay_rate * interval_days)

    def get_optimal_interval(self, student_id: str, target_retention: float = 0.9) -> float:
        """
        Calculate optimal review interval for a target retention rate.
        t_optimal = -S * ln(target_retention)
        """
        profile = self._profiles.get(student_id)
        if not profile or profile.decay_rate == 0:
            return 7.0  # Default 7 days

        # t = -S * ln(R)
        optimal_days = -profile.stability_days * math.log(max(target_retention, 0.01))
        return max(0.5, optimal_days)

    def blend_interval(
        self,
        student_id: str,
        sm2_interval_hours: float,
        target_retention: float = 0.9,
    ) -> float:
        """
        Blend SM-2 interval with personalized optimal interval.
        Weight depends on confidence in the personalized estimate.
        """
        profile = self._profiles.get(student_id)
        if not profile or profile.confidence < 0.3:
            return sm2_interval_hours  # Not enough data, use SM-2

        personalized_hours = self.get_optimal_interval(student_id, target_retention) * 24
        blended = (
            self.blend_weight * personalized_hours * profile.confidence
            + (1 - self.blend_weight * profile.confidence) * sm2_interval_hours
        )
        return max(1.0, blended)

    def adjust_retention_for_exam(
        self, student_id: str, days_until_exam: Optional[int] = None
    ) -> float:
        """Adjust target retention based on exam proximity."""
        profile = self._profiles.get(student_id)
        if not profile:
            return 0.9

        if days_until_exam is None:
            return profile.target_retention

        # Closer exam → higher target retention
        if days_until_exam <= 3:
            return 0.98
        elif days_until_exam <= 7:
            return 0.95
        elif days_until_exam <= 14:
            return 0.92
        elif days_until_exam <= 30:
            return 0.90
        else:
            return 0.90

    def get_profile_summary(self, student_id: str) -> dict[str, Any]:
        """Get a summary of the student's forgetting curve profile."""
        profile = self._profiles.get(student_id)
        if not profile:
            return {"status": "uninitialized"}

        return {
            "stability_days": round(profile.stability_days, 1),
            "decay_rate": round(profile.decay_rate, 4),
            "forgetter_type": profile.forgetter_type,
            "confidence": round(profile.confidence, 2),
            "observation_count": profile.observation_count,
            "optimal_interval_days": round(self.get_optimal_interval(student_id), 1),
            "target_retention": profile.target_retention,
        }

    def _fit_curve(self, student_id: str) -> None:
        """
        Fit the forgetting curve using Maximum Likelihood Estimation.
        Binary search for S (stability) that maximizes log-likelihood of observed recalls.
        """
        observations = self._observations[student_id]
        if len(observations) < self.min_observations:
            return

        # Binary search for optimal stability S
        s_low, s_high = 0.5, 100.0
        best_s = self.default_stability
        best_ll = float("-inf")

        for _ in range(50):  # 50 iterations of binary search
            s_mid = (s_low + s_high) / 2
            ll_mid = self._log_likelihood(observations, s_mid)
            ll_mid_plus = self._log_likelihood(observations, s_mid + 0.01)

            if ll_mid > best_ll:
                best_ll = ll_mid
                best_s = s_mid

            if ll_mid_plus > ll_mid:
                s_low = s_mid
            else:
                s_high = s_mid

        # Set the fitted parameters
        profile = self._profiles[student_id]
        profile.stability_days = best_s
        profile.decay_rate = 1.0 / best_s
        profile.observation_count = len(observations)
        profile.last_updated = datetime.utcnow().isoformat()

        # Classify forgetter type
        for threshold, ftype in self.FORGETTER_THRESHOLDS:
            if profile.decay_rate >= threshold:
                profile.forgetter_type = ftype
                break

        # Confidence increases with observations (logarithmic)
        profile.confidence = min(0.9, 0.1 + 0.15 * math.log(len(observations)))

        # Accelerated forgetters get a retention boost
        if profile.forgetter_type in ("accelerated", "fast"):
            profile.target_retention = min(0.98, profile.target_retention + 0.03)

    @staticmethod
    def _log_likelihood(observations: list[RecallObservation], stability: float) -> float:
        """Compute log-likelihood for a given stability value."""
        if stability <= 0:
            return float("-inf")

        ll = 0.0
        decay_rate = 1.0 / stability

        for obs in observations:
            if obs.interval_days <= 0:
                continue

            # P(correct) = e^(-λt)
            p_correct = math.exp(-decay_rate * obs.interval_days)
            p_correct = max(0.001, min(0.999, p_correct))  # Avoid log(0)

            if obs.was_correct:
                ll += math.log(p_correct)
            else:
                ll += math.log(1 - p_correct)

        return ll
