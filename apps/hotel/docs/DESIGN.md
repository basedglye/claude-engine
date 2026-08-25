# GRAND FOYER — design bible

Status: adopted 2026-08-25. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
technical build and [docs/ROADMAP-HOTEL.md](../../../docs/ROADMAP-HOTEL.md)
for the phased plan.

## Context

GRAND FOYER is "the ultimate hotel sim": a browser game, hosted from this
Windows PC, where you physically walk a hotel in first person (third-person
toggle) and manage it **without a HUD or overhead view** — you walk to an
in-world computer and use a rendered retro OS. The reference points are
Papers Please's document-scrutiny loop crossed with Mad Games Tycoon 2's
management depth, played entirely from inside the building. You can occupy
any role (owner, front desk, housekeeping, maintenance, bellhop, kitchen,
security, manager); roles you don't play are run by NPC staff you hire. The
tone is funny and chaotic, and the game must be genuinely compulsive. Down
the road: multiplayer, where rival player hotels share a street and a finite
guest pool, and you can walk into a rival's hotel to spy on and sabotage
them.

Built on ClaudeEngine (`C:\ClaudeGame\claude-engine`) as `apps/hotel` plus
new engine packages, not a standalone repo — the deterministic sim kernel,
netcode, auth, event-sourced persistence, and headless harness already exist
and are reviewed, and the multiplayer/PvP endgame is exactly what that stack
is for. Art direction is hybrid low-poly procedural interiors with PS1-era
lo-fi textures, 3D, first person with a third-person toggle. Vertical slice 1
is "One-Man Show": you are the owner *and* the only employee — you work the
front desk *and* have the full owner's terminal, and the payoff beat is
earning enough to hire a clerk who replaces you at the desk.

## 1. Pillars

1. **You are *in* the hotel.** Every management verb is a physical act —
   there is no menu standing in for the building.
2. **Every job is a real game with a skill ceiling.** A role isn't a button
   you press; it's a minigame someone could get good at.
3. **Chaos is content.** Systems collide into slapstick; failure is funny
   and recoverable, never a dead end.
4. **Delegation *is* the progression.** The arc is going from doing
   everything yourself to *choosing* what to do.
5. **Deterministic to the bone.** Every disaster is a shareable seed plus a
   command log — nothing that goes wrong is unreproducible.

## 2. The three loops

**Shift (5–15 min).** The desk queue under visible pressure: match ID to
reservation, spot fraud, assign rooms, upsell, defuse complaints. Outcomes
are graded.

**Day (30–60 min).** Morning checkout rush, a midday maintenance window, an
evening check-in rush, and then the **night audit** at the terminal, which
tallies the day and *forecasts tomorrow's threats* ("3 VIPs arriving, boiler
at 12%"). The audit is the session's ritual close, the save point, and the
"one more day" hook.

**Campaign (10–40 h).** A 1-star flophouse grows into a 5-star tower. Star
rating gates floors, amenities, roles, guest tiers, and eventually the
street.

## 3. Roles as first-person minigames

Each role is a distinct first-person verb set with a real ceiling. Playing a
role earns role XP *and* unlocks better training for staff in it — you can't
teach what you can't do yourself.

| Role | Core verb set |
|---|---|
| Front desk | Fraud-spotting under queue pressure |
| Housekeeping | Route + cart + mess triage |
| Maintenance | Diagnose before cascade |
| Bellhop | Luggage stacking, speed routes |
| Kitchen | Multi-ticket juggling |
| Security | Behaviour reads; later, catching spies |
| Manager | Presence is a literal aura buff on nearby staff |
| Owner | The terminal — non-delegable |

## 4. The diegetic computer — HOTELSOFT '95

A retro DOS/Win3.1 shell running on terminal props; app availability depends
on the terminal's location and your current role.

| App | Purpose |
|---|---|
| RESERVA | Bookings, arrivals, room assignment |
| LEDGER | Finance, night audit |
| PRICER | Rates plus a deliberately fuzzy demand graph that sharpens with upgrades |
| STAFF | Schedules, wages, morale — résumés print physically and interviews happen in person |
| MAILBOX | Complaints, vendor spam, plot hooks, rival taunts |
| PURCHASE | Orders arrive physically at the loading dock |
| CCTV | Security camera feeds |
| BLUEPRINT | Build mode |
| STREETVIEW | Rival intel (multiplayer) |

**Building with no overhead view.** BLUEPRINT shows a 2D floorplan *on the
screen* — a floorplan is diegetic, not a break of the no-HUD rule. You mark
changes and they manifest as construction: taped-off zones, contractor NPCs,
noise complaints, a walk-through sign-off. Furniture you place yourself,
first person, or you pay contractors from the plan.

*Rejected: first-person wand-building* — too fiddly for whole-floor
renovation.

**What lives where.** The PC handles what a 1990s hotel would actually
computerize. Paper and physical objects carry everything else: IDs,
reservation slips, résumés, keys, letters, inspection reports — the tactile
Papers-Please layer the game is built around. A late-unlock pager gives
one-line push alerts so you aren't chained to the desk once you've earned
some slack.

