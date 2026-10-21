# HACD / HAC DeFi 合约设计 v3（整合抵押借贷 · 最终版）

> v2 → v3 三项变更（本轮项目方指令）：
> 1. **HACD 资产设计取消**：合约只做 **hacds（内部积分）** 与 **HAC** 两种记账。转入合约的 HACD **全部计为 hacds 积分**——「转入的 HACD 是资产还是积分」的歧义由本条彻底消解；
> 2. **链上资产 #1028 完全不用**：本合约非 hacds 项目方官方发行（"山寨币"定位），合约代码**不出现 serial 1028**，"hacds" 仅为合约内部记账积分（storage 账本），不对应任何链上资产；
> 3. **整合抵押借贷模块**：抵押 hacds 积分借 HAC（超额抵押 50%，利息侵蚀超线清算），与 AMM / 质押奖励 / 金库共用同一账本与分配管道。

> 继承 v2 已锁定决策：评分基准 = **Diamond_Analyzer v0.1.1**（当初交易所使用的版本）；预言机签名证书桥接基因；账本建在 storage 租金制上；AMM 恒定乘积池；金库地址与 20% 比例部署时写死；**全设计不做任何铭文判断**。

---

## 0. 资产与记账总览（v3 核心变更）

合约只接触两种链上资产：

| 链上资产 | 合约内角色 |
|---|---|
| **HACD**（钻石实物） | 存入 → 链上 5 维评分 → 记 **hacds 积分**；库存 = 合约实际持有的钻石（链上所有权即真相） |
| **HAC**（币） | 存入 → 记 **HAC 积分**（zhu 计）；AMM 池的一腿；借贷的出借币 |

**hacds 积分** = 合约内部记账单位（storage 账本，×10⁻⁸ 量纲），**不是链上资产**：

- 无 serial、无链上转账、无资产发行——只是 `bal:ds:<addr>` 键上的 u128 数字；
- 产生：① HACD 存入（5 维评分 ×10⁸）；② AMM 兑换（HAC → hacds）；
- 消耗：① 赎回钻石（手动挑库存，按该钻石评分 ×10⁸ 扣分）；② AMM 兑换（hacds → HAC）；③ 抵押借贷锁定；④ 清算罚没。

**PayableAsset / PermitAsset 钩子一律拒绝**（`return 1`）：任何链上资产（含 #1028）转入合约都不记账、整笔回滚——合约不持有、不背书任何 fungible asset。**SAT 同样拒绝**（PayableSAT / PermitSAT `return 1`）。

---

## 1. 已锁定决策（v1/v2 审核通过 + v3 本轮指令）

| 决策点 | 选定结果 |
|---|---|
| 合约记账范围 | **仅 hacds 积分 + HAC 积分**（v3：HACD 转入全部计 hacds，无资产设计） |
| 链上资产 #1028 | **不用**（v3：合约不出现该 serial，hacds 为内部积分） |
| HAC↔hacds 定价 | **AMM 恒定乘积池**（x·y=k） |
| 评分维度与基准 | **5 维全量，Diamond_Analyzer v0.1.1**（2026-10-19 项目方决定） |
| 基因引入 | **预言机签名证书**（v2 审核通过） |
| 账本载体 | **storage 租金制**（v2.1 核实） |
| 金库 | 部署时写死 `1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK`，比例 20% |
| 手续费分配 | 80% 质押奖励池 / 20% 金库，按费源币种发放 |
| 抵押借贷 | **整合进本合约**（v3：抵押 hacds 积分借 HAC，50% 抵押率，利息侵蚀超线清算，抵押物并入合约） |
| 铭文 | **全设计不做任何铭文判断** |

---

## 2. 5 维评分算法（Diamond_Analyzer v0.1.1，逐条复现）

与 v2 第 2 节完全一致（基准、四类规则表、styles elif 互斥链、`max(1, score)` 总分下限、DA append 顺序 tie-break、`hacds = max(1, 总分) × 10⁸`），v3 无变更，合约实现时逐条对照。要点：

