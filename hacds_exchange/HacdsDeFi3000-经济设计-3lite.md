# HacdsDeFi #3000 · 经济设计 3-lite（定稿草案）

> 状态：设计定稿草案；合约尚未按本文修改。
> 最近修订：2026-10-23（mint 改为不打折、lpr 名义口径、深水付款封顶、清算溢价上限提到 30%）。
> 目标：在“单合约、单 HAC/hacds 物理余额”的现实下，用部分共享 + 硬缓冲取得资本效率与风险隔离的平衡。
> 依据：安全审计/整改/3000版合约-设计草案.md、安全审计/整改/合约奖励来源与分配.md、第二轮经济评审。
> 结论：不做 full 3（AMM 的 HAC 全部可出借），也不做 full 1（AMM 的 HAC 完全预留）；采用 3-lite。

---

## 0. 一句话

- AMM 的 HAC 只有 30% 可出借；70% 留在 AMM 作为交易/退出缓冲。
- 借贷总利用率 ≤50%；单借款人 ≤20%。
- 贷款利息 80% 给 HAC 提供者（bal:hac 存款人 + 可出借的 amm:hac 按比例），20% 进坏账储备。
- 坏账先扣链上 res:hac，不足记 def:hac；v1 就用 hcut:hac 做全局社会化（见 §8A），不留到 Phase 2。
- 清算线低于借款线（默认 160% 抵押率，即 20% 价格缓冲）；固定清算奖励 + close factor；深水用折扣/拍卖。
- 预言机用 EMA 时间加权价替代“现货 + ±20% 硬带”；大跌时暂停借款，不冻结清算。
- HACD 仍 1 颗/笔；**mint 100% 不打折**（S≡C，无超发风险）、赎回费 0.5%、高分 HACD 加收至多 30% 的挑钻石溢价；新增覆盖率视图。
- 不做治理代币、不做增发、不引入管理员；参数为编译期常量，自动稳定器承担大部分调节。

---

## 1. 设计原则

1. 先保命，再提效率：AMM 的退出权和借贷的信用风险必须先隔离出一部分，不能全部共享。
2. 账本分开 + 风险预算明确：amm:hac、bal:hac、loan:*、res/def 是同一资产负债表上的不同科目；每个科目承担什么风险必须写清楚。
3. 风险可计量：利用率、可出借 AMM HAC、坏账储备、赤字、HACD 覆盖率、LP NAV 都要有链上视图。
4. 无管理员：不新增 admin/pause 权限；用自动稳定器（EMA、动态利率、覆盖率闸门、储备目标、社会化阈值）替代人工参数调整。
5. 费用实物分配：不引入治理代币；LP 拿 AMM/赎回费，HAC 提供者拿利息，储备拿第一损失补偿。
6. 1 HACD/笔：VM resource 6,100、单颗评分约 3,270 resource，这是硬约束；合约硬限制 count == 1。

---

## 2. 资金与账本

### 2.1 物理余额与科目

合约只有一个地址、一个 HAC 余额和一个 hacds 余额。以下都是科目（ledger bucket），不是独立地址：

| 科目 | 含义 | 是否可出借 | 风险承担 |
|---|---|---|---|
| bal:hac:<addr> / tot:hac | 用户 HAC 存款/借款积分 | 是（存款人） | 信用风险 + 流动性风险 |
| amm:hac | AMM 的 HAC 侧 | 仅 30% | 有限信用风险（30%） |
| amm:ds | AMM 的 hacds 侧 | 否 | 无信用风险；有 IL |
| due:<addr> / loan:coll:<addr> / tot:ds | hacds 应付配额/抵押 | 否 | 作为借款抵押 |
| loan:debt:<addr> | HAC 贷款（应收） | — | 借款人信用风险 |
| tre:hac: / tre:ds: | 金库待清扫手续费 | 否 | 金库运营 |
| res:hac: | 坏账储备（新） | 否（现金缓冲） | 第一损失 |
| def:hac: | 未覆盖赤字（新） | — | 待未来费用补/社会化 |
| lpr:hac: / lpr:ds: | 未结算 LP 奖励负债（新） | — | LP 债权 |
| res:hacd_score / res:hacd_count | HACD 池总分数/颗数（新） | — | HACD 覆盖率 |
| lpu:hac: / lpu:ds: / lch:* | LP 每份额奖励累加器/检查点 | — | LP 收益 |
| rpu:hac: / rpu:ds: / chk:* | 存款人每单位奖励累加器/检查点 | — | 存款人收益 |
| amm:ref / amm:refh | EMA 参考价/更新时间 | — | 抵押估值 |
| borrow:paused | 借款熔断标志（新） | — | 风控 |
| hcut:hac | 有效 HAC / 名义份额（新） | — | 社会化 |

### 2.2 关键定义

- lendable_amm_hac = mul_div(amm:hac, LENDABLE_AMM_BPS, 10000)
- amm:spot = mul_div(amm:hac, SCORE_SCALE, amm:ds)（派生，不单独存储）
- amm_reserved_hac = amm:hac - lendable_amm_hac
- providers = tot:hac * hcut / HCUT_SCALE + lendable_amm_hac（见 §8A）
- utilization = tot:debt / providers（tot:debt 为所有借款人债务之和；需要新增聚合键）
- net_claims_hac = tot:hac * hcut / HCUT_SCALE + amm:hac + tre:hac + res:hac + lpr:hac * lcut / LCUT_SCALE - def:hac
- coverage_ds = res:hacd_score * 10000 / (tot:ds + amm:ds + tre:ds + lpr:ds)

### 2.3 不变量

HAC 侧（硬）

    P + Σ loan:debt >= tot:hac * hcut / HCUT_SCALE + amm:hac + tre:hac + res:hac + lpr:hac * lcut / LCUT_SCALE - def:hac

- P = 合约物理 HAC 余额；
- Σ loan:debt = 贷款应收；
- def:hac 是“已确认但未覆盖的损失”，作为负项；net_claims_hac 是有效债权；
- 坏账增加 def 时，有效债权下降；未来费用先补 def；社会化时同时下降 tot:hac/amm:hac 和 def，不变量保持。

hacds 侧（硬）

    H >= tot:ds + amm:ds + tre:ds + lpr:ds

- H = 合约物理 hacds 余额；
- tot:ds 包含 due + loan:coll（抵押是配额再分类，不减少总量）；
- lpr:ds 是未结算 LP 奖励，必须计入负债，否则会低估。

覆盖率（软闸门 + 视图）

    coverage_ds = res:hacd_score * 10000 / (tot:ds + amm:ds + tre:ds + lpr:ds)

- coverage_ds >= 10000（100%）时允许 mint；
- 低于 100%：暂停 mint，赎回仍可进行（赎回会降低分母、改善覆盖率）；
- 低于 9000（90%）：赎回进入队列/加收 haircut（Phase 2；v1 先只暂停 mint + 提高赎回溢价）。

流动性（监控 + 操作约束）

    P >= amm_reserved_hac + res:hac + tre:hac + MIN_CASH_BUFFER

- 这不是会计恒等式，而是现金缓冲目标；loan_borrow 用 U_MAX 和 BORROWER_CAP 约束，remove_liquidity / PermitHAC 在现金不足时失败/排队（见 §11/§13）。
- MIN_CASH_BUFFER 由参数表给出；v1 先靠 U_MAX=50% + AMM 70% 预留实现，不额外加硬检查。

### 2.4 新增聚合键

- tot:debt：Σ loan:debt。现有代码没有聚合债务；utilization、providers、坏账压力测试都需要它。每次借款/还款/利息/清算同步加减。
- tot:debt 必须与逐借款人 loan:debt 的 Σ 一致；在 accrue_interest / loan_borrow / loan_repay / loan_liquidate 里显式维护。
- 不建议复用 kind_suffix；tot:debt 单独键，避免影响 HAC/hacds 的 tot 语义。

---

## 3. 参数表（2026-10-23 定稿，含链上实测校准）

| 参数 | 初值 | 含义 | 备注 |
|---|---:|---|---|
| LENDABLE_AMM_BPS | 3000 | AMM HAC 可出借比例 30% | 3-lite 核心 |
| U_MAX_BPS | 5000 | 总利用率上限 50% | 留 50% 现金 |
| BORROWER_CAP_BPS | 2000 | 单借款人 ≤20% providers | 防鲸鱼 |
| COLL_RATIO | 2 | 借款线：债务 ≤ 抵押价值/2（50% LTV） | 不变 |
| LIQ_COLL_RATIO_BPS | 16000 | 清算线：抵押率 160%（20% 缓冲） | 保守；18000=10% 缓冲 |
| LIQ_BONUS_BPS | 500 | 清算总奖励 5% | 由借款人承担 |
| LIQ_PROTOCOL_BPS | 100 | 奖励中 1% 给储备 | 清算人净得 4% |
| CLOSE_FACTOR_BPS | 5000 | 普通清算最多 50% 债务 | 深水 100% |
| DEEP_WATER_BPS | 9000 | 健康度 <90% 阈值时允许全额清算（close factor 100%） | 健康度 10000=清算线；与 DEEP_TRIGGER_BPS 不同 |
| DEEP_DISCOUNT_BPS | 300 | 深水接管式清算给清算人 3% 折扣 | 或改用拍卖（Phase 2） |
| DEEP_TRIGGER_BPS | 10500 | 抵押价值 <105% 债务时进入深水接管 | 正常分支要求 ≥105%；建议 = 10000 + LIQ_BONUS_BPS |
| RES_TARGET_BPS | 300 | 坏账储备目标 = 3% providers | 上限，不无限累积 |
| DEF_ALERT_BPS | 500 | def >5% providers 时**告警**（链下监控，非合约常量） | 原 SOCIALIZE_BPS；社会化已改为立即瀑布，见 §15.4 |
| INT_PROVIDER_BPS | 8000 | 利息 80% 给 HAC 提供者 | 存款人+可出借 AMM HAC |
| INT_RESERVE_BPS | 2000 | 利息 20% 给储备 | 先补 def，再补 res，余进 tre |
| LP_BPS | 8000 | AMM 费 80% 给 LP | 20% 进 apply_reserve/tre |
| REDEEM_FEE_BPS | 50 | 赎回费 0.5% | 80% LP / 20% tre |
| MINT_HAIRCUT_BPS | 10000 | **不打折**，mint = score | 已定；§12.5 |
| CHERRY_PREMIUM_MAX_BPS | 3000 | 高分 HACD 赎回溢价上限 30% | 已定；原 500 拦不住挑钻石 |
| CHERRY_SLOPE_BPS | 10000 | 溢价斜率 | 用 min 封顶；见 §12 |
| COVERAGE_MIN_BPS | 10000 | HACD 覆盖率 mint 闸门 100% | 低于则暂停 mint |
| REF_WINDOW | 300 | EMA 时间常数（块，约 1 天） | 原 REF_WINDOW |
| REF_DEV_BPS | 2000 | 熔断阈值：现货偏离 EMA >20% | 暂停借款，不冻结清算 |
| EMA_MAX_STEP_BPS | 1000 | 单次更新最多走窗口的 10% | 防一次跳变 |
| MINIMUM_LIQUIDITY | 1000 | 首注死份额 | 防首 LP 攻击 |
| ADD_TOL_BPS | 100 | 加池比例容差 1% | 或直接按比例取用 |
| BASE_RATE_BPS | 200 | 基础年化 2% | 利用率模型 |
| SLOPE1_BPS | 400 | 0→U_OPT 的斜率 4% | |
| SLOPE2_BPS | 4000 | U_OPT→U_MAX 的斜率 40% | |
| U_OPT_BPS | 3500 | 最优利用率 35% | |
| BLOCKS_PER_YEAR | 105120 | 一年块数 | 现有 |
| MIN_LIQ | 100000000 | 最小清算额 1 HAC | 现有 |
| LIQ_GRACE_BLOCKS | 0 | v1 不启用；Phase 2 可设 288 | 借款人保护 |
| HACDS_SUPPLY | 5963298700000000 | hacds 固定总供应（atoms） | 现有资产 |
| HCUT_SCALE | 1000000000000 | 有效 HAC / 名义份额标度 1e12 | §8A |
| HCUT_MIN | 1000000 | hcut 下限 1e6 | 防归零/溢出 |
| RENT_REWARD_HAC | 7000000 | keeper 每键续租奖励 **0.07 HAC** | **实测校准**（成本 0.054 × 1.3）；见 §15.2 |
| RENT_THRESHOLD | 100 | 剩余租期低于此值才续租并付酬 | 已定；防重复领赏，见 §15.2 |

