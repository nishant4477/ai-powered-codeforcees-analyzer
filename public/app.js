const $ = (selector) => document.querySelector(selector);
const state = { raw: null, analytics: null, insights: null };

const verdictLabels = {
  OK: "Accepted",
  WRONG_ANSWER: "Wrong answer",
  TIME_LIMIT_EXCEEDED: "Time limit",
  MEMORY_LIMIT_EXCEEDED: "Memory limit",
  RUNTIME_ERROR: "Runtime error",
  COMPILATION_ERROR: "Compilation"
};

const verdictColors = {
  OK: "#cbff3f",
  WRONG_ANSWER: "#ff5f6d",
  TIME_LIMIT_EXCEEDED: "#ff8956",
  MEMORY_LIMIT_EXCEEDED: "#9c78ff",
  RUNTIME_ERROR: "#62d9dd",
  COMPILATION_ERROR: "#68706c",
  OTHER: "#343937"
};

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    if (key) counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function uniqueSolved(submissions) {
  const solved = new Map();
  submissions.filter((s) => s.verdict === "OK").forEach((s) => {
    const key = `${s.problem.contestId || "x"}-${s.problem.index}`;
    if (!solved.has(key)) solved.set(key, s);
  });
  return [...solved.values()];
}

function calculateStreak(activityDays) {
  const days = new Set(activityDays);
  let streak = 0;
  const date = new Date();
  const today = date.toISOString().slice(0, 10);
  if (!days.has(today)) date.setUTCDate(date.getUTCDate() - 1);
  while (days.has(date.toISOString().slice(0, 10))) {
    streak += 1;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return streak;
}

function analyze(raw) {
  const { user, ratings, submissions } = raw;
  const solved = uniqueSolved(submissions);
  const attemptedKeys = new Set(submissions.map((s) => `${s.problem.contestId || "x"}-${s.problem.index}`));
  const verdicts = countBy(submissions, (s) => s.verdict || "OTHER");
  const languages = countBy(submissions, (s) => s.programmingLanguage);
  const ratingsSolved = solved.filter((s) => s.problem.rating);
  const difficulty = countBy(ratingsSolved, (s) => s.problem.rating);
  const activity = countBy(submissions, (s) => new Date(s.creationTimeSeconds * 1000).toISOString().slice(0, 10));

  const topicMap = {};
  submissions.forEach((s) => {
    const key = `${s.problem.contestId || "x"}-${s.problem.index}`;
    (s.problem.tags || []).forEach((tag) => {
      topicMap[tag] ||= { attempted: new Set(), solved: new Set() };
      topicMap[tag].attempted.add(key);
      if (s.verdict === "OK") topicMap[tag].solved.add(key);
    });
  });
  const topics = Object.entries(topicMap).map(([name, value]) => ({
    name,
    attempted: value.attempted.size,
    solved: value.solved.size,
    rate: value.attempted.size ? value.solved.size / value.attempted.size : 0
  })).filter((item) => item.attempted >= 2).sort((a, b) => b.solved - a.solved || b.rate - a.rate);

  const ratingValues = ratings.map((r) => r.newRating);
  const averageSolvedRating = ratingsSolved.length
    ? Math.round(ratingsSolved.reduce((sum, s) => sum + s.problem.rating, 0) / ratingsSolved.length)
    : 0;
  const activeDays = Object.keys(activity).length;
  const accepted = verdicts.OK || 0;

  return {
    user,
    ratings,
    submissions,
    solved,
    attempted: attemptedKeys.size,
    verdicts,
    languages,
    difficulty,
    activity,
    topics,
    activeDays,
    currentStreak: calculateStreak(Object.keys(activity)),
    acceptanceRate: submissions.length ? accepted / submissions.length : 0,
    averageSolvedRating,
    maxRating: user.maxRating || (ratingValues.length ? Math.max(...ratingValues) : 0),
    ratingDelta: ratings.length > 1 ? ratings.at(-1).newRating - ratings[0].newRating : 0
  };
}

function compactSnapshot(a) {
  return {
    handle: a.user.handle,
    currentRating: a.user.rating || 0,
    maxRating: a.maxRating,
    rank: a.user.rank || "unrated",
    contests: a.ratings.length,
    solvedProblems: a.solved.length,
    attemptedProblems: a.attempted,
    acceptanceRate: Math.round(a.acceptanceRate * 100),
    averageSolvedRating: a.averageSolvedRating,
    activeDays: a.activeDays,
    currentStreak: a.currentStreak,
    strongestTopics: a.topics.slice(0, 6).map((t) => `${t.name}: ${t.solved}/${t.attempted}`),
    mostUsedLanguages: Object.entries(a.languages).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([name, count]) => `${name}: ${count}`),
    recentRatingChanges: a.ratings.slice(-8).map((r) => r.newRating - r.oldRating)
  };
}

