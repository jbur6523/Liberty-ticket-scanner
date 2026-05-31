export default async function handler(request, response) {
  const apiKeyHeader = request.headers["x-ticket-tailor-key"];
  const apiKey = (Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader) || process.env.TICKET_TAILOR_API_KEY;
  if (!apiKey) return response.status(400).json({ error: "Missing Ticket Tailor API key." });

  try {
    const upstream = await fetch("https://api.tickettailor.com/v1/events", {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
    });

    const body = await upstream.text();
    response
      .status(upstream.status)
      .setHeader("cache-control", "no-store")
      .setHeader("content-type", upstream.headers.get("content-type") || "application/json")
      .send(body);
  } catch (error) {
    response.status(502).json({ error: `Ticket Tailor request failed: ${String(error)}` });
  }
}
