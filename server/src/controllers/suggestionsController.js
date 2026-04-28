const { submitSuggestion } = require("../services/suggestionsService");

async function postSuggestion(req, res) {
  const { user_id, username, text } = req.body;
  const result = submitSuggestion({ userId: user_id, username, text });

  if (!result.ok) {
    return res.status(result.status).json({ detail: result.detail });
  }

  res.status(201).json({ ok: true });
}

module.exports = { postSuggestion };
