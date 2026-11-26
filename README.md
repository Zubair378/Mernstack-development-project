# SeatLock

Question 2: event seat booking with live holds. This is the first development stage; seat holding, booking, the React interface, and concurrency tests are still to be implemented.

## Setup

Install Node.js and MongoDB. Copy `.env.example` to `.env` and set a strong JWT secret. Run `npm install` and `npm start`. The API listens on port 3001 by default.

The examination requires a hold duration of 60 + the candidate's roll number in seconds. The roll number has not yet been confirmed; no assumed number should be treated as the actual one.

Candidate: Muhammad Zubair Tariq (zubairtari237@gmail.com).
