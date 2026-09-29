/** PM2 production process definition for the MangoTCG administrator. */
module.exports = {
  apps: [
    {
      name: "mangotcg-admin",
      cwd: __dirname,
      script: "./node_modules/next/dist/bin/next",
      args: "start -p 3001",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
