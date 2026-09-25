const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;
const rooms = new Map();

/* =========================================================
   THE BOX
========================================================= */

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
  { name: "GAMBLER", text: "Spend at least $120 in Power Store and survive.", reward: 120 },
  { name: "GUARDIAN", text: "Use Protection on another player.", reward: 100 },
  { name: "SCOUT", text: "Correctly identify 2 safe boxes before they open.", reward: 120 },
  { name: "SABOTEUR", text: "Cause another player to lose money through your action.", reward: 100 },
  { name: "LOYALIST", text: "Honor 2 separate deals.", reward: 120 },
  { name: "SECRET KEEPER", text: "Keep objective undisclosed until final round.", reward: 120 },
  { name: "OPPORTUNIST", text: "Be last player to spend money in store.", reward: 100 }
];

const POWER_DEFINITIONS = {
  Protection: {
    cost: 60,
    description: "Protect another player from one elimination."
  },

  Reveal: {
    cost: 60,
    description: "Privately reveal whether an unopened box is SAFE or ELIMINATED."
  },

  "Second Chance": {
    cost: 60,
    description: "Activate on yourself to survive one elimination."
  },

  Steal: {
    cost: 60,
    description: "Steal up to $50 from another player."
  },

  Swap: {
    cost: 60,
    description: "Swap the hidden contents of two unopened boxes."
  },

  Prediction: {
    cost: 60,
    description: "Predict whether an unopened box is SAFE or ELIMINATED."
  },

  Sabotage: {
    cost: 60,
    description: "Cause another player to lose up to $50."
  },

  "Royal Assignment": {
    cost: 60,
    description: "Choose who must take the next turn."
  }
};

/* =========================================================
   NPC PERSONALITIES
========================================================= */

const PERSONALITIES = [
  {
    name: "The Gambler",
    style: "risky",
    riskTolerance: 0.9,
    trust: 0.35,
    aggression: 0.75,
    greed: 0.8
  },

  {
    name: "The Analyst",
    style: "logical",
    riskTolerance: 0.25,
    trust: 0.55,
    aggression: 0.35,
    greed: 0.5
  },

  {
    name: "The Opportunist",
    style: "opportunistic",
    riskTolerance: 0.6,
    trust: 0.3,
    aggression: 0.65,
    greed: 0.9
  }
];

/* =========================================================
   RANDOM HELPERS
========================================================= */

function randomItem(array) {
  if (!array || !array.length) {
    return null;
  }

  return array[
    crypto.randomInt(0, array.length)
  ];
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);

    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }

  return result;
}

/* =========================================================
   RANDOM BOARD
========================================================= */

function createBoxes() {
  const results = [];

  for (let i = 0; i < 11; i++) {
    results.push("SAFE");
  }

  for (let i = 0; i < 5; i++) {
    results.push("ELIMINATED");
  }

  const randomizedResults = shuffle(results);

  return randomizedResults.map(
    function (result, index) {
      return {
        number: index + 1,
        result: result,
        opened: false
      };
    }
  );
}

/* =========================================================
   PLAYERS
========================================================= */

function createPlayer(
  id,
  name,
  isNPC,
  personality
) {
  return {
    id: id,
    name: name,

    isNPC: isNPC || false,
    personality: personality || null,

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

    relationships: {},

    dealsMade: 0,
    dealsHonored: 0,
    dealsBroken: 0,

    /*
      Private information learned
      legitimately through Reveal.
    */

    reveals: []
  };
}

/* =========================================================
   ROOMS
========================================================= */

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

function createRoom(
  hostId,
  hostName
) {
  const code = generateRoomCode();

  const room = {
    code: code,

    hostId: hostId,

    mode: "online",

    started: false,
    finished: false,

    goldenBox:
      crypto.randomInt(1, 17),

    boxes: createBoxes(),

    currentTurn: null,
    turnIndex: 0,

    /*
      Royal Assignment stores
      the player who should take
      the next turn.
    */

    forcedNextPlayerId: null,

    log: [],

    players: [],

    deals: [],
    dealCounter: 0
  };

  room.players.push(
    createPlayer(
      hostId,
      hostName,
      false,
      null
    )
  );

  rooms.set(code, room);

  return room;
}

function createSoloRoom(
  socketId,
  playerName,
  npcCount
) {
  const code = generateRoomCode();

  const room = {
    code: code,

    hostId: socketId,

    mode: "solo",

    started: true,
    finished: false,

    goldenBox:
      crypto.randomInt(1, 17),

    boxes: createBoxes(),

    currentTurn: socketId,
    turnIndex: 0,

    forcedNextPlayerId: null,

    log: [],

    players: [],

    deals: [],
    dealCounter: 0
  };

  room.players.push(
    createPlayer(
      socketId,
      playerName,
      false,
      null
    )
  );

  for (
    let i = 0;
    i < npcCount;
    i++
  ) {
    const personality =
      PERSONALITIES[
        i %
        PERSONALITIES.length
      ];

    const npcId =
      "npc-" +
      i +
      "-" +
      Date.now() +
      "-" +
      crypto.randomBytes(4).toString("hex");

    const npcName =
      personality.name +
      " " +
      (i + 1);

    room.players.push(
      createPlayer(
        npcId,
        npcName,
        true,
        personality
      )
    );
  }

  rooms.set(code, room);

  addLog(
    room,
    "Solo Test started with " +
      room.players.length +
      " players."
  );

  addLog(
    room,
    "A completely new hidden board has been generated."
  );

  addLog(
    room,
    "It is now " +
      room.players[0].name +
      "'s turn."
  );

  return room;
}

/* =========================================================
   BASIC STATE HELPERS
========================================================= */

function alivePlayers(room) {
  return room.players.filter(
    function (player) {
      return player.alive;
    }
  );
}

function unopenedBoxes(room) {
  return room.boxes.filter(
    function (box) {
      return !box.opened;
    }
  );
}

function addLog(
  room,
  message
) {
  room.log.push(message);

  if (room.log.length > 100) {
    room.log.shift();
  }
}

function getPlayer(
  room,
  id
) {
  return room.players.find(
    function (player) {
      return player.id === id;
    }
  );
}

function getCurrentPlayer(room) {
  return getPlayer(
    room,
    room.currentTurn
  );
}

function findRoomByPlayerId(
  playerId
) {
  for (
    const room
    of rooms.values()
  ) {
    if (
      getPlayer(
        room,
        playerId
      )
    ) {
      return room;
    }
  }

  return null;
}

function removePower(
  player,
  power
) {
  const index =
    player.powers.indexOf(power);

  if (index === -1) {
    return false;
  }

  player.powers.splice(
    index,
    1
  );

  return true;
}

function ownsPower(
  player,
  power
) {
  return (
    player.powers.indexOf(power) !== -1
  );
}

/* =========================================================
   DEAL HELPERS
========================================================= */

function getDealById(
  room,
  dealId
) {
  return room.deals.find(
    function (deal) {
      return deal.id === dealId;
    }
  );
}

