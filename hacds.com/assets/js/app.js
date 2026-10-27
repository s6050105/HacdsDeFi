/* ==========================================================================
   hacds.com/app — 控制台主逻辑
   ========================================================================== */
(function () {
  'use strict';

  const API = window.HacdsAPI;
  const W = window.HacdsWallet;
  const TX = window.HacdsTx;
  const CFG = window.HACDS_CONFIG;

  const S = {
    addr: null,
    overview: null,
    user: null,
    proto: null,
    swapDir: 0,        // 0 = HAC→hacds, 1 = hacds→HAC
    pool: [],
    busy: false,
  };

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ---------- 日志 ---------- */

  function log(msg, kind) {
    const box = $('#appLog');
    const line = document.createElement('div');
    line.className = 'log-line' + (kind ? ' ' + kind : '');
    const t = new Date().toLocaleTimeString();
    line.innerHTML = '<span class="log-time">' + t + '</span>' +
      String(msg).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function errMsg(e) {
    const m = String(e && e.message || e);
    const map = {
      wallet_not_found: '未检测到 MoneyNex 钱包，请先安装',
      connect_rejected: '你取消了连接',
      need_connect: '需要先连接钱包',
      sign_refused: '钱包拒绝了签名',
      empty_txbody: '交易体构建失败',
    };
    return map[m] || m;
  }

  /* ---------- 初始化 ---------- */

  document.addEventListener('DOMContentLoaded', async () => {
    window.I18N.init();
    bindUI();

    // 语言切换后重建动态内容。
    // i18n.apply 只处理页面里已有的 data-i18n 元素；
    // innerHTML 动态插入的部分必须由各页面自己重绘。
    window.addEventListener('langchange', () => {
      updateSwapQuote();
      if (!S.addr) return;
      renderUserPosition();
      renderMyHacd();
      if (S.pool && S.pool.length) renderPool();
    });

    // 尝试自动恢复已授权连接
    await W.waitReady(1500);
    if (!W.isAvailable()) {
      log('未检测到 MoneyNex 钱包扩展', 'warn');
      return;
    }
    try {
      const a = await W.getWallet();
      if (a) enterApp(a);
    } catch (e) {
      // 未授权：停在欢迎页
    }
  });

  function bindUI() {
    $('#btnConnect').addEventListener('click', doConnect);
    $('#btnConnect2').addEventListener('click', doConnect);
    $('#btnRefresh').addEventListener('click', refreshAll);

    // Tabs
    $$('.tab').forEach(b => {
      b.addEventListener('click', () => {
        $$('.tab').forEach(x => x.classList.toggle('on', x === b));
        $$('.panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
      });
    });

    // Swap
    $('#swapIn').addEventListener('input', updateSwapQuote);
    $('#swapFlip').addEventListener('click', () => {
      S.swapDir = S.swapDir ? 0 : 1;
      $('#swapFromSym').textContent = S.swapDir ? 'hacds' : 'HAC';
      $('#swapToSym').textContent = S.swapDir ? 'HAC' : 'hacds';
      $('#swapIn').value = '';
      updateSwapQuote();
    });
    $('#btnSwap').addEventListener('click', doSwap);

    // Liquidity
    $('#btnAddLiq').addEventListener('click', doAddLiq);
    $('#btnRmLiq').addEventListener('click', doRmLiq);
    $('#btnHarvest').addEventListener('click', doHarvest);
    $('#liqHac').addEventListener('input', syncLiqRatio);

    // Loan
    $('#btnBorrow').addEventListener('click', doBorrow);
    $('#btnRepay').addEventListener('click', doRepay);
    $('#btnCollateral').addEventListener('click', doCollateral);

    // HACD
    $('#btnLoadPool').addEventListener('click', loadPool);
    $('#btnLoadMine').addEventListener('click', loadMyHacd);
    $('#btnSelAll').addEventListener('click', () => {
      S.mintPicked = (S.myHacd || []).slice();
      renderMyHacd();
    });
    $('#btnSelNone').addEventListener('click', () => {
      S.mintPicked = [];
      renderMyHacd();
    });
    $('#btnRedeem').addEventListener('click', doRedeem);
    $('#btnMint').addEventListener('click', doMint);
    $('#redeemName').addEventListener('input', updateRedeemCost);
  }

  /* ---------- 连接 ---------- */

  async function doConnect() {
    try {
      const acc = await W.connect();
      enterApp(acc.address);
      log('已连接 ' + API.shortAddr(acc.address), 'ok');
    } catch (e) {
      log(errMsg(e), 'err');
    }
  }

  async function enterApp(addr) {
    S.addr = addr;
    $('#notConnected').classList.add('hidden');
    $('#connected').classList.remove('hidden');
    $('#btnConnect').textContent = API.shortAddr(addr);
    $('#acctAddr').textContent = addr;
    await refreshAll();
  }

  /* ---------- 刷新 ---------- */

  async function refreshAll() {
    if (!S.addr) return;
    try {
      const [ov, us, pr] = await Promise.all([
        API.balance(S.addr),
        API.userState(S.addr),
        API.protocolState(S.addr),
      ]);
      S.overview = ov; S.user = us; S.proto = pr;

      // 余额
      $('#balHac').textContent = API.fmt(API.parseHac(ov.hac), 4);
      $('#balDs').textContent = us.due != null ? TX.atomsToDisplay(us.due) : '—';
      $('#balHacd').textContent = ov.hacdCount;

      // 协议状态
      const p = pr;
      if (p.ammHac != null) $('#pHac').textContent = API.fmt(Number(p.ammHac) / 1e8, 4);
      if (p.ammDs != null) $('#pDs').textContent = TX.atomsToDisplay(p.ammDs);
      if (p.lpTotal != null) $('#pLp').textContent = API.fmtBig(p.lpTotal);
      if (p.utilization != null) $('#pUtil').textContent = API.fmtBps(p.utilization, 1);
      if (p.coverage != null) $('#pCov').textContent = API.fmtBps(p.coverage, 1);
      if (p.poolPrice != null && Number(p.poolPrice) > 0) {
        $('#pPrice').textContent = API.fmt(Number(p.poolPrice) / 1e8, 8);
      }

      // 储备覆盖率（索引器 /backing）——独立刷新，失败不影响主面板
      refreshBacking();

      // 用户仓位
      renderUserPosition();
      updateSwapQuote();
    } catch (e) {
      log('刷新失败：' + errMsg(e), 'err');
    }
  }

  /**
   * 储备覆盖率（索引器 /backing）。
   *
   * 为什么单独刷新而不是并进主面板：
   *   数据来自索引器（不是节点），索引器可能没跑或 Worker 没配 INDEXER_ORIGIN。
   *   那种情况下主面板仍应正常工作，只把这一格显示成「不可用」。
   */
  async function refreshBacking() {
    const el = $('#pBacking');
    if (!el) return;
    try {
      const b = await API.backing();
      if (!b || b.real_hac == null) {
        el.textContent = t('app.backingNa');
        el.style.color = 'var(--text-dim)';
        return;
      }
      const bps = Number(b.ratio_bps || 0);
      el.textContent = API.fmtBps(bps, 1);
      // >100% 说明合约内部积分超过真实储备 —— 有人凭空多了索取权，必须显眼
      el.style.color = bps > 10000 ? 'var(--red)'
                     : bps > 9500 ? 'var(--amber)'
                     : 'var(--text)';
      el.title = t('app.backingTip') + '\n'
        + 'tot_hac_eff = ' + b.tot_hac_eff + '\n'
        + 'real_hac    = ' + b.real_hac;
      if (bps > 10000) log('⚠ 储备覆盖率 ' + (bps / 100).toFixed(2) + '% > 100%：积分超过真实余额', 'err');
    } catch (e) {
      el.textContent = t('app.backingNa');
      el.style.color = 'var(--text-dim)';
      el.title = String(e && e.message || e);
    }
  }

  function renderUserPosition() {
    const u = S.user || {};
    // LP
    $('#myShares').textContent = u.lpShares != null ? API.fmtBig(u.lpShares) : '—';
    $('#myPendHac').textContent = u.lpPendingHac != null ? API.fmt(Number(u.lpPendingHac) / 1e8, 6) : '—';
    $('#myPendDs').textContent = u.lpPendingDs != null ? TX.atomsToDisplay(u.lpPendingDs) : '—';

    // 借贷
    const coll = u.coll != null ? u.coll : 0;
    const debt = u.debtNow != null ? u.debtNow : (u.debt || 0);
    $('#myColl').textContent = TX.atomsToDisplay(coll);
    $('#myDebt').textContent = API.fmt(Number(debt) / 1e8, 4) + ' HAC';

    const health = u.health != null ? Number(u.health) : null;
    const el = $('#myHealth');
    if (health == null || debt === 0) {
      el.textContent = '—';
      el.style.color = '';
    } else {
      el.textContent = (health / 100).toFixed(2) + '%';
      el.style.color = health < 10000 ? 'var(--red)' : health < 12000 ? 'var(--amber)' : 'var(--green)';
    }
    $('#myMaxBorrow').textContent = calcMaxBorrow() + ' HAC';
  }

  function calcMaxBorrow() {
    const p = S.proto || {};
    const u = S.user || {};
    if (!p.poolPrice || !u.coll) return '0';
    // 抵押价值(HAC) = coll(atoms) × price(zhu/atom) / 1e8(zhu→HAC)
    // decimal=0 下 coll 的 atoms 原值就是个，不需要再除一次；
    // 旧代码多除了一个 1e8，导致可借额度被低估 1 亿倍。
    const collValue = Number(u.coll) * Number(p.poolPrice) / 1e8;
    const maxDebt = collValue / 2;                        // 50% LTV
    const cur = Number(u.debtNow || u.debt || 0) / 1e8;
    const left = Math.max(0, maxDebt - cur);
    return API.fmt(left, 4);
  }

  /* ---------- 兑换 ---------- */

  function updateSwapQuote() {
    const p = S.proto || {};
    const inp = $('#swapIn').value.trim();
    const out = $('#swapOut');
    const rate = $('#siRate');
    const impact = $('#siImpact');
    const minEl = $('#siMin');

    if (!p.ammHac || !p.ammDs || Number(p.ammHac) === 0 || Number(p.ammDs) === 0) {
      out.value = '';
      rate.textContent = '—';
      impact.textContent = '—';
      minEl.textContent = '—';
      return;
    }

    const hac = Number(p.ammHac) / 1e8;      // zhu → HAC（HAC 仍是 1e8 zhu）
    const ds = Number(p.ammDs);              // #3000 decimal=0：atoms 原值就是个数，不 ÷1e8
    const FEE = 0.005;

    if (!inp || isNaN(Number(inp))) {
      out.value = '';
      rate.textContent = (ds / hac).toFixed(6) + ' hacds / HAC';
      impact.textContent = '—';
      minEl.textContent = '—';
      return;
    }

    const amt = Number(inp);
    let got, spot;

    if (S.swapDir === 0) {
      // HAC → hacds
      const net = amt * (1 - FEE);
      got = ds * net / (hac + net);
      spot = ds / hac;
    } else {
      // hacds → HAC
      const net = amt * (1 - FEE);
      got = hac * net / (ds + net);
      spot = hac / ds;
    }

    out.value = got.toFixed(8);

    const execPrice = amt > 0 ? got / amt : 0;
    const imp = amt > 0 ? Math.abs(execPrice / spot - 1) * 100 : 0;

    rate.textContent = (S.swapDir === 0 ? (ds / hac) : (hac / ds)).toFixed(6) +
      (S.swapDir === 0 ? ' hacds/HAC' : ' HAC/hacds');
    impact.textContent = imp.toFixed(3) + '%';
    impact.style.color = imp > 5 ? 'var(--red)' : imp > 1 ? 'var(--amber)' : 'var(--text)';
    minEl.textContent = got.toFixed(6);
    $('#swapMinOut').value = (got * 0.995).toFixed(8);
  }

  async function doSwap() {
    if (!S.addr || S.busy) return;
    const inp = $('#swapIn').value.trim();
    if (!inp || Number(inp) <= 0) return log('请输入数量', 'warn');

    S.busy = true;
    try {
      const dl = await TX.deadline();
      let res;
      if (S.swapDir === 0) {
        const zhu = TX.hacToZhu(inp);
        const minOut = TX.displayToAtoms($('#swapMinOut').value || '0');
        log('构建兑换交易…');
        res = await TX.swapHacToDs(S.addr, zhu, minOut || '0', dl);
      } else {
        const atoms = TX.displayToAtoms(inp);
        const minOut = TX.hacToZhu($('#swapMinOut').value || '0');
        log('构建兑换交易…');
        res = await TX.swapDsToHac(S.addr, atoms, minOut || '0', dl);
      }
      await sendTx(res, '兑换');
    } catch (e) {
      log(errMsg(e), 'err');
    } finally {
      S.busy = false;
    }
  }

  /* ---------- 流动性 ---------- */

  function syncLiqRatio() {
    const p = S.proto || {};
    if (!p.ammHac || !p.ammDs) return;
    const hac = Number(p.ammHac), ds = Number(p.ammDs);
    const h = Number($('#liqHac').value || 0);
    if (h > 0) {
      $('#liqDs').value = (h * ds / hac).toFixed(8);
    }
  }

  async function doAddLiq() {
    if (!S.addr || S.busy) return;
    const h = $('#liqHac').value.trim();
    const d = $('#liqDs').value.trim();
    if (!h || !d) return log('请填写两侧数量', 'warn');
    S.busy = true;
    try {
      const dl = await TX.deadline();
      const minShare = $('#liqMinShare').value.trim() || '0';
      log('构建加池交易…');
      const res = await TX.addLiquidity(S.addr, TX.hacToZhu(h), TX.displayToAtoms(d), minShare, dl);
      await sendTx(res, '加池');
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  // C-4：remove_liquidity 单笔会撞主网 resource 上限（6,102 > 6,100）。
  // resource_limit_byte=56 是主网参数，独立于 gas_max，调高 gas 绕不过；
  // 合约不可升级，所以这里拆成两笔：先 lp_harvest 结算奖励，再撤池。
  //
  // 顺序不能反：lp_settle 用**撤池前**的 lpt 计算收益，先撤池会按减少后的
  // 份额结算，用户少拿奖励。
  //
  // sendTx 的 autosubmit 只等签名+广播（拿到 hash 即返回），不等打包，
  // 所以两笔可以连续发；第一笔失败时不发第二笔。
  async function doRmLiq() {
    if (!S.addr || S.busy) return;
    const s = $('#rmShare').value.trim();
    if (!s || s === '0') return log('请输入份额', 'warn');
    S.busy = true;
    try {
      const dl = await TX.deadline();
      const minHac = TX.hacToZhu($('#rmMinHac').value || '0');
      const minDs = TX.displayToAtoms($('#rmMinDs').value || '0');

      // 第 1 步：结算 LP 奖励
      log('撤池分两步：第 1 步「结算 LP 奖励」…');
      const h = await TX.harvest(S.addr);
      await sendTx(h, '结算 LP 奖励');

      // 第 2 步：撤池
      log('第 2 步：构建撤池交易…');
      const res = await TX.removeLiquidity(S.addr, s, minHac, minDs, dl);
      await sendTx(res, '撤池');
    } catch (e) {
      // 区分是哪一步失败：第 1 步已成功时资金无损失，只是没撤成
      log(errMsg(e), 'err');
      log('提示：若第 1 步「结算 LP 奖励」已成功，你的份额与奖励都在账上，可直接重试撤池。', 'warn');
    } finally { S.busy = false; }
  }

  async function doHarvest() {
    if (!S.addr || S.busy) return;
    S.busy = true;
    try {
      log('构建领取奖励交易…');
      const res = await TX.harvest(S.addr);
      await sendTx(res, '领取奖励');
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  /* ---------- 借贷 ---------- */

  async function doBorrow() {
    if (!S.addr || S.busy) return;
    const a = $('#borrowAmt').value.trim();
    if (!a || Number(a) <= 0) return log('请输入借款金额', 'warn');
    S.busy = true;
    try {
      log('构建借款交易…');
      const res = await TX.borrow(S.addr, TX.hacToZhu(a));
      await sendTx(res, '借款');
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  async function doRepay() {
    if (!S.addr || S.busy) return;
    const a = $('#repayAmt').value.trim();
    if (!a || Number(a) <= 0) return log('请输入还款金额', 'warn');
    S.busy = true;
    try {
      log('构建还款交易…');
      const res = await TX.repay(S.addr, TX.hacToZhu(a));
      await sendTx(res, '还款');
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  async function doCollateral() {
    if (!S.addr || S.busy) return;
    const a = $('#collAmt').value.trim();
    if (!a || Number(a) <= 0) return log('请输入抵押数量', 'warn');
    S.busy = true;
    try {
      log('构建追加抵押交易…');
      const res = await TX.addCollateral(S.addr, TX.displayToAtoms(a));
      await sendTx(res, '追加抵押');
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  /* ---------- HACD ---------- */

  /* ---------- 存入：HACD → hacds（支持多选，自动拆成多笔） ---------- */

  // 已勾选的钻石名
  S.mintPicked = [];

  // 载入用户自己持有的 HACD
  async function loadMyHacd() {
    try {
      const ov = await API.balance(S.addr);
      S.overview = ov;
      const list = ov.diamonds || [];
      S.myHacd = list;
      renderMyHacd();
      log('载入 ' + list.length + ' 颗自有 HACD', 'ok');
    } catch (e) {
      log('载入失败：' + errMsg(e), 'err');
    }
  }

  function renderMyHacd() {
    const grid = $('#myHacdGrid');
    const list = S.myHacd || [];

    if (!list.length) {
      grid.innerHTML = '<div class="dim" style="font-size:13px;grid-column:1/-1">'
        + window.I18N.t('app.noHacd') + '</div>';
      updateMintSelection();
      return;
    }

    grid.innerHTML = list.map(n => {
      const on = S.mintPicked.includes(n);
      return '<div class="pick-item' + (on ? ' on' : '') + '" data-name="' + n + '">' + n + '</div>';
    }).join('');

    grid.querySelectorAll('.pick-item').forEach(el => {
      el.addEventListener('click', () => {
        const n = el.dataset.name;
        const i = S.mintPicked.indexOf(n);
        if (i >= 0) S.mintPicked.splice(i, 1); else S.mintPicked.push(n);
        renderMyHacd();
      });
    });
    updateMintSelection();
  }

  // 选区变化 → 更新计数与预估
  async function updateMintSelection() {
    const n = S.mintPicked.length;
    $('#mintCount').textContent = n;
    $('#mintSelCount').textContent = n
      ? window.I18N.t('app.selCount').replace('{n}', n)
      : window.I18N.t('app.selNone');
    $('#mintSelCount').className = 'tag' + (n ? ' blue' : '');

    if (!n) { $('#mintTotalEst').textContent = '—'; return; }

    // 估算总分：逐个查评分后累加
    $('#mintTotalEst').textContent = '…';
    try {
      const details = await Promise.all(S.mintPicked.map(fetchDiamondDetail));
      let total = 0, ok = true;
      for (const d of details) {
        if (!d) { ok = false; continue; }
        const sc = d.score != null ? Number(d.score) : 0;
        total += sc;
      }
      $('#mintTotalEst').textContent = ok ? total + ' hacds' : total + ' hacds (部分未知)';
    } catch (e) {
      $('#mintTotalEst').textContent = '—';
    }
  }

  async function fetchDiamondDetail(name) {
    try {
      const base = CFG.useLocal ? CFG.localNode : CFG.apiBase;
      const r = await fetch(base + '/api/diamond/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [name] }),
      }).then(x => x.json());
      return (r.list || [])[0] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 批量存入。
   * 合约硬限制：PayableHACD 的 count != 1 直接返回 48（VM resource 单笔只够一颗）。
   * 所以必须在客户端拆成 N 笔独立交易，逐个广播。
   */
  async function doMint() {
    if (!S.addr || S.busy) return;
    const names = S.mintPicked.slice();
    if (!names.length) return log(window.I18N.t('app.pickFirst'), 'warn');

    S.busy = true;
    const btn = $('#btnMint');
    btn.disabled = true;

    let ok = 0, fail = 0;
    log('开始批量存入：共 ' + names.length + ' 颗，拆成 ' + names.length + ' 笔…');

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      btn.textContent = window.I18N.t('app.minting').replace('{i}', i + 1).replace('{n}', names.length);
      try {
        const res = await TX.mintHacd(S.addr, name);
        // E-1：mintHacd 在官网是「明确不支持」的桩，返回 {ok:false, error, unsupported}。
        // 原实现不检查 ok 就直接 sendTx(res)，而 res.txbody 是 undefined →
        // 钱包抛出一个与「不支持」毫无关系的错误。这里必须自己接住。
        if (res && res.ok === false) {
          log(res.error || '该操作暂不支持', 'warn');
          break;   // 功能级不可用，逐颗重试无意义
        }
        await sendTx(res, '[' + (i + 1) + '/' + names.length + '] 存入 ' + name,
                     { msglayout: W.HACD_CERT_LAYOUT });
        ok++;
        // 从已选列表移除成功的那颗
        const k = S.mintPicked.indexOf(name);
        if (k >= 0) S.mintPicked.splice(k, 1);
      } catch (e) {
        fail++;
        log('[' + (i + 1) + '/' + names.length + '] ' + name + ' 失败：' + errMsg(e), 'err');
      }
      renderMyHacd();
    }

    btn.disabled = false;
    btn.textContent = window.I18N.t('app.mintBtn');
    log('批量存入完成：成功 ' + ok + ' / 失败 ' + fail, fail ? 'warn' : 'ok');
    S.busy = false;

    setTimeout(() => { loadMyHacd(); refreshAll(); }, 4000);
  }

  /* ---------- 赎回：hacds → HACD ---------- */
  /* ---------- 赎回：hacds → HACD ---------- */

  function updateRedeemCost() {
    const name = ($('#redeemName').value || '').trim().toUpperCase();
    const el = $('#redeemCost');
    if (!/^[A-Z]{6}$/.test(name)) { el.textContent = '—'; return; }
    // #2000 赎回无手续费；#3000 有 0.5% + 挑钻石溢价
    // 这里显示基础估计，实际以合约为准
    el.textContent = '≈ 20 hacds';
  }

  function renderPool() {
    const grid = $('#poolGrid');
    const list = S.pool || [];
    if (!list.length) {
      grid.innerHTML = '<div class="dim" style="font-size:13px;grid-column:1/-1">'
        + window.I18N.t('app.poolEmpty') + '</div>';
      return;
    }
    grid.innerHTML = list
      .map(n => '<div class="pool-item" data-name="' + n + '">' + n + '</div>').join('');
    grid.querySelectorAll('.pool-item').forEach(el => {
      el.addEventListener('click', () => {
        $('#redeemName').value = el.dataset.name;
      });
    });
  }

  async function loadPool() {
    try {
      log('加载合约池 HACD…');
      S.pool = await API.poolHacd();
      renderPool();
      log('池内 ' + S.pool.length + ' 颗', 'ok');
    } catch (e) {
      log('加载失败：' + errMsg(e), 'err');
    }
  }

  async function doRedeem() {
    if (!S.addr || S.busy) return;
    const name = ($('#redeemName').value || '').trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(name)) return log('钻石名应为 6 个大写字母', 'warn');
    S.busy = true;
    try {
      log('构建赎回交易…');
      const res = await TX.redeemHacd(S.addr, name);
      // E-1：同 doMint —— 官网的 redeemHacd 返回 {ok:false}，必须自己接住。
      if (res && res.ok === false) {
        log(res.error || '该操作暂不支持', 'warn');
        return;
      }
      await sendTx(res, '赎回 ' + name);
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  /* ---------- 发送 ---------- */

  async function sendTx(res, label, extra) {
    log('请求钱包签名…');
    const opts = Object.assign({ autosubmit: true }, extra || {});
    try {
      const r = await W.signTx(res.txbody, opts);
      const hash = r.hash || r.hash_with_fee || '';
      log('✓ ' + label + '成功：' + API.shortAddr(hash), 'ok');
      if (r.description && r.description.length) {
        r.description.forEach(d => log('  ' + d));
      }
      setTimeout(refreshAll, 3000);
      setTimeout(refreshAll, 12000);
    } catch (e) {
      if (e.code === 'submit_failed') {
        log('签名成功但广播失败：' + e.message, 'err');
        log('已签名交易体可重试广播：' + String(e.body || '').slice(0, 40) + '…', 'warn');
      } else {
        log(label + '失败：' + errMsg(e), 'err');
      }
      throw e;
    }
  }
})();
