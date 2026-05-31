export default async function handler(request, response) {
  const apiKey = request.headers["x-ticket-tailor-key"] || process.env.TICKET_TAILOR_API_KEY;
  if (!apiKey) return response.status(400).json({ error: "Missing Ticket Tailor API key." });

  const eventId = request.query.event_id;
  const page = request.query.page || "1";
  const url = new URL("https://api.tickettailor.com/v1/issued_tickets");
  if (eventId) url.searchParams.set("event_id", eventId);
  url.searchParams.set("page", page);

  const upstream = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
  });

  const body = await upstream.text();
  response.status(upstream.status).setHeader("content-type", upstream.headers.get("content-type") || "application/json").send(body);
}
