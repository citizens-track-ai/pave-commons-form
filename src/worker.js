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
  MESSAGES: "mujfx489gv4v1co",
  LOCATIONS: "m585w7nu1pegh83",
};

const LINK_FIELDS = {
  CASE_LEAD_ORGS: "cfsr6shftjp5rh8",
  CASE_FUNDING_ORGS: "ctry6dyg5238w16",
  CASE_INVOLVED_ORGS: "crlcp2kthfjwijy",
  CASE_PARTICIPANTS: "clfmrd6qe6r4l6w",
  CASE_RESOURCES: "c3ph7cav2ieep3q",
  CASE_MESSAGES: "cgcjd052mayfjgo",
  CASE_GEOGRAPHIC_SCOPE: "cjgs1ukudtfjqaf",
  PARTICIPANT_LOCATIONS: "cdbtgywt4pvvq3s",
  ORG_MAIN_LOCATION: "cxcwwaqmg6y6jnr",
};

const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB JSON payload limit (includes attachment metadata)
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB multipart upload ceiling
const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024; // 20 MB per file limit
const MAX_PARTICIPANTS = 15;
const MAX_RESOURCES = 20;
const MAX_PHOTOS = 20;
const MAX_RESOURCE_ATTACHMENTS = 10;
const MAX_ORGS_PER_FIELD = 20;
const MAX_LOCATIONS_PER_PARTICIPANT = 15;
const MAX_MESSAGES = 100;

const IGNORED_LOCATIONS = new Set([
  "global",
  "worldwide",
  "international",
  "online",
  "various",
  "remote",
  "virtual",
  "n/a",
  "none",
]);

