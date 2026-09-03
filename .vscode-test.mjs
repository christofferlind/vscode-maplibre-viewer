import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/integration/**/*.test.*js',
	extensionDevelopmentPath: '.',
	launchArgs: ['--user-data-dir', '/tmp/vscode-mlv-test'],
	mocha: {
		ui: 'tdd',
	}
});