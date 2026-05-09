import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.*js',
	launchArgs: ['--user-data-dir', '/tmp/vscode-mlv-test'],
	mocha: {
		ui: 'tdd',
	}
});