const API_BASE = "/api";

const request = async (url, options = {}) => {
  const response = await fetch(`${API_BASE}${url}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || "Request failed");
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
};

export const api = {
  signup: (payload) =>
    request("/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  profile: () => request("/auth/profile"),
  logout: () =>
    request("/auth/logout", {
      method: "POST",
    }),
  courts: () => request("/courts"),
  availability: (sport, date, rangeDays = 7) =>
    request(`/courts/availability?sport=${sport}&date=${date}&rangeDays=${rangeDays}`),
  createReservation: (payload) =>
    request("/reservations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  holdReservation: (payload) =>
    request("/reservations/hold", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  releaseHold: (id) =>
    request(`/reservations/hold/${id}`, {
      method: "DELETE",
    }),
  updateReservationStatus: (id, payload) =>
    request(`/reservations/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listReservations: () => request("/reservations"),
  cancelReservation: (id) =>
    request(`/reservations/${id}`, {
      method: "DELETE",
    }),
  dashboard: () => request("/dashboard"),
  dashboardWeekly: () => request("/dashboard/weekly"),
  maintenance: () => request("/maintenance"),
  createMaintenance: (payload) =>
    request("/maintenance", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  markReservationPaid: (id) =>
    request(`/reservations/${id}/pay`, {
      method: "POST",
    }),
  partialCancelReservation: (id, hours) =>
    request(`/reservations/${id}/cancel-hours`, {
      method: "PATCH",
      body: JSON.stringify({ hours }),
    }),
  extendReservation: (id, extendToHour) =>
    request(`/reservations/${id}/extend`, {
      method: "PATCH",
      body: JSON.stringify({ extendToHour }),
    }),
  searchCustomers: (query) => {
    const params = new URLSearchParams();
    if (query.phone) params.set("phone", query.phone);
    if (query.name) params.set("name", query.name);
    return request(`/auth/customers?${params.toString()}`);
  },
  createWalkInReservation: (payload) =>
    request("/reservations", {
      method: "POST",
      body: JSON.stringify({ ...payload, source: "walk_in" }),
    }),
  getTodayMaintenance: () => request("/maintenance/today"),
};

