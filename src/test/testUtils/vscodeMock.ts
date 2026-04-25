/**
 * Mock for vscode module used in unit tests
 * This provides minimal implementations needed for testing
 */

export class Uri {
    private constructor(public readonly scheme: string, public readonly path: string) {}
    
    static file(path: string): Uri {
        return new Uri('file', path);
    }
    
    static parse(value: string): Uri {
        return new Uri('file', value);
    }
    
    toString(): string {
        return `${this.scheme}:${this.path}`;
    }
    
    with(changes: { scheme?: string; path?: string }): Uri {
        return new Uri(
            changes.scheme ?? this.scheme,
            changes.path ?? this.path
        );
    }
    
    joinPath(base: Uri, ...pathSegments: string[]): Uri {
        const joined = pathSegments.join('/');
        return new Uri(base.scheme, `${base.path}/${joined}`);
    }
}

export interface WebviewOptions {
    enableScripts?: boolean;
    enableCommandUris?: boolean;
    localResourceRoots?: readonly Uri[];
}

export interface Webview {
    html: string;
    options: WebviewOptions;
    onDidReceiveMessage: Event<unknown>;
    postMessage(message: unknown): Thenable<boolean>;
    asWebviewUri(uri: Uri): Uri;
    cspSource: string;
}

export interface Disposable {
    dispose(): void;
}

export interface Event<T> {
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
}

export interface Memento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
    keys(): readonly string[];
}

export interface ExtensionContext {
    subscriptions: Disposable[];
    globalState: Memento;
    extensionUri: Uri;
}

export namespace commands {
    export function registerCommand(command: string, callback: (...args: any[]) => any): Disposable {
        return { dispose: () => {} };
    }
    
    export function executeCommand<T>(command: string, ...rest: any[]): Thenable<T | undefined> {
        return Promise.resolve(undefined);
    }
}

export namespace window {
    export function showInformationMessage(message: string): Thenable<string | undefined> {
        return Promise.resolve(undefined);
    }
    
    export function showWarningMessage(message: string): Thenable<string | undefined> {
        return Promise.resolve(undefined);
    }
    
    export function showErrorMessage(message: string): Thenable<string | undefined> {
        return Promise.resolve(undefined);
    }
    
    export function showQuickPick<T extends QuickPickItem>(items: T[], options?: QuickPickOptions): Thenable<T | undefined> {
        return Promise.resolve(undefined);
    }
    
    export function showInputBox(options: InputBoxOptions): Thenable<string | undefined> {
        return Promise.resolve(undefined);
    }
}

export interface QuickPickItem {
    label: string;
    description?: string;
    detail?: string;
    kind?: QuickPickItemKind;
}

export const enum QuickPickItemKind {
    Separator = 2
}

export interface QuickPickOptions {
    placeHolder?: string;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
}

export interface InputBoxOptions {
    prompt?: string;
    placeHolder?: string;
    validateInput?: (value: string) => string | null | undefined;
}