const DEFAULT_BASE_USERS = [
  {
    id: "us5nvhvq95j37vp5",
    email: "tim@connectedbydata.org",
    displayName: "Tim Davies (tim@connectedbydata.org)",
  },
  {
    id: "usv7ahgu9u2ns73y",
    email: "tim@timdavies.org.uk",
    displayName: "Tim Davies (tim@timdavies.org.uk)",
  },
  {
    id: "usrqnz1nzzxr3stp",
    email: "s.m.oman@sheffield.ac.uk",
    displayName: "Susan Oman (s.m.oman@sheffield.ac.uk)",
  },
  {
    id: "uslf10bkngeczubb",
    email: "emilysrempel@gmail.com",
    displayName: "Emily Rempel (emilysrempel@gmail.com)",
  },
  {
    id: "usei5sx80e62l60r",
    email: "ksisya@adalovelaceinstitute.org",
    displayName: "ksisya@adalovelaceinstitute.org",
  },
  {
    id: "usn48uwujbvfumbp",
    email: "rmodhvadia@adalovelaceinstitute.org",
    displayName: "rmodhvadia@adalovelaceinstitute.org",
  },
  {
    id: "usxzqo5h8ybzegmf",
    email: "eokeeffe@adalovelaceinstitute.org",
    displayName: "eokeeffe@adalovelaceinstitute.org",
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
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

      // 1b. Search / geocode locations endpoint
      if (url.pathname === "/api/locations" && request.method === "GET") {
        return await handleSearchLocations(url, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 1c. Update organisation details (Staff only)
      if (url.pathname === "/api/organisations/update" && (request.method === "POST" || request.method === "PATCH")) {
        return await handleUpdateOrganisation(request, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 1d. Update location details (Staff only)
      if (url.pathname === "/api/locations/update" && (request.method === "POST" || request.method === "PATCH")) {
        return await handleUpdateLocation(request, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 1e. Kanban cases listing endpoint (Staff only)
      if (url.pathname === "/api/kanban/cases" && request.method === "GET") {
        return await handleGetKanbanCases(request, url, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 1f. Kanban workflow/assignee update endpoint (Staff only)
      if (url.pathname === "/api/kanban/case/workflow" && (request.method === "POST" || request.method === "PATCH")) {
        return await handleUpdateKanbanWorkflow(request, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 2. Staff authentication check endpoint
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        return await handleAuthMe(request, nocodbBaseUrl, corsHeaders);
      }

      // 3. Load case for editing endpoint
      if (url.pathname === "/api/case" && request.method === "GET") {
        return await handleGetCaseForEdit(request, url, nocodbBaseUrl, nocodbToken, corsHeaders, env);
      }

      // 4. Case Comments & Revision History endpoint (Staff only)
      if (url.pathname === "/api/case/comments" && (request.method === "GET" || request.method === "POST")) {
        return await handleCaseComments(request, url, nocodbBaseUrl, corsHeaders, env);
      }

      // 5. File Upload proxy endpoint (Photos & Resource Attachments -> NocoDB Storage)
      if (url.pathname === "/api/upload" && request.method === "POST") {
        return await handleFileUpload(request, url, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 6. Submit or Edit Case Form endpoint
      if (url.pathname === "/api/submit" && request.method === "POST") {
        return await handleSubmitOrEditCase(request, nocodbBaseUrl, nocodbToken, corsHeaders);
      }

      // 6. Static asset serving when deployed as Cloudflare Worker with [assets]
      if (env.ASSETS) {
        if (url.pathname === "/kanban") {
          const kanbanUrl = new URL(request.url);
          kanbanUrl.pathname = "/kanban.html";
          return await env.ASSETS.fetch(new Request(kanbanUrl, request));
        }
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
 */
async function handleSearchOrganisations(url, baseUrl, token, corsHeaders) {
  const rawQuery = url.searchParams.get("q") || "";
  const query = sanitizeSearchQuery(rawQuery);

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

  const encodedQuery = encodeURIComponent(`(Name,like,%${query}%)`);
  const nocoUrl = `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records?where=${encodedQuery}&limit=25&fields=Id,Name,Website address,Organisation type,Main Location`;

  const res = await fetch(nocoUrl, {
    headers: { "xc-token": token },
  });

  if (!res.ok) {
    const errorDetails = await res.text();
    console.error("NocoDB query error:", res.status, errorDetails);
    return jsonResponse(
      { error: "Failed to search organisations. Please try again." },
      502,
      corsHeaders
    );
  }

  const data = await res.json();
  const rawOrgs = data.list || [];

  // Batch-fetch linked Main Location details so selected organisations immediately have map coordinates
  const locIds = [];
  for (const org of rawOrgs) {
    for (const loc of org["Main Location"] || []) {
      const lid = typeof loc === "object" && loc !== null ? loc.Id || loc.id : loc;
      if (lid && !isNaN(Number(lid))) locIds.push(Number(lid));
    }
  }
  const locMap = await fetchLocationMap(locIds, baseUrl, token);

  const list = rawOrgs.map((raw) => formatOrg(raw, locMap));

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
      "Cache-Control": "public, max-age=60",
    }
  );
}

function formatOrg(raw, locMap = null) {
  const rawLocs = raw["Main Location"] || [];
  const locations = [];
  for (const l of rawLocs) {
    const lid = Number(typeof l === "object" && l !== null ? l.Id || l.id : l);
    if (locMap && locMap.has(lid)) {
      locations.push(locMap.get(lid));
    } else if (typeof l === "object" && l !== null && (l.Name || l.name)) {
      locations.push({
        id: lid || null,
        name: sanitizeString(l.Name || l.name, 200),
        latitude: l.Latitude !== undefined ? Number(l.Latitude) : null,
        longitude: l.Longitude !== undefined ? Number(l.Longitude) : null,
        countryCode: l["Country Code"] || l.countryCode || "",
      });
    }
  }

  return {
    id: raw.Id || raw.id,
    name: sanitizeString(raw.Name || raw["cqkqjxbtc9sjzuk"] || "Untitled Organisation", 200),
    website: sanitizeString(raw["Website address"] || raw["c68nspve2ypnur8"] || "", 255),
    type: raw["Organisation type"] || raw["cwhtaz65osbz1ql"] || [],
    locations,
  };
}

/**
 * Handle updating an organisation record in NocoDB (Staff only)
 */
async function handleUpdateOrganisation(request, baseUrl, token, corsHeaders) {
  const staff = await verifyStaffUser(request, baseUrl);
  if (!staff.isAuthenticated || !staff.canEdit) {
    return jsonResponse({ error: "Staff edit permissions required." }, 401, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400, corsHeaders);
  }

  const orgId = Number(body.id);
  if (!orgId || isNaN(orgId)) {
    return jsonResponse({ error: "Valid organisation ID is required." }, 400, corsHeaders);
  }

  const name = sanitizeString(body.name, 200);
  if (!name) {
    return jsonResponse({ error: "Organisation title cannot be empty." }, 400, corsHeaders);
  }

  const website = sanitizeString(body.website, 255);
  const rawTypes = Array.isArray(body.type)
    ? body.type
    : typeof body.type === "string" && body.type.trim()
    ? body.type.split(",").map((s) => s.trim())
    : [];

  const ALLOWED_TYPES = new Set([
    "Private sector",
    "Funder",
    "Public sector",
    "Non-profit",
    "Research",
    "Individual Donor",
  ]);
  const types = rawTypes.filter((t) => ALLOWED_TYPES.has(t));

  const writeToken = token || staff.userToken;

  const patchPayload = {
    Id: orgId,
    Name: name,
    "Website address": website || null,
    "Organisation type": types,
  };

  const patchRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records`, {
    method: "PATCH",
    headers: {
      "xc-token": writeToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([patchPayload]),
  });

  if (!patchRes.ok) {
    const errText = await patchRes.text();
    console.error("Failed to update organisation:", patchRes.status, errText);
    return jsonResponse({ error: "Failed to update organisation record in database." }, 502, corsHeaders);
  }

  // Handle Main Location link if specified
  if (body.mainLocation !== undefined || body.mainLocationId !== undefined) {
    try {
      const getOrgRes = await fetch(
        `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records/${orgId}?fields=Id,Main Location`,
        { headers: { "xc-token": writeToken } }
      );
      let currentLocIds = [];
      if (getOrgRes.ok) {
        const existingData = await getOrgRes.json();
        currentLocIds = extractIds(existingData["Main Location"]);
      }

      let desiredLocIds = [];
      if (body.mainLocation && typeof body.mainLocation === "object") {
        desiredLocIds = await resolveLocations([body.mainLocation], baseUrl, writeToken);
      } else if (body.mainLocationId && !isNaN(Number(body.mainLocationId))) {
        desiredLocIds = [Number(body.mainLocationId)];
      }

      await syncTableLinks(
        TABLES.ORGANISATIONS,
        LINK_FIELDS.ORG_MAIN_LOCATION,
        orgId,
        desiredLocIds,
        currentLocIds,
        baseUrl,
        writeToken
      );
    } catch (locErr) {
      console.warn("Failed to sync organisation Main Location link:", locErr);
    }
  }

  // Fetch updated organisation to return fresh formatted object
  try {
    const freshRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records/${orgId}?fields=Id,Name,Website address,Organisation type,Main Location`,
      { headers: { "xc-token": writeToken } }
    );
    if (freshRes.ok) {
      const freshData = await freshRes.json();
      const locIds = extractIds(freshData["Main Location"]);
      const locMap = await fetchLocationMap(locIds, baseUrl, writeToken);
      const formatted = formatOrg(freshData, locMap);
      return jsonResponse({ success: true, organisation: formatted }, 200, corsHeaders);
    }
  } catch (_) {}

  return jsonResponse(
    {
      success: true,
      organisation: {
        id: orgId,
        name,
        website,
        type: types,
        locations: [],
      },
    },
    200,
    corsHeaders
  );
}

/**
 * Handle updating a location record in NocoDB (Staff only)
 */
async function handleUpdateLocation(request, baseUrl, token, corsHeaders) {
  const staff = await verifyStaffUser(request, baseUrl);
  if (!staff.isAuthenticated || !staff.canEdit) {
    return jsonResponse({ error: "Staff edit permissions required." }, 401, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400, corsHeaders);
  }

  const locId = Number(body.id);
  if (!locId || isNaN(locId)) {
    return jsonResponse({ error: "Valid location ID is required." }, 400, corsHeaders);
  }

  const name = sanitizeString(body.name, 200);
  if (!name) {
    return jsonResponse({ error: "Location name cannot be empty." }, 400, corsHeaders);
  }

  let latitude =
    body.latitude !== undefined && body.latitude !== null && body.latitude !== ""
      ? Number(body.latitude)
      : null;
  if (isNaN(latitude)) latitude = null;

  let longitude =
    body.longitude !== undefined && body.longitude !== null && body.longitude !== ""
      ? Number(body.longitude)
      : null;
  if (isNaN(longitude)) longitude = null;

  const rawCountryCode = sanitizeString(body.countryCode || "", 10);
  const countryCode = rawCountryCode ? rawCountryCode.toUpperCase() : null;

  const writeToken = token || staff.userToken;

  const patchPayload = {
    Id: locId,
    Name: name,
    Latitude: latitude,
    Longitude: longitude,
    "Country Code": countryCode,
  };

  const patchRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.LOCATIONS}/records`, {
    method: "PATCH",
    headers: {
      "xc-token": writeToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([patchPayload]),
  });

  if (!patchRes.ok) {
    const errText = await patchRes.text();
    console.error("Failed to update location:", patchRes.status, errText);
    return jsonResponse({ error: "Failed to update location record in database." }, 502, corsHeaders);
  }

  return jsonResponse(
    {
      success: true,
      location: {
        id: locId,
        name,
        latitude,
        longitude,
        countryCode: countryCode || "",
      },
    },
    200,
    corsHeaders
  );
}

/**
 * Handle searching or geocoding locations in NocoDB Locations table
 */
async function handleSearchLocations(url, baseUrl, token, corsHeaders) {
  const rawQuery = url.searchParams.get("q") || "";
  const query = sanitizeSearchQuery(rawQuery);
  const wantGeocode = url.searchParams.get("geocode") === "1";

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

  if (wantGeocode) {
    const countryCode = url.searchParams.get("countryCode") || url.searchParams.get("cc") || "";
    const geo = await geocodeLocationName(query, countryCode);
    return jsonResponse(
      {
        query,
        countryCode,
        geocoded: geo,
      },
      200,
      { ...corsHeaders, "Cache-Control": "public, max-age=300" }
    );
  }

  const encodedQuery = encodeURIComponent(`(Name,like,%${query}%)`);
  const nocoUrl = `${baseUrl}/api/v2/tables/${TABLES.LOCATIONS}/records?where=${encodedQuery}&limit=25&fields=Id,Name,Latitude,Longitude,Country Code`;

  const res = await fetch(nocoUrl, {
    headers: { "xc-token": token },
  });

  if (!res.ok) {
    const errorDetails = await res.text();
    console.error("NocoDB locations query error:", res.status, errorDetails);
    return jsonResponse(
      { error: "Failed to search locations. Please try again." },
      502,
      corsHeaders
    );
  }

  const data = await res.json();
  const list = (data.list || []).map(formatLocation);

  const hasExactMatch = list.some(
    (loc) => loc.name.toLowerCase() === query.toLowerCase()
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
      "Cache-Control": "public, max-age=60",
    }
  );
}

function formatLocation(raw) {
  const lat = raw.Latitude !== undefined && raw.Latitude !== null && raw.Latitude !== "" ? Number(raw.Latitude) : null;
  const lon = raw.Longitude !== undefined && raw.Longitude !== null && raw.Longitude !== "" ? Number(raw.Longitude) : null;
  return {
    id: raw.Id || raw.id,
    name: sanitizeString(raw.Name || "Unnamed Location", 200),
    latitude: !isNaN(lat) ? lat : null,
    longitude: !isNaN(lon) ? lon : null,
    countryCode: sanitizeString(raw["Country Code"] || raw.countryCode || "", 10),
  };
}

/**
 * Batch-fetches Location records by ID and returns a Map<number, FormattedLocation>
 */
async function fetchLocationMap(locIds, baseUrl, token) {
  const locMap = new Map();
  const uniqueIds = [...new Set((locIds || []).map(Number).filter((id) => id && !isNaN(id)))];
  if (uniqueIds.length === 0) return locMap;

  try {
    const where = encodeURIComponent(`(Id,in,${uniqueIds.join(",")})`);
    const res = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.LOCATIONS}/records?where=${where}&limit=100&fields=Id,Name,Latitude,Longitude,Country Code`,
      { headers: { "xc-token": token } }
    );
    if (res.ok) {
      const data = await res.json();
      for (const raw of data.list || []) {
        const formatted = formatLocation(raw);
        if (formatted.id) {
          locMap.set(Number(formatted.id), formatted);
        }
      }
    }
  } catch (err) {
    console.warn("Failed to batch-fetch locations:", err);
  }
  return locMap;
}

/**
 * Queries OpenStreetMap Nominatim for coordinates & country code
 */
async function geocodeLocationName(locationName, countryCode = "") {
  const clean = sanitizeString(locationName, 200);
  if (!clean || IGNORED_LOCATIONS.has(clean.toLowerCase())) {
    return null;
  }
  const cc = sanitizeString(countryCode || "", 10).toLowerCase();
  try {
    let nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean)}&format=json&addressdetails=1&limit=1`;
    if (cc && cc.length === 2) {
      nomUrl += `&countrycodes=${encodeURIComponent(cc)}`;
    }
    const res = await fetch(nomUrl, {
      headers: {
        "User-Agent": "PAVE-NocoDB-Geocoder/1.0 (connectedbydata.org)",
        "Accept": "application/json",
      },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (Array.isArray(results) && results.length > 0) {
      const top = results[0];
      const lat = parseFloat(top.lat);
      const lon = parseFloat(top.lon);
      const resCc = (top.address?.country_code || cc || "").toUpperCase();
      return {
        latitude: !isNaN(lat) ? lat : null,
        longitude: !isNaN(lon) ? lon : null,
        countryCode: resCc,
      };
    }
  } catch (err) {
    console.warn(`Geocoding failed for '${clean}':`, err);
  }
  return null;
}

/**
 * Verify a user-supplied NocoDB Personal API Token against NocoDB's user/base role API.
 * Checks `X-Noco-Token` or `Authorization: Bearer <token>`.
 */
async function verifyStaffUser(request, baseUrl) {
  let userToken = request.headers.get("X-Noco-Token") || "";
  if (!userToken) {
    const authHeader = request.headers.get("Authorization") || "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      userToken = authHeader.slice(7).trim();
    }
  }
  userToken = sanitizeString(userToken, 250);
  if (!userToken || userToken.length < 10) {
    return { isAuthenticated: false, user: null, userToken: null };
  }

  try {
    const meRes = await fetch(`${baseUrl}/api/v1/db/auth/user/me?base_id=${BASE_ID}`, {
      headers: { "xc-token": userToken },
    });

    if (!meRes.ok) {
      return { isAuthenticated: false, user: null, userToken: null };
    }

    const meData = await meRes.json();
    if (!meData || !meData.id || !meData.email) {
      return { isAuthenticated: false, user: null, userToken: null };
    }

    const baseRoles = meData.base_roles || {};
    const workspaceRoles = meData.workspace_roles || {};
    const allowedRoles = ["owner", "creator", "editor", "commenter"];

    let activeRole = allowedRoles.find((r) => baseRoles[r] === true) || null;
    if (!activeRole) {
      if (workspaceRoles["workspace-level-owner"] || workspaceRoles["workspace-level-creator"] || workspaceRoles["workspace-level-editor"]) {
        activeRole = "editor";
      }
    }

    if (!activeRole || baseRoles["no-access"]) {
      return { isAuthenticated: false, user: null, userToken: null, reason: "User does not have editor/commenter access to this base." };
    }

    const canEdit = ["owner", "creator", "editor"].includes(activeRole);
    return {
      isAuthenticated: true,
      canEdit,
      user: {
        id: meData.id,
        email: meData.email,
        displayName: meData.display_name || meData.email,
        role: activeRole,
      },
      userToken,
    };
  } catch (err) {
    console.error("Failed to verify NocoDB user token:", err);
    return { isAuthenticated: false, user: null, userToken: null };
  }
}

function normalizeAssignedUsers(rawVal) {
  if (!rawVal) return [];
  if (typeof rawVal === "string") {
    try {
      rawVal = JSON.parse(rawVal);
    } catch (_) {
      return [];
    }
  }
  if (!Array.isArray(rawVal)) {
    if (typeof rawVal === "object") rawVal = [rawVal];
    else return [];
  }
  return rawVal
    .map((u) => {
      if (!u || typeof u !== "object") return null;
      const id = sanitizeString(String(u.id || u.Id || ""), 80);
      const email = sanitizeString(String(u.email || ""), 150);
      const rawName = sanitizeString(String(u.display_name || u.displayName || u.name || ""), 150);
      if (!id && !email) return null;
      const displayName =
        rawName && email && !rawName.includes(email)
          ? `${rawName} (${email})`
          : rawName || email || id;
      return { id, email, displayName };
    })
    .filter(Boolean);
}

async function fetchAssignableUsers(baseUrl, staff, extraUsers = []) {
  const userMap = new Map();
  const addUser = (u) => {
    if (!u || typeof u !== "object") return;
    const id = sanitizeString(String(u.id || ""), 80);
    const email = sanitizeString(String(u.email || ""), 150);
    if (!id && !email) return;
    const key = id || email.toLowerCase();
    const rawName = sanitizeString(String(u.displayName || u.display_name || u.name || ""), 150);
    const displayName =
      rawName && email && !rawName.includes(email)
        ? `${rawName} (${email})`
        : rawName || email || id;
    if (!userMap.has(key)) {
      userMap.set(key, { id, email, displayName });
    }
  };

  DEFAULT_BASE_USERS.forEach(addUser);
  if (staff?.user) addUser(staff.user);
  (extraUsers || []).forEach(addUser);

  if (staff?.userToken) {
    try {
      const usersRes = await fetch(`${baseUrl}/api/v1/db/meta/projects/${BASE_ID}/users`, {
        headers: { "xc-token": staff.userToken },
      });
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        const list = usersData?.users || usersData?.list || (Array.isArray(usersData) ? usersData : []);
        for (const u of list) {
          if (u && !u.roles?.includes("no-access")) {
            addUser(u);
          }
        }
      }
    } catch (_) {}
  }

  return Array.from(userMap.values());
}

/**
 * Handle GET /api/auth/me
 * Validates the user's NocoDB personal API token and returns user profile & role.
 */
async function handleAuthMe(request, baseUrl, corsHeaders) {
  const staff = await verifyStaffUser(request, baseUrl);
  if (!staff.isAuthenticated) {
    return jsonResponse(
      {
        authenticated: false,
        error: staff.reason || "Invalid NocoDB API token or insufficient permissions on this base.",
      },
      401,
      corsHeaders
    );
  }

  const assignableUsers = await fetchAssignableUsers(baseUrl, staff);

  return jsonResponse(
    {
      authenticated: true,
      canEdit: staff.canEdit,
      user: staff.user,
      assignableUsers,
    },
    200,
    corsHeaders
  );
}

/**
 * Handle GET /api/kanban/cases
 * Returns cases formatted for Kanban display (Staff only).
 * Supports chunked loading:
 * - scope=active: loads Nomination, Submission, Draft, Under Review first
 * - scope=remaining: loads Completed, Rejected, Duplicate
 * - scope=all: loads all records (paged)
 */
async function handleGetKanbanCases(request, url, baseUrl, nocodbToken, corsHeaders) {
  const staff = await verifyStaffUser(request, baseUrl);
  if (!staff.isAuthenticated) {
    return jsonResponse(
      { error: "Staff authentication required to access Kanban." },
      401,
      corsHeaders
    );
  }

  const token = nocodbToken || staff.userToken;
  const scope = (url.searchParams.get("scope") || "active").toLowerCase();

  const fields = [
    "Id",
    "Project Title",
    "Workflow: Status",
    "Curation decision",
    "Assigned to",
    "CreatedAt",
    "UpdatedAt",
    "EditKey",
  ].join(",");

  let totalCount = 0;
  try {
    // 1. Get exact overall total count of cases table
    const countUrl = `${baseUrl}/api/v2/tables/${TABLES.CASES}/records?limit=1&fields=Id`;
    const countRes = await fetch(countUrl, { headers: { "xc-token": token } });
    if (countRes.ok) {
      const countData = await countRes.json();
      totalCount = countData?.pageInfo?.totalRows || 0;
    }
  } catch (err) {
    console.warn("Could not fetch cases table total count:", err);
  }

  // 2. Determine where filter based on requested scope
  let whereClause = "";
  if (scope === "active") {
    // Priority active statuses loaded first as requested
    whereClause = "(Workflow: Status,in,Nomination,Submission,Draft,Under Review)";
  } else if (scope === "remaining" || scope === "archived") {
    whereClause = "(Workflow: Status,in,Completed,Rejected,Duplicate)";
  }

  let allCases = [];
  let offset = 0;
  const limit = 100; // NocoDB standard page size
  let hasMore = true;
  let pageCount = 0;

  try {
    while (hasMore && pageCount < 25) {
      pageCount++;
      let nocoUrl = `${baseUrl}/api/v2/tables/${TABLES.CASES}/records?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(fields)}`;
      if (whereClause) {
        nocoUrl += `&where=${encodeURIComponent(whereClause)}`;
      }

      const res = await fetch(nocoUrl, {
        headers: { "xc-token": token },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Failed to fetch cases for kanban:", res.status, errText);
        return jsonResponse({ error: "Failed to load cases from database." }, 502, corsHeaders);
      }

      const data = await res.json();
      const list = data?.list || (Array.isArray(data) ? data : []);
      allCases.push(...list);

      const groupTotal = data?.pageInfo?.totalRows !== undefined ? data.pageInfo.totalRows : totalCount;
      if (!data?.pageInfo || data.pageInfo.isLastPage === true || list.length < limit || allCases.length >= groupTotal) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    const mappedCases = allCases.map((rec) => {
      const id = rec.Id !== undefined ? rec.Id : rec.id;
      return {
        id,
        projectTitle: rec["Project Title"] || "Untitled Case",
        workflowStatus: rec["Workflow: Status"] || "Nomination",
        curationDecision: rec["Curation decision"] || null,
        assignedTo: normalizeAssignedUsers(rec["Assigned to"]),
        createdAt: rec.CreatedAt || rec.created_at || null,
        updatedAt: rec.UpdatedAt || rec.updated_at || null,
        editKey: rec.EditKey || null,
      };
    });

    // Sort cases by workflow priority order: Nomination -> Submission -> Draft -> Under Review -> Completed -> Rejected -> Duplicate
    const STATUS_PRIORITY = {
      "nomination": 1,
      "submission": 2,
      "draft": 3,
      "under review": 4,
      "completed": 5,
      "rejected": 6,
      "duplicate": 7,
    };

    mappedCases.sort((a, b) => {
      const pA = STATUS_PRIORITY[(a.workflowStatus || "").trim().toLowerCase()] || 99;
      const pB = STATUS_PRIORITY[(b.workflowStatus || "").trim().toLowerCase()] || 99;
      return pA - pB;
    });

    const assignableUsers = await fetchAssignableUsers(baseUrl, staff);
    const effectiveTotal = Math.max(totalCount, mappedCases.length);

    return jsonResponse(
      {
        authenticated: true,
        canEdit: staff.canEdit,
        user: staff.user,
        assignableUsers,
        cases: mappedCases,
        totalCount: effectiveTotal,
        loadedCount: mappedCases.length,
        scope,
        hasMore: scope === "active" ? (effectiveTotal > mappedCases.length) : false,
      },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("Error in handleGetKanbanCases:", err);
    return jsonResponse({ error: "Internal server error fetching cases." }, 500, corsHeaders);
  }
}

/**
 * Handle PATCH /api/kanban/case/workflow
 * Updates a case's workflow status and/or assigned users (Staff only).
 */
async function handleUpdateKanbanWorkflow(request, baseUrl, nocodbToken, corsHeaders) {
  const staff = await verifyStaffUser(request, baseUrl);
  if (!staff.isAuthenticated || !staff.canEdit) {
    return jsonResponse({ error: "Staff edit permissions required." }, 401, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400, corsHeaders);
  }

  const caseId = Number(body.id || body.caseId);
  if (!caseId || isNaN(caseId)) {
    return jsonResponse({ error: "Valid case ID is required." }, 400, corsHeaders);
  }

  const patchPayload = { Id: caseId };

  if (body.workflowStatus) {
    const allowed = sanitizeAllowedOption(body.workflowStatus, [
      "Nomination",
      "Submission",
      "Draft",
      "Under Review",
      "Completed",
      "Rejected",
      "Duplicate",
    ]);
    if (!allowed) {
      return jsonResponse({ error: "Invalid workflow status." }, 400, corsHeaders);
    }
    patchPayload["Workflow: Status"] = allowed;
  }

  if (body.assignedTo !== undefined) {
    const rawInput = Array.isArray(body.assignedTo)
      ? body.assignedTo
      : body.assignedTo
      ? [body.assignedTo]
      : [];
    const knownUsers = await fetchAssignableUsers(baseUrl, staff);
    const resolvedAssignees = [];
    for (const item of rawInput) {
      if (!item) continue;
      const targetId = typeof item === "string" ? sanitizeString(item, 80) : sanitizeString(String(item.id || ""), 80);
      const targetEmail =
        typeof item === "string" && item.includes("@")
          ? sanitizeString(item, 150)
          : sanitizeString(String(item.email || ""), 150);
      const match = knownUsers.find(
        (u) =>
          (targetId && u.id === targetId) ||
          (targetEmail && u.email?.toLowerCase() === targetEmail.toLowerCase())
      );
      if (match) {
        resolvedAssignees.push({ id: match.id, email: match.email, display_name: match.displayName });
      } else if (targetId || targetEmail) {
        resolvedAssignees.push({ id: targetId, email: targetEmail });
      }
    }
    patchPayload["Assigned to"] = resolvedAssignees;
  }

  const activeWriteToken = staff.userToken || nocodbToken;
  try {
    // Note: NocoDB v2 PATCH /api/v2/tables/{tableId}/records expects an ARRAY of objects [patchPayload]
    let updateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "xc-token": activeWriteToken,
      },
      body: JSON.stringify([patchPayload]),
    });

    // Fallback to system token if staff user token has restricted record update rights
    if (!updateRes.ok && nocodbToken && activeWriteToken !== nocodbToken) {
      console.warn("Retrying case workflow update with system token...");
      updateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "xc-token": nocodbToken,
        },
        body: JSON.stringify([patchPayload]),
      });
    }

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error("Failed to update case workflow:", updateRes.status, errText);
      return jsonResponse({ error: `Failed to update case in database (${updateRes.status})` }, 502, corsHeaders);
    }

    const result = await updateRes.json();
    return jsonResponse({ success: true, updated: result }, 200, corsHeaders);
  } catch (err) {
    console.error("Error in handleUpdateKanbanWorkflow:", err);
    return jsonResponse({ error: "Failed to update case." }, 500, corsHeaders);
  }
}

/**
 * Fetch comments and revision history for a case record from NocoDB's meta/comments API or MCP fallback
 */
async function fetchRecordAuditsViaMcp(caseId, env) {
  const mcpUrl = env?.NOCODB_MCP_URL || "https://app.nocodb.com/mcp/ncgdksqawy17b32d";
  const mcpKey = env?.NOCODB_MCP_KEY || "8n6XuTXSJ9StnrR3cEOpaQ1wspeqmflk";
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-api-key": mcpKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "listRecordAudits",
          arguments: {
            baseId: BASE_ID,
            tableId: TABLES.CASES,
            recordId: Number(caseId),
          },
        },
      }),
    });
    if (res.ok) {
      const text = await res.text();
      const line = text.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        const parsed = JSON.parse(line.slice(6));
        const contentStr = parsed?.result?.content?.[0]?.text;
        if (contentStr) {
          const inner = JSON.parse(contentStr);
          return Array.isArray(inner?.list) ? inner.list : [];
        }
      }
    }
  } catch (err) {
    console.warn("fetchRecordAuditsViaMcp error:", err);
  }
  return [];
}

async function fetchRecordCommentsViaMcp(caseId, env) {
  const mcpUrl = env?.NOCODB_MCP_URL || "https://app.nocodb.com/mcp/ncgdksqawy17b32d";
  const mcpKey = env?.NOCODB_MCP_KEY || "8n6XuTXSJ9StnrR3cEOpaQ1wspeqmflk";
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-api-key": mcpKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "listComments",
          arguments: {
            baseId: BASE_ID,
            tableId: TABLES.CASES,
            recordId: Number(caseId),
          },
        },
      }),
    });
    if (res.ok) {
      const text = await res.text();
      const line = text.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        const parsed = JSON.parse(line.slice(6));
        const contentStr = parsed?.result?.content?.[0]?.text;
        if (contentStr) {
          const inner = JSON.parse(contentStr);
          return Array.isArray(inner?.list) ? inner.list : [];
        }
      }
    }
  } catch (err) {
    console.warn("fetchRecordCommentsViaMcp error:", err);
  }
  return [];
}

async function createRecordCommentViaMcp(caseId, commentText, env) {
  const mcpUrl = env?.NOCODB_MCP_URL || "https://app.nocodb.com/mcp/ncgdksqawy17b32d";
  const mcpKey = env?.NOCODB_MCP_KEY || "8n6XuTXSJ9StnrR3cEOpaQ1wspeqmflk";
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-api-key": mcpKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "createComment",
          arguments: {
            baseId: BASE_ID,
            tableId: TABLES.CASES,
            recordId: Number(caseId),
            comment: commentText,
          },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function parseAuditAndCommentItems(allItems) {
  const comments = [];
  const revisions = [];

  for (const item of allItems || []) {
    const opType = item.op_type || item.opType || "";
    const isComment =
      opType === "COMMENT" ||
      (!opType && item.comment) ||
      Boolean(item.comment && opType !== "DATA_UPDATE" && opType !== "DATA_INSERT" && opType !== "DATA_LINK");

    if (isComment && item.comment) {
      comments.push({
        id: item.id,
        comment: item.comment,
        user: item.user || item.created_by_email || "NocoDB User",
        userId: item.fk_user_id || null,
        resolved: Boolean(item.resolved),
        createdAt: item.created_at || item.CreatedAt || null,
        updatedAt: item.updated_at || item.UpdatedAt || null,
      });
      continue;
    }

    // Parse audit / revision entry
    let parsedDetails = null;
    let summary = item.description || "";
    const changes = [];

    if (opType === "DATA_INSERT") {
      let dataObj = {};
      if (item.details) {
        try {
          const p = typeof item.details === "string" ? JSON.parse(item.details) : item.details;
          dataObj = p?.data || {};
        } catch (_) {}
      }
      const projTitle = dataObj["Project Title"] || "";
      const summary = projTitle ? `Record created: "${projTitle}"` : "Record created";
      revisions.push({
        id: item.id,
        opType: "DATA_INSERT",
        opSubType: item.op_sub_type || null,
        user: item.user || "System",
        field: null,
        oldValue: null,
        newValue: null,
        description: summary,
        createdAt: item.created_at || item.CreatedAt || null,
      });
      continue;
    }

    if (item.details) {
      try {
        parsedDetails =
          typeof item.details === "string" ? JSON.parse(item.details) : item.details;
      } catch (_) {}
    }

    if (parsedDetails && typeof parsedDetails === "object") {
      const colMeta = parsedDetails.column_meta || {};
      const dataObj = parsedDetails.data || {};
      const oldObj = parsedDetails.old_data || {};
      const changedKeys = [
        ...new Set([...Object.keys(dataObj), ...Object.keys(oldObj)]),
      ];

      for (const key of changedKeys) {
        if (key === "EditKey") {
          changes.push({
            field: "EditKey",
            oldValue: oldObj[key] ? "••••••••" : null,
            newValue: dataObj[key] ? "•••••••• (Updated)" : null,
          });
        } else {
          const fieldTitle = colMeta[key]?.title || key;
          changes.push({
            field: fieldTitle,
            oldValue: oldObj[key] !== undefined ? oldObj[key] : null,
            newValue: dataObj[key] !== undefined ? dataObj[key] : null,
          });
        }
      }

      if (opType === "DATA_LINK") {
        const linkField = parsedDetails.link_field_title || "Linked Record";
        const refName =
          parsedDetails.ref_display_value || `Record #${parsedDetails.ref_row_id || ""}`;
        summary = `Linked ${refName} (${linkField})`;
      } else if (opType === "DATA_INSERT") {
        const projTitle = dataObj["Project Title"] || "";
        summary = projTitle ? `Record created: "${projTitle}"` : "Record created";
      }
    }

    if (changes.length > 0) {
      for (const change of changes) {
        revisions.push({
          id: item.id ? `${item.id}-${change.field}` : undefined,
          opType: opType || "UPDATE",
          opSubType: item.op_sub_type || null,
          user: item.user || "System",
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          description: summary || null,
          createdAt: item.created_at || item.CreatedAt || null,
        });
      }
    } else {
      revisions.push({
        id: item.id,
        opType: opType || "UPDATE",
        opSubType: item.op_sub_type || null,
        user: item.user || "System",
        field: null,
        oldValue: null,
        newValue: null,
        description:
          summary ||
          (opType === "DATA_LINK"
            ? "Linked record"
            : opType === "DATA_INSERT"
            ? "Record created"
            : "Record updated"),
        createdAt: item.created_at || item.CreatedAt || null,
      });
    }
  }

  return { comments, revisions };
}

async function fetchCaseCommentsAndAudits(caseId, baseUrl, tokenToUse, fallbackToken, env) {
  const fetchWithToken = async (tok, commentsOnly) => {
    const url = `${baseUrl}/api/v2/meta/comments?fk_model_id=${TABLES.CASES}&row_id=${encodeURIComponent(caseId)}${commentsOnly ? "&comments_only=true" : ""}`;
    return await fetch(url, { headers: { "xc-token": tok } });
  };

  let allItems = [];
  let permissionWarning = null;

  // 1. Try fetching full activity stream (comments + revision audits) with staff token first, then fallback token
  if (tokenToUse) {
    const res = await fetchWithToken(tokenToUse, false);
    if (res.ok) {
      const data = await res.json();
      allItems = data.list || (Array.isArray(data) ? data : []);
    } else {
      try {
        const errBody = await res.json();
        if (errBody?.message) permissionWarning = errBody.message;
      } catch (_) {}
    }
  }

  if (allItems.length === 0 && fallbackToken && fallbackToken !== tokenToUse) {
    const res = await fetchWithToken(fallbackToken, false);
    if (res.ok) {
      const data = await res.json();
      allItems = data.list || (Array.isArray(data) ? data : []);
      permissionWarning = null;
    }
  }

  let { comments, revisions } = parseAuditAndCommentItems(allItems);

  // 2. If no revisions found (e.g. commentList permission missing on scoped token), fetch directly via MCP endpoint
  if (revisions.length === 0) {
    const mcpAudits = await fetchRecordAuditsViaMcp(caseId, env);
    if (mcpAudits.length > 0) {
      const mcpParsed = parseAuditAndCommentItems(mcpAudits);
      revisions = mcpParsed.revisions;
      if (revisions.length > 0) {
        permissionWarning = null; // Successfully loaded audits
      }
    }
  }

  // 3. If comments were empty or errored, check MCP endpoint for comments
  if (comments.length === 0) {
    const mcpComments = await fetchRecordCommentsViaMcp(caseId, env);
    if (mcpComments.length > 0) {
      const mcpParsed = parseAuditAndCommentItems(mcpComments);
      comments = mcpParsed.comments;
    }
  }

  return { comments, revisions, permissionWarning };
}

/**
 * Handle GET & POST /api/case/comments
 * Allows authenticated NocoDB staff users to read or post comments & view revision history.
 */
async function handleCaseComments(request, url, baseUrl, corsHeaders, env) {
  const staff = await verifyStaffUser(request, baseUrl);
  if (!staff.isAuthenticated) {
    return jsonResponse(
      { error: "Staff authentication required to view or post comments." },
      401,
      corsHeaders
    );
  }

  if (request.method === "GET") {
    const rawId = url.searchParams.get("id") || url.searchParams.get("caseId") || "";
    const caseId = Number(rawId);
    if (!caseId || isNaN(caseId)) {
      return jsonResponse({ error: "Valid caseId is required." }, 400, corsHeaders);
    }

    const { comments, revisions, permissionWarning } = await fetchCaseCommentsAndAudits(
      caseId,
      baseUrl,
      staff.userToken,
      null,
      env
    );

    return jsonResponse(
      {
        caseId,
        comments,
        revisions,
        permissionWarning,
      },
      200,
      corsHeaders
    );
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400, corsHeaders);
    }

    const caseId = Number(body.caseId || body.id);
    const commentText = sanitizeString(body.comment, 5000);

    if (!caseId || isNaN(caseId)) {
      return jsonResponse({ error: "Valid caseId is required." }, 400, corsHeaders);
    }
    if (!commentText) {
      return jsonResponse({ error: "Comment text cannot be empty." }, 400, corsHeaders);
    }

    let postedOk = false;
    let postError = null;

    try {
      const postRes = await fetch(`${baseUrl}/api/v2/meta/comments`, {
        method: "POST",
        headers: {
          "xc-token": staff.userToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fk_model_id: TABLES.CASES,
          row_id: String(caseId),
          comment: commentText,
        }),
      });
      if (postRes.ok) {
        postedOk = true;
      } else {
        try {
          const errJson = await postRes.json();
          postError = errJson?.message;
        } catch (_) {}
      }
    } catch (err) {
      postError = err.message;
    }

    // Fallback to MCP createComment tool if REST token has restricted scope
    if (!postedOk) {
      postedOk = await createRecordCommentViaMcp(caseId, `${commentText} [via ${staff.user.displayName || staff.user.email}]`, env);
    }

    if (!postedOk) {
      return jsonResponse(
        { error: postError || "Failed to post comment to database." },
        502,
        corsHeaders
      );
    }

    const { comments, revisions, permissionWarning } = await fetchCaseCommentsAndAudits(
      caseId,
      baseUrl,
      staff.userToken,
      null,
      env
    );

    return jsonResponse(
      {
        success: true,
        comments,
        revisions,
        permissionWarning,
      },
      200,
      corsHeaders
    );
  }

  return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
}

