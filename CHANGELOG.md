# Changelog

## 1.5.3

- **The GM can lock typed-in dice with Big Bad Module Manager.** A new setting, **Type in my dice results** (per browser, under **Typed-in dice**), is what switches your dice between typing in and rolling; the typed-in dice button now just flips it. With [Big Bad Module Manager](https://github.com/thejoester/bbmm) a GM can lock it for the players (BBMM's lock applies to every player): a hard lock switches their dice when they log in and keeps them that way, and the button shows the lock instead of switching. A soft lock only recommends. Turning it off puts back exactly what it switched, and never undoes dice you set to manual yourself in Foundry's Configure Dice. If you had already switched to typed-in with the button, you stay typed in.
- **Fixed: Dicer's settings sections were mixed up.** The General settings (Enable 3D dice, Physics decides the result and the rest) showed up at the bottom, under the last section, with an empty General heading at the top. Each section now holds its own settings.

## 1.5.2

- **For module authors: a look can set its own trail.** `appearance.trail` gives a look the trail it flies with, instead of the one its inside or damage type picks: `"void"` for that element's trail, `"none"` for no trail, or `{ element: "void", colors: ["#8a4cc0", "#2a0a3d"] }` to recolour it (start and end colour, on every layer of the trail). It follows the look everywhere: damage dice, a picked theme, `perType`. The **Elemental trails** setting still applies, and natural 20 bursts and pet reactions follow the element as before. Very dark colours fade out on a dark map. There is no control for it in the dice editor yet. Thanks to 0utrider.
- **Fixed: a registered theme mapped to a damage type now previews its landing.** **Preview** in the damage type map showed such a set with no effect and no sound. It now plays the theme's landing: its rules with no `die`, `result`, `outcome` or `context`.
- **Fixed: a GM's custom damage type sound replaces a registered theme's landing sound**, as it does for a built-in damage theme. Before, both played. The theme's effect stays, and its other rules are untouched. Thanks to 0utrider.

## 1.5.1

- **Typed-in dice wear your dice theme.** The big dice in the window for typing in results now take their colours from your own dice look for each die type, the same one your 3D dice use: the body colours on the faces, the numbers in the theme's number colour (made readable, as on the 3D dice), and the theme's glow on the edges. The two colour settings from 1.5.0 are gone.
- **The typed-in dice button no longer pushes the chat buttons onto a second row.** It now sits in the chat dice bar, beside the eraser, while the bar is shown, and right after the chat's message modes when it is not.

## 1.5.0

- **Typing in the results of real dice.** When your dice are set to be typed in (Foundry's manual entry), the window for entering them now draws each die as a big faceted die: a pyramid for a d4, a cube for a d6, an octahedron for a d8, a d10, a d12 and a d20, and a coin. The number goes on its front face, so new players can see which die to pick up. A die glows while you type in it and once it has a number. Rerolled and exploding dice get their own die too. Each player can turn this off with **Big dice when typing in results**.
- **Your own colours for typed-in dice.** **Typed-in dice glow colour** sets the dice's outline and glow, and **Typed-in dice number colour** sets the numbers you type, each with a colour picker.
- **A chat button to switch between typing in and rolling.** The GM can turn on **Typed-in dice button in chat** (off by default). A keyboard button then appears beside the chat's message modes. Press it to type in the results of your real dice, and press it again to go back to rolling, with each die's earlier setting restored (dice on Pixels or other electronic dice keep their own). It is per browser, so at a shared laptop one player can type in their rolls while the next lets them roll. It is hidden while the GM requires rolling by hand.
- The four new settings are under **Typed-in dice** in Dicer's settings.

## 1.4.17

- **Fixed: pet accessories sat at the wrong height when Pet size was not 1.** With a larger **Pet size** a hat floated above the pet (at size 2 it could leave the screen on a tall pet), and with a smaller one it sank into the head. It now sits in the same place at every size. Thanks to 0utrider.

## 1.4.16

- **For module authors: the dice pets can wear things.** `api.registerPetAccessory(moduleId, { id, model, ... })` puts a module's `.glb` model on the pets' heads (a hat, say). It follows the pet's head as it moves. `scale`, `offset` and `tilt` tune the fit, `bone` hangs it on another bone of the pet's model, `kinds` sets any of these per pet kind, and `when(kind)` can take it off (outside December, for one). `unregisterPetAccessory(id)` removes it. See `THEME-API.md`. Thanks to 0utrider.
- **Pet accessories** is a new switch for each player in the pet window, on by default. Off, your screen shows the pets with nothing on. With no module registering an accessory nothing changes.
- **For module authors: a GM's test roll can stay out of Roll stats.** Create the message with `flags: { dicer: { noStats: true } }` and its d20s are not counted. It works only on a message a GM wrote, so a player cannot hide a roll. The dice and effects play as usual. Thanks to 0utrider.

## 1.4.15

- **Four new dice pets.** A raven (blue-black, with a long beak: it flaps up into the air on a natural 20 and hides its head under a wing on a natural 1), a fuzzy jumping spider (one huge leap; it flops over), a floating skull (its flame and glowing eyes take your colour: it chatters its jaw, or sags) and a drone (a white hovering pod with a screen for a face: it spins, or powers down). Each has its own model, voice and reactions, like the other pets. Pick one in **Your pet**.
- **The drone is offered only in Starfinder 2e worlds.** In other game systems it is not in the list.

## 1.4.14

- **For module authors: a theme can quiet the dice pets.** A registered theme can set `pets: { volume }` (0 to 1). It scales the pets' voices that answer a roll of dice wearing that theme (the "ooh?", the reaction, the cheer, an elemental yelp), on top of the player's own pet volume, for packs whose sets play their own sounds on a crit. Petting and the other sounds that answer no roll are unchanged, and the pets still move. When a roll mixes themes the quietest wins. It applies only where the viewer gets the theme's effects. Nothing changes for players or for a theme that does not set it.
- `THEME-API.md` now says that a theme rule whose id matches a world trigger (`dicer.nat20`, `dicer.nat1`) replaces that trigger for dice wearing the theme. This was already so.

Not yet tried with a live pet in Foundry: covered by unit tests. Please report what you hear.

## 1.4.13

- **Your dice can follow Ember's moons.** A new switch for each player, off by default: open the theme browser, pick any Ember Lunar Dice set under **Module dice**, and tick **My dice follow Ember's moons**. Your default dice then become the set of whichever moon has the most influence in Ember's sky right now, and change by themselves as the moons move. With no moon up you roll your own default.
- Your own look still colours anything the set leaves alone, and dice you chose for an actor, a die type or a kind of roll stay as they are. Under the GM's lock on player looks the switch does nothing.
- Needs Ember, and Ember Lunar Dice ticked in **Installed dice** (GM). The dice tray and the theme previews still show your own default, not the moon's set. Not yet tried in a live game: please report what you see.

## 1.4.12

- **Ember Lunar Dice now look and move as they should.** Five of the six sets (Akon, Aura, Cora, Mayis, Orbis) are built from several parts, which Dicer refused: they showed as your own dice instead (Aura as nothing at all). All six now draw as their real models, with their labels and Cora's rings.
- **Their animation plays, and it strengthens at full moon.** The moving surfaces these dice bring (embers, clouds, drifting stars) were never run on a module's 3D models. They are now, on thrown dice and in the theme browser, and each set changes when its moon is full in Ember (the moon's influence above 75%). Any other Dice So Nice dice set that animates its models gains the same.
- To use them: Dice So Nice and Ember Lunar Dice stay off; as GM tick **Ember Lunar Dice** in the theme browser's **Installed dice** window and reload. Checked with the real module's models and shaders outside Foundry; please report anything that looks wrong in a game.

## 1.4.11

- **Numbers read better on pearl, jelly, glowing and swirl dice.** The automatic contrast now looks at what the player sees: the coat's veil, the die's second colour, both colours of a swirl and a glow. A number that fails is moved lighter or darker as before, a number that reads is left alone. New **Minimum contrast** slider in the Numbers section of the appearance editor (Auto by default) and a line under it saying whether the numbers read. In a theme: `numbers.minContrast` (1.5 to 7). A few built-in looks change their number colour: Scarborough (dark gold to pale cream), Jelly Belly (dark orange to light salmon), Wonderland (less glow) and small moves on the default, Marble White, Ember Core, Smoke Swirl, Celestial, Verdant, Rare Shiny, Antelope Canyon and Carbon Fiber. Stored looks that failed the old check can move too; **Keep numbers readable** off keeps a number as picked.
- **A rough die looks rough.** Above 70 % **Roughness** the clear coat now fades out and the reflections weaken, so the top of the slider reads matte instead of polished. Metal and resin dice are as before, and so is every die at 70 % or below. The built-in looks with a roughness above that get a little less shine.

Not yet tried in a live Foundry world: both are covered by unit tests, and the contrast figures were fitted to renders of an earlier version. The matte finish was not rendered on gem, iridescent and jelly bodies. Please report what you see.

## 1.4.10

- **Roll All and Roll NPCs stay one throw in Pathfinder 2e.** PF2e posts one initiative card per combatant, and on a busy machine they could come far enough apart that one Roll NPCs was shown as two throws. Dicer now waits a little longer (250 ms instead of 100) for the next card before it throws. With PF2e's check dialog shown, each roll you confirm by hand is still its own throw.
- **An outline around the numbers.** The appearance editor has an **Outline** switch under Size and Thickness, with a colour and a width. A number can now share the die's colour and still read, and it stays readable on see-through dice. In a theme: `numbers.outline` (a colour) and `numbers.outlineWidth` (0 to 1).
- **Vertical position for the numbers.** A **Vertical position** slider moves the numbers up or down on the face, for fonts that sit off centre. In a theme: `numbers.offsetY` (-0.5 to 0.5, positive is up).
- **Dichroic glass without its layer lines.** The Dichroic style of the iridescent body has a **Layer lines** checkbox, on by default. Off, the glass keeps its colour turn and sheen without the thin lines across the faces. In a theme: `body.streaks: false`.
- **For module authors: add-on fonts.** `api.registerFont(moduleId, { id, label, file })` puts a module's fonts in the appearance editor's **Numbers** section, with `unregisterFont` and `listFonts`.
- **For module authors: more extension points for theme packs.** Tabs of your own in the theme browser (`registerBrowserTab`), a choice of which themes show under **All** (`showInAll`), a badge, category and static preview image on a theme, themes that load only when picked (`registerThemeStub`), add-on themes in the damage map lists, `getUserDefault` and `setUserDefault`, and shader hooks for a look (`registerMaterial`). `THEME-API.md` describes each. Nothing changes for a module that uses none of them.

Not yet tried in a live Foundry world, except the first: the new editor controls and the API additions are covered by unit tests and software renders. Please report what you see.

## 1.4.9

- **Roll All and Roll NPCs roll every combatant's initiative as one throw.** The dice of all those initiative rolls now appear together and tumble against each other, on every screen that sees them, instead of one roll per combatant. With **Physics decides the result** on, the GM no longer waits for one throw after the other: physics decides each combatant's result at once, unseen, and the dice shown land on those results. A roll for a single combatant, and initiative thrown by hand, are as before. A GM with a private roll area sees the hidden combatants' dice there, as a second throw. Nothing to set.

## 1.4.8

- **Ember Lunar Dice follow Ember's moons under Dicer.** Ember Lunar Dice need Dice So Nice, so Foundry will not turn them on in a Dicer world: tick them in the theme browser's **Installed dice** window instead (GM, then reload). Ember only told the dice which moons are full while Dice So Nice was on; Dicer now does that itself, at load and at every phase change. Not yet tried with the real (paid) module: please report what you see.

## 1.4.7

- **Dicer's hook listeners can no longer stop other modules'.** Foundry stops a hook such as `canvasReady` at the first listener that returns false, and the listeners other modules registered after it then never run. Dicer's own scene-lighting listener did that until 1.3.20 (Health Estimate and others stopped working: update if you are on an older version). The remaining listeners that could return false are fixed too, and a test now refuses any new one. No change in behaviour.

## 1.4.6

- **Dice show on a Monk's Common Display screen with "Hide UI" on.** Common Display hides everything on the shared screen that is not on its own list, and Dicer's dice were not on it (Dice So Nice's are), so the display showed no dice. Dicer now keeps its dice, their effects and the crit cards visible there. Nothing to set.

## 1.4.5

- **Roll by hand now lives in one place: the Roll filters window.** The separate **Roll by hand** setting is gone from the settings list. In **Roll filters**, the new **All rolls** row is that setting (Off, Ask each time or Always), and initiative, rolls during combat, damage and big rolls can each have their own choice, which wins over **All rolls** in either direction: throw everything but initiative, or throw only your damage. Your current choice is kept as your **All rolls**. The GM can set a world default for all of it.
- **Off means off.** A roll whose choice is Off always rolls automatically, with no hand mark on its chat card. To throw only some dice, set them to "Dicer: roll by hand" in Foundry's Dice settings and choose Ask each time or Always.
- **Require rolling by hand can have exceptions.** A kind of roll the world default sets to Off is exempt for everyone, the GM included: require hand rolls, and still let the NPCs' initiative roll itself.

## 1.4.4

- **Roll by hand, per kind of roll.** The **Roll filters** window has a new **Roll by hand** choice for initiative, rolls during combat, damage and big rolls. Set a kind to **No** and those rolls are no longer thrown by hand: no prompt and no throw screen, they roll automatically (thrown for you when **Physics decides the result** is on), and their 3D dice still show. Your choice wins over the world default the GM picks; the GM's **Require rolling by hand** still asks for the throw. Roll tables and private rolls have no such choice: they are only recognized once their chat message exists.

## 1.4.3

- **Dice from adventure packs, without activating the pack.** A module that comes with its own dice but does more than add them (Paizo's adventure packs with The Rollsmith's dice, such as the SF2e Playtest Deluxe Adventure Pack or Seven Dooms for Sandpoint) could only be used by activating it. The GM can now tick it under **Installed dice** in the theme browser: Dicer loads only its dice, and the rest of the module stays off. No wrapper add-on is needed.
- **No more freeze on the first roll of an actor's dice.** Dice that come from an actor (a theme picked on the character sheet, or a default another module provides, like Necromancer Thrall Helper's) are now prepared ahead of time too: each player's character, the actors players own and the tokens on the scene you are viewing. Only the looks actually in use are prepared.
- **For module authors: `api.warmThemes(ids)`.** Prepares themes you apply some other way than through an actor. Actor themes and default providers need nothing. See THEME-API.md.
- **New: themed ghost dice** (world setting, off by default). With "Show ghost dice for hidden rolls" on, the ghost dice of a roll you cannot read can wear the roller's own dice look instead of neutral grey. The numbers stay blank, and the look never follows the actor or the damage type, so it gives nothing away about what was rolled (it does show who rolled). Dice thrown by hand keep the grey ghosts.

## 1.4.2

- **No more freeze on another player's first roll.** Dicer prepared only your own dice look and the damage themes ahead of time, so the first time each other player's dice showed on your screen, the whole canvas froze for up to a second and a half while their look was prepared. Every player's look is now prepared in the background after the world loads, and again when someone changes their dice.

## 1.4.1

- **Pick one dice tray.** When another module's dice tray is on (Dice Tray, or PF2e HUD's dice panel), Dicer's chat dice bar now stays hidden, so there are never two under the chat box. Each player is asked once, and again after each Dicer update unless they tick "Don't show this again", which tray they want: "Use Dicer's chat dice bar" turns the other off, and "Keep …" turns Dicer's off. Nothing changes until they choose. With Force Client Settings active, the GM can apply the choice to everyone, as a default players can change or locked. (Dicer used to look for Dice Tray under the wrong module id, so both trays showed.)
- **Fixed: a white screen during rolls after editing themes.** After opening the dice editors a number of times, rolls could turn the whole screen white with the browser's crash icon until the dice faded. Each editor now gives its WebGL context back when it closes, and the dice canvas recovers if the browser takes its context anyway.
- **Fixed: flickering lines on Dichroic glass dice.** The thin streaks of the Iridescent → Dichroic glass style popped on and off as the die turned and drew as broken hairlines. They now stay put on each face, draw as clean lines, and no longer land on the rounded edges.
- **Coins no longer stay on their rim.** A coin that landed standing on its rim, or propped on a wall or a die, used to stay that way on a normal roll. After a short beat it now tips over, for every throw, and the result still matches the chat card.
- **Better default sounds by material and style.** A theme with no sound of its own now picks one from its body style as well as its type: clear resin sounds like plastic, pearl like glass, chameleon and opal like metal, fossil like stone, and jelly gets a new soft squishy sound. Themes with an explicit sound are unchanged, but resin, pearl, iridescent, fossil and jelly dice without one will sound different.

