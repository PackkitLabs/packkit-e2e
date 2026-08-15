// J1 — generate → build → test, per language × target, via the PUBLISHED CLI (SPEC §3).
//
// Scaffold a project with each published generator CLI (resolved to @latest by the
// harness's own install), then run the emitted project's OWN toolchain with the real
// tools. Because each project does a fresh dependency install, this also catches
// transitive-dependency rot that the generators' pinned integration tests can't see.
//
// Filter locally with E2E_GENERATORS=go,py and/or E2E_TARGETS=lib,service.
import { join } from 'node:path';
import { journey, sh, batch, hasTool, skip, tmpDir } from '../lib/harness.mjs';

const BIN = (name) => join(process.cwd(), 'node_modules', '.bin', name);

// language → how to build+test a scaffolded project, and which tool gates it.
const TOOLCHAINS = {
	js: {
		tool: () => hasTool('npm', ['--version']),
		toolName: 'npm',
		build: (dir) => {
			sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir });
			sh('npm', ['run', 'build'], { cwd: dir });
			sh('npm', ['test'], { cwd: dir });
		},
	},
	py: {
		tool: () => hasTool('uv', ['--version']),
		toolName: 'uv',
		build: (dir) => {
			sh('uv', ['sync', '--all-extras'], { cwd: dir });
			sh('uv', ['run', 'pytest'], { cwd: dir });
		},
	},
	go: {
		tool: () => hasTool('go', ['version']),
		toolName: 'go',
		build: (dir) => {
			sh('go', ['build', './...'], { cwd: dir });
			sh('go', ['test', './...'], { cwd: dir });
		},
	},
};

// generator → CLI bin + how it takes a preset/name, and its per-target presets keyed by
// the neutral target name (so E2E_TARGETS filters uniformly across languages).
const GENERATORS = {
	js: {
		bin: 'create-packkit',
		scaffold: (bin, preset, name, cwd) => sh(bin, [preset, name, '-y'], { cwd }),
		targets: { lib: 'ts-lib', service: 'node-service' },
	},
	py: {
		bin: 'create-packkit-py',
		scaffold: (bin, preset, name, cwd) => sh(bin, [preset, name], { cwd }),
		targets: { lib: 'py-lib', cli: 'py-cli', worker: 'py-worker', service: 'py-service' },
	},
	go: {
		bin: 'create-packkit-go',
		scaffold: (bin, preset, name, cwd) => sh(bin, [preset, name], { cwd }),
		targets: { lib: 'go-lib', cli: 'go-cli', worker: 'go-worker', service: 'go-service' },
	},
};

const envList = (name) =>
	process.env[name]
		? process.env[name]
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: null;

journey('j1', 'generate → build → test (published CLIs)', async () => {
	const b = batch();
	const genFilter = envList('E2E_GENERATORS');
	const targetFilter = envList('E2E_TARGETS');

	for (const [lang, gen] of Object.entries(GENERATORS)) {
		if (genFilter && !genFilter.includes(lang)) continue;
		const chain = TOOLCHAINS[lang];
		for (const [target, preset] of Object.entries(gen.targets)) {
			if (targetFilter && !targetFilter.includes(target)) continue;
			await b.run(`${gen.bin} ${preset} → build + test`, () => {
				if (!chain.tool()) skip(`${chain.toolName} not on PATH`);
				const cwd = tmpDir(`packkit-e2e-${lang}-${target}-`);
				const name = `${preset}-demo`;
				gen.scaffold(BIN(gen.bin), preset, name, cwd);
				chain.build(join(cwd, name));
			});
		}
	}

	b.done();
});
