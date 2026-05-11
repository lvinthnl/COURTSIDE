import { api } from "./api.js";

const socket = io();
let currentUser = null;

const elements = {
  liveCourtsGrid: document.getElementById("liveCourtsGrid"),
  todayReservations: document.getElementById("todayReservations"),
  paidReservations: document.getElementById("paidReservations"),
  reservationsTabUnpaid: document.getElementById("reservationsTabUnpaid"),
  reservationsTabPaid: document.getElementById("reservationsTabPaid"),
  maintenanceForm: document.getElementById("maintenanceForm"),
  adminLogout: document.getElementById("adminLogout"),
  adminTodayLabel: document.getElementById("adminTodayLabel"),
  statTodayBookings: document.getElementById("statTodayBookings"),
  statUnpaid: document.getElementById("statUnpaid"),
  statTotalReservations: document.getElementById("statTotalReservations"),
  statRevenue: document.getElementById("statRevenue"),
  reservationsDateFilter: document.getElementById("reservationsDateFilter"),
  reservationsSortOrder: document.getElementById("reservationsSortOrder"),
};

let _latestReservations = [];

// Cache latest dashboard data so the timeline modal can render on demand
let _latestTimelineData = { courts: [], bookings: [], courtsWithAvail: [] };

const renderStats = (todayBookings = [], allReservations = []) => {
  const today = new Date();
  const todayKey = today.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

  const todays = (allReservations || []).filter((b) => {
    const k = new Date(b.startTime).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    return k === todayKey;
  });

  const notCancelled = todays.filter((b) => b.status !== "cancelled");
  const isPaid = (b) => b.paymentStatus && b.paymentStatus.status === "paid";
  const paid = notCancelled.filter(isPaid);
  const unpaid = notCancelled.filter((b) => !isPaid(b));
  const totalReservations = (allReservations || []).filter((b) => b.status !== "cancelled").length;
  const revenue = paid.reduce(
    (sum, b) => sum + ((b.paymentStatus && typeof b.paymentStatus.amount === "number")
      ? b.paymentStatus.amount
      : (b.estimatedCost || 0)),
    0
  );

  if (elements.statTodayBookings) elements.statTodayBookings.textContent = notCancelled.length;
  if (elements.statUnpaid) elements.statUnpaid.textContent = unpaid.length;
  if (elements.statTotalReservations) elements.statTotalReservations.textContent = totalReservations;
  if (elements.statRevenue) elements.statRevenue.textContent = `₱${revenue.toLocaleString()}`;
};

const setTodayLabel = () => {
  if (!elements.adminTodayLabel) return;
  elements.adminTodayLabel.textContent = new Date().toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (date) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const fmtDate = (date) =>
  new Date(date).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const fmtTimePH = (date) =>
  new Date(date).toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Build an array of { hour, label, cancelled } for a booking */
const getHourlySlots = (booking) => {
  const startHour = new Date(booking.startTime).getHours();
  const endHour = new Date(booking.endTime).getHours();
  const cancelled = booking.cancelledHours || [];
  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    const label = `${h}:00–${h + 1}:00`;
    slots.push({ hour: h, label, cancelled: cancelled.includes(h) });
  }
  return slots;
};

/** Render hourly slot pills into a container element */
const renderHourPills = (slots) => {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;";
  slots.forEach(({ label, cancelled }) => {
    const pill = document.createElement("span");
    pill.textContent = label;
    pill.style.cssText = `
      padding:3px 8px;border-radius:20px;font-size:0.78rem;font-weight:600;
      background:${cancelled ? "rgba(220,53,69,0.15)" : "rgba(242,92,5,0.15)"};
      color:${cancelled ? "rgba(220,53,69,0.9)" : "rgba(242,92,5,0.9)"};
      border:1px solid ${cancelled ? "rgba(220,53,69,0.3)" : "rgba(242,92,5,0.3)"};
      text-decoration:${cancelled ? "line-through" : "none"};
    `;
    wrap.appendChild(pill);
  });
  return wrap;
};

// Status colour tokens for timeline blocks
const STATUS_BG = {
  pending: "rgba(255,193,7,0.18)",
  confirmed: "rgba(242,92,5,0.15)",
  checked_in: "rgba(40,167,69,0.18)",
  completed: "rgba(108,117,125,0.18)",
  cancelled: "rgba(220,53,69,0.18)",
};
const STATUS_BORDER = {
  pending: "rgba(255,193,7,0.5)",
  confirmed: "rgba(242,92,5,0.25)",
  checked_in: "rgba(40,167,69,0.45)",
  completed: "rgba(108,117,125,0.45)",
  cancelled: "rgba(220,53,69,0.45)",
};

// ─── Modal helpers ────────────────────────────────────────────────────────────

const openModal = (content) => {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.zIndex = "1300";
  const box = document.createElement("div");
  box.className = "modal-box";
  if (typeof content === "string") {
    box.innerHTML = content;
  } else {
    box.appendChild(content);
  }
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add("visible");
    box.classList.add("visible");
  });
  const close = () => {
    overlay.classList.remove("visible");
    box.classList.remove("visible");
    setTimeout(() => overlay.remove(), 260);
  };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  const closeBtn = box.querySelector(".modal-close");
  if (closeBtn) closeBtn.addEventListener("click", close);
  return { overlay, box, close };
};

