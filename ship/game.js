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

const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

const PLAYER_START_ANGLE = -Math.PI / 2;

const player = {
  worldX: 0,
  worldY: 0,
  velocityX: 0,
  velocityY: 0,
  angle: PLAYER_START_ANGLE,
  radius: 16,
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
const PLANET_GRAVITY_CONSTANT = 5000;
const PLANET_COLORS = ['#79d3ff', '#ffd166', '#ef476f', '#7bd389', '#b794f4'];

const MINIMAP_WIDTH = 250;
const MINIMAP_MARGIN = 16;
const MINIMAP_RANGE = 3600;

const MISSILE_SPEED = 1300;
const MISSILE_RADIUS = 3;
const MISSILE_LIFETIME = 7;
const MISSILE_GRAVITY_MULTIPLIER = 1.8;

const TARGET_SIZE = 36;
const TARGET_MIN_DISTANCE = 1400;
const TARGET_MAX_DISTANCE = 4200;
const TARGET_ARROW_SIZE = 14;

const INITIAL_LIVES = 3;
const BOOST_MAX_CHARGES = 5;
const BOOST_DURATION = 4;

let starsByLayer = [];
const planetChunks = new Map();
const missiles = [];
let target = null;
let destroyedTargets = 0;
let lives = INITIAL_LIVES;
let boostCharges = BOOST_MAX_CHARGES;
let boostTimeRemaining = 0;
let lastTime = 0;

let audioCtx = null;
let thrustNoise = null;
let thrustFilter = null;
let thrustGain = null;
let thrustLfo = null;
let thrustLfoGain = null;
let thrustSoundActive = false;
let boostOsc = null;
let boostGain = null;
let boostLfo = null;
let boostLfoGain = null;
let boostSoundActive = false;

function ensureAudioContext() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }
    audioCtx = new AudioCtx();
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  return audioCtx;
}

