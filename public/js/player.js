import {
  getPlayerPrefs,
  savePlayerPrefs,
  saveEpisodeProgress,
  getEpisodeProgress
} from './storage.js';

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseTimeVtt(str) {
  const parts = String(str || '').trim().split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2].replace(',', '.'));
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + parseFloat(parts[1].replace(',', '.'));
  }
  return 0;
}

export function parseWebVtt(vttText) {
  const lines = String(vttText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const cues = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === 'WEBVTT' || line.startsWith('NOTE') || line.startsWith('STYLE')) {
      i += 1;
      continue;
    }

    let timingLine = line;
    if (!timingLine.includes('-->') && i + 1 < lines.length && lines[i + 1].includes('-->')) {
      i += 1;
      timingLine = lines[i].trim();
    }

    if (timingLine.includes('-->')) {
      const [rawStart, rawEndWithSettings] = timingLine.split('-->');
      const rawEnd = (rawEndWithSettings || '').trim().split(/\s+/)[0];
      const start = parseTimeVtt(rawStart);
      const end = parseTimeVtt(rawEnd);
      i += 1;

      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i += 1;
      }

      const text = textLines
        .join('\n')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (text && end > start) {
        cues.push({ start, end, text });
      }
    } else {
      i += 1;
    }
  }

  return cues;
}

export class RanzzPlayer {
  constructor({
    stageEl,
    streamData,
    dramaDetail,
    onNavigateEpisode,
    onReloadStream,
    onToast
  }) {
    this.stageEl = stageEl;
    this.streamData = streamData;
    this.dramaDetail = dramaDetail;
    this.onNavigateEpisode = onNavigateEpisode;
    this.onReloadStream = onReloadStream;
    this.onToast = onToast || (() => {});

    this.hls = null;
    this.cues = [];
    this.activeSubLang = 'off';
    this.prefs = getPlayerPrefs();
    this.brightness = 1;
    this.controlsTimer = null;
    this.singleTapTimer = null;
    this.countdownTimer = null;
    this.countdownValue = 5;
    this.autoRetried = false;
    this.destroyed = false;
    this.lastSaveTs = 0;

    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundDocClick = this.handleDocumentClick.bind(this);
    this.init();
  }

  async init() {
    this.video = this.stageEl.querySelector('#ranzz-video');
    this.spinnerEl = this.stageEl.querySelector('#player-spinner');
    this.centerBtn = this.stageEl.querySelector('#player-center-toggle');
    this.playBtn = this.stageEl.querySelector('#ctrl-play');
    this.muteBtn = this.stageEl.querySelector('#ctrl-mute');
    this.volSlider = this.stageEl.querySelector('#ctrl-volume');
    this.timeLabel = this.stageEl.querySelector('#ctrl-time');
    this.seekInput = this.stageEl.querySelector('#ctrl-seek');
    this.seekFill = this.stageEl.querySelector('#seek-fill');
    this.seekBuffer = this.stageEl.querySelector('#seek-buffer');
    this.subOverlay = this.stageEl.querySelector('#subtitle-overlay');
    this.subBox = this.stageEl.querySelector('#subtitle-cue-box');
    this.subBtn = this.stageEl.querySelector('#ctrl-subtitles');
    this.settingsBtn = this.stageEl.querySelector('#ctrl-settings');
    this.popoverEl = this.stageEl.querySelector('#player-popover');
    this.modalEl = this.stageEl.querySelector('#player-modal');
    this.seekLeftEl = this.stageEl.querySelector('#seek-feedback-left');
    this.seekRightEl = this.stageEl.querySelector('#seek-feedback-right');
    this.gestureHud = this.stageEl.querySelector('#gesture-hud');

    this.applyPrefsToUI();
    this.bindEvents();
    this.setupInitialSubtitle();

    await this.waitForHls();
    if (!this.destroyed) {
      this.attachStream(this.streamData.proxyUrl);
    }
  }

