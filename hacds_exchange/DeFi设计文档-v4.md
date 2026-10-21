# HACD / HAC DeFi 合约设计 v4（hacds 链上资产化 · 最终版）

> v3 → v4 一项核心变更（2026-10-19 项目方指令）：
> **hacds 从「纯内部积分」升级为「链上新发行资产」**——由项目方经 `AssetCreate`（kind 16）发行全新 serial（**不是 #1028**，也非任何既有资产），发行量入合约地址，此后 hacds 作为标准链上 fungible asset 可在链上自由转账、交易、持有。合约的 hacds 账本从「storage `bal:ds` 积分键」改为「**链上资产余额即真相**」。

> 继承 v3 已锁定决策：评分基准 = **Diamond_Analyzer v0.1.1**；预言机签名证书桥接基因；HACD 转入全部计 hacds（无资产/积分歧义）；AMM 恒定乘积池；金库地址与 20% 比例部署时写死；抵押借贷整合（50% 抵押率、利息侵蚀超线清算）；**全设计不做任何铭文判断**。

---

## 0. 资产与记账总览（v4 核心变更）

合约接触三种链上资产：

| 链上资产 | 合约内角色 |
|---|---|
| **HACD**（钻石实物） | 存入 → 链上 5 维评分 → 铸发等值 hacds 资产给存款人；赎回反向销毁；库存 = 合约实际持有的钻石（链上所有权即真相） |
| **HAC**（币） | 存入 → 记 **HAC 积分**（storage `bal:hac`，zhu 计）；AMM 池一腿；借贷出借币 |
| **hacds**（新发行资产） | **链上 fungible asset**：存入铸发、赎回销毁、AMM 一腿、借贷抵押品；**可在链上自由转账交易** |

### 0.1 hacds 资产发行（一次性，部署配套交易）

- **发行动作**：项目方（部署者）发一笔 Type-2 交易，动作 `AssetCreate`（kind 16，TOP_UNIQUE，min_tx 2）：
  - `metadata: AssetSmelt { serial, supply, decimal, issuer, ticket, name }`；
  - **serial**：主网 ≥ 1025 且 ≤ `1025 + (height − 765432)`（每块 +1）——选一个未占用 serial，**永不使用 1028**；
  - **supply**：发行总量（atoms；decimal 建议 8，与评分 ×10⁸ 量纲对齐）；
  - **issuer = 合约地址**（version 1 合约地址合法：`is_supported` 含 VERSION_CONTRACT，非 privkey_unknown）——**supply 全额记到合约的 Balance.assets**（`execute_asset_create`：`bls.asset_set(AssetAmt{serial, supply})`）；
  - **协议费**：`Amount::small(block_reward_number(height), UNIT_MEI)`（当前区块奖励数 × 1 mei），从 tx main 扣；
- **serial 固化**：合约无法在运行时读自己的「发行 serial」（无反射），因此 **serial 作为部署时常量写死在合约代码里**（`const HACDS_SERIAL : u64 = <部署选定值>`），与 AssetCreate 交易使用同一值。发行交易与合约部署的先后无约束——但**合约初始化（init_admin）前一切存入都会失败**（oracle 未设，证书验签不过），实际业务起点在 init_admin 之后。

### 0.2 账本模型变更（对照 v3）

| 项 | v3 | v4 |
|---|---|---|
| hacds 余额载体 | storage `bal:ds:<addr>` u128 | **链上资产余额**（Balance.assets 条目），合约经 `balance_fungible(addr, HACDS_SERIAL)` 读 |
| hacds 产生/消失 | 钩子改 `bal:ds` 数字 | 链上资产转账（TransferAssetFromTo 等）+ 钩子维护**铸发配额表** |
| AMM hacds 腿 | `amm:ds` 计数器 | `amm:ds` 计数器（**池记账与合约资产余额分离**：合约资产余额 = 池内 + 未铸发库存 + 借贷池，见 0.3） |
| 借贷抵押品 | `loan:coll`（积分） | `loan:coll`（资产 atoms 计）——抵押即锁定资产数量记录，实物资产仍在合约地址名下 |
| PayableAsset/PermitAsset | 一律拒绝 | **PayableAsset 拒绝**（合约不收其它资产）；**PermitAsset = hacds 出账校验闸门**（只放行本合约 serial 的合规流出） |

### 0.3 铸发配额表（v4 新增核心机制）

**问题**：ACTION 转账 TopOnly——PayableHACD 钩子内不能给存款人转资产；AMM swap、借贷放款同理。链上资产余额只反映「合约地址持有多少」，不反映「其中多少已承诺给谁」。

**方案**：合约维护一张**应付配额表**（storage）：

