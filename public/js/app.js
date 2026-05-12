import { api } from "./api.js";

const socket = io();

const state = {
  user: null,
  courts: [],
  availability: { courts: [], bookings: [], maintenance: [] },
  selectedDate: null,
  selectedSlots: [], // Array of hour numbers (7-20)
  slotHolds: {}, // map hour -> holdId
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
};

const elements = {};
// Used to run an action (like finalizing a booking) immediately after a user logs in
let pendingPostLoginAction = null;

const bindElements = () => {
  Object.assign(elements, {
    bookingSection: document.getElementById("bookingSection"),
    dateInput: document.getElementById("dateInput"),
    startTimeInput: document.getElementById("startTimeInput"),
    endTimeInput: document.getElementById("endTimeInput"),
    courtSelect: document.getElementById("courtSelect"),
    sportSelect: document.getElementById("sportSelect"),
    bookingForm: document.getElementById("bookingForm"),
    availabilityGrid: document.getElementById("availabilityGrid"),
    courtStatusCards: document.getElementById("courtStatusCards"),
    hoursSummary: document.getElementById("hoursSummary"),
    totalSummary: document.getElementById("totalSummary"),
    authModal: document.getElementById("authModal"),
    loginButton: document.getElementById("loginButton"),
    heroBookBtn: document.getElementById("heroBookBtn"),
    closeAuthModal: document.getElementById("closeAuthModal"),
    authForm: document.getElementById("authForm"),
    switchAuthMode: document.getElementById("switchAuthMode"),
    authModeInput: document.getElementById("authMode"),
    modalTitle: document.getElementById("modalTitle"),
    authSubmit: document.getElementById("authSubmit"),
    adminLink: document.getElementById("adminLink"),
    yourReservationsSection: document.getElementById("yourReservationsSection"),
    reservationsList: document.getElementById("reservationsList"),
    reservationsCount: document.getElementById("reservationsCount"),
    todayMaintenance: document.getElementById("todayMaintenance"),
    maintenanceList: document.getElementById("maintenanceList"),
    navBookLink: document.getElementById("navBookLink"),
    heroVideo: document.getElementById("heroVideo"),
    calendarGrid: document.getElementById("calendarGrid"),
    currentMonthYear: document.getElementById("currentMonthYear"),
    prevMonth: document.getElementById("prevMonth"),
    nextMonth: document.getElementById("nextMonth"),
    timeSlotsGrid: document.getElementById("timeSlotsGrid"),
    selectedSlotsList: document.getElementById("selectedSlotsList"),
    selectedSlotsCount: document.getElementById("selectedSlotsCount"),
    confirmBookingBtn: document.getElementById("confirmBookingBtn"),
  });
};

const registerImageFallbacks = () => {
  const images = document.querySelectorAll("img[data-fallback]");
  images.forEach((img) => {
    const fallbackSrc = img.dataset.fallback;
    if (!fallbackSrc) return;

    img.addEventListener("error", () => {
      if (img.dataset.fallbackApplied === "true") return;
      img.dataset.fallbackApplied = "true";
      img.src = fallbackSrc;
    });
  });
};

const initHeroVideo = () => {
  if (!elements.heroVideo) return;
  elements.heroVideo.addEventListener("error", () => {
    elements.heroVideo.classList.add("is-hidden");
  });
};

const formatCurrency = (value) => `₱${Number(value || 0).toLocaleString("en-PH")}`;

const formatHourLabel = (hour) => {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = ((hour + 11) % 12) + 1;
  return `${displayHour}:00 ${ampm}`;
};

const openCustomerPartialCancelModal = (booking) =>
  new Promise((resolve) => {
    const startHour = new Date(booking.startTime).getHours();
    const endHour = new Date(booking.endTime).getHours();
    const cancelledHours = booking.cancelledHours || [];
    const activeHours = [];
    for (let h = startHour; h < endHour; h++) {
      if (!cancelledHours.includes(h)) activeHours.push(h);
    }

    if (activeHours.length <= 1) {
      resolve([]);
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    const box = document.createElement("div");
    box.className = "modal-box visible";
    box.innerHTML = `
      <h4>Cancel Selected Hours</h4>
      <p style="margin-bottom:10px;">Pick hour(s) to remove from this booking.</p>
      <div id="partialCancelHours" style="display:flex;flex-direction:column;gap:8px;max-height:220px;overflow:auto;"></div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="partialCancelConfirm" class="btn btn-outline">Cancel Selected</button>
        <button id="partialCancelAll" class="btn btn-primary">Cancel Entire Booking</button>
        <button id="partialCancelClose" class="btn">Close</button>
      </div>
    `;
    const list = box.querySelector("#partialCancelHours");
    activeHours.forEach((h) => {
      const lbl = document.createElement("label");
      lbl.style.cssText = "display:flex;align-items:center;gap:8px;";
      lbl.innerHTML = `<input type="checkbox" value="${h}" /> ${formatHourLabel(h)} - ${formatHourLabel(h + 1)}`;
      list.appendChild(lbl);
    });
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    box.querySelector("#partialCancelClose")?.addEventListener("click", () => {
      close();
      resolve(null);
    });
    box.querySelector("#partialCancelAll")?.addEventListener("click", () => {
      close();
      resolve([]);
    });
    box.querySelector("#partialCancelConfirm")?.addEventListener("click", () => {
      const selected = [...box.querySelectorAll("input:checked")].map((el) => Number(el.value));
      if (selected.length === 0) {
        alert("Select at least one hour, or cancel entire booking.");
        return;
      }
      close();
      resolve(selected);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close();
        resolve(null);
      }
    });
  });

const releaseAllHolds = async () => {
  try {
    const holds = { ...(state.slotHolds || {}) };
    for (const hourStr of Object.keys(holds)) {
      const holdId = holds[hourStr];
      try {
        await api.releaseHold(holdId);
      } catch (_) {
        // ignore
      }
    }
  } finally {
    state.slotHolds = {};
    state.selectedSlots = [];
    renderTimeSlots();
    calculateSummary();
    updateConfirmButton();
  }
};

// Group an array of hour integers into continuous ranges
// Example: [10,11,14] -> [[10,12],[14,15]] where end is exclusive
const groupSlotsToRanges = (slots) => {
  if (!slots || slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a - b);
  const groups = [];
  let start = sorted[0];
  let end = start + 1;
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i];
    if (h === end) {
      // consecutive
      end = h + 1;
    } else {
      groups.push([start, end]);
      start = h;
      end = h + 1;
    }
  }
  groups.push([start, end]);
  return groups;
};

const initDatePicker = () => {
  // Calendar will handle date selection
  if (elements.dateInput) {
    const today = new Date().toISOString().split("T")[0];
    elements.dateInput.min = today;
    elements.dateInput.value = today;
  }
};

const toggleModal = (show = true) => {
  if (!elements.authModal) return;
  if (show) showModalElement(elements.authModal);
  else hideModalElement(elements.authModal);
};

// Generic helpers to show/hide modals with animations
const showModalElement = (el) => {
  if (!el) return;
  el.classList.remove('hidden');
  // allow browser to apply layout, then add visible for transition
  requestAnimationFrame(() => {
    el.classList.add('visible');
    el.querySelector('.modal-content')?.classList.add('visible');
    el.querySelector('.modal-box')?.classList.add('visible');
  });
};

const hideModalElement = (el) => {
  if (!el) return;
  // start closing animation
  el.classList.add('closing');
  el.classList.remove('visible');
  el.querySelector('.modal-content')?.classList.remove('visible');
  el.querySelector('.modal-box')?.classList.remove('visible');
  // after animation, hide element and cleanup classes
  setTimeout(() => {
    el.classList.remove('closing');
    el.classList.add('hidden');
  }, 260);
};

const setAuthMode = (mode) => {
  elements.authModeInput.value = mode;
  elements.modalTitle.textContent = mode === "signup" ? "Create Account" : "Sign In";
  elements.authSubmit.textContent = mode === "signup" ? "Create Account" : "Sign In";
  document.querySelectorAll("[data-mode]").forEach((group) => {
    group.classList.toggle("hidden", group.dataset.mode !== mode);
  });
};

