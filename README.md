# Sea Fight (MVP)

Prosty prototyp gry morskiej inspirowanej Sea of Legends:

- jeden statek na gracza (sterowanie realtime),
- walka z mobami i NPC statkami,
- prosty score za zatopienia,
- multiplayer przez WebSocket (`ws`).

## Wymagania

- Node.js 18+

## Start

```bash
npm install
npm start
```

Nastepnie otworz:

`http://localhost:3000`

Mozesz odpalic wiele kart/przegladarek, aby testowac multi.

## Sterowanie

- `W` - naprzod
- `S` - cofanie
- `A` - skret w lewo
- `D` - skret w prawo
- klik myszka - zaznaczenie celu (gracz/NPC/mob)
- `Atak` (przycisk na dole) - atak wybranego celu
- `Uleczenie` (przycisk na dole) - leczenie z cooldownem

## RPG elementy MVP

- EXP i poziom gracza (LVL),
- mozliwosc ataku graczy oraz mobow/NPC po targetowaniu,
- koordynaty mapy (X/Y) w HUD,
- bardzo wolne poruszanie mobow.

## Co jest dalej

- system lootu i ekwipunku,
- porty i sklepy (ulepszenia statku),
- frakcje i questy,
- podzial na strefy PvE/PvP,
- autorytatywna walidacja trafien pod anti-cheat.

## Konfiguracja mobow

Definicje mobow masz w folderze `monsters/`.
Kazdy potwor to osobny plik, np.:

- `monsters/syrena.js`
- `monsters/wegorz.js`

W pliku potwora ustawiasz m.in.:

- `id`, `name`, `color`
- `hp`, `damage`, `expReward`
- `speed`, `turnSpeed`, `radius`
- `attackRange`, `attackSpread`, `attackCooldown`
