// ==========================================================================
// ACADEMIC WEEKLY TIMETABLE MODE & EXPORT SYSTEM (Spec 5.0)
// - Vertical Academic Timetable Architecture (Hours on Y-axis, Days on X-axis)
// - Pure day-of-week slots (Monday to Friday/Sunday), zero specific dates
// - Highlights current weekday (Today) with solid grey fill
// - Full-width session cards avoiding horizontal truncation
// - Zero-dependency PDF, PNG, and CSV exporters
// ==========================================================================

(function(window) {
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
  let customOverridesLoaded = false;

  async function loadCustomLocations() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const res = await chrome.storage.local.get(['timetableLocations', 'timetableSessionOverrides']);
        if (res) {
          const locs = (res.timetableLocations && typeof res.timetableLocations === 'object') ? res.timetableLocations : {};
          const ovrs = (res.timetableSessionOverrides && typeof res.timetableSessionOverrides === 'object') ? res.timetableSessionOverrides : {};
          customSessionOverrides = Object.assign({}, locs, ovrs);
        }
      }
    } catch (e) {
      console.warn('Failed to load custom timetable session overrides:', e);
    }
    customOverridesLoaded = true;
    return customSessionOverrides;
  }

  async function saveSessionOverride(key, fallbackKey, overrideData) {
    if (!key && !fallbackKey) return;
    if (!overrideData || (!overrideData.venue && !overrideData.hasCustomTime)) {
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

  function extractWeeklyTimetableSessions(atts = null) {
    const records = atts || getSafeAttendances();
    if (!Array.isArray(records) || records.length === 0) return [];
    const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const rawSlots = [];
    const parseTime = getSafeTimeParser();

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

        let occStr = '';
        if (userOcc) {
          const occM = String(userOcc).match(/\d+/);
          occStr = occM ? `OCC ${parseInt(occM[0], 10)}` : String(userOcc).trim();
          if (!occStr.toLowerCase().startsWith('occ')) occStr = `OCC ${occStr}`;
        } else {
          const occM = (sess.desc || '').match(/OCC[- ]*(\d+)/i);
          occStr = occM ? `OCC ${parseInt(occM[1], 10)}` : 'OCC 1';
        }

        const pad = n => String(n).padStart(2, '0');
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

        const isOnline = /online|zoom|teams|google meet|meet|webex/i.test(venue);
        const venueIcon = isOnline ? '🌐' : '📍';
        const durHours = Math.max(0.5, (endHour + endMin / 60) - (startHour + startMin / 60));
        const durText = `${durHours.toFixed(durHours % 1 === 0 ? 0 : 1)}h`;
        const timeStr = `${pad(startHour)}:${pad(startMin)} - ${pad(endHour)}:${pad(endMin)}`;
        const rawTimeStr = `${pad(rawStartHour)}:${pad(rawStartMin)} - ${pad(rawEndHour)}:${pad(rawEndMin)}`;
        const venueDisplay = venue ? `${venueIcon} ${venue} · ${durText}` : durText;

        rawSlots.push({
          key: rawKey,
          fallbackKey,
          dayIndex,
          dayName,
          courseCode,
          courseName,
          typeLabel,
          occ: occStr,
          timeStr,
          rawTimeStr,
          startHour,
          startMin,
          endHour,
          endMin,
          rawStartHour,
          rawStartMin,
          rawEndHour,
          rawEndMin,
          isCustomTime,
          durHours,
          durText,
          venue,
          venueDisplay,
          venueIcon
        });
      });
    });

    const uniqueMap = new Map();
    rawSlots.forEach(s => {
      if (!uniqueMap.has(s.key)) {
        uniqueMap.set(s.key, s);
      }
    });

    function getDaySortOrder(d) {
      return d === 0 ? 7 : d;
    }

    const timetable = Array.from(uniqueMap.values()).sort((a, b) => {
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
  } catch (e) {}

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
    } catch (e) {}
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
  } catch (e) {}

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
    } catch (e) {}
    updateOnePageButtonUI();
    renderTimetableMode();
  }

  function applyOnePageScaling() {
    const frame = document.getElementById('timetable-scroll-frame');
    const grid = document.getElementById('timetable-grid');
    const scaler = document.getElementById('timetable-scaler');
    if (!frame || !grid) return;

    if (!isOnePageMode) {
      frame.classList.remove('is-one-page-frame');
      grid.classList.remove('is-one-page-grid');
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

    frame.classList.add('is-one-page-frame');
    grid.classList.add('is-one-page-grid');

    // Attach dynamic ResizeObserver to frame to handle window, dock, or layout shifts
    if (typeof ResizeObserver !== 'undefined' && !frame._hasOnePageObserver) {
      frame._hasOnePageObserver = true;
      const ro = new ResizeObserver(() => {
        if (isOnePageMode) {
          applyOnePageScaling();
          updateLiveTimeTracker();
        }
      });
      ro.observe(frame);
    }

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
    } catch (e) {}

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
        <div style="font-size: 8.5px; font-weight: 800; letter-spacing: 0.8px; color: var(--text-primary);">${esc(acadWkText)}</div>
        <div style="font-size: 8px; font-weight: 600; color: var(--text-muted); margin-top: 1px;">${esc(timeMytText)}</div>
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
          const venueHtml = hasVenue
            ? `<span class="tt-venue" title="${esc(s.venue)}">${s.venueIcon || '📍'} ${esc(s.venue)}</span>`
            : `<span class="tt-venue tt-venue-empty" title="${esc(venuePlaceholder)}"><span class="tt-venue-add-icon">📍</span> <span class="tt-venue-placeholder">${esc(venuePlaceholder)}</span></span>`;

          const startTimeVal = `${pad(s.startHour)}:${pad(s.startMin)}`;
          const endTimeVal = `${pad(s.endHour)}:${pad(s.endMin)}`;
          const rawStartTimeVal = `${pad(s.rawStartHour)}:${pad(s.rawStartMin)}`;
          const rawEndTimeVal = `${pad(s.rawEndHour)}:${pad(s.rawEndMin)}`;

          html += `
            <div class="tt-session-card${liveClass}"
                 data-session-key="${esc(s.key)}"
                 data-fallback-key="${esc(s.fallbackKey)}"
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
                 title="Click to edit session time or location"
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
    } catch (e) {}

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
          const venueHtml = hasVenue
            ? `<span class="tt-venue" title="${esc(s.venue)}">${s.venueIcon || '📍'} ${esc(s.venue)}</span>`
            : `<span class="tt-venue tt-venue-empty" title="${esc(venuePlaceholder)}"><span class="tt-venue-add-icon">📍</span> <span class="tt-venue-placeholder">${esc(venuePlaceholder)}</span></span>`;

          const startTimeVal = `${pad(s.startHour)}:${pad(s.startMin)}`;
          const endTimeVal = `${pad(s.endHour)}:${pad(s.endMin)}`;
          const rawStartTimeVal = `${pad(s.rawStartHour)}:${pad(s.rawStartMin)}`;
          const rawEndTimeVal = `${pad(s.rawEndHour)}:${pad(s.rawEndMin)}`;

          html += `
            <div class="tt-session-card${compactClass}${liveClass}"
                 data-session-key="${esc(s.key)}"
                 data-fallback-key="${esc(s.fallbackKey)}"
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
                 title="Click to edit session time or location"
                 style="top: ${topPx}px; height: ${heightPx}px; ${posStyle}">
              <div class="tt-card-header">
                <div class="tt-card-code-badge">
                  <span class="tt-code">${esc(cleanSingleCourseCode(s.courseCode))}</span>
                  ${acronymHtml}
                  ${liveBadgeHtml}
                </div>
                <span class="tt-type-tag">${esc(s.typeLabel)}</span>
              </div>
              <div class="tt-card-title" title="${esc(s.courseName)}">${esc(s.courseName)}</div>
              <div class="tt-card-subtitle">${subtitleText}</div>
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
    window.addEventListener('focus', () => updateLiveTimeTracker());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateLiveTimeTracker();
      });
    }
  }

  function renderTimetableMode() {
    updateLayoutSwitchUI();
    updateOnePageButtonUI();
    const gridEl = document.getElementById('timetable-grid');
    const countEl = document.getElementById('timetable-session-count');
    if (!gridEl) return;

    const sessions = extractWeeklyTimetableSessions();
    if (countEl) {
      countEl.textContent = `${sessions.length} Contact Session${sessions.length === 1 ? '' : 's'}`;
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
      gridEl.innerHTML = `
        <div class="tt-empty-state" style="padding: 56px 24px; text-align: center; font-family: var(--font-sans); color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 12px;">🗓</div>
          <div style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">No Timetable Sessions Found</div>
          <div style="font-size: 13px; max-width: 440px; margin: 0 auto; line-height: 1.5;">
            Synchronize your course attendance to automatically populate your weekly academic timetable.
          </div>
        </div>
      `;
      return;
    }

    if (currentTimetableLayout === 'horizontal') {
      renderHorizontalGrid(gridEl, sessions);
    } else {
      renderVerticalGrid(gridEl, sessions);
    }

    if (!gridEl._hasLocationClickListener) {
      gridEl._hasLocationClickListener = true;
      gridEl.addEventListener('click', (e) => {
        const card = e.target.closest('.tt-session-card');
        if (!card) return;
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

  function updateDurationPreview() {
    const startInp = document.getElementById('tt-time-start');
    const endInp = document.getElementById('tt-time-end');
    const previewEl = document.getElementById('tt-time-duration-preview');
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
      const hasOverrides = Boolean(sessInfo.currentVenue || sessInfo.isCustomTime);
      btnDel.style.display = hasOverrides ? 'inline-block' : 'none';
    }

    modal.style.display = 'flex';
    setTimeout(() => {
      if (startInp) {
        startInp.focus();
      }
    }, 50);
  }

  function closeLocationModal() {
    const modal = document.getElementById('tt-location-modal');
    if (modal) modal.style.display = 'none';
    activeSessionForLocation = null;
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
      <svg class="icon-svg" viewBox="0 0 24 24" style="stroke:#10B981;width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg>
      <span style="color:#10B981;">${expText}</span>
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

  /**
   * Draws the official SPeCTRUM PRO prism brand mark onto an HTML5 Canvas.
   * Rendered with pure mathematical vector paths for pin-sharp export at any DPI.
   */
  function drawCanvasPrismLogo(ctx, x, y, size) {
    ctx.save();
    const radius = 10;
    ctx.fillStyle = '#18181B';
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

    const s = size / 200;
    const toX = vx => x + vx * s;
    const toY = vy => y + vy * s;

    // 1. Triangular Prism Outline
    ctx.strokeStyle = '#FFFFFF';
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
    ctx.fillStyle = '#FFFFFF';
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
    // Ray 1
    ctx.beginPath();
    ctx.moveTo(toX(122.8), toY(72.1));
    ctx.lineTo(toX(200.1), toY(39.8));
    ctx.lineTo(toX(199.9), toY(39.2));
    ctx.lineTo(toX(122.0), toY(70.1));
    ctx.closePath();
    ctx.fill();

    // Ray 2
    ctx.beginPath();
    ctx.moveTo(toX(123.1), toY(75.9));
    ctx.lineTo(toX(200.1), toY(51.7));
    ctx.lineTo(toX(199.9), toY(50.9));
    ctx.lineTo(toX(122.7), toY(74.3));
    ctx.closePath();
    ctx.fill();

    // Ray 3
    ctx.beginPath();
    ctx.moveTo(toX(124.1), toY(79.9));
    ctx.lineTo(toX(200.1), toY(64.4));
    ctx.lineTo(toX(199.9), toY(63.6));
    ctx.lineTo(toX(123.7), toY(78.3));
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function renderHorizontalTimetableToCanvas() {
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
      hourColWeights.push(isHourHalf(h) ? 0.45 : 1.0);
    }
    const totalHourColWeight = hourColWeights.reduce((a, b) => a + b, 0);
    const availableHourW = gridW - cornerW; // 1920px
    const unitHourW = availableHourW / totalHourColWeight;

    // Proportional row height: exactly matches the 1-page DOM aspect ratio (~0.48x of column width)
    const unitRowH = Math.round(unitHourW * 0.48);

    const dayRows = [];
    let curRowY = gridY + headerH;
    activeDayIndices.forEach(dIdx => {
      const isHalf = isDayHalf(dIdx);
      const rH = isHalf ? Math.round(unitRowH * 0.42) : unitRowH;
      dayRows.push({ dIdx, y: curRowY, h: rH, isHalf });
      curRowY += rH;
    });

    const gridH = curRowY - gridY;
    const height = curRowY + 55; // Fitted canvas height (no giant white bottom dead space!)

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fill Canvas White Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // ── 1. SPeCTRUM PRO Brand Mark (Icon Square) ──
    const iconSize = 74;
    const iconX = 60;
    const iconY = 46;
    drawCanvasPrismLogo(ctx, iconX, iconY, iconSize);

    // ── 2. Elevated Brand & Title Typography ──
    const titleLeftX = iconX + iconSize + 20; // 154px
    ctx.fillStyle = '#18181B';
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

    ctx.fillStyle = '#F4F4F5';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();

    ctx.fillStyle = '#71717A';
    ctx.font = '700 18px "JetBrains Mono", monospace';
    ctx.fillText('TERM:', badgeX + 24, badgeY + 44);

    ctx.fillStyle = '#18181B';
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
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(gridX, gridY, gridW, gridH);
    ctx.strokeStyle = '#E4E4E7';
    ctx.lineWidth = 2;
    ctx.strokeRect(gridX, gridY, gridW, gridH);

    // Header Row Background
    ctx.fillStyle = '#FBFBFC';
    ctx.fillRect(gridX, gridY, gridW, headerH);
    ctx.beginPath();
    ctx.moveTo(gridX, gridY + headerH);
    ctx.lineTo(gridX + gridW, gridY + headerH);
    ctx.strokeStyle = '#D4D4D8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Corner Header Cell (matches Image 1: ACADEMIC WK / TIME (MYT))
    ctx.fillStyle = '#18181B';
    ctx.font = '800 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const acadWkText = (mainTitleH === 'JADUAL WAKTU AKADEMIK') ? 'MINGGU AKADEMIK' : 'ACADEMIC WK';
    ctx.fillText(acadWkText, gridX + cornerW / 2, gridY + 22);
    ctx.fillStyle = '#71717A';
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillText('TIME (MYT)', gridX + cornerW / 2, gridY + 38);

    ctx.beginPath();
    ctx.moveTo(gridX + cornerW, gridY);
    ctx.lineTo(gridX + cornerW, gridY + gridH);
    ctx.strokeStyle = '#D4D4D8';
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
      ctx.strokeStyle = '#E4E4E7';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#18181B';
      ctx.font = `800 ${isHalf ? 12 : 15}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${pad(h)}:00`, colX + colW / 2, gridY + 22);

      ctx.fillStyle = '#71717A';
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
      ctx.strokeStyle = '#E4E4E7';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Day Label Cell (Col 1)
      ctx.fillStyle = '#18181B';
      const dFontSz = isHalf ? 12.5 : 15;
      ctx.font = `800 ${dFontSz}px "Hanken Grotesk", sans-serif`;
      ctx.fillText(dayName, gridX + 18, y + rowH / 2 + 5);

      if (daySess.length === 0) {
        // Empty Day Banner
        ctx.fillStyle = '#FAFAFB';
        ctx.fillRect(gridX + cornerW + 2, y + 2, gridW - cornerW - 4, rowH - 4);
      } else {
        const occupied = new Array(totalCols).fill(false);

        daySess.forEach(s => {
          const startIdx = Math.max(0, s.startHour - minHour);
          const endIdx = Math.min(totalCols, (s.endHour - minHour) + (s.endMin > 0 ? 1 : 0));
          for (let i = startIdx; i < endIdx; i++) occupied[i] = true;

          const startX = getCanvasHorizontalX(s.startHour, s.startMin);
          const endX = getCanvasHorizontalX(s.endHour, s.endMin);

          // Card Geometry matching the 1-page sweet spot
          const cardMarginX = 10;
          const cardMarginY = 7;
          const cardX = startX + cardMarginX;
          const cardY = y + cardMarginY;
          const cardW = Math.max(60, endX - startX - cardMarginX * 2);
          const cardH = rowH - cardMarginY * 2;

          // Card Background & Border
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(cardX, cardY, cardW, cardH, 6);
          } else {
            ctx.rect(cardX, cardY, cardW, cardH);
          }
          ctx.fill();
          ctx.strokeStyle = '#E4E4E7';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Left Black Accent Stripe (Visual Anchor)
          ctx.fillStyle = '#18181B';
          ctx.fillRect(cardX, cardY, 5, cardH);

          // 1. Header Line: Code + Acronym + Type Tag + Time (if space permits)
          const isCompactCol = cardW < 240;
          const sessAcronym = getSessionAcronym(s.courseName, s.courseCode);
          const rawDisplayCode = sessAcronym
            ? `${cleanSingleCourseCode(s.courseCode)} · ${sessAcronym}`
            : cleanSingleCourseCode(s.courseCode);

          // Tag dimensions
          ctx.font = '700 11px "JetBrains Mono", monospace';
          const tagW = Math.max(34, ctx.measureText(s.typeLabel).width + 12);
          const tagH = 18;
          let tagX = cardX + cardW - tagW - 12;

          // Code text with collision avoidance against tag badge
          ctx.font = isCompactCol
            ? '800 14px "JetBrains Mono", monospace'
            : '800 15px "JetBrains Mono", monospace';
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

          const codeW = ctx.measureText(displayCodeText).width;
          if (!isCompactCol && (cardX + 14 + codeW + 10 + tagW + 110 < cardX + cardW)) {
            tagX = cardX + 14 + codeW + 10;
          }

          const headerY = cardY + 22;
          ctx.fillStyle = '#18181B';
          ctx.fillText(displayCodeText, cardX + 14, headerY);

          // Type Tag Pill
          const tagY = cardY + 8;
          ctx.fillStyle = '#F4F4F5';
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(tagX, tagY, tagW, tagH, 3);
          } else {
            ctx.rect(tagX, tagY, tagW, tagH);
          }
          ctx.fill();
          ctx.strokeStyle = '#E4E4E7';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = '#71717A';
          ctx.font = '700 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(s.typeLabel, tagX + tagW / 2, tagY + 13);
          ctx.textAlign = 'left';

          // Time Range in header for wide multi-hour cards
          ctx.fillStyle = '#71717A';
          ctx.font = '600 12.5px "JetBrains Mono", monospace';
          const timeText = s.timeStr;
          const timeWidth = ctx.measureText(timeText).width;
          if (tagX < cardX + cardW - timeWidth - 24 && cardW > 280) {
            ctx.fillText(timeText, cardX + cardW - timeWidth - 14, headerY);
          }

          // 2. Subtitle: OCC
          ctx.fillStyle = '#71717A';
          ctx.font = '700 12px "JetBrains Mono", monospace';
          const occY = cardY + 41;
          ctx.fillText(s.occ, cardX + 14, occY);

          // 3. Course Title (Multi-line wrap, up to 2 lines, comfortable leading)
          ctx.fillStyle = '#18181B';
          ctx.font = '800 14px "Hanken Grotesk", sans-serif';
          const maxTitleW = cardW - 28;
          const titleLines = wrapCanvasTitle(str => ctx.measureText(str).width, s.courseName, maxTitleW, 2);
          const titleLineH = 16;
          const startTitleY = (titleLines.length > 1) ? (cardY + 58) : (cardY + 61);

          titleLines.forEach((tLine, tIdx) => {
            ctx.fillText(tLine, cardX + 14, startTitleY + tIdx * titleLineH);
          });

          // 4. Footer: Venue left, Duration badge right
          const footerY = cardY + cardH - 10;
          if (s.venue) {
            ctx.fillStyle = '#71717A';
            ctx.font = '600 12px "JetBrains Mono", monospace';
            let vText = `${s.venueIcon || '📍'} ${s.venue}`;
            const durW = s.durText ? Math.max(32, ctx.measureText(s.durText).width + 12) : 0;
            const maxVenueW = cardW - durW - 32;
            if (ctx.measureText(vText).width > maxVenueW) {
              while (vText.length > 4 && ctx.measureText(vText + '…').width > maxVenueW) {
                vText = vText.slice(0, -1);
              }
              vText += '…';
            }
            ctx.fillText(vText, cardX + 14, footerY);
          } else {
            // Venue placeholder if empty
            ctx.fillStyle = '#A1A1AA';
            ctx.font = '600 11.5px "JetBrains Mono", monospace';
            ctx.fillText('📍 + Add Location', cardX + 14, footerY);
          }

          // Duration tag on right
          if (s.durText) {
            ctx.font = '700 11px "JetBrains Mono", monospace';
            const durW = Math.max(32, ctx.measureText(s.durText).width + 12);
            const durH = 17;
            const durX = cardX + cardW - durW - 12;
            const durY = cardY + cardH - 21;
            ctx.fillStyle = '#F4F4F5';
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(durX, durY, durW, durH, 3);
            } else {
              ctx.rect(durX, durY, durW, durH);
            }
            ctx.fill();
            ctx.strokeStyle = '#E4E4E7';
            ctx.stroke();
            ctx.fillStyle = '#71717A';
            ctx.textAlign = 'center';
            ctx.fillText(s.durText, durX + durW / 2, durY + 12.5);
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

              ctx.fillStyle = 'rgba(0, 0, 0, 0.012)';
              ctx.fillRect(gapX, gapY, gapW, gapH);
              ctx.strokeStyle = '#F0F0F2';
              ctx.lineWidth = 1;
              ctx.strokeRect(gapX, gapY, gapW, gapH);

              const gStartH = gapStart + minHour;
              const gEndH = i + minHour;
              const label = getEditorialGapLabel(gStartH, gEndH);

              ctx.fillStyle = '#A1A1AA';
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
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.fillText('SPeCTRUM PRO · ACADEMIC SUITE · UNIVERSITI MALAYA', 60, height - 20);

    return canvas;
  }

  function renderTimetableToCanvas() {
    if (currentTimetableLayout === 'horizontal') {
      return renderHorizontalTimetableToCanvas();
    }
    return renderVerticalTimetableToCanvas();
  }

  function renderVerticalTimetableToCanvas() {
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

    // Fill Canvas Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // ── 1. SPeCTRUM PRO Brand Mark (Icon Square) ──
    const iconSize = 74;
    const iconX = 60;
    const iconY = 46;
    drawCanvasPrismLogo(ctx, iconX, iconY, iconSize);

    // ── 2. Elevated Brand & Title Typography ──
    const titleLeftX = iconX + iconSize + 20; // 154px
    ctx.fillStyle = '#18181B';
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
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeR);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();
    ctx.strokeStyle = '#E4E4E7';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "TERM:" label on left of badge
    ctx.fillStyle = '#71717A';
    ctx.font = '700 18px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TERM:', badgeX + 22, badgeY + 44);

    // Year & Sem right-aligned on badge
    ctx.fillStyle = '#18181B';
    ctx.font = '800 19px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(academicYear, badgeX + badgeW - 22, badgeY + 33);
    ctx.fillText(semType, badgeX + badgeW - 22, badgeY + 59);
    ctx.textAlign = 'left';

    // ── 4. Grid Coordinates (Gained 30px vertical height from eliminated subheads) ──
    const gridX = 60;
    const gridY = 145;
    const gridW = width - 120; // 2080px
    const gridH = height - gridY - 55; // 1250px (was 1215px, +35px extra space)
    const headerH = 65;
    const timeColW = 115;
    const availableW = gridW - timeColW;

    // Any day without a single course scheduled (e.g. Friday, Saturday) takes half a cell (weight 0.5)!
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

    // Any hour without a single course across the week takes half cell height (weight 0.45)!
    const isHourHalf = h => !sessions.some(s => {
      if (!s) return false;
      const sStart = (typeof s.startHour === 'number') ? s.startHour + (s.startMin || 0) / 60 : 0;
      const sEnd = (typeof s.endHour === 'number') ? s.endHour + (s.endMin || 0) / 60 : 0;
      return sStart < (h + 1) && sEnd > h;
    });
    const hourRowWeights = [];
    for (let h = minHour; h < maxHour; h++) {
      hourRowWeights.push(isHourHalf(h) ? 0.45 : 1.0);
    }
    const totalHourRowWeight = hourRowWeights.reduce((a, b) => a + b, 0);
    const availableHourH = gridH - headerH;
    const unitHourH = availableHourH / totalHourRowWeight;

    const hourRows = [];
    let curRowY = gridY + headerH;
    for (let i = 0; i < totalHours; i++) {
      const h = minHour + i;
      const rH = hourRowWeights[i] * unitHourH;
      hourRows.push({ hour: h, y: curRowY, rowH: rH, isHalf: hourRowWeights[i] === 0.45 });
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
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(gridX, gridY, gridW, gridH);
    ctx.strokeStyle = '#E4E4E7';
    ctx.lineWidth = 2;
    ctx.strokeRect(gridX, gridY, gridW, gridH);

    // Header Row background
    ctx.fillStyle = '#FBFBFC';
    ctx.fillRect(gridX, gridY, gridW, headerH);
    ctx.beginPath();
    ctx.moveTo(gridX, gridY + headerH);
    ctx.lineTo(gridX + gridW, gridY + headerH);
    ctx.strokeStyle = '#D4D4D8';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Corner Header Cell (Col 1)
    ctx.beginPath();
    ctx.moveTo(gridX + timeColW, gridY);
    ctx.lineTo(gridX + timeColW, gridY + gridH);
    ctx.strokeStyle = '#D4D4D8';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#71717A';
    ctx.font = '800 17px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('UTC+8', gridX + timeColW / 2, gridY + 36);
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.fillText('TIME (MYT)', gridX + timeColW / 2, gridY + 54);

    const pad = n => String(n).padStart(2, '0');

    // Day Column Headers (Col 2..N)
    dayCols.forEach((colInfo, colOffset) => {
      const { dIdx, x: colX, w: dayColW, isHalf } = colInfo;
      const dayName = DAY_NAMES[dIdx];
      const isToday = (dIdx === todayDayIndex);

      if (colOffset > 0) {
        ctx.beginPath();
        ctx.moveTo(colX, gridY);
        ctx.lineTo(colX, gridY + gridH);
        ctx.strokeStyle = '#E4E4E7';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const fontSz = isHalf ? 16 : 20;
      ctx.font = `800 ${fontSz}px "Hanken Grotesk", sans-serif`;
      ctx.textAlign = 'center';

      // Clean timeless day column headers without today indicator in export
      ctx.fillStyle = '#18181B';
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
      ctx.strokeStyle = '#E4E4E7';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#71717A';
      ctx.font = `700 ${isHalf ? 14 : 18}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${pad(h)}:00`, gridX + timeColW / 2, rowY + (isHalf ? 18 : 24));
    }
    ctx.textAlign = 'left';

    // Day Columns Content
    dayCols.forEach(colInfo => {
      const { dIdx, x: colX, w: dayColW, isHalf } = colInfo;
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      if (daySess.length === 0) {
        // Empty day column: keep clean without watermark text
      } else {
        const packed = computeSessionColumns(daySess);

        packed.forEach(s => {
          const startY = getCanvasVerticalY(s.startHour, s.startMin);
          const endY = getCanvasVerticalY(s.endHour, s.endMin);
          // Generous card margin (16px vertical gap between consecutive sessions, 20px horizontal gap)
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

          // Card white background and border
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(cardX, cardY, cardW, cardH);
          ctx.strokeStyle = '#E4E4E7';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(cardX, cardY, cardW, cardH);

          // Bold left black accent stripe
          ctx.fillStyle = '#18181B';
          ctx.fillRect(cardX, cardY, 6, cardH);

          // Header: Code + Tag Badge
          const isCompactCol = cardW < 240;
          ctx.font = isCompactCol
            ? '800 16px "JetBrains Mono", monospace'
            : '800 18px "JetBrains Mono", monospace';

          const sessAcronym = getSessionAcronym(s.courseName, s.courseCode);
          const rawDisplayCode = sessAcronym
            ? `${cleanSingleCourseCode(s.courseCode)} · ${sessAcronym}`
            : cleanSingleCourseCode(s.courseCode);

          ctx.font = '700 12.5px "JetBrains Mono", monospace';
          const tagW = Math.max(40, ctx.measureText(s.typeLabel).width + 14);
          let tagX = cardX + cardW - tagW - 14;

          ctx.font = isCompactCol
            ? '800 16px "JetBrains Mono", monospace'
            : '800 18px "JetBrains Mono", monospace';
          let displayCodeText = rawDisplayCode;
          const maxCodeW = tagX - cardX - 22;
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

          const headerY = isTall ? (cardY + 30) : (cardY + 26);
          ctx.fillStyle = '#18181B';
          ctx.fillText(displayCodeText, cardX + 16, headerY);

          // Type Tag Pill
          const tagY = isTall ? (cardY + 14) : (cardY + 11);
          ctx.fillStyle = '#F4F4F5';
          ctx.fillRect(tagX, tagY, tagW, 22);
          ctx.strokeStyle = '#E4E4E7';
          ctx.lineWidth = 1;
          ctx.strokeRect(tagX, tagY, tagW, 22);
          ctx.fillStyle = '#71717A';
          ctx.font = '700 12.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(s.typeLabel, tagX + tagW / 2, tagY + 15.5);
          ctx.textAlign = 'left';

          // Course Title (Multi-line wrap, up to 2 lines with comfortable line spacing)
          ctx.fillStyle = '#18181B';
          ctx.font = '800 18px "Hanken Grotesk", sans-serif';
          const maxTitleW = cardW - 28;
          const titleLines = wrapCanvasTitle(str => ctx.measureText(str).width, s.courseName, maxTitleW, 2);
          const titleLineH = isTall ? 26 : 22;
          const startTitleY = isTall
            ? (titleLines.length > 1 ? cardY + 62 : cardY + 68)
            : (titleLines.length > 1 ? cardY + 50 : cardY + 54);

          titleLines.forEach((tLine, tIdx) => {
            ctx.fillText(tLine, cardX + 16, startTitleY + tIdx * titleLineH);
          });

          // Subtitle: OCC with proportional spacing
          if (cardH >= 80) {
            ctx.fillStyle = '#71717A';
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
            ctx.fillText(sub, cardX + 16, subY);
          }

          // Footer (Venue left with pin, Time right)
          if (cardH >= 65) {
            const footerY = isTall ? (cardY + cardH - 16) : (cardY + cardH - 14);
            if (s.venue) {
              ctx.fillStyle = '#71717A';
              ctx.font = '600 15px "JetBrains Mono", monospace';
              const vText = `${s.venueIcon || '📍'} ${s.venue}`;
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

            ctx.fillStyle = '#71717A';
            ctx.font = '600 15px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(s.timeStr, cardX + cardW - 14, footerY);
            ctx.textAlign = 'left';
          }
        });
      }
    });

    // Bottom Watermark
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '600 14px "JetBrains Mono", monospace';
    ctx.fillText('SPeCTRUM PRO · ACADEMIC SUITE · UNIVERSITI MALAYA', 60, height - 25);

    return canvas;
  }

  function exportTimetablePNG() {
    const canvas = renderTimetableToCanvas();
    if (!canvas) {
      alert('Unable to render timetable graphic. Please ensure attendance data is loaded.');
      return;
    }

    canvas.toBlob(blob => {
      if (blob) {
        downloadBlobFile(blob, 'SPeCTRUM_Academic_Timetable.png');
        flashExportButtonSuccess(document.getElementById('btn-export-timetable-png'));
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

  function exportTimetablePDF() {
    const canvas = renderTimetableToCanvas();
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
      flashExportButtonSuccess(document.getElementById('btn-export-timetable-pdf'));
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
          if (!startInp || !endInp) return;
          const dur = parseFloat(btn.dataset.dur) || 1;
          const startM = parseMinutes(startInp.value);
          const newEndM = startM + Math.round(dur * 60);
          const endH = Math.min(23, Math.floor(newEndM / 60));
          const endMin = newEndM % 60;
          const pad = n => String(n).padStart(2, '0');
          endInp.value = `${pad(endH)}:${pad(endMin)}`;
          updateDurationPreview();
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

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTimetableControls);
    } else {
      initTimetableControls();
    }
  }
})(typeof window !== 'undefined' ? window : this);