const calculateSummary = () => {
  // Use selected slots if available, otherwise fall back to time inputs
  if (state.selectedSlots.length > 0) {
    const hours = state.selectedSlots.length;
    const total = hours * 150;
    elements.hoursSummary.textContent = `${hours} hour${hours !== 1 ? "s" : ""}`;
    elements.totalSummary.textContent = formatCurrency(total);
    updateSelectedSlotsDisplay();
    if (state.selectedDate && elements.summaryDate) {
      elements.summaryDate.textContent = `Date: ${state.selectedDate}`;
    }
    return;
  }
  // Fallback to time inputs for backward compatibility
  if (elements.startTimeInput && elements.endTimeInput) {
    const start = elements.startTimeInput.value;
    const end = elements.endTimeInput.value;
    if (!start || !end) return;
    const [startHour] = start.split(":").map(Number);
    const [endHour] = end.split(":").map(Number);
    const hours = Math.max(endHour - startHour, 0);
    const total = hours * 150;
    elements.hoursSummary.textContent = `${hours} hour${hours !== 1 ? "s" : ""}`;
    elements.totalSummary.textContent = formatCurrency(total);
    if (state.selectedDate && elements.summaryDate) {
      elements.summaryDate.textContent = `Date: ${state.selectedDate}`;
    }
  }
};

const renderCalendar = () => {
  if (!elements.calendarGrid) return;
  
  const firstDay = new Date(state.currentYear, state.currentMonth, 1);
  const lastDay = new Date(state.currentYear, state.currentMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();
  
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  
  elements.currentMonthYear.textContent = `${monthNames[state.currentMonth]} ${state.currentYear}`;
  
  elements.calendarGrid.innerHTML = "";
  
  // Day headers
  const dayHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  dayHeaders.forEach(day => {
    const header = document.createElement("div");
    header.className = "calendar-day-header";
    header.textContent = day;
    elements.calendarGrid.appendChild(header);
  });
  
  // Empty cells for days before month starts
  for (let i = 0; i < startingDayOfWeek; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day empty";
    elements.calendarGrid.appendChild(empty);
  }
  
  // Days of the month
  const today = new Date();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(state.currentYear, state.currentMonth, day);
    const dayElement = document.createElement("div");
    dayElement.className = "calendar-day";
    
    const isToday = date.toDateString() === today.toDateString();
    const isPast = date < today && !isToday;
    const isSelected = state.selectedDate && 
      date.toDateString() === new Date(state.selectedDate).toDateString();
    
    if (isToday) dayElement.classList.add("today");
    if (isPast) dayElement.classList.add("past");
    if (isSelected) dayElement.classList.add("selected");
    if (isPast) dayElement.classList.add("disabled");
    
    dayElement.textContent = day;
    dayElement.dataset.date = date.toISOString().split("T")[0];
    
    if (!isPast) {
      dayElement.addEventListener("click", () => selectDate(date));
    }
    
    elements.calendarGrid.appendChild(dayElement);
  }
};

const selectDate = (date) => {
  state.selectedDate = date.toISOString().split("T")[0];
  // release any existing holds when date changes
  releaseAllHolds();
  state.selectedSlots = []; // Clear slots when date changes
  renderCalendar();
  renderTimeSlots();
  calculateSummary();
  updateConfirmButton();
  // Fetch availability for the selected date if sport is selected
  if (elements.sportSelect.value) {
    fetchAvailability();
  }
};

const renderTimeSlots = () => {
  if (!elements.timeSlotsGrid || !state.selectedDate || !elements.courtSelect.value) {
    if (elements.timeSlotsGrid) {
      elements.timeSlotsGrid.innerHTML = "<p class='no-selection-hint'>Select a date and court to see available time slots.</p>";
    }
    return;
  }
  
  const selectedCourtId = elements.courtSelect.value;
  const { bookings, maintenance } = state.availability;
  const selectedDate = new Date(state.selectedDate);
  
  elements.timeSlotsGrid.innerHTML = "";
  
  // Generate time slots from 7 AM to 9 PM (7-21)
  for (let hour = 7; hour < 21; hour++) {
    const slotStart = new Date(selectedDate);
    slotStart.setHours(hour, 0, 0, 0);
    const slotEnd = new Date(selectedDate);
    slotEnd.setHours(hour + 1, 0, 0, 0);
    
    // Check if slot is booked
      // Prefer server-provided per-hour availability if present
      let isBooked = false;
      let isMaintenance = false;
      const courtObj = (state.availability.courts || []).find(c => String(c._id) === String(selectedCourtId));
      if (courtObj && Array.isArray(courtObj.availableHours)) {
        // if availableHours provided, consider slot available only if hour is included
        const available = courtObj.availableHours.includes(hour);
        if (!available) {
          // slot is not available; determine whether booking or maintenance caused it by checking server lists
          isBooked = bookings.some((booking) => {
            const bookingCourtId = booking.court && booking.court._id ? booking.court._id : booking.court;
            if (String(bookingCourtId) !== selectedCourtId) return false;
            const start = new Date(booking.startTime);
            const end = new Date(booking.endTime);
            return start < slotEnd && end > slotStart;
          });
          isMaintenance = maintenance.some((record) => {
            const recordCourtId = record.court && record.court._id ? record.court._id : record.court;
            if (String(recordCourtId) !== selectedCourtId) return false;
            const start = new Date(record.startTime);
            const end = new Date(record.endTime);
            return start < slotEnd && end > slotStart;
          });
          // if neither booking nor maintenance detected, mark as reserved as fallback
          if (!isBooked && !isMaintenance) isBooked = true;
        }
      } else {
        // Fallback to previous client-side overlap checks
        isBooked = bookings.some((booking) => {
          const bookingCourtId = booking.court && booking.court._id ? booking.court._id : booking.court;
          if (String(bookingCourtId) !== selectedCourtId) return false;
          const start = new Date(booking.startTime);
          const end = new Date(booking.endTime);
          return start < slotEnd && end > slotStart;
        });
        isMaintenance = maintenance.some((record) => {
          const recordCourtId = record.court && record.court._id ? record.court._id : record.court;
          if (String(recordCourtId) !== selectedCourtId) return false;
          const start = new Date(record.startTime);
          const end = new Date(record.endTime);
          return start < slotEnd && end > slotStart;
        });
      }
    
    const isSelected = state.selectedSlots.includes(hour);
    const isPast = slotStart < new Date();
    
    // Render slot as selectable item (button-like) instead of checkbox
    const slotContainer = document.createElement("div");
    slotContainer.className = "time-slot-item";
    slotContainer.setAttribute('role', 'button');
    slotContainer.setAttribute('tabindex', isPast || isBooked || isMaintenance ? '-1' : '0');
    slotContainer.dataset.hour = hour;
    // Use AM/PM format
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = ((hour + 11) % 12) + 1; // 12-hour format
    slotContainer.textContent = `${displayHour}:00 ${ampm}`;

    if (isPast) {
      slotContainer.classList.add("past");
      slotContainer.setAttribute('aria-disabled', 'true');
      slotContainer.dataset.reason = 'past';
      slotContainer.title = 'Select present date';
    }
    if (isBooked) {
      slotContainer.classList.add("reserved");
      slotContainer.setAttribute('aria-disabled', 'true');
      slotContainer.dataset.reason = 'booked';
      slotContainer.title = 'This time is already booked (DB)';
    }
    if (isMaintenance) {
      slotContainer.classList.add("maintenance");
      slotContainer.setAttribute('aria-disabled', 'true');
      slotContainer.dataset.reason = 'maintenance';
      slotContainer.title = 'This time is under maintenance';
    }
    if (isSelected) {
      slotContainer.classList.add("selected");
    }

    // Click or keyboard activates selection
    const activateSlot = (e) => {
      // If blocked, log reason for debugging and show tooltip
      if (isPast || isBooked || isMaintenance) {
        const reason = slotContainer.dataset.reason || (isPast ? 'past' : isBooked ? 'booked' : isMaintenance ? 'maintenance' : 'unavailable');
        console.warn('Slot blocked:', { hour, court: selectedCourtId, reason });
        // briefly flash the slot to indicate blocked
        slotContainer.classList.add('flash-blocked');
        setTimeout(() => slotContainer.classList.remove('flash-blocked'), 400);
        return;
      }
      e.preventDefault();
      toggleTimeSlot(hour);
      slotContainer.focus();
    };

    slotContainer.addEventListener('click', activateSlot);
    slotContainer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') activateSlot(e);
    });

    elements.timeSlotsGrid.appendChild(slotContainer);
  }
};