// ─── Partial Cancel Modal ─────────────────────────────────────────────────────

const openPartialCancelModal = async (booking, onDone) => {
  const slots = getHourlySlots(booking);
  const uncancelledSlots = slots.filter((s) => !s.cancelled);

  if (uncancelledSlots.length === 0) {
    alert("All hours in this booking are already cancelled.");
    return;
  }

  const frag = document.createDocumentFragment();

  const title = document.createElement("h4");
  title.textContent = "Cancel Specific Hours";
  frag.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.style.marginBottom = "1rem";
  subtitle.textContent = `Select the hour(s) to cancel for ${booking.customer?.fullName || booking.walkInName || "this customer"}'s booking on ${fmtDate(booking.startTime)}.`;
  frag.appendChild(subtitle);

  const checkboxWrap = document.createElement("div");
  checkboxWrap.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-bottom:1.2rem;";

  uncancelledSlots.forEach(({ hour, label }) => {
    const lbl = document.createElement("label");
    lbl.style.cssText = "display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.95rem;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = hour;
    cb.style.width = "16px";
    cb.style.height = "16px";
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(label));
    checkboxWrap.appendChild(lbl);
  });
  frag.appendChild(checkboxWrap);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:10px;";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-outline";
  cancelBtn.textContent = "Cancel Selected Hours";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = "Back";
  closeBtn.style.opacity = "0.7";

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(closeBtn);
  frag.appendChild(btnRow);

  const { close } = openModal(frag);
  closeBtn.addEventListener("click", close);

  cancelBtn.addEventListener("click", async () => {
    const checked = [...checkboxWrap.querySelectorAll("input:checked")].map((cb) => Number(cb.value));
    if (checked.length === 0) {
      alert("Please select at least one hour to cancel.");
      return;
    }
    const confirmMsg =
      checked.length === uncancelledSlots.length
        ? `Cancel ALL ${checked.length} remaining hour(s)? This will fully cancel the booking.`
        : `Cancel ${checked.length} hour(s): ${checked.map((h) => `${h}:00–${h + 1}:00`).join(", ")}?`;
    if (!confirm(confirmMsg)) return;
    try {
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Cancelling…";
      const result = await api.partialCancelReservation(booking._id, checked);
      alert(result.message);
      close();
      if (onDone) await onDone();
    } catch (err) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = "Cancel Selected Hours";
      alert(err.message || "Failed to cancel hours");
    }
  });
};

// ─── Extend Reservation Modal ─────────────────────────────────────────────────

const openExtendModal = async (booking, availableCourts, onDone) => {
  const currentEndHour = new Date(booking.endTime).getHours();
  const maxEndHour = 21;

  if (currentEndHour >= maxEndHour) {
    alert("This booking already ends at the latest allowed time (21:00).");
    return;
  }

  // Find which hours after current end are still free for this court today
  const court = availableCourts.find((c) => String(c._id) === String(booking.court._id || booking.court));
  const bookingDateKey = new Date(booking.startTime).toISOString().split("T")[0];
  const available = court?.availableHoursByDate?.[bookingDateKey] || [];

  const frag = document.createDocumentFragment();

  const title = document.createElement("h4");
  title.textContent = "Extend Reservation";
  frag.appendChild(title);

  const info = document.createElement("p");
  info.style.marginBottom = "1rem";
  info.textContent = `Current end time: ${fmtTimePH(booking.endTime)}. Select a new end time.`;
  frag.appendChild(info);

  const selectLabel = document.createElement("label");
  selectLabel.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:1.2rem;font-size:0.95rem;";
  selectLabel.textContent = "Extend end time to:";

  const select = document.createElement("select");
  select.style.cssText = "background:#1a1a2e;color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px;font-size:0.95rem;";

  let hasOptions = false;
  for (let h = currentEndHour + 1; h <= maxEndHour; h++) {
    const opt = document.createElement("option");
    opt.value = h;
    opt.textContent = `${h}:00 (+${h - currentEndHour} hr${h - currentEndHour > 1 ? "s" : ""})`;
    // grey out if not available (informational — server will enforce)
    if (!available.includes(h - 1)) {
      opt.textContent += " — unavailable";
      opt.style.color = "rgba(220,53,69,0.8)";
    }
    select.appendChild(opt);
    hasOptions = true;
  }

  if (!hasOptions) {
    alert("No extension options available — court is fully booked after current end time.");
    return;
  }

  selectLabel.appendChild(select);
  frag.appendChild(selectLabel);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:10px;";

  const extendBtn = document.createElement("button");
  extendBtn.className = "btn btn-primary";
  extendBtn.textContent = "Extend Booking";

  const backBtn = document.createElement("button");
  backBtn.className = "btn";
  backBtn.textContent = "Back";
  backBtn.style.opacity = "0.7";

  btnRow.appendChild(extendBtn);
  btnRow.appendChild(backBtn);
  frag.appendChild(btnRow);

  const { close } = openModal(frag);
  backBtn.addEventListener("click", close);

  extendBtn.addEventListener("click", async () => {
    const newEnd = Number(select.value);
    if (!confirm(`Extend reservation to ${newEnd}:00? (+${newEnd - currentEndHour} hour(s))`)) return;
    try {
      extendBtn.disabled = true;
      extendBtn.textContent = "Extending…";
      await api.extendReservation(booking._id, newEnd);
      alert(`Booking extended to ${newEnd}:00.`);
      close();
      if (onDone) await onDone();
    } catch (err) {
      extendBtn.disabled = false;
      extendBtn.textContent = "Extend Booking";
      alert(err.message || "Failed to extend booking");
    }
  });
};

