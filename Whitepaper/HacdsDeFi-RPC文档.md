# HacdsDeFi RPC 文档

2026-11-18　对应合约 #4000　面向开发者

> 本文档描述 Hacash 主网合约 `HacdsDeFi3000.fitsh`
> （地址 `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`，hacds 资产 serial 4000，decimal 0；
> 股权资产 serial 4001，issuer 为部署者地址）。
>
> **本文档不含任何 #2000 时代的接口。** 预言机、评分证书、管理员函数在新版
> 合约里**已不存在**——不是权限被收走，是这些函数根本没写进去。

---

## 0. 服务一览

hacds 涉及四个 HTTP 服务。前两个读链，后两个是便利设施。

| 服务 | 地址 | 协议 | 作用 |
|---|---|---|---|
| 全节点 RPC | `node.hacds.com` | HTTP/JSON | 查链上数据、沙箱只读调用、校验/广播交易 |
| API 代理 | `api.hacds.com` | HTTP/JSON | 转发到全节点，补 CORS + HTTPS |
| 索引器 | `indexer.hacds.com` | HTTP/JSON | 借款人台账（谁可清算） |
| 交易构建服务 | `build.hacds.com` | HTTP/JSON | 把人类输入转成未签名交易 |

```
                 ┌──────────────┐
  客户端 ──GET──► │ 全节点 RPC    │◄── 索引器（扫链建台账）
    │            └──────────────┘
    │                    ▲
    └──POST──► 构建服务 ──┘   （只构建，不签名）
```

**为什么需要 API 代理**：全节点不返回 CORS 头，浏览器直连会被拦。
`api.hacds.com` 是一个 Cloudflare Worker，只做转发和补头，不改语义。
服务端端口不是 80/443，Cloudflare 到源站走 Tunnel。

**响应约定**：所有接口返回 JSON，顶层带 `ret` 字段。`ret: 0` 表示成功，
非 0 表示失败（失败时通常带 `err`）。

> ⚠ **失败也是 HTTP 200**，必须判 body 里的 `ret`，不能只看状态码。

**为什么节点地址是子域名而不是 `IP:端口`**：Cloudflare Workers 只能访问
80/443 端口。任何 `IP:8082` 形式的地址都会在建立连接前被拒绝
（`error code: 1003`）。所以对外统一走 `*.hacds.com` 子域名 + Tunnel。

---

## 1. 全节点 API

### 1.1 查询区块高度

```
GET /query/block/height/latest
```

```json
{"ret":0,"height":798812}
```

VM 状态（是否已启用、当前高度）：

```
GET /api/vm/status
```

```json
{"ret":0,"vm":"enabled","height":798812}
```

---

### 1.2 查询平均费率

用于估算手续费。

```
GET /query/fee/average
```

```json
{"ret":0,"purity":"6024000000","purity_unit":232}
```

`purity` = `fee / billing_size（字节）`，节点准入要求 `纯度 ≥ min_purity`。

---

### 1.3 查询余额（HAC / 钻石 / 资产）

```
GET /query/balance?address={地址}&assets=true&asset_meta=true&diamonds=true
```

三个开关都是可选的：

| 参数 | 作用 |
|---|---|
| `assets=true` | 带上资产列表（hacds 在这里） |
| `asset_meta=true` | 带资产名 / 发行量等元信息 |
| `diamonds=true` | 带上 HACD 钻石列表 |

```json
{
  "ret": 0,
  "list": [{
    "address": "1P2tsn...",
    "hacash": "1234567:248",
    "diamond": 3,
    "assets": [{"serial": 4000, "amount": "100000000"}]
  }]
}
```

**金额是 `<值>:<单位>` 形式**：`5:249` 表示 50 HAC（5 × 10^(249−248)），
不是 5.0038。换算公式见 §8.3。

---

### 1.4 查询钻石详情

```
GET /query/diamond?name={6位钻石名}
```

返回钻石的编号、视觉基因、所属地址等。评分需要的 `number` 和
`visual_gene` 都在这里。

---

### 1.5 沙箱只读调用（**读合约状态的主要方式**）

```
GET /query/contract/sandboxcall?contract={合约}&function={函数}&params={参数}&caller={调用者}
```

只读执行，不写链上状态、不发交易、不花手续费。

**实测响应**：

```json
{"ret":0,"use_gas":377,"gas_use":{"compute":132,"resource":209,"storage":36},"ret_val":120200677111}
```

| 字段 | 含义 |
|---|---|
| `ret` | 0 = 调用成功 |
| `ret_val` | 函数返回值 |
| `use_gas` / `gas_use` | 本次消耗，用于估算 |

> ⚠ **地址填错时，这里会返回 `NotFindContract`。** 合约已于 2026-11-18 部署到主网
> （第二轮），当前有效地址见 §8.2。旧地址 `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`
> 是已作废的第一轮部署，调它会报这个错。

#### 1.5.1 两个必知的坑

**坑 1：不传 `caller` 会失败。**

```json
{"ret":1,"err":"[revert] address \"1111...\" balance 0:0 is insufficient, at least 559555:242"}
```

默认调用者余额为 0，付不起预扣 gas。**传 `caller={合约地址}` 即可**——
合约调用自己不需要余额。

