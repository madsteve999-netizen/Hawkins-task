const DB_KEY = 'STRANGER_THINGS_GOLD_DB';
const LEGACY_KEYS = ['stas_tasks_final', 'stas_tasks_final_elite', 'stas_tasks_elite'];

// ========== SUPABASE SETUP ==========
let supabaseClient = null;
let currentUser = null;
let realtimeChannel = null;
let notesRealtimeChannel = null;
let pendingEmail = '';

// Initialize Supabase after page loads
function initSupabase() {
    try {
        if (window.supabase) {
            const supabaseUrl = 'https://jiovbimhoitawrtkqxmp.supabase.co';
            const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppb3ZiaW1ob2l0YXdydGtxeG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMDc4NzMsImV4cCI6MjA4MzU4Mzg3M30.5-sBNX4Z5HcmMClmaySgoDDT2IDw3swcyYLZo3GnMCM';
            supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
            console.log('Supabase initialized successfully');
        } else {
            console.warn('Supabase library not loaded');
        }
    } catch (error) {
        console.error('Supabase init error:', error);
    }
}

// ========== AUDIO LAZY LOADING ==========
const AUDIO_URLS = {
    vecna: 'https://www.myinstants.com/media/sounds/stranger-things-vecna-grandfather-clock.mp3',
    gong: 'undertakers-bell-1.mp3'
};

let audioLoaded = false;
let audioLoadAttempted = false;

function loadAudioFiles() {
    if (audioLoadAttempted) return;
    audioLoadAttempted = true;

    console.log('Loading audio files...');

    // Load Vecna SFX
    const vecnaAudio = document.getElementById('vecna-sfx');
    vecnaAudio.src = AUDIO_URLS.vecna;
    vecnaAudio.addEventListener('error', () => {
        console.warn('Failed to load Vecna audio (firewall block?)');
    });
    vecnaAudio.addEventListener('canplaythrough', () => {
        console.log('Vecna audio loaded successfully');
    }, { once: true });

    // Load Gong SFX
    const gongAudio = document.getElementById('gong-sfx');
    gongAudio.src = AUDIO_URLS.gong;
    gongAudio.addEventListener('error', () => {
        console.warn('Failed to load Gong audio (firewall block?)');
    });
    gongAudio.addEventListener('canplaythrough', () => {
        console.log('Gong audio loaded successfully');
    }, { once: true });

    audioLoaded = true;
}

// ========== CONNECTION MODAL HANDLERS ==========
let connectionTimeout = null;
let isOfflineMode = false;

function showConnectionModal() {
    document.getElementById('connection-modal').classList.add('open');
}

function hideConnectionModal() {
    document.getElementById('connection-modal').classList.remove('open');
}

function goOfflineMode() {
    console.log('User chose offline mode');
    isOfflineMode = true;
    hideConnectionModal();
    showToast('АВТОНОМНЫЙ РЕЖИМ АКТИВИРОВАН');

    // Clear any pending connection attempts
    if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
    }
}

async function retryConnection() {
    console.log('Retrying connection...');
    hideConnectionModal();
    showToast('ПОВТОРНАЯ ПОПЫТКА ПОДКЛЮЧЕНИЯ...');

    // Try to initialize auth again
    await initializeApp();
}

// ========== APP INITIALIZATION ==========
async function initializeApp() {
    try {
        console.log('Initializing app...');

        // Initialize Supabase
        initSupabase();

        // Load tasks and render UI
        render();

        // Try to check auth state with timeout
        if (supabaseClient && !isOfflineMode) {
            const authPromise = supabaseClient.auth.getSession();

            // Set timeout for connection (3 seconds)
            connectionTimeout = setTimeout(() => {
                console.warn('Connection timeout - showing modal');
                showConnectionModal();
            }, 3000);

            try {
                const { data, error } = await authPromise;

                // Clear timeout if successful
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                    connectionTimeout = null;
                }

                if (error) throw error;

                if (data.session) {
                    currentUser = data.session.user;
                    await handleLogin();
                } else {
                    updateAuthUI();
                }
            } catch (error) {
                console.error('Auth check error:', error);

                // Clear timeout
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                    connectionTimeout = null;
                }

                // Show connection modal
                showConnectionModal();
            }
        } else {
            // No Supabase or offline mode - just update UI
            updateAuthUI();
        }

        // Load audio files AFTER initialization (lazy load)
        setTimeout(() => {
            loadAudioFiles();
        }, 500);

    } catch (error) {
        console.error('App initialization error:', error);
        render(); // Still render the app even if there's an error
    }
}

let currentEditId = null;
let selectedColor = 'red';
let newSelectedColor = 'red';
let currentFontSize = 1.1;
let currentFontFamily = "'Courier New', Courier, monospace";
let taskToDeleteId = null; // Глобальная переменная для удаления
let prependMode = false; // Режим добавления в начало списка
let openMenuId = null; // Отслеживание открытого меню задачи

function loadTasks() {
    let data = [];
    try {
        const savedFontSize = localStorage.getItem('stas_font_size');
        if (savedFontSize) {
            currentFontSize = parseFloat(savedFontSize);
            document.documentElement.style.setProperty('--task-font-size', currentFontSize + 'rem');
        }
        const savedFontFamily = localStorage.getItem('stas_font_family');
        if (savedFontFamily) {
            currentFontFamily = savedFontFamily;
            document.documentElement.style.setProperty('--task-font-family', currentFontFamily);
        }
        const saved = localStorage.getItem(DB_KEY);
        if (saved) {
            data = JSON.parse(saved);
        } else {
            for (let key of LEGACY_KEYS) {
                const legacyData = localStorage.getItem(key);
                if (legacyData) {
                    try {
                        const parsed = JSON.parse(legacyData);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            data = parsed; break;
                        }
                    } catch (e) { }
                }
            }
            if (data.length > 0) localStorage.setItem(DB_KEY, JSON.stringify(data));
        }
    } catch (e) { }
    return data || [];
}

let tasks = loadTasks();

const songs = [
    "https://hawkins-task.vercel.app/LOrchestra_Cinematique_Michael_Stein_Kyle_Dixon_-_Stranger_Things_Main_Theme_53151697.mp3",
    "https://hawkins-task.vercel.app/Michael_Stein_Kyle_Dixon_-_Kids_50273473.mp3",
    "https://hawkins-task.vercel.app/Kate_Bush_-_Running_Up_That_Hill_A_Deal_With_God_48002274.mp3",
    "https://hawkins-task.vercel.app/Journey_-_Separate_Ways_Worlds_Apart_48054280.mp3",
    "https://hawkins-task.vercel.app/Scorpions_-_Rock_You_Like_a_Hurricane_47954772.mp3",
    "https://hawkins-task.vercel.app/Bon_Jovi_-_Runaway_47852333.mp3",
    "https://hawkins-task.vercel.app/The_Clash_-_Should_I_Stay_or_Should_I_Go_47992439.mp3",
    "https://hawkins-task.vercel.app/The_Police_-_Every_Breath_You_Take_47835969.mp3",
    "https://hawkins-task.vercel.app/Foreigner_-_Cold_As_Ice_47969496.mp3",
    "https://hawkins-task.vercel.app/Cutting_Crew_-_Died_In_Your_Arms_48076414.mp3"
];
let curCh = 0;

// const sfxClick = new Audio("2571-preview.mp3"); // Отключено: файл не нужен
const sfxDel = new Audio("2857-preview.mp3");

function playSfx(type) {
    if (type === 'click') return; // Звук клика отключен
    const s = type === 'click' ? sfxClick : sfxDel;
    s.currentTime = 0; s.volume = 0.4;
    s.play().catch(() => { });
}

function triggerHeaderGlitch() {
    const h = document.getElementById('main-header');
    if (h.classList.contains('glitch-active')) return;
    h.classList.add('glitch-active');
    if (Math.random() > 0.5) triggerLightning();
    setTimeout(() => { h.classList.remove('glitch-active'); }, 600);
}

let invokeInterval = null;
function startInvocation(e) {
    if (e && e.type === 'touchstart') { }
    document.body.classList.add('invoking');
    triggerLightning();
    invokeInterval = setInterval(() => {
        if (Math.random() > 0.6) triggerLightning();
    }, 800);
}
function stopInvocation() {
    document.body.classList.remove('invoking');
    clearInterval(invokeInterval);
}

let wakeLock = null;
const iconScreenOff = '<rect x="5" y="2" width="14" height="20" rx="2" ry="2" stroke="currentColor" fill="none" stroke-width="2"/><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="2"/>';
const iconScreenOn = '<rect x="5" y="2" width="14" height="20" rx="2" ry="2" stroke="currentColor" fill="none" stroke-width="2"/><path d="M12 10v4" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="18" r="1" fill="currentColor"/>';

