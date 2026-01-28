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
    // Prevent multiple instances (Singleton pattern)
    if (supabaseClient) return;

    try {
        if (window.supabase) {
            const supabaseUrl = 'https://jiovbimhoitawrtkqxmp.supabase.co';
            const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppb3ZiaW1ob2l0YXdydGtxeG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMDc4NzMsImV4cCI6MjA4MzU4Mzg3M30.5-sBNX4Z5HcmMClmaySgoDDT2IDw3swcyYLZo3GnMCM';
            supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
                auth: {
                    persistSession: true,
                    detectSessionInUrl: false, // Disable URL detection to prevent hash fragments issues on iOS
                    autoRefreshToken: true
                }
            });
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

// ========== MAGIC MIDNIGHT: AUTO-ROTATION ALGORITHM ==========
/**
 * Проверяет дату последнего запуска и выполняет ротацию задач при наступлении новых суток
 * Алгоритм "Midnight Magic" (Simplified)
 */
function checkAndRotateTasks() {
    try {
        const ROTATION_KEY = 'midnight_magic_last_date'; // New key for the new logic

        // Получаем текущую дату в формате YYYY-MM-DD (локальное время)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        console.log('🔮 MAGIC MIDNIGHT CHECK 🔮');
        console.log('Current Device Date:', todayStr);

        const lastRotationStr = localStorage.getItem(ROTATION_KEY);
        console.log('Last Saved Date:', lastRotationStr || 'NEVER');

        if (!lastRotationStr) {
            // Первый запуск новой логики - сохраняем и выходим
            console.log('First run (or migration). Setting baseline date.');
            localStorage.setItem(ROTATION_KEY, todayStr);
            return;
        }

        // ПРОВЕРКА: Если строки не совпадают - значит, наступил новый день
        if (todayStr !== lastRotationStr) {
            console.log('>>> MIDNIGHT CROSSED! Initiating Rotation... <<<');

            // 1. Выполняем ротацию
            rotateTasks();

            // 2. СРАЗУ обновляем дату, чтобы не сработало повторно
            localStorage.setItem(ROTATION_KEY, todayStr);
            console.log('Date updated to:', todayStr);

            // 3. Сохраняем состояние задач в LocalStorage / Supabase
            save();

            showToast('♻️ ЗАДАЧИ ПЕРЕНЕСЕНЫ НА СЕГОДНЯ');
        } else {
            console.log('Same day. No rotation needed.');
        }

    } catch (error) {
        console.error('CRITICAL ERROR in checkAndRotateTasks:', error);
    }
}

/**
 * Выполняет ротацию задач между контейнерами
 */
function rotateTasks() {
    // Разделяем задачи по контейнерам
    const todayTasks = tasks.filter(t => t.container_type === 'today');
    const tomorrowTasks = tasks.filter(t => t.container_type === 'tomorrow');
    const afterTomorrowTasks = tasks.filter(t => t.container_type === 'after_tomorrow');
    const otherTasks = tasks.filter(t => !['today', 'tomorrow', 'after_tomorrow'].includes(t.container_type));

    // Ротация:
    // 1. Невыполненные задачи из СЕГОДНЯ остаются в СЕГОДНЯ (накапливаются)
    const incompleteTodayTasks = todayTasks.filter(t => t.status !== 'completed');

    // 2. ЗАВТРА → СЕГОДНЯ (добавляются в конец списка СЕГОДНЯ)
    tomorrowTasks.forEach(t => {
        t.container_type = 'today';
    });

    // 3. ПОСЛЕЗАВТРА → ЗАВТРА
    afterTomorrowTasks.forEach(t => {
        t.container_type = 'tomorrow';
    });

    // 4. ПОСЛЕЗАВТРА становится пустым (задачи уже перемещены)

    // Пересобираем массив задач в правильном порядке:
    // СЕГОДНЯ (старые невыполненные) + СЕГОДНЯ (пришедшие из ЗАВТРА) + ЗАВТРА (пришедшие из ПОСЛЕЗАВТРА) + остальные
    tasks = [
        ...incompleteTodayTasks,
        ...tomorrowTasks,
        ...afterTomorrowTasks,
        ...otherTasks
    ];

    // Пересчитываем order_index
    tasks.forEach((t, idx) => {
        t.order_index = idx;
    });

    console.log(`Rotation summary:
        - Incomplete TODAY tasks: ${incompleteTodayTasks.length}
        - Tasks moved from TOMORROW to TODAY: ${tomorrowTasks.length}
        - Tasks moved from AFTER_TOMORROW to TOMORROW: ${afterTomorrowTasks.length}
        - AFTER_TOMORROW is now empty
    `);
}

