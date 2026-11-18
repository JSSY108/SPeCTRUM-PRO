// SPeCTRUM Pro Content Script - Injected on web pages
(function () {
  'use strict';

  // Saladict-Style Floating Pin Panel Engine (Flies over screen, draggable & pinnable)
  let isFloatingPanelPinned = true;
  try {
    const savedPinned = localStorage.getItem('spectrum_pro_float_pinned');
    if (savedPinned !== null) {
      isFloatingPanelPinned = savedPinned === '1';
    }
  } catch (e) {}

  function toggleFloatingPanel(forceOpen = false, forcePinned = undefined, tab = '', sub = '') {
    let panel = document.getElementById('spectrum-pro-floating-panel');
    let targetUrl = chrome.runtime.getURL('popup/popup.html?mode=floating');
    if (tab) targetUrl += `&tab=${encodeURIComponent(tab)}`;
    if (sub) targetUrl += `&sub=${encodeURIComponent(sub)}`;

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'spectrum-pro-floating-panel';
      if (forcePinned !== undefined) {
        isFloatingPanelPinned = forcePinned;
      }

      const iconUrl = chrome.runtime.getURL('icons/icon48.png');

      // Load saved position if available
      let savedLeft = null;
      let savedTop = null;
      try {
        const rawPos = localStorage.getItem('spectrum_pro_float_pos');
        if (rawPos) {
          const parsed = JSON.parse(rawPos);
          if (typeof parsed.left === 'number' && typeof parsed.top === 'number') {
            savedLeft = Math.min(Math.max(10, parsed.left), window.innerWidth - 300);
            savedTop = Math.min(Math.max(10, parsed.top), window.innerHeight - 200);
          }
        }
      } catch (e) {}

      panel.innerHTML = `
        <div id="spectrum-pro-floating-header">
          <div class="spectrum-floating-left">
            <img src="${iconUrl}" class="spectrum-floating-logo-icon" alt="SPeCTRUM Pro">
            <span class="spectrum-floating-title-text">SPeCTRUM PRO</span>
            <span class="spectrum-floating-drag-handle">⋮⋮ DRAG</span>
          </div>
          <div class="spectrum-floating-actions">
            <button type="button" id="spectrum-floating-btn-workstation" class="spectrum-floating-btn btn-workstation" title="Open Full Workstation in new tab">
              <svg class="icon-svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>Full Workstation</span>
            </button>
            <button type="button" id="spectrum-floating-btn-pin" class="spectrum-floating-btn btn-pin ${isFloatingPanelPinned ? 'is-pinned' : ''}" title="${isFloatingPanelPinned ? 'Pinned: Stays open when clicking outside on the page' : 'Unpinned: Click outside to close'}">
              <svg class="icon-svg icon-pin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
              <span id="spectrum-floating-pin-text">${isFloatingPanelPinned ? 'PINNED' : 'PIN'}</span>
            </button>
            <button type="button" id="spectrum-floating-btn-close" class="spectrum-floating-btn btn-close" title="Close Panel (Esc)">✕</button>
          </div>
        </div>
        <iframe src="${targetUrl}" id="spectrum-pro-floating-frame" allow="clipboard-read; clipboard-write"></iframe>
      `;

      if (savedLeft !== null && savedTop !== null) {
        panel.style.setProperty('left', `${savedLeft}px`, 'important');
        panel.style.setProperty('top', `${savedTop}px`, 'important');
        panel.style.setProperty('right', 'auto', 'important');
      }

      (document.body || document.documentElement).appendChild(panel);

      const header = panel.querySelector('#spectrum-pro-floating-header');
      const workstationBtn = panel.querySelector('#spectrum-floating-btn-workstation');
      const pinBtn = panel.querySelector('#spectrum-floating-btn-pin');
      const pinText = panel.querySelector('#spectrum-floating-pin-text');
      const closeBtn = panel.querySelector('#spectrum-floating-btn-close');
      const frame = panel.querySelector('#spectrum-pro-floating-frame');

      // Full Workstation button (opens full tab)
      if (workstationBtn) {
        workstationBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fulltabUrl = chrome.runtime.getURL('popup/popup.html?mode=full');
          window.open(fulltabUrl, '_blank');
        });
      }

      // Pin toggle button (Saladict pin behavior)
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isFloatingPanelPinned = !isFloatingPanelPinned;
        pinBtn.classList.toggle('is-pinned', isFloatingPanelPinned);
        pinText.textContent = isFloatingPanelPinned ? 'PINNED' : 'PIN';
        pinBtn.title = isFloatingPanelPinned ? 'Pinned: Stays open when clicking outside on the page' : 'Unpinned: Click outside to close';
        try {
          localStorage.setItem('spectrum_pro_float_pinned', isFloatingPanelPinned ? '1' : '0');
        } catch (e) {}
      });

      // Close button
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.add('panel-hidden');
      });

      // Drag-to-move physics (Saladict mechanics - 2D horizontal & vertical drag)
      let isDragging = false;
      let startMouseX = 0, startMouseY = 0;
      let startPanelX = 0, startPanelY = 0;

      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        header.classList.add('is-dragging');
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        const rect = panel.getBoundingClientRect();
        startPanelX = rect.left;
        startPanelY = rect.top;
        if (frame) frame.style.pointerEvents = 'none'; // prevent iframe stealing mouse during drag
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;
        const maxLeft = Math.max(0, window.innerWidth - 120);
        const maxTop = Math.max(0, window.innerHeight - 40);
        const newLeft = Math.min(Math.max(0, startPanelX + dx), maxLeft);
        const newTop = Math.min(Math.max(0, startPanelY + dy), maxTop);
        panel.style.setProperty('left', `${newLeft}px`, 'important');
        panel.style.setProperty('top', `${newTop}px`, 'important');
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('bottom', 'auto', 'important');
      });

      const stopDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        header.classList.remove('is-dragging');
        if (frame) frame.style.pointerEvents = 'auto';
        try {
          const rect = panel.getBoundingClientRect();
          localStorage.setItem('spectrum_pro_float_pos', JSON.stringify({ left: rect.left, top: rect.top }));
        } catch (e) {}
      };

      window.addEventListener('mouseup', stopDrag);
      window.addEventListener('blur', stopDrag);

      // Click outside: only dismisses if UNPINNED (Saladict behavior)
      document.addEventListener('mousedown', (e) => {
        if (isFloatingPanelPinned) return; // Stays pinned! Never closes when clicking outside!
        if (panel.classList.contains('panel-hidden')) return;
        if (panel.contains(e.target)) return;
        const floatBtn = document.getElementById('spectrum-pro-floating-btn');
        if (floatBtn && floatBtn.contains(e.target)) return;
        panel.classList.add('panel-hidden');
      });

      // Esc key closes panel
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.classList.contains('panel-hidden')) {
          panel.classList.add('panel-hidden');
        }
      });

      window.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'CLOSE_SPECTRUM_FLOATING') {
          panel.classList.add('panel-hidden');
        }
        if (ev.data && ev.data.type === 'TOGGLE_SPECTRUM_PIN') {
          if (pinBtn) pinBtn.click();
        }
      });
      return;
    }

    if (forceOpen) {
      panel.classList.remove('panel-hidden');
      if (forcePinned !== undefined) {
        isFloatingPanelPinned = forcePinned;
        const pinBtn = panel.querySelector('#spectrum-floating-btn-pin');
        const pinText = panel.querySelector('#spectrum-floating-pin-text');
        if (pinBtn) pinBtn.classList.toggle('is-pinned', isFloatingPanelPinned);
        if (pinText) pinText.textContent = isFloatingPanelPinned ? 'PINNED' : 'PIN';
      }
      if (tab || sub) {
        const frame = panel.querySelector('#spectrum-pro-floating-frame');
        if (frame) frame.src = targetUrl;
      }
    } else {
      panel.classList.toggle('panel-hidden');
    }
  }

  // Inject floating capsule button if on SPeCTRUM
  function injectFloatingButton() {
    if (document.getElementById('spectrum-pro-floating-btn')) return;
    if (!window.location.hostname.includes('spectrum.um.edu.my')) return;

    const btn = document.createElement('div');
    btn.id = 'spectrum-pro-floating-btn';
    btn.className = 'spectrum-capsule';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.title = "SPeCTRUM PRO · Click to open pinned panel";

    // Swiss Minimalist Black/White Capsule: Layers Icon + SPeCTRUM + PRO Badge + Idle Sync Dot
    btn.innerHTML = `
      <svg class="spectrum-capsule-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
        <path d="m22 12.5-8.58 3.91a2 2 0 0 1-1.66 0L2 12.5"/>
        <path d="m22 17.5-8.58 3.91a2 2 0 0 1-1.66 0L2 17.5"/>
      </svg>
      <span class="spectrum-capsule-title">SPeCTRUM</span>
      <span class="spectrum-capsule-badge">PRO</span>
      <span class="spectrum-capsule-dot" aria-hidden="true"></span>
    `;

    // Detect theme (Obsidian Dark Profile vs Paper Light Profile)
    function applyCapsuleTheme() {
      try {
        chrome.storage.local.get(['theme', 'cachedTheme'], (res) => {
          const userTheme = res?.theme || res?.cachedTheme;
          let isDark = false;
          if (userTheme === 'dark') {
            isDark = true;
          } else if (userTheme === 'light') {
            isDark = false;
          } else {
            // Auto-detect from Moodle page or OS preference
            const bg = (document.body ? window.getComputedStyle(document.body).backgroundColor : '') || '';
            const isDarkBg = bg.includes('rgb(13,') || bg.includes('rgb(18,') || bg.includes('rgb(9,') || bg.includes('rgb(24,') || bg.includes('rgb(30,');
            const isPageDark = (document.body && (document.body.classList.contains('dark-mode') || document.body.classList.contains('theme-dark'))) ||
                               document.documentElement.getAttribute('data-theme') === 'dark' ||
                               isDarkBg ||
                               window.matchMedia('(prefers-color-scheme: dark)').matches;
            isDark = Boolean(isPageDark);
          }
          btn.classList.toggle('theme-dark', isDark);
          btn.classList.toggle('theme-light', !isDark);
        });
      } catch (e) {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        btn.classList.toggle('theme-dark', isDark);
        btn.classList.toggle('theme-light', !isDark);
      }
    }
    applyCapsuleTheme();

    // Listen for theme changes from extension
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.theme || changes.cachedTheme)) {
          applyCapsuleTheme();
        }
      });
    } catch (e) {}

    // Check saved position if user moved it, otherwise default to bottom: 24px; right: 84px;
    try {
      const rawPos = localStorage.getItem('spectrum_pro_float_btn_pos');
      if (rawPos) {
        const parsed = JSON.parse(rawPos);
        if (typeof parsed.bottom === 'number' && typeof parsed.right === 'number') {
          btn.style.setProperty('bottom', `${parsed.bottom}px`, 'important');
          btn.style.setProperty('right', `${parsed.right}px`, 'important');
          btn.style.setProperty('left', 'auto', 'important');
          btn.style.setProperty('top', 'auto', 'important');
        }
      }
    } catch (e) {}

    // Subtle drag-to-reposition physics + Click handler
    let isDragging = false;
    let hasMoved = false;
    let startX = 0, startY = 0;
    let initRight = 84, initBottom = 24;

    btn.addEventListener('mousedown', (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = btn.getBoundingClientRect();
      initRight = window.innerWidth - rect.right;
      initBottom = window.innerHeight - rect.bottom;
      btn.style.transition = 'none';
    });

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }
      if (hasMoved) {
        const newRight = Math.max(10, Math.min(window.innerWidth - 140, initRight - dx));
        const newBottom = Math.max(10, Math.min(window.innerHeight - 50, initBottom - dy));
        btn.style.setProperty('right', `${newRight}px`, 'important');
        btn.style.setProperty('bottom', `${newBottom}px`, 'important');
      }
    };

    const onMouseUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      btn.style.transition = '';
      if (hasMoved) {
        const rect = btn.getBoundingClientRect();
        const finalRight = Math.round(window.innerWidth - rect.right);
        const finalBottom = Math.round(window.innerHeight - rect.bottom);
        try {
          localStorage.setItem('spectrum_pro_float_btn_pos', JSON.stringify({ right: finalRight, bottom: finalBottom }));
        } catch (err) {}
      } else {
        // Normal click
        btn.style.transform = 'scale(0.96)';
        setTimeout(() => { btn.style.transform = ''; }, 120);
        toggleFloatingPanel();
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    (document.body || document.documentElement).appendChild(btn);
  }

  // Listen for messages from popup or background to open in-page drawer
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'OPEN_FLOATING_PANEL') {
      toggleFloatingPanel(true, msg.pinned !== undefined ? msg.pinned : true, msg.tab || '', msg.sub || '');
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === 'TOGGLE_FLOATING_PANEL') {
      toggleFloatingPanel();
      sendResponse({ success: true });
      return true;
    }
  });

  // On-page Auto-Attendance Assistant for attendance.php
  async function handleAttendancePage() {
    const url = window.location.href;
    if (!url.includes('/mod/attendance/attendance.php') && !url.includes('/mod/attendance/take.php')) {
      if (url.includes('/mod/attendance/view.php') && /present|hadir|recorded/i.test(document.body.innerText)) {
        try { chrome.runtime.sendMessage({ type: 'DATA_UPDATED' }); } catch (e) {}
      }
      return;
    }

    // Safety check: honor user setting before interacting with attendance forms
    const settings = await new Promise((resolve) => {
      try {
        chrome.storage.local.get({ autoAttendanceEnabled: true }, resolve);
      } catch (e) {
        resolve({ autoAttendanceEnabled: true });
      }
    });

    if (!settings.autoAttendanceEnabled) {
      console.log('[SPeCTRUM Pro Content] Auto-attendance is disabled in settings. Skipping form interaction.');
      return;
    }

    const form = document.querySelector('form.mform, form[action*="attendance.php"], form');
    if (!form) return;

    const radios = Array.from(form.querySelectorAll('input[type="radio"][name="status"]'));
    if (radios.length === 0) return;

    // Find radio specifically for Present / Hadir (never match Absent / Late / Excused)
    let presentRadio = null;
    for (const r of radios) {
      let text = '';
      if (r.id) {
        const lbl = document.querySelector(`label[for="${r.id}"]`);
        if (lbl) text += ' ' + lbl.textContent;
      }
      const container = r.closest('.form-check, .fitem, tr, td, div');
      if (container) text += ' ' + container.textContent;

      const isAffirmativePresent = /present|hadir|\b[PH]\b/i.test(text);
      const isNegativeStatus = /absent|tidak hadir|ponteng|late|lewat|excused|alasan/i.test(text);

      if (isAffirmativePresent && !isNegativeStatus) {
        presentRadio = r;
        break;
      }
    }

    // CRITICAL SAFETY GUARDRAIL: Never fallback to radios[0] if Present is not found!
    if (!presentRadio) {
      console.warn('[SPeCTRUM Pro Content] "Present" status option could not be unambiguously confirmed. Auto-submit aborted to prevent accidental Absent submission.');
      return;
    }

    if (presentRadio && !presentRadio.checked) {
      presentRadio.checked = true;
      presentRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Check for password requirement
    const pwdInput = form.querySelector('input[type="password"], input[name="studentpassword"], input[name="password"], input[name="qrpass"]');
    const banner = document.createElement('div');
    banner.id = 'spectrum-pro-att-banner';
    banner.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;background:#0d1117;color:#fff;padding:12px 18px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.3);font-family:sans-serif;font-size:13px;display:flex;align-items:center;gap:10px;border:1px solid #10b981;';

    if (pwdInput && !pwdInput.value) {
      banner.innerHTML = `<span>🔑 <b>SPeCTRUM Pro:</b> "Present" selected! Enter your attendance PIN and press Enter.</span>`;
      document.body.appendChild(banner);
      pwdInput.focus();
    } else {
      banner.innerHTML = `<span>⚡ <b>SPeCTRUM Pro:</b> "Present" selected! Auto-saving attendance...</span>`;
      document.body.appendChild(banner);

      const submitBtn = form.querySelector('input[type="submit"][name="submitbutton"], button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        setTimeout(() => {
          submitBtn.click();
        }, 400);
      }
    }
  }

  // Auto-scroll and highlight module when URL has #module-XXXXX or #section-XXXXX
  function handleModuleHashRedirect() {
    const hash = window.location.hash;
    if (!hash || !/^#(?:module|section)-\d+$/i.test(hash)) return;

    const targetId = hash.slice(1);
    const numOnly = targetId.replace(/^(?:module|section)-/, '');

    // Synchronize Moodle course index drawer visually
    try {
      const courseIndexLink = document.querySelector(`a.courseindex-link[href*="module-${numOnly}"], a.courseindex-link[data-id="${numOnly}"], a.courseindex-link[href*="#${targetId}"]`);
      if (courseIndexLink) {
        courseIndexLink.classList.add('pageitem', 'active');
        courseIndexLink.setAttribute('aria-current', 'true');
        const parentSec = courseIndexLink.closest('.courseindex-section');
        if (parentSec) {
          parentSec.classList.remove('collapsed');
        }
      }
    } catch (e) {}

    function attemptScrollAndHighlight(attempt = 0) {
      const el = document.getElementById(targetId) || 
                 document.querySelector(`[data-id="${numOnly}"]`) ||
                 document.querySelector(`[data-cmid="${numOnly}"]`) ||
                 document.querySelector(`li#${targetId}`) ||
                 document.querySelector(`div#${targetId}`) ||
                 document.querySelector(`.activity[id*="${numOnly}"]`) ||
                 document.querySelector(`a[name="${targetId}"]`);

      if (!el) {
        if (attempt < 20) {
          setTimeout(() => attemptScrollAndHighlight(attempt + 1), 250);
        } else {
          // If element not in DOM after 5s (e.g. course in "one section per page" mode), check course index link
          try {
            const courseIndexLink = document.querySelector(`a.courseindex-link[href*="module-${numOnly}"], a.courseindex-link[data-id="${numOnly}"], a.courseindex-link[href*="#${targetId}"]`);
            if (courseIndexLink && courseIndexLink.href && courseIndexLink.href.includes('section=')) {
              if (window.location.href !== courseIndexLink.href) {
                window.location.replace(courseIndexLink.href);
              }
            }
          } catch (navErr) {}
        }
        return;
      }

      // 1. Expand any collapsed parent section or accordion in Moodle
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        if (parent.classList) {
          if (parent.classList.contains('collapse')) {
            parent.classList.add('show');
            parent.classList.remove('collapsed', 'collapsing');
            parent.style.setProperty('display', 'block', 'important');
            parent.style.setProperty('height', 'auto', 'important');
            parent.style.setProperty('visibility', 'visible', 'important');
          }
          if (parent.classList.contains('collapsed')) {
            parent.classList.remove('collapsed');
          }
        }
        const toggler = parent.querySelector?.('[data-toggle="collapse"][aria-expanded="false"], [data-bs-toggle="collapse"][aria-expanded="false"], .collapse-button.collapsed');
        if (toggler) {
          toggler.setAttribute('aria-expanded', 'true');
          toggler.classList.remove('collapsed');
        }
        if (parent.hasAttribute?.('aria-expanded') && parent.getAttribute('aria-expanded') === 'false') {
          parent.setAttribute('aria-expanded', 'true');
        }
        parent = parent.parentElement;
      }

      const sectionEl = el.closest('.section, .course-section, [data-sectionid], li[id^="section-"]');
      if (sectionEl) {
        sectionEl.classList.remove('collapsed');
        const collapseDiv = sectionEl.querySelector('.content.collapse, .course-section-content.collapse');
        if (collapseDiv) {
          collapseDiv.classList.add('show');
          collapseDiv.classList.remove('collapsed', 'collapsing');
          collapseDiv.style.setProperty('display', 'block', 'important');
          collapseDiv.style.setProperty('height', 'auto', 'important');
        }
        const btn = sectionEl.querySelector('[data-toggle="collapse"], [data-bs-toggle="collapse"], .collapse-button');
        if (btn) {
          btn.setAttribute('aria-expanded', 'true');
          btn.classList.remove('collapsed');
        }
      }

      // 2. Smoothly scroll into view with header offset compensation and multi-phase retry for layout animations
      function scrollToTarget() {
        const headerOffset = 85;
        const rect = el.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const targetY = rect.top + scrollTop - headerOffset;
        window.scrollTo({
          top: Math.max(0, targetY),
          behavior: 'smooth'
        });
      }

      requestAnimationFrame(scrollToTarget);
      setTimeout(scrollToTarget, 150);
      setTimeout(scrollToTarget, 400);

      // 3. Highlight with prominent sleek blue border and soft badge glow
      el.style.transition = 'box-shadow 0.3s ease, outline 0.3s ease, background-color 0.3s ease';
      el.style.outline = '3px solid #3b82f6';
      el.style.boxShadow = '0 0 24px rgba(59, 130, 246, 0.45)';
      el.style.borderRadius = '8px';
      el.style.backgroundColor = 'rgba(59, 130, 246, 0.08)';

      setTimeout(() => {
        el.style.outline = 'transparent';
        el.style.boxShadow = 'none';
        el.style.backgroundColor = 'transparent';
      }, 5000);
    }

    attemptScrollAndHighlight();
  }

  // Run when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectFloatingButton();
      handleAttendancePage();
      handleModuleHashRedirect();
    });
  } else {
    injectFloatingButton();
    handleAttendancePage();
    handleModuleHashRedirect();
  }

  window.addEventListener('hashchange', handleModuleHashRedirect);
})();
