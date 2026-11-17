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
    const res = await fetchWithTimeout(`${origin}/my/courses.php`, { credentials: 'include', redirect: 'manual' }, 12000);
    if (!res || res.type === 'opaqueredirect' || !res.ok || (res.url && res.url.includes('/login/'))) {
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

    let userName = '';
    const nameMatch = html.match(/class="[^"]*usertext[^"]*"[^>]*>([^<]+)<\/span>/i) || html.match(/"userfullname":"([^"]+)"/);
    if (nameMatch) userName = nameMatch[1].trim();

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
          if (titleEl) name = (titleEl.innerText || titleEl.textContent || '').trim();
        }
        if (!name) name = (a.innerText || a.textContent || '').trim();
        name = name.replace(/^Course name\s*/i, '').trim();
        if (!name || /view course/i.test(name)) name = `Course ${id}`;

        seen.add(id);
        results.push({ id, name, url: a.href, isInProgress: true, isPast: false });
      }
    }

    const sorted = results.sort((a, b) => a.name.localeCompare(b.name));
    return { loggedIn: true, courses: sorted, allCourses: sorted, sesskey, userId, userName };
  } catch (err) {
    console.log('[SPeCTRUM Pro] Enrolled courses fetch note:', err?.message || err);
    return { loggedIn: false, courses: [] };
  }
}

// ========================================================
// 1B. Automated Course OCC Group Discovery
// Resolves student's enrolled OCC groups automatically:
// Tier 1: Batched Moodle WebService AJAX (core_group_get_course_user_groups) - 1 request for all courses
// Tier 2: Direct Course User Profile (/user/view.php?id={uid}&course={cid}) - no search needed
// Tier 3: Participants Page Search (/user/index.php?id={cid}&search={name}) - targeted fallback
// ========================================================

function extractOccNumberFromGroupText(str) {
  if (!str || typeof str !== 'string') return null;
  const clean = str.trim();
  // 1. Explicit OCC matches: "OCC 1", "OCC01", "OCC-2", "OCC_3", "OCC4"
  const mOcc = clean.match(/\bOCC[-_\s]*0*(\d{1,2})\b/i);
  if (mOcc) return String(parseInt(mOcc[1], 10));

  // 2. Group / Kumpulan matches: "Group 1", "Kumpulan 02", "KUMP 3", "Grp 4"
  const mGrp = clean.match(/\b(?:group|kumpulan|kump|grp)[-_\s]*0*(\d{1,2})\b/i);
  if (mGrp) return String(parseInt(mGrp[1], 10));

  // 3. Fallback: If string contains "OCC" anywhere with numbers
  if (/occ/i.test(clean)) {
    const mNum = clean.match(/\d+/);
    if (mNum) return String(parseInt(mNum[0], 10));
  }
  return null;
}

