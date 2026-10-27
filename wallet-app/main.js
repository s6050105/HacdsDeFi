// HacdsDeFi 控制台 —— Electron 主进程
// 职责：文件对话框、调用 hacds_txbuild.exe 构建/签名交易、HTTP 查询节点与预言机。
// 私钥只在主进程内存中流转（以文件路径形式传给 txbuild），从不进入渲染进程。

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const ks = require('./keystore');
const fee = require('./fee');
const errs = require('./contract-errors');
const hacd = require('./hacd-transfer.js');
const { HacdsIndexer } = require('./indexer');

let win = null;

// 用固定的 ASCII 目录存放配置与钱包，避免中文产品名带来的路径编码问题，
// 也让备份位置可预测：%APPDATA%\HacdsDeFiConsole\
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'HacdsDeFiConsole'));
} catch (e) { /* 保持默认 */ }

// 当前会话解密的私钥（仅主进程内存；进程退出即清空）。null = 未解锁。
let sessionKeyHex = null;
let sessionAddr = null;

// ---- 定位随包二进制 ----
// 打包后二进制是 extraResources 放在 resources/bin 的实体文件；asar 内的路径
// 不能 spawn（不是真实文件），所以打包分支必须走 process.resourcesPath。
function binDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin');
  return path.join(__dirname, 'bin');
}
function txbuildPath() {
  const p = path.join(binDir(), 'hacds_txbuild.exe');
  if (!fs.existsSync(p)) throw new Error('找不到 hacds_txbuild.exe: ' + p);
  return p;
}

// ---- 配置持久化（存 userData，不碰项目目录）----
function cfgFile() { return path.join(app.getPath('userData'), 'config.json'); }
// NSIS 安装语言号 → 应用语言码（供首启默认语言）
const NSIS_LANG = { '2052': 'zh-CN', '1033': 'en', '1055': 'tr' };
function installerLang() {
  if (process.platform !== 'win32') return null;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('reg', ['query',
      'HKCU\Software\HacdsDeFiConsole', '/v', 'InstallerLanguage'],
      { stdio: 'pipe', timeout: 4000 }).toString();
    const m = out.match(/InstallerLanguage\s+REG_SZ\s+(\S+)/i);
    return m ? (NSIS_LANG[m[1]] || null) : null;
  } catch { return null; }
}
function loadCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'));
    // 用户尚未在应用内选过语言 → 用安装时选的语言作为默认
    if (!c.lang) { const il = installerLang(); if (il) c.lang = il; }
    return c;
  } catch {
    const base = { node: 'http://43.251.101.101:8082', oracle: 'http://43.251.101.101:8123',
                   contract: 'T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH' };
    const il = installerLang(); if (il) base.lang = il;
    return base;
  }
}
function saveCfg(cfg) {
  fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2));
  return true;
}

// ---- 交易时间戳（唯一性来源）----
// Hacash Type-3 **没有 nonce / sequence**，交易哈希 = hash_with_fee(
//   ty, timestamp, addrlist, fee, actions, gas_max, ano_mark )
// （protocol/src/codec/tx.rs::tx_hash）。其中唯一能变的就是 timestamp ——
// 同一组操作参数 + 同一个秒级 timestamp ⇒ **逐字节相同** ⇒ 同一个 hash。
// 早先这里一律传 '0'，于是「同样 3 颗钻石、同样的 fee」每次都构造出完全相同的交易，
// 第二次提交必然被节点拒绝：`tx … already exists in height N`（protocol/src/exec/tx.rs:95）。
// 修复：每次构建取当前时间，并保证**本进程内严格单调递增**（同一秒内连发也不会撞）。
// 链上只校验 timestamp 不得超前于当前时间（chain/src/verify.rs:107、engine.rs:788），
// 不校验下限，所以「递增到下一秒再发」是安全的；最多等 1 秒。
let _lastTxTime = 0;
async function nextTxTime() {
  let t = Math.floor(Date.now() / 1000);
  if (t <= _lastTxTime) {
    // 本秒内已经用过 → 等时钟走过下一秒（不能直接 +1，超前时间戳会被节点拒绝）
    const waitMs = (_lastTxTime + 1) * 1000 - Date.now() + 5;
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    t = Math.floor(Date.now() / 1000);
    // 极端情况：系统时钟回拨导致仍未前进，则继续等（上限 5 秒后放弃单调，用当前值）
    for (let i = 0; i < 50 && t <= _lastTxTime; i++) {
      await new Promise(r => setTimeout(r, 100));
      t = Math.floor(Date.now() / 1000);
    }
  }
  _lastTxTime = t;
  return String(t);
}

// 各模式的 argv 布局统一为 <mode> <main> <ts> ...（'sign' / 'addr' 无 ts）。
// 时间戳在这里统一注入，而不是让各调用点自己拼 —— 早先每个调用点都写死 '0'，
// 正是漏改一处就会重新引入「同 hash」的根因。
const TX_MODES_WITH_TS = new Set(['asset', 'deploy', 'call', 'hacd', 'redeem-hacd',
                                  'combo', 'transfer', 'combined']);

// ---- 调 txbuild，收集 stdout ----
// ts 省略时自动分配（见 nextTxTime）；同一笔逻辑交易的多次重试应传入同一个 ts，
// 否则「估算 fee 的中间轮次」会白白消耗掉一串秒级时间戳。
async function runTxbuild(args, env, ts) {
  const argv = (args || []).slice();
  if (TX_MODES_WITH_TS.has(argv[0]) && argv.length >= 3) {
    argv[2] = ts != null ? String(ts) : await nextTxTime();   // 覆盖调用方传入的 ts 占位
  }
  return new Promise((resolve, reject) => {
    let exe;
    try { exe = txbuildPath(); } catch (e) { return reject(e.message); }
    const child = spawn(exe, argv, {
      env: { ...process.env, ...(env || {}) },
      windowsHide: true,
    });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('error', e => reject(e.message));
    child.on('close', code => {
      if (code !== 0) return reject((err || out || `exit ${code}`).trim());
      resolve(out);
    });
  });
}

// 从 txbuild 输出里抽取字段
function field(out, name) {
  const m = out.match(new RegExp('^\\s*' + name + '\\s*=\\s*(.+)$', 'm'));
  return m ? m[1].trim() : null;
}
function parseTxOutput(out) {
  const res = { raw: out };
  res.unsigned = field(out, 'unsigned_tx_hex');
  res.signed = field(out, 'signed_tx_hex');
  res.signedBytes = res.signed ? Math.floor(res.signed.length / 2) : null;
  res.digest = field(out, 'sign_digest');
  res.txbytes = (field(out, 'tx_bytes') || '').match(/\d+/)?.[0] || null;   // 取数字，忽略 "actions=… signers=…" 尾巴
  res.actions = (out.match(/actions\s*=\s*(\d+)/) || [])[1] || null;
  res.selfcheck = field(out, 'selfcheck');
  res.signedCheck = field(out, 'signed_check');
  res.signer = field(out, 'signer');
  res.address = field(out, 'address');
  res.label = (out.match(/^--- (.+?) ---/m) || [])[1] || null;
  return res;
}

