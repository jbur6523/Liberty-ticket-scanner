import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, AutoSyncInterval, EventOption, ScanResult, Ticket } from "./types";
import { parseCsvFiles } from "./lib/csv";
import { exportTickets } from "./lib/exportCsv";
import { scanTicket, ticketSearchText } from "./lib/scanner";
import { defaultData, loadData, mergeTickets, saveData } from "./lib/storage";
import { fetchEvents, fetchIssuedTickets } from "./lib/ticketTailor";
import { buildCleanupPreview, isTicketIncluded } from "./lib/eventFilters";

type View = "dashboard" | "setup" | "scan" | "tickets" | "export";

const autoSyncOptions: { label: string; value: AutoSyncInterval }[] = [
  { label: "Off", value: 0 },
  { label: "Every 1 min", value: 1 },
  { label: "Every 3 min", value: 3 },
  { label: "Every 5 min", value: 5 },
  { label: "Every 10 min", value: 10 },
];

export default function App() {
  return (
    <AppErrorBoundary>
      <TicketScannerApp />
    </AppErrorBoundary>
  );
}

function TicketScannerApp() {
  const [data, setData] = useState<AppData>(defaultData);
  const [view, setView] = useState<View>("dashboard");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketFilter, setTicketFilter] = useState<"all" | "checked" | "open">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const dataRef = useRef(data);

  const activeTickets = useMemo(
    () => data.tickets.filter((ticket) => isTicketIncluded(ticket, data.includeEventNameContains, data.excludeEventNameContains)),
    [data.tickets, data.includeEventNameContains, data.excludeEventNameContains]
  );

  useEffect(() => {
    try {
      const saved = loadData();
      setData(saved);
      setApiKeyInput(saved.apiKey || "");
    } catch (error) {
      setSetupError(`Could not load saved setup data. Using safe defaults. ${String(error)}`);
      setData(defaultData);
      setApiKeyInput("");
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      saveData(data);
    } catch (error) {
      setSetupError(`Could not save setup data on this device. ${String(error)}`);
    }
    dataRef.current = data;
  }, [data, isHydrated]);

  useEffect(() => {
    if (view !== "scan" && isScannerOpen) setIsScannerOpen(false);
  }, [view, isScannerOpen]);

  useEffect(() => {
    if (!data.autoSyncMinutes || !data.apiKey || data.selectedEventIds.length === 0) return;
    const interval = window.setInterval(() => {
      syncTickets(data.apiKey);
    }, data.autoSyncMinutes * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [data.autoSyncMinutes, data.apiKey, data.selectedEventIds.join(","), data.events.length]);

  const stats = useMemo(() => {
    const checked = activeTickets.filter((ticket) => ticket.checkedIn).length;
    const sources = new Map<string, { total: number; checked: number }>();
    for (const ticket of activeTickets) {
      const key = ticket.sourceName || ticket.fighter || ticket.eventName || "Unknown source";
      const current = sources.get(key) || { total: 0, checked: 0 };
      sources.set(key, { total: current.total + 1, checked: current.checked + (ticket.checkedIn ? 1 : 0) });
    }
    return {
      events: sources.size,
      total: activeTickets.length,
      checked,
      remaining: activeTickets.length - checked,
      sources: [...sources.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [activeTickets]);

  const oldSyncWarning = useMemo(() => {
    if (!data.syncStatus.lastSuccessfulSync) return activeTickets.length > 0 ? "No successful API sync yet. Local CSV/imported data is still available." : "";
    const ageMs = Date.now() - new Date(data.syncStatus.lastSuccessfulSync).getTime();
    return ageMs > 10 * 60 * 1000 ? "Last sync was over 10 minutes ago. Ticket list may be outdated." : "";
  }, [data.syncStatus.lastSuccessfulSync, activeTickets.length]);

  const filteredTickets = useMemo(() => {
    return activeTickets.filter((ticket) => {
      const matchesQuery = !ticketQuery || ticketSearchText(ticket).includes(ticketQuery.toLowerCase());
      const matchesChecked =
        ticketFilter === "all" || (ticketFilter === "checked" && ticket.checkedIn) || (ticketFilter === "open" && !ticket.checkedIn);
      const source = ticket.sourceName || ticket.fighter || ticket.eventName || "Unknown source";
      const matchesSource = sourceFilter === "all" || source === sourceFilter;
      return matchesQuery && matchesChecked && matchesSource;
    });
  }, [activeTickets, ticketQuery, ticketFilter, sourceFilter]);

  const persist = (next: AppData) => setData(next);

  function switchView(nextView: View) {
    if (nextView !== "scan") setIsScannerOpen(false);
    setView(nextView);
  }

  async function loadEvents() {
    const key = apiKeyInput.trim();
    if (!key) return updateStatus("failed", "Enter your Ticket Tailor API key first.");
    updateStatus("syncing", "Loading Ticket Tailor events...");
    try {
      const { events, summary } = await fetchEvents(key, data.includeEventNameContains, data.excludeEventNameContains);
      persist({
        ...data,
        apiKey: key,
        events,
        selectedEventIds: summary.unexpectedlyHighEventCount ? [] : events.map((event) => event.id),
        eventFilterSummary: summary,
        syncStatus: {
          state: summary.unexpectedlyHighEventCount ? "failed" : "success",
          message: summary.unexpectedlyHighEventCount
            ? "Unexpectedly high event count over 200. Check API parsing/pagination. Sync is blocked."
            : `Loaded ${events.length} Liberty Fight League events in the 15-day event window. ${summary.hiddenOutsideDateRange} date-excluded and ${summary.excludedByName} name-excluded events hidden.`,
          newTickets: 0,
          updatedTickets: 0,
        },
      });
    } catch (error) {
      updateStatus("failed", `Could not load events. ${String(error)}`);
    }
  }

  async function syncTickets(key = data.apiKey || apiKeyInput.trim()) {
    if (!key) return updateStatus("failed", "Enter your Ticket Tailor API key first.");
    if (data.eventFilterSummary?.unexpectedlyHighEventCount) {
      return updateStatus("failed", "Unexpectedly high event count over 200. Check API parsing/pagination before syncing.");
    }
    if (data.selectedEventIds.length === 0) return updateStatus("failed", "Select at least one event before syncing.");
    setData((current) => ({
      ...current,
      apiKey: key,
      syncStatus: { ...current.syncStatus, state: "syncing", message: "Syncing tickets...", newTickets: 0, updatedTickets: 0 },
    }));

    try {
      const allowedEventIds = new Set(data.events.map((event) => event.id));
      const selectedEventIds = data.selectedEventIds.filter((eventId) => allowedEventIds.has(eventId));
      const { tickets: incomingTickets, report } = await fetchIssuedTickets(key, data.events, selectedEventIds);
      const incoming = incomingTickets.filter((ticket) =>
        isTicketIncluded(ticket, data.includeEventNameContains, data.excludeEventNameContains)
      );
      setData((current) => {
        const merged = mergeTickets(current.tickets, incoming);
        return {
          ...current,
          apiKey: key,
          tickets: merged.tickets,
          syncStatus: {
            state: "success",
            message: `Sync complete. ${report.ticketApiCallsMade} API calls, ${report.totalTicketsReturned} tickets returned, ${merged.newTickets} new, ${merged.updatedTickets} updated.`,
            lastSuccessfulSync: new Date().toISOString(),
            newTickets: merged.newTickets,
            updatedTickets: merged.updatedTickets,
          },
          lastSyncReport: report,
        };
      });
    } catch (error) {
      setData((current) => ({
        ...current,
        syncStatus: {
          ...current.syncStatus,
          state: "failed",
          message: `Sync failed. Keep scanning with local tickets. ${String(error)}`,
          newTickets: 0,
          updatedTickets: 0,
        },
        lastSyncReport: {
          eventsFound: current.events.length,
          selectedEvents: current.selectedEventIds.length,
          ticketApiCallsMade: 0,
          totalTicketsReturned: 0,
          perEvent: [],
          errors: [String(error)],
        },
      }));
    }
  }

  function updateStatus(state: AppData["syncStatus"]["state"], message: string) {
    setData((current) => ({ ...current, syncStatus: { ...current.syncStatus, state, message, newTickets: 0, updatedTickets: 0 } }));
  }

  function toggleEvent(event: EventOption) {
    const selected = new Set(data.selectedEventIds);
    selected.has(event.id) ? selected.delete(event.id) : selected.add(event.id);
    persist({ ...data, selectedEventIds: [...selected] });
  }

  const handleScan = useCallback((code: string) => {
    const current = dataRef.current;
    const currentActiveTickets = current.tickets.filter((ticket) =>
      isTicketIncluded(ticket, current.includeEventNameContains, current.excludeEventNameContains)
    );
    const { tickets: scannedActiveTickets, result } = scanTicket(currentActiveTickets, code);
    const scannedById = new Map(scannedActiveTickets.map((ticket) => [ticket.id, ticket]));
    const tickets = current.tickets.map((ticket) => scannedById.get(ticket.id) || ticket);
    const recentScans = result.status === "not_found" ? current.recentScans : [result.ticket, ...current.recentScans].slice(0, 10);
    setData({ ...current, tickets, recentScans });
    setScanResult(result);
  }, []);

  async function importCsv(files: FileList | null) {
    if (!files?.length) return;
    const incoming = await parseCsvFiles(files);
    const merged = mergeTickets(data.tickets, incoming);
    persist({
      ...data,
      tickets: merged.tickets,
      syncStatus: {
        ...data.syncStatus,
        state: "success",
        message: `CSV import complete. ${merged.newTickets} new, ${merged.updatedTickets} updated.`,
        newTickets: merged.newTickets,
        updatedTickets: merged.updatedTickets,
      },
    });
  }

  function previewOldLocalData() {
    const cleanupPreview = buildCleanupPreview(data.tickets, data.includeEventNameContains, data.excludeEventNameContains);
    persist({ ...data, cleanupPreview });
  }

  function confirmCleanupPreview() {
    const preview = data.cleanupPreview || [];
    const removableIds = new Set(preview.flatMap((group) => group.ticketIds));
    persist({
      ...data,
      tickets: data.tickets.filter((ticket) => !removableIds.has(ticket.id)),
      cleanupPreview: [],
      syncStatus: {
        ...data.syncStatus,
        state: "success",
        message: `Removed ${removableIds.size} previewed old/out-of-range local records.`,
      },
    });
  }

  function markTicket(ticket: Ticket, checkedIn: boolean) {
    persist({
      ...data,
      tickets: data.tickets.map((item) =>
        item.id === ticket.id
          ? { ...item, checkedIn, checkedInAt: checkedIn ? item.checkedInAt || new Date().toISOString() : undefined }
          : item
      ),
    });
  }

  function clearLocalData() {
    if (!window.confirm("Clear all local tickets, scans, settings, and imported data?")) return;
    persist(defaultData);
    setApiKeyInput("");
    setScanResult(null);
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Liberty Fight League</p>
        <h1>Liberty Ticket Scanner</h1>
        <p>One master scanner for every fighter, event page, and door-list source.</p>
      </header>

      <nav className="tabs" aria-label="Main sections">
        {(["dashboard", "setup", "scan", "tickets", "export"] as View[]).map((item) => (
          <button
            type="button"
            className={view === item ? "active" : ""}
            aria-current={view === item ? "page" : undefined}
            onPointerUp={() => switchView(item)}
            onClick={() => switchView(item)}
            key={item}
          >
            {item}
          </button>
        ))}
      </nav>

      {oldSyncWarning && <div className="warning-bar">{oldSyncWarning}</div>}
      <div className={`status-bar ${data.syncStatus.state}`}>{data.syncStatus.message}</div>

      <main>
        {view === "dashboard" && (
          <section className="panel">
            <div className="stats-grid">
              <Stat label="Events/Sources" value={stats.events} />
              <Stat label="Total Tickets" value={stats.total} />
              <Stat label="Checked In" value={stats.checked} />
              <Stat label="Remaining" value={stats.remaining} />
            </div>

            <div className="section-title">
              <h2>Tickets By Event/Fighter</h2>
            </div>
            <div className="source-list">
              {stats.sources.map(([source, item]) => (
                <div className="source-row" key={source}>
                  <span>{source}</span>
                  <strong>
                    {item.checked}/{item.total}
                  </strong>
                </div>
              ))}
              {stats.sources.length === 0 && <p className="muted">Sync Ticket Tailor or import CSV files to start.</p>}
            </div>

            <div className="section-title">
              <h2>Recent Scans</h2>
            </div>
            <TicketCards tickets={data.recentScans} compact />
          </section>
        )}

        {view === "setup" && (
          <section className="panel form-stack setup-panel">
            {setupError && <div className="warning-card">{setupError}</div>}
            <label>
              Ticket Tailor API Key
              <input
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder="Paste API key"
              />
            </label>
            <p className="note">
              Version 1 stores this key in your browser if you sync tickets. Frontend-held API keys are not fully secure. For production,
              use Vercel environment variables with the included API proxy.
            </p>
            <p className="note">
              Event list is filtered to Ticket Tailor events from 15 days in the past through 15 days in the future, including Liberty Fight League and excluding Roll With It by default.
            </p>
            <label>
              Include event name contains
              <input
                value={data.includeEventNameContains}
                onChange={(event) => persist({ ...data, includeEventNameContains: event.target.value })}
              />
            </label>
            <label>
              Exclude event name contains
              <input
                value={data.excludeEventNameContains}
                onChange={(event) => persist({ ...data, excludeEventNameContains: event.target.value })}
              />
            </label>
            {data.eventFilterSummary && (
              <div className="mini-report">
                <strong>Event filter</strong>
                <span>
                  Showing events from {new Date(data.eventFilterSummary.fromDate).toLocaleDateString()} to{" "}
                  {new Date(data.eventFilterSummary.toDate).toLocaleDateString()}.
                </span>
                <span>{data.eventFilterSummary.eventsInDateRange} shown from {data.eventFilterSummary.deduplicatedEventCount} deduplicated events.</span>
                <span>{data.eventFilterSummary.rawEventsReturned} raw event rows returned from {data.eventFilterSummary.endpoint}.</span>
                <span>{data.eventFilterSummary.hiddenOutsideDateRange} events outside the date window hidden.</span>
                <span>{data.eventFilterSummary.excludedByName} events hidden by name filters.</span>
                {data.eventFilterSummary.unexpectedlyHighEventCount && (
                  <span>Unexpectedly high event count over 200. Check API parsing/pagination. Sync Now is blocked.</span>
                )}
              </div>
            )}
            <div className="button-row">
              <button type="button" className="primary" onClick={loadEvents}>Load Events</button>
              <button type="button" onClick={() => syncTickets()}>Sync Now</button>
            </div>

            <label>
              Auto Sync
              <select
                value={data.autoSyncMinutes}
                onChange={(event) => persist({ ...data, autoSyncMinutes: Number(event.target.value) as AutoSyncInterval })}
              >
                {autoSyncOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <div className="button-row">
              <button
                type="button"
                onClick={() =>
                  data.eventFilterSummary?.unexpectedlyHighEventCount
                    ? updateStatus("failed", "Unexpectedly high event count over 200. Check API parsing/pagination before selecting all.")
                    : persist({ ...data, selectedEventIds: data.events.map((event) => event.id) })
                }
              >
                Select All Events
              </button>
              <button type="button" onClick={() => persist({ ...data, selectedEventIds: [] })}>Clear Selection</button>
            </div>

            <div className="event-list">
              {data.events.map((event) => (
                <label className="check-row" key={event.id}>
                  <input type="checkbox" checked={data.selectedEventIds.includes(event.id)} onChange={() => toggleEvent(event)} />
                  <span>{event.name}{event.startDate ? ` - ${event.startDate}` : ""}</span>
                </label>
              ))}
            </div>
            {data.eventFilterSummary && <EventDebugPanel summary={data.eventFilterSummary} />}
            {data.lastSyncReport && <SyncReportPanel report={data.lastSyncReport} />}

            <div className="section-title">
              <h2>CSV Backup Import</h2>
            </div>
            <input type="file" accept=".csv,text/csv" multiple onChange={(event) => importCsv(event.target.files)} />
          </section>
        )}

        {view === "scan" && (
          <section className="panel scanner-panel">
            <button type="button" className="primary scan-toggle" onClick={() => setIsScannerOpen((open) => !open)}>
              {isScannerOpen ? "Stop Camera" : "Start Camera Scan"}
            </button>
            {isScannerOpen && <CameraScanner onScan={handleScan} />}

            <form
              className="manual-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (manualCode.trim()) handleScan(manualCode.trim());
                setManualCode("");
              }}
            >
              <input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Manual ticket code" />
              <button className="primary">Check</button>
            </form>

            {scanResult && <ScanResultPanel result={scanResult} />}
          </section>
        )}

        {view === "tickets" && (
          <section className="panel form-stack">
            <input
              value={ticketQuery}
              onChange={(event) => setTicketQuery(event.target.value)}
              placeholder="Search name, email, code, event, fighter"
            />
            <div className="filter-row">
              <select value={ticketFilter} onChange={(event) => setTicketFilter(event.target.value as typeof ticketFilter)}>
                <option value="all">All tickets</option>
                <option value="checked">Checked in</option>
                <option value="open">Not checked in</option>
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                <option value="all">All events/sources</option>
                {stats.sources.map(([source]) => <option key={source} value={source}>{source}</option>)}
              </select>
            </div>
            <TicketCards tickets={filteredTickets} onMark={markTicket} />
          </section>
        )}

        {view === "export" && (
          <section className="panel form-stack">
            <div className="warning-card">Export your checked-in list after the event so you have a backup record.</div>
            <button type="button" className="primary" onClick={() => exportTickets(activeTickets, "liberty-current-ticket-scans")}>
              Export Current Filtered CSV
            </button>
            <button type="button" onClick={() => exportTickets(data.tickets, "liberty-all-local-ticket-scans")}>Export All Local Data CSV</button>
            <button type="button" onClick={previewOldLocalData}>Preview old/out-of-range local data</button>
            {data.cleanupPreview && <CleanupPreview groups={data.cleanupPreview} onConfirm={confirmCleanupPreview} />}
            <button type="button" className="danger" onClick={clearLocalData}>Clear Local Data</button>
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type CameraDevice = {
  id: string;
  label: string;
};

function CameraScanner({ onScan }: { onScan: (code: string) => void }) {
  const scannerRef = useRef<{ clear: () => void | Promise<void> } | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("Requesting rear camera...");

  useEffect(() => {
    let isMounted = true;

    async function loadCameras() {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!isMounted) return;

      const available = await Html5Qrcode.getCameras().catch(() => []);
      if (!isMounted) return;

      const mapped = available.map((camera) => ({ id: camera.id, label: camera.label || "Camera" }));
      setCameras(mapped);

      const rearCamera = mapped.find((camera) => /back|rear|environment|wide|world/i.test(camera.label));
      setSelectedCameraId(rearCamera?.id || mapped[0]?.id || "");
      setCameraReady(true);
    }

    loadCameras().catch((error) => {
      setCameraReady(true);
      setCameraMessage(`Camera list unavailable. Trying rear camera. ${String(error)}`);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!cameraReady) return;
    let isMounted = true;

    async function startScanner() {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!isMounted) return;

      await Promise.resolve(scannerRef.current?.clear()).catch(() => undefined);
      scannerRef.current = null;
      const container = document.getElementById("qr-reader");
      if (container) container.innerHTML = "";

      const scanner = new Html5Qrcode("qr-reader");
      const cameraConfig = selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: { ideal: "environment" } };

      await scanner.start(
        cameraConfig,
        {
          fps: 10,
          qrbox: { width: 260, height: 260 },
        },
        (decodedText) => {
          const now = Date.now();
          const normalized = decodedText.trim();
          if (lastScanRef.current.code === normalized && now - lastScanRef.current.at < 2000) return;
          lastScanRef.current = { code: normalized, at: now };
          onScan(decodedText);
        },
        () => undefined
      );
      scannerRef.current = scanner;
      setCameraMessage(selectedCameraId ? "Camera ready. Rear camera is preferred when available." : "Camera ready.");
    }

    startScanner().catch((error) => {
      setCameraMessage(`Camera could not start. Check browser permission. ${String(error)}`);
    });

    return () => {
      isMounted = false;
      Promise.resolve(scannerRef.current?.clear()).catch(() => undefined);
    };
  }, [cameraReady, onScan, selectedCameraId]);

  return (
    <div className="camera-stack">
      <div className="camera-controls">
        <span>{cameraMessage}</span>
        {cameras.length > 1 && (
          <select value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.target.value)}>
            {cameras.map((camera) => (
              <option value={camera.id} key={camera.id}>{camera.label}</option>
            ))}
          </select>
        )}
      </div>
      <div className="scanner-frame">
        <div id="qr-reader" className="qr-reader" />
        <div className="scan-corners" aria-hidden="true" />
      </div>
    </div>
  );
}

function SyncReportPanel({ report }: { report: NonNullable<AppData["lastSyncReport"]> }) {
  const perEvent = Array.isArray(report.perEvent) ? report.perEvent : [];
  const errors = Array.isArray(report.errors) ? report.errors : [];

  return (
    <details className="mini-report">
      <summary>Last sync details</summary>
      <span>Events found: {report.eventsFound}</span>
      <span>Selected events: {report.selectedEvents}</span>
      <span>Ticket API calls made: {report.ticketApiCallsMade}</span>
      <span>Total tickets loaded: {report.totalTicketsReturned}</span>
      {report.selectedEvents > 0 && report.totalTicketsReturned === 0 && (
        <span>No tickets came back from the issued-ticket API. Import Ticket Tailor door-list CSVs as the backup source.</span>
      )}
      {perEvent.map((event) => (
        <span key={event.eventId}>
          {event.eventName}: {event.ticketsReturned} tickets, {event.callsMade} calls{event.error ? `, error: ${event.error}` : ""}
        </span>
      ))}
      {errors.length > 0 && <span>Errors: {errors.join(" | ")}</span>}
    </details>
  );
}

function EventDebugPanel({ summary }: { summary: NonNullable<AppData["eventFilterSummary"]> }) {
  const firstTenEvents = Array.isArray(summary.firstTenEvents) ? summary.firstTenEvents : [];

  return (
    <details className="mini-report">
      <summary>Event debug</summary>
      <span>Endpoint used: {summary.endpoint}</span>
      <span>Raw count returned: {summary.rawEventsReturned}</span>
      <span>Deduplicated count: {summary.deduplicatedEventCount}</span>
      <span>Included after filters: {summary.eventsInDateRange}</span>
      <span>Excluded count: {summary.hiddenOutsideDateRange + summary.excludedByName}</span>
      <span>Duplicate event IDs found: {summary.duplicateEventIdsFound ? "yes" : "no"}</span>
      {firstTenEvents.map((event) => (
        <span key={event.id}>{event.id}: {event.name}</span>
      ))}
    </details>
  );
}

function CleanupPreview({ groups, onConfirm }: { groups: NonNullable<AppData["cleanupPreview"]>; onConfirm: () => void }) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const total = safeGroups.reduce((sum, group) => sum + group.ticketCount, 0);
  if (safeGroups.length === 0) {
    return <div className="mini-report"><strong>Cleanup preview</strong><span>No old/out-of-range local records found.</span></div>;
  }

  return (
    <div className="mini-report">
      <strong>Cleanup preview: {total} local records</strong>
      {safeGroups.map((group) => (
        <span key={`${group.eventName}-${group.eventDate || "no-date"}`}>
          {group.eventName} {group.eventDate ? `(${new Date(group.eventDate).toLocaleDateString()})` : "(no event date)"}:{" "}
          {group.ticketCount} tickets, {group.included ? "included" : "excluded"} - {group.reasons.join(", ")}
        </span>
      ))}
      <button type="button" className="danger" onClick={onConfirm}>Confirm remove only these previewed local records</button>
    </div>
  );
}

type AppErrorBoundaryState = {
  errorMessage: string;
};

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { errorMessage: "" };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { errorMessage: error.message || "The app hit a display error." };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Liberty Ticket Scanner render error", error, info);
  }

  render() {
    if (!this.state.errorMessage) return this.props.children;

    return (
      <div className="app-shell">
        <section className="panel form-stack">
          <h1>Setup could not load</h1>
          <div className="warning-card">{this.state.errorMessage}</div>
          <p className="note">This usually means old saved browser data is incompatible with the current app version.</p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              window.localStorage.removeItem("liberty-ticket-scanner-v1");
              window.location.reload();
            }}
          >
            Reset local setup data and reload
          </button>
        </section>
      </div>
    );
  }
}