async function toggleWakeLock() {
    const btn = document.getElementById('wakelock-toggle');
    const iconSvg = document.getElementById('icon-screen');
    if (!wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            btn.classList.add('active');
            iconSvg.innerHTML = iconScreenOn;
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
                btn.classList.remove('active');
                iconSvg.innerHTML = iconScreenOff;
            });
        } catch (err) {
            console.error(err);
            showToast("БРАУЗЕР БЛОКИРУЕТ ЭКРАН");
        }
    } else {
        wakeLock.release();
        wakeLock = null;
    }
}
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        // Re-acquire WakeLock if it was active
        if (wakeLock !== null) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
            } catch (e) { }
        }

        // Force sync when tab becomes visible (prevent stale data)
        if (currentUser) {
            console.log('Tab visible - forcing sync...');

            // Sync tasks and notes from cloud
            await syncTasksOnLogin();
            await syncNotesOnLogin();

            // Check Realtime connection status and reconnect if needed
            if (realtimeChannel) {
                const channelState = realtimeChannel.state;
                console.log('Realtime channel state:', channelState);

                if (channelState !== 'joined') {
                    console.log('Realtime not subscribed, reconnecting...');
                    subscribeToTasks();
                }
            } else {
                // No channel exists, subscribe
                console.log('No Realtime channel, subscribing...');
                subscribeToTasks();
            }
        }
    }
});

// Backup: also listen to window focus event
window.addEventListener('focus', async () => {
    if (currentUser) {
        console.log('Window focused - forcing sync...');

        // Sync tasks and notes from cloud
        await syncTasksOnLogin();
        await syncNotesOnLogin();

        // Check Realtime connection status and reconnect if needed
        if (realtimeChannel) {
            const channelState = realtimeChannel.state;
            console.log('Realtime channel state:', channelState);

            if (channelState !== 'joined') {
                console.log('Realtime not subscribed, reconnecting...');
                subscribeToTasks();
            }
        } else {
            // No channel exists, subscribe
            console.log('No Realtime channel, subscribing...');
            subscribeToTasks();
        }
    }
});

// TOAST FUNCTION
function showToast(msg) {
    let t = document.getElementById('toast-box');
    if (!t) {
        t = document.createElement('div');
        t.id = 'toast-box';
        t.className = 'toast';
        document.body.appendChild(t);
    }
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function initSelects() {
    const createOptions = (target, min, max, def) => {
        const sel = document.getElementById(target);
        sel.innerHTML = '';
        for (let i = min; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.innerText = i;
            if (i === def) opt.selected = true;
            sel.appendChild(opt);
        }
    };
    createOptions('work-time', 1, 60, 25);
    createOptions('break-time', 1, 30, 5);
    createOptions('long-break-time', 1, 60, 15);
    createOptions('cycles-target', 1, 10, 4);
}

function toggleTimerSettings() {
    const settingsPanel = document.getElementById('timer-settings-panel');
    const toggleBtn = document.getElementById('timer-settings-toggle');
    if (settingsPanel.classList.contains('visible')) {
        settingsPanel.classList.remove('visible');
        toggleBtn.classList.remove('active');
    } else {
        settingsPanel.classList.add('visible');
        toggleBtn.classList.add('active');
    }
}

let timerInterval = null;
let timeLeft = 0;
let isWorkSession = true;
let vecnaEnabled = true;
let currentCycle = 1;
let timerHistory = null;
let timerEndTime = 0;

// STOPWATCH MODE VARIABLES
let mode = 'timer'; // 'timer' or 'stopwatch'
let stopwatchTime = 0; // seconds
let stopwatchInterval = null;
let stopwatchStartTime = null; // for Date.now() accuracy

function saveTimerState() {
    timerHistory = {
        timeLeft: timeLeft,
        isWorkSession: isWorkSession,
        currentCycle: currentCycle
    };
}

function restoreTimerState() {
    if (!timerHistory) { showToast("НЕТ ДАННЫХ ОТМЕНЫ"); return; }
    if (confirm("ВЕРНУТЬСЯ НА ШАГ НАЗАД?")) {
        stopTicking();
        timeLeft = timerHistory.timeLeft;
        isWorkSession = timerHistory.isWorkSession;
        currentCycle = timerHistory.currentCycle;
        updateDisplay();
        updateCycleStatus();
    }
}

function forceNextStep() {
    handleTimerComplete();
}

function toggleVecna() {
    vecnaEnabled = !vecnaEnabled;
    const btn = document.getElementById('vecna-toggle');
    if (vecnaEnabled) btn.classList.add('active');
    else btn.classList.remove('active');
}

function updateDisplay() {
    const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const s = (timeLeft % 60).toString().padStart(2, '0');
    const timeStr = `${m}:${s}`;
    document.getElementById('timer').innerText = timeStr;

    // 1. Обновление заголовка вкладки
    document.title = `${timeStr} - ОЧЕНЬ СТРАННЫЕ ДЕЛА`;

    // 2. Обновление Media Session (Для шторки/экрана блокировки)
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: timeStr,
            artist: isWorkSession ? "ФОКУСИРОВКА" : "ОТДЫХ",
            album: "HAWKINS LAB",
            artwork: [{ src: 'https://cdn-icons-png.flaticon.com/512/3565/3565099.png', sizes: '512x512', type: 'image/png' }]
        });
        navigator.mediaSession.playbackState = 'playing';
    }
}

function updateCycleStatus() {
    const target = parseInt(document.getElementById('cycles-target').value) || 4;
    const modeText = isWorkSession ? "РАБОТА" : "ОТДЫХ";
    document.getElementById('cycle-status').innerText = `${modeText} • ЦИКЛ ${currentCycle} / ${target}`;
}

function startTimer() {
    if (timerInterval) return;
    timerEndTime = Date.now() + timeLeft * 1000;

    // ACTIVATE THE VOID MODE
    document.body.classList.add('void-mode');

    timerInterval = setInterval(() => {
        const now = Date.now();
        const diff = Math.ceil((timerEndTime - now) / 1000);

        if (diff >= 0) {
            timeLeft = diff;

            // Force background audio if needed
            const mainAudio = document.getElementById('audio');
            const silence = document.getElementById('silence-loop');
            if (mainAudio.paused && silence.paused) {
                silence.play().catch(() => { });
            }

            if (isWorkSession && timeLeft === 25 && vecnaEnabled) {
                const vecna = document.getElementById('vecna-sfx');
                vecna.currentTime = 0;
                vecna.volume = 0.8;
                vecna.play().catch(() => { });
            }
            updateDisplay();
        }

        if (diff <= 0) {
            timeLeft = 0;
            updateDisplay();
            handleTimerComplete();
        }
    }, 500);
}

function stopTicking() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    const btn = document.getElementById('t-start-btn');
    btn.innerText = "СТАРТ";
    btn.classList.remove('active');

    // DEACTIVATE THE VOID MODE
    document.body.classList.remove('void-mode');

    const vecna = document.getElementById('vecna-sfx');
    vecna.pause(); vecna.currentTime = 0;
}

function fullReset() {
    // MODE CHECK: Handle stopwatch mode separately
    if (mode === 'stopwatch') {
        stopStopwatch();
        stopwatchTime = 0;
        updateStopwatchDisplay();

        const btn = document.getElementById('t-start-btn');
        btn.innerText = "СТАРТ";
        btn.classList.remove('active');
        return;
    }

    // TIMER MODE (existing logic)
    saveTimerState();
    stopTicking();
    isWorkSession = true;
    currentCycle = 1;
    resetTime(); // Uses user settings, not hardcoded 25:00

    // DEACTIVATE THE VOID MODE (already called in stopTicking, but ensure it's off)
    document.body.classList.remove('void-mode');
}

function handleTimerComplete() {
    stopTicking();
    triggerLightning();

    const targetCycles = parseInt(document.getElementById('cycles-target').value) || 4;
    let nextModeMsg = "";

    if (isWorkSession) {
        if (currentCycle >= targetCycles) {
            nextModeMsg = "СДЕЛАТЬ БОЛЬШОЙ ПЕРЕРЫВ";
        } else {
            nextModeMsg = "СДЕЛАТЬ ПЕРЕРЫВ";
        }
        isWorkSession = false;
    } else {
        nextModeMsg = "ПРОДОЛЖИТЬ РАБОТУ";
        isWorkSession = true;
        if (currentCycle >= targetCycles) {
            currentCycle = 1;
        } else {
            currentCycle++;
        }
    }

    resetTime();

    playGong();
    document.getElementById('alarm-message').innerText = nextModeMsg;
    document.getElementById('alarm-modal').classList.add('open');
}

function playGong() {
    const gong = document.getElementById('gong-sfx');
    gong.currentTime = 0;
    gong.play().catch(() => { });
}

function stopGongSound() {
    const gong = document.getElementById('gong-sfx');
    gong.pause();
    gong.currentTime = 0;
}

function endCycleFromModal() {
    stopGongSound();
    document.getElementById('alarm-modal').classList.remove('open');
    fullReset();
}