- 总分 = 形状 + 颜色（样式或颜色二选一） + 名字字母 + 编号；
- 链上实现全部为整数/字节比较，无浮点；去重计数用 16 位 bitmap；
- 证书引入 name(6B) + visual_gene(10B) + number(u64)，评分永远链上重算并与证书声称 score 比对。

---

## 3. 交易与执行架构（全部已从 fullnode 源码逐条核实）

### 3.1 ACTION 转账策略：TopOnly

ACTION（转账类动作）要求 `EntryKind::Main + EffectMode::Edit + call_depth == 0`（`ensure_act_allowed` 的 TopOnly 分支）。合约钩子经 `run_abst_entry` 进入，ExecCtx = `EntryKind::Abst, Edit, depth 1`；合约 external 函数经 CALLEXT 进入，ExecCtx = `contract(Main, Edit)` 同样 depth 1。**结论：合约代码内（钩子或 external 函数）不能执行任何 ACTION 转账。**

设计模式（全合约统一）：

- **转账全部由顶层交易动作驱动**：用户把 `TransferHacdTo / TransferHacTo / TransferHacdFromTo / TransferHacFromTo` 等放在 Type-3 交易的动作列表里，dispatcher 在账本移动之后同步调用 Permit（from 侧）/ Payable（to 侧）钩子；
- **钩子只做记账**：Payable 记积分、Permit 扣积分，纯 storage 读写 + 整数运算；
- **AMM / 借贷等纯账本逻辑**由 `ContractMainCall`（kind 44，AST scope）携带字节码调用合约 external 函数完成——同样不转账，只动积分。

### 3.2 钩子驱动顺序与返回值判定

- 顺序：authorize（Permit，from 侧）先于 receive（Payable，to 侧），都在账本移动之后（`dispatcher.rs`：`if from != ExecFrom::Call { authorize → receive }`；VM 内 ACTION 的 actcall 宏同步递归 drive_transfer）；
- 返回值（`check_vm_return_value`）：Nil / Bool(false) / 整数 0 = 成功；非零整数 = "code N" 失败；Bool(true) = code 1；非空 bytes/address / Tuple / Compo = 失败。**钩子拒绝 = `return 1`（或非零错误码）→ 整笔交易回滚**；
- **缺钩子 = CallNotExist(51) 致命错误**：8 个钩子（PermitHAC/PermitSAT/PermitHACD/PermitAsset/PayableHAC/PayableSAT/PayableHACD/PayableAsset）必须全部实现，否则任何涉及合约的转账直接失败。

### 3.3 钩子参数（transfer_call 源码核实）

| 钩子 | 参数 |
|---|---|
| PermitHAC / PayableHAC | (对方地址 address, 金额 Amount bytes) |
| PermitSAT / PayableSAT | (对方地址 address, satoshi u64) |
| PermitHACD / PayableHACD | (对方地址 address, 数量 u32, packed_hacd_names bytes——6B/颗连排) |
| PermitAsset / PayableAsset | (对方地址 address, serial u64, amount u64) |

### 3.4 证书传递：Message / Blob 动作

- `Message(0x0401)` data = BytesW1 = **≤255 字节**；`Blob(0x0402)` data = BytesW2 = ≤65535 字节（v2 文档的 65535 上限说法仅适用 Blob，v3 修正）；
- 单证书 126B（name 6 + vg 10 + number 8 + score 4 + version 1 + sign 97）→ **每 Message 动作最多 2 份证书**；更多用 Blob + `tx_blob(idx, start, end)`（end exclusive，越界报错）；
- 视图：`tx_message(idx)`、`tx_message_single()`（全交易恰一条否则报错）、`tx_message_num()`、`tx_blob_size(idx)`；
- **存款/赎回交易布局**：动作1 Message/Blob 附证书 → 动作2 TransferHacdTo/FromTo → 钩子读 tx_message 解包验签重算评分。