**坑 2：每 IP 并发上限为 2。** 超出的请求**直接拒绝**，不排队：

```json
{"ret":1,"err":"sandbox_per_ip_concurrency_exceeded"}
```

客户端必须**串行化 + 退避重试**。不要 `Promise.all` 并发发十几个。

#### 1.5.2 参数格式

`params` 是 `值:类型` 用逗号分隔。`:` 要 URL 编码成 `%3A`。

| 类型 | 示例 |
|---|---|
| `u128` | `100000000:u128` |
| `address` | `1P2tsn...:address` |
| `bytes` | `WTYUIA:bytes` |

#### 1.5.3 只读函数完整清单

**AMM 与流动性**

| 函数 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `amm_reserves` | — | u128 | 池中 HAC（**zhu**） |
| `amm_reserve_ds` | — | u128 | 池中 hacds（**个数**） |
| `pool_price` | — | u128 | 池价 = `amm:hac × 1e8 / amm:ds` |
| `lp_total` | — | u128 | LP 总份额 |
| `lp_share_of` | `who:address` | u128 | 某地址的 LP 份额 |
| `lp_pending_hac` | `who:address` | u128 | 待领 LP 奖励（HAC，zhu） |
| `lp_pending_ds` | `who:address` | u128 | 待领 LP 奖励（hacds，个数） |
| `total_staked` | `kind:u128` | u128 | kind `0`=HAC，`1`=hacds |

**借贷**

| 函数 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `loan_debt_of` | `who:address` | u128 | 本金（zhu），**不含**未结算利息 |
| `loan_debt_now` | `who:address` | u128 | 含利息的实时债务（zhu） |
| `loan_coll_of` | `who:address` | u128 | 锁定抵押（hacds 个数） |
| `loan_health` | `who:address` | u128 | **健康度万分比**，见下 |
| `loan_status` | `who:address` | u128 | 抵押率 ×100，见下 |
| `total_debt` | — | u128 | 全局债务（zhu） |
| `providers_total` | — | u128 | 全部可出借资金 |
| `utilization` | — | u128 | 当前利用率（bps） |
| `borrow_coll_ratio` | — | u128 | 借款线百分比（`200`） |
| `liq_coll_ratio` | — | u128 | 清算线百分比（`160`） |
| `borrow_paused` | — | u128 | 非 0 = 暂停新增借款（利用率或熔断） |
| `ref_paused` | — | u128 | 非 0 = 价格偏离熔断中 |
| `lendable_amm` | — | u128 | AMM 可出借部分（30%） |
| `net_claims` | — | u128 | 全网债权 |
| `reserve_hac` | — | u128 | 坏账储备 |
| `deficit_hac` | — | u128 | 赤字 |

**健康度的正确读法**

| `loan_health` 返回 | 含义 |
|---|---|
| `1000000` | 无债务（合约返回的哨兵值，视为极健康） |
| `> 10000` | 安全 |
| `= 10000` | 恰在清算线上 |
| `< 10000` | **可被清算** |
| `< 9000` | 深水区，可被全额清算 |

**关键**：这个值用 `coll_to_hac_liq()` 计算，即**保守价 `min(现货价, 平滑参考价)`**，
与 `loan_liquidate` 的判定**同源**。所以不会出现「界面显示安全、链上已可清算」。
不要用 `loan_status` 自己算健康度，用这个。

`loan_status` 是旧口径（`coll_hac × 100 / debt`，用现货价），保留兼容：

| 返回 | 含义 |
|---|---|
| `0` | 无借贷、无抵押 |
| `999` | 有抵押但无债务 |
| 其它 | 抵押率 ×100 |

**HACD 池**

| 函数 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `hacd_score_total` | — | u128 | 池内 HACD 总分（已 ×`SCORE_SCALE`） |
| `hacd_count` | — | u128 | 池内 HACD 颗数 |
| `hacd_avg_score` | — | u128 | 平均分（已 ×`SCORE_SCALE`） |
| `hacd_coverage` | — | u128 | 覆盖率（bps，10000 = 100%） |
| `quote_redeem` | `sc:u128` | tuple | 赎回报价，见下 |
| `quote_score` | `name:bytes,vg:bytes,num:u128` | u128 | 按名字+基因+编号算分 |

**`quote_redeem` 返回值**：`tuple(charge, fee, premium_bps, ok)`

| 元素 | 含义 |
|---|---|
| `charge` | 总扣减（本金 + 手续费） |
| `fee` | 其中手续费 |
| `premium_bps` | 挑钻石溢价（bps） |
| `ok` | `1` = 可赎回；`0` = 实际交易会返回 `61`（池内无记录或分数不足） |

**价格与因子**

| 函数 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `ref_price_of` | — | u128 | 平滑参考价 |
| `ref_price_zhu_per_ds` | — | u128 | 参考价（zhu per hacds） |
| `ref_height` | — | u128 | 上次更新参考价的块高 |
| `hcut` | — | u128 | HAC 社会化因子（1e12 定标，只降不升） |
| `lcut` | — | u128 | LP 奖励社会化因子 |

**账户与金库**

