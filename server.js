{
  "name": "the-box-online",
  "version": "1.0.0",
  "private": true,
  "description": "THE BOX multiplayer social deduction game",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "express": "^4.21.2",
    "socket.io": "^4.8.1"
  }
}
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

const OBJECTIVES = [
  ["NEGOTIATOR", "Make 3 deals with different players; at least 1 must be honored.", 100],
  ["CON ARTIST", "Successfully deceive another player about your objective.", 120],
  ["DIPLOMAT", "Have 2 different players voluntarily defend or protect you.", 100],
  ["RISK TAKER", "Choose 3 unopened boxes and survive the third.", 100],
  ["PROPHET", "Make 2 correct predictions.", 120],
  ["KINGMAKER", "Cause another player to gain $100 through your actions.", 100],
  ["SURVIVOR", "Survive 4 box-opening rounds.", 120],
  ["DEALER", "Exchange money with 3 different players.", 100],
  ["INFLUENCER", "Get 2 players to support your decision.", 100],
  ["GAMBLER", "Spend at least $120 in the Power Store and survive.", 120],
  ["GUARDIAN", "Use Protection on another player.", 100],
  ["SCOUT", "Correctly identify 2 safe boxes before they open.", 120],
  ["SABOTEUR", "Cause another player to lose money through your action.", 100],
  ["LOYALIST", "Honor 2 separate deals.", 120],
  ["SECRET KEEPER", "Keep your objective undisclosed until the final round.", 120],
  ["OPPORTUNIST", "Be the last player to spend money in the store.", 100]
];

const POWERS = {
  Protection: {
    cost: 100,
    desc: "Protect a player from their next elimination."
  },
  Reveal: {
    cost: 80,
    desc: "Privately reveal whether an unopened box is SAFE or ELIMINATED."
  },
  "Second Chance": {
    cost: 120,
    desc: "Return once after elimination with $50."
  },
  Steal: {
    cost: 100,
    desc: "Take $50 from another player."
  },
  Swap: {
    cost: 100,
    desc: "Swap the hidden outcomes of two unopened boxes."
  },
  Prediction: {
    cost: 60,
    desc: "Predict SAFE or ELIMINATED. Correct = +$60."
  },
  Sabotage: {
    cost: 100,
    desc: "Make another player lose $50."
  },
  "Royal Assignment": {
    cost: 120,
    desc: "Choose who takes the next box turn."
  }
};

function shuffle(array) {
  const a = [...array];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function createRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function livingPlayers(room) {
  return room.players.filter(player => player.alive);
}

function findPlayer(room, id) {
  return room.players.find(player => player.id === id);
}

function addLog(room, message) {
  room.log.push(message);

  if (room.log.length > 100) {
    room.log.shift();
  }
}

function publicState(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    turn: room.turn,
    round: room.round,

    boxes: room.boxes.map(box => ({
      num: box.num,
      opened: box.opened,
      outcome: box.opened ? box.outcome : null
    })),

    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      alive: player.alive,
      cash: player.cash,
      protection: player.protection
    })),

    log: room.log.slice(-40),
    winner: room.winner || null
  };
}

function privateState(room, player) {
  return {
    ...publicState(room),

    me: {
      id: player.id,
      name: player.name,
      cash: player.cash,
      alive: player.alive,
      objective: player.objective,
      powers: player.powers,
      protection: player.protection,
      secondChance: player.secondChance
    },

    store: POWERS
  };
}

function broadcast(room) {
  for (const player of room.players) {
    const socket = room.sockets.get(player.id);

    if (socket) {
      socket.emit("state", privateState(room, player));
    }
  }
}

function nextLivingPlayer(room, currentIndex) {
  if (livingPlayers(room).length <= 1) {
    return null;
  }

  let index = currentIndex;

  for (let i = 0; i < room.players.length; i++) {
    index = (index + 1) % room.players.length;

    if (room.players[index].alive) {
      return index;
    }
  }

  return null;
}

function finishGame(room) {
  if (room.status === "finished") {
    return;
  }

  room.status = "finished";

  const survivors = livingPlayers(room);

  if (survivors.length > 0) {
    room.winner = survivors[0].id;
    addLog(room, `🏆 ${survivors[0].name} is the last survivor!`);
  }

  broadcast(room);
}

