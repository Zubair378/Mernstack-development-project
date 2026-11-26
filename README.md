# SeatLock

Question 2: a seat booking application. The Express API and React interface support accounts, event grids, atomic seat holds, booking, Socket.IO broadcasts and server-side expiry.

## Setup

Install Node.js and start MongoDB. Copy `.env.example` to `.env`, then replace the JWT secret with a long random value. Run `npm install`, then run `npm start` in one terminal and `npm run client` in another. Open http://127.0.0.1:5173 in Chrome. The API listens on port 3001 by default. Run `npm run build` to check the production client build.

Run `npm run test:concurrency` in a separate terminal while the server is running. The script creates test accounts and an event in the configured database, then fires 20 simultaneous requests for one seat, checks the four-seat limit and tries booking twice. Use a development database. Set `MONGO_URI` to that same database when running the script to include the simulated-expiry check.

`ROLL_NUMBER` in `server.js` is currently 1 as a provisional value, so the hold lasts 61 seconds. Replace it with the real roll number and verify the result before submission.

Main routes: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/events`, `GET /api/events`, `GET /api/events/:id/seats`, `POST /api/seats/:id/hold`, and `POST /api/seats/:id/book`. Send a bearer token for protected routes. Socket clients emit `event:join` with an event ID and listen for `seat:changed`.

Candidate: Muhammad Zubair Tariq (zubairtari237@gmail.com).
