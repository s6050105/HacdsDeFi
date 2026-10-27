# HacdsDeFi

**English** | [简体中文](README.md)

hacds is a DeFi protocol on the Hacash mainnet: one HVM contract, an off-chain indexer, and a cold/hot-separated wallet console.

> **Current version: #3000 (pending deployment, under public audit)**
> The previous #2000 is retired: oracle shut down, all user assets redeemed, contract abandoned.
> Legacy source is kept under the git tag [`v2000-legacy`](../../releases/tag/v2000-legacy), for reference only.

## 🚫 About the installers in Releases

**`v0.1.0` in Releases is the legacy #2000 build — do not use it.**

Its contract address is `VKNwXFFM…` (abandoned), the oracle service is shut down, and
HACD deposit/redeem will fail. It supports none of #3000's features.

The #3000 installers will be published after the contract is deployed. Until then,
build from source to test:

```bash
git checkout v3000 && cd wallet-app && npm install && npm start
```

## Core parameters

| Item | Value |
|---|---|
| Asset | hacds (serial **3000**, decimal **0**) |
| Supply | 5,963,298,700,000,000 (fixed, no mint function) |
| Contract | `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH` (nonce=2, not yet deployed) |
| Treasury | `1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK` |
| Admin | **None** (non-upgradeable, non-pausable, no self-destruct) |
| Oracle | **None** (the contract reads diamond genes on-chain and scores locally) |

> ⚠️ **Why the contract address is not `VKNwXFFM…`**: that is the legacy #2000 address (nonce=1).
> A contract address is derived uniquely from `(deployer, nonce)`. nonce=1 is taken,
> so redeployment there is rejected by the node. This version uses nonce=2.

## Layout

| Path | Contents |
|---|---|
| `hacds_exchange/HacdsDeFi3000.fitsh` | Contract source (fitsh, deployed on HVM) |
| `hacds_exchange/HacdsDeFi3000-经济设计-定稿.md` | Economic design (user-facing) |
| `hacds_exchange/发行参数-正式.md` | Deployment parameters (sole authority) |
| `hacds_exchange/indexer/` | Off-chain indexer + keeper + tx build service |
| `wallet-app/` | Wallet + DeFi console (Electron) |
| `android-app/` | Wallet + DeFi console (Android, native Kotlin/Compose) |
| `hacds.com/` | Website (static site + Cloudflare Worker proxy) |
| `Whitepaper/` | Whitepaper, user guide, RPC docs (zh/en/tr) |
| `安全审计/` | Pre-launch security audit reports and working papers |
| `hacds_exchange/oracle/` | Legacy oracle source (#2000 archive, **unused by #3000**) |

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
python3 hacds_exchange/indexer/hacds_build_server.py \
    --node http://<node>:8082 \
    --contract T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH \
    --txbuild /opt/hacash_fullnode/target/release/hacds_txbuild
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
> does not support the certificate-free HACD path of #3000.
> Verify with `sha256sum -c SHA256SUMS.txt`.

## Security

- **Private keys are never written to disk in plaintext and never enter child processes**:
  they are passed via environment variables or in-process overrides, never on argv
- **The contract has no admin**: no pause switch, nobody can change parameters or move assets
- **The treasury is a single cold wallet**: losing that key permanently locks the accumulated
  fees. This is a known, accepted trade-off.

See [`安全审计/`](安全审计/) for the full threat model and fixed findings.

## Audit

| Round | Date | Outcome |
|---|---|---|
| Pre-launch audit | 2026-10-25 | 4 blockers / 5 High / 16 Medium |
| **Final audit** | **2026-10-27** | All previous blockers fixed; 2 new blockers (fixed); no code-side blockers remain |

- [Final audit report](安全审计/上线前安全审计报告-2026-10-27-终审.md) (Chinese)
- [Pre-launch audit report](安全审计/上线前安全审计报告-2026-10-25.md) (Chinese)
- [Working papers](安全审计/工作底稿/) (Chinese)

> The contract is not yet compiled: it depends on the `hacd_info` VM intrinsic
> (read a diamond gene by name), which is not yet active on mainnet.
> The contract portion is a static review plus offline sandbox verification.

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
