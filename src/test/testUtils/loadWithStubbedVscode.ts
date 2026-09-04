/**
 * Loads a real `src/map` module (or anything importing `vscode`) under plain
 * mocha by temporarily stubbing the `vscode` module on `Module.prototype.require`.
 *
 * This is the same technique used by `geocodingStaleResponse.test.ts` and gives
 * real statement/line coverage of the loaded source. The stub is only active
 * while loading; after load the prototype is restored and the returned module
 * keeps working because it closed over its own required `vscode` namespace.
 */

import { createRequire } from 'module';
import { createVscodeStub, type VscodeStubState } from './vscodeModuleStub';

const nodeRequire = createRequire(__filename);
const ModuleCtor = nodeRequire('module') as typeof import('module');
const originalPrototypeRequire = ModuleCtor.prototype.require;
const moduleCache = (ModuleCtor as unknown as { _cache: Record<string, NodeModule | undefined> })._cache;

export interface LoadedModule<T> {
    module: T;
    vscodeState: VscodeStubState;
}

/**
 * Requires an already-compiled module with `vscode` stubbed, clearing its cache
 * first so the stub is used. Does not leave the stub installed afterwards.
 */
export function loadWithStubbedVscode<T>(moduleId: string): LoadedModule<T> {
    const { vscode, state } = createVscodeStub();

    ModuleCtor.prototype.require = function (id: string): unknown {
        if (id === 'vscode') {
            return vscode;
        }
        return originalPrototypeRequire.call(this, id);
    };

    try {
        const resolved = nodeRequire.resolve(moduleId);
        delete moduleCache[resolved];
        for (const dep of [
            '../../map/mapWebviewUtils',
            '../../map/mapWebviewController',
            '../../map/mapViewProvider',
            '../../map/mapEditorProvider',
            '../../services/configService',
            '../../services/geocodingSearch',
            '../../services/logger',
            '../../testUtils/testableController'
        ]) {
            try {
                delete moduleCache[nodeRequire.resolve(dep)];
            } catch {
                // dependency may not be resolvable; ignore
            }
        }
        const loaded = nodeRequire(moduleId) as T;
        return { module: loaded, vscodeState: state };
    } finally {
        ModuleCtor.prototype.require = originalPrototypeRequire;
    }
}

export type { VscodeStubState, StubWorkspaceConfiguration, StubWebviewPanel } from './vscodeModuleStub';