## 1.4.0

- **A theme API for other modules.** Other modules can now ship dice themes and give actors default dice through `game.modules.get('dicer').api`, which the `dicer.ready` hook hands over. See [THEME-API.md](THEME-API.md).
  - **Module themes:** a module registers read-only themes that every player sees, with no GM involved. They show in the theme browser, tagged with the module's name; players can duplicate one to change it, and the GM can make one the world default.
  - **Default dice:** a module can name a default theme for actors nobody has picked dice for, such as a necromancer and their thralls. It's never saved to the actor, so a player's or GM's choice always wins, and removing the module leaves nothing behind.
  - **Actor helpers:** a module can check whether anyone has chosen dice for an actor, read the theme an actor uses, and set or clear an actor's theme.
- **Dice follow the rolling token.** A roll from a token now uses that token's own dice choice, so a choice set on one unlinked token, such as a summoned creature, works for that token's rolls.

## 1.3.28

- **A pet set to None leaves.** With pets set to stay always, choosing None in the pet window left the old pet sitting on the table. It now leaves at once, on every screen, whether the player or a GM made the change.
- **Hide other players' pets.** A new pet window setting, "Show other players' pets", is on by default. Turn it off to see only your own pet: other players' rolls bring no pet to your screen, and their pets already resting there leave.

## 1.3.27

