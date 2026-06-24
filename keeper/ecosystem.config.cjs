// pm2 process file for the Tethra keepers, tuned for a small (1 GB) VM.
//
//   cd keeper && npm install
//   pm2 start ecosystem.config.cjs        # both keepers
//   pm2 start ecosystem.config.cjs --only tethra-keeper   # redeem keeper only (leanest)
//   pm2 save && pm2 startup               # survive reboot
//
// KEEPER_KEY is read from keeper/.env via node's --env-file-if-exists (Node 20.12+).
// Each app caps its V8 heap at 128 MB and pm2 restarts it if RSS passes 200 MB,
// so a leak can never eat the whole VM. Steady state is ~115 MB per app.
const interpreter_args = "--env-file-if-exists=.env --import tsx --max-old-space-size=128";

module.exports = {
  apps: [
    {
      name: "tethra-keeper",
      script: "src/keeper.ts",
      interpreter: "node",
      interpreter_args,
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "200M",
      env: { POLL_MS: "60000" },
    },
    {
      name: "tethra-liquidator",
      script: "src/liquidator.ts",
      interpreter: "node",
      interpreter_args,
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "200M",
      env: { POLL_MS: "60000" },
    },
  ],
};
