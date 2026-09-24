```js
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;

const rooms = new Map();

/*
=========================================================
THE BOX — CORE RULE

Every new game receives a completely fresh hidden board.

There are ALWAYS:
11 SAFE boxes
5 ELIMINATED boxes

The results are randomly shuffled among boxes 1–16.

NPCs NEVER receive the hidden results of unopened boxes.
They only know what a normal player could know.
=========================================================
*/

const OBJECTIVES = [
  { name: "NEGOTIATOR", text: "Make 3 deals with different players; at least 1 honored.", reward: 100 },
  { name: "CON ARTIST", text: "Successfully deceive another player about your objective.", reward: 120 },
  { name: "DIPLOMAT", text: "Have 2 players voluntarily defend or protect you.", reward: 100 },
  { name: "RISK TAKER", text: "Choose 3 unopened boxes and survive the third.", reward: 100 },
  { name: "PROPHET", text: "Make 2 correct predictions.", reward: 120 },
  { name: "KINGMAKER", text: "Cause another player to gain $100 through your actions.", reward: 100 },
  { name: "SURVIVOR", text: "Survive 4 box-opening rounds.", reward: 120 },
  { name: "DEALER", text: "Exchange money with 3 different players.", reward: 100 },
  { name: "INFLUENCER", text: "Get 2 players to support your decision.", reward: 100 },
  { name: "GAMBLER", text: "Spend at least $120 in the Power Store and survive.", reward: 120 },
  { name: "GUARDIAN", text: "Use Protection on another player.", reward: 100 },
  { name: "SCOUT", text: "Correctly identify 2 safe boxes before they open.", reward: 120 },
  { name: "SABOTEUR", text: "Cause another player to lose money through your action.", reward: 100 },
  { name: "LOYALIST", text: "Honor 2 separate deals.", reward: 120 },
  { name: "SECRET KEEPER", text: "Keep your objective undisclosed until the final round.", reward: 120 },
  { name: "OPPORTUNIST", text: "Be last player to spend money in the store.", reward: 100 }
];

const POWER_DEFINITIONS = {
  Protection: {
    cost: 60,
    description: "Protect another player from one elimination."
  },
  Reveal: {
    cost: 60,
    description: "Reveal whether an unopened box is SAFE or ELIMINATED."
  },
  "Second Chance": {
    cost: 60,
    description: "Survive one elimination."
  },
  Steal: {
    cost: 60,
    description: "Steal $50 from another player."
  },
  Swap: {
    cost: 60,
    description: "Swap your chosen box with another unopened box."
  },
  Prediction: {
    cost: 60,
    description: "Predict whether a chosen box is SAFE or ELIMINATED."
  },
  Sabotage: {
    cost: 60,
    description: "Cause another player to lose $50."
  },
  "Royal Assignment": {
    cost: 60,
    description: "Choose who must open the next box."
  }
};

const PERSONALITIES = [
  {
    name: "The Gambler",
    style: "risky",
    riskTolerance: 0.90,
    trust: 0.35,
    aggression: 0.75,
    greed: 0.80
  },
  {
    name: "The Analyst",
    style: "logical",
    riskTolerance: 0.25,
    trust: 0.55,
    aggression: 0.35,
    greed: 0.50
  },
  {
    name: "The Opportunist",
    style: "opportunistic",
    riskTolerance: 0.60,
    trust: 0.30,
    aggression: 0.65,
    greed: 0.90
  }
];

/*
=========================================================
RANDOMIZATION
=========================================================
*/

/*
Fisher-Yates shuffle.

This produces a fresh random ordering of the results.
Box numbers have NO inherent meaning.
*/
function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/*
Creates a completely new board.

11 SAFE
5 ELIMINATED

The hidden results are assigned randomly to boxes.
*/
function createBoxes() {
  const results = [
    ...Array(11).fill("SAFE"),
    ...Array(5).fill("ELIMINATED")
  ];

  const randomizedResults = shuffle(results);

  return randomizedResults.map((result, index) => ({
    number: index + 1,
    result,
    opened: false
  }));
}

/*
=========================================================
GENERAL HELPERS
=========================================================
*/

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function createPlayer(
  id,
  name,
  isNPC = false,
  personality = null
) {
  return {
    id,
    name,
    isNPC,
    personality,

    cash: 100,
    alive: true,

    powers: [],

    protection: false,
    secondChance: false,

    objective: randomItem(OBJECTIVES),
    objectiveComplete: false,

    boxesOpened: 0,

    predictions: [],
    correctPredictions: 0,

    /*
    Future social-AI system.

    NPCs will eventually remember:
    - who helped them
    - who betrayed them
    - who lied
    - who honored deals
    - who they trust
    */
    relationships: {}
  };
}

function generateRoomCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

/*
=========================================================
ROOM CREATION
=========================================================
*/

function createRoom(hostId, hostName) {
  const code = generateRoomCode();

  const room = {
    code,

    hostId,

    mode: "online",

    started: false,
    finished: false,

    goldenBox: Math.floor(Math.random() * 16) + 1,

    /*
    IMPORTANT:
    This board is generated once when the game is created.
    The hidden results are NEVER sent to clients.
    */
    boxes: createBoxes(),

    currentTurn: null,

    log: [],

    players: []
  };

  room.players.push(
    createPlayer(hostId, hostName)
  );

  rooms.set(code, room);

  return room;
}

function createSoloRoom(
  socketId,
  playerName,
  npcCount = 3
) {
  const code = generateRoomCode();

  const room = {
    code,

    hostId: socketId,

    mode: "solo",

    started: true,
    finished: false,

    goldenBox: Math.floor(Math.random() * 16) + 1,

    /*
    NEW RANDOM BOARD
    */
    boxes: createBoxes(),

    currentTurn: socketId,

    log: [],

    players: []
  };

  room.players.push(
    createPlayer(
      socketId,
      playerName
    )
  );

  for (let i = 0; i < npcCount; i++) {
    const personality =
      PERSONALITIES[i % PERSONALITIES.length];

    room.players.push(
      createPlayer(
        `npc-${i}-${Date.now()}-${Math.random()}`,
        `${personality.name} ${i + 1}`,
        true,
        personality
      )
    );
  }

  rooms.set(code, room);

  addLog(
    room,
    `Solo Test started with ${room.players.length} players.`
  );

  addLog(
    room,
    "🎲 A completely new hidden board has been generated."
  );

  return room;
}

/*
=========================================================
GAME STATE
=========================================================
*/

function addLog(room, message) {
  room.log.push(message);

  if (room.log.length > 100) {
    room.log.shift();
  }
}

/*
PUBLIC STATE

This is extremely important.

Unopened box results are converted to null.

Therefore:
- human players cannot see them
- NPC decision systems cannot see them
- the browser cannot inspect them
*/
function getPublicState(room) {
  return {
    code: room.code,

    mode: room.mode,

    started: room.started,

    finished: room.finished,

    goldenBox:
      room.finished
        ? room.goldenBox
        : null,

    currentTurn: room.currentTurn,

    boxes: room.boxes.map(box => ({
      number: box.number,

      opened: box.opened,

      result:
        box.opened
          ? box.result
          : null,

      isGolden:
        room.finished
          ? box.number === room.goldenBox
          : false
    })),

    players: room.players.map(player => ({
      id: player.id,

      name: player.name,

      isNPC: player.isNPC,

      personality:
        player.isNPC
          ? player.personality?.name
          : null,

      cash: player.cash,

      alive: player.alive,

      powers: player.powers,

      protection: player.protection,

      secondChance: player.secondChance
    })),

    log: room.log
  };
}

function getPrivateState(room, playerId) {
  const player =
    room.players.find(
      p => p.id === playerId
    );

  if (!player) return null;

  return {
    ...getPublicState(room),

    you: {
      id: player.id,

      name: player.name,

      cash: player.cash,

      alive: player.alive,

      powers: player.powers,

      protection: player.protection,

      secondChance: player.secondChance,

      objective: player.objective,

      objectiveComplete:
        player.objectiveComplete,

      boxesOpened:
        player.boxesOpened,

      correctPredictions:
        player.correctPredictions
    }
  };
}

function emitRoom(room) {
  for (const player of room.players) {
    if (!player.isNPC) {
      io.to(player.id).emit(
        "state",
        getPrivateState(
          room,
          player.id
        )
      );
    }
  }
}

/*
=========================================================
PLAYER / BOX HELPERS
=========================================================
*/

function alivePlayers(room) {
  return room.players.filter(
    player => player.alive
  );
}

function unopenedBoxes(room) {
  return room.boxes.filter(
    box => !box.opened
  );
}

/*
=========================================================
GAME END
=========================================================
*/

function finishGame(room) {
  if (room.finished) return;

  room.finished = true;

  const survivors =
    alivePlayers(room);

  if (survivors.length === 1) {
    addLog(
      room,
      `🏆 ${survivors[0].name} is the final survivor!`
    );
  } else if (survivors.length > 1) {
    addLog(
      room,
      `🏆 Game finished. Survivors: ${survivors
        .map(player => player.name)
        .join(", ")}`
    );
  } else {
    addLog(
      room,
      "Game finished. There are no survivors."
    );
  }

  emitRoom(room);
}

function checkGameEnd(room) {
  if (
    alivePlayers(room).length <= 1
  ) {
    finishGame(room);
    return true;
  }

  if (
    unopenedBoxes(room).length === 0
  ) {
    finishGame(room);
    return true;
  }

  return false;
}

/*
=========================================================
NPC SYSTEM — FOUNDATION
=========================================================
*/

/*
NPCs can ONLY reason from information available
to an ordinary player.

They cannot access:

box.result

for unopened boxes.
*/

function chooseNpcTarget(room, npc) {
  const candidates =
    alivePlayers(room).filter(
      player =>
        player.id !== npc.id
    );

  if (!candidates.length) {
    return null;
  }

  /*
  Analyst:
  tends to target wealthy players.
  */
  if (
    npc.personality?.style ===
    "logical"
  ) {
    return candidates
      .slice()
      .sort(
        (a, b) =>
          b.cash - a.cash
      )[0];
  }

  /*
  Opportunist:
  random target for now.

  This will later become:
  - weakest relationship
  - richest player
  - biggest threat
  - easiest betrayal
  */
  if (
    npc.personality?.style ===
    "opportunistic"
  ) {
    return randomItem(
      candidates
    );
  }

  /*
  Gambler:
  unpredictable.
  */
  return randomItem(
    candidates
  );
}

/*
=========================================================
NPC POWER PURCHASING
=========================================================
*/

function npcBuyPower(room, npc) {
  if (npc.cash < 60) {
    return false;
  }

  let power;

  if (
    npc.personality?.style ===
    "risky"
  ) {
    power =
      Math.random() < 0.5
        ? "Prediction"
        : "Protection";
  }

  else if (
    npc.personality?.style ===
    "logical"
  ) {
    power =
      Math.random() < 0.5
        ? "Reveal"
        : "Prediction";
  }

  else {
    power =
      Math.random() < 0.5
        ? "Steal"
        : "Protection";
  }

  npc.cash -=
    POWER_DEFINITIONS[power].cost;

  npc.powers.push(power);

  addLog(
    room,
    `${npc.name} bought ${power}.`
  );

  return true;
}

/*
=========================================================
NPC POWER USE
=========================================================
*/

function npcUsePower(room, npc) {
  if (!npc.powers.length) {
    return false;
  }

  const power =
    randomItem(npc.powers);

  const target =
    chooseNpcTarget(
      room,
      npc
    );

  if (
    !target &&
    [
      "Protection",
      "Steal",
      "Sabotage"
    ].includes(power)
  ) {
    return false;
  }

  if (
    power === "Protection" &&
    target
  ) {
    target.protection = true;

    npc.powers.splice(
      npc.powers.indexOf(power),
      1
    );

    addLog(
      room,
      `${npc.name} protected ${target.name}.`
    );

    return true;
  }

  if (
    power === "Steal" &&
    target
  ) {
    const amount =
      Math.min(
        50,
        target.cash
      );

    target.cash -= amount;

    npc.cash += amount;

    npc.powers.splice(
      npc.powers.indexOf(power),
      1
    );

    addLog(
      room,
      `${npc.name} stole $${amount} from ${target.name}.`
    );

    return true;
  }

  if (
    power === "Sabotage" &&
    target
  ) {
    const amount =
      Math.min(
        50,
        target.cash
      );

    target.cash -= amount;

    npc.powers.splice(
      npc.powers.indexOf(power),
      1
    );

    addLog(
      room,
      `${npc.name} sabotaged ${target.name}, costing $${amount}.`
    );

    return true;
  }

  if (
    power === "Reveal"
  ) {
    const boxes =
      unopenedBoxes(room);

    if (!boxes.length) {
      return false;
    }

    const box =
      randomItem(boxes);

    /*
    The NPC learns this information,
    but it is NOT broadcast as the result
    of the box.
    */

    npc.lastReveal = {
      boxNumber: box.number,
      result: box.result
    };

    npc.powers.splice(
      npc.powers.indexOf(power),
      1
    );

    addLog(
      room,
      `${npc.name} used Reveal on Box ${box.number}.`
    );

    return true;
  }

  if (
    power === "Second Chance"
  ) {
    npc.secondChance = true;

    npc.powers.splice(
      npc.powers.indexOf(power),
      1
    );

    addLog(
      room,
      `${npc.name} activated Second Chance.`
    );

    return true;
  }

  return false;
}

/*
=========================================================
NPC BOX CHOICE
=========================================================
*/

function npcChooseBox(room, npc) {
  const boxes =
    unopenedBoxes(room);

  if (!boxes.length) {
    return null;
  }

  /*
  CRITICAL:

  NPC does NOT inspect box.result.

  It only sees box numbers and which boxes
  have already been opened.
  */

  if (
    npc.personality?.style ===
    "risky"
  ) {
    return randomItem(boxes);
  }

  if (
    npc.personality?.style ===
    "logical"
  ) {
    /*
    The Analyst chooses based on
    available public information only.

    There is NO hidden probability
    attached to individual box numbers.
    */

    return boxes[
      Math.floor(
        boxes.length / 2
      )
    ];
  }

  return randomItem(boxes);
}

/*
=========================================================
OPEN BOX
=========================================================
*/

function openBox(
  room,
  playerId,
  boxNumber
) {
  if (room.finished) {
    return;
  }

  const player =
    room.players.find(
      p => p.id === playerId
    );

  if (
    !player ||
    !player.alive
  ) {
    return;
  }

  const box =
    room.boxes.find(
      b =>
        b.number ===
        Number(boxNumber)
    );

  if (
    !box ||
    box.opened
  ) {
    return;
  }

  box.opened = true;

  player.boxesOpened += 1;

  if (
    box.result === "SAFE"
  ) {
    addLog(
      room,
      `${player.name} opened Box ${box.number}: SAFE.`
    );
  }

  else {
    if (
      player.protection
    ) {
      player.protection =
        false;

      addLog(
        room,
        `${player.name} opened Box ${box.number}: ELIMINATED — but Protection saved them.`
      );
    }

    else if (
      player.secondChance
    ) {
      player.secondChance =
        false;

      addLog(
        room,
        `${player.name} opened Box ${box.number}: ELIMINATED — Second Chance saved them.`
      );
    }

    else {
      player.alive = false;

      addLog(
        room,
        `${player.name} opened Box ${box.number}: ELIMINATED.`
      );
    }
  }

  checkGameEnd(room);

  emitRoom(room);
}

/*
=========================================================
NPC TURN ROTATION
=========================================================
*/

/*
Previously the game always selected NPC #1.

Now we rotate through living NPCs.

This matters because the future AI system needs
each NPC to have its own turn and decisions.
*/

function runNpcTurn(room) {
  if (
    room.finished ||
    room.mode !== "solo"
  ) {
    return;
  }

  const npcs =
    alivePlayers(room)
      .filter(
        player => player.isNPC
      );

  if (!npcs.length) {
    checkGameEnd(room);
    return;
  }

  let index =
    room.lastNpcIndex ?? -1;

  let nextNpc = null;

  for (
    let i = 1;
    i <= npcs.length;
    i++
  ) {
    const candidateIndex =
      (index + i) %
      npcs.length;

    const candidate =
      npcs[candidateIndex];

    if (candidate) {
      nextNpc = candidate;
      room.lastNpcIndex =
        candidateIndex;
      break;
    }
  }

  if (!nextNpc) {
    return;
  }

  const npc = nextNpc;

  /*
  NPC may buy a power.
  */
  if (
    Math.random() < 0.35
  ) {
    npcBuyPower(
      room,
      npc
    );
  }

  /*
  NPC may use a power.
  */
  if (
    Math.random() < 0.35
  ) {
    npcUsePower(
      room,
      npc
    );
  }

  /*
  NPC chooses a box without seeing
  its hidden result.
  */
  const box =
    npcChooseBox(
      room,
      npc
    );

  if (box) {
    openBox(
      room,
      npc.id,
      box.number
    );
  }

  if (!room.finished) {
    setTimeout(() => {
      emitRoom(room);
    }, 300);
  }
}

/*
=========================================================
SOCKET CONNECTIONS
=========================================================
*/

io.on(
  "connection",
  socket => {

    /*
    CREATE ONLINE ROOM
    */

    socket.on(
      "createRoom",
      ({ name }) => {
        if (
          !name ||
          !name.trim()
        ) {
          return;
        }

        const room =
          createRoom(
            socket.id,
            name.trim()
          );

        socket.join(
          room.code
        );

        emitRoom(room);
      }
    );

    /*
    JOIN ONLINE ROOM
    */

    socket.on(
      "joinRoom",
      ({ name, code }) => {
        if (
          !name ||
          !name.trim() ||
          !code
        ) {
          return;
        }

        const room =
          rooms.get(
            code.toUpperCase()
          );

        if (!room) {
          socket.emit(
            "errorMessage",
            "Room not found."
          );

          return;
        }

        if (room.started) {
          socket.emit(
            "errorMessage",
            "Game already started."
          );

          return;
        }

        if (
          room.players.length >=
          16
        ) {
          socket.emit(
            "errorMessage",
            "Room is full."
          );

          return;
        }

        room.players.push(
          createPlayer(
            socket.id,
            name.trim()
          )
        );

        socket.join(
          room.code
        );

        addLog(
          room,
          `${name.trim()} joined the room.`
        );

        emitRoom(room);
      }
    );

    /*
    START ONLINE GAME
    */

    socket.on(
      "startGame",
      () => {

        for (
          const room
          of rooms.values()
        ) {

          if (
            room.hostId !==
            socket.id
          ) {
            continue;
          }

          if (
            room.players.length <
            4
          ) {
            socket.emit(
              "errorMessage",
              "You need at least 4 players to start."
            );

            return;
          }

          /*
          IMPORTANT:

          Generate a fresh board when
          the actual game starts.

          This means the lobby cannot
          influence the board.
          */

          room.boxes =
            createBoxes();

          room.started = true;

          room.finished = false;

          room.currentTurn =
            room.players[0].id;

          addLog(
            room,
            "Game started!"
          );

          addLog(
            room,
            "🎲 A completely new hidden board has been generated."
          );

          emitRoom(room);

          return;
        }
      }
    );

    /*
    CREATE SOLO GAME
    */

    socket.on(
      "createSolo",
      ({ name, npcCount }) => {

        if (
          !name ||
          !name.trim()
        ) {
          return;
        }

        let count =
          Number(npcCount);

        if (
          !Number.isFinite(count)
        ) {
          count = 3;
        }

        count =
          Math.max(
            3,
            Math.min(
              15,
              Math.floor(count)
            )
          );

        const room =
          createSoloRoom(
            socket.id,
            name.trim(),
            count
          );

        socket.join(
          room.code
        );

        emitRoom(room);

        setTimeout(
          () => {
            runNpcTurn(room);
          },
          1200
        );
      }
    );

    /*
    HUMAN OPENS BOX
    */

    socket.on(
      "openBox",
      ({ boxNumber }) => {

        for (
          const room
          of rooms.values()
        ) {

          const player =
            room.players.find(
              p =>
                p.id ===
                socket.id
            );

          if (!player) {
            continue;
          }

          if (
            room.mode ===
              "solo" &&
            player.isNPC
          ) {
            return;
          }

          openBox(
            room,
            socket.id,
            boxNumber
          );

          /*
          After the human's turn,
          NPCs take their turns.
          */

          if (
            room.mode ===
              "solo" &&
            !room.finished
          ) {
            setTimeout(
              () => {
                runNpcTurn(room);
              },
              1000
            );
          }

          return;
        }
      }
    );

    /*
    BUY POWER
    */

    socket.on(
      "buyPower",
      ({ power }) => {

        for (
          const room
          of rooms.values()
        ) {

          const player =
            room.players.find(
              p =>
                p.id ===
                socket.id
            );

          if (
            !player ||
            !room.started ||
            room.finished
          ) {
            continue;
          }

          const definition =
            POWER_DEFINITIONS[
              power
            ];

          if (!definition) {
            return;
          }

          if (
            player.cash <
            definition.cost
          ) {
            socket.emit(
              "errorMessage",
              "Not enough cash."
            );

            return;
          }

          player.cash -=
            definition.cost;

          player.powers.push(
            power
          );

          addLog(
            room,
            `${player.name} bought ${power}.`
          );

          emitRoom(room);

          return;
        }
      }
    );

    /*
    RESET ROOM
    */

    socket.on(
      "resetRoom",
      () => {

        for (
          const [
            code,
            room
          ]
          of rooms.entries()
        ) {

          if (
            room.hostId ===
            socket.id
          ) {

            rooms.delete(
              code
            );

            socket.emit(
              "resetComplete"
            );

            return;
          }
        }
      }
    );

    /*
    DISCONNECT
    */

    socket.on(
      "disconnect",
      () => {

        for (
          const [
            code,
            room
          ]
          of rooms.entries()
        ) {

          const index =
            room.players.findIndex(
              player =>
                player.id ===
                socket.id
            );

          if (
            index === -1
          ) {
            continue;
          }

          const player =
            room.players[index];

          /*
          Solo game currently ends
          when the human disconnects.
          */

          if (
            room.mode ===
            "solo"
          ) {
            rooms.delete(
              code
            );

            continue;
          }

          room.players.splice(
            index,
            1
          );

          addLog(
            room,
            `${player.name} left the game.`
          );

          if (
            room.hostId ===
              socket.id &&
            room.players.length >
              0
          ) {
            room.hostId =
              room.players[0].id;
          }

          emitRoom(room);

          if (
            room.players.length ===
            0
          ) {
            rooms.delete(
              code
            );
          }

          return;
        }
      }
    );
  }
);

/*
=========================================================
SERVER
=========================================================
*/

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `THE BOX server running on port ${PORT}`
    );
  }
);
```
