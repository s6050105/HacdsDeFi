# HacdsDeFi RPC Documentation

2026-11-18　Contract #4000　For developers

> This document describes the Hacash mainnet contract `HacdsDeFi3000.fitsh`
> (address `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`, hacds asset serial 4000, decimal 0;
> share asset serial 4001, issuer is the deployer address).
>
> **This document contains no #2000-era interfaces.** The oracle, scoring certificates,
> and admin functions **no longer exist** in the new contract — not because permissions
> were revoked, but because those functions were never written into it.

---

## 0. Services at a Glance

hacds involves four HTTP services. The first two read the chain; the other two
are conveniences.

| Service | Address | Protocol | Purpose |
|---|---|---|---|
| Full node RPC | `node.hacds.com` | HTTP/JSON | Query chain data, sandbox read-only calls, verify/broadcast transactions |
| API proxy | `api.hacds.com` | HTTP/JSON | Forwards to the full node, adds CORS + HTTPS |
| Indexer | `indexer.hacds.com` | HTTP/JSON | Borrower ledger (who is liquidatable) |
| Transaction build service | `build.hacds.com` | HTTP/JSON | Turns human input into an unsigned transaction |

```
                  ┌───────────────┐
 client ──GET──► │ Full node RPC │◄── indexer (scans chain, builds ledger)
    │             └───────────────┘
    │                     ▲
    └──POST──► build svc ─┘   (builds only, never signs)
```

**Why an API proxy is needed**: the full node does not return CORS headers, so a
browser calling it directly is blocked. `api.hacds.com` is a Cloudflare Worker that
only forwards and adds headers; it does not change semantics. The server-side ports
are not 80/443, so Cloudflare reaches the origin through a Tunnel.

**Response convention**: every endpoint returns JSON with a top-level `ret` field.
`ret: 0` means success; non-zero means failure (failures usually carry an `err`).

> ⚠ **Failures also return HTTP 200.** You must check `ret` in the body, not just the
> status code.

**Why node addresses are subdomains rather than `IP:port`**: Cloudflare Workers can
only reach ports 80 and 443. Any `IP:8082` style address is rejected before a
connection is established (`error code: 1003`). Everything external therefore goes
through `*.hacds.com` subdomains plus a Tunnel.

---

## 1. Full Node API

### 1.1 Query block height

```
GET /query/block/height/latest
```

```json
{"ret":0,"height":798812}
```

VM status (whether it is enabled, current height):

```
GET /api/vm/status
```

```json
{"ret":0,"vm":"enabled","height":798812}
```

---

### 1.2 Query average fee rate

Used to estimate the transaction fee.

```
GET /query/fee/average
```

```json
{"ret":0,"purity":"6024000000","purity_unit":232}
```

`purity` = `fee / billing_size (bytes)`; the node admission requirement is
`purity ≥ min_purity`.

---

### 1.3 Query balance (HAC / diamonds / assets)

```
GET /query/balance?address={address}&assets=true&asset_meta=true&diamonds=true
```

All three switches are optional:

| Parameter | Effect |
|---|---|
| `assets=true` | Include the asset list (hacds is here) |
| `asset_meta=true` | Include asset name / supply and other metadata |
| `diamonds=true` | Include the HACD diamond list |

```json
{
  "ret": 0,
  "list": [{
    "address": "1P2tsn...",
    "hacash": "1234567:248",
    "diamond": 3,
    "assets": [{"serial": 4000, "amount": "100000000"}]
  }]
}
```

**Amounts are in `<value>:<unit>` form**: `5:249` means 50 HAC (5 × 10^(249−248)),
not 5.0038. The conversion formula is in §8.3.

---

### 1.4 Query diamond details

```
GET /query/diamond?name={6-character diamond name}
```

Returns the diamond's number, visual gene, owning address, and so on. Both the
`number` and the `visual_gene` needed for scoring are here.

---

### 1.5 Sandbox read-only call (**the primary way to read contract state**)

```
GET /query/contract/sandboxcall?contract={contract}&function={function}&params={params}&caller={caller}
```

Executes read-only: it does not write chain state, does not send a transaction, and
costs no fee.

**Measured response**:

```json
{"ret":0,"use_gas":377,"gas_use":{"compute":132,"resource":209,"storage":36},"ret_val":120200677111}
```

| Field | Meaning |
|---|---|
| `ret` | 0 = call succeeded |
| `ret_val` | Function return value |
| `use_gas` / `gas_use` | Consumption for this call, used for estimation |

> ⚠ **If the address is wrong, this returns `NotFindContract`.** The contract was
> deployed to mainnet on 2026-11-18 (second round); the currently valid address is in
> §8.2. The old address `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH` is the deprecated
> first-round deployment; calling it reports this error.

#### 1.5.1 Two pitfalls you must know

**Pitfall 1: omitting `caller` causes failure.**

```json
{"ret":1,"err":"[revert] address \"1111...\" balance 0:0 is insufficient, at least 559555:242"}
```

The default caller has a balance of 0 and cannot cover the prepaid gas. **Pass
`caller={contract address}` and it works** — a contract calling itself needs no
balance.

**Pitfall 2: the per-IP concurrency limit is 2.** Excess requests are **rejected
outright**, not queued:

```json
{"ret":1,"err":"sandbox_per_ip_concurrency_exceeded"}
```

