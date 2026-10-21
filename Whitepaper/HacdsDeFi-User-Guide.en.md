# HacdsDeFi User Guide

2026-10-21　For wallet version 0.1.0 (Windows 64-bit)

## Who this guide is for

Anyone who has the wallet, has opened it for the first time, and does not know where to click.

It assumes you know nothing about contracts or the HVM, and you do not need to. By the end you should be able to do it yourself: install, create a wallet, swap diamonds for hacds, trade in the pool, borrow against collateral, and send coins to someone else.

Every place money is involved states the unit clearly. **This is the easiest thing to get wrong — please read section 9.**

---

## 1. Three things to prepare

**A Windows PC** (64-bit). The wallet is a desktop application; there is no web version and no mobile version (the Android build is in progress).

**One of the two files**: `HacdsDeFi-Setup-0.1.0-x64.exe` is the installer — double-click and install. `HacdsDeFi-0.1.0-x64.exe` is portable — double-click and it runs. Either one.

**A connection to the servers.** The wallet does not store chain data itself; it talks to three services:

| Service | Address | What it does |
|---|---|---|
| Node | `43.251.101.101:8082` | Balances, broadcasting transactions |
| Oracle | `43.251.101.101:8123` | Issues diamond scoring certificates (needed to swap for hacds) |
| Indexer | `43.251.101.101:8124` | Ledger for lending liquidation (optional) |

These are already filled in. As long as the network is up, nothing needs changing. If you switch servers, change them at the top.

---

## 2. Opening it for the first time

The top row looks like this:

```
[Node] [Oracle] [Contract] [Indexer] [Save] [Check]     [−] 100% [+] [⟲]   [Language▾]
```

**First thing: click "Check".**

Then look at the log area below. Two lines should appear:

- `Node OK, height 79xxxx`
- `Oracle OK, 1H3sFZ53…`

If both are OK, the network is reachable and you can carry on. If something fails, see section 10.

The `100%` on the right is UI zoom; if the text is small, click `+`. The dropdown at the far right switches language (简体中文 / English / Türkçe).

---

## 3. Creating a wallet (or importing one)

At this point the middle shows "Wallet locked", with a row of buttons:

```
Wallet locked   [Create wallet] [Import wallet] [Open wallet file…] [Wallets] [Use external key file]
```

### 3.1 New users: create a wallet

Click "Create wallet" and fill in two things:

- **Password**: set one. This password protects your wallet file; if you lose it, you cannot open it again.
- **Label** (optional): for example "Main wallet".

Confirm, and the wallet is created. The address appears at the top.

### 3.2 Existing wallets: three ways to import

| Your situation | Which button |
|---|---|
| You have a 64-character private key (a hex string) | "Import wallet" |
| You have a keystore file you saved earlier | "Open wallet file…" |
| The private key is a file and you do not want to import it | "Use external key file" |

Once imported it appears in the account area the same way.

### 3.3 Managing several wallets

Click "Wallets" to see every wallet's address, label and balance. You can open, rename and delete them.

**There is a shortcut for switching**: click the green address at the top and a list pops up. Pick one to switch to it (you will be asked for the password). You do not have to go into "Wallets" first.

---

## 4. What you see after unlocking

The top changes to:

```
🔓 1You…Addr   [Admin]   [Refresh] [Export key] [Lock / Exit]
```

**"Refresh"**: chain data does not update by itself. Click it whenever you want the latest balances.

**"Lock / Exit"**: remember to click it when you are done. Locking clears the private key from memory, so someone who picks up the computer cannot move your funds.

Below is the row of tabs — everything you can do:

```
Swap / Deposit | AMM & Liquidity | Lending | Transfers | HACD Gallery | Read-only
Liquidation | Atomic tx | Offline Sign
```

The "Admin" tab only appears for the contract admin. Ordinary users do not have it — ignore it.

---

## 5. Reading the three cards on the home screen

After unlocking there are three cards at the top. **Understand these three and the rest follows.**

### 5.1 Assets

| Shown | What it means |
|---|---|
| **HAC** | How much HAC you hold on chain |
| **HACD diamonds** | How many diamonds you hold |
| **Expected hacds** | Roughly how many hacds those diamonds would fetch if swapped |
| **Pending hacds** | The diamonds are already deposited in the contract; this is what the contract owes you (a booked figure) |
| **Held hacds** | hacds already claimed and freely transferable |
| **Contract HAC points** | HAC you deposited into the contract (the balance used for swapping and lending) |

