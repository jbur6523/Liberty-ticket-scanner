import type { AppData, AutoSyncInterval, EventOption, SyncStatus, Ticket } from "../types";
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
    return { ...defaultData, ...parsed };
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
