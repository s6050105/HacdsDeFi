'use strict';
// ============================================================================
// HacdsDeFi 链上索引器（清算模块的数据源）
// ----------------------------------------------------------------------------
// 为什么需要它：合约**无法枚举借款人** —— 借款账目是 loan:debt:<addr> 这样
// 按地址拼键存的，合约不写日志、节点也没有按前缀枚举合约 KV 的接口。
// 所以只能**遍历区块**，从历史交易里把调用过借贷函数的地址收集成「观察台账」，
// 再逐个查 loan_status 拿实时健康度。
//
// 已验证的链上原语（2026-10-21，真机主网）：
//   1) /query/block/intro?height=N&tx_hash_list=true   → 块内交易哈希列表
//   2) /query/transaction?hash=H&action=true           → 结构化动作 [{kind,...}]
//   3) 合约调用 kind=44，其 codes 里含 selector = sha3_256(函数名)[0:4]
//      （字节码形态 09 14 01 <sig4> ee；已用 txbuild 实际生成的交易 3/3 验证）
//
// 设计取舍：
//   - 只扫「我们合约」的 kind=44 调用（用 selector 白名单过滤），不解析整链
//   - 增量：记录 lastScannedHeight，只扫新增块
//   - 台账落盘 JSON，可手动增删（合约早期无历史时可手工补地址）
// ============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { fnSelectorHex } = require('./keccak');   // 纯 JS sha3（Electron 的 crypto 不含 sha3-256）

// ---- 借贷相关函数 → selector（sha3_256(name)[0:4]）----
const LOAN_FNS = [
  'loan_borrow', 'loan_repay', 'loan_liquidate',
  'loan_add_collateral', 'loan_status', 'loan_debt_of', 'loan_coll_of',
];
// 这些函数在**合约上**被调用 ⇒ 调用者(tx.main)就是借款人
const fnSelector = (name) => fnSelectorHex(name);
const LOAN_SELECTORS = Object.fromEntries(LOAN_FNS.map(f => [fnSelector(f), f]));

function httpGetJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('bad url')); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('not json')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// 解析 kind=44 的 codes，返回命中的函数名（未命中返回 null）
function matchContractFn(codesHex) {
  const hx = String(codesHex || '').replace(/^0x/i, '').replace(/\s+/g, '').toLowerCase();
  if (!hx) return null;
  for (const [sig, name] of Object.entries(LOAN_SELECTORS)) {
    if (hx.includes(sig)) return name;
  }
  return null;
}

