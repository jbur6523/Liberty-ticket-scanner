import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, AutoSyncInterval, EventOption, ScanResult, Ticket } from "./types";
import { parseCsvFiles } from "./lib/csv";
import { exportTickets } from "./lib/exportCsv";
import { scanTicket, ticketSearchText } from "./lib/scanner";
import { defaultData, loadData, mergeTickets, saveData } from "./lib/storage";
import { fetchEvents, fetchIssuedTickets } from "./lib/ticketTailor";

type View = "dashboard" | "setup" | "scan" | "tickets" | "export";

const autoSyncOptions: { label: string; value: AutoSyncInterval }[] = [
  { label: "Off", value: 0 },
  { label: "Every 1 min", value: 1 },
  { label: "Every 3 min", value: 3 },
  { label: "Every 5 min", value: 5 },
  { label: "Every 10 min", value: 10 },
];

export default function App() {
  const [data, setData] = useState<AppData>(defaultData);
  const [view, setView] = useState<View>("dashboard");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketFilter, setTicketFilter] = useState<"all" | "checked" | "open">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  useEffect(() => {
    const saved = loadData();
    setData(saved);
    setApiKeyInput(saved.apiKey || "");
  }, []);

  useEffect(() => {
    saveData(data);
  }, [data]);

  useEffect(() => {
    if (!data.autoSyncMinutes || !data.apiKey || data.selectedEventIds.length === 0) return;
    const interval = window.setInterval(() => {
      syncTickets(data.apiKey);
    }, data.autoSyncMinutes * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [data.autoSyncMinutes, data.apiKey, data.selectedEventIds.join(","), data.events.length]);

  const stats = useMemo(() => {
    const checked = data.tickets.filter((ticket) => ticket.checkedIn).length;
    const sources = new Map<string, { total: number; checked: number }>();
    for (const ticket of data.tickets) {
      const key = ticket.sourceName || ticket.fighter || ticket.eventName || "Unknown source";
      const current = sources.get(key) || { total: 0, checked: 0 };
      sources.set(key, { total: current.total + 1, checked: current.checked + (ticket.checkedIn ? 1 : 0) });
    }
    return {
      events: sources.size,
      total: data.tickets.length,
      checked,
      remaining: data.tickets.length - checked,
      sources: [...sources.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [data.tickets]);

  const oldSyncWarning = useMemo(() => {
    if (!data.syncStatus.lastSuccessfulSync) return data.tickets.length > 0 ? "No successful API sync yet. Local CSV/imported data is still available." : "";
    const ageMs = Date.now() - new Date(data.syncStatus.lastSuccessfulSync).getTime();
    return ageMs > 10 * 60 * 1000 ? "Last sync was over 10 minutes ago. Ticket list may be outdated." : "";
  }, [data.syncStatus.lastSuccessfulSync, data.tickets.length]);

  const filteredTickets = useMemo(() => {
    return data.tickets.filter((ticket) => {
      const matchesQuery = !ticketQuery || ticketSearchText(ticket).includes(ticketQuery.toLowerCase());
      const matchesChecked =
        ticketFilter === "all" || (ticketFilter === "checked" && ticket.checkedIn) || (ticketFilter === "open" && !ticket.checkedIn);
      const source = ticket.sourceName || ticket.fighter || ticket.eventName || "Unknown source";
      const matchesSource = sourceFilter === "all" || source === sourceFilter;
      return matchesQuery && matchesChecked && matchesSource;
    });
  }, [data.tickets, ticketQuery, ticketFilter, sourceFilter]);

  const persist = (next: AppData) => setData(next);

  async function loadEvents() {
    const key = apiKeyInput.trim();
    if (!key) return updateStatus("failed", "Enter your Ticket Tailor API key first.");
    updateStatus("syncing", "Loading Ticket Tailor events...");
    try {
      const events = await fetchEvents(key);
      persist({
        ...data,
        apiKey: key,
        events,
        selectedEventIds: events.map((event) => event.id),
        syncStatus: { state: "success", message: `Loaded ${events.length} events.`, newTickets: 0, updatedTickets: 0 },
      });
    } catch (error) {
      updateStatus("failed", `Could not load events. ${String(error)}`);
    }
  }

  async function syncTickets(key = data.apiKey || apiKeyInput.trim()) {
    if (!key) return updateStatus("failed", "Enter your Ticket Tailor API key first.");
    if (data.selectedEventIds.length === 0) return updateStatus("failed", "Select at least one event before syncing.");
    setData((current) => ({
      ...current,
      apiKey: key,
      syncStatus: { ...current.syncStatus, state: "syncing", message: "Syncing tickets...", newTickets: 0, updatedTickets: 0 },
    }));

    try {
      const incoming = await fetchIssuedTickets(key, data.events, data.selectedEventIds);
      setData((current) => {
        const merged = mergeTickets(current.tickets, incoming);
        return {
          ...current,
          apiKey: key,
          tickets: merged.tickets,
          syncStatus: {
            state: "success",
            message: `Sync complete. ${merged.newTickets} new, ${merged.updatedTickets} updated.`,
            lastSuccessfulSync: new Date().toISOString(),
            newTickets: merged.newTickets,
            updatedTickets: merged.updatedTickets,
          },
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
    const { tickets, result } = scanTicket(data.tickets, code);
    const recentScans = result.status === "not_found" ? data.recentScans : [result.ticket, ...data.recentScans].slice(0, 10);
    persist({ ...data, tickets, recentScans });
    setScanResult(result);
  }, [data]);

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

      <nav className="tabs">
        {(["dashboard", "setup", "scan", "tickets", "export"] as View[]).map((item) => (
          <button className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}>
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
          <section className="panel form-stack">
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
            <div className="button-row">
              <button className="primary" onClick={loadEvents}>Load Events</button>
              <button onClick={() => syncTickets()}>Sync Now</button>
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
              <button onClick={() => persist({ ...data, selectedEventIds: data.events.map((event) => event.id) })}>Select All Events</button>
              <button onClick={() => persist({ ...data, selectedEventIds: [] })}>Clear Selection</button>
            </div>

            <div className="event-list">
              {data.events.map((event) => (
                <label className="check-row" key={event.id}>
                  <input type="checkbox" checked={data.selectedEventIds.includes(event.id)} onChange={() => toggleEvent(event)} />
                  <span>{event.name}</span>
                </label>
              ))}
            </div>

            <div className="section-title">
              <h2>CSV Backup Import</h2>
            </div>
            <input type="file" accept=".csv,text/csv" multiple onChange={(event) => importCsv(event.target.files)} />
          </section>
        )}

        {view === "scan" && (
          <section className="panel scanner-panel">
            <button className="primary scan-toggle" onClick={() => setIsScannerOpen((open) => !open)}>
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
            <button className="primary" onClick={() => exportTickets(data.tickets)}>Export CSV</button>
            <button className="danger" onClick={clearLocalData}>Clear Local Data</button>
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

function CameraScanner({ onScan }: { onScan: (code: string) => void }) {
  const scannerRef = useRef<{ clear: () => Promise<void> } | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    let isMounted = true;

    async function startScanner() {
      const { Html5QrcodeScanner } = await import("html5-qrcode");
      if (!isMounted) return;

      const scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 260, height: 260 } }, false);
      scanner.render(
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
    }

    startScanner();

    return () => {
      isMounted = false;
      scannerRef.current?.clear().catch(() => undefined);
    };
  }, [onScan]);

  return <div id="qr-reader" className="qr-reader" />;
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
            <button onClick={() => onMark(ticket, !ticket.checkedIn)}>{ticket.checkedIn ? "Undo" : "Check In"}</button>
          )}
        </article>
      ))}
    </div>
  );
}
