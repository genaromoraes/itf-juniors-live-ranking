# Dynamic External Candidates

This project keeps a fixed official tracking base of 1000 boys and 1000 girls.
The public ranking display remains limited to the live Top 500 per gender, but
players outside the fixed base can now be investigated during the week when
their live results could make them relevant to that display.

## Fixed Base

- `TRACKED_BASE_LIMIT_PER_GENDER`: 1000
- `DISPLAY_LIMIT_PER_GENDER`: 500
- `INVESTIGATION_RANK_PER_GENDER`: 600

The base official files remain:

- `data/clean/players.csv`
- `data/clean/rankings_snapshot.csv`
- `data/clean/points_ledger.csv`

## Universe

`npm run rankings:universe` collects a broader official ranking universe into:

- `data/clean/rankings_universe.csv`

It only collects ranking rows. It does not fetch player breakdowns.

## Candidate Flow

`npm run candidates:detect` reads weekly participants outside `players.csv`,
matches them against `rankings_universe.csv`, estimates their live potential,
and writes:

- `data/clean/external_candidates.csv`

Statuses:

- `INELIGIBLE`: cannot reach the investigation cutoff this week.
- `WATCH`: could reach the cutoff with future rounds, but does not yet require a breakdown.
- `FETCH_REQUIRED`: guaranteed points are high enough to fetch the official breakdown.
- `FETCHED`: breakdown was fetched and can be used in the live ranking.
- `FETCH_ERROR`: breakdown fetch failed for that player.
- `BLOCKED`: collection stopped after an ITF block or HTML challenge.
- `INCLUDED`: candidate was included in the final live ranking calculation.

`npm run candidates:fetch` fetches breakdowns only for `FETCH_REQUIRED`
candidates and writes:

- `data/clean/external_candidate_ledger.csv`
- `data/clean/external_candidate_errors.csv`

The final live calculation can then include fetched external candidates when
they enter the live ranking, while non-fetched external weekly rows stay in the
ignored external audit files.

## Pipeline

`npm run update:full` now runs:

1. Weekly tournament scrape.
2. Weekly results scrape.
3. Weekly live points calculation.
4. Ranking universe collection.
5. Preliminary live ranking calculation.
6. External candidate detection.
7. External candidate breakdown fetch.
8. Final live ranking calculation.
9. HTML and audit generation.

`npm run update` stays local-only and uses already available generated data.

## Generated Files

- `data/clean/rankings_universe.csv`
- `data/clean/external_candidates.csv`
- `data/clean/external_candidate_ledger.csv`
- `data/clean/external_candidate_errors.csv`
- `data/clean/live_external_players_included.csv`

Weekly archive/start logic preserves the external candidate CSVs so the next
week can start from a clean, explicit state.