// ─── Courts renderer ──────────────────────────────────────────────────────────

const renderCourts = (courtCounts) => {
  if (!elements.liveCourtsGrid) return;
  elements.liveCourtsGrid.innerHTML = "";
  (courtCounts || []).forEach((item) => {
    const div = document.createElement("div");
    div.className = "grid-item clickable-court";
    div.dataset.sport = item._id;
    div.style.cursor = "pointer";
    div.innerHTML = `
      <span>${item._id.toUpperCase()}</span>
      <span>${item.available} available · ${item.maintenance} maintenance / ${item.totalCourts}</span>
    `;
    div.addEventListener("click", () => showMaintenanceForSport(item._id));
    elements.liveCourtsGrid.appendChild(div);
  });
};

const showMaintenanceForSport = async (sport) => {
  try {
    const maintenance = await api.getTomorrowMaintenance();
    const sportMaintenance = maintenance.filter((m) => {
      const courtType = m.court?.courtType || m.court?.courtName?.toLowerCase() || "";
      return courtType === sport.toLowerCase();
    });
    if (sportMaintenance.length === 0) {
      alert(`No maintenance scheduled for ${sport.toUpperCase()} tomorrow.`);
      return;
    }
    let message = `${sport.toUpperCase()} Maintenance Tomorrow:\n\n`;
    sportMaintenance.forEach((m) => {
      const start = new Date(m.startTime);
      const end = new Date(m.endTime);
      const courtName = m.court?.courtName || "Unknown Court";
      message += `${courtName}\n${start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${fmtTime(start)} – ${fmtTime(end)}\n`;
      if (m.remarks) message += `Remarks: ${m.remarks}\n`;
      message += "\n";
    });
    alert(message);
  } catch (error) {
    alert(`Failed to load maintenance info for ${sport.toUpperCase()}.`);
  }
};

// ─── Reservation list renderer ────────────────────────────────────────────────

const applyReservationFilters = () => {
  const dateFilter = elements.reservationsDateFilter?.value || "all";
  const sortOrder = elements.reservationsSortOrder?.value || "desc";

  let list = _latestReservations.slice();

  if (dateFilter === "today") {
    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    list = list.filter((b) => {
      const k = new Date(b.startTime).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      return k === todayKey;
    });
  }

  list.sort((a, b) => {
    const diff = new Date(a.startTime) - new Date(b.startTime);
    return sortOrder === "asc" ? diff : -diff;
  });

  renderReservations(list);
};

const initReservationFilters = () => {
  if (elements.reservationsDateFilter) {
    elements.reservationsDateFilter.addEventListener("change", applyReservationFilters);
  }
  if (elements.reservationsSortOrder) {
    elements.reservationsSortOrder.addEventListener("change", applyReservationFilters);
  }
};

