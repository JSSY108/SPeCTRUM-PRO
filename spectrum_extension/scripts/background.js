// SPeCTRUM Pro Background Service Worker (Manifest V3)
// Handles periodic background auto-attendance checks and desktop notifications

const ALARM_NAME = 'spectrum_auto_attendance_check';
const DEFAULT_INTERVAL_MINUTES = 15;

// Persistent Background Logger (Saved to chrome.storage.local for visibility in SPeCTRUM Pro UI)
async function appendBackgroundLog(category, message, details = null) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toISOString().slice(0, 10);
  const entry = {
    ts: Date.now(),
    timeStr,
    dateStr,
    category,
    message,
    details: details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : ''
  };

  try {
    const data = await chrome.storage.local.get({ autoAttendanceLogs: [] });
    const logs = Array.isArray(data.autoAttendanceLogs) ? data.autoAttendanceLogs : [];
    logs.push(entry);
    if (logs.length > 120) logs.splice(0, logs.length - 120);
    await chrome.storage.local.set({ autoAttendanceLogs: logs });
  } catch (e) {
    console.warn('[SPeCTRUM Pro Background] Log write warning:', e);
  }
  console.log(`[SPeCTRUM Pro Background] [${category}] ${message}`, details || '');
}


// Initialize alarms on install or startup
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[SPeCTRUM Pro] Extension installed/updated:', details.reason);
  await setupAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
});

// Setup or update alarm based on user preferences
async function setupAlarm() {
  const settings = await chrome.storage.local.get({
    autoAttendanceEnabled: true,
    autoAttendanceInterval: DEFAULT_INTERVAL_MINUTES
  });

  await chrome.alarms.clear(ALARM_NAME);

  if (settings.autoAttendanceEnabled) {
    const interval = Math.max(5, parseInt(settings.autoAttendanceInterval, 10) || DEFAULT_INTERVAL_MINUTES);
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 2,
      periodInMinutes: interval
    });
    console.log(`[SPeCTRUM Pro] Background attendance monitor active every ${interval} minutes.`);
  } else {
    console.log('[SPeCTRUM Pro] Background attendance monitor disabled in settings.');
  }
}

// Ensure alarm is scheduled on initial worker startup
setupAlarm();

// Alarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[SPeCTRUM Pro] Alarm triggered: Running background attendance check...');
    await runBackgroundAttendanceCheck();
  }
});

// Keyboard shortcuts command listener
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-floating-panel') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id && tab.url && !/^(chrome|edge|devtools|about):/i.test(tab.url)) {
          chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_FLOATING_PANEL' }, async (res) => {
            if (chrome.runtime.lastError || !res) {
              try {
                await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['scripts/content.css'] });
                await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scripts/content.js'] });
                setTimeout(() => {
                  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_FLOATING_PANEL' });
                }, 80);
              } catch (e) {}
            }
          });
        }
      } catch (e) {
        console.warn('[SPeCTRUM Pro Background] Command toggle error:', e);
      }
    }
  });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_ALARM_SETTINGS') {
    setupAlarm().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'CHECK_ATTENDANCE_NOW') {
    runBackgroundAttendanceCheck().then((results) => sendResponse({ success: true, results }));
    return true;
  }
  if (message.type === 'SUBMIT_ATTENDANCE_FORM') {
    handleFormAttendanceSubmit(message.formAction, message.fields, message.takeUrl)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  }
  if (message.type === 'FETCH_FILE_PREVIEW') {
    handleFetchFilePreview(message.url)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  }
});

