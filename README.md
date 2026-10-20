# Noted

A notes-to-reminders web app. Type a note, it extracts the time, person and recurrence, you confirm, and it's saved.

## Deployment status

- **Session 1** (current): regex parser, browser-only storage, deployed on Vercel.
- Session 2 (next): Supabase storage + Anthropic AI parser.
- Session 3 (after that): email dispatch + installable PWA.

## Local development

Not required — Vercel builds and deploys automatically. If you ever want to run it on your laptop:

```bash
npm install
npm run dev
```

Then open http://localhost:3000.