/**
 * Handle GET /api/case?editKey=...[&id=...]
 * Conditions:
 * 1. Public users: editKey is provided (>= 12 chars), matches stored EditKey, and Workflow: Status is not 'Completed'
 * 2. Authenticated NocoDB staff users: can load by id or editKey, can edit 'Completed' cases, and receive comments + revision history
 */
async function handleGetCaseForEdit(request, url, baseUrl, token, corsHeaders, env) {
  const staff = await verifyStaffUser(request, baseUrl);
  const isStaff = staff.isAuthenticated && staff.canEdit;

  const editKey = sanitizeString(url.searchParams.get("editKey") || url.searchParams.get("editkey") || "", 60);
  const rawId = url.searchParams.get("id") || url.searchParams.get("caseId") || "";
  const caseId = rawId ? Number(rawId) : null;

  if (!isStaff && (!editKey || editKey.length < 12)) {
    return jsonResponse(
      { error: "A valid edit key of at least 12 characters is required." },
      400,
      corsHeaders
    );
  }

  if (isStaff && (!editKey || editKey.length < 12) && (!caseId || isNaN(caseId))) {
    return jsonResponse(
      { error: "Please provide a valid Case ID (?id=...) or EditKey to load a case." },
      400,
      corsHeaders
    );
  }

  // Construct query: by EditKey and/or ID
  let whereClause = "";
  if (isStaff && caseId && !isNaN(caseId) && (!editKey || editKey.length < 12)) {
    whereClause = `(Id,eq,${caseId})`;
  } else if (caseId && !isNaN(caseId)) {
    whereClause = `(Id,eq,${caseId})~and(EditKey,eq,${editKey})`;
  } else {
    whereClause = `(EditKey,eq,${editKey})`;
  }

  const queryUrl = `${baseUrl}/api/v2/tables/${TABLES.CASES}/records?where=${encodeURIComponent(whereClause)}&limit=1`;
  const res = await fetch(queryUrl, {
    headers: { "xc-token": token },
  });

  if (!res.ok) {
    console.error("Failed to query case for edit:", res.status, await res.text());
    return jsonResponse({ error: "Failed to look up case." }, 502, corsHeaders);
  }

  const data = await res.json();
  const cases = data.list || [];

  if (cases.length === 0) {
    return jsonResponse(
      { error: "Case not found or invalid edit key." },
      404,
      corsHeaders
    );
  }

  const rawCase = cases[0];
  const targetId = rawCase.Id || rawCase.id;

  // Retrieve complete record with linked fields
  const detailRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records/${targetId}`, {
    headers: { "xc-token": token },
  });

  if (!detailRes.ok) {
    return jsonResponse({ error: "Failed to load case details." }, 502, corsHeaders);
  }

  const caseRecord = await detailRes.json();
  const status = (caseRecord["Workflow: Status"] || "").trim().toLowerCase();
  const storedKey = (caseRecord["EditKey"] || "").trim();

  // Validate condition: 'Completed' cases can only be edited by authenticated NocoDB staff
  if (status === "completed" && !isStaff) {
    return jsonResponse(
      {
        error: "This case has been marked as 'Completed' and can no longer be edited. (NocoDB editors can sign in using 'Staff Sign In' to edit completed cases.)",
        currentStatus: caseRecord["Workflow: Status"],
      },
      403,
      corsHeaders
    );
  }

  // Validate condition: Stored EditKey must be at least 12 characters and match (unless authenticated staff)
  if (!isStaff && (storedKey.length < 12 || storedKey !== editKey)) {
    return jsonResponse(
      { error: "Invalid edit key for this case." },
      403,
      corsHeaders
    );
  }

  // Fetch linked participant details if present
  let participants = [];
  let rawParticipantsList = [];
  const linkedParts = caseRecord["Participants"] || [];
  const partIds = linkedParts.map((p) => p.Id || p.id).filter(Boolean);

  if (partIds.length > 0) {
    const partsWhere = encodeURIComponent(`(Id,in,${partIds.join(",")})`);
    const partsRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records?where=${partsWhere}&limit=50`,
      { headers: { "xc-token": token } }
    );
    if (partsRes.ok) {
      const partsData = await partsRes.json();
      rawParticipantsList = partsData.list || [];
    }
  }

  // Fetch linked resources if present
  let resources = [];
  const linkedResources = caseRecord["Supporting resources"] || [];
  const resIds = linkedResources.map((r) => r.Id || r.id).filter(Boolean);

  if (resIds.length > 0) {
    const resWhere = encodeURIComponent(`(Id,in,${resIds.join(",")})`);
    const resourcesRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.RESOURCES}/records?where=${resWhere}&limit=50`,
      { headers: { "xc-token": token } }
    );
    if (resourcesRes.ok) {
      const resData = await resourcesRes.json();
      resources = (resData.list || []).map((r) => ({
        id: r.Id || r.id,
        title: r["Title"] || "",
        url: r["URL"] || "",
        resourceType: r["Select"] || "Other",
        description: r["Short description"] || "",
        license: r["License"] || "",
        attachments: normalizeAttachmentsArray(r["Attachments"]),
      }));
    }
  }

  // Fetch linked messages if present
  let messages = [];
  const linkedMessages = caseRecord["Messages"] || [];
  const msgIds = extractIds(linkedMessages);

  if (msgIds.length > 0) {
    const msgWhere = encodeURIComponent(`(Id,in,${msgIds.join(",")})`);
    const messagesRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.MESSAGES}/records?where=${msgWhere}&limit=100`,
      { headers: { "xc-token": token } }
    );
    if (messagesRes.ok) {
      const msgData = await messagesRes.json();
      const rawMsgList = msgData.list || [];
      const typeCounters = {};
      messages = rawMsgList.map((m) => {
        const type = m["Type"] || "Recommendation";
        typeCounters[type] = (typeCounters[type] || 0) + 1;
        return {
          id: m.Id || m.id,
          title: m["Title"] || `${type} ${typeCounters[type]}`,
          text: m["Name"] || "",
          type,
        };
      });
    }
  }

  // Fetch linked organisation records from Organisations table
  const allOrgIds = [
    ...(caseRecord["Lead organisations"] || []),
    ...(caseRecord["Funding Organisations"] || []),
    ...(caseRecord["Involved organisations"] || []),
  ]
    .map((o) => (typeof o === "object" ? (o.Id || o.id || (o.id_fields && o.id_fields.Id)) : o))
    .filter(Boolean);

  const orgMap = new Map();
  let rawOrgsList = [];
  if (allOrgIds.length > 0) {
    const uniqueOrgIds = [...new Set(allOrgIds)];
    const orgWhere = encodeURIComponent(`(Id,in,${uniqueOrgIds.join(",")})`);
    const orgRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.ORGANISATIONS}/records?where=${orgWhere}&limit=100`,
      { headers: { "xc-token": token } }
    );
    if (orgRes.ok) {
      const orgData = await orgRes.json();
      rawOrgsList = orgData.list || [];
    }
  }

  // Collect all linked Location IDs from Participants, Organisations, and Case Geographic scope
  const allLocationIds = [];
  for (const p of rawParticipantsList) {
    for (const loc of p["Locations"] || []) {
      const lid = typeof loc === "object" && loc !== null ? loc.Id || loc.id : loc;
      if (lid && !isNaN(Number(lid))) allLocationIds.push(Number(lid));
    }
  }
  for (const org of rawOrgsList) {
    for (const loc of org["Main Location"] || []) {
      const lid = typeof loc === "object" && loc !== null ? loc.Id || loc.id : loc;
      if (lid && !isNaN(Number(lid))) allLocationIds.push(Number(lid));
    }
  }
  for (const loc of caseRecord["Geographic scope"] || []) {
    const lid = typeof loc === "object" && loc !== null ? loc.Id || loc.id : loc;
    if (lid && !isNaN(Number(lid))) allLocationIds.push(Number(lid));
  }

  const locMap = await fetchLocationMap(allLocationIds, baseUrl, token);

  const mapLinkedLocations = (rawLinks) => {
    const resolved = [];
    for (const l of rawLinks || []) {
      const lid = Number(typeof l === "object" && l !== null ? l.Id || l.id : l);
      if (locMap.has(lid)) {
        resolved.push(locMap.get(lid));
      } else if (typeof l === "object" && l !== null && (l.Name || l.name)) {
        resolved.push({
          id: lid || null,
          name: sanitizeString(l.Name || l.name, 200),
          latitude: l.Latitude !== undefined ? Number(l.Latitude) : null,
          longitude: l.Longitude !== undefined ? Number(l.Longitude) : null,
          countryCode: l["Country Code"] || l.countryCode || "",
        });
      }
    }
    return resolved;
  };

  participants = rawParticipantsList.map((p) => ({
    id: p.Id || p.id,
    groupDescription: p["Group description"] || "",
    participantCount: p["How many people took part?"] || "",
    engagementHours: p["On average, how many hours did each participant engage for?"] || "",
    engagementLocations: ensureArray(p["Where did engagement take place?"]),
    recruitmentMethod: p["Recruitment method"] || "",
    recruitmentDescription: p["Recruitment description"] || "",
    targetPopulation: p["Was there a specific target population?"] || "",
    geographicOrigin: p["Where were participants from?"] || "",
    locations: mapLinkedLocations(p["Locations"]),
    engagementMethods: ensureArray(p["Which of the following methods were used to engage participants?"]),
    learningFacilitationOptions: ensureArray(p["Do any of the following apply?"]),
    notes: p["Additional notes"] || "",
  }));

  for (const org of rawOrgsList) {
    const id = Number(org.Id || org.id);
    orgMap.set(id, {
      id,
      name: org.Name || org["cqkqjxbtc9sjzuk"] || `Organisation #${id}`,
      website: org["Website address"] || org["c68nspve2ypnur8"] || "",
      type: org["Organisation type"] || org["cwhtaz65osbz1ql"] || [],
      locations: mapLinkedLocations(org["Main Location"]),
    });
  }

  // Format organisation lists with full website and location details
  const formatOrgLink = (arr) =>
    (arr || []).map((o) => {
      const id = Number(typeof o === "object" ? (o.Id || o.id || (o.id_fields && o.id_fields.Id)) : o);
      const found = orgMap.get(id);
      if (found) return found;
      const fallbackName = (o && typeof o === "object" && (o.Name || o.fields?.Name)) || `Organisation #${id}`;
      return { id, name: fallbackName, website: "", type: [], locations: [] };
    });

  // If authenticated NocoDB staff user, also fetch comments, revision history, and assignable users
  let comments = [];
  let revisions = [];
  let activityWarning = null;
  let assignableUsers = [];
  const assignedTo = normalizeAssignedUsers(caseRecord["Assigned to"]);

  if (staff.isAuthenticated) {
    const [activity, usersList] = await Promise.all([
      fetchCaseCommentsAndAudits(targetId, baseUrl, staff.userToken, token, env),
      fetchAssignableUsers(baseUrl, staff, assignedTo),
    ]);
    comments = activity.comments;
    revisions = activity.revisions;
    activityWarning = activity.permissionWarning;
    assignableUsers = usersList;
  }

  return jsonResponse(
    {
      staff: staff.isAuthenticated
        ? {
            authenticated: true,
            canEdit: staff.canEdit,
            user: staff.user,
            assignableUsers,
          }
        : { authenticated: false },
      case: {
        id: targetId,
        editKey: storedKey,
        workflowStatus: caseRecord["Workflow: Status"],
        assignedTo,
        curationDecision: caseRecord["Curation decision"] || "",
        projectTitle: caseRecord["Project Title"] || "",
        projectUrl: caseRecord["Project URL"] || "",
        projectDescription: caseRecord["Provide a brief description of the project"] || "",
        importanceReason: caseRecord["Why is this project important to include in the case book?"] || "",
        initiatedMethods: ensureArray(caseRecord["How was the project initiated?"]),
        startYear: caseRecord["What year did the project start?"] || "",
        projectStatus: caseRecord["Project status"] || "",
        endYear: caseRecord["What year did the project conclude?"] || "",
        submitterName: caseRecord["Submitted by"] || "",
        submitterEmail: caseRecord["Contact e-mail"] || "",
        submitterRoles: ensureArray(caseRecord["Submitter role"]),
        additionalAcknowledgements: caseRecord["Additional acknowledgements"] || "",
        aiForms: ensureArray(caseRecord["What form of AI is the project about?"]),
        subjectMatter: caseRecord["Describe the subject matter in your own words (one line)"] || "",
        projectGoals: ensureArray(caseRecord["Project goals"]),
        inclusionEfforts: caseRecord["Inclusion efforts"] || "",
        limitations: caseRecord["What limitations to the project should be noted?"] || "",
        headlineFindings: caseRecord["Headline findings"] || "",
        aiAssistance: ensureArray(caseRecord["Was AI used to assist in summary generation?"]),
        publishedResources: ensureArray(caseRecord["Which of the following resources are available for this project?"]),
        photosAvailable: ensureArray(caseRecord["Photos available?"]),
        photosAndImages: normalizeAttachmentsArray(caseRecord["Photos and images"]),
        methodImage: normalizeAttachmentsArray(caseRecord["Method Image"]),
        methodImageCaption: caseRecord["Method image caption"] || "",
        geographicScope: mapLinkedLocations(caseRecord["Geographic scope"]),
        leadOrganisations: formatOrgLink(caseRecord["Lead organisations"]),
        fundingOrganisations: formatOrgLink(caseRecord["Funding Organisations"]),
        involvedOrganisations: formatOrgLink(caseRecord["Involved organisations"]),
        participants,
        resources,
        messages,
        comments: staff.isAuthenticated ? comments : undefined,
        revisions: staff.isAuthenticated ? revisions : undefined,
        activityWarning: staff.isAuthenticated ? activityWarning : undefined,
      },
    },
    200,
    corsHeaders
  );
}

