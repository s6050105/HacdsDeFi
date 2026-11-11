# HacdsDeFi User Guide

2026-11-11　For PC wallet 0.4.0 / Android 0.2.0

> This document corresponds to contract #3000 (address
> `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`, asset serial 3000).
>
> **This edition removed the oracle, the scoring certificates, and the admin.**
> You no longer wait for any service to issue a certificate, and "the admin
> paused the contract" can never happen — that function does not exist.

---

## Who this guide is for

For anyone who has this wallet, opens it for the first time, and does not know
what to click.

Assume you know nothing about contracts or the HVM, and do not need to. After
reading, you should be able to do it all yourself: install, create a wallet,
turn diamonds into hacds, swap in the pool, borrow against collateral, and send
coins to someone else.

Every place an amount appears, the unit is stated. **This is the easiest place to make a mistake — please read §9.**

---

## 1. Three things to prepare

**A computer** (Windows 64-bit) **or an Android phone**.

| Platform | File | Notes |
|---|---|---|
| PC | `HacdsDeFi-Setup-0.4.0-x64.exe` | Installer, double-click to install |
| PC | `HacdsDeFi-0.4.0-x64.exe` | Portable, double-click to run |
| Android | `HacdsDeFi-0.2.0-arm64.apk` | Must allow "install from unknown sources" |

Pick one of the two PC builds. Phones must be arm64 (every mainstream device of
recent years).

**Network access to the servers.** The wallet stores no chain data; it connects
to two services:

| Service | Address | Purpose |
|---|---|---|
| Node | `node.hacds.com` | Balances, broadcast, read contract state |
| Indexer | `indexer.hacds.com` | Ledger for liquidations (optional) |

Both are pre-filled. If the network works, nothing needs changing. To switch,
edit them at the top.

> **Only two services now — no oracle.** The old edition had a third service that
> issued scoring certificates for diamonds. It is gone entirely: the contract now
> reads diamond genes and scores them itself, with no off-chain step at all.

---

## 2. First launch

On PC, the top row looks like this:

```
[Node] [Indexer] [Contract] [Save] [Test]     [−] 100% [+] [⟲]   [Language▾]
```

**First thing: click "Test".**

Then look at the log area below. You should see `Node OK, height 79xxxx`.

If the node is unreachable, check your network first. **An unreachable indexer does not block you** — the liquidation page is just slower (it falls back to
scanning blocks locally).

---

## 3. Create a wallet (or import one)

### 3.1 New users: create a wallet

Click "Create wallet" and set a password.

**At least 8 characters, and it cannot be recovered if lost.** The wallet file is
encrypted and stored locally; there is no recovery, no support, no back door.
Write it on paper — do not keep it only on the computer.

When done, it shows your address (starts with `1`, about 34 characters) and a
12-word mnemonic. **Write the mnemonic down and store it offline.** It is the
only way to restore your wallet.

### 3.2 Existing wallets: three import methods

| Method | When to use |
|---|---|
| Mnemonic | Migrating from another wallet |
| Keystore file | PC and Android are interchangeable; same format (`hacds-keystore v1`) |
| Private key | For legacy keys |

### 3.3 Managing multiple wallets

Click "Wallet manager" to see every wallet on this machine, switch, rename, or
delete.

---

## 4. What you see after unlocking

The top is **seven tabs**, identical to the web version:

```
[Swap] [Liquidity] [Lending] [HACD] [Transfer] [Funds] [Tools]
```

Below that, three persistent cards:

| Card | Content |
|---|---|
| Asset overview | HAC, HACD count, hacds balance, quota inside the contract |
| Protocol status | Pool reserves on both sides, reference price, utilization |
| Loan status | Your debt, collateral, health |

All three collapse via the `▾` in their top-right corner.

---

## 5. Reading the three cards

### 5.1 Asset overview

| Item | Meaning |
|---|---|
| HAC | HAC in your wallet, spendable directly |
| HACD | How many diamonds you hold |
| hacds (quota) | hacds **inside the contract**, not yet claimed on-chain |
| hacds (on-chain) | The standard asset already at your own address |

**You own the sum of the two hacds figures.**

### 5.2 Protocol status