| 键 | 值 | 说明 |
|---|---|---|
| `due:<addr21>` | u128（atoms） | 合约应付给 `<addr>` 的 hacds 资产数量（已记账未领取） |

- **存入**（PayableHACD）：验证书 + 重算评分 → `due:<main> += Σ score × 10⁸`（不动链上资产）；
- **领取**：用户发顶层交易 `TransferAssetFromTo(合约 → 用户, hacds, n)` → **PermitAsset 钩子**校验 `n ≤ due:<main>` → 扣 `due` 放行 → 链上资产移动完成铸发交割；
- **AMM 兑换 hacds 出腿**：swap 函数把输出记 `due:<main> += out`，用户同样经 TransferAssetFromTo 领取；
- **AMM 兑换 hacds 入腿**（HAC→hacds 反向）：用户先发 `TransferAssetTo(合约, hacds, n)` → **PayableAsset 钩子**：serial ≠ HACDS_SERIAL 拒绝；serial 相符则 `due:<main> += n`（钩子无法预知后续动作是兑换还是存款，统一记 due；随后的 `swap_ds_to_hac` 再从 due 扣——资产已实际入合约，due 即「合约欠用户的资产数」）；
- **赎回**（PermitHACD）：校验 `due:<main> + 链上自有 hacds ≥ 需求`——**赎回定价优先扣 `due`，不足部分要求用户先经 AMM 补足**（自动补足原语改为操作 `due` 与 HAC 积分）；扣 `due` 放行 HACD 转出，**被扣的 hacds 配额销毁**（对应资产留在合约 = 从流通中回收）；
- **借贷抵押**：`loan_add_collateral` 把用户**链上实持** hacds 划入 `loan:coll` 记录（用户先经 TransferAssetTo 把资产入合约，PayableAsset 记入 `due`，再 MainCall 划押）——抵押是「合约欠用户的配额」的再分类，资产实物不动；
- **清算**：bonus 记清算人 `due`，其余配额销毁归合约。

**不变式**：`Σ due:<addr> + amm:ds + Σ loan:coll ≤ 合约链上 hacds 资产余额`。任何路径违反即 bug。

### 0.4 键表变更（对照 v3 §4.2）

| 键 | v4 状态 |
|---|---|
| `bal:ds:<addr>` | **删除**（链上资产余额替代） |
| `due:<addr21>` | **新增**（应付 hacds 配额） |
| `chk:ds:<addr>` / `tot:ds` / `rpu:ds` / `tre:ds` | 保留，但语义改为「**due 配额**的奖励检查点/总量/rpu/金库累积」——hacds 手续费（AMM ds 腿、借贷利息的 ds 部分）按 due 余额发放 |
| `amm:ds` | 保留（池内 hacds 计数） |
| `loan:coll:<addr>` | 保留（atoms 计） |
| 其余（bal:hac / chk:hac / tot:hac / rpu:hac / tre:hac / loan:debt / loan:last / cfg:*） | 不变 |

---

## 1. 已锁定决策（v1/v2/v3 审核通过 + v4 本轮指令）

| 决策点 | 选定结果 |
|---|---|
| 合约记账范围 | HAC 积分（storage）+ **hacds 链上资产**（v4：新发行资产，非 #1028） |
| hacds 发行 | **AssetCreate 一次性发行**，issuer = 合约地址，serial 部署时写死合约常量 |
| HAC↔hacds 定价 | **AMM 恒定乘积池**（x·y=k） |
| **AMM 流动性** | **开放所有人**（v4）：任何地址可注入/撤出流动性，按份额分享手续费（v3 的「仅管理员、无 remove」作废） |
| **手续费切分** | **三分 50/30/20**（v4）：LP 50% / 质押奖励 30% / 金库 20%（费率仍 0.5%，比例部署时写死） |
| **LP 奖励发放** | **rpu 检查点惰性结算**（v4）：与质押奖励同机制，份额变动/查询时结算，无领取交易 |
| 评分维度与基准 | **5 维全量，Diamond_Analyzer v0.1.1** |
| 基因引入 | **预言机签名证书** |
| 账本载体 | **storage 租金制**（hacds 侧改为链上资产 + due 配额表） |
| 金库 | 部署时写死 `1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK` |
| 抵押借贷 | 抵押 hacds 资产配额借 HAC，50% 抵押率，利息侵蚀超线清算 |
| 铭文 | **全设计不做任何铭文判断** |

---

## 2. 5 维评分算法（Diamond_Analyzer v0.1.1，逐条复现）

与 v3 第 2 节完全一致（基准、四类规则表、styles elif 互斥链、`max(1, score)` 总分下限、DA append 顺序 tie-break、`hacds = max(1, 总分) × 10⁸`），v4 无变更。要点：

