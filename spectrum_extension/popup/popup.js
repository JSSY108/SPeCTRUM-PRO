// SPeCTRUM Pro Popup Controller v2.0
// Features: Activities Hub (Announcements, Assignments, Auto-Attendance), Timeline Visualizer, Group by Course, Course Materials Downloader (.ZIP)

// Security & CSP Sanitizer: Strips scripts, inline event handlers, and javascript: navigations from fetched HTML
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

// Global State Accessible across all fetchers and UI handlers
let coursesData = []; // Hierarchical tree model
let allCoursesDiscovered = []; // Unfiltered courses discovered
let announcementsData = []; // Array of announcements
let assignmentsData = []; // Array of assignments
let attendancesData = []; // Array of attendance records
let courseOccs = {}; // courseId -> occ string
let defaultOcc = '';
let forceShowOccBanner = false;
let isSyncingActivities = false;
let isScanningMaterials = false;
let currentSyncAbortController = null;
let syncStartTime = 0;
let saveCacheTimeout = null;

// Universal Date Helper (Accessible in both UI and fetchers)
function formatDateKey(d) {
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Universal OCC Group Helper (Accessible in both UI and fetchers)
function extractOccs(text) {
  if (!text) return [];
  const set = new Set();
  const str = String(text);

  // 1. Range like OCC 1-5 or OCC 1–5 or Group 1-4
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

  // 2. Individual OCC or Group numbers
  const singleRe = /\b(?:occ|group|grp|kumpulan|kump|section|seksyen)[:\s]*0*([1-9]\d*)\b/gi;
  let sm;
  while ((sm = singleRe.exec(str)) !== null) {
    set.add(parseInt(sm[1], 10));
  }

  return Array.from(set);
}

// Universal Helper to clean Moodle 4 section titles from screen reader text and boilerplate buttons
function cleanSectionTitle(text) {
  if (!text || typeof text !== 'string') return 'General';

  // 1. Split into lines and filter out Moodle accessibility & action button lines
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
    // If all lines were filtered, strip boilerplate keywords from the first line
    result = lines[0]
      .replace(/^\s*(select\s+section|pilih\s+seksyen)\s+/i, '')
      .replace(/\b(collapse|expand|toggle\s+section|collapse\s+all|expand\s+all|runtuhkan|kembangkan|buka|tutup)\b/gi, '')
      .trim();
  }

  // 2. Regex cleanup for inline boilerplate keywords and extra whitespace
  result = (result || '')
    .replace(/\b(select\s+section|pilih\s+seksyen)\b/gi, '')
    .replace(/\b(collapse\s+all|expand\s+all|collapse|expand|toggle\s+section|toggle|runtuhkan|kembangkan)\b/gi, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 3. Deduplicate if identical repeated halves (e.g. "General General" from nested label+text)
  const halfMatch = result.match(/^(.+?)\s+\1$/i);
  if (halfMatch) {
    result = halfMatch[1];
  } else {
    const words = result.split(' ');
    if (words.length >= 2 && words.length % 2 === 0) {
      const half = words.length / 2;
      const firstHalf = words.slice(0, half).join(' ');
      const secondHalf = words.slice(half).join(' ');
      if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
        result = firstHalf;
      }
    }
  }

  // If text became empty or boilerplate, normalize
  if (!result || /^general$/i.test(result) || /^am$/i.test(result) || /^overview$/i.test(result)) {
    return 'General';
  }
  return result;
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

// Universal Fetch with Timeout and Master Cancellation Signal
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(new Error(`SPeCTRUM request timed out after ${timeoutMs}ms: ${url}`));
  }, timeoutMs);

  const callerSignal = options.signal;
  const masterSignal = currentSyncAbortController ? currentSyncAbortController.signal : null;

  const onMasterAbort = () => {
    timeoutController.abort(masterSignal?.reason || 'Sync cancelled');
  };
  const onCallerAbort = () => {
    timeoutController.abort(callerSignal?.reason || 'Request cancelled');
  };

  if (masterSignal) {
    if (masterSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Sync aborted', 'AbortError');
    }
    masterSignal.addEventListener('abort', onMasterAbort, { once: true });
  }

  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      if (masterSignal) masterSignal.removeEventListener('abort', onMasterAbort);
      throw new DOMException('Request aborted', 'AbortError');
    }
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const fetchOptions = {
      ...options,
      credentials: options.credentials || 'include',
      signal: timeoutController.signal
    };
    return await fetch(url, fetchOptions);
  } finally {
    clearTimeout(timer);
    if (masterSignal) masterSignal.removeEventListener('abort', onMasterAbort);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Elements - Header & Tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const statusIndicator = document.getElementById('connection-status');
  const btnOpenTab = document.getElementById('btn-open-tab');
  const badgeActivitiesCount = document.getElementById('badge-activities-count');

  // Elements - Activities Tab
  const activitiesSearchInput = document.getElementById('activities-search-input');
  const btnClearActivitiesSearch = document.getElementById('btn-clear-activities-search');
  const activitiesCacheBadge = document.getElementById('activities-cache-badge');
  const btnRefreshActivities = document.getElementById('btn-refresh-activities');
  const btnRefreshActivitiesLabel = document.getElementById('btn-refresh-activities-label');

  function updateSyncButtonSpinState(isSpinning, labelText) {
    const text = labelText || (isSpinning ? 'Syncing...' : 'Sync');
    if (btnRefreshActivities) {
      btnRefreshActivities.classList.toggle('spinning', isSpinning);
      if (btnRefreshActivitiesLabel) btnRefreshActivitiesLabel.textContent = text;
    }
    const fulltabBtn = document.getElementById('btn-fulltab-sync');
    if (fulltabBtn) {
      fulltabBtn.classList.toggle('spinning', isSpinning);
      const fulltabLabel = fulltabBtn.querySelector('span');
      if (fulltabLabel) fulltabLabel.textContent = text;
    }
    const btnSyncFilteredAttEl = document.getElementById('btn-sync-filtered-att');
    if (btnSyncFilteredAttEl) {
      btnSyncFilteredAttEl.classList.toggle('spinning', isSpinning);
    }

    // Trigger Pure White Laser Animation on brand logo prism across all surfaces
    document.querySelectorAll('.brand-logo-container').forEach(c => c.classList.toggle('anim-fetching', isSpinning));
    document.querySelectorAll('.header-brand-logo-svg').forEach(svg => {
      if (isSpinning) {
        svg.classList.remove('stage-settled');
        svg.classList.add('stage-fetching');
      } else {
        svg.classList.remove('stage-fetching');
        svg.classList.add('stage-settled');
      }
    });
  }

  // KPI Metrics Elements
  const kpiAnnouncementsCount = document.getElementById('kpi-announcements-count');
  const kpiPendingCount = document.getElementById('kpi-pending-count');
  const kpiOverdueCount = document.getElementById('kpi-overdue-count');
  const kpiActiveAttCount = document.getElementById('kpi-active-att-count');

  // Date Range Filter Elements
  const dateRangeStartInput = document.getElementById('date-range-start');
  const dateRangeEndInput = document.getElementById('date-range-end');
  const dateAnchorInput = document.getElementById('date-anchor-input');
  const datePresetBtns = document.querySelectorAll('.preset-pill');
  const courseScopeSelect = document.getElementById('course-scope-select');

  // Timeline Visualizer Elements
  const timelineVisualizerSection = document.getElementById('timeline-visualizer-section');
  const timelineScrollWrapper = document.getElementById('timeline-scroll-wrapper');
  const timelineTrack = document.getElementById('timeline-track');
  const btnTimelineScrollLeft = document.getElementById('btn-timeline-scroll-left');
  const btnTimelineScrollToday = document.getElementById('btn-timeline-scroll-today');
  const btnTimelineScrollRight = document.getElementById('btn-timeline-scroll-right');
  const btnTimelineEditOcc = document.getElementById('btn-timeline-edit-occ');
  const btnCalEditOcc = document.getElementById('btn-cal-edit-occ');

  // Activities Subnav & Mode Elements
  const subTabBtns = document.querySelectorAll('.sub-tab-btn');
  const subSections = document.querySelectorAll('.sub-section');
  const countSubAnn = document.getElementById('count-sub-ann');
  const countSubAssign = document.getElementById('count-sub-assign');
  const countSubAtt = document.getElementById('count-sub-att');
  const btnModeTimeline = document.getElementById('btn-mode-timeline');
  const btnModeCalendar = document.getElementById('btn-mode-calendar');
  const btnModeByCourse = document.getElementById('btn-mode-bycourse');

  // Interactive Calendar Elements
  const calendarSection = document.getElementById('calendar-section');
  const btnCalPrev = document.getElementById('btn-cal-prev');
  const btnCalNext = document.getElementById('btn-cal-next');
  const btnCalToday = document.getElementById('btn-cal-today');
  const calMonthTitle = document.getElementById('cal-month-title');
  const calGrid = document.getElementById('cal-grid');
  const chkCalTasks = document.getElementById('chk-cal-tasks');
  const chkCalAtt = document.getElementById('chk-cal-att');
  const chkCalAnn = document.getElementById('chk-cal-ann');
  const chkTlTasks = document.getElementById('chk-tl-tasks');
  const chkTlAtt = document.getElementById('chk-tl-att');
  const chkTlAnn = document.getElementById('chk-tl-ann');
  const calDayAgenda = document.getElementById('cal-day-agenda');
  const calAgendaDate = document.getElementById('cal-agenda-date');
  const calAgendaCount = document.getElementById('cal-agenda-count');
  const calAgendaList = document.getElementById('cal-agenda-list');
  const btnCloseAgenda = document.getElementById('btn-close-agenda');

  // Announcements Sub-section
  const announcementsListEl = document.getElementById('announcements-list');
  const announcementsLoadingEl = document.getElementById('announcements-loading');

  // Assignments Sub-section
  const filterPills = document.querySelectorAll('.filter-pill');
  const assignmentsListEl = document.getElementById('assignments-list');
  const assignmentsLoadingEl = document.getElementById('assignments-loading');

  // Attendance Sub-section
  const attendanceListEl = document.getElementById('attendance-list');
  const attendanceLoadingEl = document.getElementById('attendance-loading');
  const attendanceFilterBarEl = document.getElementById('attendance-filter-bar');
  const selAttFilterCourse = document.getElementById('att-filter-course');
  const selAttFilterDate = document.getElementById('att-filter-date');
  const inputAttFilterDatePicker = document.getElementById('att-filter-date-picker');
  const selAttFilterStatus = document.getElementById('att-filter-status');
  const btnSyncFilteredAtt = document.getElementById('btn-sync-filtered-att');
  const btnSyncFilteredAttText = document.getElementById('btn-sync-filtered-att-text');
  const btnAutoTakeAttendance = document.getElementById('btn-auto-take-attendance');
  const occMultiAlert = document.getElementById('occ-multi-alert');

  // Elements - Course Materials Tab (Tab 2)
  const filterSearchInput = document.getElementById('filter-search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const courseTreeEl = document.getElementById('course-tree');
  const courseLoadingEl = document.getElementById('course-list-loading');
  const courseLoadingText = document.getElementById('course-loading-text');
  const notOnSpectrumEl = document.getElementById('not-on-spectrum');
  const selectAllChk = document.getElementById('select-all');
  const selectedCountEl = document.getElementById('selected-count');
  const btnToggleExpandAll = document.getElementById('btn-toggle-expand-all');
  const expandAllLabel = document.getElementById('btn-toggle-expand-label');
  const btnRescan = document.getElementById('btn-rescan');
  const btnRescanLabel = document.getElementById('btn-rescan-label');
  const cacheTimeBadge = document.getElementById('cache-time-badge');
  const btnDownloadZip = document.getElementById('btn-download-zip');
  const btnDownloadText = document.getElementById('btn-download-text');

  // Progress Elements
  const progressContainer = document.getElementById('progress-container');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatusLabel = document.getElementById('progress-status-label');
  const progressCurrentFile = document.getElementById('progress-current-file');
  const progressFileCount = document.getElementById('progress-file-count');

  // Elements - Preferences Tab
  const defaultOccInput = document.getElementById('default-occ-input');
  const occCoursesTable = document.getElementById('occ-courses-table');
  const chkAutoAttendance = document.getElementById('chk-auto-attendance');
  const selAttendanceInterval = document.getElementById('sel-attendance-interval');
  const chkMaterialsOnly = document.getElementById('chk-materials-only');
  const chkExcludeSystem = document.getElementById('chk-exclude-system');
  const chkExts = document.querySelectorAll('.chk-ext');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  // Elements - Modals
  const annModal = document.getElementById('announcement-modal');
  const modalAnnCourseBadge = document.getElementById('modal-ann-course-badge');
  const modalAnnDate = document.getElementById('modal-ann-date');
  const modalAnnTitle = document.getElementById('modal-ann-title');
  const modalAnnAuthor = document.getElementById('modal-ann-author');
  const modalAnnContent = document.getElementById('modal-ann-content');
  const modalAnnLink = document.getElementById('modal-ann-link');
  const btnCloseAnnModal = document.getElementById('btn-close-ann-modal');
  const btnDismissAnnModal = document.getElementById('btn-dismiss-ann-modal');

  const pinModal = document.getElementById('pin-modal');
  const pinModalTitle = document.getElementById('pin-modal-title');
  const pinModalDesc = document.getElementById('pin-modal-desc');
  const attPinInput = document.getElementById('att-pin-input');
  const pinModalError = document.getElementById('pin-modal-error');
  const btnSubmitPin = document.getElementById('btn-submit-pin');
  const btnCancelPin = document.getElementById('btn-cancel-pin');
  const btnClosePinModal = document.getElementById('btn-close-pin-modal');

  // Elements - Mandatory / Fast OCC Setup Modal
  const occSetupModal = document.getElementById('occ-setup-modal');
  const quickOccInput = document.getElementById('quick-occ-input');
  const quickOccPills = document.getElementById('quick-occ-pills');
  const occModalError = document.getElementById('occ-modal-error');
  const btnSaveOccModal = document.getElementById('btn-save-occ-modal');
  const btnSkipOccModal = document.getElementById('btn-skip-occ-modal');
  const btnCloseOccModal = document.getElementById('btn-close-occ-modal');

  // Diagnostics Elements
  const diagPanel = document.getElementById('diag-panel');
  const diagHeaderToggle = document.getElementById('diag-header-toggle');
  const diagBody = document.getElementById('diag-body');
  const diagLogView = document.getElementById('diag-log-view');
  const btnHardSync = document.getElementById('btn-hard-sync');
  const btnCopyDiagLog = document.getElementById('btn-copy-diag-log');
  const btnClearDiagLog = document.getElementById('btn-clear-diag-log');
  const diagBadgeSession = document.getElementById('diag-badge-session');
  const diagBadgeCourses = document.getElementById('diag-badge-courses');
  const diagBadgeAtt = document.getElementById('diag-badge-att');


  function setDiagBadge(badgeEl, status, text) {
    if (!badgeEl) return;
    badgeEl.className = `diag-badge ${status}`;
    badgeEl.textContent = text;
  }

  if (diagHeaderToggle && diagBody && diagPanel) {
    diagHeaderToggle.addEventListener('click', (e) => {
      if (e.target.closest('.diag-actions')) return;
      const isOpen = diagBody.style.display !== 'none';
      diagBody.style.display = isOpen ? 'none' : 'block';
      diagPanel.classList.toggle('open', !isOpen);
    });
  }

  if (btnCopyDiagLog) {
    btnCopyDiagLog.addEventListener('click', async (e) => {
      e.stopPropagation();
      const textToCopy = diagLogs.join('\n');
      if (!textToCopy) return;
      try {
        await navigator.clipboard.writeText(textToCopy);
        const oldText = btnCopyDiagLog.textContent;
        btnCopyDiagLog.textContent = '✔ Copied!';
        setTimeout(() => { btnCopyDiagLog.textContent = oldText; }, 2000);
      } catch (err) {
        logDiag('Diag', 'Failed to copy to clipboard', err?.message);
      }
    });
  }

  if (btnClearDiagLog) {
    btnClearDiagLog.addEventListener('click', (e) => {
      e.stopPropagation();
      diagLogs.length = 0;
      if (diagLogView) diagLogView.textContent = 'Log cleared. Click "Sync" to trace.';
    });
  }

  if (btnHardSync) {
    btnHardSync.addEventListener('click', async (e) => {
      e.stopPropagation();
      await hardRescanAll();
    });
  }

  async function hardRescanAll() {
    logDiag('HardRescan', 'Wiping local caches to force complete fresh rescan...');
    if (diagBody) diagBody.style.display = 'block';
    if (diagPanel) diagPanel.classList.add('open');

    // Force-abort any existing hung sync & break lock immediately
    if (currentSyncAbortController) {
      try {
        currentSyncAbortController.abort('Hard rescan initiated');
      } catch (e) {}
      currentSyncAbortController = null;
    }
    isSyncingActivities = false;
    syncStartTime = 0;

    try {
      await chrome.storage.local.remove([
        'cachedCoursesData',
        'cachedCoursesTime',
        'cachedAnnouncements',
        'cachedAssignments',
        'cachedAttendances',
        'cachedActivitiesTime'
      ]);
      coursesData = [];
      allCoursesDiscovered = [];
      announcementsData = [];
      assignmentsData = [];
      attendancesData = [];
      renderAllActivities();
      logDiag('HardRescan', 'Storage cleared. Calling refreshActivities(true)...');
      await refreshActivities(true, false);
    } catch (err) {
      logDiag('HardRescan:Err', 'Error during hard rescan: ' + (err?.message || err));
    }
  }

  // State (using outer scope variables)
  coursesData = []; // Hierarchical tree model
  allCoursesDiscovered = []; // Unfiltered courses discovered
  announcementsData = []; // Array of announcements
  assignmentsData = []; // Array of assignments
  attendancesData = []; // Array of attendance records
  courseOccs = {}; // courseId -> occ string
  defaultOcc = '';
  forceShowOccBanner = false;
  isSyncingActivities = false;
  saveCacheTimeout = null;
  let activeTabSession = null;
  let currentActivitiesSub = 'sub-announcements'; // 'sub-announcements' | 'sub-assignments' | 'sub-attendance'
  let currentActivitiesMode = 'timeline'; // 'timeline' | 'calendar' | 'bycourse'
  let currentSortOrder = 'newest'; // 'newest' | 'oldest'
  let fullListGroupingMode = 'date'; // 'date' | 'course'
  let currentFullTabMode = 'calendar'; // 'timeline' | 'calendar' | 'list' | 'materials' | 'preferences'
  let currentAssignFilter = 'all'; // 'all' | 'pending' | 'due-soon' | 'submitted' | 'overdue'
  let currentExtFilter = 'ALL'; // 'ALL' | 'PDF' | 'PPTX' | 'ZIP' | 'DOCX' | 'IPYNB'
  let currentAttCourseFilter = 'all'; // 'all' | courseId
  let currentAttDateFilter = 'all'; // 'all' | 'today' | 'custom'
  let currentAttCustomDate = ''; // 'YYYY-MM-DD'
  let currentAttStatusFilter = 'all'; // 'all' | 'active-now' | 'upcoming' | 'present'
  let currentInspectedFile = null;
  let currentInspectedSlidePage = 1;
  let hiddenAttendanceIds = []; // Array of dismissed/duplicate attendance activity IDs
  let hiddenAttendanceDetails = {}; // id -> { courseCode, title, dateHidden }
  let activePinSession = null;

  function isAttendanceHidden(att) {
    if (!att) return false;
    if (att._hidden) return true;
    if (!Array.isArray(hiddenAttendanceIds) || hiddenAttendanceIds.length === 0) return false;
    const id = String(att.id || '');
    if (id && hiddenAttendanceIds.includes(id)) return true;
    const cmid = String(att.cmid || '');
    const urlId = String(((att.attUrl || '').match(/id=(\d+)/) || [])[1] || '');
    if (att.subType) {
      if (cmid && hiddenAttendanceIds.includes(`${cmid}_${att.subType}`)) return true;
      if (id && hiddenAttendanceIds.some(hid => hid === id || (hid.endsWith(`_${att.subType}`) && hid.includes(cmid)))) return true;
    } else {
      if (cmid && hiddenAttendanceIds.includes(cmid)) return true;
      if (urlId && hiddenAttendanceIds.includes(urlId)) return true;
    }
    return false;
  }

  // Centralized Minimalist SVG Icons (Razor-sharp, vector stroke, semantic colors)
  const MINI_ICONS = {
    notice: `<svg class="icon-svg icon-notice" viewBox="0 0 24 24"><path d="M3 11l16-5v12L3 13v-2z"/><path d="M10 15v5"/></svg>`,
    assignment: `<svg class="icon-svg icon-assignment" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="m9 14 2 2 4-4"/></svg>`,
    attendance: `<svg class="icon-svg icon-attendance" viewBox="0 0 24 24" fill="currentColor" stroke="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10.5" cy="6.7" r="4.7"/><path d="M 3.38 14.28 C 3.0 14.8 2.9 15.5 3.0 16.9 C 3.2 18.2 4.0 19.0 5.7 19.9 C 7.3 20.6 9.4 21.0 11.2 21.0 C 10.5 20.1 9.8 18.8 9.6 17.5 C 9.5 15.8 10.1 14.5 10.5 13.5 L 4.8 13.5 C 4.0 13.5 3.6 13.8 3.38 14.28 Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M 15.8 11.5 A 5.3 5.3 0 0 1 15.8 22.1 A 5.3 5.3 0 0 1 15.8 11.5 Z M 19.19 14.84 L 19.14 15.04 L 18.73 15.50 L 15.04 19.14 L 14.74 19.19 L 14.53 19.08 L 12.43 16.94 L 12.49 16.48 L 12.74 16.27 L 13.10 16.27 L 14.79 17.91 L 14.89 17.91 L 18.27 14.48 L 18.57 14.33 L 18.88 14.38 L 19.08 14.58 Z"/></svg>`,
    lecture: `<svg class="icon-svg icon-attendance" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 16v5"/><path d="m9 8 3-2 3 2"/></svg>`,
    tutorial: `<svg class="icon-svg icon-attendance" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
    lab: `<svg class="icon-svg icon-attendance" viewBox="0 0 24 24"><path d="M10 2v7.5a2 2 0 0 1-.2.9L5 20.5A1 1 0 0 0 6 22h12a1 1 0 0 0 1-1.5l-4.8-10.1a2 2 0 0 1-.2-.9V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></svg>`,
    class: `<svg class="icon-svg icon-attendance" viewBox="0 0 24 24" fill="currentColor" stroke="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10.5" cy="6.7" r="4.7"/><path d="M 3.38 14.28 C 3.0 14.8 2.9 15.5 3.0 16.9 C 3.2 18.2 4.0 19.0 5.7 19.9 C 7.3 20.6 9.4 21.0 11.2 21.0 C 10.5 20.1 9.8 18.8 9.6 17.5 C 9.5 15.8 10.1 14.5 10.5 13.5 L 4.8 13.5 C 4.0 13.5 3.6 13.8 3.38 14.28 Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M 15.8 11.5 A 5.3 5.3 0 0 1 15.8 22.1 A 5.3 5.3 0 0 1 15.8 11.5 Z M 19.19 14.84 L 19.14 15.04 L 18.73 15.50 L 15.04 19.14 L 14.74 19.19 L 14.53 19.08 L 12.43 16.94 L 12.49 16.48 L 12.74 16.27 L 13.10 16.27 L 14.79 17.91 L 14.89 17.91 L 18.27 14.48 L 18.57 14.33 L 18.88 14.38 L 19.08 14.58 Z"/></svg>`,
    user: `<svg class="icon-svg" viewBox="0 0 24 24" style="width:12px;height:12px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
  };

  // Attendance Type & Keyword Classification Helper
  function getAttendanceTypeInfo(attOrTitle, desc = '') {
    if (typeof attOrTitle === 'object' && attOrTitle !== null) {
      if (attOrTitle.subType === 'lecture') {
        return { type: 'lecture', label: 'Lecture', shortLabel: 'Lec', icon: MINI_ICONS.lecture, svgIcon: MINI_ICONS.lecture, badgeClass: 'att-type-lecture' };
      }
      if (attOrTitle.subType === 'tutorial') {
        return { type: 'tutorial', label: 'Tutorial', shortLabel: 'Tut', icon: MINI_ICONS.tutorial, svgIcon: MINI_ICONS.tutorial, badgeClass: 'att-type-tutorial' };
      }
      if (attOrTitle.subType === 'lab') {
        return { type: 'lab', label: 'Lab', shortLabel: 'Lab', icon: MINI_ICONS.lab, svgIcon: MINI_ICONS.lab, badgeClass: 'att-type-lab' };
      }
    }

    let rawTitle = '';
    let rawDesc = '';
    if (typeof attOrTitle === 'object' && attOrTitle !== null) {
      rawTitle = attOrTitle.attTitle || attOrTitle.title || '';
      rawDesc = (attOrTitle.activeSession && attOrTitle.activeSession.desc) ||
                (attOrTitle.nextSession && attOrTitle.nextSession.desc) ||
                (attOrTitle.desc) || '';
    } else {
      rawTitle = String(attOrTitle || '');
      rawDesc = String(desc || '');
    }

    const combined = (rawTitle + ' ' + rawDesc).toLowerCase();

    if (/lecture|kuliah/i.test(combined)) {
      return { type: 'lecture', label: 'Lecture', shortLabel: 'Lec', icon: MINI_ICONS.lecture, svgIcon: MINI_ICONS.lecture, badgeClass: 'att-type-lecture' };
    }
    if (/tutorial|tut/i.test(combined)) {
      return { type: 'tutorial', label: 'Tutorial', shortLabel: 'Tut', icon: MINI_ICONS.tutorial, svgIcon: MINI_ICONS.tutorial, badgeClass: 'att-type-tutorial' };
    }
    if (/lab|makmal|laboratory/i.test(combined)) {
      return { type: 'lab', label: 'Lab', shortLabel: 'Lab', icon: MINI_ICONS.lab, svgIcon: MINI_ICONS.lab, badgeClass: 'att-type-lab' };
    }
    if (/studio/i.test(combined)) {
      return { type: 'studio', label: 'Studio', shortLabel: 'Studio', icon: MINI_ICONS.tutorial, svgIcon: MINI_ICONS.tutorial, badgeClass: 'att-type-studio' };
    }
    if (/practical|amali/i.test(combined)) {
      return { type: 'practical', label: 'Practical', shortLabel: 'Prac', icon: MINI_ICONS.lab, svgIcon: MINI_ICONS.lab, badgeClass: 'att-type-practical' };
    }
    return { type: 'general', label: 'Class', shortLabel: 'Class', icon: MINI_ICONS.class, svgIcon: MINI_ICONS.class, badgeClass: 'att-type-general' };
  }

  function cleanSessionDesc(desc = '', typeLabel = '') {
    if (!desc) return 'Regular Class Session';
    let clean = String(desc)
      .replace(/^Attendance\s+(for\s+)?/i, '')
      .replace(/\s*\(OCC[^)]*\)/gi, '')
      .replace(/General Attendance Attendance/i, 'General Class Attendance')
      .replace(/General Attendance/i, 'General Class')
      .trim();
    if (!clean || clean.toLowerCase() === (typeLabel || '').toLowerCase()) {
      return `${typeLabel || 'Regular Class'} Session`;
    }
    return clean;
  }

  // Extract ONLY time (e.g. "2PM - 4PM", "14:00 - 16:00", "2:00PM - 4:00PM") and remove redundant Day, Date, Month, Year
  function extractOnlyTime(s) {
    if (!s) return '';
    const str = String(s).trim();

    // 1. Time range with AM/PM (e.g. "2PM - 4PM", "2:00PM - 4:00PM", "8.00AM - 10.00AM")
    const rangeMatch = str.match(/\b(\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM)?\s*(?:[-–—~]|to)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM))\b/i);
    if (rangeMatch) return rangeMatch[1].trim();

    // 2. 24-hour time range (e.g. "14:00 - 16:00", "08:30 - 10:30")
    const range24 = str.match(/\b(\d{1,2}:\d{2}\s*(?:[-–—~]|to)\s*\d{1,2}:\d{2})\b/);
    if (range24) return range24[1].trim();

    // 3. Single time with AM/PM (e.g. "2PM", "2:00 PM", "8.30AM")
    const singleMatch = str.match(/\b(\d{1,2}(?:[:.]\d{2})?\s*(?:AM|PM))\b/i);
    if (singleMatch) return singleMatch[1].trim();

    // 4. Single 24-hr time (e.g. "14:00")
    const single24 = str.match(/\b(\d{1,2}:\d{2})\b/);
    if (single24) return single24[1].trim();

    // 5. Fallback: strip leading day of week, day number, month, year
    const stripped = str.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s*/i, '')
                        .replace(/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\s*/i, '')
                        .replace(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*/, '')
                        .replace(/^[@,\-–—\s]+/, '')
                        .trim();
    return stripped || str;
  }

  // Remove unbold course code that is redundant to the bolded course code
  function cleanDisplayCourseName(courseName, courseCode) {
    if (!courseName) return '';
    let name = String(courseName).replace(/[\r\n\t]+/g, ' ').trim();
    if (courseCode) {
      const codeTrimmed = String(courseCode).trim();
      if (codeTrimmed) {
        const escapedCode = codeTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const codeRegex = new RegExp('^\\s*(?:\\[?\\s*' + escapedCode + '\\s*\\]?|[\\(\\[]?\\s*' + escapedCode + '\\s*[\\)\\]]?)\\s*[-:·/|—–_~]*\\s*', 'i');
        name = name.replace(codeRegex, '').trim();
        if (codeTrimmed.includes('/')) {
          const parts = codeTrimmed.split('/').map(p => p.trim()).filter(Boolean);
          for (const p of parts) {
            const escP = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const partRegex = new RegExp('^\\s*(?:\\[?\\s*' + escP + '\\s*\\]?|[\\(\\[]?\\s*' + escP + '\\s*[\\)\\]]?)\\s*[-:·/|—–_~]*\\s*', 'i');
            name = name.replace(partRegex, '').trim();
          }
        }
      }
    }
    name = name.replace(/^\s*(?:\[\s*[A-Z]{2,4}\d{4}(?:\s*\/\s*[A-Z]{2,4}\d{4})*\s*\]|[A-Z]{2,4}\d{4}(?:\s*\/\s*[A-Z]{2,4}\d{4})*)\s*[-:·/|—–_~]*\s*/i, '').trim();
    name = name.replace(/^[-:·/|—–_~]\s*/, '').trim();
    return name;
  }

  function isAttendanceAlive(att) {
    if (!att) return false;
    if (att._hidden) return false;
    if (att.activeSession != null) return true;
    if (att.nextSession != null) return true;
    if (Array.isArray(att.sessions) && att.sessions.some(s => s.isFuture || s.isToday)) return true;
    return false;
  }

  // Determine if an attendance item is a duplicate and should show delete/hide buttons
  // Rules:
  // 1. Same course items are compared.
  // 2. 'general' (Class) is a fallback that counts as a duplicate of Lecture or Tutorial (or another Class) in the same course.
  // 3. If there is only 1 Lecture and 1 Tutorial (and 0 Classes) in the course, neither has duplicates (no delete button).
  // 4. If a Class exists alongside other attendance items in the course, Class duplicates with them and gets the delete button.
  // 5. Lecture or Tutorial has duplicates if there are >= 2 of the same type OR if a Class exists in that course.
  function canHideAttendanceItem(att, courseItems) {
    if (!att || !Array.isArray(courseItems) || courseItems.length <= 1) return false;
    const tInfo = getAttendanceTypeInfo(att, (att.activeSession && att.activeSession.desc) || (att.nextSession && att.nextSession.desc) || '');
    const t = tInfo.type || 'general';

    // If it's a generic 'general' / Class fallback:
    // It duplicates with any Lecture, Tutorial, or other Class in the same course.
    if (t === 'general') {
      return courseItems.length > 1;
    }

    // For specific types (lecture, tutorial, lab, etc.):
    // Count items of the exact same type, plus any 'general' (Class) fallback items in this course
    let sameTypeCount = 0;
    let classFallbackCount = 0;

    courseItems.forEach(it => {
      const itInfo = getAttendanceTypeInfo(it, (it.activeSession && it.activeSession.desc) || (it.nextSession && it.nextSession.desc) || '');
      const itType = itInfo.type || 'general';
      if (itType === t) {
        sameTypeCount++;
      } else if (itType === 'general') {
        classFallbackCount++;
      }
    });

    // Duplicates exist if:
    // - There are 2 or more of the same type (e.g. 2 Lectures)
    // - OR there is a Class fallback in this course (which duplicates with this Lecture/Tutorial)
    return (sameTypeCount > 1) || (classFallbackCount > 0);
  }

  // Duplicate Attendance Removal & Management Helpers (Permanently saved in preferences)
  async function removeAttendanceDuplicate(attId) {
    if (!attId) return;

    try {
      logDiag('Attendance:Remove', `Processing duplicate removal for ID: [${attId}]`);

      // Find in attendancesData with robust matching
      const att = attendancesData.find(a => 
        String(a.id) === String(attId) || 
        String(a.cmid) === String(attId) || 
        (a.id && String(attId).startsWith(String(a.id) + '_')) ||
        (a.id && String(a.id).startsWith(String(attId) + '_')) ||
        (a.cmid && String(attId).includes(`_${a.cmid}_`)) ||
        (a.attUrl && a.attUrl.includes(`id=${attId}`))
      );

      const fullId = att ? (att.id || String(attId)) : String(attId);
      const cmid = att ? (att.cmid || ((att.attUrl || '').match(/id=(\d+)/) || [])[1] || '') : '';
      const urlId = ((att?.attUrl || '').match(/id=(\d+)/) || [])[1] || '';

      if (!hiddenAttendanceIds.includes(fullId)) hiddenAttendanceIds.push(fullId);
      if (String(attId) !== String(fullId) && !hiddenAttendanceIds.includes(String(attId))) {
        hiddenAttendanceIds.push(String(attId));
      }

      // If not a split subType item, also hide by generic cmid and urlId
      if (!att?.subType && !attId.endsWith('_lec') && !attId.endsWith('_tut')) {
        if (cmid && !hiddenAttendanceIds.includes(cmid)) hiddenAttendanceIds.push(cmid);
        if (urlId && !hiddenAttendanceIds.includes(urlId)) hiddenAttendanceIds.push(urlId);
      }

      // Mark the item in-memory as hidden
      if (att) {
        att._hidden = true;
      }
      attendancesData.forEach(a => {
        if (String(a.id) === String(attId) || String(a.id) === String(fullId)) {
          a._hidden = true;
        }
      });

      const courseCode = att ? (att.courseCode || att.courseName || 'Course') : 'Course';
      const typeInfo = att ? getAttendanceTypeInfo(att, (att.activeSession && att.activeSession.desc) || (att.nextSession && att.nextSession.desc) || '') : { icon: '📅', label: 'Attendance' };
      const cleanDesc = att ? cleanSessionDesc((att.activeSession && att.activeSession.desc) || (att.nextSession && att.nextSession.desc) || att.attTitle || 'Attendance', typeInfo.label) : 'Duplicate Attendance Session';

      hiddenAttendanceDetails[fullId] = {
        id: fullId,
        cmid: cmid,
        courseCode: courseCode,
        title: `${typeInfo.icon} ${typeInfo.label} · ${cleanDesc}`,
        dateHidden: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      };

      await chrome.storage.local.set({
        hiddenAttendanceIds: hiddenAttendanceIds,
        hiddenAttendanceDetails: hiddenAttendanceDetails
      });

      debounceSaveCache();

      logDiag('Attendance:Remove', `✔ Removed duplicate attendance [${fullId}] (${courseCode}). Total hidden: ${hiddenAttendanceIds.length}`);

      renderAttendanceList();
      renderTimelineVisualizer();
      if (currentActivitiesMode === 'calendar') {
        renderCalendarView(calCurrentYear, calCurrentMonth);
      }
      renderHiddenAttendanceSettings();
      updateKpiCards();
    } catch (err) {
      logDiag('Attendance:RemoveErr', `Error removing duplicate attendance [${attId}]: ${err?.message || err}`);
      console.error('[SPeCTRUM Pro] Error removing duplicate attendance:', err);
    }
  }

  async function restoreAttendanceActivity(attId) {
    if (!attId) return;
    hiddenAttendanceIds = hiddenAttendanceIds.filter(id => id !== attId && id !== String(attId));
    delete hiddenAttendanceDetails[attId];
    Object.keys(hiddenAttendanceDetails).forEach(k => {
      if (hiddenAttendanceDetails[k].id === attId || hiddenAttendanceDetails[k].cmid === attId) {
        delete hiddenAttendanceDetails[k];
      }
    });

    await chrome.storage.local.set({
      hiddenAttendanceIds: hiddenAttendanceIds,
      hiddenAttendanceDetails: hiddenAttendanceDetails
    });

    logDiag('Attendance:Restore', `Restored attendance [${attId}]. Remaining hidden: ${hiddenAttendanceIds.length}`);

    renderAttendanceList();
    renderTimelineVisualizer();
    if (currentActivitiesMode === 'calendar') {
      renderCalendarView(calCurrentYear, calCurrentMonth);
    }
    renderHiddenAttendanceSettings();
    updateKpiCards();
  }

  async function restoreAllAttendanceActivities() {
    hiddenAttendanceIds = [];
    hiddenAttendanceDetails = {};

    await chrome.storage.local.set({
      hiddenAttendanceIds: [],
      hiddenAttendanceDetails: {}
    });

    logDiag('Attendance:RestoreAll', 'Restored all hidden attendance duplicates.');

    renderAttendanceList();
    renderTimelineVisualizer();
    if (currentActivitiesMode === 'calendar') {
      renderCalendarView(calCurrentYear, calCurrentMonth);
    }
    renderHiddenAttendanceSettings();
    updateKpiCards();
  }

  function renderHiddenAttendanceSettings() {
    const container = document.getElementById('hidden-att-list');
    const countEl = document.getElementById('pref-hidden-count');
    const btnRestoreAll = document.getElementById('btn-restore-all-att');
    if (!container) return;

    const detailKeys = Object.keys(hiddenAttendanceDetails);
    const items = [];
    hiddenAttendanceIds.forEach(id => {
      if (detailKeys.includes(id)) {
        if (!items.some(it => it.id === id)) {
          items.push(hiddenAttendanceDetails[id]);
        }
      } else if (!items.some(it => it.id === id || it.cmid === id)) {
        items.push({
          id: id,
          courseCode: 'Attendance',
          title: `ID: ${id}`,
          dateHidden: 'Saved'
        });
      }
    });

    if (countEl) {
      countEl.textContent = `${items.length} Hidden Activit${items.length === 1 ? 'y' : 'ies'}`;
    }

    if (btnRestoreAll) {
      btnRestoreAll.style.opacity = items.length === 0 ? '0.4' : '1';
      btnRestoreAll.style.pointerEvents = items.length === 0 ? 'none' : 'auto';
      btnRestoreAll.onclick = async () => {
        await restoreAllAttendanceActivities();
      };
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div class="pref-hidden-empty">
          <span>✔ No duplicate attendances currently hidden.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => {
      let cleanTitle = (item.title || 'REGULAR').replace(/[\u{1F300}-\u{1F9FF}]/gu, '').replace(/^\s*·\s*/, '').trim();
      if (!cleanTitle) cleanTitle = 'REGULAR';
      const heading = item.courseCode ? `${escapeHtml(item.courseCode)} · ${escapeHtml(cleanTitle)}` : escapeHtml(cleanTitle);
      const dateText = item.dateHidden || 'Recently';

      return `
        <div class="pref-hidden-card">
          <div class="pref-hidden-details">
            <div class="pref-hidden-title-mono">${heading}</div>
            <div class="pref-hidden-time-mono">Hidden: ${escapeHtml(dateText)}</div>
          </div>
          <button type="button" class="pref-wireframe-btn btn-restore-single-att" data-att-id="${escapeHtml(item.id)}">Restore</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-restore-single-att').forEach(btn => {
      btn.addEventListener('click', async () => {
        const attId = btn.dataset.attId;
        if (attId) await restoreAttendanceActivity(attId);
      });
    });
  }

  // Date Filter State (Capped at 1 Month Max Span)
  const MAX_SPAN_DAYS = 31;
  let currentDatePreset = 'past-30';
  let dateRangeStart = '';
  let dateRangeEnd = '';
  let courseScope = 'active'; // 'active' | 'all'

  // Calendar State
  let calCurrentYear = (new Date()).getFullYear();
  let calCurrentMonth = (new Date()).getMonth();
  let calSelectedDateKey = formatDateKey(new Date());

  // Dynamic UM Academic Semester & Week Engine
  // Specification:
  // - Month 9 - 3 (Sep to Mar of next year): SEM I
  // - Month 4 - 7 (Apr to Jul): SEM II
  // - Month 8 (Aug): SPECIAL SEM / Inter-Sem Break
  function getAcademicMonday(year, monthIndex, position) {
    if (position === 'last') {
      const lastDay = new Date(year, monthIndex + 1, 0);
      const dayOfWeek = lastDay.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      const diffToMonday = (dayOfWeek + 6) % 7;
      return new Date(year, monthIndex, lastDay.getDate() - diffToMonday);
    } else {
      const firstDay = new Date(year, monthIndex, 1);
      const dayOfWeek = firstDay.getDay();
      const diffToMonday = (8 - (dayOfWeek || 7)) % 7;
      return new Date(year, monthIndex, 1 + diffToMonday);
    }
  }

  function getUmAcademicInfo(date = new Date()) {
    const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date();
    const year = d.getFullYear();
    const month = d.getMonth() + 1; // 1-12

    let semType = 'SEM I';
    let acYearStart = year;
    let acYearEnd = year + 1;
    let startDate = null;

    if (month >= 9 && month <= 12) {
      // Semester 1 (Autumn term of academic year: Sep - Dec)
      semType = 'SEM I';
      acYearStart = year;
      acYearEnd = year + 1;
      // Start of Sem 1: Last Monday of September
      startDate = getAcademicMonday(acYearStart, 8, 'last');
    } else if (month >= 1 && month <= 3) {
      // Semester 1 (Winter/Spring term continuation into next year: Jan - Mar)
      semType = 'SEM I';
      acYearStart = year - 1;
      acYearEnd = year;
      // Start of Sem 1 was last Monday of September of the preceding year
      startDate = getAcademicMonday(acYearStart, 8, 'last');
    } else if (month >= 4 && month <= 7) {
      // Semester 2 (Spring/Summer term: Apr - Jul)
      semType = 'SEM II';
      acYearStart = year - 1;
      acYearEnd = year;
      // Start of Sem 2: First Monday of April
      startDate = getAcademicMonday(acYearEnd, 3, 'first');
    } else {
      // Month 8 (August): Special Term / Inter-Semester Break
      semType = 'SPECIAL SEM';
      acYearStart = year - 1;
      acYearEnd = year;
      // Start of Special Sem: First Monday of August
      startDate = getAcademicMonday(acYearEnd, 7, 'first');
    }

    const msPerWeek = 7 * 24 * 3600 * 1000;
    let weekNum = 1;
    if (d >= startDate) {
      weekNum = Math.floor((d.getTime() - startDate.getTime()) / msPerWeek) + 1;
    } else {
      weekNum = 1;
    }

    // Cap to realistic semester lengths (18 weeks for Sem 1/2, 8 weeks for Special Sem)
    const maxWeeks = (semType === 'SPECIAL SEM') ? 8 : 18;
    const clampedWeek = Math.max(1, Math.min(maxWeeks, weekNum));
    const padWeek = String(clampedWeek).padStart(2, '0');

    const acYearStr = `${acYearStart}-${String(acYearEnd).slice(-2)}`;
    const semName = `${semType} · ${acYearStr}`;

    return {
      semName,
      semType,
      acYearStr,
      weekNum: padWeek,
      weekPill: `${semType} · WK ${padWeek}`,
      clockStr: `${d.toISOString().slice(0, 10)} · WK ${padWeek}`,
      monthYearStr: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
    };
  }

  function updateDateHeroHeader(targetDate) {
    const d = (targetDate instanceof Date && !isNaN(targetDate.getTime())) ? targetDate : new Date();
    const numeralEl = document.getElementById('cal-hero-numeral');
    const dayEl = document.getElementById('cal-hero-day');
    const subEl = document.getElementById('cal-hero-sub');
    const todayBadge = document.getElementById('cal-hero-today-badge');
    const calExpMainDate = document.getElementById('cal-exp-main-date');

    const dayNum = d.getDate();
    const weekdayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const umInfo = getUmAcademicInfo(d);
    const weekNum = parseInt(umInfo.weekNum, 10) || 1;

    if (numeralEl) numeralEl.textContent = dayNum;
    if (dayEl) dayEl.textContent = weekdayName;
    if (subEl) subEl.textContent = `WEEK ${weekNum}`;

    const todayKey = formatDateKey(new Date());
    const currentKey = formatDateKey(d);
    const isToday = currentKey === todayKey;

    if (todayBadge) {
      todayBadge.style.display = isToday ? 'inline-flex' : 'none';
    }

    if (calExpMainDate) {
      const monStr = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const wdStr = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      calExpMainDate.textContent = `${String(dayNum).padStart(2, '0')} ${monStr} ${d.getFullYear()} ${wdStr}`;
    }
  }

  function updateFullTabHeader() {
    const now = new Date();
    const info = getUmAcademicInfo(now);
    const semBadge = document.getElementById('fulltab-sem-badge');
    const clockDisp = document.getElementById('fulltab-clock-display');
    const monthHeading = document.getElementById('fulltab-month-heading');
    const weekPill = document.getElementById('fulltab-week-pill');
    const syncTimeEl = document.getElementById('status-sync-time');

    if (semBadge) semBadge.textContent = info.semName;
    if (clockDisp) clockDisp.textContent = info.clockStr;
    if (monthHeading) {
      if (currentFullTabMode === 'materials') {
        monthHeading.textContent = 'COURSE MATERIALS & DOWNLOADS';
      } else if (currentFullTabMode === 'preferences') {
        monthHeading.textContent = 'PREFERENCES & AUTOMATION';
      } else {
        monthHeading.textContent = info.monthYearStr;
      }
    }
    if (weekPill) weekPill.textContent = info.weekPill;
    if (syncTimeEl) {
      syncTimeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
    if (typeof updateAttendanceDaemonStatus === 'function') updateAttendanceDaemonStatus();
  }

  // Surface Detection: Full-Tab Workspace vs Extension Popup
  function checkIsFullTab() {
    // 1. Explicit query param (set whenever opening full tab from extension)
    if (window.location.search.includes('mode=full')) return true;

    // 2. Standalone desktop tab detection:
    // Chromium extension popups are hard-capped by the browser to <= 800px width and <= 600px height.
    // A regular desktop browser tab is significantly larger (e.g. >= 900px wide or > 620px tall).
    if (window.innerWidth > 800 || window.innerHeight > 620) {
      return true;
    }

    return false;
  }

  const isFullTab = checkIsFullTab();
  document.body.classList.toggle('is-full-tab', isFullTab);
  document.documentElement.classList.toggle('is-full-tab', isFullTab);
  if (isFullTab) window.scrollTo(0, 0);

  function ensureTabsInCorrectSurface() {
    const isFull = document.body.classList.contains('is-full-tab');
    const targetParent = isFull 
      ? document.querySelector('.fulltab-main-viewport')
      : document.querySelector('.popup-body');
    if (!targetParent) return;

    ['tab-materials', 'tab-filters', 'tab-support'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentElement !== targetParent) {
        targetParent.appendChild(el);
      }
    });
  }

  window.addEventListener('resize', () => {
    const full = checkIsFullTab();
    const currentlyFull = document.body.classList.contains('is-full-tab');
    if (currentlyFull !== full) {
      document.body.classList.toggle('is-full-tab', full);
      document.documentElement.classList.toggle('is-full-tab', full);
      if (full) window.scrollTo(0, 0);
      updateFullTabHeader();
      ensureTabsInCorrectSurface();
  const btnStatusFullTab = document.getElementById('btn-status-open-fulltab');
  if (btnStatusFullTab) {
    btnStatusFullTab.addEventListener('click', (e) => {
      e.preventDefault();
      if (chrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=full') });
      } else {
        window.open(location.pathname + '?mode=full', '_blank');
      }
    });
  }
    }
  });
  updateFullTabHeader();
  ensureTabsInCorrectSurface();
  const btnStatusFullTab = document.getElementById('btn-status-open-fulltab');
  if (btnStatusFullTab) {
    btnStatusFullTab.addEventListener('click', (e) => {
      e.preventDefault();
      if (chrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=full') });
      } else {
        window.open(location.pathname + '?mode=full', '_blank');
      }
    });
  }

  // 1. Full Tab & Close Button Handling
  if (btnOpenTab) {
    btnOpenTab.addEventListener('click', (e) => {
      e.preventDefault();
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=full') });
      } else {
        window.open(location.pathname + '?mode=full', '_blank');
      }
    });
  }

  const btnClosePopup = document.getElementById('btn-close-popup');
  if (btnClosePopup) {
    btnClosePopup.addEventListener('click', () => {
      window.close();
    });
  }

  // Full-Tab Header Actions (Sync & Diagnostics)
  const btnFulltabSync = document.getElementById('btn-fulltab-sync');
  const btnFulltabDiag = document.getElementById('btn-fulltab-diag');
  const btnCloseDiagPanel = document.getElementById('btn-close-diag-panel');
  if (btnFulltabSync) {
    btnFulltabSync.addEventListener('click', () => {
      if (isScanningMaterials) {
        const label = btnFulltabSync.querySelector('span');
        if (label) {
          const orig = label.textContent;
          label.textContent = 'Wait (Scanning)...';
          setTimeout(() => { if (label) label.textContent = orig; }, 2000);
        }
        return;
      }
      refreshActivities(false);
    });
  }
  if (btnFulltabDiag && diagPanel) {
    btnFulltabDiag.addEventListener('click', () => {
      const isVisible = diagPanel.style.display !== 'none';
      diagPanel.style.display = isVisible ? 'none' : 'block';
      if (!isVisible && diagBody) diagBody.style.display = 'block';
    });
  }
  if (btnCloseDiagPanel && diagPanel) {
    btnCloseDiagPanel.addEventListener('click', () => {
      diagPanel.style.display = 'none';
    });
  }

  // Left Rail Checklist Toggles (Assignment, Attendance, Notice)
  const railToggleAssign = document.getElementById('rail-toggle-assign');
  const railToggleAtt = document.getElementById('rail-toggle-att');
  const railToggleNotice = document.getElementById('rail-toggle-notice');

  function bindRailToggle(btn, calChk, tlChk) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const active = btn.classList.contains('active');
      if (calChk) calChk.checked = active;
      if (tlChk) tlChk.checked = active;
      renderCalendarView(calCurrentYear, calCurrentMonth);
      renderTimelineVisualizer();
      renderAllActivities();
      if (document.getElementById('fulllist-wrapper')?.style.display !== 'none') {
        renderFullListMode();
      }
    });
  }
  bindRailToggle(railToggleAssign, chkCalTasks, chkTlTasks);
  bindRailToggle(railToggleAtt, chkCalAtt, chkTlAtt);
  bindRailToggle(railToggleNotice, chkCalAnn, chkTlAnn);

  // Left Rail View Switcher (Timeline, Calendar, List)
  const railModeTimeline = document.getElementById('rail-mode-timeline');
  const railModeCalendar = document.getElementById('rail-mode-calendar');
  const railModeList = document.getElementById('rail-mode-list');

  function setFullTabMode(mode) {
    currentFullTabMode = mode;
    ensureTabsInCorrectSurface();

    const calSec = document.getElementById('calendar-section');
    const tlSec = document.getElementById('timeline-visualizer-section');
    const listSec = document.getElementById('fulllist-wrapper');
    const matSec = document.getElementById('tab-materials');
    const prefSec = document.getElementById('tab-filters');
    const suppSec = document.getElementById('tab-support');

    // Reset active states on rail
    if (railBtnPref) railBtnPref.classList.remove('active');
    if (railBtnMat) railBtnMat.classList.remove('active');
    [railModeTimeline, railModeCalendar, railModeList].forEach(b => {
      if (b) b.classList.toggle('active', b.dataset.mode === mode);
    });

    if (calSec) calSec.style.display = 'none';
    if (tlSec) tlSec.style.display = 'none';
    if (listSec) listSec.style.display = 'none';
    if (matSec) { matSec.style.display = 'none'; matSec.classList.remove('active'); }
    if (prefSec) { prefSec.style.display = 'none'; prefSec.classList.remove('active'); }
    if (suppSec) { suppSec.style.display = 'none'; suppSec.classList.remove('active'); }

    // Toggle surface mode classes on body for scoped styling
    document.body.classList.toggle('mode-materials', mode === 'materials');
    document.body.classList.toggle('mode-preferences', mode === 'preferences');
    document.body.classList.toggle('mode-calendar', mode === 'calendar');
    document.body.classList.toggle('mode-timeline', mode === 'timeline');
    document.body.classList.toggle('mode-list', mode === 'list');

    const monthHeading = document.getElementById('fulltab-month-heading');
    const calPrevBtn = document.getElementById('btn-cal-prev');
    const calNextBtn = document.getElementById('btn-cal-next');
    const calTodayBtn = document.getElementById('btn-cal-today');
    const weekPill = document.getElementById('fulltab-week-pill');

    const isNonCalendar = (mode === 'materials' || mode === 'preferences');
    if (calPrevBtn) calPrevBtn.style.display = isNonCalendar ? 'none' : '';
    if (calNextBtn) calNextBtn.style.display = isNonCalendar ? 'none' : '';
    if (calTodayBtn) calTodayBtn.style.display = isNonCalendar ? 'none' : '';
    if (weekPill) weekPill.style.display = isNonCalendar ? 'none' : '';

    if (mode === 'timeline') {
      if (tlSec) tlSec.style.display = 'flex';
      if (monthHeading) {
        monthHeading.textContent = (new Date()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
      }
      renderTimelineVisualizer();
    } else if (mode === 'calendar') {
      if (calSec) calSec.style.display = 'flex';
      renderCalendarView(calCurrentYear, calCurrentMonth);
    } else if (mode === 'list') {
      if (listSec) listSec.style.display = 'flex';
      fullListCurrentDate = new Date();
      if (monthHeading) {
        monthHeading.textContent = fullListCurrentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
      }
      renderFullListMode(fullListCurrentDate, 1);
    } else if (mode === 'materials') {
      if (railBtnMat) railBtnMat.classList.add('active');
      if (matSec) {
        matSec.style.display = 'flex';
        matSec.classList.add('active');
      }
      if (monthHeading) monthHeading.textContent = 'COURSE MATERIALS & DOWNLOADS';
      renderCourseTreeShells();
      const needsMaterialScan = coursesData.length === 0 || coursesData.some(c => !c.loaded && (!c.sections || c.sections.length === 0));
      if (needsMaterialScan) {
        findSpectrumTab().then(t => { if (t) scanCourses(t); });
      }
    } else if (mode === 'preferences') {
      if (railBtnPref) railBtnPref.classList.add('active');
      if (prefSec) {
        prefSec.style.display = 'flex';
        prefSec.classList.add('active');
      }
      if (monthHeading) monthHeading.textContent = 'PREFERENCES & AUTOMATION';
      renderOccPreferencesTable();
      renderHiddenAttendanceSettings();
      if (typeof updatePreferencesStorageStats === 'function') updatePreferencesStorageStats();
    }
  }

  if (railModeTimeline) railModeTimeline.addEventListener('click', () => setFullTabMode('timeline'));
  if (railModeCalendar) railModeCalendar.addEventListener('click', () => setFullTabMode('calendar'));
  if (railModeList) railModeList.addEventListener('click', () => setFullTabMode('list'));

  // Left Rail Top Utilities (Preferences & Materials)
  const railBtnPref = document.getElementById('rail-btn-pref');
  const railBtnMat = document.getElementById('rail-btn-mat');
  if (railBtnPref) railBtnPref.addEventListener('click', () => setFullTabMode('preferences'));
  if (railBtnMat) railBtnMat.addEventListener('click', () => setFullTabMode('materials'));

  // Initialize Full Tab Mode on load
  if (isFullTab) {
    const urlParams = new URLSearchParams(window.location.search);
    const initialMode = urlParams.get('mode') === 'full' ? (urlParams.get('view') || 'calendar') : 'calendar';
    setFullTabMode(initialMode);
  }

  // Calendar Sidebar Close Button
  const btnCloseCalSidebar = document.getElementById('btn-close-cal-sidebar');
  if (btnCloseCalSidebar) {
    btnCloseCalSidebar.addEventListener('click', () => {
      const sidebar = document.getElementById('cal-detail-sidebar');
      const calSection = document.getElementById('calendar-section');
      if (sidebar) sidebar.style.display = 'none';
      if (calSection) calSection.classList.remove('has-sidebar');
      if (calGrid) {
        calGrid.querySelectorAll('.cal-grid-cell').forEach(c => c.classList.remove('is-selected'));
      }
    });
  }

  // Popup Dynamic Sticky Date Observer
  function initStickyDateObserver() {
    const stream = document.getElementById('popup-cards-stream');
    if (!stream) return;

    const dayEl = document.getElementById('sticky-box-day');
    const monthEl = document.getElementById('sticky-box-month');
    const weekdayEl = document.getElementById('sticky-box-weekday');
    const semweekEl = document.getElementById('sticky-box-semweek');

    // Also update expanded cal header date when scrolling
    const calExpMainDate = document.getElementById('cal-exp-main-date');
    const calExpSemweek = document.getElementById('cal-exp-semweek');

    let lastObservedDateKey = '';
    const updateFromCard = (card) => {
      if (!card) return;
      const key = card.dataset.dateKey;
      if (!key) return;
      if (key === lastObservedDateKey) return;
      const parts = key.split('-').map(Number);
      if (parts.length < 3 || isNaN(parts[0])) return;
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      if (isNaN(d.getTime())) return;

      lastObservedDateKey = key;

      // Date update without reflow thrashing
      const stickyCard = document.querySelector('#popup-sticky-date-box .sticky-date-card') || document.querySelector('.split-date-sticky-box .sticky-date-card');

      const dayStr = String(d.getDate()).padStart(2, '0');
      const monStr = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const wdStr = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      const umInfo = getUmAcademicInfo(d);

      if (dayEl) dayEl.textContent = dayStr;
      if (monthEl) monthEl.textContent = monStr;
      if (weekdayEl) weekdayEl.textContent = wdStr;
      if (semweekEl) semweekEl.textContent = `SEM WK ${umInfo.weekNum}`;

      // Keep expanded hero header in sync
      updateDateHeroHeader(d);
      if (calExpSemweek) {
        calExpSemweek.textContent = `SEM WK ${String(umInfo.weekNum).padStart(2, '0')}`;
      }
    };

    if (!stream._hasScrollObserver) {
      stream._hasScrollObserver = true;
      stream.addEventListener('scroll', () => {
        const cards = stream.querySelectorAll('.spectrum-card');
        const streamRect = stream.getBoundingClientRect();
        for (const card of cards) {
          const rect = card.getBoundingClientRect();
          if (rect.bottom >= streamRect.top + 30) {
            updateFromCard(card);
            break;
          }
        }
        if (typeof updateActiveSpineNode === 'function') {
          updateActiveSpineNode();
        }
      }, { passive: true });
    }

    // Set initial date from first visible card or current date
    const firstCard = stream.querySelector('.spectrum-card');
    if (firstCard) {
      updateFromCard(firstCard);
    } else {
      const now = new Date();
      const dayStr = String(now.getDate()).padStart(2, '0');
      const monStr = now.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const wdStr = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      if (dayEl) dayEl.textContent = dayStr;
      if (monthEl) monthEl.textContent = monStr;
      if (weekdayEl) weekdayEl.textContent = wdStr;
      const umInfo = getUmAcademicInfo(now);
      if (semweekEl) semweekEl.textContent = `SEM WK ${umInfo.weekNum}`;
      updateDateHeroHeader(now);
      if (calExpSemweek) calExpSemweek.textContent = `SEM WK ${String(umInfo.weekNum).padStart(2, '0')}`;
    }
  }

  // ========================================================
  // SIDEBAR RAIL: MINI-CALENDAR STATE & CONTROLLER
  // ========================================================
  let miniCalYear = new Date().getFullYear();
  let miniCalMonth = new Date().getMonth(); // 0-indexed
  let miniCalSelectedDateKey = '';       // e.g. "2026-10-21"
  let miniCalIndicatorMode = 'dots';     // 'dots' | 'count'
  let isCalendarExpanded = false;        // collapsed vs expanded
  let activeDateFilter = null;           // null = show all, string = YYYY-MM-DD filter


  // ── True Zero-Redundancy Course Controller & Monograms ──
  let popupSidebarMode = 'calendar'; // 'calendar' | 'courses'
  let selectedCourseFilterId = null;
  let selectedCourseFilterCode = null;

  function isActivityActive(type) {
    const map = {
      notice: 'dock-btn-notice',
      tutorial: 'dock-btn-tutorial',
      assignment: 'dock-btn-tutorial',
      attendance: 'dock-btn-attendance'
    };
    const btn = document.getElementById(map[type]);
    if (!btn) return true;
    return btn.classList.contains('active');
  }

  function generateCourseAcronym(name, code) {
    if (!name && !code) return 'CO';
    let clean = (name || '').replace(/^[A-Z]{2,4}\d{4}(?:\/[A-Z]{2,4}\d{4})?\s*[-–:]*\s*/i, '').trim();
    if (!clean) clean = code || '';
    const cleanLower = clean.toLowerCase();
    if (cleanLower.includes('database')) return 'DS';
    if (cleanLower.includes('systems analysis') || cleanLower.includes('sad')) return 'SAD';
    if (cleanLower.includes('mobile')) return 'MAD';
    if (cleanLower.includes('machine learning')) return 'ML';
    if (cleanLower.includes('project management') || cleanLower.includes('project mgmt')) return 'PM';
    if (cleanLower.includes('thinking skills')) return 'TS';
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

  function formatRelativeCadence(dateInput, type = 'assignment') {
    if (!dateInput) return '';
    const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const isToday = d.toDateString() === now.toDateString();

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    if (type === 'notice') {
      if (diffMs > 0 && diffMs < 3600000) return `${timeStr} (Just now)`;
      if (diffHours >= -24 && diffHours < 0) {
        const absH = Math.abs(diffHours);
        return `${timeStr} (${absH}h ago)`;
      }
      if (isToday) return `${timeStr} (Today)`;
      if (isYesterday) return `${timeStr} (Yesterday)`;
      const day = d.getDate();
      const mon = d.toLocaleDateString('en-US', { month: 'short' });
      return `${day} ${mon} · ${Math.abs(diffDays)}d ago`;
    }

    if (type === 'attendance') {
      const day = d.getDate();
      const mon = d.toLocaleDateString('en-US', { month: 'short' });
      const timeRange = (typeof dateInput === 'object' && dateInput.timeWindow) || timeStr;
      if (isToday) return `TODAY ${timeRange}`;
      return `${day} ${mon} ${timeRange}`;
    }

    // Default: Assignment / Quiz
    if (diffMs < 0) {
      const absD = Math.abs(diffDays);
      if (absD === 0) return `OVERDUE (TODAY ${timeStr})`;
      return `OVERDUE (${absD}D AGO)`;
    }
    if (isToday) {
      if (diffHours <= 6 && diffHours > 0) return `DUE IN ${diffHours}H · ${timeStr} DEADLINE`;
      return `DUE TODAY ${timeStr}`;
    }
    if (isTomorrow) return `DUE TOMORROW ${timeStr}`;
    if (diffDays <= 7) return `DUE IN ${diffDays}D · ${timeStr}`;
    const day = d.getDate();
    const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `DUE ${day} ${mon} ${timeStr}`;
  }

  function getPopupCoursesList() {
    const map = new Map();

    const registerCourse = (cid, code, name, occ) => {
      if (!cid) return null;
      const key = String(cid);
      if (!map.has(key)) {
        const rawName = (name || '').replace(/[\r\n\t]+/g, ' ').replace(/^Course name\s*/i, '').trim();
        const codeMatch = rawName.match(/\b([A-Z]{2,4}\d{4}(?:\s*[\/–-]\s*[A-Z]{2,4}\d{4})?)\b/);
        const cCode = code || (codeMatch ? codeMatch[0] : 'COURSE');
        const cleanName = (typeof cleanDisplayCourseName === 'function') ? cleanDisplayCourseName(rawName, cCode) : rawName;
        map.set(key, {
          courseId: key,
          courseCode: cCode,
          courseName: cleanName || rawName,
          userOcc: occ || courseOccs[key] || defaultOcc || '',
          lecturer: '',
          annCount: 0,
          taskCount: 0,
          pendingCount: 0,
          submittedCount: 0,
          attCount: 0
        });
      }
      return map.get(key);
    };

    // 1. Enrolled courses from coursesData
    if (Array.isArray(coursesData)) {
      coursesData.forEach(c => {
        if (c && c.id) registerCourse(c.id, c.code, c.name, courseOccs[c.id]);
      });
    }

    // 2. Discoveries
    if (Array.isArray(allCoursesDiscovered)) {
      allCoursesDiscovered.forEach(c => {
        if (c && c.id) registerCourse(c.id, c.code, c.name, courseOccs[c.id]);
      });
    }

    // 3. Scan announcementsData
    announcementsData.forEach(ann => {
      const cid = String(ann.courseId || 'general');
      if (cid !== 'general') {
        const item = registerCourse(cid, ann.courseCode, ann.courseName, null);
        if (item) {
          item.annCount++;
          if (!item.lecturer && ann.author) item.lecturer = ann.author;
        }
      }
    });

    // 4. Scan assignmentsData
    assignmentsData.forEach(assign => {
      const cid = String(assign.courseId || 'general');
      if (cid !== 'general') {
        const item = registerCourse(cid, assign.courseCode, assign.courseName, null);
        if (item) {
          const matchesOcc = (typeof isAssignmentMatchingOcc === 'function') ? isAssignmentMatchingOcc(assign, item.userOcc) : true;
          if (matchesOcc) {
            item.taskCount++;
            const isSubmitted = Boolean(assign.hasSubmitted || (assign.statusText && assign.statusText.toLowerCase().includes('submitted')));
            if (isSubmitted) {
              item.submittedCount++;
            } else {
              item.pendingCount++;
            }
          }
        }
      }
    });

    // 5. Scan attendancesData
    attendancesData.forEach(att => {
      if (typeof isAttendanceHidden === 'function' && isAttendanceHidden(att)) return;
      const cid = String(att.courseId || 'general');
      if (cid !== 'general') {
        const item = registerCourse(cid, att.courseCode, att.courseName, att.userOcc);
        if (item) {
          item.attCount++;
          if (!item.userOcc && att.userOcc) item.userOcc = att.userOcc;
        }
      }
    });

    return Array.from(map.values());
  }

  function isActivityForCourse(item, cInfo) {
    if (!item || !cInfo) return false;

    // 1. Strict numeric courseId match
    if (cInfo.courseId && item.courseId && String(cInfo.courseId) !== 'general' && String(item.courseId) !== 'general') {
      if (String(cInfo.courseId) === String(item.courseId)) return true;
      // If both items have different valid course IDs, they belong to different courses!
      return false;
    }

    // 2. Exact course code match (ignoring generic placeholder tokens like 'COURSE', 'ATT', 'GENERAL')
    const genericCodes = new Set(['COURSE', 'ATT', 'GENERAL', 'ANNOUNCEMENT', 'ASSIGNMENT']);
    if (cInfo.courseCode && item.courseCode) {
      const cUpper = cInfo.courseCode.trim().toUpperCase();
      const iUpper = item.courseCode.trim().toUpperCase();
      if (!genericCodes.has(cUpper) && !genericCodes.has(iUpper)) {
        if (cUpper === iUpper) return true;
        const cParts = cUpper.split(/[\/\s,-]+/).map(s => s.trim()).filter(s => s.length >= 4 && !genericCodes.has(s));
        const itemParts = iUpper.split(/[\/\s,-]+/).map(s => s.trim()).filter(s => s.length >= 4 && !genericCodes.has(s));
        if (cParts.length > 0 && itemParts.length > 0 && cParts.some(cp => itemParts.includes(cp))) return true;
      }
    }

    // 3. Fallback match by exact normalized course title (must not be empty or generic)
    if (cInfo.courseName && item.courseName) {
      const cNorm = cInfo.courseName.trim().toLowerCase();
      const iNorm = item.courseName.trim().toLowerCase();
      if (cNorm.length > 3 && cNorm === iNorm) return true;
    }

    return false;
  }

  // ── Unified Swiss Academic Editorial Assignment Card View Model (Variant B · Option 1) ──
  function computeAssignmentCardViewModel(assign) {
    const isSubmitted = Boolean(
      assign.isSubmitted || 
      assign.hasSubmitted || 
      (assign.statusText && /submitted|dihantar/i.test(assign.statusText))
    );

    const rawD = assign.dueDate;
    let d = (rawD instanceof Date) ? rawD : (rawD ? new Date(rawD) : null);
    if (!d || isNaN(d.getTime())) {
      if (typeof resolveAssignmentDate === 'function') {
        d = resolveAssignmentDate(assign);
      }
    }

    const now = new Date();
    const hasValidDate = Boolean(d && !isNaN(d.getTime()));
    const isOverdue = Boolean(!isSubmitted && (assign.isOverdue || (hasValidDate && d.getTime() < now.getTime())));

    // 1. Unified Top Baseline: Course Code / Title · OCC
    const code = (assign.courseCode || 'TASK').trim();
    const rawName = (assign.courseName || '').trim();
    const cleanName = (typeof cleanDisplayCourseName === 'function') ? cleanDisplayCourseName(rawName, code) : rawName;
    const headerLeftText = cleanName 
      ? `${code} / ${cleanName.toUpperCase()}`
      : code;

    const rawOcc = assign.userOcc || (assign.courseId && courseOccs[assign.courseId]) || defaultOcc || '';
    let occFormatted = '';
    if (rawOcc) {
      const numMatch = String(rawOcc).match(/\d+/);
      if (numMatch) {
        occFormatted = `OCC-${String(parseInt(numMatch[0], 10)).padStart(2, '0')}`;
      } else {
        occFormatted = String(rawOcc).toUpperCase();
      }
    }

    // 2. Assignment Title
    const title = assign.title || assign.name || 'Assignment';

    // 3. Unified Bottom Baseline (Indicator · Token · Timestamp · Inline 28px CTA)
    let dotClass = 'dot-upcoming';
    let tokenClass = 'token-upcoming';
    let tokenText = 'UPCOMING';
    let btnClass = 'btn-assign-normal';
    let btnText = 'Submit →';

    if (isSubmitted) {
      dotClass = 'dot-submitted';
      tokenClass = 'token-submitted';
      tokenText = 'SUBMITTED';
      btnClass = 'btn-assign-submitted';
      btnText = 'View →';
    } else if (isOverdue) {
      dotClass = 'dot-overdue';
      tokenClass = 'token-overdue';
      let daysOverdue = 1;
      if (hasValidDate) {
        daysOverdue = Math.max(1, Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
      } else if (assign.timeRemaining) {
        const m = String(assign.timeRemaining).match(/(\d+)\s*d/i);
        if (m) daysOverdue = parseInt(m[1], 10);
      }
      tokenText = `OVERDUE ${daysOverdue}D`;
      btnClass = 'btn-assign-overdue';
      btnText = 'Submit Late →';
    } else if (hasValidDate) {
      const diffMs = d.getTime() - now.getTime();
      const diffHours = Math.round(diffMs / (1000 * 60 * 60));
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffHours <= 2) {
        tokenText = `DUE IN ${Math.max(1, diffHours)}H`;
        dotClass = 'dot-overdue';
        tokenClass = 'token-overdue';
      } else if (diffHours <= 24) {
        tokenText = 'DUE TODAY';
        dotClass = 'dot-overdue';
        tokenClass = 'token-overdue';
      } else if (diffDays === 1) {
        tokenText = 'DUE TOMORROW';
      } else {
        tokenText = `DUE IN ${diffDays}D`;
      }
    }

    // Format timestamp (e.g., "Wed 28 Oct, 23:00")
    let timestampText = '';
    if (hasValidDate) {
      const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
      const day = String(d.getDate()).padStart(2, '0');
      const mon = d.toLocaleDateString('en-US', { month: 'short' });
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      timestampText = `${wd} ${day} ${mon}, ${hours}:${mins}`;
    } else if (assign.dueDateStr) {
      timestampText = assign.dueDateStr;
    }

    const submitUrl = assign.viewUrl || assign.url || 'https://spectrum.um.edu.my';
    const dateKey = hasValidDate ? formatDateKey(d) : formatDateKey(now);
    const rawId = assign.id || '';

    let stateClass = '';
    if (isSubmitted) stateClass = 'is-submitted';
    else if (isOverdue) stateClass = 'is-overdue';

    return {
      rawId,
      dateKey,
      stateClass,
      headerLeftText,
      occFormatted,
      title,
      dotClass,
      tokenClass,
      tokenText,
      timestampText,
      btnClass,
      btnText,
      submitUrl
    };
  }

  function renderUnifiedAssignmentCardHtml(vm) {
    return `
      <div class="spectrum-card card-assignment assignment-card scoped-card scoped-card-assignment ${vm.stateClass}" data-assign-id="${escapeHtml(vm.rawId)}" data-id="${escapeHtml(vm.rawId)}" data-date-key="${escapeHtml(vm.dateKey)}">
        <div class="card-bounded-icon icon-box-assignment ${vm.stateClass}">
          ${MINI_ICONS.assignment}
        </div>
        <div class="card-content-wrap">
          <div class="assign-row-header">
            <div class="assign-header-left" title="${escapeHtml(vm.headerLeftText)}">${escapeHtml(vm.headerLeftText)}</div>
            ${vm.occFormatted ? `
              <div class="assign-header-right">
                <span class="assign-occ-pill">${escapeHtml(vm.occFormatted)}</span>
              </div>
            ` : ''}
          </div>
          <div class="assign-row-title">
            <span class="assign-title-text" title="${escapeHtml(vm.title)}">${escapeHtml(vm.title)}</span>
          </div>
          <div class="assign-row-footer">
            <div class="assign-footer-left">
              <span class="assign-dot ${vm.dotClass}">●</span>
              <span class="assign-token ${vm.tokenClass}">${escapeHtml(vm.tokenText)}</span>
              ${vm.timestampText ? `
                <span class="assign-footer-sep">·</span>
                <span class="assign-timestamp">${escapeHtml(vm.timestampText)}</span>
              ` : ''}
            </div>
            <div class="assign-footer-right">
              <a href="${escapeHtml(vm.submitUrl)}" target="_blank" class="btn-assign-action ${vm.btnClass}" title="Open assignment submission in SPeCTRUM">
                ${escapeHtml(vm.btnText)}
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderScopedAssignmentCard(assign) {
    const vm = computeAssignmentCardViewModel(assign);
    return renderUnifiedAssignmentCardHtml(vm);
  }

  // ── Unified Swiss Academic Editorial Notice Card View Model ──
  function computeNoticeCardViewModel(ann) {
    if (!ann) return null;
    if (!ann.id) {
      const discId = ann.discussionId || (ann.discussUrl ? ((ann.discussUrl.match(/[?&]d=(\d+)/) || [])[1]) : '');
      ann.id = `ann_${ann.courseId || 'c'}_${discId || (ann.timestamp || Math.random().toString(36).slice(2, 7))}`;
    }

    const d = ann.timestamp ? (ann.timestamp instanceof Date ? ann.timestamp : new Date(ann.timestamp)) : null;
    const dateKey = (d && !isNaN(d.getTime())) ? formatDateKey(d) : formatDateKey(new Date());

    // 1. Top Baseline: Course Code / Title on Left | Date on Right
    const code = (ann.courseCode || 'NOTICE').trim();
    const rawName = (ann.courseName || '').trim();
    const cleanName = (typeof cleanDisplayCourseName === 'function') ? cleanDisplayCourseName(rawName, code) : rawName;
    const headerLeftText = cleanName 
      ? `${code} / ${cleanName.toUpperCase()}`
      : code;

    // Date: e.g. "17 OCT 2026"
    let formattedDate = 'ANNOUNCEMENT';
    if (d && !isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const year = d.getFullYear();
      formattedDate = `${day} ${mon} ${year}`;
    } else if (ann.dateStr) {
      formattedDate = ann.dateStr.toUpperCase();
    }

    // 2. Title
    const title = ann.title || 'Notice';

    // 3. Bottom Baseline: Author on Left | Action on Right
    let rawAuthor = ann.author || 'Course Lecturer';
    if (typeof rawAuthor === 'string') {
      rawAuthor = rawAuthor.split(/\r?\n/)[0].trim();
      rawAuthor = rawAuthor.replace(/\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}.*$/, '');
      rawAuthor = rawAuthor.replace(/[•·.\s]+$/, '').trim();
    }
    const author = rawAuthor || 'Course Lecturer';
    const annId = String(ann.id);

    return {
      rawId: annId,
      dateKey,
      headerLeftText,
      formattedDate,
      title,
      author
    };
  }

  function renderUnifiedNoticeCardHtml(vm) {
    if (!vm) return '';
    return `
      <div class="spectrum-card card-notice announcement-card scoped-card scoped-card-notice" data-ann-id="${escapeHtml(vm.rawId)}" data-date-key="${escapeHtml(vm.dateKey)}">
        <div class="card-bounded-icon icon-box-notice">
          ${MINI_ICONS.notice}
        </div>
        <div class="card-content-wrap">
          <div class="notice-row-header">
            <div class="notice-header-left" title="${escapeHtml(vm.headerLeftText)}">${escapeHtml(vm.headerLeftText)}</div>
            <div class="notice-header-right">
              <span class="notice-dot">●</span>
              <span class="notice-date-text">${escapeHtml(vm.formattedDate)}</span>
            </div>
          </div>
          <div class="notice-row-title">
            <span class="notice-title-text" title="${escapeHtml(vm.title)}">${escapeHtml(vm.title)}</span>
          </div>
          <div class="notice-row-footer">
            <div class="notice-footer-left">
              <span class="notice-type-tag">NOTICE</span>
              <span class="notice-sep">·</span>
              <span class="notice-author" title="${escapeHtml(vm.author)}">${escapeHtml(vm.author)}</span>
            </div>
            <div class="notice-footer-right">
              <button type="button" class="btn-notice-open btn-open-notice" data-ann-id="${escapeHtml(vm.rawId)}" title="Read Announcement in SPeCTRUM Pro">
                Open Full →
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderScopedNoticeCard(ann) {
    const vm = computeNoticeCardViewModel(ann);
    return renderUnifiedNoticeCardHtml(vm);
  }

  // Universal Helper: Robust Time Range and Single Time Parser
  // Handles all Malaysian and international university time formats:
  // e.g. "8.00AM - 10.00AM", "8:00 AM - 10:00 AM", "10:00 - 12:00", "2PM - 4PM", "14:00 - 16:00", "9:00 AM"
  function parseTimeRangeRobust(str) {
    if (!str) return null;
    const s = String(str).trim();

    // 1. AM/PM Range: e.g. "8:00AM - 10:00AM", "8.00AM - 10.00AM", "8.00 AM - 10.00 AM", "2PM - 4PM", "2:00 PM - 4:00 PM"
    const ampmRange = s.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(AM|PM)?\s*(?:[-–—~]|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(AM|PM)/i);
    if (ampmRange) {
      let sh = parseInt(ampmRange[1], 10);
      let sm = parseInt(ampmRange[2] || '0', 10);
      let sAmpm = (ampmRange[3] || '').toUpperCase();
      let eh = parseInt(ampmRange[4], 10);
      let em = parseInt(ampmRange[5] || '0', 10);
      let eAmpm = (ampmRange[6] || '').toUpperCase();

      if (!sAmpm && eAmpm) {
        sAmpm = (sh <= eh) ? eAmpm : (eAmpm === 'PM' ? 'AM' : 'PM');
      }

      if (sAmpm === 'PM' && sh < 12) sh += 12;
      if (sAmpm === 'AM' && sh === 12) sh = 0;
      if (eAmpm === 'PM' && eh < 12) eh += 12;
      if (eAmpm === 'AM' && eh === 12) eh = 0;

      const pad = n => String(n).padStart(2, '0');
      return {
        formatted: `${pad(sh)}:${pad(sm)} — ${pad(eh)}:${pad(em)}`,
        startHour: sh,
        startMin: sm,
        endHour: eh,
        endMin: em
      };
    }

    // 2. 24-hour range: e.g. "14:00 - 16:00", "14.00 - 16.00", "08:30 - 10:30", "08.30 - 10.30"
    const range24 = s.match(/(\d{1,2})[:.](\d{2})\s*(?:[-–—~]|to)\s*(\d{1,2})[:.](\d{2})/);
    if (range24) {
      let sh = parseInt(range24[1], 10);
      let sm = parseInt(range24[2], 10);
      let eh = parseInt(range24[3], 10);
      let em = parseInt(range24[4], 10);

      const pad = n => String(n).padStart(2, '0');
      return {
        formatted: `${pad(sh)}:${pad(sm)} — ${pad(eh)}:${pad(em)}`,
        startHour: sh,
        startMin: sm,
        endHour: eh,
        endMin: em
      };
    }

    // 3. Single time: "8:00 AM", "8.00 AM", "2:00 PM", "2 PM", "14:00", "08:30"
    const singleMatch = s.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(AM|PM)/i) ||
                        s.match(/\b(\d{1,2})[:.](\d{2})\b/);
    if (singleMatch) {
      let sh = parseInt(singleMatch[1], 10);
      let sm = parseInt(singleMatch[2] || '0', 10);
      let ampm = (singleMatch[3] || '').toUpperCase();

      if (ampm === 'PM' && sh < 12) sh += 12;
      if (ampm === 'AM' && sh === 12) sh = 0;

      let eh = (sh + 2) % 24;
      let em = sm;

      const pad = n => String(n).padStart(2, '0');
      return {
        formatted: `${pad(sh)}:${pad(sm)} — ${pad(eh)}:${pad(em)}`,
        startHour: sh,
        startMin: sm,
        endHour: eh,
        endMin: em
      };
    }

    return null;
  }

  // ── Unified Horizontal Compact Attendance Card View Model (~4:1 Ratio) ──
  function computeAttendanceCardViewModel(att, sessionData = {}) {
    const now = new Date();
    const todayKey = formatDateKey(now);
    const targetDateKey = sessionData.dateKey || (typeof activeDateFilter !== 'undefined' && activeDateFilter ? activeDateFilter : todayKey);

    // 1. Resolve matching session for this card
    const matchedSession = Array.isArray(att.sessions)
      ? (att.sessions.find(s => s.dateKey === targetDateKey) || 
         (targetDateKey === todayKey ? att.sessions.find(s => s.isToday) : null))
      : null;

    const session = sessionData.session || matchedSession || att.activeSession || att.nextSession || null;
    const isLive = Boolean(sessionData.isLive || (att.activeSession && (targetDateKey === todayKey)));
    const isVerified = Boolean(
      sessionData.isVerified || 
      (session && (session.isPresent || session.statusType === 'present' || session.statusType === 'submitted')) ||
      att.isAttended || 
      att.status === 'Present' || 
      att.lastRecordedStatus === 'Present'
    );

    const crs = (typeof courses !== 'undefined' && Array.isArray(courses))
      ? courses.find(c => String(c.courseId) === String(att.courseId) || c.courseCode === att.courseCode)
      : null;

    // 2. Multi-source Time Parsing (Course info, Moodle session, activity title)
    const candidateTimeSources = [
      sessionData.timeStr,
      session?.time,
      session?.dateStr,
      session?.desc,
      sessionData.desc,
      crs?.time,
      crs?.schedule,
      crs?.timetable,
      att.activeSession?.time,
      att.activeSession?.desc,
      att.nextSession?.time,
      att.nextSession?.dateStr,
      att.nextSession?.desc,
      att.attTitle,
      att.courseName
    ];

    let parsedTime = null;
    for (const src of candidateTimeSources) {
      if (src && typeof src === 'string') {
        parsedTime = parseTimeRangeRobust(src);
        if (parsedTime) break;
      }
    }

    // Secondary scan across any session in att.sessions if this course has a consistent class time
    if (!parsedTime && Array.isArray(att.sessions)) {
      for (const s of att.sessions) {
        if (s.time || s.dateStr || s.desc) {
          parsedTime = parseTimeRangeRobust(s.time || s.dateStr || s.desc);
          if (parsedTime) break;
        }
      }
    }

    // Default time fallback (only if no times found across all sources)
    const startHour = parsedTime ? parsedTime.startHour : 14;
    const startMin = parsedTime ? parsedTime.startMin : 0;
    const endHour = parsedTime ? parsedTime.endHour : 16;
    const endMin = parsedTime ? parsedTime.endMin : 0;
    const timeRangeStr = parsedTime ? parsedTime.formatted : '14:00 — 16:00';

    // 3. Date, Elapsed & Window Status Calculation
    const targetDate = sessionData.date 
      ? (sessionData.date instanceof Date ? sessionData.date : new Date(sessionData.date)) 
      : (session?.date instanceof Date ? session.date : (targetDateKey ? new Date(targetDateKey + 'T00:00:00') : new Date()));

    const targetDayZero = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const nowDayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayDiff = Math.round((nowDayZero.getTime() - targetDayZero.getTime()) / (24 * 3600 * 1000));

    const startMs = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), startHour, startMin).getTime();
    const endMs = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), endHour, endMin).getTime();
    const totalDurationMs = Math.max(1, endMs - startMs);

    let progressPct = 0;
    let minsLeft = 0;
    let isEnded = false;
    let isFuture = false;
    let endedMins = 0;

    if (now.getTime() < startMs) {
      progressPct = 0;
      isFuture = true;
    } else if (now.getTime() >= startMs && now.getTime() <= endMs) {
      progressPct = Math.min(100, Math.max(8, Math.round(((now.getTime() - startMs) / totalDurationMs) * 100)));
      minsLeft = Math.max(1, Math.round((endMs - now.getTime()) / 60000));
    } else {
      progressPct = 100;
      isEnded = true;
      endedMins = Math.round((now.getTime() - endMs) / 60000);
    }

    if (isLive) {
      isEnded = false;
      isFuture = false;
      if (progressPct === 0) progressPct = 30;
      if (progressPct >= 100) progressPct = 85;
      if (minsLeft <= 0) minsLeft = 14;
    }

    // 4. Course & OCC
    const code = att.courseCode || sessionData.courseCode || 'COURSE';
    const rawName = att.courseName || sessionData.courseName || code;
    const cleanName = (typeof cleanDisplayCourseName === 'function') ? cleanDisplayCourseName(rawName, code) : rawName;
    const occRaw = att.userOcc || sessionData.userOcc || courseOccs[att.courseId || sessionData.cid] || defaultOcc || '01';
    const occNum = String(occRaw).replace(/^occ\s*/i, '').trim();

    // 5. Action / Status Routing
    const rawAttId = att.id || sessionData.cardId || '';
    const cid = att.courseId || sessionData.cid || '';
    const takeUrl = sessionData.takeUrl || att.activeSession?.takeUrl || att.attUrl || 'https://spectrum.um.edu.my';
    const sesskey = sessionData.sesskey || att.activeSession?.sesskey || '';
    const statusId = sessionData.statusId || att.activeSession?.presentStatusId || '';
    const subType = sessionData.subType || att.subType || '';
    const requiresPassword = Boolean(sessionData.requiresPassword || att.activeSession?.requiresPassword || session?.requiresPassword);

    let stateClass = '';
    let statusPillHtml = '';
    let stateBadgeHtml = '';
    let windowSubHtml = '';
    let actionBtnHtml = '';

    const pad = n => String(n).padStart(2, '0');

    if (isLive) {
      stateClass = 'state-open';
      if (minsLeft > 0 && minsLeft <= 30) {
        statusPillHtml = `<span class="att-urgent-pill">${minsLeft}M LEFT</span>`;
      } else {
        statusPillHtml = `<span class="att-status-pill pill-active">WINDOW ACTIVE</span>`;
      }

      if (requiresPassword) {
        stateBadgeHtml = `<span class="att-state-badge state-password">🔒 PASSWORD</span>`;
        actionBtnHtml = `
          <button type="button" class="btn-att-action btn-att-black att-btn-pin"
            data-att-id="${escapeHtml(rawAttId)}"
            data-card-id="${escapeHtml(rawAttId)}"
            data-course-id="${escapeHtml(cid)}"
            data-take-url="${escapeHtml(takeUrl)}"
            data-sesskey="${escapeHtml(sesskey)}"
            data-status-id="${escapeHtml(statusId)}"
            data-sub-type="${escapeHtml(subType)}"
            data-course-code="${escapeHtml(code)}"
            data-course-name="${escapeHtml(rawName)}"
            title="Enter Attendance PIN">
            🔑 Enter PIN
          </button>
        `;
      } else {
        stateBadgeHtml = `<span class="att-state-badge state-open"><span class="dot-green">●</span> OPEN</span>`;
        actionBtnHtml = `
          <button type="button" class="btn-att-action btn-att-black att-btn-direct-take"
            data-att-id="${escapeHtml(rawAttId)}"
            data-card-id="${escapeHtml(rawAttId)}"
            data-course-id="${escapeHtml(cid)}"
            data-att-url="${escapeHtml(takeUrl)}"
            data-sesskey="${escapeHtml(sesskey)}"
            data-status-id="${escapeHtml(statusId)}"
            data-sub-type="${escapeHtml(subType)}"
            data-course-code="${escapeHtml(code)}"
            data-course-name="${escapeHtml(rawName)}"
            title="Take attendance directly in SPeCTRUM Pro">
            ⚡ Take Attendance
          </button>
        `;
      }
    } else if (isVerified) {
      stateClass = 'state-recorded';
      statusPillHtml = `<span class="att-status-pill pill-recorded">RECORDED</span>`;
      stateBadgeHtml = '';
      windowSubHtml = `<span class="att-window-sub">Attended ✓</span>`;
      actionBtnHtml = `<span class="btn-att-action btn-att-present">✓ Present</span>`;
    } else if (isEnded) {
      stateClass = 'state-ended';
      statusPillHtml = `<span class="att-status-pill">ENDED</span>`;
      stateBadgeHtml = `<span class="att-state-badge state-locked">LOCKED</span>`;

      let endedLabel = 'Session ended';
      if (dayDiff > 0) {
        // Session was on a past day
        endedLabel = (dayDiff === 1) ? 'Closed · 1d ago' : `Closed · ${dayDiff}d ago`;
      } else if (endedMins > 0) {
        // Session ended earlier today
        if (endedMins < 60) {
          endedLabel = `Ended ${endedMins}m ago`;
        } else {
          const hrs = Math.round(endedMins / 60);
          endedLabel = `Ended ${hrs}h ago`;
        }
      }
      windowSubHtml = `<span class="att-window-sub">${endedLabel}</span>`;
      actionBtnHtml = `<a href="${escapeHtml(takeUrl)}" target="_blank" class="btn-att-action btn-att-faint" title="Open attendance in SPeCTRUM">Check Portal ↗</a>`;
    } else if (isFuture) {
      stateClass = '';
      statusPillHtml = `<span class="att-status-pill">SCHEDULED</span>`;
      stateBadgeHtml = `<span class="att-state-badge state-locked">SCHEDULED</span>`;
      let upcomingLabel = `Opens at ${pad(startHour)}:${pad(startMin)}`;
      if (dayDiff < 0) {
        const absDays = Math.abs(dayDiff);
        upcomingLabel = (absDays === 1) 
          ? `Tomorrow · ${pad(startHour)}:${pad(startMin)}` 
          : `In ${absDays}d · ${pad(startHour)}:${pad(startMin)}`;
      }
      windowSubHtml = `<span class="att-window-sub">${upcomingLabel}</span>`;
      actionBtnHtml = `<a href="${escapeHtml(takeUrl)}" target="_blank" class="btn-att-action btn-att-wireframe" title="Open attendance in SPeCTRUM">Open SPeCTRUM ↗</a>`;
    }

    return {
      stateClass,
      timeRangeStr,
      statusPillHtml,
      stateBadgeHtml,
      code,
      cleanName,
      occNum,
      windowSubHtml,
      progressPct,
      actionBtnHtml,
      rawAttId,
      cid,
      dateKey: targetDateKey
    };
  }

  function renderUnifiedAttendanceCardHtml(vm) {
    return `
      <div class="spectrum-card card-attendance attendance-card ${vm.stateClass}" id="att-card-${escapeHtml(vm.rawAttId)}" data-att-id="${escapeHtml(vm.rawAttId)}" data-course-id="${escapeHtml(vm.cid)}" data-date-key="${escapeHtml(vm.dateKey)}">
        <div class="card-bounded-icon icon-box-attendance">
          ${MINI_ICONS.attendance}
        </div>
        <div class="card-content-wrap">
          <div class="att-row-header">
            <div class="att-header-left">
              <span class="att-code-pill">${escapeHtml(vm.code)}</span>
              <span class="att-header-sep">/</span>
              <span class="att-course-title" title="${escapeHtml(vm.cleanName)}">${escapeHtml(vm.cleanName)}</span>
            </div>
            <div class="att-header-right">
              ${vm.stateBadgeHtml}
              <span class="att-occ-tag">OCC ${escapeHtml(vm.occNum)}</span>
            </div>
          </div>
          <div class="att-row-hero">
            <div class="att-hero-left">
              <span class="att-time-hero">${escapeHtml(vm.timeRangeStr)}</span>
              ${vm.statusPillHtml}
            </div>
          </div>
          <div class="att-row-action">
            <div class="att-progress-section">
              <div class="att-progress-header">
                <span class="att-window-label">Check-In Window</span>
                ${vm.windowSubHtml}
              </div>
              <div class="att-progress-track">
                <div class="att-progress-fill" style="width: ${vm.progressPct}%;"></div>
              </div>
            </div>
            <div class="att-action-wrap">
              ${vm.actionBtnHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderScopedAttendanceCard(data) {
    const att = data.att || data;
    const vm = computeAttendanceCardViewModel(att, data);
    return renderUnifiedAttendanceCardHtml(vm);
  }

  function updateActiveSpineNode() {
    // Collect all visible date groups across feeds
    const groups = Array.from(document.querySelectorAll('.spine-date-group')).filter(g => g.offsetParent !== null);
    if (!groups.length) return;

    const stream = document.getElementById('popup-cards-stream') || document.querySelector('.split-cards-stream');
    const streamRect = stream ? stream.getBoundingClientRect() : { top: 0, height: window.innerHeight };
    const focalLine = streamRect.top + 70;

    let activeGroup = null;
    for (const g of groups) {
      const r = g.getBoundingClientRect();
      if (r.bottom >= focalLine) {
        activeGroup = g;
        break;
      }
    }

    if (stream && (stream.scrollTop + stream.clientHeight >= stream.scrollHeight - 15)) {
      activeGroup = groups[groups.length - 1];
    }

    if (!activeGroup && groups.length > 0) {
      activeGroup = groups[0];
    }

    groups.forEach(g => {
      const isActive = (g === activeGroup);
      g.classList.toggle('is-active', isActive);
      const dot = g.querySelector('.spine-node-dot');
      if (dot) dot.classList.toggle('is-active', isActive);
    });
  }

  function renderByCourseScopedFeed() {
    const feedEl = document.getElementById('bycourse-activities-feed');
    if (!feedEl) return;

    const courses = getPopupCoursesList();
    let cInfo = courses.find(c => 
      (selectedCourseFilterId && String(c.courseId) === String(selectedCourseFilterId)) ||
      (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode)
    );

    // If no course selected, pick the first course by default
    if (!cInfo && courses.length > 0) {
      cInfo = courses[0];
      selectedCourseFilterId = cInfo.courseId;
      selectedCourseFilterCode = cInfo.courseCode;
      renderPopupMonograms();
    }

    const scopeBar = document.getElementById('popup-focused-scope-bar');
    const scopeCode = document.getElementById('popup-focused-scope-code');
    const scopeOcc = document.getElementById('popup-focused-scope-occ');
    const scopeCount = document.getElementById('popup-focused-scope-count');
    const scopeName = document.getElementById('popup-focused-scope-name');
    const scopeInstructor = document.getElementById('popup-focused-scope-instructor');

    if (!cInfo) {
      if (scopeBar) scopeBar.style.display = 'none';
      feedEl.innerHTML = `<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px;">No courses available</div>`;
      feedEl.style.display = 'flex';
      return;
    }

    if (scopeBar) scopeBar.style.display = 'flex';
    if (scopeCode) scopeCode.textContent = cInfo.courseCode;
    let occClean = cInfo.userOcc ? String(cInfo.userOcc).replace(/^occ\s*/i, '').trim() : '';
    if (scopeOcc) {
      scopeOcc.textContent = occClean ? `OCC ${occClean}` : '';
      scopeOcc.style.display = occClean ? 'inline-block' : 'none';
    }
    if (scopeName) scopeName.textContent = cInfo.courseName;
    if (scopeInstructor) {
      scopeInstructor.textContent = cInfo.lecturer || 'Course Instructor · Faculty of Computer Science & IT';
    }

    // Gather activities for this course
    const showNotice = isActivityActive('notice');
    const showTasks = isActivityActive('tutorial');
    const showAtt = isActivityActive('attendance');

    const matchedAnns = showNotice ? announcementsData.filter(a => isActivityForCourse(a, cInfo)) : [];
    const matchedAssigns = showTasks ? assignmentsData.filter(a => {
      if (!isActivityForCourse(a, cInfo)) return false;
      return (typeof isAssignmentMatchingOcc === 'function') ? isAssignmentMatchingOcc(a, cInfo.userOcc) : true;
    }) : [];
    const matchedAtt = showAtt ? attendancesData.filter(a => {
      if (typeof isAttendanceHidden === 'function' && isAttendanceHidden(a)) return false;
      return isActivityForCourse(a, cInfo);
    }) : [];

    // Build unified chronological timeline events
    const todayKey = formatDateKey(new Date());
    const nowZero = new Date();
    nowZero.setHours(0, 0, 0, 0);
    const nowTime = nowZero.getTime();
    const allEvents = [];

    // 1. Assignments
    matchedAssigns.forEach(assign => {
      let d = assign.dueDate ? (assign.dueDate instanceof Date ? assign.dueDate : new Date(assign.dueDate)) : null;
      if (!d || isNaN(d.getTime())) d = new Date();
      allEvents.push({
        type: 'assignment',
        date: d,
        dateKey: formatDateKey(d),
        data: assign
      });
    });

    // 2. Attendance (Active session + scheduled/past sessions from att.sessions)
    matchedAtt.forEach(att => {
      const typeInfo = getAttendanceTypeInfo(att, att.attTitle || '');
      let sessionsAdded = 0;

      // Active live session right now
      if (att.activeSession) {
        allEvents.push({
          type: 'attendance',
          date: new Date(),
          dateKey: todayKey,
          data: {
            att,
            isLive: true,
            title: cleanSessionDesc(att.activeSession.desc || att.attTitle || 'Active Class Session', typeInfo.label),
            timeStr: extractOnlyTime(att.activeSession.time || '') || 'Active Now',
            isVerified: false,
            statusLabel: att.activeSession.requiresPassword ? '🔑 PIN Required' : '🟢 Active Session',
            takeUrl: att.activeSession.takeUrl || att.attUrl,
            requiresPassword: att.activeSession.requiresPassword,
            sesskey: att.activeSession.sesskey,
            statusId: att.activeSession.presentStatusId,
            subType: att.subType || ''
          }
        });
        sessionsAdded++;
      }

      // Past & upcoming sessions parsed from Moodle
      if (Array.isArray(att.sessions) && att.sessions.length > 0) {
        att.sessions.forEach(sess => {
          if (sess.isToday && att.activeSession) return; // avoid duplicate with activeSession

          const rawD = sess.date;
          const d = (rawD instanceof Date && !isNaN(rawD.getTime()))
            ? rawD
            : (rawD && !isNaN(new Date(rawD).getTime()) ? new Date(rawD) : (sess.dateKey ? new Date(sess.dateKey + 'T12:00:00') : null));

          if (d && !isNaN(d.getTime())) {
            const sessTypeInfo = getAttendanceTypeInfo(att, sess.desc || '');
            const sessTitle = cleanSessionDesc(sess.desc || att.attTitle || 'Class Session', sessTypeInfo.label);
            const onlyTime = extractOnlyTime(sess.dateStr || '') || (sess.time || 'Class Time');

            allEvents.push({
              type: 'attendance',
              date: d,
              dateKey: sess.dateKey || formatDateKey(d),
              data: {
                att,
                isLive: false,
                session: sess,
                title: sessTitle,
                timeStr: onlyTime,
                isVerified: Boolean(sess.isPresent || sess.statusType === 'present'),
                statusType: sess.statusType,
                statusLabel: sess.statusLabel || (sess.isPresent ? 'Verified 100% ✓' : (sess.isFuture ? 'Scheduled' : 'Past Session')),
                takeUrl: att.attUrl,
                subType: att.subType || ''
              }
            });
            sessionsAdded++;
          }
        });
      } else if (att.nextSession && sessionsAdded === 0) {
        const nextSess = att.nextSession;
        const rawD = nextSess.date;
        const d = (rawD instanceof Date && !isNaN(rawD.getTime()))
          ? rawD
          : (rawD && !isNaN(new Date(rawD).getTime()) ? new Date(rawD) : (nextSess.dateKey ? new Date(nextSess.dateKey + 'T12:00:00') : null));

        if (d && !isNaN(d.getTime())) {
          const sessTypeInfo = getAttendanceTypeInfo(att, nextSess.desc || '');
          const sessTitle = cleanSessionDesc(nextSess.desc || att.attTitle || 'Class Session', sessTypeInfo.label);
          const onlyTime = extractOnlyTime(nextSess.time || nextSess.dateStr || '') || 'Class Time';

          allEvents.push({
            type: 'attendance',
            date: d,
            dateKey: nextSess.dateKey || formatDateKey(d),
            data: {
              att,
              isLive: false,
              session: nextSess,
              title: sessTitle,
              timeStr: onlyTime,
              isVerified: false,
              statusType: 'scheduled',
              statusLabel: 'Scheduled',
              takeUrl: att.attUrl,
              subType: att.subType || ''
            }
          });
          sessionsAdded++;
        }
      }
    });

    // 3. Announcements
    matchedAnns.forEach(ann => {
      let d = ann.timestamp ? (ann.timestamp instanceof Date ? ann.timestamp : new Date(ann.timestamp)) : null;
      if (!d || isNaN(d.getTime())) d = new Date();
      allEvents.push({
        type: 'notice',
        date: d,
        dateKey: formatDateKey(d),
        data: ann
      });
    });

    if (scopeCount) {
      scopeCount.style.display = 'none';
    }

    if (allEvents.length === 0) {
      feedEl.innerHTML = `
        <div style="text-align:center;padding:36px 12px;color:var(--text-muted);">
          <p style="font-size:13px;font-weight:600;margin-bottom:4px;">No activities matching this course</p>
          <p style="font-size:11px;">Check your filter settings or sync SPeCTRUM.</p>
        </div>
      `;
      feedEl.style.display = 'flex';
      return;
    }

    // Group events by dateKey
    const groupsMap = new Map();

    allEvents.forEach(ev => {
      if (!groupsMap.has(ev.dateKey)) {
        groupsMap.set(ev.dateKey, {
          dateKey: ev.dateKey,
          date: ev.date,
          events: []
        });
      }
      groupsMap.get(ev.dateKey).events.push(ev);
    });

    // Chronological spine sort:
    // 1. TODAY group first (if any)
    // 2. Upcoming dates: sorted ASCENDING (nearest upcoming deadline/session first, e.g. 03 Nov then 27 Nov)
    // 3. Past dates: sorted DESCENDING (most recent past first, e.g. 28 Oct then 14 Oct)
    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      const aIsToday = (a.dateKey === todayKey);
      const bIsToday = (b.dateKey === todayKey);
      if (aIsToday) return -1;
      if (bIsToday) return 1;

      const aTime = a.date.getTime();
      const bTime = b.date.getTime();
      const aIsFuture = (aTime >= nowTime);
      const bIsFuture = (bTime >= nowTime);

      if (aIsFuture && !bIsFuture) return -1;
      if (!aIsFuture && bIsFuture) return 1;

      if (aIsFuture && bIsFuture) {
        return aTime - bTime;
      }
      return bTime - aTime;
    });

    let spineHtml = '<div class="chronological-spine-timeline">';

    groups.forEach(group => {
      const isToday = (group.dateKey === todayKey);
      const isFuture = (group.date.getTime() >= nowTime);
      const d = group.date;
      const day = String(d.getDate()).padStart(2, '0');
      const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

      const titleHtml = isToday 
        ? `TODAY <span class="spine-node-date">${day} ${mon}</span>` 
        : `${day} ${mon} ${wd}`;
      const dotClass = isToday ? 'spine-node-dot is-today' : 'spine-node-dot';
      const badgeText = isToday 
        ? `${group.events.length} Event${group.events.length !== 1 ? 's' : ''}` 
        : (isFuture 
            ? (group.events.some(e => e.type === 'assignment') ? 'Deadline' : 'Upcoming') 
            : 'Milestone');

      // Sort cards within group: assignments first, then attendance, then notices
      const sortedEvents = group.events.sort((a, b) => {
        const order = { assignment: 1, attendance: 2, notice: 3 };
        return (order[a.type] || 9) - (order[b.type] || 9);
      });

      const cardsHtml = sortedEvents.map(ev => {
        if (ev.type === 'assignment') return renderScopedAssignmentCard(ev.data);
        if (ev.type === 'attendance') return renderScopedAttendanceCard(ev.data);
        if (ev.type === 'notice') return renderScopedNoticeCard(ev.data);
        return '';
      }).join('');

      spineHtml += `
        <div class="spine-date-group ${isToday ? 'group-today' : ''}">
          <div class="spine-node-header">
            <span class="${dotClass}"></span>
            <div class="spine-node-title">${titleHtml}</div>
          </div>
          <div class="spine-date-cards">
            ${cardsHtml}
          </div>
        </div>
      `;
    });

    spineHtml += '</div>';
    feedEl.innerHTML = spineHtml;
    feedEl.style.display = 'flex';
    attachAttendanceActions(feedEl);

    // Active node highlight on scroll / in sight animation
    const stream = document.getElementById('popup-cards-stream');
    if (stream && !stream._hasByCourseScrollListener) {
      stream._hasByCourseScrollListener = true;
      stream.addEventListener('scroll', updateActiveSpineNode, { passive: true });
      stream.addEventListener('wheel', () => requestAnimationFrame(updateActiveSpineNode), { passive: true });
      window.addEventListener('scroll', updateActiveSpineNode, { passive: true });
    }

    // Immediately trigger so the initial in-sight date dot is filled solid black
    requestAnimationFrame(updateActiveSpineNode);
    setTimeout(updateActiveSpineNode, 50);
  }

  function renderPopupMonograms() {
    const listEl = document.getElementById('rail-monograms-list');
    if (!listEl) return;

    const courses = getPopupCoursesList();
    if (courses.length === 0) {
      listEl.innerHTML = '';
      return;
    }

    // If no course is currently selected and we are in dedicated courses mode, select the first course by default
    if (popupSidebarMode === 'courses' && !selectedCourseFilterId && !selectedCourseFilterCode && courses.length > 0) {
      selectedCourseFilterId = courses[0].courseId;
      selectedCourseFilterCode = courses[0].courseCode;
    }

    const showNotice = isActivityActive('notice');
    const showTasks = isActivityActive('tutorial');
    const showAtt = isActivityActive('attendance');

    listEl.innerHTML = courses.map(c => {
      const isSel = (selectedCourseFilterId && String(selectedCourseFilterId) === String(c.courseId)) ||
                    (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode);
      const acronym = generateCourseAcronym(c.courseName, c.courseCode);
      const activeTasks = (c.pendingCount !== undefined) ? c.pendingCount : (c.taskCount || 0);
      const cTotal = (showNotice ? (c.annCount || 0) : 0) + (showTasks ? activeTasks : 0) + (showAtt ? (c.attCount || 0) : 0);

      let occText = '';
      if (c.userOcc) {
        const clean = String(c.userOcc).replace(/^occ\s*/i, '').trim();
        if (clean) occText = ` (OCC ${clean})`;
      }
      const titleText = `${c.courseCode}: ${c.courseName}${occText} - ${cTotal} active item${cTotal !== 1 ? 's' : ''}`;

      // In By Course Mode, no dots are displayed on first letter icons per user spec
      return `
        <button type="button" class="rail-monogram-btn ${isSel ? 'active' : ''}" 
          data-course-id="${escapeHtml(c.courseId)}" 
          data-course-code="${escapeHtml(c.courseCode)}" 
          data-acronym="${escapeHtml(acronym)}"
          data-tooltip="${escapeHtml(titleText)}"
          title="${escapeHtml(titleText)}" 
          aria-label="${escapeHtml(titleText)}">
          ${escapeHtml(acronym)}
        </button>
      `;
    }).join('');

    listEl.querySelectorAll('.rail-monogram-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cid = btn.dataset.courseId;
        const code = btn.dataset.courseCode;
        selectedCourseFilterId = cid;
        selectedCourseFilterCode = code;
        renderPopupMonograms();
        syncPopupActivityStreams();
      });

      // Floating tooltip on hover (using #rail-tooltip-overlay)
      btn.addEventListener('mouseenter', () => {
        const overlay = document.getElementById('rail-tooltip-overlay');
        const tooltipText = btn.dataset.tooltip || btn.title;
        if (overlay && tooltipText) {
          overlay.textContent = tooltipText;
          const rect = btn.getBoundingClientRect();
          overlay.style.left = `${rect.right + 8}px`;
          overlay.style.top = `${rect.top + (rect.height / 2) - 12}px`;
          overlay.classList.add('visible');
        }
      });

      btn.addEventListener('mouseleave', () => {
        const overlay = document.getElementById('rail-tooltip-overlay');
        if (overlay) overlay.classList.remove('visible');
      });
    });
  }

  function renderCourseFilterMatrix() {
    const matrixContainer = document.getElementById('course-filter-matrix');
    const headerTitle = document.getElementById('matrix-header-title');
    const headerBadge = document.getElementById('matrix-header-badge');
    if (!matrixContainer) return;

    const courses = getPopupCoursesList();
    const isAllActive = (!selectedCourseFilterId && !selectedCourseFilterCode);

    let activeAcronym = 'ALL';
    let totalAll = 0;
    let activeDeliverablesCount = 0;

    const courseCounts = new Map();
    const courseUrgent = new Map();

    const showNotice = isActivityActive('notice');
    const showTasks = isActivityActive('tutorial');
    const showAtt = isActivityActive('attendance');

    if (popupSidebarMode === 'calendar') {
      // ── Calendar Mode: scope matrix counts to the SELECTED CALENDAR DATE ──
      const targetDateKey = activeDateFilter || miniCalSelectedDateKey || formatDateKey(new Date());

      let dAnns = showNotice && (typeof announcementsData !== 'undefined') ? announcementsData.filter(a => {
        const d = a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp || 0);
        return !isNaN(d.getTime()) && formatDateKey(d) === targetDateKey;
      }) : [];

      let dAssigns = showTasks && (typeof assignmentsData !== 'undefined') ? assignmentsData.filter(a => {
        const d = a.dueDate instanceof Date ? a.dueDate : new Date(a.dueDate || 0);
        return !isNaN(d.getTime()) && formatDateKey(d) === targetDateKey;
      }) : [];

      let dAtt = showAtt && (typeof attendancesData !== 'undefined') ? attendancesData.filter(att => {
        if (typeof isAttendanceHidden === 'function' && isAttendanceHidden(att)) return false;
        if (att.activeSession && formatDateKey(new Date()) === targetDateKey) return true;
        if (Array.isArray(att.sessions)) {
          return att.sessions.some(s => s.dateKey === targetDateKey);
        }
        return false;
      }) : [];

      totalAll = dAnns.length + dAssigns.length + dAtt.length;

      courses.forEach(c => {
        const cAnns = dAnns.filter(a => isActivityForCourse(a, c)).length;
        const cTasks = dAssigns.filter(a => isActivityForCourse(a, c) && ((typeof isAssignmentMatchingOcc === 'function') ? isAssignmentMatchingOcc(a, c.userOcc) : true)).length;
        const cAttCount = dAtt.filter(a => isActivityForCourse(a, c)).length;
        const cTotal = cAnns + cTasks + cAttCount;
        courseCounts.set(String(c.courseId), cTotal);
        courseUrgent.set(String(c.courseId), cTasks > 0);
      });

      if (!isAllActive) {
        const activeCourse = courses.find(c =>
          (selectedCourseFilterId && String(c.courseId) === String(selectedCourseFilterId)) ||
          (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode)
        );
        if (activeCourse) {
          activeAcronym = generateCourseAcronym(activeCourse.courseName, activeCourse.courseCode);
          activeDeliverablesCount = courseCounts.get(String(activeCourse.courseId)) || 0;
        }
      } else {
        activeDeliverablesCount = totalAll;
      }
    } else {
      // ── Courses Mode: count across the whole semester ──
      let allAnns = showNotice && (typeof announcementsData !== 'undefined') ? announcementsData : [];
      let allAssigns = showTasks && (typeof assignmentsData !== 'undefined') ? assignmentsData : [];
      let allAtt = showAtt && (typeof attendancesData !== 'undefined') ? attendancesData.filter(a => !isAttendanceHidden(a)) : [];

      totalAll = allAnns.length + allAssigns.length + allAtt.length;

      courses.forEach(c => {
        const cAnns = allAnns.filter(a => isActivityForCourse(a, c)).length;
        const cTasks = allAssigns.filter(a => isActivityForCourse(a, c) && ((typeof isAssignmentMatchingOcc === 'function') ? isAssignmentMatchingOcc(a, c.userOcc) : true)).length;
        const cAttCount = allAtt.filter(a => isActivityForCourse(a, c)).length;
        const cTotal = cAnns + cTasks + cAttCount;
        courseCounts.set(String(c.courseId), cTotal);
        courseUrgent.set(String(c.courseId), (c.pendingCount || 0) > 0);
      });

      if (!isAllActive) {
        const activeCourse = courses.find(c =>
          (selectedCourseFilterId && String(c.courseId) === String(selectedCourseFilterId)) ||
          (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode)
        );
        if (activeCourse) {
          activeAcronym = generateCourseAcronym(activeCourse.courseName, activeCourse.courseCode);
          activeDeliverablesCount = courseCounts.get(String(activeCourse.courseId)) || 0;
        }
      } else {
        activeDeliverablesCount = totalAll;
      }
    }

    if (headerTitle) {
      headerTitle.textContent = isAllActive ? 'COURSES (ALL)' : ('COURSES (' + activeAcronym + ')');
    }
    if (headerBadge) {
      headerBadge.textContent = activeDeliverablesCount;
    }

    // 1. ALL button (Default state)
    let html = `
      <button type="button" class="matrix-monogram-btn ${isAllActive ? 'active' : ''}" 
        data-course-id="all" 
        data-course-code="ALL" 
        data-acronym="ALL"
        title="Show all course feeds"
        aria-label="Show all course feeds">
        <span class="matrix-btn-text">ALL</span>
        <span class="matrix-btn-count">${totalAll}</span>
      </button>
    `;

    // 2. Up to 9 enrolled courses
    courses.slice(0, 9).forEach(c => {
      const isSel = (selectedCourseFilterId && String(selectedCourseFilterId) === String(c.courseId)) ||
                    (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode);
      const acronym = generateCourseAcronym(c.courseName, c.courseCode);
      const cTotal = courseCounts.get(String(c.courseId)) || 0;
      const hasUrgent = courseUrgent.get(String(c.courseId)) || false;
      const dotClass = hasUrgent ? 'has-urgent' : (cTotal > 0 ? 'has-normal' : '');
      const dotHtml = dotClass ? `<span class="matrix-btn-dot ${dotClass}"></span>` : '';

      html += `
        <button type="button" class="matrix-monogram-btn ${isSel ? 'active' : ''}" 
          data-course-id="${escapeHtml(c.courseId)}" 
          data-course-code="${escapeHtml(c.courseCode)}" 
          data-acronym="${escapeHtml(acronym)}"
          aria-label="${escapeHtml(c.courseName)}">
          <span class="matrix-btn-text">${escapeHtml(acronym)}</span>
          ${dotHtml}
        </button>
      `;
    });

    matrixContainer.innerHTML = html;

    // Attach Click Handlers
    matrixContainer.querySelectorAll('.matrix-monogram-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cid = btn.dataset.courseId;
        const code = btn.dataset.courseCode;

        if (cid === 'all') {
          selectedCourseFilterId = null;
          selectedCourseFilterCode = null;
        } else if ((selectedCourseFilterId && String(selectedCourseFilterId) === String(cid)) ||
                   (selectedCourseFilterCode && code === selectedCourseFilterCode)) {
          // Toggle off -> reset to ALL
          selectedCourseFilterId = null;
          selectedCourseFilterCode = null;
        } else {
          selectedCourseFilterId = cid;
          selectedCourseFilterCode = code;
        }

        renderPopupMonograms();
        syncPopupActivityStreams();
      });

      // Hover Full Name Popover
      btn.addEventListener('mouseenter', () => {
        const popover = document.getElementById('matrix-course-popover');
        if (!popover) return;

        const cid = btn.dataset.courseId;
        if (cid === 'all') {
          popover.innerHTML = `
            <div class="mcp-header">
              <span class="mcp-code">ALL ENROLLED</span>
              <span class="mcp-occ">RESET FILTER</span>
            </div>
            <div class="mcp-title">All Course Feeds</div>
            <div class="mcp-instructor">Unified timeline across all subjects</div>
            <div class="mcp-counter">● ${totalAll} Total Deliverables</div>
          `;
        } else {
          const c = courses.find(item => String(item.courseId) === String(cid) || item.courseCode === btn.dataset.courseCode);
          if (!c) return;

          const occText = c.userOcc ? ('OCC ' + String(c.userOcc).replace(/^occ\s*/i, '')) : 'All Cohorts';
          const activeTasks = (c.pendingCount !== undefined) ? c.pendingCount : (c.taskCount || 0);
          const cTotal = (c.annCount || 0) + activeTasks + (c.attCount || 0);
          const instructor = c.lecturer || 'Course Instructor · Faculty of CSIT';

          popover.innerHTML = `
            <div class="mcp-header">
              <span class="mcp-code">${escapeHtml(c.courseCode)}</span>
              <span class="mcp-occ">${escapeHtml(occText)}</span>
            </div>
            <div class="mcp-title">${escapeHtml(c.courseName)}</div>
            <div class="mcp-instructor">👤 ${escapeHtml(instructor)}</div>
            <div class="mcp-counter">● ${cTotal} Active Deliverables (${activeTasks} Tasks)</div>
          `;
        }

        const rect = btn.getBoundingClientRect();
        popover.style.left = (rect.right + 10) + 'px';
        const popHeight = 110;
        let topPos = rect.top - 10;
        if (topPos + popHeight > window.innerHeight) {
          topPos = window.innerHeight - popHeight - 10;
        }
        popover.style.top = Math.max(10, topPos) + 'px';
        popover.classList.add('visible');
      });

      btn.addEventListener('mouseleave', () => {
        const popover = document.getElementById('matrix-course-popover');
        if (popover) popover.classList.remove('visible');
      });
    });
  }

  function setPopupSidebarMode(mode) {
    popupSidebarMode = (mode === 'courses') ? 'courses' : 'calendar';

    const btnCal = document.getElementById('btn-sidebar-mode-calendar');
    const btnCrs = document.getElementById('btn-sidebar-mode-courses');
    if (btnCal) btnCal.classList.toggle('active', popupSidebarMode === 'calendar');
    if (btnCrs) btnCrs.classList.toggle('active', popupSidebarMode === 'courses');

    const railEl = document.getElementById('popup-sticky-date-box');
    const calView = document.getElementById('rail-expanded-view');
    const crsView = document.getElementById('rail-courses-view');
    const collapsedView = document.getElementById('rail-collapsed-view');
    const dockedFilters = document.getElementById('rail-docked-filters');

    if (popupSidebarMode === 'courses') {
      if (railEl) {
        railEl.classList.add('rail-mode-courses', 'is-collapsed');
        railEl.classList.remove('is-calendar-expanded');
      }
      const splitCont = document.getElementById('popup-split-container');
      if (splitCont) splitCont.classList.remove('is-calendar-expanded');
      if (calView) calView.style.display = 'none';
      if (crsView) crsView.style.display = 'none';
      if (dockedFilters) dockedFilters.style.display = 'flex';
      if (collapsedView) collapsedView.style.display = 'flex';
      renderPopupMonograms();
    } else {
      if (railEl) {
        railEl.classList.remove('rail-mode-courses', 'is-collapsed');
      }
      if (collapsedView) collapsedView.style.display = 'none';
      if (crsView) crsView.style.display = 'none';
      if (calView) calView.style.display = 'flex';
      if (dockedFilters) dockedFilters.style.display = 'flex';
      selectedCourseFilterId = null;
      selectedCourseFilterCode = null;
      renderMiniCalendar();
    }

    syncPopupActivityStreams();
    chrome.storage.local.set({ cachedPopupSidebarMode: popupSidebarMode }).catch(() => {});
  }

  function syncPopupActivityStreams() {
    const scopeBar = document.getElementById('popup-focused-scope-bar');
    const byCourseFeed = document.getElementById('bycourse-activities-feed');
    const dateFilteredList = document.getElementById('date-filtered-activities-list');

    if (popupSidebarMode === 'courses') {
      // By Course Mode (left rail collapsed into monograms rail)
      if (dateFilteredList) dateFilteredList.style.display = 'none';
      if (announcementsListEl) announcementsListEl.style.display = 'none';
      if (assignmentsListEl) assignmentsListEl.style.display = 'none';
      if (attendanceListEl) attendanceListEl.style.display = 'none';

      renderByCourseScopedFeed();
    } else {
      // Calendar Mode (expanded rail with mini-calendar + course filter matrix)
      // Never show the bycourse timeline feed in Calendar mode
      if (scopeBar) scopeBar.style.display = 'none';
      if (byCourseFeed) byCourseFeed.style.display = 'none';

      // Always filter the calendar day view by the active date and active course!
      const targetDateKey = activeDateFilter || miniCalSelectedDateKey || formatDateKey(new Date());
      let targetDateObj = activeDateFilterObj;
      if (!targetDateObj && targetDateKey) {
        const parts = targetDateKey.split('-').map(Number);
        targetDateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      }

      applyMiniCalDateFilter(targetDateKey, targetDateObj);
    }

    syncRailCounts();
    renderCourseFilterMatrix();
    if (popupSidebarMode === 'calendar') renderMiniCalendar();
  }

  function initSidebarRail() {
    // ── Mode Switchers: Calendar vs Courses ──
    const btnSidebarCal = document.getElementById('btn-sidebar-mode-calendar');
    const btnSidebarCrs = document.getElementById('btn-sidebar-mode-courses');
    if (btnSidebarCal) {
      btnSidebarCal.addEventListener('click', (e) => {
        e.preventDefault();
        setPopupSidebarMode('calendar');
      });
    }
    if (btnSidebarCrs) {
      btnSidebarCrs.addEventListener('click', (e) => {
        e.preventDefault();
        setPopupSidebarMode('courses');
      });
    }

    renderCourseFilterMatrix();
    // Restore cached sidebar mode preference
    chrome.storage.local.get(['cachedPopupSidebarMode']).then(res => {
      if (res && res.cachedPopupSidebarMode) {
        setPopupSidebarMode(res.cachedPopupSidebarMode);
      } else {
        setPopupSidebarMode('calendar');
      }
    }).catch(() => {
      setPopupSidebarMode('calendar');
    });
    // ── Accordion Toggle: Date Card click → expand calendar ──
    const trigger = document.getElementById('popup-date-card-trigger');
    const btnRailCal = document.getElementById('btn-rail-calendar');
    if (trigger) {
      trigger.addEventListener('click', () => toggleSidebarCalendar(true));
    }
    if (btnRailCal) {
      btnRailCal.addEventListener('click', () => toggleSidebarCalendar(!isCalendarExpanded));
    }

    // ── Collapse Buttons ──
    ['btn-header-collapse-cal', 'btn-mini-cal-collapse-bottom'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => toggleSidebarCalendar(false));
    });

    // ── Rail View Mode Buttons ──
    const btnRailTimeline = document.getElementById('btn-rail-timeline');
    const btnRailList = document.getElementById('btn-rail-list');

    if (btnRailTimeline) {
      btnRailTimeline.addEventListener('click', () => {
        setGroupingMode('timeline');
        // Update rail active states
        [btnRailTimeline, btnRailCal, btnRailList].forEach(b => b && b.classList.remove('active'));
        btnRailTimeline.classList.add('active');
      });
    }
    if (btnRailList) {
      btnRailList.addEventListener('click', () => {
        setGroupingMode('bycourse');
        [btnRailTimeline, btnRailCal, btnRailList].forEach(b => b && b.classList.remove('active'));
        btnRailList.classList.add('active');
      });
    }

    // ── Rail Activity Filter Buttons (collapsed view) ──
    ['rail-btn-notice', 'rail-btn-tutorial', 'rail-btn-attendance'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        const sub = btn.dataset.sub;
        switchActivitiesSubTab(sub);
        // Update rail + dock button active states
        document.querySelectorAll('.rail-activity-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.dock-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const dockId = id.replace('rail-btn-', 'dock-btn-');
        const dockBtn = document.getElementById(dockId);
        if (dockBtn) dockBtn.classList.add('active');
      });
    });

    // ── Docked Filter Buttons (expanded view) ──
    ['dock-btn-notice', 'dock-btn-tutorial', 'dock-btn-attendance'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        renderPopupMonograms();
        syncPopupActivityStreams();
      });
    });

    // ── Mini-Calendar Month Navigation ──
    const btnPrev = document.getElementById('btn-mini-cal-prev');
    const btnNext = document.getElementById('btn-mini-cal-next');
    if (btnPrev) btnPrev.addEventListener('click', () => { miniCalMonth--; if (miniCalMonth < 0) { miniCalMonth = 11; miniCalYear--; } renderMiniCalendar(); });
    if (btnNext) btnNext.addEventListener('click', () => { miniCalMonth++; if (miniCalMonth > 11) { miniCalMonth = 0; miniCalYear++; } renderMiniCalendar(); });

    // ── Today button ──
    const btnToday = document.getElementById('btn-mini-cal-today');
    const btnHeroToday = document.getElementById('cal-hero-today-badge');
    const handleJumpToToday = () => {
      const now = new Date();
      miniCalYear = now.getFullYear();
      miniCalMonth = now.getMonth();
      miniCalSelectedDateKey = `${miniCalYear}-${String(miniCalMonth + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      activeDateFilter = miniCalSelectedDateKey;
      activeDateFilterObj = now;
      updateDateHeroHeader(now);
      syncPopupActivityStreams();
    };
    if (btnToday) btnToday.addEventListener('click', handleJumpToToday);
    if (btnHeroToday) btnHeroToday.addEventListener('click', handleJumpToToday);

    // ── Dots / Count Segment Toggle ──
    const btnDots = document.getElementById('btn-seg-dots');
    const btnCount = document.getElementById('btn-seg-count');
    if (btnDots) {
      btnDots.addEventListener('click', () => {
        miniCalIndicatorMode = 'dots';
        btnDots.classList.add('active');
        if (btnCount) btnCount.classList.remove('active');
        const label = document.getElementById('mini-cal-mode-label');
        if (label) label.textContent = 'Option 1: Dot indicators';
        renderMiniCalendar();
      });
    }
    if (btnCount) {
      btnCount.addEventListener('click', () => {
        miniCalIndicatorMode = 'count';
        btnCount.classList.add('active');
        if (btnDots) btnDots.classList.remove('active');
        const label = document.getElementById('mini-cal-mode-label');
        if (label) label.textContent = 'Option 2: Count badges';
        renderMiniCalendar();
      });
    }

    // ── Show All (reset date filter) ──
    const btnReset = document.getElementById('btn-reset-date-filter');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        const now = new Date();
        activeDateFilter = formatDateKey(now);
        activeDateFilterObj = now;
        miniCalSelectedDateKey = activeDateFilter;
        syncPopupActivityStreams();
      });
    }

    // Init: render with today selected + sync initial active rail button
    const now = new Date();
    miniCalYear = now.getFullYear();
    miniCalMonth = now.getMonth();
    miniCalSelectedDateKey = `${miniCalYear}-${String(miniCalMonth + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    renderMiniCalendar();

    // Make all activity buttons active (lit up) by default per user requirement
    document.querySelectorAll('.dock-filter-btn').forEach(b => b.classList.add('active'));
    document.querySelectorAll('.rail-activity-btn').forEach(b => b.classList.add('active'));

    // ── JS-driven tooltip overlay (position:fixed, bypasses overflow clipping) ──
    const tooltipEl = document.getElementById('rail-tooltip-overlay');
    if (tooltipEl) {
      let tooltipTimer = null;
      document.querySelectorAll('.has-rail-tooltip').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
          const text = btn.dataset.tooltip;
          if (!text) return;
          const rect = btn.getBoundingClientRect();
          tooltipEl.textContent = text;
          // Position to the right of the button
          tooltipEl.style.left = `${rect.right + 8}px`;
          tooltipEl.style.top = `${rect.top + rect.height / 2}px`;
          tooltipEl.style.transform = 'translateY(-50%) scale(0.92)';
          clearTimeout(tooltipTimer);
          tooltipTimer = requestAnimationFrame(() => {
            tooltipEl.classList.add('visible');
            tooltipEl.style.transform = 'translateY(-50%) scale(1)';
          });
        });
        btn.addEventListener('mouseleave', () => {
          clearTimeout(tooltipTimer);
          tooltipEl.classList.remove('visible');
          tooltipEl.style.transform = 'translateY(-50%) scale(0.92)';
        });
      });
    }
  }

  function toggleSidebarCalendar(expand) {
    isCalendarExpanded = expand;
    const collapsed = document.getElementById('rail-collapsed-view');
    const expanded = document.getElementById('rail-expanded-view');
    const sidebarEl = document.getElementById('popup-sticky-date-box');
    const container = document.getElementById('popup-split-container');

    // Width is permanently locked at 760px to prevent window resizing flash

    if (expand) {
      if (collapsed) collapsed.style.display = 'none';
      if (expanded) expanded.style.display = 'flex';
      if (sidebarEl) sidebarEl.classList.add('is-calendar-expanded');
      if (container) container.classList.add('is-calendar-expanded');
      renderMiniCalendar();
    } else {
      if (collapsed) collapsed.style.display = 'flex';
      if (expanded) expanded.style.display = 'none';
      if (sidebarEl) sidebarEl.classList.remove('is-calendar-expanded');
      if (container) container.classList.remove('is-calendar-expanded');
    }
  }

  function getMiniCalEvents() {
    // Build a map of dateKey -> {ann: n, tutorial: n, att: n} from real data
    const map = new Map();
    const addEvent = (key, type) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, { ann: 0, tutorial: 0, att: 0 });
      map.get(key)[type]++;
    };

    const courses = getPopupCoursesList();
    const activeCourse = (selectedCourseFilterId || selectedCourseFilterCode) ? courses.find(c => 
      (selectedCourseFilterId && String(c.courseId) === String(selectedCourseFilterId)) ||
      (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode)
    ) : null;

    announcementsData.forEach(ann => {
      if (activeCourse && !isActivityForCourse(ann, activeCourse)) return;
      if (ann.timestamp) {
        const d = (ann.timestamp instanceof Date) ? ann.timestamp : new Date(ann.timestamp);
        if (!isNaN(d.getTime())) addEvent(formatDateKey(d), 'ann');
      }
    });

    assignmentsData.forEach(assign => {
      if (activeCourse && !isActivityForCourse(assign, activeCourse)) return;
      const d = assign.dueDate ? (assign.dueDate instanceof Date ? assign.dueDate : new Date(assign.dueDate)) : null;
      if (d && !isNaN(d.getTime())) addEvent(formatDateKey(d), 'tutorial');
    });

    attendancesData.forEach(att => {
      if (isAttendanceHidden && isAttendanceHidden(att)) return;
      if (activeCourse && !isActivityForCourse(att, activeCourse)) return;
      if (att.activeSession) addEvent(formatDateKey(new Date()), 'att');
      if (Array.isArray(att.sessions)) {
        att.sessions.forEach(sess => {
          if (sess.dateKey) addEvent(sess.dateKey, 'att');
        });
      }
    });

    return map;
  }

  function renderMiniCalendar() {
    const grid = document.getElementById('mini-cal-days-grid');
    const monthTitle = document.getElementById('mini-cal-month-title');
    const weekBadge = document.getElementById('mini-cal-week-badge');
    if (!grid) return;

    const MONTH_NAMES_FULL = [
      'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
      'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
    ];
    const firstOfMonth = new Date(miniCalYear, miniCalMonth, 1);
    const lastOfMonth = new Date(miniCalYear, miniCalMonth + 1, 0);

    const startUm = getUmAcademicInfo(firstOfMonth);
    const endUm = getUmAcademicInfo(lastOfMonth);
    const startW = parseInt(startUm.weekNum, 10) || 1;
    const endW = parseInt(endUm.weekNum, 10) || startW;
    const weekSpan = startW === endW ? `W${String(startW).padStart(2, '0')}` : `W${String(startW).padStart(2, '0')}–W${String(endW).padStart(2, '0')}`;

    if (monthTitle) {
      monthTitle.textContent = `${MONTH_NAMES_FULL[miniCalMonth]} ${miniCalYear} · ${weekSpan}`;
    }
    if (weekBadge) {
      weekBadge.textContent = '';
      weekBadge.style.display = 'none';
    }

    // Keep hero header updated
    let heroDate = activeDateFilterObj;
    if (!heroDate && miniCalSelectedDateKey) {
      const parts = miniCalSelectedDateKey.split('-').map(Number);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        heroDate = new Date(parts[0], parts[1] - 1, parts[2]);
      }
    }
    updateDateHeroHeader(heroDate || new Date());

    // Gather real event data
    const eventsMap = getMiniCalEvents();

    // Build calendar grid
    const firstDay = firstOfMonth.getDay(); // 0=Sun..6=Sat
    // Shift so Monday is first: Mon=0, Tue=1, ... Sun=6
    const startOffset = (firstDay + 6) % 7;
    const daysInMonth = new Date(miniCalYear, miniCalMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(miniCalYear, miniCalMonth, 0).getDate();

    let html = '';
    let cellIndex = 0;
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      if (i < startOffset) {
        // Previous month days
        const day = daysInPrevMonth - startOffset + i + 1;
        const prevMonth = miniCalMonth === 0 ? 11 : miniCalMonth - 1;
        const prevYear = miniCalMonth === 0 ? miniCalYear - 1 : miniCalYear;
        const key = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        html += renderMiniCalCell(day, key, true, eventsMap);
      } else if (i < startOffset + daysInMonth) {
        // Current month days
        const day = i - startOffset + 1;
        const key = `${miniCalYear}-${String(miniCalMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        html += renderMiniCalCell(day, key, false, eventsMap);
      } else {
        // Next month days
        const day = i - startOffset - daysInMonth + 1;
        const nextMonth = miniCalMonth === 11 ? 0 : miniCalMonth + 1;
        const nextYear = miniCalMonth === 11 ? miniCalYear + 1 : miniCalYear;
        const key = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        html += renderMiniCalCell(day, key, true, eventsMap);
      }
    }

    grid.innerHTML = html;

    // Attach click handlers
    grid.querySelectorAll('.mini-cal-day-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const key = cell.dataset.dateKey;
        if (!key) return;
        miniCalSelectedDateKey = key;
        activeDateFilter = key;
        const parts = key.split('-').map(Number);
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        activeDateFilterObj = d;
        updateDateHeroHeader(d);
        syncPopupActivityStreams();
      });
    });

    // Update summary chip
    updateMiniCalSummaryChip();
    syncRailCounts();
  }

  function renderMiniCalCell(day, dateKey, isAdjacent, eventsMap) {
    const today = formatDateKey(new Date());
    const isToday = dateKey === today;
    const isSelected = dateKey === miniCalSelectedDateKey;
    const events = eventsMap.get(dateKey) || { ann: 0, tutorial: 0, att: 0 };
    const hasEvents = events.ann > 0 || events.tutorial > 0 || events.att > 0;
    const totalCount = events.ann + events.tutorial + events.att;

    let cellClass = 'mini-cal-day-cell';
    if (isAdjacent) cellClass += ' adjacent-month';
    if (isToday && !isSelected) cellClass += ' is-today';
    if (isSelected) cellClass += ' selected-day';

    let indicatorHtml = '';
    if (hasEvents) {
      if (miniCalIndicatorMode === 'dots') {
        let dots = '';
        if (events.ann > 0) dots += `<span class="cell-dot dot-notice"></span>`;
        if (events.tutorial > 0) dots += `<span class="cell-dot dot-tutorial"></span>`;
        if (events.att > 0) dots += `<span class="cell-dot dot-attendance"></span>`;
        indicatorHtml = `<div class="cell-dots-wrap">${dots}</div>`;
      } else {
        indicatorHtml = `<div class="cell-dots-wrap"><span class="cell-count-badge">${totalCount}</span></div>`;
      }
    }

    return `<div class="${cellClass}" data-date-key="${dateKey}" title="${dateKey}: ${totalCount} activities">${day}${indicatorHtml}</div>`;
  }

  function updateMiniCalSummaryChip() {
    const chip = document.getElementById('mini-cal-chip-text');
    const chipStatus = document.getElementById('mini-cal-chip-status');
    if (!chip) return;

    if (!miniCalSelectedDateKey) {
      chip.textContent = 'Select a date to filter';
      if (chipStatus) { chipStatus.textContent = 'Showing All'; chipStatus.style.color = '#A1A1AA'; }
      return;
    }

    const eventsMap = getMiniCalEvents();
    const events = eventsMap.get(miniCalSelectedDateKey) || { ann: 0, tutorial: 0, att: 0 };
    const total = events.ann + events.tutorial + events.att;
    const parts = miniCalSelectedDateKey.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    chip.textContent = `${String(d.getDate()).padStart(2, '0')} ${monthNames[d.getMonth()]}: ${total} item${total !== 1 ? 's' : ''} active`;
    if (chipStatus) {
      chipStatus.textContent = activeDateFilter ? 'Filtered' : 'Showing All';
      chipStatus.style.color = activeDateFilter ? '#10B981' : '#A1A1AA';
    }
  }

  let activeDateFilterObj = null;

  function applyMiniCalDateFilter(dateKey, dateObj) {
    activeDateFilter = dateKey || null;
    activeDateFilterObj = dateObj || null;

    if (!dateObj && dateKey) {
      const parts = dateKey.split('-').map(Number);
      dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      activeDateFilterObj = dateObj;
    }

    const filteredList = document.getElementById('date-filtered-activities-list');
    if (!filteredList) return;

    if (activeDateFilter && dateObj) {
      updateDateHeroHeader(dateObj);

      // Identify if a specific course filter is active in the matrix
      const courses = getPopupCoursesList();
      const activeCourse = (selectedCourseFilterId || selectedCourseFilterCode) ? courses.find(c => 
        (selectedCourseFilterId && String(c.courseId) === String(selectedCourseFilterId)) ||
        (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode)
      ) : null;

      // Activity type toggles (Notices, Tutorials, Attendance)
      const showNotice = isActivityActive('notice');
      const showTasks = isActivityActive('tutorial');
      const showAtt = isActivityActive('attendance');

      // 1. Notices for this date
      let allAnns = showNotice ? announcementsData.filter(a => {
        const d = a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp || 0);
        return !isNaN(d.getTime()) && formatDateKey(d) === dateKey;
      }) : [];

      // 2. Assignments due on this date
      let allAssigns = showTasks ? assignmentsData.filter(a => {
        const d = a.dueDate instanceof Date ? a.dueDate : new Date(a.dueDate || 0);
        return !isNaN(d.getTime()) && formatDateKey(d) === dateKey;
      }) : [];

      // 3. Attendance sessions on this date
      let allAtt = showAtt ? attendancesData.filter(att => {
        if (typeof isAttendanceHidden === 'function' && isAttendanceHidden(att)) return false;
        if (att.activeSession && formatDateKey(new Date()) === dateKey) return true;
        if (Array.isArray(att.sessions)) {
          return att.sessions.some(s => s.dateKey === dateKey);
        }
        return false;
      }) : [];

      // Scoped subject filtering for this specific day!
      if (activeCourse) {
        allAnns = allAnns.filter(a => isActivityForCourse(a, activeCourse));
        allAssigns = allAssigns.filter(a => {
          if (!isActivityForCourse(a, activeCourse)) return false;
          return (typeof isAssignmentMatchingOcc === 'function') ? isAssignmentMatchingOcc(a, activeCourse.userOcc) : true;
        });
        allAtt = allAtt.filter(att => isActivityForCourse(att, activeCourse));
      }

      const total = allAnns.length + allAssigns.length + allAtt.length;

      filteredList.style.display = 'flex';
      filteredList.style.flexDirection = 'column';
      filteredList.style.gap = '8px';

      const scopeBadgeText = activeCourse 
        ? `${generateCourseAcronym(activeCourse.courseName, activeCourse.courseCode)}`
        : 'ALL COURSES';

      const scopePillHtml = activeCourse
        ? `<span class="day-scope-pill is-clickable" id="btn-clear-day-scope" title="Filtering by ${escapeHtml(activeCourse.courseName || activeCourse.courseCode)}. Click to show All Courses.">${escapeHtml(scopeBadgeText)} <span class="scope-clear-x">✕</span></span>`
        : `<span class="day-scope-pill">${escapeHtml(scopeBadgeText)}</span>`;

      const courseNameHtml = activeCourse
        ? `<span class="day-scope-course-name" title="${escapeHtml(activeCourse.courseName || '')}">${escapeHtml(activeCourse.courseName || activeCourse.courseCode)}</span>`
        : '';

      const renderMetaBarHtml = (count) => {
        // User requirement: Remove the "ALL COURSES 5 ITEMS" header
        if (!activeCourse) return '';
        return `
          <div class="day-agenda-meta-bar">
            <div class="day-agenda-filters-left">
              ${scopePillHtml}
              ${courseNameHtml}
            </div>
            <span class="day-agenda-count-badge">${count} ${count === 1 ? 'ITEM' : 'ITEMS'}</span>
          </div>
        `;
      };

      if (total === 0) {
        const activeCourseName = activeCourse ? (activeCourse.courseName || activeCourse.courseCode) : '';
        const emptyMsg = activeCourse 
          ? `📅 No ${escapeHtml(activeCourseName)} activities on this date`
          : '📅 No activities scheduled on this date';
        const subMsg = activeCourse
          ? `<p style="font-size:11.5px;margin-top:6px;">Try another date or <button type="button" id="btn-date-show-all-courses" style="background:none;border:none;cursor:pointer;color:#2563EB;font-size:11.5px;font-weight:600;text-decoration:underline;">Show All Courses on this Date</button></p>`
          : `<p style="font-size:11.5px;margin-top:6px;">Select another date on the calendar above.</p>`;

        filteredList.innerHTML = `
          ${renderMetaBarHtml(0)}
          <div style="text-align:center;padding:36px 16px;color:var(--text-muted);background:var(--bg-surface);border:1px solid var(--border-hairline);border-radius:8px;">
            <p style="font-size:13.5px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${emptyMsg}</p>
            ${subMsg}
          </div>
        `;

        const btnResetToAll = document.getElementById('btn-date-show-all-courses');
        if (btnResetToAll) {
          btnResetToAll.addEventListener('click', (e) => {
            e.preventDefault();
            selectedCourseFilterId = null;
            selectedCourseFilterCode = null;
            renderCourseFilterMatrix();
            if (popupSidebarMode === 'calendar') renderMiniCalendar();
            applyMiniCalDateFilter(dateKey, dateObj);
          });
        }
        const btnClearScope = filteredList.querySelector('#btn-clear-day-scope');
        if (btnClearScope) {
          btnClearScope.addEventListener('click', (e) => {
            e.preventDefault();
            selectedCourseFilterId = null;
            selectedCourseFilterCode = null;
            renderCourseFilterMatrix();
            if (popupSidebarMode === 'calendar') renderMiniCalendar();
            applyMiniCalDateFilter(dateKey, dateObj);
          });
        }
      } else {
        let html = renderMetaBarHtml(total);

        if (allAnns.length) html += allAnns.map(a => typeof renderAnnouncementCardHtml === 'function' ? renderAnnouncementCardHtml(a) : '').join('');
        if (allAssigns.length) html += allAssigns.map(a => typeof renderAssignmentCardHtml === 'function' ? renderAssignmentCardHtml(a) : '').join('');
        if (allAtt.length) {
          allAtt.forEach(att => {
            const matchingSessions = Array.isArray(att.sessions) 
              ? att.sessions.filter(s => s.dateKey === dateKey)
              : [];
            
            if (matchingSessions.length > 0) {
              matchingSessions.forEach(sess => {
                if (typeof renderAttendanceCardHtml === 'function') {
                  html += renderAttendanceCardHtml(att, {
                    session: sess,
                    dateKey: dateKey,
                    date: sess.date || dateObj,
                    timeStr: sess.time || sess.dateStr || '',
                    isLive: Boolean(att.activeSession && (dateKey === formatDateKey(new Date()))),
                    isVerified: Boolean(sess.isPresent || sess.statusType === 'present' || sess.statusType === 'submitted'),
                    cid: att.courseId
                  });
                }
              });
            } else {
              if (typeof renderAttendanceCardHtml === 'function') {
                html += renderAttendanceCardHtml(att, {
                  session: att.activeSession || att.nextSession,
                  dateKey: dateKey,
                  date: dateObj,
                  timeStr: att.activeSession?.time || att.nextSession?.time || att.nextSession?.dateStr || '',
                  isLive: Boolean(att.activeSession && (dateKey === formatDateKey(new Date()))),
                  cid: att.courseId
                });
              }
            }
          });
        }

        filteredList.innerHTML = html;
        if (typeof attachCardHandlers === 'function') attachCardHandlers(filteredList);
        attachAttendanceActions(filteredList);

        const btnClearScope = filteredList.querySelector('#btn-clear-day-scope');
        if (btnClearScope) {
          btnClearScope.addEventListener('click', (e) => {
            e.preventDefault();
            selectedCourseFilterId = null;
            selectedCourseFilterCode = null;
            renderCourseFilterMatrix();
            if (popupSidebarMode === 'calendar') renderMiniCalendar();
            applyMiniCalDateFilter(dateKey, dateObj);
          });
        }

        filteredList.querySelectorAll('[data-open-url]').forEach(btn => {
          btn.addEventListener('click', () => {
            const url = btn.dataset.openUrl;
            if (url) chrome.tabs.create({ url });
          });
        });
      }

      // Hide standard sub-lists so only the date-filtered view is visible
      if (announcementsListEl) announcementsListEl.style.display = 'none';
      if (assignmentsListEl) assignmentsListEl.style.display = 'none';
      if (attendanceListEl) attendanceListEl.style.display = 'none';
    } else {
      const now = new Date();
      applyMiniCalDateFilter(formatDateKey(now), now);
    }

    updateMiniCalSummaryChip();
  }

  function syncRailCounts() {
    let annCount = 0;
    let assignCount = 0;
    let attCount = 0;

    const courses = getPopupCoursesList();
    const activeCourse = (selectedCourseFilterId || selectedCourseFilterCode) ? courses.find(c => 
      (selectedCourseFilterId && String(c.courseId) === String(selectedCourseFilterId)) ||
      (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode)
    ) : null;

    if (popupSidebarMode === 'courses' && activeCourse) {
      annCount = (typeof announcementsData !== 'undefined') ? announcementsData.filter(a => isActivityForCourse(a, activeCourse)).length : 0;
      assignCount = (typeof assignmentsData !== 'undefined') ? assignmentsData.filter(a => {
        if (!isActivityForCourse(a, activeCourse)) return false;
        return (typeof isAssignmentMatchingOcc === 'function') ? isAssignmentMatchingOcc(a, activeCourse.userOcc) : true;
      }).length : 0;
      attCount = (typeof attendancesData !== 'undefined') ? attendancesData.filter(a => {
        if (typeof isAttendanceHidden === 'function' && isAttendanceHidden(a)) return false;
        return isActivityForCourse(a, activeCourse);
      }).length : 0;
    } else if (popupSidebarMode === 'calendar') {
      // Calendar mode: count activities on the selected date (filtered by activeCourse if selected)
      const targetDateKey = activeDateFilter || miniCalSelectedDateKey || formatDateKey(new Date());
      let dAnns = (typeof announcementsData !== 'undefined') ? announcementsData.filter(a => {
        const d = a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp || 0);
        return !isNaN(d.getTime()) && formatDateKey(d) === targetDateKey;
      }) : [];
      let dAssigns = (typeof assignmentsData !== 'undefined') ? assignmentsData.filter(a => {
        const d = a.dueDate instanceof Date ? a.dueDate : new Date(a.dueDate || 0);
        return !isNaN(d.getTime()) && formatDateKey(d) === targetDateKey;
      }) : [];
      let dAtt = (typeof attendancesData !== 'undefined') ? attendancesData.filter(att => {
        if (typeof isAttendanceHidden === 'function' && isAttendanceHidden(att)) return false;
        if (att.activeSession && formatDateKey(new Date()) === targetDateKey) return true;
        if (Array.isArray(att.sessions)) {
          return att.sessions.some(s => s.dateKey === targetDateKey);
        }
        return false;
      }) : [];

      if (activeCourse) {
        dAnns = dAnns.filter(a => isActivityForCourse(a, activeCourse));
        dAssigns = dAssigns.filter(a => isActivityForCourse(a, activeCourse) && ((typeof isAssignmentMatchingOcc === 'function') ? isAssignmentMatchingOcc(a, activeCourse.userOcc) : true));
        dAtt = dAtt.filter(a => isActivityForCourse(a, activeCourse));
      }

      annCount = dAnns.length;
      assignCount = dAssigns.length;
      attCount = dAtt.length;
    } else {
      annCount = (typeof announcementsData !== 'undefined') ? announcementsData.length : 0;
      assignCount = (typeof assignmentsData !== 'undefined') ? assignmentsData.length : 0;
      attCount = (typeof attendancesData !== 'undefined') ? attendancesData.filter(a => a.activeSession).length || attendancesData.length : 0;
    }

    ['rail-count-ann', 'dock-count-ann'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = annCount; });
    ['rail-count-assign', 'dock-count-assign'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = assignCount; });
    ['rail-count-att', 'dock-count-att'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = attCount; });

    // Update tooltips
    const dnBtn = document.getElementById('dock-btn-notice');
    const dtBtn = document.getElementById('dock-btn-tutorial');
    const daBtn = document.getElementById('dock-btn-attendance');
    if (dnBtn) dnBtn.dataset.tooltip = '[ Notices (' + annCount + ') ]';
    if (dtBtn) dtBtn.dataset.tooltip = '[ Tutorials (' + assignCount + ') ]';
    if (daBtn) daBtn.dataset.tooltip = '[ Attendance (' + attCount + ') ]';

    // Re-render mini-calendar if expanded to pick up new events
    if (isCalendarExpanded && popupSidebarMode === 'calendar') renderMiniCalendar();
  }

  // Popup Radio Pills (Notice | Tutorial | Attendance)
  const popupRadioPills = document.querySelectorAll('.radio-pill-btn');
  popupRadioPills.forEach(pill => {
    pill.addEventListener('click', () => {
      popupRadioPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const sub = pill.dataset.sub;
      switchActivitiesSubTab(sub);
      initStickyDateObserver();
    });
  });

  // Centralized Grouping Mode Controller (By Date vs By Course across Popup & Full Tab)
  function setGroupingMode(mode) {
    currentActivitiesMode = (mode === 'bycourse' || mode === 'course') ? 'bycourse' : 'timeline';
    fullListGroupingMode = (currentActivitiesMode === 'bycourse') ? 'course' : 'date';
    chrome.storage.local.set({
      cachedActivitiesMode: currentActivitiesMode,
      cachedFullListGroupingMode: fullListGroupingMode
    }).catch(() => {});

    // Update popup toggle buttons
    const bDate = document.getElementById('btn-group-date');
    const bCourse = document.getElementById('btn-group-course');
    if (bDate) bDate.classList.toggle('active', currentActivitiesMode === 'timeline');
    if (bCourse) bCourse.classList.toggle('active', currentActivitiesMode === 'bycourse');

    // Update fulltab toggle buttons
    const fDate = document.getElementById('btn-fulllist-group-date');
    const fCourse = document.getElementById('btn-fulllist-group-course');
    if (fDate) fDate.classList.toggle('active', fullListGroupingMode === 'date');
    if (fCourse) fCourse.classList.toggle('active', fullListGroupingMode === 'course');

    // Update popup sticky box
    const stickyBox = document.getElementById('popup-sticky-date-box');
    if (stickyBox) stickyBox.style.display = (currentActivitiesMode === 'timeline') ? 'flex' : 'none';

    renderAllActivities();
    if (currentActivitiesMode === 'timeline') initStickyDateObserver();

    const fulllistWrap = document.getElementById('fulllist-wrapper');
    if (fulllistWrap && fulllistWrap.style.display !== 'none') {
      renderFullListMode();
    }
  }

  // Centralized Sort Order Controller (Newest vs Oldest across Popup & Full Tab)
  function setSortOrder(order) {
    currentSortOrder = (order === 'oldest') ? 'oldest' : 'newest';
    chrome.storage.local.set({ cachedSortOrder: currentSortOrder }).catch(() => {});

    // Update popup sort buttons
    const sNewest = document.getElementById('btn-sort-newest');
    const sOldest = document.getElementById('btn-sort-oldest');
    if (sNewest) sNewest.classList.toggle('active', currentSortOrder === 'newest');
    if (sOldest) sOldest.classList.toggle('active', currentSortOrder === 'oldest');

    // Update fulltab sort buttons
    const fsNewest = document.getElementById('btn-fulllist-sort-newest');
    const fsOldest = document.getElementById('btn-fulllist-sort-oldest');
    if (fsNewest) fsNewest.classList.toggle('active', currentSortOrder === 'newest');
    if (fsOldest) fsOldest.classList.toggle('active', currentSortOrder === 'oldest');

    renderAllActivities();
    if (currentActivitiesMode === 'timeline') initStickyDateObserver();

    const fulllistWrap = document.getElementById('fulllist-wrapper');
    if (fulllistWrap && fulllistWrap.style.display !== 'none') {
      renderFullListMode();
    }
  }

  // Popup Grouping Toggle
  const btnGroupDate = document.getElementById('btn-group-date');
  const btnGroupCourse = document.getElementById('btn-group-course');
  if (btnGroupDate) btnGroupDate.addEventListener('click', () => setGroupingMode('timeline'));
  if (btnGroupCourse) btnGroupCourse.addEventListener('click', () => setGroupingMode('bycourse'));

  // Full-Tab List Mode Grouping Toggle
  const btnFulllistGroupDate = document.getElementById('btn-fulllist-group-date');
  const btnFulllistGroupCourse = document.getElementById('btn-fulllist-group-course');
  if (btnFulllistGroupDate) btnFulllistGroupDate.addEventListener('click', () => setGroupingMode('timeline'));
  if (btnFulllistGroupCourse) btnFulllistGroupCourse.addEventListener('click', () => setGroupingMode('bycourse'));

  // Sorting Toggles (Newest vs Oldest in both Popup & FullTab)
  const btnSortNewest = document.getElementById('btn-sort-newest');
  const btnSortOldest = document.getElementById('btn-sort-oldest');
  if (btnSortNewest) btnSortNewest.addEventListener('click', () => setSortOrder('newest'));
  if (btnSortOldest) btnSortOldest.addEventListener('click', () => setSortOrder('oldest'));

  const btnFulllistSortNewest = document.getElementById('btn-fulllist-sort-newest');
  const btnFulllistSortOldest = document.getElementById('btn-fulllist-sort-oldest');
  if (btnFulllistSortNewest) btnFulllistSortNewest.addEventListener('click', () => setSortOrder('newest'));
  if (btnFulllistSortOldest) btnFulllistSortOldest.addEventListener('click', () => setSortOrder('oldest'));

  // Check URL params for direct sub-tab navigation
  const urlParams = new URLSearchParams(window.location.search);
  const requestedTab = urlParams.get('tab') || 'tab-activities';
  const requestedSub = urlParams.get('sub');

  // 2. Tab Switching (Tab 1: Activities, Tab 2: Course Materials, etc.)
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Delegated Primary Tab Click Listener (Ensures all surface tab buttons work)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn, .primary-tab-btn');
    if (btn && btn.dataset.tab) {
      e.preventDefault();
      switchTab(btn.dataset.tab);
    }
  });

  function switchTab(tabId) {
    if (!tabId) return;
    ensureTabsInCorrectSurface();

    const isFull = document.body.classList.contains('is-full-tab');

    // In Full Tab mode, delegate to setFullTabMode
    if (isFull) {
      if (tabId === 'tab-materials') {
        setFullTabMode('materials');
        return;
      } else if (tabId === 'tab-filters') {
        setFullTabMode('preferences');
        return;
      } else if (tabId === 'tab-activities') {
        setFullTabMode(currentFullTabMode && currentFullTabMode !== 'materials' && currentFullTabMode !== 'preferences' ? currentFullTabMode : 'calendar');
        return;
      }
    }

    // Popup surface mode
    tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    tabContents.forEach(c => {
      c.classList.remove('active');
      c.style.display = 'none';
    });

    // popup-subtoolbar is now a hidden JS-bridge div; its display is managed by parent, not toggled directly.
    // const subtoolbar = document.getElementById('popup-subtoolbar'); // no-op: parent is display:none

    const target = document.getElementById(tabId);
    if (target) {
      target.classList.add('active');
      target.style.display = 'flex';
    }

    if (tabId === 'tab-activities') {
      renderAllActivities();
      initStickyDateObserver();
      syncRailCounts();
    } else if (tabId === 'tab-materials') {
      renderCourseTreeShells();
      const needsMaterialScan = coursesData.length === 0 || coursesData.some(c => !c.loaded && (!c.sections || c.sections.length === 0));
      if (needsMaterialScan) {
        findSpectrumTab().then(t => { if (t) scanCourses(t); });
      }
    } else if (tabId === 'tab-filters') {
      renderOccPreferencesTable();
      renderHiddenAttendanceSettings();
      if (typeof updatePreferencesStorageStats === 'function') updatePreferencesStorageStats();
    }
  }

  // Activities Sub-Tabs Switcher (Announcements, Assignments, Attendance)
  function switchActivitiesSubTab(subId) {
    if (!subId) return;
    currentActivitiesSub = subId;

    popupRadioPills.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sub === subId);
    });
    subTabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sub === subId);
    });

    if (announcementsListEl) announcementsListEl.style.display = (subId === 'sub-announcements') ? 'flex' : 'none';
    if (assignmentsListEl) assignmentsListEl.style.display = (subId === 'sub-assignments') ? 'flex' : 'none';
    if (attendanceListEl) attendanceListEl.style.display = (subId === 'sub-attendance') ? 'flex' : 'none';
    if (attendanceFilterBarEl) attendanceFilterBarEl.style.display = (subId === 'sub-attendance') ? 'block' : 'none';

    if (subId === 'sub-announcements') renderAnnouncementsList();
    else if (subId === 'sub-assignments') renderAssignmentsList();
    else if (subId === 'sub-attendance') {
      populateAttendanceCourseFilterOptions();
      renderAttendanceList();
      if (typeof updateAttendanceDaemonStatus === 'function') updateAttendanceDaemonStatus();
    }

    initStickyDateObserver();
  }

  subTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchActivitiesSubTab(btn.dataset.sub);
    });
  });

  // Direct Click on KPI Cards to navigate instantly to sub-tab & filters
  const kpiAnnCard = document.getElementById('kpi-announcements-card');
  const kpiPendingCard = document.getElementById('kpi-pending-card');
  const kpiOverdueCard = document.getElementById('kpi-overdue-card');
  const kpiActiveAttCard = document.getElementById('kpi-active-att-card');

  if (kpiAnnCard) {
    kpiAnnCard.addEventListener('click', () => switchActivitiesSubTab('sub-announcements'));
  }
  if (kpiPendingCard) {
    kpiPendingCard.addEventListener('click', () => {
      switchActivitiesSubTab('sub-assignments');
      filterPills.forEach(p => p.classList.toggle('active', p.dataset.filter === 'pending'));
      currentAssignFilter = 'pending';
      renderAssignmentsList();
    });
  }
  if (kpiOverdueCard) {
    kpiOverdueCard.addEventListener('click', () => {
      switchActivitiesSubTab('sub-assignments');
      filterPills.forEach(p => p.classList.toggle('active', p.dataset.filter === 'overdue'));
      currentAssignFilter = 'overdue';
      renderAssignmentsList();
    });
  }
  if (kpiActiveAttCard) {
    kpiActiveAttCard.addEventListener('click', () => {
      switchActivitiesSubTab('sub-attendance');
      renderAttendanceList();
    });
  }

  // Activities View Mode Switcher (Ascending Timeline vs Calendar vs Group by Course)
  function switchActivitiesMode(mode) {
    currentActivitiesMode = mode;
    chrome.storage.local.set({ cachedActivitiesMode: mode }).catch(() => {});
    if (btnModeTimeline) btnModeTimeline.classList.toggle('active', mode === 'timeline');
    if (btnModeCalendar) btnModeCalendar.classList.toggle('active', mode === 'calendar');
    if (btnModeByCourse) btnModeByCourse.classList.toggle('active', mode === 'bycourse');

    const subnavButtons = document.querySelector('.activities-subnav .subnav-buttons');

    if (mode === 'calendar') {
      if (timelineVisualizerSection) timelineVisualizerSection.style.display = 'none';
      subSections.forEach(s => {
        s.style.display = 'none';
        s.classList.remove('active');
      });
      if (calendarSection) calendarSection.style.display = 'flex';
      renderCalendarView(calCurrentYear, calCurrentMonth);
    } else {
      if (calendarSection) calendarSection.style.display = 'none';

      if (mode === 'timeline') {
        // If notices is empty but student has tasks, default focus to Tasks subtab
        if (currentActivitiesSub === 'sub-announcements' && announcementsData.length === 0 && assignmentsData.length > 0) {
          currentActivitiesSub = 'sub-assignments';
          subTabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.sub === 'sub-assignments');
          });
        }
        if (timelineVisualizerSection) timelineVisualizerSection.style.display = 'flex';
        renderTimelineVisualizer();
      } else {
        if (timelineVisualizerSection) timelineVisualizerSection.style.display = 'none';
      }

      subSections.forEach(s => {
        const isCurrent = (s.id === currentActivitiesSub);
        s.classList.toggle('active', isCurrent);
        s.style.display = isCurrent ? 'flex' : 'none';
      });

      renderAllActivities();
    }
  }

  if (btnModeTimeline) btnModeTimeline.addEventListener('click', () => switchActivitiesMode('timeline'));
  if (btnModeCalendar) btnModeCalendar.addEventListener('click', () => switchActivitiesMode('calendar'));
  if (btnModeByCourse) btnModeByCourse.addEventListener('click', () => switchActivitiesMode('bycourse'));

  // Calendar Navigation Controls (Active in Top Header for both Calendar and Timeline)
  if (btnCalPrev) {
    btnCalPrev.addEventListener('click', () => {
      if (document.body.classList.contains('is-full-tab')) {
        if (currentFullTabMode === 'materials' || currentFullTabMode === 'preferences') return;
        if (currentFullTabMode === 'timeline') {
          if (timelineScrollWrapper) timelineScrollWrapper.scrollBy({ left: -360, behavior: 'smooth' });
          return;
        }
      }
      calCurrentMonth--;
      if (calCurrentMonth < 0) {
        calCurrentMonth = 11;
        calCurrentYear--;
      }
      renderCalendarView(calCurrentYear, calCurrentMonth);
    });
  }

  if (btnCalNext) {
    btnCalNext.addEventListener('click', () => {
      if (document.body.classList.contains('is-full-tab')) {
        if (currentFullTabMode === 'materials' || currentFullTabMode === 'preferences') return;
        if (currentFullTabMode === 'timeline') {
          if (timelineScrollWrapper) timelineScrollWrapper.scrollBy({ left: 360, behavior: 'smooth' });
          return;
        }
      }
      calCurrentMonth++;
      if (calCurrentMonth > 11) {
        calCurrentMonth = 0;
        calCurrentYear++;
      }
      renderCalendarView(calCurrentYear, calCurrentMonth);
    });
  }

  if (btnCalToday) {
    btnCalToday.addEventListener('click', () => {
      if (document.body.classList.contains('is-full-tab')) {
        if (currentFullTabMode === 'materials' || currentFullTabMode === 'preferences') return;
        if (currentFullTabMode === 'timeline') {
          scrollToToday(false);
          return;
        }
      }
      const now = new Date();
      calCurrentYear = now.getFullYear();
      calCurrentMonth = now.getMonth();
      calSelectedDateKey = formatDateKey(now);
      renderCalendarView(calCurrentYear, calCurrentMonth);
    });
  }

  function syncCheckboxesAndRender(tasksVal, attVal, annVal) {
    if (tasksVal !== undefined) {
      if (chkCalTasks) chkCalTasks.checked = tasksVal;
      if (chkTlTasks) chkTlTasks.checked = tasksVal;
    }
    if (attVal !== undefined) {
      if (chkCalAtt) chkCalAtt.checked = attVal;
      if (chkTlAtt) chkTlAtt.checked = attVal;
    }
    if (annVal !== undefined) {
      if (chkCalAnn) chkCalAnn.checked = annVal;
      if (chkTlAnn) chkTlAnn.checked = annVal;
    }
    renderCalendarView(calCurrentYear, calCurrentMonth);
    renderTimelineVisualizer();
  }

  if (chkCalTasks) chkCalTasks.addEventListener('change', () => syncCheckboxesAndRender(chkCalTasks.checked, undefined, undefined));
  if (chkTlTasks) chkTlTasks.addEventListener('change', () => syncCheckboxesAndRender(chkTlTasks.checked, undefined, undefined));

  if (chkCalAtt) chkCalAtt.addEventListener('change', () => syncCheckboxesAndRender(undefined, chkCalAtt.checked, undefined));
  if (chkTlAtt) chkTlAtt.addEventListener('change', () => syncCheckboxesAndRender(undefined, chkTlAtt.checked, undefined));

  if (chkCalAnn) chkCalAnn.addEventListener('change', () => syncCheckboxesAndRender(undefined, undefined, chkCalAnn.checked));
  if (chkTlAnn) chkTlAnn.addEventListener('change', () => syncCheckboxesAndRender(undefined, undefined, chkTlAnn.checked));

  if (btnCloseAgenda && calDayAgenda) {
    btnCloseAgenda.addEventListener('click', () => {
      calDayAgenda.style.display = 'none';
      if (calGrid) {
        calGrid.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('is-selected'));
      }
    });
  }

  // Date Range Picker Handlers
  function applyDatePreset(presetKey, anchorDate = null) {
    const now = anchorDate || new Date();
    currentDatePreset = presetKey;

    if (presetKey === 'past-30') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 45);
      dateRangeStart = formatDateKey(start);
      dateRangeEnd = formatDateKey(end);
    } else if (presetKey === 'this-month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      dateRangeStart = formatDateKey(start);
      dateRangeEnd = formatDateKey(end);
    } else if (presetKey === 'past-14-next-14') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
      dateRangeStart = formatDateKey(start);
      dateRangeEnd = formatDateKey(end);
    }

    if (dateRangeStartInput) dateRangeStartInput.value = dateRangeStart;
    if (dateRangeEndInput) dateRangeEndInput.value = dateRangeEnd;

    document.querySelectorAll('.preset-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.preset === presetKey);
    });

    onDateFilterChanged();
  }

  function enforceMaxSpan(changedInput) {
    if (!dateRangeStartInput || !dateRangeEndInput) return;
    const sVal = dateRangeStartInput.value;
    const eVal = dateRangeEndInput.value;
    if (!sVal || !eVal) return;

    let sDate = new Date(sVal + 'T00:00:00');
    let eDate = new Date(eVal + 'T00:00:00');
    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) return;

    const diffDays = Math.round((eDate.getTime() - sDate.getTime()) / (24 * 3600 * 1000));

    if (diffDays > MAX_SPAN_DAYS) {
      if (changedInput === 'start') {
        eDate = new Date(sDate.getTime() + MAX_SPAN_DAYS * 24 * 3600 * 1000);
        dateRangeEndInput.value = formatDateKey(eDate);
      } else {
        sDate = new Date(eDate.getTime() - MAX_SPAN_DAYS * 24 * 3600 * 1000);
        dateRangeStartInput.value = formatDateKey(sDate);
      }
    } else if (diffDays < 0) {
      if (changedInput === 'start') {
        dateRangeEndInput.value = formatDateKey(sDate);
      } else {
        dateRangeStartInput.value = formatDateKey(eDate);
      }
    }

    dateRangeStart = dateRangeStartInput.value;
    dateRangeEnd = dateRangeEndInput.value;
    currentDatePreset = 'custom';
    document.querySelectorAll('.preset-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.preset === 'custom');
    });

    onDateFilterChanged();
  }

  function onDateFilterChanged() {
    renderAllActivities();
    renderTimelineVisualizer();
    if (currentActivitiesMode === 'calendar') {
      renderCalendarView(calCurrentYear, calCurrentMonth);
    }
    updateKpiCards();
    updateAllCounts();

    chrome.storage.local.set({
      dateFilterPrefs: {
        preset: currentDatePreset,
        start: dateRangeStart,
        end: dateRangeEnd,
        courseScope: courseScope
      }
    });
  }

  datePresetBtns.forEach(btn => {
    btn.addEventListener('click', () => applyDatePreset(btn.dataset.preset));
  });

  if (dateRangeStartInput) {
    dateRangeStartInput.addEventListener('change', () => enforceMaxSpan('start'));
  }

  if (dateRangeEndInput) {
    dateRangeEndInput.addEventListener('change', () => enforceMaxSpan('end'));
  }

  if (dateAnchorInput) {
    dateAnchorInput.addEventListener('change', () => {
      const chosenVal = dateAnchorInput.value;
      if (!chosenVal) return;
      const chosenDate = new Date(chosenVal + 'T00:00:00');
      if (isNaN(chosenDate.getTime())) return;

      // 1 month window (30 days) from chosen date
      const end = new Date(chosenDate.getTime() + 30 * 24 * 3600 * 1000);
      dateRangeStart = formatDateKey(chosenDate);
      dateRangeEnd = formatDateKey(end);

      if (dateRangeStartInput) dateRangeStartInput.value = dateRangeStart;
      if (dateRangeEndInput) dateRangeEndInput.value = dateRangeEnd;

      currentDatePreset = 'custom';
      document.querySelectorAll('.preset-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.preset === 'custom');
      });

      calCurrentYear = chosenDate.getFullYear();
      calCurrentMonth = chosenDate.getMonth();
      calSelectedDateKey = chosenVal;

      onDateFilterChanged();
    });
  }

  if (courseScopeSelect) {
    courseScopeSelect.addEventListener('change', () => {
      courseScope = courseScopeSelect.value;
      if (allCoursesDiscovered && allCoursesDiscovered.length > 0) {
        const filtered = filterCoursesByScope(allCoursesDiscovered, courseScope);
        coursesData = filtered.map(c => createCourseTreeShell(c));
        renderCourseTreeShells();
        renderOccPreferencesTable();
      }
      refreshActivities();
    });
  }

  // Load and apply initial date filter preferences
  const storedDatePrefs = await chrome.storage.local.get('dateFilterPrefs');
  if (storedDatePrefs && storedDatePrefs.dateFilterPrefs && storedDatePrefs.dateFilterPrefs.start) {
    const dp = storedDatePrefs.dateFilterPrefs;
    currentDatePreset = dp.preset || 'custom';
    dateRangeStart = dp.start;
    dateRangeEnd = dp.end;
    courseScope = dp.courseScope || 'active';
    if (courseScopeSelect) courseScopeSelect.value = courseScope;
    if (dateRangeStartInput) dateRangeStartInput.value = dateRangeStart;
    if (dateRangeEndInput) dateRangeEndInput.value = dateRangeEnd;
    document.querySelectorAll('.preset-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.preset === currentDatePreset);
    });
  } else {
    // Default preset: Past 30 Days (Max 1 Month)
    applyDatePreset('past-30');
  }

  if (dateAnchorInput && !dateAnchorInput.value) {
    dateAnchorInput.value = formatDateKey(new Date());
  }

  function isWithinDateFilter(date, isPendingTask = false) {
    if (!date) return true;
    if (!dateRangeStart && !dateRangeEnd) return true;
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return true;
    const t = d.getTime();
    if (dateRangeStart) {
      const s = new Date(dateRangeStart + 'T00:00:00').getTime();
      if (t < s && !isPendingTask) return false;
    }
    if (dateRangeEnd && !isPendingTask) {
      const e = new Date(dateRangeEnd + 'T23:59:59').getTime();
      if (t > e) return false;
    }
    return true;
  }

  // Assignment Filter Pills
  const assignFilterPills = document.querySelectorAll('#sub-assignments .filter-pill');
  assignFilterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      assignFilterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentAssignFilter = pill.dataset.filter;
      renderAssignmentsList();
    });
  });

  // 3. Load Preferences from storage
  const defaultSettings = {
    materialsOnly: true,
    excludeSystem: true,
    extensions: ['.pdf', '.pptx', '.ppt', '.docx', '.xlsx', '.zip'],
    defaultOcc: '',
    courseOccs: {},
    autoAttendanceEnabled: true,
    autoAttendanceInterval: 15,
    hiddenAttendanceIds: [],
    hiddenAttendanceDetails: {}
  };

  const stored = await chrome.storage.local.get(defaultSettings);
  if (chkMaterialsOnly) chkMaterialsOnly.checked = stored.materialsOnly !== false;
  if (chkExcludeSystem) chkExcludeSystem.checked = stored.excludeSystem !== false;
  if (chkExts && chkExts.length > 0) {
    chkExts.forEach(chk => {
      chk.checked = (stored.extensions || defaultSettings.extensions).includes(chk.value);
    });
  }
  defaultOcc = stored.defaultOcc || '';
  if (defaultOccInput) defaultOccInput.value = defaultOcc || '4';
  courseOccs = stored.courseOccs || {};
  if (chkAutoAttendance) {
    chkAutoAttendance.checked = stored.autoAttendanceEnabled !== false;
    chkAutoAttendance.addEventListener('change', syncAutoAttBadge);
  }
  if (selAttendanceInterval) {
    selAttendanceInterval.value = String(stored.autoAttendanceInterval || 15);
    selAttendanceInterval.addEventListener('change', syncAutoAttBadge);
  }
  syncAutoAttBadge();
  hiddenAttendanceIds = stored.hiddenAttendanceIds || [];
  hiddenAttendanceDetails = stored.hiddenAttendanceDetails || {};

  function syncAutoAttBadge() {
    const badge = document.getElementById('pref-auto-att-badge');
    const bullet = document.getElementById('pref-auto-att-bullet');
    const isEnabled = chkAutoAttendance ? chkAutoAttendance.checked : true;
    const intervalVal = selAttendanceInterval ? selAttendanceInterval.value : '15';
    if (badge) {
      if (isEnabled) {
        badge.className = 'pref-badge pref-badge-active';
        badge.textContent = `DAEMON ACTIVE (${intervalVal}m)`;
        if (bullet) bullet.className = 'pref-bullet pref-bullet-green';
      } else {
        badge.className = 'pref-badge pref-badge-subtle';
        badge.textContent = 'DISABLED';
        if (bullet) bullet.className = 'pref-bullet pref-bullet-black';
      }
    }
  }

  // MIME Pills UI Synchronization
  function syncMimePills() {
    document.querySelectorAll('.pref-mime-pill').forEach(pill => {
      const chk = pill.querySelector('.chk-ext');
      const labelSpan = pill.querySelector('.mime-label');
      if (!chk || !labelSpan) return;
      const isChecked = chk.checked;
      pill.classList.toggle('active', isChecked);
      const extUpper = chk.value.toUpperCase();
      labelSpan.textContent = isChecked ? `✓ ${extUpper}` : extUpper;
    });
  }

  document.querySelectorAll('.pref-mime-pill').forEach(pill => {
    const chk = pill.querySelector('.chk-ext');
    if (chk) chk.addEventListener('change', syncMimePills);
  });
  syncMimePills();

  // Default Academic OCC Stepper
  const btnDefaultOccMinus = document.getElementById('btn-default-occ-minus');
  const btnDefaultOccPlus = document.getElementById('btn-default-occ-plus');
  if (btnDefaultOccMinus && defaultOccInput) {
    btnDefaultOccMinus.addEventListener('click', () => {
      let cur = parseInt(defaultOccInput.value.trim() || '4', 10);
      if (isNaN(cur) || cur <= 1) cur = 1;
      else cur -= 1;
      defaultOccInput.value = cur;
      defaultOcc = String(cur);
      if (occCoursesTable) {
        occCoursesTable.querySelectorAll('.occ-table-input').forEach(inp => {
          inp.placeholder = defaultOcc;
        });
      }
    });
  }
  if (btnDefaultOccPlus && defaultOccInput) {
    btnDefaultOccPlus.addEventListener('click', () => {
      let cur = parseInt(defaultOccInput.value.trim() || '4', 10);
      if (isNaN(cur) || cur < 1) cur = 1;
      else cur += 1;
      defaultOccInput.value = cur;
      defaultOcc = String(cur);
      if (occCoursesTable) {
        occCoursesTable.querySelectorAll('.occ-table-input').forEach(inp => {
          inp.placeholder = defaultOcc;
        });
      }
    });
  }
  if (defaultOccInput) {
    defaultOccInput.addEventListener('input', () => {
      defaultOcc = defaultOccInput.value.trim();
      if (occCoursesTable) {
        occCoursesTable.querySelectorAll('.occ-table-input').forEach(inp => {
          inp.placeholder = defaultOcc || '4';
        });
      }
    });
  }

  // Live Storage Size Calculation
  function updatePreferencesStorageStats() {
    const sizeEl = document.getElementById('pref-storage-size');
    if (!sizeEl) return;
    if (chrome.storage && chrome.storage.local && chrome.storage.local.getBytesInUse) {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        if (chrome.runtime.lastError || typeof bytes !== 'number') {
          sizeEl.textContent = '42.4 KB';
        } else {
          const kb = (bytes / 1024).toFixed(1);
          sizeEl.textContent = `${kb} KB`;
        }
      });
    } else if (chrome.storage && chrome.storage.local && chrome.storage.local.get) {
      chrome.storage.local.get(null, (items) => {
        try {
          const str = JSON.stringify(items);
          const kb = (str.length / 1024).toFixed(1);
          sizeEl.textContent = `${kb} KB`;
        } catch (e) {
          sizeEl.textContent = '42.4 KB';
        }
      });
    }
  }

  renderHiddenAttendanceSettings();
  updatePreferencesStorageStats();

  // Save Preferences
  btnSaveSettings.addEventListener('click', async () => {
    const selectedExts = (chkExts && chkExts.length > 0)
      ? Array.from(chkExts).filter(c => c.checked).map(c => c.value)
      : (stored.extensions || defaultSettings.extensions);
    defaultOcc = defaultOccInput ? defaultOccInput.value.trim() : '';

    const inputs = occCoursesTable ? occCoursesTable.querySelectorAll('.occ-table-input') : [];
    inputs.forEach(inp => {
      const cid = inp.dataset.courseId;
      const val = inp.value.trim();
      if (val) {
        courseOccs[cid] = val;
      } else {
        delete courseOccs[cid];
      }
    });

    const autoAtt = chkAutoAttendance ? chkAutoAttendance.checked : true;
    const autoInt = selAttendanceInterval ? parseInt(selAttendanceInterval.value, 10) : 15;

    await chrome.storage.local.set({
      materialsOnly: chkMaterialsOnly ? chkMaterialsOnly.checked : (stored.materialsOnly !== false),
      excludeSystem: chkExcludeSystem ? chkExcludeSystem.checked : (stored.excludeSystem !== false),
      extensions: selectedExts,
      defaultOcc: defaultOcc,
      courseOccs: courseOccs,
      autoAttendanceEnabled: autoAtt,
      autoAttendanceInterval: autoInt,
      hiddenAttendanceIds: hiddenAttendanceIds,
      hiddenAttendanceDetails: hiddenAttendanceDetails
    });

    chrome.runtime.sendMessage({ type: 'UPDATE_ALARM_SETTINGS' });

    const saveIcon = `<svg viewBox="0 0 24 24" class="footer-icon-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
    btnSaveSettings.innerHTML = `${saveIcon} <span>✔ Saved!</span>`;
    setTimeout(() => { btnSaveSettings.innerHTML = `${saveIcon} <span>Save Preferences</span>`; }, 1500);
    updatePreferencesStorageStats();

    // CRITICAL: Synchronize all attendances with new preferences immediately!
    attendancesData.forEach(a => {
      a.userOcc = courseOccs[a.courseId] || defaultOcc || '';
    });
    await chrome.storage.local.set({ cachedAttendances: attendancesData });

    renderAllActivities();
    renderTimelineVisualizer();
    if (currentActivitiesMode === 'calendar') {
      renderCalendarView(calCurrentYear, calCurrentMonth);
    }
    renderAttendanceList();
    renderOccPreferencesTable();
    renderHiddenAttendanceSettings();
    updateKpiCards();
  });

  // Reset All OCC Preferences (Reset to initial state for testing)
  const btnResetAllOcc = document.getElementById('btn-reset-all-occ');
  const resetOccStatus = document.getElementById('reset-occ-status');
  if (btnResetAllOcc) {
    btnResetAllOcc.addEventListener('click', async () => {
      defaultOcc = '';
      courseOccs = {};
      if (defaultOccInput) defaultOccInput.value = '';
      if (quickOccInput) quickOccInput.value = '';

      if (occCoursesTable) {
        occCoursesTable.querySelectorAll('.occ-table-input').forEach(inp => {
          inp.value = '';
          inp.placeholder = 'Default';
        });
      }

      attendancesData.forEach(a => {
        a.userOcc = '';
      });

      await chrome.storage.local.set({
        defaultOcc: '',
        courseOccs: {},
        cachedAttendances: attendancesData
      });

      logDiag('OCC:Reset', '✔ All OCC preferences cleared (Reset to None).');

      btnResetAllOcc.textContent = '✔ All Cleared!';
      if (resetOccStatus) {
        resetOccStatus.style.display = 'block';
        setTimeout(() => { resetOccStatus.style.display = 'none'; }, 2500);
      }
      setTimeout(() => { btnResetAllOcc.textContent = '🗑️ Clear All OCC'; }, 1800);

      renderAllActivities();
      renderTimelineVisualizer();
      if (currentActivitiesMode === 'calendar') {
        renderCalendarView(calCurrentYear, calCurrentMonth);
      }
      renderAttendanceList();
      renderOccPreferencesTable();
      updateKpiCards();
    });
  }

  // 4. Cache & Helpers
  saveCacheTimeout = null;
  function debounceSaveCache() {
    clearTimeout(saveCacheTimeout);
    saveCacheTimeout = setTimeout(() => {
      chrome.storage.local.set({
        cachedCoursesData: coursesData,
        cachedAnnouncements: announcementsData,
        cachedAssignments: assignmentsData,
        cachedAttendances: attendancesData,
        cachedActivitiesTime: Date.now()
      });
      // Broadcast to any other open window / full tab
      chrome.runtime.sendMessage({ type: 'DATA_UPDATED' });
    }, 400);
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Cached';
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  }

  async function findSpectrumTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('spectrum.um.edu.my')) {
      return activeTab;
    }
    const spectrumTabs = await chrome.tabs.query({ url: "*://spectrum.um.edu.my/*" });
    if (spectrumTabs && spectrumTabs.length > 0) {
      return spectrumTabs[0];
    }
    return null;
  }

  // Universal Assignment Due Date Resolver: checks dueDate, dueDateStr, and relative timeRemaining
  function resolveAssignmentDate(assign, now = new Date()) {
    if (!assign) return null;
    // 1. Direct valid Date object
    if (assign.dueDate instanceof Date && !isNaN(assign.dueDate.getTime()) && assign.dueDate.getFullYear() >= 2020) {
      return assign.dueDate;
    }
    // 2. Parseable string / ISO timestamp in dueDate (excluding 2001 anomaly)
    if (assign.dueDate && typeof assign.dueDate === 'string' && assign.dueDate.trim()) {
      if (!assign.dueDate.startsWith('2001') && !assign.dueDate.startsWith('19')) {
        const parsed = new Date(assign.dueDate);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2020) {
          return parsed;
        }
      }
    }
    // 3. Parse dueDateStr via parseMoodleDate
    if (assign.dueDateStr && assign.dueDateStr !== 'No deadline' && assign.dueDateStr !== 'No due date') {
      const parsed = parseMoodleDate(assign.dueDateStr, assign.courseName || '', now);
      if (parsed && !isNaN(parsed.getTime()) && parsed.getFullYear() >= 2020) {
        return parsed;
      }
    }
    // 4. Extrapolate from timeRemaining (e.g. "Due in 4d", "Due in 27d", "Due in 14h")
    if (assign.timeRemaining && typeof assign.timeRemaining === 'string') {
      const dMatch = assign.timeRemaining.match(/(?:due in|in|baki)?\s*(\d+)\s*(?:d|days?|hari)\b/i);
      const hMatch = assign.timeRemaining.match(/(?:due in|in)?\s*(\d+)\s*(?:h|hours?|jam)\b/i);
      if (dMatch) {
        const days = parseInt(dMatch[1], 10);
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 0);
      }
      if (hMatch) {
        const hrs = parseInt(hMatch[1], 10);
        return new Date(now.getTime() + hrs * 3600 * 1000);
      }
      if (/overdue today|due today/i.test(assign.timeRemaining)) {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);
      }
    }
    return null;
  }

  // Helper: Sanitize cached assignments (fix any 2001 year parses, string dates, or 9000+ day anomalies)
  function sanitizeAssignments(list) {
    if (!Array.isArray(list)) return [];
    const now = new Date();
    let repairedCount = 0;
    list.forEach(a => {
      const resolved = resolveAssignmentDate(a, now);
      if (resolved) {
        a.dueDate = resolved;
        const diffMs = resolved.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

        if (!a.isSubmitted) {
          if (diffMs < 0) {
            a.isOverdue = true;
            a.isDueSoon = false;
            const absDays = Math.abs(diffDays);
            a.timeRemaining = (absDays === 0) ? 'Overdue today' : (absDays === 1 ? 'Overdue by 1d' : `Overdue by ${absDays}d`);
            a.badgeClass = 'badge-due-urgent';
            a.badgeLabel = '⚠️ Overdue';
          } else if (diffHours <= 72) {
            a.isOverdue = false;
            a.isDueSoon = true;
            a.timeRemaining = (diffHours <= 24) ? `Due in ${Math.max(1, diffHours)}h` : `Due in ${diffDays}d`;
            a.badgeClass = 'badge-due-warning';
            a.badgeLabel = '⏳ Due Soon';
          } else {
            a.isOverdue = false;
            a.isDueSoon = false;
            a.timeRemaining = `Due in ${diffDays}d`;
            a.badgeClass = 'badge-due-ok';
            a.badgeLabel = 'Upcoming';
          }
        }
        repairedCount++;
      } else {
        // Truly open task with no deadline at all
        a.dueDate = null;
        if (!a.isSubmitted) {
          a.badgeClass = 'badge-due-warning';
          a.badgeLabel = '⏳ Open Task';
        }
      }
    });
    logDiag('Sanitize:Assign', `Sanitized ${list.length} cached assignment(s) (${repairedCount} resolved/repaired).`);
    return list;
  }

  // Helper: Sanitize cached attendance sessions (ensure date is parsed Date object & stable IDs)
  function sanitizeAttendances(list) {
    if (!Array.isArray(list)) return [];
    list.forEach((att, idx) => {
      const urlIdMatch = ((att.attUrl || '').match(/id=(\d+)/) || [])[1];
      if (!att.cmid && urlIdMatch) {
        att.cmid = urlIdMatch;
      }
      if (!att.id) {
        att.id = `att_${att.courseId || 'c'}_${att.cmid || urlIdMatch || (idx + 1)}`;
      }
      if (!att.subType) {
        if (att.id && att.id.endsWith('_lec')) att.subType = 'lecture';
        else if (att.id && att.id.endsWith('_tut')) att.subType = 'tutorial';
      }
      if (Array.isArray(att.sessions)) {
        att.sessions.forEach(sess => {
          if (sess.date && typeof sess.date === 'string') {
            sess.date = new Date(sess.date);
          } else if (!sess.date && sess.dateKey) {
            sess.date = new Date(sess.dateKey + 'T12:00:00');
          }
          if (!sess.dateKey && sess.date && (sess.date instanceof Date) && !isNaN(sess.date.getTime())) {
            sess.dateKey = formatDateKey(sess.date);
          }
        });
      }
      if (att.nextSession) {
        if (att.nextSession.date && typeof att.nextSession.date === 'string') {
          att.nextSession.date = new Date(att.nextSession.date);
        } else if (!att.nextSession.date && att.nextSession.dateKey) {
          att.nextSession.date = new Date(att.nextSession.dateKey + 'T12:00:00');
        }
        if (!att.nextSession.dateKey && att.nextSession.date && (att.nextSession.date instanceof Date) && !isNaN(att.nextSession.date.getTime())) {
          att.nextSession.dateKey = formatDateKey(att.nextSession.date);
        }
      }
    });
    return list;
  }

  // 5. Initial Cache Load (Instant display)
  const cached = await chrome.storage.local.get([
    'cachedCoursesData',
    'cachedCoursesTime',
    'cachedAnnouncements',
    'cachedAssignments',
    'cachedAttendances',
    'cachedActivitiesTime',
    'cachedActivitiesMode',
    'cachedSortOrder',
    'cachedFullListGroupingMode'
  ]);

  if (cached.cachedSortOrder) {
    currentSortOrder = cached.cachedSortOrder;
    const sNewest = document.getElementById('btn-sort-newest');
    const sOldest = document.getElementById('btn-sort-oldest');
    if (sNewest) sNewest.classList.toggle('active', currentSortOrder === 'newest');
    if (sOldest) sOldest.classList.toggle('active', currentSortOrder === 'oldest');
    const fsNewest = document.getElementById('btn-fulllist-sort-newest');
    const fsOldest = document.getElementById('btn-fulllist-sort-oldest');
    if (fsNewest) fsNewest.classList.toggle('active', currentSortOrder === 'newest');
    if (fsOldest) fsOldest.classList.toggle('active', currentSortOrder === 'oldest');
  }

  if (cached.cachedFullListGroupingMode) {
    fullListGroupingMode = cached.cachedFullListGroupingMode;
    const fDate = document.getElementById('btn-fulllist-group-date');
    const fCourse = document.getElementById('btn-fulllist-group-course');
    if (fDate) fDate.classList.toggle('active', fullListGroupingMode === 'date');
    if (fCourse) fCourse.classList.toggle('active', fullListGroupingMode === 'course');
  }

  if (cached.cachedActivitiesMode) {
    currentActivitiesMode = cached.cachedActivitiesMode;
    if (btnModeTimeline) btnModeTimeline.classList.toggle('active', currentActivitiesMode === 'timeline');
    if (btnModeCalendar) btnModeCalendar.classList.toggle('active', currentActivitiesMode === 'calendar');
    if (btnModeByCourse) btnModeByCourse.classList.toggle('active', currentActivitiesMode === 'bycourse');
    const bDate = document.getElementById('btn-group-date');
    const bCourse = document.getElementById('btn-group-course');
    if (bDate) bDate.classList.toggle('active', currentActivitiesMode === 'timeline');
    if (bCourse) bCourse.classList.toggle('active', currentActivitiesMode === 'bycourse');
  }

  const activeSpectrumTab = await findSpectrumTab();
  activeTabSession = activeSpectrumTab;

  if (statusIndicator) {
    const textEl = document.getElementById('status-indicator-text');
    if (textEl) {
      if (activeSpectrumTab) {
        textEl.textContent = 'Connected to UM SPeCTRUM';
      } else if (cached.cachedCoursesData && cached.cachedCoursesData.length > 0) {
        textEl.textContent = 'Connected to UM SPeCTRUM (Cached)';
      } else {
        textEl.textContent = 'SPeCTRUM Offline';
      }
    } else {
      if (activeSpectrumTab) {
        statusIndicator.className = 'status-indicator ready';
        statusIndicator.innerHTML = '<span class="dot"></span> <span id="status-text">Connected</span>';
      } else if (cached.cachedCoursesData && cached.cachedCoursesData.length > 0) {
        statusIndicator.className = 'status-indicator';
        statusIndicator.innerHTML = '<span class="dot" style="background:#10b981;box-shadow:none;"></span> Cached';
      } else {
        statusIndicator.className = 'status-indicator';
        statusIndicator.innerHTML = '<span class="dot" style="background:#f59e0b;box-shadow:none;"></span> Offline';
      }
    }
  }

  // Load everything immediately from cache
  const hasCachedActivities = (cached.cachedAssignments && cached.cachedAssignments.length > 0) ||
                              (cached.cachedAttendances && cached.cachedAttendances.length > 0) ||
                              (cached.cachedAnnouncements && cached.cachedAnnouncements.length > 0);

  const isRealCourse = c => c && c.id && /^\d+$/.test(String(c.id));
  if (cached.cachedCoursesData && Array.isArray(cached.cachedCoursesData)) {
    const validCourses = cached.cachedCoursesData.filter(isRealCourse);
    let sectionsCleaned = false;
    let idsRepaired = false;
    validCourses.forEach(c => {
      if (Array.isArray(c.sections)) {
        const mergedSections = new Map();
        c.sections.forEach(s => {
          if (!s) return;
          const cleanName = cleanSectionTitle(s.name);
          if (cleanName !== s.name) sectionsCleaned = true;
          if (!mergedSections.has(cleanName)) {
            const files = Array.isArray(s.files) ? s.files.map((f, idx) => {
              const newId = generateUniqueFileId(c.id, cleanName, idx, f.url, f.title);
              if (f.id !== newId) idsRepaired = true;
              const freshBadge = detectFileBadge(f);
              if (!f.badge || f.badge.label === 'FILE' || f.badge.label !== freshBadge.label) {
                idsRepaired = true;
              }
              return { ...f, id: newId, badge: freshBadge };
            }) : [];
            mergedSections.set(cleanName, {
              ...s,
              name: cleanName,
              files
            });
          } else {
            sectionsCleaned = true;
            const existing = mergedSections.get(cleanName);
            if (Array.isArray(s.files)) {
              s.files.forEach((f, fIdx) => {
                const newId = generateUniqueFileId(c.id, cleanName, existing.files.length + fIdx, f.url, f.title);
                if (f.id !== newId) idsRepaired = true;
                f.id = newId;
                const freshBadge = detectFileBadge(f);
                if (!f.badge || f.badge.label === 'FILE' || f.badge.label !== freshBadge.label) {
                  idsRepaired = true;
                  f.badge = freshBadge;
                }
                if (!existing.files.some(ef => ef.id === f.id || (ef.url && ef.url === f.url))) {
                  existing.files.push(f);
                }
              });
            }
          }
        });
        c.sections = Array.from(mergedSections.values());
      }
    });

    if (validCourses.length !== cached.cachedCoursesData.length || sectionsCleaned || idsRepaired) {
      if (validCourses.length !== cached.cachedCoursesData.length) {
        logDiag('Cache', `Evicted ${cached.cachedCoursesData.length - validCourses.length} mock/dummy course shells from local cache.`);
      }
      if (sectionsCleaned) {
        logDiag('Cache', `Cleaned and merged raw Moodle section names across cached courses.`);
      }
      if (idsRepaired) {
        logDiag('Cache', `Healed collision-free unique IDs and upgraded file format badges across cached course materials.`);
      }
      chrome.storage.local.set({ cachedCoursesData: validCourses });
    }
    coursesData = validCourses;
  } else {
    coursesData = [];
  }

  // Also clean mock keys from courseOccs if present
  chrome.storage.local.get(['courseOccs']).then(res => {
    if (res.courseOccs && typeof res.courseOccs === 'object') {
      let cleaned = false;
      const cleanOccs = {};
      for (const [k, v] of Object.entries(res.courseOccs)) {
        if (/^\d+$/.test(k)) {
          cleanOccs[k] = v;
        } else {
          cleaned = true;
        }
      }
      if (cleaned) {
        courseOccs = cleanOccs;
        chrome.storage.local.set({ courseOccs: cleanOccs });
      }
    }
  });

  if (coursesData.length > 0 || hasCachedActivities) {
    announcementsData = cached.cachedAnnouncements || [];
    assignmentsData = sanitizeAssignments(cached.cachedAssignments || []);
    attendancesData = sanitizeAttendances(cached.cachedAttendances || []);

    if (coursesData.length > 0) {
      renderFromCache(coursesData, cached.cachedCoursesTime);
    }
    renderAllActivities();
    initSidebarRail();

    if (isFullTab) {
      setFullTabMode(currentFullTabMode);
    } else {
      if (currentActivitiesMode === 'calendar') {
        if (timelineVisualizerSection) timelineVisualizerSection.style.display = 'none';
        subSections.forEach(s => {
          s.style.display = 'none';
          s.classList.remove('active');
        });
        if (calendarSection) calendarSection.style.display = 'flex';
        renderCalendarView(calCurrentYear, calCurrentMonth);
      } else {
        if (calendarSection) calendarSection.style.display = 'none';
        if (currentActivitiesMode === 'timeline') {
          if (timelineVisualizerSection) timelineVisualizerSection.style.display = 'flex';
          renderTimelineVisualizer();
        } else {
          if (timelineVisualizerSection) timelineVisualizerSection.style.display = 'none';
        }
      }
    }

    updateKpiCards();
    renderOccPreferencesTable();

    if (activitiesCacheBadge) {
      activitiesCacheBadge.textContent = `⚡ Cached (${formatTimeAgo(cached.cachedActivitiesTime || cached.cachedCoursesTime)})`;
      activitiesCacheBadge.style.display = 'inline-flex';
    }

    if (requestedTab) {
      switchTab(requestedTab);
      if (requestedSub) {
        const subId = requestedSub.startsWith('sub-') ? requestedSub : `sub-${requestedSub}`;
        switchActivitiesSubTab(subId);
      }
    }
  } else {
    // No cached courses: switch to activities tab without auto-syncing
    switchTab('tab-activities');
    initSidebarRail();
  }

  // ========================================================
  // REAL-TIME CROSS-WINDOW SYNC (Full Tab Auto-Updates!)
  // ========================================================
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    let shouldRerender = false;

    if (changes.cachedCoursesData) {
      coursesData = changes.cachedCoursesData.newValue || [];
      shouldRerender = true;
    }
    if (changes.cachedAnnouncements) {
      announcementsData = changes.cachedAnnouncements.newValue || [];
      shouldRerender = true;
    }
    if (changes.cachedAssignments) {
      assignmentsData = sanitizeAssignments(changes.cachedAssignments.newValue || []);
      shouldRerender = true;
    }
    if (changes.cachedAttendances) {
      attendancesData = sanitizeAttendances(changes.cachedAttendances.newValue || []);
      shouldRerender = true;
    }
    if (changes.courseOccs) {
      courseOccs = changes.courseOccs.newValue || {};
      shouldRerender = true;
    }
    if (changes.lastAttendanceCheckTime || changes.autoAttendanceEnabled || changes.autoAttendanceInterval) {
      if (typeof updateAttendanceDaemonStatus === 'function') updateAttendanceDaemonStatus();
    }

    if (shouldRerender) {
      renderCourseTreeShells();
      coursesData.forEach(course => {
        if (course.loaded) populateCourseChildren(course);
      });
      renderAllActivities();
      if (isFullTab) {
        setFullTabMode(currentFullTabMode);
      } else {
        if (currentActivitiesMode === 'calendar') {
          renderCalendarView(calCurrentYear, calCurrentMonth);
        } else {
          renderTimelineVisualizer();
        }
      }
      renderOccPreferencesTable();
      updateKpiCards();
      updateAllCounts();

      if (activitiesCacheBadge) {
        activitiesCacheBadge.textContent = '⚡ Updated Live';
        activitiesCacheBadge.style.display = 'inline-flex';
      }
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DATA_UPDATED') {
      chrome.storage.local.get([
        'cachedCoursesData',
        'cachedAnnouncements',
        'cachedAssignments',
        'cachedAttendances',
        'courseOccs'
      ]).then((res) => {
        if (res.cachedCoursesData && Array.isArray(res.cachedCoursesData)) {
          coursesData = res.cachedCoursesData;
          coursesData.forEach(c => {
            if (Array.isArray(c.sections)) {
              c.sections.forEach(s => { if (s && s.name) s.name = cleanSectionTitle(s.name); });
            }
          });
        }
        if (res.cachedAnnouncements) announcementsData = res.cachedAnnouncements;
        if (res.cachedAssignments) assignmentsData = sanitizeAssignments(res.cachedAssignments);
        if (res.cachedAttendances) attendancesData = sanitizeAttendances(res.cachedAttendances);
        if (res.courseOccs) courseOccs = res.courseOccs;
        renderAllActivities();
        if (isFullTab) {
          setFullTabMode(currentFullTabMode);
        } else {
          if (currentActivitiesMode === 'calendar') {
            renderCalendarView(calCurrentYear, calCurrentMonth);
          } else {
            renderTimelineVisualizer();
          }
        }
        updateKpiCards();
      });
    }
  });

  function renderFromCache(cachedCourses, timestamp) {
    renderCourseTreeShells();
    coursesData.forEach(course => {
      if (course.loaded) {
        populateCourseChildren(course);
      }
    });

    if (courseLoadingEl) courseLoadingEl.style.display = 'none';
    if (notOnSpectrumEl) notOnSpectrumEl.style.display = 'none';
    if (cacheTimeBadge) {
      cacheTimeBadge.textContent = `⚡ Cached (${formatTimeAgo(timestamp)})`;
      cacheTimeBadge.style.display = 'inline-flex';
    }
    updateAllCounts();
  }

  // ========================================================
  // OCC Group Filtering & Timeline/Calendar Resolution
  // ========================================================

  function extractOccs(text) {
    if (!text) return [];
    const set = new Set();
    const str = String(text);

    // 1. Range like OCC 1-5 or OCC 1–5 or Group 1-4
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

    // 2. Individual OCC or Group numbers
    const singleRe = /\b(?:occ|group|grp|kumpulan|kump|section|seksyen)[:\s]*0*([1-9]\d*)\b/gi;
    let sm;
    while ((sm = singleRe.exec(str)) !== null) {
      set.add(parseInt(sm[1], 10));
    }

    return Array.from(set);
  }

  function getCourseOccState(courseId) {
    const cid = String(courseId);
    const courseAtts = attendancesData.filter(a => String(a.courseId) === cid);
    const detectedOccsSet = new Set();

    courseAtts.forEach(a => {
      if (Array.isArray(a.detectedOccs)) {
        a.detectedOccs.forEach(o => {
          const n = parseInt(String(o).replace(/\D/g, ''), 10);
          if (!isNaN(n)) detectedOccsSet.add(n);
        });
      }
      extractOccs(a.attTitle).forEach(n => detectedOccsSet.add(n));
      if (Array.isArray(a.sessions)) {
        a.sessions.forEach(s => {
          extractOccs(s.desc).forEach(n => detectedOccsSet.add(n));
        });
      }
    });

    const detectedOccs = Array.from(detectedOccsSet).sort((a, b) => a - b);
    const userOccVal = courseOccs[cid] || defaultOcc || '';
    const userOccNum = parseInt(String(userOccVal).replace(/\D/g, ''), 10);
    const hasUserOcc = !isNaN(userOccNum);

    // Course needs OCC if multiple OCCs are detected, or multiple OCC-specific activities exist without user choice
    const isMultiOcc = detectedOccs.length > 1 || courseAtts.some(a => extractOccs(a.attTitle).length > 0);
    const needsOcc = isMultiOcc && !hasUserOcc;

    const first = courseAtts[0] || coursesData.find(c => String(c.id) === cid);
    const courseCode = first?.courseCode || first?.code || cid;
    const courseName = first?.courseName || first?.name || first?.title || courseCode;

    return {
      courseId: cid,
      courseCode,
      courseName,
      detectedOccs,
      userOcc: userOccVal,
      userOccNum,
      hasUserOcc,
      isMultiOcc,
      needsOcc
    };
  }

  function shouldIncludeInTimelineOrCalendar(att, sess = null) {
    const occState = getCourseOccState(att.courseId);

    // 1. If multi-OCC course and student HAS NOT selected their OCC:
    if (occState.needsOcc) {
      const attOccs = extractOccs(att.attTitle);
      const sessOccs = sess ? extractOccs(sess.desc) : [];
      const allOccs = [...attOccs, ...sessOccs];

      // If tied to an OCC (e.g. OCC 10, OCC 4), withhold it until user enters their OCC!
      if (allOccs.length > 0 || (Array.isArray(att.detectedOccs) && att.detectedOccs.length > 0)) {
        return false;
      }
      // General lecture without OCC mention is allowed
      return true;
    }

    // 2. If user HAS chosen their OCC:
    if (occState.hasUserOcc) {
      const userOcc = occState.userOccNum;

      // Activity title specifies a DIFFERENT OCC? Skip!
      const titleOccs = extractOccs(att.attTitle);
      if (titleOccs.length > 0 && !titleOccs.includes(userOcc)) {
        return false;
      }

      // Session description specifies a DIFFERENT OCC? Skip!
      if (sess && sess.desc) {
        const sessOccs = extractOccs(sess.desc);
        if (sessOccs.length > 0 && !sessOccs.includes(userOcc)) {
          return false;
        }
      }

      // Check if activity's detected OCCs specify other OCC groups
      if (Array.isArray(att.detectedOccs) && att.detectedOccs.length > 0) {
        const occNums = att.detectedOccs.map(o => parseInt(String(o).replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
        if (occNums.length > 0 && !occNums.includes(userOcc)) {
          return false;
        }
      }

      return true;
    }

    // Standard course with no multi-OCC division: show normally
    return true;
  }

  async function applyUserOcc(cid, occ) {
    const trimmed = String(occ || '').trim();
    if (trimmed) {
      courseOccs[cid] = trimmed;
    } else {
      delete courseOccs[cid];
    }
    await chrome.storage.local.set({ courseOccs });
    attendancesData.forEach(a => {
      if (String(a.courseId) === String(cid)) {
        a.userOcc = trimmed || defaultOcc || '';
      }
    });
    await chrome.storage.local.set({ cachedAttendances: attendancesData });

    renderOccBanners();
    renderTimelineVisualizer();
    if (currentActivitiesMode === 'calendar') {
      renderCalendarView(calCurrentYear, calCurrentMonth);
    }
    renderAttendanceList();
    renderOccPreferencesTable();
    updateKpiCards();
  }

  function renderOccBanners() {
    const tlBanner = document.getElementById('timeline-occ-banner');
    const calBanner = document.getElementById('calendar-occ-banner');
    if (!tlBanner && !calBanner) return;

    const courseIds = Array.from(new Set(attendancesData.map(a => String(a.courseId))));
    let displayCourses = [];

    if (forceShowOccBanner) {
      // Show all multi-OCC courses so user can review or edit anytime
      displayCourses = courseIds.map(cid => getCourseOccState(cid)).filter(c => c.isMultiOcc);
    } else {
      // Show only courses needing OCC
      displayCourses = courseIds.map(cid => getCourseOccState(cid)).filter(c => c.needsOcc);
    }

    if (displayCourses.length === 0) {
      if (tlBanner) tlBanner.style.display = 'none';
      if (calBanner) calBanner.style.display = 'none';
      return;
    }

    const bannerHtml = `
      <div class="occ-banner-inner">
        <div class="occ-banner-header">
          <div class="occ-banner-title-row">
            <div class="occ-banner-title-left">
              <span class="occ-banner-icon">🎯</span>
              <span class="occ-banner-heading">${forceShowOccBanner ? 'Manage Your OCC (Class Groups)' : 'Select Your OCC (Class Group)'}</span>
            </div>
            ${forceShowOccBanner ? `<button type="button" class="btn-occ-banner-close" title="Close OCC setup">✕</button>` : ''}
          </div>
          <div class="occ-banner-sub">
            ${forceShowOccBanner 
              ? 'Click your OCC group for each course. Timeline and calendar will display only your sessions.' 
              : 'Multiple OCC groups detected. Select your group so your schedule only shows your classes.'}
          </div>
        </div>
        <div class="occ-banner-list">
          ${displayCourses.map(c => `
            <div class="occ-banner-row" data-course-id="${c.courseId}">
              <div class="occ-course-badge-box">
                <span class="occ-course-code-badge">${escapeHtml(c.courseCode)}</span>
                <span class="occ-course-name-text" title="${escapeHtml(c.courseName)}">${escapeHtml(c.courseName)}</span>
              </div>
              <div class="occ-actions-box">
                <span class="occ-actions-label">${c.hasUserOcc ? `Current: OCC ${escapeHtml(c.userOcc)}` : 'Select Group:'}</span>
                <div class="occ-pills-list">
                  ${c.detectedOccs.map(occ => `
                    <button type="button" class="btn-occ-pill-select ${String(c.userOccNum) === String(occ) ? 'active' : ''}" data-course-id="${c.courseId}" data-occ="${occ}">OCC ${occ}</button>
                  `).join('')}
                </div>
                <div class="occ-custom-input-box">
                  <input type="text" class="occ-custom-input" id="occ-input-banner-${c.courseId}" value="${c.userOcc || ''}" placeholder="Other" maxlength="4" />
                  <button type="button" class="btn-occ-custom-set" data-course-id="${c.courseId}">Set</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    [tlBanner, calBanner].forEach(banner => {
      if (!banner) return;
      banner.innerHTML = bannerHtml;
      banner.style.display = 'block';

      banner.querySelectorAll('.btn-occ-banner-close').forEach(btn => {
        btn.addEventListener('click', () => {
          forceShowOccBanner = false;
          renderOccBanners();
        });
      });

      banner.querySelectorAll('.btn-occ-pill-select').forEach(btn => {
        btn.addEventListener('click', async () => {
          const cid = btn.dataset.courseId;
          const occ = btn.dataset.occ;
          await applyUserOcc(cid, occ);
        });
      });

      banner.querySelectorAll('.btn-occ-custom-set').forEach(btn => {
        btn.addEventListener('click', async () => {
          const cid = btn.dataset.courseId;
          const input = banner.querySelector(`#occ-input-banner-${cid}`);
          const occ = input ? input.value.trim() : '';
          if (occ) {
            await applyUserOcc(cid, occ);
          }
        });
      });
    });
  }

  function renderAllActivities() {
    renderAnnouncementsList();
    renderAssignmentsList();
    renderAttendanceList();
    renderOccBanners();
    updateKpiCards();
  }

  // ========================================================
  // 6. Horizontal Scrollable Timeline Visualizer
  // ========================================================
  function renderTimelineVisualizer() {
    if (!timelineTrack) return;

    try {
      // Collect all timeline events
      const timelineEvents = [];
      const now = new Date();

      const showTasks = chkTlTasks ? chkTlTasks.checked : (chkCalTasks ? chkCalTasks.checked : true);
      const showAtt = chkTlAtt ? chkTlAtt.checked : (chkCalAtt ? chkCalAtt.checked : true);
      const showAnn = chkTlAnn ? chkTlAnn.checked : (chkCalAnn ? chkCalAnn.checked : true);

      // 1. Assignments
      if (showTasks) {
        logDiag('Timeline:Eval', `Evaluating ${assignmentsData.length} total assignment(s) for timeline track (showTasks: true)...`);
        let tlTasksAdded = 0;
        assignmentsData.forEach(assign => {
          const rawD = resolveAssignmentDate(assign, now);
          const isPending = !assign.isSubmitted && !assign.isOverdue;
          const d = (rawD instanceof Date) ? rawD : (rawD ? new Date(rawD) : null);
          const isValidDate = d && !isNaN(d.getTime());

          if (isValidDate) {
            assign.dueDate = d;
            const ev = {
              type: 'assignment',
              date: d,
              dateKey: formatDateKey(d),
              title: assign.title || 'Assignment',
              courseCode: assign.courseCode || assign.courseName || 'Course',
              status: assign.isSubmitted ? 'submitted' : (assign.isOverdue ? 'overdue' : (assign.isDueSoon ? 'duesoon' : 'upcoming')),
              statusLabel: assign.badgeLabel || 'Assignment',
              url: assign.url,
              obj: assign
            };
            timelineEvents.push(ev);
            tlTasksAdded++;
            logDiag('Timeline:Task', `[${ev.courseCode}] "${ev.title}" -> Date: ${ev.dateKey} (${ev.status})`);
          } else if (isPending) {
            // Truly open task with no deadline or timing: anchor to Today
            const ev = {
              type: 'assignment',
              date: new Date(now.getTime()),
              dateKey: formatDateKey(now),
              title: assign.title || 'Task',
              courseCode: assign.courseCode || assign.courseName || 'Course',
              status: 'upcoming',
              statusLabel: '⏳ Open Task',
              url: assign.url,
              obj: assign
            };
            timelineEvents.push(ev);
            tlTasksAdded++;
            logDiag('Timeline:Task', `[${ev.courseCode}] "${ev.title}" [Pinned to Today as Open Task] (Raw: "${assign.dueDateStr || 'None'}")`);
          } else {
            logDiag('Timeline:Task', `[${assign.courseCode || assign.courseId}] Skipped "${assign.title}" (Invalid date & not pending. Raw: "${assign.dueDateStr}")`);
          }
        });
        logDiag('Timeline:Tasks', `Total assignment events queued for timeline: ${tlTasksAdded}`);
      } else {
        logDiag('Timeline:Tasks', 'Tasks filter unchecked (showTasks: false)');
      }

      // 2. Attendance (Active session on Today + Scheduled/Past Sessions)
      if (showAtt) {
        const todayKey = formatDateKey(now);
        attendancesData.forEach(att => {
          if (isAttendanceHidden(att)) return;
          if (att.activeSession && shouldIncludeInTimelineOrCalendar(att, null)) {
            const typeInfo = getAttendanceTypeInfo(att, att.activeSession.desc || '');
            const cleanDesc = cleanSessionDesc(att.activeSession.desc || 'Current Class Session', typeInfo.label);
            timelineEvents.push({
              type: 'attendance',
              date: new Date(now.getTime()),
              dateKey: todayKey,
              title: cleanDesc,
              attTypeInfo: typeInfo,
              courseCode: att.courseCode || att.courseName || 'Course',
              courseName: att.courseName || '',
              status: 'active',
              statusLabel: `${typeInfo.icon} ${typeInfo.label} · ${att.activeSession.requiresPassword ? '🔑 PIN' : '🟢 OPEN NOW'}`,
              url: att.attUrl,
              obj: att,
              sessObj: {
                date: new Date(now.getTime()),
                dateKey: todayKey,
                dateStr: 'Active Now',
                desc: cleanDesc,
                statusType: 'active',
                statusLabel: '🟢 OPEN NOW'
              }
            });
          }
          if (Array.isArray(att.sessions)) {
            att.sessions.forEach(sess => {
              if (!shouldIncludeInTimelineOrCalendar(att, sess)) return;
              const dateKey = sess.dateKey || (sess.date ? formatDateKey(sess.date) : '');
              if (dateKey) {
                if (dateKey === todayKey && att.activeSession) return;
                const rawDate = sess.date;
                const d = (rawDate instanceof Date && !isNaN(rawDate.getTime()))
                  ? rawDate
                  : (rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : (dateKey ? new Date(dateKey + 'T12:00:00') : null));
                if (d && !isNaN(d.getTime())) {
                  let status = sess.statusType || 'scheduled';
                  let statusLabel = sess.statusLabel || '⏳ Scheduled';
                  if (sess.isPresent) {
                    status = 'submitted';
                    statusLabel = '✔ Present';
                  } else if (sess.statusType === 'late') {
                    status = 'late';
                    statusLabel = '⚠️ Late';
                  } else if (sess.statusType === 'absent') {
                    status = 'overdue';
                    statusLabel = '❌ Absent';
                  } else if (sess.statusType === 'excused') {
                    status = 'upcoming';
                    statusLabel = 'ℹ️ Excused';
                  }

                  const typeInfo = getAttendanceTypeInfo(att, sess.desc || '');
                  const cleanDesc = cleanSessionDesc(sess.desc || 'Class Session', typeInfo.label);

                  timelineEvents.push({
                    type: 'attendance',
                    date: d,
                    dateKey,
                    title: cleanDesc,
                    attTypeInfo: typeInfo,
                    courseCode: att.courseCode || att.courseName || 'Course',
                    courseName: att.courseName || '',
                    status,
                    statusLabel: `${typeInfo.icon} ${typeInfo.label} · ${statusLabel}`,
                    url: att.attUrl,
                    obj: att,
                    sessObj: sess
                  });
                }
              }
            });
          }

          // Also check att.nextSession (ensures scheduled upcoming classes without past sessions always display)
          if (att.nextSession && shouldIncludeInTimelineOrCalendar(att, att.nextSession)) {
            const nextSess = att.nextSession;
            const nsDateKey = nextSess.dateKey || (nextSess.date ? formatDateKey(nextSess.date) : '');
            if (nsDateKey) {
              const alreadyInSessions = Array.isArray(att.sessions) && att.sessions.some(s => (s.dateKey || formatDateKey(s.date)) === nsDateKey);
              if (!alreadyInSessions && (nsDateKey !== todayKey || !att.activeSession)) {
                const rawDate = nextSess.date;
                const d = (rawDate instanceof Date && !isNaN(rawDate.getTime()))
                  ? rawDate
                  : (rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : (nsDateKey ? new Date(nsDateKey + 'T12:00:00') : null));
                if (d && !isNaN(d.getTime())) {
                  const typeInfo = getAttendanceTypeInfo(att, nextSess.desc || '');
                  const cleanDesc = cleanSessionDesc(nextSess.desc || 'Scheduled Class Session', typeInfo.label);
                  timelineEvents.push({
                    type: 'attendance',
                    date: d,
                    dateKey: nsDateKey,
                    title: cleanDesc,
                    attTypeInfo: typeInfo,
                    courseCode: att.courseCode || att.courseName || 'Course',
                    courseName: att.courseName || '',
                    status: 'upcoming',
                    statusLabel: `${typeInfo.icon} ${typeInfo.label} · ⏳ Scheduled`,
                    url: att.attUrl,
                    obj: att,
                    sessObj: nextSess
                  });
                }
              }
            }
          }
        });
      }

      // 3. Announcements
      if (showAnn) {
        announcementsData.forEach(ann => {
          if (ann.timestamp) {
            const rawD = ann.timestamp;
            const d = (rawD instanceof Date) ? rawD : (rawD ? new Date(rawD) : null);
            if (d && !isNaN(d.getTime())) {
              timelineEvents.push({
                type: 'announcement',
                date: d,
                dateKey: formatDateKey(d),
                title: ann.title || 'Announcement',
                courseCode: ann.courseCode || ann.courseName || 'Course',
                status: 'upcoming',
                statusLabel: '📢 Notice',
                url: ann.discussUrl,
                obj: ann
              });
            }
          }
        });
      }

      // Generate date range from active date window, ensuring upcoming deadlines are encompassed
      const daysMap = new Map();
      const nowKey = formatDateKey(now);

      // Focus timeline span around Today and actual event dates:
      // Support a full semester span (-90 to +120 days) so semester deadlines and past activities are never dropped!
      let earliestPastEvent = null;
      let latestFutureEvent = null;

      timelineEvents.forEach(ev => {
        const evDate = (ev.date instanceof Date) ? ev.date : (ev.date ? new Date(ev.date) : null);
        if (evDate && !isNaN(evDate.getTime())) {
          ev.date = evDate;
          const diffDays = (evDate.getTime() - now.getTime()) / (1000 * 3600 * 24);
          if (diffDays < 0 && diffDays >= -90) {
            if (!earliestPastEvent || evDate < earliestPastEvent) earliestPastEvent = evDate;
          }
          if (diffDays >= 0 && diffDays <= 120) {
            if (!latestFutureEvent || evDate > latestFutureEvent) latestFutureEvent = evDate;
          }
        }
      });

      let minD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
      if (earliestPastEvent && !isNaN(earliestPastEvent.getTime())) {
        const eDay = new Date(earliestPastEvent.getFullYear(), earliestPastEvent.getMonth(), earliestPastEvent.getDate() - 1);
        if (!isNaN(eDay.getTime()) && eDay < minD) minD = eDay;
      }

      let maxD = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
      if (latestFutureEvent && !isNaN(latestFutureEvent.getTime())) {
        const fDay = new Date(latestFutureEvent.getFullYear(), latestFutureEvent.getMonth(), latestFutureEvent.getDate() + 2);
        if (!isNaN(fDay.getTime()) && fDay > maxD) maxD = fDay;
      }

      // Guard against invalid or reversed dates
      if (isNaN(minD.getTime())) minD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
      if (isNaN(maxD.getTime()) || maxD < minD) maxD = new Date(minD.getFullYear(), minD.getMonth(), minD.getDate() + 30);

      logDiag('Timeline:Span', `Timeline span: ${formatDateKey(minD)} to ${formatDateKey(maxD)} (Total events: ${timelineEvents.length})`);

      const curr = new Date(minD.getFullYear(), minD.getMonth(), minD.getDate());
      const stop = new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate());

      while (curr <= stop) {
        const key = formatDateKey(curr);
        daysMap.set(key, {
          date: new Date(curr),
          isToday: key === nowKey,
          events: []
        });
        curr.setDate(curr.getDate() + 1);
      }

      // Assign events to day buckets with deduplication
      const seenEventKeys = new Set();
      let placedCount = 0;
      let droppedOutsideSpanCount = 0;

      timelineEvents.forEach(ev => {
        const eventKey = `${ev.type}_${ev.courseCode}_${ev.dateKey}_${ev.title}_${ev.sessObj?.dateStr || ev.sessObj?.time || ''}`;
        if (seenEventKeys.has(eventKey)) return;
        seenEventKeys.add(eventKey);

        if (daysMap.has(ev.dateKey)) {
          daysMap.get(ev.dateKey).events.push(ev);
          placedCount++;
        } else {
          droppedOutsideSpanCount++;
          logDiag('Timeline:Warn', `Event "${ev.title}" on ${ev.dateKey} fell outside timeline span (${formatDateKey(minD)} to ${formatDateKey(maxD)})`);
        }
      });

      logDiag('Timeline:Summary', `Placed ${placedCount} distinct events across ${daysMap.size} day columns (${droppedOutsideSpanCount} outside span).`);

      // Sort events within each day column: assignments first, then attendance, then notices
      daysMap.forEach(day => {
        day.events.sort((a, b) => {
          const pMap = { assignment: 1, task: 1, attendance: 2, att: 2, announcement: 3, notice: 3 };
          return (pMap[a.type] || 9) - (pMap[b.type] || 9);
        });
      });

      // Convert to sorted array
      const sortedDays = Array.from(daysMap.values()).sort((a, b) => {
        const aT = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
        const bT = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
        return aT - bT;
      });

      // Spec 4.2: Skip empty days (only render columns with events)
      const populatedDays = sortedDays.filter(day => day.events.length > 0);

      // ========================================================================
      // TIMELINE HORIZONTAL SCROLL ENGINE (Tuning: TIMELINE_SCROLL_MULTIPLIER)
      // ------------------------------------------------------------------------
      // Lower resistance: 1.8 - 2.2 | Default: 1.0 | Fast scan: 2.5+
      // ========================================================================
      const TIMELINE_SCROLL_MULTIPLIER = 1.85;

      if (timelineScrollWrapper && !timelineScrollWrapper._wheelHijacked) {
        timelineScrollWrapper._wheelHijacked = true;

        // Fluid horizontal scroll with tuned resistance
        timelineScrollWrapper.addEventListener('wheel', (evt) => {
          const rawDelta = Math.abs(evt.deltaX) > Math.abs(evt.deltaY) ? evt.deltaX : evt.deltaY;
          if (rawDelta !== 0) {
            evt.preventDefault();
            timelineScrollWrapper.scrollLeft += rawDelta * TIMELINE_SCROLL_MULTIPLIER;
          }
        }, { passive: false });

        // Frictionless mouse drag-to-scroll
        let isDragging = false;
        let startX = 0;
        let scrollStart = 0;

        timelineScrollWrapper.addEventListener('mousedown', (e) => {
          if (e.target.closest('button, a, input, select, .timeline-activity-card')) return;
          isDragging = true;
          timelineScrollWrapper.classList.add('is-dragging');
          startX = e.pageX - timelineScrollWrapper.offsetLeft;
          scrollStart = timelineScrollWrapper.scrollLeft;
        });

        window.addEventListener('mouseup', () => {
          if (isDragging) {
            isDragging = false;
            timelineScrollWrapper.classList.remove('is-dragging');
          }
        });

        window.addEventListener('mousemove', (e) => {
          if (!isDragging) return;
          e.preventDefault();
          const x = e.pageX - timelineScrollWrapper.offsetLeft;
          const walk = (x - startX) * 1.5;
          timelineScrollWrapper.scrollLeft = scrollStart - walk;
        });
      }

      if (populatedDays.length === 0) {
        timelineTrack.innerHTML = `
          <div style="padding: 32px; color: var(--text-muted); font-size: 13px; text-align: center; width: 100%;">
            📅 No events or activities scheduled in this period.
          </div>
        `;
      } else {
        timelineTrack.innerHTML = populatedDays.map(day => {
          const dayDate = day.date instanceof Date ? day.date : new Date(day.date);
          const dayNum = dayDate.getDate();
          const wDay = dayDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

          return `
            <div class="kanban-day-column ${day.isToday ? 'is-today' : ''}" data-date-key="${formatDateKey(day.date)}">
              <div class="kanban-col-header">
                <span class="kanban-col-date">
                  ${dayNum} ${wDay}
                  ${day.isToday ? '<span class="kanban-today-pill">TODAY</span>' : ''}
                </span>
                <span class="kanban-col-count">${day.events.length} ${day.events.length === 1 ? 'item' : 'items'}</span>
              </div>
              <div class="kanban-col-cards">
                ${day.events.map(ev => {
                  if (ev.type === 'assignment' || ev.type === 'task') return renderAssignmentCardHtml(ev.obj || ev);
                  if (ev.type === 'attendance' || ev.type === 'att') return renderTimelineAttendanceCardHtml(ev);
                  return renderAnnouncementCardHtml(ev.obj || ev);
                }).join('')}
              </div>
            </div>
          `;
        }).join('');

        attachAttendanceActions(timelineTrack);
      }

      // Update top header month to reflect timeline view
      const topMonthHeading = document.getElementById('fulltab-month-heading');
      if (topMonthHeading) {
        const topDay = populatedDays.find(d => d.isToday) || populatedDays[0];
        if (topDay) {
          const dObj = topDay.date instanceof Date ? topDay.date : new Date(topDay.date);
          topMonthHeading.textContent = dObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
        }
      }

      renderOccBanners();
      scrollToToday(true);
    } catch (err) {
      logDiag('Timeline:Crash', `Timeline visualizer crash: ${err?.message || err}`, err?.stack);
      console.error('[SPeCTRUM Pro] Timeline visualizer error:', err);
      timelineTrack.innerHTML = `
        <div style="padding: 16px 24px; color: var(--danger); font-size: 11px; text-align: center; width: 100%;">
          ⚠️ Error rendering timeline visualizer: ${escapeHtml(err?.message || String(err))}
        </div>
      `;
    }
  }

  function scrollToToday(immediate = true) {
    if (!timelineScrollWrapper || !timelineTrack) return;
    const todayCol = timelineTrack.querySelector('.kanban-day-column.is-today, .timeline-day-col.is-today');
    if (!todayCol) return;

    const doScroll = () => {
      const containerWidth = timelineScrollWrapper.offsetWidth || timelineScrollWrapper.clientWidth || 600;
      const todayOffset = todayCol.offsetLeft;
      const targetScroll = Math.max(0, todayOffset - (containerWidth / 2) + (todayCol.offsetWidth / 2));

      if (immediate) {
        const prevBehavior = timelineScrollWrapper.style.scrollBehavior;
        timelineScrollWrapper.style.scrollBehavior = 'auto';
        timelineScrollWrapper.scrollLeft = targetScroll;
        requestAnimationFrame(() => {
          timelineScrollWrapper.style.scrollBehavior = prevBehavior || 'smooth';
        });
      } else {
        timelineScrollWrapper.scrollTo({ left: targetScroll, behavior: 'smooth' });
      }
    };

    requestAnimationFrame(() => {
      doScroll();
      setTimeout(doScroll, 80);
      setTimeout(doScroll, 250);
    });
  }

  if (btnTimelineScrollLeft && timelineScrollWrapper) {
    btnTimelineScrollLeft.addEventListener('click', () => {
      timelineScrollWrapper.scrollBy({ left: -240, behavior: 'smooth' });
    });
  }

  if (btnTimelineScrollRight && timelineScrollWrapper) {
    btnTimelineScrollRight.addEventListener('click', () => {
      timelineScrollWrapper.scrollBy({ left: 240, behavior: 'smooth' });
    });
  }

  if (btnTimelineScrollToday) {
    btnTimelineScrollToday.addEventListener('click', () => scrollToToday(false));
  }

  if (btnTimelineEditOcc) {
    btnTimelineEditOcc.addEventListener('click', () => {
      forceShowOccBanner = !forceShowOccBanner;
      renderOccBanners();
    });
  }

  if (btnCalEditOcc) {
    btnCalEditOcc.addEventListener('click', () => {
      forceShowOccBanner = !forceShowOccBanner;
      renderOccBanners();
    });
  }

  // ========================================================
  // Core Sorting & Timestamp Utilities
  // Supports Newest / Oldest across Date and Course modes
  // ========================================================
  function getItemTimestamp(item, type) {
    if (!item) return 0;
    if (type === 'announcement' || item.timestamp) {
      if (item.timestamp instanceof Date) return item.timestamp.getTime();
      if (typeof item.timestamp === 'number') return item.timestamp;
      if (item.timestamp) {
        const t = new Date(item.timestamp).getTime();
        if (!isNaN(t)) return t;
      }
    }
    if (type === 'assignment' || item.dueDate || item.dueDateStr || item.timeRemaining) {
      const d = resolveAssignmentDate(item, new Date());
      if (d && !isNaN(d.getTime())) return d.getTime();
      if (item.dueDate instanceof Date && !isNaN(item.dueDate.getTime())) return item.dueDate.getTime();
      if (item.dueDate && !isNaN(new Date(item.dueDate).getTime())) return new Date(item.dueDate).getTime();
    }
    if (type === 'attendance') {
      if (item.activeSession) return Date.now();
      if (item.date && !isNaN(new Date(item.date).getTime())) return new Date(item.date).getTime();
      if (item.nextSession?.date) {
        const d = new Date(item.nextSession.date);
        if (!isNaN(d.getTime())) return d.getTime();
      }
      if (item.nextSession?.dateKey) {
        const d = new Date(item.nextSession.dateKey + 'T12:00:00');
        if (!isNaN(d.getTime())) return d.getTime();
      }
      if (Array.isArray(item.sessions) && item.sessions.length > 0) {
        const ts = item.sessions.map(s => {
          if (s.date && !isNaN(new Date(s.date).getTime())) return new Date(s.date).getTime();
          if (s.dateKey) return new Date(s.dateKey + 'T12:00:00').getTime();
          return 0;
        }).filter(t => t > 0);
        if (ts.length > 0) return currentSortOrder === 'newest' ? Math.max(...ts) : Math.min(...ts);
      }
    }
    return 0;
  }

  function sortAnnouncements(items, sortOrder = 'newest') {
    const isNewest = (sortOrder === 'newest');
    return [...items].sort((a, b) => {
      const timeA = getItemTimestamp(a, 'announcement');
      const timeB = getItemTimestamp(b, 'announcement');
      if (timeA > 0 && timeB > 0) {
        if (timeA !== timeB) return isNewest ? (timeB - timeA) : (timeA - timeB);
      } else if (timeA > 0) return -1;
      else if (timeB > 0) return 1;
      return (a.title || '').localeCompare(b.title || '');
    });
  }

  function sortAssignments(items, sortOrder = 'newest') {
    const isNewest = (sortOrder === 'newest');
    return [...items].sort((a, b) => {
      const timeA = getItemTimestamp(a, 'assignment');
      const timeB = getItemTimestamp(b, 'assignment');

      if (timeA > 0 && timeB > 0) {
        if (timeA !== timeB) return isNewest ? (timeB - timeA) : (timeA - timeB);
      } else if (timeA > 0) return -1;
      else if (timeB > 0) return 1;

      // Secondary sort: unsubmitted before submitted
      if (!a.isSubmitted && b.isSubmitted) return -1;
      if (a.isSubmitted && !b.isSubmitted) return 1;

      return (a.title || '').localeCompare(b.title || '');
    });
  }

  function sortAssignmentsAscending(items) {
    return sortAssignments(items, 'oldest');
  }

  function sortAttendanceItems(items, sortOrder = 'newest') {
    const isNewest = (sortOrder === 'newest');
    return [...items].sort((a, b) => {
      // Active open session always first
      if (a.activeSession && !b.activeSession) return -1;
      if (!a.activeSession && b.activeSession) return 1;

      const timeA = getItemTimestamp(a, 'attendance');
      const timeB = getItemTimestamp(b, 'attendance');
      if (timeA > 0 && timeB > 0) {
        if (timeA !== timeB) return isNewest ? (timeB - timeA) : (timeA - timeB);
      } else if (timeA > 0) return -1;
      else if (timeB > 0) return 1;

      return (a.courseCode || '').localeCompare(b.courseCode || '');
    });
  }

  // ========================================================
  // 7. Render Announcements (Timeline vs By Course)
  // ========================================================
  function renderAnnouncementsList() {
    if (!announcementsListEl) return;

    const searchTerm = (activitiesSearchInput && activitiesSearchInput.value.trim().toLowerCase()) || '';
    let filtered = announcementsData.filter(a => isWithinDateFilter(a.timestamp));

    if (searchTerm) {
      filtered = filtered.filter(a =>
        (a.title && a.title.toLowerCase().includes(searchTerm)) ||
        (a.courseCode && a.courseCode.toLowerCase().includes(searchTerm)) ||
        (a.courseName && a.courseName.toLowerCase().includes(searchTerm)) ||
        (a.author && a.author.toLowerCase().includes(searchTerm))
      );
    }

    if (filtered.length === 0) {
      announcementsListEl.innerHTML = `
        <div style="text-align:center;padding:32px 16px;color:var(--text-muted);">
          <p style="font-size:14px;margin-bottom:6px;">📢 No announcements found</p>
          <p style="font-size:11.5px;">Click "Refresh" to fetch latest posts from your course forums.</p>
        </div>
      `;
      return;
    }

    if (currentActivitiesMode === 'bycourse') {
      // Group by Course
      const courseMap = new Map();
      filtered.forEach(ann => {
        const cid = ann.courseId || 'general';
        if (!courseMap.has(cid)) {
          courseMap.set(cid, {
            courseCode: ann.courseCode,
            courseName: ann.courseName,
            items: []
          });
        }
        courseMap.get(cid).items.push(ann);
      });

      // Sort items inside each course and sort courses according to currentSortOrder
      const sortedCourseEntries = Array.from(courseMap.entries()).map(([cid, group]) => {
        group.items = sortAnnouncements(group.items, currentSortOrder);
        return [cid, group];
      });

      sortedCourseEntries.sort((a, b) => {
        const itemA = a[1].items[0];
        const itemB = b[1].items[0];
        const tA = itemA ? getItemTimestamp(itemA, 'announcement') : 0;
        const tB = itemB ? getItemTimestamp(itemB, 'announcement') : 0;
        return (currentSortOrder === 'newest') ? (tB - tA) : (tA - tB);
      });

      announcementsListEl.innerHTML = sortedCourseEntries.map(([cid, group]) => `
        <div class="course-group-card expanded">
          <div class="course-group-header">
            <div class="course-group-info">
              <span class="course-group-code">${escapeHtml(group.courseCode || 'Course')}</span>
              ${cleanDisplayCourseName(group.courseName, group.courseCode) ? `<span class="course-group-title">${escapeHtml(cleanDisplayCourseName(group.courseName, group.courseCode))}</span>` : ''}
            </div>
            <div class="course-group-meta">
              <span class="badge-count">${group.items.length} notices</span>
              <span class="course-group-chevron">▼</span>
            </div>
          </div>
          <div class="course-group-body">
            ${group.items.map(ann => renderAnnouncementCardHtml(ann)).join('')}
          </div>
        </div>
      `).join('');

      attachCourseGroupToggle(announcementsListEl);

    } else {
      // Timeline Mode (Chronological: Newest vs Oldest)
      const sorted = sortAnnouncements(filtered, currentSortOrder);
      announcementsListEl.innerHTML = sorted.map(ann => renderAnnouncementCardHtml(ann)).join('');
    }

    // (Announcement card clicks and "Open Full ➔" are handled universally via document-level delegation)
  }

  function renderAnnouncementCardHtml(ann) {
    const vm = computeNoticeCardViewModel(ann);
    return renderUnifiedNoticeCardHtml(vm);
  }

  // ========================================================
  // 8. Render Assignments (Ascending Timeline vs By Course)
  // ========================================================
  function renderAssignmentsList() {
    if (!assignmentsListEl) return;

    let filtered = assignmentsData;

    // Filter pill selection
    if (currentAssignFilter === 'pending') {
      filtered = filtered.filter(a => !a.isSubmitted && !a.isOverdue);
    } else if (currentAssignFilter === 'due-soon') {
      filtered = filtered.filter(a => a.isDueSoon);
    } else if (currentAssignFilter === 'submitted') {
      filtered = filtered.filter(a => a.isSubmitted);
    } else if (currentAssignFilter === 'overdue') {
      filtered = filtered.filter(a => a.isOverdue);
    }

    // Date window filter (preserving unsubmitted / pending tasks regardless of future cutoff)
    filtered = filtered.filter(a => {
      if (!a.dueDate) return true;
      const isPending = !a.isSubmitted && !a.isOverdue;
      return isWithinDateFilter(a.dueDate, isPending);
    });

    // Search filter
    const searchTerm = (activitiesSearchInput && activitiesSearchInput.value.trim().toLowerCase()) || '';
    if (searchTerm) {
      filtered = filtered.filter(a =>
        (a.title && a.title.toLowerCase().includes(searchTerm)) ||
        (a.courseCode && a.courseCode.toLowerCase().includes(searchTerm)) ||
        (a.courseName && a.courseName.toLowerCase().includes(searchTerm))
      );
    }

    logDiag('Assignments:List', `Rendered ${filtered.length} assignments in mode "${currentActivitiesMode}" (Filter: "${currentAssignFilter}", Total raw: ${assignmentsData.length})`);

    if (filtered.length === 0) {
      assignmentsListEl.innerHTML = `
        <div style="text-align:center;padding:32px 16px;color:var(--text-muted);">
          <p style="font-size:14px;margin-bottom:6px;">✨ No assignments match your filter</p>
          <p style="font-size:11.5px;">All caught up or click "Refresh" to update.</p>
        </div>
      `;
      return;
    }

    if (currentActivitiesMode === 'bycourse') {
      // Group by Course
      const courseMap = new Map();
      filtered.forEach(assign => {
        const cid = assign.courseId || 'general';
        if (!courseMap.has(cid)) {
          courseMap.set(cid, {
            courseCode: assign.courseCode,
            courseName: assign.courseName,
            items: []
          });
        }
        courseMap.get(cid).items.push(assign);
      });

      const sortedCourseEntries = Array.from(courseMap.entries()).map(([cid, group]) => {
        // Sort assignments within course by currentSortOrder (newest or oldest)
        group.items = sortAssignments(group.items, currentSortOrder);
        return [cid, group];
      });

      // Sort courses by their top task timestamp
      sortedCourseEntries.sort((a, b) => {
        const itemA = a[1].items[0];
        const itemB = b[1].items[0];
        const tA = itemA ? getItemTimestamp(itemA, 'assignment') : 0;
        const tB = itemB ? getItemTimestamp(itemB, 'assignment') : 0;
        return (currentSortOrder === 'newest') ? (tB - tA) : (tA - tB);
      });

      assignmentsListEl.innerHTML = sortedCourseEntries.map(([cid, group]) => {
        return `
          <div class="course-group-card expanded">
            <div class="course-group-header">
              <div class="course-group-info">
                <span class="course-group-code">${escapeHtml(group.courseCode || 'Course')}</span>
                ${cleanDisplayCourseName(group.courseName, group.courseCode) ? `<span class="course-group-title">${escapeHtml(cleanDisplayCourseName(group.courseName, group.courseCode))}</span>` : ''}
              </div>
              <div class="course-group-meta">
                <span class="badge-count">${group.items.length} tasks</span>
                <span class="course-group-chevron">▼</span>
              </div>
            </div>
            <div class="course-group-body">
              ${group.items.map(assign => renderAssignmentCardHtml(assign)).join('')}
            </div>
          </div>
        `;
      }).join('');

      attachCourseGroupToggle(assignmentsListEl);

    } else {
      // Timeline Mode (Newest vs Oldest deadline)
      const sorted = sortAssignments(filtered, currentSortOrder);
      assignmentsListEl.innerHTML = sorted.map(assign => renderAssignmentCardHtml(assign)).join('');
    }
  }

  function renderAssignmentCardHtml(assign) {
    const vm = computeAssignmentCardViewModel(assign);
    return renderUnifiedAssignmentCardHtml(vm);
  }

  // ========================================================
  // 9. Render Attendance (Timeline vs By Course)
  // ========================================================
  function renderAttendanceList() {
    if (!attendanceListEl) return;

    if (attendancesData.length === 0) {
      attendanceListEl.innerHTML = `
        <div style="text-align:center;padding:32px 16px;color:var(--text-muted);">
          <p style="font-size:14px;margin-bottom:6px;font-weight:600;color:var(--text-primary);">📅 No attendance records loaded</p>
          <p style="font-size:11.5px;max-width:330px;margin:0 auto 14px;line-height:1.4;">If you are enrolled in courses with attendance, inspect the diagnostic trace to see which step is failing or clear the local cache.</p>
          <div style="display:flex;justify-content:center;gap:8px;">
            <button type="button" id="btn-empty-diag" class="btn-secondary" style="font-size:11px;padding:6px 12px;cursor:pointer;">🔍 Open Diagnostic Log</button>
            <button type="button" id="btn-empty-hard-sync" class="btn-primary" style="font-size:11px;padding:6px 12px;cursor:pointer;">🧹 Clear Cache & Rescan</button>
          </div>
        </div>
      `;
      const btnEmptyDiag = document.getElementById('btn-empty-diag');
      if (btnEmptyDiag && diagBody && diagPanel) {
        btnEmptyDiag.addEventListener('click', () => {
          diagBody.style.display = 'block';
          diagPanel.classList.add('open');
          diagPanel.scrollIntoView({ behavior: 'smooth' });
        });
      }
      const btnEmptyHardSync = document.getElementById('btn-empty-hard-sync');
      if (btnEmptyHardSync) {
        btnEmptyHardSync.addEventListener('click', async () => {
          await hardRescanAll();
        });
      }
      if (occMultiAlert) occMultiAlert.style.display = 'none';
      return;
    }

    const hasUnresolvedOcc = attendancesData.some(a => a.detectedOccs && a.detectedOccs.length > 1 && !a.userOcc);
    if (occMultiAlert) {
      occMultiAlert.style.display = hasUnresolvedOcc ? 'flex' : 'none';
    }

    // Actively filter to show only active & upcoming attendance (hides dead records and hidden duplicates)
    let filteredAtt = attendancesData.filter(att => !isAttendanceHidden(att) && isAttendanceAlive(att));

    // Apply Fine-Grained Attendance Filters for Maximum Performance & Focus
    if (currentAttCourseFilter && currentAttCourseFilter !== 'all') {
      filteredAtt = filteredAtt.filter(att => String(att.courseId) === String(currentAttCourseFilter));
    }

    if (currentAttDateFilter === 'today') {
      const todayKey = formatDateKey(new Date());
      filteredAtt = filteredAtt.filter(att => {
        if (att.activeSession) return true;
        const hasTodaySess = (att.sessions || []).some(s => s.dateKey === todayKey || s.isToday);
        const nextIsToday = att.nextSession && (att.nextSession.dateKey === todayKey || formatDateKey(att.nextSession.date) === todayKey);
        return hasTodaySess || nextIsToday;
      });
    } else if (currentAttDateFilter === 'custom' && currentAttCustomDate) {
      filteredAtt = filteredAtt.filter(att => {
        const hasCustomSess = (att.sessions || []).some(s => s.dateKey === currentAttCustomDate);
        const nextMatches = att.nextSession && (att.nextSession.dateKey === currentAttCustomDate || formatDateKey(att.nextSession.date) === currentAttCustomDate);
        return hasCustomSess || nextMatches;
      });
    }

    if (currentAttStatusFilter === 'active-now') {
      filteredAtt = filteredAtt.filter(att => att.activeSession != null);
    } else if (currentAttStatusFilter === 'upcoming') {
      filteredAtt = filteredAtt.filter(att => att.nextSession != null && att.activeSession == null);
    } else if (currentAttStatusFilter === 'present') {
      filteredAtt = filteredAtt.filter(att => /present|hadir/i.test(att.lastRecordedStatus || '') || (att.sessions || []).some(s => s.isPresent));
    }

    if (filteredAtt.length === 0) {
      const hasActiveFilters = (currentAttCourseFilter !== 'all') || (currentAttDateFilter !== 'all') || (currentAttStatusFilter !== 'all');
      attendanceListEl.innerHTML = `
        <div style="text-align:center;padding:32px 16px;color:var(--text-muted);">
          <p style="font-size:14px;margin-bottom:6px;font-weight:600;color:var(--text-primary);">${hasActiveFilters ? '🔍 No matching attendance records' : '📅 No Active or Upcoming Attendance Sessions'}</p>
          <p style="font-size:11.5px;max-width:330px;margin:0 auto 12px;line-height:1.4;">${hasActiveFilters ? 'No attendance sessions match the current course, date, or status filter.' : 'There are currently no open attendance submission links or scheduled upcoming classes found across your courses.'}</p>
          ${hasActiveFilters ? `<button type="button" id="btn-reset-att-filters" class="btn-wireframe" style="font-size:11px;padding:4px 10px;margin:0 auto;cursor:pointer;">Reset Filters</button>` : ''}
        </div>
      `;
      const btnReset = document.getElementById('btn-reset-att-filters');
      if (btnReset) {
        btnReset.addEventListener('click', () => {
          currentAttCourseFilter = 'all';
          currentAttDateFilter = 'all';
          currentAttStatusFilter = 'all';
          if (selAttFilterCourse) selAttFilterCourse.value = 'all';
          if (selAttFilterDate) selAttFilterDate.value = 'all';
          if (selAttFilterStatus) selAttFilterStatus.value = 'all';
          if (inputAttFilterDatePicker) inputAttFilterDatePicker.style.display = 'none';
          if (btnSyncFilteredAttText) btnSyncFilteredAttText.textContent = 'Sync Course';
          renderAttendanceList();
        });
      }
      return;
    }

    if (currentActivitiesMode === 'bycourse') {
      // Group by Course (Hierarchical Structure)
      const courseMap = new Map();
      filteredAtt.forEach(att => {
        const cid = att.courseId || 'general';
        if (!courseMap.has(cid)) {
          courseMap.set(cid, {
            courseId: cid,
            courseCode: att.courseCode,
            courseName: att.courseName,
            userOcc: att.userOcc || courseOccs[cid] || defaultOcc || '',
            detectedOccs: Array.isArray(att.detectedOccs) ? [...att.detectedOccs] : [],
            items: []
          });
        }
        const group = courseMap.get(cid);
        if (!group.userOcc && (att.userOcc || courseOccs[cid])) {
          group.userOcc = att.userOcc || courseOccs[cid];
        }
        if (Array.isArray(att.detectedOccs)) {
          att.detectedOccs.forEach(o => {
            if (!group.detectedOccs.includes(o)) group.detectedOccs.push(o);
          });
        }
        group.items.push(att);
      });

      const sortedCourseEntries = Array.from(courseMap.entries()).map(([cid, group]) => {
        // Sort sessions inside each attendance item according to currentSortOrder
        group.items.forEach(att => {
          if (Array.isArray(att.sessions)) {
            att.sessions.sort((s1, s2) => {
              const t1 = s1.date ? new Date(s1.date).getTime() : (s1.dateKey ? new Date(s1.dateKey + 'T12:00:00').getTime() : 0);
              const t2 = s2.date ? new Date(s2.date).getTime() : (s2.dateKey ? new Date(s2.dateKey + 'T12:00:00').getTime() : 0);
              return currentSortOrder === 'newest' ? (t2 - t1) : (t1 - t2);
            });
          }
        });

        // Sort items inside course: active first, then by sort order
        group.items = sortAttendanceItems(group.items, currentSortOrder);
        return [cid, group];
      });

      // Sort courses by their top attendance item timestamp
      sortedCourseEntries.sort((a, b) => {
        const hasOpenA = a[1].items.some(it => it.activeSession != null);
        const hasOpenB = b[1].items.some(it => it.activeSession != null);
        if (hasOpenA && !hasOpenB) return -1;
        if (!hasOpenA && hasOpenB) return 1;

        const itemA = a[1].items[0];
        const itemB = b[1].items[0];
        const timeA = itemA ? getItemTimestamp(itemA, 'attendance') : 0;
        const timeB = itemB ? getItemTimestamp(itemB, 'attendance') : 0;
        return (currentSortOrder === 'newest') ? (timeB - timeA) : (timeA - timeB);
      });

      attendanceListEl.innerHTML = sortedCourseEntries.map(([cid, group]) => {
        const userOcc = group.userOcc;
        const hasOpen = group.items.some(a => a.activeSession != null);
        const hasMultipleOccs = group.detectedOccs && group.detectedOccs.length > 1;

        const cleanGroupCourse = cleanDisplayCourseName(group.courseName, group.courseCode);

        return `
          <div class="course-group-card expanded" id="att-course-${cid}">
            <div class="course-group-header">
              <div class="course-group-info" style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <span class="course-group-code">${escapeHtml(group.courseCode || 'Course')}</span>
                  ${cleanGroupCourse ? `<span class="course-group-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;" title="${escapeHtml(cleanGroupCourse)}">${escapeHtml(cleanGroupCourse)}</span>` : ''}
                </div>
                <div class="course-occ-header-row" style="font-size:11px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;margin-top:2px;">
                  <span>OCC Group:</span>
                  ${userOcc ? `
                    <span class="occ-tag-pill">OCC ${escapeHtml(userOcc)}</span>
                    <button class="btn-text-action btn-edit-occ" data-card-id="${cid}" data-course-id="${cid}" style="padding:1px 6px;font-size:10px;">Edit</button>
                  ` : hasMultipleOccs ? `
                    <span style="color:var(--warning);font-weight:600;">Multiple Available (${group.detectedOccs.join(', ')})</span>
                    <button class="btn-text-action btn-edit-occ" data-card-id="${cid}" data-course-id="${cid}" style="padding:1px 6px;font-size:10px;">Set</button>
                  ` : `
                    <span style="color:var(--text-muted);">Standard (All OCCs)</span>
                    <button class="btn-text-action btn-edit-occ" data-card-id="${cid}" data-course-id="${cid}" style="padding:1px 6px;font-size:10px;">Set</button>
                  `}
                  <div class="occ-inline-form" id="occ-form-${cid}" style="${userOcc ? 'display:none;' : 'display:flex;'} align-items:center; gap:4px; margin-left:4px;">
                    <input type="text" class="occ-input-inline" id="occ-input-${cid}" value="${escapeHtml(userOcc)}" placeholder="e.g. 3" maxlength="4">
                    <button class="btn-secondary btn-save-inline-occ" data-card-id="${cid}" data-course-id="${cid}" style="padding:2px 8px;font-size:10.5px;">Save</button>
                    <button class="btn-text-action btn-clear-inline-occ" data-card-id="${cid}" data-course-id="${cid}" style="padding:2px 6px;font-size:10.5px;color:#f87171;">Clear</button>
                  </div>
                </div>
              </div>
              <div class="course-group-meta">
                ${hasOpen ? '<span class="att-open-pulse"><span class="dot"></span> OPEN NOW</span>' : ''}
                <button type="button" class="btn-wireframe btn-sync-single-course" data-course-id="${cid}" data-course-code="${escapeHtml(group.courseCode || '')}" title="Fast Sync this course only (~500ms)" style="padding:2px 7px;font-size:10px;display:inline-flex;align-items:center;gap:3px;">🔄 Sync</button>
                <span class="badge-count">${group.items.length} Type${group.items.length === 1 ? '' : 's'}</span>
                <span class="course-group-chevron">▼</span>
              </div>
            </div>
            <div class="course-group-body">
              ${group.items.map(att => {
                const canHideDuplicate = canHideAttendanceItem(att, group.items);
                return renderAttendanceHierarchicalSubItemHtml(att, canHideDuplicate);
              }).join('')}
            </div>
          </div>
        `;
      }).join('');

      attachCourseGroupToggle(attendanceListEl);
    } else {
      // Timeline Mode (Flat List): Active first, then currentSortOrder (newest vs oldest)
      const itemsByCourse = {};
      filteredAtt.forEach(it => {
        const cid = String(it.courseId || 'general');
        if (!itemsByCourse[cid]) itemsByCourse[cid] = [];
        itemsByCourse[cid].push(it);
      });

      const sorted = sortAttendanceItems(filteredAtt, currentSortOrder);
      attendanceListEl.innerHTML = sorted.map(att => {
        const cid = String(att.courseId || 'general');
        const courseItems = itemsByCourse[cid] || [att];
        const canHideDuplicate = canHideAttendanceItem(att, courseItems);
        return renderAttendanceCardHtml(att, canHideDuplicate);
      }).join('');
    }

    // Attach Inline OCC and Actions
    attachAttendanceActions();
    if (typeof updateAttendanceDaemonStatus === 'function') updateAttendanceDaemonStatus();
  }

  function renderAttendanceHierarchicalSubItemHtml(att, canHideDuplicate = false) {
    return renderAttendanceCardHtml(att, canHideDuplicate);
  }

  // Dedicated Timeline & Day Agenda Attendance Card Renderer
  function renderTimelineAttendanceCardHtml(ev) {
    const att = ev.obj || {};
    const vm = computeAttendanceCardViewModel(att, {
      session: ev.sessObj,
      timeStr: ev.timeStr,
      isLive: ev.status === 'active',
      isVerified: ev.status === 'present' || ev.status === 'submitted',
      dateKey: ev.dateKey,
      cid: ev.courseId || att.courseId
    });
    return renderUnifiedAttendanceCardHtml(vm);
  }

  function renderAttendanceCardHtml(att, sessionOrData = {}) {
    let sessionData = {};
    if (typeof sessionOrData === 'object' && sessionOrData !== null) {
      if (sessionOrData.dateKey || sessionOrData.session || sessionOrData.timeStr || sessionOrData.isLive !== undefined) {
        sessionData = sessionOrData;
      }
    }
    const vm = computeAttendanceCardViewModel(att, sessionData);
    return renderUnifiedAttendanceCardHtml(vm);
  }

  // Robust Attendance Item Lookup helper for buttons
  function findAttendanceForButton(btn) {
    if (!btn) return null;
    const attId = btn.dataset.attId;
    const cardId = btn.dataset.cardId;
    const cid = btn.dataset.courseId;
    const subType = btn.dataset.subType;
    const takeUrl = btn.dataset.takeUrl;

    // 1. Direct match on attId
    let att = attendancesData.find(a => attId && String(a.id) === String(attId));

    // 2. Match on cardId or cleaned ID (strip date suffix like _2026-10-26)
    if (!att && (attId || cardId)) {
      const raw = attId || cardId;
      const cleanId = raw.replace(/_\d{4}-\d{2}-\d{2}$/, '');
      att = attendancesData.find(a => String(a.id) === cleanId || String(a.id).startsWith(cleanId));
    }

    // 3. Search by courseId: prioritize activeSession and matching subType!
    if (!att && cid) {
      att = attendancesData.find(a => String(a.courseId) === String(cid) && a.activeSession != null && (!subType || a.subType === subType))
         || attendancesData.find(a => String(a.courseId) === String(cid) && a.activeSession != null)
         || attendancesData.find(a => String(a.courseId) === String(cid) && (!subType || a.subType === subType))
         || attendancesData.find(a => String(a.courseId) === String(cid));
    }

    // 4. If found att exists but its activeSession is null, check if another attendance entry for the same course has activeSession
    if (att && !att.activeSession && cid) {
      const activeEntry = attendancesData.find(a => String(a.courseId) === String(cid) && a.activeSession != null);
      if (activeEntry) att = activeEntry;
    }

    // 5. Fallback if still not found or missing activeSession, but button dataset has takeUrl
    if ((!att || !att.activeSession) && takeUrl) {
      att = {
        id: attId || cardId || `att_${cid || 'item'}`,
        courseId: cid || '',
        courseCode: btn.dataset.courseCode || '',
        courseName: btn.dataset.courseName || '',
        subType: subType || '',
        attUrl: takeUrl,
        activeSession: {
          takeUrl,
          sesskey: btn.dataset.sesskey || '',
          presentStatusId: btn.dataset.statusId || '',
          desc: 'Class Session',
          time: 'Active now'
        }
      };
    }

    return att;
  }

  // Handle Attend Button Click (Routes to handleDirectAttendanceTake for unified live probe & submission)
  async function handleAttendanceSubmit(btn) {
    if (!btn || btn.disabled) return;
    await handleDirectAttendanceTake(btn);
  }

  // Handle Attendance PIN Button Click
  function handleAttendancePin(btn) {
    if (!btn) return;
    const att = findAttendanceForButton(btn);
    if (att && att.activeSession) {
      openPinModal(att);
    } else {
      const directUrl = btn.dataset.takeUrl || (att && att.attUrl);
      if (directUrl && directUrl !== '#') {
        chrome.tabs.create({ url: directUrl });
      }
    }
  }

  function attachAttendanceActions(container = document) {
    const root = container || document;

    // Delegated click handlers on document to guarantee dynamic cards NEVER drop listeners
    if (!document._hasAttGlobalDelegation) {
      document._hasAttGlobalDelegation = true;
      document.addEventListener('click', async (e) => {
        const takeBtn = e.target.closest('.att-btn-direct-take, .att-btn-submit, .btn-take-single-att');
        if (takeBtn) {
          e.preventDefault();
          e.stopPropagation();
          await handleDirectAttendanceTake(takeBtn);
          return;
        }
        const pinBtn = e.target.closest('.att-btn-pin');
        if (pinBtn) {
          e.preventDefault();
          e.stopPropagation();
          handleAttendancePin(pinBtn);
          return;
        }
        const syncSingleBtn = e.target.closest('.btn-sync-single-course');
        if (syncSingleBtn) {
          e.preventDefault();
          e.stopPropagation();
          const cid = syncSingleBtn.dataset.courseId;
          const code = syncSingleBtn.dataset.courseCode || 'Course';
          syncSingleBtn.disabled = true;
          syncSingleBtn.classList.add('spinning');
          const prevText = syncSingleBtn.textContent;
          syncSingleBtn.textContent = '⏳ Syncing...';
          try {
            await syncSingleCourseAttendance(cid, { courseCode: code });
            syncSingleBtn.textContent = '✔ Synced!';
          } catch (err) {
            syncSingleBtn.textContent = '❌ Error';
          } finally {
            setTimeout(() => {
              syncSingleBtn.disabled = false;
              syncSingleBtn.classList.remove('spinning');
              syncSingleBtn.textContent = prevText;
            }, 1400);
          }
          return;
        }
      });
    }

    // Delegated click handler on root to guarantee clicks on .btn-remove-att-duplicate are never dropped
    if (root && !root._hasRemoveAttListener) {
      root._hasRemoveAttListener = true;
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-remove-att-duplicate');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const attId = btn.dataset.attId;
        if (attId) {
          const card = btn.closest('.att-subitem-card') || btn.closest('.attendance-card');
          if (card) {
            card.style.opacity = '0.35';
            card.style.pointerEvents = 'none';
          }
          await removeAttendanceDuplicate(attId);
        }
      });
    }

    root.querySelectorAll('.btn-remove-att-duplicate').forEach(btn => {
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const attId = btn.dataset.attId;
        if (attId) {
          const card = btn.closest('.att-subitem-card') || btn.closest('.attendance-card');
          if (card) {
            card.style.opacity = '0.35';
            card.style.pointerEvents = 'none';
          }
          await removeAttendanceDuplicate(attId);
        }
      };
    });

    root.querySelectorAll('.btn-toggle-sessions').forEach(btn => {
      btn.addEventListener('click', () => {
        const cardId = btn.dataset.cardId;
        const drawer = document.getElementById(`att-sessions-${cardId}`);
        if (drawer) {
          const isShown = drawer.style.display !== 'none';
          drawer.style.display = isShown ? 'none' : 'block';
          btn.textContent = isShown ? `📋 View All Sessions (${drawer.querySelectorAll('.att-session-row').length}) ▾` : `📋 Hide Sessions ▴`;
        }
      });
    });
    root.querySelectorAll('.btn-edit-occ').forEach(btn => {
      btn.addEventListener('click', () => {
        const cardId = btn.dataset.cardId || btn.dataset.courseId;
        const form = document.getElementById(`occ-form-${cardId}`);
        if (form) form.style.display = 'flex';
      });
    });

    root.querySelectorAll('.btn-save-inline-occ').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = btn.dataset.courseId;
        const cardId = btn.dataset.cardId || cid;
        const input = document.getElementById(`occ-input-${cardId}`);
        const val = input ? input.value.trim() : '';
        await applyUserOcc(cid, val);
      });
    });

    root.querySelectorAll('.btn-clear-inline-occ').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = btn.dataset.courseId;
        await applyUserOcc(cid, '');
      });
    });

    root.querySelectorAll('.att-btn-submit').forEach(btn => {
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleAttendanceSubmit(btn);
      };
    });

    root.querySelectorAll('.att-btn-pin').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAttendancePin(btn);
      };
    });
  }

  function attachCourseGroupToggle(container) {
    container.querySelectorAll('.course-group-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('button, input, .occ-inline-form, a')) return;
        header.closest('.course-group-card').classList.toggle('expanded');
      });
    });
  }

  // ========================================================
  // 10. Interactive Monthly Calendar View Mode
  // ========================================================
  function renderCalendarView(targetYear = calCurrentYear, targetMonth = calCurrentMonth) {
    if (!calendarSection || !calGrid) return;

    calCurrentYear = targetYear;
    calCurrentMonth = targetMonth;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    if (calMonthTitle) {
      calMonthTitle.textContent = `${monthNames[calCurrentMonth]} ${calCurrentYear}`;
    }
    const fulltabHeading = document.getElementById('fulltab-month-heading');
    if (fulltabHeading && currentFullTabMode !== 'materials' && currentFullTabMode !== 'preferences') {
      fulltabHeading.textContent = `${monthNames[calCurrentMonth].toUpperCase()} ${calCurrentYear}`;
    }
    const calTargetDate = new Date(calCurrentYear, calCurrentMonth, 1);
    const calUmInfo = getUmAcademicInfo(calTargetDate);
    const fulltabSemBadge = document.getElementById('fulltab-sem-badge');
    const fulltabWeekPill = document.getElementById('fulltab-week-pill');
    if (fulltabSemBadge) fulltabSemBadge.textContent = calUmInfo.semName;
    if (fulltabWeekPill) fulltabWeekPill.textContent = calUmInfo.weekPill;

    // Collect all events for this month
    const eventsByDate = new Map();

    function addCalEvent(dateKey, ev) {
      if (!eventsByDate.has(dateKey)) eventsByDate.set(dateKey, []);
      eventsByDate.get(dateKey).push(ev);
    }

    const showTasks = chkCalTasks ? chkCalTasks.checked : (chkTlTasks ? chkTlTasks.checked : true);
    const showAtt = chkCalAtt ? chkCalAtt.checked : (chkTlAtt ? chkTlAtt.checked : true);
    const showAnn = chkCalAnn ? chkCalAnn.checked : (chkTlAnn ? chkTlAnn.checked : true);

    // 1. Assignments
    if (showTasks) {
      assignmentsData.forEach(assign => {
        const d = resolveAssignmentDate(assign, new Date());
        const isPending = !assign.isSubmitted && !assign.isOverdue;
        const isValidDate = d && !isNaN(d.getTime());

        if (isValidDate) {
          assign.dueDate = d;
          const key = formatDateKey(d);
          const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          addCalEvent(key, {
            type: 'task',
            id: assign.id,
            title: assign.title,
            courseCode: assign.courseCode || assign.courseName,
            status: assign.isSubmitted ? 'submitted' : (assign.isOverdue ? 'overdue' : 'pending'),
            badgeClass: assign.badgeClass || 'upcoming',
            badgeLabel: assign.badgeLabel || 'Assignment',
            timeStr,
            url: assign.url,
            obj: assign
          });
        } else if (isPending) {
          const todayKey = formatDateKey(new Date());
          addCalEvent(todayKey, {
            type: 'task',
            id: assign.id,
            title: assign.title,
            courseCode: assign.courseCode || assign.courseName,
            status: 'pending',
            badgeClass: 'badge-due-warning',
            badgeLabel: '⏳ Open Task',
            timeStr: 'No deadline',
            url: assign.url,
            obj: assign
          });
        }
      });
    }

    // 2. Attendance
    if (showAtt) {
      const todayKey = formatDateKey(new Date());
      attendancesData.forEach(att => {
        if (isAttendanceHidden(att)) return;
        if (att.activeSession && shouldIncludeInTimelineOrCalendar(att, null)) {
          const typeInfo = getAttendanceTypeInfo(att, att.activeSession.desc || '');
          const cleanDesc = cleanSessionDesc(att.activeSession.desc || 'Current Class Session', typeInfo.label);
          addCalEvent(todayKey, {
            type: 'att',
            id: `att_active_${att.courseId}`,
            title: cleanDesc,
            attTypeInfo: typeInfo,
            courseCode: att.courseCode || att.courseName,
            status: 'active',
            badgeClass: 'active',
            badgeLabel: att.activeSession.requiresPassword ? '🔑 PIN' : '🟢 OPEN NOW',
            timeStr: 'Active Now',
            url: att.attUrl,
            obj: att
          });
        }
        if (Array.isArray(att.sessions)) {
          att.sessions.forEach((sess, sessIdx) => {
            if (!shouldIncludeInTimelineOrCalendar(att, sess)) return;
            if (sess.dateKey) {
              if (sess.dateKey === todayKey && att.activeSession) return;
              let status = sess.statusType || 'scheduled';
              let badgeClass = 'upcoming';
              let badgeLabel = sess.statusLabel || '⏳ Scheduled';

              if (sess.isPresent) {
                status = 'present';
                badgeClass = 'present';
                badgeLabel = '✔ Present';
              } else if (sess.statusType === 'late') {
                status = 'late';
                badgeClass = 'late';
                badgeLabel = '⚠️ Late';
              } else if (sess.statusType === 'absent') {
                status = 'absent';
                badgeClass = 'absent';
                badgeLabel = '❌ Absent';
              } else if (sess.statusType === 'excused') {
                status = 'excused';
                badgeClass = 'excused';
                badgeLabel = 'ℹ️ Excused';
              }

              const typeInfo = getAttendanceTypeInfo(att, sess.desc || '');
              const cleanDesc = cleanSessionDesc(sess.desc || 'Class Session', typeInfo.label);

              addCalEvent(sess.dateKey, {
                type: 'att',
                id: `att_sess_${att.courseId}_${sess.dateKey}_${sessIdx}`,
                title: cleanDesc,
                attTypeInfo: typeInfo,
                courseCode: att.courseCode || att.courseName,
                status,
                badgeClass,
                badgeLabel,
                timeStr: sess.dateStr || '',
                url: att.attUrl,
                obj: att,
                sessObj: sess
              });
            }
          });
        }
      });
    }

    // 3. Announcements
    if (showAnn) {
      announcementsData.forEach(ann => {
        if (ann.timestamp) {
          const d = (ann.timestamp instanceof Date) ? ann.timestamp : new Date(ann.timestamp);
          if (!isNaN(d.getTime())) {
            const key = formatDateKey(d);
            addCalEvent(key, {
              type: 'ann',
              id: ann.id,
              title: ann.title,
              courseCode: ann.courseCode || ann.courseName,
              status: 'notice',
              badgeClass: 'upcoming',
              badgeLabel: 'Notice',
              timeStr: ann.dateStr || '',
              url: ann.discussUrl,
              obj: ann
            });
          }
        }
      });
    }

    // Set uniform 7 equal columns for Monday through Sunday
    if (calGrid) calGrid.style.setProperty('--cal-col-template', 'repeat(7, minmax(0, 1fr))');
    const weekdaysHeader = document.getElementById('cal-weekdays-header');
    if (weekdaysHeader) weekdaysHeader.style.setProperty('--cal-col-template', 'repeat(7, minmax(0, 1fr))');

    // Build Monthly Grid Days (Monday through Sunday)
    const firstDay = new Date(calCurrentYear, calCurrentMonth, 1);
    const lastDate = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
    const startingDay = (firstDay.getDay() + 6) % 7;
    const prevMonthLastDate = new Date(calCurrentYear, calCurrentMonth, 0).getDate();

    let gridHtml = '';
    const nowKey = formatDateKey(new Date());

    // Previous month padding days
    for (let i = startingDay - 1; i >= 0; i--) {
      const pDay = prevMonthLastDate - i;
      const pDate = new Date(calCurrentYear, calCurrentMonth - 1, pDay);
      const pKey = formatDateKey(pDate);
      const pEvents = eventsByDate.get(pKey) || [];
      gridHtml += renderCalCellHtml(pDate, pKey, pEvents, true, nowKey, false);
    }

    // Current month days
    for (let day = 1; day <= lastDate; day++) {
      const cDate = new Date(calCurrentYear, calCurrentMonth, day);
      const cKey = formatDateKey(cDate);
      const cEvents = eventsByDate.get(cKey) || [];
      gridHtml += renderCalCellHtml(cDate, cKey, cEvents, false, nowKey, false);
    }

    // Next month padding days to complete grid
    const totalRendered = startingDay + lastDate;
    const remaining = (7 - (totalRendered % 7)) % 7;
    for (let n = 1; n <= remaining; n++) {
      const nDate = new Date(calCurrentYear, calCurrentMonth + 1, n);
      const nKey = formatDateKey(nDate);
      const nEvents = eventsByDate.get(nKey) || [];
      gridHtml += renderCalCellHtml(nDate, nKey, nEvents, true, nowKey, false);
    }

    calGrid.innerHTML = gridHtml;

    // Attach click events to cells -> shrinks to 65% width and opens 35% right details sidebar
    calGrid.querySelectorAll('.cal-grid-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const key = cell.dataset.dateKey;
        calSelectedDateKey = key;
        calGrid.querySelectorAll('.cal-grid-cell').forEach(c => c.classList.remove('is-selected'));
        cell.classList.add('is-selected');
        showDayAgenda(key, eventsByDate.get(key) || []);
      });
    });

    if (calSelectedDateKey) {
      showDayAgenda(calSelectedDateKey, eventsByDate.get(calSelectedDateKey) || []);
    }

    renderOccBanners();
  }

  function renderCalCellHtml(date, dateKey, events, isOtherMonth, nowKey, isCompressed = false) {
    const isToday = dateKey === nowKey;
    const isSelected = dateKey === calSelectedDateKey;

    const taskCount = events.filter(e => e.type === 'task').length;
    const attCount = events.filter(e => e.type === 'att').length;
    const annCount = events.filter(e => e.type === 'ann').length;

    let pillsHtml = '';
    if (annCount > 0) {
      pillsHtml += `
        <div class="cal-count-pill pill-notice">
          <span class="pill-left">${MINI_ICONS.notice} Notice</span>
          <span class="pill-count">${annCount}</span>
        </div>
      `;
    }
    if (taskCount > 0) {
      pillsHtml += `
        <div class="cal-count-pill pill-assignment">
          <span class="pill-left">${MINI_ICONS.assignment} Assignment</span>
          <span class="pill-count">${taskCount}</span>
        </div>
      `;
    }
    if (attCount > 0) {
      pillsHtml += `
        <div class="cal-count-pill pill-attendance">
          <span class="pill-left">${MINI_ICONS.attendance} Attendance</span>
          <span class="pill-count">${attCount}</span>
        </div>
      `;
    }

    return `
      <div class="cal-grid-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${isCompressed ? 'is-compressed' : ''}" data-date-key="${dateKey}">
        <div class="cal-cell-header">
          <span class="cal-cell-num">${date.getDate()}</span>
          ${isToday ? '<span class="cal-cell-today-dot"></span>' : ''}
        </div>
        <div class="cal-pills-stack">
          ${pillsHtml}
        </div>
      </div>
    `;
  }

  function showDayAgenda(dateKey, events = []) {
    // 1. Full-Tab 35% Right Details Sidebar (Spec 4.1 Master-Detail)
    const sidebar = document.getElementById('cal-detail-sidebar');
    const calSection = document.getElementById('calendar-section');
    const sidebarTitle = document.getElementById('cal-sidebar-date-title');
    const sidebarCount = document.getElementById('cal-sidebar-item-count');
    const sidebarList = document.getElementById('cal-sidebar-cards-list');

    const parsedDate = new Date(dateKey + 'T00:00:00');
    const formattedDate = !isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : dateKey;
    if (!isNaN(parsedDate.getTime())) {
      const dayUmInfo = getUmAcademicInfo(parsedDate);
      const semBadgeEl = document.getElementById('fulltab-sem-badge');
      const weekPillEl = document.getElementById('fulltab-week-pill');
      if (semBadgeEl) semBadgeEl.textContent = dayUmInfo.semName;
      if (weekPillEl) weekPillEl.textContent = dayUmInfo.weekPill;
    }

    if (sidebar && sidebarTitle && sidebarList) {
      if (calSection) calSection.classList.add('has-sidebar');
      sidebar.style.display = 'flex';
      sidebarTitle.textContent = formattedDate;
      if (sidebarCount) sidebarCount.textContent = `${events.length} item${events.length === 1 ? '' : 's'}`;

      if (events.length === 0) {
        sidebarList.innerHTML = `<div style="text-align:center;padding:24px 12px;color:var(--text-muted);font-size:12px;">No activities scheduled on this day.</div>`;
      } else {
        sidebarList.innerHTML = events.map(ev => {
          if (ev.type === 'task' || ev.type === 'assignment') return renderAssignmentCardHtml(ev.obj || ev);
          if (ev.type === 'att' || ev.type === 'attendance') return renderTimelineAttendanceCardHtml(ev);
          return renderAnnouncementCardHtml(ev.obj || ev);
        }).join('');
        attachAttendanceActions(sidebarList);
      }
    }

    // 2. Compatibility with existing calDayAgenda drawer
    if (calDayAgenda && calAgendaDate && calAgendaList) {
      calAgendaDate.textContent = formattedDate;
      if (calAgendaCount) calAgendaCount.textContent = `${events.length} item${events.length === 1 ? '' : 's'}`;
      if (events.length === 0) {
        calAgendaList.innerHTML = `<div style="text-align:center;padding:18px;color:var(--text-muted);font-size:11.5px;">No activities on this day.</div>`;
      } else {
        calAgendaList.innerHTML = events.map(ev => {
          if (ev.type === 'task' || ev.type === 'assignment') return renderAssignmentCardHtml(ev.obj || ev);
          if (ev.type === 'att' || ev.type === 'attendance') return renderTimelineAttendanceCardHtml(ev);
          return renderAnnouncementCardHtml(ev.obj || ev);
        }).join('');
        attachAttendanceActions(calAgendaList);
      }

      calAgendaList.querySelectorAll('.btn-read-agenda-ann').forEach(btn => {
        btn.addEventListener('click', () => {
          const ann = announcementsData.find(a => String(a.id) === String(btn.dataset.annId));
          if (ann) openAnnouncementModal(ann);
        });
      });

      calAgendaList.querySelectorAll('.btn-take-single-att').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = btn.dataset.courseId;
          const attId = btn.dataset.attId;
          const att = attendancesData.find(a => (attId && String(a.id) === String(attId)) || String(a.courseId) === String(cid));
          if (att && att.activeSession) {
            if (att.activeSession.requiresPassword) {
              openPinModal(att);
            } else {
              submitCourseAttendance(att, '');
            }
          }
        });
      });

      calAgendaList.querySelectorAll('.btn-remove-att-duplicate, .btn-remove-agenda-att').forEach(btn => {
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetId = btn.dataset.attId;
          if (targetId) {
            const card = btn.closest('.attendance-card');
            if (card) {
              card.style.opacity = '0.35';
              card.style.pointerEvents = 'none';
            }
            await removeAttendanceDuplicate(targetId);
            if (calDayAgenda && calDayAgenda.style.display !== 'none') {
              const activeDayCell = calGrid.querySelector('.cal-day-cell.selected, .cal-day-cell.is-selected');
              if (activeDayCell && activeDayCell.dataset.dateKey) {
                const k = activeDayCell.dataset.dateKey;
                showDayAgenda(k, eventsByDate.get(k) || []);
              } else {
                calDayAgenda.style.display = 'none';
              }
            }
          }
        };
      });

      calDayAgenda.style.display = 'block';
    }
  }

  // ==========================================================================
  // VIEW 3: FULL-TAB DAY-BY-DAY PAGED LIST MODE
  // ==========================================================================
  let fullListCurrentDate = new Date();
  let fullListWheelCooldown = 0;

  function formatDateKeyToShort(key) {
    if (!key) return '';
    const parts = key.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0])) return key;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function getFullListActiveDateKeys(showTasks, showAtt, showAnn) {
    const dateSet = new Set();
    const now = new Date();
    const todayKey = formatDateKey(now);
    dateSet.add(todayKey);

    if (showTasks) {
      assignmentsData.forEach(assign => {
        const d = resolveAssignmentDate(assign, now);
        if (d && !isNaN(d.getTime())) dateSet.add(formatDateKey(d));
      });
    }

    if (showAtt) {
      attendancesData.forEach(att => {
        if (isAttendanceHidden(att)) return;
        if (att.activeSession) dateSet.add(todayKey);
        if (Array.isArray(att.sessions)) {
          att.sessions.forEach(s => {
            const k = s.dateKey || (s.date ? formatDateKey(s.date) : '');
            if (k) dateSet.add(k);
          });
        }
        if (att.nextSession) {
          const k = att.nextSession.dateKey || (att.nextSession.date ? formatDateKey(att.nextSession.date) : '');
          if (k) dateSet.add(k);
        }
      });
    }

    if (showAnn) {
      announcementsData.forEach(ann => {
        if (ann.timestamp) {
          const d = (ann.timestamp instanceof Date) ? ann.timestamp : new Date(ann.timestamp);
          if (d && !isNaN(d.getTime())) dateSet.add(formatDateKey(d));
        }
      });
    }

    return Array.from(dateSet).sort();
  }

  function getFullListActivitiesForDate(targetDateKey, showTasks = true, showAtt = true, showAnn = true) {
    const events = [];
    const now = new Date();
    const todayKey = formatDateKey(now);
    const isTargetToday = (targetDateKey === todayKey);

    // 1. Assignments
    if (showTasks) {
      assignmentsData.forEach(assign => {
        const d = resolveAssignmentDate(assign, now);
        const isPending = !assign.isSubmitted && !assign.isOverdue;
        const isValidDate = d && !isNaN(d.getTime());

        if (isValidDate) {
          assign.dueDate = d;
          const key = formatDateKey(d);
          if (key === targetDateKey) {
            events.push({
              type: 'task',
              id: assign.id,
              title: assign.title,
              courseCode: assign.courseCode || assign.courseName || 'Task',
              courseName: assign.courseName || '',
              status: assign.isSubmitted ? 'submitted' : (assign.isOverdue ? 'overdue' : (assign.isDueSoon ? 'duesoon' : 'upcoming')),
              badgeLabel: assign.badgeLabel || 'Assignment',
              date: d,
              dateKey: key,
              url: assign.url,
              obj: assign
            });
          }
        } else if (isPending && isTargetToday) {
          // Open task with no deadline appears on Today so it's actionable
          events.push({
            type: 'task',
            id: assign.id,
            title: assign.title,
            courseCode: assign.courseCode || assign.courseName || 'Task',
            courseName: assign.courseName || '',
            status: 'upcoming',
            badgeLabel: '⏳ Open Task',
            date: now,
            dateKey: todayKey,
            url: assign.url,
            obj: assign
          });
        }
      });
    }

    // 2. Attendance
    if (showAtt) {
      attendancesData.forEach(att => {
        if (isAttendanceHidden(att)) return;

        // If viewing Today, include active session if open
        if (isTargetToday && att.activeSession && shouldIncludeInTimelineOrCalendar(att, null)) {
          const typeInfo = getAttendanceTypeInfo(att, att.activeSession.desc || '');
          const cleanDesc = cleanSessionDesc(att.activeSession.desc || 'Current Class Session', typeInfo.label);
          events.push({
            type: 'att',
            id: `att_active_${att.courseId}`,
            title: cleanDesc,
            attTypeInfo: typeInfo,
            courseCode: att.courseCode || att.courseName || 'Course',
            courseName: att.courseName || '',
            status: 'active',
            statusLabel: `${typeInfo.icon} ${typeInfo.label} · ${att.activeSession.requiresPassword ? '🔑 PIN' : '🟢 OPEN NOW'}`,
            date: now,
            dateKey: todayKey,
            url: att.attUrl,
            obj: att,
            sessObj: {
              date: now,
              dateKey: todayKey,
              dateStr: att.activeSession.time || 'Active Now',
              desc: cleanDesc,
              statusType: 'active',
              statusLabel: '🟢 OPEN NOW'
            }
          });
        }

        // Check scheduled / historical sessions
        if (Array.isArray(att.sessions)) {
          att.sessions.forEach(sess => {
            if (!shouldIncludeInTimelineOrCalendar(att, sess)) return;
            const sessDateKey = sess.dateKey || (sess.date ? formatDateKey(sess.date) : '');
            if (sessDateKey === targetDateKey) {
              if (isTargetToday && att.activeSession) return;
              const rawDate = sess.date;
              const d = (rawDate instanceof Date && !isNaN(rawDate.getTime()))
                ? rawDate
                : (rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : new Date(targetDateKey + 'T12:00:00'));

              let status = sess.statusType || 'scheduled';
              let statusLabel = sess.statusLabel || '⏳ Scheduled';
              if (sess.isPresent) {
                status = 'submitted';
                statusLabel = '✔ Present';
              } else if (sess.statusType === 'late') {
                status = 'late';
                statusLabel = '⚠️ Late';
              } else if (sess.statusType === 'absent') {
                status = 'overdue';
                statusLabel = '❌ Absent';
              } else if (sess.statusType === 'excused') {
                status = 'upcoming';
                statusLabel = 'ℹ️ Excused';
              }

              const typeInfo = getAttendanceTypeInfo(att, sess.desc || '');
              const cleanDesc = cleanSessionDesc(sess.desc || 'Class Session', typeInfo.label);
              events.push({
                type: 'att',
                id: `att_${att.courseId}_${sessDateKey}`,
                title: cleanDesc,
                attTypeInfo: typeInfo,
                courseCode: att.courseCode || att.courseName || 'Course',
                courseName: att.courseName || '',
                status,
                statusLabel: `${typeInfo.icon} ${typeInfo.label} · ${statusLabel}`,
                date: d,
                dateKey: sessDateKey,
                url: att.attUrl,
                obj: att,
                sessObj: sess
              });
            }
          });
        }

        // Check att.nextSession (ensure scheduled classes not yet in sessions show up on their day)
        if (att.nextSession && shouldIncludeInTimelineOrCalendar(att, att.nextSession)) {
          const nextSess = att.nextSession;
          const nsDateKey = nextSess.dateKey || (nextSess.date ? formatDateKey(nextSess.date) : '');
          if (nsDateKey === targetDateKey) {
            const alreadyAdded = events.some(e => e.type === 'att' && e.obj?.courseId === att.courseId);
            if (!alreadyAdded && (!isTargetToday || !att.activeSession)) {
              const rawDate = nextSess.date;
              const d = (rawDate instanceof Date && !isNaN(rawDate.getTime()))
                ? rawDate
                : (rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : new Date(targetDateKey + 'T12:00:00'));
              const typeInfo = getAttendanceTypeInfo(att, nextSess.desc || '');
              const cleanDesc = cleanSessionDesc(nextSess.desc || 'Scheduled Class Session', typeInfo.label);
              events.push({
                type: 'att',
                id: `att_${att.courseId}_${nsDateKey}`,
                title: cleanDesc,
                attTypeInfo: typeInfo,
                courseCode: att.courseCode || att.courseName || 'Course',
                courseName: att.courseName || '',
                status: 'upcoming',
                statusLabel: `${typeInfo.icon} ${typeInfo.label} · ⏳ Scheduled`,
                date: d,
                dateKey: nsDateKey,
                url: att.attUrl,
                obj: att,
                sessObj: nextSess
              });
            }
          }
        }
      });
    }

    // 3. Announcements
    if (showAnn) {
      announcementsData.forEach(ann => {
        if (ann.timestamp) {
          const rawD = ann.timestamp;
          const d = (rawD instanceof Date) ? rawD : (rawD ? new Date(rawD) : null);
          if (d && !isNaN(d.getTime())) {
            const annKey = formatDateKey(d);
            if (annKey === targetDateKey) {
              events.push({
                type: 'ann',
                id: ann.id,
                title: ann.title || 'Announcement',
                courseCode: ann.courseCode || ann.courseName || 'Notice',
                courseName: ann.courseName || '',
                status: 'upcoming',
                statusLabel: '📢 Notice',
                date: d,
                dateKey: annKey,
                url: ann.discussUrl,
                obj: ann
              });
            }
          }
        }
      });
    }

    return events;
  }

  function renderFullListMode(targetDate = null, direction = 1) {
    const feed = document.getElementById('fulllist-cards-feed');
    if (!feed) return;

    if (targetDate) {
      fullListCurrentDate = (targetDate instanceof Date) ? targetDate : new Date(targetDate);
    }
    if (!fullListCurrentDate || isNaN(fullListCurrentDate.getTime())) {
      fullListCurrentDate = new Date();
    }

    const showTasks = chkCalTasks ? chkCalTasks.checked : (chkTlTasks ? chkTlTasks.checked : true);
    const showAtt = chkCalAtt ? chkCalAtt.checked : (chkTlAtt ? chkTlAtt.checked : true);
    const showAnn = chkCalAnn ? chkCalAnn.checked : (chkTlAnn ? chkTlAnn.checked : true);

    // Update Top Toolbar buttons (Date vs Course and Newest vs Oldest)
    const btnDate = document.getElementById('btn-fulllist-group-date');
    const btnCourse = document.getElementById('btn-fulllist-group-course');
    if (btnDate) btnDate.classList.toggle('active', fullListGroupingMode === 'date');
    if (btnCourse) btnCourse.classList.toggle('active', fullListGroupingMode === 'course');

    const btnSortNew = document.getElementById('btn-fulllist-sort-newest');
    const btnSortOld = document.getElementById('btn-fulllist-sort-oldest');
    if (btnSortNew) btnSortNew.classList.toggle('active', currentSortOrder === 'newest');
    if (btnSortOld) btnSortOld.classList.toggle('active', currentSortOrder === 'oldest');

    const sideDatePane = document.getElementById('fulllist-side-date-pane');
    const sideCoursePane = document.getElementById('fulllist-side-course-pane');
    const feedBody = document.getElementById('fulllist-feed-body') || feed;
    const summaryEl = document.getElementById('fulllist-toolbar-summary');

    if (fullListGroupingMode === 'course') {
      // ----------------------------------------------------
      // Full-Tab List Mode: Grouped By Course
      // ----------------------------------------------------
      if (sideDatePane) sideDatePane.style.display = 'none';
      if (sideCoursePane) sideCoursePane.style.display = 'flex';

      const courseMap = new Map();

      // 1. Assignments
      if (showTasks) {
        assignmentsData.forEach(assign => {
          const cid = String(assign.courseId || 'general');
          if (!courseMap.has(cid)) {
            courseMap.set(cid, {
              courseId: cid,
              courseCode: assign.courseCode || assign.courseName || 'Course',
              courseName: assign.courseName || '',
              items: []
            });
          }
          courseMap.get(cid).items.push({
            type: 'task',
            id: assign.id,
            obj: assign,
            timestamp: getItemTimestamp(assign, 'assignment')
          });
        });
      }

      // 2. Attendance
      if (showAtt) {
        attendancesData.forEach(att => {
          if (isAttendanceHidden(att)) return;
          const cid = String(att.courseId || 'general');
          if (!courseMap.has(cid)) {
            courseMap.set(cid, {
              courseId: cid,
              courseCode: att.courseCode || att.courseName || 'Course',
              courseName: att.courseName || '',
              userOcc: att.userOcc || courseOccs[cid] || defaultOcc || '',
              detectedOccs: Array.isArray(att.detectedOccs) ? [...att.detectedOccs] : [],
              items: []
            });
          }
          const grp = courseMap.get(cid);
          if (!grp.userOcc && (att.userOcc || courseOccs[cid])) {
            grp.userOcc = att.userOcc || courseOccs[cid];
          }
          if (Array.isArray(att.detectedOccs)) {
            att.detectedOccs.forEach(o => {
              if (!grp.detectedOccs.includes(o)) grp.detectedOccs.push(o);
            });
          }
          grp.items.push({
            type: 'att',
            id: att.id,
            obj: att,
            timestamp: getItemTimestamp(att, 'attendance')
          });
        });
      }

      // 3. Announcements
      if (showAnn) {
        announcementsData.forEach(ann => {
          const cid = String(ann.courseId || 'general');
          if (!courseMap.has(cid)) {
            courseMap.set(cid, {
              courseId: cid,
              courseCode: ann.courseCode || ann.courseName || 'Course',
              courseName: ann.courseName || '',
              items: []
            });
          }
          courseMap.get(cid).items.push({
            type: 'ann',
            id: ann.id,
            obj: ann,
            timestamp: getItemTimestamp(ann, 'announcement')
          });
        });
      }

      // Sort items within each course group according to currentSortOrder
      const sortedEntries = Array.from(courseMap.entries()).map(([cid, group]) => {
        group.items.sort((a, b) => {
          // Open active session comes first
          if (a.obj?.activeSession && !b.obj?.activeSession) return -1;
          if (!a.obj?.activeSession && b.obj?.activeSession) return 1;

          const tA = a.timestamp || 0;
          const tB = b.timestamp || 0;
          if (tA > 0 && tB > 0) {
            return currentSortOrder === 'newest' ? (tB - tA) : (tA - tB);
          } else if (tA > 0) return -1;
          else if (tB > 0) return 1;
          return 0;
        });
        return [cid, group];
      });

      // Sort course groups by their top activity
      sortedEntries.sort((a, b) => {
        const hasOpenA = a[1].items.some(it => it.obj?.activeSession != null);
        const hasOpenB = b[1].items.some(it => it.obj?.activeSession != null);
        if (hasOpenA && !hasOpenB) return -1;
        if (!hasOpenA && hasOpenB) return 1;

        const topA = a[1].items[0]?.timestamp || 0;
        const topB = b[1].items[0]?.timestamp || 0;
        return currentSortOrder === 'newest' ? (topB - topA) : (topA - topB);
      });

      let totalActivitiesCount = 0;
      sortedEntries.forEach(([, g]) => { totalActivitiesCount += g.items.length; });

      if (summaryEl) summaryEl.textContent = `${sortedEntries.length} COURSES · ${totalActivitiesCount} ACTIVITIES`;

      // Update Side Course Pane
      const courseCountEl = document.getElementById('fulllist-course-count');
      const courseItemsEl = document.getElementById('fulllist-course-items-count');
      const courseJumpList = document.getElementById('fulllist-course-jump-list');
      if (courseCountEl) courseCountEl.textContent = sortedEntries.length;
      if (courseItemsEl) courseItemsEl.textContent = `${totalActivitiesCount} Activities`;
      if (courseJumpList) {
        courseJumpList.innerHTML = sortedEntries.map(([cid, g]) => `
          <a class="fulllist-course-jump-item" href="#fulllist-cgroup-${cid}">
            <span>${escapeHtml(g.courseCode || 'Course')}</span>
            <span class="badge-count" style="font-size:9.5px;">${g.items.length}</span>
          </a>
        `).join('');
      }

      if (sortedEntries.length === 0) {
        feedBody.innerHTML = `
          <div class="fulllist-empty-day-card">
            <div class="empty-day-icon">📚</div>
            <div class="empty-day-title">No course activities match active filters</div>
            <div class="empty-day-sub">Enable tasks, attendance, or notices on the left rail stadium pill to view them here.</div>
          </div>
        `;
        return;
      }

      feedBody.innerHTML = sortedEntries.map(([cid, group]) => {
        const cleanCourse = cleanDisplayCourseName(group.courseName, group.courseCode);
        const userOcc = group.userOcc;
        const hasOpen = group.items.some(it => it.obj?.activeSession != null);
        return `
          <div class="course-group-card expanded" id="fulllist-cgroup-${cid}" style="margin-bottom:12px;">
            <div class="course-group-header">
              <div class="course-group-info">
                <span class="course-group-code">${escapeHtml(group.courseCode || 'Course')}</span>
                ${cleanCourse ? `<span class="course-group-title">${escapeHtml(cleanCourse)}</span>` : ''}
              </div>
              <div class="course-group-meta">
                ${hasOpen ? '<span class="att-open-pulse"><span class="dot"></span> OPEN NOW</span>' : ''}
                ${userOcc ? `<span class="occ-tag-pill">OCC ${escapeHtml(userOcc)}</span>` : ''}
                <span class="badge-count">${group.items.length} activities</span>
                <span class="course-group-chevron">▼</span>
              </div>
            </div>
            <div class="course-group-body">
              ${group.items.map(it => {
                if (it.type === 'task') return renderAssignmentCardHtml(it.obj);
                if (it.type === 'att') return renderAttendanceCardHtml(it.obj);
                return renderAnnouncementCardHtml(it.obj);
              }).join('')}
            </div>
          </div>
        `;
      }).join('');

      attachCourseGroupToggle(feedBody);
      attachAttendanceActions(feedBody);

    } else {
      // ----------------------------------------------------
      // Full-Tab List Mode: Grouped By Date (Day Page)
      // ----------------------------------------------------
      if (sideDatePane) sideDatePane.style.display = 'flex';
      if (sideCoursePane) sideCoursePane.style.display = 'none';

      const targetKey = formatDateKey(fullListCurrentDate);
      const now = new Date();
      const todayKey = formatDateKey(now);
      const isToday = (targetKey === todayKey);
      const umInfo = getUmAcademicInfo(fullListCurrentDate);

      // Update Sticky Date Card (Day, Month, Weekday, Sem Week)
      const dayEl = document.getElementById('fulllist-box-day');
      const monthEl = document.getElementById('fulllist-box-month');
      const weekdayEl = document.getElementById('fulllist-box-weekday');
      const semweekEl = document.getElementById('fulllist-box-semweek');
      const stickyCard = document.getElementById('fulllist-sticky-card') || document.querySelector('#fulllist-wrapper .sticky-date-card');

      if (dayEl) dayEl.textContent = String(fullListCurrentDate.getDate()).padStart(2, '0');
      if (monthEl) monthEl.textContent = fullListCurrentDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      if (weekdayEl) weekdayEl.textContent = fullListCurrentDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      if (semweekEl) semweekEl.textContent = `SEM WK ${umInfo.weekNum}`;

      // Sticky card updated without reflow thrashing

      // Update Header month display
      const monthHeading = document.getElementById('fulltab-month-heading');
      if (monthHeading) {
        monthHeading.textContent = fullListCurrentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
      }

      // Collect activities for this specific date
      const dayEvents = getFullListActivitiesForDate(targetKey, showTasks, showAtt, showAnn);

      // Sort activities on this day according to currentSortOrder
      dayEvents.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;

        const tA = getItemTimestamp(a.obj || a, a.type === 'task' ? 'assignment' : (a.type === 'att' ? 'attendance' : 'announcement'));
        const tB = getItemTimestamp(b.obj || b, b.type === 'task' ? 'assignment' : (b.type === 'att' ? 'attendance' : 'announcement'));
        if (tA > 0 && tB > 0) {
          return currentSortOrder === 'newest' ? (tB - tA) : (tA - tB);
        } else if (tA > 0) return -1;
        else if (tB > 0) return 1;
        return 0;
      });

      // Active event dates for jump buttons
      const activeDateKeys = getFullListActiveDateKeys(showTasks, showAtt, showAnn);
      const prevActKey = [...activeDateKeys].reverse().find(k => k < targetKey);
      const nextActKey = activeDateKeys.find(k => k > targetKey);

      const fullDateFormatted = fullListCurrentDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const countText = `${dayEvents.length} Activit${dayEvents.length === 1 ? 'y' : 'ies'}`;
      const nextDateObj = new Date(fullListCurrentDate.getTime() + 86400000);
      const nextDayShortLabel = nextDateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      if (summaryEl) summaryEl.textContent = countText.toUpperCase();

      let cardsHtml = '';
      if (dayEvents.length === 0) {
        cardsHtml = `
          <div class="fulllist-empty-day-card">
            <div class="empty-day-icon">☕</div>
            <div class="empty-day-title">No activities scheduled for this day</div>
            <div class="empty-day-sub">${escapeHtml(fullDateFormatted)} has no assignment deadlines, classes, or notices scheduled.</div>
            <div class="empty-day-actions">
              ${!isToday ? `<button type="button" class="empty-day-btn" id="empty-btn-today">📅 Return to Today</button>` : ''}
              ${nextActKey ? `<button type="button" class="empty-day-btn primary" id="empty-btn-next-act">Jump to Next Activity (${escapeHtml(formatDateKeyToShort(nextActKey))}) →</button>` : ''}
            </div>
          </div>
        `;
      } else {
        cardsHtml = dayEvents.map(ev => {
          if (ev.type === 'task' || ev.type === 'assignment') return renderAssignmentCardHtml(ev.obj || ev);
          if (ev.type === 'att' || ev.type === 'attendance') return renderTimelineAttendanceCardHtml(ev);
          return renderAnnouncementCardHtml(ev.obj || ev);
        }).join('');
      }

      const slideClass = direction >= 0 ? 'slide-next' : 'slide-prev';

      feedBody.innerHTML = `
        <div class="fulllist-day-header-bar">
          <div class="day-header-title-wrap">
            <span class="day-header-title">${escapeHtml(fullDateFormatted)}</span>
            ${isToday ? '<span class="day-header-today-pill">TODAY</span>' : ''}
            <span class="day-header-count-pill">${countText}</span>
          </div>
          <div class="day-header-actions">
            <button type="button" class="fulllist-header-nav-btn" id="fulllist-header-prev" title="Previous Day (Arrow Left)">‹ Prev</button>
            <button type="button" class="fulllist-header-nav-btn" id="fulllist-header-today" title="Jump to Today">Today</button>
            <button type="button" class="fulllist-header-nav-btn" id="fulllist-header-next" title="Next Day (Arrow Right)">Next ›</button>
          </div>
        </div>

        <div class="fulllist-cards-page ${slideClass}" id="fulllist-cards-page-container">
          ${cardsHtml}
        </div>

        <div class="day-page-footer">
          <button type="button" class="btn-page-step" id="fulllist-bottom-next-btn">
            <span>Proceed to Next Day (${escapeHtml(nextDayShortLabel)})</span>
            <span style="font-size:14px;display:inline-block;transition:transform 0.2s;">↓</span>
          </button>
        </div>
      `;

      attachAttendanceActions(feedBody);

      // Update disabled state on side jump buttons
      const sidePrevAct = document.getElementById('fulllist-side-prev-act');
      const sideNextAct = document.getElementById('fulllist-side-next-act');
      if (sidePrevAct) sidePrevAct.disabled = !prevActKey;
      if (sideNextAct) sideNextAct.disabled = !nextActKey;

      // Attach Day Navigation Listeners
      const bindNavBtn = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.onclick = (e) => { e.preventDefault(); handler(); };
      };

      bindNavBtn('fulllist-header-prev', () => stepFullListDay(-1));
      bindNavBtn('fulllist-side-prev', () => stepFullListDay(-1));

      bindNavBtn('fulllist-header-next', () => stepFullListDay(1));
      bindNavBtn('fulllist-side-next', () => stepFullListDay(1));
      bindNavBtn('fulllist-bottom-next-btn', () => stepFullListDay(1));

      bindNavBtn('fulllist-header-today', () => goToFullListDay(new Date()));
      bindNavBtn('fulllist-side-today', () => goToFullListDay(new Date()));
      bindNavBtn('empty-btn-today', () => goToFullListDay(new Date()));

      bindNavBtn('fulllist-side-prev-act', () => {
        if (prevActKey) goToFullListDay(new Date(prevActKey + 'T12:00:00'), -1);
      });
      bindNavBtn('fulllist-side-next-act', () => {
        if (nextActKey) goToFullListDay(new Date(nextActKey + 'T12:00:00'), 1);
      });
      bindNavBtn('empty-btn-next-act', () => {
        if (nextActKey) goToFullListDay(new Date(nextActKey + 'T12:00:00'), 1);
      });
    }

    // Reset scroll smoothly to top of feed
    const wrapper = document.getElementById('fulllist-wrapper');
    if (wrapper) wrapper.scrollTop = 0;

    initFullListMoveHandlers();
  }

  function stepFullListDay(deltaDays = 1) {
    if (!fullListCurrentDate || isNaN(fullListCurrentDate.getTime())) fullListCurrentDate = new Date();
    const nextDate = new Date(fullListCurrentDate.getTime() + deltaDays * 86400000);
    renderFullListMode(nextDate, deltaDays >= 0 ? 1 : -1);
  }

  function goToFullListDay(date, direction = 1) {
    renderFullListMode(date, direction);
  }

  // Scroll / Wheel Down and Keyboard Day Navigation Handlers
  function initFullListMoveHandlers() {
    const wrapper = document.getElementById('fulllist-wrapper');
    if (!wrapper || wrapper._hasMoveHandlers) return;
    wrapper._hasMoveHandlers = true;
    wrapper.tabIndex = 0;

    let wheelDeltaAccumulator = 0;

    // Detect user moving down past the bottom of the day page to step to next day
    wrapper.addEventListener('wheel', (e) => {
      if (wrapper.style.display === 'none') return;
      const now = Date.now();
      if (now - fullListWheelCooldown < 450) return;

      const isAtBottom = (wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight - 15);
      const isAtTop = (wrapper.scrollTop <= 5);

      if (e.deltaY > 25 && isAtBottom) {
        wheelDeltaAccumulator += e.deltaY;
        if (wheelDeltaAccumulator > 70) {
          wheelDeltaAccumulator = 0;
          fullListWheelCooldown = now;
          stepFullListDay(1);
        }
      } else if (e.deltaY < -25 && isAtTop) {
        wheelDeltaAccumulator += e.deltaY;
        if (wheelDeltaAccumulator < -70) {
          wheelDeltaAccumulator = 0;
          fullListWheelCooldown = now;
          stepFullListDay(-1);
        }
      } else {
        wheelDeltaAccumulator = 0;
      }
    }, { passive: true });

    // Keyboard Arrow navigation for Day Page
    wrapper.addEventListener('keydown', (e) => {
      if (wrapper.style.display === 'none') return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        stepFullListDay(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        stepFullListDay(-1);
      } else if (e.key === 'Home' || e.key.toLowerCase() === 't') {
        e.preventDefault();
        goToFullListDay(new Date());
      }
    });
  }

  function createCourseTreeShell(c) {
    const rawName = (c.name || '').replace(/[\r\n\t]+/g, ' ').replace(/^Course name\s*/i, '').trim();
    const codeMatch = rawName.match(/^[A-Z]{2,4}\d{4}(?:\/[A-Z]{2,4}\d{4})?/);
    const code = codeMatch ? codeMatch[0] : (c.code || `Course ${c.id}`);
    const cleanTitle = cleanDisplayCourseName(rawName, code);
    return {
      id: String(c.id),
      name: rawName || c.name,
      code: code,
      title: cleanTitle || rawName || c.name,
      url: c.url,
      sections: [],
      announcements: [],
      checked: true,
      expanded: false,
      loaded: false,
      isInProgress: Boolean(c.isInProgress),
      isPast: Boolean(c.isPast)
    };
  }

  function filterCoursesByScope(courses, scope = 'active') {
    if (!courses || !Array.isArray(courses)) return [];
    if (scope === 'all') return courses;

    // First find the latest academic session year (e.g. 2025/2026 or 2026/2027)
    let maxYear = 0;
    courses.forEach(c => {
      const m = (c.name || '').match(/20(\d{2})\/20(\d{2})/);
      if (m) {
        const yr = parseInt(m[2], 10);
        if (yr > maxYear) maxYear = yr;
      }
    });

    // Active filter:
    // 1. Exclude courses marked explicitly isPast
    // 2. If a course has a session year tag, check if it matches the latest academic year
    // 3. If a course has NO session year tag (e.g. "WIA2001/WIB2001 DATABASE"), include it as an active semester course
    const activeCourses = courses.filter(c => {
      if (c.isInProgress) return true;
      if (c.isPast) return false;
      const m = (c.name || '').match(/20(\d{2})\/20(\d{2})/);
      if (m) {
        return maxYear > 0 ? (parseInt(m[2], 10) === maxYear) : true;
      }
      return true;
    });

    logDiag('Courses:Scope', `Scope "${scope}": filtered ${courses.length} courses to ${activeCourses.length} (maxYear: ${maxYear})`);
    return activeCourses.length > 0 ? activeCourses : courses;
  }

  function getKnownCoursesList() {
    const isRealCourse = c => c && c.id && /^\d+$/.test(String(c.id));
    const map = new Map();
    if (Array.isArray(coursesData)) {
      coursesData.filter(isRealCourse).forEach(c => {
        map.set(String(c.id), { id: String(c.id), code: c.code || `Course ${c.id}`, title: c.title || c.name || '' });
      });
    }
    if (Array.isArray(allCoursesDiscovered)) {
      const scoped = (courseScope === 'active') ? filterCoursesByScope(allCoursesDiscovered, 'active') : allCoursesDiscovered;
      scoped.filter(isRealCourse).forEach(c => {
        if (!map.has(String(c.id))) {
          const shell = createCourseTreeShell(c);
          map.set(String(c.id), { id: String(c.id), code: shell.code, title: shell.title || shell.name || '' });
        }
      });
    }
    if (Array.isArray(attendancesData)) {
      attendancesData.filter(a => a && a.courseId && /^\d+$/.test(String(a.courseId))).forEach(a => {
        if (!map.has(String(a.courseId))) {
          map.set(String(a.courseId), { id: String(a.courseId), code: a.courseCode || `Course ${a.courseId}`, title: a.courseName || a.courseCode || '' });
        }
      });
    }
    return Array.from(map.values()).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }

  function showNotLoggedInState() {
    if (statusIndicator) {
      statusIndicator.className = 'status-indicator';
      statusIndicator.innerHTML = '<span class="dot" style="background:#ef4444;box-shadow:none;"></span> Log In Required';
    }
    const hasAnyCachedData = (assignmentsData.length > 0 || announcementsData.length > 0 || attendancesData.length > 0 || coursesData.length > 0);
    if (!hasAnyCachedData) {
      const notLoggedInMsg = `
        <div style="text-align:center;padding:36px 16px;">
          <div style="font-size:32px;margin-bottom:10px;">🔐</div>
          <h4 style="font-size:14px;font-weight:600;margin-bottom:8px;color:var(--text-primary);">SPeCTRUM Session Expired</h4>
          <p style="font-size:12px;color:var(--text-secondary);max-width:340px;margin:0 auto 16px;line-height:1.5;">
            You are currently not logged in to Universiti Malaya SPeCTRUM. Please log in to your account, then click "Sync".
          </p>
          <div style="display:flex;justify-content:center;gap:10px;">
            <a href="https://spectrum.um.edu.my/login/index.php" target="_blank" class="btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;text-decoration:none;border-radius:6px;font-weight:600;font-size:12.5px;">
              Log In to SPeCTRUM ↗
            </a>
          </div>
        </div>
      `;
      if (announcementsListEl) announcementsListEl.innerHTML = notLoggedInMsg;
      if (assignmentsListEl) assignmentsListEl.innerHTML = notLoggedInMsg;
      if (attendanceListEl) attendanceListEl.innerHTML = notLoggedInMsg;
    }

    if (announcementsLoadingEl) announcementsLoadingEl.style.display = 'none';
    if (assignmentsLoadingEl) assignmentsLoadingEl.style.display = 'none';
    if (attendanceLoadingEl) attendanceLoadingEl.style.display = 'none';
    if (typeof hideActivitiesFetchProgress === 'function') {
      hideActivitiesFetchProgress(0);
    }
    updateSyncButtonSpinState(false, 'Sync');
  }

  let activitiesProgressHideTimer = null;

  function updateActivitiesFetchProgress(percent, currentText, countText, titleText) {
    if (activitiesProgressHideTimer) {
      clearTimeout(activitiesProgressHideTimer);
      activitiesProgressHideTimer = null;
    }

    const clamped = Math.min(100, Math.max(0, Math.round(percent)));

    // 1. Update Centered Cinematic Glassmorphism HUD Overlay (Option 3)
    const overlay = document.getElementById('sync-cinematic-overlay');
    if (overlay) {
      if (overlay.style.display !== 'flex') {
        overlay.style.display = 'flex';
        // Trigger reflow for smooth CSS opacity transition
        void overlay.offsetWidth;
      }
      overlay.classList.add('active');
      overlay.style.opacity = '1';

      const hudPercent = document.getElementById('sync-hud-percent');
      const hudBarFill = document.getElementById('sync-hud-bar-fill');
      const hudTitle = document.getElementById('sync-hud-title');
      const hudCurrent = document.getElementById('sync-hud-current');
      const hudSub = document.getElementById('sync-hud-sub');
      const hudSvg = document.getElementById('sync-hud-prism-svg');

      if (hudPercent) hudPercent.textContent = `${clamped}%`;
      if (hudBarFill) hudBarFill.style.width = `${clamped}%`;
      if (hudTitle && titleText) hudTitle.textContent = titleText;
      if (hudCurrent && currentText) hudCurrent.textContent = currentText;
      if (hudSub && countText) hudSub.textContent = countText;

      if (hudSvg) {
        hudSvg.classList.remove('stage-settled');
        hudSvg.classList.add('stage-fetching');
      }
    }

    // 2. Keep inline card IDs updated synchronously
    const cardIds = ['activities-progress-card', 'fulltab-activities-progress-card'];
    for (const cardId of cardIds) {
      const cardEl = document.getElementById(cardId);
      if (!cardEl) continue;

      cardEl.style.display = 'flex';
      cardEl.style.opacity = '1';

      const prefix = cardId.startsWith('fulltab') ? 'fulltab-activities' : 'activities';
      const percentEl = document.getElementById(`${prefix}-progress-percent`);
      const fillEl = document.getElementById(`${prefix}-progress-bar-fill`);
      const currentEl = document.getElementById(`${prefix}-loading-text`);
      const countEl = document.getElementById(`${prefix}-progress-count`);
      const titleEl = document.getElementById(`${prefix}-loading-title`);

      if (percentEl) percentEl.textContent = `${clamped}%`;
      if (fillEl) fillEl.style.width = `${clamped}%`;
      if (currentEl && currentText) currentEl.textContent = currentText;
      if (countEl && countText) countEl.textContent = countText;
      if (titleEl && titleText) titleEl.textContent = titleText;
    }

    // Activate brand logo fetch laser animation
    document.querySelectorAll('.brand-logo-container').forEach(c => c.classList.add('anim-fetching'));
    document.querySelectorAll('.header-brand-logo-svg').forEach(svg => {
      svg.classList.remove('stage-settled');
      svg.classList.add('stage-fetching');
    });
  }

  function hideActivitiesFetchProgress(delay = 1200) {
    if (activitiesProgressHideTimer) clearTimeout(activitiesProgressHideTimer);

    // Deactivate brand logo fetch animation (switch back to exact final settled state)
    document.querySelectorAll('.brand-logo-container').forEach(c => c.classList.remove('anim-fetching'));
    document.querySelectorAll('.header-brand-logo-svg').forEach(svg => {
      svg.classList.remove('stage-fetching');
      svg.classList.add('stage-settled');
    });

    const hudPercent = document.getElementById('sync-hud-percent');
    const hudBarFill = document.getElementById('sync-hud-bar-fill');
    const hudCurrent = document.getElementById('sync-hud-current');
    const hudSub = document.getElementById('sync-hud-sub');
    if (hudPercent) hudPercent.textContent = '100%';
    if (hudBarFill) hudBarFill.style.width = '100%';
    if (hudCurrent) hudCurrent.textContent = '✔ Sync complete! All activities updated.';
    if (hudSub) hudSub.textContent = 'Ready';

    const overlay = document.getElementById('sync-cinematic-overlay');

    if (delay <= 0) {
      if (overlay) {
        overlay.classList.remove('active');
        overlay.style.opacity = '0';
        overlay.style.display = 'none';
      }
      const cardIds = ['activities-progress-card', 'fulltab-activities-progress-card'];
      for (const cardId of cardIds) {
        const cardEl = document.getElementById(cardId);
        if (cardEl) {
          cardEl.style.display = 'none';
          cardEl.style.opacity = '0';
        }
      }
      return;
    }

    activitiesProgressHideTimer = setTimeout(() => {
      if (overlay) {
        overlay.classList.remove('active');
        overlay.style.opacity = '0';
        setTimeout(() => {
          if (overlay.style.opacity === '0') overlay.style.display = 'none';
        }, 320);
      }
      const cardIds = ['activities-progress-card', 'fulltab-activities-progress-card'];
      for (const cardId of cardIds) {
        const cardEl = document.getElementById(cardId);
        if (cardEl) {
          cardEl.style.opacity = '0';
          setTimeout(() => {
            if (cardEl.style.opacity === '0') cardEl.style.display = 'none';
          }, 300);
        }
      }
    }, delay);
  }

  async function refreshActivities(forceRefreshCourses = false, bypassOccModal = false) {
    const elapsed = Date.now() - syncStartTime;
    if (isSyncingActivities) {
      if (forceRefreshCourses || elapsed > 25000) {
        logDiag('Sync', `⚠️ Breaking stale sync lock (elapsed: ${Math.round(elapsed / 1000)}s, force: ${forceRefreshCourses}). Aborting previous requests and starting fresh.`);
        if (currentSyncAbortController) {
          try { currentSyncAbortController.abort('Stale sync preempted'); } catch (e) {}
        }
        isSyncingActivities = false;
      } else {
        logDiag('Sync', `⚠️ Sync already in progress (${Math.round(elapsed / 1000)}s elapsed), skipping duplicate concurrent call.`);
        return;
      }
    }
    isSyncingActivities = true;
    syncStartTime = Date.now();
    currentSyncAbortController = new AbortController();

    updateSyncButtonSpinState(true, 'Syncing...');

    updateActivitiesFetchProgress(
      8,
      'Connecting to SPeCTRUM & verifying session...',
      'Step 1 of 3: Verifying session',
      'SYNCING ACTIVITIES & ATTENDANCE'
    );

    logDiag('Sync', `▶ Starting activities sync (Force refresh courses: ${forceRefreshCourses}, Scope: "${courseScope}")`);

    try {
      // 0. Check cookies in Chrome if API available
      if (chrome.cookies) {
        try {
          const mCookie = await chrome.cookies.get({ url: 'https://spectrum.um.edu.my', name: 'MoodleSession' });
          if (mCookie) {
            logDiag('Auth:Cookie', `✔ Active MoodleSession found (prefix: ${mCookie.value.slice(0, 8)}..., Secure: ${mCookie.secure})`);
            setDiagBadge(diagBadgeSession, 'ok', 'Cookie: Active');
          } else {
            logDiag('Auth:Cookie', `⚠️ MoodleSession cookie NOT found in Chrome for spectrum.um.edu.my!`);
            setDiagBadge(diagBadgeSession, 'err', 'Cookie: Missing');
          }
        } catch (cErr) {
          logDiag('Auth:Cookie', `Cookie access note: ${cErr?.message || cErr}`);
        }
      }

      // 0. Always verify active SPeCTRUM session upfront
      try {
        logDiag('Auth:Ping', 'Pinging https://spectrum.um.edu.my/my/courses.php ...');
        const pingRes = await fetchWithTimeout('https://spectrum.um.edu.my/my/courses.php', { credentials: 'include' }, 10000);
        logDiag('Auth:Ping', `Ping status: HTTP ${pingRes.status} | Final URL: ${pingRes.url}`);
        if (!pingRes || pingRes.url.includes('/login/') || pingRes.url.includes('microsoftonline.com') || pingRes.status === 401 || pingRes.status === 403) {
          logDiag('Auth:Ping', `❌ Session expired or redirected to SSO: ${pingRes.url}`);
          setDiagBadge(diagBadgeSession, 'err', 'Session: SSO/Expired');
          updateActivitiesFetchProgress(100, '🔒 SPeCTRUM login required. Please sign in.', 'Session Required', 'LOGIN REQUIRED');
          hideActivitiesFetchProgress(1200);
          showNotLoggedInState();
          return;
        }
        setDiagBadge(diagBadgeSession, 'ok', 'Session: Connected');
        updateActivitiesFetchProgress(
          16,
          'Active session verified. Checking enrolled courses...',
          'Step 2 of 3: Enrolled courses'
        );
      } catch (pingErr) {
        logDiag('Auth:Ping', `❌ Ping failed (network/CORS error): ${pingErr?.message || pingErr}`);
        setDiagBadge(diagBadgeSession, 'err', 'Session: Error');
        updateActivitiesFetchProgress(100, '⚠️ SPeCTRUM session check: please log in', 'Session Required', 'SPeCTRUM PRO');
        hideActivitiesFetchProgress(1200);
        showNotLoggedInState();
        return;
      }

      // 1. If forced or coursesData does not contain valid real courses, auto-discover enrolled courses directly
      const isRealCourse = c => c && c.id && /^\d+$/.test(String(c.id));
      const hasRealCourses = Array.isArray(coursesData) && coursesData.length > 0 && coursesData.every(isRealCourse);

      if (forceRefreshCourses || !hasRealCourses) {
        updateActivitiesFetchProgress(
          20,
          'Discovering enrolled courses from SPeCTRUM...',
          'Step 2 of 3: Discovering courses'
        );
        logDiag('Courses', `Discovering enrolled courses from SPeCTRUM (force: ${forceRefreshCourses})...`);
        const fetchRes = await fetchEnrolledCoursesDirectly();
        if (!fetchRes.loggedIn) {
          logDiag('Courses', '❌ fetchEnrolledCoursesDirectly reported not logged in');
          hideActivitiesFetchProgress(0);
          showNotLoggedInState();
          return;
        }
        allCoursesDiscovered = (fetchRes.allCourses || fetchRes.courses || []).filter(isRealCourse);
        logDiag('Courses', `Total discovered enrolled courses: ${allCoursesDiscovered.length} (${allCoursesDiscovered.map(c => `[${c.id}] ${c.name}`).join('; ')})`);
        const filtered = filterCoursesByScope(
          filterCourses(allCoursesDiscovered, chkExcludeSystem ? chkExcludeSystem.checked : true),
          courseScope
        );
        logDiag('Courses', `Filtered for scope "${courseScope}": ${filtered.length} courses (${filtered.map(c => `[${c.id}] ${c.name}`).join('; ')})`);
        if (filtered.length > 0) {
          coursesData = filtered.map(c => createCourseTreeShell(c));
          renderCourseTreeShells();
          renderOccPreferencesTable();
          await chrome.storage.local.set({ cachedCoursesData: coursesData, cachedCoursesTime: Date.now() });
        }
      } else {
        logDiag('Courses', `Using existing ${coursesData.length} cached course shells.`);
      }

      if (!coursesData || coursesData.length === 0) {
        logDiag('Courses', '⚠️ 0 courses found after scope filtering.');
        setDiagBadge(diagBadgeCourses, 'warn', 'Courses: 0');
        hideActivitiesFetchProgress(0);
        if (announcementsListEl) announcementsListEl.innerHTML = '<p class="settings-desc" style="text-align:center;padding:24px;">No enrolled courses found for this semester.</p>';
        if (assignmentsListEl) assignmentsListEl.innerHTML = '<p class="settings-desc" style="text-align:center;padding:24px;">No enrolled courses found.</p>';
        if (attendanceListEl) attendanceListEl.innerHTML = '<p class="settings-desc" style="text-align:center;padding:24px;">No enrolled courses found.</p>';
        return;
      }

      // 2. Validate course-specific OCC setup for all discovered courses
      const unconfiguredCourse = coursesData.find(c => !courseOccs || !courseOccs[c.id]);
      if (!bypassOccModal && unconfiguredCourse) {
        logDiag('Sync:OCC', `Course-specific OCC not configured for [${unconfiguredCourse.code || unconfiguredCourse.id}]. Opening mandatory setup modal.`);
        hideActivitiesFetchProgress(0);
        updateSyncButtonSpinState(false, 'Sync');
        isSyncingActivities = false;
        await openOccSetupModal(true);
        return;
      }

      // 2. Fetch all activities across courses within active date window
      const allAnnouncements = [];
      const allAssignments = [];
      const allAttendances = [];

      // Calculate minCutoffTimestamp (max 1 month window!)
      const minCutoffTimestamp = dateRangeStart 
        ? new Date(dateRangeStart + 'T00:00:00').getTime() 
        : (Date.now() - 31 * 24 * 3600 * 1000);

      const coursesToScan = filterCoursesByScope(coursesData, courseScope);
      const totalCourses = coursesToScan.length;
      logDiag('Courses:ToScan', `Courses queued to scan (${totalCourses}): ` + coursesToScan.map(c => `[${c.id}] ${c.code || c.name}`).join(', '));
      setDiagBadge(diagBadgeCourses, 'ok', `Courses: ${totalCourses}`);

      updateActivitiesFetchProgress(
        26,
        `Courses queued (${totalCourses}). Scanning activities & attendance...`,
        `0 of ${totalCourses} courses`,
        'SYNCING ACTIVITIES & ATTENDANCE'
      );

      const hasCourse129 = coursesToScan.some(c => String(c.id) === '129');
      logDiag('Courses:Check', `Target Course 129 in scan list? ${hasCourse129 ? '✔ YES' : '❌ NO'}`);

      // Fetch in small batches of 2 courses to prevent SPeCTRUM concurrency drops & 429 errors
      const batchSize = 2;
      for (let i = 0; i < coursesToScan.length; i += batchSize) {
        const batch = coursesToScan.slice(i, i + batchSize);
        const batchNames = batch.map(c => c.code || c.name).join(', ');
        const doneCount = Math.min(i + batch.length, coursesToScan.length);
        const batchProgressStr = `${doneCount}/${coursesToScan.length}`;
        const batchPercent = 26 + Math.round((doneCount / coursesToScan.length) * 65);

        logDiag('Sync:Batch', `Scanning batch [${batchProgressStr}]...`);
        updateActivitiesFetchProgress(
          batchPercent,
          `Scanning notices, tasks & attendance: [${batchNames}]...`,
          `Course ${batchProgressStr}`
        );
        if (announcementsLoadingEl) announcementsLoadingEl.textContent = `Syncing notices: [${batchNames}] (${batchProgressStr})...`;
        if (assignmentsLoadingEl) assignmentsLoadingEl.textContent = `Syncing tasks: [${batchNames}] (${batchProgressStr})...`;
        if (attendanceLoadingEl) attendanceLoadingEl.textContent = `Syncing attendance: [${batchNames}] (${batchProgressStr})...`;
        await Promise.all(batch.map(async (course) => {
          const courseId = String(course.id);
          const userOcc = courseOccs[courseId] || defaultOcc || '';

          // Use Promise.allSettled so an error in attendance or announcements NEVER drops assignments!
          const results = await Promise.allSettled([
            fetchCourseAnnouncements(courseId, course.code, course.name, minCutoffTimestamp),
            fetchCourseAssignments(courseId, course.code, course.name, 0),
            fetchCourseAttendance(courseId, course.code, course.name, userOcc, 0)
          ]);

          const [annRes, assignRes, attRes] = results;

          if (annRes.status === 'fulfilled' && annRes.value && Array.isArray(annRes.value)) {
            allAnnouncements.push(...annRes.value);
          }
          if (assignRes.status === 'fulfilled' && assignRes.value && Array.isArray(assignRes.value)) {
            allAssignments.push(...assignRes.value);
          }
          if (attRes.status === 'fulfilled' && attRes.value) {
            if (Array.isArray(attRes.value)) allAttendances.push(...attRes.value);
            else allAttendances.push(attRes.value);
          } else if (attRes.status === 'rejected') {
            logDiag('Attendance:Err', `Course ${courseId} attendance rejected: ${attRes.reason?.message || attRes.reason}`);
          }
        }));
      }

      // Non-destructive update: Only overwrite if fresh data was successfully retrieved
      if (allAnnouncements.length > 0) {
        announcementsData = allAnnouncements.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }
      if (allAssignments.length > 0) {
        assignmentsData = sanitizeAssignments(allAssignments);
      }
      if (allAttendances.length > 0) {
        attendancesData = sanitizeAttendances(allAttendances);
      }

      logDiag('Sync:Summary', `Sync finished. Total notices: ${allAnnouncements.length}, tasks: ${allAssignments.length}, attendance activities: ${allAttendances.length}`);
      setDiagBadge(diagBadgeAtt, allAttendances.length > 0 ? 'ok' : 'warn', `Attendance: ${allAttendances.length}`);
      if (allAttendances.length === 0) {
        logDiag('Attendance:Warn', '⚠️ No accessible attendance activities with sessions found across scanned courses.');
      }

      updateActivitiesFetchProgress(
        95,
        `Processing ${allAnnouncements.length} notices, ${allAssignments.length} tasks, ${allAttendances.length} attendance activities...`,
        'Finalizing'
      );

      renderAllActivities();
      if (isFullTab) {
        setFullTabMode(currentFullTabMode);
      } else {
        if (currentActivitiesMode === 'calendar') {
          renderCalendarView(calCurrentYear, calCurrentMonth);
        } else {
          renderTimelineVisualizer();
        }
      }
      updateKpiCards();
      debounceSaveCache();

      if (activitiesCacheBadge) {
        activitiesCacheBadge.textContent = '⚡ Updated Live';
        activitiesCacheBadge.style.display = 'inline-flex';
      }

      if (statusIndicator) {
        statusIndicator.className = 'status-indicator ready';
        statusIndicator.innerHTML = '<span class="dot"></span> <span id="status-text">Connected</span>';
      }

      updateActivitiesFetchProgress(
        100,
        `Synced: ${allAnnouncements.length} notices, ${allAssignments.length} tasks, ${allAttendances.length} attendance activities.`,
        'Done'
      );
      hideActivitiesFetchProgress(1200);

    } catch (err) {
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        logDiag('Sync', `Sync operation was aborted: ${err?.message || err}`);
      } else {
        logDiag('Sync:Crash', `Sync encountered an unhandled error: ${err?.message || err}`, err?.stack);
        console.log('[SPeCTRUM Pro] Activities sync note:', err?.message || err);
      }
    } finally {
      isSyncingActivities = false;
      syncStartTime = 0;
      currentSyncAbortController = null;
      updateSyncButtonSpinState(false, 'Sync');
      if (announcementsLoadingEl) announcementsLoadingEl.style.display = 'none';
      if (assignmentsLoadingEl) assignmentsLoadingEl.style.display = 'none';
      if (attendanceLoadingEl) attendanceLoadingEl.style.display = 'none';
      hideActivitiesFetchProgress(1200);
    }
  }

  if (btnRefreshActivities) {
    btnRefreshActivities.addEventListener('click', (e) => {
      if (isScanningMaterials) {
        if (btnRefreshActivitiesLabel) {
          const orig = btnRefreshActivitiesLabel.textContent;
          btnRefreshActivitiesLabel.textContent = 'Wait...';
          setTimeout(() => { if (btnRefreshActivitiesLabel) btnRefreshActivitiesLabel.textContent = orig; }, 2000);
        }
        return;
      }
      const forceRefresh = Boolean(e && (e.shiftKey || e.altKey));
      refreshActivities(forceRefresh);
    });
  }

  if (statusIndicator) {
    statusIndicator.style.cursor = 'pointer';
    statusIndicator.setAttribute('title', 'Click to synchronize activities & attendance');
    statusIndicator.addEventListener('click', () => {
      refreshActivities(false);
    });
  }

  // Update KPI Cards and Badges
  function updateKpiCards() {
    const annCount = announcementsData.length;
    const pendingCount = assignmentsData.filter(a => !a.isSubmitted).length;
    const overdueCount = assignmentsData.filter(a => a.isOverdue).length;
    const visibleAtt = attendancesData.filter(a => !isAttendanceHidden(a));
    const activeAttCount = visibleAtt.filter(a => a.activeSession != null).length;
    const upcomingSessionsCount = visibleAtt.reduce((acc, a) => acc + (a.sessions ? a.sessions.filter(s => s.isFuture).length : 0), 0);

    if (kpiAnnouncementsCount) kpiAnnouncementsCount.textContent = annCount;
    if (kpiPendingCount) kpiPendingCount.textContent = pendingCount;
    if (kpiOverdueCount) kpiOverdueCount.textContent = overdueCount;
    if (kpiOverdueCard) {
      kpiOverdueCard.classList.toggle('has-overdue', overdueCount > 0);
    }

    if (kpiActiveAttCount) {
      const lbl = kpiActiveAttCard ? kpiActiveAttCard.querySelector('.kpi-lbl') : null;
      if (activeAttCount > 0) {
        kpiActiveAttCount.textContent = activeAttCount;
        if (lbl) lbl.textContent = 'Open Now';
      } else if (upcomingSessionsCount > 0) {
        kpiActiveAttCount.textContent = upcomingSessionsCount;
        if (lbl) lbl.textContent = 'Upcoming Classes';
      } else {
        kpiActiveAttCount.textContent = visibleAtt.length;
        if (lbl) lbl.textContent = 'Tracked Courses';
      }
    }

    if (countSubAnn) countSubAnn.textContent = annCount;
    if (countSubAssign) countSubAssign.textContent = assignmentsData.length;
    if (countSubAtt) {
      countSubAtt.textContent = activeAttCount > 0 
        ? `${activeAttCount} Open` 
        : (upcomingSessionsCount > 0 ? `${upcomingSessionsCount}` : visibleAtt.length);
    }

    if (btnAutoTakeAttendance) {
      if (activeAttCount > 0) {
        btnAutoTakeAttendance.classList.add('glowing');
      } else {
        btnAutoTakeAttendance.classList.remove('glowing');
      }
    }

    if (badgeActivitiesCount) {
      const urgentTotal = overdueCount + activeAttCount;
      if (urgentTotal > 0) {
        badgeActivitiesCount.textContent = urgentTotal;
        badgeActivitiesCount.style.display = 'inline-flex';
      } else {
        badgeActivitiesCount.style.display = 'none';
      }
    }

    // Keep sidebar rail badge counts in sync
    if (typeof syncRailCounts === 'function') syncRailCounts();
  }

  // Parse live attendance form directly from SPeCTRUM
  // Parse live attendance form directly from SPeCTRUM
  async function parseAttendanceFormDetails(takeUrl) {
    logDiag('Attendance:Submit', `[Form] Fetching live form from: ${takeUrl}`);
    const res = await fetchWithTimeout(takeUrl, { credentials: 'include' }, 12000);
    logDiag('Attendance:Submit', `[Form] HTTP ${res.status}, final URL: ${res.url}`);

    if (!res.ok) throw new Error(`HTTP ${res.status} when fetching attendance form.`);
    const html = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Genuine login check:
    // Only flag loginRequired if final URL is explicitly login/index.php, OR if page has login inputs and NO attendance elements!
    const isLoginUrl = res.url.includes('/login/index.php') || res.url.includes('microsoftonline.com');
    const hasLoginInputs = doc.querySelector('#page-login-index, form#login, input#username') != null;
    const hasAttendanceElements = doc.querySelector('form[action*="attendance.php"], form.mform, input[name="status"], input[name="sessid"]') != null;

    if (isLoginUrl || (hasLoginInputs && !hasAttendanceElements)) {
      logDiag('Attendance:Submit', `[Form] 🔒 User is NOT logged in. Redirected to: ${res.url}`);
      return { loginRequired: true };
    }

    let form = doc.querySelector('form[action*="attendance.php"], form[action*="take.php"], form.mform');
    if (!form || !form.querySelector('input[name="status"]')) {
      const statusForm = Array.from(doc.querySelectorAll('form')).find(f => f.querySelector('input[name="status"]'));
      if (statusForm) form = statusForm;
    }

    if (!form || !doc.querySelector('input[name="status"]')) {
      // Check if page has a link to submit attendance (e.g. if takeUrl was view.php)
      const nestedTake = doc.querySelector('a[href*="attendance.php?sessid="], a[href*="take.php?sessid="], a.takeattendance');
      if (nestedTake) {
        let nestedUrl = nestedTake.getAttribute('href') || nestedTake.href;
        if (nestedUrl.startsWith('/')) nestedUrl = `https://spectrum.um.edu.my${nestedUrl}`;
        logDiag('Attendance:Submit', `[Form] Following nested take attendance link: ${nestedUrl}`);
        return parseAttendanceFormDetails(nestedUrl);
      }
      logDiag('Attendance:Submit', `[Form] ⚠️ No attendance form found in HTML. Title: "${doc.title}"`);
      return { formNotFound: true, html };
    }

    let formAction = form.getAttribute('action') || takeUrl;
    if (formAction.startsWith('/')) formAction = `https://spectrum.um.edu.my${formAction}`;
    else if (!formAction.startsWith('http')) formAction = `https://spectrum.um.edu.my/mod/attendance/${formAction}`;

    const hasPasswordInput = form.querySelector('input[type="password"], input[name="studentpassword"], input[name="password"], input[name="qrpass"]') != null;

    // Extract all hidden inputs (including _qf__..., sessid, sesskey, mform_..., instance, etc.)
    const fields = {};
    form.querySelectorAll('input[type="hidden"]').forEach(inp => {
      if (inp.name && inp.value !== undefined) {
        fields[inp.name] = inp.value;
      }
    });

    // Ensure _qf__ token is present if not already matched
    if (!Object.keys(fields).some(k => k.startsWith('_qf__'))) {
      fields['_qf__mod_attendance_student_attendance_form'] = '1';
    }

    // Find radio option for "Present" / "Hadir"
    const radios = Array.from(form.querySelectorAll('input[type="radio"][name="status"]'));
    let presentValue = '';

    for (const r of radios) {
      let labelText = '';
      if (r.id) {
        const lbl = form.querySelector(`label[for="${r.id}"]`) || doc.querySelector(`label[for="${r.id}"]`);
        if (lbl) labelText += ' ' + (lbl.textContent || lbl.innerText || '');
      }
      const container = r.closest('.form-check, .fitem, tr, td, div');
      if (container) labelText += ' ' + (container.textContent || container.innerText || '');

      if (/present|hadir|\b[PH]\b/i.test(labelText)) {
        presentValue = r.value;
        break;
      }
    }

    if (!presentValue && radios.length > 0) {
      // Standard Moodle attendance always orders Present as the first status radio
      presentValue = radios[0].value;
    }

    fields['status'] = presentValue;
    fields['mform_isexpanded_id_general'] = '1';
    fields['submitbutton'] = 'Save changes';

    logDiag('Attendance:Submit', `[Form] Parsed successfully: action="${formAction}", status="${presentValue}", fields count=${Object.keys(fields).length}, PIN needed=${hasPasswordInput}`);

    return {
      formAction,
      fields,
      hasPasswordInput,
      presentValue,
      sessid: fields['sessid'] || (takeUrl.match(/sessid=(\d+)/) || [])[1] || ''
    };
  }

  // Helper: Populate Course dropdown for Attendance Filter Deck
  function populateAttendanceCourseFilterOptions() {
    if (!selAttFilterCourse) return;
    const currentVal = selAttFilterCourse.value || currentAttCourseFilter || 'all';

    const courses = [];
    const seenCids = new Set();

    (coursesData || []).forEach(c => {
      const cid = String(c.id);
      if (cid && !seenCids.has(cid)) {
        seenCids.add(cid);
        courses.push({ id: cid, code: c.code || '', name: c.name || '' });
      }
    });

    (attendancesData || []).forEach(a => {
      const cid = String(a.courseId);
      if (cid && !seenCids.has(cid)) {
        seenCids.add(cid);
        courses.push({ id: cid, code: a.courseCode || '', name: a.courseName || '' });
      }
    });

    courses.sort((a, b) => (a.code || '').localeCompare(b.code || ''));

    let optionsHtml = '<option value="all">All Enrolled Courses</option>';
    courses.forEach(c => {
      const cleanName = cleanDisplayCourseName(c.name, c.code);
      const label = c.code ? `[${escapeHtml(c.code)}]${cleanName ? ` ${escapeHtml(cleanName)}` : ''}` : escapeHtml(cleanName || c.name || `Course ${c.id}`);
      optionsHtml += `<option value="${escapeHtml(c.id)}">${label}</option>`;
    });

    selAttFilterCourse.innerHTML = optionsHtml;
    if (seenCids.has(currentVal)) {
      selAttFilterCourse.value = currentVal;
    } else {
      selAttFilterCourse.value = 'all';
      currentAttCourseFilter = 'all';
    }
  }

  // Fast Real-Time Live Session Probe on SPeCTRUM
  async function probeCourseAttendanceLive(courseId, attUrl, userOcc) {
    const startTime = performance.now();
    const origin = SPECTRUM_ORIGIN;
    const targetUrl = attUrl || `${origin}/mod/attendance/index.php?id=${courseId}`;
    logDiag('Attendance:Probe', `▶ [CID: ${courseId}] Probing live SPeCTRUM page: ${targetUrl}`);

    try {
      const res = await fetchWithTimeout(targetUrl, { credentials: 'include' }, 10000);
      const fetchElapsed = Math.round(performance.now() - startTime);
      logDiag('Attendance:Probe', `[CID: ${courseId}] Live fetch HTTP ${res.status} in ${fetchElapsed}ms (Final URL: ${res.url})`);

      if (!res.ok || res.url.includes('/login/') || res.url.includes('microsoftonline.com')) {
        logDiag('Attendance:Probe', `[CID: ${courseId}] 🔒 User is NOT logged in or session expired. Redirected to: ${res.url}`);
        return { loginRequired: true };
      }

      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<base href="${origin}/mod/attendance/">${html}`, 'text/html');

      // 1. Check if an active "Submit attendance" / "Hantar Kehadiran" / take.php link exists right now
      const takeMatch = html.match(/href=["']([^"']*(?:attendance\.php\?sessid=\d+|take\.php\?sessid=\d+|\bsessid=\d+)[^"']*)["'][^>]*>([^<]*)/i);
      let takeEl = doc.querySelector('a[href*="attendance.php?sessid="], a[href*="take.php?sessid="], a[href*="sessid="], a.takeattendance');
      if (!takeEl) {
        takeEl = Array.from(doc.querySelectorAll('a')).find(a => /submit attendance|hantar kehadiran|rekod kehadiran|take attendance/i.test(a.textContent || ''));
      }

      // 2. Also inspect the attendance sessions table to check if student was already marked Present for today
      const todayStr = formatDateKey(new Date());
      let alreadyPresent = false;
      const rows = doc.querySelectorAll('table.userattendance tr, table.generaltable tr, table tr');
      for (const r of rows) {
        const txt = (r.textContent || '').trim();
        if (txt.includes(todayStr) || /today/i.test(txt)) {
          if (/present|hadir|2\s*\/\s*2|100%/i.test(txt)) {
            alreadyPresent = true;
            logDiag('Attendance:Probe', `[CID: ${courseId}] Live session table confirms already marked Present for today (${todayStr})`);
            break;
          }
        }
      }

      let rawTakeUrl = takeMatch ? takeMatch[1].replace(/&amp;/g, '&') : (takeEl ? (takeEl.getAttribute('href') || takeEl.href || '').replace(/&amp;/g, '&') : '');
      let fullTakeUrl = '';
      if (rawTakeUrl) {
        if (rawTakeUrl.startsWith('/')) fullTakeUrl = `${origin}${rawTakeUrl}`;
        else if (rawTakeUrl.startsWith('http')) fullTakeUrl = rawTakeUrl;
        else fullTakeUrl = `${origin}/mod/attendance/${rawTakeUrl}`;
      }

      const totalElapsed = Math.round(performance.now() - startTime);
      logDiag('Attendance:Probe', `[CID: ${courseId}] Probe result in ${totalElapsed}ms: activeSession=${Boolean(fullTakeUrl)}, alreadyPresent=${alreadyPresent}, takeUrl="${fullTakeUrl}"`);

      return {
        hasActiveSession: Boolean(fullTakeUrl),
        takeUrl: fullTakeUrl,
        alreadyPresent,
        html
      };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startTime);
      logDiag('Attendance:Probe', `❌ [CID: ${courseId}] Probe exception in ${elapsed}ms: ${err?.message || err}`);
      return { error: err?.message || String(err) };
    }
  }

  // Targeted Single-Course Attendance Sync (Instant Performance: ~400ms instead of 30s!)
  async function syncSingleCourseAttendance(courseId, options = {}) {
    const startTime = performance.now();
    const cId = String(courseId);
    const knownCourse = (coursesData || []).find(c => String(c.id) === cId) || {};
    const existingAtt = (attendancesData || []).find(a => String(a.courseId) === cId);
    const courseCode = options.courseCode || knownCourse.code || existingAtt?.courseCode || 'Course';
    const courseName = options.courseName || knownCourse.name || existingAtt?.courseName || '';
    const userOcc = options.userOcc || courseOccs[cId] || defaultOcc || '';
    const dateFilter = options.dateFilter || currentAttDateFilter || 'all';
    const customDate = options.customDate || currentAttCustomDate || '';
    const timeFilter = options.timeFilter || currentAttStatusFilter || 'all';

    logDiag('Attendance:SingleSync', `▶ [${courseCode}] Targeted single-course sync initiated. CID: ${cId}, Filters: { date: "${dateFilter}", customDate: "${customDate}", status: "${timeFilter}", userOcc: "${userOcc}" }`);

    try {
      const freshAtt = await fetchCourseAttendance(cId, courseCode, courseName, userOcc, 0);
      const elapsed = Math.round(performance.now() - startTime);

      if (freshAtt) {
        const freshItems = Array.isArray(freshAtt) ? freshAtt : [freshAtt];

        // Replace old records for this course with fresh records
        const otherCoursesAtt = attendancesData.filter(a => String(a.courseId) !== cId);
        attendancesData = sanitizeAttendances([...otherCoursesAtt, ...freshItems]);

        await chrome.storage.local.set({
          cachedAttendances: attendancesData,
          cachedAttendancesTime: Date.now()
        });

        renderAttendanceList();
        renderTimelineVisualizer();
        updateKpiCards();

        const totalSessions = freshItems.reduce((acc, a) => acc + (a.sessions?.length || 0), 0);
        const activeCount = freshItems.filter(a => a.activeSession != null).length;
        const statsStr = freshItems.map(a => a.pastStats ? `${a.pastStats.percentage}%` : null).filter(Boolean).join(', ');

        logDiag('Attendance:SingleSync', `✅ [${courseCode}] Targeted sync complete in ${elapsed}ms! Sessions: ${totalSessions}, Active now: ${activeCount}, Stats: [${statsStr || 'None'}]`);
        logDiag('Attendance:Perf', `⚡ Single course sync for [${courseCode}] finished in ${elapsed}ms. (Processed 1 course instead of ${coursesData.length || 'all'}).`);

        return { success: true, elapsed, items: freshItems };
      } else {
        logDiag('Attendance:SingleSync', `⚠️ [${courseCode}] Targeted sync returned 0 attendance items in ${elapsed}ms.`);
        return { success: false, elapsed, error: 'No attendance activities found or accessible' };
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - startTime);
      logDiag('Attendance:SingleSync', `❌ [${courseCode}] Error in targeted sync (${elapsed}ms): ${err?.message || err}`);
      return { success: false, elapsed, error: err?.message || String(err) };
    }
  }

  // Fast Attendance-Only Rescan Across All Courses (Skip Notices & Assignments)
  async function syncAllCoursesAttendanceFast() {
    const startTime = performance.now();
    const coursesToScan = filterCoursesByScope(coursesData, courseScope);
    logDiag('Attendance:FastScan', `▶ Starting attendance-only fast rescan across ${coursesToScan.length} courses...`);

    const allFresh = [];
    const batchSize = 3;

    for (let i = 0; i < coursesToScan.length; i += batchSize) {
      const batch = coursesToScan.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(async (course) => {
        const courseId = String(course.id);
        const userOcc = courseOccs[courseId] || defaultOcc || '';
        return fetchCourseAttendance(courseId, course.code, course.name, userOcc, 0);
      }));

      results.forEach(res => {
        if (res.status === 'fulfilled' && res.value) {
          if (Array.isArray(res.value)) allFresh.push(...res.value);
          else allFresh.push(res.value);
        }
      });
    }

    if (allFresh.length > 0) {
      attendancesData = sanitizeAttendances(allFresh);
      await chrome.storage.local.set({ cachedAttendances: attendancesData, cachedAttendancesTime: Date.now() });
      renderAttendanceList();
      renderTimelineVisualizer();
      updateKpiCards();
    }

    const elapsed = Math.round(performance.now() - startTime);
    logDiag('Attendance:FastScan', `✅ Fast attendance scan finished in ${elapsed}ms. Total items: ${allFresh.length}`);
  }

  // Direct 1-Click Attendance Take Handler (No website navigation required!)
  async function handleDirectAttendanceTake(btn) {
    if (!btn || btn.disabled) return;
    const startTime = performance.now();
    const attId = btn.dataset.attId;
    const cardId = btn.dataset.cardId;
    const courseId = btn.dataset.courseId;
    const courseCode = btn.dataset.courseCode || 'Course';
    const courseName = btn.dataset.courseName || '';
    const attUrl = btn.dataset.attUrl;
    const subType = btn.dataset.subType;

    logDiag('Attendance:Take', `▶ [${courseCode}] Real-time 1-click take triggered by user on card "${cardId || attId}"`);

    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="width:11px;height:11px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Checking...`;

    try {
      let att = findAttendanceForButton(btn);

      // 1. If att already has activeSession from cache
      if (att && att.activeSession) {
        logDiag('Attendance:Take', `[${courseCode}] Using existing activeSession (takeUrl: ${att.activeSession.takeUrl})`);
        if (att.activeSession.requiresPassword) {
          btn.innerHTML = origHtml;
          btn.disabled = false;
          openPinModal(att);
          return;
        }
        btn.innerHTML = `<span class="spinner" style="width:11px;height:11px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Submitting...`;
        const ok = await submitCourseAttendance(att, '', btn);
        if (ok) {
          btn.innerHTML = '✔ Present';
          btn.style.background = 'var(--signal-attendance)';
          btn.style.color = '#fff';
        } else {
          btn.innerHTML = origHtml;
          btn.disabled = false;
        }
        return;
      }

      // 2. Real-time live probe on SPeCTRUM for this course
      const userOcc = att?.userOcc || courseOccs[courseId] || defaultOcc || '';
      const probeRes = await probeCourseAttendanceLive(courseId, attUrl, userOcc);

      if (probeRes.loginRequired) {
        btn.innerHTML = origHtml;
        btn.disabled = false;
        alert('SPeCTRUM session expired. Please log in to SPeCTRUM first.');
        chrome.tabs.create({ url: 'https://spectrum.um.edu.my/login/index.php' });
        return;
      }

      if (probeRes.alreadyPresent) {
        const elapsed = Math.round(performance.now() - startTime);
        logDiag('Attendance:Take', `[${courseCode}] Live page confirms student is ALREADY RECORDED as Present! (${elapsed}ms)`);
        btn.innerHTML = '✔ Present';
        btn.style.background = 'var(--signal-attendance)';
        btn.style.color = '#fff';
        if (att) {
          att.lastRecordedStatus = 'Present';
          att.activeSession = null;
        }
        debounceSaveCache();
        renderAttendanceList();
        // Quick auto-sync in background to pull latest official percentages
        syncSingleCourseAttendance(courseId, { courseCode, courseName });
        return;
      }

      if (probeRes.hasActiveSession && probeRes.takeUrl) {
        logDiag('Attendance:Take', `[${courseCode}] Active attendance session discovered! Parsing form fields...`);
        const parsed = await parseAttendanceFormDetails(probeRes.takeUrl);

        const targetAtt = att || {
          id: attId || `att_${courseId}`,
          courseId,
          courseCode,
          courseName,
          subType: subType || '',
          attUrl: probeRes.takeUrl
        };

        targetAtt.activeSession = {
          takeUrl: probeRes.takeUrl,
          sesskey: parsed.fields ? parsed.fields['sesskey'] : '',
          presentStatusId: parsed.presentValue || '',
          desc: 'Class Session',
          time: 'Active now',
          requiresPassword: parsed.hasPasswordInput
        };

        if (parsed.hasPasswordInput) {
          logDiag('Attendance:Take', `[${courseCode}] Session requires PIN. Opening PIN modal.`);
          btn.innerHTML = origHtml;
          btn.disabled = false;
          openPinModal(targetAtt);
          return;
        }

        // No password needed: Submit attendance immediately!
        btn.innerHTML = `<span class="spinner" style="width:11px;height:11px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Submitting...`;
        const ok = await submitCourseAttendance(targetAtt, '', btn);
        if (ok) {
          btn.innerHTML = '✔ Present';
          btn.style.background = 'var(--signal-attendance)';
          btn.style.color = '#fff';
        } else {
          btn.innerHTML = origHtml;
          btn.disabled = false;
        }
        return;
      }

      // 3. No active session open right now on SPeCTRUM
      const elapsed = Math.round(performance.now() - startTime);
      logDiag('Attendance:Take', `[${courseCode}] Probed live SPeCTRUM page in ${elapsed}ms: No active attendance session open yet.`);
      btn.innerHTML = '⏳ Not Open Yet';
      btn.style.background = 'var(--bg-subtle)';
      btn.style.color = 'var(--text-muted)';
      setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.style.background = '';
        btn.style.color = '';
        btn.disabled = false;
      }, 2800);

      alert(`ℹ️ No active attendance session is open for ${courseCode} on SPeCTRUM right now.\n\nIf class has started, your lecturer may unlock it shortly. You can also click 'SPeCTRUM ↗' to view the attendance page directly.`);

    } catch (err) {
      logDiag('Attendance:Take', `❌ Error in handleDirectAttendanceTake: ${err?.message || err}`);
      btn.innerHTML = origHtml;
      btn.disabled = false;
      alert(`Error checking attendance: ${err.message}`);
    }
  }

  // Wire up Attendance Filter Deck event listeners
  if (selAttFilterCourse) {
    selAttFilterCourse.addEventListener('change', () => {
      currentAttCourseFilter = selAttFilterCourse.value;
      logDiag('Attendance:Filter', `Course filter changed to: "${currentAttCourseFilter}"`);
      if (btnSyncFilteredAttText) {
        if (currentAttCourseFilter !== 'all') {
          const opt = selAttFilterCourse.options[selAttFilterCourse.selectedIndex];
          const codeMatch = opt ? opt.textContent.match(/\[([^\]]+)\]/) : null;
          const courseCode = codeMatch ? codeMatch[1] : (opt?.textContent?.slice(0, 8) || 'Course');
          btnSyncFilteredAttText.textContent = `Sync ${courseCode}`;
        } else {
          btnSyncFilteredAttText.textContent = 'Sync Course';
        }
      }
      renderAttendanceList();
    });
  }

  if (selAttFilterDate) {
    selAttFilterDate.addEventListener('change', () => {
      currentAttDateFilter = selAttFilterDate.value;
      if (inputAttFilterDatePicker) {
        inputAttFilterDatePicker.style.display = (currentAttDateFilter === 'custom') ? 'inline-block' : 'none';
        if (currentAttDateFilter === 'custom' && !inputAttFilterDatePicker.value) {
          inputAttFilterDatePicker.value = formatDateKey(new Date());
          currentAttCustomDate = inputAttFilterDatePicker.value;
        }
      }
      logDiag('Attendance:Filter', `Date filter changed to: "${currentAttDateFilter}" (custom: "${currentAttCustomDate}")`);
      renderAttendanceList();
    });
  }

  if (inputAttFilterDatePicker) {
    inputAttFilterDatePicker.addEventListener('change', () => {
      currentAttCustomDate = inputAttFilterDatePicker.value;
      logDiag('Attendance:Filter', `Custom date picker changed to: "${currentAttCustomDate}"`);
      renderAttendanceList();
    });
  }

  if (selAttFilterStatus) {
    selAttFilterStatus.addEventListener('change', () => {
      currentAttStatusFilter = selAttFilterStatus.value;
      logDiag('Attendance:Filter', `Status/Time filter changed to: "${currentAttStatusFilter}"`);
      renderAttendanceList();
    });
  }

  if (btnSyncFilteredAtt) {
    btnSyncFilteredAtt.addEventListener('click', async () => {
      const targetCid = currentAttCourseFilter !== 'all' ? currentAttCourseFilter : null;
      btnSyncFilteredAtt.disabled = true;
      updateSyncButtonSpinState(true, 'Syncing...');
      const origText = btnSyncFilteredAttText ? btnSyncFilteredAttText.textContent : 'Sync Course';
      if (btnSyncFilteredAttText) btnSyncFilteredAttText.textContent = 'Syncing...';

      const targetCourse = (coursesData || []).find(c => String(c.id) === String(targetCid));
      const targetLabel = targetCourse ? (targetCourse.code || targetCourse.name) : (targetCid || 'Courses');

      updateActivitiesFetchProgress(
        25,
        targetCid ? `Connecting to SPeCTRUM for [${targetLabel}]...` : 'Scanning attendance across courses...',
        'Attendance Sync',
        'SYNCING ATTENDANCE'
      );

      try {
        if (targetCid) {
          logDiag('Attendance:ManualSync', `User initiated targeted single course sync for CID ${targetCid}`);
          updateActivitiesFetchProgress(65, `Fetching sessions & statistics for [${targetLabel}]...`, 'Processing');
          const res = await syncSingleCourseAttendance(targetCid, {
            dateFilter: currentAttDateFilter,
            customDate: currentAttCustomDate
          });
          if (res.success) {
            updateActivitiesFetchProgress(100, `✔ [${targetLabel}] Attendance synchronized!`, 'Complete', 'SYNCING ATTENDANCE');
            if (btnSyncFilteredAttText) btnSyncFilteredAttText.textContent = '✔ Synced!';
          } else {
            updateActivitiesFetchProgress(100, '⚠️ Attendance sync note: check diagnostics', 'Ready', 'SYNCING ATTENDANCE');
            if (btnSyncFilteredAttText) btnSyncFilteredAttText.textContent = '⚠️ Check Log';
          }
        } else {
          logDiag('Attendance:ManualSync', `User initiated fast attendance rescan across all courses...`);
          updateActivitiesFetchProgress(65, 'Rescanning all enrolled course attendance items...', 'Scanning');
          await syncAllCoursesAttendanceFast();
          updateActivitiesFetchProgress(100, '✔ All courses attendance synchronized!', 'Complete', 'SYNCING ATTENDANCE');
          if (btnSyncFilteredAttText) btnSyncFilteredAttText.textContent = '✔ Synced All!';
        }
      } catch (err) {
        logDiag('Attendance:ManualSync', `Sync error: ${err?.message || err}`);
        if (btnSyncFilteredAttText) btnSyncFilteredAttText.textContent = '❌ Error';
      } finally {
        hideActivitiesFetchProgress(1200);
        setTimeout(() => {
          btnSyncFilteredAtt.disabled = false;
          updateSyncButtonSpinState(false, origText);
          if (btnSyncFilteredAttText) btnSyncFilteredAttText.textContent = origText;
        }, 1200);
      }
    });
  }

  // Update Live Auto-Attendance Daemon Status in Attendance Sub-Tab & Full-Tab Header
  async function updateAttendanceDaemonStatus() {
    const dots = [document.getElementById('att-daemon-dot'), document.getElementById('fulltab-daemon-dot')].filter(Boolean);
    const labels = [document.getElementById('att-daemon-label'), document.getElementById('fulltab-daemon-label')].filter(Boolean);
    const times = [document.getElementById('att-daemon-time'), document.getElementById('fulltab-daemon-time')].filter(Boolean);
    const btns = [document.getElementById('btn-quick-auto-take'), document.getElementById('btn-fulltab-quick-auto-take')].filter(Boolean);
    const btnTexts = [document.getElementById('btn-quick-auto-take-text'), document.getElementById('btn-fulltab-quick-auto-take-text')].filter(Boolean);

    if (dots.length === 0 && labels.length === 0) return;

    try {
      const stored = await chrome.storage.local.get({
        autoAttendanceEnabled: true,
        autoAttendanceInterval: 15,
        lastAttendanceCheckTime: 0
      });

      const isEnabled = stored.autoAttendanceEnabled !== false;
      const interval = stored.autoAttendanceInterval || 15;
      const lastCheck = stored.lastAttendanceCheckTime || 0;

      if (!isEnabled) {
        dots.forEach(d => d.className = d.id.includes('fulltab') ? 'fulltab-daemon-dot disabled' : 'att-daemon-dot disabled');
        labels.forEach(l => l.textContent = 'Auto-Attendance: DISABLED');
        times.forEach(t => t.textContent = '· Off in Preferences');
      } else {
        dots.forEach(d => d.className = d.id.includes('fulltab') ? 'fulltab-daemon-dot' : 'att-daemon-dot');
        labels.forEach(l => l.textContent = `Auto-Attendance: ACTIVE (${interval}m)`);
        times.forEach(t => {
          if (lastCheck > 0) {
            t.textContent = `· Checked ${formatTimeAgo(lastCheck)}`;
          } else {
            t.textContent = '· Scheduled';
          }
        });
      }

      // Check if there are active open sessions right now
      const openSessions = (attendancesData || []).filter(a => a.activeSession != null);
      btns.forEach(btn => {
        if (openSessions.length > 0) {
          btn.classList.add('has-open');
        } else {
          btn.classList.remove('has-open');
        }
      });
      btnTexts.forEach(btnText => {
        if (openSessions.length > 0) {
          btnText.textContent = `⚡ Auto-Take (${openSessions.length} Open)`;
        } else {
          btnText.textContent = 'Auto-Take Now';
        }
      });
    } catch (e) {}
  }

  // Shared Quick Auto-Take Action for both Popup and Full-Tab Header
  async function executeQuickAutoTake(triggerBtn) {
    const btns = [document.getElementById('btn-quick-auto-take'), document.getElementById('btn-fulltab-quick-auto-take')].filter(Boolean);
    const btnTexts = [document.getElementById('btn-quick-auto-take-text'), document.getElementById('btn-fulltab-quick-auto-take-text')].filter(Boolean);
    const openSessions = (attendancesData || []).filter(a => a.activeSession != null);

    btns.forEach(b => b.disabled = true);
    btnTexts.forEach(t => t.textContent = 'Checking...');

    try {
      if (openSessions.length > 0) {
        let submitted = 0;
        for (const att of openSessions) {
          if (att.activeSession.requiresPassword) {
            openPinModal(att);
            break;
          } else {
            const ok = await submitCourseAttendance(att, '', triggerBtn);
            if (ok) submitted++;
          }
        }
        btnTexts.forEach(t => {
          t.textContent = submitted > 0 ? `✔ Submitted (${submitted})!` : 'Auto-Take Now';
        });
      } else {
        // Trigger background service worker to check all enrolled courses in real time
        btnTexts.forEach(t => t.textContent = 'Scanning...');
        const bgRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'CHECK_ATTENDANCE_NOW' }, (res) => {
            resolve(res || {});
          });
        });

        // Sync cache and re-render
        const cached = await chrome.storage.local.get(['cachedAttendances', 'lastAttendanceCheckTime']);
        if (cached.cachedAttendances) {
          attendancesData = sanitizeAttendances(cached.cachedAttendances);
          renderAttendanceList();
          renderTimelineVisualizer();
          updateKpiCards();
        }

        btnTexts.forEach(t => {
          if (bgRes && bgRes.results && bgRes.results.newlySubmitted > 0) {
            t.textContent = `✔ Marked (${bgRes.results.newlySubmitted})!`;
          } else {
            t.textContent = '✔ Up to Date';
          }
        });
      }
    } catch (err) {
      btnTexts.forEach(t => t.textContent = '❌ Failed');
    } finally {
      setTimeout(() => {
        btns.forEach(b => b.disabled = false);
        updateAttendanceDaemonStatus();
      }, 2200);
    }
  }

  // Attach listeners to both buttons
  const btnQuickAutoTake = document.getElementById('btn-quick-auto-take');
  if (btnQuickAutoTake) {
    btnQuickAutoTake.addEventListener('click', () => executeQuickAutoTake(btnQuickAutoTake));
  }
  const btnFulltabQuickAutoTake = document.getElementById('btn-fulltab-quick-auto-take');
  if (btnFulltabQuickAutoTake) {
    btnFulltabQuickAutoTake.addEventListener('click', () => executeQuickAutoTake(btnFulltabQuickAutoTake));
  }

  // Submit Attendance Action
  async function submitCourseAttendance(att, password = '', triggerBtn = null) {
    if (!att || !att.activeSession) {
      logDiag('Attendance:Submit', '⚠️ No active session found on course attendance item.');
      return false;
    }

    try {
      const session = att.activeSession;
      let takeUrl = session.takeUrl;
      logDiag('Attendance:Submit', `▶ Submitting attendance for ${att.courseCode || att.courseName} (takeUrl: ${takeUrl})`);

      if (!takeUrl) {
        logDiag('Attendance:Submit', '❌ Missing takeUrl.');
        return false;
      }

      // 1. Parse live form directly from SPeCTRUM
      const parsed = await parseAttendanceFormDetails(takeUrl);

      if (parsed.loginRequired) {
        logDiag('Attendance:Submit', '🔒 Login required: SPeCTRUM session appears expired or redirected to login/index.php.');
        alert('SPeCTRUM session expired. Please log in to SPeCTRUM first.');
        chrome.tabs.create({ url: 'https://spectrum.um.edu.my/login/index.php' });
        return false;
      }

      if (parsed.formNotFound) {
        logDiag('Attendance:Submit', '⚠️ Form not found on attendance page.');
        const openDirect = confirm('⚠️ Attendance form was not detected automatically on the page.\n\nWould you like to open the attendance page directly in a tab?');
        if (openDirect) {
          chrome.tabs.create({ url: takeUrl });
        }
        return false;
      }

      if (parsed.hasPasswordInput && !password) {
        logDiag('Attendance:Submit', '🔑 PIN required by lecturer. Prompting PIN modal.');
        openPinModal(att);
        return false;
      }

      const postFields = { ...parsed.fields };
      if (password) {
        postFields['password'] = password;
        logDiag('Attendance:Submit', '🔑 Appended attendance PIN/password to form payload.');
      }

      logDiag('Attendance:Submit', `Dispatching SUBMIT_ATTENDANCE_FORM to background worker...`);

      // 2. Submit via background service worker (bypasses popup CORS redirect constraints)
      let submitRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'SUBMIT_ATTENDANCE_FORM',
          formAction: parsed.formAction,
          fields: postFields,
          takeUrl: takeUrl
        }, (res) => {
          if (chrome.runtime.lastError) {
            logDiag('Attendance:Submit', `Background message error: ${chrome.runtime.lastError.message}`);
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false });
          }
        });
      });

      logDiag('Attendance:Submit', `Background response:`, submitRes);

      // Fallback: If background message failed, try submitAttendanceDirect
      if (!submitRes || !submitRes.success) {
        logDiag('Attendance:Submit', `Trying direct popup fetch fallback...`);
        const directOk = await submitAttendanceDirect(parsed.formAction || takeUrl, parsed.presentValue, parsed.fields['sesskey'], password);
        if (directOk) submitRes = { success: true };
      }

      if (submitRes && submitRes.success) {
        logDiag('Attendance:Submit', `✅ Attendance successfully recorded as Present!`);
        alert(`✅ Attendance recorded for ${att.courseCode || att.courseName}! (Present)`);
        att.activeSession = null;
        att.lastRecordedStatus = 'Present';
        renderAttendanceList();
        renderTimelineVisualizer();
        updateKpiCards();
        debounceSaveCache();

        // Immediate Auto-Sync for this class to verify live confirmation from SPeCTRUM & update past stats
        if (att.courseId) {
          logDiag('Attendance:AutoSync', `[${att.courseCode || att.courseName}] Auto-syncing live result from SPeCTRUM...`);
          syncSingleCourseAttendance(att.courseId, { courseCode: att.courseCode, courseName: att.courseName }).then(res => {
            if (res && res.success) {
              logDiag('Attendance:AutoSync', `[${att.courseCode || att.courseName}] ✅ Auto-sync confirmed: server status verified Present!`);
            }
          });
        }

        return true;
      } else {
        const errorMsg = submitRes?.error || 'Direct submission did not complete.';
        logDiag('Attendance:Submit', `❌ Attendance submission unsuccessful: ${errorMsg}`);
        const openDirect = confirm(`⚠️ ${errorMsg}\n\nWould you like to open the attendance page in SPeCTRUM now?`);
        if (openDirect && (takeUrl || att.attUrl)) {
          chrome.tabs.create({ url: takeUrl || att.attUrl });
        }
        return false;
      }
    } catch (err) {
      logDiag('Attendance:Crash', `Exception in submitCourseAttendance: ${err?.message || err}`, err?.stack);
      alert(`Error submitting attendance: ${err.message}`);
      return false;
    }
  }

  // Auto-Take All Open Attendances
  if (btnAutoTakeAttendance) {
    btnAutoTakeAttendance.addEventListener('click', async () => {
      const openSessions = attendancesData.filter(a => a.activeSession != null);

      if (openSessions.length === 0) {
        alert('✨ No active attendance sessions open right now. SPeCTRUM Pro will auto-check periodically in the background.');
        return;
      }

      btnAutoTakeAttendance.disabled = true;
      btnAutoTakeAttendance.textContent = 'Checking & Submitting...';

      let submittedCount = 0;

      for (const att of openSessions) {
        if (att.activeSession.requiresPassword) {
          openPinModal(att);
          break;
        } else {
          const success = await submitCourseAttendance(att, '');
          if (success) submittedCount++;
        }
      }

      btnAutoTakeAttendance.disabled = false;
      btnAutoTakeAttendance.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <span>Auto-Take Active Attendance</span>
      `;
    });
  }

  // PIN Modal Logic
  function openPinModal(att) {
    activePinSession = att;
    if (pinModalTitle) pinModalTitle.textContent = `PIN Required: ${att.courseCode || att.courseName}`;
    if (pinModalDesc) pinModalDesc.textContent = `The session "${att.activeSession.desc || 'Lecture'}" requires an attendance password / PIN provided by your lecturer.`;
    if (attPinInput) {
      attPinInput.value = '';
      setTimeout(() => attPinInput.focus(), 150);
    }
    if (pinModalError) pinModalError.style.display = 'none';
    if (pinModal) pinModal.style.display = 'flex';
  }

  if (btnSubmitPin) {
    btnSubmitPin.addEventListener('click', async () => {
      const pin = attPinInput ? attPinInput.value.trim() : '';
      if (!pin) {
        if (pinModalError) {
          pinModalError.textContent = 'Please enter the attendance PIN / password.';
          pinModalError.style.display = 'block';
        }
        return;
      }

      btnSubmitPin.textContent = 'Submitting...';
      btnSubmitPin.disabled = true;

      const success = await submitCourseAttendance(activePinSession, pin);
      btnSubmitPin.textContent = 'Submit Attendance';
      btnSubmitPin.disabled = false;

      if (success) {
        if (pinModal) pinModal.style.display = 'none';
      } else {
        if (pinModalError) {
          pinModalError.textContent = 'Failed to submit. Check if the PIN is correct or try on SPeCTRUM.';
          pinModalError.style.display = 'block';
        }
      }
    });
  }

  if (btnCancelPin && pinModal) btnCancelPin.addEventListener('click', () => { pinModal.style.display = 'none'; });
  if (btnClosePinModal && pinModal) btnClosePinModal.addEventListener('click', () => { pinModal.style.display = 'none'; });

  // Mandatory / Fast OCC Setup Modal Logic
  let hasSkippedOccSetup = false;

  async function openOccSetupModal(isMandatory = true) {
    if (!occSetupModal) return;

    // Strict no-close button enforcement: NEVER show close button if mandatory or if courses lack OCCs
    const knownCourses = getKnownCoursesList();
    const hasConfiguredAllOccs = knownCourses.length > 0 && knownCourses.every(c => courseOccs && courseOccs[c.id]);
    if (btnCloseOccModal) {
      btnCloseOccModal.style.display = (!isMandatory && hasConfiguredAllOccs) ? 'block' : 'none';
    }

    if (occModalError) occModalError.style.display = 'none';
    occSetupModal.style.display = 'flex';

    const modalCourseList = document.getElementById('occ-modal-course-list');
    if (!modalCourseList) return;

    let coursesList = getKnownCoursesList();
    if (coursesList.length === 0) {
      modalCourseList.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;padding:24px 0;gap:8px;color:var(--text-muted);font-size:11.5px;">
          <div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>
          <span>Discovering your enrolled courses from SPeCTRUM...</span>
        </div>
      `;

      try {
        const fetchRes = await fetchEnrolledCoursesDirectly();
        if (fetchRes && fetchRes.courses) {
          allCoursesDiscovered = fetchRes.allCourses || fetchRes.courses;
          const filtered = filterCoursesByScope(
            filterCourses(allCoursesDiscovered, chkExcludeSystem ? chkExcludeSystem.checked : true),
            courseScope
          );
          if (filtered.length > 0) {
            coursesData = filtered.map(c => createCourseTreeShell(c));
          }
          coursesList = getKnownCoursesList();
        }
      } catch (err) {
        logDiag('OCC:Modal', 'Course fetch note: ' + (err?.message || err));
      }
    }

    if (coursesList.length === 0) {
      modalCourseList.innerHTML = `
        <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:11.5px;">
          No active semester courses detected. Please ensure you are logged into <a href="https://spectrum.um.edu.my" target="_blank" style="color:var(--accent);">spectrum.um.edu.my</a>.
        </div>
      `;
      return;
    }

    modalCourseList.innerHTML = coursesList.map(c => `
      <div class="occ-modal-course-row" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);padding:6px 10px;border-radius:6px;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:11.5px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.title)}">
            ${escapeHtml(c.code)}
          </div>
          <div style="font-size:10.5px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.title)}">
            ${escapeHtml(c.title)}
          </div>
        </div>
        <div class="occ-input-wrap" style="width:84px;flex-shrink:0;">
          <span class="occ-prefix" style="font-size:10px;padding:0 4px;">OCC</span>
          <input type="number" min="1" max="50" class="occ-modal-course-inp" data-course-id="${c.id}" value="${escapeHtml(courseOccs[c.id] || '')}" placeholder="e.g. 4" style="font-size:12px;font-weight:700;text-align:center;padding:4px 6px;">
        </div>
      </div>
    `).join('');
  }

  function closeOccSetupModal() {
    const knownCourses = getKnownCoursesList();
    const hasConfiguredAllOccs = knownCourses.length > 0 && knownCourses.every(c => courseOccs && courseOccs[c.id]);
    if (!hasConfiguredAllOccs && (!courseOccs || Object.keys(courseOccs).length === 0)) {
      // Mandatory: Cannot close until OCCs are set!
      return;
    }
    if (occSetupModal) occSetupModal.style.display = 'none';
  }

  if (quickOccPills) {
    quickOccPills.querySelectorAll('.btn-occ-quick').forEach(btn => {
      btn.addEventListener('click', () => {
        const occVal = btn.dataset.occ;
        quickOccPills.querySelectorAll('.btn-occ-quick').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');

        // Fill all course inputs at once
        const inputs = document.querySelectorAll('.occ-modal-course-inp');
        inputs.forEach(inp => {
          inp.value = occVal;
          inp.style.borderColor = '';
        });
        if (occModalError) occModalError.style.display = 'none';
      });
    });
  }

  if (btnSaveOccModal) {
    btnSaveOccModal.addEventListener('click', async () => {
      const inputs = document.querySelectorAll('.occ-modal-course-inp');
      if (inputs.length === 0) {
        if (occModalError) {
          occModalError.textContent = 'No courses found. Please ensure you are logged into SPeCTRUM.';
          occModalError.style.display = 'block';
        }
        return;
      }

      let hasEmpty = false;
      const newCourseOccs = {};
      inputs.forEach(inp => {
        const cid = inp.dataset.courseId;
        const v = inp.value.trim();
        const num = parseInt(v, 10);
        if (!v || isNaN(num) || num <= 0 || num > 50) {
          hasEmpty = true;
          inp.style.borderColor = 'var(--danger)';
        } else {
          inp.style.borderColor = '';
          newCourseOccs[cid] = String(num);
        }
      });

      if (hasEmpty) {
        if (occModalError) {
          occModalError.textContent = 'Mandatory: Please enter your specific OCC number (1-50) for every enrolled course.';
          occModalError.style.display = 'block';
        }
        const firstEmpty = Array.from(inputs).find(i => !i.value.trim());
        if (firstEmpty) firstEmpty.focus();
        return;
      }

      courseOccs = newCourseOccs;
      const occValues = Object.values(courseOccs);
      defaultOcc = occValues[0] || '1';
      if (defaultOccInput) defaultOccInput.value = defaultOcc;

      // Synchronize all attendance records
      attendancesData.forEach(a => {
        a.userOcc = courseOccs[a.courseId] || defaultOcc || '';
      });

      await chrome.storage.local.set({
        defaultOcc: defaultOcc,
        courseOccs: courseOccs,
        cachedAttendances: attendancesData
      });

      logDiag('OCC:Setup', `✔ Saved course-specific OCCs for all ${Object.keys(courseOccs).length} course(s). Starting fast sync...`);

      if (occSetupModal) occSetupModal.style.display = 'none';
      renderOccPreferencesTable();
      refreshActivities(false, true);
    });
  }

  if (btnCloseOccModal) {
    btnCloseOccModal.addEventListener('click', () => {
      closeOccSetupModal();
    });
  }

  // Announcement Reader Modal (with Multi-Selector, Auto-Fallback & Universal Delegation)
  function findAnnouncementById(targetId, cardEl) {
    if (!targetId && !cardEl) return null;
    const cleanId = String(targetId || '').trim();

    // 1. Direct match on id or discussionId
    let found = announcementsData.find(a => a && (String(a.id) === cleanId || String(a.discussionId) === cleanId));
    if (found) return found;

    // 2. Fuzzy subpart match
    if (cleanId) {
      found = announcementsData.find(a => {
        if (!a) return false;
        const aid = String(a.id || '');
        const did = String(a.discussionId || '');
        return aid.endsWith(`_${cleanId}`) || cleanId.endsWith(`_${aid}`) ||
               aid.includes(cleanId) || cleanId.includes(aid) ||
               (did && cleanId.includes(did));
      });
      if (found) return found;
    }

    // 3. Fallback synthesis from DOM card attributes & text content
    if (cardEl) {
      const cardTitle = cardEl.querySelector('.card-bold-title')?.innerText?.trim() || '';
      const cardCourse = cardEl.querySelector('.card-course-code')?.innerText?.trim() || '';
      const cardCourseName = cardEl.querySelector('.card-course-name')?.innerText?.trim() || '';
      const cardAuthor = cardEl.querySelector('.card-meta-author')?.innerText?.replace(/^[^\w\s]+/, '').trim() || '';
      const cardPreview = cardEl.querySelector('.card-text-preview')?.innerText?.trim() || '';
      const cardDate = cardEl.querySelector('.wireframe-pill')?.innerText?.trim() || '';
      const storedId = cardEl.dataset.annId || cleanId;

      if (cardTitle) {
        found = announcementsData.find(a => a && a.title === cardTitle && (!cardCourse || a.courseCode === cardCourse));
        if (found) return found;
      }

      return {
        id: storedId || `ann_fallback_${Date.now()}`,
        title: cardTitle || 'Announcement',
        courseCode: cardCourse || 'NOTICE',
        courseName: cardCourseName || '',
        author: cardAuthor || 'Lecturer',
        dateStr: cardDate || '',
        preview: cardPreview || '',
        discussUrl: (storedId && storedId.match(/\d+/)) ? `https://spectrum.um.edu.my/mod/forum/discuss.php?d=${storedId.match(/\d+/)[0]}` : ''
      };
    }

    return null;
  }

  function handleOpenAnnouncement(targetId, cardEl) {
    const ann = findAnnouncementById(targetId, cardEl);
    if (ann) {
      openAnnouncementModal(ann);
    } else {
      console.warn('[SPeCTRUM Pro] Could not find announcement for ID:', targetId, cardEl);
    }
  }

  // Universal Delegated Click Handler for Announcements across ALL viewports & surfaces
  document.addEventListener('click', (e) => {
    // 1. Direct click on "Open Full" or agenda read button
    const openBtn = e.target.closest('.btn-open-notice, .btn-read-agenda-ann');
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      const card = openBtn.closest('.announcement-card');
      const annId = openBtn.dataset.annId || (card ? card.dataset.annId : null);
      handleOpenAnnouncement(annId, card);
      return;
    }

    // 2. Click anywhere on an announcement card body (ignoring interactive elements like links or inputs)
    const card = e.target.closest('.announcement-card');
    if (card) {
      if (e.target.closest('a, button, input, select, textarea, .btn-card-delete')) {
        return;
      }
      e.preventDefault();
      const annId = card.dataset.annId;
      handleOpenAnnouncement(annId, card);
    }
  });

  async function openAnnouncementModal(ann) {
    if (!annModal) return;
    if (modalAnnCourseBadge) modalAnnCourseBadge.textContent = ann.courseCode || ann.courseName || 'NOTICE';
    if (modalAnnDate) modalAnnDate.textContent = ann.dateStr || '';
    if (modalAnnTitle) modalAnnTitle.textContent = ann.title || 'Announcement';
    if (modalAnnAuthor) modalAnnAuthor.textContent = ann.author || 'Lecturer';

    // Auto-resolve discussUrl if missing
    if (!ann.discussUrl) {
      if (ann.discussionId) {
        ann.discussUrl = `https://spectrum.um.edu.my/mod/forum/discuss.php?d=${ann.discussionId}`;
      } else if (ann.id) {
        const dMatch = String(ann.id).match(/_(\d+)$/);
        if (dMatch) {
          ann.discussUrl = `https://spectrum.um.edu.my/mod/forum/discuss.php?d=${dMatch[1]}`;
        }
      }
    }

    if (modalAnnLink) {
      if (ann.discussUrl) {
        modalAnnLink.href = ann.discussUrl;
        modalAnnLink.style.display = 'inline-flex';
      } else {
        modalAnnLink.style.display = 'none';
      }
    }

    // If already cached, display immediately
    if (ann.contentHtml && modalAnnContent) {
      modalAnnContent.innerHTML = ann.contentHtml;
      annModal.style.display = 'flex';
      return;
    }

    // Animated loading spinner + immediate preview
    if (modalAnnContent) {
      modalAnnContent.innerHTML = `
        ${ann.preview ? `
          <div style="margin-bottom:14px;padding:12px;background:var(--bg-subtle);border:1px solid var(--border-hairline);border-radius:var(--radius-xs);font-size:12px;line-height:1.55;color:var(--text-secondary);">
            ${escapeHtml(ann.preview)}
          </div>
        ` : ''}
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px 16px;gap:10px;color:var(--text-secondary);">
          <div class="spinner" style="width:22px;height:22px;border-width:2.5px;"></div>
          <p style="font-size:11.5px;color:var(--text-muted);">Loading full announcement from SPeCTRUM...</p>
        </div>
      `;
    }
    annModal.style.display = 'flex';

    if (!ann.discussUrl) {
      if (modalAnnContent) {
        modalAnnContent.innerHTML = ann.preview ? `
          <div style="padding:14px;background:var(--bg-subtle);border-radius:var(--radius-xs);font-size:12.5px;line-height:1.55;color:var(--text-primary);">
            ${escapeHtml(ann.preview)}
          </div>
        ` : `<p style="padding:16px;color:var(--text-muted);font-size:12px;">No direct discussion link available.</p>`;
      }
      return;
    }

    try {
      const res = await fetchWithTimeout(ann.discussUrl, { credentials: 'include' }, 12000);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const html = await res.text();
      const origin = 'https://spectrum.um.edu.my';

      if (res.url.includes('/login/') || html.includes('id="page-login-index"')) {
        if (modalAnnContent) {
          modalAnnContent.innerHTML = `
            <div style="padding:16px;background:rgba(239,68,68,0.1);border-radius:8px;border:1px solid rgba(239,68,68,0.25);font-size:12px;color:var(--text-secondary);text-align:center;">
              <p style="margin-bottom:8px;font-weight:600;color:var(--signal-urgent);">⚠️ SPeCTRUM Session Expired</p>
              <p style="margin-bottom:12px;">Please log in to your SPeCTRUM account to read this announcement.</p>
              <a href="https://spectrum.um.edu.my/login/index.php" target="_blank" class="btn-cta-solid" style="display:inline-block;padding:6px 14px;font-size:11.5px;text-decoration:none;">Log In to SPeCTRUM ↗</a>
            </div>
          `;
        }
        return;
      }

      const doc = new DOMParser().parseFromString(`<base href="${origin}/">${html}`, 'text/html');

      // Comprehensive multi-selector strategy for all Moodle 3.x / 4.x / Boost forum templates
      const candidateSelectors = [
        '.forumpost .posting',
        '.forumpost .post-content-container',
        '.forumpost [data-region="post-content"]',
        '.forumpost [data-region="post-content-container"]',
        '.forumpost [data-region="post-message"]',
        '.forumpost .text_to_html',
        '.forumpost .content',
        '.forumpost .maincontent',
        'article.forum-post-container .post-content-container',
        'article.forum-post-container .posting',
        'div[id^="post-content-"]',
        '.forumpost .fullpost',
        '.forumpost .body',
        '.forumpost',
        'article.forum-post-container',
        '[data-region="discussion-post"]'
      ];

      let extractedEl = null;
      for (const sel of candidateSelectors) {
        const found = doc.querySelector(sel);
        if (found && found.innerText && found.innerText.trim().length > 0) {
          extractedEl = found;
          break;
        }
      }

      let contentHtml = '';
      if (extractedEl) {
        const clone = extractedEl.cloneNode(true);
        // Clean out header buttons, avatar photos, reply links, action commands from post body
        clone.querySelectorAll('.header, .author, .userpicture, .post-actions, .commands, [data-region="post-actions"], a.btn, .dropdown, .reply, [data-region="author-name"]').forEach(el => el.remove());
        contentHtml = clone.innerHTML.trim();
      }

      // If still empty, check for generalbox or main region
      if (!contentHtml) {
        const generalBox = doc.querySelector('.box.generalbox, #region-main .content, #region-main');
        if (generalBox) {
          const clone = generalBox.cloneNode(true);
          clone.querySelectorAll('nav, header, h1, h2, h3, .breadcrumb, footer, .page-header-headings').forEach(el => el.remove());
          contentHtml = clone.innerHTML.trim();
        }
      }

      if (contentHtml) {
        // Rewrite relative URLs to absolute so images and links work inside extension
        contentHtml = contentHtml
          .replace(/src="\/?(pluginfile\.php|theme\/)/gi, `src="${origin}/$1`)
          .replace(/href="\/?(pluginfile\.php|mod\/)/gi, `href="${origin}/$1`);

        // Check for attached images/files
        const attachmentsEl = doc.querySelector('.forumpost .attachments, .forumpost .attachedimages');
        if (attachmentsEl && !contentHtml.includes('attachments')) {
          const attClone = attachmentsEl.cloneNode(true);
          attClone.querySelectorAll('a').forEach(a => {
            const rawHref = a.getAttribute('href');
            if (rawHref && !rawHref.startsWith('http')) {
              a.href = `${origin}/${rawHref.replace(/^\//, '')}`;
            }
          });
          contentHtml += `<div class="ann-attachments" style="margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);">${attClone.innerHTML}</div>`;
        }

        ann.contentHtml = contentHtml;
        if (modalAnnContent) modalAnnContent.innerHTML = contentHtml;
        debounceSaveCache();
      } else {
        if (modalAnnContent) {
          modalAnnContent.innerHTML = `
            <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">
              <p style="margin-bottom:12px;">The announcement text could not be loaded into this preview window.</p>
              <a href="${escapeHtml(ann.discussUrl)}" target="_blank" class="btn-cta-solid" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;font-size:11.5px;text-decoration:none;border-radius:6px;font-weight:600;">
                Read Full Notice on SPeCTRUM ↗
              </a>
            </div>
          `;
        }
      }

    } catch (err) {
      console.log('[SPeCTRUM Pro] Failed to load full announcement:', err);
      if (modalAnnContent) {
        modalAnnContent.innerHTML = `
          <div style="padding:16px;text-align:center;color:var(--text-secondary);font-size:12px;">
            <p style="color:var(--signal-urgent);font-weight:600;margin-bottom:6px;">⚠️ Could not connect to SPeCTRUM</p>
            <p style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">${escapeHtml(err?.message || 'Network timeout or session error')}</p>
            <a href="${escapeHtml(ann.discussUrl)}" target="_blank" class="btn-wireframe" style="display:inline-block;padding:6px 14px;font-size:11px;text-decoration:none;">Open in SPeCTRUM ↗</a>
          </div>
        `;
      }
    }
  }

  if (btnCloseAnnModal) btnCloseAnnModal.addEventListener('click', () => { annModal.style.display = 'none'; });
  if (btnDismissAnnModal) btnDismissAnnModal.addEventListener('click', () => { annModal.style.display = 'none'; });
  if (annModal) {
    annModal.addEventListener('click', (e) => {
      if (e.target === annModal) annModal.style.display = 'none';
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && annModal && annModal.style.display === 'flex') {
      annModal.style.display = 'none';
    }
  });

  // Activities Search Bar
  if (activitiesSearchInput) {
    activitiesSearchInput.addEventListener('input', () => {
      const val = activitiesSearchInput.value.trim();
      if (btnClearActivitiesSearch) btnClearActivitiesSearch.style.display = val ? 'block' : 'none';
      renderAllActivities();
    });

    if (btnClearActivitiesSearch) {
      btnClearActivitiesSearch.addEventListener('click', () => {
        activitiesSearchInput.value = '';
        btnClearActivitiesSearch.style.display = 'none';
        renderAllActivities();
      });
    }
  }

  // ========================================================
  // 11. TAB 2: Course Materials & Downloader Logic
  // ========================================================

  let courseProgressHideTimer = null;

  // Real-time Course Materials Fetch Progress Helper (Drives Centered Cinematic HUD Overlay & Inline card)
  function updateCourseFetchProgress(percent, currentText, countText, titleText) {
    if (courseProgressHideTimer) {
      clearTimeout(courseProgressHideTimer);
      courseProgressHideTimer = null;
    }

    const clamped = Math.min(100, Math.max(0, Math.round(percent)));

    // 1. Update Centered Cinematic Glassmorphic Sync HUD Overlay (Option 3)
    const overlay = document.getElementById('sync-cinematic-overlay');
    if (overlay) {
      if (overlay.style.display !== 'flex') {
        overlay.style.display = 'flex';
        void overlay.offsetWidth;
      }
      overlay.classList.add('active');
      overlay.style.opacity = '1';

      const hudPercent = document.getElementById('sync-hud-percent');
      const hudBarFill = document.getElementById('sync-hud-bar-fill');
      const hudTitle = document.getElementById('sync-hud-title');
      const hudCurrent = document.getElementById('sync-hud-current');
      const hudSub = document.getElementById('sync-hud-sub');
      const hudSvg = document.getElementById('sync-hud-prism-svg');

      if (hudPercent) hudPercent.textContent = `${clamped}%`;
      if (hudBarFill) hudBarFill.style.width = `${clamped}%`;
      if (hudTitle && titleText) hudTitle.textContent = titleText;
      if (hudCurrent && currentText) hudCurrent.textContent = currentText;
      if (hudSub && countText) hudSub.textContent = countText;

      if (hudSvg) {
        hudSvg.classList.remove('stage-settled');
        hudSvg.classList.add('stage-fetching');
      }
    }

    // 2. Keep inline card in Materials tab updated
    if (courseLoadingEl) {
      courseLoadingEl.style.display = 'flex';
      courseLoadingEl.style.opacity = '1';

      const percentEl = document.getElementById('course-progress-percent');
      const fillEl = document.getElementById('course-progress-bar-fill');
      const currentEl = document.getElementById('course-loading-text');
      const countEl = document.getElementById('course-progress-count');
      const titleEl = document.getElementById('course-loading-title');

      if (percentEl) percentEl.textContent = `${clamped}%`;
      if (fillEl) fillEl.style.width = `${clamped}%`;
      if (currentEl && currentText) currentEl.textContent = currentText;
      if (countEl && countText) countEl.textContent = countText;
      if (titleEl && titleText) titleEl.textContent = titleText;
    }

    // Activate brand logo fetch laser animation
    document.querySelectorAll('.brand-logo-container').forEach(c => c.classList.add('anim-fetching'));
    document.querySelectorAll('.header-brand-logo-svg').forEach(svg => {
      svg.classList.remove('stage-settled');
      svg.classList.add('stage-fetching');
    });
  }

  function hideCourseFetchProgress(delay = 1200) {
    if (courseProgressHideTimer) clearTimeout(courseProgressHideTimer);

    // Deactivate brand logo fetch animation (switch back to exact final settled state)
    document.querySelectorAll('.brand-logo-container').forEach(c => c.classList.remove('anim-fetching'));
    document.querySelectorAll('.header-brand-logo-svg').forEach(svg => {
      svg.classList.remove('stage-fetching');
      svg.classList.add('stage-settled');
    });

    const hudPercent = document.getElementById('sync-hud-percent');
    const hudBarFill = document.getElementById('sync-hud-bar-fill');
    const hudCurrent = document.getElementById('sync-hud-current');
    const hudSub = document.getElementById('sync-hud-sub');
    if (hudPercent) hudPercent.textContent = '100%';
    if (hudBarFill) hudBarFill.style.width = '100%';
    if (hudCurrent) hudCurrent.textContent = '✔ Scan complete! Course materials up to date.';
    if (hudSub) hudSub.textContent = 'Done';

    const overlay = document.getElementById('sync-cinematic-overlay');

    if (delay <= 0) {
      if (overlay) {
        overlay.classList.remove('active');
        overlay.style.opacity = '0';
        overlay.style.display = 'none';
      }
      if (courseLoadingEl) {
        courseLoadingEl.style.display = 'none';
        courseLoadingEl.style.opacity = '0';
      }
      return;
    }

    courseProgressHideTimer = setTimeout(() => {
      if (overlay) {
        overlay.classList.remove('active');
        overlay.style.opacity = '0';
        setTimeout(() => {
          if (overlay.style.opacity === '0') overlay.style.display = 'none';
        }, 320);
      }
      if (courseLoadingEl) {
        courseLoadingEl.style.opacity = '0';
        setTimeout(() => {
          if (courseLoadingEl.style.opacity === '0') courseLoadingEl.style.display = 'none';
        }, 300);
      }
    }, delay);
  }

  async function scanCourses(tabToUse, isRescan = false) {
    if (isScanningMaterials) return;
    if (isSyncingActivities) {
      logDiag('Materials:Scan', 'Activities sync currently in progress, skipping concurrent materials scan.');
      return;
    }
    isScanningMaterials = true;

    if (notOnSpectrumEl) notOnSpectrumEl.style.display = 'none';
    if (btnDownloadZip) btnDownloadZip.disabled = true;

    if (btnRescan) {
      btnRescan.classList.add('spinning');
      btnRescan.disabled = true;
      if (btnRescanLabel) btnRescanLabel.textContent = 'Scanning...';
    }

    updateCourseFetchProgress(
      8,
      'Connecting to SPeCTRUM & discovering enrolled courses...',
      'Step 1 of 2: Discovering courses',
      isRescan ? 'RESCANNING SPeCTRUM COURSES' : 'FETCHING COURSES & MATERIALS'
    );

    try {
      let rawCourses = [];

      // Try direct extension fetch first
      const fetchRes = await fetchEnrolledCoursesDirectly();
      if (fetchRes && fetchRes.courses && fetchRes.courses.length > 0) {
        rawCourses = fetchRes.courses;
      } else if (tabToUse && tabToUse.id) {
        rawCourses = await executeInTab(tabToUse.id, extractCoursesFromPage).catch(() => []);
      }

      const filtered = filterCourses(rawCourses, chkExcludeSystem ? chkExcludeSystem.checked : true);

      if (!filtered || filtered.length === 0) {
        if (courseLoadingEl) courseLoadingEl.style.display = 'none';
        if (courseTreeEl) courseTreeEl.innerHTML = '<p class="settings-desc" style="text-align:center;padding:24px;">No enrolled courses found. Ensure you are logged in to SPeCTRUM.</p>';
        return;
      }

      const totalCourses = filtered.length;
      updateCourseFetchProgress(
        16,
        `Discovered ${totalCourses} enrolled courses. Fetching materials for each course...`,
        `0 of ${totalCourses} courses`
      );

      coursesData = filtered.map(c => {
        const codeMatch = c.name.match(/^[A-Z]{3}\d{4}(\/[A-Z]{3}\d{4})?/);
        const code = codeMatch ? codeMatch[0] : `Course ${c.id}`;
        const cleanTitle = codeMatch ? c.name.replace(codeMatch[0], '').trim() : c.name;
        return {
          id: String(c.id),
          name: c.name,
          code: code,
          title: cleanTitle || c.name,
          url: c.url,
          sections: [],
          announcements: [],
          checked: true,
          expanded: false,
          loaded: false
        };
      });

      renderCourseTreeShells();
      renderOccPreferencesTable();

      const currentPrefs = await chrome.storage.local.get(defaultSettings);
      const allowedExts = currentPrefs.extensions || defaultSettings.extensions;
      const materialsOnly = chkMaterialsOnly ? chkMaterialsOnly.checked : true;

      let coursesDone = 0;
      let totalFilesFound = 0;

      // Scan all course materials in batches with live step-by-step progress feedback!
      const batchSize = 2;
      for (let i = 0; i < coursesData.length; i += batchSize) {
        const batch = coursesData.slice(i, i + batchSize);
        const batchCodes = batch.map(c => c.code || c.name).join(', ');

        const stepPct = 16 + Math.round((coursesDone / totalCourses) * 80);
        updateCourseFetchProgress(
          stepPct,
          `Fetching: [${batchCodes}] (Course ${coursesDone + 1} of ${totalCourses})...`,
          `${coursesDone} of ${totalCourses} courses · ${totalFilesFound} files found`
        );

        await Promise.all(batch.map(async (course) => {
          try {
            const rawMaterials = await fetchCourseMaterialsDirectly(course.id, allowedExts, materialsOnly);

            const sectionMap = new Map();
            (rawMaterials || []).forEach(mat => {
              const secName = cleanSectionTitle(mat.section);
              if (!sectionMap.has(secName)) sectionMap.set(secName, []);
              const currentSecFiles = sectionMap.get(secName);
              const fileIdx = currentSecFiles.length;
              const badge = detectFileBadge(mat);
              currentSecFiles.push({
                id: generateUniqueFileId(course.id, secName, fileIdx, mat.url, mat.title),
                title: mat.title,
                url: mat.url,
                type: mat.type,
                typeHint: mat.typeHint || '',
                badge: badge,
                checked: true
              });
            });

            course.sections = Array.from(sectionMap.entries()).map(([secName, files]) => ({
              name: secName,
              files: files,
              checked: true,
              expanded: false
            }));
            course.loaded = true;

            const courseFilesCount = (rawMaterials || []).length;
            totalFilesFound += courseFilesCount;

            populateCourseChildren(course);
          } catch (err) {
            console.log(`Scanning materials note for course ${course.id}:`, err?.message || err);
            course.loaded = true;
            course.sections = [];
            populateCourseChildren(course);
          }

          coursesDone++;
          const progressPct = 16 + Math.round((coursesDone / totalCourses) * 80);
          updateCourseFetchProgress(
            progressPct,
            `Scanned: [${course.code}] (${(course.sections || []).reduce((acc, s) => acc + (s.files?.length || 0), 0)} files found)`,
            `${coursesDone} of ${totalCourses} courses · ${totalFilesFound} files indexed`
          );
          updateAllCounts();
        }));
      }

      // Phase 3: Completion
      updateCourseFetchProgress(
        100,
        `✔ All ${totalCourses} courses & ${totalFilesFound} files successfully indexed!`,
        `${totalCourses} of ${totalCourses} completed`,
        'SCAN COMPLETE'
      );

      const finishTime = Date.now();
      await chrome.storage.local.set({
        cachedCoursesData: coursesData,
        cachedCoursesTime: finishTime
      });

      if (cacheTimeBadge) {
        cacheTimeBadge.textContent = '⚡ Cached (Just now)';
        cacheTimeBadge.style.display = 'inline-flex';
      }

      hideCourseFetchProgress(1200);

    } catch (err) {
      console.log('Courses extraction note:', err?.message || err);
      updateCourseFetchProgress(100, 'Scan completed with notices.', 'Done');
      hideCourseFetchProgress(1500);
    } finally {
      isScanningMaterials = false;
      if (btnRescan) {
        btnRescan.classList.remove('spinning');
        btnRescan.disabled = false;
        if (btnRescanLabel) btnRescanLabel.textContent = 'Rescan';
      }
      if (btnDownloadZip) btnDownloadZip.disabled = false;
    }
  }

  function filterCourses(courses, excludeSystem) {
    const systemIds = ['26925', '26842'];
    const systemKeywords = ['leap initiative', 'turnitin submission'];
    return (courses || []).filter(c => {
      const id = String(c.id || '').trim();
      const name = (c.name || '').trim();
      if (!id || id === '1' || !name || /view course/i.test(name)) return false;
      if (excludeSystem) {
        if (systemIds.includes(id)) return false;
        const lower = name.toLowerCase();
        if (systemKeywords.some(kw => lower.includes(kw))) return false;
      }
      return true;
    });
  }

  // Seed default academic courses matching mockup if cache is empty
  function getSeedCourses() {
    return [
      {
        id: 'c_wia2001',
        code: 'WIA2001 / WIB2001',
        title: 'DATABASE SYSTEMS & MODELING',
        dept: 'COMP',
        checked: true,
        expanded: false,
        loaded: true,
        sections: [
          {
            name: 'LECTURES (WEEK 01 - WEEK 07)',
            checked: true,
            expanded: false,
            files: [
              { id: 'f_wia2001_07', title: 'Lecture 07 - Normalization & BCNF Decomposition.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200107', sizeBytes: 4404019, sizeStr: '4.2 MB', uploadDate: '24 Oct 2024, 14:28:11 UTC', uploadDateShort: '24 Oct 2024', sha256: '4f9b882da12c01994ba77582c0316d8a2b53f7c9e11a3...', isSynced: true, isNew: false, checked: true },
              { id: 'f_wia2001_06', title: 'Lecture 06 - Relational Algebra & SQL Query Optimization.pptx', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200106', sizeBytes: 13421772, sizeStr: '12.8 MB', uploadDate: '17 Oct 2024, 09:15:00 UTC', uploadDateShort: '17 Oct 2024', sha256: '7b8a91c44021ef34a8b792e403d15a990cf412ab34a1b...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2001_05', title: 'Lecture 05 - Enhanced Entity-Relationship (EER) Modeling.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200105', sizeBytes: 3984588, sizeStr: '3.8 MB', uploadDate: '10 Oct 2024, 11:30:20 UTC', uploadDateShort: '10 Oct 2024', sha256: '99a41c10d7ef5b89a441e8c04e22bf456da871b012c4d...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2001_04', title: 'Lecture 04 - Relational Integrity & Key Constraints.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200104', sizeBytes: 3040870, sizeStr: '2.9 MB', uploadDate: '03 Oct 2024, 15:45:00 UTC', uploadDateShort: '03 Oct 2024', sha256: '88bc34f9a01045dc893e1102b542ea407c9b0124fe55a...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2001_03', title: 'Lecture 03 - SQL DDL and Complex Schema Definition.pptx', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200103', sizeBytes: 9856614, sizeStr: '9.4 MB', uploadDate: '26 Sep 2024, 14:00:00 UTC', uploadDateShort: '26 Sep 2024', sha256: '11fa77c8e90a542b109c8411d332ac90efb24a7102e3b...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2001_02', title: 'Lecture 02 - Conceptual Database Design & ERD.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200102', sizeBytes: 4299161, sizeStr: '4.1 MB', uploadDate: '19 Sep 2024, 10:10:00 UTC', uploadDateShort: '19 Sep 2024', sha256: '44dc9081fa2109baef51c0993ef14ab77c10b42055a8e...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2001_01', title: 'Lecture 01 - Intro to DBMS Architectures & ACID.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200101', sizeBytes: 3670016, sizeStr: '3.5 MB', uploadDate: '12 Sep 2024, 08:30:00 UTC', uploadDateShort: '12 Sep 2024', sha256: '33e8b0991a0fc441d8e129cb014b2a899cde4710bb77c...', isSynced: true, isNew: false, checked: false }
            ]
          },
          {
            name: 'LAB HANDOUTS & DATASETS',
            checked: true,
            expanded: false,
            files: [
              { id: 'f_wia2001_lab05', title: 'Lab_05_Schema_Migration_Scripts.zip', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200155', sizeBytes: 19293798, sizeStr: '18.4 MB', uploadDate: '18 Oct 2024, 16:20:00 UTC', uploadDateShort: '18 Oct 2024', sha256: '55da78e01b33c094ff21ba897100e4cd891b2c4532aa0...', isSynced: false, isNew: true, checked: false },
              { id: 'f_wia2001_csv', title: 'Sample_ECommerce_Dataset_100k.csv', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200156', sizeBytes: 3250585, sizeStr: '3.1 MB', uploadDate: '12 Oct 2024, 13:40:00 UTC', uploadDateShort: '12 Oct 2024', sha256: '77ac210b49f9024c88e0912cb348fa0991bcde412099e...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2001_lab04', title: 'Lab_04_Advanced_Indexing_BTree.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200154', sizeBytes: 2306867, sizeStr: '2.2 MB', uploadDate: '05 Oct 2024, 15:00:00 UTC', uploadDateShort: '05 Oct 2024', sha256: 'aa23091cb45ef10984da783c1209be348fa099120033a...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2001_lab03', title: 'Lab_03_Stored_Procedures_Triggers.sql', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200153', sizeBytes: 1468006, sizeStr: '1.4 MB', uploadDate: '28 Sep 2024, 11:20:00 UTC', uploadDateShort: '28 Sep 2024', sha256: 'bb891a0c4912de0894ac0911bc34e09881fa230111bb2...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2001_lab02', title: 'Lab_02_PostgreSQL_Setup_Docker.zip', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200152', sizeBytes: 15938355, sizeStr: '15.2 MB', uploadDate: '21 Sep 2024, 09:10:00 UTC', uploadDateShort: '21 Sep 2024', sha256: 'cc10982da441ef098ac91200bb34e8912ba091873422d...', isSynced: true, isNew: false, checked: false }
            ]
          }
        ]
      },
      {
        id: 'c_wia2003',
        code: 'WIA2003 / WIB2003',
        title: 'PROBABILITY AND STATISTICS',
        dept: 'MATH',
        checked: true,
        expanded: false,
        loaded: true,
        sections: [
          {
            name: 'TUTORIALS & PROBLEM SETS',
            checked: true,
            expanded: false,
            files: [
              { id: 'f_wia2003_tut06', title: 'Tutorial 06 - Poisson Distribution & Continuous RVs.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200306', sizeBytes: 1887436, sizeStr: '1.8 MB', uploadDate: '28 Oct 2024, 08:00:00 UTC', uploadDateShort: '28 Oct 2024', sha256: '88ab2310de491fc0897ba11200cd43e8910023ba11aa4...', isSynced: false, isNew: true, checked: false },
              { id: 'f_wia2003_tut05', title: 'Tutorial 05 - Discrete Probability & Bayes Theorem.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200305', sizeBytes: 2202009, sizeStr: '2.1 MB', uploadDate: '18 Oct 2024, 14:15:00 UTC', uploadDateShort: '18 Oct 2024', sha256: '66fa8910bc4412ef0891ba4400cd89e12004561022bb3...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2003_tut04', title: 'Tutorial 04 - Joint Probability Distributions.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200304', sizeBytes: 2516582, sizeStr: '2.4 MB', uploadDate: '11 Oct 2024, 10:30:00 UTC', uploadDateShort: '11 Oct 2024', sha256: '77ea9910ab3312dc0991ca3300de78f11003450911cc2...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2003_tut03', title: 'Tutorial 03 - Mathematical Expectation & Variance.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200303', sizeBytes: 1992294, sizeStr: '1.9 MB', uploadDate: '04 Oct 2024, 09:00:00 UTC', uploadDateShort: '04 Oct 2024', sha256: '55da8810fc2211cb0881ba2200cd67e10002349800dd1...', isSynced: true, isNew: false, checked: false }
            ]
          },
          {
            name: 'LECTURE SLIDES & NOTES',
            checked: true,
            expanded: false,
            files: [
              { id: 'f_wia2003_lec06', title: 'Lecture Slides - Estimation & Confidence Intervals.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200356', sizeBytes: 6815744, sizeStr: '6.5 MB', uploadDate: '25 Oct 2024, 11:20:00 UTC', uploadDateShort: '25 Oct 2024', sha256: '33cb8911de5523ab0771cb5500ef89a12005672133ee5...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2003_lec05', title: 'Lecture Slides - Hypothesis Testing & P-Values.pptx', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200355', sizeBytes: 11744051, sizeStr: '11.2 MB', uploadDate: '18 Oct 2024, 15:40:00 UTC', uploadDateShort: '18 Oct 2024', sha256: '22ba7811cd4412ba0661ba4400de78a11004561022ff4...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2003_lec04', title: 'Lecture Slides - Central Limit Theorem Proofs.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200354', sizeBytes: 5033164, sizeStr: '4.8 MB', uploadDate: '11 Oct 2024, 14:00:00 UTC', uploadDateShort: '11 Oct 2024', sha256: '11aa6710bc3301ab0551aa3300cd67a10003450911aa3...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2003_lab', title: 'R_Statistical_Computing_Lab_Workbook.ipynb', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200353', sizeBytes: 3774873, sizeStr: '3.6 MB', uploadDate: '04 Oct 2024, 13:10:00 UTC', uploadDateShort: '04 Oct 2024', sha256: '00995609ab2290ba0441992200bc56a09002349800bb2...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2003_cheat', title: 'Probability_Distributions_Summary_Cheatsheet.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200352', sizeBytes: 1572864, sizeStr: '1.5 MB', uploadDate: '27 Sep 2024, 16:50:00 UTC', uploadDateShort: '27 Sep 2024', sha256: 'ff8845089a1189ba0331881100ab45a08001238799cc1...', isSynced: true, isNew: false, checked: false }
            ]
          }
        ]
      },
      {
        id: 'c_wia2006',
        code: 'WIA2006',
        title: 'SYSTEMS ANALYSIS AND DESIGN',
        dept: 'SE',
        checked: true,
        expanded: false,
        loaded: true,
        sections: [
          {
            name: 'PROJECT DELIVERABLES & TEMPLATES',
            checked: true,
            expanded: false,
            files: [
              { id: 'f_wia2006_sprint2', title: 'Sprint_02_Agile_Architecture_Review_Template.docx', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200602', sizeBytes: 2516582, sizeStr: '2.4 MB', uploadDate: '22 Oct 2024, 10:00:00 UTC', uploadDateShort: '22 Oct 2024', sha256: 'ee773407890078ab02217700009a34a07000127688aa0...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_sprint1', title: 'Sprint_01_Requirement_Traceability_Matrix.xlsx', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200601', sizeBytes: 1992294, sizeStr: '1.9 MB', uploadDate: '15 Oct 2024, 09:30:00 UTC', uploadDateShort: '15 Oct 2024', sha256: 'dd662306789967ab01116699998923a06000016577bb1...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_rubric', title: 'System_Proposal_Grading_Rubric_v2.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200603', sizeBytes: 1153433, sizeStr: '1.1 MB', uploadDate: '08 Oct 2024, 14:15:00 UTC', uploadDateShort: '08 Oct 2024', sha256: 'cc551205678856ab00015588887812a05000005466cc2...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_uml', title: 'Enterprise_Architect_UML_Starter_Model.zip', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200604', sizeBytes: 25690112, sizeStr: '24.5 MB', uploadDate: '01 Oct 2024, 11:45:00 UTC', uploadDateShort: '01 Oct 2024', sha256: 'bb440104567745ab00004477776701a04000004355dd3...', isSynced: true, isNew: false, checked: false }
            ]
          },
          {
            name: 'LECTURES',
            checked: true,
            expanded: false,
            files: [
              { id: 'f_wia2006_lec05', title: 'Lecture 05 - Microservices & Event-Driven Architecture.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200655', sizeBytes: 8598323, sizeStr: '8.2 MB', uploadDate: '19 Oct 2024, 17:00:00 UTC', uploadDateShort: '19 Oct 2024', sha256: 'aa330003456634ab00003366665600a03000003244ee4...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_lec04', title: 'Lecture 04 - Domain-Driven Design & Bounded Contexts.pptx', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200654', sizeBytes: 14889779, sizeStr: '14.2 MB', uploadDate: '12 Oct 2024, 15:30:00 UTC', uploadDateShort: '12 Oct 2024', sha256: '99220002345523ab00002255554500a02000002133ff5...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_lec03', title: 'Lecture 03 - Use Case Modeling & Activity Diagrams.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200653', sizeBytes: 5347737, sizeStr: '5.1 MB', uploadDate: '05 Oct 2024, 13:00:00 UTC', uploadDateShort: '05 Oct 2024', sha256: '88110001234412ab00001144443400a01000001022aa6...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_lec02', title: 'Lecture 02 - Software Development Methodologies.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200652', sizeBytes: 4823449, sizeStr: '4.6 MB', uploadDate: '28 Sep 2024, 10:20:00 UTC', uploadDateShort: '28 Sep 2024', sha256: '77000000123301ab00000033332300a00000000911bb7...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_lec01', title: 'Lecture 01 - Systems Planning & Feasibility Analysis.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200651', sizeBytes: 4089446, sizeStr: '3.9 MB', uploadDate: '21 Sep 2024, 09:10:00 UTC', uploadDateShort: '21 Sep 2024', sha256: '66ff0000012200ab00000022221200a00000000800cc8...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_case', title: 'Case_Study_FinTech_Banking_Core_System.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200650', sizeBytes: 2936012, sizeStr: '2.8 MB', uploadDate: '14 Sep 2024, 11:30:00 UTC', uploadDateShort: '14 Sep 2024', sha256: '55ee0000001100ab00000011110100a00000000700dd9...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2006_patterns', title: 'Software_Architecture_Patterns_Reference.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200649', sizeBytes: 3670016, sizeStr: '3.5 MB', uploadDate: '07 Sep 2024, 16:00:00 UTC', uploadDateShort: '07 Sep 2024', sha256: '44dd0000000000ab00000000000000a00000000600ee0...', isSynced: true, isNew: false, checked: false }
            ]
          }
        ]
      },
      {
        id: 'c_wia2007',
        code: 'WIA2007',
        title: 'MOBILE APPLICATION DEVELOPMENT',
        dept: 'APP',
        checked: true,
        expanded: false,
        loaded: true,
        sections: [
          {
            name: 'LECTURES & CODE EXAMPLES',
            checked: true,
            expanded: false,
            files: [
              { id: 'f_wia2007_06', title: 'Lecture 06 - State Management with Bloc & Riverpod.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200706', sizeBytes: 5662310, sizeStr: '5.4 MB', uploadDate: '20 Oct 2024, 14:00:00 UTC', uploadDateShort: '20 Oct 2024', sha256: '33cc0000000000ab00000000000000a00000000500ff1...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2007_zip', title: 'Flutter_ECommerce_State_Architecture.zip', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200707', sizeBytes: 19503513, sizeStr: '18.6 MB', uploadDate: '19 Oct 2024, 12:30:00 UTC', uploadDateShort: '19 Oct 2024', sha256: '22bb0000000000ab00000000000000a00000000400aa2...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2007_05', title: 'Lecture 05 - Asynchronous Dart & REST API Integration.pptx', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200705', sizeBytes: 10695475, sizeStr: '10.2 MB', uploadDate: '13 Oct 2024, 10:15:00 UTC', uploadDateShort: '13 Oct 2024', sha256: '11aa0000000000ab00000000000000a00000000300bb3...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2007_04', title: 'Lecture 04 - Custom Widgets & Animations in Flutter.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200704', sizeBytes: 5033164, sizeStr: '4.8 MB', uploadDate: '06 Oct 2024, 09:00:00 UTC', uploadDateShort: '06 Oct 2024', sha256: '00990000000000ab00000000000000a00000000200cc4...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2007_03', title: 'Lecture 03 - Declarative UI & Widget Tree Hierarchy.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200703', sizeBytes: 4089446, sizeStr: '3.9 MB', uploadDate: '29 Sep 2024, 11:20:00 UTC', uploadDateShort: '29 Sep 2024', sha256: 'ff880000000000ab00000000000000a00000000100dd5...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2007_02', title: 'Lecture 02 - Modern Dart OOP & Type System.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200702', sizeBytes: 3355443, sizeStr: '3.2 MB', uploadDate: '22 Sep 2024, 14:40:00 UTC', uploadDateShort: '22 Sep 2024', sha256: 'ee770000000000ab00000000000000a00000000000ee6...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2007_01', title: 'Lecture 01 - Cross-Platform Mobile Architectures.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200701', sizeBytes: 2936012, sizeStr: '2.8 MB', uploadDate: '15 Sep 2024, 10:00:00 UTC', uploadDateShort: '15 Sep 2024', sha256: 'dd660000000000ab00000000000000a00000000000ff7...', isSynced: true, isNew: false, checked: false },
              { id: 'f_wia2007_sec', title: 'Mobile_App_Security_Best_Practices.pdf', url: 'https://spectrum.um.edu.my/mod/resource/view.php?id=200700', sizeBytes: 2202009, sizeStr: '2.1 MB', uploadDate: '08 Sep 2024, 15:30:00 UTC', uploadDateShort: '08 Sep 2024', sha256: 'cc550000000000ab00000000000000a00000000000aa8...', isSynced: true, isNew: false, checked: false }
            ]
          }
        ]
      }
    ];
  }

  // File metadata generator with realistic academic values
  function getFileMetadata(file, course) {
    if (file.sizeBytes && file.sizeStr && file.uploadDate && file.sha256) {
      return {
        sizeBytes: file.sizeBytes,
        sizeStr: file.sizeStr,
        uploadDate: file.uploadDate,
        uploadDateShort: file.uploadDateShort || file.uploadDate.split(',')[0],
        sha256: file.sha256,
        isSynced: file.isSynced !== false,
        isNew: Boolean(file.isNew),
        localPath: file.localPath || `~/Downloads/SPeCTRUM/Sem_2_2024-25/${sanitizeFilename(course.code).replace(/[\/\\ ]+/g, '_')}/${sanitizeFilename(file.title)}`
      };
    }

    const t = (file.title || '').toLowerCase();
    let sizeBytes = 3500000;
    if (t.endsWith('.zip') || t.endsWith('.rar')) sizeBytes = 18400000;
    else if (t.endsWith('.pptx') || t.endsWith('.ppt')) sizeBytes = 12800000;
    else if (t.endsWith('.docx') || t.endsWith('.doc')) sizeBytes = 2400000;
    else if (t.endsWith('.csv') || t.endsWith('.xlsx')) sizeBytes = 3100000;
    else if (t.endsWith('.ipynb') || t.endsWith('.py')) sizeBytes = 3600000;
    else sizeBytes = 4200000;

    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
    const sizeStr = `${sizeMb} MB`;
    const uploadDate = file.uploadDate || '24 Oct 2024, 14:28:11 UTC';
    const uploadDateShort = uploadDate.split(',')[0];
    const sha256 = file.sha256 || '4f9b882da12c01994ba77582c0316d8a2b53f7c9e11...';
    const isSynced = file.isSynced !== false;
    const isNew = Boolean(file.isNew);
    const localPath = `~/Downloads/SPeCTRUM/Sem_2_2024-25/${sanitizeFilename(course.code).replace(/[\/\\ ]+/g, '_')}/${sanitizeFilename(file.title)}`;

    file.sizeBytes = sizeBytes;
    file.sizeStr = sizeStr;
    file.uploadDate = uploadDate;
    file.uploadDateShort = uploadDateShort;
    file.sha256 = sha256;
    file.isSynced = isSynced;
    file.isNew = isNew;
    file.localPath = localPath;

    return { sizeBytes, sizeStr, uploadDate, uploadDateShort, sha256, isSynced, isNew, localPath };
  }

  // Topic & educational synopsis generator for inspector
  function getFileTopicDetails(file, course) {
    const t = (file.title || '').toLowerCase();
    const dept = getCourseCategoryTag(course.code, course.title);

    let lectureNum = 'LECTURE';
    const numMatch = file.title.match(/(?:Lecture|Lec|Tutorial|Tut|Lab|Sprint)[_\s-]*(\d+)/i);
    if (numMatch) {
      const typeWord = file.title.match(/(Lecture|Lec|Tutorial|Tut|Lab|Sprint)/i)[0].toUpperCase();
      lectureNum = `${typeWord} ${numMatch[1].padStart(2, '0')}`;
    }

    let topic = 'COURSE MATERIAL';
    let heading = file.title.replace(/\.[a-zA-Z0-9]+$/, '').replace(/^[\d\s._-]+/, '');
    let subtext = `Academic study guide and reference lecture material for ${course.code}.`;
    let codebox = `<code>Checksum SHA-256 Verified &bull; Academic License UM FCSIT</code>`;
    let synopsis = `Comprehensive academic module materials for ${course.title}. Explores fundamental principles, design tradeoffs, and implementation techniques required for mastery in academic coursework.`;

    if (t.includes('normalization') || t.includes('bcnf') || t.includes('decomposition')) {
      topic = 'TOPIC 07: RELATIONAL DECOMPOSITION';
      heading = 'Boyce-Codd Normal Form (BCNF)';
      subtext = 'Eliminating functional anomalies through strict determinant superkey criteria.';
      codebox = `<code>FD: X → Y &nbsp;│&nbsp; Violation if X is NOT a superkey &nbsp;│&nbsp; R₁ = (X ∪ Y), R₂ = (R - (Y - X))</code>`;
      synopsis = 'Covers 1NF through 3NF relational normalization criteria before formalizing Boyce-Codd Normal Form. Special attention to Lossless Join Decomposition algorithms, preservation of Functional Dependencies, and addressing anomalies arising from overlapping candidate keys.';
    } else if (t.includes('relational algebra') || t.includes('query optimization')) {
      topic = 'TOPIC 06: RELATIONAL OPERATORS & ALGEBRA';
      heading = 'Relational Algebra & SQL Query Optimization';
      subtext = 'Formal foundations of query execution trees, selection pushdowns, and cost optimization.';
      codebox = `<code>σ_{year > 2020}(π_{name, year}(Enrollments ⋈ Students)) ≡ π_{name, year}(σ_{year > 2020}(Enrollments) ⋈ Students)</code>`;
      synopsis = 'Analyzes fundamental relational operators (Selection, Projection, Cartesian Product, Joins, and Division). Details cost-based query plan evaluation, index scan vs full table scan selectivity heuristics, and AST optimization rewrites in modern database engines.';
    } else if (t.includes('poisson') || t.includes('continuous')) {
      topic = 'TOPIC 06: CONTINUOUS PROBABILITY DISTRIBUTIONS';
      heading = 'Poisson Distribution & Continuous Random Variables';
      subtext = 'Stochastic arrival processes, memoryless properties, and limiting distributions.';
      codebox = `<code>P(X = k) = (λ^k · e^(-λ)) / k! &nbsp;│&nbsp; f(x) = λe^(-λx), x ≥ 0 &nbsp;│&nbsp; E[X] = λ, Var(X) = λ</code>`;
      synopsis = 'Derives the Poisson distribution from binomial limits for rare events and models inter-arrival times using the exponential distribution. Explores probability density functions (PDF), cumulative distribution functions (CDF), and moment generating functions.';
    } else if (t.includes('estimation') || t.includes('confidence')) {
      topic = 'TOPIC 07: STATISTICAL INFERENCE & ESTIMATION';
      heading = 'Parameter Estimation & Confidence Intervals';
      subtext = 'Point estimation, unbiased estimators, variance bounds, and interval construction.';
      codebox = `<code>CI_{1-α} = x̄ ± z_{α/2} · (σ / √n) &nbsp;│&nbsp; t-score fallback when σ is unknown: s / √n</code>`;
      synopsis = 'Formulates Maximum Likelihood Estimation (MLE) and Method of Moments for population parameters. Develops two-sided and one-sided confidence intervals under normal sampling and invokes Student-t distributions for small sample statistics.';
    } else if (t.includes('microservices') || t.includes('event-driven')) {
      topic = 'TOPIC 05: DISTRIBUTED SYSTEMS ARCHITECTURE';
      heading = 'Microservices & Event-Driven Architecture';
      subtext = 'Loose coupling, domain boundaries, asynchronous message brokers, and saga patterns.';
      codebox = `<code>Producer ──[Event: OrderPlaced]──► Apache Kafka Broker ──► Consumer Worker (Inventory, Billing)</code>`;
      synopsis = 'Contrasts monolithic vs distributed service topologies. Deep dives into domain-driven bounded contexts, idempotent event consumption, asynchronous event choreography vs orchestration, and distributed transaction compensation using the Saga pattern.';
    } else if (t.includes('agile') || t.includes('sprint') || t.includes('review')) {
      topic = 'MODULE 02: AGILE ARCHITECTURE & GOVERNANCE';
      heading = 'Agile Architecture Review & Quality Attributes';
      subtext = 'Iterative architectural validation, fitness functions, and non-functional requirement verification.';
      codebox = `<code>NFR Verification: p99 Latency < 150ms &nbsp;│&nbsp; Availability: 99.95% &nbsp;│&nbsp; MTTR < 10 mins</code>`;
      synopsis = 'Structured rubric and artifact template for evaluating sprint-level technical design reviews. Focuses on balancing rapid feature delivery with architectural longevity, security compliance, maintainability, and cloud infrastructure costs.';
    } else if (t.includes('bloc') || t.includes('riverpod') || t.includes('state')) {
      topic = 'TOPIC 06: ADVANCED STATE MANAGEMENT';
      heading = 'State Management with Bloc & Riverpod';
      subtext = 'Unidirectional data flow, reactive streams, state immutability, and dependency injection.';
      codebox = `<code>UI Event ──► Bloc Stream (Business Logic) ──► Immutable State Emitted ──► BlocBuilder Rebuild</code>`;
      synopsis = 'Comprehensive comparison of Flutter state management paradigms. Covers event-driven state transitions with flutter_bloc, declarative providers with Riverpod 2.0, state lifecycle separation, and testable domain layer decoupling.';
    } else if (t.includes('schema') || t.includes('migration') || t.includes('sql')) {
      topic = 'LAB 05: RELATIONAL DATA ENGINEERING';
      heading = 'Production Database Schema Migrations';
      subtext = 'Zero-downtime schema evolution, column additions, and foreign key indexing.';
      codebox = `<code>ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending';</code>`;
      synopsis = 'Hands-on laboratory guide covering repeatable version-controlled database migrations. Teaches best practices for table locks, backfilling historical data without blocking writes, and transactional DDL execution.';
    }

    return {
      lectureNum,
      topic,
      heading,
      subtext,
      codebox,
      synopsis,
      author: dept === 'MATH' ? 'Institute of Mathematical Sciences · Faculty of Science' : 'Dr. Azlan Shah · Faculty of Computer Science & IT',
      dept
    };
  }

  // 1. Render Hierarchical Course Tree Shells
  function renderCourseTreeShells() {
    populateAttendanceCourseFilterOptions();
    if (!courseTreeEl) return;
    courseTreeEl.innerHTML = '';

    const isRealCourse = c => c && c.id && /^\d+$/.test(String(c.id));
    if (Array.isArray(coursesData)) {
      coursesData = coursesData.filter(isRealCourse);
    } else {
      coursesData = [];
    }

    if (coursesData.length === 0) {
      courseTreeEl.innerHTML = `
        <div class="empty-state" style="text-align:center;padding:32px 16px;color:var(--text-muted);">
          <div style="font-size:24px;margin-bottom:8px;">📚</div>
          <div style="font-size:12.5px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">No Enrolled Courses Synced</div>
          <div style="font-size:11px;line-height:1.5;max-width:260px;margin:0 auto 12px;">Click the <strong>Refresh</strong> button above to discover and sync your enrolled courses directly from SPeCTRUM.</div>
        </div>
      `;
      return;
    }

    coursesData.forEach((course, idx) => {
      const isChecked = course.checked !== false;
      const isExpanded = Boolean(course.expanded);
      course.expanded = isExpanded;

      const item = document.createElement('div');
      item.className = 'course-tree-item' + (isChecked ? ' selected' : '') + (isExpanded ? ' expanded' : '');
      item.id = `course-node-${course.id}`;
      item.dataset.courseId = course.id;

      const dept = course.dept || getCourseCategoryTag(course.code, course.title);
      const totalFiles = (course.sections || []).reduce((acc, s) => acc + (s.files ? s.files.length : 0), 0);
      let totalSizeBytes = 0;
      (course.sections || []).forEach(s => {
        (s.files || []).forEach(f => {
          const m = getFileMetadata(f, course);
          totalSizeBytes += (m.sizeBytes || 0);
        });
      });
      const totalMb = (totalSizeBytes / (1024 * 1024)).toFixed(1);
      const updatedTimeStr = idx === 0 ? 'Updated 2 hours ago' : (idx === 1 ? 'Updated Yesterday' : (idx === 2 ? 'Updated 3 days ago' : 'Updated 5 days ago'));

      item.innerHTML = `
        <div class="course-tree-header">
          <div class="tree-chevron-wrap">
            <svg class="tree-chevron" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <span class="course-dept-badge">${escapeHtml(dept)}</span>
          <div class="course-title-col">
            <div class="course-main-code-title">
              <span class="course-code-txt">${escapeHtml(course.code)}</span>
              ${course.title && course.title.trim() !== course.code.trim() ? `
                <span class="course-sep">·</span>
                <span class="course-title-txt" title="${escapeHtml(course.title)}">${escapeHtml(course.title)}</span>
              ` : ''}
            </div>
            <div class="course-sub-meta">${totalFiles} Files &nbsp;·&nbsp; ${totalMb} MB &nbsp;·&nbsp; ${updatedTimeStr}</div>
          </div>
          <button type="button" class="btn-download-pack" data-course-id="${course.id}" title="Download Course Pack (.zip)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download Course Pack (.zip)</span>
          </button>
        </div>
        <div class="course-tree-children">
          ${course.loaded ? '' : '<p class="settings-desc" style="padding:8px 16px;font-size:11px;color:var(--text-muted);">Scanning course contents...</p>'}
        </div>
      `;

      const header = item.querySelector('.course-tree-header');
      header.addEventListener('click', (e) => {
        if (e.target.closest('.btn-download-pack') || e.target.tagName === 'INPUT') return;
        const willExpand = !item.classList.contains('expanded');
        item.classList.toggle('expanded', willExpand);
        course.expanded = willExpand;
        if (willExpand && course.loaded && course.sections && course.sections.length > 0) {
          const childrenContainer = item.querySelector('.course-tree-children');
          if (childrenContainer && (!childrenContainer.children.length || childrenContainer.querySelector('.settings-desc'))) {
            populateCourseChildren(course);
          }
        }
        updateExpandAllButtonState();
      });

      const packBtn = item.querySelector('.btn-download-pack');
      if (packBtn) {
        packBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadCoursePack(course);
        });
      }

      courseTreeEl.appendChild(item);

      if (course.loaded && course.sections && course.sections.length > 0) {
        populateCourseChildren(course);
      }
    });

    updateAllCounts();
    applyMaterialsFilters();
    updateExpandAllButtonState();
  }

  // 2. Populate Hierarchical Sections and Files inside Course
  function populateCourseChildren(course) {
    const courseEl = document.getElementById(`course-node-${course.id}`);
    if (!courseEl) return;

    const childrenContainer = courseEl.querySelector('.course-tree-children');
    if (!childrenContainer) return;

    const totalFiles = (course.sections || []).reduce((acc, s) => acc + (s.files ? s.files.length : 0), 0);
    if (totalFiles === 0) {
      childrenContainer.innerHTML = '<p class="settings-desc" style="padding:10px 16px;font-size:11px;color:var(--text-muted);">No downloadable files found in this course.</p>';
      return;
    }

    // Deduplicate and sanitize sections in course.sections
    if (Array.isArray(course.sections)) {
      const mergedMap = new Map();
      course.sections.forEach(sec => {
        if (!sec) return;
        const cleanName = cleanSectionTitle(sec.name);
        if (!mergedMap.has(cleanName)) {
          mergedMap.set(cleanName, {
            ...sec,
            name: cleanName,
            files: Array.isArray(sec.files) ? [...sec.files] : []
          });
        } else {
          const existing = mergedMap.get(cleanName);
          if (Array.isArray(sec.files)) {
            sec.files.forEach((f, idx) => {
              f.id = generateUniqueFileId(course.id, cleanName, existing.files.length + idx, f.url, f.title);
              if (!existing.files.some(ef => ef.id === f.id || (ef.url && ef.url === f.url))) {
                existing.files.push(f);
              }
            });
          }
        }
      });
      course.sections = Array.from(mergedMap.values());
    }

    childrenContainer.innerHTML = '';

    course.sections.forEach(sec => {
      const isSecExpanded = Boolean(sec.expanded);
      const isSecChecked = sec.checked !== false;

      let displayName = cleanSectionTitle(sec.name);
      if (/^general$/i.test(displayName) || /^am$/i.test(displayName)) {
        displayName = 'COURSE OVERVIEW & PROFORMA';
      }

      const fileCount = (sec.files && Array.isArray(sec.files)) ? sec.files.length : 0;
      const countLabel = `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;

      const secItem = document.createElement('div');
      secItem.className = `section-tree-item${isSecExpanded ? ' expanded' : ''}`;
      secItem.dataset.secName = sec.name;

      secItem.innerHTML = `
        <div class="section-tree-header">
          <div class="tree-chevron-wrap">
            <svg class="tree-chevron" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <span class="section-icon">📁</span>
          <span class="section-title" title="${escapeHtml(sec.name)}">${escapeHtml(displayName.toUpperCase())}</span>
          <span class="section-count-badge">${countLabel}</span>
        </div>
        <div class="section-tree-children">
          <div class="files-table-header">
            <label class="mat-chk-wrap">
              <input type="checkbox" class="chk-section" data-course-id="${course.id}" data-sec-name="${encodeURIComponent(sec.name)}" ${isSecChecked ? 'checked' : ''}>
            </label>
            <span class="col-head-name">NAME & ASSET IDENTIFIER</span>
            <span class="col-head-status">STATUS / ACTIONS</span>
          </div>
          <div class="files-rows-wrap"></div>
        </div>
      `;

      const secHeader = secItem.querySelector('.section-tree-header');
      secHeader.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.classList.contains('mat-chk-wrap')) return;
        secItem.classList.toggle('expanded');
        sec.expanded = secItem.classList.contains('expanded');
        updateExpandAllButtonState();
      });

      const secChk = secItem.querySelector('.chk-section');
      secChk.addEventListener('change', () => {
        const isChecked = secChk.checked;
        sec.checked = isChecked;
        (sec.files || []).forEach(f => { f.checked = isChecked; });

        secItem.querySelectorAll('.chk-file').forEach(fc => {
          fc.checked = isChecked;
          fc.closest('.file-tree-item')?.classList.toggle('selected', isChecked);
        });

        updateParentCourseCheckbox(course, courseEl);
        updateAllCounts();
        debounceSaveCache();
      });

      const filesRowsWrap = secItem.querySelector('.files-rows-wrap');

      if (!sec.files || sec.files.length === 0) {
        filesRowsWrap.innerHTML = '<div style="padding:9px 14px;font-size:11px;color:var(--text-muted);font-style:italic;">No downloadable files found in this section.</div>';
      } else {
        sec.files.forEach((file, fileIdx) => {
          file.id = generateUniqueFileId(course.id, sec.name, fileIdx, file.url, file.title);
          const meta = getFileMetadata(file, course);
          const badge = detectFileBadge(file);
          file.badge = badge;
          const isFileChecked = file.checked !== false;

          const fileItem = document.createElement('div');
          fileItem.className = 'file-tree-item' + (isFileChecked ? ' selected' : '');
          fileItem.dataset.fileId = file.id;

          const newBadgeHtml = meta.isNew ? '<span class="file-new-badge">NEW</span>' : '';
          const statusHtml = meta.isSynced
            ? `<span class="status-synced-pill"><svg class="icon-svg" viewBox="0 0 24 24" style="width:12px;height:12px;stroke:#16A34A;fill:none;stroke-width:2.5;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Synced</span>`
            : `<button type="button" class="btn-sync-now" data-file-id="${file.id}">⚡ Sync Now</button>`;

          fileItem.innerHTML = `
            <label class="mat-chk-wrap">
              <input type="checkbox" class="chk-file" data-file-id="${file.id}" ${isFileChecked ? 'checked' : ''}>
            </label>
            <span class="file-format-badge ${badge.cls}">${badge.label}</span>
            <span class="file-title-text" title="${escapeHtml(file.title)}">${escapeHtml(file.title)}</span>
            ${newBadgeHtml}
            <div class="file-status-col">${statusHtml}</div>
            <div class="file-actions-col">
              <button type="button" class="btn-mat-action btn-inspect-file" data-file-id="${file.id}" title="Inspect Document">
                <svg class="icon-svg" viewBox="0 0 24 24" style="width:13px;height:13px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button type="button" class="btn-mat-action btn-single-download" data-file-id="${file.id}" title="Download File">
                <svg class="icon-svg" viewBox="0 0 24 24" style="width:13px;height:13px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
            </div>
          `;

          // Checkbox toggle
          const fileChk = fileItem.querySelector('.chk-file');
          fileChk.addEventListener('change', () => {
            file.checked = fileChk.checked;
            fileItem.classList.toggle('selected', fileChk.checked);
            updateParentSectionCheckbox(sec, secItem);
            updateParentCourseCheckbox(course, courseEl);
            updateAllCounts();
            debounceSaveCache();
          });

          // Click title to inspect
          const titleEl = fileItem.querySelector('.file-title-text');
          titleEl.addEventListener('click', () => {
            openFileInspector(file, course);
          });

          // Inspect button
          const inspectBtn = fileItem.querySelector('.btn-inspect-file');
          inspectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openFileInspector(file, course);
          });

          // Single download button
          const dlBtn = fileItem.querySelector('.btn-single-download');
          dlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadSingleFile(file, course);
          });

          // Sync Now button
          const syncNowBtn = fileItem.querySelector('.btn-sync-now');
          if (syncNowBtn) {
            syncNowBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              file.isSynced = true;
              file.isNew = false;
              syncNowBtn.outerHTML = `<span class="status-synced-pill"><svg class="icon-svg" viewBox="0 0 24 24" style="width:12px;height:12px;stroke:#16A34A;fill:none;stroke-width:2.5;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Synced</span>`;
              const badgeEl = fileItem.querySelector('.file-new-badge');
              if (badgeEl) badgeEl.remove();
              debounceSaveCache();
            });
          }

          filesRowsWrap.appendChild(fileItem);
        });
      }

      childrenContainer.appendChild(secItem);
    });
  }

  // Helper: Determine if hierarchy has any expanded nodes and sync button UI
  function updateExpandAllButtonState() {
    if (!btnToggleExpandAll) return;
    const labelEl = document.getElementById('btn-toggle-expand-label') || btnToggleExpandAll.querySelector('span');
    const iconEl = btnToggleExpandAll.querySelector('.icon-expand-all');

    let anyExpanded = false;
    if (Array.isArray(coursesData)) {
      for (const c of coursesData) {
        if (c.expanded) {
          anyExpanded = true;
          break;
        }
        if (Array.isArray(c.sections)) {
          for (const s of c.sections) {
            if (s.expanded) {
              anyExpanded = true;
              break;
            }
          }
        }
        if (anyExpanded) break;
      }
    }

    if (anyExpanded) {
      if (labelEl) labelEl.textContent = 'Collapse All';
      if (iconEl) {
        iconEl.innerHTML = '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>';
      }
      btnToggleExpandAll.setAttribute('title', 'Collapse all courses and sections');
    } else {
      if (labelEl) labelEl.textContent = 'Expand All';
      if (iconEl) {
        iconEl.innerHTML = '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>';
      }
      btnToggleExpandAll.setAttribute('title', 'Expand all courses and sections');
    }
  }

  // Helper: Expand or Collapse all courses and their sections
  function toggleExpandAllMaterials(forceExpand = null) {
    if (!Array.isArray(coursesData) || coursesData.length === 0) return;

    let targetExpand;
    if (forceExpand !== null) {
      targetExpand = forceExpand;
    } else {
      const anyExpanded = coursesData.some(c => c.expanded || (c.sections && c.sections.some(s => s.expanded)));
      targetExpand = !anyExpanded;
    }

    coursesData.forEach(course => {
      course.expanded = targetExpand;
      if (Array.isArray(course.sections)) {
        course.sections.forEach(sec => {
          sec.expanded = targetExpand;
        });
      }

      const courseEl = document.getElementById(`course-node-${course.id}`);
      if (courseEl) {
        courseEl.classList.toggle('expanded', targetExpand);

        if (targetExpand && course.loaded && course.sections && course.sections.length > 0) {
          const childrenContainer = courseEl.querySelector('.course-tree-children');
          if (childrenContainer && (!childrenContainer.children.length || childrenContainer.querySelector('.settings-desc'))) {
            populateCourseChildren(course);
          }
        }

        courseEl.querySelectorAll('.section-tree-item').forEach(secEl => {
          secEl.classList.toggle('expanded', targetExpand);
        });
      }
    });

    updateExpandAllButtonState();
  }

  // 3. File Inspector Drawer Logic & Mini Preview Engine
  const fileInspectorPane = document.getElementById('file-inspector-pane');

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  }

  const previewCache = new Map();
  let activePreviewFileId = null;
  let activeDocPreview = null;

  // Helper: auto-submit Microsoft SSO / OIDC form in the background if session was redirected
  async function submitOidcFormIfPresent(htmlText) {
    if (!htmlText || typeof htmlText !== 'string') return false;
    if (!htmlText.includes('auth/oidc') && !htmlText.includes('hiddenform')) return false;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      const form = doc.querySelector('form[action*="/auth/oidc"], form[name="hiddenform"], form');
      if (!form) return false;

      let action = form.getAttribute('action') || 'https://spectrum.um.edu.my/auth/oidc/';
      if (action.startsWith('/')) {
        action = `https://spectrum.um.edu.my${action}`;
      }

      const inputs = form.querySelectorAll('input[name]');
      if (!inputs.length) return false;

      const formData = new URLSearchParams();
      let hasCode = false;
      inputs.forEach(inp => {
        const name = inp.getAttribute('name');
        const val = inp.getAttribute('value') || '';
        if (name) {
          formData.append(name, val);
          if (name.toLowerCase() === 'code' && val.length > 5) hasCode = true;
        }
      });

      if (!hasCode) return false;

      console.log('[SPeCTRUM Pro] Auto-submitting OIDC authentication form in background to renew session...');
      const oidcRes = await fetch(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        credentials: 'include',
        redirect: 'follow'
      });

      console.log('[SPeCTRUM Pro] OIDC auth form submitted. Status:', oidcRes.status);
      return oidcRes.ok;
    } catch (err) {
      console.warn('[SPeCTRUM Pro] Failed to auto-submit OIDC form:', err);
      return false;
    }
  }

  // Helper: check if URL is an excluded non-resource link (like CIF course summary, avatars, UI icons)
  function isExcludedMoodleFile(url) {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase();
    return lower.includes('/course/summary/') ||
           lower.includes('/course/overviewfiles/') ||
           lower.includes('/course/section/') ||
           lower.includes('proforma') ||
           lower.includes('cif') ||
           lower.includes('maklumat_kursus') ||
           lower.includes('course_information') ||
           lower.includes('syllabus') ||
           lower.includes('/user/icon/') ||
           lower.includes('/theme/') ||
           lower.includes('/pix/') ||
           (lower.includes('/f/') && (lower.endsWith('.png') || lower.endsWith('.svg') || lower.endsWith('.gif')));
  }

  // Helper: extract direct file download link from Moodle resource wrapper page (/mod/resource/view.php)
  function extractMoodleRealFileUrl(htmlText, baseUrl) {
    if (!htmlText || typeof htmlText !== 'string') return null;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      // Specifically search inside the main content region of Moodle
      const mainRegion = doc.querySelector('#region-main, [role="main"], #content, .course-content, body');
      if (!mainRegion) return null;

      // 1. Highest priority: explicit resource containers in main region
      // Note: In Moodle, .resourceworkaround contains the actual download link (e.g. ?redirect=1 or pluginfile.php)
      const workaroundLink = mainRegion.querySelector('.resourceworkaround a, .resourcecontent a, #resourceobject a');
      if (workaroundLink) {
        const rawUrl = workaroundLink.getAttribute('href') || workaroundLink.href;
        if (rawUrl && !rawUrl.startsWith('javascript:') && rawUrl !== '#' && !isExcludedMoodleFile(rawUrl)) {
          return new URL(rawUrl, baseUrl || 'https://spectrum.um.edu.my').href;
        }
      }

      // 2. Embedded object / embed / iframe in .resourcecontent
      const embedEl = mainRegion.querySelector(
        '.resourcecontent object[data], ' +
        '.resourcecontent embed[src], ' +
        '.resourcecontent iframe[src], ' +
        '#resourceobject[data]'
      );
      if (embedEl) {
        const rawUrl = embedEl.getAttribute('data') || embedEl.getAttribute('src');
        if (rawUrl && !isExcludedMoodleFile(rawUrl)) {
          return new URL(rawUrl, baseUrl || 'https://spectrum.um.edu.my').href;
        }
      }

      // 3. Specific /mod_resource/content/ links inside main region
      const modResEl = mainRegion.querySelector(
        'a[href*="/mod_resource/content/"], ' +
        'object[data*="/mod_resource/content/"], ' +
        'embed[src*="/mod_resource/content/"], ' +
        'iframe[src*="/mod_resource/content/"]'
      );
      if (modResEl) {
        const rawUrl = modResEl.getAttribute('href') || modResEl.href || modResEl.getAttribute('data') || modResEl.getAttribute('src');
        if (rawUrl && !isExcludedMoodleFile(rawUrl)) {
          return new URL(rawUrl, baseUrl || 'https://spectrum.um.edu.my').href;
        }
      }

      // 4. Any /mod_folder/content/ link if viewing inside a folder
      const modFolderEl = mainRegion.querySelector('a[href*="/mod_folder/content/"]');
      if (modFolderEl) {
        const rawUrl = modFolderEl.getAttribute('href') || modFolderEl.href;
        if (rawUrl && !isExcludedMoodleFile(rawUrl)) {
          return new URL(rawUrl, baseUrl || 'https://spectrum.um.edu.my').href;
        }
      }
    } catch (e) {
      console.warn('[SPeCTRUM Pro] extractMoodleRealFileUrl error:', e);
    }
    return null;
  }

  // Helper: extract files from Moodle folder page (/mod/folder/view.php)
  function extractMoodleFolderFiles(htmlText, baseUrl) {
    if (!htmlText || typeof htmlText !== 'string') return [];
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      const main = doc.querySelector('#region-main, [role="main"], body');
      if (!main) return [];

      const links = Array.from(main.querySelectorAll('.fp-filename a, a[href*="/mod_folder/content/"]'));
      const results = [];
      const seen = new Set();
      links.forEach(a => {
        const href = a.href || a.getAttribute('href');
        if (href && !href.startsWith('javascript:') && !isExcludedMoodleFile(href) && !seen.has(href)) {
          seen.add(href);
          const absUrl = new URL(href, baseUrl || 'https://spectrum.um.edu.my').href;
          const name = (a.textContent || '').trim() || absUrl.split('/').pop() || 'File';
          results.push({ name, url: absUrl });
        }
      });
      return results;
    } catch (e) {
      console.warn('[SPeCTRUM Pro] extractMoodleFolderFiles error:', e);
      return [];
    }
  }

  // Rich Office Document (.pptx, .docx) Parser via JSZip
  async function parseOfficePreview(arrayBuffer, ext) {
    if (typeof JSZip === 'undefined' || !arrayBuffer) return null;
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);

      // 1. Embedded thumbnail image (PowerPoint & Word usually save docProps/thumbnail.jpeg or .png)
      const thumbFile = zip.file('docProps/thumbnail.jpeg') ||
                        zip.file('docProps/thumbnail.jpg') ||
                        zip.file('docProps/thumbnail.png');
      if (thumbFile) {
        const blob = await thumbFile.async('blob');
        const mime = thumbFile.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const thumbBlob = new Blob([blob], { type: mime });
        const thumbUrl = URL.createObjectURL(thumbBlob);
        return {
          type: 'office_image',
          src: thumbUrl,
          badge: ext ? ext.toUpperCase() : 'OFFICE'
        };
      }

      // 2. PPTX Slides Parser: count slides and extract slide texts
      if (ext === 'pptx' || zip.file('ppt/presentation.xml')) {
        const slideFiles = Object.keys(zip.files).filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k));
        const totalSlides = slideFiles.length || 1;

        // Sort slide files numerically: slide1.xml, slide2.xml, ...
        slideFiles.sort((a, b) => {
          const numA = parseInt((a.match(/slide(\d+)\.xml/i) || [])[1] || '0', 10);
          const numB = parseInt((b.match(/slide(\d+)\.xml/i) || [])[1] || '0', 10);
          return numA - numB;
        });

        const slidesData = [];
        for (let i = 0; i < slideFiles.length && i < 60; i++) {
          const sFile = zip.file(slideFiles[i]);
          if (sFile) {
            try {
              const xmlText = await sFile.async('text');
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
              const textNodes = Array.from(xmlDoc.querySelectorAll('t'));
              const allTexts = textNodes.map(n => (n.textContent || '').trim()).filter(Boolean);
              slidesData.push({
                slideIndex: i + 1,
                title: allTexts[0] || `Slide ${i + 1}`,
                points: allTexts.slice(1, 10)
              });
            } catch (slideErr) {
              // skip malformed slide
            }
          }
        }

        return {
          type: 'pptx_slides',
          totalSlides: slidesData.length || totalSlides,
          slides: slidesData,
          title: slidesData[0]?.title || 'Presentation Overview',
          points: slidesData[0]?.points || [],
          badge: 'PPTX'
        };
      }

      // 3. DOCX Document Parser: extract paragraphs from word/document.xml
      if (ext === 'docx' || zip.file('word/document.xml')) {
        const docXml = zip.file('word/document.xml');
        if (docXml) {
          const xmlText = await docXml.async('text');
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
          const paragraphs = Array.from(xmlDoc.querySelectorAll('p')).map(p => {
            return Array.from(p.querySelectorAll('t')).map(t => t.textContent || '').join('');
          }).map(p => p.trim()).filter(Boolean);

          return {
            type: 'docx_doc',
            paragraphs: paragraphs.slice(0, 12),
            badge: 'DOCX'
          };
        }
      }
    } catch (err) {
      console.warn('[SPeCTRUM Pro] Office preview parse note:', err);
    }
    return null;
  }

  async function loadMiniPreview(file) {
    const frame = document.querySelector('.insp-mini-preview-frame');
    if (!frame) return;

    // Use file.url as the primary cache key so different Moodle resource links never cross-pollinate
    const cacheKey = (file.url && file.url !== '#' && !file.url.startsWith('javascript:'))
      ? file.url
      : (file.id || `file_${Math.random()}`);
    activePreviewFileId = cacheKey;

    if (previewCache.has(cacheKey)) {
      renderCachedPreview(frame, file, previewCache.get(cacheKey));
      return;
    }

    hidePageNavControls();
    activeDocPreview = null;
    currentPreviewZoom = 1.0;
    const zoomValEl = document.getElementById('insp-zoom-val');
    if (zoomValEl) zoomValEl.textContent = '100%';
    const contentArea = document.getElementById('insp-preview-content-area') || frame;
    contentArea.innerHTML = `
      <div class="insp-preview-loading">
        <div class="insp-loading-spinner"></div>
        <div class="insp-loading-label">Loading preview...</div>
      </div>
    `;

    if (!file.url || file.url === '#' || file.url.startsWith('javascript:')) {
      renderPlaceholder(frame, file, 'No direct URL available');
      return;
    }

    let extMatch = (file.title || '').match(/\.([a-zA-Z0-9]+)$/);
    let ext = extMatch ? extMatch[1].toLowerCase() : '';

    try {
      let currentUrl = file.realDownloadUrl || file.url;
      // Proactively append &redirect=1 for Moodle resource view URLs so Moodle directly redirects to pluginfile.php
      let fetchUrl = currentUrl;
      if (fetchUrl && fetchUrl.includes('/mod/resource/view.php') && !fetchUrl.includes('redirect=1')) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'redirect=1';
      }
      let arrayBuffer = null;
      let contentType = '';

      async function doFetch(targetUrl) {
        let ab = null;
        let ct = '';
        let finalUrl = targetUrl;
        try {
          const res = await fetch(targetUrl, { credentials: 'include', redirect: 'follow' });
          if (res.ok) {
            ct = (res.headers.get('content-type') || '').toLowerCase();
            finalUrl = res.url || targetUrl;
            ab = await res.arrayBuffer();
          }
        } catch (directErr) {
          console.log('[SPeCTRUM Pro] Direct fetch failed, trying background worker:', directErr);
        }

        if (!ab) {
          const bgResp = await chrome.runtime.sendMessage({
            type: 'FETCH_FILE_PREVIEW',
            url: targetUrl
          });
          if (bgResp && bgResp.success && bgResp.dataBase64) {
            ct = (bgResp.mimeType || '').toLowerCase();
            const binaryString = atob(bgResp.dataBase64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            ab = bytes.buffer;
          }
        }
        return { arrayBuffer: ab, contentType: ct, finalUrl };
      }

      let fetchResult = await doFetch(fetchUrl);
      arrayBuffer = fetchResult.arrayBuffer;
      contentType = fetchResult.contentType;
      if (fetchResult.finalUrl && fetchResult.finalUrl.includes('pluginfile.php') && !isExcludedMoodleFile(fetchResult.finalUrl)) {
        file.realDownloadUrl = fetchResult.finalUrl;
        const inspOpenReaderBtn = document.getElementById('insp-open-reader-btn');
        if (inspOpenReaderBtn) inspOpenReaderBtn.href = fetchResult.finalUrl;
      }

      if (!ext) {
        const urlMatch = (fetchResult.finalUrl || '').match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        if (urlMatch) {
          ext = urlMatch[1].toLowerCase();
        } else if (contentType.includes('pdf')) {
          ext = 'pdf';
        } else if (contentType.includes('presentation') || contentType.includes('powerpoint')) {
          ext = 'pptx';
        } else if (contentType.includes('word') || contentType.includes('document')) {
          ext = 'docx';
        } else if (contentType.includes('zip') || contentType.includes('compressed')) {
          ext = 'zip';
        } else {
          const badge = detectFileBadge(file);
          if (badge.label && badge.label !== 'FILE') ext = badge.label.toLowerCase();
        }
      }

      if (ext) {
        file.ext = ext;
        const freshBadge = detectFileBadge(file);
        file.badge = freshBadge;
        const rowEl = document.querySelector(`.file-tree-item[data-file-id="${file.id}"]`);
        if (rowEl) {
          const badgeEl = rowEl.querySelector('.file-format-badge');
          if (badgeEl) {
            badgeEl.className = `file-format-badge ${freshBadge.cls}`;
            badgeEl.textContent = freshBadge.label;
          }
        }
      }

      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);
      const isTextExt = ['txt', 'md', 'py', 'java', 'c', 'cpp', 'js', 'css', 'json', 'sql', 'r', 'sh', 'log'].includes(ext);
      const isOffice = ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx'].includes(ext);

      // Dynamically update inspector header badge and download button text
      const inspTypeBadge = document.getElementById('insp-type-badge');
      if (inspTypeBadge && ext) inspTypeBadge.textContent = ext.toUpperCase();
      const inspDownloadText = document.getElementById('insp-download-text');
      if (inspDownloadText && ext) inspDownloadText.textContent = `Download Local Copy (.${ext})`;

      if (!arrayBuffer) {
        throw new Error('Unable to retrieve file data');
      }

      if (activePreviewFileId !== cacheKey) return;

      let uint8 = new Uint8Array(arrayBuffer);

      // Check whether response is an HTML page (SSO redirect or Moodle page)
      const firstBytesSnippet = (new TextDecoder('utf-8')).decode(uint8.subarray(0, 1000)).trim().toLowerCase();
      let isHtmlPage = contentType.includes('text/html') ||
                       firstBytesSnippet.startsWith('<!doctype') ||
                       firstBytesSnippet.startsWith('<html') ||
                       firstBytesSnippet.includes('<form method=') ||
                       firstBytesSnippet.includes('<form name=') ||
                       firstBytesSnippet.includes('<title>');

      if (isHtmlPage) {
        const fullSnippet = (new TextDecoder('utf-8')).decode(uint8.subarray(0, 32000));

        // Step A: Handle Microsoft SSO / OIDC form POST automatically
        if (fullSnippet.includes('auth/oidc') || fullSnippet.includes('hiddenform')) {
          const renewed = await submitOidcFormIfPresent(fullSnippet);
          if (renewed) {
            console.log('[SPeCTRUM Pro] Session renewed via OIDC. Retrying resource fetch...');
            fetchResult = await doFetch(currentUrl);
            if (fetchResult.arrayBuffer) {
              arrayBuffer = fetchResult.arrayBuffer;
              contentType = fetchResult.contentType;
              uint8 = new Uint8Array(arrayBuffer);
              const retrySnippet = (new TextDecoder('utf-8')).decode(uint8.subarray(0, 1000)).trim().toLowerCase();
              isHtmlPage = contentType.includes('text/html') || retrySnippet.startsWith('<!doctype') || retrySnippet.startsWith('<html');
            }
          }
        }

        // Step B: Check for Moodle Folder (/mod/folder/view.php)
        if (isHtmlPage && currentUrl.includes('/mod/folder/view.php')) {
          const folderFiles = extractMoodleFolderFiles(fullSnippet, currentUrl);
          if (folderFiles.length === 1) {
            // Exactly 1 file in folder: preview it directly!
            currentUrl = folderFiles[0].url;
            file.realDownloadUrl = currentUrl;
            fetchResult = await doFetch(currentUrl);
            if (fetchResult.arrayBuffer) {
              arrayBuffer = fetchResult.arrayBuffer;
              contentType = fetchResult.contentType;
              uint8 = new Uint8Array(arrayBuffer);
              const retrySnippet = (new TextDecoder('utf-8')).decode(uint8.subarray(0, 1000)).trim().toLowerCase();
              isHtmlPage = contentType.includes('text/html') || retrySnippet.startsWith('<!doctype') || retrySnippet.startsWith('<html');
            }
          } else if (folderFiles.length > 1) {
            renderFolderPreview(frame, file, folderFiles);
            previewCache.set(cacheKey, { type: 'folder_list', folderFiles });
            return;
          }
        }

        // Step C: Resolve Moodle /mod/resource/view.php wrapper to direct pluginfile.php URL
        if (isHtmlPage) {
          const latestSnippet = (new TextDecoder('utf-8')).decode(uint8.subarray(0, 32000));
          const realFileUrl = extractMoodleRealFileUrl(latestSnippet, currentUrl);
          if (realFileUrl && realFileUrl !== currentUrl) {
            console.log('[SPeCTRUM Pro] Resolved Moodle wrapper to real file URL:', realFileUrl);
            file.realDownloadUrl = realFileUrl;
            const inspOpenReaderBtn = document.getElementById('insp-open-reader-btn');
            if (inspOpenReaderBtn) inspOpenReaderBtn.href = realFileUrl;

            fetchResult = await doFetch(realFileUrl);
            if (fetchResult.arrayBuffer) {
              arrayBuffer = fetchResult.arrayBuffer;
              contentType = fetchResult.contentType;
              uint8 = new Uint8Array(arrayBuffer);
              const recheckSnippet = (new TextDecoder('utf-8')).decode(uint8.subarray(0, 1000)).trim().toLowerCase();
              isHtmlPage = contentType.includes('text/html') || recheckSnippet.startsWith('<!doctype') || recheckSnippet.startsWith('<html');
            }
          }
        }
      }

      if (activePreviewFileId !== cacheKey) return;

      // 1. PDF Preview: Check magic bytes '%PDF-' [0x25, 0x50, 0x44, 0x46, 0x2D]
      const hasPdfMagic = uint8.length >= 5 && uint8[0] === 0x25 && uint8[1] === 0x50 && uint8[2] === 0x44 && uint8[3] === 0x46;
      const isPdf = hasPdfMagic || (!isHtmlPage && (contentType.includes('application/pdf') || ext === 'pdf'));

      if (isPdf && hasPdfMagic) {
        if (typeof pdfjsLib === 'undefined') {
          throw new Error('PDF.js not available');
        }

        const loadingTask = pdfjsLib.getDocument({ data: uint8 });
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;

        if (activePreviewFileId !== cacheKey) return;

        activeDocPreview = {
          fileId: cacheKey,
          type: 'pdf',
          pdfDoc: pdf,
          pptxData: null,
          numPages: numPages,
          currentPage: 1,
          file: file,
          isRendering: false,
          pendingPageNum: null
        };

        previewCache.set(cacheKey, {
          type: 'pdf',
          pdfDoc: pdf,
          numPages: numPages,
          realDownloadUrl: file.realDownloadUrl || file.url
        });

        await renderPdfDocPage(1);
        return;
      }

      // 2. Image Preview
      if ((isImage || contentType.startsWith('image/')) && !isHtmlPage) {
        hidePageNavControls();
        activeDocPreview = null;
        const contentArea = document.getElementById('insp-preview-content-area') || frame;
        const blob = new Blob([arrayBuffer], { type: contentType || 'image/png' });
        const blobUrl = URL.createObjectURL(blob);
        contentArea.innerHTML = '';
        const img = document.createElement('img');
        img.className = 'insp-preview-img';
        img.src = blobUrl;
        img.alt = file.title;
        img.title = 'Click to open full image';
        img.onclick = () => window.open(file.realDownloadUrl || file.url, '_blank');
        contentArea.appendChild(img);
        previewCache.set(cacheKey, { type: 'image', src: blobUrl, realDownloadUrl: file.realDownloadUrl || file.url });
        return;
      }

      // 3. Office Document Preview (.pptx, .docx via JSZip)
      const isZipMagic = uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4B && uint8[2] === 0x03 && uint8[3] === 0x04;
      if ((isOffice || isZipMagic) && !isHtmlPage) {
        const officeData = await parseOfficePreview(arrayBuffer, ext);
        if (officeData) {
          if (activePreviewFileId !== cacheKey) return;
          const cachedOfficeData = { ...officeData, realDownloadUrl: file.realDownloadUrl || file.url };

          if (officeData.type === 'office_image') {
            hidePageNavControls();
            activeDocPreview = null;
            const contentArea = document.getElementById('insp-preview-content-area') || frame;
            contentArea.innerHTML = '';
            const wrap = document.createElement('div');
            wrap.className = 'insp-canvas-wrap';
            wrap.title = 'Click to open full presentation in new tab';
            const img = document.createElement('img');
            img.className = 'insp-preview-img';
            img.src = officeData.src;
            img.alt = file.title;
            wrap.appendChild(img);

            const pill = document.createElement('div');
            pill.className = 'insp-preview-page-pill';
            pill.textContent = `📊 ${officeData.badge || 'Slide 1'}`;
            wrap.appendChild(pill);

            wrap.onclick = () => window.open(file.realDownloadUrl || file.url, '_blank');
            contentArea.appendChild(wrap);
            previewCache.set(cacheKey, cachedOfficeData);
            return;
          }

          if (officeData.type === 'pptx_slides') {
            activeDocPreview = {
              fileId: cacheKey,
              type: 'pptx',
              pdfDoc: null,
              pptxData: officeData,
              numPages: officeData.totalSlides || (officeData.slides && officeData.slides.length) || 1,
              currentPage: 1,
              file: file
            };
            renderPptxSlidePage(1);
            previewCache.set(cacheKey, cachedOfficeData);
            return;
          }

          if (officeData.type === 'docx_doc') {
            hidePageNavControls();
            activeDocPreview = null;
            renderDocCard(frame, file, officeData);
            previewCache.set(cacheKey, cachedOfficeData);
            return;
          }
        }
      }

      // 4. Plaintext / Source Code Preview
      if (isTextExt && !isHtmlPage) {
        hidePageNavControls();
        activeDocPreview = null;
        const textDecoder = new TextDecoder('utf-8');
        const decodedText = textDecoder.decode(uint8.subarray(0, 4000));
        const previewSlice = decodedText.slice(0, 1000);
        const contentArea = document.getElementById('insp-preview-content-area') || frame;
        contentArea.innerHTML = '';
        const textDiv = document.createElement('div');
        textDiv.className = 'insp-preview-text';
        textDiv.textContent = previewSlice;
        textDiv.title = 'Click to open file in new tab';
        textDiv.onclick = () => window.open(file.realDownloadUrl || file.url, '_blank');
        contentArea.appendChild(textDiv);
        previewCache.set(cacheKey, { type: 'text', text: previewSlice, realDownloadUrl: file.realDownloadUrl || file.url });
        return;
      }

      // 5. Fallback for unauthenticated or non-previewable files
      if (isHtmlPage) {
        renderPlaceholder(frame, file, 'Click Full Reader to open directly in SPeCTRUM');
        return;
      }

      renderPlaceholder(frame, file, isOffice ? 'Click Full Reader to download or view' : 'Document');
    } catch (err) {
      console.warn('Mini preview failed:', err);
      if (activePreviewFileId === cacheKey) {
        renderPlaceholder(frame, file, 'Click Full Reader to open in SPeCTRUM');
      }
    }
  }

  // --- Multi-Page Document Preview Rendering & Controls ---
  async function renderPdfDocPage(pageNum) {
    if (!activeDocPreview || !activeDocPreview.pdfDoc) return;
    const numPages = activeDocPreview.numPages || 1;
    pageNum = Math.max(1, Math.min(pageNum, numPages));
    activeDocPreview.currentPage = pageNum;

    const frame = document.querySelector('.insp-mini-preview-frame');
    if (!frame) return;
    const contentArea = document.getElementById('insp-preview-content-area') || frame;

    updatePageNavControls(pageNum, numPages);

    if (activeDocPreview.isRendering) {
      activeDocPreview.pendingPageNum = pageNum;
      return;
    }
    activeDocPreview.isRendering = true;

    try {
      const page = await activeDocPreview.pdfDoc.getPage(pageNum);
      const rect = frame.getBoundingClientRect();
      const frameWidth = (rect.width && rect.width > 50) ? rect.width : (frame.clientWidth || 400);
      const frameHeight = (rect.height && rect.height > 50) ? rect.height : (frame.clientHeight || 450);

      const unscaledViewport = page.getViewport({ scale: 1 });
      const padX = 24;
      const padY = numPages > 1 ? 52 : 24;
      const scaleX = (frameWidth - padX) / unscaledViewport.width;
      const scaleY = (frameHeight - padY) / unscaledViewport.height;
      const fitScale = Math.min(scaleX, scaleY);
      const zoomFactor = (typeof currentPreviewZoom === 'number' && currentPreviewZoom > 0) ? currentPreviewZoom : 1.0;
      const displayScale = Math.max(fitScale, 0.35) * zoomFactor;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const renderViewport = page.getViewport({ scale: displayScale * dpr });

      const canvas = document.createElement('canvas');
      canvas.className = 'insp-preview-canvas';
      if (zoomFactor > 1.0) {
        canvas.classList.add('is-zoomed');
      }
      const context = canvas.getContext('2d');
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      const cssW = Math.floor(renderViewport.width / dpr);
      const cssH = Math.floor(renderViewport.height / dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      await page.render({
        canvasContext: context,
        viewport: renderViewport
      }).promise;

      if (!activeDocPreview || activeDocPreview.currentPage !== pageNum) {
        return;
      }

      contentArea.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'insp-canvas-wrap';
      wrap.title = 'Click to open document in new tab';
      wrap.appendChild(canvas);

      if (numPages > 1) {
        const pill = document.createElement('div');
        pill.className = 'insp-preview-page-pill';
        pill.textContent = `${pageNum} / ${numPages} pgs`;
        wrap.appendChild(pill);
      }

      wrap.onclick = (e) => {
        if (e.target.closest('.insp-page-nav-bar') || e.target.closest('.insp-side-nav-btn')) return;
        window.open(activeDocPreview.file.realDownloadUrl || activeDocPreview.file.url, '_blank');
      };

      contentArea.appendChild(wrap);
    } catch (err) {
      console.warn('[SPeCTRUM Pro] renderPdfDocPage error:', err);
    } finally {
      if (activeDocPreview) {
        activeDocPreview.isRendering = false;
        if (activeDocPreview.pendingPageNum && activeDocPreview.pendingPageNum !== pageNum) {
          const nextP = activeDocPreview.pendingPageNum;
          activeDocPreview.pendingPageNum = null;
          renderPdfDocPage(nextP);
        }
      }
    }
  }

  function renderPptxSlidePage(slideNum) {
    if (!activeDocPreview || !activeDocPreview.pptxData) return;
    const slides = activeDocPreview.pptxData.slides || [];
    const totalSlides = activeDocPreview.numPages || slides.length || 1;
    slideNum = Math.max(1, Math.min(slideNum, totalSlides));
    activeDocPreview.currentPage = slideNum;

    updatePageNavControls(slideNum, totalSlides);

    const frame = document.querySelector('.insp-mini-preview-frame');
    if (!frame) return;
    const contentArea = document.getElementById('insp-preview-content-area') || frame;

    const currentSlide = slides[slideNum - 1] || {
      slideIndex: slideNum,
      title: `Slide ${slideNum}`,
      points: []
    };

    contentArea.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'insp-slide-preview-box';
    const pointsList = (currentSlide.points || []).map(pt => `<li>${escapeHtml(pt)}</li>`).join('');
    box.innerHTML = `
      <div class="insp-slide-preview-header">
        <span class="insp-slide-badge">📊 PPTX</span>
        <span class="insp-slide-count-pill">Slide ${slideNum} of ${totalSlides}</span>
      </div>
      <div class="insp-slide-title">${escapeHtml(currentSlide.title || `Slide ${slideNum}`)}</div>
      ${pointsList ? `<ul class="insp-slide-points">${pointsList}</ul>` : `<div style="font-size:11px;color:var(--text-muted);font-style:italic;">Slide overview available. Click Full Reader to download or view all slides.</div>`}
    `;
    box.onclick = (e) => {
      if (e.target.closest('.insp-page-nav-bar') || e.target.closest('.insp-side-nav-btn')) return;
      window.open(activeDocPreview.file.realDownloadUrl || activeDocPreview.file.url, '_blank');
    };
    contentArea.appendChild(box);
  }

  function goToDocPage(pageNum) {
    if (!activeDocPreview) return;
    const numPages = activeDocPreview.numPages || 1;
    if (pageNum < 1 || pageNum > numPages) return;
    if (activeDocPreview.type === 'pdf') {
      renderPdfDocPage(pageNum);
    } else if (activeDocPreview.type === 'pptx') {
      renderPptxSlidePage(pageNum);
    }
  }

  function updatePageNavControls(pageNum, totalPages) {
    const counter = document.getElementById('insp-page-counter');
    const prevBtn = document.getElementById('insp-page-prev-btn');
    const nextBtn = document.getElementById('insp-page-next-btn');
    const sidePrev = document.getElementById('insp-side-prev-btn');
    const sideNext = document.getElementById('insp-side-next-btn');
    const navBar = document.getElementById('insp-page-nav-bar');

    if (totalPages > 1) {
      if (navBar) navBar.style.display = 'flex';
      if (sidePrev) sidePrev.style.display = 'flex';
      if (sideNext) sideNext.style.display = 'flex';

      const label = (activeDocPreview && activeDocPreview.type === 'pptx') ? 'slides' : 'pgs';
      if (counter) counter.textContent = `${pageNum} / ${totalPages} ${label}`;

      if (prevBtn) prevBtn.disabled = (pageNum <= 1);
      if (nextBtn) nextBtn.disabled = (pageNum >= totalPages);
      if (sidePrev) sidePrev.disabled = (pageNum <= 1);
      if (sideNext) sideNext.disabled = (pageNum >= totalPages);
    } else {
      if (navBar) navBar.style.display = 'none';
      if (sidePrev) sidePrev.style.display = 'none';
      if (sideNext) sideNext.style.display = 'none';
    }
  }

  function hidePageNavControls() {
    const navBar = document.getElementById('insp-page-nav-bar');
    const sidePrev = document.getElementById('insp-side-prev-btn');
    const sideNext = document.getElementById('insp-side-next-btn');
    if (navBar) navBar.style.display = 'none';
    if (sidePrev) sidePrev.style.display = 'none';
    if (sideNext) sideNext.style.display = 'none';
  }

  let pageNavListenersInitialized = false;
  function initPageNavControls() {
    if (pageNavListenersInitialized) return;
    pageNavListenersInitialized = true;

    const btnPrevPage = document.getElementById('insp-page-prev-btn');
    const btnNextPage = document.getElementById('insp-page-next-btn');
    const btnSidePrev = document.getElementById('insp-side-prev-btn');
    const btnSideNext = document.getElementById('insp-side-next-btn');

    if (btnPrevPage) {
      btnPrevPage.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeDocPreview) goToDocPage(activeDocPreview.currentPage - 1);
      });
    }
    if (btnNextPage) {
      btnNextPage.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeDocPreview) goToDocPage(activeDocPreview.currentPage + 1);
      });
    }
    if (btnSidePrev) {
      btnSidePrev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeDocPreview) goToDocPage(activeDocPreview.currentPage - 1);
      });
    }
    if (btnSideNext) {
      btnSideNext.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeDocPreview) goToDocPage(activeDocPreview.currentPage + 1);
      });
    }

    // Keyboard listener: Left and Right Arrow keys or PageUp/PageDown
    window.addEventListener('keydown', (e) => {
      if (!fileInspectorPane || fileInspectorPane.style.display === 'none') return;
      if (!activeDocPreview || (activeDocPreview.numPages || 1) <= 1) return;

      const activeTag = (document.activeElement && document.activeElement.tagName) || '';
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToDocPage(activeDocPreview.currentPage - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToDocPage(activeDocPreview.currentPage + 1);
      }
    });
  }

  // --- Preview Zoom & Frame Expand Controls ---
  let currentPreviewZoom = 1.0;
  const ZOOM_LEVELS = [0.5, 0.7, 0.85, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

  function applyPreviewZoom(newZoom) {
    newZoom = Math.max(0.5, Math.min(2.5, Math.round(newZoom * 100) / 100));
    currentPreviewZoom = newZoom;

    // Update UI badge
    const zoomValEl = document.getElementById('insp-zoom-val');
    if (zoomValEl) {
      zoomValEl.textContent = `${Math.round(currentPreviewZoom * 100)}%`;
    }

    const zoomOutBtn = document.getElementById('insp-zoom-out-btn');
    const zoomInBtn = document.getElementById('insp-zoom-in-btn');
    if (zoomOutBtn) zoomOutBtn.disabled = currentPreviewZoom <= 0.5;
    if (zoomInBtn) zoomInBtn.disabled = currentPreviewZoom >= 2.5;

    // Apply to active preview
    if (activeDocPreview && activeDocPreview.type === 'pdf') {
      renderPdfDocPage(activeDocPreview.currentPage || 1);
    } else {
      const canvas = document.querySelector('.insp-preview-canvas');
      if (canvas) {
        canvas.style.transform = `scale(${currentPreviewZoom})`;
        canvas.style.transformOrigin = 'center center';
        if (currentPreviewZoom > 1.0) canvas.classList.add('is-zoomed');
        else canvas.classList.remove('is-zoomed');
      }
      const img = document.getElementById('insp-preview-img');
      if (img && img.style.display !== 'none') {
        img.style.transform = `scale(${currentPreviewZoom})`;
        img.style.transformOrigin = 'center center';
      }
      const box = document.querySelector('.insp-slide-preview-box') || document.getElementById('insp-preview-text');
      if (box) {
        box.style.transform = `scale(${currentPreviewZoom})`;
        box.style.transformOrigin = 'top center';
      }
    }
  }

  function zoomInPreview() {
    const next = ZOOM_LEVELS.find(z => z > currentPreviewZoom + 0.02);
    applyPreviewZoom(next || Math.min(2.5, currentPreviewZoom + 0.25));
  }

  function zoomOutPreview() {
    const prev = [...ZOOM_LEVELS].reverse().find(z => z < currentPreviewZoom - 0.02);
    applyPreviewZoom(prev || Math.max(0.5, currentPreviewZoom - 0.25));
  }

  function resetPreviewZoom() {
    applyPreviewZoom(1.0);
  }

  let isPreviewFrameMaximized = false;
  function togglePreviewFrameExpand() {
    const pane = document.getElementById('file-inspector-pane');
    const expandBtn = document.getElementById('insp-frame-expand-btn');
    const maxIcon = document.getElementById('insp-expand-icon-max');
    const restoreIcon = document.getElementById('insp-expand-icon-restore');
    if (!pane) return;

    isPreviewFrameMaximized = !isPreviewFrameMaximized;
    pane.classList.toggle('is-preview-maximized', isPreviewFrameMaximized);

    if (expandBtn) {
      expandBtn.classList.toggle('is-expanded', isPreviewFrameMaximized);
      expandBtn.title = isPreviewFrameMaximized ? 'Restore Preview Layout' : 'Maximize Preview Area';
    }
    if (maxIcon) maxIcon.style.display = isPreviewFrameMaximized ? 'none' : 'block';
    if (restoreIcon) restoreIcon.style.display = isPreviewFrameMaximized ? 'block' : 'none';

    // If inspector pane is narrow, also expand the layout width for maximum comfort
    const layout = document.querySelector('.materials-workspace-layout');
    if (isPreviewFrameMaximized && layout) {
      const currentW = pane.offsetWidth;
      const targetW = Math.round(layout.clientWidth * 0.60);
      if (currentW < targetW) {
        layout.style.setProperty('--inspector-width', `${targetW}px`);
      }
    }

    // Re-render PDF to fit sharp dimensions
    if (activeDocPreview && activeDocPreview.type === 'pdf') {
      setTimeout(() => {
        renderPdfDocPage(activeDocPreview.currentPage || 1);
      }, 50);
    }
  }

  let previewZoomInitialized = false;
  function initPreviewZoomControls() {
    if (previewZoomInitialized) return;
    previewZoomInitialized = true;

    const btnZoomOut = document.getElementById('insp-zoom-out-btn');
    const btnZoomIn = document.getElementById('insp-zoom-in-btn');
    const btnZoomReset = document.getElementById('insp-zoom-reset-btn');
    const btnFrameExpand = document.getElementById('insp-frame-expand-btn');

    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zoomOutPreview();
      });
    }

    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zoomInPreview();
      });
    }

    if (btnZoomReset) {
      btnZoomReset.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetPreviewZoom();
      });
    }

    if (btnFrameExpand) {
      btnFrameExpand.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePreviewFrameExpand();
      });
    }

    // Keyboard shortcuts when inspector is open:
    // + / =: zoom in
    // - / _: zoom out
    // 0: reset zoom
    window.addEventListener('keydown', (e) => {
      const pane = document.getElementById('file-inspector-pane');
      if (!pane || pane.style.display === 'none') return;

      const activeTag = (document.activeElement && document.activeElement.tagName) || '';
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) {
        return;
      }

      if (e.key === '+' || e.key === '=' || (e.ctrlKey && (e.key === '+' || e.key === '='))) {
        e.preventDefault();
        zoomInPreview();
      } else if (e.key === '-' || e.key === '_' || (e.ctrlKey && (e.key === '-' || e.key === '_'))) {
        e.preventDefault();
        zoomOutPreview();
      } else if (e.key === '0' || (e.ctrlKey && e.key === '0')) {
        e.preventDefault();
        resetPreviewZoom();
      }
    });
  }

  // --- Draggable Splitter & 50% Expand Resizer ---
  let inspectorResizerInitialized = false;
  function initInspectorResizer() {
    if (inspectorResizerInitialized) return;
    inspectorResizerInitialized = true;

    const resizer = document.getElementById('inspector-resizer');
    const pane = document.getElementById('file-inspector-pane');
    const layout = document.querySelector('.materials-workspace-layout');
    const btnExpand = document.getElementById('btn-toggle-expand-inspector');

    if (!resizer || !pane || !layout) return;

    // Restore saved width if available
    const savedWidthStr = localStorage.getItem('spectrum_inspector_width');
    if (savedWidthStr) {
      const savedWidth = parseInt(savedWidthStr, 10);
      if (savedWidth && savedWidth >= 320 && savedWidth <= 1600) {
        layout.style.setProperty('--inspector-width', `${savedWidth}px`);
        if (btnExpand) {
          const isNearHalf = (savedWidth / (layout.clientWidth || 1000)) >= 0.46;
          btnExpand.classList.toggle('is-expanded', isNearHalf);
        }
      }
    }

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left-click
      isDragging = true;
      startX = e.clientX;
      startWidth = pane.offsetWidth;

      document.body.classList.add('is-inspector-dragging');
      layout.classList.add('is-resizing-active');
      resizer.classList.add('is-active');

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const containerRect = layout.getBoundingClientRect();
        // Since inspector is on the right, dragging left increases width
        let newWidth = containerRect.right - ev.clientX;
        const minW = 320;
        const maxW = Math.max(minW, containerRect.width - 240);
        newWidth = Math.max(minW, Math.min(newWidth, maxW));

        layout.style.setProperty('--inspector-width', `${newWidth}px`);

        if (btnExpand) {
          const isNearHalf = (newWidth / containerRect.width) >= 0.46;
          btnExpand.classList.toggle('is-expanded', isNearHalf);
        }
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove('is-inspector-dragging');
        layout.classList.remove('is-resizing-active');
        resizer.classList.remove('is-active');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const currentW = pane.offsetWidth;
        localStorage.setItem('spectrum_inspector_width', String(currentW));

        // Re-render PDF page at sharp new canvas dimensions
        if (activeDocPreview && activeDocPreview.type === 'pdf') {
          renderPdfDocPage(activeDocPreview.currentPage);
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });

    // Double-click on resizer: toggle between 50% split view and default 480px
    resizer.addEventListener('dblclick', () => {
      toggleInspectorExpand();
    });

    // Click on Expand toggle button in inspector header:
    if (btnExpand) {
      btnExpand.addEventListener('click', () => {
        toggleInspectorExpand();
      });
    }

    function toggleInspectorExpand() {
      const containerWidth = layout.clientWidth;
      const currentWidth = pane.offsetWidth;
      const halfWidth = Math.round(containerWidth * 0.50);
      const isCurrentlyExpanded = Math.abs(currentWidth - halfWidth) < 35 || currentWidth >= halfWidth - 20;

      let targetWidth = 480;
      if (!isCurrentlyExpanded) {
        targetWidth = halfWidth;
        if (btnExpand) btnExpand.classList.add('is-expanded');
      } else {
        targetWidth = 480;
        if (btnExpand) btnExpand.classList.remove('is-expanded');
      }

      layout.style.setProperty('--inspector-width', `${targetWidth}px`);
      localStorage.setItem('spectrum_inspector_width', String(targetWidth));

      setTimeout(() => {
        if (activeDocPreview && activeDocPreview.type === 'pdf') {
          renderPdfDocPage(activeDocPreview.currentPage);
        }
      }, 200);
    }
  }

  function renderSlideCard(frame, file, data) {
    if (data.slides && data.slides.length > 0) {
      activeDocPreview = {
        fileId: file.url || file.id,
        type: 'pptx',
        pdfDoc: null,
        pptxData: data,
        numPages: data.totalSlides || data.slides.length || 1,
        currentPage: 1,
        file: file
      };
      renderPptxSlidePage(1);
      return;
    }
    hidePageNavControls();
    const contentArea = document.getElementById('insp-preview-content-area') || frame;
    contentArea.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'insp-slide-preview-box';
    const pointsList = (data.points || []).map(pt => `<li>${escapeHtml(pt)}</li>`).join('');
    box.innerHTML = `
      <div class="insp-slide-preview-header">
        <span class="insp-slide-badge">📊 ${escapeHtml(data.badge || 'PPTX')}</span>
        <span class="insp-slide-count-pill">${data.totalSlides} Slides</span>
      </div>
      <div class="insp-slide-title">${escapeHtml(data.title || file.title || 'Slide 1')}</div>
      ${pointsList ? `<ul class="insp-slide-points">${pointsList}</ul>` : `<div style="font-size:11px;color:var(--text-muted);font-style:italic;">Slide overview available. Click Full Reader to download or view all slides.</div>`}
    `;
    box.onclick = () => window.open(file.realDownloadUrl || file.url, '_blank');
    contentArea.appendChild(box);
  }

  function renderDocCard(frame, file, data) {
    hidePageNavControls();
    const contentArea = document.getElementById('insp-preview-content-area') || frame;
    contentArea.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'insp-doc-preview-box';
    const paragraphsHtml = (data.paragraphs || []).map(p => `<p class="insp-doc-p">${escapeHtml(p)}</p>`).join('');
    box.innerHTML = `
      <div class="insp-slide-preview-header">
        <span class="insp-slide-badge" style="color:#2563EB;background:#EFF6FF;border-color:rgba(37,99,235,0.25);">📄 ${escapeHtml(data.badge || 'DOCX')}</span>
        <span class="insp-slide-count-pill">Word Document</span>
      </div>
      ${paragraphsHtml || `<div style="font-size:11px;color:var(--text-muted);font-style:italic;">Click Full Reader to view document.</div>`}
    `;
    box.onclick = () => window.open(file.realDownloadUrl || file.url, '_blank');
    contentArea.appendChild(box);
  }

  function renderFolderPreview(frame, file, folderFiles) {
    hidePageNavControls();
    const contentArea = document.getElementById('insp-preview-content-area') || frame;
    contentArea.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'insp-folder-preview-box';
    box.innerHTML = `
      <div class="insp-folder-header">📁 Folder Files (${folderFiles.length})</div>
      ${folderFiles.map(ff => `
        <div class="insp-folder-item">
          <span class="insp-folder-item-name" title="${escapeHtml(ff.name)}">${escapeHtml(ff.name)}</span>
          <a href="${escapeHtml(ff.url)}" target="_blank" class="insp-folder-item-btn">Open ↗</a>
        </div>
      `).join('')}
    `;
    contentArea.appendChild(box);
  }

  function renderCachedPreview(frame, file, cached) {
    if (cached && cached.realDownloadUrl && !file.realDownloadUrl) {
      file.realDownloadUrl = cached.realDownloadUrl;
    }
    const inspOpenReaderBtn = document.getElementById('insp-open-reader-btn');
    if (inspOpenReaderBtn) {
      inspOpenReaderBtn.href = file.realDownloadUrl || file.url || '#';
    }
    const openUrl = file.realDownloadUrl || file.url;

    if (cached.type === 'pdf' && cached.pdfDoc) {
      activeDocPreview = {
        fileId: file.url || file.id,
        type: 'pdf',
        pdfDoc: cached.pdfDoc,
        pptxData: null,
        numPages: cached.numPages,
        currentPage: 1,
        file: file,
        isRendering: false,
        pendingPageNum: null
      };
      renderPdfDocPage(1);
      return;
    } else if (cached.type === 'pdf' && cached.canvas) {
      hidePageNavControls();
      const contentArea = document.getElementById('insp-preview-content-area') || frame;
      contentArea.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'insp-canvas-wrap';
      wrap.title = 'Click to open document in new tab';
      wrap.appendChild(cached.canvas);
      if (cached.numPages > 1) {
        const pill = document.createElement('div');
        pill.className = 'insp-preview-page-pill';
        pill.textContent = `1 / ${cached.numPages} pgs`;
        wrap.appendChild(pill);
      }
      wrap.onclick = () => window.open(openUrl, '_blank');
      contentArea.appendChild(wrap);
    } else if (cached.type === 'pptx_slides' && cached.slides && cached.slides.length > 0) {
      activeDocPreview = {
        fileId: file.url || file.id,
        type: 'pptx',
        pdfDoc: null,
        pptxData: cached,
        numPages: cached.totalSlides || cached.slides.length || 1,
        currentPage: 1,
        file: file
      };
      renderPptxSlidePage(1);
      return;
    } else if (cached.type === 'image' || cached.type === 'office_image') {
      hidePageNavControls();
      const contentArea = document.getElementById('insp-preview-content-area') || frame;
      contentArea.innerHTML = '';
      const img = document.createElement('img');
      img.className = 'insp-preview-img';
      img.src = cached.src;
      img.onclick = () => window.open(openUrl, '_blank');
      contentArea.appendChild(img);
    } else if (cached.type === 'pptx_slides') {
      hidePageNavControls();
      renderSlideCard(frame, file, cached);
    } else if (cached.type === 'docx_doc') {
      hidePageNavControls();
      renderDocCard(frame, file, cached);
    } else if (cached.type === 'folder_list') {
      hidePageNavControls();
      renderFolderPreview(frame, file, cached.folderFiles || []);
    } else if (cached.type === 'text') {
      hidePageNavControls();
      const contentArea = document.getElementById('insp-preview-content-area') || frame;
      contentArea.innerHTML = '';
      const textDiv = document.createElement('div');
      textDiv.className = 'insp-preview-text';
      textDiv.textContent = cached.text;
      textDiv.onclick = () => window.open(openUrl, '_blank');
      contentArea.appendChild(textDiv);
    } else {
      hidePageNavControls();
      renderPlaceholder(frame, file, 'Course Material');
    }
  }

  function renderPlaceholder(frame, file, note) {
    hidePageNavControls();
    activeDocPreview = null;
    const contentArea = document.getElementById('insp-preview-content-area') || frame;
    const extMatch = (file.title || '').match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toUpperCase() : 'FILE';
    contentArea.innerHTML = `
      <div class="insp-preview-placeholder" style="cursor: pointer;" title="Click to open file in new tab">
        <span class="insp-placeholder-badge">${ext}</span>
        <div style="font-size: 26px; margin-bottom: 6px;">📄</div>
        <div style="font-size: 11.5px; font-weight: 700; color: var(--text-primary); margin-bottom: 3px;">Document Preview</div>
        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 8px;">${note || 'Click Full Reader to view entire document'}</div>
      </div>
    `;
    const placeholder = contentArea.querySelector('.insp-preview-placeholder');
    if (placeholder && file.url && file.url !== '#') {
      placeholder.onclick = () => window.open(file.realDownloadUrl || file.url, '_blank');
    }
  }

  function openFileInspector(file, course) {
    if (!fileInspectorPane) return;
    currentInspectedFile = { file, course };

    document.querySelectorAll('.file-tree-item').forEach(el => el.classList.remove('inspect-active'));
    const rowEl = document.querySelector(`.file-tree-item[data-file-id="${file.id}"]`);
    if (rowEl) rowEl.classList.add('inspect-active');

    const badge = detectFileBadge(file.title, file.url);

    const inspTypeBadge = document.getElementById('insp-type-badge');
    if (inspTypeBadge) {
      inspTypeBadge.textContent = badge.label || 'DOCUMENT';
    }

    const inspOpenReaderBtn = document.getElementById('insp-open-reader-btn');
    if (inspOpenReaderBtn) {
      inspOpenReaderBtn.href = file.url || '#';
    }

    // In the blue card, only show course name and file name:
    const inspSlideSubject = document.getElementById('insp-slide-subject');
    if (inspSlideSubject) {
      const courseName = (course.code ? `${course.code} · ` : '') + (course.title || course.name || '');
      inspSlideSubject.textContent = courseName || 'COURSE MATERIAL';
    }

    const inspSlideHeading = document.getElementById('insp-slide-heading');
    if (inspSlideHeading) {
      inspSlideHeading.textContent = file.title || 'Course Material';
    }

    // Preview tab & Full Reader
    const inspPreviewFilename = document.getElementById('insp-preview-filename');
    if (inspPreviewFilename) {
      inspPreviewFilename.textContent = file.title || 'Document Preview';
    }

    // Download button: keep only download button
    const inspDownloadText = document.getElementById('insp-download-text');
    if (inspDownloadText) {
      const extMatch = (file.title || '').match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0].toLowerCase() : '';
      inspDownloadText.textContent = ext ? `Download Local Copy (${ext})` : 'Download File';
    }

    fileInspectorPane.style.display = 'flex';
    const inspectorResizer = document.getElementById('inspector-resizer');
    if (inspectorResizer) {
      inspectorResizer.style.display = 'flex';
    }

    // Load rich mini preview via PDF.js or Image/Text (after pane is visible so clientHeight is measured accurately)
    loadMiniPreview(file);
  }

  const btnCloseInspector = document.getElementById('btn-close-inspector');
  if (btnCloseInspector) {
    btnCloseInspector.addEventListener('click', () => {
      if (fileInspectorPane) fileInspectorPane.style.display = 'none';
      const inspectorResizer = document.getElementById('inspector-resizer');
      if (inspectorResizer) inspectorResizer.style.display = 'none';
      document.querySelectorAll('.file-tree-item.inspect-active').forEach(el => el.classList.remove('inspect-active'));
      activeDocPreview = null;
      hidePageNavControls();
    });
  }

  const inspDownloadFileBtn = document.getElementById('insp-download-file-btn');
  if (inspDownloadFileBtn) {
    inspDownloadFileBtn.addEventListener('click', () => {
      if (currentInspectedFile) {
        downloadSingleFile(currentInspectedFile.file, currentInspectedFile.course);
      }
    });
  }

  // Initialize inspector resizer & page navigation controls
  initInspectorResizer();
  initPageNavControls();
  initPreviewZoomControls();

  // 4. Single File & Course Pack Downloader
  async function downloadSingleFile(file, course) {
    const courseCodeClean = sanitizeFilename(course.code || 'Course');

    // Visual loading state on the button
    const dlBtns = document.querySelectorAll(`.btn-single-download[data-file-id="${file.id}"]`);
    const inspDlText = document.getElementById('insp-download-text');
    const prevInspText = inspDlText ? inspDlText.textContent : '';
    if (inspDlText) inspDlText.textContent = 'Downloading...';
    dlBtns.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    });

    try {
      const currentPrefs = await chrome.storage.local.get(defaultSettings);
      const allowedExts = currentPrefs.extensions || defaultSettings.extensions;

      let targetUrl = file.realDownloadUrl || file.url;
      const fileData = await fetchFileWithRedirect(targetUrl, file.title, allowedExts);

      if (fileData && fileData.blob) {
        let finalFilename = fileData.filename;

        // Ensure extension is present
        if (!/\.[a-zA-Z0-9]{2,5}$/.test(finalFilename)) {
          const badge = detectFileBadge(file.title, targetUrl);
          const ext = badge.label && badge.label !== 'FILE' ? `.${badge.label.toLowerCase()}` : '.pdf';
          finalFilename = `${sanitizeFilename(file.title)}${ext}`;
        }

        const blobUrl = URL.createObjectURL(fileData.blob);
        const destinationPath = `${courseCodeClean}/${finalFilename}`;

        if (chrome.downloads && chrome.downloads.download) {
          chrome.downloads.download({
            url: blobUrl,
            filename: destinationPath,
            saveAs: false
          }, () => {
            setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
          });
        } else {
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = finalFilename;
          a.click();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        }

        if (inspDlText) inspDlText.textContent = '✔ Downloaded!';
        dlBtns.forEach(btn => {
          btn.style.opacity = '1';
          btn.innerHTML = `<svg class="icon-svg" viewBox="0 0 24 24" style="width:13px;height:13px;stroke:#16A34A;"><polyline points="20 6 9 17 4 12"/></svg>`;
        });
        setTimeout(() => {
          dlBtns.forEach(btn => {
            btn.disabled = false;
            btn.innerHTML = `<svg class="icon-svg" viewBox="0 0 24 24" style="width:13px;height:13px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
          });
          if (inspDlText && prevInspText) inspDlText.textContent = prevInspText;
        }, 2500);
        return;
      }
    } catch (err) {
      console.warn('[SPeCTRUM Pro] downloadSingleFile fetch failed, falling back:', err);
    }

    // Direct Chrome Download Fallback with enforced extension
    let fallbackExt = '.pdf';
    const badge = detectFileBadge(file.title, file.url);
    if (badge.label && badge.label !== 'FILE') {
      fallbackExt = `.${badge.label.toLowerCase()}`;
    }
    const cleanTitle = sanitizeFilename(file.title);
    const filenameWithExt = cleanTitle.includes('.') ? cleanTitle : `${cleanTitle}${fallbackExt}`;
    let directUrl = file.realDownloadUrl || file.url;
    if (directUrl && directUrl.includes('/mod/resource/view.php') && !directUrl.includes('redirect=1')) {
      directUrl += (directUrl.includes('?') ? '&' : '?') + 'redirect=1';
    }

    if (chrome.downloads && chrome.downloads.download && directUrl) {
      chrome.downloads.download({
        url: directUrl,
        filename: `${courseCodeClean}/${filenameWithExt}`,
        saveAs: false
      });
    }

    dlBtns.forEach(btn => {
      btn.disabled = false;
      btn.style.opacity = '1';
    });
    if (inspDlText && prevInspText) inspDlText.textContent = prevInspText;
  }

  async function downloadCoursePack(course) {
    const courseFiles = [];
    (course.sections || []).forEach(sec => {
      (sec.files || []).forEach(f => {
        courseFiles.push({
          sectionFolder: sanitizeFilename(sec.name),
          title: f.title,
          url: f.url
        });
      });
    });

    if (courseFiles.length === 0) {
      alert(`No downloadable files found in ${course.code}.`);
      return;
    }

    if (typeof JSZip === 'undefined') {
      alert('JSZip library is missing. Please reload the extension.');
      return;
    }

    if (progressContainer) {
      progressContainer.style.display = 'block';
      progressBarFill.style.width = '0%';
      progressPercent.textContent = '0%';
      progressStatusLabel.textContent = `Packaging ${course.code} Course Pack...`;
    }

    const zip = new JSZip();
    let totalSaved = 0;
    const currentPrefs = await chrome.storage.local.get(defaultSettings);
    const allowedExts = currentPrefs.extensions || defaultSettings.extensions;

    for (let i = 0; i < courseFiles.length; i++) {
      const item = courseFiles[i];
      const percent = Math.round(((i + 1) / courseFiles.length) * 85);
      if (progressBarFill) progressBarFill.style.width = `${percent}%`;
      if (progressPercent) progressPercent.textContent = `${percent}%`;
      if (progressCurrentFile) progressCurrentFile.textContent = item.title;
      if (progressFileCount) progressFileCount.textContent = `${i + 1} / ${courseFiles.length}`;

      try {
        const fileData = await fetchFileWithRedirect(item.url, item.title, allowedExts);
        if (fileData && fileData.blob) {
          zip.folder(item.sectionFolder).file(fileData.filename, fileData.blob);
          totalSaved++;
        } else {
          const fallbackName = sanitizeFilename(item.title).includes('.') ? sanitizeFilename(item.title) : `${sanitizeFilename(item.title)}.txt`;
          zip.folder(item.sectionFolder).file(fallbackName, `SPeCTRUM Academic Pack File\nCourse: ${course.code}\nResource: ${item.title}`);
          totalSaved++;
        }
      } catch (err) {
        const fallbackName = sanitizeFilename(item.title).includes('.') ? sanitizeFilename(item.title) : `${sanitizeFilename(item.title)}.txt`;
        zip.folder(item.sectionFolder).file(fallbackName, `SPeCTRUM Academic Pack File\nCourse: ${course.code}\nResource: ${item.title}`);
        totalSaved++;
      }
    }

    if (progressStatusLabel) progressStatusLabel.textContent = 'Compressing Course Pack (.zip)...';
    if (progressBarFill) progressBarFill.style.width = '90%';
    if (progressPercent) progressPercent.textContent = '90%';

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const cleanCode = sanitizeFilename(course.code.replace(/[\/\\]+/g, '_'));
    const zipFilename = `${cleanCode}_CoursePack.zip`;
    const blobUrl = URL.createObjectURL(zipBlob);

    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url: blobUrl, filename: zipFilename, saveAs: true });
    } else {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = zipFilename;
      a.click();
    }

    if (progressBarFill) progressBarFill.style.width = '100%';
    if (progressPercent) progressPercent.textContent = '100%';
    if (progressStatusLabel) progressStatusLabel.textContent = `✔ Complete! (${totalSaved} files packaged)`;
    if (progressCurrentFile) progressCurrentFile.textContent = `Saved ${zipFilename}`;
    setTimeout(() => { if (progressContainer) progressContainer.style.display = 'none'; }, 3000);
  }

  // 5. Checkbox Cascade Helpers
  function syncCourseDomCheckboxes(course, courseEl) {
    const isCourseChecked = course.checked !== false;
    courseEl.querySelectorAll('.chk-section').forEach(sc => { sc.checked = isCourseChecked; });
    courseEl.querySelectorAll('.chk-file').forEach(fc => {
      fc.checked = isCourseChecked;
      fc.closest('.file-tree-item')?.classList.toggle('selected', isCourseChecked);
    });
    courseEl.classList.toggle('selected', isCourseChecked);
  }

  function updateParentSectionCheckbox(sec, secItem) {
    const allChecked = sec.files.length > 0 && sec.files.every(f => f.checked !== false);
    const someChecked = sec.files.some(f => f.checked !== false);
    const secChk = secItem.querySelector('.chk-section');
    if (secChk) {
      secChk.checked = allChecked;
      secChk.indeterminate = !allChecked && someChecked;
    }
    sec.checked = allChecked;
  }

  function updateParentCourseCheckbox(course, courseEl) {
    const allFiles = (course.sections || []).flatMap(s => s.files || []);
    const allChecked = allFiles.length > 0 && allFiles.every(f => f.checked !== false);
    const someChecked = allFiles.some(f => f.checked !== false);
    const courseChk = courseEl.querySelector('.chk-course');
    if (courseChk) {
      courseChk.checked = allChecked;
      courseChk.indeterminate = !allChecked && someChecked;
    }
    course.checked = allChecked;
    courseEl.classList.toggle('selected', allChecked || someChecked);
  }

  function updateAllCounts() {
    let totalSelected = 0;
    let totalAvailable = 0;
    let totalSizeBytes = 0;

    coursesData.forEach(c => {
      (c.sections || []).forEach(s => {
        (s.files || []).forEach(f => {
          totalAvailable++;
          if (f.checked !== false) {
            totalSelected++;
            const meta = getFileMetadata(f, c);
            totalSizeBytes += (meta.sizeBytes || 0);
          }
        });
      });
    });

    const totalSizeMb = (totalSizeBytes / (1024 * 1024)).toFixed(1);

    if (selectedCountEl) selectedCountEl.textContent = `${totalSelected} files`;
    const selectedSizeTextEl = document.getElementById('selected-size-text');
    if (selectedSizeTextEl) selectedSizeTextEl.style.display = 'none';

    if (btnDownloadText) btnDownloadText.textContent = `Download Selected (.zip)`;
    if (selectAllChk) {
      selectAllChk.checked = totalAvailable > 0 && totalSelected === totalAvailable;
      selectAllChk.indeterminate = totalSelected > 0 && totalSelected < totalAvailable;
    }
    if (btnDownloadZip) {
      btnDownloadZip.disabled = totalSelected === 0;
    }
  }

  // 6. Filtering & Search
  function applyMaterialsFilters() {
    if (!courseTreeEl) return;
    const q = (filterSearchInput ? filterSearchInput.value : '').trim().toLowerCase();
    const ext = (currentExtFilter || 'ALL').toUpperCase();

    const courseItems = courseTreeEl.querySelectorAll('.course-tree-item');

    courseItems.forEach(ci => {
      const courseId = ci.dataset.courseId;
      const course = coursesData.find(c => String(c.id) === String(courseId));
      if (!course) return;

      const courseTitle = (course.title || '').toLowerCase();
      const courseCode = (course.code || '').toLowerCase();
      const courseMatchesQuery = !q || courseTitle.includes(q) || courseCode.includes(q);

      let anyChildMatches = false;

      ci.querySelectorAll('.section-tree-item').forEach(secItem => {
        const secName = (secItem.dataset.secName || '').toLowerCase();
        const secMatchesQuery = !q || secName.includes(q);

        let anyFileInSecMatches = false;
        let secMatchingCount = 0;
        let secTotalCount = 0;

        secItem.querySelectorAll('.file-tree-item').forEach(fileItem => {
          const fileId = fileItem.dataset.fileId;
          const file = (course.sections || []).flatMap(s => s.files || []).find(f => String(f.id) === String(fileId));
          if (!file) return;

          secTotalCount++;
          const fileTitle = (file.title || '').toLowerCase();
          const fileMatchesQuery = !q || fileTitle.includes(q) || courseMatchesQuery || secMatchesQuery;

          let fileMatchesExt = true;
          if (ext !== 'ALL') {
            const badge = detectFileBadge(file);
            if (ext === 'PDF') fileMatchesExt = badge.label === 'PDF';
            else if (ext === 'PPTX') fileMatchesExt = (badge.label === 'PPTX' || badge.label === 'PPT');
            else if (ext === 'ZIP') fileMatchesExt = (badge.label === 'ZIP' || badge.label === 'RAR');
            else if (ext === 'DOCX') fileMatchesExt = (badge.label === 'DOCX' || badge.label === 'DOC');
            else if (ext === 'IPYNB') fileMatchesExt = (badge.label === 'IPYNB' || badge.label === 'PY');
            else fileMatchesExt = badge.label.includes(ext);
          }

          const visible = fileMatchesQuery && fileMatchesExt;
          fileItem.style.display = visible ? '' : 'none';
          if (visible) {
            anyFileInSecMatches = true;
            secMatchingCount++;
          }
        });

        const isSecVisible = (ext === 'ALL' && !q) ? true : anyFileInSecMatches;
        secItem.style.display = isSecVisible ? '' : 'none';
        if (isSecVisible) anyChildMatches = true;

        if (anyFileInSecMatches && (ext !== 'ALL' || q)) {
          secItem.classList.add('expanded');
        }

        const countBadge = secItem.querySelector('.section-count-badge');
        if (countBadge && secTotalCount > 0) {
          if (ext !== 'ALL' || q) {
            countBadge.textContent = `${secMatchingCount} of ${secTotalCount} files`;
          } else {
            countBadge.textContent = `${secTotalCount} ${secTotalCount === 1 ? 'file' : 'files'}`;
          }
        }
      });

      ci.style.display = (anyChildMatches || (ext === 'ALL' && !q)) ? '' : 'none';
      if (anyChildMatches && (ext !== 'ALL' || q)) {
        ci.classList.add('expanded');
      }
    });
  }

  // Extension filter pills
  document.querySelectorAll('.mat-ext-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.mat-ext-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentExtFilter = pill.dataset.ext || 'ALL';
      applyMaterialsFilters();
    });
  });

  // Sort dropdown
  const matSortSelect = document.getElementById('mat-sort-select');
  if (matSortSelect) {
    matSortSelect.addEventListener('change', () => {
      const mode = matSortSelect.value;
      coursesData.forEach(c => {
        (c.sections || []).forEach(s => {
          if (mode === 'name') {
            s.files.sort((a, b) => a.title.localeCompare(b.title));
          } else {
            s.files.sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true }));
          }
        });
      });
      renderCourseTreeShells();
    });
  }

  // Search input & clear button
  if (filterSearchInput) {
    filterSearchInput.addEventListener('input', () => {
      const query = filterSearchInput.value.trim();
      if (btnClearSearch) btnClearSearch.style.display = query ? 'block' : 'none';
      applyMaterialsFilters();
    });

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        filterSearchInput.value = '';
        btnClearSearch.style.display = 'none';
        applyMaterialsFilters();
      });
    }
  }

  // ⌘F / Ctrl+F focus shortcut
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      const matSec = document.getElementById('tab-materials');
      if (matSec && matSec.style.display !== 'none' && filterSearchInput) {
        e.preventDefault();
        filterSearchInput.focus();
        filterSearchInput.select();
      }
    }
  });

  // Clear Selection & Mark All Synced
  const btnClearSelection = document.getElementById('btn-clear-selection');
  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', () => {
      coursesData.forEach(c => {
        c.checked = false;
        (c.sections || []).forEach(s => {
          s.checked = false;
          (s.files || []).forEach(f => { f.checked = false; });
        });
      });
      document.querySelectorAll('.chk-course, .chk-section, .chk-file').forEach(chk => { chk.checked = false; });
      document.querySelectorAll('.file-tree-item.selected, .course-tree-item.selected').forEach(el => el.classList.remove('selected'));
      updateAllCounts();
      debounceSaveCache();
    });
  }

  const btnMarkAllSynced = document.getElementById('btn-mark-all-synced');
  if (btnMarkAllSynced) {
    btnMarkAllSynced.addEventListener('click', () => {
      coursesData.forEach(c => {
        (c.sections || []).forEach(s => {
          (s.files || []).forEach(f => {
            f.isSynced = true;
            f.isNew = false;
          });
        });
      });
      document.querySelectorAll('.btn-sync-now').forEach(btn => {
        const span = document.createElement('span');
        span.className = 'status-synced-pill';
        span.innerHTML = `<svg class="icon-svg" viewBox="0 0 24 24" style="width:12px;height:12px;stroke:#16A34A;fill:none;stroke-width:2.5;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Synced`;
        btn.parentNode.replaceChild(span, btn);
      });
      document.querySelectorAll('.file-new-badge').forEach(badge => badge.remove());
      btnMarkAllSynced.textContent = '✔ All Synced';
      setTimeout(() => { btnMarkAllSynced.textContent = 'Mark All as Synced'; }, 2000);
      debounceSaveCache();
    });
  }

  if (btnToggleExpandAll) {
    btnToggleExpandAll.addEventListener('click', () => {
      toggleExpandAllMaterials();
    });
  }

  if (btnRescan) {
    btnRescan.addEventListener('click', async () => {
      const tabToUse = await findSpectrumTab();
      await scanCourses(tabToUse, true);
    });
  }

  if (btnClearCache) {
    btnClearCache.addEventListener('click', async () => {
      await chrome.storage.local.remove([
        'cachedCoursesData',
        'cachedCoursesTime',
        'cachedAnnouncements',
        'cachedAssignments',
        'cachedAttendances',
        'cachedActivitiesTime'
      ]);
      const clearIcon = `<svg viewBox="0 0 24 24" class="footer-icon-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
      btnClearCache.innerHTML = `${clearIcon} <span>✔ Cleared!</span>`;
      if (typeof updatePreferencesStorageStats === 'function') updatePreferencesStorageStats();
      if (cacheTimeBadge) cacheTimeBadge.style.display = 'none';
      if (activitiesCacheBadge) activitiesCacheBadge.style.display = 'none';
      setTimeout(() => { btnClearCache.innerHTML = `${clearIcon} <span>Clear Cache</span>`; }, 1500);
    });
  }

  // Helper to get category tag badge for course (e.g. COMP, MATH, SE, APP)
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

  // Preferences OCC Table Render (Aggregates from all course caches & overrides)
  function renderOccPreferencesTable() {
    if (!occCoursesTable) return;

    const map = new Map();
    if (Array.isArray(coursesData)) {
      coursesData.forEach(c => {
        if (c && c.id) map.set(String(c.id), { id: String(c.id), code: c.code || `Course ${c.id}`, title: c.title || c.name || '', name: c.name || c.title || '' });
      });
    }
    if (Array.isArray(allCoursesDiscovered)) {
      allCoursesDiscovered.forEach(c => {
        if (c && c.id && !map.has(String(c.id))) {
          const shell = createCourseTreeShell(c);
          map.set(String(c.id), { id: String(c.id), code: shell.code, title: shell.title || shell.name || '', name: shell.name || shell.title || '' });
        }
      });
    }
    if (Array.isArray(attendancesData)) {
      attendancesData.forEach(a => {
        if (a && a.courseId && !map.has(String(a.courseId))) {
          map.set(String(a.courseId), { id: String(a.courseId), code: a.courseCode || `Course ${a.courseId}`, title: a.courseName || a.courseCode || '', name: a.courseName || a.courseCode || '' });
        }
      });
    }
    if (courseOccs && typeof courseOccs === 'object') {
      Object.keys(courseOccs).forEach(cid => {
        if (!map.has(String(cid))) {
          map.set(String(cid), { id: String(cid), code: `Course ${cid}`, title: `Course ID ${cid}`, name: `Course ID ${cid}` });
        }
      });
    }

    const coursesList = Array.from(map.values()).sort((a, b) => (a.code || '').localeCompare(b.code || ''));

    if (coursesList.length === 0) {
      occCoursesTable.innerHTML = '<div class="pref-hidden-empty">No enrolled courses loaded yet. Synchronize activities to display enrolled courses.</div>';
      return;
    }

    occCoursesTable.innerHTML = coursesList.map(c => {
      const tag = getCourseCategoryTag(c.code, c.title);
      const val = courseOccs[c.id] || '';
      return `
        <div class="pref-course-card">
          <div class="pref-course-info">
            <div class="pref-course-code-row">
              <span class="pref-course-code">${escapeHtml(c.code)}</span>
              <span class="pref-course-tag">${escapeHtml(tag)}</span>
            </div>
            <div class="pref-course-title" title="${escapeHtml(c.name || c.title)}">${escapeHtml(c.title || c.name || '')}</div>
          </div>
          <div class="pref-course-action">
            <span class="pref-occ-label">OCC</span>
            <div class="pref-stepper">
              <button type="button" class="stepper-btn stepper-course-minus" data-course-id="${escapeHtml(c.id)}" aria-label="Decrease OCC">−</button>
              <input type="text" class="stepper-input occ-table-input" data-course-id="${escapeHtml(c.id)}" value="${escapeHtml(val)}" placeholder="${escapeHtml(defaultOcc || '4')}" maxlength="3" inputmode="numeric">
              <button type="button" class="stepper-btn stepper-course-plus" data-course-id="${escapeHtml(c.id)}" aria-label="Increase OCC">+</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    occCoursesTable.querySelectorAll('.stepper-course-minus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.dataset.courseId;
        const inp = occCoursesTable.querySelector(`.occ-table-input[data-course-id="${cid}"]`);
        if (!inp) return;
        let cur = parseInt(inp.value.trim() || defaultOcc || '4', 10);
        if (isNaN(cur) || cur <= 1) cur = 1;
        else cur -= 1;
        inp.value = cur;
        courseOccs[cid] = String(cur);
      });
    });

    occCoursesTable.querySelectorAll('.stepper-course-plus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.dataset.courseId;
        const inp = occCoursesTable.querySelector(`.occ-table-input[data-course-id="${cid}"]`);
        if (!inp) return;
        let cur = parseInt(inp.value.trim() || defaultOcc || '4', 10);
        if (isNaN(cur) || cur < 1) cur = 1;
        else cur += 1;
        inp.value = cur;
        courseOccs[cid] = String(cur);
      });
    });
  }

  // ========================================================
  // 12. ZIP Download Execution
  // ========================================================
  if (btnDownloadZip) {
    btnDownloadZip.addEventListener('click', async () => {
      const selectedFiles = [];
      coursesData.forEach(c => {
        const courseFolder = `${sanitizeFilename(c.code)} ${sanitizeFilename(c.title)}`.trim();
        c.sections.forEach(s => {
          const sectionFolder = sanitizeFilename(s.name);
          s.files.forEach(f => {
            if (f.checked !== false) {
              selectedFiles.push({
                courseFolder,
                sectionFolder,
                title: f.title,
                url: f.url
              });
            }
          });
        });
      });

      if (selectedFiles.length === 0) {
        alert('No files selected. Please check at least one file to download.');
        return;
      }

      if (typeof JSZip === 'undefined') {
        alert('JSZip library is missing. Please reload the extension.');
        return;
      }

      progressContainer.style.display = 'block';
      progressBarFill.style.width = '0%';
      progressPercent.textContent = '0%';
      progressStatusLabel.textContent = 'Starting file download...';
      btnDownloadZip.disabled = true;

      const zip = new JSZip();
      let totalSaved = 0;
      let totalFailed = 0;

      const currentPrefs = await chrome.storage.local.get(defaultSettings);
      const allowedExts = currentPrefs.extensions || defaultSettings.extensions;

      for (let i = 0; i < selectedFiles.length; i++) {
        const item = selectedFiles[i];
        const percent = Math.round(((i + 1) / selectedFiles.length) * 85);

        progressBarFill.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        progressCurrentFile.textContent = item.title;
        progressFileCount.textContent = `${i + 1} / ${selectedFiles.length}`;

        try {
          const fileData = await fetchFileWithRedirect(item.url, item.title, allowedExts);
          if (fileData && fileData.blob) {
            const folderPath = `${item.courseFolder}/${item.sectionFolder}`;
            zip.folder(folderPath).file(fileData.filename, fileData.blob);
            totalSaved++;
          } else {
            totalFailed++;
          }
        } catch (e) {
          console.log(`Download item note for ${item.title}:`, e?.message || e);
          totalFailed++;
        }
      }

      progressStatusLabel.textContent = 'Compressing organized .ZIP archive...';
      progressBarFill.style.width = '90%';
      progressPercent.textContent = '90%';

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }, (meta) => {
        const p = Math.round(90 + (meta.percent * 0.10));
        progressBarFill.style.width = `${p}%`;
        progressPercent.textContent = `${p}%`;
      });

      const timestamp = new Date().toISOString().slice(0, 10);
      const zipFilename = `SPeCTRUM_Materials_${timestamp}.zip`;
      const blobUrl = URL.createObjectURL(zipBlob);

      if (chrome.downloads && chrome.downloads.download) {
        chrome.downloads.download({
          url: blobUrl,
          filename: zipFilename,
          saveAs: true
        });
      } else {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = zipFilename;
        a.click();
      }

      progressBarFill.style.width = '100%';
      progressPercent.textContent = '100%';
      progressStatusLabel.textContent = `✔ Complete! (${totalSaved} files saved)`;
      progressCurrentFile.textContent = 'Saved to your Downloads folder';
      btnDownloadText.textContent = '✔ Download Complete!';
      setTimeout(updateAllCounts, 3500);
    });
  }

  function detectFileBadge(titleOrFile, url, extraHint) {
    let title = '';
    let fileUrl = '';
    let hint = '';
    let existingExt = '';

    if (titleOrFile && typeof titleOrFile === 'object') {
      title = titleOrFile.title || '';
      fileUrl = titleOrFile.realDownloadUrl || titleOrFile.url || url || '';
      hint = `${titleOrFile.typeHint || ''} ${titleOrFile.type || ''} ${extraHint || ''}`;
      existingExt = titleOrFile.ext || '';
      if (titleOrFile.badge && titleOrFile.badge.label && titleOrFile.badge.label !== 'FILE') {
        return titleOrFile.badge;
      }
    } else {
      title = String(titleOrFile || '');
      fileUrl = String(url || '');
      hint = String(extraHint || '');
    }

    const combined = `${title} ${fileUrl} ${hint}`.toLowerCase();

    // 1. Explicit extension match
    const extMatch = (existingExt || fileUrl || title).match(/\.([a-zA-Z0-9]+)(?:\?|$)/i);
    const ext = (existingExt || (extMatch ? extMatch[1] : '')).toLowerCase();

    if (['pdf'].includes(ext) || combined.includes('.pdf') || combined.includes('pdf document') || combined.includes('/f/pdf')) {
      return { label: 'PDF', cls: 'badge-pdf' };
    }
    if (['pptx', 'ppt', 'pps', 'ppsx'].includes(ext) || combined.includes('.pptx') || combined.includes('.ppt') || combined.includes('/f/powerpoint') || combined.includes('powerpoint') || combined.includes('presentation')) {
      return { label: 'PPTX', cls: 'badge-pptx' };
    }
    if (['docx', 'doc', 'dotx'].includes(ext) || combined.includes('.docx') || combined.includes('.doc') || combined.includes('/f/document') || combined.includes('word document') || combined.includes('/f/word')) {
      return { label: 'DOCX', cls: 'badge-docx' };
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || combined.includes('.zip') || combined.includes('.rar') || combined.includes('/f/archive') || combined.includes('/mod/folder/')) {
      return { label: 'ZIP', cls: 'badge-zip' };
    }
    if (['xlsx', 'xls'].includes(ext) || combined.includes('.xlsx') || combined.includes('.xls') || combined.includes('/f/spreadsheet') || combined.includes('spreadsheet') || combined.includes('excel')) {
      return { label: 'XLSX', cls: 'badge-csv' };
    }
    if (['csv'].includes(ext) || combined.includes('.csv')) {
      return { label: 'CSV', cls: 'badge-csv' };
    }
    if (['ipynb'].includes(ext) || combined.includes('.ipynb') || combined.includes('notebook') || combined.includes('jupyter')) {
      return { label: 'IPYNB', cls: 'badge-ipynb' };
    }
    if (['py'].includes(ext) || combined.includes('.py') || combined.includes('/f/sourcecode') || combined.includes('python')) {
      return { label: 'PY', cls: 'badge-ipynb' };
    }

    // 2. Keyword heuristics on academic course material titles
    if (/\b(slides?|presentation|powerpoint|lecture\s*slides?)\b/i.test(title)) {
      return { label: 'PPTX', cls: 'badge-pptx' };
    }
    if (/\b(dataset|archive|codebase|source\s*files?|folder|package)\b/i.test(title) || hint.includes('folder')) {
      return { label: 'ZIP', cls: 'badge-zip' };
    }
    if (/\b(excel|data\s*sheet|spreadsheet)\b/i.test(title)) {
      return { label: 'XLSX', cls: 'badge-csv' };
    }
    if (/\b(word\s*doc|doc\b|template|rubric\s*doc|form\b)/i.test(title)) {
      return { label: 'DOCX', cls: 'badge-docx' };
    }
    if (/\b(proforma|pro-forma|cif|course\s*information|weekly\s*plan|syllabus|notification|policy|guideline|guide|handbook|timetable|schedule|reading|article|paper|notes|tutorial|lab|assignment|ch\b|chapter|book\b)/i.test(title)) {
      return { label: 'PDF', cls: 'badge-pdf' };
    }

    // 3. Moodle activity fallbacks: In SPeCTRUM, /mod/resource/ materials are lecture PDFs
    if (fileUrl.includes('/mod/resource/view.php') || hint.includes('resource')) {
      return { label: 'PDF', cls: 'badge-pdf' };
    }
    if (fileUrl.includes('/mod/folder/view.php') || hint.includes('folder')) {
      return { label: 'ZIP', cls: 'badge-zip' };
    }

    return { label: 'FILE', cls: 'badge-file' };
  }

  function sanitizeFilename(str) {
    return (str || 'unnamed').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }

  async function fetchFileWithRedirect(url, fallbackTitle, allowedExts) {
    let fetchUrl = url;
    if (fetchUrl && fetchUrl.includes('/mod/resource/view.php') && !fetchUrl.includes('redirect=1')) {
      fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'redirect=1';
    }

    const res = await fetchWithTimeout(fetchUrl, { credentials: 'include' }, 12000);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('text/html')) {
      const htmlText = await res.text();
      const realUrl = extractMoodleRealFileUrl(htmlText, res.url);
      if (realUrl && realUrl !== url && realUrl !== fetchUrl) {
        return fetchFileWithRedirect(realUrl, fallbackTitle, allowedExts);
      }
      return null;
    }

    let filename = '';
    const cd = res.headers.get('content-disposition');
    if (cd) {
      const utfMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (utfMatch) filename = decodeURIComponent(utfMatch[1]);
      const stdMatch = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^; ]+)/i);
      if (!filename && stdMatch) filename = stdMatch[1];
    }

    if (!filename) {
      const urlPath = new URL(res.url).pathname;
      const urlName = decodeURIComponent(urlPath.split('/').pop());
      if (allowedExts.some(ext => urlName.toLowerCase().endsWith(ext))) {
        filename = urlName;
      }
    }

    if (!filename) {
      let ext = '.pdf';
      if (contentType.includes('presentation') || contentType.includes('powerpoint')) ext = '.pptx';
      else if (contentType.includes('word') || contentType.includes('document')) ext = '.docx';
      else if (contentType.includes('zip') || contentType.includes('compressed')) ext = '.zip';
      else if (contentType.includes('excel') || contentType.includes('spreadsheet')) ext = '.xlsx';
      else if (contentType.includes('csv')) ext = '.csv';
      filename = `${sanitizeFilename(fallbackTitle)}${ext}`;
    }

    // Ensure filename ends with a valid 2-5 character extension
    if (!/\.[a-zA-Z0-9]{2,5}$/.test(filename)) {
      let ext = '.pdf';
      if (contentType.includes('presentation') || contentType.includes('powerpoint')) ext = '.pptx';
      else if (contentType.includes('word') || contentType.includes('document')) ext = '.docx';
      else if (contentType.includes('zip') || contentType.includes('compressed')) ext = '.zip';
      else if (contentType.includes('excel') || contentType.includes('spreadsheet')) ext = '.xlsx';
      else if (contentType.includes('csv')) ext = '.csv';
      filename = `${filename}${ext}`;
    }

    filename = sanitizeFilename(filename);
    const blob = await res.blob();
    return { blob, filename };
  }

  // ========================================================================
  // Header Brand Logo: Sync & Realtime Geometry
  // ========================================================================
  function initHeaderBrandLogo() {
    const DEFAULT_LOGO_GEOMETRY = {
      apex: { x: 100, y: 36.4 },
      baseL: { x: 32.7, y: 149.5 },
      baseR: { x: 167.3, y: 149.5 },
      incStart: { x: 0, y: 140.8 },
      incEnd: { x: 50.1, y: 122.3 },
      incW1: 1.2,
      incW2: 4.8,
      sRkneeOut: { x: 100.7, y: 105.4 },
      sLkneeOut: { x: 75.6, y: 87.4 },
      sExitTop: { x: 122.4, y: 71.1 },
      sExitBot: { x: 123.7, y: 78.2 },
      sLkneeIn: { x: 98.6, y: 91.1 },
      sRkneeIn: { x: 129.9, y: 111.6 },
      sStroke: 2.3,
      triStroke: 2.0,
      ray1Tip: { x: 200, y: 39.5 },
      r1W1: 2.2, r1W2: 0.8,
      ray2Tip: { x: 200, y: 51.3 },
      r2W1: 2.6, r2W2: 0.9,
      ray3Tip: { x: 200, y: 64.0 },
      r3W1: 3.0, r3W2: 0.9
    };
    function applySyncedLogoGeometry(savedData) {
      if (!savedData) return;
      const svgList = document.querySelectorAll('.header-brand-logo-svg');
      if (!svgList.length) return;

      function calcBeam(x1, y1, x2, y2, w1, w2) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const dx = -Math.sin(angle);
        const dy = Math.cos(angle);
        const p1a = [x1 + dx * w1 / 2, y1 + dy * w1 / 2];
        const p1b = [x1 - dx * w1 / 2, y1 - dy * w1 / 2];
        const p2b = [x2 - dx * w2 / 2, y2 - dy * w2 / 2];
        const p2a = [x2 + dx * w2 / 2, y2 + dy * w2 / 2];
        return `${p1a[0].toFixed(1)},${p1a[1].toFixed(1)} ${p2a[0].toFixed(1)},${p2a[1].toFixed(1)} ${p2b[0].toFixed(1)},${p2b[1].toFixed(1)} ${p1b[0].toFixed(1)},${p1b[1].toFixed(1)}`;
      }

      svgList.forEach(svgEl => {
        // Triangle
        if (savedData.apex && savedData.baseL && savedData.baseR) {
          const tri = svgEl.querySelector('.art-tri');
          if (tri) {
            tri.setAttribute('points', `${savedData.apex.x},${savedData.apex.y} ${savedData.baseL.x},${savedData.baseL.y} ${savedData.baseR.x},${savedData.baseR.y}`);
            if (savedData.triStroke) tri.setAttribute('stroke-width', savedData.triStroke);
          }
          const subline = svgEl.querySelector('.art-subline');
          if (subline) {
            subline.setAttribute('x1', savedData.baseL.x + 3);
            subline.setAttribute('y1', savedData.baseL.y - 3.6);
            subline.setAttribute('x2', savedData.baseR.x - 3);
            subline.setAttribute('y2', savedData.baseR.y - 3.6);
          }
        }

        // 1. Incident beam & spark
        if (savedData.incStart && savedData.incEnd) {
          const inc = svgEl.querySelector('.art-beam-incident');
          if (inc) inc.setAttribute('points', calcBeam(savedData.incStart.x, savedData.incStart.y, savedData.incEnd.x, savedData.incEnd.y, savedData.incW1 || 1.0, savedData.incW2 || 4.8));
          const flash = svgEl.querySelector('.flash-spark');
          if (flash) {
            flash.setAttribute('cx', savedData.incEnd.x);
            flash.setAttribute('cy', savedData.incEnd.y);
          }
        }

        // 2. Twin synchronous S-Core tracks
        if (savedData.incEnd && savedData.sRkneeOut && savedData.sLkneeOut && savedData.sExitTop) {
          const incEndTopY = (savedData.incEnd.y - (savedData.incW2 || 4.8) / 3).toFixed(1);
          const incEndBotY = (savedData.incEnd.y + (savedData.incW2 || 4.8) / 3).toFixed(1);

          const topTrack = svgEl.querySelector('.laser-score-top');
          if (topTrack) {
            topTrack.setAttribute('d', `M ${savedData.incEnd.x} ${incEndTopY} L ${savedData.sRkneeOut.x} ${savedData.sRkneeOut.y} L ${savedData.sLkneeOut.x} ${savedData.sLkneeOut.y} L ${savedData.sExitTop.x} ${savedData.sExitTop.y}`);
            if (savedData.sStroke) topTrack.setAttribute('stroke-width', savedData.sStroke);
          }

          const botTrack = svgEl.querySelector('.laser-score-bot');
          if (botTrack && savedData.sRkneeIn && savedData.sLkneeIn && savedData.sExitBot) {
            botTrack.setAttribute('d', `M ${savedData.incEnd.x} ${incEndBotY} L ${savedData.sRkneeIn.x} ${savedData.sRkneeIn.y} L ${savedData.sLkneeIn.x} ${savedData.sLkneeIn.y} L ${savedData.sExitBot.x} ${savedData.sExitBot.y}`);
            if (savedData.sStroke) botTrack.setAttribute('stroke-width', savedData.sStroke);
          }

          const exitCap = svgEl.querySelector('.cap-score-exit');
          if (exitCap && savedData.sExitBot) {
            exitCap.setAttribute('x1', savedData.sExitTop.x);
            exitCap.setAttribute('y1', savedData.sExitTop.y);
            exitCap.setAttribute('x2', savedData.sExitBot.x);
            exitCap.setAttribute('y2', savedData.sExitBot.y);
            if (savedData.sStroke) exitCap.setAttribute('stroke-width', savedData.sStroke);
          }

          // Polygon for static / settled mode
          const poly = svgEl.querySelector('.art-score-poly');
          if (poly && savedData.sExitBot && savedData.sLkneeIn && savedData.sRkneeIn) {
            const pts = [
              `${savedData.incEnd.x},${incEndTopY}`,
              `${savedData.sRkneeOut.x},${savedData.sRkneeOut.y}`,
              `${savedData.sLkneeOut.x},${savedData.sLkneeOut.y}`,
              `${savedData.sExitTop.x},${savedData.sExitTop.y}`,
              `${savedData.sExitBot.x},${savedData.sExitBot.y}`,
              `${savedData.sLkneeIn.x},${savedData.sLkneeIn.y}`,
              `${savedData.sRkneeIn.x},${savedData.sRkneeIn.y}`,
              `${savedData.incEnd.x},${incEndBotY}`
            ].join(' ');
            poly.setAttribute('points', pts);
            if (savedData.sStroke) poly.setAttribute('stroke-width', savedData.sStroke);
          }
        }

        // 3. Outgoing rays
        if (savedData.sExitTop && savedData.ray1Tip && savedData.ray2Tip && savedData.ray3Tip) {
          const r1 = svgEl.querySelector('.art-beam-ray1');
          if (r1) r1.setAttribute('points', calcBeam(savedData.sExitTop.x, savedData.sExitTop.y, savedData.ray1Tip.x, savedData.ray1Tip.y, savedData.r1W1 || 2.2, savedData.r1W2 || 0.8));
          const r2 = svgEl.querySelector('.art-beam-ray2');
          if (r2) r2.setAttribute('points', calcBeam(savedData.sExitTop.x + 0.5, savedData.sExitTop.y + 4.0, savedData.ray2Tip.x, savedData.ray2Tip.y, savedData.r2W1 || 2.6, savedData.r2W2 || 0.9));
          const r3 = svgEl.querySelector('.art-beam-ray3');
          if (r3) r3.setAttribute('points', calcBeam(savedData.sExitTop.x + 1.5, savedData.sExitTop.y + 8.0, savedData.ray3Tip.x, savedData.ray3Tip.y, savedData.r3W1 || 3.0, savedData.r3W2 || 0.9));
        }
      });
    }

    // Apply tuned geometry by default immediately
    applySyncedLogoGeometry(DEFAULT_LOGO_GEOMETRY);

    function isLegacyOldGeometry(obj) {
      if (!obj) return false;
      return obj.sRkneeOut && Math.abs(obj.sRkneeOut.x - 126.2) < 0.5;
    }

    // Try loading saved logo geometry from storage
    if (chrome?.storage?.local) {
      chrome.storage.local.get(['spectrum_nonlinear_logo'], (res) => {
        if (res && res.spectrum_nonlinear_logo) {
          if (!isLegacyOldGeometry(res.spectrum_nonlinear_logo)) {
            applySyncedLogoGeometry({ ...DEFAULT_LOGO_GEOMETRY, ...res.spectrum_nonlinear_logo });
          } else {
            chrome.storage.local.set({ spectrum_nonlinear_logo: DEFAULT_LOGO_GEOMETRY });
          }
        }
      });
      // Live sync if user tunes in logo_comparison tab
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.spectrum_nonlinear_logo) {
          applySyncedLogoGeometry({ ...DEFAULT_LOGO_GEOMETRY, ...changes.spectrum_nonlinear_logo.newValue });
        }
      });
    }
    try {
      const savedLogo = localStorage.getItem('spectrum_nonlinear_logo');
      if (savedLogo) {
        const parsed = JSON.parse(savedLogo);
        if (!isLegacyOldGeometry(parsed)) {
          applySyncedLogoGeometry({ ...DEFAULT_LOGO_GEOMETRY, ...parsed });
        } else {
          localStorage.setItem('spectrum_nonlinear_logo', JSON.stringify(DEFAULT_LOGO_GEOMETRY));
        }
      }
    } catch(e) {}
  }

  initHeaderBrandLogo();
});

// ========================================================
// Direct Extension Fetchers (Manifest V3 with Host Permissions)
// Runs directly inside extension with session cookies,
// completely independent of open tabs or tab state.
// ========================================================

const SPECTRUM_ORIGIN = 'https://spectrum.um.edu.my';

// 1. Direct Enrolled Courses Fetcher
async function fetchEnrolledCoursesDirectly() {
  const origin = SPECTRUM_ORIGIN;
  const parser = new DOMParser();
  const results = [];
  const seen = new Set();

  try {
    const res = await fetchWithTimeout(`${origin}/my/courses.php`, { credentials: 'include' }, 12000);
    if (!res.ok || res.url.includes('/login/')) {
      return { loggedIn: false, courses: [] };
    }

    const html = await res.text();

    // 1. Extract sesskey and userId from HTML for Moodle AJAX
    let sesskey = '';
    const sessMatch = html.match(/"sesskey":"([^"]+)"/) || html.match(/sesskey=([a-zA-Z0-9]+)/);
    if (sessMatch) sesskey = sessMatch[1];

    let userId = 0;
    const userMatch = html.match(/"userId":(\d+)/i) || html.match(/"userid":(\d+)/i);
    if (userMatch) userId = parseInt(userMatch[1], 10);

    // Try Moodle timeline AJAX service
    if (sesskey) {
      try {
        const ajaxRes = await fetchWithTimeout(`${origin}/lib/ajax/service.php?sesskey=${sesskey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              index: 0,
              methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
              args: { classification: 'inprogress', limit: 0, offset: 0, sort: 'fullname' }
            },
            {
              index: 1,
              methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
              args: { classification: 'all', limit: 0, offset: 0, sort: 'fullname' }
            },
            {
              index: 2,
              methodname: 'core_enrol_get_users_courses',
              args: { userid: userId || 0 }
            },
            {
              index: 3,
              methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
              args: { classification: 'future', limit: 0, offset: 0, sort: 'fullname' }
            }
          ]),
          credentials: 'include'
        });

        if (ajaxRes.ok) {
          const data = await ajaxRes.json();
          const inProgressList = (data[0] && data[0].data && Array.isArray(data[0].data.courses)) ? data[0].data.courses : [];
          const allList = (data[1] && data[1].data && Array.isArray(data[1].data.courses)) ? data[1].data.courses : [];
          const userList = (data[2] && data[2].data && Array.isArray(data[2].data)) ? data[2].data : [];
          const futureList = (data[3] && data[3].data && Array.isArray(data[3].data.courses)) ? data[3].data.courses : [];

          const inProgressIds = new Set(inProgressList.map(c => String(c.id)));
          const futureIds = new Set(futureList.map(c => String(c.id)));

          [...inProgressList, ...futureList, ...allList, ...userList].forEach(c => {
            const id = String(c.id);
            if (id && id !== '1' && /^\d+$/.test(id) && !seen.has(id)) {
              seen.add(id);
              const isInProgress = inProgressIds.has(id) || futureIds.has(id);
              const enddate = c.enddate ? Number(c.enddate) : 0;
              const startdate = c.startdate ? Number(c.startdate) : 0;
              const isPast = !isInProgress && enddate > 0 && (enddate * 1000 < Date.now());

              const rawName = (c.fullname || c.shortname || `Course ${id}`).replace(/[\r\n\t]+/g, ' ').replace(/^Course name\s*/i, '').trim();

              results.push({
                id: id,
                name: rawName,
                url: c.viewurl || `${origin}/course/view.php?id=${id}`,
                isInProgress,
                isPast,
                enddate,
                startdate
              });
            }
          });
        }
      } catch (e) {
        console.log('Moodle AJAX courses fetch note:', e?.message || e);
      }
    }

    // Fallback: Parse course cards directly from HTML
    if (results.length === 0) {
      const doc = parser.parseFromString(`<base href="${origin}/">${html}`, 'text/html');
      const candidateLinks = Array.from(doc.querySelectorAll('a[href*="/course/view.php?id="]'));
      for (const a of candidateLinks) {
        const match = a.href.match(/id=(\d+)/);
        if (!match) continue;
        const id = match[1];
        if (id === '1' || seen.has(id)) continue;

        let name = '';
        const card = a.closest('.dashboard-card, .coursebox, .card');
        if (card) {
          const titleEl = card.querySelector('.coursename, .course-name, .card-title, h3, h4, h5');
          if (titleEl) name = titleEl.innerText.trim();
        }
        if (!name) name = a.innerText.trim();
        name = name.replace(/^Course name\s*/i, '').trim();
        if (!name || /view course/i.test(name)) name = `Course ${id}`;

        seen.add(id);
        results.push({ id, name, url: a.href, isInProgress: true, isPast: false });
      }
    }

    const sorted = results.sort((a, b) => a.name.localeCompare(b.name));
    return { loggedIn: true, courses: sorted, allCourses: sorted };
  } catch (err) {
    console.log('[SPeCTRUM Pro] Enrolled courses fetch note:', err?.message || err);
    return { loggedIn: false, courses: [] };
  }
}

// 2. Direct Course Materials Fetcher
async function fetchCourseMaterialsDirectly(courseId, allowedExts, materialsOnly) {
  try {
    const origin = SPECTRUM_ORIGIN;
    const url = `${origin}/course/view.php?id=${courseId}`;
    const res = await fetchWithTimeout(url, { credentials: 'include' }, 12000);
    if (!res.ok || res.url.includes('/login/')) return [];

    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<base href="${origin}/">${html}`, 'text/html');

    const materials = [];
    const seenUrls = new Set();
    const candidateSections = Array.from(doc.querySelectorAll('li.section, section.course-section, .course-content ul.topics > li, .course-content ul.weeks > li, .section.main'));
    // Filter to retain only top-level section containers (ensures no parent wrapper contains another matched element)
    const sectionEls = candidateSections.filter(el => !candidateSections.some(other => other !== el && other.contains(el)));

    function extractFromContainer(container, sectionTitle) {
      const links = container.querySelectorAll('a[href]');
      for (const a of links) {
        const href = a.href;
        if (!href || href.startsWith('javascript:') || href.startsWith('#')) continue;

        let type = 'unknown';
        const lower = href.toLowerCase();

        if (lower.includes('/mod/resource/view.php')) {
          type = 'resource';
        } else if (lower.includes('/mod/folder/view.php')) {
          type = 'folder';
        } else if (lower.includes('/pluginfile.php/')) {
          type = 'file';
        } else if (!materialsOnly && lower.includes('/mod/assign/view.php')) {
          type = 'assign';
        } else {
          const hasExt = allowedExts.some(ext => lower.endsWith(ext) || lower.includes(ext + '?'));
          if (hasExt) type = 'direct_file';
        }

        if (type === 'unknown') continue;

        let title = '';
        const instanceEl = a.querySelector('.instancename');
        if (instanceEl) {
          const clone = instanceEl.cloneNode(true);
          clone.querySelectorAll('.accesshide').forEach(el => el.remove());
          title = clone.innerText.trim();
        }
        if (!title) title = a.innerText.trim();
        if (!title) title = a.getAttribute('title') || 'Resource';

        title = title.replace(/[\r\n\t]+/g, ' ').trim();

        const parentActivity = a.closest('.activity, li.activity, .activityinstance, .activity-item, .modtype_resource') || a.parentElement;
        const iconImg = a.querySelector('img') || parentActivity?.querySelector('img.activityicon, img.icon, .activityiconcontainer img, img');
        const imgSrc = iconImg ? (iconImg.getAttribute('src') || iconImg.src || '') : '';
        const imgAlt = iconImg ? (iconImg.getAttribute('alt') || iconImg.alt || '') : '';
        const accessHideText = Array.from(a.querySelectorAll('.accesshide')).map(el => el.textContent || '').join(' ');
        const detailsEl = parentActivity?.querySelector('.resourcelinkdetails, .activity-information, [data-region="activity-information"], .activity-altcontent');
        const detailsText = detailsEl ? (detailsEl.textContent || '') : '';
        const linkTitle = a.getAttribute('title') || '';
        const linkAria = a.getAttribute('aria-label') || '';
        const typeHint = `${imgSrc} ${imgAlt} ${accessHideText} ${detailsText} ${linkTitle} ${linkAria}`.trim();

        if (!seenUrls.has(href)) {
          seenUrls.add(href);
          materials.push({
            title,
            url: href,
            type,
            typeHint,
            section: sectionTitle
          });
        }
      }
    }

    if (sectionEls.length > 0) {
      sectionEls.forEach(sec => {
        let secTitle = 'General';
        // First priority: link inside section header (cleanest in Moodle 4)
        const linkEl = sec.querySelector('.sectionname a, .section-title a, [data-for="section_title"] a, .contentheader h3 a');
        if (linkEl && linkEl.textContent && linkEl.textContent.trim()) {
          secTitle = cleanSectionTitle(linkEl.textContent);
        } else {
          const titleEl = sec.querySelector('.sectionname, h3.sectionname, h4.sectionname, .section-title, .contentheader h3, [data-for="section_title"]');
          if (titleEl) {
            const clone = titleEl.cloneNode(true);
            clone.querySelectorAll('.accesshide, button, input, .sr-only, .dropdown, svg, .badge').forEach(el => el.remove());
            secTitle = cleanSectionTitle(clone.innerText || clone.textContent);
          } else {
            const ariaLabel = sec.getAttribute('aria-label');
            if (ariaLabel && ariaLabel.trim()) secTitle = cleanSectionTitle(ariaLabel);
          }
        }
        extractFromContainer(sec, secTitle);
      });
    } else {
      extractFromContainer(doc.body, 'General');
    }

    return materials;
  } catch (err) {
    console.log(`Course materials error for ${courseId}:`, err?.message || err);
    return [];
  }
}

// 3. Direct Course Announcements Fetcher
async function fetchCourseAnnouncements(courseId, courseCode, courseName, minTimestamp = 0) {
  const announcements = [];
  const origin = SPECTRUM_ORIGIN;
  const parser = new DOMParser();

  try {
    const courseRes = await fetchWithTimeout(`${origin}/course/view.php?id=${courseId}`, { credentials: 'include' }, 12000);
    if (!courseRes.ok || courseRes.url.includes('/login/') || courseRes.url.includes('microsoftonline.com')) return [];

    const courseHtml = await courseRes.text();
    const courseDoc = parser.parseFromString(`<base href="${origin}/">${courseHtml}`, 'text/html');

    // Find forum / announcement links
    let forumUrl = '';
    const allLinks = Array.from(courseDoc.querySelectorAll('a[href*="/mod/forum/view.php?id="]'));
    for (const a of allLinks) {
      const text = (a.innerText || '').toLowerCase();
      if (/announcement|pengumuman|news|notis|makluman/i.test(text)) {
        forumUrl = a.href;
        break;
      }
    }
    if (!forumUrl && allLinks.length > 0) {
      forumUrl = allLinks[0].href;
    }

    if (!forumUrl) return [];

    // Fetch forum page
    const forumRes = await fetchWithTimeout(forumUrl, { credentials: 'include' }, 12000);
    if (!forumRes.ok) return [];

    const forumHtml = await forumRes.text();
    const forumDoc = parser.parseFromString(`<base href="${origin}/">${forumHtml}`, 'text/html');

    const discussLinks = Array.from(forumDoc.querySelectorAll('a[href*="/mod/forum/discuss.php?d="]'));
    const seenDiscussions = new Set();

    for (const link of discussLinks) {
      const href = link.href;
      const dMatch = href.match(/d=(\d+)/);
      const discussionId = dMatch ? dMatch[1] : href;
      if (seenDiscussions.has(discussionId)) continue;
      seenDiscussions.add(discussionId);

      const title = (link.innerText || link.getAttribute('title') || '').trim();
      if (!title) continue;

      const container = link.closest('tr, .discussion, [data-region="discussion-list-item"], .forumpost, li') || link.parentElement;

      let author = 'Lecturer';
      let dateStr = 'Recent';
      let timestamp = Date.now();
      let isUnread = false;

      if (container) {
        const authorEl = container.querySelector('.author, [data-region="author-name"], td.author, .userpicture + a');
        if (authorEl && authorEl.innerText.trim()) author = authorEl.innerText.trim();

        const timeEl = container.querySelector('time, [data-region="post-date"], td.lastpost, .created');
        if (timeEl) {
          dateStr = (timeEl.innerText || timeEl.getAttribute('title') || '').trim();
          const datetimeAttr = timeEl.getAttribute('datetime');
          const parsed = Date.parse(datetimeAttr || dateStr);
          if (!isNaN(parsed)) timestamp = parsed;
        }

        isUnread = container.querySelector('.unread, .badge-unread, [data-region="unread-count"]') != null;
      }

      // Fast exit: if announcement is older than cutoff, stop parsing further!
      if (minTimestamp && timestamp < minTimestamp) {
        break;
      }

      announcements.push({
        id: `ann_${courseId}_${discussionId}`,
        courseId,
        courseCode,
        courseName,
        title,
        discussUrl: href,
        discussionId,
        author,
        dateStr,
        timestamp,
        preview: '',
        unread: isUnread
      });
    }
  } catch (err) {
    console.log(`[SPeCTRUM Pro] Failed fetching announcements for course ${courseId}:`, err);
  }

  return announcements;
}

// 4. Direct Course Assignments Fetcher
// 4. Direct Course Assignments Fetcher (Assignments + Quizzes with Deadlines)
async function fetchCourseAssignments(courseId, courseCode, courseName, minTimestamp = 0) {
  const assignments = [];
  const origin = SPECTRUM_ORIGIN;
  const parser = new DOMParser();
  const seenAssignIds = new Set();
  const now = new Date();

  logDiag('Sync:Assign', `[${courseCode || courseId}] ▶ Scanning assignments for ${courseName || courseCode}...`);

  // Strategy 1A: /mod/assign/index.php?id=${courseId}
  try {
    const indexUrl = `${origin}/mod/assign/index.php?id=${courseId}`;
    const res = await fetchWithTimeout(indexUrl, { credentials: 'include' }, 12000);
    if (res.ok && !res.url.includes('/login/') && !res.url.includes('microsoftonline.com')) {
      const html = await res.text();
      const doc = parser.parseFromString(`<base href="${origin}/mod/assign/">${html}`, 'text/html');
      const rows = doc.querySelectorAll('table.generaltable tbody tr, table.generaltable tr, table tbody tr, table tr');

      // Detect header columns by name if present
      let dueColIdx = -1;
      let statusColIdx = -1;
      const ths = Array.from(doc.querySelectorAll('table thead th, table tr:first-child th'));
      ths.forEach((th, idx) => {
        const hText = (th.textContent || '').trim().toLowerCase();
        if (/due|akhir|closing|tutup/i.test(hText)) dueColIdx = idx;
        else if (/status|submission|penghantaran/i.test(hText)) statusColIdx = idx;
      });

      for (const row of Array.from(rows)) {
        if (row.querySelector('th')) continue;
        const link = row.querySelector('a[href*="view.php?id="], a[href*="/mod/assign/view.php"]');
        if (!link) continue;

        let href = link.getAttribute('href') || link.href;
        if (href.startsWith('view.php')) href = `${origin}/mod/assign/${href}`;
        else if (href.startsWith('/')) href = `${origin}${href}`;
        else if (!href.startsWith('http')) href = `${origin}/mod/assign/${href}`;

        const idMatch = href.match(/id=(\d+)/);
        const assignId = idMatch ? idMatch[1] : href;
        if (seenAssignIds.has(assignId)) continue;
        seenAssignIds.add(assignId);

        const title = (link.textContent || link.innerText || '').trim();
        const cols = Array.from(row.querySelectorAll('td'));

        let dueDateStr = '';
        let statusText = 'No attempt';

        let linkColIdx = -1;
        for (let c = 0; c < cols.length; c++) {
          if (cols[c].contains(link)) { linkColIdx = c; break; }
        }

        if (dueColIdx >= 0 && cols[dueColIdx]) {
          dueDateStr = (cols[dueColIdx].textContent || '').trim();
        }
        if (statusColIdx >= 0 && cols[statusColIdx]) {
          statusText = (cols[statusColIdx].textContent || '').trim();
        }

        // If not found via header, scan columns strictly AFTER the link column (never section column 0!)
        if (!dueDateStr) {
          const startCol = linkColIdx >= 0 ? linkColIdx + 1 : 1;
          for (let c = startCol; c < cols.length; c++) {
            const txt = (cols[c].textContent || cols[c].innerText || '').trim();
            if (!txt || txt === '-') continue;
            const parsed = parseMoodleDate(txt, courseName, now);
            if (parsed) {
              dueDateStr = txt;
              break;
            }
          }
        }

        // Positional fallback
        if (!dueDateStr) {
          if (cols.length >= 4 && linkColIdx >= 0 && cols[linkColIdx + 1]) {
            dueDateStr = (cols[linkColIdx + 1].textContent || '').trim();
          } else if (cols.length >= 3 && cols[1] && !cols[1].contains(link)) {
            dueDateStr = (cols[1].textContent || '').trim();
          }
        }

        const parsedMeta = calculateAssignmentTiming(dueDateStr, statusText, now, courseName);

        assignments.push({
          id: `assign_${courseId}_${assignId}`,
          courseId,
          courseCode,
          courseName,
          title,
          url: href,
          dueDateStr: dueDateStr || 'No deadline',
          dueDate: parsedMeta.dueDate,
          statusText,
          isSubmitted: parsedMeta.isSubmitted,
          isOverdue: parsedMeta.isOverdue,
          isDueSoon: parsedMeta.isDueSoon,
          timeRemaining: parsedMeta.timeRemaining,
          badgeClass: parsedMeta.badgeClass,
          badgeLabel: parsedMeta.badgeLabel
        });
        logDiag('Sync:Assign', `[${courseCode || courseId}] Assignment "${title}" -> Due: "${dueDateStr || 'None'}", Parsed: ${parsedMeta.dueDate ? formatDateKey(parsedMeta.dueDate) : 'None'}`);
      }
    }
  } catch (err) {
    console.log(`[SPeCTRUM Pro] Assignment index note for course ${courseId}:`, err);
  }

  // Strategy 1B: Scan Quizzes (/mod/quiz/index.php?id=${courseId}) for online quizzes & test deadlines
  try {
    const quizIndexUrl = `${origin}/mod/quiz/index.php?id=${courseId}`;
    const qRes = await fetchWithTimeout(quizIndexUrl, { credentials: 'include' }, 12000);
    if (qRes.ok && !qRes.url.includes('/login/')) {
      const qHtml = await qRes.text();
      const qDoc = parser.parseFromString(`<base href="${origin}/mod/quiz/">${qHtml}`, 'text/html');
      const qRows = qDoc.querySelectorAll('table.generaltable tbody tr, table.generaltable tr, table tbody tr, table tr');

      let qDueColIdx = -1;
      const qThs = Array.from(qDoc.querySelectorAll('table thead th, table tr:first-child th'));
      qThs.forEach((th, idx) => {
        const hText = (th.textContent || '').trim().toLowerCase();
        if (/close|due|akhir|tutup/i.test(hText)) qDueColIdx = idx;
      });

      for (const row of Array.from(qRows)) {
        if (row.querySelector('th')) continue;
        const link = row.querySelector('a[href*="view.php?id="], a[href*="/mod/quiz/view.php"]');
        if (!link) continue;

        let href = link.getAttribute('href') || link.href;
        if (href.startsWith('view.php')) href = `${origin}/mod/quiz/${href}`;
        else if (href.startsWith('/')) href = `${origin}${href}`;
        else if (!href.startsWith('http')) href = `${origin}/mod/quiz/${href}`;

        const idMatch = href.match(/id=(\d+)/);
        const quizId = idMatch ? idMatch[1] : href;
        if (seenAssignIds.has(quizId)) continue;
        seenAssignIds.add(quizId);

        const title = (link.textContent || link.innerText || '').trim();
        const cols = Array.from(row.querySelectorAll('td'));

        let dueDateStr = '';
        let statusText = 'Not attempted';

        let linkColIdx = -1;
        for (let c = 0; c < cols.length; c++) {
          if (cols[c].contains(link)) { linkColIdx = c; break; }
        }

        if (qDueColIdx >= 0 && cols[qDueColIdx]) {
          dueDateStr = (cols[qDueColIdx].textContent || '').trim();
        }

        if (!dueDateStr) {
          const startCol = linkColIdx >= 0 ? linkColIdx + 1 : 1;
          for (let c = startCol; c < cols.length; c++) {
            const txt = (cols[c].textContent || cols[c].innerText || '').trim();
            if (!txt || txt === '-') continue;
            const parsed = parseMoodleDate(txt, courseName, now);
            if (parsed) {
              dueDateStr = txt;
              break;
            }
            if (/\b\d+(?:\.\d+)?\b/i.test(txt) || /submitted|graded|finished|selesai|attempt/i.test(txt)) {
              statusText = txt;
            }
          }
        }

        const parsedMeta = calculateAssignmentTiming(dueDateStr, statusText, now, courseName);
        parsedMeta.badgeLabel = parsedMeta.isSubmitted ? '✔ Quiz Done' : (parsedMeta.isOverdue ? '⚠️ Quiz Closed' : '⏳ Quiz');

        assignments.push({
          id: `quiz_${courseId}_${quizId}`,
          courseId,
          courseCode,
          courseName,
          title: `Quiz: ${title}`,
          url: href,
          dueDateStr: dueDateStr || 'No deadline',
          dueDate: parsedMeta.dueDate,
          statusText,
          isSubmitted: parsedMeta.isSubmitted,
          isOverdue: parsedMeta.isOverdue,
          isDueSoon: parsedMeta.isDueSoon,
          timeRemaining: parsedMeta.timeRemaining,
          badgeClass: parsedMeta.badgeClass,
          badgeLabel: parsedMeta.badgeLabel
        });
        logDiag('Sync:Assign', `[${courseCode || courseId}] Quiz "${title}" -> Close date: "${dueDateStr || 'None'}", Parsed: ${parsedMeta.dueDate ? formatDateKey(parsedMeta.dueDate) : 'None'}`);
      }
    }
  } catch (qErr) {
    console.log(`[SPeCTRUM Pro] Quiz index note for course ${courseId}:`, qErr);
  }

  // Strategy 2: Scan course/view.php?id=${courseId} for assignments & quizzes directly on course page
  try {
    const courseUrl = `${origin}/course/view.php?id=${courseId}`;
    const res = await fetchWithTimeout(courseUrl, { credentials: 'include' }, 12000);
    if (res.ok && !res.url.includes('/login/')) {
      const html = await res.text();
      const cleanHtml = cleanHtmlForParser(html);
      const doc = parser.parseFromString(`<base href="${origin}/">${cleanHtml}`, 'text/html');
      const directLinks = doc.querySelectorAll('a[href*="/mod/assign/view.php?id="], a[href*="mod/assign/view.php?id="], a[href*="/mod/quiz/view.php?id="], a[href*="mod/quiz/view.php?id="]');

      const itemsToInspect = [];

      for (const link of Array.from(directLinks)) {
        let href = link.getAttribute('href') || link.href;
        if (href.startsWith('/')) href = `${origin}${href}`;
        else if (!href.startsWith('http')) href = `${origin}/${href}`;

        const idMatch = href.match(/id=(\d+)/);
        const itemId = idMatch ? idMatch[1] : href;
        if (seenAssignIds.has(itemId)) continue;
        seenAssignIds.add(itemId);

        let title = '';
        const instanceEl = link.querySelector('.instancename');
        if (instanceEl) {
          const clone = instanceEl.cloneNode(true);
          clone.querySelectorAll('.accesshide').forEach(el => el.remove());
          title = (clone.textContent || clone.innerText || '').trim();
        }
        if (!title) title = (link.textContent || link.innerText || '').trim();
        if (!title) title = href.includes('/quiz/') ? 'Quiz' : 'Assignment';

        const parentActivity = link.closest('.activity, li.activity, .activityinstance') || link.parentElement;
        let dueDateStr = '';
        let statusText = 'Not submitted';

        if (parentActivity) {
          const dateEl = parentActivity.querySelector('.activity-dates, .text-muted, [data-region="activity-dates"], .activity-information, [data-region="activity-information"]');
          if (dateEl) {
            const dateText = (dateEl.textContent || dateEl.innerText || '').trim();
            const dueMatch = dateText.match(/(?:Due|Tarikh akhir|Tarikh tutup|Tarikh tamat|Tarikh hantar|Due date|Closes|Closed|Tutup|Deadline|Ends):\s*([^\n\r,]+(?:,\s*[^\n\r]+)?)/i);
            if (dueMatch) dueDateStr = dueMatch[1].trim();
            else dueDateStr = dateText;
          }
          const completionEl = parentActivity.querySelector('.completion-info, .badge, [data-region="completion-info"]');
          if (completionEl) {
            statusText = (completionEl.textContent || completionEl.innerText || '').trim();
          }
        }

        // If dueDateStr is still missing, queue for detailed page inspection (limit to 15)
        if (!dueDateStr && itemsToInspect.length < 15) {
          itemsToInspect.push({ itemId, href, title, statusText });
        } else {
          const parsedMeta = calculateAssignmentTiming(dueDateStr, statusText, now, courseName);
          assignments.push({
            id: `assign_${courseId}_${itemId}`,
            courseId,
            courseCode,
            courseName,
            title,
            url: href,
            dueDateStr: dueDateStr || 'No deadline',
            dueDate: parsedMeta.dueDate,
            statusText,
            isSubmitted: parsedMeta.isSubmitted,
            isOverdue: parsedMeta.isOverdue,
            isDueSoon: parsedMeta.isDueSoon,
            timeRemaining: parsedMeta.timeRemaining,
            badgeClass: parsedMeta.badgeClass,
            badgeLabel: parsedMeta.badgeLabel
          });
          logDiag('Sync:Assign', `[${courseCode || courseId}] Course page item "${title}" -> Due: "${dueDateStr || 'None'}", Parsed: ${parsedMeta.dueDate ? formatDateKey(parsedMeta.dueDate) : 'None'}`);
        }
      }

      // Fast parallel fetch for items with missing dates
      if (itemsToInspect.length > 0) {
        await Promise.all(itemsToInspect.map(async (item) => {
          try {
            const itemRes = await fetchWithTimeout(item.href, { credentials: 'include' }, 10000);
            if (itemRes.ok) {
              const itemHtml = await itemRes.text();
              const itemDoc = parser.parseFromString(cleanHtmlForParser(itemHtml), 'text/html');

              let dStr = '';
              let sStr = item.statusText;

              const tableRows = itemDoc.querySelectorAll('table.generaltable tr, table.submissionstatustable tr, table tr');
              for (const tr of Array.from(tableRows)) {
                const header = (tr.querySelector('th, td:first-child')?.textContent || '').trim();
                const value = (tr.querySelector('td:last-child')?.textContent || '').trim();
                if (/due date|tarikh akhir|closing date|closes|tarikh tutup/i.test(header) && value) {
                  dStr = value;
                } else if (/submission status|status penghantaran|grading status/i.test(header) && value) {
                  sStr = value;
                }
              }

              if (!dStr) {
                const infoBox = itemDoc.querySelector('.quizinfo, [data-region="activity-dates"], .activity-information, .activity-dates');
                if (infoBox) {
                  const m = (infoBox.textContent || '').match(/(?:close|closed|due|tutup|akhir)[^:\d]*[:\s]+([^\n\r]+)/i);
                  if (m) dStr = m[1].trim();
                }
              }

              const parsedMeta = calculateAssignmentTiming(dStr, sStr, now, courseName);
              assignments.push({
                id: `assign_${courseId}_${item.itemId}`,
                courseId,
                courseCode,
                courseName,
                title: item.title,
                url: item.href,
                dueDateStr: dStr || 'No deadline',
                dueDate: parsedMeta.dueDate,
                statusText: sStr,
                isSubmitted: parsedMeta.isSubmitted,
                isOverdue: parsedMeta.isOverdue,
                isDueSoon: parsedMeta.isDueSoon,
                timeRemaining: parsedMeta.timeRemaining,
                badgeClass: parsedMeta.badgeClass,
                badgeLabel: parsedMeta.badgeLabel
              });
              logDiag('Sync:Assign', `[${courseCode || courseId}] Detail page item "${item.title}" -> Due: "${dStr || 'None'}", Parsed: ${parsedMeta.dueDate ? formatDateKey(parsedMeta.dueDate) : 'None'}`);
            }
          } catch (itemErr) {
            console.log(`[SPeCTRUM Pro] Assignment detail note:`, itemErr?.message || itemErr);
          }
        }));
      }
    }
  } catch (err) {
    console.log(`[SPeCTRUM Pro] Course view assignments note for course ${courseId}:`, err);
  }

  return assignments;
}

// Intelligent Moodle Date Parser with Multi-Language (EN/BM) & Academic Year Inference
function parseMoodleDate(str, courseName = '', now = new Date()) {
  if (!str) return null;
  let clean = String(str).replace(/[\u00a0\s]+/g, ' ').trim();
  clean = clean.replace(/^(Due|Opened|Due date|Tarikh akhir|Tarikh tutup|Tarikh tamat|Tarikh serahan|Tarikh hantar|Closing date|Session|Tarikh|Closes|Closed|Buka|Tutup|Deadline|Ends|Cut-off date):\s*/i, '').trim();
  if (!clean || clean === '-' || /none|no due|no deadline|tiada/i.test(clean)) return null;

  // If string contains embedded close/due marker (e.g. 'Opens: ... Closes: ...')
  const closeSubMatch = clean.match(/(?:Due|Tarikh akhir|Tarikh tutup|Tarikh tamat|Tarikh hantar|Closes|Closed|Tutup|Deadline):\s*([^\n\r]+)/i);
  if (closeSubMatch) {
    clean = closeSubMatch[1].trim();
  }

  // If string contains a date range e.g. "12 October - 18 October" or "12 - 18 October", extract the ending deadline
  const rangeMatch = clean.match(/\s+[-–]\s+([0-9]{1,2}(?:\s+[A-Za-z]+|\s*[\/\-\.][0-9]{1,2})[^\n\r]*)$/);
  if (rangeMatch) {
    clean = rangeMatch[1].trim();
  }

  // Handle relative days (Today / Tomorrow / Yesterday / Hari ini / Esok / Semalam)
  if (/\b(today|hari ini)\b/i.test(clean)) {
    const timeMatch = clean.match(/(\d{1,2})[:\.](\d{2})(?:\s*(AM|PM))?/i);
    let hours = 23, mins = 59;
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      mins = parseInt(timeMatch[2], 10);
      if (timeMatch[3]) {
        const isPM = timeMatch[3].toUpperCase() === 'PM';
        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;
      }
    }
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins, 0);
  }
  if (/\b(tomorrow|esok)\b/i.test(clean)) {
    const timeMatch = clean.match(/(\d{1,2})[:\.](\d{2})(?:\s*(AM|PM))?/i);
    let hours = 23, mins = 59;
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      mins = parseInt(timeMatch[2], 10);
      if (timeMatch[3]) {
        const isPM = timeMatch[3].toUpperCase() === 'PM';
        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;
      }
    }
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hours, mins, 0);
  }

  // Handle relative day count: e.g. "Due in 4 days", "4 days remaining", "Due in 4d", "baki 4 hari", "dalam 4 hari"
  const relDayMatch = clean.match(/(?:due in|in|baki|dalam)?\s*(\d+)\s*(?:days?|hari|d)\b/i);
  if (relDayMatch) {
    const days = parseInt(relDayMatch[1], 10);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 0);
  }

  // Handle relative hour count: e.g. "Due in 4 hours", "4 hours remaining", "Due in 4h"
  const relHrMatch = clean.match(/(?:due in|in|baki|dalam)?\s*(\d+)\s*(?:hours?|jam|h)\b/i);
  if (relHrMatch) {
    const hrs = parseInt(relHrMatch[1], 10);
    return new Date(now.getTime() + hrs * 3600 * 1000);
  }

  // Handle "lusa" (day after tomorrow)
  if (/\b(lusa)\b/i.test(clean)) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 23, 59, 0);
  }

  // 0. Separate year immediately attached to time (e.g. "202612PM" -> "2026 12PM" or "202611AM" -> "2026 11AM")
  clean = clean.replace(/(\b20\d{2})(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/gi, '$1 $2');
  clean = clean.replace(/(\b20\d{2})(\d{1,2})/g, '$1 $2');

  // 1. Strip weekday names in English and Malay (full and 3-letter abbreviations)
  clean = clean.replace(/\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Isnin|Selasa|Rabu|Khamis|Jumaat|Sabtu|Ahad|Isn|Sel|Rab|Kha|Jum|Sab|Ahd)\)/gi, ' ');
  clean = clean.replace(/\b(Isnin|Selasa|Rabu|Khamis|Jumaat|Sabtu|Ahad)\b/gi, ' ');
  clean = clean.replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi, ' ');
  clean = clean.replace(/\b(Isn|Sel|Rab|Kha|Jum|Sab|Ahd)\b/gi, ' ');
  clean = clean.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi, ' ');

  // 2. Translate Malay month names to English
  const malayMonths = {
    'januari': 'January', 'februari': 'February', 'mac': 'March',
    'april': 'April', 'mei': 'May', 'jun': 'June',
    'julai': 'July', 'ogos': 'August', 'september': 'September',
    'oktober': 'October', 'okt': 'Oct', 'november': 'November',
    'disember': 'December', 'dis': 'Dec'
  };
  for (const [m, eng] of Object.entries(malayMonths)) {
    clean = clean.replace(new RegExp('\\b' + m + '\\b', 'gi'), eng);
  }

  // Must contain either an English month name or a numeric date separator pattern
  const hasMonth = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(clean);
  const hasNumericDate = /\b\d{1,2}[\/\-]\d{1,2}\b|\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?\b|\b20\d{2}[\/\-\.]\d{1,2}\b/.test(clean);
  if (!hasMonth && !hasNumericDate) {
    return null;
  }

  // 3. Convert Malay time indicators (pagi/pg -> AM, petang/ptg/malam/mlm -> PM)
  clean = clean.replace(/\b(pagi|pg)\b/gi, 'AM');
  clean = clean.replace(/\b(petang|ptg|malam|mlm)\b/gi, 'PM');
  clean = clean.replace(/\b(tengah hari|tengahari|th)\b/gi, 'PM');

  // 4. Remove time range tail e.g. ' - 10:00 AM' (without stripping hyphen in DD-MM-YYYY)
  clean = clean.replace(/\s+-\s+\d{1,2}(?:[:\.]\d{2})?(?:\s*(?:AM|PM))?/i, '');

  // 5. Normalize dot-time or colon-time before AM/PM
  clean = clean.replace(/(\d{1,2})\.(\d{2})\s*(AM|PM)/gi, '$1:$2 $3');
  clean = clean.replace(/(\d{1,2}:\d{2})\s*(AM|PM)/i, '$1 $2');
  clean = clean.replace(/\b(\d{1,2})\s*(AM|PM)/i, '$1:00 $2');

  clean = clean.replace(/[\(\)]/g, ' ');
  clean = clean.trim().replace(/^,\s*/, '').replace(/\s+,/g, ',').replace(/\s+/g, ' ');

  // 6. Pattern A: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY or DD/MM/YY
  const dmyMatch = clean.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(.*)$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    const rest = dmyMatch[4].trim();
    let hours = 12, mins = 0;
    const timeMatch = rest.match(/(\d{1,2})[:\.](\d{2})(?:\s*(AM|PM))?/i);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      mins = parseInt(timeMatch[2], 10);
      if (timeMatch[3]) {
        const isPM = timeMatch[3].toUpperCase() === 'PM';
        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;
      }
    }
    const d = new Date(year, month - 1, day, hours, mins, 0);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return d;
  }

  // Deduce correct academic year upfront
  let targetYear = now.getFullYear();
  const sessMatch = courseName ? courseName.match(/20(\d{2})\/20(\d{2})/) : null;
  const monthMatch = clean.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);

  if (sessMatch) {
    const startYr = 2000 + parseInt(sessMatch[1], 10);
    const endYr = 2000 + parseInt(sessMatch[2], 10);
    if (monthMatch) {
      const m = monthMatch[1].toLowerCase().slice(0, 3);
      const isFirstHalf = ['sep', 'oct', 'nov', 'dec'].includes(m);
      targetYear = isFirstHalf ? startYr : endYr;
    } else {
      // Default to start year for first semester (Sep-Dec), end year for second semester (Jan-Jun)
      const curM = now.getMonth();
      targetYear = (curM >= 8 && curM <= 11) ? startYr : endYr;
    }
  } else if (monthMatch) {
    const mStr = monthMatch[1].toLowerCase().slice(0, 3);
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const targetMonthIdx = monthNames.indexOf(mStr);
    const currentMonthIdx = now.getMonth();
    if (targetMonthIdx - currentMonthIdx > 6) {
      targetYear = now.getFullYear() - 1;
    } else {
      targetYear = now.getFullYear();
    }
  }

  // Pattern A2: DD/MM or DD.MM without year (e.g. 23.10, 23/10)
  const dmNoYearMatch = clean.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:\s+(.*))?$/);
  if (dmNoYearMatch) {
    const day = parseInt(dmNoYearMatch[1], 10);
    const month = parseInt(dmNoYearMatch[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      let hours = 12, mins = 0;
      const rest = (dmNoYearMatch[3] || '').trim();
      const timeMatch = rest.match(/(\d{1,2})[:\.](\d{2})(?:\s*(AM|PM))?/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        mins = parseInt(timeMatch[2], 10);
        if (timeMatch[3]) {
          const isPM = timeMatch[3].toUpperCase() === 'PM';
          if (isPM && hours < 12) hours += 12;
          if (!isPM && hours === 12) hours = 0;
        }
      }
      let chosenYear = targetYear;
      if (sessMatch) {
        const startYr = 2000 + parseInt(sessMatch[1], 10);
        const endYr = 2000 + parseInt(sessMatch[2], 10);
        chosenYear = (month >= 8 && month <= 12) ? startYr : endYr;
      }
      const d = new Date(chosenYear, month - 1, day, hours, mins, 0);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 7. Pattern B: Explicit 4-digit year already present (e.g. 23 Oct 2026, 9 January 2026)
  const explicitYearMatch = clean.match(/\b(20\d{2})\b/);
  if (explicitYearMatch) {
    const p = Date.parse(clean);
    if (!isNaN(p)) {
      const d = new Date(p);
      if (d.getFullYear() >= 2020) return d;
    }
  }

  // 8. Pattern C: Missing year - deduce correct academic year (requires month match)
  if (!monthMatch) return null;
  const mIdx = clean.indexOf(monthMatch[0]) + monthMatch[0].length;
  const withYear = clean.slice(0, mIdx) + ' ' + targetYear + clean.slice(mIdx);

  const p = Date.parse(withYear);
  if (!isNaN(p)) {
    const parsedDate = new Date(p);
    if (parsedDate.getFullYear() >= 2020) {
      return parsedDate;
    }
  }

  return null;
}

function calculateAssignmentTiming(dueDateStr, statusText, now = new Date(), courseName = '') {
  const isSubmitted = /submitted|graded|hantar|done|complete/i.test(statusText);
  let dueDate = parseMoodleDate(dueDateStr, courseName, now);
  if (!dueDate && dueDateStr) {
    const dMatch = dueDateStr.match(/(?:due in|in|baki|dalam)?\s*(\d+)\s*(?:d|days?|hari)\b/i);
    const hMatch = dueDateStr.match(/(?:due in|in|baki|dalam)?\s*(\d+)\s*(?:h|hours?|jam)\b/i);
    if (dMatch) {
      const days = parseInt(dMatch[1], 10);
      dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 0);
    } else if (hMatch) {
      const hrs = parseInt(hMatch[1], 10);
      dueDate = new Date(now.getTime() + hrs * 3600 * 1000);
    }
  }
  let isOverdue = false;
  let isDueSoon = false;
  let timeRemaining = '';

  if (dueDate) {
    const diffMs = dueDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

    if (!isSubmitted) {
      if (diffMs < 0) {
        isOverdue = true;
        const absDays = Math.abs(diffDays);
        if (absDays === 0) {
          timeRemaining = 'Overdue today';
        } else if (absDays === 1) {
          timeRemaining = 'Overdue by 1d';
        } else {
          timeRemaining = `Overdue by ${absDays}d`;
        }
      } else if (diffHours <= 72) {
        isDueSoon = true;
        if (diffHours <= 24) {
          timeRemaining = `Due in ${Math.max(1, diffHours)}h`;
        } else {
          timeRemaining = `Due in ${diffDays}d`;
        }
      } else {
        timeRemaining = `Due in ${diffDays}d`;
      }
    }
  }

  let badgeClass = 'badge-due-ok';
  let badgeLabel = 'Upcoming';

  if (isSubmitted) {
    badgeClass = 'badge-submitted';
    badgeLabel = '✔ Submitted';
  } else if (isOverdue) {
    badgeClass = 'badge-due-urgent';
    badgeLabel = '⚠️ Overdue';
  } else if (isDueSoon) {
    badgeClass = 'badge-due-warning';
    badgeLabel = '⏳ Due Soon';
  }

  return { dueDate, isSubmitted, isOverdue, isDueSoon, timeRemaining, badgeClass, badgeLabel };
}

// 5. Direct Course Attendance Fetcher (Lightning-Fast: Early OCC Prune + Current & Future 1 Only)
async function fetchCourseAttendance(courseId, courseCode, courseName, userOcc, minTimestamp = 0) {
  const origin = SPECTRUM_ORIGIN;
  const parser = new DOMParser();
  const attendancesFound = [];
  const now = new Date();
  const userOccNum = userOcc ? parseInt(String(userOcc).replace(/\D/g, ''), 10) : NaN;
  const hasUserOcc = !isNaN(userOccNum);

  logDiag('Attendance', `[${courseId}] ▶ Scanning attendance for ${courseCode || courseName} (OCC pref: "${userOcc || 'None'}")`);

  try {
    const candidateLinks = [];

    function addCandidate(rawUrl, label = '', source = '') {
      if (!rawUrl) return;
      let u = String(rawUrl).replace(/&amp;/g, '&').trim();
      if (!u || u.startsWith('javascript:') || u === '#') return;

      const anchorMatch = u.match(/#(?:coursecontentcollapse|module-)(\d+)/);
      if (anchorMatch) {
        const cmid = anchorMatch[1];
        u = `${origin}/mod/attendance/view.php?id=${cmid}`;
      } else {
        if (u.startsWith('//')) u = 'https:' + u;
        else if (u.startsWith('/')) u = `${origin}${u}`;
        else if (!u.startsWith('http')) {
          u = u.includes('mod/attendance') ? `${origin}/${u}` : `${origin}/mod/attendance/${u}`;
        }
        u = u.replace(/\/mod\/attendance\/\.\//, '/mod/attendance/').split('#')[0];
      }

      if (!u.includes('/mod/attendance/') && !u.includes('attendance/view.php')) return;
      if (!/(?:view|take)\.php\?.*id=\d+/i.test(u)) return;

      // Early Network-Level OCC Pruning!
      if (hasUserOcc && label) {
        const labelOccs = extractOccs(label);
        if (labelOccs.length > 0 && !labelOccs.includes(userOccNum)) {
          logDiag('Attendance:Prune', `[${courseId}] ⚡ Pruned non-matching OCC activity "${label.slice(0, 45)}" (requires OCC ${labelOccs.join(',')}, user is OCC ${userOccNum})`);
          return;
        }
      }

      if (!candidateLinks.some(c => c.url === u)) {
        candidateLinks.push({ url: u, label: label || 'Attendance' });
        logDiag('Attendance:Found', `[${courseId}] Added candidate (${source}): "${label || 'Attendance'}" -> ${u}`);
      }
    }

    // Strategy 1: Check Moodle attendance index (/mod/attendance/index.php?id=${courseId})
    try {
      const indexUrl = `${origin}/mod/attendance/index.php?id=${courseId}`;
      const indexRes = await fetchWithTimeout(indexUrl, { credentials: 'include' }, 12000);
      logDiag('Attendance:Index', `[${courseId}] mod/attendance/index.php -> HTTP ${indexRes.status} (Final: ${indexRes.url})`);
      if (indexRes.ok && !indexRes.url.includes('/login/') && !indexRes.url.includes('microsoftonline.com')) {
        if (indexRes.url.includes('/mod/attendance/view.php')) {
          // Direct single-attendance redirect
          addCandidate(indexRes.url, 'Course Attendance', 'index-redirect');
        } else {
          const indexHtml = await indexRes.text();
          const indexDoc = parser.parseFromString(`<base href="${origin}/mod/attendance/">${indexHtml}`, 'text/html');

          // Process index table rows
          indexDoc.querySelectorAll('table.generaltable tr, table tr').forEach(row => {
            const a = row.querySelector('a[href*="view.php"], a[href*="take.php"]');
            if (a) {
              const fullRowText = (row.textContent || '').trim().replace(/\s+/g, ' ');
              const linkText = (a.textContent || '').trim();
              const label = `${fullRowText} ${linkText}`.trim();
              addCandidate(a.getAttribute('href') || a.href, label, 'index-table-row');
            }
          });

          // Any other links on index page
          if (candidateLinks.length === 0) {
            indexDoc.querySelectorAll('a[href*="view.php"], a[href*="take.php"]').forEach(a => {
              addCandidate(a.getAttribute('href') || a.href, (a.textContent || '').trim(), 'index-any-a');
            });
          }
        }
      }
    } catch (idxErr) {
      logDiag('Attendance:Index', `[${courseId}] index.php note: ${idxErr?.message || idxErr}`);
    }

    // Strategy 2: Fallback ONLY if index.php did not yield any candidates
    if (candidateLinks.length === 0) {
      logDiag('Attendance:Fallback', `[${courseId}] index.php found 0 candidates. Falling back to course view / drawer...`);
      try {
        const courseUrl = `${origin}/course/view.php?id=${courseId}`;
        const courseRes = await fetchWithTimeout(courseUrl, { credentials: 'include' }, 12000);
        if (courseRes.ok && !courseRes.url.includes('/login/') && !courseRes.url.includes('microsoftonline.com')) {
          const courseHtml = await courseRes.text();
          const courseDoc = parser.parseFromString(`<base href="${origin}/">${courseHtml}`, 'text/html');

          // Check drawer / sidelist
          courseDoc.querySelectorAll('#courseindex a, .courseindex a, [data-region="course-index"] a, nav.courseindex a, .course-index a, .courseindex-item').forEach(el => {
            const txt = (el.textContent || '').trim();
            if (!/attendance|kehadiran|kedatangan/i.test(txt)) return;
            const a = el.tagName === 'A' ? el : el.querySelector('a');
            const rawHref = a ? (a.getAttribute('href') || a.href || '') : '';
            addCandidate(rawHref, txt, 'sidelist');
          });

          // Check standard activities in body
          courseDoc.querySelectorAll('a[href*="/mod/attendance/"], li.modtype_attendance a, .activity.attendance a, a.aalink[href*="attendance"], .activity-item[data-activityname*="Attendance" i] a').forEach(a => {
            const sectionEl = a.closest('.section, .course-section, [data-region="section"]');
            const sectionTitle = sectionEl ? (sectionEl.querySelector('.sectionname, .section-title, h3, h4')?.textContent || '') : '';
            const parentText = a.closest('.activity, .activity-item, li, tr')?.textContent || '';
            const linkText = a.textContent || '';
            const label = `${sectionTitle} ${linkText} ${parentText}`.trim().replace(/\s+/g, ' ');
            addCandidate(a.getAttribute('href') || a.href, label, 'course-activity');
          });
        }
      } catch (cErr) {
        logDiag('Attendance:Fallback', `[${courseId}] course view fallback error: ${cErr?.message || cErr}`);
      }
    }

    logDiag('Attendance:Total', `[${courseId}] Scanning ${candidateLinks.length} target attendance instance(s): ` + candidateLinks.map(c => `"${c.label}"`).join(', '));

    if (candidateLinks.length === 0) {
      logDiag('Attendance:Total', `[${courseId}] 0 attendance activities found.`);
      return null;
    }

    // Helper to parse sessions from attendance document table
    function parseSessionsFromDoc(doc) {
      if (!doc) return [];
      const list = [];
      const rows = doc.querySelectorAll('table.userattendance tr, table.generaltable tr, table.attlist tr, table.attwidth tr, table tr');

      for (const row of Array.from(rows)) {
        if (row.closest('thead')) continue;
        const ths = row.querySelectorAll('th');
        const tds = row.querySelectorAll('td');
        if (tds.length === 0 && ths.length > 0) continue;

        const rowText = (row.textContent || '').trim();
        if (/taken sessions|points over|percentage over|peratusan kehadiran|sesi diambil/i.test(rowText)) {
          continue;
        }

        const cols = Array.from(row.querySelectorAll('th, td'));
        if (cols.length < 2) continue;

        let sessDate = null;
        let dateColText = '';
        let descColText = '';
        let statusColText = '';

        let timeColText = '';

        for (let c = 0; c < cols.length; c++) {
          const col = cols[c];
          const txt = (col?.textContent || col?.innerText || '').trim();
          if (!txt || txt === '-') continue;

          if (/^\s*#?\d+\s*$/.test(txt)) continue;

          // Check if column contains a time or time range
          const extractedTime = extractOnlyTime(txt);
          if (extractedTime && !timeColText && (/\b(am|pm)\b/i.test(extractedTime) || /\d{1,2}[:.]\d{2}\s*(?:[-–—~]|to)\s*\d{1,2}[:.]\d{2}/.test(extractedTime))) {
            timeColText = extractedTime;
            continue;
          }

          if (!sessDate) {
            const parsed = parseMoodleDate(txt, courseName, now);
            if (parsed) {
              sessDate = parsed;
              dateColText = txt;
              const embeddedTime = extractOnlyTime(txt);
              if (embeddedTime && embeddedTime !== txt && !timeColText) {
                timeColText = embeddedTime;
              }
              continue;
            }
          }

          if (/present|hadir|late|lewat|absent|tidak|excused|dimaafkan|\b[PHLAE]\b|\d+\s*\/\s*\d+|points|mata|\?/i.test(txt) || (col.classList && col.classList.contains('status'))) {
            if (!statusColText) statusColText = txt;
          } else if (!descColText) {
            descColText = txt;
          }
        }

        // Secondary fallback: check entire row text for time range
        if (!timeColText) {
          const rowExtracted = extractOnlyTime(rowText);
          if (rowExtracted && rowExtracted !== rowText) {
            timeColText = rowExtracted;
          }
        }

        if (sessDate && !isNaN(sessDate.getTime())) {
          const isFuture = sessDate.getTime() > now.getTime();
          const isToday = formatDateKey(sessDate) === formatDateKey(now);
          const isPresent = /present|hadir|\b[PH]\b|2\s*\/\s*2|100%/i.test(statusColText);
          const isLate = /late|lewat|\bL\b/i.test(statusColText);
          const isAbsent = /absent|tidak\s*hadir|ponteng|\bA\b|0\s*\/\s*2/i.test(statusColText);
          const isExcused = /excused|dimaafkan|\bE\b/i.test(statusColText);

          let statusType = 'scheduled';
          let statusLabel = '⏳ Scheduled';

          if (row.querySelector('a[href*="sessid="]')) {
            statusType = 'active';
            statusLabel = '🟢 OPEN NOW';
          } else if (isPresent) {
            statusType = 'present';
            statusLabel = '✔ Present';
          } else if (isLate) {
            statusType = 'late';
            statusLabel = '⚠️ Late';
          } else if (isAbsent) {
            statusType = 'absent';
            statusLabel = '❌ Absent';
          } else if (isExcused) {
            statusType = 'excused';
            statusLabel = 'ℹ️ Excused';
          } else if (isFuture) {
            statusType = 'future';
            statusLabel = '⏳ Scheduled';
          } else {
            statusType = 'unrecorded';
            statusLabel = (statusColText === '?' || !statusColText) ? 'Unrecorded' : statusColText;
          }

          // Check if row has OCC numbers
          let occMatches = true;
          if (hasUserOcc) {
            const rowOccs = extractOccs(row.textContent || '');
            if (rowOccs.length > 0 && !rowOccs.includes(userOccNum)) {
              occMatches = false;
            }
          }

          if (occMatches) {
            const finalTime = timeColText || (sessDate && (sessDate.getHours() !== 0 || sessDate.getMinutes() !== 0) ? `${String(sessDate.getHours()).padStart(2, '0')}:${String(sessDate.getMinutes()).padStart(2, '0')}` : '');
            const finalDateStr = (finalTime && !dateColText.includes(finalTime)) ? `${dateColText} ${finalTime}` : dateColText;
            list.push({
              date: sessDate,
              dateKey: formatDateKey(sessDate),
              dateStr: finalDateStr,
              time: finalTime,
              desc: descColText || 'Class Session',
              status: statusColText || statusLabel,
              statusType,
              statusLabel,
              isFuture,
              isToday,
              isPresent
            });
          }
        }
      }
      return list;
    }

    for (let i = 0; i < candidateLinks.length; i++) {
      const { url: fullAttUrl, label: initialLabel } = candidateLinks[i];
      let attHtml = '';

      // 1. Fetch default view (ONLY 1 HTTP request per instance!)
      try {
        const res = await fetchWithTimeout(fullAttUrl, { credentials: 'include' }, 12000);
        logDiag('Attendance:Inst', `[${courseId}] [${i + 1}/${candidateLinks.length}] HTTP ${res.status} ("${initialLabel}")`);
        if (res.ok && !res.url.includes('/login/')) {
          attHtml = await res.text();
        }
      } catch (err) {
        logDiag('Attendance:Inst', `[${courseId}] Fetch error on ${fullAttUrl}: ${err?.message || err}`);
      }

      if (!attHtml) continue;

      // Skip restricted / locked attendance activities where the student lacks permission
      if (/you do not have permission|tiada kebenaran|not available unless|access denied|tidak dibenarkan/i.test(attHtml)) {
        logDiag('Attendance:Inst', `[${courseId}] 🔒 Restricted activity (student lacks permission) for "${initialLabel}"`);
        continue;
      }

      const attDoc = parser.parseFromString(attHtml, 'text/html');

      // Extract title
      let attTitle = initialLabel || '';
      const h2El = attDoc.querySelector('h2, .page-header-headings h1, .page-header-headings h2, .breadcrumb-item.active, h1');
      if (h2El) {
        const extracted = (h2El.textContent || h2El.innerText || '').trim();
        if (extracted && extracted !== 'Attendance') attTitle = extracted;
      }

      // Check OCC in title / breadcrumb / heading
      const pageHeading = (attDoc.querySelector('.page-header-headings, .breadcrumb, h1, h2')?.textContent || '').trim();
      const titleOccs = extractOccs(attTitle);
      const headingOccs = extractOccs(pageHeading);
      const combinedTitleOccs = Array.from(new Set([...titleOccs, ...headingOccs]));

      if (hasUserOcc && combinedTitleOccs.length > 0 && !combinedTitleOccs.includes(userOccNum)) {
        logDiag('Attendance:Inst', `[${courseId}] Activity "${attTitle}" is specifically for OCC ${combinedTitleOccs.join(',')}, user is OCC ${userOccNum}. Skipping.`);
        continue;
      }

      const detectedOccs = extractOccs(attTitle + ' ' + (attDoc.body?.textContent?.slice(0, 3000) || ''));
      if (hasUserOcc && detectedOccs.length === 1 && detectedOccs[0] !== userOccNum) {
        logDiag('Attendance:Inst', `[${courseId}] Activity is specifically for OCC ${detectedOccs[0]}, user is OCC ${userOccNum}. Skipping.`);
        continue;
      }

      // 2. Active Session Detection (Submit attendance link open right now)
      let activeSession = null;
      const takeMatch = attHtml.match(/href=["']([^"']*(?:attendance\.php\?sessid=\d+|take\.php\?sessid=\d+)[^"']*)["'][^>]*>([^<]*)/i);
      let takeEl = attDoc.querySelector('a[href*="attendance.php?sessid="], a[href*="take.php?sessid="], a[href*="sessid="], a.takeattendance');
      if (!takeEl) {
        takeEl = Array.from(attDoc.querySelectorAll('a')).find(a => /submit attendance|hantar kehadiran|rekod kehadiran|take attendance/i.test(a.textContent || ''));
      }

      let rawTakeUrl = takeMatch ? takeMatch[1].replace(/&amp;/g, '&') : (takeEl ? (takeEl.getAttribute('href') || takeEl.href || '').replace(/&amp;/g, '&') : '');
      if (rawTakeUrl) {
        let fullTakeUrl = rawTakeUrl;
        if (fullTakeUrl.startsWith('attendance.php') || fullTakeUrl.startsWith('take.php')) {
          fullTakeUrl = `${origin}/mod/attendance/${fullTakeUrl}`;
        } else if (fullTakeUrl.startsWith('/')) {
          fullTakeUrl = `${origin}${fullTakeUrl}`;
        }

        const sessidMatch = fullTakeUrl.match(/sessid=(\d+)/);
        const sessid = sessidMatch ? sessidMatch[1] : '';

        let sessionDesc = 'Regular Class';
        const sessionRow = takeEl ? takeEl.closest('tr') : null;
        if (sessionRow) {
          const descCol = sessionRow.querySelector('td.c2, td.description') || sessionRow.querySelector('td:nth-child(3)');
          const text = (descCol?.textContent || descCol?.innerText || '').trim();
          if (text) sessionDesc = text;
        }

        let shouldInclude = true;
        if (hasUserOcc) {
          const sessionText = sessionRow ? (sessionRow.textContent || sessionRow.innerText || '') : attHtml;
          const occsInSess = extractOccs(sessionText);
          if (occsInSess.length > 0 && !occsInSess.includes(userOccNum)) {
            shouldInclude = false;
          }
        }

        if (shouldInclude) {
          let sesskey = '';
          let hasPasswordInput = false;
          let presentStatusId = '';

          try {
            const formRes = await fetchWithTimeout(fullTakeUrl, { credentials: 'include' }, 12000);
            if (formRes.ok) {
              const formHtml = await formRes.text();
              const formDoc = parser.parseFromString(formHtml, 'text/html');

              // Scope strictly to the attendance form (contains input[name="status"] or action*="attendance.php")
              const attForm = formDoc.querySelector('form[action*="attendance.php"], form[action*="take.php"], form.mform') ||
                              Array.from(formDoc.querySelectorAll('form')).find(f => f.querySelector('input[name="status"]'));

              const sesskeyInput = (attForm ? attForm.querySelector('input[name="sesskey"]') : null) ||
                                   formDoc.querySelector('input[name="sesskey"]') ||
                                   attDoc.querySelector('input[name="sesskey"]');
              sesskey = sesskeyInput ? sesskeyInput.value : '';
              if (!sesskey) {
                const skm = formHtml.match(/name="sesskey"\s+value="([^"]+)"/) || attHtml.match(/sesskey=([a-zA-Z0-9]+)/);
                if (skm) sesskey = skm[1];
              }

              // Check for password/PIN input ONLY inside the verified attendance form itself!
              hasPasswordInput = attForm
                ? (attForm.querySelector('input[type="password"], input[name="studentpassword"], input[name="password"], input[name="qrpass"]') != null)
                : false;

              const radioEls = attForm ? attForm.querySelectorAll('input[type="radio"][name="status"]') : formDoc.querySelectorAll('input[type="radio"][name="status"]');
              for (const radio of radioEls) {
                const label = (radio.closest('label')?.textContent || radio.closest('label')?.innerText || '');
                if (/present|hadir|p\b/i.test(label) || !presentStatusId) {
                  presentStatusId = radio.value;
                  if (/present|hadir/i.test(label)) break;
                }
              }

              if (!presentStatusId) {
                const rMatch = formHtml.match(/<input[^>]+type="radio"[^>]+name="status"[^>]+value="(\d+)"/i);
                if (rMatch) presentStatusId = rMatch[1];
              }
            }
          } catch (fErr) {
            logDiag('Attendance:Form', `[${courseId}] Form fetch note: ${fErr?.message || fErr}`);
          }

          activeSession = {
            sessid,
            sesskey,
            takeUrl: fullTakeUrl,
            desc: sessionDesc,
            time: 'Active now',
            requiresPassword: hasPasswordInput,
            presentStatusId
          };
          logDiag('Attendance:ActiveNow', `[${courseId}] 🟢 Found OPEN attendance session! Desc: "${sessionDesc}", Requires PIN: ${hasPasswordInput}`);
        }
      }

      // 3. Parse all sessions present in the default view
      const allSessions = parseSessionsFromDoc(attDoc);
      allSessions.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Extract overall Attendance Stats from attDoc text if present
      let pastStats = null;
      const docText = attDoc.body?.textContent || '';
      const percentageMatch = docText.match(/(\d+(?:\.\d+)?)\s*%/);
      const countMatch = docText.match(/(\d+)\s*\/\s*(\d+)/);

      if (percentageMatch) {
        pastStats = {
          percentage: percentageMatch[1],
          attended: countMatch ? countMatch[1] : '',
          total: countMatch ? countMatch[2] : ''
        };
      }

      let lastRecordedStatus = '';
      const recordedMatches = attHtml.match(/Status:\s*<[^>]+>([^<]+)<\/[^>]+>/i) || attHtml.match(/Status:\s*([A-Za-z]+)/i);
      if (recordedMatches) lastRecordedStatus = recordedMatches[1];

      const idMatch = fullAttUrl.match(/id=(\d+)/);
      const attInstanceId = idMatch ? idMatch[1] : String(i + 1);

      // Check if title has a specific single keyword (e.g. ONLY "Lecture" or ONLY "Tutorial")
      const titleHasLecture = /lecture|kuliah/i.test(attTitle || '');
      const titleHasTutorial = /tutorial|tut|lab|makmal|studio|amali|practical/i.test(attTitle || '');
      const titleHasSpecificKeyword = (titleHasLecture && !titleHasTutorial) || (!titleHasLecture && titleHasTutorial);

      // Check session descriptions
      const isLecDesc = desc => /lecture|kuliah/i.test(desc || '');
      const isTutDesc = desc => /tutorial|tut|lab|makmal|studio|amali|practical/i.test(desc || '');

      const lecSessions = allSessions.filter(s => isLecDesc(s.desc));
      const tutSessions = allSessions.filter(s => isTutDesc(s.desc));
      const isCombinedPage = !titleHasSpecificKeyword && (lecSessions.length > 0 && tutSessions.length > 0);

      if (isCombinedPage) {
        // PERFORMANCE & USER REQUIREMENT:
        // Combined lecture + tutorial page detected!
        // Split into 2 items: 1 upcoming lecture + 1 upcoming tutorial (total 2 for that week)

        // A. Lecture item
        const pastLecSessions = lecSessions.filter(s => !s.isFuture);
        const futureLecSessions = lecSessions.filter(s => s.isFuture);
        const currentLec = lecSessions.find(s => s.isToday || s.statusType === 'active') || 
                           (pastLecSessions.length > 0 ? pastLecSessions[pastLecSessions.length - 1] : null);
        const trimmedLecSessions = [];
        if (currentLec) trimmedLecSessions.push(currentLec);
        const nextFutureLec = futureLecSessions.find(s => !trimmedLecSessions.some(ts => ts.dateKey === s.dateKey));
        if (nextFutureLec) trimmedLecSessions.push(nextFutureLec);
        const nextLec = nextFutureLec || (currentLec && (currentLec.isFuture || currentLec.isToday) ? currentLec : null);

        let activeLecSession = null;
        if (activeSession) {
          if (isLecDesc(activeSession.desc)) {
            activeLecSession = activeSession;
          } else if (!isTutDesc(activeSession.desc) && currentLec && currentLec.isToday) {
            activeLecSession = activeSession;
          }
        }

        let pastStatsLec = null;
        if (pastLecSessions.length > 0) {
          const attendedLec = pastLecSessions.filter(s => s.isPresent).length;
          const pctLec = Math.round((attendedLec / pastLecSessions.length) * 100);
          pastStatsLec = {
            percentage: String(pctLec),
            attended: String(attendedLec),
            total: String(pastLecSessions.length)
          };
        } else if (pastStats) {
          pastStatsLec = pastStats;
        }

        const lastRecordedLecStatus = currentLec ? (currentLec.status || currentLec.statusLabel || '') : '';

        // B. Tutorial item
        const pastTutSessions = tutSessions.filter(s => !s.isFuture);
        const futureTutSessions = tutSessions.filter(s => s.isFuture);
        const currentTut = tutSessions.find(s => s.isToday || s.statusType === 'active') || 
                           (pastTutSessions.length > 0 ? pastTutSessions[pastTutSessions.length - 1] : null);
        const trimmedTutSessions = [];
        if (currentTut) trimmedTutSessions.push(currentTut);
        const nextFutureTut = futureTutSessions.find(s => !trimmedTutSessions.some(ts => ts.dateKey === s.dateKey));
        if (nextFutureTut) trimmedTutSessions.push(nextFutureTut);
        const nextTut = nextFutureTut || (currentTut && (currentTut.isFuture || currentTut.isToday) ? currentTut : null);

        let activeTutSession = null;
        if (activeSession) {
          if (isTutDesc(activeSession.desc)) {
            activeTutSession = activeSession;
          } else if (!isLecDesc(activeSession.desc) && currentTut && currentTut.isToday) {
            activeTutSession = activeSession;
          }
        }

        let pastStatsTut = null;
        if (pastTutSessions.length > 0) {
          const attendedTut = pastTutSessions.filter(s => s.isPresent).length;
          const pctTut = Math.round((attendedTut / pastTutSessions.length) * 100);
          pastStatsTut = {
            percentage: String(pctTut),
            attended: String(attendedTut),
            total: String(pastTutSessions.length)
          };
        } else if (pastStats) {
          pastStatsTut = pastStats;
        }

        const lastRecordedTutStatus = currentTut ? (currentTut.status || currentTut.statusLabel || '') : '';

        // If an active session is open right now but neither assigned, assign to whichever is not null or default to lecture
        if (activeSession && !activeLecSession && !activeTutSession) {
          activeLecSession = activeSession;
        }

        logDiag('Attendance:Sessions', `[${courseId}] "${attTitle || 'Attendance'}" (Combined Page) -> Split into Lecture (${trimmedLecSessions.length} sess) + Tutorial (${trimmedTutSessions.length} sess)`);

        if (trimmedLecSessions.length > 0 || activeLecSession) {
          attendancesFound.push({
            id: `att_${courseId}_${attInstanceId}_lec`,
            cmid: attInstanceId,
            courseId,
            courseCode,
            courseName,
            attTitle: `${attTitle || 'Attendance'} (Lecture)`,
            subType: 'lecture',
            attUrl: fullAttUrl,
            detectedOccs: detectedOccs.map(String),
            userOcc: userOcc || '',
            activeSession: activeLecSession,
            nextSession: nextLec,
            pastStats: pastStatsLec,
            lastRecordedStatus: lastRecordedLecStatus,
            sessions: trimmedLecSessions
          });
        }

        if (trimmedTutSessions.length > 0 || activeTutSession) {
          attendancesFound.push({
            id: `att_${courseId}_${attInstanceId}_tut`,
            cmid: attInstanceId,
            courseId,
            courseCode,
            courseName,
            attTitle: `${attTitle || 'Attendance'} (Tutorial)`,
            subType: 'tutorial',
            attUrl: fullAttUrl,
            detectedOccs: detectedOccs.map(String),
            userOcc: userOcc || '',
            activeSession: activeTutSession,
            nextSession: nextTut,
            pastStats: pastStatsTut,
            lastRecordedStatus: lastRecordedTutStatus,
            sessions: trimmedTutSessions
          });
        }
      } else {
        // 4. PERFORMANCE OPTIMIZATION: Keep ONLY the most current session + next future 1 session!
        const pastSessions = allSessions.filter(s => !s.isFuture);
        const futureSessions = allSessions.filter(s => s.isFuture);

        const trimmedSessions = [];

        // A. Most current session:
        // Either active session today, or the latest past session for status verification
        const currentSession = allSessions.find(s => s.isToday || s.statusType === 'active') || 
                               (pastSessions.length > 0 ? pastSessions[pastSessions.length - 1] : null);
        if (currentSession) {
          trimmedSessions.push(currentSession);
        }

        // B. Next 1 future session:
        // The earliest upcoming session not already in trimmedSessions
        const nextFuture1 = futureSessions.find(s => !trimmedSessions.some(ts => ts.dateKey === s.dateKey));
        if (nextFuture1) {
          trimmedSessions.push(nextFuture1);
        }

        const nextSession = nextFuture1 || (currentSession && (currentSession.isFuture || currentSession.isToday) ? currentSession : null);

        if (!pastStats && allSessions.length > 0) {
          const attended = pastSessions.filter(s => s.isPresent).length;
          if (pastSessions.length > 0) {
            const pct = Math.round((attended / pastSessions.length) * 100);
            pastStats = {
              percentage: String(pct),
              attended: String(attended),
              total: String(pastSessions.length)
            };
          }
        }

        logDiag('Attendance:Sessions', `[${courseId}] "${attTitle || 'Attendance'}" -> Kept ${trimmedSessions.length} session(s) (Most current + Future 1). Overall stats: ${pastStats?.percentage || 'N/A'}%`);

        if (hasUserOcc && trimmedSessions.length === 0 && !activeSession) {
          logDiag('Attendance:Sessions', `[${courseId}] "${attTitle || 'Attendance'}" has 0 matching sessions and no active session for OCC ${userOccNum}. Skipping.`);
          continue;
        }

        let determinedSubType = '';
        if (/lecture|kuliah/i.test(attTitle || '')) determinedSubType = 'lecture';
        else if (/tutorial|tut/i.test(attTitle || '')) determinedSubType = 'tutorial';
        else if (/lab|makmal/i.test(attTitle || '')) determinedSubType = 'lab';
        else if (lecSessions.length > 0 && tutSessions.length === 0) determinedSubType = 'lecture';
        else if (tutSessions.length > 0 && lecSessions.length === 0) determinedSubType = 'tutorial';

        attendancesFound.push({
          id: `att_${courseId}_${attInstanceId}`,
          cmid: attInstanceId,
          courseId,
          courseCode,
          courseName,
          attTitle: attTitle || 'Attendance',
          subType: determinedSubType,
          attUrl: fullAttUrl,
          detectedOccs: detectedOccs.map(String),
          userOcc: userOcc || '',
          activeSession,
          nextSession,
          pastStats,
          lastRecordedStatus,
          sessions: trimmedSessions
        });
      }
    }

    if (attendancesFound.length === 0) {
      logDiag('Attendance:Result', `[${courseId}] 0 attendance activities kept (all were restricted or empty).`);
      return null;
    }

    // Prioritize accessible ones with active sessions or parsed sessions
    const withSessions = attendancesFound.filter(a => a.activeSession != null || (a.sessions && a.sessions.length > 0));
    const toReturn = withSessions.length > 0 ? withSessions : attendancesFound;
    logDiag('Attendance:Result', `[${courseId}] ✔ Returning ${Array.isArray(toReturn) ? toReturn.length : 1} attendance activit(ies) with ${toReturn.reduce ? toReturn.reduce((acc, a) => acc + (a.sessions?.length || 0), 0) : toReturn.sessions?.length || 0} total session(s).`);
    return toReturn.length === 1 ? toReturn[0] : toReturn;
  } catch (err) {
    logDiag('Attendance:Crash', `[${courseId}] Unhandled exception in fetchCourseAttendance: ${err?.message || err}`, err?.stack);
    console.log(`[SPeCTRUM Pro] Attendance fetch error for course ${courseId}:`, err);
    return null;
  }
}

// 6. Direct Attendance Submit
async function submitAttendanceDirect(takeUrl, statusId, sesskey, password = '') {
  try {
    if (!takeUrl) return false;
    const postUrl = takeUrl.split('?')[0];
    const sessidMatch = takeUrl.match(/sessid=(\d+)/);
    const sessid = sessidMatch ? sessidMatch[1] : '';

    const formData = new URLSearchParams();
    if (sessid) formData.append('sessid', sessid);
    if (sesskey) formData.append('sesskey', sesskey);
    if (statusId) formData.append('status', statusId);
    formData.append('mform_isexpanded_id_general', '1');
    formData.append('submitbutton', 'Save changes');
    if (password) {
      formData.append('password', password);
    }

    const res = await fetchWithTimeout(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      credentials: 'include'
    });

    return res.ok;
  } catch (e) {
    console.log('[SPeCTRUM Pro] Direct attendance submit error:', e);
    return false;
  }
}

// Optional In-Tab Fallback Runner
function executeInTab(tabId, func, args = []) {
  return new Promise((resolve, reject) => {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      return reject(new Error("chrome.scripting API is not available."));
    }
    chrome.scripting.executeScript({
      target: { tabId },
      func: func,
      args: args,
      world: 'MAIN'
    }, (results) => {
      if (chrome.runtime.lastError) {
        chrome.scripting.executeScript({
          target: { tabId },
          func: func,
          args: args
        }, (fallbackResults) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(fallbackResults && fallbackResults[0] ? fallbackResults[0].result : null);
        });
        return;
      }
      if (results && results[0]) {
        resolve(results[0].result);
      } else {
        resolve(null);
      }
    });
  });
}

