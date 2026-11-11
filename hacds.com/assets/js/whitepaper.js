/* ==========================================================================
   hacds.com/whitepaper — 加载并渲染白皮书
   ========================================================================== */
(function () {
  'use strict';

  const SOURCES = {
    zh: '/whitepaper/HacdsDeFi-白皮书.md',
    en: '/whitepaper/HacdsDeFi-Whitepaper.en.md',
    tr: '/whitepaper/HacdsDeFi-Whitepaper.tr.md',
  };

  let loadedLang = null;

  async function load(lang) {
    if (loadedLang === lang) return;
    const body = document.getElementById('wpBody');
    if (!body) return;

    const url = SOURCES[lang] || SOURCES.zh;
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const md = await r.text();
      body.innerHTML = window.MiniMD.render(md);
      loadedLang = lang;
    } catch (e) {
      // 英文/土耳其语缺失时回退中文
      if (lang !== 'zh') {
        try {
          const r2 = await fetch(SOURCES.zh, { cache: 'no-cache' });
          const md2 = await r2.text();
          body.innerHTML = window.MiniMD.render(md2);
          loadedLang = 'zh';
          return;
        } catch (e2) { /* fall through */ }
      }
      body.innerHTML = '<p class="dim">'
        + (window.I18N ? window.I18N.t('wp.loadFail') : 'Failed to load')
        + '</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.I18N.init();
    load(window.I18N.lang);
    window.addEventListener('langchange', e => load(e.detail));
  });
})();
