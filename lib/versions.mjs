// Records exactly which versions a run tested — the reproducibility trail for a
// `@latest` harness (SPEC §4). A failing run attaches this so drift is diagnosable.
import { sh, hasTool } from './harness.mjs';

export const PACKKIT_PACKAGES = [
	'@packkit/core',
	'create-packkit',
	'create-packkit-py',
	'create-packkit-go',
	'packkit-mcp',
	'@packkit/provider-netlify',
	'@packkit/provider-aws',
];

/** Latest published version of an npm package (the `latest` dist-tag). */
export function latestNpmVersion(pkg) {
	try {
		return sh('npm', ['view', pkg, 'version']).trim();
	} catch {
		return null;
	}
}

function toolVersion(bin, args) {
	if (!hasTool(bin, args)) return null;
	try {
		return sh(bin, args).trim().split('\n')[0];
	} catch {
		return null;
	}
}

/** A snapshot of the published Packkit versions + host toolchains this run saw. */
export function collectVersions() {
	const packages = {};
	for (const pkg of PACKKIT_PACKAGES) packages[pkg] = latestNpmVersion(pkg);
	return {
		capturedAt: new Date().toISOString(),
		channel: 'latest',
		packages,
		toolchains: {
			node: process.version,
			npm: toolVersion('npm', ['--version']),
			uv: toolVersion('uv', ['--version']),
			python: toolVersion('python3', ['--version']),
			go: toolVersion('go', ['version']),
			tofu: toolVersion('tofu', ['version']),
			goreleaser: toolVersion('goreleaser', ['--version']),
		},
	};
}
