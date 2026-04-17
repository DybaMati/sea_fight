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
- `Spacja` - strzal

## Co jest dalej

- system lootu i ekwipunku,
- porty i sklepy (ulepszenia statku),
- frakcje i questy,
- podzial na strefy PvE/PvP,
- autorytatywna walidacja trafien pod anti-cheat.