> 参数是编译期常量；改参数 = 重新部署/迁移。上线前需用压力测试校准 LIQ_COLL_RATIO_BPS、RES_TARGET_BPS、U_MAX_BPS、SLOPE2_BPS。

---

## 4. 预言机：EMA 时间加权价 + 熔断

### 4.1 现状问题

- 现有 ref_refresh：距上次 ≥300 块、且现货偏离 ref ≤±20% 时，把 ref 更新为当前现货。
- 21% 的跌幅会让现货落在 ±20% 外，ref 永久冻在旧价；真实健康度已低于阈值，清算被冻结。
- 300 块到期时，攻击者可在同一笔 combo 内先 swap 把现货推到 ±20% 内，再 ref_refresh，用被操纵的现货借款/清算。
- 这不是 TWAP，只是“带硬带的现货快照”。

### 4.2 EMA 设计

状态：amm:ref（zhu per atom × SCORE_SCALE）、amm:refh（上次更新时间）、borrow:paused。

每次 amm_swap / add_liquidity / remove_liquidity / ref_refresh 调用：

    now = block_height()
    dt = now - refh
    if amm:ds == 0: return
    spot = mul_div(amm:hac, SCORE_SCALE, amm:ds)
    if ref == 0:
        ref = spot; refh = now; borrow:paused = 0; return
    w = min(dt, REF_WINDOW * EMA_MAX_STEP_BPS / 10000)
    // 单次最多走窗口的 10%，防止一次跳变
    newref = (ref * (REF_WINDOW - w) + spot * w) / REF_WINDOW
    ref = newref
    refh = now
    dev = abs(spot - ref) * 10000 / ref
    borrow:paused = (dev > REF_DEV_BPS) ? 1 : 0

- 单笔 swap 的 dt 通常 1 块，权重 1/300；对 ref 的影响约 0.33%，不是 20%。
- 若长期无人更新，单次最多走 10% 窗口；需要多次更新才能跟上，避免一次跳变。
- 攻击者要持续操纵价格多个窗口，成本远高于一次现货快照。
- 不是完整 TWAP；是工程上更省存储的 EMA。若 VM 后续支持便宜的累计价格环形缓冲，可替换为窗口 TWAP，接口不变。

### 4.3 熔断规则

- dev > REF_DEV_BPS（20%）：
  - borrow:paused = 1；
  - loan_borrow 返回 51（暂停借款）；
  - loan_add_collateral、loan_repay 仍可用；
  - loan_liquidate 不暂停；清算估值用 min(spot, ref)（保守价）。
- dev <= 20%：borrow:paused = 0，自动恢复。
- 无管理员；熔断由价格偏离自动触发。

### 4.4 清算估值

- 正常/深水清算：liq_price = min(spot, ref)；
- coll_hac_liq = mul_div(coll, liq_price, SCORE_SCALE)；
- 触发条件、抵押价值、min_coll_out 都用 coll_hac_liq；
- 借款仍用 EMA ref（不是 min），但被 borrow:paused 保护；
- 这样大跌时清算不会被冻结，而是按更低、更保守的价格执行。

### 4.5 初始化

- 部署交易在池子有初始 HAC/hacds 后显式写 amm:ref = spot、amm:refh = block_height；
- 若未初始化：ref = 0；loan_borrow 返回 50（无参考价），loan_liquidate 返回 47；
- 首次 add_liquidity 在池空时不能设 ref（没有价格）；部署流程必须补。

---

## 5. LTV、清算线、健康度

### 5.1 借款线与清算线分离

- 借款：debt * COLL_RATIO <= coll_hac，COLL_RATIO = 2（抵押率 200%，LTV 50%）；
- 清算：debt * LIQ_COLL_RATIO_BPS > coll_hac * 10000；
  - LIQ_COLL_RATIO_BPS = 16000 → 抵押率 160%，从满借 200% 到清算有 20% 价格缓冲；
  - 若项目更看重资本效率，可设 18000（10% 缓冲）；薄资产建议 16000。
- 不再共用 COLL_RATIO；新增独立常量。

### 5.2 健康度

- 链上视图 loan_health(who) 返回 health_bps：

    debt_now = accrued_debt(who)
    liq_price = min(amm:spot, amm:ref)
    coll_hac_liq = mul_div(loan:coll, liq_price, SCORE_SCALE)
    health_bps = coll_hac_liq * 10000 / (debt_now * LIQ_COLL_RATIO_BPS / 10000)

  - health_bps = 10000 正好在清算线；<10000 可清算；
  - UI 健康度与清算用同一个 min(spot, ref)，避免大跌时界面高估健康度；
- 原有 loan_status 可以保留“抵押率×100”的口径（200=200%），同时新增 loan_health 和 loan_liq_ratio；UI 用新视图，避免误读。

### 5.3 应计利息必须进视图

- loan_status / loan_debt_of 目前只读 loan:debt，不补利息；
- 新视图 accrued_debt(who)：

    debt = loan:debt
    last = loan:last
    dt = block_height - last
    U = tot:debt / providers
    rate = rate_model(U)
    interest = debt * rate * dt / (10000 * BLOCKS_PER_YEAR)
    return debt + interest

- loan_status 用 accrued_debt；loan_liquidate 仍在写状态前 accrue_interest；
- 这样 UI/索引器的健康度与链上清算一致，不会“界面安全、链上可清算”。

### 5.4 借款宽限期（Phase 2）

- LIQ_GRACE_BLOCKS = 0（v1 不启用）；
- Phase 2 可加 liq:since:<addr>：首次越过清算线时置块高；loan_liquidate 要求 now >= liq:since + GRACE；借款人可在这段时间补抵押/还款；
- 优点：给借款人反应时间；缺点：多一个键、多一步 mark_unhealthy，且延迟坏账处置。v1 先用 20% 缓冲 + close factor。

---

## 6. 利率模型（利用率曲线）

### 6.1 公式

    providers = tot_eff + lendable_amm_hac
    U = (providers == 0) ? 0 : tot:debt * 10000 / providers

    if U <= U_OPT_BPS:
        rate_bps = BASE_RATE_BPS + SLOPE1_BPS * U / U_OPT_BPS
    else:
        rate_bps = BASE_RATE_BPS + SLOPE1_BPS
                 + SLOPE2_BPS * (U - U_OPT_BPS) / (U_MAX_BPS - U_OPT_BPS)

- 初值：2% 基础、35% 以下 4% 斜率、35%→50% 40% 斜率；
- U=0 → 2%；U=35% → 6%；U=50% → 46%；
- 年化按块折算：interest = debt * rate_bps * dt / (10000 * BLOCKS_PER_YEAR)；
- 当前实现为单利、惰性计息；用计息时点的 U 近似整个区间。区间很长时会有偏差；v1 接受，文档记录。更精确需要时间加权/borrow index，Phase 2。

### 6.2 为什么不用固定 5%

- 利用率 100% 时存款人取不出，固定利率不会跳升吸引还款/存款；
- 利用率低时 5% 可能过高或过低；
- 没有 supply/borrow cap，大户可借空；
- Aave/Compound 的利用率曲线是行业标准；固定利率只适合有治理/补贴的场景。

### 6.3 借款上限

- 全局：tot:debt <= U_MAX_BPS * providers / 10000；
- 单借款人：loan:debt + hac_amt <= BORROWER_CAP_BPS * providers / 10000；
- 可选全局绝对上限 TOTAL_DEBT_CAP（HAC）；
- loan_borrow 返回：
  - 50 = 利用率/参考价/上限不满足（细分可拆 50/52）；
  - 51 = borrow:paused；
  - 52 = 单借款人上限；
  - 53 = 超过 hacds 供应上限（mint 侧）；
  - 40 = 抵押不足（现有）。

---

## 7. 利息与费用分配

### 7.1 利息 80/20

    fee = interest
    provider_part = fee * INT_PROVIDER_BPS / 10000      // 80%
    reserve_part  = fee - provider_part                 // 20%

    if providers == 0:
        apply_reserve(fee); return
    lp_share  = provider_part * lendable_amm_hac / providers
    dep_share = provider_part - lp_share

    // 存款人：rpu:hac（每名义单位 bal:hac）
    if tot:hac > 0:
        dep_nominal = mul_div(dep_share, HCUT_SCALE, hcut)
        rpu:hac += mul_div(dep_nominal, RPU_SCALE, tot:hac)
    else:
        reserve_part += dep_share

    // LP：lpr 存名义值（见 §8A.5），入账按 S/lcut 溢价
    if lpt:tot > 0:
        lp_nom = mul_div(lp_share, LCUT_SCALE, lcut)
        lpu:hac += mul_div(lp_nom, RPU_SCALE, lpt:tot)
        lpr:hac += lp_nom                       // 名义
    else:
        reserve_part += lp_share

    apply_reserve(reserve_part)

示例（假设 hcut=lcut=1）：tot:hac=100,000，amm:hac=100,000（lendable=30,000），providers=130,000；某期利息=10,000。provider_part=8,000；LP 份额=8,000×30,000/130,000≈1,846；存款人份额≈6,154；reserve_part=2,000。LP 的 1,846 只对应 30,000/130,000 的 HAC 信用风险；70,000 的 AMM 预留 HAC 不分利息、也不承担贷款信用风险。

