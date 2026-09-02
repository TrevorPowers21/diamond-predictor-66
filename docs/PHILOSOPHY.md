# RSTR IQ — Philosophy

> **What this is.** The voice layer from `docs/rstr-agent-plan.md` §7a: *how RSTR IQ reasons through a
> call.* Not rules — `CLAUDE.md` holds rules. Not technical judgment — `docs/knowledge/` holds that.
> This is the business and product reasoning, so that anyone working here (or any agent working on
> their behalf) arrives at the same answer the founders would.
>
> **Source.** Mined from `RSTR_IQ_Master_Reference` (Internal, July 2026, living document), per the
> react-and-correct loop in `rstr-agent-plan.md` §5 — the agent drafts what it infers, Trevor
> corrects, and **the correction becomes the record.**
>
> **Confidence marking.** ✅ = stated in the master reference, often verbatim. ⚠️ = my inference from
> the pattern of decisions; **correct these first.** Every principle carries *what it protects
> against*, because that is what lets the reasoning extrapolate to cases nobody ruled on.

---

## 0. The one sentence

**RSTR IQ turns fragmented sources into intelligence somebody can act on today** — through software
that does the daily heavy lifting, and people who do the part a login can't.

✅ *"Software does the daily heavy lifting, our people do the parts a program can't get from a login
alone: hands-on capture, interpretation, and sitting across the table from a coach or a player."*

Every principle below is downstream of that sentence.

---

## 1. The problem is fragmentation, not absence

✅ *"Every program has data. Almost none of them have it aggregated, and almost none of them have
someone translating it into something a coach or a 19-year-old can act on that day. That gap is the
business."*

Nobody is short of numbers. They are short of one place where the numbers agree and mean something.
Administrators run *"a spreadsheet for the budget, a separate system for compliance, contracts tracked
in email and filing cabinets, and roster and scholarship decisions living in whoever's head made
them. None of it talks to any of it."*

**How to apply.** When evaluating a feature, ask whether it *consolidates* or *adds another place a
number lives.* A feature that creates a second home for the same fact is working against the thesis
even when it is individually useful.

⚠️ **This is the business statement of the engineering doctrine.** The 2026-09-01 defect class — *a
stored copy nobody recomputes* — is fragmentation appearing inside our own database. Six logins and a
filing cabinet, or six snapshot fields that disagree: the same failure, different scale. **We cannot
sell "one athlete record, every source" while our own record has four copies of WAR that drift.**

---

## 2. Never make a program standardize on our stack

✅ *"RSTR IQ doesn't require a program to standardize on a fixed set of tools. We work with each
program to ingest whatever data solutions they already use."* Tracking systems, biomechanics and
ground-force platforms, bat and swing sensors, movement capture, wearables, internal lab data — ✅
*"common examples, not a fixed or exhaustive list."*

**De-brand where the point is the capability, not the vendor.** The master reference names Blast
Motion, HitTrax, TrackMan-class tools only as *examples of a category.* The capability is
"ground-force capture" or "bat sensor data," and the vendor is an implementation detail.

**What it protects against.** Vendor names leaking into schema, UI copy, or logic turn a swappable
input into a hard dependency, and quietly narrow the addressable market to programs that already
bought that vendor. It also dates the product the moment a program switches.

**How to apply.** Model by capability. A column named for what the data *is* survives a vendor change;
a column named for who sold it does not.

---

## 3. Nothing is locked to a sport

✅ *"RSTR IQ has two avenues to opportunity, and neither is locked to a given sport."* Currently
delivering across ✅ *college baseball and basketball,* with ✅ *"the architecture built to expand into
other sports."*

**Separation is by use case, not by sport.** The product decomposes into channels (coach/admin,
player, advisory), workflows (1–7), and lanes (organizations, agents, facilities/parents) — **not**
into a baseball product and a basketball product. Basketball lives in a separate repo and database
today, but that is an operational fact, not the organizing principle.

**What it protects against.** Sport-shaped seams are the most expensive kind to remove later, because
they hide in vocabulary, not just code. "Pitcher" in a shared table is a sport assumption; "role" is
not.

⚠️ **How to apply.** Sport-specific belongs in the domain layer (a baseball WAR formula is legitimately
baseball). Sport-specific in the *platform* layer — auth, program scoping, ingestion, records,
budgets, the ERP — is a defect. When unsure which layer you're in, ask whether basketball would need
the same thing under a different name.

---

## 4. Always say which: built, in progress, or chasing

The master reference labels **every single bullet**: ✅ *"built"* · *"built, integration in progress"*
· *"in progress"* · *"in development"* · *"in the process of acquiring."* And it brackets its own
gaps rather than papering over them: ✅ *"[The admin and organization side of this lane still needs to
be fully mapped. Confident in the solution, but it has not been built out with the same depth as the
player-facing lanes.]"*

