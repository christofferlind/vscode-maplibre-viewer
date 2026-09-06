import type * as vscode from 'vscode';

/**
 * Mock Memento implementation for testing managers that persist state.
 */
export class MockMemento implements vscode.Memento {
    private _storage: Map<string, unknown> = new Map();

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const value = this._storage.get(key);
        if (value === undefined) {
            return defaultValue;
        }
        return value as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this._storage.delete(key);
        } else {
            this._storage.set(key, value);
        }
    }

    keys(): readonly string[] {
        return Array.from(this._storage.keys());
    }

    clear(): void {
        this._storage.clear();
    }
}