- LP 的利息只按 lendable_amm_hac 分，不按整个 amm:hac；70% 预留的 HAC 不承担信用风险，也不分利息。
- 存款人 rpu 用 §8A 的 nominal 换算：dep_nominal = dep_share*S/hcut；rpu += dep_nominal*RPU_SCALE/tot。
- 存款人按 tot:hac 分；如果存款人为 0，dep_share 进储备。
- lpr:hac 是**名义**未结算 LP 奖励负债；lp_settle_leg(0) 结算时按名义扣减，落账时先 lcut 再 hcut 折两次（§8A.5）。

### 7.2 AMM 费 80/20 + 储备优先

    lp_part = fee * LP_BPS / 10000          // 80%
    res_or_tre = fee - lp_part              // 20%
    // LP 部分按现有 lpu:hac / lpu:ds 记，lpr 同步
    apply_reserve(res_or_tre)

- 20% 不再无条件进 tre；先补 def，再补 res 到目标，剩余才进 tre。
- 如果 LP 为 0，LP 部分并入 reserve/tre（现有逻辑）。

### 7.3 赎回费 80/20 + 挑钻石溢价

    base_fee = need * REDEEM_FEE_BPS / 10000
    premium  = need * cherry_premium_bps / 10000
    fee = base_fee + premium
    charge = need + fee

    total_sub(1, need + fee)
    lp_part = fee * LP_BPS / 10000
    tre_part = fee - lp_part
    lpu:ds += lp_part * RPU_SCALE / lpt:tot
    lpr:ds += lp_part
    tre:ds += tre_part

- 赎回费币种是 hacds；LP 拿到 lpu:ds，结算进 due；金库拿 tre:ds。
- 溢价只对“高于池子平均分”的 HACD 收；见 §12。
- 赎回费不直接补 HAC 坏账（币种不同）；金库可自行换成 HAC，或作为 tre:ds 的运营收入。

### 7.4 apply_reserve 顺序

    function apply_reserve(amt):
        if amt == 0: return
        // 1) 先补 def
        if def:hac > 0:
            use = min(amt, def:hac)
            def:hac -= use; amt -= use
        // 2) 再补 res 到目标
        if amt > 0:
            target = providers * RES_TARGET_BPS / 10000
            if res:hac < target:
                use = min(amt, target - res:hac)
                res:hac += use; amt -= use
        // 3) 剩余进 tre（金库/运营/keeper）
        if amt > 0:
            tre:hac += amt

- def:hac 是有效债权的负项；补 def 不增加任何人的余额，只是恢复“净债权”；
- res:hac 是链上储备，不随金库清扫；只有超过 target 的部分会通过 apply_reserve 进 tre（可扫）；
- tre:hac 可被 PermitHAC(cp=TREASURY) 清扫；清扫不能动 res。

---

## 8. 坏账、储备、赤字、社会化

### 8.1 损失路径

清算/违约时，**统一走一个 `apply_loss(loss)`**（完整瀑布见 §8A.4）：

    loss = debt - pay                       // 未收回的 HAC
    bad:borrower += loss                    // 记录原借款人失信额（审计用）

    function apply_loss(loss):
        // ① 链上储备第一损失
        use = min(loss, res:hac);  res:hac -= use;  loss -= use
        // ② 金库待清扫 HAC
        use = min(loss, tre:hac);  tre:hac -= use;  loss -= use
        // ③ 未结算 LP 奖励（按 lcut 折减，名义不变）
        lpr_eff = mul_div(lpr:hac, lcut, LCUT_SCALE)
        use = min(loss, lpr_eff)
        if lpr_eff > 0: lcut = mul_div(lcut, lpr_eff - use, lpr_eff)
        loss -= use
        // ④ LP 的可出借 AMM HAC（上限 30%）
        cap = lendable_amm_hac
        use = min(loss, cap);  amm:hac -= use;  loss -= use
        // ⑤ 存款人全局 hcut
        dep_eff = mul_div(tot:hac, hcut, HCUT_SCALE)
        use = min(loss, dep_eff)
        if dep_eff > 0 and use > 0:
            hcut = mul_div(hcut, dep_eff - use, dep_eff)
        loss -= use
        // ⑥ 仍不足 → 赤字 + 暂停借款
        if loss > 0:
            def:hac += loss
            borrow:paused = 1

> 早期草案的 `socialize_if_needed()` 已废弃：社会化不再是"事后触发"，而是 `apply_loss` 内部的固定顺序。
> `bad:borrower` 记的是**原始失信额**（含被 res 覆盖的部分），用于风控统计，不代表最终由谁承担。

### 8.2 社会化

项目已决定：**v1 就执行 hcut:hac**（合约不可升级，一次性做到位）。完整规范见 §8A。

核心瀑布：

    res:hac -> tre:hac -> LP 的可出借 HAC（≤30%）-> bal:hac 的全局 hcut -> def:hac

- 不再使用“逐个地址 haircut”；hcut 只作用于 bal:hac；
- amm:hac / tre:hac / res:hac 是单桶，直接按比例扣；
- LP 的损失上限是 lendable_amm_hac（30%），70% 预留 HAC 不受贷款信用损失；
- 剩下的未覆盖损失进 def:hac，并触发 borrow:paused / LP 新增暂停。

### 8.3 金库清扫

- PermitHAC(cp=TREASURY) 只允许清扫 tre:hac；
- res:hac 是独立键，不被清扫；
- tre:hac 的用途：运营、keeper 奖励、可选回购；不承担第一损失（第一损失是 res）。
- 建议 TREASURY 是链上多签/托管地址（合约常量不变，地址由项目控制）。

---


## 8A. hcut:hac（v1 定稿：一次性做到社会化）

> 项目决定：#3000 不可升级，v1 就实现 hcut:hac，不留到 Phase 2。
> 本节是 v1 的规范；§2–§14 中涉及 bal:hac 的 HAC 金额，按本节换算。

### 8A.1 为什么用 hcut，而不是逐个地址扣

- 合约无法枚举所有 bal:hac 地址；逐个 haircut 不可行；
- hcut:hac 是全局“有效 HAC / 名义份额”因子，存一次、所有 bal:hac 同时生效；
- amm:hac / tre:hac / res:hac / lpr:hac 是单桶，可以直接按比例扣，不需要 hcut；
- 只有 bal:hac 是逐地址的，才需要 hcut。

### 8A.2 定义

- HCUT_SCALE = 1,000,000,000,000（1e12）；初始 hcut:hac = HCUT_SCALE。
- LCUT_SCALE = 1,000,000,000,000（1e12）；初始 lcut:hac = LCUT_SCALE；lcut 只降不升。
- bal:hac:<addr> 与 tot:hac 是名义份额（nominal）。
- 有效 HAC：

      bal_eff = mul_div(bal_nominal, hcut, HCUT_SCALE)
      tot_eff = mul_div(tot:hac, hcut, HCUT_SCALE)

- amm:hac / tre:hac / res:hac 是有效 HAC，不乘 hcut。
- lpr:hac 是名义 LP 奖励负债；lpr_eff = lpr:hac * lcut / LCUT_SCALE。
- providers = tot_eff + lendable_amm_hac。
- HAC 侧不变量：

      P + Σloan:debt >= tot_eff + amm:hac + tre:hac + res:hac + lpr:hac * lcut / LCUT_SCALE - def:hac

- 名义不变量：tot:hac == Σ bal:hac（保持）。
- hcut 只降不升；新存款按当前 hcut 换成名义份额；未来费用/利息不恢复旧 hcut。

### 8A.3 所有 HAC 金额的换算表

| 操作 | 外部 HAC 金额 | bal:hac / tot:hac 变动 | 备注 |
|---|---|---|---|
| PayableHAC 存入 | amount | + amount * HCUT_SCALE / hcut | 向下取整；dust 留协议 |
| PermitHAC 普通提取 | amount | - amount * HCUT_SCALE / hcut | 向上取整；用户不能多提 |
| loan_borrow 记积分 | hac_amt | + hac_amt * HCUT_SCALE / hcut | 随后 TransferHacFromTo 提走 |
| loan_repay 扣积分 | pay | - pay * HCUT_SCALE / hcut | pay 是 HAC |
| 清算人付款 | pay + protocol_fee | - (pay+fee) * HCUT_SCALE / hcut | res/tre 收 HAC |
| swap HAC 入 | hac_in | - hac_in * HCUT_SCALE / hcut | amm:hac += hac_in |
| swap HAC 出 | hac_out | + hac_out * HCUT_SCALE / hcut | amm:hac -= hac_out |
| add_liquidity HAC | hac_use | - hac_use * HCUT_SCALE / hcut | amm:hac += hac_use |
| remove_liquidity HAC | hac_out | + hac_out * HCUT_SCALE / hcut | amm:hac -= hac_out |
| 利息给存款人 | dep_share | rpu:hac 增量 = (dep_share * HCUT_SCALE / hcut) * RPU_SCALE / tot:hac | 每名义单位 |
| 利息/AMM 费给 LP | lp_share（有效） | lpr_nom += lp_share * LCUT_SCALE / lcut；lpu:hac 增量 = 同左 * RPU_SCALE / lpt:tot | **lpr 存名义值**；见 §8A.5 |
| LP 奖励结算到 bal | gain_nom（名义） | gain_eff = gain_nom * lcut / LCUT_SCALE；bal += gain_eff * HCUT_SCALE / hcut；lpr_nom -= gain_nom | 两级折减：先 lcut 后 hcut |
| tre/res/def | HAC | 不乘 hcut | 单桶 |
| balance_hac 视图 | — | 返回 mul_div(bal, hcut, HCUT_SCALE) | UI 用有效值 |
| protocol_overview | — | 用 tot_eff / bal_eff | 不显示 nominal |

- 所有除法用 mul_div；存款/奖励向下取整，提取向上取整；dust 进 res/tre，不留给用户。
- hcut 很低时，amount * HCUT_SCALE / hcut 可能很大；用 u128、检查溢出；hcut 有下限 HCUT_MIN（建议 1e6）。

### 8A.4 社会化瀑布

> 本节是 `apply_loss(loss)` 的完整实现；§8.1 只是它的调用点。以本节为准。

    // loss = 未收回的 HAC（debt - pay）
    // 0) 链上储备第一损失
    use = min(loss, res:hac); res:hac -= use; loss -= use
    // 0b) 金库待清扫 HAC
    use = min(loss, tre:hac); tre:hac -= use; loss -= use

    // 1) 未结算 LP 奖励先按 lcut 承担
    lpr_eff = mul_div(lpr:hac, lcut, LCUT_SCALE)
    lpr_loss = min(loss, lpr_eff)
    if lpr_eff > 0:
        lcut = mul_div(lcut, lpr_eff - lpr_loss, lpr_eff)
    loss -= lpr_loss

    // 2) LP 的可出借 AMM HAC，上限 30%
    lp_cap = lendable_amm_hac
    lp_loss = min(loss, lp_cap)
    amm:hac -= lp_loss
    loss -= lp_loss

    // 3) 存款人按 hcut 全局承担（受 HCUT_MIN 约束）
    dep_eff = mul_div(tot:hac, hcut, HCUT_SCALE)
    if loss > 0 and dep_eff > 0:
        dep_loss = min(loss, dep_eff)
        new_hcut = mul_div(hcut, dep_eff - dep_loss, dep_eff)
        // 下限：hcut 不得低于 HCUT_MIN（防归零/溢出）
        if new_hcut < HCUT_MIN:
            // 只扣到下限为止，剩余部分留给第 4 步
            new_hcut = HCUT_MIN
            absorbed = mul_div(dep_eff, hcut - HCUT_MIN, hcut)
            dep_loss = min(dep_loss, absorbed)
        hcut = new_hcut
        loss -= dep_loss

    // 4) 仍不足 -> 赤字 + 暂停新增借款
    if loss > 0:
        def:hac += loss
        borrow:paused = 1

