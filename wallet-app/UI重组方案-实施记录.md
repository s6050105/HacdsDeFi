# 钱包 UI 重组 · 实施记录

> 配套文档：`UI重组方案.md`（设计决策）
> 本文记录**实际做了什么、为什么这么做、还剩什么**，避免上下文丢失细节。
>
> 最后更新：2026-11-11

---

## 一、已完成

### 1.1 共享设计变量

**新增文件**（两处内容完全相同）：

```
hacds.com/assets/css/design-tokens.css
wallet-app/renderer/design-tokens.css
```

**为什么不放一个共享目录**：网页端走 HTTP、PC 钱包走 `file://`，
跨项目相对路径在打包后不可靠。两份副本 + `diff` 校验更稳。

**校验命令**：

```bash
diff hacds.com/assets/css/design-tokens.css wallet-app/renderer/design-tokens.css
```

**变量规范**（以网页端命名为准）：

| 类别 | 变量 |
|---|---|
| 背景 | `--bg` `--bg-elev` `--card` `--card-hover` `--border` `--border-lit` |
| 文字 | `--text` `--text-dim` `--text-faint` |
| 主色 | `--blue` `--blue-dim` `--blue-glow` |
| 语义 | `--green` `--amber` `--red` `--gold` |
| 字号 | `--fs-xs`(11) `--fs-sm`(12.5) `--fs-base`(14) `--fs-md`(15) `--fs-lg`(17) `--fs-xl`(22) `--fs-2xl`(28) |
| 间距 | `--sp-1`(4) 到 `--sp-10`(40) |
| 圆角 | `--radius-sm`(8) `--radius`(12) `--radius-lg`(18) |

**别名区**（兼容 PC 钱包旧代码，不用一次性改完）：
`--panel` `--panel2` `--line` `--fg` `--muted` `--accent` `--ok` `--warn` `--err`

### 1.2 圆角与留白

**圆角**：PC 钱包 26 处固定值全部替换为设计变量，半径整体加大。

**窗口留白**：`body { padding: 6px }`，
顶栏加 `border-radius: 12px 12px 0 0`，日志区加 `0 0 12px 12px`。

> **为什么不做真圆角窗口**：Windows 10（build 19045）不支持窗口圆角。
> 真圆角需要 `frame:false + transparent:true` 自绘标题栏，
> 会丢失 Aero Snap、最小化/关闭按钮要自己实现、最大化时四角露桌面、
> 透明窗口在 Windows 上可能拖影。用内部留白达到柔和观感，零风险。

### 1.3 三个页签改为网页端布局

| 页签 | 布局 |
|---|---|
| **兑换** | 左：单卡 + 翻转箭头 + 大号输入框（24px）；右：行情栏（汇率/手续费/价格影响/最少收到）+ 池子储备 |
| **流动性** | 左：加池（两侧自动配平 + 份额预估）；右：我的仓位 + 领奖 + 撤池 |
| **借贷** | 左：借款/还款（顶部显示抵押/债务/健康度/可借上限）；右：追加抵押 |

**关键设计点**：

- 兑换页翻转箭头：`S.swapDir` 0=HAC→hacds，1=hacds→HAC
- 流动性页把「我的仓位」和「撤池」放同栏，因为撤池要用份额数据
- 借贷页把健康数据放进借款卡，因为用户要「看着可借额度决定借多少」
- 健康度 < 160% 自动变红

**踩过的坑**：`swap-arrow` 显示偏小。原因是 PC 钱包有全局
`button { padding: 6px 12px }`，把 32px 方形容器撑宽，内嵌 18px SVG 被挤。
修法：`.swap-arrow { padding: 0 }` + `.swap-arrow svg { width:18px; height:18px }`。

### 1.4 工具页改分组切换

原来查询/运维/高级平铺一页（8+ 张卡片），改为 4 个分组按钮：

```
只读查询 | 运维 | 存储续租 | 高级
```

**踩过的坑**：`renderQueryPanel` 自己会生成带 `<h3>` 的 card，
工具页若再包一层 card 会出现两个标题叠在一起。
修法：工具页只加**分组小标题**（`<h2>`），不包 card。

### 1.5 新增存储续租面板

**为什么必须做**：Hacash 合约存储按租期计费，账本键到期后
`storage_load` 报 `StorageNotActive(108)`，该用户所有操作整笔回滚。

**实现要点**：

