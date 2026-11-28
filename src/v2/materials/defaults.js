import { BODY_TYPES, bodyMaterialId, createBodyMaterial } from './bodies.js';
import { createResinMaterial, RESIN_TYPES } from './resin.js';

function recordDefaults(create, type) {
  const defaults = {};
  const material = new Proxy(
    {},
    {
      get: (_, key) =>
        typeof key === 'string' && key.startsWith('addSetting')
          ? (setting) => {
              if (setting?.id) defaults[setting.id] = setting.defaultValue;
              return material;
            }
          : () => material,
    },
  );
  function Recorder() {
    return material;
  }
  create(Recorder, type);
  return Object.freeze(defaults);
}

let table = null;

function defaultsTable() {
  if (table) return table;
  table = new Map();
  for (const type of BODY_TYPES)
    table.set(bodyMaterialId(type), recordDefaults(createBodyMaterial, type));
  for (const type of RESIN_TYPES)
    table.set(bodyMaterialId(type), recordDefaults(createResinMaterial, type));
  return table;
}

export function settingDefaults(materialId) {
  return { ...(defaultsTable().get(materialId) ?? {}) };
}