- 总分 = 形状 + 颜色（样式或颜色二选一） + 名字字母 + 编号；
- 链上实现全部为整数/字节比较，无浮点；去重计数用 16 位 bitmap；
- 证书引入 name(6B) + visual_gene(10B) + number(u64)，评分永远链上重算并与证书声称 score 比对。

---

## 3. 交易与执行架构（全部已从 fullnode 源码逐条核实）

### 3.1 ACTION 转账策略：TopOnly

ACTION（转账类动作，含 `transfer_asset_to/from_to`）要求 `EntryKind::Main + EffectMode::Edit + call_depth == 0`（`ensure_act_allowed` TopOnly 分支；`VmHostActionDef::action_host` 一律 `allowed_policy: TopOnly`）。合约钩子经 `run_abst_entry` 进入（Abst, Edit, depth 1）；external 函数经 CALLEXT 进入（contract Main, Edit, 同样 depth 1）。**结论：合约代码内（钩子或 external 函数）不能执行任何 ACTION 转账——HAC、HACD、SAT、资产一概如此。**

设计模式（全合约统一，v4 资产流同样遵守）：

- **转账全部由顶层交易动作驱动**：用户把 `TransferHacdTo / TransferHacTo / TransferHacdFromTo / TransferHacFromTo / TransferAssetTo / TransferAssetFromTo` 放在 Type-3 交易的动作列表里，dispatcher 在账本移动之后同步调用 Permit（from 侧）/ Payable（to 侧）钩子；
- **钩子只做记账**：Payable 记配额/积分，Permit 校验扣配额/积分，纯 storage 读写 + 整数运算；
- **AMM / 借贷等纯账本逻辑**由 `ContractMainCall`（kind 44，AST scope）携带字节码调用合约 external 函数完成——同样不转账，只动配额/积分。

### 3.2 钩子驱动顺序与返回值判定

- 顺序：authorize（Permit，from 侧）先于 receive（Payable，to 侧），都在账本移动之后（dispatcher.rs：`if from != ExecFrom::Call { authorize → receive }`）；
- 返回值（`check_vm_return_value`）：Nil / Bool(false) / 整数 0 = 成功；非零整数 = "code N" 失败；Bool(true) = code 1；非空 bytes/address / Tuple / Compo = 失败。**钩子拒绝 = `return 1`（或非零错误码）→ 整笔交易回滚**；
- **缺钩子 = CallNotExist(51) 致命错误**：8 个钩子（PermitHAC/PermitSAT/PermitHACD/PermitAsset/PayableHAC/PayableSAT/PayableHACD/PayableAsset）必须全部实现。

### 3.3 钩子参数（transfer_call 源码核实）

| 钩子 | 参数 |
|---|---|
| PermitHAC / PayableHAC | (对方地址 address, 金额 Amount bytes) |
| PermitSAT / PayableSAT | (对方地址 address, satoshi u64) |
| PermitHACD / PayableHACD | (对方地址 address, 数量 u32, packed_hacd_names bytes——6B/颗连排) |
| **PermitAsset / PayableAsset** | **(对方地址 address, serial u64, amount u64)** |

### 3.4 证书传递：Message / Blob 动作

- `Message(0x0401)` data = BytesW1 = **≤255 字节**；`Blob(0x0402)` data = BytesW2 = ≤65535 字节；
- 单证书 126B（name 6 + vg 10 + number 8 + score 4 + version 1 + sign 97）→ **每 Message 动作最多 2 份证书**；更多用 Blob + `tx_blob(idx, start, end)`（end exclusive，越界报错）；
- 视图：`tx_message(idx)`、`tx_message_single()`（全交易恰一条否则报错）、`tx_message_num()`、`tx_blob_size(idx)`；
- **存款/赎回交易布局**：动作1 Message/Blob 附证书 → 动作2 TransferHacdTo/FromTo → 钩子读 tx_message 解包验签重算评分。

### 3.5 gas 三桶（整笔交易跨动作跨钩子累计共享）

compute_limit_byte=72 → **18,009**；resource_limit_byte=56 → **6,100**；storage_limit_byte=99 → **111,911**（GAS_BUDGET_LOOKUP_1P07_FROM_138 查表）。tx_gas_budget_cap_byte=99。

- 5 维评分估算 ~1,500 compute gas；验签 40 gas/次；批量存款建议 ≤4 颗/笔；
- storage 桶：单键满租 30000 period 需约 108 万 gas → 单键单笔最多续约 ~3080 period；余额键用定长 16B 值（unit=36）控租。

### 3.6 sandbox 调试接口（HTTP API contract_sandbox_call）

参数：contract / function（函数名或 0x+8hex 原始选择器）/ params（"v:type" 逗号分隔）/ caller / gas_max。合约的 external 视图函数可用它离线调试。