const toggleTimeSlot = (hour) => {
  (async () => {
    const index = state.selectedSlots.indexOf(hour);
    const courtId = elements.courtSelect?.value;
    if (!courtId || !state.selectedDate) return;

    if (index > -1) {
      // Deselect slot: release hold if exists
      const holdId = state.slotHolds && state.slotHolds[hour];
      if (holdId) {
        try {
          await api.releaseHold(holdId);
        } catch (err) {
          console.warn('Failed to release hold', err.message || err);
        }
        delete state.slotHolds[hour];
      }
      state.selectedSlots.splice(index, 1);
    } else {
      // If user not logged in, allow local selection so clicks always work.
      // Final booking will still require authentication and server-side checks.
      if (!state.user) {
        state.selectedSlots.push(hour);
      } else {
        // Select slot - create a temporary hold on the server for logged-in users
        // Create dates in local timezone to avoid UTC conversion issues
        const dateStr = state.selectedDate; // Format: YYYY-MM-DD
        const [year, month, day] = dateStr.split('-').map(Number);
        const startTime = new Date(year, month - 1, day, hour, 0, 0);
        const endTime = new Date(year, month - 1, day, hour + 1, 0, 0);
        try {
          const hold = await api.holdReservation({ 
            courtId, 
            startTime: startTime.toISOString(), 
            endTime: endTime.toISOString(), 
            ttlMinutes: 10 
          });
          if (hold && hold._id) {
            state.slotHolds[hour] = hold._id;
            state.selectedSlots.push(hour);
          } else {
            alert('Failed to reserve slot. Try another slot.');
          }
        } catch (err) {
          alert(err.message || 'Failed to reserve slot.');
          return;
        }
      }
    }

    renderTimeSlots();
    calculateSummary();
    updateConfirmButton();
  })();
};

const updateSelectedSlotsDisplay = () => {
  if (!elements.selectedSlotsList || !elements.selectedSlotsCount) return;
  
  if (state.selectedSlots.length === 0) {
    elements.selectedSlotsList.innerHTML = "<p class='no-selection'>No time slots selected</p>";
    elements.selectedSlotsCount.textContent = "0 slots";
    return;
  }
  const sorted = [...state.selectedSlots].sort((a, b) => a - b);
  elements.selectedSlotsCount.textContent = `${sorted.length} slot${sorted.length !== 1 ? "s" : ""}`;

  elements.selectedSlotsList.innerHTML = "";
  const groups = groupSlotsToRanges(sorted);
  groups.forEach(([s, e]) => {
    const slotItem = document.createElement("div");
    slotItem.className = "selected-slot-item";
    const startLabel = formatHourLabel(s);
    const endLabel = formatHourLabel(e);
    slotItem.textContent = `${startLabel} - ${endLabel}`;
    elements.selectedSlotsList.appendChild(slotItem);
  });
};

const updateConfirmButton = () => {
  if (!elements.confirmBookingBtn) return;
  const canBook = state.selectedDate && 
                  state.selectedSlots.length > 0 && 
                  elements.courtSelect.value && 
                  elements.sportSelect.value;
  elements.confirmBookingBtn.disabled = !canBook;
};

const fetchCourts = async () => {
  try {
    const courts = await api.courts();
    state.courts = courts;
    populateCourtSelect();
    // Bind court cards after DOM is ready
    setTimeout(() => bindCourtCards(), 100);
    return courts;
  } catch (error) {
    console.error(error.message);
    return [];
  }
};

const populateCourtSelect = () => {
  if (!elements.courtSelect || !elements.sportSelect) return;
  const sport = elements.sportSelect.value;
  const prevSelection = elements.courtSelect.value;
  const filtered = state.courts.filter((court) => court.courtType === sport);

  elements.courtSelect.innerHTML = "";
  if (!sport) {
    elements.courtSelect.innerHTML = "<option value=''>Select a sport first</option>";
    elements.courtSelect.disabled = true;
    elements.courtSelect.style.pointerEvents = "none";
    elements.courtSelect.style.opacity = "0.6";
    return;
  }

  elements.courtSelect.disabled = false;
  elements.courtSelect.style.pointerEvents = "auto";
  elements.courtSelect.style.opacity = "1";
  elements.courtSelect.innerHTML = "<option value=''>Select a court</option>";
  filtered.forEach((court) => {
    const option = document.createElement("option");
    option.value = court._id;
    option.textContent = `${court.courtName} · ${court.location}`;
    elements.courtSelect.appendChild(option);
  });

  // If previous court selection still exists in filtered results, keep it selected
  if (prevSelection) {
    const exists = filtered.some((c) => String(c._id) === String(prevSelection));
    if (exists) {
      elements.courtSelect.value = prevSelection;
    }
  }

  updateConfirmButton();
};

const buildAvailabilityGrid = () => {
  const selectedCourtId = elements.courtSelect.value;
  if (!selectedCourtId) {
    elements.availabilityGrid.innerHTML = "<p>Select a court to see availability.</p>";
    return;
  }

  const hours = Array.from({ length: 14 }, (_, index) => 7 + index);
  const baseDate = new Date(elements.dateInput.value);
  if (Number.isNaN(baseDate.getTime())) {
    elements.availabilityGrid.innerHTML = "<p>Choose a date to view availability.</p>";
    return;
  }

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + index);
    return date;
  });

  const { bookings, maintenance } = state.availability;

  const formatDay = (date) =>
    date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  const buildCellStatus = (day, hour) => {
    const slotStart = new Date(day);
    slotStart.setHours(hour, 0, 0, 0);
    const slotEnd = new Date(day);
    slotEnd.setHours(hour + 1, 0, 0, 0);

    const hasMaintenance = maintenance.some((record) => {
      const recordCourtId = record.court && record.court._id ? record.court._id : record.court;
      if (String(recordCourtId) !== selectedCourtId) return false;
      const start = new Date(record.startTime);
      const end = new Date(record.endTime);
      return start < slotEnd && end > slotStart;
    });

    if (hasMaintenance) return "maintenance";

    const hasBooking = bookings.some((booking) => {
      const bookingCourtId = booking.court && booking.court._id ? booking.court._id : booking.court;
      if (String(bookingCourtId) !== selectedCourtId) return false;
      const start = new Date(booking.startTime);
      const end = new Date(booking.endTime);
      return start < slotEnd && end > slotStart;
    });

    if (hasBooking) return "reserved";
    return "available";
  };

  const tableFragment = document.createDocumentFragment();

  // Header row
  const timeHeader = document.createElement("div");
  timeHeader.className = "header-cell";
  timeHeader.textContent = "Time";
  tableFragment.appendChild(timeHeader);

  days.forEach((day) => {
    const dayCell = document.createElement("div");
    dayCell.className = "header-cell";
    dayCell.textContent = formatDay(day);
    tableFragment.appendChild(dayCell);
  });

  hours.forEach((hour) => {
    const timeCell = document.createElement("div");
    timeCell.className = "time-cell";
    const label = `${hour.toString().padStart(2, "0")}:00`;
    timeCell.textContent = label;
    tableFragment.appendChild(timeCell);

    days.forEach((day) => {
      const status = buildCellStatus(day, hour);
      const cell = document.createElement("div");
      cell.className = `slot ${status}`;
      cell.textContent = status === "available" ? "Open" : status === "reserved" ? "Booked" : "Maint.";
      tableFragment.appendChild(cell);
    });
  });

  elements.availabilityGrid.innerHTML = "";
  elements.availabilityGrid.appendChild(tableFragment);
};

