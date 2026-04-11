/* global process */

const REVISION_OFFSETS = [1, 3, 7];

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatShortDay(date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

function addDays(dateValue, amount) {
  const next = new Date(dateValue);
  next.setDate(next.getDate() + amount);
  return next;
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
  const allowedDays = new Set(
    studyDays?.length ? studyDays : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  );
  const endDate = examDate ? new Date(examDate) : new Date(availableDates[availableDates.length - 1]);

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

function addAutomaticRevisions(plan, goal) {
  if (!plan?.weeklySchedule?.length) {
    return plan;
  }

  const dayMap = new Map(
    buildDayRange(goal, plan.weeklySchedule).map((day) => [day.date, { ...day, sessions: [] }]),
  );
  const availableDates = Array.from(dayMap.keys());

  plan.weeklySchedule.forEach((day) => {
    const targetDay = dayMap.get(day.date);
    if (!targetDay) return;
    targetDay.sessions = [...day.sessions];
  });

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

        const targetDay = dayMap.get(revisionDate);
        if (!targetDay) return;

        targetDay.sessions.push({
          id: `${session.id}-rev-${revisionIndex + 1}`,
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

  return {
    ...plan,
    weeklySchedule: Array.from(dayMap.values()).sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    revisionStrategy: {
      offsets: REVISION_OFFSETS,
      totalRevisionSessions: Array.from(dayMap.values()).reduce(
        (count, day) =>
          count + day.sessions.filter((session) => session.type === "revise").length,
        0,
      ),
    },
  };
}

function buildFallbackPlan(goal) {
  const examDate = new Date(goal.examDate);
  const today = new Date();
  const totalDays = Math.max(
    7,
    Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const subjects = goal.subjects || [];
  const studyDays = goal.studyDays?.length
    ? goal.studyDays
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weeklySchedule = [];

  for (let index = 0; index < Math.min(totalDays, 14); index += 1) {
    const date = addDays(today, index);
    const dayLabel = formatShortDay(date);

    if (!studyDays.includes(dayLabel)) {
      weeklySchedule.push({
        date: formatDateKey(date),
        dayLabel,
        sessions: [],
      });
      continue;
    }

    const sessions = subjects
      .slice(0, Math.max(1, Math.min(3, subjects.length)))
      .map((subject, sessionIndex) => ({
        id: `${formatDateKey(date)}-${sessionIndex + 1}`,
        subject: subject.name,
        topic: `${subject.name} core practice`,
        duration: Math.round((goal.dailyHours * 60) / Math.max(1, subjects.length)),
        type: sessionIndex === subjects.length - 1 ? "test" : "learn",
        status: "planned",
      }));

    weeklySchedule.push({
      date: formatDateKey(date),
      dayLabel,
      sessions,
    });
  }

  return addAutomaticRevisions(
    {
      summary: `A ${subjects.length}-subject study plan leading to ${goal.goalTitle}.`,
      milestones: [
        {
          title: "Foundation coverage",
          date: weeklySchedule[3]?.date || goal.examDate,
        },
        {
          title: "Revision checkpoint",
          date: weeklySchedule[7]?.date || goal.examDate,
        },
        {
          title: "Final polish",
          date: goal.examDate,
        },
      ],
      weeklySchedule,
    },
    goal,
  );
}

async function requestPlanFromModel(goal) {
  const prompt = `
You are an elite academic planning system.
Return only valid JSON matching this exact shape:
{
  "summary": "string",
  "milestones": [{ "title": "string", "date": "YYYY-MM-DD" }],
  "weeklySchedule": [
    {
      "date": "YYYY-MM-DD",
      "dayLabel": "Mon",
      "sessions": [
        {
          "id": "string",
          "subject": "string",
          "topic": "string",
          "duration": 60,
          "type": "learn",
          "status": "planned"
        }
      ]
    }
  ]
}

Constraints:
- Use the goal title, exam date, daily hours, target score, study days, and subjects.
- Schedule at most 14 days of primary sessions.
- Prioritize learn and test sessions; revision sessions will be generated by the app.
- Balance subjects instead of repeating only one.
- Make sessions realistic and actionable.
- status must always be "planned".
- type must be one of learn, test.

Goal payload:
${JSON.stringify(goal)}
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI plan request failed.");
  }

  const outputText =
    data.output_text ||
    data.output?.[0]?.content?.find((item) => item.type === "output_text")?.text ||
    "";

  return addAutomaticRevisions(JSON.parse(outputText), goal);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const goal = req.body || {};

  if (!goal.goalTitle || !goal.examDate || !goal.subjects?.length) {
    res.status(400).json({ error: "Goal title, exam date, and subjects are required." });
    return;
  }

  try {
    const plan = await requestPlanFromModel(goal);
    res.status(200).json({ plan });
  } catch {
    res.status(200).json({ plan: buildFallbackPlan(goal) });
  }
}
