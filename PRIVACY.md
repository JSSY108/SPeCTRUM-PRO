# Privacy Policy — SPeCTRUM Pro™

**Last Updated:** November 5, 2026

SPeCTRUM Pro ("we", "our", or "the extension") is an independent, open-source productivity suite and companion extension built for students of **Universiti Malaya (UM)** accessing the SPeCTRUM Learning Management System (`spectrum.um.edu.my`).

Your privacy is our highest priority. SPeCTRUM Pro is designed with a **privacy-first, local-only architecture**: we do not collect, track, sell, or transmit any of your personal information, credentials, or browsing history to any remote server.

---

## 1. Information Handling & Local-Only Architecture

- **No Remote Servers or Telemetry:** SPeCTRUM Pro operates entirely within your local browser sandbox. There is **zero external telemetry**, analytics, or tracking software embedded in the extension.
- **Local Storage (`chrome.storage.local`):** All course metadata, deadline schedules, user OCC preferences, timetable views, and cached activity logs are stored **strictly on your personal device** within your browser's isolated local storage.
- **Authentication & Login Data:** SPeCTRUM Pro never prompts for, reads, or stores your student password. When you log into SPeCTRUM via Microsoft Single Sign-On (SSO), your session authentication cookies are managed securely by your browser.

---

## 2. Chrome Permissions & Why They Are Needed

SPeCTRUM Pro requests only the minimal permissions required to deliver its core student productivity features:

| Permission | Purpose |
| :--- | :--- |
| **`storage`** | Saves your enrolled course names, timetable preferences, OCC group settings, and offline cached activities on your device. |
| **`downloads`** | Powers the one-click batch downloader for saving lecture notes, slide decks (PDF, PPTX), and course files organized by course and week into your Downloads folder. |
| **`cookies`** | Reads the active session authentication cookie from `spectrum.um.edu.my` to verify that you are logged in, without needing to handle or store your credentials. |
| **`alarms`** | Runs a background periodic timer to check if an active class attendance check-in window has opened. |
| **`notifications`** | Delivers desktop alerts when a class attendance session opens so you never miss check-in. |
| **`sidePanel`** | Allows students to open the SPeCTRUM Pro workstation side-by-side in Chrome while viewing other study materials. |
| **`host_permissions`** (`spectrum.um.edu.my`, `login.microsoftonline.com`) | Communicates directly and exclusively with Universiti Malaya LMS endpoints to retrieve your enrolled course materials and support Microsoft SSO authentication. |
| **`commands`** (`Alt+S`) | Enables an optional floating companion widget so you can glance at your timetable from any tab without losing your study context. |

---

## 3. Data Sharing & Third Parties

- **We do not sell, rent, or monetize user data.**
- **We do not share your data with third parties.**
- **We do not use user data for advertising, creditworthiness assessment, or profiling.**

---

## 4. Open Source & Transparency

SPeCTRUM Pro is fully open-source. Anyone can inspect and verify our source code, network requests, and permissions implementation on GitHub:
[https://github.com/JSSY108/SPeCTRUM-PRO](https://github.com/JSSY108/SPeCTRUM-PRO)

---

## 5. Disclaimer & Affiliation

SPeCTRUM Pro is an unofficial open-source utility developed independently by and for Universiti Malaya students. It is **not affiliated with, maintained by, or officially endorsed by Universiti Malaya (UM)**.

---

## 6. Contact

If you have any questions or feedback regarding this Privacy Policy or SPeCTRUM Pro, please open an issue on the official GitHub repository or contact the developer.

