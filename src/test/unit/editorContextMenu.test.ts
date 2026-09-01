import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface CommandContribution {
    command: string;
    title: string;
    category?: string;
}

interface MenuContribution {
    command?: string;
    submenu?: string;
    when?: string;
    group?: string;
}

interface SubmenuContribution {
    id: string;
    label: string;
}

interface PackageJson {
    name: string;
    version: string;
    contributes: {
        commands: CommandContribution[];
        menus: Record<string, MenuContribution[]>;
        submenus: SubmenuContribution[];
    };
}

suite('Editor Context Menu Package Manifest Tests', () => {
    let packageJson: PackageJson;

    suiteSetup(() => {
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
    });

    test('Should define searchOnMap command', () => {
        const command = packageJson.contributes.commands.find(
            (cmd) => cmd.command === 'vscodeMaplibreViewer.searchOnMap'
        );
        assert.ok(command, 'searchOnMap command should be contributed');
        assert.strictEqual(command?.title, 'Search On Map');
    });

    test('Should register MapLibre Viewer submenu in editor/context', () => {
        const editorContext = packageJson.contributes.menus['editor/context'];
        assert.ok(editorContext, 'editor/context menu should be contributed');
        const submenuEntry = editorContext.find((entry) => entry.submenu === 'editor/context/maplibreViewer');
        assert.ok(submenuEntry, 'MapLibre Viewer submenu should be registered in editor/context');
        assert.strictEqual(submenuEntry?.when, undefined, 'submenu should always be visible');
    });

    test('Should declare MapLibre Viewer submenu with label', () => {
        const submenu = packageJson.contributes.submenus.find(
            (menu) => menu.id === 'editor/context/maplibreViewer'
        );
        assert.ok(submenu, 'MapLibre Viewer submenu should be declared');
        assert.strictEqual(submenu?.label, 'MapLibre Viewer');
    });

    test('Should place searchOnMap command inside the MapLibre Viewer submenu', () => {
        const submenuItems = packageJson.contributes.menus['editor/context/maplibreViewer'];
        assert.ok(submenuItems, 'MapLibre Viewer submenu items should be contributed');
        const searchEntry = submenuItems.find(
            (entry) => entry.command === 'vscodeMaplibreViewer.searchOnMap'
        );
        assert.ok(searchEntry, 'searchOnMap should be inside the MapLibre Viewer submenu');
        assert.strictEqual(searchEntry?.when, 'editorHasSelection', 'submenu item should show with a selection');
    });

    test('Should keep every submenu item command declared in commands', () => {
        const declaredCommands = new Set(packageJson.contributes.commands.map((cmd) => cmd.command));
        const submenuItems = packageJson.contributes.menus['editor/context/maplibreViewer'] ?? [];
        submenuItems.forEach((entry) => {
            if (entry.command) {
                assert.ok(
                    declaredCommands.has(entry.command),
                    `Command ${entry.command} referenced by submenu should be declared`
                );
            }
        });
    });
});

suite('Terminal Context Menu Package Manifest Tests', () => {
    let packageJson: PackageJson;

    suiteSetup(() => {
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
    });

    test('Should register MapLibre Viewer submenu in terminal/context when text is selected', () => {
        const terminalContext = packageJson.contributes.menus['terminal/context'];
        assert.ok(terminalContext, 'terminal/context menu should be contributed');
        const submenuEntry = terminalContext.find(
            (entry) => entry.submenu === 'terminal/context/maplibreViewer'
        );
        assert.ok(submenuEntry, 'MapLibre Viewer submenu should be registered in terminal/context');
        assert.strictEqual(submenuEntry?.when, 'terminalTextSelected');
    });

    test('Should declare terminal MapLibre Viewer submenu with label', () => {
        const submenu = packageJson.contributes.submenus.find(
            (menu) => menu.id === 'terminal/context/maplibreViewer'
        );
        assert.ok(submenu, 'terminal MapLibre Viewer submenu should be declared');
        assert.strictEqual(submenu?.label, 'MapLibre Viewer');
    });

    test('Should place searchOnMap command inside the terminal submenu when text is selected', () => {
        const submenuItems = packageJson.contributes.menus['terminal/context/maplibreViewer'];
        assert.ok(submenuItems, 'terminal submenu items should be contributed');
        const searchEntry = submenuItems.find(
            (entry) => entry.command === 'vscodeMaplibreViewer.searchOnMap'
        );
        assert.ok(searchEntry, 'searchOnMap should be inside the terminal submenu');
        assert.strictEqual(searchEntry?.when, 'terminalTextSelected');
    });

    test('Should keep every terminal submenu item command declared in commands', () => {
        const declaredCommands = new Set(packageJson.contributes.commands.map((cmd) => cmd.command));
        const submenuItems = packageJson.contributes.menus['terminal/context/maplibreViewer'] ?? [];
        submenuItems.forEach((entry) => {
            if (entry.command) {
                assert.ok(
                    declaredCommands.has(entry.command),
                    `Command ${entry.command} referenced by terminal submenu should be declared`
                );
            }
        });
    });

    test('Should not contribute searchOnMap directly to terminal/context anymore', () => {
        const terminalContext = packageJson.contributes.menus['terminal/context'] ?? [];
        const directCommand = terminalContext.find(
            (entry) => entry.command === 'vscodeMaplibreViewer.searchOnMap'
        );
        assert.strictEqual(directCommand, undefined, 'searchOnMap should be nested in the submenu');
    });
});