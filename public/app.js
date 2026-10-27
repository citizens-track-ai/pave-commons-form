/**
 * PAVE Form Application Logic
 */

const state = {
  submissionIntent: "nomination",
  leadOrganisations: [],      // Array of { id, name } OR { name, isNew: true, website?: string }
  fundingOrganisations: [],
  involvedOrganisations: [],
  participants: [],          // Array of participant group objects
  resources: [],             // Array of resource objects
};

document.addEventListener("DOMContentLoaded", () => {
  initIntentToggle();
  initOrgPickers();
  initParticipantManager();
  initResourceManager();
  initFormSubmission();
});

/* -------------------------------------------------------------
 * 1. Nomination vs Full Case Toggle
 * ------------------------------------------------------------- */
function initIntentToggle() {
  const radios = document.querySelectorAll('input[name="submissionIntent"]');
  const fullSection = document.getElementById("fullCaseSection");

  radios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      state.submissionIntent = e.target.value;
      if (e.target.value === "full") {
        fullSection.classList.remove("hidden");
      } else {
        fullSection.classList.add("hidden");
      }
    });
  });
}

/* -------------------------------------------------------------
 * 2. Organisation Pickers (Search + Add If Not Found)
 * ------------------------------------------------------------- */
function initOrgPickers() {
  setupOrgPicker("leadOrgsPicker", "leadOrganisations");
  setupOrgPicker("fundingOrgsPicker", "fundingOrganisations");
  setupOrgPicker("involvedOrgsPicker", "involvedOrganisations");
}

function setupOrgPicker(containerId, stateKey) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="selected-tags" id="${containerId}_tags"></div>
    <div class="picker-search-box">
      <input type="text" class="org-search-input" placeholder="Type organisation name to search or add...">
      <div class="search-dropdown hidden"></div>
    </div>
  `;

  const tagsEl = container.querySelector(".selected-tags");
  const inputEl = container.querySelector(".org-search-input");
  const dropdownEl = container.querySelector(".search-dropdown");

  let debounceTimer;

  inputEl.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();

    // Measure 1.C: Require at least 2 characters before querying backend
    if (query.length < 2) {
      dropdownEl.innerHTML = "";
      dropdownEl.classList.add("hidden");
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        dropdownEl.innerHTML = `<div class="dropdown-item loading">Searching organisations...</div>`;
        dropdownEl.classList.remove("hidden");

        const res = await fetch(`/api/organisations?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        const results = data.list || [];
        const hasExactMatch = data.hasExactMatch || false;

        renderDropdownResults(dropdownEl, query, results, hasExactMatch, (selectedItem) => {
          // Check if already selected
          const alreadyAdded = state[stateKey].some(
            (o) => (o.id && o.id === selectedItem.id) || o.name.toLowerCase() === selectedItem.name.toLowerCase()
          );

          if (!alreadyAdded) {
            state[stateKey].push(selectedItem);
            renderSelectedTags(tagsEl, stateKey);
          }

          inputEl.value = "";
          dropdownEl.innerHTML = "";
          dropdownEl.classList.add("hidden");
        });
      } catch (err) {
        dropdownEl.innerHTML = `<div class="dropdown-item error">Error fetching results</div>`;
      }
    }, 250);
  });

  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) {
      dropdownEl.classList.add("hidden");
    }
  });
}

function renderDropdownResults(dropdownEl, query, results, hasExactMatch, onSelect) {
  dropdownEl.innerHTML = "";

  if (results.length > 0) {
    results.forEach((org) => {
      const itemEl = document.createElement("div");
      itemEl.className = "dropdown-item";
      itemEl.innerHTML = `<strong>${escapeHtml(org.name)}</strong>${org.website ? ` <small>(${escapeHtml(org.website)})</small>` : ""}`;
      itemEl.addEventListener("click", () => onSelect({ id: org.id, name: org.name }));
      dropdownEl.appendChild(itemEl);
    });
  }

  // If no exact match, allow adding
  if (!hasExactMatch) {
    const addNewEl = document.createElement("div");
    addNewEl.className = "dropdown-item add-new";
    addNewEl.innerHTML = `<em>+ Add new organisation:</em> <strong>"${escapeHtml(query)}"</strong>`;
    addNewEl.addEventListener("click", () => {
      onSelect({ name: query, isNew: true });
    });
    dropdownEl.appendChild(addNewEl);
  }

  dropdownEl.classList.remove("hidden");
}

function renderSelectedTags(tagsEl, stateKey) {
  tagsEl.innerHTML = "";
  state[stateKey].forEach((org, index) => {
    const tag = document.createElement("span");
    tag.className = "tag" + (org.isNew ? " tag-new" : "");
    tag.innerHTML = `
      ${escapeHtml(org.name)} ${org.isNew ? '<small>(New)</small>' : ''}
      <button type="button" aria-label="Remove">&times;</button>
    `;
    tag.querySelector("button").addEventListener("click", () => {
      state[stateKey].splice(index, 1);
      renderSelectedTags(tagsEl, stateKey);
    });
    tagsEl.appendChild(tag);
  });
}