| 函数 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `balance_hac` | `who:address` | u128 | 有效 HAC 余额（zhu，已乘 hcut） |
| `balance_hac_nominal` | `who:address` | u128 | 名义份额（zhu） |
| `balance_ds` | `who:address` | u128 | 待领取 hacds 配额 due |
| `bad_of` | `who:address` | u128 | 该地址的坏账 |
| `treasury_pending` | `kind:u128` | u128 | 金库待清扫。`0`=HAC，`1`=hacds |
| `treasury_ds` | — | u128 | 金库 hacds 累积 |
| `tot_hac` | — | u128 | HAC 总量（有效值） |
| `tot_hac_nominal` | — | u128 | HAC 总量（名义份额） |
| `lpr_hac_effective` | — | u128 | LP 奖励池有效值 |

**运维**

| 函数 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `self_check` | — | u128 | 内部一致性自检，`0` = 通过 |
| `rent_key_group_count` | — | u128 | 键分组数量（固定 `7`） |
| `rent_key_len_at` | `idx:u128` | u128 | 第 idx 组的键长度 |
| `rent_keys_group` | `klen:u128` | bytes | 该长度组的所有键（可直接喂 `rent_keys`） |

#### 1.5.4 实测样本

```
GET {node}/query/contract/sandboxcall?contract=bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h
    &function=loan_health&params=1P2tsn...%3Aaddress&caller=bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h
→ {"ret":0,"use_gas":830,"gas_use":{"compute":363,"resource":323,"storage":144},"ret_val":1000000}
```

`ret_val: 1000000` = 该地址无债务。

---

### 1.6 查询区块概要

索引器用它遍历区块找借款人。

```
GET /query/block/intro?height={高度}&tx_hash_list=true
```

---

### 1.7 查询交易

```
GET /query/transaction?hash={交易哈希}
```

---

### 1.8 校验交易（附带人工可读描述）

```
POST /util/transaction/check
Content-Type: application/json

{"tx": "040000...（hex）"}
```

成功时返回解析结果和可读的动作描述，例如：

```json
{"ret":0,"describe":"[CallContract] bw2sRC... -> swap_hac_to_ds(...)"}
```

**这个接口不签名、不广播，纯校验。** 钱包在广播前拿它做最后一道把关。

---

### 1.9 广播交易

```
POST /submit/transaction
Content-Type: application/json

{"tx": "040000...（hex）"}
```

```json
{"ret":0}
```

> ⚠ `ret: 0` **只表示进了内存池**，不等于上链。出块目标 300 秒，
> 要按出块节奏回查 `/query/transaction`。

---

### 1.10 合约存储费参数

```
GET /query/contract/storage_cost?contract={合约}
```

用于估算续租成本。

---

## 2. 索引器 API

索引器扫链，维护「谁有债务、谁可清算」的台账。**钱包不本地扫链。**

### 2.1 健康检查

```
GET /health
```

```json
{"ok": true, "service": "hacds-indexer", "head": 798812, "watched": 0}
```

### 2.2 台账快照（**客户端唯一需要的接口**）

```
GET /snapshot
```

返回全部被监视地址的健康度快照：

```json
{
  "head": 798812,
  "updated": 1762900000,
  "items": [
    {"addr": "1P2tsn...", "debt": "100000000", "coll": "300000000",
     "health": 16000, "ratio": 160, "liq": true}
  ]
}
```

| 字段 | 说明 |
|---|---|
| `debt` | `loan_debt_now`（含利息） |
| `coll` | 抵押 hacds 个数 |
| `health` | 万分比，与 `loan_health` 同口径 |
| `ratio` | 抵押率百分比 |
| `liq` | `true` = 当前可清算 |

### 2.3 仅快照（不触发同步）

```
GET /snapshot?cached=1
```

### 2.4 立即同步

```
POST /sync
```

强制扫到最新块。用于运维，正常不需要调。

### 2.5 监视名单维护

```
POST /watch/add?addr={地址}
POST /watch/remove?addr={地址}
```

索引器会自动发现借款人，这两个接口用于手工补漏。

### 2.6 资产背书覆盖率监控

```
GET /backing
```

对比「合约记的 due 总量」与「链上实际发行的 hacds」，用于发现异常。

### 2.7 续租批次

```
GET /rent_batches
```

返回按长度分组、可直接喂 `rent_keys` 的键批次。keeper 用它续租。

### 2.8 部署

```bash
python3 hacds_indexer.py --node http://127.0.0.1:8082 \
    --contract bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h --port 8124
```

---

## 3. 交易构建服务

这个服务把「人类可读的参数」翻译成「未签名交易」。**它不持有任何私钥， 构建出来的交易必须由客户端自己签名。**

源码：`hacds_exchange/indexer/hacds_build_server.py`

### 3.0 为什么需要它

Hacash 的交易构造需要精确的 fee / gas / 动作编码，还要处理钻石名列表的 wire
格式。让每个客户端自己实现一遍，就是在保证「三端行为不一致」。
把构造逻辑集中到一个服务，客户端只负责签名——**签名的东西变了，但签名的人没变。**

### 3.1 健康检查

```
GET /health
```

```json
{"ok": true, "service": "hacds-build", "version": "2026-11-18.1",
 "txbuild_ok": true, "contract": "bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h"}
```

`version` 很重要：Python 不会热加载，改了脚本必须重启进程。发现行为和
`version` 对不上，先确认进程重启过。

### 3.2 构建合约调用

