# Decision log

Why archmap is shaped the way it is — the arguments, the measurements, and the things that were
tried and rejected. `spec.md` is the *contract* (what archmap is and guarantees); this is the
*record* (how it got there, and what not to re-propose).

Newest first. Each entry states what was decided, what evidence decided it, and what would
count as grounds to revisit.

---

## 2026-08-27 — static edge discovery: closed, not deferred

**Decided:** the *discovery* half of edge-truth — finding relationships the code has and the map
denies — will not be built. This is a decision against, not a queue item.

**Evidence.** Every prior hold said "revisit once there is a real corpus to measure against."
`packages/bootstrap` shipped and the corpus does not materialise. Containers with more than 7
exports stay undrilled by design, so bootstrap emits:

| target | components emitted |
|---|---|
| Next.js app | 0 |
| CDK/Java repo | 0 |
| small TS monorepo | 2 |
| archmap itself | 7 |

A reconciler needs *pairs of grounded leaves inside one container*. These models barely contain
any. The condition the deferral was waiting on cannot be met by the thing meant to produce it.

Stacked on the three structural objections in `spec.md` §11 — circularity, the level carve-out
discarding the independently-authored edges, and incompatibility with `EDGE_NOT_LEAF` — the
honest record is closure.

**What would count as new information:** a genuinely independent source of declared edges, or
runtime evidence (OpenTelemetry spans, access logs). Re-deriving the same static measurements is
not new information — this has now been argued down twice.

**What survives:** *corroborating* an authored citation ("you cited `X`, but nothing in this
scope references `X`") without re-deriving a graph. A check on a claim, not a discovery engine.

---

## 2026-08-27 — bootstrap: the ≤7 drill rule is not arbitrary

**Decided:** a container with more than 7 exported symbols stays undrilled rather than emitting
a subset of its components.

**Why.** It follows from the fan-out cap in `spec.md` §5.2 (soft 7, hard 14). Drilling a
12-export container into 12 components emits a model that warns. Emitting an arbitrary 7 of the
12 would be the *deterministic layer* deciding which symbols are architecturally significant — a
semantic judgement that §2 reserves for the agent. An honest undrilled placeholder is the
truthful output.

**Also decided the same day:** a `start`/`serve` script is a deployability signal, promoted into
v1 from the v1.1 list. Measured: without it, the single-app archetype — a framework app with no
`bin`, no `Dockerfile` and no `apps/` prefix — produced a one-node model. `build`/`test` scripts
are deliberately *not* signals; they describe a library's toolchain.

---

## 2026-08-25 — the edge-truth deferral held; edge citations shipped instead

**Decided:** keep the 2026-06-25 deferral. Ship the *authored-claim* half instead.

**What was tried and failed.** An attempt to reverse the June deferral was tested against
measurement and lost. The reversal's central argument — that `packages/bootstrap` would produce
densely grounded components whose edges a static engine could verify — is false. Bootstrap's
≤7-export rule yields 3 containers and **1 component** on archmap, and `EDGE_NOT_LEAF` means a
drilled container cannot be an edge endpoint while an undrilled one has no symbols, so *every*
edge in a bootstrap-generated model is unverifiable by construction.

**What shipped:** edge citations (`spec.md` §9.1) — authored, falsifiable claims about where a
relationship is realized, checked by the existing resolver. No new package, no new dependency,
no new gate.

**Why a citation and not a `verify: "call" | "none"` flag.** A flag asserts a property of the
*checking process*, which nothing in the repo can contradict — an author who lied is
indistinguishable from a checker that is blind. It would also have been the first *authored
input to a gate* in a system where every other derived field exists precisely because authored
values drift. A citation asserts a property of the *code*, and the resolver can falsify it.

**Honest scope:** 3 of 5 edges machine-checked on archmap; the other 2 are `person` endpoints,
not call-verifiable at any level.

---

## 2026-06-25 — edge-truth deferred

**Decided:** do not build static edge-truth verification.

**Why.** A static MVP is mostly noise for this codebase — most architecture edges are deliberate
abstractions, not function calls (4 of 5 edges in `model.json` had no backing call) — and
`spec.md` §11's transport blind spot (HTTP, message bus, DI dispatch) guts the signal for the
polyglot target it is ostensibly for. The valuable form is runtime-backed and should be decided
against a real target system, not archmap itself.

This reasoning was challenged in August and **stood**. See the two entries above.

---

## Build order — status

1. **schema + validate + render** — the artifact chain. Shipped.
2. **resolve** — FQN identity, dual hash, the state machine, RegionAnchor, never-auto-bump,
   batched confirm (`--confirm`). Shipped.
3. **Decide node-freshness vs edge-truth** — decided; citations shipped, discovery closed.
4. **bootstrap** — the author-side on-ramp. Shipped 2026-08-27.

**The build order is complete.** What remains open is the deploy axis and non-JS/TS grounding.
Of those, other-language grounding is the one with measured demand: across the repos archmap was
tested against, four of seven are overwhelmingly Python and one has no JS/TS at all, so §10.6's
"polyglot is where it falls apart" is a live limitation, not a theoretical one. The deploy axis
is navigation rather than verification — `iac` anchors resolve as SKIPPED, so deploy nodes
cannot be drift-checked.