### 3.5 gas 三桶（整笔交易跨动作跨钩子累计共享）

compute_limit_byte=72 → **18,009**；resource_limit_byte=56 → **6,100**；storage_limit_byte=99 → **111,911**（GAS_BUDGET_LOOKUP_1P07_FROM_138 查表）。tx_gas_budget_cap_byte=99。

- 5 维评分估算 ~1,500 compute gas；验签 40 gas/次；批量存款建议 ≤4 颗/笔；
- storage 桶：单键满租 30000 period 需约 108 万 gas → 单键单笔最多续约 ~3080 period；余额键用定长 16B 值（unit=36）控租。

### 3.6 sandbox 调试接口（HTTP API contract_sandbox_call）

参数：contract / function（函数名或 0x+8hex 原始选择器）/ params（"v:type" 逗号分隔）/ caller / gas_max。内部构造 codes = push args + `CALLEXT 1 <fnsign>` + RET，caller 绑定为 tx main 与 block author，并预充 1 HAC gas 费。合约的 external 视图函数（如查报价、查余额）可用它离线调试。

---

## 4. 账本存储架构（storage 租金制，v2.1 核实，v3 键表更新）

### 4.1 写入三分支（强制模式）

每键写入走「`storage_stat` → nil 则 `storage_new` / 有 live 则 `storage_edit` / 仅 recover 则 `storage_rent` 复活后 `storage_edit`」。sstat 返回 Nil（不存在）或 (live剩余块, recover剩余块) 元组；sload 过期(recoverable) → StorageNotActive(108) 报错；snew 键存在（含 recoverable）→ StorageKeyExists(109)；period 1..=30000；sedit 不存在 → StorageKeyNotFind(102)；sdel 退 live + key_cost。unit = 值长 + 20；1 period = 100 块 ≈ 8.3 小时。

### 4.2 账本键设计（v3：去掉资产键，新增借贷键）

| 键（≤128B） | 值（≤1280B） | 说明 |
|---|---|---|
| `bal:hac:<addr21>` | u128（zhu 计） | HAC 积分余额 |
| `bal:ds:<addr21>` | u128（10⁻⁸ 计） | hacds 积分余额 |
| `chk:hac:<addr21>` | u128 | HAC 奖励 rpu 检查点 |
| `chk:ds:<addr21>` | u128 | DS 奖励 rpu 检查点 |
| `tot:hac` / `tot:ds` | u128 | 总质押量计数器 |
| `rpu:hac` / `rpu:ds` | u128（×10¹² 定点） | 每单位累计奖励值 |
| `tre:hac` / `tre:ds` | u128 | 金库待清扫累积额 |
| `amm:hac` / `amm:ds` | u128 | AMM 池两侧存量 |
| `loan:debt:<addr21>` | u128（zhu 计） | 已借 HAC 本金 + 已结转利息 |
| `loan:coll:<addr21>` | u128（10⁻⁸ 计） | 锁定的抵押品价值（hacds 积分计） |
| `loan:last:<addr21>` | u64 | 该账户上次计息区块高度 |
| `cfg:*`（status 表，全表 ≤128B） | 小整数/地址 | 费率、暂停位、预言机地址、admin |

钻石库存不逐颗建键：库存即合约持有的 HACD（链上所有权即真相），赎回定价靠赎回人提交的证书。

### 4.3 租金策略

新键一律 1 年期（1051 period ≈ 38,860 gas 量级），续租由管理员批量交易执行（每笔约 30 键）；单键单笔最多续约 ~3080 period（storage 桶 111,911 约束）。

---

## 5. 存入与赎回（HACD → hacds 积分）

### 5.1 存入（单笔 Type-3，两动作）

```
动作1  Message(证书×1~2) 或 Blob(证书连排)
动作2  TransferHacdTo(合约, [钻石...])   → PayableHACD 钩子
```

PayableHACD 钩子逻辑：

