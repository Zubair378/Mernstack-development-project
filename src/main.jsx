import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';

async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}
function App() {
  const [session, setSession] = useState(() => { try { return JSON.parse(sessionStorage.getItem('seatlock-session')); } catch { return null; } });
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState(null);
  const [seats, setSeats] = useState([]);
  const [seconds, setSeconds] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [account, setAccount] = useState({ name: '', email: '', password: '', role: 'customer' });
  const [draft, setDraft] = useState({ title: '', date: '', rows: 4, seatsPerRow: 8 });
  const refreshEvents = useCallback(async () => { try { setEvents(await api('/api/events')); } catch (error) { setMessage(error.message); } }, []);
  const refreshSeats = useCallback(async () => {
    if (!event) return;
    try { const result = await api(`/api/events/${event._id}/seats`, { token: session?.token }); setSeats(result.seats); setSeconds(result.holdSeconds); }
    catch (error) { setMessage(error.message); }
  }, [event, session]);
  useEffect(() => { refreshEvents(); }, [refreshEvents]);
  useEffect(() => {
    if (!event) return;
    const socket = io();
    socket.on('connect', () => { socket.emit('event:join', event._id); refreshSeats(); });
    socket.on('seat:changed', refreshSeats);
    return () => { socket.disconnect(); };
  }, [event, refreshSeats]);
  async function authenticate(e) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      if (authMode === 'register') await api('/api/auth/register', { method: 'POST', body: account });
      const data = await api('/api/auth/login', { method: 'POST', body: { email: account.email, password: account.password } });
      sessionStorage.setItem('seatlock-session', JSON.stringify(data)); setSession(data); setMessage('Welcome, ' + data.user.name + '.');
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function createEvent(e) {
    e.preventDefault(); setBusy(true); setMessage('');
    try { const created = await api('/api/events', { method: 'POST', token: session.token,
      body: { ...draft, rows: Number(draft.rows), seatsPerRow: Number(draft.seatsPerRow), date: new Date(draft.date).toISOString() } });
      await refreshEvents(); setEvent(created); setMessage('Event created.');
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function seatAction(seat, action) {
    setBusy(true); setMessage('');
    try { await api(`/api/seats/${seat.id}/${action}`, { method: 'POST', token: session.token });
      setMessage(action === 'hold' ? `Seat ${seat.row}-${seat.number} is held for you.` : `Seat ${seat.row}-${seat.number} booked.`);
      await refreshSeats();
    } catch (error) { setMessage(error.message); await refreshSeats(); } finally { setBusy(false); }
  }
  const held = seats.filter(seat => seat.mine && seat.status === 'held');
  return <><header><div className="wrap bar"><div className="brand"><span className="brand-icon">S</span> SeatLock</div><span className="tag">LIVE EVENT BOOKING</span>{session && <button className="text-button" onClick={() => { sessionStorage.removeItem('seatlock-session'); setSession(null); setMessage('Signed out.'); }}>Sign out</button>}</div></header>
  <main className="wrap"><section className="intro"><div><p className="eyebrow">MAKE YOUR NEXT EVENT COUNT</p><h1>A better seat, <em>one click away.</em></h1><p>Find your event, choose a seat, and make it yours. Seat availability updates live for everyone.</p></div><div className="intro-mark">✳</div></section>
  {message && <div className="notice" role="status">{message}</div>}
  <div className="layout"><aside>
    <section className="card"><div className="section-label">01 / ACCOUNT</div>{session ? <><h2>Hello, {session.user.name}</h2><p>Signed in as <strong>{session.user.role}</strong>.</p></> : <><h2>{authMode === 'login' ? 'Welcome back' : 'Create account'}</h2><form onSubmit={authenticate} className="stack">
    {authMode === 'register' && <label>Name<input required value={account.name} onChange={e => setAccount({ ...account, name: e.target.value })}/></label>}
    <label>Email<input required type="email" value={account.email} onChange={e => setAccount({ ...account, email: e.target.value })}/></label><label>Password<input required type="password" minLength="8" value={account.password} onChange={e => setAccount({ ...account, password: e.target.value })}/></label>
    {authMode === 'register' && <label>Role<select value={account.role} onChange={e => setAccount({ ...account, role: e.target.value })}><option value="customer">Customer</option><option value="organizer">Organizer</option></select></label>}
    <button disabled={busy} className="primary">{authMode === 'login' ? 'Sign in' : 'Register'}</button></form><button className="link" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}</button></>}</section>
    {session?.user.role === 'organizer' && <section className="card"><div className="section-label">ORGANIZER TOOLS</div><h2>Create an event</h2><form onSubmit={createEvent} className="stack"><label>Event title<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label><label>Date and time<input required type="datetime-local" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}/></label><div className="pair"><label>Rows<input type="number" min="1" max="50" required value={draft.rows} onChange={e => setDraft({ ...draft, rows: e.target.value })}/></label><label>Seats per row<input type="number" min="1" max="50" required value={draft.seatsPerRow} onChange={e => setDraft({ ...draft, seatsPerRow: e.target.value })}/></label></div><button className="primary" disabled={busy}>Create event</button></form></section>}
    </aside><div><section className="card"><div className="section-label">02 / FIND YOUR EVENT</div><h2>Upcoming events</h2>{events.length === 0 ? <p>No events yet. An organizer can create one.</p> : <div className="events">{events.map(item => <button key={item._id} className={'event ' + (event?._id === item._id ? 'selected' : '')} onClick={() => { setEvent(item); setSeats([]); }}><span><strong>{item.title}</strong><small>{new Date(item.date).toLocaleString()}</small></span><span>View seats →</span></button>)}</div>}</section>
    {event && <section className="card map-card"><div className="section-label">03 / CHOOSE YOUR SEATS</div><h2>{event.title}</h2><p>Select an available seat to hold it. Holds last {seconds ?? '…'} seconds; you can hold up to four.</p><div className="legend"><span><i className="dot available"/> Available</span><span><i className="dot held"/> Held</span><span><i className="dot booked"/> Booked</span><span><i className="dot mine"/> Your hold</span></div><div className="stage">STAGE</div><div className="grid-scroll"><div className="seat-grid" style={{ gridTemplateColumns: `repeat(${event.seatsPerRow}, minmax(42px, 1fr))` }}>{seats.map(seat => <button key={seat.id} title={`Row ${seat.row}, seat ${seat.number}: ${seat.status}`} className={'seat ' + (seat.mine ? 'mine' : seat.status)} disabled={busy || !session || session.user.role !== 'customer' || seat.status !== 'available'} onClick={() => seatAction(seat, 'hold')}>{seat.row}-{seat.number}</button>)}</div></div>{!session && <p>Sign in as a customer to hold seats.</p>}{held.length > 0 && <div className="hold-list"><h3>Your held seats</h3>{held.map(seat => <div key={seat.id} className="held-row"><span>Row {seat.row}, seat {seat.number} <small>Held until {new Date(seat.holdUntil).toLocaleTimeString()}</small></span><button disabled={busy} onClick={() => seatAction(seat, 'book')}>Confirm booking</button></div>)}</div>}</section>}</div></div></main><footer className="wrap">SeatLock <span>Simple booking. Seats you can count on.</span></footer></>;
}

createRoot(document.getElementById('root')).render(<App />);
