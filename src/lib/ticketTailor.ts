import type { EventOption, Ticket } from "../types";
import { collectIdentifiers } from "./normalize";

type ApiEvent = Record<string, unknown>;
type ApiTicket = Record<string, unknown>;

const proxyFetch = async (path: string, apiKey: string) => {
  const response = await fetch(`/api/tickettailor/${path}`, {
    headers: { "x-ticket-tailor-key": apiKey },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

const asText = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const nestedText = (value: unknown, key: string) => {
  if (!value || typeof value !== "object") return "";
  return asText((value as Record<string, unknown>)[key]);
};

export async function fetchEvents(apiKey: string): Promise<EventOption[]> {
  const payload = await proxyFetch("events", apiKey);
  const events = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return events.map((event: ApiEvent) => ({
    id: asText(event.id),
    name: asText(event.name || event.title || event.event_name || event.id),
    startDate: nestedText(event.start, "date") || asText(event.start_date || event.date),
  }));
}

export async function fetchIssuedTickets(apiKey: string, events: EventOption[], selectedEventIds: string[]) {
  const selected = new Set(selectedEventIds);
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const tickets: Ticket[] = [];

  for (const eventId of selected) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const payload = await proxyFetch(`issued-tickets?event_id=${encodeURIComponent(eventId)}&page=${page}`, apiKey);
      const rows: ApiTicket[] = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
      tickets.push(...rows.map((row) => apiTicketToTicket(row, eventMap.get(eventId))));

      const links = payload?.links as Record<string, unknown> | undefined;
      hasMore = Boolean(links?.next) || rows.length >= 100;
      page += 1;
      if (page > 50) hasMore = false;
    }
  }

  return tickets;
}

function apiTicketToTicket(row: ApiTicket, event?: EventOption): Ticket {
  const attendeeName = asText(
    row.name ||
      row.attendee_name ||
      row.full_name ||
      [row.first_name, row.last_name].filter(Boolean).join(" ")
  );

  const fields = {
    ...row,
    ticketId: row.id,
    ticketCode: row.ticket_code || row.code,
    ticketNumber: row.ticket_number,
    barcode: row.barcode,
    reference: row.reference,
    orderReference: row.order_reference || nestedText(row.order, "reference"),
  };

  const id = asText(row.id || row.ticket_code || row.barcode || row.reference || crypto.randomUUID());

  return {
    id: `api:${id}`,
    ticketId: asText(row.id),
    ticketCode: asText(row.ticket_code || row.code),
    ticketNumber: asText(row.ticket_number),
    barcode: asText(row.barcode),
    reference: asText(row.reference),
    orderReference: asText(row.order_reference || nestedText(row.order, "reference")),
    attendeeName,
    firstName: asText(row.first_name),
    lastName: asText(row.last_name),
    email: asText(row.email || row.attendee_email),
    eventId: event?.id || asText(row.event_id),
    eventName: event?.name || asText(row.event_name || row.event),
    fighter: asText(row.fighter),
    sourceName: event?.name || asText(row.source || row.event_name),
    ticketType: asText(row.ticket_type || row.ticket_type_name || row.type),
    status: asText(row.status),
    originalSource: "api",
    checkedIn: false,
    identifiers: collectIdentifiers(fields),
    raw: row,
  };
}