async function fetchUserCourseOccs(courses, options = {}) {
  const origin = SPECTRUM_ORIGIN;
  const parser = new DOMParser();
  const results = {}; // courseId -> occ string (e.g. "1")
  if (!Array.isArray(courses) || courses.length === 0) return results;

  let sesskey = options.sesskey || '';
  let userId = options.userId || 0;
  let userName = options.userName || '';

  // 1. Ensure we have sesskey, userId, and userName from /my/courses.php if not provided
  if (!sesskey || !userId || !userName) {
    try {
      const res = await fetchWithTimeout(`${origin}/my/courses.php`, { credentials: 'include', redirect: 'manual' }, 8000);
      if (res && res.type !== 'opaqueredirect' && res.ok && (!res.url || !res.url.includes('/login/'))) {
        const html = await res.text();
        if (!sesskey) {
          const sMatch = html.match(/"sesskey":"([^"]+)"/) || html.match(/sesskey=([a-zA-Z0-9]+)/);
          if (sMatch) sesskey = sMatch[1];
        }
        if (!userId) {
          const uMatch = html.match(/"userId":(\d+)/i) || html.match(/"userid":(\d+)/i);
          if (uMatch) userId = parseInt(uMatch[1], 10);
        }
        if (!userName) {
          const nMatch = html.match(/class="[^"]*usertext[^"]*"[^>]*>([^<]+)<\/span>/i) ||
                        html.match(/"userfullname":"([^"]+)"/);
          if (nMatch) userName = nMatch[1].trim();
        }
      }
    } catch (e) {
      console.log('[OCC:Discovery] Note fetching user session:', e?.message || e);
    }
  }

  const pendingCourses = courses.filter(c => c && c.id && /^\d+$/.test(String(c.id)));
  if (pendingCourses.length === 0) return results;

  // -------------------------------------------------------------
  // TIER 1: Batched Moodle AJAX Service (core_group_get_course_user_groups)
  // 1 single HTTP request queries ALL courses simultaneously!
  // -------------------------------------------------------------
  if (sesskey && userId) {
    try {
      const requests = pendingCourses.map((c, idx) => ({
        index: idx,
        methodname: 'core_group_get_course_user_groups',
        args: {
          courseid: parseInt(c.id, 10),
          userid: parseInt(userId, 10)
        }
      }));

      const ajaxRes = await fetchWithTimeout(`${origin}/lib/ajax/service.php?sesskey=${sesskey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requests),
        credentials: 'include'
      }, 10000);

      if (ajaxRes.ok) {
        const data = await ajaxRes.json();
        if (Array.isArray(data)) {
          data.forEach((item, idx) => {
            const course = pendingCourses[idx];
            if (!course) return;
            const groups = item?.data?.groups;
            if (Array.isArray(groups) && groups.length > 0) {
              for (const g of groups) {
                const num = extractOccNumberFromGroupText(g.name);
                if (num) {
                  results[String(course.id)] = num;
                  break;
                }
              }
            }
          });
        }
      }
    } catch (e) {
      console.log('[OCC:Discovery] Tier 1 AJAX note:', e?.message || e);
    }
  }

  // -------------------------------------------------------------
  // TIER 2: Direct Course User Profile (/user/view.php?id={uid}&course={cid})
  // For any courses still unresolved, fetch the user's course profile card
  // -------------------------------------------------------------
  const remainingTier2 = pendingCourses.filter(c => !results[String(c.id)]);
  if (remainingTier2.length > 0 && userId) {
    const chunkSize = 4;
    for (let i = 0; i < remainingTier2.length; i += chunkSize) {
      const chunk = remainingTier2.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (course) => {
        try {
          const profileUrl = `${origin}/user/view.php?id=${userId}&course=${course.id}`;
          const res = await fetchWithTimeout(profileUrl, { credentials: 'include' }, 8000);
          if (res.ok && !res.url.includes('/login/')) {
            const html = await res.text();
            const doc = parser.parseFromString(html, 'text/html');
            const labelNodes = Array.from(doc.querySelectorAll('dt, th, .label, .contentnode strong'));
            for (const lbl of labelNodes) {
              if (/groups?|kumpulan/i.test(lbl.textContent || '')) {
                const valueEl = lbl.nextElementSibling || lbl.closest('dl, tr, div')?.querySelector('dd, td, .content');
                if (valueEl) {
                  const num = extractOccNumberFromGroupText(valueEl.textContent || '');
                  if (num) {
                    results[String(course.id)] = num;
                    return;
                  }
                }
              }
            }
          }
        } catch (e) {
          console.log(`[OCC:Discovery] Tier 2 profile note for course ${course.id}:`, e?.message || e);
        }
      }));
    }
  }

  // -------------------------------------------------------------
  // TIER 3: Participants Page Search (/user/index.php?id={cid}&search={name})
  // Resilient fallback: search participants by user's name
  // -------------------------------------------------------------
  const remainingTier3 = pendingCourses.filter(c => !results[String(c.id)]);
  if (remainingTier3.length > 0 && userName) {
    const searchKw = userName.split(/\s+/).slice(0, 2).join(' ');
    const chunkSize = 3;
    for (let i = 0; i < remainingTier3.length; i += chunkSize) {
      const chunk = remainingTier3.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (course) => {
        try {
          const partUrl = `${origin}/user/index.php?id=${course.id}&search=${encodeURIComponent(searchKw)}`;
          const res = await fetchWithTimeout(partUrl, { credentials: 'include' }, 8000);
          if (res.ok && !res.url.includes('/login/')) {
            const html = await res.text();
            const doc = parser.parseFromString(html, 'text/html');
            let targetTr = null;
            if (userId) {
              targetTr = doc.querySelector(`tr[data-uid="${userId}"], a[href*="id=${userId}"]`)?.closest('tr');
            }
            if (!targetTr) {
              const rows = Array.from(doc.querySelectorAll('tbody tr, table tr'));
              targetTr = rows.find(r => r.textContent.toLowerCase().includes(userName.toLowerCase()));
            }

            if (targetTr) {
              const groupCell = targetTr.querySelector('.groups, td[class*="group"], td.c4, td.c3');
              if (groupCell) {
                const num = extractOccNumberFromGroupText(groupCell.textContent || '');
                if (num) {
                  results[String(course.id)] = num;
                  return;
                }
              }
            }
          }
        } catch (e) {
          console.log(`[OCC:Discovery] Tier 3 search note for course ${course.id}:`, e?.message || e);
        }
      }));
    }
  }

  return results;
}

// 2. Direct Course Materials Fetcher
async function fetchCourseMaterialsDirectly(courseId, allowedExts, materialsOnly) {
  try {
    const defaultExts = ['.pdf', '.pptx', '.zip', '.docx', '.xlsx', '.doc', '.ppt', '.txt'];
    const exts = (Array.isArray(allowedExts) && allowedExts.length > 0) ? allowedExts : defaultExts;
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
          const hasExt = exts.some(ext => lower.endsWith(ext) || lower.includes(ext + '?'));
          if (hasExt) type = 'direct_file';
        }

        if (type === 'unknown') continue;

        let title = '';
        const instanceEl = a.querySelector('.instancename');
        if (instanceEl) {
          const clone = instanceEl.cloneNode(true);
          clone.querySelectorAll('.accesshide').forEach(el => el.remove());
          title = (clone.innerText || clone.textContent || '').trim();
        }
        if (!title) title = (a.innerText || a.textContent || '').trim();
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

// 3. Direct Course Announcements Fetcher (Supports multi-forum scanning & embedded exam announcements)
async function fetchCourseAnnouncements(courseId, courseCode, courseName, minTimestamp = 0) {
  const announcements = [];
  const origin = SPECTRUM_ORIGIN;
  const parser = new DOMParser();
  const now = new Date();

  try {
    const courseRes = await fetchWithTimeout(`${origin}/course/view.php?id=${courseId}`, { credentials: 'include' }, 12000);
    if (!courseRes.ok || courseRes.url.includes('/login/') || courseRes.url.includes('microsoftonline.com')) return [];

    const courseHtml = await courseRes.text();
    const courseDoc = parser.parseFromString(`<base href="${origin}/">${courseHtml}`, 'text/html');

    // Find all forum / announcement links (e.g. Announcements forum, Week 7 Mid Sem Exam forum)
    const allLinks = Array.from(courseDoc.querySelectorAll('a[href*="/mod/forum/view.php?id="]'));
    const forumUrlsToScan = [];
    const seenForumIds = new Set();

    for (const a of allLinks) {
      let href = a.getAttribute('href') || a.href;
      if (href.startsWith('/')) href = `${origin}${href}`;
      const fMatch = href.match(/id=(\d+)/);
      const fId = fMatch ? fMatch[1] : href;
      if (seenForumIds.has(fId)) continue;

      const text = (a.innerText || a.getAttribute('title') || '').trim();
      if (/announcement|pengumuman|news|notis|makluman|exam|peperiksaan|mid[\s-]?sem|test|ujian|assessment/i.test(text)) {
        seenForumIds.add(fId);
        forumUrlsToScan.push({ url: href, name: text });
      }
    }

    if (forumUrlsToScan.length === 0 && allLinks.length > 0) {
      let firstHref = allLinks[0].getAttribute('href') || allLinks[0].href;
      if (firstHref.startsWith('/')) firstHref = `${origin}${firstHref}`;
      forumUrlsToScan.push({ url: firstHref, name: 'Announcements' });
    }

    // Limit to scanning at most 4 forums per course to keep network fast
    const targetForums = forumUrlsToScan.slice(0, 4);

    for (const fItem of targetForums) {
      try {
        const forumRes = await fetchWithTimeout(fItem.url, { credentials: 'include' }, 10000);
        if (!forumRes.ok) continue;

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

          // Filter out stale announcements (> 120 days old or past minTimestamp)
          if (minTimestamp && timestamp < minTimestamp) continue;
          if ((now.getTime() - timestamp) > 120 * 24 * 3600 * 1000) continue;

          // Check if announcement or title carries an exam / test notice
          let isExamNotice = false;
          let examDate = null;
          let examTimeStr = '';
          const examDetails = extractExamDetails(title, '', now);
          if (examDetails && !examDetails.stale) {
            isExamNotice = true;
            examDate = examDetails.parsedDate;
            examTimeStr = examDetails.extractedTimeStr;
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
            unread: isUnread,
            isExamNotice,
            examDate,
            examTimeStr
          });
        }
      } catch (fErr) {
        console.log(`[SPeCTRUM Pro] Note reading forum ${fItem.url}:`, fErr?.message || fErr);
      }
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

        // Skip stale past semester assignments (> 120 days old or prior academic session)
        if (isPastSemesterStale(parsedMeta.dueDate, title, now, courseName)) {
          logDiag('Sync:Assign', `[${courseCode || courseId}] ⏭ Skipping stale assignment "${title}" (Due: ${dueDateStr || 'None'})`);
          continue;
        }

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

        // Skip stale past semester quizzes (> 120 days old or prior academic session)
        if (isPastSemesterStale(parsedMeta.dueDate, title, now, courseName)) {
          logDiag('Sync:Assign', `[${courseCode || courseId}] ⏭ Skipping stale quiz "${title}" (Due: ${dueDateStr || 'None'})`);
          continue;
        }

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
      // Only scrape genuine Assignment and Quiz modules (do NOT scrape arbitrary mod/url or mod/page study materials)
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
        const contextText = `${title} ${parentActivity ? (parentActivity.textContent || '') : ''}`;

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

        // Try extracting embedded date from title/context (e.g. "Quiz Link (04.11.2026)")
        if (!dueDateStr) {
          const examInfo = extractExamDetails(title, contextText, now);
          if (examInfo && !examInfo.stale) {
            dueDateStr = `${examInfo.extractedDateStr} ${examInfo.extractedTimeStr}`.trim();
          }
        }

        // Extract inline description/instructions if present on course page
        let contentHtml = '';
        let contentText = '';
        if (parentActivity) {
          const descEl = parentActivity.querySelector('.contentwithoutlink, .activity-description, .no-overflow');
          if (descEl) {
            const clone = descEl.cloneNode(true);
            clone.querySelectorAll('.accesshide, .sr-only, input, label[for*="activity-select"], a[href*="#maincontent"], .activity-actions').forEach(el => el.remove());
            contentText = (typeof extractTextWithLineBreaks === 'function' ? extractTextWithLineBreaks(clone) : (clone.innerText || clone.textContent || '')).trim();
            contentHtml = clone.innerHTML.trim();
          }
        }
        const parsedExam = contentText ? (typeof parseStructuredTestDetails === 'function' ? parseStructuredTestDetails(contentText, title) : null) : null;

        // If dueDateStr is still missing, queue for detailed page inspection (limit to 15)
        if (!dueDateStr && itemsToInspect.length < 15) {
          itemsToInspect.push({ itemId, href, title, statusText });
        } else {
          const parsedMeta = calculateAssignmentTiming(dueDateStr, statusText, now, courseName);
          if (isPastSemesterStale(parsedMeta.dueDate, title, now, courseName)) {
            logDiag('Sync:Assign', `[${courseCode || courseId}] ⏭ Skipping stale course item "${title}"`);
            continue;
          }
          assignments.push({
            id: `assign_${courseId}_${itemId}`,
            courseId,
            courseCode,
            courseName,
            title,
            url: href,
            contentHtml: contentHtml || undefined,
            contentText: contentText || undefined,
            parsedExam: parsedExam || undefined,
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

              let contentHtml = '';
              let contentText = '';
              const introEl = itemDoc.querySelector('#intro, .quizinfo, [data-region="activity-information"], .generalbox');
              if (introEl) {
                const clone = introEl.cloneNode(true);
                clone.querySelectorAll('.accesshide, .sr-only, input, label[for*="activity-select"], a[href*="#maincontent"], .activity-actions').forEach(el => el.remove());
                contentText = (typeof extractTextWithLineBreaks === 'function' ? extractTextWithLineBreaks(clone) : (clone.innerText || clone.textContent || '')).trim();
                contentHtml = clone.innerHTML.trim();
              }
              const parsedExam = contentText ? (typeof parseStructuredTestDetails === 'function' ? parseStructuredTestDetails(contentText, item.title) : null) : null;

              const parsedMeta = calculateAssignmentTiming(dStr, sStr, now, courseName);
              if (isPastSemesterStale(parsedMeta.dueDate, item.title, now, courseName)) {
                logDiag('Sync:Assign', `[${courseCode || courseId}] ⏭ Skipping stale detail item "${item.title}"`);
                return;
              }
              assignments.push({
                id: `assign_${courseId}_${item.itemId}`,
                courseId,
                courseCode,
                courseName,
                title: item.title,
                url: item.href,
                contentHtml: contentHtml || undefined,
                contentText: contentText || undefined,
                parsedExam: parsedExam || undefined,
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

      // Scan embedded test / exam notices in course labels / summary blocks (e.g. TEST 1 (25%))
      const labelEls = doc.querySelectorAll('.activity.label, li.label, .modtype_label, div[data-activityname*="label"], .modtype_label .activity-item, li[data-for="cmitem"].modtype_label, li[data-for="cmitem"].label');
      for (const lbl of Array.from(labelEls)) {
        // Target content container to avoid Moodle bulk edit checkboxes, accessibility skip links, etc.
        const contentEl = lbl.querySelector('.contentwithoutlink, .activity-description, .no-overflow') || lbl;
        const clone = contentEl.cloneNode(true);
        // Clean out accessibility text, screen reader skip links, bulk edit checkboxes
        clone.querySelectorAll('.accesshide, .sr-only, input, label[for*="activity-select"], a[href*="#maincontent"], .activity-actions').forEach(el => el.remove());

        const text = (typeof extractTextWithLineBreaks === 'function' ? extractTextWithLineBreaks(clone) : (clone.innerText || clone.textContent || '')).trim();
        if (!text || text.length < 15) continue;
        const examInfo = extractExamDetails('', text, now);
        if (examInfo && !examInfo.stale) {
          const firstLine = text.split(/\r?\n/)[0].replace(/^(?:Select activity|Bulk edit|Activity)\s+/i, '').replace(/[:\-_]+$/, '').trim();
          const lblTitle = firstLine.length > 5 && firstLine.length < 80 ? firstLine : 'Upcoming Test / Exam';
          const moduleAnchor = findCourseModuleAnchor(lbl, doc, lblTitle);
          const lblCleanId = lblTitle.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
          const uniqueId = `lbl_${moduleAnchor || lbl.getAttribute('id') || lblCleanId}`;
          if (seenAssignIds.has(uniqueId)) continue;
          seenAssignIds.add(uniqueId);

          const parsedMeta = calculateAssignmentTiming(`${examInfo.extractedDateStr} ${examInfo.extractedTimeStr}`.trim(), 'Upcoming Test', now, courseName);
          if (isPastSemesterStale(parsedMeta.dueDate, lblTitle, now, courseName)) continue;

          const itemUrl = moduleAnchor 
            ? `${origin}/course/view.php?id=${courseId}#${moduleAnchor}`
            : `${origin}/course/view.php?id=${courseId}`;

          const parsedExam = typeof parseStructuredTestDetails === 'function' ? parseStructuredTestDetails(text, lblTitle) : null;

          assignments.push({
            id: `label_exam_${courseId}_${uniqueId}`,
            courseId,
            courseCode,
            courseName,
            title: lblTitle,
            url: itemUrl,
            moduleAnchor: moduleAnchor || '',
            isNotice: true,
            isTestNotice: true,
            contentHtml: clone.innerHTML,
            contentText: text,
            parsedExam: parsedExam,
            dueDateStr: `${examInfo.extractedDateStr} ${examInfo.extractedTimeStr}`.trim(),
            dueDate: examInfo.parsedDate,
            statusText: 'Upcoming Test',
            isSubmitted: false,
            isOverdue: examInfo.parsedDate.getTime() < now.getTime(),
            isDueSoon: (examInfo.parsedDate.getTime() - now.getTime()) <= 72 * 3600 * 1000 && examInfo.parsedDate.getTime() >= now.getTime(),
            timeRemaining: parsedMeta.timeRemaining,
            badgeClass: 'badge-due-warning',
            badgeLabel: '📝 Test'
          });
          logDiag('Sync:Assign', `[${courseCode || courseId}] 🎯 Discovered embedded test notice: "${lblTitle}" on ${examInfo.extractedDateStr} -> ${itemUrl}`);
        }
      }
    }
  } catch (err) {
    console.log(`[SPeCTRUM Pro] Course view assignments note for course ${courseId}:`, err);
  }

  return assignments;
}

