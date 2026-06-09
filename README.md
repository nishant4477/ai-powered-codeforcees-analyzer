# CF Pulse

A zero-dependency Codeforces profile analyzer with:

- Profile and rating history analytics
- Topic, verdict, language, and difficulty breakdowns
- Activity heatmap and consistency metrics
- Gemini-generated coaching insights
- Self-contained downloadable HTML reports
- Local recent-search history

## Run

1. Copy `.env.example` to `.env` and add a Gemini API key from Google AI Studio.
2. Start the app:

```powershell
npm start
```

3. Open `http://localhost:3000`.

The Gemini key is optional. Without it, CF Pulse uses its built-in deterministic coaching engine.