const fetchAvailability = async () => {
  try {
    const sport = elements.sportSelect.value;
    // Use selected date from calendar, or fallback to dateInput, or today
    const date = state.selectedDate || 
                 (elements.dateInput && elements.dateInput.value) || 
                 new Date().toISOString().split("T")[0];
    
    if (!sport || !date) return;

    const availability = await api.availability(sport, date, 7);
    state.availability = availability;
    updateHeroStats();
    renderCourtStatusCards();
    renderTimeSlots(); // Update time slots when availability changes
    // release any stale holds if availability changed (holds may block newly booked slots)
    // (best-effort cleanup)
    // Note: we don't await here; just attempt best-effort release for holds that conflict
    Object.entries(state.slotHolds || {}).forEach(([hour, holdId]) => {
      const h = Number(hour);
      const courtObj = (state.availability.courts || []).find(c => String(c._id) === String(elements.courtSelect?.value));
      const available = courtObj && Array.isArray(courtObj.availableHours) ? courtObj.availableHours.includes(h) : true;
      if (!available) {
        api.releaseHold(holdId).catch(() => {});
        delete state.slotHolds[hour];
        const idx = state.selectedSlots.indexOf(h);
        if (idx > -1) state.selectedSlots.splice(idx, 1);
      }
    });
  } catch (error) {
    console.error(error.message);
  }
};

const updateHeroStats = () => {
  // Always show reservations section, but show different content based on login status
  if (!state.user) {
    // Show login prompt for non-logged-in users
    if (elements.reservationsList) {
      elements.reservationsList.innerHTML = "<p class='no-reservations' style='text-align: center; padding: 24px; opacity: 0.6;'>Log in to view your reservations</p>";
    }
    if (elements.reservationsCount) {
      elements.reservationsCount.textContent = "";
    }
  } else {
    // Show reservations for logged-in users
    loadUserReservations();
  }
};

let _reservationsTickTimer = null;
const startReservationsAutoExpire = () => {
  if (_reservationsTickTimer) return;
  _reservationsTickTimer = setInterval(() => {
    if (state.user) loadUserReservations();
  }, 60 * 1000);
};
startReservationsAutoExpire();

const loadUserReservations = async () => {
  if (!state.user || !elements.reservationsList) return;
  
  try {
    const reservations = await api.listReservations();
    const now = new Date();

    const upcoming = reservations
      .filter(booking => {
        const endTime = new Date(booking.endTime);
        return endTime > now && booking.status !== "cancelled";
      })
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    
    if (elements.reservationsCount) {
      elements.reservationsCount.textContent = `${upcoming.length} booking${upcoming.length !== 1 ? "s" : ""}`;
    }
    
    if (upcoming.length === 0) {
      elements.reservationsList.innerHTML = "<p class='no-reservations' style='text-align: center; padding: 24px; opacity: 0.6;'>No upcoming reservations</p>";
      return;
    }
    
    elements.reservationsList.innerHTML = "";
    upcoming.forEach(booking => {
      const item = document.createElement("div");
      item.className = "reservation-item";
      
      const startTime = new Date(booking.startTime);
      const endTime = new Date(booking.endTime);
      const dateStr = startTime.toLocaleDateString("en-US", { 
        weekday: "short", 
        month: "short", 
        day: "numeric" 
      });
      const timeStr = `${startTime.toLocaleTimeString("en-US", { 
        hour: "2-digit", 
        minute: "2-digit" 
      })} - ${endTime.toLocaleTimeString("en-US", { 
        hour: "2-digit", 
        minute: "2-digit" 
      })}`;
      
      // Check if paid - handle both object and direct status
      const isPaid = booking.paymentStatus && (
        (typeof booking.paymentStatus === 'object' && booking.paymentStatus.status === "paid") ||
        booking.paymentStatus === "paid"
      );
      const statusText = isPaid ? "paid" : booking.status;
      const statusClass = isPaid ? "status-paid" : `status-${booking.status}`;
      
      // Use fixed structure to maintain consistent layout
      item.style.display = "grid";
      item.style.gridTemplateColumns = "120px 1fr 80px";
      item.style.gap = "12px";
      item.style.alignItems = "center";
      item.style.padding = "12px";
      item.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
      
      const canCancel = ["pending", "confirmed", "checked_in"].includes(booking.status) && !isPaid;
      item.innerHTML = `
        <div class="reservation-date" style="font-weight: 600; white-space: nowrap;">${dateStr}</div>
        <div class="reservation-details" style="display: flex; flex-direction: column; gap: 4px;">
          <div class="reservation-court" style="font-weight: 500;">${booking.court?.courtName || "N/A"}</div>
          <div class="reservation-time" style="font-size: 0.85rem; opacity: 0.8;">${timeStr}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
          <div class="reservation-status ${statusClass}" style="text-align: right; text-transform: capitalize; font-size: 0.85rem; white-space: nowrap;">${statusText}</div>
          ${
            canCancel
              ? `<button class="btn btn-outline cancel-reservation-btn" data-booking-id="${booking._id}" style="padding:4px 10px;font-size:0.72rem;">Cancel</button>`
              : ""
          }
        </div>
      `;
      
      elements.reservationsList.appendChild(item);

      if (canCancel) {
        const cancelBtn = item.querySelector(".cancel-reservation-btn");
        cancelBtn?.addEventListener("click", async (event) => {
          event.stopPropagation();
          try {
            const startHour = new Date(booking.startTime).getHours();
            const endHour = new Date(booking.endTime).getHours();
            const isMultiHour = endHour - startHour > 1;
            let selectedHours = [];
            if (isMultiHour) {
              const choice = await openCustomerPartialCancelModal(booking);
              if (choice === null) return;
              selectedHours = choice;
            } else {
              if (!confirm("Cancel this booking?")) return;
            }

            cancelBtn.disabled = true;
            cancelBtn.textContent = "Cancelling...";
            if (selectedHours.length > 0) {
              await api.partialCancelReservation(booking._id, selectedHours);
            } else {
              await api.cancelReservation(booking._id);
            }
            await loadUserReservations();
            await fetchAvailability();
          } catch (err) {
            cancelBtn.disabled = false;
            cancelBtn.textContent = "Cancel";
            alert(err.message || "Failed to cancel booking");
          }
        });
      }
    });
  } catch (error) {
    console.error("Failed to load reservations:", error);
    if (elements.reservationsList) {
      elements.reservationsList.innerHTML = "<p class='no-reservations'>Failed to load reservations</p>";
    }
  }
};

const renderCourtStatusCards = () => {
  const sport = elements.sportSelect.value;
  const filteredCourts = (state.availability.courts || []).filter((court) => court.courtType === sport);

  elements.courtStatusCards.innerHTML = "";

  if (filteredCourts.length === 0) {
    elements.courtStatusCards.innerHTML = "<p>No courts found for this sport.</p>";
    return;
  }

  const baseDate = new Date(elements.dateInput.value);
  const endDate = new Date(baseDate);
  endDate.setDate(baseDate.getDate() + 7);

  filteredCourts.slice(0, 3).forEach((court) => {
    const hasMaintenance = state.availability.maintenance.some((record) => {
      const recordCourtId = record.court && record.court._id ? record.court._id : record.court;
      if (String(recordCourtId) !== court._id.toString()) return false;
      const start = new Date(record.startTime);
      const end = new Date(record.endTime);
      return start < endDate && end > baseDate;
    });

    const hasBooking = state.availability.bookings.some((booking) => {
      const bookingCourtId = booking.court && booking.court._id ? booking.court._id : booking.court;
      if (String(bookingCourtId) !== court._id.toString()) return false;
      const start = new Date(booking.startTime);
      const end = new Date(booking.endTime);
      return start < endDate && end > baseDate;
    });

    let computedStatus = "available";
    if (hasMaintenance || court.status === "under_maintenance") {
      computedStatus = "under_maintenance";
    } else if (hasBooking || court.status === "reserved") {
      computedStatus = "reserved";
    }

    const card = document.createElement("div");
    card.className = "court-status-card";
    const statusTag = document.createElement("span");
    const statusClass =
      computedStatus === "under_maintenance"
        ? "status-maintenance"
        : computedStatus === "reserved"
        ? "status-reserved"
        : "status-available";
    statusTag.className = `status-tag ${statusClass}`;
    statusTag.textContent =
      computedStatus === "under_maintenance"
        ? "Maintenance"
        : computedStatus === "reserved"
        ? "Reserved"
        : "Available";
    card.innerHTML = `<span>${court.courtName}</span>`;
    card.appendChild(statusTag);
    elements.courtStatusCards.appendChild(card);
  });
};

