'use strict';
const $ = (s) => document.querySelector(s);
// 取词（i18n.js 提供）
const t = (k, p) => window.I18N.t(k, p);
// HTML 转义：凡是要拼进 innerHTML 的**远端/外部文本**（节点或索引器返回的
// error / hint / description / ret_val 等）都必须先过这里，防止把远端内容当作
// HTML 注入界面（审计 D-1）。本地 i18n 文案与本地计算出的数字可不必转义。
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 把页面上带 data-i18n 的元素按当前语言刷新（用于静态标签）
function applyI18nStatic() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    el.textContent = window.I18N.t(k);
  });
  // 属性型文案（tooltip 等）
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = window.I18N.t(el.dataset.i18nTitle);
  });
}

// ===================== 状态 =====================
const S = {
  cfg: { node: 'https://api.hacds.com',
         indexer: 'https://indexer.hacds.com',
         contract: 'T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH' },
  keyPath: null,
  addr: null,
  unlocked: false,
  // ⚠ #3000 无管理员概念：isAdmin 已删除
  pending: null,       // 最近一次构建结果
  tab: 'swap',         // 默认页签（原 'trade' 已不存在）
  toolsGroup: 'query', // 工具页当前分组：query / ops / rent / advanced
  overview: null,      // 资产总览数据缓存
  hacdList: null,      // HACD 详情缓存（null = 未加载过，刷新时跳过）
  poolHacdList: null,  // 合约地址内的 HACD 缓存（null = 未加载过）
  poolHacdCount: 0,    // 合约地址内的 HACD 数量（未加载详情前用于按钮计数）
  hacdSel: null,       // 当前“查看详情”的钻石名
  hacdChecked: [],     // 批量勾选的钻石名（Ctrl/Shift）
  hacdAnchor: null,    // Shift 连选的锚点
  combo: [],           // “加入组合”暂存的动作规格
};

const ASSETS = {
  hac:  'assets/hac.svg',
  hacd: 'assets/hacd.svg',
  hacds:'assets/hacds_icon_64.png',
  sat:  'assets/tokens/sat.svg',
};
// 按资产符号取图标（来自 hacashdex 的 assets/<sym>.(svg|png)）
function tokenIcon(sym) {
  const s = String(sym || '').toLowerCase();
  const map = { hac: 'assets/hac.svg', hacd: 'assets/hacd.svg', carat: 'assets/tokens/carat.png', hacp: 'assets/tokens/hacp.png' };
  return map[s] || '';
}