// Fetch file content for mini-preview
async function handleFetchFilePreview(fileUrl, retryCount = 0) {
  try {
    let targetUrl = fileUrl;
    if (targetUrl && targetUrl.includes('/mod/resource/view.php') && !targetUrl.includes('redirect=1')) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'redirect=1';
    }

    const res = await fetch(targetUrl, {
      credentials: 'include',
      redirect: 'follow'
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const arrayBuffer = await res.arrayBuffer();

    // If HTML was returned, check for Microsoft SSO OIDC auto-submit form or Moodle wrapper
    if (contentType.includes('text/html') && retryCount < 2) {
      const textSnippet = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer.slice(0, 32000)));

      // Check for Microsoft SSO / OIDC form
      if (textSnippet.includes('auth/oidc') && textSnippet.includes('name="code"')) {
        const actionMatch = textSnippet.match(/action="([^"]+)"/i);
        const formAction = actionMatch ? actionMatch[1] : 'https://spectrum.um.edu.my/auth/oidc/';
        const inputRegex = /<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi;
        const formData = new URLSearchParams();
        let m;
        while ((m = inputRegex.exec(textSnippet)) !== null) {
          formData.append(m[1], m[2]);
        }
        try {
          console.log('[SPeCTRUM Pro Background] Auto-submitting OIDC form in background worker...');
          await fetch(formAction, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString(),
            credentials: 'include',
            redirect: 'follow'
          });
          // Re-fetch original URL now that session is renewed
          return handleFetchFilePreview(fileUrl, retryCount + 1);
        } catch (oidcErr) {
          console.warn('[SPeCTRUM Pro Background] OIDC auto-submit error:', oidcErr);
        }
      }

      // Check for Moodle resource link to pluginfile.php (Specifically matching /mod_resource/content/ or resource containers, NEVER course summary / CIF)
      let resourceFileUrl = null;
      const modResMatch = textSnippet.match(/(?:href|data|src)="([^"]*\/pluginfile\.php\/[^"]*\/mod_resource\/content\/[^"]*)"/i) ||
                          textSnippet.match(/class="resourceworkaround"[^>]*>[\s\S]*?href="([^"]+)"/i) ||
                          textSnippet.match(/class="resourcecontent"[^>]*>[\s\S]*?(?:data|src|href)="([^"]+)"/i) ||
                          textSnippet.match(/(?:href|data|src)="([^"]*\/pluginfile\.php\/[^"]*\/mod_folder\/content\/[^"]*)"/i);
      if (modResMatch && modResMatch[1]) {
        const candidate = modResMatch[1].replace(/&amp;/g, '&');
        const lower = candidate.toLowerCase();
        if (!lower.includes('/course/section/') && !lower.includes('proforma') && !lower.includes('cif')) {
          resourceFileUrl = candidate;
        }
      }

      if (resourceFileUrl && resourceFileUrl !== fileUrl && resourceFileUrl !== targetUrl) {
        let nextUrl = resourceFileUrl;
        if (nextUrl.startsWith('/')) nextUrl = `https://spectrum.um.edu.my${nextUrl}`;
        return handleFetchFilePreview(nextUrl, retryCount + 1);
      }
    }
    
    // Limit to 64MB for preview payload (allows full presentation slide decks & large PDFs)
    const maxPreviewBytes = 64 * 1024 * 1024;
    const bufferSlice = arrayBuffer.byteLength > maxPreviewBytes 
      ? arrayBuffer.slice(0, maxPreviewBytes) 
      : arrayBuffer;

    let binary = '';
    const bytes = new Uint8Array(bufferSlice);
    const chunkSz = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSz) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSz));
    }
    const base64 = btoa(binary);

    return {
      success: true,
      mimeType: contentType,
      dataBase64: base64,
      totalBytes: arrayBuffer.byteLength
    };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// Robust Background Attendance Form Submitter (Bypasses popup CORS redirect constraints)
async function handleFormAttendanceSubmit(formAction, fields, takeUrl) {
  try {
    const postUrl = formAction || takeUrl;
    console.log('[SPeCTRUM Pro Background] ▶ Submitting attendance form to:', postUrl);
    console.log('[SPeCTRUM Pro Background] Form fields:', fields);

    const formData = new URLSearchParams();
    for (const key of Object.keys(fields || {})) {
      formData.append(key, fields[key]);
    }

    const res = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString(),
      credentials: 'include',
      redirect: 'follow'
    });

    const resText = await res.text();
    const finalUrl = res.url || '';
    console.log('[SPeCTRUM Pro Background] POST Response HTTP:', res.status, 'Final URL:', finalUrl);

    const isSuccess = (finalUrl.includes('/mod/attendance/view.php') ||
                      /status:\s*(?:present|hadir)|attendance has been recorded|kehadiran anda telah direkodkan|sudah direkod|attendance has been taken/i.test(resText) ||
                      resText.includes('Your attendance in this session has been recorded')) &&
                      !finalUrl.includes('/login/');

    console.log('[SPeCTRUM Pro Background] isSuccess check:', isSuccess, 'res.ok:', res.ok);

    if (isSuccess) {
      const sessidMatch = (takeUrl || '').match(/sessid=(\d+)/);
      const sessid = sessidMatch ? sessidMatch[1] : '';
      const todayStr = new Date().toISOString().slice(0, 10);
      const stored = await chrome.storage.local.get({ lastAttendanceSubmissions: {} });
      const rec = stored.lastAttendanceSubmissions || {};
      if (sessid) rec[sessid] = todayStr;
      await chrome.storage.local.set({ lastAttendanceSubmissions: rec });
      console.log('[SPeCTRUM Pro Background] ✅ Attendance recorded in storage for session:', sessid);
      await appendBackgroundLog('Attendance:ManualSubmit', `✅ Verified attendance recorded on SPeCTRUM for session ${sessid}`);

      return { success: true };
    }

    const errorMatch = resText.match(/class=["'][^"']*alert-danger[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                       resText.match(/class=["'][^"']*error[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const errorMsg = errorMatch ? errorMatch[1].replace(/<[^>]+>/g, '').trim() : 'Submission rejected by SPeCTRUM. Please check if password is correct.';
    await appendBackgroundLog('Attendance:ManualSubmit', `⚠️ SPeCTRUM submission unconfirmed: ${errorMsg}`);

    return { success: false, error: errorMsg };
  } catch (err) {
    console.error('[SPeCTRUM Pro Background] Submit error:', err);
    await appendBackgroundLog('Attendance:ManualSubmit', `❌ Submit error: ${err?.message || err}`);
    return { success: false, error: err?.message || String(err) };
  }
}