1. 读 tx_message / tx_blob 解包证书（每颗钻石一份：name 6B + visual_gene 10B + number 8B + score 4B + version 1B = 29B 消息 + 97B Sign wire = 126B）；
2. `check_hacd_wire` 校验名单格式；证书 name 必须与转账名单一一对应（数量与顺序）；
3. `sha3_256(消息)` → `verify_signature(hash, 预言机地址, sign)` 验签；
4. **链上重算 5 维评分**（用证书里的 name/visual_gene/number），与证书声称 score 比对，不一致拒绝；
5. `bal:ds:<tx_main_addr> += Σ score × 10⁸`；`tot:ds` 同步累加（质押检查点结算）。

### 5.2 赎回（手动挑库存，单笔 Type-3，两动作）

```
动作1  Message/Blob(所选钻石的证书)
动作2  TransferHacdFromTo(合约 → 我的地址, [钻石...])   → PermitHACD 钩子
```

PermitHACD 钩子逻辑：

1. 证书验签 + 链上重算评分（同 5.1）；
2. 校验 `tx_main_addr` 的 `bal:ds` ≥ Σ score × 10⁸（**不足时自动经 AMM 用 HAC 积分补足差额**，见第 7 节）；
3. 扣减 `bal:ds` 与 `tot:ds`，放行转账；
4. 链上 HACD 所有权移动即完成交割——合约不逐颗维护库存记录。

**赎回与抵押的交互**：抵押锁定的不是实物钻石而是价值额度（`loan:coll`，见第 9 节）——抵押中的钻石仍可被他人赎回，抵押人账面价值不变，模型自洽。

---

## 6. HAC 存入与积分

```
TransferHacTo(合约, 金额)   → PayableHAC 钩子
```

PayableHAC：`hac_to_zhu` 换算 → `bal:hac:<main> += zhu`；`tot:hac` 累加。HAC 积分可随时经 `TransferHacFromTo(合约 → 我)` 转出（PermitHAC 扣积分放行），或经 AMM 换 hacds。

---

## 7. AMM 互换（hacds ↔ HAC，恒定乘积）

### 7.1 池状态

`amm:hac`（zhu 计）与 `amm:ds`（10⁻⁸ 计）两个 storage 计数器。首次流动性由管理员注入：先按普通用户流程转入 HAC 与（存入 HACD 获得）hacds 积分，再经 ContractMainCall 调 `add_liquidity(hac数, hacds数)` 扣积分入池。**合约不设 remove_liquidity**——注入单向，项目方退出只能以用户身份按市价兑换，链上无后门。

### 7.2 兑换（单笔 Type-3 三动作，原子）

以 hacds→HAC 为例：

```
动作1  TransferHacdTo(合约, 钻石) 或已有 hacds 积分          → Payable 记分
动作2  ContractMainCall(swap_ds_to_hac, min_out)            → 按池价扣 hacds 记 HAC 积分
动作3  TransferHacFromTo(合约 → 我的地址, 数量)             → PermitHAC 校验扣款放行
```

- 报价：`out = pool_out × in / (pool_in + in)`，MULDIV 256 位中间量下取整；
- 手续费 0.5% 收输入腿（先扣费后报价），80% 进质押奖励池（按费源币种）/ 20% 进金库累积额；
- `min_out` 滑点保护：报价低于它 → 整笔回滚；
- 池空（任一侧为 0）→ 兑换失败（除零保护）；HACD→HAC = 存入记分 + 同一 swap + 转出，一笔完成；
- **自动补足**（v2.1 统一原语）：赎回/兑换发现积分不足时，自动经 AMM 用另一积分补差额，每笔互换恰收一次 0.5%。

### 7.3 池价与借贷估值共用

借贷抵押估值、清算线判定全部用 AMM 即时池价（`pool_hac / pool_ds`），与兑换同源——无外部预言机价格。

---

## 8. 质押奖励与金库（同 v2，费源两币种）