const renderReservations = (reservations) => {
  if (!elements.todayReservations) return;
  if (elements.paidReservations) elements.paidReservations.innerHTML = "";
  elements.todayReservations.innerHTML = "";

  (reservations || []).forEach((booking) => {
    const isPaid = booking.paymentStatus && booking.paymentStatus.status === "paid";
    const container = isPaid && elements.paidReservations ? elements.paidReservations : elements.todayReservations;

    const div = document.createElement("div");
    div.className = "timeline-item";
    div.dataset.bookingId = booking._id;

    const slots = getHourlySlots(booking);
    const start = fmtTimePH(booking.startTime);
    const end = fmtTimePH(booking.endTime);

    const nameSpan = document.createElement("span");
    nameSpan.textContent = booking.customer?.fullName || booking.walkInName || "Guest";
    nameSpan.style.fontWeight = "600";

    const emailSpan = document.createElement("span");
    emailSpan.textContent = booking.customer?.email || "No email";
    emailSpan.style.cssText = "font-size:0.85rem;opacity:0.8;";

    const dateSpan = document.createElement("span");
    dateSpan.textContent = fmtDate(booking.bookingDate || booking.startTime);

    const courtSpan = document.createElement("span");
    courtSpan.textContent = booking.court?.courtName || "N/A";

    if (!isPaid) {
      const paidBtn = document.createElement("button");
      paidBtn.className = "btn-paid";
      paidBtn.textContent = "Paid";
      paidBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Mark this reservation as paid?")) return;
        try {
          paidBtn.classList.add("paid-clicked");
          await api.markReservationPaid(booking._id);
          setTimeout(() => { div.remove(); loadDashboard(); }, 300);
        } catch (err) {
          paidBtn.classList.remove("paid-clicked");
          alert(err.message || "Failed to mark paid");
        }
      });
      div.appendChild(paidBtn);
    }

    div.style.cursor = "pointer";
    div.addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-paid")) return;

      const content = document.createDocumentFragment();

      const closeBtn = document.createElement("button");
      closeBtn.className = "modal-close small";
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      content.appendChild(closeBtn);

      const h4 = document.createElement("h4");
      h4.textContent = "Reservation Details";
      content.appendChild(h4);

      const fields = [
        ["Customer", booking.customer?.fullName || booking.walkInName || "Guest"],
        ["Email", booking.customer?.email || "N/A"],
        ["Phone", booking.customer?.phoneNumber || "N/A"],
        ["Court", booking.court?.courtName || "N/A"],
        ["Date", fmtDate(booking.bookingDate || booking.startTime)],
        ["Time", `${start} – ${end}`],
        ["Status", isPaid ? "PAID" : booking.status.toUpperCase()],
        ["Total Hours", `${booking.totalHours} hr(s)`],
        ["Est. Cost", `₱${booking.estimatedCost?.toLocaleString()}`],
      ];
      fields.forEach(([label, val]) => {
        const p = document.createElement("p");
        p.innerHTML = `<strong>${label}:</strong> ${val}`;
        content.appendChild(p);
      });

      if (!["cancelled", "completed"].includes(booking.status)) {
        const actionRow = document.createElement("div");
        actionRow.style.cssText = "display:flex;justify-content:flex-end;margin-top:10px;";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn-outline";
        cancelBtn.textContent = "Cancel Booking";
        cancelBtn.addEventListener("click", async () => {
          if (!confirm(`Cancel booking for ${booking.customer?.fullName || booking.walkInName || "this customer"}?`)) return;
          try {
            cancelBtn.disabled = true;
            cancelBtn.textContent = "Cancelling...";
            await api.cancelReservation(booking._id);
            await loadDashboard();
          } catch (err) {
            cancelBtn.disabled = false;
            cancelBtn.textContent = "Cancel Booking";
            alert(err.message || "Failed to cancel booking");
          }
        });
        actionRow.appendChild(cancelBtn);
        content.appendChild(actionRow);
      }

      // Hourly breakdown
      const breakdownTitle = document.createElement("p");
      breakdownTitle.innerHTML = "<strong>Hour Breakdown:</strong>";
      content.appendChild(breakdownTitle);
      content.appendChild(renderHourPills(slots));

      openModal(content);
    });

    div.appendChild(nameSpan);
    div.appendChild(emailSpan);
    div.appendChild(dateSpan);
    div.appendChild(courtSpan);
    container.appendChild(div);
  });
};

// ─── Timeline renderer ────────────────────────────────────────────────────────