- 续租清单从索引器 `/rent_batches?max=10` 取（钱包自己拼不出账本键原始字节）
- 实测返回：`{ ret, batches:[{klen,blob,count}], total, total_all, truncated, dropped }`
- `blob` 是连排原始键字节的 hex，直接作为 `rent_keys(keys, klen, period)` 的 keys
- 合约单笔上限 `RENT_MAX_KEYS = 10`，逐批构建
- 多批时**一次只生成一笔**，避免同时弹多张预览卡

### 1.6 配置迁移

**问题**：配置文件一旦落盘会**永久覆盖**代码默认值。
老用户 `contract` 还是 #2000 的 `VKNw…`，所有合约调用都会失败，
且界面上看不出是「配置残留」而不是「程序坏了」。

**`migrateCfg()` 做三件事**：

| 规则 | 说明 |
|---|---|
| `VKNwXFFM…` → `T1A8kae…` | 只迁移**已知旧值**，不覆盖用户手动填的其它地址 |
| 删除 `oracle` 字段 | #3000 无预言机 |
| 补 `node`/`indexer` 默认值 | **只在缺失时补**，不覆盖已有值（否则用户本地测试的 127.0.0.1 会失效） |

---

## 二、网页端 vs PC 钱包：能力边界（重要）

### 2.1 官方 SDK 的能力

`hacash_sdk.wasm`（来源：`github.com/hacash/wallet` 的 `static/webwallet/lib/`）
导出 5 个函数：

```
create_account_by    hac_transfer    hacd_transfer
sat_transfer         general_transfer
hac_to_mei
```

**没有合约调用能力**。官方 `action.go` 的 kind 列表里没有 44（合约调用）。

### 2.2 网页端拿不到私钥

官方 SDK 的 `hac_transfer(chain_id, from_pass, ...)` 第 2 个参数是**私钥**。

我们的官网用 MoneyNex 插件，**私钥在插件里，网页端拿不到**。
所以网页端**不能**自己用 SDK 构造+签名。

**（这意味着：之前说「网页端可以用 SDK 纯前端实现转账」是错的，
需要后端构造 txbody 再交给插件签名。）**

### 2.3 最终分工

| 功能 | 实现方式 |
|---|---|
| 只读查询 | 直连节点 `sandboxcall`，不需要后端 |
| 二维码 | 纯前端 |
| **合约调用**（兑换/流动性/借贷/续租） | 后端 `/api/build` |
| **hacds 存取/转账** | 后端（SDK 无 `asset_transfer`） |
| **HAC 提取**（合约 → 我） | 后端（SDK 的 `hac_transfer` 是「我 → 任意」，构不出反方向） |
| HAC 存入（我 → 合约） | 后端 |
| HACD 转账 | 后端或 SDK 均可 |

### 2.4 为什么不用 Cloudflare Containers

| 原因 | 说明 |
|---|---|
| 成本模型不对 | 构建服务调用频率极低（用户点按钮才请求），容器常驻不划算 |
| 冷启动 | 容器休眠，唤醒几秒，用户点「兑换」要等 |
| 打包复杂 | 需要 Python + 3MB 二进制同容器 |
| 调试困难 | 容器日志比 journalctl 难查 |

**结论**：保持普通 VPS 部署。

### 2.5 为什么不在浏览器里重写 Type-3 编码

`hacash/jssdk` 只实现了 **Type-2**（单动作）。DeFi 合约调用需要 **Type-3**，
编码逻辑分散在 `protocol/src/codec/tx.rs`、`action/*.rs`、`vm/src/rt/bytecode.rs`。

重写风险极高：**编码与节点不一致 → 用户签的是错误交易**。
`hacds_txbuild` 链接的是和节点同一份 Rust 代码，编码保证一致，这是它存在的意义。

---

## 三、服务器部署要点

### 3.1 端口

都是**入方向**规则（出方向默认全放行）。

| 端口 | 服务 | 来源建议 |
|---|---|---|
| `8124` | 索引器 | `0.0.0.0/0`（只读，可公开） |
| `8082` | 节点 API | 建议限来源；公开也能接受 |
| `8125` | 构建服务 | **不要直接公开**（无鉴权写入口） |

**轻量云服务器**（如腾讯/阿里轻量）走「**防火墙**」页签，不是「安全组」。

### 3.2 节点监听地址

