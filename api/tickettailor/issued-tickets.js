export default async function handler(request, response) {
  const apiKeyHeader = request.headers["x-ticket-tailor-key"];
  const apiKey = (Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader) || process.env.TICKET_TAILOR_API_KEY;
  if (!apiKey) return response.status(400).json({ error: "Missing Ticket Tailor API key." });

  const eventQuery = request.query.event_id;
  const pageQuery = request.query.page;
  const eventId = Array.isArray(eventQuery) ? eventQuery[0] : eventQuery;
  const page = Array.isArray(pageQuery) ? pageQuery[0] : pageQuery || "1";
  const url = new URL("https://api.tickettailor.com/v1/issued_tickets");
  if (eventId) url.searchParams.set("event_id", eventId);
  url.searchParams.set("page", page);
  url.searchParams.set("per_page", "100");

  try {
    const upstream = await fetch(url, {
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