Clients must **serialize plus retry with backoff**. Do not fire a dozen at once with
`Promise.all`.

#### 1.5.2 Parameter format

`params` is `value:type` separated by commas. The `:` must be URL-encoded as `%3A`.

| Type | Example |
|---|---|
| `u128` | `100000000:u128` |
| `address` | `1P2tsn...:address` |
| `bytes` | `WTYUIA:bytes` |

#### 1.5.3 Complete list of read-only functions

**AMM and liquidity**

| Function | Parameters | Returns | Description |
|---|---|---|---|
| `amm_reserves` | — | u128 | HAC in the pool (**zhu**) |
| `amm_reserve_ds` | — | u128 | hacds in the pool (**count**) |
| `pool_price` | — | u128 | Pool price = `amm:hac × 1e8 / amm:ds` |
| `lp_total` | — | u128 | Total LP shares |
| `lp_share_of` | `who:address` | u128 | LP shares of an address |
| `lp_pending_hac` | `who:address` | u128 | Pending LP reward (HAC, zhu) |
| `lp_pending_ds` | `who:address` | u128 | Pending LP reward (hacds, count) |
| `total_staked` | `kind:u128` | u128 | kind `0`=HAC, `1`=hacds |

**Lending**

| Function | Parameters | Returns | Description |
|---|---|---|---|
| `loan_debt_of` | `who:address` | u128 | Principal (zhu), **excluding** unsettled interest |
| `loan_debt_now` | `who:address` | u128 | Real-time debt including interest (zhu) |
| `loan_coll_of` | `who:address` | u128 | Locked collateral (hacds count) |
| `loan_health` | `who:address` | u128 | **Health in basis points of 10000**, see below |
| `loan_status` | `who:address` | u128 | Collateral ratio ×100, see below |
| `total_debt` | — | u128 | Global debt (zhu) |
| `providers_total` | — | u128 | All lendable funds |
| `utilization` | — | u128 | Current utilization (bps) |
| `borrow_coll_ratio` | — | u128 | Borrow line percentage (`200`) |
| `liq_coll_ratio` | — | u128 | Liquidation line percentage (`160`) |
| `borrow_paused` | — | u128 | Non-zero = new borrowing paused (utilization or circuit breaker) |
| `ref_paused` | — | u128 | Non-zero = price-deviation circuit breaker active |
| `lendable_amm` | — | u128 | Lendable portion of the AMM (30%) |
| `net_claims` | — | u128 | Network-wide claims |
| `reserve_hac` | — | u128 | Bad-debt reserve |
| `deficit_hac` | — | u128 | Deficit |

**How to read health correctly**

| `loan_health` return | Meaning |
|---|---|
| `1000000` | No debt (sentinel value returned by the contract, treat as extremely healthy) |
| `> 10000` | Safe |
| `= 10000` | Exactly on the liquidation line |
| `< 10000` | **Liquidatable** |
| `< 9000` | Deep water; can be liquidated in full |

**Key point**: this value is computed with `coll_to_hac_liq()`, i.e. the **conservative
price `min(spot price, smoothed reference price)`**, and it is **from the same source**
as the decision in `loan_liquidate`. So the situation "the UI says safe while the chain
says liquidatable" cannot occur. Do not compute health yourself from `loan_status`;
use this.

`loan_status` is the legacy measure (`coll_hac × 100 / debt`, using the spot price),
kept for compatibility:

| Return | Meaning |
|---|---|
| `0` | No loan, no collateral |
| `999` | Has collateral but no debt |
| Anything else | Collateral ratio ×100 |

**HACD pool**

| Function | Parameters | Returns | Description |
|---|---|---|---|
| `hacd_score_total` | — | u128 | Total HACD score in the pool (already ×`SCORE_SCALE`) |
| `hacd_count` | — | u128 | Number of HACDs in the pool |
| `hacd_avg_score` | — | u128 | Average score (already ×`SCORE_SCALE`) |
| `hacd_coverage` | — | u128 | Coverage ratio (bps, 10000 = 100%) |
| `quote_redeem` | `sc:u128` | tuple | Redemption quote, see below |
| `quote_score` | `name:bytes,vg:bytes,num:u128` | u128 | Compute score from name + gene + number |

**`quote_redeem` return value**: `tuple(charge, fee, premium_bps, ok)`

| Element | Meaning |
|---|---|
| `charge` | Total deduction (principal + fee) |
| `fee` | The fee portion |
| `premium_bps` | Diamond-selection premium (bps) |
| `ok` | `1` = redeemable; `0` = the actual transaction would return `61` (no record in the pool or insufficient score) |

**Prices and factors**

| Function | Parameters | Returns | Description |
|---|---|---|---|
| `ref_price_of` | — | u128 | Smoothed reference price |
| `ref_price_zhu_per_ds` | — | u128 | Reference price (zhu per hacds) |
| `ref_height` | — | u128 | Block height of the last reference-price update |
| `hcut` | — | u128 | HAC socialization factor (1e12 scale, only decreases) |
| `lcut` | — | u128 | LP reward socialization factor |

**Account and vault**