function createNoiseSource(context) {
  const bufferSize = context.sampleRate;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

function startThrustSound() {
  if (thrustSoundActive) {
    return;
  }

  const context = ensureAudioContext();
  if (!context) {
    return;
  }

  thrustNoise = createNoiseSource(context);
  thrustFilter = context.createBiquadFilter();
  thrustFilter.type = 'bandpass';
  thrustFilter.frequency.value = 1200;
  thrustFilter.Q.value = 0.9;

  thrustGain = context.createGain();
  thrustGain.gain.value = 0.0001;

  thrustLfo = context.createOscillator();
  thrustLfo.type = 'triangle';
  thrustLfo.frequency.value = 16;
  thrustLfoGain = context.createGain();
  thrustLfoGain.gain.value = 220;

  thrustLfo.connect(thrustLfoGain);
  thrustLfoGain.connect(thrustFilter.frequency);
  thrustNoise.connect(thrustFilter);
  thrustFilter.connect(thrustGain);
  thrustGain.connect(context.destination);

  const now = context.currentTime;
  thrustGain.gain.setValueAtTime(0.0001, now);
  thrustGain.gain.exponentialRampToValueAtTime(0.07, now + 0.05);

  thrustNoise.start();
  thrustLfo.start();
  thrustSoundActive = true;
}

function stopThrustSound() {
  if (!thrustSoundActive || !audioCtx) {
    return;
  }

  const now = audioCtx.currentTime;
  thrustGain.gain.cancelScheduledValues(now);
  thrustGain.gain.setValueAtTime(Math.max(0.0001, thrustGain.gain.value), now);
  thrustGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

  const noiseNode = thrustNoise;
  const lfoNode = thrustLfo;
  setTimeout(() => {
    if (noiseNode) {
      noiseNode.stop();
      noiseNode.disconnect();
    }
    if (lfoNode) {
      lfoNode.stop();
      lfoNode.disconnect();
    }
  }, 120);

  if (thrustFilter) {
    thrustFilter.disconnect();
  }
  if (thrustGain) {
    thrustGain.disconnect();
  }
  if (thrustLfoGain) {
    thrustLfoGain.disconnect();
  }

  thrustNoise = null;
  thrustFilter = null;
  thrustGain = null;
  thrustLfo = null;
  thrustLfoGain = null;
  thrustSoundActive = false;
}

function startBoostSound() {
  if (boostSoundActive) {
    return;
  }

  const context = ensureAudioContext();
  if (!context) {
    return;
  }

  boostOsc = context.createOscillator();
  boostOsc.type = 'sawtooth';
  boostOsc.frequency.value = 180;

  boostGain = context.createGain();
  boostGain.gain.value = 0.0001;

  boostLfo = context.createOscillator();
  boostLfo.type = 'sine';
  boostLfo.frequency.value = 9;
  boostLfoGain = context.createGain();
  boostLfoGain.gain.value = 38;

  boostLfo.connect(boostLfoGain);
  boostLfoGain.connect(boostOsc.frequency);
  boostOsc.connect(boostGain);
  boostGain.connect(context.destination);

  const now = context.currentTime;
  boostGain.gain.setValueAtTime(0.0001, now);
  boostGain.gain.exponentialRampToValueAtTime(0.06, now + 0.06);

  boostOsc.start();
  boostLfo.start();
  boostSoundActive = true;
}

function stopBoostSound() {
  if (!boostSoundActive || !audioCtx) {
    return;
  }

  const now = audioCtx.currentTime;
  boostGain.gain.cancelScheduledValues(now);
  boostGain.gain.setValueAtTime(Math.max(0.0001, boostGain.gain.value), now);
  boostGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

  const oscNode = boostOsc;
  const lfoNode = boostLfo;
  setTimeout(() => {
    if (oscNode) {
      oscNode.stop();
      oscNode.disconnect();
    }
    if (lfoNode) {
      lfoNode.stop();
      lfoNode.disconnect();
    }
  }, 140);

  if (boostGain) {
    boostGain.disconnect();
  }
  if (boostLfoGain) {
    boostLfoGain.disconnect();
  }

  boostOsc = null;
  boostGain = null;
  boostLfo = null;
  boostLfoGain = null;
  boostSoundActive = false;
}

function playShootSound() {
  const context = ensureAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime;

  const laserOsc = context.createOscillator();
  laserOsc.type = 'square';
  laserOsc.frequency.setValueAtTime(1400, now);
  laserOsc.frequency.exponentialRampToValueAtTime(360, now + 0.09);

  const laserGain = context.createGain();
  laserGain.gain.setValueAtTime(0.001, now);
  laserGain.gain.exponentialRampToValueAtTime(0.11, now + 0.005);
  laserGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  const noiseSource = createNoiseSource(context);
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1800;

  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.04, now + 0.002);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

  laserOsc.connect(laserGain);
  laserGain.connect(context.destination);
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(context.destination);

  laserOsc.start(now);
  laserOsc.stop(now + 0.14);
  noiseSource.start(now);
  noiseSource.stop(now + 0.05);

  laserOsc.onended = () => {
    laserOsc.disconnect();
    laserGain.disconnect();
  };

  noiseSource.onended = () => {
    noiseSource.disconnect();
    noiseFilter.disconnect();
    noiseGain.disconnect();
  };
}

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