## 5. Comedy and chaos

Comedy is systemic, not scripted: readable systems plus physicality plus
escalation. A leak becomes a puddle becomes a running bellhop's pratfall
becomes launched luggage becomes a suitcase avalanche onto the health
inspector. Guest archetypes compose traits — the Influencer, the Cryptid
Enthusiast, the Sleepwalker, the Fake VIP, the Family of Nine, the Rock Band,
the Emotional-Support Goose owner, the Extremely Normal Man who is obviously
a spy. Bankruptcy sends a repo manager NPC to follow you around rather than
ending in a game-over screen. Mischief is affordable and self-balancing — you
can carry nearly any prop, wear lost-and-found items, use the PA, set
per-room thermostats, and the sim reviews you for it rather than blocking it.

## 6. Progression, gamification and the ethical line

Role XP and mastery perks sit under a star rating as the macro gate. Per-
audience reputation makes specialisation a real strategy. Contracts
(conferences, film crews, health inspections) are Papers Please in reverse —
*you're* the one being scrutinised. Each day offers three sim-derived
objectives, plus a decaying no-penalty "buzz" bonus for consecutive
profitable days. Prestige lets you sell up, keep your mastery, and start on a
bigger lot. Deterministic weekly seed challenges produce leaderboards that
are cheat-checkable *by replay*.

**Explicitly avoided** (research-backed dark patterns):

- Login-punishment streaks
- Real-time waits
- Opaque meta-currency
- Variable-ratio reward schedules
- Notification spam
- Idle "number goes up" progress while the tab is closed

The stated test for any engagement mechanic: it must be transparent,
proportionate, and driven by simulation-intrinsic feedback — never by
withholding information or punishing absence.

Three further design rulings came out of the architecture review and belong
here as design decisions, not implementation notes:

**Depth escalation for the terminal loop.** Internet Cafe Simulator is the
cautionary precedent: "walk to a computer to manage" collapses into busywork
once learned. Papers Please survives because its rule-sets escalate week
over week. So each star tier introduces new mandatory desk checks — ID
cross-reference, loyalty tiers, corporate billing codes, blacklist bulletins
delivered via MAILBOX — driven by the RESERVA rule table. Guest archetypes
are content; **escalating verification rules are the difficulty curve.**

**Pressure vs zen, declared per activity.** These are different,
incompatible-by-default compulsion mechanisms, and every role minigame must
declare which one it is. Desk work and the night audit are a *pressure*
loop. Housekeeping and maintenance/repair are a *zen completion* loop — no
per-room timer, a visible dirt-reveal progress, and consequences only at day
granularity.

**Meta-progression is a scoped feature, not a vibe.** Two Point Hospital's
documented roughly 12-hour fatigue comes from re-doing the setup ritual each
run. Prestige/mastery is defined explicitly as *setup-ritual compression*:
carried-over unlocked HOTELSOFT apps, re-hirable staff, starting layouts —
and it is audited against the dark-pattern list above (the weekly seed
challenge is specified as no-penalty, no-streak).

## 7. Economy

**Revenue:** room-nights, F&B, upsells, tips (personal), contracts,
lost-and-found auctions.

**Costs:** wages, supplies, utilities (which scale with occupancy *and*
thermostat mischief), maintenance, interest, marketing.

**Demand:** a city guest pool broken out per audience segment. Your capture
is a function of price versus segment willingness, segment reputation,
marketing, stars, and events.

**Staff:** each has a wage, skill, and quirk — every hire has a flaw — plus
morale. Quitting is telegraphed by résumés appearing in the office printer,
never a surprise.

**Failure spiral:** debt leads to a repo manager, then repossession in
*reverse unlock order* — never the front desk. The floor is a recoverable
1-star one-man show; you can always claw back from the bottom.

## 8. Multiplayer and PvP vision

A **street** holds 4–8 player hotels inside a city, on one authoritative
server sim per street. The street ticks only while at least one member is
online; offline hotels run on NPC autopilot, so your staff quality *is* your
offline defence.

*Rejected: a persistent 24/7 sim* — too much hosting burden for a
friends-hosted game.

Competition runs through price wars, amenity races, staff poaching, and
review warfare. Espionage is physical: you walk in as a guest and see only
what a guest can see (the lobby rate board, queue length, room quality if
you book). Sabotage is likewise physical: noise, breakage, planting a fake
cockroach, tampering with an unwatched terminal. Counter-security runs
through CCTV, keycards, a security suspicion AI, and **replay forensics** —
deterministic replay makes "review the footage after an incident" nearly
free.

Griefing controls: sabotage requires physical presence and carries risk
(getting caught means fines, street-wide reputation loss, and the victim
receiving your footage), per-day damage caps apply, street tiers are opt-in
(Cozy = espionage off, Cutthroat = full PvP), and there is **no destruction
of progress** — builds break and get repaired, never deleted.
