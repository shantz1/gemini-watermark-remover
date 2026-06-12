import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

function projectUrl(relativePath) {
    return new URL(`../../${relativePath}`, import.meta.url);
}

test('video WebGPU runtime should use asyncify wasm assets', async () => {
    const source = await readFile(projectUrl('src/video-app.js'), 'utf8');

    assert.match(source, /ort-wasm-simd-threaded\.asyncify\.mjs/);
    assert.match(source, /ort-wasm-simd-threaded\.asyncify\.wasm/);
    assert.doesNotMatch(source, /ALLENK_FDNCNN_WEBGPU_WASM_PATHS[\s\S]*?ort-wasm-simd-threaded\.jsep/);
});

test('video WebGPU asyncify runtime assets should be bundled in public', async () => {
    for (const fileName of [
        'ort-wasm-simd-threaded.asyncify.mjs',
        'ort-wasm-simd-threaded.asyncify.wasm'
    ]) {
        const info = await stat(projectUrl(`public/onnxruntime/${fileName}`));
        assert.ok(info.size > 0, `${fileName} should not be empty`);
    }
});
