# HacdsDeFi

hacds 是一套运行在 Hacash 主网上的 DeFi 协议，由一份 HVM 合约、一个链下索引器和一个冷热分离的钱包组成。

> **当前版本：#4000，已于 2026-11-18 部署主网。**
> 旧版 #2000（铭文方案）与第一轮 #3000 均已停用，详见下方「历史版本」。
> 旧版源码见 git 标签 [`v2000-legacy`](../../releases/tag/v2000-legacy)，仅供查阅。

## 下载

| 端 | 文件 | 说明 |
|---|---|---|
| PC | `HacdsDeFi-Setup-0.4.4-x64.exe` | 安装版 |
| PC | `HacdsDeFi-0.4.4-x64.exe` | 免安装版 |
| Android | `HacdsDeFi-0.2.3-arm64.apk` | arm64，需允许安装未知来源 |

见 [Releases](../../releases/latest)。也可以从源码构建：

```bash
cd wallet-app && npm install && npm start
```

## 核心参数

| 项 | 值 |
|---|---|
| 资产 | hacds（serial **4000**，decimal **0**） |
| 发行量 | 5,963,298,700,000,000（固定，无增发函数） |
| 合约地址 | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`（nonce=5，**已部署**） |
| 金库分红合约 B | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`（nonce=4，`TREASURY` 指向它） |
| 股权资产 | HACDS-SHARE（serial **4001**，supply 10,000，issuer 为部署者地址） |
| 部署者 | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| 管理员 | **无**（合约不可升级、不可暂停、无自毁） |
| 预言机 | **无**（改为合约链上直读钻石基因自算分） |

完整参数见白皮书[附录 A](Whitepaper/HacdsDeFi-白皮书.md)，每个数字都是合约源码里的常量。

### 历史版本

| 版本 | serial | 合约地址 | 状态 |
|---|---|---|---|
| #2000（铭文方案） | 2000 | `VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1` | 已停用，用户资产全部赎回 |
| #3000（第一轮主网） | 3000 / 3001 | `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH` | 作废，股权发行参数误填导致份额锁死 |
| **#4000（当前）** | **4000 / 4001** | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` | **运行中** |

> ⚠️ 第一轮 #3000 作废的原因值得记下来：股权资产发行时把 `issuer` 填成了金库合约地址，
> 而 Hacash 的 `AssetCreate` 把 supply **直接记到 issuer 名下、不触发任何合约钩子** ——
> 链上余额 10,000 而合约的 `sh:` 份额账本为 0，`PermitAsset` 因此永远不放行，
> 份额再也转不出去。serial 不可重发，整套只能换号重来。
> 完整记录见白皮书 §5.2。
> **教训：`issuer` 回答的是「资产诞生在哪里」，不是「资产归谁管理」。**

## 目录

| 路径 | 内容 |
|---|---|
| `hacds_exchange/HacdsDeFi3000.fitsh` | 合约 A 源码（fitsh，部署于 HVM）。<br>文件名沿革自 #3000，内容为 #4000 |
| `hacds_exchange/vault.fitsh` | 合约 B 源码（金库分红） |
| `hacds_exchange/_build_v30/` | 合约 A 构建产物（deploy.json / contractmap / manifest） |
| `hacds_exchange/_build_vault/` | 合约 B 构建产物 |
| `hacds_exchange/score_sum.rs` | 评分内核源码（RV64IM） |
| `hacds_exchange/score_sum_opt.hcf1` | 预编译优化内核（2,026 B，**部署用的就是这个**） |
| `hacds_exchange/HacdsDeFi3000-经济设计-定稿.md` | 经济设计（面向用户） |
| `hacds_exchange/发行参数-正式.md` | 部署参数 |
| `hacds_exchange/indexer/` | 链下索引器 + Keeper + 交易构建服务 |
| `wallet-app/` | 钱包 + DeFi 控制台（Electron） |
| `android-app/` | 钱包 + DeFi 控制台（Android，原生 Kotlin/Compose） |
| `hacds.com/` | 官网（静态站 + Cloudflare Worker 反代） |
| `Whitepaper/` | 白皮书、用户手册、RPC 文档（中英土三语，md + pdf） |
| `安全审计/` | 上线前安全审计报告与工作底稿 |
| `hacds_exchange/oracle/` | 旧版预言机源码（#2000 存档，**#4000 不使用**） |

