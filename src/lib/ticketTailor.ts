import type { EventFilterSummary, EventOption, SyncReport, Ticket } from "../types";
import { eventDateWindow, formatDateForDisplay, isEventIncluded } from "./eventFilters";
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

export async function fetchEvents(
  apiKey: string,
  includeName: string,
  excludeName: string
): Promise<{ events: EventOption[]; summary: EventFilterSummary }> {
  const rows = await fetchEventPages<ApiEvent>(apiKey);
  const mappedEvents = rows
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

  const duplicateIds = new Set<string>();
  const eventsById = new Map<string, EventOption>();
  for (const event of mappedEvents) {
    if (eventsById.has(event.id)) duplicateIds.add(event.id);
    eventsById.set(event.id, { ...eventsById.get(event.id), ...event });
  }

  const dedupedEvents = [...eventsById.values()];
  const events = dedupedEvents.filter((event) => isEventIncluded(event, includeName, excludeName));
  const window = eventDateWindow();
  const excludedByDate = dedupedEvents.filter((event) => {
    const date = parseDateForFilter(event.rawDate);
    return !date || date < window.from || date > window.to;
  }).length;
  const excludedByName = dedupedEvents.length - excludedByDate - events.length;

  return {
    events,
    summary: {
      endpoint: "/v1/events",
      rawEventsReturned: mappedEvents.length,
      totalEventsFound: mappedEvents.length,
      deduplicatedEventCount: dedupedEvents.length,
      eventsInDateRange: events.length,
      hiddenOutsideDateRange: excludedByDate,
      excludedByName: Math.max(0, excludedByName),
      fromDate: window.from.toISOString(),
      toDate: window.to.toISOString(),
      firstTenEvents: dedupedEvents.slice(0, 10).map((event) => ({ id: event.id, name: event.name })),
      duplicateEventIdsFound: duplicateIds.size > 0,
      duplicateEventIds: [...duplicateIds],
      unexpectedlyHighEventCount: dedupedEvents.length > 100,
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
    eventDate: event?.rawDate || asText(row.event_date || row.event_start || row.starts_at),
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

async function fetchEventPages<T>(apiKey: string): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  let hasMore = true;
  const fetchedPages = new Set<number>();

  while (hasMore) {
    if (fetchedPages.has(page) || page > 10) break;
    fetchedPages.add(page);

    const payload = await proxyFetch(`events?page=${page}`, apiKey);
    const pageRows = extractRows(payload) as T[];
    rows.push(...pageRows);
    hasMore = hasExplicitNextPage(payload);
    page += 1;
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

function hasExplicitNextPage(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const links = record.links as Record<string, unknown> | undefined;
  const meta = record.meta as Record<string, unknown> | undefined;
  return Boolean(
    links?.next ||
      meta?.next ||
      (typeof meta?.current_page === "number" && typeof meta?.last_page === "number" && meta.current_page < meta.last_page)
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

function parseDateForFilter(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasTimezone = /z$|[+-]\d{2}:?\d{2}$/i.test(trimmed);
  const date = new Date(hasTimezone ? trimmed : trimmed.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
