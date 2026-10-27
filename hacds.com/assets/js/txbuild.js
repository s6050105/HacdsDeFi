/* ==========================================================================
   hacds.com — 交易体构建
   --------------------------------------------------------------------------
   设计决策：**不在浏览器里重新实现合约调用编码**。

   Type-3 交易体涉及：动作编码、selector 计算、参数 pack、fee 定价、gas 预算。
   在 JS 里重写一遍，等于给"链上行为"造了第二份实现，一旦与合约/节点不一致，
   用户签的就是一笔错误的交易，而且现场无法调试。

   因此：构建请求发给后端 txbuild 服务（复用 wallet-app 的
   hacds_txbuild 逻辑，已验证），浏览器只拿回 txbody 交给钱包签名。

   后端接口（需要在 API 代理里暴露）：
     POST /api/build
     { fn, params: [...], main, fee?, gasMax? }
     → { txbody, fee, description? }
   ========================================================================== */
(function () {
  'use strict';

  const CFG = window.HACDS_CONFIG;

  /** i18n 取值（错误文案不能硬编码中文，否则 EN/TR 界面会混出中文） */
  const t = (k, ...a) => {
    let s = (window.I18N && window.I18N.t(k)) || k;
    a.forEach((v, i) => { s = s.replace('{' + i + '}', v); });
    return s;
  };

  function base() {
    return CFG.useLocal ? CFG.localNode : CFG.apiBase;
  }

  /**
   * 请求后端构建交易体。
   *
   * @param {string} fn     合约函数名（如 'swap_hac_to_ds'）
   * @param {Array}  params 参数数组，元素为 {v, t} 或纯字符串（默认 u128）
   * @param {string} main   交易主地址（当前钱包地址）
   * @param {object} opts   { fee, gasMax }
   * @returns {Promise<{txbody: string, fee: string}>}
   */
  async function build(fn, params, main, opts) {
    opts = opts || {};

    const r = await fetch(base() + '/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fn,
        params: (params || []).map(p => {
          if (p && typeof p === 'object') return p.v + ':' + p.t;
          return String(p) + ':u128';
        }).join(','),
        main,
        fee: opts.fee || null,
        gasMax: opts.gasMax || 99,
      }),
    }).then(x => x.json());

    // M-8：把服务端/Worker 的可读原因透出来，而不是只报一个错误码。
    //   build_service_unconfigured → 后端没部署
    //   fn_not_allowed             → 该函数不在白名单（前端传错了）
    //   rate_limited               → 请求太频繁
    if (r.error) {
      const map = {
        build_service_unconfigured: t('tx.buildUnconfigured'),
        fn_not_allowed: t('tx.fnNotAllowed'),
        rate_limited: t('tx.rateLimited'),
        build_failed: t('tx.buildFailed') + (r.detail || ''),
        engine_missing: t('tx.engineMissing'),
      };
      throw new Error(map[r.error] || (r.detail ? r.error + ': ' + r.detail : r.error));
    }
    if (!r.txbody) throw new Error(t('tx.emptyTxbody'));
    return r;
  }

  /**
   * 当前块高 + 窗口 → deadline 参数。
   * 合约比较的是 block_height（不是时间戳）。
   */
  const DEADLINE_WINDOW = 3600;   // 块 ≈ 5 小时

  async function deadline() {
    try {
      const h = await window.HacdsAPI.blockHeight();
      return h + DEADLINE_WINDOW;
    } catch (e) {
      return 0;   // 取不到就不检查（合约里 0 = 跳过）
    }
  }

  /* ---------- 具体操作 ---------- */

  // 兑换：HAC → hacds
  async function swapHacToDs(main, hacInZhu, minOut, deadlineBlock) {
    return build('swap_hac_to_ds', [
      { v: hacInZhu, t: 'u128' },
      { v: minOut || 0, t: 'u128' },
      { v: deadlineBlock || 0, t: 'u128' },
    ], main, { gasMax: 99 });
  }

  // 兑换：hacds → HAC
  async function swapDsToHac(main, dsInAtoms, minOutZhu, deadlineBlock) {
    return build('swap_ds_to_hac', [
      { v: dsInAtoms, t: 'u128' },
      { v: minOutZhu || 0, t: 'u128' },
      { v: deadlineBlock || 0, t: 'u128' },
    ], main, { gasMax: 99 });
  }

  // 加池
  async function addLiquidity(main, hacZhu, dsAtoms, minShare, deadlineBlock) {
    return build('add_liquidity', [
      { v: hacZhu, t: 'u128' },
      { v: dsAtoms, t: 'u128' },
      { v: minShare || 0, t: 'u128' },
      { v: deadlineBlock || 0, t: 'u128' },
    ], main, { gasMax: 99 });
  }

  // 撤池
  async function removeLiquidity(main, shareBurn, minHacOut, minDsOut, deadlineBlock) {
    return build('remove_liquidity', [
      { v: shareBurn, t: 'u128' },
      { v: minHacOut || 0, t: 'u128' },
      { v: minDsOut || 0, t: 'u128' },
      { v: deadlineBlock || 0, t: 'u128' },
    ], main, { gasMax: 99 });
  }

  // 借贷
  async function borrow(main, hacZhu) {
    return build('loan_borrow', [{ v: hacZhu, t: 'u128' }], main, { gasMax: 99 });
  }
  async function repay(main, hacZhu) {
    return build('loan_repay', [{ v: hacZhu, t: 'u128' }], main, { gasMax: 99 });
  }
  async function addCollateral(main, dsAtoms) {
    return build('loan_add_collateral', [{ v: dsAtoms, t: 'u128' }], main, { gasMax: 99 });
  }

  // 领 LP 奖励
  async function harvest(main) {
    return build('lp_harvest', [], main, { gasMax: 99 });
  }

  // ── HACD 存入 / 赎回：官网暂不支持 ────────────────────────────────
  //
  // ⚠ D-1（上线前审计）：旧实现调用 `deposit_hacd` / `redeem_hacd`，
  //   但**这两个合约函数根本不存在**。HACD 收支是抽象钩子
  //   （`PayableHACD` / `PermitHACD`），必须由 `TransferHacdTo` /
  //   `TransferHacdFromTo` 转账动作触发，属于 **Type-3 多动作交易**。
  //
  //   官网的 build() 只走后端 `/api/build`，而该端点尚不存在（M-8）；
  //   即使存在，它也只产出单动作 ContractMainCall，构不出 HACD 转账。
  //
  //   因此官网**明确不支持**这两项，直接返回可读错误，而不是让用户
  //   拿到一个必然失败的交易。PC 钱包与 Android 已适配无证书路径。
  async function mintHacd(main, name) {
    return {
      ok: false,
      error: t('tx.mintUnsupported'),
      unsupported: true,
    };
  }

  async function redeemHacd(main, name) {
    return {
      ok: false,
      error: t('tx.redeemUnsupported'),
      unsupported: true,
    };
  }

  /* ---------- 单位换算 ---------- */

  /** HAC 文本 → zhu（整数，字符串安全） */
  function hacToZhu(s) {
    if (!s) return '0';
    const str = String(s).trim();
    if (!/^\d*\.?\d*$/.test(str) || str === '.' || str === '') return null;
    const [i, f = ''] = str.split('.');
    const frac = (f + '00000000').slice(0, 8);
    const v = BigInt(i || '0') * 100000000n + BigInt(frac);
    return v.toString();
  }

  /** zhu → HAC 文本 */
  function zhuToHac(z) {
    if (z == null) return '0';
    const v = BigInt(String(z));
    const i = v / 100000000n;
    const f = (v % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
    return f ? i.toString() + '.' + f : i.toString();
  }

  // ── hacds 数量换算 ──────────────────────────────────────────────
  // 【#3000 decimal=0】1 atom = 1 hacds，**atoms 原值就是个数**。
  // 旧实现按 #2000 的 decimal=8 做 ÷1e8 / ×1e8，在 #3000 下会让用户输入
  // 放大 1 亿倍（输入 100 → 上链 10,000,000,000），属于资金级错误。
  // 现在两个函数都是**恒等映射**，只做格式校验与规范化。

  /** atoms → 显示值（decimal=0：原值即个数） */
  function atomsToDisplay(a) {
    if (a == null) return '0';
    return BigInt(String(a)).toString();
  }

  /** 显示值 → atoms（decimal=0：原值即个数，不接受小数） */
  function displayToAtoms(s) {
    if (!s) return '0';
    const str = String(s).trim();
    // decimal=0 只接受非负整数；带小数点的输入直接判非法（不静默截断）
    if (!/^\d+$/.test(str)) return null;
    return BigInt(str).toString();
  }

  window.HacdsTx = {
    build, deadline, DEADLINE_WINDOW,
    swapHacToDs, swapDsToHac, addLiquidity, removeLiquidity,
    borrow, repay, addCollateral, harvest, mintHacd, redeemHacd,
    hacToZhu, zhuToHac, atomsToDisplay, displayToAtoms,
  };
})();
