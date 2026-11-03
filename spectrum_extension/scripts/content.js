// SPeCTRUM Pro Content Script - Injected on spectrum.um.edu.my
(function () {
  'use strict';

  // Toggle in-page pinned drawer (never disappears when clicking blank space on the page)
  function toggleInPageDrawer(forceOpen = false) {
    let drawer = document.getElementById('spectrum-pro-inpage-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'spectrum-pro-inpage-drawer';
      const frameUrl = chrome.runtime.getURL('popup/popup.html?mode=drawer');
      drawer.innerHTML = `
        <div id="spectrum-pro-drawer-header">
          <div id="spectrum-pro-drawer-header-title">
            <span style="font-weight:800;font-size:12px;letter-spacing:0.5px;">SPeCTRUM PRO</span>
            <span class="spectrum-drawer-pin-pill">📌 PINNED</span>
          </div>
          <button type="button" id="spectrum-pro-drawer-close" title="Close Panel" aria-label="Close">✕</button>
        </div>
        <iframe src="${frameUrl}" id="spectrum-pro-drawer-frame" allow="clipboard-read; clipboard-write"></iframe>
      `;
      document.body.appendChild(drawer);

      const closeBtn = drawer.querySelector('#spectrum-pro-drawer-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          drawer.classList.add('drawer-hidden');
        });
      }

      window.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'CLOSE_SPECTRUM_DRAWER') {
          drawer.classList.add('drawer-hidden');
        }
      });
      return;
    }

    if (forceOpen) {
      drawer.classList.remove('drawer-hidden');
    } else {
      drawer.classList.toggle('drawer-hidden');
    }
  }

  // Inject floating button if on SPeCTRUM
  function injectFloatingButton() {
    if (document.getElementById('spectrum-pro-floating-btn')) return;

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
      toggleInPageDrawer();
    });

    document.body.appendChild(btn);
  }

  // Listen for messages from popup or background to open in-page drawer
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'OPEN_INPAGE_DRAWER') {
      toggleInPageDrawer(true);
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === 'TOGGLE_INPAGE_DRAWER') {
      toggleInPageDrawer();
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
