/* ==========================================================================
   hacds.com — 通用 Markdown 文档查看器
   --------------------------------------------------------------------------
   白皮书 / 使用说明 / RPC 文档共用一个渲染器。每页只需在 body 上声明：

       <body data-doc="wp">
       <script>
         window.HACDS_DOC = {
           zh: '/whitepaper/HacdsDeFi-白皮书.md',
           en: '/whitepaper/HacdsDeFi-Whitepaper.en.md',
           tr: '/whitepaper/HacdsDeFi-Whitepaper.tr.md',
         };
       </script>

   设计要点：
     1. 语言切换复用全局 I18N 的 langchange 事件，不另造一套。
     2. 某语言缺文件时回退中文，而不是显示空白 —— 宁可内容语言不对，
        也不能让用户看到空页面。
     3. 下载区按语言高亮对应 PDF，用户不必自己找。

   ⚠ 这里只做「读 + 渲染」，不解析任何用户输入。MiniMD 只处理白名单语法。
   ========================================================================== */
(function () {
  'use strict';

  let loadedLang = null;
  let inflight = 0;

  function srcFor(lang) {
    const S = window.HACDS_DOC || {};
    return S[lang] || S.zh;
  }

  /** 高亮当前语言对应的下载按钮。 */
  function highlightDownloads(lang) {
    document.querySelectorAll('[data-dl-lang]').forEach(el => {
      el.classList.toggle('btn-primary', el.dataset.dlLang === lang);
      el.classList.toggle('btn-ghost', el.dataset.dlLang !== lang);
    });
  }

  async function fetchMd(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  /** 正文容器：新页面用 docBody，白皮书页沿用旧的 wpBody。 */
  function bodyEl() {
    return document.getElementById('docBody') || document.getElementById('wpBody');
  }

  async function load(lang) {
    const body = bodyEl();
    if (!body) return;
    if (loadedLang === lang) return;

    // 竞态保护：语言切得快时，后发的请求可能先返回。
    // 用 token 保证只有最后一次生效，否则界面会停在错误的语言上。
    const token = ++inflight;

    try {
      const md = await fetchMd(srcFor(lang));
      if (token !== inflight) return;
      body.innerHTML = window.MiniMD.render(md);
      loadedLang = lang;
    } catch (e) {
      // 当前语言缺失 → 回退中文（不是显示错误，是显示另一种语言的内容）
      if (lang !== 'zh') {
        try {
          const md2 = await fetchMd(srcFor('zh'));
          if (token !== inflight) return;
          body.innerHTML = window.MiniMD.render(md2);
          loadedLang = 'zh';
          return;
        } catch (e2) { /* 落下去显示错误 */ }
      }
      if (token !== inflight) return;
      body.innerHTML = '<p class="dim">'
        + (window.I18N ? window.I18N.t('wp.loadFail') : 'Failed to load')
        + '</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!window.HACDS_DOC) return;
    window.I18N.init();
    const lang = window.I18N.lang;
    load(lang);
    highlightDownloads(lang);
    window.addEventListener('langchange', e => {
      load(e.detail);
      highlightDownloads(e.detail);
    });
  });
})();
