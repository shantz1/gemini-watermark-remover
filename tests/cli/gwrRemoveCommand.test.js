import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import {
    parseRemoveArgs,
    runRemoveCommand
} from '../../src/cli/gwrRemoveCommand.js';

test('video timeout and bitrate CLI options require positive finite numbers', () => {
    const baseArgs = ['input.mp4', '--output', 'output.mp4'];

    assert.deepEqual(
        parseRemoveArgs([...baseArgs, '--video-timeout-ms', '0']),
        { ok: false, error: '--video-timeout-ms must be a positive number.' }
    );
    assert.deepEqual(
        parseRemoveArgs([...baseArgs, '--video-timeout-ms', 'Infinity']),
        { ok: false, error: '--video-timeout-ms must be a positive number.' }
    );
    assert.deepEqual(
        parseRemoveArgs([...baseArgs, '--video-bitrate-mbps', '-1']),
        { ok: false, error: '--video-bitrate-mbps must be a positive number.' }
    );
    assert.deepEqual(
        parseRemoveArgs([...baseArgs, '--video-bitrate-mbps', 'not-a-number']),
        { ok: false, error: '--video-bitrate-mbps must be a positive number.' }
    );
});

test('runRemoveCommand forwards video timeout, bitrate, and progress options', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gwr-cli-video-options-'));
    const inputPath = path.join(tempDir, 'input.mp4');
    const outputPath = path.join(tempDir, 'output.mp4');
    const stdout = [];
    const stderr = [];
    let received = null;
    await writeFile(inputPath, Buffer.from('video'));

    try {
        const exitCode = await runRemoveCommand([
            inputPath,
            '--output', outputPath,
            '--json',
            '--video-timeout-ms', '100',
            '--video-bitrate-mbps', '12.5'
        ], {
            stdout: { write: (value) => stdout.push(String(value)) },
            stderr: { write: (value) => stderr.push(String(value)) }
        }, {
            async removeVideoWatermarkFromFile(receivedInputPath, options) {
                received = { inputPath: receivedInputPath, options };
                options.onProgress({
                    phase: 'export',
                    progress: 0.5,
                    processedFrames: 120,
                    frameEstimate: 240
                });
                return { meta: { status: 'ok' } };
            }
        });

        assert.equal(exitCode, 0);
        assert.equal(received.inputPath, inputPath);
        assert.equal(received.options.outputPath, outputPath);
        assert.equal(received.options.timeoutMs, 100);
        assert.equal(received.options.videoBitrate, 12_500_000);
        assert.equal(typeof received.options.onProgress, 'function');
        assert.match(stderr.join(''), /\[video\] 50% 120\/240 frames/);
        assert.equal(JSON.parse(stdout.join('')).kind, 'video');
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});
