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

export class DiceSystem extends Settings {}
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
export class TabletopObject {}