```
POST /api/build
Content-Type: application/json

{
  "mode": "call",
  "main": "1P2tsn...",
  "fn": "swap_hac_to_ds",
  "params": "100000000:u128,0:u128,0:u128",
  "fee": "0:248",
  "gasMax": 99
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `mode` | 否 | `call`（默认）或 `transfer` |
| `main` | ✅ | 发起地址（会付手续费的那个） |
| `fn` | ✅ | 合约函数名，白名单见 §3.4 |
| `params` | 否 | `值:类型` 逗号分隔，默认 `-` |
| `fee` | 否 | 形如 `0:248` |
| `gasMax` | 否 | 整数 `1–99`，默认 `99` |

响应：

```json
{"ok": true, "unsigned_tx": "040000...", "fn": "swap_hac_to_ds",
 "fee": "0:248", "gas_max": 99}
```

### 3.3 构建转账

```
POST /api/build
{
  "mode": "transfer",
  "main": "1P2tsn...",
  "sub": "hacd-from-to",
  "fee": "0:248"
}
```

`sub` 是 `hacds_txbuild transfer` 的子命令，额外参数按子命令给出。
**`from` 锁定为合约地址**——这是安全约束，防止有人用这个服务构造
「从任意地址转出」的交易。

### 3.4 函数白名单

```
swap_hac_to_ds · swap_ds_to_hac
add_liquidity · remove_liquidity · lp_harvest
loan_add_collateral · loan_borrow · loan_repay · loan_liquidate
rent_keys · topup_keys
```

不在白名单里的函数会被拒绝。**这是白名单不是黑名单**——新增函数必须显式加入。

### 3.5 限制

| 限制 | 值 | 为什么 |
|---|---|---|
| 单 IP 每分钟请求 | 30 | 防滥用 |
| 请求体 | 8 KB | 参数串上界 1024 字节、最多 16 项 |
| 钻石名列表 | 最多 200 颗 | 对应 `MAX_DEPOSIT_COUNT` |
| `gasMax` | 1–99 | 合约/引擎合法范围 |

### 3.6 错误码

| `error` | 含义 |
|---|---|
| `bad_json` | 请求体不是合法 JSON |
| `bad_length` | 请求体为空或超 8 KB |
| `bad_main` | `main` 不是合法地址 |
| `bad_fee` | `fee` 不是 `值:尾数` 形式 |
| `bad_gasMax` | `gasMax` 不是 1–99 的整数 |
| `fn_not_allowed` | 函数不在白名单 |
| `bad_params` | 参数串格式错 |
| `rate_limited` | 超过每分钟 30 次 |
| `build_timeout` | 引擎超时（30 秒） |
| `engine_missing` | 服务器上找不到 `hacds_txbuild` |

---

## 4. 合约 B（金库分红）

合约 B 是独立部署的**纯分红池**，地址 `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`（nonce 4）。

它**没有管理员、没有 pause、没有参数修改接口**，所有参数是编译期常量。

读它的方式与合约 A 相同，把 `contract` 参数换成 B 的地址即可：

```
GET /query/contract/sandboxcall?contract=duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4&function=<fn>
```

### 4.1 ⚠ 先理解一件事：持有 ≠ 分红

用户 A 把 4001 转给用户 B，这个动作**完全不经过合约 B**（钩子只在合约作为 from 或 to 时才触发）。

所以合约无法感知"卖出瞬间"，也就无法在那时结算。它的解法是：**只有质押进合约 B 的份额才计息。**

| 位置 | 是否参与分红 |
|---|---|
| 用户钱包里的 4001 | ❌ 不参与 |
| 质押进 B 的份额（`sh:<地址>`） | ✅ 参与 |

合约内 `sh:<addr>` 是**唯一权威**的分红份额账本。

### 4.2 只读视图

| 函数 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `share_serial()` | — | u128 | 应恒为 **4001**。用于确认合约身份 |
| `share_total()` | — | u128 | 股权发行上限（10000），只是元数据 |
| `get_shares(who)` | `address` | u128 | **已质押份额**（分红唯一依据） |
| `get_due(who)` | `address` | u128 | **已结算待提现**（HAC，zhu） |
| `get_claimable(who)` | `address` | u128 | **待提取总额** = due + 未结算增量 |
| `get_checkpoint(who)` | `address` | u128 | 该地址的检查点（×1e12） |
| `get_current_rpu()` | — | u128 | 全局累加器（×1e12） |
| `get_total_dividend()` | — | u128 | 累计分红总额（zhu） |
| `get_reserve()` | — | u128 | 续租储备金（zhu） |
| `rent_ratio_bps()` | — | u128 | 续租留存比例（2000 = 20%） |
| `rpu_scale()` | — | u128 | 定点放大倍数（1e12） |
| `ahac_group_count()` | — | u128 | 透传 A 的键组数（当前 7） |

**⚠ `get_claimable` 的语义坑：**

```
get_claimable(who) = due(who) + 未结算增量
```

`claim()` 把增量结算进 `due` 并推进检查点，所以 **claim 之后 `get_claimable` 数值不变**。

UI 必须把它显示成「待提取」而不是「可领取」，否则用户点完 claim 看数字没变，会以为功能坏了。

**正确的三分法：**

| 字段 | 含义 |
|---|---|
| `get_due` | 已结算、只差提现 |
| `get_claimable − get_due` | 尚未结算的增量 |
| `get_claimable` | 两者之和 |

### 4.3 写操作

| 操作 | 实际链上动作 | 说明 |
|---|---|---|
| **质押** | `TransferAssetFromTo(自己 → B, 4001, N)` | 触发 `PayableAsset`，`sh:<自己>` 增加 |
| **赎回质押** | `TransferAssetFromTo(B → 自己, 4001, N)` | 触发 `PermitAsset`，**先结算再减份额** |
| **领取分红** | `ContractMainCall(B, 'claim')` | 把增量结算进 `due`，**钱仍在合约里** |
| **提现** | `TransferHacFromTo(B → 自己, X)` | 触发 `PermitHAC`，钱真正到账 |

**领取和提现是两步，必须都做。** 只 claim 的话，钱包余额不会变。

建议用 `combo` 原子交易把两步合并（见第 5 章）：

```json
{
  "contract": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
  "actions": [
    { "type": "call", "contract": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
      "fn": "claim", "params": "-" },
    { "type": "hac-from-to", "from": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
      "to": "<你的地址>", "hac": "23.52940000" }
  ]
}
```

⚠ **顺序不能反。** 先提现再 claim 只能提走旧的 `due`，新分红留在合约里（不会丢，但用户体验差）。

### 4.4 续租基础设施

合约 B 需要定期续租存储键，否则账本会被删除。它提供四个**无许可**入口，任何人都可以调用并领报酬：

| 函数 | 续租什么 | 报酬来源 |
|---|---|---|
| `claim()` | 只续**调用者自己**的 3 个键 | 无（自己为自己付 gas） |
| `pay_rent(period)` | 续 B 自己的 3 个全局键 | `reserve:rent` |
| `pay_rent_ahac(group, period)` | 续**合约 A** 的某组键 | `reserve:rent` |
| `pay_rent_shares(addrs, period)` | 续**股东**的地址键 | `reserve:rent` |

**`pay_rent_shares` 是 2026-11-18 新增的**，参数说明：

| 参数 | 类型 | 说明 |
|---|---|---|
| `addrs` | `bytes` | **连排的 21 字节地址**（不是可读字符串），`size % 21 == 0` |
| `period` | `u128` | 目标租期，区间 `[30, 3000]` |

返回值：

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 2 | 空参数 |
| 3 | 长度不整除 21 |
| 60 | 地址过多（单笔容量随 period 变化） |
| 62 | period 过小 |
| 63 | period 过大 |

**单笔能装几个地址取决于 period：**

| period | 每地址 gas | 单笔上限 |
|---|---|---|
| 30 | 3,240 | 34 个地址 |
| 100 | 10,800 | 10 个地址 |
| 300 | 32,400 | 3 个地址 |
| 1000 | 108,000 | 1 个地址 |
| 1027 | 110,916 | 1 个地址（物理极限） |
| 1028+ | — | **0（下单都放不下）** |

计算公式：`3 键 × 36 unit × period ≤ 111,000`（storage 桶上限）。

### 4.5 索引器新增端点

**`GET /vault_addr_batches?max=N`**

返回金库 B 的**股东地址**（连排 21 字节 hex），供 keeper 构造 `pay_rent_shares` 调用。

```json
{
  "ret": 0,
  "batches": [{ "blob": "00333ca1f19b602275f871a308675dfece685ae8e7", "count": 1 }],
  "total": 1,
  "max_addrs": 10
}
```

⚠ 只返回**与 B 交互过**的地址（2026-11-20 起）。之前会把 A 的用户也塞进来，导致对 B 里不存在的键白付手续费。

---

## 5. 原子交易（combo）

一次交易里完成多个动作，**要么全部成功，要么全部回滚**。OTC 股权转让就靠它。

### 5.1 构建

```
POST /api/build
{
  "mode": "combo",
  "main": "<交易主地址>",
  "spec": { "contract": "...", "actions": [...] },
  "gasMax": 99
}
```

`spec.contract` **只在含 `call` 动作时才需要**。纯转账不用。

### 5.2 支持的动作类型

| type | 字段 | 说明 |
|---|---|---|
| `hac-to` | `to`, `hac` | main 转出 HAC |
| `hac-from-to` | `from`, `to`, `hac` | 指定地址转 HAC（需该地址签名） |
| `asset-to` | `to`, `serial`, `atoms` | main 转出资产 |
| `asset-from-to` | `from`, `to`, `serial`, `atoms` | 指定地址转资产 |
| `hacd-to` | `to`, `names` | main 转出钻石 |
| `hacd-from-to` | `from`, `to`, `names` | 指定地址转钻石 |
| `call` | `contract`, `fn`, `params` | 合约调用 |

### 5.3 分步签名（OTC 必需）

链上规则（`protocol/src/codec/tx.rs:450` `verify_type3_signatures_exact`）：**Type-3 交易的签名数必须等于签名者数**，**广播时**必须签齐。

但 `insert_sign` 只负责追加、不做数量校验 —— 所以「A 签一版 → 发给 B → B 追加签名」在协议层完全可行。

**流程：**

```
① A 构建未签名体          → /api/build mode=combo
② A 签名                  → tx:signRaw
   返回 signed_check = PARTIAL (1/2) — 还需要 1 个签名
