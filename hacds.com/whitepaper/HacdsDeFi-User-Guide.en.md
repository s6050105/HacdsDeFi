# HacdsDeFi User Guide

2026-11-18　For PC wallet 0.4.4 / Android 0.2.3

> This document corresponds to contract #4000 (address
> `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`, hacds asset serial 4000,
> share asset serial 4001).
>
> **This edition removed the oracle, the scoring certificates, and the admin.**
> You no longer wait for any service to issue a certificate, and "the admin
> paused the contract" can never happen — that function does not exist in the
> contract at all.

---

## Who this guide is for

For anyone who has this wallet, opens it for the first time, and does not know
where to click.

Assume you know nothing about contracts or the HVM, and do not need to. After
reading, you should be able to do it all yourself: install, create a wallet,
turn diamonds into hacds, swap in the pool, borrow against collateral, and send
coins to someone else.

Every place an amount appears, the unit is stated. **This is the easiest place to make a mistake — please be sure to read §11.**

---

## 1. Three things to prepare

**A computer** (Windows 64-bit) **or an Android phone**.

| Platform | File | Notes |
|---|---|---|
| PC | `HacdsDeFi-Setup-0.4.4-x64.exe` | Installer, double-click to install |
| PC | `HacdsDeFi-0.4.4-x64.exe` | Portable, double-click to run |
| Android | `HacdsDeFi-0.2.3-arm64.apk` | Must allow "install from unknown sources" |

Pick one of the two PC builds. Phones must be arm64 (every mainstream device of
recent years).

**A working connection to the servers.** The wallet itself stores no chain data;
it connects to two services:

| Service | Address | What it does |
|---|---|---|
| Node | `node.hacds.com` | Check balances, broadcast transactions, read contract state |
| Indexer | `indexer.hacds.com` | The ledger used for lending liquidations (optional) |

Both addresses are already filled in. If the network works, nothing needs
changing. To switch them, edit them at the top.

> **Only two services now — the oracle is gone.** The old edition had one more
> service that issued scoring certificates for diamonds. That has been deleted
> entirely — the contract now reads diamond genes and scores them itself, with no
> off-chain step at all.

---

## 2. First launch

On PC, the top row looks like this:

```
[Node] [Indexer] [Contract] [Save] [Test]     [−] 100% [+] [⟲]   [Language▾]
```

**First thing: click "Test".**

Then look at the log area below. You should see `Node OK, height 79xxxx`.

If the node is unreachable, check your network first. **An unreachable indexer does not block you** — the liquidation page is just a little slower (it falls
back to scanning blocks locally).

---

## 3. Create a wallet (or import an existing one)

### 3.1 New users: create a wallet

Click "Create wallet" and set a password.

**At least 8 characters, and it cannot be recovered if lost.** The wallet file is
encrypted and stored on this machine; there is no "recovery" feature, no support
desk, no back door. Write it on paper — do not keep it only on the computer.

When creation finishes, it shows your address (starts with `1`, about 34
characters).

**Back it up immediately.** There are only **two** ways to recover a wallet:
export the keystore file (recommended — encrypted, needs your password) or
export the private key (plaintext, higher risk). There is no mnemonic and no
server-side backup — if the local wallet file is gone, the app was uninstalled,
and you never exported, the funds are unrecoverable.

### 3.2 Existing wallets: two import methods

| Method | When to use |
|---|---|
| Keystore file | **Recommended.** PC and Android are interchangeable; same format (`hacds-keystore v1`) |
| Private key | For legacy private keys, or when you just want a quick import (plaintext — keep it safe) |

> ⚠ This wallet **does not support mnemonics** (there is no 12-word recovery).
> If you manage assets with mnemonics, generate the wallet elsewhere and import
> its **private key** instead.

### 3.3 Managing multiple wallets

Click "Wallet manager" to see every wallet on this machine. Switching, renaming,
and deleting all happen here.

---

## 4. What you see after unlocking

The top has **seven tabs**, exactly the same as the web version:

```
[Swap] [Liquidity] [Lending] [HACD] [Transfer] [Funds] [Tools]
```

Below them, three persistent cards:

| Card | Content |
|---|---|
| Asset overview | HAC, number of HACDs, hacds balance, quota inside the contract |
| Protocol status | Reserves on both sides of the pool, reference price, borrowing utilization |
| Loan status | Your debt, collateral, health |