// 单位换算：HAC 字符串 "a:b" → 十进制
function hacToNum(hacStr) {
  if (!hacStr) return 0;
  const [a, b] = String(hacStr).split(':');
  const unit = parseInt(b || '248', 10);
  return parseInt(a || '0', 10) / Math.pow(10, 248 - unit);
}
const fmt = (n, d = 4) => (typeof n === 'number' && isFinite(n)) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
// atoms（1e8 精度）→ 可读
// ⚠️ 单位约定（务必按字段用对函数）：
//   atoms（资产最小单位，decimal=8）—— hacds/due/loan:coll/amm:ds/链上资产余额
//   zhu（HAC 的 1:240，1 HAC = 1e8 zhu）—— bal:hac 积分 / amm:hac / loan:debt / 金库 HAC 侧
//   两者都是「数值 / 1e8 = 个数」，故换算公式相同；分开命名只为语义清晰、防错。
const ATOMS_PER_UNIT = 1e8;
const atoms = (n) => (n == null ? '—' : (Number(n) / ATOMS_PER_UNIT).toLocaleString('en-US', { maximumFractionDigits: 8 }));
const zhu   = (n) => (n == null ? '—' : (Number(n) / ATOMS_PER_UNIT).toLocaleString('en-US', { maximumFractionDigits: 8 }));
// LP 份额 lpt = √(hac×ds)，无定标（设计 v4 §7），直接按原值显示
const share = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 }));
// 【展示专用】hacds 链上原始量（atoms）。
// #3000 是 **decimal=0**：1 atom = 1 hacds，atoms 原值**就是个数**，不需要 ÷1e8。
// （旧版 #2000 是 decimal=8，那时才要 ÷1e8；那套口径已作废。）
// 仅用于「只读展示面板」（资产总览的链上实物 / 协议状态的池与账单侧），
// 让链上数字与浏览器、交易所接口保持同一口径（raw atoms）。
// ⚠ 不要用在操作区（输入框 / swap / 注入）：那里也用原值，但走输入校验路径。
// 【单位约定 D55】HAC 一律用 HAC（人类单位）；hacds 一律用 atoms（raw）。
// 合约的 bal:hac / amm:hac / loan:debt 等是 **zhu**（1 HAC = 1e8 zhu），
// 显示与输入都要 ÷1e8 换成 HAC；旧代码直接把 zhu 原样输出（数字小得看不懂）。
// hacds 侧（#2000 amount）则统一保留 atoms 原值，不换算。
const hacOf = (zhuVal) => {
  if (zhuVal == null) return '—';
  const v = Number(zhuVal) / ATOMS_PER_UNIT;
  return (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—') + ' HAC';
};
// HAC 输入框（人类单位）：填了数字就当 HAC，转成 zhu 上链。
//: 单笔存入的硬上限：合约 PayableHACD 走 rv64im 内核 score_sum，一次最多 200 颗。
//: 这个数字必须和 HacdsDeFi3000.fitsh 的 MAX_DEPOSIT_COUNT 保持一致。
const MINT_MAX = 200;

const HAC_RE = /^-?\d+(\.\d+)?$/;
function hacInputToZhu(str) {
  const s0 = String(str == null ? '' : str).trim();
  if (!HAC_RE.test(s0)) return null;
  const v = Number(s0);
  if (!Number.isFinite(v) || v < 0) return null;
  return String(Math.round(v * ATOMS_PER_UNIT));
}

const rawHacds = (n, withUnit) => {
  if (n == null) return '—';
  let v;
  try { v = BigInt(String(n)).toLocaleString('en-US'); }
  catch (e) { v = Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  return withUnit ? v + ' hacds' : v;
};

// ===================== 日志 =====================
function log(msg, cls) {
  const el = document.createElement('div');
  const ts = new Date().toTimeString().slice(0, 8);   // 不能叫 t，会遮蔽取词函数
  el.innerHTML = `<span class="t">${ts}</span><span class="${cls || ''}"></span>`;
  el.lastChild.textContent = msg;
  $('#log').appendChild(el);
  $('#log').scrollTop = $('#log').scrollHeight;
}
function logErr(prefix, e) {
  // 错误可能是多种形状：{error} | {ok:false,error} | {ok:true,data:{ret,err}} | Error | string
  let msg = '', hint = '';
  if (e == null) msg = 'unknown error';
  else if (typeof e === 'string') msg = e;
  else if (e.error) { msg = e.error; hint = e.hint || ''; }
  else if (e.data && (e.data.err || e.data.error)) { msg = e.data.err || e.data.error; }
  else if (e.data && e.data.ret !== undefined && e.data.ret !== 0) { msg = 'ret=' + e.data.ret; }
  else if (e.raw && e.raw.err) { msg = e.raw.err; }
  else msg = (e.message || JSON.stringify(e));
  // 注：英文错误的翻译在主进程完成（contract-errors.js），渲染层只负责展示
  log(prefix + msg + (hint ? '（' + hint + '）' : ''), 'err');
}

// ===================== 配置 =====================
async function initCfg() {
  const c = await window.api.loadCfg();
  Object.assign(S.cfg, c || {});
  $('#node').value = S.cfg.node;
  $('#contract').value = S.cfg.contract;
  const ie = $('#indexer'); if (ie) ie.value = S.cfg.indexer || '';
}
function readCfgFromUI() {
  S.cfg.node = $('#node').value.trim();
  S.cfg.contract = $('#contract').value.trim();
  const ie = $('#indexer');
  if (ie) S.cfg.indexer = ie.value.trim();
}

// ===================== 图标小工具 =====================
function assetIcon(kind) {
  const src = ASSETS[kind];
  if (!src) return '';
  if (src.endsWith('.svg')) return `<img src="${src}" alt="">`;
  return `<img src="${src}" alt="">`;
}

// ===================== 资产总览 + 协议状态 =====================
async function refreshOverview() {
  if (!S.addr) return;
  readCfgFromUI();
  const [a, p] = await Promise.all([
    window.api.assetOverview({ node: S.cfg.node, contract: S.cfg.contract, address: S.addr }),
    window.api.protocolOverview({ node: S.cfg.node, contract: S.cfg.contract, address: S.addr }),
  ]);
  if (a.ok) { S.overview = a.data; renderAssets(a.data); }
  else { logErr(t('r.assetsFail'), a); }
  if (p.ok) {
    renderProtocol(p.data); renderLoanStatus(p.data);
    // 加流动性卡若正开着，同步刷新池比例与配平建议
    const lc = document.querySelector('[data-op-card="addLiq"]');
    if (lc) liquidityUpdate(OPS.find(o => o.id === 'addLiq'), lc);
  }
  else { logErr(t('r.protoFail'), p); }
  // 顺带刷新块高缓存（deadline 自动填充用）
  await refreshHeightCache();
  // 第二段：HACD 列表跟随刷新。
  // 必须放在 assetOverview 之后（loadHacdDetails 依赖 S.overview.diamonds）。
  await refreshHacdLists(true);
}

// 刷新「已经加载过」的 HACD 列表（我的收藏 + 合约地址内的池）。
// 只在 S.hacdList / S.poolHacdList 非 null（用户点过加载、看过面板）时才重拉，
// 避免每次刷新资产都多打一轮 RPC；加载过一次之后就始终保持新鲜。
// silent=true 时抑制常规成功日志（失败仍走 logErr 报出）。
async function refreshHacdLists(silent) {
  const jobs = [];
  if (S.hacdList != null) jobs.push(loadHacdDetails(silent));
  if (S.poolHacdList != null) jobs.push(loadPoolHacd(silent));
  if (jobs.length) await Promise.all(jobs);
  // 正在看 HACD 面板则重绘：已加载的列表换成新数据，未加载的也同步「加载 (n)」计数
  if (S.tab === 'hacd') renderHacdPanel();
}

function renderAssets(d) {
  const host = $('#assetGrid');
  const hac = hacToNum(d.hac);
  // 预期 hacds：与链上量纲保持一致 —— 1 分 = SCORE_SCALE(1e8) atoms。
  // 【#3000 decimal=0】atoms 就是「个数」，**不再 ÷1e8**。
  //   旧代码 `expectedAtoms / 1e8` 是 #2000(decimal=8) 时代的写法，
  //   在 decimal=0 下会让显示值虚低 1e8 倍（存 3.55 分的钻石实际铸 3.55 亿，
  //   却显示「3.55 个」）。Android 端（HomeScreen.kt）早已按原值显示，此处对齐。
  let expectedAtoms = null, expectedKnown = false;
  if (S.hacdList) {
    const scoreSum = S.hacdList.reduce(
      (s, x) => s + DiamondScore.analyse(x.name, x.number, x.visual_gene).score, 0);
    expectedAtoms = scoreSum * 1e8;          // atoms（与合约 total = sc * SCORE_SCALE 一致）
    expectedKnown = true;
  }
  // decimal=0：atoms 即个数。用 rawHacds（BigInt）避免 3.55 亿级大数走科学计数法。
  const expectedCount = expectedKnown ? rawHacds(expectedAtoms, false) : null;
  const cells = [
    { icon: 'hac', name: t('ov.hac'), val: fmt(hac, 4), sub: '' },
    { icon: 'hacd', name: t('ov.hacd'), val: String(d.diamondCount || 0),
      sub: t('ov.expect') + ' ' + (expectedKnown ? expectedCount : '…') },
    // 【展示口径 D44】链上 hacds 侧（实物 + due 配额）一律按 #2000 原始 amount 显示，
    // 与浏览器 / 交易所接口同口径；操作区仍走 ÷1e8。副标题注明 raw 以免误读。
    { icon: 'hacds', name: t('ov.due'), val: rawHacds(d.due, true), sub: t('ov.dueSub') },
    { icon: 'hacds', name: t('ov.onchain'), val: rawHacds(d.hacdsOnchain, true), sub: t('ov.onchainSub') },
    { icon: 'hac', name: t('ov.hacPoints'), val: hacOf(d.hacPoints), sub: t('ov.hacPointsSub') },
    { icon: 'sat', name: t('ov.sat'), val: String(d.satoshi || 0), sub: '' },
  ];
  // 其它链上资产：每个 serial 一张卡（空时也提示）
  const others = (d.otherAssets || []);
  const otherCells = others.map(a => ({
    icon: tokenIcon(a.ticket || a.name) || 'hac',
    name: '#' + a.serial + ' ' + (a.ticket || a.name || ''),
    val: String(a.amount), sub: (a.decimal != null ? 'decimal ' + a.decimal : ''),
  }));
  const all = cells.concat(otherCells);
  // ⚠ c.name / c.sub 含节点返回的资产名与 serial 文本，是外部数据，必须转义
  //   （2026-11-12 审计 C-H3：同文件其他位置都用了 esc()，这里是遗漏）。
  host.innerHTML = all.map(c =>
    '<div class="asset">' + assetIcon(c.icon) +
      '<div class="a-body">' +
        '<div class="a-name">' + esc(c.name) + '</div>' +
        '<div class="a-val">' + esc(c.val) + '</div>' +
        (c.sub ? '<div class="a-sub">' + esc(c.sub) + '</div>' : '') +
      '</div></div>').join('');
  // 备注行：其它资产计数 + 加载 HACD 详情按钮
  const btn = '<button class="ghost" id="btnLoadHacd">' + t('ov.loadHacd') + '</button>';
  const othersTxt = others.length
    ? t('ov.others') + ' ' + others.length + ' ' + t('ov.othersUnit')
    : t('ov.others') + '：' + t('ov.noOthers');
  $('#assetNote').innerHTML = t('ov.totalDiamonds', { n: d.diamondCount || 0 }) + '　' + othersTxt + '　' + btn;
  const b = $('#btnLoadHacd');
  if (b) b.onclick = () => { loadHacdDetails(); };
}

function renderProtocol(p) {
  // 【展示口径 D44】hacds 侧（amm:ds / pendDs / treDs / loan:coll）显示 #2000 原始 amount。
  // #3000：奖励分配已改（AMM 费 LP80/金库20，赎回费 LP80/金库20，利息给 HAC 存款人）。
  //       不再展示"质押/持仓奖励"（rpu 通道仅用于借贷利息，且无独立展示意义）。
  // HAC 侧（zhu）与份额、价格、健康度不受影响。
  const rows = [
    [t('p.poolHac'), hacOf(p.poolHac)], [t('p.poolDs'), rawHacds(p.poolDs, true)],
    [t('p.price'), p.poolPrice != null ? (Number(p.poolPrice) / 1e8).toFixed(6) + ' HAC/hacds' : '—'],
    [t('p.lpTotal'), share(p.lpTotal)], [t('p.myLp'), share(p.myLp)],
    [t('p.pendHac'), hacOf(p.pendHac)], [t('p.pendDs'), rawHacds(p.pendDs, true)],
    [t('p.treHac'), hacOf(p.treHac)], [t('p.treDs'), rawHacds(p.treDs, true)],
    [t('p.debt'), hacOf(p.debt)], [t('p.coll'), rawHacds(p.coll, true)],
    [t('p.health'), p.health == null ? '—' : (p.health === 999 ? t('p.noLoan') : (Number(p.health) / 100).toFixed(2))],
  ];
  $('#protoGrid').innerHTML = rows.map(([k, v]) =>
    `<div class="proto-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  // 社会化因子：只在异常时提示（见 UI重组方案-实施记录 §7）
  checkSocialFactor();
}

/**
 * 社会化因子（hcut / lcut）异常提示。
 *
 * 平时两者都是 1e12（=100%），不显示任何东西。
 * 只有在协议产生过坏账、损失被分摊时才会下降 —— 那时必须告诉用户，
 * 否则用户看到「存了 1 HAC，bal:hac 只有 0.98」会以为合约算错。
 *
 * ⚠ 关键：这不影响新存入和提取的 HAC 数量。
 *   存入时 hac_to_nominal 除以 hcut，提取时 nominal_to_hac 又乘回去，
 *   所以实际价值不变，只是账面数字按比例缩小。
 *
 * 为什么不提示 hacd_coverage：它正常恒等于 100%（所有操作分子分母配对）。
 *   一旦偏离说明合约有重大漏洞、需要停用并重新部署，那时提示用户没有意义。
 */
async function checkSocialFactor() {
  const host = $('#ovProto');
  if (!host) return;
  const old = host.querySelector('.sf-warn');
  if (old) old.remove();
  if (!S.cfg.contract) return;

  const SCALE = 1e12;
  const call = fn => window.api.contractCall({
    node: S.cfg.node, contract: S.cfg.contract, fn, caller: S.addr || S.cfg.contract,
  });
  let hcut = null, lcut = null;
  try {
    const [r1, r2] = await Promise.all([call('hcut'), call('lcut')]);
    if (r1.ok) hcut = Number(r1.data.ret_val);
    if (r2.ok) lcut = Number(r2.data.ret_val);
  } catch (e) { return; }
  if (hcut == null && lcut == null) return;

  const hPct = hcut == null ? null : (hcut / SCALE * 100);
  const lPct = lcut == null ? null : (lcut / SCALE * 100);
  const bad = (hPct != null && hPct < 99.999) || (lPct != null && lPct < 99.999);
  if (!bad) return;   // 正常：不显示

  const div = document.createElement('div');
  div.className = 'dirbanner sf-warn';
  div.style.cssText = 'margin-top:10px;font-weight:400;line-height:1.7';
  div.innerHTML =
    `<b>${t('sf.title')}</b><br>` +
    t('sf.ratio', {
      h: hPct == null ? '—' : hPct.toFixed(2),
      l: lPct == null ? '—' : lPct.toFixed(2),
    }) + '<br>' +
    t('sf.why') + '<br>' +
    `<b>${t('sf.impact')}</b>`;
  host.querySelector('.ov-body').appendChild(div);
}

async function loadHacdDetails(silent) {
  if (!S.overview || !S.overview.diamonds || !S.overview.diamonds.length) {
    // 刷新场景静默，避免没有 HACD 的地址每次刷新都刷警告
    if (!silent) log(t('r.noHacd'), 'warn');
    // 曾经加载过但现在已无 HACD（如全部赎回）→ 清成空列表，别留着上一次的陈旧卡片
    if (S.hacdList != null && S.overview) {
      S.hacdList = [];
      renderAssets(S.overview);
      if (S.tab === 'hacd') renderHacdPanel();
    }
    return;
  }
  if (!silent) log(t('r.loadingHacd',{n:S.overview.diamonds.length}));
  const r = await window.api.hacdDetails({ node: S.cfg.node, names: S.overview.diamonds });
  if (!r.ok) return logErr(t('r.hacdFail'), r);
  S.hacdList = r.list;
  if (!silent) log(t('r.hacdLoaded',{n:r.list.length}), 'ok');
  renderAssets(S.overview);
  // ⚠ 必须显式重绘 HACD 面板：renderAssets 只管首页资产卡，不碰 HACD 页。
  //   原来漏了这行，导致点「加载」后数据已到但界面空白，
  //   直到点「全选」（它会调 renderHacdPanel）才突然出现。
  if (S.tab === 'hacd') renderHacdPanel();
}


// 加载「合约池」中的 HACD（可赎回的钻石，与个人地址无关）
async function loadPoolHacd(silent) {
  readCfgFromUI();
  const b = await window.api.httpGet({ url: S.cfg.node.replace(/\/$/, '') + '/query/balance?address=' + S.cfg.contract + '&diamonds=true' });
  if (!b.ok) return logErr(t('r.hacdFail'), b);
  const item = (b.data.list || [])[0] || {};
  const names = (item.diamonds || '').match(/.{6}/g) || [];
  S.poolHacdCount = names.length;
  if (!names.length) {
    S.poolHacdList = [];
    if (!silent) log(t('hacd.poolEmpty'), 'warn');
    if (S.tab === 'hacd') renderHacdPanel();
    return;
  }
  const r = await window.api.hacdDetails({ node: S.cfg.node, names });
  if (!r.ok) return logErr(t('r.hacdFail'), r);
  S.poolHacdList = r.list;
  if (!silent) log(t('r.hacdLoaded', { n: r.list.length }), 'ok');
  // 同上：显式重绘，否则点「加载」后界面不更新
  if (S.tab === 'hacd') renderHacdPanel();
}

// ===================== 操作目录 =====================
const OPS = [
  { id:'redeem', tab:'hacd', kind:'redeem', titleKey:'op.redeem.t',
    descKey:'op.redeem.d',
    fields:[{name:'names',labelKey:'f.names',hintKey:'f.namesHint'}],
    redeemBuild:(v)=>({ names: v.names.split(/[\s,]+/).filter(Boolean).map(s=>s.toUpperCase()) }) },
  { id:'claim', tab:'fund', kind:'transfer', titleKey:'op.claim.t',
    descKey:'op.claim.d',
    fields:[{name:'atoms',labelKey:'f.atoms',type:'u128',default:'100000000'}],
    build:(v,[main])=>({mode:'transfer', args:[main,'0','asset-from-to',S.cfg.contract,main,'hacds',v.atoms]}) },
  { id:'hacIn', tab:'fund', kind:'transfer', titleKey:'op.hacIn.t',
    descKey:'op.hacIn.d',
    fields:[{name:'hac',labelKey:'f.hacAmt',type:'text',default:'1:248'}],
    build:(v,[main])=>({mode:'transfer', args:[main,'0','hac-to',S.cfg.contract,v.hac]}) },
  { id:'hacOut', tab:'fund', kind:'transfer', titleKey:'op.hacOut.t',
    descKey:'op.hacOut.d',
    fields:[{name:'hac',labelKey:'f.hacAmt2',type:'text',default:'0.5'}],
    build:(v,[main])=>({mode:'transfer', args:[main,'0','hac-from-to',S.cfg.contract,main,v.hac]}) },
  { id:'redeemHacd', tab:'hacd', kind:'redeemHacd', titleKey:'op.redeemHacd.t',
    descKey:'op.redeemHacd.d',
    fields:[{name:'names',labelKey:'f.names'},{name:'to',labelKey:'f.toAddrDef',type:'address'}],
    redeemBuild:(v)=>({ names: v.names.split(/[\s,]+/).filter(Boolean).map(s=>s.toUpperCase()), to: v.to }) },

  // 【单位 D55】hacFields 列出「以 HAC 计价」的输入字段（用户填 HAC，上链前 ×1e8 转 zhu）；
  //   未列出的字段保持原量纲（hacds 侧 = atoms；share 无定标）。
  //   注意 swap_ds_to_hac 的输出腿是 HAC，故其滑点保护 min_out 也以 HAC 计。
  // ⚠ #3000 合约签名已加滑点/deadline 保护（防 front-run 与延迟执行）：
  //   swap_*          (x, min_out, deadline)
  //   add_liquidity   (hac, ds, min_share, deadline)
  //   remove_liquidity(share, min_hac_out, min_ds_out, deadline)
  //   deadline 传 0 = 不检查（兼容/离线构建）；日常操作建议由钱包自动填「当前块高 + 窗口」。
  //   注：deadline 的单位是**块高**，不是时间戳（合约里比的是 block_height）。
  { id:'swapH2D', tab:'swap', kind:'call', ammV3000:true, fn:'swap_hac_to_ds', titleKey:'op.swapH2D.t',
    descKey:'op.swapH2D.d',
    quote:'swap_hac_to_ds',
    hacFields:['hac_in'],
    fields:[{name:'hac_in',labelKey:'f.hacInUnit',type:'u128',default:'1'},
            {name:'min_out',labelKey:'f.minOutAtoms',type:'u128',default:'0'},
            {name:'deadline',labelKey:'f.deadline',type:'u128',default:'0',autoDeadline:true}] },
  { id:'swapD2H', tab:'swap', kind:'call', ammV3000:true, fn:'swap_ds_to_hac', titleKey:'op.swapD2H.t',
    descKey:'op.swapD2H.d',
    quote:'swap_ds_to_hac',
    hacFields:['min_out'],
    fields:[{name:'ds_in',labelKey:'f.dsInAtoms',type:'u128',default:'100000000'},
            {name:'min_out',labelKey:'f.minOutHac',type:'u128',default:'0'},
            {name:'deadline',labelKey:'f.deadline',type:'u128',default:'0',autoDeadline:true}] },
  { id:'addLiq', tab:'lp', kind:'call', ammV3000:true, fn:'add_liquidity', titleKey:'op.addLiq.t',
    descKey:'op.addLiq.d',
    hacFields:['hac_amt'],
    liquidityHint:true,
    fields:[{name:'hac_amt',labelKey:'f.hacSideUnit',type:'u128',default:'1'},
            {name:'ds_amt',labelKey:'f.dsSideAtoms',type:'u128',default:'0'},
            {name:'min_share',labelKey:'f.minShare',type:'u128',default:'0'},
            {name:'deadline',labelKey:'f.deadline',type:'u128',default:'0',autoDeadline:true}] },
  { id:'rmLiq', tab:'lp', kind:'call', ammV3000:true, fn:'remove_liquidity', titleKey:'op.rmLiq.t',
    descKey:'op.rmLiq.d',
    fields:[{name:'share',labelKey:'f.share',type:'u128',default:'1000000'},
            {name:'min_hac_out',labelKey:'f.minHacOut',type:'u128',default:'0'},
            {name:'min_ds_out',labelKey:'f.minDsOut',type:'u128',default:'0'},
            {name:'deadline',labelKey:'f.deadline',type:'u128',default:'0',autoDeadline:true}] },
  { id:'harvest', tab:'lp', kind:'call', fn:'lp_harvest', titleKey:'op.harvest.t',
    descKey:'op.harvest.d', fields:[] },

  { id:'coll', tab:'loan', kind:'call', fn:'loan_add_collateral', titleKey:'op.coll.t',
    descKey:'op.coll.d',
    loanHint:true,
    fields:[{name:'ds_amt',labelKey:'f.dsCollAtoms',type:'u128',default:'100000000'}] },
  { id:'borrow', tab:'loan', kind:'call', fn:'loan_borrow', titleKey:'op.borrow.t',
    descKey:'op.borrow.d',
    loanHint:true,
    hacFields:['hac'],
    fields:[{name:'hac',labelKey:'f.borrowUnit',type:'u128',default:'0.5'}] },
  { id:'repay', tab:'loan', kind:'call', fn:'loan_repay', titleKey:'op.repay.t',
    descKey:'op.repay.d',
    hacFields:['hac'],
    fields:[{name:'hac',labelKey:'f.repayUnit',type:'u128',default:'0.5'}] },
  { id:'liq', tab:'loan', kind:'call', fn:'loan_liquidate', titleKey:'op.liq.t',
    descKey:'op.liq.d',
    fields:[{name:'who',labelKey:'f.borrower',type:'address'}] },

  { id:'trH2A', tab:'xfer', kind:'transfer', titleKey:'op.trH2A.t',
    descKey:'op.trH2A.d',
    fields:[{name:'to',labelKey:'f.toAddr',type:'address'},{name:'hac',labelKey:'f.hacAmt',type:'text',default:'1:248'}],
    build:(v,[main])=>({mode:'transfer', args:[main,'0','hac-to',v.to,v.hac]}) },
  // 【金库清扫】合约 → 金库（触发合约 PermitHAC/PermitAsset，扣 tre:）。
  // ⚠ 必用 from-to 形态（from=合约）；写成 hac-to/asset-to 是"用户转"，不会清扫。
  { id:'sweepHac', tab:'tools', kind:'transfer', titleKey:'op.sweepHac.t',
    descKey:'op.sweepHac.d',
    fields:[{name:'amount',labelKey:'f.hacAmt',type:'text',default:'1:248'}],
    build:(v,[main])=>({mode:'transfer', args:[main,'0','hac-from-to',S.cfg.contract,'1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK',v.amount]}) },
  { id:'sweepDs', tab:'tools', kind:'transfer', titleKey:'op.sweepDs.t',
    descKey:'op.sweepDs.d',
    fields:[{name:'atoms',labelKey:'f.atomsNum',type:'u128',default:'100000000'}],
    build:(v,[main])=>({mode:'transfer', args:[main,'0','asset-from-to',S.cfg.contract,'1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK','hacds',v.atoms]}) },
  { id:'trA2C', tab:'fund', kind:'transfer', titleKey:'op.trA2C.t',
    descKey:'op.trA2C.d',
    fields:[{name:'atoms',labelKey:'f.atomsNum',type:'u128',default:'100000000'}],
    build:(v,[main])=>({mode:'transfer', args:[main,'0','asset-to',S.cfg.contract,'hacds',v.atoms]}) },
  { id:'trA2A', tab:'xfer', kind:'transfer', titleKey:'op.trA2A.t',
    descKey:'op.trA2A.d',
    fields:[{name:'to',labelKey:'f.toAddr',type:'address'},{name:'atoms',labelKey:'f.atomsNum',type:'u128',default:'100000000'}],
    build:(v,[main])=>({mode:'transfer', args:[main,'0','asset-from-to',main,v.to,'hacds',v.atoms]}) },

  // HACD 点对点转账（D63）——链上一级转账，不碰合约、无需证书；由官方 hacash_sdk.wasm 本地签名
  { id:'trHacd', tab:'xfer', kind:'hacdTransfer', titleKey:'op.trHacd.t',
    descKey:'op.trHacd.d',
    fields:[{name:'names',labelKey:'f.hacdNames'},{name:'to',labelKey:'f.toAddr',type:'address'}] },

  // 其它资产（排除 serial 2000）
  { id:'trOther', tab:'xfer', kind:'transferOther', titleKey:'op.trOther.t',
    descKey:'op.trOther.d',
    fields:[{name:'serial',labelKey:'f.serialNum',type:'u128'},{name:'to',labelKey:'f.toAddr',type:'address'},{name:'atoms',labelKey:'f.atomsNum2',type:'u128'}],
    // serial 是纯数字（不带 #）；UI 别处显示为 #2000，故这里容错剥离前导 '#'。
    build:(v,[main])=>({mode:'transfer', args:[main,'0','asset-from-to',main,v.to,
        String(v.serial).trim().replace(/^#/, ''), v.atoms]}) },
];

// ⚠ #3000 无管理员：原 ADMIN_OPS 的 6 个函数（set_fee / set_loan_rate /
//   set_liquidate_bonus / set_paused / set_oracle / rent_batch）在
//   HacdsDeFi3000.fitsh 里全部不存在，整个管理员页签已删除。
//   续租改由链下 keeper 调用 rent_keys / topup_keys 完成，不走钱包 UI。

// btnKey = 整句按钮文案（比「查询 + 标签」拼接更自然，尤其中/土语）
const QUERIES = [
  { labelKey:'q.hac',     btnKey:'qb.hac',     fn:'balance_hac', params:[{name:'who',type:'address',labelKey:'q.fieldWho'}] },
  { labelKey:'q.due',     btnKey:'qb.due',     fn:'balance_ds', params:[{name:'who',type:'address',labelKey:'q.fieldWho'}] },
  { labelKey:'p.price',   btnKey:'qb.price',   fn:'pool_price', params:[] },
  { labelKey:'p.poolHac', btnKey:'qb.poolHac', fn:'amm_reserves', params:[] },
  { labelKey:'p.poolDs',  btnKey:'qb.poolDs',  fn:'amm_reserve_ds', params:[] },
  { labelKey:'p.health',  btnKey:'qb.health',  fn:'loan_status', params:[{name:'who',type:'address',labelKey:'q.fieldWho'}] },
  { labelKey:'p.debt',    btnKey:'qb.debt',    fn:'loan_debt_of', params:[{name:'who',type:'address',labelKey:'q.fieldWho'}] },
  { labelKey:'p.coll',    btnKey:'qb.coll',    fn:'loan_coll_of', params:[{name:'who',type:'address',labelKey:'q.fieldWho'}] },
  { labelKey:'q.lpShare', btnKey:'qb.lpShare', fn:'lp_share_of', params:[{name:'who',type:'address',labelKey:'q.fieldWho'}] },
  { labelKey:'p.lpTotal', btnKey:'qb.lpTotal', fn:'lp_total', params:[] },
  // #3000：AMM 费/赎回费给 LP，利息给 HAC 存款人 → total_staked 改名"总持仓（含 HAC 存款）"
  { labelKey:'q.stake',   btnKey:'qb.stake',   fn:'total_staked', params:[{name:'kind',type:'u128',labelKey:'q.fieldKind'}] },
];

// ===================== 界面构建 =====================
//
// 页签按「**对手方是谁**」划分（2026-11-11 重组）：
//   · 转账 xfer —— 链上地址 ↔ 链上地址，**不碰合约**
//   · 资金 fund —— 我的地址 ↔ **合约地址**，只做充提
//   · 兑换/流动性/借贷/HACD —— 与合约的具体业务交互
//   · 工具 tools —— 查询、运维、高级，收拢低频功能
//
// 原 9+1 个页签（含 1 个在 #3000 下完全无效的管理员页）收敛为 7 个，
// 且每个功能**只保留一个入口**。
const TABS = [
  { id:'swap',  labelKey:'tab.swap' },
  { id:'lp',    labelKey:'tab.lp' },
  { id:'loan',  labelKey:'tab.loan' },
  { id:'hacd',  labelKey:'tab.hacd' },
  { id:'xfer',  labelKey:'tab.xfer' },
  { id:'fund',  labelKey:'tab.fund' },
  { id:'tools', labelKey:'tab.tools' },
];

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  TABS.forEach(tab => {
    const b = document.createElement('button');
    b.textContent = t(tab.labelKey);   // 注意：循环变量不能叫 t，会遮蔽取词函数
    b.className = S.tab === tab.id ? 'on' : '';
    b.onclick = () => {
      const prev = S.tab;
      S.tab = tab.id; renderTabs(); renderPanels();
      // 切回 HACD 页签时，若之前加载过列表就静默重拉一次，
      // 避免"离开后再回来看到的还是旧数据"（合约池可能已被他人变动）。
      if (tab.id === 'hacd' && prev !== 'hacd' && S.addr) refreshHacdLists(true);
    };
    nav.appendChild(b);
  });
}

/** 跳到指定页签（供页面内的「去资金页」「去 HACD 页」等链接使用） */
function goTab(id) {
  if (!TABS.some(x => x.id === id)) return;
  S.tab = id; renderTabs(); renderPanels();
}
// 页签守卫：当前页签若不在 TABS 里（如旧配置残留 admin/trade），退回首页
function guardTab() { if (!TABS.some(x => x.id === S.tab)) S.tab = 'swap'; }

function fieldEl(f, val) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = f.labelKey ? t(f.labelKey) : (f.label || '');
  const inp = document.createElement('input');
  inp.dataset.fname = f.name;
  inp.value = val != null ? val : (f.default || '');
  inp.placeholder = f.hintKey ? t(f.hintKey) : (f.hint || '');
  wrap.appendChild(lab); wrap.appendChild(inp);
  return wrap;
}
function collectFields(card) {
  const v = {};
  card.querySelectorAll('input[data-fname]').forEach(i => { v[i.dataset.fname] = i.value.trim(); });
  return v;
}

function renderPanels() {
  guardTab();
  const host = $('#panels');
  host.innerHTML = '';
  $('#hacdPanel').hidden = (S.tab !== 'hacd');
  host.hidden = (S.tab === 'hacd');

  if (S.tab === 'hacd')  { renderHacdPanel(); return; }
  if (S.tab === 'tools') return renderToolsPanel(host);
  if (S.tab === 'fund')  return renderFundPanel(host);

  // 兑换 / 流动性 / 借贷三页用网页端的左右分栏布局
  if (S.tab === 'swap') { renderSwapPage(host); return; }
  if (S.tab === 'lp')   { renderLpPage(host);   return; }
  if (S.tab === 'loan') { renderLoanPage(host); return; }
  if (S.tab === 'xfer') { renderXferPage(host); return; }

  const ops = OPS.filter(o => o.tab === S.tab);
  ops.forEach(op => host.appendChild(opCard(op)));
  applyOpPrefill();
}

function opCard(op) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.opCard = op.id;
  card.innerHTML = `<h3>${t(op.titleKey)}</h3><p class="desc">${t(op.descKey)}</p>`
    + (op.ammV3000 ? `<p class="hint" style="color:var(--warn,#d08770)">${t('amm.v3000only')}</p>` : '');
  const grid = document.createElement('div'); grid.className = 'grid';
  (op.fields || []).forEach(f => grid.appendChild(fieldEl(f)));
  card.appendChild(grid);

  // AMM 报价区
  if (op.quote) {
    const q = document.createElement('div'); q.className = 'readout'; q.hidden = true;
    q.dataset.quoteFor = op.id; card.appendChild(q);
    const rerender = () => quoteUpdate(op, card);
    card.querySelectorAll('input[data-fname]').forEach(i => i.addEventListener('input', rerender));
  }
  // 加流动性：两侧联动（改一侧自动配平另一侧），见 liquidityAuto
  if (op.liquidityHint) {
    const l = document.createElement('div'); l.className = 'readout';
    l.dataset.liqFor = op.id; card.appendChild(l);
    const rl = () => liquidityAuto(op, card);
    card.querySelectorAll('input[data-fname]').forEach(i => i.addEventListener('input', rl));
  }
  // 借贷页：实时显示「可借上限 / 需抵押」双向换算（合约 coll_to_hac 口径）
  if (op.loanHint) {
    const h = document.createElement('div'); h.className = 'readout';
    h.dataset.loanFor = op.id; card.appendChild(h);
    const re = () => loanHintUpdate(op, card);
    card.querySelectorAll('input[data-fname]').forEach(i => i.addEventListener('input', re));
  }

  const adv = document.createElement('details'); adv.className = 'adv';
  adv.innerHTML = `<summary>${t('adv.title')}</summary>`;
  const g2 = document.createElement('div'); g2.className = 'grid';
  g2.appendChild(fieldEl({ name:'__fee', labelKey:'f.feeAdv', hintKey:'f.feeAdvHint' }));
  g2.appendChild(fieldEl({ name:'__gas', labelKey:'f.gasMax' }));
  adv.appendChild(g2); card.appendChild(adv);

  // HACD 转账：把「高级选项」的手续费预填为 0.0002 × 颗数（用户手改后不再覆盖；清空则走自动估算）
  if (op.kind === 'hacdTransfer') {
    const nmEl = card.querySelector('input[data-fname="names"]');
    const feeEl = card.querySelector('input[data-fname="__fee"]');
    if (nmEl && feeEl) {
      let touched = false;
      feeEl.addEventListener('input', () => { touched = true; });
      const refresh = () => {
        const c = String(nmEl.value || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean).length;
        if (!touched) feeEl.value = c ? defHacdFee(c) : '';
      };
      nmEl.addEventListener('input', refresh);
      refresh();
    }
  }

  const row = document.createElement('div'); row.className = 'row';
  const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = t('btn.genTx2');
  btn.onclick = () => buildOp(op, card, btn);
  row.appendChild(btn);
  // “加入组合”：把当前填写内容转成 combo 动作，暂存到 S.combo（原子交易页使用）
  const addb = document.createElement('button'); addb.className = 'ghost'; addb.textContent = t('combo.addBtn');
  // ⚠ 必须包 try：buildCallParams 对非法 address 会抛异常（防参数注入），
  //   这里不接就会变成未捕获异常，用户点「加入组合」后毫无反应。
  addb.onclick = () => {
    try { if (addToCombo(op, card)) log(t('combo.added'), 'ok'); }
    catch (e) { log(e && e.message ? e.message : String(e), 'err'); }
  };
  row.appendChild(addb);
  card.appendChild(row);
  if (op.quote) quoteUpdate(op, card);
  if (op.loanHint) loanHintUpdate(op, card);
  if (op.liquidityHint) liquidityUpdate(op, card);
  return card;
}

// ===================== 借贷实时提示（LTV 双向换算） =====================
// 合约口径（HacdsDeFi.fitsh）：
//   coll_to_hac(coll) = coll × amm:hac / amm:ds      // hacds 抵押 → HAC 价值
//   loan_borrow 放行条件：(debt + hac_amt) × COLL_RATIO(2) ≤ coll_hac
// 因此：
//   可借上限 = coll_hac / 2 − debt
//   所需抵押 = (debt + 借款) × 2 × amm:ds / amm:hac
// 注意 COLL_RATIO 是合约常量（当前 = 2）。
const COLL_RATIO = 2;
async function loanHintUpdate(op, card) {
  const box = card.querySelector('[data-loan-for="' + op.id + '"]');
  if (!box) return;
  box.hidden = false;
  readCfgFromUI();
  if (!S.addr) { box.textContent = t('loan.locked'); return; }
  const me = S.addr;
  const call = async (fn, params) => {
    const r = await window.api.contractCall({
      node: S.cfg.node, contract: S.cfg.contract, fn, caller: me, params });
    return (r.ok && r.data) ? Number(r.data.ret_val) : null;
  };
  const [ph, pd, debt, coll] = await Promise.all([
    call('amm_reserves'), call('amm_reserve_ds'),
    call('loan_debt_of', `${me}:address`), call('loan_coll_of', `${me}:address`),
  ]);
  if (ph == null || pd == null || debt == null || coll == null) { box.textContent = t('ov.loading'); return; }
  if (pd === 0) { box.innerHTML = '<span class="warn">' + t('loan.noPool') + '</span>'; return; }

  const collHac = Math.floor(coll * ph / pd);        // 抵押的 HAC 价值（zhu）
  const maxBorrow = Math.max(0, Math.floor(collHac / COLL_RATIO) - debt);  // 可借上限（zhu）
  const v = collectFields(card);
  const lines = [];

  if (op.id === 'borrow') {
    // 用户填 HAC → 需抵押多少 hacds
    const z = hacInputToZhu(v.hac);
    const hacZ = z == null ? 0 : Number(z);
    const needCollHac = (debt + hacZ) * COLL_RATIO;                 // 需要的抵押 HAC 价值
    const needCollDs = ph === 0 ? null : Math.ceil(needCollHac * pd / ph);  // → hacds atoms
    lines.push(t('loan.maxBorrow', { a: hacOf(maxBorrow), b: hacOf(debt) }));
    lines.push(t('loan.haveColl', { a: rawHacds(coll, true), b: hacOf(collHac) }));
    if (hacZ > 0) {
      const okNow = hacZ <= maxBorrow;
      lines.push((okNow ? '<span class="ok">✔ </span>' : '<span class="err">✘ </span>')
        + t('loan.needCollFor', { a: rawHacds(needCollDs, true), b: hacOf(needCollHac) }));
      if (!okNow) lines.push('<span class="err">' + t('loan.exceed', { a: hacOf(maxBorrow) }) + '</span>');
    }
  } else {
    // 追加抵押：显示「这笔抵押能多借多少 / 追加后总可借」
    const addDs = Number(v.ds_amt || 0);
    const addHac = ph === 0 ? 0 : Math.floor(addDs * ph / pd);
    const newColl = coll + addDs;
    const newCollHac = ph === 0 ? 0 : Math.floor(newColl * ph / pd);
    const newMax = Math.max(0, Math.floor(newCollHac / COLL_RATIO) - debt);
    lines.push(t('loan.haveColl', { a: rawHacds(coll, true), b: hacOf(collHac) }));
    if (addDs > 0) {
      lines.push(t('loan.addGives', { a: hacOf(addHac), b: hacOf(newMax) }));
    }
    lines.push(t('loan.maxBorrow', { a: hacOf(maxBorrow), b: hacOf(debt) }));
  }
  box.innerHTML = lines.join('\n');
}

// HACD 转账默认手续费 = 0.0002 HAC × 颗数（仅作输入框默认值；留空则按节点费率自动估算）
function defHacdFee(n) {
  const c = Math.max(1, Number(n) || 1);
  return (0.0002 * c).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

// ===================== 加流动性：两侧联动 =====================
// 合约 add_liquidity 的关键规则（HacdsDeFi.fitsh）：
//   非首注  share = min( lpttot×hac_amt/ph , lpttot×ds_amt/pd )
//   两腿比例不匹配时取小的那侧算份额，多注的那侧白送进池子。
//   首注    share = isqrt(hac_amt × ds_amt)
// 所以界面要让两侧保持池内比例：改一侧，自动把另一侧配平（下取整）。
let _loanProto = null;   // 最近一次协议状态数据（借贷常驻卡与联动共用）
let _liqBusy = false;    // 防止「自动填另一侧」触发第二轮联动
const ATOMS_PER = 100000000n;

// BigInt 安全解析
function bnOf(x) {
  const s = String(x == null ? '' : x).trim();
  if (!/^\d+$/.test(s)) return null;
  try { return BigInt(s); } catch (e) { return null; }
}
// zhu → HAC 字符串（8 位小数，去尾零）
function zhuToHacStr(z) {
  const whole = z / ATOMS_PER, frac = z % ATOMS_PER;
  let out = whole.toString();
  if (frac > 0n) out += '.' + frac.toString().padStart(8, '0').replace(/0+$/, '');
  return out;
}
// 千分位
function thou(v) { return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
// 整数平方根（与合约 isqrt 同法：Newton 迭代）
function isqrtBig(n) {
  if (n < 2n) return n < 0n ? 0n : n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

function liquidityAuto(op, card) {
  const hEl = card.querySelector('input[data-fname="hac_amt"]');
  const dEl = card.querySelector('input[data-fname="ds_amt"]');
  if (!hEl || !dEl || _liqBusy) return;
  const active = document.activeElement;
  const ph = _loanProto ? bnOf(_loanProto.poolHac) : null;
  const pd = _loanProto ? bnOf(_loanProto.poolDs) : null;
  const hasPool = ph != null && pd != null && ph > 0n && pd > 0n;

  if (hasPool) {
    if (active === hEl) {
      const hz = hacInputToZhu(hEl.value);        // HAC → zhu
      const h = hz == null ? null : bnOf(hz);
      if (h != null && h > 0n) {
        _liqBusy = true;
        dEl.value = (h * pd / ph).toString();     // zhu × pd / ph → atoms（下取整）
        _liqBusy = false;
      }
    } else if (active === dEl) {
      const d = bnOf(dEl.value);
      if (d != null && d > 0n) {
        _liqBusy = true;
        hEl.value = zhuToHacStr(d * ph / pd);     // atoms × ph / pd → zhu → HAC
        _liqBusy = false;
      }
    }
  }
  liquidityUpdate(op, card);
}

async function liquidityUpdate(op, card) {
  const box = card.querySelector('[data-liq-for="' + op.id + '"]');
  if (!box) return;
  box.hidden = false;
  readCfgFromUI();
  if (!S.addr) { box.textContent = t('loan.locked'); return; }
  const d = _loanProto;
  if (!d || d.poolHac == null) { box.textContent = t('ov.loading'); return; }

  const phS = bnOf(d.poolHac), pdS = bnOf(d.poolDs);
  const ph = phS == null || phS === 0n ? null : phS;
  const pd = pdS == null || pdS === 0n ? null : pdS;
  const v = collectFields(card);
  const hz = hacInputToZhu(v.hac_amt);            // HAC → zhu
  const h = hz == null ? null : bnOf(hz);
  const ds = bnOf(v.ds_amt);
  const lines = [];

  if (ph == null || pd == null) {
    // 首注：没有池内比例可对齐
    lines.push(t('liq.first'));
    if (h != null && h > 0n && ds != null && ds > 0n) {
      lines.push(t('liq.shares', { a: thou(isqrtBig(h * ds)) }));
    }
  } else {
    lines.push(t('liq.ratio', { h: hacOf(d.poolHac), d: rawHacds(d.poolDs, true) }));
    if (h != null && h > 0n && ds != null && ds > 0n) {
      // 按合约复刻份额：min(lpttot×hac/ph, lpttot×ds/pd)
      const lpttot = bnOf(d.lpTotal) || 0n;
      const s1 = lpttot * h / ph;
      const s2 = lpttot * ds / pd;
      const share = s1 < s2 ? s1 : s2;
      lines.push(t('liq.shares', { a: thou(share) }));
      // 只有「多出的量 > 1 个单位」才算真不匹配：下取整必然产生 1 单位差额，
      // 那不是用户填错，是算法取整，不该告警。
      const needDs = h * pd / ph;
      const needZhu = ds * ph / pd;
      const excessDs = ds - needDs;      // >0 表示 hacds 腿填多了
      const excessZhu = h - needZhu;     // >0 表示 HAC 腿填多了
      if (excessDs > 1n) {
        lines.push('<span class="warn">' + t('liq.imbalance', { side: 'hacds' }) + '</span>');
        lines.push(t('liq.suggestDs', { a: thou(needDs) }));
      } else if (excessZhu > 1n) {
        lines.push('<span class="warn">' + t('liq.imbalance', { side: 'HAC' }) + '</span>');
        lines.push(t('liq.suggestHac', { a: zhuToHacStr(needZhu) }));
      }
    } else if (h != null && h > 0n) {
      lines.push(t('liq.pendingDs', { a: thou(h * pd / ph) }));
    } else if (ds != null && ds > 0n) {
      lines.push(t('liq.pendingHac', { a: zhuToHacStr(ds * ph / pd) }));
    }
  }
  box.innerHTML = lines.join('\n');
}

// ===================== 借贷状态常驻卡（D61） =====================
// 「借贷页操作卡下方的实时提示」只有滚动到那才看得到；这里在首页顶部（资产总览/协议状态
// 同一排）做一张常驻卡，解锁后一直可见，不必进借贷页、不必滚动。
// 口径与 loanHintUpdate 完全一致（合约 HacdsDeFi.fitsh）：
//   抵押价值 coll_to_hac(coll) = coll × amm:hac / amm:ds   （zhu）
//   可借上限 = 抵押价值 / COLL_RATIO(2) − 债务
//   抵押率   = 抵押价值 × 100 / 债务     （合约 loan_status；清算门槛 200，见 loan_liquidate）
// 数据源 = 协议状态那一次调用（不额外打链）。
// _loanProto 声明见上方「加流动性」一节（两个功能共用）。
function renderLoanStatus(p) {
  if (p) _loanProto = p;
  const card = $('#ovLoan');
  if (!card) return;
  // 未解锁/无地址：整张卡不显示（#overview 本身也会被隐藏）
  if (!S.addr || !S.unlocked) { card.hidden = true; return; }
  card.hidden = false;
  const host = $('#loanGrid');
  if (!host) return;
  const d = _loanProto;
  if (!d || d.debt == null) { host.innerHTML = '<span class="muted">' + t('ov.loading') + '</span>'; return; }
  const ph = Number(d.poolHac || 0), pd = Number(d.poolDs || 0);
  const debt = Number(d.debt || 0), coll = Number(d.coll || 0);
  const collHac = pd === 0 ? 0 : Math.floor(coll * ph / pd);        // 抵押的 HAC 价值（zhu）
  const maxBorrow = Math.max(0, Math.floor(collHac / COLL_RATIO) - debt);
  const rows = [
    [t('p.debt'), hacOf(debt)],
    [t('p.coll'), rawHacds(coll, true)],
    [t('p.collValue'), hacOf(collHac)],
    [t('p.rate'), debt > 0 ? (collHac * 100 / debt).toFixed(2) + '%' : '—'],
    [t('p.maxBorrow'), hacOf(maxBorrow)],
  ];
  // 清算状态（合约 loan_liquidate：debt > coll_hac / 2 ⟺ 抵押率 < 200）
  if (debt === 0) rows.push([t('p.health'), t('loan.liqNone')]);
  else if (collHac * 100 < debt * 200) rows.push([t('p.health'), '<span class="err">' + t('loan.liqRisk') + '</span>']);
  else rows.push([t('p.health'), '<span class="ok">' + t('loan.liqSafe') + '</span>']);
  host.innerHTML = rows.map(([k, v]) =>
    `<div class="proto-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

// AMM 实时报价（本地恒定乘积）
async function quoteUpdate(op, card) {
  const v = collectFields(card);
  const box = card.querySelector('[data-quote-for="' + op.id + '"]');
  if (!box) return;
  const pot = S.overview ? null : null;
  // 用协议状态里的池储备（若已加载）或实时查
  let ph = null, pd = null;
  const pr = await window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn:'amm_reserves', caller:S.addr || S.cfg.contract });
  const pdr = await window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn:'amm_reserve_ds', caller:S.addr || S.cfg.contract });
  if (pr.ok) ph = Number(pr.data.ret_val);
  if (pdr.ok) pd = Number(pdr.data.ret_val);
  box.hidden = false;
  if (ph == null || pd == null) { box.textContent = t('ov.loading'); return; }
  if (ph === 0 || pd === 0) { box.textContent = t('ov.noPool'); return; }
  // 量纲（务必分清，D37）：
  //   ph / 输入 hac_in / 输出(swapD2H)  → zhu（HAC 的 1:240 积分，÷1e8 = HAC 个数）
  //   pd / 输入 ds_in  / 输出(swapH2D)  → atoms（hacds，÷1e8 = hacds 个数）
  // ★ 输入框现在是人类单位：HAC 腿填 HAC（×1e8 转 zhu 才能参与定价），hacds 腿填 atoms。
  //   之前直接把输入当 zhu，导致「填 3」被读成 3e-8 HAC，报价恒为 0。
  const rawIn = Number((op.id === 'swapH2D' ? v.hac_in : v.ds_in) || 0);
  const inAmt = op.id === 'swapH2D' ? Math.round(rawIn * ATOMS_PER_UNIT) : rawIn;
  const feeBps = 50; // 默认 0.5%（cfg:fee 无只读接口，按默认展示）
  const net = inAmt - Math.floor(inAmt * feeBps / 10000);
  let out;
  if (op.id === 'swapH2D') out = Math.floor(pd * net / (ph + net));   // → atoms
  else out = Math.floor(ph * net / (pd + net));                       // → zhu
  const price = inAmt ? out / inAmt : 0;
  // ★ 按「输出腿的单位」换算成人类可读值。直接 toLocaleString 会把
  //   8e-9 HAC（= 0.818 zhu）这类小量截断成 "0"，让用户误以为报价失效。
  // 【单位 D55】hacds 侧一律 atoms（raw），HAC 侧一律 HAC
  const outText = op.id === 'swapH2D' ? rawHacds(out, true) : hacOf(out);
  const inText = op.id === 'swapH2D' ? hacOf(inAmt) : rawHacds(inAmt, true);
  box.innerHTML = t('amm.inTpl', { a: inText, b: outText })
    + '\n' + t('amm.quoteLine', { p: price.toExponential(4), f: (feeBps/100).toFixed(2),
        h: hacOf(ph), d: rawHacds(pd, true) });
}

