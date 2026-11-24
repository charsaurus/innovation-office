# Innovation Office

A multiplayer office sim in a single HTML file plus a zero-dependency Node server, built to bring a hybrid team together. It's an office life sim for a workplace team. **The goal: start as an Intern and get promoted all the way to CEO.** You build and decorate your cubicle, do tasks and get promoted from Intern to CEO. You also join meetings, eat lunch with the team, nap in the Recharge Room, send colleagues food and drinks, and play together live on the office network.

## Files

| File | What it is |
|---|---|
| `innovation-office.html` | The whole game in one file. Open it in Edge or Chrome. No install needed. |
| `server/server.js` | The live office server (Node.js, no extra packages): `node server/server.js` |
| `InnovationOffice.exe` | Windows desktop app that can also host. |
| `desktop/` | Source for building the .exe |
| `archive/` | Older versions |

## Running it

The HTML file is a plain web page: it needs no install and works fully offline, and 🔗 **Share** codes let people visit each other's cubicles.

For **live play**, one machine runs the server and everyone else opens its address:

```bash
node server/server.js
```

Then open `http://<that machine>:8787`. The server is about 200 lines of Node.js with no dependencies. You can also host from the desktop app.

## The office

| Area | What's there |
|---|---|
| Meeting rooms | Six rooms for 4, 8, 12, 15, 16 and 25 people (the last is an auditorium with a stage). Names come from `config.yaml` |
| 12 cubicles | Glass panels, big desks with two monitors, gifts sit on the desk |
| 🍽️ Pantry | Lunch counter, coffee, fridges, dining tables, high tables with stools, sofas |
| 🔋 Recharge Room | Beanbags, massage chairs and nap couches. Sitting restores energy (naps restore it fastest) |
| 🍸 The Sandbox Bar | Open all day. Each player can hide it in ⚙️ Settings |
| 🪩 The Club | Next to the boss's office, through the bar. A DJ on the decks, an LED dance floor, light show and high tables with drinks. Stand on the dance floor to dance (first dance of the day gives XP). Hidden together with the bar |
| 👔 Boss's office | The boss works here and walks the floor now and then. Directors and above can go in |
| 🚧 WIP zone | The old reception. When all 12 cubicles are taken in live play, 2 extra cubicles are built here automatically |

**Building:** open 🔨 Build in your cubicle. Pick an item and click a green tile to place it. **✋ Move** picks up an item and drops it on another tile, **🔄 Rotate** turns it (or press **R**), and **🗑️ Remove** sells it back for half price.

**Tasks** include a Design Thinking workshop (Analyst and up) and project updates for the boss. Click the boss once a day for bonus XP.

**Controls:** click to walk, drag to look around, scroll or ＋/－ to zoom, 🎯 to jump back to yourself.

**Gifts:** food and drinks a colleague sends you land on your desk. Click one to eat or drink it 25% at a time, and a bar under it shows how much is left. Colleagues can see what's on your desk too.

**Lunch:** 12:00–2:00pm on the computer's real clock. Colleagues gather in the Pantry, and lunch is served at the counter once a day. To preview lunch at another time, add `?time=12:30` to the address.

## Office names (config.yaml)

Real names (the company, boss, DJ, meeting rooms and computer colleagues) are **not** in the code. They live in `config.yaml`, which is gitignored. Without it the game uses generic names.

1. Copy `config.example.yaml` to `config.yaml` and fill in your names.
2. Put it where the game can find it:
   - **Live server (Node):** next to `innovation-office.html`. Everyone who opens the server's address sees the names, and players running their own copy receive them when they join.
   - **Desktop app:** next to `InnovationOffice.exe`.
   - **Anywhere else:** ⚙️ Settings → 🏷️ Office names → **Load config.yaml**.

## Playing live

1. One person hosts by running the server (see above), or uses 🌐 **Live → Host** in the desktop app.
2. Everyone else opens `http://HOST-ADDRESS:8787` in Edge, or enters the address in 🌐 **Live → Join**.

Colleagues are the real people who join. Each gets a cubicle (12 in total) and keeps it while away. Name, avatar, décor and desk-gift changes show up for everyone instantly.

## Avatars and the Wardrobe

Choose a boy or girl avatar, a skin tone, a hairstyle and colour, a top, bottoms, glasses and a hat. Open it from ⚙️ **Settings → 👗 Wardrobe**.

- **Free:** 8 hairstyles, 5 tops, 3 bottoms, round and square glasses, a hair bow
- **Buy with coins:** curly, pigtails, afro and mohawk hair; blue IG tee, cardigan, hoodie, jeans, cat-eye glasses, sunglasses, cap, beanie, headphones, party hat
- **Unlocked by promotion:** VR headset (Associate), blazer (Manager), sharp suit (Director), gold CEO blazer and crown (CEO)

You can try anything on before buying it.

## Removing colleagues

**While the server is running:** open the game on the host computer (the one running the server), then go to 🌐 **Live → 🛠️ Manage colleagues → Remove**. Only the host computer sees this list. The removed person is disconnected, and their desk, décor and waiting gifts are deleted. If they join again, they come back as a new colleague.

**While the server is stopped:**

```bash
node server/server.js list
node server/server.js delete Alex
```

`delete` removes everyone with that name, so for duplicates use the id from `list` instead.

## When the live server can't be reached

On the computer that can't connect, open 🌐 **Live**, type the host address and press **🔍 Test connection**.