节点默认 `listen_ip = 127.0.0.1`，外部访问不到，需改：

```ini
[server]
listen_ip = 0.0.0.0
```

⚠️ 节点 API 无鉴权，`/query/contract/sandboxcall` 可被当免费算力刷。

### 3.3 构建服务

```bash
python3 hacds_build_server.py --port 8125 \
    --contract T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH \
    --txbuild /path/to/hacds_txbuild
```

对外走 nginx + TLS：

```
Cloudflare Worker → https://build.hacds.com → 127.0.0.1:8125
```

### 3.4 2H2G 的资源问题

**2 核 2G 跑主网全节点偏紧**。全节点常驻 1–1.5G + Windows 800MB。

症状：RDP 报 `0x112d`、节点 API 超时、CPU 不高但无响应（在疯狂换页）。

缓解：

```powershell
$env:HACASH_DB_SMALL_MACHINE = "1"   # 小内存模式
```

排查换页：

```powershell
Get-Counter '\Memory\Pages/sec' -SampleInterval 2 -MaxSamples 3
```

---

## 四、本机测试环境（已验证）

| 组件 | 地址 | 状态 |
|---|---|---|
| 节点 | `127.0.0.1:8082` | ✓ 798,636 块 |
| 索引器 | `127.0.0.1:8124` | ✓ head 798,636 |
| 构建服务 | `127.0.0.1:8125` | ✓ 已返回 txbody |
| txbuild | `wallet-app/bin/hacds_txbuild.exe` | ✓ |

**构建服务启动命令**：

```bash
cd hacds_exchange/indexer
python hacds_build_server.py --port 8125 --host 127.0.0.1 \
  --contract T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH \
  --txbuild /d/hacds_server-main/wallet-app/bin/hacds_txbuild.exe
```

**实测响应**：

```json
{"txbody":"03006af3bc5c1600...","fee":"0.0002 HAC","fn":"lp_harvest","contract":"T1A8kae..."}
```

---

## 五、待办

### 5.1 网页端

| 项 | 状态 |
|---|---|
| 资金页签 | 待做（需后端） |
| 转账页签 | 待做（需后端） |
| 工具页签：查询 | 可直接做 |
| 工具页签：续租 | 待做（需后端） |
| 工具页签：二维码 | 可直接做 |
| 白皮书/RPC文档重写 | 见 `白皮书/TODO-v3000-重写清单.md` |

### 5.2 PC 钱包

| 项 | 状态 |
|---|---|
| 兑换/流动性/借贷布局 | ✓ 已完成 |
| 圆角与留白 | ✓ 已完成 |
| 工具页分组 | ✓ 已完成 |
| 存储续租面板 | ✓ 已完成 |
| `hcut`/`lcut` 异常时弹提示 | 待做（见 §7） |
| `hacd_coverage` | **不做提示**（见 §7） |

### 5.3 服务器

| 项 | 状态 |
|---|---|
| 轻量云防火墙放行 8124/8082 | 待做 |
| 节点改 `listen_ip = 0.0.0.0` | 待做 |
| 构建服务部署 + nginx 反代 | 待做 |
| 排查 2G 内存是否够用 | 待做 |

---

## 六、验证方法

**PC 钱包页签结构**（CDP 读 DOM）：

```js
[...document.querySelectorAll('#tabs button')].map(b=>b.textContent.trim())
// 期望：["兑换","流动性","借贷","HACD","转账","资金","工具"]
```

**三语一致性**：

```bash
python - <<'PY'
import re, io
s = io.open('renderer/i18n.js', encoding='utf-8').read()
st = [m.start() for m in re.finditer(r"\n    '(zh-CN|en|tr)': \{", s)]; st.append(len(s))
n = ['zh','en','tr']
sets = [set(re.findall(r"""['\"]([a-zA-Z0-9_.]+)['\"]\s*:""", s[st[i]:st[i+1]])) for i in range(3)]
for i,x in enumerate(n): print(x, len(sets[i]))
PY
```

**构建**（避免联网下载 Electron）：

```bash
./node_modules/.bin/electron-builder --win --x64 \
  --config.electronDist=$(ls -d ~/AppData/Local/electron/Cache/*/ | head -1)
```

> 不加 `--config.electronDist` 会尝试从 GitHub 下载 Electron，网络不通时构建失败。


---

## 七、社会化因子与覆盖率：展示决策

### 7.1 三者的真实行为（已核对源码）

