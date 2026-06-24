"""
Tests for the Grademy Study Session Engine.
Run: python -m pytest tests/ -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from datetime import datetime, timedelta

from engine.session_engine import (
    StudySessionEngine, Student, StudyActivity, SessionResponse,
    SessionMode, ActivityType,
)
from engine.spaced_repetition import SpacedRepetitionEngine, ReviewQuality, SRItem
from engine.personalization import PersonalizationEngine, LearningProfile, EngagementState
from engine.cognitive_load import CognitiveLoadBalancer, ActivityLoad
from engine.adaptation import AdaptationEngine, AdaptationRecommendation
from engine.analytics import SessionAnalytics, SessionReport
from engine.gemini_integration import GeminiTutor


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def engine():
    """Create a fresh engine instance for each test."""
    return StudySessionEngine()


@pytest.fixture
def student():
    """Create a test student."""
    return Student(id="student-001", name="Test Student")


@pytest.fixture
def populated_engine(engine, student):
    """Engine with a registered student and some SR items."""
    engine.register_student(student)
    # Add some SR items
    engine.sr_engine.add_item(student.id, "algebra", difficulty=0.4)
    engine.sr_engine.add_item(student.id, "geometry", difficulty=0.6)
    engine.sr_engine.add_item(student.id, "calculus", difficulty=0.8)
    return engine


# ── Spaced Repetition Tests ──────────────────────────────────────────────────

class TestSpacedRepetition:

    def test_add_item(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        item = sr.add_item("s1", "math", difficulty=0.5)
        assert item.topic == "math"
        assert item.ease_factor == 2.5
        assert item.interval_hours == 24

    def test_update_item_correct(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        sr.add_item("s1", "math")
        item = sr.update_item("s1", "math", ReviewQuality.EASY, response_time_ms=5000)
        assert item.repetition_count == 1
        assert item.ease_factor >= 2.5
        assert item.correct_streak == 1

    def test_update_item_failed_resets(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        sr.add_item("s1", "math")
        # First pass
        sr.update_item("s1", "math", ReviewQuality.EASY)
        # Fail
        item = sr.update_item("s1", "math", ReviewQuality.AGAIN)
        assert item.repetition_count == 0
        assert item.correct_streak == 0

    def test_ease_factor_bounded(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        sr.add_item("s1", "math")
        # Many hard reviews shouldn't go below 1.3
        for _ in range(20):
            sr.update_item("s1", "math", ReviewQuality.HARD)
        item = sr.get_stats("s1")
        assert item["avg_ease_factor"] >= 1.3

    def test_interval_grows_with_success(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        sr.add_item("s1", "math")
        initial_interval = sr._items["s1"]["math"].interval_hours
        sr.update_item("s1", "math", ReviewQuality.EASY)
        sr.update_item("s1", "math", ReviewQuality.EASY)
        second_interval = sr._items["s1"]["math"].interval_hours
        assert second_interval > initial_interval

    def test_get_due_reviews(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        sr.add_item("s1", "math")
        # Force due by setting next_review to past
        sr._items["s1"]["math"].next_review_at = (
            datetime.utcnow() - timedelta(hours=1)
        ).isoformat()
        due = sr.get_due_reviews("s1")
        assert len(due) == 1
        assert due[0]["topic"] == "math"

    def test_predict_retention(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        sr.add_item("s1", "math")
        sr.update_item("s1", "math", ReviewQuality.EASY)
        retention = sr.predict_retention("s1", "math")
        assert 0.0 <= retention <= 1.0

    def test_get_schedule(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        sr.add_item("s1", "math")
        sr._items["s1"]["math"].next_review_at = (
            datetime.utcnow() + timedelta(days=1)
        ).isoformat()
        schedule = sr.get_schedule("s1", days_ahead=7)
        assert schedule.total_due == 1
        assert "math" in schedule.topics

    def test_get_stats(self):
        sr = SpacedRepetitionEngine({})
        sr.init_student("s1")
        sr.add_item("s1", "math")
        stats = sr.get_stats("s1")
        assert stats["total_items"] == 1
        assert stats["not_started"] == 1


# ── Personalization Tests ────────────────────────────────────────────────────

class TestPersonalization:

    def test_init_profile(self):
        p = PersonalizationEngine({})
        student = Student(id="s1", name="Alice")
        profile = p.init_profile(student)
        assert profile.learning_speed == 0.5
        assert len(profile.preferred_activity_types) > 0

    def test_record_response_updates_history(self):
        p = PersonalizationEngine({})
        student = Student(id="s1", name="Alice")
        p.init_profile(student)
        activity = StudyActivity(
            id="a1", type=ActivityType.MULTIPLE_CHOICE,
            topic="math", difficulty=0.5,
            cognitive_load=ActivityLoad(0.3, 1.0, 0.15, 0.45, 5),
            content={},
        )
        response = SessionResponse(
            activity_id="a1", student_id="s1",
            is_correct=True, response_time_ms=8000,
            confidence=0.8,
        )
        p.record_response(student, response, activity)
        assert len(p._history["s1"]) == 1

    def test_compute_engagement(self):
        p = PersonalizationEngine({})
        student = Student(id="s1", name="Alice")
        p.init_profile(student)
        # Create a mock session with responses
        from unittest.mock import MagicMock
        session = MagicMock()
        session.student_id = "s1"
        session.responses = [
            SessionResponse(
                activity_id="a1", student_id="s1",
                is_correct=True, response_time_ms=6000,
                confidence=0.9,
            )
            for _ in range(5)
        ]
        engagement = p.compute_engagement(session)
        assert 0.0 <= engagement <= 1.0

    def test_topic_strength_tracking(self):
        p = PersonalizationEngine({})
        student = Student(id="s1", name="Alice")
        profile = p.init_profile(student)
        activity = StudyActivity(
            id="a1", type=ActivityType.FLASHCARD,
            topic="biology", difficulty=0.5,
            cognitive_load=ActivityLoad(0.2, 1.0, 0.1, 0.3, 3),
            content={},
        )
        # Correct response
        response = SessionResponse(
            activity_id="a1", student_id="s1",
            is_correct=True, response_time_ms=5000,
            confidence=0.9,
        )
        p.record_response(student, response, activity)
        assert "biology" in profile.strong_topics

    def test_build_tutor_context(self):
        p = PersonalizationEngine({})
        student = Student(id="s1", name="Alice")
        p.init_profile(student)
        context = p.build_tutor_context(student)
        assert context["student_name"] == "Alice"
        assert "learning_speed" in context

    def test_momentum_score(self):
        p = PersonalizationEngine({})
        student = Student(id="s1", name="Alice")
        profile = p.init_profile(student)
        profile.last_session_at = datetime.utcnow().isoformat()
        profile.streak_days = 5
        score = p.get_momentum_score("s1")
        assert 0.0 < score <= 1.0


# ── Cognitive Load Tests ─────────────────────────────────────────────────────

class TestCognitiveLoad:

    def test_classify_load(self):
        cl = CognitiveLoadBalancer({})
        load = cl.classify_load(ActivityType.FLASHCARD, difficulty=0.3)
        assert isinstance(load, ActivityLoad)
        assert 0.0 <= load.total_load <= 1.0

    def test_exam_mode_increases_load(self):
        cl = CognitiveLoadBalancer({})
        practice = cl.classify_load(ActivityType.PROBLEM_SOLVING, 0.5, SessionMode.PRACTICE)
        exam = cl.classify_load(ActivityType.PROBLEM_SOLVING, 0.5, SessionMode.EXAM)
        assert exam.total_load > practice.total_load

    def test_estimate_current_load(self):
        cl = CognitiveLoadBalancer({})
        from unittest.mock import MagicMock
        session = MagicMock()
        session.activities = [
            MagicMock(cognitive_load=MagicMock(total_load=0.5))
            for _ in range(5)
        ]
        load = cl.estimate_current_load(session)
        assert 0.0 <= load <= 1.0

    def test_should_suggest_break(self):
        cl = CognitiveLoadBalancer({})
        from unittest.mock import MagicMock
        session = MagicMock()
        session.activities = [
            MagicMock(cognitive_load=MagicMock(total_load=0.9))
            for _ in range(10)
        ]
        session.responses = [MagicMock() for _ in range(10)]
        assert cl.should_suggest_break(session) is True

    def test_optimize_session_composition(self):
        cl = CognitiveLoadBalancer({})
        from unittest.mock import MagicMock
        activities = [
            MagicMock(cognitive_load=MagicMock(total_load=0.9)),
            MagicMock(cognitive_load=MagicMock(total_load=0.2)),
            MagicMock(cognitive_load=MagicMock(total_load=0.8)),
            MagicMock(cognitive_load=MagicMock(total_load=0.3)),
        ]
        optimized = cl.optimize_session_composition(activities, 0.6)
        assert len(optimized) == 4
        # First should be high, second low (interleaved)
        assert optimized[0].cognitive_load.total_load > optimized[1].cognitive_load.total_load


# ── Adaptation Tests ─────────────────────────────────────────────────────────

class TestAdaptation:

    def test_detect_stuck(self):
        adapt = AdaptationEngine({})
        from unittest.mock import MagicMock
        session = MagicMock()
        session.responses = [
            SessionResponse(
                activity_id="a1", student_id="s1",
                is_correct=False, response_time_ms=10000,
                confidence=0.3,
            )
            for _ in range(5)
        ]
        result = adapt.evaluate(session, MagicMock())
        assert result["struggling"] is True

    def test_detect_high_performance(self):
        adapt = AdaptationEngine({})
        from unittest.mock import MagicMock
        session = MagicMock()
        session.responses = [
            SessionResponse(
                activity_id="a1", student_id="s1",
                is_correct=True, response_time_ms=5000,
                confidence=0.9,
            )
            for _ in range(8)
        ]
        result = adapt.evaluate(session, MagicMock())
        assert result["increase_difficulty"] is True

    def test_detect_rushing(self):
        adapt = AdaptationEngine({"rushing_threshold_seconds": 2})
        from unittest.mock import MagicMock
        session = MagicMock()
        session.responses = [
            SessionResponse(
                activity_id="a1", student_id="s1",
                is_correct=False, response_time_ms=1000,
                confidence=0.2,
            )
            for _ in range(5)
        ]
        result = adapt.evaluate(session, MagicMock())
        # Should detect rushing or stuck
        assert result["reduce_difficulty"] or result["struggling"]


# ── Analytics Tests ──────────────────────────────────────────────────────────

class TestAnalytics:

    def test_compute_session_quality(self):
        analytics = SessionAnalytics({})
        from unittest.mock import MagicMock
        session = MagicMock()
        session.responses = [
            SessionResponse(
                activity_id="a1", student_id="s1",
                is_correct=True, response_time_ms=8000,
                confidence=0.8,
            )
            for _ in range(5)
        ]
        session.engagement_score = 0.8
        session.cognitive_load_avg = 0.5
        quality = analytics.compute_session_quality(session)
        assert 0.0 <= quality <= 100.0

    def test_generate_session_report(self):
        analytics = SessionAnalytics({})
        from unittest.mock import MagicMock
        session = MagicMock()
        session.id = "sess-001"
        session.student_id = "s1"
        session.mode = SessionMode.PRACTICE
        session.started_at = (datetime.utcnow() - timedelta(minutes=15)).isoformat()
        session.engagement_score = 0.75
        session.cognitive_load_avg = 0.5
        session.quality_score = 75.0
        session.responses = [
            SessionResponse(
                activity_id="a1", student_id="s1",
                is_correct=True, response_time_ms=7000,
                confidence=0.8,
            ),
            SessionResponse(
                activity_id="a2", student_id="s1",
                is_correct=False, response_time_ms=15000,
                confidence=0.4,
            ),
        ]
        session.activities = [
            StudyActivity(
                id="a1", type=ActivityType.MULTIPLE_CHOICE,
                topic="math", difficulty=0.5,
                cognitive_load=ActivityLoad(0.3, 1.0, 0.15, 0.45, 5),
                content={},
            ),
            StudyActivity(
                id="a2", type=ActivityType.FREE_RESPONSE,
                topic="math", difficulty=0.7,
                cognitive_load=ActivityLoad(0.55, 1.0, 0.21, 0.76, 8),
                content={},
            ),
        ]
        student = Student(id="s1", name="Alice")
        report = analytics.generate_session_report(session, student)
        assert report["student_name"] == "Alice"
        assert report["accuracy"] == 0.5
        assert "math" in report["topic_breakdown"]
        assert len(report["insights"]) > 0

    def test_trends(self):
        analytics = SessionAnalytics({})
        # Add some history
        analytics._history["s1"] = [
            {"session_id": f"s{i}", "quality_score": 60 + i * 5,
             "accuracy": 0.6 + i * 0.05, "engagement": 0.7, "timestamp": datetime.utcnow().isoformat()}
            for i in range(5)
        ]
        trends = analytics.get_trends("s1")
        assert "quality_score" in trends
        assert trends["quality_score"].trend == "improving"


# ── Gemini Integration Tests ─────────────────────────────────────────────────

class TestGeminiTutor:

    def test_mock_explanation(self):
        tutor = GeminiTutor({})
        activity = StudyActivity(
            id="a1", type=ActivityType.MULTIPLE_CHOICE,
            topic="algebra", difficulty=0.5,
            cognitive_load=ActivityLoad(0.3, 1.0, 0.15, 0.45, 5),
            content={},
        )
        context = {"student_name": "Alice", "weak_topics": ["algebra"]}
        result = tutor.explain(activity, context)
        assert "explanation" in result
        assert "examples" in result

    def test_mock_hint(self):
        tutor = GeminiTutor({})
        activity = StudyActivity(
            id="a1", type=ActivityType.PROBLEM_SOLVING,
            topic="calculus", difficulty=0.8,
            cognitive_load=ActivityLoad(0.7, 1.0, 0.24, 0.94, 10),
            content={},
        )
        context = {"student_name": "Bob"}
        hint = tutor.hint(activity, context)
        assert isinstance(hint, str)
        assert len(hint) > 0

    def test_mock_quiz(self):
        tutor = GeminiTutor({})
        context = {"student_name": "Alice"}
        quiz = tutor.generate_quiz("biology", context, count=3)
        assert len(quiz) == 3
        assert "question" in quiz[0]
        assert "options" in quiz[0]

    def test_mock_flashcards(self):
        tutor = GeminiTutor({})
        context = {"student_name": "Alice"}
        cards = tutor.generate_flashcards("history", context, count=5)
        assert len(cards) == 5
        assert "front" in cards[0]
        assert "back" in cards[0]

    def test_not_available_without_key(self):
        tutor = GeminiTutor({})
        assert tutor.is_available() is False


# ── Session Engine Integration Tests ─────────────────────────────────────────

class TestSessionEngine:

    def test_register_student(self, engine, student):
        result = engine.register_student(student)
        assert result.id == student.id
        assert engine.get_student(student.id) is not None

    def test_start_session(self, populated_engine, student):
        session = populated_engine.start_session(
            student.id, mode=SessionMode.PRACTICE, duration_minutes=10
        )
        assert session.id is not None
        assert session.student_id == student.id
        assert len(session.activities) > 0

    def test_start_session_unknown_student(self, engine):
        with pytest.raises(ValueError, match="not found"):
            engine.start_session("unknown")

    def test_submit_response(self, populated_engine, student):
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
        assert result["correct"] is True
        assert "engagement" in result
        assert "adaptation" in result

    def test_submit_response_unknown_session(self, engine):
        with pytest.raises(ValueError, match="not found"):
            engine.submit_response("unknown", None)

    def test_end_session(self, populated_engine, student):
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
        assert "quality_score" in report
        assert report["student_id"] == student.id

    def test_full_session_lifecycle(self, engine, student):
        """Test a complete session from start to finish."""
        engine.register_student(student)

        # Add SR items
        engine.sr_engine.add_item(student.id, "algebra")
        engine.sr_engine.add_item(student.id, "geometry")

        # Start session
        session = engine.start_session(
            student.id, mode=SessionMode.PRACTICE, duration_minutes=6
        )
        assert len(session.activities) > 0

        # Submit responses for each activity
        for i, activity in enumerate(session.activities):
            correct = i % 2 == 0  # Alternate correct/incorrect
            response = SessionResponse(
                activity_id=activity.id,
                student_id=student.id,
                is_correct=correct,
                response_time_ms=5000 + i * 2000,
                confidence=0.9 if correct else 0.3,
            )
            result = engine.submit_response(session.id, response)
            assert "adaptation" in result

        # End session
        report = engine.end_session(session.id)
        assert report["activities_completed"] == len(session.activities)
        assert 0.0 <= report["quality_score"] <= 100.0

    def test_interleaving(self, engine, student):
        """Test that topics get interleaved."""
        engine.register_student(student)
        for topic in ["math", "science", "history", "english", "art"]:
            engine.sr_engine.add_item(student.id, topic)
            # Force items to be due for review
            engine.sr_engine._items[student.id][topic].next_review_at = (
                datetime.utcnow() - timedelta(hours=1)
            ).isoformat()

        session = engine.start_session(student.id, duration_minutes=10)
        topics = [a.topic for a in session.activities]
        # Topics should not all be the same
        assert len(set(topics)) > 1

    def test_difficulty_adaptation(self, engine, student):
        """Test that difficulty adapts based on performance."""
        engine.register_student(student)
        engine.sr_engine.add_item(student.id, "test-topic")

        # Start session
        session = engine.start_session(student.id, duration_minutes=3)

        # Submit all correct — difficulty should increase
        for activity in session.activities:
            response = SessionResponse(
                activity_id=activity.id,
                student_id=student.id,
                is_correct=True,
                response_time_ms=3000,
                confidence=0.95,
            )
            engine.submit_response(session.id, response)

        # Check that performance tracking shows high accuracy
        perf = engine.personalization.recent_performance(student.id)
        assert perf is not None
        assert perf == 1.0  # All correct


# ── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