/**
 * 兑换页底部的「去充值」提示。
 *
 * 为什么需要：兑换扣的是**合约内积分**（bal:hac / due），不是钱包里的链上资产。
 * 用户在还没有积分时会看到「余额不足」，却不知道该先做什么。
 * 这里给一条直达资金页的链接。
 */
function swapFundHint() {
  const c = document.createElement('div');
  c.className = 'card';
  c.innerHTML = `<p class="desc">${t('swap.needFund')}</p>
    <button class="ghost" id="goFundFromSwap">${t('swap.goFund')}</button>`;
  c.querySelector('#goFundFromSwap').onclick = () => goTab('fund');
  return c;
}

/**
 * 兑换页（网页端布局）。
 *
 * 和原实现的差别：原来是「HAC→hacds」和「hacds→HAC」两张独立卡片，
 * 用户得先判断方向再选卡。现在是一张卡 + 中间翻转箭头，符合 DEX 通行习惯。
 *
 * 左侧：兑换表单（大号输入框 / 翻转 / 最少收到 / 滑点）
 * 右侧：行情栏（汇率 / 手续费 / 价格影响 / 最少收到）+ 池子储备
 */
function renderSwapPage(host) {
  if (S.swapDir == null) S.swapDir = 0;   // 0 = HAC→hacds, 1 = hacds→HAC

  const wrap = document.createElement('div');
  wrap.className = 'grid-2';
  wrap.innerHTML = `
    <div class="card">
      <div class="card-hd">${t('swap.title')}</div>
      <div class="swap-box">
        <div class="swap-side">
          <div class="swap-label">${t('swap.from')}</div>
          <div class="swap-row">
            <input class="swap-input mono" id="swIn" type="text" placeholder="0.0" inputmode="decimal">
            <span class="swap-token" id="swFrom">HAC</span>
          </div>
        </div>
        <button class="swap-arrow" id="swFlip" title="flip">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
          </svg>
        </button>
        <div class="swap-side">
          <div class="swap-label">${t('swap.to')}</div>
          <div class="swap-row">
            <input class="swap-input mono" id="swOut" type="text" placeholder="0.0" readonly>
            <span class="swap-token" id="swTo">hacds</span>
          </div>
        </div>
      </div>

      <div class="swap-meta">
        <span>${t('swap.minOut')}</span>
        <input class="meta-input mono" id="swMinOut" type="text" value="0" style="width:150px">
      </div>
      <div class="swap-meta">
        <span>${t('swap.slippage')}</span>
        <span class="mono" id="swSlip">0.50%</span>
      </div>

      <button class="btn-primary" id="swDo" style="width:100%;margin-top:var(--sp-5)">${t('swap.do')}</button>
      <p class="hint" style="margin-top:var(--sp-3);font-size:var(--fs-sm);color:var(--text-faint)">${t('swap.needFund')}</p>
      <button class="btn-ghost" id="swGoFund" style="width:100%;margin-top:var(--sp-2)">${t('swap.goFund')}</button>
    </div>

    <div class="card">
      <div class="card-hd">${t('swap.info')}</div>
      <div class="info-rows">
        <div class="info-row"><span>${t('swap.rate')}</span><span class="mono" id="swRate">—</span></div>
        <div class="info-row"><span>${t('swap.fee')}</span><span class="mono">0.50%</span></div>
        <div class="info-row"><span>${t('swap.impact')}</span><span class="mono" id="swImpact">—</span></div>
        <div class="info-row"><span>${t('swap.minReceived')}</span><span class="mono" id="swMin">—</span></div>
      </div>
      <div class="proto-strip" style="margin-top:var(--sp-5)">
        <div class="proto-item"><span class="pk">${t('swap.poolHac')}</span><span class="pv" id="swPH">—</span></div>
        <div class="proto-item"><span class="pk">${t('swap.poolDs')}</span><span class="pv" id="swPD">—</span></div>
      </div>
    </div>`;
  host.appendChild(wrap);

  const $ = sel => wrap.querySelector(sel);
  let poolHac = null, poolDs = null;

  // 切方向
  const syncDir = () => {
    $('#swFrom').textContent = S.swapDir === 0 ? 'HAC' : 'hacds';
    $('#swTo').textContent   = S.swapDir === 0 ? 'hacds' : 'HAC';
    $('#swIn').value = '';
    $('#swOut').value = '';
    recalc();
  };

  // 实时报价
  const recalc = () => {
    const raw = Number($('#swIn').value || 0);
    if (!raw || !poolHac || !poolDs) {
      $('#swOut').value = '';
      $('#swRate').textContent = '—';
      $('#swImpact').textContent = '—';
      $('#swMin').textContent = '—';
      return;
    }
    // 单位：HAC 腿输入 HAC，×1e8 → zhu；hacds 腿输入 atoms
    const inAmt = S.swapDir === 0 ? Math.round(raw * ATOMS_PER_UNIT) : raw;
    const feeBps = 50;
    const net = inAmt - Math.floor(inAmt * feeBps / 10000);
    const out = S.swapDir === 0
      ? Math.floor(poolDs * net / (poolHac + net))    // → atoms
      : Math.floor(poolHac * net / (poolDs + net));   // → zhu
    const spot = S.swapDir === 0 ? poolDs / poolHac : poolHac / poolDs;
    const exec = inAmt ? out / inAmt : 0;
    const impact = inAmt ? Math.abs(exec / spot - 1) * 100 : 0;

    $('#swOut').value = S.swapDir === 0 ? rawHacds(out, false) : hacOf(out);
    $('#swRate').textContent = S.swapDir === 0
      ? (poolDs / poolHac).toFixed(6) + ' hacds/HAC'
      : (poolHac / poolDs).toFixed(6) + ' HAC/hacds';
    $('#swImpact').textContent = impact.toFixed(3) + '%';
    $('#swImpact').style.color = impact > 5 ? 'var(--red)'
                               : impact > 1 ? 'var(--amber)' : 'var(--text)';
    $('#swMin').textContent = S.swapDir === 0 ? rawHacds(out, true) : hacOf(out);
    // 自动填最少收到（0.5% 滑点保护）
    $('#swMinOut').value = String(Math.floor(out * 0.995));
  };

  // 拉池子储备
  (async () => {
    const [r1, r2] = await Promise.all([
      window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'amm_reserves', caller: S.addr || S.cfg.contract }),
      window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'amm_reserve_ds', caller: S.addr || S.cfg.contract }),
    ]);
    if (r1.ok) poolHac = Number(r1.data.ret_val);
    if (r2.ok) poolDs = Number(r2.data.ret_val);
    if (poolHac != null) $('#swPH').textContent = hacOf(poolHac);
    if (poolDs != null) $('#swPD').textContent = rawHacds(poolDs, true);
    recalc();
  })();

  $('#swIn').addEventListener('input', recalc);
  $('#swFlip').onclick = () => { S.swapDir = S.swapDir === 0 ? 1 : 0; syncDir(); };
  $('#swGoFund').onclick = () => goTab('fund');

  // 执行兑换
  $('#swDo').onclick = async () => {
    if (!S.addr) return log(t('acct.locked'), 'err');
    const raw = $('#swIn').value.trim();
    if (!raw || Number(raw) <= 0) return log(t('swap.needAmt'), 'warn');
    const minOut = $('#swMinOut').value.trim() || '0';
    const btn = $('#swDo');
    btn.disabled = true; btn.textContent = t('btn.gening');
    try {
      readCfgFromUI();
      const dl = await deadlineBlock();
      const fn = S.swapDir === 0 ? 'swap_hac_to_ds' : 'swap_ds_to_hac';
      const params = S.swapDir === 0
        ? `${Math.round(Number(raw) * ATOMS_PER_UNIT)}:u128,${minOut}:u128,${dl}:u128`
        : `${raw}:u128,${minOut}:u128,${dl}:u128`;
      log(t('r.buildingCall', { fn, ps: params }));
      const res = await window.api.buildTx({
        mode: 'call',
        args: [S.addr, '0', S.cfg.contract, fn, params],
        keyPath: S.keyPath, fee: null, gasMax: null,
        node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!res.ok) throw res;
      S.pending = res;
      showPreview(res);
      log(t('common.signed', { n: res.signedBytes || res.txbytes }), 'ok');
    } catch (e) {
      logErr(t('common.buildFail'), e);
    } finally {
      btn.disabled = false; btn.textContent = t('swap.do');
    }
  };

  syncDir();
}

/**
 * 流动性页（网页端布局）。
 *
 * 左：加池（含两侧联动与份额预估）
 * 右：我的仓位（份额/待领）+ 领取奖励 + 撤池
 *
 * 把「我的仓位」和「撤池」放在同一栏，因为撤池要用份额数据，
 * 分开会让用户来回对照。
 */
