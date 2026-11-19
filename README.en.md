# HacdsDeFi

**English** | [简体中文](README.md)

hacds is a DeFi protocol on the Hacash mainnet: one HVM contract, an off-chain indexer, and a cold/hot-separated wallet console.

> **Current version: #4000, deployed to mainnet on 2026-11-18.**
> Both the legacy #2000 (inscription design) and the first #3000 round are retired — see "Legacy versions" below.
> Legacy source is kept under the git tag [`v2000-legacy`](../../releases/tag/v2000-legacy), for reference only.

## Download

| Platform | File | Notes |
|---|---|---|
| PC | `HacdsDeFi-Setup-0.4.4-x64.exe` | Installer |
| PC | `HacdsDeFi-0.4.4-x64.exe` | Portable |
| Android | `HacdsDeFi-0.2.3-arm64.apk` | arm64, allow installs from unknown sources |

See [Releases](../../releases/latest). You can also build from source:

```bash
cd wallet-app && npm install && npm start
```

## Core parameters

| Item | Value |
|---|---|
| Asset | hacds (serial **4000**, decimal **0**) |
| Supply | 5,963,298,700,000,000 (fixed, no mint function) |
| Contract | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` (nonce=5, **deployed**) |
| Vault dividend contract B | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (nonce=4; `TREASURY` points to it) |
| Share asset | HACDS-SHARE (serial **4001**, supply 10,000, issuer is the deployer address) |
| Deployer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| Admin | **None** (non-upgradeable, non-pausable, no self-destruct) |
| Oracle | **None** (the contract reads diamond genes on-chain and scores locally) |

Full parameters are in the whitepaper [Appendix A](Whitepaper/HacdsDeFi-Whitepaper.en.md); every number is a constant in the contract source.

### Legacy versions

| Version | serial | Contract | Status |
|---|---|---|---|
| #2000 (inscription design) | 2000 | `VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1` | Retired; all user assets redeemed |
| #3000 (first mainnet round) | 3000 / 3001 | `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH` | Void; a mis-set issuance parameter locked the shares |
| **#4000 (current)** | **4000 / 4001** | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` | **Live** |

> ⚠️ Why #3000 was voided is worth recording: when issuing the share asset the `issuer`
> was set to the vault contract address, and Hacash's `AssetCreate` credits the supply
> **directly to `issuer` without invoking any contract hook** — the on-chain balance was
> 10,000 while the contract's `sh:` ledger was 0, so `PermitAsset` never allowed a
> transfer out and the shares could never move again. A serial cannot be reissued, so the
> whole numbering scheme had to change. Full record in the whitepaper §5.2.
> **Lesson: `issuer` answers "where was this asset born", not "who manages it".**

## Layout

