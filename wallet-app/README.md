# HacdsDeFi 控制台（Electron 桌面应用）

把 HacdsDeFi 合约的用户侧操作做成可视化 Windows 程序：**钱包（创建/导入）+ 全部合约操作**。

## 功能

**钱包**
- **创建**：随机私钥，或「口令派生」（sha256(口令)，同一口令永远同一地址）
- **导入**：64-hex 私钥，或本应用的 keystore JSON
- **打开 / 锁定**：解锁后用内存私钥签名，锁定即清空
- 私钥以 **scrypt + AES-256-GCM** 加密保存到 `%APPDATA%/HacdsDeFi控制台/wallets/`

**合约操作（五个页签）**
| 页签 | 内容 |
|---|---|
| 兑换 / 存取 | HACD→hacds（自动取证书）、领取 hacds 实物、充/提 HAC |
| AMM 与流动性 | HAC↔hacds 兑换、加/撤流动性、领取 LP 奖励 |
| 借贷 | 追加抵押、借出、还款、清算 |
| 链上转账 | HAC 转账、hacds 转入合约/转他人 |
| 只读查询 | HAC 积分、池价、债务、LP 份额等（不发交易、不花 gas） |

**交易流程**：填参数 → `生成交易`（本地签名）→ 预览 hex/摘要 → `校验` → `广播`（手动确认）。

## 安全模型

- 私钥**只在主进程内存**中解密；构建交易时通过环境变量 `HACDS_SIGN_KEY_HEX` 注入 `hacds_txbuild.exe`，**不落盘**。
- 渲染进程开启 `contextIsolation`、禁用 `nodeIntegration`，只能通过 preload 白名单调用主进程。
- keystore 用用户密码派生密钥（scrypt N=2¹⁵），AES-256-GCM 认证加密 —— 密码错/文件被改都会解密失败。
- 应用不上传任何数据；节点/预言机地址由用户配置。

> ⚠️ **务必离线备份 keystore 文件与密码**。忘记密码 = 无法找回私钥（无后门、无中心服务器）。

## 开发运行

```bash
npm install
npm start
```

## 打包

```bash
npm run dist
```
产物在 `dist/`：
- `HacdsDeFi控制台 Setup x.x.x.exe` —— 安装版（NSIS）
- `HacdsDeFi控制台 x.x.x.exe` —— 免安装绿色版

> 未签名 exe 首次运行会有 Windows SmartScreen 提示（“未知发布者”），选择“仍要运行”即可；要消除需代码签名证书。

## 构成

```
main.js       主进程：钱包、交易构建、HTTP
preload.js    白名单桥接
keystore.js   scrypt + AES-256-GCM 加密
renderer/     界面（index.html / style.css / app.js）
bin/          hacds_txbuild.exe（随包，交易构建与签名）
```

## keystore 文件格式

自包含 JSON，可用标准工具解读：
```json
{ "v":1,"kdf":"scrypt","n":32768,"r":8,"p":1,"dklen":32,
  "salt":"<hex16>","iv":"<hex12>","ct":"<hex>","tag":"<hex>",
  "address":"<可读地址>","created":"<ISO时间>" }
```
解密：`key = scrypt(password, salt, N=n, r=r, p=p, dklen=32)` → `AES-256-GCM(key, iv)` 解 `ct`，AAD = `hacds-keystore-v1`。
