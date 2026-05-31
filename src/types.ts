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
};
