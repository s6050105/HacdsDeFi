import pathlib
import re
import sys

BASE = pathlib.Path(r"D:\hacds_server-main\白皮书")

# 三语横幅。{ver} = 本文档描述的版本，#3000 一律填 #2000。
ZH = """> ⚠️ **本文档描述的是已停用的 #2000 版本，请勿作为当前实现依据。**
>
> #3000 已删除**预言机、证书与管理员**，架构有重大变化：
> HACD 评分改为合约链上直读基因自算，无证书流、无 `init_admin` / `set_paused` / `set_oracle`，
> 资产参数改为 serial 3000 / decimal 0，合约地址改为 `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`。
>
> **当前实现请以以下文档为准：**
> - [README](../README.md)
> - [经济设计（定稿）](../hacds_exchange/HacdsDeFi3000-经济设计-定稿.md)
> - [发行参数](../hacds_exchange/发行参数-正式.md)
> - [终审安全报告](../安全审计/上线前安全审计报告-2026-10-27-终审.md)
>
> #3000 版的本文档将在合约部署后随正式版发布。
"""

EN = """> ⚠️ **This document describes the retired #2000 version. Do not use it as the current implementation reference.**
>
> #3000 removes the **oracle, certificates, and the admin**: HACD scoring is now computed
> on-chain from the diamond gene, with no certificate stream and no `init_admin` / `set_paused` /
> `set_oracle`. Asset parameters are now serial 3000 / decimal 0, and the contract address is
> `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`.
>
> **For the current implementation, refer to:**
> - [README](../README.en.md)
> - [Economic design (final)](../hacds_exchange/HacdsDeFi3000-经济设计-定稿.md)
> - [Deployment parameters](../hacds_exchange/发行参数-正式.md)
> - [Final audit report](../安全审计/上线前安全审计报告-2026-10-27-终审.md)
>
> The #3000 edition of this document will ship with the official release after the contract is deployed.
"""

TR = """> ⚠️ **Bu belge, kullanımdan kaldırılmış #2000 sürümünü açıklar. Güncel uygulama referansı olarak kullanmayın.**
>
> #3000, **oracle, sertifika ve yöneticiyi** kaldırır: HACD puanlaması artık elmas geninden
> zincir üzerinde hesaplanır; sertifika akışı ve `init_admin` / `set_paused` / `set_oracle` yoktur.
> Varlık parametreleri serial 3000 / decimal 0 olarak değişti; kontrat adresi
> `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`.
>
> **Güncel uygulama için bkz:**
> - [README](../README.md)
> - [Ekonomik tasarım (kesin)](../hacds_exchange/HacdsDeFi3000-经济设计-定稿.md)
> - [Dağıtım parametreleri](../hacds_exchange/发行参数-正式.md)
> - [Nihai güvenlik denetimi](../安全审计/上线前安全审计报告-2026-10-27-终审.md)
>
> Bu belgenin #3000 sürümü, kontrat dağıtıldıktan sonra resmi sürümle birlikte yayımlanacaktır.
"""

FILES = {
    "HacdsDeFi-白皮书.md": ZH,
    "HacdsDeFi-RPC文档.md": ZH,
    "HacdsDeFi-操作说明书.md": ZH,
    "HacdsDeFi-Whitepaper.en.md": EN,
    "HacdsDeFi-RPC-Doc.en.md": EN,
    "HacdsDeFi-User-Guide.en.md": EN,
    "HacdsDeFi-Whitepaper.tr.md": TR,
    "HacdsDeFi-RPC-Doc.tr.md": TR,
    "HacdsDeFi-User-Guide.tr.md": TR,
}

MARKER = "本文档描述的是已停用的 #2000 版本"
MARKER_EN = "describes the retired #2000 version"
MARKER_TR = "kullanımdan kaldırılmış #2000"

changed = 0
for name, banner in FILES.items():
    p = BASE / name
    if not p.exists():
        print(f"MISSING {name}")
        continue
    s = p.read_text(encoding="utf-8")
    if MARKER in s or MARKER_EN in s or MARKER_TR in s:
        print(f"SKIP   {name}（已有声明）")
        continue
    # 在「标题 + 空行 + 日期行」之后插入
    lines = s.split("\n")
    if not lines or not lines[0].startswith("#"):
        print(f"WARN   {name}（首行不是标题，跳过）")
        continue
    # 找日期行（第 3 行通常是日期）
    insert_at = 1
    for i in range(1, min(6, len(lines))):
        if lines[i].strip():
            insert_at = i + 1
            break
    new = lines[:insert_at] + [""] + banner.split("\n") + lines[insert_at:]
    p.write_text("\n".join(new), encoding="utf-8")
    print(f"OK     {name}")
    changed += 1

print(f"\n共处理 {changed} 个文件")