/**
 * Normalize NocoDB attachment arrays for client display AND round-trip persistence.
 */
function normalizeAttachmentsArray(attArr) {
  if (!Array.isArray(attArr)) return [];
  return attArr
    .map((att) => {
      if (!att || typeof att !== "object") return null;
      const rawUrl = att.rawUrl || att.url || "";
      const signedUrl = att.signedUrl || rawUrl || "";
      const displayUrl = signedUrl || rawUrl;
      const thumbUrl =
        att.thumbnails?.card_cover?.signedUrl ||
        att.thumbnails?.small?.signedUrl ||
        att.thumbUrl ||
        displayUrl;
      if (!displayUrl && !att.path) return null;
      return {
        ...(att.id ? { id: String(att.id) } : {}),
        ...(att.path ? { path: String(att.path) } : {}),
        rawUrl: rawUrl ? rawUrl.split("?")[0] : "",
        signedUrl,
        url: displayUrl,
        thumbUrl,
        title: sanitizeString(att.title || att.fileName || "Attachment", 255),
        mimetype: sanitizeString(att.mimetype || "application/octet-stream", 120),
        size: Number(att.size) || 0,
        ...(att.width ? { width: Number(att.width) } : {}),
        ...(att.height ? { height: Number(att.height) } : {}),
        ...(att.icon ? { icon: sanitizeString(att.icon, 60) } : {}),
        ...(att.thumbnails ? { thumbnails: att.thumbnails } : {}),
      };
    })
    .filter(Boolean);
}