function renderLpPage(host) {
  const wrap = document.createElement('div');
  wrap.className = 'grid-2';
  wrap.innerHTML = `
    <div class="card" id="lpAddCard">
      <div class="card-hd">${t('lp.addTitle')}</div>
      <label class="field-label">${t('lp.hacAmount')}</label>
      <input class="field-input mono" id="lpHac" type="text" placeholder="0.0" inputmode="decimal">
      <label class="field-label" style="margin-top:var(--sp-4)">${t('lp.dsAmount')}</label>
      <input class="field-input mono" id="lpDs" type="text" placeholder="0.0" inputmode="decimal">
      <div class="swap-meta" style="margin-top:var(--sp-3)">
        <span>${t('lp.minShare')}</span>
        <input class="meta-input mono" id="lpMinShare" type="text" value="0" style="width:140px">
      </div>
      <div id="lpHint" class="readout" style="margin-top:var(--sp-3);font-size:var(--fs-sm);color:var(--text-dim);white-space:pre-wrap"></div>
      <button class="btn-primary" id="lpDoAdd" style="width:100%;margin-top:var(--sp-4)">${t('lp.doAdd')}</button>
    </div>

    <div class="card">
      <div class="card-hd">${t('lp.myPos')}</div>
      <div class="info-rows">
        <div class="info-row"><span>${t('lp.myShares')}</span><span class="mono" id="lpShares">—</span></div>
        <div class="info-row"><span>${t('lp.pendingHac')}</span><span class="mono" id="lpPendHac">—</span></div>
        <div class="info-row"><span>${t('lp.pendingDs')}</span><span class="mono" id="lpPendDs">—</span></div>
      </div>
      <button class="btn-ghost" id="lpHarvest" style="width:100%;margin-top:var(--sp-4)">${t('lp.doHarvest')}</button>

      <div class="card-hd" style="margin-top:var(--sp-6)">${t('lp.rmTitle')}</div>
      <label class="field-label">${t('lp.shareBurn')}</label>
      <input class="field-input mono" id="rmShare" type="text" placeholder="0" inputmode="decimal">
      <div class="grid-2" style="margin-top:var(--sp-3);gap:var(--sp-2)">
        <div>
          <label class="field-label">${t('lp.minHacOut')}</label>
          <input class="field-input mono" id="rmMinHac" type="text" value="0">
        </div>
        <div>
          <label class="field-label">${t('lp.minDsOut')}</label>
          <input class="field-input mono" id="rmMinDs" type="text" value="0">
        </div>
      </div>
      <button class="btn-ghost" id="lpDoRm" style="width:100%;margin-top:var(--sp-4)">${t('lp.doRm')}</button>
    </div>`;
  host.appendChild(wrap);

  const $ = sel => wrap.querySelector(sel);
  let poolHac = null, poolDs = null, lpTotal = null;

  // 拉池子与我的仓位
  (async () => {
    const [r1, r2, r3] = await Promise.all([
      window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'amm_reserves', caller: S.addr || S.cfg.contract }),
      window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'amm_reserve_ds', caller: S.addr || S.cfg.contract }),
      window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'lp_total', caller: S.addr || S.cfg.contract }),
    ]);
    if (r1.ok) poolHac = Number(r1.data.ret_val);
    if (r2.ok) poolDs = Number(r2.data.ret_val);
    if (r3.ok) lpTotal = Number(r3.data.ret_val);
    if (S.addr) {
      const [u1, u2, u3] = await Promise.all([
        window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'lp_share_of', caller: S.addr, params: `${S.addr}:address` }),
        window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'lp_pending_hac', caller: S.addr, params: `${S.addr}:address` }),
        window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'lp_pending_ds', caller: S.addr, params: `${S.addr}:address` }),
      ]);
      if (u1.ok) $('#lpShares').textContent = thou(Number(u1.data.ret_val));
      if (u2.ok) $('#lpPendHac').textContent = hacOf(Number(u2.data.ret_val));
      if (u3.ok) $('#lpPendDs').textContent = rawHacds(Number(u3.data.ret_val), true);
    }
  })();

  // 两侧联动：改一侧自动配平另一侧
  const sync = src => {
    if (!poolHac || !poolDs) return;
    if (src === 'hac') {
      const h = Number($('#lpHac').value || 0);
      if (h > 0) $('#lpDs').value = String(Math.floor(h * ATOMS_PER_UNIT * poolDs / poolHac));
    } else {
      const d = Number($('#lpDs').value || 0);
      if (d > 0) $('#lpHac').value = String((d * poolHac / poolDs) / ATOMS_PER_UNIT);
    }
    hint();
  };

  const hint = () => {
    const el = $('#lpHint');
    if (!poolHac || !poolDs) { el.textContent = t('lp.first'); return; }
    el.textContent = t('lp.ratio', { h: hacOf(poolHac), d: rawHacds(poolDs, true) });
  };

  $('#lpHac').addEventListener('input', () => sync('hac'));
  $('#lpDs').addEventListener('input', () => sync('ds'));

  // 加池
  $('#lpDoAdd').onclick = async () => {
    if (!S.addr) return log(t('acct.locked'), 'err');
    const h = $('#lpHac').value.trim(), d = $('#lpDs').value.trim();
    if (!h || !d) return log(t('lp.needBoth'), 'warn');
    const btn = $('#lpDoAdd'); btn.disabled = true; btn.textContent = t('btn.gening');
    try {
      readCfgFromUI();
      const dl = await deadlineBlock();
      const params = `${Math.round(Number(h) * ATOMS_PER_UNIT)}:u128,${Math.floor(Number(d))}:u128,${$('#lpMinShare').value || 0}:u128,${dl}:u128`;
      const res = await window.api.buildTx({
        mode: 'call', args: [S.addr, '0', S.cfg.contract, 'add_liquidity', params],
        keyPath: S.keyPath, fee: null, gasMax: null, node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!res.ok) throw res;
      S.pending = res; showPreview(res);
      log(t('common.signed', { n: res.signedBytes || res.txbytes }), 'ok');
    } catch (e) { logErr(t('common.buildFail'), e); }
    finally { btn.disabled = false; btn.textContent = t('lp.doAdd'); }
  };

  // 领奖励
  $('#lpHarvest').onclick = async () => {
    if (!S.addr) return log(t('acct.locked'), 'err');
    try {
      readCfgFromUI();
      const res = await window.api.buildTx({
        mode: 'call', args: [S.addr, '0', S.cfg.contract, 'lp_harvest', '-'],
        keyPath: S.keyPath, fee: null, gasMax: null, node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!res.ok) throw res;
      S.pending = res; showPreview(res);
    } catch (e) { logErr(t('common.buildFail'), e); }
  };

  // 撤池：C-4 —— 单笔会撞 resource 上限，必须先 lp_harvest 再 remove_liquidity
  $('#lpDoRm').onclick = async () => {
    if (!S.addr) return log(t('acct.locked'), 'err');
    const share = $('#rmShare').value.trim();
    if (!share || share === '0') return log(t('lp.needShare'), 'warn');
    const btn = $('#lpDoRm'); btn.disabled = true; btn.textContent = t('btn.gening');
    try {
      readCfgFromUI();
      const dl = await deadlineBlock();
      // 第 1 步：先结算奖励（顺序不能反，先撤池会按减少后的份额结算）
      log(t('lp.rmStep1'));
      const h1 = await window.api.buildTx({
        mode: 'call', args: [S.addr, '0', S.cfg.contract, 'lp_harvest', '-'],
        keyPath: S.keyPath, fee: null, gasMax: null, node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!h1.ok) throw h1;
      S.pending = h1; showPreview(h1);
      log(t('lp.rmStep1Built'), 'warn');
      // 第 2 步：撤池（记住参数，等第一笔广播后由用户再点一次）
      const params = `${Math.floor(Number(share))}:u128,${$('#rmMinHac').value || 0}:u128,${$('#rmMinDs').value || 0}:u128,${dl}:u128`;
      const h2 = await window.api.buildTx({
        mode: 'call', args: [S.addr, '0', S.cfg.contract, 'remove_liquidity', params],
        keyPath: S.keyPath, fee: null, gasMax: null, node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!h2.ok) throw h2;
      S._pendingRemove = h2;
      log(t('lp.rmStep2Ready'), 'warn');
    } catch (e) { logErr(t('common.buildFail'), e); }
    finally { btn.disabled = false; btn.textContent = t('lp.doRm'); }
  };

  hint();
}

/**
 * 借贷页（网页端布局）。
 *
 * 左：借款 / 还款（顶部显示我的抵押、债务、健康度、可借上限）
 * 右：追加抵押
 *
 * 把健康数据搬进借款卡，是因为用户要「看着可借额度决定借多少」，
 * 分开放就得来回对照。
 */
function renderLoanPage(host) {
  const wrap = document.createElement('div');
  wrap.className = 'grid-2';
  wrap.innerHTML = `
    <div class="card">
      <div class="card-hd">${t('loan.borrowTitle')}</div>
      <div class="info-rows">
        <div class="info-row"><span>${t('loan.myColl')}</span><span class="mono" id="lnColl">—</span></div>
        <div class="info-row"><span>${t('loan.myDebt')}</span><span class="mono" id="lnDebt">—</span></div>
        <div class="info-row"><span>${t('loan.myHealth')}</span><span class="mono" id="lnHealth">—</span></div>
        <div class="info-row"><span>${t('loan.maxBorrow')}</span><span class="mono" id="lnMax">—</span></div>
      </div>
      <label class="field-label" style="margin-top:var(--sp-5)">${t('loan.borrowAmt')}</label>
      <input class="field-input mono" id="lnBorrowAmt" type="text" placeholder="0.0" inputmode="decimal">
      <button class="btn-primary" id="lnDoBorrow" style="width:100%;margin-top:var(--sp-4)">${t('loan.doBorrow')}</button>
      <label class="field-label" style="margin-top:var(--sp-5)">${t('loan.repayAmt')}</label>
      <input class="field-input mono" id="lnRepayAmt" type="text" placeholder="0.0" inputmode="decimal">
      <button class="btn-ghost" id="lnDoRepay" style="width:100%;margin-top:var(--sp-4)">${t('loan.doRepay')}</button>
    </div>

    <div class="card">
      <div class="card-hd">${t('loan.collTitle')}</div>
      <label class="field-label">${t('loan.collAmt')}</label>
      <input class="field-input mono" id="lnCollAmt" type="text" placeholder="0" inputmode="decimal">
      <button class="btn-primary" id="lnDoColl" style="width:100%;margin-top:var(--sp-4)">${t('loan.doColl')}</button>
      <p class="hint" style="margin-top:var(--sp-5);font-size:var(--fs-sm);color:var(--text-faint)">${t('loan.note')}</p>
    </div>`;
  host.appendChild(wrap);

  const $ = sel => wrap.querySelector(sel);

  // 拉健康数据
  (async () => {
    if (!S.addr) return;
    const [s1, d1, c1] = await Promise.all([
      window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'loan_status', caller: S.addr, params: `${S.addr}:address` }),
      window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'loan_debt_of', caller: S.addr, params: `${S.addr}:address` }),
      window.api.contractCall({ node: S.cfg.node, contract: S.cfg.contract, fn: 'loan_coll_of', caller: S.addr, params: `${S.addr}:address` }),
    ]);
    if (c1.ok) $('#lnColl').textContent = rawHacds(Number(c1.data.ret_val), true);
    if (d1.ok) $('#lnDebt').textContent = hacOf(Number(d1.data.ret_val));
    if (s1.ok) {
      const h = Number(s1.data.ret_val);
      $('#lnHealth').textContent = h ? (h / 100).toFixed(2) + '%' : '—';
      $('#lnHealth').style.color = h && h < 16000 ? 'var(--red)' : 'var(--text)';
    }
  })();

  // 借款
  $('#lnDoBorrow').onclick = async () => {
    if (!S.addr) return log(t('acct.locked'), 'err');
    const a = $('#lnBorrowAmt').value.trim();
    if (!a || Number(a) <= 0) return log(t('swap.needAmt'), 'warn');
    const btn = $('#lnDoBorrow'); btn.disabled = true; btn.textContent = t('btn.gening');
    try {
      readCfgFromUI();
      const res = await window.api.buildTx({
        mode: 'call',
        args: [S.addr, '0', S.cfg.contract, 'loan_borrow', `${Math.round(Number(a) * ATOMS_PER_UNIT)}:u128`],
        keyPath: S.keyPath, fee: null, gasMax: null, node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!res.ok) throw res;
      S.pending = res; showPreview(res);
    } catch (e) { logErr(t('common.buildFail'), e); }
    finally { btn.disabled = false; btn.textContent = t('loan.doBorrow'); }
  };

  // 还款
  $('#lnDoRepay').onclick = async () => {
    if (!S.addr) return log(t('acct.locked'), 'err');
    const a = $('#lnRepayAmt').value.trim();
    if (!a || Number(a) <= 0) return log(t('swap.needAmt'), 'warn');
    const btn = $('#lnDoRepay'); btn.disabled = true; btn.textContent = t('btn.gening');
    try {
      readCfgFromUI();
      const res = await window.api.buildTx({
        mode: 'call',
        args: [S.addr, '0', S.cfg.contract, 'loan_repay', `${Math.round(Number(a) * ATOMS_PER_UNIT)}:u128`],
        keyPath: S.keyPath, fee: null, gasMax: null, node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!res.ok) throw res;
      S.pending = res; showPreview(res);
    } catch (e) { logErr(t('common.buildFail'), e); }
    finally { btn.disabled = false; btn.textContent = t('loan.doRepay'); }
  };

  // 追加抵押
  $('#lnDoColl').onclick = async () => {
    if (!S.addr) return log(t('acct.locked'), 'err');
    const a = $('#lnCollAmt').value.trim();
    if (!a || Number(a) <= 0) return log(t('swap.needAmt'), 'warn');
    const btn = $('#lnDoColl'); btn.disabled = true; btn.textContent = t('btn.gening');
    try {
      readCfgFromUI();
      const res = await window.api.buildTx({
        mode: 'call',
        args: [S.addr, '0', S.cfg.contract, 'loan_add_collateral', `${Math.floor(Number(a))}:u128`],
        keyPath: S.keyPath, fee: null, gasMax: null, node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!res.ok) throw res;
      S.pending = res; showPreview(res);
    } catch (e) { logErr(t('common.buildFail'), e); }
    finally { btn.disabled = false; btn.textContent = t('loan.doColl'); }
  };
}

// AMM 池状态卡
function poolStatusCard() {
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h3>${t('amm.poolStatus')}</h3><div class="proto-grid" id="ammPoolStatus"><span class="muted">${t('ov.loading')}</span></div>`;
  (async () => {
    const r = await window.api.protocolOverview({ node: S.cfg.node, contract: S.cfg.contract, address: S.addr });
    const host = c.querySelector('#ammPoolStatus');
    if (!r.ok) { host.innerHTML = `<span class="qerr">${esc(r.error)}</span>`; return; }
    const p = r.data;
    // 【展示口径 D44】hacds 侧与协议状态统一走 raw（#2000 原始 amount），
    // HAC 侧走 zhu、份额走 share。
    host.innerHTML = [
      [t('p.poolHac'), hacOf(p.poolHac)], [t('p.poolDs'), rawHacds(p.poolDs, true)],
      [t('p.price'), p.poolPrice != null ? (Number(p.poolPrice)/1e8).toFixed(6) + ' HAC/hacds' : '—'],
      [t('p.lpTotal'), share(p.lpTotal)], [t('p.myLp'), share(p.myLp)],
      [t('p.pendHac'), hacOf(p.pendHac)], [t('p.pendDs'), rawHacds(p.pendDs, true)],
    ].map(([k,v])=>`<div class="proto-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  })();
  return c;
}

// 把某操作卡当前填写的内容转成 combo 动作规格（供“加入组合”与独立页复用）
// 由操作字段值构造合约 params 串。
// hacFields 内的字段按 HAC 计价：换算成 zhu 后上链；非法（空/非数字）填 0。
function buildCallParams(op, v) {
  const hacSet = new Set(op.hacFields || []);
  return (op.fields || []).map(f => {
    // deadline：用户没填（或填 0）时自动取「当前块高 + 窗口」。
    // 合约里比的是 block_height（不是时间戳）；窗口取 3600 块 ≈ 5 小时（300s/块），
    // 足够覆盖签名到上链的常规延迟，又不会久到失去保护意义。
    if (f.autoDeadline && !Number(v[f.name])) {
      return `${deadlineBlock()}:${f.type}`;
    }
    if (hacSet.has(f.name)) {
      const z = hacInputToZhu(v[f.name]);
      return `${z == null ? '0' : z}:${f.type}`;
    }
    // ⚠ 审计 C-H3 复核：address 类型来自索引器（外部数据），含 `,` 或 `:`
    //   会切开参数列表、注入额外参数位（`a,b:address` 会被当成两个参数）。
    //   这里强制 base58 字符集与长度。
    //
    //   ⚠ 非法时**抛异常中止**，不能返回空串：返回空串会拼出
    //     `,,100000000:u128` 这种畸形参数串，合约侧报一个看不懂的
    //     CallArgvTypeFail，用户以为是钱包坏了。抛出来才能干净地拦住。
    if (f.type === 'address') {
      const a = String(v[f.name] == null ? '' : v[f.name]).trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{26,36}$/.test(a)) {
        throw new Error(t('f.badAddress') + '：' + (a ? a.slice(0, 24) : '(空)'));
      }
      return `${a}:${f.type}`;
    }
    return `${v[f.name]}:${f.type}`;
  }).join(',') || '-';
}

// 块高缓存（10 秒有效）+ deadline 计算。
// 取不到块高时回退 0（= 合约不检查 deadline），宁可少一层保护也不要发不出交易。
let _heightCache = { h: 0, at: 0 };
async function refreshHeightCache() {
  try {
    const r = await window.api.httpGet({ url: `${S.cfg.node.replace(/\/$/, '')}/query/block/height/latest` });
    if (r.ok && r.data && r.data.height) {
      _heightCache = { h: Number(r.data.height), at: Date.now() };
    }
  } catch (e) { /* 静默：回退到 0 */ }
}
const DEADLINE_WINDOW = 3600;   // 块
function deadlineBlock() {
  if (!_heightCache.h) return 0;
  // 缓存过期（>10s）时用估算值兜底：本次交易从签名到上链通常 < 几分钟
  const age = Math.floor((Date.now() - _heightCache.at) / 1000);
  return _heightCache.h + Math.floor(age / 300) + DEADLINE_WINDOW;
}

function opToAction(op, v) {
  const me = S.addr || '';
  if (op.kind === 'call') {
    return { type: 'call', contract: S.cfg.contract, fn: op.fn, params: buildCallParams(op, v) };
  }
  if (op.kind === 'transfer') {
    const a = op.build(v, [me]).args;   // [main,0,sub,...]
    const sub = a[2];
    if (sub === 'hac-to') return { type: 'hac-to', to: a[3], hac: a[4] };
    if (sub === 'hac-from-to') return { type: 'hac-from-to', from: a[3], to: a[4], hac: a[5] };
    if (sub === 'asset-to') return { type: 'asset-to', to: a[3], serial: a[4], atoms: a[5] };
    if (sub === 'asset-from-to') return { type: 'asset-from-to', from: a[3], to: a[4], serial: a[5], atoms: a[6] };
  }
  return null;   // redeem / redeemHacd 走证书，组合里需 cert 文件，暂不支持
}
function addToCombo(op, card) {
  const v = collectFields(card);
  const act = opToAction(op, v);
  if (!act) { log(t('combo.notSupported'), 'err'); return false; }
  S.combo.push(act);
  return true;
}

// ===================== 清算 / 结算页（D51） =====================
// 三块：① LP 奖励结算 ② 金库清扫 ③ 借贷清算台（索引器台账）
let _liqOff = null;      // liq:progress 监听解绑
function liqHealthText(it) {
  if (it.noLoan) return t('liq.stNone');
  if (it.health === 999 || it.health === 0) return t('liq.stNone');
  if (it.health == null) return t('liq.stUnknown');
  return (it.health / 100).toFixed(2) + '%';
}
function liqStateTag(it) {
  if (it.health == null) return '<span class="muted">' + t('liq.stUnknown') + '</span>';
  if (it.liquidatable) return '<span class="err">' + t('liq.stLiq') + '</span>';
  if (it.noLoan) return '<span class="muted">' + t('liq.stNone') + '</span>';
  return '<span class="ok">' + t('liq.stSafe') + '</span>';
}

function renderLiqPanel(host) {
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML =
    '<h3>' + t('liq.title') + '</h3><p class="desc">' + t('liq.desc') + '</p>' +
    // ⚠ 2026-11-11 重组：原「① LP 奖励」已并入流动性页(lp_harvest 卡片)；
    //   原「② 金库清扫」已并入本页下文的 tools 卡片。
    //   本页只保留「③ 借贷清算台」。
    '<div class="liq-sec"><b>' + t('liq.secLoan') + '</b>' +
      '<div class="row">' +
        '<button class="primary" id="liqSync">' + t('liq.sync') + '</button>' +
        '<input id="liqAddAddr" placeholder="' + t('liq.addPh') + '" style="min-width:280px">' +
        '<button id="liqAddBtn">' + t('liq.add') + '</button>' +
      '</div>' +
      '<div class="hint" id="liqProg"></div>' +
      '<div class="hint" id="liqIdxState"></div>' +
      '<div id="liqTable" style="margin-top:8px"></div></div>';

  host.appendChild(card);

  // ③ 借贷清算台
  const renderTable = (list) => {
    const box = card.querySelector('#liqTable');
    if (!list || !list.length) { box.innerHTML = '<div class="muted">' + t('liq.empty') + '</div>'; return; }
    box.innerHTML = '<table class="wtable"><tr>' +
      ['liq.addr','liq.health','liq.debt','liq.coll','liq.state','liq.actions']
        .map(k => '<th>' + t(k) + '</th>').join('') + '</tr>' +
      // ⚠ it.address 来自索引器（外部数据），必须转义（2026-11-12 审计 C-H3）
      list.map(it => '<tr>' +
        '<td style="font-family:Consolas,monospace;font-size:11px">' + esc(it.address) + '</td>' +
        '<td>' + liqHealthText(it) + '</td>' +
        '<td>' + hacOf(it.debt) + '</td>' +
        '<td>' + rawHacds(it.coll, true) + '</td>' +
        '<td>' + liqStateTag(it) + '</td>' +
        // ⚠ data-a 是属性值，同样要转义 —— esc() 会转义双引号，可防止
        //   `"` 逃逸出属性注入新属性（审计 C-H3 复核补漏）。
        '<td>' + (it.liquidatable
            ? '<button class="primary liqGo" data-a="' + esc(it.address) + '">' + t('liq.liquidate') + '</button>'
            : '') +
          ' <button class="ghost liqDel" data-a="' + esc(it.address) + '">' + t('liq.del') + '</button></td>' +
        '</tr>').join('') + '</table>';
    box.querySelectorAll('.liqGo').forEach(b => b.onclick = () => {
      const addr = b.dataset.a;
      const it = (list || []).find(x => x.address === addr) || {};
      const info = t('liq.addr') + ': ' + addr + '\n' + t('liq.health') + ': ' + liqHealthText(it);
      if (!confirm(t('liq.liqConfirm') + '\n' + info)) return;
      buildCall('loan_liquidate', addr + ':address', card, b);
    });
    box.querySelectorAll('.liqDel').forEach(b => b.onclick = async () => {
      await window.api.liqWatch({ node:S.cfg.node, contract:S.cfg.contract, indexer:S.cfg.indexer, action:'remove', address:b.dataset.a });
      log(t('liq.removed') + b.dataset.a, 'ok'); loadSnap();
    });
  };
  const loadSnap = async () => {
    readCfgFromUI();
    if (_liqOff) { _liqOff(); _liqOff = null; }
    const r = await window.api.liqSnapshot({ node:S.cfg.node, contract:S.cfg.contract, indexer:S.cfg.indexer });
    if (!r.ok) { renderTable(null); return; }
    renderTable(r.list);
  };
  card.querySelector('#liqSync').onclick = async (e) => {
    readCfgFromUI();
    const btn = e.currentTarget; btn.disabled = true;
    const prog = card.querySelector('#liqProg');
    if (_liqOff) _liqOff();
    _liqOff = window.api.onLiqProgress(p => { prog.textContent = t('liq.syncing', { h:p.h, n:p.scanned, f:p.found }); });
    const r = await window.api.liqSync({ node:S.cfg.node, contract:S.cfg.contract, indexer:S.cfg.indexer });
    if (_liqOff) { _liqOff(); _liqOff = null; }
    btn.disabled = false; prog.textContent = '';
    if (!r.ok) { log(t('liq.syncFail') + r.error, 'err'); return; }
    log(t('liq.synced', { h:r.data.head, n:r.data.watched })
      + (r.source === 'server' ? ' ' + t('liq.viaServer') : ' ' + t('liq.viaLocal')), 'ok');
    loadSnap();
  };
  card.querySelector('#liqAddBtn').onclick = async () => {
    const inp = card.querySelector('#liqAddAddr');
    const a = (inp.value || '').trim();
    if (!a) { log(t('liq.needAddr'), 'warn'); return; }
    const r = await window.api.liqWatch({ node:S.cfg.node, contract:S.cfg.contract, indexer:S.cfg.indexer, action:'add', address:a });
    if (!r.ok) { log(t('liq.syncFail') + r.error, 'err'); return; }
    inp.value = ''; log(t('liq.added') + a, 'ok'); loadSnap();
  };
  // 服务端索引器状态提示
  (async () => {
    const st = await window.api.liqProbe({ indexer: S.cfg.indexer });
    const el = card.querySelector('#liqIdxState');
    if (!el) return;
    if (st.ok && st.up) el.textContent = t('liq.idxUp', { h: st.head, n: st.watched });
    else if (S.cfg.indexer) el.textContent = t('liq.idxDown');
    else el.textContent = '';
  })();

  loadSnap();
}

// 独立“原子交易”页
function renderComboPanel(host) {
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = '<h3>' + t('combo.title') + '</h3><p class="desc">' + t('combo.desc') + '</p>' +
    '<div id="comboList"></div>' +
    '<div class="row">' +
      '<button id="comboBuild" class="primary">' + t('combo.buildBtn') + '</button>' +
      '<button id="comboClear" class="ghost">' + t('btn.clear') + '</button>' +
    '</div>' +
    '<details class="adv"><summary>' + t('combo.jsonTitle') + '</summary>' +
      '<textarea id="comboJson" rows="6" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:8px;font-family:Consolas,monospace;font-size:12px"></textarea>' +
      '<div class="row"><button id="comboLoadJson" class="ghost">' + t('combo.loadJson') + '</button></div>' +
    '</details>';
  host.appendChild(card);
  const list = card.querySelector('#comboList');
  const render = () => {
    if (!S.combo.length) { list.innerHTML = '<p class="muted">' + t('combo.empty') + '</p>'; return; }
    list.innerHTML = S.combo.map((a, i) =>
      '<div class="proto-row"><span class="k">' + (i + 1) + '. ' + a.type + '</span>' +
      '<span class="v">' + JSON.stringify(a).slice(0, 80) + ' <button class="ghost" data-del="' + i + '">×</button></span></div>').join('');
    list.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { S.combo.splice(+b.dataset.del, 1); render(); });
  };
  render();
  card.querySelector('#comboBuild').onclick = async () => {
    readCfgFromUI();
    if (!S.addr) return log(t('acct.locked'), 'err');
    if (S.combo.length < 1) return log(t('combo.empty'), 'err');
    const spec = { contract: S.cfg.contract, actions: S.combo };
    log(t('combo.building', { n: S.combo.length }));
    const r = await window.api.combo({ specObject: spec, mainAddr: S.addr, node: S.cfg.node, keyPath: S.keyPath, contract: S.cfg.contract });
    if (!r.ok) return logErr(t('common.buildFail'), r);
    S.pending = r; showPreview(r); log(t('common.signed', { n: r.signedBytes || r.txbytes }), 'ok');
  };
  card.querySelector('#comboClear').onclick = () => { S.combo = []; render(); };
  card.querySelector('#comboLoadJson').onclick = () => {
    try {
      const obj = JSON.parse(card.querySelector('#comboJson').value);
      const acts = Array.isArray(obj) ? obj : (obj.actions || []);
      if (!acts.length) throw new Error('empty');
      S.combo = acts; render(); log(t('combo.loadedJson', { n: acts.length }), 'ok');
    } catch (e) { log(t('off.badJson') + e.message, 'err'); }
  };
}

