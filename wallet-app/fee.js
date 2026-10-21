// 手续费估算 —— 纯函数，可独立测试。
//
// 规则（Hacash Type-3）：
//   纯度 purity = fee(单位 u232) / billing_size(字节)
//   节点准入要求 purity >= min_purity（节点配置，当前主网 ≈ 6.024e9）
//   ⇒ 满足准入的最小 fee = ceil(min_purity × size × headroom)
//
// 由于 fee 增大也会略微增大编码后的交易字节数，采用**迭代**：构建 → 读字节数
// → 算所需 fee → 不足则提高 fee 重建，直至收敛（通常 1~2 轮）。

const U232_PER_HAC = 1e16;           // 1 HAC = 1:248，fee 以 u232 计 => ×1e16
const HEADROOM_NUM = 13n;            // +30% 余量
const HEADROOM_DEN = 10n;

/** 给定字节数与最低纯度，返回所需最小 fee（u232，BigInt，向上取整）。 */
function minFee232(sizeBytes, minPurity) {
  const s = BigInt(Math.max(0, Math.ceil(sizeBytes)));
  const p = BigInt(String(minPurity));
  // ceil(p * s * 13 / 10)
  const num = p * s * HEADROOM_NUM;
  return (num + HEADROOM_DEN - 1n) / HEADROOM_DEN;
}

/** u232 整数 → HAC 小数字符串（足够精度，去掉尾随 0）。 */
function fee232ToHacString(v232) {
  // 保留 12 位小数足够表达 u232（1e16 对应 1 HAC）
  let s = (Number(v232) / U232_PER_HAC).toFixed(12);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '' ? '0' : s;
}

/** HAC 金额字符串 → u232（BigInt），用于比较。 */
function hacStringTo232(str) {
  const t = String(str).trim();
  const [int, frac = ''] = t.split('.');
  const f = (frac + '0'.repeat(16)).slice(0, 16);   // 16 位 = 1e16
  return BigInt(int || '0') * BigInt(1e16) + BigInt(f || '0');
}

/** 判定 fee 是否已满足 size 下的准入。 */
function isFeeEnough(feeHac, sizeBytes, minPurity) {
  return hacStringTo232(feeHac) >= minFee232(sizeBytes, minPurity);
}

module.exports = { minFee232, fee232ToHacString, hacStringTo232, isFeeEnough, U232_PER_HAC };