③ A 把 signed_tx_hex 发给 B
④ B 翻译这份交易体         → /util/transaction/check?description=true&action=true
   ⚠ 必须逐项核对「你将付出」和「你将收到」
⑤ B 追加签名              → tx:signRaw（同一份 hex）
   返回 signed_check = OK (all signers signed)
⑥ 广播
```

**A 的签名不会因为传给 B 而失效** —— sign 是在原有基础上追加，不是重签。

### 5.4 ⚠ 交易体没有有效期

链上没有"过期时间"字段。签名交给对方后，这笔交易**随时可能被广播，无法撤回**。

客户端必须把这句话显示在最显眼的位置。

### 5.5 翻译器的字段名（易错点）

节点 `/util/transaction/check` 返回的动作字段名，**与 spec 的字段名不一样**：

| 链上动作 | JSON 字段 |
|---|---|
| `TransferHacFromTo`(14) | `hacash`（**不是** `hac`） |
| `TransferAssetFromTo`(19) | `asset: { serial, amount }` |
| `TransferHacdFromTo`(6) | `diamonds`（单颗是 `diamond`；**不是** `names`） |
| 地址 | `AddrOrPtr` —— 可能是**指针索引数字**，此时拿不到可读地址 |

指针形式拿不到地址时，该笔的「收款人是否是我」判定结果为空 → 整体标记为未核实，UI 必须显示警告。**不能因为看不出问题就放过**。

---

## 6. 交易所上币对接

### 6.0 先记住一件事：amount 是整数个数

hacds 是 **decimal 0** 的资产。链上返回的 `amount` 就是个数，**不做任何换算**。

```json
{"serial": 4000, "amount": "100000000"}   →  100,000,000 个 hacds
```

上一版是 decimal 8，要除以 1e8。**这一版不要除。**

### 6.1 资产身份（用于上币登记）

| 字段 | 值 |
|---|---|
| serial | `4000` |
| ticket | `HACDS` |
| name | `hacds` |
| decimal | `0` |
| supply | `5963298700000000` |
| issuer | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` |

