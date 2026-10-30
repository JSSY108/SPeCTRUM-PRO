---
name: spectrum-ui-refactor
description: Design constraints and surgical layout refactoring rules for SPeCTRUM Pro combining high information density, integrated horizontal toolbars, and inline controls.
version: 1.0.0
sources:
  - Owl-Listener/designer-skills (density-hierarchy, layout-composition)
  - MengTo/Skills (technical-wireframe-info-layout)
  - DevelopersGlobal/ai-agent-skills (simplicity-first, surgical-changes)
---

# SPeCTRUM Pro UI/UX Skill & Layout Synthesis

## 1. Core Principles from Skill Audit

### A. Owl-Listener/designer-skills (Density-Hierarchy & Layout-Composition)
* **High Information Density**: Eliminate empty vertical space, decorative margins, and redundant padding blocks. Maximize the proportion of viewport dedicated to actual student activity data.
* **Proximity Over Heavy Borders**: Group related actions and indicators using subtle visual proximity, background tints, and dividers rather than nesting boxes inside boxes ("card-in-a-card" anti-pattern).
* **Scanning Hierarchy**: Enforce a strict visual hierarchy (F-pattern) where actionable metrics and current status catch the eye immediately, with secondary parameters (dates, filters) presented cleanly inline.

### B. MengTo/Skills (Technical-Wireframe-Info-Layout)
* **Cockpit / Integrated Toolbar Surface**: Merge scattered diagnostic metrics, status counts, and tab switchers into a single, cohesive horizontal control strip.
* **Inline Embedded Controls**: Controls such as search inputs, preset buttons, date range pickers, and scope selectors must sit flush inline rather than enclosed in bulky wrapper card frames.
* **Sleek Technical Aesthetic**: Deep obsidian/slate foundations (`#0c0d12`, `#141721`), precision 1px borders (`rgba(255, 255, 255, 0.08)`), crisp typography (Inter/system-ui), and targeted micro-accents (Cyan `#38bdf8`, Emerald `#10b981`, Amber `#f59e0b`, Purple `#c084fc`).

### C. DevelopersGlobal/ai-agent-skills (Simplicity-First & Surgical-Changes)
* **Simplicity-First Architecture**: Write lean, semantic HTML with minimal wrapper divs. Avoid gratuitous abstractions or speculative layout frameworks.
* **Surgical Refactoring**:
  * NEVER remove or rename existing DOM element IDs, dataset attributes (`data-sub`, `data-mode`, `data-filter`, `data-preset`), or class hooks relied on by `popup.js`.
  * Ensure full backward compatibility with all event listeners, filter states, date window calculations, calendar event mapping, and full-tab mode toggles.
  * Guarantee zero side-effects on materials, preferences, tip jar, or background sync scripts.

### D. Conflict Resolution Rule
* **Priority Rule**: Whenever a design rule for generic breathing room/padding conflicts with information density, **prioritize spatial density over generic padding**. Keep the entire dashboard header control surface compact (~120px to 140px total vertical height) so announcements, assignments, and schedule sessions appear above the fold immediately.

---

## 2. Enforced Layout Rules for SPeCTRUM Pro

### Rule 1: Unified Metric-Subnav Toolbar
* **Consolidation**: Merge the 4 separate metric cards (`#kpi-announcements-card`, `#kpi-pending-card`, `#kpi-overdue-card`, `#kpi-active-att-card`) directly into the sub-tab switcher bar (`.activities-subnav`).
* **Interactive Metric Tabs**:
  * **Announcements Tab** (`[data-sub="sub-announcements"]`): Houses the announcement icon, label, and the live `#count-sub-ann` / `#kpi-announcements-count` badge.
  * **Assignments Tab** (`[data-sub="sub-assignments"]`): Houses the assignment icon, label, the total count (`#count-sub-assign`), pending count (`#kpi-pending-count`), and an urgent overdue pill (`#kpi-overdue-count`).
  * **Attendance Tab** (`[data-sub="sub-attendance"]`): Houses the attendance icon, label, and the live active/upcoming session count (`#count-sub-att` / `#kpi-active-att-count`).
* **Mode Switcher Docking**: The view mode buttons (`#btn-mode-timeline`, `#btn-mode-calendar`, `#btn-mode-bycourse`) dock flush on the right side of this same horizontal bar.

### Rule 2: Elimination of Bulky Outer Wrapper Cards (Inline Embedded Controls)
* **Search & Action Bar**: The search bar (`#activities-search-input`, `#btn-clear-activities-search`), cache status (`#activities-cache-badge`), and refresh action (`#btn-refresh-activities`) sit inline on a single clean strip without oversized card containers.
* **Date Window & Scope Strip**:
  * Remove the heavy `.date-filter-bar` card container border and nested header block.
  * Arrange the preset buttons (`#date-presets-container`), the date inputs (`#date-range-start`, `#date-range-end`, `#date-anchor-input`), and the course scope selector (`#course-scope-select`) into a compact, unified inline filter bar.

### Rule 3: Surgical Integrity & Zero-Breakage Mandate
* Maintain all IDs:
  * `#activities-search-input`, `#btn-clear-activities-search`, `#activities-cache-badge`, `#btn-refresh-activities`
  * `#kpi-announcements-card`, `#kpi-announcements-count`
  * `#kpi-pending-card`, `#kpi-pending-count`
  * `#kpi-overdue-card`, `#kpi-overdue-count`
  * `#kpi-active-att-card`, `#kpi-active-att-count`
  * `#count-sub-ann`, `#count-sub-assign`, `#count-sub-att`
  * `#date-presets-container`, `#date-range-start`, `#date-range-end`, `#date-anchor-input`, `#course-scope-select`
  * `#btn-mode-timeline`, `#btn-mode-calendar`, `#btn-mode-bycourse`
  * `#sub-announcements`, `#sub-assignments`, `#sub-attendance`
  * `#timeline-visualizer-section`, `#timeline-track`, `#calendar-section`, `#cal-grid`
* The refactored layout must allow the student to switch tabs, click KPI pills to filter overdue/pending, toggle calendar/timeline views, change date presets, and sync without any JavaScript errors or layout shifts.
