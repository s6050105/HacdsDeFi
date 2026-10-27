/* ==========================================================================
   hacds.com — 节点与合约客户端
   所有链上读取都走这里。不依赖任何外部库。
   ========================================================================== */
(function () {
  'use strict';

  const CFG = window.HACDS_CONFIG;

  /* ---------- 底层 HTTP ---------- */

  async function get(path, timeoutMs) {
    const base = CFG.useLocal ? CFG.localNode : CFG.apiBase;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 12000);
    try {
      const r = await fetch(base + path, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** 调合约视图（sandboxcall，只读、不耗 gas、不上链） */
  async function callView(fn, params, caller) {
    const me = caller || '15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q';
    let q = '/query/contract/sandboxcall?contract=' + encodeURIComponent(CFG.contract) +
            '&function=' + encodeURIComponent(fn) + '&caller=' + encodeURIComponent(me);
    if (params) q += '&params=' + encodeURIComponent(params);
    const r = await get(q);
    if (r.ret !== 0) throw new Error(r.err || ('contract error ' + r.ret));
    return r.ret_val;
  }

  /* ---------- 链上查询 ---------- */

  /** 最新区块高度 */
  async function blockHeight() {
    const r = await get('/query/block/height/latest');
    return Number(r.height);
  }

  /** 地址余额（HAC / HACD / 资产） */
  async function balance(addr) {
    const r = await get('/query/balance?address=' + encodeURIComponent(addr) + '&assets=true&diamonds=true');
    const item = (r.list || [])[0] || {};
    return {
      hac: item.hacash || '0:248',
      hacdCount: Number(item.diamond || 0),
      diamonds: (item.diamonds || '').match(/.{6}/g) || [],
      assets: item.assets || [],
    };
  }

  /** 合约池内的 HACD（可赎回的） */
  async function poolHacd() {
    const b = await balance(CFG.contract);
    return b.diamonds;
  }

  /** HACD 详情（名字 → 基因/编号），用于本地算分 */
  async function diamondDetails(names) {
    if (!names || !names.length) return [];
    const base = CFG.useLocal ? CFG.localNode : CFG.apiBase;
    const r = await fetch(base + '/api/diamond/details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    }).then(x => x.json());
    return r.list || [];
  }

  /* ---------- 协议状态（#3000） ---------- */

  const PROTO_VIEWS = [
    ['ammHac',        'amm_reserves'],
    ['ammDs',         'amm_reserve_ds'],
    ['poolPrice',     'pool_price'],
    ['lpTotal',       'lp_total'],
    ['totalHac',      'tot_hac'],
    ['totHacNominal', 'tot_hac_nominal'],
    ['providers',     'providers_total'],
    ['lendableAmm',   'lendable_amm'],
    ['utilization',   'utilization'],
    ['totalDebt',     'total_debt'],
    ['netClaims',     'net_claims'],
    ['reserveHac',    'reserve_hac'],
    ['deficitHac',    'deficit_hac'],
    ['hcut',          'hcut'],
    ['lcut',          'lcut'],
    ['borrowPaused',  'borrow_paused'],
    ['refPrice',      'ref_price_of'],
    ['hacdScore',     'hacd_score_total'],
    ['hacdCount',     'hacd_count'],
    ['hacdAvg',       'hacd_avg_score'],
    ['coverage',      'hacd_coverage'],
    ['liqRatio',      'liq_coll_ratio'],
    ['borrowRatio',   'borrow_coll_ratio'],
  ];

  /** 批量拉协议状态。任一失败不影响其他（返回 null）。 */
  async function protocolState(caller) {
    const out = {};
    const results = await Promise.allSettled(
      PROTO_VIEWS.map(([, fn]) => callView(fn, null, caller))
    );
    results.forEach((r, i) => {
      out[PROTO_VIEWS[i][0]] = r.status === 'fulfilled' ? r.value : null;
    });
    return out;
  }

  /** 单用户状态 */
  async function userState(addr) {
    const p = addr + ':address';
    const views = [
      ['due',       () => callView('balance_ds', p, addr)],
      ['hacBal',    () => callView('balance_hac', p, addr)],
      ['lpShares',  () => callView('lp_share_of', p, addr)],
      ['lpPendingHac', () => callView('lp_pending_hac', p, addr)],
      ['lpPendingDs',  () => callView('lp_pending_ds', p, addr)],
      ['debt',      () => callView('loan_debt_of', p, addr)],
      ['coll',      () => callView('loan_coll_of', p, addr)],
      ['debtNow',   () => callView('loan_debt_now', p, addr)],
      ['health',    () => callView('loan_health', p, addr)],
      ['bad',       () => callView('bad_of', p, addr)],
    ];
    const out = {};
    const rs = await Promise.allSettled(views.map(([, f]) => f()));
    rs.forEach((r, i) => { out[views[i][0]] = r.status === 'fulfilled' ? r.value : null; });
    return out;
  }

  /* ---------- 版本探测 ---------- */

  let _version = null;

  /**
   * 探测合约版本：#3000 有 hcut() 视图，#2000 没有。
   * 结果缓存，避免每次调用都探一次。
   */
  async function detectVersion() {
    if (_version) return _version;
    try {
      await callView('hcut');
      _version = 'v3000';
    } catch (e) {
      _version = 'v2000';
    }
    return _version;
  }

  /* ---------- 格式化 ---------- */

  const ZHU = 1e8;

  /** "4:240" → HAC 数值 */
  function parseHac(s) {
    if (!s) return 0;
    if (typeof s === 'number') return s;
    const i = String(s).indexOf(':');
    if (i < 0) return Number(s) || 0;
    return Number(s.slice(0, i)) / Math.pow(10, 248 - Number(s.slice(i + 1)));
  }

  /** atoms / zhu 数值 → 可读字符串 */
  function fmt(n, decimals) {
    if (n == null || isNaN(n)) return '—';
    const d = decimals == null ? 2 : decimals;
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: d, maximumFractionDigits: d,
    });
  }

  /** 大整数安全格式化（超过 2^53 时用字符串处理） */
  function fmtBig(s) {
    if (s == null) return '—';
    return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 万分比 → 百分比字符串 */
  function fmtBps(bps, d) {
    if (bps == null) return '—';
    return fmt(Number(bps) / 100, d == null ? 2 : d) + '%';
  }

  /** 地址缩略 */
  function shortAddr(a) {
    if (!a) return '—';
    return a.length > 14 ? a.slice(0, 7) + '…' + a.slice(-6) : a;
  }

  /**
   * 积分覆盖率监控（索引器 /backing）。
   *
   * `loan_borrow` 是「积分先行、转出在后」：借款人若把借到的 HAC 留在合约里
   * 不转出，那部分会以 bal:hac 积分的形式暂留（= 对合约 HAC 的索取权），
   * 使 providers() 虚高、利用率偏低。
   *
   * 返回 { tot_hac_eff, real_hac, ratio_bps, ok, note }
   *   ratio_bps ≤ 10000 → 积分未超过真实储备，正常
   *   ratio_bps > 10000 → 异常，应立即告警
   */
  async function backing() {
    const r = await get('/api/backing');
    if (r && r.ret !== 0 && r.ret != null) throw new Error(r.err || 'backing_unavailable');
    return r || {};
  }

  window.HacdsAPI = {
    get, callView, blockHeight, balance, poolHacd, diamondDetails,
    protocolState, userState, detectVersion, backing,
    parseHac, fmt, fmtBig, fmtBps, shortAddr,
    CFG,
  };
})();