  async waitForHls() {
    if (window.Hls || (this.video && this.video.canPlayType('application/vnd.apple.mpegurl'))) {
      return;
    }
    for (let i = 0; i < 25; i += 1) {
      if (window.Hls || this.destroyed) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  setBuffering(isBuffering) {
    if (!this.spinnerEl) return;
    this.spinnerEl.hidden = !isBuffering;
    if (this.centerBtn) {
      this.centerBtn.style.visibility = isBuffering ? 'hidden' : 'visible';
    }
  }

  applyPrefsToUI() {
    if (!this.video) return;
    this.video.volume = Math.max(0, Math.min(1, this.prefs.volume ?? 1));
    this.video.muted = Boolean(this.prefs.muted);
    this.video.playbackRate = Number(this.prefs.speed) || 1;
    if (this.volSlider) {
      this.volSlider.value = String(this.video.muted ? 0 : this.video.volume);
    }
    if (this.timeLabel && this.streamData.duration) {
      this.timeLabel.textContent = `00:00 / ${formatTime(this.streamData.duration)}`;
    }
    this.updateMuteIcon();
    this.updateSubtitleStyle();
    this.updateSubtitleButtonBadge();
  }

  updateSubtitleStyle() {
    if (!this.subOverlay) return;
    this.subOverlay.className = `subtitle-overlay sub-size-${this.prefs.subSize || 'md'} sub-pos-${this.prefs.subPos || 'bottom'}`;
  }

  updateSubtitleButtonBadge() {
    if (!this.subBtn) return;
    const dot = this.subBtn.querySelector('.sub-active-dot');
    const isActive = this.activeSubLang && this.activeSubLang !== 'off';
    if (isActive && !dot) {
      const span = document.createElement('span');
      span.className = 'sub-active-dot';
      this.subBtn.appendChild(span);
    } else if (!isActive && dot) {
      dot.remove();
    }
  }

  setupInitialSubtitle() {
    const subs = this.streamData.subtitles || [];
    if (!subs.length) {
      this.activeSubLang = 'off';
      this.updateSubtitleButtonBadge();
      return;
    }

    const prefLang = (this.prefs.subLang || 'id-ID').toLowerCase();
    if (prefLang === 'off') {
      this.activeSubLang = 'off';
      this.updateSubtitleButtonBadge();
      return;
    }

    const chosen =
      subs.find((s) => String(s.language).toLowerCase() === prefLang) ||
      subs.find((s) => String(s.language).toLowerCase().startsWith('id')) ||
      subs.find((s) => String(s.language).toLowerCase().startsWith('en')) ||
      subs.find((s) => s.isDefault) ||
      subs[0];

    if (chosen) {
      this.loadSubtitleTrack(chosen);
    }
  }

  async loadSubtitleTrack(subObj) {
    if (!subObj || !subObj.proxyUrl) {
      this.activeSubLang = 'off';
      this.cues = [];
      if (this.subBox) this.subBox.hidden = true;
      this.updateSubtitleButtonBadge();
      return;
    }

    this.activeSubLang = subObj.language;
    this.prefs = savePlayerPrefs({ subLang: subObj.language });
    this.updateSubtitleButtonBadge();

    try {
      const res = await fetch(subObj.proxyUrl);
      if (!res.ok) throw new Error('Sub fetch failed');
      const vttText = await res.text();
      if (this.destroyed) return;
      this.cues = parseWebVtt(vttText);
      this.renderCurrentCue();
    } catch {
      this.cues = [];
      if (this.subBox) this.subBox.hidden = true;
    }
  }

  renderCurrentCue() {
    if (!this.subBox || !this.video) return;
    if (this.activeSubLang === 'off' || !this.cues.length) {
      this.subBox.hidden = true;
      return;
    }
    const t = this.video.currentTime;
    const active = this.cues.find((c) => t >= c.start && t <= c.end);
    if (active) {
      this.subBox.textContent = active.text;
      this.subBox.hidden = false;
    } else {
      this.subBox.hidden = true;
    }
  }

  attachStream(proxyM3u8Url) {
    if (!this.video || !proxyM3u8Url) return;
    this.hideModal();
    this.setBuffering(true);

    const savedProg = getEpisodeProgress(this.streamData.seriesId, this.streamData.episodeNumber);
    const resumeTime =
      savedProg && savedProg.currentTime > 3 && (!savedProg.duration || savedProg.currentTime < savedProg.duration - 5)
        ? savedProg.currentTime
        : 0;

    let hasInitializedPlayback = false;
    const onReadyToPlay = () => {
      if (hasInitializedPlayback || this.destroyed) return;
      hasInitializedPlayback = true;
      this.setBuffering(false);

      if (resumeTime > 0 && Math.abs(this.video.currentTime - resumeTime) > 2) {
        try {
          this.video.currentTime = resumeTime;
          this.onToast(`Melanjutkan dari ${formatTime(resumeTime)}`);
        } catch {}
      }

      this.video.playbackRate = Number(this.prefs.speed) || 1;
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          this.updatePlayState(false);
          this.setBuffering(false);
        });
      }
    };