All three can be collapsed with the `▾` in their top-right corner.

---

## 5. How to read the three cards

### 5.1 Asset overview

| Item | Meaning |
|---|---|
| HAC | HAC in your wallet that you can spend directly |
| HACD | How many diamonds you hold |
| hacds (quota) | hacds on the books **inside the contract**, not yet claimed on-chain |
| hacds (on-chain) | The standard asset already sitting at your own address |

**Only the sum of the two hacds figures is everything you actually own.**

### 5.2 Protocol status

| Item | Meaning |
|---|---|
| Pool HAC / pool hacds | The reserves on both sides of the AMM pool |
| Reference price | The smoothed price the contract uses to value collateral for liquidation |
| Utilization | Lent out / available to lend; above 50% you cannot borrow more |

### 5.3 Loan status

**The health figure is the most important column:**

| Display | State | What happens |
|---|---|---|
| > 10000 | Safe | Nothing happens |
| = 10000 | Dangerous | Exactly on the liquidation line |
| < 10000 | Liquidatable | Anyone can liquidate you at any time |
| < 10500 | Deep water | The liquidator can take over (`DEEP_TRIGGER_BPS = 10500`) |
| < 9000 | Deep danger | The **entire debt** may be closed in one go (`DEEP_WATER_BPS = 9000`) |

**These two thresholds are not the same thing — do not mix them up:**

- **10500 (105%)** is a comparison of "collateral value / debt"; once triggered,
  the liquidator takes over at a 3% discount
- **9000 (90%)** is a "health" figure; below it, liquidation is no longer
  restricted to "only part of the debt" and the whole position can be closed in a
  single transaction

The constants in the contract are `DEEP_TRIGGER_BPS = 10500` and
`DEEP_WATER_BPS = 9000`; both exist.

**There is no grace period.** Below a 160% collateral ratio you can be
liquidated at any moment, with no advance notice.

---

## 6. Every transaction follows the same sequence

Whatever you do, the flow is the same:

```
Fill in parameters → click "Build transaction" → review → click "Broadcast" → wait for confirmation
```

**The preview area shows**: the action, byte size, fee, and signature digest.

**Three possible outcomes after broadcasting**:

| Outcome | Meaning |
|---|---|
| `ret:0` | It reached the mempool, **not yet on chain** |
| Confirmed | Balances will change |
| Error | Check the log; it explains the problem in plain language |

**Blocks take about 300 seconds.** A successful broadcast is not instant effect;
the wallet re-polls automatically a few times (15/45/90/180/320 seconds).

---

## 7. How to do the common operations

### 7.1 Turn diamonds into hacds (the most common operation)

1. Click the "HACD" tab
2. Click "Load my diamonds"
3. **Tick the diamonds you want to deposit** — you can tick many at once, up to 200
4. Click "Bulk deposit & convert"

**One transaction, one signature, up to 200 diamonds.** This is the biggest
change in this edition: the old version could only deposit one at a time.

The interface shows how many hacds you should expect: **1 point = 100 million hacds**.

> **Note**: what you get after depositing is a **quota (due) inside the contract**,
> not yet an on-chain asset. To get it into your on-chain wallet, see 7.2.

### 7.2 Claim your hacds

"Funds" tab → "Claim hacds" → enter the amount → build → broadcast.

**This is the step that actually moves hacds into your address.** Once claimed,
it is a standard on-chain asset that you can send to any wallet or exchange that
supports Hacash assets.

### 7.3 Deposit HAC into the contract / withdraw it

On the "Funds" tab:

| Operation | What it does |
|---|---|
| Deposit HAC | Wallet HAC → HAC credit inside the contract (used for adding liquidity, repaying) |
| Withdraw HAC | Credit inside the contract → wallet |
| Deposit hacds | On-chain hacds → quota inside the contract (used for adding liquidity, collateral) |
| Claim hacds | Quota inside the contract → on-chain |

**Keep the distinction**: what is inside the contract is "credit", what is
on-chain is "asset". They are not the same thing. AMM and lending operations both
work on the **inside-contract** portion.

### 7.4 Swap in the pool (AMM)

The "Swap" tab, two directions:

| Operation | What to enter |
|---|---|
| HAC → hacds | HAC in (unit: HAC) |
| hacds → HAC | hacds in (unit: count) |

After you type, the area below shows in real time **how much you will get** and
**the current pool price**.

