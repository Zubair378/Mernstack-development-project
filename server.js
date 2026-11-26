require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  throw new Error('Set MONGO_URI and JWT_SECRET in .env');
}
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: 'http://localhost:5173' } });
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '20kb' }));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['organizer', 'customer'], required: true },
  holdSlots: [{ _id: false, token: String, expiresAt: Date }]
}, { timestamps: true });
const eventSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  rows: { type: Number, required: true },
  seatsPerRow: { type: Number, required: true },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
const seatSchema = new mongoose.Schema({
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  row: { type: Number, required: true },
  number: { type: Number, required: true },
  status: { type: String, enum: ['available', 'held', 'booked'], default: 'available' },
  heldBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  holdToken: { type: String, default: null },
  holdUntil: { type: Date, default: null },
  bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
});
seatSchema.index({ event: 1, row: 1, number: 1 }, { unique: true });
const User = mongoose.model('User', userSchema);
const Seat = mongoose.model('Seat', seatSchema);
const Event = mongoose.model('Event', eventSchema);

function authenticate(req, res, next) {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  try {
    if (!match) throw new Error('missing token');
    req.auth = jwt.verify(match[1], process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Please log in.' });
  }
}
function customerOnly(req, res, next) {
  if (req.auth.role !== 'customer') return res.status(403).json({ message: 'Customer access required.' });
  next();
}
function organizerOnly(req, res, next) {
  if (req.auth.role !== 'organizer') return res.status(403).json({ message: 'Organizer access required.' });
  next();
}
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim()) || typeof password !== 'string' || password.length < 8 || !['organizer', 'customer'].includes(role)) {
      return res.status(400).json({ message: 'Provide a name, valid email, password of at least 8 characters, and role.' });
    }
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Email is already registered.' });
    next(err);
  }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password.' });
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) { next(err); }
});
app.get('/api/events', async (req, res, next) => {
  try { res.json(await Event.find().sort({ date: 1 }).lean()); } catch (err) { next(err); }
});
app.post('/api/events', authenticate, organizerOnly, async (req, res, next) => {
  try {
    const { title, date, rows, seatsPerRow } = req.body;
    if (typeof title !== 'string' || !title.trim() || !date || Number.isNaN(Date.parse(date)) || !Number.isInteger(rows) || !Number.isInteger(seatsPerRow) || rows < 1 || rows > 50 || seatsPerRow < 1 || seatsPerRow > 50) {
      return res.status(400).json({ message: 'Provide a title, valid date, and row and seat counts between 1 and 50.' });
    }
    const event = await Event.create({ title, date, rows, seatsPerRow, organizer: req.auth.id });
    try {
      const seats = [];
      for (let row = 1; row <= rows; row++) {
        for (let number = 1; number <= seatsPerRow; number++) seats.push({ event: event._id, row, number });
      }
      await Seat.insertMany(seats);
    } catch (err) {
      await Seat.deleteMany({ event: event._id });
      await Event.deleteOne({ _id: event._id });
      throw err;
    }
    res.status(201).json(event);
  } catch (err) { next(err); }
});
// Roll number 1 is provisional. Replace it with the actual roll number before submission.
const ROLL_NUMBER = 1;
const HOLD_MS = (60 + ROLL_NUMBER) * 1000;
const publicSeat = seat => ({ id: seat._id, event: seat.event, row: seat.row,
  number: seat.number, status: seat.status, holdUntil: seat.holdUntil });
function notifySeat(seat) { io.to(String(seat.event)).emit('seat:changed', publicSeat(seat)); }

