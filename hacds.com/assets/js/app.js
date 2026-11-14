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

  //: 单笔存入的硬上限：合约 PayableHACD 走 rv64im 内核 score_sum，一次最多 200 颗。
  //: 必须与 HacdsDeFi3000.fitsh 的 MAX_DEPOSIT_COUNT 一致。
  //: ⚠ 放在文件顶部：updateMintSelection 等函数在渲染时就会用到它。
  const MINT_MAX = 200;

  /**
   * i18n 取值。
   * app.js 里大量日志/提示是运行时拼出来的，不走 data-i18n，
   * 必须显式调 t()，否则英文/土耳其语界面会混出中文。
   */
  const t = (k, ...a) => {
    let s = (window.I18N && window.I18N.t(k)) || k;
    a.forEach((v, i) => { s = s.replace('{' + i + '}', v); });
    return s;
  };

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
      wallet_not_found: t('err.walletNotFound'),
      connect_rejected: t('err.connectRejected'),
      need_connect: t('err.needConnect'),
      sign_refused:  t('err.signRefused'),
      empty_txbody:  t('err.emptyTxbody'),
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
      log(t('err.noExtension'), 'warn');
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
    $('#btnLoadMine').addEventListener('click', loadMyHacd);

    /* ---------- 资金：HAC / hacds 与合约的充提 ---------- */
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };

    on('#btnFundHacIn', () => runFund('hac-in'));
    on('#btnFundHacOut', () => runFund('hac-out'));
    on('#btnFundDsIn', () => runFund('ds-in'));
    on('#btnFundDsOut', () => runFund('ds-out'));

    const goHacd = $('#fundGoHacd');
    if (goHacd) goHacd.addEventListener('click', e => {
      e.preventDefault();
      const b = document.querySelector('[data-tab="hacd"]');
      if (b) b.click();
    });

    /* ---------- 转账 ---------- */
    on('#btnXferHac', () => runXfer('hac'));
    on('#btnXferDs', () => runXfer('ds'));
    on('#btnXferHacd', () => runXfer('hacd'));
    on('#btnXferOther', () => runXfer('other'));

    /* ---------- 工具：续租 ---------- */
    on('#btnRentLoad', loadRentBatches);
    on('#btnRentDo', doRent);

    renderQueryGrid();

    $('#btnLoadPool').addEventListener('click', loadPool);
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
      log(t('log.connected') + ' ' + API.shortAddr(acc.address), 'ok');
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
      log(t('log.refreshFail') + errMsg(e), 'err');
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
      if (bps > 10000) log(t('log.backingOver', (bps / 100).toFixed(2)), 'err');
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

    // 滑点保护默认值必须与**输入方向**同量纲，且不带小数：
    //   HAC → hacds：min_out 是 hacds（decimal 0），displayToAtoms 只收纯整数
    //   hacds → HAC：min_out 是 zhu，hacToZhu 可以吃小数
    // 旧代码对两个方向都写 .toFixed(8)，在 decimal=0 下会产出
    // "33183372.00000000" 这类字符串 → displayToAtoms 返回 null → 构建失败。
    $('#swapMinOut').value = S.swapDir === 0
      ? String(Math.floor(got * 0.995))
      : (got * 0.995).toFixed(8);
  }

  async function doSwap() {
    if (!S.addr || S.busy) return;
    const inp = $('#swapIn').value.trim();
    if (!inp || Number(inp) <= 0) return log(t('err.needAmount'), 'warn');

    S.busy = true;
    try {
      const dl = await TX.deadline();
      let res;
      if (S.swapDir === 0) {
        const zhu = TX.hacToZhu(inp);
        const minOut = TX.displayToAtoms($('#swapMinOut').value || '0');
        log(t('log.buildingSwap'));
        res = await TX.swapHacToDs(S.addr, zhu, minOut || '0', dl);
      } else {
        const atoms = TX.displayToAtoms(inp);
        const minOut = TX.hacToZhu($('#swapMinOut').value || '0');
        log(t('log.buildingSwap'));
        res = await TX.swapDsToHac(S.addr, atoms, minOut || '0', dl);
      }
      await sendTx(res, t('act.swap'));
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
    const hz = TX.hacToZhu($('#liqHac').value.trim());   // HAC → zhu（BigInt 字符串）
    if (hz == null) return;
    let a, b, c;
    try {
      a = BigInt(hz); b = BigInt(p.ammDs); c = BigInt(p.ammHac);
    } catch (e) { return; }
    if (c === 0n || a === 0n) return;
    // ⚠ 两处都不能用 Number：
    //   ① hacds 是 decimal=0，必须写**纯整数**。旧代码 `.toFixed(8)` 产出
    //      "33183372.00000000"，而提交时 displayToAtoms 只收 /^\d+$/ → 返回 null → 构建失败。
    //   ② h × ammDs 会轻易超过 Number.MAX_SAFE_INTEGER（ammDs 上限 5.9e15，
    //      乘个 2 就到 1.2e16），Number 乘法会丢低位，算出的 hacds 数量不准，
    //      轻则配比偏差、重则 add_liquidity 因比例越界回退。
    //   下取整是有意的：偏差方向永远是"少做"，多出来的余额留在钱包里。
    $('#liqDs').value = (a * b / c).toString();
  }

  async function doAddLiq() {
    if (!S.addr || S.busy) return;
    const h = $('#liqHac').value.trim();
    const d = $('#liqDs').value.trim();
    if (!h || !d) return log(t('err.needBothSides'), 'warn');
    S.busy = true;
    try {
      const dl = await TX.deadline();
      const minShare = $('#liqMinShare').value.trim() || '0';
      log(t('log.buildingAddLiq'));
      const res = await TX.addLiquidity(S.addr, TX.hacToZhu(h), TX.displayToAtoms(d), minShare, dl);
      await sendTx(res, t('act.addLiq'));
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
    if (!s || s === '0') return log(t('err.needShare'), 'warn');
    S.busy = true;
    try {
      const dl = await TX.deadline();
      const minHac = TX.hacToZhu($('#rmMinHac').value || '0');
      const minDs = TX.displayToAtoms($('#rmMinDs').value || '0');

      // 第 1 步：结算 LP 奖励
      log(t('log.rmStep1'));
      const h = await TX.harvest(S.addr);
      await sendTx(h, t('act.settleLp'));

      // 第 2 步：撤池
      log(t('log.rmStep2'));
      const res = await TX.removeLiquidity(S.addr, s, minHac, minDs, dl);
      await sendTx(res, t('act.rmLiq'));
    } catch (e) {
      // 区分是哪一步失败：第 1 步已成功时资金无损失，只是没撤成
      log(errMsg(e), 'err');
      log(t('log.rmHint'), 'warn');
    } finally { S.busy = false; }
  }

  async function doHarvest() {
    if (!S.addr || S.busy) return;
    S.busy = true;
    try {
      log(t('log.buildingHarvest'));
      const res = await TX.harvest(S.addr);
      await sendTx(res, t('act.harvest'));
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  /* ---------- 借贷 ---------- */

  async function doBorrow() {
    if (!S.addr || S.busy) return;
    const a = $('#borrowAmt').value.trim();
    if (!a || Number(a) <= 0) return log(t('err.needBorrowAmt'), 'warn');
    S.busy = true;
    try {
      log(t('log.buildingBorrow'));
      const res = await TX.borrow(S.addr, TX.hacToZhu(a));
      await sendTx(res, t('act.borrow'));
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  async function doRepay() {
    if (!S.addr || S.busy) return;
    const a = $('#repayAmt').value.trim();
    if (!a || Number(a) <= 0) return log(t('err.needRepayAmt'), 'warn');
    S.busy = true;
    try {
      log(t('log.buildingRepay'));
      const res = await TX.repay(S.addr, TX.hacToZhu(a));
      await sendTx(res, t('act.repay'));
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  async function doCollateral() {
    if (!S.addr || S.busy) return;
    const a = $('#collAmt').value.trim();
    if (!a || Number(a) <= 0) return log(t('err.needCollAmt'), 'warn');
    S.busy = true;
    try {
      log(t('log.buildingColl'));
      const res = await TX.addCollateral(S.addr, TX.displayToAtoms(a));
      await sendTx(res, t('act.addColl'));
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  /* ---------- HACD ---------- */

  /* ---------- 存入：HACD → hacds（多选，一次交易最多 200 颗） ---------- */

  // 已勾选的钻石名
  S.mintPicked = [];

  // 载入用户自己持有的 HACD
  //
  // ⚠ 光有名字画不出钻石图、也算不了分（评分需要 visual_gene + number）。
  //   所以拿到名字列表后必须再查一次详情。
  async function loadMyHacd() {
    try {
      const ov = await API.balance(S.addr);
      S.overview = ov;
      const names = ov.diamonds || [];
      if (!names.length) {
        S.myHacd = [];
        renderMyHacd();
        log(t('log.loadedHacd', 0), 'ok');
        return;
      }
      log(t('log.loadingHacdDetail', { n: names.length }));
      const details = await API.diamondDetails(names);
      // 详情可能缺项（节点查不到某颗），用名字兜底保证列表完整
      const byName = new Map((details || []).map(d => [d.name, d]));
      S.myHacd = names.map(n => byName.get(n) || { name: n, number: 0, visual_gene: '' });
      renderMyHacd();
      log(t('log.loadedHacd', names.length), 'ok');
    } catch (e) {
      log(t('log.loadFail') + errMsg(e), 'err');
    }
  }

  /**
   * 渲染「我的钻石」列表。
   *
   * 2026-11-11：从纯文字按钮改为带 SVG 的卡片，并加筛选/排序
   * （移植自 PC 钱包 wallet-app/renderer/app.js 的 renderHacdPanel）。
   *
   * 评分用 DiamondScore 本地算，不请求网络 —— 与合约的 5 维算法一致。
   */
  // HACD 网格的来源：'mine' = 我的钻石，'pool' = 合约池
  S.hacdSrc = S.hacdSrc || 'mine';

  function renderMyHacd() {
    const grid = $('#myHacdGrid');
    const filter = $('#hacdFilter');
    const list = S.myHacd || [];

    if (!list.length) {
      if (filter) filter.innerHTML = '';
      grid.innerHTML = '<div class="dim" style="font-size:13px;grid-column:1/-1">'
        + window.I18N.t('app.noHacd') + '</div>';
      updateMintSelection();
      return;
    }

    // 常规为名字数组；若已是对象数组（含 visual_gene/number）直接用
    const items = list.map(x => typeof x === 'string'
      ? window.HacdUI.enrich({ name: x, number: 0, visual_gene: '' })
      : window.HacdUI.enrich(x));

    // 筛选栏
    if (filter) {
      filter.innerHTML = window.HacdUI.buildFilterBar(items, renderMyHacd);
      window.HacdUI.wireFilterBar(filter, renderMyHacd);
    }

    const shown = window.HacdUI.applyFilter(items);
    grid.innerHTML = shown.map(i =>
      window.HacdUI.cardHtml(i, S.mintPicked.includes(i.name))).join('');
    if (!shown.length) {
      grid.innerHTML = '<div class="dim" style="font-size:13px;grid-column:1/-1">没有符合筛选条件的钻石</div>';
    }

    // 点击分派（方案 B，与 PC 钱包一致）：
    //   右上角圆点 → 只切换勾选
    //   其它区域   → 只弹详情，不改勾选
    grid.querySelectorAll('.hacd-card').forEach(el => {
      el.addEventListener('click', ev => {
        const n = el.dataset.name;
        const item = items.find(x => x.name === n);

        if (ev.target.closest('[data-check]')) {
          const k = S.mintPicked.indexOf(n);
          if (k >= 0) S.mintPicked.splice(k, 1); else S.mintPicked.push(n);
          renderMyHacd();
          return;
        }
        if (item) window.HacdUI.showDetail(item);
      });
    });
    updateMintSelection();
  }

  // 选区变化 → 更新计数与预估
  async function updateMintSelection() {
    const n = S.mintPicked.length;
    $('#mintCount').textContent = n;
    // 超过 200 颗时明确标红，别等点了按钮才报错
    const over = n > MINT_MAX;
    $('#mintSelCount').textContent = n
      ? window.I18N.t(over ? 'app.selOver' : 'app.selCount')
          .replace('{n}', n).replace('{max}', MINT_MAX)
      : window.I18N.t('app.selNone');
    $('#mintSelCount').className = 'tag' + (over ? ' red' : n ? ' blue' : '');

    if (!n) { $('#mintTotalEst').textContent = '—'; return; }

    // 估算总分：逐个查评分后累加
    $('#mintTotalEst').textContent = '…';
    try {
      // 上限 200，且并发别一次打满 —— 分 8 个一批，避免瞬间 200 个请求
      const picked = S.mintPicked.slice(0, MINT_MAX);
      const details = [];
      for (let i = 0; i < picked.length; i += 8) {
        details.push(...await Promise.all(picked.slice(i, i + 8).map(fetchDiamondDetail)));
      }
      // ⚠ 分数 ≠ hacds 数量（2026-11-12 审计 C-H2）。
      //   合约按 `score × SCORE_SCALE(1e8)` 铸币：3.55 分 → 3.55 亿个 hacds。
      //   原来把分数之和直接标成 "hacds"，显示 "3 hacds"，实际铸 3e8 —— 差 1e8 倍。
      //   这里把分数与铸币量**分开显示**，避免用户拿错数量去判断。
      let scoreSum = 0, ok = true;
      for (const d of details) {
        if (!d) { ok = false; continue; }
        const sc = d.score != null ? Number(d.score) : 0;
        scoreSum += sc;
      }
      const minted = Math.floor(scoreSum * 100000000);   // SCORE_SCALE = 1e8
      const txt = scoreSum.toFixed(2) + ' 分 → ' + minted.toLocaleString('en-US') + ' hacds';
      $('#mintTotalEst').textContent = ok ? txt : txt + ' ' + t('app.partialUnknown');
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
   * 存入（HACD → hacds）。
   *
   * 2026-11-11：合约升到 v1.3.0 的 calc 内核后，`PayableHACD` 一次最多收 200 颗，
   * 所以不再拆成 N 笔 —— **一次交易打包全部选中的名字**，只签一次。
   *
   * 实现方式：纯转账 `hacd-to` 打到合约地址，链上触发 PayableHACD 钩子记账。
   * 不是合约调用（合约没有 mint 这个 external 函数）。
   */
  async function doMint() {
    if (!S.addr || S.busy) return;
    let names = S.mintPicked.slice();
    if (!names.length) return log(window.I18N.t('app.pickFirst'), 'warn');

    // 合约硬上限 200 颗；超出的留在已选里，提示用户分批
    if (names.length > MINT_MAX) {
      const rest = names.length - MINT_MAX;
      names = names.slice(0, MINT_MAX);
      log(t('log.mintOverflow', MINT_MAX, rest), 'warn');
    }

    S.busy = true;
    const btn = $('#btnMint');
    btn.disabled = true;
    btn.textContent = t('app.minting', names.length, names.length);

    try {
      log(t('log.mintStart', names.length));
      const res = await TX.transfer('hacd-to', {
        main: S.addr,
        to: CFG.contract,
        names: names.join(','),
      });
      await sendTx(res, t('act.mint') + ' ×' + names.length);
      // 成功的从已选移除
      names.forEach(n => {
        const k = S.mintPicked.indexOf(n);
        if (k >= 0) S.mintPicked.splice(k, 1);
      });
      log(t('log.mintDone', names.length), 'ok');
      renderMyHacd();
      setTimeout(() => { loadMyHacd(); refreshAll(); }, 4000);
    } catch (e) {
      log(t('log.failed') + errMsg(e), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = window.I18N.t('app.mintBtn');
      S.busy = false;
    }
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

  /**
   * 渲染合约池里的钻石（右侧赎回卡）。
   *
   * 与左侧「我的钻石」用同一套卡片（带 SVG + 分数），
   * 点击 = 填入赎回名字 + 弹窗看详情。
   */
  function renderPool() {
    const grid = $('#poolHacdGrid');
    const list = S.poolDetail || [];
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '<div class="dim" style="font-size:13px;grid-column:1/-1">'
        + window.I18N.t('app.poolEmpty') + '</div>';
      return;
    }
    const items = list.map(x => typeof x === 'string'
      ? window.HacdUI.enrich({ name: x, number: 0, visual_gene: '' })
      : window.HacdUI.enrich(x));
    grid.innerHTML = items.map(i => window.HacdUI.cardHtml(i, false, false)).join('');
    grid.querySelectorAll('.hacd-card').forEach(el => {
      el.addEventListener('click', () => {
        const n = el.dataset.name;
        $('#redeemName').value = n;
        const item = items.find(x => x.name === n);
        if (item) window.HacdUI.showDetail(item);
      });
    });
  }

  async function loadPool() {
    try {
      log(t('log.loadingPool'));
      const names = await API.poolHacd();
      S.pool = names;
      if (!names.length) {
        S.poolDetail = [];
        renderPool();
        log(t('log.poolCount', 0), 'ok');
        return;
      }
      // 与「我的钻石」一样：光有名字画不出图，必须补详情
      const details = await API.diamondDetails(names);
      const byName = new Map((details || []).map(d => [d.name, d]));
      S.poolDetail = names.map(n => byName.get(n) || { name: n, number: 0, visual_gene: '' });
      renderPool();
      log(t('log.poolCount', names.length), 'ok');
    } catch (e) {
      log(t('log.loadFail') + errMsg(e), 'err');
    }
  }

  async function doRedeem() {
    if (!S.addr || S.busy) return;
    const name = ($('#redeemName').value || '').trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(name)) return log(t('err.badDiamondName'), 'warn');
    S.busy = true;
    try {
      log(t('log.buildingRedeem'));
      const res = await TX.redeemHacd(S.addr, name);
      // E-1：同 doMint —— 官网的 redeemHacd 返回 {ok:false}，必须自己接住。
      if (res && res.ok === false) {
        log(res.error || t('err.unsupported'), 'warn');
        return;
      }
      await sendTx(res, t('act.redeem') + ' ' + name);
    } catch (e) {
      log(errMsg(e), 'err');
    } finally { S.busy = false; }
  }

  /* ---------- 发送 ---------- */

  async function sendTx(res, label, extra) {
    log(t('log.signing'));
    const opts = Object.assign({ autosubmit: true }, extra || {});
    try {
      const r = await W.signTx(res.txbody, opts);
      const hash = r.hash || r.hash_with_fee || '';
      log('✓ ' + label + ' ' + t('log.succeeded') + API.shortAddr(hash), 'ok');
      if (r.description && r.description.length) {
        r.description.forEach(d => log('  ' + d));
      }
      setTimeout(refreshAll, 3000);
      setTimeout(refreshAll, 12000);
    } catch (e) {
      if (e.code === 'submit_failed') {
        log(t('log.signedBroadcastFail') + e.message, 'err');
        log(t('log.retryBroadcast') + String(e.body || '').slice(0, 40) + '…', 'warn');
      } else {
        log(label + ' ' + t('log.failed') + errMsg(e), 'err');
      }
      throw e;
    }
  }

  /* ===================== 资金页 ===================== */

  /**
   * 四种充提。都通过 TX.transfer 走原生动作：
   *   hac-in   → hac-to         （我 → 合约，触发 PayableHAC）
   *   hac-out  → hac-from-to    （合约 → 我，触发 PermitHAC）
   *   ds-in    → asset-to       （我 → 合约，触发 PayableAsset）
   *   ds-out   → asset-from-to  （合约 → 我，触发 PermitAsset）
   */
  async function runFund(kind) {
    if (!S.addr) return log(t('acct.locked'), 'err');
    if (S.busy) return;

    const cfg = {
      'hac-in':  { input: '#fundHacIn',  sub: 'hac-to',        label: t('fund.doHacIn'),  unit: 'hac' },
      'hac-out': { input: '#fundHacOut', sub: 'hac-from-to',   label: t('fund.doHacOut'), unit: 'hac' },
      'ds-in':   { input: '#fundDsIn',   sub: 'asset-to',      label: t('fund.doDsIn'),   unit: 'atoms' },
      'ds-out':  { input: '#fundDsOut',  sub: 'asset-from-to', label: t('fund.doDsOut'),  unit: 'atoms' },
    }[kind];
    if (!cfg) return;

    const raw = ($(cfg.input) && $(cfg.input).value || '').trim();
    if (!raw || Number(raw) <= 0) return log(t('fund.needAmt'), 'warn');

    S.busy = true;
    try {
      log(t('fund.building'));
      const req = { main: S.addr, to: kind.endsWith('-in') ? CFG.contract : S.addr };
      // from-to 形态需要显式 from = 合约
      if (cfg.sub.endsWith('from-to')) req.from = CFG.contract;
      if (cfg.unit === 'hac') req.hac = raw;
      else { req.serial = '3000'; req.atoms = String(Math.floor(Number(raw))); }

      const res = await TX.transfer(cfg.sub, req);
      await sendTx(res, cfg.label);
    } catch (e) {
      log(t('fund.fail') + errMsg(e), 'err');
    } finally {
      S.busy = false;
    }
  }

  /* ===================== 转账页 ===================== */

  /**
   * 三种转账。
   *   hac  → hac-to       （我 → 他人，不碰合约）
   *   ds   → asset-from-to（我 → 他人，from = 我自己）
   *   hacd → hacd-to      （我 → 他人）
   */
  async function runXfer(kind) {
    if (!S.addr) return log(t('acct.locked'), 'err');
    if (S.busy) return;

    let sub, req, label;
    if (kind === 'hac') {
      const to = ($('#xferHacTo') && $('#xferHacTo').value || '').trim();
      const amt = ($('#xferHacAmt') && $('#xferHacAmt').value || '').trim();
      if (!to) return log(t('xfer.needAddr'), 'warn');
      if (!amt || Number(amt) <= 0) return log(t('fund.needAmt'), 'warn');
      sub = 'hac-to'; req = { main: S.addr, to, hac: amt }; label = t('xfer.doHac');

    } else if (kind === 'ds') {
      const to = ($('#xferDsTo') && $('#xferDsTo').value || '').trim();
      const amt = ($('#xferDsAmt') && $('#xferDsAmt').value || '').trim();
      if (!to) return log(t('xfer.needAddr'), 'warn');
      if (!amt || Number(amt) <= 0) return log(t('fund.needAmt'), 'warn');
      // 我 → 他人：用 asset-to（发送方隐含为交易主地址），不需要 from
      sub = 'asset-to';
      req = { main: S.addr, to, serial: '3000', atoms: String(Math.floor(Number(amt))) };
      label = t('xfer.doDs');

    } else if (kind === 'other') {
      // 其它资产转账：serial 是纯数字（UI 别处显示为 #2000，这里容错剥离 #）
      const serial = ($('#xferOtherSerial') && $('#xferOtherSerial').value || '').trim().replace(/^#/, '');
      const atoms = ($('#xferOtherAtoms') && $('#xferOtherAtoms').value || '').trim();
      const to = ($('#xferOtherTo') && $('#xferOtherTo').value || '').trim();
      if (!to) return log(t('xfer.needAddr'), 'warn');
      if (!atoms || Number(atoms) <= 0) return log(t('fund.needAmt'), 'warn');
      if (!/^\d+$/.test(serial)) return log(t('xfer.needSerial'), 'warn');
      sub = 'asset-to';
      req = { main: S.addr, to, serial, atoms: String(Math.floor(Number(atoms))) };
      label = t('xfer.doOther');

    } else {
      const names = ($('#xferHacdNames') && $('#xferHacdNames').value || '')
        .split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
      const to = ($('#xferHacdTo') && $('#xferHacdTo').value || '').trim();
      if (!names.length) return log(t('xfer.needNames'), 'warn');
      if (!to) return log(t('xfer.needAddr'), 'warn');
      sub = 'hacd-to';
      req = { main: S.addr, to, names: names.join(',') };
      label = t('xfer.doHacd');
    }

    S.busy = true;
    try {
      log(t('xfer.building'));
      const res = await TX.transfer(sub, req);
      await sendTx(res, label);
    } catch (e) {
      log(t('xfer.fail') + errMsg(e), 'err');
    } finally {
      S.busy = false;
    }
  }

  /* ===================== 工具页 ===================== */

  /** 18 个常用只读视图，点一下把结果打到底部日志 */
  function renderQueryGrid() {
    const grid = $('#queryGrid');
    if (!grid || grid.dataset.built === '1') return;
    grid.dataset.built = '1';

    const items = [
      ['pool_price', '池价'], ['amm_reserves', '池 HAC'], ['amm_reserve_ds', '池 hacds'],
      ['lp_total', 'LP 总量'], ['utilization', '利用率'], ['total_debt', '总债务'],
      ['providers_total', 'HAC 提供者'], ['net_claims', '净债权'], ['reserve_hac', '储备'],
      ['deficit_hac', '赤字'], ['hacd_count', 'HACD 颗数'], ['hacd_score_total', 'HACD 总分'],
      ['hacd_avg_score', 'HACD 均分'], ['hacd_coverage', 'HACD 覆盖率'],
      ['hcut', 'hcut'], ['lcut', 'lcut'], ['borrow_paused', '借款暂停'], ['ref_price_of', '参考价'],
    ];
    grid.innerHTML = items.map(([fn, label]) =>
      `<button class="btn btn-ghost" data-q="${fn}" style="font-size:12px">${label}</button>`).join('');

    grid.querySelectorAll('[data-q]').forEach(b => {
      b.onclick = async () => {
        const fn = b.dataset.q;
        try {
          const v = await API.callView(fn);
          b.title = String(v);
          log(`${fn} = ${v}`, 'ok');
        } catch (e) {
          log(fn + errMsg(e), 'err');
        }
      };
    });
  }

  /** 从索引器取续租批次 */
  let _rentBatches = [];
  async function loadRentBatches() {
    const hint = $('#rentHint');
    if (!hint) return;
    // ⚠ 索引器地址在 CFG（window.HACDS_CONFIG）里，不在 S 里。
    //   原来写 S.cfg.indexer —— S 没有 cfg 字段，点「续租」必抛 TypeError（审计 C-M6）。
    if (!CFG.indexer) { hint.textContent = t('tools.rentNoIdx'); return; }
    hint.textContent = t('tools.rentLoading');
    try {
      const r = await fetch(CFG.indexer.replace(/\/$/, '') + '/rent_batches?max=10')
        .then(x => x.json());
      _rentBatches = r.batches || [];
      const list = $('#rentList');
      if (!_rentBatches.length) {
        list.innerHTML = `<div class="dim" style="font-size:13px">${t('tools.rentEmpty')}</div>`;
        hint.textContent = '';
        $('#btnRentDo').disabled = true;
        return;
      }
      list.innerHTML = _rentBatches.map((b, i) =>
        `<div class="info-row"><span>#${i + 1}</span><span class="mono">klen=${b.klen} · ${b.count} ${t('tools.rentKeys')}</span></div>`).join('');
      hint.textContent = t('tools.rentReady', { n: _rentBatches.length });
      $('#btnRentDo').disabled = false;
    } catch (e) {
      hint.textContent = t('tools.rentFail') + (e.message || e);
    }
  }

  /** 逐批构建续租交易（合约单笔上限 10 键） */
  async function doRent() {
    if (!S.addr) return log(t('acct.locked'), 'err');
    if (!_rentBatches.length) return;
    const b = _rentBatches[0];
    try {
      log(t('tools.rentBuilding'));
      const params = `${b.blob}:bytes,${b.klen}:u128,300:u128`;
      const res = await TX.build('rent_keys', [{ v: b.blob, t: 'bytes' }, { v: b.klen, t: 'u128' }, { v: 300, t: 'u128' }], S.addr, {});
      await sendTx(res, t('tools.rentDo'));
      _rentBatches.shift();
      if (!_rentBatches.length) {
        $('#btnRentDo').disabled = true;
        $('#rentHint').textContent = t('tools.rentDone');
      } else {
        $('#rentHint').textContent = t('tools.rentRemain', { n: _rentBatches.length });
      }
    } catch (e) {
      log(t('tools.rentFail') + errMsg(e), 'err');
    }
  }

})();