It also refuses to overclaim from its own evidence: ✅ *"The point of this table is not that there is
a feature for every month."*

**What it protects against.** A roadmap read as an inventory. Selling a login that doesn't exist. And
internally: assuming a thing is done because it was discussed.

**How to apply.** This is the same discipline as **FIXED vs DETECTED vs UNVERIFIED** in engineering,
and as ✅ *"Settled"* vs ✅ *"Open"* in Section 9's commercial model. Whatever the domain, the status
label is part of the claim, not decoration on it. **State what you did not check, unprompted.**

---

## 5. Deliverables must compound, never age

The competitive case is built on this. Maven Baseball charges ✅ *"$40,000 to $50,000 a year for two
static assessment binders, a deliverable that's out of date the day the season starts, with no
software underneath it so nothing compounds."* The RSTR IQ answer is ✅ *"a living part of the platform
rather than a document that ages the day it's delivered."*

Paradigm anchors the other end — ✅ *~$10,000/yr, software-only, no in-person capture.* RSTR IQ is ✅
*"the only offering with real on-site capture plus a software platform built around force and
biomechanics data."* **The position is the combination, not either half.**

**How to apply.** Ask of any output: *does this feed back into the platform, or does it terminate?*
An export that nothing reads again is a binder with better typography.

⚠️ Same test applies to internal artifacts. A findings doc nobody indexes ages exactly like a binder —
which is why the learnings files have an index and a supersession chain.

---

## 6. Don't rush a number

✅ *"Pricing is intentionally undecided. The near-term goal is reputation, not a rate card: get in
front of the right programs, over-deliver relative to both the binder model and the software-only
model, and let word of mouth in the industry set our position before a number is set."*

Revisit ✅ *"once a handful of engagements are run and there's a real cost basis for on-site time."*

**What it protects against.** Anchoring on a guess. A number set before there is a cost basis is very
hard to raise and reads as either desperate or unserious.

⚠️ **Generalized:** *an undecided decision, held deliberately and labeled as undecided, is a position —
not a gap.* This is the strongest single tell of how RSTR IQ reasons, and it recurs: standalone
advisory mechanics ✅ *"a live question, not a decision"*; the hitting solution needs ✅ *"a formal
assessment"* before it is sellable; the in-game layer's shape is ✅ *"the least defined piece."* Name
the open question precisely, say why it stays open, say what would close it. **Do not resolve it early
just to have it resolved** — and do not let it silently harden into a default by way of an
implementation detail.

---

## 7. Keep the layers distinct — especially the boring one

The ERP layer (Workflow 7) is ✅ *"the back-office layer: running the business of the program rather
than evaluating or developing players."* The boundary is drawn explicitly against Workflow 1: roster
administration is ✅ *"distinct from the evaluation and projection work in Workflow 1; that's deciding
who to pursue, this is administering the decisions once they're made."*

**Deciding vs. administering are different products** that happen to share a database. Competitive
strategy (Workflow 6) is likewise separated from athlete development (Workflows 3–5) — same data,
different orientation.

**What it protects against.** ERP creep — budget/compliance/contract concerns leaking into evaluation
surfaces, or projection logic leaking into administrative ones. Once mixed, neither can be sold,
priced, or reasoned about separately.

✅ But shared underneath: *"The ERP layer isn't a separate product bolted onto RSTR IQ; it runs on the
same data lake and the same per-athlete and per-program records."* **Separate at the layer, shared at
the record.**

---

## 8. The athlete app is not a smaller coach dashboard

✅ *"Built specifically for an 18 to 22 year old, not a scaled-down coach's dashboard."* The design
principle is stated once and absolutely: ✅ *"strip away the dense, coach-facing data tables. An
athlete should never have to interpret a spreadsheet to know what to work on today."*

Daily action items come ✅ *"drawn directly from their development plan rather than a static training
calendar."* Communication is ✅ *"tied to the same player record, rather than a separate messaging tool
disconnected from development data."*

**What it protects against.** Shipping the coach's view with a smaller font and calling it player-facing.

⚠️ **The general rule: build for the reader, from one record.** Same underlying truth, genuinely
different surface per audience — which is also why every surface must read the *same stored value*.
Different presentation is the goal; different numbers are the bug.

---

## 9. Say exactly how far a relationship goes

On NewtForce: ✅ *"RSTR IQ and NewtForce are separate, independent companies."* The partnership is an
interpretation layer for data NewtForce hardware collects on-site — ✅ *"That is the full extent of the
relationship between the two companies."*

**What it protects against.** Implied joint ventures. Ambiguity about who owns data, who owns the
client, and who is liable.

