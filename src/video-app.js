import {
    DEFAULT_ADAPTIVE_ALPHA,
    DEFAULT_ALPHA_GAIN,
    DEFAULT_DENOISE_BACKEND,
    DEFAULT_EDGE_DENOISE_STRENGTH,
    DEFAULT_HIGH_QUALITY_CLEANUP,
    DEFAULT_RESIDUAL_CLEANUP_STRENGTH,
    DEFAULT_SAMPLE_COUNT,
    DEFAULT_VIDEO_BITRATE,
    VIDEO_DENOISE_BACKENDS,
    detectGeminiVideoWatermark,
    inspectGeminiVideoFile,
    removeGeminiVideoWatermark
} from './video/videoExport.js';
import { isReferenceGeminiVideoSize } from './video/videoWatermarkCatalog.js';
import {
    getAutomaticVideoPresetConfig,
    getRelocatedReviewPresetConfig
} from './video/videoPresetPolicy.js';
import {
    consumeDebugFileHandoff,
    getDebugFileKind,
    pickDebugUploadFile,
    saveDebugFileHandoff
} from './shared/debugFileHandoff.js';

const $ = (id) => document.getElementById(id);

const state = {
    file: null,
    originalUrl: null,
    processedUrl: null,
    metadata: null,
    detection: null,
    running: false,
    jobId: 0,
    syncingPlayback: false
};

const els = {
    dropzone: $('dropzone'),
    fileInput: $('fileInput'),
    comparePlayer: $('comparePlayer'),
    afterBadge: $('afterBadge'),
    playPauseBtn: $('playPauseBtn'),
    scrubber: $('scrubber'),
    timeLabel: $('timeLabel'),
    originalVideo: $('originalVideo'),
    processedVideo: $('processedVideo'),
    originalEmpty: $('originalEmpty'),
    processedEmpty: $('processedEmpty'),
    metadata: $('metadata'),
    detection: $('detection'),
    progressBar: $('progressBar'),
    progressText: $('progressText'),
    status: $('status'),
    alphaGain: $('alphaGain'),
    alphaGainValue: $('alphaGainValue'),
    adaptiveAlpha: $('adaptiveAlpha'),
    highQualityCleanup: $('highQualityCleanup'),
    denoiseBackend: $('denoiseBackend'),
    edgeDenoiseStrength: $('edgeDenoiseStrength'),
    edgeDenoiseStrengthValue: $('edgeDenoiseStrengthValue'),
    residualCleanup: $('residualCleanup'),
    residualCleanupValue: $('residualCleanupValue'),
    videoBitrateMbps: $('videoBitrateMbps'),
    sampleCount: $('sampleCount'),
    allowLowConfidence: $('allowLowConfidence'),
    autoPresetSummary: $('autoPresetSummary'),
    processBtn: $('processBtn'),
    detectBtn: $('detectBtn'),
    downloadBtn: $('downloadBtn'),
    resetBtn: $('resetBtn'),
    relocatedReviewPresetBtn: $('relocatedReviewPresetBtn')
};

function setStatus(message, tone = 'info') {
    els.status.textContent = message || '';
    els.status.dataset.tone = tone;
}

function setProgress(progress, label) {
    const pct = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress * 100))) : 0;
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = label || `${pct}%`;
}

function formatSeconds(value) {
    if (!Number.isFinite(value)) return '未知';
    return `${value.toFixed(2)}s`;
}

function formatBitrate(value) {
    if (!Number.isFinite(value)) return '未知';
    return `${(value / 1000 / 1000).toFixed(2)} Mbps`;
}