| Function | Parameters | Returns | Description |
|---|---|---|---|
| `balance_hac` | `who:address` | u128 | Effective HAC balance (zhu, already multiplied by hcut) |
| `balance_hac_nominal` | `who:address` | u128 | Nominal shares (zhu) |
| `balance_ds` | `who:address` | u128 | hacds quota due for the address |
| `bad_of` | `who:address` | u128 | Bad debt of that address |
| `treasury_pending` | `kind:u128` | u128 | Vault pending sweep. `0`=HAC, `1`=hacds |
| `treasury_ds` | — | u128 | Accumulated hacds in the vault |
| `tot_hac` | — | u128 | Total HAC (effective value) |
| `tot_hac_nominal` | — | u128 | Total HAC (nominal shares) |
| `lpr_hac_effective` | — | u128 | Effective value of the LP reward pool |

**Operations**

| Function | Parameters | Returns | Description |
|---|---|---|---|
| `self_check` | — | u128 | Internal consistency self-check, `0` = pass |
| `rent_key_group_count` | — | u128 | Number of key groups (fixed at `7`) |
| `rent_key_len_at` | `idx:u128` | u128 | Key length of group idx |
| `rent_keys_group` | `klen:u128` | bytes | All keys of that length group (can be fed directly to `rent_keys`) |

#### 1.5.4 Measured sample

```
GET {node}/query/contract/sandboxcall?contract=bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h
    &function=loan_health&params=1P2tsn...%3Aaddress&caller=bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h
→ {"ret":0,"use_gas":830,"gas_use":{"compute":363,"resource":323,"storage":144},"ret_val":1000000}
```

`ret_val: 1000000` = that address has no debt.

---

### 1.6 Query block summary

The indexer uses this to walk blocks and find borrowers.

```
GET /query/block/intro?height={height}&tx_hash_list=true
```

---

### 1.7 Query transaction

```
GET /query/transaction?hash={transaction hash}
```

---

### 1.8 Verify transaction (with human-readable description)

```
POST /util/transaction/check
Content-Type: application/json

{"tx": "040000...(hex)"}
```

On success it returns the parse result plus a readable action description, for example:

```json
{"ret":0,"describe":"[CallContract] bw2sRC... -> swap_hac_to_ds(...)"}
```

**This endpoint does not sign and does not broadcast; it only verifies.** Wallets use
it as the last checkpoint before broadcasting.

---

### 1.9 Broadcast transaction

```
POST /submit/transaction
Content-Type: application/json

{"tx": "040000...(hex)"}
```

```json
{"ret":0}
```

> ⚠ `ret: 0` **only means it entered the mempool**; it does not mean it is on chain.
> The block target is 300 seconds, so re-query `/query/transaction` on the block
> cadence.

---

### 1.10 Contract storage fee parameters

```
GET /query/contract/storage_cost?contract={contract}
```

Used to estimate the cost of rent renewal.

---

## 2. Indexer API

The indexer scans the chain and maintains the ledger of "who has debt, who is
liquidatable". **Wallets do not scan the chain locally.**

### 2.1 Health check

```
GET /health
```

```json
{"ok": true, "service": "hacds-indexer", "head": 798812, "watched": 0}
```

### 2.2 Ledger snapshot (**the only endpoint a client needs**)

```
GET /snapshot
```

Returns health snapshots for all watched addresses:

```json
{
  "head": 798812,
  "updated": 1762900000,
  "items": [
    {"addr": "1P2tsn...", "debt": "100000000", "coll": "300000000",
     "health": 16000, "ratio": 160, "liq": true}
  ]
}
```

| Field | Description |
|---|---|
| `debt` | `loan_debt_now` (including interest) |
| `coll` | Collateral hacds count |
| `health` | Basis points of 10000, same measure as `loan_health` |
| `ratio` | Collateral ratio percentage |
| `liq` | `true` = currently liquidatable |

### 2.3 Snapshot only (does not trigger a sync)

```
GET /snapshot?cached=1
```

### 2.4 Sync immediately

```
POST /sync
```

Forces a scan up to the latest block. For operations use; normally you do not need it.

### 2.5 Watchlist maintenance

```
POST /watch/add?addr={address}
POST /watch/remove?addr={address}
```

The indexer discovers borrowers automatically; these two endpoints are for filling
gaps by hand.

### 2.6 Asset backing coverage monitoring

```
GET /backing
```

Compares "the total due recorded by the contract" against "the hacds actually issued
on chain", to detect anomalies.

### 2.7 Rent batches

```
GET /rent_batches
```

Returns key batches grouped by length that can be fed directly to `rent_keys`. Keepers
use this for rent renewal.

### 2.8 Deployment

```bash
python3 hacds_indexer.py --node http://127.0.0.1:8082 \
    --contract bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h --port 8124
```

---

## 3. Transaction Build Service

This service translates "human-readable parameters" into "an unsigned transaction".
**It holds no private keys whatsoever; the transaction it builds must be signed by the
client itself.**

Source: `hacds_exchange/indexer/hacds_build_server.py`

### 3.0 Why it is needed

Constructing a Hacash transaction requires exact fee / gas / action encoding, plus
handling of the wire format of diamond name lists. Making every client implement this
itself is a guarantee of "three implementations that behave differently". Concentrate
the construction logic in one service and let clients only sign — **what gets signed
changed, but who signs did not.**

### 3.1 Health check

```
GET /health
```

```json
{"ok": true, "service": "hacds-build", "version": "2026-11-18.1",
 "txbuild_ok": true, "contract": "bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h"}
```