⚠️ **How to apply.** State scope in the positive *and* the negative. "This is what it is; this is the
full extent of it." The same precision belongs in IP terms — ✅ custom builds leave *"the IP owned by
the university once the build is complete"* — and in super-admin/cross-program boundaries, where
"who can see whose data" is the same question wearing different clothes.

---

## 10. Know the byproduct from the point

✅ *"A recruiting angle exists as a byproduct of this lane rather than the point of it."* The
go-to-market is stated singularly — drive players into facilities, collect data, present it back —
and ✅ *"Parents and players extract value through the facility relationship, not through a
direct-to-consumer model."*

**What it protects against.** Chasing an attractive side effect until it becomes the roadmap. A
byproduct that gets funded like a strategy quietly changes what company you are.

⚠️ **How to apply.** When a feature is justified mainly by a downstream effect, say so out loud and
keep it labeled a byproduct. Byproducts are welcome; they just don't get to set priority.

---

## 11. Sell toward the vision; don't wait to build it

✅ *"The company does not need to build the full vision to sell toward it."* The licensed platform and
custom development are ✅ *"the on-ramp."* The active department engagement is ✅ *"the proving ground
for the Program ERP vision and the model for future department-level and conference-level builds."*
Rollout is ✅ *"confirmed modules first... then the suggested modules as demand and capacity allow."*

**Paired with §4, this is not a licence to overclaim.** Sell toward the vision, label what exists
today. Both at once. The proving-ground engagement is real revenue *and* the template question is
still open — ✅ *"what generalizes cleanly to the next... build, and what was specific to the first."*

---

## 12. Name the binding constraint

✅ *"This is a heavy lift, and neither Will nor Trevor can be the full-time person running assessments
on the road while also running the rest of the business."* Therefore ✅ *"capacity is the binding
constraint... meaning it starts as a small, premium engagement rather than a scaled offering."*

The constraint drives the plan, not the other way around: hire a dedicated person and ✅ *"let them
build the advisory arm as their own operation inside the company"*; consider the facility-hub model
specifically to ease that constraint.

**What it protects against.** Plans that assume unlimited attention. Promising scale that the calendar
cannot support.

⚠️ **How to apply.** When something can't be done at the size implied, say which resource is binding
and what the honest smaller version is. Scaling work down is the decision-maker's call — but they can
only make it if the constraint is named.

---

## 13. Software build or hardware bet — decide, and say which

✅ *"The hitting solution is a software-side build, not a hardware bet. RSTR IQ is not waiting on new
force-based hitting hardware."* Before it becomes sellable it needs a formal assessment: ✅ *"what
biomechanical signal can actually be extracted without force data, whether it's credible next to the
pitching side, and what the RSTR IQ build looks like."*

**The pattern: refuse to be blocked on something you don't control, and be explicit about the
resulting asymmetry** rather than pretending the two sides are equally strong. Pitching has a clean
capture story; hitting does not, *yet*, and the doc says so.

⚠️ Generalizes past hardware: don't gate work on an external dependency you can't schedule. Build the
part you own, name the gap, and set the bar the gap has to clear before it ships.

---

## 14. Three groups, one underlying dataset

✅ *"RSTR IQ delivers value to three groups, and the same underlying data serves all three: athletic
administrations, coaches and decision-makers, and the players themselves."* Agents (Lane 2) are a
fourth reader, and the observed gap is that ✅ *"there is currently no structured solution like this in
the agent-player relationship space."*

Sharing is **permissioned and player-granted** in Lane 3 — a player can grant a trainer or facility
access ✅ *"even outside of their primary organization, with the player's permission."*

⚠️ **How to apply.** Every new reader is an RLS question before it is a UI question. "Who else can see
this, and who granted that?" gets answered before a surface is designed, not after. Program scoping by
`customer_team_id` is the mechanism; **player-granted access is a different mechanism** and should not
be bolted onto the program one.

---

## 15. Where the business reasoning and the engineering doctrine are the same reasoning

⚠️ **My strongest inference, and the one most worth correcting if wrong.** These were arrived at
independently — one from selling to programs, one from a night of debugging — and they agree:

| business principle | engineering doctrine |
|---|---|
| One athlete record, every source (§1) | ⭐ One save path owning every derived copy |
| A deliverable that ages the day it's delivered (§5) | A stored copy nobody recomputes |
| Always say built vs. in progress (§4) | FIXED vs DETECTED vs UNVERIFIED |
| Not locked to a sport (§3) | IDs over names; no hardcoded assumptions |
| Don't rush a number (§6) | Data-driven thresholds; empirical percentiles first |
| Same data, different surface per reader (§8) | Every surface reads the same stored value |
| State the full extent of a relationship (§9) | RLS scoping; backend-gated super-admin |
| Name the binding constraint (§12) | Report what you skipped, unprompted |

