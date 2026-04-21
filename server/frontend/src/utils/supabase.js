import { createClient } from "@supabase/supabase-js";
import { getFrontendConfig, getFrontendConfigError } from "../config";

const { supabaseUrl, supabasePublishableKey } = getFrontendConfig();
const configError = getFrontendConfigError();

export const supabase = configError
  ? null
  : createClient(supabaseUrl, supabasePublishableKey);
