# HacdsDeFi

**English** | [简体中文](README.md)

hacds is a DeFi protocol on the Hacash mainnet: one HVM contract, a scoring oracle, an off-chain indexer, and a cold/hot wallet console.

**hacds** is a standard on-chain asset (serial **2000**, decimal 8) — not an inscription.

- Contract: `VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1` (Hacash mainnet, live)

## Download

| File | Description |
|---|---|
| [HacdsDeFi-Setup-0.1.0-x64.exe](https://github.com/s6050105/HacdsDeFi/releases/latest/download/HacdsDeFi-Setup-0.1.0-x64.exe) | Installer (Windows 64-bit) |
| [HacdsDeFi-0.1.0-x64.exe](https://github.com/s6050105/HacdsDeFi/releases/latest/download/HacdsDeFi-0.1.0-x64.exe) | Portable, no install |
| [HacdsDeFi-0.1.0-arm64.apk](https://github.com/s6050105/HacdsDeFi/releases/latest/download/HacdsDeFi-0.1.0-arm64.apk) | Android (arm64-v8a, sideload) |

All releases: [Releases](https://github.com/s6050105/HacdsDeFi/releases).

## Documentation

- Whitepaper: [Whitepaper/HacdsDeFi-Whitepaper.en.pdf](Whitepaper/HacdsDeFi-Whitepaper.en.pdf) (also zh / tr)
- User guide: [Whitepaper/HacdsDeFi-User-Guide.en.pdf](Whitepaper/HacdsDeFi-User-Guide.en.pdf)
- RPC reference: [Whitepaper/HacdsDeFi-RPC-Doc.en.pdf](Whitepaper/HacdsDeFi-RPC-Doc.en.pdf)
- Architecture: [Whitepaper/hacds-架构图.pdf](Whitepaper/hacds-架构图.pdf)

> ⚠️ The earlier "HACD inscription" design is abandoned. It was listed on xeggex.com and nonkyc.io, then suspended. The current version is the rewritten contract design.

## Layout

| Path | Contents |
|---|---|
| `hacds_exchange/HacdsDeFi.fitsh` | Contract source (fitsh, deployed on HVM) |
| `hacds_exchange/HacdsDeFi.deploy.json` | Deployment action body (no keys) |
| `hacds_exchange/oracle/` | Scoring oracle (Python, stdlib only) |
| `hacds_exchange/indexer/` | Off-chain indexer (Python, stdlib only) |
| `DESIGN.md` | Contract design overview (English) |
| `hacds_exchange/DeFi设计文档-v1..v4.md` | Contract design iterations (Chinese) |
| `wallet-app/` | Wallet + DeFi console (Electron, desktop) |
| `android-app/` | **Wallet + DeFi console (Android, native Kotlin / Compose)** |
| `wallet-app/bin/hacds_txbuild.exe` | Bundled tx engine (Rust; build + local signing) |
| `wallet-app/vendor/hacash_sdk.{js,wasm}` | Official HACD transfer SDK (local signing) |
| `Whitepaper/` | Whitepaper / user guide / RPC reference (each zh + en + tr) + architecture |
| `tools/` | Helper scripts (key generation, redemption) |
| `SECURITY.md` / `SECURITY.zh.md` | Security model and known limitations |

## Components

**Contract** (`HacdsDeFi.fitsh`)
One contract carries four capabilities: AMM (constant product, 0.5% fee split three ways), LP staking, lending (50% collateral ratio, 5% APR, lazy interest), and treasury.
The admin can only call six numerically capped parameters and cannot touch user funds. The contract is not upgradeable and has no self-destruct.

**Oracle** (`hacds_exchange/oracle/hacds_oracle.py`)
Scores diamonds off-chain and signs the result, returning a 126-byte certificate (`GET /cert?name=X`). The contract recomputes the score on-chain and compares. The private key stays server-side.

**Indexer** (`hacds_exchange/indexer/hacds_indexer.py`)
The contract cannot enumerate borrowers, so the indexer scans the chain off-chain to build a ledger. The wallet sees exactly one endpoint: `GET /watchlist`.

**Wallet + DeFi console** (`wallet-app/`)
Electron. The cold side builds and signs offline; the hot side queries and broadcasts. The private key never touches the network.
Includes asset overview, protocol status, borrow-limit hints, live AMM quotes, HACD gallery, HACD peer-to-peer transfer, offline signing, atomic transactions, and a liquidation console. Localised into Chinese, English and Turkish.

**Android wallet + DeFi console** (`android-app/`)
Native Kotlin / Jetpack Compose, feature-parity with the desktop build. **Shares the exact same Rust
transaction engine as the desktop app** (called over JNI, byte-identical transactions); cold-side
offline build/sign with sharded QR codes, hot-side scan-and-broadcast. The wallet is protected by the
Android Keystore and is compatible with the desktop keystore format (interchangeable import/export).
Chinese/English/Turkish, HACD artwork (official HIP-5), full asset icon set.

> **HACD peer-to-peer transfer**: a first-class chain transfer (kind 6) — **does not go through the contract, needs no certificate, up to 200 diamonds per transaction**.
> Signing is done locally in the main process by the official `hacash_sdk.wasm`; only the `tx_body` is handed to the node for broadcast, so the private key never leaves the main process.
> Different from "deposit to swap": the latter is bound by the resource bucket cap of 6,100 — **one diamond per transaction**.

## Deployment

Server side

```bash
# Oracle (default port 8123)
python3 hacds_exchange/oracle/hacds_oracle.py serve --port 8123 --node http://<node>:8082

# Indexer (default port 8124)
python3 hacds_exchange/indexer/hacds_indexer.py --port 8124 --node http://<node>:8082
```

The systemd unit and details are in `hacds_exchange/indexer/部署说明-索引器.md` (Chinese).

Wallet

```bash
cd wallet-app
npm install
npm start        # run in development
npm run dist     # build into dist/
```

Android

```bash
cd android-app
# 1) Cross-compile the Rust engine (needs the NDK; outputs .so under jniLibs/)
./build-engine.sh both
# 2) Build the APK
export JAVA_HOME=<your JDK17>
./gradlew :app:assembleRelease            # arm64-v8a (release)
./gradlew -Pabi=x86_64 :app:assembleDebug # x86_64 (emulator)
```

> Before the first build, create `android-app/local.properties` pointing at your SDK:
> `sdk.dir=/path/to/Android/sdk`.
> The release signing keystore is not committed (see `android-app/README.md`).

## Security

- **The private key is never written to disk and never leaves the main process**: it is injected into the child process via an environment variable (`hacds_txbuild`) or handed straight to the WASM. It never touches the network.
- **Non-custodial**: hacds is a standard on-chain asset held in the user's own address.
- **Signing is local**: the node's `/util/transaction/sign` and `/create/coin/transfer` require sending your private key over HTTP. **This project does not use them.**
- The repository contains **no private keys and no wallet files**; `.gitignore` guards against it.

> ⚠️ **This project is live on mainnet and handles real funds. The contract has not been
> audited, and the admin is a single key that cannot be replaced.**
> Full security model and known limitations: **[SECURITY.md](SECURITY.md)**.

## License

MIT, see [LICENSE](LICENSE).