- 完整瀑布顺序：`res:hac -> tre:hac -> lpr:hac（lcut）-> LP 可出借 30% -> bal:hac hcut -> def`。
- v1 加 lcut:hac：未结算 LP 奖励也按比例承担；lcut 只降不升，lpr 名义不变、有效值下降。
- LP 的损失上限是 lendable_amm_hac；70% 预留 HAC 不承担贷款信用损失。
- hcut 更新后，名义 bal 不变，有效 bal 下降；新存款按新 hcut 换算；rpu/chk 仍按名义，奖励按有效份额公平。
- hcut 到 HCUT_MIN 后不再降；剩余 loss 进 def，borrow:paused=1。
- def 只会被**未来收入**（`apply_reserve` 先补 def）逐步清零，不会被社会化本身吸收；
  `apply_loss` 里 loss>>def 是唯一推高 def 的地方。hcut 到下限后仍有 loss，则 def 保留并触发 `borrow:paused`。

### 8A.5 利息与费用（hcut 版）

    providers = tot_eff + lendable_amm_hac
    provider_part = fee * INT_PROVIDER_BPS / 10000
    reserve_part  = fee - provider_part
    lp_share  = provider_part * lendable_amm_hac / providers
    dep_share = provider_part - lp_share

    // 存款人：rpu 是“名义单位”的累加器
    if tot:hac > 0:
        dep_nominal = mul_div(dep_share, HCUT_SCALE, hcut)
        rpu:hac += mul_div(dep_nominal, RPU_SCALE, tot:hac)
    else:
        reserve_part += dep_share

    // LP：lpr 存**名义值**，入账时按 S/lcut 溢价；lpu 累加的是名义 HAC/份额
    if lpt:tot > 0:
        lp_nom = mul_div(lp_share, LCUT_SCALE, lcut)      // ★ 关键：不能直接 += lp_share
        lpu:hac += mul_div(lp_nom, RPU_SCALE, lpt:tot)
        lpr:hac += lp_nom                                  // lpr 名义
    else:
        reserve_part += lp_share

    apply_reserve(reserve_part)

- **为什么入账要溢价**：`lcut` 是"有效/名义"因子，只降不升。若直接 `lpr += lp_share`，haircut 之后新产生的收益也会被旧 lcut 打折。
  例：lcut=0.5、lpr=1000（有效 500）；新增 100；直接加 → lpr=1100、有效 550，但真实应付是 500+100=600，凭空少 50。
  按 `lp_nom = 100 × 1e12/0.5e12 = 200` 入账 → lpr=1200、有效 600，正确。这与 `hcut` 的 `hac_to_nominal` 完全同构。
- settle_and_write 的 gain 是**名义** HAC；有效 gain = nominal * hcut / S；
- LP 结算（两级折减，顺序不能反）：
  ```
  gain_nom = mul_div(lpt, lpu - lch, RPU_SCALE)          // 名义（lpu 记的是名义 HAC/份额）
  lpr:hac -= gain_nom                                     // 名义负债减少
  gain_eff = mul_div(gain_nom, lcut, LCUT_SCALE)          // ① 先按 lcut 折成有效
  gain_nom_final = mul_div(gain_eff, HCUT_SCALE, hcut)    // ② 再按 hcut 折成名义余额
  settle_and_write(who, 0, bal + gain_nom_final)
  total_add(0, gain_nom_final)
  ```
  LP 的 HAC 收益同时承受 lcut（未结算部分的社会化）和 hcut（存款人社会化）；两者独立，都要折。
- 注意：`lpr:hac -= gain_nom` 之后 lpr 仍是名义口径；不变量里用的是 `lpr × lcut / LCUT_SCALE`（有效），保持守恒。
- AMM 费 kind=0 同理；kind=1（hacds）不乘 hcut；
- 赎回费是 hacds，不乘 hcut。

### 8A.6 借款 / 还款 / 清算

- loan_borrow：bal:hac += hac_amt * S / hcut；total_add(0, hac_amt*S/hcut)；loan:debt += hac_amt；tot:debt += hac_amt；
- loan_repay：bal:hac -= pay * S / hcut；total_sub(0, pay*S/hcut)；loan:debt -= pay；tot:debt -= pay；
- 清算人付款：pbal 是名义；need_nominal = (pay+fee) * S / hcut；settle_and_write(payer, 0, pbal - need_nominal)；total_sub(0, need_nominal)；res:hac += protocol_fee；债务/抵押按 HAC/hacds 原值；
- 健康度：debt 是 HAC，coll 是 hacds；hcut 不影响 coll/debt；UI 用 balance_hac 的有效值；
- bad:<addr> 记录 HAC 损失；def 是 HAC；res 是 HAC。

### 8A.7 AMM

- amm:hac / amm:ds 都是有效值，不乘 hcut；
- 用户 bal:hac 的 HAC 入/出按 8A.3 换算；
- add/remove 的 hac_use/hac_out 是 HAC；amm:hac 直接加减；
- LP 的 amm:hac 债权是有效值；LP 的损失直接降 amm:hac（上限 30%）；
- lpu:hac 是 HAC/份额；lp_settle 的 bal 增加按 hcut 换成名义；
- amm:ref/pool_price 用 amm:hac/amm:ds；不乘 hcut。

### 8A.8 视图

- balance_hac(who) 返回有效 HAC（nominal * hcut / S），UI 默认用这个；
- tot_hac() 返回 tot_eff；tot_hac_nominal() 返回名义（调试用）；
- hcut() 返回当前 hcut / S（例如 0.95）；
- protocol_overview 的 hacPoints/stakedHac 用有效值；
- loan_status/loan_debt_now：debt 是 HAC，不乘 hcut；collateral 是 hacds；
- LP 的 amm:hac/amm:ds 是有效值；lpu 结算后的 bal 用有效值展示；
- bad_debt_reserve/def 是 HAC；hacd_coverage 是 hacds 侧，不乘 hcut。

### 8A.9 边界与已知取舍

- hcut 只降不升；这是永久损失，符合“社会化”的语义；未来利润不补旧 hcut，只按新 hcut 分配。
- 新存款按新 hcut 换名义份额；rpu/chk 按名义，奖励按有效公平；测试要覆盖“haircut 后新存款”。
- lpr:hac 在 v1 就加 lcut:hac；lcut 只降不升；`lpr` 存的是**名义值**，新产生的手续费按 `S/lcut` 溢价入账（§8A.5），否则 haircut 后的新收益会被旧 lcut 重复打折；lp_settle 的 gain 先按 lcut、再按 hcut 折两次。
- hcut 到 HCUT_MIN 后，剩余损失进 def，borrow:paused=1；不再继续扣存款人，避免 hcut 归零/溢出。
- 如果 LP 损失超过 lendable_amm_hac，超出部分先由 res/tre，再进存款人 hcut，最后 def；LP 的 70% 预留不被贷款损失直接扣。
- 所有 hac_to_nominal/nominal_to_hac 必须集中成一个内部函数，避免每个入口漏乘；这是实现期最容易出错的地方。
- 视图/索引器/钱包必须统一用有效值；任何把 nominal 当 HAC 显示的地方都会差 1/hcut 倍。

### 8A.10 实施清单

1. 新增 hcut:hac/LCUT:hac、HCUT_SCALE/LCUT_SCALE、HCUT_MIN/LCUT_MIN；加入 rent_keys。
2. 新增内部函数 hac_to_nominal(amount, round_up) / nominal_to_hac(nominal)；所有 bal:hac 入口/出口调用。
   再新增 lup_to_nominal(lp_share) / lpr_to_effective(lpr_nom) 一对，专门给 lpr 用（结构与 hcut 那对完全相同）。
3. 改 PayableHAC / PermitHAC / loan_borrow / loan_repay / loan_liquidate / amm_swap / add_liquidity / remove_liquidity / charge_fee_interest / charge_fee_amm / lp_settle_leg。
4. 改 balance_hac / protocol_overview / total_staked 视图为有效值。
5. 社会化瀑布：res -> tre -> lpr（**v1 启用 lcut**）-> LP 30% -> hcut -> def；实现 socialize。
6. 不变量/压力测试：haircut 后新存款、提现、借款、还款、清算、AMM、LP 结算。
7. UI 显示 hcut、有效余额、def、res；任何“账面余额”都标明是有效 HAC。

---
## 9. 清算机制

### 9.1 正常分支（抵押价值 ≥ 105% 债务）

参数：LIQ_BONUS_BPS=500、LIQ_PROTOCOL_BPS=100、CLOSE_FACTOR_BPS=5000。

    // 触发：debt * LIQ_COLL_RATIO_BPS > coll_hac_liq * 10000
    // 且 coll_hac_liq >= debt * DEEP_TRIGGER_BPS / 10000（否则走深水）
    // close factor
    max_repay = (health_bps < DEEP_WATER_BPS) ? debt : debt * CLOSE_FACTOR_BPS / 10000
    pay = min(repay, max_repay, debt)
    if pay < MIN_LIQ: return 44

    // 清算人付款 = pay + protocol_fee（HAC 口径）
    protocol_fee = pay * LIQ_PROTOCOL_BPS / 10000
    need_hac = pay + protocol_fee
    // ★ pbal 是名义余额，必须先换成名义再比较/相减（§8A.3）
    need_nom = mul_div(need_hac, HCUT_SCALE, hcut)
    if pbal < need_nom: return 11

    // 抵押交割：清算人拿到“付款额 + 5% 奖励”的抵押价值，
    // 不是按 debt 比例拿抵押（否则在 160% 抵押率下会拿到 68% 的额外价值）
    coll_take_value = pay * (10000 + LIQ_BONUS_BPS) / 10000
    coll_take = mul_div(coll, coll_take_value, coll_hac_liq)
    if coll_take > coll: coll_take = coll
    if coll_take < min_coll_out: return 45

    // 账目
    settle_and_write(payer, 0, pbal - need_nom)
    total_sub(0, need_nom)          // 名义口径；对应 need_hac 的有效 HAC 离开系统
    res:hac += protocol_fee         // 协议费进储备（或 apply_reserve）
    loan:debt -= pay
    loan:coll -= coll_take
    due:payer += coll_take
    tot:debt -= pay

    // 还清 → 剩余抵押回借款人
    if loan:debt == 0: ...
    // 健康度检查（可选）：若 new_debt>0 且 health 仍 < 阈值，仍允许？v1 允许，close factor 已限制。
    return 0