### 为什么默认用预编译内核

交易大小上限 `max_tx_size = 16,384` 字节（编译期常量）。用 `score_sum.rs`
现编的内核是 3,700 B，会让部署动作达到 17,872 B，直接超限；
预编译的 `score_sum_opt.hcf1` 只有 2,026 B，最终产物 16,200 B。
两者**算法等价** —— 585 组用例（n=1 边界、n=2~8 随机、n=200 满载）实测输出完全一致。

要自行重编内核：`sh build-v3000.sh --rebuild-kernel`（可能超限）。

## 组成

**合约**（`HacdsDeFi3000.fitsh`）

一个合约承载四种能力：

- **AMM**：hacds ↔ HAC 恒定乘积，手续费 0.5%（80% 给 LP / 20% 进储备）
- **HACD 铸造**：存入钻石铸造 hacds，链上直读基因自算 5 维评分，**100% 不打折**
- **借贷**：用 hacds 抵押借 HAC，LTV 50%，清算线 160%，利用率浮动利率 2%–46%
- **金库**：手续费归集，任何人可触发清扫

**无管理员**：合约里没有任何人可以暂停、修改参数或转走用户资产。
参数是编译期常量，部署后不可修改。

**坏账处理**：六级瀑布（储备 → 金库 → LP 奖励 → LP 本金 30% → 全局 hcut → 赤字）。
极端情况下所有存款人按比例分担，**hcut 只降不升**。

**索引器**（`hacds_exchange/indexer/hacds_indexer.py`）

合约无法枚举地址，故在链下扫链建台账。对钱包暴露 `GET /watchlist`；
另有 `/backing` 供运维监控「合约内部积分 vs 真实链上余额」。

**Keeper**（`hacds_keeper.py`）

无许可的账本键续租。Hacash 的合约存储有租期，到期键会被物理删除。
任何人可调用 `rent_keys` 续租并领取报酬（0.07 HAC/键，从 `tre:hac` 支出）。

**交易构建服务**（`hacds_build_server.py`）

官网的 `/api/build`。**不签名、不广播、不持私钥**，只把合约调用参数
编码成未签名交易体交给钱包签名。

**钱包 + DeFi 控制台**（`wallet-app/`、`android-app/`）

冷端离线构建 + 签名，热端联网查询 + 广播，私钥不触网。
中英土三语。

## 部署

### 服务端

```bash
# 索引器（默认监听 127.0.0.1:8124，只读）
python3 hacds_exchange/indexer/hacds_indexer.py serve --node http://<node>:8082

# 交易构建服务（默认 127.0.0.1:8125）
# 合约地址默认值已是主网的 bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h，通常无需显式指定
python3 hacds_exchange/indexer/hacds_build_server.py \
    --node http://<node>:8082 \
    --txbuild /opt/hacash_fullnode/target/release/hacds_txbuild

# Keeper（续租合约 A 与合约 B 的存储键）
export HACDS_KEEPER_KEY_HEX=<64 位十六进制私钥>
python3 hacds_exchange/indexer/hacds_keeper.py \
    --node http://<node>:8082 \
    --contract bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h
```

详细说明：

- 索引器：[`部署说明-索引器.md`](hacds_exchange/indexer/部署说明-索引器.md)
- 构建服务：[`部署说明-构建服务.md`](hacds_exchange/indexer/部署说明-构建服务.md)

### 钱包

```bash
cd wallet-app
npm install
npm start          # 开发运行
npm run dist       # 打包
```

```bash
cd android-app
./build-engine.sh both
./gradlew :app:assembleRelease
```

> 打包前确认 `wallet-app/bin/hacds_txbuild.exe` 与 `android-app/.../libhacds_txbuild.so`
> 是 **2026-10-26 之后**构建的——旧引擎不支持 #4000 的无证书 HACD 路径。
> 用 `sha256sum -c SHA256SUMS.txt` 核对。

## 安全

- **私钥不落盘、不进 argv**：签名时通过环境变量 `HACDS_SIGN_KEY_HEX`
  传给子进程，命令行的 `ps` / 进程列表里看不到。
  ⚠ **残余风险要说清**：环境变量对**同用户权限的其他进程**是可见的
  （Linux 读 `/proc/<pid>/environ`，Windows 需相应权限）。
  这挡的是「日志泄漏、进程列表泄漏、崩溃转储」，**不挡**同机同用户的其他程序。
  冷热分离的意义正在于此——签名机不装别的软件。
