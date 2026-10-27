'use strict';
// 错误码翻译 —— 把 HacdsDeFi 合约的 `return N` 与节点/沙箱的英文错误翻成中文。
//
// 合约用非零整数表示失败（0=成功）。本表从 `hacds_exchange/HacdsDeFi.fitsh`
// 源码逐函数提取（含上下文推断），覆盖常用用户操作与全部钩子。
// 未收录的码：兜底显示"操作失败（合约错误码 N）"，并保留原始返回。

// ---- 合约返回码： { 函数名: { 码: "说明" } } ----
const CONTRACT_CODES = {
  // ===== 兑换 =====
  swap_hac_to_ds: {
    2:  '兑换量为 0',
    11: 'HAC 积分不足（先“充 HAC”再兑换）',
    20: '流动性池为空（尚无 LP，无法兑换）',
    21: '滑点保护触发：实际得到低于你设定的下限（可放宽 min_out）',
    22: '兑换量过大，超出池子储备',
    59: '交易已过期（deadline 已过），请重新签名',
  },
  swap_ds_to_hac: {
    11: '待领取 hacds（due 配额）不足',
    20: '流动性池为空',
    21: '滑点保护触发（可放宽 min_out）',
    22: '兑换量过大，超出池子储备',
    59: '交易已过期（deadline 已过），请重新签名',
  },

  // ===== 流动性 =====
  add_liquidity: {
    2:  '投入量为 0',
    11: '注入所需的 HAC 积分或 hacds 配额不足',
    23: '池状态异常（份额尺度已定但份额归零，已拒绝以防重置）',
    24: '注入量太小，算得 LP 份额为 0',
    26: '单侧投入超出上限，或首注份额过小（需大于死份额 1000）',
    56: '滑点保护触发：实际份额低于 min_share（池子可能被抢先交易）',
    59: '交易已过期（deadline 已过），请重新签名',
  },
  remove_liquidity: {
    2:  '份额为 0',
    25: 'LP 份额不足',
    56: '滑点保护触发：取回的 HAC 或 hacds 低于设定下限',
    59: '交易已过期（deadline 已过），请重新签名',
  },
  lp_harvest: {
    1: '合约已暂停',
  },

  // ===== 借贷 =====
  loan_add_collateral: {
    1:  '合约已暂停',
    11: '待领取 hacds（due 配额）不足以作为抵押',
  },
  loan_borrow: {
    40: '超过可借额度（抵押率不足：新债务超过抵押价值的 50%）',
    11: 'HAC 积分不足（利息结算需要）',
    50: '全局利用率已达上限（50%），暂时无法新增借款',
    51: '借款已熔断（协议出现坏账赤字，暂停新增借款）',
    52: '超过单借款人上限（不超过总可出借额的 20%）',
  },
  loan_repay: {
    41: '当前没有债务（无需还款）',
    11: 'HAC 积分不足以还款',
  },
  loan_liquidate: {
    44: '清算额过小（低于最小清算额 1 HAC）',
    45: '抵押交割量低于 min_coll_out（保护清算人）',
    46: '深水接管需按抵押市值全额付款（repay 不足）',
    47: '参考价尚未初始化，暂不能清算',
    11: 'HAC 积分不足以垫付清算款',
    42: '该账户没有债务，无法清算',
    43: '该账户健康（未超线），不能清算',
  },
  loan_status: {
    999: '无借贷记录（健康度哨兵值）',
  },

  // ===== 管理（仅管理员）=====
  init_admin: {
    1: '合约已初始化（幂等，无需重复）',
  },
  set_oracle: {
    1: '无管理员权限',
  },
  set_fee: {
    1: '无管理员权限',
    2: '费率超出范围（0–300，即 0–3%）',
  },
  set_loan_rate: {
    1: '无管理员权限',
    2: '利率超出范围（0–2000，即 0–20%）',
  },
  set_liquidate_bonus: {
    1: '无管理员权限',
    2: '清算奖励超出范围（0–1000，即 0–10%）',
  },
  set_paused: {
    1: '无管理员权限',
  },
  rent_batch: {
    1: '无管理员权限',
    2: 'klen（键长）不能为 0',
    3: '键列表长度不是 klen 的整数倍',
  },

  // ===== 钩子：HACD（存入/赎回）=====
  //
  // #3000 起合约**不读证书**：PayableHACD/PermitHACD 直接链上读基因自算分，
  // 返回码集合实测为 {0, 2, 5, 48, 53, 54}。原表里的 3/4（证书流）与重复的
  // 第二个 5（证书校验失败）都是 #2000 遗留，已删除 —— 否则键 5 被后者覆盖，
  // 用户存入失败会看到「证书校验失败」这个 #3000 根本不存在的概念。
  PayableHACD: {
    2:  '钻石名单格式不合法',
    5:  '该钻石名无法读取基因（名字非法或链上不存在）',
    48: '单笔只能 1 颗 HACD（VM resource 限制）',
    53: '超过 hacds 总供应上限，无法再铸造',
    54: '覆盖率低于下限，暂停铸造',
  },
  PermitHACD: {
    2:  '钻石名单格式不合法',
    5:  '该钻石名无法读取基因（名字非法或链上不存在）',
    12: '兑换所需 hacds 不足，且自动经 AMM 补足失败（需先充 HAC 或先兑换）',
    48: '单笔只能 1 颗 HACD（VM resource 限制）',
    61: '合约池内没有可赎回的 HACD 记录（分数不足或池已空）',
  },

  // ===== 钩子：资产 =====
  PermitAsset: {
    1:  '资产序列号不符（本合约只收/发 serial=2000 的 hacds）',
    10: '金库待结算额不足（金库清扫失败）',
    11: '待领取 hacds（due 配额）不足',
    20: '流动性池为空（自动补足无法进行）',
    21: '自动补足时滑点保护触发',
    22: '自动补足量超出池子储备',
    30: '自动补足的池状态异常',
    31: 'HAC 积分不足以自动补足',
    32: '自动补足兑换失败',
  },
  PayableAsset: {
    1: '合约已暂停，或资产序列号不符（只收 serial=2000）',
  },

  // ===== 钩子：HAC =====
  PayableHAC: {
    1: '合约已暂停',
  },
  PermitHAC: {
    10: '金库待结算的 HAC 不足',
    11: 'HAC 积分不足',
  },

  // ===== 钩子：SAT（设计上拒绝）=====
  PayableSAT: {
    1: '本合约不接受 SAT',
  },
  PermitSAT: {
    1: '本合约不接受 SAT',
  },
};

