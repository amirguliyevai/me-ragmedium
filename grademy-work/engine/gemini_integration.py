"""
Gemini AI Integration — Content generation, explanations, and personalized prompts.
Provides the AI tutor's "brain" via Google's Gemini API.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class TutorPrompt:
    """Structured prompt for the AI tutor."""
    system: str
    context: dict[str, Any]
    activity: dict[str, Any]
    instruction: str


class GeminiTutor:
    """
    Interface to Google's Gemini AI for the Grademy tutor.
    Handles:
    - Content generation (questions, flashcards, quizzes)
    - Explanation generation (wrong answers)
    - Progressive hints
    - Personalized prompt building
    """

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.model = config.get("model", "gemini-2.0-flash")
        self.temperature = config.get("temperature", 0.7)
        self.max_tokens = config.get("max_tokens", 1024)
        self.safety_level = config.get("safety_level", "moderate")
        self._api_key = os.environ.get("GEMINI_API_KEY", "")
        self._initialized = bool(self._api_key)

    def is_available(self) -> bool:
        """Check if the Gemini API is configured."""
        return self._initialized

    def explain(self, activity: Any, context: dict[str, Any]) -> dict[str, Any]:
        """
        Generate an explanation for a wrong answer.
        Returns structured explanation with examples.
        """
        prompt_data = self._build_explanation_prompt(activity, context)
        full_text = prompt_data.system + "\n\n" + prompt_data.instruction

        if self._initialized:
            response = self._call_api(full_text)
        else:
            response = self._mock_explanation(activity, context)

        return {
            "explanation": response.get("text", ""),
            "examples": response.get("examples", []),
            "related_topics": response.get("related_topics", []),
            "confidence": 0.85,
        }

    def hint(self, activity: Any, context: dict[str, Any]) -> str:
        """Generate a progressive hint for the current activity."""
        prompt_data = self._build_hint_prompt(activity, context)
        full_text = prompt_data.system + "\n\n" + prompt_data.instruction

        if self._initialized:
            response = self._call_api(full_text)
            return response.get("text", "Think about the key concept here...")
        else:
            return self._mock_hint(activity, context)

    def generate_quiz(
        self, topic: str, context: dict[str, Any], count: int = 5
    ) -> list[dict[str, Any]]:
        """Generate a quiz for a given topic."""
        prompt_data = self._build_quiz_prompt(topic, context, count)
        full_text = prompt_data.system + "\n\n" + prompt_data.instruction

        if self._initialized:
            response = self._call_api(full_text)
            return response.get("questions", [])
        else:
            return self._mock_quiz(topic, count)

    def generate_flashcards(
        self, topic: str, context: dict[str, Any], count: int = 10
    ) -> list[dict[str, str]]:
        """Generate flashcards for a topic."""
        if self._initialized:
            prompt_text = f"Generate {count} flashcards for '{topic}'. Return JSON array with 'front' and 'back' fields."
            response = self._call_api(prompt_text)
            return response.get("flashcards", [])
        else:
            return self._mock_flashcards(topic, count)

    # ── Prompt Builders ─────────────────────────────────────────────────────

    def _build_explanation_prompt(
        self, activity: Any, context: dict[str, Any]
    ) -> TutorPrompt:
        topic = getattr(activity, "topic", "unknown")
        difficulty = getattr(activity, "difficulty", 0.5)
        student_name = context.get("student_name", "Student")
        weak_topics = context.get("weak_topics", [])
        strong_topics = context.get("strong_topics", [])
        learning_speed = context.get("learning_speed", 0.5)
        current_engagement = context.get("current_engagement", 0.5)
        recent_accuracy = context.get("recent_accuracy", 0.5)
        avg_response_time_ms = context.get("avg_response_time_ms", 10000)

        # Build a rich, personalized system prompt
        system = (
            f"You are a warm, encouraging AI tutor for {student_name}. "
            f"Explain concepts clearly with examples. Use a friendly, conversational tone. "
        )

        # Adapt to learning speed
        if learning_speed > 0.7:
            system += "Use concise explanations — this student prefers quick, dense information. "
        elif learning_speed < 0.3:
            system += "Use step-by-step explanations with lots of examples — this student benefits from thorough breakdowns. "

        # Adapt to current state
        if current_engagement < 0.4:
            system += "The student seems disengaged. Be extra encouraging and find a fun angle. "
        if recent_accuracy and recent_accuracy < 0.5:
            system += "The student has been struggling recently. Be patient and emphasize small wins. "

        # Context about strengths/weaknesses
        if weak_topics:
            system += f"Areas to reinforce: {', '.join(weak_topics[:3])}. "
        if strong_topics:
            system += f"Strengths to reference: {', '.join(strong_topics[:3])}. "

        # Build adaptive instruction
        instruction_parts = [
            f"The student got a question wrong about '{topic}'.",
            f"Explain why their answer was incorrect in a supportive way.",
            f"Provide the correct answer with a clear explanation.",
        ]

        # Adjust detail level based on difficulty
        if difficulty > 0.7:
            instruction_parts.append("This is advanced material — go deep but stay clear.")
        else:
            instruction_parts.append("Keep it concise (under 150 words) and encouraging.")

        # Add response-time awareness
        if avg_response_time_ms > 20000:
            instruction_parts.append("The student took a while to respond — they might benefit from a mnemonic or memory trick.")

        instruction = " ".join(instruction_parts)

        return TutorPrompt(
            system=system,
            context=context,
            activity={
                "topic": topic,
                "difficulty": difficulty,
                "type": activity.type.value if hasattr(activity.type, "value") else str(activity.type),
            },
            instruction=instruction,
        )

    def _build_hint_prompt(
        self, activity: Any, context: dict[str, Any]
    ) -> TutorPrompt:
        topic = getattr(activity, "topic", "unknown")
        difficulty = getattr(activity, "difficulty", 0.5)
        student_name = context.get("student_name", "the student")
        learning_speed = context.get("learning_speed", 0.5)
        current_engagement = context.get("current_engagement", 0.5)

        system = f"You are a helpful, patient tutor. Give progressive hints for {student_name}. "

        if learning_speed > 0.7:
            system += "Give slightly more direct hints — this student learns quickly. "
        elif learning_speed < 0.3:
            system += "Give very gentle, step-by-step nudges — this student needs more scaffolding. "

        if current_engagement < 0.4:
            system += "The student seems frustrated. Be encouraging and make the hint feel like a small win. "

        return TutorPrompt(
            system=system,
            context=context,
            activity={"topic": topic, "difficulty": difficulty},
            instruction=(
                f"Give a hint for this question about '{topic}'. "
                f"Don't reveal the answer — just nudge them in the right direction. "
                f"Keep it to 1-2 sentences. "
                f"Difficulty level: {difficulty:.0%}."
            ),
        )

    def _build_quiz_prompt(
        self, topic: str, context: dict[str, Any], count: int
    ) -> TutorPrompt:
        return TutorPrompt(
            system=f"You are a quiz generator for {context.get('student_name', 'a student')}.",
            context=context,
            activity={"topic": topic},
            instruction=(
                f"Generate {count} multiple-choice questions about '{topic}'. "
                f"Return a JSON array with 'question', 'options' (array of 4), "
                f"'correct_index' (0-3), and 'explanation' fields."
            ),
        )

    # ── API Call ────────────────────────────────────────────────────────────

    def _call_api(self, prompt_text: str) -> dict[str, Any]:
        """
        Call the Gemini API. Uses the Google Generative AI SDK if available,
        falls back to direct HTTP REST call, then to mock on failure.
        """
        # Try the official SDK first
        try:
            import google.generativeai as genai
            client = genai.GenerativeModel(self.model)
            response = client.generate_content(
                prompt_text,
                generation_config=genai.GenerationConfig(
                    temperature=self.temperature,
                    max_output_tokens=self.max_tokens,
                ),
            )
            text = response.text if hasattr(response, "text") else str(response)
            return self._parse_response(text)
        except ImportError:
            pass  # SDK not available; try direct HTTP
        except Exception as e:
            # SDK error (quota, network, etc.) — fall through to HTTP or mock
            pass

        # Direct HTTP REST fallback
        if self._api_key:
            try:
                import urllib.request
                import urllib.error

                url = (
                    f"https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{self.model}:generateContent?key={self._api_key}"
                )
                payload = json.dumps({
                    "contents": [{"parts": [{"text": prompt_text}]}],
                    "generationConfig": {
                        "temperature": self.temperature,
                        "maxOutputTokens": self.max_tokens,
                    },
                }).encode("utf-8")

                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))

                # Parse Gemini response structure
                candidates = data.get("candidates", [])
                if candidates:
                    content = candidates[0].get("content", {})
                    parts = content.get("parts", [])
                    text = "".join(p.get("text", "") for p in parts)
                    if text:
                        return self._parse_response(text)

                # If we couldn't parse the response, return raw
                return {"text": str(data), "examples": []}

            except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, KeyError):
                pass  # Network error or unexpected format; fall to mock

        # Final fallback — mock for development
        return {"text": "[Gemini API response would appear here]", "examples": []}

    @staticmethod
    def _parse_response(raw_text: str) -> dict[str, Any]:
        """Parse a Gemini text response into structured content."""
        result: dict[str, Any] = {"text": raw_text, "examples": [], "related_topics": []}

        # Try to extract JSON blocks from the response
        import re
        json_block_match = re.search(r"```json\s*(.*?)\s*```", raw_text, re.DOTALL)
        if json_block_match:
            try:
                parsed = json.loads(json_block_match.group(1))
                if isinstance(parsed, dict):
                    if "text" in parsed:
                        result["text"] = parsed["text"]
                    if "examples" in parsed and isinstance(parsed["examples"], list):
                        result["examples"] = parsed["examples"]
                    if "related_topics" in parsed and isinstance(parsed["related_topics"], list):
                        result["related_topics"] = parsed["related_topics"]
                    if "question" in parsed:
                        # Looks like a quiz question — wrap in array
                        result["questions"] = [parsed]
            except json.JSONDecodeError:
                pass

        # Also check if top-level text looks like a JSON array of questions
        stripped = raw_text.strip()
        if stripped.startswith("[") and "question" in stripped:
            try:
                questions = json.loads(stripped)
                if isinstance(questions, list) and all("question" in q for q in questions):
                    result["questions"] = questions
            except (json.JSONDecodeError, TypeError):
                pass

        return result

    # ── Mock Responses (for development without API key) ────────────────────

    def _mock_explanation(
        self, activity: Any, context: dict[str, Any]
    ) -> dict[str, Any]:
        topic = getattr(activity, "topic", "this topic")
        return {
            "text": (
                f"Let me help you understand {topic}! The key concept here is that "
                f"each step builds on the previous one. Think of it like building blocks — "
                f"once you understand the foundation, the rest becomes much clearer."
            ),
            "examples": [
                f"Example 1: Consider a simple case of {topic}...",
                f"Example 2: Now let's look at a more complex scenario...",
            ],
            "related_topics": [topic],
        }

    def _mock_hint(self, activity: Any, context: dict[str, Any]) -> str:
        topic = getattr(activity, "topic", "this")
        return f"Think about the core principle of {topic}. What happens when you apply it step by step?"

    def _mock_quiz(self, topic: str, count: int) -> list[dict[str, Any]]:
        return [
            {
                "question": f"Which of the following best describes {topic}?",
                "options": [
                    f"Option A related to {topic}",
                    f"Option B related to {topic}",
                    f"Option C related to {topic}",
                    f"Option D related to {topic}",
                ],
                "correct_index": 0,
                "explanation": f"Option A is correct because it captures the essence of {topic}.",
            }
            for _ in range(count)
        ]

    def _mock_flashcards(self, topic: str, count: int) -> list[dict[str, str]]:
        cards = []
        for i in range(count):
            cards.append({
                "front": f"Question {i+1} about {topic}",
                "back": f"Answer {i+1} for {topic}",
            })
        return cards
