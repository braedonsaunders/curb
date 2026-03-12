# Curb Shared Form Worker

This worker receives contact form submissions from generated Curb sites and
forwards them to the business owner using Resend.

## Required secrets

- `CURB_FORM_SIGNING_SECRET`
- `TURNSTILE_SECRET_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

## Deploy

1. Create a worker in your Cloudflare account.
2. Upload `worker.mjs` as the worker source.
3. Set the secrets listed above.
4. Route the worker to a public URL such as `https://forms.example.com/submit`.
5. Paste that URL into Curb Settings under `Forms -> Endpoint URL`.

## Curb settings

Use the same values in Curb:

- `Forms -> Endpoint URL`
- `Forms -> Signing Secret`
- `Forms -> Turnstile Site Key`
- `Forms -> Turnstile Secret Key`
- `Forms -> Resend API Key`
- `Forms -> From Email`

The signing secret in Curb must exactly match `CURB_FORM_SIGNING_SECRET` in the
worker.

