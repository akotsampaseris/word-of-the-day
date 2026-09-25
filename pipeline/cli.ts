/**
 * The pipeline command line. Run through the package.json scripts, e.g.
 *   pnpm pipeline:generate
 *   pnpm pipeline:approve 2026-09-26
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { approveEntry, validateContentDir } from './checks';
import { describeConfig, loadConfig, loadEnvFile, redactSecrets, type Config } from './config';
import { entriesOf, loadContent } from './content-store';
import { isIsoDate, todayIn } from './dates';
import { createPublishHooks } from './extensions';
import { fillBuffer, formatRunSummary } from './generate';
import { ensureMockImages } from './mock-assets';
import { CONTENT_DIR, MOCK_IMAGES_DIR } from './paths';
import { createProviders } from './providers';
import { pickFeatured } from './publish';
import { buildStatus, formatStatus } from './status';

const HELP = `Usage: pnpm pipeline:<command> [options]

Commands:
  generate            Fill the draft buffer up to BUFFER_DAYS ahead
  validate            Re-check every content file against the schema and rules
  approve <date...>   Mark one or more drafts as approved (YYYY-MM-DD)
  status              Show buffer depth, drafts awaiting review and gaps
  announce            Run the publish hooks (newsletter, social) for today's entry
  mock-assets         Recreate missing mock images (runs before dev and build)

Options:
  --today YYYY-MM-DD  Treat this date as today (for testing and backfilling)
  --days N            Override BUFFER_DAYS for this run (generate, status)
  --summary FILE      Also write the generate summary as Markdown (used by CI)
`;

type Flags = { today?: string; days?: string; summary?: string };

async function main(): Promise<number> {
  loadEnvFile();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      today: { type: 'string' },
      days: { type: 'string' },
      summary: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...args] = positionals;

  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case 'generate':
      return generate(values);
    case 'validate':
      return validate();
    case 'approve':
      return approve(args);
    case 'status':
      return status(values);
    case 'announce':
      return announce(values);
    case 'mock-assets':
      return mockAssets();
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      return 1;
  }
}

async function generate(flags: Flags): Promise<number> {
  const config = loadConfig();
  printConfig(config);

  const today = resolveToday(flags, config);
  const bufferDays = flags.days ? parseDays(flags.days) : config.bufferDays;
  const providers = createProviders(config);

  const summary = await fillBuffer(
    { ...providers, contentDir: CONTENT_DIR, log: (message) => console.log(message) },
    { today, bufferDays, maxAttempts: config.maxAttempts, styleAnchorUrls: config.styleAnchorUrls },
  );

  const markdown = formatRunSummary(summary, { today, bufferDays, providers: describeConfig(config) });
  console.log(`\n${markdown}`);
  if (flags.summary) await writeFile(flags.summary, `${markdown}\n`);

  if (summary.aborted) {
    console.error(`\nStopped early: ${redactSecrets(summary.aborted.error)}`);
    return 1;
  }
  return 0;
}

async function validate(): Promise<number> {
  const report = await validateContentDir(CONTENT_DIR);

  for (const { file, messages } of report.warnings) {
    console.log(`warning  ${file}`);
    for (const message of messages) console.log(`         ${message}`);
  }
  for (const { file, messages } of report.errors) {
    console.log(`error    ${file}`);
    for (const message of messages) console.log(`         ${message}`);
  }

  const fileCount = new Set(report.errors.map((error) => error.file)).size;
  console.log(
    report.errors.length === 0
      ? `\nAll ${report.checked} content files are valid.`
      : `\n${fileCount} of ${report.checked} content files have problems.`,
  );
  return report.errors.length === 0 ? 0 : 1;
}

async function approve(dates: string[]): Promise<number> {
  if (dates.length === 0) {
    console.error('Usage: pnpm pipeline:approve <YYYY-MM-DD> [more dates...]');
    return 1;
  }

  let failures = 0;
  for (const date of dates) {
    const result = await approveEntry(CONTENT_DIR, date);
    if (result.ok) {
      console.log(
        result.alreadyApproved
          ? `${date}: "${result.entry.word}" was already approved.`
          : `${date}: approved "${result.entry.word}". Commit content/${date}.json to publish it.`,
      );
    } else {
      failures++;
      console.error(`${date}: not approved:`);
      for (const error of result.errors) console.error(`  ${error}`);
    }
  }
  return failures === 0 ? 0 : 1;
}

async function status(flags: Flags): Promise<number> {
  const config = loadConfig();
  const today = resolveToday(flags, config);
  const bufferDays = flags.days ? parseDays(flags.days) : config.bufferDays;
  console.log(formatStatus(await buildStatus(CONTENT_DIR, today, bufferDays)));
  return 0;
}

async function announce(flags: Flags): Promise<number> {
  const config = loadConfig();
  const today = resolveToday(flags, config);
  const entry = pickFeatured(entriesOf(await loadContent(CONTENT_DIR)), today);

  // Only announce a word on its own day, never re-announce yesterday's.
  if (!entry || entry.date !== today) {
    console.log(`No approved entry for ${today}; nothing to announce.`);
    return 0;
  }

  const permalink = `${config.siteUrl}/word/${entry.slug}/`;
  for (const hook of createPublishHooks()) {
    await hook.run(entry, { permalink, siteUrl: config.siteUrl, log: (message) => console.log(message) });
  }
  return 0;
}

async function mockAssets(): Promise<number> {
  const written = await ensureMockImages(CONTENT_DIR, MOCK_IMAGES_DIR);
  if (written > 0) console.log(`Recreated ${written} mock image(s) in public/mock-images/.`);
  return 0;
}

// ---------------------------------------------------------------------------

function printConfig(config: Config): void {
  for (const line of describeConfig(config)) console.log(line);
  for (const warning of config.warnings) console.warn(`warning: ${warning}`);
  console.log('');
}

function resolveToday(flags: Flags, config: Config): string {
  if (flags.today === undefined) return todayIn(config.timeZone);
  if (!isIsoDate(flags.today)) throw new Error(`--today must be a valid YYYY-MM-DD date (got "${flags.today}").`);
  return flags.today;
}

function parseDays(raw: string): number {
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0 || days > 60) {
    throw new Error(`--days must be a whole number from 0 to 60 (got "${raw}").`);
  }
  return days;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${redactSecrets(message)}`);
    process.exitCode = 1;
  });
