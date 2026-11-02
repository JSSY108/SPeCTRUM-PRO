/**
 * SPeCTRUM PRO — PPTX Reader Extension Page Controller
 * Powered by pptx-viewer library (https://github.com/mdurbar/pptx-viewer)
 */

(function () {
  'use strict';

  // 1. Resolve PPTXViewer class from library
  const ViewerClass = (window.PPTXViewer && window.PPTXViewer.PPTXViewer) || window.PPTXViewer;
  if (!ViewerClass) {
    console.error('SPeCTRUM PRO: pptx-viewer library failed to load.');
    return;
  }

  // 2. DOM Elements
  const container = document.getElementById('pptx-viewer');
  const docTitleEl = document.getElementById('doc-title');
  const slideCounterEl = document.getElementById('slide-counter');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnOpenFile = document.getElementById('btn-open-file');
  const fileInput = document.getElementById('file-input');
  const btnOpenUrl = document.getElementById('btn-open-url');
  const btnFullscreen = document.getElementById('btn-fullscreen');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  const dropzone = document.getElementById('dropzone');

  let viewer = null;

  // 3. Theme Synchronization
  try {
    const savedTheme = localStorage.getItem('spectrum_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.body.setAttribute('data-theme', savedTheme);
  } catch (e) {}

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('spectrum_theme', (res) => {
      if (res && res.spectrum_theme) {
        document.documentElement.setAttribute('data-theme', res.spectrum_theme);
        document.body.setAttribute('data-theme', res.spectrum_theme);
      }
    });
  }

  // 4. Initialize PPTXViewer Instance
  function initViewer() {
    if (viewer) {
      try { viewer.destroy(); } catch (e) {}
      viewer = null;
    }

    container.innerHTML = '';

    viewer = new ViewerClass(container, {
      keyboardNavigation: true,
      showControls: true,
      onSlideChange: (index) => {
        updateSlideStatus(index);
      },
      onLoad: (presentation) => {
        hideLoading();
        const total = presentation?.slides?.length || viewer.getSlideCount() || 1;
        updateSlideStatus(viewer.getCurrentSlide(), total);
      },
      onError: (err) => {
        hideLoading();
        console.error('PPTX Viewer Error:', err);
        alert('Failed to render PowerPoint presentation: ' + (err.message || err));
      }
    });

    if (viewer.on) {
      viewer.on('slidechange', (index) => updateSlideStatus(index));
      viewer.on('load', (pres) => {
        hideLoading();
        updateSlideStatus(viewer.getCurrentSlide(), pres?.slides?.length || viewer.getSlideCount());
      });
      viewer.on('error', () => hideLoading());
    }
  }

  function showLoading(msg = 'Rendering presentation...') {
    if (loadingText) loadingText.textContent = msg;
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }

  function updateSlideStatus(current, total) {
    if (!viewer) return;
    const curIdx = typeof current === 'number' ? current : viewer.getCurrentSlide();
    const count = typeof total === 'number' ? total : viewer.getSlideCount();
    const currentNum = curIdx + 1;

    if (slideCounterEl) {
      slideCounterEl.textContent = count > 0 ? `${currentNum} / ${count}` : '-- / --';
    }

    if (btnPrev) btnPrev.disabled = curIdx <= 0;
    if (btnNext) btnNext.disabled = curIdx >= count - 1;
  }

  // 5. Load Presentation from Source (File, Blob, ArrayBuffer, URL)
  async function loadPresentation(source, title = 'Presentation') {
    if (!source) return;
    showLoading('Parsing presentation structure...');
    if (docTitleEl) docTitleEl.textContent = title;
    document.title = (title ? `${title} — ` : '') + 'SPeCTRUM PRO PPTX Reader';

    try {
      if (!viewer) initViewer();

      // If source is a URL string, fetch with CORS safety as ArrayBuffer
      if (typeof source === 'string') {
        try {
          const resp = await fetch(source, { mode: 'cors' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const ab = await resp.arrayBuffer();
          await viewer.load(ab);
        } catch (fetchErr) {
          // If direct fetch fails, pass URL directly to library load
          await viewer.load(source);
        }
      } else if (source instanceof Blob && !(source instanceof File)) {
        // Convert plain Blob to ArrayBuffer
        const ab = await source.arrayBuffer();
        await viewer.load(ab);
      } else {
        // File, ArrayBuffer, or Uint8Array
        await viewer.load(source);
      }

      hideLoading();
      updateSlideStatus(viewer.getCurrentSlide(), viewer.getSlideCount());
    } catch (err) {
      hideLoading();
      console.error('Failed to load presentation:', err);
      alert('Unable to load presentation: ' + (err.message || err));
    }
  }

  // 6. UI Controls Event Listeners
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (viewer) viewer.previous();
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (viewer) viewer.next();
    });
  }

  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      if (viewer) viewer.toggleFullscreen();
    });
  }

  if (btnOpenFile && fileInput) {
    btnOpenFile.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      await loadPresentation(file, file.name);
      fileInput.value = '';
    });
  }

  if (btnOpenUrl) {
    btnOpenUrl.addEventListener('click', async () => {
      const url = prompt('Enter PowerPoint presentation URL (.pptx):');
      if (url && url.trim()) {
        const cleanUrl = url.trim();
        const filename = cleanUrl.split('/').pop().split('?')[0] || 'Remote Presentation';
        await loadPresentation(cleanUrl, filename);
      }
    });
  }

  // 7. Drag-and-drop PPTX Files
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dropzone) dropzone.classList.add('dragover');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null && dropzone) {
      dropzone.classList.remove('dragover');
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (dropzone) dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.name.endsWith('.pptx') || file.type.includes('presentation'))) {
      await loadPresentation(file, file.name);
    }
  });

  // 8. Auto-resize when window dimensions change
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (viewer && viewer.getPresentation()) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        viewer.goToSlide(viewer.getCurrentSlide());
      }, 100);
    }
  });

  // 9. Auto-load from Query Params or Chrome Storage
  async function checkInitialLoad() {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    const titleParam = params.get('title') || params.get('name');

    if (urlParam) {
      await loadPresentation(urlParam, titleParam || 'Presentation');
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['pending_pptx_preview', 'active_doc_preview'], async (data) => {
        const target = data.pending_pptx_preview || data.active_doc_preview;
        if (target && target.type === 'pptx') {
          if (target.url) {
            await loadPresentation(target.url, target.title || 'Presentation');
            // Clean up once consumed
            chrome.storage.local.remove('pending_pptx_preview');
          }
        }
      });
    }
  }

  // Ready!
  checkInitialLoad();
})();