function renderQueryPanel(host) {
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = `<h3>${t('q.title')}</h3><p class="desc">${t('q.desc')}</p>`;
  QUERIES.forEach(q => {
    const box = document.createElement('div');
    box.style.cssText = 'margin-bottom:12px;border-top:1px dashed var(--line);padding-top:10px';
    const grid = document.createElement('div'); grid.className = 'grid';
    q.params.forEach(p => grid.appendChild(fieldEl({ name:p.name, label:p.label, hint:p.type }, S.addr || '')));
    box.appendChild(grid);
    const row = document.createElement('div'); row.className = 'row';
    const b = document.createElement('button'); b.textContent = t(q.btnKey || 'btn.query');
    const out = document.createElement('div'); out.className = 'readout'; out.hidden = true;
    b.onclick = async () => {
      readCfgFromUI();
      const v = collectFields(box);
      const params = q.params.map(p => `${v[p.name]}:${p.type}`).join(',');
      const caller = S.addr || S.cfg.contract;
      const r = await window.api.contractCall({ node:S.cfg.node, contract:S.cfg.contract, fn:q.fn, caller, params });
      out.hidden = false;
      if (r.ok) {
        out.innerHTML = `<span class="qval">${esc(q.label)} = ${esc(r.data.ret_val)}</span>\n` +
          `<span class="muted">${esc(t('common.raw'))}${esc(JSON.stringify(r.data))}</span>`;
        log(t(q.btnKey || 'btn.query')+' = '+r.data.ret_val, 'ok');
      } else {
        out.innerHTML = `<span class="qerr">${esc(r.error)}</span>` + (r.hint ? `\n<span class="qhint">${esc(r.hint)}</span>` : '');
        log(t(q.btnKey || 'btn.query')+': '+r.error, 'err');
      }
    };
    row.appendChild(b); box.appendChild(row); box.appendChild(out);
    card.appendChild(box);
  });
  host.appendChild(card);
}

// ---- 资金页：本地址 ↔ 合约地址，只做充提 ----
//
// 设计边界（2026-11-11 重组）：
//   · 本页**只处理** HAC 与 hacds 两种资产与合约的充提
//   · HACD（钻石）与合约的交互在 HACD 页，本页不出现
//   · 链上地址之间的转账在「转账」页，本页不出现
/**
 * 转账页（网页端双卡布局）。
 *
 * 只做链上地址之间的转账，不碰合约：
 *   左卡 HAC 转账 / 右卡 hacds 转账（均用 asset-to，发送方隐含为交易主地址）
 *   下方 HACD 转账 + 其它资产转账
 */
function renderXferPage(host) {
  const wrap = document.createElement('div');
  wrap.className = 'grid-2';
  wrap.innerHTML = `
    <div class="card">
      <div class="card-hd">${t('xfer.hacTitle')}</div>
      <label class="field-label">${t('f.toAddr')}</label>
      <input class="field-input mono" id="xferHacTo" type="text" placeholder="1XXXXXXXX...">
      <label class="field-label" style="margin-top:var(--sp-4)">${t('f.hacAmt')}</label>
      <input class="field-input mono" id="xferHacAmt" type="text" placeholder="0.0" inputmode="decimal">
      <button class="btn-primary" id="btnXferHac" style="width:100%;margin-top:var(--sp-4)">${t('xfer.doHac')}</button>
    </div>

    <div class="card">
      <div class="card-hd">${t('xfer.dsTitle')}</div>
      <label class="field-label">${t('f.toAddr')}</label>
      <input class="field-input mono" id="xferDsTo" type="text" placeholder="1XXXXXXXX...">
      <label class="field-label" style="margin-top:var(--sp-4)">${t('f.atomsNum')}</label>
      <input class="field-input mono" id="xferDsAmt" type="text" placeholder="0" inputmode="decimal">
      <button class="btn-primary" id="btnXferDs" style="width:100%;margin-top:var(--sp-4)">${t('xfer.doDs')}</button>
    </div>`;
  host.appendChild(wrap);

  // HACD 转账（整行）
  const hacdCard = document.createElement('div');
  hacdCard.className = 'card';
  hacdCard.style.marginTop = 'var(--sp-4)';
  hacdCard.innerHTML = `
    <div class="card-hd">${t('xfer.hacdTitle')}</div>
    <p class="desc" style="font-size:12.5px">${t('xfer.hacdNote')}</p>
    <label class="field-label">${t('xfer.hacdNames')}</label>
    <input class="field-input mono" id="xferHacdNames" type="text" placeholder="WTYUIA,HYXYHY">
    <label class="field-label" style="margin-top:var(--sp-4)">${t('f.toAddr')}</label>
    <input class="field-input mono" id="xferHacdTo" type="text" placeholder="1XXXXXXXX...">
    <button class="btn-primary" id="btnXferHacd" style="width:100%;margin-top:var(--sp-4)">${t('xfer.doHacd')}</button>`;
  host.appendChild(hacdCard);

  // 其它资产（PC 端独有，网页端也已加）
  const otherCard = document.createElement('div');
  otherCard.className = 'card';
  otherCard.style.marginTop = 'var(--sp-4)';
  otherCard.innerHTML = `
    <div class="card-hd">${t('op.trOther.t')}</div>
    <p class="desc" style="font-size:12.5px">${t('op.trOther.d')}</p>
    <div class="grid-2" style="gap:var(--sp-3)">
      <div>
        <label class="field-label">${t('f.serialNum')}</label>
        <input class="field-input mono" id="xferOtherSerial" type="text" placeholder="2000">
      </div>
      <div>
        <label class="field-label">${t('f.atomsNum2')}</label>
        <input class="field-input mono" id="xferOtherAtoms" type="text" placeholder="0">
      </div>
    </div>
    <label class="field-label" style="margin-top:var(--sp-3)">${t('f.toAddr')}</label>
    <input class="field-input mono" id="xferOtherTo" type="text" placeholder="1XXXXXXXX...">
    <button class="btn-primary" id="btnXferOther" style="width:100%;margin-top:var(--sp-4)">${t('op.trOther.t')}</button>`;
  host.appendChild(otherCard);

  // ---------------- 事件 ----------------
  const $w = sel => host.querySelector(sel);

  /** 统一构建 + 预览 */
  const build = async (sub, args) => {
    readCfgFromUI();
    if (!S.addr) return log(t('acct.locked'), 'err');
    try {
      log(t('xfer.building') || t('r.building'));
      const res = await window.api.buildTx({
        mode: 'transfer', args: [S.addr, '0', sub].concat(args),
        keyPath: S.keyPath, fee: null, gasMax: null,
        node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!res.ok) throw res;
      S.pending = res; showPreview(res);
      log(t('common.signed', { n: res.signedBytes || res.txbytes }), 'ok');
    } catch (e) {
      logErr(t('xfer.fail'), e);
    }
  };

  const needAddr = v => {
    if (!v) { log(t('xfer.needAddr'), 'warn'); return false; }
    return true;
  };
  const needAmt = v => {
    if (!v || Number(v) <= 0) { log(t('fund.needAmt'), 'warn'); return false; }
    return true;
  };

  $w('#btnXferHac').onclick = () => {
    const to = ($w('#xferHacTo').value || '').trim();
    const amt = ($w('#xferHacAmt').value || '').trim();
    if (!needAddr(to) || !needAmt(amt)) return;
    build('hac-to', [to, amt]);
  };

  $w('#btnXferDs').onclick = () => {
    const to = ($w('#xferDsTo').value || '').trim();
    const amt = ($w('#xferDsAmt').value || '').trim();
    if (!needAddr(to) || !needAmt(amt)) return;
    build('asset-to', [to, 'hacds', String(Math.floor(Number(amt)))]);
  };

  $w('#btnXferHacd').onclick = () => {
    const names = ($w('#xferHacdNames').value || '').split(/[\s,]+/)
      .map(x => x.trim().toUpperCase()).filter(Boolean);
    const to = ($w('#xferHacdTo').value || '').trim();
    if (!names.length) { log(t('xfer.needNames'), 'warn'); return; }
    if (!needAddr(to)) return;
    build('hacd-to', [to, names.join(',')]);
  };

  $w('#btnXferOther').onclick = () => {
    const serial = ($w('#xferOtherSerial').value || '').trim().replace(/^#/, '');
    const atoms = ($w('#xferOtherAtoms').value || '').trim();
    const to = ($w('#xferOtherTo').value || '').trim();
    if (!needAddr(to) || !needAmt(atoms)) return;
    if (!/^\d+$/.test(serial)) { log(t('xfer.needSerial'), 'warn'); return; }
    build('asset-to', [to, serial, String(Math.floor(Number(atoms)))]);
  };
}

function renderFundPanel(host) {
  // ① 顶部：合约内余额（PC 端独有，网页端没有）
  const bal = document.createElement('div');
  bal.className = 'card';
  bal.style.marginBottom = 'var(--sp-3)';
  bal.innerHTML = `<div class="card-hd">${t('fund.inContract')}</div>` +
    `<div class="proto-grid" id="fundBal"><span class="muted">${t('ov.loading')}</span></div>`;
  host.appendChild(bal);
  (async () => {
    const el = bal.querySelector('#fundBal');
    if (!S.addr) { el.innerHTML = `<span class="muted">${t('fund.needUnlock')}</span>`; return; }
    const r = await window.api.protocolOverview({ node: S.cfg.node, contract: S.cfg.contract, address: S.addr });
    if (!r.ok) { el.innerHTML = '<span class="qerr">' + esc(r.error) + '</span>'; return; }
    const d = r.data || {};
    el.innerHTML = [
      [t('fund.hacCredit'), hacOf(d.balHac)],
      [t('fund.dsQuota'), rawHacds(d.balDs, true)],
    ].map(([k, v]) => `<div class="proto-item"><span class="pk">${esc(k)}</span><span class="pv">${esc(v)}</span></div>`).join('');
  })();

  // ② 双卡：左 HAC 充提 / 右 hacds 充提
  const wrap = document.createElement('div');
  wrap.className = 'grid-2';
  wrap.innerHTML = `
    <div class="card">
      <div class="card-hd">${t('fund.hacTitle')}</div>

      <label class="field-label">${t('fund.hacIn')}</label>
      <input class="field-input mono" id="fundHacIn" type="text" placeholder="0.0" inputmode="decimal">
      <button class="btn-primary" id="btnFundHacIn" style="width:100%;margin-top:var(--sp-2)">${t('fund.doHacIn')}</button>

      <label class="field-label" style="margin-top:var(--sp-5)">${t('fund.hacOut')}</label>
      <input class="field-input mono" id="fundHacOut" type="text" placeholder="0.0" inputmode="decimal">
      <button class="btn-ghost" id="btnFundHacOut" style="width:100%;margin-top:var(--sp-2)">${t('fund.doHacOut')}</button>
    </div>

    <div class="card">
      <div class="card-hd">${t('fund.dsTitle')}</div>

      <label class="field-label">${t('fund.dsIn')}</label>
      <input class="field-input mono" id="fundDsIn" type="text" placeholder="0" inputmode="decimal">
      <button class="btn-primary" id="btnFundDsIn" style="width:100%;margin-top:var(--sp-2)">${t('fund.doDsIn')}</button>

      <label class="field-label" style="margin-top:var(--sp-5)">${t('fund.dsOut')}</label>
      <input class="field-input mono" id="fundDsOut" type="text" placeholder="0" inputmode="decimal">
      <button class="btn-ghost" id="btnFundDsOut" style="width:100%;margin-top:var(--sp-2)">${t('fund.doDsOut')}</button>

      <div class="note" style="margin-top:var(--sp-5);font-size:12.5px">
        ${t('fund.hacdNote')}
        <button class="ghost" id="goHacdFromFund" style="margin-left:8px">${t('fund.goHacd')}</button>
      </div>
    </div>`;
  host.appendChild(wrap);

  // ③ 事件
  const on = (sel, fn) => { const el = wrap.querySelector(sel); if (el) el.onclick = fn; };

  /** 四种充提：都走原生转账动作 */
  const doFund = async (kind) => {
    if (!S.addr) return log(t('acct.locked'), 'err');
    if (S.busy) return;
    const cfg = {
      'hac-in':  { input: '#fundHacIn',  sub: 'hac-to',        labelKey: 'fund.doHacIn',  unit: 'hac' },
      'hac-out': { input: '#fundHacOut', sub: 'hac-from-to',   labelKey: 'fund.doHacOut', unit: 'hac' },
      'ds-in':   { input: '#fundDsIn',   sub: 'asset-to',      labelKey: 'fund.doDsIn',   unit: 'atoms' },
      'ds-out':  { input: '#fundDsOut',  sub: 'asset-from-to', labelKey: 'fund.doDsOut',  unit: 'atoms' },
    }[kind];
    if (!cfg) return;
    const raw = (wrap.querySelector(cfg.input).value || '').trim();
    if (!raw || Number(raw) <= 0) return log(t('fund.needAmt'), 'warn');

    S.busy = true;
    try {
      log(t('fund.building'));
      const args = [S.addr, '0', cfg.sub];
      if (cfg.sub.endsWith('from-to')) args.push(S.cfg.contract);          // from = 合约
      args.push(kind.endsWith('-in') ? S.cfg.contract : S.addr);           // to
      if (cfg.unit === 'hac') args.push(raw);
      else { args.push('hacds'); args.push(String(Math.floor(Number(raw)))); }

      const res = await window.api.buildTx({
        mode: 'transfer', args, keyPath: S.keyPath, fee: null, gasMax: null,
        node: S.cfg.node, contract: S.cfg.contract,
      });
      if (!res.ok) throw res;
      S.pending = res; showPreview(res);
      log(t(cfg.labelKey) + ' — ' + t('common.signed', { n: res.signedBytes || res.txbytes }), 'ok');
    } catch (e) {
      logErr(t('fund.fail'), e);
    } finally { S.busy = false; }
  };

  on('#btnFundHacIn',  () => doFund('hac-in'));
  on('#btnFundHacOut', () => doFund('hac-out'));
  on('#btnFundDsIn',   () => doFund('ds-in'));
  on('#btnFundDsOut',  () => doFund('ds-out'));
  on('#goHacdFromFund', () => goTab('hacd'));
}

// ---- 工具页：查询 / 运维 / 高级 ----
//
// 子面板（renderQueryPanel / renderLiqPanel / renderComboPanel / renderOfflinePanel）
// 都各自生成带 <h3> 的 card，所以这里**只加分组小标题**，不再包一层 card，
// 否则会出现「工具标题 + 子面板标题」两个 h3 叠在一起。
function renderToolsPanel(host) {
  // 工具页用「分组选择器」，而不是把所有内容平铺一页。
  // 一页全展开会有 8+ 张卡片，滚动很长且找不到东西。
  const GROUPS = [
    { id: 'query',    labelKey: 'tools.query' },
    { id: 'ops',      labelKey: 'tools.ops' },
    { id: 'rent',     labelKey: 'tools.rent' },
    { id: 'advanced', labelKey: 'tools.advanced' },
  ];
  if (!GROUPS.some(g => g.id === S.toolsGroup)) S.toolsGroup = 'query';

  // 选择器
  const bar = document.createElement('div');
  bar.className = 'card';
  bar.style.padding = '10px 14px';
  bar.innerHTML = GROUPS.map(g =>
    `<button class="ghost" data-tg="${g.id}" style="margin-right:8px${S.toolsGroup === g.id ? ';font-weight:600' : ''}">${t(g.labelKey)}</button>`
  ).join('');
  host.appendChild(bar);
  bar.querySelectorAll('[data-tg]').forEach(b => {
    b.onclick = () => { S.toolsGroup = b.dataset.tg; renderPanels(); };
  });

  const g = S.toolsGroup;
  if (g === 'query') { renderQueryPanel(host); return; }
  if (g === 'advanced') { renderComboPanel(host); renderOfflinePanel(host); return; }
  if (g === 'rent') { renderRentPanel(host); return; }

  // ---- ops：金库清扫 + 清算监控 ----
  const TREASURY = '1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK';
  const treCard = document.createElement('div');
  treCard.className = 'card';
  treCard.innerHTML = `<h3>${t('liq.secTre')}</h3>` +
    `<div class="proto-grid" id="toolsTreGrid"><span class="muted">${t('ov.loading')}</span></div>` +
    `<div class="hint" id="toolsTreHint"></div>`;
  host.appendChild(treCard);
  treCard.querySelector('#toolsTreHint').textContent = t('liq.treHint', { a: TREASURY });
  (async () => {
    readCfgFromUI();
    const el = treCard.querySelector('#toolsTreGrid');
    const r = await window.api.liqTreasury({ node: S.cfg.node, contract: S.cfg.contract, caller: S.addr });
    if (!r.ok) { el.innerHTML = '<span class="qerr">' + esc(r.error) + '</span>'; return; }
    el.innerHTML = [[t('liq.treHac'), hacOf(r.hac)], [t('liq.treDs'), rawHacds(r.ds, true)]]
      .map(([k, v]) => '<div class="proto-row"><span class="k">' + k + '</span><span class="v">' + (v == null ? '—' : v) + '</span></div>').join('');
    window._treasuryCache = r;
  })();
  OPS.filter(o => o.tab === 'tools').forEach(op => host.appendChild(opCard(op)));
  renderLiqPanel(host);
}

/**
 * 续租面板（storage 键续期）。
 *
 * 为什么需要：Hacash 的 storage 是按租期计费的，键到期后 storage_load 会
 * 报 StorageNotActive(108)，导致该用户所有操作整笔回滚。所以账本键必须持续续租。
 *
 * 关键约束（合约 rent_keys）：
 *   · 入参是**原始键字节的连排**（如 "u:" + 地址21字节），钱包自己拼不出来
 *     —— 必须从索引器 /rent_batches 取。
 *   · 同批键必须**等长**（klen 一致），所以索引器按长度分组。
 *   · 单笔上限 RENT_MAX_KEYS = 10 键（storage 单桶 111,911 的限制）。
 *   · period 必须 >= 300 且 <= 3000，否则合约返回 62/63。
 *   · rent_keys **有报酬**（0.07 HAC/键，从 tre:hac 出），任何人可调。
 *   · topup_keys **无报酬**，用于首注后把新键从 100 期补到 300 期。
 */
function renderRentPanel(host) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    `<h3>${t('rent.title')}</h3>` +
    `<p class="desc">${t('rent.desc')}</p>` +
    `<div class="proto-grid" id="rentStat"><span class="muted">${t('ov.loading')}</span></div>` +
    `<div class="row" style="margin-top:10px">` +
      `<button class="primary" id="rentLoad">${t('rent.load')}</button>` +
      `<button id="rentDo" disabled>${t('rent.do')}</button>` +
      `<span class="hint" id="rentHint"></span>` +
    `</div>` +
    `<div id="rentBatches" style="margin-top:12px"></div>`;
  host.appendChild(card);

  const btnLoad = card.querySelector('#rentLoad');
  const btnDo = card.querySelector('#rentDo');
  const hint = card.querySelector('#rentHint');
  const stat = card.querySelector('#rentStat');
  const listBox = card.querySelector('#rentBatches');
  let batches = [];

  // ① 先从索引器拉续租批次
  btnLoad.onclick = async () => {
    readCfgFromUI();
    if (!S.cfg.indexer) { hint.textContent = t('rent.noIndexer'); return; }
    btnLoad.disabled = true;
    hint.textContent = t('rent.loading');
    try {
      const r = await window.api.httpGet({ url: `${S.cfg.indexer}/rent_batches?max=10` });
      if (!r.ok) { hint.textContent = t('rent.loadFail') + r.error; return; }
      // 实测返回：{ ret, batches:[{klen,blob,count,keys}], total, total_all, truncated, dropped }
      batches = (r.data && r.data.batches) || [];
      const total = (r.data && r.data.total != null) ? r.data.total : batches.length;
      stat.innerHTML = `<div class="proto-item"><span class="pk">${t('rent.batchCount')}</span><span class="pv">${batches.length}</span></div>`
        + `<div class="proto-item"><span class="pk">${t('rent.keyTotal')}</span><span class="pv">${total}</span></div>`;
      if (!batches.length) { listBox.innerHTML = `<div class="muted">${t('rent.empty')}</div>`; hint.textContent = ''; return; }
      listBox.innerHTML = batches.map((b, i) =>
        `<div class="proto-row"><span class="k">#${i + 1}</span>` +
        `<span class="v">klen=${b.klen} · ${b.count} ${t('rent.keys')}</span></div>`).join('');
      btnDo.disabled = false;
      hint.textContent = t('rent.ready', { n: batches.length })
        + ((r.data && r.data.truncated) ? ' ' + t('rent.truncated') : '');
    } catch (e) {
      hint.textContent = t('rent.loadFail') + (e.message || e);
    } finally { btnLoad.disabled = false; }
  };

  // ② 生成续租交易（逐批构建，交给统一的预览+签名流程）
  //
  // 复用 buildTx + showPreview：钱包不自动广播，用户在预览卡里确认后签名。
  // 逐批是因为合约单笔上限 10 键；每批单独确认，出问题容易定位。
  btnDo.onclick = async () => {
    if (!S.addr) { log(t('acct.locked'), 'err'); return; }
    if (!batches.length) return;
    btnDo.disabled = true;
    try {
      let built = 0;
      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        // rent_keys(keys: bytes, klen: u128, period: u128)
        // keys 是连排的原始键字节（hex），klen 决定合约如何切分；period 取 300（RENT_PERIOD）
        const params = `${b.blob}:bytes,${b.klen}:u128,300:u128`;
        hint.textContent = t('rent.sending', { i: i + 1, n: batches.length });
        const res = await window.api.buildTx({
          mode: 'call',
          args: [S.addr, '0', S.cfg.contract, 'rent_keys', params],
          keyPath: S.keyPath, fee: null, gasMax: null,
          node: S.cfg.node, contract: S.cfg.contract,
        });
        if (!res.ok) {
          log(t('rent.failOne', { i: i + 1 }) + (res.error || ''), 'err');
          continue;
        }
        built++;
        S.pending = res;
        showPreview(res);
        log(t('rent.built', { i: i + 1, n: batches.length }), 'ok');
        // 多批时只生成第一笔，避免一次弹出多张预览卡；
        // 用户签完再点一次「生成」拿下一批。
        if (batches.length > 1) { hint.textContent = t('rent.oneAtATime'); break; }
      }
      if (built === 1 && batches.length === 1) hint.textContent = t('rent.builtOne');
    } catch (e) {
      logErr(t('common.buildFail'), e);
    } finally { btnDo.disabled = false; }
  };
}