| Path | Contents |
|---|---|
| `hacds_exchange/HacdsDeFi3000.fitsh` | Contract A source (fitsh, deployed on HVM).<br>Filename carries over from #3000; contents are #4000 |
| `hacds_exchange/vault.fitsh` | Contract B source (vault dividends) |
| `hacds_exchange/_build_v30/` | Contract A build artefacts (deploy.json / contractmap / manifest) |
| `hacds_exchange/_build_vault/` | Contract B build artefacts |
| `hacds_exchange/score_sum.rs` | Scoring kernel source (RV64IM) |
| `hacds_exchange/score_sum_opt.hcf1` | Prebuilt optimised kernel (2,026 B — **this is what was deployed**) |
| `hacds_exchange/HacdsDeFi3000-经济设计-定稿.md` | Economic design (user-facing) |
| `hacds_exchange/发行参数-正式.md` | Deployment parameters |
| `hacds_exchange/indexer/` | Off-chain indexer + keeper + tx build service |
| `wallet-app/` | Wallet + DeFi console (Electron) |
| `android-app/` | Wallet + DeFi console (Android, native Kotlin/Compose) |
| `hacds.com/` | Website (static site + Cloudflare Worker proxy) |
| `Whitepaper/` | Whitepaper, user guide, RPC docs (zh/en/tr, md + pdf) |
| `安全审计/` | Pre-launch security audit reports and working papers |
| `hacds_exchange/oracle/` | Legacy oracle source (#2000 archive, **unused by #4000**) |

### Why the prebuilt kernel is the default

The transaction size cap is `max_tx_size = 16,384` bytes (a compile-time constant).
The kernel compiled fresh from `score_sum.rs` is 3,700 B, which pushes the deployment
action to 17,872 B — over the cap. The prebuilt `score_sum_opt.hcf1` is only 2,026 B,
giving a final action of 16,200 B. The two are **algorithmically equivalent** —
585 test cases (n=1 boundaries, random n=2–8, full n=200) produced identical output.

To rebuild the kernel yourself: `sh build-v3000.sh --rebuild-kernel` (may exceed the cap).

## Components

**Contract** (`HacdsDeFi3000.fitsh`)

One contract provides four capabilities:

- **AMM**: hacds ↔ HAC constant product, 0.5% fee (80% to LPs / 20% to reserve)
- **HACD minting**: deposit a diamond to mint hacds; 5-dimension score computed on-chain from the gene; **no discount**
- **Lending**: borrow HAC against hacds, 50% LTV, 160% liquidation line, utilization-based rate 2%–46%
- **Treasury**: fee accumulation, anyone can trigger a sweep

**No admin**: nobody can pause, change parameters, or move user assets.
Parameters are compile-time constants and cannot be changed after deployment.

**Bad debt**: a six-stage waterfall (reserve → treasury → LP rewards → 30% of LP principal
→ global `hcut` → deficit). In the extreme, all depositors share the loss proportionally,
and **`hcut` only decreases, never recovers**.

**Indexer** (`hacds_exchange/indexer/hacds_indexer.py`)

The contract cannot enumerate addresses, so the indexer scans the chain off-chain.
Wallets use `GET /watchlist`; `/backing` is for operators to monitor
"contract-side points vs real on-chain balance".

**Keeper** (`hacds_keeper.py`)

Permissionless storage-key renewal. Hacash contract storage has a lease; expired keys are
physically deleted. Anyone can call `rent_keys` to renew and earn 0.07 HAC per key,
paid from `tre:hac`.

**Tx build service** (`hacds_build_server.py`)

The website's `/api/build`. It **does not sign, broadcast, or hold any private key** —
it only encodes contract call arguments into an unsigned transaction body for the wallet to sign.

**Wallet + DeFi console** (`wallet-app/`, `android-app/`)

Cold-side builds and signs offline; hot-side queries and broadcasts; the private key never
touches the network. Available in Chinese, English, and Turkish.

## Deployment

### Server

```bash
# Indexer (defaults to 127.0.0.1:8124, read-only)
python3 hacds_exchange/indexer/hacds_indexer.py serve --node http://<node>:8082

# Tx build service (defaults to 127.0.0.1:8125)
# The contract default is already the mainnet one (bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h),
# so it normally needs no explicit flag.
python3 hacds_exchange/indexer/hacds_build_server.py \
    --node http://<node>:8082 \
    --txbuild /opt/hacash_fullnode/target/release/hacds_txbuild

# Keeper (renews storage keys of both contract A and contract B)
export HACDS_KEEPER_KEY_HEX=<64-hex private key>
python3 hacds_exchange/indexer/hacds_keeper.py \
    --node http://<node>:8082 \
    --contract bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h
```

Detailed guides (Chinese): [indexer](hacds_exchange/indexer/部署说明-索引器.md),
[build service](hacds_exchange/indexer/部署说明-构建服务.md).

### Wallet

```bash
cd wallet-app
npm install
npm start          # dev
npm run dist       # package
```

```bash
cd android-app
./build-engine.sh both
./gradlew :app:assembleRelease
```

> Before packaging, make sure `wallet-app/bin/hacds_txbuild.exe` and
> `android-app/.../libhacds_txbuild.so` were built **after 2026-10-26** — the old engine
> does not support the certificate-free HACD path of #4000.
> Verify with `sha256sum -c SHA256SUMS.txt`.

## Security

- **Private keys are never written to disk in plaintext and never enter child processes**:
  they are passed via environment variables or in-process overrides, never on argv
- **The contract has no admin**: no pause switch, nobody can change parameters or move assets
- **The treasury is a contract, not a wallet**: protocol revenue flows through the `TREASURY`
  constant into vault dividend contract B (`duEkx1E3…`), which distributes it by staked
  share according to on-chain code. Nobody can take it unilaterally, and the allocation
  rules are compile-time constants, verifiable on-chain.

See [`安全审计/`](安全审计/) for the full threat model and fixed findings.

## Audit

In chronological order:

| Round | Date | Outcome |
|---|---|---|
| Pre-launch audit | 2026-10-25 | 4 blockers / 5 High / 16 Medium |
| Final audit | 2026-10-27 | All previous blockers fixed; 2 new blockers (fixed); no code-side blockers |
| Round 4 | 2026-11-12 | Fix verification |
| **Round 5 (No-Go)** | **2026-11-15** | **3 blockers / 12 High / ~18 Medium — not recommended for launch** |
| Fix closure | 2026-11-15 | All 15 hard gates closed; 14 of them outside the contract |
| Pre-release prep | 2026-11-18 | Mainnet deployment runbook and final check |

Reports (chronological):

1. [Pre-launch audit 2026-10-25](安全审计/上线前安全审计报告-2026-10-25.md)
2. [Final audit 2026-10-27](安全审计/上线前安全审计报告-2026-10-27-终审.md)
3. [Round 4, 2026-11-12](安全审计/上线前安全审计报告-2026-11-12.md)
4. [**Round 5, 2026-11-15 (No-Go)**](安全审计/上线前安全审计报告-2026-11-15.md)
5. [Fix list 2026-11-15](安全审计/修复清单-2026-11-15.md)
6. [Rebuild verification 2026-11-15](安全审计/重编译验证-2026-11-15.md)
7. [Fix progress 2026-11-15](安全审计/修复进度-2026-11-15.md)
8. [Mainnet deployment runbook 2026-11-18](安全审计/主网部署清单-2026-11-18.md)
9. [Pre-release prep 2026-11-18](安全审计/发布前准备-2026-11-18.md)

(The reports are in Chinese.) [Working papers](安全审计/工作底稿/)

> **Why round 5 was No-Go**: the key finding was not another injection point, but that
> "the deployment artefacts on disk cannot be proven to come from the current source, and
> the self-check script meant to prove it discards all verification results on a key branch."
> With no admin, no upgrade path, and a size pressing against the 16,384 B cap, one bad
> deployment is irreversible. What this round caught was a **broken verification chain**,
> and every fix landed outside the contract (rebuild, fix the self-check, unify the docs).
>
> **Tests**: `hacds_exchange/测试报告-v2.md` (includes the 11-15 lending/liquidation run and
> the 11-17/18 contract B full test). Historical versions under `_test/历史报告/`.

> **Build** (`fitshc` v1.3.0): contract A's `action` is 16,200 B, contract B's is 2,333 B
> (both under the 16,384 cap). Authoritative values in `_build_*/manifest.json`;
> self-check via `_test/verify_build.py`. Binary fingerprints in [`SHA256SUMS.txt`](SHA256SUMS.txt).
>
> Deployment prerequisites: node **≥ v1.3.0** and block height **≥ 800,000**.
> Genes are read through ACTVIEW `hacd_number_batch` / `hacd_visual_gene_batch`
> (the `hacd_info` intrinsic mentioned in early docs is no longer used — that part is stale).

## Known limitations

| Item | Status |
|---|---|
| End-to-end plaintext HTTP | Pending TLS on the server |
| Website has no CSP | Pending |
| Android biometrics not bound to Keystore | P1, requires key-lifecycle changes |
| Indexer is single-threaded | One slow connection can occupy it; pending ThreadingHTTPServer |

## License

MIT — see [LICENSE](LICENSE).

---

> The earlier "HACD inscription" scheme is abandoned (it was listed on xeggex.com and
> nonkyc.io, then suspended). The current version is a rewritten contract design.
