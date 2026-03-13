import { CONTRACT } from "../db/contract.js";

function splitField(f) {
  const parts = String(f || "").split(".");
  return parts.length === 2
    ? { res: parts[0], field: parts[1] }
    : { res: null, field: String(f || "") };
}

function normalizeOp(op = "eq") {
  const o = String(op).toLowerCase();
  if (o === ">" || o === "gt") return "gt";
  if (o === "<" || o === "lt") return "lt";
  if (o === ">=" || o === "gte") return "gte";
  if (o === "<=" || o === "lte") return "lte";
  if (o === "contains") return "contains";
  if (o === "startswith" || o === "starts_with" || o === "^") return "startswith";
  if (o === "between") return "between";
  if (o === "in") return "in";
  return "eq";
}

export function planToSQL(plan) {
  const baseRes = CONTRACT.resources[plan.resource];
  const baseAlias = "t";
  const aliasMap = { [plan.resource]: baseAlias };

  // FROM
  let fromSql = `FROM ${baseRes.view} "${baseAlias}"`;

  // JOINs
  const joinsSql = [];
  for (const j of plan.joins || []) {
    const rel = baseRes.relations?.[j.resource];
    if (!rel) continue;
    const rightRes = CONTRACT.resources[rel.foreignResource || j.resource];
    if (!rightRes) continue;
    const rightAlias = rel.alias || j.alias || j.resource[0]?.toLowerCase() || "j";
    aliasMap[j.resource] = rightAlias;
    const joinType = (rel.type || j.type || "inner").toUpperCase();
    joinsSql.push(
      `${joinType} JOIN ${rightRes.view} "${rightAlias}" ON ` +
        `"${baseAlias}"."${rel.localField}" = "${rightAlias}"."${rel.foreignField}"`
    );
  }

  // Helper: "alias"."column"
  const qcol = (qualified) => {
    const { res, field } = splitField(qualified);
    const alias = res ? aliasMap[res] : baseAlias;
    return `"${alias || baseAlias}"."${field}"`;
  };

  // SELECT
  const selectCols = plan.select.map(qcol).join(", ");

  // WHERE
  const params = [];
  const whereClauses = [];
  for (const w of plan.where || []) {
    const { res, field } = splitField(w.field);
    let meta;
    if (!res) {
      meta = baseRes.fields[field];
    } else {
      const rel = baseRes.relations?.[res];
      const frKey = rel?.foreignResource || res;
      meta = CONTRACT.resources[frKey]?.fields?.[field];
    }

    const op = normalizeOp(w.op);
    const val = w.value;

    switch (op) {
      case "contains":
        params.push(`%${val}%`);
        whereClauses.push(`${qcol(w.field)} ILIKE $${params.length}`);
        break;
      case "startswith":
        params.push(`${val}%`);
        whereClauses.push(`${qcol(w.field)} ILIKE $${params.length}`);
        break;
      case "gte":
      case "lte":
      case "gt":
      case "lt": {
        const sign = { gte: ">=", lte: "<=", gt: ">", lt: "<" }[op];
        params.push(val);
        whereClauses.push(`${qcol(w.field)} ${sign} $${params.length}`);
        break;
      }
      case "between": {
        const [a, b] = Array.isArray(val) ? val : [null, null];
        params.push(a, b);
        whereClauses.push(
          `${qcol(w.field)} BETWEEN $${params.length - 1} AND $${params.length}`
        );
        break;
      }
      case "in": {
        const arr = Array.isArray(val) ? val : [val];
        params.push(arr);
        const t = (meta?.type || "text").toLowerCase();
        const cast = t === "uuid" ? "uuid[]" : t === "number" ? "numeric[]" : "text[]";
        whereClauses.push(`${qcol(w.field)} = ANY($${params.length}::${cast})`);
        break;
      }
      case "eq":
      default:
        params.push(val);
        whereClauses.push(`${qcol(w.field)} = $${params.length}`);
        break;
    }
  }

  // ORDER BY
  let orderSql = "";
  if (plan.sort?.length) {
    const parts = plan.sort
      .map((s) => `${qcol(s.field)} ${String(s.dir || "asc").toUpperCase()}`)
      .join(", ");
    if (parts) orderSql = ` ORDER BY ${parts}`;
  }

  const whereSql = whereClauses.length
    ? ` WHERE ${whereClauses.join(" AND ")}`
    : "";
  const finalSql =
    `SELECT ${selectCols} ` +
    `${fromSql} ` +
    `${joinsSql.length ? joinsSql.join(" ") + " " : ""}` +
    `${whereSql}${orderSql} ` +
    `LIMIT ${plan.limit}`;

  return { sql: finalSql, params };
}
