# HacdsDeFi Whitepaper

2026-11-18　Third Edition (contract #4000, second mainnet deployment)

> This document describes the Hacash mainnet contract `HacdsDeFi3000.fitsh`
> (contract address `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`, asset serial 4000).
> Every number in this document is a constant in the contract source; none of
> them can be changed after deployment.

---

## Before We Start

hacds is an on-chain asset on the Hacash mainnet, serial 4000, decimal 0.

It runs on Hacash's first DeFi contract. Hacash's HVM (the Turing-complete smart
contract VM) activated at block height 765,432. This contract is the first
implementation on mainnet that puts all four DeFi functions — swap market
making, lending, liquidation, and a vault — into a single contract.

The difference between this edition and the previous one is not parameter tuning.
It is that **three centralized components were deleted outright**:

| Previous edition | This edition |
|---|---|
| Off-chain oracle computes the score and signs a certificate; the contract verifies the signature | The contract reads diamond genes on-chain and scores them itself |
| Six admin parameter functions | No admin. Not one. |
| `set_paused` global pause switch | No pause switch |
| serial 2000, decimal 8 | serial 4000, decimal 0 |
| One diamond per deposit | 200 diamonds per deposit |

What has been deleted does not come back. This is a design choice, not a roadmap.

This document has eight parts: the problems of the previous edition, the design
of this edition, four characteristics, the system composition, **the ecosystem
vault and early co-builders' rights**, current status, known limitations, and
frequently asked questions.

---

## 1. Lessons from the Original Edition (the Inscription Era)

### 1.1 The original design

The original edition defined hacds as an inscription carved onto HACD diamonds.
The design had four parts.

**Issuance by inscription.** Each HACD carries one Hacds inscription; only one
per diamond is valid. An ordinary diamond paid 10,000 hacds. How much a special
diamond paid (500,000 for a heart, 300,000 for four consecutive letters, 200,000
for an unusual shape) was decided by community vote.

**Trading by plugin.** The decentralized exchange was built as a plugin wallet
called MoneyNex. Users installed the plugin and entered and exited the market
through the plugin's wallet.

**Listing as the goal.** The first listing target written in the whitepaper was
xeggex.com.

**Discovery by chain scanning.** Each client scanned the entire network's
inscriptions itself; third-party servers could additionally provide search.

### 1.2 We finished it, and we listed

These were not paper designs. The inscription system was built, the MoneyNex
plugin ran, and hacds was listed on two exchanges, xeggex.com and nonkyc.io.

Then trading was suspended.

### 1.3 Where the problem lay

The crux is the first item; the other three are its consequences.

**Price had no anchor.** The issuance ratio depended on a vote, which meant that
how many hacds each class of diamond was worth could be changed by a vote at any
time. Exchanges could not obtain a reproducible conversion basis, market makers
could not give stable quotes, and depth never developed.

**The trading link was bet on someone else.** The decentralized exchange was a
third-party plugin; when the plugin stops being updated, the exchange stops. The
centralized exchanges were even more direct: execution and circulation were both
in the hands of xeggex and nonkyc.

**There was no way out.** Those two exchanges were the entire circulation
channel. Once they stopped, there was nowhere else on-chain to trade.

Taken together: if the token cannot circulate freely, it cannot be priced; if it
cannot be priced, no market can be made; if no market can be made, it can only
depend on exchanges; when the exchange stops, it breaks.

Whether to list was not the point. Even once listed, the design flaws did not
disappear — they were merely postponed until the day trading was suspended. That
is the direct reason this edition changed the design.

### 1.4 What this edition changed

It did only one thing: it took the token off the diamonds.

hacds became a standard on-chain asset that does not depend on any diamond and
can be freely split and transferred. The financial logic moved from plugins and
exchanges into the contract. Circulation no longer depends on listings; the
on-chain AMM can trade by itself, and listing afterwards is merely optional, no
longer a precondition for survival.

On that basis, the two remaining centralized components of the previous edition
— **the oracle** and **the admin** — were also deleted.

---

## 2. The Design of This Edition

### 2.1 Where the supply comes from

The total supply of hacds was not made up; it is computed from all the diamonds
on the network.

Each HACD is scored on five HIP-5 dimensions (shape, pattern, color, naming,
number). The contract sets `SCORE_SCALE = 1e8`: **one point mints 100 million
hacds**. The total takes the exact mean over all diamonds on the network:

```
Total network score = mean score × total HACD issuance
                    = 3.55440306 × 16,777,216
                    = 59,632,987 points

Total supply        = total score × 1e8 per point
                    = 59,632,987 × 100,000,000
                    = 5,963,298,700,000,000 hacds
```

Anyone can recompute this number: pull the explorer API once, score every
diamond, and the result is the same. This is exactly what the previous edition
lacked: a baseline that does not depend on anyone's decision.

### 2.2 How scoring works: read on-chain, no oracle

The previous edition's approach was: compute the score off-chain → sign it into
a certificate → the contract verifies the signature → recompute on-chain and
compare. **This edition deletes that entire path.**

The contract now asks the VM directly for the diamond's gene data in the same
transaction that receives the HACD:

```
hacd_number_batch(names)        → each diamond's number (u64)
hacd_visual_gene_batch(names)   → each diamond's visual gene (10 bytes)
```

With the genes in hand, the contract scores them itself across the five HIP-5
dimensions. **No off-chain involvement anywhere in the process, no certificate,
no signature, no link that can be forged.**

This capability depends on the "HACD gene view" that Hacash nodes have provided
since v1.3.0, and it activates at block height 800,000. Both conditions are
required — if the node version is too old the genes cannot be obtained, and if
the height is too low the VM does not recognize the call.

### 2.3 Batching: 200 diamonds per deposit

This is the second change v1.3.0 brought.

The previous edition could deposit only one diamond per transaction. The reason
was gas: scoring one diamond in FitSH burned about 3,270 units of the `resource`
bucket, and the per-bucket limit is 6,100. Two diamonds went over.

This edition moves the scoring logic out of FitSH and into an **RV64IM calc
kernel** (`score_sum`): a single call passes in the names, numbers, and genes of
up to 200 diamonds and returns the total score directly.

```
input   names[6n] ‖ numbers[8n] ‖ visual_genes[10n]
output  Σ score (8-byte big-endian u64)
```

Scoring 200 diamonds costs only 3,587 units of `compute` — one bucket holds it.
**200 diamonds per transaction, one signature.**

Deposits batch; redemption is still one diamond at a time. The reason is in §7.1.

### 2.4 Asset specification

| Item | Value |
|---|---|
| serial | 4000 |
| ticket / name | HACDS / hacds |
| **decimal** | **0** (1 smallest unit = 1 hacds) |
| Total supply | 5,963,298,700,000,000 |
| issuer | bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h (the contract itself) |
| Issuance cost | 8 HAC (protocol fee, floats with the block reward) |

The on-chain asset at #1028 also uses the ticket HACDS (its name is "HACD
Fragments" — someone else's asset). The protocol does not check whether name and
ticket collide; it only checks whether a serial is already taken. **Recognize
serial 4000.**

There is also a separate share asset, used for vault dividends:

| Item | Value |
|---|---|
| serial | 4001 |
| ticket | HACDS-SHARE |
| decimal | 0 |
| supply | 10,000 (`SHARE_TOTAL`) |
| issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` (the deployer address, **not the contract**) |

The shares are issued to the deployer, who distributes them to holders. **They
accrue interest only when staked into Vault Dividends Contract B** — a transfer
of assets between users triggers no contract hook at all, and the vault cannot
settle at "the instant of sale," so share balances change only at the two
moments a hook can intercept: stake and unstake. Contract B's address is
`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`.

> The lesson from the first round is recorded here: at that time the share
> asset's `AssetCreate` had its issuer set to Contract B itself, and
> `AssetCreate` credits the supply directly to the issuer's name **without
> passing through any hook**. As a result the on-chain balance was 10,000 while
> B's `sh:` ledger was 0, `PermitAsset` never let anything through for lack of
> balance, and every share was locked. The issuer must be the deployer, and the
> shares must then be distributed by the deployer with ordinary transfers.

> ⚠ The old serial 2000 (address `VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1`) is
> retired. serial 3000 (issuer `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`, the first
> mainnet deployment) and serial 3001 (the first-round shares) are void
> together. The serials of the two rounds are independent: they cannot be mixed
> and cannot be converted.

---

## 3. Four Characteristics

### 3.1 Open source

The contract (fitsh source plus the RV64IM kernel), the indexer, the transaction
build service, and the wallets (PC + Android) are all open source.

A DeFi protocol runs on other people's money. The only way users can protect
themselves is to be able to read the code and check the math. The previous
edition's wallet was a third-party plugin — users could only choose to trust it
or not. This edition puts the logic out in the open.

With the code public, three things can be done directly:

- **Scoring can be independently recomputed.** Anyone can pull every diamond on
  the network, recompute the score with the same algorithm, and see whether the
  issuance matches what the contract paid out. On testnet, 119 differential test
  cases verified that the kernel and the FitSH reference implementation agree
  exactly.
- **Contract behavior can be audited.** Having no admin means the function list
  contains no entry point that can change a parameter, change a balance, or
  pause the protocol — this can be verified function by function, without
  taking our word for it.
- **Services can be replaced.** The indexer and the transaction build service
  are stateless HTTP services. Anyone can run their own and point the client's
  service address at it.

### 3.2 Decentralization

This one needs its boundaries stated. Saying "fully decentralized" in general
terms means nothing.

**What has been achieved:**

Rules and execution are both on-chain. AMM pricing, lending eligibility, the
liquidation threshold, and fee distribution are all contract code. Participants
trade under the same rules; we are not in the middle and cannot insert
ourselves.

**There is no admin.** The previous edition had six admin functions (`set_fee` /
`set_loan_rate` / `set_liquidate_bonus` / `set_paused` / `set_oracle` /
`rent_batch`). This edition has **not one of them**; calling one on-chain
returns `CallNotExist(51)` — it is not "you are not given permission," it is
**that the function does not exist at all**.

Every parameter is a compile-time constant. The fee rate, the interest rate
curve, the liquidation line, the reserve target — all written into the source
code. After deployment no one can change them, including us.

The contract cannot be upgraded and has no back door. The entire contract has no
self-destruct function, no upgrade function, no freeze function aimed at an
individual user. What is deployed is what it stays.

Participation requires no permission. Swapping, market making, lending,
liquidating, and even key renewal (`rent_keys`) are open to anyone. No
whitelist, no approval.

Assets can be held by yourself. hacds is a standard on-chain asset held at the
user's own address. We do not take custody, and we cannot freeze it.

**The boundaries and what is not yet achieved, stated together:**

The vault is not a private key; it is a contract. Fees accumulate on the
contract's own `tre:hac:` / `tre:ds:` accounts, and on a sweep they are
transferred into **Vault Dividends Contract B**
(`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`), where B distributes them to share
holders according to staked shares. The sweep does not need our signature —
anyone can initiate it, and B only keeps books by a global accumulator, which is
independent of who triggered it. The contract has no withdrawal function; no one
can take the users' assets.

The remaining single point is the shares. All 10,000 shares (serial 4001) are
issued to the deployer's cold wallet
`15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q`, and the protocol revenue ultimately
belongs to those shares. This is the only place in this edition where the
project team must be trusted.

The servers are single points. The indexer (the borrower ledger) and the
transaction build service run on our servers. They **hold no private keys and do
not participate in consensus**; users can substitute services they run
themselves, or sign transactions offline and then broadcast. But when they go
offline, the convenience features of the web version are affected.

These few points are the actual boundaries of decentralization at present.

### 3.3 Security

Two halves: how the user's money is kept, and how the protocol's rules are
guaranteed.

**Private keys never touch the network.** The wallet is split into cold and hot
halves: the offline machine builds and signs transactions, the online machine
only queries and broadcasts. The private key appears exactly once, in the main
process's memory; at build time it is injected into the child process through an
environment variable and never written to disk. This workflow works because
Hacash transactions have no nonce and no timestamp expiry — a transaction signed
offline remains valid however long it sits before being broadcast.

**Signing is done locally.** Transactions are signed locally by the bundled Rust
program, without going through any node. Nodes are used only to translate,
verify, and broadcast. The node's `/util/transaction/sign` endpoint requires
sending the private key over HTTP; we do not use it.

**Wallet files are encrypted.** The passphrase is derived with scrypt (N=2¹⁵,
r=8, p=1), encryption is AES-256-GCM, and the format version is bound as AAD.
PC and Android share the same keystore format (`hacds-keystore v1`) and can
import each other.

**The UI process has no system privileges.** The renderer enables
`contextIsolation` and disables `nodeIntegration`, and can reach the main process
only through a preload whitelist. Even if the render layer were fed malicious
content, it could not touch the filesystem or the private key.

**Scoring cannot be forged.** Scoring happens in the contract, on-chain, and the
input is the diamond genes returned by the VM. There is no off-chain step that
can be compromised, and no signature that can be forged.

**Assets are conserved.** The on-chain identity: the amount users hold plus the
amount the contract holds equals the total supply. Every operation preserves
this equation, and anyone can check it at any time.

### 3.4 DeFi completeness

The previous edition's "finance" was only two things: issuing a token, and
getting that token onto an exchange. No financial primitives, no market making,
no collateral, no borrowing — returns could only come from price appreciation.

This edition fills that in. One contract, four blocks:

| Module | Content |
|---|---|
| AMM | Two-way exchange between HAC and hacds. Constant product `x × y = k`, 0.5% fee, **LP 80% / vault 20%** |
| Lending | Use hacds as collateral to borrow HAC. Borrow line 200% collateral ratio, liquidation line 160%, floating rate 2%–46% |
| Liquidation | Two tiers: normal liquidation (105%–160%, cuts half the debt at a time) + deep-water takeover (<105%, the full amount) |
| Vault | Fees settle there; anyone can trigger a sweep into Vault Dividends Contract B, distributed by share |

There are also a few tools.

**Atomic transactions.** Multiple operations merged into a single transaction,
all succeed or all fail. The protocol cap is 200 actions.

**Socialized bad debt (hcut).** In extreme cases bad debt is spread
proportionally across all depositors, expressed by a global factor `hcut` that
only ever decreases. This is a public, one-time, irreversible loss — not a bug,
but the last line of defense.

**Storage rent.** Hacash contract state must pay rent, and keys expire. The
contract provides permissionless `rent_keys`: anyone can renew and receive
0.07 HAC per key as payment. This is how the keeper works, and anyone can run
one.

**Interest is accrued lazily.** No scheduled job, no keeper dependency. When
someone interacts with the contract, interest is caught up by block-height
difference. It saves gas, and it does not stall just because no one is
maintaining it.

---

## 4. System Composition

The whole is in three layers: the on-chain contract and assets, the server-side
node and supporting services, and the client-side wallets. Cold/hot separation is
a way of using them, not a separate layer.

### 4.1 Three layers and their responsibilities

| Layer | Component | Can | Cannot |
|---|---|---|---|
| ① On-chain | HacdsDeFi contract · `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` | Move assets, record debt, liquidate, score — per code rules | Be modified in parameters or paused by any address |
| ① On-chain | hacds asset · serial 4000 · decimal 0 | Be freely split, transferred, listed on exchanges | Be inflated (there is no mint function) |
| ① On-chain | Vault Dividends Contract B · `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` | Distribute vault revenue by staked shares | Be modified in parameters or paused |
| ② Server | Full node RPC · `node.hacds.com` | Read the chain, verify, broadcast | Obtain private keys (we do not use its signing endpoint) |
| ② Server | API proxy · `api.hacds.com` | Forward to the node, add CORS + HTTPS | Change any semantics |
| ② Server | Indexer · `indexer.hacds.com` | Scan the chain and record "who has debt, who can be liquidated" | Affect any on-chain state |
| ② Server | Build service · `build.hacds.com` | Turn human input into an unsigned transaction | Sign (private keys are always on the client) |
| ③ Client | PC console / Android | Sign locally, broadcast | Bypass contract rules |

**Data flow**: the client reads state through "API proxy → full node" and reads
the ledger from the indexer; to send a transaction, it can construct one itself
or ask the build service to generate an unsigned transaction — **signing is
always completed locally on the client**.

**⚠ One hard constraint**: full-node sandbox calls are limited to 2 concurrent
requests per IP. Requests over the limit are rejected outright, not queued. The
client must serialize and retry with backoff.

**Why the service addresses are subdomains rather than `IP:port`**: Cloudflare
Workers can only reach ports 80/443, and any address in the form `IP:8082` is
rejected before a connection is even established. Everything external therefore
goes uniformly through `*.hacds.com` subdomains + Tunnel.

### 4.2 Responsibility boundaries

| Component | Can | Cannot |
|---|---|---|
| Contract | Move assets, record debt, liquidate — per code rules | Be modified in parameters or paused by any address |
| Full node | Read the chain, verify, broadcast | Obtain private keys (we do not use its signing endpoint) |
| Indexer | Record who has debt, compute health | Affect any on-chain state |
| Build service | Turn parameters into an unsigned transaction | Sign (private keys are always on the client) |
| Client | Sign locally, broadcast | Bypass contract rules |

---

## 5. The Ecosystem Vault and Early Co-builders' Rights

### 5.1 How history unfolded: from the untamed beginnings to consensus

HacdsDeFi was not born in a single step. It went through an extremely profound
transformation and rebirth.

In early 2024, the first version of the Hacds protocol (the inscription
edition) was launched within the community. More than 30 early Web3 builders,
out of consensus around the Hacash ecosystem and trust in the core developer,
jointly raised the early development funds. Yet, constrained by the extremely
crude inscription architecture of the time (heavily dependent on third-party
plugins and centralized servers), the project suffered a major setback, and the
early funds were entirely lost.

With no legally binding contract of any kind, over three years, not one person
held the developer to account.

This extraordinarily rare, classical trust became the core driving force behind
the protocol's repeated reconstruction. In order not to betray that trust, the
core developer then independently started the first reconstruction (the #2000
edition). But after rigorous security audit and self-repudiation, the #2000
edition still carried structural centralization risks such as a heavy dependence
on an off-chain oracle.

Hence the thoroughly trust-minimized #4000 reconstruction. This reconstruction
refused all new external financing; the core developer single-handedly and
independently completed the entire underlying architecture and code
reconstruction, and bore all development and operations costs alone.

### 5.2 Mainnet deployment incident record and post-disaster reconstruction

The path of engineering is never smooth. During mainnet deployment, an extremely
serious technical incident occurred.

Issuing the share asset (originally designated Serial 3001) required filling in
an `issuer` parameter. That parameter was mistakenly filled with the vault
contract's own address. And Hacash's `AssetCreate` action **mints out of thin
air and credits the amount directly to the issuer address**, without passing
through any contract hook — so the following state arose:

| Item | Value |
|---|---|
| Vault Contract B's on-chain 3001 balance | 10,000 shares |
| Vault Contract B's `sh:` share ledger | **0** |
| Consequence | `PermitAsset` requires sufficient `sh:` balance to let a transfer out through → **always returns 11** |

This also means that, among Vault Contract B's 15 external functions, not one
could initialize the `sh:` ledger. This was a deadlock, unrecoverable on-chain.
Because Hacash's underlying mechanism is absolutely immutable, those 10,000
shares were locked in an instant.

**The core developer bore all the gas losses of the mainnet deployment alone.**
Because a Serial cannot be reissued (if `state.asset(&serial)` exists, the call
is rejected), we decisively abandoned the entire 3000 / 3001 numbering scheme
and fully switched to **Serial 4000 (the main protocol asset)** and **Serial
4001 (the share certificate)** for the final reconstruction, with both
contracts redeployed under new nonces accordingly.

This incident made us revere immutable code even more. Even the developer himself
would pay the price for a single parameter mistake, which proves all the more the
absolute authority of the "no admin" mechanism — no one can "just fix it,"
including the person who wrote it. Starting from 4000, HacdsDeFi set out again,
impeccable.

### 5.3 Turning rights into an asset: HACDS-SHARE (Serial 4001)

To make the early contributors' rights thoroughly transparent and on-chain, the
protocol tokenized them.

| Field | Value |
|---|---|
| Asset name | HACDS-SHARE |
| Asset Serial | **4001** |
| Total issuance | **10,000 shares** (no further minting, `decimal = 0`) |
| **Issuer** | **the core developer's cold wallet address** `15fv6cNE…` |
| Distribution principle | strictly corresponding to the historical contribution ratios of the early co-builders in early 2024 |

**Why the issuer is not the vault contract**: this is precisely the direct lesson
of the incident in 5.2. `issuer` answers "**where this batch of assets was
born**," not "**who ultimately manages this batch of assets**." For
certificate-type assets that need to be staked into a contract, they must be
issued to an ordinary address that can transfer freely, and the holder then
decides for themselves whether to stake. The vault contract **never issues and
never holds** its own share asset.

This is not a debt, but the ecosystem's permanent on-chain credential of honor
and rights for those who shared the early risk.

### 5.4 The independent Vault Contract B and revenue distribution

The protocol revenue generated by the main protocol (the AMM fee share, the
lending interest share, and so on) is automatically collected into the
independently deployed Vault Contract B (address `duEkx1E3…`, pointed to by the
main contract's `TREASURY` constant).

Vault Contract B's design follows the principles of "code is law" and "absolute
trustlessness":

**① Rent reserve first (20%)**

Each time the vault receives revenue, it automatically deducts 20% into the
`reserve:rent` internal account. This portion of HAC is used only to pay for
on-chain storage rent renewal of the main protocol and Contract B (keeper
compensation), ensuring the protocol keeps running without human intervention.

**② Entitlement distribution pool (80%)**

The remaining 80% enters the dividend pool. The contract uses an **rpu
(cumulative reward per share) accumulator** mechanism:

```
rpu:share += div_part × RPU_SCALE / tot:staked
amount due to an address = shares × (rpu_now − chk) / RPU_SCALE
```

> ⚠ **A semantic point that must be stated clearly: holding 4001 in a wallet
> does not mean automatic dividends.**
>
> Only shares **staked into Contract B** accrue. This is because asset transfers
> between users trigger no contract hook at all, so the contract cannot settle
> at "the instant of sale." Staked shares are recorded in the `sh:<address>`
> ledger, and that is the sole basis for dividends.

The dividend denominator is the **current total staked amount** (`tot:staked`),
not a fixed 10,000. This is deliberate: with a fixed denominator, the lower the
staking ratio the greater the leakage (at a 25% staking ratio, out of 80 HAC only
20 is distributed and 60 is stranded permanently); with a dynamic denominator,
every payment is fully absorbed by the shares on the books at that moment, and
structural leakage is zero.

Claiming dividends requires actively calling `claim()`. `claim` only settles the
increment into the `due:` ledger; the money is still in the contract. Actually
receiving it requires an additional `TransferHacFromTo` withdrawal (the client
already merges the two steps into one atomic transaction).

**③ No admin**

The contract has no concept of an admin at all: no pause, no parameter-modifying
entry point, no ability to move funds. All of its 15 external functions are
either "user operations" or "read-only views." Anyone can call `pay_rent` /
`pay_rent_shares` without permission to help it renew rent, and receive
compensation from `reserve:rent` according to the number of keys actually
renewed — this turns "maintaining the protocol" into a profitable activity that
does not depend on any particular keeper account.

### 5.5 Transfer of rights: absolutely free P2P

The protocol **sets up no centralized order book and no AMM pool in the on-chain
contract**. A high-value, extremely low-liquidity asset placed in an AMM pool is
extremely easy to manipulate.

The Serial 4001 asset circulates as freely as any ordinary on-chain asset.
Holders who wish to exit can use Hacash's native **atomic transaction** to do a
peer-to-peer "cash on delivery, goods on payment" exchange with a buyer across
multiple assets (HAC, HACD, or any other on-chain asset).

The semantics of an atomic transaction guarantee: **either the whole trade
executes, or the whole thing rolls back**. There is no possibility of "paying the
money and not getting the goods," which thoroughly eliminates counterparty
default risk. The client has this built in (share OTC); it supports up to 3
consideration assets in combination and provides a human-readable translation of
the unsigned transaction body — so that, before signing, the parties can check
item by item "what I am giving up and what I am receiving."

### 5.6 Conclusion: code defines the rules, trust decides consensus

From the untamed inscription beginnings of 2024, to the groping of 2000, to the
trial and error of 3000 and the nirvana of 4000. These more than three years are
the deepest soul of HacdsDeFi.

We deleted the admin, open-sourced every tool, and even made public the painful
failure of the mainnet deployment. We handed the life of the system to
mathematics and the key to the vault to code. This is not only an accounting to
those 30-odd early co-builders, but also the purest geek contract spirit in the
entire Hacash ecosystem.

---

## 6. Current Status

### 6.1 What is complete

| Item | Status |
|---|---|
| Contract source | Finalized, 16,201 bytes (limit 16,384), passed a full security audit |
| Scoring kernel | RV64IM kernel, 2,026 bytes, 119 differential tests agree with the FitSH reference implementation |
| Testnet | Local full node + multiple addresses; groups A/B/C/G, 40 functional tests, all pass |
| Attack tests | 43 attack scenarios (reentrancy, front-running, price manipulation, underflow, etc.) |
| Server side | Full node / indexer / build service / keeper all online, autostart on boot |
| PC wallet | v0.4.4, Windows installer + portable build |
| Android | v0.2.3, signed APK, arm64 |
| Website | hacds.com (whitepaper, docs, web console) |

### 6.2 Deployment

**The contract has been deployed to mainnet** (2026-11-18, second round). Both
prerequisites for deployment have been met:

| Condition | Status |
|---|---|
| Node ≥ v1.3.0 (provides the HACD gene view) | ✅ Ready |
| Block height ≥ 800,000 | ✅ Passed |

The first-round deployment is void: when the share asset was issued, the issuer
was filled with Contract B, and Hacash's `AssetCreate` credits the supply
directly to the issuer's name without passing through any hook — the on-chain
balance was 10,000 while Contract B's `sh:` ledger was 0, so `PermitAsset` never
let anything through and the shares could not be transferred out. A serial
cannot be reissued, so the whole set had to be redone under new numbers: both
contracts redeployed (nonce 5 / nonce 4), the assets switched to serial 4000 /
4001.

The website, the wallets, and this document have all switched to the second
round's addresses and serials; see Appendix A for details.

### 6.3 What testnet verified

- **Batch deposits**: 54 diamonds in a single transaction, measured successfully;
  differential tests cover the 200-diamond cap
- **AMM**: constant product exact to the unit; slippage protection and
  first-deposit dead shares both behave correctly
- **Lending**: borrow limits, interest accrual, repayment, and the health view
  all match expectations
- **Liquidation**: both normal liquidation and deep-water liquidation were
  actually triggered, with the books closing exactly
- **Transfers**: HAC / hacds / HACD, all three assets transferred against each
  other
- **Attack simulation**: all 43 scenarios failed as expected; no exploitable path

Two real defects were found and fixed in total (both on the liquidation path,
exposed only by real on-chain execution on testnet): one `resource` bucket
overflow, one underflow. The fix notes are in the repository at
`hacds_exchange/修复说明-清算gas与下溢.md`.

---

## 7. Known Limitations

A few things were not left undone out of neglect; they are this way for now,
after weighing the trade-offs. They are written down here so that those who come
later do not have to step on them.

### 7.1 Redemption is still one diamond at a time

Deposits batch to 200; redemption is 1 at a time. This is intentional.

Redemption has to price the "diamond-picking premium": redeeming a high-scoring
diamond costs more, and the rate depends on where that diamond's score sits
relative to the **pool average score**. In a batch redemption every diamond is
judged differently, and redemption triggers an automatic AMM top-up, so each one
has to have its balance checked separately.

More critically, there is the **accounting basis**: if one diamond in the middle
of a batch redemption fails, how are the already-processed ones rolled back? The
contract cannot be upgraded, and writing that rollback logic wrong means locked
funds.

Therefore: **batch deposits, single redemption.** The wallet automatically
splits your selection into multiple transactions; the user clicks once.

### 7.2 The shares are a single point

Vault revenue goes through Contract B's dividends, and the chain itself needs no
trust in anyone: the sweep is permissionless, B's hook does not read the
initiator, and the split follows shares. The single point is **share
ownership** — the 10,000 shares (serial 4001) are held and distributed by the
deployer's cold wallet `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q`. Whoever receives
shares receives dividends, and this is verifiable on-chain.

### 7.3 The servers are a single point

The indexer and the build service are run by us. They cannot touch on-chain
state, but when they are offline the web version is less convenient. Anyone can
run their own — the source is public.

### 7.4 300-second blocks

A successful broadcast is not the same as being on-chain; `ret:0` only means it
entered the mempool. The wallet re-polls a few times on the block cadence (15,
45, 90, 180, 320 seconds).

### 7.5 Interest is not displayed separately

The contract accrues interest lazily, and the accrual starting point has no
external interface, so the current interest owed cannot be computed; it is shown
only as the on-chain settled result at repayment time.

### 7.6 Withdrawals may be temporarily refused

If too much has been lent out and there is not enough cash, HAC depositors'
withdrawals will be refused. This is deliberate — the protocol would rather make
you wait than write a queueing system that could deadlock. Fortunately, two
layers of protection make this rare: total borrowing is capped at 50%, and only
30% of the AMM's HAC can be lent out.

### 7.7 The contract cannot be upgraded

Even a bug, once found, cannot be fixed. That is why the parameters are designed
conservatively (a 20% liquidation buffer, a 50% borrow cap, two layers of cash
protection), and it is one more reason: **do not put your entire net worth in**.

---

## 8. Frequently Asked Questions

**Q: Will hacds inflate?**
No. It is issued against diamond equivalence, with a total fixed at
5,963,298,700,000,000, and the contract has no mint function. On deposit the
contract checks `issued + this mint ≤ total supply`, and rejects anything over
it (return 53).

**Q: Is there an admin who can take my money?**
There is no admin. No `set_*` function exists in the contract at all; calling one
returns `CallNotExist(51)` — the function truly does not exist, it is not
insufficient permission. No one can pause it, modify parameters, or transfer
user assets away.

**Q: How many diamonds can be deposited at once?**
200. One transaction, one signature.

**Q: Why can redemption only be one diamond?**
See §7.1. The diamond-picking premium has to be priced diamond by diamond, and
batch rollback logic is too risky in a contract that cannot be upgraded.

**Q: What is the APY?**
It floats. Deposit yield depends on how much has been lent out, and the
borrowing cost floats between 2% and 46%. The interface shows live values.

**Q: What happens if diamonds drop?**
If the ratio falls below the liquidation line, liquidators repay your debt for
you and take part of the collateral. The rest is still yours.

**There is no grace period** — once the ratio falls below 160% you can be
liquidated at any time, with no advance notice. A single liquidation cuts only
half the debt, but if the price keeps falling you will be liquidated repeatedly;
below 105% the whole position is closed at once.

If you top up collateral or repay a portion before the drop, you will not be
liquidated.

**Q: Will liquidation wipe me out in one go?**
Normal liquidation (105%–160%) cuts at most 50% of the debt at a time, and the
liquidation bonus is calculated **on the amount repaid**, not on a proportion of
the debt. So liquidating half the debt takes only about one third of the
collateral — once it is done, the collateral ratio actually rises above 200%,
leaving the danger zone immediately.

But if the price keeps falling, you will be liquidated again. Below 105% you
enter deep water, and the entire debt is closed at once.

**Q: Why does redeeming a high-scoring diamond cost more?**
To prevent people from picking the good diamonds out of the pool. It is a tax on
"cherry-picking," at most 30%; ordinary and low-scoring diamonds pay nothing.

**Q: Where does the money the protocol earns go?**
Into Vault Dividends Contract B
`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`, distributed to holders by share. The sweep
is permissionless, anyone can initiate it; the distribution rules inside B are
compile-time constants, verifiable on-chain.

**Q: Could the team run away with the funds?**
The contract has no withdrawal function, no admin privileges, and the code is
public and auditable. But **the shares are concentrated in the deployer's hands**
(10,000 shares, serial 4001) — this is the only place where the project team must
be trusted. In addition, the contract cannot be upgraded, so do not put your
entire net worth in either.

**Q: Where does the diamond price data come from?**
No external data source is needed. It reads the AMM pool's balance ratio
directly, and nobody can forge it. A single transaction can move the reference
price by at most 10%, so dumping to manipulate is extremely expensive.

**Q: What happens when a key expires?**
Hacash contract state must pay rent, and an expired key becomes inactive
(`StorageNotActive`). The contract provides permissionless `rent_keys`: anyone
can renew, and receives 0.07 HAC per key as payment. This is how the keeper
works.

---

## Appendix A: Addresses and Parameters

| Item | Value |
|---|---|
| Deployer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| Contract nonce | 5 |
| **Contract address** | **`bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`** |
| Vault Dividends Contract B | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (nonce 4) |
| `TREASURY` | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (points to Contract B, no longer a cold wallet) |
| `BURN_ADDR` | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` (Contract A itself) |
| hacds serial | **4000** (decimal **0**) |
| hacds total supply | 5,963,298,700,000,000 |
| Share serial | **4001** (decimal **0**, supply 10,000) |
| Share issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` (the deployer address, **not a contract**) |
| `SCORE_SCALE` | 1e8 (1 point = 100 million hacds) |
| `RPU_SCALE` | 1e12 (fixed-point scaling for the reward accumulator) |
| `MINIMUM_LIQUIDITY` | 1,000 (first-deposit dead shares, recorded at the contract's own address) |
| `SHARE_TOTAL` | 10,000 (total shares, Contract B) |
| `RENT_RATIO_BPS` | 2,000 (rent reserve 20% / dividends 80%, Contract B) |
| Total network score | 59,632,987 points (= mean 3.55440306 × 16,777,216 diamonds) |
| `FEE_BPS` | 50 (AMM fee 0.5%) |
| Fee distribution | LP 80% / vault 20% |
| `BORROW_RATIO_BPS` | 20,000 (borrow line: 200% collateral ratio, i.e. borrow at most 50%) |
| `LIQ_COLL_RATIO_BPS` | 16,000 (liquidation line: 160%) |
| `CLOSE_FACTOR_BPS` | 5,000 (normal liquidation, single-time cap 50% of debt) |
| `DEEP_TRIGGER_BPS` | 10,500 (below 105% → deep-water full liquidation) |
| `LIQ_BONUS_BPS` | 500 (liquidation bonus 5%, calculated on the amount repaid) |
| `LIQ_PROTOCOL_BPS` | 100 (of which 1% goes to the reserve) |
| Interest rate curve | U=0 → 2%, U=35% → 6%, U=50% → 46% |
| `LENDABLE_AMM_BPS` | 3,000 (only 30% of the AMM's HAC is lendable) |
| `U_MAX_BPS` | 5,000 (global utilization cap 50%) |
| `BORROWER_CAP_BPS` | 2,000 (single borrower cap 20%) |
| `RES_TARGET_BPS` | 300 (bad debt reserve cap 3%) |
| `MAX_DEPOSIT_COUNT` | 200 (per-transaction deposit cap) |
| `RENT_PERIOD` | 300 blocks |
| `REF_WINDOW` | 300 blocks (EMA time constant, about 1 day) |
| `EMA_MAX_STEP_BPS` | 1,000 (reference price maximum single move 10%) |
| `REF_DEV_BPS` | 2,000 (circuit breaker threshold: spot deviating 20% from the reference price → new borrowing paused) |
| VM three-bucket limits | compute 18,009 / resource 6,100 / storage 111,911 |
| Transaction limit | 16,384 bytes |
| Target block time | 300 seconds |

## Appendix B: Units

hacds is an asset with **decimal 0**. The integer on-chain is the count itself:
1 is 1, and there are no fractions. This is simpler than the previous edition
(decimal 8) — no back-and-forth conversion between atoms and "units."

**Three rules:**

1. **hacds is always counted in units, with no conversion.** Balances, pools,
   collateral, input fields, quotes — what you see is the same number everywhere.
2. **HAC is a different scale.** The on-chain unit is zhu (1 HAC = 1e8 zhu), and
   interfaces always use HAC. So the two parameters of
   `add_liquidity(hac_amt, ds_amt)` have different dimensions: one is zhu, the
   other is a count of hacds. This is the place where an off-by-1e8 error is
   easiest to make; we made it ourselves on the first deposit.
3. **The total supply 5,963,298,700,000,000 has exceeded the JS safe-integer
   limit.** `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991, and the total
   supply reaches 66% of it — the value still fits, but it has crossed the
   psychological red line of "exact representation," and any intermediate
   operation (such as multiplying by a pool count) will lose precision. So in JS
   you must use `BigInt`, and in Kotlin `BigInteger`; `Long` (limit about
   9.2×10¹⁸) is not enough.

---

*This document corresponds to the finalized parameters of the contract
`HacdsDeFi3000.fitsh`.*
