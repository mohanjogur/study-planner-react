import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { SpeedInsights } from '@vercel/speed-insights/react';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { auth, authReady, db } from "./firebase";
import "./App.css";

const STORAGE_KEY = "focusai-planner-v3";
const LEGACY_STORAGE_KEYS = ["focusai-planner-v2", "focusai-planner-v1"];
const REVISION_OFFSETS = [1, 3, 7];
const DEFAULT_STUDY_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const defaultGoalForm = {
  goalTitle: "",
  examDate: "",
  dailyHours: "2",
  targetScore: "",
  subjects: "",
  studyDays: DEFAULT_STUDY_DAYS.join(","),
};

const defaultReminderRules = {
  sessionLeadMinutes: 15,
  morningBriefEnabled: true,
  morningBriefHour: 7,
  eveningWrapEnabled: false,
  eveningWrapHour: 20,
};

const defaultPlanner = {
  profileId: "",
  goal: null,
  plan: null,
  analytics: null,
  memory: null,
  reminderRules: defaultReminderRules,
  notifications: {
    inbox: [],
    deliveredIds: [],
    lastCheckedAt: null,
  },
  createdAt: null,
  updatedAt: null,
};

function createProfileId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `profile-${Date.now()}`;
}

function formatShortDay(date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateValue, amount) {
  const next = new Date(dateValue);
  next.setDate(next.getDate() + amount);
  return next;
}

function getTodayKey() {
  return formatDateKey(new Date());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseSubjects(subjectsText) {
  return subjectsText
    .split(",")
    .map((subject) => subject.trim())
    .filter(Boolean)
    .map((subject) => ({
      name: subject,
      priority: "medium",
      confidence: 50,
    }));
}

function parseStudyDays(daysText) {
  const days = daysText
    .split(",")
    .map((day) => day.trim())
    .filter(Boolean);

  return days.length ? days : DEFAULT_STUDY_DAYS;
}

function formatDateLabel(dateValue) {
  if (!dateValue) return "No date selected";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(dateValue));
}

function formatDateTimeLabel(dateValue) {
  if (!dateValue) return "No reminder scheduled";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateValue));
}

function flattenSessions(plan) {
  if (!plan?.weeklySchedule) return [];

  return plan.weeklySchedule.flatMap((day) =>
    day.sessions.map((session) => ({
      ...session,
      date: day.date,
      dayLabel: day.dayLabel,
    })),
  );
}

function buildPlannerDocRef(uid) {
  return doc(db, "users", uid, "planner", "main");
}

function withSessionScheduleMetadata(plan, reminderRules = defaultReminderRules) {
  if (!plan?.weeklySchedule?.length) return plan;

  return {
    ...plan,
    weeklySchedule: plan.weeklySchedule.map((day) => {
      let minuteCursor = 18 * 60;

      return {
        ...day,
        sessions: day.sessions.map((session) => {
          const startHours = Math.floor(minuteCursor / 60);
          const startMinutes = minuteCursor % 60;
          const scheduledAt = new Date(`${day.date}T00:00:00`);
          scheduledAt.setHours(startHours, startMinutes, 0, 0);

          minuteCursor += Math.max(30, session.duration);

          return {
            ...session,
            scheduledAt: session.scheduledAt || scheduledAt.toISOString(),
            reminderAt:
              session.reminderAt ||
              new Date(
                scheduledAt.getTime() -
                  (reminderRules.sessionLeadMinutes || defaultReminderRules.sessionLeadMinutes) *
                    60 *
                    1000,
              ).toISOString(),
          };
        }),
      };
    }),
  };
}

function getSessionQualityScore(session) {
  if (session.status !== "done") {
    return session.status === "missed" ? 0.05 : 0;
  }

  const actualMinutes = session.feedback?.actualMinutes || session.duration || 0;
  const durationRatio = session.duration
    ? clamp(actualMinutes / session.duration, 0.35, 1.15)
    : 1;
  const focusScore = (session.feedback?.focusScore || 3) / 5;
  const confidenceScore = (session.feedback?.confidenceScore || 3) / 5;
  const energyScore = (session.feedback?.energyScore || 3) / 5;
  const quality =
    durationRatio * 0.35 + focusScore * 0.3 + confidenceScore * 0.25 + energyScore * 0.1;

  return clamp(quality, 0, 1);
}

function formatTimer(seconds) {
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function buildDayRange(goal, weeklySchedule) {
  const scheduleDates = weeklySchedule?.map((day) => new Date(day.date)) || [];
  const startDate =
    scheduleDates.length > 0
      ? new Date(Math.min(...scheduleDates.map((day) => day.getTime())))
      : new Date();
  const examDate = goal?.examDate ? new Date(goal.examDate) : addDays(startDate, 13);
  const rawSpan = Math.ceil(
    (examDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  const totalDays = Math.max(14, Math.min(28, rawSpan + 1 || 14));

  return Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(startDate, index);
    return {
      date: formatDateKey(date),
      dayLabel: formatShortDay(date),
      sessions: [],
    };
  });
}

function findRevisionTargetDate({
  anchorDate,
  offset,
  studyDays,
  availableDates,
  examDate,
}) {
  const allowedDays = new Set(studyDays?.length ? studyDays : DEFAULT_STUDY_DAYS);
  const endDate = examDate
    ? new Date(examDate)
    : new Date(availableDates[availableDates.length - 1]);

  for (let dayShift = offset; dayShift <= offset + 4; dayShift += 1) {
    const candidate = addDays(anchorDate, dayShift);
    const key = formatDateKey(candidate);

    if (candidate > endDate) {
      break;
    }

    if (availableDates.includes(key) && allowedDays.has(formatShortDay(candidate))) {
      return key;
    }
  }

  return null;
}

function createRevisionSessions(plan, goal) {
  if (!plan?.weeklySchedule?.length) {
    return plan;
  }

  const normalizedDays = buildDayRange(goal, plan.weeklySchedule);
  const availableDates = normalizedDays.map((day) => day.date);
  const dayMap = new Map(normalizedDays.map((day) => [day.date, { ...day, sessions: [] }]));

  plan.weeklySchedule.forEach((day) => {
    const currentDay = dayMap.get(day.date);
    if (!currentDay) return;

    currentDay.sessions = [...day.sessions];
  });

  const scheduledRevisionIds = new Set(
    flattenSessions({ weeklySchedule: Array.from(dayMap.values()) })
      .filter((session) => session.sourceSessionId)
      .map((session) => session.id),
  );

  Array.from(dayMap.values()).forEach((day) => {
    day.sessions.forEach((session) => {
      if (session.type !== "learn" || session.sourceSessionId) {
        return;
      }

      REVISION_OFFSETS.forEach((offset, revisionIndex) => {
        const revisionDate = findRevisionTargetDate({
          anchorDate: new Date(day.date),
          offset,
          studyDays: goal?.studyDays,
          availableDates,
          examDate: goal?.examDate,
        });

        if (!revisionDate) return;

        const revisionId = `${session.id}-rev-${revisionIndex + 1}`;

        if (scheduledRevisionIds.has(revisionId)) {
          return;
        }

        const targetDay = dayMap.get(revisionDate);
        if (!targetDay) return;

        targetDay.sessions.push({
          id: revisionId,
          subject: session.subject,
          topic: `${session.topic} review ${revisionIndex + 1}`,
          duration: Math.max(25, Math.round(session.duration * 0.6)),
          type: "revise",
          status: "planned",
          sourceSessionId: session.id,
          revisionStage: revisionIndex + 1,
        });
      });
    });
  });

  const weeklySchedule = Array.from(dayMap.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => ({
      ...day,
      sessions: day.sessions.sort((left, right) =>
        left.subject.localeCompare(right.subject) || left.topic.localeCompare(right.topic),
      ),
    }));

  return {
    ...plan,
    weeklySchedule,
    revisionStrategy: {
      offsets: REVISION_OFFSETS,
      totalRevisionSessions: weeklySchedule.reduce(
        (count, day) => count + day.sessions.filter((session) => session.type === "revise").length,
        0,
      ),
    },
  };
}

function createScheduleMap(plan, goal) {
  const normalizedDays = buildDayRange(goal, plan?.weeklySchedule);
  const dayMap = new Map(normalizedDays.map((day) => [day.date, { ...day, sessions: [] }]));

  plan?.weeklySchedule?.forEach((day) => {
    const currentDay = dayMap.get(day.date);
    if (!currentDay) return;
    currentDay.sessions = [...day.sessions];
  });

  return dayMap;
}

function findNextAdaptiveDate({
  startDate,
  dayMap,
  goal,
  matcher,
}) {
  const allowedDays = new Set(goal?.studyDays?.length ? goal.studyDays : DEFAULT_STUDY_DAYS);
  const examDate = goal?.examDate ? new Date(goal.examDate) : null;

  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = addDays(startDate, offset);
    const key = formatDateKey(candidate);
    const day = dayMap.get(key);

    if (!day) continue;
    if (examDate && candidate > examDate) break;
    if (!allowedDays.has(formatShortDay(candidate))) continue;
    if (matcher && !matcher(day, candidate)) continue;

    return key;
  }

  return null;
}

