const classes = new WeakMap();

const esc = (v) => String(v).replace(/["\\\]]/g, '\\$&');

export function conditionCss(id, conditions) {
  const root = `[data-materialsettings="${esc(id)}"]`;
  const rules = [];
  for (const { row, parent, values, show } of conditions) {
    const target = `.dicer-ms-row[data-setting="${esc(row)}"]`;
    const picked = values.map((v) =>
      typeof v === 'boolean'
        ? `${root}:has(input[name$="[${esc(parent)}]"]${v ? ':checked' : ':not(:checked)'}) ${target}`
        : `${root}:has(select[name$="[${esc(parent)}]"] option[value="${esc(v)}"]:checked) ${target}`,
    );
    if (show) {
      rules.push(`${root} ${target}{display:none}`);
      rules.push(`${picked.join(',')}{display:block}`);
    } else rules.push(`${picked.join(',')}{display:none}`);
  }
  return rules.join('\n');
}

export function dicerMaterialClass(DiceMaterial) {
  let cls = classes.get(DiceMaterial);
  if (cls) return cls;
  cls = class DicerMaterial extends DiceMaterial {
    _conditions = [];

    showWhen(row, parent, ...values) {
      this._conditions.push({ row, parent, values, show: true });
      return this;
    }

    hideWhen(row, parent, ...values) {
      this._conditions.push({ row, parent, values, show: false });
      return this;
    }

    _buildSettingsContent(diceType, values, inputGroup, wrapper) {
      const out = { content: '', data: {} };
      if (!this._settings.length) return out;
      let html = '';
      let open = false;
      for (const setting of this._settings) {
        if (setting.type === 'separator') {
          html += `${open ? '</fieldset>' : ''}<fieldset class="dicer-ms-section"><legend>${setting.name}</legend>`;
          open = true;
          continue;
        }
        const line = this._buildSettingsLine(setting, diceType, values[setting.id], inputGroup);
        if (setting.id === null || setting.id === undefined) {
          html += line.content;
          continue;
        }
        html += `<div class="dicer-ms-row" data-setting="${setting.id}">${line.content}</div>`;
        out.data[setting.id] = line.data;
      }
      if (open) html += '</fieldset>';
      const css = conditionCss(this.id, this._conditions);
      out.content = `<div ${wrapper}="${this.id}" class="dicer-ms"><style>${css}</style>${html}</div>`;
      return out;
    }
  };
  classes.set(DiceMaterial, cls);
  return cls;
}