| Item | Meaning |
|---|---|
| Pool HAC / pool hacds | Reserves on both sides of the AMM pool |
| Reference price | The smoothed price the contract uses for liquidation valuation |
| Utilization | Lent out / lendable; above 50% no new borrowing |

### 5.3 Loan status

**The health figure is the important one**:

| Display | State | What happens |
|---|---|---|
| > 10000 | Safe | Nothing |
| = 10000 | Dangerous | Exactly on the liquidation line |
| < 10000 | Liquidatable | Anyone can liquidate you at any time |
| < 9000 | Deep water | The entire debt can be closed in one go |

**There is no grace period.** Below a 160% collateral ratio you can be liquidated
at any moment, with no advance notice.

---

## 6. Every transaction follows the same steps

Whatever you do, the flow is:

```
Fill parameters → click "Build transaction" → review → click "Broadcast" → wait for confirmation
```

**The preview shows**: action, byte size, fee, signature digest.

**Three possible outcomes after broadcasting**:

| Outcome | Meaning |
|---|---|
| `ret:0` | Reached the mempool, **not yet on chain** |
| Confirmed | Balances change |
| Error | Check the log; explained in plain language |

**Blocks take about 300 seconds.** A successful broadcast is not instant effect;
the wallet re-polls automatically (15/45/90/180/320 seconds).

---

## 7. Common operations

### 7.1 Turn diamonds into hacds (the most common operation)

1. Open the "HACD" tab
2. Click "Load my diamonds"
3. **Select the diamonds you want to deposit** — many at once, up to 200
4. Click "Bulk deposit"

**One transaction, one signature, up to 200 diamonds.** This is the biggest
change in this edition: the old version allowed only one per transaction.

The interface shows the expected hacds: **1 point = 100 million hacds**.

> **Note**: what you receive is a **quota (due) inside the contract**, not yet an
> on-chain asset. To get it into your wallet, see 7.2.

### 7.2 Claim your hacds

"Funds" tab → "Claim hacds" → enter amount → build → broadcast.

**This step actually moves hacds into your address.** Afterwards it is a standard
on-chain asset that can be sent to any Hacash asset wallet or exchange.

### 7.3 Deposit HAC into the contract / withdraw it

On the "Funds" tab:

| Operation | What it does |
|---|---|
| Deposit HAC | Wallet HAC → HAC credit inside the contract (for liquidity, repayment) |
| Withdraw HAC | Contract credit → wallet |
| Deposit hacds | On-chain hacds → quota inside the contract (for liquidity, collateral) |
| Claim hacds | Contract quota → on-chain |

**Keep the distinction**: inside the contract is "credit", on-chain is "asset".
They are not the same thing. AMM and lending operate on the **inside-contract**
portion.

### 7.4 Swap in the pool (AMM)

The "Swap" tab, two directions:

| Operation | What to enter |
|---|---|
| HAC → hacds | HAC in (unit: HAC) |
| hacds → HAC | hacds in (unit: count) |

After entering, the interface shows **how much you get** and **the current pool price** in real time.

**Slippage protection**: `min_out` is the least you will accept; `0` means no
limit. When the market is volatile, enter a number to prevent being front-run.

### 7.5 Add liquidity and earn fees

The "Liquidity" tab.

Enter the HAC side, and **the hacds side is computed automatically from the pool ratio**. This stops you from mismatching the ratio and giving money away.

| Item | Notes |
|---|---|
| Fee share | **80% of trading fees go to LPs**, 20% to the treasury |
| Redemption fee share | **80% of redemption fees also go to LPs** |
| Impermanent loss | Yes. Inherent to every AMM |
| Credit risk | 30% of pool HAC is lent out; worst case you lose that 30% |

**Removing liquidity takes two steps**: first "claim LP rewards", then "remove
liquidity". The wallet splits it into two transactions for you; you click once.

> Why split? A single transaction hits the mainnet `resource` bucket limit
> (6,102 > 6,100). This was found in real testing; the contract cannot change, so
> the wallet splits it.

### 7.6 Borrow against collateral

The "Lending" tab.

1. First "Add collateral" — the collateral is the **hacds quota inside the contract**
2. Then "Borrow", up to half the collateral value

**Below the input, real-time hints show**: your current borrow limit, the
collateral this transaction needs, and current collateral value. No guessing.

**The rate floats**: utilization 0% → 2%, 35% → 6%, 50% → 46%.

