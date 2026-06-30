# Skills Inventory — Available to Agents

This is the canonical list of skills every agent can use. When given a task, the agent should check if a relevant skill exists before attempting a manual approach.

## Productivity (9)
- **google-workspace** — Gmail, Calendar, Drive, Contacts, Sheets, Docs
- **teams-meeting-pipeline** — Teams summaries, transcripts, action items
- **nano-pdf** — Edit PDF text/typos/titles via nano-pdf CLI
- **ocr-and-documents** — pymupdf, marker-pdf for scans
- **petdex** — animated mascots for Hermes
- **maps** — Geocode, POIs, routes via OSRM
- **notion** — Notion API + ntn CLI
- **airtable** — Airtable REST CRUD
- **powerpoint** — .pptx decks

## MLOps (6)
- **lm-evaluation-harness** — benchmark LLMs (MMLU, GSM8K)
- **weights-and-biases** — log ML experiments
- **vllm** — high-throughput LLM serving
- **llama-cpp** — local GGUF inference
- **huggingface-hub** — hf CLI
- **segment-anything** — SAM zero-shot segmentation
- **audiocraft** — MusicGen text-to-music

## Creative (12)
- design-md, manim-video, humanizer, excalidraw
- architecture-diagram, claude-design
- ascii-video, baoyu-infographic, sketch
- pretext, comfyui, touchdesigner-mcp
- songwriting-and-ai-music, p5js

## Research (3)
- **arxiv** — academic paper search
- **blogwatcher** — RSS/Atom monitoring
- **polymarket** — query prediction markets

## DevOps (4)
- ragmedium-restore-all-services — VPS recovery
- ragmedium-voice-calling-and-apk — Agent Command voice
- telegram-bot-stuck-diagnosis — Telegram bot triage
- vps-health-check, vps-infrastructure-debugging — VPS QA

## RAG-Empire Specific (5)
- **rag-empire-hierarchy** — Project > Initiative > Task structure
- **rag-empire-vision** — full picture of all ventures + stack
- **rag-empire-ops-dashboard** — me.ragmedium.com build specs
- **amir-command-dashboard-spec** — dashboard master spec
- **amir-brand-voice** — Amir's writing voice for content
- **amir-founder-identity** — who Amir is

## Productivity email/automation
- **himalaya** — IMAP/SMTP email from terminal
- **deliver-briefing.py** — pushes briefings
- **agent-continuous.py** — 24/7 work queue

## When to use SKILLS

If a task says "use the KB to write..." → the KB + content-* skills exist
If a task says "create a campaign" → check the ReachInbox cheatsheet below
If a task says "design..." → the creative/* skills

Critical: ALWAYS look up if a skill exists before reinventing.