function localInsights(a) {
  const strong = a.topics.filter((t) => t.solved >= 3 && t.rate >= .55).slice(0, 3);
  const weak = [...a.topics].filter((t) => t.attempted >= 3).sort((x, y) => x.rate - y.rate).slice(0, 3);
  const momentum = a.ratingDelta >= 0 ? "positive long-term momentum" : "room to rebuild rating momentum";
  return {
    headline: a.user.rating ? `${capitalize(a.user.rank)} with ${momentum}` : "A growing competitive programming profile",
    summary: `${a.user.handle} has solved ${a.solved.length} distinct problems across ${a.activeDays} active days. The strongest signal is ${strong[0]?.name || "continued practice"}, while consistency can unlock the next jump.`,
    strengths: strong.length ? strong.map((t) => `${capitalize(t.name)}: ${t.solved} solved at ${Math.round(t.rate * 100)}% coverage`) : ["A measurable submission history", "Willingness to explore multiple topics", "A foundation ready for structured practice"],
    focusAreas: weak.map((t) => t.name),
    nextSteps: [
      weak[0] ? `Complete a focused ${weak[0].name} ladder this week` : "Build a five-problem weekly topic ladder",
      `Target problems near ${Math.max(800, Math.round(a.averageSolvedRating / 100) * 100 + 100)} rating`,
      "Upsolve two missed contest problems within 48 hours"
    ],
    estimatedLevel: a.user.rank || "developing",
    source: "local"
  };
}

