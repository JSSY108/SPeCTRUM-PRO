// Immediate early theme & surface mode application to eliminate light-flash and layout flash (FOUC)
(function() {
  try {
    var savedTheme = localStorage.getItem('spectrum_theme');
    var customBg = localStorage.getItem('spectrum_custom_bg');

    if (customBg) {
      var thumbVal = (customBg.indexOf('linear-gradient') === 0 || customBg.indexOf('radial-gradient') === 0)
        ? customBg
        : 'url("' + customBg + '")';
      document.documentElement.style.setProperty('--glass-thumb-bg', thumbVal);
    }

    if (savedTheme === 'glass' || (!savedTheme && customBg)) {
      document.documentElement.setAttribute('data-theme', 'glass');
      document.documentElement.classList.add('has-custom-bg');
      var applyBgToBody = function() {
        if (!document.body) return false;
        document.body.classList.add('has-custom-bg');
        document.body.setAttribute('data-theme', 'glass');
        return true;
      };
      if (!applyBgToBody()) {
        document.addEventListener('DOMContentLoaded', applyBgToBody);
      }
    } else if (savedTheme === 'dark' || (!savedTheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
      var applyDarkToBody = function() {
        if (!document.body) return false;
        document.body.setAttribute('data-theme', 'dark');
        return true;
      };
      if (!applyDarkToBody()) {
        document.addEventListener('DOMContentLoaded', applyDarkToBody);
      }
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      var applyLightToBody = function() {
        if (!document.body) return false;
        document.body.setAttribute('data-theme', 'light');
        return true;
      };
      if (!applyLightToBody()) {
        document.addEventListener('DOMContentLoaded', applyLightToBody);
      }
    }
  } catch (e) {}

  try {
    var search = window.location.search || '';
    var isFullTab = search.indexOf('mode=full') !== -1;
    var isSidePanel = search.indexOf('mode=sidepanel') !== -1;
    var isDrawer = search.indexOf('mode=drawer') !== -1;
    var isDetached = search.indexOf('mode=detached') !== -1;
    var isFloating = search.indexOf('mode=floating') !== -1;
    var isPinned = isSidePanel || isDrawer || isDetached || isFloating;

    var classesToApply = [];
    if (isFullTab) classesToApply.push('is-full-tab');
    if (isPinned) classesToApply.push('is-pinned-mode');
    if (isSidePanel) classesToApply.push('is-sidepanel');
    if (isDrawer) classesToApply.push('is-drawer');
    if (isDetached) classesToApply.push('is-detached-window');
    if (isFloating) classesToApply.push('is-floating-mode');

    if (classesToApply.length > 0) {
      for (var i = 0; i < classesToApply.length; i++) {
        document.documentElement.classList.add(classesToApply[i]);
      }

      var applyToBody = function() {
        if (!document.body) return false;
        for (var j = 0; j < classesToApply.length; j++) {
          document.body.classList.add(classesToApply[j]);
        }
        return true;
      };

      if (!applyToBody()) {
        var bodyObs = new MutationObserver(function() {
          if (applyToBody()) {
            bodyObs.disconnect();
          }
        });
        bodyObs.observe(document.documentElement, { childList: true });

        document.addEventListener('DOMContentLoaded', function() {
          applyToBody();
          bodyObs.disconnect();
        }, { once: true });
      }
    }
  } catch (e) {}
})();
