import {
    DEFAULT_DENOISE_BACKEND,
    DEFAULT_EDGE_DENOISE_STRENGTH,
    DEFAULT_HIGH_QUALITY_CLEANUP,
    DEFAULT_RESIDUAL_CLEANUP_STRENGTH,
    VIDEO_DENOISE_BACKENDS
} from './videoCleanupBackends.js';

const RELOCATED_MARGIN_RATIO = 1.8;
const DEFAULT_AUTO_SAMPLE_COUNT = 12;
const DEFAULT_AUTO_ALPHA_GAIN = 1;

export function isRelocatedVideoWatermarkPosition(position) {
    if (!position || !Number.isFinite(position.width) || position.width <= 0) {
        return false;
    }
    const explicitMarginRight = Number(position.marginRight);
    const explicitMarginBottom = Number(position.marginBottom);
    const inferredMarginRight = Number.isFinite(Number(position.videoWidth)) && Number.isFinite(Number(position.x))
        ? Number(position.videoWidth) - Number(position.x) - Number(position.width)
        : null;
    const inferredMarginBottom = Number.isFinite(Number(position.videoHeight)) && Number.isFinite(Number(position.y))
        ? Number(position.videoHeight) - Number(position.y) - Number(position.height || position.width)
        : null;
    const marginRight = Number.isFinite(explicitMarginRight) ? explicitMarginRight : inferredMarginRight;
    const marginBottom = Number.isFinite(explicitMarginBottom) ? explicitMarginBottom : inferredMarginBottom;
    return (
        Number.isFinite(marginRight) && marginRight >= position.width * RELOCATED_MARGIN_RATIO
    ) || (
        Number.isFinite(marginBottom) && marginBottom >= position.width * RELOCATED_MARGIN_RATIO
    );
}

function isRelocatedCandidateLabel(candidate = {}) {
    const text = `${candidate.id || ''} ${candidate.label || ''}`.toLowerCase();
    return text.includes('inset') || text.includes('relocated');
}

export function shouldUseRelocatedReviewPreset(detection, metadata = null) {
    if (!detection?.isConfident || !detection.position) {
        return false;
    }
    const position = {
        ...detection.position,
        videoWidth: detection.position.videoWidth ?? metadata?.width,
        videoHeight: detection.position.videoHeight ?? metadata?.height
    };
    return isRelocatedVideoWatermarkPosition(position) ||
        isRelocatedCandidateLabel(detection.summary?.best);
}

export function getRelocatedReviewPresetConfig() {
    return {
        id: 'relocated-review',
        label: '迁移锚点自动复核',
        description: '检测到水印位置偏离常规右下角，自动使用更稳的时序匹配清理。',
        alphaGain: DEFAULT_AUTO_ALPHA_GAIN,
        adaptiveAlpha: false,
        highQualityCleanup: DEFAULT_HIGH_QUALITY_CLEANUP,
        denoiseBackend: VIDEO_DENOISE_BACKENDS.CANVAS_TEMPORAL_MATCH_DELTA_STABILIZE,
        edgeDenoiseStrength: 0.25,
        residualCleanupStrength: DEFAULT_RESIDUAL_CLEANUP_STRENGTH,
        sampleCount: DEFAULT_AUTO_SAMPLE_COUNT,
        videoBitrateMbps: 12,
        allowLowConfidence: true
    };
}

export function getStandardAutoPresetConfig() {
    return {
        id: 'standard-auto',
        label: '自动参数',
        description: '使用保守默认参数处理常规右下角 Gemini/Veo 水印。',
        alphaGain: DEFAULT_AUTO_ALPHA_GAIN,
        adaptiveAlpha: false,
        highQualityCleanup: DEFAULT_HIGH_QUALITY_CLEANUP,
        denoiseBackend: DEFAULT_DENOISE_BACKEND,
        edgeDenoiseStrength: DEFAULT_EDGE_DENOISE_STRENGTH,
        residualCleanupStrength: DEFAULT_RESIDUAL_CLEANUP_STRENGTH,
        sampleCount: DEFAULT_AUTO_SAMPLE_COUNT,
        videoBitrateMbps: '',
        allowLowConfidence: false
    };
}

export function getAutomaticVideoPresetConfig(detection = null, metadata = null) {
    if (shouldUseRelocatedReviewPreset(detection, metadata)) {
        return getRelocatedReviewPresetConfig();
    }
    return getStandardAutoPresetConfig();
}
