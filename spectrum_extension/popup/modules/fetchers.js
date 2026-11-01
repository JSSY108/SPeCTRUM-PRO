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
        const nextLec = futureLecSessions[0] || (currentLec && (currentLec.isFuture || currentLec.isToday) ? currentLec : null);

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
        const nextTut = futureTutSessions[0] || (currentTut && (currentTut.isFuture || currentTut.isToday) ? currentTut : null);

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
            attUrl: fullAttUrl,
            detectedOccs: detectedOccs.map(String),
            userOcc: userOcc || '',
            activeSession: activeLecSession,
            nextSession: nextLec,
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
            attUrl: fullAttUrl,
            detectedOccs: detectedOccs.map(String),
            userOcc: userOcc || '',
            activeSession: activeTutSession,
            nextSession: nextTut,
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

        logDiag('Attendance:Sessions', `[${courseId}] "${attTitle || 'Attendance'}" -> Kept all ${allSessions.length} session(s). Overall stats: ${pastStats?.percentage || 'N/A'}%`);

        if (hasUserOcc && allSessions.length === 0 && !activeSession) {
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


if (typeof window !== "undefined") {
  window.fetchEnrolledCoursesDirectly = fetchEnrolledCoursesDirectly;
  window.fetchCourseMaterialsDirectly = fetchCourseMaterialsDirectly;
  window.fetchCourseAnnouncements = fetchCourseAnnouncements;
  window.fetchCourseAssignments = fetchCourseAssignments;
  window.fetchCourseAttendance = fetchCourseAttendance;
  window.submitAttendanceDirect = submitAttendanceDirect;
  window.parseMoodleDate = parseMoodleDate;
  window.calculateAssignmentTiming = calculateAssignmentTiming;
  window.executeInTab = executeInTab;
}