// ---- HTTP GET（节点 / 预言机）----
// 【并发闸门】节点对 sandboxcall 有 **每 IP 并发上限**（base/src/api/limiter.rs：
// DEFAULT_PER_IP_CONCURRENCY = 2），超出即立刻返回 `sandbox_per_ip_concurrency_exceeded`。
// 钱包很多面板会一次性并发多个 sandboxcall（协议状态 14 个、AMM 报价 2 个、总览 3 个…），
// 若不加闸门，被拒的请求会随机落到某个字段上 → UI 显示 `—`，且每次刷新失败的字段不同。
// 这里把**所有 sandboxcall** 串行化到单飞（并发 1），既保证成功也保证每次结果一致。
// 非 sandboxcall 请求（/query/balance、预言机 /cert …）不占用该名额，不受影响。
const SANDBOX_CONCURRENCY = 1;
let _sandboxActive = 0;
const _sandboxQueue = [];
function _sandboxAcquire() {
  if (_sandboxActive < SANDBOX_CONCURRENCY) { _sandboxActive++; return Promise.resolve(); }
  return new Promise(res => _sandboxQueue.push(res));
}
function _sandboxRelease() {
  const next = _sandboxQueue.shift();
  if (next) next(); else _sandboxActive--;
}
// 带重试的 GET：针对并发/忙碌类错误做指数退避重试（最多 4 次）。
// 节点拒绝时返回的是 **HTTP 200 + {ret:1,err:"sandbox_..._exceeded"}**，故需在 body 层判定。
const RETRYABLE = /sandbox_(per_ip|global)_concurrency_exceeded|sandbox_busy|state changed|service unavailable/i;
async function httpGetJsonRetry(url, timeoutMs = 15000, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const d = await httpGetJson(url, timeoutMs);
      if (d && d.err && RETRYABLE.test(String(d.err))) { last = d.err; }
      else return d;
    } catch (e) { last = String(e); if (!RETRYABLE.test(last)) throw e; }
    await new Promise(r => setTimeout(r, 80 * Math.pow(2, i)));   // 80/160/320/640ms
  }
  throw new Error(last || '请求失败');
}

// sandboxcall 统一入口：过并发闸门 + 退避重试。**所有**沙箱查询都必须走这里，
// 否则又会出现「刷新间字段随机为空」。返回原始 body（{ret, ret_val} 或 {ret:1, err}）。
async function sandboxGet(url, timeoutMs = 15000) {
  await _sandboxAcquire();
  try { return await httpGetJsonRetry(url, timeoutMs); }
  finally { _sandboxRelease(); }
}

function httpGetJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject('URL 无效: ' + url); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
        }
        try { resolve(JSON.parse(body)); }
        catch { reject('响应不是 JSON: ' + body.slice(0, 200)); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.on('error', e => reject(e.message));
  });
}

// POST（广播/校验），body 为字符串
function httpPost(url, body, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject('URL 无效: ' + url); }
    const lib = u.protocol === 'https:' ? https : http;
    const data = Buffer.from(body);
    const req = lib.request(u, {
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'text/plain', 'Content-Length': data.length },
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); }
        catch { resolve({ ret: res.statusCode, raw: b }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.on('error', e => reject(e.message));
    req.write(data);
    req.end();
  });
}

// ---- IPC ----
ipcMain.handle('cfg:load', () => loadCfg());
ipcMain.handle('cfg:save', (_e, cfg) => saveCfg(cfg));

