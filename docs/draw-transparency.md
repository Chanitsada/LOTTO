# Optional feature: transparent drawing

This feature comes from the project brief. Finish the database, login, checkout,
history and basic Admin flow first. Implement basic commitment-and-reveal if time
permits. This feature is not implemented yet.

## What it should do

1. Create a fresh cryptographically secure secret for each draw in the backend.
2. Publish SHA-256(secret bytes) before the draw; preferably before sales open.
3. Freeze the draw ID, prize slots, duplicate rule, algorithm and a future round
   from an independent public random source before that random value is known.
4. Sales close at 17:00 Thailand time on the last day of the month. At the scheduled
   18:00 draw, fetch the agreed public value and verify its source/proof; emergency
   early closing does not permit an early draw.
5. Deterministically combine the secret, public value and draw ID to generate
   all 13 unique winners in tier order 1/1/1/10.
6. Publish the results and reveal the secret together, once.
7. Let another person check the commitment and reproduce the winning numbers.
8. Store livestream/recording links as metadata if included in the demo.

Backend owns generation and secret storage. Frontend displays public data; it
must not receive the secret before reveal. Store the secret privately with a
separate encryption key; never commit it or log it. Do not create a secrets-management
dashboard. A seed script, browser animation or Admin-typed value must not choose winners.

## Technical details for this optional feature

Whether this feature is mandatory is already settled: **it is optional if time
permits**. The schedule, full eligible number pool, prize amounts, per-copy prizes
and correction-history rules are also settled. Only the source/protocol details
below need selection if verification is added.

- Pick the public source/network, exact future round, proof check and outage rule.
  If unavailable, wait; do not choose a more favorable value or reroll.
- Fix the exact byte encoding, hash inputs, counter order and algorithm version.
  Write a few shared examples that an independent verifier can reproduce.
- Freeze the confirmed four prize tiers and amounts with the other rules before
  publishing the commitment. There is no 5th tier.
- Keep one commitment/result per draw and record aborted/corrected draws rather
  than replacing history. Corrections retain before/after values, time, reason and
  Admin ID. Show when a corrected result differs from the original verified output;
  the original proof must not be presented as verifying a manually changed result.
  Publish the rules and evidence needed for verification.

## Avoid biased number generation

A proposed approach is a SHA-256 counter stream over the fixed inputs. Read it as
unsigned 32-bit values. For the full million-number pool, accept x only when
x < 4,294,000,000, then use x % 1,000,000 and pad to six digits. Reject values
outside that range and skip any number already chosen, continuing the same stream
until all 13 slots are filled. Agree the exact encoding and bounds before using
this algorithm. Do not simply take the last six hash digits or apply modulo to
every value. Use Node's crypto primitives, never Math.random.

## Responsibilities

- **My tasks:** I handle secret storage, commitments and a separate replay checker.
- **Backend teammate:** Handle the public source, winner generation and stream metadata.

Check the protocol together. Replaying must check source proof, rules and
all winners, not just whether the secret hash matches.

Hashing alone does not guarantee fairness: an operator can try multiple secrets,
change unpublished rules or withhold results. Publish the commitment/rules early
and keep independently checkable records. A livestream is useful context, not
proof of correct or fair generation. Do not call unfinished verification "verified."