**Slippage protection**: put the least amount you are willing to accept in
`min_out`; `0` = no limit. When the market is volatile, it is worth entering a
number so you are not front-run by someone else.

### 7.5 Add liquidity and earn fees

The "Liquidity" tab.

Enter the amount on the HAC side and **the hacds side is calculated automatically from the pool ratio**. This is to stop you from getting the ratio wrong and
giving your money away.

| Item | Notes |
|---|---|
| Fee split | **80% of trading fees go to LPs**, 20% to the vault |
| Redemption fee split | **80% of redemption fees also go to LPs** |
| Impermanent loss | Yes. This is inherent to every AMM |
| Credit risk | 30% of the HAC in the pool is lent out; in the worst case you lose that 30% |

**Withdrawing from the pool takes two steps**: first "Claim LP rewards", then
"Remove liquidity". The wallet splits it into two transactions for you; you click
once.

> Why split it? A single transaction runs into the mainnet `resource` bucket cap
> (6,102 > 6,100). This is a pit we hit in real testing; the contract cannot be
> changed, so it can only be split on the wallet side.

### 7.6 Borrow against collateral

The "Lending" tab.

1. First "Add collateral" — the collateral is the **hacds quota inside the contract**
2. Then "Borrow", at most half the collateral value

**Below the input boxes it shows in real time**: your current borrow limit, the
collateral this transaction needs, and the current collateral value. No
trial and error.

**The interest rate floats**: utilization 0% → 2%, 35% → 6%, 50% → 46%.

**If you cannot repay, you get liquidated.** No grace period. Suggestions:
- Do not borrow the maximum (borrowing 30%–40% is far more comfortable than
  borrowing to the limit)
- Top up your collateral once health gets near 150%
- Watch the health in the "Loan status" card; it uses **the same price** as
  on-chain liquidation

### 7.7 Send coins to someone else

The "Transfer" tab, four types:

| Type | Notes |
|---|---|
| Send HAC | On-chain HAC |
| Send hacds | On-chain hacds asset |
| Send HACD | Diamonds; several at once is fine |
| Send other asset | Enter serial + amount |

> The serial for hacds is **4000**, and for shares (HACDS-SHARE) it is **4001**.
> Do not put in the old 2000 / 3000 — those two sets of assets are void; the
> recipient cannot recognise any value in them, so the transfer is as good as
> wasted.

### 7.8 HACD tab: view diamonds, batch operations

The "HACD" tab has two halves, top and bottom:

**Top half: deposit**
- Load my diamonds → tick → bulk deposit
- Up to 200 per transaction

**Bottom half: redeem**
- Load pool diamonds → pick one → redeem
- **Redemption is one diamond at a time**

> Why can't redemption be batched? Redemption has to work out the
> "cherry-picking premium" for each diamond separately (high-scoring diamonds cost
> more), and if a batch operation fails halfway through, rollback logic is too
> risky in a contract that cannot be upgraded. The wallet splits your selection
> into several transactions for you; you click once.

---

## 8. Advanced features (you can use it without these)

### 8.1 Read-only query

"Tools" tab → "Read-only query". You can call any read-only function of the
contract directly and look at the return value. Very useful when troubleshooting.

### 8.2 Atomic transactions

Several actions are merged into one transaction: either all succeed or all fail.
The protocol cap is 200 actions.

### 8.3 Offline signing (cold/hot separation)

"Tools" tab → "Offline signing":

1. On the cold machine (a machine that is not online): fill in the parameters,
   build, sign
2. Output a QR code or a file
3. On the hot machine (the online machine): scan the code or read the file, then
   broadcast

**The private key never touches the network at any point.** Hacash transactions
have no nonce and no timestamp expiry, so a transaction signed offline stays valid
no matter how long you leave it before broadcasting.

### 8.4 Liquidation / settlement

"Tools" tab → "Liquidation". Lists every liquidatable address and its health.

There is money in liquidating: you repay someone else's debt and take collateral
worth "the amount repaid + 5%". A normal liquidation handles at most half of the
other party's debt at one time.

### 8.5 Renew storage keys (operations)

"Tools" tab → "Renew".

Hacash contract state has to pay rent, and keys expire. **Anyone can renew a key and earn a reward (0.07 HAC per key)**. That is how a keeper works.

Ordinary users can ignore this — the project's keeper renews automatically.

---

## 9. Vault dividends (a must-read if you hold shares)