function capitalize(value = "") {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function setLoading(active) {
  $("#loading-panel").classList.toggle("hidden", !active);
  $("#analyze-button").disabled = active;
  $("#analyze-button span:first-child").textContent = active ? "Analyzing..." : "Analyze profile";
}

function showError(message) {
  $("#error-message").textContent = message;
  $("#error-panel").classList.remove("hidden");
  $("#loading-panel").classList.add("hidden");
}

async function runAnalysis(handle) {
  const cleanHandle = handle.trim();
  if (!cleanHandle) return showError("Enter a Codeforces handle to begin.");
  $("#error-panel").classList.add("hidden");
  $("#dashboard").classList.add("hidden");
  setLoading(true);
  $("#loading-title").textContent = `Retrieving @${cleanHandle}`;

  try {
    const response = await fetch(`/api/analyze?handle=${encodeURIComponent(cleanHandle)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not retrieve this profile.");
    state.raw = data;
    state.analytics = analyze(data);
    state.insights = localInsights(state.analytics);
    $("#dashboard").classList.remove("hidden");
    renderDashboard();
    saveRecent(cleanHandle);
    setLoading(false);
    $("#dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
    getAiInsights();
  } catch (error) {
    setLoading(false);
    showError(error.message);
  }
}

async function getAiInsights() {
  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: compactSnapshot(state.analytics) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (data.insights) {
      state.insights = { ...data.insights, source: "gemini" };
      renderInsights();
    }
  } catch (error) {
    console.info("Using local coaching insights:", error.message);
  }
}

function renderDashboard() {
  const a = state.analytics;
  const u = a.user;
  $("#profile-avatar").src = u.titlePhoto?.replace(/^http:/, "https:") || "";
  $("#profile-avatar").alt = `${u.handle}'s avatar`;
  $("#profile-handle").textContent = u.handle;
  $("#profile-handle").style.color = rankColor(u.rank);
  $("#profile-name").textContent = [u.firstName, u.lastName].filter(Boolean).join(" ") || `${capitalize(u.rank || "unrated")} · ${u.country || "Location not listed"}`;
  $("#cf-link").href = `https://codeforces.com/profile/${encodeURIComponent(u.handle)}`;

  const stats = [
    ["Current rating", u.rating || "Unrated", capitalize(u.rank || "No rank")],
    ["Peak rating", a.maxRating || "—", capitalize(u.maxRank || u.rank || "No rank")],
    ["Problems solved", formatNumber(a.solved.length), `${formatNumber(a.attempted)} attempted`],
    ["Contests", formatNumber(a.ratings.length), `${a.ratingDelta >= 0 ? "+" : ""}${a.ratingDelta} all-time delta`],
    ["Active days", formatNumber(a.activeDays), `${a.currentStreak} day current streak`]
  ];
  $("#stat-grid").innerHTML = stats.map((stat, index) => `
    <article class="card stat-card" data-index="0${index + 1}">
      <span>${escapeHtml(stat[0])}</span>
      <strong class="${index === 0 ? "accent" : ""}">${escapeHtml(String(stat[1]))}</strong>
      <small>${escapeHtml(stat[2])}</small>
    </article>`).join("");

  renderRatingChart();
  renderInsights();
  renderTopics();
  renderVerdicts();
  renderHeatmap();
  renderLanguages();
  renderDifficulty();
}

function rankColor(rank = "") {
  const r = rank.toLowerCase();
  if (r.includes("legendary")) return "#ff3838";
  if (r.includes("international")) return "#ff7043";
  if (r.includes("grandmaster")) return "#ff4343";
  if (r.includes("master")) return "#ff8ad8";
  if (r.includes("candidate")) return "#a98cff";
  if (r.includes("expert")) return "#5d8cff";
  if (r.includes("specialist")) return "#49c9cb";
  if (r.includes("pupil")) return "#73d673";
  if (r.includes("newbie")) return "#a0a5a2";
  return "#f4f1ea";
}

function renderRatingChart() {
  const canvas = $("#rating-chart");
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = parent.clientWidth * dpr;
  canvas.height = parent.clientHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = parent.clientWidth;
  const height = parent.clientHeight;
  const data = state.analytics.ratings;
  $("#rating-change").textContent = data.length ? `${data.length} contests tracked` : "No rated contests";
  if (!data.length) {
    ctx.fillStyle = "#777";
    ctx.font = "12px DM Mono";
    ctx.fillText("No rating history available", 20, height / 2);
    return;
  }
  const values = data.map((r) => r.newRating);
  const min = Math.floor((Math.min(...values) - 100) / 100) * 100;
  const max = Math.ceil((Math.max(...values) + 100) / 100) * 100;
  const pad = { top: 18, right: 12, bottom: 24, left: 42 };
  const x = (i) => pad.left + (i / Math.max(1, data.length - 1)) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);

  ctx.font = "9px DM Mono";
  ctx.fillStyle = "#626663";
  ctx.strokeStyle = "rgba(255,255,255,.055)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const value = min + ((max - min) / 4) * i;
    const lineY = y(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, lineY);
    ctx.lineTo(width - pad.right, lineY);
    ctx.stroke();
    ctx.fillText(Math.round(value), 0, lineY + 3);
  }

  const gradient = ctx.createLinearGradient(0, pad.top, 0, height);
  gradient.addColorStop(0, "rgba(203,255,63,.25)");
  gradient.addColorStop(1, "rgba(203,255,63,0)");
  ctx.beginPath();
  data.forEach((r, i) => i ? ctx.lineTo(x(i), y(r.newRating)) : ctx.moveTo(x(i), y(r.newRating)));
  ctx.lineTo(x(data.length - 1), height - pad.bottom);
  ctx.lineTo(x(0), height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  data.forEach((r, i) => i ? ctx.lineTo(x(i), y(r.newRating)) : ctx.moveTo(x(i), y(r.newRating)));
  ctx.strokeStyle = "#cbff3f";
  ctx.lineWidth = 2;
  ctx.stroke();
  const last = data.at(-1);
  ctx.beginPath();
  ctx.arc(x(data.length - 1), y(last.newRating), 4, 0, Math.PI * 2);
  ctx.fillStyle = "#cbff3f";
  ctx.fill();
}

function renderInsights() {
  const insight = state.insights;
  $("#ai-headline").textContent = insight.headline;
  $("#ai-summary").textContent = insight.summary;
  $("#ai-source").textContent = insight.source === "gemini" ? "Gemini" : "Smart coach";
  $("#ai-strengths").innerHTML = (insight.strengths || []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("#ai-next-steps").innerHTML = (insight.nextSteps || []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderTopics() {
  const topics = state.analytics.topics.slice(0, 12);
  const maxSolved = Math.max(1, ...topics.map((t) => t.solved));
  $("#topic-bars").innerHTML = topics.length ? topics.map((t) => `
    <div class="topic-row" title="${escapeHtml(t.name)}">
      <span>${escapeHtml(capitalize(t.name))}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, t.solved / maxSolved * 100)}%"></div></div>
      <small>${t.solved}/${t.attempted}</small>
    </div>`).join("") : '<p class="muted small">Not enough tagged problems yet.</p>';
}

function renderVerdicts() {
  const verdicts = state.analytics.verdicts;
  const total = Math.max(1, Object.values(verdicts).reduce((a, b) => a + b, 0));
  const groups = Object.entries(verdicts).map(([key, count]) => ({
    key: verdictLabels[key] ? key : "OTHER",
    label: verdictLabels[key] || "Other",
    count
  })).reduce((result, item) => {
    const existing = result.find((x) => x.key === item.key);
    if (existing) existing.count += item.count;
    else result.push(item);
    return result;
  }, []).sort((a, b) => b.count - a.count);
  let cursor = 0;
  const segments = groups.map((group) => {
    const start = cursor;
    cursor += group.count / total * 100;
    return `${verdictColors[group.key]} ${start}% ${cursor}%`;
  });
  $("#verdict-donut").style.background = `conic-gradient(${segments.join(",")})`;
  $("#acceptance-rate").textContent = `${Math.round(state.analytics.acceptanceRate * 100)}%`;
  $("#verdict-legend").innerHTML = groups.slice(0, 6).map((group) => `
    <div class="legend-row"><span><b style="background:${verdictColors[group.key]}"></b>${escapeHtml(group.label)}</span><strong>${Math.round(group.count / total * 100)}%</strong></div>
  `).join("");
}

function renderHeatmap() {
  const activity = state.analytics.activity;
  const cells = [];
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - 364);
  const max = Math.max(1, ...Object.values(activity));
  for (let i = 0; i < 365; i++) {
    const key = date.toISOString().slice(0, 10);
    const count = activity[key] || 0;
    const level = count ? Math.max(1, Math.ceil(count / max * 4)) : 0;
    cells.push(`<span class="heat-cell" data-level="${level}" title="${key}: ${count} submissions"></span>`);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  $("#heatmap").innerHTML = cells.join("");
}

function renderLanguages() {
  const entries = Object.entries(state.analytics.languages).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  $("#language-list").innerHTML = entries.map(([name, count]) => `
    <div class="language-row">
      <span>${escapeHtml(name)}</span><strong>${formatNumber(count)}</strong>
      <div class="bar-track"><div class="bar-fill" style="width:${count / max * 100}%"></div></div>
    </div>`).join("");
}

function renderDifficulty() {
  const entries = Object.entries(state.analytics.difficulty).map(([rating, count]) => [Number(rating), count]).sort((a, b) => a[0] - b[0]);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  $("#comfort-zone").textContent = state.analytics.averageSolvedRating ? `Avg. ${state.analytics.averageSolvedRating}` : "Unrated problems";
  $("#difficulty-chart").innerHTML = entries.length ? entries.map(([rating, count]) => `
    <div class="difficulty-bar" title="${count} solved at ${rating}">
      <small>${count}</small>
      <div style="height:${Math.max(3, count / max * 150)}px"></div>
      <span>${rating}</span>
    </div>`).join("") : '<p class="muted small">No rated solved problems found.</p>';
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function saveRecent(handle) {
  const recent = [handle, ...JSON.parse(localStorage.getItem("cf-recent") || "[]").filter((item) => item.toLowerCase() !== handle.toLowerCase())].slice(0, 3);
  localStorage.setItem("cf-recent", JSON.stringify(recent));
  renderRecent();
}

function renderRecent() {
  const recent = JSON.parse(localStorage.getItem("cf-recent") || "[]");
  $("#recent-searches").innerHTML = recent.map((handle) => `<button class="recent-chip" data-handle="${escapeHtml(handle)}">${escapeHtml(handle)}</button>`).join("");
}

function downloadReport() {
  const a = state.analytics;
  const i = state.insights;
  const topTopics = a.topics.slice(0, 10);
  const generated = new Date().toLocaleString();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(a.user.handle)} — CF Pulse Report</title>
  <style>body{font-family:Arial,sans-serif;color:#171a18;margin:0;background:#f3f5ef}main{max-width:920px;margin:auto;padding:50px}.head{background:#111;color:#fff;padding:35px;border-top:7px solid #b6e82d}h1{margin:6px 0;font-size:42px}.muted{color:#777}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.box,.section{background:#fff;border:1px solid #dde0d9;padding:20px}.box strong{font-size:26px;display:block;margin-top:8px}.section{margin-top:12px}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #eee;padding:9px}li{margin:8px 0}.tag{color:#6b8200;text-transform:uppercase;font-size:11px;font-weight:bold}@media print{body{background:#fff}main{padding:0}.section,.box{break-inside:avoid}}</style></head>
  <body><main><div class="head"><div class="tag">CF Pulse intelligence report</div><h1>${escapeHtml(a.user.handle)}</h1><div>${escapeHtml(capitalize(a.user.rank || "unrated"))} · Generated ${escapeHtml(generated)}</div></div>
  <div class="grid"><div class="box">Current rating<strong>${a.user.rating || "Unrated"}</strong></div><div class="box">Peak rating<strong>${a.maxRating || "—"}</strong></div><div class="box">Solved<strong>${a.solved.length}</strong></div><div class="box">Contests<strong>${a.ratings.length}</strong></div></div>
  <div class="section"><div class="tag">${i.source === "gemini" ? "Gemini" : "Smart coach"} assessment</div><h2>${escapeHtml(i.headline)}</h2><p>${escapeHtml(i.summary)}</p><h3>Strengths</h3><ul>${(i.strengths || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul><h3>Recommended next steps</h3><ol>${(i.nextSteps || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ol></div>
  <div class="section"><div class="tag">Performance indicators</div><h2>Submission profile</h2><table><tr><th>Metric</th><th>Value</th></tr><tr><td>Acceptance rate</td><td>${Math.round(a.acceptanceRate * 100)}%</td></tr><tr><td>Distinct problems attempted</td><td>${a.attempted}</td></tr><tr><td>Average solved difficulty</td><td>${a.averageSolvedRating || "N/A"}</td></tr><tr><td>Active days</td><td>${a.activeDays}</td></tr><tr><td>Current streak</td><td>${a.currentStreak} days</td></tr></table></div>
  <div class="section"><div class="tag">Skill map</div><h2>Top topics</h2><table><tr><th>Topic</th><th>Solved</th><th>Attempted</th><th>Coverage</th></tr>${topTopics.map((t) => `<tr><td>${escapeHtml(capitalize(t.name))}</td><td>${t.solved}</td><td>${t.attempted}</td><td>${Math.round(t.rate * 100)}%</td></tr>`).join("")}</table></div>
  <p class="muted">Source: public Codeforces API. AI observations are coaching suggestions. CF Pulse is not affiliated with Codeforces.</p></main></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${a.user.handle}-cf-pulse-report.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runAnalysis($("#handle-input").value);
});
document.addEventListener("click", (event) => {
  const handleButton = event.target.closest("[data-handle]");
  if (handleButton) {
    $("#handle-input").value = handleButton.dataset.handle;
    runAnalysis(handleButton.dataset.handle);
  }
});
$("#dismiss-error").addEventListener("click", () => $("#error-panel").classList.add("hidden"));
$("#download-report").addEventListener("click", downloadReport);
window.addEventListener("resize", () => state.analytics && renderRatingChart());
renderRecent();
