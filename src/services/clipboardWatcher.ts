import * as vscode from 'vscode';

/**
 * Watches the system clipboard for text changes and notifies listeners.
 *
 * VS Code does not provide a clipboard-change event, so this watcher polls
 * vscode.env.clipboard.readText() on an interval. Because the read goes through
 * VS Code's clipboard API, this works identically on Linux (via the system
 * clipboard/selection), Windows, and macOS without any OS-specific code.
 *
 * When the clipboard is unchanged, polling is cheap: the previous text is kept
 * in memory and listeners only fire when the text actually differs.
 */
export class ClipboardWatcher {
    private readonly readClipboard: () => Thenable<string>;
    private readonly intervalMs: number;
    private timer?: ReturnType<typeof setInterval>;
    private lastText: string | null = null;
    private onDidChangeTextEmitter = new vscode.EventEmitter<string>();

    readonly onDidChangeText = this.onDidChangeTextEmitter.event;

    constructor(
        readClipboard?: () => Promise<string>,
        intervalMs = 1000
    ) {
        this.readClipboard = readClipboard ?? (() => vscode.env.clipboard.readText());
        this.intervalMs = intervalMs;
    }

    /**
     * Starts polling the clipboard. Fires onDidChangeText for each change,
     * including the initial content (if non-empty) right after start.
     */
    start(): void {
        if (this.timer) {
            return;
        }
        this.lastText = null;

        const poll = async (): Promise<void> => {
            try {
                const text = await this.readClipboard();
                if (text === this.lastText) {
                    return;
                }
                const isFirstRead = this.lastText === null;
                this.lastText = text;
                if (text === '' && isFirstRead) {
                    return;
                }
                this.onDidChangeTextEmitter.fire(text);
            } catch {
                // Keep polling; transient clipboard failures are retried next tick.
            }
        };
        void poll();

        this.timer = setInterval(poll, this.intervalMs);
    }

    /**
     * Stops polling the clipboard.
     */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    dispose(): void {
        this.stop();
        this.onDidChangeTextEmitter.dispose();
    }
}