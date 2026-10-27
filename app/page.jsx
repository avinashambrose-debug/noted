'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/* -------------------------------------------------------------------------- */
/* Parser — same regex rules as the artifact version                           */
/* -------------------------------------------------------------------------- */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseNote(raw) {
  const text = raw.trim();
  const result = { original: text, action: null, person: null, when: null, recurrence: null };

  const actionMatch = text.match(
    /\b(call|email|mail|message|text|ping|whatsapp|meet|meeting|follow[-\s]?up|remind|send|share|submit|pay|file|review|check|book|schedule|standup)\b/i
  );
  if (actionMatch) result.action = actionMatch[0].toLowerCase().replace(/\s+/g, ' ');

  let hour = null;
  let minute = 0;
  const timeMatch = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const period = timeMatch[3].toLowerCase();
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
  }

  const now = new Date();
  let date = null;
  let hasPreciseTime = false;

  if (/\btoday\b/i.test(text)) {
    date = new Date(now);
  } else if (/\btonight\b/i.test(text)) {
    date = new Date(now);
    if (hour === null) { hour = 20; minute = 0; }
  } else if (/\btomorrow\b|\btmrw\b/i.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
  } else if (/\bday\s+after\s+tomorrow\b/i.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + 2);
  } else {
    const wkRe = new RegExp('\\b(next\\s+)?(' + WEEKDAYS.join('|') + ')\\b', 'i');
    const wm = text.match(wkRe);
    if (wm) {
      const target = WEEKDAYS.indexOf(wm[2].toLowerCase());
      const current = now.getDay();
      let delta = target - current;
      if (delta <= 0) delta += 7;
      if (wm[1]) delta += 7;
      date = new Date(now);
      date.setDate(date.getDate() + delta);
    } else {
      const inM = text.match(/\bin\s+(\d+)\s+(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)\b/i);
      if (inM) {
        const amt = parseInt(inM[1], 10);
        const unit = inM[2].toLowerCase();
        date = new Date(now);
        if (unit.startsWith('min')) { date.setMinutes(date.getMinutes() + amt); hasPreciseTime = true; }
        else if (unit.startsWith('hr') || unit.startsWith('hour')) { date.setHours(date.getHours() + amt); hasPreciseTime = true; }
        else if (unit.startsWith('day')) date.setDate(date.getDate() + amt);
        else if (unit.startsWith('week')) date.setDate(date.getDate() + 7 * amt);
      }
    }
  }

  if (date) {
    if (hour !== null) {
      date.setHours(hour, minute, 0, 0);
    } else if (hasPreciseTime) {
      // 'in 2 hours' etc. already set a real time
    } else {
      // Date-only match ('friday', 'tomorrow') — mark as all-day instead of lying with 9am
      date.setHours(0, 0, 0, 0);
      result.dateOnly = true;
    }
    result.when = date;
  } else if (hour !== null) {
    date = new Date(now);
    date.setHours(hour, minute, 0, 0);
    if (date <= now) date.setDate(date.getDate() + 1);
    result.when = date;
  }

  if (/\bevery\s+day\b|\bdaily\b/i.test(text)) result.recurrence = 'Daily';
  else if (/\bevery\s+week\b|\bweekly\b/i.test(text)) result.recurrence = 'Weekly';
  else if (/\bevery\s+month\b|\bmonthly\b/i.test(text)) result.recurrence = 'Monthly';
  else {
    const em = text.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (em) {
      const d = em[1].toLowerCase();
      result.recurrence = 'Every ' + d[0].toUpperCase() + d.slice(1);
    } else if (/\bmonth[\s-]*end\b|\bend\s+of\s+(the\s+)?month\b|\blast\s+day\s+of\s+(the\s+)?month\b/i.test(text)) {
      result.recurrence = 'Month-end';
    }
  }

  const withRe = /\b(?:[Ww]ith|[Tt]o|[Ff]rom|@)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/;
  const wm2 = text.match(withRe);
  if (wm2) {
    result.person = wm2[1];
  } else {
    const apRe = /\b(?:[Cc]all|[Ee]mail|[Mm]essage|[Tt]ext|[Pp]ing|[Ww]hatsapp|[Mm]eet|[Rr]emind)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/;
    const apm = text.match(apRe);
    if (apm) result.person = apm[1];
  }
  if (result.person && /^(Me|Myself|Us|Them|Him|Her|It|You|Everyone|Someone|Anyone)$/i.test(result.person.split(/\s+/)[0])) {
    result.person = null;
  }

  return result;
}

