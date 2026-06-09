const http = require("http");
const fs = require("fs");
const path = require("path");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const CF_BASE = "https://codeforces.com/api";
const analysisCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}

async function cfRequest(method, params) {
  const url = new URL(`${CF_BASE}/${method}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "CF-Pulse/1.0 profile analytics dashboard" },
        signal: AbortSignal.timeout(25000)
      });
      if (!response.ok) throw new Error(`Codeforces returned HTTP ${response.status}`);
      const data = await response.json();
      if (data.status !== "OK") throw new Error(data.comment || "Codeforces API request failed");
      return data.result;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  throw lastError;
}

async function analyzeHandle(handle) {
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(handle)) {
    throw new Error("Enter a valid Codeforces handle.");
  }
  const cacheKey = handle.toLowerCase();
  const cached = analysisCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 5 * 60 * 1000) return cached.data;
  const [users, ratings, submissions] = await Promise.all([
    cfRequest("user.info", { handles: handle, checkHistoricHandles: "false" }),
    cfRequest("user.rating", { handle }),
    cfRequest("user.status", { handle, from: "1", count: "10000" })
  ]);
  const data = { user: users[0], ratings, submissions };
  analysisCache.set(cacheKey, { createdAt: Date.now(), data });
  return data;
}

function buildInsightPrompt(snapshot) {
  return [
    "You are a precise competitive programming coach. Analyze this Codeforces profile summary.",
    "Return valid JSON only with this schema:",
    '{"headline":"short assessment","summary":"2 concise sentences","strengths":["3 items"],"focusAreas":["3 items"],"nextSteps":["3 specific actions"],"estimatedLevel":"short phrase"}',
    "Never invent facts. Base every claim on the supplied metrics. Keep each list item under 18 words.",
    JSON.stringify(snapshot)
  ].join("\n");
}

async function getGeminiInsights(snapshot) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildInsightPrompt(snapshot) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.35
        }
      }),
      signal: AbortSignal.timeout(30000)
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Gemini request failed");
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned an empty response");
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
}

async function handleApi(req, res, pathname) {
  try {
    if (pathname === "/api/analyze" && req.method === "GET") {
      const handle = new URL(req.url, `http://${req.headers.host}`).searchParams.get("handle")?.trim();
      if (!handle) return sendJson(res, 400, { error: "A handle is required." });
      return sendJson(res, 200, await analyzeHandle(handle));
    }
    if (pathname === "/api/insights" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.snapshot) return sendJson(res, 400, { error: "A profile snapshot is required." });
      const insights = await getGeminiInsights(body.snapshot);
      return sendJson(res, 200, {
        insights,
        source: insights ? "gemini" : "local"
      });
    }
    return sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    const status = /not found/i.test(error.message) ? 404 : 502;
    return sendJson(res, status, { error: error.message });
  }
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
  serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(`CF Pulse is running at http://localhost:${PORT}`);
});
