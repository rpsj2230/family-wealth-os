-- OpenRouter as an AI provider (a free key reaches many open models, tried one after another).
alter table public.integration_settings drop constraint if exists integration_settings_ai_provider_check;
alter table public.integration_settings add constraint integration_settings_ai_provider_check
  check (ai_provider in ('groq','gemini','openrouter'));
