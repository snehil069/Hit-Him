/**
 * ===================================================
 * HIT HIM - RETRO ARCADE BOXING GAME ENGINE
 * ===================================================
 */

(function () {
  'use strict';

  // --- CONFIGURATION & CONSTANTS ---
  const DEBUG_HITBOXES = false;
  const GAME_DURATION = 20; // 20 seconds as requested
  const HITS_PER_ZONE = 3;
  const TOTAL_ZONES = 5;
  const TARGET_TOTAL_HITS = TOTAL_ZONES * HITS_PER_ZONE; // 15 hits

  // Asset paths (supporting both assets/ and assest/)
  const ASSET_ROOT = 'assets/';
  const STAGE_IMAGES = {
    stage1: 'stage1.png',
    stage2: 'stage2.png',
    stage3: 'stage3.png',
    stage4: 'stage4.png',
    stage5: 'stage5.png'
  };

  const SOUND_PATHS = {
    hit: 'sound/4290-moan.mp3',
    win: 'sound/yamate-kudesai.mp3',
    lose: 'sound/gawkgawkgawkgawk.mp3' // with fallback to sound/gawk-gawk.mp3
  };

  // Comic hit popup words
  const COMIC_WORDS = ['WHACK!', 'POW!', 'BAM!', 'CRACK!', 'SMACK!'];

  // --- GAME STATE ---
  const state = {
    currentScreen: 'INTRO', // 'INTRO' | 'GAME' | 'WIN' | 'LOSE'
    totalHits: 0,
    zones: {
      head: { name: 'HEAD', hits: 0, max: HITS_PER_ZONE, completed: false },
      leftEye: { name: 'LEFT EYE', hits: 0, max: HITS_PER_ZONE, completed: false },
      rightEye: { name: 'RIGHT EYE', hits: 0, max: HITS_PER_ZONE, completed: false },
      nose: { name: 'NOSE', hits: 0, max: HITS_PER_ZONE, completed: false },
      mouthChin: { name: 'MOUTH & CHIN', hits: 0, max: HITS_PER_ZONE, completed: false }
    },
    timerRemaining: GAME_DURATION,
    timerInterval: null,
    gameStartTime: 0,
    gameEndTime: 0,
    lastPunchTime: 0,
    isDebug: DEBUG_HITBOXES,
    difficulty: {
      mode: 'NORMAL',
      duration: GAME_DURATION,
      moveDuration: '2.8s',
      punchCooldown: 90,
      isNarrow: false
    }
  };

  // --- DOM REFERENCES ---
  const dom = {
    container: document.getElementById('game-container'),
    screenIntro: document.getElementById('screen-intro'),
    screenGame: document.getElementById('screen-game'),
    screenWin: document.getElementById('screen-win'),
    screenLose: document.getElementById('screen-lose'),
    btnStart: document.getElementById('btn-start'),
    btnPlayAgain: document.getElementById('btn-play-again'),
    btnTryAgain: document.getElementById('btn-try-again'),
    timerDisplay: document.getElementById('timer-display'),
    timerBox: document.querySelector('.timer-box'),
    diffBadge: document.getElementById('difficulty-badge'),
    hitsDisplay: document.getElementById('hits-display'),
    hitsProgress: document.getElementById('hits-progress'),
    characterMover: document.getElementById('character-mover'),
    characterStage: document.getElementById('character-stage'),
    characterImg: document.getElementById('character-img'),
    impactFlash: document.getElementById('impact-flash'),
    fxLayer: document.getElementById('fx-layer'),
    hitboxesLayer: document.getElementById('hitboxes-layer'),
    hitboxes: {
      head: document.getElementById('hitbox-head'),
      leftEye: document.getElementById('hitbox-leftEye'),
      rightEye: document.getElementById('hitbox-rightEye'),
      nose: document.getElementById('hitbox-nose'),
      mouthChin: document.getElementById('hitbox-mouthChin')
    },
    badges: {
      head: document.getElementById('badge-head'),
      leftEye: document.getElementById('badge-leftEye'),
      rightEye: document.getElementById('badge-rightEye'),
      nose: document.getElementById('badge-nose'),
      mouthChin: document.getElementById('badge-mouthChin')
    },
    winTimeDisplay: document.getElementById('win-time-display'),
    winRankDisplay: document.getElementById('win-rank-display'),
    loseHitsDisplay: document.getElementById('lose-hits-display')
  };

  // --- AUDIO SYSTEM (ROBUST & ZERO-LATENCY POOL) ---
  class SoundManager {
    constructor() {
      this.poolSize = 8;
      this.hitAudioPool = [];
      this.poolIndex = 0;
      this.audioContext = null;
      this.winAudio = null;
      this.loseAudio = null;
      this.init();
    }

    init() {
      // Create audio pool for rapid hit sounds
      for (let i = 0; i < this.poolSize; i++) {
        const audio = new Audio(SOUND_PATHS.hit);
        audio.preload = 'auto';
        this.hitAudioPool.push(audio);
      }

      this.winAudio = new Audio(SOUND_PATHS.win);
      this.winAudio.preload = 'auto';

      this.loseAudio = new Audio(SOUND_PATHS.lose);
      this.loseAudio.preload = 'auto';
      // Handle fallback path for lose audio
      this.loseAudio.addEventListener('error', () => {
        this.loseAudio.src = 'sound/gawk-gawk.mp3';
      }, { once: true });
    }

    unlock() {
      try {
        if (!this.audioContext) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            this.audioContext = new AudioContextClass();
          }
        }
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
      } catch (e) {
        // Safe fallback
      }
    }

    playHit() {
      try {
        const audio = this.hitAudioPool[this.poolIndex];
        this.poolIndex = (this.poolIndex + 1) % this.poolSize;
        audio.currentTime = 0;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            // If local file playback is blocked, synthesize punch thud
            this.synthHitSound();
          });
        }
      } catch (e) {
        this.synthHitSound();
      }
    }

    playWin() {
      try {
        if (this.winAudio) {
          this.winAudio.currentTime = 0;
          this.winAudio.play().catch(() => this.synthWinFanfare());
        } else {
          this.synthWinFanfare();
        }
      } catch (e) {
        this.synthWinFanfare();
      }
    }

    playLose() {
      try {
        if (this.loseAudio) {
          this.loseAudio.currentTime = 0;
          this.loseAudio.play().catch(() => this.synthLoseSound());
        } else {
          this.synthLoseSound();
        }
      } catch (e) {
        this.synthLoseSound();
      }
    }

    stopAll() {
      this.hitAudioPool.forEach(a => {
        try { a.pause(); a.currentTime = 0; } catch (e) {}
      });
      if (this.winAudio) {
        try { this.winAudio.pause(); this.winAudio.currentTime = 0; } catch (e) {}
      }
      if (this.loseAudio) {
        try { this.loseAudio.pause(); this.loseAudio.currentTime = 0; } catch (e) {}
      }
    }

    // Web Audio Fallbacks (ensures game NEVER is silent even if files fail)
    synthHitSound() {
      if (!this.audioContext) return;
      try {
        const ctx = this.audioContext;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.13);
      } catch (e) {}
    }

    synthWinFanfare() {
      if (!this.audioContext) return;
      try {
        const ctx = this.audioContext;
        [261.6, 329.6, 392.0, 523.2].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.1);
          osc.stop(ctx.currentTime + i * 0.1 + 0.45);
        });
      } catch (e) {}
    }

    synthLoseSound() {
      if (!this.audioContext) return;
      try {
        const ctx = this.audioContext;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.6);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.65);
      } catch (e) {}
    }
  }

  const sound = new SoundManager();

  // --- DIFFICULTY TUNER (MOBILE / SPLIT-SCREEN ADAPTIVE DIFFICULTY) ---
  function getDifficultyConfig() {
    const width = (dom.container && dom.container.clientWidth) ? dom.container.clientWidth : window.innerWidth;
    if (width <= 500) {
      return {
        mode: 'ULTRA TURBO',
        duration: 8,
        moveDuration: '0.85s',
        punchCooldown: 140,
        isNarrow: true
      };
    } else if (width <= 768) {
      return {
        mode: 'TURBO',
        duration: 10,
        moveDuration: '1.1s',
        punchCooldown: 120,
        isNarrow: true
      };
    } else {
      return {
        mode: 'NORMAL',
        duration: GAME_DURATION,
        moveDuration: '2.8s',
        punchCooldown: 90,
        isNarrow: false
      };
    }
  }

  function applyDifficulty(isGameActive = false) {
    const config = getDifficultyConfig();
    state.difficulty = config;

    if (!isGameActive) {
      state.timerRemaining = config.duration;
    }

    if (dom.characterMover) {
      dom.characterMover.style.setProperty('--dodge-duration', config.moveDuration);
      dom.characterMover.style.animationDuration = config.moveDuration;
    }

    const badge = dom.diffBadge || document.getElementById('difficulty-badge');
    if (badge) {
      if (config.isNarrow) {
        const tagSlug = config.mode.toLowerCase().replace(/\s+/g, '-');
        badge.textContent = `⚡ ${config.mode}`;
        badge.className = `difficulty-tag ${tagSlug}-tag active`;
      } else {
        badge.textContent = '';
        badge.className = 'difficulty-tag';
      }
    }

    updateTimerUI();
  }

  // --- INITIALIZATION ---
  function initGame() {
    setupEventListeners();
    updateDebugMode();
    applyDifficulty(false);
    showScreen('INTRO');
  }

  // --- SCREEN SWITCHING ---
  function showScreen(screenName) {
    state.currentScreen = screenName;
    dom.screenIntro.classList.remove('active');
    dom.screenGame.classList.remove('active');
    dom.screenWin.classList.remove('active');
    dom.screenLose.classList.remove('active');

    if (screenName === 'INTRO') {
      dom.screenIntro.classList.add('active');
    } else if (screenName === 'GAME') {
      dom.screenGame.classList.add('active');
    } else if (screenName === 'WIN') {
      dom.screenGame.classList.add('active'); // Keep game in background of modal
      dom.screenWin.classList.add('active');
    } else if (screenName === 'LOSE') {
      dom.screenGame.classList.add('active');
      dom.screenLose.classList.add('active');
    }
  }

  // --- GAME START & RESET ---
  function startGame() {
    sound.unlock();
    sound.stopAll();

    // Re-evaluate difficulty based on current viewport / split-screen width
    const diffConfig = getDifficultyConfig();
    state.difficulty = diffConfig;

    // Reset state values
    state.totalHits = 0;
    state.lastPunchTime = 0;
    state.timerRemaining = diffConfig.duration;
    state.gameStartTime = performance.now();
    state.gameEndTime = 0;

    for (const key in state.zones) {
      state.zones[key].hits = 0;
      state.zones[key].completed = false;
    }

    // Apply animation speed to mover
    if (dom.characterMover) {
      dom.characterMover.style.setProperty('--dodge-duration', diffConfig.moveDuration);
      dom.characterMover.style.animationDuration = diffConfig.moveDuration;
      dom.characterMover.style.animationPlayState = 'running';
    }

    const badge = dom.diffBadge || document.getElementById('difficulty-badge');
    if (badge) {
      if (diffConfig.isNarrow) {
        const tagSlug = diffConfig.mode.toLowerCase().replace(/\s+/g, '-');
        badge.textContent = `⚡ ${diffConfig.mode}`;
        badge.className = `difficulty-tag ${tagSlug}-tag active`;
      } else {
        badge.textContent = '';
        badge.className = 'difficulty-tag';
      }
    }

    // Reset UI
    updateScoreUI();
    updateCharacterStage();
    updateTimerUI();
    enableHitboxes(true);

    dom.timerBox.classList.remove('warning');
    dom.fxLayer.innerHTML = '';

    showScreen('GAME');
    startTimer();
  }

  function resetGame() {
    stopTimer();
    sound.stopAll();
    startGame();
  }

  // --- TIMER ENGINE ---
  function startTimer() {
    stopTimer();
    state.timerInterval = setInterval(() => {
      state.timerRemaining--;
      updateTimerUI();

      if (state.timerRemaining <= 0) {
        state.timerRemaining = 0;
        stopTimer();
        handleTimeUp();
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  function updateTimerUI() {
    dom.timerDisplay.textContent = state.timerRemaining;
    const warnThreshold = (state.difficulty && state.difficulty.isNarrow) ? 4 : 5;
    if (state.timerRemaining <= warnThreshold) {
      dom.timerBox.classList.add('warning');
    } else {
      dom.timerBox.classList.remove('warning');
    }
  }

  function handleTimeUp() {
    if (state.totalHits >= TARGET_TOTAL_HITS) {
      handleWin();
    } else {
      handleLose();
    }
  }

  // --- HIT DETECTION & LOGIC ---
  function handleFaceHit(zoneKey, event) {
    if (state.currentScreen !== 'GAME') return;
    if (state.timerRemaining <= 0) return;

    // Rate limiter / anti-spam cooldown: requires deliberate timed strikes
    const now = performance.now();
    const cooldown = (state.difficulty && state.difficulty.punchCooldown) ? state.difficulty.punchCooldown : 100;
    if (now - state.lastPunchTime < cooldown) return;
    state.lastPunchTime = now;

    const zone = state.zones[zoneKey];
    if (!zone || zone.completed) return;

    // Increment hits
    zone.hits++;
    state.totalHits++;

    if (zone.hits >= zone.max) {
      zone.hits = zone.max;
      zone.completed = true;
    }

    // Audio feedback
    sound.playHit();

    // Visual feedback
    triggerPunchAnimation(zoneKey, event);
    updateScoreUI();
    updateCharacterStage();

    // Check Win Condition
    if (state.totalHits >= TARGET_TOTAL_HITS) {
      handleWin();
    }
  }

  // --- VISUAL IMPACT & COMIC EFFECTS ---
  function triggerPunchAnimation(zoneKey, event) {
    // 1. Recoil character
    const stage = dom.characterStage;
    stage.classList.remove('punched');
    void stage.offsetWidth; // Trigger reflow

    // Calculate directional bounce & flinch from hit position
    // If narrow/split-screen, add dynamic evasive slip to challenge tap spamming
    const isNarrow = state.difficulty && state.difficulty.isNarrow;
    const offsetMagnitude = isNarrow ? 48 : 20;
    const rotMagnitude = isNarrow ? 12 : 6;
    const randOffset = (Math.random() - 0.5) * offsetMagnitude;
    const randRot = (Math.random() - 0.5) * rotMagnitude;
    stage.style.setProperty('--punch-offset-x', `${randOffset}px`);
    stage.style.setProperty('--punch-rot', `${randRot}deg`);
    stage.classList.add('punched');

    // 2. Micro screen flash
    dom.impactFlash.classList.add('flash');
    setTimeout(() => {
      dom.impactFlash.classList.remove('flash');
    }, 60);

    // 3. Comic burst text ("POW!", "WHACK!", "BAM!")
    createComicEffect(zoneKey, event);
  }

  function createComicEffect(zoneKey, event) {
    const stageRect = dom.characterStage.getBoundingClientRect();
    let clickX = stageRect.width / 2;
    let clickY = stageRect.height / 2;

    if (event && event.clientX) {
      clickX = event.clientX - stageRect.left;
      clickY = event.clientY - stageRect.top;
    } else {
      // Fallback to hitbox center
      const hitboxEl = dom.hitboxes[zoneKey];
      if (hitboxEl) {
        clickX = hitboxEl.offsetLeft + hitboxEl.offsetWidth / 2;
        clickY = hitboxEl.offsetTop + hitboxEl.offsetHeight / 2;
      }
    }

    // Spawn comic word
    const comicEl = document.createElement('div');
    const randomWord = COMIC_WORDS[Math.floor(Math.random() * COMIC_WORDS.length)];
    comicEl.className = `comic-burst ${randomWord.slice(0, -1).toLowerCase()}`;
    comicEl.textContent = randomWord;
    comicEl.style.left = `${clickX}px`;
    comicEl.style.top = `${clickY}px`;

    dom.fxLayer.appendChild(comicEl);

    // Spawn 5 sparks
    for (let i = 0; i < 5; i++) {
      const spark = document.createElement('div');
      spark.className = 'spark';
      spark.style.left = `${clickX}px`;
      spark.style.top = `${clickY}px`;
      const angle = (Math.PI * 2 / 5) * i + (Math.random() * 0.5);
      const distance = 30 + Math.random() * 40;
      spark.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
      spark.style.setProperty('--ty', `${Math.sin(angle) * distance}px`);
      dom.fxLayer.appendChild(spark);
      setTimeout(() => spark.remove(), 320);
    }

    setTimeout(() => {
      comicEl.remove();
    }, 400);
  }

  // --- SCORE & HUD UPDATE ---
  function updateScoreUI() {
    dom.hitsDisplay.innerHTML = `${state.totalHits}<span class="hud-sub">/15</span>`;
    const progressPercent = Math.min(100, (state.totalHits / TARGET_TOTAL_HITS) * 100);
    dom.hitsProgress.style.width = `${progressPercent}%`;

    // Update zone badges and hitboxes
    for (const key in state.zones) {
      const zone = state.zones[key];
      const badgeCount = dom.badges[key];
      const hitbox = dom.hitboxes[key];
      const badgeWrap = badgeCount ? badgeCount.closest('.zone-badge') : null;

      if (badgeCount) {
        badgeCount.textContent = `${zone.hits}/${zone.max}`;
      }

      if (zone.completed) {
        if (badgeWrap) badgeWrap.classList.add('completed');
        if (hitbox) hitbox.classList.add('completed');
      } else {
        if (badgeWrap) badgeWrap.classList.remove('completed');
        if (hitbox) hitbox.classList.remove('completed');
      }

      // Update sub-pips
      if (badgeWrap && badgeWrap.querySelectorAll) {
        const pips = badgeWrap.querySelectorAll('.pip');
        if (pips && pips.forEach) {
          pips.forEach((pip, idx) => {
            if (idx < zone.hits) {
              pip.classList.add('active');
            } else {
              pip.classList.remove('active');
            }
          });
        }
      }

      // Update debug label
      if (hitbox) {
        const debugLabel = hitbox.querySelector('.debug-label');
        if (debugLabel) {
          debugLabel.textContent = `${zone.name} ${zone.hits}/${zone.max}`;
        }
      }
    }
  }

  // --- CHARACTER DAMAGE STAGE PROGRESSION ---
  function updateCharacterStage() {
    let stageFile = STAGE_IMAGES.stage1;

    // Damage progression mapping:
    // 0-2 hits: stage1
    // 3-5 hits: stage2
    // 6-8 hits: stage3
    // 9-11 hits: stage4
    // 12-15 hits: stage5
    if (state.totalHits >= 12) {
      stageFile = STAGE_IMAGES.stage5;
    } else if (state.totalHits >= 9) {
      stageFile = STAGE_IMAGES.stage4;
    } else if (state.totalHits >= 6) {
      stageFile = STAGE_IMAGES.stage3;
    } else if (state.totalHits >= 3) {
      stageFile = STAGE_IMAGES.stage2;
    } else {
      stageFile = STAGE_IMAGES.stage1;
    }

    const newSrc = ASSET_ROOT + stageFile;
    if (dom.characterImg.getAttribute('src') !== newSrc) {
      dom.characterImg.src = newSrc;
    }
  }

  function enableHitboxes(enabled) {
    for (const key in dom.hitboxes) {
      dom.hitboxes[key].style.pointerEvents = enabled ? 'auto' : 'none';
    }
  }

  // --- WIN CONDITION ---
  function handleWin() {
    stopTimer();
    enableHitboxes(false);
    state.gameEndTime = performance.now();

    if (dom.characterMover) {
      dom.characterMover.style.animationPlayState = 'paused';
    }

    // Force stage5
    dom.characterImg.src = ASSET_ROOT + STAGE_IMAGES.stage5;

    // Play Victory Sound
    sound.playWin();

    // Calculate elapsed time in seconds with 2 decimal places
    const elapsedSeconds = ((state.gameEndTime - state.gameStartTime) / 1000).toFixed(2);
    dom.winTimeDisplay.textContent = `${elapsedSeconds}s`;

    // Rating adapted to difficulty mode
    let rank = 'GOOD FIGHTER';
    const elapsed = parseFloat(elapsedSeconds);
    if (state.difficulty && state.difficulty.isNarrow) {
      if (elapsed < 4.5) {
        rank = '⚡ ULTRA GODLIKE';
      } else if (elapsed < 6.5) {
        rank = '⚡ LIGHTNING REFLEX';
      } else if (elapsed < 8.0) {
        rank = '⚡ TURBO CHAMPION';
      } else {
        rank = '⚡ SURVIVOR';
      }
    } else {
      if (elapsed < 10) {
        rank = 'GODLIKE / PERFECT';
      } else if (elapsed < 18) {
        rank = 'LIGHTNING FAST';
      } else if (elapsed < 25) {
        rank = 'PRO BOXER';
      }
    }
    dom.winRankDisplay.textContent = rank;

    // Show WIN modal after tiny pause for final hit reaction
    setTimeout(() => {
      showScreen('WIN');
    }, 300);
  }

  // --- LOSE CONDITION ---
  function handleLose() {
    stopTimer();
    enableHitboxes(false);

    if (dom.characterMover) {
      dom.characterMover.style.animationPlayState = 'paused';
    }

    // Play Defeat Sound
    sound.playLose();

    dom.loseHitsDisplay.textContent = `${state.totalHits} / 15`;

    setTimeout(() => {
      showScreen('LOSE');
    }, 200);
  }

  // --- DEBUG MODE TOGGLE ---
  function updateDebugMode() {
    if (state.isDebug) {
      document.body.classList.add('debug-hitboxes');
    } else {
      document.body.classList.remove('debug-hitboxes');
    }
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    let lastTouchTimestamp = 0;

    // Fast mobile tap helper
    function attachFastTap(element, handler) {
      if (!element) return;
      element.addEventListener('touchstart', (e) => {
        lastTouchTimestamp = performance.now();
        e.stopPropagation();
        e.preventDefault();
        sound.unlock();
        handler(e);
      }, { passive: false });

      element.addEventListener('click', (e) => {
        if (performance.now() - lastTouchTimestamp < 450) return; // Prevent ghost click
        e.stopPropagation();
        sound.unlock();
        handler(e);
      });
    }

    // Start button on Intro screen
    attachFastTap(dom.btnStart, () => startGame());

    // Play again / Try again buttons
    attachFastTap(dom.btnPlayAgain, () => resetGame());
    attachFastTap(dom.btnTryAgain, () => resetGame());

    // 5 Face Hitbox Handlers
    for (const key in dom.hitboxes) {
      const el = dom.hitboxes[key];
      if (el) {
        el.addEventListener('touchstart', (e) => {
          lastTouchTimestamp = performance.now();
          e.stopPropagation();
          e.preventDefault();
          const touch = e.touches[0];
          handleFaceHit(key, touch);
        }, { passive: false });

        el.addEventListener('click', (e) => {
          if (performance.now() - lastTouchTimestamp < 450) return;
          e.stopPropagation();
          handleFaceHit(key, e);
        });
      }
    }

    // First touch anywhere unlocks audio on mobile
    window.addEventListener('touchstart', () => sound.unlock(), { once: true, passive: true });
    window.addEventListener('pointerdown', () => sound.unlock(), { once: true, passive: true });

    // Keyboard controls:
    // 'D' toggles debug hitboxes
    // 'R' restarts game
    // 'Space' / 'Enter' starts or replays
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        state.isDebug = !state.isDebug;
        updateDebugMode();
      } else if (e.key === 'r' || e.key === 'R') {
        if (state.currentScreen === 'GAME' || state.currentScreen === 'WIN' || state.currentScreen === 'LOSE') {
          resetGame();
        }
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (state.currentScreen === 'INTRO') {
          startGame();
        } else if (state.currentScreen === 'WIN' || state.currentScreen === 'LOSE') {
          resetGame();
        }
      }
    });

    // Prevent image drag
    dom.characterImg.addEventListener('dragstart', (e) => e.preventDefault());

    // Dynamically adjust difficulty on viewport resize / split-screen change
    window.addEventListener('resize', () => {
      applyDifficulty(state.currentScreen === 'GAME');
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
  } else {
    initGame();
  }

})();
