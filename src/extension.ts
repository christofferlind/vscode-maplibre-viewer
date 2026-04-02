// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseCoordinate, parseMultipleCoordinates, calculateBoundingBox, Coordinate } from './coordinateParser';
import { BookmarkManager } from './bookmarkManager';
import { MapBookmark, ViewState } from './bookmarkTypes';
import { BookmarkTreeProvider } from './bookmarkTreeProvider';

// Interface for configuration messages sent to the webview
interface MapConfig {
	mapStyleUrl: string;
	geocodingApiKey: string;
	enableSearch: boolean;
	flyToDuration: number;
}

// Interface for language options in Quick Pick
interface LanguageOption {
	label: string;
	description: string;
	languageCode: string;
}

// Comprehensive list of supported languages for map labels
const LANGUAGE_OPTIONS: LanguageOption[] = [
	{ label: 'Native (Local)', description: 'Use native/local place names', languageCode: 'native' },
	{ label: 'English', description: 'English', languageCode: 'en' },
	{ label: 'German', description: 'Deutsch', languageCode: 'de' },
	{ label: 'French', description: 'Français', languageCode: 'fr' },
	{ label: 'Spanish', description: 'Español', languageCode: 'es' },
	{ label: 'Russian', description: 'Русский', languageCode: 'ru' },
	{ label: 'Chinese (Simplified)', description: '简体中文', languageCode: 'zh-Hans' },
	{ label: 'Chinese (Traditional)', description: '繁體中文', languageCode: 'zh-Hant' },
	{ label: 'Japanese', description: '日本語', languageCode: 'ja' },
	{ label: 'Korean', description: '한국어', languageCode: 'ko' },
	{ label: 'Italian', description: 'Italiano', languageCode: 'it' },
	{ label: 'Portuguese', description: 'Português', languageCode: 'pt' },
	{ label: 'Portuguese (Brazil)', description: 'Português (Brasil)', languageCode: 'pt-BR' },
	{ label: 'Arabic', description: 'العربية', languageCode: 'ar' },
	{ label: 'Hindi', description: 'हिन्दी', languageCode: 'hi' },
	{ label: 'Dutch', description: 'Nederlands', languageCode: 'nl' },
	{ label: 'Polish', description: 'Polski', languageCode: 'pl' },
	{ label: 'Turkish', description: 'Türkçe', languageCode: 'tr' },
	{ label: 'Indonesian', description: 'Bahasa Indonesia', languageCode: 'id' },
	{ label: 'Vietnamese', description: 'Tiếng Việt', languageCode: 'vi' },
	{ label: 'Thai', description: 'ไทย', languageCode: 'th' },
	{ label: 'Greek', description: 'Ελληνικά', languageCode: 'el' },
	{ label: 'Czech', description: 'Čeština', languageCode: 'cs' },
	{ label: 'Swedish', description: 'Svenska', languageCode: 'sv' },
	{ label: 'Norwegian', description: 'Norsk', languageCode: 'no' },
	{ label: 'Danish', description: 'Dansk', languageCode: 'da' },
	{ label: 'Finnish', description: 'Suomi', languageCode: 'fi' },
	{ label: 'Hungarian', description: 'Magyar', languageCode: 'hu' },
	{ label: 'Romanian', description: 'Română', languageCode: 'ro' },
	{ label: 'Ukrainian', description: 'Українська', languageCode: 'uk' },
	{ label: 'Hebrew', description: 'עברית', languageCode: 'he' },
	{ label: 'Persian', description: 'فارسی', languageCode: 'fa' },
	{ label: 'Bengali', description: 'বাংলা', languageCode: 'bn' },
	{ label: 'Tamil', description: 'தமிழ்', languageCode: 'ta' },
	{ label: 'Telugu', description: 'తెలుగు', languageCode: 'te' },
	{ label: 'Malayalam', description: 'മലയാളം', languageCode: 'ml' },
	{ label: 'Kannada', description: 'ಕನ್ನಡ', languageCode: 'kn' },
	{ label: 'Marathi', description: 'मराठी', languageCode: 'mr' },
	{ label: 'Gujarati', description: 'ગુજરાતી', languageCode: 'gu' },
	{ label: 'Punjabi', description: 'ਪੰਜਾਬੀ', languageCode: 'pa' },
	{ label: 'Urdu', description: 'اردو', languageCode: 'ur' },
	{ label: 'Kazakh', description: 'Қазақ', languageCode: 'kk' },
	{ label: 'Uzbek', description: 'Oʻzbek', languageCode: 'uz' },
	{ label: 'Azerbaijani', description: 'Azərbaycan', languageCode: 'az' },
	{ label: 'Georgian', description: 'ქართული', languageCode: 'ka' },
	{ label: 'Armenian', description: 'Հայերեն', languageCode: 'hy' },
	{ label: 'Lithuanian', description: 'Lietuvių', languageCode: 'lt' },
	{ label: 'Latvian', description: 'Latviešu', languageCode: 'lv' },
	{ label: 'Estonian', description: 'Eesti', languageCode: 'et' },
	{ label: 'Slovak', description: 'Slovenčina', languageCode: 'sk' },
	{ label: 'Slovenian', description: 'Slovenščina', languageCode: 'sl' },
	{ label: 'Croatian', description: 'Hrvatski', languageCode: 'hr' },
	{ label: 'Serbian', description: 'Српски', languageCode: 'sr' },
	{ label: 'Bulgarian', description: 'Български', languageCode: 'bg' },
	{ label: 'Macedonian', description: 'Македонски', languageCode: 'mk' },
	{ label: 'Albanian', description: 'Shqip', languageCode: 'sq' },
	{ label: 'Basque', description: 'Euskara', languageCode: 'eu' },
	{ label: 'Catalan', description: 'Català', languageCode: 'ca' },
	{ label: 'Galician', description: 'Galego', languageCode: 'gl' },
	{ label: 'Welsh', description: 'Cymraeg', languageCode: 'cy' },
	{ label: 'Irish', description: 'Gaeilge', languageCode: 'ga' },
	{ label: 'Scottish Gaelic', description: 'Gàidhlig', languageCode: 'gd' },
	{ label: 'Breton', description: 'Brezhoneg', languageCode: 'br' },
	{ label: 'Icelandic', description: 'Íslenska', languageCode: 'is' },
	{ label: 'Malay', description: 'Bahasa Melayu', languageCode: 'ms' },
	{ label: 'Filipino', description: 'Filipino', languageCode: 'fil' },
	{ label: 'Burmese', description: 'မြန်မာ', languageCode: 'my' },
	{ label: 'Khmer', description: 'ខ្មែរ', languageCode: 'km' },
	{ label: 'Lao', description: 'ລາວ', languageCode: 'lo' },
	{ label: 'Nepali', description: 'नेपाली', languageCode: 'ne' },
	{ label: 'Sinhala', description: 'සිංහල', languageCode: 'si' },
	{ label: 'Amharic', description: 'አማርኛ', languageCode: 'am' },
	{ label: 'Swahili', description: 'Kiswahili', languageCode: 'sw' },
	{ label: 'Afrikaans', description: 'Afrikaans', languageCode: 'af' },
	{ label: 'Zulu', description: 'isiZulu', languageCode: 'zu' },
	{ label: 'Xhosa', description: 'isiXhosa', languageCode: 'xh' }
];

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-maplibre-viewer" is now active!');

	// Initialize coordinate selection state from globalState (default: true)
	// MUST be set BEFORE registering the webview view provider
	const coordinateSelectionEnabled = context.globalState.get<boolean>('coordinateSelectionEnabled', true);
	
	// Set the context variable for the toolbar icon
	vscode.commands.executeCommand('setContext', 'maplibreView.coordinateSelectionEnabled', coordinateSelectionEnabled);

	// Initialize BookmarkManager with globalState for persistence
	const bookmarkManager = new BookmarkManager(context.globalState);

	// Register the Maps webview provider
	const mapsViewProvider = new MapViewProvider(context.extensionUri, bookmarkManager);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('mapsView', mapsViewProvider)
	);

	// Initialize and register the Bookmark Tree Provider
	const bookmarkTreeProvider = new BookmarkTreeProvider(bookmarkManager);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('bookmarksView', bookmarkTreeProvider)
	);

	// Register command to navigate to a bookmark from the tree view
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.goToBookmark', (bookmark: MapBookmark) => {
			mapsViewProvider.flyToBookmark(bookmark);
		})
	);

	// Register command to delete a bookmark from the tree view context menu
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.deleteBookmark', async (bookmark: MapBookmark) => {
			const confirm = await vscode.window.showWarningMessage(
				`Are you sure you want to delete bookmark "${bookmark.name}"?`,
				'Delete',
				'Cancel'
			);

			if (confirm === 'Delete') {
				await bookmarkManager.deleteBookmark(bookmark.id);
				bookmarkTreeProvider.refresh();
				vscode.window.showInformationMessage(`Bookmark "${bookmark.name}" deleted.`);
			}
		})
	);

	// Register configuration change listener
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('vscodeMaplibreViewer')) {
				mapsViewProvider.updateConfiguration();
			}
		})
	);

	// Register language change commands
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.setLanguageNative', () => {
			mapsViewProvider.setMapLanguage('native');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.setLanguageEnglish', () => {
			mapsViewProvider.setMapLanguage('en');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.setLanguageGerman', () => {
			mapsViewProvider.setMapLanguage('de');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.setLanguage', async () => {
			const selected = await vscode.window.showQuickPick(LANGUAGE_OPTIONS, {
				placeHolder: 'Select a language for map labels',
				matchOnDescription: true,
				matchOnDetail: true
			});

			if (selected) {
				mapsViewProvider.setMapLanguage(selected.languageCode);
			}
		})
	);

	// Register toggle coordinate selection command
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.toggleCoordinateSelection', async () => {
			const currentState = context.globalState.get<boolean>('coordinateSelectionEnabled', true);
			const newState = !currentState;
			
			// Update the state
			await context.globalState.update('coordinateSelectionEnabled', newState);
			
			// Update the context variable for the toolbar icon
			vscode.commands.executeCommand('setContext', 'maplibreView.coordinateSelectionEnabled', newState);
			
			// Show a message to the user
			vscode.window.showInformationMessage(
				`Coordinate selection ${newState ? 'enabled' : 'disabled'}`
			);
		})
	);

	// Register open settings command
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.openSettings', () => {
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'vscodeMaplibreViewer'
			);
		})
	);

	// Register save view command - opens QuickPick with existing bookmarks or option to create new
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.saveBookmark', async () => {
			// Get current view state from the webview
			const viewState = await mapsViewProvider.getCurrentViewState();
			
			if (!viewState) {
				vscode.window.showWarningMessage('Unable to get current map view. Please ensure the map is loaded.');
				return;
			}

			const bookmarks = bookmarkManager.getAllBookmarks();
			
			// Create QuickPick items: existing bookmarks + option to create new
			const items: (vscode.QuickPickItem & { bookmark?: MapBookmark; isNew?: boolean })[] = [
				{
					label: '$(add) Create New Bookmark...',
					description: 'Save current view as a new bookmark',
					isNew: true
				}
			];
			
			// Add existing bookmarks if any
			if (bookmarks.length > 0) {
				items.push({
					label: '── Existing Bookmarks ──',
					kind: vscode.QuickPickItemKind.Separator
				});
				
				bookmarks.forEach(b => {
					items.push({
						label: `$(bookmark) ${b.name}`,
						description: `${b.center.latitude.toFixed(4)}, ${b.center.longitude.toFixed(4)}`,
						detail: `Zoom: ${b.zoom.toFixed(1)} | Bearing: ${b.bearing.toFixed(0)}° | Pitch: ${b.pitch.toFixed(0)}°`,
						bookmark: b
					});
				});
			}

			// Show QuickPick
			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select an existing bookmark to update or create a new one',
				matchOnDescription: true,
				matchOnDetail: true
			});

			// User cancelled the selection
			if (!selected) {
				return;
			}

			// Handle selection
			if (selected.isNew) {
				// Create new bookmark - prompt for name
				const name = await vscode.window.showInputBox({
					prompt: 'Enter a name for this bookmark',
					placeHolder: 'e.g., Office Location',
					validateInput: (value) => {
						if (!value || value.trim().length === 0) {
							return 'Name is required';
						}
						if (bookmarkManager.findByName(value)) {
							return 'A bookmark with this name already exists';
						}
						return null;
					}
				});

				if (!name) {
					return;
				}

				try {
					const bookmark = await bookmarkManager.createBookmark(name, viewState);
					bookmarkTreeProvider.refresh();
					vscode.window.showInformationMessage(`Bookmark "${bookmark.name}" saved successfully.`);
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to save bookmark: ${error}`);
				}
			} else if (selected.bookmark) {
				// Update existing bookmark
				const confirm = await vscode.window.showWarningMessage(
					`Update "${selected.bookmark.name}" with current view?`,
					'Update',
					'Cancel'
				);

				if (confirm !== 'Update') {
					return;
				}

				try {
					await bookmarkManager.updateBookmark(selected.bookmark.id, {
						center: viewState.center,
						zoom: viewState.zoom,
						bearing: viewState.bearing,
						pitch: viewState.pitch
					});
					bookmarkTreeProvider.refresh();
					vscode.window.showInformationMessage(`Bookmark "${selected.bookmark.name}" updated successfully.`);
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to update bookmark: ${error}`);
				}
			}
		})
	);

	// Register load place command - opens QuickPick with all bookmarks
	context.subscriptions.push(
		vscode.commands.registerCommand('vscodeMaplibreViewer.loadBookmark', async () => {
			const bookmarks = bookmarkManager.getAllBookmarks();
			
			if (bookmarks.length === 0) {
				vscode.window.showInformationMessage('No bookmarks saved. Use "Save View" to create bookmarks.');
				return;
			}

			// Create QuickPick items from bookmarks
			const items = bookmarks.map(b => ({
				label: b.name,
				description: `${b.center.latitude.toFixed(4)}, ${b.center.longitude.toFixed(4)}`,
				detail: `Zoom: ${b.zoom.toFixed(1)} | Bearing: ${b.bearing.toFixed(0)}° | Pitch: ${b.pitch.toFixed(0)}°`,
				bookmark: b
			}));

			// Show QuickPick
			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a saved place to load',
				matchOnDescription: true,
				matchOnDetail: true
			});

			// User cancelled the selection
			if (!selected) {
				return;
			}

			// Fly to the selected bookmark
			mapsViewProvider.flyToBookmark(selected.bookmark);
		})
	);

	// Debounce timer for text selection listener
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// Register text selection listener for coordinate parsing
	const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
		// Check if coordinate selection is enabled
		const isEnabled = context.globalState.get<boolean>('coordinateSelectionEnabled', true);
		if (!isEnabled) {
			return;
		}

		// Clear previous timer
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		// Debounce the handler (300ms)
		debounceTimer = setTimeout(() => {
			// Get the active editor
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			// Get the selected text
			const selection = editor.selection;
			if (selection.isEmpty) {
				return;
			}

			const selectedText = editor.document.getText(selection);
			if (!selectedText || selectedText.trim().length === 0) {
				return;
			}

			// Try to parse multiple coordinates from the selected text
			const coordinates = parseMultipleCoordinates(selectedText);
			
			if (coordinates.length > 1) {
				// Multiple coordinates found - calculate bounding box and fit all
				const bbox = calculateBoundingBox(coordinates);
				if (bbox) {
					mapsViewProvider.fitBoundingBox(coordinates, bbox);
				}
			} else if (coordinates.length === 1) {
				// Single coordinate - fly to it
				mapsViewProvider.flyToLocation(coordinates[0].latitude, coordinates[0].longitude);
			} else {
				// Fallback: try single coordinate parsing for backward compatibility
				const coordinate = parseCoordinate(selectedText);
				if (coordinate) {
					mapsViewProvider.flyToLocation(coordinate.latitude, coordinate.longitude);
				}
			}
		}, 300);
	});

	// Clean up the listener when the extension is deactivated
	context.subscriptions.push(selectionListener);
}

