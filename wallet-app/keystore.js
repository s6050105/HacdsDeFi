// 钱包 keystore —— scrypt 派生密钥 + AES-256-GCM 加密，零第三方依赖。
//
// 设计要点：
//  - 私钥（32B）只在主进程内存中解密，永不以明文落盘、永不进渲染进程。
//  - 加密文件是自包含 JSON，可在无本应用时用标准工具解读（见文档说明）。
//  - 支持"密码派生"钱包：Hacash 无 BIP39 助记词，create_by(pass) 即 sha2_256(pass)。
//
// 文件格式（hacds-keystore v1）：
// {
//   "v": 1, "kdf": "scrypt", "n": 2^15, "r": 8, "p": 1, "dklen": 32,
//   "salt": "<hex16>", "iv": "<hex12>", "ct": "<hex>", "tag": "<hex>",
//   "address": "<readable>",   // 便于识别；非机密
//   "created": "<iso8601>", "label": "<可选备注>"
// }

const crypto = require('crypto');

const SCRYPT = { n: 1 << 15, r: 8, p: 1, dklen: 32 };  // ~100ms/次
const AAD = Buffer.from('hacds-keystore-v1');

function deriveKey(password, salt, params) {
  return crypto.scryptSync(Buffer.from(password, 'utf8'), salt, params.dklen, {
    N: params.n, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024,
  });
}

/** 生成随机 32 字节私钥（避开 Hacash 明令拒绝的 0xffffffff 前缀）。 */
function newSecret() {
  for (;;) {
    const b = crypto.randomBytes(32);
    if (!(b[0] === 0xff && b[1] === 0xff && b[2] === 0xff && b[3] === 0xff)) return b;
  }
}

/** 由口令派生私钥：sha2_256(utf8(password))（与 Hacash create_by 一致）。 */
function secretFromPassword(password) {
  return crypto.createHash('sha256').update(Buffer.from(password, 'utf8')).digest();
}

/**
 * 加密一个 32B 私钥。
 * @returns {object} keystore JSON 对象（不含明文）
 */
function encrypt(secret32, password, address) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt, SCRYPT);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(secret32), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1, kdf: 'scrypt', n: SCRYPT.n, r: SCRYPT.r, p: SCRYPT.p, dklen: SCRYPT.dklen,
    salt: salt.toString('hex'), iv: iv.toString('hex'),
    ct: ct.toString('hex'), tag: tag.toString('hex'),
    address: address, created: new Date().toISOString(),
  };
}

/**
 * 解密 keystore。口令错误 / 文件被篡改 → 抛异常（GCM 认证失败）。
 * @returns {Buffer} 32B 私钥
 */
function decrypt(ks, password) {
  if (!ks || ks.v !== 1 || ks.kdf !== 'scrypt') throw new Error('keystore 格式不支持');
  const salt = Buffer.from(ks.salt, 'hex');
  const iv = Buffer.from(ks.iv, 'hex');
  const key = deriveKey(password, salt, { n: ks.n, r: ks.r, p: ks.p, dklen: ks.dklen });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(ks.tag, 'hex'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ks.ct, 'hex')), decipher.final()]);
  } catch {
    throw new Error('密码错误或 keystore 已损坏');
  }
}

/** 解析导入内容：64-hex 私钥（可带 0x），或本应用的 keystore JSON。 */
function classifyImport(text) {
  const t = text.trim();
  if (t.startsWith('{')) {
    let j;
    try { j = JSON.parse(t); } catch { throw new Error('JSON 解析失败'); }
    if (j.v === 1 && j.kdf === 'scrypt') return { type: 'keystore', data: j };
    throw new Error('不是受支持的 keystore 文件');
  }
  const hx = t.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{64}$/.test(hx)) return { type: 'raw', hex: hx.toLowerCase() };
  throw new Error('既不是 64 位 hex 私钥，也不是 keystore JSON');
}

module.exports = { newSecret, secretFromPassword, encrypt, decrypt, classifyImport, SCRYPT };
