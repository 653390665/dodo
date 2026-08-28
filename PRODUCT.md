# InkFlow (墨影) — Product Context

## What is InkFlow?
InkFlow is an AI-assisted novel writing desktop application for serious fiction authors and commercial web novel writers. It runs as a local-first Electron app (macOS + Windows) with all data stored in local SQLite.

## Target Users
- Serious fiction authors who want AI assistance without cloud dependency
- Commercial web novel writers (targeting platforms like Tomato/番茄, Yuewen/阅文, Lofter)
- Writers who need structured world-building, character tracking, and production pipelines

## Core Value Proposition
- **Local-first**: All data stays on the user's machine, no cloud sync
- **AI治理**: Built-in quality guard that detects and eliminates "AI slop" in generated text
- **Memory radar**: Real-time context-aware companion writing with entity highlighting
- **Skill system**: White-label isolated prompt capability store for different writing styles

## Product Architecture
- **Views**: Welcome → Library → Editor → World Bible → Workspace → AI Assistant → Skills Studio → Book Factory
- **Data flow**: React (Zustand stores) → Express REST API → SQLite (WAL mode)
- **AI providers**: Google Gemini, OpenAI-compatible, MiniMax, SiliconFlow (multi-provider with fallback)

## Key Features
1. **Onboarding Wizard**: Multi-step story setup with genre, platform, length, and style selection
2. **Editor**: Chapter writing with sidebar, entity sniffing, radar diagnostics, agent workspace
3. **World Bible**: Characters, locations, items, factions, power levels, timeline management
4. **AI Assistant**: Chat-based writing companion with story card generation
5. **Skills Studio**: Extract, test, and manage writing style/skill cards
6. **Book Factory**: Full pipeline from planning → outline → production → quality check
7. **Chapter Production**: AI-powered chapter generation with streaming, audit, and rewrite
8. **Project Cockpit**: Dashboard view with recommendations and status overview

## Design Philosophy
- **Professional Creator Console**: High-density, information-rich interface for power users
- **Minimal chrome**: Hairline borders, subtle shadows, tight round corners
- **Writing-first**: Serif font for content areas, monospace for data/counters
- **Dark/Light theme**: System-aware with manual override, OKLCH color space

## Current Status
- Version 1.2.0, Apache-2.0 license
- Desktop app (Electron) with web dev mode
- Active development with 87+ test files
