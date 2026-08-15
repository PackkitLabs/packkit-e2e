// J6 — version-matrix self-consistency (SPEC §3).
//
// The ecosystem deliberately runs a "benign version split": generators pin an older
// @packkit/core minor than the providers, because they only use additively-stable
// contract types. That's fine — but "fine" was a *reasoned* claim. This journey makes
// it an *executed* one: every published Packkit package must be installable against
// SOME published core (its declared range resolves to a real core version). It catches
// the genuine failure — a package published pinning a core that doesn't exist (or was
// yanked) — while tolerating the intentional older-pin. The split status is logged for
// visibility, not failed on.
import semver from 'semver';
import { journey, sh, assert, batch } from '../lib/harness.mjs';
import { PACKKIT_PACKAGES } from '../lib/versions.mjs';

// Packages that depend on @packkit/core (web isn't on npm; core itself is the anchor).
const CONSUMERS = PACKKIT_PACKAGES.filter((p) => p !== '@packkit/core');

function declaredCoreRange(pkg) {
	// A generator carries it in dependencies; a provider in peerDependencies.
	for (const field of ['dependencies', 'peerDependencies']) {
		const out = sh('npm', ['view', pkg, `${field}.@packkit/core`]).trim();
		if (out) return out;
	}
	return null;
}

journey('j6', 'version-matrix self-consistency', async () => {
	const b = batch();

	const publishedCores = JSON.parse(sh('npm', ['view', '@packkit/core', 'versions', '--json']));
	const latestCore = sh('npm', ['view', '@packkit/core', 'version']).trim();
	console.log(`   (latest @packkit/core: ${latestCore}; ${publishedCores.length} published)`);

	for (const pkg of CONSUMERS) {
		await b.run(`${pkg} resolves to a published @packkit/core`, () => {
			const range = declaredCoreRange(pkg);
			assert(range, `${pkg} declares no @packkit/core dependency`);
			const match = semver.maxSatisfying(publishedCores, range);
			assert(
				match,
				`${pkg} pins @packkit/core "${range}", but no published core (latest ${latestCore}) satisfies it`,
			);
			const onLatest = semver.satisfies(latestCore, range);
			console.log(
				`     ${pkg}: "${range}" → ${match}${onLatest ? '' : `  (benign split — not on latest ${latestCore})`}`,
			);
		});
	}

	b.done();
});
