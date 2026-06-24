"""
Session Analytics — Quality scoring, insights generation, historical comparison.
Produces meaningful feedback on study session effectiveness.
"""

from __future__ import annotations

import math
from datetime import datetime
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class SessionReport:
    """Complete report for a single study session."""
    session_id: str
    student_id: str
    duration_minutes: float
    activities_completed: int
    activities_total: int
    accuracy: float
    avg_response_time_ms: float
    engagement_score: float
    cognitive_load_avg: float
    quality_score: float  # 0-100 composite
    insights: list[str]
    recommendations: list[str]
    topic_breakdown: dict[str, dict[str, Any]]


@dataclass
class TrendAnalysis:
    """Cross-session trend data."""
    metric: str
    values: list[float]
    trend: str  # improving, declining, stable
    change_pct: float


class SessionAnalytics:
    """
    Analyzes study sessions to produce actionable insights and track progress.
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.weights = config.get("quality_weights", {
            "accuracy": 0.35,
            "engagement": 0.25,
            "cognitive_efficiency": 0.20,
            "response_time": 0.20,
        })
        self._history: dict[str, list[dict[str, Any]]] = {}  # student_id -> reports

    def compute_session_quality(self, session: Any) -> float:
        """
        Compute composite session quality score (0-100).
        Weighted combination of accuracy, engagement, cognitive efficiency, and response time.
        """
        responses = session.responses
        if not responses:
            return 0.0

        # Accuracy (0-1)
        accuracy = sum(1 for r in responses if r.is_correct) / len(responses)

        # Engagement (0-1)
        engagement = session.engagement_score

        # Cognitive efficiency (0-1): optimal load is 0.5-0.7
        load = session.cognitive_load_avg
        if load < 0.3:
            cognitive_eff = 0.6  # Too easy
        elif load <= 0.7:
            cognitive_eff = 1.0  # Optimal
        elif load <= 0.85:
            cognitive_eff = 0.7  # High but manageable
        else:
            cognitive_eff = 0.4  # Overload

        # Response time score (0-1): 5-15s is ideal
        avg_time = sum(r.response_time_ms for r in responses) / len(responses)
        if avg_time < 3000:
            time_score = 0.7  # Possibly rushing
        elif avg_time <= 15000:
            time_score = 1.0
        elif avg_time <= 25000:
            time_score = 0.7
        else:
            time_score = 0.4  # Too slow

        score = (
            self.weights["accuracy"] * accuracy
            + self.weights["engagement"] * engagement
            + self.weights["cognitive_efficiency"] * cognitive_eff
            + self.weights["response_time"] * time_score
        )

        return round(score * 100, 1)

    def generate_session_report(
        self, session: Any, student: Any
    ) -> dict[str, Any]:
        """Generate a comprehensive session report."""
        responses = session.responses
        now = datetime.utcnow()
        started = datetime.fromisoformat(session.started_at)
        duration = (now - started).total_seconds() / 60

        # Basic metrics
        accuracy = (
            sum(1 for r in responses if r.is_correct) / len(responses)
            if responses else 0.0
        )
        avg_time = (
            sum(r.response_time_ms for r in responses) / len(responses)
            if responses else 0.0
        )

        # Topic breakdown
        topic_stats: dict[str, dict[str, Any]] = {}
        for r in responses:
            # Find the activity to get the topic
            activity = next(
                (a for a in session.activities if a.id == r.activity_id), None
            )
            topic = activity.topic if activity else "unknown"
            if topic not in topic_stats:
                topic_stats[topic] = {"correct": 0, "total": 0, "times_ms": []}
            topic_stats[topic]["total"] += 1
            if r.is_correct:
                topic_stats[topic]["correct"] += 1
            topic_stats[topic]["times_ms"].append(r.response_time_ms)

        # Compute per-topic accuracy
        for topic, stats in topic_stats.items():
            stats["accuracy"] = round(
                stats["correct"] / max(stats["total"], 1), 2
            )
            stats["avg_time_ms"] = round(
                sum(stats["times_ms"]) / max(len(stats["times_ms"]), 1)
            )
            del stats["times_ms"]  # Remove raw data

        # Generate insights
        insights = self._generate_insights(session, accuracy, avg_time)

        # Generate recommendations
        recommendations = self._generate_recommendations(
            session, accuracy, student
        )

        report = {
            "session_id": session.id,
            "student_id": session.student_id,
            "student_name": student.name,
            "mode": session.mode.value,
            "duration_minutes": round(duration, 1),
            "activities_completed": len(responses),
            "activities_total": len(session.activities),
            "accuracy": round(accuracy, 3),
            "avg_response_time_ms": round(avg_time),
            "engagement_score": round(session.engagement_score, 3),
            "cognitive_load_avg": round(session.cognitive_load_avg, 3),
            "quality_score": round(session.quality_score, 1),
            "insights": insights,
            "recommendations": recommendations,
            "topic_breakdown": topic_stats,
            "timestamp": now.isoformat(),
        }

        # Store in history
        sid = session.student_id
        if sid not in self._history:
            self._history[sid] = []
        self._history[sid].append({
            "session_id": session.id,
            "quality_score": report["quality_score"],
            "accuracy": report["accuracy"],
            "engagement": report["engagement_score"],
            "timestamp": report["timestamp"],
        })

        return report

    def _generate_insights(
        self, session: Any, accuracy: float, avg_time: float
    ) -> list[str]:
        """Generate human-readable insights about the session."""
        insights: list[str] = []

        if accuracy >= 0.9:
            insights.append("Excellent accuracy! You're mastering this material.")
        elif accuracy >= 0.75:
            insights.append("Good accuracy. Keep practicing to strengthen recall.")
        elif accuracy >= 0.6:
            insights.append("Moderate accuracy. Review the topics you missed.")
        else:
            insights.append("Low accuracy — consider revisiting the fundamentals.")

        if avg_time < 5000:
            insights.append("Fast responses suggest strong fluency.")
        elif avg_time > 20000:
            insights.append("Slow responses — try to build speed with practice.")

        if session.engagement_score > 0.8:
            insights.append("High engagement throughout the session!")
        elif session.engagement_score < 0.4:
            insights.append("Engagement dropped — shorter sessions may help.")

        if session.cognitive_load_avg > 0.8:
            insights.append("High cognitive load detected. Take more breaks.")
        elif session.cognitive_load_avg < 0.3:
            insights.append("Low challenge level — try harder material.")

        return insights

    def _generate_recommendations(
        self, session: Any, accuracy: float, student: Any
    ) -> list[str]:
        """Generate actionable recommendations for the student."""
        recs: list[str] = []

        if accuracy < 0.6:
            recs.append("Review incorrect items before your next session.")
            recs.append("Try the explanation mode for topics you're struggling with.")

        if session.engagement_score < 0.5:
            recs.append("Try mixing in different activity types to stay engaged.")

        profile = getattr(student, "profile", None)
        if profile and profile.weak_topics:
            recs.append(
                f"Focus on: {', '.join(profile.weak_topics[:3])}"
            )

        if not recs:
            recs.append("Great work! Continue with regular practice.")

        return recs

    def get_trends(self, student_id: str, last_n: int = 10) -> dict[str, TrendAnalysis]:
        """Analyze trends across recent sessions."""
        history = self._history.get(student_id, [])[-last_n:]
        if len(history) < 2:
            return {}

        metrics = ["quality_score", "accuracy", "engagement"]
        trends = {}

        for metric in metrics:
            values = [h[metric] for h in history]
            # Simple linear regression slope
            n = len(values)
            x_mean = (n - 1) / 2
            y_mean = sum(values) / n
            numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
            denominator = sum((i - x_mean) ** 2 for i in range(n))

            if denominator == 0:
                slope = 0
            else:
                slope = numerator / denominator

            # Determine trend direction
            if abs(slope) < 0.01:
                direction = "stable"
            elif slope > 0:
                direction = "improving"
            else:
                direction = "declining"

            change_pct = (values[-1] - values[0]) / max(abs(values[0]), 0.01) * 100

            trends[metric] = TrendAnalysis(
                metric=metric,
                values=values,
                trend=direction,
                change_pct=round(change_pct, 1),
            )

        return trends
