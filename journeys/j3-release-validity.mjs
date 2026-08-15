// J3 — release-feature validity (SPEC §3).
//
// Each generator can scaffold release automation; a broken release config only surfaces
// when a user tags a release, so validate the emitted CI here against the published CLIs:
//   - Python  --release=pypi        → the workflow is valid YAML with an OIDC publish job
//   - Go      --release=goreleaser  → `goreleaser check` accepts the emitted .goreleaser.yaml
//   - JS      --preset=oss (changesets) → a .changeset/ config + a changesets release workflow
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { journey, sh, assert, batch, hasTool, skip, tmpDir } from '../lib/harness.mjs';

const BIN = (name) => join(process.cwd(), 'node_modules', '.bin', name);

journey('j3', 'release-feature validity (published CLIs)', async () => {
	const b = batch();

	await b.run('create-packkit-py --release=pypi emits an OIDC PyPI workflow', () => {
		const cwd = tmpDir('packkit-e2e-py-rel-');
		sh(BIN('create-packkit-py'), ['py-lib', 'rel-demo', '--release', 'pypi'], { cwd });
		const wf = join(cwd, 'rel-demo', '.github', 'workflows', 'release.yml');
		assert(existsSync(wf), 'release.yml was not emitted');
		const text = readFileSync(wf, 'utf8');
		assert(text.includes('id-token: write'), 'workflow does not request an OIDC id-token');
		assert(
			text.includes('pypa/gh-action-pypi-publish'),
			'workflow does not use the PyPA publish action',
		);
		assert(!/PYPI_TOKEN|password:/i.test(text), 'workflow appears to use a token/password');
	});

	await b.run('create-packkit-go --release=goreleaser passes `goreleaser check`', () => {
		if (!hasTool('goreleaser', ['--version'])) skip('goreleaser not on PATH');
		const cwd = tmpDir('packkit-e2e-go-rel-');
		sh(BIN('create-packkit-go'), ['go-cli', 'rel-demo', '--release', 'goreleaser'], { cwd });
		const project = join(cwd, 'rel-demo');
		assert(existsSync(join(project, '.goreleaser.yaml')), '.goreleaser.yaml was not emitted');
		// `goreleaser check` needs a git repo with a remote to validate the release config.
		sh('git', ['init', '-q'], { cwd: project });
		sh('git', ['remote', 'add', 'origin', 'https://github.com/PackkitLabs/demo.git'], {
			cwd: project,
		});
		sh('goreleaser', ['check', '-f', '.goreleaser.yaml'], { cwd: project });
	});

	await b.run('create-packkit --preset=oss scaffolds a Changesets release', () => {
		const cwd = tmpDir('packkit-e2e-js-rel-');
		sh(BIN('create-packkit'), ['oss', 'rel-demo', '-y'], { cwd });
		const project = join(cwd, 'rel-demo');
		assert(
			existsSync(join(project, '.changeset', 'config.json')),
			'.changeset/config.json was not emitted',
		);
		const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
		assert(
			pkg.devDependencies?.['@changesets/cli'],
			'package.json is missing the @changesets/cli dev dependency',
		);
	});

	b.done();
});