### 3.7 资产系统事实（v4 新核实）

- **AssetCreate**（kind 16，TOP_UNIQUE，min_tx 2）：主网 alive_height=765,432，min_serial=1025，serial 上限 = `1025 + (height − 765432)`；协议费 = 区块奖励数 × 1 mei；ticket 1–10B、name 1–32B（ascii2）、decimal ≤ 16、supply > 0；issuer 不可为 privkey_unknown；supply 全额记 issuer 的 Balance.assets；
- **TransferAssetTo/From/FromTo**（kind 17/18/19，CALL，extra9）：`transfer: (payload = Asset(asset))` → `asset_transfer`（asset_sub + asset_add）→ 合约侧驱动 PermitAsset/PayableAsset；
- **Balance.assets**：单地址最多 **20 个不同 serial**（BALANCE_ASSET_MAX），零额条目自动移除；
- **balance_fungible(addr, serial)**（ACTVIEW 0x0603，ViewOnly）：serial > 10 = 资产 atoms；0/4..=10 硬错——合约内读任意地址资产余额的唯一视图。

---

## 4. 账本存储架构（storage 租金制，v4 键表）

### 4.1 写入三分支（强制模式）

每键写入走「`storage_stat` → nil 则 `storage_new` / 有 live 则 `storage_edit` / 仅 recover 则 `storage_rent` 复活后 `storage_edit`」。sstat 返回 Nil（不存在）或 (live剩余块, recover剩余块) 元组；sload 过期(recoverable) → StorageNotActive(108) 报错；snew 键存在（含 recoverable）→ StorageKeyExists(109)；period 1..=30000；sedit 不存在 → StorageKeyNotFind(102)；sdel 退 live + key_cost。unit = 值长 + 20；1 period = 100 块 ≈ 8.3 小时。

### 4.2 账本键设计（v4：删 bal:ds，增 due 与 LP 键）

| 键（≤128B） | 值（≤1280B） | 说明 |
|---|---|---|
| `bal:hac:<addr21>` | u128（zhu 计） | HAC 积分余额 |
| `due:<addr21>` | u128（atoms） | **合约应付 hacds 资产配额**（铸发/兑换/清算待领取） |
| `chk:hac:<addr21>` | u128 | HAC 奖励 rpu 检查点（质押侧） |
| `chk:ds:<addr21>` | u128 | due 配额奖励 rpu 检查点 |
| `tot:hac` / `tot:ds` | u128 | 总质押量（hac 积分总量 / due 总量） |
| `rpu:hac` / `rpu:ds` | u128（×10¹² 定点） | 每单位累计奖励值（质押侧） |
| `tre:hac` / `tre:ds` | u128 | 金库待清扫累积额 |
| `amm:hac` / `amm:ds` | u128 | AMM 池两侧存量（记账） |
| `lpt:<addr21>` | u128 | **LP 份额**（×10¹⁸ 定点，见第 7 节） |
| `lpt:tot` | u128 | LP 份额总量 |
| `lpu:hac` / `lpu:ds` | u128（×10¹² 定点） | **LP 每份额累计奖励值**（rpu 同机制） |
| `lch:hac:<addr21>` / `lch:ds:<addr21>` | u128 | LP 奖励检查点（份额变动时结算） |
| `loan:debt:<addr21>` | u128（zhu 计） | 已借 HAC 本金 + 已结转利息 |
| `loan:coll:<addr21>` | u128（atoms） | 锁定的 hacds 抵押配额 |
| `loan:last:<addr21>` | u64 | 该账户上次计息区块高度 |
| `cfg:*`（status 表，全表 ≤128B） | 小整数/地址 | 费率、暂停位、预言机地址、admin |

钻石库存不逐颗建键：库存即合约持有的 HACD（链上所有权即真相），赎回定价靠赎回人提交的证书。

### 4.3 租金策略

新键一律 1 年期（1051 period ≈ 38,860 gas 量级），续租由管理员批量交易执行（每笔约 30 键）；单键单笔最多续约 ~3080 period（storage 桶 111,911 约束）。

---

## 5. 存入与赎回（HACD → hacds 资产）

### 5.1 存入（单笔 Type-3，两动作；领取可同笔追加）

```
动作1  Message(证书×1~2) 或 Blob(证书连排)
动作2  TransferHacdTo(合约, [钻石...])   → PayableHACD 钩子
[动作3  TransferAssetFromTo(合约 → 我, hacds, n) → PermitAsset 钩子领取]（可选，n ≤ due）
```

PayableHACD 钩子逻辑：