function getVisibleDeals(
  room,
  playerId
) {
  return room.deals
    .filter(
      function (deal) {
        return (
          deal.proposerId === playerId ||
          deal.recipientId === playerId
        );
      }
    )
    .map(
      function (deal) {
        const proposer =
          getPlayer(
            room,
            deal.proposerId
          );

        const recipient =
          getPlayer(
            room,
            deal.recipientId
          );

        return {
          id: deal.id,

          proposerId:
            deal.proposerId,

          proposerName:
            proposer
              ? proposer.name
              : "Unknown",

          recipientId:
            deal.recipientId,

          recipientName:
            recipient
              ? recipient.name
              : "Unknown",

          offer: deal.offer,
          request: deal.request,

          status: deal.status,

          createdAt:
            deal.createdAt,

          round:
            deal.round
        };
      }
    );
}

function getDealDescription(
  deal,
  room
) {
  const proposer =
    getPlayer(
      room,
      deal.proposerId
    );

  const recipient =
    getPlayer(
      room,
      deal.recipientId
    );

  if (
    !proposer ||
    !recipient
  ) {
    return "Deal";
  }

  let description =
    proposer.name +
    " offers ";

  if (
    deal.offer.type === "money"
  ) {
    description +=
      "$" +
      deal.offer.amount;
  } else if (
    deal.offer.type === "protection"
  ) {
    description +=
      "Protection";
  } else {
    description +=
      "nothing";
  }

  description +=
    " to " +
    recipient.name +
    " in exchange for ";

  if (
    deal.request.type === "money"
  ) {
    description +=
      "$" +
      deal.request.amount;
  } else if (
    deal.request.type === "protection"
  ) {
    description +=
      "Protection";
  } else {
    description +=
      "nothing";
  }

  return description;
}

function updateRelationship(
  room,
  fromId,
  toId,
  amount
) {
  const fromPlayer =
    getPlayer(
      room,
      fromId
    );

  if (!fromPlayer) {
    return;
  }

  if (
    !fromPlayer.relationships[toId]
  ) {
    fromPlayer.relationships[toId] = {
      trust: 50,
      favors: 0,
      betrayals: 0
    };
  }

  fromPlayer.relationships[
    toId
  ].trust += amount;

  fromPlayer.relationships[
    toId
  ].trust =
    Math.max(
      0,
      Math.min(
        100,
        fromPlayer.relationships[
          toId
        ].trust
      )
    );
}

/* =========================================================
   CREATE DEAL
========================================================= */

function createDeal(
  room,
  proposerId,
  recipientId,
  offer,
  request
) {
  const proposer =
    getPlayer(
      room,
      proposerId
    );

  const recipient =
    getPlayer(
      room,
      recipientId
    );

  if (
    !proposer ||
    !recipient
  ) {
    return null;
  }

  if (
    !proposer.alive ||
    !recipient.alive
  ) {
    return null;
  }

  if (
    proposerId ===
    recipientId
  ) {
    return null;
  }

  if (
    !offer ||
    !request
  ) {
    return null;
  }

  if (
    offer.type === "money" &&
    (
      !Number.isFinite(
        offer.amount
      ) ||
      offer.amount <= 0 ||
      offer.amount >
        proposer.cash
    )
  ) {
    return null;
  }

  if (
    request.type === "money" &&
    (
      !Number.isFinite(
        request.amount
      ) ||
      request.amount <= 0
    )
  ) {
    return null;
  }

  room.dealCounter += 1;

  const deal = {
    id:
      "deal-" +
      room.dealCounter +
      "-" +
      Date.now(),

    proposerId:
      proposerId,

    recipientId:
      recipientId,

    offer:
      offer,

    request:
      request,

    status:
      "pending",

    createdAt:
      Date.now(),

    round:
      room.boxes.filter(
        function (box) {
          return box.opened;
        }
      ).length + 1
  };

  room.deals.push(deal);

  proposer.dealsMade += 1;

  addLog(
    room,
    "🤝 " +
      proposer.name +
      " proposed a deal to " +
      recipient.name +
      "."
  );

  return deal;
}

/* =========================================================
   ACCEPT DEAL
========================================================= */

function acceptDeal(
  room,
  dealId,
  playerId
) {
  const deal =
    getDealById(
      room,
      dealId
    );

  if (!deal) {
    return {
      success: false,
      message: "Deal not found."
    };
  }

  if (
    deal.status !== "pending"
  ) {
    return {
      success: false,
      message:
        "This deal is no longer available."
    };
  }

  if (
    deal.recipientId !==
    playerId
  ) {
    return {
      success: false,
      message:
        "You cannot accept this deal."
    };
  }

  const proposer =
    getPlayer(
      room,
      deal.proposerId
    );

  const recipient =
    getPlayer(
      room,
      deal.recipientId
    );

  if (
    !proposer ||
    !recipient
  ) {
    return {
      success: false,
      message:
        "Player no longer exists."
    };
  }

  if (
    !proposer.alive ||
    !recipient.alive
  ) {
    return {
      success: false,
      message:
        "Both players must be alive."
    };
  }

  if (
    deal.offer.type ===
    "money"
  ) {
    if (
      proposer.cash <
      deal.offer.amount
    ) {
      deal.status =
        "broken";

      proposer.dealsBroken += 1;

      addLog(
        room,
        "❌ " +
          proposer.name +
          " could no longer afford their deal."
      );

      return {
        success: false,
        message:
          "The proposer can no longer afford the offer."
      };
    }

    proposer.cash -=
      deal.offer.amount;

    recipient.cash +=
      deal.offer.amount;
  }

  if (
    deal.request.type ===
    "money"
  ) {
    if (
      recipient.cash <
      deal.request.amount
    ) {
      deal.status =
        "declined";

      addLog(
        room,
        "❌ " +
          recipient.name +
          " could not afford the requested payment."
      );

      return {
        success: false,
        message:
          "You cannot afford the requested payment."
      };
    }

    recipient.cash -=
      deal.request.amount;

    proposer.cash +=
      deal.request.amount;
  }

  deal.status =
    "accepted";

  addLog(
    room,
    "🤝 " +
      getDealDescription(
        deal,
        room
      ) +
      " — ACCEPTED."
  );

  updateRelationship(
    room,
    recipient.id,
    proposer.id,
    5
  );

  updateRelationship(
    room,
    proposer.id,
    recipient.id,
    5
  );

  return {
    success: true
  };
}

/* =========================================================
   DECLINE DEAL
========================================================= */

function declineDeal(
  room,
  dealId,
  playerId
) {
  const deal =
    getDealById(
      room,
      dealId
    );

  if (!deal) {
    return false;
  }

  if (
    deal.status !==
      "pending" ||
    deal.recipientId !==
      playerId
  ) {
    return false;
  }

  deal.status =
    "declined";

  const recipient =
    getPlayer(
      room,
      playerId
    );

  addLog(
    room,
    "❌ " +
      (
        recipient
          ? recipient.name
          : "Player"
      ) +
      " declined a deal."
  );

  return true;
}

/* =========================================================
   NPC DEAL DECISION
========================================================= */

