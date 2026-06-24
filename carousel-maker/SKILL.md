---
name: carousel-maker
description: Generate Instagram carousels from video content, transcripts, topics, or ideas. Two modes — AI-generated slides (6 styles) and Screenshot-based slides (real frames). Includes watermark removal, slide scripting, and CTA optimization. Triggers: 'make a carousel', 'create carousel', 'instagram carousel', 'carousel from this video'.
---

# Instagram Carousel Maker

A comprehensive system for generating branded Instagram carousels in minutes. Source: Artem Novitckii's Instagram Carousel Generator workflow.

---

## Interactive Decision Points

### 1. Generation Mode

Ask the user:
- **"How should we create the carousel slides?"**
- **Screenshot-Based (Recommended)** — Real frames from source video, preserves faces/details
- **AI-Generated** — Gemini Pro generates stylized slides from scratch
- **Watermark Removal Only** — Clean up existing generated images

### 2. Carousel Format

Ask the user:
- **"What format fits your content?"**
  - **The List** — "5 Ways to... / 7 Mistakes..." (educational, high saves)
  - **Framework Reveal** — "The 3-Step System for..." (authority, high follows)
  - **Myth-Bust** — "You've been told X. Here's the truth." (contrarian, high comments)
  - **Story Arc** — "This one decision changed everything." (narrative, high engagement)
  - **Before/After** — "I used to... Now I..." (transformation, high shares)
  - **Hot Take** — "Unpopular opinion: X is wrong." (debate, high engagement)

### 3. Visual Style

Ask the user:
- **"What visual style do you want?"**
  - **Screenshot + Annotation (Recommended)** — Real frames with text overlays, arrows, highlights
  - **Keynote (Luis Carrillo Original)** — Black bg, Inter 800, Apple colors, massive typography, one idea per slide
  - **Cards Against Humanity** — White card, black border, bold Helvetica, max 10 words
  - **iPhone Text Messages** — iOS message bubble interface
  - **Editorial Illustration** — Hand-drawn ink, New Yorker aesthetic
  - **Handwritten Whiteboard** — Multi-colored markers, slightly imperfect
  - **Custom / Brand Match** — Upload reference image to clone the vibe

### 4. CTA Type (Final Slide)

| Type | Example |
|------|---------|
| DM Automation | "DM me [WORD] for [Asset]" |
| Comment Automation | "Comment [WORD] for [Asset]" |
| Follow CTA | "Follow @[Handle] for more [Topic]" |
| Discussion | Ask a question to spark debate |
| Save CTA | "Save this for later" |

---

## Mode Decision Logic

| Signal | Mode |
|--------|------|
| Real person on camera | **Screenshot-Based** |
| Product demos / physical items | **Screenshot-Based** |
| Concept / educational / no face | AI-Generated |
| User says "use frames" or "screenshots" | **Screenshot-Based** |

---

## Readability Rules (ENFORCE ALWAYS)

1. **Max 15 words per slide** (8-12 ideal)
2. **One idea per slide** — if it needs a comma, split it
3. **No paragraphs** — bullet points or single lines only
4. **High contrast** — black on white or white on black
5. **Readable on mobile** without zooming
6. **Center-aligned** both axes, always
7. **10% margin minimum** on all sides

---

## Slide Structure (8-10 slides)

| Slide | Purpose | Notes |
|-------|---------|-------|
| 1 | HOOK | Pattern interrupt, one line, bold, creates curiosity |
| 2-3 | SETUP | Establish the problem or context |
| 4-7 | VALUE | The meat — framework, list items, story beats |
| 8-9 | PAYOFF | Resolution, summary, or proof |
| 10 | CTA | Exactly as selected |

### Slide Plan Format
```
Slide 1 (Hook)
Text: [Hook — max 10 words]
Visual: [Description of the image composition]

Slide 2 (Setup)
Text: [Max 15 words]
Visual: [Description]

[Continue for all slides...]
```