1. 读 tx_message / tx_blob 解包证书（每颗钻石一份：name 6B + visual_gene 10B + number 8B + score 4B + version 1B = 29B 消息 + 97B Sign wire = 126B）；
2. `check_hacd_wire` 校验名单格式；证书 name 必须与转账名单一一对应（数量与顺序）；
3. `sha3_256(消息)` → `verify_signature(hash, 预言机地址, sign)` 验签；
4. **链上重算 5 维评分**（用证书里的 name/visual_gene/number），与证书声称 score 比对，不一致拒绝；
5. `due:<tx_main_addr> += Σ score × 10⁸`；`tot:ds` 同步累加（due 检查点结算）；
6. 领取（动作3，可选）：PermitAsset 校验 `serial == HACDS_SERIAL && amount ≤ due:<main>` → 扣 due 放行 → 链上资产移动完成铸发交割。

### 5.2 赎回（手动挑库存，单笔 Type-3，两动作）

```
动作1  Message/Blob(所选钻石的证书)
动作2  TransferHacdFromTo(合约 → 我的地址, [钻石...])   → PermitHACD 钩子
```

PermitHACD 钩子逻辑：

1. 证书验签 + 链上重算评分（同 5.1）；
2. 校验 `due:<tx_main_addr> ≥ Σ score × 10⁸`（**不足时自动经 AMM 用 HAC 积分补足差额**——补足原语操作 due 与 HAC 积分，见第 7 节）；
3. 扣减 `due` 与 `tot:ds`，放行转账——**被扣配额销毁**（对应资产留在合约 = 从流通中回收）；
4. 链上 HACD 所有权移动即完成交割——合约不逐颗维护库存记录。

**赎回与抵押的交互**：抵押锁定的不是实物钻石而是 due 配额（`loan:coll`）——抵押中的钻石仍可被他人赎回，抵押人账面配额不变，模型自洽。

---

## 6. HAC 存入与积分

```
TransferHacTo(合约, 金额)   → PayableHAC 钩子
```

PayableHAC：`hac_to_zhu` 换算 → `bal:hac:<main> += zhu`；`tot:hac` 累加。HAC 积分可随时经 `TransferHacFromTo(合约 → 我)` 转出（PermitHAC 扣积分放行），或经 AMM 换 hacds。

---

## 7. AMM 互换与流动性（hacds ↔ HAC，恒定乘积，v4 开放 LP）

### 7.1 池状态与 LP 份额

`amm:hac`（zhu 计）与 `amm:ds`（atoms 计）两个 storage 计数器。**池记账与合约链上资产余额分离**：`amm:ds` 只是池内记账数，合约实际 hacds 资产余额 = 池内 + 未铸发库存 + 借贷池（不变式见 0.3）。

**LP 份额**（v4 新增）：首次注入确立池价，此后注入按已有份额/池量比例配额：

- `lpt:tot == 0`（首注）：`share = √(hac_amt × ds_amt) × 10¹⁸`（整数平方根 Newton 迭代；直乘 `hac_amt × ds_amt` 在 ~10⁹ zhu 量级即近 u128 上限，故设首注单侧上限 10¹⁸ 防溢出）；同时写 `amm:price_lock`（可选防操纵，v4 暂不实现）；
- 此后：`share = min( lpt:tot × hac_amt / amm:hac , lpt:tot × ds_amt / amm:ds )`（MULDIV 下取整，双向约束防单边注水套利）；
- `lpt:<addr> += share`；`lpt:tot += share`；
- **撤出**（v4 新增，`remove_liquidity(share_burn)`）：`hac_out = amm:hac × burn / lpt:tot`、`ds_out = amm:ds × burn / lpt:tot`（MULDIV 下取整）；池两侧扣减，`hac_out` 记 `bal:hac`，`ds_out` 记 `due`；`lpt:<addr> -= burn`、`lpt:tot -= burn`；**份额清零且池非空时强制结算 LP 奖励**；
- LP 份额 ×10¹⁸ 定标（`share = 几何平均 × 10¹⁸`，防早期份额取整为零）。

### 7.2 兑换（单笔 Type-3，原子）

以 hacds→HAC 为例：

```
动作1  TransferHacdTo(合约, 钻石)（或已有 due 配额）       → Payable 记分
动作2  ContractMainCall(swap_ds_to_hac, ds数, min_out)     → 按池价扣 due 记 HAC 积分
动作3  TransferHacFromTo(合约 → 我的地址, 数量)            → PermitHAC 校验扣款放行
```

以 HAC→hacds 为例（出腿领取）：

```
动作1  TransferHacTo(合约, 金额)                           → PayableHAC 记 HAC 积分
动作2  ContractMainCall(swap_hac_to_ds, hac数, min_out)    → 扣 HAC 积分，due += 输出
[动作3  TransferAssetFromTo(合约 → 我, hacds, n)           → PermitAsset 领取]（可选）
```

