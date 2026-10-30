// SPeCTRUM Pro Content Script - Injected on spectrum.um.edu.my
(function () {
  'use strict';

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

    btn.title = "Click SPeCTRUM Pro extension icon in your browser toolbar to download materials!";
    btn.addEventListener('click', () => {
      // Prompt user to click the toolbar icon
      btn.style.transform = 'scale(0.95)';
      setTimeout(() => { btn.style.transform = ''; }, 150);
      alert("🎓 SPeCTRUM Pro is active!\n\nClick the SPeCTRUM Pro icon in your Edge/Chrome toolbar (top-right extension puzzle piece) to select courses and download materials as an organized ZIP.");
    });

    document.body.appendChild(btn);
  }

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
