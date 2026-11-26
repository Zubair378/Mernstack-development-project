// Run against a local development server, never production: creates test accounts and an event.
const base = process.env.API_URL || 'http://127.0.0.1:3001';
const run = Date.now() + '-' + Math.random().toString(36).slice(2);
async function request(path, method = 'GET', body, token) {
  const response = await fetch(base + path, { method, headers: {
    'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {})
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  return { status: response.status, data };
}
async function account(role, index) {
  const email = `${role}-${index}-${run}@example.test`;
  const password = 'test-password-123';
  const registered = await request('/api/auth/register', 'POST', { name: role + index, email, password, role });
  if (registered.status !== 201) throw new Error('Registration failed: ' + JSON.stringify(registered));
  const login = await request('/api/auth/login', 'POST', { email, password });
  if (login.status !== 200) throw new Error('Login failed: ' + JSON.stringify(login));
  return login.data.token;
}
(async () => {
  const organizer = await account('organizer', 0);
  const customers = await Promise.all(Array.from({ length: 20 }, (_, i) => account('customer', i)));
  const event = await request('/api/events', 'POST', { title: 'Concurrency test ' + run,
    date: '2030-01-01T12:00:00Z', rows: 1, seatsPerRow: 5 }, organizer);
  if (event.status !== 201) throw new Error('Event creation failed: ' + JSON.stringify(event));
  const map = await request('/api/events/' + event.data._id + '/seats');
  if (map.status !== 200 || map.data.seats.length !== 5) throw new Error('Seat grid was not created.');
  const seatId = map.data.seats[0].id;
  const results = await Promise.all(customers.map(token => request('/api/seats/' + seatId + '/hold', 'POST', {}, token)));
  const winners = results.map((r, i) => r.status === 200 ? i : -1).filter(i => i >= 0);
  const conflicts = results.filter(r => r.status === 409).length;
  console.log(`Simultaneous requests: ${results.length}; successful holds: ${winners.length}; conflicts: ${conflicts}`);
  if (winners.length !== 1 || conflicts !== 19) throw new Error('Concurrent hold test failed.');
  const winner = customers[winners[0]];
  const extras = await Promise.all(map.data.seats.slice(1).map(seat => request('/api/seats/' + seat.id + '/hold', 'POST', {}, winner)));
  const success = extras.filter(r => r.status === 200).length;
  const rejected = extras.filter(r => r.status === 409).length;
  console.log(`Four-seat limit: ${success} additional holds; ${rejected} rejected`);
  if (success !== 3 || rejected !== 1) throw new Error('Hold limit test failed.');
  const booked = await request('/api/seats/' + seatId + '/book', 'POST', {}, winner);
  const repeated = await request('/api/seats/' + seatId + '/book', 'POST', {}, winner);
  console.log(`Booking: ${booked.status}; repeat booking: ${repeated.status}`);
  if (booked.status !== 200 || repeated.status !== 409) throw new Error('Booking test failed.');
  // In the development database, simulate elapsed time without waiting a minute.
  // This checks the server's stored deadline, not a browser countdown.
  if (process.env.MONGO_URI) {
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGO_URI);
    const expiring = map.data.seats.find(seat => extras.some(r => r.status === 200 && r.data.id === seat.id));
    await mongoose.connection.collection('seats').updateOne(
      { _id: new mongoose.Types.ObjectId(expiring.id) }, { $set: { holdUntil: new Date(Date.now() - 1000) } }
    );
    const late = await request('/api/seats/' + expiring.id + '/book', 'POST', {}, winner);
    const refreshed = await request('/api/events/' + event.data._id + '/seats');
    const released = refreshed.data.seats.find(seat => seat.id === expiring.id);
    console.log(`Expired booking: ${late.status}; seat after expiry: ${released.status}`);
    await mongoose.disconnect();
    if (late.status !== 409 || released.status !== 'available') throw new Error('Expiry test failed.');
  } else console.log('Expiry simulation skipped: set MONGO_URI to the same development database as the server.');
  console.log('PASS');
})().catch(err => { console.error(err); process.exitCode = 1; });
