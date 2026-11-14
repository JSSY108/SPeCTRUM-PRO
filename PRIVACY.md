# Privacy Policy — SPeCTRUM Pro

**Last Updated:** November 14, 2026  
**Extension Name:** SPeCTRUM Pro - UM Academic Companion  
**Target Platform:** Universiti Malaya (UM) SPeCTRUM (`https://spectrum.um.edu.my`)

SPeCTRUM Pro ("the extension", "we", "our") is an open-source academic productivity companion developed for students and faculty of **Universiti Malaya (UM)**. 

SPeCTRUM Pro operates on a **strict local-only, zero-external-server architecture**. This Privacy Policy, together with our in-product prominent disclosures, comprehensively details our practices regarding user data **collection, handling, storage, security, retention, deletion, and sharing** in strict adherence with the [Google Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/privacy/) and **Limited Use** requirements.

---

## 1. User Data Collection

SPeCTRUM Pro accesses and collects only the minimum data strictly required to deliver student productivity tools:

1. **Authentication Session Information (`cookies` permission):**
   - The extension reads the browser's `MoodleSession` session cookie for `https://spectrum.um.edu.my` solely to check whether you are actively authenticated into your university portal.
   - **No Credentials Access:** SPeCTRUM Pro **never collects, reads, prompts for, logs, or transmits your university username or password**. Authentication occurs entirely on Universiti Malaya's official login portal and Microsoft SSO.
2. **Academic & LMS Website Content (`https://spectrum.um.edu.my/*`):**
   - While signed in to SPeCTRUM, the extension reads your enrolled course titles, course codes, timetable slots, assignment deadlines, announcements, attendance records, and lecture file download links directly from `https://spectrum.um.edu.my`.
3. **User Preferences & Inputs:**
   - The extension stores preferences you explicitly set within the UI, such as tutorial/lab occurrence (OCC) selections, manual timetable entries/overrides, UI language (English, Bahasa Melayu, Chinese), UI theme (Light, Dark, Cyberpunk), and optional lecturer-provided attendance session PINs entered for check-in.
4. **Active Tab Floating Companion (`activeTab` & `scripting`):**
   - Only when you explicitly press `Alt+S` or click "Pin Floating Window", temporary access is granted to mount the floating workstation overlay (`content.js` / `content.css`) on the active tab. No web history or browsing content from other websites is collected or logged.

---

## 2. User Data Handling & Use

All accessed and collected data is handled **strictly locally on the user's device** solely to fulfill the extension's declared single purpose as an academic companion:

- **Deadlines & Timetable Visualizer:** Aggregating assignment due dates, forum announcements, and weekly class schedules into unified, accessible calendar views.
- **Course Material Downloads:** Previewing local course documents (PDF, PPTX, DOCX) and saving selected lecture materials directly into your local Downloads folder via `chrome.downloads`.
- **Attendance Monitoring:** Detecting open check-in windows, sending optional local desktop notifications (`notifications`), and submitting attendance check-ins on your behalf when initiated by you or configured in Auto-Attendance settings (`alarms`).
- **No Commercial Exploitation or Telemetry:** User data is **never** used for advertising, marketing, profiling, monetization, credit scoring, or training artificial intelligence models. No analytics, tracking pixels, or third-party telemetry libraries are embedded in the extension.
- **Limited Use Policy Compliance:** Our use and handling of information received from Chrome APIs adheres strictly to the Chrome Web Store User Data Policy, including the Limited Use requirements.

---

## 3. User Data Storage, Retention & Security

- **Strictly Local On-Device Storage:** All cached courses, deadlines, timetables, preferences, and local operational logs are stored **exclusively within your local browser storage** via `chrome.storage.local`.
- **Zero Remote Developer Servers:** We do **not** operate, own, or use any remote web servers, external cloud databases, or centralized logging services. No copy of your academic data, cookies, or settings is ever transmitted to the developer.
- **Data Security in Transit & at Rest:**
  - **In Transit:** All network requests are encrypted using industry-standard modern cryptography over **HTTPS (TLS 1.2/1.3)** directly between your browser and Universiti Malaya's official endpoints (`https://spectrum.um.edu.my`).
  - **At Rest:** Data is isolated within Chrome's sandboxed local extension storage directory on your personal device, protected by your operating system and browser security barriers.
