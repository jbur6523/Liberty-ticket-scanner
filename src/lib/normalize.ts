const URL_CODE_KEYS = ["code", "ticket", "ticket_code", "barcode", "reference", "ref", "id"];

export function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

export function codeVariants(value: unknown): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];

  const variants = new Set<string>();
  const add = (item: string) => {
    const normalized = normalizeCode(item);
    if (normalized) variants.add(normalized);
  };

  add(raw);
  add(raw.replace(/\s+/g, ""));

  try {
    const url = new URL(raw);
    add(url.href);
    add(url.pathname.split("/").filter(Boolean).pop() ?? "");
    for (const key of URL_CODE_KEYS) add(url.searchParams.get(key) ?? "");
  } catch {
    const parts = raw.split(/[/?#=&\s]+/).filter(Boolean);
    for (const part of parts) add(part);
  }

  return [...variants];
}

export function collectIdentifiers(fields: Record<string, unknown>): string[] {
  const likelyFields = [
    "id",
    "ticketId",
    "ticket_id",
    "issuedTicketId",
    "issued_ticket_id",
    "ticketCode",
    "ticket_code",
    "Ticket Code",
    "ticketNumber",
    "ticket_number",
    "Ticket Number",
    "barcode",
    "Barcode",
    "reference",
    "Reference",
    "orderReference",
    "order_reference",
    "Order Reference",
    "code",
    "Code",
    "qr_code",
    "qrCode",
    "qr",
    "qr_value",
    "qrcode",
    "url",
    "ticket_url",
    "download_url",
    "pdf_url",
  ];

  const identifiers = new Set<string>();
  for (const field of likelyFields) {
    for (const variant of codeVariants(fields[field])) identifiers.add(variant);
  }

  return [...identifiers];
}
