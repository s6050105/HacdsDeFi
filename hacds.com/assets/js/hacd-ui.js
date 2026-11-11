// ============================================================================
// HACD 页增强：带 SVG 卡片 + 筛选 + 排序
// ----------------------------------------------------------------------------
// 原实现只有纯文字按钮列表（pick-item），无法按形状/样式/分数筛选，
// 也没有排序。这里移植 PC 钱包（wallet-app/renderer/app.js）的完整实现。
//
// 依赖：
//   window.DiamondScore          —— 5 维评分（本地算，与合约一致）
//   window.CreateDiamondImageTagSVG —— 钻石 SVG 渲染
//
// 状态：window._hacdUI = { shape, style, min, sort, sel }
// ============================================================================

(function () {
  'use strict';

  // HTML 文本 + **属性值** 双重转义。
  // ⚠ 必须转义引号：返回值既用于文本节点，也用于 data-name="…" 这样的属性。
  //   只转 <>& 时，一个含 " 的 name 就能闭合属性、注入任意标签
  //   （2026-11-12 审计 C-H1）。
  //   本文件有两个 IIFE，各自需要独立的 esc —— 这里这个是卡片渲染用的。
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const STATE = {
    shape: '',      // 形状筛选
    style: '',      // 样式/颜色筛选
    min: '',        // 最低分
    sort: 'scoreDesc',
    sel: null,      // 当前查看详情的钻石名
  };

  /** 给一颗钻石补齐评分维度 */
  function enrich(item) {
    const r = window.DiamondScore.analyse(item.name, item.number, item.visual_gene);
    // score 可能是 null（基因缺失，见 DiamondScore.analyse）。
    // 筛选/排序把它当成 -1，卡片上显示「—」，不能伪装成 0 分或某个具体分。
    return Object.assign({}, item, {
      score: r.score,
      scoreText: r.score == null ? '—' : String(r.score),
      dims: r,
    });
  }

  /** 渲染筛选栏。数据变化时返回筛选后的列表。 */
  function buildFilterBar(items, onChange) {
    const shapes = [...new Set(items.map(i => i.dims.shapes))].sort();
    const styles = [...new Set(items.map(i => i.dims.styles_or_color))].sort();
    const opt = (arr, sel) => '<option value="">全部</option>' +
      arr.map(v => `<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`).join('');
    const sopt = (v, lk) => `<option value="${v}"${STATE.sort === v ? ' selected' : ''}>${lk}</option>`;

    return `
      <div class="hacd-filter-bar">
        形状 <select id="hfShape">${opt(shapes, STATE.shape)}</select>
        样式 <select id="hfStyle">${opt(styles, STATE.style)}</select>
        最低分 <input id="hfMin" style="width:64px" value="${STATE.min}" placeholder="0">
        排序 <select id="hfSort">
          ${sopt('scoreDesc', '分数 高→低')}
          ${sopt('scoreAsc', '分数 低→高')}
          ${sopt('numAsc', '编号 小→大')}
          ${sopt('numDesc', '编号 大→小')}
          ${sopt('name', '名称')}
        </select>
        <button class="btn btn-ghost btn-xs" id="hfClear">清除</button>
      </div>`;
  }

  function wireFilterBar(root, rerender) {
    const g = id => root.querySelector(id);
    const bind = (sel, key) => {
      const el = g(sel);
      if (el) el.onchange = () => { STATE[key] = el.value; rerender(); };
    };
    bind('#hfShape', 'shape');
    bind('#hfStyle', 'style');
    bind('#hfMin', 'min');
    bind('#hfSort', 'sort');
    const clr = g('#hfClear');
    if (clr) clr.onclick = () => {
      STATE.shape = STATE.style = STATE.min = '';
      STATE.sort = 'scoreDesc';
      rerender();
    };
  }

  /** 应用筛选与排序 */
  function applyFilter(items) {
    let out = items.filter(i =>
      (!STATE.shape || i.dims.shapes === STATE.shape) &&
      (!STATE.style || i.dims.styles_or_color === STATE.style) &&
      (!STATE.min || i.score >= Number(STATE.min)));
    const cmp = {
      scoreDesc: (a, b) => b.score - a.score,
      scoreAsc:  (a, b) => a.score - b.score,
      numAsc:    (a, b) => Number(a.number) - Number(b.number),
      numDesc:   (a, b) => Number(b.number) - Number(a.number),
      name:      (a, b) => a.name.localeCompare(b.name),
    }[STATE.sort] || ((a, b) => b.score - a.score);
    return out.sort(cmp);
  }

  /** 渲染一张钻石卡片（带 SVG） */
  /**
   * 一张钻石卡片。
   *
   * 点击区域分两种（与 PC 钱包一致）：
   *   · 右上角圆点 .hc-check —— 只切换勾选，不弹窗
   *   · 卡片其它区域         —— 只弹详情，不改勾选
   *
   * @param {boolean} pickable 是否能勾选（合约池的钻石不可勾选）
   */
  function cardHtml(item, picked, pickable) {
    let svg = '';
    try { svg = window.CreateDiamondImageTagSVG(item.visual_gene, 96); } catch (e) { svg = ''; }
    const check = pickable === false
      ? ''
      : '<div class="hc-check' + (picked ? ' on' : '') + '" data-check="1"></div>';
    // ⚠ item.name 来自节点/索引器返回，是**外部数据**，四处都要转义
    //   （2026-11-12 审计 C-H1：原来全部裸拼，可注入任意 HTML/脚本）。
    return '<div class="hacd-card' + (picked ? ' picked' : '') +
      (STATE.sel === item.name ? ' on' : '') + '" data-name="' + esc(item.name) + '">' +
      check + svg +
      '<div class="hc-name">' + esc(item.name) + '</div>' +
      '<div class="hc-score">' + esc(item.scoreText) +
        (item.score == null ? '' : ' 分') + '</div>' +
      '</div>';
  }

  // ---- 对外接口 ----
  window.HacdUI = {
    enrich, buildFilterBar, wireFilterBar, applyFilter, cardHtml,
    get state() { return STATE; },
  };
})();
// ============================================================================
// HACD 详情面板（移植自 PC 钱包 showHacdDetail）
//
// 显示：大图、名字、编号、分数、形状、样式、命名加成、编号加成、视觉基因、
//       持有者、铭文。
// 网页端之前没有这个面板，导致用户无法判断一颗钻石的质量再决定是否赎回。
// ============================================================================