/* -------------------------------------------------------------
 * 3. Participant Groups Repeater Manager
 * ------------------------------------------------------------- */
function initParticipantManager() {
  const listEl = document.getElementById("participantsList");
  const addBtn = document.getElementById("addParticipantBtn");
  const modal = document.getElementById("participantModal");
  const saveBtn = document.getElementById("saveParticipantBtn");
  const cancelBtn = document.getElementById("cancelParticipantBtn");
  const dialogForm = document.getElementById("participantDialogForm");

  addBtn.addEventListener("click", () => {
    if (state.participants.length >= 15) {
      alert("Maximum of 15 participant groups reached.");
      return;
    }
    dialogForm.reset();
    modal.showModal();
  });

  cancelBtn.addEventListener("click", () => modal.close());

  saveBtn.addEventListener("click", () => {
    const desc = document.getElementById("p_groupDescription").value.trim();
    if (!desc) {
      alert("Please provide a group description.");
      return;
    }

    const count = document.getElementById("p_participantCount").value;
    const hours = document.getElementById("p_engagementHours").value;
    const locations = getCheckedValues("p_location");
    const recMethod = document.getElementById("p_recruitmentMethod").value;
    const recDesc = document.getElementById("p_recruitmentDescription").value.trim();
    const targetPop = document.getElementById("p_targetPopulation").value.trim();
    const geo = document.getElementById("p_geographicOrigin").value.trim();
    const methods = getCheckedValues("p_methods");
    const learning = getCheckedValues("p_learning");
    const notes = document.getElementById("p_notes").value.trim();

    state.participants.push({
      groupDescription: desc,
      participantCount: count ? Math.abs(parseInt(count, 10)) : null,
      engagementHours: hours ? Math.abs(parseFloat(hours)) : null,
      engagementLocations: locations,
      recruitmentMethod: recMethod,
      recruitmentDescription: recDesc,
      targetPopulation: targetPop,
      geographicOrigin: geo,
      engagementMethods: methods,
      learningFacilitationOptions: learning,
      notes: notes,
    });

    renderParticipantsList(listEl);
    modal.close();
  });
}

function renderParticipantsList(listEl) {
  listEl.innerHTML = "";
  if (state.participants.length === 0) {
    listEl.innerHTML = `<p class="empty-note">No participant groups added yet.</p>`;
    return;
  }

  state.participants.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "repeater-card";
    card.innerHTML = `
      <div class="card-header">
        <strong>${idx + 1}. ${escapeHtml(p.groupDescription)}</strong>
        <button type="button" class="btn-remove" aria-label="Remove group">&times; Remove</button>
      </div>
      <div class="card-details">
        ${p.participantCount ? `<span><strong>Count:</strong> ${escapeHtml(p.participantCount)}</span> ` : ""}
        ${p.engagementHours ? `<span><strong>Hours:</strong> ${escapeHtml(p.engagementHours)}h</span> ` : ""}
        ${p.recruitmentMethod ? `<span><strong>Recruitment:</strong> ${escapeHtml(p.recruitmentMethod)}</span> ` : ""}
        ${p.engagementMethods && p.engagementMethods.length > 0 ? `<div><small>Methods: ${p.engagementMethods.map(escapeHtml).join(", ")}</small></div>` : ""}
      </div>
    `;
    card.querySelector(".btn-remove").addEventListener("click", () => {
      state.participants.splice(idx, 1);
      renderParticipantsList(listEl);
    });
    listEl.appendChild(card);
  });
}

/* -------------------------------------------------------------
 * 4. Resources Repeater Manager
 * ------------------------------------------------------------- */
function initResourceManager() {
  const listEl = document.getElementById("resourcesList");
  const addBtn = document.getElementById("addResourceBtn");
  const modal = document.getElementById("resourceModal");
  const saveBtn = document.getElementById("saveResourceBtn");
  const cancelBtn = document.getElementById("cancelResourceBtn");
  const dialogForm = document.getElementById("resourceDialogForm");

  addBtn.addEventListener("click", () => {
    if (state.resources.length >= 20) {
      alert("Maximum of 20 resources reached.");
      return;
    }
    dialogForm.reset();
    modal.showModal();
  });

  cancelBtn.addEventListener("click", () => modal.close());

  saveBtn.addEventListener("click", () => {
    const title = document.getElementById("r_title").value.trim();
    const url = document.getElementById("r_url").value.trim();
    if (!title || !url) {
      alert("Please provide both a resource title and URL.");
      return;
    }

    if (!isValidClientUrl(url)) {
      alert("Resource URL must start with http:// or https://");
      return;
    }

    state.resources.push({
      title,
      url,
      resourceType: document.getElementById("r_type").value,
      description: document.getElementById("r_desc").value.trim(),
      license: document.getElementById("r_license").value.trim(),
    });

    renderResourcesList(listEl);
    modal.close();
  });
}

