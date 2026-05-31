# Liberty Ticket Scanner

Mobile-first Ticket Tailor scanner for Liberty Fight League events.

The goal is one master scanner for the door: sync or import tickets from all selected fighter/event pages, then scan against one combined local ticket list without choosing an event before every scan.

## Features

- React + Vite browser app
- Black and gold Liberty Fight League styling
- Ticket Tailor event loading and issued-ticket sync
- Select all events or choose specific fighter/event pages
- One combined master ticket database
- QR/barcode scanning with a phone camera
- Manual ticket-code lookup
- VALID / CHECKED IN, ALREADY SCANNED, and NOT FOUND results
- Duplicate scan prevention
- CSV import backup for one or more Ticket Tailor door lists
- Local/offline scanning after tickets are synced or imported
- Auto-sync options: off, 1, 3, 5, or 10 minutes
- Ticket dashboard, ticket search, manual check-in, undo check-in
- Export CSV after the event

## Run Locally

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Open the local URL shown in your terminal.

For camera scanning from a phone, your phone and computer need to be on the same Wi-Fi. Open the computer's local network URL from your phone, such as:

```text
http://192.168.1.25:5173
```

Browsers usually require HTTPS or localhost for camera access. If your phone blocks camera permissions on a local network URL, deploy to Vercel or use a trusted HTTPS tunnel.

## Ticket Tailor API Setup

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Add your Ticket Tailor API key:

```bash
TICKET_TAILOR_API_KEY=your_ticket_tailor_api_key_here
```

Version 1 lets you paste the API key into the setup screen and stores it in your browser so event staff can sync. Frontend-held API keys are not fully secure. For production, use the Vercel environment variable instead.

## API / CORS Note

Ticket Tailor may block direct browser requests because of CORS. This project includes Vercel serverless proxy routes:

```text
api/tickettailor/events.js
api/tickettailor/issued-tickets.js
```

For local API testing with those routes, use Vercel's local runner:

```bash
npx vercel dev
```

For deployment, add `TICKET_TAILOR_API_KEY` in the Vercel project environment variables.

## How To Sync Tickets

1. Open the app.
2. Go to Setup.
3. Paste your Ticket Tailor API key.
4. Click Load Events.
5. Choose Select All Events or manually pick the fighter/event pages.
6. Click Sync Now.
7. Confirm the dashboard ticket count looks correct.
8. Set auto-sync to every 3 or 5 minutes if tickets are still selling.

The scanner searches the entire combined ticket list. You do not need to choose an event before scanning.

## CSV Import Backup

The app accepts one or more CSV files. It tries to recognize flexible Ticket Tailor-style column names:

- Ticket Code
- Ticket Number
- Barcode
- Reference
- Order Reference
- Name
- First Name
- Last Name
- Email
- Event
- Fighter
- Source
- Ticket Type
- Status

Imported CSV files are combined into the same master ticket list and de-duplicated by likely ticket identifiers.

## Sample Tickets

Use the included sample file:

```text
public/sample-tickets.csv
```

Import it from the Setup screen.

Manual test codes:

- Valid unscanned ticket: `LFL-VALID-001`
- Scan twice to test ALREADY SCANNED: `LFL-DOUBLE-002`
- Not found test: `LFL-NOT-FOUND-999`

## Event-Day Workflow

Before doors open:

1. Open the app.
2. Enter Ticket Tailor API key or use saved setup.
3. Select all relevant fighter/event pages.
4. Click Sync Now.
5. Confirm total ticket count looks correct.
6. Set auto-sync to every 3 or 5 minutes.
7. Test one sample/manual ticket code.
8. Keep CSV import available as backup.

During the event:

1. Scan every ticket at the door.
2. Use manual search if camera scan fails.
3. Watch for already-scanned warnings.
4. Hit Sync Now occasionally if tickets are still selling.
5. Keep scanning even if internet goes down using local data.

After the event:

1. Export checked-in CSV.
2. Save the file as event record.
3. Do not clear local data until export is confirmed.

## Deploy To Vercel

1. Push this project to GitHub.
2. Import the repository in Vercel.
3. Add the environment variable:

```text
TICKET_TAILOR_API_KEY
```

4. Deploy.

Vercel will build the Vite app and host the API proxy routes.

## Troubleshooting

Camera permission denied:

- Use HTTPS, localhost, or deploy to Vercel.
- Make sure the browser has camera permission.
- Try Safari or Chrome on the phone.

API sync fails:

- Confirm the API key is correct.
- Use `npx vercel dev` locally or deploy to Vercel so the proxy routes are available.
- If internet is bad, keep scanning with the local ticket list and sync again later.

Ticket not found:

- Try manual entry.
- Click Sync Now if tickets are still selling.
- Import the latest CSV door list as a backup.

Bad internet:

- Do not clear local data.
- Keep scanning with the last synced/imported ticket database.
- Export the checked-in CSV after the event.