(function () {
  'use strict';

  // HTML 文本 + **属性值** 双重转义。
  // ⚠ 必须转义引号：这个函数的返回值既用于文本节点，也用于 data-name="…"
  //   这样的属性里。只转 <>& 时，一个含 " 的 name 就能闭合属性、
  //   注入任意标签（2026-11-12 审计 C-H1）。
  function escDetail(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /**
   * 在 #hacdRight 渲染一颗钻石的详情。
   * @param {object} i  { name, number, visual_gene, score, dims, belong?, inscriptions? }
   */
  /**
   * 在弹窗里显示钻石详情。
   *
   * 为什么用弹窗而不是常驻侧栏：双卡布局要保持简洁清爽，
   * 详情只在用户主动点开时出现，看完关掉。
   */
  function show(i) {
    const modal = document.getElementById('hacdModal');
    const body = document.getElementById('hacdModalBody');
    if (!modal || !body || !i) return;

    let svg = '';
    try { svg = window.CreateDiamondImageTagSVG(i.visual_gene || '', 240); } catch (e) { svg = ''; }

    const d = i.dims || {};
    // 「标签：值」连写，不用 space-between（会把两者推到两端，中间长空白）
    const row = (k, v, extra) => v == null || v === ''
      ? ''
      : `<div class="det-row"><span class="k">${escDetail(k)}</span><span class="v"${extra || ''}>${escDetail(v)}</span></div>`;

    body.innerHTML =
      '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">' +
        '<div style="flex:0 0 240px">' + svg + '</div>' +
        '<div class="det" style="flex:1;min-width:180px;font-size:12.5px">' +
          row('名称', i.name) +
          row('编号', i.number) +
          row('评分', i.score, ' style="color:var(--gold);font-weight:600"') +
          row('形状', d.shapes) +
          row('样式/颜色', d.styles_or_color) +
          row('命名加成', d.nameliteral) +
          row('编号加成', d.numberliteral) +
          row('视觉基因', i.visual_gene) +
          row('持有者', i.belong) +
          (i.inscriptions && i.inscriptions.length ? row('铭文', i.inscriptions.join(', ')) : '') +
        '</div>' +
      '</div>';
    modal.hidden = false;

    const close = document.getElementById('hacdModalClose');
    if (close) close.onclick = () => { modal.hidden = true; };
    modal.onclick = ev => { if (ev.target === modal) modal.hidden = true; };
  }

  window.HacdUI = window.HacdUI || {};
  window.HacdUI.showDetail = show;
})();