const handleAuthSubmit = async (event) => {
  event.preventDefault();
  event.stopPropagation();
  
  const mode = elements.authModeInput.value;
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  
  if (!emailInput || !passwordInput) {
    alert("Form elements not found. Please refresh the page.");
    return;
  }
  
  const payload = {
    email: emailInput.value.trim(),
    password: passwordInput.value,
  };

  if (!payload.email || !payload.password) {
    alert("Please enter both email and password.");
    return;
  }

  if (mode === "signup") {
    const fullNameInput = document.getElementById("fullName");
    const phoneNumberInput = document.getElementById("phoneNumber");
    if (!fullNameInput || !phoneNumberInput) {
      alert("Form elements not found. Please refresh the page.");
      return;
    }
    payload.fullName = fullNameInput.value.trim();
    payload.phoneNumber = phoneNumberInput.value.trim();
    
    if (!payload.fullName || !payload.phoneNumber) {
      alert("Please fill in all fields for signup.");
      return;
    }
  }

  try {
    const response = mode === "signup" ? await api.signup(payload) : await api.login(payload);
    if (response && response.user) {
      state.user = response.user;
      elements.loginButton.textContent = state.user.fullName.split(" ")[0];
      toggleAdminLink();
      updateHeroStats(); // Update to show reservations instead of stats

      // Capture any pending action to run after login (e.g., finishing a booking flow)
      const postLoginAction = pendingPostLoginAction;
      pendingPostLoginAction = null;

      // If user is admin/staff and there is no pending booking action, redirect to admin
      if (!postLoginAction && state.user && (state.user.role === 'admin' || state.user.role === 'staff')) {
        window.location.href = './admin.html';
        return;
      }

      toggleModal(false);
      // Clear form
      emailInput.value = "";
      passwordInput.value = "";
      if (mode === "signup") {
        document.getElementById("fullName").value = "";
        document.getElementById("phoneNumber").value = "";
      }

      // Run any deferred action (for example, user clicked Confirm before logging in)
      if (typeof postLoginAction === "function") {
        try {
          await postLoginAction();
        } catch (err) {
          console.error("Post-login action failed:", err);
        }
      }
    } else {
      alert("Unexpected response from server. Please try again.");
    }
  } catch (error) {
    console.error("Auth error:", error);
    alert(error.message || "An error occurred. Please check your credentials and try again.");
  }
};

const initAuthFlow = () => {
  elements.loginButton.addEventListener("click", async (evt) => {
    // If not signed in -> show auth modal
    if (!state.user) {
      setAuthMode("login");
      toggleModal(true);
      return;
    }

    // Signed in -> toggle account menu UI
    evt.preventDefault();
    let menu = document.getElementById('accountMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'accountMenu';
      menu.className = 'account-menu visible';
      const header = document.createElement('div');
      header.className = 'account-header';
      header.innerHTML = `Signed in as <strong>${state.user.fullName.split(' ')[0] || state.user.email}</strong>`;
      menu.appendChild(header);

      const profileBtn = document.createElement('button');
      profileBtn.textContent = 'Profile';
      profileBtn.addEventListener('click', () => {
        // For now show profile info quick modal
        alert(`Signed in as:\n${state.user.fullName}\n${state.user.email}\n${state.user.phoneNumber || ''}`);
        menu.classList.remove('visible');
      });
      menu.appendChild(profileBtn);

      if (state.user && (state.user.role === 'admin' || state.user.role === 'staff')) {
        const adminBtn = document.createElement('button');
        adminBtn.textContent = 'Admin Dashboard';
        adminBtn.addEventListener('click', () => {
          window.location.href = './admin.html';
        });
        menu.appendChild(adminBtn);
      }

      const logoutBtn = document.createElement('button');
      logoutBtn.textContent = 'Log Out';
      logoutBtn.addEventListener('click', async () => {
        try {
          await api.logout();
          state.user = null;
          elements.loginButton.textContent = 'Sign In';
          toggleAdminLink();
          updateHeroStats(); // Update to show stats instead of reservations
          menu.remove();
          alert('You have been logged out.');
        } catch (err) {
          console.error('Logout failed:', err);
          alert(err.message || 'Failed to log out. Try again.');
        }
      });
      menu.appendChild(logoutBtn);

      // Close on outside click or Escape
      const onDocClick = (e) => {
        if (!menu.contains(e.target) && e.target !== elements.loginButton) {
          menu.classList.remove('visible');
          document.removeEventListener('click', onDocClick);
          document.removeEventListener('keydown', onEsc);
          window.removeEventListener('resize', onResize);
          setTimeout(() => menu.remove(), 200);
        }
      };
      const onEsc = (e) => { if (e.key === 'Escape') onDocClick(e); };
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onEsc);

      // Append to body and position next to login button
      document.body.appendChild(menu);
      const positionMenu = () => {
        const btnRect = elements.loginButton.getBoundingClientRect();
        const menuWidth = Math.max(180, menu.offsetWidth || 180);
        // try to align right edge of menu with right edge of button
        let left = btnRect.right - menuWidth;
        if (left < 8) left = 8; // prevent offscreen left
        const top = btnRect.bottom + 8; // below the button
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
      };
      const onResize = () => { positionMenu(); };
      // ensure menu is positioned after added to DOM (allow layout)
      requestAnimationFrame(() => {
        positionMenu();
        window.addEventListener('resize', onResize);
      });
    } else {
      // toggle visibility
      menu.classList.toggle('visible');
      if (!menu.classList.contains('visible')) {
        setTimeout(() => menu.remove(), 200);
      }
    }
  });
  
  // Smooth scroll to booking section
  const scrollToBooking = (sport = null) => {
    const bookingSection = document.getElementById("bookingSection");
    if (bookingSection) {
      bookingSection.scrollIntoView({ behavior: "smooth", block: "start" });
      if (sport) {
        // Set sport after a brief delay to ensure section is visible
        setTimeout(() => {
          elements.sportSelect.value = sport;
          populateCourtSelect();
          fetchAvailability();
        }, 300);
      }
    }
  };
  
  if (elements.heroBookBtn) {
    elements.heroBookBtn.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToBooking();
    });
  }
  
  if (elements.navBookLink) {
    elements.navBookLink.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToBooking();
    });
  }
  
  // Court card buttons will be bound after courts are loaded
  elements.closeAuthModal.addEventListener("click", () => toggleModal(false));
  elements.switchAuthMode.addEventListener("click", () => {
    const mode = elements.authModeInput.value === "login" ? "signup" : "login";
    setAuthMode(mode);
  });
  elements.authForm.addEventListener("submit", handleAuthSubmit);

};

const showBookingSectionForSport = async (sport) => {
  if (!sport) return;
  if (!state.courts.length) {
    await fetchCourts();
  }
  elements.sportSelect.value = sport;
  populateCourtSelect();
  await fetchAvailability();
  elements.bookingSection.scrollIntoView({ behavior: "smooth" });
};

const bindCourtCards = () => {
  const cards = document.querySelectorAll(".court-card");
  cards.forEach((card) => {
    if (card.dataset.bound === "true") return;
    card.dataset.bound = "true";
    card.style.cursor = "pointer";
    card.addEventListener("click", async (event) => {
      const sport = card.dataset.sport;
      const bookingSection = document.getElementById("bookingSection");
      if (bookingSection) {
        bookingSection.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => {
          if (elements.sportSelect) {
            elements.sportSelect.value = sport;
            populateCourtSelect();
            fetchAvailability();
          }
        }, 300);
      }
    });
  });
};