- 报价：`out = pool_out × in / (pool_in + in)`，MULDIV 256 位中间量下取整；
- 手续费 0.5% 收输入腿（先扣费后报价）；
- **费切分（v4 三分 50/30/20）**：`lp_part = fee × 5000 / 10000`；`stake_part = fee × 3000 / 10000`；`tre_part = fee − lp_part − stake_part`；
  - LP 部分：`lpu:<sfx> += lp_part × 10¹² / lpt:tot`（lpt:tot = 0 时并入 stake_part）；
  - 质押部分：`rpu:<sfx> += stake_part × 10¹² / tot:<sfx>`（tot = 0 时并入 tre_part）；
  - 金库部分：`tre:<sfx> += tre_part`；
  - 费源币种跟随输入腿：HAC 腿费发 HAC 积分（bal:hac），hacds 腿费发 due 配额；
- `min_out` 滑点保护：报价低于它 → 整笔回滚；
- 池空（任一侧为 0）→ 兑换失败（除零保护）；
- **自动补足**（统一原语）：赎回/兑换发现 due 不足时，自动经 AMM 用 HAC 积分补差额，每笔互换恰收一次 0.5%。

### 7.3 LP 奖励结算（rpu 检查点惰性）

- 份额变动（add/remove）时自动结算，或随时经 `lp_harvest`（MainCall，不动份额）物化两腿奖励：`gain = lpt:<who> × (lpu − lch) / 10¹²` → 并入 `bal:hac`（HAC 腿）或 `due`（ds 腿）→ `lch:<who> = lpu`；只读待结算量经 `lp_pending_hac / lp_pending_ds` 视图查询；
- 与质押奖励同机制（Synthetix 模式），无领取交易；
- **注意**：LP 奖励与质押奖励是**两套独立 rpu**（lpu vs rpu）——LP 按份额分，质押按 due/hac 积分余额分，互不稀释。

### 7.4 池价与借贷估值共用

借贷抵押估值、清算线判定全部用 AMM 即时池价（`pool_hac / pool_ds`），与兑换同源——无外部预言机价格。

---

## 8. 质押奖励与金库（v4 三分后调整）

- 每笔手续费（AMM 0.5% + 借贷利息）按 **50/30/20** 切分：**LP / 质押奖励池 / 金库**（借贷利息无 LP 参与 → 沿用 v3 的 80/20：质押 80% / 金库 20%）；
- 质押 rpu 检查点法：收费时 `rpu += 费用 × 10¹² / 总质押量`（总量 0 进待分配桶）；余额变动时结算检查点；
- 按费源币种发放：HAC 手续费 → HAC 积分持有者；hacds 手续费 → due 配额持有者；
- 领取奖励 = 普通转出动作，钩子合并校验放行；
- 金库清扫：任何人发起 `TransferHacFromTo(合约 → TREASURY)`，PermitHAC 校验收款方 == TREASURY 且金额 ≤ `tre:hac` 累积额；hacds 侧金库（`tre:ds`）清扫经 `TransferAssetFromTo(合约 → TREASURY)`，PermitAsset 同样校验 TREASURY + 限额。地址与比例部署时写死，不可更换。

---

## 9. 抵押借贷（v4：抵押品 = due 配额）

### 9.1 账本模型

`loan:debt`（zhu 计本金+已结转利息）、`loan:coll`（**atoms 计 due 配额**）、`loan:last`（u64 上次计息块高）。

**抵押估值**：抵押人先持有 due 配额（存入 HACD / AMM 兑换 / 链上资产转入均可获得），经 ContractMainCall 调 `loan_add_collateral(数额)` 把一部分 **due 配额**划入 `loan:coll` 锁定。折 HAC 价值 = `coll × pool_hac / pool_ds`（AMM 即时池价，MULDIV 256 位中间量）。

**抵押品即库存**：抵押的是配额而非实物钻石——锁定配额对应的钻石仍在库存里可被他人赎回，价值守恒（抵押人 `loan:coll` 不变 = 他人 `due` 增加）。

### 9.2 借款（单笔 Type-3，两动作）

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
- 利息流向：与手续费同一管道——**80% 质押奖励池（HAC 费源 → HAC 积分持有者）/ 20% 金库**（利息无 LP 参与，不切 50/30/20）。

### 9.4 还款（单笔 Type-3，两动作）

```
动作1  TransferHacTo(合约, 还款额)               → PayableHAC 记 HAC 积分
动作2  ContractMainCall(loan_repay, 还款额)       → 结息、扣债
```

- 还款额 ≥ 债务 → 债务清零，多余 HAC 留为账户 HAC 积分；
- 部分还款 → 先结利息（进分配器），余额扣本金；
- 还清后 `loan:coll` 自动解锁回 `due`（可领取资产、赎回钻石或兑换）。