function startGame(room) {
  const outcomes = shuffle([
    ...Array(11).fill("SAFE"),
    ...Array(5).fill("ELIMINATED")
  ]);

  room.boxes = outcomes.map((outcome, index) => ({
    num: index + 1,
    outcome,
    opened: false
  }));

  room.goldenBox = Math.floor(Math.random() * 16) + 1;

  room.players.forEach((player, index) => {
    player.cash = 100;
    player.alive = true;
    player.protection = false;
    player.secondChance = false;
    player.powers = [];
    player.objective = OBJECTIVES[index % OBJECTIVES.length];
  });

  room.status = "playing";
  room.turn = 0;
  room.round = 1;
  room.log = [];
  room.winner = null;

  addLog(room, "THE BOX has begun. Everyone starts with $100.");

  broadcast(room);
}

function eliminatePlayer(room, player) {
  if (player.protection) {
    player.protection = false;

    addLog(
      room,
      `🛡️ ${player.name} survived with Protection.`
    );

    return;
  }

  if (player.secondChance) {
    player.secondChance = false;
    player.cash = 50;

    addLog(
      room,
      `♻️ ${player.name} used Second Chance and returned with $50.`
    );

    return;
  }

  player.alive = false;

  addLog(
    room,
    `💀 ${player.name} was eliminated.`
  );
}

