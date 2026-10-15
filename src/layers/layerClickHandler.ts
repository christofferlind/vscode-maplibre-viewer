/**
 * Tracks clicks on overlay layer tree items so a second click inside the
 * double-click window triggers the "show on map" behavior while a single
 * click stays inert.
 */
const DEFAULT_DOUBLE_CLICK_WINDOW_MS = 400;

export class DoubleClickTracker {
    private readonly _windowMs: number;
    private readonly _pending: Map<string, ReturnType<typeof setTimeout>> = new Map();

    constructor(windowMs: number = DEFAULT_DOUBLE_CLICK_WINDOW_MS) {
        this._windowMs = windowMs;
    }

    /**
     * Records a click on the given key. Returns true when the click completes
     * a double-click sequence, false when it was a lone (single) click.
     */
    handleClick(key: string): boolean {
        const pending = this._pending.get(key);
        if (pending) {
            clearTimeout(pending);
            this._pending.delete(key);
            return true;
        }

        const timer = setTimeout(() => {
            this._pending.delete(key);
        }, this._windowMs);
        this._pending.set(key, timer);
        return false;
    }

    dispose(): void {
        for (const timer of this._pending.values()) {
            clearTimeout(timer);
        }
        this._pending.clear();
    }
}