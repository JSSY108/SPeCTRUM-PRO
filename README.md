# SPeCTRUM PRO™ — All-in-One UM Academic Companion

SPeCTRUM Pro is an all-in-one academic companion and productivity workstation built specifically for students and faculty of **Universiti Malaya (UM)** using the SPeCTRUM learning management system (`spectrum.um.edu.my`).

Tired of navigating nested folders and disjointed course pages? SPeCTRUM Pro unifies your courses, schedules, deadlines, attendance check-ins, and study materials into a single, cohesive academic hub.

---

## 🌟 Core Architecture & Features

### 🔹 Tab 1: Activities Hub (Default View)
- **Dual Perspective (Calendar View & Course View)**:
  - 📅 **Calendar & Monthly Grid**: Visual agenda and calendar day cells showing announcements, assignments, and attendance sessions.
  - 📚 **Group by Course**: Organized course cards with collapsible sections.
- **Three Core Streams**:
  1. 📢 **Announcements**: Course announcements and lecturer notices aggregated into a single feed with an instant modal reader.
  2. 📝 **Assignments**: Track upcoming deadlines, active countdowns, and submission statuses (Submitted, Due Soon, Overdue).
  3. 📅 **Attendance Monitoring**: Real-time session detection with 1-click check-in and automatic PIN input support.
- **100% Offline Cached**: Instantly renders cached schedules and activities from local storage upon opening.

---

### 🔹 Tab 2: Weekly Timetable Visualizer
- **Interactive Weekly Schedule**: Automatically parsed from your enrolled course schedule and tutorial OCC groups.
- **Detailed Class Cards**: Displays class start/end times, durations, course codes, and classroom/lab locations for every day of the week.
- **Visual Export**: Export your timetable as a clean high-resolution image (PNG) or calendar event format.

---

### 🔹 Tab 3: Course Materials (Batch Downloader)
- **1-Click Batch Downloader**: Download lecture notes, slides, and lab sheets across your enrolled courses in one click.
- **Automatic Folder Organization**: Files are structured cleanly by course code, name, and semester week:
  ```text
  [Course Code] Course Name/
  └── Week 01 - Introduction/
      └── Lecture_01_Slides.pdf
  ```
- **Selective Downloads**: Search and filter by course or section; check only the specific files you need.

---

### 🔹 Tab 4: Preferences & Automation
- **⚡ Occurrence (OCC) Auto-Detection**:
  - Automatically identifies your specific tutorial, lab, and lecture OCC numbers directly from your SPeCTRUM course enrollment.
  - One-click **Auto-Detect** and **Reset All** controls.
  - Per-course OCC override controls to customize individual classes.
- **Attendance Background Automation**:
  - Optional periodic background checking (10m, 15m, 30m, 60m).
  - Desktop notifications when an active class attendance check-in window opens.
- **Academic Week Calibration**: Calibrate the Semester Week 1 start date for accurate week numbering across timelines and timetables.
- **System Course Exclusions**: Cleanly hide non-academic portal courses (e.g., LEAP, Turnitin, Co-curriculum).
- **Multilingual Support**: Instant live interface translation across **English**, **Bahasa Melayu (BM)**, and **Chinese (中文)**.
- **Theme Engine**: Toggle between **Light**, **Dark**, and **Cyberpunk** themes.

---

## 🖥️ Workspace Display Modes

- **Compact Popup (520px × 600px)**:
  - Designed for fast glances and instant actions: check today's tasks, take attendance with 1 click, or preview unread announcements.
- **Full-Screen Workstation**:
  - Click **"Full Screen"** in the top bar to expand into an immersive, wide-screen dashboard layout.
  - Updates in real-time via `chrome.storage.onChanged` as background syncs complete.
- **Floating Pinned Companion (`Alt+S`)**:
  - Toggle a non-intrusive floating panel right inside your current browsing tab without switching contexts.

---

## 🔒 Privacy & Security First

- **Local-Only Sandbox**: Zero remote servers, zero external analytics, and zero telemetry.
- **No Account Creation**: SPeCTRUM Pro functions exclusively through your existing browser session. Your student credentials/passwords are never requested, stored, or processed.
- **Direct Connection**: All network calls connect exclusively to `spectrum.um.edu.my` and Microsoft SSO endpoints.
- Read our full [Privacy Policy](PRIVACY.md).

---

## 🚀 How to Load & Test Locally

### In Google Chrome / Microsoft Edge
1. Open your browser's extension manager:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode** (toggle in top-right for Chrome, left sidebar for Edge).
3. Click **"Load unpacked"** and select:
   ```text
   c:\Users\jonat\Projects\Spectrum PRO\spectrum_extension
   ```
4. Navigate to [SPeCTRUM](https://spectrum.um.edu.my) and click the SPeCTRUM Pro toolbar icon.

---

## 📦 Production Package

The latest production-ready extension package (v1.0.4) is generated at:
```text
c:\Users\jonat\Projects\Spectrum PRO\spectrum_extension.zip
```

---

## 📄 License & Trademarks

The source code of this project is licensed under the [MIT License](LICENSE). The brand identity, product name, and logo are protected under our [Trademark Policy](TRADEMARK.md).