`version` matters: Python does not hot-reload, so a changed script requires restarting
the process. If observed behavior does not match `version`, first confirm the process
was actually restarted.

### 3.2 Build a contract call

```
POST /api/build
Content-Type: application/json

{
  "mode": "call",
  "main": "1P2tsn...",
  "fn": "swap_hac_to_ds",
  "params": "100000000:u128,0:u128,0:u128",
  "fee": "0:248",
  "gasMax": 99
}
```

| Field | Required | Description |
|---|---|---|
| `mode` | No | `call` (default) or `transfer` |
| `main` | ✅ | Originating address (the one that pays the fee) |
| `fn` | ✅ | Contract function name; whitelist in §3.4 |
| `params` | No | `value:type` separated by commas, default `-` |
| `fee` | No | Of the form `0:248` |
| `gasMax` | No | Integer `1–99`, default `99` |

Response:

```json
{"ok": true, "unsigned_tx": "040000...", "fn": "swap_hac_to_ds",
 "fee": "0:248", "gas_max": 99}
```

### 3.3 Build a transfer

```
POST /api/build
{
  "mode": "transfer",
  "main": "1P2tsn...",
  "sub": "hacd-from-to",
  "fee": "0:248"
}
```

`sub` is a subcommand of `hacds_txbuild transfer`; extra parameters are given per
subcommand. **`from` is locked to the contract address** — this is a safety constraint
that prevents anyone from using this service to construct a "transfer out of an
arbitrary address" transaction.

### 3.4 Function whitelist

```
swap_hac_to_ds · swap_ds_to_hac
add_liquidity · remove_liquidity · lp_harvest
loan_add_collateral · loan_borrow · loan_repay · loan_liquidate
rent_keys · topup_keys
```

Functions not on the whitelist are rejected. **This is a whitelist, not a blacklist** —
new functions must be added explicitly.

### 3.5 Limits

| Limit | Value | Why |
|---|---|---|
| Requests per IP per minute | 30 | Abuse prevention |
| Request body | 8 KB | Parameter string cap 1024 bytes, at most 16 items |
| Diamond name list | At most 200 | Corresponds to `MAX_DEPOSIT_COUNT` |
| `gasMax` | 1–99 | Legal range for the contract/engine |

### 3.6 Error codes

| `error` | Meaning |
|---|---|
| `bad_json` | Request body is not valid JSON |
| `bad_length` | Request body is empty or exceeds 8 KB |
| `bad_main` | `main` is not a valid address |
| `bad_fee` | `fee` is not in `value:mantissa` form |
| `bad_gasMax` | `gasMax` is not an integer in 1–99 |
| `fn_not_allowed` | Function is not on the whitelist |
| `bad_params` | Parameter string is malformed |
| `rate_limited` | More than 30 requests per minute |
| `build_timeout` | Engine timeout (30 seconds) |
| `engine_missing` | `hacds_txbuild` not found on the server |

---

## 4. Contract B (Vault Dividends)

