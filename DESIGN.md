# HacdsDeFi — Design Overview

**English** | [简体中文](wallet-app/设计文档.md)

This is the contract design in English. The Chinese design documents are the fuller set and
remain authoritative for implementation details:

| Document | Contents |
|---|---|
| [`wallet-app/设计文档.md`](wallet-app/设计文档.md) | Full v0.2 design — §0 single source of truth, decisions D1–D63, verification records |
| [`wallet-app/Android设计文档.md`](wallet-app/Android设计文档.md) | Android client design |
| [`hacds_exchange/DeFi设计文档-v4.md`](hacds_exchange/DeFi设计文档-v4.md) | Contract design v4 (final) |
| [`hacds_exchange/DeFi设计文档-v1..v3.md`](hacds_exchange/) | Earlier iterations |

---

## 1. Asset and bookkeeping model

**hacds** is issued once as a standard on-chain asset — serial **2000**, `decimal = 8`,
ticker `HACDS`. It is *not* an inscription and is not attached to any diamond.

| Item | Value |
|---|---|
| serial | 2000 |
| decimal | 8 |
| total supply | `5963298700000000` atoms |
| issuer | the contract (`VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1`) |

**Supply derivation.** Every HACD is scored on the five HIP-5 dimensions. One point converts to
one hacds (`SCORE_SCALE = 1e8`, i.e. 1 point = 1e8 atoms). The total is the exact mean score
across all diamonds:

```
mean score × total HACD issued
= 3.55440306 × 16,777,216
= 59,632,987 hacds
= 5,963,298,700,000,000 atoms
```

Anyone can recompute this from the explorer API. That is the point — the supply does not depend
on anyone's decision.

### 1.1 Ledger keys

The contract keeps its books under prefixed keys:

| Key | Meaning | Unit |
|---|---|---|
| `bal:hac:<addr>` | HAC points deposited by a user | zhu |
| `due:<addr>` | hacds quota owed to a user (diamonds deposited, not yet claimed) | atoms |
| `loan:debt:<addr>` | outstanding debt | zhu |
| `loan:coll:<addr>` | collateral (a `due` quota reclassified as collateral) | atoms |
| `loan:last:<addr>` | last interest accrual height | — |
| `amm:hac` / `amm:ds` | AMM pool reserves | zhu / atoms |
| `lpt:<addr>` / `lpt:tot` | LP shares | unscaled |
| `tre:hac` / `tre:ds` | pending treasury settlement | zhu / atoms |
| `cfg:*` | admin-set configuration | — |

> Note there is **no `bal:ds`**. hacds a user holds is an on-chain asset balance; inside the
> contract the only hacds-side accounting is the `due` quota. Depositing a diamond reclassifies
> quota; it does not move the asset.

---

## 2. Scoring (Diamond_Analyzer v0.1.1)

Five dimensions, mirroring the HIP-5 classification: **shape, style, colour, nameliteral,
numberliteral**. The score is a pure function of `name + number + visual_gene`.

Scoring runs **off-chain** in the oracle, which signs the result. The contract recomputes the
score on-chain from the certificate and compares before accepting anything. Off-chain saves gas;
on-chain keeps it correct. Both sides use the same algorithm, so the results must agree — we
verified this on 610 real diamonds against the contract's own scoring engine, and 152 against
the oracle.

---

## 3. Execution model (verified against fullnode source)

### 3.1 Transfer actions

HACD and HAC transfers use the standard actions (`TransferHacdTo`, `TransferHacdFromTo`,
`TransferHacTo`, …). The contract only gets involved when **one side of the transfer is a
contract address**:

```rust
// base/src/iface/action.rs
let authorize = from.is_scriptmh() || from.is_contract();
let receive   = to.is_contract();
if !authorize && !receive { return Ok(None); }   // plain → plain: no hook at all
```

This is why a **peer-to-peer HACD transfer never touches the contract and needs no
certificate**, while depositing into or redeeming from the contract does.

### 3.2 Hooks

| Direction | Hook | Triggered by |
|---|---|---|
| asset/HAC/HACD arriving at the contract | `Payable*` | deposit |
| asset/HAC/HACD leaving the contract | `Permit*` | redemption / claim |

Hooks are called with `(counterparty, …)` and the payload. A non-zero hook return aborts the
whole transaction (the action is atomic).

### 3.3 Certificate transport

The 126-byte oracle certificate (29-byte message + 97-byte signature) is carried in a
`Message` action when it fits in 255 bytes, otherwise a `Blob`. One certificate per diamond.

### 3.4 Gas: three independent buckets

Hacash VM gas is divided into three buckets, each with its own consensus cap, **unrelated to the
transaction's total budget `gas_max`**:

| Bucket | Cap |
|---|---|
| compute | 18,009 |
| resource | 6,100 |
| storage | 111,911 |

All actions and hooks in one transaction **share** these budgets. That is why **a deposit can
carry at most one diamond**: the on-chain score recomputation in `verify_cert` costs roughly
3,000 resource, and two diamonds come to 6,101 — just over 6,100. Raising `gas_max` or the fee
does nothing; the transaction has to be split.

---

## 4. Storage

Storage is rented, not permanent. New keys cost `1024 (key cost) + 36 × period` each. The
worst case in this contract is a cold-pool first `add_liquidity`, which creates eight keys at
once — that is what sets the practical period ceiling (`RENT_PERIOD = 300`). Longer-lived keys
are refreshed in batches by the admin via `rent_batch`.

---

## 5. Deposit and redemption (HACD ⇄ hacds)

### 5.1 Deposit (HACD → hacds quota)