function splitNote(text) {
  return text
    .split(/\n+|\s*;\s*|(?<=[.!?])\s+(?=[A-Z])|\s+also\s+/i)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function formatWhen(d, dateOnly) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target - today) / 86400000);

  let dayFmt;
  if (diffDays === 0) dayFmt = 'Today';
  else if (diffDays === 1) dayFmt = 'Tomorrow';
  else if (diffDays === -1) dayFmt = 'Yesterday';
  else if (diffDays > 1 && diffDays < 7) dayFmt = date.toLocaleDateString('en-US', { weekday: 'long' });
  else dayFmt = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  if (dateOnly) return dayFmt + ' (no time)';

  const timeFmt = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
  return dayFmt + ', ' + timeFmt;
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'noted_reminders_v1';
const THEME_KEY = 'noted_theme';

// Seed data removed — users were confusing examples with real reminders.
// The "What the parser understands" section at the bottom carries example input,
// which is the better place for them (it's labelled as a learning aid, not state).

const EXAMPLES = [
  { text: 'Call the vendor tomorrow 10am about the invoice', trigger: 'tomorrow 10am', pre: 'Call the vendor ', post: ' about the invoice' },
  { text: 'Email the team Friday 2pm with the agenda', trigger: 'Friday 2pm', pre: 'Email the team ', post: ' with the agenda' },
  { text: 'Send bank statement every month-end to accounts', trigger: 'every month-end', pre: 'Send bank statement ', post: ' to accounts' },
  { text: 'Review attendance log in 2 hours', trigger: 'in 2 hours', pre: 'Review attendance log ', post: '' },
  { text: 'Follow up on payment next Monday 11am', trigger: 'next Monday 11am', pre: 'Follow up on payment ', post: '' },
  { text: 'Daily standup at 9:30am', trigger: 'at 9:30am', pre: 'Daily standup ', post: '' },
];

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

// --- Grouping ---
function groupReminders(list) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 86400000;
  const weekEnd = todayStart + 7 * 86400000;

  const groups = {
    overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], noDate: [], done: [],
  };

  for (const r of list) {
    if (r.status === 'done') { groups.done.push(r); continue; }
    if (!r.when) { groups.noDate.push(r); continue; }
    const whenDate = new Date(r.when);
    const dayStart = new Date(whenDate.getFullYear(), whenDate.getMonth(), whenDate.getDate()).getTime();
    // "Overdue" means a prior day. Today-earlier still shows in Today with a stale flag.
    if (dayStart < todayStart) { groups.overdue.push(r); continue; }
    if (dayStart === todayStart) { groups.today.push(r); continue; }
    if (dayStart === tomorrowStart) { groups.tomorrow.push(r); continue; }
    if (dayStart < weekEnd) { groups.thisWeek.push(r); continue; }
    groups.later.push(r);
  }

  const sortByWhen = (a, b) => {
    if (!a.when && !b.when) return (a.createdAt || '').localeCompare(b.createdAt || '');
    if (!a.when) return 1;
    if (!b.when) return -1;
    return new Date(a.when) - new Date(b.when);
  };
  Object.keys(groups).forEach(k => groups[k].sort(sortByWhen));
  // Done list reads nicest in reverse chronological order
  groups.done.reverse();
  return groups;
}

// --- Week-view helpers ---
const WEEK_START_HOUR = 7;   // first hour row shown
const WEEK_END_HOUR = 22;    // last hour row shown (exclusive upper bound = row for 10pm)

