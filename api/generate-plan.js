export default async function handler(req, res) {
  const { goal } = req.body;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: `Create a study plan for: ${goal}`
      })
    });

    const data = await response.json();

    let text = "No response";

    if (data.output?.[0]?.content) {
      for (let item of data.output[0].content) {
        if (item.text) text = item.text;
      }
    }

    res.status(200).json({ plan: text });

  } catch {
    res.status(500).json({ error: "AI failed" });
  }
}