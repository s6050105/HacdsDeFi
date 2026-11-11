'use strict';
// ============================================================================
// HACD 点对点转账 —— 官方 hacash_sdk.wasm 的主进程封装
//
// 为什么用官方 WASM 而不是自研：
//   HACD 点对点是链上一级转账（kind 6 TransferHacdFromTo），**不碰合约、不需要证书**。
//   官方钱包自带这个能力，本地签名后只把 tx_body 交给节点广播。我们复用同一份 SDK，
//   交易字节与官方钱包一致。
//
// 安全边界（与现有 hacds_txbuild 同一条路）：
//   私钥只在主进程内存中出现一次，直接喂给 WASM；不经渲染层、不落盘、不出网。
//   WASM 侧只拿到私钥字符串，签名在 WASM 内部完成。
//
// 引用来源：https://github.com/hacash/wallet
//   static/webwallet/lib/hacash_sdk.js
//   static/webwallet/lib/hacash_sdk.zip → hacash_sdk.wasm
// ============================================================================

const fs = require('fs');
const path = require('path');

let _wasm = null;        // 已初始化的 wasm-bindgen 模块
let _initPromise = null; // 防并发重复初始化

/** 加载并初始化官方 SDK（幂等）。 */
async function ensureSdk() {
  if (_wasm) return _wasm;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const dir = path.join(__dirname, 'vendor');
    const gluePath = path.join(dir, 'hacash_sdk.js');
    const wasmPath = path.join(dir, 'hacash_sdk.wasm');
    if (!fs.existsSync(gluePath)) throw new Error('缺少 vendor/hacash_sdk.js');
    if (!fs.existsSync(wasmPath)) throw new Error('缺少 vendor/hacash_sdk.wasm');

    // glue 是 wasm-bindgen 的浏览器产物，但只用到了 document.currentScript 推导
    // wasm 路径（有 typeof 守卫）。这里显式传 undefined，让它走「显式 input」分支，
    // 我们再直接喂 wasm 字节。
    const src = fs.readFileSync(gluePath, 'utf8');
    const sandboxModule = { exports: {} };
    const factory = new Function(
      'module', 'exports', 'require', 'document', 'location',
      src + '\nreturn wasm_bindgen;'
    );
    const wasmBindgen = factory(sandboxModule, sandboxModule.exports, require, undefined, undefined);

    const bytes = fs.readFileSync(wasmPath);
    await wasmBindgen(bytes);   // 走 __wbg_load(bytes) → WebAssembly.instantiate

    for (const fn of ['create_account_by', 'hac_to_mei', 'hacd_transfer']) {
      if (typeof wasmBindgen[fn] !== 'function') {
        throw new Error('hacash_sdk.wasm 缺少导出 ' + fn);
      }
    }
    _wasm = wasmBindgen;
    return _wasm;
  })();

  try {
    return await _initPromise;
  } catch (e) {
    _initPromise = null;   // 失败可重试
    throw e;
  }
}

/**
 * 构建 HACD 点对点转账（本地签名）。
 * @param {object} req
 *   privkey     付款地址私钥（64 hex；与本钱包 keystore 解锁后拿到的形态一致）
 *   toAddr      收款地址
 *   names       钻石名数组或逗号分隔字符串
 *   fee         HAC 小数字符串，如 '0.0004'；留空则由调用方先算好再传入
 * @returns {{tx_body:string, tx_hash:string, diamond_count:number, diamonds:string,
 *            fee:string, payment_address:string, collection_address:string}}
 */
// 转账交易的时间戳：取当前秒，并保证**本进程内严格单调递增**。
// 与 main.js 的 nextTxTime 同构（那里是 argv 注入，这里是 SDK 参数）。
// 链上只校验"时间戳不得超前于当前时间"，不校验下限，所以本秒用过后
// 只能等时钟走进下一秒，不能直接 +1。
let _lastTransferTs = 0n;
async function nextTransferTimestamp() {
  let t = BigInt(Math.floor(Date.now() / 1000));
  if (t <= _lastTransferTs) {
    const waitMs = Number(_lastTransferTs + 1n) * 1000 - Date.now() + 5;
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    t = BigInt(Math.floor(Date.now() / 1000));
    // 系统时钟回拨兜底：最多再等 5 秒
    for (let i = 0; i < 50 && t <= _lastTransferTs; i++) {
      await new Promise(r => setTimeout(r, 100));
      t = BigInt(Math.floor(Date.now() / 1000));
    }
  }
  _lastTransferTs = t;
  return t;
}

async function buildHacdTransfer(req) {
  const privkey = String(req.privkey || '').trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(privkey)) throw new Error('私钥格式不对（应为 64 位 hex）');

  const toAddr = String(req.toAddr || '').trim();
  if (!toAddr) throw new Error('收款地址为空');

  const names = (Array.isArray(req.names) ? req.names : String(req.names || '').split(/[\s,]+/))
    .map(s => String(s).trim().toUpperCase()).filter(Boolean);
  if (!names.length) throw new Error('钻石名为空');
  if (names.length > 200) throw new Error('一笔最多 200 颗钻石');

  const feeHac = String(req.fee == null ? '' : req.fee).trim();

  const sdk = await ensureSdk();

  // fee：官方要求「mei 小数字符串」。经实测：传已算好的 HAC 小数字符串即可（内部做 Amount 解析）。
  const fee = feeHac || '0.0002';

  // 每次构建都用新的时间戳，避免同参数重复提交撞上同一 hash
  const timestamp = await nextTransferTimestamp();

  // chain_id: 0 = 主网
  // ⚠ timestamp 传 0n **不是**"让 SDK 取当前时间"，而是字面量 0。
  //   实测：同样的钻石 + 同样的 fee + 同样的收款地址，ts=0n 连续两次会得到
  //   **逐字节相同**的交易（hash 也相同），节点会以
  //   `tx <hash> already exists in height N` 拒绝第二次提交。
  //   Hacash Type-3 没有 nonce，timestamp 是唯一的自然变化源。
  //   注意：chain_id / timestamp 必须是 BigInt，否则 wasm-bindgen 报
  //         "Cannot convert 0 to a BigInt"
  const raw = sdk.hacd_transfer(
    0n,                      // chain_id（主网）
    privkey,                 // from_pass（实测：私钥 hex 与口令等价）
    privkey,                 // fee_pass（同一地址付手续费）
    toAddr,
    names.join(','),
    fee,
    timestamp                // 真实秒级时间戳（见 nextTransferTimestamp）
  );

  const out = JSON.parse(raw);
  if (out.error) throw new Error(out.error);
  if (!out.tx_body) throw new Error('SDK 未返回 tx_body');

  return {
    tx_body: out.tx_body,
    tx_hash: out.tx_hash,
    diamond_count: out.diamond_count,
    diamonds: out.diamonds,
    fee: out.fee,
    payment_address: out.payment_address || out.paymenta_ddress,
    collection_address: out.collection_address,
  };
}

/** 计算「默认 fee」= 0.0002 HAC × 钻石颗数（用户习惯的余量公式）。 */
function defaultFeeFor(count) {
  const n = Math.max(1, Number(count) || 1);
  return (0.0002 * n).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

module.exports = { ensureSdk, buildHacdTransfer, defaultFeeFor, nextTransferTimestamp };