// Finds the Moodle module anchor (#module-XXXXX) for a course element or label
function findCourseModuleAnchor(el, doc, title = '') {
  if (!el) return '';
  // 1. Direct ID on the element
  if (el.id && /^module-\d+/i.test(el.id)) return el.id;

  // 2. Closest parent module container (Moodle uses <li class="activity label" id="module-1149921">)
  const parentMod = el.closest ? el.closest('[id^="module-"]') : null;
  if (parentMod && parentMod.id) return parentMod.id;

  // 3. data-id or data-cmid on element or its closest activity container
  const dataId = (el.getAttribute && el.getAttribute('data-id')) || 
                 (el.closest && el.closest('[data-id]')?.getAttribute('data-id'));
  if (dataId && /^\d+$/.test(dataId)) return `module-${dataId}`;

  const cmId = (el.getAttribute && el.getAttribute('data-cmid')) || 
               (el.closest && el.closest('[data-cmid]')?.getAttribute('data-cmid'));
  if (cmId && /^\d+$/.test(cmId)) return `module-${cmId}`;

  // 4. Child or internal elements with id/name/href matching module-XXXX
  if (el.querySelector) {
    const internalEl = el.querySelector('[id^="module-"], a[href*="#module-"], a[name^="module-"]');
    if (internalEl) {
      if (internalEl.id && /^module-\d+/i.test(internalEl.id)) return internalEl.id;
      const nameAttr = internalEl.getAttribute('name');
      if (nameAttr && /^module-\d+/i.test(nameAttr)) return nameAttr;
      const hrefAttr = internalEl.getAttribute('href') || '';
      const m = hrefAttr.match(/#(module-\d+)/i);
      if (m) return m[1];
    }
  }

  // 5. Match against Moodle 4 course index links in the sidebar
  if (doc && title && doc.querySelectorAll) {
    const cleanT = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanT.length >= 3) {
      const indexLinks = doc.querySelectorAll('.courseindex-link, [data-for="cm_name"], a[href*="#module-"]');
      for (const link of Array.from(indexLinks)) {
        const linkText = (link.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (linkText && (linkText.includes(cleanT) || cleanT.includes(linkText) || (cleanT.startsWith('test') && linkText.startsWith('test')))) {
          const href = link.getAttribute('href') || '';
          const m = href.match(/#(module-\d+)/i);
          if (m) return m[1];
          const lDataId = link.getAttribute('data-id') || (link.closest && link.closest('[data-id]')?.getAttribute('data-id'));
          if (lDataId) return `module-${lDataId}`;
        }
      }
    }
  }

  // 6. Search for any activity element in doc whose text matches title
  if (doc && title && doc.querySelectorAll) {
    const cleanT = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanT.length >= 3) {
      const candidates = doc.querySelectorAll('.activity, li.label, .modtype_label, .activity-item, li[data-for="cmitem"]');
      for (const act of Array.from(candidates)) {
        const actText = (act.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (actText.includes(cleanT)) {
          const mId = act.id || act.closest?.('[id^="module-"]')?.id;
          if (mId && /^module-\d+/i.test(mId)) return mId;
          const dId = act.getAttribute('data-id') || act.closest?.('[data-id]')?.getAttribute('data-id');
          if (dId && /^\d+$/.test(dId)) return `module-${dId}`;
          const cId = act.getAttribute('data-cmid') || act.closest?.('[data-cmid]')?.getAttribute('data-cmid');
          if (cId && /^\d+$/.test(cId)) return `module-${cId}`;
        }
      }
    }
  }

  // 7. Fallback: closest section container
  const parentSec = el.closest ? el.closest('[id^="section-"]') : null;
  if (parentSec && parentSec.id) return parentSec.id;

  return '';
}

// Parses structured test, mid-sem, quiz, or exam metadata (date, time, venue, platform, topic, format, duration)
function parseStructuredTestDetails(rawText = '', title = '') {
  if (!rawText && !title) return null;
  let full = `${title || ''}\n${rawText || ''}`
    .replace(/Skip to main content/gi, '')
    .replace(/Select activity\s*/gi, '')
    .replace(/Bulk action\s*/gi, '')
    .trim();
  if (!full) return null;

  const lines = full.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result = {
    title: (title || '').replace(/^(?:Select activity|Bulk edit|Activity)\s+/i, '').trim(),
    date: '',
    time: '',
    duration: '',
    venue: '',
    platform: '',
    format: '',
    topic: '',
    weightage: ''
  };

  // 1. Weightage
  const wMatch = full.match(/\((\d{1,2}%)\)/) || full.match(/(?:weightage|pemberat|percentage|peratus)[:\s]+(\d{1,2}%)/i) || full.match(/\b(\d{1,2}%)\b/);
  if (wMatch) result.weightage = wMatch[1];

  // 2. Line-by-line structured scan
  for (const line of lines) {
    if (!result.date) {
      const m = line.match(/^(?:date|tarikh|date of exam|date of test)[:\s]+([^\n\r]+)/i);
      if (m) result.date = m[1].replace(/[:\-_]+$/, '').trim();
    }
    if (!result.time) {
      const m = line.match(/^(?:time open|time|masa buka|masa|waktu)[:\s]+([^\n\r]+)/i);
      if (m) result.time = m[1].replace(/[:\-_]+$/, '').trim();
    }
    if (!result.duration) {
      const m = line.match(/^(?:duration|tempoh|time limit|masa menjawab)[:\s]+([^\n\r]+)/i);
      if (m) result.duration = m[1].replace(/[:\-_]+$/, '').trim();
    }
    if (!result.venue) {
      const m = line.match(/^(?:venue|location|tempat|lokasi|bilik|dewan)[:\s]+([^\n\r]+)/i);
      if (m) result.venue = m[1].replace(/[:\-_]+$/, '').trim();
    }
    if (!result.platform) {
      const m = line.match(/^(?:platform|saluran|portal)[:\s]+([^\n\r]+)/i);
      if (m) result.platform = m[1].replace(/[:\-_]+$/, '').trim();
    }
    if (!result.format) {
      const m = line.match(/^(?:format|type|bentuk soalan|jenis soalan)[:\s]+([^\n\r]+)/i);
      if (m) result.format = m[1].replace(/[:\-_]+$/, '').trim();
    }
    if (!result.topic) {
      const m = line.match(/^(?:topic|scope|syllabus|topik|skop|sukatan|coverage|bab)[:\s]+([^\n\r]+)/i);
      if (m) result.topic = m[1].replace(/[:\-_]+$/, '').trim();
    }
  }

  // 3. Fallbacks from sentence patterns
  if (!result.date) {
    const m = full.match(/(?:held on|held|taking place on|takes place on|exam on|test on)\s+([A-Za-z]+,?\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s*20\d{2})/i) ||
              full.match(/(?:held on|held|taking place on|takes place on|exam on|test on)\s+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i) ||
              full.match(/\bopen on\s+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i) ||
              full.match(/\b(open\s+on\s+[A-Za-z]+,?\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s*20\d{2})/i);
    if (m) result.date = (m[1] || '').replace(/^open\s+on\s+/i, '').trim();
  }

  if (!result.time) {
    const m = full.match(/(?:from|dari)\s+([0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm)?\s*(?:until|to|hingga|[-–—])\s*[0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm)?)/i) ||
              full.match(/\b([0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm)\s*[-–—to]\s*[0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm))\b/i);
    if (m) result.time = m[1].trim();
  }

  if (!result.duration) {
    const m = full.match(/\b(\d+\s*(?:minutes?|mins?|hours?|jam|minit))\b/i);
    if (m) result.duration = m[1].trim();
  }

  if (!result.venue && !result.platform) {
    const m = full.match(/\b(Spectrum\s*Exam|SPeCTRUM|DK\s*\d+|Dewan\s+[^\n\r,]+|Lab\s*\d+|Makmal\s+[^\n\r,]+|Auditorium\s*[^\n\r,]*|Online)\b/i);
    if (m) result.venue = m[1].trim();
  }

  if (!result.format) {
    const m = full.match(/\b(\d+\s*(?:MCQs?|Multiple Choice Questions?|Soalan Objektif))\b/i) ||
              full.match(/\b(Multiple Choice|MCQs?|Objective|Short Answer|Essay|Struktur|Esei)\b/i);
    if (m) result.format = m[1].trim();
  }

  if (!result.topic) {
    const m = full.match(/\b(?:covers?|covering)\s+((?:Week|Minggu|Chapter|Bab)\s*[\d\s\-–—to,]+)/i);
    if (m) result.topic = m[1].trim();
  }

  const hasDetails = Boolean(result.date || result.time || result.duration || result.venue || result.platform || result.format || result.topic);
  return hasDetails ? result : null;
}

// Clean date and time text: strip ordinal suffixes (26th -> 26), normalize dashes and a.m./p.m.
function cleanDateText(str) {
  if (!str) return '';
  return String(str)
    .replace(/(\b\d{1,2})(?:st|nd|rd|th)\b/gi, '$1')
    .replace(/[\u2013\u2014~]/g, '-')
    .replace(/a\.m\./gi, 'AM')
    .replace(/p\.m\./gi, 'PM')
    .trim();
}

// Determines if an assignment, quiz, or announcement is from a past semester
function isPastSemesterStale(dueDate, title = '', now = new Date(), courseName = '') {
  // 1. If dueDate is known and valid:
  if (dueDate && !isNaN(dueDate.getTime())) {
    const diffDays = (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24);
    // If deadline passed more than 90 days ago (~3 months / prior semester), it's stale
    if (diffDays > 90) return true;
    // If due in a past year (e.g. 2025 or earlier when current year is 2026)
    if (dueDate.getFullYear() < now.getFullYear()) return true;
  }

  // 2. Explicit past academic session in title vs current course session
  // e.g. "MID SEM TEST SEM 1, 2025/2026"
  const titleSessMatch = (title || '').match(/\b20(\d{2})\/20(\d{2})\b/);
  if (titleSessMatch) {
    const itemEndYear = 2000 + parseInt(titleSessMatch[2], 10);
    const courseSessMatch = (courseName || '').match(/\b20(\d{2})\/20(\d{2})\b/);
    if (courseSessMatch) {
      const courseEndYear = 2000 + parseInt(courseSessMatch[2], 10);
      if (itemEndYear < courseEndYear) return true;
    } else {
      if (itemEndYear <= now.getFullYear()) return true;
    }
  }

  // 3. Explicit old year pattern in title (e.g. "2025" or earlier when now is 2026)
  const oldYearMatch = (title || '').match(/\b(20[12][0-9])\b/);
  if (oldYearMatch) {
    const y = parseInt(oldYearMatch[1], 10);
    if (y < now.getFullYear()) return true;
  }

  // 4. Stale weekly quizzes with no deadline from early weeks (e.g. Week 1 to 4) when semester is in Week 7+
  if (!dueDate || isNaN(dueDate.getTime())) {
    const weekMatch = (title || '').match(/\bweek\s*0?([1-4])\b/i);
    if (weekMatch && (now.getMonth() >= 10 || now.getMonth() <= 1)) {
      return true;
    }
  }

  return false;
}

// Edge case helper: if a deadline is set to exactly 00:00 (midnight), in student practice it belongs to 23:59 of the day before
function normalizeMidnightDeadline(d) {
  if (!d || isNaN(d.getTime())) return d;
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    return new Date(d.getTime() - 60 * 1000); // 23:59:00 of day before
  }
  return d;
}

// Intelligent Moodle Date Parser with Multi-Language (EN/BM) & Academic Year Inference
function parseMoodleDate(str, courseName = '', now = new Date()) {
  if (!str) return null;
  let clean = String(str).replace(/[\u00a0\s]+/g, ' ').trim();
  clean = clean.replace(/^(Due|Opened|Due date|Tarikh akhir|Tarikh tutup|Tarikh tamat|Tarikh serahan|Tarikh hantar|Closing date|Session|Tarikh|Closes|Closed|Buka|Tutup|Deadline|Ends|Cut-off date):\s*/i, '').trim();
  if (!clean || clean === '-' || /none|no due|no deadline|tiada/i.test(clean)) return null;

  // Normalize en/em-dashes, tildes, and dots in a.m./p.m.
  clean = clean.replace(/[\u2013\u2014~]/g, '-');
  clean = clean.replace(/a\.m\./gi, 'AM').replace(/p\.m\./gi, 'PM');

  // Strip English ordinal suffixes (e.g. 26th -> 26, 1st -> 1, 2nd -> 2, 3rd -> 3)
  clean = clean.replace(/(\b\d{1,2})(?:st|nd|rd|th)\b/gi, '$1');

  // If string contains embedded close/due marker (e.g. 'Opens: ... Closes: ...')
  const closeSubMatch = clean.match(/(?:Due|Tarikh akhir|Tarikh tutup|Tarikh tamat|Tarikh hantar|Closes|Closed|Tutup|Deadline):\s*([^\n\r]+)/i);
  if (closeSubMatch) {
    clean = closeSubMatch[1].trim();
  }

  // If string contains a date range e.g. "12 October - 18 October" or "12 - 18 October", extract the ending deadline
  // Guard against time ranges like "8.00 AM - 10.00 AM", "8.00 pagi - 10.00 pagi", or "08:00 - 10:00"
  const rangeMatch = clean.match(/\s+[-–]\s+([0-9]{1,2}[^\n\r]*)$/);
  if (rangeMatch) {
    const candidate = rangeMatch[1].trim();
    const isTime = /\b(?:am|pm|pagi|petang|malam)\b/i.test(candidate) || /^\d{1,2}[:.]\d{2}/.test(candidate);
    const hasMonth = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Januari|Februari|Mac|Mei|Jun|Julai|Ogos|Oktober|Disember)\b/i.test(candidate);
    const hasFullDate = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(candidate);
    if (!isTime && (hasMonth || hasFullDate)) {
      clean = candidate;
    }
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
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins, 0);
    return normalizeMidnightDeadline(d);
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
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hours, mins, 0);
    return normalizeMidnightDeadline(d);
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
  clean = clean.replace(/(^|[^\d:])(\d{1,2})\s*(AM|PM)/gi, '$1$2:00 $3');

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
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return normalizeMidnightDeadline(d);
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
      if (!isNaN(d.getTime())) return normalizeMidnightDeadline(d);
    }
  }

  // 7. Pattern B: Explicit 4-digit year already present (e.g. 23 Oct 2026, 9 January 2026)
  const explicitYearMatch = clean.match(/\b(20\d{2})\b/);
  if (explicitYearMatch) {
    const p = Date.parse(clean);
    if (!isNaN(p)) {
      const d = new Date(p);
      if (d.getFullYear() >= 2020) return normalizeMidnightDeadline(d);
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
      return normalizeMidnightDeadline(parsedDate);
    }
  }

  return null;
}

