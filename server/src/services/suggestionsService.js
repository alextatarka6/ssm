const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { suggestionsFile, smtpHost, smtpPort, smtpUser, smtpPass, suggestionEmailTo } = require("../config");

const MAX_LENGTH = 500;

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function readAll() {
  if (!fs.existsSync(suggestionsFile)) return [];
  const raw = fs.readFileSync(suggestionsFile, "utf8").trim();
  return raw ? JSON.parse(raw) : [];
}

function writeAll(suggestions) {
  fs.mkdirSync(path.dirname(suggestionsFile), { recursive: true });
  const tmp = `${suggestionsFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(suggestions, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, suggestionsFile);
}

function submitSuggestion({ userId, username, text }) {
  if (!userId || typeof userId !== "string" || !userId.trim()) {
    return { ok: false, status: 400, detail: "user_id is required." };
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    return { ok: false, status: 400, detail: "text is required." };
  }
  if (text.trim().length > MAX_LENGTH) {
    return { ok: false, status: 400, detail: `Suggestion must be ${MAX_LENGTH} characters or fewer.` };
  }

  const today = todayUtc();
  const suggestions = readAll();

  const alreadySubmitted = suggestions.some(
    (s) => s.userId === userId.trim() && s.date === today,
  );
  if (alreadySubmitted) {
    return { ok: false, status: 429, detail: "You've already submitted a suggestion today. Come back tomorrow!" };
  }

  suggestions.push({
    userId: userId.trim(),
    username: username ? String(username).trim() : null,
    text: text.trim(),
    date: today,
    submittedAt: new Date().toISOString(),
  });

  writeAll(suggestions);
  return { ok: true };
}

async function sendDailyEmail() {
  if (!smtpHost) {
    console.log("[suggestions] SMTP not configured — skipping daily email.");
    return;
  }

  const today = todayUtc();
  const suggestions = readAll().filter((s) => s.date === today);

  if (suggestions.length === 0) {
    console.log("[suggestions] No suggestions today — skipping email.");
    return;
  }

  const body = suggestions
    .map((s, i) => {
      const who = s.username || s.userId;
      return `${i + 1}. ${who}\n   ${s.text}\n   Submitted: ${s.submittedAt}`;
    })
    .join("\n\n");

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  await transporter.sendMail({
    from: smtpUser || "noreply@sectionstockmarket.com",
    to: suggestionEmailTo,
    subject: `SSM Suggestions — ${today} (${suggestions.length})`,
    text: `Section Stock Market — Suggestions for ${today}\n\n${body}\n`,
  });

  console.log(`[suggestions] Daily email sent to ${suggestionEmailTo} with ${suggestions.length} suggestion(s).`);
}

module.exports = { submitSuggestion, sendDailyEmail };
