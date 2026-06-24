"""
Session Quality Predictor — Pre-session quality forecasting.
Uses a 7-factor model to predict session quality before it starts,
allowing proactive calibration of duration, difficulty, and mode.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class QualityPrediction:
    """Predicted session quality metrics."""
    predicted_score: float  # 0-100
    engagement_curve: list[float]  # Minute-by-minute engagement forecast
    confidence: float  # 0-1
    recommendations: list[str]
    optimal_duration_minutes: int
    optimal_difficulty: float  # 0-1
    risk_factors: list[str]  # Factors that may reduce quality


@dataclass
class PredictionInput:
    """Inputs for session quality prediction."""
    student_id: str
    time_of_day: int = 12  # 0-23
    momentum_score: float = 0.5  # 0-1
    session_recency_hours: float = 48  # Hours since last session
    planned_activity_count: int = 10
    avg_activity_load: float = 0.5  # 0-1
    forgetting_stability_days: float = 10.0
    days_until_exam: Optional[int] = None
    total_sessions_completed: int = 0
    current_streak: int = 0
    recent_accuracy: float = 0.7
    recent_engagement: float = 0.6


class SessionQualityPredictor:
    """
    Predicts session quality BEFORE it starts using 7 factors:
    1. Time of day (circadian rhythm)
    2. Session momentum (streak + recency)
    3. Session recency (optimal gap vs overtraining/forgetting)
    4. Planned cognitive load
    5. Forgetting curve profile
    6. Exam pressure
    7. Profile maturity
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config

    def predict(self, input_data: PredictionInput) -> QualityPrediction:
        """Predict session quality and generate recommendations."""
        scores = {}
        risk_factors = []

        # Factor 1: Time of day (circadian rhythm)
        scores["time_of_day"] = self._score_time_of_day(input_data.time_of_day)

        # Factor 2: Momentum
        scores["momentum"] = input_data.momentum_score
        if input_data.momentum_score < 0.3:
            risk_factors.append("Low momentum — consider a shorter session to rebuild habit")

        # Factor 3: Session recency
        scores["recency"] = self._score_recency(input_data.session_recency_hours)
        if input_data.session_recency_hours < 12:
            risk_factors.append("Last session was very soon — risk of overtraining")
        elif input_data.session_recency_hours > 336:  # 14 days
            risk_factors.append("Long gap since last session — consider easier warm-up")

        # Factor 4: Planned cognitive load
        scores["cognitive_load"] = self._score_planned_load(input_data.avg_activity_load)
        if input_data.avg_activity_load > 0.8:
            risk_factors.append("High planned cognitive load — consider reducing or adding breaks")

        # Factor 5: Forgetting curve
        scores["forgetting"] = self._score_forgetting(input_data.forgetting_stability_days)

        # Factor 6: Exam pressure
        scores["exam_pressure"] = self._score_exam_pressure(input_data.days_until_exam)

        # Factor 7: Profile maturity
        scores["maturity"] = self._score_maturity(
            input_data.total_sessions_completed, input_data.current_streak
        )

        # Weighted composite
        weights = {
            "time_of_day": 0.10,
            "momentum": 0.20,
            "recency": 0.15,
            "cognitive_load": 0.15,
            "forgetting": 0.10,
            "exam_pressure": 0.10,
            "maturity": 0.20,
        }

        predicted_score = sum(scores[k] * weights[k] for k in scores) * 100
        predicted_score = max(0.0, min(100.0, predicted_score))

        # Generate engagement curve forecast
        engagement_curve = self._forecast_engagement(
            predicted_score, input_data.planned_activity_count, input_data.avg_activity_load
        )

        # Generate recommendations
        recommendations = self._generate_recommendations(scores, risk_factors, input_data)

        # Optimal duration
        optimal_duration = self._optimal_duration(predicted_score, input_data)

        # Optimal difficulty
        optimal_difficulty = self._optimal_difficulty(input_data)

        # Confidence based on data availability
        confidence = self._compute_confidence(input_data)

        return QualityPrediction(
            predicted_score=round(predicted_score, 1),
            engagement_curve=[round(e, 3) for e in engagement_curve],
            confidence=round(confidence, 2),
            recommendations=recommendations,
            optimal_duration_minutes=optimal_duration,
            optimal_difficulty=round(optimal_difficulty, 2),
            risk_factors=risk_factors,
        )

    def _score_time_of_day(self, hour: int) -> float:
        """Score based on circadian rhythm. Peak at 10am, moderate penalty for late night."""
        if 9 <= hour <= 11:
            return 1.0  # Peak performance
        elif 12 <= hour <= 14:
            return 0.9
        elif 15 <= hour <= 17:
            return 0.85
        elif 7 <= hour <= 8:
            return 0.8
        elif 18 <= hour <= 20:
            return 0.7
        elif 21 <= hour <= 23:
            return 0.5  # Evening fatigue
        else:
            return 0.3  # Late night / very early

    def _score_recency(self, hours_since: float) -> float:
        """Score based on gap since last session. Optimal: 1-2 days."""
        days = hours_since / 24
        if 1 <= days <= 2:
            return 1.0  # Optimal spacing
        elif 0.5 <= days < 1:
            return 0.8  # Slightly soon
        elif 2 < days <= 5:
            return 0.85  # Good spacing
        elif 5 < days <= 14:
            return 0.7  # Getting rusty
        elif days < 0.5:
            return 0.4  # Overtraining risk
        else:
            return 0.5  # Long gap

    def _score_planned_load(self, avg_load: float) -> float:
        """Score based on average cognitive load of planned activities."""
        if 0.4 <= avg_load <= 0.7:
            return 1.0  # Optimal zone
        elif 0.3 <= avg_load < 0.4:
            return 0.8  # Slightly easy
        elif 0.7 < avg_load <= 0.85:
            return 0.75  # High but manageable
        elif avg_load > 0.85:
            return 0.5  # Overload risk
        else:
            return 0.6  # Too easy

    def _score_forgetting(self, stability_days: float) -> float:
        """Score based on memory stability."""
        if stability_days >= 14:
            return 1.0  # Excellent retention
        elif stability_days >= 7:
            return 0.85
        elif stability_days >= 4:
            return 0.7
        elif stability_days >= 2:
            return 0.55
        else:
            return 0.4  # Rapid forgetting

    def _score_exam_pressure(self, days_until_exam: Optional[int]) -> float:
        """Score based on exam proximity."""
        if days_until_exam is None:
            return 0.7  # No exam pressure
        if days_until_exam <= 3:
            return 0.6  # High pressure, may affect performance
        elif days_until_exam <= 7:
            return 0.75
        elif days_until_exam <= 30:
            return 0.85
        else:
            return 0.9  # No immediate pressure

    def _score_maturity(self, total_sessions: int, streak: int) -> float:
        """Score based on student's experience level."""
        session_score = min(1.0, total_sessions / 50)
        streak_score = min(1.0, streak / 30)
        return 0.5 * session_score + 0.5 * streak_score

    def _forecast_engagement(
        self, quality_score: float, activity_count: int, avg_load: float
    ) -> list[float]:
        """Forecast minute-by-minute engagement for the session."""
        minutes = max(5, min(activity_count * 3, 60))
        base_engagement = quality_score / 100

        curve = []
        for minute in range(minutes):
            # Initial warm-up bump
            if minute < 3:
                engagement = base_engagement * 0.9
            # Mid-session dip (around 40-60% mark)
            elif 0.4 * minutes <= minute <= 0.6 * minutes:
                engagement = base_engagement * (0.85 - avg_load * 0.1)
            # End-of-session fatigue
            elif minute > 0.8 * minutes:
                fatigue = (minute - 0.8 * minutes) / (0.2 * minutes) * 0.15
                engagement = base_engagement - fatigue
            else:
                engagement = base_engagement

            curve.append(max(0.1, min(1.0, engagement)))

        return curve

    def _generate_recommendations(
        self, scores: dict[str, float], risk_factors: list[str], input_data: PredictionInput
    ) -> list[str]:
        """Generate actionable recommendations based on prediction factors."""
        recs = []

        if scores.get("time_of_day", 1.0) < 0.6:
            recs.append("Consider studying during peak hours (9-11 AM) for better focus.")

        if scores.get("recency", 1.0) < 0.5:
            recs.append("Start with a warm-up activity — it's been a while since the last session.")

        if scores.get("cognitive_load", 1.0) < 0.6:
            recs.append("Reduce planned activities or add more breaks to prevent overload.")

        if scores.get("momentum", 1.0) < 0.4:
            recs.append("Low momentum — try a short, easy session to rebuild the habit.")

        if input_data.recent_accuracy < 0.5:
            recs.append("Recent accuracy is low — review fundamentals before new material.")

        if not recs:
            recs.append("Conditions look good! Push for a focused session.")

        return recs

    def _optimal_duration(self, quality_score: float, input_data: PredictionInput) -> int:
        """Determine optimal session duration in minutes."""
        base = 25  # Pomodoro default

        if quality_score > 80:
            base = 45  # High quality → longer session
        elif quality_score > 60:
            base = 30
        elif quality_score < 40:
            base = 15  # Low predicted quality → shorter

        # Adjust for fatigue
        if input_data.avg_activity_load > 0.7:
            base = min(base, 25)

        # Adjust for momentum
        if input_data.momentum_score > 0.8:
            base = min(base + 10, 60)

        return base

    def _optimal_difficulty(self, input_data: PredictionInput) -> float:
        """Determine optimal starting difficulty."""
        base = 0.5

        # Adjust for recent accuracy
        if input_data.recent_accuracy > 0.85:
            base = 0.65  # Push harder
        elif input_data.recent_accuracy < 0.6:
            base = 0.4  # Build confidence

        # Adjust for momentum
        if input_data.momentum_score > 0.7:
            base = min(0.7, base + 0.05)

        return base

    def _compute_confidence(self, input_data: PredictionInput) -> float:
        """Compute confidence in the prediction."""
        # More data = more confident
        base = 0.3
        session_boost = min(0.3, input_data.total_sessions_completed / 100)
        streak_boost = min(0.2, input_data.current_streak / 30)
        return min(0.95, base + session_boost + streak_boost)