const initBookingFlow = () => {
  if (!elements.bookingForm || !elements.sportSelect) {
    console.warn("Booking form elements not found");
    return;
  }
  
  // Calendar navigation
  if (elements.prevMonth) {
    elements.prevMonth.addEventListener("click", () => {
      if (state.currentMonth === 0) {
        state.currentMonth = 11;
        state.currentYear--;
      } else {
        state.currentMonth--;
      }
      renderCalendar();
    });
  }
  
  if (elements.nextMonth) {
    elements.nextMonth.addEventListener("click", () => {
      if (state.currentMonth === 11) {
        state.currentMonth = 0;
        state.currentYear++;
      } else {
        state.currentMonth++;
      }
      renderCalendar();
    });
  }
  
  // Sport selection
  if (elements.sportSelect) {
    elements.sportSelect.addEventListener("change", () => {
      populateCourtSelect();
      state.selectedDate = null;
      state.selectedSlots = [];
      if (elements.calendarGrid) renderCalendar();
      renderTimeSlots();
      calculateSummary();
      if (elements.sportSelect.value) {
        fetchAvailability();
      }
    });
  }
  
  // Court selection
  if (elements.courtSelect) {
    elements.courtSelect.addEventListener("change", () => {
      // release holds when court changes
      releaseAllHolds();
      renderTimeSlots();
      updateConfirmButton();
    });
  }
  
  // Replace booking form submit logic
  if (elements.bookingForm) {
    elements.bookingForm.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const contactModal = document.getElementById("bookingContactModal");
      // If user is logged in, prefill and hide contact inputs
      const emailWrapper = document.querySelector('#bookingContactForm #bookingEmail')?.parentElement;
      const phoneWrapper = document.querySelector('#bookingContactForm #bookingPhone')?.parentElement;
      if (state.user) {
        const emailInput = document.getElementById('bookingEmail');
        const phoneInput = document.getElementById('bookingPhone');
        if (emailInput) {
          emailInput.value = state.user.email || '';
          if (emailWrapper) emailWrapper.style.display = 'none';
        }
        if (phoneInput) {
          phoneInput.value = state.user.phoneNumber || '';
          if (phoneWrapper) phoneWrapper.style.display = 'none';
        }
      } else {
        if (emailWrapper) emailWrapper.style.display = '';
        if (phoneWrapper) phoneWrapper.style.display = '';
      }
        showModalElement(contactModal);
    });
  }

  // Contact modal booking logic
  const finalizeBooking = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const bookingEmail = document.getElementById("bookingEmail").value.trim();
    const bookingPhone = document.getElementById("bookingPhone").value.trim();
    if (!bookingEmail || !bookingPhone) {
      alert("Please enter your email and phone number.");
      return;
    }
    try {
      // Create separate bookings for each selected time slot
      const sortedSlots = [...state.selectedSlots].sort((a, b) => a - b);
      // Group consecutive slots together
      const slotGroups = [];
      let currentGroup = [sortedSlots[0]];
      for (let i = 1; i < sortedSlots.length; i++) {
        if (sortedSlots[i] === sortedSlots[i - 1] + 1) {
          currentGroup.push(sortedSlots[i]);
        } else {
          slotGroups.push(currentGroup);
          currentGroup = [sortedSlots[i]];
        }
      }
      slotGroups.push(currentGroup);
      // Create bookings for each group
      for (const group of slotGroups) {
        const startHour = group[0];
        const endHour = group[group.length - 1] + 1;
        // Create dates in local timezone to avoid UTC conversion issues
        const dateStr = state.selectedDate; // Format: YYYY-MM-DD
        const [year, month, day] = dateStr.split('-').map(Number);
        const startTime = new Date(year, month - 1, day, startHour, 0, 0);
        const endTime = new Date(year, month - 1, day, endHour, 0, 0);
        const bookingDate = new Date(year, month - 1, day, 0, 0, 0);
        
        await api.createReservation({
          courtId: elements.courtSelect.value,
          bookingDate: bookingDate.toISOString(),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });
      }
      alert(`Booking requested! ${slotGroups.length} reservation${slotGroups.length !== 1 ? 's' : ''} created. Check your profile for confirmation.`);
      // Reset selection
      state.selectedSlots = [];
      if (elements.timeSlotsGrid) renderTimeSlots();
      calculateSummary();
      fetchAvailability();
      // Hide modal
      document.getElementById("bookingContactModal").classList.add("hidden");
      document.getElementById("bookingContactForm").reset();
    } catch (error) {
      console.error("Booking error:", error);
      alert(error.message || "Failed to create booking. Please try again.");
    }
  };

  if (document.getElementById("bookingContactForm")) {
    document.getElementById("bookingContactForm").addEventListener("submit", finalizeBooking);
  }
  if (document.getElementById("closeBookingContactModal")) {
    document.getElementById("closeBookingContactModal").addEventListener("click", () => {
      hideModalElement(document.getElementById("bookingContactModal"));
    });
  }

  // Close booking contact modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const bm = document.getElementById('bookingContactModal');
      if (bm && !bm.classList.contains('hidden')) {
        bm.classList.add('hidden');
        // return focus to time slots for editing
        elements.timeSlotsGrid?.querySelector('input[type="checkbox"]')?.focus();
      }
    }
  });
  
  // Form submission
  if (elements.bookingForm) {
    elements.bookingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      
      if (!state.user) {
        toggleModal(true);
        return;
      }

      if (!state.selectedDate || state.selectedSlots.length === 0) {
        alert("Please select a date and at least one time slot.");
        return;
      }

      if (!elements.courtSelect || !elements.courtSelect.value) {
        alert("Please select a court.");
        return;
      }

      try {
        // Determine email and phone: use logged-in user if available, otherwise read the form
        let bookingEmail;
        let bookingPhone;
        if (state.user) {
          bookingEmail = state.user.email;
          bookingPhone = state.user.phoneNumber || '';
        } else {
          bookingEmail = document.getElementById("bookingEmail").value.trim();
          bookingPhone = document.getElementById("bookingPhone").value.trim();
        }
        if (!bookingEmail || !bookingPhone) {
          alert("Please enter your email and phone number.");
          return;
        }
        // Create separate bookings for each selected time slot
        const sortedSlots = [...state.selectedSlots].sort((a, b) => a - b);
        // Group consecutive slots together
        const slotGroups = [];
        let currentGroup = [sortedSlots[0]];
        for (let i = 1; i < sortedSlots.length; i++) {
          if (sortedSlots[i] === sortedSlots[i - 1] + 1) {
            currentGroup.push(sortedSlots[i]);
          } else {
            slotGroups.push(currentGroup);
            currentGroup = [sortedSlots[i]];
          }
        }
        slotGroups.push(currentGroup);
        // Create bookings for each group
        for (const group of slotGroups) {
          const startHour = group[0];
          const endHour = group[group.length - 1] + 1;
          // Create dates in local timezone to avoid UTC conversion issues
          const dateStr = state.selectedDate; // Format: YYYY-MM-DD
          const [year, month, day] = dateStr.split('-').map(Number);
          const startTime = new Date(year, month - 1, day, startHour, 0, 0);
          const endTime = new Date(year, month - 1, day, endHour, 0, 0);
          const bookingDate = new Date(year, month - 1, day, 0, 0, 0);
          
          await api.createReservation({
            courtId: elements.courtSelect.value,
            bookingDate: bookingDate.toISOString(),
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          });
        }
        alert(`Booking requested! ${slotGroups.length} reservation${slotGroups.length !== 1 ? 's' : ''} created. Check your profile for confirmation.`);
        // Reset selection
        state.selectedSlots = [];
        if (elements.timeSlotsGrid) renderTimeSlots();
        calculateSummary();
        fetchAvailability();
      } catch (error) {
        console.error("Booking error:", error);
        alert(error.message || "Failed to create booking. Please try again.");
      }
    });
  }
  
  // Ensure the current month calendar is rendered on page load
  if (elements.calendarGrid) {
    state.currentMonth = new Date().getMonth();
    state.currentYear = new Date().getFullYear();
    renderCalendar();
  }
};

const initRealtimeUpdates = () => {
  socket.on("reservationUpdated", () => {
    fetchAvailability();
    if (state.user) {
      loadUserReservations(); // Refresh user's reservations when updated
    }
  });
  socket.on("maintenanceUpdated", () => fetchAvailability());
  socket.on("dashboardRefresh", () => {
    fetchAvailability();
    if (state.user) {
      loadUserReservations(); // Refresh user's reservations on dashboard refresh
    }
  });
};

const initVideoBackground = () => {
  const video = document.querySelector(".hero-video");
  if (!video) return;
  
  // Handle video load errors - fallback to static background
  video.addEventListener("error", () => {
    video.style.display = "none";
    console.warn("Hero video failed to load, using static background fallback");
  });
  
  // Ensure video plays (some browsers require user interaction)
  video.play().catch((err) => {
    console.warn("Video autoplay prevented:", err);
    video.style.display = "none";
  });
};

