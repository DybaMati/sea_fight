# Sea Fight (MVP)

Prototyp gry morskiej inspirowanej Sea of Legends:

- jeden statek na gracza (sterowanie realtime),
- walka z mobami i innymi graczami,
- prosty score za zatopienia,
- multiplayer przez WebSocket (`ws`),
- logowanie/rejestracja konta w MySQL.

## Wymagania

- Node.js 18+
- MySQL 8+

## Baza danych (MySQL)

Domyslna konfiguracja:

- host: `127.0.0.1`
- port: `3306`
- user: `dyba`
- haslo: `1234`
- baza: `sea_fight`

Mozesz nadpisac przez zmienne:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

Tabela kont jest tworzona automatycznie przy starcie:

- `statki_1` (`nick`, `email`, `password_hash`, daty)

## Start

```bash
npm install
npm start
```

Nastepnie otworz:

`http://localhost:3000`

Najpierw przejdziesz przez ekran logowania/rejestracji, a potem do gry.

## Sterowanie

- `W` - naprzod
- `S` - cofanie
- `A` - skret w lewo
- `D` - skret w prawo
- klik/tap na pustej mapie - plyn do wskazanego punktu
- klik/tap na celu - zaznaczenie celu
- `Atak` - przelacznik auto-ataku ON/OFF
- `Uleczenie` (przycisk na dole) - leczenie z cooldownem

## RPG elementy MVP

- EXP i poziom gracza (LVL),
- mozliwosc ataku graczy oraz mobow,
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

