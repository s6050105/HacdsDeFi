/* ==========================================================================
   hacds.com/docs — 文档页逻辑（滚动高亮目录）
   ========================================================================== */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    window.I18N.init();

    const links = Array.from(document.querySelectorAll('.docs-nav a[href^="#"]'));
    const sections = links
      .map(a => document.querySelector(a.getAttribute('href')))
      .filter(Boolean);

    if (!sections.length) return;

    // 滚动时高亮当前章节
    const onScroll = () => {
      const y = window.scrollY + 120;
      let cur = sections[0];
      for (const sec of sections) {
        if (sec.offsetTop <= y) cur = sec;
      }
      links.forEach(a => {
        a.classList.toggle('on', a.getAttribute('href') === '#' + cur.id);
      });
    };

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { onScroll(); ticking = false; });
    }, { passive: true });

    onScroll();
  });
})();
