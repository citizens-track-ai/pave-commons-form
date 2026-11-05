/**
 * PAVE Case Book — Workflow Kanban Board
 *
 * Dedicated pipeline view for authenticated NocoDB editors and reviewers.
 * Features:
 * - Gated staff authentication
 * - Grouped columns by Workflow Status
 * - Sort by created / updated date
 * - Filter by assigned user (with pinned "👤 Assigned to Me" at the top)
 * - Collapse / expand individual columns or all columns
 * - Live search by title or ID
 * - Relative time display ("days or minutes ago")
 * - Drag-and-drop & quick-select workflow transitions
 */

const STAFF_TOKEN_STORAGE_KEY = "pave_nocodb_staff_token";
const COLLAPSED_COLS_STORAGE_KEY = "pave_kanban_collapsed_columns";
const SORT_PREF_STORAGE_KEY = "pave_kanban_sort_pref";

const WORKFLOW_STATUSES = [
  "Nomination",
  "Submission",
  "Draft",
  "Under Review",
  "Completed",
  "Rejected",
  "Duplicate",
];

const state = {
  cases: [],
  totalCount: 0,
  loadedCount: 0,
  hasMore: false,
  currentUser: null,
  canEdit: false,
  assignableUsers: [],
  collapsedColumns: new Set(),
  searchTerm: "",
  assigneeFilter: "all",
  curationFilter: "all",
  sortBy: "updated-desc",
  draggedCaseId: null,
  isLoading: false,
};

// ============================================================================
// Storage & Auth Helpers
// ============================================================================

function getStaffTokenFromStorage() {
  try {
    return (localStorage.getItem(STAFF_TOKEN_STORAGE_KEY) || "").trim();
  } catch (_) {
    return "";
  }
}

function setStaffTokenToStorage(token) {
  try {
    if (token) localStorage.setItem(STAFF_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(STAFF_TOKEN_STORAGE_KEY);
  } catch (_) {}
}

function loadStoredPreferences() {
  try {
    const savedCollapsed = localStorage.getItem(COLLAPSED_COLS_STORAGE_KEY);
    if (savedCollapsed) {
      const arr = JSON.parse(savedCollapsed);
      if (Array.isArray(arr)) {
        state.collapsedColumns = new Set(arr);
      }
    }
  } catch (_) {}

  try {
    const savedSort = localStorage.getItem(SORT_PREF_STORAGE_KEY);
    if (savedSort) {
      state.sortBy = savedSort;
      const sortSelect = document.getElementById("kanbanSortSelect");
      if (sortSelect) sortSelect.value = savedSort;
    }
  } catch (_) {}
}

function persistCollapsedColumns() {
  try {
    localStorage.setItem(
      COLLAPSED_COLS_STORAGE_KEY,
      JSON.stringify(Array.from(state.collapsedColumns))
    );
  } catch (_) {}
}

function persistSortPreference() {
  try {
    localStorage.setItem(SORT_PREF_STORAGE_KEY, state.sortBy);
  } catch (_) {}
}

// ============================================================================
// Date & Time Formatting
// ============================================================================

/**
 * Format timestamp as relative time: "days or minutes ago".
 */
function formatRelativeTime(dateInput) {
  if (!dateInput) return "Unknown";
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return "Unknown";

  const diffMs = Date.now() - date.getTime();
  const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSecs < 45) return "just now";
  if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;
  return `${diffYears} year${diffYears === 1 ? "" : "s"} ago`;
}