Contract B is a separately deployed **pure dividend pool**, at address
`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (nonce 4).

It has **no admin, no pause, no parameter-modification interface**; all parameters are
compile-time constants.

You read it the same way as contract A, just replacing the `contract` parameter with
B's address:

```
GET /query/contract/sandboxcall?contract=duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4&function=<fn>
```

### 4.1 ⚠ First, understand one thing: holding ≠ dividends

User A transfers 4001 to user B; this action **does not go through contract B at all**
(the hook only fires when the contract is the `from` or the `to`).

So the contract cannot perceive "the instant of a sale", and therefore cannot settle at
that moment. Its solution is: **only shares staked into contract B accrue interest.**

| Location | Participates in dividends |
|---|---|
| 4001 in a user's wallet | ❌ Does not participate |
| Shares staked into B (`sh:<address>`) | ✅ Participates |

Inside the contract, `sh:<addr>` is the **sole authoritative** dividend-share ledger.

### 4.2 Read-only views

| Function | Parameters | Returns | Description |
|---|---|---|---|
| `share_serial()` | — | u128 | Should always be **4001**. Used to confirm contract identity |
| `share_total()` | — | u128 | Share issuance cap (10000); metadata only |
| `get_shares(who)` | `address` | u128 | **Staked shares** (the sole basis for dividends) |
| `get_due(who)` | `address` | u128 | **Settled, ready to withdraw** (HAC, zhu) |
| `get_claimable(who)` | `address` | u128 | **Total claimable** = due + unsettled increment |
| `get_checkpoint(who)` | `address` | u128 | That address's checkpoint (×1e12) |
| `get_current_rpu()` | — | u128 | Global accumulator (×1e12) |
| `get_total_dividend()` | — | u128 | Cumulative total dividends (zhu) |
| `get_reserve()` | — | u128 | Rent-renewal reserve (zhu) |
| `rent_ratio_bps()` | — | u128 | Rent retention ratio (2000 = 20%) |
| `rpu_scale()` | — | u128 | Fixed-point scale factor (1e12) |
| `ahac_group_count()` | — | u128 | Passes through A's key group count (currently 7) |

**⚠ The semantic trap in `get_claimable`:**

```
get_claimable(who) = due(who) + unsettled increment
```

`claim()` settles the increment into `due` and advances the checkpoint, so **the value
of `get_claimable` does not change after a claim**.

The UI must display it as "ready to withdraw", not "claimable"; otherwise the user
clicks claim, sees the number unchanged, and concludes the feature is broken.

**The correct three-way split:**

| Field | Meaning |
|---|---|
| `get_due` | Settled, only withdrawal remains |
| `get_claimable − get_due` | Increment not yet settled |
| `get_claimable` | The sum of both |

### 4.3 Write operations

| Operation | Actual on-chain action | Description |
|---|---|---|
| **Stake** | `TransferAssetFromTo(self → B, 4001, N)` | Triggers `PayableAsset`; `sh:<self>` increases |
| **Unstake** | `TransferAssetFromTo(B → self, 4001, N)` | Triggers `PermitAsset`; **settles first, then reduces shares** |
| **Claim dividends** | `ContractMainCall(B, 'claim')` | Settles the increment into `due`; **the money stays in the contract** |
| **Withdraw** | `TransferHacFromTo(B → self, X)` | Triggers `PermitHAC`; the money actually arrives |

**Claiming and withdrawing are two steps, and both must be done.** With only a claim,
the wallet balance does not change.

It is recommended to combine the two steps with a `combo` atomic transaction (see
Chapter 5):

```json
{
  "contract": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
  "actions": [
    { "type": "call", "contract": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
      "fn": "claim", "params": "-" },
    { "type": "hac-from-to", "from": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
      "to": "<your address>", "hac": "23.52940000" }
  ]
}
```

⚠ **The order cannot be reversed.** Withdrawing before claiming can only take out the
old `due`; the new dividends stay in the contract (they are not lost, but the user
experience is poor).

### 4.4 Rent-renewal infrastructure

Contract B needs its storage keys renewed periodically, otherwise the ledger gets
deleted. It provides four **permissionless** entry points that anyone can call and be
paid for:

| Function | What it renews | Reward source |
|---|---|---|
| `claim()` | Only the caller's **own** 3 keys | None (you pay gas for yourself) |
| `pay_rent(period)` | B's own 3 global keys | `reserve:rent` |
| `pay_rent_ahac(group, period)` | One group of keys of **contract A** | `reserve:rent` |
| `pay_rent_shares(addrs, period)` | **Shareholders'** address keys | `reserve:rent` |

**`pay_rent_shares` was added on 2026-11-18.** Parameter description:

| Parameter | Type | Description |
|---|---|---|
| `addrs` | `bytes` | **Packed 21-byte addresses** (not readable strings), `size % 21 == 0` |
| `period` | `u128` | Target rent period, range `[30, 3000]` |

Return values:

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Empty parameter |
| 3 | Length not divisible by 21 |
| 60 | Too many addresses (per-call capacity varies with period) |
| 62 | Period too small |
| 63 | Period too large |

**How many addresses fit in one call depends on period:**

| period | Gas per address | Per-call cap |
|---|---|---|
| 30 | 3,240 | 34 addresses |
| 100 | 10,800 | 10 addresses |
| 300 | 32,400 | 3 addresses |
| 1000 | 108,000 | 1 address |
| 1027 | 110,916 | 1 address (physical limit) |
| 1028+ | — | **0 (not even one fits)** |

Formula: `3 keys × 36 unit × period ≤ 111,000` (the storage bucket cap).

### 4.5 New indexer endpoint

**`GET /vault_addr_batches?max=N`**

Returns the **shareholder addresses** of vault B (packed 21-byte hex), for keepers to
construct `pay_rent_shares` calls.

```json
{
  "ret": 0,
  "batches": [{ "blob": "00333ca1f19b602275f871a308675dfece685ae8e7", "count": 1 }],
  "total": 1,
  "max_addrs": 10
}
```

⚠ Only addresses **that have interacted with B** are returned (since 2026-11-20).
Previously A's users were mixed in as well, which meant paying fees for keys that do
not exist in B.

---

## 5. Atomic Transactions (combo)

Complete several actions in one transaction: **either all succeed, or all roll back.**
OTC share transfers rely on this.

### 5.1 Construction

```
POST /api/build
{
  "mode": "combo",
  "main": "<transaction main address>",
  "spec": { "contract": "...", "actions": [...] },
  "gasMax": 99
}
```

`spec.contract` **is only required when a `call` action is present**. Pure transfers do
not need it.

### 5.2 Supported action types

| type | Fields | Description |
|---|---|---|
| `hac-to` | `to`, `hac` | main sends out HAC |
| `hac-from-to` | `from`, `to`, `hac` | A specified address sends HAC (requires that address's signature) |
| `asset-to` | `to`, `serial`, `atoms` | main sends out an asset |
| `asset-from-to` | `from`, `to`, `serial`, `atoms` | A specified address sends an asset |
| `hacd-to` | `to`, `names` | main sends out diamonds |
| `hacd-from-to` | `from`, `to`, `names` | A specified address sends diamonds |
| `call` | `contract`, `fn`, `params` | Contract call |

### 5.3 Step-by-step signing (required for OTC)

On-chain rule (`protocol/src/codec/tx.rs:450` `verify_type3_signatures_exact`): **the
number of signatures on a Type-3 transaction must equal the number of signers**, and
they must all be present **at broadcast time**.

But `insert_sign` only appends and performs no count check — so "A signs one version →
sends it to B → B appends a signature" is entirely feasible at the protocol layer.

**Flow:**

```
① A builds the unsigned body    → /api/build mode=combo
② A signs                       → tx:signRaw
   returns signed_check = PARTIAL (1/2) — 1 more signature needed
