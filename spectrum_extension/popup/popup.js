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
let customSem1StartDate = '';
let isSyncOverlayDismissed = false;
let isScanningMaterials = false;
let currentSyncAbortController = null;
let syncStartTime = 0;
let saveCacheTimeout = null;

// ── Internationalization (i18n) Engine ──
// Supports: English (en), Bahasa Melayu (bm), Chinese (zh)
// User rule: Course code, name, announcement and tutorial titles fetched from SPeCTRUM remain in original language.
const I18N = {
  en: {
    langLabel: 'English',
    headers: {
      sync: 'Sync',
      diag: 'Logs',
      autoTake: 'Auto-Take Now',
      fullWorkstation: 'Full Screen',
      timetableTitle: 'WEEKLY TIMETABLE',
      materialsTitle: 'COURSE MATERIALS',
      preferencesTitle: 'PREFERENCES',
      byCourseFeed: 'BY COURSE',
      timelineFeed: 'TIMELINE',
      byDate: 'Date',
      byCourse: 'Course',
      by: 'By:',
      sort: 'Sort:',
      newest: 'Newest',
      oldest: 'Oldest',
      prevDay: 'Prev',
      today: 'Today',
      nextDay: 'Next',
      prevEvent: '⏮ Prev Event',
      nextEvent: 'Next Event ⏭',
      returnToToday: 'Return to Today'
    },
    tooltips: {
      pref: 'Preferences',
      mat: 'Materials',
      assign: 'Tutorials',
      att: 'Attendance',
      notice: 'Notices',
      timeline: 'Timeline',
      cal: 'Calendar',
      list: 'List',
      timetable: 'Timetable',
      tipjar: 'Tip Jar',
      activities: 'Activities',
      switchToDark: 'Switch to Dark Mode',
      switchToLight: 'Switch to Light Mode'
    },
    cards: {
      today: 'TODAY',
      upcoming: 'UPCOMING',
      ended: 'ENDED',
      live: 'LIVE',
      recorded: 'RECORDED',
      locked: 'LOCKED',
      active: 'WINDOW ACTIVE',
      password: 'PASSWORD',
      checkInWindow: 'Check-In Window',
      sessionEnded: 'Session ended',
      openSpectrum: 'Open SPeCTRUM ↗',
      checkPortal: 'Check Portal ↗',
      takeAttendance: 'Take Attendance',
      pinRequired: '🔑 Enter PIN',
      attended: 'Attended ✓',
      present: '✓ Present',
      opensAt: 'Opens at',
      tomorrow: 'Tomorrow',
      inDays: 'In {d}d',
      endedHoursAgo: 'Ended {h}h ago',
      endedDaysAgo: 'Ended {d}d ago',
      leftMin: '{m}M LEFT',
      notice: 'NOTICE',
      openFull: 'Open Full →',
      dueInDays: 'DUE IN {d}D',
      dueInHours: 'DUE IN {h}H',
      dueToday: 'DUE TODAY',
      dueTomorrow: 'DUE TOMORROW',
      overdueDays: 'OVERDUE {d}D',
      overdueToday: 'OVERDUE (TODAY)',
      submit: 'Submit →',
      submitLate: 'Submit Late →',
      submitted: 'Submitted ✓',
      noDeadline: 'No deadline',
      items: '{n} item{s}',
      assignment: 'Assignment',
      noActToday: 'No scheduled activities today',
      syncingTitle: 'SYNCING ACTIVITIES & ATTENDANCE'
    },
    settings: {
      occSettingsTitle: 'OCCURRENCE (OCC) SETTINGS',
      occSettingsDesc: 'Specify cohort occurrence filters for selective biometric check-ins.',
      defaultOccTitle: 'Default OCC Cohort',
      defaultOccSub: 'Fallback for unmapped modules',
      perCourseOverrides: 'PER-COURSE OVERRIDES',
      resetAll: 'Reset All',
      resetOccCleared: '✔ All OCC preferences cleared!',
      attAutoTitle: 'ATTENDANCE AUTOMATION',
      attAutoBadgeActive: 'ACTIVE',
      attAutoBadgeOff: 'STANDBY',
      attAutoCheckTitle: 'Enable auto-attendance check',
      attAutoCheckSub: 'Runs periodically in background and marks attendance',
      cadenceLabel: 'Validation Cadence:',
      every10m: 'Every 10 minutes',
      every15m: 'Every 15 minutes (Standard)',
      every30m: 'Every 30 minutes',
      every1h: 'Every 1 hour',
      hiddenAttTitle: 'HIDDEN DUPLICATE ATTENDANCES',
      hiddenAttDesc: 'Redundant slots filtered from daily timeline view.',
      restoreAll: 'Restore All',
      hiddenCount: '{n} Hidden',
      noHidden: '✔ No duplicate attendances currently hidden.',
      timelineFocalTitle: 'TIMELINE DOT TRIGGER POSITION',
      timelineFocalDesc: 'Adjust the vertical screen position where timeline date dots animate and light up solid black as activities scroll past.',
      focalHeight: 'Trigger Height',
      focalMid: 'Middle',
      presetUpper: 'Upper (30%)',
      presetMiddle: 'Middle (50% Default)',
      presetLower: 'Lower (70%)',
      clearCache: 'Clear Cache',
      savePreferences: 'Save Preferences',
      savedToast: 'Preferences Saved'
    },
    timetable: {
      mainTitle: 'ACADEMIC TIMETABLE',
      term: 'TERM:',
      contactSessions: '{n} Contact Sessions',
      singleContactSession: '1 Contact Session',
      vertical: 'Vertical',
      horizontal: 'Horizontal',
      onePage: '1 Page',
      exportCsv: 'Export CSV',
      exportPng: 'Export PNG',
      exportPdf: 'Export PDF',
      academicWk: 'ACADEMIC WK',
      timeMyt: 'TIME (MYT)',
      today: 'TODAY',
      addLocation: '+ Add Location',
      editSession: '✏️ Edit Class Session',
      venuePlaceholder: '+ Add Location',
      noSessionsFound: 'No Timetable Sessions Found',
      noSessionsSub: 'Attendance sessions for your enrolled courses will appear here automatically.'
    },
    materials: {
      searchPlaceholder: 'Search files...',
      all: 'ALL',
      sortName: 'ORDER: Name (A-Z)',
      sortMoodle: 'ORDER: Default',
      expandAll: 'Expand All',
      collapseAll: 'Collapse All',
      rescan: 'Rescan',
      selectedFiles: 'Selected: {n} files',
      selectAll: 'Select All',
      deselectAll: 'Deselect All',
      clearSelection: 'Clear Selection',
      markSynced: 'Mark All as Synced',
      downloadZip: 'Download Selected (.zip)',
      downloadCoursePack: 'Download Course Pack (.zip)',
      fileSingle: 'file',
      filePlural: 'files',
      docDetails: 'DOCUMENT DETAILS',
      preview: 'Preview',
      fullReader: 'Full Reader',
      expand: 'Expand',
      collapse: 'Collapse',
      downloadFile: 'Download Local Copy (.pdf)',
      loadingPreview: 'Loading preview...',
      noCoursesSynced: 'No Enrolled Courses Synced',
      noCoursesSub: 'Click Rescan above to discover and sync course materials directly from SPeCTRUM.',
      rescanMaterials: '↻ Rescan Materials',
      noFilesFound: 'No downloadable files found in this course.',
      scanningContents: 'Scanning course contents...',
      noCoursesFound: 'No Enrolled Courses Found',
      loginPrompt: 'Please ensure you are signed in to spectrum.um.edu.my, then click Rescan.',
      rescanCoursesBtn: '↻ Rescan Courses',
      discoveringCourses: 'Connecting to SPeCTRUM & discovering enrolled courses...',
      step1Of2: 'Step 1 of 2: Discovering courses',
      rescanningTitle: 'RESCANNING SPeCTRUM COURSES',
      fetchingTitle: 'FETCHING COURSES & MATERIALS',
      scanComplete: 'SCAN COMPLETE',
      scanSuccess: '✔ All {c} courses & {f} files successfully indexed!',
      completedCount: '{c} of {c} completed',
      updated2Hours: '2 hours ago',
      updatedYesterday: 'Yesterday',
      updated3Days: '3 days ago',
      updated5Days: '5 days ago',
      colNameAsset: 'NAME & ASSET IDENTIFIER',
      colStatusActions: 'STATUS / ACTIONS',
      synced: 'Synced',
      syncNow: 'Sync Now',
      courseOverviewProforma: 'COURSE OVERVIEW & PROFORMA',
      inspectDoc: 'Inspect Document',
      downloadFileAction: 'Download File',
      downloadLocalCopy: 'Download Local Copy',
      newBadge: 'NEW',
      noFilesInSection: 'No downloadable files found in this section.',
      matchingFiles: '{count} of {total} files',
      selectedPrefix: 'Selected:',
      downloading: 'Downloading...',
      noFilesSelected: 'No files selected. Please check at least one file to download.',
      preparing: 'Preparing...',
      downloadComplete: '✔ Complete! ({count} files saved)'
    }
  },
  bm: {
    langLabel: 'Bahasa Melayu',
    headers: {
      sync: 'Segerak',
      diag: 'Log',
      autoTake: 'Auto-Hadir',
      fullWorkstation: 'Skrin Penuh',
      timetableTitle: 'JADUAL WAKTU',
      materialsTitle: 'BAHAN KURSUS',
      preferencesTitle: 'TETAPAN',
      byCourseFeed: 'IKUT KURSUS',
      timelineFeed: 'GARIS MASA',
      byDate: 'Tarikh',
      byCourse: 'Kursus',
      by: 'Ikut:',
      sort: 'Susun:',
      newest: 'Terkini',
      oldest: 'Terawal',
      prevDay: 'Sebelum',
      today: 'Hari Ini',
      nextDay: 'Seterusnya',
      prevEvent: '⏮ Sebelum',
      nextEvent: 'Seterusnya ⏭',
      returnToToday: 'Kembali ke Hari Ini'
    },
    tooltips: {
      pref: 'Tetapan',
      mat: 'Bahan Kursus',
      assign: 'Tutorial',
      att: 'Kehadiran',
      notice: 'Notis',
      timeline: 'Garis Masa',
      cal: 'Kalendar',
      list: 'Senarai',
      timetable: 'Jadual Waktu',
      tipjar: 'Sokong',
      activities: 'Aktiviti',
      switchToDark: 'Tukar ke Mod Gelap',
      switchToLight: 'Tukar ke Mod Cerah'
    },
    cards: {
      today: 'HARI INI',
      upcoming: 'AKAN DATANG',
      ended: 'TAMAT',
      live: 'BERLANGSUNG',
      recorded: 'DIREKOD',
      locked: 'DIKUNCI',
      active: 'DIBUKA',
      password: 'PERLU PIN',
      checkInWindow: 'Masa Kehadiran',
      sessionEnded: 'Tamat',
      openSpectrum: 'Buka SPeCTRUM ↗',
      checkPortal: 'Semak Portal ↗',
      takeAttendance: 'Daftar',
      pinRequired: '🔑 Masukkan PIN',
      attended: 'Hadir ✓',
      present: '✓ Hadir',
      opensAt: 'Dibuka jam',
      tomorrow: 'Esok',
      inDays: 'Lagi {d} hari',
      endedHoursAgo: 'Tamat {h}j lalu',
      endedDaysAgo: 'Tamat {d}h lalu',
      leftMin: 'Baki {m}m',
      notice: 'NOTIS',
      openFull: 'Penuh →',
      dueInDays: 'Baki {d} hari',
      dueInHours: 'Baki {h} jam',
      dueToday: 'HARI INI',
      dueTomorrow: 'ESOK',
      overdueDays: 'Lewat {d} hari',
      overdueToday: 'Lewat Hari Ini',
      submit: 'Hantar →',
      submitLate: 'Hantar Lewat →',
      submitted: 'Dihantar ✓',
      noDeadline: 'Tiada had masa',
      items: '{n} item',
      assignment: 'Tugasan',
      noActToday: 'Tiada aktiviti hari ini',
      syncingTitle: 'MENYEGERAKKAN DATA'
    },
    settings: {
      occSettingsTitle: 'TETAPAN KUMPULAN (OCC)',
      occSettingsDesc: 'Pilih kumpulan OCC untuk menapis aktiviti kehadiran.',
      defaultOccTitle: 'Kumpulan OCC Lalai',
      defaultOccSub: 'Nilai sandaran jika belum ditetapkan',
      perCourseOverrides: 'TETAPAN MENGIKUT KURSUS',
      resetAll: 'Set Semula',
      resetOccCleared: '✔ Semua tetapan OCC telah dikosongkan!',
      attAutoTitle: 'KEHADIRAN AUTOMATIK',
      attAutoBadgeActive: 'AKTIF',
      attAutoBadgeOff: 'JEDA',
      attAutoCheckTitle: 'Dayakan semakan automatik',
      attAutoCheckSub: 'Semak dan tanda kehadiran secara berkala di latar belakang',
      cadenceLabel: 'Kekerapan Semakan:',
      every10m: 'Setiap 10 minit',
      every15m: 'Setiap 15 minit (Disyorkan)',
      every30m: 'Setiap 30 minit',
      every1h: 'Setiap 1 jam',
      hiddenAttTitle: 'SESI PENDUA TERSEMBUNYI',
      hiddenAttDesc: 'Sesi berlebihan yang disembunyikan daripada garis masa.',
      restoreAll: 'Pulihkan Semua',
      hiddenCount: '{n} Tersembunyi',
      noHidden: '✔ Tiada sesi tersembunyi.',
      timelineFocalTitle: 'TITIK FOKUS GARIS MASA',
      timelineFocalDesc: 'Laraskan kedudukan menegak untuk titik tarikh diaktifkan semasa skrol.',
      focalHeight: 'Ketinggian Pemicu',
      focalMid: 'Tengah Skrin',
      presetUpper: 'Atas (30%)',
      presetMiddle: 'Tengah (50% Lalai)',
      presetLower: 'Bawah (70%)',
      clearCache: 'Kosongkan Cache',
      savePreferences: 'Simpan Tetapan',
      savedToast: 'Tetapan Disimpan'
    },
    timetable: {
      mainTitle: 'JADUAL WAKTU AKADEMIK',
      term: 'SEMESTER:',
      contactSessions: '{n} Sesi Kuliah',
      singleContactSession: '1 Sesi Kuliah',
      vertical: 'Menegak',
      horizontal: 'Melintang',
      onePage: '1 Halaman',
      exportCsv: 'Eksport CSV',
      exportPng: 'Eksport PNG',
      exportPdf: 'Eksport PDF',
      academicWk: 'MG AKADEMIK',
      timeMyt: 'MASA (MYT)',
      today: 'HARI INI',
      addLocation: '+ Tambah Lokasi',
      editSession: '✏️ Edit Sesi Kuliah',
      venuePlaceholder: '+ Tambah Lokasi',
      noSessionsFound: 'Tiada Sesi Jadual Waktu Ditemui',
      noSessionsSub: 'Sesi kehadiran kursus anda akan dipaparkan di sini secara automatik.'
    },
    materials: {
      searchPlaceholder: 'Cari fail...',
      all: 'SEMUA',
      sortName: 'SUSUN: Nama (A-Z)',
      sortMoodle: 'SUSUN: Lalai',
      expandAll: 'Kembangkan Semua',
      collapseAll: 'Runtuhkan Semua',
      rescan: 'Imbas Semula',
      selectedFiles: 'Dipilih: {n} fail',
      selectAll: 'Pilih Semua',
      deselectAll: 'Nyahpilih Semua',
      clearSelection: 'Kosongkan',
      markSynced: 'Tanda Selesai Disegerak',
      downloadZip: 'Muat Turun Pilihan (.zip)',
      downloadCoursePack: 'Muat Turun Semua (.zip)',
      fileSingle: 'fail',
      filePlural: 'fail',
      docDetails: 'BUTIRAN DOKUMEN',
      preview: 'Pratonton',
      fullReader: 'Bacaan Penuh',
      expand: 'Kembangkan',
      collapse: 'Runtuhkan',
      downloadFile: 'Muat Turun Salinan (.pdf)',
      loadingPreview: 'Memuatkan pratonton...',
      noCoursesSynced: 'Tiada Kursus Disegerakkan',
      noCoursesSub: 'Klik Imbas Semula untuk mengesan bahan daripada SPeCTRUM.',
      rescanMaterials: '↻ Imbas Semula',
      noFilesFound: 'Tiada fail boleh dimuat turun dalam kursus ini.',
      scanningContents: 'Mengimbas bahan kursus...',
      noCoursesFound: 'Tiada Kursus Ditemui',
      loginPrompt: 'Sila pastikan anda telah log masuk ke spectrum.um.edu.my.',
      rescanCoursesBtn: '↻ Imbas Semula',
      discoveringCourses: 'Menyambung ke SPeCTRUM & mengesan kursus...',
      step1Of2: 'Langkah 1/2: Mengesan kursus',
      rescanningTitle: 'MENGIMBAS SEMULA KURSUS',
      fetchingTitle: 'MEMPEROLEH SENARAI BAHAN',
      scanComplete: 'IMBASAN SELESAI',
      scanSuccess: '✔ {c} kursus & {f} fail berjaya diindeks!',
      completedCount: '{c}/{c} selesai',
      updated2Hours: '2 jam lalu',
      updatedYesterday: 'Semalam',
      updated3Days: '3 hari lalu',
      updated5Days: '5 hari lalu',
      colNameAsset: 'NAMA & PENGENAL PASTI ASET',
      colStatusActions: 'STATUS / TINDAKAN',
      synced: 'Disegerak',
      syncNow: 'Segerak Sekarang',
      courseOverviewProforma: 'GAMBARAN KESELURUHAN & PROFORMA',
      inspectDoc: 'Periksa Dokumen',
      downloadFileAction: 'Muat Turun Fail',
      downloadLocalCopy: 'Muat Turun Salinan',
      newBadge: 'BAHARU',
      noFilesInSection: 'Tiada fail boleh dimuat turun di bahagian ini.',
      matchingFiles: '{count} drp {total} fail',
      selectedPrefix: 'Dipilih:',
      downloading: 'Memuat turun...',
      noFilesSelected: 'Tiada fail dipilih. Sila pilih sekurang-kurangnya satu fail.',
      preparing: 'Menyediakan...',
      downloadComplete: '✔ Selesai! ({count} fail disimpan)'
    }
  },
  zh: {
    langLabel: '中文',
    headers: {
      sync: '同步',
      diag: '日志',
      autoTake: '自动签到',
      fullWorkstation: '全屏',
      timetableTitle: '课表',
      materialsTitle: '课件下载',
      preferencesTitle: '设置',
      byCourseFeed: '按课程',
      timelineFeed: '时间轴',
      byDate: '日期',
      byCourse: '课程',
      by: '分组:',
      sort: '排序:',
      newest: '最近',
      oldest: '最久远',
      prevDay: '前一天',
      today: '今天',
      nextDay: '后一天',
      prevEvent: '⏮ 上个活动',
      nextEvent: '下个活动 ⏭',
      returnToToday: '返回今天'
    },
    tooltips: {
      pref: '设置',
      mat: '课件',
      assign: '作业',
      att: '签到',
      notice: '通知',
      timeline: '时间轴',
      cal: '日历',
      list: '列表',
      timetable: '课表',
      tipjar: '支持',
      activities: '动态',
      switchToDark: '切换至深色模式',
      switchToLight: '切换至浅色模式'
    },
    cards: {
      today: '今天',
      upcoming: '即将到来',
      ended: '已结束',
      live: '进行中',
      recorded: '已记录',
      locked: '已锁定',
      active: '开放中',
      password: '需密码',
      checkInWindow: '签到窗口',
      sessionEnded: '已结束',
      openSpectrum: '打开 SPeCTRUM ↗',
      checkPortal: '查看门户 ↗',
      takeAttendance: '签到',
      pinRequired: '🔑 输入密码',
      attended: '已签到 ✓',
      present: '✓ 出勤',
      opensAt: '开放时间：',
      tomorrow: '明天',
      inDays: '{d} 天后',
      endedHoursAgo: '{h} 小时前结束',
      endedDaysAgo: '{d} 天前结束',
      leftMin: '剩 {m} 分钟',
      notice: '通知',
      openFull: '全文 →',
      dueInDays: '剩 {d} 天',
      dueInHours: '剩 {h} 小时',
      dueToday: '今天截止',
      dueTomorrow: '明天截止',
      overdueDays: '逾期 {d} 天',
      overdueToday: '今日逾期',
      submit: '提交 →',
      submitLate: '补交 →',
      submitted: '已提交 ✓',
      noDeadline: '无截止',
      items: '{n} 项',
      assignment: '作业',
      noActToday: '今日暂无安排',
      syncingTitle: '正在同步数据'
    },
    settings: {
      occSettingsTitle: '班级分组 (OCC) 设置',
      occSettingsDesc: '指定 OCC 组别，用于精准筛选签到与课程项。',
      defaultOccTitle: '默认 OCC 组别',
      defaultOccSub: '未单独指定时的默认组别',
      perCourseOverrides: '各课程独立设置',
      resetAll: '重置全部',
      resetOccCleared: '✔ 已重置所有 OCC 设置！',
      attAutoTitle: '自动签到',
      attAutoBadgeActive: '运行中',
      attAutoBadgeOff: '待命',
      attAutoCheckTitle: '启用自动签到',
      attAutoCheckSub: '后台定期检测并在开放时自动打卡',
      cadenceLabel: '检测频率：',
      every10m: '每 10 分钟',
      every15m: '每 15 分钟 (推荐)',
      every30m: '每 30 分钟',
      every1h: '每 1 小时',
      hiddenAttTitle: '已隐藏重复签到',
      hiddenAttDesc: '已从日常时间轴中过滤的冗余考勤项。',
      restoreAll: '全部恢复',
      hiddenCount: '{n} 项已隐藏',
      noHidden: '✔ 当前无隐藏签到。',
      timelineFocalTitle: '时间轴圆点焦点',
      timelineFocalDesc: '调整滚动时圆点激活变黑的屏幕垂直高度。',
      focalHeight: '触发高度',
      focalMid: '居中',
      presetUpper: '偏上 (30%)',
      presetMiddle: '居中 (50% 默认)',
      presetLower: '偏下 (70%)',
      clearCache: '清除缓存',
      savePreferences: '保存设置',
      savedToast: '设置已保存'
    },
    timetable: {
      mainTitle: '课表',
      term: '学期:',
      contactSessions: '{n} 节课',
      singleContactSession: '1 节课',
      vertical: '纵向',
      horizontal: '横向',
      onePage: '单页',
      exportCsv: '导出 CSV',
      exportPng: '导出 PNG',
      exportPdf: '导出 PDF',
      academicWk: '教学周',
      timeMyt: '时间 (MYT)',
      today: '今天',
      addLocation: '+ 添加地点',
      editSession: '✏️ 编辑课程',
      venuePlaceholder: '+ 添加地点',
      noSessionsFound: '未找到课表安排',
      noSessionsSub: '已选课程的考勤与课表安排将自动显示在此处。'
    },
    materials: {
      searchPlaceholder: '搜索文件...',
      all: '全部',
      sortName: '排序：名称 (A-Z)',
      sortMoodle: '排序：默认',
      expandAll: '展开全部',
      collapseAll: '折叠全部',
      rescan: '重新扫描',
      selectedFiles: '已选：{n} 个文件',
      selectAll: '全选',
      deselectAll: '全不选',
      clearSelection: '清空选择',
      markSynced: '全部标为已同步',
      downloadZip: '下载所选 (.zip)',
      downloadCoursePack: '下载整门课件 (.zip)',
      fileSingle: '个文件',
      filePlural: '个文件',
      docDetails: '文档详情',
      preview: '预览',
      fullReader: '全屏阅读',
      expand: '全屏',
      collapse: '退出全屏',
      downloadFile: '下载本地副本 (.pdf)',
      loadingPreview: '正在加载预览...',
      noCoursesSynced: '暂未同步课程',
      noCoursesSub: '点击上方“重新扫描”同步课件资料。',
      rescanMaterials: '↻ 重新扫描',
      noFilesFound: '本课程暂无课件。',
      scanningContents: '正在扫描课件...',
      noCoursesFound: '未找到课程',
      loginPrompt: '请确保已登录 spectrum.um.edu.my，然后点击重新扫描。',
      rescanCoursesBtn: '↻ 重新扫描',
      discoveringCourses: '正在检索已注册课程...',
      step1Of2: '第 1 步 (共 2 步)：发现课程',
      rescanningTitle: '重新扫描课程',
      fetchingTitle: '获取课件资料',
      scanComplete: '扫描完成',
      scanSuccess: '✔ 全部 {c} 门课程和 {f} 个文件已索引！',
      completedCount: '已完成 {c} / {c}',
      updated2Hours: '2 小时前',
      updatedYesterday: '昨天',
      updated3Days: '3 天前',
      updated5Days: '5 天前',
      colNameAsset: '名称与课件标识',
      colStatusActions: '状态 / 操作',
      synced: '已同步',
      syncNow: '立即同步',
      courseOverviewProforma: '课程概览与教学大纲',
      inspectDoc: '查看文档',
      downloadFileAction: '下载文件',
      downloadLocalCopy: '下载本地副本',
      newBadge: '最新',
      noFilesInSection: '本章节暂无可下载文件。',
      matchingFiles: '{count} / {total} 个文件',
      selectedPrefix: '已选：',
      downloading: '正在下载...',
      noFilesSelected: '未选择任何文件。请勾选至少一个文件后再下载。',
      preparing: '准备中...',
      downloadComplete: '✔ 下载完成！（已保存 {count} 个文件）'
    }
  }
};