**Failure to repay means liquidation.** No grace period. Suggestions:
- Do not borrow the maximum (30%–40% is far more comfortable)
- Top up once health approaches 150%
- Watch the health in the "Loan status" card; it uses **the same price** as
  on-chain liquidation

### 7.7 Send coins to someone

The "Transfer" tab, four types:

| Type | Notes |
|---|---|
| Send HAC | On-chain HAC |
| Send hacds | On-chain hacds asset |
| Send HACD | Diamonds, multiple at once |
| Send other asset | Enter serial + amount |

### 7.8 HACD tab: view diamonds, batch operations

The "HACD" tab has two halves:

**Top: deposit**
- Load my diamonds → select → bulk deposit
- Up to 200 per transaction

**Bottom: redeem**
- Load pool diamonds → select one → redeem
- **Redemption is one diamond at a time**

> Why can't redemption batch? Each diamond needs its own "cherry-picking premium"
> (high-scoring diamonds cost more), and if a batch fails midway, rollback logic
> is too risky in a contract that cannot be upgraded. The wallet splits your
> selection into multiple transactions; you click once.

---

## 8. Advanced features (optional)

### 8.1 Read-only query

"Tools" tab → "Read-only query". Call any read-only contract function directly
and inspect the return value. Very useful for troubleshooting.

### 8.2 Atomic transactions

Multiple actions in one transaction, all or nothing. The protocol cap is 200
actions.

### 8.3 Offline signing (cold/hot separation)

"Tools" tab → "Offline signing":

1. Cold machine (never online): fill parameters, build, sign
2. Output a QR code or file
3. Hot machine (online): scan or load the file, broadcast

**The private key never touches the network.** Hacash transactions have no nonce
and no timestamp expiry, so a transaction signed offline stays valid no matter
how long it waits before broadcast.

### 8.4 Liquidation / settlement

"Tools" tab → "Liquidation". Lists every liquidatable address and its health.

Liquidation is profitable: you repay someone's debt and take collateral worth
"repayment + 5%". Normal liquidation handles at most half of their debt at once.

### 8.5 Storage key renewal (operations)

"Tools" tab → "Renew".

Hacash contract state pays rent, and keys expire. **Anyone can renew and earn a reward (0.07 HAC per key)**. This is how the keeper works.

Ordinary users can ignore this — the project's keeper renews automatically.

---

## 9. ⚠ Reading numbers (the easiest place to err)

### 9.1 hacds is just a count

**In this edition hacds is decimal 0 — 1 means one, with no fractions.**

Balances, pools, collateral, input fields all show the same number.

```
To send 70 hacds → enter 70
```