class HacdsIndexer {
  constructor(opts) {
    this.node = (opts.node || '').replace(/\/$/, '');
    this.contract = opts.contract;
    this.stateFile = opts.stateFile;      // 台账落盘路径
    this.maxBlocksPerRun = opts.maxBlocksPerRun || 2000;
    this.watch = {};                      // addr -> {first, last, calls, fns}
    this.lastScanned = 0;
    this.load();
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      this.watch = j.watch || {};
      this.lastScanned = j.lastScanned || 0;
    } catch { /* 首次运行 */ }
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(
        { watch: this.watch, lastScanned: this.lastScanned, updatedAt: Date.now() }, null, 2));
      return true;
    } catch { return false; }
  }

  addAddress(addr, note) {
    if (!addr) return false;
    const w = this.watch[addr] || (this.watch[addr] = { first: 0, last: 0, calls: 0, fns: {}, manual: true });
    if (note) w.note = note;
    w.manual = true;
    this.save();
    return true;
  }
  removeAddress(addr) { if (this.watch[addr]) { delete this.watch[addr]; this.save(); return true; } return false; }
  listAddresses() { return Object.keys(this.watch); }

  // 扫描 [from, to] 高度区间，收集调用过本合约借贷函数的地址
  async scanRange(from, to, onProgress) {
    let scanned = 0, found = 0;
    for (let h = from; h <= to; h++) {
      let intro;
      try { intro = await httpGetJson(`${this.node}/query/block/intro?height=${h}&tx_hash_list=true`); }
      catch { continue; }
      const hashes = intro.tx_hash_list || [];
      for (const th of hashes) {
        let d;
        try { d = await httpGetJson(`${this.node}/query/transaction?hash=${th}&action=true`); }
        catch { continue; }
        const main = d.main_address;
        for (const a of (d.actions || [])) {
          if (a.kind !== 44) continue;
          // 只认打给我们合约的调用：codes 里含借贷函数 selector
          const fn = matchContractFn(a.codes);
          if (!fn) continue;
          // 进一步确认目标合约（有些 kind=44 的 codes 不带目标地址，用 main+selector 已足够）
          const w = this.watch[main] || (this.watch[main] = { first: h, last: h, calls: 0, fns: {} });
          w.first = w.first ? Math.min(w.first, h) : h;
          w.last = Math.max(w.last || 0, h);
          w.calls += 1;
          w.fns[fn] = (w.fns[fn] || 0) + 1;
          found++;
        }
      }
      scanned++;
      if (onProgress && scanned % 50 === 0) onProgress({ h, scanned, found });
    }
    return { scanned, found };
  }

  // 增量扫描到链尖
  async sync(onProgress) {
    const head = (await httpGetJson(`${this.node}/query/block/height/latest`)).height;
    const from = this.lastScanned ? this.lastScanned + 1 : Math.max(1, head - this.maxBlocksPerRun);
    const to = Math.min(head, from + this.maxBlocksPerRun - 1);
    if (from > to) return { ok: true, head, from: 0, to: 0, scanned: 0, found: 0, watched: this.listAddresses().length };
    // 首次运行按窗口回溯；之后逐块增量
    const start = this.lastScanned ? from : Math.max(1, head - this.maxBlocksPerRun);
    const r = await this.scanRange(start, head, onProgress);
    this.lastScanned = head;
    this.save();
    return { ok: true, head, from: start, to: head, ...r, watched: this.listAddresses().length };
  }

  // 对台账内每个地址查实时借贷状态
  async snapshot() {
    const out = [];
    for (const addr of this.listAddresses()) {
      const call = async (fn, params) => {
        let u = `${this.node}/query/contract/sandboxcall?contract=${this.contract}&function=${fn}&caller=${addr}`;
        if (params) u += `&params=${encodeURIComponent(params)}`;
        try { const d = await httpGetJson(u); return d.ret === 0 ? d.ret_val : null; }
        catch { return null; }
      };
      const [health, debt, coll] = await Promise.all([
        call('loan_status', `${addr}:address`),
        call('loan_debt_of', `${addr}:address`),
        call('loan_coll_of', `${addr}:address`),
      ]);
      const w = this.watch[addr] || {};
      // 合约 loan_status 语义（HacdsDeFi.fitsh:1382）：
      //   0        = 无借贷且无抵押
      //   999      = 有抵押但无债务（安全）
      //   其它     = coll_hac × 100 / debt（抵押率×100）
      // 清算门槛：合约 loan_liquidate 要求 debt > coll/COLL_RATIO(2) 才放行，
      // 即 coll_hac/debt < 2 ⟺ health < 200。故：
      //   可清算 ⟺ 0 < health < 200
      const h = health == null ? null : Number(health);
      const hasDebt = Number(debt || 0) > 0;
      const liquidatable = h != null && hasDebt && h > 0 && h < 200;
      out.push({
        address: addr, health: h, debt, coll,
        liquidatable,
        noLoan: !hasDebt,
        collRatio: (h == null || h === 0 || h === 999) ? null : h / 100,
        first: w.first, last: w.last, calls: w.calls, fns: w.fns || {}, manual: !!w.manual, note: w.note,
      });
    }
    out.sort((a, b) => (Number(b.liquidatable) - Number(a.liquidatable)) || ((a.health ?? 1e9) - (b.health ?? 1e9)));
    return out;
  }
}

module.exports = { HacdsIndexer, matchContractFn, LOAN_SELECTORS, fnSelector };
