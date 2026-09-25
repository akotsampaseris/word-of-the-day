# Word of the Day

A static website that features one uncommon English word a day: its meaning,
where it came from, a very short story, and an illustration.

The site is plain static HTML. The only moving part is a pipeline that
generates content **ahead of time** into a buffer of drafts. A human approves
each day before it can go live. Nothing calls an AI API when someone visits
the page.

```
content/words.json ──► pipeline:generate ──► content/2026-10-01.json (draft)
  (the word queue)       │                        │
                         ├─ Wiktionary: real etymology source material
                         ├─ text model: definition, etymology, story (JSON)
                         │    └─ validate → repair → retry (max 3 attempts)
                         └─ image model → S3 / R2 → public image URL
                                                  │
                human review ─► pipeline:approve ─► git commit / merge
                                                  │
                     daily build (the publish step: approved + date ≤ today)
                                                  ▼
                                         static site (dist/)
```

- [Quick start (mock mode)](#quick-start-mock-mode)
- [Commands](#commands)
- [How content works](#how-content-works)
- [Configuration](#configuration)
- [Wiring real providers](#wiring-real-providers)
- [Daily operating routine](#daily-operating-routine)
- [CI setup](#ci-setup)
- [Deploying](#deploying)
- [Extension points](#extension-points)
- [Design decisions and known limitations](#design-decisions-and-known-limitations)
- [Project layout](#project-layout)

## Quick start (mock mode)

Requirements: Node 22.13 or newer, and pnpm 11 (`npm install -g pnpm`, or
`corepack enable`).

```sh
pnpm install
pnpm dev          # http://localhost:4321
```

No `.env` and no API keys are needed. The repo ships with three approved days
and two drafts of **mock content**, and every provider falls back to a mock
when its key is missing:

| Real provider | Mock stand-in |
| --- | --- |
| Wiktionary (etymology sources) | fixed placeholder source, URL on the reserved `example.invalid` domain |
| Claude / OpenAI (text) | deterministic placeholder text that passes every validation rule |
| FLUX.2 pro / OpenAI (images) | a deterministic SVG showing the word |
| S3 / R2 (storage) | files in `public/mock-images/` |

Try the whole pipeline without spending anything:

```sh
pnpm pipeline:generate   # fills today → today + 14 days with mock drafts
pnpm pipeline:status     # what's approved, what's waiting, where the gaps are
pnpm pipeline:approve 2026-09-26
pnpm test
```

Mock content says plainly that it is a placeholder. That is deliberate: a
plausible but invented etymology is exactly what this project must never
publish. **Before launching, delete the mock content files** (see
[Going live](#going-live)).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Recreates any missing mock images, then starts the dev server. |
| `pnpm build` | Same, then builds the static site into `dist/`. |
| `pnpm preview` | Serves `dist/` locally. |
| `pnpm test` | Runs the test suite (vitest). |
| `pnpm typecheck` | Type-checks the pipeline, site helpers and tests. |
| `pnpm pipeline:generate` | Fills every missing date from today to today + `BUFFER_DAYS` with drafts. |
| `pnpm pipeline:validate` | Re-checks every content file against the schema and content rules. Exits 1 on any problem. |
| `pnpm pipeline:approve <date> [date...]` | Re-checks a draft, then flips its status to `approved`. |
| `pnpm pipeline:status` | Shows buffer depth, drafts awaiting review, failed drafts and gaps. |
| `pnpm pipeline:announce` | Runs the publish hooks (newsletter, social) for today's entry. Stubs for now. |
| `pnpm pipeline:mock-assets` | Recreates missing mock images. `dev` and `build` run it for you. |

`generate` and `status` accept `--today YYYY-MM-DD` (pretend it's another day,
useful for testing and backfilling) and `--days N` (override `BUFFER_DAYS`).
`generate --summary FILE` also writes the run summary as Markdown; CI uses it
as the pull request body.

## How content works

### One JSON file per day

`content/2026-10-01.json` is the entry for 1 October 2026. There is no
database: git is the audit log, and rolling back is `git revert`. The
contract is the zod schema in [`pipeline/schema.ts`](pipeline/schema.ts),
which the site also uses to load content:

```ts
{
  slug, word, date,                 // "gongoozler", "gongoozler", "2026-10-01"
  status: "draft" | "approved",
  pronunciation, partOfSpeech,
  definition,                       // 1–2 sentences, ≤ 300 chars
  etymology,                        // 2–4 sentences, ≤ 800 chars
  etymologySources: string[],       // the URLs actually fetched; never model-generated
  story,                            // 120–200 words, uses the word
  image: { url, prompt, provider, model, alt },
  generatedAt
}
```

Beyond the schema, [`pipeline/rules.ts`](pipeline/rules.ts) checks the things
that matter more:

- the story contains the word (inflections such as *absquatulated* count)
- the definition doesn't begin by restating the word ("A gongoozler is…")
- `etymologySources` is non-empty and every entry is a well-formed URL
- no em-dashes (or `--`) in the story (house style)
- the story has 120–200 words
- the definition has 1–2 sentences and the etymology 2–4
- no two files claim the same date, and every slug is unique

### The word queue

`content/words.json` is a plain JSON array of words, in the order they should
be used. It is only ever edited by hand. A word counts as **used** once any
content file has its slug. Consequences:

- Deleting a content file puts its word back at the front of the queue, so
  the next `generate` run retries it.
- To drop a word for good, delete its content file *and* remove it from
  `words.json`.
- Keep at least `BUFFER_DAYS` unused words in the queue; `status` warns when
  you drop below 14.

### Generation, per word

1. Take the next unused word.
2. **Fetch the Wiktionary entry** (etymology, IPA, definitions). If the
   English etymology is thin, like "Alteration of kenspeck.", also fetch the
   one entry it links to. Every fetched URL goes into `etymologySources`. A
   word with no usable etymology is **skipped** (its date goes to the next
   word) and reported in the run summary.
3. **One text call** returns the definition, etymology, story, image clause
   and alt text as JSON. The prompt allows the model to explain the sources
   but not to add to them.
4. **Validate** (schema + rules). On failure, the specific errors are sent
   back as a repair instruction, up to `MAX_ATTEMPTS` attempts in total (3 by
   default). If every attempt fails, the file is written as a **failed draft**:
   `status: "draft"` plus an `_errors` list, with no image generated. The run
   then continues with the next date.
5. **Generate the image** (1024×1024) from the fixed style preamble in
   [`pipeline/style.ts`](pipeline/style.ts) plus the word's clause. If the
   provider supports reference images, the 3 most recent approved images go
   along as style anchors. Upload the result and record its public URL.
6. Write `content/<date>.json` with `status: "draft"`.

If a provider *throws* (outage, bad key, network error), the run stops
instead of producing a pile of identical failed drafts. Files already written
are kept, and the command exits with code 1.

### Publishing

The site build is the publish step. [`src/lib/entries.ts`](src/lib/entries.ts)
keeps only entries that are `approved` **and** dated today or earlier, where
"today" is computed in `SITE_TIMEZONE`. If today has no approved entry, the
home page quietly shows the most recent one. An *approved* entry that fails
the schema stops the build, so a broken day is never silently dropped.

## Configuration

Everything is read from environment variables, or from `.env` if present.
Copy `.env.example` to start. Every variable is optional. A missing key never
throws; it falls back to a mock and prints a warning. Secret values are never
logged: the CLI prints provider names only and scrubs keys from error
messages.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SITE_URL` | `http://localhost:4321` | Public URL of the site. Used for canonical links, OG/Twitter images, RSS and the sitemap. **Set this in production** or social cards will point at localhost. |
| `SITE_TIMEZONE` | `UTC` | IANA time zone that defines "today" (e.g. `Europe/Athens`). |
| `BUFFER_DAYS` | `14` | How far ahead `generate` fills (today through today + N). |
| `MAX_ATTEMPTS` | `3` | Text attempts per word, counting the first try, before writing a failed draft. |
| `REQUIRE_REAL_PROVIDERS` | *(off)* | `1` makes any fallback to mock an error. CI sets this. |
| `TEXT_PROVIDER` | `auto` | `auto` (Anthropic if `ANTHROPIC_API_KEY` is set, otherwise mock), `anthropic`, `openai` or `mock`. OpenAI is never chosen automatically. |
| `TEXT_MODEL` | per provider | Anthropic: `claude-haiku-4-5`. OpenAI: `gpt-6-luna`. |
| `ANTHROPIC_API_KEY` | | Secret. Enables Claude. |
| `OPENAI_API_KEY` | | Secret. Used only when `TEXT_PROVIDER` or `IMAGE_PROVIDER` is `openai`. |
| `SOURCE_PROVIDER` | `auto` | `auto` (Wiktionary when the text provider is real, otherwise mock), `wiktionary` or `mock`. |
| `WIKTIONARY_USER_AGENT` | generic | Sent to Wikimedia with every request. Their policy asks for contact details, e.g. `word-of-the-day/1.0 (https://yoursite; you@example.com)`. |
| `IMAGE_PROVIDER` | `auto` | `auto` (fal if `FAL_KEY` is set, otherwise mock), `fal`, `openai` or `mock`. A real image provider also needs S3; without it, mock images are used. |
| `IMAGE_MODEL` | per provider | fal: `fal-ai/flux-2-pro`. OpenAI: `gpt-image-2.5-sunburst`. |
| `FAL_KEY` | | Secret. Enables FLUX.2 pro on fal.ai. |
| `STYLE_ANCHOR_URLS` | *(empty)* | Comma-separated image URLs (up to 3) to pin as style anchors instead of the 3 most recent approved images. |
| `S3_BUCKET` | | Bucket name. S3 is enabled when this, both keys and `S3_PUBLIC_BASE_URL` are set. |
| `S3_ACCESS_KEY_ID` | | Secret. |
| `S3_SECRET_ACCESS_KEY` | | Secret. |
| `S3_PUBLIC_BASE_URL` | | Public URL the bucket is served from. Image URLs are `<this>/<prefix><file>`. |
| `S3_ENDPOINT` | *(AWS)* | Custom endpoint. For Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`. |
| `S3_REGION` | `auto` with an endpoint, else `us-east-1` | Bucket region. |
| `S3_KEY_PREFIX` | `images/` | Prefix for object keys. |
| `S3_FORCE_PATH_STYLE` | `true` with an endpoint | Path-style bucket URLs, which custom endpoints need. |

## Wiring real providers

The cheapest way to check each piece is one day at a time: `pnpm
pipeline:generate --days 0` generates only today's entry, if today is
missing.

### Text: Claude (default)

Set `ANTHROPIC_API_KEY`. The default model is **Claude Haiku 4.5**
(`claude-haiku-4-5`). Anthropic's docs list its retirement as *not sooner than
15 October 2026*, so keep an eye on the
[deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations).
To switch models, set `TEXT_MODEL` (e.g. `claude-sonnet-5`); nothing else
changes.

With a real text provider, sources automatically switch to real Wiktionary
fetches. Set `WIKTIONARY_USER_AGENT` to something that identifies you.

### Images: FLUX.2 pro on fal.ai (default)

1. Set `FAL_KEY`.
2. Configure S3 storage (next section). Real images are never written to the
   repo.

Without style anchors the adapter calls `fal-ai/flux-2-pro`; with anchors it
calls `fal-ai/flux-2-pro/edit` and passes them as `image_urls`. Images are
requested as 1024×1024 JPEG, with a deterministic seed per date and word.
fal's result URLs are temporary, so the pipeline downloads the image and
uploads it to your bucket.

### Storage: Cloudflare R2 (or any S3-compatible bucket)

1. Create an R2 bucket and give it a public URL: either the `r2.dev` URL
   (fine for testing) or a custom domain (for production).
2. Create an R2 API token with *Object Read & Write* on that bucket.
3. Set:

   ```sh
   S3_BUCKET=word-of-the-day
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   S3_PUBLIC_BASE_URL=https://images.your-site.example
   ```

For AWS S3, leave `S3_ENDPOINT` empty, set `S3_REGION`, and make the prefix
publicly readable with a bucket policy (or put CloudFront in front of it).
Objects are uploaded with `Cache-Control: public, max-age=31536000,
immutable`; every key contains a content hash, so an object never changes.

To test your bucket wiring without paying for image generation, configure
only S3 and keep the mock image provider: mock SVGs are then uploaded to the
bucket.

### Alternatives: OpenAI, and adding Google

- `TEXT_PROVIDER=openai` uses the Responses API (default `gpt-6-luna`).
- `IMAGE_PROVIDER=openai` uses `images.generate`, or `images.edit` with the
  style anchors as input images (default `gpt-image-2.5-sunburst`).

Adding another provider, such as Google's image model, takes one adapter file
implementing `ImageProvider` (see
[`pipeline/providers/types.ts`](pipeline/providers/types.ts)), one `case` in
[`pipeline/providers/index.ts`](pipeline/providers/index.ts), and one name in
[`pipeline/config.ts`](pipeline/config.ts). Nothing else in the pipeline
knows which provider is in use.

### Going live

1. Delete the mock content: `rm content/2026-09-2*.json`. Their words
   (gongoozler, velleity, …) go back into the queue.
2. Run `pnpm pipeline:generate --days 0` locally with real keys and read the
   result carefully.
3. Once you have a few images you like, consider pinning them with
   `STYLE_ANCHOR_URLS` (see [design decisions](#design-decisions-and-known-limitations)).

## Daily operating routine

**Every morning (5–10 minutes):**

1. Open the **"Word drafts awaiting review"** pull request that CI opened (or
   updated) overnight. Its description lists new drafts, failed drafts,
   skipped words, and empty dates.
2. Check out the branch (`git fetch && git switch pipeline/drafts`), then
   `pnpm dev` and `pnpm pipeline:status`.
3. Review each draft you want to publish. The checklist:
   - **Etymology**: open the source links. Does every claim appear in the
     sources? Anything extra is a hallucination: delete it.
   - **Pronunciation**: several words have no IPA on Wiktionary, so the model
     wrote it. Check it.
   - **Definition**: accurate, and not starting with the word.
   - **Story**: reads well and uses the word correctly.
   - **Image**: on style, no stray text, and it survives a wide crop (social
     cards crop squares to about 1.91:1).
   - **Alt text**: describes the image that was actually produced.

   Fix small things by editing the JSON directly.
4. Approve: `pnpm pipeline:approve 2026-10-03 2026-10-04`. This re-runs every
   check and refuses anything that fails.
5. Commit, push, and merge the PR. Drafts you didn't approve can be merged
   too: drafts are never published.

**To reject a draft:** delete its file. The next run regenerates that date,
starting with the same word. To drop the word as well, remove it from
`words.json`.

**To fix a failed draft** (a file with `_errors`): either fix the fields by
hand, delete `_errors`, and approve; or delete the file to regenerate it.
`pipeline:validate` and CI fail while any `_errors` file is present.

**Weekly:** keep `words.json` topped up with at least 14 unused words,
glance at `pipeline:status`, and keep the approved buffer a few days deep so
a missed morning doesn't matter. The site falls back to the latest published
word if a day is empty.

## CI setup

Two workflows live in [`.github/workflows`](.github/workflows):

- **`ci.yml`** runs on every push to `main` and every pull request: typecheck,
  tests, `pipeline:validate`, and build.
- **`generate.yml`** runs daily at 05:17 UTC (and on demand from the Actions
  tab). It generates drafts and opens a **pull request**, never a direct
  commit.

The generate workflow keeps **one branch (`pipeline/drafts`) and one open
PR**. If yesterday's PR is still open, today's run continues on that branch
and only fills the new gaps, so unmerged days are never generated (or paid
for) twice. Once the PR is merged or closed, the next run starts a fresh
branch from `main`. It sets `REQUIRE_REAL_PROVIDERS=1`, so a missing secret
fails the run instead of opening a PR full of placeholders.

To set it up in your GitHub repository:

1. **Settings → Actions → General → Workflow permissions**: allow *Read and
   write permissions* and tick *Allow GitHub Actions to create and approve
   pull requests*.
2. **Settings → Secrets and variables → Actions → Secrets**:
   `ANTHROPIC_API_KEY`, `FAL_KEY`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
   (plus `OPENAI_API_KEY` if you use OpenAI).
3. **… → Variables**: `S3_BUCKET`, `S3_ENDPOINT`, `S3_PUBLIC_BASE_URL`,
   `SITE_URL`, `WIKTIONARY_USER_AGENT`, and optionally `SITE_TIMEZONE`,
   `BUFFER_DAYS` and the other non-secret settings from the table above.
4. *Optional, but recommended:* pull requests opened with the built-in
   `GITHUB_TOKEN` don't trigger other workflows, so CI won't run on the
   drafts PR. To fix that, create a fine-grained personal access token with
   *Contents* and *Pull requests* read/write on this repository and save it as
   the `DRAFTS_PR_TOKEN` secret. The workflow uses it automatically.

## Deploying

`pnpm build` produces a fully static `dist/` folder that any static host can
serve (Cloudflare Pages, Netlify, GitHub Pages, S3, …). Two things are
specific to this project:

1. **Rebuild every day.** "Today" is decided at build time, so the home page
   only moves to the new word when the site is rebuilt. Schedule a daily
   build shortly after midnight in `SITE_TIMEZONE`, in addition to building
   on every push to `main`. Most hosts can trigger this from a cron that
   calls their deploy hook.
2. **Set `SITE_URL`** in the build environment, or the OG images, RSS feed
   and sitemap will point at localhost.

After each daily deploy, run `pnpm pipeline:announce` to fire the publish
hooks. They do nothing until you build them (next section).

## Extension points

Both are stubs, clearly marked `EXTENSION POINT`, and called by
`pnpm pipeline:announce` for today's entry:

- **Email** ([`pipeline/extensions/newsletter-buttondown.ts`](pipeline/extensions/newsletter-buttondown.ts)):
  subscriptions will live entirely in Buttondown, so all this needs is one
  POST to their API. The file lists the steps.
- **Social posting** ([`pipeline/extensions/social.ts`](pipeline/extensions/social.ts)):
  a `SocialPoster` interface plus `buildSocialPost()`, which always includes
  the image and its alt text. Implement a poster per network and register it
  in [`pipeline/extensions/index.ts`](pipeline/extensions/index.ts).

## Design decisions and known limitations

- **Sources, not memory.** The model receives Wiktionary text and may explain
  it but not add to it. It never supplies source URLs: the pipeline copies
  them from what it actually fetched. The prompt can't *guarantee*
  faithfulness, though, so the etymology check is the most important part of
  human review.
- **Thin etymologies.** Many Wiktionary etymologies are a single line, while
  the entry needs 2–4 sentences, and that gap is where a model is tempted to
  pad. Following one link to the etymon (e.g. *quincunx* → Latin *quīncunx*:
  "quīnque + uncia, five twelfths… a Roman coin") gives it real material to
  work with. The link is followed only when the etymology is under 120
  characters. Longer etymologies tend to link to words that are merely
  mentioned ("rhymed with *Italian*"), which would add noise.
- **Wikimedia rate limits** are strict for anonymous clients. Requests are
  spaced 1.5 s apart, and HTTP 429 and 5xx responses are retried with backoff
  (honouring `Retry-After`). That adds about a minute to a full 15-day run;
  most of a run's time goes to image generation.
- **Rolling style anchors can drift.** Using the last three approved images
  as references means each image is anchored to the previous ones, so the
  style can wander over time, and the references can leak subjects into new
  images. The prompt says "style only", but pinning a fixed set with
  `STYLE_ANCHOR_URLS` once you're happy with the look is the more stable
  option.
- **Square images in social cards.** The images are 1:1 as specified, but
  X/Twitter and Facebook large link cards crop to about 1.91:1. The style
  preamble keeps the subject centred so the crop is survivable. A dedicated
  1200×630 card image (the square image plus the word and definition,
  rendered at build time) would be the next step if sharing matters most.
- **Mock images are SVG.** Social networks don't render SVG in link previews,
  so share cards only really work with real (JPEG) images.
- **Mock images are not committed.** Images never live in git, even
  placeholders. `public/mock-images/` is gitignored and recreated before
  every `dev` and `build`, byte-for-byte identical, because the mock provider
  is deterministic.
- **Draft images are public before approval.** Images upload at generation
  time, so a draft's image is reachable at its (unguessable, hashed) URL
  before it is approved. Deleting a draft leaves its image in the bucket;
  clear out old objects occasionally if storage cost matters.
- **Sentence counting is a heuristic.** It treats "c. 1400" correctly but can
  miscount unusual abbreviations. A miscount costs one repair round, not a
  bad publication.

## Project layout

```
content/                 one JSON file per day + words.json (the queue)
pipeline/
  cli.ts                 the pipeline:* commands
  schema.ts              zod data contract (shared with the site)
  rules.ts               deterministic content rules
  generate.ts            fill the buffer; the retry/repair loop
  prompts.ts             generation and repair prompts
  style.ts               fixed image style preamble
  checks.ts              validate + approve
  status.ts              pipeline:status
  config.ts              env → config, provider selection, redaction
  content-store.ts       read/write content files, word queue
  publish.ts             the publish rule (approved and date ≤ today)
  dates.ts  slug.ts  seed.ts  parse-json.ts  mock-assets.ts  paths.ts
  providers/             TextProvider, ImageProvider, SourceProvider + implementations
  storage/               S3 and local image stores
  extensions/            publish hooks (newsletter, social): extension points
src/                     the Astro site (pages, layout, CSS)
tests/                   vitest suites + saved Wiktionary API fixtures
.github/workflows/       CI and daily draft generation
```