function continueCycle() {
    stopGongSound();
    document.getElementById('alarm-modal').classList.remove('open');
    toggleTimer();
}

function toggleTimer() {
    const btn = document.getElementById('t-start-btn');

    // MODE CHECK: Handle stopwatch mode separately
    if (mode === 'stopwatch') {
        if (stopwatchInterval) {
            // Stopwatch is running - PAUSE it
            stopStopwatch();
            btn.innerText = "СТАРТ";
            btn.classList.remove('active');
        } else {
            // Stopwatch is paused - START it
            startStopwatch();
            btn.innerText = "ПАУЗА";
            btn.classList.add('active');
        }
        return;
    }

    // TIMER MODE (existing logic)
    if (timerInterval) {
        stopTicking();
    } else {
        btn.innerText = "ПАУЗА";
        btn.classList.add('active');

        const vecna = document.getElementById('vecna-sfx');
        vecna.muted = true;
        vecna.play().then(() => {
            vecna.pause();
            vecna.currentTime = 0;
            vecna.muted = false;
        }).catch(() => { });

        const gong = document.getElementById('gong-sfx');
        gong.muted = true;
        gong.play().then(() => {
            gong.pause();
            gong.currentTime = 0;
            gong.muted = false;
        }).catch(() => { });

        ensureAudioContext(); // Enable background mode
        startTimer();
    }
}

function stopTimer() {
    const silence = document.getElementById('silence-loop');
    silence.pause();
    fullReset();
}

function resetTime() {
    const work = parseInt(document.getElementById('work-time').value) || 25;
    const brk = parseInt(document.getElementById('break-time').value) || 5;
    const longBrk = parseInt(document.getElementById('long-break-time').value) || 15;
    const targetCycles = parseInt(document.getElementById('cycles-target').value) || 4;

    if (isWorkSession) {
        timeLeft = work * 60;
    } else {
        if (currentCycle >= targetCycles) {
            timeLeft = longBrk * 60;
        } else {
            timeLeft = brk * 60;
        }
    }

    updateDisplay();
    updateCycleStatus();
}

function updateSettings() {
    if (!timerInterval) {
        resetTime();
    } else {
        updateCycleStatus();
    }
}

// ========== STOPWATCH MODE FUNCTIONS ==========
function switchMode(newMode) {
    if (mode === newMode) return;

    // Stop current activity
    if (mode === 'timer') {
        stopTicking();
    } else {
        stopStopwatch();
    }

    mode = newMode;

    // Update UI
    const timerSpan = document.getElementById('mode-timer');
    const chronoSpan = document.getElementById('mode-chrono');

    if (mode === 'timer') {
        // Switch to TIMER mode
        timerSpan.classList.add('active');
        chronoSpan.classList.remove('active');
        document.body.classList.remove('chrono-mode');
        updateDisplay();
    } else {
        // Switch to STOPWATCH mode
        chronoSpan.classList.add('active');
        timerSpan.classList.remove('active');
        document.body.classList.add('chrono-mode');
        updateStopwatchDisplay();
    }
}

function startStopwatch() {
    if (stopwatchInterval) return; // Already running

    stopwatchStartTime = Date.now() - (stopwatchTime * 1000);

    stopwatchInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - stopwatchStartTime) / 1000);
        stopwatchTime = elapsed;
        updateStopwatchDisplay();
    }, 100); // Update every 100ms for smooth display
}

function stopStopwatch() {
    if (stopwatchInterval) {
        clearInterval(stopwatchInterval);
        stopwatchInterval = null;
    }
}

function updateStopwatchDisplay() {
    const mins = Math.floor(stopwatchTime / 60);
    const secs = stopwatchTime % 60;
    const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('timer').innerText = display;
}

function selectNewColor(color) {
    newSelectedColor = color;
    document.querySelectorAll('.new-color-opt').forEach(el => el.classList.remove('selected'));
    document.getElementById('new-col-' + color).classList.add('selected');
}

/**
 * Переключает режим добавления задач в начало списка
 */
function togglePrependMode() {
    prependMode = !prependMode;
    const btn = document.getElementById('prepend-toggle');

    if (prependMode) {
        btn.classList.add('active');
        playSfx('click'); // Звуковой эффект при активации
    } else {
        btn.classList.remove('active');
    }
}

function openSettingsModal() {
    document.getElementById('settings-modal').classList.add('open');
    const val = Math.round(currentFontSize * 16);
    document.getElementById('font-size-slider').value = val;
    document.getElementById('font-family-select').value = currentFontFamily;
    updatePreview();
}
function closeSettingsModal() { document.getElementById('settings-modal').classList.remove('open'); }
function updateFontSize(pxVal) {
    const remVal = pxVal / 16;
    currentFontSize = remVal;
    document.documentElement.style.setProperty('--task-font-size', remVal + 'rem');
    localStorage.setItem('stas_font_size', remVal);
    updatePreview();
}
function updateFontFamily(val) {
    currentFontFamily = val;
    document.documentElement.style.setProperty('--task-font-family', val);
    localStorage.setItem('stas_font_family', val);
    updatePreview();
}
function updatePreview() {
    const p = document.getElementById('font-preview');
    p.style.fontSize = currentFontSize + 'rem';
    p.style.fontFamily = currentFontFamily;
}

function openEditModal(id) {
    const t = tasks.find(x => String(x.id) === String(id));
    if (!t) return;
    currentEditId = id;
    document.getElementById('edit-task-input').value = t.txt;
    const col = t.color || 'red';
    selectColor(col);
    document.getElementById('edit-modal').classList.add('open');
}
function closeEditModal() { document.getElementById('edit-modal').classList.remove('open'); currentEditId = null; }
function selectColor(color) {
    selectedColor = color;
    document.querySelectorAll('.color-opt').forEach(el => el.classList.remove('selected'));
    document.getElementById('col-' + color).classList.add('selected');
}
function saveEditTask() {
    if (!currentEditId) return;
    const newTxt = document.getElementById('edit-task-input').value.trim();
    if (newTxt) {
        const t = tasks.find(x => String(x.id) === String(currentEditId));
        if (t) {
            t.txt = newTxt;
            t.color = selectedColor;
            save();
            render();

            // Sync to cloud if logged in
            if (currentUser) {
                updateTaskInCloud(currentEditId, {
                    title: newTxt,
                    color: selectedColor
                });
            }
        }
    }
    closeEditModal();
}

function del(id) {
    const t = tasks.find(x => String(x.id) === String(id));
    if (!t) return;

    if (t.status !== 'completed') {
        // Active or deferred task -> Show Warning
        taskToDeleteId = id;
        document.getElementById('delete-modal').classList.add('open');
    } else {
        // Completed task -> Delete immediately
        executeDelete(id);
    }
}

function confirmDelete() {
    if (taskToDeleteId) {
        executeDelete(taskToDeleteId);
        closeDeleteModal();
    }
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('open');
    taskToDeleteId = null;
}

async function executeDelete(id) {
    // Local delete
    tasks = tasks.filter(x => String(x.id) !== String(id));
    playSfx('del');
    save();
    render();

    // Sync to cloud if logged in
    if (currentUser) {
        console.log('Syncing delete to cloud for task:', id);
        await deleteTaskFromCloud(id);
    }
}

// === RADIO PANEL TOGGLE ===
function toggleRadioPanel() {
    const header = document.querySelector('.radio-header');
    const content = document.querySelector('.radio-content');

    header.classList.toggle('collapsed');
    content.classList.toggle('hidden');
}

// === BURN ARCHIVE MODAL ===
function openBurnModal() {
    // Check if there are any completed tasks
    const completedTasks = tasks.filter(t => t.status === 'completed');
    if (completedTasks.length === 0) {
        // No completed tasks to burn
        return;
    }
    document.getElementById('burn-modal').classList.add('open');
}

function closeBurnModal() {
    document.getElementById('burn-modal').classList.remove('open');
}

async function confirmBurnArchive() {
    closeBurnModal();
    await burnArchive();
}

async function burnArchive() {
    // Get all completed tasks before filtering
    const completedTasks = tasks.filter(t => t.status === 'completed');

    if (completedTasks.length === 0) {
        return;
    }

    // Filter out completed tasks (keep only non-completed)
    tasks = tasks.filter(t => t.status !== 'completed');

    // Play effects
    playSfx('del');
    triggerLightning();

    // Save to localStorage
    save();

    // Re-render
    render();

    // Sync to cloud if logged in
    if (currentUser && supabaseClient) {
        console.log('Syncing burn archive to cloud:', completedTasks.length, 'tasks');

        // Delete each completed task from cloud
        for (const task of completedTasks) {
            await deleteTaskFromCloud(task.id);
        }
    }
}

