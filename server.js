require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
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
  role: { type: String, enum: ['organizer', 'customer'], required: true }
}, { timestamps: true });
const eventSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  rows: { type: Number, required: true },
  seatsPerRow: { type: Number, required: true },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);
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
    res.status(201).json(event);
  } catch (err) { next(err); }
});
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ message: 'Server error.' });
});
io.on('connection', () => {});
mongoose.connect(process.env.MONGO_URI).then(() => {
  server.listen(process.env.PORT || 3001, () => console.log('SeatLock API started'));
}).catch(err => { console.error('Database connection failed:', err.message); process.exit(1); });