If you hold **serial 4001 (HACDS-SHARE)**, the wallet automatically adds a
**"Vault dividends"** tab, highlighted in gold.

### 9.1 The single most important thing: holding ≠ dividends

**Just keeping 4001 in your wallet does not pay you dividends. You have to stake
it into contract B before interest starts accruing.**

Why is it designed this way? When user A transfers 4001 to user B, that action on
chain goes nowhere near the contract — the contract cannot see it. It has no way
to settle at "the instant of the sale", so the only option is to require you to
**stake actively**, which puts your shares into the contract's ledger
(`sh:<your address>`), and only then does the contract recognise them.

The tab makes the distinction clearly:

| Field | Meaning |
|---|---|
| Held in wallet | How many shares are still in your wallet |
| Staked (accruing) | The shares that actually take part in dividends |
| Not staked (not accruing) | Shares still in your wallet that **pay no dividends** |

**As long as "Not staked > 0", a prominent notice appears at the bottom of the tab**, telling you that this portion does not share in dividends, along with a
"Stake now" button.

### 9.2 Three steps

**① Stake**

Click "Stake now" → enter the number of shares → confirm.

⚠ The confirmation box tells you plainly: **this will move N shares into the
vault contract; once moved out they no longer show in your wallet balance, but
they still belong to you and you can unstake them at any time.**

This is a transfer, not a "deposit". The shares leave your wallet balance and
enter the contract's ledger. Ownership does not change.

**② Wait for dividends to accumulate**

Protocol revenue (the AMM fee share, the lending interest share, and so on) is
collected into vault contract B
(`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` — you can check its balance and
distribution history in any Hacash explorer):

```
Receive 100 HAC
  ├─ 20 HAC → rent reserve (used only to pay the keeper's storage rent)
  └─ 80 HAC → distributed to all stakers by share
```

Dividends are calculated by your share's proportion of the "total staked". The
more you stake, and the earlier you stake, the more you get.

**③ Claim and withdraw**

Click "Claim and withdraw" and it is done in one step:

```
claim()                  → settles the increment into your due ledger (the money is still in the contract)
TransferHacFromTo(B→you) → the money actually reaches your wallet
```

Both steps have to happen. **If you only click claim, the money is still in the
contract and your wallet balance will not change.**

⚠ **The "total claimable" figure in the tab does not change after claim** —
because the increment goes from "unsettled" to "settled, ready to withdraw"; the
total is the same. This is not a bug.

### 9.3 Unstake

To get your shares back, click "Unstake". The contract will:

1. First settle your dividends up to this moment
2. Then deduct the shares from the ledger
3. The 4001 returns to your wallet balance

The order cannot be reversed — settle first, then reduce the shares, so that not
a single unit of your dividends before exiting is lost.

### 9.4 Common misunderstandings

| What you might think | Reality |
|---|---|
| Holding 4001 earns dividends | ❌ You must stake |
| Once staked, the shares are gone | ❌ They are only moved into the contract ledger; you can unstake at any time |
| Clicking claim puts the money in your account | ❌ You still need the withdraw step |
| The number not changing after claim is a bug | ❌ It went from "unsettled" to "ready to withdraw" |
| If you do not claim, it expires | ❌ Dividends stay recorded in the contract and are never taken back |

### 9.5 Will you lose it if you forget to come and claim?

No. Dividends stay recorded in your `due:` ledger.

But there is one condition: **someone has to keep renewing the ledger key.** The
contract's storage keys are rented, and they are deleted when they expire. The
project's keeper renews them for you automatically (once every 347 days), so
under normal circumstances you do not need to worry about it.

If you want to be safer still, **come and click "Claim and withdraw" once in a while** — that action itself renews your key along the way.

---

## 10. Share transfer (OTC atomic transaction)

To sell 4001 to someone else, use the **"Share transfer"** area at the very
bottom of the "Vault dividends" tab.

### 10.1 Why two people have to sign

A single transaction contains both "you give the shares" and "he gives the
money", so both sides have to agree. Hacash's rule is that **the number of
signatures must equal the number of signers**, so:

```
You (the seller) build the transaction + sign
        ↓
    Send the transaction body to him (WeChat / email / QR code all work)
        ↓
He uses his own wallet to "translate" this transaction and see what is in it
        ↓
    He confirms it is correct + adds his signature
        ↓
      Broadcast; both sides' assets change at the same time
```