// ---- 离线签名面板 ----
function renderOfflinePanel(host) {
  // ---- ① 构建未签名交易体（离线，无需私钥）----
  const build = document.createElement('div'); build.className = 'card';
  build.innerHTML =
    '<h3>' + t('off.buildTitle') + '</h3>' +
    '<p class="desc">' + t('off.buildDesc') + '</p>' +
    '<div class="grid">' +
      '<div class="field"><label>' + t('off.mainAddr') + '</label>' +
        '<input data-b="main" value="' + (S.addr || '') + '"></div>' +
      '<div class="field"><label>' + t('off.kind') + '</label>' +
        '<select data-b="kind">' +
          '<option value="transfer">' + t('off.kTransfer') + '</option>' +
          '<option value="call">' + t('off.kCall') + '</option>' +
          '<option value="combo">' + t('off.kCombo') + '</option>' +
        '</select></div>' +
    '</div>' +
    '<div class="grid" id="bTransfer">' +
      '<div class="field"><label>' + t('off.trType') + '</label>' +
        '<select data-b="trtype">' +
          '<option value="hac-to">hac-to</option>' +
          '<option value="hac-from-to">hac-from-to</option>' +
          '<option value="asset-to">asset-to</option>' +
          '<option value="asset-from-to">asset-from-to</option>' +
        '</select></div>' +
      '<div class="field"><label>' + t('off.trTo') + '</label><input data-b="trto"></div>' +
      '<div class="field"><label>' + t('off.trAmt') + '</label><input data-b="tramt" placeholder="1:248 / hacds 100000000"></div>' +
    '</div>' +
    '<div class="grid" id="bCall" hidden>' +
      '<div class="field"><label>' + t('off.cFn') + '</label><input data-b="cfn" placeholder="swap_hac_to_ds"></div>' +
      '<div class="field"><label>' + t('off.cParams') + '</label><input data-b="cparams" placeholder="1000000:u128,0:u128"></div>' +
    '</div>' +
    '<div class="field" id="bCombo" hidden><label>' + t('off.comboSpec') + '</label>' +
      '<textarea data-b="combo" rows="6" spellcheck="false" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:8px;font-family:Consolas,monospace;font-size:12px"></textarea>' +
      '<div class="hint">' + t('off.comboHint') + '</div></div>' +
    '<div class="row"><button id="offBuild" class="primary">' + t('off.buildBtn') + '</button>' +
      '<button id="offBuildSign" class="ghost">' + t('off.buildSignBtn') + '</button></div>';
  host.appendChild(build);

  const bsel = build.querySelector('[data-b="kind"]');
  bsel.onchange = function () {
    build.querySelector('#bTransfer').hidden = bsel.value !== 'transfer';
    build.querySelector('#bCall').hidden = bsel.value !== 'call';
    build.querySelector('#bCombo').hidden = bsel.value !== 'combo';
  };
  const bv = (k) => { const e = build.querySelector('[data-b="' + k + '"]'); return e ? e.value.trim() : ''; };
  let pending = null;

  async function doBuild() {
    const main = bv('main') || S.addr;
    if (!main) return log(t('off.needMain'), 'err');
    const kind = bv('kind');
    if (kind === 'combo') {
      let obj;
      try { obj = JSON.parse(bv('combo')); } catch (e) { return log(t('off.badJson') + e.message, 'err'); }
      const r = await window.api.buildUnsigned({ mode: 'combo', args: [main, '0'], spec: obj, contract: S.cfg.contract });
      if (!r.ok) return logErr(t('common.buildFail'), r);
      pending = r; fill(r); return;
    }
    let mode, args;
    if (kind === 'call') {
      const fn = bv('cfn'); if (!fn) return log(t('off.needArgs'), 'err');
      mode = 'call'; args = [main, '0', S.cfg.contract, fn, bv('cparams') || '-'];
    } else {
      const tt = bv('trtype'), to = bv('trto'), amt = bv('tramt');
      if (!to || !amt) return log(t('off.needArgs'), 'err');
      mode = 'transfer';
      if (tt === 'hac-to') args = [main, '0', 'hac-to', to, amt];
      else if (tt === 'hac-from-to') args = [main, '0', 'hac-from-to', main, to, amt];
      else if (tt === 'asset-to') args = [main, '0', 'asset-to', to, 'hacds', amt.replace('hacds', '').trim()];
      else args = [main, '0', 'asset-from-to', main, to, 'hacds', amt.replace('hacds', '').trim()];
    }
    const r = await window.api.buildUnsigned({ mode: mode, args: args, contract: S.cfg.contract });
    if (!r.ok) return logErr(t('common.buildFail'), r);
    pending = r; fill(r);
  }
  function fill(r) {
    const box = document.querySelector('#offUnsigned');
    if (box) box.value = '0x' + (r.unsigned || '');
    log(t('off.built', { n: r.txbytes || '?' }), 'ok');
  }
  build.querySelector('#offBuild').onclick = doBuild;
  build.querySelector('#offBuildSign').onclick = async () => { await doBuild(); if (pending) document.querySelector('#offSign').click(); };

  // ---- ② 签名 + 校验 + 翻译 + 广播 ----
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML =
    '<h3>' + t('off.title') + '</h3>' +
    '<p class="desc">' + t('off.desc') + '</p>' +
    '<div class="grid">' +
      '<div class="field"><label>' + t('off.unsigned') + '</label><input id="offUnsigned"></div>' +
      '<div class="field"><label>' + t('off.signed') + '</label><input id="offSigned"></div>' +
    '</div>' +
    '<div class="row">' +
      '<button id="offSign" class="primary">' + t('off.sign') + '</button>' +
      '<button id="offCheck" class="ghost">' + t('off.check') + '</button>' +
      '<button id="offTranslate" class="ghost">' + t('off.translate') + '</button>' +
      '<button id="offBroadcast" class="ghost">' + t('off.broadcast') + '</button>' +
      '<button id="offQr" class="ghost">' + t('qr.show') + '</button>' +
    '</div>' +
    '<div id="offQrBox" style="margin-top:10px" hidden></div>';
  host.appendChild(card);
  const get = (id) => document.querySelector('#' + id).value.trim().replace(/^0x/, '');
  card.querySelector('#offSign').onclick = async () => {
    readCfgFromUI();
    const u = get('offUnsigned'); if (!u) return log(t('off.needUnsigned'), 'err');
    const r = await window.api.signRaw({ unsignedHex: u, keyPath: S.keyPath });
    if (!r.ok) return logErr(t('off.needUnsigned'), r);
    document.querySelector('#offSigned').value = '0x' + r.signed;
    log(t('common.signed', { n: r.signedBytes || r.txbytes }), 'ok');
  };
  card.querySelector('#offCheck').onclick = async () => {
    readCfgFromUI();
    const u = get('offUnsigned'); if (!u) return log(t('off.needUnsigned'), 'err');
    const r = await window.api.checkTx({ node: S.cfg.node, hex: u });
    if (r.ok) log(t('common.checkRet', { r: (r.data || {}).ret }), (r.data || {}).ret === 0 ? 'ok' : 'warn');
    else logErr(t('common.checkFail'), r);
  };
  card.querySelector('#offTranslate').onclick = async () => {
    readCfgFromUI();
    const u = get('offSigned') || get('offUnsigned'); if (!u) return log(t('off.needUnsigned'), 'err');
    const r = await window.api.translateTx({ node: S.cfg.node, hex: u });
    if (!r.ok) return logErr(t('common.translateFail'), r);
    log(t('common.translated') + ': ' + ((r.data || {}).description || ''), 'ok');
  };
  // ---- 二维码：把交易体显示为二维码（大交易自动分片）----
  const qrState = { parts: [], idx: 0 };
  function makeQrSvg(text, px) {
    const q = qrcode(0, 'M');       // 自动版本，纠错 M
    q.addData(text); q.make();
    const n = q.getModuleCount();
    const cell = Math.max(2, Math.floor(px / n));
    const size = cell * n;
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (q.isDark(r, c)) path += 'M' + (c * cell) + ',' + (r * cell) + 'h' + cell + 'v' + cell + 'h-' + cell + 'z';
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" style="background:#fff;border-radius:6px">' +
      '<path d="' + path + '" fill="#000"/></svg>';
  }
  function splitParts(hex, maxPer) {
    // 每片带包头 HXDS/<seq>/<total>/<crc>/<data>
    const total = Math.max(1, Math.ceil(hex.length / maxPer));
    const parts = [];
    for (let i = 0; i < total; i++) {
      const data = hex.slice(i * maxPer, (i + 1) * maxPer);
      // 简易校验：片内字符和（模 65536），十六进制
      let sum = 0; for (const ch of data) sum = (sum + ch.charCodeAt(0)) & 0xffff;
      parts.push('HXDS/' + (i + 1) + '/' + total + '/' + sum.toString(16) + '/' + data);
    }
    return parts;
  }
  function renderQr() {
    const body = document.querySelector('#offQrBox');
    const hex = get('offSigned') || get('offUnsigned');
    if (!hex) { body.hidden = true; return log(t('off.needUnsigned'), 'err'); }
    body.hidden = false;
    if (!qrState.parts.length) {
      // 单张上限约 1200 字符（QR 版本 40 左右），超出分片
      qrState.parts = splitParts(hex, 1200);
      qrState.idx = 0;
    }
    const parts = qrState.parts;
    const svg = (() => { try { return makeQrSvg(parts[qrState.idx], 260); } catch (e) { return '<div class="qerr">' + t('qr.tooLong') + '</div>'; } })();
    const nav = parts.length > 1
      ? '<div class="row" style="margin-top:6px">' +
          '<button id="qrPrev" class="ghost">' + t('qr.prev') + '</button>' +
          '<span>' + t('qr.part', { i: qrState.idx + 1, n: parts.length }) + '</span>' +
          '<button id="qrNext" class="ghost">' + t('qr.next') + '</button>' +
        '</div>'
      : '';
    body.innerHTML = '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">' +
      '<div>' + svg + '</div>' +
      '<div style="max-width:320px"><b>' + t('qr.title') + '</b><p class="muted" style="font-size:12px">' + t('qr.hint') + '</p>' + nav + '</div>' +
      '</div>';
    if (parts.length > 1) {
      body.querySelector('#qrPrev').onclick = () => { qrState.idx = (qrState.idx - 1 + parts.length) % parts.length; renderQr(); };
      body.querySelector('#qrNext').onclick = () => { qrState.idx = (qrState.idx + 1) % parts.length; renderQr(); };
    }
  }
  card.querySelector('#offQr').onclick = () => {
    qrState.parts = []; qrState.idx = 0;   // 重新分片（内容可能已改）
    renderQr();
  };
  card.querySelector('#offBroadcast').onclick = async () => {
    readCfgFromUI();
    const s = get('offSigned'); if (!s) return log(t('off.needSigned'), 'err');
    const r = await window.api.broadcast({ node: S.cfg.node, hex: s });
    if (r.ok && r.data && r.data.ret === 0) { log(t('common.broadcastOk', { h: r.data.hash }), 'ok'); refreshOverview(); }
    else {
      const msg = (r && r.translated) ? r.translated : ((r.data && (r.data.err || r.data.error)) || '');
      log(t('common.broadcastFail') + msg + (r && r.hint ? '（' + r.hint + '）' : ''), 'err');
    }
  };
}

// ⚠ #3000 无管理员：renderAdminPanel 已整块删除（对应 6 个合约函数全部不存在）

// ===================== 构建 =====================
async function buildOp(op, card, btn) {
  readCfgFromUI();
  if (!S.addr) return log(t('log.ready'), 'err');
  const v = collectFields(card);
  const fee = v.__fee || null, gasMax = v.__gas || null;
  btn.disabled = true; btn.textContent = t('btn.gening');
  try {
    let res;
    if (op.kind === 'redeem') {
      const spec = op.redeemBuild(v);
      if (!spec.names.length) throw new Error(t('off.needArgs'));
      // v1.3.0 calc 内核上线后，PayableHACD 一次最多收 200 颗（打包成一笔交易）。
      // 超上限直接拒绝，不静默截断 —— 用户得知道哪些没进去。
      if (spec.names.length > MINT_MAX) {
        throw new Error(t('hacd.tooMany', { n: spec.names.length, max: MINT_MAX }));
      }
      log(t('r.fetchCerts',{n:spec.names.length}));
      res = await window.api.redeem({ names:spec.names, node:S.cfg.node,
        keyPath:S.keyPath, contract:S.cfg.contract, fee, gasMax, mainAddr:S.addr });
      if (res.ok) log(t('r.certTotal',{n:res.totalScore}), 'ok');
    } else if (op.kind === 'redeemHacd') {
      const spec = op.redeemBuild(v);
      const to = spec.to || S.addr;
      if (!spec.names.length) throw new Error(t('off.needArgs'));
      log(t('r.fetchCertsRedeem',{n:spec.names.length}));
      res = await window.api.redeemHacd({ names:spec.names, node:S.cfg.node,
        keyPath:S.keyPath, contract:S.cfg.contract, toAddr:to, fee, gasMax, mainAddr:S.addr });
    } else if (op.kind === 'hacdTransfer') {
      // HACD 点对点：主进程用官方 WASM 本地签名，返回 tx_body（hex）
      const nm = String(v.names || '').split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
      if (!nm.length) throw new Error(t('op.trHacd.needNames'));
      const to = String(v.to || '').trim();
      if (!to) throw new Error(t('op.trHacd.needAddr'));
      // 高级选项留空 → 主进程按节点费率自动估算；填了 → 按用户填的走
      const feeStr = (v.__fee && String(v.__fee).trim()) || '';
      log(t('op.trHacd.building', { n: nm.length, f: feeStr || t('op.trHacd.feeAuto') }));
      res = await window.api.hacdTransfer({ toAddr: to, names: nm, fee: feeStr, node: S.cfg.node });
    } else if (op.kind === 'call') {
      const params = buildCallParams(op, v);
      log(t('r.buildingCall',{fn:op.fn,ps:params}));
      res = await window.api.buildTx({ mode:'call', args:[S.addr,'0',S.cfg.contract,op.fn,params], keyPath:S.keyPath, fee, gasMax, node:S.cfg.node, contract:S.cfg.contract });
    } else {
      const spec = op.build(v, [S.addr]);
      log(t('r.building',{mode:spec.mode,args:spec.args.join(' ')}));
      res = await window.api.buildTx({ mode:spec.mode, args:spec.args, keyPath:S.keyPath, fee, gasMax, node:S.cfg.node, contract:S.cfg.contract });
    }
    if (!res.ok) throw res;   // res.error 交给 logErr
    S.pending = res; showPreview(res); log(t('common.signed',{n:res.signedBytes || res.txbytes}), 'ok');
  } catch (e) {
    logErr(t('common.buildFail'), e);
  } finally { btn.disabled = false; btn.textContent = t('btn.genTx'); }
}

