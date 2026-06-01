import type { AppData, AutoSyncInterval, EventFilterSummary, EventOption, SyncReport, SyncStatus, Ticket } from "../types";
import { DEFAULT_EXCLUDE_EVENT_NAME, DEFAULT_INCLUDE_EVENT_NAME } from "./eventFilters";

const STORAGE_KEY = "liberty-ticket-scanner-v1";

const defaultSyncStatus: SyncStatus = {
  state: "idle",
  message: "Ready",
  newTickets: 0,
  updatedTickets: 0,
};

export const defaultData: AppData = {
  tickets: [],
  selectedEventIds: [],
  events: [],
  recentScans: [],
  autoSyncMinutes: 0,
  syncStatus: defaultSyncStatus,
  includeEventNameContains: DEFAULT_INCLUDE_EVENT_NAME,
  excludeEventNameContains: DEFAULT_EXCLUDE_EVENT_NAME,
};

export function loadData(): AppData {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultData;
  try {
    const parsed = JSON.parse(saved);
    return normalizeData({ ...defaultData, ...parsed });
  } catch {
    return defaultData;
  }
}

export function saveData(data: AppData) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function mergeTickets(existing: Ticket[], incoming: Ticket[]) {
  const byId = new Map<string, Ticket>();
  for (const ticket of existing) byId.set(ticket.id, ticket);

  let newTickets = 0;
  let updatedTickets = 0;

  for (const ticket of incoming) {
    const current = byId.get(ticket.id);
    if (!current) {
      byId.set(ticket.id, ticket);
      newTickets += 1;
      continue;
    }

    byId.set(ticket.id, {
      ...current,
      ...ticket,
      checkedIn: current.checkedIn,
      checkedInAt: current.checkedInAt,
      scannedBy: current.scannedBy,
      identifiers: [...new Set([...current.identifiers, ...ticket.identifiers])],
    });
    updatedTickets += 1;
  }

  return { tickets: [...byId.values()], newTickets, updatedTickets };
}

export function setAutoSyncMinutes(data: AppData, autoSyncMinutes: AutoSyncInterval): AppData {
  return { ...data, autoSyncMinutes };
}

export function setSyncStatus(data: AppData, syncStatus: SyncStatus): AppData {
  return { ...data, syncStatus };
}

export function setEvents(data: AppData, events: EventOption[], selectedEventIds = data.selectedEventIds): AppData {
  return { ...data, events, selectedEventIds };
}

function normalizeData(data: AppData): AppData {
  return {
    ...defaultData,
    ...data,
    tickets: Array.isArray(data.tickets) ? data.tickets : [],
    selectedEventIds: Array.isArray(data.selectedEventIds) ? data.selectedEventIds : [],
    events: Array.isArray(data.events) ? data.events : [],
    recentScans: Array.isArray(data.recentScans) ? data.recentScans : [],
    autoSyncMinutes: data.autoSyncMinutes || 0,
    syncStatus: {
      ...defaultSyncStatus,
      ...(data.syncStatus || {}),
    },
    includeEventNameContains: data.includeEventNameContains ?? DEFAULT_INCLUDE_EVENT_NAME,
    excludeEventNameContains: data.excludeEventNameContains ?? DEFAULT_EXCLUDE_EVENT_NAME,
    eventFilterSummary: data.eventFilterSummary ? normalizeEventFilterSummary(data.eventFilterSummary) : undefined,
    lastSyncReport: data.lastSyncReport ? normalizeSyncReport(data.lastSyncReport) : undefined,
    cleanupPreview: Array.isArray(data.cleanupPreview) ? data.cleanupPreview : undefined,
  };
}

function normalizeEventFilterSummary(summary: AppData["eventFilterSummary"]): NonNullable<AppData["eventFilterSummary"]> {
  const safeSummary: Partial<EventFilterSummary> = summary || {};
  return {
    endpoint: safeSummary.endpoint || "/v1/events",
    rawEventsReturned: safeSummary.rawEventsReturned || 0,
    totalEventsFound: safeSummary.totalEventsFound || 0,
    deduplicatedEventCount: safeSummary.deduplicatedEventCount || 0,
    eventsInDateRange: safeSummary.eventsInDateRange || 0,
    hiddenOutsideDateRange: safeSummary.hiddenOutsideDateRange || 0,
    excludedByName: safeSummary.excludedByName || 0,
    fromDate: safeSummary.fromDate || new Date().toISOString(),
    toDate: safeSummary.toDate || new Date().toISOString(),
    firstTenEvents: Array.isArray(safeSummary.firstTenEvents) ? safeSummary.firstTenEvents : [],
    duplicateEventIdsFound: Boolean(safeSummary.duplicateEventIdsFound),
    duplicateEventIds: Array.isArray(safeSummary.duplicateEventIds) ? safeSummary.duplicateEventIds : [],
    unexpectedlyHighEventCount: Boolean(safeSummary.unexpectedlyHighEventCount),
  };
}

function normalizeSyncReport(report: AppData["lastSyncReport"]): NonNullable<AppData["lastSyncReport"]> {
  const safeReport: Partial<SyncReport> = report || {};
  return {
    eventsFound: safeReport.eventsFound || 0,
    selectedEvents: safeReport.selectedEvents || 0,
    ticketApiCallsMade: safeReport.ticketApiCallsMade || 0,
    totalTicketsReturned: safeReport.totalTicketsReturned || 0,
    perEvent: Array.isArray(safeReport.perEvent) ? safeReport.perEvent : [],
    errors: Array.isArray(safeReport.errors) ? safeReport.errors : [],
  };
}