function renderResourcesList(listEl) {
  listEl.innerHTML = "";
  if (state.resources.length === 0) {
    listEl.innerHTML = `<p class="empty-note">No resources added yet.</p>`;
    return;
  }

  state.resources.forEach((r, idx) => {
    const card = document.createElement("div");
    card.className = "repeater-card";
    card.innerHTML = `
      <div class="card-header">
        <strong>${idx + 1}. <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a></strong>
        <button type="button" class="btn-remove">&times; Remove</button>
      </div>
      <div><small>${escapeHtml(r.resourceType)}${r.description ? ` - ${escapeHtml(r.description)}` : ""}</small></div>
    `;
    card.querySelector(".btn-remove").addEventListener("click", () => {
      state.resources.splice(idx, 1);
      renderResourcesList(listEl);
    });
    listEl.appendChild(card);
  });
}

/* -------------------------------------------------------------
 * 5. Form Submission
 * ------------------------------------------------------------- */
function initFormSubmission() {
  const form = document.getElementById("caseForm");
  const statusEl = document.getElementById("statusMessage");
  const submitBtn = document.getElementById("submitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!document.getElementById("consentCheck").checked) {
      alert("Please check the consent box before submitting.");
      return;
    }

    const projectUrl = document.getElementById("projectUrl").value.trim();
    if (projectUrl && !isValidClientUrl(projectUrl)) {
      alert("Project URL must be a valid http:// or https:// address.");
      document.getElementById("projectUrl").focus();
      return;
    }

    const email = document.getElementById("submitterEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert("Please enter a valid email address.");
      document.getElementById("submitterEmail").focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
    statusEl.className = "status-msg";
    statusEl.textContent = "Sending your case submission to NocoDB...";
    statusEl.classList.remove("hidden");

    const payload = {
      // Submitter
      submitterName: document.getElementById("submitterName").value.trim(),
      submitterEmail: email,
      submitterRoles: getCheckedValues("submitterRoles"),
      submissionIntent: state.submissionIntent,
      additionalAcknowledgements: document.getElementById("additionalAcknowledgements").value.trim(),

      // Project Details
      projectTitle: document.getElementById("projectTitle").value.trim(),
      projectUrl: projectUrl,
      projectDescription: document.getElementById("projectDescription").value.trim(),
      importanceReason: document.getElementById("importanceReason").value.trim(),
      initiatedMethods: getCheckedValues("initiatedMethods"),
      startYear: document.getElementById("startYear").value || null,
      projectStatus: document.getElementById("projectStatus").value || null,
      endYear: document.getElementById("endYear").value || null,

      // Full Case Fields
      leadOrganisations: state.leadOrganisations,
      fundingOrganisations: state.fundingOrganisations,
      involvedOrganisations: state.involvedOrganisations,
      aiForms: getCheckedValues("aiForms"),
      subjectMatter: document.getElementById("subjectMatter").value.trim(),
      projectGoals: getCheckedValues("projectGoals"),
      participants: state.participants,
      inclusionEfforts: document.getElementById("inclusionEfforts").value.trim(),
      limitations: document.getElementById("limitations").value.trim(),
      headlineFindings: document.getElementById("headlineFindings").value.trim(),
      aiAssistance: getCheckedValues("aiAssistance"),
      publishedResources: getCheckedValues("publishedResources"),
      resources: state.resources,
      photosAvailable: getCheckedValues("photosAvailable"),
    };

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Submission could not be completed.");
      }

      statusEl.className = "status-msg success";
      statusEl.innerHTML = `
        <h3>Thank You!</h3>
        <p>${escapeHtml(result.message || "Your submission was successfully recorded.")}</p>
        <p><small>Reference Case Record ID: #${escapeHtml(result.caseId)}</small></p>
      `;

      form.reset();
      state.leadOrganisations = [];
      state.fundingOrganisations = [];
      state.involvedOrganisations = [];
      state.participants = [];
      state.resources = [];
      renderParticipantsList(document.getElementById("participantsList"));
      renderResourcesList(document.getElementById("resourcesList"));
      document.querySelectorAll(".selected-tags").forEach((el) => (el.innerHTML = ""));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      statusEl.className = "status-msg error";
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Case Entry";
    }
  });
}

/* -------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------- */
function getCheckedValues(name) {
  const checked = document.querySelectorAll(`input[name="${name}"]:checked`);
  return Array.from(checked).map((el) => el.value);
}

function isValidClientUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