function initSpores() {
    const container = document.getElementById('spores-container');
    for (let i = 0; i < 50; i++) {
        const spore = document.createElement('div');
        spore.classList.add('spore');
        spore.style.left = Math.random() * 100 + '%';
        const size = Math.random() * 4 + 2;
        spore.style.width = size + 'px'; spore.style.height = size + 'px';
        const dur = Math.random() * 5 + 5;
        spore.style.animation = `fall ${dur}s linear infinite ${Math.random() * 5}s, sway ${Math.random() * 2 + 2}s ease-in-out infinite alternate`;
        container.appendChild(spore);
    }
}

let thunderTimer;
function startThunderLoop() {
    thunderTimer = setTimeout(() => {
        triggerLightning();
        startThunderLoop();
    }, Math.random() * 5000 + 5000);
}
function stopThunderLoop() { clearTimeout(thunderTimer); }
function triggerLightning() {
    const light = document.getElementById('lightning');
    light.classList.remove('flash-now');
    void light.offsetWidth;
    light.classList.add('flash-now');
}

function initApp() {
    initSelects();
    initSpores();
    render();
    initDrag();
    resetTime();
    const au = document.getElementById('audio');
    au.src = songs[curCh];
    au.volume = 0.5;

    // Initialize Supabase client first
    initSupabase();

    // Then initialize auth (after a small delay to ensure Supabase is ready)
    setTimeout(() => {
        if (supabaseClient) {
            initAuth();
        }
    }, 100);

    // Setup Media Session Actions (Required for iOS Control Center to stay active)
    if ('mediaSession' in navigator) {
        const actions = [['play', toggleTimer], ['pause', toggleTimer], ['stop', stopTimer], ['previoustrack', fullReset], ['nexttrack', forceNextStep]];
        for (const [action, handler] of actions) {
            try { navigator.mediaSession.setActionHandler(action, handler); } catch (error) { }
        }
    }

    // ИНИЦИАЛИЗАЦИЯ ENTER для заметок
    document.getElementById('notes-editor').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);

            let currentItem = range.commonAncestorContainer;
            if (currentItem.nodeType === 3) currentItem = currentItem.parentNode;

            const checklistItem = currentItem.closest('.checklist-item');

            if (checklistItem) {
                // Check if current item is empty to exit list
                const span = checklistItem.querySelector('span');
                const text = span ? span.textContent.replace(/\u00A0/g, '').trim() : '';

                if (text === '') {
                    e.preventDefault();
                    // Turn into regular div
                    const regularLine = document.createElement('div');
                    regularLine.innerHTML = '<br>';
                    checklistItem.replaceWith(regularLine);

                    const newRange = document.createRange();
                    newRange.setStart(regularLine, 0);
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                    return;
                }

                e.preventDefault();

                // Создаем новый пункт
                const newItem = document.createElement('div');
                newItem.className = 'checklist-item';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';

                const newSpan = document.createElement('span');
                newSpan.textContent = '\u00A0';

                newItem.appendChild(checkbox);
                newItem.appendChild(newSpan);

                checklistItem.after(newItem);

                // Фокус на новый спан
                const newRange = document.createRange();
                if (newSpan.firstChild) {
                    newRange.setStart(newSpan.firstChild, 0);
                } else {
                    newRange.setStart(newSpan, 0);
                }

                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
            }
        }
    });

    document.getElementById('notes-editor').addEventListener('change', function (e) {
        if (e.target.type === 'checkbox') {
            if (e.target.checked) {
                e.target.setAttribute('checked', 'true');
            } else {
                e.target.removeAttribute('checked');
            }
        }
    });

    // Close task menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.task-menu-dropdown') && !e.target.closest('.btn-menu')) {
            closeAllTaskMenus();
        }
    });
}

function addTask() {
    const inp = document.getElementById('task-input');
    const val = inp.value.trim();
    if (!val) return;

    const newTask = {
        id: Date.now(),
        txt: val,
        status: prependMode ? 'active' : 'deferred', // If prepend mode: active, else: deferred
        color: newSelectedColor,
        order_index: 0, // Will be recalculated below
        created_at: Date.now() // Timestamp создания задачи
    };

    // FIX: If prepend mode is active, insert at the beginning of active tasks
    if (prependMode) {
        // Find the index of the first active task
        const firstActiveIndex = tasks.findIndex(t => t.status === 'active');

        if (firstActiveIndex !== -1) {
            // Insert at the beginning of active tasks
            tasks.splice(firstActiveIndex, 0, newTask);
        } else {
            // No active tasks exist, add at the beginning
            tasks.unshift(newTask);
        }
    } else {
        // Not prepend mode: add to end (will be sorted in deferred section by age)
        tasks.push(newTask);
    }

    // Recalculate order_index for all tasks
    tasks.forEach((t, idx) => {
        t.order_index = idx;
    });

    inp.value = '';
    playSfx('click');

    // Выключить режим prepend после добавления задачи
    if (prependMode) {
        prependMode = false;
        document.getElementById('prepend-toggle').classList.remove('active');
    }

    save();
    render();

    // Sync to cloud if logged in
    if (currentUser) {
        uploadTaskToCloud(newTask);
    }
}

async function uploadTaskToCloud(task) {
    if (!currentUser || !supabaseClient) return;
    showSyncIndicator();

    try {
        const { data, error } = await supabaseClient
            .from('tasks')
            .insert({
                user_id: currentUser.id,
                title: task.txt,
                is_completed: task.status === 'completed',
                status: task.status || 'active', // NEW: Add status field for deferred tasks
                color: task.color || 'red',
                order_index: task.order_index || 0,
                created_at: task.created_at ? new Date(task.created_at).toISOString() : new Date().toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        // CRITICAL BUGFIX: Update local task ID AND DOM data-id attribute
        // This fixes the "ghosting" bug when dragging newly created tasks
        const oldId = task.id;
        const localTask = tasks.find(t => t.id === oldId);
        if (localTask && data) {
            localTask.id = data.id;
            localTask.order_index = data.order_index;

            // Update DOM element data-id WITHOUT full re-render
            // This allows SortableJS to continue tracking the correct ID
            const domElement = document.querySelector(`li[data-id="${oldId}"]`);
            if (domElement) {
                domElement.dataset.id = data.id;

                // Update all onclick handlers to use new ID
                const newIdStr = String(data.id);
                domElement.querySelector('.checkbox').setAttribute('onclick', `toggle('${newIdStr}')`);
                domElement.querySelector('.task-text').setAttribute('onclick', `toggle('${newIdStr}')`);
                domElement.querySelector('.btn-edit').setAttribute('onclick', `openEditModal('${newIdStr}')`);
                domElement.querySelector('.btn-del').setAttribute('onclick', `del('${newIdStr}')`);
            }

            save();
        }
    } catch (error) {
        console.error('Upload Error:', error);
    } finally {
        hideSyncIndicator();
    }
}

function toggle(id) {
    const t = tasks.find(x => String(x.id) === String(id));
    if (t) {
        // Cycle through statuses: active → completed, deferred → completed, completed → active
        if (t.status === 'active' || t.status === 'deferred') {
            t.status = 'completed';
        } else {
            t.status = 'active';
        }

        playSfx('click');
        save();
        render();

        // Sync to cloud if logged in
        if (currentUser) {
            updateTaskInCloud(id, { status: t.status }); // FIX: Sync status instead of is_completed
        }
    }
}

/**
 * Перемещает задачу в начало списка активных задач
 */
async function moveToTop(id) {
    const taskIndex = tasks.findIndex(x => String(x.id) === String(id));
    if (taskIndex === -1) return;

    const task = tasks[taskIndex];

    // Проверяем, что задача активная (moveToTop работает только для активных задач)
    if (task.status !== 'active') return;

    // Находим индекс первой активной задачи
    const firstActiveIndex = tasks.findIndex(t => t.status === 'active');
    if (firstActiveIndex === -1 || taskIndex === firstActiveIndex) return;

    // Удаляем задачу из текущей позиции
    tasks.splice(taskIndex, 1);

    // Вставляем задачу в начало списка активных задач
    tasks.splice(firstActiveIndex, 0, task);

    // Пересчитываем order_index для всех задач
    tasks.forEach((t, idx) => {
        t.order_index = idx;
    });

    playSfx('click');
    save();
    render();

    // Синхронизация с облаком, если пользователь залогинен
    if (currentUser) {
        // Обновляем order_index для всех задач в облаке
        await updateTaskOrderInCloud();
    }
}

/**
 * Перемещает задачу в раздел "ОТЛОЖКА"
 */
async function moveToDeferred(id) {
    const task = tasks.find(x => String(x.id) === String(id));
    if (!task) return;

    // Меняем статус на 'deferred'
    task.status = 'deferred';

    playSfx('click');
    save();
    render();

    // Синхронизация с облаком, если пользователь залогинен
    if (currentUser) {
        await updateTaskInCloud(id, { status: 'deferred' }); // FIX: Sync status instead of is_completed
    }
}

/**
 * Toggles the dropdown menu for a specific task
 * @param {string} id - Task ID
 * @param {Event} event - Click event to prevent propagation
 */
function toggleTaskMenu(id, event) {
    event.stopPropagation(); // Prevent task toggle

    const menu = document.querySelector(`li[data-id="${id}"] .task-menu-dropdown`);
    if (!menu) return;

    // Close previously open menu if different
    if (openMenuId && openMenuId !== id) {
        const prevMenu = document.querySelector(`li[data-id="${openMenuId}"] .task-menu-dropdown`);
        if (prevMenu) {
            prevMenu.classList.remove('open');
        }
    }

    // Toggle current menu
    menu.classList.toggle('open');

    // Update tracking
    openMenuId = menu.classList.contains('open') ? id : null;
}

/**
 * Closes all open task menus
 */
function closeAllTaskMenus() {
    document.querySelectorAll('.task-menu-dropdown.open').forEach(menu => {
        menu.classList.remove('open');
    });
    openMenuId = null;
}

function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(tasks)); } catch (e) { }
}

