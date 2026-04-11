export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { goal } = req.body;

  if (!goal) {
    return res.status(400).json({ error: "Goal is required" });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: `Create a structured study plan for: ${goal}`
      })
    });

    const data = await response.json();

    console.log("AI RAW:", data);

    let text = "No response";

    if (data.output?.[0]?.content) {
      for (let item of data.output[0].content) {
        if (item.text) {
          text = item.text;
        }
      }
    }

    res.status(200).json({ plan: text });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "AI failed" });
  }
}