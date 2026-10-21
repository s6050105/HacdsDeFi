# Security

**English** | [简体中文](SECURITY.zh.md)

This project is **live on Hacash mainnet and handles real funds**. Please read this before using it.

We describe the security model honestly, including what is **not** protected.

---

## 1. Reporting a vulnerability

If you find a vulnerability, **please do not open a public issue**.

Open a [private security advisory](https://github.com/s6050105/HacdsDeFi/security/advisories/new)
instead, and include:

- what you found and its impact
- steps to reproduce, or a proof of concept
- affected component (contract / oracle / indexer / wallet) and, if on-chain, the transaction

We will acknowledge as soon as we can. There is no bug bounty at this time.

**Never send a private key, mnemonic or wallet file.** No one on this project will ever ask for one.

---

## 2. What is protected

### 2.1 The private key never leaves the main process

| Path | How the key is used |
|---|---|
| `hacds_txbuild` (Rust engine) | injected into the child process via the `HACDS_SIGN_KEY_HEX` environment variable |
| `hacash_sdk.wasm` (HACD transfer) | passed directly to the WASM call in-process |

The key is never written to disk, never sent to the renderer, and never put on the network.
It exists in main-process memory only, and is cleared on lock.

### 2.2 Signing is local — always

All transaction construction and signing happen on the user's machine.

> **The node's `/util/transaction/sign` and `/create/coin/transfer` require sending the private
> key over HTTP. This project does not use them.** If you see them being used anywhere in this
> codebase, treat it as a bug.

### 2.3 Renderer isolation

```js
webPreferences: {
  preload: '...preload.js',
  contextIsolation: true,
  nodeIntegration: false,
}
```

The renderer can only reach the main process through the allowlist in `preload.js`. It has no
filesystem, no Node, and no direct network access.

### 2.4 Wallet file encryption

```
KDF:      scrypt  N=2^15, r=8, p=1, dklen=32
Cipher:   AES-256-GCM
AAD:      "hacds-keystore-v1"   (binds the format version)
```

Zero third-party dependencies — Node's built-in `crypto` only.

### 2.5 The oracle is not blindly trusted

The oracle signs a certificate, but that certificate is only a transport credential. The
contract **recomputes the diamond score on-chain** with its own engine and compares before
accepting anything. **A fully compromised oracle still cannot forge a score.**

The oracle private key stays server-side; clients only ever receive certificates.

### 2.6 Asset conservation is verifiable

```
user holdings + contract holdings = total supply
```

All three figures are readable from the node at any time, so anyone can check.

### 2.7 Repository hygiene

- No private keys, mnemonics or wallet files are in this repository (CI enforces this on every push).
- `.gitignore` blocks `*.key`, `*.pem`, `*.keystore`, `wallet-*.json`, `hacash_keys/`, `.env*`.
- GitHub secret scanning and push protection are enabled on this repository.

---

## 3. Known limitations — read these

These are deliberate trade-offs, documented rather than hidden. **They are real risk.**

### 3.1 ⚠ The contract has not been audited

**There is no third-party security audit.** The code has been exercised in practice and
verified against on-chain behaviour case by case, but that is not a substitute for an audit.

**Treat this as experimental software. Do not put in more than you can afford to lose.**

### 3.2 ⚠ The admin is a single key, and cannot be replaced

- The admin is fixed at deployment by `init_admin`. **There is no `set_admin`** — the address
  can never be changed.
- The admin can **pause the contract** (`set_paused`), which halts new operations.
- **If the deployment key is lost or leaked, it is final.** There is no recovery and no rotation.

The admin **cannot touch user funds** — there is no withdrawal, no balance change, no collateral
change and no debt change among the six admin functions. But availability is in the admin's hands.

### 3.3 ⚠ The oracle is a single point

One oracle instance, one fixed address in the contract. It cannot affect asset *values* (the
contract recomputes), but it decides whether swapping works at all. **If it goes down, swapping stops.**

### 3.4 ⚠ The contract is not upgradeable

There is no upgrade function and no self-destruct. This is intentional — it removes a whole class
of rug-pull risk — but it also means **a discovered bug cannot be patched**. Fixing anything
requires redeploying the contract and reissuing the asset.

### 3.5 ⚠ Configuration cannot be read back

The contract exposes no read access to `cfg:*` keys (fee, rate, liquidation bonus, paused state).
**A UI cannot display the current values.** Adding an endpoint would require a contract upgrade.

### 3.6 ⚠ Two things the node could do for you, that we refuse to use

`/util/transaction/sign` and `/create/coin/transfer` both take a private key over HTTP. They are
convenient and they would have made HACD transfers much simpler to implement — **we deliberately
did not use them**, because it means handing your key to a server, over plaintext HTTP, into its
access logs.

### 3.7 Wallet-level

- The passphrase protects the wallet file, **but a weak passphrase is a weak wallet**. scrypt
  makes brute force expensive, not impossible.
- Locking clears the key from memory; the wallet does **not** auto-lock on idle.
- On-chain transactions are irreversible. Always use the **Translate** button before broadcasting.

---

## 4. On-chain facts worth knowing

| Fact | Implication |
|---|---|
| Depositing a diamond is limited to **1 per transaction** (resource bucket 6,100, ~3,000 each) | larger deposits must be split; the UI does this automatically |
| A HACD **peer-to-peer transfer** has no such limit (up to 200 per transaction) | it does not touch the contract |
| `COLL_RATIO = 2` is a **contract constant** | the admin cannot lower the collateral ratio |
| Block target is **300 s** | a successful broadcast is not confirmation; wait for a block |
| Sandbox calls are capped at **2 concurrent per IP** | clients must serialize |

---

## 5. Supported versions

Only the latest release is supported with security fixes.

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

---

## 6. What we will never do

- Ask for your private key, mnemonic or password — in any channel, for any reason
- Ship a build that sends your key off your machine
- Silently change the contract's economic parameters (the caps are enforced in code)
