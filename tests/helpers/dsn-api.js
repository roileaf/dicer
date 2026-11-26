class Settings {
  constructor() {
    this._settings = [];
  }
  get settings() {
    return this._settings;
  }
  _add(type, { id, name, defaultValue, ...rest }) {
    if (!id || !name) throw new Error(`invalid ${type} setting`);
    this._settings.push({ type, id, name, defaultValue, ...rest });
  }
  addSettingSeparator({ name = '' } = {}) {
    this._settings.push({ type: 'separator', id: null, name });
  }
  addSettingHTML({ name }) {
    this._settings.push({ type: 'html', id: null, name });
  }
  _buildSettingsLine(setting, diceType, value, inputGroup) {
    if (setting.type === 'html') return { content: setting.name, data: {} };
    const name = `appearance[${diceType}][${inputGroup}][${setting.id}]`;
    return { content: `<input name="${name}">`, data: { value, name } };
  }
  _buildSettingsContent() {
    return { content: 'base', data: {} };
  }
  addSettingBoolean(s) {
    this._add('boolean', s);
  }
  addSettingColor(s) {
    this._add('color', s);
  }
  addSettingRange(s) {
    this._add('range', s);
  }
  addSettingSelect(s) {
    this._add('select', s);
  }
  addSettingString(s) {
    this._add('string', s);
  }
  addSettingFile(s) {
    this._add('file', s);
  }
}

export class DiceMaterial extends Settings {
  constructor(id, name) {
    super();
    Object.assign(this, {
      id,
      name,
      base: null,
      fallback: 'plastic',
      translucent: false,
      animated: false,
      impactSounds: null,
      weight: 1,
    });
    this._uniforms = new Map();
    this._process = [];
    this._shader = [];
  }
  setBase(type, options = {}, images = {}) {
    this.base = { type, options, images };
    return this;
  }
  setFallback(id) {
    this.fallback = id;
    return this;
  }
  setTranslucent(v = true) {
    this.translucent = v;
    return this;
  }
  setAnimated(v = true) {
    this.animated = v;
    return this;
  }
  setImpactSounds(id) {
    this.impactSounds = id;
    return this;
  }
  setWeight(w) {
    this.weight = w;
    return this;
  }
  addUniform(name, value) {
    this._uniforms.set(name, value);
    return this;
  }
  registerProcessMaterialCallback(cb) {
    this._process.push(cb);
  }
  registerBeforeShaderCompileCallback(cb) {
    this._shader.push(cb);
  }
}

export class DiceSystem extends Settings {
  constructor(id, name, mode = 'default', group = null) {
    super();
    Object.assign(this, { id, name, mode, group, mesh: null });
  }
  setMesh(name) {
    this.mesh = name;
    return this;
  }
}
export class DiceSFX {
  constructor(box, dicemesh, options = {}) {
    this.box = box;
    this.dicemesh = dicemesh;
    this.options = options;
    this.moment = 'result';
    this.hit = null;
    this.destroyed = false;
  }
}
export class TabletopObject {
  static OBJECT_EVENT_TYPE = { HIT: 0, FRAME: 1, CLICK: 2 };

  constructor(id) {
    this.id = id;
    this.model = null;
    this.modelSource = null;
    this.collider = null;
    this.position = { x: 0.5, y: 0.5 };
    this.rotation = 0;
    this.scale = 1;
    this.animated = false;
    this.persistent = false;
    this.listeners = {};
  }
  setModel(model) {
    this.modelSource = model;
    if (model && typeof model === 'object') this.model = model;
    return this;
  }
  setCollider(shapes) {
    this.collider = shapes;
    return this;
  }
  setPosition(position) {
    this.position = { ...position };
    return this;
  }
  setRotation(angle) {
    this.rotation = angle;
    return this;
  }
  setScale(scale) {
    this.scale = scale;
    return this;
  }
  setAnimated(animated = true) {
    this.animated = animated;
    return this;
  }
  setPersistent(persistent = true) {
    this.persistent = persistent;
    return this;
  }
  on(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) listener({ object: this, ...event });
  }
}