// ========== SECURITY: XSS PROTECTION ==========
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== HELPER FUNCTIONS ==========
/**
 * Removes duplicate tasks by ID, keeping the first occurrence
 * @param {Array} taskList - Array of tasks
 * @returns {Array} - Deduplicated array
 */
function removeDuplicateTasks(taskList) {
    const seen = new Set();
    return taskList.filter(task => {
        const id = String(task.id);
        if (seen.has(id)) {
            return false;
        }
        seen.add(id);
        return true;
    });
}

// ========== TASK AGE TRACKING ==========
/**
 * Вычисляет возраст задачи в полных днях
 * @param {Object} task - Объект задачи
 * @returns {number} - Возраст в днях
 */
function getTaskAgeDays(task) {
    if (!task.created_at) return 0;
    const now = Date.now();
    const ageMs = now - task.created_at;
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    return ageDays;
}

/**
 * Определяет CSS-класс цвета на основе возраста задачи
 * @param {number} days - Возраст в днях
 * @returns {string} - CSS класс
 */
function getAgeColorClass(days) {
    if (days >= 5) return 'age-critical';
    if (days >= 3) return 'age-warning';
    if (days >= 1) return 'age-normal';
    return 'age-new';
}

function render() {
    const act = document.getElementById('active-list');
    const def = document.getElementById('deferred-list');
    const com = document.getElementById('completed-list');

    // PERFORMANCE: Use DocumentFragment instead of innerHTML in loop
    const actFragment = document.createDocumentFragment();
    const defFragment = document.createDocumentFragment();
    const comFragment = document.createDocumentFragment();

    // Migrate old tasks: convert 'done' field to 'status' field
    tasks.forEach(t => {
        if (t.status === undefined) {
            // Old task format - migrate to new format
            if (t.done === true) {
                t.status = 'completed';
            } else {
                t.status = 'active'; // Default old active tasks to 'active'
            }
            delete t.done; // Remove old field
        }
    });

    // Separate tasks by status
    const activeTasks = tasks.filter(t => t.status === 'active');
    const deferredTasks = tasks.filter(t => t.status === 'deferred');
    const completedTasks = tasks.filter(t => t.status === 'completed');

    // Sort deferred tasks by age (oldest first)
    deferredTasks.sort((a, b) => {
        const ageA = a.created_at || 0;
        const ageB = b.created_at || 0;
        return ageA - ageB; // Oldest first (smallest timestamp first)
    });

    // Render function for a single task
    const renderTask = (t) => {
        const li = document.createElement('li');
        const colorClass = t.color ? 'border-' + t.color : 'border-red';
        li.className = `task-item ${t.status === 'completed' ? 'completed' : ''} ${colorClass}`;
        li.dataset.id = t.id;

        const taskIdStr = String(t.id);

        // Calculate task age for non-completed tasks
        const ageDays = t.status !== 'completed' ? getTaskAgeDays(t) : -1;
        let ageIndicator = '';

        if (t.status !== 'completed' && ageDays >= 0) {
            if (ageDays === 0) {
                // New task (created today) - show dash
                ageIndicator = '<span class="task-age age-new">-</span>';
            } else {
                // Older task - show age in days
                const ageColorClass = getAgeColorClass(ageDays);
                ageIndicator = `<span class="task-age ${ageColorClass}">${ageDays}д</span>`;
            }
        }

        li.innerHTML = `
            <div class="checkbox" onclick="toggle('${taskIdStr}')"></div>
            <span class="task-text" onclick="toggle('${taskIdStr}')">${escapeHtml(t.txt)}</span>
            ${t.status !== 'completed' ? `
                ${ageIndicator}
                <button class="btn-menu" onclick="toggleTaskMenu('${taskIdStr}', event)" title="Меню">
                    <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="2"/>
                        <circle cx="12" cy="12" r="2"/>
                        <circle cx="12" cy="19" r="2"/>
                    </svg>
                </button>
                <div class="task-menu-dropdown">
                    <button class="menu-item" onclick="moveToTop('${taskIdStr}'); closeAllTaskMenus();" title="Переместить в начало">
                        <span class="menu-icon">▲</span>
                        <span class="menu-label">ВВЕРХ</span>
                    </button>
                    <button class="menu-item" onclick="openEditModal('${taskIdStr}'); closeAllTaskMenus();" title="Редактировать">
                        <span class="menu-icon">✎</span>
                        <span class="menu-label">РЕДАКТИРОВАТЬ</span>
                    </button>
                    <button class="menu-item" onclick="moveToDeferred('${taskIdStr}'); closeAllTaskMenus();" title="Переместить в отложку">
                        <span class="menu-icon">⏸</span>
                        <span class="menu-label">В ОТЛОЖКУ</span>
                    </button>
                    <button class="menu-item menu-item-danger" onclick="del('${taskIdStr}'); closeAllTaskMenus();" title="Удалить">
                        <span class="menu-icon">×</span>
                        <span class="menu-label">УДАЛИТЬ</span>
                    </button>
                </div>
            ` : `
                <button class="btn-action btn-edit" onclick="openEditModal('${taskIdStr}')">✎</button>
                <button class="btn-action btn-del" onclick="del('${taskIdStr}')">×</button>
            `}
        `;

        return li;
    };

    // Render all tasks
    activeTasks.forEach(t => actFragment.appendChild(renderTask(t)));
    deferredTasks.forEach(t => defFragment.appendChild(renderTask(t)));
    completedTasks.forEach(t => comFragment.appendChild(renderTask(t)));

    // Single DOM write per list (MUCH faster)
    act.innerHTML = '';
    def.innerHTML = '';
    com.innerHTML = '';
    act.appendChild(actFragment);
    def.appendChild(defFragment);
    com.appendChild(comFragment);
}

function setCh(idx) {
    curCh = idx;
    const au = document.getElementById('audio');

    const btn = document.getElementById('play-btn');
    const isPlaying = btn.classList.contains('playing');

    au.pause();

    au.src = songs[idx];

    if (isPlaying) {
        const playPromise = au.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error("Playback failed:", error);
            });
        }
    }

    document.querySelectorAll('.ch-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
    playSfx('click');
}

function toggleAudio() {
    const au = document.getElementById('audio');
    const btn = document.getElementById('play-btn');

    if (btn.classList.contains('playing')) {
        au.pause();
        btn.innerText = "НАЧАТЬ ЭФИР";
        btn.classList.remove('playing');
        document.body.classList.remove('music-active');
        stopThunderLoop();
    } else {
        const playPromise = au.play();

        if (playPromise !== undefined) {
            playPromise.then(_ => {
                btn.innerText = "ОСТАНОВИТЬ ЭФИР";
                btn.classList.add('playing');
                document.body.classList.add('music-active');
                startThunderLoop();
                triggerLightning();
            })
                .catch(error => {
                    console.error(error);
                    showToast("ОШИБКА АУДИО ПОТОКА");
                    btn.innerText = "НАЧАТЬ ЭФИР";
                    btn.classList.remove('playing');
                    document.body.classList.remove('music-active');
                });
        }
    }
}

// Debounce timer for drag-and-drop cloud sync
let dragDebounceTimer = null;