- **Data Retention & User Deletion:**
  - Data remains in local browser storage only for as long as you keep the extension installed or until you choose to clear it.
  - You can immediately delete all stored data at any time by clicking **Clear Cache** in the Preferences tab or by uninstalling the extension, which permanently purges all local storage.

---

## 4. User Data Sharing and List of All Third Parties

- **Zero Third-Party Sharing:** SPeCTRUM Pro **does not share, sell, rent, license, or disclose user data to any third party**.
- **Comprehensive List of All Communicated Parties:**
  - **Universiti Malaya SPeCTRUM Portal (`https://spectrum.um.edu.my`) — The Only External Endpoint:** The extension communicates **exclusively and directly** with Universiti Malaya's official server over HTTPS to synchronize course content and attendance. No intermediary, proxy, or third-party API is involved.
  - **Third Parties / Vendors / Advertisers / Cloud Hosts:** **None.** No user data is transmitted to any third party.

---

## 5. In-Product Prominent Disclosure and User Consent

In compliance with the Chrome Web Store User Data Policy regarding Prominent Disclosures:
- When SPeCTRUM Pro is first launched, it presents an **in-product Prominent Privacy & Data Disclosure modal** within the extension interface.
- This disclosure clearly outlines what data is accessed (MoodleSession cookie, course content), how it is processed (100% locally), and that no third parties receive data.
- **No data is accessed, collected, or synchronized until the user grants explicit affirmative consent** by clicking the "Agree & Continue" button.
- Users can review this disclosure and privacy policy at any time from the extension's Preferences and About sections.

---

## 6. Permissions Justification Summary

| Permission | Technical Justification |
| :--- | :--- |
| **`storage`** | Stores enrolled courses, deadlines, timetable entries, OCC settings, and preferences locally via `chrome.storage.local`. |
| **`cookies`** | Inspects the active `MoodleSession` cookie on `https://spectrum.um.edu.my` to verify authentication status without handling credentials. |
| **`downloads`** | Saves lecture slides, assignments, and study materials directly to your device's Downloads directory upon request. |
| **`activeTab`** | Provides temporary access only when you press `Alt+S` or click "Pin Floating Window" to mount the floating companion overlay. |
| **`scripting`** | Injects the local floating companion interface into the active tab when invoked via `activeTab`. |
| **`alarms`** | Schedules periodic background attendance checks when the user opts into Auto-Attendance monitoring. |
| **`notifications`** | Displays optional local desktop alerts when an attendance window opens or check-in is recorded. |
| **`host_permissions`** (`https://spectrum.um.edu.my/*`) | Restricted strictly to Universiti Malaya's official LMS portal to fetch course materials, announcements, and attendance sessions. |
| **`commands`** (`Alt+S`) | Keyboard shortcut to toggle the optional floating companion overlay. |

---

## 7. Open Source Transparency & Contact

- **Source Code Repository:** SPeCTRUM Pro is fully open-source and auditable on GitHub: [https://github.com/JSSY108/SPeCTRUM-PRO](https://github.com/JSSY108/SPeCTRUM-PRO)
- **Non-Affiliation Notice:** SPeCTRUM Pro is an independent academic tool developed by students and is not officially affiliated with, endorsed by, or maintained by Universiti Malaya (UM).
- **Contact & Inquiries:** If you have questions about this Privacy Policy or your data, please contact the developer via GitHub Issues at [https://github.com/JSSY108/SPeCTRUM-PRO/issues](https://github.com/JSSY108/SPeCTRUM-PRO/issues) or by email at `jonathansia108@gmail.com`.