**The transaction either goes through completely or rolls back completely.**
"Gave the shares but did not get the money" cannot happen.

### 10.2 What the seller does

1. In the "Share transfer" area, choose "I am selling shares"
2. Enter the number of shares and the counterparty's address
3. Choose what you are paid in (up to 3 kinds: HAC / on-chain assets / HACD diamonds)
4. Click "Build transaction awaiting signature"
5. Click "Sign with my private key" → it says "not fully signed"; copy the
   transaction body and send it to him

### 10.3 What the buyer does (important)

**Look carefully first, then sign.** This section is the most critical part of
the whole feature.

1. Open "Verify someone else's transaction body" in the "Share transfer" area
2. Paste the transaction body the other side sent you
3. Click "Translate this transaction"
4. **Check every line**:
   - Is the amount under "You will pay" correct
   - Is the number of shares under "You will receive" correct
   - **Is the receiving address yours** (this line is highlighted; if it is not
     you, a red warning appears)
5. Once you have confirmed it, click "Add my signature to the counterparty's
   transaction body"
6. Once all signatures are in place it broadcasts automatically

⚠ **You are not allowed to sign without translating it first** — this is a hard
limit to prevent blind signing.

### 10.4 ⚠ The transaction body has no expiry

This is the point that needs the most attention:

**Once you have signed and handed the transaction body to the other side, this
transaction can be broadcast at any time, and it cannot be revoked.**

There is no "expiry time" field on chain. So:

- Only do OTC with people you trust completely
- If negotiations fall through, get the other side to destroy the transaction
  body immediately
- Do not sign just to "have a look first"

---

## 11. ⚠ How to read numbers (the easiest section to get wrong)

### 11.1 hacds is just a count

**In this edition hacds is decimal 0 — 1 means 1 piece, there are no fractions.**

Balances, the pool, collateral, and the input boxes all show the same number.

```
To send 70 hacds → enter 70 in the box
```