// Notification click handler
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('attendance_')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=full&tab=tab-activities&sub=attendance') });
  }
});

// Helper: Synchronize submission state into cachedAttendances & lastAttendanceSubmissions
async function recordAttendanceSuccess(courseId, session, todayStr, courseName = '') {
  try {
    const store = await chrome.storage.local.get({ cachedAttendances: [], lastAttendanceSubmissions: {} });
    const allAtts = store.cachedAttendances || [];
    const submissions = store.lastAttendanceSubmissions || {};
    const sessionKey = `${courseId}_${session.sessid || session.takeUrl}`;
    submissions[sessionKey] = todayStr;
    submissions[`course_${courseId}`] = todayStr;

    const targets = allAtts.filter(a => String(a.courseId) === String(courseId) || (session.takeUrl && a.attUrl && session.takeUrl.includes(a.attUrl)));
    targets.forEach(target => {
      target.lastRecordedStatus = 'Present';
      target.activeSession = null;
      if (Array.isArray(target.sessions)) {
        target.sessions.forEach(s => {
          const sKey = s.dateKey || (s.date ? new Date(s.date).toISOString().slice(0, 10) : '');
          if (sKey === todayStr || (session.sessid && String(s.sessid) === String(session.sessid))) {
            s.isPresent = true;
            s.statusType = 'present';
            s.statusLabel = '✔ Present';
            s.isFuture = false;
          }
        });
      }
      if (target.nextSession) {
        const nsKey = target.nextSession.dateKey || (target.nextSession.date ? new Date(target.nextSession.date).toISOString().slice(0, 10) : '');
        if (nsKey === todayStr) {
          target.nextSession.isPresent = true;
          target.nextSession.statusType = 'present';
          target.nextSession.statusLabel = '✔ Present';
          target.nextSession.isFuture = false;
        }
      }
    });

    await chrome.storage.local.set({
      lastAttendanceSubmissions: submissions,
      cachedAttendances: allAtts
    });

    showDesktopNotification(
      `attendance_success_${sessionKey}`,
      `✅ Attendance Recorded (Present)!`,
      `Successfully marked attendance for ${courseName || 'your course'}!`
    );

    try { chrome.runtime.sendMessage({ type: 'DATA_UPDATED' }); } catch (e) {}
  } catch (err) {
    console.warn('[SPeCTRUM Pro] Failed to record attendance success in cache:', err);
  }
}

