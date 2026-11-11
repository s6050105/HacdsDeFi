# redeem.py —— HACD 兑换 hacds 一键工具

把整条兑换链路封成一条命令：**查钻石 → 取预言机证书 → 拼交易 → 本地签名**。

## 它做了什么

```
你的 HACD 钻石  ──(TransferHacdTo)──►  HacdsDeFi 合约
                                        │  PayableHACD 钩子被触发
预言机证书流 ──(Message)────────────────►  │  verify_cert：验签 + 链上重算评分
                                        ▼
                              在你的账户记下 due:<addr> += Σ评分×10⁸
                                        │
                    （随后经顶层 TransferAssetFromTo 领取 hacds）
```

要点：
- **预言机只签名、不发交易、不需要 gas**；证书由**你的交易**携带，gas 由你付。
- 证书流每份 126B = 29B 消息（name+visual_gene+number+score+version）+ 97B 签名。
- ≤2 份（≤252B）走 `Message`（kind 1025，交易里最多 2 条）；更多份自动改走 `Blob`（kind 1026）。
  ≥3 颗钻石需要 ≥378B，只能用 Blob——工具已自动选择。

## 前置

| 组件 | 说明 |
|---|---|
| 全节点 RPC | **默认 `http://127.0.0.1:8082`（本机）** |
| 预言机服务 | **默认 `http://127.0.0.1:8123`（本机）** |
| `hacds_txbuild` | 含 `hacd` 模式的可执行文件 |
| 你的私钥文件 | 64 位 hex |
| Python 3 | 仅标准库 |

> 默认指向**本机**（工具与节点/预言机同机时直接可用）。
> 跨机使用时用 `--node http://<服务器IP>:8082 --oracle http://<服务器IP>:8123` 覆盖。

## 先做连通性自检（推荐第一步）

```bash
python redeem.py --check
```

输出示例（全部可达）：
```
== 连通性自检 ==
  [OK]  节点 http://127.0.0.1:8082  高度=792362
  [OK]  预言机 http://127.0.0.1:8123 health={'ok': True, 'oracle': '1H3sFZ53...'}
  [OK]  预言机 /cert?name=MVUUBA score=32 oracle=1H3sFZ53...
== 结论: 全部可达 ==
```
退出码 0=全通；非 0=有端点不可达（逐条给出原因）。

> 在**服务器本机**跑时，务必用 `127.0.0.1`（用公网 IP 会因 NAT 回环而失败）。

## 用法

```bash
python redeem.py \
  --names KWTVSH,VHUSMI \
  --key  D:\keys\user.key \
  --contract VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1 \
  --txbuild D:\hacash_fullnode\target\release\hacds_txbuild.exe \
  --out redeem_signed.txt
```
（`--node` / `--oracle` 不写就用服务器默认值）

### 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `--names` | ✔ | 钻石名，逗号或空格分隔（每个 6 字符） |
| `--key` | ✔ | 你的私钥文件（64 hex） |
| `--contract` | ✔ | HacdsDeFi 合约地址 |
| `--node` | | 全节点 RPC（默认本机 `127.0.0.1:8082`） |
| `--oracle` | | 预言机服务（默认本机 `127.0.0.1:8123`） |
| `--check` | | 只做连通性自检，不需要 names/key/contract |
| `--txbuild` | | hacds_txbuild 路径（默认从 PATH 找 `hacds_txbuild`） |
| `--fee` | | 交易手续费（默认 0.0002 HAC）；钻石多时交易变大，若被节点以纯度不足拒绝，调高即可 |
| `--gas-max` | | gas_max 字节（默认 99） |
| `--out` | | 已签名交易写入的文件；不给则打印到屏幕 |
| `--cert-only` | | 只取证书、不构造交易（离线检查用） |

## 安全设计

- **不打印私钥**：私钥只用于 ① 本地派生用户地址做归属校验，② 作为 `HACDS_SIGN_KEY` 传给 txbuild。
- **归属校验**：逐颗向节点查 `belong`，不是你的钻石直接报错退出，防止误转他人资产。
- **证书一致性**：核对每份消息恰为 29B、签名恰为 97B，尺寸不符即拒绝。
- 私钥文件建议 `chmod 600` / Windows `icacls` 仅属主（见 `mkkey.sh` / `mkkey.ps1`）。

## 验证过的行为（2026-10-20 实测）

对 2 颗真实钻石（KWTVSH number=85662、VHUSMI number=85750，均归测试账户）：
- 证书流 252B（2×126B），Σ评分 40 → 应收 40 hacds
- 生成交易 424B，`action:2`（kind 7 TransferHacdTo + kind 1025 Message）
- 节点 `/util/transaction/check` 解析通过、验签通过
- 自解码 round-trip + `verify_signature` 通过

## 拿到交易之后

把 `--out` 里的 hex 广播到你信任的节点：

```bash
curl -X POST "http://<node>:8082/submit/transaction?hexbody=true" --data-binary @redeem_signed.txt
```

（`redeem_signed.txt` 已含 `0x` 前缀；若节点要求纯 hex，去掉前两个字符。）