const initialize = async () => {
  initDatePicker();
  initAuthFlow();
  initBookingFlow();
  initRealtimeUpdates();
  calculateSummary();
  initVideoBackground();

  try {
    const profile = await api.profile();
    state.user = profile;
    elements.loginButton.textContent = profile.fullName.split(" ")[0];
    toggleAdminLink();
    updateHeroStats(); // Update to show reservations instead of stats
  } catch (_error) {
    // Not authenticated by default
    toggleAdminLink();
    updateHeroStats(); // Show stats for non-logged-in users
  }

  await fetchCourts();
  await fetchAvailability();
  await loadTodayMaintenance();
};

const loadTodayMaintenance = async () => {
  if (!elements.maintenanceList) return;

  try {
    const maintenance = await api.getTodayMaintenance();

    if (maintenance.length === 0) {
      if (elements.maintenanceList) {
        elements.maintenanceList.innerHTML = "<p class='no-maintenance'>No maintenance scheduled for today</p>";
      }
      return;
    }
    
    // Group by sport
    const bySport = {};
    maintenance.forEach(m => {
      const sport = m.court?.courtType || "unknown";
      if (!bySport[sport]) bySport[sport] = [];
      bySport[sport].push(m);
    });
    
    elements.maintenanceList.innerHTML = "";
    Object.keys(bySport).forEach(sport => {
      const items = bySport[sport];
      const item = document.createElement("div");
      item.className = "maintenance-item clickable-maintenance";
      item.dataset.sport = sport;
      item.style.cursor = "pointer";
      
      const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);
      item.innerHTML = `
        <span class="maintenance-sport">${sportName}</span>
        <span class="maintenance-count">${items.length} maintenance${items.length !== 1 ? "s" : ""}</span>
      `;
      
      item.addEventListener("click", () => {
        let message = `${sportName.toUpperCase()} Maintenance Today:\n\n`;
        items.forEach(m => {
          const start = new Date(m.startTime);
          const end = new Date(m.endTime);
          const courtName = m.court?.courtName || "Unknown Court";
          const dateStr = start.toLocaleDateString("en-US", { 
            weekday: "short", 
            month: "short", 
            day: "numeric" 
          });
          const timeStr = `${start.toLocaleTimeString("en-US", { 
            hour: "2-digit", 
            minute: "2-digit" 
          })} - ${end.toLocaleTimeString("en-US", { 
            hour: "2-digit", 
            minute: "2-digit" 
          })}`;
          message += `${courtName}\n${dateStr} at ${timeStr}\n`;
          if (m.remarks) message += `Remarks: ${m.remarks}\n`;
          message += "\n";
        });
        alert(message);
      });
      
      elements.maintenanceList.appendChild(item);
    });
  } catch (error) {
    console.error("Failed to load today's maintenance:", error);
    if (elements.maintenanceList) {
      elements.maintenanceList.innerHTML = "<p class='no-maintenance'>Failed to load maintenance info</p>";
    }
  }
};


const toggleAdminLink = () => {
  if (state.user && (state.user.role === "admin" || state.user.role === "staff")) {
    elements.adminLink.classList.remove("hidden");
  } else {
    elements.adminLink.classList.add("hidden");
  }
};

// Calendly-style Booking Logic
const calendlyState = {
  sport: "",
  court: "",
  date: "",
  slots: [],
  courts: [],
  availableSlots: [],
};
const calendlySportSelect = document.getElementById("calendlySportSelect");
const calendlyCourtSelect = document.getElementById("calendlyCourtSelect");
const calendlyCalendarGrid = document.getElementById("calendlyCalendarGrid");
const calendlyCurrentMonthYear = document.getElementById("calendlyCurrentMonthYear");
const calendlyPrevMonth = document.getElementById("calendlyPrevMonth");
const calendlyNextMonth = document.getElementById("calendlyNextMonth");
const calendlyTimeSlotsList = document.getElementById("calendlyTimeSlotsList");
const calendlySelectedDateLabel = document.getElementById("calendlySelectedDateLabel");
const calendlySummary = document.getElementById("calendlySummary");

let calendlyMonth = new Date().getMonth();
let calendlyYear = new Date().getFullYear();