**`hacd_coverage` 正常恒等于 100%。**

逐条核对了所有影响分子分母的操作，全部配对：

| 操作 | `amm:ds` | `tot:ds` | 二者之和 |
|---|---|---|---|
| `swap_hac_to_ds` | `-out` | `+got`（= out） | 不变 |
| `swap_ds_to_hac` | `+ds_in` | `-ds_in` | 不变 |
| `add_liquidity` | `+ds` | `-ds` | 不变 |
| `remove_liquidity` | `-ds_out` | `+ds_out` | 不变 |
| 存入钻石 | — | `+gross` | 同时 `res:hacd_score +gross` |
| 赎回钻石 | — | `-charge` | 同时 `res:hacd_score -gross` |

源码注释（`HacdsDeFi3000.fitsh:951`）：
> mint 100% 时恒等于 10000，是"发行是否被掏空"的保险丝。

**`hcut` 改变时账面数字会变，但价值不变。**

| | hcut=100% | hcut=98% |
|---|---|---|
| 存入 1 HAC | `bal:hac` = 1.00 | `bal:hac` = **0.98** |
| 提取全部 | 得到 1 HAC | 得到 **1 HAC** |

存入时 `hac_to_nominal` 除以 hcut，提取时 `nominal_to_hac` 又乘回去。
**新存入和提取的 HAC 数量都不受影响。**

### 7.2 决策

| 指标 | 是否提示 | 理由 |
|---|---|---|
| `hacd_coverage` | **不提示** | 正常恒为 100%；一旦偏离说明合约存在重大漏洞，需要停用并重新部署，此时提示用户没有意义（用户做不了任何事） |
| `hcut` | **异常时提示** | 用户会发现账面数字变小，不解释会以为合约算错 |
| `lcut` | **异常时提示** | 同上，影响 LP 的奖励份额 |

### 7.3 提示文案（待实现）

仅在 `hcut < 1e12` 或 `lcut < 1e12` 时弹出，正常时不显示。

**中文**：

> ⚠️ **社会化因子已下调**
>
> HAC 侧 {hcut}% / LP 侧 {lcut}%
>
> 协议此前发生过坏账，损失已按比例分摊给全体参与者。
>
> **不影响你新存入或提取的 HAC 数量。** 账面显示的数字会按比例缩小，
> 但换算回去后实际价值不变——存多少 HAC 就能提多少 HAC。

实现位置建议：`renderProtocol()` 里读 `hcut()` / `lcut()` 视图，
低于阈值时在协议状态卡顶部插入一条 `.dirbanner` 样式的警告条。

---

## 八、HACD 页统一（2026-11-11）

### 8.1 最终形态：双卡布局 + 详情弹窗

**网页端是标准**（用户明确要求：简洁清爽），PC 端向它靠拢。

```
┌──────────────────────┬──────────────────────┐
│ 存入 HACD            │ 赎回 HACD            │
│ [我的钻石] [加载]     │ [合约池] [加载]       │
│ 筛选栏               │                      │
│ [钻石卡片网格]        │ [钻石卡片网格]        │
│ 已选 N 颗 · 预估铸发  │ 钻石名 [______]      │
│ [批量存入]           │ [批量赎回]            │
└──────────────────────┴──────────────────────┘
       点卡片任意位置 → 详情弹窗（不占布局）
```

**走过的弯路（重要，别再犯）**：
我一开始把方向搞反了 —— 把 PC 端的三区布局（左网格 + 右详情 + 右操作）
复制到网页端。用户纠正：**网页端双卡才是标准，因为更简洁清爽**。
正确做法是 PC 端向网页端靠拢，详情改成弹窗。

### 8.2 卡片点击分派（方案 B）

原来点整张卡会**同时**做两件事，两个意图互相干扰：

- 想快速多选 → 每次都被弹窗打断
- 只是想看看 → 顺手把勾选状态改了

改成按区域分派：

| 点击位置 | 行为 |
|---|---|
| 右上角圆点 `.hc-check` | 只切换勾选，不弹窗 |
| 卡片其它区域 | 只弹详情，不改勾选 |

合约池的钻石 `pickable=false`，**不显示勾选圆点** —— 池里的钻石不能存入，
只能赎回，勾选没有意义。

### 8.3 详情弹窗的行格式

用户反馈「太紧凑」，原本是：

```
名称KTAESW
编号134245
```