function chunkKey(chunkX, chunkY) {
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

function getPlanetsAround(worldX, worldY, chunkRadius) {
  const centerChunkX = Math.floor(worldX / PLANET_CHUNK_SIZE);
  const centerChunkY = Math.floor(worldY / PLANET_CHUNK_SIZE);
  const nearby = [];

  for (let chunkY = centerChunkY - chunkRadius; chunkY <= centerChunkY + chunkRadius; chunkY += 1) {
    for (let chunkX = centerChunkX - chunkRadius; chunkX <= centerChunkX + chunkRadius; chunkX += 1) {
      nearby.push(...getPlanetsInChunk(chunkX, chunkY));
    }
  }

  return nearby;
}

function getNearbyPlanets() {
  return getPlanetsAround(player.worldX, player.worldY, PLANET_CHUNK_RADIUS);
}

function getGravityAcceleration(worldX, worldY, bodyRadius) {
  const planets = getPlanetsAround(worldX, worldY, PLANET_CHUNK_RADIUS);
  let accelerationX = 0;
  let accelerationY = 0;

  for (let i = 0; i < planets.length; i += 1) {
    const planet = planets[i];
    const dx = planet.x - worldX;
    const dy = planet.y - worldY;
    const distanceSq = dx * dx + dy * dy;
    const minDistance = planet.radius + bodyRadius * 0.8;
    const minDistanceSq = minDistance * minDistance;
    const clampedDistanceSq = Math.max(distanceSq, minDistanceSq);
    const distance = Math.sqrt(clampedDistanceSq);

    const accelerationMagnitude = (PLANET_GRAVITY_CONSTANT * planet.mass) / clampedDistanceSq;
    accelerationX += (dx / distance) * accelerationMagnitude;
    accelerationY += (dy / distance) * accelerationMagnitude;
  }

  return { x: accelerationX, y: accelerationY };
}

function applyPlanetGravity(deltaTime) {
  const acceleration = getGravityAcceleration(player.worldX, player.worldY, player.radius);
  player.velocityX += acceleration.x * deltaTime;
  player.velocityY += acceleration.y * deltaTime;
}

function hasPlanetCollisionAt(worldX, worldY, bodyRadius) {
  const planets = getPlanetsAround(worldX, worldY, PLANET_CHUNK_RADIUS);

  for (let i = 0; i < planets.length; i += 1) {
    const planet = planets[i];
    const dx = planet.x - worldX;
    const dy = planet.y - worldY;
    const collisionDistance = planet.radius + bodyRadius;

    if (dx * dx + dy * dy <= collisionDistance * collisionDistance) {
      return true;
    }
  }

  return false;
}

function hasPlanetCollision() {
  return hasPlanetCollisionAt(player.worldX, player.worldY, player.radius);
}

function resetPlayerState() {
  player.worldX = 0;
  player.worldY = 0;
  player.velocityX = 0;
  player.velocityY = 0;
  player.angle = PLAYER_START_ANGLE;

  input.up = false;
  input.left = false;
  input.right = false;
  boostTimeRemaining = 0;

  stopThrustSound();
  stopBoostSound();
}

function resetGame() {
  lives = INITIAL_LIVES;
  destroyedTargets = 0;
  boostCharges = BOOST_MAX_CHARGES;

  resetPlayerState();
  missiles.length = 0;

  initStars();
  spawnTarget();
}

function onPlayerPlanetCollision() {
  lives -= 1;

  if (lives <= 0) {
    resetGame();
    return;
  }

  resetPlayerState();
}

function activateBoost() {
  if (boostCharges <= 0 || boostTimeRemaining > 0) {
    return;
  }

  boostCharges -= 1;
  boostTimeRemaining = BOOST_DURATION;
}

function targetOverlapsPlanet(worldX, worldY, targetSize) {
  const planets = getPlanetsAround(worldX, worldY, 1);
  const targetRadius = targetSize / 2;

  for (let i = 0; i < planets.length; i += 1) {
    const planet = planets[i];
    const dx = planet.x - worldX;
    const dy = planet.y - worldY;
    const minDistance = planet.radius + targetRadius;

    if (dx * dx + dy * dy <= minDistance * minDistance) {
      return true;
    }
  }

  return false;
}

function spawnTarget() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = randomRange(TARGET_MIN_DISTANCE, TARGET_MAX_DISTANCE);
    const x = player.worldX + Math.cos(angle) * distance;
    const y = player.worldY + Math.sin(angle) * distance;

    if (targetOverlapsPlanet(x, y, TARGET_SIZE)) {
      continue;
    }

    target = { x, y, size: TARGET_SIZE };
    return;
  }

  target = { x: player.worldX + TARGET_MAX_DISTANCE, y: player.worldY, size: TARGET_SIZE };
}

function onTargetDestroyed() {
  destroyedTargets += 1;

  if (destroyedTargets % 2 === 0) {
    boostCharges = Math.min(BOOST_MAX_CHARGES, boostCharges + 1);
  }

  spawnTarget();
}

function missileHitsTarget(missile) {
  if (!target) {
    return false;
  }

  const halfSize = target.size / 2;
  const nearestX = Math.max(target.x - halfSize, Math.min(missile.worldX, target.x + halfSize));
  const nearestY = Math.max(target.y - halfSize, Math.min(missile.worldY, target.y + halfSize));
  const dx = missile.worldX - nearestX;
  const dy = missile.worldY - nearestY;

  return dx * dx + dy * dy <= missile.radius * missile.radius;
}