### 9.5 清算（利息侵蚀超 50% 触发）

**触发**：`债务 > 抵押HAC价值 × 50%`（利息增长或池价下跌）。任何人可发起，无许可：

```
单笔交易：ContractMainCall(loan_liquidate, 借款人地址)
```

`loan_liquidate` 逻辑：

1. 实时校验触发条件成立，不成立回滚（防恶意清算）；
2. 结转利息入分配器；
3. `loan:debt` 清零；抵押配额按 `cfg:liquidate_bonus`（默认 2%）扣给清算人记 `due`，**其余直接销毁**（`loan:coll` 清零，对应资产留在合约 = 归合约所有——按项目方要求「抵押物直接并入合约地址」）；
4. 借款人两清，损失 = 抵押价值 − 债务 − 清算奖励。

### 9.6 与各模块的交互

| 模块 | 交互 |
|---|---|
| AMM | 估值/清算线用池价；借款 HAC 来自合约 HAC 余额（与池共用链上余额） |
| 质押奖励 | 利息进 80/20 分配器（HAC 费源） |
| 钻石库存 | 抵押即存入，钻石可被他人赎回，配额记账不变 |
| 暂停 | 暂停时禁止新借款；还款与清算保持开放 |

### 9.7 安全边界

- 合约 HAC 偿付能力：借款受 ① 每笔 ≤ 抵押价值 50% ② 合约 HAC 余额（含 AMM 池）双上限约束，余额不足自动失败；
- 清算先到先得，无许可；
- 预言机风险同存款（证书只引入基因，评分链上重算）。

---

## 10. 管理与安全

- 管理员函数（`tx_main_addr() == admin` 校验）：`set_fee`（0–3%）、`set_paused`、`init_admin`、`set_oracle`、`set_loan_rate`（0–20%）、`set_liquidate_bonus`、`rent_batch`（批量续租）——**v4 删除 `add_liquidity` 管理员函数**（流动性开放，见第 7 节）；
- 暂停：禁止新入金与新借款；赎回、兑换转出、还款、清算、LP 撤出保持开放（保护用户退出）；
- SAT 与除 hacds 外的一切链上资产完全拒绝（PayableAsset 校验 serial）；
- 合约可经 ContractUpdate 升级（借贷参数、费率等配置类改动优先走管理员函数而非升级）。

---

## 11. 风险与限制

1. **预言机信任**：基因字节由证书引入，评分链上重算——预言机只能证明基因不能决定分数；浏览器公开数据可对照举报，`set_oracle` 可换，可升级多签；
2. **管理员权力**：费率、暂停、预言机、借贷参数 → 建议尽早多签；
3. **AMM 种子流动性**：需项目方注入初始 HAC 与 hacds（首注确立池价，后续开放所有人跟注）；
4. **LP 无常损失**：开放 LP 后撤出按份额比例取回两侧资产，价格偏离注入点会产生无常损失——LP 手续费分成（50%）是对价；
5. **评分基准固定 DA v0.1.1**：规则不会再变，消除同步升级风险；
6. **storage 租金与 gas 三桶**：账本键过期即读报错，管理员定期批量续租；
7. **借贷特有风险**：池价暴跌时抵押率瞬间恶化 → 清算可能来不及（坏账由合约 HAC 余额吸收）；清算人 2% 奖励鼓励及时清算；
8. **资产 serial 部署固化**：HACDS_SERIAL 写死合约常量，发行交易必须用同一 serial——发行前需核对链上该 serial 未被占用（`asset_meta(serial)` 查询）；
9. **Balance.assets 20 serial 上限**：合约地址只持有 hacds 一种资产，不受影响；用户侧持有资产种类多时注意自身余额表上限；
10. **成本**：AssetCreate 协议费（区块奖励 × 1 mei）+ ContractDeploy 协议费 + Type-3 gas；存款/赎回每颗钻石附 126B 证书。

---

## 12. v4 变更清单（对照 v3，含实现期修正）

