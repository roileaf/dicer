import { GROUP, MODULE_ID } from './sounds/register.js';

export const STUDIO_ENVIRONMENT = Object.freeze({
  id: `${MODULE_ID}.studio`,
  name: 'DICER.V2.Ambiance.studio',
  group: GROUP,
  src: `modules/${MODULE_ID}/assets/lighting/dicer-studio.hdr`,
});

export function registerLighting(dice3d) {
  dice3d.addEnvironment({ ...STUDIO_ENVIRONMENT });
  return STUDIO_ENVIRONMENT.id;
}