const renderTimeline = (courts, bookings, allCourts, container) => {
  if (!container) return;

  const startHour = 7;
  const endHour = 21;
  const hours = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);

  container.innerHTML = "";

  const table = document.createElement("div");
  table.className = "admin-timeline";
  table.style.cssText = `
    display:grid;
    grid-template-columns:200px repeat(${hours.length},1fr);
    gap:4px;
    align-items:stretch;
  `;

  // Header row
  const headerCourt = document.createElement("div");
  headerCourt.textContent = "Court";
  headerCourt.style.fontWeight = "700";
  table.appendChild(headerCourt);

  hours.forEach((h) => {
    const cell = document.createElement("div");
    cell.textContent = `${h}:00`;
    cell.style.cssText = "text-align:center;font-size:0.8rem;opacity:0.75;";
    table.appendChild(cell);
  });

  // Court rows
  courts.forEach((court) => {
    const courtName = document.createElement("div");
    courtName.textContent = court.courtName;
    courtName.style.cssText = "padding:6px;border-top:1px solid rgba(255,255,255,0.04);font-size:0.88rem;";
    table.appendChild(courtName);

    for (let i = 0; i < hours.length; i++) {
      const cell = document.createElement("div");
      cell.style.cssText = "min-height:48px;border-top:1px solid rgba(255,255,255,0.04);background:transparent;";
      table.appendChild(cell);
    }
  });

  container.appendChild(table);

  // Overlay booking blocks
  bookings.forEach((booking) => {
    const courtIndex = courts.findIndex((c) => String(c._id) === String(booking.court?._id || booking.court));
    if (courtIndex === -1) return;

    const bookingStart = new Date(booking.startTime).getHours();
    const bookingEnd = new Date(booking.endTime).getHours();
    const span = Math.max(bookingEnd - bookingStart, 1);
    const colStart = 2 + (bookingStart - startHour);
    const rowStart = 2 + courtIndex;

    const status = booking.status || "confirmed";
    const block = document.createElement("div");
    block.className = "admin-booking-block";
    block.style.cssText = `
      grid-column:${colStart} / span ${span};
      grid-row:${rowStart};
      background:${STATUS_BG[status] || STATUS_BG.confirmed};
      border:1px solid ${STATUS_BORDER[status] || STATUS_BORDER.confirmed};
      border-radius:6px;
      padding:6px;
      cursor:pointer;
      display:flex;
      flex-direction:column;
      justify-content:center;
      font-size:0.82rem;
      z-index:5;
    `;

    const titleEl = document.createElement("div");
    titleEl.textContent = `${booking.customer?.fullName || booking.walkInName || "Guest"} · ${booking.court?.courtName || ""}`;
    titleEl.style.fontWeight = "600";

    const timeEl = document.createElement("div");
    timeEl.textContent = `${fmtTimePH(booking.startTime)} – ${fmtTimePH(booking.endTime)}`;
    timeEl.style.opacity = "0.8";

    const statusBadge = document.createElement("div");
    statusBadge.textContent = status.replace("_", " ").toUpperCase();
    statusBadge.style.cssText = `font-size:0.7rem;opacity:0.7;margin-top:2px;`;

    block.appendChild(titleEl);
    block.appendChild(timeEl);
    block.appendChild(statusBadge);

    block.addEventListener("click", async () => {
      // Re-fetch latest booking data before opening modal
      let freshBooking = booking;
      try {
        const all = await api.listReservations();
        freshBooking = all.find((b) => String(b._id) === String(booking._id)) || booking;
      } catch (_) {}

      const frag = document.createDocumentFragment();

      const h4 = document.createElement("h4");
      h4.textContent = "Booking Details";
      frag.appendChild(h4);

      const bStatus = freshBooking.status || "confirmed";
      const fields = [
        ["Customer", freshBooking.customer?.fullName || freshBooking.walkInName || "Guest"],
        ["Email", freshBooking.customer?.email || "N/A"],
        ["Phone", freshBooking.customer?.phoneNumber || "N/A"],
        ["Court", freshBooking.court?.courtName || "N/A"],
        ["Time", `${fmtTimePH(freshBooking.startTime)} – ${fmtTimePH(freshBooking.endTime)}`],
        ["Status", bStatus.replace("_", " ").toUpperCase()],
        ["Total Hours", `${freshBooking.totalHours} hr(s) active`],
        ["Est. Cost", `₱${freshBooking.estimatedCost?.toLocaleString()}`],
      ];
      fields.forEach(([label, val]) => {
        const p = document.createElement("p");
        p.innerHTML = `<strong>${label}:</strong> ${val}`;
        frag.appendChild(p);
      });

      // Hourly breakdown with cancelled hours shown
      const breakdownTitle = document.createElement("p");
      breakdownTitle.innerHTML = "<strong>Hour Breakdown:</strong>";
      frag.appendChild(breakdownTitle);
      frag.appendChild(renderHourPills(getHourlySlots(freshBooking)));

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:1rem;";

      // Full cancel
      if (!["cancelled", "completed"].includes(bStatus)) {
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn-outline";
        cancelBtn.textContent = "Full Cancel";
        cancelBtn.addEventListener("click", async () => {
          if (!confirm(`Confirm FULL cancellation for ${freshBooking.customer?.fullName || freshBooking.walkInName || "this customer"}?`)) return;
          try {
            await api.cancelReservation(freshBooking._id);
            alert("Booking fully cancelled.");
            modal.close();
            await loadDashboard();
          } catch (err) {
            alert(err.message || "Failed to cancel");
          }
        });
        btnRow.appendChild(cancelBtn);

        // Partial cancel (hourly)
        const partialBtn = document.createElement("button");
        partialBtn.className = "btn btn-outline";
        partialBtn.textContent = "Cancel Hours";
        partialBtn.addEventListener("click", () => {
          modal.close();
          openPartialCancelModal(freshBooking, loadDashboard);
        });
        btnRow.appendChild(partialBtn);

        // Extend
        const extendBtn = document.createElement("button");
        extendBtn.className = "btn btn-primary";
        extendBtn.textContent = "Extend";
        extendBtn.addEventListener("click", () => {
          modal.close();
          openExtendModal(freshBooking, allCourts || courts, loadDashboard);
        });
        btnRow.appendChild(extendBtn);

        // Status toggle (confirmed ↔ checked_in)
        if (bStatus === "confirmed" || bStatus === "pending") {
          const checkinBtn = document.createElement("button");
          checkinBtn.className = "btn btn-primary";
          checkinBtn.textContent = "Mark Checked In";
          checkinBtn.addEventListener("click", async () => {
            try {
              await api.updateReservationStatus(freshBooking._id, { status: "checked_in" });
              alert("Marked as checked in.");
              modal.close();
              await loadDashboard();
            } catch (err) {
              alert(err.message || "Failed to update status");
            }
          });
          btnRow.appendChild(checkinBtn);
        } else if (bStatus === "checked_in") {
          const confirmBtn = document.createElement("button");
          confirmBtn.className = "btn btn-primary";
          confirmBtn.textContent = "Mark Confirmed";
          confirmBtn.addEventListener("click", async () => {
            try {
              await api.updateReservationStatus(freshBooking._id, { status: "confirmed" });
              alert("Status updated.");
              modal.close();
              await loadDashboard();
            } catch (err) {
              alert(err.message || "Failed to update status");
            }
          });
          btnRow.appendChild(confirmBtn);
        }
      }

      frag.appendChild(btnRow);
      const modal = openModal(frag);
    });

    table.appendChild(block);
  });
};

