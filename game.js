const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

if (!ctx) {
  throw new Error('Canvas 2D context is not available.');
}

const input = {
  up: false,
  left: false,
  right: false,
};

const PLAYER_START_ANGLE = -Math.PI / 2;

const player = {
  worldX: 0,
  worldY: 0,
  velocityX: 0,
  velocityY: 0,
  angle: -Math.PI / 2,
  radius: 22,
  thrust: 700,
  rotationSpeed: 3.3,
  maxSpeed: 1800,
  color: '#61dafb',
  markerColor: '#ffcf40',
};

const starLayers = [
  { density: 0.00006, speed: 10, parallax: 0.08, sizeMin: 0.7, sizeMax: 1.4 },
  { density: 0.00004, speed: 22, parallax: 0.18, sizeMin: 1.0, sizeMax: 2.0 },
  { density: 0.000025, speed: 40, parallax: 0.32, sizeMin: 1.3, sizeMax: 2.8 },
];

const PLANET_CHUNK_SIZE = 2400;
const PLANET_CHUNK_RADIUS = 2;
const PLANET_MIN_PER_CHUNK = 1;
const PLANET_MAX_PER_CHUNK = 3;
const PLANET_GRAVITY_CONSTANT = 8000;
const PLANET_COLORS = ['#79d3ff', '#ffd166', '#ef476f', '#7bd389', '#b794f4'];
let starsByLayer = [];
const planetChunks = new Map();
let lastTime = 0;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  if (starsByLayer.length === 0) {
    initStars();
  } else {
    resizeStarsToViewport();
  }
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randomFromSeed(seed) {
  return Math.abs(Math.sin(seed * 12.9898 + 78.233) * 43758.5453) % 1;
}

    angle: PLAYER_START_ANGLE,
  return `${chunkX},${chunkY}`;
}

function createPlanetForChunk(chunkX, chunkY, planetIndex) {
  const baseSeed = chunkX * 928371 + chunkY * 123457 + planetIndex * 97 + 11;
  const offsetX = randomFromSeed(baseSeed + 1) * PLANET_CHUNK_SIZE;
  const offsetY = randomFromSeed(baseSeed + 2) * PLANET_CHUNK_SIZE;
  const radius = 55 + randomFromSeed(baseSeed + 3) * 120;
  const density = 0.65 + randomFromSeed(baseSeed + 4) * 0.9;
  const mass = radius * radius * density;
  const colorIndex = Math.floor(randomFromSeed(baseSeed + 5) * PLANET_COLORS.length);

  return {
    x: chunkX * PLANET_CHUNK_SIZE + offsetX,
    y: chunkY * PLANET_CHUNK_SIZE + offsetY,
    radius,
    mass,
    color: PLANET_COLORS[colorIndex],
  };
}
  const PLAYER_START_ANGLE = -Math.PI / 2;

function getPlanetsInChunk(chunkX, chunkY) {
  const key = chunkKey(chunkX, chunkY);
  const cached = planetChunks.get(key);
  if (cached) {
    return cached;
  }

  const seed = chunkX * 389 + chunkY * 997 + 53;
  const countRandom = randomFromSeed(seed);
  const planetCount =
    PLANET_MIN_PER_CHUNK +
    Math.floor(countRandom * (PLANET_MAX_PER_CHUNK - PLANET_MIN_PER_CHUNK + 1));

  const planets = [];
  for (let i = 0; i < planetCount; i += 1) {
    planets.push(createPlanetForChunk(chunkX, chunkY, i));
  }

  planetChunks.set(key, planets);
  return planets;
}

function getNearbyPlanets() {
  const centerChunkX = Math.floor(player.worldX / PLANET_CHUNK_SIZE);
  const centerChunkY = Math.floor(player.worldY / PLANET_CHUNK_SIZE);
  const nearby = [];

  for (let chunkY = centerChunkY - PLANET_CHUNK_RADIUS; chunkY <= centerChunkY + PLANET_CHUNK_RADIUS; chunkY += 1) {
    for (let chunkX = centerChunkX - PLANET_CHUNK_RADIUS; chunkX <= centerChunkX + PLANET_CHUNK_RADIUS; chunkX += 1) {
      nearby.push(...getPlanetsInChunk(chunkX, chunkY));
    }
  }

  return nearby;
}