For hacds, just remember this line:

```
you hold diamonds  →(deposit)→  contract owes you (pending)  →(claim)→  hacds actually in hand
```

**"Expected" and "Held" are two different things.** Do not mix them up. The first is an estimate; the second is money you can spend.

### 5.2 Protocol status

How much is in the pool, what share you own, and your lending position. Day to day you mainly look at:

- **Pool HAC / Pool hacds**: the size of the pool, which sets the swap price
- **Pool price**: how much HAC one hacds is worth right now
- **My LP / My debt / My collateral**: yours

### 5.3 Loan status

**This card exists to save you from trial and error.** It always shows:

- Your debt, your collateral, and what that collateral is worth in HAC
- **My max borrow** — how much you can still borrow right now
- Liquidation state: Safe / Liquidatable / No debt

**Look at this card before borrowing** and you will not have to learn by failing.

---

## 6. Every transaction is the same five steps

Whatever page you are on and whatever you are doing, the flow is identical:

```
Fill parameters  →  [Build transaction]  →  preview appears  →  [Verify]  →  [Broadcast]
```

**① Build transaction**: signed locally. Nothing is spent yet and nothing goes on chain.

**② Preview area**: a panel appears with several buttons:

| Button | What it does |
|---|---|
| **Copy hex** | Copies the raw transaction |
| **Save…** | Saves it to a file |
| **Verify** | Asks the node whether the transaction format is valid (needs the network) |
| **Translate** | Asks the node to explain in plain words what the transaction does |
| **Broadcast** | Actually sends it |

**③ Strongly recommended: click "Translate" first.** It lists what the transaction does in plain language, e.g. "Transfer 1 HAC from … to …". Confirm it is right before broadcasting.

**④ After broadcast** the log shows success and the transaction hash.

**⑤ Wait for a block.** Hacash produces a block roughly every **5 minutes**. A successful broadcast only means it entered the pending queue — **it only takes effect at the next block**. So if you click "Refresh" and the numbers have not changed, that is normal. The wallet automatically refreshes again after 15, 45, 90, 180 and 320 seconds.

---

## 7. How to do the common things

### 7.1 Swap diamonds for hacds (most common)

Go to the **"Swap / Deposit"** page and find **"HACD → hacds (deposit)"**.

1. In "Diamond names (comma-separated)" enter the diamond names, comma-separated, e.g. `MVUUBA,HYXYHY`
2. Click "Build transaction" → "Translate" to check → "Broadcast"

**⚠ One diamond per transaction, maximum.**

This is not a software limit; it is a hard limit on chain. Verifying each diamond's certificate requires recomputing its score, which costs about 3,000 units of compute resource, and a transaction's resource cap is 6,100. Two diamonds come to 6,101 — just over — and the transaction fails outright.

**To deposit several at once**: go to the **"HACD Gallery"** page, select several, and click "Batch deposit" — the wallet splits them into one transaction per diamond and broadcasts them one by one. Once deposited, the hacds are recorded under "Pending hacds"; they are not in your hands yet.

### 7.2 Claiming hacds

Still on the **"Swap / Deposit"** page, find **"Claim hacds (contract → me)"**.

Enter the amount (**the unit is atoms**, see section 9), then build, translate, broadcast.

Afterwards "Held hacds" increases. Only then are the hacds freely transferable.

### 7.3 Depositing HAC into the contract / withdrawing it

- **"Deposit HAC (HAC → contract, credits points)"**: sends HAC from your wallet into the contract, where it is recorded as "HAC points". **AMM swapping and lending both use this balance**, so deposit first if you want to use those.
- **"Withdraw HAC (contract → me)"**: moves the points back to on-chain HAC.

For the amount, **the unit is HAC** — type `10` for 10 HAC.

### 7.4 Swapping in the pool (AMM)

Go to the **"AMM & Liquidity"** page.

**HAC → hacds**:
- Fill in "HAC points in (HAC)" and "Min out (atoms, 0 = no limit)"
- The panel below immediately shows how much you would get, the current pool price, and the fee
- If it looks good, build and broadcast