function npcDealAccepts(
  room,
  npc,
  deal
) {
  const proposer =
    getPlayer(
      room,
      deal.proposerId
    );

  if (!proposer) {
    return false;
  }

  let score = 0;

  if (
    deal.offer.type ===
    "money"
  ) {
    score +=
      Math.min(
        50,
        deal.offer.amount / 2
      );
  }

  if (
    deal.offer.type ===
    "protection"
  ) {
    if (
      npc.personality &&
      npc.personality
        .riskTolerance < 0.5
    ) {
      score += 35;
    } else {
      score += 20;
    }
  }

  if (
    deal.request.type ===
    "money"
  ) {
    score -=
      deal.request.amount / 2;
  }

  if (
    deal.request.type ===
    "protection"
  ) {
    score -= 25;
  }

  if (
    npc.personality &&
    npc.personality.greed >
      0.7 &&
    deal.offer.type ===
      "money"
  ) {
    score += 20;
  }

  if (
    npc.relationships[
      proposer.id
    ]
  ) {
    score +=
      (
        npc.relationships[
          proposer.id
        ].trust -
        50
      ) *
      0.5;
  }

  score +=
    Math.random() * 30 -
    15;

  return score >= 10;
}

/* =========================================================
   NPC PROPOSALS
========================================================= */

function npcMakeDeal(
  room,
  npc
) {
  if (
    room.finished ||
    !npc ||
    !npc.alive
  ) {
    return false;
  }

  const targets =
    alivePlayers(room).filter(
      function (player) {
        return (
          player.id !==
          npc.id
        );
      }
    );

  if (!targets.length) {
    return false;
  }

  const target =
    randomItem(targets);

  let offer;
  let request;

  if (
    npc.personality &&
    npc.personality.style ===
      "risky"
  ) {
    const amount =
      Math.min(
        40,
        Math.max(
          10,
          npc.cash
        )
      );

    offer = {
      type: "money",
      amount: amount
    };

    request = {
      type: "money",
      amount:
        Math.max(
          10,
          amount + 20
        )
    };
  } else if (
    npc.personality &&
    npc.personality.style ===
      "logical"
  ) {
    if (
      npc.cash >= 10
    ) {
      offer = {
        type: "money",
        amount:
          Math.min(
            30,
            npc.cash
          )
      };
    } else {
      offer = {
        type: "protection"
      };
    }

    request = {
      type: "protection"
    };
  } else {
    if (
      npc.cash >= 30
    ) {
      offer = {
        type: "money",
        amount: 20
      };
    } else {
      offer = {
        type: "protection"
      };
    }

    request =
      Math.random() < 0.5
        ? {
            type: "money",
            amount: 40
          }
        : {
            type: "protection"
          };
  }

  if (
    offer.type === "money" &&
    offer.amount >
      npc.cash
  ) {
    return false;
  }

  const deal =
    createDeal(
      room,
      npc.id,
      target.id,
      offer,
      request
    );

  if (!deal) {
    return false;
  }

  if (
    target.isNPC
  ) {
    setTimeout(
      function () {
        if (
          room.finished ||
          deal.status !==
            "pending"
        ) {
          return;
        }

        const accepts =
          npcDealAccepts(
            room,
            target,
            deal
          );

        if (accepts) {
          acceptDeal(
            room,
            deal.id,
            target.id
          );

          addLog(
            room,
            "🤖 " +
              target.name +
              " accepted " +
              npc.name +
              "'s deal."
          );
        } else {
          declineDeal(
            room,
            deal.id,
            target.id
          );

          addLog(
            room,
            "🤖 " +
              target.name +
              " rejected " +
              npc.name +
              "'s deal."
          );
        }

        emitRoom(room);
      },
      700
    );
  }

  return true;
}

/* =========================================================
   POWER HELPERS
========================================================= */

function validLivingTarget(
  room,
  user,
  targetId,
  allowSelf
) {
  const target =
    getPlayer(
      room,
      targetId
    );

  if (
    !target ||
    !target.alive
  ) {
    return null;
  }

  if (
    !allowSelf &&
    target.id ===
      user.id
  ) {
    return null;
  }

  return target;
}

function validUnopenedBox(
  room,
  boxNumber
) {
  const number =
    Number(boxNumber);

  if (
    !Number.isInteger(number)
  ) {
    return null;
  }

  const box =
    room.boxes.find(
      function (item) {
        return (
          item.number ===
          number
        );
      }
    );

  if (
    !box ||
    box.opened
  ) {
    return null;
  }

  return box;
}

/* =========================================================
   PROTECTION DEAL FULFILLMENT
========================================================= */

function fulfillProtectionDeals(
  room,
  protectorId,
  targetId
) {
  room.deals.forEach(
    function (deal) {
      if (
        deal.status !==
        "accepted"
      ) {
        return;
      }

      let fulfilled = false;

      /*
        Proposer promised protection
        to recipient.
      */

      if (
        deal.proposerId ===
          protectorId &&
        deal.recipientId ===
          targetId &&
        deal.offer &&
        deal.offer.type ===
          "protection"
      ) {
        fulfilled = true;
      }

      /*
        Recipient promised protection
        to proposer.
      */

      if (
        deal.recipientId ===
          protectorId &&
        deal.proposerId ===
          targetId &&
        deal.request &&
        deal.request.type ===
          "protection"
      ) {
        fulfilled = true;
      }

      if (!fulfilled) {
        return;
      }

      deal.status =
        "honored";

      const protector =
        getPlayer(
          room,
          protectorId
        );

      if (protector) {
        protector.dealsHonored +=
          1;
      }

      updateRelationship(
        room,
        targetId,
        protectorId,
        15
      );

      addLog(
        room,
        "🤝 " +
          (
            protector
              ? protector.name
              : "A player"
          ) +
          " honored a Protection deal."
      );
    }
  );
}

/* =========================================================
   HUMAN POWER ENGINE
========================================================= */