function initDrag() {
    if (typeof Sortable !== 'undefined') {
        const opts = {
            group: 'tasks', // Allow dragging between all three lists
            animation: 150,
            delay: 200,
            delayOnTouchOnly: true,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            scroll: document.getElementById('app-ui'), // SCROLL CONTAINER
            scrollSensitivity: 150,
            scrollSpeed: 20,
            bubbleScroll: true,
            forceFallback: true, // Fix for iOS scrolling
            fallbackClass: 'sortable-fallback',
            fallbackOnBody: true,
            touchStartThreshold: 5,
            onEnd: (evt) => {
                // Determine which list the task was dropped into
                const targetListId = evt.to.id;
                const taskId = evt.item.dataset.id;
                const task = tasks.find(t => String(t.id) === String(taskId));

                if (task) {
                    // Update task status based on target list
                    if (targetListId === 'active-list') {
                        task.status = 'active';
                    } else if (targetListId === 'deferred-list') {
                        task.status = 'deferred';
                    } else if (targetListId === 'completed-list') {
                        task.status = 'completed';
                    }
                }

                // Rebuild tasks array from DOM order
                const newOrder = [];
                document.querySelectorAll('.task-item').forEach(el => {
                    const found = tasks.find(t => t.id == el.dataset.id);
                    if (found) newOrder.push(found);
                });
                tasks = newOrder;

                // Update order_index for all tasks
                tasks.forEach((task, index) => {
                    task.order_index = index;
                });

                // INSTANT local save
                save();

                // Re-render to apply auto-sorting for deferred list
                render();

                // DEBOUNCED cloud sync (PERFORMANCE: Prevents request waterfall)
                if (currentUser) {
                    clearTimeout(dragDebounceTimer);
                    dragDebounceTimer = setTimeout(() => {
                        updateTaskOrderInCloud();
                    }, 2000); // Wait 2s after user stops dragging
                }
            }
        };

        Sortable.create(document.getElementById('active-list'), opts);
        Sortable.create(document.getElementById('deferred-list'), opts);
        Sortable.create(document.getElementById('completed-list'), opts);
    }
}

window.onload = initApp;

// ========== SUPABASE AUTH FUNCTIONS ==========
async function initAuth() {
    if (!supabaseClient) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            currentUser = session.user;
            await handleLogin();
        }
        updateAuthUI();
    } catch (error) {
        console.error('Init Auth Error:', error);
        updateAuthUI();
    }
}

async function sendOTP() {
    if (!supabaseClient) {
        showToast('СИСТЕМА НЕ ГОТОВА');
        return;
    }
    const email = document.getElementById('auth-email').value.trim();
    if (!email) {
        showToast('ВВЕДИТЕ EMAIL');
        return;
    }

    showSyncIndicator();

    try {
        // ADDED TIMEOUT: Prevent hanging on slow network
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 10000)
        );

        const otpPromise = supabaseClient.auth.signInWithOtp({
            email: email,
            options: {
                shouldCreateUser: true
            }
        });

        const { error } = await Promise.race([otpPromise, timeoutPromise]);

        if (error) throw error;

        pendingEmail = email;
        document.getElementById('sent-email').innerText = email;
        updateAuthUI('awaiting-code');
        showToast('КОД ОТПРАВЛЕН НА EMAIL');
    } catch (error) {
        console.error('OTP Error:', error);
        if (error.message === 'TIMEOUT') {
            showToast('СЕТЬ ТОРМОЗИТ: ПРЕВЫШЕНО ВРЕМЯ ОЖИДАНИЯ');
        } else {
            showToast('ОШИБКА ОТПРАВКИ: ' + error.message);
        }
    } finally {
        hideSyncIndicator();
    }
}

async function verifyOTP() {
    if (!supabaseClient) {
        showToast('СИСТЕМА НЕ ГОТОВА');
        return;
    }
    const code = document.getElementById('auth-code').value.trim();
    if (!code || code.length !== 6) {
        showToast('ВВЕДИТЕ 6-ЗНАЧНЫЙ КОД');
        return;
    }

    showSyncIndicator();

    try {
        // ADDED TIMEOUT: Prevent hanging on slow network
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 10000)
        );

        const verifyPromise = supabaseClient.auth.verifyOtp({
            email: pendingEmail,
            token: code,
            type: 'email'
        });

        const { data, error } = await Promise.race([verifyPromise, timeoutPromise]);

        if (error) throw error;

        currentUser = data.user;
        await handleLogin();
        showToast('СВЯЗЬ УСТАНОВЛЕНА');
    } catch (error) {
        console.error('Verify Error:', error);
        if (error.message === 'TIMEOUT') {
            showToast('СЕТЬ ТОРМОЗИТ: ПРЕВЫШЕНО ВРЕМЯ ОЖИДАНИЯ');
        } else {
            showToast('НЕВЕРНЫЙ КОД: ' + error.message);
        }
    } finally {
        hideSyncIndicator();
    }
}

async function logout() {
    if (!supabaseClient) return;
    try {
        await supabaseClient.auth.signOut();
        currentUser = null;
        pendingEmail = '';

        // Unsubscribe from realtime
        if (realtimeChannel) {
            await supabaseClient.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }

        updateAuthUI();
        showToast('СВЯЗЬ РАЗОРВАНА');
    } catch (error) {
        console.error('Logout Error:', error);
        showToast('ОШИБКА ВЫХОДА');
    }
}

function updateAuthUI(state) {
    const statusEl = document.getElementById('auth-status');
    const loginForm = document.getElementById('auth-login-form');
    const codeForm = document.getElementById('auth-code-form');
    const loggedIn = document.getElementById('auth-logged-in');
    const userEmail = document.getElementById('auth-user-email');

    // Hide all forms first
    loginForm.style.display = 'none';
    codeForm.style.display = 'none';
    loggedIn.style.display = 'none';

    if (currentUser) {
        // Logged in state
        statusEl.innerHTML = '<span class="status-online">🟢 В ЭФИРЕ (ON AIR)</span>';
        userEmail.innerText = currentUser.email;
        loggedIn.style.display = 'block';

        // Update Main Screen Indicator
        document.getElementById('main-air-dot').classList.add('on');
        document.getElementById('main-air-text').innerText = 'ON AIR';
        document.getElementById('main-air-text').style.color = 'var(--color-green)';
    } else if (state === 'awaiting-code') {
        // Awaiting code state
        statusEl.innerHTML = '<span class="status-offline">🔴 ОЖИДАНИЕ ШИФРОВКИ</span>';
        codeForm.style.display = 'block';

        // Update Main Screen Indicator (Keep as Off/Waiting)
        document.getElementById('main-air-dot').classList.remove('on');
        document.getElementById('main-air-text').innerText = 'OFF AIR';
        document.getElementById('main-air-text').style.color = '#555';
    } else {
        // Logged out state - SHOW LOGIN FORM
        statusEl.innerHTML = '<span class="status-offline">🔴 ВНЕ ЭФИРА (OFF AIR)</span>';
        loginForm.style.display = 'block';

        // Update Main Screen Indicator
        document.getElementById('main-air-dot').classList.remove('on');
        document.getElementById('main-air-text').innerText = 'OFF AIR';
        document.getElementById('main-air-text').style.color = '#555';
    }
}

async function handleLogin() {
    if (!currentUser) return;

    // Trigger synchronization with timeout protection
    try {
        // Wrap syncTasksOnLogin with timeout
        const taskSyncTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TASK_SYNC_TIMEOUT')), 15000)
        );
        await Promise.race([syncTasksOnLogin(), taskSyncTimeout]);
    } catch (error) {
        console.error('Task sync error:', error);
        if (error.message === 'TASK_SYNC_TIMEOUT') {
            showToast('СИНХРОНИЗАЦИЯ ЗАДАЧ: ПРЕВЫШЕНО ВРЕМЯ ОЖИДАНИЯ');
            hideSyncIndicator();
        }
    }

    try {
        // Wrap syncNotesOnLogin with timeout
        const notesSyncTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('NOTES_SYNC_TIMEOUT')), 15000)
        );
        await Promise.race([syncNotesOnLogin(), notesSyncTimeout]);
    } catch (error) {
        console.error('Notes sync error:', error);
        if (error.message === 'NOTES_SYNC_TIMEOUT') {
            showToast('СИНХРОНИЗАЦИЯ ЗАМЕТОК: ПРЕВЫШЕНО ВРЕМЯ ОЖИДАНИЯ');
            hideSyncIndicator();
        }
    }

    // Subscribe to realtime updates
    subscribeToTasks();
    subscribeToNotes();

    updateAuthUI();
}

// ========== DEDUPLICATION UTILITY ==========
/**
 * Removes duplicate tasks from the array based on ID.
 * If multiple tasks have the same ID, keeps only the first occurrence.
 * @param {Array} taskArray - Array of tasks to deduplicate
 * @returns {Array} - Deduplicated array of tasks
 */
function removeDuplicateTasks(taskArray) {
    const seen = new Set();
    const deduplicated = [];

    for (const task of taskArray) {
        const taskId = String(task.id);
        if (!seen.has(taskId)) {
            seen.add(taskId);
            deduplicated.push(task);
        } else {
            console.log('Removing duplicate task:', taskId, task.txt);
        }
    }

    return deduplicated;
}