- **合约无管理员**：没有暂停开关，也没有人能改参数或转走资产
- **金库是合约，不是钱包**：协议收入通过 `TREASURY` 常量归集到金库分红合约 B
  （`duEkx1E3…`），由链上代码按质押份额分配，没有任何人能单方面取走。
  分配规则是编译期常量，链上可查。

完整威胁模型与已修复项见 [`安全审计/`](安全审计/)。

## 审计

按轮次时间顺序：

| 轮次 | 日期 | 结论 |
|---|---|---|
| 上线前审计 | 2026-10-25 | 4 阻断 / 5 High / 16 Medium |
| 终审 | 2026-10-27 | 上轮阻断全修；新增 2 阻断（已修），代码侧无阻断项 |
| 第 4 轮 | 2026-11-12 | 修复复核 |
| **第 5 轮（No-Go）** | **2026-11-15** | **3 阻断 / 12 High / 约 18 Medium，判定不建议上线** |
| 修复闭环 | 2026-11-15 | 15 条硬门禁逐条修复，其中 14 条在合约之外 |
| 发布前准备 | 2026-11-18 | 主网部署执行清单与最终核对 |

报告（按时间）：

1. [上线前审计报告 2026-10-25](安全审计/上线前安全审计报告-2026-10-25.md)
2. [终审报告 2026-10-27](安全审计/上线前安全审计报告-2026-10-27-终审.md)
3. [第 4 轮 2026-11-12](安全审计/上线前安全审计报告-2026-11-12.md)
4. [**第 5 轮 2026-11-15（No-Go）**](安全审计/上线前安全审计报告-2026-11-15.md)
5. [修复清单 2026-11-15](安全审计/修复清单-2026-11-15.md)
6. [重编译验证 2026-11-15](安全审计/重编译验证-2026-11-15.md)
7. [修复进度 2026-11-15](安全审计/修复进度-2026-11-15.md)
8. [主网部署清单 2026-11-18](安全审计/主网部署清单-2026-11-18.md)
9. [发布前准备 2026-11-18](安全审计/发布前准备-2026-11-18.md)

[工作底稿](安全审计/工作底稿/)

> **第 5 轮为什么判 No-Go**：核心不是又找到一个注入点，而是
> 「当前磁盘上的部署产物无法被证明来自当前源码，而用于证明它的自检脚本
> 会在关键分支里丢弃全部校验结果」。合约无管理员、不可升级、体积逼近
> 16,384 B 上限，一次错误部署不可逆。这一轮拦下的是**验证链断裂**，
> 修复也全部落在合约之外（重编译、修自检、统一文档）。
>
> **测试**：`hacds_exchange/测试报告-v2.md`（含 11-15 借贷清算实测、
> 11-17/18 金库分红合约 B 完整实测）。历史版本见 `_test/历史报告/`。

> **构建**（`fitshc` v1.3.0）：合约 A 的 `action` 为 16,200 B，合约 B 为 2,333 B（上限均 16,384）。
> 权威值见 `_build_*/manifest.json`，自检脚本 `_test/verify_build.py`。
> 二进制指纹见 [`SHA256SUMS.txt`](SHA256SUMS.txt)。
>
> 部署前置：节点 **≥ v1.3.0** 且块高 **≥ 800,000**。
> 基因读取走 ACTVIEW `hacd_number_batch` / `hacd_visual_gene_batch`
> （早期文档里的 `hacd_info` 内置已不再使用，那部分是过时描述）。

## 已知限制

| 项 | 状态 |
|---|---|
| 全链路明文 HTTP | 待服务端上 TLS |
| 官网无 CSP | 待补 |
| Android 生物识别未绑定 Keystore | P1，需改密钥生命周期 |
| 索引器单线程 | 一条慢连接可占满，待改 ThreadingHTTPServer |

## 许可证

MIT，见 [LICENSE](LICENSE)。

---

> 早期的「HACD 铭文」方案已废弃（曾上线 xeggex.com 与 nonkyc.io，后停牌）。
> 当前是重写后的合约方案。
