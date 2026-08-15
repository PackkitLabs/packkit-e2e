// A tiny, zero-framework journey runner. A "journey" is a cross-repo user story
// (SPEC §3); it runs a batch of sub-checks, each of which can pass, skip (missing
// toolchain / not-yet-published), or fail. A journey fails if any sub-check fails.
// Skips never fail the run — a runner without Go still gives signal on JS/Python.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class SkipError extends Error {}
/** Abort the current sub-check as "skipped" (not a failure). */
export const skip = (reason) => {
	throw new SkipError(reason);
};
export function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

/** True if `bin` is runnable. Used to skip journeys whose toolchain is absent. */
export function hasTool(bin, args = ['--version']) {
	return spawnSync(bin, args, { stdio: 'ignore' }).status === 0;
}

/** Run a command, returning stdout. Throws (with captured stderr) on non-zero exit. */
export function sh(cmd, args, { cwd, env, input, timeout } = {}) {
	try {
		return execFileSync(cmd, args, {
			cwd,
			env: env ? { ...process.env, ...env } : process.env,
			input,
			encoding: 'utf8',
			timeout: timeout ?? 12 * 60_000,
			maxBuffer: 64 * 1024 * 1024,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
	} catch (err) {
		const tail = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
		throw new Error(`\`${cmd} ${args.join(' ')}\` failed: ${err.message.split('\n')[0]}\n${tail}`);
	}
}

/** A fresh temp directory (caller cleans up, or leaves it for CI teardown). */
export function tmpDir(prefix = 'packkit-e2e-') {
	return mkdtempSync(join(tmpdir(), prefix));
}

/** Sub-check accumulator inside a journey. `done()` throws if any check failed. */
export function batch() {
	const failures = [];
	let ran = 0;
	return {
		async run(name, fn) {
			ran++;
			try {
				await fn();
				console.log(`   ✓ ${name}`);
			} catch (err) {
				if (err instanceof SkipError) {
					console.log(`   · ${name} — skipped: ${err.message}`);
				} else {
					failures.push({ name, error: err.message });
					console.log(`   ✖ ${name} — ${err.message.split('\n')[0]}`);
				}
			}
		},
		done() {
			if (failures.length) {
				const lines = failures.map((f) => ` - ${f.name}: ${f.error.split('\n')[0]}`).join('\n');
				throw new Error(`${failures.length}/${ran} check(s) failed:\n${lines}`);
			}
		},
	};
}

const journeys = [];
/** Register a journey. `fn` receives nothing; use `batch()` inside. */
export function journey(id, title, fn) {
	journeys.push({ id, title, fn });
}

/** Run registered journeys (optionally filtered by id), print a summary, return results. */
export async function runAll({ filter } = {}) {
	const results = [];
	for (const j of journeys) {
		if (filter && filter.length && !filter.includes(j.id)) continue;
		console.log(`\n━━ ${j.id}: ${j.title} ━━`);
		const start = Date.now();
		let status = 'pass';
		let detail = '';
		try {
			await j.fn();
		} catch (err) {
			if (err instanceof SkipError) {
				status = 'skip';
				detail = err.message;
			} else {
				status = 'fail';
				detail = err.message;
			}
		}
		const durationMs = Date.now() - start;
		results.push({ id: j.id, title: j.title, status, detail, durationMs });
	}
	return results;
}