- 清算人净收益 = 抵押价值（按 liq_price）− (pay + protocol_fee)；总奖励 5%、协议费 1%，净 4% 左右。
- 关键：奖励按**付款额**的 5% 计，不按债务比例。例：债务 100、抵押价值 160（160% 抵押率），清算人还 50；拿走的抵押价值 = 50×1.05 = 52.5，占抵押 32.8%；借款人保留 67.2%。如果按 pro-rata（coll * pay / debt），清算人会拿走 80 的抵押价值（60% 额外），这是错的。
- 奖励由借款人抵押承担；协议费进 res（第一损失）。
- 清算人拿到的是 due；可在同一笔 combo 里 TransferAssetFromTo 领取链上 hacds（或之后领取）。建议钱包默认同笔领取，减少摩擦。
- min_coll_out 保护清算人；协议侧用 liq_price 保守估值。

### 9.2 深水分支（抵押价值 < 105% 债务）

v1：固定 3% 折扣的接管式清算；Phase 2：荷兰拍卖/稳定池。

    // 触发：coll_hac_liq < debt * DEEP_TRIGGER_BPS / 10000
    // 清算人按市值付款，拿全部抵押；给 3% 折扣作为激励
    deep_pay = coll_hac_liq * (10000 - DEEP_DISCOUNT_BPS) / 10000
    if repay < deep_pay: return 46
    pay = deep_pay
    // ★ 付款额封顶为债务：coll_hac_liq 落在 [1.031, 1.05]×debt 时
    //   0.97×coll 会 > debt，若照扣会把清算人多付的钱烧掉、且 debt-pay 下溢
    if pay > debt: pay = debt
    // ★ pbal 名义，pay 是 HAC；同样要换算
    pay_nom = mul_div(pay, HCUT_SCALE, hcut)
    if pbal < pay_nom: return 11

    settle_and_write(payer, 0, pbal - pay_nom)
    total_sub(0, pay_nom)
    loan:debt = 0
    loan:coll = 0
    tot:debt -= debt
    due:payer += coll
    // pay <= debt 已由封顶保证，故只有 loss 分支
    if pay < debt:
        apply_loss(debt - pay)            // 先 res，后 tre/lpr/LP30%/hcut/def
    return 0

- **支付上限修复**：`deep_pay = 0.97 × coll`。当 `coll` 在 `[debt/0.97, 1.05×debt]` 区间
  （即 `coll` 约 `[1.031, 1.05] × debt`）时，`deep_pay > debt`。若不封顶：
  u128 的 `debt - pay` 直接下溢（合约最坏情况是 VM abort 或产生天文数字的 loss），
  且清算人多付的钱无处可去。封顶 `pay = min(deep_pay, debt)` 后：
  - `coll ≥ debt`：按 `debt` 付款，拿全部抵押，清算人净赚 `coll - debt`（≤5%），协议零损失；
  - `coll < debt`：按 `0.97×coll` 付款，`loss = debt - 0.97×coll` 进 `res/def`。
- 3% 折扣只在 `coll < debt` 时才是协议成本；`coll ≥ debt` 的浅深水区协议是赚的。
- 压力测试必须覆盖 `coll/debt ∈ {0.96, 1.00, 1.03, 1.04, 1.049, 1.05, 1.051}` 的边界带。
- Phase 2：把 deep_pay 改成拍卖最高出价；或稳定池按比例吸收，损失社会化。拍卖更适合大额、薄市场；稳定池更快但需要激励。
- 深水清算不要求 min_coll_out？清算人拿全部抵押；min_coll_out 可以用 coll（全部）或跳过；建议要求 coll >= min_coll_out（防交付异常）。

### 9.3 宽限期（Phase 2）

- 见 §5.4；v1 LIQ_GRACE_BLOCKS=0，不启用。
- 若启用：mark_unhealthy(borrower) 设 liq:since；loan_liquidate 检查；健康恢复则清零。

### 9.4 返回码新增

- 48 = HACD 单笔超过 1 颗（已实现）
- 49 = 现金缓冲/流动性不足（如启用）
- 50 = 利用率/参考价/债务上限
- 51 = 借款熔断
- 52 = 单借款人上限
- 53 = hacds 供应上限
- 54 = HACD 覆盖率不足（暂停 mint）
- 55 = 清算后健康度未恢复（如启用）
- 56 = 加池比例/滑点
- 57 = 赎回溢价/覆盖率限制（如启用）
- 58 = 提现队列/流动性限制（如启用）
- 60 = `rent_keys` 单笔超过 10 键（实测 storage 上限）
- 61 = HACD 池记录不足（`res:hacd_count == 0` 或 `res:hacd_score < gross`），拒绝赎回防下溢

---

### 9.5 荷兰拍卖 vs 稳定池（Phase 2 选项）

**荷兰拍卖（Dutch auction）**

- 协议把抵押品（due / 链上 hacds / HACD）挂出来卖，价格从高往低走，直到有人接受。
- 例：债务 100、抵押价值 80；起拍 85，逐步降到 70；买家在 78 接手；协议收到 78，坏账 22。
- 优点：价格由市场发现，适合大额/薄市场，不用把抵押品砸进 AMM；缺点：需要拍卖参数（起拍价、时长、步长）、需要买家、链上交互复杂、可能流拍。

**稳定池（Stability pool）**

- 一个预先存入 HAC 的池子；清算时池子替借款人还债，收走抵押品；池子的存款人按比例分享抵押品/承担损失。
- 例：池子有 1,000,000 HAC；某仓位债务 100/抵押 80；池子付 100，收 80 的抵押品；池子存款人承担 20 的损失，但拿到折价的抵押品。
- 优点：即时、不需要拍卖买家、能吸收坏账；缺点：池子要先有资金、池子存款人承担信用/价格风险、池子可能被抽干、抵押品流动性差时池子也难变现。

**对比**

| 维度 | 荷兰拍卖 | 稳定池 |
|---|---|---|
| 价格发现 | 市场竞价，较好 | 固定/按池子规则，较弱 |
| 速度 | 慢（拍卖时长） | 快（即时） |
| 资金要求 | 只需买家 | 需要预先存入的池子 |
| 薄市场 | 可能流拍 | 池子可能被抽干 |
| 实现复杂度 | 高 | 中 |
| 适合 | 大额、NFT/薄资产 | 有稳定资金来源、频繁清算 |

**本协议建议**

- v1：不做拍卖/稳定池；用固定 3% 深水折扣 + hcut 社会化，简单、可预测。
- Phase 2：大额/薄市场用荷兰拍卖；如果能吸引 HAC 存款人做稳定池，再用稳定池替代固定折扣。
- 不要 v1 同时做两套；先把 hcut + res/def + 固定折扣跑通。

## 10. 借贷上限与集中度

> 本节 HAC 金额按 §8A.3 换算：bal:hac 是名义，providers 用有效值；loan:debt/tot:debt 是 HAC。

- 全局 U_MAX=50%：tot:debt <= providers * 5000 / 10000；
- 单借款人 BORROWER_CAP=20%：loan:debt + hac_amt <= providers * 2000 / 10000；
- 可选全局绝对上限 TOTAL_DEBT_CAP（HAC），防 providers 被操纵变大；
- 可选单抵押/单 HACD 上限：v1 不做，HACD 1 颗/笔已限制单次流入；
- 新借款人第一次借款前，tot:debt 要包含其新债务；loan_borrow 先 accrue interest，再检查。

---

## 11. AMM 加池 / 撤池 / swap

> 本节 HAC 金额按 §8A.3 换算；amm:hac/amm:ds 是有效值，用户 bal:hac 的 HAC 入/出用 nominal。

### 11.1 加池

新签名建议：add_liquidity(hac_amt, ds_amt, min_share, deadline)。

    if block_height > deadline: return 59
    lp_settle(main)
    ph/pd/lpttot
    if lpttot == 0:
        if ph != 0 or pd != 0: return 23
        if hac_amt > LP_MAX_SIDE or ds_amt > LP_MAX_SIDE: return 26
        share = isqrt(hac_amt * ds_amt)
        if share <= MINIMUM_LIQUIDITY: return 26
        // 铸 MINIMUM_LIQUIDITY 给 BURN_ADDR，share - MINIMUM_LIQUIDITY 给 main
        hac_use = hac_amt; ds_use = ds_amt
    else:
        s1 = lpttot * hac_amt / ph
        s2 = lpttot * ds_amt / pd
        // 用较小侧作为实际入池量，另一侧不扣（留在用户余额）
        if s1 <= s2:
            hac_use = hac_amt
            ds_use = mul_div(hac_amt, pd, ph)
        else:
            ds_use = ds_amt
            hac_use = mul_div(ds_amt, ph, pd)
        share = min(s1, s2)     // 用实际入池量重算；与上面一致
        if share < min_share: return 56
        // 只扣 hac_use/ds_use，多余不扣
    // 扣款、入池、记 lpt
    ...

- 这样合约层不会把多余的一侧捐给池子；钱包的比例检查是 UX 层，合约仍安全。
- 首注死份额防首 LP 份额通胀；MINIMUM_LIQUIDITY 铸给 BURN_ADDR（不可撤）。
- min_share 让钱包的容差在执行时生效；池子被 front-run 时回滚。
- deadline 防延迟执行。

### 11.2 撤池

新签名：remove_liquidity(share_burn, min_hac_out, min_ds_out, deadline)。

- hac_out = amm:hac * share / lpt:tot；ds_out = amm:ds * share / lpt:tot；
- 若 hac_out < min_hac_out 或 ds_out < min_ds_out，回滚；
- 若现金不足（可选）：hac_out > available_cash 时只允许部分/返回 58；v1 先靠 U_MAX + 70% 预留，失败时 tx 回滚，LP 重试；
- 先 lp_settle，结算 lpu 奖励；lpr 扣减。

### 11.3 swap

- 保留 min_out；新增 deadline；
- 每次 swap 调用 EMA 更新（§4）；
- 费率 0.5%，80/20；lpr 更新。

---

## 12. HACD mint / redeem

### 12.1 1 颗/笔

- PayableHACD / PermitHACD 已硬限制 count == 1，count != 1 返回 48；
- 不保留循环；VM resource 6,100，单颗约 3,270 resource，2 颗必 OutOfGas。

### 12.2 存入（mint）

> **2026-10-23 定稿：mint 不打折**（`mint = gross`）。论证见 §12.5。

    score = score_of(nm)
    gross = score * SCORE_SCALE
    mint  = gross                                 // 100%，无折扣（MINT_HAIRCUT_BPS=10000）
    // 供应上限
    claims = tot:ds + amm:ds + tre:ds + lpr:ds
    if claims + mint > HACDS_SUPPLY: return 53
    // 覆盖率闸门（保留；100% 发行下恒不触发，成本为零）
    if coverage_ds < COVERAGE_MIN_BPS: return 54
    res:hacd_score += gross
    res:hacd_count += 1
    due:main += mint
    tot:ds += mint
    return 0