async function buildCall(fn, params, card, btn, minPurity) {
  readCfgFromUI();
  if (!S.addr) return log(t('acct.locked'), 'err');
  const v = collectFields(card);
  const fee = v.__fee || null, gasMax = v.__gas || null;
  btn.disabled = true; btn.textContent = t('btn.gening');
  try {
    // C-4：remove_liquidity 单笔会撞主网 resource 上限（6,102 > 6,100）。
    // resource_limit_byte=56 是主网参数，独立于 gas_max，调高 gas 也绕不过。
    // 合约不可升级，所以在钱包侧拆成两笔：先 lp_harvest 结算奖励，再撤池。
    // 顺序不能反：先撤池会按减少后的 lpt 结算，用户少拿奖励。
    if (fn === 'remove_liquidity') {
      const h = await window.api.buildTx({
        mode:'call', args:[S.addr,'0',S.cfg.contract,'lp_harvest','-'],
        keyPath:S.keyPath, fee, gasMax, node:S.cfg.node, contract:S.cfg.contract
      });
      if (!h.ok) throw h;
      S.pending = h; showPreview(h);
      log(t('amm.splitHarvest'), 'warn');
      log(t('common.signed',{n:h.signedBytes || h.txbytes}), 'ok');
      // 记住撤池参数，等第一笔广播后再生成第二笔
      S._pendingRemove = { params, card };
      return;
    }
    const res = await window.api.buildTx({ mode:'call', args:[S.addr,'0',S.cfg.contract,fn,params], keyPath:S.keyPath, fee, gasMax, node:S.cfg.node, contract:S.cfg.contract });
    if (!res.ok) throw res;
    S.pending = res; showPreview(res); log(t('common.signed',{n:res.signedBytes || res.txbytes}), 'ok');
  } catch (e) { logErr(t('common.buildFail'), e); }
  finally { btn.disabled = false; btn.textContent = t('btn.genTx'); }
}

// C-4 第二步：lp_harvest 广播成功后，自动生成 remove_liquidity 交易体。
async function buildRemoveAfterHarvest() {
  const p = S._pendingRemove;
  if (!p) return;
  S._pendingRemove = null;
  readCfgFromUI();
  try {
    const res = await window.api.buildTx({
      mode:'call', args:[S.addr,'0',S.cfg.contract,'remove_liquidity',p.params],
      keyPath:S.keyPath, node:S.cfg.node, contract:S.cfg.contract
    });
    if (!res.ok) throw res;
    S.pending = res; showPreview(res);
    log(t('amm.splitRemove'), 'ok');
    log(t('common.signed',{n:res.signedBytes || res.txbytes}), 'ok');
  } catch (e) {
    // 第 1 步（lp_harvest）已成功上链，只是第 2 步构建失败——没有资金损失。
    log(t('amm.splitStep2Fail'), 'warn');
    logErr(t('common.buildFail'), e);
  }
}