// ─── Walk-in reservation form ─────────────────────────────────────────────────

let walkinState = {
  courts: [],
  availabilityByDate: {},
  selectedHours: [],
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
};

const initWalkinForm = (courts) => {
  walkinState.courts = courts;

  const form = document.getElementById("walkinForm");
  if (!form) return;

  // Populate court select
  const courtSelect = document.getElementById("walkinCourt");
  courtSelect.innerHTML = '<option value="">Select a court</option>';
  courts.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c._id;
    opt.textContent = `${c.courtName} · ${c.courtType}`;
    courtSelect.appendChild(opt);
  });

  // Date + court → load availability for hour checkboxes
  const dateInput = document.getElementById("walkinDate");
  const walkinNameInput = document.getElementById("walkinName");
  const hoursContainer = document.getElementById("walkinHours");
  const hoursHint = document.getElementById("walkinHoursHint");
  const calendarGrid = document.getElementById("walkinCalendarGrid");
  const currentMonthYear = document.getElementById("walkinCurrentMonthYear");
  const prevMonthBtn = document.getElementById("walkinPrevMonth");
  const nextMonthBtn = document.getElementById("walkinNextMonth");
  const dateTabBtn = document.getElementById("walkinDateTab");
  const dateTabLabel = document.getElementById("walkinDateLabel");
  const calendarWrap = document.getElementById("walkinCalendarWrap");

  const formatDateLabel = (dateStr) => {
    if (!dateStr) return "Pick a date";
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  };

  const setCalendarOpen = (open) => {
    if (!calendarWrap || !dateTabBtn) return;
    calendarWrap.classList.toggle("hidden", !open);
    dateTabBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  dateTabBtn?.addEventListener("click", () => {
    const isOpen = dateTabBtn.getAttribute("aria-expanded") === "true";
    setCalendarOpen(!isOpen);
  });

  const loadHours = async () => {
    const courtId = courtSelect.value;
    const dateVal = dateInput.value;
    if (hoursHint) {
      if (!courtId) hoursHint.textContent = "— select a court first";
      else if (!dateVal) hoursHint.textContent = "— select a date first";
      else hoursHint.textContent = "";
    }
    if (!courtId || !dateVal) {
      hoursContainer.innerHTML = "";
      return;
    }
    hoursContainer.innerHTML = "<em>Loading…</em>";
    try {
      const court = courts.find((c) => c._id === courtId);
      const sportType = court?.courtType;
      const data = await api.availability(sportType, dateVal, 1);
      const selectedCourt = (data.courts || []).find((c) => String(c._id) === courtId);
      const availableHours = selectedCourt?.availableHours || [];
      walkinState.availabilityByDate[dateVal] = availableHours;
      walkinState.selectedHours = [];

      hoursContainer.innerHTML = "";
      if (availableHours.length === 0) {
        hoursContainer.innerHTML = "<em>No available hours on this date.</em>";
        return;
      }

      for (let h = 7; h < 21; h++) {
        const isAvail = availableHours.includes(h);
        const item = document.createElement("div");
        item.className = "calendly-timeslot-btn";
        item.textContent = `${h}:00 - ${h + 1}:00`;
        if (!isAvail) {
          item.classList.add("reserved");
          item.style.opacity = "0.5";
        } else {
          item.addEventListener("click", () => {
            const idx = walkinState.selectedHours.indexOf(h);
            if (idx === -1) {
              walkinState.selectedHours.push(h);
              item.classList.add("selected");
            } else {
              walkinState.selectedHours.splice(idx, 1);
              item.classList.remove("selected");
            }
          });
        }
        hoursContainer.appendChild(item);
      }
    } catch (err) {
      hoursContainer.innerHTML = `<em style="color:rgba(220,53,69,0.9);">Failed to load hours: ${err.message}</em>`;
    }
  };

  const renderWalkinCalendar = () => {
    if (!calendarGrid || !currentMonthYear) return;
    const firstDay = new Date(walkinState.currentYear, walkinState.currentMonth, 1);
    const lastDay = new Date(walkinState.currentYear, walkinState.currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    currentMonthYear.textContent = `${monthNames[walkinState.currentMonth]} ${walkinState.currentYear}`;
    calendarGrid.innerHTML = "";

    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((day) => {
      const header = document.createElement("div");
      header.className = "calendar-day-header";
      header.textContent = day;
      calendarGrid.appendChild(header);
    });

    for (let i = 0; i < startingDayOfWeek; i++) {
      const empty = document.createElement("div");
      empty.className = "calendar-day empty";
      calendarGrid.appendChild(empty);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(walkinState.currentYear, walkinState.currentMonth, day);
      const dateOnly = new Date(date);
      dateOnly.setHours(0, 0, 0, 0);
      const el = document.createElement("div");
      el.className = "calendar-day";
      el.textContent = day;
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isPast = dateOnly < today;
      const isSelected = dateInput.value === dateStr;
      if (isPast) el.classList.add("disabled", "past");
      if (isSelected) el.classList.add("selected");
      if (!isPast) {
        el.addEventListener("click", () => {
          dateInput.value = dateStr;
          // Sync calendar month state so it doesn't snap back if user reopens
          walkinState.currentMonth = date.getMonth();
          walkinState.currentYear = date.getFullYear();
          // Update the date-tab label and collapse the calendar
          if (dateTabLabel) dateTabLabel.textContent = formatDateLabel(dateStr);
          setCalendarOpen(false);
          renderWalkinCalendar();
          loadHours();
        });
      }
      calendarGrid.appendChild(el);
    }
  };

  prevMonthBtn?.addEventListener("click", () => {
    if (walkinState.currentMonth === 0) {
      walkinState.currentMonth = 11;
      walkinState.currentYear -= 1;
    } else {
      walkinState.currentMonth -= 1;
    }
    renderWalkinCalendar();
  });
  nextMonthBtn?.addEventListener("click", () => {
    if (walkinState.currentMonth === 11) {
      walkinState.currentMonth = 0;
      walkinState.currentYear += 1;
    } else {
      walkinState.currentMonth += 1;
    }
    renderWalkinCalendar();
  });

  courtSelect.addEventListener("change", loadHours);
  dateInput.addEventListener("change", () => {
    renderWalkinCalendar();
    loadHours();
  });

  // Start with no date pre-selected — user must explicitly pick one
  dateInput.value = "";
  if (dateTabLabel) dateTabLabel.textContent = "Pick a date";
  setCalendarOpen(false);
  renderWalkinCalendar();
  if (hoursHint) hoursHint.textContent = "— select a date first";

  // Form submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const walkInName = walkinNameInput.value.trim();
    if (!walkInName) {
      alert("Enter the walk-in customer name.");
      return;
    }

    const courtId = courtSelect.value;
    const dateVal = dateInput.value;
    const notes = document.getElementById("walkinNotes").value.trim();
    if (!courtId || !dateVal) {
      alert("Select a court and date.");
      return;
    }

    const checkedHours = [...walkinState.selectedHours].sort((a, b) => a - b);
    if (checkedHours.length === 0) {
      alert("Select at least one hour.");
      return;
    }

    // Group consecutive hours into booking ranges
    const ranges = [];
    let rangeStart = checkedHours[0];
    let prev = checkedHours[0];
    for (let i = 1; i <= checkedHours.length; i++) {
      if (i === checkedHours.length || checkedHours[i] !== prev + 1) {
        ranges.push([rangeStart, prev + 1]);
        if (i < checkedHours.length) {
          rangeStart = checkedHours[i];
          prev = checkedHours[i];
        }
      } else {
        prev = checkedHours[i];
      }
    }

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating…";

    try {
      for (const [startHr, endHr] of ranges) {
        const startTime = new Date(`${dateVal}T${String(startHr).padStart(2, "0")}:00:00`);
        const endTime = new Date(`${dateVal}T${String(endHr).padStart(2, "0")}:00:00`);
        await api.createWalkInReservation({
          walkInName,
          courtId,
          bookingDate: startTime.toISOString(),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          notes: notes || undefined,
        });
      }
      alert(`Walk-in reservation created for ${walkInName}.`);
      form.reset();
      hoursContainer.innerHTML = "";
      walkinState.selectedHours = [];
      dateInput.value = "";
      if (dateTabLabel) dateTabLabel.textContent = "Pick a date";
      setCalendarOpen(false);
      if (hoursHint) hoursHint.textContent = "— select a date first";
      renderWalkinCalendar();
      await loadDashboard();
    } catch (err) {
      alert(err.message || "Failed to create walk-in reservation");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Walk-In Reservation";
    }
  });
};