// ---- 节点 / 沙箱英文错误：按正则匹配（不区分大小写）----
// text = 中文说明；hint = 可操作建议（可空）
const NODE_ERRORS = [
  // 「交易已存在」—— 同一笔交易（hash 相同）此前已经上链或被池接受。
  // 这**不是失败**：链上已经有这笔交易了，资产状态已由它决定。
  // 早先钱包把每一笔都写死同一个 timestamp 构造交易，导致重复提交时整批命中这里。
  // 用捕获组取出高度，便于告诉用户「已在区块 N 上链」。
  { match: /tx\s+([0-9a-f]{64})\s+already exists in height\s+(\d+)/i,
    text: '交易已上链（无需重复提交）', hint: '该交易此前已提交并打进区块，链上状态已生效，不必再发一次。',
    chain: true },
  { match: /already exists in the (?:tx\s*)?pool|already in the pool|tx\s+([0-9a-f]{64})\s+already/i,
    text: '交易已在待打包池中（无需重复提交）', hint: '这笔交易已经在节点的 mempool 里等待打包，稍等即可上链。',
    chain: true },
  { match: /invalid address argument|address .* format invalid|InvalidBase58Character/i,
    text: '地址为空或格式不对', hint: '检查是否漏填、或复制不完整' },
  { match: /base58check failed|InvalidChecksum/i,
    text: '地址校验位不对', hint: '可能复制时漏字符，请重新复制完整地址' },
  { match: /contract address (format|version)/i,
    text: '合约地址格式错误', hint: '请核对合约地址（配置项）' },
  { match: /asset is insufficient/i,
    text: '资产余额不足', hint: '该地址的对应 serial 资产不足；核对数量与 serial（hacds=2000/3000）。' },
  { match: /balance .* is insufficient/i,
    text: 'HAC 余额不足', hint: 'Type-3 交易会按 gas_max 预扣 HAC（99≈0.56 HAC、50≈0.0203 HAC、1≈0.000735 HAC，执行后退回）。纯 HAC/HACD 转账可用 1；hacds 资产转账约 50；涉及合约的转账/调用需 99。' },
  { match: /insufficient|is insufficient/i,
    text: '余额不足', hint: '检查该地址的 HAC 与资产余额；纯转账优先降低 gas_max。' },
  { match: /state changed/i,
    text: '链上状态已变化，请重试', hint: '' },
  // 单桶 gas 上限（与总预算 gas_max 无关，提高 gas_max 无效）——必须先于通用 OutOfGas 匹配
  { match: /resource gas limit exceeded/i,
    text: 'resource gas 单桶上限超出（与 gas_max 无关）',
    hint: '该交易在 VM resource 桶的消耗超过协议硬上限（主网 6,100）。常见于一次向合约存入多颗 HACD（链上重算评分约 3,000/颗）。请拆成单颗多笔广播；提高 gas_max 或手续费都无效。' },
  { match: /compute gas limit exceeded/i,
    text: 'compute gas 单桶上限超出（与 gas_max 无关）',
    hint: 'VM compute 桶消耗超过协议硬上限（主网 18,009）。请把大交易拆成多笔；提高 gas_max 无效。' },
  { match: /storage gas limit exceeded/i,
    text: 'storage gas 单桶上限超出（与 gas_max 无关）',
    hint: 'VM storage 桶消耗超过协议硬上限（主网 111,911）。该笔写入的新键/租期过多，请减少动作或降低租期。' },
  { match: /gas has run out|OutOfGas/i,
    text: 'gas 不足', hint: '提高 gas_max（高级选项）；手续费不增加 gas 预算。hacds 资产转账建议 ≥50，合约调用建议 99。' },
  { match: /CallNotExist/i,
    text: '合约里没有这个函数', hint: '检查函数名拼写' },
  { match: /CallArgvTypeFail|argument type/i,
    text: '参数类型不匹配', hint: '检查参数格式（值:类型）' },
  { match: /contract storage budget|storage fee/i,
    text: '合约存储预算不足', hint: '该操作需要的链上存储费超出当前预算' },
  { match: /budget snapshot missing/i,
    text: '合约存储预算快照缺失（节点状态异常）', hint: '稍后重试或换节点' },
  { match: /transaction parse failed|transaction body invalid|trailing bytes/i,
    text: '交易体解析失败', hint: 'hex 可能不完整或被截断' },
  { match: /prikey|secret_key|key file|key must/i,
    text: '私钥格式错误', hint: '私钥应为 64 位十六进制（不含 0x）' },
  { match: /NotFindContract/i,
    text: '找不到合约', hint: '合约可能尚未部署，或地址写错' },
  { match: /Cannot find module|MODULE_NOT_FOUND/i,
    text: '程序文件缺失', hint: '安装不完整，请重装' },
  { match: /ECONNREFUSED|socket hang up|ECONNRESET|ENOTFOUND/i,
    text: '连不上节点/预言机', hint: '检查地址与端口，或目标服务是否在运行' },
  { match: /timeout|timed out/i,
    text: '请求超时', hint: '节点/预言机响应慢或不可达' },
  { match: /HTTP 5\d\d|Bad Gateway|Service Unavailable/i,
    text: '服务端错误', hint: '节点/预言机暂时不可用，稍后重试' },
];

// ---- 对外接口 ----
function translateContractReturn(fnName, retVal) {
  const n = Number(retVal);
  if (n === 0) return '成功';
  const m = CONTRACT_CODES[fnName];
  if (m && m[n]) return m[n];
  return '操作失败（合约错误码 ' + n + '）';
}

function translateNodeError(rawText) {
  const s = String(rawText || '');
  for (const e of NODE_ERRORS) {
    const m = e.match.exec(s);
    if (!m) continue;
    const r = { text: e.text, hint: e.hint || '' };
    // 「已上链」类错误带上链上高度与 hash，供调用方判定为「已生效」而非失败
    if (e.chain) {
      r.chain = true;
      r.height = m[2] || null;
      r.hash = (m[1] && /^[0-9a-f]{64}$/i.test(m[1])) ? m[1].toLowerCase() : null;
      if (r.height) r.text = '交易已上链（区块 ' + r.height + '，无需重复提交）';
    }
    return r;
  }
  // 兜底：精简原文（去首尾、截断）
  return { text: s.slice(0, 160), hint: '' };
}

module.exports = { CONTRACT_CODES, NODE_ERRORS, translateContractReturn, translateNodeError };
