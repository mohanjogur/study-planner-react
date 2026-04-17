import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Flame,
  Gauge,
  Menu,
  Mic,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Star,
  Target,
  Trash2,
  Trophy,
  UserRound,
  Wand2,
  X,
} from "lucide-react";

const K = {
  profile: "user_profile",
  generatedResume: "generated_resume",
  resumeTips: "resume_tips",
  atsScore: "ats_score",
  learningPath: "learning_path",
  practiceNotes: "practice_notes",
  practicedQuestions: "practiced_questions",
  savedQuestions: "saved_questions",
  mockSessions: "mock_sessions",
  studyPlan: "study_plan",
  dailyTip: "daily_tip",
  activityLog: "activity_log",
  settings: "settings",
  achievements: "achievements",
  resumeDraft: "resume_builder_draft",
};

const NAV = [
  ["dashboard", "Dashboard", BarChart3],
  ["resume", "Resume Builder", FileText],
  ["interview", "Interview Prep", Target],
  ["study", "Study Concepts", BookOpen],
  ["mock", "Mock Interview", Mic],
  ["analytics", "Analytics", Gauge],
  ["settings", "Settings", Settings],
];

const EXP = ["Fresher/0-1yr", "1-3yrs", "3-5yrs", "5-10yrs", "10+yrs"];
const DOMAINS = [
  "Software Engineering",
  "Data Science",
  "Frontend Dev",
  "Backend Dev",
  "Full Stack",
  "DevOps",
  "Product Management",
  "Data Analyst",
  "Marketing Manager",
  "UX Designer",
  "Machine Learning Engineer",
  "Cybersecurity",
  "Business Analyst",
  "Cloud Engineer",
  "Mobile Developer",
];
const BADGES = [
  ["first_resume", "First Resume Generated", FileText],
  ["ten_questions", "10 Questions Practiced", Target],
  ["path_started", "Learning Path Started", BookOpen],
  ["first_mock", "First Mock Interview Completed", Mic],
  ["mock_eight_plus", "Score 8+ on Mock Interview", Star],
  ["practice_streak", "3-Day Practice Streak", Flame],
];

const EMPTY_PROFILE = {
  name: "",
  email: "",
  phone: "",
  linkedIn: "",
  github: "",
  location: "",
  currentRole: "",
  experience: EXP[0],
  targetRole: "",
  domain: DOMAINS[0],
  targetCompanies: "",
  technicalSkills: [],
  softSkills: [],
  education: { degree: "", institution: "", year: "" },
  workHistory: "",
};

const EMPTY_SETTINGS = {
  detailLevel: "Detailed",
  showTimers: true,
  theme: "dark",
  anthropicApiKey: "",
  lastModule: "dashboard",
};

const emptyResumeDraft = () => ({
  personal: { name: "", email: "", phone: "", linkedIn: "", github: "", location: "" },
  experience: [{ id: uid(), company: "", role: "", duration: "", location: "", responsibilities: "" }],
  education: [{ id: uid(), degree: "", institution: "", year: "", gpa: "" }],
  projects: [{ id: uid(), name: "", techStack: "", description: "", link: "" }],
  skills: { technical: [], soft: [], certifications: "" },
  jobDescription: "",
});

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const cn = (...v) => v.filter(Boolean).join(" ");
const arr = (v) => (Array.isArray(v) ? v : []);
const dayKey = () => new Date().toISOString().slice(0, 10);
const fmt = (v) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(v));
const fence = (t = "") => t.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
const grade = (s) => (s >= 8.5 ? "A" : s >= 7 ? "B" : s >= 5.5 ? "C" : "D");
const scoreColor = (s) => (s >= 8 ? "text-emerald-300" : s >= 5 ? "text-amber-300" : "text-rose-300");
const readiness = ({ generatedResume, practicedQuestions, learningPath, mockSessions, studyPlan }) =>
  (generatedResume?.sections ? 20 : 0) +
  (practicedQuestions.length ? 20 : 0) +
  (arr(learningPath?.completedTopics).length ? 20 : 0) +
  (mockSessions.length ? 30 : 0) +
  (studyPlan?.weeks?.length ? 10 : 0);

