// ==========================================================================
// ACADEMIC WEEKLY TIMETABLE MODE & EXPORT SYSTEM (Spec 5.0)
// - Reconstructs recurring weekly class schedule from attendance records
// - Pure day-of-week slots (Monday to Friday/Sunday), zero specific dates
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
          occStr = String(userOcc).trim();
          if (!occStr.toLowerCase().startsWith('occ')) occStr = `OCC ${occStr}`;
        } else {
          const occM = (sess.desc || '').match(/OCC[- ]*(\d+)/i);
          occStr = occM ? `OCC ${occM[1]}` : 'OCC 1';
        }

        let venue = (sess.desc || '').replace(/^(?:lecture|tutorial|lab|workshop)\s*[-–—:]?\s*/i, '').trim();
        if (!venue || venue.length < 2) {
          venue = /tut/i.test(typeLabel) ? 'Discussion Room / Lab' : (/lab/i.test(typeLabel) ? 'Computer Lab' : 'Main Lecture Hall');
        }
        const isOnline = /online|zoom|teams|google meet|meet|webex/i.test(venue);
        const venueIcon = isOnline ? '🌐' : '📍';
        const durHours = Math.max(0.5, (timeInfo.endHour + timeInfo.endMin / 60) - (timeInfo.startHour + timeInfo.startMin / 60));
        const durText = `${durHours.toFixed(durHours % 1 === 0 ? 0 : 1)}h`;
        const venueDisplay = `${venueIcon} ${venue} · ${durText}`;

        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${pad(timeInfo.startHour)}:${pad(timeInfo.startMin)} - ${pad(timeInfo.endHour)}:${pad(timeInfo.endMin)}`;

        const cleanCode = (courseCode || '').split('/')[0].trim();
        const key = `${dayIndex}_${timeInfo.startHour}_${timeInfo.startMin}_${timeInfo.endHour}_${timeInfo.endMin}_${cleanCode}_${typeLabel}`;

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
          venueDisplay
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

  function getEditorialGapLabel(startH, endH) {
    if (startH < 11) return (endH - startH >= 4) ? 'RESEARCH & MORNING WORKSTATION PREP' : 'STUDY CYCLE';
    if (startH >= 12 && endH <= 16) return 'RECESSED';
    if (startH >= 14) return (endH - startH >= 3) ? 'AFTERNOON STUDY CYCLE' : 'OPEN';
    return 'ACADEMIC STUDY PERIOD';
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

    let minHour = 8;
    let maxHour = 18;
    sessions.forEach(s => {
      if (s.startHour < minHour) minHour = s.startHour;
      if (s.endHour > maxHour) maxHour = s.endHour;
    });
    const totalCols = maxHour - minHour;
    const pad = n => String(n).padStart(2, '0');

    gridEl.style.gridTemplateColumns = `140px repeat(${totalCols}, minmax(115px, 1fr))`;

    let html = '';

    // Top-Left Corner Header Cell
    html += `
      <div class="tt-header-cell tt-corner-cell" style="grid-column: 1; grid-row: 1;">
        <div style="font-size: 10px; font-weight: 800; letter-spacing: 0.8px; color: var(--text-primary);">ACADEMIC WK</div>
        <div style="font-size: 9.5px; font-weight: 600; color: var(--text-muted); margin-top: 2px;">TIME (MYT)</div>
      </div>
    `;

    // Time Columns Header
    for (let h = minHour; h < maxHour; h++) {
      const colIdx = (h - minHour) + 2;
      html += `
        <div class="tt-header-cell tt-time-col-header" style="grid-column: ${colIdx}; grid-row: 1;">
          <span class="tt-time-top">${pad(h)}:00</span>
          <span class="tt-time-bot">${pad(h + 1)}:00</span>
        </div>
      `;
    }

    // Day Rows
    activeDayIndices.forEach((dIdx, dayRowOffset) => {
      const rowNum = dayRowOffset + 2;
      const dayName = DAY_NAMES[dIdx];
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      // Day Label Cell (Col 1) - Pure Day of Week, no calendar dates
      html += `
        <div class="tt-day-label-cell" style="grid-column: 1; grid-row: ${rowNum};">
          <div class="tt-day-name">${dayName}</div>
        </div>
      `;

      if (daySess.length === 0) {
        html += `
          <div class="tt-empty-day-banner" style="grid-column: 2 / ${totalCols + 2}; grid-row: ${rowNum};">
            <span>🗓 NO SCHEDULED CONTACT SESSIONS · INDEPENDENT ACADEMIC STUDY</span>
          </div>
        `;
      } else {
        const occupied = new Array(totalCols).fill(false);

        daySess.forEach(s => {
          const startCol = Math.max(2, (s.startHour - minHour) + 2);
          const endCol = Math.min(totalCols + 2, Math.max(startCol + 1, (s.endHour - minHour) + (s.endMin > 0 ? 1 : 0) + 2));

          const startIdx = Math.max(0, s.startHour - minHour);
          const endIdx = Math.min(totalCols, (s.endHour - minHour) + (s.endMin > 0 ? 1 : 0));
          for (let i = startIdx; i < endIdx; i++) occupied[i] = true;

          html += `
            <div class="tt-session-card" style="grid-column: ${startCol} / ${endCol}; grid-row: ${rowNum};">
              <div class="tt-card-header">
                <div class="tt-card-code-badge">
                  <span class="tt-code">${esc(s.courseCode)}</span>
                  <span class="tt-type-tag">${esc(s.typeLabel)}</span>
                </div>
                <span class="tt-time-range">${esc(s.timeStr)}</span>
              </div>
              <div class="tt-card-occ">${esc(s.occ)}</div>
              <div class="tt-card-title" title="${esc(s.courseName)}">${esc(s.courseName)}</div>
              <div class="tt-card-footer">
                <span class="tt-venue" title="${esc(s.venueDisplay)}">${esc(s.venueDisplay)}</span>
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

    gridEl.innerHTML = html;
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

    let minHour = 8;
    let maxHour = 18;
    sessions.forEach(s => {
      if (s.startHour < minHour) minHour = s.startHour;
      if (s.endHour > maxHour) maxHour = s.endHour;
    });
    const totalCols = maxHour - minHour;
    const totalDays = activeDayIndices.length;

    const width = 2400;
    const height = 1400;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fill Canvas White Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Header Kicker
    ctx.fillStyle = '#71717A';
    ctx.font = '700 20px "JetBrains Mono", monospace';
    ctx.fillText('ACADEMIC SCHEDULE · SEMESTER MASTER VIEW', 60, 68);

    // Title
    ctx.fillStyle = '#18181B';
    ctx.font = '800 38px "Hanken Grotesk", -apple-system, sans-serif';
    ctx.fillText('WEEKLY ACADEMIC TIMETABLE', 60, 114);

    // Subtitle
    ctx.fillStyle = '#71717A';
    ctx.font = '600 20px "Hanken Grotesk", -apple-system, sans-serif';
    ctx.fillText('Constructed from Course Attendance Sessions · Days of Week (MYT / UTC+8)', 60, 144);

    // Grid Dimensions
    const gridX = 60;
    const gridY = 175;
    const gridW = width - 120; // 2280px
    const gridH = height - 235; // 1165px
    const headerH = 75;
    const cornerW = 210;
    const colW = (gridW - cornerW) / totalCols;
    const rowH = (gridH - headerH) / totalDays;

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
    ctx.lineWidth = 2;
    ctx.stroke();

    // Corner Header Cell
    ctx.fillStyle = '#18181B';
    ctx.font = '800 16px "JetBrains Mono", monospace';
    ctx.fillText('ACADEMIC WK', gridX + 22, gridY + 34);
    ctx.fillStyle = '#71717A';
    ctx.font = '600 15px "JetBrains Mono", monospace';
    ctx.fillText('TIME (MYT)', gridX + 22, gridY + 56);

    ctx.beginPath();
    ctx.moveTo(gridX + cornerW, gridY);
    ctx.lineTo(gridX + cornerW, gridY + gridH);
    ctx.strokeStyle = '#D4D4D8';
    ctx.lineWidth = 2;
    ctx.stroke();

    const pad = n => String(n).padStart(2, '0');

    // Time Slot Columns
    for (let c = 0; c < totalCols; c++) {
      const h = minHour + c;
      const colX = gridX + cornerW + c * colW;

      ctx.beginPath();
      ctx.moveTo(colX, gridY);
      ctx.lineTo(colX, gridY + gridH);
      ctx.strokeStyle = '#E4E4E7';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#18181B';
      ctx.font = '800 20px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${pad(h)}:00`, colX + colW / 2, gridY + 34);

      ctx.fillStyle = '#71717A';
      ctx.font = '600 16px "JetBrains Mono", monospace';
      ctx.fillText(`${pad(h + 1)}:00`, colX + colW / 2, gridY + 56);
    }
    ctx.textAlign = 'left';

    // Day Rows
    activeDayIndices.forEach((dIdx, rowIdx) => {
      const y = gridY + headerH + rowIdx * rowH;
      const dayName = DAY_NAMES[dIdx];
      const daySess = sessions.filter(s => s.dayIndex === dIdx);

      // Horizontal Row Divider
      ctx.beginPath();
      ctx.moveTo(gridX, y);
      ctx.lineTo(gridX + gridW, y);
      ctx.strokeStyle = '#E4E4E7';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Day Label Cell (Pure Day of Week, no calendar dates)
      ctx.fillStyle = '#18181B';
      ctx.font = '800 24px "Hanken Grotesk", sans-serif';
      ctx.fillText(dayName, gridX + 22, y + rowH / 2 + 8);

      if (daySess.length === 0) {
        // Empty Day Banner
        ctx.fillStyle = '#FAFAFB';
        ctx.fillRect(gridX + cornerW + 2, y + 2, gridW - cornerW - 4, rowH - 4);
        ctx.fillStyle = '#A1A1AA';
        ctx.font = '700 18px "JetBrains Mono", monospace';
        ctx.fillText('🗓 NO SCHEDULED CONTACT SESSIONS · INDEPENDENT ACADEMIC STUDY', gridX + cornerW + 36, y + rowH / 2 + 6);
      } else {
        const occupied = new Array(totalCols).fill(false);

        daySess.forEach(s => {
          const startIdx = Math.max(0, s.startHour - minHour);
          const endIdx = Math.min(totalCols, (s.endHour - minHour) + (s.endMin > 0 ? 1 : 0));
          for (let i = startIdx; i < endIdx; i++) occupied[i] = true;

          const cardX = gridX + cornerW + startIdx * colW + 8;
          const cardY = y + 10;
          const cardW = Math.max(80, (endIdx - startIdx) * colW - 16);
          const cardH = rowH - 20;

          // Card Background & Border
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(cardX, cardY, cardW, cardH);
          ctx.strokeStyle = '#E4E4E7';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(cardX, cardY, cardW, cardH);

          // Left Black Accent Stripe (Visual anchor from reference design)
          ctx.fillStyle = '#18181B';
          ctx.fillRect(cardX, cardY, 6.5, cardH);

          // Card Header: Code + Type + Time
          ctx.fillStyle = '#18181B';
          ctx.font = '800 18px "JetBrains Mono", monospace';
          ctx.fillText(s.courseCode, cardX + 18, cardY + 28);

          ctx.fillStyle = '#71717A';
          ctx.font = '700 15px "JetBrains Mono", monospace';
          ctx.fillText(s.typeLabel, cardX + 18 + ctx.measureText(s.courseCode).width + 8, cardY + 28);

          ctx.fillStyle = '#71717A';
          ctx.font = '600 16px "JetBrains Mono", monospace';
          const timeText = s.timeStr;
          const timeWidth = ctx.measureText(timeText).width;
          if (cardW > timeWidth + 140) {
            ctx.fillText(timeText, cardX + cardW - timeWidth - 12, cardY + 28);
          }

          // OCC Badge
          ctx.fillStyle = '#71717A';
          ctx.font = '700 15px "JetBrains Mono", monospace';
          ctx.fillText(s.occ, cardX + 18, cardY + 54);

          // Course Title
          ctx.fillStyle = '#18181B';
          ctx.font = '800 20px "Hanken Grotesk", sans-serif';
          let title = s.courseName;
          if (ctx.measureText(title).width > cardW - 32) {
            while (title.length > 4 && ctx.measureText(title + '…').width > cardW - 32) {
              title = title.slice(0, -1);
            }
            title += '…';
          }
          ctx.fillText(title, cardX + 18, cardY + 84);

          // Venue & Duration Footer
          ctx.fillStyle = '#71717A';
          ctx.font = '500 15px "Hanken Grotesk", sans-serif';
          let venueText = s.venueDisplay;
          if (ctx.measureText(venueText).width > cardW - 32) {
            venueText = `${s.venue} · ${s.durText}`;
          }
          ctx.fillText(venueText, cardX + 18, cardY + cardH - 16);
        });

        // Fill Gaps
        let gapStart = null;
        for (let i = 0; i <= totalCols; i++) {
          if (i < totalCols && !occupied[i]) {
            if (gapStart === null) gapStart = i;
          } else {
            if (gapStart !== null) {
              const gapX = gridX + cornerW + gapStart * colW + 4;
              const gapW = (i - gapStart) * colW - 8;
              const gapY = y + 8;
              const gapH = rowH - 16;
              const label = getEditorialGapLabel(gapStart + minHour, i + minHour);

              ctx.fillStyle = '#FAFAFB';
              ctx.fillRect(gapX, gapY, gapW, gapH);
              ctx.fillStyle = '#A1A1AA';
              ctx.font = '700 15px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              ctx.fillText(label, gapX + gapW / 2, gapY + gapH / 2 + 5);
              ctx.textAlign = 'left';

              gapStart = null;
            }
          }
        }
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
  window.renderTimetableMode = renderTimetableMode;
  window.exportTimetableCSV = exportTimetableCSV;
  window.exportTimetablePNG = exportTimetablePNG;
  window.exportTimetablePDF = exportTimetablePDF;
  window.initTimetableControls = initTimetableControls;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTimetableControls);
  } else {
    initTimetableControls();
  }
})(typeof window !== 'undefined' ? window : this);

