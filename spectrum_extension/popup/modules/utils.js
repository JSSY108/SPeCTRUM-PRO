// ==========================================================================
// SPeCTRUM Pro Universal Utilities & Formatters (Spec 5.1)
// - CSP safe HTML cleaners, diagnostics logger, academic date calculators
// - Monogram & acronym generators, time range parsers, string cleaners
// ==========================================================================

(function(window) {
  'use strict';

  // Security & CSP Sanitizer: Strips scripts, inline event handlers, and javascript: navigations
  function cleanHtmlForParser(rawHtml) {
    if (!rawHtml || typeof rawHtml !== 'string') return '';
    return rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
      .replace(/\bhref\s*=\s*['"]javascript:[^'"]*['"]/gi, 'href="#"')
      .replace(/\bsrc\s*=\s*['"]javascript:[^'"]*['"]/gi, 'src=""');
  }

  if (typeof DOMParser !== 'undefined' && DOMParser.prototype && DOMParser.prototype.parseFromString) {
    const originalParseFromString = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function(str, type) {
      if (type === 'text/html' && typeof str === 'string') {
        str = cleanHtmlForParser(str);
      }
      return originalParseFromString.call(this, str, type);
    };
  }

  const diagLogs = [];
  function logDiag(category, msg, data = null) {
    const d = new Date();
    const ts = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
    let line = `[${ts}] [${category}] ${msg}`;
    if (data !== null) {
      if (typeof data === 'object') {
        try { line += ' ' + JSON.stringify(data); } catch (e) { line += ' [Object]'; }
      } else {
        line += ' ' + String(data);
      }
    }
    diagLogs.push(line);
    if (diagLogs.length > 500) diagLogs.shift();
    console.log(`[SPeCTRUM Pro] ${line}`);
    const viewEl = document.getElementById('diag-log-view');
    if (viewEl) {
      viewEl.textContent = diagLogs.join('\n');
      viewEl.scrollTop = viewEl.scrollHeight;
    }
  }

  function formatDateKey(d) {
    if (!d) return '';
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDateKeyToShort(key) {
    if (!key) return '';
    const parts = key.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0])) return key;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function extractOccs(text) {
    if (!text) return [];
    const set = new Set();
    const str = String(text);

    const rangeRe = /\b(?:occ|group|grp|kumpulan|kump|section|seksyen)[:\s]*0*([1-9]\d*)\s*[-–to]+\s*0*([1-9]\d*)\b/gi;
    let rm;
    while ((rm = rangeRe.exec(str)) !== null) {
      const start = parseInt(rm[1], 10);
      const end = parseInt(rm[2], 10);
      if (start <= end && (end - start) < 30) {
        for (let i = start; i <= end; i++) {
          set.add(i);
        }
      }
    }

    const singleRe = /\b(?:occ|group|grp|kumpulan|kump|section|seksyen)[:\s]*0*([1-9]\d*)\b/gi;
    let sm;
    while ((sm = singleRe.exec(str)) !== null) {
      set.add(parseInt(sm[1], 10));
    }

    return Array.from(set);
  }

  function formatOccTag(rawOcc) {
    if (!rawOcc) return '';
    const str = String(rawOcc).trim();
    const numMatch = str.match(/\d+/);
    if (numMatch) {
      return `OCC ${parseInt(numMatch[0], 10)}`;
    }
    const clean = str.replace(/^occ\s*[-–—:]?\s*/i, '').trim();
    return clean ? `OCC ${clean}` : str.toUpperCase();
  }

  function cleanOccNumber(rawOcc) {
    if (!rawOcc) return '';
    const str = String(rawOcc).trim();
    const numMatch = str.match(/\d+/);
    if (numMatch) {
      return String(parseInt(numMatch[0], 10));
    }
    return str.replace(/^occ\s*[-–—:]?\s*/i, '').trim();
  }

  // Extract ONLY time (e.g. "2PM - 4PM", "14:00 - 16:00", "2:00PM - 4:00PM") and remove redundant Day, Date, Month, Year
  function extractOnlyTime(s) {
    if (!s) return '';
    const str = String(s).trim();

    // 1. Time range with AM/PM (e.g. "2PM - 4PM", "2:00PM - 4:00PM", "8.00AM - 10.00AM") or Malay indicators
    const rangeMatch = str.match(/\b(\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM|pagi|petang|ptg|malam|mlm|tgh)?\s*(?:[-–—~]|to|hingga)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM|pagi|petang|ptg|malam|mlm|tgh))\b/i);
    if (rangeMatch) return rangeMatch[1].trim();

    // 2. 24-hour time range (e.g. "14:00 - 16:00", "08:30 - 10:30")
    const range24 = str.match(/\b(\d{1,2}:\d{2}\s*(?:[-–—~]|to|hingga)\s*\d{1,2}:\d{2})\b/);
    if (range24) return range24[1].trim();

    // 3. Single time with AM/PM or Malay
    const singleMatch = str.match(/\b(\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM|pagi|petang|ptg|malam|mlm|tgh))\b/i);
    if (singleMatch) return singleMatch[1].trim();

    // 4. Single 24-hr time (e.g. "14:00")
    const single24 = str.match(/\b(\d{1,2}:\d{2})\b/);
    if (single24) return single24[1].trim();

    // 5. Fallback: strip leading day of week, day number, month, year
    const stripped = str.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Isnin|Selasa|Rabu|Khamis|Jumaat|Sabtu|Ahad)[a-z]*,?\s*/i, '')
                        .replace(/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\s*/i, '')
                        .replace(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*/, '')
                        .replace(/^[@,\-–—\s]+/, '')
                        .trim();
    return stripped || str;
  }

  function cleanSectionTitle(text) {
    if (!text || typeof text !== 'string') return 'General';

    const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    const cleanLines = lines.filter(l => {
      const low = l.toLowerCase();
      if (low.startsWith('select section') || low.startsWith('pilih seksyen')) return false;
      if (low === 'collapse' || low === 'expand' || low === 'toggle section' || 
          low === 'collapse all' || low === 'expand all' || low === 'toggle' ||
          low === 'runtuhkan' || low === 'kembangkan' || low === 'buka' || low === 'tutup') return false;
      return true;
    });

    let result = cleanLines.join(' ').trim();
    if (!result && lines.length > 0) {
      result = lines[0]
        .replace(/^\s*(select\s+section|pilih\s+seksyen)\s+/i, '')
        .replace(/\b(collapse|expand|toggle\s+section|collapse\s+all|expand\s+all|runtuhkan|kembangkan|buka|tutup)\b/gi, '')
        .trim();
    }

    return result || 'General';
  }

  function cleanSingleCourseCode(code) {
    if (!code || typeof code !== 'string') return '';
    const trimmed = code.trim();
    const match = trimmed.match(/\b[A-Z]{2,4}\d{4}\b/i);
    if (match) return match[0].toUpperCase();
    const firstPart = trimmed.split(/[\/\\\u2013\u2014\-]/)[0].trim();
    return firstPart || trimmed;
  }
  function cleanDisplayCourseName(courseName, courseCode) {
    if (!courseName) return '';
    let name = String(courseName).replace(/[\r\n\t]+/g, ' ').trim();
    if (courseCode) {
      const codeTrimmed = String(courseCode).trim();
      if (codeTrimmed) {
        const escapedCode = codeTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const codeRegex = new RegExp('^\\s*(?:\\[?\\s*' + escapedCode + '\\s*\\]?|[\\(\\[]?\\s*' + escapedCode + '\\s*[\\)\\]]?)\\s*[-:·/|—–_~]*\\s*', 'i');
        name = name.replace(codeRegex, '').trim();
        const parts = codeTrimmed.split(/[\/\\\u2013\u2014\-]/).map(p => p.trim()).filter(Boolean);
        for (const p of parts) {
          const escP = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const partRegex = new RegExp('^\\s*(?:\\[?\\s*' + escP + '\\s*\\]?|[\\(\\[]?\\s*' + escP + '\\s*[\\)\\]]?)\\s*[-:·/|—–_~]*\\s*', 'i');
          name = name.replace(partRegex, '').trim();
        }
      }
    }

    let prev;
    do {
      prev = name;
      name = name.replace(/^\s*(?:\[\s*|\(\s*)?[-:·/|—–_~\s]*(?:[A-Z]{2,4}\d{4}[A-Z]?)(?:\s*[-:·/|—–_~\s]+(?:[A-Z]{2,4}\d{4}[A-Z]?))*(?:\s*\]|\s*\))?\s*[-:·/|—–_~\s]*/i, '').trim();
      name = name.replace(/^[-:·/|—–_~\s]+/, '').trim();
    } while (name !== prev && name.length > 0);

    return name || courseName;
  }

  function generateCourseAcronym(name, code) {
    if (!name && !code) return 'CO';
    let clean = (name || '').replace(/^[A-Z]{2,4}\d{4}(?:\/[A-Z]{2,4}\d{4})?\s*[-–:]*\s*/i, '').trim();
    if (!clean) clean = code || '';
    const cleanLower = clean.toLowerCase();
    if (cleanLower.includes('database')) return 'DB';
    if (cleanLower.includes('systems analysis') || cleanLower.includes('sad')) return 'SAD';
    if (cleanLower.includes('mobile')) return 'MAD';
    if (cleanLower.includes('machine learning')) return 'ML';
    if (cleanLower.includes('project management') || cleanLower.includes('project mgmt')) return 'PM';
    if (cleanLower.includes('thinking skills') || cleanLower.includes('thinking and communication') || cleanLower.includes('thinking')) return 'TS';
    if (cleanLower.includes('probability') && cleanLower.includes('statistic')) return 'PS';
    if (cleanLower.includes('software engineering')) return 'SE';
    if (cleanLower.includes('web application') || cleanLower.includes('web dev')) return 'WAD';
    if (cleanLower.includes('data structure')) return 'DS';
    if (cleanLower.includes('artificial intelligence') || cleanLower.includes('ai')) return 'AI';
    if (cleanLower.includes('operating system')) return 'OS';
    if (cleanLower.includes('computer network') || cleanLower.includes('networking')) return 'CN';
    if (cleanLower.includes('computer architecture')) return 'CA';
    if (cleanLower.includes('information security') || cleanLower.includes('cyber')) return 'IS';
    if (cleanLower.includes('programming') || cleanLower.includes('problem solving')) return 'PS';

    const stopWords = new Set(['and', 'or', 'the', 'of', 'to', 'in', 'for', 'with', 'dan', 'pada', 'untuk', '&', '-']);
    const words = clean.split(/[\s\-_/]+/).filter(w => w.length > 0 && !stopWords.has(w.toLowerCase()));

    if (words.length >= 2) {
      return words.slice(0, 3).map(w => w[0].toUpperCase()).join('');
    } else if (words.length === 1) {
      const w = words[0];
      if (w.length >= 2) return w.slice(0, 2).toUpperCase();
      return w.toUpperCase();
    }
    return (code || 'CO').slice(0, 2).toUpperCase();
  }

  function getCourseCategoryTag(code = '', title = '') {
    const c = (code + ' ' + title).toUpperCase();
    if (c.includes('PROBABILITY') || c.includes('STATISTICS') || c.includes('CALCULUS') || c.includes('MATHEMATIC') || c.includes('DISCRETE')) return 'MATH';
    if (c.includes('MOBILE') || c.includes('APPLICATION') || c.includes('APP')) return 'APP';
    if (c.includes('SYSTEMS ANALYSIS') || c.includes('SOFTWARE') || c.includes('REQUIREMENT') || c.includes('TESTING') || c.includes('DESIGN')) return 'SE';
    if (c.includes('DATABASE') || c.includes('DATA MODEL') || c.includes('SQL')) return 'COMP';
    if (c.includes('INTELLIGENCE') || c.includes('MACHINE LEARNING') || c.includes('NEURAL') || c.includes('NLP')) return 'AI';
    if (c.includes('NETWORK') || c.includes('SECURITY') || c.includes('OPERATING')) return 'SYS';
    if (c.includes('DATA SCIENCE') || c.includes('BIG DATA') || c.includes('ANALYTICS')) return 'DATA';
    if (code.toUpperCase().includes('WIC')) return 'AI';
    if (code.toUpperCase().includes('WIB')) return 'SE';
    if (code.toUpperCase().includes('WID')) return 'DATA';
    if (code.toUpperCase().includes('WIA')) return 'COMP';
    return 'CORE';
  }

  function parseTimeRangeRobust(str) {
    if (!str) return null;
    const s = String(str).trim();

    const rangeMatch = s.match(/(?:^|[^\d])(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
    if (rangeMatch) {
      let sh = parseInt(rangeMatch[1], 10);
      let sm = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
      let sMeridiem = rangeMatch[3] ? rangeMatch[3].toLowerCase() : null;

      let eh = parseInt(rangeMatch[4], 10);
      let em = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
      let eMeridiem = rangeMatch[6] ? rangeMatch[6].toLowerCase() : null;

      if (!sMeridiem && eMeridiem) {
        if (eMeridiem === 'pm') {
          if (sh < 12 && eh <= 12) {
            if (sh < 8 || sh <= eh - 5) sMeridiem = 'am';
            else sMeridiem = 'pm';
          }
        } else if (eMeridiem === 'am') {
          sMeridiem = 'am';
        }
      }

      if (sMeridiem === 'pm' && sh < 12) sh += 12;
      if (sMeridiem === 'am' && sh === 12) sh = 0;

      if (eMeridiem === 'pm' && eh < 12) eh += 12;
      if (eMeridiem === 'am' && eh === 12) eh = 0;

      if (!sMeridiem && !eMeridiem) {
        if (sh >= 1 && sh <= 6) sh += 12;
        if (eh >= 1 && eh <= 6) eh += 12;
      }

      if (sh < 7) sh += 12;
      if (eh < 7) eh += 12;

      const pad = n => String(n).padStart(2, '0');
      return {
        startHour: sh,
        startMin: sm,
        endHour: eh,
        endMin: em,
        formatted: `${pad(sh)}:${pad(sm)} — ${pad(eh)}:${pad(em)}`
      };
    }

    const singleMatch = s.match(/(?:^|[^\d])(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
    if (singleMatch) {
      let h = parseInt(singleMatch[1], 10);
      let m = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
      let meridiem = singleMatch[3] ? singleMatch[3].toLowerCase() : null;

      if (meridiem === 'pm' && h < 12) h += 12;
      if (meridiem === 'am' && h === 12) h = 0;

      if (!meridiem && h >= 1 && h <= 6) h += 12;
      if (h < 7) h += 12;

      const pad = n => String(n).padStart(2, '0');
      const eh = (h + 2) % 24;
      return {
        startHour: h,
        startMin: m,
        endHour: eh,
        endMin: m,
        formatted: `${pad(h)}:${pad(m)} — ${pad(eh)}:${pad(m)}`
      };
    }

    return null;
  }

  function getAcademicMonday(year, monthIndex, position) {
    if (position === 'last') {
      const lastDay = new Date(year, monthIndex + 1, 0);
      const dayOfWeek = lastDay.getDay();
      const diff = (dayOfWeek >= 1) ? (dayOfWeek - 1) : 6;
      lastDay.setDate(lastDay.getDate() - diff);
      return lastDay;
    } else {
      const firstDay = new Date(year, monthIndex, 1);
      const dayOfWeek = firstDay.getDay();
      const diff = (dayOfWeek === 0) ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
      firstDay.setDate(firstDay.getDate() + diff);
      return firstDay;
    }
  }

  function getUmAcademicInfo(date = new Date()) {
    const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;

    let semType = 'SEM I';
    let acYearStart = year;
    let acYearEnd = year + 1;
    let startDate = null;

    if (month >= 9 && month <= 12) {
      semType = 'SEM I';
      acYearStart = year;
      acYearEnd = year + 1;
      startDate = getAcademicMonday(acYearStart, 8, 'last');
    } else if (month >= 1 && month <= 3) {
      semType = 'SEM I';
      acYearStart = year - 1;
      acYearEnd = year;
      startDate = getAcademicMonday(acYearStart, 8, 'last');
    } else if (month >= 4 && month <= 7) {
      semType = 'SEM II';
      acYearStart = year - 1;
      acYearEnd = year;
      startDate = getAcademicMonday(acYearEnd, 3, 'first');
    } else {
      semType = 'SPECIAL SEM';
      acYearStart = year - 1;
      acYearEnd = year;
      startDate = getAcademicMonday(acYearEnd, 7, 'first');
    }

    const diffMs = d.getTime() - startDate.getTime();
    let weekNum = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
    let weekPill = `WK ${weekNum}`;
    let isBreak = false;

    if (semType === 'SEM I') {
      if (weekNum === 8) {
        weekPill = 'MID-SEM BREAK';
        isBreak = true;
      } else if (weekNum > 8 && weekNum <= 15) {
        weekPill = `WK ${weekNum - 1}`;
      } else if (weekNum === 16) {
        weekPill = 'REVISION WK';
        isBreak = true;
      } else if (weekNum > 16 && weekNum <= 19) {
        weekPill = `EXAM WK ${weekNum - 16}`;
        isBreak = true;
      } else if (weekNum > 19) {
        weekPill = 'SEMESTER BREAK';
        isBreak = true;
      }
    } else if (semType === 'SEM II') {
      if (weekNum === 8) {
        weekPill = 'MID-SEM BREAK';
        isBreak = true;
      } else if (weekNum > 8 && weekNum <= 15) {
        weekPill = `WK ${weekNum - 1}`;
      } else if (weekNum === 16) {
        weekPill = 'REVISION WK';
        isBreak = true;
      } else if (weekNum > 16 && weekNum <= 19) {
        weekPill = `EXAM WK ${weekNum - 16}`;
        isBreak = true;
      } else if (weekNum > 19) {
        weekPill = 'SEMESTER BREAK';
        isBreak = true;
      }
    }

    const shortYearStart = String(acYearStart).slice(-2);
    const shortYearEnd = String(acYearEnd).slice(-2);
    const semName = `20${shortYearStart}/20${shortYearEnd} ${semType}`;

    return {
      semName,
      weekNum: Math.max(1, weekNum),
      weekPill,
      isBreak,
      semType,
      academicYear: `20${shortYearStart}/20${shortYearEnd}`
    };
  }

  function detectActualAcademicTerm(fallbackDate = new Date()) {
    // 1. Try detecting from courses data if available
    const courses = (typeof window !== 'undefined' && Array.isArray(window.coursesData)) ? window.coursesData : [];
    for (const c of courses) {
      const text = `${c.name || ''} ${c.title || ''} ${c.category || ''} ${c.code || ''}`;
      const yearMatch = text.match(/\b(20\d{2})\/(20\d{2})\b/);
      const semMatch = text.match(/\bSEM(?:ESTER)?\s*([12I]|II|SPECIAL)\b/i);
      if (yearMatch) {
        const academicYear = `${yearMatch[1]}/${yearMatch[2]}`;
        let semType = 'SEM I';
        if (semMatch) {
          const s = semMatch[1].toUpperCase();
          if (s === '2' || s === 'II') semType = 'SEM II';
          else if (s.includes('SPEC')) semType = 'SPECIAL SEM';
          else semType = 'SEM I';
        }
        return { academicYear, semType, semName: `${academicYear} ${semType}` };
      }
    }

    // 2. Try detecting from attendances data if available
    const atts = (typeof window !== 'undefined' && Array.isArray(window.attendancesData)) ? window.attendancesData : [];
    for (const a of atts) {
      const text = `${a.courseName || ''} ${a.attTitle || ''} ${a.courseCode || ''}`;
      const yearMatch = text.match(/\b(20\d{2})\/(20\d{2})\b/);
      const semMatch = text.match(/\bSEM(?:ESTER)?\s*([12I]|II|SPECIAL)\b/i);
      if (yearMatch) {
        const academicYear = `${yearMatch[1]}/${yearMatch[2]}`;
        let semType = 'SEM I';
        if (semMatch) {
          const s = semMatch[1].toUpperCase();
          if (s === '2' || s === 'II') semType = 'SEM II';
          else if (s.includes('SPEC')) semType = 'SPECIAL SEM';
          else semType = 'SEM I';
        }
        return { academicYear, semType, semName: `${academicYear} ${semType}` };
      }
    }

    // 3. Fallback to UM official calendar algorithm
    const um = getUmAcademicInfo(fallbackDate);
    if (um) return um;

    const yr = (fallbackDate instanceof Date ? fallbackDate : new Date()).getFullYear();
    return { academicYear: `${yr}/${yr + 1}`, semType: 'SEM I', semName: `${yr}/${yr + 1} SEM I` };
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

  // Universal Helper to generate a strictly unique, collision-proof ID for each course material item
  function generateUniqueFileId(courseId, secName, fileIndex, url, title) {
    const cId = String(courseId || 'c').replace(/[^a-z0-9_-]/gi, '');
    const idMatch = (url || '').match(/[?&]id=(\d+)/);
    const moodleId = idMatch ? idMatch[1] : '';

    const secSlug = (secName || 'sec')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'sec';

    const titleSlug = (title || 'file')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'file';

    if (moodleId) {
      return `f_${cId}_m${moodleId}_${secSlug}_${fileIndex}`;
    }
    return `f_${cId}_${secSlug}_${fileIndex}_${titleSlug}`;
  }

  // Locates the active or open SPeCTRUM Moodle tab
  async function findSpectrumTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) return null;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.url && (activeTab.url.includes('spectrum.um.edu.my') || activeTab.url.includes('login.microsoftonline.com'))) {
        return activeTab;
      }
      const spectrumTabs = await chrome.tabs.query({ url: ["*://spectrum.um.edu.my/*", "*://login.microsoftonline.com/*"] });
      if (spectrumTabs && spectrumTabs.length > 0) {
        return spectrumTabs[0];
      }
    } catch (e) {
      if (typeof logDiag === 'function') logDiag('TABS', 'Failed querying spectrum tab', e.message);
    }
    return null;
  }

  // Export onto Window
  window.cleanHtmlForParser = cleanHtmlForParser;
  window.logDiag = logDiag;
  window.formatDateKey = formatDateKey;
  window.formatDateKeyToShort = formatDateKeyToShort;
  window.extractOccs = extractOccs;
  window.formatOccTag = formatOccTag;
  window.cleanOccNumber = cleanOccNumber;
  window.extractOnlyTime = extractOnlyTime;
  window.cleanSectionTitle = cleanSectionTitle;
  window.cleanDisplayCourseName = cleanDisplayCourseName;
  window.cleanSingleCourseCode = cleanSingleCourseCode;
  window.generateCourseAcronym = generateCourseAcronym;
  window.getCourseCategoryTag = getCourseCategoryTag;
  window.parseTimeRangeRobust = parseTimeRangeRobust;
  window.getAcademicMonday = getAcademicMonday;
  window.getUmAcademicInfo = getUmAcademicInfo;
  window.detectActualAcademicTerm = detectActualAcademicTerm;
  window.escapeHtml = escapeHtml;
  window.downloadBlobFile = downloadBlobFile;
  window.generateUniqueFileId = generateUniqueFileId;
  window.findSpectrumTab = findSpectrumTab;
})(typeof window !== 'undefined' ? window : this);