原因是 `.det div { justify-content: space-between }` 把标签和值推到两端，
中间一大条空白，读起来像两段无关的文字。

改成「标签：值」连写：

```css
.modal-box .det-row { display: flex; align-items: baseline; }
.modal-box .det-row .k::after { content: ': '; }
html[lang="zh-CN"] .modal-box .det-row .k::after { content: '：'; }
```

冒号用 CSS `::after` 生成并随 `html[lang]` 切换，避免中英混排时出现全角冒号。

### 8.4 加载后不重绘的 bug（PC 端）

**症状**：点「加载」后网格空白，点「全选」才突然出现钻石。

**根因**：`loadHacdDetails()` 末尾调用的是 `renderAssets(S.overview)`，
而 `renderAssets` **只负责首页的资产卡，完全不碰 HACD 面板**。
数据已写进 `S.hacdList`，但界面没重绘；点「全选」会触发 `renderHacdPanel()`，
那时才显示。

**修复**：`loadHacdDetails` / `loadPoolHacd` 两处末尾都加：

```js
if (S.tab === 'hacd') renderHacdPanel();
```

空列表分支也要加，否则「全部赎回后列表不消失」。

### 8.5 网页端 HACD 新增的三个文件

| 文件 | 行数/大小 | 作用 |
|---|---|---|
| `assets/js/diamond-score.js` | 210 行 | 5 维评分（从 PC 端复制，纯 JS 无依赖） |
| `assets/js/diamondsvgimg.js` | 11.5 KB | 钻石 SVG 渲染（同上） |
| `assets/js/hacd-ui.js` | 新增 | 筛选/排序/卡片/详情弹窗 |

**数据关键点**：`ov.diamonds` **只有名字**，画不出图也算不了分。
拿到名字后必须再查一次 `API.diamondDetails(names)` 取 `visual_gene` 和 `number`。
`loadMyHacd` 和 `loadPool` 都要这样做。

### 8.6 两端一致性清单

| 项 | PC 端 | 网页端 |
|---|---|---|
| 双卡布局（存入/赎回） | ✅ | ✅ |
| 来源同时显示（不用下拉切换） | ✅ | ✅ |
| 筛选：形状/样式/最低分/排序 | ✅ | ✅ |
| 钻石卡片带 SVG + 分数 | ✅ | ✅ |
| 勾选圆点（方案 B） | ✅ | ✅ |
| 详情弹窗（不占布局） | ✅ | ✅ |
| 池内钻石不可勾选 | ✅ | ✅ |
| 加载后自动重绘 | ✅ 已修 | ✅ |

---

## 九、窗口尺寸

```js
// wallet-app/main.js createWindow()
width: 1600, height: 960,
minWidth: 1200, minHeight: 720,
```

按 1920×1080 主流屏定，四周留出桌面与任务栏空间。
**为什么不做真圆角窗口**：Windows 10（build 19045）不支持窗口圆角。
真圆角需要 `frame:false + transparent:true` 自绘标题栏，
会丢失 Aero Snap、最大化时四角露桌面、透明窗口在 Windows 上可能拖影。
改用 `body { padding: 6px }` + 顶栏/日志区圆角，达到柔和观感，零风险。

---

## 十、待办（更新）

### 网页端

| 项 | 状态 |
|---|---|
| HACD 页双卡 + 筛选 + 详情弹窗 | ✅ 完成 |
| 资金页签 | ⚠️ 只有 HTML 骨架，JS 待接 |
| 转账页签 | ⚠️ 只有 HTML 骨架，JS 待接 |
| 工具页签 | ⚠️ 只有 HTML 骨架，JS 待接 |

**这三个页签缺的是 `TX.transfer()`** —— 现有 `TX.build(fn, params, main, opts)`
只支持合约调用（POST `{fn, params, main}`），而后端 `/api/build` 的 transfer 模式
已实现并测通：

```bash
curl -X POST http://127.0.0.1:8125/api/build \
  -H 'Content-Type: application/json' \
  -d '{"mode":"transfer","sub":"hac-to","main":"<我>","to":"<对方>","hac":"0.5"}'
# → {"txbody":"03006af3...","fee":"0.0002 HAC","contract":"...","sub":"hac-to"}
```

需要在 `assets/js/txbuild.js` 加一个 `transfer(sub, args)` 函数。

### PC 端

