/**
 * Mock for the vscode module used by layer tree tests.
 * Provides minimal implementations of the vscode APIs that
 * LayerTreeProvider, layerTreeItemFactory, and layerDragDropHandler
 * depend on, so they can be unit tested without a real VS Code host.
 */

export class Uri {
    public readonly scheme: string;
    public readonly path: string;

    private constructor(scheme: string, path: string) {
        this.scheme = scheme;
        this.path = path;
    }

    static file(path: string): Uri {
        return new Uri('file', path);
    }

    static parse(value: string): Uri {
        const match = /^([a-z]+):(.*)$/i.exec(value);
        if (match) {
            return new Uri(match[1].toLowerCase(), match[2]);
        }
        return new Uri('file', value);
    }

    get fsPath(): string {
        return this.path;
    }

    toString(): string {
        return `${this.scheme}:${this.path}`;
    }
}

export class ThemeIcon {
    public readonly id: string;

    constructor(id: string) {
        this.id = id;
    }
}

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2
}

export class TreeItem {
    public label: string;
    public collapsibleState: TreeItemCollapsibleState;
    public contextValue?: string;
    public iconPath?: ThemeIcon;
    public resourceUri?: Uri;
    public description?: string;
    public tooltip?: string;
    public command?: { command: string; title: string; arguments?: unknown[] };

    constructor(label: string, collapsibleState: TreeItemCollapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

export class EventEmitter<T> {
    private listeners: Array<(e: T) => unknown> = [];

    readonly event: (listener: (e: T) => unknown) => { dispose: () => void } = (
        listener: (e: T) => unknown
    ) => {
        this.listeners.push(listener);
        return {
            dispose: () => {
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

export class Disposable {
    private callback: () => void;

    constructor(callback: () => void) {
        this.callback = callback;
    }

    dispose(): void {
        this.callback();
    }
}

export class DataTransferItem {
    public readonly value: unknown;

    constructor(value: unknown) {
        this.value = value;
    }
}

export class DataTransfer {
    private items: Map<string, DataTransferItem> = new Map();

    get(mimeType: string): DataTransferItem | undefined {
        return this.items.get(mimeType);
    }

    set(mimeType: string, value: unknown): void {
        this.items.set(mimeType, new DataTransferItem(value));
    }
}

export class CancellationToken {
    public readonly isCancellationRequested: boolean = false;
}

export interface Memento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
}

export interface ExtensionContext {
    subscriptions: Disposable[];
    globalState: Memento;
    extensionUri: Uri;
}

export const workspace = {
    getConfiguration: (): { get: <T>(key: string, defaultValue?: T) => T | undefined } => ({
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue
    }),
    onDidChangeConfiguration: (): { dispose: () => void } => ({ dispose: (): void => undefined })
};

export const window = {
    showInformationMessage: (message: string): Thenable<string | undefined> =>
        Promise.resolve(undefined),
    showWarningMessage: (message: string): Thenable<string | undefined> =>
        Promise.resolve(undefined),
    showErrorMessage: (message: string): Thenable<string | undefined> =>
        Promise.resolve(undefined)
};

export const commands = {
    registerCommand: (): Disposable => new Disposable(() => undefined),
    executeCommand: <T>(): Thenable<T | undefined> => Promise.resolve(undefined)
};

export const vscodeStub: Record<string, unknown> = {
    Uri,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    EventEmitter,
    Disposable,
    DataTransfer,
    DataTransferItem,
    CancellationToken,
    workspace,
    window,
    commands
};