function formatPlaybackTime(value) {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const totalSeconds = Math.floor(value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function updateButtons() {
    const hasFile = Boolean(state.file);
    els.detectBtn.disabled = !hasFile || state.running;
    els.processBtn.disabled = !hasFile || state.running;
    const canDownload = Boolean(state.processedUrl) && !state.running;
    els.downloadBtn.setAttribute('aria-disabled', canDownload ? 'false' : 'true');
    els.downloadBtn.tabIndex = canDownload ? 0 : -1;
    els.resetBtn.disabled = state.running;
    updatePlaybackControls();
}

function hasPlayableOriginal() {
    return Boolean(state.originalUrl) && Number.isFinite(els.originalVideo.duration);
}

function hasPlayableProcessed() {
    return Boolean(state.processedUrl);
}

function updatePlaybackControls() {
    const canPlay = Boolean(state.originalUrl);
    els.playPauseBtn.disabled = !canPlay;
    els.scrubber.disabled = !canPlay;
    els.playPauseBtn.dataset.playing = els.originalVideo.paused ? 'false' : 'true';
    els.playPauseBtn.setAttribute('aria-label', els.originalVideo.paused ? '播放' : '暂停');

    const duration = Number.isFinite(els.originalVideo.duration) ? els.originalVideo.duration : 0;
    const currentTime = Number.isFinite(els.originalVideo.currentTime) ? els.originalVideo.currentTime : 0;
    if (duration > 0 && !els.scrubber.matches(':active')) {
        els.scrubber.value = String(Math.round((currentTime / duration) * 1000));
    }
    els.timeLabel.textContent = duration > 0
        ? `${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`
        : formatPlaybackTime(currentTime);
}

function updateCompareMode() {
    const hasAfter = hasPlayableProcessed();
    els.afterBadge.hidden = !hasAfter;
    els.processedEmpty.hidden = hasAfter;
}

function syncProcessedToOriginal({ force = false } = {}) {
    if (!hasPlayableProcessed() || state.syncingPlayback) return;
    const targetTime = Number(els.originalVideo.currentTime) || 0;
    if (!force && Math.abs((Number(els.processedVideo.currentTime) || 0) - targetTime) < 0.08) return;

    state.syncingPlayback = true;
    try {
        els.processedVideo.currentTime = targetTime;
    } catch (error) {
        console.warn('sync processed video failed:', error);
    } finally {
        state.syncingPlayback = false;
    }
}

async function playComparison() {
    if (!state.originalUrl) return;
    syncProcessedToOriginal({ force: true });
    try {
        await els.originalVideo.play();
        if (hasPlayableProcessed()) {
            await els.processedVideo.play().catch((error) => {
                console.warn('processed video play failed:', error);
            });
        }
    } catch (error) {
        console.warn('original video play failed:', error);
        setStatus('浏览器阻止了播放，请再点一次播放按钮。', 'warn');
    } finally {
        updatePlaybackControls();
    }
}

function pauseComparison() {
    els.originalVideo.pause();
    els.processedVideo.pause();
    updatePlaybackControls();
}

function togglePlayback() {
    if (els.originalVideo.paused) {
        playComparison();
    } else {
        pauseComparison();
    }
}

function seekComparison(value) {
    const duration = Number(els.originalVideo.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    const currentTime = (Number(value) / 1000) * duration;
    els.originalVideo.currentTime = currentTime;
    syncProcessedToOriginal({ force: true });
    updatePlaybackControls();
}

function renderAutoPresetSummary(preset = null) {
    if (!els.autoPresetSummary) return;
    if (!preset) {
        els.autoPresetSummary.innerHTML = `
            <strong>自动参数</strong>
            <span>选择视频后自动检测并套用合适参数。</span>
        `;
        return;
    }

    const bitrate = Number(preset.videoBitrateMbps) > 0
        ? `${preset.videoBitrateMbps}Mbps`
        : '自动码率';
    const denoise = preset.denoiseBackend && preset.denoiseBackend !== VIDEO_DENOISE_BACKENDS.NONE
        ? preset.denoiseBackend
        : '关闭后端去噪';
    els.autoPresetSummary.innerHTML = `
        <strong>${preset.label}</strong>
        <span>${preset.description}</span>
        <span class="muted">码率 ${bitrate}，${denoise}</span>
    `;
}

function renderMetadata(metadata) {
    if (!metadata) {
        els.metadata.innerHTML = '<p class="muted">等待载入视频</p>';
        return;
    }
    const reference = isReferenceGeminiVideoSize(metadata.width, metadata.height);
    els.metadata.innerHTML = `
        <dl>
            <div><dt>尺寸</dt><dd>${metadata.width} x ${metadata.height}</dd></div>
            <div><dt>时长</dt><dd>${formatSeconds(metadata.duration)}</dd></div>
            <div><dt>帧率</dt><dd>${metadata.frameRate.toFixed(2)} fps</dd></div>
            <div><dt>视频码率</dt><dd>${formatBitrate(metadata.averageBitrate)}</dd></div>
            <div><dt>水印规格</dt><dd>${reference ? '1920x1080 已确认' : '比例推断，实验性'}</dd></div>
        </dl>
    `;
}

function renderDetection(detection) {
    if (!detection) {
        els.detection.innerHTML = '<p class="muted">先检测或直接导出</p>';
        return;
    }

    const best = detection.summary.best;
    els.detection.innerHTML = `
        <dl>
            <div><dt>候选</dt><dd>${best.label}</dd></div>
            <div><dt>位置</dt><dd>${detection.position.x}, ${detection.position.y}</dd></div>
            <div><dt>大小</dt><dd>${detection.position.width} x ${detection.position.height}</dd></div>
            <div><dt>均值分数</dt><dd>${best.meanConfidence.toFixed(3)}</dd></div>
            <div><dt>投票</dt><dd>${best.votes}/${detection.summary.frameCount}</dd></div>
            <div><dt>状态</dt><dd>${detection.isConfident ? '可导出' : '低置信'}</dd></div>
        </dl>
    `;
}

function cleanupUrls() {
    if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
    if (state.processedUrl) URL.revokeObjectURL(state.processedUrl);
    state.originalUrl = null;
    state.processedUrl = null;
}

async function setFile(file) {
    const fileKind = getDebugFileKind(file);
    if (fileKind === 'image') {
        await routeImageFile(file);
        return;
    }
    if (fileKind !== 'video') {
        setStatus('请选择图片或视频文件。视频会在本页处理，图片会回到单图对比页。', 'warn');
        return;
    }

    cleanupUrls();
    state.file = file;
    state.metadata = null;
    state.detection = null;
    state.processedUrl = null;
    state.jobId++;

    state.originalUrl = URL.createObjectURL(file);
    els.originalVideo.src = state.originalUrl;
    els.originalVideo.currentTime = 0;
    els.processedVideo.removeAttribute('src');
    els.processedVideo.load();
    els.downloadBtn.removeAttribute('href');
    els.downloadBtn.removeAttribute('download');
    els.originalEmpty.hidden = true;
    updateCompareMode();
    renderMetadata(null);
    renderDetection(null);
    setProgress(0, '准备就绪');
    setStatus('正在读取视频元数据...');
    updateButtons();

    try {
        const metadata = await inspectGeminiVideoFile(file);
        state.metadata = metadata;
        renderMetadata(metadata);
        applyAutomaticPreset(null, metadata, { silent: true });
        setStatus('视频已载入，导出时会自动检测并选择参数。');
    } catch (error) {
        console.error(error);
        setStatus(error.message || '读取视频失败', 'error');
    } finally {
        updateButtons();
    }
}

async function routeImageFile(file) {
    try {
        setStatus('正在进入图片调试流程...');
        await saveDebugFileHandoff(file, 'image');
        window.location.assign('./dev-preview.html?fileHandoff=1');
    } catch (error) {
        console.error(error);
        setStatus(error.message || '无法进入图片调试流程，请打开单图页后重新选择文件。', 'warn');
    }
}

async function runDetection() {
    if (!state.file || state.running) return;
    const jobId = ++state.jobId;
    state.running = true;
    updateButtons();
    setProgress(0.05, '检测中');
    setStatus('正在抽帧检测右下角水印...');

    try {
        const result = await detectGeminiVideoWatermark(state.file, {
            sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT
        });
        if (jobId !== state.jobId) return;
        state.metadata = result.metadata;
        state.detection = result.detection;
        renderMetadata(result.metadata);
        renderDetection(result.detection);
        setProgress(1, result.detection.isConfident ? '检测完成' : '低置信');
        const preset = applyAutomaticPreset(result.detection, result.metadata, { silent: true });
        if (preset.id === 'relocated-review') {
            setStatus('检测到迁移锚点水印，已自动选择复核预设。', 'warn');
        } else {
            setStatus(result.detection.isConfident ? '检测完成，已自动选择参数。' : '检测置信度偏低，已保留保守参数。', result.detection.isConfident ? 'success' : 'warn');
        }
    } catch (error) {
        console.error(error);
        setStatus(error.message || '检测失败', 'error');
        setProgress(0, '检测失败');
    } finally {
        state.running = false;
        updateButtons();
    }
}

async function runExport() {
    if (!state.file || state.running) return;
    const jobId = ++state.jobId;
    state.running = true;
    updateButtons();
    setProgress(0, '开始');
    setStatus('正在本地逐帧处理，页面保持打开即可。');

    try {
        let detectionPayload = state.detection ? { metadata: state.metadata, detection: state.detection } : null;
        if (!detectionPayload) {
            setProgress(0.04, '检测中');
            setStatus('正在检测水印候选...');
            const detected = await detectGeminiVideoWatermark(state.file, {
                sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT
            });
            if (jobId !== state.jobId) return;
            state.metadata = detected.metadata;
            state.detection = detected.detection;
            renderMetadata(detected.metadata);
            renderDetection(detected.detection);
            detectionPayload = { metadata: detected.metadata, detection: detected.detection };
            applyAutomaticPreset(detected.detection, detected.metadata, { silent: true });
        } else {
            applyAutomaticPreset(detectionPayload.detection, detectionPayload.metadata, { silent: true });
        }

        const result = await removeGeminiVideoWatermark(state.file, {
            alphaGain: Number(els.alphaGain.value) || DEFAULT_ALPHA_GAIN,
            adaptiveAlpha: els.adaptiveAlpha.checked,
            highQualityCleanup: els.highQualityCleanup.checked,
            denoiseBackend: els.denoiseBackend.value || DEFAULT_DENOISE_BACKEND,
            edgeDenoiseStrength: Number(els.edgeDenoiseStrength.value) || 0,
            residualCleanupStrength: Number(els.residualCleanup.value) || 0,
            videoBitrate: Number(els.videoBitrateMbps.value) > 0
                ? Number(els.videoBitrateMbps.value) * 1000 * 1000
                : DEFAULT_VIDEO_BITRATE,
            alphaLowScale: Number.isFinite(window.__gwrVideoAlphaLowScale)
                ? window.__gwrVideoAlphaLowScale
                : undefined,
            alphaBodyScale: Number.isFinite(window.__gwrVideoAlphaBodyScale)
                ? window.__gwrVideoAlphaBodyScale
                : undefined,
            alphaEdgeBoost: Number.isFinite(window.__gwrVideoAlphaEdgeBoost)
                ? window.__gwrVideoAlphaEdgeBoost
                : undefined,
            alphaLocalRegion: typeof window.__gwrVideoAlphaLocalRegion === 'string'
                ? window.__gwrVideoAlphaLocalRegion
                : undefined,
            alphaLocalLowScale: Number.isFinite(window.__gwrVideoAlphaLocalLowScale)
                ? window.__gwrVideoAlphaLocalLowScale
                : undefined,
            alphaLocalBodyScale: Number.isFinite(window.__gwrVideoAlphaLocalBodyScale)
                ? window.__gwrVideoAlphaLocalBodyScale
                : undefined,
            sampleCount: Number(els.sampleCount.value) || DEFAULT_SAMPLE_COUNT,
            detection: detectionPayload,
            allowLowConfidence: els.allowLowConfidence.checked,
            onProgress: ({ phase, progress, processedFrames, metadata, detection }) => {
                if (jobId !== state.jobId) return;
                if (metadata) {
                    state.metadata = metadata;
                    renderMetadata(metadata);
                }
                if (detection) {
                    state.detection = detection;
                    renderDetection(detection);
                }
                if (phase === 'detect') {
                    setProgress(progress * 0.12, progress >= 1 ? '检测完成' : '检测中');
                } else if (phase === 'export') {
                    const exportProgress = 0.12 + progress * 0.88;
                    const frames = Number.isFinite(processedFrames) ? `${processedFrames} 帧` : '处理中';
                    setProgress(exportProgress, `导出中 ${frames}`);
                    setStatus(`正在导出视频，已处理 ${frames}。`);
                }
            }
        });
        if (jobId !== state.jobId) return;

        if (state.processedUrl) URL.revokeObjectURL(state.processedUrl);
        state.processedUrl = URL.createObjectURL(result.blob);
        els.processedVideo.src = state.processedUrl;
        els.processedVideo.load();
        els.processedEmpty.hidden = true;
        updateCompareMode();
        syncProcessedToOriginal({ force: true });
        els.downloadBtn.href = state.processedUrl;
        els.downloadBtn.download = `${state.file.name.replace(/\.[^.]+$/, '')}_gwr_video_mvp.mp4`;
        setProgress(1, '完成');
        const audioNote = result.audioCopied
            ? `音频已保留：${result.audioCodec || 'unknown'}，${result.audioPacketCount || 0} packets。`
            : `音频未保留：${result.audioSkipReason || 'unknown'}。`;
        setStatus(`导出完成，已处理 ${result.processedFrames} 帧，后端去噪：${result.denoiseBackend}。${audioNote}`, 'success');
    } catch (error) {
        console.error(error);
        setStatus(error.message || '导出失败', 'error');
    } finally {
        state.running = false;
        updateButtons();
    }
}

function reset() {
    state.jobId++;
    cleanupUrls();
    state.file = null;
    state.metadata = null;
    state.detection = null;
    state.running = false;
    els.fileInput.value = '';
    els.originalVideo.removeAttribute('src');
    els.originalVideo.load();
    els.processedVideo.removeAttribute('src');
    els.processedVideo.load();
    els.downloadBtn.removeAttribute('href');
    els.downloadBtn.removeAttribute('download');
    els.originalEmpty.hidden = false;
    updateCompareMode();
    renderMetadata(null);
    renderDetection(null);
    renderAutoPresetSummary(null);
    setProgress(0, '等待视频');
    setStatus('');
    updateButtons();
}

function setNumberControl(input, value) {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyPresetToControls(preset) {
    if (!preset) return;
    setNumberControl(els.alphaGain, preset.alphaGain ?? DEFAULT_ALPHA_GAIN);
    els.adaptiveAlpha.checked = preset.adaptiveAlpha ?? DEFAULT_ADAPTIVE_ALPHA;
    els.highQualityCleanup.checked = preset.highQualityCleanup ?? DEFAULT_HIGH_QUALITY_CLEANUP;
    els.denoiseBackend.value = Object.values(VIDEO_DENOISE_BACKENDS).includes(preset.denoiseBackend)
        ? preset.denoiseBackend
        : DEFAULT_DENOISE_BACKEND;
    els.denoiseBackend.dispatchEvent(new Event('change', { bubbles: true }));
    setNumberControl(els.edgeDenoiseStrength, preset.edgeDenoiseStrength ?? DEFAULT_EDGE_DENOISE_STRENGTH);
    setNumberControl(els.residualCleanup, preset.residualCleanupStrength ?? DEFAULT_RESIDUAL_CLEANUP_STRENGTH);
    els.sampleCount.value = String(preset.sampleCount ?? DEFAULT_SAMPLE_COUNT);
    els.videoBitrateMbps.value = Number(preset.videoBitrateMbps) > 0
        ? String(preset.videoBitrateMbps)
        : '';
    els.allowLowConfidence.checked = preset.allowLowConfidence === true;
    renderAutoPresetSummary(preset);
}

function applyAutomaticPreset(detection = state.detection, metadata = state.metadata, { silent = false } = {}) {
    const preset = getAutomaticVideoPresetConfig(detection, metadata);
    applyPresetToControls(preset);
    if (!silent) {
        setStatus(`已自动选择：${preset.label}。`, preset.allowLowConfidence ? 'warn' : 'success');
    }
    return preset;
}

function applyRelocatedReviewPreset() {
    const preset = getRelocatedReviewPresetConfig();
    applyPresetToControls(preset);
    setStatus('已应用迁移锚点复核预设：匹配 Delta 0.25、12Mbps、允许低置信。此预设用于人工复核，不是默认策略。', 'warn');
}

function setupEvents() {
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            els.fileInput.click();
        }
    });
    els.fileInput.addEventListener('change', (event) => {
        const file = pickDebugUploadFile(event.target.files);
        if (file) setFile(file);
    });

    for (const eventName of ['dragenter', 'dragover']) {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.dataset.dragging = 'true';
        });
    }
    for (const eventName of ['dragleave', 'drop']) {
        els.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            els.dropzone.dataset.dragging = 'false';
        });
    }
    els.dropzone.addEventListener('drop', (event) => {
        const file = pickDebugUploadFile(event.dataTransfer?.files);
        if (file) setFile(file);
    });

    els.alphaGain.addEventListener('input', () => {
        els.alphaGainValue.textContent = Number(els.alphaGain.value).toFixed(2);
    });
    els.residualCleanup.addEventListener('input', () => {
        els.residualCleanupValue.textContent = Number(els.residualCleanup.value).toFixed(2);
    });
    els.edgeDenoiseStrength.addEventListener('input', () => {
        els.edgeDenoiseStrengthValue.textContent = Number(els.edgeDenoiseStrength.value).toFixed(2);
    });
    els.detectBtn.addEventListener('click', runDetection);
    els.processBtn.addEventListener('click', runExport);
    els.resetBtn.addEventListener('click', reset);
    els.relocatedReviewPresetBtn.addEventListener('click', applyRelocatedReviewPreset);
    els.downloadBtn.addEventListener('click', (event) => {
        if (!state.processedUrl || state.running) event.preventDefault();
    });
    els.playPauseBtn.addEventListener('click', togglePlayback);
    els.scrubber.addEventListener('input', (event) => {
        seekComparison(event.target.value);
    });
    els.originalVideo.addEventListener('loadedmetadata', () => {
        updatePlaybackControls();
    });
    els.originalVideo.addEventListener('timeupdate', () => {
        if (!els.originalVideo.paused) syncProcessedToOriginal();
        updatePlaybackControls();
    });
    els.originalVideo.addEventListener('pause', () => {
        if (!els.processedVideo.paused) els.processedVideo.pause();
        updatePlaybackControls();
    });
    els.originalVideo.addEventListener('ended', () => {
        pauseComparison();
    });
    els.processedVideo.addEventListener('loadedmetadata', () => {
        syncProcessedToOriginal({ force: true });
        updateCompareMode();
    });
    window.addEventListener('beforeunload', cleanupUrls);
}

