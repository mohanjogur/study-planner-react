/* global process */

function buildFallbackReply(
  message,
  goal,
  todaySessions,
  analytics,
  upcomingRevisions,
  memory,
  adaptivePlan,
) {
  const goalTitle = goal?.goalTitle || "your study goal";
  const sessionCount = todaySessions?.length || 0;
  const readiness = analytics?.readinessScore ?? 0;
  const weakSubject = analytics?.weakestSubject || "your weakest subject";
  const revisionCount = upcomingRevisions?.length || 0;
  const adaptiveAction = adaptivePlan?.actions?.[0] || "No adaptive change has been scheduled yet.";
  const memoryHint = memory?.recentMisses?.[0]?.topic || "your recent misses";
  const focusQuality = analytics?.averageFocusScore ?? 0;

  return `You are working toward ${goalTitle}. You have ${sessionCount} sessions scheduled today, readiness is ${readiness}%, focus quality is ${focusQuality}%, and ${revisionCount} revision sessions are queued next. The planner remembers trouble around ${memoryHint}. For "${message}", prioritize ${weakSubject} first, follow this adaptive move if it helps: ${adaptiveAction} Complete the nearest revision before adding new material, and keep the next two study blocks realistic so your readiness improves instead of slipping further.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const { message, goal, todaySessions, analytics, upcomingRevisions, memory, adaptivePlan } = req.body || {};

  if (!message) {
    res.status(400).json({ error: "A coach message is required." });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `You are a practical AI study coach.
Give concise, motivating advice that uses the user's current plan context.
Use the memory, adaptive plan, and focus-quality signals to avoid repeating generic advice.
If there are missed sessions or a weak subject, give a concrete 3-5 day recovery approach.

Context:
${JSON.stringify({ goal, todaySessions, analytics, upcomingRevisions, memory, adaptivePlan })}

User message:
${message}`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Coach request failed.");
    }

      const reply =
      data.output_text ||
      data.output?.[0]?.content?.find((item) => item.type === "output_text")?.text ||
      buildFallbackReply(
        message,
        goal,
        todaySessions,
        analytics,
        upcomingRevisions,
        memory,
        adaptivePlan,
      );

    res.status(200).json({ reply });
  } catch {
    res
      .status(200)
      .json({
        reply: buildFallbackReply(
          message,
          goal,
          todaySessions,
          analytics,
          upcomingRevisions,
          memory,
          adaptivePlan,
        ),
      });
  }
}