/**
 * Converts client-side attachment objects back into NocoDB Attachment field payload items.
 */
function prepareAttachmentsForNocoDB(attArr, maxItems = 20) {
  if (!Array.isArray(attArr)) return [];
  return attArr
    .slice(0, maxItems)
    .map((att) => {
      if (!att || typeof att !== "object") return null;
      const rawUrl = sanitizeString(att.rawUrl || (att.url ? att.url.split("?")[0] : ""), 1000);
      const path = sanitizeString(att.path || "", 500);
      if (!rawUrl && !path) return null;
      if (rawUrl && !isValidHttpUrl(rawUrl) && !rawUrl.startsWith("nc/")) return null;

      const item = {
        title: sanitizeString(att.title || att.fileName || "Attachment", 255),
        mimetype: sanitizeString(att.mimetype || "application/octet-stream", 120),
      };
      if (att.id) item.id = sanitizeString(String(att.id), 60);
      if (rawUrl) item.url = rawUrl;
      if (path) item.path = path;
      if (att.size !== undefined && att.size !== null && !isNaN(Number(att.size))) {
        item.size = Math.max(0, Math.round(Number(att.size)));
      }
      if (att.width && !isNaN(Number(att.width))) item.width = Math.round(Number(att.width));
      if (att.height && !isNaN(Number(att.height))) item.height = Math.round(Number(att.height));
      if (att.icon) item.icon = sanitizeString(att.icon, 60);
      return item;
    })
    .filter(Boolean);
}

