import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Integration test that verifies the map editor panel opens when the
 * openMapEditor command is executed. Runs in a real VS Code instance.
 */
suite('Map Editor Open Integration Tests', () => {
    const TEST_TIMEOUT = 15000;

    suiteSetup(async function() {
        this.timeout(30000);

        const extension = vscode.extensions.getExtension('christofferlind.vscode-maplibre-viewer');
        if (!extension) {
            throw new Error('Extension not found');
        }
        if (!extension.isActive) {
            await extension.activate();
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    test('should have openMapEditor command registered', async function() {
        this.timeout(TEST_TIMEOUT);

        const commands = await vscode.commands.getCommands(true);
        const hasMapEditor = commands.includes('vscodeMaplibreViewer.openMapEditor');
        assert.ok(hasMapEditor, 'openMapEditor command should be registered');
    });

    test('should open the map editor panel when command is executed', async function() {
        this.timeout(TEST_TIMEOUT);

        await vscode.commands.executeCommand('vscodeMaplibreViewer.openMapEditor');

        await new Promise(resolve => setTimeout(resolve, 1000));

        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
        const editorTab = tabs.find(tab => {
            const input = tab.input as { viewType?: string };
            return input && typeof input.viewType === 'string' && input.viewType.endsWith('mapEditor');
        });

        assert.ok(editorTab, 'A mapEditor webview panel tab should be open');
    });

    test('should open the map editor panel with the expected title', async function() {
        this.timeout(TEST_TIMEOUT);

        await vscode.commands.executeCommand('vscodeMaplibreViewer.openMapEditor');

        await new Promise(resolve => setTimeout(resolve, 1000));

        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
        const editorTab = tabs.find(tab => {
            const input = tab.input as { viewType?: string };
            return input && typeof input.viewType === 'string' && input.viewType.endsWith('mapEditor');
        });

        assert.ok(editorTab, 'A mapEditor webview panel tab should be open');
        assert.strictEqual(editorTab!.label, 'Map Viewer Editor');
    });
});