// ========== APP INITIALIZATION ==========
async function initializeApp() {
    try {
        console.log('Initializing app...');

        // Initialize Supabase
        initSupabase();

        // CRITICAL FIX: Load tasks FIRST, then check rotation, then render
        // This ensures tasks are loaded before rotation algorithm runs

        // Check and rotate tasks if needed (MAGIC MIDNIGHT algorithm)
        // DISABLED BY USER REQUEST due to sync issues (2026-01-28)
        // checkAndRotateTasks();

        // Render UI AFTER rotation
        render();

        // Try to check auth state with timeout
        if (supabaseClient && !isOfflineMode) {
            const authPromise = supabaseClient.auth.getSession();

            // Set timeout for connection (10 seconds for mobile)
            connectionTimeout = setTimeout(() => {
                console.warn('Connection timeout - showing modal');
                showConnectionModal();
            }, 10000);

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
let newSelectedColor = 'grey';
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
    document.getElementById('app-ui').scrollTop = 0;

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

function prepareDelete(id) {
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

async function addTask() {
    const inp = document.getElementById('task-input');
    const val = inp.value.trim();
    if (!val) return;

    const newTask = {
        id: Date.now(),
        txt: val,
        status: prependMode ? 'active' : 'deferred', // If prepend mode: active, else: deferred
        container_type: prependMode ? 'today' : 'deferred', // NEW: Container type for 3-day planning
        color: prependMode ? newSelectedColor : 'grey', // Серый для отложенных задач
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

    // Сохранить значение prependMode перед сбросом
    const wasPrependMode = prependMode;

    // Выключить режим prepend после добавления задачи
    if (prependMode) {
        prependMode = false;
        document.getElementById('prepend-toggle').classList.remove('active');
    }

    save();
    render();

    // Sync to cloud if logged in
    if (currentUser) {
        // CRITICAL FIX: Upload the new task first
        await uploadTaskToCloud(newTask);

        // CRITICAL FIX: If prepend mode was used, sync ALL task orders to cloud
        // This ensures other devices receive the correct order_index for all tasks
        // EXCLUDE the newly added task to avoid duplicates (it was just uploaded above)
        if (wasPrependMode) {
            await updateTaskOrderInCloud(newTask.id);
        }
    }
}

async function uploadTaskToCloud(task) {
    if (!currentUser || !supabaseClient) return;
    // CRITICAL: NO showSyncIndicator() - it blocks drag-and-drop after adding task!

    try {
        const { data, error } = await supabaseClient
            .from('tasks')
            .insert({
                user_id: currentUser.id,
                title: task.txt,
                is_completed: task.status === 'completed',
                status: task.status || 'active',
                container_type: task.container_type || 'today', // NEW: Add container_type field
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

                // Update menu button for active/deferred tasks
                const menuBtn = domElement.querySelector('.btn-menu');
                if (menuBtn) {
                    menuBtn.setAttribute('onclick', `toggleTaskMenu('${newIdStr}', event)`);

                    // Update all menu items inside dropdown
                    const menuItems = domElement.querySelectorAll('.task-menu-dropdown .menu-item');
                    menuItems.forEach(item => {
                        const currentOnclick = item.getAttribute('onclick');
                        if (currentOnclick) {
                            // Replace old ID with new ID in all onclick handlers
                            const updatedOnclick = currentOnclick.replace(
                                new RegExp(`'${oldId}'`, 'g'),
                                `'${newIdStr}'`
                            );
                            item.setAttribute('onclick', updatedOnclick);
                        }
                    });
                }

                // Update edit/delete buttons for completed tasks
                const btnEdit = domElement.querySelector('.btn-edit');
                const btnDel = domElement.querySelector('.btn-del');
                if (btnEdit) btnEdit.setAttribute('onclick', `openEditModal('${newIdStr}')`);
                if (btnDel) btnDel.setAttribute('onclick', `prepareDelete('${newIdStr}')`);
            }

            save();
        }
    } catch (error) {
        console.error('Upload Error:', error);
    }
    // CRITICAL: NO hideSyncIndicator() - sync is non-blocking
}

// ========== UPDATE TASK IN CLOUD ==========
async function updateTaskInCloud(taskId, updates) {
    if (!currentUser || !supabaseClient) return;

    try {
        console.log('Updating task in cloud:', taskId, updates);

        const { error } = await supabaseClient
            .from('tasks')
            .update(updates)
            .eq('id', taskId)
            .eq('user_id', currentUser.id); // CRITICAL: RLS policy requires user_id check

        if (error) {
            console.error('Update task error:', error);
            throw error;
        }

        console.log('✓ Task updated in cloud successfully');
    } catch (error) {
        console.error('updateTaskInCloud error:', error);
    }
}

// ========== UPDATE TASK ORDER IN CLOUD ==========
async function updateTaskOrderInCloud(excludeTaskId = null) {
    if (!currentUser || !supabaseClient) return;

    try {
        console.log('Updating task order in cloud...');

        // Update order_index and container_type for all tasks
        const updates = tasks
            .filter(t => excludeTaskId ? String(t.id) !== String(excludeTaskId) : true)
            .map(t => ({
                id: t.id,
                order_index: t.order_index,
                container_type: t.container_type,
                status: t.status
            }));

        // Update each task individually (batch update doesn't work well with RLS)
        for (const update of updates) {
            await supabaseClient
                .from('tasks')
                .update({
                    order_index: update.order_index,
                    container_type: update.container_type,
                    status: update.status
                })
                .eq('id', update.id)
                .eq('user_id', currentUser.id);
        }

        console.log(`✓ Updated ${updates.length} tasks order in cloud`);
    } catch (error) {
        console.error('updateTaskOrderInCloud error:', error);
    }
}

// ========== DELETE TASK FROM CLOUD ==========
async function deleteTaskFromCloud(taskId) {
    if (!currentUser || !supabaseClient) return;

    try {
        console.log('Deleting task from cloud:', taskId);

        const { error } = await supabaseClient
            .from('tasks')
            .update({ is_deleted: true })
            .eq('id', taskId)
            .eq('user_id', currentUser.id); // CRITICAL: RLS policy requires user_id check

        if (error) {
            console.error('Delete task error:', error);
            throw error;
        }

        console.log('✓ Task deleted from cloud successfully');
    } catch (error) {
        console.error('deleteTaskFromCloud error:', error);
    }
}

function toggle(id) {
    const t = tasks.find(x => String(x.id) === String(id));
    if (t) {
        // Cycle through statuses: active → completed, deferred → completed, completed → today
        if (t.status === 'active' || t.status === 'deferred') {
            t.status = 'completed';
            t.container_type = 'archived';
        } else {
            t.status = 'active';
            t.container_type = 'today'; // Return to TODAY container
        }

        playSfx('click');
        save();
        render();

        // Sync to cloud if logged in
        if (currentUser) {
            updateTaskInCloud(id, { status: t.status, container_type: t.container_type });
        }
    }
}

/**
 * Перемещает задачу в начало списка текущего контейнера
 */
async function moveToTop(id) {
    const taskIndex = tasks.findIndex(x => String(x.id) === String(id));
    if (taskIndex === -1) return;

    const task = tasks[taskIndex];
    const currentContainer = task.container_type;

    // Проверяем, что задача в одном из трех контейнеров планирования
    if (!['today', 'tomorrow', 'after_tomorrow'].includes(currentContainer)) return;

    // Находим индекс первой задачи в том же контейнере
    const firstInContainerIndex = tasks.findIndex(t => t.container_type === currentContainer);
    if (firstInContainerIndex === -1 || taskIndex === firstInContainerIndex) return;

    // Удаляем задачу из текущей позиции
    tasks.splice(taskIndex, 1);

    // Вставляем задачу в начало списка того же контейнера
    tasks.splice(firstInContainerIndex, 0, task);

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

    // Меняем статус на 'deferred', container_type на 'deferred' и цвет на серый
    task.status = 'deferred';
    task.container_type = 'deferred';
    task.color = 'grey';

    playSfx('click');
    save();
    render();

    // Синхронизация с облаком, если пользователь залогинен
    if (currentUser) {
        await updateTaskInCloud(id, { status: 'deferred', container_type: 'deferred', color: 'grey' });
    }
}

/**
 * Перемещает задачу из отложенных в начало списка СЕГОДНЯ
 */
async function moveToToday(id) {
    const taskIndex = tasks.findIndex(x => String(x.id) === String(id));
    if (taskIndex === -1) return;

    const task = tasks[taskIndex];

    // Меняем статус на 'active' и контейнер на 'today'
    task.status = 'active';
    task.container_type = 'today';

    // Удаляем задачу из текущей позиции
    tasks.splice(taskIndex, 1);

    // Находим индекс первой задачи в контейнере СЕГОДНЯ
    const firstTodayIndex = tasks.findIndex(t => t.container_type === 'today');

    // Вставляем задачу в начало списка СЕГОДНЯ
    if (firstTodayIndex !== -1) {
        tasks.splice(firstTodayIndex, 0, task);
    } else {
        // Нет задач в СЕГОДНЯ, добавляем в начало массива
        tasks.unshift(task);
    }

    // Пересчитываем order_index для всех задач
    tasks.forEach((t, idx) => {
        t.order_index = idx;
    });

    playSfx('click');
    save();
    render();

    // Синхронизация с облаком, если пользователь залогинен
    if (currentUser) {
        await updateTaskInCloud(id, { status: 'active', container_type: 'today' });
        await updateTaskOrderInCloud();
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


function addSeparator() {
    // 1. Find the last separator date
    const tomorrowTasks = tasks.filter(t => t.container_type === 'tomorrow' || t.container_type === 'after_tomorrow');
    let lastDate = new Date(); // Start from today

    // Regex to extract date from separator "--- 29.01.2026 ---"
    const dateRegex = /(\d{2})\.(\d{2})\.(\d{4})/;

    // Find the last separator task in the list
    let lastSeparatorIndex = -1;
    for (let i = tomorrowTasks.length - 1; i >= 0; i--) {
        if (tomorrowTasks[i].txt.startsWith('---')) {
            const match = tomorrowTasks[i].txt.match(dateRegex);
            if (match) {
                // Parse date: DD.MM.YYYY
                const day = parseInt(match[1]);
                const month = parseInt(match[2]) - 1; // Months are 0-indexed
                const year = parseInt(match[3]);
                lastDate = new Date(year, month, day);
                lastSeparatorIndex = i;
                break;
            }
        }
    }

    // 2. Increment date by 1 day
    lastDate.setDate(lastDate.getDate() + 1);

    const d = String(lastDate.getDate()).padStart(2, '0');
    const m = String(lastDate.getMonth() + 1).padStart(2, '0');
    const y = lastDate.getFullYear();
    const newDateStr = `${d}.${m}.${y}`;

    const separatorText = `--- ${newDateStr} ---`;

    // 3. Create separator task
    const newTask = {
        id: Date.now(),
        txt: separatorText,
        status: 'active',
        container_type: 'tomorrow', // Everything goes to 'Plans' now
        color: 'grey',
        order_index: tasks.length,
        created_at: Date.now()
    };

    tasks.push(newTask);
    save();
    render();
    if (currentUser) uploadTaskToCloud(newTask);
}

function deleteSeparator(id) {
    if (confirm("Удалить этот разделитель дня? Задачи под ним останутся.")) {
        tasks = tasks.filter(t => String(t.id) !== String(id));
        save();
        render();
        if (currentUser) deleteTaskFromCloud(id);
    }
}

function restoreTask(id) {
    const taskIndex = tasks.findIndex(x => String(x.id) === String(id));
    if (taskIndex === -1) return;

    const task = tasks[taskIndex];
    task.status = 'active';
    task.container_type = 'today';

    // Remove from current position
    tasks.splice(taskIndex, 1);

    // Insert at the VERY BEGINNING of the list (Top of Today)
    tasks.unshift(task);

    // Re-calculate order_index for all tasks
    tasks.forEach((t, idx) => {
        t.order_index = idx;
    });

    playSfx('click');
    save();
    render();

    if (currentUser) {
        updateTaskInCloud(id, { status: task.status, container_type: task.container_type });
        updateTaskOrderInCloud(); // Start background reorder since we moved it to top
    }
}


function toggleSeparatorLock(id) {
    const task = tasks.find(t => String(t.id) === String(id));
    if (task) {
        if (task.txt.includes('[LOCKED]')) {
            task.txt = task.txt.replace(' [LOCKED]', '').replace('[LOCKED]', '').trim();
            task.is_locked = false;
        } else {
            task.txt = task.txt + ' [LOCKED]';
            task.is_locked = true;
        }

        playSfx('click');
        save();
        render();

        // Sync to cloud
        if (currentUser) {
            updateTaskInCloud(id, { title: task.txt });
        }
    }
}

function deleteSeparator(id) {
    if (confirm('Удалить этот разделитель и объединить задачи?')) {
        const taskIndex = tasks.findIndex(t => String(t.id) === String(id));
        if (taskIndex > -1) {
            tasks.splice(taskIndex, 1);
            save();
            render();

            if (currentUser) {
                // Determine logic for deletion in cloud
                // For now, simple soft delete or hard delete
                const task = tasks[taskIndex]; // wait, we just spliced it. 
                // We should have captured it before splicing if we check id.
                // Actually updateTaskInCloud works by ID, so... 
                // But we need to call a delete function.
                // Assuming standard sync handles deletion if we remove from local? 
                // No, current logic requires explicit delete call usually.
                // Let's stick to local visual logic for now or call a delete helper if exists.
                // Given the context, we just remove it from array.
                // Sync might need 'is_deleted' flag.

                // Let's just trigger a reorder sync which might be enough if we had diffing, 
                // but we might need to send a delete command. 
                // For safety, I'll add a direct delete call via supabase if client exists.
                supabaseClient.from('tasks').update({ is_deleted: true }).eq('id', id).then();
            }
        }
    }
}

function render() {
    const todayList = document.getElementById('today-list');
    const tomorrowList = document.getElementById('tomorrow-list');
    // const afterTomorrowList = document.getElementById('after-tomorrow-list'); // REMOVED
    const def = document.getElementById('deferred-list');
    const com = document.getElementById('completed-list');

    // PERFORMANCE: Use DocumentFragment instead of innerHTML in loop
    const todayFragment = document.createDocumentFragment();
    const tomorrowFragment = document.createDocumentFragment();
    // const afterTomorrowFragment = document.createDocumentFragment(); // REMOVED
    const defFragment = document.createDocumentFragment();
    const comFragment = document.createDocumentFragment();

    // Migrate old tasks: convert 'done' field to 'status' field and add container_type
    tasks.forEach(t => {
        // Migrate old 'done' field to 'status'
        if (t.status === undefined) {
            if (t.done === true) {
                t.status = 'completed';
            } else {
                t.status = 'active';
            }
            delete t.done;
        }

        // Migrate tasks without container_type
        if (t.container_type === undefined) {
            if (t.status === 'completed') {
                t.container_type = 'archived';
            } else if (t.status === 'deferred') {
                t.container_type = 'deferred';
            } else if (t.status === 'active') {
                t.container_type = 'today'; // Default all active tasks to 'today'
            } else {
                t.container_type = 'today';
            }
        }

        // STREAM MODE MIGRATION: Move 'after_tomorrow' to 'tomorrow'
        if (t.container_type === 'after_tomorrow') {
            t.container_type = 'tomorrow';
        }
    });

    // Separate tasks by container_type
    const todayTasks = tasks.filter(t => t.container_type === 'today');
    const tomorrowTasks = tasks.filter(t => t.container_type === 'tomorrow');
    // const afterTomorrowTasks = tasks.filter(t => t.container_type === 'after_tomorrow'); // REMOVED
    const deferredTasks = tasks.filter(t => t.container_type === 'deferred');
    const completedTasks = tasks.filter(t => t.status === 'completed' || t.container_type === 'archived');

    // Sort deferred tasks by age (oldest first)
    deferredTasks.sort((a, b) => {
        const ageA = a.created_at || 0;
        const ageB = b.created_at || 0;
        return ageA - ageB; // Oldest first (smallest timestamp first)
    });

    // --- SMART COUNTERS PRE-CALCULATION FOR Separators ---
    // Map<SeparatorID, {red: 0, yellow: 0, green: 0}>
    const separatorCounts = {};
    let currentSeparatorId = null;

    tomorrowTasks.forEach(t => {
        if (t.txt.startsWith('---')) {
            currentSeparatorId = t.id;
            separatorCounts[currentSeparatorId] = { red: 0, yellow: 0, green: 0 };
        } else if (currentSeparatorId) {
            // It's a task under a separator
            if (t.color === 'red') separatorCounts[currentSeparatorId].red++;
            else if (t.color === 'yellow') separatorCounts[currentSeparatorId].yellow++;
            else if (t.color === 'green') separatorCounts[currentSeparatorId].green++;
        }
    });
    // -----------------------------------------------------

    // Render function for a single task
    const renderTask = (t) => {
        const taskIdStr = String(t.id);

        // --- SEPARATOR TASK RENDER ---
        // --- SEPARATOR TASK RENDER ---
        if (t.txt.startsWith('---')) {
            const li = document.createElement('li');
            li.className = 'separator-task';
            li.dataset.id = t.id;

            // Handle Locked State (Parse from TXT for persistence)
            const isLocked = t.txt.includes('[LOCKED]');
            t.is_locked = isLocked; // Keep runtime sync

            if (isLocked) {
                li.classList.add('locked');
            }

            // Logic for Lock Icon
            const lockIcon = isLocked
                ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="var(--color-red)"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`
                : `<svg viewBox="0 0 24 24" width="16" height="16" fill="#666"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>`;

            // Get counts or default to 0
            const counts = separatorCounts[taskIdStr] || { red: 0, yellow: 0, green: 0 };

            // Format: "--- 29.01.2026 --- ( 🔴 1 | 🟡 3 | 🟢 0 )"
            // We strip the "---" AND "[LOCKED]" to show clean date and then reconstruct
            const coreText = t.txt.replace(/---/g, '').replace(/\[LOCKED\]/g, '').trim();

            li.innerHTML = `
                <span>${coreText}</span>
                <div class="separator-counters">
                   <div class="sep-count"><div class="sep-dot" style="background:var(--color-red)"></div><span class="sep-val">${counts.red}</span></div>
                   <div class="sep-count"><div class="sep-dot" style="background:var(--color-yellow)"></div><span class="sep-val">${counts.yellow}</span></div>
                   <div class="sep-count"><div class="sep-dot" style="background:var(--color-green)"></div><span class="sep-val">${counts.green}</span></div>
                </div>
                <div class="separator-controls">
                    <button class="separator-lock-btn" onclick="toggleSeparatorLock('${taskIdStr}')" title="${isLocked ? 'Разблокировать' : 'Заблокировать'}">
                        ${lockIcon}
                    </button>
                    <button class="separator-delete-btn" onclick="deleteSeparator('${taskIdStr}')" title="Удалить разделитель">×</button>
                </div>
            `;
            return li;
        }
        // -----------------------------

        const li = document.createElement('li');
        const colorClass = t.color ? 'border-' + t.color : 'border-red';
        li.className = `task-item ${t.status === 'completed' ? 'completed' : ''} ${colorClass}`;
        li.dataset.id = t.id;

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
            <span class="task-text" id="task-text-${taskIdStr}">${escapeHtml(t.txt)}</span>
            ${t.status !== 'completed' ? `
                ${ageIndicator}
                <button class="btn-menu" onclick="toggleTaskMenu('${taskIdStr}', event)" title="Меню">
                    <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="2"/>
                        <circle cx="12" cy="12" r="2"/>
                        <circle cx="12" cy="19" r="2"/>
                    </svg>
                </button>
                <div class="task-menu-dropdown" id="menu-${taskIdStr}">
                    ${t.container_type === 'today' || t.container_type === 'tomorrow' ? `
                        <button class="menu-item" onclick="moveToTop('${taskIdStr}'); closeAllTaskMenus();" title="Переместить в начало">
                            <span class="menu-icon">▲</span>
                            <span class="menu-label">ВВЕРХ</span>
                        </button>
                        <button class="menu-item" onclick="openEditModal('${taskIdStr}'); closeAllTaskMenus();" title="Редактировать">
                            <span class="menu-icon">✎</span>
                            <span class="menu-label">РЕДАКТИРОВАТЬ</span>
                        </button>
                        <button class="menu-item" onclick="moveToDeferred('${taskIdStr}'); closeAllTaskMenus();" title="Отложить">
                            <span class="menu-icon">⏳</span>
                            <span class="menu-label">ОТЛОЖИТЬ</span>
                        </button>
                    ` : `
                        <button class="menu-item" onclick="restoreTask('${taskIdStr}'); closeAllTaskMenus();" title="Вернуть">
                            <span class="menu-icon">↺</span>
                            <span class="menu-label">ВЕРНУТЬ</span>
                        </button>
                    `}
                    ${t.container_type === 'today' ? `
                        <button class="menu-item" onclick="moveTaskToContainer('${taskIdStr}', 'tomorrow'); closeAllTaskMenus();" title="Перенести в Планы">
                            <span class="menu-icon">→</span>
                            <span class="menu-label">В ПЛАНЫ</span>
                        </button>
                    ` : ''}
                    ${t.container_type === 'tomorrow' ? `
                        <button class="menu-item" onclick="moveTaskToContainer('${taskIdStr}', 'today'); closeAllTaskMenus();" title="Перенести в Сегодня">
                            <span class="menu-icon">←</span>
                            <span class="menu-label">В СЕГОДНЯ</span>
                        </button>
                    ` : ''}
                    <button class="menu-item delete" onclick="prepareDelete('${taskIdStr}'); closeAllTaskMenus();" title="Удалить">
                        <span class="menu-icon">🗑</span>
                        <span class="menu-label">УДАЛИТЬ</span>
                    </button>
                </div>
            ` : `
                 <button class="btn-del" onclick="prepareDelete('${taskIdStr}')" title="Удалить">🗑</button>
            `}
        `;

        // ATTACH POPUP LISTENERS
        const span = li.querySelector('.task-text');
        if (span) {
            const fullTxt = t.txt;

            const isTruncated = (el) => {
                return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
            };

            // Desktop (only attach if device supports hover)
            if (window.matchMedia('(hover: hover)').matches) {
                span.addEventListener('mouseenter', (e) => {
                    if (isTruncated(e.target)) {
                        showTaskPopup(e, fullTxt);
                    }
                });
                span.addEventListener('mouseleave', hideTaskPopup);
                span.addEventListener('mousemove', (e) => updatePopupPosition(e));
            }

            // Mobile / Click (Universally supported)
            span.addEventListener('click', (e) => {
                // If truncated, show popup. 
                if (isTruncated(e.target)) {
                    e.preventDefault(); // Prevent phantom clicks/interactions
                    e.stopPropagation();
                    showTaskPopup(e, fullTxt, true);
                }
                // If not truncated, DO NOTHING
            });
        }

        return li;
    };

    // Render all tasks
    // Render all tasks
    todayTasks.forEach(t => todayFragment.appendChild(renderTask(t)));
    tomorrowTasks.forEach(t => tomorrowFragment.appendChild(renderTask(t)));
    deferredTasks.forEach(t => defFragment.appendChild(renderTask(t)));
    completedTasks.forEach(t => comFragment.appendChild(renderTask(t)));

    // Single DOM write per list (MUCH faster)
    todayList.innerHTML = '';
    tomorrowList.innerHTML = '';
    def.innerHTML = '';
    com.innerHTML = '';
    todayList.appendChild(todayFragment);
    tomorrowList.appendChild(tomorrowFragment);
    def.appendChild(defFragment);
    com.appendChild(comFragment);

    // Update task counters
    updateCounters();
}

/**
 * Обновляет счетчики задач для каждого временного контейнера
 * Подсчитывает количество красных, желтых и зеленых задач
 */
function updateCounters() {
    // Определяем контейнеры для подсчета
    const containers = [
        { type: 'today', prefix: 'counter-today' },
        { type: 'tomorrow', prefix: 'counter-tomorrow' }
    ];

    containers.forEach(container => {
        // Фильтруем задачи по контейнеру
        let containerTasks = tasks.filter(t => t.container_type === container.type);

        // FIX: For PLANS (tomorrow), only count tasks BEFORE the first separator
        // This ensures the header counters only reflect "Immediate Plans" (not dated ones)
        if (container.type === 'tomorrow') {
            const separatorIndex = containerTasks.findIndex(t => t.txt.startsWith('---'));
            if (separatorIndex !== -1) {
                containerTasks = containerTasks.slice(0, separatorIndex);
            }
        }

        // Подсчитываем задачи по цветам
        const redCount = containerTasks.filter(t => t.color === 'red').length;
        const yellowCount = containerTasks.filter(t => t.color === 'yellow').length;
        const greenCount = containerTasks.filter(t => t.color === 'green').length;

        // Обновляем DOM-элементы
        const redEl = document.getElementById(`${container.prefix}-red`);
        const yellowEl = document.getElementById(`${container.prefix}-yellow`);
        const greenEl = document.getElementById(`${container.prefix}-green`);

        if (redEl) {
            redEl.textContent = redCount;
            redEl.classList.toggle('zero', redCount === 0);
        }

        if (yellowEl) {
            yellowEl.textContent = yellowCount;
            yellowEl.classList.toggle('zero', yellowCount === 0);
        }

        if (greenEl) {
            greenEl.textContent = greenCount;
            greenEl.classList.toggle('zero', greenCount === 0);
        }
    });
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
// Flag to prevent concurrent order updates
let isUpdatingOrder = false;
// Flag to track if we need to update after current request completes
let hasPendingUpdate = false;


function initDrag() {
    if (typeof Sortable !== 'undefined') {
        const opts = {
            group: 'tasks', // Allow dragging between all five lists
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
            touchStartThreshold: 15, // BUGFIX: Increased to 15 to prevent micro-movements when clicking menu
            filter: '.checkbox, .btn-menu, .task-menu-dropdown, .separator-task.locked', // BUGFIX: Exclude checkbox, menu button and dropdown from drag
            preventOnFilter: false, // Allow clicks on filtered elements
            onEnd: (evt) => {
                // Determine which list the task was dropped into
                const targetListId = evt.to.id;
                const taskId = evt.item.dataset.id;
                const task = tasks.find(t => String(t.id) === String(taskId));

                if (task) {
                    // Update task status and container_type based on target list
                    if (targetListId === 'today-list') {
                        task.status = 'active';
                        task.container_type = 'today';
                    } else if (targetListId === 'tomorrow-list') {
                        task.status = 'active';
                        task.container_type = 'tomorrow';
                    } else if (targetListId === 'deferred-list') {
                        task.status = 'deferred';
                        task.container_type = 'deferred';
                    } else if (targetListId === 'completed-list') {
                        task.status = 'completed';
                        task.container_type = 'archived';
                    }
                }

                // Rebuild tasks array from DOM order
                // CRITICAL FIX: Include .separator-task to prevent them from vanishing!
                const newOrder = [];
                // We must query ALL potential task elements across ALL lists to maintain complete state
                // However, Sortable only reorders within the container or between containers.
                // Safest approach: Iterate over all known lists in the DOM and reconstruct the full array

                const lists = ['today-list', 'tomorrow-list', 'deferred-list', 'completed-list'];

                lists.forEach(listId => {
                    const listEl = document.getElementById(listId);
                    if (!listEl) return;

                    listEl.querySelectorAll('.task-item, .separator-task').forEach(el => {
                        const found = tasks.find(t => String(t.id) === String(el.dataset.id));
                        if (found) newOrder.push(found);
                    });
                });

                // Check for lost tasks (e.g. from lists not currently in DOM? unlikely in this app structure)
                // But just in case, find any tasks that were NOT in the DOM (shouldn't happen if render is correct)
                // const lostTasks = tasks.filter(t => !newOrder.includes(t));
                // if (lostTasks.length > 0) newOrder.push(...lostTasks);

                tasks = newOrder;

                // Update order_index for all tasks
                tasks.forEach((task, index) => {
                    task.order_index = index;
                });

                // INSTANT local save
                save();

                // Re-render to update counters and ensure strict DOM state
                render();

                // DEBOUNCED cloud sync: Wait 2 seconds after user stops dragging
                // This prevents sending updates while user is still moving the task
                // CRITICAL FIX: Update ALL tasks order, not just one task
                if (currentUser) {
                    clearTimeout(dragDebounceTimer);
                    dragDebounceTimer = setTimeout(() => {
                        console.log('Syncing ALL tasks order after drag-and-drop');
                        updateTaskOrderInCloud(); // Update all tasks to sync order across devices
                    }, 1000); // 1 second delay after user stops dragging
                }
            }
        };

        Sortable.create(document.getElementById('today-list'), opts);
        Sortable.create(document.getElementById('tomorrow-list'), opts);
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

// ========== NETWORK UTILITIES ==========
/**
 * Retry function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} - Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            const isLastAttempt = i === maxRetries - 1;
            const isNetworkError = error.message.includes('Load failed') ||
                error.message.includes('TIMEOUT') ||
                error.message.includes('Failed to fetch') ||
                error.message.includes('NetworkError') ||
                error.name === 'TypeError';

            if (isLastAttempt || !isNetworkError) {
                throw error;
            }

            // Exponential backoff: 1s, 2s, 4s
            const delay = baseDelay * Math.pow(2, i);
            console.log(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms for error:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Check if browser is online
 * @returns {boolean}
 */
function isOnline() {
    return navigator.onLine;
}

/**
 * Wait for online connection with timeout
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise<boolean>} - True if online, false if timeout
 */
async function waitForOnline(timeout = 30000) {
    if (isOnline()) return true;

    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            window.removeEventListener('online', onlineHandler);
            resolve(false);
        }, timeout);

        const onlineHandler = () => {
            clearTimeout(timeoutId);
            window.removeEventListener('online', onlineHandler);
            resolve(true);
        };

        window.addEventListener('online', onlineHandler);
    });
}

// ========== LOGIN HANDLER ==========
async function handleLogin() {
    if (!currentUser) return;

    // Check network connection first
    if (!isOnline()) {
        showToast('НЕТ ПОДКЛЮЧЕНИЯ К СЕТИ');
        const online = await waitForOnline();
        if (!online) {
            showToast('РАБОТА В АВТОНОМНОМ РЕЖИМЕ');
            updateAuthUI();
            return;
        }
        showToast('ПОДКЛЮЧЕНИЕ ВОССТАНОВЛЕНО');
    }

    try {
        // SEQUENTIAL SYNC: Tasks first (higher priority)
        console.log('Starting task synchronization...');
        await retryWithBackoff(async () => {
            const taskSyncTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('TASK_SYNC_TIMEOUT')), 30000) // Increased to 30s
            );
            return await Promise.race([syncTasksOnLogin(), taskSyncTimeout]);
        }, 3, 1000);

        // SEQUENTIAL SYNC: Notes second
        console.log('Starting notes synchronization...');
        await retryWithBackoff(async () => {
            const notesSyncTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('NOTES_SYNC_TIMEOUT')), 30000) // Increased to 30s
            );
            return await Promise.race([syncNotesOnLogin(), notesSyncTimeout]);
        }, 3, 1000);

        // Only subscribe to realtime after successful sync
        console.log('Subscribing to realtime updates...');
        subscribeToTasks();
        subscribeToNotes();

        updateAuthUI();
    } catch (error) {
        console.error('Login sync error:', error);

        // User-friendly error messages
        if (error.message.includes('TIMEOUT')) {
            showToast('СИНХРОНИЗАЦИЯ: ПРЕВЫШЕНО ВРЕМЯ ОЖИДАНИЯ');
        } else if (error.message.includes('Load failed') || error.message.includes('Failed to fetch')) {
            showToast('ОШИБКА СЕТИ: РАБОТА В АВТОНОМНОМ РЕЖИМЕ');
        } else {
            showToast('ОШИБКА СИНХРОНИЗАЦИИ: РАБОТА В АВТОНОМНОМ РЕЖИМЕ');
        }

        hideSyncIndicator();
        updateAuthUI();
        // App continues to work with local data
    }
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
        const convertedCloudTasks = (cloudTasks || []).map(ct => {
            // Support new 'status' field with backward compatibility
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
                status: status, // Use status instead of done
                container_type: ct.container_type || (status === 'completed' ? 'archived' : 'today'), // NEW: Load container_type
                color: ct.color || 'red',
                order_index: ct.order_index || 0,
                created_at: ct.created_at ? new Date(ct.created_at).getTime() : Date.now()
            };
        });

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
                status: task.status || 'active', // Use status field
                is_completed: task.status === 'completed', // Derive from status for backward compatibility
                color: task.color || 'red',
                order_index: task.order_index || 0
            });

        if (error) throw error;
    } catch (error) {
        console.error('Upload Task Error:', error);
    }
}