const ALLOWED_PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".bash",
  ".ps1",
  ".msi",
  ".dll",
  ".so",
  ".dylib",
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
  ".xhtml",
  ".svg",
  ".php",
  ".py",
  ".rb",
  ".pl",
  ".jar",
]);

function getFileExtension(filename) {
  if (!filename || typeof filename !== "string") return "";
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return "";
  return filename.slice(lastDot).toLowerCase().trim();
}

/**
 * Handle POST /api/upload
 * Proxies multipart/form-data file uploads to NocoDB `/api/v2/storage/upload`
 */
async function handleFileUpload(request, url, baseUrl, token, corsHeaders) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_UPLOAD_BYTES) {
    return jsonResponse(
      { error: "Upload payload too large. Maximum allowed upload size is 25 MB." },
      413,
      corsHeaders
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonResponse(
      { error: "Content-Type must be multipart/form-data." },
      400,
      corsHeaders
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return jsonResponse({ error: "Invalid multipart form data." }, 400, corsHeaders);
  }

  const staff = await verifyStaffUser(request, baseUrl);
  const isStaffEditor = staff.isAuthenticated && staff.canEdit;
  const activeWriteToken = isStaffEditor && staff.userToken ? staff.userToken : token;

  const category = sanitizeString(
    formData.get("category") || url.searchParams.get("category") || "resource",
    30
  ).toLowerCase();

  const rawFiles = [...formData.getAll("file"), ...formData.getAll("files")].filter(
    (f) => f && typeof f === "object" && typeof f.arrayBuffer === "function" && f.size > 0
  );

  if (rawFiles.length === 0) {
    return jsonResponse({ error: "No valid file provided for upload." }, 400, corsHeaders);
  }

  if (rawFiles.length > 10) {
    return jsonResponse({ error: "Maximum of 10 files can be uploaded at once." }, 400, corsHeaders);
  }

  const outboundForm = new FormData();

  for (const file of rawFiles) {
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      return jsonResponse(
        { error: `File "${file.name || "unnamed"}" exceeds the 20 MB per-file size limit.` },
        413,
        corsHeaders
      );
    }

    const fileName = sanitizeString(file.name || "upload", 200).replace(/[/\\?%*:|"<>]/g, "_");
    const ext = getFileExtension(fileName);
    const mime = (file.type || "").toLowerCase();

    if (BLOCKED_EXTENSIONS.has(ext)) {
      return jsonResponse(
        { error: `File type "${ext}" is not permitted for security reasons.` },
        400,
        corsHeaders
      );
    }

    if (category === "photo") {
      const isAllowedImageMime =
        mime.startsWith("image/") && !mime.includes("svg") && !mime.includes("xml");
      const isAllowedImageExt = ALLOWED_PHOTO_EXTENSIONS.has(ext);
      if (!isAllowedImageMime && !isAllowedImageExt) {
        return jsonResponse(
          {
            error: `File "${fileName}" must be a supported image format (JPEG, PNG, WebP, GIF, or AVIF).`,
          },
          400,
          corsHeaders
        );
      }
    }

    outboundForm.append("file", file, fileName);
  }

  const uploadRes = await fetch(`${baseUrl}/api/v2/storage/upload?path=pave-uploads`, {
    method: "POST",
    headers: {
      "xc-token": activeWriteToken,
    },
    body: outboundForm,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error("NocoDB storage upload failed:", uploadRes.status, errText);
    return jsonResponse(
      { error: "Failed to upload file to storage. Please try again." },
      502,
      corsHeaders
    );
  }

  const uploadedData = await uploadRes.json();
  const uploadedList = Array.isArray(uploadedData) ? uploadedData : [uploadedData];
  const normalized = normalizeAttachmentsArray(uploadedList);

  return jsonResponse(
    {
      success: true,
      attachments: normalized,
    },
    200,
    corsHeaders
  );
}

/**
 * Handle Case submission (Create new OR Update existing)
 */
async function handleSubmitOrEditCase(request, baseUrl, token, corsHeaders) {
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

  const staff = await verifyStaffUser(request, baseUrl);
  const isStaffEditor = staff.isAuthenticated && staff.canEdit;
  // Use staff member's personal token for NocoDB mutations so NocoDB audit history attributes changes to them
  const activeWriteToken = isStaffEditor && staff.userToken ? staff.userToken : token;

  const isEditMode = Boolean(payload.caseId && (payload.editKey || isStaffEditor));
  let existingCaseId = null;
  let existingRec = null;

  // If in edit mode, strictly verify authorization conditions
  if (isEditMode) {
    const editKey = sanitizeString(payload.editKey, 60);
    const caseId = Number(payload.caseId);

    if (isNaN(caseId) || (!isStaffEditor && (!editKey || editKey.length < 12))) {
      return jsonResponse(
        { error: "Invalid edit credentials provided." },
        400,
        corsHeaders
      );
    }

    const checkRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records/${caseId}`, {
      headers: { "xc-token": token },
    });

    if (!checkRes.ok) {
      return jsonResponse({ error: "Existing case record not found." }, 404, corsHeaders);
    }

    existingRec = await checkRes.json();
    const status = (existingRec["Workflow: Status"] || "").trim().toLowerCase();
    const storedKey = (existingRec["EditKey"] || "").trim();

    if (status === "completed" && !isStaffEditor) {
      return jsonResponse(
        { error: "This case has been marked as 'Completed' and can no longer be edited." },
        403,
        corsHeaders
      );
    }

    if (!isStaffEditor && (storedKey.length < 12 || storedKey !== editKey)) {
      return jsonResponse(
        { error: "Invalid edit key for this case." },
        403,
        corsHeaders
      );
    }

    existingCaseId = caseId;
  }

  // Determine which scopes to sync (supports partial/stage-level saves in edit mode)
  const allScopes = ["case", "organisations", "participants", "resources", "messages"];
  const requestedScopes =
    isEditMode && Array.isArray(payload.scopes) && payload.scopes.length > 0
      ? payload.scopes.filter((s) => allScopes.includes(s))
      : allScopes;
  const activeScopes = new Set(requestedScopes.length > 0 ? requestedScopes : allScopes);

  const shouldSyncCase = !isEditMode || activeScopes.has("case");
  const shouldSyncOrgs = !isEditMode || activeScopes.has("organisations");
  const shouldSyncParticipants = !isEditMode || activeScopes.has("participants");
  const shouldSyncResources = !isEditMode || activeScopes.has("resources");
  const shouldSyncMessages = !isEditMode || activeScopes.has("messages");

  // Extract current relationship link IDs if editing
  const currentLeadOrgIds = extractIds(existingRec?.["Lead organisations"]);
  const currentFundingOrgIds = extractIds(existingRec?.["Funding Organisations"]);
  const currentInvolvedOrgIds = extractIds(existingRec?.["Involved organisations"]);
  const currentPartIds = extractIds(existingRec?.["Participants"]);
  const currentResIds = extractIds(existingRec?.["Supporting resources"]);
  const currentMsgIds = extractIds(existingRec?.["Messages"]);

  // Validate required Project Title
  const projectTitle =
    sanitizeString(payload.projectTitle, 250) ||
    (isEditMode ? sanitizeString(existingRec?.["Project Title"], 250) : "");
  if (!projectTitle) {
    return jsonResponse({ error: "Project Title is required." }, 400, corsHeaders);
  }

  // Validate Submitter Email (strictly required on new submission; validated if present on edit)
  const submitterEmail = sanitizeString(payload.submitterEmail, 150);
  if (!isEditMode && (!submitterEmail || !isValidEmail(submitterEmail))) {
    return jsonResponse(
      { error: "A valid contact email address is required." },
      400,
      corsHeaders
    );
  }
  if (isEditMode && submitterEmail && !isValidEmail(submitterEmail)) {
    return jsonResponse(
      { error: "Please enter a valid contact email address." },
      400,
      corsHeaders
    );
  }

  // Strict URL validation on Project URL
  const projectUrl = sanitizeString(payload.projectUrl, 500);
  if (projectUrl && !isValidHttpUrl(projectUrl)) {
    return jsonResponse(
      { error: "Project URL must be a valid http:// or https:// address." },
      400,
      corsHeaders
    );
  }

  // Resolve organisations (Lead, Funding, Involved) when in scope
  let leadOrgIds = currentLeadOrgIds;
  let fundingOrgIds = currentFundingOrgIds;
  let involvedOrgIds = currentInvolvedOrgIds;

  if (shouldSyncOrgs) {
    leadOrgIds = await resolveOrganisations(
      clampArray(payload.leadOrganisations, MAX_ORGS_PER_FIELD),
      baseUrl,
      activeWriteToken
    );
    fundingOrgIds = await resolveOrganisations(
      clampArray(payload.fundingOrganisations, MAX_ORGS_PER_FIELD),
      baseUrl,
      activeWriteToken
    );
    involvedOrgIds = await resolveOrganisations(
      clampArray(payload.involvedOrganisations, MAX_ORGS_PER_FIELD),
      baseUrl,
      activeWriteToken
    );
  }

  // Prepare Case data
  const isNomination = payload.submissionIntent === "nomination";
  const caseData = {
    "Project Title": projectTitle,
    "Project URL": projectUrl || null,
    "Provide a brief description of the project": sanitizeString(payload.projectDescription, 10000) || null,
    "Why is this project important to include in the case book?": sanitizeString(payload.importanceReason, 5000) || null,
    "How was the project initiated?": sanitizeStringArray(payload.initiatedMethods, 5),
    "What year did the project start?": clampNumber(payload.startYear, 1950, 2050),
    "Project status": sanitizeAllowedOption(payload.projectStatus, ["Planned", "In Progress", "Complete"]),
    "What year did the project conclude?": clampNumber(payload.endYear, 1950, 2050),
    "Submitted by": sanitizeString(payload.submitterName, 150) || null,
    "Contact e-mail": submitterEmail || (isEditMode ? existingRec?.["Contact e-mail"] || null : null),
    "Submitter role": sanitizeStringArray(payload.submitterRoles, 10),
    "Additional acknowledgements": sanitizeString(payload.additionalAcknowledgements, 500) || null,
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

  if (payload.photosAndImages !== undefined) {
    caseData["Photos and images"] = prepareAttachmentsForNocoDB(
      payload.photosAndImages,
      MAX_PHOTOS
    );
  }

  if (payload.methodImage !== undefined) {
    caseData["Method Image"] = prepareAttachmentsForNocoDB(
      payload.methodImage,
      1
    );
  }

  if (payload.methodImageCaption !== undefined) {
    caseData["Method image caption"] = sanitizeString(payload.methodImageCaption, 500) || null;
  }

  // Only assign workflow status and editKey on initial creation (or allow authenticated staff to update workflow status and assigned individual)
  let generatedEditKey = null;
  if (!isEditMode) {
    caseData["Workflow: Status"] = isNomination ? "Nomination" : "Submission";
    generatedEditKey = generateSecureKey(16);
    caseData["EditKey"] = generatedEditKey;
  } else if (isStaffEditor) {
    if (payload.workflowStatus) {
      const allowedWorkflow = sanitizeAllowedOption(payload.workflowStatus, [
        "Nomination",
        "Submission",
        "Draft",
        "Under Review",
        "Completed",
        "Rejected",
        "Duplicate",
      ]);
      if (allowedWorkflow) {
        caseData["Workflow: Status"] = allowedWorkflow;
      }
    }

    if (payload.curationDecision !== undefined) {
      const allowedCuration = sanitizeAllowedOption(payload.curationDecision, [
        "Featured Full Case",
        "Full Case",
        "Mapping Entry",
        "Do not include",
      ]);
      caseData["Curation decision"] = allowedCuration || null;
    }

    if (payload.assignedTo !== undefined) {
      const rawInput = Array.isArray(payload.assignedTo)
        ? payload.assignedTo
        : payload.assignedTo
        ? [payload.assignedTo]
        : [];
      const knownUsers = await fetchAssignableUsers(
        baseUrl,
        staff,
        normalizeAssignedUsers(existingRec?.["Assigned to"])
      );
      const resolvedAssignees = [];
      for (const item of rawInput) {
        if (!item) continue;
        const targetId =
          typeof item === "string"
            ? sanitizeString(item, 80)
            : sanitizeString(String(item.id || ""), 80);
        const targetEmail =
          typeof item === "object" && item.email
            ? sanitizeString(String(item.email), 150)
            : "";
        if (!targetId && !targetEmail) continue;
        const matched = knownUsers.find(
          (u) =>
            (targetId && u.id === targetId) ||
            (targetEmail && u.email.toLowerCase() === targetEmail.toLowerCase()) ||
            (targetId && u.email.toLowerCase() === targetId.toLowerCase())
        );
        if (matched && matched.id) {
          resolvedAssignees.push({
            id: matched.id,
            ...(matched.email ? { email: matched.email } : {}),
          });
        } else if (targetId && targetId.startsWith("us")) {
          resolvedAssignees.push({
            id: targetId,
            ...(targetEmail ? { email: targetEmail } : {}),
          });
        }
      }
      caseData["Assigned to"] = resolvedAssignees;
    }
  }

  let finalCaseId;

  if (isEditMode) {
    finalCaseId = existingCaseId;
    if (shouldSyncCase) {
      // UPDATE existing record
      const updateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
        method: "PATCH",
        headers: {
          "xc-token": activeWriteToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ Id: existingCaseId, ...caseData }]),
      });

      if (!updateRes.ok) {
        console.error("NocoDB Case update error:", updateRes.status, await updateRes.text());
        return jsonResponse({ error: "Failed to update case record in database." }, 502, corsHeaders);
      }
    }
  } else {
    // CREATE new record
    const caseCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.CASES}/records`, {
      method: "POST",
      headers: {
        "xc-token": activeWriteToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([caseData]),
    });

    if (!caseCreateRes.ok) {
      console.error("NocoDB Case creation error:", caseCreateRes.status, await caseCreateRes.text());
      return jsonResponse(
        { error: "Unable to save case submission in database. Please check your entries." },
        502,
        corsHeaders
      );
    }

    const createdRecords = await caseCreateRes.json();
    const createdCase = Array.isArray(createdRecords) ? createdRecords[0] : createdRecords;
    finalCaseId = createdCase.Id || createdCase.id;
  }

  // Sync Participant records
  const participantIds = [];
  const syncedParticipants = [];

  if (shouldSyncParticipants) {
    const rawParticipants = clampArray(payload.participants, MAX_PARTICIPANTS);

    for (const p of rawParticipants) {
      const pFields = {
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
      };

      let targetPartId = null;
      let currentPartLocIds = [];

      if (p.id) {
        targetPartId = Number(p.id);
        // Fetch existing participant record to get current linked Locations
        try {
          const existingPartRes = await fetch(
            `${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records/${targetPartId}`,
            { headers: { "xc-token": token } }
          );
          if (existingPartRes.ok) {
            const existingPart = await existingPartRes.json();
            currentPartLocIds = extractIds(existingPart["Locations"]);
          }
        } catch (_) {}

        // Update existing participant
        await fetch(`${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records`, {
          method: "PATCH",
          headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
          body: JSON.stringify([{ Id: targetPartId, ...pFields }]),
        });
        participantIds.push(targetPartId);
      } else {
        // Create new participant record
        const partCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.PARTICIPANTS}/records`, {
          method: "POST",
          headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
          body: JSON.stringify([pFields]),
        });
        if (partCreateRes.ok) {
          const createdParts = await partCreateRes.json();
          const rec = Array.isArray(createdParts) ? createdParts[0] : createdParts;
          const newId = rec.Id || rec.id;
          if (newId) {
            targetPartId = Number(newId);
            participantIds.push(targetPartId);
          }
        }
      }

      // Resolve and sync linked Locations on the Participant record
      if (targetPartId && Array.isArray(p.locations)) {
        const desiredPartLocIds = await resolveLocations(
          clampArray(p.locations, MAX_LOCATIONS_PER_PARTICIPANT),
          baseUrl,
          activeWriteToken
        );
        await syncTableLinks(
          TABLES.PARTICIPANTS,
          LINK_FIELDS.PARTICIPANT_LOCATIONS,
          targetPartId,
          desiredPartLocIds,
          currentPartLocIds,
          baseUrl,
          activeWriteToken
        );
      }

      syncedParticipants.push({
        ...p,
        id: targetPartId || p.id || null,
      });
    }
  }

  // Sync Supporting Resources
  const resourceIds = [];
  const syncedResources = [];

  if (shouldSyncResources) {
    const rawResources = clampArray(payload.resources, MAX_RESOURCES);

    for (const r of rawResources) {
      const title = sanitizeString(r.title, 250);
      const resUrl = sanitizeString(r.url, 500);
      const validUrl = resUrl && isValidHttpUrl(resUrl) ? resUrl : null;
      const attachmentsForDb = prepareAttachmentsForNocoDB(
        r.attachments,
        MAX_RESOURCE_ATTACHMENTS
      );

      if (title && (validUrl || attachmentsForDb.length > 0)) {
        const rFields = {
          "Title": title,
          "URL": validUrl,
          "Select": sanitizeString(r.resourceType, 100) || "Other",
          "Short description": sanitizeString(r.description, 1000) || null,
          "License": sanitizeString(r.license, 100) || null,
          "Attachments": attachmentsForDb,
        };

        let targetResId = null;
        if (r.id) {
          targetResId = Number(r.id);
          // Update existing resource
          await fetch(`${baseUrl}/api/v2/tables/${TABLES.RESOURCES}/records`, {
            method: "PATCH",
            headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
            body: JSON.stringify([{ Id: targetResId, ...rFields }]),
          });
          resourceIds.push(targetResId);
        } else {
          // Create new resource
          const resCreate = await fetch(`${baseUrl}/api/v2/tables/${TABLES.RESOURCES}/records`, {
            method: "POST",
            headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
            body: JSON.stringify([rFields]),
          });
          if (resCreate.ok) {
            const createdR = await resCreate.json();
            const rec = Array.isArray(createdR) ? createdR[0] : createdR;
            const newId = rec.Id || rec.id;
            if (newId) {
              targetResId = Number(newId);
              resourceIds.push(targetResId);
            }
          }
        }

        syncedResources.push({
          ...r,
          id: targetResId || r.id || null,
          url: validUrl || "",
          attachments: normalizeAttachmentsArray(r.attachments),
        });
      }
    }
  }

  // Sync Messages
  const messageIds = [];
  const syncedMessages = [];

  if (shouldSyncMessages) {
    const rawMessages = clampArray(payload.messages, MAX_MESSAGES);
    const msgTypeCounters = {};

    for (const m of rawMessages) {
      const text = sanitizeString(m.text || m.name, 10000);
      const type = sanitizeAllowedOption(m.type, ["Action", "Issue", "Recommendation", "Quote"]) || "Recommendation";

      if (text) {
        msgTypeCounters[type] = (msgTypeCounters[type] || 0) + 1;
        const defaultTitle = `${type} ${msgTypeCounters[type]}`;
        const title = sanitizeString(m.title, 250) || defaultTitle;

        const mFields = {
          "Title": title,
          "Name": text,
          "Type": type,
        };

        let targetMsgId = null;
        if (m.id) {
          targetMsgId = Number(m.id);
          // Update existing message
          await fetch(`${baseUrl}/api/v2/tables/${TABLES.MESSAGES}/records`, {
            method: "PATCH",
            headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
            body: JSON.stringify([{ Id: targetMsgId, ...mFields }]),
          });
          messageIds.push(targetMsgId);
        } else {
          // Create new message
          const msgCreateRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.MESSAGES}/records`, {
            method: "POST",
            headers: { "xc-token": activeWriteToken, "Content-Type": "application/json" },
            body: JSON.stringify([mFields]),
          });
          if (msgCreateRes.ok) {
            const createdMsg = await msgCreateRes.json();
            const rec = Array.isArray(createdMsg) ? createdMsg[0] : createdMsg;
            const newId = rec.Id || rec.id;
            if (newId) {
              targetMsgId = Number(newId);
              messageIds.push(targetMsgId);
            }
          }
        }

        syncedMessages.push({
          ...m,
          id: targetMsgId || m.id || null,
          title,
          text,
          type,
        });
      }
    }
  }

  // Sync relationship links for all active scopes using NocoDB's dedicated link endpoints
  const linkPromises = [];
  if (shouldSyncOrgs) {
    linkPromises.push(
      syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_LEAD_ORGS, finalCaseId, leadOrgIds, currentLeadOrgIds, baseUrl, activeWriteToken),
      syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_FUNDING_ORGS, finalCaseId, fundingOrgIds, currentFundingOrgIds, baseUrl, activeWriteToken),
      syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_INVOLVED_ORGS, finalCaseId, involvedOrgIds, currentInvolvedOrgIds, baseUrl, activeWriteToken)
    );
  }
  if (shouldSyncParticipants) {
    linkPromises.push(
      syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_PARTICIPANTS, finalCaseId, participantIds, currentPartIds, baseUrl, activeWriteToken)
    );
  }
  if (shouldSyncResources) {
    linkPromises.push(
      syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_RESOURCES, finalCaseId, resourceIds, currentResIds, baseUrl, activeWriteToken)
    );
  }
  if (shouldSyncMessages) {
    linkPromises.push(
      syncTableLinks(TABLES.CASES, LINK_FIELDS.CASE_MESSAGES, finalCaseId, messageIds, currentMsgIds, baseUrl, activeWriteToken)
    );
  }
  await Promise.all(linkPromises);

  return jsonResponse(
    {
      success: true,
      caseId: finalCaseId,
      editKey: isEditMode ? payload.editKey : generatedEditKey,
      mode: isEditMode ? "edit" : "create",
      syncedScopes: [...activeScopes],
      syncedData: {
        ...(shouldSyncOrgs
          ? {
              leadOrganisations: clampArray(payload.leadOrganisations, MAX_ORGS_PER_FIELD),
              fundingOrganisations: clampArray(payload.fundingOrganisations, MAX_ORGS_PER_FIELD),
              involvedOrganisations: clampArray(payload.involvedOrganisations, MAX_ORGS_PER_FIELD),
            }
          : {}),
        ...(shouldSyncParticipants ? { participants: syncedParticipants } : {}),
        ...(shouldSyncResources ? { resources: syncedResources } : {}),
        ...(shouldSyncMessages ? { messages: syncedMessages } : {}),
      },
      message: isEditMode
        ? "Case record updated successfully."
        : isNomination
        ? "Project nomination recorded successfully."
        : "Full case study entry submitted successfully.",
    },
    200,
    corsHeaders
  );
}

