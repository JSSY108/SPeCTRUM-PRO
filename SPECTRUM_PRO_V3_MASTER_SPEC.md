
# SPeCTRUM PRO v3.0 — Master UI/UX Refactoring Specification

## 1. Core Objective & Design System

Refactor the UI into an editorial minimalist layout (inspired by Swiss grids). Strictly separate the Full-Tab Workspace from the Extension Popup. Maintain all underlying v2.0 data/scraping logic.

### 90% Monochrome / 10% Semantic Signal Palette

Implement these exact CSS variables and remove all legacy rainbow status colors:

```css
:root {
  /* 90% Monochrome Architecture */
  --bg-canvas: #FAFAFA;
  --bg-surface: #FFFFFF;
  --bg-primary-cta: #111111;
  --text-primary: #111111;
  --text-secondary: #52525B;
  --border-hairline: #E4E4E7;
  --border-strong: #111111;

  /* 10% Semantic Signal Ink (Left Bars, Dots & Micro-Badges Only) */
  --signal-attendance: #10B981; /* Emerald */
  --signal-attendance-bg: #ECFDF5;
  --signal-assignment: #F97316; /* International Orange */
  --signal-assignment-bg: #FFF7ED;
  --signal-notice: #2563EB;     /* Cobalt Blue */
  --signal-notice-bg: #EFF6FF;
  --signal-urgent: #E11D48;     /* Crimson */
}
Rule: Primary CTA buttons ([Link to Att.], [Link to Submit]) and active tabs must be solid black (#111111) with white text.

2. Surface A: Full-Tab Workspace (100vw × 100vh)
Triggered when isFullTab === true. The top filter deck is removed.

Left Icon Rail (width: 60px, border-right: 1px solid var(--border-hairline))
Top Utility: Minimalist icons for Preferences and Course Materials.

Middle (Multi-Select Checklist): Vertical stadium pill containing 3 toggles (Assignment, Attendance, Notices). Clicked icons invert to solid #111111 with a 6px semantic color dot and immediately filter the views.

Bottom (View Switcher): Circular icon for the active mode. On :hover, expands vertically to show Timeline, Calendar, and List options.

View 1: Calendar Mode (Monthly Grid & Master-Detail)
7-Column Grid (Mon–Sun): If any weekday column has 0 total items across the displayed month, compress its width to minmax(40px, 0.2fr). Populated days take 1fr.

Day Cells: Render up to 3 stacked wireframe count pills (1px solid #111111), e.g., [Notice (1)], [Assignment (3)].

Master-Detail Interaction: Clicking a day cell shrinks the Calendar to 65% width and opens a Right Details Sidebar (35% width, border-left: 1px solid #111111). The sidebar shows the selected Date header and vertical list of full cards.

View 2: Timeline Mode (Horizontal Scroll Kanban)
Sticky Month Header: Top-left fixed text (e.g., OCTOBER 2026). Update this via IntersectionObserver as new months scroll into view.

Horizontal Board (overflow-x: auto): Renders day columns side-by-side.

Column Rules:

Skip Empty Days: Do not render a column for dates with 0 events.

Width: Show exactly 3 day columns at a time (min-width: calc(33.333% - 1rem)).

Header: Sticky date header inside each column (e.g., THU, 29 OCT).

Content: Render the Full Standardized Cards vertically inside the column.

Scroll Hijacking (Vertical to Horizontal): Add an event listener to the container:

JavaScript
track.addEventListener('wheel', (evt) => {
  if (evt.deltaY !== 0) { evt.preventDefault(); track.scrollLeft += evt.deltaY; }
});
View 3: Full-Tab List Mode
Max-width 960px centered layout. Left sticky date column (180px), right card feed (780px).

3. Surface B: Extension Popup (520px × 600px)
Strictly a fast list-feed. Never render the Left Rail, Calendar, or Timeline here.

Header: SPeCTRUM PRO (left), wireframe [Full Screen] button (right).

Primary Tabs: Activities (active), Course Material, Preference, Tip Jar.

Radio Sub-Tabs: Notice | Tutorial | Attendance. Strictly mutually exclusive. Active pill is solid black with a 6px semantic color dot.

Toggle Bar: By: Date | Course.

Split Sticky Scroll View (By: Date):

Left (85px, fixed/sticky): Displays a bold [Day / Month] box (e.g., 29 OCT / THU). Attach an IntersectionObserver to the right-hand scroll container so this text dynamically updates to reflect the topmost visible card.

Right (flex: 1, overflow-y: auto): Vertical list of standardized cards.

4. The 3 Standardized Cards (Shared Everywhere)
Base card styling: background: #FFFFFF, border: 1px solid var(--border-hairline), padding: 12px, border-radius: 6px.

1. Attendance Card
Left Border: 3px solid var(--signal-attendance)

Row 1: Course Icon + Course Code & Name.

Row 2: Wireframe [Occ: 3 | Edit] pill (clicking Edit triggers inline input that saves to chrome.storage overrides) + [Lecture/Tutorial] pill.

Row 3: Previous One: [✓ or ✕] [Date] | Next One: [Time].

Bottom Right: Solid black [Link to Att.] button.

2. Assignment (Tutorial/Task) Card
Left Border: 3px solid var(--signal-assignment) (Use --signal-urgent if overdue).

Row 1: Course Icon + Course Code & Name + Wireframe [Occ] pill (right).

Row 2: Bold Title + Monospace Due date + Time.

Row 3: Status text [● Overdue / Submitted / Upcoming] (left) + Solid black [Link to Submit] button (right).

3. Notice Card
Left Border: 3px solid var(--signal-notice)

Row 1: Course Icon + Course Code & Name + Wireframe [Date] pill (right).

Row 2: Bold Title + 2-line truncated preview (-webkit-line-clamp: 2, color: var(--text-secondary)).

Bottom Left: Wireframe [More...] button (opens Reader Modal).

5. Required Preservations (Do Not Regress)
Ensure these specific features remain fully wired and functional:

Course Materials (Tab 2): Preserve the Tree view and Batch ZIP Downloader logic.

Preferences (Tab 3): Preserve OCC Manager table, Background Auto-Attendance toggle, Hidden Duplicates restore list, File format filters, and Cache clearing.

Automations: Ensure 1-click attendance logic (and PIN modal) still functions on the new solid black CTA buttons.

Modals: Maintain the Announcement Reader Modal, PIN Entry Modal, and Diagnostics Console.
```
