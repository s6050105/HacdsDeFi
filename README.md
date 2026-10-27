# HacdsDeFi

hacds 是一套运行在 Hacash 主网上的 DeFi 协议，由一份 HVM 合约、一个链下索引器和一个冷热分离的钱包组成。

> **当前版本：#3000（待部署，公开审计中）**
> 旧版 #2000 已停用：预言机关闭、用户资产全部赎回、合约废弃。
> 旧版源码见 git 标签 [`v2000-legacy`](../../releases/tag/v2000-legacy)，仅供查阅。

## 🚫 关于 Releases 里的安装包

**Releases 中的 `v0.1.0` 是旧版 #2000 的安装包，请勿使用。**

它的合约地址是 `VKNwXFFM…`（已废弃），预言机服务已关闭，
HACD 存入/赎回会失败；且它不支持 #3000 的任何功能。

#3000 的安装包将在合约部署后发布。在那之前，如需测试请自行从源码构建：

```bash
git checkout v3000 && cd wallet-app && npm install && npm start
```

## 核心参数

| 项 | 值 |
|---|---|
| 资产 | hacds（serial **3000**，decimal **0**） |
| 发行量 | 5,963,298,700,000,000（固定，无增发函数） |
| 合约地址 | `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`（nonce=2，待部署） |
| 金库 | `1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK` |
| 管理员 | **无**（合约不可升级、不可暂停、无自毁） |
| 预言机 | **无**（改为合约链上直读钻石基因自算分） |

> ⚠️ **为什么合约地址不是 `VKNwXFFM…`**：那是旧版 #2000 的地址（nonce=1）。
> 合约地址由「部署者 + nonce」唯一推导，nonce=1 已被占用，重复部署会被节点拒绝。
> 本版使用 nonce=2。

## 目录

| 路径 | 内容 |
|---|---|
| `hacds_exchange/HacdsDeFi3000.fitsh` | 合约源码（fitsh，部署于 HVM） |
| `hacds_exchange/HacdsDeFi3000-经济设计-定稿.md` | 经济设计（面向用户） |
| `hacds_exchange/发行参数-正式.md` | 部署参数（AssetCreate / ContractDeploy 唯一依据） |
| `hacds_exchange/indexer/` | 链下索引器 + Keeper + 交易构建服务 |
| `wallet-app/` | 钱包 + DeFi 控制台（Electron） |
| `android-app/` | 钱包 + DeFi 控制台（Android，原生 Kotlin/Compose） |
| `hacds.com/` | 官网（静态站 + Cloudflare Worker 反代） |
| `Whitepaper/` | 白皮书、用户手册、RPC 文档（中英土三语） |
| `安全审计/` | 上线前安全审计报告与工作底稿 |
| `hacds_exchange/oracle/` | 旧版预言机源码（#2000 存档，**#3000 不使用**） |

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
python3 hacds_exchange/indexer/hacds_build_server.py \
    --node http://<node>:8082 \
    --contract T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH \
    --txbuild /opt/hacash_fullnode/target/release/hacds_txbuild
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
> 是 **2026-10-26 之后**构建的——旧引擎不支持 #3000 的无证书 HACD 路径。
> 用 `sha256sum -c SHA256SUMS.txt` 核对。

## 安全

- **私钥永不落盘明文、不出子进程**：构建时以环境变量或进程内覆盖传入，不进 argv
- **合约无管理员**：没有暂停开关，也没有人能改参数或转走资产
- **金库是单一冷钱包**：私钥丢失 = 该笔手续费永久锁死，这是已知且已权衡的风险

完整威胁模型与已修复项见 [`安全审计/`](安全审计/)。

## 审计

| 轮次 | 日期 | 结论 |
|---|---|---|
| 上线前审计 | 2026-10-25 | 4 阻断 / 5 High / 16 Medium |
| **终审** | **2026-10-27** | 上轮阻断全修；新增 2 阻断（已修），代码侧无阻断项 |

- [终审报告](安全审计/上线前安全审计报告-2026-10-27-终审.md)
- [上线前审计报告](安全审计/上线前安全审计报告-2026-10-25.md)
- [工作底稿](安全审计/工作底稿/)

> 合约尚未编译：依赖主网 VM 内置 `hacd_info`（按名字读钻石基因），
> 该内置在主网尚未激活。合约部分为静态审读 + 离线沙盒验证。

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