async function consumePendingVideoHandoff() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fileHandoff') !== '1') return;

    try {
        const record = await consumeDebugFileHandoff('video');
        if (!record?.file) return;
        await setFile(record.file);
        window.history.replaceState(null, '', window.location.pathname);
    } catch (error) {
        console.warn('video handoff unavailable:', error);
        setStatus(error.message || '读取视频暂存失败，请重新选择文件。', 'warn');
    }
}

async function init() {
    els.alphaGain.value = String(DEFAULT_ALPHA_GAIN);
    els.alphaGainValue.textContent = DEFAULT_ALPHA_GAIN.toFixed(2);
    els.adaptiveAlpha.checked = DEFAULT_ADAPTIVE_ALPHA;
    els.highQualityCleanup.checked = DEFAULT_HIGH_QUALITY_CLEANUP;
    els.denoiseBackend.value = Object.values(VIDEO_DENOISE_BACKENDS).includes(DEFAULT_DENOISE_BACKEND)
        ? DEFAULT_DENOISE_BACKEND
        : VIDEO_DENOISE_BACKENDS.NONE;
    els.edgeDenoiseStrength.value = String(DEFAULT_EDGE_DENOISE_STRENGTH);
    els.edgeDenoiseStrengthValue.textContent = DEFAULT_EDGE_DENOISE_STRENGTH.toFixed(2);
    els.residualCleanup.value = String(DEFAULT_RESIDUAL_CLEANUP_STRENGTH);
    els.residualCleanupValue.textContent = DEFAULT_RESIDUAL_CLEANUP_STRENGTH.toFixed(2);
    els.videoBitrateMbps.value = '';
    els.sampleCount.value = String(DEFAULT_SAMPLE_COUNT);
    renderAutoPresetSummary(getAutomaticVideoPresetConfig());

    if (!('VideoDecoder' in window) || !('VideoEncoder' in window)) {
        setStatus('当前浏览器缺少 WebCodecs，请使用新版 Chrome 或 Edge。', 'error');
    }

    renderMetadata(null);
    renderDetection(null);
    updateCompareMode();
    setProgress(0, '等待视频');
    setupEvents();
    updateButtons();
    await consumePendingVideoHandoff();
}

init();
