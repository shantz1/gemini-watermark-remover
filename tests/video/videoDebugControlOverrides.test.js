import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyVideoBitrateDebugOverride
} from '../../src/video/videoDebugControlOverrides.js';

test('applyVideoBitrateDebugOverride should write bitrate overrides after automatic presets', () => {
    const input = { value: '12' };
    const calls = [];

    const applied = applyVideoBitrateDebugOverride({
        windowObject: {
            __gwrVideoOverrideBitrate: 24_000_000
        },
        videoBitrateInput: input,
        setNumberControl(control, value) {
            calls.push({ control, value });
            control.value = String(value);
        }
    });

    assert.equal(applied, true);
    assert.deepEqual(calls, [{ control: input, value: 24 }]);
    assert.equal(input.value, '24');
});

test('applyVideoBitrateDebugOverride should ignore missing or invalid overrides', () => {
    const input = { value: '12' };
    const calls = [];

    const applied = applyVideoBitrateDebugOverride({
        windowObject: {
            __gwrVideoOverrideBitrate: 0
        },
        videoBitrateInput: input,
        setNumberControl(control, value) {
            calls.push({ control, value });
        }
    });

    assert.equal(applied, false);
    assert.deepEqual(calls, []);
    assert.equal(input.value, '12');
});
