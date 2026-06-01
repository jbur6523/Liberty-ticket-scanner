import Papa from "papaparse";
import type { Ticket } from "../types";
import { collectIdentifiers } from "./normalize";

type CsvRow = Record<string, string>;

const pick = (row: CsvRow, names: string[]) => {
  const keys = Object.keys(row);
  for (const name of names) {
    const match = keys.find((key) => key.trim().toLowerCase() === name.trim().toLowerCase());
    if (match && row[match]) return row[match].trim();
  }
  return "";
};

export async function parseCsvFiles(files: FileList): Promise<Ticket[]> {
  const allTickets: Ticket[] = [];
  for (const file of Array.from(files)) {
    const tickets = await parseOneCsv(file);
    allTickets.push(...tickets);
  }
  return dedupeTickets(allTickets);
}

function parseOneCsv(file: File): Promise<Ticket[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        resolve(
          result.data
            .map((row, index) => csvRowToTicket(row, `${file.name}:${index + 2}`))
            .filter((ticket) => ticket.identifiers.length > 0)
        );
      },
      error: reject,
    });
  });
}

function csvRowToTicket(row: CsvRow, fallbackId: string): Ticket {
  const firstName = pick(row, ["First Name", "FirstName"]);
  const lastName = pick(row, ["Last Name", "LastName"]);
  const attendeeName = pick(row, ["Name", "Attendee Name", "Full Name"]) || [firstName, lastName].filter(Boolean).join(" ");
  const ticketCode = pick(row, ["Ticket Code", "Code"]);
  const ticketNumber = pick(row, ["Ticket Number", "Ticket"]);
  const barcode = pick(row, ["Barcode"]);
  const reference = pick(row, ["Reference"]);
  const orderReference = pick(row, ["Order Reference", "Order"]);
  const eventName = pick(row, ["Event", "Event Name"]);
  const eventDate = pick(row, ["Event Date", "Start Date", "Event Start", "Starts At", "Date"]);
  const fighter = pick(row, ["Fighter"]);
  const sourceName = pick(row, ["Source"]) || fighter || eventName;
  const fields = { ...row, ticketCode, ticketNumber, barcode, reference, orderReference };
  const identifiers = collectIdentifiers(fields);
  const idKey = identifiers[0] || fallbackId;

  return {
    id: `csv:${idKey}`,
    ticketCode,
    ticketNumber,
    barcode,
    reference,
    orderReference,
    attendeeName,
    firstName,
    lastName,
    email: pick(row, ["Email", "Email Address"]),
    eventName,
    eventDate,
    fighter,
    sourceName,
    ticketType: pick(row, ["Ticket Type", "Type"]),
    status: pick(row, ["Status"]),
    originalSource: "csv",
    checkedIn: false,
    identifiers,
    raw: row,
  };
}

function dedupeTickets(tickets: Ticket[]) {
  const byIdentifier = new Map<string, Ticket>();
  for (const ticket of tickets) {
    const key = ticket.identifiers[0] || ticket.id;
    const existing = byIdentifier.get(key);
    byIdentifier.set(key, existing ? { ...existing, ...ticket, identifiers: [...new Set([...existing.identifiers, ...ticket.identifiers])] } : ticket);
  }
  return [...byIdentifier.values()];
}