let currentLang = 'en';

function t(section, key, params = {}) {
  const dict = I18N[currentLang] || I18N.en;
  let text = (dict[section] && dict[section][key]) || (I18N.en[section] && I18N.en[section][key]) || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return text;
}

function formatMonthYearHeading(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  if (currentLang === 'zh') {
    return `${dt.getFullYear()}年 ${dt.getMonth() + 1}月`;
  }
  if (currentLang === 'bm') {
    const monthNamesBm = ['JANUARI', 'FEBRUARI', 'MAC', 'APRIL', 'MEI', 'JUN', 'JULAI', 'OGOS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DISEMBER'];
    return `${monthNamesBm[dt.getMonth()]} ${dt.getFullYear()}`;
  }
  return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
}

function updateTimetableTranslations() {
  const mainTitle = document.querySelector('.timetable-main-title');
  if (mainTitle) mainTitle.textContent = t('timetable', 'mainTitle');

  const termLabel = document.querySelector('.tt-term-label');
  if (termLabel) termLabel.textContent = t('timetable', 'term');

  const btnVertical = document.getElementById('btn-tt-vertical');
  if (btnVertical) {
    const span = btnVertical.querySelector('span');
    if (span) span.textContent = t('timetable', 'vertical');
  }

  const btnHorizontal = document.getElementById('btn-tt-horizontal');
  if (btnHorizontal) {
    const span = btnHorizontal.querySelector('span');
    if (span) span.textContent = t('timetable', 'horizontal');
  }

  const btnOnePage = document.getElementById('btn-tt-one-page');
  if (btnOnePage) {
    const span = document.getElementById('btn-tt-one-page-label') || btnOnePage.querySelector('span');
    if (span) span.textContent = t('timetable', 'onePage');
  }

  const btnCsv = document.getElementById('btn-export-timetable-csv');
  if (btnCsv) {
    const span = btnCsv.querySelector('span');
    if (span) span.textContent = t('timetable', 'exportCsv');
  }

  const btnPng = document.getElementById('btn-export-timetable-png');
  if (btnPng) {
    const span = btnPng.querySelector('span');
    if (span) span.textContent = t('timetable', 'exportPng');
  }

  const btnPdf = document.getElementById('btn-export-timetable-pdf');
  if (btnPdf) {
    const span = btnPdf.querySelector('span');
    if (span) span.textContent = t('timetable', 'exportPdf');
  }

  const acadYearEl = document.getElementById('tt-header-acad-year');
  const semTypeEl = document.getElementById('tt-header-sem-type');
  const termFn = (typeof detectActualAcademicTerm === 'function')
    ? detectActualAcademicTerm
    : ((typeof window !== 'undefined' && typeof window.detectActualAcademicTerm === 'function') ? window.detectActualAcademicTerm : null);
  const umFn = (typeof getUmAcademicInfo === 'function')
    ? getUmAcademicInfo
    : ((typeof window !== 'undefined' && typeof window.getUmAcademicInfo === 'function') ? window.getUmAcademicInfo : null);
  const termInfo = termFn ? termFn(new Date()) : (umFn ? umFn(new Date()) : { academicYear: '2026/2027', semType: 'SEM I' });
  if (acadYearEl && termInfo.academicYear) acadYearEl.textContent = termInfo.academicYear;
  if (semTypeEl && termInfo.semType) semTypeEl.textContent = termInfo.semType;

  const countEl = document.getElementById('timetable-session-count');
  if (countEl && typeof extractWeeklyTimetableSessions === 'function') {
    const sessCount = extractWeeklyTimetableSessions().length;
    if (currentLang === 'zh') {
      countEl.textContent = `${sessCount} 节课`;
    } else if (currentLang === 'bm') {
      countEl.textContent = `${sessCount} Sesi Kuliah`;
    } else {
      countEl.textContent = `${sessCount} Contact Session${sessCount === 1 ? '' : 's'}`;
    }
  }
}
window.updateTimetableTranslations = updateTimetableTranslations;
window.formatMonthYearHeading = formatMonthYearHeading;

function updateSidebarLabels() {
  const map = {
    'rail-btn-pref': t('tooltips', 'pref'),
    'rail-btn-mat': t('tooltips', 'mat'),
    'rail-toggle-assign': t('tooltips', 'assign'),
    'rail-toggle-att': t('tooltips', 'att'),
    'rail-toggle-notice': t('tooltips', 'notice'),
    'rail-mode-timeline': t('tooltips', 'timeline'),
    'rail-mode-calendar': t('tooltips', 'cal'),
    'rail-mode-list': t('tooltips', 'list'),
    'rail-mode-timetable': t('tooltips', 'timetable')
  };
  for (const [id, text] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) {
      const label = el.querySelector('.rail-expand-label');
      if (label) label.textContent = text;
      el.setAttribute('aria-label', text);
      el.setAttribute('title', text);
      el.dataset.tooltip = text;
    }
  }

  const dockNotice = document.getElementById('dock-btn-notice');
  if (dockNotice) dockNotice.dataset.tooltip = `[ ${t('tooltips', 'notice')} ]`;
  const dockTutorial = document.getElementById('dock-btn-tutorial');
  if (dockTutorial) dockTutorial.dataset.tooltip = `[ ${t('tooltips', 'assign')} ]`;
  const dockAtt = document.getElementById('dock-btn-attendance');
  if (dockAtt) dockAtt.dataset.tooltip = `[ ${t('tooltips', 'att')} ]`;
}

function updatePreferencesTranslations() {
  const prefTab = document.getElementById('tab-filters');
  if (!prefTab) return;

  const occCard = prefTab.querySelector('.pref-card:nth-of-type(1)');
  if (occCard) {
    const title = occCard.querySelector('.pref-card-title');
    if (title) title.textContent = t('settings', 'occSettingsTitle');
    const desc = occCard.querySelector('.pref-card-desc');
    if (desc) desc.textContent = t('settings', 'occSettingsDesc');
    const rowTitle = occCard.querySelector('.pref-default-occ-box .pref-row-title');
    if (rowTitle) rowTitle.textContent = t('settings', 'defaultOccTitle');
    const rowSub = occCard.querySelector('.pref-default-occ-box .pref-row-subtitle');
    if (rowSub) rowSub.textContent = t('settings', 'defaultOccSub');
    const subhead = occCard.querySelector('.pref-subhead-title');
    if (subhead) subhead.textContent = t('settings', 'perCourseOverrides');
    const btnResetAll = document.getElementById('btn-reset-all-occ');
    if (btnResetAll) btnResetAll.textContent = t('settings', 'resetAll');
  }

  const autoCard = prefTab.querySelector('.pref-card:nth-of-type(2)');
  if (autoCard) {
    const title = autoCard.querySelector('.pref-card-title');
    if (title) title.textContent = t('settings', 'attAutoTitle');
    const badge = document.getElementById('pref-auto-att-badge');
    const chk = document.getElementById('chk-auto-attendance');
    if (badge) badge.textContent = (chk && chk.checked) ? t('settings', 'attAutoBadgeActive') : t('settings', 'attAutoBadgeOff');
    const rowTitle = autoCard.querySelector('.pref-automation-box .pref-row-title');
    if (rowTitle) rowTitle.textContent = t('settings', 'attAutoCheckTitle');
    const rowSub = document.getElementById('pref-auto-att-sub');
    if (rowSub) rowSub.textContent = t('settings', 'attAutoCheckSub');
    const cadence = autoCard.querySelector('.pref-interval-label');
    if (cadence) cadence.textContent = t('settings', 'cadenceLabel');
    const selInterval = document.getElementById('sel-attendance-interval');
    if (selInterval && selInterval.options) {
      if (selInterval.options[0]) selInterval.options[0].textContent = t('settings', 'every10m');
      if (selInterval.options[1]) selInterval.options[1].textContent = t('settings', 'every15m');
      if (selInterval.options[2]) selInterval.options[2].textContent = t('settings', 'every30m');
      if (selInterval.options[3]) selInterval.options[3].textContent = t('settings', 'every1h');
    }
  }

  const hiddenCard = document.getElementById('group-hidden-attendance');
  if (hiddenCard) {
    const title = hiddenCard.querySelector('.pref-card-title');
    if (title) title.textContent = t('settings', 'hiddenAttTitle');
    const desc = hiddenCard.querySelector('.pref-card-desc');
    if (desc) desc.textContent = t('settings', 'hiddenAttDesc');
    const btnRestore = document.getElementById('btn-restore-all-att');
    if (btnRestore) btnRestore.textContent = t('settings', 'restoreAll');
  }

  const focalCard = document.getElementById('group-timeline-focal');
  if (focalCard) {
    const title = focalCard.querySelector('.pref-card-title');
    if (title) title.textContent = t('settings', 'timelineFocalTitle');
    const desc = focalCard.querySelector('.pref-card-desc');
    if (desc) desc.textContent = t('settings', 'timelineFocalDesc');
    const heightLabel = focalCard.querySelector('.pref-row-box div:first-child span:first-child');
    if (heightLabel) heightLabel.textContent = t('settings', 'focalHeight');
    const p30 = focalCard.querySelector('.btn-focal-preset[data-val="30"]');
    if (p30) p30.textContent = t('settings', 'presetUpper');
    const p50 = focalCard.querySelector('.btn-focal-preset[data-val="50"]');
    if (p50) p50.textContent = t('settings', 'presetMiddle');
    const p70 = focalCard.querySelector('.btn-focal-preset[data-val="70"]');
    if (p70) p70.textContent = t('settings', 'presetLower');
  }

  const btnClearCache = document.getElementById('btn-clear-cache');
  if (btnClearCache) {
    const span = btnClearCache.querySelector('span');
    if (span) span.textContent = t('settings', 'clearCache');
  }
  const btnSaveSettings = document.getElementById('btn-save-settings');
  if (btnSaveSettings) {
    const span = btnSaveSettings.querySelector('span');
    if (span) span.textContent = t('settings', 'savePreferences');
  }

  if (typeof renderHiddenAttendanceSettings === 'function') {
    renderHiddenAttendanceSettings();
  }
}

function updateMaterialsTranslations() {
  const searchInput = document.getElementById('filter-search-input');
  if (searchInput) searchInput.placeholder = t('materials', 'searchPlaceholder');

  const allPill = document.querySelector('.mat-ext-pill[data-ext="ALL"]');
  if (allPill) allPill.textContent = t('materials', 'all');

  const sortSelect = document.getElementById('mat-sort-select');
  if (sortSelect && sortSelect.options) {
    if (sortSelect.options[0]) sortSelect.options[0].textContent = t('materials', 'sortName');
    if (sortSelect.options[1]) sortSelect.options[1].textContent = t('materials', 'sortMoodle');
  }

  if (typeof updateExpandAllButtonState === 'function') {
    updateExpandAllButtonState();
  } else if (typeof window !== 'undefined' && typeof window.updateExpandAllButtonState === 'function') {
    window.updateExpandAllButtonState();
  } else {
    const expandLabel = document.getElementById('btn-toggle-expand-label');
    if (expandLabel) {
      const isExpanded = document.getElementById('btn-toggle-expand-all')?.classList.contains('all-expanded');
      expandLabel.textContent = isExpanded ? t('materials', 'collapseAll') : t('materials', 'expandAll');
    }
  }

  const rescanLabel = document.getElementById('btn-rescan-label');
  if (rescanLabel) rescanLabel.textContent = t('materials', 'rescan');

  if (typeof window !== 'undefined' && typeof window.updateSelectAllButtonState === 'function') {
    window.updateSelectAllButtonState();
  } else {
    const selectAllLabel = document.getElementById('btn-select-all-label');
    if (selectAllLabel) {
      const isAllSelected = document.getElementById('btn-select-all')?.classList.contains('all-selected');
      selectAllLabel.textContent = isAllSelected ? t('materials', 'deselectAll') : t('materials', 'selectAll');
    }
  }

  const downloadText = document.getElementById('btn-download-text');
  if (downloadText) downloadText.textContent = t('materials', 'downloadZip');

  const inspTitle = document.querySelector('.inspector-title');
  if (inspTitle) inspTitle.textContent = t('materials', 'docDetails');

  const previewLabel = document.querySelector('.insp-preview-tab-label span');
  if (previewLabel) previewLabel.textContent = t('materials', 'preview');

  const fullReaderBtn = document.getElementById('insp-open-reader-btn');
  if (fullReaderBtn) {
    const span = fullReaderBtn.querySelector('span');
    if (span) span.textContent = t('materials', 'fullReader');
  }

  const expandTextEl = document.getElementById('insp-expand-btn-text');
  if (expandTextEl) {
    const layout = document.querySelector('.materials-workspace-layout');
    const isFull = layout ? layout.classList.contains('is-inspector-full') : false;
    expandTextEl.textContent = isFull ? t('materials', 'collapse') : t('materials', 'expand');
  }

  const inspDownloadText = document.getElementById('insp-download-text');
  if (inspDownloadText) inspDownloadText.textContent = t('materials', 'downloadFile');

  // Dynamic Materials Table & Row Elements Translations
  document.querySelectorAll('.col-head-name').forEach(el => {
    el.textContent = t('materials', 'colNameAsset');
  });
  document.querySelectorAll('.col-head-status').forEach(el => {
    el.textContent = t('materials', 'colStatusActions');
  });
  document.querySelectorAll('.status-synced-pill').forEach(el => {
    el.innerHTML = `<svg class="icon-svg" viewBox="0 0 24 24" style="width:12px;height:12px;stroke:#16A34A;fill:none;stroke-width:2.5;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ${t('materials', 'synced')}`;
  });
  document.querySelectorAll('.btn-sync-now').forEach(el => {
    el.textContent = `⚡ ${t('materials', 'syncNow')}`;
  });
  document.querySelectorAll('.btn-inspect-file').forEach(el => {
    el.title = t('materials', 'inspectDoc');
  });
  document.querySelectorAll('.btn-single-download').forEach(el => {
    el.title = t('materials', 'downloadFileAction');
  });
  document.querySelectorAll('.file-new-badge').forEach(el => {
    el.textContent = t('materials', 'newBadge');
  });
  document.querySelectorAll('.btn-download-pack').forEach(btn => {
    btn.title = t('materials', 'downloadCoursePack');
    const s = btn.querySelector('span');
    if (s) s.textContent = t('materials', 'downloadCoursePack');
  });

  const selPrefix = document.getElementById('lbl-mat-selected-prefix');
  if (selPrefix) selPrefix.textContent = t('materials', 'selectedPrefix');

  if (typeof updateAllCounts === 'function') {
    updateAllCounts();
  } else if (typeof window !== 'undefined' && typeof window.updateAllCounts === 'function') {
    window.updateAllCounts();
  }
}

function updateHeaderTranslations() {
  updateTimetableTranslations();
  const syncBtn = document.getElementById('btn-fulltab-sync');
  if (syncBtn) {
    const s = syncBtn.querySelector('span');
    if (s) s.textContent = t('headers', 'sync');
  }

  const diagBtn = document.getElementById('btn-fulltab-diag');
  if (diagBtn) {
    const s = diagBtn.querySelector('span');
    if (s) s.textContent = t('headers', 'diag');
  }

  const autoTakeText = document.getElementById('btn-fulltab-quick-auto-take-text');
  if (autoTakeText) autoTakeText.textContent = t('headers', 'autoTake');

  const popupSyncLabel = document.getElementById('btn-refresh-activities-label');
  if (popupSyncLabel) popupSyncLabel.textContent = t('headers', 'sync');

  const popupOpenTab = document.getElementById('btn-open-tab');
  if (popupOpenTab) {
    const s = popupOpenTab.querySelector('span');
    if (s) s.textContent = t('headers', 'fullWorkstation');
  }

  // Update Theme Switch Tooltips
  const isThemeDark = currentTheme === 'dark';
  const themeTooltipText = isThemeDark ? t('tooltips', 'switchToLight') : t('tooltips', 'switchToDark');
  document.querySelectorAll('.theme-switch-btn').forEach(btn => {
    btn.title = themeTooltipText || (isThemeDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  });

  const tabActs = document.querySelector('.primary-tab-btn[data-tab="tab-activities"]');
  if (tabActs) tabActs.textContent = t('tooltips', 'activities');
  const tabTt = document.querySelector('.primary-tab-btn[data-tab="tab-timetable"]');
  if (tabTt) tabTt.textContent = t('tooltips', 'timetable');
  const tabMat = document.querySelector('.primary-tab-btn[data-tab="tab-materials"]');
  if (tabMat) tabMat.textContent = t('tooltips', 'mat');
  const tabPref = document.querySelector('.primary-tab-btn[data-tab="tab-filters"]');
  if (tabPref) tabPref.textContent = t('tooltips', 'pref');
  const tabSupp = document.querySelector('.primary-tab-btn[data-tab="tab-support"]');
  if (tabSupp) tabSupp.textContent = t('tooltips', 'tipjar');

  const labelGroup = document.getElementById('label-fulllist-grouping') || document.querySelector('#fulllist-grouping-toggle .label');
  if (labelGroup) labelGroup.textContent = t('headers', 'by');
  const labelSort = document.getElementById('label-fulllist-sorting') || document.querySelector('#fulllist-sorting-toggle .label');
  if (labelSort) labelSort.textContent = t('headers', 'sort');

  const btnGroupDate = document.getElementById('btn-fulllist-group-date');
  if (btnGroupDate) btnGroupDate.textContent = t('headers', 'byDate');
  const btnGroupCourse = document.getElementById('btn-fulllist-group-course');
  if (btnGroupCourse) btnGroupCourse.textContent = t('headers', 'byCourse');
  const btnSortNewest = document.getElementById('btn-fulllist-sort-newest');
  if (btnSortNewest) btnSortNewest.textContent = t('headers', 'newest');
  const btnSortOldest = document.getElementById('btn-fulllist-sort-oldest');
  if (btnSortOldest) btnSortOldest.textContent = t('headers', 'oldest');

  const popupSortNewest = document.getElementById('btn-sort-newest');
  if (popupSortNewest) popupSortNewest.textContent = t('headers', 'newest');
  const popupSortOldest = document.getElementById('btn-sort-oldest');
  if (popupSortOldest) popupSortOldest.textContent = t('headers', 'oldest');

  const courseCountLabel = document.getElementById('fulllist-course-count-label') || document.querySelector('#fulllist-side-course-pane .sticky-date-month');
  if (courseCountLabel) {
    courseCountLabel.textContent = currentLang === 'zh' ? '个课程' : (currentLang === 'bm' ? 'KURSUS' : 'COURSES');
  }
  const courseItemsEl = document.getElementById('fulllist-course-items-count');
  if (courseItemsEl && courseItemsEl.textContent) {
    const numMatch = courseItemsEl.textContent.match(/\d+/);
    if (numMatch) {
      const num = numMatch[0];
      courseItemsEl.textContent = currentLang === 'zh'
        ? `${num} 个活动`
        : (currentLang === 'bm' ? `${num} Aktiviti` : `${num} Activities`);
    }
  }

  const btnPrev = document.getElementById('fulllist-side-prev');
  if (btnPrev) {
    const s = btnPrev.querySelector('.side-btn-text');
    if (s) s.textContent = t('headers', 'prevDay');
  }
  const btnToday = document.getElementById('fulllist-side-today');
  if (btnToday) {
    const s = btnToday.querySelector('.side-btn-text');
    if (s) s.textContent = t('headers', 'today');
  }
  const btnNext = document.getElementById('fulllist-side-next');
  if (btnNext) {
    const s = btnNext.querySelector('.side-btn-text');
    if (s) s.textContent = t('headers', 'nextDay');
  }
  const btnPrevAct = document.getElementById('fulllist-side-prev-act');
  if (btnPrevAct) btnPrevAct.textContent = t('headers', 'prevEvent');
  const btnNextAct = document.getElementById('fulllist-side-next-act');
  if (btnNextAct) btnNextAct.textContent = t('headers', 'nextEvent');

  const calTodayBtn = document.getElementById('btn-cal-today');
  if (calTodayBtn) calTodayBtn.textContent = t('headers', 'today');

  const calWeekdays = document.querySelectorAll('#cal-weekdays-header .cal-weekday-cell');
  if (calWeekdays && calWeekdays.length === 7) {
    const daysEn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const daysBm = ['Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab', 'Ahd'];
    const daysZh = ['一', '二', '三', '四', '五', '六', '日'];
    const days = (currentLang === 'zh') ? daysZh : ((currentLang === 'bm') ? daysBm : daysEn);
    calWeekdays.forEach((cell, idx) => {
      if (days[idx]) cell.textContent = days[idx];
    });
  }

  const miniWeekdays = document.querySelectorAll('.mini-cal-day-headers span');
  if (miniWeekdays && miniWeekdays.length === 7) {
    const mDaysEn = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const mDaysBm = ['I', 'S', 'R', 'K', 'J', 'S', 'A'];
    const mDaysZh = ['一', '二', '三', '四', '五', '六', '日'];
    const mDays = (currentLang === 'zh') ? mDaysZh : ((currentLang === 'bm') ? mDaysBm : mDaysEn);
    miniWeekdays.forEach((cell, idx) => {
      if (mDays[idx]) cell.textContent = mDays[idx];
    });
  }
}

window.t = t;
window.I18N = I18N;
window.setAppLanguage = setAppLanguage;
try {
  Object.defineProperty(window, 'currentLang', {
    get: () => currentLang,
    set: (v) => { currentLang = v; },
    configurable: true
  });
} catch (e) {
  window.currentLang = currentLang;
}

function setAppLanguage(lang, broadcast = true) {
  if (!['en', 'bm', 'zh'].includes(lang)) lang = 'en';
  currentLang = lang;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ appLanguage: lang });
    if (broadcast && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'LANGUAGE_CHANGED', lang });
      } catch (e) {}
    }
  }

  document.querySelectorAll('.rail-lang-btn, .popup-lang-btn, .lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  updateSidebarLabels();
  updateHeaderTranslations();
  updatePreferencesTranslations();
  updateMaterialsTranslations();

  if (typeof window.onLanguageChange === 'function') {
    try {
      window.onLanguageChange();
    } catch (e) {
      console.error('[i18n] UI refresh error:', e);
    }
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'LANGUAGE_CHANGED' && msg.lang && msg.lang !== currentLang) {
      setAppLanguage(msg.lang, false);
    }
  });
}

