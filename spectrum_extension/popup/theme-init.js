// Immediate early theme application to eliminate light-flash (FOUC)
try {
  var savedTheme = localStorage.getItem('spectrum_theme');
  if (savedTheme === 'dark' || (!savedTheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
} catch (e) {}

