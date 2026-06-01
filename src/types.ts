export type TicketSource = "api" | "csv" | "sample";

export type Ticket = {
  id: string;
  ticketId?: string;
  ticketCode?: string;
  ticketNumber?: string;
  barcode?: string;
  reference?: string;
  orderReference?: string;
  attendeeName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  eventId?: string;
  eventName?: string;
  eventDate?: string;
  fighter?: string;
  sourceName?: string;
  ticketType?: string;
  status?: string;
  originalSource: TicketSource;
  checkedIn: boolean;
  checkedInAt?: string;
  scannedBy?: string;
  identifiers: string[];
  raw?: Record<string, unknown>;
};

export type EventOption = {
  id: string;
  name: string;
  startDate?: string;
  rawDate?: string;
};

export type EventFilterSummary = {
  endpoint: string;
  rawEventsReturned: number;
  totalEventsFound: number;
  deduplicatedEventCount: number;
  eventsInDateRange: number;
  hiddenOutsideDateRange: number;
  excludedByName: number;
  fromDate: string;
  toDate: string;
  firstTenEvents: { id: string; name: string }[];
  duplicateEventIdsFound: boolean;
  duplicateEventIds: string[];
  unexpectedlyHighEventCount: boolean;
};

export type SyncEventReport = {
  eventId: string;
  eventName: string;
  callsMade: number;
  ticketsReturned: number;
  error?: string;
};

export type SyncReport = {
  eventsFound: number;
  selectedEvents: number;
  ticketApiCallsMade: number;
  totalTicketsReturned: number;
  perEvent: SyncEventReport[];
  errors: string[];
};

export type ScanResult =
  | { status: "valid"; ticket: Ticket }
  | { status: "already_scanned"; ticket: Ticket }
  | { status: "not_found"; code: string };

export type AutoSyncInterval = 0 | 1 | 3 | 5 | 10;

export type SyncStatus = {
  state: "idle" | "syncing" | "success" | "failed";
  message: string;
  lastSuccessfulSync?: string;
  newTickets: number;
  updatedTickets: number;
};

export type AppData = {
  tickets: Ticket[];
  selectedEventIds: string[];
  events: EventOption[];
  recentScans: Ticket[];
  autoSyncMinutes: AutoSyncInterval;
  syncStatus: SyncStatus;
  apiKey?: string;
  eventFilterSummary?: EventFilterSummary;
  lastSyncReport?: SyncReport;
  includeEventNameContains: string;
  excludeEventNameContains: string;
  cleanupPreview?: CleanupPreviewGroup[];
};

export type CleanupPreviewGroup = {
  eventName: string;
  eventDate?: string;
  ticketCount: number;
  included: boolean;
  reasons: string[];
  ticketIds: string[];
};
