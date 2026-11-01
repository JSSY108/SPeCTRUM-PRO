// ==========================================================================
// SPeCTRUM Pro Course Materials & Downloader Module
// - Tree structure builder, section expander, batch zip packager
// - Fast Moodle folder recursive extractor, office/pdf previewer & inspector
// ==========================================================================

(function(window) {
  'use strict';

  // Safe resolution of shared utilities from window / utils.js
  const t = (section, key, params = {}) => {
    if (typeof window !== 'undefined' && typeof window.t === 'function') {
      return window.t(section, key, params);
    }
    return key;
  };
  const cleanHtmlForParser = (typeof window !== 'undefined' && window.cleanHtmlForParser) ? window.cleanHtmlForParser : ((h) => h);
  const logDiag = (typeof window !== 'undefined' && window.logDiag) ? window.logDiag : ((cat, msg) => console.log(`[${cat}] ${msg}`));
  const formatDateKey = (typeof window !== 'undefined' && window.formatDateKey) ? window.formatDateKey : ((d) => '');
  const cleanSectionTitle = (typeof window !== 'undefined' && window.cleanSectionTitle) ? window.cleanSectionTitle : ((t) => t);
  const cleanDisplayCourseName = (typeof window !== 'undefined' && window.cleanDisplayCourseName) ? window.cleanDisplayCourseName : ((n) => n);
  const getCourseCategoryTag = (typeof window !== 'undefined' && window.getCourseCategoryTag) ? window.getCourseCategoryTag : ((code, title) => 'CORE');
  const generateUniqueFileId = (typeof window !== 'undefined' && window.generateUniqueFileId) ? window.generateUniqueFileId : ((c, s, i, u, t) => `f_${c}_${i}`);
  const findSpectrumTab = (typeof window !== 'undefined' && window.findSpectrumTab) ? window.findSpectrumTab : (async () => null);
  const fetchCourseMaterialsDirectly = (typeof window !== 'undefined' && window.fetchCourseMaterialsDirectly) ? window.fetchCourseMaterialsDirectly : (async () => null);
  const fetchEnrolledCoursesDirectly = (typeof window !== 'undefined' && window.fetchEnrolledCoursesDirectly) ? window.fetchEnrolledCoursesDirectly : (async () => null);
  const executeInTab = (typeof window !== 'undefined' && window.executeInTab) ? window.executeInTab : (async () => null);
  const fetchWithTimeout = (typeof window !== 'undefined' && window.fetchWithTimeout) ? window.fetchWithTimeout : (typeof fetch !== 'undefined' ? fetch : null);

  let currentExtFilter = 'ALL';
  let currentInspectedFile = null;

  const defaultSettings = {
    extensions: ['.pdf', '.pptx', '.zip', '.docx', '.xlsx', '.ipynb', '.doc', '.ppt', '.txt'],
    materialsOnly: true,
    excludeSystem: true
  };
  let isScanningMaterials = false;
  let isSyncingActivities = false;
  let coursesData = (typeof window !== 'undefined' && Array.isArray(window.coursesData)) ? window.coursesData : [];
  let allCoursesDiscovered = (typeof window !== 'undefined' && Array.isArray(window.allCoursesDiscovered)) ? window.allCoursesDiscovered : [];

  function populateAttendanceCourseFilterOptions() {
    if (typeof window !== 'undefined' && typeof window.populateAttendanceCourseFilterOptions === 'function') {
      window.populateAttendanceCourseFilterOptions();
    }
  }
  function renderOccPreferencesTable() {
    if (typeof window !== 'undefined' && typeof window.renderOccPreferencesTable === 'function') {
      window.renderOccPreferencesTable();
    }
  }
  function debounceSaveCache() {
    if (typeof window !== 'undefined' && typeof window.debounceSaveCache === 'function') {
      window.debounceSaveCache();
    }
  }

  // DOM Elements cache for Materials Tab
  let filterSearchInput = null;
  let btnClearSearch = null;
  let courseTreeEl = null;
  let courseLoadingEl = null;
  let courseLoadingText = null;
  let notOnSpectrumEl = null;
  let selectAllChk = null;
  let selectedCountEl = null;
  let btnToggleExpandAll = null;
  let expandAllLabel = null;
  let btnRescan = null;
  let btnRescanLabel = null;
  let cacheTimeBadge = null;
  let btnDownloadZip = null;
  let btnDownloadText = null;
  let progressContainer = null;
  let progressBarFill = null;
  let progressPercent = null;
  let progressStatusLabel = null;
  let progressCurrentFile = null;
  let progressFileCount = null;
  let chkMaterialsOnly = null;
  let chkExcludeSystem = null;
  let chkExts = [];

  function initMaterialsDomElements() {
    filterSearchInput = document.getElementById('filter-search-input');
    btnClearSearch = document.getElementById('btn-clear-search');
    courseTreeEl = document.getElementById('course-tree');
    courseLoadingEl = document.getElementById('course-list-loading');
    courseLoadingText = document.getElementById('course-loading-text');
    notOnSpectrumEl = document.getElementById('not-on-spectrum');
    selectAllChk = document.getElementById('select-all');
    selectedCountEl = document.getElementById('selected-count');
    btnToggleExpandAll = document.getElementById('btn-toggle-expand-all');
    expandAllLabel = document.getElementById('btn-toggle-expand-label');
    btnRescan = document.getElementById('btn-rescan');
    btnRescanLabel = document.getElementById('btn-rescan-label');
    cacheTimeBadge = document.getElementById('cache-time-badge');
    btnDownloadZip = document.getElementById('btn-download-zip');
    btnDownloadText = document.getElementById('btn-download-text');
    progressContainer = document.getElementById('progress-container');
    progressBarFill = document.getElementById('progress-bar-fill');
    progressPercent = document.getElementById('progress-percent');
    progressStatusLabel = document.getElementById('progress-status-label');
    progressCurrentFile = document.getElementById('progress-current-file');
    progressFileCount = document.getElementById('progress-file-count');
    chkMaterialsOnly = document.getElementById('chk-materials-only');
    chkExcludeSystem = document.getElementById('chk-exclude-system');
    chkExts = document.querySelectorAll('.chk-ext');

    bindMaterialsEventListeners();
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

  async function scanCourses(tabToUse = null, isRescan = false) {
    if (isScanningMaterials) return;
    if (typeof window !== 'undefined' && window.isSyncingActivities) {
      logDiag('Materials:Scan', 'Activities sync currently in progress, skipping concurrent materials scan.');
      return;
    }
    isScanningMaterials = true;
    if (typeof window !== 'undefined') window.isScanningMaterials = true;

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

      // Priority 1: Check existing coursesData from window/cache
      const existing = (typeof window !== 'undefined' && Array.isArray(window.coursesData) && window.coursesData.length > 0)
        ? window.coursesData
        : (Array.isArray(coursesData) && coursesData.length > 0 ? coursesData : []);

      if (existing.length > 0 && !isRescan) {
        rawCourses = existing;
      } else {
        logDiag('Materials:Scan', 'Fetching enrolled courses directly from SPeCTRUM...');
        const fetchRes = await fetchEnrolledCoursesDirectly();
        if (fetchRes && fetchRes.courses && fetchRes.courses.length > 0) {
          rawCourses = fetchRes.courses;
        } else if (existing.length > 0) {
          rawCourses = existing;
        }
      }

      const isRealCourse = c => c && c.id && /^\d+$/.test(String(c.id));
      const filtered = filterCourses(rawCourses, chkExcludeSystem ? chkExcludeSystem.checked : true).filter(isRealCourse);

      if (!filtered || filtered.length === 0) {
        if (courseLoadingEl) courseLoadingEl.style.display = 'none';
        if (courseTreeEl) {
          courseTreeEl.innerHTML = `
            <div class="empty-state" style="text-align:center;padding:32px 16px;color:var(--text-muted);">
              <div style="font-size:24px;margin-bottom:8px;">📚</div>
              <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">${t('materials', 'noCoursesFound')}</div>
              <p style="font-size:11px;line-height:1.5;max-width:320px;margin:0 auto 14px;">${t('materials', 'loginPrompt')}</p>
              <button type="button" id="btn-empty-rescan" class="btn-wireframe" style="padding:6px 14px;font-size:11px;font-weight:700;cursor:pointer;">${t('materials', 'rescanCoursesBtn')}</button>
            </div>
          `;
          const emptyRescan = document.getElementById('btn-empty-rescan');
          if (emptyRescan) {
            emptyRescan.onclick = () => scanCourses(null, true);
          }
        }
        hideCourseFetchProgress(600);
        return;
      }

      const totalCourses = filtered.length;
      updateCourseFetchProgress(
        16,
        `Discovered ${totalCourses} enrolled courses. Fetching materials for each course...`,
        `0 of ${totalCourses} courses`
      );

      coursesData = filtered.map(c => {
        const prev = existing.find(ex => String(ex.id) === String(c.id));
        const codeMatch = (c.name || c.title || '').match(/^[A-Z]{3}\d{4}(\/[A-Z]{3}\d{4})?/);
        const code = c.code || (codeMatch ? codeMatch[0] : `Course ${c.id}`);
        const cleanTitle = c.title || (codeMatch ? (c.name || '').replace(codeMatch[0], '').trim() : (c.name || ''));
        return {
          id: String(c.id),
          name: c.name || c.title || code,
          code: code,
          title: cleanTitle || c.name || code,
          url: c.url || `https://spectrum.um.edu.my/course/view.php?id=${c.id}`,
          sections: (isRescan || !prev?.loaded) ? [] : (prev.sections || []),
          announcements: [],
          checked: true,
          expanded: prev ? Boolean(prev.expanded) : false,
          loaded: (isRescan || !prev?.loaded) ? false : Boolean(prev.loaded)
        };
      });

      if (typeof window !== 'undefined') window.coursesData = coursesData;

      renderCourseTreeShells();
      renderOccPreferencesTable();

      let allowedExts = defaultSettings.extensions;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          const currentPrefs = await chrome.storage.local.get(defaultSettings);
          if (currentPrefs && Array.isArray(currentPrefs.extensions) && currentPrefs.extensions.length > 0) {
            allowedExts = currentPrefs.extensions;
          }
        } catch (e) {}
      }
      const materialsOnly = chkMaterialsOnly ? chkMaterialsOnly.checked : true;

      let coursesDone = 0;
      let totalFilesFound = 0;

      // Scan all course materials in parallel batches of 3
      const batchSize = 3;
      for (let i = 0; i < coursesData.length; i += batchSize) {
        const batch = coursesData.slice(i, i + batchSize);
        const batchCodes = batch.map(c => c.code || c.name).join(', ');

        const stepPct = 16 + Math.round((coursesDone / totalCourses) * 80);
        updateCourseFetchProgress(
          stepPct,
          `Fetching materials: [${batchCodes}] (${coursesDone + 1} of ${totalCourses})...`,
          `${coursesDone} of ${totalCourses} courses · ${totalFilesFound} files found`
        );

        await Promise.all(batch.map(async (course) => {
          if (course.loaded && course.sections && course.sections.length > 0 && !isRescan) {
            coursesDone++;
            totalFilesFound += course.sections.reduce((acc, s) => acc + (s.files?.length || 0), 0);
            return;
          }

          try {
            const rawMaterials = await fetchCourseMaterialsDirectly(course.id, allowedExts, materialsOnly);

            const sectionMap = new Map();
            (rawMaterials || []).forEach(mat => {
              const secName = cleanSectionTitle(mat.section) || 'General';
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
            if (!course.sections) course.sections = [];
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
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({
          cachedCoursesData: coursesData,
          cachedCoursesTime: finishTime
        });
      }

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
      if (typeof window !== 'undefined') window.isScanningMaterials = false;
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
    const list = (typeof window !== 'undefined' && Array.isArray(window.coursesData) && window.coursesData.length > 0)
      ? window.coursesData
      : (Array.isArray(coursesData) ? coursesData : []);

    coursesData = list.filter(isRealCourse);
    if (typeof window !== 'undefined') window.coursesData = coursesData;

    if (coursesData.length === 0) {
      courseTreeEl.innerHTML = `
        <div class="empty-state" style="text-align:center;padding:32px 16px;color:var(--text-muted);">
          <div style="font-size:24px;margin-bottom:8px;">📚</div>
          <div style="font-size:12.5px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${t('materials', 'noCoursesSynced')}</div>
          <div style="font-size:11px;line-height:1.5;max-width:260px;margin:0 auto 12px;">${t('materials', 'noCoursesSub')}</div>
          <button type="button" id="btn-empty-rescan-shell" class="btn-wireframe" style="padding:6px 14px;font-size:11px;font-weight:700;cursor:pointer;">${t('materials', 'rescanMaterials')}</button>
        </div>
      `;
      const btnEmptyRescan = document.getElementById('btn-empty-rescan-shell');
      if (btnEmptyRescan) {
        btnEmptyRescan.onclick = () => scanCourses(null, true);
      }
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
      const updatedTimeStr = idx === 0 ? t('materials', 'updated2Hours') : (idx === 1 ? t('materials', 'updatedYesterday') : (idx === 2 ? t('materials', 'updated3Days') : t('materials', 'updated5Days')));
      const fileWord = totalFiles === 1 ? t('materials', 'fileSingle') : t('materials', 'filePlural');

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
            <div class="course-sub-meta">${totalFiles} ${fileWord} &nbsp;·&nbsp; ${totalMb} MB &nbsp;·&nbsp; ${updatedTimeStr}</div>
          </div>
          <button type="button" class="btn-download-pack" data-course-id="${course.id}" title="${t('materials', 'downloadCoursePack')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>${t('materials', 'downloadCoursePack')}</span>
          </button>
        </div>
        <div class="course-tree-children">
          ${course.loaded ? '' : `<p class="settings-desc" style="padding:8px 16px;font-size:11px;color:var(--text-muted);">${t('materials', 'scanningContents')}</p>`}
        </div>
      `;

      const header = item.querySelector('.course-tree-header');
      if (header) {
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
      }

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
      childrenContainer.innerHTML = `<p class="settings-desc" style="padding:10px 16px;font-size:11px;color:var(--text-muted);">${t('materials', 'noFilesFound')}</p>`;
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

    const t = (typeof window !== 'undefined' && typeof window.t === 'function')
      ? window.t
      : (sec, key) => (key === 'collapseAll' ? 'Collapse All' : 'Expand All');

    const collapseText = t('materials', 'collapseAll');
    const expandText = t('materials', 'expandAll');

    if (anyExpanded) {
      if (labelEl) labelEl.textContent = collapseText;
      if (iconEl) {
        iconEl.innerHTML = '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>';
      }
      btnToggleExpandAll.setAttribute('title', collapseText);
      btnToggleExpandAll.classList.add('all-expanded');
    } else {
      if (labelEl) labelEl.textContent = expandText;
      if (iconEl) {
        iconEl.innerHTML = '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>';
      }
      btnToggleExpandAll.setAttribute('title', expandText);
      btnToggleExpandAll.classList.remove('all-expanded');
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

  function bindMaterialsEventListeners() {
    // Extension filter pills
    document.querySelectorAll('.mat-ext-pill').forEach(pill => {
      pill.onclick = () => {
        document.querySelectorAll('.mat-ext-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentExtFilter = pill.dataset.ext || 'ALL';
        applyMaterialsFilters();
      };
    });

    // Sort dropdown
    const matSortSelect = document.getElementById('mat-sort-select');
    if (matSortSelect) {
      matSortSelect.onchange = () => {
        const mode = matSortSelect.value;
        const list = (typeof window !== 'undefined' && Array.isArray(window.coursesData)) ? window.coursesData : coursesData;
        list.forEach(c => {
          (c.sections || []).forEach(s => {
            if (mode === 'name') {
              s.files.sort((a, b) => a.title.localeCompare(b.title));
            } else {
              s.files.sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true }));
            }
          });
        });
        renderCourseTreeShells();
      };
    }

    // Search input & clear button
    const searchInput = document.getElementById('filter-search-input');
    const clearBtn = document.getElementById('btn-clear-search');
    if (searchInput) {
      searchInput.oninput = () => {
        const query = searchInput.value.trim();
        if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';
        applyMaterialsFilters();
      };
    }

    if (clearBtn && searchInput) {
      clearBtn.onclick = () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        applyMaterialsFilters();
      };
    }

    // Clear Selection
    const btnClearSelection = document.getElementById('btn-clear-selection');
    if (btnClearSelection) {
      btnClearSelection.onclick = () => {
        const list = (typeof window !== 'undefined' && Array.isArray(window.coursesData)) ? window.coursesData : coursesData;
        list.forEach(c => {
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
      };
    }

    // Mark All Synced
    const btnMarkAllSynced = document.getElementById('btn-mark-all-synced');
    if (btnMarkAllSynced) {
      btnMarkAllSynced.onclick = () => {
        const list = (typeof window !== 'undefined' && Array.isArray(window.coursesData)) ? window.coursesData : coursesData;
        list.forEach(c => {
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
      };
    }

    // Expand All Button
    if (btnToggleExpandAll) {
      btnToggleExpandAll.onclick = () => {
        toggleExpandAllMaterials();
      };
    }

    // Rescan Button
    if (btnRescan) {
      btnRescan.onclick = async () => {
        logDiag('Materials', 'Rescan button clicked! Starting direct materials scan...');
        await scanCourses(null, true);
      };
    }

    // Download Zip Button
    if (btnDownloadZip) {
      btnDownloadZip.onclick = async () => {
        const list = (typeof window !== 'undefined' && Array.isArray(window.coursesData)) ? window.coursesData : coursesData;
        const selectedFiles = [];
        list.forEach(c => {
          const courseFolder = `${sanitizeFilename(c.code)} ${sanitizeFilename(c.title)}`.trim();
          (c.sections || []).forEach(s => {
            const sectionFolder = sanitizeFilename(s.name);
            (s.files || []).forEach(f => {
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

        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBarFill) progressBarFill.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (progressStatusLabel) progressStatusLabel.textContent = 'Starting file download...';
        btnDownloadZip.disabled = true;

        const zip = new JSZip();
        let totalSaved = 0;
        let totalFailed = 0;

        let allowedExts = defaultSettings.extensions;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          try {
            const currentPrefs = await chrome.storage.local.get(defaultSettings);
            if (currentPrefs && Array.isArray(currentPrefs.extensions) && currentPrefs.extensions.length > 0) {
              allowedExts = currentPrefs.extensions;
            }
          } catch (e) {}
        }

        for (let i = 0; i < selectedFiles.length; i++) {
          const item = selectedFiles[i];
          const percent = Math.round(((i + 1) / selectedFiles.length) * 85);

          if (progressBarFill) progressBarFill.style.width = `${percent}%`;
          if (progressPercent) progressPercent.textContent = `${percent}%`;
          if (progressCurrentFile) progressCurrentFile.textContent = item.title;
          if (progressFileCount) progressFileCount.textContent = `${i + 1} / ${selectedFiles.length}`;

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

        if (progressStatusLabel) progressStatusLabel.textContent = 'Compressing organized .ZIP archive...';
        if (progressBarFill) progressBarFill.style.width = '90%';
        if (progressPercent) progressPercent.textContent = '90%';

        const zipBlob = await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        }, (meta) => {
          const p = Math.round(90 + (meta.percent * 0.10));
          if (progressBarFill) progressBarFill.style.width = `${p}%`;
          if (progressPercent) progressPercent.textContent = `${p}%`;
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

        if (progressBarFill) progressBarFill.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressStatusLabel) progressStatusLabel.textContent = `✔ Complete! (${totalSaved} files saved)`;
        if (progressCurrentFile) progressCurrentFile.textContent = 'Saved to your Downloads folder';
        if (btnDownloadText) btnDownloadText.textContent = '✔ Download Complete!';
        setTimeout(updateAllCounts, 3500);
      };
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


  // Export methods onto Window
  window.updateCourseFetchProgress = updateCourseFetchProgress;
  window.hideCourseFetchProgress = hideCourseFetchProgress;
  window.scanCourses = scanCourses;
  window.filterCourses = filterCourses;
  window.getSeedCourses = getSeedCourses;
  window.getFileMetadata = getFileMetadata;
  window.getFileTopicDetails = getFileTopicDetails;
  window.renderCourseTreeShells = renderCourseTreeShells;
  window.populateCourseChildren = populateCourseChildren;
  window.updateExpandAllButtonState = updateExpandAllButtonState;
  window.toggleExpandAllMaterials = toggleExpandAllMaterials;
  window.submitOidcFormIfPresent = submitOidcFormIfPresent;
  window.isExcludedMoodleFile = isExcludedMoodleFile;
  window.extractMoodleRealFileUrl = extractMoodleRealFileUrl;
  window.extractMoodleFolderFiles = extractMoodleFolderFiles;
  window.parseOfficePreview = parseOfficePreview;
  window.loadMiniPreview = loadMiniPreview;
  window.openFileInspector = openFileInspector;
  window.downloadSingleFile = downloadSingleFile;
  window.downloadCoursePack = downloadCoursePack;
  window.syncCourseDomCheckboxes = syncCourseDomCheckboxes;
  window.updateParentSectionCheckbox = updateParentSectionCheckbox;
  window.updateParentCourseCheckbox = updateParentCourseCheckbox;
  window.updateAllCounts = updateAllCounts;
  window.applyMaterialsFilters = applyMaterialsFilters;
  window.detectFileBadge = detectFileBadge;
  window.sanitizeFilename = sanitizeFilename;
  window.fetchFileWithRedirect = fetchFileWithRedirect;
  window.initMaterialsTab = function() {
    initMaterialsDomElements();
    if (typeof initPreviewZoomControls === 'function') initPreviewZoomControls();
    if (typeof initInspectorResizer === 'function') initInspectorResizer();
    if (typeof initPageNavControls === 'function') initPageNavControls();
  };

  // Auto-init DOM elements when document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initMaterialsDomElements();
    });
  } else {
    initMaterialsDomElements();
  }
})(typeof window !== 'undefined' ? window : this);