function startOfWeek(date) {
  // Sunday-start week
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function weekDays(sunday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    days.push(d);
  }
  return days;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatTimeShort(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'p' : 'a';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + period;
}

function formatHourLabel(h) {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return h + ' AM';
  return (h - 12) + ' PM';
}

export default function Home() {
  const [noteInput, setNoteInput] = useState('');
  const [reminders, setReminders] = useState([]);
  const [mounted, setMounted] = useState(false);
  const [themeLabel, setThemeLabel] = useState('Theme');
  const [modKey, setModKey] = useState('Ctrl');
  const [justAddedIds, setJustAddedIds] = useState([]);
  const [showDone, setShowDone] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [selectedDay, setSelectedDay] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const [nowTick, setNowTick] = useState(() => new Date());
  const [drag, setDrag] = useState(null); // {id, startY, originalMin, currentMin, moved}
  const textareaRef = useRef(null);
  const dayBodyRef = useRef(null);

  // Load on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Strip out any leftover example seeds from older versions
          const cleaned = parsed.filter(r => !r.isExample);
          setReminders(cleaned);
          if (cleaned.length !== parsed.length) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
          }
        }
      }
      const t = localStorage.getItem(THEME_KEY);
      if (t === 'dark' || t === 'light') {
        document.documentElement.setAttribute('data-theme', t);
      }
    } catch (e) {}

    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '') || /Mac/.test(navigator.userAgent || '');
    setModKey(isMac ? '⌘' : 'Ctrl');
    updateThemeLabel();

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => updateThemeLabel();
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);

    setMounted(true);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  // Persist reminders
  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders)); } catch (e) {}
  }, [reminders, mounted]);

  // Tick the "now" indicator in calendar view every minute
  useEffect(() => {
    if (viewMode !== 'calendar') return;
    const id = setInterval(() => setNowTick(new Date()), 60000);
    return () => clearInterval(id);
  }, [viewMode]);

  const updateThemeLabel = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = current || (prefersDark ? 'dark' : 'light');
    setThemeLabel(effective === 'dark' ? '☀ Light' : '☾ Dark');
  };

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = current || (prefersDark ? 'dark' : 'light');
    const next = effective === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    updateThemeLabel();
  };

  const pad = (n) => String(n).padStart(2, '0');

  const capture = useCallback(() => {
    const text = noteInput.trim();
    if (!text) return;
    const items = splitNote(text);
    const newReminders = items.map((item, idx) => {
      const p = parseNote(item);
      const d = p.when;
      return {
        id: 'r-' + Date.now() + '-' + idx + '-' + Math.random().toString(36).slice(2, 5),
        original: p.original,
        action: p.action,
        person: p.person,
        when: d ? d.toISOString() : null,
        dateInput: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '',
        timeInput: (d && !p.dateOnly) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '',
        dateOnly: !!p.dateOnly,
        recurrence: p.recurrence,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
    });
    setReminders(prev => [...prev, ...newReminders]);
    setJustAddedIds(newReminders.map(r => r.id));
    setNoteInput('');
    // Fade the "just saved" highlight after a moment
    setTimeout(() => setJustAddedIds([]), 2500);
  }, [noteInput]);

  const updateReminder = (id, field, value) => {
    setReminders(prev => prev.map(r => {
      if (r.id !== id) return r;
      const next = { ...r, [field]: value };
      // Rebuild `when` + `dateOnly` whenever date or time changes
      if (field === 'dateInput' || field === 'timeInput') {
        if (next.dateInput) {
          const [y, m, d] = next.dateInput.split('-').map(Number);
          if (next.timeInput) {
            const [hh, mm] = next.timeInput.split(':').map(Number);
            next.when = new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
            next.dateOnly = false;
          } else {
            next.when = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
            next.dateOnly = true;
          }
        } else {
          next.when = null;
          next.dateOnly = false;
        }
      }
      return next;
    }));
  };

  const toggleReminder = (id) => {
    setReminders(prev => prev.map(r =>
      r.id === id ? { ...r, status: r.status === 'done' ? 'pending' : 'done' } : r
    ));
  };

  const deleteReminder = (id) => {
    setReminders(prev => prev.filter(r => r.id !== id));
  };

  const handleKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      capture();
    }
  };

  const useExample = (text) => {
    setNoteInput(text);
    textareaRef.current?.focus();
  };

  // Grouped reminders
  const groups = groupReminders(reminders);
  const pendingSections = [
    { key: 'overdue', label: 'Overdue', items: groups.overdue, tone: 'warning' },
    { key: 'today', label: 'Today', items: groups.today, tone: 'accent' },
    { key: 'tomorrow', label: 'Tomorrow', items: groups.tomorrow },
    { key: 'thisWeek', label: 'This week', items: groups.thisWeek },
    { key: 'later', label: 'Later', items: groups.later },
    { key: 'noDate', label: 'No date', items: groups.noDate },
  ];

  const jumpToReminder = (id) => {
    setViewMode('list');
    setTimeout(() => {
      const el = document.getElementById('reminder-' + id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setJustAddedIds([id]);
        setTimeout(() => setJustAddedIds([]), 2500);
      }
    }, 50);
  };

  // --- Drag-to-reschedule in day view ---

  const onEventPointerDown = (e, r) => {
    if (r.status === 'done') { jumpToReminder(r.id); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const dt = new Date(r.when);
    const originalMin = dt.getHours() * 60 + dt.getMinutes();
    setDrag({ id: r.id, startY: e.clientY, originalMin, currentMin: originalMin, moved: false });
    // Capture so pointermove outside the element still fires
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  };

  const onEventPointerMove = (e) => {
    if (!drag) return;
    const body = dayBodyRef.current;
    if (!body) return;
    const bodyRect = body.getBoundingClientRect();
    const totalMin = (WEEK_END_HOUR - WEEK_START_HOUR) * 60;
    const deltaPx = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaPx) < 6) return;
    const deltaMin = (deltaPx / bodyRect.height) * totalMin;
    let newMin = drag.originalMin + deltaMin;
    newMin = Math.round(newMin / 15) * 15; // snap to 15-min
    newMin = Math.max(WEEK_START_HOUR * 60, Math.min(WEEK_END_HOUR * 60, newMin));
    setDrag(prev => prev ? { ...prev, currentMin: newMin, moved: true } : prev);
  };

  const onEventPointerUp = (e) => {
    if (!drag) return;
    if (drag.moved) {
      const h = Math.floor(drag.currentMin / 60);
      const m = drag.currentMin % 60;
      const pad2 = (n) => String(n).padStart(2, '0');
      updateReminder(drag.id, 'timeInput', pad2(h) + ':' + pad2(m));
    } else {
      jumpToReminder(drag.id);
    }
    setDrag(null);
  };

  const onEventPointerCancel = () => setDrag(null);

  const prevDay = () => {
    setSelectedDay(d => {
      const n = new Date(d);
      n.setDate(n.getDate() - 1);
      return n;
    });
  };
  const nextDay = () => {
    setSelectedDay(d => {
      const n = new Date(d);
      n.setDate(n.getDate() + 1);
      return n;
    });
  };
  const prevWeek = () => {
    setSelectedDay(d => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  };
  const nextWeek = () => {
    setSelectedDay(d => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
  };
  const jumpToToday = () => {
    const d = new Date();
    setSelectedDay(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  };

  const renderCalendar = () => {
    const now = nowTick;
    const sel = selectedDay;
    const isSelToday = sameDay(sel, now);

    // Compressed date strip: the Sunday-start week containing selectedDay
    const stripStart = startOfWeek(sel);
    const stripDays = weekDays(stripStart);

    // Events for the selected day
    const dayItems = reminders
      .filter(r => r.when && sameDay(new Date(r.when), sel))
      .sort((a, b) => new Date(a.when) - new Date(b.when));
    const allDayItems = dayItems.filter(r => r.dateOnly);
    const timedItems = dayItems.filter(r => !r.dateOnly);

    const noDateCount = reminders.filter(r => !r.when && r.status !== 'done').length;

    const hourList = [];
    for (let h = WEEK_START_HOUR; h <= WEEK_END_HOUR; h++) hourList.push(h);
    const bodyStartMin = WEEK_START_HOUR * 60;
    const bodyEndMin = WEEK_END_HOUR * 60;
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    const nowInRange = isSelToday && nowMinutes >= bodyStartMin && nowMinutes <= bodyEndMin;
    const nowPct = nowInRange ? ((nowMinutes - bodyStartMin) / (bodyEndMin - bodyStartMin)) * 100 : 0;

    const monthLabel = sel.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return (
      <div className="dayv">
        <div className="dayv-nav">
          <h3 className="dayv-month">{monthLabel}</h3>
          <button className="btn-ghost today-btn" onClick={jumpToToday}>Today</button>
        </div>

        <div className="dayv-strip-wrap">
          <button className="icon-btn" onClick={prevWeek} aria-label="Previous week" title="Previous week">‹</button>
          <div className="dayv-strip">
            <div className="dayv-strip-row dayv-strip-labels">
              {['S','M','T','W','T','F','S'].map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
            <div className="dayv-strip-row dayv-strip-days">
              {stripDays.map((d, i) => {
                const isToday = sameDay(d, now);
                const isSel = sameDay(d, sel);
                return (
                  <button
                    key={i}
                    type="button"
                    className={
                      'dayv-strip-day'
                      + (isSel ? ' is-sel' : '')
                      + (isToday ? ' is-today' : '')
                    }
                    onClick={() => setSelectedDay(d)}
                    aria-label={d.toDateString()}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
          <button className="icon-btn" onClick={nextWeek} aria-label="Next week" title="Next week">›</button>
        </div>

        <div className="dayv-dayrow">
          <button className="icon-btn dayv-arrow" onClick={prevDay} aria-label="Previous day" title="Previous day">‹</button>
          <div className="dayv-dayhead">
            <span className={'dayv-dayhead-num' + (isSelToday ? ' is-today' : '')}>{sel.getDate()}</span>
            <span className="dayv-dayhead-name">{sel.toLocaleDateString('en-US', { weekday: 'long' })}</span>
          </div>
          <button className="icon-btn dayv-arrow" onClick={nextDay} aria-label="Next day" title="Next day">›</button>
        </div>

        {noDateCount > 0 && (
          <p className="calendar-note">
            {noDateCount} reminder{noDateCount === 1 ? '' : 's'} with no date — switch to List to see {noDateCount === 1 ? 'it' : 'them'}.
          </p>
        )}

        <div className="dayv-allday">
          <div className="dayv-allday-label">All day</div>
          <div className="dayv-allday-items">
            {allDayItems.length === 0 ? (
              <span className="dayv-empty">—</span>
            ) : allDayItems.map(r => (
              <button
                key={r.id}
                type="button"
                className={'dayv-event dayv-event-allday' + (r.status === 'done' ? ' is-done' : '')}
                onClick={() => jumpToReminder(r.id)}
                title={r.original}
              >
                <span className="dayv-event-text">{r.original}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="dayv-grid" style={{ ['--hours']: hourList.length }}>
          <div className="dayv-hours">
            {hourList.map(h => (
              <div key={h} className="dayv-hour-row">
                <span className="dayv-hour-label">{formatHourLabel(h)}</span>
              </div>
            ))}
          </div>
          <div className="dayv-body" ref={dayBodyRef}>
            {hourList.map((h, idx) => (
              <div
                key={'ln' + h}
                className="dayv-hourline"
                style={{ top: (idx / hourList.length) * 100 + '%' }}
              />
            ))}
            {nowInRange && (
              <div className="dayv-nowline" style={{ top: nowPct + '%' }}>
                <span className="dayv-nowdot" />
                <span className="dayv-nowlabel">{formatTimeShort(now)}</span>
              </div>
            )}
            {timedItems.map(r => {
              const dt = new Date(r.when);
              const originalMinutes = dt.getHours() * 60 + dt.getMinutes();
              const isDragging = drag && drag.id === r.id && drag.moved;
              const minutes = isDragging ? drag.currentMin : originalMinutes;
              const outOfRange = minutes < bodyStartMin || minutes > bodyEndMin;
              if (outOfRange && !isDragging) return null;
              const topPct = ((minutes - bodyStartMin) / (bodyEndMin - bodyStartMin)) * 100;
              const dragH = Math.floor(minutes / 60);
              const dragM = minutes % 60;
              const dragTimeLabel = isDragging ? formatTimeShort(new Date(2000, 0, 1, dragH, dragM)) : null;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={'dayv-event' + (r.status === 'done' ? ' is-done' : '') + (isDragging ? ' is-dragging' : '')}
                  style={{ top: topPct + '%' }}
                  onPointerDown={(e) => onEventPointerDown(e, r)}
                  onPointerMove={onEventPointerMove}
                  onPointerUp={onEventPointerUp}
                  onPointerCancel={onEventPointerCancel}
                  title={r.original + ' (drag to reschedule, tap to open in list)'}
                >
                  <span className="dayv-event-time">{dragTimeLabel || formatTimeShort(dt)}</span>
                  <span className="dayv-event-text">{r.original}</span>
                </button>
              );
            })}
            {/* Note out-of-range events (early morning / late night) */}
            {timedItems.some(r => {
              const dt = new Date(r.when);
              const m = dt.getHours() * 60 + dt.getMinutes();
              return m < bodyStartMin || m > bodyEndMin;
            }) && (
              <div className="dayv-outofrange">
                Some reminders fall outside {formatHourLabel(WEEK_START_HOUR)}–{formatHourLabel(WEEK_END_HOUR)} — switch to List to see them.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderReminderRow = (r) => {
    const justAdded = justAddedIds.includes(r.id);
    return (
      <div
        id={'reminder-' + r.id}
        className={'reminder' + (r.status === 'done' ? ' done' : '') + (justAdded ? ' just-added' : '')}
        key={r.id}
      >
        <div className="reminder-body">
          <input
            className="reminder-text-input"
            type="text"
            value={r.original}
            onChange={(e) => updateReminder(r.id, 'original', e.target.value)}
            disabled={r.status === 'done'}
            aria-label="Reminder text"
          />
          <div className="reminder-fields">
            <input
              type="date"
              value={r.dateInput || ''}
              onChange={(e) => updateReminder(r.id, 'dateInput', e.target.value)}
              aria-label="Date"
              disabled={r.status === 'done'}
            />
            <input
              type="time"
              value={r.timeInput || ''}
              onChange={(e) => updateReminder(r.id, 'timeInput', e.target.value)}
              aria-label="Time"
              disabled={r.status === 'done'}
            />
            {r.recurrence && <span className="chip chip-recur">↻ {r.recurrence}</span>}
            {r.person && <span className="chip chip-person">@{r.person}</span>}
          </div>
        </div>
        <div className="reminder-actions">
          <button
            className="icon-btn"
            onClick={() => toggleReminder(r.id)}
            aria-label={r.status === 'done' ? 'Mark pending' : 'Mark done'}
            title={r.status === 'done' ? 'Mark pending' : 'Mark done'}
          >
            {r.status === 'done' ? '↺' : '✓'}
          </button>
          <button
            className="icon-btn"
            onClick={() => deleteReminder(r.id)}
            aria-label="Delete"
            title="Delete"
          >
            ×
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <h1>Noted</h1>
          <span className="tagline">Jot a line. Get the reminder.</span>
        </div>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          suppressHydrationWarning
        >
          {mounted ? themeLabel : 'Theme'}
        </button>
      </header>

      <section className="composer">
        <div className="composer-field">
          <textarea
            ref={textareaRef}
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="e.g. Call the dentist tomorrow 10am. Send monthly report every month-end."
            aria-label="Write a note"
          />
        </div>
        <div className="composer-footer">
          <div className="hint">
            <span>Press</span>
            <kbd suppressHydrationWarning>{mounted ? modKey : 'Ctrl'}</kbd>
            <kbd>Enter</kbd>
            <span>to capture</span>
          </div>
          <button className="btn-primary" onClick={capture}>Capture</button>
        </div>
      </section>

      <section>
        <div className="section-header">
          <h2>Reminders</h2>
          <div className="section-actions">
            <div className="view-toggle" role="tablist" aria-label="View">
              <button
                role="tab"
                aria-selected={viewMode === 'list'}
                className={'view-toggle-btn' + (viewMode === 'list' ? ' active' : '')}
                onClick={() => setViewMode('list')}
              >List</button>
              <button
                role="tab"
                aria-selected={viewMode === 'calendar'}
                className={'view-toggle-btn' + (viewMode === 'calendar' ? ' active' : '')}
                onClick={() => setViewMode('calendar')}
              >Calendar</button>
            </div>
            <span className="count">{mounted ? reminders.length : 0}</span>
            {mounted && viewMode === 'list' && groups.done.length > 0 && (
              <button className="btn-link" onClick={() => setShowDone(v => !v)}>
                {showDone ? 'Hide completed' : `Show ${groups.done.length} completed`}
              </button>
            )}
          </div>
        </div>
        <div>
          {!mounted ? (
            <div className="empty">Loading…</div>
          ) : reminders.length === 0 ? (
            <div className="empty">Nothing saved yet. Jot a note above and press Capture.</div>
          ) : viewMode === 'calendar' ? (
            renderCalendar()
          ) : (
            <div className="reminder-groups">
              {pendingSections.map(s => s.items.length > 0 && (
                <div className={'reminder-group tone-' + (s.tone || 'neutral')} key={s.key}>
                  <h3 className="group-label">
                    <span>{s.label}</span>
                    <span className="group-count">{s.items.length}</span>
                  </h3>
                  <div className="reminders">
                    {s.items.map(r => renderReminderRow(r))}
                  </div>
                </div>
              ))}
              {showDone && groups.done.length > 0 && (
                <div className="reminder-group tone-neutral" key="done">
                  <h3 className="group-label">
                    <span>Completed</span>
                    <span className="group-count">{groups.done.length}</span>
                  </h3>
                  <div className="reminders">
                    {groups.done.map(r => renderReminderRow(r))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="examples">
        <h3>What the parser understands</h3>
        <p className="examples-sub">Tap one to drop it into the composer. The parser scans for action verbs, time words, people (capitalized names), and recurring patterns.</p>
        <div className="example-grid">
          {EXAMPLES.map((ex, i) => (
            <button key={i} className="example-item" onClick={() => useExample(ex.text)}>
              {ex.pre}<span className="trigger">{ex.trigger}</span>{ex.post}
            </button>
          ))}
        </div>
      </section>

      <p className="parser-note">v0.1 · regex parser · reminders live in this browser only</p>
    </div>
  );
}
