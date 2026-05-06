// Force backend date operations to use Manila time regardless of host machine TZ.
process.env.TZ = process.env.TZ || "Asia/Manila";

const path = require("path");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const { Server } = require("socket.io");

dotenv.config();
if (!process.env.MONGODB_URI) {
  dotenv.config({ path: path.join(__dirname, "config", "sample.env") });
}

const { connectDB } = require("./src/config/database");
const { errorHandler, notFoundHandler } = require("./src/middleware/errorHandlers");
const apiRoutes = require("./src/routes");
const { attachSocketEvents } = require("./src/utils/socketEvents");
const { scheduleWeeklyStatsJob } = require("./src/jobs/weeklyStatsJob");
const { seedDefaultAdmin } = require("./src/controllers/authController");
const { seedCourts } = require("./src/utils/seedData");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

// Attach socket events to server
attachSocketEvents(io);

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// Static frontend
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/api", apiRoutes);

// Healthcheck
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", environment: process.env.NODE_ENV || "development" });
});

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    seedDefaultAdmin().catch((error) => console.error("Failed to seed admin:", error.message));
    seedCourts().catch((error) => console.error("Failed to seed courts:", error.message));
    scheduleWeeklyStatsJob();
    server.listen(PORT, () => {
      console.log(`Courtside GamePlan server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });

module.exports = { app, server, io };