function applyAdaptiveReplanning(plan, goal, analytics) {
  if (!plan?.weeklySchedule?.length) {
    return {
      ...plan,
      adaptivePlan: {
        actions: [],
      },
    };
  }

  const dayMap = createScheduleMap(plan, goal);
  const sessions = flattenSessions({ weeklySchedule: Array.from(dayMap.values()) });
  const existingRecoverySources = new Set(
    sessions
      .filter((session) => session.adaptiveType === "recovery" && session.sourceSessionId)
      .map((session) => session.sourceSessionId),
  );
  const existingSupportSubjects = new Set(
    sessions
      .filter((session) => session.adaptiveType === "support")
      .map((session) => session.subject),
  );
  const actions = [];

  sessions
    .filter((session) => session.status === "missed" && !session.sourceSessionId)
    .slice(-4)
    .forEach((missedSession) => {
      if (existingRecoverySources.has(missedSession.id)) {
        return;
      }

      const recoveryDate = findNextAdaptiveDate({
        startDate: new Date(missedSession.date),
        dayMap,
        goal,
        matcher: (day) => day.sessions.length < 4,
      });

      if (!recoveryDate) return;

      const recoveryDay = dayMap.get(recoveryDate);
      recoveryDay.sessions.push({
        id: `recovery-${missedSession.id}`,
        subject: missedSession.subject,
        topic: `Recovery: ${missedSession.topic}`,
        duration: Math.max(30, Math.round(missedSession.duration * 0.75)),
        type: missedSession.type === "test" ? "learn" : missedSession.type,
        status: "planned",
        sourceSessionId: missedSession.id,
        adaptiveType: "recovery",
      });

      existingRecoverySources.add(missedSession.id);
      actions.push(`Recovered a missed ${missedSession.subject} session on ${recoveryDate}.`);
    });

  const weakSubjects = (analytics?.subjectBreakdown || [])
    .filter((subject) => subject.mastery < 60)
    .slice(0, 2);

  weakSubjects.forEach((subject, index) => {
    if (existingSupportSubjects.has(subject.subject)) {
      return;
    }

    const supportDate = findNextAdaptiveDate({
      startDate: new Date(),
      dayMap,
      goal,
      matcher: (day) =>
        day.sessions.length < 4 &&
        !day.sessions.some(
          (session) =>
            session.subject === subject.subject && session.adaptiveType === "support",
        ),
    });

    if (!supportDate) return;

    const supportDay = dayMap.get(supportDate);
    supportDay.sessions.push({
      id: `support-${subject.subject.replace(/\s+/g, "-").toLowerCase()}-${index + 1}`,
      subject: subject.subject,
      topic: `${subject.subject} reinforcement sprint`,
      duration: 35,
      type: "learn",
      status: "planned",
      adaptiveType: "support",
    });

    existingSupportSubjects.add(subject.subject);
    actions.push(`Added a reinforcement sprint for ${subject.subject} on ${supportDate}.`);
  });

  const weeklySchedule = Array.from(dayMap.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => ({
      ...day,
      sessions: [...day.sessions].sort((left, right) =>
        left.subject.localeCompare(right.subject) || left.topic.localeCompare(right.topic),
      ),
    }));

  return {
    ...plan,
    weeklySchedule,
    adaptivePlan: {
      actions,
      weakSubjects: weakSubjects.map((subject) => subject.subject),
    },
  };
}

