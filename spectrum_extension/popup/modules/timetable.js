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

  function cleanTimetableCourseName(name, code) {
    if (!name) return '';
    let str = String(name).trim();
    if (code) {
      const codeClean = String(code).replace(/[^a-zA-Z0-9]/g, '.*');
      str = str.replace(new RegExp('^' + codeClean + '\\s*[-–—:]?\\s*', 'i'), '');
    }
    str = str.replace(/^[A-Z]{2,4}\d{4}(?:\/[A-Z]{2,4}\d{4})*\s*[-–—:]?\s*/i, '');
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
      const courseCode = att.courseCode || '';
      const courseName = cleanTimetableCourseName(att.courseName || '', courseCode);
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
        const cleanCode = (courseCode || '').split('/')[0].trim();
        const rawStartHour = timeInfo.startHour;
        const rawStartMin = timeInfo.startMin;
        const rawEndHour = timeInfo.endHour;
        const rawEndMin = timeInfo.endMin;
        const rawKey = `${dayIndex}_${rawStartHour}_${rawStartMin}_${rawEndHour}_${rawEndMin}_${cleanCode}_${typeLabel}`;
        const fallbackKey = `${cleanCode}_${dayIndex}_${typeLabel}`;

        // Check custom user-defined override (location and/or custom time)
        const override = (customSessionOverrides && (customSessionOverrides[rawKey] || customSessionOverrides[fallbackKey] || customSessionOverrides[`${cleanCode}_${dayIndex}_${rawStartHour}`])) || null;

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

  function renderTimetableMode() {
    const gridEl = document.getElementById('timetable-grid');
    const countEl = document.getElementById('timetable-session-count');
    if (!gridEl) return;

    const esc = getSafeEscapeHtml();
    const sessions = extractWeeklyTimetableSessions();
    if (countEl) {
      countEl.textContent = `${sessions.length} Contact Session${sessions.length === 1 ? '' : 's'}`;
    }

    if (sessions.length === 0) {
      gridEl.className = 'timetable-grid';
      gridEl.style.gridTemplateColumns = '1fr';
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

    const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const activeDayIndices = [1, 2, 3, 4, 5];
    if (sessions.some(s => s.dayIndex === 6)) activeDayIndices.push(6);
    if (sessions.some(s => s.dayIndex === 0)) activeDayIndices.push(0);

    const todayDayIndex = new Date().getDay();

    let minHour = 8;
    let maxHour = 18;
    sessions.forEach(s => {
      if (s.startHour < minHour) minHour = s.startHour;
      if (s.endHour > maxHour) maxHour = s.endHour;
      if (s.endMin > 0 && s.endHour >= maxHour) maxHour = s.endHour + 1;
    });

    // ========================================================================
    // TIMETABLE GRID ROW HEIGHT (HOUR CELL SPACING):
    // Default: 115px (increased from 80px so 1-hour cards fit comfortably with larger fonts).
    // Dynamically reads --tt-hour-row-height from popup.css (:root or .timetable-grid).
    // ========================================================================
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
    const totalHeight = totalHours * HOUR_HEIGHT;
    const pad = n => String(n).padStart(2, '0');

    gridEl.className = 'timetable-grid timetable-vertical-grid';
    gridEl.style.gridTemplateColumns = `75px repeat(${activeDayIndices.length}, minmax(185px, 1fr))`;
    gridEl.style.minWidth = `${75 + activeDayIndices.length * 185}px`;

    let html = '';

    // Row 1, Col 1: Corner Header Cell
    html += `
      <div class="tt-header-cell tt-corner-cell" style="grid-column: 1; grid-row: 1;">
        <span class="tt-corner-tz">UTC+8</span>
        <span class="tt-corner-label">TIME (MYT)</span>
      </div>
    `;

    // Row 1, Col 2..N: Day Headers (pure days of week, with Today highlighted)
    activeDayIndices.forEach((dIdx, colOffset) => {
      const col = colOffset + 2;
      const dayName = DAY_NAMES[dIdx];
      const isToday = (dIdx === todayDayIndex);
      const todayClass = isToday ? ' is-today' : '';
      const headerContent = isToday
        ? `<span class="tt-today-indicator">●</span> ${dayName} <span class="tt-today-tag">(TODAY)</span>`
        : dayName;

      html += `
        <div class="tt-header-cell tt-day-header-cell${todayClass}" style="grid-column: ${col}; grid-row: 1;">
          ${headerContent}
        </div>
      `;
    });

    // Row 2, Col 1: Left Time Track Column
    html += `
      <div class="tt-time-track" style="grid-column: 1; grid-row: 2; height: ${totalHeight}px;">
    `;
    for (let h = minHour; h < maxHour; h++) {
      html += `
        <div class="tt-time-cell" style="height: ${HOUR_HEIGHT}px;">
          <span class="tt-time-text">${pad(h)}:00</span>
        </div>
      `;
    }
    html += `</div>`;

    // Row 2, Col 2..N: Day Columns
    activeDayIndices.forEach((dIdx, colOffset) => {
      const col = colOffset + 2;
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      html += `
        <div class="tt-day-column" style="grid-column: ${col}; grid-row: 2; height: ${totalHeight}px;">
      `;

      // Background hourly grid lines
      for (let i = 0; i < totalHours; i++) {
        html += `<div class="tt-grid-hour-line" style="height: ${HOUR_HEIGHT}px;"></div>`;
      }

      if (daySess.length === 0) {
        // Vertical watermark for days without teaching
        html += `<div class="tt-vertical-watermark">NO TEACHING SCHEDULED</div>`;
      } else {
        const packed = computeSessionColumns(daySess);

        packed.forEach(s => {
          const startOffset = (s.startHour - minHour) + (s.startMin / 60);
          const topPx = Math.round(startOffset * HOUR_HEIGHT) + 4;
          const heightPx = Math.max(52, Math.round(s.durHours * HOUR_HEIGHT) - 8);
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
          const subtitleText = esc(s.occ);
          const venueHtml = hasVenue
            ? `<span class="tt-venue" title="${esc(s.venue)}">${s.venueIcon || '📍'} ${esc(s.venue)}</span>`
            : `<span class="tt-venue tt-venue-empty" title="Click to add location"><span class="tt-venue-add-icon">📍</span> <span class="tt-venue-placeholder">+ Add Location</span></span>`;

          const startTimeVal = `${pad(s.startHour)}:${pad(s.startMin)}`;
          const endTimeVal = `${pad(s.endHour)}:${pad(s.endMin)}`;
          const rawStartTimeVal = `${pad(s.rawStartHour)}:${pad(s.rawStartMin)}`;
          const rawEndTimeVal = `${pad(s.rawEndHour)}:${pad(s.rawEndMin)}`;

          html += `
            <div class="tt-session-card${compactClass}"
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
                <span class="tt-code">${esc(s.courseCode)}</span>
                <span class="tt-type-tag">${esc(s.typeLabel)}</span>
              </div>
              <div class="tt-card-title" title="${esc(s.courseName)}">${esc(s.courseName)}</div>
              ${!isCompact ? `<div class="tt-card-subtitle">${subtitleText}</div>` : ''}
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

    gridEl.innerHTML = html;

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
    btn.innerHTML = `
      <svg class="icon-svg" viewBox="0 0 24 24" style="stroke:#10B981;width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg>
      <span style="color:#10B981;">Exported</span>
    `;
    btn.disabled = true;
    setTimeout(() => {
      btn.innerHTML = origContent;
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

      rows.push([
        `"${s.dayName}"`,
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

  function renderTimetableToCanvas() {
    const sessions = extractWeeklyTimetableSessions();
    const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const activeDayIndices = [1, 2, 3, 4, 5];
    if (sessions.some(s => s.dayIndex === 6)) activeDayIndices.push(6);
    if (sessions.some(s => s.dayIndex === 0)) activeDayIndices.push(0);

    const todayDayIndex = new Date().getDay();

    let minHour = 8;
    let maxHour = 18;
    sessions.forEach(s => {
      if (s.startHour < minHour) minHour = s.startHour;
      if (s.endHour > maxHour) maxHour = s.endHour;
      if (s.endMin > 0 && s.endHour >= maxHour) maxHour = s.endHour + 1;
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
    ctx.fillText('ACADEMIC TIMETABLE', titleLeftX, 114);

    // ── 3. Right-Aligned Tabular Metadata Pill (TERM: Year / SEM) ──
    let academicYear = '2024/2025';
    let semType = 'SEM I';
    if (typeof window.getUmAcademicInfo === 'function') {
      try {
        const um = window.getUmAcademicInfo(new Date());
        if (um && um.academicYear) academicYear = um.academicYear;
        if (um && um.semType) semType = um.semType;
      } catch (e) {}
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
    const dayColW = (gridW - timeColW) / totalDays;
    const hourH = (gridH - headerH) / totalHours;

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
    activeDayIndices.forEach((dIdx, colOffset) => {
      const colX = gridX + timeColW + colOffset * dayColW;
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

      if (isToday) {
        ctx.fillStyle = '#E4E4E7';
        ctx.fillRect(colX, gridY + 1, dayColW, headerH - 1);
        ctx.fillStyle = '#18181B';
        ctx.font = '800 20px "Hanken Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`● ${dayName} (TODAY)`, colX + dayColW / 2, gridY + 41);
      } else {
        ctx.fillStyle = '#18181B';
        ctx.font = '800 20px "Hanken Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(dayName, colX + dayColW / 2, gridY + 41);
      }
    });

    // Time Column Labels & Horizontal Grid Lines
    for (let h = minHour; h < maxHour; h++) {
      const rowY = gridY + headerH + (h - minHour) * hourH;

      ctx.beginPath();
      ctx.moveTo(gridX, rowY);
      ctx.lineTo(gridX + gridW, rowY);
      ctx.strokeStyle = '#E4E4E7';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#71717A';
      ctx.font = '700 18px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${pad(h)}:00`, gridX + timeColW / 2, rowY + 24);
    }
    ctx.textAlign = 'left';

    // Day Columns Content
    activeDayIndices.forEach((dIdx, colOffset) => {
      const colX = gridX + timeColW + colOffset * dayColW;
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      if (daySess.length === 0) {
        // Vertical watermark for empty days
        ctx.save();
        ctx.translate(colX + dayColW / 2, gridY + headerH + (gridH - headerH) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#A1A1AA';
        ctx.font = '700 18px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('NO TEACHING SCHEDULED', 0, 6);
        ctx.restore();
      } else {
        const packed = computeSessionColumns(daySess);

        packed.forEach(s => {
          const startOffset = (s.startHour - minHour) + (s.startMin / 60);
          const cardY = gridY + headerH + startOffset * hourH + 6;
          const cardH = Math.max(50, s.durHours * hourH - 12);

          let cardX = colX + 8;
          let cardW = dayColW - 16;
          if (s._totalCols > 1) {
            const singleW = (dayColW - 16) / s._totalCols;
            cardX = colX + 8 + s._colIndex * singleW;
            cardW = singleW - 6;
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
          ctx.fillStyle = '#18181B';
          ctx.font = '800 19px "JetBrains Mono", monospace';
          ctx.fillText(s.courseCode, cardX + 16, cardY + 26);

          const codeW = ctx.measureText(s.courseCode).width;
          const tagW = Math.max(46, ctx.measureText(s.typeLabel).width + 16);
          ctx.fillStyle = '#F4F4F5';
          ctx.fillRect(cardX + cardW - tagW - 14, cardY + 11, tagW, 20);
          ctx.strokeStyle = '#E4E4E7';
          ctx.strokeRect(cardX + cardW - tagW - 14, cardY + 11, tagW, 20);
          ctx.fillStyle = '#71717A';
          ctx.font = '700 13px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(s.typeLabel, cardX + cardW - 14 - tagW / 2, cardY + 25);
          ctx.textAlign = 'left';

          // Course Title
          ctx.fillStyle = '#18181B';
          ctx.font = '800 20px "Hanken Grotesk", sans-serif';
          let title = s.courseName;
          if (ctx.measureText(title).width > cardW - 28) {
            while (title.length > 4 && ctx.measureText(title + '…').width > cardW - 28) {
              title = title.slice(0, -1);
            }
            title += '…';
          }
          ctx.fillText(title, cardX + 16, cardY + 56);

          // Subtitle (if 2+ hours or cardH >= 120): ONLY show OCC, NO duplicate venue beside OCC!
          if (cardH >= 120) {
            ctx.fillStyle = '#71717A';
            ctx.font = '600 15px "JetBrains Mono", monospace';
            let sub = s.occ || '';
            if (ctx.measureText(sub).width > cardW - 28) {
              while (sub.length > 4 && ctx.measureText(sub + '…').width > cardW - 28) {
                sub = sub.slice(0, -1);
              }
              sub += '…';
            }
            ctx.fillText(sub, cardX + 16, cardY + 84);
          }

          // Footer (Venue left with pin, Time right)
          if (cardH >= 65) {
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
              ctx.fillText(displayVenue, cardX + 16, cardY + cardH - 14);
            }

            ctx.fillStyle = '#71717A';
            ctx.font = '600 15px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(s.timeStr, cardX + cardW - 14, cardY + cardH - 14);
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

  function buildPdfFromJpegBytes(jpegBytes, imgW, imgH, widthPt = 842, heightPt = 595) {
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

    const contentStream = `q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im1 Do\nQ\n`;
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
  window.renderTimetableToCanvas = renderTimetableToCanvas;
  window.exportTimetableCSV = exportTimetableCSV;
  window.exportTimetablePNG = exportTimetablePNG;
  window.exportTimetablePDF = exportTimetablePDF;
  window.initTimetableControls = initTimetableControls;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTimetableControls);
    } else {
      initTimetableControls();
    }
  }
})(typeof window !== 'undefined' ? window : this);