function useDebouncedEffect(fn, deps, delay) {
  useEffect(() => {
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function createStorage() {
  if (window.storage) return window.storage;
  const open = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open("careerforge-ai", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const tx = async (mode, run) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction("kv", mode);
      const store = t.objectStore("kv");
      const req = run(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  window.storage = {
    async getItem(key) {
      const v = await tx("readonly", (s) => s.get(key));
      return v ? JSON.parse(v) : null;
    },
    async setItem(key, value) {
      await tx("readwrite", (s) => s.put(JSON.stringify(value), key));
    },
    async removeItem(key) {
      await tx("readwrite", (s) => s.delete(key));
    },
  };
  return window.storage;
}

async function reveal(text, onStream) {
  if (!onStream) return;
  let out = "";
  for (const part of text.split(/(\s+)/)) {
    out += part;
    onStream(out);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function callClaude(systemPrompt, userPrompt, { apiKey, onStream, maxTokens = 1800 } = {}) {
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      stream: false,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error((await res.text()) || "Anthropic request failed");
  const data = await res.json();
  const text = data?.content?.map((c) => c.text || "").join("") || "";
  await reveal(text, onStream);
  return text;
}

export default function App() {
  const store = useRef(null);
  const [booting, setBooting] = useState(true);
  const [nav, setNav] = useState("dashboard");
  const [drawer, setDrawer] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confirm, setConfirm] = useState("");
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [resumeDraft, setResumeDraft] = useState(emptyResumeDraft());
  const [generatedResume, setGeneratedResume] = useState(null);
  const [resumeTips, setResumeTips] = useState(null);
  const [atsScore, setAtsScore] = useState(null);
  const [learningPath, setLearningPath] = useState({ phases: [], completedTopics: [], generatedAt: null });
  const [practiceNotes, setPracticeNotes] = useState({});
  const [practicedQuestions, setPracticedQuestions] = useState([]);
  const [savedQuestions, setSavedQuestions] = useState([]);
  const [mockSessions, setMockSessions] = useState([]);
  const [studyPlan, setStudyPlan] = useState(null);
  const [dailyTip, setDailyTip] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [achievements, setAchievements] = useState({ earnedBadges: [] });
  const [preview, setPreview] = useState("");
  const [deepDive, setDeepDive] = useState({ topic: "", content: "" });
  const [flashcards, setFlashcards] = useState({ topic: "", cards: [] });
  const [currentSession, setCurrentSession] = useState(null);
  const [loading, setLoading] = useState({});

  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY || "";

  const toast = useCallback((title, body, type = "success") => {
    const id = uid();
    setToasts((p) => [...p, { id, title, body, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3200);
  }, []);

  const log = useCallback((action, module) => {
    setActivityLog((p) => [{ action, module, timestamp: new Date().toISOString() }, ...p].slice(0, 30));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      store.current = createStorage();
      const s = store.current;
      const values = await Promise.all(Object.values(K).map((k) => s.getItem(k)));
      if (!live) return;
      const [
        sp,
        sr,
        srt,
        sats,
        sl,
        sn,
        spq,
        ssq,
        sms,
        ssp,
        sdt,
        sal,
        sset,
        sach,
        srd,
      ] = values;
      const p = { ...EMPTY_PROFILE, ...(sp || {}) };
      setProfile(p);
      setGeneratedResume(sr);
      setResumeTips(srt);
      setAtsScore(sats);
      setLearningPath(sl || { phases: [], completedTopics: [], generatedAt: null });
      setPracticeNotes(sn || {});
      setPracticedQuestions(spq || []);
      setSavedQuestions(ssq || []);
      setMockSessions(sms || []);
      setStudyPlan(ssp);
      setDailyTip(sdt);
      setActivityLog(sal || []);
      setSettings({ ...EMPTY_SETTINGS, ...(sset || {}) });
      setAchievements(sach || { earnedBadges: [] });
      setResumeDraft(
        srd || {
          ...emptyResumeDraft(),
          personal: {
            name: p.name,
            email: p.email,
            phone: p.phone,
            linkedIn: p.linkedIn,
            github: p.github,
            location: p.location,
          },
          skills: { technical: p.technicalSkills, soft: p.softSkills, certifications: "" },
        },
      );
      setNav((sset && sset.lastModule) || "dashboard");
      setBooting(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  useDebouncedEffect(
    () => {
      if (booting || !store.current) return;
      const s = store.current;
      s.setItem(K.profile, profile);
      s.setItem(K.generatedResume, generatedResume);
      s.setItem(K.resumeTips, resumeTips);
      s.setItem(K.atsScore, atsScore);
      s.setItem(K.learningPath, learningPath);
      s.setItem(K.practiceNotes, practiceNotes);
      s.setItem(K.practicedQuestions, practicedQuestions);
      s.setItem(K.savedQuestions, savedQuestions);
      s.setItem(K.mockSessions, mockSessions);
      s.setItem(K.studyPlan, studyPlan);
      s.setItem(K.dailyTip, dailyTip);
      s.setItem(K.activityLog, activityLog);
      s.setItem(K.settings, settings);
      s.setItem(K.achievements, achievements);
      s.setItem(K.resumeDraft, resumeDraft);
    },
    [booting, profile, generatedResume, resumeTips, atsScore, learningPath, practiceNotes, practicedQuestions, savedQuestions, mockSessions, studyPlan, dailyTip, activityLog, settings, achievements, resumeDraft],
    500,
  );

  useEffect(() => {
    if (!booting) setSettings((p) => ({ ...p, lastModule: nav }));
  }, [nav, booting]);

  useEffect(() => {
    if (booting) return;
    const earned = [];
    if (generatedResume?.sections) earned.push("first_resume");
    if (practicedQuestions.length >= 10) earned.push("ten_questions");
    if (learningPath?.phases?.length) earned.push("path_started");
    if (mockSessions.length) earned.push("first_mock");
    if (mockSessions.some((s) => s.overallScore >= 8)) earned.push("mock_eight_plus");
    const days = new Set(activityLog.map((a) => new Date(a.timestamp).toISOString().slice(0, 10)));
    let streak = 0;
    const d = new Date();
    while (days.has(d.toISOString().slice(0, 10))) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    }
    if (streak >= 3) earned.push("practice_streak");
    setAchievements({ earnedBadges: earned });
  }, [booting, generatedResume, practicedQuestions, learningPath, mockSessions, activityLog]);

  const ready = useMemo(
    () => readiness({ generatedResume, practicedQuestions, learningPath, mockSessions, studyPlan }),
    [generatedResume, practicedQuestions, learningPath, mockSessions, studyPlan],
  );

  const runJson = useCallback(
    async (key, systemPrompt, userPrompt, onStream) => {
      if (!apiKey) {
        toast("API key required", "Add your Anthropic API key in Settings to use AI features.", "error");
        setNav("settings");
        throw new Error("Missing API key");
      }
      setLoading((p) => ({ ...p, [key]: true }));
      try {
        const text = await callClaude(systemPrompt, userPrompt, { apiKey, onStream });
        return JSON.parse(fence(text));
      } finally {
        setLoading((p) => ({ ...p, [key]: false }));
      }
    },
    [apiKey, toast],
  );

  const runText = useCallback(
    async (key, systemPrompt, userPrompt) => {
      if (!apiKey) {
        toast("API key required", "Add your Anthropic API key in Settings to use AI features.", "error");
        setNav("settings");
        throw new Error("Missing API key");
      }
      setLoading((p) => ({ ...p, [key]: true }));
      try {
        return await callClaude(systemPrompt, userPrompt, { apiKey });
      } finally {
        setLoading((p) => ({ ...p, [key]: false }));
      }
    },
    [apiKey, toast],
  );

  const generateTip = useCallback(async () => {
    try {
      const tip = await runText("tip", "You are a concise career coach.", `Give one practical daily career tip for a ${profile.targetRole || profile.domain} candidate with ${profile.experience} experience. Keep it under 80 words.`);
      setDailyTip({ tip, date: dayKey() });
      log("Generated today's AI tip", "Dashboard");
    } catch (error) {
      console.error(error);
    }
  }, [log, profile.domain, profile.experience, profile.targetRole, runText]);

  useEffect(() => {
    if (!booting && nav === "dashboard" && profile.targetRole && dailyTip?.date !== dayKey()) generateTip();
  }, [booting, nav, profile.targetRole, dailyTip?.date, generateTip]);

  const clearScope = useCallback(async () => {
    const s = store.current;
    if (!s || !confirm) return;
    if (confirm === "resume") {
      setGeneratedResume(null);
      setResumeTips(null);
      setAtsScore(null);
      setResumeDraft(emptyResumeDraft());
      await Promise.all([s.removeItem(K.generatedResume), s.removeItem(K.resumeTips), s.removeItem(K.atsScore), s.removeItem(K.resumeDraft)]);
    }
    if (confirm === "history") {
      setPracticedQuestions([]);
      setSavedQuestions([]);
      setMockSessions([]);
      setCurrentSession(null);
      await Promise.all([s.removeItem(K.practicedQuestions), s.removeItem(K.savedQuestions), s.removeItem(K.mockSessions)]);
    }
    if (confirm === "all") {
      await Promise.all(Object.values(K).map((key) => s.removeItem(key)));
      setProfile(EMPTY_PROFILE);
      setSettings(EMPTY_SETTINGS);
      setResumeDraft(emptyResumeDraft());
      setGeneratedResume(null);
      setResumeTips(null);
      setAtsScore(null);
      setLearningPath({ phases: [], completedTopics: [], generatedAt: null });
      setPracticeNotes({});
      setPracticedQuestions([]);
      setSavedQuestions([]);
      setMockSessions([]);
      setStudyPlan(null);
      setDailyTip(null);
      setActivityLog([]);
      setAchievements({ earnedBadges: [] });
      setDeepDive({ topic: "", content: "" });
      setFlashcards({ topic: "", cards: [] });
      setCurrentSession(null);
    }
    setConfirm("");
    toast("Data updated", "Requested data has been cleared.");
  }, [confirm, toast]);

  if (booting) return <LoadingScreen />;
  if (!profile.name || !profile.email || !profile.targetRole) {
    return <Onboarding profile={profile} setProfile={setProfile} toast={toast} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <ToastStack toasts={toasts} onClose={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
      <ConfirmModal open={!!confirm} onClose={() => setConfirm("")} onConfirm={clearScope} />
      <div className="mx-auto flex max-w-[1600px]">
        <Sidebar nav={nav} setNav={setNav} drawer={drawer} setDrawer={setDrawer} profile={profile} />
        <main className="flex-1 px-4 py-4 md:px-6 md:py-6">
          <MobileTop profile={profile} open={() => setDrawer(true)} />
          {nav === "dashboard" && <DashboardPage profile={profile} ready={ready} generatedResume={generatedResume} practicedQuestions={practicedQuestions} learningPath={learningPath} mockSessions={mockSessions} studyPlan={studyPlan} dailyTip={dailyTip} loadingTip={loading.tip} generateTip={generateTip} activityLog={activityLog} setNav={setNav} />}
          {nav === "resume" && <ResumePage profile={profile} resumeDraft={resumeDraft} setResumeDraft={setResumeDraft} generatedResume={generatedResume} setGeneratedResume={setGeneratedResume} resumeTips={resumeTips} setResumeTips={setResumeTips} atsScore={atsScore} setAtsScore={setAtsScore} preview={preview} setPreview={setPreview} loading={loading} runJson={runJson} toast={toast} log={log} />}
          {nav === "interview" && <InterviewPage profile={profile} practicedQuestions={practicedQuestions} setPracticedQuestions={setPracticedQuestions} savedQuestions={savedQuestions} setSavedQuestions={setSavedQuestions} loading={loading} runJson={runJson} log={log} />}
          {nav === "study" && <StudyPage profile={profile} learningPath={learningPath} setLearningPath={setLearningPath} deepDive={deepDive} setDeepDive={setDeepDive} practiceNotes={practiceNotes} setPracticeNotes={setPracticeNotes} flashcards={flashcards} setFlashcards={setFlashcards} loading={loading} runJson={runJson} runText={runText} toast={toast} log={log} />}
          {nav === "mock" && <MockPage profile={profile} settings={settings} currentSession={currentSession} setCurrentSession={setCurrentSession} mockSessions={mockSessions} setMockSessions={setMockSessions} loading={loading} runJson={runJson} log={log} />}
          {nav === "analytics" && <AnalyticsPage ready={ready} profile={profile} practicedQuestions={practicedQuestions} mockSessions={mockSessions} learningPath={learningPath} studyPlan={studyPlan} setStudyPlan={setStudyPlan} achievements={achievements} loading={loading} runJson={runJson} generatedResume={generatedResume} log={log} />}
          {nav === "settings" && <SettingsPage profile={profile} setProfile={setProfile} settings={settings} setSettings={setSettings} setConfirm={setConfirm} />}
        </main>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-950 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="h-24 animate-pulse rounded-3xl bg-slate-800/70" />
        <div className="h-[420px] animate-pulse rounded-3xl bg-slate-800/70" />
      </div>
    </div>
  );
}

function Card({ children, className = "" }) {
  return <div className={cn("rounded-3xl border border-slate-700/80 bg-slate-800/55 p-5 backdrop-blur", className)}>{children}</div>;
}

function Btn({ children, className = "", variant = "primary", icon: Icon, ...props }) {
  const style = {
    primary: "bg-gradient-to-r from-indigo-500 to-cyan-400 text-slate-950 hover:brightness-110",
    secondary: "border border-slate-600 bg-slate-900/70 text-slate-100 hover:border-cyan-400/40",
    danger: "border border-rose-500/40 bg-rose-500/10 text-rose-100",
  };
  return (
    <button
      className={cn("inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition active:scale-95 disabled:opacity-50", style[variant], className)}
      {...props}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

function Input(props) {
  return <input className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/60" {...props} />;
}

function Area(props) {
  return <textarea className="min-h-[120px] w-full rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/60" {...props} />;
}

function Select(props) {
  return <select className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/60" {...props} />;
}

function Field({ label, children, hint }) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-200">{label}</span>
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

function Title({ eyebrow, title, action }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">{eyebrow}</p> : null}
        <h2 className="mt-1 text-2xl font-semibold text-white">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Tabs({ items, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button key={item} onClick={() => onChange(item)} className={cn("rounded-2xl px-4 py-2 text-sm transition", value === item ? "bg-slate-100 text-slate-950" : "border border-slate-700 bg-slate-900/50 text-slate-300")}>
          {item}
        </button>
      ))}
    </div>
  );
}

function Ring({ value, label, sublabel }) {
  const size = 126;
  const r = 50;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx="63" cy="63" r={r} fill="none" stroke="rgba(51,65,85,.8)" strokeWidth="10" />
        <circle cx="63" cy="63" r={r} fill="none" stroke="url(#g)" strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (Math.max(0, value) / 100) * c} />
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-semibold text-white">{Math.round(value)}</div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
        {sublabel ? <div className="text-xs text-slate-500">{sublabel}</div> : null}
      </div>
    </div>
  );
}

function Bar({ label, value, subtitle }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div>
          <div className="text-slate-200">{label}</div>
          {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
        </div>
        <div className="text-slate-400">{Math.round(value)}%</div>
      </div>
      <div className="h-3 rounded-full bg-slate-950/80">
        <div className="h-3 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400" style={{ width: `${Math.max(4, value)}%` }} />
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, body, action }) {
  return (
    <Card className="flex min-h-[220px] flex-col items-center justify-center text-center">
      <div className="mb-4 rounded-3xl bg-slate-900 p-4 text-cyan-300">{Icon ? <Icon className="h-9 w-9" /> : null}</div>
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-400">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

function TagInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
      <div className="mb-2 flex flex-wrap gap-2">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">
            {tag}
            <button onClick={() => onChange(value.filter((v) => v !== tag))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
        <Btn variant="secondary" className="px-3" onClick={add}><Plus className="h-4 w-4" /></Btn>
      </div>
    </div>
  );
}

function ToastStack({ toasts, onClose }) {
  return (
    <div className="fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-3">
      {toasts.map((t) => (
        <div key={t.id} className={cn("rounded-2xl border px-4 py-3 backdrop-blur", t.type === "error" ? "border-rose-500/30 bg-rose-500/15 text-rose-50" : "border-emerald-500/30 bg-emerald-500/15 text-emerald-50")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{t.title}</div>
              <div className="text-sm opacity-90">{t.body}</div>
            </div>
            <button onClick={() => onClose(t.id)}><X className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfirmModal({ open, onClose, onConfirm }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">Confirm data clear</h3>
          <button onClick={onClose}><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <p className="mt-3 text-sm text-slate-300">This action permanently clears the selected stored data.</p>
        <div className="mt-6 flex justify-end gap-3">
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={onConfirm}>Confirm</Btn>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ nav, setNav, drawer, setDrawer, profile }) {
  return (
    <>
      <div className={cn("fixed inset-0 z-20 bg-slate-950/70 md:hidden", drawer ? "block" : "hidden")} onClick={() => setDrawer(false)} />
      <aside className={cn("fixed left-0 top-0 z-30 flex h-screen w-[290px] flex-col border-r border-slate-800 bg-slate-950/95 px-4 py-5 backdrop-blur transition md:sticky md:translate-x-0", drawer ? "translate-x-0" : "-translate-x-full")}>
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">CareerForge AI</div>
            <div className="mt-2 text-lg font-semibold text-white">Career acceleration suite</div>
          </div>
          <button className="md:hidden" onClick={() => setDrawer(false)}><X className="h-5 w-5 text-slate-400" /></button>
        </div>
        <div className="mb-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 p-3 text-slate-950"><UserRound className="h-5 w-5" /></div>
            <div>
              <div className="font-medium text-white">{profile.name}</div>
              <div className="text-sm text-slate-400">{profile.targetRole}</div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {NAV.map(([id, label, icon]) => {
            const Icon = icon;
            return (
              <button key={id} onClick={() => { setNav(id); setDrawer(false); }} className={cn("flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition", nav === id ? "bg-gradient-to-r from-indigo-500/15 to-cyan-400/10 text-white shadow-[inset_3px_0_0_0_rgba(34,211,238,.85)]" : "text-slate-400 hover:bg-slate-900/70 hover:text-white")}>
                <Icon className="h-5 w-5" />
                {label}
              </button>
            );
          })}
        </div>
        <div className="mt-auto rounded-3xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-400">
          <div className="flex items-center gap-2 text-cyan-300"><Bot className="h-4 w-4" />Claude-powered coaching</div>
          <p className="mt-2">Resumes, mock interviews, gap analysis, study plans, and deep dives all live here.</p>
        </div>
      </aside>
    </>
  );
}

function MobileTop({ profile, open }) {
  return (
    <div className="mb-6 flex items-center justify-between md:hidden">
      <button className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3" onClick={open}><Menu className="h-5 w-5" /></button>
      <div className="text-right">
        <div className="text-xs uppercase tracking-[0.24em] text-cyan-300/80">CareerForge AI</div>
        <div className="text-sm text-slate-400">{profile.targetRole}</div>
      </div>
    </div>
  );
}

function Onboarding({ profile, setProfile, toast }) {
  const [step, setStep] = useState(0);
  const steps = ["Personal", "Target", "Background"];
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 text-sm text-cyan-200">Launch CareerForge AI</div>
          <h1 className="text-4xl font-semibold text-white">Build your career prep command center</h1>
          <p className="mt-3 text-slate-400">We’ll personalize resume writing, question practice, study plans, and mock interviews around your profile.</p>
        </div>
        <Card className="mx-auto max-w-4xl p-6 md:p-8">
          <div className="mb-8 flex items-center gap-3">
            {steps.map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-3">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-full border", i <= step ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200" : "border-slate-700 text-slate-500")}>{i + 1}</div>
                <div className="hidden text-sm text-slate-300 md:block">{s}</div>
              </div>
            ))}
          </div>
          {step === 0 && (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Full Name"><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
              <Field label="Email"><Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
              <Field label="Years of Experience"><Select value={profile.experience} onChange={(e) => setProfile({ ...profile, experience: e.target.value })}>{EXP.map((o) => <option key={o}>{o}</option>)}</Select></Field>
              <Field label="Current Role"><Input value={profile.currentRole} onChange={(e) => setProfile({ ...profile, currentRole: e.target.value })} /></Field>
            </div>
          )}
          {step === 1 && (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Target Job Title"><Input value={profile.targetRole} onChange={(e) => setProfile({ ...profile, targetRole: e.target.value })} /></Field>
              <Field label="Domain / Industry"><Select value={profile.domain} onChange={(e) => setProfile({ ...profile, domain: e.target.value })}>{DOMAINS.map((o) => <option key={o}>{o}</option>)}</Select></Field>
              <Field label="Target Companies" hint="Optional"><Input value={profile.targetCompanies} onChange={(e) => setProfile({ ...profile, targetCompanies: e.target.value })} /></Field>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Technical Skills"><TagInput value={profile.technicalSkills} onChange={(v) => setProfile({ ...profile, technicalSkills: v })} placeholder="React, Python, SQL" /></Field>
                <Field label="Soft Skills"><TagInput value={profile.softSkills} onChange={(v) => setProfile({ ...profile, softSkills: v })} placeholder="Communication, leadership" /></Field>
              </div>
              <div className="grid gap-5 md:grid-cols-3">
                <Field label="Degree"><Input value={profile.education.degree} onChange={(e) => setProfile({ ...profile, education: { ...profile.education, degree: e.target.value } })} /></Field>
                <Field label="Institution"><Input value={profile.education.institution} onChange={(e) => setProfile({ ...profile, education: { ...profile.education, institution: e.target.value } })} /></Field>
                <Field label="Year"><Input value={profile.education.year} onChange={(e) => setProfile({ ...profile, education: { ...profile.education, year: e.target.value } })} /></Field>
              </div>
              <Field label="Brief work history summary"><Area value={profile.workHistory} onChange={(e) => setProfile({ ...profile, workHistory: e.target.value })} /></Field>
            </div>
          )}
          <div className="mt-8 flex justify-between">
            <Btn variant="secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Btn>
            {step < 2 ? <Btn onClick={() => setStep((s) => s + 1)}>Continue</Btn> : <Btn onClick={() => toast("Profile saved", "Your workspace is ready.")}>Enter CareerForge AI</Btn>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function DashboardPage({ profile, ready, generatedResume, practicedQuestions, learningPath, mockSessions, dailyTip, loadingTip, generateTip, activityLog, setNav }) {
  const progress = [
    ["Resume Builder", generatedResume?.sections ? 100 : 20],
    ["Interview Practice", Math.min(100, practicedQuestions.length * 10)],
    ["Study Concepts", learningPath?.phases?.length ? (arr(learningPath.completedTopics).length / Math.max(1, learningPath.phases.reduce((a, p) => a + p.topics.length, 0))) * 100 : 0],
    ["Mock Interview", Math.min(100, mockSessions.length * 25)],
  ];
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-cyan-300/80">Welcome Back</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">{profile.name}, your path to {profile.targetRole} is taking shape.</h1>
            <p className="mt-3 max-w-2xl text-slate-400">CareerForge AI is tuned for {profile.domain} roles and your {profile.experience} experience band.</p>
            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Build Resume", FileText, "Generate ATS-ready resume", "resume"],
                ["Practice Questions", Target, "Run role-specific Q&A", "interview"],
                ["Study Gaps", BookOpen, "Create learning roadmap", "study"],
                ["Run Mock", Mic, "Simulate full interview", "mock"],
              ].map(([t, icon, b, to]) => {
                const Icon = icon;
                return (
                <button key={t} onClick={() => setNav(to)} className="rounded-3xl border border-slate-700/70 bg-slate-900/70 p-4 text-left">
                  <Icon className="mb-3 h-5 w-5 text-cyan-300" />
                  <div className="font-medium text-white">{t}</div>
                  <div className="mt-1 text-sm text-slate-400">{b}</div>
                </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-center rounded-3xl border border-slate-700/70 bg-slate-900/70 p-6"><Ring value={ready} label="Ready" sublabel="Readiness Score" /></div>
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <Title eyebrow="Momentum" title="Progress Across Modules" />
          <div className="mt-5 space-y-4">{progress.map(([l, v]) => <Bar key={l} label={l} value={v} />)}</div>
        </Card>
        <div className="space-y-6">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-cyan-300/80">Today&apos;s Tip</p>
                <h3 className="mt-2 text-xl font-semibold text-white">AI daily coaching</h3>
              </div>
              <Btn variant="secondary" className="px-3" onClick={generateTip} disabled={loadingTip} icon={RefreshCw}>Refresh</Btn>
            </div>
            <div className="mt-4 rounded-3xl border border-cyan-400/20 bg-cyan-400/6 p-5 text-sm leading-7 text-slate-200">{loadingTip ? "Generating..." : dailyTip?.tip || "Generate your first daily tip."}</div>
          </Card>
          <Card>
            <Title eyebrow="Recent Activity" title="Last 5 Actions" />
            <div className="mt-5 space-y-3">
              {activityLog.slice(0, 5).map((a) => (
                <div key={a.timestamp} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
                  <div><div className="text-sm text-white">{a.action}</div><div className="text-xs text-slate-500">{a.module}</div></div>
                  <div className="text-xs text-slate-500">{fmt(a.timestamp)}</div>
                </div>
              ))}
              {!activityLog.length && <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">Your activity feed will appear as you work through the platform.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ResumePage({ profile, resumeDraft, setResumeDraft, generatedResume, setGeneratedResume, resumeTips, setResumeTips, atsScore, setAtsScore, preview, setPreview, loading, runJson, toast, log }) {
  const [tab, setTab] = useState("Build Resume");
  const updateArr = (key, index, patch) => setResumeDraft({ ...resumeDraft, [key]: resumeDraft[key].map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const textResume = generatedResume?.sections ? JSON.stringify(generatedResume.sections, null, 2) : "";
  const generate = async () => {
    try {
      setPreview("");
      const sections = await runJson("resume", "You are an expert ATS resume writer. Return valid JSON only.", `Based on this candidate profile: ${JSON.stringify(profile)} and resume draft ${JSON.stringify(resumeDraft)}, generate a complete ATS-optimized resume tailored for ${profile.targetRole}. Use strong action verbs, quantify achievements where possible, include relevant keywords from this job description: ${resumeDraft.jobDescription || "none"}. Return JSON with sections: summary, experience, education, skills, projects, certifications.`, setPreview);
      setGeneratedResume({ sections, generatedAt: new Date().toISOString() });
      setPreview("");
      log("Generated AI resume", "Resume Builder");
      toast("Resume ready", "Your ATS-optimized resume has been generated.");
    } catch (e) {
      toast("Resume generation failed", e.message, "error");
    }
  };
  const analyze = async () => {
    if (!generatedResume?.sections) return toast("Generate resume first", "We need a resume before analyzing.", "error");
    try {
      const data = await runJson("resumeTips", "You are an expert resume reviewer. Return valid JSON only.", `Analyze this resume ${JSON.stringify(generatedResume.sections)} against job description ${resumeDraft.jobDescription || "none"}. Return { tips:[{category,priority,issue,before,after}] }.`);
      setResumeTips({ ...data, generatedAt: new Date().toISOString() });
      log("Analyzed resume for improvements", "Resume Builder");
    } catch (e) {
      toast("Analysis failed", e.message, "error");
    }
  };
  const score = async () => {
    if (!generatedResume?.sections) return toast("Generate resume first", "We need a resume before scoring it.", "error");
    try {
      const data = await runJson("ats", "You are an ATS scoring engine. Return valid JSON only.", `Score this resume ${JSON.stringify(generatedResume.sections)} against ${resumeDraft.jobDescription || "none"}. Return { score, breakdown:{keywordMatch,structure,actionVerbs,measurableImpact,readability}, improvements:[] }.`);
      setAtsScore({ ...data, generatedAt: new Date().toISOString() });
      log("Checked ATS compatibility", "Resume Builder");
    } catch (e) {
      toast("ATS scoring failed", e.message, "error");
    }
  };
  return (
    <div className="space-y-6">
      <Title eyebrow="Resume Builder" title="Craft an ATS-optimized resume" action={<Tabs items={["Build Resume", "View & Edit", "Improvement Tips", "ATS Score"]} value={tab} onChange={setTab} />} />
      {tab === "Build Resume" && (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              {["name", "email", "phone", "location", "linkedIn", "github"].map((key) => (
                <Field key={key} label={key[0].toUpperCase() + key.slice(1)}><Input value={resumeDraft.personal[key]} onChange={(e) => setResumeDraft({ ...resumeDraft, personal: { ...resumeDraft.personal, [key]: e.target.value } })} placeholder={profile[key] || ""} /></Field>
              ))}
            </div>
            <SectionRepeater title="Work Experience" items={resumeDraft.experience} add={() => setResumeDraft({ ...resumeDraft, experience: [...resumeDraft.experience, { id: uid(), company: "", role: "", duration: "", location: "", responsibilities: "" }] })} remove={(id) => setResumeDraft({ ...resumeDraft, experience: resumeDraft.experience.filter((x) => x.id !== id) })}>
              {(item, i) => (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Company"><Input value={item.company} onChange={(e) => updateArr("experience", i, { company: e.target.value })} /></Field>
                    <Field label="Role"><Input value={item.role} onChange={(e) => updateArr("experience", i, { role: e.target.value })} /></Field>
                    <Field label="Duration"><Input value={item.duration} onChange={(e) => updateArr("experience", i, { duration: e.target.value })} /></Field>
                    <Field label="Location"><Input value={item.location} onChange={(e) => updateArr("experience", i, { location: e.target.value })} /></Field>
                  </div>
                  <Field label="Responsibilities"><Area value={item.responsibilities} onChange={(e) => updateArr("experience", i, { responsibilities: e.target.value })} /></Field>
                </>
              )}
            </SectionRepeater>
            <div className="grid gap-6 xl:grid-cols-2">
              <SectionRepeater title="Education" items={resumeDraft.education} add={() => setResumeDraft({ ...resumeDraft, education: [...resumeDraft.education, { id: uid(), degree: "", institution: "", year: "", gpa: "" }] })} remove={(id) => setResumeDraft({ ...resumeDraft, education: resumeDraft.education.filter((x) => x.id !== id) })}>
                {(item, i) => (
                  <div className="grid gap-4">
                    {["degree", "institution", "year", "gpa"].map((key) => <Field key={key} label={key.toUpperCase()}><Input value={item[key]} onChange={(e) => updateArr("education", i, { [key]: e.target.value })} /></Field>)}
                  </div>
                )}
              </SectionRepeater>
              <SectionRepeater title="Projects" items={resumeDraft.projects} add={() => setResumeDraft({ ...resumeDraft, projects: [...resumeDraft.projects, { id: uid(), name: "", techStack: "", description: "", link: "" }] })} remove={(id) => setResumeDraft({ ...resumeDraft, projects: resumeDraft.projects.filter((x) => x.id !== id) })}>
                {(item, i) => (
                  <div className="grid gap-4">
                    {["name", "techStack", "link"].map((key) => <Field key={key} label={key}><Input value={item[key]} onChange={(e) => updateArr("projects", i, { [key]: e.target.value })} /></Field>)}
                    <Field label="Description"><Area value={item.description} onChange={(e) => updateArr("projects", i, { description: e.target.value })} /></Field>
                  </div>
                )}
              </SectionRepeater>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Technical Skills"><TagInput value={resumeDraft.skills.technical} onChange={(v) => setResumeDraft({ ...resumeDraft, skills: { ...resumeDraft.skills, technical: v } })} placeholder="React, Node.js" /></Field>
              <Field label="Soft Skills"><TagInput value={resumeDraft.skills.soft} onChange={(v) => setResumeDraft({ ...resumeDraft, skills: { ...resumeDraft.skills, soft: v } })} placeholder="Ownership, communication" /></Field>
            </div>
            <Field label="Certifications"><Input value={resumeDraft.skills.certifications} onChange={(e) => setResumeDraft({ ...resumeDraft, skills: { ...resumeDraft.skills, certifications: e.target.value } })} /></Field>
            <Field label="Target Job Description"><Area value={resumeDraft.jobDescription} onChange={(e) => setResumeDraft({ ...resumeDraft, jobDescription: e.target.value })} /></Field>
            <Btn onClick={generate} icon={Wand2} disabled={loading.resume}> {loading.resume ? "Generating Resume..." : "Generate AI Resume"} </Btn>
          </Card>
          <Card>
            <Title eyebrow="AI Output" title="Generation Preview" />
            <div className="mt-5 rounded-3xl border border-slate-700/80 bg-slate-950/70 p-5">
              {loading.resume ? <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{preview || "CareerForge AI is drafting your resume..."}</pre> : generatedResume?.sections ? <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-300">{JSON.stringify(generatedResume.sections, null, 2)}</pre> : <Empty icon={FileText} title="No resume generated yet" body="Fill in your draft and generate a role-specific resume." />}
            </div>
          </Card>
        </div>
      )}
      {tab === "View & Edit" && (generatedResume?.sections ? <Card className="space-y-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-xl font-semibold text-white">Resume JSON editor</h3><p className="text-sm text-slate-400">Edit the generated structure directly, then copy or download it.</p></div><div className="flex gap-3"><Btn variant="secondary" icon={Copy} onClick={() => navigator.clipboard.writeText(textResume)}>Copy Resume Text</Btn><Btn variant="secondary" icon={Download} onClick={() => { const b = new Blob([textResume], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "careerforge-resume.txt"; a.click(); }}>Download as Text</Btn></div></div><Area className="min-h-[540px]" value={JSON.stringify(generatedResume.sections, null, 2)} onChange={(e) => { try { setGeneratedResume({ ...generatedResume, sections: JSON.parse(e.target.value) }); } catch (error) { console.error(error); } }} /></Card> : <Empty icon={FileText} title="Generate a resume first" body="Once generated, you can edit every field inline via the JSON editor." />)}
      {tab === "Improvement Tips" && (resumeTips?.tips?.length ? <Card className="space-y-5"><div className="flex justify-between gap-3"><div><h3 className="text-xl font-semibold text-white">Resume improvement coach</h3><p className="text-sm text-slate-400">Action verbs, keyword gaps, metrics, formatting, and summary strength.</p></div><Btn onClick={analyze} icon={Sparkles} disabled={loading.resumeTips}>{loading.resumeTips ? "Analyzing..." : "Analyze My Resume for Improvements"}</Btn></div><div className="grid gap-4 xl:grid-cols-2">{resumeTips.tips.map((tip, i) => <div key={i} className={cn("rounded-3xl border p-5", tip.priority === "Critical" ? "border-rose-500/30 bg-rose-500/8" : tip.priority === "Suggested" ? "border-amber-500/30 bg-amber-500/8" : "border-emerald-500/30 bg-emerald-500/8")}><div className="flex justify-between"><div className="font-medium text-white">{tip.category}</div><span className="rounded-full bg-slate-900/70 px-3 py-1 text-xs text-slate-200">{tip.priority}</span></div><div className="mt-3 text-sm text-slate-300">{tip.issue}</div><div className="mt-4 rounded-2xl bg-slate-950/60 p-4 text-sm"><div className="text-slate-500">Before</div><div className="mt-1 text-slate-300">{tip.before}</div><div className="mt-3 text-slate-500">After</div><div className="mt-1 text-cyan-100">{tip.after}</div></div></div>)}</div></Card> : <Empty icon={Sparkles} title="No analysis yet" body="Run the improvement pass to get categorized tips with before-and-after examples." action={<Btn onClick={analyze} icon={Sparkles} disabled={loading.resumeTips}>{loading.resumeTips ? "Analyzing..." : "Analyze Resume"}</Btn>} />)}
      {tab === "ATS Score" && (atsScore?.breakdown ? <Card className="space-y-5"><div className="flex justify-between gap-3"><div><h3 className="text-xl font-semibold text-white">ATS compatibility review</h3><p className="text-sm text-slate-400">Score your keyword match, structure, action verbs, metrics, and readability.</p></div><Btn onClick={score} icon={Gauge} disabled={loading.ats}>{loading.ats ? "Scoring..." : "Check ATS Compatibility"}</Btn></div><div className="grid gap-5 md:grid-cols-3 xl:grid-cols-6"><Card className="col-span-2 flex items-center justify-center bg-slate-950/45"><Ring value={atsScore.score} label="ATS" sublabel="Overall Score" /></Card>{Object.entries(atsScore.breakdown).map(([k, v]) => <div key={k} className="rounded-3xl border border-slate-700/70 bg-slate-900/60 p-4 text-center"><div className="text-2xl font-semibold text-white">{v}</div><div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-400">{k}</div></div>)}</div><div className="space-y-3">{arr(atsScore.improvements).map((item) => <div key={item} className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">{item}</div>)}</div></Card> : <Empty icon={Gauge} title="ATS scoring not run yet" body="Generate your score to see which changes will move the needle fastest." action={<Btn onClick={score} icon={Gauge} disabled={loading.ats}>{loading.ats ? "Scoring..." : "Check ATS Compatibility"}</Btn>} />)}
    </div>
  );
}

function SectionRepeater({ title, items, add, remove, children }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <Btn variant="secondary" className="px-3" onClick={add} icon={Plus}>Add</Btn>
      </div>
      {items.map((item, i) => (
        <div key={item.id} className="rounded-3xl border border-slate-700/80 bg-slate-900/70 p-4">
          {items.length > 1 && <div className="mb-3 flex justify-end"><button onClick={() => remove(item.id)} className="rounded-xl p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></div>}
          {children(item, i)}
        </div>
      ))}
    </div>
  );
}

function InterviewPage({ profile, practicedQuestions, setPracticedQuestions, savedQuestions, setSavedQuestions, loading, runJson, log }) {
  const [tab, setTab] = useState("Question Bank");
  const [cfg, setCfg] = useState({ category: "Technical", difficulty: "Mixed", count: 10, topic: "" });
  const [questions, setQuestions] = useState([]);
  const [open, setOpen] = useState(-1);
  const [selected, setSelected] = useState(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (tab !== "Practice Mode" || !selected) return;
    const t = setInterval(() => setTime((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [tab, selected]);
  const generate = async () => {
    const data = await runJson("questions", "You are an interview preparation coach. Return valid JSON only.", `Generate ${cfg.count} ${cfg.category} interview questions for a ${profile.targetRole} position at ${profile.experience} level, focusing on ${cfg.topic || "general coverage"}. For each question provide question, whyAsked, framework, keyPoints, mistakes, difficulty, type. Return JSON array.`);
    setQuestions(Array.isArray(data) ? data : []);
    log(`Generated ${cfg.count} interview questions`, "Interview Prep");
  };
  const evaluate = async () => {
    const data = await runJson("feedback", "You are an expert interview evaluator. Return valid JSON only.", `Evaluate this answer. Question: ${selected.question}. Answer: ${answer}. Target role: ${profile.targetRole}, Experience: ${profile.experience}. Return { score, justification, strengths, gaps, improvedAnswer, actionItems, starCheck }.`);
    setFeedback(data);
    setPracticedQuestions((p) => [{ question: selected.question, userAnswer: answer, score: data.score, feedback: data, date: new Date().toISOString(), category: selected.type || cfg.category }, ...p]);
    log("Received AI feedback on practice answer", "Interview Prep");
  };
  return (
    <div className="space-y-6">
      <Title eyebrow="Interview Prep" title="Generate, practice, and review role-specific interview questions" action={<Tabs items={["Question Bank", "Practice Mode", "Saved Answers"]} value={tab} onChange={setTab} />} />
      {tab === "Question Bank" && <Card className="space-y-6"><div className="grid gap-5 xl:grid-cols-5"><Field label="Category"><Select value={cfg.category} onChange={(e) => setCfg({ ...cfg, category: e.target.value })}>{["Technical", "Behavioral", "Situational", "HR/Culture", "Case Study"].map((o) => <option key={o}>{o}</option>)}</Select></Field><Field label="Difficulty"><Select value={cfg.difficulty} onChange={(e) => setCfg({ ...cfg, difficulty: e.target.value })}>{["Easy", "Medium", "Hard", "Mixed"].map((o) => <option key={o}>{o}</option>)}</Select></Field><Field label="Questions"><Select value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: Number(e.target.value) })}>{[5, 10, 15, 20].map((o) => <option key={o} value={o}>{o}</option>)}</Select></Field><Field label="Specific Topic"><Input value={cfg.topic} onChange={(e) => setCfg({ ...cfg, topic: e.target.value })} /></Field><div className="flex items-end"><Btn className="w-full" onClick={generate} icon={Sparkles} disabled={loading.questions}>{loading.questions ? "Generating..." : "Generate Questions"}</Btn></div></div>{questions.length ? questions.map((q, i) => <div key={i} className="rounded-3xl border border-slate-700/80 bg-slate-900/60"><button className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left" onClick={() => setOpen(open === i ? -1 : i)}><div><div className="font-medium text-white">{q.question}</div><div className="mt-2 flex gap-2 text-xs"><span className="rounded-full bg-slate-800 px-3 py-1">{q.difficulty}</span><span className="rounded-full bg-slate-800 px-3 py-1">{cfg.category}</span></div></div>{open === i ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}</button>{open === i && <div className="border-t border-slate-800 px-5 py-5"><div className="grid gap-4 xl:grid-cols-2"><div className="rounded-2xl bg-slate-950/60 p-4"><div className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">Why asked</div><div className="mt-2 text-sm text-slate-300">{q.whyAsked}</div></div><div className="rounded-2xl bg-slate-950/60 p-4"><div className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">Answer framework</div><div className="mt-2 text-sm text-slate-300">{q.framework}</div></div></div><div className="mt-4 flex gap-3"><Btn onClick={() => { setSelected(q); setTab("Practice Mode"); setAnswer(""); setFeedback(null); setTime(0); }}>Practice This</Btn><Btn variant="secondary" onClick={() => setSavedQuestions((p) => p.some((x) => x.question === q.question) ? p.filter((x) => x.question !== q.question) : [...p, q])}>{savedQuestions.some((x) => x.question === q.question) ? "Saved" : "Save"}</Btn></div></div>}</div>) : <Empty icon={Target} title="No question bank yet" body="Generate role-specific questions to begin." />}</Card>}
      {tab === "Practice Mode" && (selected ? <Card className="space-y-6"><div className="flex items-center justify-between"><div><div className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">Practice Prompt</div><h3 className="mt-2 text-xl font-semibold text-white">{selected.question}</h3></div><div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">Timer · {Math.floor(time / 60)}:{String(time % 60).padStart(2, "0")}</div></div><Area className="min-h-[220px]" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer..." /><div className="flex gap-3"><Btn onClick={evaluate} icon={Sparkles} disabled={loading.feedback || !answer.trim()}>{loading.feedback ? "Evaluating..." : "Submit for AI Feedback"}</Btn><Btn variant="secondary" onClick={() => { setAnswer(""); setFeedback(null); }}>Reset</Btn></div>{feedback && <div className="space-y-5 rounded-3xl border border-slate-700/80 bg-slate-900/65 p-5"><div className={cn("text-3xl font-semibold", scoreColor(feedback.score))}>{feedback.score}/10</div><div className="text-sm text-slate-300">{feedback.justification}</div><div className="grid gap-4 xl:grid-cols-2"><ListBox title="Strengths" items={feedback.strengths} good /><ListBox title="Improvements" items={feedback.gaps} /></div><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/6 p-4 text-sm text-slate-200"><div className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">Improved answer</div><div className="mt-2">{feedback.improvedAnswer}</div></div><div className="rounded-2xl bg-slate-950/65 p-4 text-sm text-slate-300"><div className="text-xs uppercase tracking-[0.2em] text-slate-500">STAR check</div><div className="mt-2">{feedback.starCheck}</div></div></div>}</Card> : <Empty icon={Target} title="Pick a question to practice" body="Use Question Bank to generate prompts, then jump into practice mode." />)}
      {tab === "Saved Answers" && (practicedQuestions.length ? <div className="space-y-4">{practicedQuestions.map((p, i) => <Card key={i}><div className="flex items-start justify-between gap-4"><div><div className="text-sm text-slate-500">{fmt(p.date)}</div><h3 className="mt-2 text-lg font-semibold text-white">{p.question}</h3></div><div className={cn("text-2xl font-semibold", scoreColor(p.score))}>{p.score}/10</div></div><div className="mt-4 grid gap-4 xl:grid-cols-2"><div className="rounded-2xl bg-slate-900/70 p-4 text-sm text-slate-300">{p.userAnswer}</div><div className="rounded-2xl bg-slate-900/70 p-4 text-sm text-slate-300">{p.feedback?.justification}</div></div></Card>)}</div> : <Empty icon={CheckCircle2} title="No practice history yet" body="Your scored answers will show up here." />)}
    </div>
  );
}

function StudyPage({ profile, learningPath, setLearningPath, deepDive, setDeepDive, practiceNotes, setPracticeNotes, flashcards, setFlashcards, loading, runJson, runText, toast, log }) {
  const [tab, setTab] = useState("Learning Path");
  const [open, setOpen] = useState("");
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const total = learningPath?.phases?.reduce((a, p) => a + p.topics.length, 0) || 0;
  const done = arr(learningPath?.completedTopics).length;
  const genPath = async () => {
    const data = await runJson("learningPath", "You are a career learning strategist. Return valid JSON only.", `Create a structured learning path for a ${profile.targetRole} candidate with ${profile.experience} experience. Organize into phases with topics having id, name, why, keyConcepts, hours, priority, resources. Return { phases:[...] }.`);
    setLearningPath({ phases: arr(data.phases).map((p) => ({ ...p, topics: arr(p.topics).map((t) => ({ ...t, id: t.id || uid(), keyConcepts: arr(t.keyConcepts), resources: arr(t.resources) })) })), completedTopics: learningPath.completedTopics || [], generatedAt: new Date().toISOString() });
    log("Generated learning path", "Study Concepts");
  };
  const dive = async () => {
    if (!deepDive.topic.trim()) return toast("Choose a topic", "Enter a topic for the deep dive.", "error");
    const content = await runText("deepDive", "You are an expert technical and career coach.", `Explain ${deepDive.topic} in depth for a ${profile.targetRole} interview preparation context. Cover explanation, real-world usage, 5 questions, key terms, misconceptions, analogies, and related topics.`);
    setDeepDive({ ...deepDive, content });
    log(`Generated deep dive for ${deepDive.topic}`, "Study Concepts");
  };
  const genCards = async () => {
    if (!flashcards.topic.trim()) return toast("Choose a topic", "Enter a topic or role for flashcards.", "error");
    const data = await runJson("flashcards", "You create concise interview-prep flashcards. Return valid JSON only.", `Generate 12 flashcards for ${flashcards.topic} as [{question,answer}].`);
    setFlashcards({ ...flashcards, cards: Array.isArray(data) ? data : [] });
    setI(0);
    setFlip(false);
    log(`Generated flashcards for ${flashcards.topic}`, "Study Concepts");
  };
  return (
    <div className="space-y-6">
      <Title eyebrow="Study Concepts" title="Turn gaps into a structured learning path" action={<Tabs items={["Learning Path", "Topic Deep Dive", "Flashcards"]} value={tab} onChange={setTab} />} />
      {tab === "Learning Path" && <Card className="space-y-6"><div className="flex justify-between gap-3"><div><h3 className="text-xl font-semibold text-white">Your role-specific roadmap</h3><p className="text-sm text-slate-400">Foundations through practical application, built for {profile.targetRole}.</p></div><Btn onClick={genPath} icon={Brain} disabled={loading.learningPath}>{loading.learningPath ? "Generating..." : "Generate My Learning Path"}</Btn></div>{learningPath?.phases?.length ? <><Bar label="Overall Completion" value={total ? (done / total) * 100 : 0} subtitle={`${done}/${total} topics complete`} /><div className="space-y-5">{learningPath.phases.map((phase) => <div key={phase.name} className="rounded-3xl border border-slate-700/80 bg-slate-900/65 p-5"><h4 className="text-lg font-semibold text-white">{phase.name}</h4><p className="text-sm text-slate-400">{phase.summary}</p><div className="mt-4 space-y-3">{phase.topics.map((t) => <div key={t.id} className="rounded-2xl border border-slate-800 bg-slate-950/55"><button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === t.id ? "" : t.id)}><input type="checkbox" checked={arr(learningPath.completedTopics).includes(t.id)} onChange={() => setLearningPath({ ...learningPath, completedTopics: arr(learningPath.completedTopics).includes(t.id) ? learningPath.completedTopics.filter((x) => x !== t.id) : [...arr(learningPath.completedTopics), t.id] })} className="h-4 w-4 accent-cyan-400" /><div className="flex-1"><div className="font-medium text-white">{t.name}</div><div className="mt-1 text-xs text-slate-500">{t.priority} priority · {t.hours}h</div></div>{open === t.id ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}</button>{open === t.id && <div className="border-t border-slate-800 px-4 py-4 text-sm text-slate-300"><div className="mb-3">{t.why}</div>{arr(t.keyConcepts).map((c) => <div key={c} className="mb-2 flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-300" /><span>{c}</span></div>)}</div>}</div>)}</div></div>)}</div></> : <Empty icon={BookOpen} title="Learning path not generated" body="Generate a phase-by-phase roadmap to organize what to study." />}</Card>}
      {tab === "Topic Deep Dive" && <Card className="space-y-6"><Field label="Topic"><div className="flex gap-3"><Input value={deepDive.topic} onChange={(e) => setDeepDive({ ...deepDive, topic: e.target.value })} placeholder="System design, hooks, SQL optimization..." /><Btn onClick={dive} disabled={loading.deepDive} icon={Search}>{loading.deepDive ? "Loading..." : "Deep Dive"}</Btn></div></Field>{deepDive.content ? <><div className="rounded-3xl border border-slate-700/80 bg-slate-950/65 p-5 text-sm leading-7 whitespace-pre-wrap text-slate-200">{deepDive.content}</div><Btn variant="secondary" icon={Save} onClick={() => setPracticeNotes({ ...practiceNotes, [deepDive.topic]: deepDive.content })}>Save to Notes</Btn></> : <Empty icon={Brain} title="Pick a topic to unpack" body="Get an interview-focused explanation with key terms, misconceptions, and likely questions." />}</Card>}
      {tab === "Flashcards" && <Card className="space-y-6"><div className="flex flex-wrap items-end gap-4"><Field label="Role or Topic"><Input value={flashcards.topic} onChange={(e) => setFlashcards({ ...flashcards, topic: e.target.value })} placeholder={profile.targetRole || "React hooks"} /></Field><Btn onClick={genCards} disabled={loading.flashcards} icon={Sparkles}>{loading.flashcards ? "Generating..." : "Generate Flashcards"}</Btn></div>{flashcards.cards?.length ? <><div className="min-h-[280px] cursor-pointer rounded-[32px] border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-950 p-8" onClick={() => setFlip((v) => !v)}><div className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">{flip ? "Answer" : "Question"}</div><div className="mt-6 text-2xl font-semibold leading-10 text-white">{flip ? flashcards.cards[i].answer : flashcards.cards[i].question}</div></div><div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm text-slate-400">{i + 1}/{flashcards.cards.length} cards reviewed</div><div className="flex gap-3"><Btn variant="secondary" disabled={i === 0} onClick={() => { setI((v) => Math.max(0, v - 1)); setFlip(false); }}>Previous</Btn><Btn variant="secondary" disabled={i === flashcards.cards.length - 1} onClick={() => { setI((v) => Math.min(flashcards.cards.length - 1, v + 1)); setFlip(false); }}>Next</Btn><Btn onClick={() => { setFlashcards({ ...flashcards, cards: [...flashcards.cards].sort(() => Math.random() - 0.5) }); setI(0); setFlip(false); }} icon={RefreshCw}>Shuffle Deck</Btn></div></div></> : <Empty icon={Brain} title="No flashcards yet" body="Generate a deck for a topic or role and click the card to reveal answers." />}</Card>}
    </div>
  );
}

function ListBox({ title, items, good }) {
  return <div className="rounded-2xl bg-slate-950/65 p-4"><div className={cn("mb-3 text-xs uppercase tracking-[0.2em]", good ? "text-emerald-300/80" : "text-amber-300/80")}>{title}</div><div className="space-y-2 text-sm text-slate-300">{arr(items).map((item) => <div key={item} className="flex gap-2">{good ? <Check className="mt-0.5 h-4 w-4 text-emerald-300" /> : <Sparkles className="mt-0.5 h-4 w-4 text-amber-300" />}<span>{item}</span></div>)}</div></div>;
}

function MockPage({ profile, settings, currentSession, setCurrentSession, setMockSessions, loading, runJson, log }) {
  const [tab, setTab] = useState(currentSession ? "In Progress" : "Start Session");
  const [cfg, setCfg] = useState({ type: "Mixed", count: 5, difficulty: "Progressive", persona: "Friendly", style: "Startup" });
  const [elapsed, setElapsed] = useState(0);
  const q = currentSession?.questions?.[currentSession.currentIndex];
  const a = currentSession?.answers?.[currentSession.currentIndex];
  useEffect(() => {
    if (!currentSession || currentSession.overallFeedback) return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [currentSession]);
  const start = async () => {
    const data = await runJson("session", "You are a mock interview generator. Return valid JSON only.", `Generate ${cfg.count} interview questions for a ${cfg.type} round for ${profile.targetRole}. Interviewer persona: ${cfg.persona}. Company style: ${cfg.style}. Difficulty: ${cfg.difficulty}. Return array with question, type, expectedDuration, followUpQuestion, keyEvalCriteria, difficulty.`);
    setCurrentSession({ id: uid(), date: new Date().toISOString(), config: cfg, questions: Array.isArray(data) ? data : [], answers: [], currentIndex: 0, startTime: Date.now(), overallScore: 0, overallFeedback: null, durationMinutes: 0, hint: "" });
    setTab("In Progress");
    setElapsed(0);
    log("Started mock interview session", "Mock Interview");
  };
  const submit = async () => {
    const answer = a?.answer;
    if (!answer?.trim()) return;
    const ev = await runJson("sessionAnswer", "You are an interviewer evaluating a candidate. Return valid JSON only.", `You are an interviewer at a ${currentSession.config.style} company evaluating a ${profile.targetRole} candidate. Question asked: ${q.question}. Candidate answered: ${answer}. Return { score, oneLineVerdict, strengthsInAnswer, missedPoints, improvedAnswerSample }.`);
    const answers = [...currentSession.answers];
    answers[currentSession.currentIndex] = { ...a, question: q.question, answer, evaluation: ev };
    setCurrentSession({ ...currentSession, answers });
  };
  const finish = async () => {
    const report = await runJson("sessionAnswer", "You are an interview debrief coach. Return valid JSON only.", `Based on this mock interview session ${JSON.stringify(currentSession)}, generate { summary, strengths, improvements, nextSteps, radar:{technicalKnowledge,communication,problemSolving,cultureFit,answerDepth} }.`);
    const scores = currentSession.answers.map((x) => Number(x?.evaluation?.score || 0));
    const overallScore = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : 0;
    const final = { ...currentSession, overallScore, overallFeedback: report, durationMinutes: Math.max(1, Math.round((Date.now() - currentSession.startTime) / 60000)) };
    setCurrentSession(final);
    setMockSessions((p) => [final, ...p]);
    setTab("Session Review");
    log("Completed mock interview session", "Mock Interview");
  };
  return (
    <div className="space-y-6">
      <Title eyebrow="Mock Interview" title="Run a full interview simulation with AI scoring and coaching" action={<Tabs items={["Start Session", "In Progress", "Session Review"]} value={tab} onChange={setTab} />} />
      {tab === "Start Session" && <Card className="space-y-6"><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">{[["type", ["Technical", "Behavioral", "Mixed", "HR Round"]], ["count", [5, 8, 12]], ["difficulty", ["Easy", "Medium", "Hard", "Progressive"]], ["persona", ["Friendly", "Neutral", "Challenging"]], ["style", ["Startup", "FAANG", "Traditional Corporate", "Consulting"]]].map(([key, list]) => <Field key={key} label={key}><Select value={cfg[key]} onChange={(e) => setCfg({ ...cfg, [key]: key === "count" ? Number(e.target.value) : e.target.value })}>{list.map((o) => <option key={o} value={o}>{key === "count" ? `${o} questions` : o}</option>)}</Select></Field>)}</div><Btn onClick={start} disabled={loading.session} icon={Mic}>{loading.session ? "Starting Interview..." : "Start Interview"}</Btn></Card>}
      {tab === "In Progress" && (currentSession && q ? <Card className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 p-3 text-slate-950"><Bot className="h-5 w-5" /></div><div><div className="text-sm text-slate-400">{currentSession.config.persona} interviewer</div><div className="font-medium text-white">Question {currentSession.currentIndex + 1} of {currentSession.questions.length}</div></div></div>{settings.showTimers && <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">Session time · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</div>}</div><div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"><div className="rounded-[32px] border border-slate-700/80 bg-slate-900/70 p-6"><div className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">Interviewer</div><div className="mt-4 rounded-3xl bg-slate-950/70 p-5 text-lg leading-9 text-white">{q.question}</div><Btn variant="secondary" className="mt-4" onClick={() => setCurrentSession({ ...currentSession, hint: q.keyEvalCriteria?.[0] || "Anchor your answer around context, action, and outcome." })}>I need a hint</Btn>{currentSession.hint && <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/8 p-4 text-sm text-amber-100">{currentSession.hint}</div>}</div><div className="space-y-4"><Area className="min-h-[280px]" value={a?.answer || ""} onChange={(e) => { const answers = [...currentSession.answers]; answers[currentSession.currentIndex] = { ...(answers[currentSession.currentIndex] || {}), answer: e.target.value }; setCurrentSession({ ...currentSession, answers }); }} placeholder="Your answer..." /><div className="flex gap-3"><Btn onClick={submit} disabled={loading.sessionAnswer || !(a?.answer || "").trim()} icon={Sparkles}>{loading.sessionAnswer ? "Evaluating..." : "Submit Answer"}</Btn>{a?.evaluation && currentSession.answers.filter((x) => x?.evaluation).length < currentSession.questions.length && <Btn variant="secondary" onClick={() => setCurrentSession({ ...currentSession, currentIndex: Math.min(currentSession.questions.length - 1, currentSession.currentIndex + 1), hint: "" })}>Next Question</Btn>}{a?.evaluation && currentSession.answers.filter((x) => x?.evaluation).length === currentSession.questions.length && <Btn onClick={finish} icon={BarChart3}>Complete Interview Analysis</Btn>}</div>{a?.evaluation && <div className="rounded-3xl border border-slate-700/80 bg-slate-900/70 p-5"><div className={cn("text-3xl font-semibold", scoreColor(a.evaluation.score))}>{a.evaluation.score}/10</div><div className="mt-2 text-sm text-slate-300">{a.evaluation.oneLineVerdict}</div><div className="mt-4 grid gap-4 xl:grid-cols-2"><ListBox title="Strengths" items={a.evaluation.strengthsInAnswer} good /><ListBox title="Missed points" items={a.evaluation.missedPoints} /></div><div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/6 p-4 text-sm text-slate-200">{a.evaluation.improvedAnswerSample}</div></div>}</div></div></Card> : <Empty icon={Mic} title="No interview in progress" body="Start a mock interview to simulate a live round." />)}
      {tab === "Session Review" && (currentSession?.overallFeedback ? <div className="space-y-6"><Card><div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]"><div className="flex items-center justify-center rounded-3xl border border-slate-700/80 bg-slate-950/60 p-5"><Ring value={currentSession.overallScore * 10} label={grade(currentSession.overallScore)} sublabel={`${currentSession.overallScore.toFixed(1)}/10 overall`} /></div><div className="space-y-4"><div className="grid gap-4 md:grid-cols-3"><Stat label="Grade" value={grade(currentSession.overallScore)} /><Stat label="Duration" value={`${currentSession.durationMinutes} min`} /><Stat label="Questions" value={currentSession.questions.length} /></div><div className="rounded-3xl border border-slate-700/80 bg-slate-950/60 p-5 text-sm leading-7 text-slate-300">{currentSession.overallFeedback.summary}</div></div></div></Card><Card className="grid gap-4 md:grid-cols-2"><ListBox title="Top strengths" items={currentSession.overallFeedback.strengths} good /><ListBox title="Areas to improve" items={currentSession.overallFeedback.improvements} /><div className="md:col-span-2 rounded-3xl border border-cyan-400/20 bg-cyan-400/8 p-5"><div className="text-sm font-medium text-white">Recommended next steps</div><div className="mt-3 space-y-2 text-sm text-slate-200">{arr(currentSession.overallFeedback.nextSteps).map((x) => <div key={x} className="flex gap-2"><ChevronRight className="mt-0.5 h-4 w-4 text-cyan-300" /><span>{x}</span></div>)}</div></div></Card><Card className="space-y-3"><h3 className="text-xl font-semibold text-white">Question-by-question review</h3>{currentSession.questions.map((qq, idx) => <details key={idx} className="rounded-3xl border border-slate-700/80 bg-slate-900/60 p-5"><summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-4"><div className="font-medium text-white">{qq.question}</div><div className={cn("text-lg font-semibold", scoreColor(currentSession.answers[idx]?.evaluation?.score || 0))}>{currentSession.answers[idx]?.evaluation?.score || 0}/10</div></div></summary><div className="mt-4 grid gap-4 xl:grid-cols-2"><div className="rounded-2xl bg-slate-950/60 p-4 text-sm text-slate-300">{currentSession.answers[idx]?.answer}</div><div className="rounded-2xl bg-slate-950/60 p-4 text-sm text-slate-300">{currentSession.answers[idx]?.evaluation?.improvedAnswerSample}</div></div></details>)}</Card></div> : <Empty icon={BarChart3} title="No completed mock session yet" body="Finish a session to unlock the full review." />)}
    </div>
  );
}

function Stat({ label, value }) {
  return <div className="rounded-2xl bg-slate-900/70 p-4"><div className="text-sm text-slate-400">{label}</div><div className="mt-2 text-2xl font-semibold text-white">{value}</div></div>;
}

function AnalyticsPage({ ready, profile, practicedQuestions, mockSessions, learningPath, studyPlan, setStudyPlan, achievements, loading, runJson, generatedResume, log }) {
  const avg = mockSessions.length ? mockSessions.reduce((a, s) => a + s.overallScore, 0) / mockSessions.length : 0;
  const done = arr(learningPath?.completedTopics).length;
  const mins = mockSessions.reduce((a, s) => a + (s.durationMinutes || 0), 0) + practicedQuestions.length * 8;
  const bars = Object.entries(practicedQuestions.reduce((a, p) => { const k = p.category || "General"; a[k] = a[k] || { total: 0, count: 0 }; a[k].total += Number(p.score || 0); a[k].count += 1; return a; }, {})).map(([label, d]) => [label, d.total / d.count]);
  const line = mockSessions.map((s, i) => `${mockSessions.length === 1 ? 20 : (i / (mockSessions.length - 1)) * 280 + 20},${160 - ((s.overallScore || 0) / 10) * 130}`).join(" ");
  const gap = async () => {
    const data = await runJson("skillGap", "You are a career strategy analyst. Return valid JSON only.", `Based on this candidate profile ${JSON.stringify(profile)}, resume ${JSON.stringify(generatedResume?.sections || {})}, mock interview scores ${JSON.stringify(mockSessions.map((s) => ({ date: s.date, score: s.overallScore })))}, and target role ${profile.targetRole}, return { criticalGaps, moderateGaps, strengths, readinessTimeline, weeks:[{week,focus,tasks}] }.`);
    setStudyPlan({ ...data, generatedAt: new Date().toISOString() });
    log("Generated skill gap analysis", "Analytics");
  };
  return (
    <div className="space-y-6">
      <Title eyebrow="Analytics" title="Measure readiness, weak spots, and momentum" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">{[["Readiness Score", `${ready}%`, Gauge], ["Mock Interviews", mockSessions.length, Mic], ["Questions Practiced", practicedQuestions.length, Target], ["Average Mock Score", avg.toFixed(1), Star], ["Topics Completed", done, BookOpen]].map(([l, v, icon]) => { const Icon = icon; return <Card key={l}><div className="flex items-center justify-between"><div><div className="text-sm text-slate-400">{l}</div><div className="mt-2 text-3xl font-semibold text-white">{v}</div></div><div className="rounded-2xl bg-slate-900 p-3 text-cyan-300"><Icon className="h-5 w-5" /></div></div></Card>; })}</div>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]"><Card><div className="mb-5 flex items-center justify-between"><h3 className="text-xl font-semibold text-white">Mock Interview Score Trend</h3><span className="text-sm text-slate-500">{mockSessions.length} sessions</span></div>{mockSessions.length ? <svg viewBox="0 0 320 180" className="w-full"><path d="M20 160 H300" stroke="rgba(51,65,85,.8)" /><path d="M20 20 V160" stroke="rgba(51,65,85,.8)" /><polyline fill="none" stroke="url(#lineg)" strokeWidth="4" points={line} /><defs><linearGradient id="lineg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#22d3ee" /></linearGradient></defs></svg> : <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-16 text-center text-sm text-slate-500">Complete mock interviews to see trend data.</div>}</Card><Card><h3 className="text-xl font-semibold text-white">Category Performance</h3><div className="mt-5 space-y-4">{bars.length ? bars.map(([l, v]) => <Bar key={l} label={l} value={v * 10} subtitle={`${v.toFixed(1)}/10`} />) : <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-16 text-center text-sm text-slate-500">Practice answers to unlock category scoring.</div>}</div></Card></div>
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"><Card><h3 className="text-xl font-semibold text-white">Study Progress</h3><div className="mt-5 space-y-4">{learningPath?.phases?.length ? learningPath.phases.map((p) => <Bar key={p.name} label={p.name} value={(p.topics.filter((t) => arr(learningPath.completedTopics).includes(t.id)).length / p.topics.length) * 100} subtitle={`${p.topics.filter((t) => arr(learningPath.completedTopics).includes(t.id)).length}/${p.topics.length} topics`} />) : <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-16 text-center text-sm text-slate-500">Generate your learning path to track progress.</div>}</div><div className="mt-6 rounded-2xl bg-slate-900/70 p-4"><div className="text-sm text-slate-400">Time Invested</div><div className="mt-2 text-2xl font-semibold text-white">{mins} mins</div><div className="text-xs text-slate-500">Includes mock interview duration and estimated question practice time.</div></div></Card><Card className="space-y-5"><div className="flex justify-between gap-3"><div><h3 className="text-xl font-semibold text-white">Skill Gap Analysis</h3><p className="text-sm text-slate-400">Turn your profile, resume, and mock performance into a 4-week study plan.</p></div><Btn onClick={gap} disabled={loading.skillGap} icon={Sparkles}>{loading.skillGap ? "Generating..." : "Generate Skill Gap Analysis"}</Btn></div>{studyPlan?.weeks?.length ? <><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/6 p-4 text-sm text-cyan-100">Estimated readiness timeline: {studyPlan.readinessTimeline}</div>{studyPlan.weeks.map((w) => <div key={w.week} className="rounded-3xl border border-slate-700/80 bg-slate-950/60 p-5"><div className="flex justify-between gap-3"><div className="text-lg font-semibold text-white">{w.week}</div><div className="rounded-full bg-slate-900/70 px-3 py-1 text-xs text-slate-300">{w.focus}</div></div><div className="mt-3 space-y-2 text-sm text-slate-300">{arr(w.tasks).map((t) => <div key={t} className="flex gap-2"><ChevronRight className="mt-0.5 h-4 w-4 text-cyan-300" /><span>{t}</span></div>)}</div></div>)}</> : <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-16 text-center text-sm text-slate-500">Generate your gap analysis to get a personalized weekly plan.</div>}</Card></div>
      <Card><h3 className="text-xl font-semibold text-white">Achievement Badges</h3><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{BADGES.map(([id, label, icon]) => { const ok = achievements.earnedBadges.includes(id); const Icon = icon; return <div key={id} className={cn("rounded-3xl border p-4", ok ? "border-cyan-400/30 bg-cyan-400/8 text-white" : "border-slate-800 bg-slate-900/60 text-slate-500")}><div className="flex items-center gap-3"><div className={cn("rounded-2xl p-3", ok ? "bg-cyan-400/18 text-cyan-200" : "bg-slate-800")}><Icon className="h-5 w-5" /></div><div><div className="font-medium">{label}</div><div className="text-xs">{ok ? "Unlocked" : "Keep going"}</div></div></div></div>; })}</div></Card>
    </div>
  );
}

function SettingsPage({ profile, setProfile, settings, setSettings, setConfirm }) {
  return (
    <div className="space-y-6">
      <Title eyebrow="Settings" title="Profile, preferences, and data controls" />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-5">
          <h3 className="text-xl font-semibold text-white">Edit Profile</h3>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Full Name"><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            <Field label="Email"><Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
            <Field label="Current Role"><Input value={profile.currentRole} onChange={(e) => setProfile({ ...profile, currentRole: e.target.value })} /></Field>
            <Field label="Experience"><Select value={profile.experience} onChange={(e) => setProfile({ ...profile, experience: e.target.value })}>{EXP.map((o) => <option key={o}>{o}</option>)}</Select></Field>
            <Field label="Target Role"><Input value={profile.targetRole} onChange={(e) => setProfile({ ...profile, targetRole: e.target.value })} /></Field>
            <Field label="Domain"><Select value={profile.domain} onChange={(e) => setProfile({ ...profile, domain: e.target.value })}>{DOMAINS.map((o) => <option key={o}>{o}</option>)}</Select></Field>
          </div>
          <Field label="Technical Skills"><TagInput value={profile.technicalSkills} onChange={(v) => setProfile({ ...profile, technicalSkills: v })} placeholder="Add a skill" /></Field>
          <Field label="Soft Skills"><TagInput value={profile.softSkills} onChange={(v) => setProfile({ ...profile, softSkills: v })} placeholder="Add a skill" /></Field>
          <Field label="Work History Summary"><Area value={profile.workHistory} onChange={(e) => setProfile({ ...profile, workHistory: e.target.value })} /></Field>
        </Card>
        <div className="space-y-6">
          <Card className="space-y-5">
            <h3 className="text-xl font-semibold text-white">App Preferences</h3>
            <Field label="AI Response Detail Level"><Select value={settings.detailLevel} onChange={(e) => setSettings({ ...settings, detailLevel: e.target.value })}>{["Concise", "Detailed", "Comprehensive"].map((o) => <option key={o}>{o}</option>)}</Select></Field>
            <Field label="Show Timers in Mock Interview"><Select value={String(settings.showTimers)} onChange={(e) => setSettings({ ...settings, showTimers: e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></Select></Field>
            <Field label="Anthropic API Key" hint="Stored locally in window.storage"><Input type="password" value={settings.anthropicApiKey} onChange={(e) => setSettings({ ...settings, anthropicApiKey: e.target.value })} placeholder="sk-ant-..." /></Field>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/6 p-4 text-sm text-cyan-50">AI features call Claude Sonnet 4 directly from the client using your stored Anthropic API key.</div>
          </Card>
          <Card className="space-y-4">
            <h3 className="text-xl font-semibold text-white">Clear Data</h3>
            <Btn variant="danger" onClick={() => setConfirm("resume")}>Clear Resume</Btn>
            <Btn variant="danger" onClick={() => setConfirm("history")}>Clear Interview History</Btn>
            <Btn variant="danger" onClick={() => setConfirm("all")}>Clear All Data</Btn>
          </Card>
        </div>
      </div>
    </div>
  );
}
