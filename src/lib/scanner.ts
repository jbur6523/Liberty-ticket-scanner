import type { ScanResult, Ticket } from "../types";
import { codeVariants } from "./normalize";

export function findTicket(tickets: Ticket[], scannedValue: string): Ticket | undefined {
  const variants = new Set(codeVariants(scannedValue));
  return tickets.find((ticket) => ticket.identifiers.some((identifier) => variants.has(identifier)));
}

export function scanTicket(tickets: Ticket[], scannedValue: string): { tickets: Ticket[]; result: ScanResult } {
  const ticket = findTicket(tickets, scannedValue);
  if (!ticket) return { tickets, result: { status: "not_found", code: scannedValue } };

  if (ticket.checkedIn) return { tickets, result: { status: "already_scanned", ticket } };

  const checkedInTicket: Ticket = {
    ...ticket,
    checkedIn: true,
    checkedInAt: new Date().toISOString(),
  };

  return {
    tickets: tickets.map((item) => (item.id === ticket.id ? checkedInTicket : item)),
    result: { status: "valid", ticket: checkedInTicket },
  };
}

export function ticketSearchText(ticket: Ticket) {
  return [
    ticket.ticketCode,
    ticket.ticketNumber,
    ticket.barcode,
    ticket.reference,
    ticket.orderReference,
    ticket.attendeeName,
    ticket.email,
    ticket.eventName,
    ticket.fighter,
    ticket.sourceName,
    ticket.ticketType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
