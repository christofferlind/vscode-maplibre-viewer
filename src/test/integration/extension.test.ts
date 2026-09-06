import * as assert from 'assert';
import * as vscode from 'vscode';
import { activateViewGroup } from '../testUtils/integrationSetup';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	suiteSetup(async function() {
		this.timeout(30000);

		// Activate the extension and focus the contributed maps view group so
		// the sidebar webview is resolved before tests run.
		await activateViewGroup();
	});

	// void vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});
});