function shootMissile() {
  playShootSound();

  const noseDistance = player.radius * 1.28;
  const spawnX = player.worldX + Math.cos(player.angle) * noseDistance;
  const spawnY = player.worldY + Math.sin(player.angle) * noseDistance;

  missiles.push({
    worldX: spawnX,
    worldY: spawnY,
    velocityX: player.velocityX + Math.cos(player.angle) * MISSILE_SPEED,
    velocityY: player.velocityY + Math.sin(player.angle) * MISSILE_SPEED,
    radius: MISSILE_RADIUS,
    life: MISSILE_LIFETIME,
  });
}

function updateMissiles(deltaTime) {
  for (let i = missiles.length - 1; i >= 0; i -= 1) {
    const missile = missiles[i];
    const acceleration = getGravityAcceleration(missile.worldX, missile.worldY, missile.radius);

    missile.velocityX += acceleration.x * MISSILE_GRAVITY_MULTIPLIER * deltaTime;
    missile.velocityY += acceleration.y * MISSILE_GRAVITY_MULTIPLIER * deltaTime;
    missile.worldX += missile.velocityX * deltaTime;
    missile.worldY += missile.velocityY * deltaTime;
    missile.life -= deltaTime;

    if (missileHitsTarget(missile)) {
      missiles.splice(i, 1);
      onTargetDestroyed();
      continue;
    }

    if (missile.life <= 0 || hasPlanetCollisionAt(missile.worldX, missile.worldY, missile.radius)) {
      missiles.splice(i, 1);
    }
  }
}

function renderTarget(centerX, centerY) {
  if (!target) {
    return;
  }

  const screenX = centerX + (target.x - player.worldX);
  const screenY = centerY + (target.y - player.worldY);
  const halfSize = target.size / 2;

  if (
    screenX < -target.size ||
    screenX > canvas.width + target.size ||
    screenY < -target.size ||
    screenY > canvas.height + target.size
  ) {
    return;
  }

  ctx.fillStyle = '#ff3b3b';
  ctx.fillRect(screenX - halfSize, screenY - halfSize, target.size, target.size);
}