| # | v3 | v4 |
|---|---|---|
| 1 | hacds = 纯内部积分（storage `bal:ds`） | **hacds = 链上新发行资产**（AssetCreate，serial 部署写死，非 #1028），链上自由转账交易 |
| 2 | PayableAsset/PermitAsset 一律拒绝 | PayableAsset 校验 serial（只收 hacds）；**PermitAsset = hacds 出账闸门**（due 配额校验 + 金库清扫放行） |
| 3 | 存入即钩子内记分到 bal:ds | 存入记 `due` 配额；领取经顶层 TransferAssetFromTo（PermitAsset 扣 due） |
| 4 | AMM 流动性仅管理员、无 remove | **开放所有人**：add/remove_liquidity + LP 份额表（lpt/lpt:tot） |
| 5 | 手续费 80/20（质押/金库） | **三分 50/30/20**（LP/质押/金库）；借贷利息仍 80/20 |
| 6 | 无 LP 奖励机制 | **lpu/lch rpu 检查点惰性结算**（与质押 rpu 独立两套） |
| 7 | 借贷抵押 hacds 积分 | 抵押 **due 配额**（atoms 计），解锁回 due |
| 8 | 金库仅 HAC 清扫 | hacds 侧金库（tre:ds）经 TransferAssetFromTo 清扫 |
| 9 | settle_and_write 收益滚余额不计总量 | **收益同步 total_add**（Σbal == tot 恒成立，rpu 分发不超发） |
| 10 | LP 收益只滚余额 | **LP 收益同步 total_add**（同上，两套 rpu 守恒独立成立） |
| 11 | 清算 bonus 只记清算人余额 | **bonus 同步 total_add**（销毁部分留松弛量，bonus 部分计总量） |

---

## 13. 实现期修正（2026-10-20，合约构建 + 运行时验证后回写）

合约 `HacdsDeFi.fitsh` 已构建并通过运行时验证（链上评分 vs 预言机 4658/4658、sandbox E2E 35/35）。以下为实现期发现，**与本文档正文有出入处以本节为准**：

| # | 正文原述 | 实现期修正 |
|---|---|---|
| I1 | §4.3 新键 1 年期（1051 period ≈ 38,860 gas） | **`RENT_PERIOD = 300`**（≈30,000 块 ≈104 天）。gas 硬约束：单笔最坏是「冷池首次 `add_liquidity`」一次新增 **8 个账本键**（lpt:tot / amm:hac / amm:ds / lch:hac / lch:ds / chk:hac / chk:ds / lpt:me），每键 = 1024 + 36×period；8 键须 ≤ storage 桶 111,911 → **period ≤ ~318**。实测 period=300 时冷池 add_liquidity = 95,392 ✓。**不能采用正文的「1 年期」**——管理员须用 `rent_batch` 定期续租（本机无链上自动续租）。 |
| I2 | §9.2 借款动作 2 `TransferHacFromTo(合约→借款人)` | 该转出必经 `PermitHAC`，而合约 HAC 余额无对应积分会被拒。修正：**`loan_borrow` 给借款人记等额 `bal:hac`**，动作 2 扣减放行；净效果借款人真币到手、积分不增、债务成立（同笔未转出则积分暂存 = 对合约 HAC 的索取权）。 |
| I3 | §7.1 LP 份额 = √(hac×ds) × 10¹⁸（×10¹⁸ 定标） | **去掉 10¹⁸ 定标**：份额直接 = √(hac×ds)。若保留定标，`lpt:tot` 比手续费大 10¹⁸ 倍 → LP 奖励增量 `mul_div(lp_part, 10¹², lpt:tot)` 恒为 0，**LP 实际分不到任何手续费**。首注单侧上限保留 10¹⁸（防乘积溢出）。 |
| I4 | （未述）FitSH 整数语义 | **nil 判定必须用 `X is nil` / `is not nil`**（`X == nil` 会 Arithmetic(90) 报错）；**整数算术/比较同类型**，账本变量字面量一律带 `u128` 后缀。两处均为全合约级致命坑，已在合约内修正。 |
| I5 | §5.1 存入取证书 | PayableHACD 读 `tx_message_single`（单条）或 `tx_blob(0,...)`（多条）；`check_hacd_wire` + `buf_u64/u32` 解包；链上重算评分与证书 score 必须逐字节一致（已 fuzz 验证）。 |

**gas 实测汇总**（单桶上限 compute 18,009 / resource 6,100 / storage 111,911）：

| 调用 | compute | resource | storage | 结论 |
|---|---|---|---|---|
| 冷池 add_liquidity（8 新键） | 6,194 | 2,298 | 95,392 | ✓ |
| swap_hac_to_ds / swap_ds_to_hac | 3,726 / 3,969 | 1,547 / 1,668 | 48,932 / 37,460 | ✓ |
| lp_harvest | 3,176 | 1,453 | 1,908 | ✓ |
| loan_add_collateral / borrow / repay | ≤2,321 | ≤1,128 | ≤24,088 | ✓ |
| quote_score（纯计算） | 6,513 | 2,846 | 0 | ✓ |

---

**本文档为合约构建的唯一依据；合约已按 v4 + 第 13 节修正构建完成。部署前仅需：确定 HACDS_SERIAL（链上 `asset_meta` 未占用）并改常量、按第 13 节同步文档其余正文。**

