# HacdsDeFi3000.fitsh 开发说明（#3000，WIP）

> 状态：**仅代码，未构建、未实现、未部署**。
> 经济设计（3-lite）见：HacdsDeFi3000-经济设计-3lite.md（合约尚未按此修改）。
> 依据：`安全审计/整改/3000版合约-设计草案.md`。
> 文件：`hacds_exchange/HacdsDeFi3000.fitsh`（**只在开发树**；未同步到公开仓库，因为未 VM ABI 前不可编译）。

---

## 1. 做了什么

以现役 `HacdsDeFi.fitsh`（#2000）为基底，按草案逐项改：

| 项 | 改动 |
|---|---|
| **A-1** | **删除**证书/验签/预言机（`cert_message`/`cert_sign`/`verify_cert`/`cfg:oracle`/`set_oracle`/`wr_addr`/`ld_addr`/证书常量）。两个 HACD 钩子改为**链上读基因 + 合约自算分**。 |
| **HACD 单颗** | HACD 钩子**硬限制 1 颗/笔**（`count != 1` → 48），已删除批量循环。原因：VM resource 单桶 6,100，单颗评分约 3,270 resource（quote_score；#3000 还加基因读取）；2 颗会 OutOfGas(31)。客户端继续逐颗拆笔。 |
| **A-2** | `coll_to_hac` 改为**慢速参考价** `amm:ref`；新增 `ref_price()` / `ref_refresh()`（窗口 `REF_WINDOW=300` 块、偏离 `REF_DEV_BPS=±20%`）；借贷三入口先调 `ref_refresh`。`pool_price()` 保留但标注"仅 AMM 展示"。 |
| **A-3** | `loan_liquidate(borrower, repay, min_coll_out)` 改为**清算人出资真 HAC 换抵押品**（市场定价，无 bonus 参数）；**深度水下改为“接管式清算”**：清算人按抵押市值付款、取得全部抵押，债务清零，差额只记一次 `bad:<addr>` 由金库 `tre:hac:` 承担。`amm:ref` 未初始化时拒绝清算（返回 47）。 |
| **A-4** | 删除 `set_liquidate_bonus`（奖励=市场价差）。 |
| **A-6** | 部分清算（`repay ≤ debt`）+ 最小清算额 `MIN_LIQ` + 滑点保护 `min_coll_out`。 |
| **A-5** | `rent_batch`（管理员）→ **`rent_keys`（任何人可调）**。 |
| **§11 去管理员** | 删除 `only_admin`/`init_admin`/`set_fee`/`set_loan_rate`/`set_paused`/`set_oracle`/`set_liquidate_bonus`/`cfg:admin`；`cfg:paused` 守卫全移除（5 处）；费率=`FEE_BPS`、利率=`LOAN_RATE_BPS`（编译期常量）；**契约无暂停能力**。 |
| 精度/serial | `HACDS_SERIAL` → **3000**；账目仍在"原子"层（不变）。`pool_price()` 已按 decimal=0 去掉 ×1e8（改为 zhu per atom）；`ref_price_of()` 仍是内部缩放口径（zhu/atom ×1e8），客户端显示需 ÷1e8。 |
| 查询视图 | 新增 `ref_price_of` / `ref_height` / `bad_of` / `treasury_ds`。 |
| **赎回费 0.5%** | `PermitHACD` 现收 `need×(1+REDEEM_FEE_BPS)`；`charge_fee_redeem(fee)`：**LP 80% → `lpu:ds` / 20% → `tre:ds`**。常量 `REDEEM_FEE_BPS=50`、`REDEEM_LP_BPS=8000`。 |
| **奖励分配修订（鼓励 LP）** | `charge_fee_amm`：**LP 80% / 金库 20%**（`LP_BPS=8000`，删除 `STAKE_BPS`）；`charge_fee_interest` **不变**（HAC 存款人 80% / 金库 20%）；`charge_fee_redeem` → LP 80% / 金库 20%。通道：**`lpu:ds` 承担赎回费、`lpu:hac` 承担 AMM 费、`rpu:hac` 只承担利息、`rpu:ds` 停用**。无 LP/无存款时对应份**并入金库**。详见 `安全审计/整改/合约奖励来源与分配.md`。 |
| **客户端同步** | PC `renderProtocol` 不再展示 `stakedHac/stakedDs`；`q.stake` 改名"总持仓(含HAC存款)"；i18n 管理员文案标注 `[#2000]`/#3000 已移除；Android `Ops.ADMIN` 的 `rent_batch` → **`rent_keys`**，管理员组标注仅对 #2000 有效。 |

## 2. ⚠ 唯一的待适配点：`hacd_read_gene`（ORACLE-SEAM）

```fitsh
function hacd_read_gene(name: bytes) -> (bytes, u128) {
    // TODO(#3000-SEAM)
    var (lg, vg, num) = hacd_info(name)   // ← 我们建议的 ABI；VM 定稿后只改这里
    if size(vg) != 10 { return ("", 0) }
    return (vg, num)
}
```
- 依赖主网新 VM 内置（见 `安全审计/整改/VM-issue-*.md`）。**本版本不可编译/部署**——发布前必须补上。
- VM 若只给 `life_gene`：此处需复刻 `calculate_diamond_visual_gene`（不推荐）。

## 3. 未决 / 待办（实现期）

1. ~~赎回手续费分配~~ → **已实现（LP 80% / 金库 20%）**（2026-10-22 修订，见 `合约奖励来源与分配.md`）。待确认：`REDEEM_FEE_BPS=50`、`REDEEM_LP_BPS=8000` 取值；费是否也应加在**自动补足**腿（现只在赎回腿收）。
2. `MIN_LIQ` 取值、`min_coll_out` 容差。
3. 坏账键粒度：现用 `bad:<addr>`；备选单一 `tot:bad`。**已修**：只在深水接管式清算时记一次；正常部分清算不记坏账，债务清零后不会重复累计。
4. `tre:hac` 不足时的行为（现：清零并依赖后续补足；坏账仍会记入 `bad:<addr>`）。
5. **`amm:ref`/`amm:refh` 首次初始化**：草案 §2.4-① 建议**部署交易显式设初值**；本稿 `ref_refresh` 不自初始化——需在部署流程补。
6. `rent_keys` 是否从 `tre:hac` 给 keeper 付酬（草案 §4b.3）。
7. **fitsh 语法核对**：`var (a,b,c) = f()` 解构、tuple 返回、`size(元组元素)` 等，需编译验证（本稿未构建）。
8. `bad:*` / `amm:ref*` 新键须纳入 `rent_keys` 续租清单。

## 4. 未做的验证

- **未构建**（`fitshc`/`hacds_selftest`/`hacds_e2e` 均未跑）——因 SEAM 未定稿，且按项目方要求"先只改代码"。
- 未同步到导出树 `D:\hacds`（公开仓库）——**待 VM ABI 到手、可编译后再定**。