function updateCourtDropdown() {
  const sport = calendlySportSelect.value;
  calendlyState.sport = sport;
  const filtered = state.courts.filter(c => c.courtType === sport);
  calendlyCourtSelect.innerHTML = '<option value="">Select a court</option>';
  filtered.forEach(court => {
    const opt = document.createElement("option");
    opt.value = court._id;
    opt.textContent = court.courtName;
    calendlyCourtSelect.appendChild(opt);
  });
  calendlyCourtSelect.disabled = !sport;
}
calendlySportSelect.addEventListener("change", updateCourtDropdown);
calendlyCourtSelect.addEventListener("change", () => {
  calendlyState.court = calendlyCourtSelect.value;
  renderCalendlyCalendar();
  calendlyTimeSlotsList.innerHTML = "";
  calendlySummary.classList.add("hidden");
});
function renderCalendlyCalendar() {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  calendlyCurrentMonthYear.textContent = `${monthNames[calendlyMonth]} ${calendlyYear}`;
  calendlyCalendarGrid.innerHTML = "";
  const firstDay = new Date(calendlyYear, calendlyMonth, 1);
  const lastDay = new Date(calendlyYear, calendlyMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();
  // Day headers
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(day => {
    const header = document.createElement("div");
    header.className = "calendar-day-header";
    header.textContent = day;
    calendlyCalendarGrid.appendChild(header);
  });
  // Empty cells
  for (let i = 0; i < startingDayOfWeek; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day empty";
    calendlyCalendarGrid.appendChild(empty);
  }
  // Days
  const today = new Date();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(calendlyYear, calendlyMonth, day);
    const dayElement = document.createElement("div");
    dayElement.className = "calendar-day";
    const isToday = date.toDateString() === today.toDateString();
    const isPast = date < today && !isToday;
    dayElement.textContent = day;
    // Store date as local YYYY-MM-DD string (avoid UTC shifting a day back)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const dayStr = String(date.getDate()).padStart(2, "0");
    dayElement.dataset.date = `${year}-${month}-${dayStr}`;
    if (isToday) dayElement.classList.add("today");
    if (isPast) dayElement.classList.add("past");
    if (isPast) dayElement.classList.add("disabled");
    if (!isPast && calendlyState.court) {
      dayElement.addEventListener("click", () => {
        calendlyState.date = dayElement.dataset.date;
        selectCalendlyDate(dayElement.dataset.date);
        document.querySelectorAll(".calendar-day.selected").forEach(el => el.classList.remove("selected"));
        dayElement.classList.add("selected");
      });
    }
    calendlyCalendarGrid.appendChild(dayElement);
  }
}
calendlyPrevMonth.addEventListener("click", () => {
  if (calendlyMonth === 0) {
    calendlyMonth = 11;
    calendlyYear--;
  } else {
    calendlyMonth--;
  }
  renderCalendlyCalendar();
});
calendlyNextMonth.addEventListener("click", () => {
  if (calendlyMonth === 11) {
    calendlyMonth = 0;
    calendlyYear++;
  } else {
    calendlyMonth++;
  }
  renderCalendlyCalendar();
});
function selectCalendlyDate(date) {
  calendlySelectedDateLabel.textContent = `Available slots for ${date}`;
  calendlyTimeSlotsList.innerHTML = "<div class='loading'>Loading...</div>";
  // reset selected slots when date changes
  calendlyState.slots = [];
  api.availability(calendlyState.sport, date, 1).then(avail => {
    calendlyTimeSlotsList.innerHTML = "";
    const selectedCourtId = calendlyState.court;
    const courtObj = (avail.courts || []).find(c => String(c._id) === String(selectedCourtId));
    for (let hour = 7; hour < 21; hour++) {
      const slotDateKey = date;
      const hourStr = hour.toString().padStart(2, "0");
      const slotStart = new Date(`${date}T${hourStr}:00`);
      const slotEnd = new Date(`${date}T${hourStr}:00`);
      slotEnd.setHours(slotEnd.getHours() + 1, 0, 0, 0);

      const isPast = slotStart < new Date();
      const availableHoursForDate =
        courtObj && courtObj.availableHoursByDate ? courtObj.availableHoursByDate[slotDateKey] || [] : null;
      const isAvailable =
        Array.isArray(availableHoursForDate) ? availableHoursForDate.includes(hour) : null;

      const isBooked = (avail.bookings || []).some((b) => {
        const bookingCourtId = b.court && b.court._id ? b.court._id : b.court;
        if (String(bookingCourtId) !== selectedCourtId) return false;
        const start = new Date(b.startTime);
        const end = new Date(b.endTime);
        return start < slotEnd && end > slotStart;
      });

      const isMaintenance = (avail.maintenance || []).some((m) => {
        const maintCourtId = m.court && m.court._id ? m.court._id : m.court;
        if (String(maintCourtId) !== selectedCourtId) return false;
        const start = new Date(m.startTime);
        const end = new Date(m.endTime);
        return start < slotEnd && end > slotStart;
      });

      const isBlockedByAvailability = isAvailable === false;

      const item = document.createElement("div");
      item.className = "calendly-timeslot-btn";
      item.setAttribute('role', 'button');
      const disabled = isPast || isBooked || isMaintenance || isBlockedByAvailability;
      item.setAttribute('tabindex', disabled ? '-1' : '0');
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = ((hour + 11) % 12) + 1;
      item.textContent = `${displayHour}:00 ${ampm}`;

      if (isPast) {
        item.classList.add("past");
        item.title = "Select present date";
      } else if (isMaintenance) {
        item.classList.add("maintenance");
        item.title = "Under maintenance";
      } else if (disabled) {
        item.classList.add("reserved");
        item.title = "Already booked";
      }

      item.addEventListener('click', () => {
        if (disabled) return;
        const idx = calendlyState.slots.indexOf(hour);
        if (idx === -1) {
          calendlyState.slots.push(hour);
          item.classList.add('selected');
        } else {
          calendlyState.slots.splice(idx, 1);
          item.classList.remove('selected');
        }
        showCalendlyConfirmButton();
      });
      item.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) item.click(); });
      calendlyTimeSlotsList.appendChild(item);
    }
  });
}
function showCalendlyConfirmButton() {
  let confirmBtn = document.getElementById("calendlyConfirmBtn");
  if (!calendlyState.slots.length) {
    if (confirmBtn) confirmBtn.remove();
    return;
  }
  if (!confirmBtn) {
    confirmBtn = document.createElement("button");
    confirmBtn.id = "calendlyConfirmBtn";
    confirmBtn.className = "calendly-confirm-btn";
    calendlyTimeSlotsList.appendChild(confirmBtn);
  }
  const count = calendlyState.slots.length;
  confirmBtn.textContent = `Confirm (${count} slot${count !== 1 ? "s" : ""})`;
  confirmBtn.onclick = () => {
    // Require login before showing summary
    if (!state.user) {
      setAuthMode("login");
      toggleModal(true);
      return;
    }
    showCalendlySummary();
  };
}
function showCalendlySummary() {
  // Build a modal overlay for summary
  const existing = document.getElementById('calendlySummaryModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'calendlySummaryModal';
  modal.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal-box calendly-summary-box';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close small';
  closeBtn.textContent = '×';
  // Close will be wired to the centralized remover below (removeCalendlyModal)
  closeBtn.addEventListener('click', () => {
    // attempt to find the modal and dispatch a click on the overlay to trigger removal logic
    const overlay = document.getElementById('calendlySummaryModal');
    if (overlay) overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    else modal.remove();
  });

  const courtText = calendlyCourtSelect.selectedOptions[0] ? calendlyCourtSelect.selectedOptions[0].textContent : '';
  box.innerHTML = `
    <h4>Booking Summary</h4>
    <p><strong>Sport:</strong> ${calendlyState.sport}</p>
    <p><strong>Court:</strong> ${courtText}</p>
    <p><strong>Date:</strong> ${calendlyState.date}</p>
    <p><strong>Time:</strong> ${calendlyState.slots.map(h => `${formatHourLabel(h)} - ${formatHourLabel(h+1)}`).join(', ')}</p>
    <p><strong>Total:</strong> ₱${calendlyState.slots.length * 150}</p>
  `;

  // User must be logged in to see this summary

  const finalizeBtn = document.createElement('button');
  finalizeBtn.className = 'calendly-confirm-btn';
  finalizeBtn.id = 'calendlyFinalConfirmBtn';
  finalizeBtn.textContent = 'Finalize Booking';
  finalizeBtn.addEventListener('click', async () => {
    // Helper to actually create bookings for the selected slots
    const performBooking = async () => {
      if (!calendlyState.slots.length) {
        alert('Please select at least one time slot.');
        return;
      }
      try {
        const sorted = [...calendlyState.slots].sort((a, b) => a - b);
        // group consecutive hours
        const groups = [];
        let current = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === sorted[i - 1] + 1) {
            current.push(sorted[i]);
          } else {
            groups.push(current);
            current = [sorted[i]];
          }
        }
        groups.push(current);

        const dateStr = calendlyState.date; // YYYY-MM-DD
        const [year, month, day] = dateStr.split('-').map(Number);

        for (const group of groups) {
          const startHour = group[0];
          const endHour = group[group.length - 1] + 1;
          const startTime = new Date(year, month - 1, day, startHour, 0, 0);
          const endTime = new Date(year, month - 1, day, endHour, 0, 0);
          const bookingDate = new Date(year, month - 1, day, 0, 0, 0);

          await api.createReservation({
            courtId: calendlyState.court,
            bookingDate: bookingDate.toISOString(),
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          });
        }

        box.innerHTML = `<h4>Booking Confirmed!</h4><p>Thank you. Please pay ₱${calendlyState.slots.length * 150} at the front desk.</p>`;
        calendlyTimeSlotsList.innerHTML = '';
        setTimeout(() => {
          const overlay = document.getElementById('calendlySummaryModal');
          if (overlay) overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          else if (modal && modal.parentElement) modal.parentElement.removeChild(modal);
        }, 3000);
      } catch (error) {
        alert(error.message || 'Booking failed');
      }
    };

    // If not logged in, force login first using the same auth modal, then run booking
    if (!state.user) {
      pendingPostLoginAction = async () => {
        await performBooking();
      };
      setAuthMode("login");
      toggleModal(true);
      return;
    }

    await performBooking();
  });

  box.appendChild(finalizeBtn);
  box.appendChild(closeBtn);
  modal.appendChild(box);
  document.body.appendChild(modal);
  // Play open animation
  requestAnimationFrame(() => {
    modal.classList.add('visible');
    box.classList.add('visible');
  });

  // Close handlers: overlay click and Escape key
  const onOverlayClick = (e) => {
    if (e.target === modal) {
      removeCalendlyModal();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      removeCalendlyModal();
    }
  };

  const removeCalendlyModal = () => {
    // start closing animation
    modal.classList.add('closing');
    modal.classList.remove('visible');
    box.classList.remove('visible');
    // detach listeners after animation completes
    setTimeout(() => {
      document.removeEventListener('keydown', onKeyDown);
      modal.removeEventListener('click', onOverlayClick);
      if (modal && modal.parentElement) modal.parentElement.removeChild(modal);
      // return focus to the calendly time slots list so user can edit
      calendlyTimeSlotsList.querySelector('input[type="checkbox"]')?.focus();
    }, 260);
  };

  modal.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onKeyDown);
}
// Initial fetch of courts
api.courts().then(courts => {
  state.courts = courts;
  updateCourtDropdown();
  renderCalendlyCalendar();
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bindElements();
    initialize();
  });
} else {
  bindElements();
  initialize();
}

// Make header logo reload the page when clicked (admin preference)
document.addEventListener('DOMContentLoaded', () => {
  const logo = document.querySelector('.logo-animated');
  if (!logo) return;
  logo.style.cursor = 'pointer';
  logo.addEventListener('click', () => {
    window.location.reload();
  });
  logo.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') window.location.reload();
  });
});

// Scroll-based animation logic
const handleScrollAnimations = () => {
  const elements = document.querySelectorAll(".animate-on-scroll");
  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      el.classList.add("visible");
    } else {
      el.classList.remove("visible");
    }
  });
};

// Attach scroll event listener
window.addEventListener("scroll", handleScrollAnimations);

// Trigger animations on page load
handleScrollAnimations();