// ─── Dashboard loader ─────────────────────────────────────────────────────────

let _allCourts = [];

const loadDashboard = async () => {
  try {
    const [data, courts, allReservations] = await Promise.all([
      api.dashboard(),
      api.courts(),
      api.listReservations(),
    ]);
    _allCourts = courts;
    renderCourts(data.courtCounts);
    _latestReservations = allReservations || [];
    applyReservationFilters();
    renderStats(data.todayBookings || [], allReservations || []);
    // For the timeline we need availability info (availableHoursByDate) per court
    // Fetch availability for today's date so extend modal can check free hours
    let courtsWithAvail = courts;
    try {
      const today = new Date().toISOString().split("T")[0];
      if (courts.length > 0) {
        const sportTypes = [...new Set(courts.map((c) => c.courtType))];
        const availResults = await Promise.all(
          sportTypes.map((s) => api.availability(s, today, 1).catch(() => ({ courts: [] })))
        );
        const availMap = {};
        availResults.forEach((r) => {
          (r.courts || []).forEach((c) => { availMap[String(c._id)] = c; });
        });
        courtsWithAvail = courts.map((c) => ({ ...c, ...(availMap[String(c._id)] || {}) }));
      }
    } catch (_) {}
    // Cache for on-demand modal render
    _latestTimelineData = {
      courts,
      bookings: data.todayBookings || [],
      courtsWithAvail,
    };
  } catch (error) {
    alert(`Dashboard unavailable: ${error.message}`);
  }
};