- **❌ Can't reach:** the two computers can't see each other. Usually they're on different networks (for example, one is on a VPN or guest Wi-Fi), or a firewall blocks port 8787. Host the server on a machine on the same network as the players.
- **✅ Reachable but Join fails:** the network allows web pages but blocks live (WebSocket) connections. Allow WebSocket traffic on port 8787.

## 🚨 GPU emergency

Every 5 minutes every GPU in the office shuts down. An alarm goes off, and everyone has **60 seconds** to get to the auditorium for the Great Reboot, a group *Ctrl… Alt… Delete!*. A 🏃 **Go now** button walks you there.

- Everyone makes it: bonus XP and coins for all.
- Anyone who misses it is **sent back to Intern**. Coins, décor and outfits are safe.

In the live office the server runs the timer, so everyone gets the alarm at the same moment.

The game **pauses while its window is hidden or minimised**: you're skipped for any emergency while away, and other players don't see you listed as missing.

## People, romance and office politics

Open **💕 People**, or click anyone in the office, for these actions:

- **Romance:** 💐 flirt with a computer colleague once a day to build 💗 affection. ☕ Take them on a coffee date (15🪙, from 💗 30), then 🌹 ask them out (from 💗 70). With real colleagues you can 😉 wink and 🌹 ask them out; they get a pop-up to say yes or no. Couples get 💕 next to their names and hearts when they're together. Anyone can 🚫 block someone, and unblock them later from 💬 Chats or 💕 People.
- **Office politics:** every few minutes a dilemma pops up, for example someone taking credit for your idea, gossip in the Pantry or a fight over budget. Your choices change your 🏛️ reputation and your trust with colleagues (🤝 allies, ⚔️ rivals). Good reputation and allies give a task XP bonus.
- **💬 Secret chats:** private 1-to-1 messages with real colleagues in the live office. The server passes them along but never saves them. They are kept only on the two players' own computers.

## Office API

The live server has a small web API, so other programs can read the office or act in it without clicking in the game. It runs on the office network only and needs no internet. Replace `localhost` with the server computer's address when calling it from another computer.

**Leaderboard page:** open `http://localhost:8787/leaderboard` in any browser. It shows top XP, who's online, the most gifted and the best-decorated desks, and refreshes every 5 seconds. Connected players also get a link in 🌐 Live.

**Read (anyone on the network):**

| Endpoint | Returns |
|---|---|
| `GET /api` | List of endpoints and gift names |
| `GET /api/players` | Everyone who has joined: name, rank, XP, desk, online |
| `GET /api/players/<name or id>` | One player, including avatar and cubicle |
| `GET /api/online` | Who's in the office right now, and where |
| `GET /api/leaderboard` | Top XP, most gifted, best decorated |
| `GET /api/stats` | Colleagues, online count, desks used, team XP, people per rank |

**Act (only from the computer running the server):**

```bash
curl -X POST http://localhost:8787/api/announce -d '{"text":"Town hall at 3pm!"}'
```

Everyone in the office sees the announcement, and the boss says it. Add `"from":"Sam"` to send it from someone else.

```bash
curl -X POST http://localhost:8787/api/gift -d '{"to":"Alex","gift":"kopi"}'
```

Sends a gift from the boss (or `"from"`). Players who are offline get it when they next join.

Requests from other computers to these two return `403`.

**Control your own avatar:** every player gets a personal API key (🌐 Live → 🔑 My API key). Anyone with the key can act as that player, from any computer, while their game is open:

```bash
curl -X POST http://localhost:8787/api/me/say -H "X-Api-Key: YOUR_KEY" -d '{"text":"Hello from a script!"}'
```

| Action | Body |
|---|---|
| `GET /api/me` | Your profile |
| `POST /api/me/say` | `{"text"}` |
| `POST /api/me/goto` | `{"place"}`: desk, pantry, coffee, bar, club, dancefloor, recharge, boss, wip, or a meeting room: huddle, focus, studio, summit, lab, auditorium |
| `POST /api/me/task` | `{"n"}`: start task number n (default 1) |
| `POST /api/me/dance` · `coffee` · `nap` | none |
| `POST /api/me/gift` | `{"to", "gift"}` |
| `POST /api/me/dm` | `{"to", "text"}`: secret message |
| `POST /api/me/wink` | `{"to"}` |

Press **New key** in the game if a key leaks.

## Updating the game

Only the host needs to update if everyone else opens the host's address in a browser. They get the new version on their next refresh.

**Host running the .exe (drop-in update):** download the new `innovation-office.html` from the latest [release](https://github.com/charsaurus/innovation-office/releases/latest). Put it in the **same folder as InnovationOffice.exe** and restart the app. The app uses that file instead of its built-in copy, so you don't need a new .exe. To go back to the built-in version, delete the file. ❔ Help shows the version and whether the updated file is in use.

You only need a new .exe when the live server itself changes. The release notes will say so.

**Host running on a Mac or PC with Node.js:**

```bash
git pull
node server/server.js
```

The game file updates as soon as `git pull` finishes. Restart the server only if `server/server.js` changed.

## Rebuilding the .exe

```bash
cd desktop
npm run dist:win
cp dist/InnovationOffice.exe ..
```

## Testing two players on one computer

Add `?profile=name` to the address, e.g. `http://localhost:8787/?profile=bob`.
