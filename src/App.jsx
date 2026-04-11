import { useState } from "react";
import "./App.css";

function App() {
  const [tab, setTab] = useState("dashboard");

  const [task, setTask] = useState("");
  const [tasks, setTasks] = useState([]);

  const [message, setMessage] = useState("");
  const [aiResponse, setAiResponse] = useState("");

  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);

  // ➕ ADD TASK
  const addTask = () => {
    if (!task) return;

    setTasks([...tasks, { name: task, done: false }]);
    setTask("");
  };

  // ✔ TOGGLE TASK
  const toggleTask = (i) => {
    const updated = [...tasks];
    updated[i].done = !updated[i].done;

    if (updated[i].done) {
      setXp(xp + 10);
      setStreak(streak + 1);
    }

    setTasks(updated);
  };

  // ❌ DELETE
  const deleteTask = (i) => {
    setTasks(tasks.filter((_, index) => index !== i));
  };

  // 🤖 AI
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
      setAiResponse(data.plan);

    } catch (err) {
      alert("AI failed ❌");
    }
  };

  const completed = tasks.filter((t) => t.done).length;
  const progress = tasks.length ? (completed / tasks.length) * 100 : 0;

  return (
    <div className="app">

      {/* SIDEBAR */}
      <aside className="sidebar">
        <h2>⚡ FocusAI</h2>

        <p onClick={() => setTab("dashboard")}>🏠 Dashboard</p>
        <p onClick={() => setTab("tasks")}>✅ Tasks</p>
        <p onClick={() => setTab("ai")}>🤖 AI Coach</p>
        <p onClick={() => setTab("stats")}>📊 Stats</p>
      </aside>

      {/* MAIN */}
      <main className="main">

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <>
            <h1>Dashboard</h1>

            <div className="card">
              <p>Total Tasks: {tasks.length}</p>
              <p>Completed: {completed}</p>
              <p>XP: {xp}</p>
              <p>🔥 Streak: {streak}</p>
            </div>

            <div className="progress">
              <div style={{ width: progress + "%" }}></div>
            </div>
          </>
        )}

        {/* TASKS */}
        {tab === "tasks" && (
          <>
            <h1>Tasks</h1>

            <div className="card">
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Enter task"
              />
              <button onClick={addTask}>Add</button>
            </div>

            {tasks.map((t, i) => (
              <div key={i} className="task">
                <span style={{ textDecoration: t.done ? "line-through" : "none" }}>
                  {t.name}
                </span>

                <div>
                  <button onClick={() => toggleTask(i)}>✔</button>
                  <button onClick={() => deleteTask(i)}>❌</button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* AI */}
        {tab === "ai" && (
          <>
            <h1>AI Coach</h1>

            <div className="card">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ask AI..."
              />
              <button onClick={sendMessage}>Send</button>

              <p><strong>You:</strong> {message}</p>
              <p><strong>AI:</strong> {aiResponse}</p>
            </div>
          </>
        )}

        {/* STATS */}
        {tab === "stats" && (
          <>
            <h1>Stats</h1>

            <div className="card">
              <p>Total Tasks: {tasks.length}</p>
              <p>Completed: {completed}</p>
              <p>XP: {xp}</p>
              <p>🔥 Streak: {streak}</p>
              <p>Progress: {progress.toFixed(0)}%</p>
            </div>
          </>
        )}

      </main>
    </div>
  );
}

export default App;