async function updateTaskOrderInCloud(excludeTaskId = null) {
    if (!currentUser || !supabaseClient) return;
    // CRITICAL: NO showSyncIndicator() here - it blocks drag-and-drop!
    // Sync happens silently in background

    // Quick network check - fail fast if offline
    if (!isOnline()) {
        console.log('Skipping order update: offline');
        return;
    }

    // CRITICAL: Prevent concurrent updates - mark as pending if already updating
    if (isUpdatingOrder) {
        console.log('Skipping order update: already in progress, marking as pending');
        hasPendingUpdate = true; // Mark that we need to update after current request
        return;
    }

    // Set flag to prevent concurrent updates
    isUpdatingOrder = true;
    hasPendingUpdate = false; // Clear pending flag as we're processing now

    try {
        // CRITICAL FIX: Filter out the excluded task (newly added) to avoid duplicates
        const tasksToUpdate = excludeTaskId
            ? tasks.filter(t => String(t.id) !== String(excludeTaskId))
            : tasks;

        console.log(`Updating order for ${tasksToUpdate.length} tasks (excluding: ${excludeTaskId || 'none'})`);

        // PERFORMANCE OPTIMIZATION: Batch update using upsert instead of loop
        // This reduces N sequential requests to 1 batch request
        const updates = tasksToUpdate.map(task => ({
            id: task.id,
            user_id: currentUser.id,
            order_index: task.order_index,
            status: task.status || 'active',
            container_type: task.container_type || 'today', // CRITICAL: Save container type
            is_completed: task.status === 'completed',
            title: task.txt,
            color: task.color || 'red',
            created_at: task.created_at ? new Date(task.created_at).toISOString() : new Date().toISOString()
        }));

        // Set a reasonable timeout for batch update (10 seconds)
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('BATCH_UPDATE_TIMEOUT')), 10000)
        );

        const updatePromise = supabaseClient
            .from('tasks')
            .upsert(updates, {
                onConflict: 'id',
                ignoreDuplicates: false
            });

        const { error } = await Promise.race([updatePromise, timeoutPromise]);

        if (error) throw error;

        console.log('Batch order update complete');
    } catch (error) {
        // Silently log errors - don't show toast on background sync errors
        // Don't retry - this is a background operation
        console.error('Update Order Error:', error.message || error);

        // If it's a network error, the next drag-and-drop will retry naturally
        if (error.message === 'BATCH_UPDATE_TIMEOUT') {
            console.warn('Batch update timed out - will retry on next change');
        }
    } finally {
        // CRITICAL: Always reset flag, even if error occurred
        isUpdatingOrder = false;

        // CRITICAL: If there was a pending update while we were processing, trigger it now
        if (hasPendingUpdate) {
            console.log('Processing pending update...');
            hasPendingUpdate = false;
            // Use setTimeout to avoid blocking and allow UI to update
            setTimeout(() => updateTaskOrderInCloud(excludeTaskId), 100);
        }
    }
    // CRITICAL: NO hideSyncIndicator() here - sync is non-blocking
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
// NOTE: This section header is kept for code organization.
// The actual syncTasksOnLogin() function is defined above (lines ~1808-1857).
// The duplicate function that was here has been removed to fix task duplication bug.

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
    if (!currentUser || !supabaseClient) {
        console.log('subscribeToTasks skipped:', { currentUser: !!currentUser, supabaseClient: !!supabaseClient });
        return;
    }

    // CRITICAL FIX: Unsubscribe from old channel before creating new one
    if (realtimeChannel) {
        console.log('Unsubscribing from old realtime channel...');
        supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
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
        .subscribe((status, err) => {
            console.log('Realtime subscription status:', status);

            if (status === 'CHANNEL_ERROR') {
                console.error('Realtime channel error:', err);
                // Don't auto-reconnect immediately - let Supabase handle it
                // User can manually refresh if needed
            } else if (status === 'SUBSCRIBED') {
                console.log('Successfully subscribed to task updates');
            } else if (status === 'CLOSED') {
                console.log('Realtime channel closed');
            }
        });
}