- 每笔手续费（AMM 0.5% + 借贷利息）按 **80/20** 切分：质押奖励池 / 金库；
- rpu 检查点法（Synthetix 模式）：收费时 `rpu += 费用 × 10¹² / 总质押量`（总量 0 进待分配桶）；余额变动时结算检查点；
- 按费源币种发放：HAC 手续费 → HAC 积分持有者；hacds 手续费 → hacds 积分持有者；
- 领取奖励 = 普通转出动作，钩子合并校验放行；
- 金库清扫：任何人发起 `TransferHacFromTo(合约 → TREASURY)`，PermitHAC 校验收款方 == TREASURY 且金额 ≤ `tre:hac` 累积额；地址与 20% 比例部署时写死，不可更换。

---

## 9. 抵押借贷（v3 整合模块）

### 9.1 账本模型

复用两条 storage 键（见 4.2）+ 计息高度键：`loan:debt`（zhu 计本金+已结转利息）、`loan:coll`（hacds 积分计抵押价值）、`loan:last`（u64 上次计息块高）。

**抵押估值**：抵押人把 HACD 存入（Payable 记 hacds 积分，与普通存款同路径）后，经 ContractMainCall 调 `loan_add_collateral(数额)` 把一部分 **hacds 积分**划入 `loan:coll` 锁定。折 HAC 价值 = `coll × pool_hac / pool_ds`（AMM 即时池价，MULDIV 256 位中间量）。

**抵押品即库存**：抵押的是价值额度而非实物钻石——锁定的 hacds 积分对应的钻石仍在库存里可被他人赎回，价值守恒（抵押人 `loan:coll` 不变 = 他人 `bal:ds` 增加）。

### 9.2 借款（单笔 Type-3，三动作）

```
动作1  ContractMainCall(loan_borrow, 借款额)      → 校验抵押率、记账、起息
动作2  TransferHacFromTo(合约 → 我的地址, 借款额) → PermitHAC 放行（校验合约 HAC 余额与积分记账）
```

`loan_borrow` 逻辑：

1. 结转利息至当前块高（`loan:last` → now）；
2. 校验 `债务(含新借) ≤ 抵押HAC价值 × 50%`，违反回滚；
3. `loan:debt += 借款额`；合约 HAC 积分侧同步扣减池外可用额（借款来自合约 HAC 余额，与 AMM 池共用一个链上余额，池计数器只是记账）；
4. 借到的 HAC 是真币，动作2 直接转出——借款人 HAC 积分不增加。

### 9.3 利息

- 利率 `cfg:loan_rate`：万分比年化，默认 5%（500 bps），管理员可调 0–20%；年区块数 = 365×86400/300 = 105,120；
- 惰性结算：每次借款/还款/清算/查询时 `debt = debt × (1 + rate × Δ块/105120)`，MULDIV 256 位中间量，无浮点；
- 利息流向：与手续费同一管道——80% 质押奖励池（HAC 费源 → HAC 积分持有者）/ 20% 金库。

### 9.4 还款（单笔 Type-3，两动作）

```
动作1  TransferHacTo(合约, 还款额)               → PayableHAC 记 HAC 积分
动作2  ContractMainCall(loan_repay, 还款额)       → 结息、扣债
```

- 还款额 ≥ 债务 → 债务清零，多余 HAC 留为账户 HAC 积分；
- 部分还款 → 先结利息（进分配器），余额扣本金；
- 还清后 `loan:coll` 自动解锁回 `bal:ds`（可赎回钻石或兑换）。

### 9.5 清算（利息侵蚀超 50% 触发）

**触发**：`债务 > 抵押HAC价值 × 50%`（利息增长或池价下跌）。任何人可发起，无许可：

```
单笔交易：ContractMainCall(loan_liquidate, 借款人地址)
```

`loan_liquidate` 逻辑：

1. 实时校验触发条件成立，不成立回滚（防恶意清算）；
2. 结转利息入分配器；
3. `loan:debt` 清零；抵押价值按 `cfg:liquidate_bonus`（默认 2%）扣给清算人记 hacds 积分，**其余直接并入合约**（`loan:coll` 清零，对应价值归合约所有——按项目方要求「抵押物直接并入合约地址」）；
4. 借款人两清，损失 = 抵押价值 − 债务 − 清算奖励。

