import { Bench } from 'tinybench';
import matter from 'gray-matter';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { it } from 'vitest';
import { parseLog, parseStories } from '../src/lib/adr';
import { decisionsDirectory, readDocuments, storiesDirectory } from '../src/lib/docs-loader';

// Benchmark 0001: what loading the ADRs and stories costs, and where it goes.
// Run with `make bench-docs`; set BENCH_OUT=<file> to also write the Markdown table to a file.
// Record results in docs/benchmarks/ (see its README for what to note).

function readSources(directory: URL, pattern: RegExp) {
  const path = fileURLToPath(directory);
  return new Map(
    readdirSync(path)
      .filter((name) => pattern.test(name))
      .map((name) => [name, readFileSync(path + name, 'utf8')] as const),
  );
}

const adrSources = readSources(decisionsDirectory, /^\d{4}-.+\.md$/);
const storySources = readSources(storiesDirectory, /^(\d{4}|XXXX)-.+\.md$/);
const adrIndex = readFileSync(fileURLToPath(decisionsDirectory) + 'README.md', 'utf8');
const storyIndex = readFileSync(fileURLToPath(storiesDirectory) + 'README.md', 'utf8');
const sources = [...adrSources.values(), ...storySources.values()];
const bodies = sources.map((source) => matter(source).content);
const withGfm = unified().use(remarkParse).use(remarkGfm);
const withoutGfm = unified().use(remarkParse);
const adrFiles = new Map(parseLog(adrIndex, adrSources).map((adr) => [adr.number, adr.file]));

const iterations = 15;
const warmupIterations = 3;

it('parsing the ADRs and stories', async () => {
  const bench = new Bench({ time: 0, iterations, warmupTime: 0, warmupIterations });
  bench
    .add(`gray-matter, ${String(sources.length)} files`, () => {
      for (const source of sources) matter(source);
    })
    .add(`remark + GFM parse, ${String(bodies.length)} bodies`, () => {
      for (const body of bodies) withGfm.parse(body);
    })
    .add(`remark parse without GFM, ${String(bodies.length)} bodies`, () => {
      for (const body of bodies) withoutGfm.parse(body);
    })
    .add(`parseLog, ${String(adrSources.size)} ADRs + index`, () => {
      parseLog(adrIndex, adrSources);
    })
    .add(`parseStories, ${String(storySources.size)} stories + index`, () => {
      parseStories(storyIndex, storySources, adrFiles);
    })
    .add('readDocuments, disk + both collections', async () => {
      await readDocuments();
    });
  await bench.run();

  const bytes = sources.reduce((total, source) => total + source.length, 0);
  const lines = [
    `Corpus: ${String(sources.length)} files, ${String(Math.round(bytes / 1024))} KB. ` +
      `${String(iterations)} timed + ${String(warmupIterations)} warm-up iterations per task.`,
    `Machine: ${String(cpus().length)} x ${cpus()[0]?.model ?? 'cpu'}, ${platform()} ${release()}, ` +
      `node ${process.version}.`,
    '',
    '| Task | mean (ms) | p50 (ms) | p99 (ms) | rme |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...bench.tasks.map((task) => {
      const result = task.result;
      if (result.state !== 'completed') throw new Error(`${task.name} did not complete`);
      const { mean, p50, p99, rme } = result.latency;
      return `| ${task.name} | ${mean.toFixed(1)} | ${p50.toFixed(1)} | ${p99.toFixed(1)} | ±${rme.toFixed(0)}% |`;
    }),
  ];
  const table = lines.join('\n');
  process.stdout.write(`\n${table}\n`);
  if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, `${table}\n`);
});
