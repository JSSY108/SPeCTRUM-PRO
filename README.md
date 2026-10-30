# 🎓 SPeCTRUM Pro v2.0 — Course, Activities & Attendance Hub

SPeCTRUM Pro is a **complete student productivity hub** for **Universiti Malaya's SPeCTRUM** (`spectrum.um.edu.my`).

---

## 🌟 Architecture & Tab Layout

### 🔹 Tab 1: Activities Hub (Default Main Tab)
- **Interactive Timeline Visualizer**:
  - Horizontal scrollable timeline track across dates with interactive milestone points.
  - Color-coded status dots:
    - 🔴 **Overdue**
    - 🟠 **Due Soon** (<3 days remaining)
    - 🟢 **Active Now** (pulsing dot for currently open attendance sessions)
    - 🔵 **Upcoming**
    - 🟣 **Submitted / Recorded**
  - Navigation controls (`◀ Prev`, `Today`, `Next ▶`) with auto-centering on **Today**.
- **Three Core Sections**:
  1. 📢 **Announcements**: All course announcements, news, and lecturer updates aggregated in one place with a 1-click popup reader modal.
  2. 📝 **Assignments**: Deadlines, countdowns, and submission statuses.
  3. 📅 **Attendance**: Real-time session monitoring with 1-click **Auto-Take Attendance** and PIN entry prompts.
- **Dual Display Modes (Timeline vs By Course)**:
  - 🕒 **Ascending Timeline**: Chronologically sorted with nearest deadlines and active tasks at the top.
  - 📚 **Group by Course**: Organized by course cards with collapsible accordions.
- **100% Cached**: Everything loads instantly from local storage upon opening without waiting spinners.

---

### 🔹 Tab 2: Course Materials (Dedicated Downloader)
- Separate, dedicated tab for downloading lecture slides (PDF, PPTX), notes, and lab sheets.
- Search filter for courses, sections, or files.
- Select All / Deselect All and selective file checking.
- Clean 1-click **Download Selected Files (.ZIP)** with automatic folder organization:
  ```text
  [Course Code] Course Name/
  └── Week 01 - Introduction/
      └── Lecture_01_Slides.pdf
  ```

---

### 🔹 Tab 3: Preferences
- **OCC Group Management**: Set a global default OCC or customize per-course OCC overrides so SPeCTRUM Pro takes attendance and downloads materials strictly for your tutorial/lab group.
- **Attendance Background Automation**: Toggle periodic background checking and set the interval (10m, 15m, 30m, 60m).
- **File Types**: Choose allowed download formats (.pdf, .pptx, .ppt, .docx, .xlsx, .zip).
- **System Course Exclusions**: Hide non-academic courses (e.g. LEAP, Turnitin).
- **Cache Management**: Instant clear and rescan buttons.

---

### 🔹 Tab 4: Tip Jar ☕
- Support development by scanning your DuitNow QR code directly in the extension.

---

## ⚡ Small Extension vs. Full Tab Mode

- **Small Popup Window (520px x 600px)**:
  - Designed for **quick glance and instant action**: check today's tasks, take attendance with 1 click, or preview unread announcements.
- **Full Tab Mode (Big Screen)**:
  - Click **"Full Tab"** at the top right of the popup to open the full dashboard in a standard browser tab.
  - Expands the **Interactive Horizontal Timeline Visualizer** across the screen.
  - **Real-Time Auto-Update**: Full Tab listens to `chrome.storage.onChanged`. When an extension scan completes in any window or in the background, the Full Tab **updates automatically in real-time** without requiring a page reload!

---

## ⚡ How to Load & Test in Microsoft Edge (30 Seconds)

1. Open **Microsoft Edge** and enter:
   ```text
   edge://extensions
   ```
2. Turn **ON** "Developer mode" in the left sidebar.
3. If already loaded, click the **↻ Reload** button on the **SPeCTRUM Pro** card.  
   *(If loading for the first time, click **"Load unpacked"** and select `c:\Users\jonat\Projects\Spectrum PRO\spectrum_extension`)*.
4. Open [SPeCTRUM](https://spectrum.um.edu.my/my/courses.php) in your browser.
5. Click the **SPeCTRUM Pro** icon in your toolbar to explore Tab 1 (Activities), Tab 2 (Course Materials), the Timeline Visualizer, and the Full Tab view!

---

## 📤 Sharing with Coursemates

The updated extension package is zipped and ready to share at:
```text
c:\Users\jonat\Projects\Spectrum PRO\spectrum_extension.zip
```