③ A sends signed_tx_hex to B
④ B translates this transaction body → /util/transaction/check?description=true&action=true
   ⚠ Must check item by item what "you will pay" and "you will receive"
⑤ B appends a signature         → tx:signRaw (the same hex)
   returns signed_check = OK (all signers signed)
⑥ Broadcast
```

**A's signature does not become invalid by being passed to B** — signing appends to
what is already there; it does not re-sign.

### 5.4 ⚠ The transaction body has no expiry

There is no "expiration time" field on chain. Once the signature is handed to the
counterparty, this transaction **may be broadcast at any moment and cannot be
revoked**.

Clients must display this sentence in the most prominent place.

### 5.5 Translator field names (a common mistake)

The action field names returned by the node's `/util/transaction/check` are **not the
same as the spec's field names**:

| On-chain action | JSON field |
|---|---|
| `TransferHacFromTo`(14) | `hacash` (**not** `hac`) |
| `TransferAssetFromTo`(19) | `asset: { serial, amount }` |
| `TransferHacdFromTo`(6) | `diamonds` (a single one is `diamond`; **not** `names`) |
| Address | `AddrOrPtr` — may be a **pointer index number**, in which case no readable address is available |

When the address is unavailable because it is in pointer form, the "is the recipient
me" determination for that entry comes back empty → the whole thing is marked
unverified, and the UI must show a warning. **Do not let it pass just because you
cannot see a problem.**

---

## 6. Exchange Listing Integration

### 6.0 Remember one thing first: amount is an integer count

hacds is a **decimal 0** asset. The `amount` returned on chain is the count itself,
**with no conversion whatsoever**.

```json
{"serial": 4000, "amount": "100000000"}   →  100,000,000 hacds
```

The previous version was decimal 8 and required dividing by 1e8. **Do not divide in
this version.**

### 6.1 Asset identity (for listing registration)

| Field | Value |
|---|---|
| serial | `4000` |
| ticket | `HACDS` |
| name | `hacds` |
| decimal | `0` |
| supply | `5963298700000000` |
| issuer | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` |

⚠ There is also an asset on chain with serial `1028` that is also called HACDS (its
name is "HACD Fragments", and it belongs to someone else). **Identify by serial, not by
ticket.**

⚠ serial `2000` and `3000` are both deprecated historical issuances (2000 is the #2000
version; 3000 is the first-round mainnet deployment, which was scrapped wholesale
because the accompanying share issuer was filled in wrongly). **Do not** use them for
registration.

There is also a separate share asset (not a listing target; used only for vault
dividend identification):

| Field | Value |
|---|---|
| serial | `4001` |
| ticket | `HACDS-SHARE` |
| decimal | `0` |
| supply | `10000` |
| issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` (the deployer address, **not the contract**) |

### 6.2 Deposit detection

Scan blocks for `TransferAssetFromTo` actions where `serial == 4000` and
`to == your deposit address`.

```
GET /query/block/intro?height={H}&tx_hash_list=true
  → iterate tx_hash_list, GET /query/transaction?hash={h} for each
  → look at the asset transfers in actions
