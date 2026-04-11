export default async function handler(req, res) {
  const { message } = req.body;

  res.json({
    reply: "AI working: " + message
  });
}