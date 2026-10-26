-- Anthropic (Claude) as an AI provider: the key is a pay-per-use API key; reading a rate page or a bank alert costs a fraction of a cent.
alter table public.integration_settings drop constraint if exists integration_settings_ai_provider_check;
alter table public.integration_settings add constraint integration_settings_ai_provider_check
  check (ai_provider in ('anthropic','groq','gemini','openrouter'));