ipcMain.handle('key:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择私钥文件（64 位 hex）',
    properties: ['openFile'],
    filters: [{ name: 'Key', extensions: ['key', 'hex', 'txt'] }, { name: '全部', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('key:addr', async (_e, p) => {
  const out = await runTxbuild(['addr', p]);
  return parseTxOutput(out).address;
});

// ⚠ H-5：把 http:get 限制在用户配置的「节点 / 索引器 / 预言机」三个端点上。
// 原实现把任意 url 直接透传，渲染层被控时可当内网探测与数据外带通道
// （如读 http://127.0.0.1:<port>/…，再把结果经 buildTx 的错误回显带出）。
function isAllowedEndpoint(u) {
  try {
    const t = new URL(String(u));
    const cfg = loadCfg() || {};
    const allowed = [
      cfg.node, cfg.indexer, cfg.oracle,
      'https://explorer.hacash.org',
    ].filter(Boolean).map(s => { try { return new URL(s).origin; } catch { return null; } }).filter(Boolean);
    // 只比 origin（协议+主机+端口），路径任意
    return allowed.includes(t.origin);
  } catch { return false; }
}

ipcMain.handle('http:get', async (_e, { url }) => {
  try {
    if (!isAllowedEndpoint(url)) return { ok: false, error: 'endpoint not allowed' };
    return { ok: true, data: await httpGetJson(url) };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// Type-3 gas_max 决定费付地址的 HAC 预扣额（gas 预算 × 纯度下限）。
// gas_max=99（预算 111911）约预扣 0.56 HAC；纯转账不触发 VM，可用 1（约 0.000735 HAC）。
// 涉及合约的转账（from/to = 合约）会触发 Permit*/Payable* 钩子，必须保留 99。
// hacds 资产转账是 extra9 动作：每笔约 500+ gas。按笔数选 gas_max，
// 预算取自协议表（50=4065 / 60=7996 / 70=15730 / 80=30944 / 90=60872 / 99=111911）。
function gasByteForAssetCount(n) {
  if (n <= 6) return 50;
  if (n <= 12) return 60;
  if (n <= 24) return 70;
  if (n <= 48) return 80;
  if (n <= 96) return 90;
  return 99;
}

function gasMaxFor(mode, req) {
  const contract = (req && req.contract) || '';
  const isContract = (a) => !!contract && String(a) === contract;
  if (mode === 'transfer') {
    const a = (req && req.args) || [];
    const sub = a[2];
    const addrs = [];
    if (sub === 'hac-to' || sub === 'asset-to' || sub === 'hacd-to') addrs.push(a[3]);
    else if (sub === 'hac-from-to' || sub === 'asset-from-to') { addrs.push(a[3], a[4]); }
    else if (sub === 'hac-from' || sub === 'asset-from') addrs.push(a[3]);
    if (addrs.some(isContract)) return null;   // 触发合约钩子 -> 99
    // TransferAsset* 是 extra9 动作：gas = 动作编码字节数 × 9（约 500+）。
    // gas_max=1（预算 147）会 OutOfGas；50（预算 4065）实测可用。
    if (sub === 'asset-to' || sub === 'asset-from-to' || sub === 'asset-from') return gasByteForAssetCount(1);
    return 1;
  }
  if (mode === 'combo') {
    let spec = req && (req.spec || req.specObject || req.specPath);
    if (typeof spec === 'string') {
      try { spec = JSON.parse(fs.readFileSync(spec, 'utf8')); } catch { spec = null; }
    }
    const acts = (spec && spec.actions) || [];
    if (!acts.length) return null;
    const hasCall = acts.some(x => x && (x.type === 'call' || x.type === 'deploy'));
    const hasContract = acts.some(x => x && (isContract(x.from) || isContract(x.to) || isContract(x.contract)));
    if (hasCall || hasContract) return null;   // 合约调用/钩子 -> 99
    const nAsset = acts.filter(x => x && (x.type === 'asset-to' || x.type === 'asset-from-to' || x.type === 'asset-from')).length;
    return nAsset > 0 ? gasByteForAssetCount(nAsset) : 1;
  }
  return null;
}

// 构建交易：req = { mode, args: [...], keyPath, fee, gasMax }
ipcMain.handle('tx:build', async (_e, req) => {
  const env = {};
  if (sessionKeyHex) {                       // 优先内存私钥，绝不落盘
    env.HACDS_SIGN_KEY_HEX = sessionKeyHex;
    env.HACDS_SIGN_KEY_LABEL = sessionAddr || '<wallet>';
  } else if (req.keyPath) {
    env.HACDS_SIGN_KEY = req.keyPath;
  } else {
    return { ok: false, error: '未解锁钱包，也未指定私钥文件' };
  }
  const mode = req.mode;
  const args = req.args;
  const gm = req.gasMax || gasMaxFor(mode, req);
  if (gm) env.HACDS_GAS_MAX = String(gm);

  try {
    // 手动指定 fee：直接构建
    if (req.fee) {
      env.HACDS_FEE = req.fee;
      const out = await runTxbuild([mode, ...args], env);
      return { ok: true, ...parseTxOutput(out), feeUsed: req.fee, feeAuto: false };
    }
    // 自动估算：迭代到满足节点准入
    const r = await buildWithAutoFee(mode, args, env, req.node);
    return r;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// 迭代构建：先用默认 fee → 读字节数 → 不足则按所需 fee 重建（通常 1~3 轮）。
async function buildWithAutoFee(mode, args, baseEnv, node) {
  const MIN = await fetchMinPurity(node);
  const DEFAULT_FEE = '0.0002';
  // 同一笔逻辑交易的所有估算轮次共用一个时间戳：每次重试都换 ts 会白白吃掉秒数
  // （批量 3 笔 × 最多 6 轮 ≈ 18 秒），而最终只广播最后一轮的结果。
  const ts = await nextTxTime();
  let feeStr = DEFAULT_FEE, rounds = [], out = null;
  for (let i = 0; i < 6; i++) {
    const env = { ...baseEnv, HACDS_FEE: feeStr };
    out = await runTxbuild([mode, ...args], env, ts);
    const parsed = parseTxOutput(out);
    const size = parsed.signed ? parsed.signed.length / 2 : Number(parsed.txbytes || 0);
    rounds.push({ round: i + 1, fee: feeStr, size });
    if (!node || !MIN || fee.isFeeEnough(feeStr, size, MIN)) {
      return { ok: true, ...parsed, feeUsed: feeStr, feeAuto: true,
               minPurity: MIN, sizeUsed: size, rounds };
    }
    feeStr = fee.fee232ToHacString(fee.minFee232(size, MIN));
  }
  // 兜底：用最后一轮结果
  return { ok: true, ...parseTxOutput(out), feeUsed: feeStr, feeAuto: true,
           minPurity: MIN, rounds };
}

// 读节点当前最低手续费纯度；失败返回 null（则跳过自动估算，用默认 fee）
async function fetchMinPurity(node) {
  if (!node) return null;
  try {
    const d = await httpGetJson(node.replace(/\/$/, '') + '/query/fee/average');
    const p = d && (d.purity != null ? d.purity : d.min_fee_purity);
    return p != null ? Number(p) : null;
  } catch { return null; }
}

// 估算预览（不签名）：仅算出该操作在当前节点费率下所需 fee
ipcMain.handle('fee:estimate', async (_e, { node, feeOverride }) => {
  const MIN = await fetchMinPurity(node);
  return { ok: true, minPurity: MIN,
           defaultFee: feeOverride || '0.0002',
           sampleSizes: [74, 114, 200, 424, 10336].map(s => ({
             size: s,
             minFee: MIN ? fee.fee232ToHacString(fee.minFee232(s, MIN)) : null,
           })) };
});

ipcMain.handle('tx:check', async (_e, { node, hex }) => {
  try {
    const u = node.replace(/\/$/, '') + '/util/transaction/check?hexbody=true';
    return { ok: true, data: await httpPost(u, hex) };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ================= 钱包 =================
function walletsDir() {
  const d = path.join(app.getPath('userData'), 'wallets');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// 统一拿当前签名密钥：优先本次会话解密的私钥，其次外部 key 文件路径。
function currentKeyForTx(reqKeyPath) {
  if (sessionKeyHex) return { hex: sessionKeyHex, label: sessionAddr || '<wallet>' };
  if (reqKeyPath) return { path: reqKeyPath };
  return null;
}

ipcMain.handle('wallet:create', async (_e, { kind, password, label }) => {
  try {
    if (!password || password.length < 6) throw new Error('密码至少 6 位');
    let secret;
    if (kind === 'password') {
      if (!label) throw new Error('口令钱包需要填写口令');
      secret = ks.secretFromPassword(label);
    } else {
      secret = ks.newSecret();
    }
    const addr = await addrFromHex(secret.toString('hex'));
    const file = ks.encrypt(secret, password, addr);
    const fn = path.join(walletsDir(), 'wallet-' + addr.slice(0, 10) + '.json');
    fs.writeFileSync(fn, JSON.stringify(file, null, 2));
    sessionKeyHex = secret.toString('hex');   // 创建后即解锁
    sessionAddr = addr;
    return { ok: true, address: addr, file: fn, unlock: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('wallet:import', async (_e, { content, password, label }) => {
  try {
    const cls = ks.classifyImport(content);
    let secret, addr;
    if (cls.type === 'raw') {
      secret = Buffer.from(cls.hex, 'hex');
      if (secret.length !== 32) throw new Error('私钥长度不是 32 字节');
      if (secret[0] === 0xff && secret[1] === 0xff && secret[2] === 0xff && secret[3] === 0xff)
        throw new Error('该私钥以 0xffffffff 开头，Hacash 不支持');
      addr = await addrFromHex(cls.hex);
    } else {
      // keystore：需要原口令解出私钥
      if (!password) throw new Error('导入 keystore 需要输入其口令');
      secret = ks.decrypt(cls.data, password);
      addr = cls.data.address || await addrFromHex(secret.toString('hex'));
    }
    // 是否已有加密落盘文件？没有则用新口令加密保存
    let saved = null;
    if (password && cls.type === 'raw') {
      const file = ks.encrypt(secret, password, addr);
      const fn = path.join(walletsDir(), 'wallet-' + addr.slice(0, 10) + '.json');
      fs.writeFileSync(fn, JSON.stringify(file, null, 2));
      saved = fn;
    }
    sessionKeyHex = secret.toString('hex');
    sessionAddr = addr;
    return { ok: true, address: addr, file: saved, unlock: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('wallet:open', async (_e, { filePath, password }) => {
  try {
    const j = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const secret = ks.decrypt(j, password);
    const addr = j.address || await addrFromHex(secret.toString('hex'));
    sessionKeyHex = secret.toString('hex');
    sessionAddr = addr;
    return { ok: true, address: addr, unlock: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('wallet:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '打开钱包文件', properties: ['openFile'],
    defaultPath: walletsDir(),
    filters: [{ name: 'Wallet', extensions: ['json'] }, { name: '全部', extensions: ['*'] }],
  });
  return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
});

ipcMain.handle('wallet:list', async () => {
  try {
    const d = walletsDir();
    return { ok: true, files: fs.readdirSync(d).filter(f => f.endsWith('.json'))
      .map(f => {
        let a = '';
        try { a = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).address || ''; } catch {}
        return { file: f, path: path.join(d, f), address: a };
      }) };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('wallet:lock', async () => {
  sessionKeyHex = null; sessionAddr = null;
  return { ok: true };
});
ipcMain.handle('wallet:status', async () => {
  return sessionAddr ? { unlocked: true, address: sessionAddr } : { unlocked: false };
});

// 用 hex 私钥派生地址（走 txbuild addr，避免在 JS 重造 secp256k1）
function addrFromHex(hex) {
  return new Promise((resolve, reject) => {
    let exe; try { exe = txbuildPath(); } catch (e) { return reject(e); }
    const c = spawn(exe, ['addr'], {
      env: { ...process.env, HACDS_SIGN_KEY_HEX: hex }, windowsHide: true,
    });
    let out = '', err = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    c.on('close', code => {
      if (code !== 0) return reject((err || out || `exit ${code}`).trim().split('\n')[0]);
      const m = out.match(/address = (\S+)/);
      m ? resolve(m[1]) : reject('无法解析地址');
    });
  });
}

// HACD -> hacds：只需 TransferHacdTo，合约自行链上读基因算分。
//
// ⚠ D-1（上线前审计）：#3000 **已删除证书与预言机**（`HacdsDeFi3000.fitsh`
//   全文 0 处读取 tx_message/blob）。旧实现向预言机逐颗取 126B 证书再塞进
//   交易，在 #3000 下不仅无效，还因预言机已停用而直接报网络错误 →
//   存入功能完全不可用。
//   现在不再取证书，`hacd` 模式不传 certfile（引擎已支持可省略）。
//   `oracle` 参数保留仅为兼容旧调用方签名，不再使用。
ipcMain.handle('tx:redeem', async (_e, req) => {
  const { names, node, keyPath, contract, fee, gasMax, mainAddr } = req;
  try {
    var totalScore = 0, detail = [];
    const env = {};
    if (sessionKeyHex) {
      env.HACDS_SIGN_KEY_HEX = sessionKeyHex;
      env.HACDS_SIGN_KEY_LABEL = sessionAddr || '<wallet>';
    } else if (keyPath) {
      env.HACDS_SIGN_KEY = keyPath;
    } else {
      throw new Error('未解锁钱包，也未指定私钥文件');
    }
    if (gasMax) env.HACDS_GAS_MAX = String(gasMax);
    // #3000：不传 certfile（引擎 hacd 模式第 6 个参数已改为可选）
    const hargs = ['hacd', mainAddr, '0', contract, names.join(',')];
    let res;
    if (fee) { env.HACDS_FEE = fee; res = { ok: true, ...parseTxOutput(await runTxbuild(hargs, env)), feeUsed: fee, feeAuto: false }; }
    else { res = await buildWithAutoFee('hacd', hargs.slice(1), env, node); }
    if (!res.ok) throw new Error(res.error || '构建失败');
    return { ...res, certs: detail, totalScore };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('tx:broadcast', async (_e, { node, hex }) => {
  try {
    const u = node.replace(/\/$/, '') + '/submit/transaction?hexbody=true';
    const d = await httpPost(u, hex);
    // 节点通常以 HTTP 200 + {ret:1, err:"..."} 报错 —— 翻译成人话一并返回
    if (d && d.ret !== undefined && d.ret !== 0) {
      const tr = errs.translateNodeError(d.err || ('ret=' + d.ret));
      // chain=true 表示「这笔交易已经在链上/池里」，调用方应按成功处理
      return { ok: true, data: d, translated: tr.text, hint: tr.hint,
               chain: !!tr.chain, height: tr.height || null };
    }
    return { ok: true, data: d };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ================= v0.2 新增 =================

// ---- 交易体翻译（D22）：节点 /util/transaction/check?description=true ----
ipcMain.handle('tx:translate', async (_e, { node, hex }) => {
  try {
    const u = node.replace(/\/$/, '') + '/util/transaction/check?hexbody=true&description=true&action=true&body=true';
    return { ok: true, data: await httpPost(u, hex) };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- 离线工作流（D23）----
// 构建"未签名交易体"：不注入任何密钥；返回 unsigned_tx_hex + sign_digest。
ipcMain.handle('tx:buildUnsigned', async (_e, req) => {
  const env = {};
  const gm = req.gasMax || gasMaxFor(req.mode, req);
  if (gm) env.HACDS_GAS_MAX = String(gm);
  if (req.fee) env.HACDS_FEE = req.fee;
  const tmp = [];
  try {
    // combo 的规格可直接给对象（写临时文件后用），便于离线构建原子交易
    let args = req.args;
    if (req.mode === 'combo' && req.spec) {
      const specPath = path.join(app.getPath('temp'), 'hacds_combo_u_' + Date.now() + '.json');
      fs.writeFileSync(specPath, JSON.stringify(req.spec));
      tmp.push(specPath);
      args = [...req.args, specPath];
    }
    const out = await runTxbuild([req.mode, ...args], env);
    const p = parseTxOutput(out);
    return { ok: true, ...p, feeUsed: req.fee || null, feeAuto: false };
  } catch (e) { return { ok: false, error: String(e) }; }
  finally { for (const f of tmp) { try { fs.unlinkSync(f); } catch {} } }
});

// 对给定的未签名交易体签名（离线机调用；用当前会话密钥或外部密钥文件）
ipcMain.handle('tx:signRaw', async (_e, { unsignedHex, keyPath }) => {
  const env = {};
  if (sessionKeyHex) {
    env.HACDS_SIGN_KEY_HEX = sessionKeyHex;
    env.HACDS_SIGN_KEY_LABEL = sessionAddr || '<wallet>';
  } else if (keyPath) {
    env.HACDS_SIGN_KEY = keyPath;
  } else {
    return { ok: false, error: '未解锁钱包，也未指定私钥文件' };
  }
  try {
    const out = await runTxbuild(['sign', env.HACDS_SIGN_KEY_HEX ? '<env>' : keyPath, unsignedHex], env);
    const p = parseTxOutput(out);
    return { ok: true, ...p };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- 原子交易 combo（D24）----
// req = { specPath? 或 specObject, mainAddr, contract?, node, fee?, gasMax?, keyPath? }
ipcMain.handle('tx:combo', async (_e, req) => {
  const env = {};
  if (sessionKeyHex) {
    env.HACDS_SIGN_KEY_HEX = sessionKeyHex;
    env.HACDS_SIGN_KEY_LABEL = sessionAddr || '<wallet>';
  } else if (req.keyPath) {
    env.HACDS_SIGN_KEY = req.keyPath;
  } else {
    return { ok: false, error: '未解锁钱包，也未指定私钥文件' };
  }
  const gm = req.gasMax || gasMaxFor('combo', req);
  if (gm) env.HACDS_GAS_MAX = String(gm);
  const tmp = [];
  try {
    // 规格既可直接给对象，也可给路径
    let specPath = req.specPath;
    if (!specPath && req.specObject) {
      specPath = path.join(app.getPath('temp'), 'hacds_combo_' + Date.now() + '.json');
      fs.writeFileSync(specPath, JSON.stringify(req.specObject));
      tmp.push(specPath);
    }
    if (!specPath) throw new Error('缺少 combo 规格');
    const args = [req.mainAddr, '0', specPath];
    let res;
    if (req.fee) { env.HACDS_FEE = req.fee; res = { ok: true, ...parseTxOutput(await runTxbuild(['combo', ...args], env)), feeUsed: req.fee, feeAuto: false }; }
    else { res = await buildWithAutoFee('combo', args, env, req.node); }
    return res;
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    for (const f of tmp) { try { fs.unlinkSync(f); } catch {} }
  }
});

// ---- HACD 赎回（D9）：hacds -> HACD 实物流出 ----
// ⚠ D-1：#3000 不再需要证书，直接 TransferHacdFromTo 驱动 PermitHACD。
ipcMain.handle('tx:redeemHacd', async (_e, req) => {
  const { names, node, keyPath, contract, toAddr, fee, gasMax, mainAddr } = req;
  try {
    var totalScore = 0, detail = [];
    const env = {};
    if (sessionKeyHex) { env.HACDS_SIGN_KEY_HEX = sessionKeyHex; env.HACDS_SIGN_KEY_LABEL = sessionAddr || '<wallet>'; }
    else if (keyPath) { env.HACDS_SIGN_KEY = keyPath; }
    else throw new Error('未解锁钱包，也未指定私钥文件');
    if (gasMax) env.HACDS_GAS_MAX = String(gasMax);

    // #3000：不传 certfile（引擎 redeem-hacd 第 7 个参数已改为可选）
    const hargs = ['redeem-hacd', mainAddr, '0', contract, toAddr, names.join(',')];
    let res;
    if (fee) { env.HACDS_FEE = fee; res = { ok: true, ...parseTxOutput(await runTxbuild(hargs, env)), feeUsed: fee, feeAuto: false }; }
    else { res = await buildWithAutoFee('redeem-hacd', hargs.slice(1), env, node); }
    if (!res.ok) throw new Error(res.error || '构建失败');
    return { ...res, certs: detail, totalScore };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ---- 批量存入 / 批量赎回（D43）：自动拆成「单颗一笔」并逐笔广播 ----
// 为什么必须拆：合约 PayableHACD / PermitHACD 对每颗钻石都要链上重算评分
// （verify_cert → sha3 + verify_signature + diamond_score，约 3,000 resource/颗），
// 而 VM 的 resource 单桶硬上限仅 6,100（与 gas_max 无关）→ 2 颗即 OutOfGas(31)。
// 实测：同 timestamp 的多笔交易 hash 不同，可各自独立进 mempool，互不冲突。
// kind='in'  → TransferHacdTo  （我的钻石 → 合约，记 due 配额）
// kind='out' → TransferHacdFromTo（合约 → toAddr，扣 due 配额）
ipcMain.handle('tx:redeemBatch', async (_e, req) => redeemBatchCore(req));

// ---- HACD 点对点转账（D63）----
// 链上一级转账（kind 6 TransferHacdFromTo），不碰合约、不需要证书。
// 构建/签名由官方 hacash_sdk.wasm 在主进程本地完成，只把 tx_body 交给节点广播。
ipcMain.handle('tx:hacdTransfer', async (_e, req) => hacdTransferCore(req));

async function hacdTransferCore(req) {
  const { toAddr, names, node, fee } = req;
  if (!sessionKeyHex) return { ok: false, error: '未解锁钱包' };
  const list = (Array.isArray(names) ? names : String(names || '').split(/[\s,]+/)).filter(Boolean);
  if (!list.length) return { ok: false, error: '钻石名为空' };
  if (list.length > 200) return { ok: false, error: '一笔最多 200 颗钻石' };

  try {
    // fee 留空 → 按节点费率迭代估算（复用 fee.js，与其它操作一致）
    let feeStr = String(fee || '').trim();
    let feeAuto = false;
    if (!feeStr) {
      // 先用默认值构建一次拿字节数，再按 purity 反推；WASM 构建很快，迭代 1~2 轮足够
      let r = await hacd.buildHacdTransfer({ privkey: sessionKeyHex, toAddr, names: list, fee: '0.0002' });
      const size = r.tx_body.length / 2;
      const MIN = await fetchMinPurity(node);
      if (MIN) {
        feeStr = fee.fee232ToHacString(fee.minFee232(size, MIN));
        r = await hacd.buildHacdTransfer({ privkey: sessionKeyHex, toAddr, names: list, fee: feeStr });
      } else {
        feeStr = '0.0002';
      }
      feeAuto = true;
      return { ok: true, ...r, signed: r.tx_body, feeUsed: feeStr, feeAuto, txbytes: size };
    }
    const r = await hacd.buildHacdTransfer({ privkey: sessionKeyHex, toAddr, names: list, fee: feeStr });
    return { ok: true, ...r, signed: r.tx_body, feeUsed: feeStr, feeAuto: false,
             txbytes: r.tx_body.length / 2 };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function redeemBatchCore(req) {
  const { names, oracle, node, keyPath, contract, toAddr, fee, gasMax, mainAddr, kind } = req;
  const isOut = kind === 'out';
  const items = [];
  const env = {};
  if (sessionKeyHex) { env.HACDS_SIGN_KEY_HEX = sessionKeyHex; env.HACDS_SIGN_KEY_LABEL = sessionAddr || '<wallet>'; }
  else if (keyPath) { env.HACDS_SIGN_KEY = keyPath; }
  else return { ok: false, error: '未解锁钱包，也未指定私钥文件' };
  if (gasMax) env.HACDS_GAS_MAX = String(gasMax);

  // 逐颗：取证书 → 写 126B 证书文件 → 构建（单颗）→ 广播
  const seenHex = new Set();      // 本批已提交的交易体：同一 hex = 同一 hash，重复广播必被拒
  const seenName = new Set();     // 同一颗钻石在一批里只处理一次（前端可能传重名）
  for (const nm of names) {
    const tmp = [];
    try {
      if (seenName.has(nm)) { items.push({ name: nm, ok: false, error: '名单内重复，已跳过' }); continue; }
      seenName.add(nm);

      // ⚠ D-1：#3000 已无证书（合约 0 处读取 tx_message/blob），
      //   这里不再向预言机取证书，直接构建转账动作。
      // 第 2 个参数是 ts 占位，runTxbuild 会用本笔唯一的时间戳覆盖它
      const hargs = isOut
        ? ['redeem-hacd', mainAddr, '0', contract, toAddr, nm]
        : ['hacd', mainAddr, '0', contract, nm];
      let res;
      if (fee) { env.HACDS_FEE = fee; res = { ok: true, ...parseTxOutput(await runTxbuild(hargs, env)), feeUsed: fee, feeAuto: false }; }
      else { res = await buildWithAutoFee(isOut ? 'redeem-hacd' : 'hacd', hargs.slice(1), env, node); }
      if (!res.ok) throw new Error(res.error || '构建失败');

      const hex = res.signed || res.unsigned;
      if (!hex) throw new Error('未得到交易体 hex');
      // 兜底防重：即便上层唯一性失效（例如时间戳被改回固定值），也不把同一笔发两次
      if (seenHex.has(hex)) throw new Error('本批已提交过完全相同的交易，已跳过（交易唯一性构造异常）');
      seenHex.add(hex);

      const b = await httpPost(node.replace(/\/$/, '') + '/submit/transaction?hexbody=true', hex);
      if (b && b.ret === 0) {
        items.push({ name: nm, ok: true, hash: b.hash, bytes: res.txbytes, fee: res.feeUsed });
      } else {
        const raw = (b && (b.err || b.error)) || ('ret=' + (b && b.ret));
        const tr = errs.translateNodeError(raw);
        // 「already exists in height N」说明这笔交易此前已经上链 —— 资产状态已生效，
        // 不是失败。计为成功并标出链上高度，避免用户以为要重发而反复提交。
        if (tr.chain) {
          items.push({ name: nm, ok: true, alreadyOnChain: true, height: tr.height,
                       hash: b && b.hash, bytes: res.txbytes, fee: res.feeUsed,
                       note: tr.text, hint: tr.hint, error: raw });
        } else {
          items.push({ name: nm, ok: false, error: raw, translated: tr.text, hint: tr.hint });
        }
      }
    } catch (e) {
      items.push({ name: nm, ok: false, error: String(e) });
    } finally {
      for (const f of tmp) { try { fs.unlinkSync(f); } catch {} }
    }
    // 轻微节流，避免对节点瞬时并发过高
    await new Promise(r => setTimeout(r, 120));
  }
  const okCount = items.filter(x => x.ok).length;
  const chainCount = items.filter(x => x.alreadyOnChain).length;
  return { ok: true, kind: kind || 'in', total: names.length, succeeded: okCount,
           failed: names.length - okCount, onChain: chainCount, items };
}

// ============================================================================
// 清算模块（D51）：链下索引器（观察台账）+ 金库清扫 + LP 奖励结算
// ----------------------------------------------------------------------------
// 合约无法枚举借款人（键按地址拼、无日志、节点无前缀枚举接口），
// 故用 indexer.js 遍历区块，从 kind=44 且 selector 命中借贷函数的交易里
// 收集「调用者 = 借款人」，再逐个查 loan_status 得实时健康度。
// ============================================================================
let _indexer = null;
function getIndexer(node, contract) {
  const stateFile = path.join(app.getPath('userData'), 'liq_watch.json');
  if (!_indexer || _indexer.node !== (node || '').replace(/\/$/, '') || _indexer.contract !== contract) {
    _indexer = new HacdsIndexer({ node, contract, stateFile, maxBlocksPerRun: 2000 });
  }
  return _indexer;
}

// 服务端索引器地址（可留空 → 纯本地索引）。合约无法枚举借款人，
// 扫链既慢又耗流量；把索引放服务端，钱包只调一次 API。
function indexerUrl(cfg) {
  const u = (cfg && cfg.indexer) ? String(cfg.indexer).trim() : '';
  return u ? u.replace(/\/$/, '') : '';
}
async function srvGet(base, path) {
  return httpGetJson(base + path, 12000);
}

// 同步索引：优先服务端，失败回退本地扫块
ipcMain.handle('liq:sync', async (_e, { node, contract, progress, indexer }) => {
  const base = indexerUrl({ indexer });
  if (base) {
    try {
      const d = await srvGet(base, '/sync');
      return { ok: true, data: d, source: 'server' };
    } catch (e) { /* 回退本地 */ }
  }
  try {
    const ix = getIndexer(node, contract);
    const r = await ix.sync((p) => { try { _e.sender.send('liq:progress', p); } catch {} });
    return { ok: true, data: r, source: 'local' };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// 台账快照（服务端优先）
ipcMain.handle('liq:snapshot', async (_e, { node, contract, indexer }) => {
  const base = indexerUrl({ indexer });
  if (base) {
    try {
      const d = await srvGet(base, '/snapshot');
      if (d && d.ret === 0) return { ok: true, list: d.list || [], source: 'server' };
    } catch (e) { /* 回退 */ }
  }
  try {
    const ix = getIndexer(node, contract);
    const list = await ix.snapshot();
    return { ok: true, list, source: 'local' };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// 手工增删观察地址（同步到服务端）
ipcMain.handle('liq:watch', async (_e, { node, contract, action, address, note, indexer }) => {
  const base = indexerUrl({ indexer });
  if (base) {
    try {
      const d = await srvGet(base, '/watch/' + (action === 'add' ? 'add' : 'remove')
        + '?address=' + encodeURIComponent(address) + (note ? '&note=' + encodeURIComponent(note) : ''));
      if (d && d.ret === 0) return { ok: true, list: d.list || [], source: 'server' };
    } catch (e) { /* 回退 */ }
  }
  try {
    const ix = getIndexer(node, contract);
    if (action === 'add') ix.addAddress(address, note);
    else if (action === 'remove') ix.removeAddress(address);
    return { ok: true, list: ix.listAddresses(), source: 'local' };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// 探测服务端索引器是否可用（UI 显示用）
ipcMain.handle('liq:probe', async (_e, { indexer }) => {
  const base = indexerUrl({ indexer });
  if (!base) return { ok: true, up: false, reason: 'not-configured' };
  try {
    const d = await srvGet(base, '/health');
    return { ok: true, up: !!(d && d.ok), head: d && d.head, watched: d && d.watched };
  } catch (e) { return { ok: true, up: false, reason: String(e) }; }
});

// 金库待清扫额（tre:hac / tre:ds）
ipcMain.handle('liq:treasury', async (_e, { node, contract, caller }) => {
  try {
    const base = (node || '').replace(/\/$/, '');
    const c = caller || contract;
    const call = async (fn, p) => {
      let u = `${base}/query/contract/sandboxcall?contract=${contract}&function=${fn}&caller=${c}`;
      if (p) u += `&params=${encodeURIComponent(p)}`;
      await _sandboxAcquire();
      try { const d = await httpGetJsonRetry(u); return (d && d.ret === 0) ? d.ret_val : null; }
      catch { return null; } finally { _sandboxRelease(); }
    };
    const [hac, ds] = await Promise.all([call('treasury_pending', '0:u128'), call('treasury_pending', '1:u128')]);
    return { ok: true, hac, ds };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- 管理员身份探测（D25）：sandbox 调 set_paused(0)，0=管理员 ----
ipcMain.handle('admin:probe', async (_e, { node, contract, address }) => {
  try {
    const u = `${node.replace(/\/$/, '')}/query/contract/sandboxcall?contract=${contract}`
      + `&function=set_paused&caller=${address}&params=0:u8`;
    const d = await sandboxGet(u);
    if (d.ret !== 0) return { ok: true, isAdmin: false, raw: d };
    return { ok: true, isAdmin: d.ret_val === 0, raw: d };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- 单个只读查询（通用，供渲染层批量调用）----
ipcMain.handle('contract:call', async (_e, { node, contract, fn, caller, params }) => {
  try {
    const q = new URLSearchParams();
    q.set('contract', contract);
    q.set('function', fn);
    if (caller) q.set('caller', caller);
    if (params) q.set('params', params);
    const d = await sandboxGet(`${node.replace(/\/$/, '')}/query/contract/sandboxcall?${q.toString()}`);
    // 查询类：ret_val 是「返回值」而非错误码。只有 ret!=0（带 err）才是真错误。
    if (d.ret !== 0 || d.err) {
      const t = errs.translateNodeError(d.err || ('ret=' + d.ret));
      return { ok: false, error: t.text, hint: t.hint, raw: d, fn, params };
    }
    return { ok: true, data: d, fn, params };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- 资产总览（D10/D17）：HAC / HACD / hacds(三态) / SAT / 其它资产 ----
ipcMain.handle('asset:overview', async (_e, { node, contract, address }) => {
  try {
    const base = node.replace(/\/$/, '');
    // 1) 链上余额（含钻石名 + 全部资产元数据）
    const bal = await httpGetJson(
      `${base}/query/balance?address=${address}&diamonds=true&assets=true&asset_meta=true`);
    const b = (bal.list && bal.list[0]) || {};
    const diamonds = (b.diamonds || '').match(/.{6}/g) || [];
    // 2) 合约内：待领取 hacds(due) + HAC 积分
    const due = await sandboxGet(`${base}/query/contract/sandboxcall?contract=${contract}`
      + `&function=balance_ds&caller=${address}&params=${address}:address`);
    const balHac = await sandboxGet(`${base}/query/contract/sandboxcall?contract=${contract}`
      + `&function=balance_hac&caller=${address}&params=${address}:address`);
    // 3) 链上 hacds 实物（assets 里 serial=2000）
    const assets = (b.assets || []).filter(a => String(a.serial) !== '2000');
    const hacdsOnchain = (b.assets || []).find(a => String(a.serial) === '2000');
    return { ok: true, data: {
      hac: b.hacash || '0:0',
      satoshi: b.satoshi || 0,
      diamondCount: b.diamond || 0,
      diamonds,
      due: due.ret === 0 ? due.ret_val : null,
      hacPoints: balHac.ret === 0 ? balHac.ret_val : null,
      hacdsOnchain: hacdsOnchain ? hacdsOnchain.amount : '0',
      otherAssets: assets,
    } };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- HACD 批量详情（供收藏视图：visual_gene 等）----
ipcMain.handle('hacd:details', async (_e, { node, names }) => {
  try {
    const base = node.replace(/\/$/, '');
    const out = [];
    // 分批并发 10
    for (let i = 0; i < names.length; i += 10) {
      const chunk = names.slice(i, i + 10);
      const rs = await Promise.all(chunk.map(nm =>
        httpGetJson(`${base}/query/diamond?name=${nm}`).catch(() => null)));
      for (const d of rs) if (d && d.name) out.push(d);
    }
    return { ok: true, list: out };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- 协议状态总览（D19）----
ipcMain.handle('protocol:overview', async (_e, { node, contract, address }) => {
  try {
    const base = node.replace(/\/$/, '');
    // 经并发闸门 + 重试；失败返回 null（UI 显示 —），但不再随机丢字段
    const call = async (fn, params, caller) => {
      let u = `${base}/query/contract/sandboxcall?contract=${contract}&function=${fn}`;
      if (caller) u += `&caller=${caller}`;
      if (params) u += `&params=${encodeURIComponent(params)}`;
      await _sandboxAcquire();
      try {
        const d = await httpGetJsonRetry(u);
        return (d && d.ret === 0) ? d.ret_val : null;
      } catch { return null; } finally { _sandboxRelease(); }
    };
    const c = address || contract;
    const [poolHac, poolDs, poolPrice, lpTotal, myLp, pendHac, pendDs,
           stakedHac, stakedDs, treHac, treDs, debt, coll, health] = await Promise.all([
      call('amm_reserves', null, c), call('amm_reserve_ds', null, c),
      call('pool_price', null, c), call('lp_total', null, c),
      call('lp_share_of', `${address}:address`, c),
      call('lp_pending_hac', `${address}:address`, c),
      call('lp_pending_ds', `${address}:address`, c),
      call('total_staked', `0:u128`, c), call('total_staked', `1:u128`, c),
      call('treasury_pending', `0:u128`, c), call('treasury_pending', `1:u128`, c),
      call('loan_debt_of', `${address}:address`, c),
      call('loan_coll_of', `${address}:address`, c),
      call('loan_status', `${address}:address`, c),
    ]);
    return { ok: true, data: {
      poolHac, poolDs, poolPrice, lpTotal, myLp, pendHac, pendDs,
      stakedHac, stakedDs, treHac, treDs, debt, coll, health,
    } };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- 钱包列表增强（D2）----
// ⚠ H-5（上线前审计）：把路径限制在钱包目录内。
// 渲染层一旦被控（H-4、或诱导粘贴恶意 combo JSON），原实现可删/改任意
// 当前用户可写文件。这里统一走 safeWalletPath() 断言。
function safeWalletPath(filePath) {
  const dir = walletsDir();
  const safe = path.resolve(dir, path.basename(String(filePath || '')));
  const root = path.resolve(dir) + path.sep;
  if (!safe.startsWith(root)) throw new Error('invalid wallet path');
  return safe;
}

ipcMain.handle('wallet:rename', async (_e, { filePath, label }) => {
  try {
    const fp = safeWalletPath(filePath);
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    j.label = String(label || '');
    fs.writeFileSync(fp, JSON.stringify(j, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});
ipcMain.handle('wallet:delete', async (_e, { filePath }) => {
  try {
    const fp = safeWalletPath(filePath);
    if (sessionAddr) {
      // 若删除的是当前解锁钱包，先锁定
      const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (j.address === sessionAddr) { sessionKeyHex = null; sessionAddr = null; }
    }
    fs.unlinkSync(fp);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
});
// 批量查钱包余额（HAC + hacds due）
ipcMain.handle('wallet:balances', async (_e, { node, contract, addresses }) => {
  try {
    const base = node.replace(/\/$/, '');
    const out = {};
    for (const a of addresses) {
      let hac = null, due = null;
      try { const b = await httpGetJson(`${base}/query/balance?address=${a}`); hac = b.list && b.list[0] ? b.list[0].hacash : null; } catch {}
      try {
        const d = await sandboxGet(`${base}/query/contract/sandboxcall?contract=${contract}&function=balance_ds&caller=${a}&params=${a}:address`);
        due = d.ret === 0 ? d.ret_val : null;
      } catch {}
      out[a] = { hac, due };
    }
    return { ok: true, data: out };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- 导出私钥明文（D1）：返回当前会话私钥 ----
// 2026-10-22 审计加固：原实现仅由渲染层 confirm() 把关，渲染层一旦被脚本注入即可静默导出。
// 现改为**主进程级确认对话框**（不依赖渲染层），用户必须在系统原生弹窗上确认后才返回。
ipcMain.handle('wallet:exportKey', async () => {
  if (!sessionKeyHex) return { ok: false, error: '钱包未解锁' };
  try {
    const wc = win && !win.isDestroyed() ? win : null;
    const r = await dialog.showMessageBox(wc, {
      type: 'warning',
      buttons: ['取消', '导出私钥'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '导出私钥',
      message: '即将显示私钥明文',
      detail: '私钥一旦泄露，资产将立即面临风险。请确认周围无人偷窥、屏幕未被录制/共享。\n\n地址：' + (sessionAddr || ''),
    });
    if (r.response !== 1) return { ok: false, error: '已取消导出' };
  } catch (e) {
    return { ok: false, error: '导出确认失败：' + String(e) };
  }
  return { ok: true, address: sessionAddr, keyHex: sessionKeyHex };
});

// ---- 窗口 ----
function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'HacdsDeFi 控制台',
    backgroundColor: '#0f1420',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 2026-10-22 审计加固：开启渲染沙箱（preload 只用 require('electron')，兼容）
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);

  // ⚠ H-4（上线前审计）：必须阻止主窗口被导航到非本地页面。
  // contextIsolation + sandbox 只隔离了 Node，**没有限制 preload 在哪个源生效**。
  // 一旦窗口被导航到远端页面，该页面继承完整 window.api（buildTx / broadcast /
  // walletExportKey / walletDelete）→ 攻击者不需要私钥就能转走全部资产。
  //
  // 触发路径真实存在：明文 HTTP 拉取的 HACD/余额数据拼进 innerHTML，
  // MITM 注入 <meta http-equiv="refresh"> 即可导航；CSP 只挡内联脚本，挡不住 meta。
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 禁止 webview 内嵌（本应用不需要）
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // 自检模式：HACDS_SELFTEST=1 时不弹窗，跑一次内部链路后退出（排障 / 打包验证用）。
  if (process.env.HACDS_SELFTEST === '1') return runSelfTest();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

async function runSelfTest() {
  const lines = [];
  try {
    lines.push('packaged = ' + app.isPackaged);
    lines.push('binDir   = ' + binDir());
    const exe = txbuildPath();
    lines.push('txbuild  = ' + exe + '  exists=' + fs.existsSync(exe));
    lines.push('userData = ' + app.getPath('userData'));
    // 1) 真正 spawn 一次 txbuild：随机私钥 -> 地址
    const secret = ks.newSecret();
    const addr = await addrFromHex(secret.toString('hex'));
    lines.push('addr     = ' + addr);
    // 2) 加密往返
    const file = ks.encrypt(secret, 'selftest123', addr);
    const back = ks.decrypt(file, 'selftest123');
    lines.push('keystore = ' + (back.equals(secret) ? 'OK' : 'FAIL'));
    // 3) 落盘钱包
    const fn = path.join(walletsDir(), 'wallet-' + addr.slice(0, 10) + '.json');
    fs.writeFileSync(fn, JSON.stringify(file, null, 2));
    lines.push('saved    = ' + fn);
    // 4) 引擎模式可用性自检：只跑「分发层」，不带参数即可暴露 unknown mode。
    //    历史上曾因 bin/hacds_txbuild.exe 比源码旧，导致批量赎回全部 panic
    //    （`unknown mode redeem-hacd`）而 hacd 正常，属极易漏检的陈旧产物问题。
    const MODES = ['asset', 'deploy', 'call', 'hacd', 'redeem-hacd', 'combo', 'transfer', 'combined'];
    const modeBad = [];
    for (const m of MODES) {
      try {
        const { execFileSync } = require('child_process');
        execFileSync(exe, [m], { stdio: 'pipe', timeout: 8000 });
      } catch (e) {
        const out = String((e && (e.stderr || e.stdout)) || '') + String(e && e.message);
        if (/unknown mode/i.test(out)) modeBad.push(m);
      }
    }
    lines.push('modes    = ' + (modeBad.length ? ('MISSING ' + modeBad.join(',')) : ('OK (' + MODES.length + ')')));

    if (process.env.HACDS_SELFTEST_BATCH === '1') {
      const r = await redeemBatchCore({
        kind: 'in',
        names: (process.env.HACDS_SELFTEST_NAMES || '').split(',').map(s => s.trim()).filter(Boolean),
        oracle: process.env.HACDS_SELFTEST_ORACLE, node: process.env.HACDS_SELFTEST_NODE,
        contract: process.env.HACDS_SELFTEST_CONTRACT, mainAddr: process.env.HACDS_SELFTEST_MAIN,
        keyPath: process.env.HACDS_SELFTEST_KEY, gasMax: 99,
      });
      lines.push('batch    = kind=' + r.kind + ' total=' + r.total + ' ok=' + r.succeeded + ' fail=' + r.failed);
      (r.items || []).forEach(it => lines.push('  - ' + it.name + ' : ' +
        (it.ok ? ('OK ' + String(it.hash).slice(0, 20) + '…') : ('FAIL ' + (it.translated || it.error)))));
    }
    lines.push('RESULT   = ALL OK');
  } catch (e) {
    lines.push('RESULT   = FAIL: ' + (e && e.message ? e.message : e));
  }
  // 写文件 + stdout（打包版双击时看不到 console）
  const out = lines.join('\n');
  try { fs.writeFileSync(path.join(app.getPath('temp'), 'hacds_selftest.txt'), out); } catch {}
  console.log(out);
  app.exit(0);
}
