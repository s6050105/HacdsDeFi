# HacdsDeFi Android 钱包 + DeFi 控制台

**冷热共用钱包 + DeFi 控制台**：冷端离线构建/签名，热端联网查询/广播。

> 设计依据：`Android设计文档.md`（v0.2 定稿）；共用口径以 PC 版《设计文档》§0 为准。

---

## 工程结构

```
android-app/
├── app/                              Kotlin / Compose 应用
│   ├── src/main/java/com/hacds/defi/
│   │   ├── TxEngine.kt               Rust 引擎 JNI 绑定
│   │   ├── AppViewModel.kt           配置/钱包/查询/交易/清算/批量 的统一入口
│   │   ├── core/                     Units / Fee / DiamondScore / Sha3 / ContractErrors / Config
│   │   ├── engine/                   EngineOutput（解析）/ TxBuilder / EngineBridge
│   │   ├── net/                      Http（并发闸门）/ NodeApi / Liquidation
│   │   ├── wallet/                   Keystore(PC 兼容) / Scrypt / AndroidKeyVault / WalletStore / WalletSession / Biometric
│   │   ├── qr/                       Shards（分片数据层）/ QrUi（出码）
│   │   └── ui/                       主题 / 适配 / 组件 / 各页面
│   ├── src/main/jniLibs/             libhacds_txbuild.so（arm64-v8a + x86_64）
│   ├── src/main/assets/              diamondsvgimg.js（官方 HIP-5 图样库）
│   ├── src/main/res/                 strings.xml ×3（479 词条）/ 图标
│   └── src/test/                     纯算法单测（与 PC/预言机交叉验证）
├── engine-build/（见 build-engine.sh）Rust JNI 库构建脚本
├── tools/                            gen_i18n.py / svg2vd.py / uidump.py
└── build-engine.sh                   交叉编译 .so
```

## 构建

```bash
export JAVA_HOME='D:\Dev\jdk-17.0.20.1+1'

# 1) 交叉编译 Rust 引擎（arm64-v8a + x86_64）
./build-engine.sh both

# 2) 构建 APK
./gradlew :app:assembleRelease            # arm64-v8a（正式分发）
./gradlew -Pabi=x86_64 :app:assembleDebug # x86_64（模拟器测试）

# 3) 单测（纯算法交叉验证）
./gradlew -Pabi=x86_64 :app:testDebugUnitTest
```

## 与 PC 版的关系

- **交易构建/签名字节级一致**：Android 与 PC 共用同一份 Rust 引擎（`testkit::txbuild`）。
  Android 侧经新增 `android-jni` cdylib crate 暴露 JNI，**不修改** PC 的 `hacds_txbuild.exe` 构建。
- **钱包互通**：`Keystore.kt` 与 PC 的 `hacds-keystore v1`（scrypt+AES-256-GCM）格式完全兼容，
  内置纯 Kotlin scrypt（与 Node `crypto.scryptSync` 交叉验证一致）。
- **口径一致**：单位（§0.2）、三桶上限（§0.3）、借贷公式（§0.4）严格对齐。

## Windows + NDK 交叉编译要点（已实测）

1. C 依赖（`x16rs-sys`）用 NDK 的 `.cmd` 包装：`CC_<target>=…-clang.cmd`
2. **链接器必须用 `clang.exe` 而非 `.cmd`**：`.cmd` 经 cmd.exe 二次解析会把
   `-Wl,--version-script=…` 搞坏（cdylib 才带 version-script）。
3. 用 `clang.exe` 当链接器时需补 `--target`，且必须走 **target 作用域**
   （`CARGO_TARGET_<T>_RUSTFLAGS`），**不能**用全局 `RUSTFLAGS`（会污染宿主 build script）。

## 实测验证（模拟器 x86_64，主网真实数据）

| 项 | 结果 |
|---|---|
| M0 引擎（JNI） | `signed_tx_hex` 与 PC **逐字节一致**（318 字符全等） |
| 交易被节点接受 | `/util/transaction/check` → `ret:0`，`type:3`，`kind:44` |
| Sha3 selector | Kotlin = PC JS = 主网节点（`pool_price` → `b6e791c9`） |
| scrypt | 与 Node `crypto.scryptSync` 完全一致 |
| 钱包 | Keystore 创建 → 锁定 → 免密重开（vault）成功 |
| 联网查询 | 主网池数据（池 5095 HAC / 169069506278 atoms / LP 293497916234） |
| HACD 图样 | WebView 加载官方 `diamondsvgimg.js`，105 颗全部渲染 |
| 分片二维码 | `HXDS/<seq>/<total>/<crc>/<data>`，CRC 校验、缺片提示、混片检测 |
| 图标 / 多语言 / 屏幕适配 | HAC/HACD/hacds/SAT/CARAT/HACP；479×3；宽屏限宽居中 |
| **服务端索引器（D51）** | ✅ App 实测读到台账：`来源 server`，1 个地址 |
| HACD 存入/赎回/combo | `/util/transaction/check` → `ret:0`（kind 7+1025 / 6+1025 / 1,14,17,19,44） |

