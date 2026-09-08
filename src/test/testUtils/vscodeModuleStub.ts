/**
 * Test-only stub for the `vscode` module.
 *
 * Unit tests run under plain mocha (no VS Code host), so real modules under
 * `src/map/` that import `vscode` must be given a minimal stand-in. The map
 * module imports `vscode` as a namespace; the compiled CommonJS output does
 * `__importStar(require("vscode"))`, which only reads plain properties, so a
 * plain object works.
 */

import type { MockWebview } from './mockWebview';

export interface StubWorkspaceConfiguration {
    get: <T>(section: string, defaultValue?: T) => T | undefined;
    update: (section: string, value: unknown) => Promise<void>;
}

export interface StubWebviewPanel {
    webview: MockWebview;
    viewType: string;
    title: string;
    iconPath: unknown;
    reveal: (column?: number) => void;
    onDidDispose: (listener: () => void) => { dispose: () => void };
}

export interface VscodeStubState {
    getValues: (section: string, defaultValue?: unknown) => unknown;
    setGetValues: (fn: (section: string, defaultValue?: unknown) => unknown) => void;
    executeCommands: string[];
    executeCommandArgs: unknown[];
    updateCalls: Array<{ section: string; value: unknown; target: number }>;
    createdPanels: StubWebviewPanel[];
    disposeListeners: Array<() => void>;
    errorMessages: string[];
    errorSelections: Array<string | undefined>;
    outputChannels: StubOutputChannel[];
}

export interface StubOutputChannel {
    name: string;
    lines: string[];
    shown: boolean;
    preserveFocus: boolean;
    appendLine: (line: string) => void;
    show: (preserveFocus?: boolean) => void;
}

/**
 * Builds a vscode namespace stub. Each call returns a fresh stub so tests are
 * isolated from one another.
 */
export function createVscodeStub(): { vscode: Record<string, unknown>; state: VscodeStubState } {
    const state: VscodeStubState = {
        getValues: () => undefined,
        setGetValues: (fn: (section: string, defaultValue?: unknown) => unknown): void => {
            state.getValues = fn;
        },
        executeCommands: [],
        executeCommandArgs: [],
        updateCalls: [],
        createdPanels: [],
        disposeListeners: [],
        errorMessages: [],
        errorSelections: [],
        outputChannels: []
    };

    const config = (): StubWorkspaceConfiguration => ({
        get: <T>(section: string, defaultValue?: T): T | undefined => {
            return state.getValues(section, defaultValue) as T | undefined;
        },
        update: async (section, value) => {
            state.updateCalls.push({ section, value, target: 1 });
        }
    });

    class Uri {
        public readonly scheme: string;
        public readonly fsPath: string;
        public readonly path: string;

        constructor(scheme: string, fsPath: string) {
            this.scheme = scheme;
            this.fsPath = fsPath;
            this.path = fsPath;
        }

        static file(fsPath: string): Uri {
            return new Uri('file', fsPath);
        }

        static parse(value: string): Uri {
            return new Uri('file', value);
        }

        toString(): string {
            return `${this.scheme}:${this.fsPath}`;
        }

        with(): Uri {
            return this;
        }

        static joinPath(base: Uri, ...pathSegments: string[]): Uri {
            const joined = pathSegments.join('/');
            return new Uri(base.scheme, `${base.fsPath}/${joined}`);
        }
    }

    class ThemeIcon {
        public readonly id: string;
        constructor(id: string) {
            this.id = id;
        }
    }

    const executeCommand = async (command: string, arg?: unknown): Promise<undefined> => {
        state.executeCommands.push(command);
        if (arg !== undefined) {
            state.executeCommandArgs.push(arg);
        }
        return undefined;
    };

    const createWebviewPanel = (viewType: string, title: string, cols: unknown, opts: unknown): StubWebviewPanel => {
        const webview = new (require('./mockWebview').MockWebview)() as MockWebview;
        const panel: StubWebviewPanel = {
            webview,
            viewType,
            title,
            iconPath: undefined,
            reveal: (): void => undefined,
            onDidDispose: (listener: () => void) => {
                state.disposeListeners.push(listener);
                return { dispose: (): void => undefined };
            }
        };
        state.createdPanels.push(panel);
        return panel;
    };

    const createOutputChannel = (name: string): StubOutputChannel => {
        const channel: StubOutputChannel = {
            name,
            lines: [],
            shown: false,
            preserveFocus: false,
            appendLine: (line: string): void => {
                channel.lines.push(line);
            },
            show: (preserveFocus?: boolean): void => {
                channel.shown = true;
                channel.preserveFocus = preserveFocus === true;
            }
        };
        state.outputChannels.push(channel);
        return channel;
    };

    class TreeItemCollapsibleStateStub {
        public static readonly None = 0;
        public static readonly Collapsed = 1;
        public static readonly Expanded = 2;
    }

    class TreeItem {
        public label: string;
        public collapsibleState: number;
        public contextValue?: string;
        public iconPath?: unknown;
        public description?: string;
        public tooltip?: string;
        public command?: { command: string; title: string; arguments?: unknown[] };

        constructor(label: string, collapsibleState: number) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    }

    class EventEmitter<T> {
        private listeners: Array<(e: T) => unknown> = [];

        readonly event: (listener: (e: T) => unknown) => { dispose: () => void } = (
            listener: (e: T) => unknown
        ): { dispose: () => void } => {
            this.listeners.push(listener);
            return {
                dispose: (): void => {
                    const index = this.listeners.indexOf(listener);
                    if (index !== -1) {
                        this.listeners.splice(index, 1);
                    }
                }
            };
        };

        fire(data: T): void {
            for (const listener of this.listeners) {
                listener(data);
            }
        }

        dispose(): void {
            this.listeners = [];
        }
    }

    class MarkdownString {
        public value: string;
        public isTrusted = false;

        constructor(value = '') {
            this.value = value;
        }

        appendText(text: string): MarkdownString {
            this.value += text;
            return this;
        }

        appendMarkdown(text: string): MarkdownString {
            this.value += text;
            return this;
        }
    }

    class DisposableStub {
        private callback: () => void;

        constructor(callback: () => void) {
            this.callback = callback;
        }

        dispose(): void {
            this.callback();
        }
    }

    const vscode = {
        Uri,
        ThemeIcon,
        TreeItem,
        TreeItemCollapsibleState: TreeItemCollapsibleStateStub,
        MarkdownString,
        Disposable: DisposableStub,
        EventEmitter,
        ViewColumn: { One: 1, Two: 2, Active: -2 },
        ConfigurationTarget: { Global: 1, Workspace: 2 },
        workspace: {
            getConfiguration: () => config(),
            onDidChangeConfiguration: () => ({ dispose: (): void => undefined })
        },
        commands: {
            executeCommand,
            registerCommand: (): { dispose: () => void } => ({ dispose: (): void => undefined })
        },
        window: {
            createWebviewPanel,
            createOutputChannel,
            activeTextEditor: undefined,
            showInformationMessage: async () => undefined,
            showErrorMessage: async (message: string, ...items: string[]) => {
                state.errorMessages.push(message);
                const selection = state.errorSelections.length > 0 ? state.errorSelections.shift() : undefined;
                return selection;
            },
            showWarningMessage: async () => undefined,
            showQuickPick: async () => undefined,
            showInputBox: async () => undefined
        }
    };

    return { vscode, state };
}
