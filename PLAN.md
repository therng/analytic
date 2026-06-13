# Candlestick Pattern Knowledge Base — Phase 1 Implementation Plan

## Objective

Create a visual-only candlestick pattern learning system.

Requirements:

- No pattern names displayed
- No text descriptions
- No bullish/bearish labels
- No tooltips required
- Knowledge communicated entirely through:
  - Candlestick formation
  - Trend direction
  - Motion
  - Timing
  - Visual effects

The goal is that users recognize patterns from repeated visual exposure rather than reading definitions.

---

# Phase 1 Scope

Implement only the patterns provided.

Total Patterns: 11

## Bullish Reversal

1. Hammer
2. Piercing Line
3. Morning Star
4. Morning Doji Star
5. Three White Soldiers
6. Bullish Meeting Lines

## Bearish Reversal

7. Hanging Man
8. Evening Star
9. Evening Doji Star
10. Three Black Crows
11. Dark Cloud Cover
12. Bearish Meeting Lines

---

# Visual Communication Rules

## Trend Before Pattern

Downtrend

- declining candles
- descending trajectory

Uptrend

- rising candles
- ascending trajectory

Duration:
800ms

---

## Pattern Formation

Pattern candles appear sequentially.

Examples:

Three White Soldiers

Candle 1
→ Candle 2
→ Candle 3

Morning Star

Bearish Candle
→ Star Candle
→ Bullish Candle

Duration:
800ms

---

## Recognition Pause

After pattern completes:

Pause:
400ms

Purpose:

Allow visual recognition before outcome animation begins.

---

## Outcome Animation

Bullish Patterns

Visual outcome:

- rising price trace
- expanding glow
- upward continuation

Duration:
1000ms

---

Bearish Patterns

Visual outcome:

- falling price trace
- fading momentum
- downward continuation

Duration:
1000ms

---

## Loop

Pattern Animation Loop

Trend
↓
Pattern Build
↓
Pause
↓
Outcome
↓
Fade
↓
Restart

Total Duration:

4–5 seconds

Infinite Loop

---

# Standard Card Layout

Card Content

Top:
Animated trend

Center:
Pattern formation

Bottom:
Outcome movement

No text elements

No labels

No titles

No legends

---

# Animation System

## Candles

Use same candle renderer for all patterns.

Properties:

- open
- high
- low
- close

Render:

- bullish candle
- bearish candle
- doji candle

---

## Trend Trace

Optional lightweight line.

Purpose:

Communicate context.

States:

- uptrend
- downtrend

Opacity:
20–30%

---

## Glow System

Bullish

- green glow

Bearish

- red glow

Intensity increases during outcome stage.

---

# Pattern Specifications

## Hammer

Downtrend
→ Hammer
→ Uptrend

---

## Piercing Line

Downtrend
→ Long Bear Candle
→ Bull Candle Penetrates Previous Body
→ Uptrend

---

## Morning Star

Downtrend
→ Bear Candle
→ Small Star
→ Bull Candle
→ Uptrend

---

## Morning Doji Star

Downtrend
→ Bear Candle
→ Doji
→ Bull Candle
→ Uptrend

---

## Three White Soldiers

Downtrend
→ Bull Candle
→ Bull Candle Higher
→ Bull Candle Higher
→ Uptrend

---

## Bullish Meeting Lines

Downtrend
→ Bear Candle
→ Bull Candle
→ Equal Close
→ Uptrend

---

## Hanging Man

Uptrend
→ Hanging Man
→ Downtrend

---

## Evening Star

Uptrend
→ Bull Candle
→ Star
→ Bear Candle
→ Downtrend

---

## Evening Doji Star

Uptrend
→ Bull Candle
→ Doji
→ Bear Candle
→ Downtrend

---

## Three Black Crows

Uptrend
→ Bear Candle
→ Bear Candle Lower
→ Bear Candle Lower
→ Downtrend

---

## Dark Cloud Cover

Uptrend
→ Bull Candle
→ Bear Candle Closes Deep Into Body
→ Downtrend

---

## Bearish Meeting Lines

Uptrend
→ Bull Candle
→ Bear Candle
→ Equal Close
→ Downtrend

---

# Responsive Layout

## Mobile

1 Column

Pattern
Pattern
Pattern

---

## Tablet

2 Columns

Pattern | Pattern

Pattern | Pattern

---

## Desktop

4 Columns

Pattern | Pattern | Pattern | Pattern

---

# Technical Architecture

components/patterns/

- PatternCard.tsx
- PatternCanvas.tsx
- Candle.tsx
- TrendTrace.tsx

patterns/

- hammer.ts
- piercingLine.ts
- morningStar.ts
- morningDojiStar.ts
- threeWhiteSoldiers.ts
- bullishMeetingLines.ts
- hangingMan.ts
- eveningStar.ts
- eveningDojiStar.ts
- threeBlackCrows.ts
- darkCloudCover.ts
- bearishMeetingLines.ts

hooks/

- usePatternTimeline.ts

---

# Success Criteria

Users can:

- identify pattern direction without text
- distinguish bullish vs bearish outcomes visually
- recognize candle structures through repetition
- learn patterns by observation alone

No textual explanation required during interaction.
