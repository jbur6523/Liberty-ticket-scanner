import Papa from "papaparse";
import type { Ticket } from "../types";

export function exportTickets(tickets: Ticket[]) {
  const rows = tickets.map((ticket) => ({
    checked_in: ticket.checkedIn ? "yes" : "no",
    checked_in_at: ticket.checkedInAt || "",
    event_fighter_source: ticket.sourceName || ticket.fighter || ticket.eventName || "",
    event_name: ticket.eventName || "",
    fighter: ticket.fighter || "",
    ticket_code: ticket.ticketCode || "",
    ticket_number: ticket.ticketNumber || "",
    barcode: ticket.barcode || "",
    reference: ticket.reference || "",
    order_reference: ticket.orderReference || "",
    attendee_name: ticket.attendeeName || "",
    attendee_email: ticket.email || "",
    ticket_type: ticket.ticketType || "",
    original_source: ticket.originalSource,
  }));

  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `liberty-ticket-scans-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