> **Different from the old edition!** The old version (#2000) was decimal 8, where
> you entered atoms and needed `7000000000` for 70. **Do not multiply by 1e8 here.**

### 9.2 HAC is also a count

Where the label says "(HAC)", enter 10 to deposit 10 HAC.

**Exception**: on the on-chain transfer page, HAC amounts use the `1:248` form
(`1:248` = 1 HAC). That is Hacash's amount notation; follow the format of the
default value in the field.

> `a:b` = a × 10^(b−248). So `5:249` = 50 HAC, not 5.0038.

### 9.3 Cheat sheet

| What you are doing | Unit to enter | Example |
|---|---|---|
| Add liquidity — HAC side | HAC | `1` |
| Add liquidity — hacds side | count | `33183372` |
| Swap — HAC in | HAC | `1` |
| Swap — hacds in | count | `100000000` |
| Add collateral | count | `100000000` |
| Borrow / repay | HAC | `0.5` |
| Send hacds | count | `100000000` |
| Send HAC (on-chain) | `value:mantissa` | `1:248` |

**One sentence**: hacds takes a count, HAC takes a HAC count (except on-chain
transfers).

### 9.4 Why this is easy to get wrong

HAC and hacds have different scales:

- **HAC** is zhu on-chain, 1 HAC = 1e8 zhu; interfaces use HAC
- **hacds** is the count on-chain, 1 = one

So `add_liquidity(hac_amt, ds_amt)` takes two parameters on different scales: zhu
on one side, hacds count on the other. This is the easiest place to make an
off-by-1e8 error — we did it ourselves on the first deposit.

---

## 10. Troubleshooting

### 10.1 Check the log first

Every operation's result and failure reason appear in the log area at the bottom.
**Errors are in plain language**: what went wrong, then what to do.

### 10.2 Common errors

| What you see | Meaning | What to do |
|---|---|---|
| Insufficient balance | Contract credit too low | Deposit on the "Funds" tab first |
| `resource gas limit exceeded` | Single bucket over limit | Split into multiple transactions; **raising gas_max does not help** |
| `compute gas limit exceeded` | Same | Split into multiple transactions |
| `CallNotExist(51)` | Contract has no such function | Admin functions were all removed; stop clicking them |
| `NotFindContract` | No contract at that address | Contract not deployed, or wrong address |
| `StorageNotActive` | Storage key expired | Renew on the "Tools" tab |
| `state changed` | On-chain state changed mid-flight | Retry |
| `sandbox_per_ip_concurrency_exceeded` | Concurrency exceeded | Wait a few seconds and retry (node allows 2 per IP) |
| Network error | Service unreachable | Check the node address and your network |

### 10.3 Broadcast succeeded but the balance did not change

Normal. Blocks take about 300 seconds. Wait and click "Refresh assets".

### 10.4 Text too small / too large

Use `−` / `+` at the top; `⟲` resets.

### 10.5 The three cards collapse

Click the `▾` at their top-right.

---

## 11. Security notes

1. **Keep the mnemonic and password offline.** No recovery, no support.
2. **Do not put your entire net worth in.** The contract cannot be upgraded; a
   bug found later cannot be fixed.
3. **The treasury key is a single point.** The contract has no withdrawal
   function, so nobody can take your assets; but protocol revenue in the treasury
   is controlled by the project's cold wallet — the only place you trust them.
4. **There is no admin.** Nobody can pause the contract, change parameters, or
   freeze your account. This can be verified directly from the function list.
5. **The team will never message you first.** Anyone asking you to "verify your
   wallet" or "send your mnemonic" is a scammer.
6. **During offline signing the private key never touches the network.** Ideally
   the cold machine is permanently disconnected.

---

## 12. Plain-language glossary

| Term | In plain words |
|---|---|
| **hacds** | The token you get for depositing diamonds; 1 point of diamond = 100 million |
| **HAC** | The Hacash main coin — money you can spend |
| **HACD** | Diamonds; deposit them to get hacds |
| **due / quota** | hacds recorded for you inside the contract, not yet claimed on-chain |
| **AMM** | Automated market making: one pool, anyone can trade, the price adjusts itself |
| **LP** | Liquidity provider — someone who puts money in the pool and earns fees |
| **Slippage** | How much your trade moves the price; large trades slip more |
| **Collateral ratio** | Collateral value ÷ debt; 200% is the borrow line, 160% the liquidation line |
| **Health** | The same as collateral ratio in another notation; 10000 = exactly on the line |
| **Liquidation** | You cannot repay, someone repays for you and takes part of your collateral |
| **Deep water** | Collateral ratio below 105%; the entire debt can be closed at once |
| **hcut** | The global shrinkage factor in extreme bad-debt scenarios; only decreases |
| **keeper** | Someone who renews the contract's storage rent for a reward; anyone can run one |
| **Reference price** | The smoothed price the contract uses for valuation, different from spot, manipulation-resistant |
| **Atomic transaction** | Several actions packaged into one transaction, all or nothing |

---

## 13. One-minute cheat sheet (keep it nearby)

```
Deposit diamonds:  HACD tab → load my diamonds → select (max 200) → bulk deposit
Claim hacds:       Funds tab → claim hacds → amount → broadcast
Swap:              Swap tab → pick direction → amount → build → broadcast
Add liquidity:     Liquidity tab → enter HAC side → hacds auto-balanced → build → broadcast
Borrow:            Lending tab → add collateral → borrow → build → broadcast
Transfer:          Transfer tab → pick type → address and amount → build → broadcast

Units:     hacds takes a count (1 means one)
           HAC takes a HAC count (on-chain transfers use 1:248)
           Do not multiply by 1e8!

Liquidation:  160% collateral ratio, no grace period
Health:       10000 = dangerous, > 10000 safe
Blocks:       about 300 seconds
```

---

*This document corresponds to the finalized version of `HacdsDeFi3000.fitsh`,
dated 2026-11-11.*