**hacds → HAC**: same idea, enter the hacds you are putting in (atoms) and the minimum out (HAC).

**"Min out" is slippage protection.** Entering 0 means no limit. If the price moves too much while the swap is happening and what you actually receive would be less than the number you entered, the transaction fails automatically (you do not lose money). **Enter a floor you can accept rather than 0.**

### 7.5 Adding liquidity to earn fees

Go to the **"AMM & Liquidity"** page and find **"Add liquidity"**.

Adding liquidity means putting both HAC and hacds into the pool at the same time in exchange for LP shares, which then earn a cut of the fees.

**It is simple to use: fill in only one side and the wallet computes the other for you.**

- Enter an amount in "HAC side (HAC)" and the hacds side is filled in immediately with the matching amount
- Entering hacds works the same way in reverse

**Why it is computed automatically**: the contract requires the ratio of the two to match the pool. If the ratio is off, the side you over-supplied **earns you no shares at all — it is simply donated to the pool**. So the wallet forces them into line.

After filling in, the panel below shows "Estimated LP shares: X". If the two sides are not proportional (for example if you edited one manually), a warning appears in red and tells you what the number should be.

**When the pool holds neither HAC nor hacds** (the first deposit) it is the exception: there is no ratio to match, you set both sides, and the shares are `√(HAC × hacds)`.

**Removing liquidity**: enter the LP shares to burn and both assets come back to you in proportion.

**Claiming LP rewards**: click "Claim LP rewards" to move accumulated fees into your balance. Not clicking does not lose them.

### 7.6 Borrowing against collateral

Go to the **"Lending"** page. **The order matters: collateral first, then borrow.**

**① Add collateral**

In the "Add collateral" card, enter the hacds amount (**the unit is atoms**).

Below it tells you, live: what this collateral is worth in HAC, and how much you can borrow in total afterwards.

**② Borrow HAC**

In the "Borrow HAC" card, enter how much you want (**the unit is HAC**).

Below it shows, live:
- Your current max borrow
- How much collateral this loan needs (`≥ X atoms`)
- Whether it is enough (✔ or ✘)

**If it shows ✘ and you submit anyway, it will fail with an error.** That is why you look at the prompt first.

**③ Repaying**

Enter the amount in the "Repay" card and make sure the HAC points are ready. Once repaid, the collateral is automatically released.

**About interest**: the rate is 5% APR, but the UI does not show separately how much interest you owe — the contract folds it in. **It settles on chain when you repay; just repay the amount the wallet shows.**

**About liquidation**: if the value of your collateral falls too far (the collateral ratio drops below 200%), anyone can come and liquidate your position; your collateral is taken and the liquidator gets a bonus. **Watch the liquidation state on the "Loan status" card on the home screen** — if it says "Safe", you are fine.

### 7.7 Sending coins to someone else

Go to the **"Transfers"** page.

| What you want to send | Which item |
|---|---|
| HAC | "HAC transfer" — write the amount as `1:248`, meaning 1 HAC |
| hacds | "hacds to other" — enter the amount in **atoms** |
| hacds back to the contract | "hacds to contract" |
| Other assets (CARAT, HACP, …) | "Other asset transfer" — enter serial, address, amount |
| **HACD diamonds** | **"Send HACD" — enter diamond names and the recipient address** |

**"Send HACD"** (give diamonds to someone else): enter the diamond names (comma-separated, e.g. `KWTVSH,VHUSMI`) and the destination address.

- **Up to 200 diamonds in one transaction**, unlike "deposit to swap" which is one at a time — a peer-to-peer transfer does not go through the contract, so that compute limit does not apply
- The fee box is pre-filled with `0.0002 HAC × count`. **Clear it to pay less** — the wallet then estimates from the node's rate (a real saving when sending many)
- This item **does not touch the contract**; it simply moves your diamonds to the recipient's address

**For "Other asset transfer", the serial is just the plain number**, e.g. `1111`. Including `#` also works but is unnecessary.

### 7.8 The HACD Gallery: viewing diamonds, batch operations

On the **"HACD Gallery"** page the left side shows thumbnails of all your diamonds; click one to see details on the right (art, name, number, score, the five dimensions, inscriptions).

At the top you can filter by shape, style and minimum score.