// ========== TASK SYNCHRONIZATION (CLOUD IS ONLY SOURCE OF TRUTH) ==========
async function syncTasksOnLogin() {
    if (!currentUser || !supabaseClient) return;
    showSyncIndicator();

    try {
        // CRITICAL FIX: DO NOT upload localStorage tasks to cloud during sync
        // Cloud is the ONLY source of truth. LocalStorage is only for offline work.

        // 1. Get ALL cloud tasks (excluding soft-deleted)
        const { data: cloudTasks, error } = await supabaseClient
            .from('tasks')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('is_deleted', false)
            .order('order_index', { ascending: true });

        if (error) throw error;

        // 2. Convert cloud tasks to local format
        const convertedCloudTasks = (cloudTasks || []).map(ct => ({
            id: ct.id,
            txt: ct.title,
            done: ct.is_completed,
            color: ct.color || 'red',
            order_index: ct.order_index || 0
        }));

        // 3. CRITICAL: REPLACE local tasks with cloud data (Cloud is source of truth)
        // This completely overwrites localStorage with fresh cloud data
        tasks = convertedCloudTasks;

        // 4. Remove any duplicates by ID (safety check)
        tasks = removeDuplicateTasks(tasks);

        // 5. Sort by order_index
        tasks.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

        // 6. Save to localStorage (now contains fresh cloud data)
        save();
        render();

        showToast('СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА');
        console.log('Sync complete. Total tasks:', tasks.length);
    } catch (error) {
        console.error('Sync Error:', error);
        showToast('ОШИБКА СИНХРОНИЗАЦИИ');
    } finally {
        hideSyncIndicator();
    }
}

async function uploadTask(task) {
    if (!currentUser || !supabaseClient) return;

    try {
        const { error } = await supabaseClient
            .from('tasks')
            .insert({
                user_id: currentUser.id,
                title: task.txt,
                is_completed: task.done,
                color: task.color || 'red',
                order_index: task.order_index || 0
            });

        if (error) throw error;
    } catch (error) {
        console.error('Upload Task Error:', error);
    }
}

async function updateTaskOrderInCloud() {
    if (!currentUser || !supabaseClient) return;
    showSyncIndicator();

    try {
        // Perform a bulk upsert to update order_index for all tasks
        const updates = tasks.map(t => ({
            id: t.id,
            user_id: currentUser.id,
            title: t.txt,
            status: t.status || 'active', // FIX: Sync status field (active/deferred/completed)
            is_completed: t.status === 'completed', // Derive from status for backward compatibility
            color: t.color || 'red',
            order_index: t.order_index,
            created_at: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString() // Preserve timestamp
        }));

        // ADDED TIMEOUT: If network is slow, don't hang forever
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 5000)
        );

        const updatePromise = supabaseClient
            .from('tasks')
            .upsert(updates);

        const { error } = await Promise.race([updatePromise, timeoutPromise]);

        if (error) throw error;
    } catch (error) {
        console.error('Update Order Error:', error);
        if (error.message === 'TIMEOUT') {
            showToast('СЕТЬ ТОРМОЗИТ: ПОРЯДОК НЕ СОХРАНЕН');
        }
    } finally {
        hideSyncIndicator();
    }
}

async function updateTaskInCloud(taskId, updates) {
    if (!currentUser || !supabaseClient) return;

    try {
        // ADDED TIMEOUT
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 5000)
        );

        // NEW: If is_completed is being updated, also update status field
        const cloudUpdates = { ...updates };
        if ('is_completed' in updates) {
            cloudUpdates.status = updates.is_completed ? 'completed' : 'active';
        }
        // NEW: If status is provided directly, use it
        if ('status' in updates) {
            cloudUpdates.status = updates.status;
            cloudUpdates.is_completed = updates.status === 'completed';
        }

        const updatePromise = supabaseClient
            .from('tasks')
            .update(cloudUpdates)
            .eq('id', taskId)
            .eq('user_id', currentUser.id);

        const { error } = await Promise.race([updatePromise, timeoutPromise]);

        if (error) throw error;
    } catch (error) {
        console.error('Update Task Error:', error);
        if (error.message === 'TIMEOUT') {
            showToast('СЛАБАЯ СЕТЬ: ОБНОВЛЕНИЕ НЕ ОТПРАВЛЕНО');
        }
    }
}

async function deleteTaskFromCloud(taskId) {
    if (!currentUser || !supabaseClient) return;

    try {
        // Soft Delete: Update is_deleted = true
        const { data, error } = await supabaseClient
            .from('tasks')
            .update({ is_deleted: true })
            .eq('id', taskId)
            .eq('user_id', currentUser.id)
            .select();

        if (error) throw error;

        if (data && data.length > 0) {
            console.log('Soft deleted task in cloud:', taskId);
        } else {
            console.warn('Task not found or not owned by user for soft delete:', taskId);
        }
    } catch (error) {
        console.error('Delete Task Error:', error);
        showToast('ОШИБКА УДАЛЕНИЯ: ' + error.message);
    }
}

// ========== TASKS SYNCHRONIZATION ==========
async function syncTasksOnLogin() {
    if (!currentUser || !supabaseClient) return;
    showSyncIndicator();

    try {
        console.log('Syncing tasks from cloud...');

        // Get all non-deleted tasks from cloud
        const { data: cloudTasks, error } = await supabaseClient
            .from('tasks')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('is_deleted', false);

        if (error) throw error;

        console.log('Cloud tasks received:', cloudTasks?.length || 0);

        if (cloudTasks && cloudTasks.length > 0) {
            // Convert cloud tasks to local format
            const cloudTasksConverted = cloudTasks.map(ct => {
                // NEW: Properly map status field with backward compatibility
                let status = 'active'; // default
                if (ct.status) {
                    // New format: use status field directly
                    status = ct.status;
                } else if (ct.is_completed) {
                    // Old format: fall back to is_completed
                    status = 'completed';
                }

                return {
                    id: ct.id,
                    txt: ct.title,
                    status: status, // FIX: Use status instead of done
                    color: ct.color || 'red',
                    order_index: ct.order_index || 0,
                    created_at: ct.created_at ? new Date(ct.created_at).getTime() : Date.now()
                };
            });

            // Merge with local tasks
            const localTasks = tasks.slice();

            // Update existing tasks or add new ones from cloud
            cloudTasksConverted.forEach(cloudTask => {
                const localIndex = localTasks.findIndex(t => String(t.id) === String(cloudTask.id));
                if (localIndex !== -1) {
                    // Update existing task with cloud data (cloud is source of truth)
                    localTasks[localIndex] = cloudTask;
                } else {
                    // Add new task from cloud
                    localTasks.push(cloudTask);
                }
            });

            // Upload any local-only tasks to cloud
            for (const localTask of localTasks) {
                const existsInCloud = cloudTasksConverted.find(ct => String(ct.id) === String(localTask.id));
                if (!existsInCloud) {
                    console.log('Uploading local-only task to cloud:', localTask.id);
                    await uploadTaskToCloud(localTask);
                }
            }

            // Update local tasks
            tasks = removeDuplicateTasks(localTasks);
            tasks.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

            save();
            render();

            console.log('Tasks synced successfully. Total tasks:', tasks.length);
        }
    } catch (error) {
        console.error('Tasks Sync Error:', error);
        showToast('ОШИБКА СИНХРОНИЗАЦИИ ЗАДАЧ');
    } finally {
        hideSyncIndicator();
    }
}

// ========== NOTES SYNCHRONIZATION ==========
async function syncNotesOnLogin() {
    if (!currentUser || !supabaseClient) return;
    showSyncIndicator();

    try {
        // Get cloud notes
        const { data: cloudNote, error } = await supabaseClient
            .from('notes')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
            throw error;
        }

        const localNotes = localStorage.getItem(NOTES_KEY) || '';

        if (!cloudNote && localNotes) {
            // Cloud empty, upload local
            await uploadNotesToCloud(localNotes);
        } else if (cloudNote) {
            // Cloud has data, use it as truth
            localStorage.setItem(NOTES_KEY, cloudNote.content);
        }
    } catch (error) {
        console.error('Notes Sync Error:', error);
    } finally {
        hideSyncIndicator();
    }
}

async function uploadNotesToCloud(content) {
    if (!currentUser || !supabaseClient) return;
    showSyncIndicator();

    try {
        const { error } = await supabaseClient
            .from('notes')
            .upsert({
                user_id: currentUser.id,
                content: content,
                updated_at: new Date().toISOString()
            });

        if (error) throw error;
    } catch (error) {
        console.error('Upload Notes Error:', error);
        showToast('ОШИБКА СОХРАНЕНИЯ ЗАМЕТОК');
    } finally {
        hideSyncIndicator();
    }
}

// ========== REALTIME SUBSCRIPTIONS ==========
function subscribeToTasks() {
    if (!currentUser || realtimeChannel || !supabaseClient) {
        console.log('subscribeToTasks skipped:', { currentUser: !!currentUser, realtimeChannel: !!realtimeChannel, supabaseClient: !!supabaseClient });
        return;
    }

    console.log('Creating Realtime subscription for user:', currentUser.id);
    realtimeChannel = supabaseClient
        .channel('tasks-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'tasks',
                filter: `user_id=eq.${currentUser.id}`
            },
            (payload) => {
                console.log('Realtime event received:', payload);
                handleRealtimeEvent(payload);
            }
        )
        .subscribe((status) => {
            console.log('Realtime subscription status:', status);
        });
}