io.on("connection", socket => {

  socket.on("createRoom", ({ name }, callback) => {

    const code = createRoomCode();

    const player = {
      id: socket.id,
      name: String(name || "Player").slice(0, 18),
      cash: 100,
      alive: true,
      powers: [],
      protection: false,
      secondChance: false,
      objective: null
    };

    const room = {
      code,
      hostId: socket.id,
      status: "lobby",

      players: [player],

      sockets: new Map([
        [socket.id, socket]
      ]),

      boxes: [],
      goldenBox: null,
      turn: 0,
      round: 1,
      log: [],
      winner: null
    };

    rooms.set(code, room);

    socket.join(code);
    socket.data.room = code;

    callback({
      ok: true,
      code
    });

    broadcast(room);
  });


  socket.on("joinRoom", ({ code, name }, callback) => {

    const room = rooms.get(
      String(code || "").toUpperCase()
    );

    if (!room) {
      return callback({
        ok: false,
        error: "Room not found."
      });
    }

    if (room.status !== "lobby") {
      return callback({
        ok: false,
        error: "That game has already started."
      });
    }

    if (room.players.length >= 16) {
      return callback({
        ok: false,
        error: "Room is full."
      });
    }

    const player = {
      id: socket.id,
      name: String(name || "Player").slice(0, 18),
      cash: 100,
      alive: true,
      powers: [],
      protection: false,
      secondChance: false,
      objective: null
    };

    room.players.push(player);
    room.sockets.set(socket.id, socket);

    socket.join(room.code);
    socket.data.room = room.code;

    callback({
      ok: true,
      code: room.code
    });

    broadcast(room);
  });


  socket.on("startGame", () => {

    const room = rooms.get(socket.data.room);

    if (!room) return;

    if (room.hostId !== socket.id) return;

    if (room.players.length < 4) return;

    startGame(room);
  });


  socket.on("openBox", ({ num }) => {

    const room = rooms.get(socket.data.room);

    if (!room) return;

    const player = findPlayer(room, socket.id);

    if (!player) return;

    if (room.status !== "playing") return;

    if (!player.alive) return;

    const currentPlayer = room.players[room.turn];

    if (!currentPlayer || currentPlayer.id !== player.id) {
      return;
    }

    const box = room.boxes.find(
      b => b.num === Number(num)
    );

    if (!box || box.opened) return;

    box.opened = true;

    addLog(
      room,
      `${player.name} opened Box #${box.num}.`
    );

    if (box.num === room.goldenBox) {

      player.cash += 100;

      addLog(
        room,
        `🎁 ${player.name} found the Golden Box and gained $100!`
      );
    }

    if (box.outcome === "SAFE") {

      addLog(
        room,
        `🟢 Box #${box.num} was SAFE.`
      );

    } else {

      addLog(
        room,
        `🔴 Box #${box.num} was ELIMINATED.`
      );

      eliminatePlayer(room, player);
    }

    if (livingPlayers(room).length <= 1) {
      finishGame(room);
      return;
    }

    const next = nextLivingPlayer(
      room,
      room.turn
    );

    if (next !== null) {
      room.turn = next;
      room.round++;
    }

    broadcast(room);
  });


  socket.on("buyPower", ({
    name,
    targetId,
    boxA,
    boxB,
    guess
  }, callback) => {

    const room = rooms.get(socket.data.room);

    if (!room) {
      return callback?.({
        ok: false,
        error: "Room not found."
      });
    }

    const player = findPlayer(
      room,
      socket.id
    );

    const power = POWERS[name];

    if (!player || !power || !player.alive) {
      return callback?.({
        ok: false,
        error: "Invalid action."
      });
    }

    if (player.cash < power.cost) {
      return callback?.({
        ok: false,
        error: "Not enough cash."
      });
    }

    player.cash -= power.cost;
    player.powers.push(name);


    if (name === "Protection") {

      const target = findPlayer(
        room,
        targetId
      );

      if (!target || !target.alive) {
        return callback?.({
          ok: false,
          error: "Choose a living player."
        });
      }

      target.protection = true;

      addLog(
        room,
        `${player.name} bought Protection.`
      );
    }


    else if (name === "Reveal") {

      const box = room.boxes.find(
        b =>
          b.num === Number(boxA) &&
          !b.opened
      );

      if (!box) {
        return callback?.({
          ok: false,
          error: "Choose an unopened box."
        });
      }

      socket.emit(
        "privateInfo",
        {
          type: "reveal",
          text:
            `Box #${box.num} is ${box.outcome}.`
        }
      );

      addLog(
        room,
        `${player.name} bought Reveal.`
      );
    }


    else if (name === "Second Chance") {

      player.secondChance = true;

    }


    else if (name === "Steal") {

      const target = findPlayer(
        room,
        targetId
      );

      if (!target || !target.alive) {
        return callback?.({
          ok: false,
          error: "Choose a living player."
        });
      }

      const amount = Math.min(
        50,
        target.cash
      );

      target.cash -= amount;
      player.cash += amount;

      addLog(
        room,
        `${player.name} used Steal.`
      );
    }


    else if (name === "Swap") {

      const a = room.boxes.find(
        b =>
          b.num === Number(boxA) &&
          !b.opened
      );

      const b = room.boxes.find(
        b =>
          b.num === Number(boxB) &&
          !b.opened
      );

      if (!a || !b || a === b) {
        return callback?.({
          ok: false,
          error:
            "Choose two different unopened boxes."
        });
      }

      [
        a.outcome,
        b.outcome
      ] = [
        b.outcome,
        a.outcome
      ];

      addLog(
        room,
        `${player.name} used Swap.`
      );
    }


    else if (name === "Prediction") {

      const box = room.boxes.find(
        b =>
          b.num === Number(boxA) &&
          !b.opened
      );

      if (
        !box ||
        !["SAFE", "ELIMINATED"].includes(
          guess
        )
      ) {
        return callback?.({
          ok: false,
          error:
            "Choose a box and prediction."
        });
      }

      if (box.outcome === guess) {

        player.cash += 60;

        addLog(
          room,
          `🔮 ${player.name} made a correct prediction and gained $60.`
        );

      } else {

        addLog(
          room,
          `🔮 ${player.name} made an incorrect prediction.`
        );
      }
    }


    else if (name === "Sabotage") {

      const target = findPlayer(
        room,
        targetId
      );

      if (!target || !target.alive) {
        return callback?.({
          ok: false,
          error: "Choose a living player."
        });
      }

      const amount = Math.min(
        50,
        target.cash
      );

      target.cash -= amount;

      addLog(
        room,
        `${player.name} used Sabotage.`
      );
    }


    else if (name === "Royal Assignment") {

      const target = findPlayer(
        room,
        targetId
      );

      if (!target || !target.alive) {
        return callback?.({
          ok: false,
          error: "Choose a living player."
        });
      }

      room.turn = room.players.findIndex(
        p => p.id === target.id
      );

      addLog(
        room,
        `${player.name} assigned ${target.name} to take the next box.`
      );
    }

    callback?.({
      ok: true
    });

    broadcast(room);
  });


  socket.on("resetRoom", () => {

    const room = rooms.get(
      socket.data.room
    );

    if (!room) return;

    if (room.hostId !== socket.id) {
      return;
    }

    room.status = "lobby";
    room.boxes = [];
    room.log = [];
    room.winner = null;

    room.players.forEach(player => {

      player.cash = 100;
      player.alive = true;
      player.powers = [];
      player.objective = null;
      player.protection = false;
      player.secondChance = false;

    });

    broadcast(room);
  });


  socket.on("disconnect", () => {

    const roomCode = socket.data.room;

    const room = rooms.get(roomCode);

    if (!room) return;

    room.sockets.delete(socket.id);

    if (room.status === "lobby") {

      room.players =
        room.players.filter(
          player =>
            player.id !== socket.id
        );

      if (room.hostId === socket.id) {

        room.hostId =
          room.players[0]?.id;

      }

      broadcast(room);
    }
  });

});


const PORT =
  process.env.PORT || 10000;

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `THE BOX running on port ${PORT}`
    );
  }
);
