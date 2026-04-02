// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Interface for configuration messages sent to the webview
interface MapConfig {
	mapStyleUrl: string;
	geocodingApiKey: string;
	enableSearch: boolean;
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

	// Register the Maps webview provider
	const mapsViewProvider = new MapViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('mapsView', mapsViewProvider)
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
}

// This method is called when your extension is deactivated
export function deactivate() {}

class MapViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'mapsView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
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
	 * Gets the current configuration from VS Code settings
	 */
	private getConfiguration(): MapConfig {
		const config = vscode.workspace.getConfiguration('vscodeMaplibreViewer');
		return {
			mapStyleUrl: config.get<string>('mapStyleUrl') || 'https://demotiles.maplibre.org/style.json',
			geocodingApiKey: config.get<string>('geocodingApiKey') || '',
			enableSearch: config.get<boolean>('enableSearch') ?? true
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
