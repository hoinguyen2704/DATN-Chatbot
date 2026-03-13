import { CONTRACT } from "../db/contract.js";

function norm(str = "") {
  return String(str)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+|[_-]+/g, "")
    .replace(/[^a-z0-9\u00C0-\u024f]/g, "");
}

function singularizeSimple(s) {
  return s.endsWith("s") ? s.slice(0, -1) : s;
}

function buildResourceIndex() {
  const idx = new Map();
  for (const [key, res] of Object.entries(CONTRACT.resources)) {
    const k = norm(key);
    idx.set(k, key);
    idx.set(singularizeSimple(k), key);
    const aliases = res.aliases || [];
    for (const a of aliases) {
      const na = norm(a);
      idx.set(na, key);
      idx.set(singularizeSimple(na), key);
    }
    const defaults = [key, key + "s"];
    for (const d of defaults) {
      const nd = norm(d);
      idx.set(nd, key);
      idx.set(singularizeSimple(nd), key);
    }
  }
  return idx;
}

const RES_INDEX = buildResourceIndex();

function splitField(f) {
  const parts = String(f || "").split(".");
  return parts.length === 2
    ? { res: parts[0], field: parts[1] }
    : { res: null, field: String(f || "") };
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("PLAN_INVALID");

  // 1) Resolve resource
  const rawName = plan.resource;
  const resolved =
    RES_INDEX.get(norm(rawName)) ||
    RES_INDEX.get(singularizeSimple(norm(rawName)));
  if (!resolved) {
    const allowed = Object.keys(CONTRACT.resources).join("|");
    const err = new Error("RESOURCE_NOT_ALLOWED");
    err.details = { got: rawName, allowed };
    throw err;
  }
  const baseKey = resolved;
  const base = CONTRACT.resources[baseKey];

  // 2) Validate JOINs — max 3 cho TechShop (nhiều resource hơn HAVU)
  const requestedJoins = Array.isArray(plan.joins) ? plan.joins : [];
  const joins = [];
  const maxJoins = 3;
  for (const j of requestedJoins.slice(0, maxJoins)) {
    const jr = j?.resource;
    if (!jr) continue;
    const rel = base.relations?.[jr];
    if (!rel) continue;
    const frKey = rel.foreignResource || jr;
    if (!CONTRACT.resources[frKey]) continue;
    joins.push({
      resource: jr,
      alias: rel.alias || jr[0].toLowerCase(),
      type: (rel.type || "inner").toLowerCase(),
      localField: rel.localField,
      foreignResource: frKey,
      foreignField: rel.foreignField,
    });
  }

  // Helper: kiểm tra field hợp lệ
  const isValidField = (qualified) => {
    const { res, field } = splitField(qualified);
    if (!res) return !!base.fields[field];
    const j = joins.find((x) => x.resource === res);
    if (!j) return false;
    const jr = CONTRACT.resources[j.foreignResource];
    return !!jr?.fields?.[field];
  };

  // 3) SELECT
  let select =
    Array.isArray(plan.select) && plan.select.length
      ? plan.select
      : base.defaultSelect || [];
  select = select.filter(isValidField);
  if (!select.length) throw new Error("SELECT_EMPTY");

  // 4) WHERE
  const where = Array.isArray(plan.where)
    ? plan.where.filter((w) => w && isValidField(w.field))
    : [];

  // 5) SORT
  const sortSrc = Array.isArray(plan.sort) ? plan.sort : [];
  const sort = sortSrc
    .filter((s) => s && isValidField(s.field))
    .map((s) => ({
      field: s.field,
      dir: (s.dir || "asc").toLowerCase() === "desc" ? "desc" : "asc",
    }));

  // 6) LIMIT (max 30)
  let limit = Number(plan.limit || 0);
  if (!Number.isFinite(limit) || limit <= 0) limit = 5;
  if (limit > 30) limit = 30;

  return { resource: baseKey, joins, select, where, sort, limit };
}