**Batch operations**:
- Hold `Ctrl` and click a card to add one to the selection
- Hold `Shift` and click to select a range up to that card
- Then click "Batch deposit" or "Batch redeem"
- The wallet pops up a dialog saying "will split into N transactions, 1 diamond each"; confirm and it broadcasts them automatically

There is also a **"Copy names"** button that joins the selected diamond names with commas and copies them, handy for pasting elsewhere.

---

## 8. Advanced features (optional)

### 8.1 Read-only queries

The **"Read-only"** page has a row of buttons. Clicking one queries the chain — no transaction, no fee. It covers HAC points, pending hacds, pool price, pool reserves, your debt and collateral, LP shares and more.

Good for "I do not want to move money, I just want to see where things stand".

### 8.2 Atomic transactions

The **"Atomic tx"** page. You can merge several operations into **one** transaction: all succeed or all fail — never "half done".

How: on any operation card, click **"Add to combo"** to accumulate operations, then come to this page and click "Build atomic transaction".

**Note: merging cannot get around the one-diamond-per-transaction limit.** A transaction shares one compute budget, so two diamonds still overflow. Use the batch function for diamonds.

### 8.3 Offline signing (cold/hot split)

The **"Offline Sign"** page, for users who care about security.

The idea: **the private key never sits on a networked machine**.

1. On an online machine, fill in the operation and build an **unsigned** transaction body; save it to a file or note the text
2. Take it to an offline machine (airplane mode, network cable unplugged), paste it on this page, and click "Sign unsigned body with current wallet"
3. Take the signed transaction text back to the online machine and click "Broadcast signed transaction"

That way the machine holding the private key never touches a network end to end. Hacash transactions have no expiry, so signing offline and broadcasting days later is fine.

**Before signing, use "Verify unsigned body" and "Translate transaction"** to confirm the transaction is the one you intended.

### 8.4 Liquidation / settlement

The **"Liquidation"** page has three blocks:

1. **My LP rewards** — settle in one click
2. **Treasury sweep** — move accumulated fees to the treasury
3. **Liquidation console** — lists every liquidatable position; anyone can execute, and there is a bonus

The first two concern ordinary users. The third is for advanced users: **liquidating someone else's position earns a bonus**, but you judge the risk yourself.

Clicking "Sync ledger" pulls data from the indexer (without an indexer it scans blocks locally, which is much slower).

---

## 9. ⚠ Reading the numbers (the section most likely to save you money)

**hacds and HAC use completely different units. Getting it wrong means being off by a factor of one hundred million.**

### 9.1 hacds is in atoms

The smallest unit of hacds is the **atom**. In the wallet, **every hacds figure is in atoms** — balances, pools, input boxes, all of it.

```
1 hacds = 100,000,000 atoms
```

So the default value `100000000` you see in an input box is **1 hacds**.

**Never type the count.** For example, to send 70 hacds you must not type `70` — that is 70 atoms, less than a millionth of one hacds. You type `7000000000`.

**How to remember**: if the input label says `(atoms)`, enter atoms. If it says `(HAC)`, enter the HAC count directly.

### 9.2 HAC takes the count directly

HAC is simple. Where the label says "(HAC)", type `10` to deposit 10 HAC.

**One exception**: on the Transfers page the HAC amount is written in the form `1:248` (`1:248` = 1 HAC). That is Hacash's amount notation — just follow the style of the input's default value.

### 9.3 Quick reference

| What you are doing | Unit to enter | Example |
|---|---|---|
| Add liquidity — HAC side | HAC | `1` |
| Add liquidity — hacds side | atoms | `33183372` |
| Swap — HAC in | HAC | `1` |
| Swap — hacds in | atoms | `100000000` |
| Add collateral | atoms | `100000000` |
| Borrow / repay | HAC | `0.5` |
| Send hacds | atoms | `100000000` |
| Send other assets | atoms | `100000000` |

---

## 10. When something goes wrong

### 10.1 Look at the log area first

The result of every operation, and the reason for any failure, is printed in the log area at the bottom. **Error messages are localised**, stating what went wrong and then what to do.

### 10.2 Common errors

