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
        panel.style.left = `${savedLeft}px`;
        panel.style.top = `${savedTop}px`;
        panel.style.right = 'auto';
      }

      (document.body || document.documentElement).appendChild(panel);

      const header = panel.querySelector('#spectrum-pro-floating-header');
      const pinBtn = panel.querySelector('#spectrum-floating-btn-pin');
      const pinText = panel.querySelector('#spectrum-floating-pin-text');
      const closeBtn = panel.querySelector('#spectrum-floating-btn-close');
      const frame = panel.querySelector('#spectrum-pro-floating-frame');

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

      // Drag-to-move physics (Saladict mechanics)
      let isDragging = false;
      let startMouseX = 0, startMouseY = 0;
      let startPanelX = 0, startPanelY = 0;

      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        header.classList.add('is-dragging');
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startPanelX = panel.offsetLeft;
        startPanelY = panel.offsetTop;
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
        panel.style.left = `${newLeft}px`;
        panel.style.top = `${newTop}px`;
        panel.style.right = 'auto';
      });

      const stopDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        header.classList.remove('is-dragging');
        if (frame) frame.style.pointerEvents = 'auto';
        try {
          localStorage.setItem('spectrum_pro_float_pos', JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }));
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

  // Inject floating button if on SPeCTRUM
  function injectFloatingButton() {
    if (document.getElementById('spectrum-pro-floating-btn')) return;
    if (!window.location.hostname.includes('spectrum.um.edu.my')) return;

    const btn = document.createElement('div');
    btn.id = 'spectrum-pro-floating-btn';
    const iconUrl = chrome.runtime.getURL('icons/icon48.png');
    btn.innerHTML = `
      <img src="${iconUrl}" style="width:18px;height:18px;border-radius:4px;vertical-align:middle;object-fit:contain;background:#090909;box-shadow:0 0 6px rgba(255,255,255,0.15);" alt="SPeCTRUM Pro">
      <span>SPeCTRUM Pro</span>
    `;

    btn.title = "Click to open pinned SPeCTRUM Pro panel (stays open on page)";
    btn.addEventListener('click', () => {
      btn.style.transform = 'scale(0.95)';
      setTimeout(() => { btn.style.transform = ''; }, 150);
      toggleFloatingPanel();
    });

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
  function handleAttendancePage() {
    const url = window.location.href;
    if (!url.includes('/mod/attendance/attendance.php') && !url.includes('/mod/attendance/take.php')) {
      if (url.includes('/mod/attendance/view.php') && /present|hadir|recorded/i.test(document.body.innerText)) {
        try { chrome.runtime.sendMessage({ type: 'DATA_UPDATED' }); } catch (e) {}
      }
      return;
    }

    const form = document.querySelector('form.mform, form[action*="attendance.php"], form');
    if (!form) return;

    const radios = Array.from(form.querySelectorAll('input[type="radio"][name="status"]'));
    if (radios.length === 0) return;

    // Find radio for Present / Hadir
    let presentRadio = null;
    for (const r of radios) {
      let text = '';
      if (r.id) {
        const lbl = document.querySelector(`label[for="${r.id}"]`);
        if (lbl) text += ' ' + lbl.textContent;
      }
      const container = r.closest('.form-check, .fitem, tr, td, div');
      if (container) text += ' ' + container.textContent;

      if (/present|hadir|\b[PH]\b/i.test(text)) {
        presentRadio = r;
        break;
      }
    }

    if (!presentRadio && radios.length > 0) {
      presentRadio = radios[0];
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

  // Run when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectFloatingButton();
      handleAttendancePage();
    });
  } else {
    injectFloatingButton();
    handleAttendancePage();
  }
})();
