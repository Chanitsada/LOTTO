# Drawing and verification

LOTTO implements a backend random draw with final publication. It does not
implement public-key, commitment/reveal or independent replay verification.
The UI's Verification key is a static display value with no connection to winners,
a private key or a stored proof. It must not be presented as verification evidence.

## Drawing algorithm

Algorithm identifier: `crypto-random-int-v1`.

1. Lock the LotteryDraw row in a transaction.
2. Require Ready inventory, Closed sales, the scheduled 18:00 Thailand time and
   no existing publication.
3. Read the 13 prize slots in 1st/2nd/3rd/4th order, then PrizeID.
4. Sample `crypto.randomInt(1000000)` in Node and format with six digits.
5. Reject duplicate samples until 13 unique numbers exist.
6. Assign winners to the ordered slots, update Prize and save ResultsPublishedAt.
7. Commit all results together; reject subsequent generation requests.

All one million numbers can win, including unsold ones. The browser sends no
winning numbers or prize amounts. Early closure does not permit early publication.
The app provides no result edit, correction or reroll route. Direct SQL remains
under the database owner's control.

The implementation is in `backend/utils/draw.js` and the generate handler in
`backend/controllers/admin-controller.js`. Result checks read published Prize
rows; pending results never count as losses. The stream image is an illustration,
not a live broadcast.

## Verification boundary

| Evidence | Available? |
| --- | --- |
| Backend cryptographic random sampling | Yes |
| Database results and publication timestamp | Yes |
| Pre-draw secret commitment | No |
| Independent public randomness/source proof | No |
| Revealed secret and reproducible deterministic seed | No |
| Independent winner regeneration and PASS/FAIL comparison | No |
| Public key/signature verification | No |

The five-step verification process is an optional extension, separate from
password hashing and the database demonstration. A complete implementation would
need a published pre-draw commitment, a fixed future randomness source/round,
precise input encoding, deterministic number generation and an independent
comparison with official results. These choices are not implemented contracts.
Displaying a key, hashing an arbitrary value or replaying official results alone
cannot establish that process.

If that extension is undertaken, I own public-source integration and deterministic
generation; the backend teammate owns protected secret storage, commitments and
the independent checker. The core demo demonstrates actual database behavior
rather than claiming this optional feature is complete.
