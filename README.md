# SeatLock

Question 2: a seat booking application. This stage implements the Express API, accounts, event grids, atomic seat holds, booking, Socket.IO broadcasts and server-side expiry. The React interface and full browser evidence are still in progress.

## Setup

Install Node.js and start MongoDB. Copy `.env.example` to `.env`, then replace the JWT secret with a long random value. Run `npm install` and `npm start`. The API listens on port 3001 by default.

Run `npm run test:concurrency` in a separate terminal while the server is running. The script creates test accounts and an event in the configured database, then fires 20 simultaneous requests for one seat, checks the four-seat limit and tries booking twice. Use a development database.

`ROLL_NUMBER` in `server.js` is currently 1 as a provisional value, so the hold lasts 61 seconds. Replace it with the real roll number and verify the result before submission.

Main routes: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/events`, `GET /api/events`, `GET /api/events/:id/seats`, `POST /api/seats/:id/hold`, and `POST /api/seats/:id/book`. Send a bearer token for protected routes. Socket clients emit `event:join` with an event ID and listen for `seat:changed`.

Candidate: Muhammad Zubair Tariq (zubairtari237@gmail.com).
