/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 *
 * Light / dark / auto toggle, mirroring the themakR light switch. The chosen
 * mode is persisted in localStorage and applied across all site pages.
 */
(function () {
  var modes = ['auto', 'light', 'dark'];
  var labels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var root = document.documentElement;
  var btn = document.getElementById('lightswitch');

  var saved = null;
  try {
    saved = localStorage.getItem('slr-theme');
  } catch (e) {}
  if (saved && modes.indexOf(saved) !== -1) {
    root.setAttribute('data-theme', saved);
    if (btn) btn.textContent = labels[saved];
  }

  if (btn) {
    btn.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme') || 'auto';
      var next = modes[(modes.indexOf(cur) + 1) % modes.length];
      root.setAttribute('data-theme', next);
      btn.textContent = labels[next];
      try {
        localStorage.setItem('slr-theme', next);
      } catch (e) {}
    });
  }
})();