function usePower(
  room,
  player,
  power,
  data
) {
  if (
    !room.started ||
    room.finished
  ) {
    return {
      success: false,
      message:
        "Powers cannot be used right now."
    };
  }

  if (
    !player ||
    !player.alive
  ) {
    return {
      success: false,
      message:
        "Eliminated players cannot use powers."
    };
  }

  if (
    !POWER_DEFINITIONS[
      power
    ]
  ) {
    return {
      success: false,
      message:
        "Unknown power."
    };
  }

  if (
    !ownsPower(
      player,
      power
    )
  ) {
    return {
      success: false,
      message:
        "You do not own that power."
    };
  }

  /* -------------------------
     PROTECTION
  ------------------------- */

  if (
    power ===
    "Protection"
  ) {
    const target =
      validLivingTarget(
        room,
        player,
        data.targetId,
        false
      );

    if (!target) {
      return {
        success: false,
        message:
          "Choose another living player."
      };
    }

    if (
      target.protection
    ) {
      return {
        success: false,
        message:
          "That player is already protected."
      };
    }

    target.protection =
      true;

    removePower(
      player,
      power
    );

    addLog(
      room,
      "🛡️ " +
        player.name +
        " protected " +
        target.name +
        "."
    );

    fulfillProtectionDeals(
      room,
      player.id,
      target.id
    );

    return {
      success: true
    };
  }

  /* -------------------------
     REVEAL
  ------------------------- */

  if (
    power ===
    "Reveal"
  ) {
    const box =
      validUnopenedBox(
        room,
        data.boxNumber
      );

    if (!box) {
      return {
        success: false,
        message:
          "Choose an unopened box."
      };
    }

    removePower(
      player,
      power
    );

    player.reveals.push({
      boxNumber:
        box.number,

      result:
        box.result,

      createdAt:
        Date.now()
    });

    /*
      The public log DOES NOT
      contain the hidden result.
    */

    addLog(
      room,
      "👁️ " +
        player.name +
        " used Reveal on Box " +
        box.number +
        "."
    );

    return {
      success: true,

      privateMessage:
        "👁 REVEAL — Box " +
        box.number +
        " is " +
        box.result +
        "."
    };
  }

  /* -------------------------
     SECOND CHANCE
  ------------------------- */

  if (
    power ===
    "Second Chance"
  ) {
    if (
      player.secondChance
    ) {
      return {
        success: false,
        message:
          "Second Chance is already active."
      };
    }

    player.secondChance =
      true;

    removePower(
      player,
      power
    );

    addLog(
      room,
      "🔄 " +
        player.name +
        " activated Second Chance."
    );

    return {
      success: true,

      privateMessage:
        "🔄 Second Chance is active. Your next elimination will be blocked."
    };
  }

  /* -------------------------
     STEAL
  ------------------------- */

  if (
    power ===
    "Steal"
  ) {
    const target =
      validLivingTarget(
        room,
        player,
        data.targetId,
        false
      );

    if (!target) {
      return {
        success: false,
        message:
          "Choose another living player."
      };
    }

    const amount =
      Math.min(
        50,
        target.cash
      );

    target.cash -=
      amount;

    player.cash +=
      amount;

    removePower(
      player,
      power
    );

    addLog(
      room,
      "💰 " +
        player.name +
        " stole $" +
        amount +
        " from " +
        target.name +
        "."
    );

    return {
      success: true
    };
  }

  /* -------------------------
     SABOTAGE
  ------------------------- */

  if (
    power ===
    "Sabotage"
  ) {
    const target =
      validLivingTarget(
        room,
        player,
        data.targetId,
        false
      );

    if (!target) {
      return {
        success: false,
        message:
          "Choose another living player."
      };
    }

    const amount =
      Math.min(
        50,
        target.cash
      );

    target.cash -=
      amount;

    removePower(
      player,
      power
    );

    addLog(
      room,
      "💥 " +
        player.name +
        " sabotaged " +
        target.name +
        " for $" +
        amount +
        "."
    );

    return {
      success: true
    };
  }

  /* -------------------------
     SWAP
  ------------------------- */

  if (
    power ===
    "Swap"
  ) {
    const firstBox =
      validUnopenedBox(
        room,
        data.boxNumber
      );

    const secondBox =
      validUnopenedBox(
        room,
        data.secondBoxNumber
      );

    if (
      !firstBox ||
      !secondBox
    ) {
      return {
        success: false,
        message:
          "Choose two unopened boxes."
      };
    }

    if (
      firstBox.number ===
      secondBox.number
    ) {
      return {
        success: false,
        message:
          "Choose two different boxes."
      };
    }

    /*
      IMPORTANT:
      We swap the actual hidden
      outcomes.

      This means information from
      an earlier Reveal may become
      outdated, which is intentional.
    */

    const temporaryResult =
      firstBox.result;

    firstBox.result =
      secondBox.result;

    secondBox.result =
      temporaryResult;

    removePower(
      player,
      power
    );

    addLog(
      room,
      "🔀 " +
        player.name +
        " swapped the hidden contents of Box " +
        firstBox.number +
        " and Box " +
        secondBox.number +
        "."
    );

    return {
      success: true,

      privateMessage:
        "🔀 Box " +
        firstBox.number +
        " and Box " +
        secondBox.number +
        " have been swapped."
    };
  }

  /* -------------------------
     PREDICTION
  ------------------------- */

  if (
    power ===
    "Prediction"
  ) {
    const box =
      validUnopenedBox(
        room,
        data.boxNumber
      );

    if (!box) {
      return {
        success: false,
        message:
          "Choose an unopened box."
      };
    }

    const prediction =
      String(
        data.prediction || ""
      ).toUpperCase();

    if (
      prediction !==
        "SAFE" &&
      prediction !==
        "ELIMINATED"
    ) {
      return {
        success: false,
        message:
          "Prediction must be SAFE or ELIMINATED."
      };
    }

    const existingPrediction =
      player.predictions.find(
        function (item) {
          return (
            item.boxNumber ===
              box.number &&
            !item.resolved
          );
        }
      );

    if (
      existingPrediction
    ) {
      return {
        success: false,
        message:
          "You already predicted this box."
      };
    }

    player.predictions.push({
      boxNumber:
        box.number,

      prediction:
        prediction,

      resolved:
        false,

      correct:
        null,

      createdAt:
        Date.now()
    });

    removePower(
      player,
      power
    );

    /*
      The prediction itself remains
      private.
    */

    addLog(
      room,
      "🔮 " +
        player.name +
        " made a prediction about Box " +
        box.number +
        "."
    );

    return {
      success: true,

      privateMessage:
        "🔮 Prediction locked: Box " +
        box.number +
        " = " +
        prediction +
        "."
    };
  }

  /* -------------------------
     ROYAL ASSIGNMENT
  ------------------------- */

  if (
    power ===
    "Royal Assignment"
  ) {
    const target =
      validLivingTarget(
        room,
        player,
        data.targetId,
        false
      );

    if (!target) {
      return {
        success: false,
        message:
          "Choose another living player."
      };
    }

    /*
      This does not interrupt the
      current player's turn.

      Instead, it overrides the
      NEXT turn.
    */

    room.forcedNextPlayerId =
      target.id;

    removePower(
      player,
      power
    );

    addLog(
      room,
      "👑 " +
        player.name +
        " used Royal Assignment. " +
        target.name +
        " must take the next turn."
    );

    return {
      success: true
    };
  }

  return {
    success: false,
    message:
      "Unable to use that power."
  };
}

/* =========================================================
   PREDICTION RESOLUTION
========================================================= */

function resolvePredictions(
  room,
  openedBox
) {
  room.players.forEach(
    function (player) {
      player.predictions.forEach(
        function (prediction) {
          if (
            prediction.resolved ||
            prediction.boxNumber !==
              openedBox.number
          ) {
            return;
          }

          prediction.resolved =
            true;

          prediction.correct =
            prediction.prediction ===
            openedBox.result;

          if (
            prediction.correct
          ) {
            player.correctPredictions +=
              1;
          }

          /*
            Humans receive their
            own private result.
          */

          if (
            !player.isNPC
          ) {
            io.to(
              player.id
            ).emit(
              "privateMessage",
              prediction.correct
                ? (
                    "🔮 Correct! Your prediction for Box " +
                    openedBox.number +
                    " was right."
                  )
                : (
                    "🔮 Incorrect. Your prediction for Box " +
                    openedBox.number +
                    " was " +
                    prediction.prediction +
                    "."
                  )
            );
          }
        }
      );
    }
  );
}

/* =========================================================
   PUBLIC / PRIVATE STATE
========================================================= */