// This method is called when your extension is deactivated
export function deactivate() {}

class MapViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'mapsView';

	private _view?: vscode.WebviewView;
	private _pendingViewStateResolve?: (state: ViewState | undefined) => void;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _bookmarkManager: BookmarkManager
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, 'resources')
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(
			(message: any) => {
				this.handleWebviewMessage(message);
			},
			undefined,
			[]
		);
	}

	/**
	 * Updates the map configuration when settings change
	 */
	public updateConfiguration(): void {
		if (this._view) {
			const config = this.getConfiguration();
			this._view.webview.postMessage({
				type: 'configUpdate',
				config: config
			});
		}
	}

	/**
	 * Sets the map language for labels
	 * @param languageCode The language code ('native' for local names, or ISO 639-1 code like 'en', 'de', etc.)
	 */
	public setMapLanguage(languageCode: string): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'languageChange',
				language: languageCode
			});
		}
	}

	/**
	 * Flies to a specific location on the map
	 * @param latitude The latitude coordinate
	 * @param longitude The longitude coordinate
	 */
	public flyToLocation(latitude: number, longitude: number): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'flyToLocation',
				latitude: latitude,
				longitude: longitude
			});
		}
	}

	/**
	 * Fits the map to show all coordinates within a bounding box
	 * @param coordinates Array of coordinates to display
	 * @param bbox The bounding box containing southwest and northeast corners
	 */
	public fitBoundingBox(coordinates: Coordinate[], bbox: { southwest: Coordinate; northeast: Coordinate }): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'fitBoundingBox',
				coordinates: coordinates,
				boundingBox: bbox
			});
		}
	}

	/**
	 * Flies to a bookmark location on the map
	 * @param bookmark The bookmark to fly to
	 */
	public flyToBookmark(bookmark: MapBookmark): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'flyToBookmark',
				bookmark: bookmark
			});
		}
	}

	/**
	 * Gets the current view state from the webview
	 * @returns Promise resolving to the current view state, or undefined if unavailable
	 */
	public async getCurrentViewState(): Promise<ViewState | undefined> {
		if (!this._view) {
			return undefined;
		}

		return new Promise<ViewState | undefined>((resolve) => {
			// Store the resolve function to be called when we receive the response
			this._pendingViewStateResolve = resolve;
			
			// Request the view state from the webview
			this._view?.webview.postMessage({ type: 'requestViewState' });
			
			// Set a timeout to resolve with undefined if no response
			setTimeout(() => {
				if (this._pendingViewStateResolve) {
					this._pendingViewStateResolve = undefined;
					resolve(undefined);
				}
			}, 5000);
		});
	}

	/**
	 * Handles messages from the webview
	 * @param message The message from the webview
	 */
	public async handleWebviewMessage(message: any): Promise<void> {
		switch (message.type) {
			case 'viewStateChanged':
				if (this._pendingViewStateResolve) {
					const viewState = message.viewState;
					if (viewState && viewState.center) {
						this._pendingViewStateResolve({
							center: {
								latitude: viewState.center.lat || viewState.center.latitude,
								longitude: viewState.center.lng || viewState.center.longitude
							},
							zoom: viewState.zoom,
							bearing: viewState.bearing || 0,
							pitch: viewState.pitch || 0
						});
					} else {
						this._pendingViewStateResolve(undefined);
					}
					this._pendingViewStateResolve = undefined;
				}
				break;
		}
	}

	/**
	 * Gets the current configuration from VS Code settings
	 */
	private getConfiguration(): MapConfig {
		const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
		return {
			mapStyleUrl: config.get<string>('mapStyleUrl') || 'https://demotiles.maplibre.org/style.json',
			geocodingApiKey: config.get<string>('geocodingApiKey') || '',
			enableSearch: config.get<boolean>('enableSearch') ?? true,
			flyToDuration: config.get<number>('flyToDuration') ?? 500
		};
	}

	/**
	 * Gets the webview URI for a local resource file
	 */
	private _getUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
		const fileUri = vscode.Uri.joinPath(this._extensionUri, ...pathSegments);
		return webview.asWebviewUri(fileUri);
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();
		
		// Get the current configuration
		const config = this.getConfiguration();

		// Get webview URIs for local MapLibre assets
		const maplibreJsUri = this._getUri(webview, 'resources', 'maplibre-gl', 'maplibre-gl.js');
		const maplibreCssUri = this._getUri(webview, 'resources', 'maplibre-gl', 'maplibre-gl.css');

		// Read the worker script and encode it as base64 for inline Blob URL
		// This is needed because VS Code webviews have cross-origin restrictions for Workers
		const workerPath = path.join(this._extensionUri.fsPath, 'resources', 'maplibre-gl', 'maplibre-gl-worker.js');
		const workerContent = fs.readFileSync(workerPath, 'utf8');
		const workerBase64 = Buffer.from(workerContent).toString('base64');

		// Read the HTML template from the resources folder
		const htmlPath = path.join(this._extensionUri.fsPath, 'resources', 'map-view.html');
		let htmlContent = fs.readFileSync(htmlPath, 'utf8');

		// Replace the placeholders with actual values
		htmlContent = htmlContent.replace(/\$\{cspSource\}/g, webview.cspSource);
		htmlContent = htmlContent.replace(/\$\{nonce\}/g, nonce);
		htmlContent = htmlContent.replace(/\$\{mapStyleUrl\}/g, config.mapStyleUrl);
		htmlContent = htmlContent.replace(/\$\{geocodingApiKey\}/g, config.geocodingApiKey);
		htmlContent = htmlContent.replace(/\$\{enableSearch\}/g, String(config.enableSearch));
		htmlContent = htmlContent.replace(/\$\{flyToDuration\}/g, String(config.flyToDuration));
		
		// Replace MapLibre asset URIs
		htmlContent = htmlContent.replace(/\$\{maplibreJsUri\}/g, maplibreJsUri.toString());
		htmlContent = htmlContent.replace(/\$\{maplibreCssUri\}/g, maplibreCssUri.toString());
		htmlContent = htmlContent.replace(/\$\{maplibreWorkerBase64\}/g, workerBase64);

		return htmlContent;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}