/**
 * Resolves an array of organisation items
 */
async function resolveOrganisations(orgsList, baseUrl, token) {
  if (!Array.isArray(orgsList) || orgsList.length === 0) return [];

  const finalIds = [];

  for (const item of orgsList) {
    if (!item) continue;

    if (typeof item === "number" || (typeof item === "string" && !isNaN(Number(item)))) {
      finalIds.push(Number(item));
      continue;
    }

    if (item.id && !isNaN(Number(item.id))) {
      finalIds.push(Number(item.id));
      continue;
    }

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
        const existingOrgId = checkData.list[0].Id || checkData.list[0].id;
        finalIds.push(existingOrgId);
        if (typeof item === "object") {
          item.id = existingOrgId;
          item.isNew = false;
        }
        continue;
      }
    }

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
      const newOrgId = rec.Id || rec.id;
      if (newOrgId) {
        finalIds.push(newOrgId);
        if (typeof item === "object") {
          item.id = newOrgId;
          item.isNew = false;
        }
        // If new organisation also specified a location, resolve & link it
        if (Array.isArray(item.locations) && item.locations.length > 0) {
          const orgLocIds = await resolveLocations(clampArray(item.locations, 5), baseUrl, token);
          if (orgLocIds.length > 0) {
            await syncTableLinks(
              TABLES.ORGANISATIONS,
              LINK_FIELDS.ORG_MAIN_LOCATION,
              newOrgId,
              orgLocIds,
              [],
              baseUrl,
              token
            );
          }
        }
      }
    }
  }

  return [...new Set(finalIds)];
}

