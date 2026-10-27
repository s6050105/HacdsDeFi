/* ==========================================================================
   hacds.com — MoneyNex 钱包接入
   职责边界：本模块**只**做「连接 / 请求签名 / 广播」，不构建交易内容。
   官网从不接触私钥。
   ========================================================================== */
(function () {
  'use strict';

  const CFG = window.HACDS_CONFIG;

  let ready = false;
  let address = null;
  const waiters = [];

  /* ---------- 就绪检测 ---------- */

  // MoneyNex 通过全局回调通知就绪
  window.MoneyNexInit = function (info, sdk) {
    ready = true;
    window.__mnxInfo = info || (sdk && sdk.info) || {};
    waiters.splice(0).forEach(fn => fn(true));
    window.dispatchEvent(new CustomEvent('walletready', { detail: window.__mnxInfo }));
  };

  /** 等待钱包就绪（最多 waittime 毫秒） */
  function waitReady(waittime) {
    if (ready && window.MoneyNex) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        const i = waiters.indexOf(done);
        if (i >= 0) waiters.splice(i, 1);
        resolve(false);
      }, waittime || 3000);
      function done(ok) { clearTimeout(timer); resolve(ok); }
      waiters.push(done);
    });
  }

  /** 是否已安装 */
  function isAvailable() {
    return !!(window.MoneyNex && typeof window.MoneyNex.connect === 'function');
  }

  function info() {
    return window.__mnxInfo || (window.MoneyNex && window.MoneyNex.info) || {};
  }

  /* ---------- 连接 ---------- */

  function connect() {
    return new Promise((resolve, reject) => {
      if (!isAvailable()) return reject(new Error('wallet_not_found'));
      window.MoneyNex.connect({}, acc => {
        if (!acc || !acc.address) return reject(new Error('connect_rejected'));
        address = acc.address;
        window.dispatchEvent(new CustomEvent('walletconnected', { detail: address }));
        resolve(acc);
      });
    });
  }

  /** 查询已授权地址（未授权会返回 need_connect） */
  function getWallet() {
    return new Promise((resolve, reject) => {
      if (!isAvailable()) return reject(new Error('wallet_not_found'));
      window.MoneyNex.wallet({}, acc => {
        if (!acc || !acc.address) return reject(new Error(acc && acc.code || 'need_connect'));
        address = acc.address;
        resolve(acc.address);
      });
    });
  }

  function disconnect() {
    address = null;
    window.dispatchEvent(new CustomEvent('walletdisconnected'));
  }

  /* ---------- 签名 + 广播 ---------- */

  /**
   * 请求钱包签名一笔交易体，并（可选）由钱包广播。
   *
   * @param {string} txbody   未签名交易体 hex
   * @param {object} opts     { autosubmit, msglayout, actionId }
   * @returns {Promise<object>} 钱包返回的 { body, hash, hash_with_fee, description, ... }
   */
  function signTx(txbody, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      if (!isAvailable()) return reject(new Error('wallet_not_found'));

      const req = {
        txbody,
        chain_id: 0,                    // 主网
        autosubmit: opts.autosubmit !== false,
      };

      // 让签名页把证书流显示成人类可读的内容，而不是 hex 乱码
      if (opts.msglayout) {
        if (opts.actionId != null) req.action_id = opts.actionId;
        req.msglayout = opts.msglayout;
      }

      window.MoneyNex.signtx(req, res => {
        if (!res) return reject(new Error('sign_no_response'));

        if (res.code === 'need_connect') return reject(new Error('need_connect'));
        if (res.code === 'sign_refused') {
          return reject(new Error(res.err || 'sign_refused'));
        }
        if (res.code === 'submit_failed') {
          // 签名成功但广播失败：把已签名体交回调用方，可自行重试广播
          const e = new Error(res.err || 'submit_failed');
          e.code = 'submit_failed';
          e.body = res.body || res.txbody;
          return reject(e);
        }
        if (res.ret !== 0) {
          return reject(new Error(res.err || ('sign error ' + res.ret)));
        }
        resolve(res);
      });
    });
  }

  /**
   * 证书流（tx_message 126B × n）在钱包签名页的人类可读布局。
   * 证书结构：name(6) + visual_gene(10) + number(8) + score(4) + version(1) + sign(97)
   * 见 HacdsDeFi.fitsh 的 cert_message / cert_sign。
   */
  const HACD_CERT_LAYOUT = [
    ['hacd_name', '钻石名'],
    ['hex', '视觉基因', 10],
    ['u64be', '编号'],
    ['u32be', '评分'],
    ['u8', '证书版本'],
    ['hex', '证书签名', 97],
  ];

  /* ---------- 事件绑定 ---------- */

  window.addEventListener('ACCOUNTS_CHANGED', () => { address = null; });

  window.HacdsWallet = {
    waitReady, isAvailable, info, connect, getWallet, disconnect,
    signTx, HACD_CERT_LAYOUT,
    get address() { return address; },
  };
})();