---

## Hook Templates by Format

| Format | Hook Examples |
|--------|-------------|
| List | "[Number] [Things] that [Result]", "Stop doing [X]. Do [Y] instead." |
| Myth-Bust | "You've been lied to about [Topic]", "[Common Belief] is completely wrong" |
| Before/After | "[Time] ago, I [Problem]. Now I [Result]." |
| Story Arc | "This one [decision] changed everything" |
| Framework | "The [Number]-Step System for [Result]" |
| Hot Take | "Unpopular opinion: [Contrarian Statement]" |

---

## Style: Keynote (Steve Jobs Style)

**Black background, massive typography, one idea per slide.**

### Design Rules
```
Background:  #000000 (ALWAYS pure black)
Font:        Inter, weight 800 for hero, 400 for sub
Colors:      white (#fff), gray (#86868b), blue (#2997ff), green (#30d158),
             purple (#bf5af2), orange (#ff9f0a), red (#ff453a)
Alignment:   Center (both axes)
Max words:   10 per slide
One rule:    ONE idea per slide. No exceptions.
```

### Keynote Story Arc
```
Slide 1 (Hook):     THE PROBLEM — massive text, make them FEEL it
Slide 2 (Tension):  Old way (red) vs New way (green) — contrast
Slide 3 (Reveal):   Your solution — gradient text (blue→purple)
Slide 4-5 (How):    Three steps MAX — numbered, simple
Slide 6 (Proof):    One real example with real numbers
Slide 7 (Numbers):  3-4 massive stats, nothing else on screen
Slide 8 (Magic):    The "wow" — short sentences stacking
Slide 9 (Close):    Tagline + CTA
```

### Keynote Generation
When using Keynote style: generate each slide as a **4:5 portrait HTML div** rendered to PNG. Use the design system CSS directly for pixel-perfect results.

---

## Generation Pipeline

### Mode A: AI-Generated Slides

For EACH slide, generate ONE image at a time:
```bash
# Generate slide (with Gemini Pro)
python3 [script]/generate_image.py \
  "[full prompt with text-to-render instruction]" \
  "output.jpg" --model gemini-3-pro-image-preview --aspect 4:5
```

**Rules:**
- ONE image per generation call. NEVER create collages, grids, or multi-panel images.
- Each image = exactly ONE carousel slide filling the ENTIRE canvas.
- Generate ALL slides without stopping for feedback between slides.
- Always include explicit text-to-render instructions in every prompt.
- All text must be CENTER-ALIGNED, vertically and horizontally.

### Watermark Removal (Post-Generation)
```bash
python3 [script]/edit_image.py "input.jpg" \
  "Clean up the bottom-right corner of this image. There is a small white sparkle shape that should be replaced with the surrounding paper texture." \
  "output.jpg" --model gemini-3-pro-image-preview
```

### Mode B: Screenshot-Based

1. Extract frames from video using ffmpeg
2. Remove subtitles BEFORE enhancement (using Gemini Pro inpainting)
3. Enhance frames (sharper, clearer, better lighting)
4. Use Pillow (PIL) to create canvas layout with text overlays
5. Output as 4:5 portrait, 1080×1350px

**Critical: Never stretch low-res frames.** Keep native resolution, max 1.4x upscale.

---

## Output & Organization

- **Output folder:** `~/Downloads/[carousel-name]/clean/`
- **File naming:** `01.png`, `02.png`, ... `10.png`
- **Format:** PNG, 4:5 portrait, ≥1080px wide
- **Verification:** All files ≥ 50KB, valid images, no watermarks

---

## Scripting Principles

- **One Big Idea**: Every carousel has ONE takeaway
- **Tone**: Trusted advisor > Salesman
- **Specificity**: Numbers, examples, results > vague claims
- **Swipe Motivation**: Each slide must create curiosity for the next
- **Standalone Value**: If someone only sees slide 1, they still get something