function computeAnalytics(plan, goal) {
  const sessions = flattenSessions(plan);
  const todayKey = getTodayKey();
  const plannedSessions = sessions.length;
  const completedSessions = sessions.filter((session) => session.status === "done").length;
  const missedSessions = sessions.filter((session) => session.status === "missed").length;
  const revisionSessions = sessions.filter((session) => session.type === "revise");
  const completedMinutes = sessions
    .filter((session) => session.status === "done")
    .reduce((sum, session) => sum + (session.feedback?.actualMinutes || session.duration), 0);
  const plannedMinutes = sessions.reduce((sum, session) => sum + session.duration, 0);
  const upcomingSessions = sessions.filter(
    (session) => session.date >= todayKey && session.status !== "done",
  );
  const finishedSessions = sessions.filter((session) => session.status === "done");
  const averageFocusScore = finishedSessions.length
    ? Math.round(
        (finishedSessions.reduce(
          (sum, session) => sum + (session.feedback?.focusScore || 3),
          0,
        ) /
          finishedSessions.length) *
          20,
      )
    : 0;
  const deepWorkMinutes = finishedSessions
    .filter((session) => (session.feedback?.actualMinutes || session.duration) >= 45)
    .reduce(
      (sum, session) => sum + (session.feedback?.actualMinutes || session.duration || 0),
      0,
    );

  const daysWithSessions = new Map();
  sessions.forEach((session) => {
    if (!daysWithSessions.has(session.date)) {
      daysWithSessions.set(session.date, []);
    }

    daysWithSessions.get(session.date).push(session);
  });

  const studyDayKeys = Array.from(daysWithSessions.keys()).sort();
  let currentStreak = 0;

  for (let index = studyDayKeys.length - 1; index >= 0; index -= 1) {
    const daySessions = daysWithSessions.get(studyDayKeys[index]);
    const hasDone = daySessions.some((session) => session.status === "done");

    if (!hasDone) {
      if (studyDayKeys[index] > todayKey) {
        continue;
      }

      break;
    }

    currentStreak += 1;
  }

  const subjectMetricsMap = new Map();
  sessions.forEach((session) => {
    const current = subjectMetricsMap.get(session.subject) || {
      subject: session.subject,
      plannedSessions: 0,
      completedSessions: 0,
      missedSessions: 0,
      revisionSessions: 0,
      completedMinutes: 0,
      qualityPoints: 0,
      mastery: 0,
    };

    current.plannedSessions += 1;
    current.completedSessions += session.status === "done" ? 1 : 0;
    current.missedSessions += session.status === "missed" ? 1 : 0;
    current.revisionSessions += session.type === "revise" ? 1 : 0;
    current.completedMinutes +=
      session.status === "done" ? session.feedback?.actualMinutes || session.duration : 0;
    current.qualityPoints += getSessionQualityScore(session);
    current.mastery = current.plannedSessions
      ? Math.round((current.qualityPoints / current.plannedSessions) * 100)
      : 0;

    subjectMetricsMap.set(session.subject, current);
  });

  const subjectBreakdown = Array.from(subjectMetricsMap.values()).sort(
    (left, right) => right.mastery - left.mastery,
  );

  const completionRate = plannedSessions
    ? Math.round((completedSessions / plannedSessions) * 100)
    : 0;
  const revisionHealth = revisionSessions.length
    ? Math.round(
        (revisionSessions.reduce((sum, session) => sum + getSessionQualityScore(session), 0) /
          revisionSessions.length) *
          100,
      )
    : 0;
  const consistencyScore = studyDayKeys.length
    ? Math.round(
        (studyDayKeys.filter((dateKey) =>
          daysWithSessions.get(dateKey).some((session) => session.status === "done"),
        ).length /
          studyDayKeys.length) *
          100,
      )
    : 0;
  const coverageScore = goal?.subjects?.length
    ? Math.round((subjectBreakdown.length / goal.subjects.length) * 100)
    : 0;
  const examDate = goal?.examDate ? new Date(goal.examDate) : null;
  const daysToExam = examDate
    ? Math.max(
        0,
        Math.ceil((examDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
      )
    : null;
  const readinessScore = Math.round(
    clamp(
      completionRate * 0.4 +
        revisionHealth * 0.25 +
        consistencyScore * 0.2 +
        coverageScore * 0.15 -
        missedSessions * 2,
      0,
      100,
    ),
  );

  return {
    readinessScore,
    completionRate,
    revisionHealth,
    consistencyScore,
    coverageScore,
    completedMinutes,
    plannedMinutes,
    deepWorkMinutes,
    averageFocusScore,
    currentStreak,
    daysToExam,
    plannedSessions,
    completedSessions,
    missedSessions,
    upcomingSessionCount: upcomingSessions.length,
    subjectBreakdown,
    strongestSubject: subjectBreakdown[0]?.subject || "None yet",
    weakestSubject: subjectBreakdown[subjectBreakdown.length - 1]?.subject || "None yet",
  };
}

function buildCoachMemory(plan, analytics, existingMemory) {
  const sessions = flattenSessions(plan);
  const missedSessions = sessions
    .filter((session) => session.status === "missed")
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 4)
    .map((session) => ({
      subject: session.subject,
      topic: session.topic,
      date: session.date,
    }));
  const weakSubjects = (analytics?.subjectBreakdown || [])
    .filter((subject) => subject.mastery < 60)
    .slice(0, 3)
    .map((subject) => ({
      subject: subject.subject,
      mastery: subject.mastery,
    }));
  const recentFocusSessions = sessions
    .filter((session) => session.status === "done" && session.feedback?.focusScore)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 3)
    .map((session) => ({
      subject: session.subject,
      topic: session.topic,
      focusScore: session.feedback.focusScore,
      confidenceScore: session.feedback.confidenceScore || 3,
      actualMinutes: session.feedback.actualMinutes || session.duration,
    }));

  return {
    weakSubjects,
    recentMisses: missedSessions,
    recentFocusSessions,
    adaptationActions: plan?.adaptivePlan?.actions || [],
    insights: existingMemory?.insights || [],
    lastCoachReply: existingMemory?.lastCoachReply || "",
    lastCoachQuestion: existingMemory?.lastCoachQuestion || "",
    lastFocusSession:
      existingMemory?.lastFocusSession || recentFocusSessions[0] || null,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function normalizePlannerData(plan, goal, existingMemory, reminderRules = defaultReminderRules) {
  if (!plan) {
    return { plan: null, analytics: null, memory: null };
  }

  const scheduledPlan = withSessionScheduleMetadata(plan, reminderRules);
  const revisionPlan = createRevisionSessions(scheduledPlan, goal);
  const preAdaptiveAnalytics = computeAnalytics(revisionPlan, goal);
  const adaptivePlan = applyAdaptiveReplanning(revisionPlan, goal, preAdaptiveAnalytics);
  const analytics = computeAnalytics(adaptivePlan, goal);

  return {
    plan: adaptivePlan,
    analytics,
    memory: buildCoachMemory(adaptivePlan, analytics, existingMemory),
  };
}

function getStoredPlanner() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored =
    window.localStorage.getItem(STORAGE_KEY) ||
    LEGACY_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(Boolean);

  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function getInitialPlanner() {
  const storedPlanner = getStoredPlanner();

  if (!storedPlanner) {
    return { ...defaultPlanner, profileId: createProfileId() };
  }

  const normalized = normalizePlannerData(
    storedPlanner.plan,
    storedPlanner.goal,
    storedPlanner.memory,
    storedPlanner.reminderRules || defaultReminderRules,
  );

  return {
    ...defaultPlanner,
    ...storedPlanner,
    profileId: storedPlanner.profileId || createProfileId(),
    plan: normalized.plan,
    analytics: normalized.analytics,
    memory: normalized.memory,
    reminderRules: storedPlanner.reminderRules || defaultReminderRules,
    notifications: storedPlanner.notifications || defaultPlanner.notifications,
  };
}

function buildGoalForm(initialPlanner) {
  if (!initialPlanner.goal) {
    return defaultGoalForm;
  }

  return {
    goalTitle: initialPlanner.goal.goalTitle || "",
    examDate: initialPlanner.goal.examDate || "",
    dailyHours: String(initialPlanner.goal.dailyHours || "2"),
    targetScore: String(initialPlanner.goal.targetScore || ""),
    subjects: initialPlanner.goal.subjects?.map((subject) => subject.name).join(", ") || "",
    studyDays: initialPlanner.goal.studyDays?.join(", ") || defaultGoalForm.studyDays,
  };
}

function getDaySessions(plan, dateKey) {
  return flattenSessions(plan).filter((session) => session.date === dateKey);
}

function getUpcomingRevisionSessions(plan) {
  const todayKey = getTodayKey();

  return flattenSessions(plan)
    .filter((session) => session.type === "revise" && session.date >= todayKey)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 6);
}

function findSession(plan, sessionId) {
  return flattenSessions(plan).find((session) => session.id === sessionId) || null;
}

async function syncPlannerToFirestore(planner, uid) {
  if (!uid) return;

  const plannerRef = buildPlannerDocRef(uid);
  await setDoc(
    plannerRef,
    {
      ...planner,
      profileId: uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function App() {
  const initialPlanner = getInitialPlanner();
  const [planner, setPlanner] = useState(initialPlanner);
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("Connecting account...");
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const [goalForm, setGoalForm] = useState(() => buildGoalForm(initialPlanner));
  const [coachPrompt, setCoachPrompt] = useState("");
  const [coachReply, setCoachReply] = useState("");
  const [statusMessage, setStatusMessage] = useState("Planner ready.");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(getTodayKey());
  const [focusSessionId, setFocusSessionId] = useState("");
  const [timerSecondsLeft, setTimerSecondsLeft] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    focusScore: "3",
    confidenceScore: "3",
    energyScore: "3",
    actualMinutes: "",
    notes: "",
  });
  const [isPending, startTransition] = useTransition();
  const hasHydratedCloudRef = useRef(false);
  const plannerStateRef = useRef(initialPlanner);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(planner));
  }, [planner]);

  useEffect(() => {
    plannerStateRef.current = planner;
  }, [planner]);

  useEffect(() => {
    let unsubscribe = () => undefined;

    const initializeAuth = async () => {
      await authReady;

      try {
        await getRedirectResult(auth);
      } catch {
        setStatusMessage("Redirect sign-in could not be completed.");
      }

      unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
        if (nextUser) {
          setUser(nextUser);
          setAuthStatus(nextUser.isAnonymous ? "Guest mode" : "Signed in");
          return;
        }

        try {
          const credential = await signInAnonymously(auth);
          setUser(credential.user);
          setAuthStatus("Guest mode");
        } catch {
          setAuthStatus("Offline local mode");
        }
      });
    };

    initializeAuth();

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.uid) return undefined;

    const cloudPlannerRef = buildPlannerDocRef(user.uid);
    const unsubscribe = onSnapshot(cloudPlannerRef, async (snapshot) => {
      if (snapshot.exists()) {
        const cloudPlanner = snapshot.data();
        const normalized = normalizePlannerData(
          cloudPlanner.plan,
          cloudPlanner.goal,
          cloudPlanner.memory,
          cloudPlanner.reminderRules || defaultReminderRules,
        );

        hasHydratedCloudRef.current = true;
        setPlanner((current) => ({
          ...current,
          ...cloudPlanner,
          profileId: user.uid,
          plan: normalized.plan,
          analytics: normalized.analytics,
          memory: normalized.memory,
          reminderRules: cloudPlanner.reminderRules || defaultReminderRules,
          notifications: cloudPlanner.notifications || defaultPlanner.notifications,
        }));
        setStatusMessage("Cloud sync connected across devices.");
        return;
      }

      const currentPlanner = plannerStateRef.current;

      if (!hasHydratedCloudRef.current && (currentPlanner.goal || currentPlanner.plan)) {
        hasHydratedCloudRef.current = true;
        const normalized = normalizePlannerData(
          currentPlanner.plan,
          currentPlanner.goal,
          currentPlanner.memory,
          currentPlanner.reminderRules,
        );
        await setDoc(
          cloudPlannerRef,
          {
            ...currentPlanner,
            profileId: user.uid,
            plan: normalized.plan,
            analytics: normalized.analytics,
            memory: normalized.memory,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
    });

    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    if (!planner.plan?.weeklySchedule?.length) return;

    const availableDates = planner.plan.weeklySchedule.map((day) => day.date);
    const nextSelectedDate = availableDates.includes(selectedCalendarDate)
      ? selectedCalendarDate
      : availableDates[0];

    if (nextSelectedDate !== selectedCalendarDate) {
      setSelectedCalendarDate(nextSelectedDate);
    }
  }, [planner.plan, selectedCalendarDate]);

  useEffect(() => {
    if (!isTimerRunning || timerSecondsLeft <= 0) {
      if (timerSecondsLeft === 0 && isTimerRunning) {
        setIsTimerRunning(false);
        setStatusMessage("Focus block completed. Add feedback to update mastery.");
      }
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setTimerSecondsLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isTimerRunning, timerSecondsLeft]);

  const todaySessions = useMemo(() => getDaySessions(planner.plan, getTodayKey()), [planner.plan]);
  const analytics = planner.analytics || computeAnalytics(planner.plan, planner.goal);
  const upcomingRevisions = useMemo(
    () => getUpcomingRevisionSessions(planner.plan),
    [planner.plan],
  );
  const upcomingReminders = useMemo(
    () =>
      flattenSessions(planner.plan)
        .filter((session) => session.status !== "done" && session.reminderAt)
        .sort((left, right) => left.reminderAt.localeCompare(right.reminderAt))
        .slice(0, 5),
    [planner.plan],
  );
  const activeFocusSession = useMemo(
    () => findSession(planner.plan, focusSessionId),
    [planner.plan, focusSessionId],
  );
  const calendarSessions = useMemo(
    () => getDaySessions(planner.plan, selectedCalendarDate),
    [planner.plan, selectedCalendarDate],
  );

  const savePlanner = (plannerBase, nextStatusMessage) => {
      const normalized = normalizePlannerData(
      plannerBase.plan,
      plannerBase.goal,
      plannerBase.memory,
      plannerBase.reminderRules,
    );
    const nextPlanner = {
      ...plannerBase,
      plan: normalized.plan,
      analytics: normalized.analytics,
      memory: normalized.memory,
    };

    setPlanner(nextPlanner);
    setStatusMessage(nextStatusMessage);

    startTransition(() => {
      syncPlannerToFirestore(nextPlanner, user?.uid).catch(() => {
        setStatusMessage("Changes saved locally. Firestore sync is unavailable right now.");
      });
    });
  };

  const handleGoalChange = (event) => {
    const { name, value } = event.target;
    setGoalForm((current) => ({ ...current, [name]: value }));
  };

  const handleGeneratePlan = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("Generating a structured study calendar...");

    const goalPayload = {
      goalTitle: goalForm.goalTitle.trim(),
      examDate: goalForm.examDate,
      dailyHours: Number(goalForm.dailyHours) || 1,
      targetScore: Number(goalForm.targetScore) || null,
      subjects: parseSubjects(goalForm.subjects),
      studyDays: parseStudyDays(goalForm.studyDays),
    };

    if (!goalPayload.goalTitle || !goalPayload.examDate || !goalPayload.subjects.length) {
      setErrorMessage("Add a goal title, exam date, and at least one subject.");
      setStatusMessage("Planner needs a bit more information.");
      return;
    }

    try {
      const response = await fetch("/api/generate-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(goalPayload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Plan generation failed.");
      }

      const nextPlanner = {
        ...planner,
        goal: goalPayload,
        plan: data.plan,
        createdAt: planner.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setSelectedCalendarDate(data.plan?.weeklySchedule?.[0]?.date || getTodayKey());
      savePlanner(nextPlanner, "Calendar generated with automatic revision sessions.");
      setActiveTab("analytics");
    } catch (error) {
      setErrorMessage(error.message);
      setStatusMessage("Plan generation hit a problem.");
    }
  };

  const handleSessionStatus = (date, sessionId, nextStatus) => {
    if (!planner.plan) return;

    const updatedPlan = {
      ...planner.plan,
      weeklySchedule: planner.plan.weeklySchedule.map((day) => {
        if (day.date !== date) return day;

        return {
          ...day,
          sessions: day.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  status: nextStatus,
                }
              : session,
          ),
        };
      }),
    };

    if (focusSessionId === sessionId) {
      setIsTimerRunning(false);
      setFocusSessionId("");
      setTimerSecondsLeft(0);
    }

    savePlanner(
      {
        ...planner,
        plan: updatedPlan,
        updatedAt: new Date().toISOString(),
      },
      nextStatus === "done"
        ? "Nice work. Analytics and readiness score are updated."
        : "Session updated. Your calendar and analytics reflect the change.",
    );
  };

  const launchFocusMode = (session) => {
    setFocusSessionId(session.id);
    setTimerSecondsLeft(session.duration * 60);
    setIsTimerRunning(false);
    setFeedbackForm({
      focusScore: String(session.feedback?.focusScore || 3),
      confidenceScore: String(session.feedback?.confidenceScore || 3),
      energyScore: String(session.feedback?.energyScore || 3),
      actualMinutes: String(session.feedback?.actualMinutes || session.duration || ""),
      notes: session.feedback?.notes || "",
    });
    setActiveTab("focus");
    setStatusMessage(`Focus mode ready for ${session.subject}. Start when you are set.`);
  };

  const handleFeedbackChange = (event) => {
    const { name, value } = event.target;
    setFeedbackForm((current) => ({ ...current, [name]: value }));
  };

  const handleReminderRuleChange = (event) => {
    const { name, type, checked, value } = event.target;
    savePlanner(
      {
        ...planner,
        reminderRules: {
          ...(planner.reminderRules || defaultReminderRules),
          [name]: type === "checkbox" ? checked : Number(value),
        },
        updatedAt: new Date().toISOString(),
      },
      "Reminder rules updated.",
    );
  };

  const submitSessionFeedback = () => {
    if (!planner.plan || !activeFocusSession) return;

    const feedback = {
      focusScore: Number(feedbackForm.focusScore) || 3,
      confidenceScore: Number(feedbackForm.confidenceScore) || 3,
      energyScore: Number(feedbackForm.energyScore) || 3,
      actualMinutes: Number(feedbackForm.actualMinutes) || activeFocusSession.duration,
      notes: feedbackForm.notes.trim(),
      completedAt: new Date().toISOString(),
      timerCompleted: timerSecondsLeft === 0,
    };

    const updatedPlan = {
      ...planner.plan,
      weeklySchedule: planner.plan.weeklySchedule.map((day) => ({
        ...day,
        sessions: day.sessions.map((session) =>
          session.id === activeFocusSession.id
            ? {
                ...session,
                status: "done",
                feedback,
              }
            : session,
        ),
      })),
    };

    setIsTimerRunning(false);
    setFocusSessionId("");
    setTimerSecondsLeft(0);

    savePlanner(
      {
        ...planner,
        plan: updatedPlan,
        memory: {
          ...(planner.memory || {}),
          lastFocusSession: {
            subject: activeFocusSession.subject,
            topic: activeFocusSession.topic,
            focusScore: feedback.focusScore,
            confidenceScore: feedback.confidenceScore,
            actualMinutes: feedback.actualMinutes,
          },
        },
        updatedAt: new Date().toISOString(),
      },
      "Session feedback saved. Mastery and readiness were updated with focus quality.",
    );
  };

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setAuthStatus("Signed in");
      setStatusMessage("Signed in. Planner will sync across your devices.");
    } catch {
      try {
        const provider = new GoogleAuthProvider();
        await signInWithRedirect(auth, provider);
      } catch {
        setStatusMessage("Google sign-in failed. Staying in guest mode.");
      }
    }
  };

  const signOutUser = async () => {
    try {
      await signOut(auth);
      hasHydratedCloudRef.current = false;
      setStatusMessage("Signed out. Reconnecting in guest mode.");
    } catch {
      setStatusMessage("Could not sign out right now.");
    }
  };

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") {
      setStatusMessage("Browser notifications are not supported here.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
    setStatusMessage(
      permission === "granted"
        ? "Reminders enabled. Upcoming sessions can now trigger notifications."
        : "Notification permission was not granted.",
    );
  };

  useEffect(() => {
    if (!planner.plan || !notificationsEnabled) {
      return undefined;
    }

    let cancelled = false;

    const pollNotifications = async () => {
      try {
        const currentPlanner = plannerStateRef.current;
        const response = await fetch("/api/process-reminders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            planner: currentPlanner,
            reminderRules: currentPlanner.reminderRules,
            deliveredIds: currentPlanner.notifications?.deliveredIds || [],
            now: new Date().toISOString(),
          }),
        });

        const data = await response.json();
        if (!response.ok || cancelled || !data.notifications?.length) {
          return;
        }

        data.notifications.forEach((notification) => {
          if (typeof Notification !== "undefined") {
            new Notification(notification.title, {
              body: notification.body,
            });
          }
        });

        const normalized = normalizePlannerData(
          currentPlanner.plan,
          currentPlanner.goal,
          currentPlanner.memory,
          currentPlanner.reminderRules,
        );
        const nextPlanner = {
          ...currentPlanner,
          plan: normalized.plan,
          analytics: normalized.analytics,
          memory: normalized.memory,
          notifications: {
            inbox: [...data.notifications, ...(currentPlanner.notifications?.inbox || [])].slice(0, 20),
            deliveredIds: [
              ...new Set([
                ...(currentPlanner.notifications?.deliveredIds || []),
                ...data.notifications.map((notification) => notification.id),
              ]),
            ].slice(-100),
            lastCheckedAt: data.checkedAt,
          },
          updatedAt: new Date().toISOString(),
        };

        setPlanner(nextPlanner);
        setStatusMessage("Reminder inbox updated from backend processing.");
        startTransition(() => {
          syncPlannerToFirestore(nextPlanner, user?.uid).catch(() => {
            setStatusMessage("Reminder inbox saved locally. Cloud sync is unavailable.");
          });
        });
      } catch {
        setStatusMessage("Reminder polling is unavailable right now.");
      }
    };

    pollNotifications();
    const intervalId = window.setInterval(pollNotifications, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [notificationsEnabled, planner.plan, planner.reminderRules, startTransition, user?.uid]);

  const handleCoachAsk = async () => {
    if (!coachPrompt.trim()) return;

    setErrorMessage("");
    setStatusMessage("Asking your AI coach...");

    try {
      const response = await fetch("/api/ai-coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: coachPrompt,
          goal: planner.goal,
          todaySessions,
          analytics,
          upcomingRevisions,
          memory: planner.memory,
          adaptivePlan: planner.plan?.adaptivePlan,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Coach request failed.");
      }

      setCoachReply(data.reply);
      savePlanner(
        {
          ...planner,
          memory: {
            ...(planner.memory || {}),
            lastCoachQuestion: coachPrompt,
            lastCoachReply: data.reply,
            insights: [data.reply, ...((planner.memory?.insights || []).slice(0, 3))],
            lastUpdatedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        },
        "Coach updated with memory and adaptation context.",
      );
    } catch (error) {
      setErrorMessage(error.message);
      setStatusMessage("Coach is unavailable right now.");
    }
  };

  return (
    <div className="planner-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">FocusAI OS</p>
          <h1>Study planner that measures preparedness, not just activity.</h1>
        </div>

        <nav className="nav">
          <button
            className={activeTab === "overview" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </button>
          <button
            className={activeTab === "today" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveTab("today")}
          >
            Today
          </button>
          <button
            className={activeTab === "calendar" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveTab("calendar")}
          >
            Calendar
          </button>
          <button
            className={activeTab === "focus" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveTab("focus")}
          >
            Focus
          </button>
          <button
            className={activeTab === "analytics" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveTab("analytics")}
          >
            Analytics
          </button>
          <button
            className={activeTab === "coach" ? "nav-item active" : "nav-item"}
            onClick={() => setActiveTab("coach")}
          >
            AI Coach
          </button>
        </nav>

        <div className="status-card">
          <p className="label">Status</p>
          <p>{statusMessage}</p>
          {isPending ? <p className="muted">Syncing planner changes...</p> : null}
          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        </div>

        <div className="status-card">
          <p className="label">Account</p>
          <p>{user?.isAnonymous ? "Guest session" : user?.email || authStatus}</p>
          <p className="muted">
            {user?.isAnonymous
              ? "Sign in with Google to sync this planner across devices."
              : "Cloud sync is tied to this signed-in account."}
          </p>
          <div className="session-actions">
            {user?.isAnonymous ? (
              <button className="primary-button" onClick={signInWithGoogle}>
                Sign in with Google
              </button>
            ) : (
              <button className="ghost-button" onClick={signOutUser}>
                Sign out
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="content">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Phase 6</p>
            <h2>Authentication, cloud sync, and reminders across devices.</h2>
            <p className="hero-copy">
              The planner now ties your work to an account, keeps it synced through
              Firestore, and can remind you before scheduled sessions.
            </p>
          </div>

          <div className="metric-grid">
            <article className="metric-card accent-card">
              <span>Readiness</span>
              <strong>{analytics?.readinessScore || 0}%</strong>
            </article>
            <article className="metric-card">
              <span>Consistency</span>
              <strong>{analytics?.consistencyScore || 0}%</strong>
            </article>
            <article className="metric-card">
              <span>Revision Health</span>
              <strong>{analytics?.revisionHealth || 0}%</strong>
            </article>
            <article className="metric-card">
              <span>Adaptive actions</span>
              <strong>{planner.plan?.adaptivePlan?.actions?.length || 0}</strong>
            </article>
            <article className="metric-card">
              <span>Reminders</span>
              <strong>{notificationsEnabled ? "On" : "Off"}</strong>
            </article>
          </div>
        </section>

        {activeTab === "overview" ? (
          <section className="panel-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Goal setup</p>
                  <h3>Create your study target</h3>
                </div>
              </div>

              <form className="goal-form" onSubmit={handleGeneratePlan}>
                <label>
                  Goal title
                  <input
                    name="goalTitle"
                    value={goalForm.goalTitle}
                    onChange={handleGoalChange}
                    placeholder="Crack final semester maths exam"
                  />
                </label>

                <div className="inline-fields">
                  <label>
                    Exam date
                    <input
                      type="date"
                      name="examDate"
                      value={goalForm.examDate}
                      onChange={handleGoalChange}
                    />
                  </label>

                  <label>
                    Daily hours
                    <input
                      type="number"
                      min="1"
                      max="12"
                      name="dailyHours"
                      value={goalForm.dailyHours}
                      onChange={handleGoalChange}
                    />
                  </label>
                </div>

                <div className="inline-fields">
                  <label>
                    Target score
                    <input
                      type="number"
                      min="1"
                      max="100"
                      name="targetScore"
                      value={goalForm.targetScore}
                      onChange={handleGoalChange}
                      placeholder="85"
                    />
                  </label>

                  <label>
                    Study days
                    <input
                      name="studyDays"
                      value={goalForm.studyDays}
                      onChange={handleGoalChange}
                      placeholder="Mon,Tue,Wed,Thu,Fri,Sat"
                    />
                  </label>
                </div>

                <label>
                  Subjects
                  <textarea
                    name="subjects"
                    value={goalForm.subjects}
                    onChange={handleGoalChange}
                    placeholder="Maths, Physics, Organic Chemistry"
                    rows="4"
                  />
                </label>

                <button className="primary-button" type="submit">
                  Generate AI calendar
                </button>
              </form>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Current plan</p>
                  <h3>{planner.goal?.goalTitle || "No active study goal yet"}</h3>
                </div>
              </div>

              {planner.goal ? (
                <div className="summary-stack">
                  <div className="summary-card">
                    <span>Exam date</span>
                    <strong>{formatDateLabel(planner.goal.examDate)}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Days to exam</span>
                    <strong>{analytics?.daysToExam ?? 0}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Strongest subject</span>
                    <strong>{analytics?.strongestSubject || "None yet"}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Needs attention</span>
                    <strong>{analytics?.weakestSubject || "None yet"}</strong>
                  </div>
                </div>
              ) : (
                <p className="muted muted-dark">
                  Generate your first plan to populate the dashboard.
                </p>
              )}
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Sync and reminders</p>
                  <h3>Cloud status and upcoming notification queue</h3>
                </div>
              </div>

              <div className="revision-list">
                <div className="milestone-item">
                  <span>{user?.isAnonymous ? "Guest mode" : "Signed in cloud sync"}</span>
                  <small>{authStatus}</small>
                </div>
                <div className="milestone-item">
                  <span>Browser reminders</span>
                  <small>{notificationsEnabled ? "Enabled" : "Disabled"}</small>
                </div>
                <div className="inline-fields">
                  <label>
                    Session lead (mins)
                    <input
                      type="number"
                      min="5"
                      max="120"
                      name="sessionLeadMinutes"
                      value={planner.reminderRules?.sessionLeadMinutes || 15}
                      onChange={handleReminderRuleChange}
                    />
                  </label>
                  <label>
                    Morning brief hour
                    <input
                      type="number"
                      min="0"
                      max="23"
                      name="morningBriefHour"
                      value={planner.reminderRules?.morningBriefHour || 7}
                      onChange={handleReminderRuleChange}
                    />
                  </label>
                </div>
                <div className="inline-fields">
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      name="morningBriefEnabled"
                      checked={planner.reminderRules?.morningBriefEnabled ?? true}
                      onChange={handleReminderRuleChange}
                    />
                    Morning brief
                  </label>
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      name="eveningWrapEnabled"
                      checked={planner.reminderRules?.eveningWrapEnabled ?? false}
                      onChange={handleReminderRuleChange}
                    />
                    Evening wrap
                  </label>
                </div>
                {planner.reminderRules?.eveningWrapEnabled ? (
                  <label>
                    Evening wrap hour
                    <input
                      type="number"
                      min="0"
                      max="23"
                      name="eveningWrapHour"
                      value={planner.reminderRules?.eveningWrapHour || 20}
                      onChange={handleReminderRuleChange}
                    />
                  </label>
                ) : null}
                {!notificationsEnabled ? (
                  <button className="primary-button" onClick={enableNotifications}>
                    Enable reminders
                  </button>
                ) : null}
                {upcomingReminders.length ? (
                  upcomingReminders.map((session) => (
                    <div key={session.id} className="milestone-item">
                      <span>
                        {session.subject}: {session.topic}
                      </span>
                      <small>{formatDateTimeLabel(session.reminderAt)}</small>
                    </div>
                  ))
                ) : (
                  <p className="muted muted-dark">
                    Upcoming reminders will appear here when sessions are scheduled.
                  </p>
                )}
                {(planner.notifications?.inbox || []).length ? (
                  <>
                    <p className="label">Notification inbox</p>
                    {planner.notifications.inbox.slice(0, 4).map((notification) => (
                      <div key={notification.id} className="memory-item">
                        <strong>{notification.title}</strong>
                        <div>{notification.body}</div>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Adaptive memory</p>
                  <h3>What the system is learning and correcting</h3>
                </div>
              </div>

              {planner.memory ? (
                <div className="revision-list">
                  {(planner.plan?.adaptivePlan?.actions || []).length ? (
                    (planner.plan?.adaptivePlan?.actions || []).map((action) => (
                      <div key={action} className="milestone-item">
                        <span>{action}</span>
                        <small>Adaptive</small>
                      </div>
                    ))
                  ) : null}
                  {(planner.memory?.recentMisses || []).slice(0, 2).map((miss) => (
                    <div key={`${miss.date}-${miss.topic}`} className="milestone-item">
                      <span>Missed: {miss.subject} - {miss.topic}</span>
                      <small>{formatDateLabel(miss.date)}</small>
                    </div>
                  ))}
                  {!planner.plan?.adaptivePlan?.actions?.length &&
                  !planner.memory?.recentMisses?.length ? (
                    <p className="muted muted-dark">
                      No pressure signals yet. Keep logging sessions and the coach memory
                      will grow from your real patterns.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="muted muted-dark">
                  Coach memory will appear here once a calendar is generated.
                </p>
              )}
            </article>
          </section>
        ) : null}

        {activeTab === "today" ? (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Today&apos;s execution</p>
                <h3>
                  Sessions for{" "}
                  {new Intl.DateTimeFormat("en-IN", {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  }).format(new Date())}
                </h3>
              </div>
            </div>

            {todaySessions.length ? (
              <div className="session-list">
                {todaySessions.map((session) => (
                  <article key={session.id} className="session-card">
                    <div>
                      <p className={`label ${session.type === "revise" ? "revision-label" : ""}`}>
                        {session.subject}
                      </p>
                      <h4>{session.topic}</h4>
                      <p className="session-meta">
                        {session.type} session · {session.duration} mins
                      </p>
                    </div>

                    <div className="session-actions">
                      <button
                        className={session.status === "done" ? "primary-button" : "ghost-button"}
                        onClick={() => handleSessionStatus(session.date, session.id, "done")}
                      >
                        Mark done
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => launchFocusMode(session)}
                      >
                        Focus mode
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => handleSessionStatus(session.date, session.id, "missed")}
                      >
                        Missed
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted muted-dark">
                No sessions were scheduled for today yet. Generate a plan or widen your
                study days.
              </p>
            )}
          </section>
        ) : null}

        {activeTab === "calendar" ? (
          <section className="panel calendar-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Calendar view</p>
                <h3>Daily schedule with revision spacing built in</h3>
              </div>
            </div>

            {planner.plan?.weeklySchedule?.length ? (
              <>
                <div className="calendar-grid">
                  {planner.plan.weeklySchedule.map((day) => {
                    const revisionCount = day.sessions.filter(
                      (session) => session.type === "revise",
                    ).length;

                    return (
                      <button
                        key={day.date}
                        className={
                          selectedCalendarDate === day.date
                            ? "calendar-day selected"
                            : "calendar-day"
                        }
                        onClick={() => setSelectedCalendarDate(day.date)}
                      >
                        <span className="calendar-day-label">{day.dayLabel}</span>
                        <strong>{new Date(day.date).getDate()}</strong>
                        <small>{day.sessions.length} sessions</small>
                        <small>{revisionCount} revisions</small>
                      </button>
                    );
                  })}
                </div>

                <div className="calendar-detail">
                  <div>
                    <p className="label">Selected date</p>
                    <h3>{formatDateLabel(selectedCalendarDate)}</h3>
                  </div>

                  {calendarSessions.length ? (
                    <div className="session-list">
                      {calendarSessions.map((session) => (
                        <article key={session.id} className="session-card">
                          <div>
                            <p
                              className={`label ${
                                session.type === "revise" ? "revision-label" : ""
                              }`}
                            >
                              {session.subject}
                            </p>
                            <h4>{session.topic}</h4>
                            <p className="session-meta">
                              {session.type} session · {session.duration} mins · {session.status}
                            </p>
                          </div>

                          <div className="session-actions">
                            <button
                              className={
                                session.status === "done"
                                  ? "primary-button"
                                  : "ghost-button"
                              }
                              onClick={() =>
                                handleSessionStatus(session.date, session.id, "done")
                              }
                            >
                              Mark done
                            </button>
                            <button
                              className="ghost-button"
                              onClick={() => launchFocusMode(session)}
                            >
                              Focus mode
                            </button>
                            <button
                              className="ghost-button"
                              onClick={() =>
                                handleSessionStatus(session.date, session.id, "missed")
                              }
                            >
                              Missed
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted muted-dark">
                      No sessions on this day. This can act as a buffer or recovery slot.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="muted muted-dark">
                Generate a calendar to see the schedule and revision spacing.
              </p>
            )}
          </section>
        ) : null}

        {activeTab === "focus" ? (
          <section className="panel focus-layout">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Focus mode</p>
                <h3>Run a timed session, then record how it really went</h3>
              </div>
            </div>

            {activeFocusSession ? (
              <div className="focus-grid">
                <article className="focus-timer-card">
                  <p className={`label ${activeFocusSession.type === "revise" ? "revision-label" : ""}`}>
                    {activeFocusSession.subject}
                  </p>
                  <h3>{activeFocusSession.topic}</h3>
                  <p className="session-meta">
                    {activeFocusSession.type} session · target {activeFocusSession.duration} mins
                  </p>
                  <div className="timer-display">{formatTimer(timerSecondsLeft)}</div>
                  <div className="session-actions">
                    <button
                      className="primary-button"
                      onClick={() => setIsTimerRunning((current) => !current)}
                    >
                      {isTimerRunning ? "Pause" : "Start"}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => {
                        setIsTimerRunning(false);
                        setTimerSecondsLeft((activeFocusSession.duration || 0) * 60);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </article>

                <article className="panel focus-feedback-card">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Post-session feedback</p>
                      <h3>Update mastery with quality, not just completion</h3>
                    </div>
                  </div>

                  <div className="feedback-grid">
                    <label>
                      Focus
                      <input
                        type="range"
                        min="1"
                        max="5"
                        name="focusScore"
                        value={feedbackForm.focusScore}
                        onChange={handleFeedbackChange}
                      />
                    </label>
                    <label>
                      Confidence
                      <input
                        type="range"
                        min="1"
                        max="5"
                        name="confidenceScore"
                        value={feedbackForm.confidenceScore}
                        onChange={handleFeedbackChange}
                      />
                    </label>
                    <label>
                      Energy
                      <input
                        type="range"
                        min="1"
                        max="5"
                        name="energyScore"
                        value={feedbackForm.energyScore}
                        onChange={handleFeedbackChange}
                      />
                    </label>
                    <label>
                      Actual minutes
                      <input
                        type="number"
                        min="1"
                        name="actualMinutes"
                        value={feedbackForm.actualMinutes}
                        onChange={handleFeedbackChange}
                      />
                    </label>
                  </div>

                  <label>
                    Notes
                    <textarea
                      name="notes"
                      value={feedbackForm.notes}
                      onChange={handleFeedbackChange}
                      rows="4"
                      placeholder="What felt easy, where did you get stuck, what should the next session reinforce?"
                    />
                  </label>

                  <div className="session-actions">
                    <button className="primary-button" onClick={submitSessionFeedback}>
                      Save feedback as done
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => handleSessionStatus(activeFocusSession.date, activeFocusSession.id, "missed")}
                    >
                      Mark missed
                    </button>
                  </div>
                </article>
              </div>
            ) : (
              <p className="muted muted-dark">
                Start focus mode from any session in Today or Calendar to run a timer and
                log learning quality afterward.
              </p>
            )}
          </section>
        ) : null}

        {activeTab === "analytics" ? (
          <section className="analytics-stack">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Readiness model</p>
                  <h3>How prepared you look right now</h3>
                </div>
              </div>

              <div className="metric-grid analytics-grid">
                <article className="metric-card accent-card">
                  <span>Readiness score</span>
                  <strong>{analytics?.readinessScore || 0}%</strong>
                </article>
                <article className="metric-card">
                  <span>Completion rate</span>
                  <strong>{analytics?.completionRate || 0}%</strong>
                </article>
                <article className="metric-card">
                  <span>Coverage score</span>
                  <strong>{analytics?.coverageScore || 0}%</strong>
                </article>
                <article className="metric-card">
                  <span>Current streak</span>
                  <strong>{analytics?.currentStreak || 0}</strong>
                </article>
              </div>
            </section>

            <section className="panel-grid analytics-panel-grid">
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Performance summary</p>
                    <h3>Time, completion, and recovery signals</h3>
                  </div>
                </div>

                <div className="summary-stack">
                  <div className="summary-card">
                    <span>Completed minutes</span>
                    <strong>{analytics?.completedMinutes || 0}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Planned minutes</span>
                    <strong>{analytics?.plannedMinutes || 0}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Missed sessions</span>
                    <strong>{analytics?.missedSessions || 0}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Upcoming sessions</span>
                    <strong>{analytics?.upcomingSessionCount || 0}</strong>
                  </div>
                </div>
              </article>

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Subject mastery</p>
                    <h3>Where you are strongest and weakest</h3>
                  </div>
                </div>

                {analytics?.subjectBreakdown?.length ? (
                  <div className="subject-list">
                    {analytics.subjectBreakdown.map((subject) => (
                      <article key={subject.subject} className="subject-card">
                        <div className="subject-header">
                          <strong>{subject.subject}</strong>
                          <span>{subject.mastery}% mastery</span>
                        </div>
                        <div className="subject-bar">
                          <div style={{ width: `${subject.mastery}%` }}></div>
                        </div>
                        <p className="muted-dark">
                          {subject.completedSessions}/{subject.plannedSessions} sessions done ·{" "}
                          {subject.completedMinutes} mins completed
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted muted-dark">
                    Subject analytics will appear after generating a plan.
                  </p>
                )}
              </article>
            </section>
          </section>
        ) : null}

        {activeTab === "coach" ? (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">AI coach</p>
                <h3>Ask for strategy, recovery, or adaptive replanning advice</h3>
              </div>
            </div>

            <div className="coach-box">
              <div className="coach-memory-grid">
                <article className="summary-card">
                  <span>Weak subjects in memory</span>
                  <strong>
                    {planner.memory?.weakSubjects?.map((subject) => subject.subject).join(", ") ||
                      "None yet"}
                  </strong>
                </article>
                <article className="summary-card">
                  <span>Recent misses</span>
                  <strong>{planner.memory?.recentMisses?.length || 0}</strong>
                </article>
                <article className="summary-card">
                  <span>Last coach question</span>
                  <strong>{planner.memory?.lastCoachQuestion || "No question yet"}</strong>
                </article>
              </div>
              <textarea
                value={coachPrompt}
                onChange={(event) => setCoachPrompt(event.target.value)}
                placeholder="I missed two physics sessions and chemistry is still weak. How should I rebalance the next 5 study days?"
                rows="4"
              />
              <button className="primary-button" onClick={handleCoachAsk}>
                Ask coach
              </button>
              <div className="coach-reply">
                <p className="label">Reply</p>
                <p>{coachReply || "Your coach will answer with analytics-aware advice here."}</p>
              </div>
              {planner.memory?.insights?.length ? (
                <div className="memory-list">
                  <p className="label">Recent coach memory</p>
                  {planner.memory.insights.map((insight, index) => (
                    <div key={`${index}-${insight.slice(0, 20)}`} className="memory-item">
                      {insight}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>
      <SpeedInsights />
    </div>
  );
}

export default App;
