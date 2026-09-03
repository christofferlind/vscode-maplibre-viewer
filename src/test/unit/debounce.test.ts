import * as assert from 'assert';
import { debounce } from '../../services/debounce';

suite('debounce', () => {
    test('should defer function execution by the wait period', (done) => {
        let calls = 0;
        const debounced = debounce(() => {
            calls += 1;
        }, 20);

        debounced();
        assert.strictEqual(calls, 0);

        setTimeout(() => {
            assert.strictEqual(calls, 1);
            done();
        }, 60);
    });

    test('should collapse multiple rapid calls into a single execution', (done) => {
        let calls = 0;
        const debounced = debounce(() => {
            calls += 1;
        }, 20);

        debounced();
        debounced();
        debounced();
        debounced();

        setTimeout(() => {
            assert.strictEqual(calls, 1);
            done();
        }, 60);
    });

    test('should forward the caller arguments', (done) => {
        let received: unknown;
        const debounced = debounce((value: unknown) => {
            received = value;
        }, 20);

        debounced('Stockholm');

        setTimeout(() => {
            assert.strictEqual(received, 'Stockholm');
            done();
        }, 60);
    });

    test('should cancel a pending execution', (done) => {
        let calls = 0;
        const debounced = debounce(() => {
            calls += 1;
        }, 20);

        debounced();
        debounced.cancel();

        setTimeout(() => {
            assert.strictEqual(calls, 0);
            done();
        }, 60);
    });

    test('should allow execution after cancellation', (done) => {
        let calls = 0;
        const debounced = debounce(() => {
            calls += 1;
        }, 20);

        debounced();
        debounced.cancel();
        debounced();

        setTimeout(() => {
            assert.strictEqual(calls, 1);
            done();
        }, 60);
    });

    test('should call cancel safely when nothing is pending', () => {
        const debounced = debounce(() => {
            // no-op
        }, 20);
        assert.doesNotThrow(() => debounced.cancel());
    });
});