- `mint = gross`：`S` 与 `C` 同增，覆盖率恒为 100%，挑钻石不改变比值（§12.5.1）；
- 1 颗/笔的硬限制天然限速；
- 供应上限用 HACDS_SUPPLY，防止 due 超过 hacds 资产总量；
- 挑钻石的抑制完全靠 §12.3 的赎回端动态溢价（上限已提到 30%）。

### 12.3 赎回（redeem）

    score = score_of(nm)
    gross = score * SCORE_SCALE
    avg = res:hacd_count == 0 ? gross : res:hacd_score / res:hacd_count
    premium_bps = 0
    if gross > avg:
        // 高于均分的部分，按斜率收费，封顶
        premium_bps = min(CHERRY_PREMIUM_MAX_BPS,
                          (gross - avg) * CHERRY_SLOPE_BPS / avg)
    base_fee = gross * REDEEM_FEE_BPS / 10000
    premium  = gross * premium_bps / 10000
    fee = base_fee + premium
    need = gross
    charge = need + fee
    // due 检查；不足可自动补足（建议钱包预先 swap，不用 auto_topup）
    // ...
    total_sub(1, need + fee)
    charge_fee_redeem(fee)
    res:hacd_score -= gross
    res:hacd_count -= 1
    // 交付 HACD 给 cp
    return 0

- 高分 HACD 多收费，抑制“挑走最好的钻石”；低分 HACD 不补贴（可正常赎回）；
- 溢价是动态挑钻石税，不是按市场价；HACD 市场有价格后可用市场价替代；
- Phase 2：每用户 HACD 收据（只能赎自己存的）或按比例篮子；v1 用动态溢价，改动小、保持 due 可替代性；
- 赎回费 80% LP / 20% tre；溢价的分配同 fee；
- res:hacd_score/count 必须纳入 rent_keys 列表；
- auto_topup_ds：钱包应优先在赎回前用 swap_hac_to_ds 并设置 min_out；合约的自动补足保留为便利，但存在池价变动时多付/失败的风险（见 §13.4）。

### 12.4 覆盖率视图

- hacd_coverage = res:hacd_score * 10000 / (tot:ds + amm:ds + tre:ds + lpr:ds)；
- hacd_avg_score = res:hacd_score / res:hacd_count；
- UI 显示：池子平均分、覆盖率、当前 HACD 的预估折扣/溢价；
- 覆盖率 <100%：mint 暂停（Phase 2 硬闸门）；赎回仍可，改善覆盖率；
- 覆盖率 <90%：赎回加 haircut/队列（Phase 2）。

---

### 12.5 mint 折扣：结论是不打折扣（2026-10-23 定）

#### 12.5.1 先把数学摆干净

设池内 HACD 总分数为 `S`、总债权为 `C`，存入/赎回都按 `score × mint_rate` 记账：

    mint   : S += score        C += score × mint_rate
    redeem : S -= score        C -= score × mint_rate

于是 `S / C = 1 / mint_rate`，**恒为常数**，与存了哪些钻石、挑没挑钻石**完全无关**。

- `mint_rate = 100%` → `S ≡ C`，覆盖率恒等 100%；
- `mint_rate = 95%` → `S/C ≡ 105.26%`，覆盖率恒为 105%；
- 挑钻石 = 把高分 HACD 换成等比例额度，S 和 C 同步减少，**比值不动**。

**所以：覆盖率不是健康度指标，它是"历史累计折扣"的积分器，只随折扣单调上升，不会被挑钻石拉低。**

#### 12.5.2 由此证明：hacds 无超发风险

供给是这样定出来的（`发行参数-正式.md`）：

    supply = 3.55440306（现有 HACD 精确均分）× 16,777,216（HACD 总发行量）
           = 59,632,987 单位

即 **supply 恰好等于"全世界全部 HACD 都按 100% 存进来"的分数总和**。100% 发行在数学上刚好兜住全集，
不存在超发；`HACDS_SUPPLY` 上限只是把"未来新 HACD 分数更高"的尾部风险挡在门外（撞到就 `return 53`，优雅停止）。

#### 12.5.3 原"动态折扣"方案是退化的

    haircut = clamp(MIN, MAX, TARGET_COVERAGE - coverage)

因为 `coverage` 只会涨不会跌，`TARGET − coverage` 只会单调缩小，直到撞 `MIN_MINT_HAIRCUT_BPS`（2%）的下限，
然后**永远停在 2%，再也不会动**。它看起来像反馈控制，实际是伪装成公式的常数。原 B 方案作废。

#### 12.5.4 5% 折扣实际买到了什么

只有一件事：一个由**全体存款人**出资 5% 的公共缓冲池，用来吸收"挑钻石"的价值损失。但这个保险非常不划算：

| 维度 | 5% 固定折扣的问题 |
|---|---|
| 保费确定性 | 每个存款人**立刻**确定损失 5%，无论有没有人挑钻石 |
| 风险概率性 | 挑钻石损失是概率性的、分散在多期的 |
| 挑钻石压力 | 当前流通 138,540 颗（占总量 0.8%）；且 1 颗/笔硬限制下批量挑钻石仍需逐笔交易 |
| 往返摩擦 | 5% 存 + 0.5% 赎 = **5.5%**，压在本该是最基本原语（HACD 液态化）的入口上 |

对比：wstETH 往返约 0.1%。5.5% 的量级足以把绝大部分正常用户挡在门外，而它挡不住真正的挑钻石者
（0.8% 的池子深度，挑一遍的成本远低于 5% 的预期收益）。

#### 12.5.5 定稿：mint 不打折，挑钻石税全部挪到赎回侧

    // mint：100%，不铸折扣
    mint = score * SCORE_SCALE
    // 无 MINT_HAIRCUT_BPS；S 与 C 同增，覆盖率恒 100%

理由：

1. **溶剂性由构造保证**（`S ≡ C`），不需要折扣兜底；
2. **进池零摩擦**，先把 AMM 深度做起来——这是 hacds 全部价值的前提；
3. **挑钻石是"选货"问题，该在出货时收费不该在入货时收税**；
4. 供给尾部风险由 `HACDS_SUPPLY` 上限优雅拦截，不构成资不抵债。

挑钻石的全部成本转移给 §12.3 的动态溢价，且**建议同步提高封顶**：

| 参数 | 原值 | 建议值 | 理由 |
|---|---:|---:|---|
| `MINT_HAIRCUT_BPS` | 9500 | **10000（不打折）** | 见上 |
| `CHERRY_PREMIUM_MAX_BPS` | 500（5%） | **3000（30%）** | 5% 封顶拦不住真正的挑钻石：分数高 2 倍，市价可能高 3–4 倍 |
| `CHERRY_SLOPE_BPS` | 10000 | 10000（不变） | 斜率 ≈ 超线性价值增长，本身合理 |
| `REDEEM_FEE_BPS` | 50（0.5%） | 50（不变） | 基础赎回费与挑钻石无关 |

于是往返成本从 **5.5%** 降到 **0.5%**，而挑钻石的边际税率从最高 5% 提到最高 30%。

#### 12.5.6 如果一定要留安全边际

那就 `MINT_HAIRCUT_BPS = 9950`（0.5%–1% 区间），绝不到 5%。但默认建议仍是 100%：
折扣的每一分钱都是对全部存款人的确定征税，换取的是一个在 0.8% 池深下几乎不会触发的概率保护。

#### 12.5.7 覆盖率闸门保留

- `coverage_ds >= 10000` 允许 mint；低于则暂停（`return 54`）；
- 由于默认 mint=100% 时覆盖率恒为 100%，这个闸门在正常运行中**永不触发**，只在两种情况下生效：
  a) 未来新 HACD 分数高于发行时的均分，导致 `S` 增长快于 `C`（此时覆盖率反而 >100%，不会拦）；
  b) 手动调高过折扣后又想回调（v1 无治理，不会发生）。
- 换言之：**覆盖率闸门在 100% 发行下是一条永不触发的保险丝**，保留成本为零，保留即可。

## 13. LP 的 NAV、利息、风险

### 13.1 LP 的债权

- lpt/lpt:tot 是 AMM 的份额；
- LP 的 HAC 债权 = amm:hac * lpt / lpt:tot，其中 lendable_amm_hac 部分可能被借出，amm_reserved_hac 部分是现金；
- LP 的 hacds 债权 = amm:ds * lpt / lpt:tot，不参与放贷，无信用风险；
- LP 的累计奖励 = lpu:hac/lpu:ds 结算后的 bal:hac/due；
- LP 的信用风险只来自 lendable_amm_hac（30%），不是整个 amm:hac；这是 3-lite 的核心。
- 坏账 def 若社会化，会降低 amm:hac（LP 的 HAC 债权）和 tot:hac（存款人）；hacds 侧不受 HAC 坏账影响（除非 HACD 价值本身下跌）。

### 13.2 LP 的收益

LP APR ≈ AMM 费（80%）+ 赎回费（80%，以 hacds 计）+ 贷款利息（按 lendable_amm_hac / providers 分）+ 覆盖率/溢价收益 - IL - 信用损失。

- 如果 LP 只想要交易费，不想承担信用风险，3-lite 的 30% 仍然是风险；必须在 UI 明确披露。
- 如果项目希望 LP 完全不承担信用风险，选 full 1（0% 可出借）；3-lite 是折中。

### 13.3 退出

- remove_liquidity 只把 amm:hac/amm:ds 记回 bal:hac/due；真正提 HAC 时受现金约束；
- v1：U_MAX 50% + AMM 70% 预留，正常退出应可用；极端挤兑可能失败/重试；UI 提示“HAC 可能被借出，退出受流动性约束”；
- Phase 2：提现队列/部分退出/优先给 AMM 预留现金。

### 13.4 auto_topup

- 赎回自动补足用 AMM 买 hacds，hac_need 按当前池价算；
- 池价在同笔被操纵时，用户可能多付（价格变好）或 swap 失败（价格变差）；
- 建议：钱包在赎回前显式 swap_hac_to_ds 并设 min_out，不依赖自动补足；
- 合约侧可给 auto_topup_ds 加“最大 HAC 输入”常量/滑点上限（如 2%），但 hook 签名无法加用户参数；Phase 2 可加独立入口。

---

## 14. 视图与 UI

新增/修改视图：

| 视图 | 返回 | 用途 |
|---|---|---|
| loan_debt_now(who) | 应计债务 | UI/索引器 |
| loan_health(who) | health_bps（10000=清算线） | 健康度 |
| loan_liq_ratio() | LIQ_COLL_RATIO_BPS | 阈值 |
| utilization() | U×10000 | 利率/风控 |
| providers_hac() | tot:hac + lendable_amm_hac | 利率/上限 |
| lendable_amm_hac() | 30% amm:hac | 透明 |
| bad_debt_reserve() | res:hac | 储备 |
| bad_debt_deficit() | def:hac | 赤字 |
| hacd_coverage() | 覆盖率×10000 | mint/赎回 |
| hacd_avg_score() | 平均分 | 溢价 |
| borrow_paused() | 0/1 | 熔断 |
| amm_ref() / amm_ref_height() | EMA/高度 | 估值 |
| amm_spot() | 现货价 | 展示 |
| lp_nav_hac() / lp_nav_ds() | LP 每份额净值 | LP |
| lp_apy_hint() | 年化提示 | UI（可用历史费用近似） |

