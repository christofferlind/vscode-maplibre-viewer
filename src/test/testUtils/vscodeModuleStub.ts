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

    const executeCommand = async (command: string): Promise<undefined> => {
        state.executeCommands.push(command);
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

    const vscode = {
        Uri,
        ThemeIcon,
        ViewColumn: { One: 1, Two: 2, Active: -2 },
        ConfigurationTarget: { Global: 1, Workspace: 2 },
        workspace: {
            getConfiguration: () => config(),
            onDidChangeConfiguration: () => ({ dispose: (): void => undefined })
        },
        commands: {
            executeCommand
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