// Release one expired hold with a conditional update so a newer hold cannot be overwritten.
async function releaseExpired(seat) {
  const updated = await Seat.findOneAndUpdate(
    { _id: seat._id, status: 'held', holdUntil: { $lte: new Date() }, holdToken: seat.holdToken },
    { $set: { status: 'available', heldBy: null, holdToken: null, holdUntil: null } }, { new: true }
  );
  if (updated) notifySeat(updated);
  return updated;
}
async function expireHolds() {
  const expired = await Seat.find({ status: 'held', holdUntil: { $lte: new Date() } }).select('_id event holdToken');
  for (const seat of expired) await releaseExpired(seat);
}
app.get('/api/events/:id/seats', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid event ID.' });
    if (!await Event.exists({ _id: req.params.id })) return res.status(404).json({ message: 'Event not found.' });
    const expired = await Seat.find({ event: req.params.id, status: 'held', holdUntil: { $lte: new Date() } });
    for (const seat of expired) await releaseExpired(seat);
    const seats = await Seat.find({ event: req.params.id }).sort({ row: 1, number: 1 }).lean();
    res.json({ holdSeconds: HOLD_MS / 1000, seats: seats.map(publicSeat) });
  } catch (err) { next(err); }
});
app.post('/api/seats/:id/hold', authenticate, customerOnly, async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid seat ID.' });
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOLD_MS);
  let reserved = false;
  try {
    // Atomically prune expired slots and reserve one of four per-user slots.
    // Each slot has the same expiry as its seat, so a crash cannot permanently consume it.
    const user = await User.findOneAndUpdate({ _id: req.auth.id, $expr: { $lt: [
      { $size: { $filter: { input: { $ifNull: ['$holdSlots', []] }, as: 'slot',
        cond: { $gt: ['$$slot.expiresAt', now] } } } }, 4 ] } }, [
      { $set: { holdSlots: { $concatArrays: [ { $filter: { input: { $ifNull: ['$holdSlots', []] },
        as: 'slot', cond: { $gt: ['$$slot.expiresAt', now] } } }, [{ token, expiresAt }] ] } } }
    ], { new: true });
    if (!user) return res.status(409).json({ message: 'You can hold at most four seats.' });
    reserved = true;
    const seat = await Seat.findOneAndUpdate({ _id: req.params.id, $or: [
      { status: 'available' }, { status: 'held', holdUntil: { $lte: now } }
    ] }, { $set: { status: 'held', heldBy: req.auth.id, holdToken: token, holdUntil: expiresAt } }, { new: true });
    if (!seat) {
      await User.updateOne({ _id: req.auth.id }, { $pull: { holdSlots: { token } } });
      reserved = false;
      return res.status(409).json({ message: 'Seat is already held or booked.' });
    }
    reserved = false; // The slot belongs to the successful hold until expiry or booking.
    notifySeat(seat);
    return res.json(publicSeat(seat));
  } catch (err) {
    if (reserved) await User.updateOne({ _id: req.auth.id }, { $pull: { holdSlots: { token } } }).catch(() => {});
    next(err);
  }
});
app.post('/api/seats/:id/book', authenticate, customerOnly, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid seat ID.' });
    const seat = await Seat.findOneAndUpdate(
      { _id: req.params.id, status: 'held', heldBy: req.auth.id, holdUntil: { $gt: new Date() } },
      { $set: { status: 'booked', bookedBy: req.auth.id, heldBy: null, holdUntil: null } }, { new: false }
    );
    if (!seat) return res.status(409).json({ message: 'Hold expired or seat is not held by you.' });
    await User.updateOne({ _id: req.auth.id }, { $pull: { holdSlots: { token: seat.holdToken } } });
    const booked = await Seat.findById(seat._id);
    notifySeat(booked);
    res.json(publicSeat(booked));
  } catch (err) { next(err); }
});
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ message: 'Server error.' });
});
io.on('connection', socket => {
  socket.on('event:join', id => {
    if (mongoose.isValidObjectId(id)) socket.join(String(id));
  });
  socket.on('event:leave', id => socket.leave(String(id)));
});
mongoose.connect(process.env.MONGO_URI).then(() => {
  expireHolds().catch(err => console.error('Expiry scan:', err.message));
  setInterval(() => expireHolds().catch(err => console.error('Expiry scan:', err.message)), 1000);
  server.listen(process.env.PORT || 3001, () => console.log('SeatLock API started'));
}).catch(err => { console.error('Database connection failed:', err.message); process.exit(1); });
