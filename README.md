# MSCS Hub — Cloud Functions

Firebase Cloud Functions backend for **MSCS Hub** ([mscshub.com](https://mscshub.com/)),
a community course-review site for the University of Texas at Austin online
Master of Science in Computer Science (MSCS) program.

These functions maintain aggregate course ratings, scrape the UT course
catalog, index reviews for search, and run a Slack bot that nudges students to
leave reviews at the end of each semester.

## What's in here

All functions live in [`functions/src/index.ts`](functions/src/index.ts).

| Function | Trigger | Purpose |
| --- | --- | --- |
| `NewRating` | Firestore `onCreate` on `/Reviews/{id}` | Folds a new review into the parent class's rolling averages (rating, difficulty, workload, etc.), updates the semester map, and pushes the review to Algolia search. |
| `AdjustReview` | Firestore `onUpdate` on `/Reviews/{id}` | Recomputes the affected class averages and the review's Wilson score when a review is edited. |
| `DeleteRating` | Firestore `onDelete` on `/Reviews/{id}` | Backs a deleted review out of its class's averages and semester map. |
| `RecalcClass` | HTTPS | Admin/maintenance endpoint that recomputes every class's averages from scratch. |
| `createClassMaps` | HTTPS | One-off backfill that builds the per-class `semesters` map from existing reviews. |
| `ScrapeWeb` | HTTPS | Scrapes the UT Austin online MSCS course catalog and seeds any missing documents in the `Class` collection. |
| `slackBotScheduler` | Pub/Sub schedule | Runs on the 1st/10th/20th of review months and DMs students (via the review-reminder Slack bot) about classes they're enrolled in but haven't reviewed. |
| `SlackBotRemoveGraduates` | HTTPS | Slack Events API endpoint. |

### Firestore collections

- `Class` — one document per course, holding the rolling rating aggregates.
- `Reviews` — individual student reviews (the source of truth for the aggregates).
- `Faq`, `FaqHistory`, `UserExtraData`, `Feedback` — supporting data.

Security rules are in [`firestore.rules`](firestore.rules); composite indexes in
[`firestore.indexes.json`](firestore.indexes.json).

## Setup

Requirements: Node.js 18 and the [Firebase CLI](https://firebase.google.com/docs/cli).

```bash
cd functions
npm install
```

### Configuration

Secrets are **not** stored in this repo. They're read at runtime from Firebase
functions config:

```bash
# Algolia search credentials
firebase functions:config:set algolia.appid="YOUR_ALGOLIA_APP_ID"
firebase functions:config:set algolia.apikey="YOUR_ALGOLIA_ADMIN_KEY"

# Slack bot token (for the review-reminder bot)
firebase functions:config:set slack.token="xoxb-your-slack-bot-token"
```

To run the emulator locally, export the config first:

```bash
firebase functions:config:get > functions/.runtimeconfig.json
```

### Common commands (run from `functions/`)

```bash
npm run build      # compile TypeScript to lib/
npm run lint       # run ESLint
npm run serve      # build + start the Functions emulator
npm run deploy     # firebase deploy --only functions
```

## Notes

- Targets the Firebase project configured in [`.firebaserc`](.firebaserc).
- `functions.config()` is a legacy Firebase API; a future update should migrate
  these values to environment parameters (`firebase-functions/params`).

## License

[MIT](LICENSE)