function subscribeToNotes() {
    if (!currentUser || !supabaseClient) {
        console.log('subscribeToNotes skipped:', { currentUser: !!currentUser, supabaseClient: !!supabaseClient });
        return;
    }

    // CRITICAL FIX: Unsubscribe from old channel before creating new one
    if (notesRealtimeChannel) {
        console.log('Unsubscribing from old notes realtime channel...');
        supabaseClient.removeChannel(notesRealtimeChannel);
        notesRealtimeChannel = null;
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
        .subscribe((status, err) => {
            console.log('Notes Realtime subscription status:', status);

            if (status === 'CHANNEL_ERROR') {
                console.error('Notes realtime channel error:', err);
                // Don't auto-reconnect immediately - let Supabase handle it
            } else if (status === 'SUBSCRIBED') {
                console.log('Successfully subscribed to notes updates');
            } else if (status === 'CLOSED') {
                console.log('Notes realtime channel closed');
            }
        });
}

// ========== HTTP POLLING FALLBACK ==========
function startHTTPPolling() {
    // Останавливаем предыдущий polling если был
    stopHTTPPolling();

    console.log('🔄 Starting HTTP polling fallback (WebSocket unavailable)');
    showToast('РЕЖИМ СОВМЕСТИМОСТИ: HTTP SYNC');

    // Немедленная первая проверка
    pollTasksFromCloud();

    // Затем регулярные проверки каждые 3 секунды
    pollingInterval = setInterval(() => {
        pollTasksFromCloud();
    }, POLLING_INTERVAL_MS);
}

function stopHTTPPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('⏹️ HTTP polling stopped');
    }
}