- **Roll filters now work on chat rolls.** The roll filters (initiative, damage, other players' rolls, big rolls and so on) were only checked for rolls other modules sent to Dicer, not for ordinary chat messages. So hiding initiative still showed the dice for Roll NPCs and every other chat roll. Every chat roll now follows your filters: a hidden roll isn't thrown, and its message shows straight away.
- **Hidden physics rolls say so.** A hidden roll that physics decided now has a chat card tooltip saying physics decided it, not "Rolled automatically".

## 1.3.26

- **Hidden rolls still get physics results.** With "Physics decides the result" on, a roll your roll filters hide, such as initiative, now runs through physics in the background instead of falling back to Foundry's random result. Nothing is shown and nothing queues, so a combat's initiative rolls are all worked out at once. Players whose filters show those rolls see them land on the physics result.

## 1.3.25

- **Rolls you've hidden skip the physics throw.** With "Physics decides the result" on, every roll was thrown first, even ones your roll filters say not to show, such as initiative. A combat's initiative rolls queued up one throw after another. Now a roll your filters hide isn't thrown, by physics or by hand, and gets its result instantly. A hand roll the GM requires is still thrown.
- **Loader add-ons show under Installed dice.** A Dice So Nice add-on that loads its dice from another installed module, such as the SF2e Playtest Dice Wrapper, wasn't offered because its own script has no dice in it. It's now listed as an add-on to run in full.

## 1.3.24

- **Imported module dice show their faces in the editor and thumbnails.** A theme imported from a module dice set rolled with the set's faces, but the appearance editor's preview and the theme thumbnails showed plain numbers or shrunken pictures. They now show the set's own faces at full size, as a roll does.

## 1.3.23

- **Imported module dice keep their full-size face images.** Importing a module dice set as a theme shrank its picture faces to Dicer's own label size. They now stay as big as the set shows them on the Module dice tab, and themes you already imported get the bigger faces back.
- **Imported module dice start from your own look.** A set that names no colours of its own used to import on Clear Resin. It now starts from your current default look, the same look the Module dice tab shows it on.

## 1.3.22

- **Crit scene title cards show over the dice tray.** The big "NAT 1" / "NAT 20" card a crit scene shows was drawn under the table tray, so the tray hid part of it. The card now sits above the tray and the dice, including while the dice are raised above windows.

## 1.3.21

- **The dragonling's and robot's eyes look right mid-blink.** When either pet nodded at a plain roll, its half-closed eyelids slipped inside its eyes, leaving white, torn-looking patches over the irises. Their eyelids are now rebuilt to stay over the eyes all the way through a blink.

## 1.3.20

- **Other modules' scene-ready code runs again** ([#1](https://github.com/roileaf/dicer/issues/1)). Foundry tells modules a scene is ready one by one, and stops at the first one that answers "no". Dicer answered "no" whenever dice lighting wasn't set to match the scene, so every module after Dicer missed the event. For example, Health Estimate showed nothing on the first scene. Dicer no longer answers at all.

## 1.3.19

- **Search the theme browser.** A search box in the Dicer themes window filters the open tab as you type, and the tab counts show how many match. Handy on the Module dice tab, which can list hundreds of dice sets.
- **Pets no longer stand inside each other.** A pet dropped on another lands beside it, and a pet coming back to its spot or lining up steps aside if another pet is there. Pets already saved on top of each other spread apart the next time they rest.

## 1.3.18

- **Players no longer change each other's dice.** When one player picked a theme, other connected players could end up with that theme too. Foundry tells every screen about each player's own setting changes, and Dicer took another player's theme pick as its own. Now each screen only acts on its own player's settings. If your theme was changed this way, pick it again once.

## 1.3.17

- **Move each pet on its own.** Dragging a pet used to move every pet: they all lined up beside the one you dropped. Now each pet you drop keeps its own spot and comes back to it after its rolls, even after a reload, and the other pets stay where they are. A pet that arrives later lines up beside the last one you dropped.

## 1.3.16

- **No false warning from dice sets.** A Dice So Nice dice set that registers a die on its own shape, such as a d20 on the d20 shape, made the console warn that "d20" is a built-in die type. Nothing was wrong, and the warning no longer shows. A set that really tries to turn a built-in die into another shape still warns.

## 1.3.15

- **Your pet reacts to your damage dice.** On a roll with a damage type, your own pet used to just nod, unless it sat on the tray's rim. Now it reacts to the damage type wherever it stands: a scorch for fire, a shiver for cold, and so on. Rolls with no damage type still get the nod, and crits and fumbles keep their own reactions.
- **Previews land in the dice tray.** The Throw and Preview buttons (damage types, trigger rules, the look editor, the theme browser and the pet window) now throw where your real rolls land: into the table tray, which slides out for it, or your roll area. Before, they flew across the whole screen.

## 1.3.14

- **PF2e Workbench's "Cancel untargeted attack" now also stops the dice.** With "Physics decides the result" on, Dicer threw the dice for an attack that Workbench then cancelled because nothing was targeted. Now an attack or spell attack Workbench is going to cancel isn't thrown at all: you see Workbench's error and no dice. The same goes for rolling by hand.

## 1.3.13

- **A GM can pick each player's pet.** The pet window now has a Player list at the top for the GM. Pick a player to set their pet's kind, colour, voice pitch, natural look and natural-20 catch. Every change saves on that player straight away. Preview throws the d20 with that player's pet. Display settings such as size, view and sounds belong to each player, so they stay hidden while you edit someone else's pet.

## 1.3.12

- **Every pet has its own natural 20 and natural 1.** Pets used to celebrate and sulk the same way. Now:
  - **On a 20:** the cat and fox pounce, the imp and jester back-flip, the lantern, ghost, mushroom and floating eye spin, the robot whirs round, the slime boings, the frog leaps, the owl and dragonling flap up into the air, the mimic snaps its jaws and the golem stomps.
  - **On a 1:** the cat, fox and owl curl up and hide, the imp, jester and frog keel over, the lantern, ghost, mushroom and eye sag, the robot and golem wind down, and the slime spreads into a puddle.
- **Damage reactions look like what hit them.** Fire makes a pet hop back from the heat, pant and fan itself; frost hunches it up, trembling with chattering teeth; lightning stands it tall and stiff, buzzing; anything else makes it jump back with a gasp. A plain result gets a pleased bounce, a nod and a slow blink.
- **Pets move while they wait.** They look around, sway and swing their arms. The imp flaps its wings, the owl and dragonling settle theirs, floating pets bob, and the robot turns its head in little snaps.
- **Pets stay on the table.** A flip, a flop or a lean no longer pushes any part of a pet through the table.

## 1.3.11

- **Five new pets.** Pick them in **Your pet**:
  - **Fox:** ears that twitch and a big bushy tail; it pounces on a natural 20 and ducks behind its tail on a 1.
  - **Paper lantern** (a chōchin-obake): a one-eyed, glowing lantern that floats, with its tongue out; it flares and spins on a 20 and sags on a 1.
  - **Imp:** a little red devil on bat wings; it flips in the air on a 20 and flops on its belly to pout on a 1.
  - **Clockwork robot:** a brass wind-up robot whose key ticks round; it whirs on a 20 and winds down on a 1.
  - **Jester doll:** bounces on a spring, with bells on its hat; it back-flips on a 20 and collapses like a rag doll on a 1.
- Each has its own voice and natural colour, and does everything the other pets do: throwing, cheering, sulking, damage reactions and petting.

## 1.3.10

- **Module dice show their face images at full size.** An image on a face of a module dice set (the Pathfinder P on Dicefinder's 20) was drawn about a third of the size Dice So Nice shows it. Such images now cover the same area of the face as in Dice So Nice; text on those faces and images in Dicer's own themes keep their size.
- **JB2A effects no longer flood the console on hosted servers.** On a server that sends module files from another address (a hosting service, S3 storage), a JB2A effect video broke drawing and logged a security error on every frame. Effect videos now load the way the browser allows for such files; one the server will not share plays Dicer's built-in effect instead.

## 1.3.9

- **No flash of the old pet.** A pet whose 3D model was still loading (a kind just picked in the pet window, a player who joined late) showed the old built-in look for a moment, then swapped. It now stays hidden until its model is in; if the model cannot load, the built-in pet shows as before.

## 1.3.8

- **Pets facing you are no longer hidden behind Foundry's interface.** With Pet view set to Facing you (or Angled), a pet leans back so you see its face, which draws it further up the screen than where it stands. Pets resting near the dice now keep that leaning body clear of the interface above them, not just their feet.

## 1.3.7

- **A preview no longer leaves the dice tray stuck on top.** Previewing a trigger rule (or a theme) lifts the dice and tray over the open windows; when the preview die was gone the tray stayed over everything until the next roll. It now drops back under the windows as soon as the die goes.

## 1.3.6

- **An actor's dice theme works for its sheet rolls.** A theme set for an actor in the theme browser was saved but ignored when the actor rolled from its sheet (or a player spoke as it): Dicer only read the actor on Dice So Nice style calls. Rolls in chat now use the speaking actor's theme.
- **Aelar's dice have their moving insides.** IRL Dice Packs' smoked glass dice (void smoke drifting inside) now show in Dicer: Dicer hands Dice So Nice add-ons the die itself when it appears, as Dice So Nice does, and the glass keeps Dicer's numbers.

## 1.3.5

- **Aelar's natural 20 keeps its numbers.** Some Dice So Nice add-on effects (IRL Dice Packs' Aelar) copy the die's material while they play; the copy lost Dicer's numbers, and they never came back. A copied die material now keeps drawing as Dicer's.

## 1.3.4

- **Import a module dice set as a theme and keep its look.** "Import as theme" now keeps the set's dice system: an imported IRL Dice Packs set (Elara, Essie...) keeps its frames, glass and moving insides while you change its colours in the editor. The editor preview, the theme card and your rolls all show it.
- **Dice So Nice textures with bump maps have real relief.** An add-on texture that comes with a bump map (Lordu's dice and others) is now drawn the way Dice So Nice draws it: its bump map becomes a normal map, so the surface is rough and pitted and catches the light. Textured metal reflects as strongly as in Dice So Nice.
- **Dice So Nice colour sets get bigger, bolder numbers**, closer to how Dice So Nice draws them.

## 1.3.3

- **Lordu's dice work.** A d100 rolled with the Dark Deeds set no longer stops the whole roll from showing (Dice So Nice add-ons put their d100 on the d10 shape; Dicer still throws it as tens and ones dice). Its fonts (Metamorphous, Metal Mania, Eater...) now load, so its dice draw in them: fonts an add-on defines in Foundry's init step are loaded once Dicer has run it.
- **Dice So Nice metal looks like Dice So Nice metal.** Colour sets with the metal material were drawn as a near mirror that reflected the dark room and looked almost black; they are now satin, as in Dice So Nice. This also softens the built-in gold, silver and bronze colour sets.

## 1.3.2

- **IRL dice sets bring their own natural 20 and natural 1.** Use a character's or GM theme's set from IRL Dice Packs (Essie, Torin, Aelar, The Unbroken Vow...) and its d20s play that set's own crit effects, with their sounds, in place of the world's celebrate / fumble and your theme's own. Nothing to set up in Special Effects. Each set in the theme browser has a **Play this set's own natural 20 / natural 1 effects** checkbox (on by default, per player) to go back to the usual ones. Thanks to Camrun for the report.
- **Several crits at once share the screen.** When two to four players roll a crit scene at the same moment, the screen splits so each gets a part (side by side, or a 2 x 2 grid); a fifth waits for a free part. Each title card names the player who rolled it.
- **Dice So Nice effects play to the end.** Dice stay on the table until a special effect finishes, as in Dice So Nice; long ones (Essie's mouse and bottle) were cut off when the dice faded. Effects built on Dice So Nice's own effect class now play at all (they failed or showed nothing).
- **IRL Dice Packs look right.** Their moving insides move, the lines run along every face edge, d20 and d10 faces line up with the pack's art, and theme browser thumbnails match the thrown dice.
- A roll that names a Dice So Nice colorset in its appearance (as add-ons' preview buttons do) wears that colorset.

## 1.3.1

- **Random crit scene.** The Scene picker (on a trigger, or a theme's natural 20 / natural 1 row) has a **Random scene** choice: each crit plays one of the ten scenes for its result, a natural 1 one of the natural 1 scenes and anything else one of the natural 20s. Every player sees the same scene, and your own card text goes on whichever one plays.

## 1.3.0

- **Themes can give damage dice their own look, per damage type.** The theme editor has a new **Damage dice** section: for each damage type, pick a damage theme, a colorset or the theme's own look, and preview it with the play button. Wherever the theme is used (a player's default, a die type or role, an actor, the world default), its damage dice follow it, so a rogue theme can make sneak attack (precision) dice stand out from the shortbow's d6. A player's own damage overrides still win on their screen; the world's choice fills the rest. Thanks to 0utrider for the idea.
- **Write your own crit scene text.** Next to the Scene picker (on a trigger, or a theme's natural 20 / natural 1 row) there are two **Card text** boxes: your words replace the title card's lines, keeping the scene's lettering and animation. The scene's own lines show as placeholders; a box left empty keeps its line.
- **IRL Dice Packs' Secrets of Grayce - The Unbroken Vow works.** Its dice drew as a see-through outline and its theme browser card showed only an icon: the pack reads texture coordinates Dicer's dice did not have. Dice So Nice add-on systems now also get the die type and a Dice So Nice style appearance in their shader callbacks, so their own surfaces (The Unbroken Vow, The Hollow Queen, The Borrowed Second) are drawn as their authors made them.

## 1.2.0

- **Crit scenes: a bowling-alley "STRIKE!" moment for natural 20s and natural 1s.** Twenty short shows, ten for each, told in light, fire and smoke: Meteor, Shadow Thief, Portal Hop, Lightning Verdict, Golden Ascension, Dragon Coil, Fireworks, Crown Drop, Phoenix and Rune Circle for a natural 20; Anvil, Banana Peel, Rain Cloud, Ghost Out, Black Hole, Crack and Tape, Wilted Flower, Tumbleweed, Crows and Pratfall for a natural 1. Each plays as soon as the die stops and ends in its own big title card ("NATURAL 20!", "CRITICAL FAIL", "WHOOPS! NAT 1"...). Nothing shows while the die rolls, so nobody can tell a crit is coming. Pick one in the new **Scene** dropdown beside Effect, on a trigger or on a theme's celebration rows. The die's result never changes, and reduced motion gets a calm version.
- **Pets can catch a natural 20** (pet window, off by default): the pet dashes to a d20 heading for a 20, gulps it, carries it and spits it back out showing its 20, then celebrates. Like any pet move it is visible while the die rolls, so turn it on only if you don't mind that.
- **Module dice on actors, roles and single dice.** A module's dice set in the theme browser now has a **Use this theme for** picker (your default, one die type, a role, an actor), like Dicer's own themes; assigned sets show their chips.
- **IRL dice packs and other Dice So Nice add-ons work better.** Add-ons that add their dice from their own files load, add-ons that check for Dice So Nice see it, and their shaders get Dice So Nice's clock. A pack's dice system and its colour set of the same name show as one entry, and previews and thumbnails now look like the thrown dice (the system's own material is applied).
- **PF2e precision damage** (Sneak Attack and the like) is its own damage type, so a rogue's sneak attack dice can look different from her shortbow's d6 even when they're the same size. Its built-in look is bloody black marble with sharp edges and a crystal d4, and you can map it to any theme in your damage presets. Thanks to 0utrider for the idea and the look.
- An actor's module dice system applies even when the actor has no Dicer look of its own.
- Long badges on module dice cards no longer overflow.

## 1.1.2

- **No more "old copy of Dicer" notice on every load.** Foundry can keep reporting an older Dicer version than the files it serves (it reads the module's manifest when the server starts), and Dicer took that for a stale browser cache. Dicer now only reacts when Foundry serves a *newer* version than the code running, the real stale-cache case.

## 1.1.1

- The "old copy of Dicer" notice no longer sticks: after one reload that didn't help, Dicer could keep showing it for the rest of the browser tab even once the files were fine. It now tries again a minute later, and the console says why it fired (the versions, or the file that failed to load).

## 1.1.0

- **Dice So Nice add-ons without Dice So Nice.** Add-on modules that require Dice So Nice (so Foundry won't let you enable them), such as Dice Soup, Handyfon's Dice Addiction, Doomsong Dice and Lordu's dice, can stay off: the GM ticks them in the theme browser's **Installed dice** window and reloads, and Dicer runs their code so their dice show up in the theme browser. Their stylesheets and translations aren't loaded. Thanks to 0utrider for the design.
- **Save rolls from PF2e Toolbelt use each target's dice theme.** `game.dice3d.animateRoll` now takes Dice So Nice's call shape (roll, author and speaker, message mode): the speaker's actor theme is used, the author's look is respected, and blind rolls (NPC or private saves) stay hidden from players. Thanks to 0utrider for finding and diagnosing it.
- **A browser stuck on an old copy of Dicer repairs itself.** Some browsers (Brave) and proxies kept running an old cached Dicer after an update, and windows such as Roll stats and rolling by hand failed to open. Dicer now notices when its code is not the version Foundry serves, or when one of its files fails to load, fetches fresh copies and reloads the page once; if that doesn't help, it asks for a hard reload. This protects updates from this version on.

## 1.0.18

- **Your Dicer settings follow you to any browser.** Personal settings (theme, dice look, tray look, pets and pet volume, sounds, effects, slow motion, screen shake, damage presets, roll filters, rolling by hand, the chat tray...) are now saved with your Foundry user instead of in the browser, so a new browser or computer no longer starts from scratch. On the first load after updating, each browser's old values are copied over (settings you already have as a user setting are kept).
- **What your machine can draw stays per browser:** Enable 3D dice, Pixel ratio cap, Quality, Interiors, Inside motion, Engraving, Shadows and Glow, so a laptop and a gaming PC can each keep their own.

## 1.0.17

- **Dice So Nice library dice come over.** The dice players designed in Dice So Nice's dice library become themes in their **My themes** (dice sharing a name make one theme, with a look per die type), and the world's library becomes world themes. A player's look that pointed at a library die now gets its colours. Players already imported get one more pass, on their next login or through **Import all players now**; choices made in Dicer are kept.
- **Dicer's theme Import takes Dice So Nice export files** (its settings export or its dice library export): their dice and looks become themes.
- The Dice So Nice migration report counts each player's library dice.
- Not yet imported: a library die's per-face images and labels (its base colours, material and texture come over), and Dice So Nice's per-damage-type looks.

## 1.0.16

- **1.0.15 shipped without its module files** (its build failed on a slow test), so installs and updates from the manifest failed. 1.0.16 is the same release, rebuilt: everything listed under 1.0.15 is in it.
- **The Dice So Nice migration report scrolls**, at a height that fits the screen.
- **Import all players now** says when there is nothing new to import, instead of "Imported: 0 and 0".

## 1.0.15

- **Saved Dice So Nice looks come over as themes.** Every look a player saved in Dice So Nice is added to their **My themes**, once, when they next load the world (a look that uses another module's dice set comes over once that module is active).
- **The GM can import every player at once.** The Dice So Nice migration report (in Dicer's settings) has an **Import all players now** button: every player's dice colours and saved looks, and the world settings, without waiting for each player to log in. Choices already made in Dicer are kept.
- **The benchmark can be stopped.** A Stop button while it runs, and closing its window stops it too; the scenarios measured so far stay in the table.
- **The tray's gear panel tabs no longer spill their text** in systems with bigger button text, such as Pathfinder 2e.
- The notice after importing Dice So Nice colours now shows its text instead of a raw key.
- **A cleaner Dice So Nice migration report**: compact status tiles (with a warning when the import is switched off), a world settings table with headings, and tidy player rows, at a normal size in every system.
- Dice So Nice's newer ghost dice choice (none, for all, roller, players) now imports into Dicer's ghost dice setting.

## 1.0.14

- **Pet sound volume.** A new slider in **Your pet** sets how loud the pets are on your screen; at 0 they are silent.
- **No more dice turning after they stop** when physics decides the result. A die that lands leaning on another die, a wall or a pet now topples onto its nearest face the moment it stops, gently, instead of lying still until every die has stopped and then spinning to another number.
- **Slow motion for natural 20s and 1s now works when physics decides the result** on the roller's own screen, not only for everyone else.

## 1.0.13

- **Every pet has its own voice.** The mimic knocks like hollow wood, the slime bubbles, the dragonling growls, the owl hoots, the frog croaks, the ghost whispers with an echo, the mushroom squeaks, the floating eye warbles, the golem grinds and the cat meows. Every sound a pet makes uses it: cheers and sulks, damage reactions, splats, purrs and huffs. Your voice pitch still applies.
- **More things to say.** Natural 20s, natural 1s, ordinary results and mixed results each have four takes, picked at random and never the same one twice in a row.

## 1.0.12

- **Pets talk through the whole roll.** While your dice fly, your pet goes "ooh?" (one of three, a different one each time). When they land it has something to say every time: a satisfied "mm-hm" for an ordinary result and a puzzled "huh?" when a 20 and a 1 land together, on top of the cheer for a natural 20 and the sulk for a 1. Blind rolls stay silent.
- **Your pet shows up for your own rolls again** when physics decides the results, when you throw by hand, and when you roll from the chat dice bar.
- **No old pet flashes on screen.** Pet models now load at the start, so the first roll shows your pet's model straight away.
- **A pet you placed stays put.** On the first roll after a reload, or after it left, it watches from the spot you dragged it to instead of hopping into the tray.

## 1.0.11

- **All ten pets remade as real 3D models.** The mimic, slime, dragonling, owl, frog, ghost, mushroom, floating eye, pebble golem and cat are now smooth, sculpted creatures with painted textures (a tabby cat with a cream muzzle, a feathered owl, a spotted mushroom, a wooden mimic with iron bands and brass, a glossy jelly slime, a chipped stone golem with glowing runes...), real faces that blink, smile, frown and gasp, and bodies that bend. Your pet colour still applies (to the fur, scales, cap or wood, not the eyes or markings), and Natural colours shows each in its own.
- **Winged pets flap when they fly over, front legs no longer dip into the table when a pet leans in to throw, and a huffy pet turns its whole body away.**
- **Dice So Nice model dice sets:** the way Dicer orients them (which face carries which number) is now measured from the dice models themselves.

## 1.0.10

- **Pet view.** A new choice in **Your pet**: see pets **from above** like the dice, **angled**, or **facing you**. The pet leans toward you so you see its face and body; the dice, its shadow and its splat stay on the table. Only on your screen.
- **Pets grab at dice.** A die flying right past a pet makes it turn and grab at it: the frog flicks its tongue, the cat bats a paw, the mimic chomps, the floating eye flings a tendril, the golem swings a fist.
- **Cleaner pet models.** The owl has one smooth face with its eyes open and snug feathered wings; the ghost is one smooth sheet with its arms coming out of it and blushing cheeks; the mushroom has a real stem with gills under its cap; the frog's eye sockets are smooth and its croak is a small throat swell instead of a big balloon; the floating eye has proper eyelids and smooth tendrils.

## 1.0.9

- **Preview your pet.** A button in **Your pet** brings your pet out to throw a d20 on your screen only (no roll, no chat message), so you can see a new pet, colour or voice pitch without rolling.
- **Fixed: the Natural colours and Voice pitch labels in Your pet showed their raw names** (since 1.0.7).

## 1.0.8

- **Fixed: 3D dice didn't start on The Forge** ("3D dice are disabled (startup failed)", with a SecurityError about a physics worker). The Forge serves modules from its own asset server, and browsers won't start a background worker from another site's script. Dicer now starts its physics and font workers in a way that works there too.

## 1.0.7

- **Seven new dice pets, ten in all:** an **Owl** that flies and spins its head on a crit, a **Frog** that croaks, leaps and flicks its tongue, a shy **Ghost** that floats, a **Mushroom** that puffs spores, a **Floating eye** on soft tendrils, a chunky **Pebble golem** with glowing runes, and a **Cat** that bats your dice off the table. Each has its own crit and fumble, reacts to fire, cold and lightning dice, gets squished by a d20 and pops back, and sulks, cheers and purrs like the others. Pick one in **Your pet**.
- **Natural colours.** A new box in **Your pet** gives every pet its own colours (a brown owl, a green frog, a ginger cat...) instead of the colour you pick. Picking a colour turns it off.
- **Voice pitch.** A slider in **Your pet** makes your pet sound higher or lower. The new pets each have a voice of their own too: the golem is deep, the mushroom squeaky.

## 1.0.6

- **Fixed: dice froze as they faded out in Firefox** (and the first roll of a new look froze as it was thrown). Firefox only finishes preparing dice graphics the first time they are drawn, so Dicer's preparation at load never really happened there. Dicer now finishes it while preparing.
- **In browsers like that, the damage dice looks are prepared one at a time in quiet moments after loading**, never while dice are on screen, instead of all at once (or not at all, as in 1.0.5).
- **Removed 1.0.5's pause at the start of a throw**, which added a second freeze instead of fixing the first.

## 1.0.5

- **Loading into the world no longer stutters on some computers** (seen in Firefox on Windows). Where the browser stops everything while it prepares dice graphics, Dicer now prepares only your own dice when the world loads, as it did before 1.0.1, instead of every damage dice look one after another.
- **Fixed: the first roll of a new dice look froze as the dice faded out** (the first Electric Arc, say). The fade's graphics are now prepared as the throw starts, together with the rest of the dice, so on those computers a new look pauses once before the dice appear and then throws and fades smoothly.

## 1.0.4

- **Fixed: loading into the world froze on some computers** (seen in Firefox on Windows). There the browser stops everything while it prepares each piece of dice graphics, and Dicer was preparing all the damage dice looks right after the world loaded. It now prepares them one at a time with a pause between, so the page stays responsive.
- **No more "WEBGL_debug_renderer_info is deprecated" warning in Firefox.** Dicer reads the graphics card's name the way Firefox now asks.

## 1.0.3

- **Fixed: "material warm-up failed" in the console on slower computers.** Since 1.0.1 Dicer prepares every damage dice look when the world loads, all in one go, and on a slow graphics card that could run past its 10-second limit. It now prepares them a few at a time, and a slow one is noted as still preparing in the background rather than as a failure (it never was one: the dice still worked).

## 1.0.2

- **Picture trays: opacity and darkness.** A tray with your own picture as its surface now has a **Picture opacity** slider (the picture fades into the tray colour, which you can pick too) and a **Picture darkness** slider, so a busy or bright picture can sit back behind the dice.
- **Fixed: theme previews left out the symbols on module dice sets.** A set from another module with symbols, words or pictures on its faces (Ponyfinder's pony on the 20) showed plain numbers in the Dicer themes cards and preview, though rolls drew the symbols. The previews now draw them too, unless **Picture and symbol faces** is off.

## 1.0.1

- **Fixed: the canvas froze for a moment on the first roll of a damage type** (an Electric Arc, a fireball). Fire, cold, electricity and the other damage dice have their own looks, and the first roll of each had to prepare its graphics on the spot. Dicer now prepares them in the background when the world loads.
- **Fixed: a short freeze as the dice faded out**, on every roll, worst on resin dice with an inside. It could also stall an animation playing at the same time (Automated Animations, JB2A). The fade's graphics are now kept ready between rolls instead of being rebuilt each time.

## 1.0.0

Dicer 1.0: the first official release. 3D dice that tumble and land on your real roll for everyone at once, with real physics (or let the physics decide), 39 themes, your own dice designs, damage dice, effects and trigger rules with JB2A, dice trays, rolling by hand, dice pets and roll stats, and Dice So Nice modules and dice sets kept working.

- **Nine new themes by Sherp:** Antelope Canyon, Carbon Fiber, Dark Opal, Edgelight, Ivory & Ebony, Jelly Belly, Olympus Heights, Rare Shiny and Vault Floor, made with the newer materials (sandstone, brick, granite, opal, chameleon, mirror and patina metal, bone, jelly). Stone dice sound like stone, metal like metal, and Jelly Belly and Carbon Fiber like plastic.
- **Wonderland's numbers are easier to read, and Eruption's living insides easier to see** (Sherp's updates).

## 0.6.2

- **Fixed: brick dice shimmered.** On some faces (every d8 face, half the d20's) the bricks broke into flickering speckles as the die turned, in the preview and in rolls. Those faces point as much along one direction as another, and the brick pattern kept flipping between the two pixel by pixel. Each face now settles on one.
- **Fixed: the Dice tray window's buttons ran off its edge** in a narrow window; they now wrap onto another row. The GM's **Save for players** button no longer spills its label out of the window.
- **Pop the tray out from the table.** A small button on the tray's top-right corner opens it in a window of its own for a second screen, without going through the settings.
- **Stitched leather rims on hexagon and octagon trays.** The stitching only showed on rectangle and round trays.
- **A taller tray preview** in the Dice tray window.
- **Fixed: a tray sometimes sat under windows** although the dice are set to show over them (it lost that after switching tray modes until the next roll).
- **Clearer names for the three dice trays in the settings.** The **Dice tray** is where your dice land; the row of dice under the chat is now the **Chat dice bar**, and the token-controls button that opens a dice picker to throw by hand is the **Throw by hand tool**.
- **Metallic numbers in any colour.** Gold and silver are one metal finish tinted by the number colour, and the appearance editor now shows that colour for them too: pick gold or silver to start from, then tint it.
- **Glow ink brightness.** A slider for how brightly the **Glow ink** numbers shine (0–200 %).
- **The appearance editor's Glow is now Number glow**, with a note: it is a halo around the numbers, while Glow ink makes the ink itself shine.
- **Fixed: number colours you picked changed by themselves.** Dicer lightens or darkens numbers that would be hard to read on the die, so a blue number on a grey die turned pale as the grey got darker. Now a colour you pick in the appearance editor is kept as picked: picking it turns off the new **Keep numbers readable** option for that look, and you can turn it back on. Built-in themes and your existing looks keep it on.
- **Stone dice judge number contrast with their second colour** (brick's mortar, granite's crystals), so numbers are kept readable against what the die really looks like.

## 0.6.1

- **Dice trays have more depth.** The floor now sits below the walls: the top wall casts a deep shadow on it, the side walls softer ones, the corners darken and the bottom wall catches a little light. The tray casts a fuller shadow on the table, and the rim's bevel is crisper. Hexagon and octagon trays get the same depth.
- **Let the physics decide every roll.** A new setting, **Physics decides the result** (General): every roll is thrown for you, and the faces the physics lands up are the result, instead of Foundry choosing the numbers and the dice turning to show them. With **Roll by hand** on **Ask**, the rolls you let roll automatically are decided by the physics too. The dice are solved in a few milliseconds, so rolls do not wait for the animation, and everyone at the table sees the same throw. The chat card shows an atom for a roll the physics decided. When the GM requires rolling by hand, the throw screen still opens.
- **No more rings where dice hit the table.** **Impact effects** drew a pale ring at every firm bounce, which looked like a little shockwave. Now only a hard hit shows anything: a few sparks, as before.
- **More randomness behind every throw, and a stricter fairness check.** Each throw now starts from a 128-bit random seed from your browser's secure random source (it was 32 bits), run through the xoshiro128\*\* generator, so the number of different throws is no longer limited to about 4 billion. The fairness test now throws every die shape 100,000 times instead of 10,000, and its report shows how far the luckiest face strays from a fair share and how small a bias the run can still catch.
- **Fixed: a tiny d12 bias when the physics rolls.** The stricter fairness test caught the d12 landing on 4 about 3 % less often than it should (8.05 % of rolls instead of 8.33 %). The die's shape and weight were perfect; the physics engine favoured some faces over others by how it stored the die internally. Each throw now gives every die a freshly shuffled internal layout, so no face is favoured.
- **Fixed: rolling by hand did nothing through Foundry's dice settings.** On Foundry v14, Dicer could not put the dice on its own method, so **Ask** and **Always** never opened the throw screen (only the chat dice tray's throw worked). They work again.
- **Every damage type has its own landing sound.** Only fire (a crackle) and electricity (a zap) had one; the rest landed with just the dice clatter. Now cold cracks like ice, acid sizzles, sonic rings, poison bubbles, force hums, vitality rises in a warm shimmer, void swells and is swallowed, mental warbles, spirit sighs like an airy choir, bleed lands with a wet hit and drips, and physical (slashing, piercing, bludgeoning) with a solid knock. They play at the **Effects volume**, and a GM's own sound for a damage type still replaces them. The eleven new sounds can also be picked for trigger rules and theme celebrations.

## 0.6.0

- **Roll stats.** A new **Roll stats** window (a button with the token tools on the left, the theme browser's **Stats** button, or Configure Settings, Dicer; **Roll stats in the token tools** hides that button) shows everyone's d20 luck **Tonight**, over the **Last 30 days** or for **All time**: how many d20s each player rolled, their average, natural 20s and 1s, and whether they run **Hot**, **Cursed** or **Fair** (judged from 10 d20s). Pick a player to see how often each number came up next to a fair die, their longest run of 15 or more, their latest 20 and 1 (named after the roll, like "1 on Reflex save"), and what their pet makes of it. Only rolls everyone can see are counted for everyone. The GM's computer also keeps blind, GM, self and whispered rolls, and **Count private rolls** adds them for the GM alone. Players clear their own stats; the GM can clear anyone's, **Clear all**, or start a **New session** (Tonight otherwise covers the last 12 hours). The GM can turn counting off with **Keep roll stats**.
- **Dice So Nice migration report.** Configure Settings, Dicer, **Dice So Nice migration report** (GM only) shows what Dicer did with this world's Dice So Nice data: each world setting and whether it was copied, kept at the value already chosen in Dicer, or has no Dicer counterpart; each player's dice colours, and which players have not migrated yet (that happens the next time they log in). It also says when **Import Dice So Nice settings** is off and nothing will be copied. The report only reads; it changes nothing.
- **Fixed: unreadable numbers on several built-in themes.** Dicer recolours numbers that would not stand out, but it judged clear resin as brighter than it looks and glitter or a single shape inside as filling the whole die. So it turned good numbers into the die's own colour: Starlit Glitter's and Dragon Hoard's gold went brown over dark resin, Sharp Crystal's white went teal on teal, Stormcaller's went dark blue in a blue storm. Those numbers now keep the colours they were designed with. Five themes whose numbers matched their insides got new number colours: **Ember Core** (dark numbers over the glowing core), **Void Star** (silver over the gold star), **Smoke Swirl** (dark numbers over the white smoke), **Stormcaller** (white, with a fainter glow) and **Celestial**'s d20 (silver over the gold shape).

## 0.5.1

- **Dice from installed modules, without activating them.** In the theme browser, the GM's **Installed dice** button lists the installed modules that add dice but are off in this world. Tick one and its dice load for everyone, under **Module dice**, while the module itself stays off. Only modules that do nothing but add dice can be loaded this way (dice sets like The Rollsmith's). Adventure and system modules that also do other things are listed greyed out: activate those to use their dice. Dice you untick go away at the next reload.

## 0.5.0

- **The dice tray on another screen.** In the Dice tray window, **Show on another screen** opens the tray in a window of its own: drag it to your second monitor and the tray fills it. Every roll on your screen then lands there instead of on the map, pets included, and rolling by hand happens in that window too (grab, shake and flick the dice right there). Close the window to bring the dice back. Your browser must allow pop-ups for Foundry, and keep the main Foundry window open (not minimized) while you use it.
- **Fixed: dice stopped well short of round, hexagon and octagon tray walls.** For those shapes the dice could only use the largest rectangle that fits inside, leaving a wide band of empty floor along the curved or slanted sides. The dice's walls now follow the tray's own outline, so they hit its sides there too.

## 0.4.3

- **Fixed: dice bounced off empty space before the tray's sides.** The dice's walls stood 6 px inside the rim, so dice turned back just short of it. They now hit the rim itself.
- **Fixed: pets reacted to how dice look.** A pet now reacts only to a roll's damage type (fire damage, cold damage and so on). Dice that merely look elemental, like **Eruption**'s lava or a fire, frost or storm inside, no longer make it scorch or shiver. Dice trails and bursts still follow the look.

## 0.4.2

- **Fixed: no insides at Low quality.** On **Low** quality, and on **Auto** when Dicer judged the computer slow at start-up (a judgment it keeps), thrown dice showed only a flat tint where their inside should be, while the theme browser's previews looked right. Low now draws insides too, at the fewest steps they are made for; it stays cheaper than the other tiers in every other way. Only if an inside shader fails to compile do dice fall back to the tint.

## 0.4.1

- **Fixed: clear dice hid their insides when thrown.** Dice on the table are seen from straight above, so each top face mirrored the studio's overhead light, and that glare washed out what is inside a clear die (Eruption's lava barely showed, Nautilus's swirls were faint). The overhead light is dimmer now, so insides look as they do in the theme browser. Metal and solid dice look the same as before.

## 0.4.0

- **The tray shows while you edit it.** With **Show the dice tray: Only while rolling**, the tray now stays on screen while the Dice tray window is open.
- **The tray fades with the dice.** A tray that shows only while rolling now fades out together with the dice, not a moment after.
- **Fixed: big rolls spilled out of the tray.** A roll with more dice than the tray holds lying flat used to widen its landing area past the tray, so dice came to rest outside it. Now the dice pile up inside the tray.
- **Rolling by hand uses the tray.** Hand-thrown dice now start and land in your tray, and a tray that shows only while rolling appears as soon as the hand dice load.
- **Saved trays.** A GM can save trays (a party crest, say) in the Dice tray window, and each player can pick one as their own tray.
- **Pets sit on the tray's rim.** With a dice tray on screen, your dice pets now sit along its top edge, out of the dice's way. They still react to every roll (cheering a 20, shivering at cold dice and so on), and a die slamming into the wall beside one makes it wobble. A tray that shows only while rolling takes its pets with it when it slides away, and brings them back for the next roll. The new **Pets and the dice tray** setting can put them back in the tray, where the dice can hit them, or keep them in the roll area instead.
- **Dice bag favourites.** Star the looks you like and the bag shows only those, with a switch to show them all.
- **Shortcuts in the themes window.** A **Dice tray** button sits next to **My pet**, and a gear opens all Dicer settings.
- **Coloured light from dice is now a setting, off by default.** Turn on **Coloured light from dice** to have clear dice cast light in their colour onto the table. Glowing dice then light it too, in their glow colour and brighter the stronger the glow.
- **Easier to see:** dice shadows are darker, and the coloured light (when on) is much stronger. With **Dice lighting: Scene**, a dark scene no longer dims the dice as far, nor tints them so deeply blue, so a resin die's inside still shows at night.
- **Many more Animater moments, where you want them.** Trigger rules now offer 16 of Animater's moments, up from 6: new are Lean, Smear, Close in, Grain, Speed lines, Glow, Shockwave, Dust falls, Token sways and Token bobs. Each plays on the whole screen, where the dice landed, or on the roller's token (whichever that moment allows), at Animater's own strength or Gentle, Medium, Strong or Full. A crit can send a shockwave out from the d20, or a fumble make your token wobble.
- **Animater moments:** the trigger editor offers moments only when your Animater version can play them, and the console says so when a moment is skipped. **Fixed:** a rule's **Preview** now plays its moment too. It used to leave the moment out, and with more than one GM online it only played for the active GM.
- **Fixed: Glow pulse was nearly invisible.** It only drew a thin rim, which was lost on light maps and among many dice, then flashed solid as the dice faded, so it looked as if it played at the end. The glowing die now takes the glow's colour too, with a wider rim, as soon as it lands.

## 0.3.2

- **Dice trays look real.** Surfaces and rims are now textured: wood grain with planks, rough stone, pebbled leather, fine felt and brushed metal, each in the colour you pick. Rims have a lit bevel and drop into the floor, metal rims have rivets and leather rims have stitching.
- **Tray shapes.** A tray can be a **Rectangle**, **Round**, a **Hexagon** or an **Octagon**. Dice always land inside the shape.
- **A new Dice tray window.** A live preview of your tray at the top, then Shape, Surface, Rim and Floor design, each as picture buttons, with sliders that show their values.
- **Fixed:** a tray with no floor design was covered in a gold tint.
- **The Dice bag shows the looks.** It is now the first tab of the chat dice tray's gear panel (next to Customize), with a picture of each look on the die you are changing. Pick All dice or one die type at the top.
- **Fixed:** the chat dice tray's Roll button had shrunk to a sliver (on PF2e, for example). It keeps its full size now, and Fortune / Misfortune become arrows when the bar is tight. Their tooltips still name them.

## 0.3.1

- **No more look-alike themes.** Three built-in themes looked like others in the theme browser. **Verdant** is now green malachite (it was Jade Marble's look with a wood sound) and sounds like stone. **Dragon Hoard**'s d20 is now amber resin full of gold, like the rest of the set, no longer a copy of Polished Gold. **Celestial**'s d20 is now midnight-blue resin with a gold star and sparkles inside, no longer a copy of Starlit Glitter.

## 0.3.0

- **More module dice sets keep their faces.** Sets whose face pictures come with bump or glow maps (for example **Daggerdice** and some of **Nice More Dice**) now show their pictures in the theme browser and keep them in **Save to My themes**. Only the bump and glow are left out.
- **Dice So Nice atlases.** Sets that pack all their face pictures, or their texture, into one sheet (Dice So Nice's `atlas` option, used by **Dice Soup**) now show those pictures instead of plain numbers.
- **Fixed:** a module set's d100 pictures landed on the wrong faces, and its ones die wore the tens die's pictures. The tens die now shows the set's d100 faces in order, and the ones die shows the set's d10.
- **New materials.** In the dice editor: **Stone** (granite, slate, sandstone, rough rock and brick), **Bone** (bone, ivory and fossil), **Jelly** (a soft, gummy see-through die) and a **Mirror** finish for metal. For a hollow see-through die, pick Clear resin with nothing inside.
- **New dice shapes.** Next to the crystal d4: a **bullet d6** and **crystal d8 and d10**, long dice that land on their sides. Pick them per die type in the dice editor.
- **Turn the preview die right over.** Drag the preview die up or down to see its bottom faces and its 1; it holds the view a few seconds when you let go.
- **Dice bag.** A bag button on the chat dice tray swaps the look of all your dice, or of one die type, from your themes, the world's or the built-in ones.
- **Dice lighting.** A new setting: Studio (as before), **Scene light** (your dice take the scene's light, darker at night and tinted by its colours) or **Sunlight**.
- **Coloured light.** Clear dice cast a pool of light in their own colour on the table beside their shadow.
- **Glint.** A new effect: a band of light sweeps across the die as it lands. Attack d20s glint by default (the **Attack dice glint** trigger; a GM can switch it off in the trigger editor).
- **Dice trays.** Your dice can land in a tray on the table: felt, wood, stone, leather, metal or your own picture, with a wooden, stitched leather, stone, metal or plain rim, rounded corners and a design on its floor (a sigil, a triangle and moon, a compass, a skull seal, or your own picture, in any colour). The GM sets a table tray for everyone; each player can use it, make their own, or turn trays off. Drag the rim to move it, drag the corner to resize it; keep it on the table or let it slide in only while dice roll. Your dice sound like its surface. Set it up under Configure Settings, Dicer, **Dice tray**.
- **Animater moments.** With Animater active, trigger rules can also play an Animater screen moment (a pulse of colour, a shake, a rumble and more) for everyone, and two ready-made triggers pulse the screen gold on a critical success and shake it on a critical failure. Moments play from the GM's view, so a GM must be online.

## 0.2.6

- **Eight new themes by Sherp:** Against the Grain, All-Seeing, Ebony & Ivory, Eruption, Nautilus, Sandalwood Sense, Scarborough and Wonderland, now built in. Their details in the theme browser say **Theme by Sherp**.
- **Fixed:** a GM had no way to set the world default theme since the settings dropdown was removed in 0.2.1, so **Lock player looks** could not be set up either. Select a built-in or world theme in the theme browser and press **Use as world default**; **Stop** clears it.
- **Fixed:** module dice sets with both a body texture and picture faces showed no numbers, for example Pathfinder 2e's own **Dicefinder Campaign** dice. The texture was drawn over the face pictures. It now stays behind them.
- **Test throws show above windows.** Dice thrown from the dice editor, the theme browser and the effect and damage previews are always drawn above Foundry's windows, whatever **Dice above windows** is set to, so you can see them with the editors open.
- **Fixed:** in a short dice editor or theme browser window, the preview die was squashed flat. It stays square now and the panel scrolls instead.
- **A wiki.** Guides to every feature, a settings reference and troubleshooting at [github.com/roileaf/dicer/wiki](https://github.com/roileaf/dicer/wiki); the README is now a short overview, and building and testing Dicer moved to CONTRIBUTING.md.

## 0.2.5

- **Pets look at your cursor.** A resting pet turns its head, then its body, to watch the cursor as it moves over the table, and holds still once it faces it.

## 0.2.4

- **Only d20s splat pets.** A check's or attack's d20 still splats a pet it hits hard; damage dice and every other die only knock it about.
- **Dice hitting a pet mid-roll set it off.** A die with an element that hits a pet while it watches its owner's dice fly now sets it off right there (it used to react only to dice landing next to it, or while resting).

## 0.2.3

- **Put your pets where you want them.** Drag a resting pet anywhere on the table and drop it: that is where pets rest on your screen from then on, the others lining up beside it, and it watches its owner's rolls from there instead of hopping over to the dice. **Where pets rest** is now **Near the dice** or **Where you put them**; the four corners and bottom centre are gone, and a corner you had picked becomes your placed spot. Dragging needs **Click to pet** on; a click without moving still pets.

## 0.2.2

- **Fixed:** the Your pet window could grow taller than the screen with no way to scroll to its last settings. It now stays within the screen, its settings scroll, and it can be resized.

## 0.2.1

Pets get a reaction and a voice for every damage type, your pet gets its own window, and damage dice win over 3D model sets.

- **Damage dice over your dice set.** If your dice are a module dice set with 3D models (The Rollsmith's sets and the like), damage dice now set it aside and roll in their damage look, instead of the set's models hiding it. Turn it off with **Damage dice over your dice set** to keep the set's models on damage dice.
- **Importing a 3D model set takes its colours.** A dice set that is all 3D models (no colours of its own) now imports as a Dicer theme in the models' own colours (a gold body with red numbers for Gold Red Armored), instead of Dicer's default look under the set's name.
- **Your pet has its own window.** Pick your pet and its colour in **Your pet** (Configure Settings, Dicer, or the theme browser's My pet button), with all your pet settings (size, where pets rest, how long they stay, splats, petting, reactions, moods, cheering, sounds). It was in the dice editor, but it was never part of a theme: it is yours, whatever dice you roll.
- **Pets react to every damage type.** Each element now has its own reaction: acid fizzes green bubbles, poison leaves it queasy in a green haze, void sinks dark motes into it, vitality makes it wiggle happily under golden motes, sonic rings spread around it, force knocks shards off it, mental leaves pink swirls circling its head, spirit wisps rise off it, bleed drips, a slash sweeps past, needles dart in, and a blow kicks up dust (fire, frost and storm as before). An elemental die that hits a resting pet now sets it off instead of splatting it; weapon dice (slashing, piercing, bludgeoning) still splat it on a direct hit.
- **Cute pet noises.** Pets purr when petted, go "hmph" when they huff, and every damage type has its own voice: a cough for smoke, chattering teeth for cold, a buzzing squeak for electricity, a fizz for acid, a queasy "bleh" for poison, a spooked "ooo" for void, a happy coo when healed, ringing ears for sonic, an "oof" for force, a warble for mental, a ghostly "wooo" for spirit, an "ow-ow" for bleed, a "whoa!" for slashing, a "yip!" for piercing and a "bonk" for bludgeoning. **Pet sounds** (in Your pet) mutes them.
- **Tidier settings.** Dicer's settings are grouped under headings (General, Graphics, Sound, Effects, Damage dice, Pets, Rolling by hand, Roll areas, Chat and dice trays). The **Dice theme** and **World default theme** dropdowns are gone: the theme browser picks both.
- **Fixed:** clicking a pet did nothing where it rested over part of Foundry's interface (the scene controls, players list, hotbar or scene navigation edges); a click right on the pet now pets it.
- **Fixed:** an elemental die hitting a resting pet splatted it instead of setting off its reaction.

## 0.2.0

A big one: a chat dice tray, roll filters, Dice So Nice module dice sets with their 3D models and art, your own images on dice, and pets you can pet.

- **Flat checks in the dice tray (Pathfinder 2e, Starfinder 2e).** DC 5 and DC 11 buttons after the dice: one click rolls a flat check (with Fortune or Misfortune if on) and posts it as the system's own check card, the result coloured by its degree of success. Hide them in the tray's Customize panel.
- **Face images for coins, Fate dice and the d100.** Themes can picture heads and tails, the Fate die's +, blank and −, and the d100's tens (10 to 00); the dice editor has preview buttons and face slots for them.
- **Importing a module dice set keeps its images.** Import as theme now carries a set's image faces (a natural 20 icon, full face art, coins, Fate dice, d100 tens) into your theme; only 3D models and word or symbol faces stay with the set, and the note says so. Plain numbered faces are no longer reported as lost.
- **Throw shows the real set.** The theme browser's Throw button rolls a module dice set with its own models and faces, not just its colours.
- **A better-looking dice tray.** A solid panel (the chat no longer shows through), dice tiles that glow when picked, a joined modifier, a Fortune / Misfortune switch and a Roll button with a rocking d20 (the formula is in its tooltip). It lines up with the chat box exactly.
- **Fixed:** pets set to rest in a top corner rested at the bottom instead (Foundry v14's empty interface boxes were taken for buttons).
- **Roll filters.** Choose which rolls you see as 3D dice: initiative, roll tables, rolls during combat, damage, other players' rolls, blind and private rolls, and big rolls. Each can show, show only your own, or skip; the GM sets a world default (Configure Settings, Dicer, Roll filters).
- **Bigger dice.** Dice size (and Pet size) now go up to 3x.
- **Pet size.** Pets have their own **Pet size** setting, so bigger dice no longer mean bigger pets.
- **Crit and fumble text stays sharp and on screen.** The JB2A CRITICAL / MISS text keeps one screen size whatever the dice size, and a die landing at the edge of the screen no longer pushes it out of view.
- **Theme and effect sounds** can be turned off on their own (the zap, chime, fanfare and the rest), leaving dice impacts and pet sounds as they are.
- **Dice above windows.** A new setting draws the dice over open windows and character sheets: never (as before), only while your own roll is on screen, or for every roll.
- **Grab and toss.** Once dice land, pick one up with the mouse and fling it: it bounces off the other dice and pets and settles again, still showing the same number. Purely for fun: the result never changes. Turn it off with **Grab and toss dice**.
- **Chat dice tray.** A dice tray docked under the chat input, tinted in your dice theme: click a die to add it, right-click to remove, hold for quick counts, set a modifier and roll. It fits the world's system: the dice it uses, and its own two-d20 helper where the rules have one (advantage and disadvantage in D&D 5e, fortune and misfortune in Pathfinder 2e, advantage and disadvantage in Daggerheart, where Roll with no dice picked (or exactly 2d12) makes a real Duality roll through the system's own roll dialog, edges and banes in Draw Steel, none elsewhere). If you may roll by hand, drag a die out onto the table to throw it. Each player can customize their own tray with the gear button (which dice show, the helper buttons, the modifier; saved with their user, so it follows them to any device). It uses the chat's own roll-mode buttons, and hides itself while the Dice Tray module is active. Turn it off with **Chat dice tray**.
- **Number size and thickness.** Two new sliders in the dice editor's Numbers section.
- **More than one thing inside resin.** Resin dice can now hold a second, suspended layer over their inside: foil flakes, glitter, sand or bubbles, with its own colour and amount (resin blobs with foil flakes, at last).
- **Living insides per look.** Each look can turn its moving inside on or off; the global setting still turns them all off.
- **Module dice sets in the theme browser.** Dice sets other modules add through the Dice So Nice API appear under a new "Module dice" filter: use one as your dice, or import it as a theme you can edit.
- **3D dice models on every die.** Model dice sets (The Rollsmith's TRS sets and others made for Dice So Nice) now show their models on the d8, d10, d12 and d20 too, not only the d2 and d6, always with the rolled number on top. d4 and d100 models (the d100's tens die) show too, and so do dice thrown by hand, which land on the model's own number.
- **Dice So Nice module textures.** Dice from modules that bring texture art (Paizo adventure modules, RealDark) now show that art on every face, fitted as Dice So Nice fits it, in the module's font. Importing such a set as a theme keeps both.
- **Body images.** Themes can put a picture on the die itself: wrapped across the whole die (patterns, photos) or on every face (a crest), with scale, rotation and strength. Pick it in the dice editor's Body section.
- **Face images.** Themes can put your own images on any face of any die (a logo on the 20, say), in their own colours or tinted like the numbers. Pick them in the dice editor's Numbers section.
- **Electronic dice (Pixels).** A die type set to Pixels (or another electronic dice module that uses Foundry's own form) stays with it, and Dicer rolls the other dice by hand, even within one roll. Before, any electronic dice switched rolling by hand off entirely.
- **Rolls from physical dice.** A new per-player setting: rolls from physical dice (Pixels, other electronic dice, manual entry) are animated and get a dice mark on their chat card (the default), or are only animated, or only marked with no 3D dice.
- **Fixed:** the dice editor offered a second colour for resin bodies that had no effect; it is gone.
- **Fixed:** damage dice in PF2e and D&D 5e came out as flat coloured plastic (fire as plain red) instead of their damage look. The system labels each damage die with its type, and that label matched a plain colour set of the same name first; the damage look now wins.
- **Pets rest where you choose.** Resting pets no longer move out of your cursor's way. Instead they wait at the spot you pick in **Where pets rest**: near the dice in their owner's roll area (the default), in one of the four corners, or at the bottom centre. The choice is per player and applies to every pet on your screen.
- **Click to pet.** Click a resting pet and it wiggles happily, with a few hearts and a chirp. Click it too often and it huffs, hops off and ignores you for a few seconds. Only clicks right on a pet on the open table are caught; everything else, including clicks on a window over a pet, goes to Foundry. Turn it off with **Click to pet**.
- **Pets react to elemental dice.** A die with an element that lands next to a resting pet sets it off: it fans away smoke from fire and lava, shivers from frost, bristles at storm, and jumps at anything else. Any player's dice count, even without a pet of their own. Turn it off with **Pet reactions to elemental dice**.
- **Pet moods.** A pet that rests after a run of good d20s stands proud; after a run of bad ones it sulks. The mood comes from its owner's last five d20 results on your screen and resets when Foundry reloads. Turn it off with **Pet moods**.
- **Pets cheer for others.** When another player rolls a natural 20, the other resting pets turn toward the dice and cheer, once per roll. Turn it off with **Pets cheer for others**.
- None of this ever happens for a roll you cannot see, and with reduced motion on the animations are gentler and no sparks flash.

## 0.1.1

Dice now carry their element through the whole throw, and a natural 20 gets a moment of its own.

- **Elemental trails.** A die with an element leaves a trail of it while it flies: flames and embers for fire, mist and ice glints for frost, crackling sparks for storm, molten drips for lava. Every damage type has one too: green drips for acid, dark smoke for void, golden motes for vitality, a green haze for poison, sound rings for sonic, violet shards for force, pink swirls for mental, cyan wisps for spirit, falling blood for bleed, and silver arcs, white needles and dust for slashing, piercing and bludgeoning. The 5e names map onto them (thunder is sonic, psychic is mental, radiant and healing are vitality, necrotic is void, lightning is storm). A die with neither an elemental inside nor a damage type leaves nothing. Turn it off with **Elemental trails**.

- **Elemental critical bursts.** A d20 with an element that lands a natural 20 bursts in its element: a fire explosion, an ice bloom, forked lightning, a molten splash, and one for every damage type. At most three play at once, and with reduced motion a burst is one soft swell. The bursts are also in the trigger and celebration effect lists as `burst-<element>`, so any rule can play one on any die. Turn the automatic ones off with **Elemental critical bursts**.

- **Hidden rolls stay hidden.** Blind and whispered rolls never show a trail or a burst to anyone who cannot see the result, and other players' dice follow **Show other players' effects**.

- **A clearer dice tray.** The tray has clickable die buttons with counts, a live formula of what you are about to throw, and plainer roll modes.

- **Your own celebration sounds and animations.** Each natural 20 and natural 1 celebration can use any audio file on the server, and, with JB2A active, any JB2A animation. With Sequencer installed, the animation picker is a browser with categories, colour swatches and video previews. Play buttons throw a test die with your unsaved choices, only for you.

- If the new effects do not show after updating, reload Foundry with Ctrl+F5 so the browser drops its old copy of the module.

## 0.1.0

First prerelease: physics-simulated 3D dice for Foundry VTT v14, in sync for every player.

- Themes, an appearance editor with a live preview, and looks per die type, kind of roll, character or damage type.
- Resin dice with living insides, including fire, storm, frost and lava, that react to crits.
- Built-in roll effects (celebrate, fumble, sparkles, embers, frost, lightning, smoke, shatter, shockwave, light burst and more), with JB2A animations when JB2A is installed.
- Trigger rules for effects, sounds and macros; damage dice themes for PF2e and D&D 5e.
- Rolling by hand, roll areas per player, dice pets, and Dice So Nice API compatibility.