## 服务端索引器（D51）已打通（2026-10-22）

**结论：`GET http://43.251.101.101:8124/watchlist` 可用，App 已实测读到台账。**

排查中遇到并解决的三层问题（供后续运维参考）：

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | 本机 8123–8128 被占、结果混淆 | 早期会话遗留 7 个测试进程 | 清理本机残留进程 |
| 2 | 服务器 8124 从外部 TCP 超时 | **Windows 防火墙规则方向写成了 `Outbound`**（应为 `Inbound`） | 新建 `-Direction Inbound -Protocol TCP -LocalPort 8124 -Profile Any` |
| 3 | 一度"秒连但 0 字节响应" | 开发机 **VPN（TAP-Windows Adapter，默认路由 metric 0）**劫持流量 | 关闭 VPN 后澄清（真实路径是超时） |

App 侧实测日志：
```
HacdsLiq: 清算台账：1 个地址，可清算 0（来源 server） addrs=15fv6cNEapTN
```
（`来源 server` = 走服务端索引器，非本地回退）

验证过的接口：`/health`、`/watchlist`、`/sync`、`/watch/add`、`/watch/remove`（读写全通）。

### 排障要点
- 服务器是 **Windows Server 2022**，用 `Get-NetFirewallRule` / `New-NetFirewallRule`，不是 `ss`/`systemd`。
- 云安全组三条规则（8082/8123/8124 均 `tcp 0.0.0.0/0`）一致，**不是**瓶颈；瓶颈在 Windows 防火墙规则方向。
- 排查网络问题时先确认开发机**没有 VPN/代理**在改路由（`route print` 看是否有多条 `0.0.0.0` 默认路由）。

### 调试便利
App 支持 intent extra 深链：`--ei tab 1 --ei sub 5` 直达「交易 → 清算」页（便于自动化；模拟器 dump 不覆盖底部导航时尤其实用）。

## 尚需服务端配合

- **清算模块（D51）** 的「借贷清算台」需要**服务端索引器**（`hacds_indexer.py`，
  `GET /watchlist`）。App 已实现完整客户端与优雅降级（未连接时明确提示）。
  部署：见 `../hacds_exchange/indexer/部署说明-索引器.md`。
- 索引器不可用时：LP 奖励结算、金库清扫仍可用（直接查合约）。

## 多语言（D28/D36/D47）：已完整实现并实测（2026-10-22）

**结论：中 / 英 / 土三语言可切换，界面全部文案跟随（含底部导航、二级页签、按钮、提示）。**

- 词条：**603 条 × 3 语言**（PC 版 479 条复用 + Android 特有 124 条新增），三份 `strings.xml` 键集合**完全一致**。
- 取词：`tr(key, ...)`（非 Composable，可在 onClick/协程用）+ `Strings.t(ctx, ...)`。
- 切换：`LocaleHelper`（自实现，不依赖 AppCompat per-app locale）。

实测（模拟器 x86_64）：

| 切换 | prefs | 界面渲染 |
|---|---|---|
| English | `en` | `Assets \| Wallet locked \| Loan status \| My debt \| My collateral` |
| Türkçe | `tr` | `Varlıklar \| Cüzdan kilitli \| Borç durumu \| Borcum \| Teminatım` |
| 中文 | `zh-CN` | `兑换 / 存取 \| AMM 与流动性 \| 借贷 \| 链上转账 \| 清算 / 结算` |

### 踩坑记录（重要）
1. **`AppCompatDelegate.setApplicationLocales` 在本机模拟器（MuMu / API32 非标准 ROM）完全不生效**
   —— 该系统缺 `locale` 服务，AppCompat 报 `AppLocalesMetadataHolderService : Service not found`。
   改为自实现：`attachBaseContext` 包 Locale + 写进程级 Resources。
2. **只包 `attachBaseContext` 不够**：`recreate()` 传入的 base 仍带旧 configuration，文案不变。
   必须同时用 `Resources.updateConfiguration` 写进程级配置。
3. **切换后必须重启进程**：该 ROM 上 `recreate()` 不重新解析资源（选中标记变了、文案没变）。
   用 `AlarmManager` 延时拉起 + `Runtime.exit(0)`。
4. **`SharedPreferences.apply()` 会丢**：切换末尾立即杀进程，异步写盘来不及。
   必须用 `commit()`（同步）。**这是最终定位到的真凶。**
5. **构建缓存会产出陈旧 APK**：`assembleDebug` 报成功但 dex 是旧的（35MB→23MB 才正常）。
   异常时先 `./gradlew clean`。

### 调试便利
- `am start -n com.hacds.defi/.MainActivity --es lang en` → 直接切语言并重启
- `am start ... --ei tab 0..3 --ei sub 0..8` → 直达指定页面
  （模拟器 dump 不覆盖底部导航时尤其实用）
