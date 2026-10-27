/**
 * Cloudflare Worker for PAVE Casebook Form
 * 
 * Interacts with NocoDB dataset:
 * Base ID: p1t9vvz76dbkcv8
 * Cases Table: m1e33iafsgoy4re
 * Organisations Table: mecsh2ykfxm0s2f
 * Participants Table: mtys2m273atfyd9
 * Resources Table: mm1j25f6w0s1hsn
 */

const NOCODB_DEFAULT_BASE_URL = "https://app.nocodb.com";
const BASE_ID = "p1t9vvz76dbkcv8";

const TABLES = {
  CASES: "m1e33iafsgoy4re",
  ORGANISATIONS: "mecsh2ykfxm0s2f",
  PARTICIPANTS: "mtys2m273atfyd9",
  RESOURCES: "mm1j25f6w0s1hsn",
};

const LINK_FIELDS = {
  CASE_LEAD_ORGS: "cfsr6shftjp5rh8",
  CASE_FUNDING_ORGS: "ctry6dyg5238w16",
  CASE_INVOLVED_ORGS: "crlcp2kthfjwijy",
  CASE_PARTICIPANTS: "clfmrd6qe6r4l6w",
  PARTICIPANT_CASE: "cl440n84ovf0nxu",
  RESOURCE_CASE: "cd7i3ulk36wvuhg",
};

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100 KB limit
const MAX_PARTICIPANTS = 15;
const MAX_RESOURCES = 20;
const MAX_ORGS_PER_FIELD = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const nocodbBaseUrl = env.NOCODB_BASE_URL || NOCODB_DEFAULT_BASE_URL;
    const nocodbToken = env.NOCODB_API_TOKEN;

    if (!nocodbToken && url.pathname.startsWith("/api/")) {
      console.error("Configuration error: NOCODB_API_TOKEN is missing.");
      return jsonResponse(
        { error: "Server configuration error. Please contact administrator." },
        500,
        corsHeaders
      );
    }

    try {
      // 1. Search organisations endpoint
      if (url.pathname === "/api/organisations" && request.method === "GET") {
        return await handleSearchOrganisations(url, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 2. Submit Case Form endpoint
      if (url.pathname === "/api/submit" && request.method === "POST") {
        return await handleSubmitCase(request, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 3. Static asset serving when deployed as Cloudflare Worker with [assets]
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return jsonResponse({ error: "Endpoint not found" }, 404, corsHeaders);
    } catch (err) {
      console.error("Worker unhandled error:", err);
      return jsonResponse(
        { error: "An unexpected error occurred. Please try again later." },
        500,
        corsHeaders
      );
    }
  },
};

/**
 * Handle searching organisations in NocoDB table
 * Enforces sanitization and minimum length to prevent filter injection and full table scraping.
 */
async function handleSearchOrganisations(url, baseUrl, token, corsHeaders) {
  const rawQuery = url.searchParams.get("q") || "";
  const query = sanitizeSearchQuery(rawQuery);

  // Measure 1.C: Disallow empty or 1-character queries to prevent full database enumeration
  if (query.length < 2) {
    return jsonResponse(
      {
        list: [],
        query,
        hasExactMatch: false,
        message: "Please enter at least 2 characters to search.",
      },
      200,
      { ...corsHeaders, "Cache-Control": "public, max-age=60" }
    );
  }

  // Measure 1.B: Filter injection prevention: safe alphanumeric string with strict operators
  const encodedQuery = encodeURIComponent(`(Name,like,%${query}%)`);
  const nocoUrl = `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records?where=${encodedQuery}&limit=25&fields=Id,Name,Website address,Organisation type`;

  const res = await fetch(nocoUrl, {
    headers: { "xc-token": token },
  });

  if (!res.ok) {
    const errorDetails = await res.text();
    // Measure 3.C: Mask internal error details from public response
    console.error("NocoDB query error:", res.status, errorDetails);
    return jsonResponse(
      { error: "Failed to search organisations. Please try again." },
      502,
      corsHeaders
    );
  }

  const data = await res.json();
  const list = (data.list || []).map(formatOrg);

  // Check if there is an exact case-insensitive match
  const hasExactMatch = list.some(
    (org) => org.name.toLowerCase() === query.toLowerCase()
  );

  return jsonResponse(
    {
      list,
      query,
      hasExactMatch,
    },
    200,
    {
      ...corsHeaders,
      // Cache common searches at Cloudflare Edge for 60 seconds
      "Cache-Control": "public, max-age=60",
    }
  );
}

function formatOrg(raw) {
  return {
    id: raw.Id || raw.id,
    name: sanitizeString(raw.Name || raw["cqkqjxbtc9sjzuk"] || "Untitled Organisation", 200),
    website: sanitizeString(raw["Website address"] || raw["c68nspve2ypnur8"] || "", 255),
    type: raw["Organisation type"] || raw["cwhtaz65osbz1ql"] || [],
  };
}

/**
 * Handle complete Case submission
 * Enforces size limits, strict URL checks, bounded arrays, and sanitized errors.
 */
async function handleSubmitCase(request, baseUrl, token, corsHeaders) {
  // Measure 3.A: Request body size limit
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return jsonResponse(
      { error: "Request payload too large. Maximum allowed size is 100 KB." },
      413,
      corsHeaders
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, 400, corsHeaders);
  }

  if (!payload || typeof payload !== "object") {
    return jsonResponse({ error: "Invalid request format." }, 400, corsHeaders);
  }

  // Validate required Project Title
  const projectTitle = sanitizeString(payload.projectTitle, 250);
  if (!projectTitle) {
    return jsonResponse({ error: "Project Title is required." }, 400, corsHeaders);
  }

  // Validate Submitter Email
  const submitterEmail = sanitizeString(payload.submitterEmail, 150);
  if (!submitterEmail || !isValidEmail(submitterEmail)) {
    return jsonResponse(
      { error: "A valid contact email address is required." },
      400,
      corsHeaders
    );
  }

  // Measure 3.B: Strict URL validation on Project URL
  const projectUrl = sanitizeString(payload.projectUrl, 500);
  if (projectUrl && !isValidHttpUrl(projectUrl)) {
    return jsonResponse(
      { error: "Project URL must be a valid http:// or https:// address." },
      400,
      corsHeaders
    );
  }

  // Step 1: Resolve organisations (Lead, Funding, Involved) with bounded array length
  const leadOrgIds = await resolveOrganisations(
    clampArray(payload.leadOrganisations, MAX_ORGS_PER_FIELD),
    baseUrl,
    token
  );
  const fundingOrgIds = await resolveOrganisations(
    clampArray(payload.fundingOrganisations, MAX_ORGS_PER_FIELD),
    baseUrl,
    token
  );
  const involvedOrgIds = await resolveOrganisations(
    clampArray(payload.involvedOrganisations, MAX_ORGS_PER_FIELD),
    baseUrl,
    token
  );

  // Step 2: Prepare sanitized Case record
  const isNomination = payload.submissionIntent === "nomination";
  const caseData = {
    // Basic Details
    "Project Title": projectTitle,
    "Project URL": projectUrl || null,
    "Provide a brief description of the project": sanitizeString(payload.projectDescription, 10000) || null,
    "Why is this project important to include in the case book?": sanitizeString(payload.importanceReason, 5000) || null,
    "How was the project initiated?": sanitizeStringArray(payload.initiatedMethods, 5),
    "What year did the project start?": clampNumber(payload.startYear, 1950, 2050),
    "Project status": sanitizeAllowedOption(payload.projectStatus, ["Planned", "In Progress", "Complete"]),
    "What year did the project conclude?": clampNumber(payload.endYear, 1950, 2050),

    // Submitter
    "Submitted by": sanitizeString(payload.submitterName, 150) || null,
    "Contact e-mail": submitterEmail,
    "Submitter role": sanitizeStringArray(payload.submitterRoles, 10),
    "Workflow: Status": isNomination ? "Nomination" : "Submission",
    "Additional acknowledgements": sanitizeString(payload.additionalAcknowledgements, 500) || null,

    // Full Case Fields
    "What form of AI is the project about?": sanitizeStringArray(payload.aiForms, 10),
    "Describe the subject matter in your own words (one line)": sanitizeString(payload.subjectMatter, 300) || null,
    "Project goals": sanitizeStringArray(payload.projectGoals, 15),
    "Inclusion efforts": sanitizeString(payload.inclusionEfforts, 5000) || null,
    "What limitations to the project should be noted?": sanitizeString(payload.limitations, 5000) || null,
    "Headline findings": sanitizeString(payload.headlineFindings, 10000) || null,
    "Was AI used to assist in summary generation?": sanitizeStringArray(payload.aiAssistance, 5),
    "Which of the following resources are available for this project?": sanitizeStringArray(payload.publishedResources, 10),
    "Photos available?": sanitizeStringArray(payload.photosAvailable, 5),
  };

  if (leadOrgIds.length > 0) {
    caseData["Lead organisations"] = leadOrgIds.map((id) => ({ Id: id }));
  }
  if (fundingOrgIds.length > 0) {
    caseData["Funding Organisations"] = fundingOrgIds.map((id) => ({ Id: id }));
  }
  if (involvedOrgIds.length > 0) {
    caseData["Involved organisations"] = involvedOrgIds.map((id) => ({ Id: id }));
  }

  // Create Case in NocoDB
  const caseCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
    method: "POST",
    headers: {
      "xc-token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([caseData]),
  });

  if (!caseCreateRes.ok) {
    const errText = await caseCreateRes.text();
    // Measure 3.C: Mask internal schema details from client
    console.error("NocoDB Case creation error:", caseCreateRes.status, errText);
    return jsonResponse(
      { error: "Unable to save case submission in database. Please check your entries." },
      502,
      corsHeaders
    );
  }

  const createdCaseRecords = await caseCreateRes.json();
  const createdCase = Array.isArray(createdCaseRecords) ? createdCaseRecords[0] : createdCaseRecords;
  const caseId = createdCase.Id || createdCase.id;

  // Step 3: Link organisations explicitly to guarantee M:M relations
  await linkRecordsInTable(TABLES.CASES, LINK_FIELDS.CASE_LEAD_ORGS, caseId, leadOrgIds, baseUrl, token);
  await linkRecordsInTable(TABLES.CASES, LINK_FIELDS.CASE_FUNDING_ORGS, caseId, fundingOrgIds, baseUrl, token);
  await linkRecordsInTable(TABLES.CASES, LINK_FIELDS.CASE_INVOLVED_ORGS, caseId, involvedOrgIds, baseUrl, token);

  // Step 4: Create Participant records (clamped to MAX_PARTICIPANTS)
  const rawParticipants = clampArray(payload.participants, MAX_PARTICIPANTS);
  const participantIds = [];

  if (rawParticipants.length > 0) {
    const participantRecords = rawParticipants.map((p) => ({
      "Group description": sanitizeString(p.groupDescription, 250) || "Participant Group",
      "How many people took part?": clampNumber(p.participantCount, 0, 10000000),
      "On average, how many hours did each participant engage for?": clampNumber(p.engagementHours, 0, 10000),
      "Where did engagement take place?": sanitizeStringArray(p.engagementLocations, 5),
      "Recruitment method": sanitizeString(p.recruitmentMethod, 100) || null,
      "Recruitment description": sanitizeString(p.recruitmentDescription, 1000) || null,
      "Was there a specific target population?": sanitizeString(p.targetPopulation, 500) || null,
      "Where were participants from?": sanitizeString(p.geographicOrigin, 500) || null,
      "Which of the following methods were used to engage participants?": sanitizeStringArray(p.engagementMethods, 20),
      "Do any of the following apply?": sanitizeStringArray(p.learningFacilitationOptions, 5),
      "Additional notes": sanitizeString(p.notes, 3000) || null,
      "Cases": [{ Id: caseId }],
    }));

    const partCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records`, {
      method: "POST",
      headers: {
        "xc-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(participantRecords),
    });

    if (partCreateRes.ok) {
      const createdParts = await partCreateRes.json();
      const list = Array.isArray(createdParts) ? createdParts : [createdParts];
      list.forEach((rec) => participantIds.push(rec.Id || rec.id));

      await linkRecordsInTable(
        TABLES.CASES,
        LINK_FIELDS.CASE_PARTICIPANTS,
        caseId,
        participantIds,
        baseUrl,
        token
      );
    } else {
      console.error("Failed to create participants:", await partCreateRes.text());
    }
  }

  // Step 5: Create Supporting Resources (clamped to MAX_RESOURCES, URLs verified)
  const rawResources = clampArray(payload.resources, MAX_RESOURCES);
  if (rawResources.length > 0) {
    const validResourceRecords = [];

    for (const r of rawResources) {
      const title = sanitizeString(r.title, 250);
      const resUrl = sanitizeString(r.url, 500);

      // Validate URL before writing
      if (title && resUrl && isValidHttpUrl(resUrl)) {
        validResourceRecords.push({
          "Title": title,
          "URL": resUrl,
          "Select": sanitizeString(r.resourceType, 100) || "Other",
          "Short description": sanitizeString(r.description, 1000) || null,
          "License": sanitizeString(r.license, 100) || null,
          "Cases": [{ Id: caseId }],
        });
      }
    }

    if (validResourceRecords.length > 0) {
      await fetch(`${baseUrl}/api/v2/tables/${TABLES.RESOURCES}/records`, {
        method: "POST",
        headers: {
          "xc-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validResourceRecords),
      });
    }
  }

  return jsonResponse(
    {
      success: true,
      caseId,
      status: isNomination ? "Nomination" : "Submission",
      message: isNomination
        ? "Project nomination recorded successfully."
        : "Full case study entry submitted successfully.",
    },
    200,
    corsHeaders
  );
}

/**
 * Resolves an array of organisation items.
 * Validates IDs or sanitizes new names. Checks for duplicate before insert.
 */
async function resolveOrganisations(orgsList, baseUrl, token) {
  if (!Array.isArray(orgsList) || orgsList.length === 0) return [];

  const finalIds = [];

  for (const item of orgsList) {
    if (!item) continue;

    // Existing numeric ID
    if (typeof item === "number" || (typeof item === "string" && !isNaN(Number(item)))) {
      finalIds.push(Number(item));
      continue;
    }

    if (item.id && !isNaN(Number(item.id))) {
      finalIds.push(Number(item.id));
      continue;
    }

    // New organisation creation
    const name = sanitizeString(item.name, 200);
    if (!name || name.length < 2) continue;

    const safeNameQuery = sanitizeSearchQuery(name);
    const encodedWhere = encodeURIComponent(`(Name,eq,${safeNameQuery})`);

    const checkRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records?where=${encodedWhere}&limit=1`,
      { headers: { "xc-token": token } }
    );

    if (checkRes.ok) {
      const checkData = await checkRes.json();
      if (checkData.list && checkData.list.length > 0) {
        finalIds.push(checkData.list[0].Id || checkData.list[0].id);
        continue;
      }
    }

    // Validate website if provided
    let website = sanitizeString(item.website, 255);
    if (website && !isValidHttpUrl(website)) {
      website = null;
    }

    const createRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records`, {
      method: "POST",
      headers: {
        "xc-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          "Name": name,
          "Website address": website,
          "Organisation type": sanitizeStringArray(item.type, 5),
        },
      ]),
    });

    if (createRes.ok) {
      const created = await createRes.json();
      const rec = Array.isArray(created) ? created[0] : created;
      finalIds.push(rec.Id || rec.id);
    } else {
      console.error("Failed to create organisation:", await createRes.text());
    }
  }

  return [...new Set(finalIds)];
}

/**
 * Link records helper
 */
async function linkRecordsInTable(tableId, fieldId, parentRecordId, childIds, baseUrl, token) {
  // NocoDB v2 API requires an array: [{ id: parentId, links: [{ id: childId }] }]
  const body = [
    {
      id: parentRecordId,
      links: childIds.map((id) => ({ id: Number(id) || id })),
    },
  ];

  try {
    const res = await fetch(`${baseUrl}/api/v2/tables/${tableId}/links/${fieldId}/records`, {
      method: "POST",
      headers: {
        "xc-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`Link failed on table ${tableId}, field ${fieldId}:`, await res.text());
    }
  } catch (err) {
    console.warn(`Link exception on table ${tableId}, field ${fieldId}:`, err);
  }
}

/* -------------------------------------------------------------
 * Security & Validation Sanitizers
 * ------------------------------------------------------------- */

/**
 * Strips out characters that have special syntactic meaning in NocoDB query filters:
 * ( ) ~ , " ' \ ; < > ` and control characters
 */
function sanitizeSearchQuery(query) {
  if (!query || typeof query !== "string") return "";
  return query
    .replace(/[()~,"'\\;<>`\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, 60);
}

function sanitizeString(val, maxLen = 1000) {
  if (!val || typeof val !== "string") return "";
  return val.trim().slice(0, maxLen);
}

function sanitizeStringArray(arr, maxItems = 10) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, maxItems)
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => sanitizeString(item, 150));
}

function sanitizeAllowedOption(val, allowedList) {
  if (typeof val === "string" && allowedList.includes(val)) {
    return val;
  }
  return null;
}

function clampArray(arr, maxItems) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, maxItems);
}

function clampNumber(val, min, max) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n);
}

function isValidHttpUrl(str) {
  if (!str || typeof str !== "string") return false;
  try {
    const parsed = new URL(str);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidEmail(email) {
  if (!email || typeof email !== "string" || email.length > 150) return false;
  // Standard RFC 5322 compatible check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * CORS Headers: Unrestricted for now (*)
 */
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}
