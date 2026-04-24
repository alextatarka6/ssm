const { createClient } = require("@supabase/supabase-js");
const { supabaseUrl, supabaseServiceKey } = require("../config");

let _client = null;

function getSupabaseAdmin() {
  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  if (!_client) {
    _client = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return _client;
}

module.exports = { getSupabaseAdmin };