/**
 * Resolves an array of location items into NocoDB Locations record IDs.
 * If a location is new, checks by Name first, geocodes via Nominatim if needed, and creates the record.
 */
async function resolveLocations(locsList, baseUrl, token) {
  if (!Array.isArray(locsList) || locsList.length === 0) return [];

  const finalIds = [];

  for (const item of locsList) {
    if (!item) continue;

    if (typeof item === "number" || (typeof item === "string" && !isNaN(Number(item)))) {
      finalIds.push(Number(item));
      continue;
    }

    if (item.id && !isNaN(Number(item.id))) {
      finalIds.push(Number(item.id));
      continue;
    }

    const name = sanitizeString(item.name || (typeof item === "string" ? item : ""), 200);
    if (!name || name.length < 2) continue;

    const safeNameQuery = sanitizeSearchQuery(name);
    if (!safeNameQuery) continue;

    const encodedWhere = encodeURIComponent(`(Name,eq,${safeNameQuery})`);
    const checkRes = await fetch(
      `${baseUrl}/api/v2/tables/${TABLES.LOCATIONS}/records?where=${encodedWhere}&limit=1`,
      { headers: { "xc-token": token } }
    );

    if (checkRes.ok) {
      const checkData = await checkRes.json();
      if (checkData.list && checkData.list.length > 0) {
        const existingId = checkData.list[0].Id || checkData.list[0].id;
        if (existingId) {
          finalIds.push(Number(existingId));
          continue;
        }
      }
    }

    // Geocode if coordinates aren't already supplied on the item
    let latitude =
      item.latitude !== undefined && item.latitude !== null && !isNaN(Number(item.latitude))
        ? Number(item.latitude)
        : null;
    let longitude =
      item.longitude !== undefined && item.longitude !== null && !isNaN(Number(item.longitude))
        ? Number(item.longitude)
        : null;
    let countryCode = sanitizeString(item.countryCode || "", 10);

    if (latitude === null || longitude === null) {
      const geo = await geocodeLocationName(name, countryCode);
      if (geo) {
        latitude = geo.latitude;
        longitude = geo.longitude;
        if (!countryCode && geo.countryCode) {
          countryCode = geo.countryCode;
        }
      }
    }

    const locPayload = {
      Name: name,
    };
    if (latitude !== null) locPayload.Latitude = latitude;
    if (longitude !== null) locPayload.Longitude = longitude;
    if (countryCode) locPayload["Country Code"] = countryCode;

    const createRes = await fetch(`${baseUrl}/api/v2/tables/${TABLES.LOCATIONS}/records`, {
      method: "POST",
      headers: {
        "xc-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([locPayload]),
    });

    if (createRes.ok) {
      const created = await createRes.json();
      const rec = Array.isArray(created) ? created[0] : created;
      const newLocId = rec.Id || rec.id;
      if (newLocId) {
        finalIds.push(Number(newLocId));
      }
    }
  }

  return [...new Set(finalIds)];
}

/* -------------------------------------------------------------
 * Security & Helper Utilities
 * ------------------------------------------------------------- */

function generateSecureKey(len = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(len);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < len; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Noco-Token",
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

function ensureArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map((item) => (typeof item === "object" && item !== null ? item.title || item.Name || String(item) : String(item).trim())).filter(Boolean);
  }
  if (typeof val === "string") {
    val = val.trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      try {
        const parsed = JSON.parse(val);
        return ensureArray(parsed);
      } catch (e) {}
    }
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [String(val)];
}

function extractIds(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((o) => (typeof o === "object" && o !== null ? (o.Id || o.id || (o.id_fields && o.id_fields.Id)) : o))
    .filter((id) => id !== null && id !== undefined && !isNaN(Number(id)))
    .map(Number);
}

/**
 * Syncs many-to-many relationship links using NocoDB's dedicated /links/ endpoint.
 * Adds newly linked records and removes unlinked records.
 */
async function syncTableLinks(tableId, fieldId, recordId, desiredIds, currentIds, baseUrl, token) {
  const currentSet = new Set((currentIds || []).map(Number));
  const desiredSet = new Set((desiredIds || []).map(Number));

  const toAdd = [...desiredSet].filter((id) => !currentSet.has(id));
  const toRemove = [...currentSet].filter((id) => !desiredSet.has(id));

  if (toAdd.length > 0) {
    try {
      const addRes = await fetch(`${baseUrl}/api/v2/tables/${tableId}/links/${fieldId}/records/${recordId}`, {
        method: "POST",
        headers: {
          "xc-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toAdd.map((id) => ({ Id: id }))),
      });
      if (!addRes.ok) {
        console.warn(`Failed to add links on table ${tableId}, field ${fieldId}:`, addRes.status, await addRes.text());
      }
    } catch (err) {
      console.warn(`Exception adding links on table ${tableId}, field ${fieldId}:`, err);
    }
  }

  if (toRemove.length > 0) {
    try {
      const delRes = await fetch(`${baseUrl}/api/v2/tables/${tableId}/links/${fieldId}/records/${recordId}`, {
        method: "DELETE",
        headers: {
          "xc-token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toRemove.map((id) => ({ Id: id }))),
      });
      if (!delRes.ok) {
        console.warn(`Failed to remove links on table ${tableId}, field ${fieldId}:`, delRes.status, await delRes.text());
      }
    } catch (err) {
      console.warn(`Exception removing links on table ${tableId}, field ${fieldId}:`, err);
    }
  }
}