const openTimelineModal = () => {
  const wrap = document.createElement("div");

  const header = document.createElement("div");
  header.className = "timeline-modal-header";
  const headerLeft = document.createElement("div");
  const h3 = document.createElement("h3");
  h3.textContent = "Today's Timeline";
  const sub = document.createElement("p");
  sub.className = "muted";
  sub.textContent = "Click any block for details, partial cancel, or extend.";
  sub.style.margin = "0";
  headerLeft.appendChild(h3);
  headerLeft.appendChild(sub);

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `
    <span><span class="legend-dot" style="background:rgba(255,193,7,0.6);"></span>Pending</span>
    <span><span class="legend-dot" style="background:rgba(242,92,5,0.6);"></span>Confirmed</span>
    <span><span class="legend-dot" style="background:rgba(40,167,69,0.7);"></span>Checked In</span>
    <span><span class="legend-dot" style="background:rgba(108,117,125,0.7);"></span>Completed</span>
  `;
  header.appendChild(headerLeft);
  header.appendChild(legend);
  wrap.appendChild(header);

  const body = document.createElement("div");
  body.className = "timeline-modal-body";
  wrap.appendChild(body);

  const modal = openModal(wrap);
  modal.box.classList.add("timeline-modal-box");

  const { courts, bookings, courtsWithAvail } = _latestTimelineData;
  renderTimeline(courts, bookings, courtsWithAvail, body);
};

// ─── Init ──────────────────────────────────────────────────────────────────────

const initForms = (courts) => {
  const maintenanceStartInput = document.getElementById("maintenanceStart");
  const maintenanceEndInput = document.getElementById("maintenanceEnd");

  const updateMinDateTime = () => {
    const now = new Date();
    const min = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    maintenanceStartInput.setAttribute("min", min);
    maintenanceEndInput.setAttribute("min", min);
  };

  updateMinDateTime();
  setInterval(updateMinDateTime, 60000);

  elements.maintenanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const startTime = new Date(document.getElementById("maintenanceStart").value);
    const endTime = new Date(document.getElementById("maintenanceEnd").value);
    const now = new Date();
    if (startTime < now) { alert("Start time cannot be in the past."); return; }
    if (endTime <= startTime) { alert("End time must be after start time."); return; }
    try {
      await api.createMaintenance({
        courtId: document.getElementById("maintenanceCourtId").value,
        startTime,
        endTime,
        remarks: document.getElementById("maintenanceRemarks").value,
      });
      event.target.reset();
      updateMinDateTime();
      await loadDashboard();
      alert("Maintenance scheduled!");
    } catch (error) {
      alert(error.message);
    }
  });

  elements.adminLogout.addEventListener("click", async () => {
    await api.logout();
    window.location.href = "./index.html";
  });

  initWalkinForm(courts);
};

const initRealtime = () => {
  socket.on("dashboardRefresh", loadDashboard);
  socket.on("reservationUpdated", loadDashboard);
  socket.on("maintenanceUpdated", loadDashboard);
};

const initReservationTabs = () => {
  if (!elements.reservationsTabUnpaid || !elements.reservationsTabPaid) return;
  const showTab = (tab) => {
    const isUnpaid = tab === "unpaid";
    elements.todayReservations?.classList.toggle("hidden", !isUnpaid);
    elements.paidReservations?.classList.toggle("hidden", isUnpaid);
    elements.reservationsTabUnpaid.classList.toggle("active", isUnpaid);
    elements.reservationsTabPaid.classList.toggle("active", !isUnpaid);
  };
  elements.reservationsTabUnpaid.addEventListener("click", () => showTab("unpaid"));
  elements.reservationsTabPaid.addEventListener("click", () => showTab("paid"));
  showTab("unpaid");
};

const ensureAdmin = async () => {
  try {
    const profile = await api.profile();
    if (!profile || (profile.role !== "admin" && profile.role !== "staff")) throw new Error("Unauthorized");
    currentUser = profile;
  } catch (error) {
    alert("Admin access required. Redirecting to home.");
    window.location.href = "./index.html";
    throw error;
  }
};

const initialize = async () => {
  await ensureAdmin();
  setTodayLabel();

  initReservationFilters();

  let courts = [];
  try {
    courts = await api.courts();
    const maintSelect = document.getElementById("maintenanceCourtId");
    if (maintSelect) {
      maintSelect.innerHTML = '<option value="">Select a court</option>';
      courts.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c._id;
        opt.textContent = `${c.courtName} · ${c.location || ""}`;
        maintSelect.appendChild(opt);
      });
    }
  } catch (_) {}

  initForms(courts);
  initReservationTabs();
  initRealtime();
  await loadDashboard();
};

initialize();
