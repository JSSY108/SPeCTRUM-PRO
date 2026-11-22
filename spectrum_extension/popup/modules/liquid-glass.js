/**
 * SPeCTRUM Pro - Liquid Glass & Custom Wallpaper Engine
 * Based on physics refraction algorithms by Archis Vaze (MIT License)
 * Optimized for Chromium extension environments.
 */

(function (window, document) {
  'use strict';

  // Surface height functions for physics-based lens refraction
  const SURFACE_FNS = {
    convex_squircle: (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25),
    convex_circle: (x) => Math.sqrt(1 - (1 - x) * (1 - x)),
    concave: (x) => 1 - Math.sqrt(1 - (1 - x) * (1 - x)),
    lip: (x) => {
      const convex = Math.pow(1 - Math.pow(1 - Math.min(x * 2, 1), 4), 0.25);
      const concave = 1 - Math.sqrt(1 - (1 - x) * (1 - x)) + 0.1;
      const t = 6 * Math.pow(x, 5) - 15 * Math.pow(x, 4) + 10 * Math.pow(x, 3);
      return convex * (1 - t) + concave * t;
    }
  };

  // Preset background gradient schemes
  const WALLPAPER_PRESETS = {
    'aurora': 'linear-gradient(135deg, #090d16 0%, #1e1b4b 35%, #064e3b 70%, #090d16 100%)',
    'sunset': 'linear-gradient(135deg, #18181b 0%, #451a03 35%, #701a75 70%, #18181b 100%)',
    'cyber': 'linear-gradient(135deg, #030712 0%, #172554 40%, #581c87 75%, #030712 100%)',
    'minimal': 'linear-gradient(135deg, #1e293b 0%, #334155 50%, #0f172a 100%)'
  };

  /**
   * Calculate 1D refraction displacement profile along bevel
   */
  function calculateRefractionProfile(glassThickness, bezelWidth, heightFn, ior, samples = 128) {
    const eta = 1 / Math.max(1.01, ior);
    function refract(nx, ny) {
      const dot = ny;
      const k = 1 - eta * eta * (1 - dot * dot);
      if (k < 0) return null;
      const sq = Math.sqrt(k);
      return [-(eta * dot + sq) * nx, eta - (eta * dot + sq) * ny];
    }
    const profile = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = i / samples;
      const y = heightFn(x);
      const dx = x < 1 ? 0.0001 : -0.0001;
      const y2 = heightFn(x + dx);
      const deriv = (y2 - y) / dx;
      const mag = Math.sqrt(deriv * deriv + 1);
      const ref = refract(-deriv / mag, -1 / mag);
      if (!ref) {
        profile[i] = 0;
        continue;
      }
      profile[i] = ref[0] * ((y * bezelWidth + glassThickness) / (ref[1] || 1));
    }
    return profile;
  }

  /**
   * Generate 2D displacement map canvas for SVG feDisplacementMap
   */
  function generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 128;
      d[i + 1] = 128;
      d[i + 2] = 0;
      d[i + 3] = 255;
    }

    const r = radius;
    const rSq = r * r;
    const r1Sq = Math.pow(r + 1, 2);
    const rBSq = Math.pow(Math.max(r - bezelWidth, 0), 2);
    const wB = w - r * 2;
    const hB = h - r * 2;
    const S = profile.length;

    for (let y1 = 0; y1 < h; y1++) {
      for (let x1 = 0; x1 < w; x1++) {
        const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
        const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
        const dSq = x * x + y * y;
        if (dSq > r1Sq || dSq < rBSq) continue;
        const dist = Math.sqrt(dSq);
        const fromSide = r - dist;
        const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
        if (op <= 0 || dist === 0) continue;
        const cos = x / dist;
        const sin = y / dist;
        const bi = Math.min(((fromSide / bezelWidth) * S) | 0, S - 1);
        const disp = profile[bi] || 0;
        const dX = (-cos * disp) / maxDisp;
        const dY = (-sin * disp) / maxDisp;
        const idx = (y1 * w + x1) * 4;
        d[idx] = (128 + dX * 127 * op + 0.5) | 0;
        d[idx + 1] = (128 + dY * 127 * op + 0.5) | 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  /**
   * Rebuild or update the global SVG liquid-glass-filter definition
   */
  function updateSvgLiquidGlassFilter(options = {}) {
    const defsEl = document.getElementById('liquid-glass-defs');
    if (!defsEl) return;

    const w = options.width || 420;
    const h = options.height || 180;
    const radius = options.radius || 16;
    const blurAmt = options.blur !== undefined ? options.blur : 16;
    const glassThickness = options.thickness || 8;
    const bezelW = options.bezel || 18;
    const ior = options.ior || 1.45;
    const specSat = options.specSat || 1.5;

    const heightFn = SURFACE_FNS.convex_squircle;
    const clampedBezel = Math.max(1, Math.min(bezelW, radius - 1, Math.min(w, h) / 2 - 1));
    const profile = calculateRefractionProfile(glassThickness, clampedBezel, heightFn, ior, 128);
    const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1;
    const dispUrl = generateDisplacementMap(w, h, radius, clampedBezel, profile, maxDisp);

    const filterMarkup = `
      <filter id="liquid-glass-filter" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${blurAmt}" result="blurred_source" />
        <feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" result="disp_map" />
        <feDisplacementMap in="blurred_source" in2="disp_map" scale="${maxDisp * 0.8}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
        <feColorMatrix in="displaced" type="saturate" values="${specSat}" result="displaced_sat" />
        <feBlend in="displaced_sat" in2="SourceGraphic" mode="normal" />
      </filter>
    `;

    defsEl.innerHTML = filterMarkup;
  }

  /**
   * Compress high-resolution uploaded images into a fast web-optimized Data URL
   */
  function compressUploadedImage(file, maxWidth = 1920, maxHeight = 1080) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        return reject(new Error('Please select an image file (PNG, JPG, WEBP).'));
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width;
          let h = img.height;
          if (w > maxWidth || h > maxHeight) {
            const ratio = Math.min(maxWidth / w, maxHeight / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Could not initialize image canvas.'));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('Failed to load image file.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Apply custom background image/gradient to the extension
   */
  function applyCustomWallpaper(bgValue, options = {}) {
    if (!bgValue) {
      removeCustomWallpaper(options.save !== false);
      return;
    }

    const bgLayer = document.getElementById('custom-bg-layer');
    if (bgLayer) {
      if (bgValue.startsWith('linear-gradient') || bgValue.startsWith('radial-gradient')) {
        bgLayer.style.backgroundImage = bgValue;
      } else {
        bgLayer.style.backgroundImage = `url("${bgValue}")`;
      }
    }

    document.documentElement.classList.add('has-custom-bg');
    document.body.classList.add('has-custom-bg');

    const style = options.style || 'liquid';
    if (style === 'liquid') {
      document.body.classList.add('is-liquid-glass');
    } else {
      document.body.classList.remove('is-liquid-glass');
    }

    // Set custom CSS variables
    const blur = options.blur !== undefined ? options.blur : 18;
    const tint = options.tint !== undefined ? options.tint : 28;
    document.documentElement.style.setProperty('--glass-blur', `${blur}px`);
    document.documentElement.style.setProperty('--glass-tint-op', `${tint / 100}`);

    // Update SVG filter
    try {
      updateSvgLiquidGlassFilter({ blur: Math.min(blur, 24) });
    } catch (e) {}

    // Update Preferences UI state if open
    updateWallpaperPrefUi(bgValue, { blur, tint, style });

    // Persist
    if (options.save !== false && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        customBgImage: bgValue,
        customBgBlur: blur,
        customBgTint: tint,
        customBgStyle: style
      });
      try {
        localStorage.setItem('spectrum_custom_bg', bgValue);
        localStorage.setItem('spectrum_glass_enabled', 'true');
      } catch (e) {}
    }
  }

  /**
   * Remove custom background and restore solid theme
   */
  function removeCustomWallpaper(save = true) {
    const bgLayer = document.getElementById('custom-bg-layer');
    if (bgLayer) {
      bgLayer.style.backgroundImage = '';
    }

    document.documentElement.classList.remove('has-custom-bg');
    document.body.classList.remove('has-custom-bg');
    document.body.classList.remove('is-liquid-glass');

    updateWallpaperPrefUi('', {});

    if (save && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        customBgImage: '',
        customBgStyle: 'off'
      });
      try {
        localStorage.removeItem('spectrum_custom_bg');
        localStorage.removeItem('spectrum_glass_enabled');
      } catch (e) {}
    }
  }

  /**
   * Sync visual state in Preferences UI
   */
  function updateWallpaperPrefUi(bgValue, settings = {}) {
    const badge = document.getElementById('pref-wallpaper-badge');
    const previewWrap = document.getElementById('wallpaper-preview-wrap');
    const btnRemove = document.getElementById('btn-remove-custom-bg');
    const tunerBox = document.getElementById('pref-glass-tuner-row');
    const urlInput = document.getElementById('input-custom-bg-url');
    const blurSlider = document.getElementById('slider-glass-blur');
    const blurLabel = document.getElementById('val-glass-blur-label');
    const tintSlider = document.getElementById('slider-glass-tint');
    const tintLabel = document.getElementById('val-glass-tint-label');
    const selStyle = document.getElementById('sel-glass-effect-style');

    const hasBg = Boolean(bgValue);

    if (badge) {
      badge.textContent = hasBg ? 'ACTIVE' : 'SOLID (OFF)';
      badge.className = hasBg ? 'pref-badge pref-badge-active' : 'pref-badge pref-badge-subtle';
    }
    if (btnRemove) {
      btnRemove.style.display = hasBg ? 'inline-block' : 'none';
    }
    if (tunerBox) {
      tunerBox.style.display = hasBg ? 'flex' : 'none';
    }
    if (previewWrap) {
      if (hasBg) {
        previewWrap.style.display = 'block';
        if (bgValue.startsWith('linear-gradient')) {
          previewWrap.style.backgroundImage = bgValue;
        } else {
          previewWrap.style.backgroundImage = `url("${bgValue}")`;
        }
      } else {
        previewWrap.style.display = 'none';
      }
    }
    if (urlInput && !hasBg) {
      urlInput.value = '';
    }

    if (settings.blur !== undefined && blurSlider && blurLabel) {
      blurSlider.value = settings.blur;
      blurLabel.textContent = `${settings.blur}px`;
    }
    if (settings.tint !== undefined && tintSlider && tintLabel) {
      tintSlider.value = settings.tint;
      tintLabel.textContent = `${settings.tint}%`;
    }
    if (settings.style && selStyle) {
      selStyle.value = settings.style;
    }
  }

  /**
   * Initialize event handlers in Preferences tab
   */
  function initWallpaperControls() {
    // 1. File Upload
    const fileInput = document.getElementById('input-custom-bg-file');
    if (fileInput && !fileInput._hasListener) {
      fileInput._hasListener = true;
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const dataUrl = await compressUploadedImage(file);
          const blur = parseInt(document.getElementById('slider-glass-blur')?.value, 10) || 18;
          const tint = parseInt(document.getElementById('slider-glass-tint')?.value, 10) || 28;
          const style = document.getElementById('sel-glass-effect-style')?.value || 'liquid';
          applyCustomWallpaper(dataUrl, { blur, tint, style });
        } catch (err) {
          alert(err.message || 'Error processing image.');
        } finally {
          fileInput.value = '';
        }
      });
    }

    // 2. URL Input
    const btnApplyUrl = document.getElementById('btn-apply-bg-url');
    const inputUrl = document.getElementById('input-custom-bg-url');
    if (btnApplyUrl && inputUrl && !btnApplyUrl._hasListener) {
      btnApplyUrl._hasListener = true;
      btnApplyUrl.addEventListener('click', () => {
        const url = inputUrl.value.trim();
        if (!url) return;
        const blur = parseInt(document.getElementById('slider-glass-blur')?.value, 10) || 18;
        const tint = parseInt(document.getElementById('slider-glass-tint')?.value, 10) || 28;
        const style = document.getElementById('sel-glass-effect-style')?.value || 'liquid';
        applyCustomWallpaper(url, { blur, tint, style });
      });
    }

    // 3. Remove Button
    const btnRemove = document.getElementById('btn-remove-custom-bg');
    if (btnRemove && !btnRemove._hasListener) {
      btnRemove._hasListener = true;
      btnRemove.addEventListener('click', () => {
        removeCustomWallpaper(true);
      });
    }

    // 4. Presets
    document.querySelectorAll('.pref-bg-preset-btn').forEach((btn) => {
      if (btn._hasListener) return;
      btn._hasListener = true;
      btn.addEventListener('click', () => {
        const key = btn.dataset.preset;
        const grad = WALLPAPER_PRESETS[key];
        if (grad) {
          const blur = parseInt(document.getElementById('slider-glass-blur')?.value, 10) || 18;
          const tint = parseInt(document.getElementById('slider-glass-tint')?.value, 10) || 28;
          const style = document.getElementById('sel-glass-effect-style')?.value || 'liquid';
          applyCustomWallpaper(grad, { blur, tint, style });
        }
      });
    });

    // 5. Sliders (Blur & Tint)
    const blurSlider = document.getElementById('slider-glass-blur');
    const blurLabel = document.getElementById('val-glass-blur-label');
    if (blurSlider && blurLabel && !blurSlider._hasListener) {
      blurSlider._hasListener = true;
      blurSlider.addEventListener('input', () => {
        const val = blurSlider.value;
        blurLabel.textContent = `${val}px`;
        document.documentElement.style.setProperty('--glass-blur', `${val}px`);
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ customBgBlur: parseInt(val, 10) });
        }
      });
    }

    const tintSlider = document.getElementById('slider-glass-tint');
    const tintLabel = document.getElementById('val-glass-tint-label');
    if (tintSlider && tintLabel && !tintSlider._hasListener) {
      tintSlider._hasListener = true;
      tintSlider.addEventListener('input', () => {
        const val = tintSlider.value;
        tintLabel.textContent = `${val}%`;
        document.documentElement.style.setProperty('--glass-tint-op', `${val / 100}`);
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ customBgTint: parseInt(val, 10) });
        }
      });
    }

    // 6. Style Selector
    const selStyle = document.getElementById('sel-glass-effect-style');
    if (selStyle && !selStyle._hasListener) {
      selStyle._hasListener = true;
      selStyle.addEventListener('change', () => {
        const style = selStyle.value;
        if (style === 'liquid') {
          document.body.classList.add('is-liquid-glass');
        } else {
          document.body.classList.remove('is-liquid-glass');
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ customBgStyle: style });
        }
      });
    }
  }

  // Load and apply on startup
  function loadSavedCustomWallpaper() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        ['customBgImage', 'customBgBlur', 'customBgTint', 'customBgStyle'],
        (res) => {
          if (res && res.customBgImage) {
            let savedTint = res.customBgTint !== undefined ? res.customBgTint : 28;
            // Auto-migrate legacy high opacity (>= 70%) to realistic translucent glass range
            if (savedTint >= 70) {
              savedTint = 28;
              chrome.storage.local.set({ customBgTint: 28 });
            }
            applyCustomWallpaper(res.customBgImage, {
              blur: res.customBgBlur || 18,
              tint: savedTint,
              style: res.customBgStyle || 'liquid',
              save: false
            });
          }
        }
      );
    } else {
      try {
        const saved = localStorage.getItem('spectrum_custom_bg');
        if (saved) {
          applyCustomWallpaper(saved, { save: false });
        }
      } catch (e) {}
    }
  }

  // Export on window
  window.LiquidGlass = {
    applyCustomWallpaper,
    removeCustomWallpaper,
    initWallpaperControls,
    loadSavedCustomWallpaper,
    compressUploadedImage,
    updateSvgLiquidGlassFilter
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadSavedCustomWallpaper();
      initWallpaperControls();
    });
  } else {
    loadSavedCustomWallpaper();
    initWallpaperControls();
  }

})(window, document);
