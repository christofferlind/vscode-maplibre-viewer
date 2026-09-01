/**
 * Pure helpers for resolving terminal selection text without depending on the vscode API.
 * Keeping these vscode-free allows fast unit testing outside the extension host.
 */

/**
 * Clipboard contents captured before and after triggering a terminal copy command.
 */
export interface TerminalClipboardProbe {
	readonly before: string;
	readonly after: string;
}

/**
 * Resolves the terminal's selected text from a clipboard copy probe.
 *
 * The terminal copy command only writes to the clipboard when text is selected, so an
 * unchanged clipboard means there was no selection to copy.
 *
 * @param probe The clipboard contents before and after the copy probe.
 * @returns The trimmed selected text, or an empty string when nothing was copied.
 */
export function resolveSelectedTextFromTerminalProbe(probe: TerminalClipboardProbe): string {
	if (probe.after !== probe.before) {
		return probe.after.trim();
	}
	return '';
}

/**
 * Determines whether command arguments originate from the terminal context menu.
 *
 * The terminal context menu forwards a serialized terminal instance context that carries an
 * `instanceId`, whereas editor context menus forward a resource URI and webview menus forward
 * webview-specific data. None of those alternatives expose `instanceId`.
 *
 * @param args The arguments passed to the command.
 * @returns True when the arguments represent a terminal context menu invocation.
 */
export function isTerminalContextArgs(args: unknown): boolean {
	if (!args || typeof args !== 'object') {
		return false;
	}
	return 'instanceId' in (args as Record<string, unknown>);
}