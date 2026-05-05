let ioInstance;

const SOCKET_EVENTS = {
  RESERVATION_UPDATED: "reservationUpdated",
  COURT_STATUS_CHANGED: "courtStatusChanged",
  MAINTENANCE_UPDATED: "maintenanceUpdated",
  DASHBOARD_REFRESH: "dashboardRefresh",
};

const attachSocketEvents = (io) => {
  ioInstance = io;
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });
};

const emitEvent = (event, payload) => {
  if (!ioInstance) {
    console.warn(`Socket event ${event} skipped - io not initialized`);
    return;
  }
  ioInstance.emit(event, payload);
};

module.exports = { attachSocketEvents, emitEvent, SOCKET_EVENTS };

