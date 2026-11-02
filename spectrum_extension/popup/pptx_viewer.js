/**
 * SPeCTRUM PRO — PPTX Reader Extension Page Controller
 * Powered by ChristopherVR OOXML Viewer (viewers/pptx v3.61.0)
 * Strictly Pure View Mode: No edit panels, no edit handles, high-fidelity rendering
 */

(function () {
  'use strict';

  // 1. Resolve ChristopherVR createPptxViewer factory
  const createViewerFn = (window.pptxVanillaBundle && window.pptxVanillaBundle.createPptxViewer) ||
                         window.createPptxViewer;

  if (!createViewerFn) {
    console.error('SPeCTRUM PRO: ChristopherVR OOXML engine failed to load.');
    alert('SPeCTRUM PRO: Failed to load ChristopherVR OOXML engine. Verify bundle file.');
    return;
  }

  // 2. DOM Elements
  const hostEl = document.getElementById('pptx-viewer');
  const docTitleEl = document.getElementById('doc-title');
  const inputSlide = document.getElementById('input-slide');
  const slideTotalEl = document.getElementById('slide-total');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnThumbnails = document.getElementById('btn-thumbnails');
  const btnFit = document.getElementById('btn-fit');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnOpenFile = document.getElementById('btn-open-file');
  const fileInput = document.getElementById('file-input');
  const btnOpenUrl = document.getElementById('btn-open-url');
  const btnFullscreen = document.getElementById('btn-fullscreen');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  const dropzone = document.getElementById('dropzone');

  let viewer = null;
  let totalSlides = 0;
  let currentSlideIndex = 0;
  let currentSource = null;
  let currentTitle = 'Presentation';

  // 3. Theme Synchronization
  let isDarkTheme = true;
  try {
    const savedTheme = localStorage.getItem('spectrum_theme') || 'dark';
    isDarkTheme = savedTheme !== 'light';
    document.documentElement.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
    document.body.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
  } catch (e) {}

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('spectrum_theme', (res) => {
      if (res && res.spectrum_theme) {
        isDarkTheme = res.spectrum_theme !== 'light';
        document.documentElement.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
        document.body.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
      }
    });
  }

  // 4. Loading Overlay Helpers
  function showLoading(msg = 'Rendering presentation...') {
    if (loadingText) loadingText.textContent = msg;
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }

  // 5. Update Navigation Controls State
  function updateNavigationUI() {
    if (totalSlides > 0) {
      if (inputSlide) {
        inputSlide.value = currentSlideIndex + 1;
        inputSlide.max = totalSlides;
        inputSlide.disabled = false;
      }
      if (slideTotalEl) slideTotalEl.textContent = `/ ${totalSlides}`;
      if (btnPrev) btnPrev.disabled = currentSlideIndex <= 0;
      if (btnNext) btnNext.disabled = currentSlideIndex >= totalSlides - 1;
      if (btnThumbnails) btnThumbnails.disabled = false;
      if (btnFit) btnFit.disabled = false;
      if (btnZoomIn) btnZoomIn.disabled = false;
      if (btnZoomOut) btnZoomOut.disabled = false;
      if (btnFullscreen) btnFullscreen.disabled = false;
    } else {
      if (inputSlide) {
        inputSlide.value = '';
        inputSlide.disabled = true;
      }
      if (slideTotalEl) slideTotalEl.textContent = '/ --';
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      if (btnThumbnails) btnThumbnails.disabled = true;
      if (btnFit) btnFit.disabled = true;
      if (btnZoomIn) btnZoomIn.disabled = true;
      if (btnZoomOut) btnZoomOut.disabled = true;
      if (btnFullscreen) btnFullscreen.disabled = true;
    }
  }

  // 6. Load Presentation into Viewer (Pure View Mode)
  async function loadPresentation(source, title = 'Presentation') {
    if (!source) return;
    showLoading('Parsing presentation structure...');
    currentSource = source;
    currentTitle = title;

    if (docTitleEl) docTitleEl.textContent = title;
    document.title = (title ? `${title} — ` : '') + 'SPeCTRUM PRO PPTX Reader';

    if (dropzone) dropzone.style.display = 'none';

    try {
      if (viewer) {
        try { viewer.destroy(); } catch (e) {}
        viewer = null;
      }

      // If source is a URL string, try fetching as ArrayBuffer first to avoid CORS quirks
      let presentationSource = source;
      if (typeof source === 'string') {
        try {
          const resp = await fetch(source, { mode: 'cors' });
          if (resp.ok) {
            presentationSource = await resp.arrayBuffer();
          }
        } catch (fetchErr) {
          // If fetch fails, pass URL directly to engine
          presentationSource = source;
        }
      }

      hostEl.innerHTML = '';

      viewer = createViewerFn(hostEl, {
        source: presentationSource,
        locale: 'en',
        editable: false,                // Disables element selection, movement, resize, rotation
        readOnly: true,                 // Pure read-only viewing
        showToolbar: false,             // Suppresses all edit ribbon tabs
        showThumbnails: true,           // Slide thumbnails rail on the left
        showInspector: false,           // Completely removes property inspector panel
        showFormatToolbar: false,       // Suppresses formatting toolbar
        showCompatibilityToasts: false, // Suppresses toast warning popups
        customization: {
          hiddenPanels: [
            'inspector',
            'selectionPane',
            'findReplace',
            'accessibilityPane',
            'comparePane',
            'notes',
            'quickAccessToolbar',
            'titleBar'
          ],
          disabledFeatures: ['ai', 'collaboration', 'comments', 'editPoints'],
          capabilities: {
            edit: false,
            comment: false
          }
        },
        fitPadding: 16,
        theme: isDarkTheme ? (window.pptxVanillaBundle?.vermilionDarkTheme || { colors: { primary: '#fb923c' } }) 
                           : (window.pptxVanillaBundle?.vermilionLightTheme || { colors: { primary: '#0284c7' } }),
        onLoad: ({ slideCount }) => {
          hideLoading();
          totalSlides = slideCount;
          currentSlideIndex = 0;
          updateNavigationUI();

          setTimeout(() => {
            try { viewer.zoomToFit?.(); } catch (e) {}
          }, 120);
        },
        onSlideChange: (idx) => {
          currentSlideIndex = idx;
          updateNavigationUI();
        },
        onError: (err) => {
          hideLoading();
          console.error('PPTX Viewer Error:', err);
          alert('Failed to render PowerPoint presentation: ' + (err.message || err));
        }
      });

    } catch (err) {
      hideLoading();
      console.error('Failed to load presentation:', err);
      alert('Unable to load presentation: ' + (err.message || err));
      if (dropzone) dropzone.style.display = 'flex';
    }
  }

  // 7. Navigation & View Controls
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (viewer) viewer.prev();
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (viewer) viewer.next();
    });
  }

  if (inputSlide) {
    inputSlide.addEventListener('change', () => {
      if (!viewer || totalSlides <= 0) return;
      let target = parseInt(inputSlide.value, 10);
      if (isNaN(target)) target = 1;
      target = Math.max(1, Math.min(totalSlides, target));
      viewer.goToSlide(target - 1);
    });

    inputSlide.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inputSlide.blur();
    });
  }

  if (btnThumbnails) {
    btnThumbnails.addEventListener('click', () => {
      const thumbsEl = hostEl.querySelector('.pptxv-thumbs');
      if (thumbsEl) {
        thumbsEl.classList.toggle('is-hidden');
        const isHidden = thumbsEl.classList.contains('is-hidden');
        btnThumbnails.style.opacity = isHidden ? '0.6' : '1';
        setTimeout(() => {
          try { viewer.zoomToFit?.(); } catch (e) {}
        }, 80);
      }
    });
  }

  if (btnFit) {
    btnFit.addEventListener('click', () => {
      if (viewer) {
        try {
          if (viewer.zoomToFit) viewer.zoomToFit();
          else if (viewer.setZoom) viewer.setZoom('fit');
        } catch (e) {}
      }
    });
  }

  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      if (viewer) {
        try {
          if (viewer.zoomIn) viewer.zoomIn();
        } catch (e) {}
      }
    });
  }

  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      if (viewer) {
        try {
          if (viewer.zoomOut) viewer.zoomOut();
        } catch (e) {}
      }
    });
  }

  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', async () => {
      if (viewer) {
        try {
          if (viewer.enterPresentation) {
            await viewer.enterPresentation();
          }
        } catch (err) {
          console.warn('Fullscreen presentation failed:', err);
        }
      }
    });
  }

  // 8. Open Local File & Remote URL
  if (btnOpenFile && fileInput) {
    btnOpenFile.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      await loadPresentation(file, file.name);
      fileInput.value = '';
    });
  }

  if (dropzone) {
    dropzone.addEventListener('click', () => {
      if (fileInput) fileInput.click();
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

  // 9. Drag-and-drop PPTX Files
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

  // 10. Keyboard Navigation Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      if (viewer) viewer.prev();
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      if (viewer) viewer.next();
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (viewer) viewer.goToSlide(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (viewer && totalSlides > 0) viewer.goToSlide(totalSlides - 1);
    } else if (e.key === 'F5') {
      e.preventDefault();
      if (viewer) viewer.enterPresentation?.();
    }
  });

  // 11. Auto-resize when window dimensions change
  window.addEventListener('resize', () => {
    if (viewer && totalSlides > 0) {
      try { viewer.zoomToFit?.(); } catch (e) {}
    }
  });

  // 12. Auto-load from Query Params or Chrome Storage
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
            chrome.storage.local.remove('pending_pptx_preview');
          }
        }
      });
    }
  }

  // Initialize
  checkInitialLoad();
})();