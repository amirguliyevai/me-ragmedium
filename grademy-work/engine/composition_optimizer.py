"""
Session Composition Optimizer — Cognitive-science activity ordering.
Applies interleaving, warm-up/cool-down, and cognitive load wave patterns
to produce an optimal activity sequence.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class CompositionMetrics:
    """Quality metrics for a session composition."""
    interleaving_score: float = 0.0  # Topic diversity in sequence
    load_balance_score: float = 0.0  # How well load alternates
    spacing_score: float = 0.0  # Even distribution of review types
    mode_diversity_score: float = 0.0  # Variety of activity types
    warmup_cooldown_score: float = 0.0  # Easy start, retrieval finish
    overall_score: float = 0.0  # Weighted composite (0-100)


@dataclass
class CompositionResult:
    """Result of session composition optimization."""
    activities: list[Any]
    metrics: CompositionMetrics
    break_points: list[int]  # Indices where breaks should be inserted
    estimated_duration_minutes: int


class SessionCompositionOptimizer:
    """
    Optimizes the ordering of study activities based on cognitive science:
    1. Warm-up: Start with an easy, familiar activity
    2. Interleaving: Round-robin across topics (avoid blocking)
    3. Cognitive Load Wave: Alternate high-load and low-load activities
    4. Cool-down: End with retrieval practice
    5. Break Points: Insert breaks every 15-20 minutes for long sessions
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.break_interval_minutes = config.get("break_interval_minutes", 18)
        self.min_warmup_activities = config.get("min_warmup_activities", 1)
        self.target_duration_minutes = config.get("target_duration_minutes", 30)

    def optimize(
        self,
        activities: list[Any],
        target_duration_minutes: Optional[int] = None,
    ) -> CompositionResult:
        """
        Optimize a list of activities for a study session.
        Returns reordered activities with quality metrics.
        """
        if not activities:
            return CompositionResult(
                activities=[],
                metrics=CompositionMetrics(),
                break_points=[],
                estimated_duration_minutes=0,
            )

        if target_duration_minutes:
            self.target_duration_minutes = target_duration_minutes

        # Step 1: Score and select activities fitting time budget
        selected = self._select_activities(activities)

        # Step 2: Apply warm-up structure (easy start)
        selected = self._apply_warmup(selected)

        # Step 3: Interleave topics (round-robin)
        selected = self._interleave_topics(selected)

        # Step 4: Balance cognitive load in wave pattern
        selected = self._balance_load_wave(selected)

        # Step 5: Apply cool-down (retrieval practice at end)
        selected = self._apply_cooldown(selected)

        # Step 6: Calculate break points
        break_points = self._calculate_break_points(selected)

        # Step 7: Compute quality metrics
        metrics = self._compute_metrics(selected)

        estimated_duration = self._estimate_duration(selected)

        return CompositionResult(
            activities=selected,
            metrics=metrics,
            break_points=break_points,
            estimated_duration_minutes=estimated_duration,
        )

    def _select_activities(self, activities: list[Any]) -> list[Any]:
        """Select activities that fit within the time budget."""
        if not activities:
            return []

        selected = []
        total_minutes = 0

        # Sort by priority (review > weak > new)
        def priority(a):
            content = getattr(a, "content", {}) or {}
            atype = content.get("type", "practice")
            if atype == "review":
                return 0
            elif atype == "weak_area":
                return 1
            else:
                return 2

        sorted_acts = sorted(activities, key=priority)

        for activity in sorted_acts:
            est_minutes = self._estimate_activity_minutes(activity)
            # Allow the first activity even if it slightly exceeds budget
            if total_minutes == 0 or total_minutes + est_minutes <= self.target_duration_minutes * 1.2:
                selected.append(activity)
                total_minutes += est_minutes

        return selected

    def _apply_warmup(self, activities: list[Any]) -> list[Any]:
        """Move easier activities to the start for warm-up."""
        if len(activities) <= 1:
            return activities

        # Find the easiest activity and move it to the start
        easiest_idx = min(
            range(len(activities)),
            key=lambda i: getattr(activities[i], "difficulty", 0.5)
        )
        result = list(activities)
        if easiest_idx != 0:
            result[0], result[easiest_idx] = result[easiest_idx], result[0]
        return result

    def _interleave_topics(self, activities: list[Any]) -> list[Any]:
        """Round-robin across topics to avoid consecutive same-topic activities."""
        if len(activities) <= 3:
            return activities

        from collections import defaultdict

        by_topic: dict[str, list[Any]] = defaultdict(list)
        for a in activities:
            by_topic[getattr(a, "topic", "general")].append(a)

        result = []
        topics = list(by_topic.keys())
        random.shuffle(topics)

        while any(by_topic[t] for t in topics):
            for topic in topics:
                if by_topic[topic]:
                    result.append(by_topic[topic].pop(0))

        return result

    def _balance_load_wave(self, activities: list[Any]) -> list[Any]:
        """
        Reorder to create a high→low→high→low cognitive load wave.
        This prevents sustained high-load fatigue.
        """
        if len(activities) <= 3:
            return activities

        def get_load(a):
            cl = getattr(a, "cognitive_load", None)
            return getattr(cl, "total_load", 0.5) if cl else 0.5

        # Separate into high and low load
        high_load = [a for a in activities if get_load(a) > 0.5]
        low_load = [a for a in activities if get_load(a) <= 0.5]

        # Interleave: high, low, high, low...
        result = []
        hi, li = 0, 0

        while hi < len(high_load) or li < len(low_load):
            if hi < len(high_load):
                result.append(high_load[hi])
                hi += 1
            if li < len(low_load):
                result.append(low_load[li])
                li += 1

        return result

    def _apply_cooldown(self, activities: list[Any]) -> list[Any]:
        """Ensure the last activity is a retrieval practice (not passive review)."""
        if len(activities) <= 2:
            return activities

        # Find a flashcard or practice activity for the end
        retrieval_types = {"flashcard", "fill_blank", "free_response"}
        last = activities[-1]
        last_type = getattr(last, "type", None)
        last_type_val = last_type.value if hasattr(last_type, "value") else str(last_type)

        if last_type_val not in retrieval_types:
            # Find a retrieval activity and swap it to the end
            for i, a in enumerate(activities[:-1]):
                atype = getattr(a, "type", None)
                atype_val = atype.value if hasattr(atype, "value") else str(atype)
                if atype_val in retrieval_types:
                    activities[i], activities[-1] = activities[-1], activities[i]
                    break

        return activities

    def _calculate_break_points(self, activities: list[Any]) -> list[int]:
        """Calculate where to insert break recommendations."""
        if not activities:
            return []

        break_points = []
        accumulated_minutes = 0

        for i, activity in enumerate(activities):
            est_minutes = self._estimate_activity_minutes(activity)
            accumulated_minutes += est_minutes

            if accumulated_minutes >= self.break_interval_minutes:
                break_points.append(i + 1)
                accumulated_minutes = 0

        return break_points

    def _estimate_activity_minutes(self, activity: Any) -> int:
        """Estimate the duration of an activity in minutes."""
        cl = getattr(activity, "cognitive_load", None)
        if cl and hasattr(cl, "estimated_minutes"):
            return cl.estimated_minutes
        return 3  # Default 3 minutes

    def _estimate_duration(self, activities: list[Any]) -> int:
        """Estimate total session duration in minutes."""
        return sum(self._estimate_activity_minutes(a) for a in activities)

    def _compute_metrics(self, activities: list[Any]) -> CompositionMetrics:
        """Compute quality metrics for the composition."""
        if not activities:
            return CompositionMetrics()

        # Interleaving score: how many consecutive same-topic pairs exist
        topics = [getattr(a, "topic", "general") for a in activities]
        consecutive_same = sum(1 for i in range(1, len(topics)) if topics[i] == topics[i - 1])
        interleaving = 1.0 - consecutive_same / max(len(topics) - 1, 1)

        # Load balance score: how well load alternates
        loads = []
        for a in activities:
            cl = getattr(a, "cognitive_load", None)
            loads.append(getattr(cl, "total_load", 0.5) if cl else 0.5)

        load_switches = sum(
            1 for i in range(1, len(loads))
            if (loads[i] > 0.5) != (loads[i - 1] > 0.5)
        )
        load_balance = load_switches / max(len(loads) - 1, 1)

        # Mode diversity score
        modes = set()
        for a in activities:
            atype = getattr(a, "type", None)
            modes.add(atype.value if hasattr(atype, "value") else str(atype))
        mode_diversity = len(modes) / max(len(activities), 1)

        # Warm-up/cool-down score
        warmup_cooldown = 0.5  # Base
        if activities:
            first_load = loads[0]
            last_load = loads[-1]
            if first_load < 0.5:
                warmup_cooldown += 0.25  # Good warm-up
            if last_load > 0.4:
                warmup_cooldown += 0.25  # Good retrieval finish

        # Overall composite
        overall = (
            25 * interleaving
            + 25 * load_balance
            + 15 * mode_diversity
            + 15 * warmup_cooldown
            + 20 * min(1.0, len(set(topics)) / max(len(activities) * 0.3, 1))
        )

        return CompositionMetrics(
            interleaving_score=round(interleaving, 3),
            load_balance_score=round(load_balance, 3),
            spacing_score=round(interleaving * 0.8, 3),  # Proxy for spacing
            mode_diversity_score=round(mode_diversity, 3),
            warmup_cooldown_score=round(warmup_cooldown, 3),
            overall_score=round(overall, 1),
        )