// Run background attendance check across enrolled courses
async function runBackgroundAttendanceCheck() {
  try {
    const stored = await chrome.storage.local.get({
      cachedCoursesData: [],
      cachedAttendances: [],
      courseOccs: {},
      autoAttendanceEnabled: true,
      lastAttendanceSubmissions: {},
      hiddenAttendanceIds: []
    });

    if (!stored.autoAttendanceEnabled) return { skipped: true, reason: 'Disabled' };

    await chrome.storage.local.set({ lastAttendanceCheckTime: Date.now() });

    const courses = stored.cachedCoursesData || [];
    if (courses.length === 0) {
      await appendBackgroundLog('Background:Daemon', 'Auto-attendance check skipped: No cached courses found.');
      return { skipped: true, reason: 'No cached courses' };
    }

    // Verify session by pinging SPeCTRUM
    const pingRes = await fetch('https://spectrum.um.edu.my/my/courses.php', { credentials: 'include' });
    if (!pingRes.ok || pingRes.url.includes('/login/')) {
      console.log('[SPeCTRUM Pro] User not currently logged in to SPeCTRUM. Skipping background check.');
      await appendBackgroundLog('Background:Daemon', '⚠️ Skipped: SPeCTRUM session expired or user not logged in.');
      return { skipped: true, reason: 'Not logged in' };
    }

    const recordedSubmissions = stored.lastAttendanceSubmissions || {};
    const hiddenAttendanceIds = stored.hiddenAttendanceIds || [];
    let newlySubmitted = 0;
    let requiredPins = 0;

    // Fast-path: Check cachedAttendances for any already recognized active sessions
    const cachedAtts = stored.cachedAttendances || [];
    for (const ca of cachedAtts) {
      if (ca && ca.activeSession && ca.activeSession.takeUrl) {
        const cSess = ca.activeSession;
        const cCourseId = String(ca.courseId || '');
        const cSessionKey = `${cCourseId}_${cSess.sessid || cSess.takeUrl}`;
        const todayStr = new Date().toISOString().slice(0, 10);
        if (recordedSubmissions[cSessionKey] === todayStr || recordedSubmissions[`course_${cCourseId}`] === todayStr) continue;

        if (cSess.requiresPassword) {
          requiredPins++;
          showDesktopNotification(
            `attendance_pin_${cSessionKey}`,
            `🔔 Attendance Open: ${ca.courseCode || ca.courseName || 'Class'}`,
            `Attendance is currently active for ${ca.courseName || 'your course'}. A password/PIN is required — click here to enter PIN!`
          );
        } else {
          const success = await submitAttendance(cSess.takeUrl, cSess.presentStatusId, cSess.sesskey, '', ca.courseName || ca.courseCode);
          if (success) {
            newlySubmitted++;
            await recordAttendanceSuccess(cCourseId, cSess, todayStr, ca.courseName || ca.courseCode);
          }
        }
      }
    }

    // Smart Proximity Prioritization: Sort courses so classes closest to current time are scanned first!
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const attByCourseId = new Map();
    cachedAtts.forEach(ca => {
      if (ca && ca.courseId) {
        const cid = String(ca.courseId);
        if (!attByCourseId.has(cid)) attByCourseId.set(cid, []);
        attByCourseId.get(cid).push(ca);
      }
    });

    function getCourseProximityScore(courseId) {
      const cid = String(courseId);
      const courseAttList = attByCourseId.get(cid) || [];
      if (courseAttList.length === 0) return 5000; // Unscanned course, check after priority

      // If active session exists, top priority (Score: 0)
      for (const ca of courseAttList) {
        if (ca.activeSession && ca.activeSession.takeUrl) {
          const sKey = `${cid}_${ca.activeSession.sessid || ca.activeSession.takeUrl}`;
          if (recordedSubmissions[sKey] !== todayStr) return 0;
        }
      }

      const allSessions = [];
      courseAttList.forEach(ca => {
        if (Array.isArray(ca.sessions)) allSessions.push(...ca.sessions);
      });

      const todaySessions = allSessions.filter(s => {
        const sKey = s.dateKey || (s.date ? new Date(s.date).toISOString().slice(0, 10) : '');
        return sKey === todayStr || s.isToday;
      });

      if (todaySessions.length === 0) return 9000; // No class today

      const unsubmitted = todaySessions.filter(s => {
        if (s.isPresent) return false;
        const sKey = `${cid}_${s.sessid || s.takeUrl || s.dateKey || ''}`;
        return recordedSubmissions[sKey] !== todayStr;
      });

      if (unsubmitted.length === 0) return 8000; // All today's sessions attended

      // Calculate minutes difference from class start time
      let minDiff = 4000;
      for (const s of unsubmitted) {
        const rawTime = s.dateStr || s.time || '';
        const match = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:[-–—~]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i) ||
                      rawTime.match(/(\d{1,2}):(\d{2})\s*(?:[-–—~]|to)\s*(\d{1,2}):(\d{2})/);
        if (match) {
          let startH = parseInt(match[1], 10);
          let startM = parseInt(match[2] || '0', 10);
          let startAmpm = (match[3] || '').toUpperCase();
          let endH = parseInt(match[4], 10);
          let endM = parseInt(match[5] || '0', 10);
          let endAmpm = (match[6] || '').toUpperCase();

          if (!startAmpm && endAmpm) {
            startAmpm = (startH <= endH) ? endAmpm : (endAmpm === 'PM' ? 'AM' : 'PM');
          }
          if (startAmpm === 'PM' && startH < 12) startH += 12;
          if (startAmpm === 'AM' && startH === 12) startH = 0;
          if (endAmpm === 'PM' && endH < 12) endH += 12;
          if (endAmpm === 'AM' && endH === 12) endH = 0;

          const startMin = startH * 60 + startM;
          const endMin = endH * 60 + endM;

          // Inside class session or within 20m before start: Top priority
          if (currentMinutes >= startMin - 20 && currentMinutes <= endMin + 15) {
            minDiff = Math.min(minDiff, Math.abs(currentMinutes - startMin));
          } else if (currentMinutes < startMin) {
            minDiff = Math.min(minDiff, (startMin - currentMinutes) + 100);
          } else {
            minDiff = Math.min(minDiff, (currentMinutes - endMin) + 600);
          }
        } else {
          minDiff = Math.min(minDiff, 1500);
        }
      }
      return minDiff;
    }

    // Sort: Classes closest to now appear first
    const prioritizedCourses = [...courses].sort((a, b) => getCourseProximityScore(a.id) - getCourseProximityScore(b.id));

    for (const course of prioritizedCourses) {
      if (!course.id) continue;
      const courseId = String(course.id);
      const userOcc = stored.courseOccs[courseId] || '';

      // Skip courses that have already been marked present today or have no class
      const score = getCourseProximityScore(courseId);
      if (score >= 8000) continue;

      try {
        const courseAttList = attByCourseId.get(courseId) || [];
        const knownUrls = [];
        courseAttList.forEach(ca => {
          if (ca.attUrl && !knownUrls.includes(ca.attUrl)) knownUrls.push(ca.attUrl);
          if (ca.activeSession && ca.activeSession.takeUrl && !knownUrls.includes(ca.activeSession.takeUrl)) {
            knownUrls.push(ca.activeSession.takeUrl);
          }
        });
        const attendanceInfo = await checkCourseAttendance(courseId, course.name, userOcc, hiddenAttendanceIds, knownUrls);
        if (!attendanceInfo || !attendanceInfo.activeSession) continue;

        const session = attendanceInfo.activeSession;
        const sessionKey = `${courseId}_${session.sessid || session.takeUrl}`;

        // Don't re-submit if already handled today
        if (recordedSubmissions[sessionKey] === todayStr) {
          continue;
        }

        if (session.requiresPassword) {
          requiredPins++;
          showDesktopNotification(
            `attendance_pin_${sessionKey}`,
            `🔔 Attendance Open: ${course.code || course.name}`,
            `Attendance is currently active for ${course.name}. A password/PIN is required — click here to enter PIN!`
          );
        } else {
          // Attempt automatic submission
          const success = await submitAttendance(session.takeUrl, session.presentStatusId, session.sesskey, '', course.name || course.code);
          if (success) {
            newlySubmitted++;
            await recordAttendanceSuccess(courseId, session, todayStr, course.name || course.code);
          }
        }
      } catch (err) {
        console.log(`[SPeCTRUM Pro] Background attendance check skipped for course ${courseId}:`, err?.message || err);
      }
    }

    await chrome.storage.local.set({
      lastAttendanceCheckSummary: {
        time: Date.now(),
        newlySubmitted,
        requiredPins,
        coursesScanned: prioritizedCourses.length
      }
    });
    await appendBackgroundLog('Background:Daemon', `🏁 Check finished. ${newlySubmitted} auto-marked, ${requiredPins} PIN required.`);
    return { success: true, newlySubmitted, requiredPins };

  } catch (error) {
    console.log('[SPeCTRUM Pro] Background attendance check notice:', error?.message || error);
    return { error: error.message };
  }
}