// ── Theme Management Engine (Light / Dark Mode) ──
let currentTheme = 'light';

try {
  Object.defineProperty(window, 'currentTheme', {
    get: () => currentTheme,
    set: (v) => { currentTheme = v; },
    configurable: true
  });
} catch (e) {
  window.currentTheme = currentTheme;
}

function setAppTheme(theme, broadcast = true) {
  if (!['light', 'dark'].includes(theme)) theme = 'light';
  currentTheme = theme;

  const isDark = theme === 'dark';

  // Apply to both documentElement and body for complete CSS compatibility
  if (document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  if (document.body) {
    document.body.setAttribute('data-theme', theme);
  }

  // Update theme switch buttons across popup and fulltab headers
  const tooltipText = isDark ? t('tooltips', 'switchToLight') : t('tooltips', 'switchToDark');
  document.querySelectorAll('.theme-switch-btn').forEach(btn => {
    btn.setAttribute('aria-checked', isDark ? 'true' : 'false');
    btn.classList.toggle('is-dark', isDark);
    btn.title = tooltipText || (isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  });

  // Persist to storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ appTheme: theme });
    if (broadcast && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'THEME_CHANGED', theme });
      } catch (e) {}
    }
  }

  try {
    localStorage.setItem('spectrum_theme', theme);
  } catch (e) {}

  if (typeof window.onThemeChange === 'function') {
    try {
      window.onThemeChange(theme);
    } catch (e) {}
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'THEME_CHANGED' && msg.theme && msg.theme !== currentTheme) {
      setAppTheme(msg.theme, false);
    }
  });
}



// Expose state references on window for cross-module access
try {
  Object.defineProperty(window, 'coursesData', {
    get: () => coursesData,
    set: (val) => { coursesData = val; },
    configurable: true
  });
  Object.defineProperty(window, 'allCoursesDiscovered', {
    get: () => allCoursesDiscovered,
    set: (val) => { allCoursesDiscovered = val; },
    configurable: true
  });
} catch (e) {
  window.coursesData = coursesData;
  window.allCoursesDiscovered = allCoursesDiscovered;
}
window.announcementsData = announcementsData;
window.assignmentsData = assignmentsData;
window.attendancesData = attendancesData;
window.courseOccs = courseOccs;

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