function applyPlanetGravity(deltaTime) {
  const planets = getNearbyPlanets();
  let accelerationX = 0;
  let accelerationY = 0;

  for (let i = 0; i < planets.length; i += 1) {
    const planet = planets[i];
    const dx = planet.x - player.worldX;
    const dy = planet.y - player.worldY;
    const distanceSq = dx * dx + dy * dy;
    const minDistance = planet.radius + player.radius * 0.8;
    const minDistanceSq = minDistance * minDistance;
    const clampedDistanceSq = Math.max(distanceSq, minDistanceSq);
    const distance = Math.sqrt(clampedDistanceSq);

    const accelerationMagnitude = (PLANET_GRAVITY_CONSTANT * planet.mass) / clampedDistanceSq;
    accelerationX += (dx / distance) * accelerationMagnitude;
    accelerationY += (dy / distance) * accelerationMagnitude;
  }

  player.velocityX += accelerationX * deltaTime;
  player.velocityY += accelerationY * deltaTime;
}

function renderPlanets(centerX, centerY) {
  const planets = getNearbyPlanets();
  const viewPadding = 220;

  for (let i = 0; i < planets.length; i += 1) {
    const planet = planets[i];
    const screenX = centerX + (planet.x - player.worldX);
    const screenY = centerY + (planet.y - player.worldY);

    if (
      screenX < -viewPadding ||
      screenX > canvas.width + viewPadding ||
      screenY < -viewPadding ||
      screenY > canvas.height + viewPadding
    ) {
      continue;
    }

    const glowRadius = planet.radius * 1.25;
    const glow = ctx.createRadialGradient(screenX, screenY, planet.radius * 0.2, screenX, screenY, glowRadius);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(screenX, screenY, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    const bodyGradient = ctx.createRadialGradient(
      screenX - planet.radius * 0.3,
      screenY - planet.radius * 0.3,
      planet.radius * 0.2,
      screenX,
      screenY,
      planet.radius
    );
    bodyGradient.addColorStop(0, '#ffffff');
    bodyGradient.addColorStop(0.2, planet.color);
    bodyGradient.addColorStop(1, '#1a1a1f');

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.arc(screenX, screenY, planet.radius, 0, Math.PI * 2);
    ctx.fill();

  function hasPlanetCollision() {
    const planets = getNearbyPlanets();

    for (let i = 0; i < planets.length; i += 1) {
      const planet = planets[i];
      const dx = planet.x - player.worldX;
      const dy = planet.y - player.worldY;
      const collisionDistance = planet.radius + player.radius;

      if (dx * dx + dy * dy <= collisionDistance * collisionDistance) {
        return true;
      }
    }

    return false;
  }

  function resetGame() {
    player.worldX = 0;
    player.worldY = 0;
    player.velocityX = 0;
    player.velocityY = 0;
    player.angle = PLAYER_START_ANGLE;

    input.up = false;
    input.left = false;
    input.right = false;

    initStars();
  }
  }
}

function createStar(layer) {
  return {
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: randomRange(layer.sizeMin, layer.sizeMax),
    alpha: randomRange(0.45, 0.95),
  };
}

function getStarCount(layer) {
  return Math.max(25, Math.floor(canvas.width * canvas.height * layer.density));
}

function initStars() {
  starsByLayer = starLayers.map((layer) => {
    const count = getStarCount(layer);
    const stars = [];

    for (let i = 0; i < count; i += 1) {
      stars.push(createStar(layer));
    }

    return stars;
  });
}

function resizeStarsToViewport() {
  starsByLayer = starLayers.map((layer, layerIndex) => {
    const targetCount = getStarCount(layer);
    const existing = starsByLayer[layerIndex] || [];
    const next = existing.slice(0, targetCount);

    while (next.length < targetCount) {
      next.push(createStar(layer));
    }

    return next;
  });
}

function wrapPosition(value, max) {
  if (max <= 0) {
    return 0;
  }

  return ((value % max) + max) % max;
}

function updateStars(deltaTime, playerDeltaX, playerDeltaY) {
  starLayers.forEach((layer, layerIndex) => {
    const stars = starsByLayer[layerIndex];

    for (let i = 0; i < stars.length; i += 1) {
      const star = stars[i];

      // Stars drift downward and shift opposite player movement.
      star.y += layer.speed * deltaTime - playerDeltaY * layer.parallax;
      star.x -= playerDeltaX * layer.parallax;

      star.x = wrapPosition(star.x, canvas.width);
      star.y = wrapPosition(star.y, canvas.height);
    }
  });
}

function update(deltaTime) {
  const previousWorldX = player.worldX;
  const previousWorldY = player.worldY;

  if (input.left) {
    player.angle -= player.rotationSpeed * deltaTime;
  }
  if (input.right) {
    player.angle += player.rotationSpeed * deltaTime;
  }

  if (input.up) {
    player.velocityX += Math.cos(player.angle) * player.thrust * deltaTime;
    player.velocityY += Math.sin(player.angle) * player.thrust * deltaTime;
  }

  applyPlanetGravity(deltaTime);

  const speed = Math.hypot(player.velocityX, player.velocityY);
  if (speed > player.maxSpeed) {
    const scale = player.maxSpeed / speed;
    player.velocityX *= scale;
    player.velocityY *= scale;
  }

  player.worldX += player.velocityX * deltaTime;
  player.worldY += player.velocityY * deltaTime;

  updateStars(deltaTime, player.worldX - previousWorldX, player.worldY - previousWorldY);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // Background.
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Star field.
  starLayers.forEach((layer, layerIndex) => {
    const stars = starsByLayer[layerIndex];

    for (let i = 0; i < stars.length; i += 1) {
      const star = stars[i];
      ctx.globalAlpha = star.alpha;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;

  // Planets in world space.
  renderPlanets(centerX, centerY);

  // Player ship stays centered while the world moves around it.
  const noseDistance = player.radius * 1.28;
  const rearDistance = player.radius * 0.68;
  const wingOffset = player.radius * 0.36;

  const noseX = centerX + Math.cos(player.angle) * noseDistance;
  const noseY = centerY + Math.sin(player.angle) * noseDistance;

  const leftX =
    centerX +
    Math.cos(player.angle + (Math.PI * 3) / 4) * rearDistance +
    Math.cos(player.angle + Math.PI / 2) * wingOffset;
  const leftY =
    centerY +
    if (hasPlanetCollision()) {
      resetGame();
      return;
    }
    Math.sin(player.angle + (Math.PI * 3) / 4) * rearDistance +
    Math.sin(player.angle + Math.PI / 2) * wingOffset;

  const rightX =
    centerX +
    Math.cos(player.angle - (Math.PI * 3) / 4) * rearDistance +
    Math.cos(player.angle - Math.PI / 2) * wingOffset;
  const rightY =
    centerY +
    Math.sin(player.angle - (Math.PI * 3) / 4) * rearDistance +
    Math.sin(player.angle - Math.PI / 2) * wingOffset;

  if (input.up) {
    const flameBaseX = centerX - Math.cos(player.angle) * (player.radius * 0.9);
    const flameBaseY = centerY - Math.sin(player.angle) * (player.radius * 0.9);
    const flameSpread = player.radius * 0.33;
    const flameLength = player.radius * randomRange(0.95, 1.35);

    const leftFlameX = flameBaseX + Math.cos(player.angle + Math.PI / 2) * flameSpread;
    const leftFlameY = flameBaseY + Math.sin(player.angle + Math.PI / 2) * flameSpread;
    const rightFlameX = flameBaseX + Math.cos(player.angle - Math.PI / 2) * flameSpread;
    const rightFlameY = flameBaseY + Math.sin(player.angle - Math.PI / 2) * flameSpread;
    const tipFlameX = flameBaseX - Math.cos(player.angle) * flameLength;
    const tipFlameY = flameBaseY - Math.sin(player.angle) * flameLength;

    const flameGradient = ctx.createLinearGradient(flameBaseX, flameBaseY, tipFlameX, tipFlameY);
    flameGradient.addColorStop(0, '#ffe8a0');
    flameGradient.addColorStop(0.45, '#ff9a2f');
    flameGradient.addColorStop(1, 'rgba(255, 80, 0, 0)');

    ctx.fillStyle = flameGradient;
    ctx.beginPath();
    ctx.moveTo(leftFlameX, leftFlameY);
    ctx.lineTo(rightFlameX, rightFlameY);
    ctx.lineTo(tipFlameX, tipFlameY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.moveTo(noseX, noseY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();

  // Marker speck on the looking corner (nose).
  ctx.fillStyle = player.markerColor;
  ctx.beginPath();
  ctx.arc(noseX, noseY, 3, 0, Math.PI * 2);
  ctx.fill();

  // Lightweight HUD.
  const speed = Math.hypot(player.velocityX, player.velocityY);
  ctx.fillStyle = '#f0f0f0';
  ctx.font = '16px monospace';
  ctx.fillText('Up: Thrust | Left/Right: Rotate', 16, 28);
  ctx.fillText(`Speed: ${speed.toFixed(1)}`, 16, 50);
}

function gameLoop(timestamp) {
  const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  update(deltaTime);
  render();

  requestAnimationFrame(gameLoop);
}

function setKeyState(code, isPressed) {
  if (code === 'ArrowUp' || code === 'KeyW') {
    input.up = isPressed;
  } else if (code === 'ArrowLeft' || code === 'KeyA') {
    input.left = isPressed;
  } else if (code === 'ArrowRight' || code === 'KeyD') {
    input.right = isPressed;
  }
}

window.addEventListener('keydown', (event) => {
  setKeyState(event.code, true);
});

window.addEventListener('keyup', (event) => {
  setKeyState(event.code, false);
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
requestAnimationFrame((timestamp) => {
  lastTime = timestamp;
  gameLoop(timestamp);
});
