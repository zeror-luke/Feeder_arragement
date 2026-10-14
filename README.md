# Feeder Arrangement

Web application for viewing and maintaining KSEB Kanchiyar Section 11 kV feeder, transformer, and AB switch data.

## Features

- Browse transformer records by feeder.
- Search transformers and filter by capacity.
- Move transformer records between feeders, individually or in bulk.
- View and update AB switch links between feeders.
- Authenticate operators with usernames and passwords.
- Record changes in a shared activity log.

## Requirements

- Node.js 16 or newer
- npm

## Setup

Install the dependencies from the project root:

```bash
npm install
```

Start the application:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

The server creates `feeders.db` on first start. It imports transformer data from `trnsfmr.txt`, AB switch locations from `AB.txt`, and users from `userlist.txt` when the database is initialized.

To initialize or refresh the database without starting the web server:

```bash
npm run import
```

Set a different port with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Application Views

- `index.html` - application home page.
- `trnsfmr.html` - transformer view and feeder management.
- `ab.html` - AB switch locations and feeder links.
- `log.html` - shared activity log.
- `readonly_index.html`, `trnsfmr-readonly.html`, and `ab-readonly.html` - read-only views.

## Data Files

- `trnsfmr.txt` - feeder transformer data in sectioned CSV format.
- `AB.txt` - AB switch location names, one per line.
- `userlist.txt` - operator records in the format `name: ..., username: ..., pass: ...;`.
- `feeders.db` - generated SQLite database.

Keep `userlist.txt` private because it contains source passwords. Passwords are hashed before they are stored in SQLite.

## API

The Express server provides these JSON endpoints:

- `GET /api/transformers?feeder=<slug>`
- `GET /api/locations`
- `GET /api/feeders`
- `GET /api/ablinks`
- `POST /api/ablink`
- `DELETE /api/ablink/:locationId`
- `POST /api/login`
- `GET /api/logs?limit=<number>`
- `POST /api/logs`

The canonical feeder slugs are `feeder-kanchiyar`, `feeder-nariampara`, `feeder-vellilamkandam`, `feeder-vandanmeedu`, and `feeder-nedumkandam`.