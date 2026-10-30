// SPeCTRUM Pro Background Service Worker (Manifest V3)
// Handles periodic background auto-attendance checks and desktop notifications

const ALARM_NAME = 'spectrum_auto_attendance_check';
const DEFAULT_INTERVAL_MINUTES = 15;

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
    
    // Limit to 12MB for preview payload
    const bufferSlice = arrayBuffer.byteLength > 12 * 1024 * 1024 
      ? arrayBuffer.slice(0, 12 * 1024 * 1024) 
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

    const isSuccess = finalUrl.includes('/mod/attendance/view.php') ||
                      /status:\s*(?:present|hadir)|attendance has been recorded|kehadiran anda telah direkodkan|sudah direkod/i.test(resText);

    console.log('[SPeCTRUM Pro Background] isSuccess check:', isSuccess, 'res.ok:', res.ok);

    if (isSuccess || res.ok) {
      const sessidMatch = (takeUrl || '').match(/sessid=(\d+)/);
      const sessid = sessidMatch ? sessidMatch[1] : '';
      const todayStr = new Date().toISOString().slice(0, 10);
      const stored = await chrome.storage.local.get({ lastAttendanceSubmissions: {} });
      const rec = stored.lastAttendanceSubmissions || {};
      if (sessid) rec[sessid] = todayStr;
      await chrome.storage.local.set({ lastAttendanceSubmissions: rec });
      console.log('[SPeCTRUM Pro Background] ✅ Attendance recorded in storage for session:', sessid);

      return { success: true };
    }

    return { success: false, error: 'Submission rejected by SPeCTRUM. Please check if password is correct.' };
  } catch (err) {
    console.error('[SPeCTRUM Pro Background] Submit error:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

// Notification click handler
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('attendance_')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?tab=tab-activities&sub=attendance') });
  }
});

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
    if (courses.length === 0) return { skipped: true, reason: 'No cached courses' };

    // Verify session by pinging SPeCTRUM
    const pingRes = await fetch('https://spectrum.um.edu.my/my/courses.php', { credentials: 'include' });
    if (!pingRes.ok || pingRes.url.includes('/login/')) {
      console.log('[SPeCTRUM Pro] User not currently logged in to SPeCTRUM. Skipping background check.');
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
        if (recordedSubmissions[cSessionKey] === todayStr) continue;

        if (cSess.requiresPassword) {
          requiredPins++;
          showDesktopNotification(
            `attendance_pin_${cSessionKey}`,
            `🔔 Attendance Open: ${ca.courseCode || ca.courseName || 'Class'}`,
            `Attendance is currently active for ${ca.courseName || 'your course'}. A password/PIN is required — click here to enter PIN!`
          );
        } else {
          const success = await submitAttendance(cSess.takeUrl, cSess.presentStatusId, cSess.sesskey);
          if (success) {
            newlySubmitted++;
            recordedSubmissions[cSessionKey] = todayStr;
            await chrome.storage.local.set({ lastAttendanceSubmissions: recordedSubmissions });
            showDesktopNotification(
              `attendance_success_${cSessionKey}`,
              `✅ Attendance Recorded (Present)!`,
              `Successfully marked attendance for ${ca.courseName || 'your course'}!`
            );
            try { chrome.runtime.sendMessage({ type: 'DATA_UPDATED' }); } catch (e) {}
          }
        }
      }
    }

    for (const course of courses) {
      if (!course.id) continue;
      const courseId = String(course.id);
      const userOcc = stored.courseOccs[courseId] || '';

      try {
        const attendanceInfo = await checkCourseAttendance(courseId, course.name, userOcc, hiddenAttendanceIds);
        if (!attendanceInfo || !attendanceInfo.activeSession) continue;

        const session = attendanceInfo.activeSession;
        const sessionKey = `${courseId}_${session.sessid || session.takeUrl}`;

        // Don't re-submit if already handled today
        const todayStr = new Date().toISOString().slice(0, 10);
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
          const success = await submitAttendance(session.takeUrl, session.presentStatusId, session.sesskey);
          if (success) {
            newlySubmitted++;
            recordedSubmissions[sessionKey] = todayStr;
            await chrome.storage.local.set({ lastAttendanceSubmissions: recordedSubmissions });

            showDesktopNotification(
              `attendance_success_${sessionKey}`,
              `✅ Attendance Recorded (Present)!`,
              `Successfully marked attendance for ${course.name}!`
            );

            try {
              chrome.runtime.sendMessage({ type: 'DATA_UPDATED' });
            } catch (e) {}
          }
        }
      } catch (err) {
        console.log(`[SPeCTRUM Pro] Background attendance check skipped for course ${courseId}:`, err?.message || err);
      }
    }

    return { success: true, newlySubmitted, requiredPins };

  } catch (error) {
    console.log('[SPeCTRUM Pro] Background attendance check notice:', error?.message || error);
    return { error: error.message };
  }
}

// Check attendance page for active sessions
async function checkCourseAttendance(courseId, courseName, userOcc, hiddenAttendanceIds = []) {
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

  // Strategy 1: Check /course/overview.php?id=${courseId} (Activities Overview)
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

  // Strategy 2: Check /mod/attendance/index.php?id=${courseId}
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

  // Strategy 3: Check course view page (sidelist & activity items)
  try {
    const courseUrl = `https://spectrum.um.edu.my/course/view.php?id=${courseId}`;
    const res = await fetch(courseUrl, { credentials: 'include' });
    if (res.ok && !res.url.includes('/login/')) {
      const html = await res.text();
      
      // Match sidelist anchors or items
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

  // Inspect each attendance link
  for (const attUrl of attLinks) {
    const fullAttUrl = attUrl.startsWith('http') ? attUrl : `https://spectrum.um.edu.my${attUrl}`;
    const idMatch = fullAttUrl.match(/id=(\d+)/);
    const cmid = idMatch ? idMatch[1] : '';
    const attId = `att_${courseId}_${cmid}`;
    if (hiddenAttendanceIds.includes(cmid) || hiddenAttendanceIds.includes(attId) || (idMatch && hiddenAttendanceIds.includes(idMatch[1]))) {
      continue;
    }
    const attRes = await fetch(fullAttUrl, { credentials: 'include' });
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
      // If course has other OCCs and doesn't match this user's OCC, skip
      if (hasOtherOcc && !occMatch) {
        continue;
      }
    }

    // Inspect the take attendance form
    const formRes = await fetch(fullTakeUrl, { credentials: 'include' });
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
    // Usually <input type="radio" name="status" value="123"> with label "Present" or "Hadir"
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
  }

  return null;
}

// Submit attendance
async function submitAttendance(takeUrl, statusId, sesskey, password = '') {
  try {
    const postUrl = takeUrl.split('?')[0];
    const sessidMatch = takeUrl.match(/sessid=(\d+)/);
    const sessid = sessidMatch ? sessidMatch[1] : '';

    const formData = new URLSearchParams();
    formData.append('sessid', sessid);
    formData.append('sesskey', sesskey);
    formData.append('status', statusId);
    formData.append('mform_isexpanded_id_general', '1');
    formData.append('submitbutton', 'Save changes');
    if (password) {
      formData.append('password', password);
    }

    const res = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString(),
      credentials: 'include'
    });

    return res.ok;
  } catch (err) {
    console.log('[SPeCTRUM Pro] Submit attendance notice:', err?.message || err);
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