function formatFullDateTime(dateInput) {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

// ============================================================================
// Notification Toasts
// ============================================================================

function showToast(message, type = "info") {
  const container = document.getElementById("kanbanToastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `kanban-toast is-${type}`;
  toast.setAttribute("role", "status");

  const icon = type === "success" ? "✓" : type === "error" ? "⚠️" : "ℹ️";
  toast.innerHTML = `<span aria-hidden="true">${icon}</span> <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.25s ease";
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// ============================================================================
// Initialization & Authentication Lifecycle
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  loadStoredPreferences();
  initToolbarEventListeners();
  initColumnCollapseEvents();
  initGateFormEvents();

  const token = getStaffTokenFromStorage();
  if (token) {
    await fetchAndRenderKanbanData(token, { scope: "active" });
  } else {
    showLoginGate();
  }
});

function showLoginGate() {
  const gate = document.getElementById("kanbanLoginGate");
  const workspace = document.getElementById("kanbanWorkspace");
  const badge = document.getElementById("kanbanStaffBadge");
  const authBtn = document.getElementById("kanbanAuthActionBtn");

  if (gate) gate.classList.remove("hidden");
  if (workspace) workspace.classList.add("hidden");
  if (badge) badge.classList.add("hidden");
  if (authBtn) {
    authBtn.textContent = "Sign in";
    authBtn.onclick = () => {
      document.getElementById("kanbanGateTokenInput")?.focus();
    };
  }
}

function showWorkspace() {
  const gate = document.getElementById("kanbanLoginGate");
  const workspace = document.getElementById("kanbanWorkspace");
  const badge = document.getElementById("kanbanStaffBadge");
  const userLabel = document.getElementById("kanbanUserLabel");
  const authBtn = document.getElementById("kanbanAuthActionBtn");

  if (gate) gate.classList.add("hidden");
  if (workspace) workspace.classList.remove("hidden");
  if (badge) badge.classList.remove("hidden");

  if (state.currentUser && userLabel) {
    const name = (state.currentUser.displayName || "").trim();
    const email = (state.currentUser.email || "").trim();
    const label = name && email && !name.includes(email) ? `${name} (${email})` : name || email || "Signed in";
    userLabel.textContent = label;
    userLabel.title = label;
  }

  if (authBtn) {
    authBtn.textContent = "Sign out";
    authBtn.onclick = logoutKanban;
  }
}

function logoutKanban() {
  setStaffTokenToStorage(null);
  state.currentUser = null;
  state.canEdit = false;
  state.cases = [];
  showLoginGate();
  showToast("You have been signed out.", "info");
}

function initGateFormEvents() {
  const form = document.getElementById("kanbanGateLoginForm");
  const input = document.getElementById("kanbanGateTokenInput");
  const btn = document.getElementById("kanbanGateLoginBtn");
  const errBox = document.getElementById("kanbanGateError");
  const logoutBtn = document.getElementById("kanbanLogoutBtn");

  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutKanban);
  }

  if (btn && input) {
    btn.addEventListener("click", async () => {
      const token = (input.value || "").trim();
      if (!token) {
        if (errBox) {
          errBox.textContent = "Please enter your NocoDB API token.";
          errBox.classList.remove("hidden");
        }
        return;
      }

      btn.disabled = true;
      btn.textContent = "Verifying...";
      if (errBox) errBox.classList.add("hidden");

      try {
        const authRes = await fetch("/api/auth/me", {
          headers: { "X-Noco-Token": token },
        });

        if (!authRes.ok) {
          const errData = await authRes.json().catch(() => ({}));
          throw new Error(errData.error || "Invalid token or insufficient base access.");
        }

        const authData = await authRes.json();
        if (!authData.authenticated || !authData.user) {
          throw new Error("User authentication failed.");
        }

        setStaffTokenToStorage(token);
        input.value = "";
        await fetchAndRenderKanbanData(token, { scope: "active" });
        showToast(`Welcome, ${authData.user.displayName || authData.user.email}!`, "success");
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message || "Failed to authenticate with NocoDB.";
          errBox.classList.remove("hidden");
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "Verify & Sign In";
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btn.click();
      }
    });
  }
}

// ============================================================================
// Data Loading & API Calls
// ============================================================================

async function fetchAndRenderKanbanData(token, options = {}) {
  const scope = options.scope || "active";
  state.isLoading = true;
  updateStatsBadge();

  try {
    const res = await fetch(`/api/kanban/cases?scope=${encodeURIComponent(scope)}`, {
      headers: { "X-Noco-Token": token },
    });

    if (res.status === 401 || res.status === 403) {
      setStaffTokenToStorage(null);
      showLoginGate();
      const errBox = document.getElementById("kanbanGateError");
      if (errBox) {
        errBox.textContent = "Session expired or invalid token. Please sign in again.";
        errBox.classList.remove("hidden");
      }
      return;
    }

    if (!res.ok) {
      throw new Error(`Failed to load cases: HTTP ${res.status}`);
    }

    const data = await res.json();
    const newCases = Array.isArray(data.cases) ? data.cases : [];

    if (options.append) {
      // Append new cases while preventing duplicates
      const existingIds = new Set(state.cases.map((c) => Number(c.id)));
      for (const c of newCases) {
        if (!existingIds.has(Number(c.id))) {
          state.cases.push(c);
          existingIds.add(Number(c.id));
        }
      }
    } else {
      state.cases = newCases;
    }

    state.totalCount = data.totalCount || state.cases.length;
    state.loadedCount = state.cases.length;
    state.hasMore = Boolean(data.hasMore || state.loadedCount < state.totalCount);
    state.currentUser = data.user || state.currentUser;
    state.canEdit = Boolean(data.canEdit);
    if (Array.isArray(data.assignableUsers)) {
      state.assignableUsers = data.assignableUsers;
    }

    showWorkspace();
    populateAssigneeFilterOptions();
    applyColumnCollapseStates();
    renderKanbanBoard();
  } catch (err) {
    console.error("Error fetching kanban data:", err);
    showToast(err.message || "Failed to load cases from NocoDB.", "error");
  } finally {
    state.isLoading = false;
    updateStatsBadge();
  }
}

async function updateCaseWorkflowStatus(caseId, newStatus) {
  const token = getStaffTokenFromStorage();
  if (!token) {
    showToast("You must be signed in to update case status.", "error");
    return;
  }

  const targetCase = state.cases.find((c) => Number(c.id) === Number(caseId));
  if (!targetCase) return;

  const previousStatus = targetCase.workflowStatus;
  if (previousStatus === newStatus) return;

  // Optimistic UI update
  targetCase.workflowStatus = newStatus;
  targetCase.updatedAt = new Date().toISOString();
  renderKanbanBoard();

  showToast(`Moving #${caseId} to "${newStatus}"...`, "info");

  try {
    const res = await fetch("/api/kanban/case/workflow", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Noco-Token": token,
      },
      body: JSON.stringify({
        id: caseId,
        workflowStatus: newStatus,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server returned error HTTP ${res.status}`);
    }

    showToast(`Case #${caseId} updated to "${newStatus}"`, "success");
  } catch (err) {
    console.error("Failed to update status:", err);
    // Rollback
    targetCase.workflowStatus = previousStatus;
    renderKanbanBoard();
    showToast(`Failed to update status: ${err.message}`, "error");
  }
}

// ============================================================================
// Filtering, Sorting & Rendering
// ============================================================================

function populateAssigneeFilterOptions() {
  const optGroup = document.getElementById("kanbanAssigneeOptGroup");
  if (!optGroup) return;

  optGroup.innerHTML = "";

  const userMap = new Map();

  // Add assignable users from base
  (state.assignableUsers || []).forEach((u) => {
    if (!u) return;
    const key = u.id || u.email?.toLowerCase();
    if (key && !userMap.has(key)) {
      userMap.set(key, u);
    }
  });

  // Also include any users assigned across current cases
  state.cases.forEach((c) => {
    if (Array.isArray(c.assignedTo)) {
      c.assignedTo.forEach((u) => {
        if (!u) return;
        const key = u.id || u.email?.toLowerCase();
        if (key && !userMap.has(key)) {
          userMap.set(key, u);
        }
      });
    }
  });

  // Sort team members alphabetically
  const sortedUsers = Array.from(userMap.values()).sort((a, b) => {
    const nameA = (a.displayName || a.email || "").toLowerCase();
    const nameB = (b.displayName || b.email || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  sortedUsers.forEach((u) => {
    const option = document.createElement("option");
    option.value = u.id || u.email;
    option.textContent = u.displayName || u.email;
    optGroup.appendChild(option);
  });

  // Restore current value if still valid
  const select = document.getElementById("kanbanAssigneeFilter");
  if (select && state.assigneeFilter) {
    select.value = state.assigneeFilter;
  }
}

function getFilteredAndSortedCases() {
  const query = (state.searchTerm || "").trim().toLowerCase();
  const filterAssignee = state.assigneeFilter;
  const currentUserId = state.currentUser?.id;
  const currentUserEmail = state.currentUser?.email?.toLowerCase();

  let list = state.cases.filter((c) => {
    // 1. Search term match on title or ID
    if (query) {
      const titleMatch = (c.projectTitle || "").toLowerCase().includes(query);
      const idMatch = String(c.id).includes(query);
      if (!titleMatch && !idMatch) return false;
    }

    // 2. Assignee filter
    if (filterAssignee === "me") {
      if (!Array.isArray(c.assignedTo) || c.assignedTo.length === 0) return false;
      const hasMe = c.assignedTo.some((u) => {
        if (!u) return false;
        if (currentUserId && u.id === currentUserId) return true;
        if (currentUserEmail && u.email && u.email.toLowerCase() === currentUserEmail) return true;
        return false;
      });
      if (!hasMe) return false;
    } else if (filterAssignee === "unassigned") {
      if (Array.isArray(c.assignedTo) && c.assignedTo.length > 0) return false;
    } else if (filterAssignee !== "all") {
      if (!Array.isArray(c.assignedTo)) return false;
      const match = c.assignedTo.some((u) => {
        if (!u) return false;
        return u.id === filterAssignee || (u.email && u.email.toLowerCase() === filterAssignee.toLowerCase());
      });
      if (!match) return false;
    }

    // 3. Curation status filter
    if (state.curationFilter !== "all") {
      const curVal = (c.curationDecision || "").trim();
      if (state.curationFilter === "undecided") {
        if (curVal !== "") return false;
      } else {
        if (curVal.toLowerCase() !== state.curationFilter.toLowerCase()) return false;
      }
    }

    return true;
  });

  // 3. Sorting
  list.sort((a, b) => {
    if (state.sortBy === "title-asc") {
      const titleA = (a.projectTitle || "").toLowerCase();
      const titleB = (b.projectTitle || "").toLowerCase();
      return titleA.localeCompare(titleB);
    }

    if (state.sortBy === "created-desc") {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    }

    if (state.sortBy === "created-asc") {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    }

    if (state.sortBy === "updated-asc") {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    }

    // Default: updated-desc
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });

  return list;
}

function renderKanbanBoard() {
  const filteredCases = getFilteredAndSortedCases();

  // Group cases by workflow status
  const groups = new Map();
  WORKFLOW_STATUSES.forEach((status) => groups.set(status, []));

  filteredCases.forEach((c) => {
    const rawStatus = (c.workflowStatus || "Nomination").trim();
    // Normalize status key
    const match = WORKFLOW_STATUSES.find((s) => s.toLowerCase() === rawStatus.toLowerCase()) || "Nomination";
    groups.get(match).push(c);
  });

  // Update counts and render cards in each column
  WORKFLOW_STATUSES.forEach((status) => {
    const colList = document.getElementById(`list-${status.replace(/\s+/g, "-")}`);
    const countBadge = document.getElementById(`count-${status.replace(/\s+/g, "-")}`);
    const collapsedCount = document.getElementById(`collapsed-count-${status.replace(/\s+/g, "-")}`);
    const casesInGroup = groups.get(status) || [];

    if (countBadge) countBadge.textContent = casesInGroup.length;
    if (collapsedCount) collapsedCount.textContent = casesInGroup.length;

    if (colList) {
      if (casesInGroup.length === 0) {
        colList.innerHTML = `<div class="kanban-empty-col">No cases</div>`;
      } else {
        colList.innerHTML = casesInGroup.map((c) => buildCardHtml(c)).join("");
      }
    }
  });

  // Attach card event listeners (drag and drop, quick move select)
  attachCardEventListeners();

  // Update stats pill and load more button
  const showing = filteredCases.length;
  updateStatsBadge(showing);
}

function updateStatsBadge(showingCount) {
  const badge = document.getElementById("kanbanStatsBadge");
  const loadMoreBtn = document.getElementById("kanbanLoadMoreBtn");
  if (!badge) return;

  const loaded = state.cases.length;
  const total = state.totalCount || loaded;

  if (state.isLoading && loaded === 0) {
    badge.textContent = "Loading cases...";
    return;
  }

  // Format explicitly as "N of N loaded" as requested
  if (showingCount !== undefined && (showingCount !== loaded || state.searchTerm || state.assigneeFilter !== "all" || state.curationFilter !== "all")) {
    badge.textContent = `Showing ${showingCount} of ${total} (${loaded} of ${total} loaded)`;
  } else {
    badge.textContent = `${loaded} of ${total} loaded`;
  }

  if (loadMoreBtn) {
    if (loaded < total) {
      const remaining = total - loaded;
      loadMoreBtn.textContent = `⬇ Load more (${remaining})`;
      loadMoreBtn.classList.remove("hidden");
      loadMoreBtn.disabled = state.isLoading;
    } else {
      loadMoreBtn.classList.add("hidden");
    }
  }
}

function buildCardHtml(caseItem) {
  const statusClass = `status-${(caseItem.workflowStatus || "Nomination").toLowerCase().replace(/\s+/g, "-")}`;
  const relativeCreated = formatRelativeTime(caseItem.createdAt);
  const relativeUpdated = formatRelativeTime(caseItem.updatedAt || caseItem.createdAt);
  const fullCreated = formatFullDateTime(caseItem.createdAt);
  const fullUpdated = formatFullDateTime(caseItem.updatedAt || caseItem.createdAt);

  // Curation badge styling
  let curationHtml = "";
  if (caseItem.curationDecision) {
    const curVal = caseItem.curationDecision;
    let curClass = "curation-badge";
    if (curVal.toLowerCase().includes("featured")) curClass += " curation-featured";
    else if (curVal.toLowerCase().includes("full")) curClass += " curation-full";
    else if (curVal.toLowerCase().includes("mapping")) curClass += " curation-mapping";
    else if (curVal.toLowerCase().includes("do not")) curClass += " curation-exclude";
    curationHtml = `<span class="${curClass}" title="Curation decision">${escapeHtml(curVal)}</span>`;
  }

  // Assignee rendering
  let assigneeHtml = "";
  if (Array.isArray(caseItem.assignedTo) && caseItem.assignedTo.length > 0) {
    const userNames = caseItem.assignedTo.map((u) => u.displayName || u.email).join(", ");
    const firstInitial = (caseItem.assignedTo[0]?.displayName || caseItem.assignedTo[0]?.email || "U")[0].toUpperCase();
    assigneeHtml = `
      <div class="card-assignee-row" title="Assigned to ${escapeHtml(userNames)}">
        <span class="assignee-avatar" aria-hidden="true">${escapeHtml(firstInitial)}</span>
        <span class="assignee-name">${escapeHtml(userNames)}</span>
      </div>
    `;
  } else {
    assigneeHtml = `
      <div class="card-assignee-row">
        <span class="assignee-avatar" style="background-color: #f1f5f9; color: #94a3b8;" aria-hidden="true">&ndash;</span>
        <span class="assignee-name unassigned">Unassigned</span>
      </div>
    `;
  }

  // Quick move status options
  const quickMoveOptions = WORKFLOW_STATUSES.map((s) => {
    const selected = s === caseItem.workflowStatus ? "selected" : "";
    return `<option value="${escapeHtml(s)}" ${selected}>${escapeHtml(s)}</option>`;
  }).join("");

  return `
    <article class="kanban-card" draggable="true" data-case-id="${caseItem.id}">
      <div class="card-top-row">
        <span class="card-id-badge">#${caseItem.id}</span>
        <div class="card-badges-group">
          <span class="card-status-badge ${statusClass}">${escapeHtml(caseItem.workflowStatus)}</span>
          ${curationHtml}
        </div>
      </div>

      <a href="/?id=${caseItem.id}" target="_blank" class="kanban-card-title" title="Open Case #${caseItem.id} in Casebook editor">
        ${escapeHtml(caseItem.projectTitle || "Untitled Case")}
      </a>

      ${assigneeHtml}

      <div class="card-timestamps-row">
        <div class="timestamp-item" title="Created: ${escapeHtml(fullCreated)}">
          <span class="timestamp-icon" aria-hidden="true">📅</span>
          <span class="timestamp-text">Created ${escapeHtml(relativeCreated)}</span>
        </div>
        <div class="timestamp-item" title="Last updated: ${escapeHtml(fullUpdated)}">
          <span class="timestamp-icon" aria-hidden="true">🕒</span>
          <span class="timestamp-text">Updated ${escapeHtml(relativeUpdated)}</span>
        </div>
      </div>

      <div class="card-actions-row">
        <a href="/?id=${caseItem.id}" target="_blank" class="btn-card-open" title="Open Case #${caseItem.id} in editor">
          Open &rarr;
        </a>
        <select class="card-quick-status-select" data-case-id="${caseItem.id}" title="Move case to a different workflow status">
          ${quickMoveOptions}
        </select>
      </div>
    </article>
  `;
}

// ============================================================================
// Drag and Drop & Card Event Listeners
// ============================================================================

function attachCardEventListeners() {
  const cards = document.querySelectorAll(".kanban-card");
  cards.forEach((card) => {
    card.addEventListener("dragstart", handleCardDragStart);
    card.addEventListener("dragend", handleCardDragEnd);
  });

  const lists = document.querySelectorAll(".kanban-cards-list");
  lists.forEach((list) => {
    list.addEventListener("dragover", handleListDragOver);
    list.addEventListener("dragleave", handleListDragLeave);
    list.addEventListener("drop", handleListDrop);
  });

  const quickSelects = document.querySelectorAll(".card-quick-status-select");
  quickSelects.forEach((select) => {
    select.addEventListener("change", (e) => {
      const caseId = e.target.getAttribute("data-case-id");
      const newStatus = e.target.value;
      if (caseId && newStatus) {
        updateCaseWorkflowStatus(caseId, newStatus);
      }
    });
  });
}

function handleCardDragStart(e) {
  state.draggedCaseId = this.getAttribute("data-case-id");
  this.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", state.draggedCaseId);
}

function handleCardDragEnd() {
  this.classList.remove("is-dragging");
  state.draggedCaseId = null;
  document.querySelectorAll(".kanban-cards-list").forEach((list) => {
    list.classList.remove("drag-over");
  });
}

function handleListDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  this.classList.add("drag-over");
}

function handleListDragLeave() {
  this.classList.remove("drag-over");
}

function handleListDrop(e) {
  e.preventDefault();
  this.classList.remove("drag-over");
  const caseId = e.dataTransfer.getData("text/plain") || state.draggedCaseId;
  const newStatus = this.getAttribute("data-status");

  if (caseId && newStatus) {
    updateCaseWorkflowStatus(caseId, newStatus);
  }
}

// ============================================================================
// Column Collapse Management
// ============================================================================

function initColumnCollapseEvents() {
  // Column toggle collapse button inside header
  const toggleBtns = document.querySelectorAll(".btn-toggle-col");
  toggleBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const status = btn.getAttribute("data-toggle");
      toggleColumnCollapse(status);
    });
  });

  // Collapsed vertical strip click to expand
  const collapsedStrips = document.querySelectorAll(".column-collapsed-strip");
  collapsedStrips.forEach((strip) => {
    strip.addEventListener("click", () => {
      const status = strip.getAttribute("data-expand");
      toggleColumnCollapse(status, false);
    });
  });

  // Global toggle all button
  const toggleAllBtn = document.getElementById("kanbanToggleAllColsBtn");
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener("click", () => {
      const allCollapsed = WORKFLOW_STATUSES.every((s) => state.collapsedColumns.has(s));
      if (allCollapsed) {
        state.collapsedColumns.clear();
        toggleAllBtn.textContent = "Collapse All";
      } else {
        WORKFLOW_STATUSES.forEach((s) => state.collapsedColumns.add(s));
        toggleAllBtn.textContent = "Expand All";
      }
      persistCollapsedColumns();
      applyColumnCollapseStates();
    });
  }
}

function toggleColumnCollapse(status, forceState) {
  if (forceState !== undefined) {
    if (forceState) state.collapsedColumns.add(status);
    else state.collapsedColumns.delete(status);
  } else {
    if (state.collapsedColumns.has(status)) {
      state.collapsedColumns.delete(status);
    } else {
      state.collapsedColumns.add(status);
    }
  }

  persistCollapsedColumns();
  applyColumnCollapseStates();
}

function applyColumnCollapseStates() {
  WORKFLOW_STATUSES.forEach((status) => {
    const col = document.querySelector(`.kanban-column[data-status="${status}"]`);
    if (col) {
      const isCollapsed = state.collapsedColumns.has(status);
      col.classList.toggle("is-collapsed", isCollapsed);
    }
  });

  const toggleAllBtn = document.getElementById("kanbanToggleAllColsBtn");
  if (toggleAllBtn) {
    const allCollapsed = WORKFLOW_STATUSES.every((s) => state.collapsedColumns.has(s));
    toggleAllBtn.textContent = allCollapsed ? "Expand All" : "Collapse All";
  }
}

// ============================================================================
// Toolbar & Event Listeners
// ============================================================================

function initToolbarEventListeners() {
  const searchInput = document.getElementById("kanbanSearchInput");
  const clearBtn = document.getElementById("kanbanSearchClearBtn");
  const assigneeSelect = document.getElementById("kanbanAssigneeFilter");
  const sortSelect = document.getElementById("kanbanSortSelect");
  const refreshBtn = document.getElementById("kanbanRefreshBtn");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchTerm = e.target.value;
      if (clearBtn) {
        clearBtn.classList.toggle("hidden", !state.searchTerm);
      }
      renderKanbanBoard();
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      state.searchTerm = "";
      clearBtn.classList.add("hidden");
      renderKanbanBoard();
      searchInput.focus();
    });
  }

  if (assigneeSelect) {
    assigneeSelect.addEventListener("change", (e) => {
      state.assigneeFilter = e.target.value;
      renderKanbanBoard();
    });
  }

  const curationSelect = document.getElementById("kanbanCurationFilter");
  if (curationSelect) {
    curationSelect.addEventListener("change", (e) => {
      state.curationFilter = e.target.value;
      renderKanbanBoard();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      persistSortPreference();
      renderKanbanBoard();
    });
  }

  const loadMoreBtn = document.getElementById("kanbanLoadMoreBtn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", async () => {
      const token = getStaffTokenFromStorage();
      if (!token) return;
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = "Loading...";
      showToast("Loading remaining completed & archived cases...", "info");
      await fetchAndRenderKanbanData(token, { scope: "remaining", append: true });
      showToast(`Loaded cases (${state.cases.length} of ${state.totalCount} now loaded)`, "success");
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      const token = getStaffTokenFromStorage();
      if (token) {
        // If all cases were loaded, refresh all; otherwise refresh active batch
        const scope = state.cases.length > 50 ? "all" : "active";
        fetchAndRenderKanbanData(token, { scope });
        showToast("Refreshed case data.", "info");
      }
    });
  }
}

