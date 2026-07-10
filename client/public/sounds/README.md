# Game sounds (Age of AI)

Drop your sound files here (**.mp3**, ogg, or wav). Each file with the exact name
below is played at the right moment. If a file doesn't exist, the game falls back
to a synthesized sound — so you can add them **one at a time**.

⚠️ Use **free** sounds (CC0 / freesound.org / AI-generated ones you created).
**Never** files extracted from AoE2 or commercial games (copyright).

Tip: short sounds (0.3–2s), already "trimmed" (no long silence at the start/end).

## File list (exact name → what it is)

### Selection (clicking an object)
- `select_villager.mp3` — villager (short voice / "yes sir")
- `select_villager_1.mp3`, `select_villager_2.mp3`, `select_villager_3.mp3` — varied villager acknowledgements
- `select_swordsman.mp3` — swordsman (metal clink / grunt)
- `select_archer.mp3` — archer
- `select_knight.mp3` — **horse neighing**
- `select_building.mp3` — building (thud)
- `select_resource.mp3` — tree/mine (chime)
- `select_grass.mp3` / `select_water.mp3` — clicking empty terrain
- `select_<building>.mp3` — one exact building, for example `select_house.mp3`

### Commands (right click)
- `move.mp3` — move ("yes"/footstep)
- `attack.mp3` — attack (shout/charge)
- `gather.mp3` — gather
- `build.mp3` — order construction (hammer)
- `chop_wood.mp3` — axe striking wood (positional)
- `mine_stone.mp3` — pickaxe striking stone (positional)
- `mine_gold.mp3` — brighter ore strike (positional)
- `harvest_food.mp3` — crop/leaf harvest (positional)
- `hammer_build.mp3` — construction hammer (positional)
- `place.mp3` — place the building

### Events
- `ui.mp3` — UI button click
- `trained.mp3` — unit ready (bell)
- `ageup.mp3` — advance an age (fanfare)
- `research.mp3` — upgrade researched (ding)
- `death.mp3` — unit dies
- `wreck.mp3` — building collapsing
- `hit.mp3` — **sword clash** (combat hit)

### Ambient
- `owl.mp3` — **owl hoot** (plays ~once/min, when it crosses the sky)

### Music
- `music.mp3` — **background track** (loops). If you **don't** add this
  file, the game generates a calm synthesized track. Drop in a mellow track
  in the game's style and it takes over automatically.

## How to test
1. Download/generate the sound, rename it exactly as above, save it in this folder.
2. Reload the game (the page).
3. Perform the action (e.g. select the knight) and listen.
4. The **M** key toggles all sound; the **N** key toggles only the music.

While a file doesn't exist, you'll see a `404` in the console for it — that's
**normal** (it just means "not added yet"), not a real error.
