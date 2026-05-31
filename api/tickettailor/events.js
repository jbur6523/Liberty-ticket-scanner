export default async function handler(request, response) {
  const apiKeyHeader = request.headers["x-ticket-tailor-key"];
  const apiKey = (Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader) || process.env.TICKET_TAILOR_API_KEY;
  if (!apiKey) return response.status(400).json({ error: "Missing Ticket Tailor API key." });

  try {
    const upstream = await ticketTailorFetch("https://api.tickettailor.com/v1/events", apiKey);

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

async function ticketTailorFetch(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
    },
  });

  if (response.status !== 401) return response;

  return fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
  });
}
