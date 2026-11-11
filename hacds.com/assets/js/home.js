/* ==========================================================================
   hacds.com — 主页逻辑
   ========================================================================== */
(function () {
  'use strict';

  const API = window.HacdsAPI;
  const CFG = window.HACDS_CONFIG;

  /* ---------- 初始化 ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    window.I18N.init();

    // 横幅关闭
    const banner = document.getElementById('banner');
    const close = document.getElementById('bannerClose');
    if (localStorage.getItem('hacds.bannerClosed') === '1') banner.classList.add('hidden');
    close.addEventListener('click', () => {
      banner.classList.add('hidden');
      localStorage.setItem('hacds.bannerClosed', '1');
    });

    // 合约地址
    const sc = document.getElementById('statContract');
    if (sc) {
      sc.textContent = API.shortAddr(CFG.contract);
      sc.title = CFG.contract;
      sc.addEventListener('click', e => {
        e.preventDefault();
        window.open('https://explorer.hacash.org/address/' + CFG.contract, '_blank');
      });
    }

    // 验证器
    document.getElementById('verifyRun').addEventListener('click', runVerify);

    // 源码链接
    const src = document.getElementById('srcLink');
    if (src) src.href = CFG.links.github || '#';

    // 静态数据先渲染
    document.getElementById('statSupply').textContent = CFG.asset.supplyHuman;
    document.getElementById('statSerial').textContent = CFG.asset.serial;
    // decimal 卡片以前是硬编码 8，与副标题（由 i18n 写「0 位」）自相矛盾。
    // 改为从 config 读取，与其余三张卡片一致。
    const sd = document.getElementById('statDecimal');
    if (sd) sd.textContent = String(CFG.asset.decimal);

    // 尝试拉实时数据（失败不影响页面）
    loadLiveStats();
  });

  /* ---------- 实时统计 ---------- */

  async function loadLiveStats() {
    try {
      const st = await API.protocolState();
      // 协议状态可用时，把 Hero 的静态数字换成实时值
      // （#3000 未部署时这些会是 null，保持静态值即可）
      if (st && st.poolPrice != null && Number(st.poolPrice) > 0) {
        // 池子有流动性时展示实时价格
        const el = document.getElementById('statSerial');
        if (el) el.title = 'pool price: ' + (Number(st.poolPrice) / 1e8).toFixed(8);
      }
    } catch (e) {
      // 静默：官网首屏不因节点不可用而报错
    }
  }

  /* ---------- 发行量验证 ---------- */

  let verifying = false;

  async function runVerify() {
    if (verifying) return;
    const btn = document.getElementById('verifyRun');
    const status = document.getElementById('vStatus');
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

    verifying = true;
    btn.disabled = true;
    btn.textContent = window.I18N.t('verify.running');
    status.className = 'v';
    status.textContent = '—';

    try {
      // 1) 拉全网 HACD 列表（浏览器提供分页接口）
      const list = await fetchAllDiamonds();
      if (!list.length) throw new Error('empty');

      // 2) 逐颗算分（本地算法，与合约 SCORE_SCALE 一致）
      let sum = 0;
      for (const d of list) {
        sum += scoreOf(d.name, d.visual_gene, d.number);
      }

      const count = list.length;
      const avg = sum / count;
      // 分数总量 = 均分 × HACD 总发行量
      const pointsTotal = Math.floor(avg * CFG.issuance.hacdTotal);
      // 铸发 atoms = 分数 × SCORE_SCALE（1 分 = 1e8）
      const totalAtoms = pointsTotal * CFG.issuance.scoreScale;

      set('vSample', count.toLocaleString());
      set('vAvg', avg.toFixed(8));
      set('vCalc', totalAtoms.toLocaleString());
      set('vOnchain', CFG.asset.supplyHuman);

      // 3) 比对（允许 1% 误差：全网钻石列表可能随时增长）
      // ⚠ 必须比 atoms，不能比分数——两者差 1e8 倍
      const onchain = Number(CFG.asset.supply);
      const diff = Math.abs(totalAtoms - onchain) / onchain;
      if (diff < 0.01) {
        status.className = 'v ok';
        status.textContent = '✓ ' + window.I18N.t('verify.match') + ' (' + (diff * 100).toFixed(3) + '%)';
      } else {
        status.className = 'v err';
        status.textContent = '✗ ' + window.I18N.t('verify.mismatch') + ' (' + (diff * 100).toFixed(2) + '%)';
      }
    } catch (e) {
      set('vSample', '—'); set('vAvg', '—'); set('vCalc', '—');
      status.className = 'v err';
      status.textContent = window.I18N.t('verify.fail');
    } finally {
      verifying = false;
      btn.disabled = false;
      btn.textContent = window.I18N.t('verify.run');
    }
  }

  /**
   * 拉取全网 HACD（分页）。
   * 浏览器接口：GET /api/diamond/views?page=N&limit=200
   */
  async function fetchAllDiamonds() {
    const base = CFG.useLocal ? CFG.localNode : CFG.apiBase;
    const out = [];
    let page = 1;
    const limit = 200;

    // 安全上限：最多 1000 页（20 万颗），防止接口异常导致死循环
    while (page <= 1000) {
      const r = await fetch(base + '/api/diamond/views?page=' + page + '&limit=' + limit)
        .then(x => x.json());
      const batch = r.list || r.data || [];
      if (!batch.length) break;
      out.push(...batch);
      if (batch.length < limit) break;
      page++;
    }
    return out;
  }

  /* ---------- HACD 评分（与合约 diamond_score 一致的简化版） ---------- */
  // 完整算法见 HacdsDeFi3000.fitsh 的 diamond_score；这里实现 5 维的前 3 维
  // （形状、颜色、命名），用于验证平均值。完整复算请用官方脚本。

  function scoreOf(name, vgHex, number) {
    if (!vgHex || vgHex.length < 20) return 0;
    const vg = hexToBytes(vgHex);
    return shapeScore(vg) + colorScore(vg, name) + nameScore(name) + numberScore(number);
  }

  function hexToBytes(h) {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  function shapeScore(vg) {
    const a = vg[0], b = vg[1];
    if (a !== 0) return 0;
    switch (b) {
      case 1: return 30;  // Square
      case 2: return 30;  // Ellipse
      case 3: return 50;  // Heart
      case 4: return 20;  // Triangle
      case 5: return 30;  // Teardrop
      case 6: return 30;  // Circle
      case 7: return 20;  // Rhombus
      case 8: return 20;  // Hexagon
      default: return 0;  // Common
    }
  }

  // 命名分：6 字母中重复/对称/顺子的加成（简化：连续相同或对称）
  function nameScore(name) {
    if (!name || name.length !== 6) return 0;
    let s = 0;
    // 连续相同字母
    for (let i = 1; i < 6; i++) {
      if (name[i] === name[i - 1]) s += 10;
    }
    // 对称（如 ABCCBA）
    if (name === name.split('').reverse().join('')) s += 30;
    return s;
  }

  function colorScore(vg, name) {
    // 非 Common 形状才有颜色分；简化处理，按首字母映射
    if (vg[0] === 0 && vg[1] === 0) return 0;
    if (!name) return 0;
    const c = name.charCodeAt(0) - 65;
    if (c < 0 || c > 25) return 0;
    return (c % 5) * 4;
  }

  // 编号分：顺子 / 重复
  function numberScore(num) {
    if (num == null) return 0;
    const s = String(num);
    let sc = 0;
    // 连号
    let up = true, down = true;
    for (let i = 1; i < s.length; i++) {
      const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
      if (d !== 1) up = false;
      if (d !== -1) down = false;
    }
    if (up || down) sc += 50;
    // 对称
    if (s === s.split('').reverse().join('')) sc += 30;
    return sc;
  }
})();
