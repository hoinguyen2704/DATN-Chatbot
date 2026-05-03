import { getConfig, getDefaults } from "./config-manager.js";

const FALLBACK_MODELS = ["gpt-5.4-mini"];

function normalizeModelName(modelName = "") {
  return String(modelName || "").trim().replace(/^models\//i, "");
}

function inferProviderFromModelName(modelName = "") {
  return /^(gpt-|chatgpt-|o\d(?:$|-))/i.test(normalizeModelName(modelName))
    ? "openai"
    : "gemini";
}

function normalizeModelEntry(entry) {
  if (typeof entry === "string") {
    return {
      value: normalizeModelName(entry),
      label: normalizeModelName(entry),
      provider: inferProviderFromModelName(entry),
    };
  }

  if (entry && typeof entry === "object") {
    return {
      value: normalizeModelName(entry.value || entry.model || ""),
      label:
        typeof entry.label === "string" && entry.label.trim()
          ? entry.label.trim()
          : normalizeModelName(entry.value || entry.model || ""),
      provider:
        entry.provider === "openai" || entry.provider === "gemini"
          ? entry.provider
          : inferProviderFromModelName(entry.value || entry.model || ""),
    };
  }

  return { value: "", label: "", provider: undefined };
}

function toModelOption(modelEntry, source = "defined") {
  const normalizedEntry = normalizeModelEntry(modelEntry);
  const value = normalizedEntry.value;
  if (!value) return null;

  return {
    value,
    label: normalizedEntry.label || value,
    provider: normalizedEntry.provider,
    source,
  };
}

function uniqueModelOptions(options = []) {
  const seen = new Set();
  const result = [];

  for (const option of options) {
    if (!option?.value) continue;
    const value = normalizeModelName(option.value);
    if (!value || seen.has(value)) continue;

    seen.add(value);
    result.push({
      value,
      label: option.label || value,
      provider: option.provider,
      source: option.source || "defined",
    });
  }

  return result;
}

function sortModelOptions(options = []) {
  const providerOrder = {
    openai: 0,
    gemini: 1,
  };

  return [...options].sort((left, right) => {
    const leftProvider = providerOrder[left.provider] ?? 99;
    const rightProvider = providerOrder[right.provider] ?? 99;

    if (leftProvider !== rightProvider) {
      return leftProvider - rightProvider;
    }

    return left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function readDefinedModels() {
  const config = getConfig();
  const defaults = getDefaults();
  const configModels = Array.isArray(config?.ai?.availableModels)
    ? config.ai.availableModels
    : [];
  const defaultModels = Array.isArray(defaults?.ai?.availableModels)
    ? defaults.ai.availableModels
    : [];
  const envModels = String(process.env.CHATBOT_ALLOWED_MODELS || "")
    .split(/[\n,]/)
    .map((item) => normalizeModelName(item))
    .filter(Boolean);

  return [...configModels, ...defaultModels, ...envModels]
    .map((modelEntry) => normalizeModelEntry(modelEntry))
    .filter((modelEntry) => Boolean(modelEntry.value));
}

export function getModelCatalog() {
  const currentModel = normalizeModelName(getConfig()?.ai?.model);
  const currentProvider = getConfig()?.ai?.provider;
  const definedModels = uniqueModelOptions(
    readDefinedModels()
      .map((modelName) => toModelOption(modelName, "defined"))
      .filter(Boolean),
  );

  const models = uniqueModelOptions([
    ...(currentModel
      ? [
          {
            value: currentModel,
            label: currentModel,
            provider: currentProvider,
            source: "current",
          },
        ]
      : []),
    ...definedModels,
  ]);

  return {
    source: definedModels.length > 0 ? "defined" : "fallback",
    currentModel,
    models: sortModelOptions(
      models.length > 0
        ? models
        : uniqueModelOptions(
            FALLBACK_MODELS.map((modelName) => toModelOption(modelName, "fallback")),
          ),
    ),
  };
}