async function pollTasksFromCloud() {
    if (!currentUser || !supabaseClient) return;

    try {
        // Получаем timestamp последнего обновления из облака
        const { data: cloudTasks, error } = await supabaseClient
            .from('tasks')
            .select('updated_at')
            .eq('user_id', currentUser.id)
            .eq('is_deleted', false)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (error) throw error;

        if (cloudTasks && cloudTasks.length > 0) {
            const cloudTimestamp = new Date(cloudTasks[0].updated_at).getTime();

            // Если есть изменения - синхронизируем
            if (cloudTimestamp > lastSyncTimestamp) {
                console.log('📥 Changes detected via polling, syncing...');
                await syncTasksOnLogin();
                lastSyncTimestamp = cloudTimestamp;
            }
        }
    } catch (error) {
        console.error('Polling error:', error);
        // Не показываем toast - это фоновая операция
    }
}

function handleRealtimeError(error, context) {
    realtimeFailureCount++;
    console.error(`Realtime error #${realtimeFailureCount} in ${context}:`, error);

    if (realtimeFailureCount >= MAX_REALTIME_FAILURES) {
        console.warn('⚠️ Too many Realtime failures, switching to HTTP polling');
        isRealtimeWorking = false;

        // Отписываемся от проблемного канала
        if (realtimeChannel) {
            supabaseClient.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }

        // Переключаемся на HTTP polling
        startHTTPPolling();
    }
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
            // Convert cloud task to local format with status field
            let status = 'active'; // default
            if (newRecord.status) {
                // New format: use status field directly
                status = newRecord.status;
            } else if (newRecord.is_completed) {
                // Old format: fall back to is_completed
                status = 'completed';
            }

            const newTask = {
                id: newRecord.id,
                txt: newRecord.title,
                status: status, // Use status instead of done
                container_type: newRecord.container_type || (status === 'completed' ? 'archived' : 'today'), // NEW: Load container_type
                color: newRecord.color || 'red',
                order_index: newRecord.order_index || 0,
                created_at: newRecord.created_at ? new Date(newRecord.created_at).getTime() : Date.now()
            };

            // CRITICAL FIX: Check by ID AND by content to prevent duplicates during race condition
            // Race condition: task uploaded to cloud, INSERT event arrives before local ID is updated
            const existingTaskById = tasks.find(t => String(t.id) === String(newTask.id));

            // Also check by text + created_at to catch tasks that haven't had their ID updated yet
            const existingTaskByContent = tasks.find(t =>
                t.txt === newTask.txt &&
                Math.abs(t.created_at - newTask.created_at) < 2000 // Within 2 seconds
            );

            if (!existingTaskById && !existingTaskByContent) {
                console.log('Adding new task from cloud:', newTask);
                tasks.push(newTask);

                // Remove duplicates and sort
                tasks = removeDuplicateTasks(tasks);
                tasks.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

                save();
                render();
                showToast('НОВАЯ ЗАДАЧА ИЗ ОБЛАКА');
            } else {
                console.log('Task already exists locally, skipping INSERT:', newTask.id, 'matched by:', existingTaskById ? 'ID' : 'content');
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

            // Convert cloud task status
            let status = 'active'; // default
            if (newRecord.status) {
                // New format: use status field directly
                status = newRecord.status;
            } else if (newRecord.is_completed) {
                // Old format: fall back to is_completed
                status = 'completed';
            }

            if (taskIndex !== -1) {
                // Task exists - UPDATE it
                console.log('Updating existing task:', newRecord.id);
                tasks[taskIndex].txt = newRecord.title;
                tasks[taskIndex].status = status; // Use status instead of done
                tasks[taskIndex].container_type = newRecord.container_type || (status === 'completed' ? 'archived' : 'today'); // NEW: Update container_type
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
                    status: status, // Use status instead of done
                    container_type: newRecord.container_type || (status === 'completed' ? 'archived' : 'today'), // NEW: Add container_type
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
// ========== TASK POPUP LOGIC ==========
let popupLocked = false;

function showTaskPopup(event, text, isClick = false) {
    const popup = document.getElementById('task-detail-popup');
    if (!popup) return;

    // If locked by click, ignore hover
    if (popupLocked && !isClick) return;

    // If click, toggle lock or update
    if (isClick) {
        popupLocked = true;
    }

    popup.innerText = text;
    popup.classList.add('visible');

    updatePopupPosition(event, popup);
}

function hideTaskPopup() {
    if (popupLocked) return;
    const popup = document.getElementById('task-detail-popup');
    if (popup) popup.classList.remove('visible');
}

function updatePopupPosition(event, popup) {
    // Mobile/Small screen check
    if (window.innerWidth < 768) {
        // Reset to CSS center
        popup.style.left = '50%';
        popup.style.top = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
        return;
    }

    // Desktop: Follow cursor with offset
    if (!event) return;

    // Fix for "Cannot read properties of undefined (reading 'offsetWidth')"
    if (!popup) {
        popup = document.getElementById('task-detail-popup');
    }
    if (!popup) return;

    // Add offset
    const offset = 15; // px
    let left = event.clientX + offset;
    let top = event.clientY + offset;

    // Boundary check (Prevent going off screen)
    if (left + popup.offsetWidth > window.innerWidth) {
        left = event.clientX - popup.offsetWidth - offset;
    }
    if (top + popup.offsetHeight > window.innerHeight) {
        top = event.clientY - popup.offsetHeight - offset;
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.transform = 'none';
}

// Global click to close popup if locked
document.addEventListener('click', (e) => {
    if (!popupLocked) return;

    // Ignore clicks on the popup logic itself (handled by stopPropagation in task click)
    if (e.target.closest('#task-detail-popup')) return;

    popupLocked = false;
    hideTaskPopup();
    // Force hide
    const popup = document.getElementById('task-detail-popup');
    if (popup) popup.classList.remove('visible');
});

// ========== TEMPLATE MANAGER ==========
let templates = [];

async function toggleTemplatesMenu() {
    const menu = document.getElementById('templates-menu');
    const btn = document.getElementById('templates-toggle');

    if (menu.classList.contains('hidden')) {
        // Open menu
        menu.classList.remove('hidden');
        btn.classList.add('active');

        // Check "Save" button state
        checkSaveTemplateBtn();

        // Fetch templates
        await fetchTemplates();
    } else {
        // Close menu
        menu.classList.add('hidden');
        btn.classList.remove('active');
    }
}

function checkSaveTemplateBtn() {
    const taskInput = document.getElementById('task-input');
    const saveBtn = document.getElementById('save-template-btn');
    if (!taskInput || !saveBtn) return;

    if (taskInput.value.trim().length > 0) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
    } else {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
    }
}

// Listen for input changes to update Save button state
document.getElementById('task-input')?.addEventListener('input', checkSaveTemplateBtn);

async function fetchTemplates() {
    if (!supabaseClient) return;

    // Only try to fetch if we have a user, OR rely on RLS to deny if not logged in.
    // Using currentUser check is safer to avoid errors.
    if (!currentUser) {
        const listEl = document.getElementById('templates-list');
        listEl.innerHTML = '<li style="padding:15px; text-align:center; color:#888; font-size:0.8rem;">ТРЕБУЕТСЯ АВТОРИЗАЦИЯ</li>';
        return;
    }

    const listEl = document.getElementById('templates-list');
    listEl.innerHTML = '<li style="padding:10px; text-align:center; color:#666;">ЗАГРУЗКА...</li>';

    try {
        const { data, error } = await supabaseClient
            .from('task_templates')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        templates = data || [];
        renderTemplatesList();
    } catch (err) {
        console.error('Error fetching templates:', err);
        listEl.innerHTML = '<li style="padding:10px; text-align:center; color:var(--red);">ОШИБКА ЗАГРУЗКИ</li>';
    }
}

function renderTemplatesList() {
    const listEl = document.getElementById('templates-list');
    listEl.innerHTML = '';

    if (templates.length === 0) {
        listEl.innerHTML = '<li style="padding:15px; text-align:center; color:#555; font-size:0.8rem;">НЕТ СОХРАНЕННЫХ ШАБЛОНОВ</li>';
        return;
    }

    templates.forEach(t => {
        const li = document.createElement('li');
        li.className = 'template-item';
        li.onclick = (e) => {
            // Prevent if clicked on delete button
            if (e.target.closest('.delete-template-btn')) return;
            handleTemplateSelect(t.text);
        };

        const span = document.createElement('span');
        span.className = 'template-text';
        span.innerText = t.text;

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-template-btn';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        delBtn.title = "Удалить шаблон";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteTemplate(t.id);
        };

        li.appendChild(span);
        li.appendChild(delBtn);
        listEl.appendChild(li);
    });
}

function handleTemplateSelect(text) {
    const inp = document.getElementById('task-input');
    inp.value = text;
    // Highlight input to show it changed
    inp.focus();

    // Trigger input event to enable "+" button if needed (though existing code might not rely on it, 
    // but checkSaveTemplateBtn needs it)
    checkSaveTemplateBtn();

    // Close menu
    toggleTemplatesMenu();
}

async function saveCurrentAsTemplate() {
    const inp = document.getElementById('task-input');
    const text = inp.value.trim();
    if (!text) return;

    if (!currentUser) {
        showToast("НУЖНА АВТОРИЗАЦИЯ");
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('task_templates')
            .insert([{ text: text, user_id: currentUser.id }])
            .select();

        if (error) throw error;

        showToast("ШАБЛОН СОХРАНЕН");

        // Refresh list
        await fetchTemplates();

    } catch (err) {
        console.error('Error saving template:', err);
        showToast("ОШИБКА СОХРАНЕНИЯ");
    }
}

async function deleteTemplate(id) {
    if (!confirm("УДАЛИТЬ ШАБЛОН?")) return;

    try {
        const { error } = await supabaseClient
            .from('task_templates')
            .delete()
            .eq('id', id);

        if (error) throw error;

        // Refresh list locally for speed
        templates = templates.filter(t => t.id !== id);
        renderTemplatesList();

    } catch (err) {
        console.error('Error deleting template:', err);
        showToast("ОШИБКА УДАЛЕНИЯ");
    }
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('templates-menu');
    const btn = document.getElementById('templates-toggle');
    if (!menu || !btn) return;

    if (!menu.classList.contains('hidden') &&
        !menu.contains(e.target) &&
        !btn.contains(e.target)) {

        menu.classList.add('hidden');
        btn.classList.remove('active');
    }
});

initializeApp();