| 项 | 状态 |
|---|---|
| HACD 双卡 + 弹窗 | ✅ 完成 |
| 兑换/流动性/借贷分栏 | ✅ 完成 |
| 圆角与留白 | ✅ 完成 |
| 存储续租面板 | ✅ 完成 |
| hcut/lcut 异常提示 | ✅ 完成 |

### 后端

| 项 | 状态 |
|---|---|
| `/api/build` 支持 transfer | ✅ 完成并测通 5 种形式 |
| serial 放开到任意数字 | ✅ 完成 |
| `from` 锁死为合约地址 | ✅ 保留（安全边界） |

### 服务器

| 项 | 状态 |
|---|---|
| 轻量云防火墙放行 8124/8082 | 待做 |
| 节点改 `listen_ip = 0.0.0.0` | 待做 |
| 构建服务部署 + nginx 反代 | 待做 |

---

## 十一、网页端三个页签实现完成（2026-11-11）

### 11.1 结构

```
HACD | Swap | Liquidity | Lending | Funds | Transfers | Tools
```

7 个页签与 PC 钱包一致。

### 11.2 TX.transfer() —— 补上的关键能力

**问题**：`TX.build(fn, params, main, opts)` 只支持合约调用，POST 的是
`{fn, params, main}`。而资金页/转账页需要的是**原生转账动作**，后端走
`mode:"transfer"` 分支。

**新增** `assets/js/txbuild.js` 里的 `transfer(sub, req)`：

```js
TX.transfer('hac-to', { main, to, hac: '0.5' })
TX.transfer('hac-from-to', { main, from: 合约, to, hac })
TX.transfer('asset-to', { main, to, serial: 'hacds', atoms })
TX.transfer('asset-from-to', { main, from: 合约, to, serial, atoms })
TX.transfer('hacd-to', { main, to, names: 'WTYUIA,HYXYHY' })
```

错误码映射到可读文案（`bad_sub` / `from_must_be_contract` / `bad_hacd_names` 等）。

### 11.3 资金页

| 操作 | 子形式 | 说明 |
|---|---|---|
| 存入 HAC | `hac-to` | 我 → 合约，触发 `PayableHAC` |
| 提取 HAC | `hac-from-to` | 合约 → 我，触发 `PermitHAC` |
| 存入 hacds | `asset-to` | 我 → 合约，触发 `PayableAsset` |
| 领取 hacds | `asset-from-to` | 合约 → 我，触发 `PermitAsset` |

底部有「HACD 资产的存入与赎回请到 HACD 页操作」的提示 + 跳转链接。

### 11.4 转账页

| 操作 | 子形式 | 注意 |
|---|---|---|
| HAC 转账 | `hac-to` | 我 → 他人 |
| hacds 转账 | `asset-to` | **用 asset-to 不是 from-to** —— 发送方隐含为交易主地址 |
| HACD 转账 | `hacd-to` | 支持逗号分隔多个名字 |

### 11.5 工具页

**只读查询 18 项**：池价、池 HAC、池 hacds、LP 总量、利用率、总债务、
HAC 提供者、净债权、储备、赤字、HACD 颗数/总分/均分/覆盖率、hcut、lcut、
借款暂停、参考价。点一下把结果打到底部日志。

**存储续租**：从索引器 `/rent_batches?max=10` 取清单，逐批构建 `rent_keys` 交易
（合约单笔上限 10 键）。

### 11.6 本机测试配置（重要）

构建服务的 **CORS 白名单**要包含预览端口，否则浏览器 `Failed to fetch`：

```bash
cd hacds_exchange/indexer
python hacds_build_server.py --port 8125 --host 127.0.0.1 \
  --contract T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH \
  --txbuild /d/hacds_server-main/wallet-app/bin/hacds_txbuild.exe \
  --cors-origin http://127.0.0.1:8920 \
  --cors-origin http://localhost:8920
```

生产环境用 `--cors-origin https://hacds.com`。

### 11.7 实测结果

| 项 | 结果 |
|---|---|
| 7 个页签渲染 | ✅ 全通过 |
| 查询按钮 | ✅ 18 个 |
| 资金/转账按钮 | ✅ 4 + 3 |
| `TX.transfer` 端到端 | ✅ 返回 `{ok:true, sub:"hac-to", fee:"0.0002 HAC"}` |
| JS 错误 | ✅ 0 |

### 11.8 踩坑：网页端没有 logErr