UI 要点：

- 健康度用 health_bps vs 10000，不要再用“200%=安全”的旧口径；
- 借款页显示：LTV 50%、清算线 160%（或 180%）、当前缓冲、利用率、借款是否暂停；
- LP 页显示：HAC 可出借比例 30%、信用风险披露、AMM 预留 70%；
- 赎回页显示：池子平均分、当前 HACD 溢价、覆盖率、1 颗/笔；
- 坏账页显示：res/def/社会化状态；
- 管理页（无管理员）只保留查询/续租，不显示 set_*。

---

## 15. 运维：rent_keys / keeper

### 15.1 存储租期是 Hacash 特有的停机风险

- 账本键有租期（`RENT_PERIOD = 300` ≈ 30,000 块 ≈ 104 天）；到期后键变为 recoverable，
  `storage_load` 直接报 `StorageNotActive(108)`，所有读写该键的合约操作回滚（审计 A-5）；
- 租金由**发起交易的人**付 gas（`storage_new` / `storage_rent` 走 `gas_add!(storage, …)`），
  **不是从合约余额扣**。合约不能自己发起交易 → **无法自动续租**；
- 因此 `rent_keys` 必须无许可（任何人可调），并靠 `tre:hac` 付酬维持。

### 15.2 keeper 奖励与阈值保护（已定 2026-10-23）

**⚠ 关键修正：付酬必须配合阈值判断，否则可被抽干。**

现有实现的两条分支都无条件续租：

    if live == 0 { storage_rent(k, period) }    // recoverable → 复活
    else         { storage_rent(k, period) }    // active → 补 live

若在此之上直接付酬，任何人可对**同一个键反复调用**，每次都延长租期、每次都领奖励，
直到 `tre:hac` 耗尽 —— 零成本的经济攻击。`item_get(st, 0)` 即当前 live 值，
合约**读得到剩余租期**，必须据此判断：

    function external rent_keys(keys: bytes, klen: u128, period: u128) -> u32 {
        if klen == 0 { return 2 }
        if size(keys) % klen != 0 { return 3 }
        var n = size(keys) / klen
        var i = 0u128
        var paid = 0u128
        while i < n {
            var k = buf_cut(keys, i * klen, klen)
            var st = storage_stat(k)
            if st is not nil {
                var live = item_get(st, 0)
                // ★ 只在"临近过期"时续租并付酬
                if live < RENT_THRESHOLD {
                    storage_rent(k, period)
                    paid = paid + 1
                }
            }
            i = i + 1
        }
        // 单笔最多 10 键（实测：storage 桶 111,911，11 键需 118,841 会超限）
        if paid > 10 { return 60 }
        // 付酬：从 tre:hac（有效 HAC）拨给 keeper 的名义余额
        if paid > 0 {
            var tre = self.ld_u128("tre:hac:")
            var reward = paid * RENT_REWARD_HAC           // 有效 HAC（zhu）
            if reward > tre { reward = tre }              // 余额不足则只付现有
            if reward > 0 {
                self.wr_u128("tre:hac:", tre - reward)
                // ★ tre 已扣有效 HAC，keeper 记的是**名义**余量，须按 §8A.3 换算
                var keeper = tx_main_addr()
                var balkey = "bal:hac:" ++ keeper
                var bal = self.ld_u128(balkey)
                var bal_nom = mul_div(reward, HCUT_SCALE, hcut)
                self.settle_and_write(keeper, 0, bal + bal_nom)
                self.total_add(0, bal_nom)                // Σbal == tot:hac 守恒
            }
        }
        return 0
    }

**参数与取值依据**

| 参数 | 值 | 依据 |
|---|---:|---|
| `RENT_PERIOD` | 300（≈104 天） | 现有；受冷池 add_liquidity 8 键 ≤111,911 storage 约束（period ≤ ~318） |
| `RENT_THRESHOLD` | **100**（≈33 天） | 在过期前留足多次补救窗口；≈ period/3 |
| `RENT_REWARD_HAC` | **4,000,000 zhu = 0.04 HAC / 键** | 见下方折算 |

**实测校准（2026-10-23，本机全节点高度 793,187）**

用 `sandboxcall` 实测链上 #2000 合约的 `rent_batch`（逻辑与 #3000 的 `rent_keys` 相同，
都是逐键 `storage_rent`），period=300：

| 键数 | compute | resource | storage | use_gas | 推断成本 |
|---:|---:|---:|---:|---:|---:|
| 1 | 390 | 303 | 10,841 | 11,534 | 0.0577 HAC |
| 2 | 529 | 324 | 21,641 | 22,494 | 0.1125 HAC |
| 4 | 807 | 370 | 43,241 | 44,418 | 0.2221 HAC |
| 8 | 1,363 | 478 | 86,441 | 88,282 | 0.4414 HAC |
| 10 | 1,641 | 550 | 108,041 | 110,232 | 0.5512 HAC |

**结论**

- 每键 storage gas = **10,800 = 36 × 300**，与合约注释公式完全吻合（`1024` 是一次性 key cost，
  只在 `storage_new` 时收；`storage_rent` 只收 `36 × period`）；
- 按实测 `fee_purity_floor = 5×10¹⁰ u232/byte` 折算，**每键成本 ≈ 0.054 HAC**；
- 批量几乎无折扣（0.0577 → 0.0551），因为成本线性于键数；
- **单笔上限 10 键**：storage 桶 111,911，10 键用 108,041，11 键需 118,841 → 超限。

**定稿值**

    RENT_REWARD_HAC = 7,000,000 zhu = 0.07 HAC / 键   （成本 0.054 × 1.3）

余量 30%，覆盖费率上浮与 keeper 的交易费波动。批量 10 键时 keeper 收入 0.70 HAC、
成本 0.55 HAC，净 0.15 HAC —— 略薄，因此**建议 keeper 一次续满 10 键**（脚本按 10 键一批），
单键调用只有 0.016 HAC 净利，不划算。

**年化运营成本**（period=300 ≈104 天，每年 3.5 次）：

| 活跃键数 | 每年成本 |
|---:|---:|
| 100 | ≈19 HAC |
| 1,000 | ≈189 HAC |
| 10,000 | ≈1,890 HAC |

> ⚠ `use_gas` 与实际燃烧量成正比于交易 fee。上表用 `fee_purity_floor`（协议下限）折算，
> 实际交易若付费高于 floor，成本同比例上升；keeper 应在奖励不足以覆盖时提高自己的 fee 或停止服务。

**单笔上限对集群的影响**

- 10 键/笔 → 1,000 个活跃键需要 100 笔；
- 每键每 104 天到期一次 → 100 键/天的续租负载 → **10 笔/天**，完全可行；
- 10,000 键则需 100 笔/天，仍可行但需 keeper 自动化。

**容量与上限**

- 单笔 storage 桶 111,911 → 续租键数与 period 的乘积受约束；一次续 ~8–9 键（配合 period=300）安全；
- `tre:hac` 不足时奖励降为 0，但**续租仍然执行**（公共品语义）——这与现有代码一致；
- keeper 奖励与 `apply_reserve` 共用 `tre:hac`；`res`/`def` 不被 keeper 触碰。

**实施注意**

- keeper 报酬走 `bal:hac[keeper]`，同笔交易由顶层 `TransferHacFromTo` 取走（与借款/赎回的付腿同构）；
- 由于 `bal:hac` 是**名义**口径（§8A），keeper 入账需 `× HCUT_SCALE / hcut`；
  `tre:hac` 扣的是**有效** HAC，两者不能混（上例已按此实现）；
- **单笔最多 10 键**（实测上限，见 §15.2）；keeper 脚本应按 10 键一批调用，单键调用净利仅 0.016 HAC，不划算。

### 15.3 必须纳入 rent_keys 续租清单的键

- **固定键**：`res:hac:`、`def:hac:`、`lpr:hac:`、`lpr:ds:`、`res:hacd_score`、`res:hacd_count`、
  `borrow:paused`、`tot:debt`、`amm:ref`、`amm:refh`、`hcut:hac`、`lcut:hac`、`tre:hac:`、`tre:ds:`、
  `amm:hac`、`amm:ds`、`tot:hac`、`tot:ds`、`lpt:tot`、`rpu:hac:`、`rpu:ds:`、`lpu:hac:`、`lpu:ds:`
- **按地址键**（需索引器扫链维护清单）：`bal:hac:<addr>`、`due:<addr>`、`loan:debt:<addr>`、
  `loan:coll:<addr>`、`loan:last:<addr>`、`lpt:<addr>`、`chk:hac:<addr>`、`chk:ds:<addr>`、
  `lch:hac:<addr>`、`lch:ds:<addr>`、`bad:<addr>`
- **索引器职责**：维护活跃键清单 → 对每个键查 `storage_stat` → 输出临近过期告警清单（也是 `rent_keys` 的输入）。

### 15.4 `def` 告警（原 SOCIALIZE_BPS 的语义变更）

- 原 `SOCIALIZE_BPS = 500`（def > 5% providers 时启动社会化）**已失效**：
  v1 的社会化是 `apply_loss` 里的**立即瀑布**（§8A.4），不存在"够不够 5% 才动手"的触发点；
- 改为 **`DEF_ALERT_BPS = 500`**，语义是**链下监控阈值**，不进合约：
  - `def:hac > providers × 5%` → 索引器告警、UI 标红、运维介入；
  - 作为 §17.3 的验收标准之一；
- 合约侧无需该常量；`borrow:paused` 才是链上的实际熔断（由 `apply_loss` 在 def 溢出时置位）。

### 15.5 金库地址（已定：保持冷钱包，不更换）

- `TREASURY` 是编译期常量（`1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK`），部署后**不可更换**；
- **项目决定（2026-10-23）：保持该冷钱包地址，不改多签**；
- 因此运维上必须保证：
  - 私钥离线备份（≥2 份、异地）；
  - `tre:hac` / `tre:ds` 清扫必须由冷钱包签名发起（`PermitHAC` / `PermitAsset` 的 TREASURY 分支）；
  - 若冷钱包私钥丢失 → **全部历史手续费永久锁死**，且合约不可升级、无法补救；
- 本项风险已记录在案，不再作为待定项。

### 15.6 监控清单

- 键到期告警（索引器 / 链下 cron）；
- `def` / `res` / `coverage` / `utilization` 阈值告警；
- `borrow:paused` 持续时长告警；
- `hcut` / `lcut` 变化告警（任何下降都意味着真实坏账发生）；
- rent 是 Hacash 特有风险，EVM DeFi 没有；必须在运维手册单列。

---

## 16. 治理与参数

- 保持无管理员：不新增 admin/pause/upgrade；参数编译期常量；
- 自动稳定器：
  - EMA + 熔断（借款暂停）；
  - 利用率利率曲线；
  - 储备目标/赤字/社会化阈值；
  - HACD 覆盖率闸门；
