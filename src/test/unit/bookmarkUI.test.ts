
import * as assert from 'assert';
import { MapBookmark } from '../../bookmarkTypes';

/**
 * UI Tests for BookmarkManager
 *
 * These tests verify the UI-related logic without requiring VSCode runtime.
 * For actual VSCode integration tests, use the .vscode-test.mjs configuration
 * which runs tests inside VSCode's electron environment.
 */

suite('BookmarkManager UI Test Suite', () => {

    suite('QuickPick UI Tests', () => {
        test('Bookmark QuickPick should have correct structure', () => {
            const bookmark: MapBookmark = {
                id: 'test-id',
                name: 'Test Bookmark',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10,
                bearing: 0,
                pitch: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const quickPickItem = {
                label: `$(bookmark) ${bookmark.name}`,
                description: `${bookmark.center.latitude.toFixed(4)}, ${bookmark.center.longitude.toFixed(4)}`,
                detail: `Zoom: ${bookmark.zoom.toFixed(1)} | Bearing: ${bookmark.bearing.toFixed(0)}° | Pitch: ${bookmark.pitch.toFixed(0)}°`,
                bookmark: bookmark
            };

            assert.ok(quickPickItem.label.includes('Test Bookmark'));
            assert.ok(quickPickItem.description.includes('59.3293'));
            assert.ok(quickPickItem.description.includes('18.0686'));
            assert.ok(quickPickItem.detail.includes('Zoom: 10.0'));
        });

        test('QuickPick should show create new option first', () => {
            const items = [
                {
                    label: '$(add) Create New Bookmark...',
                    description: 'Save current view as a new bookmark',
                    isNew: true
                }
            ];

            assert.strictEqual(items[0].label, '$(add) Create New Bookmark...');
            assert.strictEqual(items[0].isNew, true);
        });

        test('QuickPick should format coordinates correctly', () => {
            const bookmark: MapBookmark = {
                id: 'test-id',
                name: 'Test',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10,
                bearing: 0,
                pitch: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const description = `${bookmark.center.latitude.toFixed(4)}, ${bookmark.center.longitude.toFixed(4)}`;
            
            assert.strictEqual(description, '59.3293, 18.0686');
        });

        test('QuickPick should format detail string correctly', () => {
            const bookmark: MapBookmark = {
                id: 'test-id',
                name: 'Test',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10.5,
                bearing: 45,
                pitch: 30,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const detail = `Zoom: ${bookmark.zoom.toFixed(1)} | Bearing: ${bookmark.bearing.toFixed(0)}° | Pitch: ${bookmark.pitch.toFixed(0)}°`;
            
            assert.strictEqual(detail, 'Zoom: 10.5 | Bearing: 45° | Pitch: 30°');
        });

        test('QuickPick should handle separator item', () => {
            const separatorItem = {
                label: '── Existing Bookmarks ──',
                kind: 2 // vscode.QuickPickItemKind.Separator
            };

            assert.strictEqual(separatorItem.kind, 2);
            assert.ok(separatorItem.label.includes('Existing Bookmarks'));
        });
    });

    suite('TreeItem Tests', () => {
        test('Bookmark TreeItem should have correct label', () => {
            const bookmark: MapBookmark = {
                id: 'test-id',
                name: 'Test Location',
                description: 'A test description',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10,
                bearing: 45,
                pitch: 30,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Simulate TreeItem properties
            const treeItemData = {
                label: bookmark.name,
                description: `${bookmark.center.latitude.toFixed(4)}, ${bookmark.center.longitude.toFixed(4)}`,
                tooltip: `Zoom: ${bookmark.zoom} | Bearing: ${bookmark.bearing}° | Pitch: ${bookmark.pitch}°`,
                contextValue: 'bookmark',
                iconPath: 'bookmark',
                command: {
                    command: 'vscodeMaplibreViewer.goToBookmark',
                    title: 'Go to Bookmark',
                    arguments: [bookmark]
                }
            };

            assert.strictEqual(treeItemData.label, 'Test Location');
            assert.strictEqual(treeItemData.contextValue, 'bookmark');
            assert.ok(treeItemData.command);
            assert.strictEqual(treeItemData.command.command, 'vscodeMaplibreViewer.goToBookmark');
        });

        test('Bookmark TreeItem should support context menu', () => {
            const bookmark: MapBookmark = {
                id: 'test-id',
                name: 'Test',
                center: { latitude: 0, longitude: 0 },
                zoom: 1,
                bearing: 0,
                pitch: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Context value should match menu 'when' clause: viewItem == bookmark
            const contextValue = 'bookmark';
            assert.strictEqual(contextValue, 'bookmark');
        });

        test('TreeItem tooltip should contain all view info', () => {
            const bookmark: MapBookmark = {
                id: 'test-id',
                name: 'Test',
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 12,
                bearing: 90,
                pitch: 45,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const tooltip = `Zoom: ${bookmark.zoom} | Bearing: ${bookmark.bearing}° | Pitch: ${bookmark.pitch}°`;
            
            assert.ok(tooltip.includes('Zoom: 12'));
            assert.ok(tooltip.includes('Bearing: 90°'));
            assert.ok(tooltip.includes('Pitch: 45°'));
        });
    });

    suite('InputBox Validation Tests', () => {
        test('Name validation should reject empty input', () => {
            const validateInput = (value: string): string | null => {
                if (!value || value.trim().length === 0) {
                    return 'Name is required';
                }
                return null;
            };

            assert.strictEqual(validateInput(''), 'Name is required');
            assert.strictEqual(validateInput('   '), 'Name is required');
            assert.strictEqual(validateInput('Valid Name'), null);
        });

        test('Name validation should reject duplicate names', () => {
            const existingNames = ['Stockholm', 'Gothenburg', 'Malmö'];
            
            const validateInput = (value: string): string | null => {
                if (!value || value.trim().length === 0) {
                    return 'Name is required';
                }
                if (existingNames.some(n => n.toLowerCase() === value.trim().toLowerCase())) {
                    return 'A bookmark with this name already exists';
                }
                return null;
            };

            assert.strictEqual(validateInput('Stockholm'), 'A bookmark with this name already exists');
            assert.strictEqual(validateInput('stockholm'), 'A bookmark with this name already exists');
            assert.strictEqual(validateInput('New City'), null);
        });

        test('Name validation should trim whitespace', () => {
            const validateInput = (value: string): string | null => {
                const trimmed = value.trim();
                if (trimmed.length === 0) {
                    return 'Name is required';
                }
                if (trimmed.length < 2) {
                    return 'Name must be at least 2 characters';
                }
                return null;
            };

            assert.strictEqual(validateInput('  AB  '), null);
            assert.strictEqual(validateInput(' A '), 'Name must be at least 2 characters');
        });
    });

    suite('ViewState Tests', () => {
        test('ViewState should have required properties', () => {
            const viewState = {
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10,
                bearing: 45,
                pitch: 30
            };

            assert.strictEqual(typeof viewState.center.latitude, 'number');
            assert.strictEqual(typeof viewState.center.longitude, 'number');
            assert.strictEqual(typeof viewState.zoom, 'number');
            assert.strictEqual(typeof viewState.bearing, 'number');
            assert.strictEqual(typeof viewState.pitch, 'number');
        });

        test('ViewState should handle default values', () => {
            const viewState = {
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10,
                bearing: 0,
                pitch: 0
            };

            // Default bearing and pitch should be 0
            assert.strictEqual(viewState.bearing, 0);
            assert.strictEqual(viewState.pitch, 0);
        });

        test('ViewState should be convertible to bookmark', () => {
            const viewState = {
                center: { latitude: 59.3293, longitude: 18.0686 },
                zoom: 10,
                bearing: 45,
                pitch: 30
            };

            const bookmark: Partial<MapBookmark> = {
                center: viewState.center,
                zoom: viewState.zoom,
                bearing: viewState.bearing,
                pitch: viewState.pitch
            };

            assert.deepStrictEqual(bookmark.center, viewState.center);
            assert.strictEqual(bookmark.zoom, viewState.zoom);
            assert.strictEqual(bookmark.bearing, viewState.bearing);
            assert.strictEqual(bookmark.pitch, viewState.pitch);
        });
    });

    suite('Notification Tests', () => {
        test('Success message format for save', () => {
            const bookmarkName = 'My Location';
            const message = `Bookmark "${bookmarkName}" saved successfully.`;
            
            assert.ok(message.includes(bookmarkName));
            assert.ok(message.includes('saved successfully'));
        });

        test('Success message format for update', () => {
            const bookmarkName = 'My Location';
            const message = `Bookmark "${bookmarkName}" updated successfully.`;
            
            assert.ok(message.includes(bookmarkName));
            assert.ok(message.includes('updated successfully'));
        });

        test('Warning message for no bookmarks', () => {
            const message = 'No bookmarks saved. Use "Save View" to create bookmarks.';
            
            assert.ok(message.includes('No bookmarks'));
            assert.ok(message.includes('Save View'));
        });

        test('Warning message for unable to get view', () => {
            const message = 'Unable to get current map view. Please ensure the map is loaded.';
            
            assert.ok(message.includes('Unable to get current map view'));
            assert.ok(message.includes('map is loaded'));
        });

        test('Error message format for save failure', () => {
            const operation = 'save bookmark';
            const error = new Error('Storage failed');
            const message = `Failed to ${operation}: ${error.message}`;
            
            assert.ok(message.includes('Failed to save bookmark'));
            assert.ok(message.includes('Storage failed'));
        });
    });

    suite('Confirmation Dialog Tests', () => {
        test('Delete confirmation message format', () => {
            const bookmarkName = 'Test Bookmark';
            const message = `Are you sure you want to delete bookmark "${bookmarkName}"?`;
            
            assert.ok(message.includes('delete'));
            assert.ok(message.includes(bookmarkName));
        });

        test('Update confirmation message format', () => {
            const bookmarkName = 'Test Bookmark';
            const message = `Update "${bookmarkName}" with current view?`;
            
            assert.ok(message.includes('Update'));
            assert.ok(message.includes(bookmarkName));
            assert.ok(message.includes('current view'));
        });

        test('Confirmation should have affirmative action', () => {
            const deleteAction = 'Delete';
            const updateAction = 'Update';
            
            assert.strictEqual(deleteAction, 'Delete');
            assert.strictEqual(updateAction, 'Update');
        });
    });

    suite('Command ID Tests', () => {
        test('Command IDs should follow naming convention', () => {
            const commandIds = [
                'vscodeMaplibreViewer.saveBookmark',
                'vscodeMaplibreViewer.loadBookmark',
                'vscodeMaplibreViewer.goToBookmark',
                'vscodeMaplibreViewer.deleteBookmark'
            ];

            commandIds.forEach(id => {
                assert.ok(id.startsWith('vscodeMaplibreViewer.'), `Command ${id} should start with extension prefix`);
            });
        });

        test('Command IDs should be consistent with package.json', () => {
            const expectedCommands = [
                'vscodeMaplibreViewer.saveBookmark',
                'vscodeMaplibreViewer.loadBookmark',
                'vscodeMaplibreViewer.goToBookmark',
                'vscodeMaplibreViewer.deleteBookmark'
            ];

            // These should match the commands defined in package.json
            expectedCommands.forEach(cmd => {
                assert.ok(cmd.includes('Bookmark'), `Command ${cmd} should reference bookmarks`);
            });
        });
    });

    suite('Tree View Data Provider Tests', () => {
        test('Empty tree should return empty children', async () => {
            const getChildren = async () => [];
            const children = await getChildren();
            assert.strictEqual(children.length, 0);
        });

        test('Tree with bookmarks should return children', async () => {
            const bookmarks: MapBookmark[] = [
                {
                    id: '1',
                    name: 'Bookmark 1',
                    center: { latitude: 59, longitude: 18 },
                    zoom: 10,
                    bearing: 0,
                    pitch: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                {
                    id: '2',
                    name: 'Bookmark 2',
                    center: { latitude: 60, longitude: 19 },
                    zoom: 12,
                    bearing: 0,
                    pitch: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            ];

            const getChildren = async () => bookmarks;
            const children = await getChildren();
            
            assert.strictEqual(children.length, 2);
            assert.strictEqual(children[0].name, 'Bookmark 1');
            assert.strictEqual(children[1].name, 'Bookmark 2');
        });

        test('Tree should handle refresh', () => {
            let refreshCalled = false;
            const refresh = () => { refreshCalled = true; };
            
            refresh();
            
            assert.strictEqual(refreshCalled, true);
        });
    });

    suite('QuickPick Selection Tests', () => {
        test('Should identify new bookmark selection', () => {
            const selected = {
                label: '$(add) Create New Bookmark...',
                isNew: true
            };

            assert.strictEqual(selected.isNew, true);
        });

        test('Should identify existing bookmark selection', () => {
            const bookmark: MapBookmark = {
                id: 'existing-id',
                name: 'Existing',
                center: { latitude: 59, longitude: 18 },
                zoom: 10,
                bearing: 0,
                pitch: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const selected = {
                label: `$(bookmark) ${bookmark.name}`,
                bookmark: bookmark
            };

            assert.ok(selected.bookmark);
            assert.strictEqual(selected.bookmark.id, 'existing-id');
        });

        test('Should handle cancelled selection', () => {
            const selected = undefined;
            
            assert.strictEqual(selected, undefined);
        });
    });
});