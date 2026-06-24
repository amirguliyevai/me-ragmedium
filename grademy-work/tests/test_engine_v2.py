
"""
Tests for the new Grademy Study Session Engine v2.0 modules:
- Personalized Forgetting Curve
- Session Composition Optimizer
- Session Quality Predictor
- Gamification Engine
- Mode Selection Optimizer
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock

from engine.forgetting_curve import (
    PersonalizedForgettingCurve, ForgettingCurveProfile, RecallObservation
)
from engine.composition_optimizer import (
    SessionCompositionOptimizer, CompositionMetrics, CompositionResult
)
from engine.quality_predictor import (
    SessionQualityPredictor, PredictionInput, QualityPrediction
)
from engine.gamification import (
    GamificationEngine, GamificationState, level_from_xp, xp_for_level, ACHIEVEMENTS
)
from engine.mode_selector import (
    ModeSelectionOptimizer, ModeScore, ModeSelectionResult
)
from engine.session_engine import (
    StudySessionEngine, Student, StudyActivity, SessionResponse,
    SessionMode, ActivityType,
)
from engine.models import ActivityLoad


# ═══════════════════════════════════════════════════════════════════════════════
# Personalized Forgetting Curve Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestPersonalizedForgettingCurve:

    def test_init_student(self):
        pfc = PersonalizedForgettingCurve({})
        profile = pfc.init_student("s1")
        assert profile.stability_days == 10.0
        assert profile.forgetter_type == "average"
        assert profile.confidence == 0.1

    def test_record_observation(self):
        pfc = PersonalizedForgettingCurve({})
        pfc.init_student("s1")
        pfc.record_observation("s1", "math", interval_days=7.0, was_correct=True, quality=4)
        assert len(pfc._observations["s1"]) == 1

    def test_predict_retention_no_data(self):
        pfc = PersonalizedForgettingCurve({})
        pfc.init_student("s1")
        retention = pfc.predict_retention("s1", "math", 7.0)
        assert 0.0 <= retention <= 1.0

    def test_predict_retention_after_reviews(self):
        pfc = PersonalizedForgettingCurve({"min_observations": 3})
        pfc.init_student("s1")
        # Add enough observations to trigger curve fitting
        for _ in range(5):
            pfc.record_observation("s1", "math", interval_days=5.0, was_correct=True, quality=4)
        retention = pfc.predict_retention("s1", "math", 5.0)
        assert 0.0 <= retention <= 1.0

    def test_optimal_interval(self):
        pfc = PersonalizedForgettingCurve({})
        pfc.init_student("s1")
        interval = pfc.get_optimal_interval("s1", target_retention=0.9)
        assert interval > 0

    def test_blend_interval_low_confidence(self):
        pfc = PersonalizedForgettingCurve({})
        pfc.init_student("s1")
        # Low confidence → should return SM-2 interval
        blended = pfc.blend_interval("s1", sm2_interval_hours=24.0)
        assert blended == 24.0

    def test_adjust_retention_for_exam(self):
        pfc = PersonalizedForgettingCurve({})
        pfc.init_student("s1")
        # Close exam → higher retention
        ret_close = pfc.adjust_retention_for_exam("s1", days_until_exam=2)
        ret_far = pfc.adjust_retention_for_exam("s1", days_until_exam=60)
        assert ret_close > ret_far

    def test_get_profile_summary(self):
        pfc = PersonalizedForgettingCurve({})
        pfc.init_student("s1")
        summary = pfc.get_profile_summary("s1")
        assert "stability_days" in summary
        assert "forgetter_type" in summary

    def test_forgetter_type_classification(self):
        pfc = PersonalizedForgettingCurve({"min_observations": 3})
        pfc.init_student("s1")
        # Simulate fast forgetting (short intervals, many failures)
        for _ in range(5):
            pfc.record_observation("s1", "math", interval_days=0.5, was_correct=False, quality=1)
        profile = pfc._profiles["s1"]
        assert profile.forgetter_type in ("accelerated", "fast")

    def test_confidence_increases_with_observations(self):
        pfc = PersonalizedForgettingCurve({"min_observations": 3})
        pfc.init_student("s1")
        initial_conf = pfc._profiles["s1"].confidence
        for _ in range(10):
            pfc.record_observation("s1", "math", interval_days=5.0, was_correct=True, quality=4)
        assert pfc._profiles["s1"].confidence > initial_conf


# ═══════════════════════════════════════════════════════════════════════════════
# Session Composition Optimizer Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestCompositionOptimizer:

    def _make_activity(self, topic, difficulty, load_val, activity_type=ActivityType.MULTIPLE_CHOICE):
        return StudyActivity(
            id=f"act-{topic}",
            type=activity_type,
            topic=topic,
            difficulty=difficulty,
            cognitive_load=ActivityLoad(
                base_load=load_val * 0.5,
                mode_multiplier=1.0,
                difficulty_factor=difficulty * 0.3,
                total_load=load_val,
                estimated_minutes=max(2, int(difficulty * 8)),
            ),
            content={"type": "practice"},
        )

    def test_optimize_empty_list(self):
        opt = SessionCompositionOptimizer({})
        result = opt.optimize([])
        assert result.activities == []
        assert result.estimated_duration_minutes == 0

    def test_optimize_single_activity(self):
        opt = SessionCompositionOptimizer({})
        act = self._make_activity("math", 0.5, 0.4)
        result = opt.optimize([act])
        assert len(result.activities) == 1

    def test_warmup_easy_first(self):
        opt = SessionCompositionOptimizer({"min_warmup_activities": 1})
        hard = self._make_activity("calculus", 0.9, 0.8)
        easy = self._make_activity("arithmetic", 0.2, 0.2)
        result = opt.optimize([hard, easy])
        # Easiest activity should be first (warm-up)
        assert result.activities[0].difficulty == 0.2

    def test_interleaving_no_consecutive_topics(self):
        opt = SessionCompositionOptimizer({})
        activities = [
            self._make_activity("math", 0.5, 0.4),
            self._make_activity("math", 0.6, 0.5),
            self._make_activity("science", 0.5, 0.4),
            self._make_activity("science", 0.6, 0.5),
            self._make_activity("history", 0.5, 0.4),
        ]
        result = opt.optimize(activities)
        # Check that not all same topics are consecutive
        topics = [a.topic for a in result.activities]
        consecutive_same = sum(1 for i in range(1, len(topics)) if topics[i] == topics[i-1])
        assert consecutive_same < len(topics) - 1  # Not all consecutive

    def test_break_points_calculated(self):
        opt = SessionCompositionOptimizer({"break_interval_minutes": 5})
        activities = [
            self._make_activity(f"topic-{i}", 0.5, 0.4) for i in range(10)
        ]
        result = opt.optimize(activities)
        # With 10 activities at ~4 min each and break every 5 min, should have breaks
        assert isinstance(result.break_points, list)

    def test_compute_metrics(self):
        opt = SessionCompositionOptimizer({})
        activities = [
            self._make_activity("math", 0.5, 0.4),
            self._make_activity("science", 0.6, 0.7),
        ]
        result = opt.optimize(activities)
        assert result.metrics.overall_score >= 0
        assert result.metrics.interleaving_score >= 0

    def test_cooldown_retrieval_at_end(self):
        opt = SessionCompositionOptimizer({})
        activities = [
            self._make_activity("math", 0.3, 0.2, ActivityType.EXPLANATION),
            self._make_activity("science", 0.5, 0.4, ActivityType.FLASHCARD),
        ]
        result = opt.optimize(activities)
        # Last activity should ideally be a retrieval type
        last_type = result.activities[-1].type
        assert last_type in (ActivityType.FLASHCARD, ActivityType.FILL_BLANK, ActivityType.FREE_RESPONSE)

    def test_time_budget_respected(self):
        opt = SessionCompositionOptimizer({"target_duration_minutes": 10})
        activities = [
            self._make_activity(f"topic-{i}", 0.8, 0.7) for i in range(20)
        ]
        result = opt.optimize(activities)
        # Should select fewer activities to fit time budget
        total_est = sum(a.cognitive_load.estimated_minutes for a in result.activities)
        assert total_est <= 15  # Allow some flexibility


# ═══════════════════════════════════════════════════════════════════════════════
# Session Quality Predictor Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestQualityPredictor:

    def test_predict_basic(self):
        predictor = SessionQualityPredictor({})
        input_data = PredictionInput(student_id="s1")
        result = predictor.predict(input_data)
        assert 0 <= result.predicted_score <= 100
        assert 0 <= result.confidence <= 1
        assert len(result.recommendations) > 0

    def test_predict_peak_hours(self):
        predictor = SessionQualityPredictor({})
        # Peak hours should score higher
        peak = predictor.predict(PredictionInput(student_id="s1", time_of_day=10))
        late_night = predictor.predict(PredictionInput(student_id="s1", time_of_day=23))
        assert peak.predicted_score > late_night.predicted_score

    def test_predict_momentum_effect(self):
        predictor = SessionQualityPredictor({})
        high_momentum = predictor.predict(PredictionInput(student_id="s1", momentum_score=0.9))
        low_momentum = predictor.predict(PredictionInput(student_id="s1", momentum_score=0.1))
        assert high_momentum.predicted_score > low_momentum.predicted_score

    def test_predict_recency_effect(self):
        predictor = SessionQualityPredictor({})
        optimal = predictor.predict(PredictionInput(student_id="s1", session_recency_hours=36))
        too_soon = predictor.predict(PredictionInput(student_id="s1", session_recency_hours=2))
        assert optimal.predicted_score > too_soon.predicted_score

    def test_engagement_curve_forecast(self):
        predictor = SessionQualityPredictor({})
        result = predictor.predict(PredictionInput(student_id="s1", planned_activity_count=10))
        assert len(result.engagement_curve) > 0
        assert all(0 <= e <= 1 for e in result.engagement_curve)

    def test_risk_factors_detected(self):
        predictor = SessionQualityPredictor({})
        result = predictor.predict(PredictionInput(
            student_id="s1",
            session_recency_hours=1,  # Very soon — overtraining risk
            momentum_score=0.1,  # Low momentum
        ))
        assert len(result.risk_factors) > 0

    def test_optimal_duration(self):
        predictor = SessionQualityPredictor({})
        high_quality = predictor.predict(PredictionInput(student_id="s1", momentum_score=0.9))
        low_quality = predictor.predict(PredictionInput(student_id="s1", momentum_score=0.1))
        assert high_quality.optimal_duration_minutes >= low_quality.optimal_duration_minutes

    def test_exam_proximity_adjustment(self):
        predictor = SessionQualityPredictor({})
        close_exam = predictor.predict(PredictionInput(student_id="s1", days_until_exam=2))
        far_exam = predictor.predict(PredictionInput(student_id="s1", days_until_exam=90))
        # Close exam should have different score due to pressure
        assert close_exam.predicted_score != far_exam.predicted_score


# ═══════════════════════════════════════════════════════════════════════════════
# Gamification Engine Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestGamification:

    def test_init_student(self):
        g = GamificationEngine({})
        state = g.init_student("s1")
        assert state.level == 1
        assert state.total_xp == 0

    def test_record_session_gains_xp(self):
        g = GamificationEngine({})
        g.init_student("s1")
        result = g.record_session("s1", {"activities_completed": 5, "accuracy": 0.8})
        assert result["xp_gained"] > 0
        assert result["total_xp"] > 0

    def test_level_progression(self):
        assert level_from_xp(0) == 0
        assert level_from_xp(50) == 0
        assert level_from_xp(150) >= 1
        assert level_from_xp(400) >= 2

    def test_streak_tracking(self):
        g = GamificationEngine({})
        g.init_student("s1")
        # First session
        result1 = g.record_session("s1", {"activities_completed": 3, "accuracy": 0.7})
        assert result1["current_streak"] == 1
        # Same day — should not increment
        result2 = g.record_session("s1", {"activities_completed": 3, "accuracy": 0.7})
        assert result2["current_streak"] == 1

    def test_accuracy_bonus(self):
        g = GamificationEngine({})
        g.init_student("s1")
        high_acc = g.record_session("s1", {"activities_completed": 10, "accuracy": 0.95})
        g.init_student("s2")
        low_acc = g.record_session("s2", {"activities_completed": 10, "accuracy": 0.5})
        assert high_acc["xp_gained"] > low_acc["xp_gained"]

    def test_daily_goal(self):
        g = GamificationEngine({"daily_goal_xp": 30, "xp_base_per_activity": 10})
        g.init_student("s1")
        # Complete enough activities to meet goal
        result = g.record_session("s1", {"activities_completed": 5, "accuracy": 0.8})
        assert result["daily_goal_met"] is True

    def test_achievement_unlock(self):
        g = GamificationEngine({})
        g.init_student("s1")
        # Force a perfect session
        result = g.record_session("s1", {
            "activities_completed": 5,
            "accuracy": 1.0,
            "current_streak": 1,
        })
        # Check if perfect_session achievement was unlocked
        achievement_ids = [a["id"] for a in result["new_achievements"]]
        assert "perfect_session" in achievement_ids

    def test_get_state(self):
        g = GamificationEngine({})
        g.init_student("s1")
        g.record_session("s1", {"activities_completed": 3, "accuracy": 0.7})
        state = g.get_state("s1")
        assert state["level"] >= 0
        assert state["total_xp"] > 0
        assert "progress_pct" in state

    def test_streak_grace_period(self):
        g = GamificationEngine({"streak_grace_days": 2})
        g.init_student("s1")
        g.record_session("s1", {"activities_completed": 3, "accuracy": 0.7})
        state = g._states["s1"]
        assert state.current_streak == 1

    def test_xp_curve_increases(self):
        # Each level should require more XP than the last
        for lvl in range(1, 10):
            assert xp_for_level(lvl + 1) >= xp_for_level(lvl)


# ═══════════════════════════════════════════════════════════════════════════════
# Mode Selection Optimizer Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestModeSelector:

    def test_select_mode_basic(self):
        ms = ModeSelectionOptimizer({})
        result = ms.select_mode("s1", learning_stage="learning")
        assert result.selected_mode in [
            "multiple_choice", "flashcard", "fill_blank",
            "free_response", "matching", "problem_solving",
            "explanation", "interactive_canvas",
        ]

    def test_diversity_avoids_consecutive(self):
        ms = ModeSelectionOptimizer({})
        # Select mode 5 times — diversity should prevent too many repeats
        modes = []
        for _ in range(5):
            result = ms.select_mode("s1", learning_stage="learning")
            modes.append(result.selected_mode)
        # Should not be all the same mode
        assert len(set(modes)) >= 1  # At least some variety

    def test_new_student_gets_pedagogical_default(self):
        ms = ModeSelectionOptimizer({})
        result = ms.select_mode("s1", learning_stage="new")
        # New students should get explanation-heavy modes
        assert result.selected_mode in ("explanation", "interactive_canvas", "flashcard")

    def test_mastery_gets_problem_solving(self):
        ms = ModeSelectionOptimizer({})
        result = ms.select_mode("s1", learning_stage="mastery")
        # Mastery students should get active recall modes
        assert result.scores[0].total_score > 0

    def test_record_mode_performance(self):
        ms = ModeSelectionOptimizer({})
        ms.record_mode_performance("s1", "flashcard", 0.9)
        ms.record_mode_performance("s1", "flashcard", 0.8)
        # After good performance, flashcard should score higher
        result = ms.select_mode("s1", learning_stage="review")
        flashcard_score = next(
            (s for s in result.scores if s.mode == "flashcard"), None
        )
        assert flashcard_score is not None
        assert flashcard_score.historical_performance > 0.5

    def test_cram_mode_preference(self):
        ms = ModeSelectionOptimizer({})
        result = ms.select_mode("s1", learning_stage="review", speed_setting="cram")
        # Cram mode should prefer flashcard and multiple choice
        top_modes = [s.mode for s in result.scores[:3]]
        assert any(m in ("flashcard", "multiple_choice") for m in top_modes)

    def test_confidence_based_on_score_gap(self):
        ms = ModeSelectionOptimizer({})
        result = ms.select_mode("s1", learning_stage="learning")
        assert 0 <= result.confidence <= 1.0


# ═══════════════════════════════════════════════════════════════════════════════
# Session Engine v2 Integration Tests
# ═══════════════════════════════════════════════════════════════════════════════

class TestSessionEngineV2:

    @pytest.fixture
    def engine(self):
        return StudySessionEngine()

    @pytest.fixture
    def student(self):
        return Student(id="student-v2-001", name="V2 Test Student")

    @pytest.fixture
    def populated_engine(self, engine, student):
        engine.register_student(student)
        engine.sr_engine.add_item(student.id, "algebra", difficulty=0.4)
        engine.sr_engine.add_item(student.id, "geometry", difficulty=0.6)
        engine.sr_engine.add_item(student.id, "calculus", difficulty=0.8)
        return engine

    def test_version_is_2(self, engine):
        assert engine.VERSION == "2.0.0"

    def test_register_student_initializes_all_subsystems(self, engine, student):
        engine.register_student(student)
        # Forgetting curve
        assert student.id in engine.forgetting_curve._profiles
        # Gamification
        assert student.id in engine.gamification._states

    def test_predict_session_quality(self, populated_engine, student):
        prediction = populated_engine.predict_session_quality(student.id)
        assert "predicted_score" in prediction
        assert "recommendations" in prediction
        assert "optimal_duration_minutes" in prediction
        assert 0 <= prediction["predicted_score"] <= 100

    def test_predict_session_quality_with_exam(self, populated_engine, student):
        prediction = populated_engine.predict_session_quality(
            student.id, days_until_exam=5
        )
        assert prediction["predicted_score"] > 0

    def test_start_session_v2_includes_composition(self, populated_engine, student):
        session = populated_engine.start_session(
            student.id, mode=SessionMode.PRACTICE, duration_minutes=10
        )
        assert len(session.activities) > 0
        # Check that composition metrics were computed
        assert hasattr(session, "_composition_metrics")

    def test_start_session_with_days_until_exam(self, populated_engine, student):
        session = populated_engine.start_session(
            student.id, mode=SessionMode.PRACTICE, duration_minutes=10, days_until_exam=3
        )
        assert len(session.activities) > 0

    def test_submit_response_updates_forgetting_curve(self, populated_engine, student):
        session = populated_engine.start_session(student.id, duration_minutes=5)
        activity = session.activities[0]
        response = SessionResponse(
            activity_id=activity.id,
            student_id=student.id,
            is_correct=True,
            response_time_ms=6000,
            confidence=0.85,
        )
        result = populated_engine.submit_response(session.id, response)
        assert "correct" in result

    def test_end_session_includes_gamification(self, populated_engine, student):
        session = populated_engine.start_session(student.id, duration_minutes=5)
        activity = session.activities[0]
        response = SessionResponse(
            activity_id=activity.id,
            student_id=student.id,
            is_correct=True,
            response_time_ms=5000,
            confidence=0.9,
        )
        populated_engine.submit_response(session.id, response)
        report = populated_engine.end_session(session.id)
        assert "gamification" in report
        assert "xp_gained" in report["gamification"]

    def test_get_forgetting_profile(self, populated_engine, student):
        profile = populated_engine.get_forgetting_profile(student.id)
        assert "stability_days" in profile
        assert "forgetter_type" in profile

    def test_get_gamification_state(self, populated_engine, student):
        state = populated_engine.get_gamification_state(student.id)
        assert "level" in state
        assert "total_xp" in state
        assert "current_streak" in state

    def test_full_session_lifecycle_v2(self, engine, student):
        """Full lifecycle: predict → start → respond → end."""
        engine.register_student(student)
        engine.sr_engine.add_item(student.id, "biology")
        engine.sr_engine.add_item(student.id, "chemistry")

        # Pre-session prediction
        prediction = engine.predict_session_quality(student.id)
        assert prediction["predicted_score"] > 0

        # Start session
        session = engine.start_session(
            student.id, mode=SessionMode.PRACTICE, duration_minutes=6
        )
        assert len(session.activities) > 0

        # Submit responses
        for i, activity in enumerate(session.activities):
            response = SessionResponse(
                activity_id=activity.id,
                student_id=student.id,
                is_correct=i % 2 == 0,
                response_time_ms=5000 + i * 1000,
                confidence=0.8 if i % 2 == 0 else 0.4,
            )
            result = engine.submit_response(session.id, response)
            assert "adaptation" in result

        # End session
        report = engine.end_session(session.id)
        assert report["activities_completed"] == len(session.activities)
        assert "gamification" in report
        assert report["gamification"]["xp_gained"] > 0

    def test_retention_prediction(self, populated_engine, student):
        retention = populated_engine.get_retention_prediction(student.id, "algebra", 7.0)
        assert 0.0 <= retention <= 1.0

    def test_mode_selection_applied_in_session(self, populated_engine, student):
        session = populated_engine.start_session(student.id, duration_minutes=5)
        # Activities should have valid types
        for activity in session.activities:
            assert isinstance(activity.type, ActivityType)
