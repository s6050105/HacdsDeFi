# HacdsDeFi

hacds 是一套运行在 Hacash 主网上的 DeFi 协议，由一份 HVM 合约、一个评分预言机、一个链下索引器和一个冷热分离的钱包组成。

- 资产：hacds（serial **2000**，decimal 8）
- 合约：`VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1`
- 白皮书：[Whitepaper/HacdsDeFi-白皮书.pdf](Whitepaper/HacdsDeFi-白皮书.pdf)（中 / 英 / 土三语）
- 操作说明书：[Whitepaper/HacdsDeFi-操作说明书.pdf](Whitepaper/HacdsDeFi-操作说明书.pdf)
- RPC 文档：[Whitepaper/HacdsDeFi-RPC文档.pdf](Whitepaper/HacdsDeFi-RPC文档.pdf)
- 架构图：[Whitepaper/hacds-架构图.pdf](Whitepaper/hacds-架构图.pdf)

> ⚠️ 早期的「HACD 铭文」方案已废弃。曾上线 xeggex.com 与 nonkyc.io，后停牌。当前版本是重写后的合约方案。

## 目录

| 路径 | 内容 |
|---|---|
| `hacds_exchange/HacdsDeFi.fitsh` | 合约源码（fitsh，部署于 HVM） |
| `hacds_exchange/HacdsDeFi.deploy.json` | 部署动作体（无密钥） |
| `hacds_exchange/oracle/` | 评分预言机（Python，纯标准库） |
| `hacds_exchange/indexer/` | 链下索引器（Python，纯标准库） |
| `hacds_exchange/DeFi设计文档-v1..v4.md` | 合约设计演进 |
| `wallet-app/` | 钱包 + DeFi 控制台（Electron） |
| `wallet-app/bin/hacds_txbuild.exe` | 随包交易引擎（Rust，构建+本地签名） |
| `wallet-app/vendor/hacash_sdk.{js,wasm}` | 官方 HACD 转账 SDK（本地签名） |
| `Whitepaper/` | 白皮书 / 说明书 / RPC 文档（各中英土三语）+ 架构图 |
| `tools/` | 辅助脚本（生成密钥、赎回） |

## 组成

**合约**（`HacdsDeFi.fitsh`）
一个合约承载四种能力：AMM（恒定乘积，手续费 0.5% 三分）、LP 质押、借贷（抵押率 50%，年化 5%，惰性计息）、金库。
管理员只能调六个有数值上限的参数，无法触碰用户资金；合约不可升级、无自毁函数。

**预言机**（`hacds_exchange/oracle/hacds_oracle.py`）
链下算钻石评分并签名，输出 126 字节证书（`GET /cert?name=X`）。合约收到后链上重算比对。私钥只在服务端。

**索引器**（`hacds_exchange/indexer/hacds_indexer.py`）
合约无法枚举借款人，故在链下扫链建台账。对钱包只暴露一个接口：`GET /watchlist`。

**钱包 + DeFi 控制台**（`wallet-app/`）
Electron。冷端离线构建+签名，热端联网查询+广播，私钥不触网。
含资产总览、协议状态、借贷额度提示、AMM 实时报价、HACD 收藏、HACD 点对点转账、离线签名、原子交易、清算台。中英土三语。

> **HACD 点对点转账**：链上一级转账（kind 6），**不经过合约、无需证书、一笔最多 200 颗**。
> 签名由官方 `hacash_sdk.wasm` 在主进程本地完成，只把 `tx_body` 交给节点广播 —— 私钥不出主进程。
> 与「存入兑换」区分：后者受 resource 单桶 6,100 限制，**一笔只能 1 颗**。

## 部署

服务端

```bash
# 预言机（默认端口 8123）
python3 hacds_exchange/oracle/hacds_oracle.py serve --port 8123 --node http://<node>:8082

# 索引器（默认端口 8124）
python3 hacds_exchange/indexer/hacds_indexer.py --port 8124 --node http://<node>:8082
```

索引器的 systemd 单元与详细说明见 `hacds_exchange/indexer/部署说明-索引器.md`。

钱包

```bash
cd wallet-app
npm install
npm start        # 开发运行
npm run dist     # 打包到 dist/
```

## 安全

- **私钥永不落盘、不出主进程**：构建时以环境变量注入子进程（`hacds_txbuild`）或直接喂给 WASM，全程不触网。
- **不托管**：hacds 是标准链上资产，放在用户自己的地址里。
- **签名本地完成**：节点的 `/util/transaction/sign` 与 `/create/coin/transfer` 要求私钥经 HTTP 传输，**本项目不使用**。
- 仓库内**不含任何私钥或 wallet 文件**；`.gitignore` 已设防。

## 许可证

MIT，见 [LICENSE](LICENSE)。
