# Phase 0 Starter Application

Tiny frontend + Node/Express API + PostgreSQL app for the deploy/test/issue/fix/redeploy exercise.

## Intentional defect
The initial backend accepts whitespace-only item titles. Do not fix it before a peer reports it.

## Local setup
1. Create PostgreSQL database and run `schema.sql`.
2. In `backend/`, copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Run `npm install` then `npm start`.
4. Set `window.API_BASE_URL` in `frontend/config.js`.
5. Serve the `frontend/` directory with any static server.

Use instructor-approved no-cost hosting for deployment. Do not commit `.env`.