### 9.6 与各模块的交互

| 模块 | 交互 |
|---|---|
| AMM | 估值/清算线用池价；借款 HAC 来自合约 HAC 余额（与池共用链上余额） |
| 质押奖励 | 利息进 80/20 分配器（HAC 费源） |
| 钻石库存 | 抵押即存入，钻石可被他人赎回，价值额度记账不变 |
| 暂停 | 暂停时禁止新借款；还款与清算保持开放 |

### 9.7 安全边界

- 合约 HAC 偿付能力：借款受 ① 每笔 ≤ 抵押价值 50% ② 合约 HAC 余额（含 AMM 池）双上限约束，余额不足自动失败；
- 清算先到先得，无许可；
- 预言机风险同存款（证书只引入基因，评分链上重算）。

---

## 10. 管理与安全

- 管理员函数（`tx_main_addr() == admin` 校验）：`set_fee`（0–3%）、`set_paused`、`init_admin`、`set_oracle`、`set_loan_rate`（0–20%）、`set_liquidate_bonus`、`add_liquidity`、`rent_batch`（批量续租）；
- 暂停：禁止新入金与新借款；赎回、兑换转出、还款、清算保持开放（保护用户退出）；
- SAT 与一切链上资产完全拒绝；
- 合约可经 ContractUpdate 升级（借贷参数、费率等配置类改动优先走管理员函数而非升级）。

---

## 11. 风险与限制

1. **预言机信任**：基因字节由证书引入，评分链上重算——预言机只能证明基因不能决定分数；浏览器公开数据可对照举报，`set_oracle` 可换，可升级多签；
2. **管理员权力**：费率、暂停、预言机、借贷参数 → 建议尽早多签；
3. **AMM 种子流动性**：需项目方注入初始 HAC 与 hacds 积分；
4. **评分基准固定 DA v0.1.1**：规则不会再变，消除同步升级风险；
5. **storage 租金与 gas 三桶**：账本键过期即读报错，管理员定期批量续租；单笔交易 18,009 compute / 6,100 resource / 111,911 storage 全交易累计；
6. **借贷特有风险**：池价暴跌时抵押率瞬间恶化 → 清算可能来不及（坏账由合约 HAC 余额吸收，极端情况下 HAC 积分提取会排队失败）；清算人 2% 奖励鼓励及时清算；
7. **成本**：ContractDeploy 协议费 + Type-3 gas；存款/赎回每颗钻石附 126B 证书。

---

## 12. v3 变更清单（对照 v2）

| # | v2 | v3 |
|---|---|---|
| 1 | HACD 存入可选「资产模式」或「积分模式」 | HACD 存入**只有积分模式**（全部计 hacds），歧义消解 |
| 2 | HACDS = 链上资产 #1028，1:1 兑换 | **#1028 完全不用**；hacds = 纯内部积分，PayableAsset/PermitAsset 一律拒绝 |
| 3 | HACDS↔HACD 1:1 赎回 | 赎回 = hacds 积分手动挑库存钻石，按 5 维评分定价 |
| 4 | 借贷模块独立文档待整合 | **整合为第 9 节**，抵押品从「HACD 或 HACDS」收敛为「hacds 积分」单一入口 |
| 5 | Message 上限 65535B（错误） | 修正为 **255B**（每 Message 最多 2 证书，更多用 Blob） |
| 6 | register 补登记、set_rate 汇率函数 | 均已取消（v2.1 起沿用） |

---

**本文档为合约构建的唯一依据。下一步：按第 2/5/7/9 节编写正式 FitSH 合约**（5 维评分 + 证书验证 + 存入赎回 + AMM + 质押奖励 + 金库清扫 + 抵押借贷，全部单合约实现），随后用 sandbox 接口逐函数验证。