⚠ 链上还有一个 serial `1028` 的资产也叫 HACDS（name 是 "HACD Fragments"，别人的）。
**按 serial 认，不要按 ticket 认。**

⚠ serial `2000` 与 `3000` 都是已作废的历史发行（2000 是 #2000 版，3000 是第一轮主网
部署、配套股权 issuer 填错而整套废弃），**不要**用它们登记。

另有一套独立的股权资产（不是上币标的，仅供金库分红识别）：

| 字段 | 值 |
|---|---|
| serial | `4001` |
| ticket | `HACDS-SHARE` |
| decimal | `0` |
| supply | `10000` |
| issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q`（部署者地址，**不是合约**） |

### 6.2 充值识别

扫块，找 `TransferAssetFromTo` 动作，`serial == 4000` 且 `to == 你的充值地址`。

```
GET /query/block/intro?height={H}&tx_hash_list=true
  → 遍历 tx_hash_list，逐个 GET /query/transaction?hash={h}
  → 看 actions 里的 asset 转账
```

**建议确认数**：3 个块（约 15 分钟）。Hacash 出块目标 300 秒，但会有波动。

### 6.3 提现构造

提现是标准资产转账：

```bash
hacds_txbuild transfer {main} {ts} asset-from-to {from} {to} 4000 {amount}
```

> ⚠ **serial 必须写数字 `4000`，不要写 `hacds` 别名。**
> `hacds_txbuild` 里的 `hacds` 别名指向旧版 serial `2000`，与 #4000 版合约的
> `HACDS_SERIAL = 4000` 不一致，链上会被 `PermitAsset` 以 `return 1` 拒绝。
> 走 `/api/build` 时服务端会把 `hacds` 翻成它自己的 `HACDS_SERIAL_MAINNET`，但
> **命令行直接调用**不受这层保护。
>
> ⚠ 运维注意：`hacds_build_server.py` 的 `HACDS_SERIAL_MAINNET` 必须与合约的
> `HACDS_SERIAL` 相同（本轮应为 `4000`）。两轮部署都换过 serial（3000 → 4000），
> 换号时这处最容易漏，漏了的表现是「用 `hacds` 别名转账失败、写数字就成功」。

或者走构建服务（`mode=transfer`, `sub=asset-from-to`）。

### 6.4 广播与确认

```bash
POST {node}/submit/transaction
{"tx": "...hex..."}
```

`ret:0` 只代表进内存池。按块高回查 `/query/transaction?hash=`，
`block_height` 出现才算确认。

### 6.5 手续费与 gas

| 项 | 说明 |
|---|---|
| fee 格式 | `值:尾数`，如 `0:248`（极小）、`2:247`（0.02 HAC） |
| 手续费公式 | `fee = purity × billing_size` |
| `gasMax` | `1–99`，默认 99。**合约调用不要低于 99** |

### 6.6 三个必知的硬限制

**① 单笔交易 16,384 字节。** 这是编译期常量。存取 200 颗钻石的交易接近这个上限。

**② 沙箱每 IP 并发 = 2。** 超了直接拒绝，不排队。交易所后端必须串行化。

**③ 三个 gas 桶**：compute 18,009 / resource 6,100 / storage 111,911。
超了报 `OutOfGas(31): <桶名> N > M`。**提高 `gasMax` 无效**——那是总额度，
单桶上限是硬约束。

> #4000 之所以能把「单笔 1 颗」提到「单笔 200 颗」，就是因为把算分挪进了
> RV64IM 内核：200 颗只花 3,587 compute，一个桶装得下。旧版 FitSH 算 1 颗就要
> 3,270 resource，2 颗就超 6,100。

### 6.7 做市 / 报价需要的数据

```
GET {node}/query/contract/sandboxcall?contract={合约}&function=amm_reserves&caller={合约}
GET {node}/query/contract/sandboxcall?contract={合约}&function=amm_reserve_ds&caller={合约}
```

现货价（zhu per hacds）= `amm_reserves × 1e8 / amm_reserve_ds`。

批量拿更省事：

| 函数 | 一次拿到 |
|---|---|
| `ref_price_zhu_per_ds` | 平滑参考价 |
| `pool_price` | 池价（×1e8） |
| `total_debt` / `utilization` | 借贷利用率 |
| `hacd_count` / `hacd_avg_score` | 池子规模 |

### 6.8 对账

链上恒等式：

```
用户 due 总和 + AMM 池 + 金库累积 + LP 奖励池  ==  链上已发行的 hacds 总量
```

再加一条：

```
有效 HAC 余额总和 × hcut == 名义份额总和
```

索引器的 `GET /backing` 每次同步都会核对这个。对不上就是有 bug。

### 6.9 上币对接清单

- [ ] 用 serial `4000` 登记，decimal 填 `0`（**不是 8**）
- [ ] 充值只认 serial 4000，忽略同名 ticket 的 #1028
- [ ] 提现用 `asset-from-to`，`serial` 直接写 `4000`（别用别名）
- [ ] 确认数 ≥ 3
- [ ] 后端对沙箱调用串行化（并发上限 2）
- [ ] 大额提现检查交易大小是否撞 16,384 字节上限
- [ ] 对账用 `/backing` 和链上恒等式

---

## 7. 错误处理

### 7.1 合约返回码

沙箱调用返回的 `ret_val` 非 0 时，是合约函数内部的 `return N`。

**通用**

| 码 | 含义 |
|---|---|
| `2` | 参数格式错（如 HACD 名列表 wire 格式不合法） |
| `48` | 数量越界（存 0 颗 / 超 200 颗 / 赎回不是 1 颗） |
| `5` | 评分为 0 |
| `53` | 超出总供应上限 |
| `54` | 覆盖率不足（100% 发行下恒不触发） |
| `59` | 已过期（`deadline`） |
| `61` | HACD 池无记录 / 分数不足（赎回） |

**AMM**

| 码 | 含义 |
|---|---|
| `2` | 某一侧为 0 |
| `23` | 池非空但份额归零（防尺度重置） |
| `24` | 份额算出来为 0（比例太小） |
| `25` | LP 份额不足 |
| `26` | 首注单侧超过上限 `1e18` |
| `56` | 滑点保护触发（`min_out` / `min_share` 未达） |

**借贷**

| 码 | 含义 |
|---|---|
| `40` | 超出可借额度（`(debt+hac) × 200% > coll_hac`） |
| `41` | 债务为 0（还款） |
| `50` | 全局利用率超 50% |
| `51` | 借款已暂停（利用率满 或 价格熔断） |
| `52` | 超过单借款人上限（20%） |

**清算**

| 码 | 含义 |
|---|---|
| `42` | 该地址无债务 |
| `43` | 未达清算线（不可清算） |
| `44` | 清算金额低于最小额（1 HAC） |
| `45` | 抵押产出低于 `min_coll_out` |
| `46` | 深水清算要求全额（`repay < deep_pay`） |
| `47` | 参考价未初始化，拒绝清算 |

**管理员相关的一律不存在**

`set_fee` / `set_loan_rate` / `set_liquidate_bonus` / `set_paused` / `set_oracle`
在 #4000 里**没有实现**。调用它们会返回：

```
CallNotExist(51)
```

这不是权限不足，是**函数不存在**。别再写这些调用了。

### 7.2 节点 / 沙箱错误

按字符串匹配，常见几类：

| 原始信息 | 含义 | 处理 |
|---|---|---|
| `NotFindContract` | 该地址没有合约代码 | 检查合约地址是否为本轮的 `bw2sRC…` |
| `invalid address argument` / `InvalidChecksum` | 地址格式或校验位错 | 重新取完整地址 |
| `balance ... is insufficient` | 调用者余额不足付预扣 gas | 沙箱调用传 `caller={合约地址}` |
| `sandbox_per_ip_concurrency_exceeded` | 并发超限 | 串行化 + 退避重试 |
| `resource gas limit exceeded` | resource 桶超限 | 拆笔；**提高 gas_max 无效** |
| `compute gas limit exceeded` | compute 桶超限 | 拆笔 |
| `storage gas limit exceeded` | storage 桶超限 | 减少新键或降租期 |
| `OutOfGas(31)` | 某个桶不够 | 看括号里的桶名，拆笔 |
| `Arithmetic(90)` | 算术下溢/上溢 | 检查参数；这是合约 bug，请报告 |
| `CallNotExist` | 合约没有这个函数 | 检查函数名（管理员函数已删除） |
| `state changed` | 期间链上状态变了 | 重试 |
| `transaction parse failed` | 交易体解析失败 | hex / 字节不完整 |
| `StorageNotActive` | 存储键已过期 | 调 `rent_keys` 续租 |
| `ECONNREFUSED` / `timeout` | 服务不可达 | 检查服务是否在跑 |

**判别要点**：这些错误大多是 **HTTP 200 + `{"ret":1,"err":"..."}`**，
只看 HTTP 状态码会漏掉。

---

## 8. 快速参考

### 8.1 端点汇总

```
# 全节点
GET  /query/block/height/latest
GET  /query/fee/average
GET  /query/balance?address={A}&assets=true&diamonds=true
GET  /query/diamond?name={N}
GET  /query/contract/sandboxcall?contract={C}&function={F}&params={P}&caller={C}
GET  /query/block/intro?height={H}&tx_hash_list=true
GET  /query/transaction?hash={H}
POST /util/transaction/check        {"tx": "hex"}
POST /submit/transaction            {"tx": "hex"}