```

**Recommended confirmations**: 3 blocks (about 15 minutes). Hacash targets 300-second
blocks, but there is variance.

### 6.3 Withdrawal construction

A withdrawal is a standard asset transfer:

```bash
hacds_txbuild transfer {main} {ts} asset-from-to {from} {to} 4000 {amount}
```

> ⚠ **The serial must be written as the number `4000`; do not write the `hacds` alias.**
> The `hacds` alias inside `hacds_txbuild` points at the old serial `2000`, which is
> inconsistent with `HACDS_SERIAL = 4000` in the #4000 contract, and on chain it will be
> rejected by `PermitAsset` with `return 1`.
> When going through `/api/build`, the server translates `hacds` into its own
> `HACDS_SERIAL_MAINNET`, but **calling the command line directly** does not get that
> protection.
>
> ⚠ Operations note: `HACDS_SERIAL_MAINNET` in `hacds_build_server.py` must be the same
> as the contract's `HACDS_SERIAL` (it should be `4000` this round). Both deployment
> rounds changed the serial (3000 → 4000); this is the place most easily missed when
> the number changes, and the symptom of missing it is "transferring with the `hacds`
> alias fails, writing the number succeeds".

Alternatively go through the build service (`mode=transfer`, `sub=asset-from-to`).

### 6.4 Broadcast and confirmation

```bash
POST {node}/submit/transaction
{"tx": "...hex..."}
```

`ret:0` only means it entered the mempool. Re-query `/query/transaction?hash=` by block
height; it is confirmed only once `block_height` appears.

### 6.5 Fees and gas

| Item | Description |
|---|---|
| fee format | `value:mantissa`, e.g. `0:248` (very small), `2:247` (0.02 HAC) |
| Fee formula | `fee = purity × billing_size` |
| `gasMax` | `1–99`, default 99. **Do not go below 99 for contract calls** |

### 6.6 Three hard limits you must know

**① A single transaction is 16,384 bytes.** This is a compile-time constant. A
transaction depositing or withdrawing 200 diamonds comes close to this ceiling.

**② Sandbox concurrency per IP = 2.** Exceeding it is rejected outright, not queued.
Exchange backends must serialize.

**③ Three gas buckets**: compute 18,009 / resource 6,100 / storage 111,911. Exceeding
one reports `OutOfGas(31): <bucket name> N > M`. **Raising `gasMax` does not help** —
that is the total allowance; the per-bucket cap is a hard constraint.

> The reason #4000 can go from "1 diamond per transaction" to "200 diamonds per
> transaction" is that scoring was moved into the RV64IM kernel: 200 diamonds cost only
> 3,587 compute, which fits in one bucket. The old FitSH version needed 3,270 resource
> to score just 1, and 2 exceeded 6,100.

### 6.7 Data needed for market making / quoting

```
GET {node}/query/contract/sandboxcall?contract={contract}&function=amm_reserves&caller={contract}
GET {node}/query/contract/sandboxcall?contract={contract}&function=amm_reserve_ds&caller={contract}
```

Spot price (zhu per hacds) = `amm_reserves × 1e8 / amm_reserve_ds`.

Fetching in batch is less work:

| Function | Gets in one call |
|---|---|
| `ref_price_zhu_per_ds` | Smoothed reference price |
| `pool_price` | Pool price (×1e8) |
| `total_debt` / `utilization` | Lending utilization |
| `hacd_count` / `hacd_avg_score` | Pool size |

### 6.8 Reconciliation

The on-chain identity:

```
sum of user due + AMM pool + vault accumulation + LP reward pool  ==  total hacds issued on chain
```

Plus one more:

```
sum of effective HAC balances × hcut == sum of nominal shares
```

The indexer's `GET /backing` checks this on every sync. A mismatch means there is a bug.

### 6.9 Listing integration checklist

- [ ] Register with serial `4000`, decimal `0` (**not 8**)
- [ ] Accept only serial 4000 for deposits; ignore the #1028 asset with the same ticket
- [ ] Withdraw with `asset-from-to`, writing `serial` directly as `4000` (no alias)
- [ ] Confirmations ≥ 3
- [ ] Serialize sandbox calls on the backend (concurrency limit 2)
- [ ] For large withdrawals, check whether the transaction size hits the 16,384-byte ceiling
- [ ] Reconcile using `/backing` and the on-chain identities

---

## 7. Error Handling

### 7.1 Contract return codes

When `ret_val` from a sandbox call is non-zero, it is a `return N` inside a contract
function.

**General**

| Code | Meaning |
|---|---|
| `2` | Parameter format error (e.g. invalid wire format of the HACD name list) |
| `48` | Count out of range (0 diamonds stored / more than 200 / redemption is not exactly 1) |
| `5` | Score is 0 |
| `53` | Total supply cap exceeded |
| `54` | Insufficient coverage (never triggers under 100% issuance) |
| `59` | Expired (`deadline`) |
| `61` | No record in the HACD pool / insufficient score (redemption) |

**AMM**

| Code | Meaning |
|---|---|
| `2` | One side is 0 |
| `23` | Pool non-empty but shares went to zero (prevents scale reset) |
| `24` | Computed shares are 0 (ratio too small) |
| `25` | Insufficient LP shares |
| `26` | First deposit on one side exceeds the cap `1e18` |
| `56` | Slippage protection triggered (`min_out` / `min_share` not met) |

**Lending**

| Code | Meaning |
|---|---|
| `40` | Exceeds borrow limit (`(debt+hac) × 200% > coll_hac`) |
| `41` | Debt is 0 (repayment) |
| `50` | Global utilization above 50% |
| `51` | Borrowing paused (utilization maxed out or price circuit breaker) |
| `52` | Exceeds the single-borrower cap (20%) |

**Liquidation**

| Code | Meaning |
|---|---|
| `42` | That address has no debt |
| `43` | Liquidation line not reached (not liquidatable) |
| `44` | Liquidation amount below the minimum (1 HAC) |
| `45` | Collateral output below `min_coll_out` |
| `46` | Deep-water liquidation requires full repayment (`repay < deep_pay`) |
| `47` | Reference price not initialized; liquidation refused |

**Anything admin-related simply does not exist**

`set_fee` / `set_loan_rate` / `set_liquidate_bonus` / `set_paused` / `set_oracle` are
**not implemented** in #4000. Calling them returns:

```
CallNotExist(51)
```

This is not insufficient permission; **the functions do not exist**. Stop writing those
calls.

### 7.2 Node / sandbox errors

Matched by string; the common categories are:

| Raw message | Meaning | Handling |
|---|---|---|
| `NotFindContract` | No contract code at that address | Check whether the contract address is this round's `bw2sRC…` |
| `invalid address argument` / `InvalidChecksum` | Address format or checksum error | Re-fetch the full address |
| `balance ... is insufficient` | Caller balance insufficient to pay prepaid gas | Pass `caller={contract address}` for sandbox calls |
| `sandbox_per_ip_concurrency_exceeded` | Concurrency limit exceeded | Serialize + retry with backoff |
| `resource gas limit exceeded` | resource bucket exceeded | Split the transaction; **raising gas_max does not help** |
| `compute gas limit exceeded` | compute bucket exceeded | Split the transaction |
| `storage gas limit exceeded` | storage bucket exceeded | Reduce new keys or lower the rent period |
| `OutOfGas(31)` | Some bucket is short | Look at the bucket name in parentheses; split the transaction |
| `Arithmetic(90)` | Arithmetic underflow/overflow | Check the parameters; this is a contract bug, please report it |
| `CallNotExist` | The contract has no such function | Check the function name (admin functions have been removed) |
| `state changed` | Chain state changed in the meantime | Retry |
| `transaction parse failed` | Transaction body failed to parse | Incomplete hex / bytes |
| `StorageNotActive` | Storage key has expired | Call `rent_keys` to renew rent |
| `ECONNREFUSED` / `timeout` | Service unreachable | Check whether the service is running |

**Key point for discrimination**: most of these errors are **HTTP 200 +
`{"ret":1,"err":"..."}`**; looking only at the HTTP status code will miss them.

---

## 8. Quick Reference

### 8.1 Endpoint summary

```
# Full node
GET  /query/block/height/latest
GET  /query/fee/average
GET  /query/balance?address={A}&assets=true&diamonds=true
GET  /query/diamond?name={N}
GET  /query/contract/sandboxcall?contract={C}&function={F}&params={P}&caller={C}
GET  /query/block/intro?height={H}&tx_hash_list=true
GET  /query/transaction?hash={H}
POST /util/transaction/check        {"tx": "hex"}
POST /submit/transaction            {"tx": "hex"}

