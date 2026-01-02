import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { motion, Reorder, AnimatePresence } from 'framer-motion';

// --- FIREBASE SETUP ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'hawkins-stas-001';

// --- STABLE AUDIO ASSETS ---
const TRACKS = [
  { id: 'theme', name: "Stranger Synth", url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'dark', name: "The Upside Down", url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3' }
];

const SFX = {
  click: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  tvOff: 'https://assets.mixkit.co/active_storage/sfx/2857/2857-preview.mp3'
};

// --- SVG ICONS (Internal to avoid loading issues) ---
const IconPlus = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>;
const IconTrash = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
const IconGrip = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>;
const IconPlay = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>;

const App = () => {
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'));
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setTasks(data.sort((a, b) => (a.order || 0) - (b.order || 0)));
    });
  }, [user]);

  const playSFX = (src) => {
    const a = new Audio(src);
    a.volume = 0.4;
    a.play().catch(() => {});
  };

  const handleStart = () => {
    setIsStarted(true);
    setIsPlaying(true);
    setTimeout(() => audioRef.current?.play(), 100);
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTask.trim() || !user) return;
    playSFX(SFX.click);
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'), {
      text: newTask,
      completed: false,
      order: tasks.length
    });
    setNewTask('');
  };

  const toggleTask = async (task) => {
    playSFX(SFX.click);
    await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id), {
      completed: !task.completed
    });
  };

  const deleteTask = async (id) => {
    playSFX(SFX.tvOff);
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', id));
  };

  const handleReorder = (newOrder) => {
    setTasks(newOrder);
    newOrder.forEach((t, i) => {
      updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', t.id), { order: i });
    });
  };

  if (!isStarted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center select-none">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1 className="text-red-600 text-6xl font-bold uppercase tracking-tighter mb-12" 
              style={{ textShadow: '0 0 20px #f00', fontFamily: 'serif' }}>
            HAWKINS<br/>DO LIST
          </h1>
          <button onClick={handleStart} className="px-10 py-5 border-2 border-red-600 text-red-600 font-black uppercase tracking-[0.3em] hover:bg-red-600 hover:text-black transition-all active:scale-95 flex items-center gap-3 mx-auto">
            ENTER <IconPlay />
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-red-50 font-sans relative overflow-x-hidden p-4 md:p-10">
      {/* Scanlines Effect */}
      <div className="fixed inset-0 pointer-events-none opacity-10 z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />

      <div className="max-w-xl mx-auto relative z-10">
        <header className="mb-10 text-center">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter uppercase flicker"
              style={{ color: '#f41b1b', textShadow: '0 0 15px #f41b1b', fontFamily: 'serif' }}>
            Strange Tasks
          </h1>
          <p className="text-red-900 text-[10px] tracking-[0.5em] uppercase font-black mt-2">Hawkins Lab — 1984</p>
        </header>

        <div className="flex items-center justify-between bg-zinc-950 border border-red-900/30 rounded p-4 mb-8 shadow-[0_0_20px_rgba(139,0,0,0.2)]">
          <button onClick={() => { setIsPlaying(!isPlaying); isPlaying ? audioRef.current.pause() : audioRef.current.play(); }}
                  className={`p-3 rounded-full ${isPlaying ? 'bg-red-600 text-black animate-pulse' : 'bg-zinc-900 text-zinc-700'}`}>
            {isPlaying ? 'ON' : 'OFF'}
          </button>
          <span className="text-[10px] font-bold text-red-900 uppercase">Radio Interference Active</span>
          <audio ref={audioRef} src={TRACKS[0].url} loop />
        </div>

        <form onSubmit={addTask} className="mb-10 relative">
          <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)}
                 placeholder="New objective..."
                 className="w-full bg-transparent border-b-2 border-red-900 p-4 text-xl focus:outline-none focus:border-red-600 text-red-100 placeholder:text-zinc-900" />
          <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 text-red-600"><IconPlus /></button>
        </form>

        <Reorder.Group axis="y" values={tasks} onReorder={handleReorder} className="space-y-4">
          <AnimatePresence mode="popLayout">
            {tasks.map((task) => (
              <Reorder.Item key={task.id} value={task} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
                            className={`flex items-center gap-4 bg-zinc-950 border ${task.completed ? 'border-transparent opacity-30' : 'border-red-900/40'} p-5 rounded shadow-lg`}>
                <div className="text-zinc-900"><IconGrip /></div>
                <div onClick={() => toggleTask(task)} className={`w-6 h-6 border-2 flex items-center justify-center ${task.completed ? 'bg-zinc-800 border-zinc-700' : 'border-red-600 shadow-[0_0_10px_#f00]'}`}>
                  {task.completed && <div className="w-2 h-2 bg-red-600" />}
                </div>
                <div className="flex-1" onClick={() => toggleTask(task)}>
                  <p className={`text-xl transition-all ${task.completed ? 'line-through italic text-base' : 'font-bold text-red-600 uppercase'}`}>
                    {task.text}
                  </p>
                </div>
                <button onClick={() => deleteTask(task.id)} className="text-zinc-900 hover:text-red-600 transition-colors"><IconTrash /></button>
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes flicker { 0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; } 20%, 22%, 24%, 55% { opacity: 0.5; } }
        .flicker { animation: flicker 6s infinite; }
        body { background: black; -webkit-tap-highlight-color: transparent; }
      `}} />
    </div>
  );
};

export default App;

