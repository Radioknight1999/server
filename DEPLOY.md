# Deploy the server on Render (free tier)
1. Create a GitHub account and a new repo; upload the `server/` folder contents (server.js, package.json, render.yaml) to its root.
2. At render.com sign up (GitHub login). New > Blueprint (or Web Service) > pick the repo. Plan: Free. Render may ask for a card; if so, tell me and we'll pick another host.
3. Wait for the build; open `https://<name>.onrender.com/health` — it should return {"ok":true,...}.
4. Send me that URL; the client will use `wss://<name>.onrender.com`.
Local test: `cd server && npm install && npm start`.
