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

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildDailyBrief(plan, dateKey) {
  const sessions = flattenSessions(plan).filter(
    (session) => session.date === dateKey && session.status !== "done",
  );

  if (!sessions.length) return null;

  return {
    id: `brief-${dateKey}`,
    type: "daily-brief",
    title: "Morning study brief",
    body: `${sessions.length} sessions planned today. First up: ${sessions[0].subject} - ${sessions[0].topic}.`,
    scheduledFor: `${dateKey}T07:00:00.000Z`,
  };
}

function buildEveningWrap(plan, dateKey) {
  const sessions = flattenSessions(plan).filter((session) => session.date === dateKey);

  if (!sessions.length) return null;

  const doneCount = sessions.filter((session) => session.status === "done").length;

  return {
    id: `wrap-${dateKey}`,
    type: "evening-wrap",
    title: "Evening study wrap",
    body: `You completed ${doneCount}/${sessions.length} sessions today. Review tomorrow's queue before logging off.`,
    scheduledFor: `${dateKey}T20:00:00.000Z`,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const { planner, reminderRules, deliveredIds = [], now } = req.body || {};
  const currentTime = now ? new Date(now) : new Date();
  const currentMs = currentTime.getTime();
  const todayKey = formatDateKey(currentTime);
  const alreadyDelivered = new Set(deliveredIds);

  const sessionNotifications = flattenSessions(planner?.plan)
    .filter((session) => session.status !== "done" && session.reminderAt)
    .map((session) => ({
      id: `session-${session.id}`,
      type: "session-reminder",
      title: `${session.subject} starts soon`,
      body: `${session.topic} begins at ${new Date(session.scheduledAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}.`,
      scheduledFor: session.reminderAt,
    }));

  const recurringNotifications = [];

  if (reminderRules?.morningBriefEnabled) {
    const brief = buildDailyBrief(planner?.plan, todayKey);
    if (brief) {
      brief.scheduledFor = `${todayKey}T${String(reminderRules.morningBriefHour).padStart(2, "0")}:00:00.000Z`;
      recurringNotifications.push(brief);
    }
  }

  if (reminderRules?.eveningWrapEnabled) {
    const wrap = buildEveningWrap(planner?.plan, todayKey);
    if (wrap) {
      wrap.scheduledFor = `${todayKey}T${String(reminderRules.eveningWrapHour).padStart(2, "0")}:00:00.000Z`;
      recurringNotifications.push(wrap);
    }
  }

  const dueNotifications = [...sessionNotifications, ...recurringNotifications]
    .map((notification) => ({
      ...notification,
      scheduledMs: new Date(notification.scheduledFor).getTime(),
    }))
    .filter(
      (notification) =>
        notification.scheduledMs <= currentMs &&
        currentMs - notification.scheduledMs < 15 * 60 * 1000 &&
        !alreadyDelivered.has(notification.id),
    )
    .sort((left, right) => left.scheduledMs - right.scheduledMs)
    .map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      scheduledFor: notification.scheduledFor,
    }));

  res.status(200).json({
    notifications: dueNotifications,
    checkedAt: currentTime.toISOString(),
  });
}