// ===================== 预览 / 校验 / 广播 =====================
function showPreview(res) {
  $('#preview').hidden = false;
  $('#pvLabel').textContent = res.label || 'tx';
  $('#pvBytes').textContent = res.txbytes || '—';
  $('#pvFee').textContent = (res.feeUsed || '—') + (res.feeAuto ? t('common.auto') : '');
  $('#pvDigest').textContent = res.digest || '—';
  $('#pvSelf').textContent = res.selfcheck || '';
  $('#pvSelf').className = res.selfcheck ? 'ok' : '';
  $('#pvHex').value = '0x' + (res.signed || res.unsigned || '');
  $('#pvTrans').hidden = true;
  const note = $('#pvFeeNote');
  if (res.feeAuto && res.rounds && res.rounds.length) {
    const changed = res.rounds.length > 1 || (res.rounds[0] && res.rounds[0].fee !== res.feeUsed);
    note.innerHTML = t('pv.feeNote',{mp:res.minPurity,sz:(res.sizeUsed||res.txbytes),fee:res.feeUsed})
      + (changed ? ' <span class="up">' + t('pv.feeRaised', { n: res.rounds.length }) + '</span>' : '');
    note.hidden = false;
  } else note.hidden = true;
}
$('#pvClose').onclick = () => { $('#preview').hidden = true; S.pending = null; };
$('#pvCopy').onclick = async () => { await navigator.clipboard.writeText($('#pvHex').value); log(t('common.copied'), 'ok'); };
$('#pvSave').onclick = () => {
  const blob = new Blob([$('#pvHex').value + '\n'], { type:'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'hacds_tx_' + Date.now() + '.hex'; a.click(); URL.revokeObjectURL(a.href);
  log(t('common.saved'), 'ok');
};
$('#pvCheck').onclick = async () => {
  if (!S.pending) return; readCfgFromUI();
  const hex = ($('#pvHex').value || '').replace(/^0x/, '');
  const r = await window.api.checkTx({ node:S.cfg.node, hex });
  if (r.ok) log(t('common.checkRet',{r:(r.data||{}).ret}), (r.data||{}).ret===0?'ok':'warn');
  else logErr(t('common.checkFail'), r);
};
$('#pvTranslate').onclick = async () => {
  if (!S.pending) return; readCfgFromUI();
  const hex = ($('#pvHex').value || '').replace(/^0x/, '');
  const r = await window.api.translateTx({ node:S.cfg.node, hex });
  const box = $('#pvTrans'); box.hidden = false;
  if (!r.ok) { box.innerHTML = `<span class="qerr">${esc(r.error)}</span>`; return; }
  const d = r.data || {};
  box.innerHTML = `<b>${t('common.translTitle')}</b>: ${esc(d.description || t('common.none2'))}\n` +
    (d.actions || []).map((a,i) => `  [${i+1}] ${esc(a.description || JSON.stringify(a.action))}`).join('\n');
  log(t('common.translated'), 'ok');
};
$('#pvSend').onclick = async () => {
  if (!S.pending) return; readCfgFromUI();
  const hex = ($('#pvHex').value || '').replace(/^0x/, '');
  $('#pvSend').disabled = true; log(t('btn.broadcast'));
  const r = await window.api.broadcast({ node:S.cfg.node, hex });
  $('#pvSend').disabled = false;
  if (r.ok && r.data && r.data.ret === 0) {
    log(t('common.broadcastOk',{h:r.data.hash}), 'ok');
    refreshOverview();               // 立即刷新：合约内账目（due/积分）本笔已生效的会立刻反映
    schedulePostBroadcastRefresh();  // 链上余额需等打包，按出块节奏延迟再刷
    // C-4 第二步：lp_harvest 已上链，接着生成 remove_liquidity 的交易体
    if (S._pendingRemove) setTimeout(buildRemoveAfterHarvest, 400);
  }
  else if (r && r.chain) {
    // 已在链上 / 已在待打包池：交易并非失败，链上状态已由它决定
    log(t('common.broadcastChain', { h: r.height || '?' }), 'warn');
    refreshOverview();
    schedulePostBroadcastRefresh();
    if (S._pendingRemove) setTimeout(buildRemoveAfterHarvest, 400);
  }
  else {
    const msg = (r && r.translated) ? r.translated : ((r.data && (r.data.err || r.data.error)) || '');
    log(t('common.broadcastFail') + msg + (r && r.hint ? '（' + r.hint + '）' : ''), 'err');
  }
};

// 广播之后的延迟刷新。
// Hacash 出块目标 300s（hacash-params: each_block_target_time = 300），交易进入
// mempool 后要等下一个块才落到链上状态；这段时间刷新只能看到旧余额，看起来像
// 「广播成功但资产没变」。这里按出块节奏补几次刷新，并在日志里说明原因。
let _postRefreshTimers = [];
function schedulePostBroadcastRefresh() {
  _postRefreshTimers.forEach(clearTimeout); _postRefreshTimers = [];
  const steps = [15, 45, 90, 180, 320];   // 秒；最后一次跨过一个完整出块周期
  log(t('r.broadcastPending'));
  steps.forEach((s, i) => {
    _postRefreshTimers.push(setTimeout(async () => {
      if (!S.addr) return;
      await refreshOverview();
      if (i === steps.length - 1) log(t('r.broadcastSettled'), 'ok');
    }, s * 1000));
  });
}

// ===================== 顶部动作 =====================
$('#saveNet').onclick = async () => {
  readCfgFromUI();
  // 主进程会校验端点格式（审计 C-H4），失败要告诉用户，不能假装成功
  const r = await window.api.saveCfg(S.cfg);
  if (r && r.ok === false) log(t('net.saveFail') + '：' + (r.error || ''), 'err');
  else log(t('net.saved'), 'ok');
};
$('#pingNet').onclick = async () => {
  readCfgFromUI();
  const h = await window.api.httpGet({ url: `${S.cfg.node}/query/block/height/latest` });
  log(h.ok ? t('net.nodeOk',{h:h.data.height}) : t('net.nodeFail')+h.error, h.ok?'ok':'err');
  if (S.cfg.indexer) {
    const ix = await window.api.httpGet({ url: `${S.cfg.indexer}/health` });
    log(ix.ok ? t('net.idxOk',{h:ix.data.head}) : t('net.idxFail')+ix.error, ix.ok?'ok':'err');
  }
};
$('#clearLog').onclick = () => { $('#log').innerHTML = ''; };
$('#btnRefresh').onclick = () => refreshOverview();

// ===================== 钱包 UI =====================
async function setAccount(addr, unlocked) {
  // 切换地址时清空上一个地址的 HACD 缓存/选中（避免残留显示）
  if (addr !== S.addr) {
    S.hacdList = null; S.poolHacdList = null; S.poolHacdCount = 0;
    S.hacdSel = null; S.overview = null;
    S.hacdChecked = []; S.hacdAnchor = null;
    if (typeof renderHacdPanel === 'function') { /* 面板在切页时重建 */ }
  }
  S.addr = addr; S.unlocked = !!unlocked;
  $('#lockedView').hidden = !!unlocked;
  $('#unlockedView').hidden = !unlocked;
  $('#overview').hidden = !unlocked;
  if (addr) $('#addr').textContent = addr;
  if (!unlocked) { $('#overview').hidden = true; renderTabs(); return; }
  // #3000 无管理员：不再做 adminProbe 探测
  readCfgFromUI();
  renderTabs();
  await refreshOverview();
  renderPanels();
}

function modal({ title, fields, okLabel, warn, extraHtml, onMount }) {
  return new Promise((resolve) => {
    $('#mTitle').textContent = title;
    const body = $('#mBody'); body.innerHTML = '';
    const grid = document.createElement('div'); grid.className = 'grid';
    (fields || []).forEach(f => {
      const w = document.createElement('div'); w.className = 'field';
      const l = document.createElement('label'); l.textContent = f.label;
      const i = document.createElement('input');
      i.dataset.mname = f.name;
      i.type = f.type === 'password' ? 'password' : 'text';
      i.value = f.default || ''; if (f.readonly) i.readOnly = true;
      w.appendChild(l); w.appendChild(i); grid.appendChild(w);
    });
    body.appendChild(grid);
    if (warn) { const d = document.createElement('div'); d.className='warnbox'; d.textContent = warn; body.appendChild(d); }
    if (extraHtml) { const d = document.createElement('div'); d.innerHTML = extraHtml; body.appendChild(d); }
    $('#modal').hidden = false;
    // onMount：元素已进 DOM 后回调，供调用方绑定额外的交互
    //（私钥打码/显示就是靠它，见 walletExportKey）
    if (typeof onMount === 'function') { try { onMount(); } catch (e) { console.warn(e); } }
    const close = (val) => { $('#modal').hidden = true; resolve(val); };
    $('#mOk').textContent = okLabel || t('btn.ok2');
    $('#mOk').onclick = () => {
      const v = {}; body.querySelectorAll('input[data-mname]').forEach(i => v[i.dataset.mname] = i.value); close(v);
    };
    $('#mCancel').onclick = () => close(null);
  });
}

$('#btnCreate').onclick = async () => {
  const kind = confirm(t('w.kindConfirm'));
  if (kind) {
    const v = await modal({ title:t('w.createRandTitle'), okLabel:t('w.createBtn'),
      fields:[{name:'password',label:t('w.createRandLabel'),type:'password'}] });
    if (!v) return;
    const r = await window.api.walletCreate({ kind:'random', password:v.password });
    if (!r.ok) return logErr(t('w.createFail'), r);
    log(t('w.created')+r.address, 'ok'); log(t('w.keystore')+r.file);
    setAccount(r.address, true);
  } else {
    const v = await modal({ title:t('w.createPwTitle'), okLabel:t('w.createBtn'),
      fields:[{name:'label',label:t('w.pwLabel2')},{name:'password',label:t('w.pwEncrypt'),type:'password'}],
      warn:t('w.createWarnPw') });
    if (!v) return;
    const r = await window.api.walletCreate({ kind:'password', password:v.password, label:v.label });
    if (!r.ok) return logErr(t('w.createFail'), r);
    log(t('w.createdPw')+r.address, 'ok'); setAccount(r.address, true);
  }
};
$('#btnImport').onclick = async () => {
  const v = await modal({ title:t('w.import'), okLabel:t('w.importBtn'),
    fields:[{name:'content',label:t('w.importPaste')},{name:'password',label:t('w.importPwLabel'),type:'password'}],
    warn:t('w.importWarn') });
  if (!v) return;
  const r = await window.api.walletImport({ content:v.content, password:v.password });
  if (!r.ok) return logErr(t('w.importFail'), r);
  log(t('w.imported')+r.address, 'ok'); if (r.file) log(t('w.importSaved')+r.file);
  setAccount(r.address, true);
};
$('#btnOpen').onclick = async () => {
  const f = await window.api.walletPickFile(); if (!f) return;
  const v = await modal({ title:t('w.openTitle'), okLabel:t('w.btnUnlock2'), fields:[{name:'password',label:t('w.beforeLockShort'),type:'password'}], extraHtml:`<p class="muted" style="margin-top:8px">${f}</p>` });
  if (!v) return;
  const r = await window.api.walletOpen({ filePath:f, password:v.password });
  if (!r.ok) return logErr(t('w.unlockFail'), r);
  log(t('w.unlockedLog')+r.address, 'ok'); setAccount(r.address, true);
};
$('#pickKey').onclick = async () => {
  const p = await window.api.pickKey(); if (!p) return;
  try { S.keyPath = p; S.addr = await window.api.keyAddr(p); log(t('w.extKey')+S.addr, 'ok'); setAccount(S.addr, true); }
  catch (e) { log(t('w.extKeyFail')+e, 'err'); }
};
$('#btnLock').onclick = async () => {
  await window.api.walletLock(); S.keyPath = null;
  log(t('w.lock')); setAccount(null, false);
};
$('#btnExportKey').onclick = async () => {
  if (!S.addr) return;
  const ok = confirm(t('w.exportConfirm'));
  if (!ok) return;
  const r = await window.api.walletExportKey();
  if (!r.ok) return logErr(t('w.exportFail'), r);
  // ⚠ 私钥确实要进渲染层 —— 导出功能本身就是"把它显示给用户"，
  //   这一点无法消除。能做的是**收窄暴露面**（2026-11-12 审计 C-M4）：
  //     ① 默认打码，必须点一下才显示（防旁观/录屏）；
  //     ② 弹窗关闭即销毁，不留在 DOM 里；
  //     ③ 不写进日志、不进剪贴板自动化（复制由用户主动点）。
  //   原来直接把 0x… 明文塞进 innerHTML，弹窗关掉后仍留在 DOM 树中。
  const masked = '•'.repeat(64);
  await modal({ title:t('w.exportTitle'), okLabel:t('w.beforeLock'),
    fields:[{name:'__addr',label:t('w.addrField'),default:r.address,readonly:true}],
    warn:t('w.exportWarn'),
    extraHtml:`<div class="secret" id="keySecret" data-shown="0">${masked}</div>
      <button class="ghost" id="keyReveal" style="margin-top:8px">${t('w.revealKey')}</button>`,
    onMount:() => {
      const el = document.getElementById('keySecret');
      const btn = document.getElementById('keyReveal');
      if (!el || !btn) return;
      btn.onclick = () => {
        const shown = el.dataset.shown === '1';
        el.textContent = shown ? masked : '0x' + r.keyHex;
        el.dataset.shown = shown ? '0' : '1';
        btn.textContent = shown ? t('w.revealKey') : t('w.hideKey');
        if (shown) r.keyHex = '';        // 重新打码时清掉内存里的副本
      };
      // 弹窗销毁时确保 DOM 里不留明文
      const obs = new MutationObserver(() => {
        if (!document.body.contains(el)) { el.textContent = ''; r.keyHex = ''; obs.disconnect(); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } });
};
// 点击顶部钱包地址 → 直接弹出可切换地址列表（热切换，无需先进「钱包管理」）
// 复用 #mBody 的 data-act="open" 委托：选中即输密码解锁目标地址。
$('#addr').onclick = async () => {
  if (!S.addr) return;
  const r = await window.api.walletList();
  if (!r.ok) return logErr(t('w.listFail'), r);
  if (!r.files || !r.files.length) { log(t('w.none'), 'warn'); return; }
  const rows = r.files.map(f => {
    const cur = (f.address === S.addr);
    return '<tr>' +
      '<td class="mono">' + (f.address || '?') +
        (cur ? ' <span class="admin-badge">' + t('w.current') + '</span>' : '') + '</td>' +
      '<td>' + (f.label ? f.label : '<span class="muted">—</span>') + '</td>' +
      '<td>' + (cur
        ? '<span class="muted">' + t('w.isCurrent') + '</span>'
        : '<button data-path="' + f.path + '" data-act="open">' + t('w.switch') + '</button>') +
      '</td></tr>';
  }).join('');
  const html = '<table class="wtable"><tr><th>' + t('common.address') + '</th><th>' + t('w.label') +
    '</th><th>' + t('liq.actions') + '</th></tr>' + rows + '</table>';
  await modal({ title: t('w.pickTitle'), okLabel: t('btn.close'), fields: [], extraHtml: html });
};

$('#btnWalletMgr').onclick = async () => {
  const r = await window.api.walletList();
  if (!r.ok) return logErr(t('w.listFail'), r);
  const rows = r.files.map(f => {
    const cur = (f.address === S.addr);
    return '<tr>' +
      '<td class="mono">' + (f.address || '?') + (cur ? ' <span class="admin-badge">' + t('w.current') + '</span>' : '') + '</td>' +
      '<td>' + (f.label ? f.label : '<span class="muted">—</span>') + '</td>' +
      '<td><button data-path="' + f.path + '" data-act="open">' + (cur ? t('w.relock') : t('w.switch')) + '</button>' +
          '<button data-path="' + f.path + '" data-act="rename">' + t('w.rename') + '</button>' +
          '<button data-path="' + f.path + '" data-act="delete" class="danger">' + t('w.delete') + '</button></td></tr>';
  }).join('');
  const html = r.files.length
    ? '<table class="wtable"><tr><th>' + t('common.address') + '</th><th>' + t('w.label') + '</th><th>' + t('w.actions') + '</th></tr>' + rows + '</table>'
    : '<p class="muted">' + t('w.none') + '</p>';
  await modal({ title: t('acct.mgr'), okLabel: t('btn.close'), fields: [], extraHtml: html });
};

// 钱包管理表内按钮（用事件委托）
$('#mBody').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-act]'); if (!b) return;
  const p = b.dataset.path, act = b.dataset.act;
  if (act === 'open') {
    // 热切换：直接输密码解锁另一地址，无需先锁定
    const v = await modal({ title: t('w.unlockTitle'), okLabel: t('btn.ok'),
      fields: [{ name:'password', label: t('w.password'), type:'password' }],
      extraHtml: '<p class="muted" style="margin-top:8px">' + p + '</p>' });
    if (!v) return;
    const r = await window.api.walletOpen({ filePath: p, password: v.password });
    if (!r.ok) return logErr(t('w.unlockFail'), r);
    log(t('w.unlocked', { a: r.address }), 'ok');
    await setAccount(r.address, true);     // setAccount 内已清空旧地址的 HACD 缓存
    $('#modal').hidden = true;
    $('#btnWalletMgr').click();            // 刷新列表（显示当前地址）
  } else if (act === 'rename') {
    const v = await modal({ title: t('w.renameTitle'), okLabel: t('btn.save'), fields: [{ name:'label', label: t('w.label') }] });
    if (!v) return;
    const r = await window.api.walletRename({ filePath: p, label: v.label });
    if (!r.ok) return logErr(t('w.renameFail'), r);
    log(t('w.renamed'), 'ok'); $('#modal').hidden = true; $('#btnWalletMgr').click();
  } else if (act === 'delete') {
    if (!confirm(t('w.deleteConfirm'))) return;
    const r = await window.api.walletDelete({ filePath: p });
    if (!r.ok) return logErr(t('w.deleteFail'), r);
    log(t('w.deleted'), 'ok'); $('#modal').hidden = true; $('#btnWalletMgr').click();
  }
});

// ===================== HACD 收藏 =====================
function renderHacdPanel() {
  const myGrid = $('#hacdGrid'), poolGrid = $('#poolHacdGrid'), filter = $('#hacdFilter');

  // ================= 左：我的钻石 =================
  const mine = S.hacdList;   // null = 未加载
  if (!mine) {
    if (filter) filter.innerHTML = '';
    myGrid.innerHTML = '<div class="muted" style="font-size:12px">' + t('hacd.notLoaded') + '</div>';
  } else if (!mine.length) {
    if (filter) filter.innerHTML = '';
    myGrid.innerHTML = '<div class="muted" style="font-size:12px">' + t('hacd.none') + '</div>';
  } else {
    const items = mine.map(x => {
      const r = DiamondScore.analyse(x.name, x.number, x.visual_gene);
      return { ...x, score: r.score, dims: r };
    });

    // 筛选栏（只作用于左侧「我的钻石」）
    if (filter) {
      const fShape = window._hf_shape || '', fStyle = window._hf_style || '', fMin = window._hf_min || '';
      const sortBy = window._hf_sort || 'scoreDesc';
      const shapes = [...new Set(items.map(i => i.dims.shapes))].sort();
      const styles = [...new Set(items.map(i => i.dims.styles_or_color))].sort();
      const opt = (arr, sel) => '<option value="">' + t('hacd.all') + '</option>' +
        arr.map(v => '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + v + '</option>').join('');
      const sopt = (v, lk) => '<option value="' + v + '"' + (sortBy === v ? ' selected' : '') + '>' + t(lk) + '</option>';

      filter.innerHTML =
        t('hacd.filterShape') + ' <select id="hfShape">' + opt(shapes, fShape) + '</select>' +
        ' ' + t('hacd.filterStyle') + ' <select id="hfStyle">' + opt(styles, fStyle) + '</select>' +
        ' ' + t('hacd.filterMin') + ' <input id="hfMin" style="width:56px" value="' + fMin + '" placeholder="0">' +
        ' <select id="hfSort">' +
          sopt('scoreDesc', 'hacd.sortScore') + sopt('scoreAsc', 'hacd.sortScoreAsc') +
          sopt('numAsc', 'hacd.sortNum') + sopt('numDesc', 'hacd.sortNumDesc') + sopt('name', 'hacd.sortName') +
        '</select>' +
        ' <button id="hfClear" class="ghost">' + t('btn.clear') + '</button>';
      filter.querySelector('#hfShape').onchange = e => { window._hf_shape = e.target.value; renderHacdPanel(); };
      filter.querySelector('#hfStyle').onchange = e => { window._hf_style = e.target.value; renderHacdPanel(); };
      filter.querySelector('#hfMin').onchange = e => { window._hf_min = e.target.value; renderHacdPanel(); };
      filter.querySelector('#hfSort').onchange = e => { window._hf_sort = e.target.value; renderHacdPanel(); };
      filter.querySelector('#hfClear').onclick = () => {
        window._hf_shape = window._hf_style = window._hf_min = '';
        window._hf_sort = 'scoreDesc';
        renderHacdPanel();
      };
    }

    // 过滤 + 排序
    let shown = items.filter(i =>
      (!window._hf_shape || i.dims.shapes === window._hf_shape) &&
      (!window._hf_style || i.dims.styles_or_color === window._hf_style) &&
      (!window._hf_min || i.score >= Number(window._hf_min)));
    const cmp = {
      scoreDesc: (a, b) => b.score - a.score,
      scoreAsc:  (a, b) => a.score - b.score,
      numAsc:    (a, b) => Number(a.number) - Number(b.number),
      numDesc:   (a, b) => Number(b.number) - Number(a.number),
      name:      (a, b) => a.name.localeCompare(b.name),
    }[window._hf_sort || 'scoreDesc'];
    shown.sort(cmp);

    myGrid.innerHTML = shown.map(i => cardHtml(i, S.hacdChecked.includes(i.name))).join('');
    if (!shown.length) myGrid.innerHTML = '<div class="muted" style="font-size:12px">' + t('hacd.none') + '</div>';

    myGrid.querySelectorAll('.hacd-card').forEach(el => {
      el.onclick = ev => {
        const n = el.dataset.name;
        const item = items.find(x => x.name === n);
        // 点右上角圆点 = 只切换勾选
        if (ev.target.closest('[data-check]')) {
          const k = S.hacdChecked.indexOf(n);
          if (k >= 0) S.hacdChecked.splice(k, 1); else S.hacdChecked.push(n);
          renderHacdPanel();
          return;
        }
        // 点其它区域 = 只看详情，不改勾选
        if (item) showHacdModal(item);
      };
    });
  }

  // ================= 右：合约池 =================
  const pool = S.poolHacdList;   // null = 未加载
  if (!pool) {
    poolGrid.innerHTML = '<div class="muted" style="font-size:12px">' + t('hacd.poolEmpty') + '</div>';
  } else if (!pool.length) {
    poolGrid.innerHTML = '<div class="muted" style="font-size:12px">' + t('hacd.poolEmpty') + '</div>';
  } else {
    const pitems = pool.map(x => {
      const r = DiamondScore.analyse(x.name, x.number, x.visual_gene);
      return { ...x, score: r.score, dims: r };
    }).sort((a, b) => b.score - a.score);

    poolGrid.innerHTML = pitems.map(i => cardHtml(i, false, false)).join('');
    poolGrid.querySelectorAll('.hacd-card').forEach(el => {
      el.onclick = () => {
        const n = el.dataset.name;
        const inp = $('#redeemName');
        if (inp) inp.value = n;
        const item = pitems.find(x => x.name === n);
        if (item) showHacdModal(item);
      };
    });
  }

  // 同步「已选 N 颗」与预估
  const cnt = S.hacdChecked.length;
  const cntEl = $('#mintCount');
  if (cntEl) cntEl.textContent = String(cnt);
  const tagEl = $('#mintSelCount');
  if (tagEl) tagEl.textContent = cnt ? t('hacd.selCount2', { n: cnt }) : t('hacd.selNone2b');
  const bulk = $('#hacdDepositBulk');
  if (bulk) bulk.textContent = cnt ? t('hacd.depositBulk', { n: cnt }) : t('hacd.batchIn');
  const outBtn = $('#hacdBatchOut');
  if (outBtn) outBtn.textContent = t('hacd.batchOut');
  const est = $('#mintTotalEst');
  if (est) {
    if (!cnt) est.textContent = '—';
    else {
      const sel = (S.hacdList || []).filter(x => S.hacdChecked.includes(x.name));
      const total = sel.reduce((s, x) => s + (DiamondScore.analyse(x.name, x.number, x.visual_gene).score || 0), 0);
      est.textContent = total * 1e8 >= 1e15 ? (total / 1e7).toFixed(2) + 'e15' : String(total) + 'e8';
    }
  }

  // ---- 事件绑定（每次重渲染都重新绑，元素是新建的）----
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };

  on('#hacdLoadMine', () => loadHacdDetails());
  on('#hacdLoadPool', () => loadPoolHacd());

  on('#hacdSelAll', () => {
    S.hacdChecked = (S.hacdList || []).map(x => x.name);
    renderHacdPanel();
  });
  on('#hacdSelNone', () => {
    S.hacdChecked = [];
    renderHacdPanel();
  });

  // 批量存入（左卡）
  on('#hacdDepositBulk', () => {
    if (!S.hacdChecked.length) { log(t('hacd.needPick'), 'warn'); return; }
    runBatchHacd('in', S.hacdChecked.slice());
  });

  // 批量赎回（右卡）：优先用输入框里的名字，没有则用勾选的
  on('#hacdBatchOut', () => {
    const inp = ($('#redeemName') && $('#redeemName').value || '').trim().toUpperCase();
    const names = /^[WTYUIAHXVMEKBSZN]{6}$/.test(inp) ? [inp] : S.hacdChecked.slice();
    if (!names.length) { log(t('hacd.needPick'), 'warn'); return; }
    runBatchHacd('out', names);
  });
}

/** 一张钻石卡片（双卡布局共用） */
/**
 * 一张钻石卡片。
 *
 * 点击区域分两种（方案 B）：
 *   · 右上角圆点 .hc-check —— 只切换勾选，不弹窗
 *   · 卡片其它区域         —— 只弹详情，不改勾选
 *
 * 原来整张卡点击会同时做两件事，批量勾选时被弹窗打断，只看详情时又
 * 顺手改了勾选状态。
 *
 * @param {boolean} pickable  是否能勾选（合约池的钻石不可勾选）
 */
function cardHtml(i, picked, pickable) {
  let svg = '';
  try { svg = window.CreateDiamondImageTagSVG(i.visual_gene, 84); } catch (e) { svg = ''; }
  const check = pickable === false
    ? ''
    : '<div class="hc-check' + (picked ? ' on' : '') + '" data-check="1" title="' + t('hacd.selectHint') + '"></div>';
  return '<div class="hacd-card' + (picked ? ' picked' : '') + '" data-name="' + i.name + '">' +
    check + svg +
    '<div class="hc-name">' + i.name + '</div>' +
    '<div class="hc-score">' + i.score + ' ' + t('hacd.scoreUnit') + '</div></div>';
}

/** 详情弹窗（替代原右侧常驻面板） */
function showHacdModal(i) {
  const modal = $('#hacdModal'), body = $('#hacdModalBody');
  if (!modal || !body) return;
  let svg = '';
  try { svg = window.CreateDiamondImageTagSVG(i.visual_gene, 240); } catch (e) {}
  // 「标签：值」连写，不用 space-between —— 后者会把两者推到两端，
  // 中间一条长空白，读起来像两段无关的文字（用户反馈过）。
  //
  // ⚠ k / v 都可能是外部数据（钻石名、所属地址、铭文内容），必须转义
  //   （2026-11-12 审计 C-H3）。extra 是内部拼的 class 属性，不走 esc。
  const row = (k, v, extra) => v == null || v === ''
    ? ''
    : `<div class="det-row"><span class="k">${esc(k)}</span><span class="v"${extra || ''}>${esc(v)}</span></div>`;
  body.innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">' +
      '<div style="flex:0 0 240px">' + svg + '</div>' +
      '<div class="det" style="flex:1;min-width:180px;font-size:12.5px">' +
        row(t('hacd.name'), i.name) +
        row(t('hacd.number'), i.number) +
        row(t('hacd.score'), i.score, ' style="color:var(--gold);font-weight:600"') +
        row(t('hacd.shape'), i.dims && i.dims.shapes) +
        row(t('hacd.style'), i.dims && i.dims.styles_or_color) +
        row(t('hacd.namelit'), i.dims && i.dims.nameliteral) +
        row(t('hacd.numlit'), i.dims && i.dims.numberliteral) +
        row(t('hacd.vg'), i.visual_gene) +
        row(t('hacd.owner'), i.belong) +
        (i.inscriptions && i.inscriptions.length ? row(t('hacd.insc'), i.inscriptions.join(', ')) : '') +
      '</div>' +
    '</div>';
  modal.hidden = false;
  const close = $('#hacdModalClose');
  if (close) close.onclick = () => { modal.hidden = true; };
  modal.onclick = ev => { if (ev.target === modal) modal.hidden = true; };
}


// showHacdDetail 已被 showHacdModal 取代（详情改为弹窗）

// ===================== 批量转入 / 批量赎回（D43） =====================
//
// v1.3.0（2026-11-11）之后两端行为不再对称：
//   • 存入：合约 PayableHACD 走 rv64im 内核 score_sum，一次最多 200 颗
//           → **打包成一笔交易，只签一次**。
//   • 赎回：仍是 1 颗/笔（要逐颗算挑钻溢价，内核只返回总和，拆不出单颗）
//           → 仍拆成 N 笔逐笔广播。
async function runBatchHacd(kind, names) {
  if (!names || !names.length) { log(t('hacd.needPick'), 'warn'); return; }
  readCfgFromUI();
  if (!S.addr) { log(t('acct.locked'), 'err'); return; }

  // 存入超上限直接拒绝，不静默截断
  if (kind === 'in' && names.length > MINT_MAX) {
    log(t('hacd.tooMany', { n: names.length, max: MINT_MAX }), 'warn');
    return;
  }

  const opLabel = t(kind === 'in' ? 'hacd.batchOpIn' : 'hacd.batchOpOut');

  // ★ 防呆 1：方向横幅。批量存入/赎回的按钮相邻，实测出现过「刚赎回完又误点存入、
  //   同一颗钻石 42 秒内先出后进」的情况，故在确认框顶部用醒目色标出资金方向。
  const dirText = t(kind === 'in' ? 'hacd.dirIn' : 'hacd.dirOut', { n: names.length });
  const dirHtml = '<div class="dirbanner ' + (kind === 'in' ? 'dir-in' : 'dir-out') + '">' + dirText + '</div>';

  // 二次确认：明确告知方向；存入告知打包成一笔，赎回告知拆成 N 笔
  const okGo = await modal({
    title: t('hacd.batchTitle', { op: opLabel, n: names.length }),
    fields: [], okLabel: t('btn.ok'),
    warn: kind === 'in'
      ? t('hacd.batchPlanOne', { n: names.length })
      : t('hacd.batchPlan', { n: names.length }),
    extraHtml: dirHtml + '<div class="muted" style="margin-top:6px;font-family:Consolas,monospace">' + names.join(',') + '</div>',
  });
  if (!okGo) return;

  log(t('hacd.batchStart', { op: opLabel, n: names.length }), 'ok');

  // ---- 存入：一次打包（主进程 hacd 模式接受名字列表，一次构造 + 一次广播） ----
  // ⚠ 必须用 redeemBatch 而不是 redeem：tx:redeem 只构造不广播。
  if (kind === 'in') {
    const r1 = await window.api.redeemBatch({
      names, kind, toAddr: undefined,
      node: S.cfg.node, contract: S.cfg.contract, mainAddr: S.addr,
    });
    if (!r1.ok) { logErr(t('hacd.batchIn'), r1); return; }
    const it = (r1.items || [])[0];
    if (it && it.ok) log(t('hacd.batchOneOk', { n: names.length }), 'ok');
    else logErr(t('hacd.batchIn'), it || r1);
    S.hacdChecked = [];
    refreshOverview();
    startBatchCooldown('out');
    if (S.tab === 'hacd') renderHacdPanel();
    return;
  }

  // ---- 赎回：仍逐颗（合约限制） ----
  const toAddr = S.addr;
  const r = await window.api.redeemBatch({
    names, kind, toAddr,
    node: S.cfg.node, contract: S.cfg.contract, mainAddr: S.addr,
  });
  if (!r.ok) { logErr(t('hacd.batchIn'), r); return; }

  (r.items || []).forEach((it, i) => {
    const n = r.total;
    if (it.alreadyOnChain) {
      // 该交易此前已上链（hash 已存在于链上）：资产状态已生效，不算失败
      log(t('hacd.batchItemChain', { i: i + 1, n, name: it.name, h: it.height || '?' }), 'warn');
    } else if (it.ok) {
      log(t('hacd.batchItemOk', { i: i + 1, n, name: it.name, hash: (it.hash || '').slice(0, 16) + '…' }), 'ok');
    } else log(t('hacd.batchItemFail', { i: i + 1, n, name: it.name, err: it.translated || it.error }), 'err');
  });
  if (r.failed === 0) {
    log(t('hacd.batchAllOk', { op: opLabel, n: r.total }) + (r.onChain ? t('hacd.batchOnChainNote', { n: r.onChain }) : ''), 'ok');
  } else log(t('hacd.batchDone', { op: opLabel, ok: r.succeeded, fail: r.failed, n: r.total }), r.succeeded ? 'warn' : 'err');
  // 全部成功则清空勾选，避免误重复提交
  if (r.failed === 0) { S.hacdChecked = []; }
  refreshOverview();
  // ★ 防呆 2：给「反方向」按钮加短冷却，防止刚赎回完又误点存入
  startBatchCooldown(kind === 'in' ? 'out' : 'in');
  if (S.tab === 'hacd') renderHacdPanel();
}

// 批量操作后的反向冷却（秒）。期间反向按钮禁用并倒数，避免连点造成
// 「刚赎回又存回」这类反向误操作。
let _batchCooldown = { until: 0, kind: null, timer: null };
function startBatchCooldown(kind, secs = 30) {
  _batchCooldown = { until: Date.now() + secs * 1000, kind, timer: null };
  log(t('hacd.cool', { op: t(kind === 'in' ? 'hacd.batchOpIn' : 'hacd.batchOpOut'), s: secs }), 'warn');
  const tick = () => {
    const left = Math.ceil((_batchCooldown.until - Date.now()) / 1000);
    if (left <= 0) { _batchCooldown = { until: 0, kind: null, timer: null }; renderHacdPanel(); return; }
    if (S.tab === 'hacd') renderHacdPanel();
    _batchCooldown.timer = setTimeout(tick, 1000);
  };
  _batchCooldown.timer = setTimeout(tick, 1000);
}
function cooldownLeft(kind) {
  if (_batchCooldown.kind !== kind) return 0;
  const left = Math.ceil((_batchCooldown.until - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

// 把钻石名列表填入「存入兑换 hacds」操作卡的 names 输入框，并切到该页
function fillDepositNames(names) {
  const csv = names.join(',');
  window._opPrefill = Object.assign({}, window._opPrefill, { redeem: { names: csv } });
  S.tab = 'trade'; renderTabs(); renderPanels();
  applyOpPrefill();
  log(t('hacd.fillBulk', { n: names.length }) + csv, 'ok');
}
// 填入「赎回 HACD」操作卡的 names 输入框
function fillRedeemNames(names) {
  const csv = names.join(',');
  window._opPrefill = Object.assign({}, window._opPrefill, { redeemHacd: { names: csv } });
  S.tab = 'trade'; renderTabs(); renderPanels();
  applyOpPrefill();
  log(t('hacd.fillBulk', { n: names.length }) + csv, 'ok');
}
// 渲染操作页后把暂存的预填值写进对应输入框（渲染即清空，故每帧重放）
function applyOpPrefill() {
  const pf = window._opPrefill;
  if (!pf) return;
  OPS.forEach(op => {
    const vals = pf[op.id];
    if (!vals) return;
    const card = document.querySelector('[data-op-card="' + op.id + '"]');
    if (!card) return;
    Object.keys(vals).forEach(fn => {
      const inp = card.querySelector('input[data-fname="' + fn + '"]');
      if (inp) inp.value = vals[fn];
    });
  });
}

// ===================== 启动 =====================
// ===================== 语言切换 =====================
function initLang() {
  const I = window.I18N;
  const saved = S.cfg.lang;
  const lang = I.SUPPORTED.includes(saved) ? saved : I.detectDefault();
  I.setLang(lang);
  const sel = $('#langSel');
  if (sel) {
    sel.value = lang;
    sel.onchange = async () => {
      I.setLang(sel.value);
      S.cfg.lang = sel.value;
      readCfgFromUI();
      await window.api.saveCfg(S.cfg);
      applyI18nStatic();
      renderTabs(); renderPanels();
      if (S.overview) renderAssets(S.overview);
      renderLoanStatus();
      log('Language: ' + sel.value);
    };
  }
}

// ===================== 界面密度 / 折叠 / 缩放（D49） =====================
// 笔记本小屏优化：面板可折叠、日志可拖拽高度、字号可缩放并持久化。
const UI = { zoom: 1, collapsed: {} };

// 把界面偏好（缩放/折叠/日志高度）写回配置，与网络配置同存 config.json。
// 先 readCfgFromUI 保留 node/indexer/contract 的当前输入，再落盘。
async function saveCfg() {
  try {
    S.cfg.zoom = UI.zoom;
    S.cfg.collapsed = UI.collapsed;
    if (UI.logH) S.cfg.logH = UI.logH;
    await window.api.saveCfg(S.cfg);
  } catch (e) { /* 配置写入失败不影响使用 */ }
}

function applyZoom() {
  try { document.documentElement.style.fontSize = (13 * UI.zoom) + 'px'; } catch (e) {}
  const el = $('#zoomVal'); if (el) el.textContent = Math.round(UI.zoom * 100) + '%';
}
function setCollapsed(paneEl, on) {
  if (!paneEl) return;
  paneEl.classList.toggle('ov-collapsed', !!on);
  const t = paneEl.querySelector('.ov-toggle');
  if (t) t.setAttribute('aria-expanded', on ? 'false' : 'true');
}
function initPanelToggles() {
  const pairs = [
    ['#ovAssets', 'ovAssetsTgl', 'assets'],
    ['#ovProto',  'ovProtoTgl',  'proto'],
    ['#ovLoan',   'ovLoanTgl',   'loan'],
    ['#logwrap',  'logTgl',      'log'],
  ];
  pairs.forEach(([sel, tgl, key]) => {
    const pane = $(sel), b = $(tgl);
    if (!pane || !b) return;
    setCollapsed(pane, !!UI.collapsed[key]);
    b.onclick = () => {
      UI.collapsed[key] = !pane.classList.contains('ov-collapsed');
      setCollapsed(pane, UI.collapsed[key]);
      saveCfg();
    };
  });
  // 日志高度可拖拽
  const rz = $('#logResize'), logEl = $('#log');
  if (rz && logEl) {
    let dragging = false, startY = 0, startH = 0;
    rz.onmousedown = (e) => {
      dragging = true; startY = e.clientY; startH = logEl.offsetHeight;
      document.body.style.userSelect = 'none'; e.preventDefault();
    };
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const h = Math.max(40, Math.min(startH + (startY - e.clientY), window.innerHeight * 0.6));
      logEl.style.height = h + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; document.body.style.userSelect = '';
      UI.logH = logEl.offsetHeight; saveCfg();
    });
    if (UI.logH) logEl.style.height = UI.logH + 'px';
  }
  // 缩放按钮
  const zi = $('#zoomIn'), zo = $('#zoomOut'), zr = $('#zoomReset');
  if (zi) zi.onclick = () => { UI.zoom = Math.min(1.6, +(UI.zoom + 0.1).toFixed(2)); applyZoom(); saveCfg(); };
  if (zo) zo.onclick = () => { UI.zoom = Math.max(0.8, +(UI.zoom - 0.1).toFixed(2)); applyZoom(); saveCfg(); };
  if (zr) zr.onclick = () => { UI.zoom = 1; applyZoom(); saveCfg(); };
  applyZoom();
}

// ===================== 启动 =====================
(async function boot() {
  await initCfg();
  initLang();
  UI.zoom = S.cfg.zoom || 1;
  UI.collapsed = S.cfg.collapsed || {};
  UI.logH = S.cfg.logH || 0;
  applyI18nStatic();
  initPanelToggles();
  renderTabs();
  renderPanels();
  const st = await window.api.walletStatus();
  if (st.unlocked) { setAccount(st.address, true); log(t('w.unlocked', { a: st.address }), 'ok'); }
  else log(t('log.ready'));
})();
