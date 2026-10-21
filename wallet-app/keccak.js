'use strict';
// ============================================================================
// 纯 JS SHA3-256（Keccak-f[1600]，FIPS 202 的 SHA3 填充 0x06）
// ----------------------------------------------------------------------------
// 为什么不用 Node 的 crypto：
//   **Electron 的 Node 运行时不含 sha3-256**（`Digest method not supported`），
//   而独立 Node 支持。索引器需要 sha3 来算合约函数 selector，若依赖
//   crypto.createHash('sha3-256') 会导致打包后的应用启动即崩。
// 该实现零依赖、纯运算，Node / Electron 行为一致。
// 已验证：'loan_borrow' → a4fea537、'loan_liquidate' → 3e403fb8，
//   与 txbuild 实际生成的交易字节一致。
// ============================================================================

// 24 轮常量
const RC = [
  0x00000001n, 0x00008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const M64 = (1n << 64n) - 1n;

function rotl64(x, n) {
  if (n === 0) return x;
  const nn = BigInt(n);
  return ((x << nn) | (x >> (64n - nn))) & M64;
}

function keccakF(st) {
  for (let round = 0; round < 24; round++) {
    // theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = st[x][0] ^ st[x][1] ^ st[x][2] ^ st[x][3] ^ st[x][4];
    const D = new Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) st[x][y] ^= D[x];
    // rho + pi
    const B = Array.from({ length: 5 }, () => new Array(5).fill(0n));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      B[y][(2 * x + 3 * y) % 5] = rotl64(st[x][y], ROT[x][y]);
    }
    // chi
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      st[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y] & M64) & B[(x + 2) % 5][y]);
    }
    // iota
    st[0][0] ^= RC[round];
  }
}

// SHA3-256：rate = 136 字节，填充 0x06 ... 0x80
function sha3_256(input) {
  const rate = 136;
  let msg = (input instanceof Uint8Array) ? input : new Uint8Array(input);
  const padded = new Uint8Array(Math.ceil((msg.length + 1) / rate) * rate);
  padded.set(msg);
  padded[msg.length] ^= 0x06;
  padded[padded.length - 1] ^= 0x80;

  const st = Array.from({ length: 5 }, () => new Array(5).fill(0n));
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      const x = i % 5, y = Math.floor(i / 5);
      st[x][y] ^= lane;
    }
    keccakF(st);
  }
  // 输出 32 字节
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const x = i % 5, y = Math.floor(i / 5);
    let lane = st[x][y];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

// 合约函数 selector = sha3_256(name)[0:4] 的 hex
function fnSelectorHex(name) {
  const d = sha3_256(new TextEncoder().encode(name));
  return Array.from(d.subarray(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
}

module.exports = { sha3_256, fnSelectorHex };
