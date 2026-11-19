# Mainnet Deployment Postmortem: How 10,000 Shares Were Locked Forever

> This is a real incident from the mainnet launch of HacdsDeFi #4000. All data comes from the actual on-chain state and
> from the records in the repository (whitepaper §5.2, the round-by-round reports in `安全审计/` (security audit)). It is written down because its cause is extremely typical:
> **one parameter, one wrongly written document, one blame that cannot be handed back.**

## 1. What the incident was

2026-11-18, the first round of mainnet deployment (#3000).

After the equity asset `HACDS-SHARE` (serial 3001, total supply 10,000 shares) finished issuing, this state appeared on-chain:

| Item | Value |
|---|---|
| On-chain 3001 balance of vault contract B | 10,000 shares |
| `sh:` share ledger of vault contract B | **0** |
| Consequence | `PermitAsset` requires a sufficient `sh:` balance before it will approve a transfer out → **always return 11** |

10,000 shares of equity, all of them landing under the contract address itself, while the contract's internal share ledger is empty.

The contract has 15 external functions, and **not one of them can initialize the `sh:` ledger**.
This is a deadlock. And the contract has no admin and cannot be upgraded — nobody can "fix it a bit", including the person who wrote it.

**Those 10,000 assets were locked forever on the spot.**

## 2. Root cause: who the `issuer` actually is

### The direct cause

When the equity asset was issued, the `issuer` parameter was filled in with **the address of the vault contract itself**.

Hacash's `AssetCreate` action works like this:

> **Mint the supply out of thin air, credit it directly to the `issuer` address, without going through any contract hook.**

This is the key. Contract B's `PermitAsset` logic originally required the `sh:` ledger balance to be ≥ the incoming amount before it would let anything through — but `AssetCreate` never goes through that hook at all. It simply wrote 10,000 shares onto that address. The contract's ledger knows nothing about it, and is still 0.

So:

- The assets are on-chain, visible, 10,000 shares
- The contract believes that party (itself) holds 0 shares
- Want to transfer out? `PermitAsset` checks the `sh:` balance → 0 → return 11

**On-chain holding and contract accounting diverged, for the first time, in a way that cannot be reconciled.**

### The deeper cause: the document itself was wrong

If this were only a slip of the hand during an operation, the story would be a trivial mistake.

The real root cause is here. The project's deployment parameter file `发行参数-正式.md` (issuance-parameters-final.md) says:

```
| **Contract address (issuer)** | **T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH** |
```

and also:

> `AssetCreate.issuer` must be the new contract address. Filling it in wrong will issue hacds under the voided old contract.

This file's own description of itself is — **"the sole basis for deployment parameters"**.

In other words: **follow the document, and you will make the error.**

The document understood `issuer` as "which contract manages this asset", whereas the actual meaning is
"whose address this batch of assets is minted onto".

In the overwhelming majority of scenarios these two happen to coincide, so this misunderstanding can lie dormant for a long time without surfacing.
Only when it meets a scenario that **requires the assets to be sent out and the holder to decide for themselves whether to stake** —
that is, equity — do they part ways.

### The lesson, in one sentence

> `issuer` answers the question **"where was this batch of assets born"**,
> not **"who ultimately manages this batch of assets"**.

For certificate-type assets that need to be staked into a contract, they must be issued to **an ordinary address that can transfer freely**,
and the holder then decides for themselves whether to stake.

**A vault contract never issues, and never holds, its own equity asset.**

## 3. Discovery and damage control

Once the incident came to light, one fact has to be stated first: **serials cannot be re-issued.**

If `state.asset(&serial)` exists, the request is rejected. The two numbers 3000 / 3001 are permanently occupied;
even though those 10,000 assets are locked and unusable, the numbers cannot be recovered.

So "fix" never existed as an action from the start. There was only one path:

### The approach: change the whole numbering scheme and start over

| Item | First round (voided) | Second round (current) |
|---|---|---|
| Asset serial | 3000 / 3001 | **4000 / 4001** |
| Contract A nonce | 2 | **5** |
| Contract B nonce | 3 | **4** |
| Contract A address | `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH` | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` |
| Contract B address | — | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` |

Both contracts were redeployed, the asset was re-issued, and `issuer` was changed to **the deployer address**
(`15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q`) — an ordinary address that can transfer freely.

Right after this issuance we verified immediately: 10,000 shares on-chain under the deployer, `get_shares` back to zero,
holders can freely transfer into the contract to stake. **The state is correct.**

### The cost

- gas for two contract deployments
- the cost of two asset issuances
- a batch of voided documents and screenshots
- and a permanent hole in the numbering: #3000 / #3001 are history from now on and will never be used again

This money was borne by the core developer alone.

## 4. Why the audits did not stop it

This is the section most worth reviewing.

Before launch the project ran 5 rounds of independent audit. The first three were 4 blockers, 2 blockers, and a fix review respectively.
Round 5 (2026-11-15) returned **No-Go**, on the grounds of three blockers.

**But not one round of audit found that `issuer` should be an ordinary address.**

The reason is not complicated:

1. **Audits look at code, not at parameter tables.** The contract logic itself is not wrong — `PermitAsset`
   requiring a sufficient `sh:` balance is a correct design. What was wrong was the input fed to it.
2. **The misunderstanding of what `issuer` means is not in the code, it is in the document.** There is not one line in the code that says
   "issuer should be an ordinary address", so a static read will never catch it.
3. **This error only surfaces under a particular sequence of operations.** Deploy → issue → attempt to transfer out:
   the first two steps both succeed, and only the third one blows up. And the audit stage never reached the third step.

One line of the round-5 audit's judgment was very accurate:

> The deployment artifacts currently on disk cannot be proven to come from the current source code, and the self-check script used to prove it discards all verification results in the critical branch.

What it was watching was the **verification chain**. What this incident exposed is another blind spot: **parameter semantics**.

Trustworthy code ≠ correct input.
The verification chain guarantees "this source code really did compile into this bytecode";
it cannot guarantee "the parameters you fed to this bytecode are correct".

## 5. What is genuinely valuable about this incident

### 1. Immutability cuts both ways

"Contract has no admin, cannot be upgraded" is an advantage in promotional language — nobody can take your money.

But in the context of an incident it is the same thing: **nobody can save your life.**

These two are not an "advantage" and a "disadvantage"; they are **the same coin**.
Once you make "nobody can change it" your core selling point, you have to accept "including yourself".

This is the deepest lesson of this incident. Even the person who wrote it pays the price for a single parameter mistake —
and that is precisely the proof of how absolute this mechanism is.

### 2. The "sole basis" in a document is the highest-risk point

A parameter file that calls itself the "sole basis", if it is wrong, will propagate its error to every execution
**systematically, indiscriminately, and without friction**.

That is more dangerous than a code bug — a code bug at least still has to meet a trigger condition,
whereas "follow the document" is wrong every single time.

**The phrase "sole basis" is an extremely high promise, and it needs an extremely high verification cost to support it.**
If you cannot live up to that promise, better to downgrade it to "reference", and mandate a line-by-line check against on-chain semantics before execution.

### 3. Lessons must be written into the product, not only into documents

What was done after the incident was not "be more careful next time", but:

- A complete record in whitepaper §5.2 (including the table, including the consequences, including the lessons)
- §5.3 devotes a paragraph specifically to it: *"why issuer is not the vault contract"*
- Chapter 9 of the operations manual, when discussing dividends, states explicitly that "staking is a transfer, not a deposit"
- The confirmation dialogs of all three wallet clients warn "this will transfer N shares into the vault contract"

**Put lessons where users see them, not only in the developer's memory.**

### 4. Disclosure after the fact is worth more than concealment

The project chose to make this incident fully public — including the 10,000 locked assets, all the gas borne by the project itself,
and the entire numbering scheme abandoned.

In the short term this is negative information. But:

- It proves that on-chain records are immutable (if you don't say it, others can still look it up)
- It proves the team's ability to handle it (change the numbers and start over, recovered within a week)
- It taught every user the real boundary of this asset mechanism

**In a system where "code is law", concealing an incident is itself the biggest credit risk.**

## 6. Timeline

| Date | Event |
|---|---|
| 2026-11-18 | First round of deployment (nonce 2/3), serial 3000/3001 |
| 2026-11-18 | Equity issued → 10,000 shares land under the contract address, `sh:` ledger is 0, deadlock confirmed |
| 2026-11-18 | Judged irremediable: serials cannot be re-issued, the contract has no admin |
| 2026-11-18 | Decision to change the whole numbering scheme: serial 4000/4001, contract nonce 5/4 |
| 2026-11-18 | Second round of deployment complete, asset issued to the deployer address, state verification passed |
| 2026-11-20 | Three client apps, 9 trilingual documents, and the official website all switched to #4000 |

From the incident happening to the new system running end to end, it was done within the same working day.

## 7. Closing

There is nothing technically sophisticated about this incident — no complex race condition, no hidden reentrancy,
no ingenious flaw in the economic model.

It was just one parameter filled in wrong.

But it confirmed three things for us:

1. **The correctness of documentation matters as much as the correctness of code**, and the former usually has nobody auditing it.
2. **Non-upgradability is a double-edged sword**; when making the "no admin" decision, you have to accept all of its consequences at the same time.
3. **On-chain incidents have no "rollback" option**, only "start over", and someone has to pay the price of starting over.

If it must be summarized in one sentence:

> **We spent a dozen-odd HAC and one numbering scheme to buy the precise definition of one word: issuer.**

It does not answer "who manages", only "who was born".

---

*Related documents: whitepaper §5.2 (incident record), §5.3 (equity tokenization and the issuer explanation),
`hacds_exchange/发行参数-正式.md` (issuance-parameters-final.md) (deployment parameters; note that its historical wording on issuer has been corrected following the incident),
`安全审计/主网部署清单-2026-11-18.md` (mainnet-deployment-checklist-2026-11-18.md) (execution record of the second round of deployment).*
