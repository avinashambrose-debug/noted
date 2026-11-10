import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PARSER_TOOL = {
  name: 'extract_reminders',
  description: 'Extract one or more reminder items from a user note',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct reminder in the note',
        items: {
          type: 'object',
          properties: {
            original: {
              type: 'string',
              description: "The user's exact text for this single item, verbatim",
            },
            action: {
              type: ['string', 'null'],
              description: 'Short verb for the action (call, email, meet, follow up, pay, send, review, remind, etc.) or null',
            },
            person: {
              type: ['string', 'null'],
              description: 'Named person mentioned, or null',
            },
            when: {
              type: ['string', 'null'],
              description: 'ISO 8601 datetime WITH the user\'s timezone offset (e.g. 2026-11-10T15:30:00+05:30), or null if no date/time was mentioned',
            },
            dateOnly: {
              type: 'boolean',
              description: 'true if a date was given but no time of day',
            },
            recurrence: {
              type: ['string', 'null'],
              description: 'Daily | Weekly | Monthly | Month-end | Every <Weekday> | null',
            },
          },
          required: ['original', 'action', 'person', 'when', 'dateOnly', 'recurrence'],
        },
      },
    },
    required: ['items'],
  },
};

function buildSystemPrompt(now, timezone) {
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone,
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone,
  });
  return `You parse user notes for a personal reminders app. Users write informal, often sloppy notes with action items, dates, times, and people. Extract structured data for each distinct item.

Current date/time: ${dateStr} at ${timeStr} (${timezone}).

Rules:
1. SPLIT multi-item notes on periods, semicolons, newlines, "also", "and then". Each distinct action = separate item.
2. DATES: understand "today", "tonight", "tomorrow" ("tmrw"), day names ("Monday"), "next <day>", relative ("in 2 hours"), numeric ("10 nov", "nov 10", "10/11", "10-11-2026"), fuzzy ("end of month", "EOD", "month-end", "weekend").
3. TIMES: understand "3:30", "3pm", "15:00", "noon", "midnight", "morning" (default 9am), "afternoon" (2pm), "evening" (6pm). Handle typos like "4oopm" → 4pm.
4. For bare times like "3:30" without am/pm: if the hour is 1-6, assume PM (business context); if 7-12, assume AM.
5. If a time has already passed today and user said "today", keep today. If user said just a time with no day, roll to tomorrow if it's past.
6. Handle typos leniently (thrusday=Thursday, tmrw=tomorrow, mon=Monday, nov=November).
7. PERSON: extract names after "with/to/from/@" or after action verbs ("call Prasad", "email Yogendra Pathak"). Preserve full names; skip pronouns (me, you, us).
8. RECURRENCE values: Daily, Weekly, Monthly, Month-end, "Every Monday"/"Every Tuesday"/etc. Null if one-off.
9. "when" MUST be ISO 8601 WITH the user's timezone offset (e.g. "2026-11-10T15:30:00+05:30" for IST). Never return a bare UTC Z unless that's genuinely what the user meant.
10. If a date is given but no time of day, set the time to 00:00:00 in the correct offset AND set dateOnly=true.
11. If no date OR time can be inferred at all, when=null, dateOnly=false.
12. "original" is the user's exact wording for this item (strip only leading separators like "also "). Do not paraphrase or clean up.

Call the extract_reminders tool with your structured answer. No prose response.`;
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'Parser not configured: ANTHROPIC_API_KEY env var is missing.' },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { text, timezone } = body || {};
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return Response.json({ error: 'Missing or empty "text" field' }, { status: 400 });
  }
  if (text.length > 4000) {
    return Response.json({ error: 'Note too long (max 4000 characters)' }, { status: 400 });
  }

  const tz = (typeof timezone === 'string' && timezone) ? timezone : 'UTC';
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const now = new Date();

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 2048,
      system: buildSystemPrompt(now, tz),
      tools: [PARSER_TOOL],
      tool_choice: { type: 'tool', name: 'extract_reminders' },
      messages: [{ role: 'user', content: text }],
    });

    const toolUse = (message.content || []).find((b) => b.type === 'tool_use');
    if (!toolUse || !toolUse.input || !Array.isArray(toolUse.input.items)) {
      return Response.json(
        { error: 'Parser returned no structured items' },
        { status: 502 }
      );
    }

    // Light validation and shape coercion
    const items = toolUse.input.items.map((it) => ({
      original: String(it.original || '').trim(),
      action: it.action || null,
      person: it.person || null,
      when: it.when || null,
      dateOnly: !!it.dateOnly,
      recurrence: it.recurrence || null,
    })).filter((it) => it.original.length > 0);

    return Response.json({ items });
  } catch (err) {
    console.error('Parse API error:', err);
    const status = err?.status || 500;
    let msg = err?.message || 'Parser error';
    if (status === 401) msg = 'Invalid Anthropic API key. Check ANTHROPIC_API_KEY in Vercel.';
    if (status === 429) msg = 'Anthropic rate limit or quota exceeded. Check credits in console.';
    return Response.json({ error: msg }, { status });
  }
}
