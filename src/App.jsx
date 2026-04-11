import { useState, useEffect } from "react";
import "./App.css";

import { auth } from "./firebase";
import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from "firebase/auth";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where
} from "firebase/firestore";

const db = getFirestore();

function App() {
  // 🔐 AUTH
  const [user, setUser] = useState(null);

  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  };

  const logout = () => {
    signOut(auth);
    setUser(null);
  };

  // 🌙 DARK MODE
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    document.body.className = darkMode ? "dark" : "";
  }, [darkMode]);

  // 📋 TASKS
  const [task, setTask] = useState("");
  const [date, setDate] = useState("");
  const [tasks, setTasks] = useState([]);

  const fetchTasks = async () => {
    if (!user) return;

    const q = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid)
    );

    const snapshot = await getDocs(q);
    const list = [];

    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });

    setTasks(list);
  };

  useEffect(() => {
    if (user) fetchTasks();
  }, [user]);

  const addTask = async () => {
    if (!task || !user) {
      alert("Task or user missing");
      return;
    }

    await addDoc(collection(db, "tasks"), {
      name: task,
      date: date,
      done: false,
      userId: user.uid
    });

    setTask("");
    setDate("");
    fetchTasks();
  };

  const toggleTask = (i) => {
    const updated = [...tasks];
    updated[i].done = !updated[i].done;
    setTasks(updated);
  };

  const deleteTask = (i) => {
    setTasks(tasks.filter((_, index) => index !== i));
  };

  // 🤖 AI COACH
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState([]);

  const sendMessage = async () => {
    if (!message) return;

    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ goal: message })
      });

      const data = await res.json();

      setChat((prev) => [
        ...prev,
        { user: message, bot: data.plan }
      ]);

      setMessage("");
    } catch (err) {
      console.error(err);
      alert("AI failed ❌");
    }
  };

  // 📊 STATS
  const completed = tasks.filter((t) => t.done).length;
  const xp = completed * 10;
  const streak = completed; // basic logic

  return (
    <div className={`container ${darkMode ? "dark" : ""}`}>
      
      {/* HEADER */}
      <div className="top-bar">
        {!user ? (
          <button onClick={login}>🔐 Login with Google</button>
        ) : (
          <div>
            <p>Welcome {user.displayName}</p>
            <button onClick={logout}>Logout</button>
          </div>
        )}

        <button onClick={() => setDarkMode(!darkMode)}>
          🌙 Toggle
        </button>
      </div>

      <h1>📚 Study Planner</h1>

      {/* TASK INPUT */}
      <div className="card">
        <input
          type="text"
          placeholder="Task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        <button onClick={addTask}>Add Task</button>
      </div>

      {/* TASK LIST */}
      <div className="card">
        {tasks.map((t, i) => (
          <div key={t.id} className={`task ${t.done ? "done" : ""}`}>
            <div>
              <strong>{t.name}</strong>
              <br />
              <small>{t.date}</small>
            </div>

            <div className="actions">
              <button onClick={() => toggleTask(i)}>✔</button>
              <button onClick={() => deleteTask(i)}>❌</button>
            </div>
          </div>
        ))}
      </div>

      {/* AI COACH */}
      <div className="card">
        <h2>🤖 AI Coach</h2>

        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask AI..."
        />

        <button onClick={sendMessage}>Send</button>

        {chat.map((c, i) => (
          <div key={i} className="chat">
            <p><strong>You:</strong> {c.user}</p>
            <p><strong>AI:</strong> {c.bot}</p>
          </div>
        ))}
      </div>

      {/* STATS */}
      <div className="card">
        <h2>📊 Stats</h2>
        <p>Total Tasks: {tasks.length}</p>
        <p>Completed: {completed}</p>
        <p>XP: {xp}</p>
        <p>🔥 Streak: {streak}</p>
      </div>
    </div>
  );
}

export default App;