> **Different from the old edition!** The old version (#2000) was decimal 8, where
> the input box took atoms, and you had to enter `7000000000` to mean 70.
> **In this edition do not multiply by 1e8.**

### 11.2 HAC is also a count

Wherever the label says "(HAC)", to deposit 10 HAC just enter `10`.

**Exception**: on the on-chain transfer page, HAC amounts have to be written in
the `1:248` form (`1:248` = 1 HAC). That is Hacash's way of writing amounts; just
follow the style of the default value in the input box.

> `a:b` = a × 10^(b−248). So `5:249` = 50 HAC, not 5.0038.

### 11.3 Reference table

| What you are doing | Unit to enter | Example |
|---|---|---|
| Add liquidity — HAC side | HAC | `1` |
| Add liquidity — hacds side | count | **calculated automatically** from the pool ratio (not a fixed value) |
| Swap — HAC in | HAC | `1` |
| Swap — hacds in | count | `100000000` |
| Add collateral | count | `100000000` |
| Borrow / repay | HAC | `0.5` |
| Send hacds | count | `100000000` |
| Send HAC (on-chain) | `value:mantissa` | `1:248` |

**Remember one sentence**: hacds takes a count, HAC takes a HAC count (except for
on-chain transfers).

### 11.4 Why it is easy to get wrong

HAC and hacds have different scales:

- **HAC** is zhu on-chain, 1 HAC = 1e8 zhu; the interface uses HAC
- **hacds** is simply a count on-chain, 1 = 1 piece

So the two parameters of `add_liquidity(hac_amt, ds_amt)` are in different units:
one is zhu, the other is a hacds count. This is the easiest place to make an
off-by-1e8 error — we made it ourselves on the very first deposit.

---

## 12. What to do when something goes wrong

### 12.1 Look at the log area first

The result of every operation and the reason for every failure are printed in the
log area at the bottom. **Errors are in plain language**: first it says what the
problem is, then it gives a suggestion.

### 12.2 Common errors

| What you see | What it means | What to do |
|---|---|---|
| Insufficient balance | Not enough credit inside the contract | Go to the "Funds" tab and top up first |
| `resource gas limit exceeded` | A single bucket went over the gas limit | Split it into several transactions; **raising gas_max does not help** |
| `compute gas limit exceeded` | Same thing | Split it into several transactions |
| `CallNotExist(51)` | The contract has no such function | All admin functions have been deleted; stop clicking it |
| `NotFindContract` | There is no contract at that address | The address is wrong (this round's contract is `bw2sRC…`) |
| `StorageNotActive` | The storage key has expired | Go to the "Tools" tab and renew it |
| `state changed` | The on-chain state changed in the meantime | Retry |
| `sandbox_per_ip_concurrency_exceeded` | Concurrency limit exceeded | Wait a few seconds and retry (the node allows 2 concurrent per IP) |
| Network error | Cannot reach the service | Check the node address and your network |

### 12.3 Broadcast succeeded but the balance did not change

That is normal. Blocks take about 300 seconds. Wait a while and click "Refresh
assets".

### 12.4 The text is too small / too large

Adjust with `−` / `+` at the top; `⟲` resets it.

### 12.5 The three cards can be put away

Click the `▾` in their top-right corner.

---

## 13. Security notes

1. **Keep an exported keystore or private key offline, and remember the password.**
   There is no recovery feature and no support desk. This wallet has no mnemonic;
   if you lose the password and never exported, the funds are gone.
2. **Do not put your entire net worth in.** The contract cannot be upgraded; if a
   bug is found, it cannot be fixed.
3. **Holding of shares is the single point.** There is no withdrawal function in
   the contract, so no one can take your assets; vault revenue is distributed
   automatically according to staked shares (see §9), and the distribution is
   guaranteed by code, with no one able to interfere. But **all 10,000 units of
   4001 are currently held by the project, distributed by them** — this is the
   only place you need to trust them: however many shares they hold, that is how
   much dividend right they have.
4. **There is no admin.** Nobody can pause the contract, change parameters, or
   freeze your account. This can be verified directly from the function list.
5. **The official team will never message you first.** Anyone who asks you to
   "verify your wallet" or "send your mnemonic" is a scammer.
6. **When signing offline, the private key never touches the network.** The cold
   machine is best kept permanently disconnected.

---

## 14. Plain-language explanations of some terms

| Term | In plain words |
|---|---|
| **hacds** | The token you get after depositing diamonds into the contract; 1 point of diamond = 100 million |
| **HAC** | The Hacash main coin, the money you can spend |
| **HACD** | Diamonds; deposit them into the contract to get hacds |
| **due / quota** | hacds recorded for you on the contract's books, not yet claimed on-chain |
| **AMM** | Automated market making: one pool, anyone can come and swap, the price adjusts itself |
| **LP** | Liquidity provider — someone who puts money into the pool and earns fees |
| **Slippage** | How much your trade pushes the price; large trades have larger slippage |
| **Collateral ratio** | Collateral value ÷ debt; 200% is the borrowing line, 160% is the liquidation line |
| **Health** | Another way of writing the collateral ratio; 10000 = exactly on the liquidation line |
| **Liquidation** | You cannot repay, someone else repays for you and takes part of your collateral |
| **Deep water** | Collateral value has fallen below 105% of the debt (`DEEP_TRIGGER_BPS`); the liquidator can take over |
| **Deep danger** | Health has fallen below 9000; the debt can be closed in one go (`DEEP_WATER_BPS`) |
| **hcut** | The global shrinkage factor in extreme bad-debt situations; it only goes down, never up |
| **keeper** | Someone who automatically renews the contract's rent and gets a reward; anyone can run one |
| **Reference price** | The smoothed price the contract uses for valuation; different from the spot price, resistant to manipulation |
| **Atomic transaction** | Several operations packaged into one transaction, all succeed or all fail |

---

## 15. One-minute quick reference (keep it next to you)

```
Deposit diamonds:  HACD tab → load my diamonds → tick (max 200) → bulk deposit
Claim hacds:       Funds tab → claim hacds → enter amount → broadcast
Swap:              Swap tab → pick direction → enter amount → build → broadcast
Add liquidity:     Liquidity tab → enter HAC side → hacds auto-balanced → build → broadcast
Borrow:            Lending tab → add collateral → borrow → build → broadcast
Transfer:          Transfer tab → pick type → enter address and amount → build → broadcast

Units:     hacds takes a count (1 means 1 piece)
           HAC takes a HAC count (on-chain transfers use 1:248)
           Do not multiply by 1e8!

Liquidation line: 160% collateral ratio, no grace period
Health:           10000 = dangerous, > 10000 safe
Blocks:           about 300 seconds
```

---

*This document corresponds to the finalized version of `HacdsDeFi3000.fitsh`, second mainnet deployment (2026-11-18).*