window.fetchWithTimeout = fetchWithTimeout;

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
      if (isSpinning) {
        btnRefreshActivities.classList.add('sync-progress-active');
      } else {
        btnRefreshActivities.classList.remove('sync-progress-active');
        btnRefreshActivities.style.removeProperty('--sync-pct');
      }
      if (btnRefreshActivitiesLabel) btnRefreshActivitiesLabel.textContent = text;
    }
    const fulltabBtn = document.getElementById('btn-fulltab-sync');
    if (fulltabBtn) {
      fulltabBtn.classList.toggle('spinning', isSpinning);
      if (isSpinning) {
        fulltabBtn.classList.add('sync-progress-active');
      } else {
        fulltabBtn.classList.remove('sync-progress-active');
        fulltabBtn.style.removeProperty('--sync-pct');
      }
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

  function dismissSyncOverlay() {
    isSyncOverlayDismissed = true;
    if (typeof window !== 'undefined') window.isSyncOverlayDismissed = true;
    const overlay = document.getElementById('sync-cinematic-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.style.opacity = '0';
      setTimeout(() => {
        if ((isSyncOverlayDismissed || (typeof window !== 'undefined' && window.isSyncOverlayDismissed)) && overlay.style.opacity === '0') {
          overlay.style.display = 'none';
        }
      }, 320);
    }
  }
  if (typeof window !== 'undefined') window.dismissSyncOverlay = dismissSyncOverlay;

  function updateSyncButtonProgress(percent, isSpinning = true) {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    const syncButtons = [
      document.getElementById('btn-refresh-activities'),
      document.getElementById('btn-fulltab-sync')
    ].filter(Boolean);

    for (const btn of syncButtons) {
      btn.style.setProperty('--sync-pct', clamped);
      if (isSpinning) {
        btn.classList.add('sync-progress-active', 'spinning');
        const label = btn.querySelector('#btn-refresh-activities-label') || btn.querySelector('span');
        if (label) {
          label.textContent = clamped >= 100 ? 'Done!' : ('Sync ' + clamped + '%');
        }
      } else {
        btn.classList.remove('sync-progress-active', 'spinning');
        btn.style.removeProperty('--sync-pct');
        const label = btn.querySelector('#btn-refresh-activities-label') || btn.querySelector('span');
        if (label) {
          label.textContent = 'Sync';
        }
      }
    }
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

  // Expose controller handlers onto window for cross-module invocations
  window.populateAttendanceCourseFilterOptions = populateAttendanceCourseFilterOptions;
  window.renderOccPreferencesTable = renderOccPreferencesTable;
  window.debounceSaveCache = debounceSaveCache;


  function setDiagBadge(badgeEl, status, text) {
    if (!badgeEl) return;
    badgeEl.className = `diag-badge ${status}`;
    badgeEl.textContent = text;
  }

  // Refresh diagnostic log view merging background auto-attendance logs and popup logs
  async function refreshDiagLogsDisplay() {
    try {
      const store = await chrome.storage.local.get({ autoAttendanceLogs: [] });
      const bgLogs = Array.isArray(store.autoAttendanceLogs) ? store.autoAttendanceLogs : [];

      const lines = [];
      if (bgLogs.length > 0) {
        lines.push(`=== 🛰️ BACKGROUND AUTO-ATTENDANCE LOGS (Last ${bgLogs.length} events) ===`);
        bgLogs.forEach(l => {
          lines.push(`[${l.timeStr}] [${l.category}] ${l.message} ${l.details || ''}`.trim());
        });
        lines.push('');
      }

      lines.push('=== ⚡ POPUP ACTIVITY & DIAGNOSTIC LOGS ===');
      if (diagLogs.length === 0) {
        lines.push('Diagnostic log ready. Click "Sync" or "Auto-Take Now" to trace live requests.');
      } else {
        lines.push(...diagLogs);
      }

      if (diagLogView) {
        diagLogView.textContent = lines.join('\n');
        diagLogView.scrollTop = diagLogView.scrollHeight;
      }
    } catch (e) {
      if (diagLogView) diagLogView.textContent = diagLogs.join('\n');
    }
  }
  window.refreshDiagLogsDisplay = refreshDiagLogsDisplay;

  if (diagHeaderToggle && diagBody && diagPanel) {
    diagHeaderToggle.addEventListener('click', async (e) => {
      if (e.target.closest('.diag-actions')) return;
      const isOpen = diagBody.style.display !== 'none';
      diagBody.style.display = isOpen ? 'none' : 'block';
      diagPanel.classList.toggle('open', !isOpen);
      if (!isOpen) {
        await refreshDiagLogsDisplay();
      }
    });
  }

  if (btnCopyDiagLog) {
    btnCopyDiagLog.addEventListener('click', async (e) => {
      e.stopPropagation();
      const textToCopy = (diagLogView && diagLogView.textContent) ? diagLogView.textContent : diagLogs.join('\n');
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
    btnClearDiagLog.addEventListener('click', async (e) => {
      e.stopPropagation();
      diagLogs.length = 0;
      await chrome.storage.local.set({ autoAttendanceLogs: [] });
      if (diagLogView) diagLogView.textContent = 'Logs cleared. Click "Sync" or "Auto-Take Now" to trace.';
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
      hiddenAttendanceDetails: hiddenAttendanceDetails,
      spineFocalRatio: spineFocalRatio,
      customSem1StartDate: (document.getElementById('pref-sem-start-input')?.value || '').trim()
    });
    customSem1StartDate = (document.getElementById('pref-sem-start-input')?.value || '').trim();
    updateDateHeroHeader(activeDateFilterObj || new Date());
    if (typeof renderCalendarView === 'function') {
      renderCalendarView(miniCalYear, miniCalMonth);
    }
    if (typeof updateFullTabHeader === 'function') updateFullTabHeader();

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
      if (typeof customSem1StartDate === 'string' && customSem1StartDate.trim()) {
        const parsed = new Date(customSem1StartDate.trim() + 'T00:00:00');
        if (!isNaN(parsed.getTime())) startDate = parsed;
      }
      // Start of Sem 1: First Monday of October (e.g. 5 Oct 2026)
      if (!startDate) startDate = getAcademicMonday(acYearStart, 9, 'first');
    } else if (month >= 1 && month <= 3) {
      // Semester 1 (Winter/Spring term continuation into next year: Jan - Mar)
      semType = 'SEM I';
      acYearStart = year - 1;
      acYearEnd = year;
      if (typeof customSem1StartDate === 'string' && customSem1StartDate.trim()) {
        const parsed = new Date(customSem1StartDate.trim() + 'T00:00:00');
        if (!isNaN(parsed.getTime())) startDate = parsed;
      }
      // Start of Sem 1 was first Monday of October of preceding year
      if (!startDate) startDate = getAcademicMonday(acYearStart, 9, 'first');
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
        monthHeading.textContent = t('headers', 'materialsTitle');
      } else if (currentFullTabMode === 'preferences') {
        monthHeading.textContent = t('headers', 'preferencesTitle');
      } else if (currentFullTabMode === 'timetable') {
        monthHeading.textContent = t('headers', 'timetableTitle');
      } else if (currentFullTabMode === 'timeline') {
        if (typeof updateTimelineHeaderFromScroll === 'function') updateTimelineHeaderFromScroll();
      } else if (currentFullTabMode === 'list') {
        monthHeading.textContent = (fullListGroupingMode === 'course')
          ? t('headers', 'byCourseFeed')
          : formatMonthYearHeading(fullListCurrentDate || now);
      } else {
        monthHeading.textContent = formatMonthYearHeading(now);
      }
    }
    if (weekPill && currentFullTabMode !== 'timeline') weekPill.textContent = info.weekPill;
    if (syncTimeEl) {
      syncTimeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
    if (typeof updateAttendanceDaemonStatus === 'function') updateAttendanceDaemonStatus();
  }

  // Surface Detection: Full-Tab Workspace vs Compact Popup Layout
  // Layout is STRICTLY LOCKED to the compact popup layout unless explicitly opening Full Workstation via mode=full
  function checkIsFullTab() {
    return window.location.search.includes('mode=full');
  }

  const isFullTab = checkIsFullTab();
  document.body.classList.toggle('is-full-tab', isFullTab);
  document.documentElement.classList.toggle('is-full-tab', isFullTab);
  if (isFullTab) window.scrollTo(0, 0);

  // Pinned Mode detection (Side Panel, In-Page Drawer, or Detached Window)
  const isSidePanel = window.location.search.includes('mode=sidepanel');
  const isDrawer = window.location.search.includes('mode=drawer');
  const isDetached = window.location.search.includes('mode=detached');
  const isFloating = window.location.search.includes('mode=floating');
  const isPinned = isSidePanel || isDrawer || isDetached || isFloating;

  if (isPinned) {
    document.body.classList.add('is-pinned-mode');
    document.documentElement.classList.add('is-pinned-mode');
    if (isSidePanel) document.body.classList.add('is-sidepanel');
    if (isDrawer) document.body.classList.add('is-drawer');
    if (isDetached) document.body.classList.add('is-detached-window');
    if (isFloating) document.body.classList.add('is-floating-mode');

    const pinLabel = document.getElementById('btn-detach-popup-label');
    if (pinLabel) pinLabel.textContent = 'Pinned';
    const pinBtn = document.getElementById('btn-detach-popup');
    if (pinBtn) {
      pinBtn.title = '📌 Pinned Mode Active (Will not disappear when clicking outside)';
      pinBtn.classList.add('active');
    }

    // Persist window size and position changes if detached
    if (isDetached) {
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (window.outerWidth && window.outerHeight) {
            chrome.storage.local.set({
              detachedWindowBounds: {
                width: window.outerWidth,
                height: window.outerHeight,
                left: window.screenX,
                top: window.screenY
              }
            }).catch(() => {});
          }
        }, 300);
      });
    }
  }

  function ensureTabsInCorrectSurface() {
    const isFull = document.body.classList.contains('is-full-tab');
    const targetParent = isFull 
      ? document.querySelector('.fulltab-main-viewport')
      : document.querySelector('.popup-body');
    if (!targetParent) return;

    ['tab-timetable', 'tab-materials', 'tab-filters', 'tab-support'].forEach(id => {
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

    }
  });
  updateFullTabHeader();
  ensureTabsInCorrectSurface();


  // Language Switcher Bindings (.rail-lang-btn & .popup-lang-btn)
  function bindLanguageSwitchers() {
    document.querySelectorAll('.rail-lang-btn, .popup-lang-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const lang = btn.dataset.lang;
        if (lang && lang !== currentLang) {
          setAppLanguage(lang, true);
        }
      });
    });
  }
  bindLanguageSwitchers();

  // Document-level delegation for responsive language switching across all surfaces
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.rail-lang-btn, .popup-lang-btn, .lang-btn');
    if (btn && btn.dataset && btn.dataset.lang) {
      e.preventDefault();
      const lang = btn.dataset.lang;
      if (lang && lang !== currentLang) {
        setAppLanguage(lang, true);
      }
    }
  });

  // Load Saved Language Preference
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['appLanguage'], (res) => {
      const savedLang = res && res.appLanguage;
      if (savedLang && ['en', 'bm', 'zh'].includes(savedLang)) {
        setAppLanguage(savedLang, false);
      } else {
        setAppLanguage('en', false);
      }
    });
  } else {
    setAppLanguage('en', false);
  }

  // Load Saved Theme & Initialize Header Switches
  function initThemeControls() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['appTheme'], (res) => {
        let savedTheme = res && res.appTheme;
        if (!savedTheme) {
          try {
            savedTheme = localStorage.getItem('spectrum_theme');
          } catch (e) {}
        }
        if (savedTheme && ['light', 'dark'].includes(savedTheme)) {
          setAppTheme(savedTheme, false);
        } else {
          const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          setAppTheme(prefersDark ? 'dark' : 'light', false);
        }
      });
    } else {
      let savedTheme;
      try {
        savedTheme = localStorage.getItem('spectrum_theme');
      } catch (e) {}
      if (savedTheme && ['light', 'dark'].includes(savedTheme)) {
        setAppTheme(savedTheme, false);
      } else {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        setAppTheme(prefersDark ? 'dark' : 'light', false);
      }
    }

    // Attach click listeners to all theme switch buttons (in popup & fulltab headers)
    document.querySelectorAll('.theme-switch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setAppTheme(nextTheme, true);
      });
    });
  }

  initThemeControls();


  // 1. Full Tab, Detach Window & Close Button Handling
  function openDetachedWindow() {
    const activeTabBtn = document.querySelector('.primary-tab-btn.active');
    const activeTabId = activeTabBtn?.dataset?.tab || 'tab-activities';
    let targetUrl = `popup/popup.html?mode=detached&tab=${encodeURIComponent(activeTabId)}`;
    if (typeof currentActivitiesSub === 'string' && currentActivitiesSub) {
      targetUrl += `&sub=${encodeURIComponent(currentActivitiesSub)}`;
    }

    const fullUrl = chrome.runtime.getURL(targetUrl);

    chrome.storage.local.get(['detachedWindowBounds']).then(res => {
      const saved = res.detachedWindowBounds || {};
      const screenW = window.screen.availWidth || window.screen.width || 1280;
      const screenH = window.screen.availHeight || window.screen.height || 800;

      const width = saved.width && saved.width >= 400 && saved.width <= 1600 ? saved.width : 780;
      const height = saved.height && saved.height >= 500 && saved.height <= 1200 ? saved.height : 760;
      const defaultLeft = Math.max(0, screenW - width - 24);
      const defaultTop = Math.max(0, Math.round((screenH - height) / 2));
      const left = (typeof saved.left === 'number' && saved.left >= 0 && saved.left < screenW - 100) ? saved.left : defaultLeft;
      const top = (typeof saved.top === 'number' && saved.top >= 0 && saved.top < screenH - 100) ? saved.top : defaultTop;

      if (chrome.windows && chrome.windows.create) {
        chrome.windows.create({
          url: fullUrl,
          type: 'popup',
          width: Math.round(width),
          height: Math.round(height),
          left: Math.round(left),
          top: Math.round(top),
          focused: true
        }, () => {
          if (!window.location.search.includes('mode=full') && !window.location.search.includes('mode=detached')) {
            window.close();
          }
        });
      } else {
        window.open(fullUrl, '_blank', `width=${width},height=${height},left=${left},top=${top}`);
        if (!window.location.search.includes('mode=full') && !window.location.search.includes('mode=detached')) {
          window.close();
        }
      }
    }).catch(() => {
      if (chrome.windows && chrome.windows.create) {
        chrome.windows.create({
          url: fullUrl,
          type: 'popup',
          width: 780,
          height: 760,
          focused: true
        }, () => window.close());
      }
    });
  }

  const btnDetachPopup = document.getElementById('btn-detach-popup');
  if (btnDetachPopup) {
    btnDetachPopup.addEventListener('click', async (e) => {
      e.preventDefault();

      if (window.location.search.includes('mode=floating')) {
        window.parent.postMessage({ type: 'TOGGLE_SPECTRUM_PIN' }, '*');
        return;
      }

      const activeMainTab = document.querySelector('.primary-tab-btn.active')?.dataset.tab || 'tab-activities';
      const activeSubTab = document.querySelector('.sub-tab-btn.active')?.dataset.sub || '';

      // Saladict-Style Floating Pin Panel Engine (Directly on active web tab)
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id) return;

        // Check for internal Chrome pages (chrome://, edge://, devtools://, about:)
        const isRestrictedUrl = !activeTab.url || /^(chrome|edge|devtools|about|chrome-extension):/i.test(activeTab.url);
        if (isRestrictedUrl) {
          alert('Pin mode: Please open any regular webpage (e.g. SPeCTRUM, Google, etc.) to use the floating pinned panel.');
          return;
        }

        chrome.tabs.sendMessage(activeTab.id, {
          type: 'OPEN_FLOATING_PANEL',
          pinned: true,
          tab: activeMainTab,
          sub: activeSubTab
        }, async (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            // Tab was opened prior to extension reload; inject dynamically
            try {
              if (chrome.scripting) {
                await chrome.scripting.insertCSS({
                  target: { tabId: activeTab.id },
                  files: ['scripts/content.css']
                });
                await chrome.scripting.executeScript({
                  target: { tabId: activeTab.id },
                  files: ['scripts/content.js']
                });
                setTimeout(() => {
                  chrome.tabs.sendMessage(activeTab.id, {
                    type: 'OPEN_FLOATING_PANEL',
                    pinned: true,
                    tab: activeMainTab,
                    sub: activeSubTab
                  });
                  window.close();
                }, 80);
                return;
              }
            } catch (injectErr) {
              console.warn('[SPeCTRUM Pro] Dynamic content script injection error:', injectErr);
            }
          } else {
            window.close();
          }
        });
      } catch (err) {
        console.error('[SPeCTRUM Pro] Pin launch error:', err);
      }
    });
  }

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
      if (window.location.search.includes('mode=floating')) {
        window.parent.postMessage({ type: 'CLOSE_SPECTRUM_FLOATING' }, '*');
      } else {
        window.close();
      }
    });
  }

  // Full-Tab Header Actions (Sync & Diagnostics)
  const btnFulltabSync = document.getElementById('btn-fulltab-sync');
  const btnFulltabDiag = document.getElementById('btn-fulltab-diag');
  const btnCloseDiagPanel = document.getElementById('btn-close-diag-panel');
  if (btnFulltabSync) {
    btnFulltabSync.addEventListener('click', () => {
      const isSyncing = isSyncingActivities || (typeof isScanningMaterials !== 'undefined' && isScanningMaterials) || (typeof window !== 'undefined' && window.isScanningMaterials);
      const isDismissed = isSyncOverlayDismissed || (typeof window !== 'undefined' && window.isSyncOverlayDismissed);
      if (isSyncing && isDismissed) {
        isSyncOverlayDismissed = false;
        if (typeof window !== 'undefined') window.isSyncOverlayDismissed = false;
        const overlay = document.getElementById('sync-cinematic-overlay');
        if (overlay) {
          overlay.style.display = 'flex';
          void overlay.offsetWidth;
          overlay.classList.add('active');
          overlay.style.opacity = '1';
        }
        return;
      }
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
    btnFulltabDiag.addEventListener('click', async () => {
      const isVisible = diagPanel.style.display !== 'none';
      diagPanel.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        if (diagBody) diagBody.style.display = 'block';
        await refreshDiagLogsDisplay();
      }
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

  // Left Rail View Switcher (Timeline, Calendar, List, Timetable)
  const railModeTimeline = document.getElementById('rail-mode-timeline');
  const railModeCalendar = document.getElementById('rail-mode-calendar');
  const railModeList = document.getElementById('rail-mode-list');
  const railModeTimetable = document.getElementById('rail-mode-timetable');

  function setFullTabMode(mode) {
    currentFullTabMode = mode;
    ensureTabsInCorrectSurface();

    const calSec = document.getElementById('calendar-section');
    const tlSec = document.getElementById('timeline-visualizer-section');
    const listSec = document.getElementById('fulllist-wrapper');
    const ttSec = document.getElementById('tab-timetable');
    const matSec = document.getElementById('tab-materials');
    const prefSec = document.getElementById('tab-filters');
    const suppSec = document.getElementById('tab-support');

    // Reset active states on rail
    if (railBtnPref) railBtnPref.classList.remove('active');
    if (railBtnMat) railBtnMat.classList.remove('active');
    [railModeTimeline, railModeCalendar, railModeList, railModeTimetable].forEach(b => {
      if (b) b.classList.toggle('active', b.dataset.mode === mode);
    });

    if (calSec) calSec.style.display = 'none';
    if (tlSec) tlSec.style.display = 'none';
    if (listSec) listSec.style.display = 'none';
    if (ttSec) { ttSec.style.display = 'none'; ttSec.classList.remove('active'); }
    if (matSec) { matSec.style.display = 'none'; matSec.classList.remove('active'); }
    if (prefSec) { prefSec.style.display = 'none'; prefSec.classList.remove('active'); }
    if (suppSec) { suppSec.style.display = 'none'; suppSec.classList.remove('active'); }

    // Toggle surface mode classes on body for scoped styling
    document.body.classList.toggle('mode-materials', mode === 'materials');
    document.body.classList.toggle('mode-preferences', mode === 'preferences');
    document.body.classList.toggle('mode-calendar', mode === 'calendar');
    document.body.classList.toggle('mode-timeline', mode === 'timeline');
    document.body.classList.toggle('mode-list', mode === 'list');
    document.body.classList.toggle('mode-timetable', mode === 'timetable');

    const monthHeading = document.getElementById('fulltab-month-heading');
    const calPrevBtn = document.getElementById('btn-cal-prev');
    const calNextBtn = document.getElementById('btn-cal-next');
    const calTodayBtn = document.getElementById('btn-cal-today');
    const weekPill = document.getElementById('fulltab-week-pill');

    const isNonCalendar = (mode === 'materials' || mode === 'preferences' || mode === 'timetable');
    if (calPrevBtn) calPrevBtn.style.display = isNonCalendar ? 'none' : '';
    if (calNextBtn) calNextBtn.style.display = isNonCalendar ? 'none' : '';
    if (calTodayBtn) calTodayBtn.style.display = isNonCalendar ? 'none' : '';
    if (weekPill) weekPill.style.display = isNonCalendar ? 'none' : '';

    if (mode === 'timeline') {
      if (tlSec) tlSec.style.display = 'flex';
      if (monthHeading) {
        monthHeading.textContent = formatMonthYearHeading(new Date());
      }
      renderTimelineVisualizer();
    } else if (mode === 'calendar') {
      if (calSec) calSec.style.display = 'flex';
      renderCalendarView(calCurrentYear, calCurrentMonth);
    } else if (mode === 'list') {
      if (listSec) listSec.style.display = 'flex';
      fullListGroupingMode = 'course';
      fullListCurrentDate = new Date();
      if (monthHeading) {
        monthHeading.textContent = t('headers', 'byCourseFeed');
      }
      renderFullListMode(fullListCurrentDate, 1);
    } else if (mode === 'timetable') {
      if (ttSec) {
        ttSec.style.display = 'flex';
        ttSec.classList.add('active');
      }
      if (monthHeading) monthHeading.textContent = t('headers', 'timetableTitle');
      if (typeof renderTimetableMode === 'function') renderTimetableMode();
    } else if (mode === 'materials') {
      if (railBtnMat) railBtnMat.classList.add('active');
      if (matSec) {
        matSec.style.display = 'flex';
        matSec.classList.add('active');
      }
      if (monthHeading) monthHeading.textContent = t('headers', 'materialsTitle');
      renderCourseTreeShells();
      const needsMaterialScan = coursesData.length === 0 || coursesData.some(c => !c.loaded && (!c.sections || c.sections.length === 0));
      if (needsMaterialScan) {
        const scanFn = (typeof scanCourses === 'function') ? scanCourses : (window.scanCourses || null);
        if (scanFn) scanFn(null, false);
      }
    } else if (mode === 'preferences') {
      if (railBtnPref) railBtnPref.classList.add('active');
      if (prefSec) {
        prefSec.style.display = 'flex';
        prefSec.classList.add('active');
      }
      if (monthHeading) monthHeading.textContent = t('headers', 'preferencesTitle');
      renderOccPreferencesTable();
      renderHiddenAttendanceSettings();
      if (typeof updatePreferencesStorageStats === 'function') updatePreferencesStorageStats();
    }
  }

  if (railModeTimeline) railModeTimeline.addEventListener('click', () => setFullTabMode('timeline'));
  if (railModeCalendar) railModeCalendar.addEventListener('click', () => setFullTabMode('calendar'));
  if (railModeList) railModeList.addEventListener('click', () => setFullTabMode('list'));
  if (railModeTimetable) railModeTimetable.addEventListener('click', () => setFullTabMode('timetable'));

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
    if (document.body && document.body.classList.contains('is-full-tab')) {
      if (type === 'notice') {
        const btn = document.getElementById('rail-toggle-notice');
        if (btn) return btn.classList.contains('active');
      } else if (type === 'tutorial' || type === 'assignment') {
        const btn = document.getElementById('rail-toggle-assign');
        if (btn) return btn.classList.contains('active');
      } else if (type === 'attendance') {
        const btn = document.getElementById('rail-toggle-att');
        if (btn) return btn.classList.contains('active');
      }
    }
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
        const codeMatch = rawName.match(/\b([A-Z]{2,4}\d{4})\b/);
        const cCode = cleanSingleCourseCode(code || (codeMatch ? codeMatch[0] : 'COURSE'));
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
    const code = cleanSingleCourseCode((assign.courseCode || 'TASK').trim());
    const rawName = (assign.courseName || '').trim();
    const cleanName = (typeof cleanDisplayCourseName === 'function') ? cleanDisplayCourseName(rawName, code) : rawName;
    const headerLeftText = cleanName 
      ? `${code} / ${cleanName.toUpperCase()}`
      : code;

    const rawOcc = assign.userOcc || (assign.courseId && courseOccs[assign.courseId]) || defaultOcc || '';
    const occFormatted = formatOccTag(rawOcc);

    // 2. Assignment Title
    const title = assign.title || assign.name || 'Assignment';

    // 3. Unified Bottom Baseline (Indicator · Token · Timestamp · Inline 28px CTA)
    let dotClass = 'dot-upcoming';
    let tokenClass = 'token-upcoming';
    let tokenText = t('cards', 'upcoming');
    let btnClass = 'btn-assign-normal';
    let btnText = t('cards', 'submit');

    if (isSubmitted) {
      dotClass = 'dot-submitted';
      tokenClass = 'token-submitted';
      tokenText = t('cards', 'submitted');
      btnClass = 'btn-assign-submitted';
      btnText = t('cards', 'submitted');
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
      tokenText = t('cards', 'overdueDays', { d: daysOverdue });
      btnClass = 'btn-assign-overdue';
      btnText = t('cards', 'submitLate');
    } else if (hasValidDate) {
      const diffMs = d.getTime() - now.getTime();
      const diffHours = Math.round(diffMs / (1000 * 60 * 60));
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffHours <= 2) {
        tokenText = t('cards', 'dueInHours', { h: Math.max(1, diffHours) });
        dotClass = 'dot-overdue';
        tokenClass = 'token-overdue';
      } else if (diffHours <= 24) {
        tokenText = t('cards', 'dueToday');
        dotClass = 'dot-overdue';
        tokenClass = 'token-overdue';
      } else if (diffDays === 1) {
        tokenText = t('cards', 'dueTomorrow');
      } else {
        tokenText = t('cards', 'dueInDays', { d: diffDays });
      }
      btnText = t('cards', 'submit');
    }

    // Format timestamp (e.g., "Wed 28 Oct, 23:00" or Chinese "10月28日 23:00")
    let timestampText = '';
    if (hasValidDate) {
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      if (currentLang === 'zh') {
        const mon = String(d.getMonth() + 1);
        timestampText = `${mon}月${day}日 ${hours}:${mins}`;
      } else if (currentLang === 'bm') {
        const mon = d.toLocaleDateString('ms-MY', { month: 'short' });
        const wd = d.toLocaleDateString('ms-MY', { weekday: 'short' });
        timestampText = `${wd} ${day} ${mon}, ${hours}:${mins}`;
      } else {
        const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
        const mon = d.toLocaleDateString('en-US', { month: 'short' });
        timestampText = `${wd} ${day} ${mon}, ${hours}:${mins}`;
      }
    } else {
      const rawDue = assign.dueDateStr || assign.timeStr || assign.dateStr || '';
      if (!rawDue || /no\s*deadline|no\s*due\s*date|tiada/i.test(rawDue)) {
        timestampText = t('cards', 'noDeadline');
      } else {
        timestampText = rawDue;
      }
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
    const code = cleanSingleCourseCode((ann.courseCode || 'NOTICE').trim());
    const rawName = (ann.courseName || '').trim();
    const cleanName = (typeof cleanDisplayCourseName === 'function') ? cleanDisplayCourseName(rawName, code) : rawName;
    const headerLeftText = cleanName 
      ? `${code} / ${cleanName.toUpperCase()}`
      : code;

    // Date: e.g. "17 OCT 2026"
    let formattedDate = 'ANNOUNCEMENT';
    if (d && !isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      if (currentLang === 'zh') {
        const mon = d.getMonth() + 1;
        formattedDate = `${year}年${mon}月${day}日`;
      } else if (currentLang === 'bm') {
        const mon = d.toLocaleDateString('ms-MY', { month: 'short' }).toUpperCase();
        formattedDate = `${day} ${mon} ${year}`;
      } else {
        const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        formattedDate = `${day} ${mon} ${year}`;
      }
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
              <span class="notice-type-tag">${t('cards', 'notice')}</span>
              <span class="notice-sep">·</span>
              <span class="notice-author" title="${escapeHtml(vm.author)}">${escapeHtml(vm.author)}</span>
            </div>
            <div class="notice-footer-right">
              <button type="button" class="btn-notice-open btn-open-notice" data-ann-id="${escapeHtml(vm.rawId)}" title="Read Announcement in SPeCTRUM Pro">
                ${t('cards', 'openFull')}
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

    // 1. Resolve matching session for this card
    let session = sessionData.session || null;
    if (!session) {
      if (sessionData.dateKey) {
        session = Array.isArray(att.sessions) ? att.sessions.find(s => s.dateKey === sessionData.dateKey) : null;
      } else if (typeof activeDateFilter !== 'undefined' && activeDateFilter) {
        session = Array.isArray(att.sessions) ? att.sessions.find(s => s.dateKey === activeDateFilter) : null;
      }
    }
    if (!session) {
      session = att.activeSession || 
        (Array.isArray(att.sessions) ? att.sessions.find(s => s.isToday || s.dateKey === todayKey) : null) || 
        att.nextSession || 
        (Array.isArray(att.sessions) && att.sessions.length > 0 ? att.sessions[0] : null);
    }

    // Resolve target date and dateKey accurately for this specific session
    let targetDate = null;
    if (sessionData.date) {
      targetDate = (sessionData.date instanceof Date) ? sessionData.date : new Date(sessionData.date);
    } else if (session?.date) {
      targetDate = (session.date instanceof Date) ? session.date : new Date(session.date);
    } else if (sessionData.dateKey) {
      targetDate = new Date(sessionData.dateKey + 'T12:00:00');
    } else if (session?.dateKey) {
      targetDate = new Date(session.dateKey + 'T12:00:00');
    } else if (typeof activeDateFilter !== 'undefined' && activeDateFilter) {
      targetDate = new Date(activeDateFilter + 'T12:00:00');
    }
    if (!targetDate || isNaN(targetDate.getTime())) {
      const candidateStr = session?.dateStr || session?.time || sessionData?.timeStr || session?.desc || '';
      if (candidateStr) {
        const p = (typeof parseMoodleDate === 'function') ? parseMoodleDate(candidateStr) : new Date(candidateStr);
        if (p && !isNaN(p.getTime())) targetDate = p;
      }
    }
    if (!targetDate || isNaN(targetDate.getTime())) {
      targetDate = new Date();
    }

    const effectiveDateKey = sessionData.dateKey || session?.dateKey || formatDateKey(targetDate);
    const targetDateKey = effectiveDateKey;

    const isLive = Boolean(sessionData.isLive || (att.activeSession && att.activeSession.takeUrl && (effectiveDateKey === todayKey)));
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

    // Check weekly timetable as secondary source if no direct session time found
    if (!parsedTime && typeof extractWeeklyTimetableSessions === 'function') {
      try {
        const ttSessions = extractWeeklyTimetableSessions();
        const dayIdx = targetDate.getDay();
        const matchedTt = ttSessions.find(s => cleanSingleCourseCode(s.courseCode) === cleanSingleCourseCode(code) && s.dayIndex === dayIdx);
        if (matchedTt) {
          const tStr = matchedTt.time || matchedTt.timeStr || '';
          if (tStr) parsedTime = parseTimeRangeRobust(tStr);
        }
      } catch (ttErr) {}
    }

    // Default time fallback (sensible morning slot, only if truly unscheduled)
    const startHour = parsedTime ? parsedTime.startHour : 9;
    const startMin = parsedTime ? parsedTime.startMin : 0;
    const endHour = parsedTime ? parsedTime.endHour : 11;
    const endMin = parsedTime ? parsedTime.endMin : 0;
    const timeRangeStr = parsedTime ? parsedTime.formatted : 'Class Session';

    // 3. Date, Elapsed & Window Status Calculation
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

    if (dayDiff < 0 || (dayDiff === 0 && now.getTime() < startMs)) {
      // Future date or upcoming class time today: UPCOMING (never ended)
      progressPct = 0;
      isFuture = true;
      isEnded = false;
    } else if (dayDiff === 0 && now.getTime() >= startMs && now.getTime() <= endMs) {
      // Current active window today
      progressPct = Math.min(100, Math.max(8, Math.round(((now.getTime() - startMs) / totalDurationMs) * 100)));
      minsLeft = Math.max(1, Math.round((endMs - now.getTime()) / 60000));
      isFuture = false;
      isEnded = false;
    } else {
      // Past day or class has already ended earlier today: ENDED
      progressPct = 100;
      isEnded = true;
      isFuture = false;
      endedMins = Math.round((now.getTime() - endMs) / 60000);
    }

    if (isLive) {
      isEnded = false;
      isFuture = false;
      if (progressPct === 0) progressPct = 30;
      if (progressPct >= 100) progressPct = 85;
      if (minsLeft <= 0 && parsedTime) {
        minsLeft = Math.max(1, Math.round((endMs - now.getTime()) / 60000));
      } else if (minsLeft <= 0) {
        minsLeft = 30;
      }
    }

    // 4. Course & OCC
    const code = cleanSingleCourseCode(att.courseCode || sessionData.courseCode || 'COURSE');
    const rawName = att.courseName || sessionData.courseName || code;
    const cleanName = (typeof cleanDisplayCourseName === 'function') ? cleanDisplayCourseName(rawName, code) : rawName;
    const occRaw = att.userOcc || sessionData.userOcc || courseOccs[att.courseId || sessionData.cid] || defaultOcc || '1';
    const occNum = cleanOccNumber(occRaw) || '1';

    // 5. Action / Status Routing
    const rawAttId = att.id || sessionData.cardId || '';
    const cid = att.courseId || sessionData.cid || '';
    const takeUrl = sessionData.takeUrl || att.activeSession?.takeUrl || att.attUrl || 'https://spectrum.um.edu.my';
    const attPageUrl = att.attUrl || takeUrl || (cid ? `https://spectrum.um.edu.my/course/view.php?id=${cid}` : 'https://spectrum.um.edu.my');
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
        statusPillHtml = `<span class="att-urgent-pill">${t('cards', 'leftMin', { m: minsLeft })}</span>`;
      } else {
        statusPillHtml = `<span class="att-status-pill pill-active">${t('cards', 'active')}</span>`;
      }

      if (requiresPassword) {
        stateBadgeHtml = `<span class="att-state-badge state-password">🔒 ${t('cards', 'password')}</span>`;
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
            ${t('cards', 'pinRequired')}
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
            ⚡ ${t('cards', 'takeAttendance')}
          </button>
        `;
      }
    } else if (isVerified) {
      stateClass = 'state-recorded';
      statusPillHtml = `<span class="att-status-pill pill-recorded">${t('cards', 'recorded')}</span>`;
      stateBadgeHtml = '';
      windowSubHtml = `<span class="att-window-sub">${t('cards', 'attended')}</span>`;
      actionBtnHtml = `<a href="${escapeHtml(attPageUrl)}" target="_blank" class="btn-att-action btn-att-present" data-att-url="${escapeHtml(attPageUrl)}" title="Open attendance in SPeCTRUM for manual checking">${t('cards', 'present')}</a>`;
    } else if (isEnded) {
      stateClass = 'state-ended';
      statusPillHtml = `<span class="att-status-pill">${t('cards', 'ended')}</span>`;
      stateBadgeHtml = `<span class="att-state-badge state-locked">${t('cards', 'locked')}</span>`;
      windowSubHtml = `<span class="att-window-sub">${t('cards', 'sessionEnded')}</span>`;
      actionBtnHtml = `<a href="${escapeHtml(takeUrl)}" target="_blank" class="btn-att-action btn-att-faint" title="Open attendance in SPeCTRUM">${t('cards', 'checkPortal')}</a>`;
    } else if (isFuture) {
      stateClass = '';
      statusPillHtml = `<span class="att-status-pill pill-upcoming">${t('cards', 'upcoming')}</span>`;
      stateBadgeHtml = `<span class="att-state-badge state-locked">${t('cards', 'upcoming')}</span>`;
      let upcomingLabel = `${t('cards', 'opensAt')} ${pad(startHour)}:${pad(startMin)}`;
      if (dayDiff < 0) {
        const absDays = Math.abs(dayDiff);
        upcomingLabel = (absDays === 1) 
          ? `${t('cards', 'tomorrow')} · ${pad(startHour)}:${pad(startMin)}` 
          : `${t('cards', 'inDays', { d: absDays })} · ${pad(startHour)}:${pad(startMin)}`;
      }
      windowSubHtml = `<span class="att-window-sub">${upcomingLabel}</span>`;
      actionBtnHtml = `<a href="${escapeHtml(takeUrl)}" target="_blank" class="btn-att-action btn-att-wireframe" title="Open attendance in SPeCTRUM">${t('cards', 'openSpectrum')}</a>`;
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
      dateKey: targetDateKey,
      startHour,
      startMin,
      endHour,
      endMin
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
                <span class="att-window-label">${t('cards', 'checkInWindow')}</span>
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

  function renderScopedAttendanceCard(data, fallbackDate, fallbackDateKey) {
    const att = data.att || data;
    const sessionData = {
      ...data,
      date: data.date || fallbackDate || data.session?.date,
      dateKey: data.dateKey || fallbackDateKey || data.session?.dateKey
    };
    const vm = computeAttendanceCardViewModel(att, sessionData);
    return renderUnifiedAttendanceCardHtml(vm);
  }

    // Extract start time in minutes from midnight (0..1439) for precise chronological ascending sorting
  function getEventStartTimeMinutes(ev) {
    if (!ev) return 720;

    const dataObj = ev.data || ev;
    const attObj = dataObj.att || dataObj.obj || (dataObj.type === 'attendance' || dataObj.type === 'att' ? dataObj : null);
    const sessObj = dataObj.session || dataObj.sessObj || (ev.sessObj || ev.session) || null;

    if (attObj && typeof computeAttendanceCardViewModel === 'function') {
      try {
        const vm = computeAttendanceCardViewModel(attObj, {
          session: sessObj,
          timeStr: dataObj.timeStr || ev.timeStr || sessObj?.time || sessObj?.dateStr,
          dateKey: dataObj.dateKey || ev.dateKey || (dataObj.date ? formatDateKey(dataObj.date) : undefined),
          date: dataObj.date || ev.date || sessObj?.date
        });
        if (vm && typeof vm.startHour === 'number' && !isNaN(vm.startHour)) {
          return vm.startHour * 60 + (vm.startMin || 0);
        }
      } catch (e) {}
    }

    const timeCandidates = [
      dataObj.timeStr,
      ev.timeStr,
      sessObj?.time,
      sessObj?.dateStr,
      sessObj?.desc,
      dataObj.time,
      ev.time,
      dataObj.title,
      ev.title
    ];

    for (const cand of timeCandidates) {
      if (cand && typeof cand === 'string') {
        const parsed = (typeof parseTimeRangeRobust === 'function') ? parseTimeRangeRobust(cand) : null;
        if (parsed && typeof parsed.startHour === 'number' && !isNaN(parsed.startHour)) {
          return parsed.startHour * 60 + (parsed.startMin || 0);
        }
      }
    }

    const d = dataObj.date || ev.date || sessObj?.date;
    if (d instanceof Date && !isNaN(d.getTime())) {
      const h = d.getHours();
      const m = d.getMinutes();
      if (h !== 0 || m !== 0) {
        return h * 60 + m;
      }
    }

    return 720;
  }

  // ========================================================================
  // TIMELINE SPINE ACTIVE DOT FOCAL CONTROLLER
  // - Lights up date dots when cards cross the focal line
  // - Defaults to 50% (middle of the screen/container)
  // - User-tunable via toolbar slider, preferences slider, and presets
  // ========================================================================
  let spineFocalRatio = 0.50; // Default: 50% (middle of screen)

  try {
    const savedFocal = localStorage.getItem('spectrum_spine_focal_ratio');
    if (savedFocal !== null) {
      const parsed = parseFloat(savedFocal);
      if (!isNaN(parsed) && parsed >= 0.15 && parsed <= 0.85) {
        spineFocalRatio = parsed;
      }
    }
  } catch (e) {}

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['spineFocalRatio'], (res) => {
      if (res && res.spineFocalRatio !== undefined) {
        const parsed = parseFloat(res.spineFocalRatio);
        if (!isNaN(parsed) && parsed >= 0.15 && parsed <= 0.85) {
          spineFocalRatio = parsed;
          syncSpineFocalUI();
          updateActiveSpineNode();
        }
      }
    });
  }

  function setSpineFocalRatio(ratio, showGuideline = false) {
    const r = Math.max(0.15, Math.min(0.85, ratio));
    spineFocalRatio = r;
    try {
      localStorage.setItem('spectrum_spine_focal_ratio', String(r));
    } catch (e) {}
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ spineFocalRatio: r });
    }
    syncSpineFocalUI();
    updateActiveSpineNode();

    if (showGuideline) {
      renderSpineFocalGuideline();
    }
  }

  let guidelineTimeout = null;
  function renderSpineFocalGuideline() {
    const fulllistWrap = document.getElementById('fulllist-wrapper');
    const isFullTabList = fulllistWrap && fulllistWrap.style.display !== 'none';
    const stream = isFullTabList ? (document.getElementById('fulllist-cards-feed') || fulllistWrap) : (document.getElementById('popup-cards-stream') || document.querySelector('.split-cards-stream'));
    if (!stream) return;

    let guideline = stream.querySelector('#spine-focal-guideline');
    if (!guideline) {
      guideline = document.createElement('div');
      guideline.id = 'spine-focal-guideline';
      guideline.className = 'spine-focal-guideline';
      guideline.innerHTML = `<span class="focal-guideline-badge">● Dot Trigger: ${Math.round(spineFocalRatio * 100)}%</span>`;
      stream.appendChild(guideline);
    }

    const targetY = stream.scrollTop + (stream.clientHeight * spineFocalRatio);
    guideline.style.top = `${targetY}px`;
    const badge = guideline.querySelector('.focal-guideline-badge');
    if (badge) {
      const pct = Math.round(spineFocalRatio * 100);
      badge.textContent = `● Dot Trigger: ${pct}% ${pct === 50 ? '(Middle)' : ''}`;
    }

    guideline.classList.add('is-visible');
    clearTimeout(guidelineTimeout);
    guidelineTimeout = setTimeout(() => {
      guideline.classList.remove('is-visible');
    }, 1400);
  }

  function syncSpineFocalUI() {
    const percent = Math.round(spineFocalRatio * 100);
    const labelText = `${percent}% ${percent === 50 ? '(Mid)' : (percent < 50 ? '(Upper)' : '(Lower)')}`;

    const toolSlider = document.getElementById('toolbar-spine-focal-slider');
    const toolVal = document.getElementById('toolbar-spine-focal-val');
    if (toolSlider) toolSlider.value = percent;
    if (toolVal) toolVal.textContent = labelText;

    const prefSlider = document.getElementById('pref-spine-focal-slider');
    const prefVal = document.getElementById('pref-spine-focal-label');
    const prefBadge = document.getElementById('pref-spine-focal-badge');
    if (prefSlider) prefSlider.value = percent;
    if (prefVal) prefVal.textContent = `${percent}% ${percent === 50 ? '(Middle of Screen)' : ''}`;
    if (prefBadge) prefBadge.textContent = `${percent}% ${percent === 50 ? 'MID' : ''}`;
  }

  function initSpineFocalControls() {
    syncSpineFocalUI();

    const toolSlider = document.getElementById('toolbar-spine-focal-slider');
    if (toolSlider && !toolSlider._hasFocalListener) {
      toolSlider._hasFocalListener = true;
      toolSlider.addEventListener('input', (e) => {
        setSpineFocalRatio(parseFloat(e.target.value) / 100, true);
      });
    }

    const prefSlider = document.getElementById('pref-spine-focal-slider');
    if (prefSlider && !prefSlider._hasFocalListener) {
      prefSlider._hasFocalListener = true;
      prefSlider.addEventListener('input', (e) => {
        setSpineFocalRatio(parseFloat(e.target.value) / 100, true);
      });
    }

    document.querySelectorAll('.btn-focal-preset').forEach(btn => {
      if (!btn._hasPresetListener) {
        btn._hasPresetListener = true;
        btn.addEventListener('click', () => {
          const val = parseFloat(btn.dataset.val);
          if (!isNaN(val)) setSpineFocalRatio(val / 100, true);
        });
      }
    });
  }

  function updateActiveSpineNode() {
    // Collect all visible date groups across feeds
    const groups = Array.from(document.querySelectorAll('.spine-date-group')).filter(g => g.offsetParent !== null);
    if (!groups.length) return;

    const fulllistWrap = document.getElementById('fulllist-wrapper');
    const isFullTabList = fulllistWrap && fulllistWrap.style.display !== 'none';
    const stream = isFullTabList ? (document.getElementById('fulllist-cards-feed') || fulllistWrap) : (document.getElementById('popup-cards-stream') || document.querySelector('.split-cards-stream'));
    const streamRect = stream ? stream.getBoundingClientRect() : { top: 0, height: window.innerHeight };

    // Focal line: uses spineFocalRatio (default 0.40 = balanced focal zone)
    const ratio = (typeof spineFocalRatio === 'number' && !isNaN(spineFocalRatio)) ? spineFocalRatio : 0.40;
    const focalLine = streamRect.top + (streamRect.height * ratio);

    const todayGroup = groups.find(g => g.classList.contains('group-today'));

    let activeGroup = null;

    // Priority 1: Scrolled to top
    if (stream && stream.scrollTop <= 15) {
      if (todayGroup && stream._isScrollingToToday) {
        // While programmatically scrolling/settling to Today, preserve Today as active
        activeGroup = todayGroup;
      } else {
        if (todayGroup) {
          const tRect = todayGroup.getBoundingClientRect();
          // If today is within upper viewport area, start with Today as default active
          if (tRect.top >= streamRect.top - 20 && tRect.top <= streamRect.top + (streamRect.height * 0.65)) {
            activeGroup = todayGroup;
          }
        }
        if (!activeGroup) activeGroup = groups[0];
      }
    }
    // Priority 2: Scrolled to bottom
    else if (stream && (stream.scrollTop + stream.clientHeight >= stream.scrollHeight - 25)) {
      activeGroup = groups[groups.length - 1];
    }
    // Priority 3: Determine which date group / card is occupying the focal line
    else {
      // First check if todayGroup is in the focal vicinity (±45px)
      if (todayGroup) {
        const tRect = todayGroup.getBoundingClientRect();
        if (tRect.top - 45 <= focalLine && tRect.bottom + 45 >= focalLine) {
          activeGroup = todayGroup;
        }
      }

      if (!activeGroup) {
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          const gr = g.getBoundingClientRect();
          const isEmpty = !g.querySelector('.spine-date-cards') || g.querySelectorAll('.spectrum-card').length === 0;
          const topBound = isEmpty ? (gr.top - 35) : gr.top;
          const bottomBound = isEmpty ? (gr.bottom + 35) : gr.bottom;

          // If the group (header + cards, or empty node reach) spans across the focal line
          if (topBound <= focalLine && bottomBound >= focalLine) {
            activeGroup = g;
            break;
          }

          // If group is before focalLine, keep as candidate
          if (gr.top <= focalLine) {
            activeGroup = g;
          } else {
            // This group starts below the focalLine
            break;
          }
        }
      }
    }

    if (!activeGroup && groups.length > 0) {
      activeGroup = todayGroup || groups[0];
    }

    groups.forEach(g => {
      const isActive = (g === activeGroup);
      g.classList.toggle('is-active', isActive);
      const dot = g.querySelector('.spine-node-dot');
      if (dot) dot.classList.toggle('is-active', isActive);
    });
  }

  function scrollSpineToToday(container, immediate = true) {
    if (!container) return;

    // Helper to dynamically find the today group or closest date node
    function findTodayNode() {
      if (!container || !container.isConnected) return null;
      let tg = container.querySelector('.spine-date-group.group-today');
      if (tg && tg.isConnected) return tg;

      const allGroups = Array.from(container.querySelectorAll('.spine-date-group'));
      if (!allGroups.length) return null;

      const todayMs = new Date().setHours(0, 0, 0, 0);
      let closest = allGroups[0];
      let minDiff = Infinity;
      allGroups.forEach(g => {
        const k = g.dataset.dateKey;
        if (k) {
          const dMs = new Date(k + 'T12:00:00').getTime();
          if (!isNaN(dMs)) {
            const diff = Math.abs(dMs - todayMs);
            if (diff < minDiff) {
              minDiff = diff;
              closest = g;
            }
          }
        }
      });
      return closest;
    }

    // Set scroll lock flag to prevent premature activeGroup stealing before layout settles
    container._isScrollingToToday = true;
    if (container._todayScrollTimer) clearTimeout(container._todayScrollTimer);
    container._todayScrollTimer = setTimeout(() => {
      container._isScrollingToToday = false;
    }, 700);

    // Bind manual user scroll listener to instantly cancel programmatic scroll flag
    if (!container._hasUserManualScrollDetector) {
      container._hasUserManualScrollDetector = true;
      const cancelProgrammatic = () => { container._isScrollingToToday = false; };
      container.addEventListener('wheel', cancelProgrammatic, { passive: true });
      container.addEventListener('touchmove', cancelProgrammatic, { passive: true });
    }

    // Immediately grant active focal dot to TODAY so it starts solid black without waiting
    const initialTarget = findTodayNode();
    if (initialTarget) {
      const allGroups = container.querySelectorAll('.spine-date-group');
      allGroups.forEach(g => {
        const isTarget = (g === initialTarget);
        g.classList.toggle('is-active', isTarget);
        const dot = g.querySelector('.spine-node-dot');
        if (dot) dot.classList.toggle('is-active', isTarget);
      });
    }

    const doScroll = () => {
      const target = findTodayNode();
      if (!target) return;

      const cRect = container.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const viewH = container.clientHeight || cRect.height || 400;

      // 1. Static offset calculation (independent of transient paint or scroll states)
      let staticOffset = 0;
      let el = target;
      while (el && el !== container && el !== document.body) {
        staticOffset += el.offsetTop;
        el = el.offsetParent;
      }

      // 2. Dynamic offset from bounding client rects (when rendered and painted)
      const dynamicOffset = (tRect.top - cRect.top) + container.scrollTop;
      const useDynamic = (tRect.height > 0 && cRect.height > 0 && dynamicOffset > 0 && Math.abs(dynamicOffset - staticOffset) < 300);
      const chosenOffset = useDynamic ? dynamicOffset : staticOffset;

      const focalRatio = (typeof spineFocalRatio === 'number' && !isNaN(spineFocalRatio)) ? spineFocalRatio : 0.40;
      const targetScroll = Math.max(0, Math.round(chosenOffset - (viewH * focalRatio)));

      // 3. Scroll container directly
      const prevBehavior = container.style.scrollBehavior;
      container.style.scrollBehavior = immediate ? 'auto' : 'smooth';
      container.scrollTop = targetScroll;
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: targetScroll, behavior: immediate ? 'auto' : 'smooth' });
      }

      // 4. Native fallback if direct scroll did not move but target is far from top
      if (typeof target.scrollIntoView === 'function' && container.scrollTop === 0 && targetScroll > 40) {
        try {
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: immediate ? 'auto' : 'smooth' });
        } catch (e) {}
      }

      // 5. Restore scroll behavior and update active dot
      requestAnimationFrame(() => {
        container.style.scrollBehavior = prevBehavior || 'smooth';
        updateActiveSpineNode();
      });
    };

    // Staggered attempts to guarantee layout settling across font/image expansions
    [0, 25, 75, 180, 350, 600].forEach(delay => {
      setTimeout(doScroll, delay);
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
    let occClean = cInfo.userOcc ? cleanOccNumber(cInfo.userOcc) : '';
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
            date: new Date(),
            dateKey: todayKey,
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
            const dKey = sess.dateKey || formatDateKey(d);

            allEvents.push({
              type: 'attendance',
              date: d,
              dateKey: dKey,
              data: {
                att,
                date: d,
                dateKey: dKey,
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
          const dKey = nextSess.dateKey || formatDateKey(d);

          allEvents.push({
            type: 'attendance',
            date: d,
            dateKey: dKey,
            data: {
              att,
              date: d,
              dateKey: dKey,
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

    // Always guarantee TODAY node is present in the chronological spine
    // If today has activities: render them as usual; if no activity: render node with no cards
    if (!groupsMap.has(todayKey)) {
      groupsMap.set(todayKey, {
        dateKey: todayKey,
        date: new Date(),
        events: []
      });
    }

    // Unified chronological spine sort:
    // Guarantees continuous monotonic ordering across all months (Oct -> Nov -> Dec -> Jan)
    // Respects currentSortOrder ('oldest' = chronological ascending, 'newest' = reverse chronological descending)
    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      const keyA = a.dateKey || (a.date ? formatDateKey(a.date) : '');
      const keyB = b.dateKey || (b.date ? formatDateKey(b.date) : '');
      const comp = keyA.localeCompare(keyB);
      if (comp !== 0) {
        return (currentSortOrder === 'newest') ? -comp : comp;
      }
      const aTime = (a.date instanceof Date && !isNaN(a.date.getTime())) ? a.date.getTime() : 0;
      const bTime = (b.date instanceof Date && !isNaN(b.date.getTime())) ? b.date.getTime() : 0;
      return (currentSortOrder === 'newest') ? (bTime - aTime) : (aTime - bTime);
    });

    let spineHtml = '<div class="chronological-spine-timeline">';

    groups.forEach(group => {
      const isToday = (group.dateKey === todayKey);
      const isFuture = (group.date.getTime() >= nowTime);
      const d = group.date;
      const day = String(d.getDate()).padStart(2, '0');
      let titleHtml = '';
      const todayWord = t('cards', 'today');
      if (currentLang === 'zh') {
        const mon = String(d.getMonth() + 1);
        titleHtml = isToday 
          ? `${todayWord} <span class="spine-node-date">${mon}月${day}日</span>` 
          : `${mon}月${day}日`;
      } else if (currentLang === 'bm') {
        const mon = d.toLocaleDateString('ms-MY', { month: 'short' }).toUpperCase();
        const wd = d.toLocaleDateString('ms-MY', { weekday: 'short' }).toUpperCase();
        titleHtml = isToday 
          ? `${todayWord} <span class="spine-node-date">${day} ${mon}</span>` 
          : `${day} ${mon} ${wd}`;
      } else {
        const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        titleHtml = isToday 
          ? `${todayWord} <span class="spine-node-date">${day} ${mon}</span>` 
          : `${day} ${mon} ${wd}`;
      }
      const dotClass = isToday ? 'spine-node-dot is-today is-active' : 'spine-node-dot';
      const badgeText = isToday 
        ? `${group.events.length} Event${group.events.length !== 1 ? 's' : ''}` 
        : (isFuture 
            ? (group.events.some(e => e.type === 'assignment') ? 'Deadline' : 'Upcoming') 
            : 'Milestone');

      // Sort cards within group: assignments first, then attendance (ascending by start time), then notices
      const sortedEvents = group.events.sort((a, b) => {
        const order = { assignment: 1, attendance: 2, notice: 3 };
        const diff = (order[a.type] || 9) - (order[b.type] || 9);
        if (diff !== 0) return diff;
        if (a.type === 'attendance') {
          const timeA = getEventStartTimeMinutes(a);
          const timeB = getEventStartTimeMinutes(b);
          if (timeA !== timeB) return timeA - timeB; // Ascending order!
        }
        return (a.courseCode || '').localeCompare(b.courseCode || '');
      });

      const cardsHtml = sortedEvents.map(ev => {
        if (ev.type === 'assignment') return renderScopedAssignmentCard(ev.data);
        if (ev.type === 'attendance') {
          return renderScopedAttendanceCard(ev.data, ev.date || group.date, ev.dateKey || group.dateKey);
        }
        if (ev.type === 'notice') return renderScopedNoticeCard(ev.data);
        return '';
      }).join('');

      spineHtml += `
        <div class="spine-date-group ${isToday ? 'group-today is-active' : ''}" data-date-key="${escapeHtml(group.dateKey)}">
          <div class="spine-node-header">
            <span class="${dotClass}"></span>
            <div class="spine-node-title">${titleHtml}</div>
          </div>
          ${cardsHtml ? `
            <div class="spine-date-cards">
              ${cardsHtml}
            </div>
          ` : ''}
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

    initSpineFocalControls();
    // Default scroll position: centered at TODAY (future dates above, past dates below)
    scrollSpineToToday(stream, true);
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
        const clean = cleanOccNumber(c.userOcc);
        if (clean) occText = ` (OCC ${clean})`;
      }
      const titleText = `${c.courseCode}: ${c.courseName}${occText}`;

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
        const stream = document.getElementById('popup-cards-stream');
        if (stream) scrollSpineToToday(stream, true);
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

      const todayKey = formatDateKey(new Date());
      const isTargetToday = (targetDateKey === todayKey);

      let dAssigns = showTasks && (typeof assignmentsData !== 'undefined') ? assignmentsData.filter(a => {
        const rawD = (typeof resolveAssignmentDate === 'function') ? resolveAssignmentDate(a, new Date()) : a.dueDate;
        const d = (rawD instanceof Date) ? rawD : (rawD ? new Date(rawD) : null);
        const isValidDate = d && !isNaN(d.getTime());
        if (isValidDate) {
          return formatDateKey(d) === targetDateKey;
        }
        const isPending = !a.isSubmitted && !a.isOverdue;
        return isPending && isTargetToday;
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
            <div class="mcp-title" style="margin-bottom:0;">All Course Feeds</div>
          `;
        } else {
          const c = courses.find(item => String(item.courseId) === String(cid) || item.courseCode === btn.dataset.courseCode);
          if (!c) return;

          const occText = c.userOcc ? formatOccTag(c.userOcc) : 'All Cohorts';

          popover.innerHTML = `
            <div class="mcp-header">
              <span class="mcp-code">${escapeHtml(c.courseCode)}</span>
              <span class="mcp-occ">${escapeHtml(occText)}</span>
            </div>
            <div class="mcp-title" style="margin-bottom:0;">${escapeHtml(c.courseName)}</div>
          `;
        }

        const rect = btn.getBoundingClientRect();
        popover.style.left = (rect.right + 10) + 'px';
        const popHeight = 55;
        let topPos = rect.top - 6;
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
    if (popupSidebarMode === 'courses') {
      const stream = document.getElementById('popup-cards-stream');
      if (stream) scrollSpineToToday(stream, true);
    }
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
        const stream = document.getElementById('popup-cards-stream');
        if (stream) scrollSpineToToday(stream, true);
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

    const todayKey = formatDateKey(new Date());
    assignmentsData.forEach(assign => {
      if (activeCourse && !isActivityForCourse(assign, activeCourse)) return;
      if (activeCourse && typeof isAssignmentMatchingOcc === 'function' && !isAssignmentMatchingOcc(assign, activeCourse.userOcc)) return;
      const rawD = (typeof resolveAssignmentDate === 'function') ? resolveAssignmentDate(assign, new Date()) : assign.dueDate;
      const d = (rawD instanceof Date) ? rawD : (rawD ? new Date(rawD) : null);
      if (d && !isNaN(d.getTime())) {
        addEvent(formatDateKey(d), 'tutorial');
      } else if (!assign.isSubmitted && !assign.isOverdue) {
        // Open tasks with no deadline appear on Today
        addEvent(todayKey, 'tutorial');
      }
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

    const MONTH_NAMES_FULL_EN = [
      'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
      'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
    ];
    const MONTH_NAMES_FULL_BM = [
      'JANUARI', 'FEBRUARI', 'MAC', 'APRIL', 'MEI', 'JUN',
      'JULAI', 'OGOS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DISEMBER'
    ];
    const MONTH_NAMES_FULL_ZH = [
      '一月', '二月', '三月', '四月', '五月', '六月',
      '七月', '八月', '九月', '十月', '十一月', '十二月'
    ];
    const MONTH_NAMES_FULL = (currentLang === 'zh') ? MONTH_NAMES_FULL_ZH : ((currentLang === 'bm') ? MONTH_NAMES_FULL_BM : MONTH_NAMES_FULL_EN);
    const firstOfMonth = new Date(miniCalYear, miniCalMonth, 1);
    const lastOfMonth = new Date(miniCalYear, miniCalMonth + 1, 0);

    const startUm = getUmAcademicInfo(firstOfMonth);
    const endUm = getUmAcademicInfo(lastOfMonth);
    const startW = parseInt(startUm.weekNum, 10) || 1;
    const endW = parseInt(endUm.weekNum, 10) || startW;
    const weekSpan = startW === endW ? `W${String(startW).padStart(2, '0')}` : `W${String(startW).padStart(2, '0')}–W${String(endW).padStart(2, '0')}`;

    if (monthTitle) {
      monthTitle.textContent = (currentLang === 'zh')
        ? `${miniCalYear}年 ${MONTH_NAMES_FULL[miniCalMonth]} · ${weekSpan}`
        : `${MONTH_NAMES_FULL[miniCalMonth]} ${miniCalYear} · ${weekSpan}`;
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
    if (isToday) cellClass += ' is-today';
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

      // 2. Assignments due on this date (including open pending tasks with no deadline on Today)
      const todayKey = formatDateKey(new Date());
      const isTargetToday = (dateKey === todayKey);
      let allAssigns = showTasks ? assignmentsData.filter(a => {
        const rawD = (typeof resolveAssignmentDate === 'function') ? resolveAssignmentDate(a, new Date()) : a.dueDate;
        const d = (rawD instanceof Date) ? rawD : (rawD ? new Date(rawD) : null);
        const isValidDate = d && !isNaN(d.getTime());
        if (isValidDate) {
          return formatDateKey(d) === dateKey;
        }
        const isPending = !a.isSubmitted && !a.isOverdue;
        return isPending && isTargetToday;
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
      const todayKey = formatDateKey(new Date());
      const isTargetToday = (targetDateKey === todayKey);
      let dAssigns = (typeof assignmentsData !== 'undefined') ? assignmentsData.filter(a => {
        const rawD = (typeof resolveAssignmentDate === 'function') ? resolveAssignmentDate(a, new Date()) : a.dueDate;
        const d = (rawD instanceof Date) ? rawD : (rawD ? new Date(rawD) : null);
        const isValidDate = d && !isNaN(d.getTime());
        if (isValidDate) {
          return formatDateKey(d) === targetDateKey;
        }
        const isPending = !a.isSubmitted && !a.isOverdue;
        return isPending && isTargetToday;
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

    const monthHeading = document.getElementById('fulltab-month-heading');
    if (monthHeading && currentFullTabMode === 'list') {
      monthHeading.textContent = (fullListGroupingMode === 'course')
        ? 'BY COURSE · ACADEMIC FEED'
        : formatMonthYearHeading(fullListCurrentDate || new Date());
    }

    // Update popup sticky box
    const stickyBox = document.getElementById('popup-sticky-date-box');
    if (stickyBox) stickyBox.style.display = (currentActivitiesMode === 'timeline') ? 'flex' : 'none';

    renderAllActivities();
    if (currentActivitiesMode === 'timeline') initStickyDateObserver();

    if (currentActivitiesMode === 'bycourse' && !isFullTab) {
      setPopupSidebarMode('courses');
    }

    const fulllistWrap = document.getElementById('fulllist-wrapper');
    if (fulllistWrap && fulllistWrap.style.display !== 'none') {
      renderFullListMode();
      const scrollTarget = document.getElementById('fulllist-cards-feed') || fulllistWrap;
      if (scrollTarget) scrollSpineToToday(scrollTarget, true);
    } else {
      const stream = document.getElementById('popup-cards-stream');
      if (stream && popupSidebarMode === 'courses') {
        scrollSpineToToday(stream, true);
      }
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
      } else if (tabId === 'tab-timetable') {
        setFullTabMode('timetable');
        return;
      } else if (tabId === 'tab-activities') {
        setFullTabMode(currentFullTabMode && currentFullTabMode !== 'materials' && currentFullTabMode !== 'preferences' && currentFullTabMode !== 'timetable' ? currentFullTabMode : 'calendar');
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
      if (popupSidebarMode === 'courses') {
        syncPopupActivityStreams();
        const stream = document.getElementById('popup-cards-stream');
        if (stream) scrollSpineToToday(stream, true);
      }
    } else if (tabId === 'tab-timetable') {
      if (typeof renderTimetableMode === 'function') renderTimetableMode();
    } else if (tabId === 'tab-materials') {
      renderCourseTreeShells();
      const needsMaterialScan = coursesData.length === 0 || coursesData.some(c => !c.loaded && (!c.sections || c.sections.length === 0));
      if (needsMaterialScan) {
        const scanFn = (typeof scanCourses === 'function') ? scanCourses : (window.scanCourses || null);
        if (scanFn) scanFn(null, false);
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
          navigateTimelineMonth(-1);
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
          navigateTimelineMonth(1);
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
    hiddenAttendanceDetails: {},
    spineFocalRatio: 0.50,
    customSem1StartDate: ''
  };

  const stored = await chrome.storage.local.get(defaultSettings);
  if (stored.spineFocalRatio !== undefined) {
    setSpineFocalRatio(parseFloat(stored.spineFocalRatio), false);
  }
  initSpineFocalControls();
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
  customSem1StartDate = stored.customSem1StartDate || '';
  const prefSemStartInput = document.getElementById('pref-sem-start-input');
  const btnResetSemStart = document.getElementById('btn-reset-sem-start');
  if (prefSemStartInput) {
    prefSemStartInput.value = customSem1StartDate || '2026-10-05';
  }
  if (btnResetSemStart) {
    btnResetSemStart.addEventListener('click', async () => {
      customSem1StartDate = '';
      if (prefSemStartInput) prefSemStartInput.value = '2026-10-05';
      await chrome.storage.local.set({ customSem1StartDate: '' });
      updateDateHeroHeader(activeDateFilterObj || new Date());
      if (typeof renderCalendarView === 'function') {
        renderCalendarView(miniCalYear, miniCalMonth);
      }
      if (typeof updateFullTabHeader === 'function') updateFullTabHeader();
    });
  }

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
      hiddenAttendanceDetails: hiddenAttendanceDetails,
      spineFocalRatio: spineFocalRatio
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
    } catch (e) {}
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

  const hasAnyCached = cached.cachedCoursesData && cached.cachedCoursesData.length > 0;
  if (!activeSpectrumTab) {
    showLoginPrompt({ reason: 'not_open', showModal: true });
  } else if (activeSpectrumTab.url && activeSpectrumTab.url.includes('login.microsoftonline.com')) {
    showLoginPrompt({ reason: 'sso', detail: activeSpectrumTab.url, showModal: true });
  }

  if (statusIndicator) {
    const textEl = document.getElementById('status-indicator-text');
    if (textEl) {
      if (activeSpectrumTab && !activeSpectrumTab.url.includes('login.microsoftonline.com')) {
        textEl.textContent = 'Connected to UM SPeCTRUM';
      } else if (hasAnyCached) {
        textEl.textContent = 'SPeCTRUM Offline (Cached)';
      } else {
        textEl.textContent = 'SPeCTRUM Offline';
      }
    } else {
      if (activeSpectrumTab && !activeSpectrumTab.url.includes('login.microsoftonline.com')) {
        statusIndicator.className = 'status-indicator ready';
        statusIndicator.innerHTML = '<span class="dot"></span> <span id="status-text">Connected</span>';
      } else if (hasAnyCached) {
        statusIndicator.className = 'status-indicator';
        statusIndicator.innerHTML = '<span class="dot" style="background:#f59e0b;box-shadow:none;"></span> Cached (Offline)';
        statusIndicator.title = 'SPeCTRUM not connected. Click to open SPeCTRUM login.';
      } else {
        statusIndicator.className = 'status-indicator';
        statusIndicator.innerHTML = '<span class="dot" style="background:#ef4444;box-shadow:none;"></span> Log In Required';
        statusIndicator.title = 'Click to open SPeCTRUM login';
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

    // Auto-prompt OCC setup if any enrolled course has no configured OCC preference
    const hasUnconfiguredOcc = coursesData.some(c => !courseOccs || !courseOccs[c.id]);
    if (hasUnconfiguredOcc) {
      logDiag('Init', 'Unconfigured OCC detected for cached courses. Auto-prompting OCC setup modal...');
      setTimeout(() => {
        openOccSetupModal(true);
      }, 500);
    }

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
    // No cached courses (Fresh install / New user):
    // Switch to activities tab cleanly without auto-reloading or uninvited network sync
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
    coursesData.forEach(course => {
      course.expanded = false;
      if (Array.isArray(course.sections)) {
        course.sections.forEach(s => { s.expanded = false; });
      }
    });
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
    // 0. Sliding 2-Week Window Filter (front and after 14 days from today)
    // Filters out distant past and far future sessions from calendar & timeline to prevent information overload
    if (sess) {
      const isSessionLive = sess.isLive || sess.statusType === 'active';
      if (!isSessionLive) {
        const sessDate = (sess.date instanceof Date && !isNaN(sess.date.getTime()))
          ? sess.date
          : (sess.date ? new Date(sess.date) : (sess.dateKey ? new Date(sess.dateKey + 'T12:00:00') : null));
        if (sessDate && !isNaN(sessDate.getTime())) {
          const now = new Date();
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
          const minTime = startOfToday - FOURTEEN_DAYS_MS;
          const maxTime = startOfToday + FOURTEEN_DAYS_MS + (24 * 60 * 60 * 1000 - 1);
          const sessTime = sessDate.getTime();
          if (sessTime < minTime || sessTime > maxTime) {
            return false;
          }
        }
      }
    }

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
    const trimmed = cleanOccNumber(occ);
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
                <span class="occ-actions-label">${c.hasUserOcc ? `Current: OCC ${escapeHtml(cleanOccNumber(c.userOcc))}` : 'Select Group:'}</span>
                <div class="occ-pills-list">
                  ${c.detectedOccs.map(occ => {
                    const cleanO = cleanOccNumber(occ);
                    return `<button type="button" class="btn-occ-pill-select ${String(c.userOccNum) === String(cleanO) ? 'active' : ''}" data-course-id="${c.courseId}" data-occ="${cleanO}">OCC ${cleanO}</button>`;
                  }).join('')}
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
    if (popupSidebarMode === 'courses') {
      syncPopupActivityStreams();
    }
    const ttPane = document.getElementById('tab-timetable');
    if (ttPane && (ttPane.style.display !== 'none' || (typeof currentFullTabMode !== 'undefined' && currentFullTabMode === 'timetable'))) {
      if (typeof renderTimetableMode === 'function') renderTimetableMode();
    }
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
      // HIGH-PERFORMANCE TIMELINE HORIZONTAL SLIDE & MOMENTUM PHYSICS ENGINE
      // ========================================================================
      if (timelineScrollWrapper && !timelineScrollWrapper._wheelHijacked) {
        timelineScrollWrapper._wheelHijacked = true;

        timelineScrollWrapper.addEventListener('scroll', updateTimelineFloatingNavButtons, { passive: true });

        // Intelligent wheel handling: Card column vertical scroll vs Board horizontal slide
        timelineScrollWrapper.addEventListener('wheel', (evt) => {
          // 1. If mouse is over a day column's cards container and scrolling vertically:
          const colCards = evt.target.closest('.kanban-col-cards');
          if (colCards && Math.abs(evt.deltaY) > Math.abs(evt.deltaX)) {
            const isScrollingDown = evt.deltaY > 0;
            const canScrollDown = isScrollingDown && (colCards.scrollTop + colCards.clientHeight < colCards.scrollHeight - 2);
            const canScrollUp = !isScrollingDown && (colCards.scrollTop > 2);
            if (canScrollDown || canScrollUp) {
              return; // Allow vertical scrolling of cards inside this day column
            }
          }

          // 2. If trackpad or Shift+wheel is already producing horizontal delta, let browser handle natively
          if (Math.abs(evt.deltaX) > Math.abs(evt.deltaY) || evt.shiftKey) {
            cancelMomentum();
            updateTimelineFloatingNavButtons();
            return;
          }

          // 3. For standard vertical mouse wheel, smoothly slide the board horizontally
          if (evt.deltaY !== 0) {
            cancelMomentum();
            evt.preventDefault();
            timelineScrollWrapper.scrollLeft += evt.deltaY * 1.5;
            updateTimelineFloatingNavButtons();
          }
        }, { passive: false });

        // Frictionless mouse drag-to-scroll with tactile inertia
        let isMouseDown = false;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let scrollStart = 0;
        let lastX = 0;
        let lastTime = 0;
        let velocityX = 0;
        let momentumRafId = null;
        let draggedThresholdPassed = false;

        function cancelMomentum() {
          if (momentumRafId) {
            cancelAnimationFrame(momentumRafId);
            momentumRafId = null;
          }
        }

        timelineScrollWrapper.addEventListener('mousedown', (e) => {
          // Allow input / textarea / select to focus without interference
          if (e.target.closest('input, textarea, select')) return;
          if (e.button !== 0) return; // Primary left-click only

          cancelMomentum();
          isMouseDown = true;
          isDragging = false;
          draggedThresholdPassed = false;
          startX = e.pageX;
          startY = e.pageY;
          scrollStart = timelineScrollWrapper.scrollLeft;
          lastX = e.pageX;
          lastTime = performance.now();
          velocityX = 0;
        });

        window.addEventListener('mousemove', (e) => {
          if (!isMouseDown) return;

          const deltaX = e.pageX - startX;
          const deltaY = e.pageY - startY;

          if (!isDragging) {
            // Drag threshold of 5px allows clicking buttons/cards while making sliding effortless
            if (Math.abs(deltaX) > 5) {
              isDragging = true;
              draggedThresholdPassed = true;
              timelineScrollWrapper.classList.add('is-dragging');
              document.body.classList.add('timeline-dragging-active');
            }
          }

          if (isDragging) {
            e.preventDefault();
            // Tactile 1:1 direct tracking
            timelineScrollWrapper.scrollLeft = scrollStart - deltaX;

            const now = performance.now();
            const dt = now - lastTime;
            if (dt > 8) {
              const currentV = (lastX - e.pageX) / dt; // positive if dragging left (scrolling right)
              velocityX = velocityX * 0.35 + currentV * 0.65; // exponential smoothing
              lastX = e.pageX;
              lastTime = now;
            }
            updateTimelineFloatingNavButtons();
          }
        }, { passive: false });

        window.addEventListener('mouseup', () => {
          if (!isMouseDown) return;
          isMouseDown = false;

          if (isDragging) {
            isDragging = false;
            timelineScrollWrapper.classList.remove('is-dragging');
            document.body.classList.remove('timeline-dragging-active');

            // If mouse rested before release, cancel flick inertia
            const timeSinceLastMove = performance.now() - lastTime;
            if (timeSinceLastMove > 75) {
              velocityX = 0;
            }

            // High-fidelity momentum glide
            if (Math.abs(velocityX) > 0.08) {
              cancelMomentum();
              let currentV = velocityX * 16.6;
              const MAX_SPEED = 55;
              if (Math.abs(currentV) > MAX_SPEED) {
                currentV = Math.sign(currentV) * MAX_SPEED;
              }
              const FRICTION = 0.94; // Silky deceleration

              const stepGlide = () => {
                if (Math.abs(currentV) < 0.25) {
                  momentumRafId = null;
                  updateTimelineFloatingNavButtons();
                  return;
                }
                timelineScrollWrapper.scrollLeft += currentV;
                currentV *= FRICTION;
                updateTimelineFloatingNavButtons();
                momentumRafId = requestAnimationFrame(stepGlide);
              };
              momentumRafId = requestAnimationFrame(stepGlide);
            }
          }

          // If the user performed a drag, suppress the trailing click on card links/buttons
          if (draggedThresholdPassed) {
            const captureClick = (clickEvt) => {
              clickEvt.stopPropagation();
              clickEvt.preventDefault();
              window.removeEventListener('click', captureClick, true);
            };
            window.addEventListener('click', captureClick, true);
            setTimeout(() => {
              window.removeEventListener('click', captureClick, true);
            }, 80);
            draggedThresholdPassed = false;
          }
        });

        // Global keyboard navigation for Timeline Mode
        if (!window._timelineKeyNavBound) {
          window._timelineKeyNavBound = true;
          window.addEventListener('keydown', (e) => {
            if (currentFullTabMode !== 'timeline' && currentActivitiesMode !== 'timeline') return;
            if (e.target.closest('input, textarea, select')) return;

            if (e.key === 'ArrowRight') {
              e.preventDefault();
              cancelMomentum();
              timelineScrollWrapper.scrollBy({ left: 576, behavior: 'smooth' });
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              cancelMomentum();
              timelineScrollWrapper.scrollBy({ left: -576, behavior: 'smooth' });
            } else if (e.key === 'Home') {
              e.preventDefault();
              cancelMomentum();
              timelineScrollWrapper.scrollTo({ left: 0, behavior: 'smooth' });
            } else if (e.key === 'End') {
              e.preventDefault();
              cancelMomentum();
              timelineScrollWrapper.scrollTo({ left: timelineScrollWrapper.scrollWidth, behavior: 'smooth' });
            } else if (e.key === 't' || e.key === 'T') {
              if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                scrollToToday(false);
              }
            }
          });
        }
      }

      if (populatedDays.length === 0) {
        const noEvText = (currentLang === 'zh')
          ? '📅 该时段暂无活动或安排。'
          : ((currentLang === 'bm') ? '📅 Tiada aktiviti dijadualkan dalam tempoh ini.' : '📅 No events or activities scheduled in this period.');
        timelineTrack.innerHTML = `
          <div style="padding: 32px; color: var(--text-muted); font-size: 13px; text-align: center; width: 100%;">
            ${noEvText}
          </div>
        `;
      } else {
        const daysEn = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        const daysBm = ['AHD', 'ISN', 'SEL', 'RAB', 'KHA', 'JUM', 'SAB'];
        const daysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        timelineTrack.innerHTML = populatedDays.map(day => {
          const dayDate = day.date instanceof Date ? day.date : new Date(day.date);
          const dayNum = dayDate.getDate();
          const dIdx = dayDate.getDay();

          let dateHeaderStr = '';
          let todayPillStr = '';
          let countStr = '';

          if (currentLang === 'zh') {
            dateHeaderStr = `${dayNum}日 ${daysZh[dIdx]}`;
            todayPillStr = day.isToday ? '<span class="kanban-today-pill">今天</span>' : '';
            countStr = `${day.events.length} 项`;
          } else if (currentLang === 'bm') {
            dateHeaderStr = `${dayNum} ${daysBm[dIdx]}`;
            todayPillStr = day.isToday ? '<span class="kanban-today-pill">HARI INI</span>' : '';
            countStr = `${day.events.length} item`;
          } else {
            dateHeaderStr = `${dayNum} ${daysEn[dIdx]}`;
            todayPillStr = day.isToday ? '<span class="kanban-today-pill">TODAY</span>' : '';
            countStr = `${day.events.length} ${day.events.length === 1 ? 'item' : 'items'}`;
          }

          return `
            <div class="kanban-day-column ${day.isToday ? 'is-today' : ''}" data-date-key="${formatDateKey(day.date)}">
              <div class="kanban-col-header">
                <span class="kanban-col-date">
                  ${dateHeaderStr}
                  ${todayPillStr}
                </span>
                <span class="kanban-col-count">${countStr}</span>
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
          topMonthHeading.textContent = formatMonthYearHeading(dObj);
        } else {
          topMonthHeading.textContent = formatMonthYearHeading(new Date());
        }
      }

      renderOccBanners();
      scrollToToday(true);
      setTimeout(updateTimelineFloatingNavButtons, 120);
      setTimeout(updateTimelineFloatingNavButtons, 350);
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

  let timelineHeaderRaf = null;
  function updateTimelineHeaderFromScroll() {
    if (!timelineScrollWrapper || !timelineTrack) return;
    if (timelineHeaderRaf) return;

    timelineHeaderRaf = requestAnimationFrame(() => {
      timelineHeaderRaf = null;
      try {
        const topMonthHeading = document.getElementById('fulltab-month-heading');
        const weekPill = document.getElementById('fulltab-week-pill');
        if (!topMonthHeading && !weekPill) return;

        const tlSec = document.getElementById('fulltab-section-timeline');
        if (tlSec && tlSec.style.display === 'none') return;

        const cols = timelineTrack.querySelectorAll('.kanban-day-column');
        if (!cols.length) return;

        const scrollLeft = timelineScrollWrapper.scrollLeft;
        const clientWidth = timelineScrollWrapper.clientWidth;
        const viewLeft = scrollLeft;
        const viewRight = scrollLeft + clientWidth;

        let bestCol = null;
        let maxVisibleWidth = -1;

        for (const col of cols) {
          const colLeft = col.offsetLeft;
          const colRight = colLeft + col.offsetWidth;
          const vLeft = Math.max(viewLeft, colLeft);
          const vRight = Math.min(viewRight, colRight);
          const visibleWidth = Math.max(0, vRight - vLeft);

          if (visibleWidth > maxVisibleWidth) {
            maxVisibleWidth = visibleWidth;
            bestCol = col;
          }
        }

        if (!bestCol) bestCol = cols[0];
        const dateKey = bestCol.getAttribute('data-date-key');
        if (!dateKey) return;

        const parts = dateKey.split('-').map(Number);
        if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
          const activeDate = new Date(parts[0], parts[1] - 1, parts[2]);
          if (topMonthHeading) {
            const newMonthHeading = formatMonthYearHeading(activeDate);
            if (topMonthHeading.textContent !== newMonthHeading) {
              topMonthHeading.textContent = newMonthHeading;
            }
          }
          if (weekPill) {
            const academicInfo = getUmAcademicInfo(activeDate);
            if (academicInfo && academicInfo.weekPill && weekPill.textContent !== academicInfo.weekPill) {
              weekPill.textContent = academicInfo.weekPill;
            }
          }
        }
      } catch (err) {
        console.warn('[SPeCTRUM Pro] updateTimelineHeaderFromScroll error:', err);
      }
    });
  }

  function navigateTimelineMonth(direction) {
    if (!timelineScrollWrapper || !timelineTrack) return;
    const cols = Array.from(timelineTrack.querySelectorAll('.kanban-day-column'));
    if (!cols.length) return;

    const scrollLeft = timelineScrollWrapper.scrollLeft;
    const clientWidth = timelineScrollWrapper.clientWidth;
    const viewLeft = scrollLeft;
    const viewRight = scrollLeft + clientWidth;

    let currentCol = cols[0];
    let maxVisibleWidth = -1;
    for (const col of cols) {
      const colLeft = col.offsetLeft;
      const colRight = colLeft + col.offsetWidth;
      const vWidth = Math.max(0, Math.min(viewRight, colRight) - Math.max(viewLeft, colLeft));
      if (vWidth > maxVisibleWidth) {
        maxVisibleWidth = vWidth;
        currentCol = col;
      }
    }

    const curKey = currentCol.getAttribute('data-date-key') || '';
    const [curY, curM] = curKey.split('-').map(Number);
    const curYearMonth = (curY || 2026) * 12 + ((curM || 1) - 1);

    if (direction < 0) {
      // Find columns in a previous month
      const prevCols = cols.filter(col => {
        const key = col.getAttribute('data-date-key') || '';
        const [y, m] = key.split('-').map(Number);
        return (y * 12 + (m - 1)) < curYearMonth;
      });

      if (prevCols.length > 0) {
        const targetYearMonth = Math.max(...prevCols.map(col => {
          const [y, m] = (col.getAttribute('data-date-key') || '').split('-').map(Number);
          return y * 12 + (m - 1);
        }));
        const matched = prevCols.filter(col => {
          const [y, m] = (col.getAttribute('data-date-key') || '').split('-').map(Number);
          return (y * 12 + (m - 1)) === targetYearMonth;
        });
        const targetCol = matched[matched.length - 1] || prevCols[prevCols.length - 1];
        timelineScrollWrapper.scrollTo({ left: Math.max(0, targetCol.offsetLeft - 16), behavior: 'smooth' });
      } else {
        const step = Math.min(timelineScrollWrapper.clientWidth * 0.8, 576);
        timelineScrollWrapper.scrollBy({ left: -step, behavior: 'smooth' });
      }
    } else {
      // Find columns in a subsequent month
      const nextCols = cols.filter(col => {
        const key = col.getAttribute('data-date-key') || '';
        const [y, m] = key.split('-').map(Number);
        return (y * 12 + (m - 1)) > curYearMonth;
      });

      if (nextCols.length > 0) {
        const targetCol = nextCols[0];
        timelineScrollWrapper.scrollTo({ left: Math.max(0, targetCol.offsetLeft - 16), behavior: 'smooth' });
      } else {
        const step = Math.min(timelineScrollWrapper.clientWidth * 0.8, 576);
        timelineScrollWrapper.scrollBy({ left: step, behavior: 'smooth' });
      }
    }
  }

  function updateTimelineFloatingNavButtons() {
    if (!timelineScrollWrapper) return;
    const scrollLeft = timelineScrollWrapper.scrollLeft;
    const maxScroll = Math.max(0, timelineScrollWrapper.scrollWidth - timelineScrollWrapper.clientWidth);
    if (btnTimelineScrollLeft) {
      const atStart = scrollLeft <= 12;
      btnTimelineScrollLeft.classList.toggle('is-disabled', atStart);
    }
    if (btnTimelineScrollRight) {
      const atEnd = scrollLeft >= maxScroll - 12;
      btnTimelineScrollRight.classList.toggle('is-disabled', atEnd);
    }
    updateTimelineHeaderFromScroll();
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
      setTimeout(() => { doScroll(); updateTimelineFloatingNavButtons(); }, 250);
    });
  }

  if (btnTimelineScrollLeft && timelineScrollWrapper) {
    btnTimelineScrollLeft.addEventListener('click', () => {
      timelineScrollWrapper.scrollBy({ left: -576, behavior: 'smooth' });
    });
  }

  if (btnTimelineScrollRight && timelineScrollWrapper) {
    btnTimelineScrollRight.addEventListener('click', () => {
      timelineScrollWrapper.scrollBy({ left: 576, behavior: 'smooth' });
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
        if (ts.length > 0) return Math.min(...ts);
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

  function sortAttendanceItems(items, sortOrder = 'oldest') {
    return [...items].sort((a, b) => {
      // Active open session always first
      if (a.activeSession && !b.activeSession) return -1;
      if (!a.activeSession && b.activeSession) return 1;

      const timeA = getItemTimestamp(a, 'attendance');
      const timeB = getItemTimestamp(b, 'attendance');
      if (timeA > 0 && timeB > 0) {
        if (timeA !== timeB) return timeA - timeB; // Ascending order!
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
        // Sort sessions inside each attendance item in ascending chronological order
        group.items.forEach(att => {
          if (Array.isArray(att.sessions)) {
            att.sessions.sort((s1, s2) => {
              const t1 = s1.date ? new Date(s1.date).getTime() : (s1.dateKey ? new Date(s1.dateKey + 'T12:00:00').getTime() : 0);
              const t2 = s2.date ? new Date(s2.date).getTime() : (s2.dateKey ? new Date(s2.dateKey + 'T12:00:00').getTime() : 0);
              if (t1 !== t2) return t1 - t2;
              const min1 = getEventStartTimeMinutes(s1);
              const min2 = getEventStartTimeMinutes(s2);
              return min1 - min2;
            });
          }
        });

        // Sort items inside course: active first, then ascending order
        group.items = sortAttendanceItems(group.items, 'oldest');
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
        const userOcc = cleanOccNumber(group.userOcc);
        const hasOpen = group.items.some(a => a.activeSession != null);
        const hasMultipleOccs = group.detectedOccs && group.detectedOccs.length > 1;
        const detectedOccsFormatted = (group.detectedOccs || []).map(cleanOccNumber).filter(Boolean);

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
                    <span style="color:var(--warning);font-weight:600;">Multiple Available (${detectedOccsFormatted.join(', ')})</span>
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

      const sorted = sortAttendanceItems(filteredAtt, 'oldest');
      // Eliminate redundant phantom duplicates for the same course on the same target date
      const renderedCourseKeys = new Set();
      const deduplicated = sorted.filter(att => {
        const cid = String(att.courseId || 'general');
        const sess = att.activeSession || (Array.isArray(att.sessions) ? att.sessions.find(s => s.isToday || s.dateKey === formatDateKey(new Date())) : null) || att.nextSession;
        const dKey = sess?.dateKey || (sess?.date ? formatDateKey(sess.date) : formatDateKey(new Date()));
        const uniqueKey = `${cid}_${dKey}_${att.subType || ''}`;
        if (renderedCourseKeys.has(uniqueKey)) return false;
        renderedCourseKeys.add(uniqueKey);
        return true;
      });

      attendanceListEl.innerHTML = deduplicated.map(att => {
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
  function renderTimelineAttendanceCardHtml(ev, fallbackDateKey) {
    const att = ev.obj || {};
    const dKey = ev.dateKey || fallbackDateKey || ev.sessObj?.dateKey;
    const vm = computeAttendanceCardViewModel(att, {
      session: ev.sessObj,
      timeStr: ev.timeStr || ev.sessObj?.time || ev.sessObj?.dateStr,
      isLive: ev.status === 'active',
      isVerified: ev.status === 'present' || ev.status === 'submitted',
      dateKey: dKey,
      date: ev.date || ev.sessObj?.date,
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
        const presentBtn = e.target.closest('.btn-att-present');
        if (presentBtn) {
          const directUrl = presentBtn.getAttribute('href') || presentBtn.dataset.attUrl;
          if (directUrl && directUrl !== '#' && !directUrl.startsWith('javascript:')) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
              chrome.tabs.create({ url: directUrl });
            } else {
              window.open(directUrl, '_blank');
            }
            return;
          }
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

    const monthNamesEn = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthNamesBm = [
      'Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
      'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'
    ];
    const monthNamesZh = [
      '一月', '二月', '三月', '四月', '五月', '六月',
      '七月', '八月', '九月', '十月', '十一月', '十二月'
    ];
    const monthNames = (currentLang === 'zh') ? monthNamesZh : ((currentLang === 'bm') ? monthNamesBm : monthNamesEn);

    if (calMonthTitle) {
      calMonthTitle.textContent = (currentLang === 'zh')
        ? `${calCurrentYear}年 ${monthNames[calCurrentMonth]}`
        : `${monthNames[calCurrentMonth]} ${calCurrentYear}`;
    }
    const fulltabHeading = document.getElementById('fulltab-month-heading');
    if (fulltabHeading && currentFullTabMode === 'calendar') {
      fulltabHeading.textContent = (currentLang === 'zh')
        ? `${calCurrentYear}年 ${monthNames[calCurrentMonth]}`
        : `${monthNames[calCurrentMonth].toUpperCase()} ${calCurrentYear}`;
    }
    const calTargetDate = new Date(calCurrentYear, calCurrentMonth, 1);
    const calUmInfo = getUmAcademicInfo(calTargetDate);
    const fulltabSemBadge = document.getElementById('fulltab-sem-badge');
    const fulltabWeekPill = document.getElementById('fulltab-week-pill');
    if (fulltabSemBadge && currentFullTabMode === 'calendar') fulltabSemBadge.textContent = calUmInfo.semName;
    if (fulltabWeekPill && currentFullTabMode === 'calendar') fulltabWeekPill.textContent = calUmInfo.weekPill;

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
                sessObj: sess,
                dateKey: sess.dateKey,
                date: sess.date
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

    const labelNotice = currentLang === 'zh' ? '通知' : (currentLang === 'bm' ? 'Notis' : 'Notice');
    const labelAssign = currentLang === 'zh' ? '作业' : (currentLang === 'bm' ? 'Tugasan' : 'Assignment');
    const labelAtt = currentLang === 'zh' ? '签到' : (currentLang === 'bm' ? 'Kehadiran' : 'Attendance');

    let pillsHtml = '';
    if (annCount > 0) {
      pillsHtml += `
        <div class="cal-count-pill pill-notice">
          <span class="pill-left">${MINI_ICONS.notice} ${labelNotice}</span>
          <span class="pill-count">${annCount}</span>
        </div>
      `;
    }
    if (taskCount > 0) {
      pillsHtml += `
        <div class="cal-count-pill pill-assignment">
          <span class="pill-left">${MINI_ICONS.assignment} ${labelAssign}</span>
          <span class="pill-count">${taskCount}</span>
        </div>
      `;
    }
    if (attCount > 0) {
      pillsHtml += `
        <div class="cal-count-pill pill-attendance">
          <span class="pill-left">${MINI_ICONS.attendance} ${labelAtt}</span>
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
    let formattedDate = dateKey;
    if (!isNaN(parsedDate.getTime())) {
      if (currentLang === 'zh') {
        formattedDate = `${parsedDate.getFullYear()}年${parsedDate.getMonth() + 1}月${parsedDate.getDate()}日`;
      } else if (currentLang === 'bm') {
        formattedDate = parsedDate.toLocaleDateString('ms-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      } else {
        formattedDate = parsedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      }
    }
    if (!isNaN(parsedDate.getTime())) {
      const dayUmInfo = getUmAcademicInfo(parsedDate);
      const semBadgeEl = document.getElementById('fulltab-sem-badge');
      const weekPillEl = document.getElementById('fulltab-week-pill');
      if (semBadgeEl) semBadgeEl.textContent = dayUmInfo.semName;
      if (weekPillEl) weekPillEl.textContent = dayUmInfo.weekPill;
    }

    const countLabel = currentLang === 'zh'
      ? `${events.length} 项`
      : (currentLang === 'bm'
        ? `${events.length} item`
        : `${events.length} item${events.length === 1 ? '' : 's'}`);

    if (sidebar && sidebarTitle && sidebarList) {
      if (calSection) calSection.classList.add('has-sidebar');
      sidebar.style.display = 'flex';
      sidebarTitle.textContent = formattedDate;
      if (sidebarCount) sidebarCount.textContent = countLabel;

      if (events.length === 0) {
        sidebarList.innerHTML = `<div style="text-align:center;padding:24px 12px;color:var(--text-muted);font-size:12px;">${t('cards', 'noActToday')}</div>`;
      } else {
        sidebarList.innerHTML = events.map(ev => {
          if (ev.type === 'task' || ev.type === 'assignment') return renderAssignmentCardHtml(ev.obj || ev);
          if (ev.type === 'att' || ev.type === 'attendance') return renderTimelineAttendanceCardHtml(ev, dateKey);
          return renderAnnouncementCardHtml(ev.obj || ev);
        }).join('');
        attachAttendanceActions(sidebarList);
      }
    }

    // 2. Compatibility with existing calDayAgenda drawer
    if (calDayAgenda && calAgendaDate && calAgendaList) {
      calAgendaDate.textContent = formattedDate;
      if (calAgendaCount) calAgendaCount.textContent = countLabel;
      if (events.length === 0) {
        calAgendaList.innerHTML = `<div style="text-align:center;padding:18px;color:var(--text-muted);font-size:11.5px;">${t('cards', 'noActToday')}</div>`;
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
      // Full-Tab List Mode: Focused By Course (Exact Popup By-Course Architecture)
      // ----------------------------------------------------
      if (sideDatePane) sideDatePane.style.display = 'none';
      if (sideCoursePane) sideCoursePane.style.display = 'flex';

      const courses = getPopupCoursesList();
      let cInfo = courses.find(c => 
        (selectedCourseFilterId && String(c.courseId) === String(selectedCourseFilterId)) ||
        (selectedCourseFilterCode && c.courseCode === selectedCourseFilterCode)
      );

      // Default to first course if none selected
      if (!cInfo && courses.length > 0) {
        cInfo = courses[0];
        selectedCourseFilterId = cInfo.courseId;
        selectedCourseFilterCode = cInfo.courseCode;
      }

      // Compute activity counts for each course for navigator badges
      const courseCountsMap = new Map();
      let totalAllActivities = 0;

      courses.forEach(c => {
        const cAnns = announcementsData.filter(a => isActivityForCourse(a, c)).length;
        const cAssigns = assignmentsData.filter(a => isActivityForCourse(a, c) && ((typeof isAssignmentMatchingOcc === 'function') ? isAssignmentMatchingOcc(a, c.userOcc) : true)).length;
        const cAtt = attendancesData.filter(a => (typeof isAttendanceHidden !== 'function' || !isAttendanceHidden(a)) && isActivityForCourse(a, c)).length;
        const count = cAnns + cAssigns + cAtt;
        courseCountsMap.set(String(c.courseId), count);
        totalAllActivities += count;
      });

      // Update Side Course Pane (Course count & navigator jump items)
      const courseCountEl = document.getElementById('fulllist-course-count');
      const courseCountLabel = document.getElementById('fulllist-course-count-label') || document.querySelector('#fulllist-side-course-pane .sticky-date-month');
      const courseItemsEl = document.getElementById('fulllist-course-items-count');
      const courseJumpList = document.getElementById('fulllist-course-jump-list');
      if (courseCountEl) courseCountEl.textContent = courses.length;
      if (courseCountLabel) {
        courseCountLabel.textContent = currentLang === 'zh' ? '个课程' : (currentLang === 'bm' ? 'KURSUS' : 'COURSES');
      }
      if (courseItemsEl) {
        courseItemsEl.textContent = currentLang === 'zh'
          ? `${totalAllActivities} 个活动`
          : (currentLang === 'bm'
            ? `${totalAllActivities} Aktiviti`
            : `${totalAllActivities} Activities`);
      }
      if (summaryEl) summaryEl.textContent = '';

      if (courseJumpList) {
        courseJumpList.innerHTML = courses.map(c => {
          const isSel = (cInfo && (String(cInfo.courseId) === String(c.courseId) || cInfo.courseCode === c.courseCode));
          const monogram = (typeof generateCourseAcronym === 'function') ? generateCourseAcronym(c.courseName, c.courseCode) : (c.courseCode || 'CO').slice(0, 3).toUpperCase();
          const occClean = c.userOcc ? cleanOccNumber(c.userOcc) : '';
          const cCount = courseCountsMap.get(String(c.courseId)) || 0;
          return `
            <button type="button" class="fulllist-course-nav-item ${isSel ? 'active' : ''}" data-course-id="${escapeHtml(String(c.courseId))}" data-course-code="${escapeHtml(c.courseCode || '')}">
              <span class="course-nav-monogram">${escapeHtml(monogram)}</span>
              <div class="course-nav-text">
                <span class="course-nav-code">${escapeHtml(c.courseCode || 'Course')}</span>
                ${occClean ? `<span class="course-nav-occ">OCC ${escapeHtml(occClean)}</span>` : ''}
              </div>
              <span class="course-nav-badge">${cCount}</span>
            </button>
          `;
        }).join('');

        courseJumpList.querySelectorAll('.fulllist-course-nav-item').forEach(item => {
          item.addEventListener('click', () => {
            selectedCourseFilterId = item.dataset.courseId;
            selectedCourseFilterCode = item.dataset.courseCode;
            renderFullListMode();
            const scrollTarget = document.getElementById('fulllist-cards-feed') || document.getElementById('fulllist-wrapper');
            if (scrollTarget) scrollSpineToToday(scrollTarget, true);
          });
        });
      }

      if (!cInfo) {
        feedBody.innerHTML = `
          <div class="fulllist-empty-day-card">
            <div class="empty-day-icon">📚</div>
            <div class="empty-day-title">No courses available</div>
            <div class="empty-day-sub">Sync SPeCTRUM or enroll in courses to view activities here.</div>
          </div>
        `;
        return;
      }

      // Gather activities for selected course cInfo based on active activity toggles
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

      // 2. Attendance
      matchedAtt.forEach(att => {
        const typeInfo = getAttendanceTypeInfo(att, att.attTitle || '');
        let sessionsAdded = 0;

        if (att.activeSession) {
          allEvents.push({
            type: 'attendance',
            date: new Date(),
            dateKey: todayKey,
            data: {
              att,
              date: new Date(),
              dateKey: todayKey,
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

        if (Array.isArray(att.sessions) && att.sessions.length > 0) {
          att.sessions.forEach(sess => {
            if (sess.isToday && att.activeSession) return;
            const rawD = sess.date;
            const d = (rawD instanceof Date && !isNaN(rawD.getTime()))
              ? rawD
              : (rawD && !isNaN(new Date(rawD).getTime()) ? new Date(rawD) : (sess.dateKey ? new Date(sess.dateKey + 'T12:00:00') : null));

            if (d && !isNaN(d.getTime())) {
              const sessTypeInfo = getAttendanceTypeInfo(att, sess.desc || '');
              const sessTitle = cleanSessionDesc(sess.desc || att.attTitle || 'Class Session', sessTypeInfo.label);
              const onlyTime = extractOnlyTime(sess.dateStr || '') || (sess.time || 'Class Time');
              const dKey = sess.dateKey || formatDateKey(d);

              allEvents.push({
                type: 'attendance',
                date: d,
                dateKey: dKey,
                data: {
                  att,
                  date: d,
                  dateKey: dKey,
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
            const dKey = nextSess.dateKey || formatDateKey(d);

            allEvents.push({
              type: 'attendance',
              date: d,
              dateKey: dKey,
              data: {
                att,
                date: d,
                dateKey: dKey,
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

      // Focused Scope Bar Header
      let occClean = cInfo.userOcc ? cleanOccNumber(cInfo.userOcc) : '';
      const scopeBarHtml = `
        <div class="popup-focused-scope-bar" style="margin-bottom:16px;">
          <div class="scope-bar-top-row">
            <div class="scope-bar-breadcrumb">
              <span class="scope-crumb-label">COURSES /</span>
              <span class="scope-crumb-code">${escapeHtml(cInfo.courseCode)}</span>
              ${occClean ? `<span class="scope-crumb-sep">·</span><span class="scope-crumb-occ">OCC ${escapeHtml(occClean)}</span>` : ''}
            </div>
          </div>
          <div class="scope-bar-title-row">
            <div class="popup-focused-scope-name">${escapeHtml(cleanDisplayCourseName(cInfo.courseName, cInfo.courseCode))}</div>
          </div>
        </div>
      `;

      if (allEvents.length === 0) {
        feedBody.innerHTML = `
          ${scopeBarHtml}
          <div class="fulllist-empty-day-card">
            <div class="empty-day-icon">☕</div>
            <div class="empty-day-title">No activities matching this course</div>
            <div class="empty-day-sub">Check your filter settings on the left rail or sync SPeCTRUM.</div>
          </div>
        `;
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

      // Always guarantee TODAY node is present in the chronological spine
      // If today has activities: render them as usual; if no activity: render node with no cards
      if (!groupsMap.has(todayKey)) {
        groupsMap.set(todayKey, {
          dateKey: todayKey,
          date: new Date(),
          events: []
        });
      }

      // Unified chronological spine sort:
      // Guarantees continuous monotonic ordering across all months (Oct -> Nov -> Dec -> Jan)
      // Respects currentSortOrder ('oldest' = chronological ascending, 'newest' = reverse chronological descending)
      const groups = Array.from(groupsMap.values()).sort((a, b) => {
        const keyA = a.dateKey || (a.date ? formatDateKey(a.date) : '');
        const keyB = b.dateKey || (b.date ? formatDateKey(b.date) : '');
        const comp = keyA.localeCompare(keyB);
        if (comp !== 0) {
          return (currentSortOrder === 'newest') ? -comp : comp;
        }
        const aTime = (a.date instanceof Date && !isNaN(a.date.getTime())) ? a.date.getTime() : 0;
        const bTime = (b.date instanceof Date && !isNaN(b.date.getTime())) ? b.date.getTime() : 0;
        return (currentSortOrder === 'newest') ? (bTime - aTime) : (aTime - bTime);
      });

      let spineHtml = '<div class="chronological-spine-timeline">';

      groups.forEach(group => {
        const isToday = (group.dateKey === todayKey);
        const isFuture = (group.date.getTime() >= nowTime);
        const d = group.date;
        const day = String(d.getDate()).padStart(2, '0');
        let titleHtml = '';
        const todayWord = t('cards', 'today');
        if (currentLang === 'zh') {
          const mon = String(d.getMonth() + 1);
          titleHtml = isToday 
            ? `${todayWord} <span class="spine-node-date">${mon}月${day}日</span>` 
            : `${mon}月${day}日`;
        } else if (currentLang === 'bm') {
          const mon = d.toLocaleDateString('ms-MY', { month: 'short' }).toUpperCase();
          const wd = d.toLocaleDateString('ms-MY', { weekday: 'short' }).toUpperCase();
          titleHtml = isToday 
            ? `${todayWord} <span class="spine-node-date">${day} ${mon}</span>` 
            : `${day} ${mon} ${wd}`;
        } else {
          const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
          titleHtml = isToday 
            ? `${todayWord} <span class="spine-node-date">${day} ${mon}</span>` 
            : `${day} ${mon} ${wd}`;
        }
        const dotClass = isToday ? 'spine-node-dot is-today is-active' : 'spine-node-dot';

        // Sort cards within group: assignments (1), attendance (2, ascending by start time), notices (3)
        const sortedEvents = group.events.sort((a, b) => {
          const order = { assignment: 1, attendance: 2, notice: 3 };
          const diff = (order[a.type] || 9) - (order[b.type] || 9);
          if (diff !== 0) return diff;
          if (a.type === 'attendance') {
            const timeA = getEventStartTimeMinutes(a);
            const timeB = getEventStartTimeMinutes(b);
            if (timeA !== timeB) return timeA - timeB; // Ascending order!
          }
          return (a.courseCode || '').localeCompare(b.courseCode || '');
        });

        const cardsHtml = sortedEvents.map(ev => {
          if (ev.type === 'assignment') return renderScopedAssignmentCard(ev.data);
          if (ev.type === 'attendance') {
            return renderScopedAttendanceCard(ev.data, ev.date || group.date, ev.dateKey || group.dateKey);
          }
          if (ev.type === 'notice') return renderScopedNoticeCard(ev.data);
          return '';
        }).join('');

        spineHtml += `
          <div class="spine-date-group ${isToday ? 'group-today is-active' : ''}" data-date-key="${escapeHtml(group.dateKey)}">
            <div class="spine-node-header">
              <span class="${dotClass}"></span>
              <div class="spine-node-title">${titleHtml}</div>
            </div>
            ${cardsHtml ? `
              <div class="spine-date-cards">
                ${cardsHtml}
              </div>
            ` : ''}
          </div>
        `;
      });

      spineHtml += '</div>';
      feedBody.innerHTML = scopeBarHtml + spineHtml;

      attachAttendanceActions(feedBody);

      const fulllistFeed = document.getElementById('fulllist-cards-feed');
      const fulllistWrap = document.getElementById('fulllist-wrapper');
      const scrollTarget = fulllistFeed || fulllistWrap;
      if (scrollTarget && !scrollTarget._hasFullListScrollListener) {
        scrollTarget._hasFullListScrollListener = true;
        scrollTarget.addEventListener('scroll', updateActiveSpineNode, { passive: true });
        scrollTarget.addEventListener('wheel', () => requestAnimationFrame(updateActiveSpineNode), { passive: true });
        window.addEventListener('scroll', updateActiveSpineNode, { passive: true });
      }

      initSpineFocalControls();
      // Default scroll position: centered at TODAY (future dates above, past dates below)
      scrollSpineToToday(scrollTarget, true);

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
        monthHeading.textContent = formatMonthYearHeading(fullListCurrentDate);
      }

      // Collect activities for this specific date
      const dayEvents = getFullListActivitiesForDate(targetKey, showTasks, showAtt, showAnn);

      // Sort activities on this day chronologically in ascending order (earliest time first: e.g. 11:00, 12:00, 15:00, 16:00)
      dayEvents.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;

        const timeA = getEventStartTimeMinutes(a);
        const timeB = getEventStartTimeMinutes(b);
        if (timeA !== timeB) return timeA - timeB; // Ascending order!

        return (a.courseCode || '').localeCompare(b.courseCode || '');
      });

      // Active event dates for jump buttons
      const activeDateKeys = getFullListActiveDateKeys(showTasks, showAtt, showAnn);
      const prevActKey = [...activeDateKeys].reverse().find(k => k < targetKey);
      const nextActKey = activeDateKeys.find(k => k > targetKey);

      let fullDateFormatted = '';
      if (currentLang === 'zh') {
        fullDateFormatted = `${fullListCurrentDate.getFullYear()}年${fullListCurrentDate.getMonth() + 1}月${fullListCurrentDate.getDate()}日`;
      } else if (currentLang === 'bm') {
        fullDateFormatted = fullListCurrentDate.toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      } else {
        fullDateFormatted = fullListCurrentDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
      const countText = currentLang === 'zh'
        ? `${dayEvents.length} 个活动`
        : (currentLang === 'bm'
          ? `${dayEvents.length} Aktiviti`
          : `${dayEvents.length} Activit${dayEvents.length === 1 ? 'y' : 'ies'}`);

      if (summaryEl) summaryEl.textContent = '';

      let cardsHtml = '';
      if (dayEvents.length === 0) {
        cardsHtml = `
          <div class="fulllist-empty-day-card">
            <div class="empty-day-icon">☕</div>
            <div class="empty-day-title">No activities scheduled for this day</div>
            <div class="empty-day-sub">${escapeHtml(fullDateFormatted)} has no assignment deadlines, classes, or notices scheduled.</div>
            <div class="empty-day-actions">
              ${!isToday ? `<button type="button" class="empty-day-btn" id="empty-btn-today">📅 ${t('headers', 'returnToToday')}</button>` : ''}
              ${nextActKey ? `<button type="button" class="empty-day-btn primary" id="empty-btn-next-act">Jump to Next Activity (${escapeHtml(formatDateKeyToShort(nextActKey))}) →</button>` : ''}
            </div>
          </div>
        `;
      } else {
        cardsHtml = dayEvents.map(ev => {
          if (ev.type === 'task' || ev.type === 'assignment') return renderScopedAssignmentCard(ev.obj || ev);
          if (ev.type === 'att' || ev.type === 'attendance') {
            return renderScopedAttendanceCard({
              att: ev.obj || ev.att || ev,
              session: ev.sessObj || ev.session,
              isLive: ev.status === 'active',
              isVerified: ev.status === 'submitted',
              timeStr: ev.timeStr || ev.sessObj?.time || ev.sessObj?.dateStr,
              date: ev.date,
              dateKey: ev.dateKey
            });
          }
          return renderScopedNoticeCard(ev.obj || ev);
        }).join('');
      }

      const slideClass = direction >= 0 ? 'slide-next' : 'slide-prev';

      feedBody.innerHTML = `
        <div class="fulllist-day-header-bar">
          <div class="day-header-title-wrap">
            <span class="day-header-title">${escapeHtml(fullDateFormatted)}</span>
            ${isToday ? ('<span class="day-header-today-pill">' + t('cards', 'today') + '</span>') : ''}
            <span class="day-header-count-pill">${countText}</span>
          </div>
          <div class="day-header-actions">
            <button type="button" class="fulllist-header-nav-btn" id="fulllist-header-prev" title="Previous Day">‹ ${t('headers', 'prevDay')}</button>
            <button type="button" class="fulllist-header-nav-btn" id="fulllist-header-today" title="Jump to Today">${t('headers', 'today')}</button>
            <button type="button" class="fulllist-header-nav-btn" id="fulllist-header-next" title="Next Day">${t('headers', 'nextDay')} ›</button>
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
    if (feed) feed.scrollTop = 0;
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
    const feed = document.getElementById('fulllist-cards-feed');
    const wrapper = document.getElementById('fulllist-wrapper');
    const scrollTarget = feed || wrapper;
    if (!scrollTarget || scrollTarget._hasMoveHandlers) return;
    scrollTarget._hasMoveHandlers = true;
    scrollTarget.tabIndex = 0;

    let wheelDeltaAccumulator = 0;

    // Detect user moving down past the bottom of the day page to step to next day (Date mode only)
    scrollTarget.addEventListener('wheel', (e) => {
      if (wrapper && wrapper.style.display === 'none') return;
      if (fullListGroupingMode === 'course') return; // Do not step days when viewing by course
      const now = Date.now();
      if (now - fullListWheelCooldown < 450) return;

      const isAtBottom = (scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 15);
      const isAtTop = (scrollTarget.scrollTop <= 5);

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
    const handleKeyNav = (e) => {
      if (wrapper && wrapper.style.display === 'none') return;
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
    };

    scrollTarget.addEventListener('keydown', handleKeyNav);
    if (wrapper && wrapper !== scrollTarget) wrapper.addEventListener('keydown', handleKeyNav);
  }

  // ACADEMIC WEEKLY TIMETABLE MODE & EXPORT SYSTEM (Spec 5.0)
  // Modularized into ./modules/timetable.js (loaded via popup.html)

  function createCourseTreeShell(c) {
    const rawName = (c.name || '').replace(/[\r\n\t]+/g, ' ').replace(/^Course name\s*/i, '').trim();
    const codeMatch = rawName.match(/^[A-Z]{2,4}\d{4}/);
    const code = cleanSingleCourseCode(codeMatch ? codeMatch[0] : (c.code || `Course ${c.id}`));
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

  // ── SPeCTRUM Authentication & Login Management ──
  async function openSpectrumLogin() {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({});
        const existingTab = tabs.find(t => t.url && (
          t.url.includes('spectrum.um.edu.my') || 
          t.url.includes('login.microsoftonline.com')
        ));
        if (existingTab && existingTab.id) {
          await chrome.tabs.update(existingTab.id, { active: true });
          if (existingTab.windowId && chrome.windows) {
            try { await chrome.windows.update(existingTab.windowId, { focused: true }); } catch (wErr) {}
          }
          return existingTab;
        }
        if (chrome.tabs.create) {
          return await chrome.tabs.create({ url: 'https://spectrum.um.edu.my/login/index.php' });
        }
      }
      window.open('https://spectrum.um.edu.my/login/index.php', '_blank');
    } catch (err) {
      window.open('https://spectrum.um.edu.my/login/index.php', '_blank');
    }
  }
  window.openSpectrumLogin = openSpectrumLogin;

  function showLoginPrompt({ reason = 'expired', detail = '', showModal = true } = {}) {
    const isNotOpen = reason === 'not_open';
    const isSSO = reason === 'sso' || (detail && detail.includes('microsoftonline.com'));

    let title = 'SPeCTRUM Login Required';
    let desc = 'You are currently not logged in to Universiti Malaya SPeCTRUM. Please log in to your account, then click Sync.';

    if (isSSO) {
      title = 'SPeCTRUM Session Expired';
      desc = 'Your SPeCTRUM session has expired and redirected to Microsoft SSO login. Please log in with your UM student/staff account to continue.';
    } else if (isNotOpen) {
      title = 'SPeCTRUM Not Open';
      desc = 'Please open and log in to spectrum.um.edu.my in your browser to access live courses and sync your activities.';
    }

    // Direct Auth Prompt Modal (Banners removed for clean modern design)
    const authModal = document.getElementById('auth-prompt-modal');
    const authModalTitle = document.getElementById('auth-modal-title');
    const authModalDesc = document.getElementById('auth-modal-desc');
    if (authModal && showModal !== false) {
      if (authModalTitle) authModalTitle.textContent = title;
      if (authModalDesc) authModalDesc.textContent = desc;
      authModal.style.display = 'flex';
    }

    // Status Indicator
    if (statusIndicator) {
      statusIndicator.className = 'status-indicator';
      statusIndicator.innerHTML = '<span class="dot" style="background:#ef4444;box-shadow:none;"></span> Log In Required';
      statusIndicator.title = 'Click to open SPeCTRUM login';
    }
  }
  window.showLoginPrompt = showLoginPrompt;

  function hideLoginPrompt() {
    const authModal = document.getElementById('auth-prompt-modal');
    if (authModal) authModal.style.display = 'none';
  }
  window.hideLoginPrompt = hideLoginPrompt;

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
  let syncProgressCurrent = 0;
  let syncProgressTarget = 0;
  let syncProgressTicker = null;
  let syncProgressLatestText = { current: '', count: '', title: '' };

  function renderSyncProgressElements(percentVal, currentText, countText, titleText) {
    const clamped = Math.min(100, Math.max(0, Math.round(percentVal)));
    const preciseWidth = Math.min(100, Math.max(0, percentVal)).toFixed(1);

    // Update Sync button horizontal progress bar & percentage label
    updateSyncButtonProgress(clamped, true);

    // 1. Update Centered Cinematic Glassmorphism HUD Overlay (Option 3)
    const isDismissed = isSyncOverlayDismissed || (typeof window !== 'undefined' && window.isSyncOverlayDismissed);
    const overlay = document.getElementById('sync-cinematic-overlay');
    if (overlay && !isDismissed) {
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
      if (hudBarFill) hudBarFill.style.width = `${preciseWidth}%`;
      if (hudTitle && titleText) hudTitle.textContent = titleText;
      if (hudCurrent && currentText) hudCurrent.textContent = currentText;
      if (hudSub && countText) hudSub.textContent = countText;

      if (hudSvg) {
        hudSvg.classList.remove('stage-settled');
        hudSvg.classList.add('stage-fetching');
      }
    }

    // 2. Keep inline card IDs updated synchronously
    const cardIds = ['activities-progress-card'];
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
      if (fillEl) fillEl.style.width = `${preciseWidth}%`;
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

  function startSyncProgressTicker() {
    if (syncProgressTicker) return;
    syncProgressTicker = setInterval(() => {
      if (syncProgressTarget >= 100) {
        if (syncProgressCurrent < 100) {
          syncProgressCurrent = Math.min(100, syncProgressCurrent + Math.max(0.6, (100 - syncProgressCurrent) * 0.3));
          renderSyncProgressElements(
            syncProgressCurrent,
            syncProgressLatestText.current,
            syncProgressLatestText.count,
            syncProgressLatestText.title
          );
        }
        if (syncProgressCurrent >= 100) {
          stopSyncProgressTicker();
        }
        return;
      }

      if (syncProgressCurrent < syncProgressTarget) {
        // Fast, smooth catch-up to target in continuous small steps
        const diff = syncProgressTarget - syncProgressCurrent;
        const step = Math.max(0.18, diff * 0.12);
        syncProgressCurrent = Math.min(syncProgressTarget, syncProgressCurrent + step);
      } else if (syncProgressCurrent < 94) {
        // Active living micro-crawl so progress is NEVER static while waiting for network
        const softCeiling = Math.min(syncProgressTarget + 3.5, 94);
        if (syncProgressCurrent < softCeiling) {
          syncProgressCurrent += 0.06;
        }
      }

      renderSyncProgressElements(
        syncProgressCurrent,
        syncProgressLatestText.current,
        syncProgressLatestText.count,
        syncProgressLatestText.title
      );
    }, 50);
  }

  function stopSyncProgressTicker() {
    if (syncProgressTicker) {
      clearInterval(syncProgressTicker);
      syncProgressTicker = null;
    }
  }

  function updateActivitiesFetchProgress(percent, currentText, countText, titleText) {
    if (activitiesProgressHideTimer) {
      clearTimeout(activitiesProgressHideTimer);
      activitiesProgressHideTimer = null;
    }

    syncProgressTarget = Math.min(100, Math.max(0, percent));
    if (currentText) syncProgressLatestText.current = currentText;
    if (countText) syncProgressLatestText.count = countText;
    if (titleText) syncProgressLatestText.title = titleText;

    if (!syncProgressTicker) {
      startSyncProgressTicker();
    }

    renderSyncProgressElements(
      syncProgressCurrent,
      syncProgressLatestText.current,
      syncProgressLatestText.count,
      syncProgressLatestText.title
    );
  }

  function hideActivitiesFetchProgress(delay = 1200) {
    stopSyncProgressTicker();
    syncProgressCurrent = 100;
    syncProgressTarget = 100;
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

    // Finish sync progress on button at 100%
    updateSyncButtonProgress(100, true);

    const overlay = document.getElementById('sync-cinematic-overlay');

    if (delay <= 0) {
      if (overlay) {
        overlay.classList.remove('active');
        overlay.style.opacity = '0';
        overlay.style.display = 'none';
      }
      const cardIds = ['activities-progress-card'];
      for (const cardId of cardIds) {
        const cardEl = document.getElementById(cardId);
        if (cardEl) {
          cardEl.style.display = 'none';
          cardEl.style.opacity = '0';
        }
      }
      updateSyncButtonProgress(0, false);
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
      const cardIds = ['activities-progress-card'];
      for (const cardId of cardIds) {
        const cardEl = document.getElementById(cardId);
        if (cardEl) {
          cardEl.style.opacity = '0';
          setTimeout(() => {
            if (cardEl.style.opacity === '0') cardEl.style.display = 'none';
          }, 300);
        }
      }
      updateSyncButtonProgress(0, false);
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
    isSyncOverlayDismissed = false;
    if (typeof window !== 'undefined') window.isSyncOverlayDismissed = false;
    syncProgressCurrent = 0;
    syncProgressTarget = 6;

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
          showLoginPrompt({ reason: 'sso', detail: pingRes ? pingRes.url : '', showModal: true });
          showNotLoggedInState();
          return;
        }
        setDiagBadge(diagBadgeSession, 'ok', 'Session: Connected');
        hideLoginPrompt();
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
        const specTab = await findSpectrumTab();
        showLoginPrompt({ reason: specTab ? 'expired' : 'not_open', detail: pingErr?.message, showModal: true });
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
          showLoginPrompt({ reason: 'login_required', showModal: true });
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
        25,
        `Courses queued (${totalCourses}). Scanning activities & attendance...`,
        `0 of ${totalCourses} courses`,
        'SYNCING ACTIVITIES & ATTENDANCE'
      );

      const hasCourse129 = coursesToScan.some(c => String(c.id) === '129');
      logDiag('Courses:Check', `Target Course 129 in scan list? ${hasCourse129 ? '✔ YES' : '❌ NO'}`);

      // Fetch in small batches of 2 courses to prevent SPeCTRUM concurrency drops & 429 errors
      const batchSize = 2;
      const totalSubSteps = Math.max(1, coursesToScan.length * 3);
      let completedSubSteps = 0;

      for (let i = 0; i < coursesToScan.length; i += batchSize) {
        const batch = coursesToScan.slice(i, i + batchSize);
        const batchNames = batch.map(c => c.code || c.name).join(', ');
        const doneCount = Math.min(i + batch.length, coursesToScan.length);
        const batchProgressStr = `${doneCount}/${coursesToScan.length}`;

        logDiag('Sync:Batch', `Scanning batch [${batchProgressStr}]: ${batchNames}...`);
        if (announcementsLoadingEl) announcementsLoadingEl.textContent = `Syncing notices: [${batchNames}] (${batchProgressStr})...`;
        if (assignmentsLoadingEl) assignmentsLoadingEl.textContent = `Syncing tasks: [${batchNames}] (${batchProgressStr})...`;
        if (attendanceLoadingEl) attendanceLoadingEl.textContent = `Syncing attendance: [${batchNames}] (${batchProgressStr})...`;

        await Promise.all(batch.map(async (course, batchIdx) => {
          const courseId = String(course.id);
          const courseLabel = course.code || course.name;
          const userOcc = courseOccs[courseId] || defaultOcc || '';
          const globalCourseNum = i + batchIdx + 1;

          // Track each individual sub-operation so progress makes continuous small steps!
          const annPromise = fetchCourseAnnouncements(courseId, course.code, course.name, minCutoffTimestamp)
            .then(res => {
              completedSubSteps++;
              const pct = 25 + Math.round((completedSubSteps / totalSubSteps) * 67);
              updateActivitiesFetchProgress(
                pct,
                `Scanning notices: [${courseLabel}]`,
                `Course ${globalCourseNum}/${coursesToScan.length} · Notices`
              );
              return res;
            });

          const assignPromise = fetchCourseAssignments(courseId, course.code, course.name, 0)
            .then(res => {
              completedSubSteps++;
              const pct = 25 + Math.round((completedSubSteps / totalSubSteps) * 67);
              updateActivitiesFetchProgress(
                pct,
                `Scanning tasks & deadlines: [${courseLabel}]`,
                `Course ${globalCourseNum}/${coursesToScan.length} · Tasks`
              );
              return res;
            });

          const attPromise = fetchCourseAttendance(courseId, course.code, course.name, userOcc, 0)
            .then(res => {
              completedSubSteps++;
              const pct = 25 + Math.round((completedSubSteps / totalSubSteps) * 67);
              updateActivitiesFetchProgress(
                pct,
                `Scanning attendance records: [${courseLabel}]`,
                `Course ${globalCourseNum}/${coursesToScan.length} · Attendance`
              );
              return res;
            });

          // Use Promise.allSettled so an error in attendance or announcements NEVER drops assignments!
          const results = await Promise.allSettled([annPromise, assignPromise, attPromise]);

          const [annRes, assignRes, attRes] = results;

          if (annRes.status === 'fulfilled' && annRes.value && Array.isArray(annRes.value)) {
            allAnnouncements.push(...annRes.value);
          }
          if (assignRes.status === 'fulfilled' && assignRes.value && Array.isArray(assignRes.value)) {
            allAssignments.push(...assignRes.value);
          }
          if (attRes.status === 'fulfilled' && attRes.value) {
            const countBefore = allAttendances.length;
            if (Array.isArray(attRes.value)) allAttendances.push(...attRes.value);
            else allAttendances.push(attRes.value);
            const added = allAttendances.length - countBefore;
            logDiag('Attendance:SyncBatch', `[${courseId}] Enqueued ${added} attendance activity record(s).`);
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
        logDiag('Attendance:State', `Updated attendancesData with ${attendancesData.length} activity record(s) (${attendancesData.reduce((acc, a) => acc + (a.sessions?.length || 0), 0)} total session(s)).`);
      } else if (attendancesData.length === 0) {
        const cached = await chrome.storage.local.get(['cachedAttendances']);
        if (cached && Array.isArray(cached.cachedAttendances) && cached.cachedAttendances.length > 0) {
          attendancesData = sanitizeAttendances(cached.cachedAttendances);
          logDiag('Attendance:CacheFallback', `Preserved ${attendancesData.length} attendance record(s) from local cache (${attendancesData.reduce((acc, a) => acc + (a.sessions?.length || 0), 0)} total session(s)).`);
        }
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

      updateActivitiesFetchProgress(
        98,
        'Finalizing viewports & metrics...',
        'Almost done'
      );

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
      const isSyncing = isSyncingActivities || (typeof isScanningMaterials !== 'undefined' && isScanningMaterials) || (typeof window !== 'undefined' && window.isScanningMaterials);
      const isDismissed = isSyncOverlayDismissed || (typeof window !== 'undefined' && window.isSyncOverlayDismissed);
      if (isSyncing && isDismissed) {
        // Restore overlay on sync button click
        isSyncOverlayDismissed = false;
        if (typeof window !== 'undefined') window.isSyncOverlayDismissed = false;
        const overlay = document.getElementById('sync-cinematic-overlay');
        if (overlay) {
          overlay.style.display = 'flex';
          void overlay.offsetWidth;
          overlay.classList.add('active');
          overlay.style.opacity = '1';
        }
        return;
      }
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
      let takeEl = null;
      const allAnchors = Array.from(doc.querySelectorAll('a'));
      for (const a of allAnchors) {
        const href = a.getAttribute('href') || a.href || '';
        const text = (a.textContent || '').trim();
        const isTakeHref = /(?:attendance|take)\.php\?.*sessid=\d+/i.test(href) && !/view\.php/i.test(href);
        const hasTakeText = /submit attendance|hantar kehadiran|rekod kehadiran|take attendance/i.test(text);
        const hasTakeClass = a.classList.contains('takeattendance');

        if (isTakeHref && (hasTakeText || hasTakeClass)) {
          takeEl = a;
          break;
        }
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

      let rawTakeUrl = takeEl ? (takeEl.getAttribute('href') || takeEl.href || '').replace(/&amp;/g, '&') : '';
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
      logDiag('Attendance:FastScan', `Updated attendancesData with ${attendancesData.length} activities (${attendancesData.reduce((acc, a) => acc + (a.sessions?.length || 0), 0)} total sessions).`);
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
        const summary = stored.lastAttendanceCheckSummary;
        times.forEach(t => {
          if (lastCheck > 0) {
            let note = '';
            if (summary && summary.newlySubmitted > 0) {
              note = ` (${summary.newlySubmitted} auto-marked)`;
            }
            t.textContent = `· Checked ${formatTimeAgo(lastCheck)}${note}`;
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
  const btnAttLogs = document.getElementById('btn-att-logs');
  if (btnAttLogs && diagPanel) {
    btnAttLogs.addEventListener('click', async () => {
      diagPanel.style.display = 'block';
      if (diagBody) diagBody.style.display = 'block';
      diagPanel.classList.add('open');
      await refreshDiagLogsDisplay();
      diagPanel.scrollIntoView({ behavior: 'smooth' });
    });
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

  // Course Materials & Downloader Logic modularized to ./modules/materials.js
  if (typeof initMaterialsTab === "function") initMaterialsTab();

  // ========================================================
  // Preferences & Cache Clear Handlers
  // ========================================================
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


  // ZIP Downloader Execution modularized to ./modules/materials.js

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

  // Reactive Language UI Refresh Bridge (triggers live re-render without requiring browser refresh)
  function applyLanguageUiRefresh() {
    updateSidebarLabels();
    updateHeaderTranslations();
    updatePreferencesTranslations();
    updateMaterialsTranslations();
    updateTimetableTranslations();
    updateFullTabHeader();

    const isFull = document.body.classList.contains('is-full-tab');
    if (isFull) {
      if (typeof setFullTabMode === 'function') {
        setFullTabMode(currentFullTabMode);
      }
      if (currentFullTabMode === 'materials') {
        if (typeof renderCourseTreeShells === 'function') renderCourseTreeShells();
        else if (typeof window !== 'undefined' && typeof window.renderCourseTreeShells === 'function') window.renderCourseTreeShells();
      }
    } else {
      const activeBtn = document.querySelector('.primary-tab-btn.active');
      const tabId = activeBtn ? activeBtn.dataset.tab : (typeof currentTab !== 'undefined' ? currentTab : 'tab-activities');
      if (typeof switchTab === 'function') {
        switchTab(tabId);
      }
      if (tabId === 'tab-activities') {
        if (typeof currentActivitiesGrouping !== 'undefined' && currentActivitiesGrouping === 'course') {
          if (typeof renderByCourseScopedFeed === 'function') renderByCourseScopedFeed();
        } else {
          if (typeof renderAllActivities === 'function') renderAllActivities();
        }
        if (typeof renderMiniCalendar === 'function') renderMiniCalendar();
      } else if (tabId === 'tab-timetable') {
        if (typeof renderTimetableMode === 'function') renderTimetableMode();
      } else if (tabId === 'tab-materials') {
        if (typeof renderCourseTreeShells === 'function') renderCourseTreeShells();
      } else if (tabId === 'tab-filters') {
        if (typeof renderOccPreferencesTable === 'function') renderOccPreferencesTable();
        if (typeof renderHiddenAttendanceSettings === 'function') renderHiddenAttendanceSettings();
      }
    }
    if (typeof syncRailCounts === 'function') syncRailCounts();
  }
  window.onLanguageChange = applyLanguageUiRefresh;

  // Continue My Work & Sync Overlay Controls
  const btnSyncContinueWork = document.getElementById('btn-sync-continue-work');
  if (btnSyncContinueWork) {
    btnSyncContinueWork.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissSyncOverlay();
    });
  }

  const syncCinematicOverlay = document.getElementById('sync-cinematic-overlay');
  if (syncCinematicOverlay) {
    syncCinematicOverlay.addEventListener('click', (e) => {
      // Allow clicking backdrop to continue work without blocking
      if (e.target === syncCinematicOverlay) {
        dismissSyncOverlay();
      }
    });
  }

  // Auth Prompt Modal & Banner Listeners
  const btnCloseAuthModal = document.getElementById('btn-close-auth-modal');
  const btnAuthModalLogin = document.getElementById('btn-auth-modal-login');
  const btnAuthModalRetry = document.getElementById('btn-auth-modal-retry');
  const authPromptModal = document.getElementById('auth-prompt-modal');

  if (btnCloseAuthModal && authPromptModal) {
    btnCloseAuthModal.addEventListener('click', () => {
      authPromptModal.style.display = 'none';
    });
  }
  if (authPromptModal) {
    authPromptModal.addEventListener('click', (e) => {
      if (e.target === authPromptModal) authPromptModal.style.display = 'none';
    });
  }
  if (btnAuthModalLogin) {
    btnAuthModalLogin.addEventListener('click', () => openSpectrumLogin());
  }
  if (btnAuthModalRetry) {
    btnAuthModalRetry.addEventListener('click', () => {
      if (authPromptModal) authPromptModal.style.display = 'none';
      refreshActivities(true);
    });
  }

  // Popup Auth Banner
  const btnAuthBannerLogin = document.getElementById('btn-auth-banner-login');
  const btnAuthBannerRetry = document.getElementById('btn-auth-banner-retry');
  const btnAuthBannerClose = document.getElementById('btn-auth-banner-close');
  const spectrumAuthBanner = document.getElementById('spectrum-auth-banner');

  if (btnAuthBannerLogin) {
    btnAuthBannerLogin.addEventListener('click', () => openSpectrumLogin());
  }
  if (btnAuthBannerRetry) {
    btnAuthBannerRetry.addEventListener('click', () => refreshActivities(true));
  }
  if (btnAuthBannerClose && spectrumAuthBanner) {
    btnAuthBannerClose.addEventListener('click', () => {
      spectrumAuthBanner.style.display = 'none';
    });
  }

  // Fulltab Auth Banner
  const btnFulltabAuthBannerLogin = document.getElementById('btn-fulltab-auth-banner-login');
  const btnFulltabAuthBannerRetry = document.getElementById('btn-fulltab-auth-banner-retry');
  const btnFulltabAuthBannerClose = document.getElementById('btn-fulltab-auth-banner-close');
  const fulltabAuthBanner = document.getElementById('fulltab-auth-banner');

  if (btnFulltabAuthBannerLogin) {
    btnFulltabAuthBannerLogin.addEventListener('click', () => openSpectrumLogin());
  }
  if (btnFulltabAuthBannerRetry) {
    btnFulltabAuthBannerRetry.addEventListener('click', () => refreshActivities(true));
  }
  if (btnFulltabAuthBannerClose && fulltabAuthBanner) {
    btnFulltabAuthBannerClose.addEventListener('click', () => {
      fulltabAuthBanner.style.display = 'none';
    });
  }

  // Clickable status indicator for quick login
  if (statusIndicator) {
    statusIndicator.style.cursor = 'pointer';
    statusIndicator.addEventListener('click', () => {
      const isProblem = statusIndicator.textContent.includes('Log In Required') || 
                        statusIndicator.textContent.includes('Offline') ||
                        statusIndicator.innerHTML.includes('#ef4444') ||
                        statusIndicator.innerHTML.includes('#f59e0b');
      if (isProblem) {
        showLoginPrompt({ reason: 'login_required', showModal: true });
      }
    });
  }

  initHeaderBrandLogo();
});

// Direct Extension Fetchers (Manifest V3 with Host Permissions)
// Modularized into ./modules/fetchers.js (loaded via popup.html)