# Indexer
GET  /health
GET  /snapshot
POST /sync
GET  /backing
GET  /rent_batches

# Build service
GET  /health
POST /api/build
```

### 8.2 Constants

| Constant | Value |
|---|---|
| Deployer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| Contract address | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` |
| Contract nonce | `5` |
| Vault dividend contract B | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (nonce 4) |
| `TREASURY` | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (points at contract B) |
| `BURN_ADDR` | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` (contract A itself) |
| hacds serial | `4000` |
| hacds decimal | `0` |
| hacds total supply | `5963298700000000` |
| Share serial | `4001` |
| Share issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| `SHARE_TOTAL` | `10000` |
| `RENT_RATIO_BPS` | `2000` (rent renewal 20% / dividends 80%) |
| `RPU_SCALE` | `1000000000000` (1e12) |
| `MINIMUM_LIQUIDITY` | `1000` |
| `SCORE_SCALE` | `100000000` (1e8) |
| `MAX_DEPOSIT_COUNT` | `200` |
| `FEE_BPS` | `50` (0.5%) |
| `BORROW_RATIO_BPS` | `20000` (200%) |
| `LIQ_COLL_RATIO_BPS` | `16000` (160%) |
| `CLOSE_FACTOR_BPS` | `5000` (50%) |
| `DEEP_TRIGGER_BPS` | `10500` (105%, deep-water takeover) |
| `DEEP_WATER_BPS` | `9000` (90%, full liquidation allowed) |
| `DEEP_DISCOUNT_BPS` | `300` (3%, the discount given to the liquidator in deep water) |
| `LIQ_PROTOCOL_BPS` | `100` (1%, the portion of the liquidation reward going to the reserve) |
| —— Contract B —— | |
| `PERIOD_NEW` (B) | `100` |
| `RENT_PERIOD` (B) | `300` |
| `RENT_MIN_PERIOD` (B) | `30` |
| `RENT_MAX_PERIOD` (B) | `3000` |
| `AHAC_MIN_PERIOD` | `300` |
| `AHAC_MAX_PERIOD` | `3000` |
| `RENT_REWARD_ZHU` | `5000000` (0.05 HAC per key) |
| `STORAGE_BUDGET` | `111000` |
| `RENT_KEY_UNIT` | `36` |
| `LIQ_BONUS_BPS` | `500` (5%) |
| `U_MAX_BPS` | `5000` |
| `LENDABLE_AMM_BPS` | `3000` |
| VM three buckets | compute 18,009 / resource 6,100 / storage 111,911 |
| Transaction limit | 16,384 bytes |
| gasMax range | 1–99 |

### 8.3 Unit conversion

**HAC** (on-chain zhu):

```
HAC = zhu / 1e8
"5:249" = 5 × 10^(249−248) = 50 HAC
"1:248" = 1 HAC
```

**hacds** (decimal 0):

```
hacds count == the on-chain integer; no conversion
```

⚠ **Do not divide hacds by 1e8.** That was the previous version (decimal 8).

### 8.4 A minimal working piece of state-reading code

```javascript
const NODE = 'https://api.hacds.com';
const CONTRACT = 'bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h';

async function call(fn, params = '') {
  const q = new URLSearchParams({
    contract: CONTRACT,
    function: fn,
    params,
    caller: CONTRACT,       // omitting this fails with insufficient balance
  });
  const r = await fetch(`${NODE}/query/contract/sandboxcall?${q}`);
  const j = await r.json();
  if (j.ret !== 0) throw new Error(j.err || 'call failed');
  return j.ret_val;
}

// Reserves on both sides of the pool
const hacZhu = await call('amm_reserves');
const ds     = await call('amm_reserve_ds');

// Spot price (zhu per hacds)
const spot = Number(hacZhu) * 1e8 / Number(ds);
```

**Concurrency note**: each IP has only 2 concurrency slots. Batch reads must be
queued; do not use `Promise.all`.

---

*This document corresponds to the finalized version of contract `HacdsDeFi3000.fitsh`,
second mainnet deployment (2026-11-18).*