```
action 1  TransferHacdTo(contract, [names])      → PayableHACD
action 2  Message/Blob(certificate stream)
```

`PayableHACD` verifies each certificate, recomputes each diamond's score on-chain, and credits
`due:<user> += Σ score × 1e8`.

**Limit: one diamond per transaction** (see §3.4).

### 5.2 Redemption (quota → HACD)

```
action 1  TransferHacdFromTo(contract, user, [names])   → PermitHACD
action 2  Message/Blob(certificate stream)
```

`PermitHACD` spends the `due` quota. If the quota is short, the contract **tops it up
automatically through the AMM** using the user's HAC points.

---

## 6. HAC deposit and points

Depositing HAC credits `bal:hac` points, which the AMM and lending modules use as their unit of
account. Withdrawing converts points back to on-chain HAC.

---

## 7. AMM

Constant product `x × y = k`, with the fee charged on the input leg.

```
HAC → hacds :  net_in = in × (1 − fee);  out = pool_ds × net_in / (pool_hac + net_in)
hacds → HAC :  net_in = in × (1 − fee);  out = pool_hac × net_in / (pool_ds + net_in)
```

Default fee 0.5%, split three ways: **LP 50% / staking pool 30% / treasury 20%**.

**LP shares.** First deposit: `share = isqrt(hac_amt × ds_amt)`. Subsequent deposits:
`share = min(lpttot × hac_amt / pool_hac, lpttot × ds_amt / pool_ds)`.

> ⚠ The `min` matters. If the two legs are not in the pool's ratio, the **excess side earns no
> shares — it is donated to the pool**. The wallet enforces this by auto-computing the second
> leg and warning when the ratio is off.

**LP rewards** accrue via an `rpu` (reward-per-unit) checkpoint and settle lazily.

---

## 8. Staking and treasury

LP shares can be staked to earn the staking share of fees. Settlement is lazy — unclaimed
rewards are never lost. The treasury accumulates its share and is swept periodically by
converting to a plain transfer to the treasury address (the contract deducts `tre:` automatically
when it sees the treasury as the recipient).

---

## 9. Lending

Collateral is a **`due` quota**, not diamonds themselves — a user does not have to lock up
diamonds in order to borrow.

Collateral is valued at the **live AMM pool price**, so no external price feed is needed:

```
coll_to_hac(coll) = coll × amm:hac / amm:ds        // hacds collateral → HAC value (zhu)
```

### 9.1 Borrow

```
action 1  MainCall(loan_borrow, hac_amt)              → credits debt, credits bal:hac
action 2  TransferHacFromTo(contract, user, hac_amt)  → moves real HAC out
```

Release condition: `(debt + hac_amt) × COLL_RATIO(2) ≤ coll_hac`, otherwise `return 40`.

| Quantity | Formula |
|---|---|
| max borrow | `coll_hac / 2 − debt` |
| collateral needed | `(debt + borrow) × 2 × amm:ds / amm:hac` |

`COLL_RATIO = 2` is a **contract constant**, not a parameter — the admin cannot change it.
This is the same constraint as "50% collateral ratio".

### 9.2 Interest

Lazy accrual: `debt × (1 + rate × Δblocks / 105120)`, where `BLOCKS_PER_YEAR = 105120` and the
default annual rate is 5%. There is no scheduled job and no keeper. Interest is charged through
the fee pipeline (staking 80% / treasury 20%).

### 9.3 Repayment and liquidation

Repayment spends HAC points and releases collateral back to `due`. Liquidation is open to
anyone: it requires `debt > coll_hac / COLL_RATIO` (i.e. **collateral ratio below 200**), pays
the liquidator a bonus (`cfg:liq_bonus`, default 2%), and clears both debt and collateral.

> **200 is the liquidation line, not the collateral ratio.** A 50% collateral ratio means
> "max borrow = half the collateral value"; "ratio below 200" means "debt exceeds half the
> collateral value". Same constraint, two ways of saying it.

---

## 10. Administration and safety

The admin can call exactly six functions:

| Function | Cap |
|---|---|
| `set_fee` | ≤ 300 bps |
| `set_loan_rate` | ≤ 2000 bps |
| `set_liquidate_bonus` | ≤ 1000 bps |
| `set_paused` | 0 / 1 |
| `set_oracle` | any address |
| `rent_batch` | key list + period |

**The admin cannot touch user funds.** There is no withdrawal, no balance change, no collateral
change and no debt change among them — only parameters, all numerically capped.

The admin is fixed at deployment by `init_admin` and **cannot be replaced** (there is no
`set_admin`). The contract has no self-destruct and no upgrade path.

The contract exposes no read access to `cfg:*`, so a UI cannot display the current fee or rate.
This is deliberate: upgrading a live contract just to echo values is not worth it.

---

## 11. Risks and limits

| Limit | Why |
|---|---|
| One diamond per deposit transaction | resource bucket = 6,100, ~3,000 per diamond |
| Oracle is a single point | it decides swap availability, though not asset values (the contract recomputes) |
| Admin can pause the contract | affects availability, never custody |
| Interest is not shown separately | lazy accrual; the accrual start height is not exposed |
| `cfg:*` cannot be read | no read endpoint; adding one would need a contract upgrade |

**Not upgradeable by design.** Changing any of the above means redeploying the contract and
reissuing the asset — which is exactly why the design was made conservative in the first place.

---

## 12. Addresses

| Item | Value |
|---|---|
| Contract | `VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1` |
| Treasury | `1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK` (hard-coded, not changeable) |
| Oracle account | `1H3sFZ53HzNVUVN97mjpC9JT8s2PqKMyRu` |
| Deployer / admin | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