function getPublicState(room) {
  return {
    code: room.code,

    mode: room.mode,

    started: room.started,

    finished:
      room.finished,

    goldenBox:
      room.finished
        ? room.goldenBox
        : null,

    currentTurn:
      room.currentTurn,

    turnIndex:
      room.turnIndex,

    boxesRemaining:
      unopenedBoxes(room).length,

    totalPlayers:
      room.players.length,

    alivePlayers:
      alivePlayers(room).length,

    players:
      room.players.map(
        function (player) {
          return {
            id: player.id,
            name: player.name,

            isNPC:
              player.isNPC,

            personality:
              player.isNPC &&
              player.personality
                ? player.personality.name
                : null,

            cash:
              player.cash,

            alive:
              player.alive,

            /*
              Other players can see
              power ownership for now,
              preserving your existing
              game behavior.
            */

            powers:
              player.powers,

            protection:
              player.protection,

            secondChance:
              player.secondChance,

            dealsMade:
              player.dealsMade,

            dealsHonored:
              player.dealsHonored,

            dealsBroken:
              player.dealsBroken
          };
        }
      ),

    boxes:
      room.boxes.map(
        function (box) {
          return {
            number:
              box.number,

            opened:
              box.opened,

            result:
              box.opened
                ? box.result
                : null,

            isGolden:
              room.finished
                ? (
                    box.number ===
                    room.goldenBox
                  )
                : false
          };
        }
      ),

    log:
      room.log
  };
}

function getPrivateState(
  room,
  playerId
) {
  const player =
    getPlayer(
      room,
      playerId
    );

  if (!player) {
    return null;
  }

  return {
    ...getPublicState(room),

    you: {
      id:
        player.id,

      name:
        player.name,

      cash:
        player.cash,

      alive:
        player.alive,

      powers:
        player.powers,

      protection:
        player.protection,

      secondChance:
        player.secondChance,

      objective:
        player.objective,

      objectiveComplete:
        player.objectiveComplete,

      boxesOpened:
        player.boxesOpened,

      correctPredictions:
        player.correctPredictions,

      dealsMade:
        player.dealsMade,

      dealsHonored:
        player.dealsHonored,

      dealsBroken:
        player.dealsBroken,

      /*
        Reveal knowledge is PRIVATE.
      */

      reveals:
        player.reveals,

      predictions:
        player.predictions
    },

    deals:
      getVisibleDeals(
        room,
        playerId
      )
  };
}

function emitRoom(room) {
  room.players.forEach(
    function (player) {
      if (
        !player.isNPC
      ) {
        io.to(
          player.id
        ).emit(
          "state",
          getPrivateState(
            room,
            player.id
          )
        );
      }
    }
  );
}

/* =========================================================
   TURN SYSTEM
========================================================= */

function getNextAlivePlayer(room) {
  /*
    Royal Assignment gets priority.
  */

  if (
    room.forcedNextPlayerId
  ) {
    const forcedPlayer =
      getPlayer(
        room,
        room.forcedNextPlayerId
      );

    room.forcedNextPlayerId =
      null;

    if (
      forcedPlayer &&
      forcedPlayer.alive
    ) {
      const index =
        room.players.findIndex(
          function (player) {
            return (
              player.id ===
              forcedPlayer.id
            );
          }
        );

      if (
        index !== -1
      ) {
        room.turnIndex =
          index;
      }

      room.currentTurn =
        forcedPlayer.id;

      return forcedPlayer;
    }
  }

  const startIndex =
    room.turnIndex;

  for (
    let i = 1;
    i <= room.players.length;
    i++
  ) {
    const index =
      (
        startIndex +
        i
      ) %
      room.players.length;

    const player =
      room.players[index];

    if (
      player &&
      player.alive
    ) {
      room.turnIndex =
        index;

      room.currentTurn =
        player.id;

      return player;
    }
  }

  return null;
}

function advanceTurn(room) {
  if (
    room.finished
  ) {
    return null;
  }

  const nextPlayer =
    getNextAlivePlayer(room);

  if (!nextPlayer) {
    return null;
  }

  addLog(
    room,
    "It is now " +
      nextPlayer.name +
      "'s turn."
  );

  if (
    room.mode === "solo" &&
    nextPlayer.isNPC &&
    Math.random() < 0.45
  ) {
    npcMakeDeal(
      room,
      nextPlayer
    );
  }

  emitRoom(room);

  if (
    room.mode === "solo" &&
    nextPlayer.isNPC
  ) {
    setTimeout(
      function () {
        runNpcTurn(room);
      },
      1200
    );
  }

  return nextPlayer;
}

/* =========================================================
   GAME END
========================================================= */