网页端用的是 `log(errMsg(e), 'err')`，不是 PC 端的 `logErr(...)`。
写新代码时按网页端的写法来。

### 11.9 踩坑：i18n 语言块键名带引号

网页端是 `'zh-CN': {` / `'en': {` / `'tr': {`（带引号），
PC 钱包是 `'zh-CN'` 也是带引号但缩进不同。
用正则插 key 时必须匹配实际格式，否则静默失败。

另外：**插入新 key 到块末尾前，要确认最后一行有逗号**，否则语法错误。

---

## 十二、资金页 / 转账页 两端统一（2026-11-11）

### 12.1 最终布局

**资金页**

```
┌──────────────────────────────┐
│ 合约内余额（PC 独有）          │  ← HAC 积分 / hacds 配额
├───────────────┬──────────────┤
│ HAC 充提       │ hacds 充提    │
│ 存入 / 提取    │ 存入 / 领取   │
│               │ [HACD 跳转]   │
└───────────────┴──────────────┘
```

**转账页**

```
┌───────────────┬──────────────┐
│ HAC 转账       │ hacds 转账    │
└───────────────┴──────────────┘
┌────────────────────────────────┐
│ HACD 转账（支持逗号分隔多名）    │
└────────────────────────────────┘
┌────────────────────────────────┐
│ 其它资产转账（serial + atoms）  │
└────────────────────────────────┘
```

### 12.2 实现差异

| 项 | PC 端 | 网页端 |
|---|---|---|
| 资金页布局 | `renderFundPanel` 双卡 | HTML 双卡 |
| 转账页布局 | `renderXferPage` 双卡 | HTML 双卡 |
| 交易构造 | `window.api.buildTx({mode:'transfer'})` | `TX.transfer(sub, req)` |
| 合约内余额 | ✅ 顶部横条 | ❌（网页端节点直查） |
| 其它资产转账 | ✅ | ✅ 本次新增 |

### 12.3 PC 端 buildTx 的 transfer 参数格式

主进程早就支持了（`main.js:344` 的 `gasMaxFor`），格式是：

```js
await window.api.buildTx({
  mode: 'transfer',
  args: [main, '0', sub, ...],   // 注意：第 2 个参数是 '0'（占位），不是 ts
  keyPath, fee, gasMax, node, contract,
});
```

`gasMaxFor` 会根据 sub 自动选 gas：
- 目标是合约地址 → `null`（用默认 99，因为触发合约钩子）
- `asset-to` / `asset-from-to` → 按 atom 数算
- 其它 → `1`

**所以不要手动传 gasMax**，交给 `gasMaxFor` 判断。

### 12.4 hacds 转账用 asset-to 而不是 asset-from-to

关键区别：

| 子形式 | 语义 | 何时用 |
|---|---|---|
| `asset-to` | 发送方 = 交易主地址（我） | **我 → 他人** |
| `asset-from-to` | 显式 from | 合约 → 我（领取） |

后端对 `from-from-to` 类强制 `from == 合约地址`（安全边界），
所以「我 → 他人」必须走 `asset-to`。

### 12.5 踩坑汇总

| 坑 | 现象 | 修法 |
|---|---|---|
| `loadHacdDetails` 不重绘 | 点加载后网格空白，点全选才出现 | 末尾加 `if (S.tab==='hacd') renderHacdPanel()` |
| Electron 缓存占用 | 重启后 `Unable to create cache` 进程退出 | 先 `Stop-Process` 所有 electron，等 4 秒再启动 |
| 网页端 `logErr` 不存在 | 报错时崩溃 | 用 `log(errMsg(e), 'err')` |
| i18n 插入缺逗号 | `SyntaxError: Unexpected string` | 插入前确认上一行末尾有 `,` |
| PC 端 i18n 块键名 | `'zh-CN': {` 带引号 | 正则要匹配 `'(zh-CN|en|tr)': \{` |

### 12.6 实测结果

| 项 | PC 端 | 网页端 |
|---|---|---|
| 资金页双卡 | ✅ 3 卡（余额 + 2） | ✅ |
| 转账页双卡 | ✅ 4 卡 | ✅ |
| 其它资产转账 | ✅ | ✅ 新增 |
| JS 错误 | ✅ 0 | ✅ 0 |
| 三语一致 | ✅ 609/610/610 | ✅ 314/314/314 |