function ScanResultPanel({ result }: { result: ScanResult }) {
  if (result.status === "not_found") {
    return (
      <div className="scan-result not-found">
        <h2>NOT FOUND</h2>
        <p>{result.code}</p>
        <span>Try manual entry or sync again if tickets are still selling.</span>
      </div>
    );
  }

  const ticket = result.ticket;
  const already = result.status === "already_scanned";

  return (
    <div className={`scan-result ${already ? "already" : "valid"}`}>
      <h2>{already ? "ALREADY SCANNED" : "VALID / CHECKED IN"}</h2>
      <p>{ticket.attendeeName || ticket.email || "No attendee name"}</p>
      <span>{ticket.sourceName || ticket.fighter || ticket.eventName || "Unknown event/source"}</span>
      <span>{ticket.ticketType || "Ticket"}</span>
      <span>{ticket.ticketCode || ticket.ticketNumber || ticket.barcode || ticket.reference}</span>
      {ticket.checkedInAt && <strong>{new Date(ticket.checkedInAt).toLocaleString()}</strong>}
    </div>
  );
}

function TicketCards({ tickets, compact = false, onMark }: { tickets: Ticket[]; compact?: boolean; onMark?: (ticket: Ticket, checked: boolean) => void }) {
  if (tickets.length === 0) return <p className="muted">No tickets to show.</p>;
  return (
    <div className="ticket-list">
      {tickets.slice(0, compact ? 10 : 250).map((ticket) => (
        <article className="ticket-card" key={ticket.id}>
          <div>
            <strong>{ticket.attendeeName || ticket.email || "Unnamed attendee"}</strong>
            <span>{ticket.sourceName || ticket.fighter || ticket.eventName || "Unknown source"}</span>
            <span>{ticket.ticketCode || ticket.ticketNumber || ticket.barcode || ticket.reference || ticket.id}</span>
            {ticket.checkedInAt && <span>Checked in {new Date(ticket.checkedInAt).toLocaleString()}</span>}
          </div>
          <div className={ticket.checkedIn ? "pill checked" : "pill"}>{ticket.checkedIn ? "In" : "Open"}</div>
          {onMark && (
            <button type="button" onClick={() => onMark(ticket, !ticket.checkedIn)}>{ticket.checkedIn ? "Undo" : "Check In"}</button>
          )}
        </article>
      ))}
    </div>
  );
}
