import type { CleanupPreviewGroup, EventOption, Ticket } from "../types";

export const EVENT_WINDOW_DAYS = 15;
export const DEFAULT_INCLUDE_EVENT_NAME = "Liberty Fight League";
export const DEFAULT_EXCLUDE_EVENT_NAME = "Roll With It";

export function eventDateWindow() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - EVENT_WINDOW_DAYS);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setDate(now.getDate() + EVENT_WINDOW_DAYS);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

export function parseEventDate(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const hasTimezone = /z$|[+-]\d{2}:?\d{2}$/i.test(trimmed);
  const date = new Date(hasTimezone ? trimmed : trimmed.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatDateForDisplay(value: string | undefined) {
  const date = parseEventDate(value);
  return date ? date.toLocaleString() : value || "";
}

export function getEventExclusionReasons(
  eventName: string | undefined,
  eventDate: string | undefined,
  includeName: string,
  excludeName: string
) {
  const reasons: string[] = [];
  const normalizedName = (eventName || "").toLowerCase();
  const include = includeName.trim().toLowerCase();
  const exclude = excludeName.trim().toLowerCase();
  const date = parseEventDate(eventDate);
  const window = eventDateWindow();

  if (!date) reasons.push("missing event date");
  if (date && (date < window.from || date > window.to)) reasons.push("outside +/-15 day window");
  if (exclude && normalizedName.includes(exclude)) reasons.push(`event name contains ${excludeName}`);
  if (include && !normalizedName.includes(include)) reasons.push(`event name does not contain ${includeName}`);

  return reasons;
}

export function isEventIncluded(event: EventOption, includeName: string, excludeName: string) {
  return getEventExclusionReasons(event.name, event.rawDate, includeName, excludeName).length === 0;
}

export function isTicketIncluded(ticket: Ticket, includeName: string, excludeName: string) {
  return getEventExclusionReasons(ticket.eventName || ticket.sourceName, ticket.eventDate, includeName, excludeName).length === 0;
}

export function buildCleanupPreview(tickets: Ticket[], includeName: string, excludeName: string): CleanupPreviewGroup[] {
  const groups = new Map<string, CleanupPreviewGroup>();

  for (const ticket of tickets) {
    const eventName = ticket.eventName || ticket.sourceName || "Unknown event";
    const eventDate = ticket.eventDate;
    const parsedDate = parseEventDate(eventDate);
    const window = eventDateWindow();
    if (/liberty fight league/i.test(eventName)) continue;
    if (parsedDate && parsedDate >= window.from && parsedDate <= window.to) continue;

    const reasons = getEventExclusionReasons(eventName, eventDate, includeName, excludeName);
    const included = reasons.length === 0;

    if (included) continue;

    const key = `${eventName}|${eventDate || ""}`;
    const current =
      groups.get(key) ||
      {
        eventName,
        eventDate,
        ticketCount: 0,
        included,
        reasons,
        ticketIds: [],
      };

    current.ticketCount += 1;
    current.ticketIds.push(ticket.id);
    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => a.eventName.localeCompare(b.eventName));
}
