# Privacy Policy — SPeCTRUM Pro

**Last Updated:** November 12, 2026

SPeCTRUM Pro ("the extension") is an independent, open-source academic productivity companion developed for students and faculty of **Universiti Malaya (UM)** who use the SPeCTRUM Learning Management System (`https://spectrum.um.edu.my`).

SPeCTRUM Pro operates on a **local-only, zero-third-party-server architecture**. This Privacy Policy, together with our in-extension disclosures, explains how user data is **collected, handled, used, stored, retained, deleted, and shared**.

---

## 1. User Data Collection (What Data We Access & How)

SPeCTRUM Pro accesses only the minimum data required to deliver its student productivity features when you use the extension:

1. **Authentication Status (`cookies` permission):**
   - When you trigger a sync or use Auto-Attendance monitoring, SPeCTRUM Pro checks your browser's `MoodleSession` session cookie for `https://spectrum.um.edu.my` strictly to verify whether you are signed in.
   - SPeCTRUM Pro **never collects, prompts for, reads, or stores your university account username or password**. Sign-in happens directly on Universiti Malaya's official login pages in your browser.
2. **Academic & LMS Website Content (`https://spectrum.um.edu.my/*`):**
   - While you are signed in to SPeCTRUM, the extension fetches your enrolled course codes/titles, downloadable course material links, forum announcements, assignment due dates, timetable slots, and attendance session statuses directly from `https://spectrum.um.edu.my`.
3. **User-Provided Preferences & Inputs:**
   - The extension collects settings you explicitly configure inside the interface, including selected course occurrence (OCC) numbers, custom timetable room locations/overrides, UI theme/language preferences, Auto-Attendance toggles, and optional lecturer-provided attendance session PINs when you submit a check-in.
4. **Active Tab Floating Overlay (`activeTab` & `scripting`):**
   - Only when you explicitly click **Pin Floating Window** or press **`Alt+S`**, Chrome grants temporary access to the active tab solely to mount the floating SPeCTRUM Pro panel UI (`content.js` / `content.css`).
   - SPeCTRUM Pro does **not** collect, read, log, or track your web browsing history or webpage content across other websites.

---

## 2. User Data Handling & Use

All collected/accessed data is processed **strictly locally inside your browser** solely for the extension's single academic productivity purpose:

- **Course Organization & Downloads:** Displaying your course structure, previewing local documents (PDF, PPTX, DOCX), and saving selected lecture files directly to your device's Downloads folder via `chrome.downloads`.
- **Deadlines, Announcements & Timetables:** Rendering assignment countdowns, forum post previews, and weekly schedules inside the extension popup and dashboard.
- **Attendance Monitoring & Check-In:** Checking active SPeCTRUM attendance windows on your configured interval (`alarms`), sending optional desktop alerts (`notifications`), and submitting attendance forms on your behalf only when initiated by you or enabled in Auto-Attendance settings.
- **No Advertising, Profiling, or Analytics:** User data is **never** used for advertising, marketing, creditworthiness assessment, behavioral profiling, or telemetry. We do **not** embed third-party analytics SDKs or tracking pixels.
- **Google Chrome Web Store Limited Use Compliance:** SPeCTRUM Pro's handling of information obtained from Chrome APIs strictly adheres to the Chrome Web Store User Data Policy, including the **Limited Use** requirements.

---

## 3. User Data Storage, Retention & Deletion

- **Strictly Local On-Device Storage (`chrome.storage.local`):** All cached courses, deadlines, timetables, OCC settings, theme/language preferences, and local diagnostic logs are stored **exclusively on your personal device** within Chrome's isolated `chrome.storage.local` storage.
- **Zero Remote Developer Storage:** We do **not** operate any backend servers, cloud databases, or external logs. No copy of your academic data, cookies, or preferences is ever uploaded to us.
- **Retention Period:** Data remains in local browser storage on your device only until you clear it or uninstall the extension.
- **Your Controls, Opt-Out & Deletion:**
  - Live syncing occurs only while you are logged into `https://spectrum.um.edu.my` and actively trigger sync or opt into Auto-Attendance.
  - You can disable background Auto-Attendance monitoring at any time under **Preferences**.
  - You can delete all cached extension data at any time from **Preferences** or by clearing extension storage / uninstalling SPeCTRUM Pro, which permanently removes all locally stored data from your device.

---

## 4. User Data Sharing & All Third Parties

- **No Data Selling or Third-Party Sharing:** We **never sell, rent, trade, disclose, or transfer** your user data to any third parties, including advertisers, analytics companies, data brokers, affiliate networks, or AI model training services.
- **All Parties With Whom Data Is Communicated:**
  - **Universiti Malaya SPeCTRUM (`https://spectrum.um.edu.my`) — Only External Endpoint:** When syncing academic schedules/materials or submitting an attendance check-in, your browser communicates **directly and exclusively** over HTTPS with Universiti Malaya's official portal (`https://spectrum.um.edu.my`). No intermediary or third-party server sits between your browser and UM SPeCTRUM, and all UI fonts and document viewers are bundled locally inside the extension package.
  - **No Other Parties:** Zero user data is shared with the extension developer or any external party.

---

## 5. Browser Permissions Summary

| Permission | Purpose |
| :--- | :--- |
| **`storage`** | Stores enrolled courses, deadlines, timetable overrides, OCC preferences, UI settings, and offline cache locally via `chrome.storage.local`. |
| **`downloads`** | Saves lecture slides and course material packs directly into your local Downloads folder. |
| **`activeTab`** | Grants temporary access only when you explicitly click **Pin Floating Window** or press **`Alt+S`** to display the floating panel, without requiring `<all_urls>` host permission. |
| **`scripting`** | Mounts the local floating overlay UI onto the active tab when invoked via `activeTab`. |
| **`cookies`** | Checks your `MoodleSession` login status on `https://spectrum.um.edu.my` without handling or storing credentials. |
| **`alarms`** | Schedules periodic background checks when Auto-Attendance monitoring is enabled. |
| **`notifications`** | Displays optional desktop alerts when an attendance window opens or is recorded. |
| **`host_permissions`** (`https://spectrum.um.edu.my/*`) | Scoped strictly to HTTPS endpoints on Universiti Malaya SPeCTRUM (`content_scripts` also run solely on `https://spectrum.um.edu.my/*`). |
| **`commands`** (`Alt+S`) | Keyboard shortcut to toggle the optional floating workstation overlay. |

---

## 6. Open Source, Disclaimer & Contact

- **Source Code Transparency:** SPeCTRUM Pro is open-source and verifiable on GitHub: [https://github.com/JSSY108/SPeCTRUM-PRO](https://github.com/JSSY108/SPeCTRUM-PRO)
- **Non-Affiliation Disclaimer:** SPeCTRUM Pro is an independent student-built utility and is **not affiliated with, maintained by, or officially endorsed by Universiti Malaya (UM)**.
- **Contact:** For privacy questions, data inquiries, or deletion/support requests, please open an issue at [https://github.com/JSSY108/SPeCTRUM-PRO/issues](https://github.com/JSSY108/SPeCTRUM-PRO/issues).
