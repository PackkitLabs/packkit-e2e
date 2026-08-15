// Entry point: run the Packkit ecosystem journeys against published (@latest) packages,
// write a machine-readable report + the versions snapshot, and exit non-zero if any
// journey failed (skips do not fail the run). See SPEC.md.
//
//   node run.mjs                 # all journeys
//   node run.mjs j2 j6           # only these
//   E2E_GENERATORS=go,py node run.mjs j1
import { mkdirSync, writeFileSync } from 'node:fs';
import { runAll } from './lib/harness.mjs';
import { collectVersions } from './lib/versions.mjs';

// Journeys self-register on import.
import './journeys/j1-generate-build-test.mjs';
import './journeys/j2-contract-provider.mjs';
import './journeys/j3-release-validity.mjs';
import './journeys/j6-version-matrix.mjs';

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const versions = collectVersions();
console.log('Packkit ecosystem e2e — channel: latest');
console.log(
	'Published:',
	Object.entries(versions.packages)
		.map(([p, v]) => `${p}@${v ?? '?'}`)
		.join('  '),
);

const results = await runAll({ filter });

mkdirSync('results', { recursive: true });
writeFileSync('results/versions.json', JSON.stringify(versions, null, 2) + '\n');
writeFileSync('results/report.json', JSON.stringify({ versions, results }, null, 2) + '\n');

const pass = results.filter((r) => r.status === 'pass');
const skipped = results.filter((r) => r.status === 'skip');
const failed = results.filter((r) => r.status === 'fail');

console.log('\n──────── summary ────────');
for (const r of results) {
	const icon = r.status === 'pass' ? '✓' : r.status === 'skip' ? '·' : '✖';
	console.log(`${icon} ${r.id}  ${r.title}  (${(r.durationMs / 1000).toFixed(1)}s)`);
}
console.log(`\n${pass.length} passed · ${skipped.length} skipped · ${failed.length} failed`);

if (failed.length) {
	console.log('\nFailures:');
	for (const r of failed) console.log(`\n✖ ${r.id} — ${r.title}\n${r.detail}`);
	process.exitCode = 1;
}
