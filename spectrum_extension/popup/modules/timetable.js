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

  let customLocations = {};
  let customLocationsLoaded = false;

  async function loadCustomLocations() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const res = await chrome.storage.local.get(['timetableLocations']);
        if (res && res.timetableLocations && typeof res.timetableLocations === 'object') {
          customLocations = res.timetableLocations;
        }
      }
    } catch (e) {
      console.warn('Failed to load custom locations:', e);
    }
    customLocationsLoaded = true;
    return customLocations;
  }

  async function saveCustomLocation(key, location) {
    if (!key) return;
    const cleanLoc = (location || '').trim();
    if (cleanLoc) {
      customLocations[key] = cleanLoc;
    } else {
      delete customLocations[key];
    }
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ timetableLocations: customLocations });
      }
    } catch (e) {
      console.warn('Failed to save custom location:', e);
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
        const rawTimeStr = sess.time || sess.dateStr || sess.desc || '';
        const timeInfo = parseTime ? parseTime(rawTimeStr) : null;
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
        const timeStr = `${pad(timeInfo.startHour)}:${pad(timeInfo.startMin)} - ${pad(timeInfo.endHour)}:${pad(timeInfo.endMin)}`;

        const cleanCode = (courseCode || '').split('/')[0].trim();
        const key = `${dayIndex}_${timeInfo.startHour}_${timeInfo.startMin}_${timeInfo.endHour}_${timeInfo.endMin}_${cleanCode}_${typeLabel}`;

        // Check custom user-defined location first
        const customLoc = (customLocations && (customLocations[key] || customLocations[`${cleanCode}_${dayIndex}_${timeInfo.startHour}`] || customLocations[`${cleanCode}_${typeLabel}`])) || '';

        let venue = customLoc || '';
        if (!venue) {
          const rawDesc = (sess.desc || '').replace(/^(?:lecture|tutorial|lab|workshop)\s*[-–—:]?\s*/i, '').trim();
          // Filter out dummy/placeholder session descriptions from Spectrum Moodle
          const isDummyDesc = !rawDesc ||
            /^(?:regular\s+class(?:\s+session)?|sesi\s+kelas\s+biasa|class\s+session|sesi\s+kelas|none|null|tba|tbd)$/i.test(rawDesc) ||
            /^occ[- ]*\d+$/i.test(rawDesc) ||
            /^(?:all\s+groups?|kumpulan\s+semua)$/i.test(rawDesc);
          if (!isDummyDesc && rawDesc.length >= 2) {
            venue = rawDesc;
          }
        }

        const isOnline = /online|zoom|teams|google meet|meet|webex/i.test(venue);
        const venueIcon = isOnline ? '🌐' : '📍';
        const durHours = Math.max(0.5, (timeInfo.endHour + timeInfo.endMin / 60) - (timeInfo.startHour + timeInfo.startMin / 60));
        const durText = `${durHours.toFixed(durHours % 1 === 0 ? 0 : 1)}h`;
        const venueDisplay = venue ? `${venueIcon} ${venue} · ${durText}` : durText;

        rawSlots.push({
          key,
          dayIndex,
          dayName,
          courseCode,
          courseName,
          typeLabel,
          occ: occStr,
          timeStr,
          startHour: timeInfo.startHour,
          startMin: timeInfo.startMin,
          endHour: timeInfo.endHour,
          endMin: timeInfo.endMin,
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

    const totalHours = maxHour - minHour;
    const HOUR_HEIGHT = 80;
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
          const subtitleText = hasVenue ? `${esc(s.occ)} · ${esc(s.venue)}` : esc(s.occ);
          const venueHtml = hasVenue
            ? `<span class="tt-venue" title="${esc(s.venue)}">${s.venueIcon || '📍'} ${esc(s.venue)}</span>`
            : `<span class="tt-venue tt-venue-empty" title="Click to add location"><span class="tt-venue-add-icon">📍</span> <span class="tt-venue-placeholder">+ Add Location</span></span>`;

          html += `
            <div class="tt-session-card${compactClass}"
                 data-session-key="${esc(s.key)}"
                 data-course-code="${esc(s.courseCode)}"
                 data-course-name="${esc(s.courseName)}"
                 data-time-str="${esc(s.dayName)} ${esc(s.timeStr)} · ${esc(s.occ)}"
                 data-venue="${esc(s.venue || '')}"
                 title="Click to set or edit location"
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
        const key = card.dataset.sessionKey;
        const courseCode = card.dataset.courseCode;
        const courseName = card.dataset.courseName;
        const timeStr = card.dataset.timeStr;
        const currentVenue = card.dataset.venue || '';
        openLocationModal({ key, courseCode, courseName, timeStr, currentVenue });
      });
    }
  }

  let activeSessionForLocation = null;

  function openLocationModal(sessInfo) {
    activeSessionForLocation = sessInfo;
    const modal = document.getElementById('tt-location-modal');
    if (!modal) return;

    const codeEl = document.getElementById('tt-location-course-code');
    const nameEl = document.getElementById('tt-location-course-name');
    const timeEl = document.getElementById('tt-location-session-time');
    const inp = document.getElementById('tt-location-input');
    const btnDel = document.getElementById('btn-delete-tt-location');

    if (codeEl) codeEl.textContent = sessInfo.courseCode || 'Course';
    if (nameEl) nameEl.textContent = sessInfo.courseName ? ` · ${sessInfo.courseName}` : '';
    if (timeEl) timeEl.textContent = sessInfo.timeStr || '';
    if (inp) {
      inp.value = sessInfo.currentVenue || '';
    }
    if (btnDel) {
      btnDel.style.display = sessInfo.currentVenue ? 'inline-block' : 'none';
    }

    modal.style.display = 'flex';
    setTimeout(() => {
      if (inp) {
        inp.focus();
        inp.select();
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

    // Header Kicker
    ctx.fillStyle = '#71717A';
    ctx.font = '700 19px "JetBrains Mono", monospace';
    ctx.fillText('ACADEMIC SCHEDULE · SEMESTER MASTER VIEW', 60, 68);

    // Title
    ctx.fillStyle = '#18181B';
    ctx.font = '800 38px "Hanken Grotesk", -apple-system, sans-serif';
    ctx.fillText('WEEKLY ACADEMIC TIMETABLE', 60, 114);

    // Subtitle
    ctx.fillStyle = '#71717A';
    ctx.font = '600 20px "Hanken Grotesk", -apple-system, sans-serif';
    ctx.fillText('Constructed from Course Attendance Sessions · Days of Week (MYT / UTC+8)', 60, 144);

    // Grid Coordinates
    const gridX = 60;
    const gridY = 175;
    const gridW = width - 120; // 2080px
    const gridH = height - 235; // 1215px
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

          // Subtitle (if 2+ hours or cardH >= 95)
          if (cardH >= 95) {
            ctx.fillStyle = '#71717A';
            ctx.font = '600 15px "JetBrains Mono", monospace';
            let sub = s.venue ? `${s.occ} · ${s.venue}` : s.occ;
            if (ctx.measureText(sub).width > cardW - 28) {
              while (sub.length > 4 && ctx.measureText(sub + '…').width > cardW - 28) {
                sub = sub.slice(0, -1);
              }
              sub += '…';
            }
            ctx.fillText(sub, cardX + 16, cardY + 84);
          }

          // Footer (Venue left, Time right)
          if (cardH >= 70) {
            if (s.venue) {
              ctx.fillStyle = '#71717A';
              ctx.font = '600 14px "JetBrains Mono", monospace';
              let vText = `${s.venue}`;
              ctx.fillText(vText, cardX + 16, cardY + cardH - 12);
            }

            ctx.fillStyle = '#71717A';
            ctx.font = '600 14px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            ctx.fillText(s.timeStr, cardX + cardW - 14, cardY + cardH - 12);
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

    if (modal && !modal._hasLocationListeners) {
      modal._hasLocationListeners = true;

      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeLocationModal();
      });

      if (btnClose) btnClose.addEventListener('click', closeLocationModal);
      if (btnCancel) btnCancel.addEventListener('click', closeLocationModal);

      if (btnSave) {
        btnSave.addEventListener('click', async () => {
          if (!activeSessionForLocation) return;
          const locVal = inp ? inp.value.trim() : '';
          await saveCustomLocation(activeSessionForLocation.key, locVal);
          closeLocationModal();
          renderTimetableMode();
        });
      }

      if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
          if (!activeSessionForLocation) return;
          await saveCustomLocation(activeSessionForLocation.key, '');
          closeLocationModal();
          renderTimetableMode();
        });
      }

      if (inp) {
        inp.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!activeSessionForLocation) return;
            await saveCustomLocation(activeSessionForLocation.key, inp.value.trim());
            closeLocationModal();
            renderTimetableMode();
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
