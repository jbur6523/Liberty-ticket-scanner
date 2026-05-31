import type { EventFilterSummary, EventOption, SyncReport, Ticket } from "../types";
import { collectIdentifiers } from "./normalize";

type ApiEvent = Record<string, unknown>;
type ApiTicket = Record<string, unknown>;

export const EVENT_WINDOW_DAYS = 15;

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

export async function fetchEvents(apiKey: string): Promise<{ events: EventOption[]; summary: EventFilterSummary }> {
  const rows = await fetchAllPages<ApiEvent>("events", apiKey);
  const allEvents = rows
    .map((event) => {
      const rawDate = getEventDateValue(event);
      return {
        id: asText(event.id),
        name: asText(event.name || event.title || event.event_name || event.id),
        startDate: rawDate ? formatDateForDisplay(rawDate) : "",
        rawDate,
      };
    })
    .filter((event) => event.id);

  const window = eventDateWindow();
  const events = allEvents.filter((event) => isEventInWindow(event.rawDate, window.from, window.to));

  return {
    events,
    summary: {
      totalEventsFound: allEvents.length,
      eventsInDateRange: events.length,
      hiddenOutsideDateRange: allEvents.length - events.length,
      fromDate: window.from.toISOString(),
      toDate: window.to.toISOString(),
    },
  };
}

export async function fetchIssuedTickets(
  apiKey: string,
  events: EventOption[],
  selectedEventIds: string[]
): Promise<{ tickets: Ticket[]; report: SyncReport }> {
  const selected = new Set(selectedEventIds);
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const tickets: Ticket[] = [];
  const report: SyncReport = {
    eventsFound: events.length,
    selectedEvents: selected.size,
    ticketApiCallsMade: 0,
    totalTicketsReturned: 0,
    perEvent: [],
    errors: [],
  };

  for (const eventId of selected) {
    const event = eventMap.get(eventId);
    const eventReport: SyncReport["perEvent"][number] = {
      eventId,
      eventName: event?.name || eventId,
      callsMade: 0,
      ticketsReturned: 0,
    };

    let page = 1;
    let hasMore = true;

    try {
      while (hasMore) {
        const payload = await proxyFetch(`issued-tickets?event_id=${encodeURIComponent(eventId)}&page=${page}`, apiKey);
        report.ticketApiCallsMade += 1;
        eventReport.callsMade += 1;
        const rows = extractRows(payload) as ApiTicket[];
        tickets.push(...rows.map((row) => apiTicketToTicket(row, event)));
        eventReport.ticketsReturned += rows.length;
        report.totalTicketsReturned += rows.length;

        hasMore = hasNextPage(payload, rows);
        page += 1;
        if (page > 100) hasMore = false;
      }
    } catch (error) {
      eventReport.error = String(error);
      report.errors.push(`${eventReport.eventName}: ${String(error)}`);
    }

    report.perEvent.push(eventReport);
  }

  return { tickets, report };
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
    issuedTicketId: row.issued_ticket_id,
    ticketCode: row.ticket_code || row.code,
    ticketNumber: row.ticket_number,
    barcode: row.barcode,
    reference: row.reference,
    orderReference: row.order_reference || nestedText(row.order, "reference"),
    qrValue: row.qr_value || row.qr || row.qr_code || row.qrcode,
    url: row.url || row.ticket_url || row.download_url || row.pdf_url,
  };

  const id = asText(row.id || row.issued_ticket_id || row.ticket_code || row.barcode || row.reference || crypto.randomUUID());

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

async function fetchAllPages<T>(path: string, apiKey: string): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const joiner = path.includes("?") ? "&" : "?";
    const payload = await proxyFetch(`${path}${joiner}page=${page}`, apiKey);
    const pageRows = extractRows(payload) as T[];
    rows.push(...pageRows);
    hasMore = hasNextPage(payload, pageRows);
    page += 1;
    if (page > 100) hasMore = false;
  }

  return rows;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.items)) return record.items;
  return [];
}

function hasNextPage(payload: unknown, rows: unknown[]) {
  if (!payload || typeof payload !== "object") return rows.length >= 100;
  const record = payload as Record<string, unknown>;
  const links = record.links as Record<string, unknown> | undefined;
  const meta = record.meta as Record<string, unknown> | undefined;
  return Boolean(
    links?.next ||
      meta?.next ||
      (typeof meta?.current_page === "number" && typeof meta?.last_page === "number" && meta.current_page < meta.last_page) ||
      rows.length >= 100
  );
}

function getEventDateValue(event: ApiEvent) {
  return (
    nestedText(event.start, "date") ||
    nestedText(event.start, "datetime") ||
    nestedText(event.start, "date_time") ||
    asText(
      event.start_date ||
        event.start_time ||
        event.starts_at ||
        event.date ||
        event.event_date ||
        event.event_start ||
        event.occurs_at
    )
  );
}

function eventDateWindow() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - EVENT_WINDOW_DAYS);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setDate(now.getDate() + EVENT_WINDOW_DAYS);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

function isEventInWindow(value: string | undefined, from: Date, to: Date) {
  if (!value) return false;
  const date = parseEventDate(value);
  if (!date) return false;
  return date >= from && date <= to;
}

function parseEventDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasTimezone = /z$|[+-]\d{2}:?\d{2}$/i.test(trimmed);
  const date = new Date(hasTimezone ? trimmed : trimmed.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateForDisplay(value: string) {
  const date = parseEventDate(value);
  return date ? date.toLocaleString() : value;
}