    if (window.Hls && window.Hls.isSupported()) {
      if (this.hls) {
        this.hls.destroy();
      }
      const hls = new window.Hls({
        enableWorker: true,
        maxBufferLength: 30,
        backBufferLength: 30
      });
      this.hls = hls;
      hls.loadSource(proxyM3u8Url);
      hls.attachMedia(this.video);

      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (hls.audioTracks && hls.audioTracks.length > 0 && hls.audioTrack === -1) {
          hls.audioTrack = 0;
        }
        onReadyToPlay();
      });

      hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (hls.audioTracks && hls.audioTracks.length > 0 && hls.audioTrack === -1) {
          hls.audioTrack = 0;
        }
      });

      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        this.handleStreamFailure();
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = proxyM3u8Url;
      this.video.addEventListener('loadedmetadata', onReadyToPlay, { once: true });
      this.video.addEventListener('error', () => this.handleStreamFailure(), { once: true });
    } else {
      this.setBuffering(false);
      this.showErrorModal('Browser Anda tidak mendukung pemutaran video HLS.');
    }
  }

  async handleStreamFailure() {
    if (this.destroyed) return;
    this.setBuffering(false);
    if (!this.autoRetried && typeof this.onReloadStream === 'function') {
      this.autoRetried = true;
      this.onToast('Memperbarui tautan stream...');
      try {
        const freshStream = await this.onReloadStream(true);
        if (freshStream && freshStream.proxyUrl) {
          this.streamData = freshStream;
          this.attachStream(freshStream.proxyUrl);
          return;
        }
      } catch {
        // Fall through to manual retry modal.
      }
    }
    this.showErrorModal('Stream video terputus atau tautan sudah kedaluwarsa.');
  }

  showErrorModal(msg) {
    if (!this.modalEl) return;
    this.setBuffering(false);
    this.modalEl.hidden = false;
    this.modalEl.innerHTML = `
      <div class="state-title" style="color:#ffffff;">Gagal Memutar Video</div>
      <p class="state-desc" style="color:#d4d4d8; max-width:340px; margin-bottom:16px;">${msg}</p>
      <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center;">
        <button type="button" class="btn-primary" id="modal-retry-stream">Coba Lagi</button>
      </div>
    `;
    const retryBtn = this.modalEl.querySelector('#modal-retry-stream');
    if (retryBtn) {
      retryBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.modalEl.innerHTML = `<div class="state-desc" style="color:#ffffff;">Mengambil ulang URL stream baru...</div>`;
        try {
          const fresh = await this.onReloadStream(true);
          if (fresh && fresh.proxyUrl) {
            this.streamData = fresh;
            this.attachStream(fresh.proxyUrl);
          }
        } catch {
          this.showErrorModal('Masih gagal memuat stream. Periksa koneksi internet Anda.');
        }
      });
    }
  }

  hideModal() {
    this.clearCountdown();
    if (this.modalEl) {
      this.modalEl.hidden = true;
      this.modalEl.innerHTML = '';
    }
  }

  clearCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  startAutoNextCountdown() {
    const nextEp = this.streamData.nextEpisode;
    if (!nextEp || !this.modalEl) return;

    this.clearCountdown();
    this.countdownValue = 5;
    this.modalEl.hidden = false;

    const renderCountdown = () => {
      this.modalEl.innerHTML = `
        <div class="countdown-ring" id="countdown-num">${this.countdownValue}</div>
        <div class="state-title" style="color:#ffffff;">Episode ${nextEp.episode} Berikutnya</div>
        <p class="state-desc" style="color:#d4d4d8; margin-bottom:16px;">Memutar otomatis dalam <span id="countdown-text">${this.countdownValue}</span> detik</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center;">
          <button type="button" class="btn-primary" id="auto-next-now">Putar Sekarang</button>
          <button type="button" class="btn-secondary" id="auto-next-cancel">Tetap di Sini</button>
        </div>
      `;

      this.modalEl.querySelector('#auto-next-now')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearCountdown();
        this.onNavigateEpisode(nextEp.episode);
      });

      this.modalEl.querySelector('#auto-next-cancel')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideModal();
      });
    };

    renderCountdown();
    this.countdownTimer = setInterval(() => {
      this.countdownValue -= 1;
      if (this.countdownValue <= 0) {
        this.clearCountdown();
        this.onNavigateEpisode(nextEp.episode);
      } else {
        const numEl = this.modalEl.querySelector('#countdown-num');
        const txtEl = this.modalEl.querySelector('#countdown-text');
        if (numEl) numEl.textContent = String(this.countdownValue);
        if (txtEl) txtEl.textContent = String(this.countdownValue);
      }
    }, 1000);
  }

  handleDocumentClick(e) {
    if (!this.popoverEl || this.popoverEl.hidden) return;
    const target = e.target;
    if (
      this.popoverEl.contains(target) ||
      this.subBtn?.contains(target) ||
      this.settingsBtn?.contains(target)
    ) {
      return;
    }
    this.popoverEl.hidden = true;
  }

  bindEvents() {
    if (!this.video) return;

    const showControls = () => {
      this.stageEl.classList.add('controls-visible');
      clearTimeout(this.controlsTimer);
      this.controlsTimer = setTimeout(() => {
        if (!this.video.paused && (!this.popoverEl || this.popoverEl.hidden)) {
          this.stageEl.classList.remove('controls-visible');
        }
      }, 3200);
    };

    this.stageEl.addEventListener('mousemove', showControls);
    this.stageEl.addEventListener('touchstart', showControls, { passive: true });
    showControls();

    document.addEventListener('click', this.boundDocClick);

    this.video.addEventListener('loadstart', () => this.setBuffering(true));
    this.video.addEventListener('waiting', () => this.setBuffering(true));
    this.video.addEventListener('seeking', () => this.setBuffering(true));
    this.video.addEventListener('canplay', () => this.setBuffering(false));
    this.video.addEventListener('seeked', () => this.setBuffering(false));
    this.video.addEventListener('playing', () => {
      this.setBuffering(false);
      this.updatePlayState(true);
    });
    this.video.addEventListener('play', () => this.updatePlayState(true));
    this.video.addEventListener('pause', () => {
      this.setBuffering(false);
      this.updatePlayState(false);
      this.persistProgress(true);
      this.stageEl.classList.add('controls-visible');
    });

    this.video.addEventListener('timeupdate', () => {
      const cur = this.video.currentTime || 0;
      const dur = this.video.duration || this.streamData.duration || 0;
      const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

      if (this.seekFill) this.seekFill.style.width = `${pct}%`;
      if (this.seekInput) this.seekInput.value = String(pct);
      if (this.timeLabel) this.timeLabel.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;

      this.renderCurrentCue();
      this.persistProgress(false);
    });

    this.video.addEventListener('progress', () => {
      const dur = this.video.duration || this.streamData.duration || 0;
      if (dur > 0 && this.video.buffered.length > 0 && this.seekBuffer) {
        const bufEnd = this.video.buffered.end(this.video.buffered.length - 1);
        this.seekBuffer.style.width = `${Math.min(100, (bufEnd / dur) * 100)}%`;
      }
    });

    this.video.addEventListener('ended', () => {
      this.persistProgress(true);
      this.startAutoNextCountdown();
    });

    this.centerBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlay();
    });

    this.playBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlay();
    });

    this.seekInput?.addEventListener('input', (e) => {
      e.stopPropagation();
      const pct = Number(e.target.value);
      const dur = this.video.duration || this.streamData.duration || 0;
      if (dur > 0) {
        this.video.currentTime = (pct / 100) * dur;
        if (this.seekFill) this.seekFill.style.width = `${pct}%`;
      }
    });

    this.muteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMute();
    });

    this.volSlider?.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = Number(e.target.value);
      this.setVolume(val);
    });

    this.stageEl.querySelector('#ctrl-next-ep')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.streamData.nextEpisode) {
        this.onNavigateEpisode(this.streamData.nextEpisode.episode);
      }
    });

    this.subBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPopover('subtitles');
    });

    this.settingsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPopover('settings');
    });

    this.stageEl.querySelector('#ctrl-pip')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (this.video.requestPictureInPicture) {
          await this.video.requestPictureInPicture();
        } else {
          this.onToast('Picture-in-Picture tidak didukung pada perangkat ini.');
        }
      } catch {
        this.onToast('Picture-in-Picture belum tersedia saat ini.');
      }
    });

    this.stageEl.querySelector('#ctrl-fullscreen')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    });

    // Click and Double-Tap on video surface + mobile vertical swipe gestures
    let lastTapTime = 0;
    let touchStartY = null;
    let touchSide = null;
    let startVal = 0;
    let didSwipeGesture = false;

    this.video.addEventListener('click', (e) => {
      if (didSwipeGesture) {
        didSwipeGesture = false;
        return;
      }

      if (this.popoverEl && !this.popoverEl.hidden) {
        this.popoverEl.hidden = true;
        return;
      }

      const now = Date.now();
      const rect = this.video.getBoundingClientRect();
      const relX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;

      if (now - lastTapTime < 260) {
        clearTimeout(this.singleTapTimer);
        if (relX < 0.38) {
          this.seekBy(-10);
          this.flashSeekIndicator('left');
        } else if (relX > 0.62) {
          this.seekBy(10);
          this.flashSeekIndicator('right');
        } else {
          this.toggleFullscreen();
        }
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        clearTimeout(this.singleTapTimer);
        this.singleTapTimer = setTimeout(() => {
          this.togglePlay();
        }, 230);
      }
    });

    this.video.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = this.video.getBoundingClientRect();
      touchStartY = touch.clientY;
      didSwipeGesture = false;
      const relX = rect.width > 0 ? (touch.clientX - rect.left) / rect.width : 0.5;
      touchSide = relX < 0.5 ? 'left' : 'right';
      startVal = touchSide === 'right' ? this.video.volume : this.brightness;
    }, { passive: true });

    this.video.addEventListener('touchmove', (e) => {
      if (touchStartY === null || e.touches.length !== 1) return;
      const deltaY = touchStartY - e.touches[0].clientY;
      if (Math.abs(deltaY) < 28) return;

      didSwipeGesture = true;
      const change = deltaY / 220;
      if (touchSide === 'right') {
        const nextVol = Math.max(0, Math.min(1, startVal + change));
        this.setVolume(nextVol);
        this.showGestureHud(`Volume: ${Math.round(nextVol * 100)}%`);
      } else {
        this.brightness = Math.max(0.45, Math.min(1.35, startVal + change));
        this.video.style.filter = `brightness(${this.brightness.toFixed(2)})`;
        this.showGestureHud(`Kecerahan: ${Math.round(this.brightness * 100)}%`);
      }
    }, { passive: true });

    this.video.addEventListener('touchend', () => {
      touchStartY = null;
      if (this.gestureHud) {
        setTimeout(() => {
          if (this.gestureHud) this.gestureHud.hidden = true;
        }, 700);
      }
    });

    window.addEventListener('keydown', this.boundKeyDown);
  }

  showGestureHud(text) {
    if (!this.gestureHud) return;
    this.gestureHud.textContent = text;
    this.gestureHud.hidden = false;
  }

  flashSeekIndicator(side) {
    const el = side === 'left' ? this.seekLeftEl : this.seekRightEl;
    if (!el) return;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 550);
  }

  openPopover(tab) {
    if (!this.popoverEl) return;
    const isSameOpen = !this.popoverEl.hidden && this.popoverEl.dataset.tab === tab;
    if (isSameOpen) {
      this.popoverEl.hidden = true;
      return;
    }

    this.popoverEl.dataset.tab = tab;
    this.popoverEl.hidden = false;
    this.stageEl.classList.add('controls-visible');

    if (tab === 'subtitles') {
      this.renderSubtitlesPopover();
    } else {
      this.renderSettingsPopover();
    }
  }

  renderSubtitlesPopover() {
    const subs = this.streamData.subtitles || [];
    const curSize = this.prefs.subSize || 'md';
    const curPos = this.prefs.subPos || 'bottom';

    this.popoverEl.innerHTML = `
      <div class="popover-header">
        <span class="popover-header-title">Pengaturan Subtitle (${subs.length})</span>
        <button type="button" class="popover-close-btn" id="popover-close-btn" aria-label="Tutup menu subtitle">Tutup</button>
      </div>
      <div class="popover-section-title">Pilih Bahasa</div>
      <div class="sub-list">
        <button type="button" class="sub-item-btn ${this.activeSubLang === 'off' ? 'active' : ''}" data-sub-lang="off">
          <span>Nonaktif (Tanpa Subtitle)</span>
          ${this.activeSubLang === 'off' ? '<span>Aktif</span>' : ''}
        </button>
        ${subs
          .map(
            (s) => `
          <button type="button" class="sub-item-btn ${this.activeSubLang === s.language ? 'active' : ''}" data-sub-lang="${s.language}">
            <span>${s.displayName}</span>
            <span style="font-size:0.72rem; opacity:0.8;">${s.language}</span>
          </button>
        `
          )
          .join('')}
      </div>
      <div class="popover-section-title">Ukuran Teks</div>
      <div class="popover-grid">
        <button type="button" class="popover-opt-btn ${curSize === 'sm' ? 'active' : ''}" data-sub-size="sm">Kecil</button>
        <button type="button" class="popover-opt-btn ${curSize === 'md' ? 'active' : ''}" data-sub-size="md">Sedang</button>
        <button type="button" class="popover-opt-btn ${curSize === 'lg' ? 'active' : ''}" data-sub-size="lg">Besar</button>
      </div>
      <div class="popover-section-title">Posisi Subtitle</div>
      <div class="popover-grid">
        <button type="button" class="popover-opt-btn ${curPos === 'bottom' ? 'active' : ''}" data-sub-pos="bottom">Bawah</button>
        <button type="button" class="popover-opt-btn ${curPos === 'mid' ? 'active' : ''}" data-sub-pos="mid">Tengah</button>
        <button type="button" class="popover-opt-btn ${curPos === 'high' ? 'active' : ''}" data-sub-pos="high">Tinggi</button>
      </div>
    `;

    this.popoverEl.querySelector('#popover-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.popoverEl.hidden = true;
    });

    this.popoverEl.querySelectorAll('[data-sub-lang]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lang = btn.dataset.subLang;
        if (lang === 'off') {
          this.activeSubLang = 'off';
          this.cues = [];
          this.prefs = savePlayerPrefs({ subLang: 'off' });
          this.updateSubtitleButtonBadge();
          this.renderCurrentCue();
        } else {
          const found = subs.find((s) => s.language === lang);
          if (found) this.loadSubtitleTrack(found);
        }
        this.renderSubtitlesPopover();
      });
    });

    this.popoverEl.querySelectorAll('[data-sub-size]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.prefs = savePlayerPrefs({ subSize: btn.dataset.subSize });
        this.updateSubtitleStyle();
        this.renderSubtitlesPopover();
      });
    });

    this.popoverEl.querySelectorAll('[data-sub-pos]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.prefs = savePlayerPrefs({ subPos: btn.dataset.subPos });
        this.updateSubtitleStyle();
        this.renderSubtitlesPopover();
      });
    });
  }

  renderSettingsPopover() {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const curSpeed = Number(this.video?.playbackRate) || 1;
    const levels = this.hls?.levels || [];
    const curLevel = this.hls ? this.hls.currentLevel : -1;
    const hlsAudio = this.hls?.audioTracks || [];

    this.popoverEl.innerHTML = `
      <div class="popover-header">
        <span class="popover-header-title">Kualitas & Kecepatan</span>
        <button type="button" class="popover-close-btn" id="popover-close-btn" aria-label="Tutup pengaturan">Tutup</button>
      </div>
      <div class="popover-section-title">Kecepatan Putar</div>
      <div class="popover-grid">
        ${speeds
          .map(
            (sp) => `
          <button type="button" class="popover-opt-btn ${curSpeed === sp ? 'active' : ''}" data-speed="${sp}">${sp}x</button>
        `
          )
          .join('')}
      </div>
      ${
        levels.length > 0
          ? `
        <div class="popover-section-title">Kualitas Video</div>
        <div class="popover-grid">
          <button type="button" class="popover-opt-btn ${curLevel === -1 ? 'active' : ''}" data-level="-1">Otomatis</button>
          ${levels
            .map((lv, idx) => {
              const res = lv.width && lv.height ? Math.min(lv.width, lv.height) : lv.height || 720;
              const label = `${res}p`;
              return `<button type="button" class="popover-opt-btn ${curLevel === idx ? 'active' : ''}" data-level="${idx}">${label}</button>`;
            })
            .join('')}
        </div>
      `
          : ''
      }
      ${
        hlsAudio.length > 1
          ? `
        <div class="popover-section-title">Trek Audio</div>
        <div class="popover-grid">
          ${hlsAudio
            .map(
              (at, idx) => `
            <button type="button" class="popover-opt-btn ${this.hls.audioTrack === idx ? 'active' : ''}" data-audio="${idx}">${at.name || at.lang || `Audio ${idx + 1}`}</button>
          `
            )
            .join('')}
        </div>
      `
          : `<div class="popover-section-title" style="margin-top:12px;">Audio Asli: ${this.streamData.originalAudio || 'Bahasa Asli'}</div>`
      }
    `;

    this.popoverEl.querySelector('#popover-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.popoverEl.hidden = true;
    });

    this.popoverEl.querySelectorAll('[data-speed]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sp = Number(btn.dataset.speed) || 1;
        if (this.video) this.video.playbackRate = sp;
        this.prefs = savePlayerPrefs({ speed: sp });
        this.renderSettingsPopover();
      });
    });

    this.popoverEl.querySelectorAll('[data-level]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.hls) {
          this.hls.currentLevel = Number(btn.dataset.level);
          this.renderSettingsPopover();
        }
      });
    });

    this.popoverEl.querySelectorAll('[data-audio]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.hls) {
          this.hls.audioTrack = Number(btn.dataset.audio);
          this.renderSettingsPopover();
        }
      });
    });
  }

  togglePlay() {
    if (!this.video) return;
    if (this.video.paused) {
      this.video.play().catch(() => {});
    } else {
      this.video.pause();
    }
  }

  updatePlayState(isPlaying) {
    this.stageEl.classList.toggle('playing', isPlaying);
    const playIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>`;
    const pauseIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    if (this.playBtn) this.playBtn.innerHTML = isPlaying ? pauseIcon : playIcon;
    if (this.centerBtn) this.centerBtn.innerHTML = isPlaying ? pauseIcon : playIcon;
  }

  seekBy(deltaSec) {
    if (!this.video) return;
    const dur = this.video.duration || this.streamData.duration || 0;
    const next = Math.max(0, Math.min(dur || 9999, this.video.currentTime + deltaSec));
    this.video.currentTime = next;
  }

  setVolume(val) {
    if (!this.video) return;
    const clamped = Math.max(0, Math.min(1, val));
    this.video.volume = clamped;
    this.video.muted = clamped === 0;
    if (this.volSlider) this.volSlider.value = String(clamped);
    this.prefs = savePlayerPrefs({ volume: clamped, muted: this.video.muted });
    this.updateMuteIcon();
  }

  toggleMute() {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
    if (this.volSlider) {
      this.volSlider.value = String(this.video.muted ? 0 : this.video.volume || 1);
    }
    this.prefs = savePlayerPrefs({ muted: this.video.muted });
    this.updateMuteIcon();
  }

  updateMuteIcon() {
    if (!this.muteBtn || !this.video) return;
    const isMuted = this.video.muted || this.video.volume === 0;
    this.muteBtn.innerHTML = isMuted
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        if (this.stageEl.requestFullscreen) {
          await this.stageEl.requestFullscreen();
        } else if (this.video?.webkitEnterFullscreen) {
          this.video.webkitEnterFullscreen();
          return;
        }
        if (screen.orientation && screen.orientation.lock && this.video) {
          const isLandscapeVideo = this.video.videoWidth > this.video.videoHeight;
          screen.orientation.lock(isLandscapeVideo ? 'landscape' : 'portrait').catch(() => {});
        }
      } else {
        await document.exitFullscreen();
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock();
        }
      }
    } catch {}
  }

  handleKeyDown(e) {
    if (this.destroyed) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'k') {
      e.preventDefault();
      this.togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.seekBy(-10);
      this.flashSeekIndicator('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.seekBy(10);
      this.flashSeekIndicator('right');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.setVolume((this.video?.volume || 0) + 0.1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.setVolume((this.video?.volume || 0) - 0.1);
    } else if (key === 'f') {
      e.preventDefault();
      this.toggleFullscreen();
    } else if (key === 'm') {
      e.preventDefault();
      this.toggleMute();
    } else if (key === 'n') {
      if (this.streamData.nextEpisode) {
        e.preventDefault();
        this.onNavigateEpisode(this.streamData.nextEpisode.episode);
      }
    } else if (e.key === 'Escape' && this.popoverEl && !this.popoverEl.hidden) {
      this.popoverEl.hidden = true;
    }
  }

  persistProgress(force = false) {
    if (!this.video) return;
    const now = Date.now();
    if (!force && now - this.lastSaveTs < 3000) return;
    this.lastSaveTs = now;

    const currentTime = this.video.currentTime || 0;
    const duration = this.video.duration || this.streamData.duration || 0;
    if (currentTime < 1) return;

    saveEpisodeProgress({
      seriesId: this.streamData.seriesId,
      title: this.dramaDetail?.title || this.streamData.seriesTitle,
      synopsis: this.dramaDetail?.synopsis || '',
      thumbnail: this.dramaDetail?.thumbnail || null,
      posterProxy: this.dramaDetail?.posterProxy || this.streamData.posterProxy,
      landscapeProxy: this.dramaDetail?.landscapeProxy || this.streamData.landscapeProxy,
      genre: this.dramaDetail?.genre || '',
      episodeCount: this.dramaDetail?.totalEpisodes || this.streamData.totalEpisodes,
      episodeId: this.streamData.episodeId,
      episodeNumber: this.streamData.episodeNumber,
      currentTime,
      duration
    });
  }

  destroy() {
    this.destroyed = true;
    this.persistProgress(true);
    this.clearCountdown();
    clearTimeout(this.controlsTimer);
    clearTimeout(this.singleTapTimer);
    window.removeEventListener('keydown', this.boundKeyDown);
    document.removeEventListener('click', this.boundDocClick);
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
  }
}