function subscribeToNotes() {
    if (!currentUser || notesRealtimeChannel || !supabaseClient) {
        console.log('subscribeToNotes skipped:', { currentUser: !!currentUser, notesRealtimeChannel: !!notesRealtimeChannel, supabaseClient: !!supabaseClient });
        return;
    }

    console.log('Creating Realtime subscription for notes, user:', currentUser.id);
    notesRealtimeChannel = supabaseClient
        .channel('notes-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'notes',
                filter: `user_id=eq.${currentUser.id}`
            },
            (payload) => {
                console.log('Notes Realtime event received:', payload);
                handleNotesRealtimeEvent(payload);
            }
        )
        .subscribe((status) => {
            console.log('Notes Realtime subscription status:', status);
        });
}

function handleNotesRealtimeEvent(payload) {
    console.log('handleNotesRealtimeEvent called with:', payload);
    const { eventType, new: newRecord } = payload;
    console.log('Notes event type:', eventType, 'New:', newRecord);

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
        // Update local notes from cloud
        if (newRecord && newRecord.content !== undefined) {
            console.log('Updating notes from cloud, content length:', newRecord.content.length);
            const currentContent = localStorage.getItem(NOTES_KEY) || '';

            console.log('Current content length:', currentContent.length);
            console.log('New content length:', newRecord.content.length);
            console.log('Contents equal?', currentContent === newRecord.content);

            // Always update localStorage
            localStorage.setItem(NOTES_KEY, newRecord.content);

            // ALWAYS update editor if notes modal is open
            const notesModal = document.getElementById('notes-modal');
            const editor = document.getElementById('notes-editor');

            if (notesModal && editor) {
                const isOpen = notesModal.classList.contains('open');
                console.log('Notes modal open?', isOpen);

                if (isOpen) {
                    console.log('Updating editor innerHTML');
                    editor.innerHTML = newRecord.content;
                    showToast('ЗАМЕТКИ ОБНОВЛЕНЫ ИЗ ОБЛАКА');
                }
            } else {
                console.log('Editor or modal not found');
            }
        }
    }
}

function handleRealtimeEvent(payload) {
    console.log('handleRealtimeEvent called with:', payload);
    const { eventType, new: newRecord, old: oldRecord } = payload;
    console.log('Event type:', eventType, 'New:', newRecord, 'Old:', oldRecord);

    if (eventType === 'INSERT') {
        // Only insert if not marked as deleted
        if (!newRecord.is_deleted) {
            const newTask = {
                id: newRecord.id,
                txt: newRecord.title,
                done: newRecord.is_completed,
                color: newRecord.color || 'red',
                order_index: newRecord.order_index || 0,
                created_at: newRecord.created_at ? new Date(newRecord.created_at).getTime() : Date.now()
            };

            // CRITICAL FIX: Check by ID to prevent duplicates
            const existingTask = tasks.find(t => String(t.id) === String(newTask.id));
            if (!existingTask) {
                console.log('Adding new task from cloud:', newTask);
                tasks.push(newTask);

                // Remove duplicates and sort
                tasks = removeDuplicateTasks(tasks);
                tasks.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

                save();
                render();
                showToast('НОВАЯ ЗАДАЧА ИЗ ОБЛАКА');
            } else {
                console.log('Task already exists, skipping INSERT:', newTask.id);
            }
        } else {
            console.log('Skipping deleted task:', newRecord.id);
        }
    } else if (eventType === 'UPDATE') {
        console.log('Processing UPDATE event');
        if (newRecord.is_deleted) {
            // Treat soft delete as DELETE
            const index = tasks.findIndex(t => String(t.id) === String(newRecord.id));
            if (index !== -1) {
                console.log('Removing soft-deleted task:', newRecord.id);
                tasks.splice(index, 1);
                save();
                render();
                showToast('ЗАДАЧА УДАЛЕНА В ОБЛАКЕ');
            } else {
                console.log('Soft-deleted task not found locally:', newRecord.id);
            }
        } else {
            // CRITICAL FIX: Update existing task OR add if not found
            const taskIndex = tasks.findIndex(t => String(t.id) === String(newRecord.id));

            if (taskIndex !== -1) {
                // Task exists - UPDATE it
                console.log('Updating existing task:', newRecord.id);
                tasks[taskIndex].txt = newRecord.title;
                tasks[taskIndex].done = newRecord.is_completed;
                tasks[taskIndex].color = newRecord.color || 'red';
                tasks[taskIndex].order_index = newRecord.order_index || 0;
                // Always update created_at from cloud if available
                if (newRecord.created_at) {
                    tasks[taskIndex].created_at = new Date(newRecord.created_at).getTime();
                }
            } else {
                // Task doesn't exist locally - ADD it (this handles the case where
                // the task was edited on another device before this device loaded it)
                console.log('Task not found locally, adding from UPDATE event:', newRecord.id);
                tasks.push({
                    id: newRecord.id,
                    txt: newRecord.title,
                    done: newRecord.is_completed,
                    color: newRecord.color || 'red',
                    order_index: newRecord.order_index || 0,
                    created_at: newRecord.created_at ? new Date(newRecord.created_at).getTime() : Date.now()
                });
            }

            // Remove duplicates and sort
            tasks = removeDuplicateTasks(tasks);
            tasks.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

            save();
            render();
        }
    } else if (eventType === 'DELETE') {
        console.log('Processing DELETE event');
        // Keep handling hard deletes just in case
        const index = tasks.findIndex(t => String(t.id) === String(oldRecord.id));
        if (index !== -1) {
            console.log('Removing hard-deleted task:', oldRecord.id);
            tasks.splice(index, 1);
            save();
            render();
            showToast('ЗАДАЧА УДАЛЕНА В ОБЛАКЕ');
        } else {
            console.log('Hard-deleted task not found locally:', oldRecord.id);
        }
    }
}

function showSyncIndicator() {
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
        indicator.classList.add('visible');
    }
}

function hideSyncIndicator() {
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
        indicator.classList.remove('visible');
    }
}

// --- ЗАМЕТКИ (NOTES) ФУНКЦИОНАЛ ---
const NOTES_KEY = 'STRANGER_THINGS_NOTES';
let originalNotesContent = '';

function openNotes() {
    const modal = document.getElementById('notes-modal');
    const editor = document.getElementById('notes-editor');
    const savedNotes = localStorage.getItem(NOTES_KEY) || '';

    editor.innerHTML = savedNotes;
    originalNotesContent = savedNotes;

    modal.classList.add('open');
}

function saveNotes() {
    const editor = document.getElementById('notes-editor');
    const content = editor.innerHTML;
    localStorage.setItem(NOTES_KEY, content);

    // Sync to cloud if logged in
    if (currentUser) {
        uploadNotesToCloud(content);
    }

    const modal = document.getElementById('notes-modal');
    modal.classList.remove('open');
}

function checkNotesClose() {
    const editor = document.getElementById('notes-editor');
    const currentContent = editor.innerHTML;

    if (currentContent !== originalNotesContent) {
        // Вместо native confirm используем кастомную модалку
        document.getElementById('unsaved-modal').classList.add('open');
    } else {
        closeNotesForce();
    }
}

function closeUnsavedModal() {
    document.getElementById('unsaved-modal').classList.remove('open');
}

function confirmCloseNotes() {
    closeUnsavedModal();
    closeNotesForce();
}

function closeNotesForce() {
    document.getElementById('notes-modal').classList.remove('open');
}

function formatDoc(cmd, value = null) {
    if (value) {
        document.execCommand(cmd, false, value);
    } else {
        document.execCommand(cmd);
    }
    // Возвращаем фокус в редактор
    document.getElementById('notes-editor').focus();
}

function insertChecklist() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const text = selection.toString();

    // Разбиваем текст по строкам
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');

    if (lines.length === 0) {
        // Если ничего не выделено, просто вставляем пустой чекбокс
        const div = createChecklistItem('');
        range.deleteContents();
        range.insertNode(div);

        // Ставим курсор внутрь span
        const newRange = document.createRange();
        newRange.setStart(div.querySelector('span'), 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    } else {
        // Если выделено несколько строк
        const fragment = document.createDocumentFragment();
        lines.forEach(line => {
            fragment.appendChild(createChecklistItem(line));
        });
        range.deleteContents();
        range.insertNode(fragment);
    }

    document.getElementById('notes-editor').focus();
}

function createChecklistItem(text) {
    const div = document.createElement('div');
    div.className = 'checklist-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';

    const span = document.createElement('span');
    // Если текст пустой, добавляем неразрывный пробел, чтобы курсор мог встать
    span.textContent = text || '\u00A0';

    div.appendChild(checkbox);
    div.appendChild(span);
    return div;
}

function ensureAudioContext() {
    // Play silence to allow background media session on iOS
    const silence = document.getElementById('silence-loop');
    const mainAudio = document.getElementById('audio');
    if (mainAudio.paused && silence.paused) {
        silence.play().catch(() => { });
    }
}

// ========== START APP ==========
initializeApp();