// Intelligent Assessment/Exam notice extractor from unstructured text / labels / notices
function extractExamDetails(title = '', content = '', now = new Date()) {
  const fullText = `${title || ''}\n${content || ''}`;

  // 1. Assessment keyword check: test, mid-sem, exam, quiz, assessment, etc.
  const isAssessment = /test\s*\d|mid[\s-]?sem|examination|peperiksaan|ujian\s*\d|quiz|kuiz|assessment|pentaksiran|final\s*exam/i.test(fullText);
  if (!isAssessment) return null;

  let extractedDateStr = '';
  let extractedTimeStr = '';

  const lines = fullText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Line-by-line scan for structured key-value pairs (e.g. Date: 26th November 2026)
  for (const line of lines) {
    if (!extractedDateStr) {
      const mDateLine = line.match(/^(?:Date|Tarikh|Date of Exam|Date of Test)[:\s]+([^\n\r]+)/i);
      if (mDateLine) {
        extractedDateStr = mDateLine[1].trim();
      }
    }
    if (!extractedTimeStr) {
      const mTimeLine = line.match(/^(?:Time Open|Time|Masa|Masa Buka|Window|Duration)[:\s]+([^\n\r]+)/i);
      if (mTimeLine) {
        extractedTimeStr = mTimeLine[1].trim();
      }
    }
  }

  // Sentence-level regex fallback (e.g. "held on Thursday, 19 Nov, 2026" or "open on 26/11/2026")
  if (!extractedDateStr) {
    const mSentence = fullText.match(/(?:held on|held|taking place on|takes place on|on|pada)\s+([A-Za-z]+,?\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s*20\d{2})/i) ||
                      fullText.match(/(?:held on|held|taking place on|takes place on|on|pada)\s+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i) ||
                      fullText.match(/\bopen on\s+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
    if (mSentence) {
      extractedDateStr = mSentence[1].trim();
    }
  }

  // Title-embedded date fallback (e.g. "Quiz Link (04.11.2026)" or "Test (15 Oct 2026)")
  if (!extractedDateStr) {
    const mTitleDate = (title || '').match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/) ||
                       (title || '').match(/(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:,?\s*20\d{2})?)/i);
    if (mTitleDate) {
      extractedDateStr = mTitleDate[1].trim();
    }
  }

  if (!extractedDateStr) return null;

  // Time extraction from sentence if line didn't catch it
  if (!extractedTimeStr) {
    const mTime = fullText.match(/(?:from|dari)\s+([0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm|a\.m\.|p\.m\.)?\s*(?:until|to|hingga|[-–—])\s*[0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm|a\.m\.|p\.m\.)?)/i) ||
                  fullText.match(/\b([0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm|a\.m\.|p\.m\.)?\s*[-–—to]\s*[0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm|a\.m\.|p\.m\.)?)\b/i);
    if (mTime) {
      extractedTimeStr = mTime[1].trim();
    }
  }

  const cleanDate = cleanDateText(extractedDateStr);
  const cleanTime = cleanDateText(extractedTimeStr);

  const parsedDate = parseMoodleDate(`${cleanDate} ${cleanTime}`.trim(), '', now) || parseMoodleDate(cleanDate, '', now);
  if (!parsedDate || isNaN(parsedDate.getTime())) return null;

  const stale = isPastSemesterStale(parsedDate, title, now);

  return {
    stale,
    parsedDate,
    extractedDateStr: cleanDate,
    extractedTimeStr: cleanTime || ''
  };
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