function renderTargetDirectionArrow() {
  if (!target) {
    return;
  }

  const dx = target.x - player.worldX;
  const dy = target.y - player.worldY;
  const angle = Math.atan2(dy, dx);
  const arrowX = canvas.width / 2;
  const arrowY = 24;

  ctx.save();
  ctx.translate(arrowX, arrowY);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffd447';
  ctx.beginPath();
  ctx.moveTo(TARGET_ARROW_SIZE, 0);
  ctx.lineTo(-TARGET_ARROW_SIZE * 0.7, TARGET_ARROW_SIZE * 0.55);
  ctx.lineTo(-TARGET_ARROW_SIZE * 0.7, -TARGET_ARROW_SIZE * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderMissiles(centerX, centerY) {
  ctx.fillStyle = '#ffb347';

  for (let i = 0; i < missiles.length; i += 1) {
    const missile = missiles[i];
    const screenX = centerX + (missile.worldX - player.worldX);
    const screenY = centerY + (missile.worldY - player.worldY);

    if (screenX < -40 || screenX > canvas.width + 40 || screenY < -40 || screenY > canvas.height + 40) {
      continue;
    }

    ctx.beginPath();
    ctx.arc(screenX, screenY, missile.radius, 0, Math.PI * 2);
    ctx.fill();
  }
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
  }
}

function renderMinimap() {
  const compactMap = canvas.width < 720;
  const mapWidth = compactMap ? Math.min(180, canvas.width * 0.36) : MINIMAP_WIDTH;
  const mapHeight = mapWidth * (canvas.height / canvas.width);
  const mapX = canvas.width - mapWidth - MINIMAP_MARGIN;
  const mapY = canvas.height - mapHeight - MINIMAP_MARGIN;
  const mapCenterX = mapX + mapWidth / 2;
  const mapCenterY = mapY + mapHeight / 2;
  const rangeX = MINIMAP_RANGE;
  const rangeY = MINIMAP_RANGE * (canvas.height / canvas.width);
  const halfRangeX = rangeX / 2;
  const halfRangeY = rangeY / 2;
  const scaleX = mapWidth / rangeX;
  const scaleY = mapHeight / rangeY;
  const planets = getNearbyPlanets();

  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 22, 0.78)';
  ctx.fillRect(mapX, mapY, mapWidth, mapHeight);
  ctx.strokeStyle = 'rgba(180, 205, 255, 0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mapX, mapY, mapWidth, mapHeight);

  ctx.beginPath();
  ctx.rect(mapX + 1, mapY + 1, mapWidth - 2, mapHeight - 2);
  ctx.clip();

  for (let i = 0; i < planets.length; i += 1) {
    const planet = planets[i];
    const dx = planet.x - player.worldX;
    const dy = planet.y - player.worldY;

    if (Math.abs(dx) > halfRangeX || Math.abs(dy) > halfRangeY) {
      continue;
    }

    const px = mapCenterX + dx * scaleX;
    const py = mapCenterY + dy * scaleY;
    const dotRadius = Math.max(2, Math.min(5, planet.radius * 0.03));

    ctx.fillStyle = planet.color;
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (target) {
    const targetDx = target.x - player.worldX;
    const targetDy = target.y - player.worldY;

    if (Math.abs(targetDx) <= halfRangeX && Math.abs(targetDy) <= halfRangeY) {
      const targetPx = mapCenterX + targetDx * scaleX;
      const targetPy = mapCenterY + targetDy * scaleY;
      const targetDotSize = 4;

      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(
        targetPx - targetDotSize / 2,
        targetPy - targetDotSize / 2,
        targetDotSize,
        targetDotSize
      );
    }
  }

  if (target) {
    const targetDx = target.x - player.worldX;
    const targetDy = target.y - player.worldY;

    if (Math.abs(targetDx) <= halfRangeX && Math.abs(targetDy) <= halfRangeY) {
      const targetPx = mapCenterX + targetDx * scaleX;
      const targetPy = mapCenterY + targetDy * scaleY;
      const targetDotSize = 4;

      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(
        targetPx - targetDotSize / 2,
        targetPy - targetDotSize / 2,
        targetDotSize,
        targetDotSize
      );
    }
  }

  ctx.restore();

  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.arc(mapCenterX, mapCenterY, 3, 0, Math.PI * 2);
  ctx.fill();

  const speed = Math.hypot(player.velocityX, player.velocityY);
  const speedRatio = Math.min(1, speed / player.maxSpeed);
  const headingLineLength = 7 + speedRatio * 15;

  ctx.strokeStyle = player.markerColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mapCenterX, mapCenterY);
  ctx.lineTo(
    mapCenterX + Math.cos(player.angle) * headingLineLength,
    mapCenterY + Math.sin(player.angle) * headingLineLength
  );
  ctx.stroke();

  ctx.fillStyle = 'rgba(225, 235, 255, 0.95)';
  ctx.font = compactMap ? '10px monospace' : '12px monospace';
  ctx.fillText('MINIMAP', mapX + 6, mapY + 14);
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

  if (boostTimeRemaining > 0) {
    boostTimeRemaining = Math.max(0, boostTimeRemaining - deltaTime);
  }

  if (input.left) {
    player.angle -= player.rotationSpeed * deltaTime;
  }
  if (input.right) {
    player.angle += player.rotationSpeed * deltaTime;
  }

  if (input.up) {
    const thrustMultiplier = boostTimeRemaining > 0 ? 2 : 1;
    const thrustAcceleration = player.thrust * thrustMultiplier;
    player.velocityX += Math.cos(player.angle) * thrustAcceleration * deltaTime;
    player.velocityY += Math.sin(player.angle) * thrustAcceleration * deltaTime;
  }

  if (input.up) {
    startThrustSound();
  } else {
    stopThrustSound();
  }

  if (boostTimeRemaining > 0) {
    startBoostSound();
  } else {
    stopBoostSound();
  }

  if (boostTimeRemaining <= 0) {
    applyPlanetGravity(deltaTime);
  }

  const speed = Math.hypot(player.velocityX, player.velocityY);
  if (speed > player.maxSpeed) {
    const scale = player.maxSpeed / speed;
    player.velocityX *= scale;
    player.velocityY *= scale;
  }

  player.worldX += player.velocityX * deltaTime;
  player.worldY += player.velocityY * deltaTime;

  if (hasPlanetCollision()) {
    onPlayerPlanetCollision();
    return;
  }

  updateMissiles(deltaTime);
  updateStars(deltaTime, player.worldX - previousWorldX, player.worldY - previousWorldY);

  if (!target) {
    spawnTarget();
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  renderPlanets(centerX, centerY);
  renderTarget(centerX, centerY);
  renderMissiles(centerX, centerY);
  renderTargetDirectionArrow();
  renderMinimap();

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

  ctx.fillStyle = player.markerColor;
  ctx.beginPath();
  ctx.arc(noseX, noseY, 3, 0, Math.PI * 2);
  ctx.fill();

  if (boostTimeRemaining > 0) {
    const boostRatio = boostTimeRemaining / BOOST_DURATION;
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() * 0.02);
    const edgeAlpha = Math.min(0.42, 0.2 + boostRatio * 0.22 * pulse);
    const innerRadius = Math.min(canvas.width, canvas.height) * 0.1;
    const outerRadius = Math.hypot(canvas.width, canvas.height) * 0.62;
    const vignette = ctx.createRadialGradient(centerX, centerY, innerRadius, centerX, centerY, outerRadius);

    vignette.addColorStop(0, 'rgba(255, 255, 255, 0)');
    vignette.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    vignette.addColorStop(1, `rgba(255, 255, 255, ${edgeAlpha})`);

    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const speed = Math.hypot(player.velocityX, player.velocityY);
  const compactHud = canvas.width < 720;
  ctx.save();
  ctx.fillStyle = '#f0f0f0';
  ctx.font = compactHud ? '13px monospace' : '16px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const controlsLabel = isCoarsePointer
    ? 'Touch: Thrust/Left/Right/Shoot/Boost'
    : 'Up: Thrust | Left/Right: Rotate | C: Boost | Space: Shoot';
  ctx.fillText(controlsLabel, 16, compactHud ? 24 : 28);
  ctx.fillText(`Speed: ${speed.toFixed(1)}`, 16, compactHud ? 44 : 50);

  ctx.textAlign = 'right';
  ctx.fillText(`Lives: ${lives}`, canvas.width - 16, compactHud ? 24 : 28);
  ctx.fillText(`Targets destroyed: ${destroyedTargets}`, canvas.width - 16, compactHud ? 44 : 50);
  ctx.fillText(`Boost: ${boostCharges}/${BOOST_MAX_CHARGES}`, canvas.width - 16, compactHud ? 64 : 72);
  ctx.restore();
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

function bindTouchControls() {
  const controls = document.querySelector('.touch-controls');
  if (!controls) {
    return;
  }

  const activePointers = new Map();

  function setActionState(action, isPressed) {
    if (action === 'up') {
      input.up = isPressed;
    } else if (action === 'left') {
      input.left = isPressed;
    } else if (action === 'right') {
      input.right = isPressed;
    }
  }

  function beginAction(button, pointerId) {
    const action = button.dataset.action;
    if (!action) {
      return;
    }

    ensureAudioContext();
    activePointers.set(pointerId, action);
    button.classList.add('is-active');

    if (action === 'shoot') {
      shootMissile();
      return;
    }

    if (action === 'boost') {
      activateBoost();
      return;
    }

    setActionState(action, true);
  }

  function endAction(button, pointerId) {
    const action = activePointers.get(pointerId);
    if (!action) {
      return;
    }

    activePointers.delete(pointerId);
    button.classList.remove('is-active');
    setActionState(action, false);
  }

  const buttons = controls.querySelectorAll('[data-action]');
  buttons.forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      beginAction(button, event.pointerId);
    });

    button.addEventListener('pointerup', (event) => {
      event.preventDefault();
      endAction(button, event.pointerId);
    });

    button.addEventListener('pointercancel', (event) => {
      endAction(button, event.pointerId);
    });

    button.addEventListener('lostpointercapture', (event) => {
      endAction(button, event.pointerId);
    });
  });
}

window.addEventListener('keydown', (event) => {
  ensureAudioContext();

  if (event.code === 'Space' && !event.repeat) {
    shootMissile();
  }
  if (event.code === 'KeyC' && !event.repeat) {
    activateBoost();
  }

  setKeyState(event.code, true);
});

window.addEventListener('keyup', (event) => {
  setKeyState(event.code, false);
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
bindTouchControls();
spawnTarget();
requestAnimationFrame((timestamp) => {
  lastTime = timestamp;
  gameLoop(timestamp);
});
