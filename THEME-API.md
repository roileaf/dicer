# Dicer theme API for other modules

Dicer 1.4.0 and later give other modules a small API to ship dice themes and default them onto
actors, without writing to Dicer's settings or flags.

```js
Hooks.once('dicer.ready', (api) => {
  // api === game.modules.get('dicer').api
});
```

`dicer.ready` fires once in Dicer's `ready` hook. A module whose own `ready` runs later can also
check `game.modules.get('dicer')?.api` directly.

## Themes

```js
api.registerTheme(theme, { moduleId, showInAll?, material? }); // true when registered
api.unregisterTheme(themeId);
api.listThemes(moduleId); // copies of a module's registered themes
```

- `theme` is the same shape as an entry of Dicer's world theme list:
  `{ id, name, appearance, perType?, rules?, soundMaterial?, damage? }`. Export a theme from
  Dicer's theme browser to get one.
- `appearance.numbers.offsetY` moves the numbers (and the icons, pips and coin motifs drawn with them) up or down on the face, in face units from -0.5 to 0.5, positive up, 0 by default. It is applied after `numbers.size`, so scaling the numbers does not change it. Use it for a font whose glyphs hang below or float above the baseline (a dripping display face, say) so its numbers sit in the middle of the face.
- `appearance.numbers.minContrast` (1.5 to 7, unset by default) is the contrast ratio the numbers must reach on the die when `numbers.contrast` is on. Unset, Dicer asks for 3, a little more for thin built-in faces (`handwritten`, `blackletter`) and a little less for a heavier `numbers.weight`. The check compares the number as seen (its fill after the coat's veil and its glow) with the body as seen: the second colour on bodies that show it (pearl, iridescent, jelly, marble, wood, stone, bone, gem, and the aged metal finishes), both inside colours on resin, and a light coat veil that grows from opaque to pearl. A look that fails it has its number colour moved lighter or darker, as before; a look that passes keeps its colour. The appearance editor shows whether the numbers read, are close, or were adjusted.
- A theme rule whose `id` matches a world trigger's id (`dicer.nat20`, `dicer.nat1`, or any trigger the GM has) replaces that trigger for dice wearing the theme: the world rule's effect and sound do not play, the theme rule's do. A world rule's macro still runs for its roller. A rule with a new id adds to the world rules instead. Use the built-in ids when a set's own crit effect should stand alone, with no celebrate or fumble on top.
- The id must start with `<moduleId>.` (for example `necromancer-thrall-helper.necromancer`).
- Registered themes live for the session only and are read-only. Register them every load: every
  player's client runs your module, so every player sees them, with no GM involved.
- Registering an id again replaces it (a module update can change its theme). Each change fires
  `dicer.themesChanged`.
- In Dicer's theme browser they show among all themes, tagged with your module's title (or the
  theme's `badge`). Players can duplicate one into their own themes to change it; the GM can make
  one the world default.

Optional fields on a registered theme:

| Field | Use |
| --- | --- |
| `badge` | The tag on the card and the detail panel, instead of the module title. |
| `category` | A free string for grouping in other windows. `damage` puts the theme in its own group in the damage type map (see below). |
| `preview` | A static image path. The card and the detail panel show it instead of rendering a 3D die. Useful for large packs. |
| `pets` | `{ volume }`, 0 to 1. Scales the dice pets' voices that answer a roll of dice wearing this theme (the "ooh?", the reaction, the cheer, an elemental yelp), on top of the player's own pet volume. `0` is silent, `0.33` a third. Petting and other sounds that answer no roll are unchanged, and the pets still move. When a roll mixes themes the quietest wins. It applies where the viewer gets the theme's effects: with **Effects** off, or **Show others' effects** off for another player's roll, the pets are as usual. Registered themes only; a copy saved as a world or user theme does not keep it. |

Options on `registerTheme(theme, { moduleId, showInAll, material })`:

- `showInAll`: a boolean, or `(theme, date) => boolean`, asked each time the browser draws. While it
  is false the theme is left out of the **All** tab (and its count) but stays on its module's tabs and
  everywhere it can be picked. For seasonal sets.
- `material`: see Animated materials.

## Browser tabs

```js
api.registerBrowserTab(moduleId, {
  id: 'my-module-holidays',        // unique, starts with `<moduleId>-` or `<moduleId>.`
  label: 'Holidays',               // text or an i18n key
  icon: 'fa-solid fa-gift',        // a Font Awesome class, or an image path
  filter: (theme) => boolean,      // which themes the tab shows
  sort: (a, b) => number,          // optional
  sections: (theme) => string,     // optional: the heading a theme sits under
});
api.unregisterBrowserTab(id);
```

Module tabs come after Dicer's own, with the same count badge and the same search. `filter` gets
every theme (built-in, add-on, world and the user's own). Themes with the same section stay together,
sections in the order they first appear. A callback that throws counts as "not shown", "unsorted"
and "no heading". Registering an id again replaces the tab.

## Themes on demand

```js
api.registerThemeStub(moduleId, { id, name, badge?, preview?, category?, showInAll?, load: async () => theme });
```

A stub shows as a normal card (with its `preview`). Selecting it in the browser, assigning it anywhere
there, or a stored reference to it (default, damage map, actor) calls `load()` once and swaps the
stub for the theme it returns, which must have the same id. `dicer.themesChanged` fires then. If
`load()` fails, Dicer warns once and keeps the stub; selecting it again retries. A roll that reaches
an unloaded stub (a stored reference) starts the load and uses the default look for that roll. To make that rare, a stub that a stored default, a world default, a damage map, a user's choice or an actor's choice names is loaded as soon as it is registered (right after the registering code finishes), before any roll. `showInAll` works as in `registerTheme` and carries over to the theme once it loads. Registering a full theme with a stub's id replaces the stub, and `setUserDefault` loads a stub first.
`unregisterTheme(id)` removes a stub too.

## Damage type map

Registered themes are listed in the **World choice** and **My override** dropdowns, grouped by module
(`<optgroup>` labelled with the module's title). Themes with `category: 'damage'` go in a group
right after Default. Stubs are listed too.

## A user's default

```js
api.getUserDefault(user = game.user);           // a theme id, or 'default'
await api.setUserDefault(themeId, user = game.user); // same effect as "Use as my default"; true when set
```

`getUserDefault` follows what the browser shows as "Your default": the user's stored choice, else the
GM's world default, else (for the current user) the `theme` setting. `setUserDefault('default')`
clears the choice. Another user's default needs a GM. A player under the GM's look lock is refused.
An id that names no built-in, add-on, world or personal theme is refused.

## Animated materials

```js
api.registerTheme(theme, {
  moduleId,
  material: { cacheKey: 'my-module-lights', beforeShaderCompile(shader, material, { themeId, dieType }) {} },
});
// or register a material once, and name it from any look:
api.registerMaterial(moduleId, { cacheKey: 'my-module-lights', beforeShaderCompile() {} });
// theme: { appearance: { ..., material: 'my-module-lights' } }
```

`cacheKey` names the material and must start with `<moduleId>-` or `<moduleId>.` (a separator, so one module cannot claim another's keys). A look whose `material` field names
it draws with the hook, wherever it is drawn: rolled dice, the browser's thumbnails and live
preview, and the tray (dice with no registered material draw as usual).

- The hook runs after Dicer's own shader patch, not under the "safe" quality tier, and never on ghost
  dice. `themeId` is the theme that registered the material.
- The fragment shader starts with `uniform float uTime;` (seconds, shared by all dice, wrapping
  every 3600 so a looped effect should use a period that divides it) and `#define vDicerPosition vLocalPos`,
  the die's object-space position, so a pattern stays fixed to the die as it tumbles.
- Registering a `cacheKey` again replaces the hook for dice made afterwards: each registration is a revision that is part of the keys, so cached materials and programs are never reused with the old hook.
- `cacheKey` is part of the material and shader program keys: dice with and without the hook never
  share a compiled program.
- A hook that throws is undone (the shader compiles as Dicer's own) and warns once.
- A die whose look also comes from a Dice So Nice system preset uses that system's hooks, not this one. The browser's thumbnails and previews follow the same rule.

## Fonts

```js
api.registerFont(moduleId, { id: 'my-module.lexend', label: 'Lexend', file: 'modules/my-module/fonts/Lexend-Bold.woff2' });
api.unregisterFont(id);
api.listFonts(moduleId); // copies of a module's registered fonts
```

Registered fonts show in the appearance editor's **Numbers** section as a row of buttons under the
module's title. Picking one sets the font to `file:<file>`, the same value a theme can already store
in `numbers.font`, so a theme made from it works without the module's registration (as long as the
file is served). `id` starts with `<moduleId>.`; `file` follows the rules of a `file:` font (a
relative path, no `..`, a font file extension). Registering an id again replaces it, and
`dicer.fontsChanged` fires on every change.

## Actors

```js
api.hasActorChoice(actor);   // has anybody picked dice for this actor? (theme, look, appearance, colorset or system)
api.getActorTheme(actor);    // the actor's own theme id, else a default provider's; null when neither
await api.setActorTheme(actor, themeId, { ifUnset: true }); // writes a choice (needs ownership); ifUnset: only when none
await api.clearActorTheme(actor); // removes the choice, so a default provider applies again
```

Pass a token's actor (`token.actor`) to read or set what that token itself carries: an unlinked
token keeps its own choice.

## Default providers (recommended)

```js
api.registerDefaultProvider(moduleId, (actor) => themeId | null);
```

Dicer asks providers, in registration order, only when the rolling actor has no dice choice. The
answer is never written to the actor, so removing your module removes the defaults and leaves no
flags behind. A choice made by a player or the GM always wins.

When a roll comes from a token, Dicer passes the provider that token's actor (an unlinked token's
synthetic actor, with its own flags), so a provider can tell a summoned thrall token apart.

## Preloading

The first roll of a look compiles its shaders, which can freeze the canvas for a moment. Dicer
compiles ahead the looks it expects: every player's, and those of the actors likely to roll (each
player's character, the actors players own, the tokens on the viewed scene). That covers an actor's
theme and a provider's default, and only the themes in use: a provider that hands out one of eight
themes per actor gets the ones its actors resolve to, not all eight. Nothing to do on your side.

```js
api.warmThemes([themeId, ...]); // -> how many of the ids name a theme
```

Call it only for themes you apply some other way (a roll's own `appearance`, a theme you set just
before rolling). Be selective: each theme is a compile on every client. Nothing is stored.

## Example: necromancer and thralls (Necromancer Thrall Helper)

```js
const MODULE = 'necromancer-thrall-helper';

Hooks.once('dicer.ready', async (api) => {
  // the two inverse themes, kept in the module as JSON (the world theme list format)
  const themes = await (await fetch(`modules/${MODULE}/dicer-themes.json`)).json();
  for (const theme of themes) api.registerTheme(theme, { moduleId: MODULE });

  // defaults for actors nobody picked dice for; never written, so players' choices always win
  api.registerDefaultProvider(MODULE, (actor) => {
    if (!game.settings.get(MODULE, 'dicerDefaults')) return null; // the module's own off switch
    if (isThrall(actor)) return `${MODULE}.thralls`;
    if (isNecromancer(actor)) return `${MODULE}.necromancer`;
    return null;
  });
});
```

`isThrall` and `isNecromancer` are the module's own tests (a flag it sets on a thrall token, a class
or feat on the necromancer). Without Dicer active, `dicer.ready` never fires and nothing is written.