- 参数变更 = 新合约 + 迁移；迁移成本高，因此参数必须一次校准好；
- 可选（不影响本设计）：TREASURY 使用多签/托管地址；项目自己控制，不在合约里加权限；
- 如果未来要有界治理，建议 timelock + Guardian pause（只能暂停/调参数区间，不能动用户资金）；v1 不引入。

---

## 17. 不变量与压力测试

### 17.1 不变量

1. HAC 侧：P + Σloan:debt >= tot:hac*hcut/S + amm:hac + tre:hac + res:hac + lpr:hac*lcut/S - def:hac
2. hacds 侧：H >= tot:ds + amm:ds + tre:ds + lpr:ds
3. tot:hac == Σ bal:hac（现有；若做全局 haircut 需改用 hcut 因子）
4. tot:ds == Σ due + Σ loan:coll（现有口径）
5. tot:debt == Σ loan:debt
6. lpr:hac == 未结算 LP HAC 奖励总和；lpr:ds == 未结算 LP hacds 奖励总和
7. res:hac >= 0；def:hac >= 0；res + tre + ... 与 P 的关系满足 1
8. coverage_ds >= 10000 时允许 mint；低于时 mint 暂停（Phase 2 硬闸门）

### 17.2 压力测试场景

| 场景 | 关键检查 |
|---|---|
| HACD 价格 24h 跌 30% | EMA 跟随速度；清算是否可执行；res/def；LP 净值 |
| 50% providers 被借出 + 20% 跌 | U_MAX；现金缓冲；AMM swap/remove 是否可用 |
| 单借款人借 20% providers | 借款人上限；集中度；清算 |
| 10% 贷款坏账 | res 覆盖；def；社会化阈值；UI |
| HACD 高分被集中赎回 | 溢价；覆盖率；平均分变化 |
| 首 LP 1 wei + swap 拉歪 | MINIMUM_LIQUIDITY；第二 LP 份额 |
| 21% 单日暴跌 | 熔断；借款暂停；清算用 min(spot,ref) |
| LP 集中撤出 | 现金缓冲；队列/失败提示；AMM 是否停摆 |
| 预言机 300 块操纵 | EMA 权重；熔断；借款暂停 |

### 17.3 验收标准

- 任何场景下 def:hac <= DEF_ALERT_BPS × providers（超过即告警 + `borrow:paused`）；
- AMM 在 30% 价格冲击下仍能完成小额 swap/正常撤池（预留 70%）；
- LP 的信用风险不超过 lendable_amm_hac / amm:hac（30%）；
- 清算奖励覆盖清算人的 gas/滑点/领取成本（固定 5% 总奖励）；
- 借款健康度与 UI 一致（应计利息）；
- 覆盖率/储备/赤字视图可查。

---

## 18. 实施顺序（合约未动）

1. 设计签收：本文 + 参数表 + 待确认项。
2. Stage A（只加视图/键）：tot:debt、lpr、res/def、hcut:hac/HCUT_SCALE/HCUT_MIN、res:hacd_score/count、amm:ref EMA 视图、loan_debt_now；不改经济行为。
3. Stage B（利率/分配）：利用率利率、利息 80/20 给存款人+LP、apply_reserve、lpr 结算、hcut 换算（§8A）。
4. Stage C（风控）：LTV/清算线分离、close factor、固定奖励、深水折扣、坏账路径。
5. Stage D（AMM）：加池比例取用、min_share、MINIMUM_LIQUIDITY、撤池 min_out、deadline。
6. Stage E（HACD）：mint 100%（不打折）、覆盖率闸门、赎回端溢价（上限 30%）、供应上限。
7. Stage F（运维/上限）：borrower cap、`rent_keys` 阈值+付酬、新增键 rent 清单。
8. Stage G（测试/部署）：selftest/e2e、testnet、压力测试、迁移公告。

> 本文只改文档；HacdsDeFi3000.fitsh 在签收前不动。

---

## 19. 决策台账

### 19.1 已定（2026-10-23）

| # | 决策 | 结论 | 位置 |
|---|---|---|---|
| 1 | 清算线 | **16000（160% 抵押率，20% 价格缓冲）**；18000 仅备选 | §5.1 |
| 2 | 深水机制 | v1 **固定 3% 折扣 + `pay = min(deep_pay, debt)` 封顶**；拍卖/稳定池留 Phase 2 | §9.2 |
| 3 | 赎回公平 | v1 **动态溢价**，上限提到 **3000（30%）**；每用户收据/比例篮子留 Phase 2 | §12.3 |
| 4 | mint 折扣 | **100%（不打折）**；挑钻石税全部移到赎回端 | §12.5 |
| 5 | 利息分配 | 80% providers / 20% reserve；LP 仅按 `lendable_amm_hac / providers` 分 | §7.1 |
| 6 | 储备目标 | `RES_TARGET_BPS = 300`（3% providers，上限非目标值） | §7.4 |
| 7 | `def` 告警 | 原 `SOCIALIZE_BPS` → **`DEF_ALERT_BPS = 500`**，降为链下告警，不进合约 | §15.4 |
| 8 | 清算奖励 | 5% 总奖励（按**付款额**计）/ 其中 1% 给储备 | §9.1 |
| 9 | keeper 奖励 | **`RENT_REWARD_HAC = 0.07 HAC/键`**（链上实测成本 0.054 × 1.3）、**`RENT_THRESHOLD = 100` 块**、**单笔 ≤10 键** | §15.2 |
| 10 | TREASURY | **保持冷钱包 `1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK`，不改多签** | §15.5 |
| 11 | Phase 2 项 | **v1 全部不做**：宽限期、提现队列、荷兰拍卖、稳定池 | §19.2 |
| 12 | 坏账社会化 | **v1 就做全局 `hcut:hac` + `lcut:hac`**，不留到 Phase 2 | §8A |
| 13 | `lpr` 口径 | **存名义值**，入账按 `S/lcut` 溢价；结算先 lcut 后 hcut | §8A.5 |

### 19.2 为什么 v1 不做 Phase 2 那四项

- **宽限期**（`LIQ_GRACE_BLOCKS`）：多一个 `liq:since:<addr>` 键 + 一条新的失败路径，
  换来的是一个在 20% 缓冲 + close factor 50% 下很少发生的场景；延迟坏账处置反而放大损失。
- **提现队列**：排队机制要记录队首/份额/顺序，**合约不可升级，写错就是资金死锁**；
  v1 已有 `U_MAX=50%` 现金下限 + AMM 70% 预留两层保护，现金不足直接 `return 11` 更安全。
- **荷兰拍卖**：需要起拍价/时长/步长参数与买家，可能流拍；v1 固定折扣可预测、实现简单。
- **稳定池**：需要预先锁定一大笔 HAC 且存款人承担信用风险；在协议还没有规模时启动不起来。

> 结论：先用最少的状态键和最少的失败路径跑通主网，等真实清算/挤兑数据出来，
> 再决定要不要用一次合约迁移换这些机制。

### 19.3 仍需项目最终确认

- **参数实测校准：已完成**（2026-10-23 链上实测，见 §15.2 表格）；`RENT_REWARD_HAC = 0.07 HAC/键` 已定稿；
- **keeper 需按 10 键一批**调用（单笔 storage 上限 111,911；11 键超限），单键调用不划算；
- **上线前压力测试**：用 §17.2 的场景校准 `LIQ_COLL_RATIO_BPS`、`RES_TARGET_BPS`、
  `U_MAX_BPS`、`SLOPE2_BPS`；
- **索引器改造**：需支持 `hcut`/`lcut` 有效值换算、活跃键清单、`def` 告警（§8A.8 / §15.3）。

### 19.4 本轮已修订的实施细节（2026-10-23）

| 位置 | 原写法 | 修正后 | 原因 |
|---|---|---|---|
| §8A.5 / §7.1 | `lpr += lp_share` | `lpr += lp_share × LCUT_SCALE / lcut` | 否则 haircut 后的新收益被旧 lcut 重复打折 |
| §8A.3 表 | LP 结算只按 hcut 折一次 | 先 lcut 再 hcut 折两次 | 两级社会化相互独立 |
| §2.2 / §2.3 / §17.1 | 不变量用 `lpr:hac` 原值 | 用 `lpr × lcut / LCUT_SCALE` | 与"lpr 存名义"口径一致 |
| §9.2 | `loss = debt - pay` 无封顶 | 先 `pay = min(deep_pay, debt)` | `coll/debt ∈ [1.031, 1.05]` 时 u128 下溢 |
| §9.1 / §9.2 | `pbal - need_hac` 直接相减 | `pbal - need_hac × S / hcut` | 名义余额与 HAC 金额混用 |
| §8.1 | `res` 不足即进 `def`，再 `socialize_if_needed()` | 统一为 `apply_loss` 六段瀑布 | 与 §8A.4 冲突；社会化不是事后触发 |
| §8A.4 | 缺 `res`/`tre` 两步、`HCUT_MIN` 未生效 | 补齐并加下限保护 | 下限此前只写在文字里 |
| §8A.10 #5 | "lpr（暂不）" | "v1 启用 lcut" | 与 §8A.4 矛盾 |
| §12.5 | 动态折扣 2–10% | mint 100% | 覆盖率是折扣积分器，反馈控制退化（§12.5.3） |
| §12.2 | `mint = gross × 95%` | `mint = gross` | 同左 |
| §15.2 | `rent_keys` 无条件续租 + 付酬 | 只在 `live < RENT_THRESHOLD` 时续租付酬 | 否则同一键可反复领赏抽干 `tre` |
| §15.4 | `SOCIALIZE_BPS` 作触发阈值 | 改名 `DEF_ALERT_BPS`，降为链下告警 | v1 社会化已改为立即瀑布，阈值不存在 |
| §8A.4 ④ | 只扣 `amm:hac` | **按比例同扣 `amm:hac` 与 `amm:ds`** | 只扣一侧会推高池价 → `amm:ref` 漂移 → 抵押估值偏高 → 下一轮更易坏账 |
| §12.3 | 赎回直接 `res:hacd_score -= gross` | 先校验 `cnt >= 1` 且 `pool_score >= gross`，否则 `return 61` | 空池/记录不足时 u128 下溢（合约不可升级，属实锤级故障） |
| `total_sub` | 直接 `tot - delta` | **饱和减法**（不足则归 0），并在 `self_check` 位 256 报警 | 宁可停在可检测的异常态，也不要回绕成天文数字打死账本 |

---

## 20. 结论

- 3-lite 是当前阶段更合理的折中：比 full 1 资本效率高，比 full 3 风险可控；
- LP 的 HAC 只有 30% 承担信用风险，因此只按 30% 分利息；hacds 侧不分利息；
- 利息给 LP 是对的，但必须同时有利用率上限、动态利率、储备/赤字、覆盖率闸门和 LP 风险披露；
- 最差的是“共享但没有缓冲、LP 承担隐性信用风险、利息却不给 LP”；3-lite 把这三件事同时解决；
- 下一步：项目确认 §19 的剩余决策 → 按 Stage A–G 出合约改动（先不动合约，等签收）。
