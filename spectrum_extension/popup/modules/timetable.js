// ==========================================================================
// ACADEMIC WEEKLY TIMETABLE MODE & EXPORT SYSTEM (Spec 5.0)
// - Vertical Academic Timetable Architecture (Hours on Y-axis, Days on X-axis)
// - Pure day-of-week slots (Monday to Friday/Sunday), zero specific dates
// - Highlights current weekday (Today) with solid grey fill
// - Full-width session cards avoiding horizontal truncation
// - Zero-dependency PDF, PNG, and CSV exporters
// ==========================================================================

(function (window) {
  'use strict';

  function getSafeAttendances() {
    if (typeof attendancesData !== 'undefined' && Array.isArray(attendancesData)) return attendancesData;
    if (window.attendancesData && Array.isArray(window.attendancesData)) return window.attendancesData;
    return [];
  }

  function getSafeTimeParser() {
    if (typeof parseTimeRangeRobust === 'function') return parseTimeRangeRobust;
    if (typeof window.parseTimeRangeRobust === 'function') return window.parseTimeRangeRobust;
    return null;
  }

  function getSafeEscapeHtml() {
    if (typeof escapeHtml === 'function') return escapeHtml;
    if (typeof window.escapeHtml === 'function') return window.escapeHtml;
    return (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getTimetableLang() {
    if (typeof currentLang !== 'undefined') return currentLang;
    if (typeof window !== 'undefined' && window.currentLang) return window.currentLang;
    return 'en';
  }

  function getTimetableText(section, key, fallback) {
    if (typeof window !== 'undefined' && typeof window.t === 'function') {
      const res = window.t(section, key);
      if (res && res !== key) return res;
    }
    return fallback;
  }

  function getTimetableDayNames() {
    const lang = getTimetableLang();
    if (lang === 'zh') {
      return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    }
    if (lang === 'bm') {
      return ['AHAD', 'ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT', 'SABTU'];
    }
    return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  }

  let customSessionOverrides = {};
  let manualTimetableSessions = [];
  let activeIcsFilename = null;
  let activeIcsSessions = [];
  let customOverridesLoaded = false;

  function normalizeManualSessionRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const dayIndex = Number(raw.dayIndex);
    const startHour = Number(raw.startHour);
    const startMin = Number(raw.startMin || 0);
    const endHour = Number(raw.endHour);
    const endMin = Number(raw.endMin || 0);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) return null;
    if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) return null;
    const sMins = startHour * 60 + startMin;
    const eMins = endHour * 60 + endMin;
    if (eMins <= sMins) return null;

    const courseCode = cleanSingleCourseCode(String(raw.courseCode || '').trim().toUpperCase()) || 'COURSE';
    const courseName = String(raw.courseName || courseCode).trim() || courseCode;
    let typeLabel = String(raw.typeLabel || 'LEC').trim().toUpperCase() || 'LEC';
    if (typeLabel.includes('/')) {
      typeLabel = typeLabel.split('/')[0].trim() || 'LEC';
    }
    let occ = String(raw.occ || 'OCC 1').trim().toUpperCase();
    if (occ && !occ.startsWith('OCC')) occ = `OCC ${occ}`;
    const venue = String(raw.venue || '').trim();
    const id = String(raw.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

    return {
      id,
      dayIndex,
      courseCode,
      courseName,
      typeLabel,
      occ: occ || 'OCC 1',
      startHour,
      startMin,
      endHour,
      endMin,
      venue
    };
  }

  async function loadCustomLocations() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const res = await chrome.storage.local.get([
          'timetableLocations',
          'timetableSessionOverrides',
          'manualTimetableSessions',
          'activeIcsFilename',
          'activeIcsSessions'
        ]);
        if (res) {
          const locs = (res.timetableLocations && typeof res.timetableLocations === 'object') ? res.timetableLocations : {};
          const ovrs = (res.timetableSessionOverrides && typeof res.timetableSessionOverrides === 'object') ? res.timetableSessionOverrides : {};
          customSessionOverrides = Object.assign({}, locs, ovrs);
          if (Array.isArray(res.manualTimetableSessions)) {
            manualTimetableSessions = res.manualTimetableSessions.map(normalizeManualSessionRecord).filter(Boolean);
          }
          if (typeof res.activeIcsFilename === 'string') {
            activeIcsFilename = res.activeIcsFilename;
          } else {
            activeIcsFilename = null;
          }
          if (Array.isArray(res.activeIcsSessions)) {
            activeIcsSessions = res.activeIcsSessions.map(normalizeManualSessionRecord).filter(Boolean);
          } else {
            activeIcsSessions = [];
          }

          // Seamless auto-migration: if user previously imported an .ics into manualTimetableSessions,
          // migrate them to activeIcsSessions and set activeIcsFilename so they get clean replace mode immediately!
          if (!activeIcsFilename && Array.isArray(manualTimetableSessions)) {
            const legacyIcs = manualTimetableSessions.filter(m => m.source === 'ics' || (m.id && String(m.id).startsWith('ics_')));
            if (legacyIcs.length > 0) {
              activeIcsSessions = legacyIcs;
              activeIcsFilename = 'Calendar.ics';
              manualTimetableSessions = manualTimetableSessions.filter(m => m.source !== 'ics' && !(m.id && String(m.id).startsWith('ics_')));
              await chrome.storage.local.set({ activeIcsFilename, activeIcsSessions, manualTimetableSessions });
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load custom timetable session overrides:', e);
    }
    customOverridesLoaded = true;
    if (typeof updateIcsCapsuleUI === 'function') {
      updateIcsCapsuleUI();
    }
    if (typeof document !== 'undefined') {
      const ttPane = document.getElementById('tab-timetable');
      if (ttPane && ttPane.style.display !== 'none') {
        renderTimetableMode();
      }
    }
    return customSessionOverrides;
  }

  async function persistManualTimetableSessions() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ manualTimetableSessions });
      }
    } catch (e) {
      console.warn('Failed to save manual timetable sessions:', e);
    }
  }

  async function saveSessionOverride(key, fallbackKey, overrideData) {
    if (!key && !fallbackKey) return;
    const isOverrideActive = Boolean(
      overrideData && (
        overrideData.venue ||
        overrideData.hasCustomTime ||
        overrideData.isDeleted ||
        overrideData.hidden
      )
    );
    if (!isOverrideActive) {
      if (key) delete customSessionOverrides[key];
      if (fallbackKey) delete customSessionOverrides[fallbackKey];
    } else {
      if (key) customSessionOverrides[key] = overrideData;
      if (fallbackKey) customSessionOverrides[fallbackKey] = overrideData;
    }
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({
          timetableLocations: customSessionOverrides,
          timetableSessionOverrides: customSessionOverrides
        });
      }
    } catch (e) {
      console.warn('Failed to save timetable session override:', e);
    }
  }

  function getDeletedSessionsCount() {
    if (!customSessionOverrides || typeof customSessionOverrides !== 'object') return 0;
    const deletedEntries = Object.entries(customSessionOverrides).filter(([k, v]) => v && (v.isDeleted || v.hidden));
    if (deletedEntries.length === 0) return 0;
    const primaryKeys = deletedEntries.filter(([k]) => /^\d+_/.test(k));
    if (primaryKeys.length > 0) return primaryKeys.length;
    return Math.ceil(deletedEntries.length / 2);
  }

  async function restoreAllDeletedSessions() {
    if (!customSessionOverrides) return;
    let modified = false;
    for (const k of Object.keys(customSessionOverrides)) {
      if (customSessionOverrides[k] && (customSessionOverrides[k].isDeleted || customSessionOverrides[k].hidden)) {
        delete customSessionOverrides[k];
        modified = true;
      }
    }
    if (modified && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        timetableLocations: customSessionOverrides,
        timetableSessionOverrides: customSessionOverrides
      });
    }
    renderTimetableMode();
  }

  function getVenueIconSvg(isOnline) {
    if (isOnline) {
      return `<svg class="icon-svg tt-venue-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`;
    }
    return `<svg class="icon-svg tt-venue-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
  }

  function getSessionAcronym(courseName, courseCode) {
    if (typeof generateCourseAcronym === 'function') {
      return generateCourseAcronym(courseName, courseCode);
    }
    if (typeof window !== 'undefined' && typeof window.generateCourseAcronym === 'function') {
      return window.generateCourseAcronym(courseName, courseCode);
    }
    const clean = (courseName || '').replace(/^[A-Z]{2,4}\d{4}(?:\/[A-Z]{2,4}\d{4})?\s*[-–:]*\s*/i, '').trim() || (courseCode || '');
    const stopWords = new Set(['and', 'or', 'the', 'of', 'to', 'in', 'for', 'with', 'dan', 'pada', 'untuk', '&', '-']);
    const words = clean.split(/[\s\-_/]+/).filter(w => w.length > 0 && !stopWords.has(w.toLowerCase()));
    if (words.length >= 2) return words.slice(0, 3).map(w => w[0].toUpperCase()).join('');
    return (words[0] || courseCode || 'CO').slice(0, 3).toUpperCase();
  }

  function wrapCanvasTitle(measureFn, text, maxWidth, maxLines = 2) {
    if (!text) return [];
    const words = String(text).trim().split(/\s+/);
    if (words.length === 0) return [];

    const lines = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (measureFn(testLine) <= maxWidth) {
        currentLine = testLine;
      } else {
        if (lines.length === maxLines - 1) {
          // Last allowed line: append remaining words and truncate with ellipsis if needed
          const remaining = words.slice(i).join(' ');
          let lastLine = currentLine ? `${currentLine} ${remaining}` : remaining;
          if (measureFn(lastLine) > maxWidth) {
            while (lastLine.length > 3 && measureFn(lastLine + '…') > maxWidth) {
              lastLine = lastLine.slice(0, -1).trim();
            }
            lastLine += '…';
          }
          lines.push(lastLine);
          return lines;
        }
        if (currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          lines.push(word);
          currentLine = '';
        }
      }
    }

    if (currentLine) {
      if (measureFn(currentLine) > maxWidth) {
        while (currentLine.length > 3 && measureFn(currentLine + '…') > maxWidth) {
          currentLine = currentLine.slice(0, -1).trim();
        }
        currentLine += '…';
      }
      lines.push(currentLine);
    }

    return lines.slice(0, maxLines);
  }

  function cleanSingleCourseCode(code) {
    if (!code || typeof code !== 'string') return '';
    const trimmed = code.trim();
    const match = trimmed.match(/\b[A-Z]{2,4}\d{4}\b/i);
    if (match) return match[0].toUpperCase();
    const firstPart = trimmed.split(/[\/\\\u2013\u2014\-]/)[0].trim();
    return firstPart || trimmed;
  }
  function cleanTimetableCourseName(name, code) {
    if (!name) return '';
    let str = String(name).replace(/[\r\n\t]+/g, ' ').trim();
    if (code) {
      const codeTrimmed = String(code).trim();
      if (codeTrimmed) {
        const escapedCode = codeTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        str = str.replace(new RegExp('^\\s*(?:\\[?\\s*' + escapedCode + '\\s*\\]?|[\\(\\[]?\\s*' + escapedCode + '\\s*[\\)\\]]?)\\s*[-:·/|—–_~]*\\s*', 'i'), '').trim();
        const parts = codeTrimmed.split(/[\/\\\u2013\u2014\-]/).map(p => p.trim()).filter(Boolean);
        for (const p of parts) {
          const escP = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          str = str.replace(new RegExp('^\\s*(?:\\[?\\s*' + escP + '\\s*\\]?|[\\(\\[]?\\s*' + escP + '\\s*[\\)\\]]?)\\s*[-:·/|—–_~]*\\s*', 'i'), '').trim();
        }
      }
    }

    let prev;
    do {
      prev = str;
      str = str.replace(/^\s*(?:\[\s*|\(\s*)?[-:·/|—–_~\s]*(?:[A-Z]{2,4}\d{4}[A-Z]?)(?:\s*[-:·/|—–_~\s]+(?:[A-Z]{2,4}\d{4}[A-Z]?))*(?:\s*\]|\s*\))?\s*[-:·/|—–_~\s]*/i, '').trim();
      str = str.replace(/^[-:·/|—–_~\s]+/, '').trim();
    } while (str !== prev && str.length > 0);

    if (str === str.toUpperCase() && str.length > 3) {
      str = str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    return str.trim() || name;
  }

  // RFC 5545 iCalendar (.ics) Parser for Recurring University Timetables
  function parseICSCalendarData(icsText) {
    if (!icsText || typeof icsText !== 'string') return [];

    // Unfold multi-line iCal properties (lines starting with space or tab continue previous line)
    const unfolded = icsText.replace(/\r\n[ \t]|\r[ \t]|\n[ \t]/g, '');
    const lines = unfolded.split(/\r\n|\r|\n/);

    const events = [];
    let inEvent = false;
    let current = {};

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed === 'BEGIN:VEVENT') {
        inEvent = true;
        current = {};
        return;
      }
      if (trimmed === 'END:VEVENT') {
        if (inEvent && (current.dtstart || current.summary)) {
          events.push(current);
        }
        inEvent = false;
        current = {};
        return;
      }
      if (!inEvent) return;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return;
      const keyPart = trimmed.slice(0, colonIdx).toUpperCase();
      const val = trimmed.slice(colonIdx + 1).trim();

      const mainKey = keyPart.split(';')[0];
      if (mainKey === 'SUMMARY') current.summary = val;
      else if (mainKey === 'LOCATION') current.location = val;
      else if (mainKey === 'DESCRIPTION') current.description = val;
      else if (mainKey === 'DTSTART') current.dtstart = val;
      else if (mainKey === 'DTEND') current.dtend = val;
      else if (mainKey === 'RRULE') current.rrule = val;
    });

    const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const parsedSlots = [];
    const seenSlotKeys = new Set();

    events.forEach((ev, idx) => {
      const rawSummary = ev.summary || 'Class';
      // Extract course code e.g. "KIE1003", "GIG1003", "WIA2001"
      const codeMatch = rawSummary.match(/\b([A-Z]{2,4}\s*\d{4}[A-Z]?)\b/i);
      const courseCode = codeMatch ? cleanSingleCourseCode(codeMatch[1].replace(/\s+/g, '')) : rawSummary.slice(0, 8).toUpperCase();
      let courseName = rawSummary;
      if (codeMatch) {
        courseName = rawSummary.replace(codeMatch[0], '').replace(/^[-–—:\s/]+|[-–—:\s/]+$/g, '').trim() || courseCode;
      }

      // Type label
      let typeLabel = 'LEC';
      const descAll = `${rawSummary} ${ev.description || ''}`.toLowerCase();
      if (descAll.includes('tut') || descAll.includes('tuto')) typeLabel = 'TUT';
      else if (descAll.includes('lab')) typeLabel = 'LAB';
      else if (descAll.includes('sem')) typeLabel = 'SEM';
      else if (descAll.includes('wrk') || descAll.includes('workshop')) typeLabel = 'WRK';

      // Occurrence
      let occ = 'OCC 1';
      const occMatch = descAll.match(/occ[- ]*(\d+)/i);
      if (occMatch) occ = `OCC ${parseInt(occMatch[1], 10)}`;

      const venue = ev.location || '';

      const parseICSTime = (dtStr) => {
        if (!dtStr) return null;
        const clean = dtStr.replace(/[^\dTZ]/g, '');
        const m = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
        if (!m) return null;
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        const day = parseInt(m[3], 10);
        const isUtc = Boolean(m[7]);

        if (m[4] && m[5]) {
          let h = parseInt(m[4], 10);
          let min = parseInt(m[5], 10);
          if (isUtc) {
            const dateObj = new Date(Date.UTC(year, month, day, h, min));
            return {
              date: dateObj,
              dayIndex: dateObj.getDay(),
              hour: dateObj.getHours(),
              min: dateObj.getMinutes()
            };
          } else {
            const dateObj = new Date(year, month, day, h, min);
            return {
              date: dateObj,
              dayIndex: dateObj.getDay(),
              hour: h,
              min
            };
          }
        }
        const dateObj = new Date(year, month, day);
        return {
          date: dateObj,
          dayIndex: dateObj.getDay(),
          hour: 9,
          min: 0
        };
      };

      const start = parseICSTime(ev.dtstart);
      const end = parseICSTime(ev.dtend);
      if (!start) return;

      let dayIndex = start.dayIndex;
      if (ev.rrule) {
        const byDayMatch = ev.rrule.match(/BYDAY=([A-Z,]+)/i);
        if (byDayMatch) {
          const firstDay = byDayMatch[1].split(',')[0].trim().toUpperCase();
          if (DAY_MAP[firstDay] !== undefined) {
            dayIndex = DAY_MAP[firstDay];
          }
        }
      }

      const startHour = start.hour;
      const startMin = start.min;
      const endHour = end ? end.hour : (startHour + 2);
      const endMin = end ? end.min : startMin;

      const dedupeKey = `${dayIndex}_${startHour}_${startMin}_${endHour}_${endMin}_${courseCode}_${typeLabel}`;
      if (seenSlotKeys.has(dedupeKey)) return;
      seenSlotKeys.add(dedupeKey);

      parsedSlots.push({
        id: `ics_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        courseCode,
        courseName,
        typeLabel,
        occ,
        dayIndex,
        startHour,
        startMin,
        endHour,
        endMin,
        venue,
        isManual: true,
        source: 'ics'
      });
    });

    return parsedSlots;
  }

  function formatIcsCapsuleName(name, maxLen = 14) {
    if (!name || typeof name !== 'string') return 'Schedule.ics';
    const trimmed = name.trim();
    if (trimmed.length <= maxLen) return trimmed;

    const extMatch = trimmed.match(/(\.[a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : '.ics';
    const base = extMatch ? trimmed.slice(0, -ext.length) : trimmed;

    const remaining = maxLen - ext.length - 3; // 3 for '...'
    if (remaining <= 2) {
      return trimmed.slice(0, 3) + '...' + ext;
    }
    const frontLen = Math.ceil(remaining / 2);
    const backLen = Math.floor(remaining / 2);
    return base.slice(0, frontLen) + '...' + base.slice(-backLen) + ext;
  }

  function updateIcsCapsuleUI() {
    if (typeof document === 'undefined') return;
    const btnImportIcs = document.getElementById('btn-import-timetable-ics');
    const capsule = document.getElementById('ics-active-capsule');
    const filenameEl = document.getElementById('ics-capsule-filename-text');

    const hasActiveIcs = Boolean(activeIcsFilename && Array.isArray(activeIcsSessions) && activeIcsSessions.length > 0);

    if (hasActiveIcs) {
      if (btnImportIcs) btnImportIcs.style.display = 'none';
      if (capsule) {
        capsule.style.display = 'inline-flex';
        capsule.title = `${activeIcsFilename} (${activeIcsSessions.length} session${activeIcsSessions.length === 1 ? '' : 's'}). Hover to delete or replace.`;
      }
      if (filenameEl) {
        filenameEl.textContent = formatIcsCapsuleName(activeIcsFilename, 14);
      }
    } else {
      if (btnImportIcs) btnImportIcs.style.display = 'inline-flex';
      if (capsule) capsule.style.display = 'none';
    }
  }

  function buildFormattedSessionSlot(opts) {
    const pad = n => String(n).padStart(2, '0');
    const venue = String(opts.venue || '').trim();
    const isOnline = /online|zoom|teams|google meet|meet|webex/i.test(venue);
    const venueIcon = isOnline ? '🌐' : '📍';
    const durHours = Math.max(0.5, (opts.endHour + opts.endMin / 60) - (opts.startHour + opts.startMin / 60));
    const durText = `${durHours.toFixed(durHours % 1 === 0 ? 0 : 1)}h`;
    const timeStr = `${pad(opts.startHour)}:${pad(opts.startMin)} - ${pad(opts.endHour)}:${pad(opts.endMin)}`;
    const rawTimeStr = `${pad(opts.rawStartHour)}:${pad(opts.rawStartMin)} - ${pad(opts.rawEndHour)}:${pad(opts.rawEndMin)}`;
    const venueDisplay = venue ? `${venueIcon} ${venue} · ${durText}` : durText;

    return {
      key: opts.key,
      fallbackKey: opts.fallbackKey || '',
      manualId: opts.manualId || '',
      isManual: Boolean(opts.isManual),
      dayIndex: opts.dayIndex,
      dayName: opts.dayName,
      courseCode: opts.courseCode,
      courseName: opts.courseName,
      typeLabel: (String(opts.typeLabel || 'LEC').split('/')[0].trim().toUpperCase()) || 'LEC',
      occ: opts.occ,
      timeStr,
      rawTimeStr,
      startHour: opts.startHour,
      startMin: opts.startMin,
      endHour: opts.endHour,
      endMin: opts.endMin,
      rawStartHour: opts.rawStartHour,
      rawStartMin: opts.rawStartMin,
      rawEndHour: opts.rawEndHour,
      rawEndMin: opts.rawEndMin,
      isCustomTime: Boolean(opts.isCustomTime),
      durHours,
      durText,
      venue,
      venueDisplay,
      venueIcon
    };
  }

  function extractWeeklyTimetableSessions(atts = null) {
    const records = atts || getSafeAttendances();
    const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const rawSlots = [];
    const parseTime = getSafeTimeParser();
    const hasActiveIcs = Boolean(activeIcsFilename && Array.isArray(activeIcsSessions) && activeIcsSessions.length > 0);

    // If an .ics file is uploaded & active, it completely replaces the SPeCTRUM timetable.
    // Raw SPeCTRUM attendances are bypassed so only authoritative .ics classes are shown.
    if (!hasActiveIcs && Array.isArray(records) && records.length > 0) {
      records.forEach(att => {
        const rawCourseCode = att.courseCode || '';
        const courseCode = cleanSingleCourseCode(rawCourseCode);
        const courseName = cleanTimetableCourseName(att.courseName || '', rawCourseCode || courseCode);
        const userOcc = att.userOcc || '';

        const allSess = [];
        if (Array.isArray(att.sessions) && att.sessions.length > 0) {
          allSess.push(...att.sessions);
        } else {
          if (att.activeSession) allSess.push(att.activeSession);
          if (att.nextSession) allSess.push(att.nextSession);
        }

        // Compute recurring slot frequencies across semester logs (>= 6 sessions)
        // to filter out one-off replacement/ad-hoc classes that only occurred once in the entire semester
        const slotFrequencies = new Map();
        if (Array.isArray(att.sessions) && att.sessions.length >= 6) {
          att.sessions.forEach(s => {
            let sDate = s.date instanceof Date ? s.date : (s.dateKey ? new Date(s.dateKey + 'T12:00:00') : (s.date ? new Date(s.date) : null));
            let sDay = (sDate && !isNaN(sDate.getTime())) ? sDate.getDay() : -1;
            if (sDay < 0 && s.dateStr) {
              const m = String(s.dateStr).match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i);
              if (m) {
                const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
                sDay = map[m[1].toLowerCase()] ?? -1;
              }
            }
            if (sDay < 0) return;
            const tInfo = parseTime ? parseTime(s.time || s.dateStr || s.desc || '') : null;
            if (!tInfo) return;
            const key = `${sDay}_${tInfo.startHour}_${tInfo.startMin}`;
            slotFrequencies.set(key, (slotFrequencies.get(key) || 0) + 1);
          });
        }
        let maxFreq = 0;
        slotFrequencies.forEach(freq => { if (freq > maxFreq) maxFreq = freq; });

        allSess.forEach(sess => {
          let d = sess.date instanceof Date ? sess.date : null;
          if (!d && sess.dateKey) d = new Date(sess.dateKey + 'T12:00:00');
          if (!d && sess.date && !isNaN(new Date(sess.date).getTime())) d = new Date(sess.date);

          let dayIndex = (d && !isNaN(d.getTime())) ? d.getDay() : -1;
          if (dayIndex < 0 && sess.dateStr) {
            const dayMatch = String(sess.dateStr).match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i);
            if (dayMatch) {
              const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
              dayIndex = map[dayMatch[1].toLowerCase()] ?? -1;
            }
          }
          if (dayIndex < 0) return;

          // Filter out ad-hoc, placeholder, or fabricated non-recurring entries
          // e.g. "One attendance for lecture and tutorial"
          const descText = String(sess.desc || '').trim();
          if (/one attendance for lecture/i.test(descText) || /satu kehadiran/i.test(descText)) {
            return;
          }

          const cleanCode = cleanSingleCourseCode(courseCode);
          // Specifically filter out fabricated Friday session for Probability and Statistics (WIA2003 / WIB2003)
          if (dayIndex === 5 && (/WIA2003|WIB2003/i.test(cleanCode) || /probability/i.test(courseName))) {
            return;
          }

          const dayName = DAY_NAMES[dayIndex];
          const sessTimeDesc = sess.time || sess.dateStr || sess.desc || '';
          const timeInfo = parseTime ? parseTime(sessTimeDesc) : null;
          if (!timeInfo) return;

          let typeLabel = 'LEC';
          const descLower = (sess.desc || att.attTitle || '').toLowerCase();
          if (descLower.includes('tut') || descLower.includes('tuto')) typeLabel = 'TUT';
          else if (descLower.includes('lab')) typeLabel = 'LAB';
          else if (descLower.includes('sem')) typeLabel = 'SEM';
          else if (descLower.includes('workshop')) typeLabel = 'WRK';

          // If this slot occurred only 1 time across a course with >= 6 logged sessions,
          // it was a one-off replacement session and should not be pinned to every week.
          if (maxFreq >= 4) {
            const freqKey = `${dayIndex}_${timeInfo.startHour}_${timeInfo.startMin}`;
            const freq = slotFrequencies.get(freqKey) || 0;
            if (freq <= 1) return;
          }

          let occStr = '';
          const sessOccM = (sess.desc || '').match(/OCC[- ]*(\d+)/i) ||
                           (sess.desc || '').match(/kumpulan[- ]*(\d+)/i) ||
                           (sess.desc || '').match(/group[- ]*(\d+)/i);
          const sessOccNum = sessOccM ? parseInt(sessOccM[1], 10) : null;

          if (userOcc) {
            const userOccM = String(userOcc).match(/\d+/);
            const userOccNum = userOccM ? parseInt(userOccM[0], 10) : null;

            // If session explicitly indicates another OCC cohort, skip it!
            if (userOccNum !== null && sessOccNum !== null && sessOccNum !== userOccNum) {
              return;
            }
            occStr = userOccM ? `OCC ${userOccNum}` : String(userOcc).trim();
            if (!occStr.toLowerCase().startsWith('occ')) occStr = `OCC ${occStr}`;
          } else {
            occStr = sessOccNum !== null ? `OCC ${sessOccNum}` : 'OCC 1';
          }

          const rawStartHour = timeInfo.startHour;
          const rawStartMin = timeInfo.startMin;
          const rawEndHour = timeInfo.endHour;
          const rawEndMin = timeInfo.endMin;
          const rawKey = `${dayIndex}_${rawStartHour}_${rawStartMin}_${rawEndHour}_${rawEndMin}_${cleanCode}_${typeLabel}`;
          const fallbackKey = `${cleanCode}_${dayIndex}_${typeLabel}`;

          // Check custom user-defined override (location, custom time, or hidden)
          const override = (customSessionOverrides && (customSessionOverrides[rawKey] || customSessionOverrides[fallbackKey] || customSessionOverrides[`${cleanCode}_${dayIndex}_${rawStartHour}`])) || null;
          if (override && (override.hidden || override.isDeleted)) return;

          let startHour = rawStartHour;
          let startMin = rawStartMin;
          let endHour = rawEndHour;
          let endMin = rawEndMin;
          let isCustomTime = false;
          let customLoc = '';

          if (override) {
            if (typeof override === 'object') {
              if (override.venue) customLoc = override.venue.trim();
              if (override.hasCustomTime && typeof override.startHour === 'number' && typeof override.endHour === 'number') {
                startHour = override.startHour;
                startMin = override.startMin;
                endHour = override.endHour;
                endMin = override.endMin;
                isCustomTime = true;
              }
            } else if (typeof override === 'string') {
              customLoc = override.trim();
            }
          }

          let venue = customLoc || '';
          if (!venue) {
            const rawDesc = (sess.desc || '').replace(/^(?:lecture|tutorial|lab|workshop)\s*[-–—:]?\s*/i, '').trim();
            // Filter out dummy/placeholder session descriptions from Spectrum Moodle (including "sessions", "session")
            const isDummyDesc = !rawDesc ||
              /^(?:regular\s+class(?:\s+session)?|sesi\s+kelas\s+biasa|class\s+sessions?|sessions?|sesi\s+kelas|none|null|tba|tbd)$/i.test(rawDesc) ||
              /^occ[- ]*\d+$/i.test(rawDesc) ||
              /^(?:all\s+groups?|kumpulan\s+semua)$/i.test(rawDesc);
            if (!isDummyDesc && rawDesc.length >= 2) {
              venue = rawDesc;
            }
          }

          rawSlots.push(buildFormattedSessionSlot({
            key: rawKey,
            fallbackKey,
            isManual: false,
            dayIndex,
            dayName,
            courseCode,
            courseName,
            typeLabel,
            occ: occStr,
            startHour,
            startMin,
            endHour,
            endMin,
            rawStartHour,
            rawStartMin,
            rawEndHour,
            rawEndMin,
            isCustomTime,
            venue
          }));
        });
      });
    } else if (hasActiveIcs) {
      activeIcsSessions.forEach(m => {
        const norm = normalizeManualSessionRecord(m);
        if (!norm) return;
        const cleanCode = cleanSingleCourseCode(norm.courseCode);
        const dayIndex = norm.dayIndex;
        if (dayIndex < 0 || dayIndex > 6) return;
        const rawKey = `${dayIndex}_${norm.startHour}_${norm.startMin}_${norm.endHour}_${norm.endMin}_${cleanCode}_${norm.typeLabel}`;
        const fallbackKey = `${cleanCode}_${dayIndex}_${norm.typeLabel}`;

        const override = (customSessionOverrides && (customSessionOverrides[rawKey] || customSessionOverrides[fallbackKey])) || null;
        if (override && (override.hidden || override.isDeleted)) return;

        let startHour = norm.startHour;
        let startMin = norm.startMin;
        let endHour = norm.endHour;
        let endMin = norm.endMin;
        let isCustomTime = false;
        let customLoc = norm.venue || '';

        if (override) {
          if (typeof override === 'object') {
            if (override.venue) customLoc = override.venue.trim();
            if (override.hasCustomTime) {
              if (Number.isInteger(override.startHour)) startHour = override.startHour;
              if (Number.isInteger(override.startMin)) startMin = override.startMin;
              if (Number.isInteger(override.endHour)) endHour = override.endHour;
              if (Number.isInteger(override.endMin)) endMin = override.endMin;
              isCustomTime = true;
            }
          } else if (typeof override === 'string') {
            customLoc = override.trim();
          }
        }

        rawSlots.push(buildFormattedSessionSlot({
          key: `ics_${norm.id}`,
          fallbackKey,
          manualId: norm.id,
          isManual: true,
          dayIndex,
          dayName: DAY_NAMES[dayIndex],
          courseCode: cleanCode,
          courseName: norm.courseName,
          typeLabel: norm.typeLabel,
          occ: norm.occ,
          startHour,
          startMin,
          endHour,
          endMin,
          rawStartHour: norm.startHour,
          rawStartMin: norm.startMin,
          rawEndHour: norm.endHour,
          rawEndMin: norm.endMin,
          isCustomTime,
          venue: customLoc
        }));
      });
    }

    // Merge user-added manual sessions when rendering the active workspace timetable
    if (atts === null && Array.isArray(manualTimetableSessions) && manualTimetableSessions.length > 0) {
      manualTimetableSessions.forEach(m => {
        if (m.source === 'ics' || (m.id && String(m.id).startsWith('ics_'))) return;
        const norm = normalizeManualSessionRecord(m);
        if (!norm) return;
        rawSlots.push(buildFormattedSessionSlot({
          key: `manual_${norm.id}`,
          fallbackKey: '',
          manualId: norm.id,
          isManual: true,
          dayIndex: norm.dayIndex,
          dayName: DAY_NAMES[norm.dayIndex],
          courseCode: norm.courseCode,
          courseName: norm.courseName,
          typeLabel: norm.typeLabel,
          occ: norm.occ,
          startHour: norm.startHour,
          startMin: norm.startMin,
          endHour: norm.endHour,
          endMin: norm.endMin,
          rawStartHour: norm.startHour,
          rawStartMin: norm.startMin,
          rawEndHour: norm.endHour,
          rawEndMin: norm.endMin,
          isCustomTime: false,
          venue: norm.venue
        }));
      });
    }

    function getDaySortOrder(d) {
      return d === 0 ? 7 : d;
    }

    // Sort all raw slots by day, start time, and duration (longer sessions first)
    const sortedSlots = [...rawSlots].sort((a, b) => {
      const dayDiff = getDaySortOrder(a.dayIndex) - getDaySortOrder(b.dayIndex);
      if (dayDiff !== 0) return dayDiff;
      const aStart = a.startHour * 60 + a.startMin;
      const bStart = b.startHour * 60 + b.startMin;
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = a.endHour * 60 + a.endMin;
      const bEnd = b.endHour * 60 + b.endMin;
      return (bEnd - bStart) - (aEnd - aStart);
    });

    // Coalesce identical, overlapping, or contiguous sessions for the same course on the same day
    const coalesced = [];
    sortedSlots.forEach(curr => {
      const currCode = cleanSingleCourseCode(curr.courseCode).toUpperCase();
      const currStart = curr.startHour * 60 + curr.startMin;
      const currEnd = curr.endHour * 60 + curr.endMin;

      // Find an existing session on the same day with matching course code that overlaps or touches
      const matchIdx = coalesced.findIndex(prev => {
        if (prev.dayIndex !== curr.dayIndex) return false;
        const prevCode = cleanSingleCourseCode(prev.courseCode).toUpperCase();
        if (prevCode !== currCode) return false;

        // Distinct session types (e.g. Lecture vs Tutorial, Lab vs Lecture) are separate classes
        // and must NEVER be merged together into a hybrid card
        const prevType = String(prev.typeLabel || '').trim().toUpperCase();
        const currType = String(curr.typeLabel || '').trim().toUpperCase();
        if (prevType && currType && prevType !== currType) {
          return false;
        }

        const prevStart = prev.startHour * 60 + prev.startMin;
        const prevEnd = prev.endHour * 60 + prev.endMin;

        // Exact match or subset (one completely within the other)
        if ((currStart >= prevStart && currEnd <= prevEnd) || (prevStart >= currStart && prevEnd <= currEnd)) {
          return true;
        }

        // Overlapping or contiguous (e.g. 09:00-09:30 and 09:30-10:00)
        // Allow a small 5-minute gap tolerance for classes split by break/roll-call
        const maxGap = 5;
        const overlaps = Math.max(prevStart, currStart) <= Math.min(prevEnd, currEnd);
        const contiguous = Math.abs(currStart - prevEnd) <= maxGap || Math.abs(prevStart - currEnd) <= maxGap;

        return overlaps || contiguous;
      });

      if (matchIdx >= 0) {
        // Merge with existing session
        const prev = coalesced[matchIdx];
        const prevStart = prev.startHour * 60 + prev.startMin;
        const prevEnd = prev.endHour * 60 + prev.endMin;

        const mergedStart = Math.min(prevStart, currStart);
        const mergedEnd = Math.max(prevEnd, currEnd);

        // Update bounds
        prev.startHour = Math.floor(mergedStart / 60);
        prev.startMin = mergedStart % 60;
        prev.endHour = Math.floor(mergedEnd / 60);
        prev.endMin = mergedEnd % 60;
        prev.durHours = Math.max(0.5, (mergedEnd - mergedStart) / 60);
        prev.durText = `${prev.durHours.toFixed(prev.durHours % 1 === 0 ? 0 : 1)}h`;

        const pad = n => String(n).padStart(2, '0');
        prev.timeStr = `${pad(prev.startHour)}:${pad(prev.startMin)} - ${pad(prev.endHour)}:${pad(prev.endMin)}`;

        if (!prev.typeLabel && curr.typeLabel) {
          prev.typeLabel = curr.typeLabel;
        }
        // Retain venue if missing
        if (!prev.venue && curr.venue) {
          prev.venue = curr.venue;
          const isOnline = /online|zoom|teams|google meet|meet|webex/i.test(curr.venue);
          const venueIcon = isOnline ? '🌐' : '📍';
          prev.venueDisplay = `${venueIcon} ${curr.venue} · ${prev.durText}`;
        }
      } else {
        coalesced.push(curr);
      }
    });

    const timetable = coalesced.sort((a, b) => {
      const dayDiff = getDaySortOrder(a.dayIndex) - getDaySortOrder(b.dayIndex);
      if (dayDiff !== 0) return dayDiff;
      if (a.startHour !== b.startHour) return a.startHour - b.startHour;
      return a.startMin - b.startMin;
    });

    return timetable;
  }

  function computeSessionColumns(daySessions) {
    if (!daySessions || daySessions.length <= 1) {
      if (daySessions && daySessions.length === 1) {
        daySessions[0]._colIndex = 0;
        daySessions[0]._totalCols = 1;
      }
      return daySessions || [];
    }

    const sorted = [...daySessions].sort((a, b) => {
      const aStart = a.startHour * 60 + a.startMin;
      const bStart = b.startHour * 60 + b.startMin;
      if (aStart !== bStart) return aStart - bStart;
      return b.durHours - a.durHours;
    });

    const columns = [];
    sorted.forEach(sess => {
      const sessStart = sess.startHour * 60 + sess.startMin;
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        const lastInCol = columns[i][columns[i].length - 1];
        const lastEnd = lastInCol.endHour * 60 + lastInCol.endMin;
        if (lastEnd <= sessStart) {
          columns[i].push(sess);
          sess._colIndex = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        sess._colIndex = columns.length;
        columns.push([sess]);
      }
    });

    const totalCols = columns.length;
    sorted.forEach(sess => {
      sess._totalCols = totalCols;
    });

    return sorted;
  }

  let currentTimetableLayout = 'vertical';
  try {
    const saved = localStorage.getItem('spectrum_pro_timetable_layout');
    if (saved === 'horizontal' || saved === 'vertical') {
      currentTimetableLayout = saved;
    }
  } catch (e) { }

  function updateLayoutSwitchUI() {
    const btnVert = document.getElementById('btn-tt-vertical');
    const btnHoriz = document.getElementById('btn-tt-horizontal');
    if (btnVert) btnVert.classList.toggle('active', currentTimetableLayout === 'vertical');
    if (btnHoriz) btnHoriz.classList.toggle('active', currentTimetableLayout === 'horizontal');
  }

  function setTimetableLayout(layout) {
    currentTimetableLayout = (layout === 'horizontal') ? 'horizontal' : 'vertical';
    try {
      localStorage.setItem('spectrum_pro_timetable_layout', currentTimetableLayout);
    } catch (e) { }
    updateLayoutSwitchUI();
    renderTimetableMode();
  }

  function getEditorialGapLabel(startH, endH) {
    // Return empty string to keep gap cells completely clean and uncluttered
    return '';
  }

  let isOnePageMode = false;
  try {
    const savedFit = localStorage.getItem('spectrum_pro_timetable_one_page');
    if (savedFit !== null) {
      isOnePageMode = (savedFit === 'true');
    }
  } catch (e) { }

  function updateOnePageButtonUI() {
    const btn = document.getElementById('btn-tt-one-page');
    if (!btn) return;
    btn.classList.toggle('active', isOnePageMode);
    btn.setAttribute('aria-pressed', isOnePageMode ? 'true' : 'false');
    const labelSpan = document.getElementById('btn-tt-one-page-label');
    if (labelSpan) {
      labelSpan.textContent = getTimetableText('timetable', 'onePage', '1 Page');
    }
    btn.title = isOnePageMode
      ? 'Switch to Standard Scroll View'
      : 'Fit full timetable to 1 page without scrolling';
  }

  function toggleOnePageMode() {
    isOnePageMode = !isOnePageMode;
    try {
      localStorage.setItem('spectrum_pro_timetable_one_page', isOnePageMode ? 'true' : 'false');
    } catch (e) { }
    updateOnePageButtonUI();
    renderTimetableMode();
  }

  function applyOnePageScaling() {
    const frame = document.getElementById('timetable-scroll-frame');
    const grid = document.getElementById('timetable-grid');
    const scaler = document.getElementById('timetable-scaler');
    if (!frame || !grid) return;

    // Attach dynamic ResizeObserver to frame to handle window, dock, or layout shifts
    if (typeof ResizeObserver !== 'undefined' && !frame._hasOnePageObserver) {
      frame._hasOnePageObserver = true;
      const ro = new ResizeObserver(() => {
        applyOnePageScaling();
        updateLiveTimeTracker();
      });
      ro.observe(frame);
    }

    const isFullTab = (typeof window !== 'undefined' && window.location && window.location.search.includes('mode=full')) ||
      (typeof document !== 'undefined' && document.body && document.body.classList.contains('is-full-tab'));

    if (!isOnePageMode) {
      frame.classList.remove('is-one-page-frame');
      grid.classList.remove('is-one-page-grid');

      if (isFullTab) {
        // Workstation Full-Tab Mode: 100% natural desktop scale
        grid.style.transform = '';
        grid.style.transformOrigin = '';
        grid.style.width = '';
        grid.style.height = '';
        if (scaler) {
          scaler.style.width = '';
          scaler.style.height = '';
          scaler.style.margin = '';
        }
        return;
      }

      // Extension Compact Mode (Non-One-Page):
      // Proportional 50% scale of the entire timetable canvas.
      // Keeps the EXACT layout, aspect ratios, and column proportions of the original
      // without squeezing or compressing columns into the viewport width.
      const scale = 0.8;

      // Temporarily clear inline transforms to measure natural uncompressed layout dimensions
      grid.style.transform = 'none';
      grid.style.width = '';
      grid.style.height = '';
      if (scaler) {
        scaler.style.width = '100%';
        scaler.style.height = 'auto';
        scaler.style.margin = '';
      }

      const clientW = frame.clientWidth;
      const availW = Math.max(280, clientW - 40);

      const minW = parseInt(grid.style.minWidth, 10) || 1000;
      const naturalW = Math.max(minW, grid.scrollWidth, grid.offsetWidth);
      const naturalH = Math.max(grid.scrollHeight, grid.offsetHeight, 380);

      grid.style.width = `${naturalW}px`;
      grid.style.height = `${naturalH}px`;
      grid.style.transformOrigin = 'top left';
      grid.style.transform = `scale(${scale})`;

      const scaledW = Math.round(naturalW * scale);
      const scaledH = Math.round(naturalH * scale);

      if (scaler) {
        scaler.style.width = `${scaledW}px`;
        scaler.style.height = `${scaledH}px`;
        scaler.style.margin = (scaledW > availW) ? '0' : '0 auto';
      }
      return;
    }

    frame.classList.add('is-one-page-frame');
    grid.classList.add('is-one-page-grid');

    // Reset previous modifications before measuring natural dimensions
    grid.style.transform = 'none';
    grid.style.width = '';
    grid.style.height = '';
    if (scaler) {
      scaler.style.width = '100%';
      scaler.style.height = 'auto';
      scaler.style.margin = '0 auto';
    }

    const clientW = frame.clientWidth;
    const clientH = frame.clientHeight;
    if (clientW <= 0 || clientH <= 0) return;

    // Available viewport area (accounting for frame padding)
    const availW = Math.max(280, clientW - 24);
    const availH = Math.max(200, clientH - 16);

    const isVertical = grid.classList.contains('timetable-vertical-grid');
    const naturalW = Math.max(grid.scrollWidth, grid.offsetWidth, 700);
    const naturalH = Math.max(grid.scrollHeight, grid.offsetHeight, 380);

    let scale;
    let targetBaseW;

    if (isVertical) {
      // In vertical layout, all hours (rows) must fit within availH.
      // Minimum base width is determined by day columns + time header.
      const minBaseW = parseInt(grid.style.minWidth, 10) || 1000;
      const scaleY = availH / naturalH;
      const scaleX = availW / minBaseW;
      scale = Math.min(scaleX, scaleY, 1.0);

      // Expand base width so that after scaling down, the grid spans the full available width
      // preventing the 'narrow centered column' artifact while ensuring true proportional scaling.
      targetBaseW = Math.max(minBaseW, Math.round(availW / Math.max(scale, 0.05)));
    } else {
      // In horizontal layout, width (time hours) is the main constraint
      const scaleX = availW / naturalW;
      const scaleY = availH / naturalH;
      scale = Math.min(scaleX, scaleY, 1.0);
      targetBaseW = naturalW;
    }

    grid.style.width = `${targetBaseW}px`;

    const scaledW = Math.min(availW, Math.round(targetBaseW * scale));
    const scaledH = Math.round(naturalH * scale);

    if (scaler) {
      scaler.style.width = `${scaledW}px`;
      scaler.style.height = `${scaledH}px`;
      scaler.style.margin = '0 auto';
    }

    grid.style.transformOrigin = 'top left';
    grid.style.transform = `scale(${scale})`;
  }

  function renderHorizontalGrid(gridEl, sessions) {
    const esc = getSafeEscapeHtml();
    const DAY_NAMES = getTimetableDayNames();
    // Always include Monday to Saturday (days 1..6)
    const activeDayIndices = [1, 2, 3, 4, 5, 6];
    if (sessions.some(s => s.dayIndex === 0)) activeDayIndices.push(0);

    const todayDayIndex = new Date().getDay();

    let minHour = 8;
    let maxHour = 18;
    sessions.forEach(s => {
      if (!s) return;
      if (typeof s.startHour === 'number' && !isNaN(s.startHour) && s.startHour < minHour) minHour = s.startHour;
      if (typeof s.endHour === 'number' && !isNaN(s.endHour) && s.endHour > maxHour) maxHour = s.endHour;
      if (s.endMin > 0 && typeof s.endHour === 'number' && !isNaN(s.endHour) && s.endHour >= maxHour) maxHour = s.endHour + 1;
    });
    const totalCols = maxHour - minHour;
    const pad = n => String(n).padStart(2, '0');

    // Dynamically read horizontal column width & row height from CSS tuning dashboard
    let horizColWidth = isOnePageMode ? 136 : 196;
    let horizRowHeight = isOnePageMode ? 78 : 98;
    try {
      if (typeof document !== 'undefined') {
        const rootStyle = getComputedStyle(document.documentElement);
        const gridStyle = getComputedStyle(gridEl);
        if (!isOnePageMode) {
          const colVal = parseInt(rootStyle.getPropertyValue('--tt-horiz-col-width') || gridStyle.getPropertyValue('--tt-horiz-col-width'), 10);
          if (!isNaN(colVal) && colVal >= 80 && colVal <= 400) {
            horizColWidth = colVal;
          }
          const rowVal = parseInt(rootStyle.getPropertyValue('--tt-horiz-row-height') || gridStyle.getPropertyValue('--tt-horiz-row-height'), 10);
          if (!isNaN(rowVal) && rowVal >= 40 && rowVal <= 300) {
            horizRowHeight = rowVal;
          }
        }
      }
    } catch (e) { }

    // Any day without a single course scheduled (e.g. Friday, Saturday) takes half a row height (weight 0.5)!
    const hasDaySession = dIdx => sessions.some(s => s.dayIndex === dIdx);
    const isDayHalf = dIdx => !hasDaySession(dIdx);
    const rowTracks = ['38px'];
    activeDayIndices.forEach(dIdx => {
      if (isDayHalf(dIdx)) {
        rowTracks.push(`minmax(${Math.round(horizRowHeight * 0.45)}px, 0.5fr)`);
      } else {
        rowTracks.push(`minmax(${horizRowHeight}px, 1fr)`);
      }
    });

    // Any hour without a single course across the week takes half a column width (0.45x)!
    const isHourHalf = h => !sessions.some(s => {
      if (!s) return false;
      const sStart = (typeof s.startHour === 'number') ? s.startHour + (s.startMin || 0) / 60 : 0;
      const sEnd = (typeof s.endHour === 'number') ? s.endHour + (s.endMin || 0) / 60 : 0;
      return sStart < (h + 1) && sEnd > h;
    });

    const colTracks = [];
    let totalColWidth = 0;
    for (let h = minHour; h < maxHour; h++) {
      if (isHourHalf(h)) {
        const cW = Math.round(horizColWidth * 0.45);
        colTracks.push(`minmax(${cW}px, 0.45fr)`);
        totalColWidth += cW;
      } else {
        colTracks.push(`minmax(${horizColWidth}px, 1fr)`);
        totalColWidth += horizColWidth;
      }
    }

    gridEl.className = 'timetable-grid timetable-horizontal-grid' + (isOnePageMode ? ' is-one-page-grid' : '');
    const dayColWidth = isOnePageMode ? 84 : 98;
    gridEl.style.gridTemplateColumns = `${dayColWidth}px ${colTracks.join(' ')}`;
    gridEl.style.gridTemplateRows = rowTracks.join(' ');
    gridEl.style.minWidth = `${dayColWidth + totalColWidth}px`;

    let html = '';

    // Corner Header Cell (Row 1, Col 1)
    const acadWkText = getTimetableText('timetable', 'academicWk', 'ACADEMIC WK');
    const timeMytText = getTimetableText('timetable', 'timeMyt', 'TIME (MYT)');
    html += `
      <div class="tt-header-cell tt-corner-cell" style="grid-column: 1; grid-row: 1;">
        <div class="tt-corner-acad-wk" style="font-size: 8.5px; font-weight: 800; letter-spacing: 0.8px;">${esc(acadWkText)}</div>
        <div class="tt-corner-time-myt" style="font-size: 8px; font-weight: 600; margin-top: 1px;">${esc(timeMytText)}</div>
      </div>
    `;

    // Time Columns Header (Row 1, Col 2..N)
    for (let h = minHour; h < maxHour; h++) {
      const colIdx = (h - minHour) + 2;
      const halfClass = isHourHalf(h) ? ' is-half-hour' : '';
      html += `
        <div class="tt-header-cell tt-time-col-header${halfClass}" data-hour="${h}" style="grid-column: ${colIdx}; grid-row: 1;">
          <span class="tt-time-top">${pad(h)}:00</span>
          <span class="tt-time-bot">${pad(h + 1)}:00</span>
        </div>
      `;
    }

    // Day Rows (Row 2..N)
    activeDayIndices.forEach((dIdx, dayRowOffset) => {
      const rowNum = dayRowOffset + 2;
      const dayName = DAY_NAMES[dIdx];
      const isToday = (dIdx === todayDayIndex);
      const isHalf = isDayHalf(dIdx);
      const todayClass = isToday ? ' is-today' : '';
      const halfClass = isHalf ? ' is-half-row' : '';
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      // Day Label Cell (Col 1)
      html += `
        <div class="tt-day-label-cell${todayClass}${halfClass}" data-day-index="${dIdx}" style="grid-column: 1; grid-row: ${rowNum};">
          <div class="tt-day-name">${isToday ? `<span class="tt-today-indicator">●</span> ${dayName}` : dayName}</div>
        </div>
      `;

      if (daySess.length === 0) {
        html += `
          <div class="tt-empty-day-banner${halfClass}" style="grid-column: 2 / ${totalCols + 2}; grid-row: ${rowNum};"></div>
        `;
      } else {
        const occupied = new Array(totalCols).fill(false);

        daySess.forEach(s => {
          const isLiveNow = isSessionLiveNow(dIdx, s.startHour, s.startMin, s.endHour, s.endMin);
          const liveClass = isLiveNow ? ' is-live-session' : '';
          const liveBadgeHtml = isLiveNow ? '<span class="tt-live-pill">● LIVE</span>' : '';

          const startCol = Math.max(2, (s.startHour - minHour) + 2);
          const endCol = Math.min(totalCols + 2, Math.max(startCol + 1, (s.endHour - minHour) + (s.endMin > 0 ? 1 : 0) + 2));

          const startIdx = Math.max(0, s.startHour - minHour);
          const endIdx = Math.min(totalCols, (s.endHour - minHour) + (s.endMin > 0 ? 1 : 0));
          for (let i = startIdx; i < endIdx; i++) occupied[i] = true;

          const hasVenue = Boolean(s.venue && s.venue.trim().length > 0);
          const venuePlaceholder = getTimetableText('timetable', 'venuePlaceholder', '+ Add Location');
          const acronym = getSessionAcronym(s.courseName, s.courseCode);
          const acronymHtml = acronym ? `<span class="tt-code-dot">·</span><span class="tt-code-acronym">${esc(acronym)}</span>` : '';
          const isOnlineH = /online|zoom|teams|google meet|meet|webex/i.test(s.venue || '');
          const venueIconSvgH = getVenueIconSvg(isOnlineH);
          const venueHtml = hasVenue
            ? `<span class="tt-venue" title="${esc(s.venue)}">${venueIconSvgH} ${esc(s.venue)}</span>`
            : `<span class="tt-venue tt-venue-empty"></span>`;

          const startTimeVal = `${pad(s.startHour)}:${pad(s.startMin)}`;
          const endTimeVal = `${pad(s.endHour)}:${pad(s.endMin)}`;
          const rawStartTimeVal = `${pad(s.rawStartHour)}:${pad(s.rawStartMin)}`;
          const rawEndTimeVal = `${pad(s.rawEndHour)}:${pad(s.rawEndMin)}`;

          const cardTitleTip = s.isManual ? 'Click to edit or delete manual class' : 'Click to edit or delete class session';

          html += `
            <div class="tt-session-card${liveClass}"
                 data-session-key="${esc(s.key)}"
                 data-fallback-key="${esc(s.fallbackKey)}"
                 data-is-manual="${s.isManual ? '1' : '0'}"
                 data-manual-id="${esc(s.manualId || '')}"
                 data-course-code="${esc(s.courseCode)}"
                 data-course-name="${esc(s.courseName)}"
                 data-type-label="${esc(s.typeLabel)}"
                 data-occ="${esc(s.occ)}"
                 data-day-name="${esc(s.dayName)}"
                 data-time-str="${esc(s.timeStr)}"
                 data-raw-time-str="${esc(s.rawTimeStr)}"
                 data-start-time="${startTimeVal}"
                 data-end-time="${endTimeVal}"
                 data-raw-start-time="${rawStartTimeVal}"
                 data-raw-end-time="${rawEndTimeVal}"
                 data-is-custom-time="${s.isCustomTime ? '1' : '0'}"
                 data-venue="${esc(s.venue || '')}"
                 title="${cardTitleTip}"
                 style="grid-column: ${startCol} / ${endCol}; grid-row: ${rowNum};">
              <div class="tt-card-header">
                <div class="tt-card-code-badge">
                  <span class="tt-code">${esc(cleanSingleCourseCode(s.courseCode))}</span>
                  ${acronymHtml}
                  <span class="tt-type-tag">${esc(s.typeLabel)}</span>
                  ${liveBadgeHtml}
                </div>
                <span class="tt-time-range">${esc(s.timeStr)}</span>
              </div>
              <div class="tt-card-subtitle">${esc(s.occ)}</div>
              <div class="tt-card-title" title="${esc(s.courseName)}">${esc(s.courseName)}</div>
              <div class="tt-card-footer">
                ${venueHtml}
                <span class="tt-card-dur">${esc(s.durText)}</span>
              </div>
            </div>
          `;
        });

        // Fill remaining empty gaps
        let gapStart = null;
        for (let i = 0; i <= totalCols; i++) {
          if (i < totalCols && !occupied[i]) {
            if (gapStart === null) gapStart = i;
          } else {
            if (gapStart !== null) {
              const gStartCol = gapStart + 2;
              const gEndCol = i + 2;
              const gStartH = gapStart + minHour;
              const gEndH = i + minHour;
              const label = getEditorialGapLabel(gStartH, gEndH);

              html += `
                <div class="tt-gap-cell" style="grid-column: ${gStartCol} / ${gEndCol}; grid-row: ${rowNum};">
                  ${label}
                </div>
              `;
              gapStart = null;
            }
          }
        }
      }
    });

    // Real-Time Timetable Tracker Overlay (Horizontal Layout)
    html += `
      <div class="tt-live-tracker-overlay horizontal" style="grid-column: 1 / -1; grid-row: 1 / -1;">
        <div id="tt-horizontal-live-tracker" class="tt-live-tracker horizontal">
          <div class="tt-tracker-badge horizontal">
            <span class="tt-tracker-time">--:--</span>
          </div>
          <div class="tt-tracker-line horizontal"></div>
          <div class="tt-tracker-pulse-dot horizontal"></div>
        </div>
      </div>
    `;

    gridEl.innerHTML = html;
  }

  function renderVerticalGrid(gridEl, sessions) {
    const esc = getSafeEscapeHtml();
    const DAY_NAMES = getTimetableDayNames();
    // Always include Monday to Saturday (days 1..6)
    const activeDayIndices = [1, 2, 3, 4, 5, 6];
    if (sessions.some(s => s.dayIndex === 0)) activeDayIndices.push(0);

    const todayDayIndex = new Date().getDay();

    let minHour = 8;
    let maxHour = 18;
    sessions.forEach(s => {
      if (!s) return;
      if (typeof s.startHour === 'number' && !isNaN(s.startHour) && s.startHour < minHour) minHour = s.startHour;
      if (typeof s.endHour === 'number' && !isNaN(s.endHour) && s.endHour > maxHour) maxHour = s.endHour;
      if (s.endMin > 0 && typeof s.endHour === 'number' && !isNaN(s.endHour) && s.endHour >= maxHour) maxHour = s.endHour + 1;
    });

    let hourHeight = 115;
    try {
      if (typeof document !== 'undefined') {
        const rootVal = getComputedStyle(document.documentElement).getPropertyValue('--tt-hour-row-height') ||
          getComputedStyle(gridEl).getPropertyValue('--tt-hour-row-height');
        const parsed = parseInt(rootVal, 10);
        if (!isNaN(parsed) && parsed >= 60 && parsed <= 300) {
          hourHeight = parsed;
        }
      }
    } catch (e) { }

    const totalHours = maxHour - minHour;
    const HOUR_HEIGHT = hourHeight;
    const pad = n => String(n).padStart(2, '0');

    // Any day without a single course scheduled (e.g. Friday, Saturday) takes half a cell (0.5fr)!
    const hasDaySession = dIdx => sessions.some(s => s.dayIndex === dIdx);
    const isDayHalf = dIdx => !hasDaySession(dIdx);
    const colTracks = activeDayIndices.map(dIdx => {
      const isHalf = isDayHalf(dIdx);
      return isHalf ? 'minmax(95px, 0.5fr)' : 'minmax(185px, 1fr)';
    });
    const totalMinWidth = 75 + activeDayIndices.reduce((sum, dIdx) => {
      return sum + (isDayHalf(dIdx) ? 95 : 185);
    }, 0);

    // Any hour without a single course across the week takes half cell height (0.45x)!
    const isHourHalf = h => !sessions.some(s => {
      if (!s) return false;
      const sStart = (typeof s.startHour === 'number') ? s.startHour + (s.startMin || 0) / 60 : 0;
      const sEnd = (typeof s.endHour === 'number') ? s.endHour + (s.endMin || 0) / 60 : 0;
      return sStart < (h + 1) && sEnd > h;
    });

    const hourHeights = {};
    let totalHeight = 0;
    for (let h = minHour; h < maxHour; h++) {
      const hH = isHourHalf(h) ? Math.round(HOUR_HEIGHT * 0.45) : HOUR_HEIGHT;
      hourHeights[h] = hH;
      totalHeight += hH;
    }

    function getVerticalTop(h, m) {
      let top = 0;
      for (let hr = minHour; hr < h && hr < maxHour; hr++) {
        top += hourHeights[hr];
      }
      if (h < maxHour) {
        const fraction = Math.min(60, Math.max(0, m || 0)) / 60;
        top += Math.round(fraction * hourHeights[h]);
      }
      return top;
    }

    gridEl.className = 'timetable-grid timetable-vertical-grid' + (isOnePageMode ? ' is-one-page-grid' : '');
    gridEl.style.gridTemplateColumns = `75px ${colTracks.join(' ')}`;
    gridEl.style.gridTemplateRows = 'none';
    gridEl.style.minWidth = `${totalMinWidth}px`;

    let html = '';

    // Row 1, Col 1: Corner Header Cell
    const timeMytVertText = getTimetableText('timetable', 'timeMyt', 'TIME (MYT)');
    html += `
      <div class="tt-header-cell tt-corner-cell" style="grid-column: 1; grid-row: 1;">
        <span class="tt-corner-tz">UTC+8</span>
        <span class="tt-corner-label">${esc(timeMytVertText)}</span>
      </div>
    `;

    // Row 1, Col 2..N: Day Headers (pure days of week, with Today highlighted)
    activeDayIndices.forEach((dIdx, colOffset) => {
      const col = colOffset + 2;
      const dayName = DAY_NAMES[dIdx];
      const isToday = (dIdx === todayDayIndex);
      const isHalf = isDayHalf(dIdx);
      const todayClass = isToday ? ' is-today' : '';
      const halfClass = isHalf ? ' is-half-cell' : '';
      const headerContent = isToday
        ? `<span class="tt-today-indicator">●</span> ${dayName}`
        : dayName;

      html += `
        <div class="tt-header-cell tt-day-header-cell${todayClass}${halfClass}" style="grid-column: ${col}; grid-row: 1;">
          ${headerContent}
        </div>
      `;
    });

    // Row 2, Col 1: Left Time Track Column
    html += `
      <div class="tt-time-track" style="grid-column: 1; grid-row: 2; height: ${totalHeight}px;">
    `;
    for (let h = minHour; h < maxHour; h++) {
      const isHalf = isHourHalf(h);
      const halfClass = isHalf ? ' is-half-hour' : '';
      html += `
        <div class="tt-time-cell${halfClass}" data-hour="${h}" style="height: ${hourHeights[h]}px;">
          <span class="tt-time-text">${pad(h)}:00</span>
        </div>
      `;
    }
    html += `</div>`;

    // Row 2, Col 2..N: Day Columns
    activeDayIndices.forEach((dIdx, colOffset) => {
      const col = colOffset + 2;
      const isHalf = isDayHalf(dIdx);
      const halfClass = isHalf ? ' is-half-cell' : '';
      const isToday = (dIdx === todayDayIndex);
      const todayClass = isToday ? ' is-today' : '';
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      html += `
        <div class="tt-day-column${halfClass}${todayClass}" data-day-index="${dIdx}" style="grid-column: ${col}; grid-row: 2; height: ${totalHeight}px;">
      `;

      // Background hourly grid lines
      for (let h = minHour; h < maxHour; h++) {
        const isHalf = isHourHalf(h);
        const halfClass = isHalf ? ' is-half-hour' : '';
        html += `<div class="tt-grid-hour-line${halfClass}" style="height: ${hourHeights[h]}px;"></div>`;
      }

      if (daySess.length === 0) {
        // Empty day column: keep clean without watermark text
      } else {
        const packed = computeSessionColumns(daySess);

        packed.forEach(s => {
          const isLiveNow = isSessionLiveNow(dIdx, s.startHour, s.startMin, s.endHour, s.endMin);
          const liveClass = isLiveNow ? ' is-live-session' : '';
          const liveBadgeHtml = isLiveNow ? '<span class="tt-live-pill">● LIVE</span>' : '';

          const startTop = getVerticalTop(s.startHour, s.startMin);
          const endTop = getVerticalTop(s.endHour, s.endMin);
          const topPx = startTop + 4;
          const heightPx = Math.max(48, endTop - startTop - 8);
          const isCompact = s.durHours < 1.5;
          const compactClass = isCompact ? ' is-compact' : '';

          let posStyle = '';
          if (s._totalCols > 1) {
            const colW = 100 / s._totalCols;
            const left = s._colIndex * colW;
            posStyle = `left: calc(${left}% + 4px); width: calc(${colW}% - 8px);`;
          } else {
            posStyle = 'left: 6px; width: calc(100% - 12px);';
          }

          const hasVenue = Boolean(s.venue && s.venue.trim().length > 0);
          const acronym = getSessionAcronym(s.courseName, s.courseCode);
          const acronymHtml = acronym ? `<span class="tt-code-dot">·</span><span class="tt-code-acronym">${esc(acronym)}</span>` : '';
          const subtitleText = esc(s.occ);
          const venuePlaceholder = getTimetableText('timetable', 'venuePlaceholder', '+ Add Location');
          const isOnlineV = /online|zoom|teams|google meet|meet|webex/i.test(s.venue || '');
          const venueIconSvgV = getVenueIconSvg(isOnlineV);
          const venueHtml = hasVenue
            ? `<span class="tt-venue" title="${esc(s.venue)}">${venueIconSvgV} ${esc(s.venue)}</span>`
            : `<span class="tt-venue tt-venue-empty"></span>`;

          const startTimeVal = `${pad(s.startHour)}:${pad(s.startMin)}`;
          const endTimeVal = `${pad(s.endHour)}:${pad(s.endMin)}`;
          const rawStartTimeVal = `${pad(s.rawStartHour)}:${pad(s.rawStartMin)}`;
          const rawEndTimeVal = `${pad(s.rawEndHour)}:${pad(s.rawEndMin)}`;

          const cardTitleTipV = s.isManual ? 'Click to edit or delete manual class' : 'Click to edit or delete class session';

          html += `
            <div class="tt-session-card${compactClass}${liveClass}"
                 data-session-key="${esc(s.key)}"
                 data-fallback-key="${esc(s.fallbackKey)}"
                 data-is-manual="${s.isManual ? '1' : '0'}"
                 data-manual-id="${esc(s.manualId || '')}"
                 data-course-code="${esc(s.courseCode)}"
                 data-course-name="${esc(s.courseName)}"
                 data-type-label="${esc(s.typeLabel)}"
                 data-occ="${esc(s.occ)}"
                 data-day-name="${esc(s.dayName)}"
                 data-time-str="${esc(s.timeStr)}"
                 data-raw-time-str="${esc(s.rawTimeStr)}"
                 data-start-time="${startTimeVal}"
                 data-end-time="${endTimeVal}"
                 data-raw-start-time="${rawStartTimeVal}"
                 data-raw-end-time="${rawEndTimeVal}"
                 data-is-custom-time="${s.isCustomTime ? '1' : '0'}"
                 data-venue="${esc(s.venue || '')}"
                 title="${cardTitleTipV}"
                 style="top: ${topPx}px; height: ${heightPx}px; ${posStyle}">
              <div class="tt-card-header">
                <div class="tt-card-code-badge">
                  <span class="tt-code">${esc(cleanSingleCourseCode(s.courseCode))}</span>
                  ${acronymHtml}
                  ${isCompact ? `<span class="tt-card-occ-inline">${subtitleText}</span>` : ''}
                  ${liveBadgeHtml}
                </div>
                <span class="tt-type-tag">${esc(s.typeLabel)}</span>
              </div>
              <div class="tt-card-title" title="${esc(s.courseName)}">${esc(s.courseName)}</div>
              ${isCompact ? '' : `<div class="tt-card-subtitle">${subtitleText}</div>`}
              <div class="tt-card-footer">
                ${venueHtml}
                <span class="tt-time-range">${esc(s.timeStr)}</span>
              </div>
            </div>
          `;
        });
      }

      html += `</div>`;
    });

    // Real-Time Timetable Tracker Overlay (Vertical Layout)
    html += `
      <div class="tt-live-tracker-overlay vertical" style="grid-column: 1 / -1; grid-row: 2; height: ${totalHeight}px;">
        <div id="tt-vertical-live-tracker" class="tt-live-tracker vertical">
          <div class="tt-tracker-badge vertical">
            <span class="tt-tracker-time">--:--</span>
          </div>
          <div class="tt-tracker-line vertical"></div>
          <div class="tt-tracker-pulse-dot vertical"></div>
        </div>
      </div>
    `;

    gridEl.innerHTML = html;
  }

  let liveTrackerTimer = null;

  function isSessionLiveNow(dayIndex, startH, startM, endH, endM) {
    const now = new Date();
    if (now.getDay() !== dayIndex) return false;
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const startMins = startH * 60 + (startM || 0);
    const endMins = endH * 60 + (endM || 0);
    return nowMins >= startMins && nowMins < endMins;
  }

  function updateVerticalTracker(gridEl) {
    const tracker = gridEl.querySelector('#tt-vertical-live-tracker');
    if (!tracker) return;

    const now = new Date();
    const nowH = now.getHours();
    const nowM = now.getMinutes();
    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${pad(nowH)}:${pad(nowM)}`;

    const timeSpan = tracker.querySelector('.tt-tracker-time');
    if (timeSpan) timeSpan.textContent = timeStr;

    const hourCell = gridEl.querySelector(`.tt-time-cell[data-hour="${nowH}"]`);
    if (!hourCell) {
      tracker.style.display = 'none';
      return;
    }

    const topPx = Math.round(hourCell.offsetTop + (nowM / 60) * hourCell.offsetHeight);
    tracker.style.top = `${topPx}px`;
    tracker.style.display = 'block';

    const dot = tracker.querySelector('.tt-tracker-pulse-dot');
    if (dot) {
      const todayCol = gridEl.querySelector('.tt-day-column.is-today');
      if (todayCol && todayCol.offsetLeft > 0) {
        dot.style.left = `${todayCol.offsetLeft}px`;
        dot.style.display = 'block';
      } else {
        dot.style.display = 'none';
      }
    }
  }

  function updateHorizontalTracker(gridEl) {
    const tracker = gridEl.querySelector('#tt-horizontal-live-tracker');
    if (!tracker) return;

    const now = new Date();
    const nowH = now.getHours();
    const nowM = now.getMinutes();
    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${pad(nowH)}:${pad(nowM)}`;

    const timeSpan = tracker.querySelector('.tt-tracker-time');
    if (timeSpan) timeSpan.textContent = timeStr;

    const colEl = gridEl.querySelector(`.tt-time-col-header[data-hour="${nowH}"]`);
    if (!colEl) {
      tracker.style.display = 'none';
      return;
    }

    const leftPx = Math.round(colEl.offsetLeft + (nowM / 60) * colEl.offsetWidth);
    tracker.style.left = `${leftPx}px`;
    tracker.style.display = 'block';

    const dot = tracker.querySelector('.tt-tracker-pulse-dot');
    if (dot) {
      const todayRow = gridEl.querySelector('.tt-day-label-cell.is-today');
      if (todayRow && todayRow.offsetTop > 0) {
        dot.style.top = `${todayRow.offsetTop}px`;
        dot.style.display = 'block';
      } else {
        dot.style.display = 'none';
      }
    }
  }

  function updateLiveTimeTracker() {
    const gridEl = document.getElementById('timetable-grid');
    if (!gridEl) return;
    if (currentTimetableLayout === 'horizontal') {
      updateHorizontalTracker(gridEl);
    } else {
      updateVerticalTracker(gridEl);
    }
  }

  function startLiveTimeTracker() {
    if (liveTrackerTimer) {
      clearInterval(liveTrackerTimer);
      liveTrackerTimer = null;
    }
    updateLiveTimeTracker();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => updateLiveTimeTracker());
    }
    // Update every 30s to stay synchronized with real-time clock
    liveTrackerTimer = setInterval(updateLiveTimeTracker, 30000);
  }

  if (typeof window !== 'undefined' && !window._hasLiveTrackerVisibilityListener) {
    window._hasLiveTrackerVisibilityListener = true;
    window.addEventListener('focus', () => {
      updateLiveTimeTracker();
      loadCustomLocations();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          updateLiveTimeTracker();
          loadCustomLocations();
        }
      });
    }
  }

  // Live real-time cross-window synchronization (e.g. extension popup <-> workstation tab)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged && (typeof window === 'undefined' || !window._hasTimetableStorageListener)) {
    if (typeof window !== 'undefined') window._hasTimetableStorageListener = true;
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      if (changes.timetableLocations || changes.timetableSessionOverrides || changes.manualTimetableSessions || changes.activeIcsFilename || changes.activeIcsSessions || changes.cachedAttendances) {
        await loadCustomLocations();
        renderTimetableMode();
      }
    });
  }

  function renderTimetableMode() {
    updateLayoutSwitchUI();
    updateOnePageButtonUI();
    updateIcsCapsuleUI();
    const gridEl = document.getElementById('timetable-grid');
    const countEl = document.getElementById('timetable-session-count');
    if (!gridEl) return;

    if (!gridEl._hasLocationClickListener) {
      gridEl._hasLocationClickListener = true;
      gridEl.addEventListener('click', (e) => {
        if (e.target.closest('#btn-empty-add-tt-session')) {
          openManualSessionModal(null);
          return;
        }
        if (e.target.closest('#btn-empty-restore-tt')) {
          const deletedCount = getDeletedSessionsCount();
          const confirmTpl = getTimetableText('timetable', 'restoreConfirm', 'Restore {n} hidden/deleted class session(s) back to your timetable?');
          const confirmMsg = confirmTpl.replace('{n}', deletedCount);
          if (!confirm(confirmMsg)) return;
          restoreAllDeletedSessions();
          return;
        }
        const card = e.target.closest('.tt-session-card');
        if (!card) return;
        if (card.dataset.isManual === '1') {
          const mId = card.dataset.manualId;
          const existing = manualTimetableSessions.find(m => m.id === mId) ||
                           activeIcsSessions.find(m => m.id === mId) || null;
          openManualSessionModal(existing);
          return;
        }
        openLocationModal({
          key: card.dataset.sessionKey,
          fallbackKey: card.dataset.fallbackKey,
          courseCode: card.dataset.courseCode,
          courseName: card.dataset.courseName,
          typeLabel: card.dataset.typeLabel,
          occ: card.dataset.occ,
          dayName: card.dataset.dayName,
          timeStr: card.dataset.timeStr,
          rawTimeStr: card.dataset.rawTimeStr,
          startTime: card.dataset.startTime,
          endTime: card.dataset.endTime,
          rawStartTime: card.dataset.rawStartTime,
          rawEndTime: card.dataset.rawEndTime,
          isCustomTime: card.dataset.isCustomTime === '1',
          currentVenue: card.dataset.venue || ''
        });
      });
    }

    const sessions = extractWeeklyTimetableSessions();
    if (countEl) {
      if (typeof window !== 'undefined' && typeof window.updateTimetableTranslations === 'function') {
        window.updateTimetableTranslations();
      } else {
        countEl.textContent = `${sessions.length} Contact Session${sessions.length === 1 ? '' : 's'}`;
      }
    }

    const deletedCount = getDeletedSessionsCount();
    if (countEl) {
      if (deletedCount > 0) {
        countEl.title = `${deletedCount} class${deletedCount > 1 ? 'es' : ''} deleted. Click to restore or click '+ Add Class'.`;
        countEl.style.cursor = 'pointer';
        if (!countEl._hasRestoreClick) {
          countEl._hasRestoreClick = true;
          countEl.addEventListener('click', () => {
            const currentDeleted = getDeletedSessionsCount();
            if (currentDeleted > 0) {
              const confirmTpl = getTimetableText('timetable', 'restoreConfirm', 'Restore {n} hidden/deleted class session(s) back to your timetable?');
              const confirmMsg = confirmTpl.replace('{n}', currentDeleted);
              if (confirm(confirmMsg)) {
                restoreAllDeletedSessions();
              }
            }
          });
        }
      } else {
        countEl.title = '';
        countEl.style.cursor = '';
      }
    }

    if (sessions.length === 0) {
      const scalerEl = document.getElementById('timetable-scaler');
      if (scalerEl) {
        scalerEl.style.width = '100%';
        scalerEl.style.height = 'auto';
        scalerEl.style.margin = '';
      }
      gridEl.style.transform = 'none';
      gridEl.className = 'timetable-grid';
      gridEl.style.gridTemplateColumns = '1fr';
      gridEl.style.gridTemplateRows = 'none';
      gridEl.style.minWidth = '0px';
      const esc = getSafeEscapeHtml();
      const emptyTitle = esc(getTimetableText('timetable', 'noSessionsFound', 'No Timetable Sessions Found'));
      const emptyAddLabel = esc(getTimetableText('timetable', 'addClass', 'Add Class'));
      gridEl.innerHTML = `
        <div class="tt-empty-state" style="padding: 56px 24px; text-align: center; font-family: var(--font-sans); color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 12px;">🗓</div>
          <div style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">${emptyTitle}</div>
          <div style="font-size: 13px; max-width: 460px; margin: 0 auto; line-height: 1.5;">
            Synchronize your course attendance to auto-populate sessions, or add your weekly classes manually if your course uses offline attendance.
          </div>
          <button type="button" id="btn-empty-add-tt-session" class="btn-cta-solid tt-empty-add-btn">
            <span>+ ${emptyAddLabel}</span>
          </button>
          ${deletedCount > 0 ? `
            <div style="margin-top: 12px;">
              <button type="button" id="btn-empty-restore-tt" class="btn-wireframe" style="color:#ef4444;border-color:rgba(239,68,68,0.35);font-size:11.5px;padding:6px 14px;">
                ↺ Restore ${deletedCount} Deleted Class${deletedCount > 1 ? 'es' : ''}
              </button>
            </div>
          ` : ''}
        </div>
      `;
      return;
    }

    if (currentTimetableLayout === 'horizontal') {
      renderHorizontalGrid(gridEl, sessions);
    } else {
      renderVerticalGrid(gridEl, sessions);
    }

    applyOnePageScaling();
    startLiveTimeTracker();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        applyOnePageScaling();
        updateLiveTimeTracker();
      });
    }
  }

  let activeSessionForLocation = null;

  function formatDurationMinutes(mins) {
    if (mins <= 0) return '0h 00m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  function parseMinutes(timeStr) {
    if (!timeStr || !timeStr.includes(':')) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function updateTimeDurationPreview(startId, endId, previewId) {
    const startInp = document.getElementById(startId);
    const endInp = document.getElementById(endId);
    const previewEl = document.getElementById(previewId);
    if (!startInp || !endInp || !previewEl) return;

    const startM = parseMinutes(startInp.value);
    const endM = parseMinutes(endInp.value);

    if (endM <= startM) {
      previewEl.textContent = 'Invalid (End <= Start)';
      previewEl.style.color = '#ef4444';
    } else {
      previewEl.textContent = formatDurationMinutes(endM - startM);
      previewEl.style.color = 'var(--primary-accent)';
    }
  }

  function applyQuickDuration(startId, endId, previewId, durHours) {
    const startInp = document.getElementById(startId);
    const endInp = document.getElementById(endId);
    if (!startInp || !endInp) return;
    const dur = parseFloat(durHours) || 1;
    const startM = parseMinutes(startInp.value);
    const newEndM = startM + Math.round(dur * 60);
    const endH = Math.min(23, Math.floor(newEndM / 60));
    const endMin = newEndM % 60;
    const pad = n => String(n).padStart(2, '0');
    endInp.value = `${pad(endH)}:${pad(endMin)}`;
    updateTimeDurationPreview(startId, endId, previewId);
  }

  function updateDurationPreview() {
    updateTimeDurationPreview('tt-time-start', 'tt-time-end', 'tt-time-duration-preview');
  }

  function closeLocationModal() {
    const modal = document.getElementById('tt-location-modal');
    if (modal) modal.style.display = 'none';
    activeSessionForLocation = null;
  }

  let activeManualEditId = null;

  function getAvailableCourseSuggestions() {
    const byCode = new Map();
    const occMap = (typeof window !== 'undefined' && window.courseOccs && typeof window.courseOccs === 'object') ? window.courseOccs : {};
    const lists = [];
    if (typeof window !== 'undefined') {
      if (Array.isArray(window.coursesData)) lists.push(...window.coursesData);
      if (Array.isArray(window.allCoursesDiscovered)) lists.push(...window.allCoursesDiscovered);
    }
    lists.forEach(c => {
      if (!c) return;
      const rawCode = c.code || c.courseCode || c.shortname || '';
      const cleanCode = cleanSingleCourseCode(rawCode).toUpperCase();
      if (!cleanCode) return;
      const rawName = c.name || c.fullname || c.courseName || rawCode;
      const cleanName = cleanTimetableCourseName(rawName, rawCode || cleanCode);
      const rawOcc = c.userOcc || occMap[c.id] || occMap[c.courseId] || '';
      const occMatch = String(rawOcc).match(/\d+/);
      const occ = occMatch ? `OCC ${parseInt(occMatch[0], 10)}` : (String(rawOcc).trim() || 'OCC 1');
      if (!byCode.has(cleanCode)) {
        byCode.set(cleanCode, { code: cleanCode, name: cleanName, occ });
      }
    });
    getSafeAttendances().forEach(a => {
      if (!a) return;
      const cleanCode = cleanSingleCourseCode(a.courseCode || '').toUpperCase();
      if (!cleanCode || byCode.has(cleanCode)) return;
      const cleanName = cleanTimetableCourseName(a.courseName || '', a.courseCode || cleanCode);
      const occMatch = String(a.userOcc || '').match(/\d+/);
      const occ = occMatch ? `OCC ${parseInt(occMatch[0], 10)}` : 'OCC 1';
      byCode.set(cleanCode, { code: cleanCode, name: cleanName, occ });
    });
    return Array.from(byCode.values()).slice(0, 12);
  }

  function populateManualCourseChips(selectedCode = '') {
    const wrap = document.getElementById('tt-manual-course-picker-wrap');
    const chipsEl = document.getElementById('tt-manual-course-chips');
    if (!wrap || !chipsEl) return;
    const suggestions = getAvailableCourseSuggestions();
    if (suggestions.length === 0) {
      wrap.style.display = 'none';
      chipsEl.innerHTML = '';
      return;
    }
    const esc = getSafeEscapeHtml();
    const normSel = cleanSingleCourseCode(selectedCode).toUpperCase();
    chipsEl.innerHTML = suggestions.map(s => {
      const selClass = normSel && normSel === s.code ? ' is-selected' : '';
      return `<button type="button" class="btn-wireframe btn-tt-course-chip${selClass}" data-code="${esc(s.code)}" data-name="${esc(s.name)}" data-occ="${esc(s.occ)}" title="${esc(s.name)}">${esc(s.code)}</button>`;
    }).join('');
    wrap.style.display = 'block';
  }

  function setManualModalType(typeVal) {
    const norm = String(typeVal || 'LEC').trim().toUpperCase() || 'LEC';
    document.querySelectorAll('#tt-manual-type-chips .btn-tt-type-chip').forEach(btn => {
      btn.classList.toggle('is-selected', (btn.dataset.type || '').toUpperCase() === norm);
    });
  }

  function openManualSessionModal(existingManual = null) {
    const modal = document.getElementById('tt-add-session-modal');
    if (!modal) return;
    const isEdit = Boolean(existingManual && existingManual.id);
    activeManualEditId = isEdit ? existingManual.id : null;

    const titleEl = document.getElementById('tt-manual-modal-title');
    const codeInp = document.getElementById('tt-manual-code');
    const nameInp = document.getElementById('tt-manual-name');
    const occInp = document.getElementById('tt-manual-occ');
    const daySel = document.getElementById('tt-manual-day');
    const startInp = document.getElementById('tt-manual-start');
    const endInp = document.getElementById('tt-manual-end');
    const locInp = document.getElementById('tt-manual-location');
    const btnDel = document.getElementById('btn-delete-tt-manual');
    const btnSave = document.getElementById('btn-save-tt-manual');

    const pad = n => String(n).padStart(2, '0');
    if (titleEl) titleEl.textContent = isEdit ? '✏️ Edit Manual Class' : '+ Add Class to Timetable';
    if (btnSave) btnSave.textContent = isEdit ? 'Save Changes' : 'Add Class';
    if (btnDel) btnDel.style.display = isEdit ? 'inline-block' : 'none';

    const defOcc = (typeof window !== 'undefined' && window.defaultOcc) ? String(window.defaultOcc).trim() : 'OCC 1';
    if (codeInp) codeInp.value = isEdit ? (existingManual.courseCode || '') : '';
    if (nameInp) nameInp.value = isEdit ? (existingManual.courseName || '') : '';
    if (occInp) occInp.value = isEdit ? (existingManual.occ || 'OCC 1') : defOcc;
    if (daySel) daySel.value = isEdit ? String(existingManual.dayIndex) : '1';
    setManualModalType(isEdit ? existingManual.typeLabel : 'LEC');
    if (startInp) startInp.value = isEdit ? `${pad(existingManual.startHour)}:${pad(existingManual.startMin || 0)}` : '09:00';
    if (endInp) endInp.value = isEdit ? `${pad(existingManual.endHour)}:${pad(existingManual.endMin || 0)}` : '11:00';
    if (locInp) locInp.value = isEdit ? (existingManual.venue || '') : '';

    populateManualCourseChips(isEdit ? existingManual.courseCode : '');
    updateTimeDurationPreview('tt-manual-start', 'tt-manual-end', 'tt-manual-duration-preview');

    const restoreWrap = document.getElementById('tt-restore-deleted-wrap');
    const restoreDesc = document.getElementById('tt-restore-deleted-desc');
    const deletedCountInModal = getDeletedSessionsCount();
    if (restoreWrap) {
      if (!isEdit && deletedCountInModal > 0) {
        restoreWrap.style.display = 'block';
        if (restoreDesc) {
          restoreDesc.textContent = `${deletedCountInModal} default class${deletedCountInModal > 1 ? 'es' : ''} deleted from timetable.`;
        }
      } else {
        restoreWrap.style.display = 'none';
      }
    }

    modal.style.display = 'flex';
    setTimeout(() => {
      if (codeInp) codeInp.focus();
    }, 50);
  }

  function closeManualSessionModal() {
    const modal = document.getElementById('tt-add-session-modal');
    if (modal) modal.style.display = 'none';
    activeManualEditId = null;
  }

  function openLocationModal(sessInfo) {
    activeSessionForLocation = sessInfo;
    const modal = document.getElementById('tt-location-modal');
    if (!modal) return;

    const codeEl = document.getElementById('tt-location-course-code');
    const typeEl = document.getElementById('tt-location-course-type');
    const nameEl = document.getElementById('tt-location-course-name');
    const timeEl = document.getElementById('tt-location-session-time');
    const inp = document.getElementById('tt-location-input');
    const startInp = document.getElementById('tt-time-start');
    const endInp = document.getElementById('tt-time-end');
    const btnDel = document.getElementById('btn-delete-tt-location');

    if (codeEl) codeEl.textContent = sessInfo.courseCode || 'Course';
    if (typeEl) {
      typeEl.textContent = sessInfo.typeLabel || 'CLASS';
      typeEl.style.display = 'inline-block';
    }
    if (nameEl) nameEl.textContent = sessInfo.courseName || '';
    if (timeEl) {
      const origNote = sessInfo.isCustomTime ? ` (Default: ${sessInfo.rawTimeStr})` : '';
      timeEl.textContent = `${sessInfo.dayName || ''} · ${sessInfo.occ || ''}${origNote}`;
    }

    if (inp) inp.value = sessInfo.currentVenue || '';
    if (startInp) startInp.value = sessInfo.startTime || sessInfo.rawStartTime || '08:00';
    if (endInp) endInp.value = sessInfo.endTime || sessInfo.rawEndTime || '10:00';

    updateDurationPreview();

    if (btnDel) {
      btnDel.textContent = getTimetableText('timetable', 'deleteClass', 'Delete Class');
      btnDel.style.display = 'inline-block';
    }
    const btnResetOvr = document.getElementById('btn-reset-tt-session-overrides');
    if (btnResetOvr) {
      btnResetOvr.textContent = getTimetableText('timetable', 'resetOverrides', 'Reset Overrides');
      const hasOverrides = Boolean(sessInfo.currentVenue || sessInfo.isCustomTime);
      btnResetOvr.style.display = hasOverrides ? 'inline-block' : 'none';
    }

    modal.style.display = 'flex';
    setTimeout(() => {
      if (startInp) {
        startInp.focus();
      }
    }, 50);
  }

  function downloadBlobFile(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    if (chrome && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: blobUrl,
        filename: filename,
        saveAs: false
      }, () => {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 20000);
      });
    } else {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 20000);
    }
  }

  function flashExportButtonSuccess(btn) {
    if (!btn) return;
    const origContent = btn.innerHTML;
    const lang = getTimetableLang();
    const expText = (lang === 'zh') ? '已导出' : ((lang === 'bm') ? 'Telah Dieksport' : 'Exported');
    btn.innerHTML = `
      <svg class="icon-svg" viewBox="0 0 24 24" style="stroke:#FFFFFF;width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg>
      <span style="color:#FFFFFF;font-weight:700;">${expText}</span>
    `;
    btn.disabled = true;
    setTimeout(() => {
      if (typeof window !== 'undefined' && typeof window.updateTimetableTranslations === 'function') {
        window.updateTimetableTranslations();
      } else {
        btn.innerHTML = origContent;
      }
      btn.disabled = false;
    }, 2000);
  }

  function exportTimetableCSV() {
    const sessions = extractWeeklyTimetableSessions();
    if (sessions.length === 0) {
      alert('No timetable sessions available to export. Please synchronize your attendance records first.');
      return;
    }

    const headers = ['Day', 'Course Code', 'Course Name', 'Type', 'OCC', 'Start Time', 'End Time', 'Duration', 'Venue'];
    const rows = [headers.join(',')];

    sessions.forEach(s => {
      const parts = s.timeStr.split('-');
      const startT = (parts[0] || '').trim();
      const endT = (parts[1] || '').trim();
      const cleanVenue = s.venue.replace(/"/g, '""');
      const cleanName = s.courseName.replace(/"/g, '""');

      const localizedDayNames = getTimetableDayNames();
      const dayLabel = (typeof s.dayIndex === 'number' && localizedDayNames[s.dayIndex]) ? localizedDayNames[s.dayIndex] : s.dayName;
      rows.push([
        `"${dayLabel}"`,
        `"${s.courseCode}"`,
        `"${cleanName}"`,
        `"${s.typeLabel}"`,
        `"${s.occ}"`,
        `"${startT}"`,
        `"${endT}"`,
        `"${s.durText}"`,
        `"${cleanVenue}"`
      ].join(','));
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlobFile(blob, 'SPeCTRUM_Academic_Timetable.csv');
    flashExportButtonSuccess(document.getElementById('btn-export-timetable-csv'));
  }

  // ── Canvas Theme Palettes for Adaptive Mode Export ──
  const CANVAS_THEMES = {
    light: {
      mode: 'light',
      canvasBg: '#FFFFFF',
      gridBg: '#FFFFFF',
      gridBorder: '#E4E4E7',
      headerBg: '#FBFBFC',
      headerBorder: '#D4D4D8',
      headerTextPrimary: '#18181B',
      headerTextSecondary: '#71717A',
      dayLabelText: '#18181B',
      emptyBannerBg: '#FAFAFB',
      gapCellBg: 'rgba(0, 0, 0, 0.012)',
      gapCellBorder: '#F0F0F2',
      gapCellText: '#A1A1AA',
      badgeBg: '#F4F4F5',
      badgeBorder: '#E4E4E7',
      badgeLabel: '#71717A',
      badgeVal: '#18181B',
      cardBg: '#FFFFFF',
      cardBorder: '#E4E4E7',
      cardAccent: '#18181B',
      codeText: '#18181B',
      occText: '#71717A',
      titleText: '#18181B',
      venueText: '#71717A',
      durText: '#71717A',
      tagBg: '#F4F4F5',
      tagBorder: '#E4E4E7',
      tagText: '#71717A',
      watermarkText: '#A1A1AA',
      logoBg: '#18181B',
      logoBorder: null,
      logoStroke: '#FFFFFF'
    },
    dark: {
      mode: 'dark',
      canvasBg: '#09090B',
      gridBg: '#12141A',
      gridBorder: 'rgba(255, 255, 255, 0.12)',
      headerBg: '#181C24',
      headerBorder: 'rgba(255, 255, 255, 0.14)',
      headerTextPrimary: '#F4F4F5',
      headerTextSecondary: '#94A3B8',
      dayLabelText: '#F4F4F5',
      emptyBannerBg: 'rgba(255, 255, 255, 0.02)',
      gapCellBg: 'rgba(255, 255, 255, 0.02)',
      gapCellBorder: 'rgba(255, 255, 255, 0.08)',
      gapCellText: '#71717A',
      badgeBg: '#181C24',
      badgeBorder: 'rgba(255, 255, 255, 0.14)',
      badgeLabel: '#94A3B8',
      badgeVal: '#F4F4F5',
      cardBg: '#181C22',
      cardBorder: 'rgba(255, 255, 255, 0.12)',
      cardAccent: '#38BDF8',
      codeText: '#F4F4F5',
      occText: '#A1A1AA',
      titleText: '#FFFFFF',
      venueText: '#CBD5E1',
      durText: '#94A3B8',
      tagBg: 'rgba(255, 255, 255, 0.08)',
      tagBorder: 'rgba(255, 255, 255, 0.14)',
      tagText: '#E2E8F0',
      watermarkText: '#71717A',
      logoBg: '#18181B',
      logoBorder: 'rgba(255, 255, 255, 0.18)',
      logoStroke: '#FFFFFF'
    },
    glass: {
      mode: 'glass',
      canvasBg: 'transparent',
      gridBg: 'rgba(15, 23, 42, 0.42)',
      gridBorder: 'rgba(255, 255, 255, 0.22)',
      headerBg: 'rgba(15, 23, 42, 0.50)',
      headerBorder: 'rgba(255, 255, 255, 0.18)',
      headerTextPrimary: '#FFFFFF',
      headerTextSecondary: 'rgba(255, 255, 255, 0.82)',
      dayLabelText: '#FFFFFF',
      emptyBannerBg: 'rgba(255, 255, 255, 0.03)',
      gapCellBg: 'rgba(255, 255, 255, 0.03)',
      gapCellBorder: 'rgba(255, 255, 255, 0.12)',
      gapCellText: 'rgba(255, 255, 255, 0.65)',
      badgeBg: 'rgba(255, 255, 255, 0.12)',
      badgeBorder: 'rgba(255, 255, 255, 0.28)',
      badgeLabel: 'rgba(255, 255, 255, 0.75)',
      badgeVal: '#FFFFFF',
      cardBg: 'rgba(15, 23, 42, 0.62)',
      cardBorder: 'rgba(255, 255, 255, 0.30)',
      cardAccent: '#34D399',
      codeText: '#FFFFFF',
      occText: 'rgba(255, 255, 255, 0.88)',
      titleText: '#FFFFFF',
      venueText: 'rgba(255, 255, 255, 0.92)',
      durText: 'rgba(255, 255, 255, 0.78)',
      tagBg: 'rgba(255, 255, 255, 0.22)',
      tagBorder: 'rgba(255, 255, 255, 0.40)',
      tagText: '#FFFFFF',
      watermarkText: 'rgba(255, 255, 255, 0.75)',
      logoBg: 'rgba(255, 255, 255, 0.14)',
      logoBorder: 'rgba(255, 255, 255, 0.40)',
      logoStroke: '#FFFFFF'
    }
  };

  /**
   * Detect currently active theme mode for timetable canvas export.
   */
  function getActiveTimetableExportTheme() {
    const hasCustomBg = (typeof document !== 'undefined') &&
      (document.body?.classList.contains('has-custom-bg') || document.documentElement?.classList.contains('has-custom-bg'));
    const mode = (typeof document !== 'undefined')
      ? (document.documentElement.getAttribute('data-theme') || (document.body && document.body.getAttribute('data-theme')) || 'light')
      : 'light';
    if (mode === 'glass' || hasCustomBg) return 'glass';
    if (mode === 'dark') return 'dark';
    return 'light';
  }

  /**
   * Draw linear gradient background for canvas.
   */
  function drawCanvasGradient(ctx, width, height, gradStr) {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    if (!gradStr || typeof gradStr !== 'string' || gradStr === 'aurora') {
      grad.addColorStop(0, '#090d16');
      grad.addColorStop(0.35, '#1e1b4b');
      grad.addColorStop(0.70, '#064e3b');
      grad.addColorStop(1, '#090d16');
    } else if (gradStr.includes('#451a03') || gradStr.includes('sunset')) {
      grad.addColorStop(0, '#18181b');
      grad.addColorStop(0.35, '#451a03');
      grad.addColorStop(0.70, '#701a75');
      grad.addColorStop(1, '#18181b');
    } else if (gradStr.includes('#172554') || gradStr.includes('cyber')) {
      grad.addColorStop(0, '#030712');
      grad.addColorStop(0.40, '#172554');
      grad.addColorStop(0.75, '#581c87');
      grad.addColorStop(1, '#030712');
    } else if (gradStr.includes('#334155') || gradStr.includes('minimal')) {
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(0.50, '#334155');
      grad.addColorStop(1, '#0f172a');
    } else {
      const stopMatches = Array.from(gradStr.matchAll(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*(\d+)%/g));
      if (stopMatches.length > 0) {
        stopMatches.forEach(m => {
          const color = m[1];
          const stop = Math.max(0, Math.min(1, parseInt(m[2], 10) / 100));
          grad.addColorStop(stop, color);
        });
      } else {
        grad.addColorStop(0, '#090d16');
        grad.addColorStop(0.35, '#1e1b4b');
        grad.addColorStop(0.70, '#064e3b');
        grad.addColorStop(1, '#090d16');
      }
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Asynchronously retrieves active wallpaper image/gradient for glass export.
   */
  async function loadActiveWallpaperData() {
    let bgVal = '';
    try {
      if (typeof localStorage !== 'undefined') {
        bgVal = localStorage.getItem('spectrum_custom_bg') || '';
      }
    } catch (e) {}

    if (!bgVal && typeof document !== 'undefined') {
      const bgLayer = document.getElementById('custom-bg-layer');
      if (bgLayer && bgLayer.style.backgroundImage) {
        bgVal = bgLayer.style.backgroundImage;
      } else {
        bgVal = document.documentElement.style.getPropertyValue('--glass-thumb-bg') || '';
      }
    }

    if (!bgVal && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const res = await new Promise(r => chrome.storage.local.get(['customBgImage'], r));
        if (res && res.customBgImage) bgVal = res.customBgImage;
      } catch (e) {}
    }

    bgVal = (bgVal || '').trim();
    if (bgVal.startsWith('url(')) {
      bgVal = bgVal.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
    }

    if (!bgVal) {
      return { type: 'gradient', value: 'aurora' };
    }

    if (bgVal.startsWith('linear-gradient') || bgVal.startsWith('radial-gradient')) {
      return { type: 'gradient', value: bgVal };
    }

    const img = await new Promise(resolve => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => {
        console.warn('[SPeCTRUM Timetable] Could not load wallpaper image for canvas, using fallback gradient');
        resolve(null);
      };
      el.src = bgVal;
    });

    if (img) {
      return { type: 'image', img };
    }

    return { type: 'gradient', value: 'aurora' };
  }

  /**
   * Draws the official SPeCTRUM PRO prism brand mark onto an HTML5 Canvas.
   * Rendered with pure mathematical vector paths for pin-sharp export at any DPI.
   */
  function drawCanvasPrismLogo(ctx, x, y, size, themeConfig) {
    ctx.save();
    const radius = 10;
    ctx.fillStyle = (themeConfig && themeConfig.logoBg) ? themeConfig.logoBg : '#18181B';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, size, size, radius);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + size, y, x + size, y + size, radius);
      ctx.arcTo(x + size, y + size, x, y + size, radius);
      ctx.arcTo(x, y + size, x, y, radius);
      ctx.arcTo(x, y, x + size, y, radius);
    }
    ctx.fill();

    if (themeConfig && themeConfig.logoBorder) {
      ctx.strokeStyle = themeConfig.logoBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const s = size / 200;
    const toX = vx => x + vx * s;
    const toY = vy => y + vy * s;
    const strokeColor = (themeConfig && themeConfig.logoStroke) ? themeConfig.logoStroke : '#FFFFFF';

    // 1. Triangular Prism Outline
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1.8, 2.2 * s);
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(toX(100), toY(36.4));
    ctx.lineTo(toX(32.7), toY(149.5));
    ctx.lineTo(toX(167.3), toY(149.5));
    ctx.closePath();
    ctx.stroke();

    // Base subline
    ctx.beginPath();
    ctx.moveTo(toX(35.7), toY(145.9));
    ctx.lineTo(toX(164.3), toY(145.9));
    ctx.stroke();

    // 2. Incident Beam (entering from left)
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.moveTo(toX(0.2), toY(141.4));
    ctx.lineTo(toX(50.9), toY(124.6));
    ctx.lineTo(toX(49.3), toY(120.0));
    ctx.lineTo(toX(-0.2), toY(140.2));
    ctx.closePath();
    ctx.fill();

    // 3. Internal Refraction & Lightning Zig-Zag
    ctx.lineWidth = Math.max(1.5, 2.0 * s);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(50.1), toY(120.7));
    ctx.lineTo(toX(100.7), toY(105.4));
    ctx.lineTo(toX(75.6), toY(87.4));
    ctx.lineTo(toX(122.4), toY(71.1));
    ctx.lineTo(toX(123.7), toY(78.2));
    ctx.lineTo(toX(98.6), toY(91.1));
    ctx.lineTo(toX(129.9), toY(111.6));
    ctx.lineTo(toX(50.1), toY(123.9));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 4. Refracted Spectral Rays (exiting right)
    ctx.beginPath();
    ctx.moveTo(toX(122.8), toY(72.1));
    ctx.lineTo(toX(200.1), toY(39.8));
    ctx.lineTo(toX(199.9), toY(39.2));
    ctx.lineTo(toX(122.0), toY(70.1));
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(toX(123.1), toY(75.9));
    ctx.lineTo(toX(200.1), toY(51.7));
    ctx.lineTo(toX(199.9), toY(50.9));
    ctx.lineTo(toX(122.7), toY(74.3));
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(toX(124.1), toY(79.9));
    ctx.lineTo(toX(200.1), toY(64.4));
    ctx.lineTo(toX(199.9), toY(63.6));
    ctx.lineTo(toX(123.7), toY(78.3));
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function renderHorizontalTimetableToCanvas(theme, bgData) {
    if (!theme) {
      const mode = getActiveTimetableExportTheme();
      theme = CANVAS_THEMES[mode] || CANVAS_THEMES.light;
    }

    const sessions = extractWeeklyTimetableSessions();
    const DAY_NAMES = getTimetableDayNames();
    // Always include Monday to Saturday (days 1..6)
    const activeDayIndices = [1, 2, 3, 4, 5, 6];
    if (sessions.some(s => s.dayIndex === 0)) activeDayIndices.push(0);

    const todayDayIndex = new Date().getDay();

    let minHour = 8;
    let maxHour = 18;
    sessions.forEach(s => {
      if (!s) return;
      if (typeof s.startHour === 'number' && !isNaN(s.startHour) && s.startHour < minHour) minHour = s.startHour;
      if (typeof s.endHour === 'number' && !isNaN(s.endHour) && s.endHour > maxHour) maxHour = s.endHour;
      if (s.endMin > 0 && typeof s.endHour === 'number' && !isNaN(s.endHour) && s.endHour >= maxHour) maxHour = s.endHour + 1;
    });
    const totalCols = maxHour - minHour;
    const totalDays = activeDayIndices.length;

    // ── 1. Calculate Proportional Layout Matching the 1-Page Sweet Spot ──
    const width = 2200;
    const gridX = 60;
    const gridY = 145;
    const gridW = width - 120; // 2080px
    const cornerW = 160;
    const headerH = 48;

    // Optimal Export Geometry Configured via Tuner Studio
    const exportConfig = {
      unitRowH: 160,
      emptyDayRatio: 0.42,
      emptyHourRatio: 0.45,
      cardMarginX: 8,
      cardMarginY: 6,
      cardRadius: 10,
      codeFontSize: 18,
      headerYOffset: 22,
      tagFontSize: 15,
      tagYOffset: 10,
      occFontSize: 16,
      occYOffset: 47,
      titleFontSize: 18,
      titleLineH: 20,
      titleYOffset: 73,
      venueFontSize: 17,
      footerBottomInset: 14
    };

    // Empty days take half row height (weight 0.42)
    const hasDaySession = dIdx => sessions.some(s => s.dayIndex === dIdx);
    const isDayHalf = dIdx => !hasDaySession(dIdx);

    // Empty hours take half column width (weight 0.45)
    const isHourHalf = h => !sessions.some(s => {
      if (!s) return false;
      const sStart = (typeof s.startHour === 'number') ? s.startHour + (s.startMin || 0) / 60 : 0;
      const sEnd = (typeof s.endHour === 'number') ? s.endHour + (s.endMin || 0) / 60 : 0;
      return sStart < (h + 1) && sEnd > h;
    });

    const hourColWeights = [];
    for (let h = minHour; h < maxHour; h++) {
      hourColWeights.push(isHourHalf(h) ? exportConfig.emptyHourRatio : 1.0);
    }
    const totalHourColWeight = hourColWeights.reduce((a, b) => a + b, 0);
    const availableHourW = gridW - cornerW; // 1920px
    const unitHourW = availableHourW / totalHourColWeight;

    // Proportional row height configured via Tuner Studio
    const unitRowH = exportConfig.unitRowH;

    const dayRows = [];
    let curRowY = gridY + headerH;
    activeDayIndices.forEach(dIdx => {
      const isHalf = isDayHalf(dIdx);
      const rH = isHalf ? Math.round(unitRowH * exportConfig.emptyDayRatio) : unitRowH;
      dayRows.push({ dIdx, y: curRowY, h: rH, isHalf });
      curRowY += rH;
    });

    const gridH = curRowY - gridY;
    const height = curRowY + 55; // Fitted canvas height

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fill Canvas Background matching active theme
    ctx.fillStyle = (theme.mode === 'glass') ? '#090D16' : theme.canvasBg;
    ctx.fillRect(0, 0, width, height);

    if (theme.mode === 'glass') {
      if (bgData && bgData.type === 'image' && bgData.img) {
        const img = bgData.img;
        const imgW = img.naturalWidth || img.width || 1920;
        const imgH = img.naturalHeight || img.height || 1080;
        const scale = Math.max(width / imgW, height / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const drawX = (width - drawW) / 2;
        const drawY = (height - drawH) / 2;
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        // Ambient glass tint overlay
        ctx.fillStyle = 'rgba(10, 15, 26, 0.42)';
        ctx.fillRect(0, 0, width, height);
      } else if (bgData && bgData.type === 'gradient') {
        drawCanvasGradient(ctx, width, height, bgData.value);
      } else {
        drawCanvasGradient(ctx, width, height, 'aurora');
      }
    }

    // ── 1. SPeCTRUM PRO Brand Mark (Icon Square) ──
    const iconSize = 74;
    const iconX = 60;
    const iconY = 46;
    drawCanvasPrismLogo(ctx, iconX, iconY, iconSize, theme);

    // ── 2. Elevated Brand & Title Typography ──
    const titleLeftX = iconX + iconSize + 20; // 154px
    ctx.fillStyle = theme.headerTextPrimary;
    ctx.font = '800 17px "JetBrains Mono", monospace';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.fillText('SPECTRUM PRO', titleLeftX, 70);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    ctx.font = '800 42px "Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const mainTitleH = getTimetableText('timetable', 'mainTitle', 'ACADEMIC TIMETABLE');
    ctx.fillText(mainTitleH, titleLeftX, 114);

    // ── 3. Right-Aligned Tabular Metadata Pill (TERM: Year / SEM) ──
    let academicYear = '2026/2027';
    let semType = 'SEM I';
    const termInfoH = (typeof window.detectActualAcademicTerm === 'function')
      ? window.detectActualAcademicTerm(new Date())
      : ((typeof window.getUmAcademicInfo === 'function') ? window.getUmAcademicInfo(new Date()) : null);
    if (termInfoH) {
      if (termInfoH.academicYear) academicYear = termInfoH.academicYear;
      if (termInfoH.semType) semType = termInfoH.semType;
    }

    const badgeW = 270;
    const badgeH = 74;
    const badgeX = width - 60 - badgeW;
    const badgeY = 46;

    ctx.fillStyle = theme.badgeBg;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();
    if (theme.badgeBorder) {
      ctx.strokeStyle = theme.badgeBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.fillStyle = theme.badgeLabel;
    ctx.font = '700 18px "JetBrains Mono", monospace';
    ctx.fillText('TERM:', badgeX + 24, badgeY + 44);

    ctx.fillStyle = theme.badgeVal;
    ctx.font = '800 21px "JetBrains Mono", monospace';
    ctx.fillText(academicYear, badgeX + 96, badgeY + 35);
    ctx.fillText(semType, badgeX + 96, badgeY + 61);

    // ── 4. Calculate Hour Columns ──
    const hourCols = [];
    let curColX = gridX + cornerW;
    for (let c = 0; c < totalCols; c++) {
      const h = minHour + c;
      const cW = hourColWeights[c] * unitHourW;
      hourCols.push({ h, x: curColX, w: cW, isHalf: hourColWeights[c] === 0.45 });
      curColX += cW;
    }

    function getCanvasHorizontalX(h, m) {
      let x = gridX + cornerW;
      for (let hr = minHour; hr < h && hr < maxHour; hr++) {
        const idx = hr - minHour;
        x += hourCols[idx].w;
      }
      if (h < maxHour) {
        const idx = h - minHour;
        const fraction = Math.min(60, Math.max(0, m || 0)) / 60;
        x += fraction * hourCols[idx].w;
      }
      return x;
    }

    // Outer Grid Border & Background
    ctx.fillStyle = theme.gridBg;
    ctx.fillRect(gridX, gridY, gridW, gridH);
    ctx.strokeStyle = theme.gridBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(gridX, gridY, gridW, gridH);

    // Header Row Background
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(gridX, gridY, gridW, headerH);
    ctx.beginPath();
    ctx.moveTo(gridX, gridY + headerH);
    ctx.lineTo(gridX + gridW, gridY + headerH);
    ctx.strokeStyle = theme.headerBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Corner Header Cell (ACADEMIC WK / TIME (MYT))
    ctx.fillStyle = theme.headerTextPrimary;
    ctx.font = '800 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const acadWkText = (mainTitleH === 'JADUAL WAKTU AKADEMIK') ? 'MINGGU AKADEMIK' : 'ACADEMIC WK';
    ctx.fillText(acadWkText, gridX + cornerW / 2, gridY + 22);
    ctx.fillStyle = theme.headerTextSecondary;
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillText('TIME (MYT)', gridX + cornerW / 2, gridY + 38);

    ctx.beginPath();
    ctx.moveTo(gridX + cornerW, gridY);
    ctx.lineTo(gridX + cornerW, gridY + gridH);
    ctx.strokeStyle = theme.headerBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const pad = n => String(n).padStart(2, '0');

    // Time Slot Columns (Col 2..N)
    for (let c = 0; c < totalCols; c++) {
      const colInfo = hourCols[c];
      const h = colInfo.h;
      const colX = colInfo.x;
      const colW = colInfo.w;
      const isHalf = colInfo.isHalf;

      ctx.beginPath();
      ctx.moveTo(colX, gridY);
      ctx.lineTo(colX, gridY + gridH);
      ctx.strokeStyle = theme.gridBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = theme.headerTextPrimary;
      ctx.font = `800 ${isHalf ? 12 : 15}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${pad(h)}:00`, colX + colW / 2, gridY + 22);

      ctx.fillStyle = theme.headerTextSecondary;
      ctx.font = `600 ${isHalf ? 9.5 : 11}px "JetBrains Mono", monospace`;
      ctx.fillText(`${pad(h + 1)}:00`, colX + colW / 2, gridY + 38);
    }
    ctx.textAlign = 'left';

    // Day Rows
    dayRows.forEach(rowInfo => {
      const { dIdx, y, h: rowH, isHalf } = rowInfo;
      const dayName = DAY_NAMES[dIdx];
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      // Horizontal Row Divider
      ctx.beginPath();
      ctx.moveTo(gridX, y);
      ctx.lineTo(gridX + gridW, y);
      ctx.strokeStyle = theme.gridBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Day Label Cell (Col 1)
      ctx.fillStyle = theme.dayLabelText;
      const dFontSz = isHalf ? 12.5 : 15;
      ctx.font = `800 ${dFontSz}px "Hanken Grotesk", sans-serif`;
      ctx.fillText(dayName, gridX + 18, y + rowH / 2 + 5);

      if (daySess.length === 0) {
        // Empty Day Banner
        ctx.fillStyle = theme.emptyBannerBg;
        ctx.fillRect(gridX + cornerW + 2, y + 2, gridW - cornerW - 4, rowH - 4);
      } else {
        const occupied = new Array(totalCols).fill(false);

        daySess.forEach(s => {
          const startIdx = Math.max(0, s.startHour - minHour);
          const endIdx = Math.min(totalCols, (s.endHour - minHour) + (s.endMin > 0 ? 1 : 0));
          for (let i = startIdx; i < endIdx; i++) occupied[i] = true;

          const startX = getCanvasHorizontalX(s.startHour, s.startMin);
          const endX = getCanvasHorizontalX(s.endHour, s.endMin);

          // Card Geometry
          const cardMarginX = exportConfig.cardMarginX;
          const cardMarginY = exportConfig.cardMarginY;
          const cardX = startX + cardMarginX;
          const cardY = y + cardMarginY;
          const cardW = Math.max(60, endX - startX - cardMarginX * 2);
          const cardH = rowH - cardMarginY * 2;

          // Card Background & Border
          if (theme.mode === 'glass') {
            ctx.save();
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(cardX, cardY, cardW, cardH, exportConfig.cardRadius);
            } else {
              ctx.rect(cardX, cardY, cardW, cardH);
            }
            ctx.fillStyle = theme.cardBg;
            ctx.fill();
            const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
            cardGrad.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
            cardGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.05)');
            cardGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
            ctx.fillStyle = cardGrad;
            ctx.fill();
            ctx.strokeStyle = theme.cardBorder;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.fillStyle = theme.cardBg;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(cardX, cardY, cardW, cardH, exportConfig.cardRadius);
            } else {
              ctx.rect(cardX, cardY, cardW, cardH);
            }
            ctx.fill();
            ctx.strokeStyle = theme.cardBorder;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          // Left Accent Stripe
          let accentColor = theme.cardAccent;
          if (theme.mode !== 'light') {
            if (s.typeLabel === 'LEC') accentColor = '#34D399';
            else if (s.typeLabel === 'TUT') accentColor = '#FBBF24';
            else if (s.typeLabel === 'LAB') accentColor = '#C084FC';
            else accentColor = '#38BDF8';
          }
          ctx.fillStyle = accentColor;
          ctx.fillRect(cardX, cardY, 5, cardH);

          // 1. Header Line: Code + Acronym + Type Tag
          const sessAcronym = getSessionAcronym(s.courseName, s.courseCode);
          const rawDisplayCode = sessAcronym
            ? `${cleanSingleCourseCode(s.courseCode)} · ${sessAcronym}`
            : cleanSingleCourseCode(s.courseCode);

          // Tag dimensions
          ctx.font = `700 ${exportConfig.tagFontSize}px "JetBrains Mono", monospace`;
          const tagW = Math.max(34, ctx.measureText(s.typeLabel).width + 14);
          const tagH = Math.max(16, Math.round(exportConfig.tagFontSize * 1.55));
          let tagX = cardX + cardW - tagW - 12;

          // Code text with collision avoidance against tag badge
          ctx.font = `800 ${exportConfig.codeFontSize}px "JetBrains Mono", monospace`;
          let displayCodeText = rawDisplayCode;
          const maxCodeW = tagX - cardX - 20;
          if (ctx.measureText(displayCodeText).width > maxCodeW) {
            const bareCode = cleanSingleCourseCode(s.courseCode);
            if (ctx.measureText(bareCode).width <= maxCodeW) {
              displayCodeText = bareCode;
            } else {
              while (displayCodeText.length > 4 && ctx.measureText(displayCodeText + '…').width > maxCodeW) {
                displayCodeText = displayCodeText.slice(0, -1);
              }
              displayCodeText += '…';
            }
          }

          const headerY = cardY + exportConfig.headerYOffset;
          ctx.fillStyle = theme.codeText;
          ctx.fillText(displayCodeText, cardX + 14, headerY);

          // Type Tag Pill
          const tagY = cardY + exportConfig.tagYOffset;
          ctx.fillStyle = theme.tagBg;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(tagX, tagY, tagW, tagH, 3);
          } else {
            ctx.rect(tagX, tagY, tagW, tagH);
          }
          ctx.fill();
          ctx.strokeStyle = theme.tagBorder;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = theme.tagText;
          ctx.font = `700 ${exportConfig.tagFontSize}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          const tagTextY = tagY + Math.round(tagH * 0.72);
          ctx.fillText(s.typeLabel, tagX + tagW / 2, tagTextY);
          ctx.textAlign = 'left';

          // 2. Subtitle: OCC
          ctx.fillStyle = theme.occText;
          ctx.font = `700 ${exportConfig.occFontSize}px "JetBrains Mono", monospace`;
          const occY = cardY + exportConfig.occYOffset;
          ctx.fillText(s.occ, cardX + 14, occY);

          // 4. Footer: Anchor Venue left, Duration badge right
          const footerY = cardY + cardH - exportConfig.footerBottomInset;

          // 3. Course Title (Multi-line wrap, dynamically fitted so it never collides with footer)
          ctx.fillStyle = theme.titleText;
          ctx.font = `800 ${exportConfig.titleFontSize}px "Hanken Grotesk", sans-serif`;
          const maxTitleW = cardW - 28;
          const titleLineH = exportConfig.titleLineH;
          let maxAllowedLines = (cardH >= 95) ? 2 : 1;
          let titleLines = wrapCanvasTitle(str => ctx.measureText(str).width, s.courseName, maxTitleW, maxAllowedLines);
          let startTitleY = cardY + exportConfig.titleYOffset;

          // Guarantee zero collision against footer
          if (startTitleY + (titleLines.length - 1) * titleLineH > footerY - 18) {
            titleLines = [titleLines[0]];
            startTitleY = Math.min(startTitleY, footerY - 20);
          }

          titleLines.forEach((tLine, tIdx) => {
            ctx.fillText(tLine, cardX + 14, startTitleY + tIdx * titleLineH);
          });

          // Venue (Left) & Duration (Right)
          ctx.fillStyle = theme.venueText;
          ctx.font = `600 ${exportConfig.venueFontSize}px "JetBrains Mono", monospace`;
          if (s.venue && s.venue.trim().length > 0) {
            let vText = `${s.venue}`;
            const durW = s.durText ? ctx.measureText(s.durText).width + 16 : 0;
            const maxVenueW = cardW - durW - 32;
            if (ctx.measureText(vText).width > maxVenueW) {
              while (vText.length > 4 && ctx.measureText(vText + '…').width > maxVenueW) {
                vText = vText.slice(0, -1);
              }
              vText += '…';
            }
            ctx.fillText(vText, cardX + 14, footerY);
          }

          if (s.durText) {
            ctx.fillStyle = theme.durText;
            ctx.textAlign = 'right';
            ctx.fillText(s.durText, cardX + cardW - 14, footerY);
            ctx.textAlign = 'left';
          }
        });

        // Fill Gaps
        let gapStart = null;
        for (let i = 0; i <= totalCols; i++) {
          if (i < totalCols && !occupied[i]) {
            if (gapStart === null) gapStart = i;
          } else {
            if (gapStart !== null) {
              const gapX = getCanvasHorizontalX(gapStart + minHour, 0) + 3;
              const gapY = y + 4;
              const gapEndColX = getCanvasHorizontalX(i + minHour, 0);
              const gapW = Math.max(16, (gapEndColX - gapX) - 6);
              const gapH = rowH - 8;

              ctx.fillStyle = theme.gapCellBg;
              ctx.fillRect(gapX, gapY, gapW, gapH);
              ctx.strokeStyle = theme.gapCellBorder;
              ctx.lineWidth = 1;
              ctx.strokeRect(gapX, gapY, gapW, gapH);

              const gStartH = gapStart + minHour;
              const gEndH = i + minHour;
              const label = getEditorialGapLabel(gStartH, gEndH);

              ctx.fillStyle = theme.gapCellText;
              ctx.font = '600 11px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              if (gapW > 100) {
                ctx.fillText(label, gapX + gapW / 2, gapY + gapH / 2 + 4);
              }
              ctx.textAlign = 'left';

              gapStart = null;
            }
          }
        }
      }
    });

    // Bottom Watermark
    ctx.fillStyle = theme.watermarkText;
    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.fillText('SPeCTRUM PRO · ACADEMIC SUITE · UNIVERSITI MALAYA', 60, height - 20);

    return canvas;
  }

  async function renderTimetableToCanvas() {
    const themeMode = getActiveTimetableExportTheme();
    const theme = CANVAS_THEMES[themeMode] || CANVAS_THEMES.light;
    let bgData = null;
    if (theme.mode === 'glass') {
      bgData = await loadActiveWallpaperData();
    }
    if (currentTimetableLayout === 'horizontal') {
      return renderHorizontalTimetableToCanvas(theme, bgData);
    }
    return renderVerticalTimetableToCanvas(theme, bgData);
  }

  function renderVerticalTimetableToCanvas(theme, bgData) {
    if (!theme) {
      const mode = getActiveTimetableExportTheme();
      theme = CANVAS_THEMES[mode] || CANVAS_THEMES.light;
    }

    const sessions = extractWeeklyTimetableSessions();
    const DAY_NAMES = getTimetableDayNames();
    // Always include Monday to Saturday (days 1..6)
    const activeDayIndices = [1, 2, 3, 4, 5, 6];
    if (sessions.some(s => s.dayIndex === 0)) activeDayIndices.push(0);

    const todayDayIndex = new Date().getDay();

    let minHour = 8;
    let maxHour = 18;
    sessions.forEach(s => {
      if (!s) return;
      if (typeof s.startHour === 'number' && !isNaN(s.startHour) && s.startHour < minHour) minHour = s.startHour;
      if (typeof s.endHour === 'number' && !isNaN(s.endHour) && s.endHour > maxHour) maxHour = s.endHour;
      if (s.endMin > 0 && typeof s.endHour === 'number' && !isNaN(s.endHour) && s.endHour >= maxHour) maxHour = s.endHour + 1;
    });

    const totalHours = maxHour - minHour;
    const totalDays = activeDayIndices.length;

    // High resolution canvas (A4 landscape ratio compatible: 2200 x 1450)
    const width = 2200;
    const height = 1450;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fill Canvas Background matching active theme
    ctx.fillStyle = (theme.mode === 'glass') ? '#090D16' : theme.canvasBg;
    ctx.fillRect(0, 0, width, height);

    if (theme.mode === 'glass') {
      if (bgData && bgData.type === 'image' && bgData.img) {
        const img = bgData.img;
        const imgW = img.naturalWidth || img.width || 1920;
        const imgH = img.naturalHeight || img.height || 1080;
        const scale = Math.max(width / imgW, height / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const drawX = (width - drawW) / 2;
        const drawY = (height - drawH) / 2;
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        // Ambient glass tint overlay
        ctx.fillStyle = 'rgba(10, 15, 26, 0.42)';
        ctx.fillRect(0, 0, width, height);
      } else if (bgData && bgData.type === 'gradient') {
        drawCanvasGradient(ctx, width, height, bgData.value);
      } else {
        drawCanvasGradient(ctx, width, height, 'aurora');
      }
    }

    // ── 1. SPeCTRUM PRO Brand Mark (Icon Square) ──
    const iconSize = 74;
    const iconX = 60;
    const iconY = 46;
    drawCanvasPrismLogo(ctx, iconX, iconY, iconSize, theme);

    // ── 2. Elevated Brand & Title Typography ──
    const titleLeftX = iconX + iconSize + 20; // 154px
    ctx.fillStyle = theme.headerTextPrimary;
    ctx.font = '800 17px "JetBrains Mono", monospace';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.fillText('SPECTRUM PRO', titleLeftX, 70);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    ctx.font = '800 42px "Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const mainTitleV = getTimetableText('timetable', 'mainTitle', 'ACADEMIC TIMETABLE');
    ctx.fillText(mainTitleV, titleLeftX, 114);

    // ── 3. Right-Aligned Tabular Metadata Pill (TERM: Year / SEM) ──
    let academicYear = '2026/2027';
    let semType = 'SEM I';
    const termInfoV = (typeof window.detectActualAcademicTerm === 'function')
      ? window.detectActualAcademicTerm(new Date())
      : ((typeof window.getUmAcademicInfo === 'function') ? window.getUmAcademicInfo(new Date()) : null);
    if (termInfoV) {
      if (termInfoV.academicYear) academicYear = termInfoV.academicYear;
      if (termInfoV.semType) semType = termInfoV.semType;
    }

    const badgeW = 270;
    const badgeH = 74;
    const badgeX = width - 60 - badgeW; // 1870px
    const badgeY = 46;
    const badgeR = 10;

    // Pill background container
    ctx.fillStyle = theme.badgeBg;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeR);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();
    if (theme.badgeBorder) {
      ctx.strokeStyle = theme.badgeBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // "TERM:" label on left of badge
    ctx.fillStyle = theme.badgeLabel;
    ctx.font = '700 18px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TERM:', badgeX + 22, badgeY + 44);

    // Year & Sem right-aligned on badge
    ctx.fillStyle = theme.badgeVal;
    ctx.font = '800 19px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(academicYear, badgeX + badgeW - 22, badgeY + 33);
    ctx.fillText(semType, badgeX + badgeW - 22, badgeY + 59);
    ctx.textAlign = 'left';

    // ── 4. Grid Coordinates ──
    const gridX = 60;
    const gridY = 145;
    const gridW = width - 120; // 2080px
    const gridH = height - gridY - 55; // 1250px
    const headerH = 65;
    const timeColW = 115;
    const availableW = gridW - timeColW;

    const hasDaySession = dIdx => sessions.some(s => s.dayIndex === dIdx);
    const isDayHalf = dIdx => !hasDaySession(dIdx);
    const dayWeights = activeDayIndices.map(dIdx => isDayHalf(dIdx) ? 0.5 : 1.0);
    const totalWeight = dayWeights.reduce((a, b) => a + b, 0);
    const unitW = availableW / totalWeight;

    // Precalculate positions & widths for all day columns
    const dayCols = [];
    let curColX = gridX + timeColW;
    activeDayIndices.forEach((dIdx, i) => {
      const colW = dayWeights[i] * unitW;
      dayCols.push({ dIdx, x: curColX, w: colW, isHalf: dayWeights[i] === 0.5 });
      curColX += colW;
    });

    const isHourHalf = h => !sessions.some(s => {
      if (!s) return false;
      const sStart = (typeof s.startHour === 'number') ? s.startHour + (s.startMin || 0) / 60 : 0;
      const sEnd = (typeof s.endHour === 'number') ? s.endHour + (s.endMin || 0) / 60 : 0;
      return sStart < (h + 1) && sEnd > h;
    });

    const hourWeights = [];
    for (let h = minHour; h < maxHour; h++) {
      hourWeights.push(isHourHalf(h) ? 0.45 : 1.0);
    }
    const totalHourWeight = hourWeights.reduce((a, b) => a + b, 0);
    const availableH = gridH - headerH;
    const unitH = availableH / totalHourWeight;

    const hourRows = [];
    let curRowY = gridY + headerH;
    for (let i = 0; i < totalHours; i++) {
      const h = minHour + i;
      const rH = hourWeights[i] * unitH;
      hourRows.push({ hour: h, y: curRowY, rowH: rH, isHalf: hourWeights[i] === 0.45 });
      curRowY += rH;
    }

    function getCanvasVerticalY(h, m) {
      let y = gridY + headerH;
      for (let hr = minHour; hr < h && hr < maxHour; hr++) {
        const idx = hr - minHour;
        y += hourRows[idx].rowH;
      }
      if (h < maxHour) {
        const idx = h - minHour;
        const fraction = Math.min(60, Math.max(0, m || 0)) / 60;
        y += fraction * hourRows[idx].rowH;
      }
      return y;
    }

    // Grid outer border & fill
    ctx.fillStyle = theme.gridBg;
    ctx.fillRect(gridX, gridY, gridW, gridH);
    ctx.strokeStyle = theme.gridBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(gridX, gridY, gridW, gridH);

    // Header Row background
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(gridX, gridY, gridW, headerH);
    ctx.beginPath();
    ctx.moveTo(gridX, gridY + headerH);
    ctx.lineTo(gridX + gridW, gridY + headerH);
    ctx.strokeStyle = theme.headerBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Corner Header Cell (Col 1)
    ctx.beginPath();
    ctx.moveTo(gridX + timeColW, gridY);
    ctx.lineTo(gridX + timeColW, gridY + gridH);
    ctx.strokeStyle = theme.headerBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = theme.headerTextPrimary;
    ctx.font = '800 17px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('UTC+8', gridX + timeColW / 2, gridY + 36);
    ctx.fillStyle = theme.headerTextSecondary;
    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.fillText('TIME (MYT)', gridX + timeColW / 2, gridY + 54);

    const pad = n => String(n).padStart(2, '0');

    // Day Column Headers (Col 2..N)
    dayCols.forEach((colInfo, colOffset) => {
      const { dIdx, x: colX, w: dayColW, isHalf } = colInfo;
      const dayName = DAY_NAMES[dIdx];

      if (colOffset > 0) {
        ctx.beginPath();
        ctx.moveTo(colX, gridY);
        ctx.lineTo(colX, gridY + gridH);
        ctx.strokeStyle = theme.gridBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const fontSz = isHalf ? 16 : 20;
      ctx.font = `800 ${fontSz}px "Hanken Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.dayLabelText;
      ctx.fillText(dayName, colX + dayColW / 2, gridY + 41);
    });

    // Time Column Labels & Horizontal Grid Lines
    for (let i = 0; i < totalHours; i++) {
      const rowInfo = hourRows[i];
      const h = rowInfo.hour;
      const rowY = rowInfo.y;
      const isHalf = rowInfo.isHalf;

      ctx.beginPath();
      ctx.moveTo(gridX, rowY);
      ctx.lineTo(gridX + gridW, rowY);
      ctx.strokeStyle = theme.gridBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = theme.headerTextSecondary;
      ctx.font = `700 ${isHalf ? 14 : 18}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${pad(h)}:00`, gridX + timeColW / 2, rowY + (isHalf ? 18 : 24));
    }
    ctx.textAlign = 'left';

    // Day Columns Content
    dayCols.forEach(colInfo => {
      const { dIdx, x: colX, w: dayColW } = colInfo;
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      if (daySess.length === 0) {
        // Empty day column
      } else {
        const packed = computeSessionColumns(daySess);

        packed.forEach(s => {
          const startY = getCanvasVerticalY(s.startHour, s.startMin);
          const endY = getCanvasVerticalY(s.endHour, s.endMin);
          const cardY = startY + 8;
          const cardH = Math.max(40, endY - startY - 16);
          const isTall = cardH >= 140;

          let cardX = colX + 10;
          let cardW = dayColW - 20;
          if (s._totalCols > 1) {
            const singleW = (dayColW - 20) / s._totalCols;
            cardX = colX + 10 + s._colIndex * singleW;
            cardW = singleW - 8;
          }

          // Card Background & Border
          if (theme.mode === 'glass') {
            ctx.save();
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(cardX, cardY, cardW, cardH, 8);
            } else {
              ctx.rect(cardX, cardY, cardW, cardH);
            }
            ctx.fillStyle = theme.cardBg;
            ctx.fill();
            const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
            cardGrad.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
            cardGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.05)');
            cardGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
            ctx.fillStyle = cardGrad;
            ctx.fill();
            ctx.strokeStyle = theme.cardBorder;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.fillStyle = theme.cardBg;
            ctx.fillRect(cardX, cardY, cardW, cardH);
            ctx.strokeStyle = theme.cardBorder;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(cardX, cardY, cardW, cardH);
          }

          // Bold left accent stripe
          let accentColor = theme.cardAccent;
          if (theme.mode !== 'light') {
            if (s.typeLabel === 'LEC') accentColor = '#34D399';
            else if (s.typeLabel === 'TUT') accentColor = '#FBBF24';
            else if (s.typeLabel === 'LAB') accentColor = '#C084FC';
            else accentColor = '#38BDF8';
          }
          ctx.fillStyle = accentColor;
          ctx.fillRect(cardX, cardY, 6, cardH);

          const isCompactCard = (s.durHours && s.durHours < 1.5) || cardH < 95;

          // Header: Code + Tag Badge
          const isCompactCol = cardW < 240;
          ctx.font = isCompactCol
            ? '800 16px "JetBrains Mono", monospace'
            : '800 18px "JetBrains Mono", monospace';

          const sessAcronym = getSessionAcronym(s.courseName, s.courseCode);
          let rawDisplayCode = sessAcronym
            ? `${cleanSingleCourseCode(s.courseCode)} · ${sessAcronym}`
            : cleanSingleCourseCode(s.courseCode);

          if (isCompactCard && s.occ) {
            rawDisplayCode += ` · ${s.occ}`;
          }

          ctx.font = '700 12.5px "JetBrains Mono", monospace';
          const tagW = Math.max(40, ctx.measureText(s.typeLabel).width + 14);
          let tagX = cardX + cardW - tagW - 14;

          ctx.font = isCompactCol
            ? '800 16px "JetBrains Mono", monospace'
            : '800 18px "JetBrains Mono", monospace';
          let displayCodeText = rawDisplayCode;
          const maxCodeW = tagX - cardX - 22;
          if (ctx.measureText(displayCodeText).width > maxCodeW) {
            const bareCode = (isCompactCard && s.occ)
              ? `${cleanSingleCourseCode(s.courseCode)} · ${s.occ}`
              : cleanSingleCourseCode(s.courseCode);
            if (ctx.measureText(bareCode).width <= maxCodeW) {
              displayCodeText = bareCode;
            } else {
              while (displayCodeText.length > 4 && ctx.measureText(displayCodeText + '…').width > maxCodeW) {
                displayCodeText = displayCodeText.slice(0, -1);
              }
              displayCodeText += '…';
            }
          }

          const headerY = isTall ? (cardY + 30) : (cardY + 26);
          ctx.fillStyle = theme.codeText;
          ctx.fillText(displayCodeText, cardX + 16, headerY);

          // Type Tag Pill
          const tagY = isTall ? (cardY + 14) : (cardY + 11);
          ctx.fillStyle = theme.tagBg;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(tagX, tagY, tagW, 22, 3);
          } else {
            ctx.rect(tagX, tagY, tagW, 22);
          }
          ctx.fill();
          ctx.strokeStyle = theme.tagBorder;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = theme.tagText;
          ctx.font = '700 12.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(s.typeLabel, tagX + tagW / 2, tagY + 15.5);
          ctx.textAlign = 'left';

          const footerY = isTall ? (cardY + cardH - 16) : (cardY + cardH - 14);

          // If NOT compact card (>= 2 hours), draw Title and OCC
          if (!isCompactCard) {
            ctx.fillStyle = theme.titleText;
            ctx.font = '800 18px "Hanken Grotesk", sans-serif';
            const maxTitleW = cardW - 28;
            let maxTitleLines = (cardH >= 120) ? 2 : 1;
            const titleLines = wrapCanvasTitle(str => ctx.measureText(str).width, s.courseName, maxTitleW, maxTitleLines);
            const titleLineH = isTall ? 26 : 22;
            let startTitleY = isTall
              ? (titleLines.length > 1 ? cardY + 62 : cardY + 68)
              : (titleLines.length > 1 ? cardY + 50 : cardY + 54);

            if (startTitleY + (titleLines.length - 1) * titleLineH > footerY - 45) {
              startTitleY = Math.min(startTitleY, footerY - 50);
            }

            titleLines.forEach((tLine, tIdx) => {
              ctx.fillText(tLine, cardX + 16, startTitleY + tIdx * titleLineH);
            });

            // Subtitle: OCC
            if (cardH >= 95) {
              ctx.fillStyle = theme.occText;
              ctx.font = '600 15px "JetBrains Mono", monospace';
              let sub = s.occ || '';
              if (ctx.measureText(sub).width > cardW - 28) {
                while (sub.length > 4 && ctx.measureText(sub + '…').width > cardW - 28) {
                  sub = sub.slice(0, -1);
                }
                sub += '…';
              }
              const subY = isTall
                ? (titleLines.length > 1 ? startTitleY + titleLineH + 28 : startTitleY + 34)
                : (titleLines.length > 1 ? (cardY + 92) : (cardY + 80));
              if (subY < footerY - 14) {
                ctx.fillText(sub, cardX + 16, subY);
              }
            }
          } else {
            // Compact 1-hour Card
            ctx.fillStyle = theme.titleText;
            ctx.font = '800 15px "Hanken Grotesk", sans-serif';
            const maxTitleW = cardW - 28;
            const titleLines = wrapCanvasTitle(str => ctx.measureText(str).width, s.courseName, maxTitleW, 1);
            const titleY = cardY + 48;
            if (titleLines.length > 0 && titleY < footerY - 14) {
              ctx.fillText(titleLines[0], cardX + 16, titleY);
            }
          }

          // Footer (Venue left, Time right)
          if (cardH >= 55) {
            if (s.venue) {
              ctx.fillStyle = theme.venueText;
              ctx.font = '600 15px "JetBrains Mono", monospace';
              const vText = `${s.venue}`;
              const timeW = ctx.measureText(s.timeStr).width;
              const maxVenueW = cardW - 32 - timeW - 14;
              let displayVenue = vText;
              if (ctx.measureText(displayVenue).width > maxVenueW) {
                while (displayVenue.length > 4 && ctx.measureText(displayVenue + '…').width > maxVenueW) {
                  displayVenue = displayVenue.slice(0, -1);
                }
                displayVenue += '…';
              }
              ctx.fillText(displayVenue, cardX + 16, footerY);
            }

            ctx.fillStyle = theme.durText;
            ctx.font = '600 15px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(s.timeStr, cardX + cardW - 14, footerY);
            ctx.textAlign = 'left';
          }
        });
      }
    });

    // Bottom Watermark
    ctx.fillStyle = theme.watermarkText;
    ctx.font = '600 14px "JetBrains Mono", monospace';
    ctx.fillText('SPeCTRUM PRO · ACADEMIC SUITE · UNIVERSITI MALAYA', 60, height - 25);

    return canvas;
  }

  async function exportTimetablePNG() {
    const btn = document.getElementById('btn-export-timetable-png');
    const canvas = await renderTimetableToCanvas();
    if (!canvas) {
      alert('Unable to render timetable graphic. Please ensure attendance data is loaded.');
      return;
    }

    canvas.toBlob(blob => {
      if (blob) {
        downloadBlobFile(blob, 'SPeCTRUM_Academic_Timetable.png');
        flashExportButtonSuccess(btn);
      }
    }, 'image/png');
  }

  function buildPdfFromJpegBytes(jpegBytes, imgW, imgH, widthPt = 842, heightPt = 595, marginPt = 24) {
    const binaryLen = jpegBytes.length;
    let pdf = '%PDF-1.4\n';
    const offsets = [];

    function addObj(str) {
      offsets.push(pdf.length);
      pdf += str;
    }

    addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    addObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    addObj(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);

    const obj4Header = `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${binaryLen} >>\nstream\n`;
    offsets.push(pdf.length);
    pdf += obj4Header;

    // Calculate proportional fit within page margins
    const availW = widthPt - marginPt * 2;
    const availH = heightPt - marginPt * 2;
    const imgAspect = (imgW > 0 && imgH > 0) ? (imgW / imgH) : (widthPt / heightPt);

    let drawW = availW;
    let drawH = drawW / imgAspect;
    if (drawH > availH) {
      drawH = availH;
      drawW = drawH * imgAspect;
    }

    const posX = (widthPt - drawW) / 2;
    const posY = (heightPt - drawH) / 2;

    const contentStream = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${posX.toFixed(2)} ${posY.toFixed(2)} cm\n/Im1 Do\nQ\n`;
    const obj5 = `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`;

    const enc = new TextEncoder();
    const p1 = enc.encode(pdf);
    const pStreamEnd = enc.encode('\nendstream\nendobj\n');

    const obj5Offset = p1.length + jpegBytes.length + pStreamEnd.length;
    offsets.push(obj5Offset);
    const p5 = enc.encode(obj5);

    const xrefOffset = obj5Offset + p5.length;
    let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach(off => {
      xref += String(off).padStart(10, '0') + ' 00000 n \n';
    });
    xref += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    const pXref = enc.encode(xref);

    const totalLen = p1.length + jpegBytes.length + pStreamEnd.length + p5.length + pXref.length;
    const out = new Uint8Array(totalLen);
    let pos = 0;
    out.set(p1, pos); pos += p1.length;
    out.set(jpegBytes, pos); pos += jpegBytes.length;
    out.set(pStreamEnd, pos); pos += pStreamEnd.length;
    out.set(p5, pos); pos += p5.length;
    out.set(pXref, pos); pos += pXref.length;

    return out;
  }

  async function exportTimetablePDF() {
    const btn = document.getElementById('btn-export-timetable-pdf');
    const canvas = await renderTimetableToCanvas();
    if (!canvas) {
      alert('Unable to render timetable graphic. Please ensure attendance data is loaded.');
      return;
    }

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.96);
      const base64 = dataUrl.split(',')[1];
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Standard A4 Landscape: 842 x 595 points
      const pdfBytes = buildPdfFromJpegBytes(bytes, canvas.width, canvas.height, 842, 595);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      downloadBlobFile(blob, 'SPeCTRUM_Academic_Timetable.pdf');
      flashExportButtonSuccess(btn);
    } catch (err) {
      console.warn('[SPeCTRUM Timetable] Direct PDF build fallback to print dialog:', err);
      window.print();
    }
  }

  function initTimetableControls() {
    loadCustomLocations();
    if (typeof document === 'undefined') return;

    const modal = document.getElementById('tt-location-modal');
    const btnClose = document.getElementById('btn-close-tt-location-modal');
    const btnCancel = document.getElementById('btn-cancel-tt-location');
    const btnSave = document.getElementById('btn-save-tt-location');
    const btnDelete = document.getElementById('btn-delete-tt-location');
    const inp = document.getElementById('tt-location-input');
    const chipsWrap = document.getElementById('tt-quick-location-chips');

    const startInp = document.getElementById('tt-time-start');
    const endInp = document.getElementById('tt-time-end');
    const btnResetTime = document.getElementById('btn-reset-tt-time');

    if (modal && !modal._hasLocationListeners) {
      modal._hasLocationListeners = true;

      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeLocationModal();
      });

      if (btnClose) btnClose.addEventListener('click', closeLocationModal);
      if (btnCancel) btnCancel.addEventListener('click', closeLocationModal);

      if (startInp) startInp.addEventListener('input', updateDurationPreview);
      if (endInp) endInp.addEventListener('input', updateDurationPreview);

      // Quick duration buttons
      modal.querySelectorAll('.btn-dur-quick').forEach(btn => {
        btn.addEventListener('click', () => {
          applyQuickDuration('tt-time-start', 'tt-time-end', 'tt-time-duration-preview', btn.dataset.dur);
        });
      });

      // Reset to Moodle time button
      if (btnResetTime) {
        btnResetTime.addEventListener('click', () => {
          if (!activeSessionForLocation) return;
          if (startInp) startInp.value = activeSessionForLocation.rawStartTime || '08:00';
          if (endInp) endInp.value = activeSessionForLocation.rawEndTime || '10:00';
          updateDurationPreview();
        });
      }

      const saveCurrentModalValues = async () => {
        if (!activeSessionForLocation) return;
        const locVal = inp ? inp.value.trim() : '';
        const startVal = startInp ? startInp.value.trim() : '';
        const endVal = endInp ? endInp.value.trim() : '';

        let hasCustomTime = false;
        let startHour = 0, startMin = 0, endHour = 0, endMin = 0;

        if (startVal && endVal && startVal.includes(':') && endVal.includes(':')) {
          const sM = parseMinutes(startVal);
          const eM = parseMinutes(endVal);
          if (eM <= sM) {
            alert('End time must be later than start time.');
            if (endInp) endInp.focus();
            return;
          }
          const sParts = startVal.split(':');
          const eParts = endVal.split(':');
          startHour = parseInt(sParts[0], 10);
          startMin = parseInt(sParts[1], 10);
          endHour = parseInt(eParts[0], 10);
          endMin = parseInt(eParts[1], 10);

          if (startVal !== activeSessionForLocation.rawStartTime || endVal !== activeSessionForLocation.rawEndTime) {
            hasCustomTime = true;
          }
        }

        const overrideData = {
          venue: locVal,
          startTime: startVal,
          endTime: endVal,
          startHour,
          startMin,
          endHour,
          endMin,
          hasCustomTime
        };

        await saveSessionOverride(activeSessionForLocation.key, activeSessionForLocation.fallbackKey, overrideData);
        closeLocationModal();
        renderTimetableMode();
      };

      if (btnSave) {
        btnSave.addEventListener('click', saveCurrentModalValues);
      }

      if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
          if (!activeSessionForLocation) return;
          const cName = activeSessionForLocation.courseCode || 'this class';
          const confirmTpl = getTimetableText('timetable', 'deleteConfirm', 'Are you sure you want to delete {course} from your timetable?');
          const confirmMsg = confirmTpl.replace('{course}', cName);
          if (!confirm(confirmMsg)) return;
          await saveSessionOverride(activeSessionForLocation.key, activeSessionForLocation.fallbackKey, {
            isDeleted: true,
            hidden: true
          });
          closeLocationModal();
          renderTimetableMode();
        });
      }

      const btnResetOvr = document.getElementById('btn-reset-tt-session-overrides');
      if (btnResetOvr) {
        btnResetOvr.addEventListener('click', async () => {
          if (!activeSessionForLocation) return;
          await saveSessionOverride(activeSessionForLocation.key, activeSessionForLocation.fallbackKey, null);
          closeLocationModal();
          renderTimetableMode();
        });
      }

      if (inp) {
        inp.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            await saveCurrentModalValues();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            closeLocationModal();
          }
        });
      }

      if (chipsWrap) {
        chipsWrap.addEventListener('click', (e) => {
          const chip = e.target.closest('.btn-loc-quick');
          if (!chip) return;
          const loc = chip.dataset.loc || chip.textContent.trim();
          if (inp) {
            inp.value = loc;
            inp.focus();
          }
        });
      }
    }

    const btnVert = document.getElementById('btn-tt-vertical');
    const btnHoriz = document.getElementById('btn-tt-horizontal');
    if (btnVert && !btnVert._hasSwitchListener) {
      btnVert._hasSwitchListener = true;
      btnVert.addEventListener('click', () => setTimetableLayout('vertical'));
    }
    if (btnHoriz && !btnHoriz._hasSwitchListener) {
      btnHoriz._hasSwitchListener = true;
      btnHoriz.addEventListener('click', () => setTimetableLayout('horizontal'));
    }
    updateLayoutSwitchUI();

    const btnOnePage = document.getElementById('btn-tt-one-page');
    if (btnOnePage && !btnOnePage._hasOnePageListener) {
      btnOnePage._hasOnePageListener = true;
      btnOnePage.addEventListener('click', toggleOnePageMode);
    }
    updateOnePageButtonUI();

    // Add Manual Class button & modal listeners
    const btnAddClass = document.getElementById('btn-add-tt-session');
    if (btnAddClass && !btnAddClass._hasAddManualListener) {
      btnAddClass._hasAddManualListener = true;
      btnAddClass.addEventListener('click', () => openManualSessionModal(null));
    }

    // Import .ics Calendar File & Active Capsule Controls
    const btnImportIcs = document.getElementById('btn-import-timetable-ics');
    const inputImportIcs = document.getElementById('input-import-timetable-ics');
    const btnIcsDelete = document.getElementById('btn-ics-delete');
    const btnIcsReplace = document.getElementById('btn-ics-replace');

    if (btnImportIcs && inputImportIcs && !btnImportIcs._hasImportListener) {
      btnImportIcs._hasImportListener = true;
      btnImportIcs.addEventListener('click', () => {
        inputImportIcs.value = '';
        inputImportIcs.click();
      });
    }

    if (btnIcsReplace && inputImportIcs && !btnIcsReplace._hasReplaceListener) {
      btnIcsReplace._hasReplaceListener = true;
      btnIcsReplace.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        inputImportIcs.value = '';
        inputImportIcs.click();
      });
    }

    if (btnIcsDelete && !btnIcsDelete._hasDeleteListener) {
      btnIcsDelete._hasDeleteListener = true;
      btnIcsDelete.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const confirmMsg = getTimetableText('timetable', 'removeIcsConfirm', 'Remove imported .ics calendar and restore your SPeCTRUM timetable?');
        if (!confirm(confirmMsg)) return;

        activeIcsFilename = null;
        activeIcsSessions = [];
        await chrome.storage.local.remove(['activeIcsFilename', 'activeIcsSessions']);
        updateIcsCapsuleUI();
        renderTimetableMode();
      });
    }

    if (inputImportIcs && !inputImportIcs._hasChangeListener) {
      inputImportIcs._hasChangeListener = true;
      inputImportIcs.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = parseICSCalendarData(text);
          if (parsed.length === 0) {
            alert('No valid class schedule events found in the selected .ics file. Please verify that the file contains VEVENT records.');
            return;
          }
          activeIcsFilename = file.name;
          activeIcsSessions = parsed;
          await chrome.storage.local.set({
            activeIcsFilename,
            activeIcsSessions
          });
          updateIcsCapsuleUI();
          renderTimetableMode();
          alert(`✔ Successfully loaded ${parsed.length} class session(s) from "${file.name}"! SPeCTRUM timetable has been replaced with this schedule.`);
        } catch (err) {
          console.error('[SPeCTRUM Pro] .ics import error:', err);
          alert('Failed to parse .ics file: ' + (err?.message || err));
        }
      });
    }

    const addModal = document.getElementById('tt-add-session-modal');
    if (addModal && !addModal._hasManualModalListeners) {
      addModal._hasManualModalListeners = true;

      const btnManualClose = document.getElementById('btn-close-tt-manual-modal');
      const btnModalRestore = document.getElementById('btn-modal-restore-deleted');
      if (btnModalRestore && !btnModalRestore._hasRestoreListener) {
        btnModalRestore._hasRestoreListener = true;
        btnModalRestore.addEventListener('click', async () => {
          const currentDeleted = getDeletedSessionsCount();
          const confirmTpl = getTimetableText('timetable', 'restoreConfirm', 'Restore {n} hidden/deleted class session(s) back to your timetable?');
          const confirmMsg = confirmTpl.replace('{n}', currentDeleted);
          if (!confirm(confirmMsg)) return;
          closeManualSessionModal();
          await restoreAllDeletedSessions();
        });
      }
      const btnManualCancel = document.getElementById('btn-cancel-tt-manual');
      const btnManualSave = document.getElementById('btn-save-tt-manual');
      const btnManualDelete = document.getElementById('btn-delete-tt-manual');
      const mCodeInp = document.getElementById('tt-manual-code');
      const mNameInp = document.getElementById('tt-manual-name');
      const mOccInp = document.getElementById('tt-manual-occ');
      const mDaySel = document.getElementById('tt-manual-day');
      const mStartInp = document.getElementById('tt-manual-start');
      const mEndInp = document.getElementById('tt-manual-end');
      const mLocInp = document.getElementById('tt-manual-location');
      const mCourseChips = document.getElementById('tt-manual-course-chips');
      const mTypeChips = document.getElementById('tt-manual-type-chips');
      const mLocChips = document.getElementById('tt-manual-quick-locations');

      addModal.addEventListener('click', (e) => {
        if (e.target === addModal) closeManualSessionModal();
      });
      if (btnManualClose) btnManualClose.addEventListener('click', closeManualSessionModal);
      if (btnManualCancel) btnManualCancel.addEventListener('click', closeManualSessionModal);

      if (mStartInp) mStartInp.addEventListener('input', () => updateTimeDurationPreview('tt-manual-start', 'tt-manual-end', 'tt-manual-duration-preview'));
      if (mEndInp) mEndInp.addEventListener('input', () => updateTimeDurationPreview('tt-manual-start', 'tt-manual-end', 'tt-manual-duration-preview'));

      addModal.querySelectorAll('.btn-manual-dur-quick').forEach(btn => {
        btn.addEventListener('click', () => {
          applyQuickDuration('tt-manual-start', 'tt-manual-end', 'tt-manual-duration-preview', btn.dataset.dur);
        });
      });

      if (mCourseChips) {
        mCourseChips.addEventListener('click', (e) => {
          const chip = e.target.closest('.btn-tt-course-chip');
          if (!chip) return;
          if (mCodeInp) mCodeInp.value = chip.dataset.code || '';
          if (mNameInp) mNameInp.value = chip.dataset.name || '';
          if (mOccInp && chip.dataset.occ) mOccInp.value = chip.dataset.occ;
          mCourseChips.querySelectorAll('.btn-tt-course-chip').forEach(c => c.classList.toggle('is-selected', c === chip));
        });
      }

      if (mTypeChips) {
        mTypeChips.addEventListener('click', (e) => {
          const chip = e.target.closest('.btn-tt-type-chip');
          if (!chip) return;
          setManualModalType(chip.dataset.type || 'LEC');
        });
      }

      if (mLocChips) {
        mLocChips.addEventListener('click', (e) => {
          const chip = e.target.closest('.btn-manual-loc-quick');
          if (!chip) return;
          if (mLocInp) {
            mLocInp.value = chip.dataset.loc || chip.textContent.trim();
            mLocInp.focus();
          }
        });
      }

      const saveManualSessionFromModal = async () => {
        const rawCode = mCodeInp ? mCodeInp.value.trim().toUpperCase() : '';
        const rawName = mNameInp ? mNameInp.value.trim() : '';
        if (!rawCode) {
          alert('Please enter a Course Code (e.g. WIA2003).');
          if (mCodeInp) mCodeInp.focus();
          return;
        }
        if (!rawName) {
          alert('Please enter a Course Name.');
          if (mNameInp) mNameInp.focus();
          return;
        }
        const startVal = mStartInp ? mStartInp.value.trim() : '';
        const endVal = mEndInp ? mEndInp.value.trim() : '';
        if (!startVal || !endVal || !startVal.includes(':') || !endVal.includes(':')) {
          alert('Please provide valid start and end times.');
          return;
        }
        if (parseMinutes(endVal) <= parseMinutes(startVal)) {
          alert('End time must be later than start time.');
          if (mEndInp) mEndInp.focus();
          return;
        }
        const [sH, sM] = startVal.split(':').map(n => parseInt(n, 10));
        const [eH, eM] = endVal.split(':').map(n => parseInt(n, 10));
        const selectedTypeBtn = addModal.querySelector('#tt-manual-type-chips .btn-tt-type-chip.is-selected');
        const typeLabel = selectedTypeBtn ? (selectedTypeBtn.dataset.type || 'LEC') : 'LEC';

        const record = normalizeManualSessionRecord({
          id: activeManualEditId || `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          dayIndex: mDaySel ? parseInt(mDaySel.value, 10) : 1,
          courseCode: rawCode,
          courseName: rawName,
          typeLabel,
          occ: mOccInp ? mOccInp.value.trim() : 'OCC 1',
          startHour: sH,
          startMin: sM,
          endHour: eH,
          endMin: eM,
          venue: mLocInp ? mLocInp.value.trim() : ''
        });
        if (!record) return;

        const inIcsIdx = activeManualEditId ? activeIcsSessions.findIndex(m => m.id === activeManualEditId) : -1;
        if (inIcsIdx >= 0) {
          activeIcsSessions[inIcsIdx] = record;
          await chrome.storage.local.set({ activeIcsSessions });
        } else {
          const existingIdx = activeManualEditId ? manualTimetableSessions.findIndex(m => m.id === activeManualEditId) : -1;
          if (existingIdx >= 0) {
            manualTimetableSessions[existingIdx] = record;
          } else {
            manualTimetableSessions.push(record);
          }
          await persistManualTimetableSessions();
        }

        closeManualSessionModal();
        renderTimetableMode();
      };

      if (btnManualSave) btnManualSave.addEventListener('click', saveManualSessionFromModal);

      if (btnManualDelete) {
        btnManualDelete.addEventListener('click', async () => {
          if (!activeManualEditId) return;
          const confirmTpl = getTimetableText('timetable', 'deleteConfirm', 'Are you sure you want to delete {course} from your timetable?');
          const confirmMsg = confirmTpl.replace('{course}', 'this manual class');
          if (!confirm(confirmMsg)) return;
          const inIcsIdx = activeManualEditId ? activeIcsSessions.findIndex(m => m.id === activeManualEditId) : -1;
          if (inIcsIdx >= 0) {
            activeIcsSessions = activeIcsSessions.filter(m => m.id !== activeManualEditId);
            await chrome.storage.local.set({ activeIcsSessions });
          } else {
            manualTimetableSessions = manualTimetableSessions.filter(m => m.id !== activeManualEditId);
            await persistManualTimetableSessions();
          }
          closeManualSessionModal();
          renderTimetableMode();
        });
      }

      addModal.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeManualSessionModal();
        } else if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
          e.preventDefault();
          await saveManualSessionFromModal();
        }
      });
    }

    if (typeof window !== 'undefined' && !window._hasTimetableResizeListener) {
      window._hasTimetableResizeListener = true;
      window.addEventListener('resize', () => {
        if (isOnePageMode) {
          applyOnePageScaling();
        }
      });
    }

    const btnCsv = document.getElementById('btn-export-timetable-csv');
    const btnPng = document.getElementById('btn-export-timetable-png');
    const btnPdf = document.getElementById('btn-export-timetable-pdf');

    if (btnCsv && !btnCsv._hasTimetableListener) {
      btnCsv._hasTimetableListener = true;
      btnCsv.addEventListener('click', () => exportTimetableCSV());
    }
    if (btnPng && !btnPng._hasTimetableListener) {
      btnPng._hasTimetableListener = true;
      btnPng.addEventListener('click', () => exportTimetablePNG());
    }
    if (btnPdf && !btnPdf._hasTimetableListener) {
      btnPdf._hasTimetableListener = true;
      btnPdf.addEventListener('click', () => exportTimetablePDF());
    }

    setupTimetableDragScroll();
  }

  function setupTimetableDragScroll() {
    const frame = document.getElementById('timetable-scroll-frame');
    if (!frame || frame._hasDragScroll) return;
    frame._hasDragScroll = true;

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    let isDragging = false;

    frame.addEventListener('dragstart', (e) => e.preventDefault());

    frame.addEventListener('mousedown', (e) => {
      if (frame.classList.contains('is-one-page-frame')) return;
      if (e.target.closest('button, input, select, a, .tt-session-card')) return;
      if (e.button !== 0) return;
      isDown = true;
      isDragging = false;
      startX = e.pageX - frame.offsetLeft;
      scrollLeft = frame.scrollLeft;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      const x = e.pageX - frame.offsetLeft;
      const walk = x - startX;
      if (!isDragging && Math.abs(walk) > 4) {
        isDragging = true;
        frame.style.cursor = 'grabbing';
      }
      if (isDragging) {
        e.preventDefault();
        frame.scrollLeft = scrollLeft - walk;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDown) {
        isDown = false;
        frame.style.cursor = '';
      }
    });

    // Horizontal wheel support when timetable has horizontal overflow
    frame.addEventListener('wheel', (e) => {
      if (frame.classList.contains('is-one-page-frame')) return;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (frame.scrollWidth > frame.clientWidth && e.deltaY !== 0) {
        e.preventDefault();
        frame.scrollLeft += e.deltaY * 1.8;
      }
    }, { passive: false });
  }

  // Global Exports on Window
  window.cleanTimetableCourseName = cleanTimetableCourseName;
  window.extractWeeklyTimetableSessions = extractWeeklyTimetableSessions;
  window.computeSessionColumns = computeSessionColumns;
  window.renderTimetableMode = renderTimetableMode;
  window.toggleOnePageMode = toggleOnePageMode;
  window.applyOnePageScaling = applyOnePageScaling;
  window.isOnePageMode = () => isOnePageMode;
  window.renderTimetableToCanvas = renderTimetableToCanvas;
  window.setTimetableLayout = setTimetableLayout;
  window.currentTimetableLayout = () => currentTimetableLayout;
  window.exportTimetableCSV = exportTimetableCSV;
  window.exportTimetablePNG = exportTimetablePNG;
  window.exportTimetablePDF = exportTimetablePDF;
  window.updateLiveTimeTracker = updateLiveTimeTracker;
  window.initTimetableControls = initTimetableControls;
  window.openManualSessionModal = openManualSessionModal;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTimetableControls);
    } else {
      initTimetableControls();
    }
  }
})(typeof window !== 'undefined' ? window : this);
