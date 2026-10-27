# hacds.com — 项目官网

hacds 协议的官方网站与 DeFi 控制台。纯静态，零构建，中英土三语。

## 目录结构

```
hacds.com/
├── index.html              主页（Hero / 简介 / 功能 / 验证 / 历史 / 上手 / 风险）
├── app/index.html          DeFi 控制台（兑换 / 流动性 / 借贷 / HACD）
├── docs/index.html         协议文档
├── whitepaper/index.html   白皮书在线版
├── assets/
│   ├── css/
│   │   ├── main.css        设计系统（变量、布局、组件）
│   │   ├── app.css         控制台样式
│   │   └── docs.css        文档 / 白皮书样式
│   ├── js/
│   │   ├── config.js       全局配置（合约地址、API 端点）
│   │   ├── i18n.js         三语引擎（180+ 词条 × 3）
│   │   ├── api.js          节点/合约客户端
│   │   ├── wallet.js       MoneyNex 钱包接入（只管签名）
│   │   ├── txbuild.js      交易体构建（调后端）
│   │   ├── home.js         主页逻辑 + 发行量验证器
│   │   ├── app.js          控制台主逻辑
│   │   ├── docs.js         文档滚动高亮
│   │   ├── markdown.js     极简 Markdown 渲染
│   │   └── whitepaper.js   白皮书加载
│   └── img/                图标（复用合约项目 assets）
└── worker/index.js         Cloudflare Worker 反向代理
```

## 本地预览

任意静态服务器即可：

```bash
cd hacds.com
python -m http.server 8899
# 打开 http://127.0.0.1:8899/
```

本地访问时 `config.js` 会自动把 API 指向 `http://127.0.0.1:8082`（见 `useLocal`）。

## 部署

### 1. 部署 Worker（必须先做）

后端服务是 Plain HTTP 且无 CORS 头，官网是 HTTPS，浏览器会以**混合内容 + CORS** 双重原因拦截。

Worker 负责补上 HTTPS 和 CORS 头：

1. Cloudflare Dashboard → Workers & Pages → 新建 Worker
2. 粘贴 `worker/index.js`
3. Settings → Variables 配置环境变量：

| 变量 | 示例值 | 说明 |
|---|---|---|
| `NODE_ORIGIN` | `http://43.251.101.101:8082` | Hacash 节点 |
| `INDEXER_ORIGIN` | `http://43.251.101.101:8124` | 索引器 |
| `BUILD_ORIGIN` | 同 NODE_ORIGIN | 交易构建服务（可选） |
| `ALLOWED_ORIGINS` | `https://hacds.com,https://www.hacds.com` | CORS 白名单 |

4. 绑定自定义域名 `api.hacds.com`

### 2. 部署静态站

Cloudflare Pages / GitHub Pages / 任意静态托管：

- 构建命令：**无**（纯静态）
- 输出目录：`hacds.com/`
- 自定义域名：`hacds.com`

### 3. 修改配置

部署前确认 `assets/js/config.js`：

```js
apiBase: 'https://api.hacds.com',   // 对应 Worker 域名
contract: 'T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH',  // #3000 部署后替换
```

## 设计要点

### 职责边界

| 环节 | 由谁负责 |
|---|---|
| 构建交易体 | 后端 txbuild 服务（**不在浏览器里重复实现**） |
| 签名 | MoneyNex 钱包 |
| 广播 | MoneyNex 钱包（`autosubmit: true`） |
| 查询链上状态 | 官网 → Worker → 节点 |

**为什么交易构建不放浏览器**：Type-3 交易体涉及动作编码、selector、参数 pack、fee 定价。
在 JS 里重写一遍等于给链上行为造第二份实现，一旦与合约不一致，用户签的就是错交易，且现场无法调试。

### 签名页可读性

`tx_message` 证书流（126 字节/颗）默认在钱包里显示成 hex 乱码。官网通过 `msglayout` 让用户看到
「钻石名 / 评分 / 编号」而不是字节：

```js
MoneyNex.signtx({
  txbody,
  msglayout: [
    ['hacd_name', '钻石名'],
    ['hex', '视觉基因', 10],
    ['u64be', '编号'],
    ['u32be', '评分'],
    ['u8', '证书版本'],
    ['hex', '证书签名', 97],
  ],
})
```

### 版本探测

`api.js` 的 `detectVersion()` 用 `hcut()` 视图是否存在来区分 #2000 / #3000：

- #3000 有 `hcut()` → `v3000`
- #2000 没有 → `v2000`

这样 #3000 上线那天官网不用改代码就能切换。

## 已知限制

1. **#3000 未部署** — 合约依赖 HVM 新增的 `hacd_info` 内置。当前链上是 #2000，
   官网按 #3000 规格构建交易，实际调用会失败，直到部署完成。
2. **验证器是简化版** — 主页的发行量验证器只实现了 5 维评分中的部分逻辑，
   用于演示可复算性。完整复算请用 `hacds_exchange/oracle/score_census.py`。
3. **交易构建依赖后端** — `/api/build` 需要在 Worker 里转发到 txbuild 服务，
   该服务目前尚未在公网暴露。

## 浏览器支持

Chrome / Edge / Firefox 最新版。需要安装 [MoneyNex](https://chromewebstore.google.com/detail/moneynex/aokodfkpgklodahhlcnneehpbojjaabf) 扩展钱包。