function finishGame(room) {
  if (
    room.finished
  ) {
    return;
  }

  room.finished =
    true;

  room.forcedNextPlayerId =
    null;

  room.deals.forEach(
    function (deal) {
      if (
        deal.status ===
        "pending"
      ) {
        deal.status =
          "expired";
      }
    }
  );

  const survivors =
    alivePlayers(room);

  if (
    survivors.length === 1
  ) {
    addLog(
      room,
      "🏆 " +
        survivors[0].name +
        " is the final survivor!"
    );
  } else if (
    survivors.length > 1
  ) {
    addLog(
      room,
      "🏆 Game finished. Survivors: " +
        survivors
          .map(
            function (player) {
              return player.name;
            }
          )
          .join(", ")
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
    alivePlayers(room).length <=
    1
  ) {
    finishGame(room);

    return true;
  }

  if (
    unopenedBoxes(room).length ===
    0
  ) {
    finishGame(room);

    return true;
  }

  return false;
}

/* =========================================================
   NPC TARGETING
========================================================= */

function chooseNpcTarget(
  room,
  npc
) {
  const candidates =
    alivePlayers(room).filter(
      function (player) {
        return (
          player.id !==
          npc.id
        );
      }
    );

  if (
    !candidates.length
  ) {
    return null;
  }

  if (
    npc.personality &&
    npc.personality.style ===
      "logical"
  ) {
    return candidates
      .slice()
      .sort(
        function (a, b) {
          return (
            b.cash -
            a.cash
          );
        }
      )[0];
  }

  return randomItem(
    candidates
  );
}

/* =========================================================
   NPC BUY POWER
========================================================= */

function npcBuyPower(
  room,
  npc
) {
  if (
    npc.cash < 60
  ) {
    return false;
  }

  let power;

  if (
    npc.personality &&
    npc.personality.style ===
      "risky"
  ) {
    power =
      Math.random() < 0.5
        ? "Prediction"
        : "Protection";
  } else if (
    npc.personality &&
    npc.personality.style ===
      "logical"
  ) {
    power =
      Math.random() < 0.5
        ? "Reveal"
        : "Prediction";
  } else {
    power =
      Math.random() < 0.5
        ? "Steal"
        : "Protection";
  }

  npc.cash -=
    POWER_DEFINITIONS[
      power
    ].cost;

  npc.powers.push(
    power
  );

  addLog(
    room,
    npc.name +
      " bought " +
      power +
      "."
  );

  return true;
}

/* =========================================================
   NPC USE POWER
========================================================= */

function npcUsePower(
  room,
  npc
) {
  if (
    !npc.powers.length
  ) {
    return false;
  }

  const power =
    randomItem(
      npc.powers
    );

  /* PROTECTION */

  if (
    power ===
    "Protection"
  ) {
    const target =
      chooseNpcTarget(
        room,
        npc
      );

    if (
      !target ||
      target.protection
    ) {
      return false;
    }

    target.protection =
      true;

    removePower(
      npc,
      power
    );

    addLog(
      room,
      "🛡️ " +
        npc.name +
        " protected " +
        target.name +
        "."
    );

    fulfillProtectionDeals(
      room,
      npc.id,
      target.id
    );

    return true;
  }

  /* STEAL */

  if (
    power ===
    "Steal"
  ) {
    const target =
      chooseNpcTarget(
        room,
        npc
      );

    if (!target) {
      return false;
    }

    const amount =
      Math.min(
        50,
        target.cash
      );

    target.cash -=
      amount;

    npc.cash +=
      amount;

    removePower(
      npc,
      power
    );

    addLog(
      room,
      "💰 " +
        npc.name +
        " stole $" +
        amount +
        " from " +
        target.name +
        "."
    );

    return true;
  }

  /* SABOTAGE */

  if (
    power ===
    "Sabotage"
  ) {
    const target =
      chooseNpcTarget(
        room,
        npc
      );

    if (!target) {
      return false;
    }

    const amount =
      Math.min(
        50,
        target.cash
      );

    target.cash -=
      amount;

    removePower(
      npc,
      power
    );

    addLog(
      room,
      "💥 " +
        npc.name +
        " sabotaged " +
        target.name +
        " for $" +
        amount +
        "."
    );

    return true;
  }

  /* REVEAL */

  if (
    power ===
    "Reveal"
  ) {
    const box =
      randomItem(
        unopenedBoxes(room)
      );

    if (!box) {
      return false;
    }

    npc.reveals.push({
      boxNumber:
        box.number,

      result:
        box.result,

      createdAt:
        Date.now()
    });

    removePower(
      npc,
      power
    );

    addLog(
      room,
      "👁️ " +
        npc.name +
        " used Reveal on Box " +
        box.number +
        "."
    );

    return true;
  }

  /* SECOND CHANCE */

  if (
    power ===
    "Second Chance"
  ) {
    if (
      npc.secondChance
    ) {
      return false;
    }

    npc.secondChance =
      true;

    removePower(
      npc,
      power
    );

    addLog(
      room,
      "🔄 " +
        npc.name +
        " activated Second Chance."
    );

    return true;
  }

  /* SWAP */

  if (
    power ===
    "Swap"
  ) {
    const boxes =
      unopenedBoxes(room);

    if (
      boxes.length < 2
    ) {
      return false;
    }

    const first =
      randomItem(boxes);

    const remaining =
      boxes.filter(
        function (box) {
          return (
            box.number !==
            first.number
          );
        }
      );

    const second =
      randomItem(
        remaining
      );

    const temp =
      first.result;

    first.result =
      second.result;

    second.result =
      temp;

    removePower(
      npc,
      power
    );

    addLog(
      room,
      "🔀 " +
        npc.name +
        " swapped Box " +
        first.number +
        " and Box " +
        second.number +
        "."
    );

    return true;
  }

  /* PREDICTION */

  if (
    power ===
    "Prediction"
  ) {
    const box =
      randomItem(
        unopenedBoxes(room)
      );

    if (!box) {
      return false;
    }

    /*
      IMPORTANT:
      NPC does NOT look at box.result
      when making its prediction.
    */

    const prediction =
      Math.random() <
        11 / 16
        ? "SAFE"
        : "ELIMINATED";

    npc.predictions.push({
      boxNumber:
        box.number,

      prediction:
        prediction,

      resolved:
        false,

      correct:
        null,

      createdAt:
        Date.now()
    });

    removePower(
      npc,
      power
    );

    addLog(
      room,
      "🔮 " +
        npc.name +
        " made a prediction about Box " +
        box.number +
        "."
    );

    return true;
  }

  /* ROYAL ASSIGNMENT */

  if (
    power ===
    "Royal Assignment"
  ) {
    const target =
      chooseNpcTarget(
        room,
        npc
      );

    if (!target) {
      return false;
    }

    room.forcedNextPlayerId =
      target.id;

    removePower(
      npc,
      power
    );

    addLog(
      room,
      "👑 " +
        npc.name +
        " assigned " +
        target.name +
        " to take the next turn."
    );

    return true;
  }

  return false;
}

/* =========================================================
   NPC CHOOSE BOX
========================================================= */

function npcChooseBox(
  room,
  npc
) {
  const boxes =
    unopenedBoxes(room);

  if (!boxes.length) {
    return null;
  }

  /*
    If the NPC legitimately learned
    that a currently unopened box
    was SAFE through Reveal, it may
    use that knowledge.

    It does NOT inspect hidden
    outcomes directly.
  */

  const knownSafe =
    npc.reveals.filter(
      function (reveal) {
        return (
          reveal.result ===
            "SAFE" &&
          boxes.some(
            function (box) {
              return (
                box.number ===
                reveal.boxNumber
              );
            }
          )
        );
      }
    );

  if (
    knownSafe.length &&
    npc.personality &&
    npc.personality.style ===
      "logical"
  ) {
    const knowledge =
      randomItem(
        knownSafe
      );

    return boxes.find(
      function (box) {
        return (
          box.number ===
          knowledge.boxNumber
        );
      }
    );
  }

  /*
    Otherwise the NPC chooses
    without seeing hidden outcomes.
  */

  return randomItem(
    boxes
  );
}

/* =========================================================
   NPC TURN
========================================================= */

function runNpcTurn(room) {
  if (
    room.finished ||
    room.mode !==
      "solo"
  ) {
    return;
  }

  const npc =
    getCurrentPlayer(room);

  if (
    !npc ||
    !npc.isNPC ||
    !npc.alive
  ) {
    return;
  }

  addLog(
    room,
    "🤖 " +
      npc.name +
      " is making a decision..."
  );

  emitRoom(room);

  setTimeout(
    function () {
      if (
        room.finished ||
        !npc.alive ||
        room.currentTurn !==
          npc.id
      ) {
        return;
      }

      if (
        Math.random() < 0.35
      ) {
        npcMakeDeal(
          room,
          npc
        );
      }

      if (
        Math.random() < 0.35
      ) {
        npcBuyPower(
          room,
          npc
        );
      }

      if (
        Math.random() < 0.45
      ) {
        npcUsePower(
          room,
          npc
        );
      }

      const box =
        npcChooseBox(
          room,
          npc
        );

      if (box) {
        openBox(
          room,
          npc.id,
          box.number,
          true
        );
      }
    },
    900
  );
}

/* =========================================================
   OPEN BOX
========================================================= */

function openBox(
  room,
  playerId,
  boxNumber,
  isNpc
) {
  if (
    room.finished
  ) {
    return;
  }

  const player =
    getPlayer(
      room,
      playerId
    );

  if (
    !player ||
    !player.alive
  ) {
    return;
  }

  if (
    room.currentTurn !==
    player.id
  ) {
    if (!isNpc) {
      const playerSocket =
        io.sockets.sockets.get(
          player.id
        );

      if (
        playerSocket
      ) {
        playerSocket.emit(
          "errorMessage",
          "It is not your turn."
        );
      }
    }

    return;
  }

  const box =
    validUnopenedBox(
      room,
      boxNumber
    );

  if (!box) {
    if (!isNpc) {
      const playerSocket =
        io.sockets.sockets.get(
          player.id
        );

      if (
        playerSocket
      ) {
        playerSocket.emit(
          "errorMessage",
          "Choose an unopened box."
        );
      }
    }

    return;
  }

  box.opened =
    true;

  player.boxesOpened +=
    1;

  /*
    Resolve all predictions made
    about this box.
  */

  resolvePredictions(
    room,
    box
  );

  if (
    box.result ===
    "SAFE"
  ) {
    addLog(
      room,
      player.name +
        " opened Box " +
        box.number +
        ": SAFE."
    );
  } else {
    if (
      player.protection
    ) {
      player.protection =
        false;

      addLog(
        room,
        player.name +
          " opened Box " +
          box.number +
          ": ELIMINATED — Protection saved them."
      );
    } else if (
      player.secondChance
    ) {
      player.secondChance =
        false;

      addLog(
        room,
        player.name +
          " opened Box " +
          box.number +
          ": ELIMINATED — Second Chance saved them."
      );
    } else {
      player.alive =
        false;

      addLog(
        room,
        player.name +
          " opened Box " +
          box.number +
          ": ELIMINATED."
      );
    }
  }

  if (
    checkGameEnd(room)
  ) {
    return;
  }

  advanceTurn(room);
}

/* =========================================================
   RESET PLAYER FOR NEW GAME
========================================================= */

function resetPlayer(
  player
) {
  player.cash =
    100;

  player.alive =
    true;

  player.powers =
    [];

  player.protection =
    false;

  player.secondChance =
    false;

  player.objective =
    randomItem(
      OBJECTIVES
    );

  player.objectiveComplete =
    false;

  player.boxesOpened =
    0;

  player.predictions =
    [];

  player.correctPredictions =
    0;

  player.reveals =
    [];

  player.dealsMade =
    0;

  player.dealsHonored =
    0;

  player.dealsBroken =
    0;

  player.relationships =
    {};
}

/* =========================================================
   SOCKET CONNECTION
========================================================= */

io.on(
  "connection",
  function (socket) {

    /* =====================================================
       CREATE ONLINE ROOM
    ===================================================== */

    socket.on(
      "createRoom",
      function (data) {
        const name =
          data &&
          data.name;

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

    /* =====================================================
       JOIN ROOM
    ===================================================== */

    socket.on(
      "joinRoom",
      function (data) {
        const name =
          data &&
          data.name;

        const code =
          data &&
          data.code;

        if (
          !name ||
          !name.trim() ||
          !code
        ) {
          return;
        }

        const room =
          rooms.get(
            code
              .toUpperCase()
          );

        if (!room) {
          socket.emit(
            "errorMessage",
            "Room not found."
          );

          return;
        }

        if (
          room.started
        ) {
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
            name.trim(),
            false,
            null
          )
        );

        socket.join(
          room.code
        );

        addLog(
          room,
          name.trim() +
            " joined the room."
        );

        emitRoom(room);
      }
    );

    /* =====================================================
       START ONLINE GAME
    ===================================================== */

    socket.on(
      "startGame",
      function () {
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

          room.boxes =
            createBoxes();

          room.goldenBox =
            crypto.randomInt(
              1,
              17
            );

          room.started =
            true;

          room.finished =
            false;

          room.turnIndex =
            0;

          room.currentTurn =
            room.players[0].id;

          room.forcedNextPlayerId =
            null;

          room.deals =
            [];

          room.dealCounter =
            0;

          room.log =
            [];

          room.players.forEach(
            function (player) {
              resetPlayer(
                player
              );
            }
          );

          addLog(
            room,
            "Game started!"
          );

          addLog(
            room,
            "A completely new hidden board has been generated."
          );

          addLog(
            room,
            "It is now " +
              room.players[0].name +
              "'s turn."
          );

          emitRoom(room);

          return;
        }
      }
    );

    /* =====================================================
       CREATE SOLO
    ===================================================== */

    socket.on(
      "createSolo",
      function (data) {
        const name =
          data &&
          data.name;

        let count =
          Number(
            data &&
            data.npcCount
          );

        if (
          !name ||
          !name.trim()
        ) {
          return;
        }

        if (
          !Number.isFinite(
            count
          )
        ) {
          count = 3;
        }

        count =
          Math.max(
            3,
            Math.min(
              15,
              Math.floor(
                count
              )
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
      }
    );

    /* =====================================================
       OPEN BOX
    ===================================================== */

    socket.on(
      "openBox",
      function (data) {
        const room =
          findRoomByPlayerId(
            socket.id
          );

        if (!room) {
          return;
        }

        openBox(
          room,
          socket.id,
          data &&
            data.boxNumber,
          false
        );
      }
    );

    /* =====================================================
       BUY POWER
    ===================================================== */

    socket.on(
      "buyPower",
      function (data) {
        const room =
          findRoomByPlayerId(
            socket.id
          );

        if (!room) {
          return;
        }

        const player =
          getPlayer(
            room,
            socket.id
          );

        if (
          !player ||
          !room.started ||
          room.finished
        ) {
          return;
        }

        if (
          !player.alive
        ) {
          socket.emit(
            "errorMessage",
            "Eliminated players cannot buy powers."
          );

          return;
        }

        const power =
          data &&
          data.power;

        const definition =
          POWER_DEFINITIONS[
            power
          ];

        if (
          !definition
        ) {
          socket.emit(
            "errorMessage",
            "Unknown power."
          );

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
          player.name +
            " bought " +
            power +
            "."
        );

        emitRoom(room);
      }
    );

    /* =====================================================
       USE POWER
    ===================================================== */

    socket.on(
      "usePower",
      function (data) {
        const room =
          findRoomByPlayerId(
            socket.id
          );

        if (!room) {
          return;
        }

        const player =
          getPlayer(
            room,
            socket.id
          );

        if (!player) {
          return;
        }

        const power =
          data &&
          data.power;

        const result =
          usePower(
            room,
            player,
            power,
            data || {}
          );

        if (
          !result.success
        ) {
          socket.emit(
            "errorMessage",
            result.message
          );

          return;
        }

        if (
          result.privateMessage
        ) {
          socket.emit(
            "privateMessage",
            result.privateMessage
          );
        }

        emitRoom(room);
      }
    );

    /* =====================================================
       MAKE DEAL
    ===================================================== */

    socket.on(
      "makeDeal",
      function (data) {
        const targetId =
          data &&
          (
            data.recipientId ||
            data.targetId
          );

        let offer;
        let request;

        /*
          NEW FRONTEND FORMAT
        */

        if (
          data &&
          data.offer &&
          data.request
        ) {
          offer = {
            type:
              data.offer.type
          };

          if (
            data.offer.type ===
            "money"
          ) {
            offer.amount =
              Math.floor(
                Number(
                  data.offer.amount
                )
              );
          }

          request = {
            type:
              data.request.type
          };

          if (
            data.request.type ===
            "money"
          ) {
            request.amount =
              Math.floor(
                Number(
                  data.request.amount
                )
              );
          }
        } else {
          /*
            OLD FORMAT FALLBACK
          */

          const offerType =
            data &&
            data.offerType;

          const offerAmount =
            Number(
              data &&
              data.offerAmount
            );

          const requestType =
            data &&
            data.requestType;

          const requestAmount =
            Number(
              data &&
              data.requestAmount
            );

          if (
            offerType ===
            "money"
          ) {
            offer = {
              type:
                "money",

              amount:
                Math.floor(
                  offerAmount
                )
            };
          } else {
            offer = {
              type:
                "protection"
            };
          }

          if (
            requestType ===
            "money"
          ) {
            request = {
              type:
                "money",

              amount:
                Math.floor(
                  requestAmount
                )
            };
          } else if (
            requestType ===
            "protection"
          ) {
            request = {
              type:
                "protection"
            };
          } else {
            request = {
              type:
                "nothing"
            };
          }
        }

        const room =
          findRoomByPlayerId(
            socket.id
          );

        if (!room) {
          return;
        }

        const proposer =
          getPlayer(
            room,
            socket.id
          );

        if (!proposer) {
          return;
        }

        if (
          !room.started ||
          room.finished
        ) {
          socket.emit(
            "errorMessage",
            "You cannot make deals right now."
          );

          return;
        }

        const target =
          getPlayer(
            room,
            targetId
          );

        if (
          !target ||
          !target.alive
        ) {
          socket.emit(
            "errorMessage",
            "That player is unavailable."
          );

          return;
        }

        if (
          target.id ===
          proposer.id
        ) {
          socket.emit(
            "errorMessage",
            "You cannot make a deal with yourself."
          );

          return;
        }

        if (
          !offer ||
          !request
        ) {
          socket.emit(
            "errorMessage",
            "Invalid deal."
          );

          return;
        }

        if (
          offer.type ===
          "money"
        ) {
          if (
            !Number.isFinite(
              offer.amount
            ) ||
            offer.amount <=
              0
          ) {
            socket.emit(
              "errorMessage",
              "Enter a valid offer amount."
            );

            return;
          }

          if (
            offer.amount >
            proposer.cash
          ) {
            socket.emit(
              "errorMessage",
              "You do not have enough cash."
            );

            return;
          }
        }

        if (
          request.type ===
          "money"
        ) {
          if (
            !Number.isFinite(
              request.amount
            ) ||
            request.amount <=
              0
          ) {
            socket.emit(
              "errorMessage",
              "Enter a valid requested amount."
            );

            return;
          }
        }

        const deal =
          createDeal(
            room,
            proposer.id,
            target.id,
            offer,
            request
          );

        if (!deal) {
          socket.emit(
            "errorMessage",
            "Unable to create that deal."
          );

          return;
        }

        emitRoom(room);

        /*
          NPC TARGET RESPONSE
        */

        if (
          target.isNPC
        ) {
          setTimeout(
            function () {
              if (
                room.finished ||
                deal.status !==
                  "pending"
              ) {
                return;
              }

              const accepts =
                npcDealAccepts(
                  room,
                  target,
                  deal
                );

              if (accepts) {
                const result =
                  acceptDeal(
                    room,
                    deal.id,
                    target.id
                  );

                if (
                  result.success
                ) {
                  addLog(
                    room,
                    "🤖 " +
                      target.name +
                      " accepted your deal."
                  );
                }
              } else {
                declineDeal(
                  room,
                  deal.id,
                  target.id
                );

                addLog(
                  room,
                  "🤖 " +
                    target.name +
                    " rejected your deal."
                );
              }

              emitRoom(room);
            },
            1200
          );
        }
      }
    );

    /* =====================================================
       ACCEPT DEAL
    ===================================================== */

    socket.on(
      "acceptDeal",
      function (data) {
        const room =
          findRoomByPlayerId(
            socket.id
          );

        if (!room) {
          return;
        }

        const result =
          acceptDeal(
            room,
            data &&
              data.dealId,
            socket.id
          );

        if (
          !result.success
        ) {
          socket.emit(
            "errorMessage",
            result.message
          );

          return;
        }

        emitRoom(room);
      }
    );

    /* =====================================================
       DECLINE DEAL
    ===================================================== */

    socket.on(
      "declineDeal",
      function (data) {
        const room =
          findRoomByPlayerId(
            socket.id
          );

        if (!room) {
          return;
        }

        declineDeal(
          room,
          data &&
            data.dealId,
          socket.id
        );

        emitRoom(room);
      }
    );

    /* =====================================================
       PLAY AGAIN
    ===================================================== */

    socket.on(
      "playAgain",
      function () {
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

          room.boxes =
            createBoxes();

          room.goldenBox =
            crypto.randomInt(
              1,
              17
            );

          room.started =
            true;

          room.finished =
            false;

          room.turnIndex =
            0;

          room.currentTurn =
            room.players[0].id;

          room.forcedNextPlayerId =
            null;

          room.log =
            [];

          room.deals =
            [];

          room.dealCounter =
            0;

          room.players.forEach(
            function (player) {
              resetPlayer(
                player
              );
            }
          );

          addLog(
            room,
            "🔄 New game started!"
          );

          addLog(
            room,
            "A completely new hidden board has been generated."
          );

          addLog(
            room,
            "It is now " +
              room.players[0].name +
              "'s turn."
          );

          emitRoom(room);

          return;
        }
      }
    );

    /* =====================================================
       RESET ROOM
    ===================================================== */

    socket.on(
      "resetRoom",
      function () {
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

    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on(
      "disconnect",
      function () {
        for (
          const [
            code,
            room
          ]
          of rooms.entries()
        ) {
          const index =
            room.players.findIndex(
              function (player) {
                return (
                  player.id ===
                  socket.id
                );
              }
            );

          if (
            index === -1
          ) {
            continue;
          }

          const player =
            room.players[index];

          if (
            room.mode ===
            "solo"
          ) {
            rooms.delete(
              code
            );

            continue;
          }

          const wasCurrentTurn =
            room.currentTurn ===
            socket.id;

          room.players.splice(
            index,
            1
          );

          /*
            Pending deals involving a
            disconnected player expire.

            Completed/history deals stay
            in the room instead of being
            silently erased.
          */

          room.deals.forEach(
            function (deal) {
              if (
                (
                  deal.proposerId ===
                    socket.id ||
                  deal.recipientId ===
                    socket.id
                ) &&
                (
                  deal.status ===
                    "pending" ||
                  deal.status ===
                    "accepted"
                )
              ) {
                deal.status =
                  "expired";
              }
            }
          );

          if (
            room.forcedNextPlayerId ===
            socket.id
          ) {
            room.forcedNextPlayerId =
              null;
          }

          addLog(
            room,
            player.name +
              " left the game."
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

          if (
            room.players.length ===
            0
          ) {
            rooms.delete(
              code
            );

            return;
          }

          /*
            Correctly skip dead players
            if the current player left.
          */

          if (
            wasCurrentTurn &&
            room.started &&
            !room.finished
          ) {
            room.turnIndex =
              Math.max(
                0,
                index - 1
              );

            room.currentTurn =
              room.players[
                room.turnIndex
              ].id;

            if (
              checkGameEnd(
                room
              )
            ) {
              return;
            }

            advanceTurn(
              room
            );

            return;
          }

          emitRoom(room);

          return;
        }
      }
    );
  }
);

/* =========================================================
   SERVER
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  function () {
    console.log(
      "THE BOX server running on port " +
        PORT
    );
  }
);