// Check attendance page for active sessions
async function checkCourseAttendance(courseId, courseName, userOcc, hiddenAttendanceIds = [], knownAttUrls = []) {
  const attLinks = [];

  function addBackgroundAttUrl(rawUrl) {
    if (!rawUrl) return;
    let u = String(rawUrl).replace(/&amp;/g, '&').trim();
    if (!u || u.startsWith('javascript:') || u === '#') return;

    const anchorMatch = u.match(/(?:coursecontentcollapse|module-|id=)(\d+)/);
    if ((u.startsWith('#') || !u.includes('/mod/attendance/')) && anchorMatch) {
      const resolved = `https://spectrum.um.edu.my/mod/attendance/view.php?id=${anchorMatch[1]}`;
      if (!attLinks.includes(resolved)) attLinks.push(resolved);
      return;
    }

    if (u.startsWith('view.php')) u = `https://spectrum.um.edu.my/mod/attendance/${u}`;
    else if (u.startsWith('/')) u = `https://spectrum.um.edu.my${u}`;
    else if (!u.startsWith('http')) u = `https://spectrum.um.edu.my/mod/attendance/${u}`;

    u = u.split('#')[0];
    if (u.includes('/mod/attendance/') && !attLinks.includes(u)) {
      attLinks.push(u);
    }
  }

  // Pre-seed known URLs from cache if available (Fast Path!)
  if (Array.isArray(knownAttUrls) && knownAttUrls.length > 0) {
    knownAttUrls.forEach(u => addBackgroundAttUrl(u));
  }

  async function inspectLinks(links) {
    for (const attUrl of links) {
      try {
        const fullAttUrl = attUrl.startsWith('http') ? attUrl : `https://spectrum.um.edu.my${attUrl}`;
        const idMatch = fullAttUrl.match(/id=(\d+)/);
        const cmid = idMatch ? idMatch[1] : '';
        const attId = `att_${courseId}_${cmid}`;
        if (hiddenAttendanceIds.includes(cmid) || hiddenAttendanceIds.includes(attId) || (idMatch && hiddenAttendanceIds.includes(idMatch[1]))) {
          continue;
        }
        const attRes = await fetch(fullAttUrl, { credentials: 'include' });
        if (!attRes.ok || attRes.url.includes('/login/')) continue;
        const attHtml = await attRes.text();

        // Check if there is an active "Submit attendance" link (matches attendance.php, take.php, or sessid= with both single and double quotes)
        const takeMatch = attHtml.match(/href=["']([^"']*(?:attendance\.php\?sessid=\d+|take\.php\?sessid=\d+|\bsessid=\d+)[^"']*)["'][^>]*>([^<]*)/i);
        if (!takeMatch) continue;

        const rawTakeUrl = takeMatch[1].replace(/&amp;/g, '&');
        let fullTakeUrl = rawTakeUrl;
        if (fullTakeUrl.startsWith('attendance.php') || fullTakeUrl.startsWith('take.php')) {
          fullTakeUrl = `https://spectrum.um.edu.my/mod/attendance/${fullTakeUrl}`;
        } else if (fullTakeUrl.startsWith('/')) {
          fullTakeUrl = `https://spectrum.um.edu.my${fullTakeUrl}`;
        } else if (!fullTakeUrl.startsWith('http')) {
          fullTakeUrl = `https://spectrum.um.edu.my/mod/attendance/${fullTakeUrl}`;
        }
        const sessidMatch = fullTakeUrl.match(/sessid=(\d+)/);
        const sessid = sessidMatch ? sessidMatch[1] : '';

        // Check OCC matching: if user specified an OCC and session/page has OCC labels
        if (userOcc) {
          const occMatch = attHtml.match(new RegExp(`\\bocc\\s*0*${userOcc}\\b`, 'i'));
          const hasOtherOcc = attHtml.match(/\bocc\s*0*([1-9]\d*)\b/i);
          if (hasOtherOcc && !occMatch) {
            continue;
          }
        }

        // Inspect the take attendance form
        const formRes = await fetch(fullTakeUrl, { credentials: 'include' });
        if (!formRes.ok || formRes.url.includes('/login/')) continue;
        const formHtml = await formRes.text();

        const sesskeyMatch = formHtml.match(/name="sesskey"\s+value="([^"]+)"/) || attHtml.match(/sesskey=([a-zA-Z0-9]+)/);
        const sesskey = sesskeyMatch ? sesskeyMatch[1] : '';

        // Extract only the attendance form HTML containing status radio options
        let formSnippet = '';
        const formMatches = formHtml.match(/<form[\s\S]*?<\/form>/gi) || [];
        for (const f of formMatches) {
          if (f.includes('name="status"') || f.includes('attendance.php') || f.includes('take.php')) {
            formSnippet = f;
            break;
          }
        }
        if (!formSnippet && formMatches.length > 0) {
          formSnippet = formMatches[0];
        }

        // A password/PIN input must exist INSIDE the attendance form itself, not in page navigation or login modals!
        const hasPasswordInput = formSnippet
          ? (/<input[^>]+(?:type=["']password["']|name=["'](?:studentpassword|password|qrpass)["'])/i.test(formSnippet))
          : false;

        // Find radio option for "Present"
        let presentStatusId = '';
        const targetHtml = formSnippet || formHtml;
        const radioRegex = /<input[^>]+type="radio"[^>]+name="status"[^>]+value="(\d+)"[^>]*>([\s\S]*?)<\/label>/gi;
        let rMatch;
        while ((rMatch = radioRegex.exec(targetHtml)) !== null) {
          const val = rMatch[1];
          const label = rMatch[2];
          if (/present|hadir/i.test(label) || !presentStatusId) {
            presentStatusId = val;
            if (/present|hadir/i.test(label)) break;
          }
        }
        if (!presentStatusId) {
          const rMatch = targetHtml.match(/<input[^>]+type="radio"[^>]+name="status"[^>]+value="(\d+)"/i);
          if (rMatch) presentStatusId = rMatch[1];
        }

        return {
          activeSession: {
            takeUrl: fullTakeUrl,
            sessid,
            sesskey,
            requiresPassword: hasPasswordInput,
            presentStatusId
          }
        };
      } catch (e) {}
    }
    return null;
  }

  // Fast-path: Check direct known links first!
  if (attLinks.length > 0) {
    const directResult = await inspectLinks(attLinks);
    if (directResult) return directResult;
  }

  // Fallback: If no direct URLs known or not found on direct link, crawl course pages
  try {
    const ovUrl = `https://spectrum.um.edu.my/course/overview.php?id=${courseId}`;
    const ovRes = await fetch(ovUrl, { credentials: 'include' });
    if (ovRes.ok && !ovRes.url.includes('/login/')) {
      const ovHtml = await ovRes.text();
      const regex = /href=["']([^"']*(?:attendance\/(?:view|take)\.php\?id=\d+|\/mod\/attendance\/view\.php\?id=\d+)[^"']*)["']/gi;
      let m;
      while ((m = regex.exec(ovHtml)) !== null) {
        addBackgroundAttUrl(m[1]);
      }
    }
  } catch (e) {}

  try {
    const indexUrl = `https://spectrum.um.edu.my/mod/attendance/index.php?id=${courseId}`;
    const idxRes = await fetch(indexUrl, { credentials: 'include' });
    if (idxRes.ok && !idxRes.url.includes('/login/')) {
      const idxHtml = await idxRes.text();
      const regex = /href=["']([^"']*(?:attendance\/(?:view|take)\.php\?id=\d+|view\.php\?id=\d+)[^"']*)["']/gi;
      let m;
      while ((m = regex.exec(idxHtml)) !== null) {
        addBackgroundAttUrl(m[1]);
      }
    }
  } catch (e) {}

  try {
    const courseUrl = `https://spectrum.um.edu.my/course/view.php?id=${courseId}`;
    const res = await fetch(courseUrl, { credentials: 'include' });
    if (res.ok && !res.url.includes('/login/')) {
      const html = await res.text();
      const sideRegex = /(?:class=["'][^"']*courseindex[^"']*["'][^>]*>[\s\S]*?)?href=["'](#(?:coursecontentcollapse|module-)\d+)["'][^>]*>(?:[\s\S]*?)(?:Attendance|Kehadiran|Kedatangan)/gi;
      let sMatch;
      while ((sMatch = sideRegex.exec(html)) !== null) {
        addBackgroundAttUrl(sMatch[1]);
      }
      const regex = /href=["']([^"']*(?:\/mod\/attendance\/(?:view|take)\.php\?id=\d+)[^"']*)["']/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        addBackgroundAttUrl(match[1]);
      }
    }
  } catch (e) {}

  if (attLinks.length === 0) return null;

  return await inspectLinks(attLinks);
}

// Robust Background Attendance Submitter:
// Dynamically fetches the live attendance form, parses all hidden QuickForm tokens & fields,
// submits via POST, and verifies real Moodle server confirmation before declaring success.
async function submitAttendance(takeUrl, statusId, sesskey, password = '', courseName = '') {
  try {
    if (!takeUrl) return false;
    let fullTakeUrl = takeUrl.startsWith('http') ? takeUrl : `https://spectrum.um.edu.my/mod/attendance/${takeUrl}`;
    fullTakeUrl = fullTakeUrl.replace(/&amp;/g, '&');

    await appendBackgroundLog('Attendance:AutoSubmit', `[${courseName || 'Class'}] Fetching live form from: ${fullTakeUrl}`);

    // 1. Fetch live form HTML from SPeCTRUM
    const formRes = await fetch(fullTakeUrl, { credentials: 'include', redirect: 'follow' });
    if (!formRes.ok || formRes.url.includes('/login/')) {
      await appendBackgroundLog('Attendance:AutoSubmit', `❌ HTTP ${formRes.status} or login redirect on ${fullTakeUrl}`);
      return false;
    }

    const formHtml = await formRes.text();

    // Check if attendance is already recorded on page
    if (/attendance has been recorded|kehadiran anda telah direkodkan|sudah direkod/i.test(formHtml) ||
        formHtml.includes('Your attendance in this session has been recorded')) {
      await appendBackgroundLog('Attendance:AutoSubmit', `ℹ️ Attendance was already recorded on page for ${courseName || 'class'}.`);
      return true;
    }

    // Extract form snippet
    let formSnippet = '';
    const formMatches = formHtml.match(/<form[\s\S]*?<\/form>/gi) || [];
    for (const f of formMatches) {
      if (f.includes('name="status"') || f.includes('attendance.php') || f.includes('take.php')) {
        formSnippet = f;
        break;
      }
    }
    if (!formSnippet && formMatches.length > 0) {
      formSnippet = formMatches[0];
    }
    if (!formSnippet) {
      formSnippet = formHtml;
    }

    // Extract form action URL
    const actionMatch = formSnippet.match(/action=["']([^"']+)["']/i);
    let postUrl = actionMatch ? actionMatch[1].replace(/&amp;/g, '&') : fullTakeUrl.split('?')[0];
    if (postUrl.startsWith('/')) postUrl = `https://spectrum.um.edu.my${postUrl}`;
    else if (!postUrl.startsWith('http')) postUrl = `https://spectrum.um.edu.my/mod/attendance/${postUrl}`;

    // Extract all hidden inputs (CRITICAL: Moodle QuickForm requires _qf__..., sesskey, sessid, etc.)
    const fields = {};
    const hiddenRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
    let hMatch;
    while ((hMatch = hiddenRegex.exec(formSnippet)) !== null) {
      const tag = hMatch[0];
      const nameM = tag.match(/name=["']([^"']+)["']/i);
      const valM = tag.match(/value=["']([^"']*)["']/i);
      if (nameM) {
        fields[nameM[1]] = valM ? valM[1] : '';
      }
    }

    // Ensure QuickForm token exists if not matched
    if (!Object.keys(fields).some(k => k.startsWith('_qf__'))) {
      fields['_qf__mod_attendance_student_attendance_form'] = '1';
    }

    // Fallbacks for sesskey and sessid if missing from hidden inputs
    if (!fields['sesskey']) {
      const skMatch = formHtml.match(/name="sesskey"\s+value="([^"]+)"/) || formHtml.match(/sesskey=([a-zA-Z0-9]+)/);
      if (skMatch) fields['sesskey'] = skMatch[1];
      else if (sesskey) fields['sesskey'] = sesskey;
    }
    if (!fields['sessid']) {
      const sidMatch = fullTakeUrl.match(/sessid=(\d+)/);
      if (sidMatch) fields['sessid'] = sidMatch[1];
    }

    // Find "Present" / "Hadir" status ID from live form
    let presentVal = statusId || '';
    if (!presentVal) {
      const radioRegex = /<input[^>]+type=["']radio["'][^>]+name=["']status["'][^>]+value=["'](\d+)["'][^>]*>([\s\S]*?)<\/label>/gi;
      let rMatch;
      while ((rMatch = radioRegex.exec(formSnippet)) !== null) {
        const val = rMatch[1];
        const label = rMatch[2];
        if (/present|hadir|\b[PH]\b/i.test(label) || !presentVal) {
          presentVal = val;
          if (/present|hadir|\b[PH]\b/i.test(label)) break;
        }
      }
    }
    if (!presentVal) {
      const firstRadio = formSnippet.match(/<input[^>]+type=["']radio["'][^>]+name=["']status["'][^>]+value=["'](\d+)["']/i);
      if (firstRadio) presentVal = firstRadio[1];
    }

    if (!presentVal) {
      await appendBackgroundLog('Attendance:AutoSubmit', `❌ Could not find "Present" status radio in form for ${courseName || fullTakeUrl}`);
      return false;
    }

    fields['status'] = presentVal;
    fields['mform_isexpanded_id_general'] = '1';
    fields['submitbutton'] = 'Save changes';

    if (password) {
      const pwdNameM = formSnippet.match(/name=["'](studentpassword|password|qrpass)["']/i);
      const pwdFieldName = pwdNameM ? pwdNameM[1] : 'studentpassword';
      fields[pwdFieldName] = password;
    }

    // Construct form-data URLSearchParams
    const formData = new URLSearchParams();
    for (const k of Object.keys(fields)) {
      formData.append(k, fields[k]);
    }

    await appendBackgroundLog('Attendance:AutoSubmit', `▶ Submitting POST to ${postUrl} (status: ${presentVal}, tokens: ${Object.keys(fields).filter(k => k.startsWith('_qf__') || k === 'sesskey').join(',')})`);

    const res = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString(),
      credentials: 'include',
      redirect: 'follow'
    });

    const resText = await res.text();
    const finalUrl = res.url || '';

    // Verify ACTUAL Moodle confirmation
    const isSuccess = (finalUrl.includes('/mod/attendance/view.php') ||
                       /status:\s*(?:present|hadir)|attendance has been recorded|kehadiran anda telah direkodkan|sudah direkod|attendance has been taken/i.test(resText) ||
                       resText.includes('Your attendance in this session has been recorded')) &&
                      !finalUrl.includes('/login/');

    if (isSuccess) {
      await appendBackgroundLog('Attendance:AutoSubmit', `✅ Verified attendance recorded on SPeCTRUM! (Redirected to: ${finalUrl})`);
      return true;
    } else {
      const errorMatch = resText.match(/class=["'][^"']*alert-danger[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                         resText.match(/class=["'][^"']*error[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      const errorMsg = errorMatch ? errorMatch[1].replace(/<[^>]+>/g, '').trim() : 'Moodle returned unconfirmed response (missing QuickForm or validation failed)';
      await appendBackgroundLog('Attendance:AutoSubmit', `⚠️ SPeCTRUM rejected auto-submission: ${errorMsg}`);
      return false;
    }
  } catch (err) {
    console.log('[SPeCTRUM Pro] Submit attendance error:', err?.message || err);
    await appendBackgroundLog('Attendance:AutoSubmit', `❌ Exception during auto-submit: ${err?.message || err}`);
    return false;
  }
}

// Show desktop alert notification
function showDesktopNotification(id, title, message) {
  try {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: title,
      message: message,
      priority: 2
    });
  } catch (e) {
    console.log('[SPeCTRUM Pro] Notification notice:', e?.message || e);
  }
}