**If that mapping holds, it is the answer to "what is the consistent voice?"** — the voice is one set
of instincts applied at whatever altitude the question arrives at. A reviewer that has both halves can
tell a coach why a feature is scoped the way it is *and* tell a developer why their snapshot write is
going to drift, from the same reasoning.

---

## 17. A rule that only lives in prose is advisory

⚠️ **Added 2026-09-02, and unlike the rest of this file it was learned the expensive way rather than
mined from the master reference.**

While building the agent meant to catch exactly this, I produced five wrong conclusions in one
session. Not from missing knowledge — every rule I broke was already written down, in this file, in
`CLAUDE.md`, and in the learnings index, all loaded and all read.

**The failure was one thing, three times: measuring across a boundary the system is keyed on.**

| # | I grouped without | result |
|---|---|---|
| 1 | `division` | JUCO (0.1% reproduce) swamped D1 (97.8%) — reported ~60% and built a model theory on it. **This is cause C1 repeating.** |
| 2 | `updated_at` | stale rows looked like an implementation disagreement |
| 3 | `season` | 2026 and 2027 rows looked like duplicates — I recommended DELETING 7,255 legitimate season-2026 rows and called it the safe option |

Each time the missing column was one query away. `player_predictions` has a unique index naming all
five key columns; I never read it until pushed into the code.

**What this changes about the plan.** `rstr-agent-plan.md` calls the deterministic checks "the
mechanical floor" and the voice "the higher value." **That ordering is wrong.** The voice layer is the
part that degrades silently under momentum — a plausible pattern, wanting the finding to be
interesting, a narrative already half-written. Mechanical checks have no such failure mode.

⇒ **A rule that matters belongs in a script, not a sentence.** `division = 'D1'` in
`build-anchor-fixtures.ts` is worth more than the three documents that said the same thing in prose.
Anywhere the doctrine is only written down, treat it as advisory and assume it will be violated.

**Corollaries, each earned:**
- **Before any aggregate over a table, read its unique constraints.** If the grouping key does not
  contain one, either fix the grouping or state out loud why it does not.
- **A green gate plus a confident wrong narrative is the real failure mode.** The tests passed. CI
  would have passed. The commit was clean. `AGENT_PHASE_ONE_SCOPE.md` §2.2 anticipates this —
  *"anchors pass but the agent can't explain why the change was safe → treat as a failure"* — but the
  explanation was available and false. **This is why Tier 1 review is of the reasoning, not the diff.**
- **Escalate on the FIRST failure, not the fifth.** §5 of the scope doc already says an anchor failure
  means *report the hypothesis, human decides.* Investigating first and reporting a conclusion is how
  a hypothesis becomes a claim nobody asked for.
- **The correction came from one question** — *"make sure it isn't including JUCO."* Cheap to ask,
  and it unwound two hours. The cost of asking is seconds; the cost of guessing is a paying program
  seeing wrong numbers.

## 16. What's genuinely open (don't invent answers)

The master reference ends with ten open questions and means it. Carried here so nothing below gets
silently resolved by an implementation detail:

advisory hire profile · which programs and facilities go first · private facility hub model · advisory
standalone pricing · hitting assessment scope · in-game layer shape (pregame / live / postgame) · 3D
simulation engine acquisition timeline and terms · services inquiry scope · what generalizes from the
first custom build · ERP module prioritization.

⚠️ **Plus one I'd add from the engineering side:** removal-from-roster semantics are undefined, and
current behaviour is inertia rather than design ([[HANDOFF_2026_09_02]] item 5). That is the same
species as the ten above — an open question currently being answered by accident.

---

## ✍️ CORRECT ME FIRST

The ⚠️ lines are inference. In rough order of how much rests on them:

0. **§17 — "a rule that only lives in prose is advisory."** Not inference; it happened. But whether
   it should reorder the plan's mechanical-floor-vs-voice priority is a judgement call, and yours.
1. **§15 — the business/engineering mapping.** The whole "one voice" premise rests on it.
2. **§6 — "an undecided decision, held deliberately, is a position."** Am I reading the pricing stance
   as a general principle when it's specific to pricing?
3. **§3 — "sport-specific in the platform layer is a defect."** Is that the boundary, or too strict?
4. **§1 — snapshot drift framed as internal fragmentation.** Fair, or straining the analogy?
5. **§10 — "byproducts don't get to set priority."** Stated, or my gloss?
6. **§14 — player-granted access as a distinct mechanism** from program scoping. Is that the design
   intent or my assumption?

Corrections replace the inference and lose the ⚠️. **What's wrong here is more useful than what's
right** — a wrong guess pulls the real reasoning out faster than a blank page.
