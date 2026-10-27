# 工作底稿 · P1（E 渲染层 / F Android / G 引擎桥 / I 供应链）

> 阶段：P1 ｜ 日期：2026-10-22 ｜ 方法：逐行审读 + 配置核对

---

## E. PC 钱包渲染层（`wallet-app/renderer/**`）

### E-1 ｜ 已列 D-1（Medium）：`innerHTML` 注入
- 46 处 `innerHTML`，远端文本未转义。CSP 挡住脚本执行 → Medium。（详见 P0-2 底稿）

### E-2 ｜ **Low** ｜ 渲染层内嵌第三方 JS 未审计
- `renderer/vendor/`：`qrcode.js`、`sha3.js`、`diamondgene.js`、`diamondsvgimg.js` —— 随包发布的第三方库，**未做源码级审计/版本标注**。
- 影响：若其中任一被植入恶意代码，运行在渲染层（受 CSP + 隔离约束，无法直接读私钥，但可伪造 UI）。
- 修复：标注来源与版本、附校验和；或改用有维护的包并锁定版本。

### E-3 ｜ Info｜ CSP 与隔离（正面）
- `index.html` 有 CSP：`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:`（**无 `unsafe-inline` 在 script-src**）——有效阻断注入脚本执行。
- `webPreferences`: `contextIsolation:true`、`nodeIntegration:false`、`preload` 白名单；`sandbox:false`（见 D-4）。

---

## F. Android 客户端（`android-app/.../com/hacds/defi/**`）

### F-1 ｜ **Medium** ｜ `usesCleartextTraffic="true"` —— 全链路明文 HTTP
- 证据：`AndroidManifest.xml` → `android:usesCleartextTraffic="true"`；`Http.kt` 用 OkHttp 直连 `http://…`（节点/预言机/索引器都是明文 HTTP）。
- 影响：节点/预言机/索引器的响应**可被中间人读取或篡改**。叠加 **D-2/C-3（不校验响应）**，MITM 可向 App 推送**伪造的余额/健康度/清算列表/证书**，误导用户。
- 说明：与项目「明文 RPC」现状一致（H 阶段亦记录此风险），但移动端处公共网络时风险显著。
- 修复：至少对**索引器/预言机**启用 HTTPS；关键数值（余额、健康度、清算判定）与自行 sandbox 查询交叉核对；`usesCleartextTraffic` 在可行时收紧。

### F-2 ｜ **Low** ｜ 依赖 `androidx.security:security-crypto:1.1.0-alpha06` **未使用**
- 证据：全仓 grep 无 `androidx.security` / `EncryptedSharedPreferences` / `MasterKey` 引用。
- 影响：引入一个 **alpha 版**、含已知弃用风险的安全库却未使用（攻击面与维护负担白增）。
- 修复：移除该依赖。

### F-3 ｜ **Info/Low** ｜ 生物识别只是「准入闸门」，非密码学绑定
- 证据：`AndroidKeyVault.kt` → `setUserAuthenticationRequired(false)`（密钥访问不要求系统认证）；`Biometric.kt` 用 `BIOMETRIC_WEAK or DEVICE_CREDENTIAL`（**设备 PIN 亦可解锁**），且仅为 App 层提示。
- 影响：指纹/面容**可被绕过**（例如设备口令、或 App 层逻辑被改），私钥实际由 Android Keystore 保护。**设计文档已自述**「生物识别只是额外准入闸门」，故记为**已知限制**。
- 修复：若要求「生物识别绑定密钥」，应改 `setUserAuthenticationRequired(true)` + 每次使用触发认证。

### F-4 ｜ Info（正面）｜ 分片二维码有完整性校验
- `Shards.kt`：包格式 `HXDS/seq/total/crc/data`，收齐后按序拼接并校验 **CRC32**，可检出缺片/混片。
- 注：CRC32 非密码学强度——若攻击者控制**全部**分片可构造通过 CRC 的伪造体；但该体仍须签名才上链（链上验签/校验），故风险低。记录为设计取舍。

### F-5 ｜ Info（正面）｜ 密钥路径
- 私钥解锁后以 64-hex 经 `TxEngine.runWithKey` **进程内**传入 Rust；无落盘、无网络。`WalletSession` 仅内存驻留，锁定即清。与 PC 语义一致。

---

## G. 交易引擎桥（Rust `testkit::txbuild` + JNI）

### G-1 ｜ **Low** ｜ 私钥以不可擦除的字符串在内存滞留
- PC：经 `HACDS_SIGN_KEY_HEX` 环境变量传给子进程；Android：经 JVM `String`（**不可变，无法 zeroize**）传给 JNI。
- 影响：密钥材料在内存驻留时间超出必要（受 GC/进程生命周期支配），存在内存转储/换页泄漏面。
- 修复：JNI 用 `ByteArray` + 用后清零；Rust 侧接收后 `zeroize`；PC 侧子进程退出即回收（已有）。

### G-2 ｜ 已列 F-006：Rust 源码不在发布树 → 引擎行为不可由公开产物验证。

---

## I. 供应链（复核 + 补充）

| 项 | 结论 |
|---|---|
| 预编译二进制 | 见 **F-006**（不可复现，Medium） |
| CI action 固定 / permissions | 见 **F-007**（Low） |
| gradle-wrapper 无 `distributionSha256Sum` | 见 **F-008**（Low） |
| `hacds_oracle.py` 两份 | 见 **F-009**（Low） |
| **I-1** 钱包 npm 依赖为 `^` 浮动区间 | `electron ^44.9.1`、`electron-builder ^26.15.3`（均为 devDependencies）；构建不可复现（无 lock 固定策略说明）。**Low** |
| **I-2** Release 附件无校验和/签名 | 下载的 Setup/便携/APK 无 `SHA256SUMS`。**Low**（并入 F-006 修复） |
| **I-3** `hacash_sdk.wasm` 版本未标注 | 官方 Hacash SDK，随包发布无版本/校验和。**Low** |
| **I-4** Git 作者信息 | `HacdsDeFi <dev@hacds.local>` 与 `s6050105 <…@users.noreply.github.com>` —— **无隐私泄漏**。Info |
| **I-5** 依赖已知漏洞 | Python 纯标准库（无第三方）；Android 依赖版本较新（除 security-crypto alpha，见 F-2）；未发现已知 CVE（未做联网 CVE 库比对）。Info |

---

## P1 小结

- **无 Critical/High**。P1 主要风险是**传输层明文 + 不校验响应**（F-1 与 D-2/C-3 同源，Medium），以及若干供应链固化项（Low）。
- Android 的**隔离与密钥路径**整体正确（无密钥落盘、无 WebView、JNI 内存传钥）。
- 需修的低成本项：移除未用的 alpha 依赖（F-2）、渲染层远端文本改 `textContent`（D-1）、索引器/预言机上 HTTPS（F-1）。