// 4b. Parse official summary stats table (from view=5 "All" view)
function parseAttendanceSummaryStats(doc, html = '', sessions = []) {
  const text = (doc?.body?.textContent || html || '').replace(/\s+/g, ' ');

  let takenSessions = null;
  let pointsOverTaken = '';
  let percentageOverTaken = '';
  let totalSessions = null;
  let pointsOverAll = '';
  let percentageOverAll = '';
  let maxPoints = '';
  let maxPercentage = '';

  // 1. Precise DOM table parsing from Moodle's summary table (e.g. table.attwidth, table.generaltable)
  if (doc && typeof doc.querySelectorAll === 'function') {
    const rows = doc.querySelectorAll('table.generaltable tr, table.attwidth tr, table.attlist tr, table tr');
    rows.forEach(r => {
      const th = r.querySelector('th');
      const td = r.querySelector('td');
      if (th && td) {
        const label = (th.textContent || '').trim().replace(/\s+/g, ' ');
        const val = (td.textContent || '').trim().replace(/\s+/g, ' ');
        if (/taken sessions|sesi diambil/i.test(label) && takenSessions == null) {
          const m = val.match(/\d+/);
          if (m) takenSessions = parseInt(m[0], 10);
        } else if (/points over taken sessions|mata (?:ke )?atas sesi (?:yang )?diambil/i.test(label) && !pointsOverTaken) {
          pointsOverTaken = val;
        } else if (/percentage over taken sessions|peratusan (?:ke )?atas sesi diambil/i.test(label) && !percentageOverTaken) {
          percentageOverTaken = val.endsWith('%') ? val : val + '%';
        } else if (/total (?:number of )?sessions|jumlah sesi/i.test(label) && totalSessions == null) {
          const m = val.match(/\d+/);
          if (m) totalSessions = parseInt(m[0], 10);
        } else if (/points over all sessions|mata (?:ke )?atas semua sesi/i.test(label) && !pointsOverAll) {
          pointsOverAll = val;
        } else if (/percentage over all sessions|peratusan (?:ke )?atas semua sesi/i.test(label) && !percentageOverAll) {
          percentageOverAll = val.endsWith('%') ? val : val + '%';
        } else if (/max(?:imum)? possible points|maksimum mata/i.test(label) && !maxPoints) {
          maxPoints = val;
        } else if (/max(?:imum)? possible percentage|maksimum peratusan/i.test(label) && !maxPercentage) {
          maxPercentage = val.endsWith('%') ? val : val + '%';
        }
      }
    });
  }

  // 2. Text-level regex extraction fallback
  const getMatch = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };

  if (takenSessions == null) {
    const m = getMatch(/(?:taken sessions|sesi diambil)[:\t\s]+(\d+)/i);
    if (m) takenSessions = parseInt(m, 10);
  }
  if (!pointsOverTaken) {
    const m = getMatch(/(?:points over taken sessions|mata (?:ke )?atas sesi (?:yang )?diambil)[:\t\s]+([\d\.\s\/]+)/i);
    if (m) pointsOverTaken = m;
  }
  if (!percentageOverTaken) {
    const m = getMatch(/(?:percentage over taken sessions|peratusan (?:ke )?atas sesi diambil)[:\t\s]+([\d\.]+\s*%?)/i);
    if (m) percentageOverTaken = m.endsWith('%') ? m : m + '%';
  }
  if (totalSessions == null) {
    const m = getMatch(/(?:total (?:number of )?sessions|jumlah sesi)[:\t\s]+(\d+)/i);
    if (m) totalSessions = parseInt(m, 10);
  }
  if (!pointsOverAll) {
    const m = getMatch(/(?:points over all sessions|mata (?:ke )?atas semua sesi)[:\t\s]+([\d\.\s\/]+)/i);
    if (m) pointsOverAll = m;
  }
  if (!percentageOverAll) {
    const m = getMatch(/(?:percentage over all sessions|peratusan (?:ke )?atas semua sesi)[:\t\s]+([\d\.]+\s*%?)/i);
    if (m) percentageOverAll = m.endsWith('%') ? m : m + '%';
  }
  if (!maxPoints) {
    const m = getMatch(/(?:max(?:imum)? possible points|maksimum mata(?: yang mungkin)?)[:\t\s]+([\d\.\s\/]+)/i);
    if (m) maxPoints = m;
  }
  if (!maxPercentage) {
    const m = getMatch(/(?:max(?:imum)? possible percentage|maksimum peratusan(?: yang mungkin)?)[:\t\s]+([\d\.]+\s*%?)/i);
    if (m) maxPercentage = m.endsWith('%') ? m : m + '%';
  }

  // 3. Count actual elapsed sessions from calendar dates (scheduled on or before today)
  const now = new Date();
  let pastSessionsList = [];
  let attendedSessionsList = [];

  if (Array.isArray(sessions) && sessions.length > 0) {
    pastSessionsList = sessions.filter(s => {
      if (s.isFuture) return false;
      let d = s.date instanceof Date ? s.date : (s.date ? new Date(s.date) : null);
      if (!d || isNaN(d.getTime())) {
        if (s.dateKey) d = new Date(s.dateKey + 'T23:59:59');
        else if (s.dateStr) d = parseMoodleDate(s.dateStr, '', now);
      }
      return d && !isNaN(d.getTime()) && d.getTime() <= now.getTime();
    });

    attendedSessionsList = pastSessionsList.filter(s => {
      return s.isPresent || /present|hadir|✔/i.test(s.status || s.statusLabel || '') || (s.points && /^[12]\s*\/\s*2/.test(s.points));
    });
  }

  // Real passed sessions = number of sessions whose scheduled date has elapsed (<= today)
  // Moodle's "taken sessions" table row only counts sessions where attendance was recorded, ignoring missed sessions!
  let passedSessions = pastSessionsList.length > 0 ? pastSessionsList.length : (takenSessions != null ? takenSessions : 0);
  let attendedSessions = pastSessionsList.length > 0 ? attendedSessionsList.length : null;

  if (attendedSessions == null && pointsOverTaken) {
    const m = pointsOverTaken.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const earned = parseFloat(m[1]);
      attendedSessions = Math.round(earned / 2);
    }
  }

  if (attendedSessions == null && percentageOverTaken && passedSessions > 0) {
    attendedSessions = Math.round((parseFloat(percentageOverTaken) / 100) * passedSessions);
  }

  if (attendedSessions == null) {
    attendedSessions = passedSessions;
  }

  // When session calendar dates exist, calculate the truthful attendance rate over elapsed/passed sessions
  if (pastSessionsList.length > 0 && passedSessions > 0) {
    percentageOverTaken = `${(Math.round((attendedSessions / passedSessions) * 1000) / 10).toFixed(1)}%`;
    pointsOverTaken = `${attendedSessions * 2} / ${passedSessions * 2}`;
  }

  if (totalSessions == null && Array.isArray(sessions) && sessions.length > 0) {
    totalSessions = sessions.length;
  } else if (Array.isArray(sessions) && sessions.length > totalSessions) {
    totalSessions = sessions.length;
  }

  if (!percentageOverAll && totalSessions > 0) {
    percentageOverAll = `${(Math.round((attendedSessions / totalSessions) * 1000) / 10).toFixed(1)}%`;
  }
  if (!pointsOverAll && totalSessions > 0) {
    pointsOverAll = `${attendedSessions * 2} / ${totalSessions * 2}`;
  }

  if (!maxPoints && totalSessions > 0 && passedSessions > 0) {
    const missed = passedSessions - attendedSessions;
    maxPoints = `${(totalSessions * 2) - (missed * 2)} / ${totalSessions * 2}`;
  }
  if (!maxPercentage && totalSessions > 0 && passedSessions > 0) {
    const missed = passedSessions - attendedSessions;
    maxPercentage = `${(Math.round((((totalSessions * 2) - (missed * 2)) / (totalSessions * 2)) * 1000) / 10).toFixed(1)}%`;
  }

  const percentageOverTakenVal = percentageOverTaken ? parseFloat(percentageOverTaken) : null;
  const percentageOverAllVal = percentageOverAll ? parseFloat(percentageOverAll) : null;
  const maxPercentageVal = maxPercentage ? parseFloat(maxPercentage) : null;

  return {
    takenSessions,
    passedSessions,
    attendedSessions,
    pointsOverTaken,
    percentageOverTaken,
    percentageOverTakenVal,
    totalSessions,
    pointsOverAll,
    percentageOverAll,
    percentageOverAllVal,
    maxPoints,
    maxPercentage,
    maxPercentageVal
  };
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
      const attTable = doc.querySelector('table.userattendance, table.attlist, table.generaltable, table.attwidth');
      const rows = attTable ? attTable.querySelectorAll('tr') : doc.querySelectorAll('table tr');
      let parsedRowCount = 0;
      let skippedOccCount = 0;

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
          parsedRowCount++;
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
            const dKey = formatDateKey(sessDate);
            const normTime = extractOnlyTime(finalTime) || finalTime;

            const existingIdx = list.findIndex(s => {
              const sNormTime = extractOnlyTime(s.time) || s.time;
              return s.dateKey === dKey && sNormTime === normTime;
            });

            const newSess = {
              date: sessDate,
              dateKey: dKey,
              dateStr: finalDateStr,
              time: finalTime,
              desc: descColText || 'Class Session',
              status: statusColText || statusLabel,
              statusType,
              statusLabel,
              isFuture,
              isToday,
              isPresent
            };

            if (existingIdx !== -1) {
              if (isPresent || statusType === 'present' || statusType === 'active') {
                list[existingIdx] = newSess;
              }
            } else {
              list.push(newSess);
            }
          }
        }
      }
      return list;
    }

    for (let i = 0; i < candidateLinks.length; i++) {
      const { url: fullAttUrl, label: initialLabel } = candidateLinks[i];
      let attHtml = '';

      // Direct view=5 URL ("All" semester sessions + real stats summary table)
      let targetAttUrl = fullAttUrl;
      if (!/[?&]view=/i.test(targetAttUrl)) {
        targetAttUrl = targetAttUrl.includes('?') ? `${targetAttUrl}&view=5` : `${targetAttUrl}?view=5`;
      }

      logDiag('Attendance:Fetch', `[${courseId}] [${i + 1}/${candidateLinks.length}] Requesting student attendance (view=5 all): "${initialLabel}" -> ${targetAttUrl}`);
      try {
        let res = await fetchWithTimeout(targetAttUrl, { credentials: 'include' }, 12000);
        logDiag('Attendance:Fetch', `[${courseId}] HTTP ${res.status} ("${initialLabel}") from ${res.url}`);
        if (res.ok && !res.url.includes('/login/')) {
          attHtml = await res.text();
        }
        // Fallback to base URL if view=5 was rejected or returned permission restriction
        if (!attHtml || /you do not have permission|tiada kebenaran|not available unless|access denied|tidak dibenarkan/i.test(attHtml)) {
          if (targetAttUrl !== fullAttUrl) {
            logDiag('Attendance:Fetch', `[${courseId}] Falling back to base URL: ${fullAttUrl}`);
            const baseRes = await fetchWithTimeout(fullAttUrl, { credentials: 'include' }, 12000);
            if (baseRes.ok && !baseRes.url.includes('/login/')) {
              const baseHtml = await baseRes.text();
              if (!/you do not have permission|tiada kebenaran|not available unless|access denied|tidak dibenarkan/i.test(baseHtml)) {
                attHtml = baseHtml;
              }
            }
          }
        }
      } catch (err) {
        logDiag('Attendance:Fetch', `[${courseId}] Fetch error on ${targetAttUrl}: ${err?.message || err}`);
      }

      if (!attHtml) {
        logDiag('Attendance:Skip', `[${courseId}] Empty response or error for "${initialLabel}". Skipping.`);
        continue;
      }

      // Skip restricted / locked attendance activities where the student lacks permission
      if (/you do not have permission|tiada kebenaran|not available unless|access denied|tidak dibenarkan/i.test(attHtml)) {
        logDiag('Attendance:Restricted', `[${courseId}] 🔒 Restricted activity (student lacks permission) for "${initialLabel}"`);
        continue;
      }

      let attDoc = parser.parseFromString(attHtml, 'text/html');
      let baseSessions = parseSessionsFromDoc(attDoc);
      logDiag('Attendance:Sessions', `[${courseId}] Student view parsed ${baseSessions.length} session(s) for "${initialLabel}"`);

      // If for any reason sessions are 0, check if there's an allTabLink or alternative view
      if (baseSessions.length === 0) {
        const allTabLink = Array.from(attDoc.querySelectorAll('a')).find(a => {
          const txt = (a.textContent || '').trim().toLowerCase();
          const href = a.getAttribute('href') || a.href || '';
          return (/^(?:all|all\s+sessions?|semua|semua\s+sesi)$/i.test(txt) || /[?&]view=(?:5|all)\b/i.test(href)) && href.includes('view.php');
        });

        if (allTabLink) {
          let rawHref = allTabLink.getAttribute('href') || allTabLink.href || '';
          let probeAllUrl = rawHref.startsWith('/') ? `${origin}${rawHref}` : (rawHref.startsWith('http') ? rawHref : `${origin}/mod/attendance/${rawHref}`);
          try {
            const probeRes = await fetchWithTimeout(probeAllUrl, { credentials: 'include' }, 12000);
            if (probeRes.ok && !probeRes.url.includes('/login/')) {
              const probeHtml = await probeRes.text();
              if (!/you do not have permission|tiada kebenaran|not available unless|access denied|tidak dibenarkan/i.test(probeHtml)) {
                attHtml = probeHtml;
                attDoc = parser.parseFromString(attHtml, 'text/html');
                baseSessions = parseSessionsFromDoc(attDoc);
              }
            }
          } catch (pErr) {}
        }
      }

      if (baseSessions.length === 0) {
        logDiag('Attendance:Sessions', `[${courseId}] "${initialLabel}" has 0 student sessions. Skipping inactive/unassigned activity.`);
        continue;
      }

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
      let takeEl = Array.from(attDoc.querySelectorAll('a')).find(a => {
        const href = a.getAttribute('href') || a.href || '';
        const text = (a.textContent || '').trim();
        const isTakeHref = /(?:attendance|take)\.php\?.*sessid=\d+/i.test(href) && !/view\.php/i.test(href);
        const hasTakeText = /submit attendance|hantar kehadiran|rekod kehadiran|take attendance/i.test(text);
        const hasTakeClass = a.classList.contains('takeattendance');
        return isTakeHref && (hasTakeText || hasTakeClass);
      });

      if (takeEl) {
        let rawTakeUrl = (takeEl.getAttribute('href') || takeEl.href || '').replace(/&amp;/g, '&');
        let fullTakeUrl = rawTakeUrl;
        if (fullTakeUrl.startsWith('attendance.php') || fullTakeUrl.startsWith('take.php')) {
          fullTakeUrl = `${origin}/mod/attendance/${fullTakeUrl}`;
        } else if (fullTakeUrl.startsWith('/')) {
          fullTakeUrl = `${origin}${fullTakeUrl}`;
        }

        const sessidMatch = fullTakeUrl.match(/sessid=(\d+)/);
        const sessid = sessidMatch ? sessidMatch[1] : '';

        let sessionDesc = 'Regular Class';
        let sessionTime = '';
        const sessionRow = takeEl.closest('tr');
        if (sessionRow) {
          const descCol = sessionRow.querySelector('td.c2, td.description') || sessionRow.querySelector('td:nth-child(3)');
          const text = (descCol?.textContent || descCol?.innerText || '').trim();
          if (text) sessionDesc = text;

          const rowText = (sessionRow.textContent || '').trim();
          const extractedTime = extractOnlyTime(rowText);
          if (extractedTime) sessionTime = extractedTime;
        }

        let shouldInclude = true;
        if (hasUserOcc) {
          const sessionText = sessionRow ? (sessionRow.textContent || sessionRow.innerText || '') : '';
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

          if (presentStatusId || hasPasswordInput) {
            const isWindowOpen = sessionTime
              ? ((typeof isSessionWindowActive === 'function') ? isSessionWindowActive(sessionTime) : (typeof window.isSessionWindowActive === 'function' ? window.isSessionWindowActive(sessionTime) : true))
              : true;

            if (isWindowOpen) {
              activeSession = {
                sessid,
                sesskey,
                takeUrl: fullTakeUrl,
                desc: sessionDesc,
                time: sessionTime || 'Active now',
                requiresPassword: hasPasswordInput,
                presentStatusId
              };
              logDiag('Attendance:ActiveNow', `[${courseId}] 🟢 Found OPEN attendance session! Desc: "${sessionDesc}", Requires PIN: ${hasPasswordInput}`);
            } else {
              logDiag('Attendance:ActiveNow', `[${courseId}] ⏳ Attendance session link found but window not open yet (Scheduled: "${sessionTime}").`);
            }
          }
        }
      }

      // 3. Parse all sessions present in the default view
      const allSessions = parseSessionsFromDoc(attDoc);
      allSessions.sort((a, b) => {
        const dDiff = a.date.getTime() - b.date.getTime();
        if (dDiff !== 0) return dDiff;
        const parseMin = (s) => {
          const t = extractOnlyTime(s.time || s.dateStr || '');
          const m = t.match(/(\d{1,2})[:.](\d{2})/);
          if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
          return 0;
        };
        return parseMin(a) - parseMin(b);
      });

      // Extract overall Attendance Stats from attDoc (real percentage from view=5 summary table)
      const summaryStats = parseAttendanceSummaryStats(attDoc, attHtml, allSessions);
      let pastStats = summaryStats ? {
        percentage: summaryStats.percentageOverAllVal != null ? String(summaryStats.percentageOverAllVal) : (summaryStats.percentageOverTakenVal != null ? String(summaryStats.percentageOverTakenVal) : ''),
        takenPercentage: summaryStats.percentageOverTaken || '',
        overallPercentage: summaryStats.percentageOverAll || '',
        attended: summaryStats.attendedSessions != null ? String(summaryStats.attendedSessions) : (summaryStats.takenSessions != null ? String(summaryStats.takenSessions) : ''),
        passed: summaryStats.passedSessions != null ? String(summaryStats.passedSessions) : (summaryStats.takenSessions != null ? String(summaryStats.takenSessions) : ''),
        total: summaryStats.totalSessions != null ? String(summaryStats.totalSessions) : '',
        pointsOverTaken: summaryStats.pointsOverTaken || '',
        pointsOverAll: summaryStats.pointsOverAll || '',
        maxPercentage: summaryStats.maxPercentage || '',
        maxPoints: summaryStats.maxPoints || ''
      } : null;

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
        const nextLec = futureLecSessions[0] || (currentLec && (currentLec.isFuture || currentLec.isToday) ? currentLec : null);

        let activeLecSession = null;
        if (activeSession) {
          if (isLecDesc(activeSession.desc)) {
            activeLecSession = activeSession;
          } else if (!isTutDesc(activeSession.desc) && currentLec && currentLec.isToday) {
            activeLecSession = activeSession;
          }
        }

        let summaryStatsLec = parseAttendanceSummaryStats(null, '', lecSessions);
        let pastStatsLec = summaryStatsLec ? {
          percentage: summaryStatsLec.percentageOverAllVal != null ? String(summaryStatsLec.percentageOverAllVal) : (summaryStats?.percentageOverAllVal != null ? String(summaryStats.percentageOverAllVal) : ''),
          takenPercentage: summaryStatsLec.percentageOverTaken || summaryStats?.percentageOverTaken || '',
          overallPercentage: summaryStatsLec.percentageOverAll || summaryStats?.percentageOverAll || '',
          attended: summaryStatsLec.attendedSessions != null ? String(summaryStatsLec.attendedSessions) : (summaryStatsLec.takenSessions != null ? String(summaryStatsLec.takenSessions) : ''),
          passed: summaryStatsLec.passedSessions != null ? String(summaryStatsLec.passedSessions) : (summaryStatsLec.takenSessions != null ? String(summaryStatsLec.takenSessions) : ''),
          total: summaryStatsLec.totalSessions != null ? String(summaryStatsLec.totalSessions) : '',
          pointsOverTaken: summaryStatsLec.pointsOverTaken || '',
          pointsOverAll: summaryStatsLec.pointsOverAll || '',
          maxPercentage: summaryStatsLec.maxPercentage || '',
          maxPoints: summaryStatsLec.maxPoints || ''
        } : pastStats;

        const lastRecordedLecStatus = currentLec ? (currentLec.status || currentLec.statusLabel || '') : '';

        // B. Tutorial item
        const pastTutSessions = tutSessions.filter(s => !s.isFuture);
        const futureTutSessions = tutSessions.filter(s => s.isFuture);
        const currentTut = tutSessions.find(s => s.isToday || s.statusType === 'active') || 
                           (pastTutSessions.length > 0 ? pastTutSessions[pastTutSessions.length - 1] : null);
        const nextTut = futureTutSessions[0] || (currentTut && (currentTut.isFuture || currentTut.isToday) ? currentTut : null);

        let activeTutSession = null;
        if (activeSession) {
          if (isTutDesc(activeSession.desc)) {
            activeTutSession = activeSession;
          } else if (!isLecDesc(activeSession.desc) && currentTut && currentTut.isToday) {
            activeTutSession = activeSession;
          }
        }

        let summaryStatsTut = parseAttendanceSummaryStats(null, '', tutSessions);
        let pastStatsTut = summaryStatsTut ? {
          percentage: summaryStatsTut.percentageOverAllVal != null ? String(summaryStatsTut.percentageOverAllVal) : (summaryStats?.percentageOverAllVal != null ? String(summaryStats.percentageOverAllVal) : ''),
          takenPercentage: summaryStatsTut.percentageOverTaken || summaryStats?.percentageOverTaken || '',
          overallPercentage: summaryStatsTut.percentageOverAll || summaryStats?.percentageOverAll || '',
          attended: summaryStatsTut.attendedSessions != null ? String(summaryStatsTut.attendedSessions) : (summaryStatsTut.takenSessions != null ? String(summaryStatsTut.takenSessions) : ''),
          passed: summaryStatsTut.passedSessions != null ? String(summaryStatsTut.passedSessions) : (summaryStatsTut.takenSessions != null ? String(summaryStatsTut.takenSessions) : ''),
          total: summaryStatsTut.totalSessions != null ? String(summaryStatsTut.totalSessions) : '',
          pointsOverTaken: summaryStatsTut.pointsOverTaken || '',
          pointsOverAll: summaryStatsTut.pointsOverAll || '',
          maxPercentage: summaryStatsTut.maxPercentage || '',
          maxPoints: summaryStatsTut.maxPoints || ''
        } : pastStats;

        const lastRecordedTutStatus = currentTut ? (currentTut.status || currentTut.statusLabel || '') : '';

        // If an active session is open right now but neither assigned, assign to whichever is not null or default to lecture
        if (activeSession && !activeLecSession && !activeTutSession) {
          activeLecSession = activeSession;
        }

        logDiag('Attendance:Sessions', `[${courseId}] "${attTitle || 'Attendance'}" (Combined Page) -> Split into Lecture (${lecSessions.length} sess) + Tutorial (${tutSessions.length} sess)`);

        if (lecSessions.length > 0 || activeLecSession) {
          attendancesFound.push({
            id: `att_${courseId}_${attInstanceId}_lec`,
            cmid: attInstanceId,
            courseId,
            courseCode,
            courseName,
            attTitle: `${attTitle || 'Attendance'} (Lecture)`,
            subType: 'lecture',
            attUrl: targetAttUrl || fullAttUrl,
            detectedOccs: detectedOccs.map(String),
            userOcc: userOcc || '',
            activeSession: activeLecSession,
            nextSession: nextLec,
            summaryStats: summaryStatsLec || summaryStats,
            pastStats: pastStatsLec,
            lastRecordedStatus: lastRecordedLecStatus,
            sessions: lecSessions
          });
        }

        if (tutSessions.length > 0 || activeTutSession) {
          attendancesFound.push({
            id: `att_${courseId}_${attInstanceId}_tut`,
            cmid: attInstanceId,
            courseId,
            courseCode,
            courseName,
            attTitle: `${attTitle || 'Attendance'} (Tutorial)`,
            subType: 'tutorial',
            attUrl: targetAttUrl || fullAttUrl,
            detectedOccs: detectedOccs.map(String),
            userOcc: userOcc || '',
            activeSession: activeTutSession,
            nextSession: nextTut,
            summaryStats: summaryStatsTut || summaryStats,
            pastStats: pastStatsTut,
            lastRecordedStatus: lastRecordedTutStatus,
            sessions: tutSessions
          });
        }
      } else {
        // 4. Retain all semester sessions in storage so Calendar, Timetable, and History have full data
        const pastSessions = allSessions.filter(s => !s.isFuture);
        const futureSessions = allSessions.filter(s => s.isFuture);

        // A. Most current session (active today, or latest past session for status verification)
        const currentSession = allSessions.find(s => s.isToday || s.statusType === 'active') || 
                               (pastSessions.length > 0 ? pastSessions[pastSessions.length - 1] : null);

        // B. Next upcoming session
        const nextSession = futureSessions[0] || (currentSession && (currentSession.isFuture || currentSession.isToday) ? currentSession : null);

        logDiag('Attendance:Sessions', `[${courseId}] "${attTitle || 'Attendance'}" -> Kept all ${allSessions.length} session(s). Overall stats: ${summaryStats?.percentageOverAll || pastStats?.percentage || 'N/A'}`);

        if (allSessions.length === 0) {
          logDiag('Attendance:Sessions', `[${courseId}] "${attTitle || 'Attendance'}" has 0 matching sessions. Skipping.`);
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
          attUrl: targetAttUrl || fullAttUrl,
          detectedOccs: detectedOccs.map(String),
          userOcc: userOcc || '',
          activeSession,
          nextSession,
          summaryStats,
          pastStats,
          lastRecordedStatus,
          sessions: allSessions
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
    formData.append('_qf__mod_attendance_student_attendance_form', '1');
    formData.append('mform_isexpanded_id_general', '1');
    formData.append('submitbutton', 'Save changes');
    if (password) {
      formData.append('password', password);
    }

    const res = await fetchWithTimeout(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      credentials: 'include',
      redirect: 'follow'
    });

    const resText = await res.text();
    const finalUrl = res.url || '';
    const isSuccess = (finalUrl.includes('/mod/attendance/view.php') ||
                      /status:\s*(?:present|hadir)|attendance has been recorded|kehadiran anda telah direkodkan|sudah direkod|attendance has been taken/i.test(resText) ||
                      resText.includes('Your attendance in this session has been recorded')) &&
                      !finalUrl.includes('/login/');

    return isSuccess;
  } catch (e) {
    console.log('[SPeCTRUM Pro] Direct attendance submit error:', e);
    return false;
  }
}

if (typeof window !== "undefined") {
  window.fetchEnrolledCoursesDirectly = fetchEnrolledCoursesDirectly;
  window.fetchCourseMaterialsDirectly = fetchCourseMaterialsDirectly;
  window.fetchCourseAnnouncements = fetchCourseAnnouncements;
  window.fetchCourseAssignments = fetchCourseAssignments;
  window.fetchCourseAttendance = fetchCourseAttendance;
  window.submitAttendanceDirect = submitAttendanceDirect;
  window.parseMoodleDate = parseMoodleDate;
  window.calculateAssignmentTiming = calculateAssignmentTiming;
  window.extractOccNumberFromGroupText = extractOccNumberFromGroupText;
  window.fetchUserCourseOccs = fetchUserCourseOccs;
  window.parseAttendanceSummaryStats = parseAttendanceSummaryStats;
  window.normalizeMidnightDeadline = normalizeMidnightDeadline;
  window.isPastSemesterStale = isPastSemesterStale;
  window.extractExamDetails = extractExamDetails;
  window.cleanDateText = cleanDateText;
}