| What you see | What it means | What to do |
|---|---|---|
| **Node/oracle unreachable** | The service cannot be reached | Click "Check"; verify the network; verify the addresses at the top |
| **Address empty or malformed** | The address was not filled in fully | Copy the recipient address again, in full |
| **Address checksum wrong** | Characters were dropped when copying | Copy it again |
| **Insufficient balance** | The address has no HAC for the fee/gas | Send some HAC to that address |
| **resource gas bucket exceeded** | More than one diamond in one transaction | One per transaction, or just use "Batch deposit". **Raising gas does not help** |
| **Exceeds max borrow** | Borrowing without enough collateral | "Add collateral" first |
| **Pending hacds insufficient** | You are claiming more than the contract owes you | Check "Pending hacds" and stay under it |
| **Insufficient hacds for redemption, auto top-up failed** | Redeeming a diamond with too little quota; the contract tried to top up with HAC and could not | Deposit HAC first, or swap for some hacds first |
| **Contract paused** | The admin paused the contract | Wait for it to resume; ask the operator |
| **State changed, please retry** | The chain changed in the meantime | Refresh and do it again |
| **Request timeout / server error** | The server is slow or temporarily unavailable | Wait and retry, or switch nodes |

### 10.3 Broadcast succeeded but the balance did not change

**Normal.** Wait for a block (about 5 minutes). The wallet refreshes automatically a few times; just wait.

### 10.4 The UI text is too small / too large

Adjust with `+` and `−` at the top; `⟲` restores 100%.

### 10.5 The three cards can be collapsed

Click the small triangle to the left of "Assets", "Protocol status" or "Loan status" to collapse that card and free up screen space for the operation area below.

---

## 11. Security notes

**Never tell anyone your password, and never show anyone the result of "Export key".** The private key is your entire balance — whoever has it can move everything.

**"Export key" displays the private key in plain text**, and the wallet asks for confirmation twice. After exporting, write it down offline. Do not screenshot it, do not put it in cloud storage.

**Click "Lock / Exit" when you are done.**

**Do not import your wallet on a shared computer.**

**On-chain transactions cannot be reversed.** Before broadcasting, always click "Translate" and check the recipient address and the amount. If you send it to the wrong place, nobody can get it back.

**Read the address before sending.** Prefer the copy button over typing it by hand.

---

## 12. Plain-language glossary

| Term | In plain words |
|---|---|
| **HAC** | The native coin of the main chain |
| **HACD** | Diamonds. They have value and can be swapped for hacds |
| **hacds** | The asset you get from diamonds; freely transferable, tradable, usable as collateral |
| **atoms** | The smallest unit of hacds; 1 hacds = 100 million atoms |
| **LP shares** | Your receipt for money placed in the pool; they earn a cut of the fees |
| **Pool / AMM** | A pot of funds that swaps automatically; the price comes from how much of each coin is in it |
| **Slippage protection** | The fill price cannot be worse than the floor you set, otherwise it cancels automatically |
| **Collateral ratio** | The relationship between what you borrowed and what you pledged; too low gets liquidated |
| **Liquidation** | When collateral is insufficient, someone else can force-sell it to repay the debt |
| **gas** | The compute resource an on-chain operation consumes, paid in HAC |
| **Broadcast** | Send the transaction to the chain |
| **Block** | A confirmation on chain, roughly every 5 minutes |
| **Cold wallet / offline signing** | The signing machine is not networked; the safest arrangement for a private key |
| **Oracle** | The service that scores diamonds; its signed certificate is needed to swap for hacds |
| **Indexer** | The background service that works out whose loans should be liquidated |

---

## 13. One-minute cheat sheet (keep it nearby)

```
Create wallet  → Create wallet → set a password
Check state    → click "Refresh"
Get hacds      → Swap/Deposit → HACD→hacds → one diamond per tx
Claim hacds    → Swap/Deposit → Claim hacds
Deposit HAC    → Swap/Deposit → Deposit HAC (do this before AMM/lending)
Swap           → AMM & Liquidity → fill one side → check the quote → broadcast
Add liquidity  → AMM & Liquidity → Add liquidity → fill one side, the other is automatic
Borrow         → Lending → "Add collateral" first → then "Borrow HAC"
Send coins     → Transfers
Every tx       → Build → Translate → Broadcast → wait 5 minutes

Units: hacds takes atoms (1 hacds = 100000000)
       HAC takes the count directly (10 means 10)
```
