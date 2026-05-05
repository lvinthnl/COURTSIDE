const cron = require("node-cron");
const { generateWeeklyStats } = require("../services/statsService");

const scheduleWeeklyStatsJob = () => {
  // Run every night so weekly stats stay fresh throughout the week.
  // Sunday runs still generate the full week rollup.
  cron.schedule("0 23 * * *", async () => {
    try {
      console.log("Running weekly statistics job...");
      await generateWeeklyStats();
      console.log("Weekly statistics job completed");
    } catch (error) {
      console.error("Weekly statistics job failed:", error.message);
    }
  });
};

module.exports = { scheduleWeeklyStatsJob };