# 索引器
GET  /health
GET  /snapshot
POST /sync
GET  /backing
GET  /rent_batches

# 构建服务
GET  /health
POST /api/build
```

### 8.2 常量

| 常量 | 值 |
|---|---|
| 部署者 | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| 合约地址 | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` |
| 合约 nonce | `5` |
| 金库分红合约 B | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`（nonce 4） |
| `TREASURY` | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`（指向合约 B） |
| `BURN_ADDR` | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`（合约 A 自身） |
| hacds serial | `4000` |
| hacds decimal | `0` |
| hacds 总供给 | `5963298700000000` |
| 股权 serial | `4001` |
| 股权 issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| `SHARE_TOTAL` | `10000` |
| `RENT_RATIO_BPS` | `2000`（续租 20% / 分红 80%） |
| `RPU_SCALE` | `1000000000000`（1e12） |
| `MINIMUM_LIQUIDITY` | `1000` |
| `SCORE_SCALE` | `100000000`（1e8） |
| `MAX_DEPOSIT_COUNT` | `200` |
| `FEE_BPS` | `50`（0.5%） |
| `BORROW_RATIO_BPS` | `20000`（200%） |
| `LIQ_COLL_RATIO_BPS` | `16000`（160%） |
| `CLOSE_FACTOR_BPS` | `5000`（50%） |
| `DEEP_TRIGGER_BPS` | `10500`（105%，深水接管） |
| `DEEP_WATER_BPS` | `9000`（90%，可整笔清算） |
| `DEEP_DISCOUNT_BPS` | `300`（3%，深水给清算人的折扣） |
| `LIQ_PROTOCOL_BPS` | `100`（1%，清算奖励里给储备的部分） |
| —— 合约 B —— | |
| `PERIOD_NEW`（B） | `100` |
| `RENT_PERIOD`（B） | `300` |
| `RENT_MIN_PERIOD`（B） | `30` |
| `RENT_MAX_PERIOD`（B） | `3000` |
| `AHAC_MIN_PERIOD` | `300` |
| `AHAC_MAX_PERIOD` | `3000` |
| `RENT_REWARD_ZHU` | `5000000`（每键 0.05 HAC） |
| `STORAGE_BUDGET` | `111000` |
| `RENT_KEY_UNIT` | `36` |
| `LIQ_BONUS_BPS` | `500`（5%） |
| `U_MAX_BPS` | `5000` |
| `LENDABLE_AMM_BPS` | `3000` |
| VM 三桶 | compute 18,009 / resource 6,100 / storage 111,911 |
| 交易上限 | 16,384 字节 |
| gasMax 范围 | 1–99 |

### 8.3 单位换算

**HAC**（链上 zhu）：

```
HAC = zhu / 1e8
"5:249" = 5 × 10^(249−248) = 50 HAC
"1:248" = 1 HAC
```

**hacds**（decimal 0）：

```
hacds 个数 == 链上整数，不做换算
```

⚠ **不要对 hacds 除以 1e8。** 那是上一版（decimal 8）的做法。

### 8.4 一段最小可用的读状态代码

```javascript
const NODE = 'https://api.hacds.com';
const CONTRACT = 'bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h';

async function call(fn, params = '') {
  const q = new URLSearchParams({
    contract: CONTRACT,
    function: fn,
    params,
    caller: CONTRACT,       // 不传会因余额不足失败
  });
  const r = await fetch(`${NODE}/query/contract/sandboxcall?${q}`);
  const j = await r.json();
  if (j.ret !== 0) throw new Error(j.err || 'call failed');
  return j.ret_val;
}

// 池子两侧储备
const hacZhu = await call('amm_reserves');
const ds     = await call('amm_reserve_ds');

// 现货价（zhu per hacds）
const spot = Number(hacZhu) * 1e8 / Number(ds);
```

**并发注意**：每个 IP 只有 2 个并发名额。批量读要排队，不要 `Promise.all`。

---

*本文档对应合约 `HacdsDeFi3000.fitsh` 定稿版本，主网第二轮部署（2026-11-18）。*
