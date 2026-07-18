import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveVideoMetadata } from '../../src/video/videoMetadata.js';

function createMetadataStubs({ duration = 10, packetStats } = {}) {
    return {
        input: {
            async getDurationFromMetadata() {
                return duration;
            }
        },
        videoTrack: {
            async getDisplayWidth() {
                return 1280;
            },
            async getDisplayHeight() {
                return 720;
            },
            async getFirstTimestamp() {
                return 0;
            },
            async getCodec() {
                return 'avc';
            },
            async computePacketStats() {
                return packetStats;
            },
            async computeDuration() {
                return duration;
            }
        }
    };
}

test('resolveVideoMetadata estimates total frames instead of using the capped packet sample count', async () => {
    const { input, videoTrack } = createMetadataStubs({
        duration: 10,
        packetStats: {
            packetCount: 90,
            averagePacketRate: 24,
            averageBitrate: 12_000_000
        }
    });

    const metadata = await resolveVideoMetadata(input, videoTrack);

    assert.equal(metadata.frameRate, 24);
    assert.equal(metadata.frameCountEstimate, 240);
    assert.notEqual(metadata.frameCountEstimate, 90);
});

test('resolveVideoMetadata omits the frame estimate when sampled packet rate is unavailable', async () => {
    const { input, videoTrack } = createMetadataStubs({
        duration: 10,
        packetStats: {
            packetCount: 90,
            averagePacketRate: null
        }
    });

    const metadata = await resolveVideoMetadata(input, videoTrack);

    assert.equal(metadata.frameRate, 30);
    assert.equal(metadata.frameCountEstimate, null);
});
