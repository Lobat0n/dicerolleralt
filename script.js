import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';

// --- Configuration ---
const config = {
    maxDice: 50,
    settleThreshold: 0.15,
    settleTimeThreshold: 30,
    baseDieColor: 0xeeeeee,
    floorColor: 0x2a1a0e,
    wallColor: 0x666666,
    showWallVisuals: false,
};

// --- DOM Elements ---
const canvas = document.getElementById('dice-canvas');
const rollButton = document.getElementById('roll-button');
const clearButton = document.getElementById('clear-button');
const resultsTotalElement = document.getElementById('total-result');
const resultsIndividualElement = document.getElementById('individual-results');
const diceInputs = {
    d4: document.getElementById('d4'),
    d6: document.getElementById('d6'),
    d8: document.getElementById('d8'),
    d10: document.getElementById('d10'),
    d100: document.getElementById('d100'),
    d12: document.getElementById('d12'),
    d20: document.getElementById('d20'),
};
const mainContent = document.querySelector('.main-content');
const resultOverlay = document.getElementById('result-overlay');
const resultOverlayTotal = resultOverlay.querySelector('.result-total');
const resultOverlayBreakdown = resultOverlay.querySelector('.result-breakdown');
const shareRollButton = document.getElementById('share-roll-button');
const shareConfigButton = document.getElementById('share-config-button');
const powerRollButton = document.getElementById('power-roll-button');
const powerMarker = document.getElementById('power-marker');
const spinMarker = document.getElementById('spin-marker');
const powerValueEl = document.getElementById('power-value');
const spinValueEl = document.getElementById('spin-value');
const powerTrack = document.getElementById('power-track');
const spinTrack = document.getElementById('spin-track');
const soundToggle = document.getElementById('sound-toggle');
const controlsPanel = document.getElementById('controls-panel');

// --- Sound State ---
let soundEnabled = true;

// --- Power Bar State ---
let powerBarActive = false;
let powerBarPhase = 'idle'; // 'idle' | 'power' | 'spin' | 'done'
let powerVal = 0;
let spinVal = 0;
let powerDir = 1;
let spinDir = 1;
let powerBarAnimId = null;
const BAR_SPEED = 2.5;

function animatePowerBars() {
    if (powerBarPhase === 'power') {
        powerVal += BAR_SPEED * powerDir;
        if (powerVal >= 100) { powerVal = 100; powerDir = -1; }
        if (powerVal <= 0) { powerVal = 0; powerDir = 1; }
        powerMarker.style.left = `calc(${powerVal}% - 3px)`;
        powerValueEl.textContent = Math.round(powerVal);
    }
    if (powerBarPhase === 'spin') {
        spinVal += BAR_SPEED * spinDir;
        if (spinVal >= 100) { spinVal = 100; spinDir = -1; }
        if (spinVal <= 0) { spinVal = 0; spinDir = 1; }
        spinMarker.style.left = `calc(${spinVal}% - 3px)`;
        spinValueEl.textContent = Math.round(spinVal);
    }
    if (powerBarPhase !== 'idle' && powerBarPhase !== 'done') {
        powerBarAnimId = requestAnimationFrame(animatePowerBars);
    }
}

function resetPowerBars() {
    powerBarPhase = 'idle';
    powerVal = 0;
    spinVal = 0;
    powerDir = 1;
    spinDir = 1;
    powerMarker.style.left = '0%';
    spinMarker.style.left = '0%';
    powerMarker.classList.remove('stopped');
    spinMarker.classList.remove('stopped');
    powerValueEl.textContent = '-';
    spinValueEl.textContent = '-';
    powerRollButton.textContent = 'Power Roll';
    powerRollButton.classList.remove('waiting');
    if (powerBarAnimId) cancelAnimationFrame(powerBarAnimId);
}

function onPowerRollClick() {
    if (rolling) return;

    if (powerBarPhase === 'idle') {
        resetPowerBars();
        powerBarPhase = 'power';
        powerRollButton.textContent = 'Stop Power!';
        powerRollButton.classList.add('waiting');
        animatePowerBars();
    } else if (powerBarPhase === 'power') {
        powerMarker.classList.add('stopped');
        powerBarPhase = 'spin';
        powerRollButton.textContent = 'Stop Spin!';
    } else if (powerBarPhase === 'spin') {
        spinMarker.classList.add('stopped');
        powerBarPhase = 'done';
        powerRollButton.classList.remove('waiting');
        powerRollButton.textContent = 'Rolling...';
        if (powerBarAnimId) cancelAnimationFrame(powerBarAnimId);
        handleRollClick(powerVal / 100, spinVal / 100);
    }
}

function onPowerTrackClick() { if (powerBarPhase === 'power') onPowerRollClick(); }
function onSpinTrackClick() { if (powerBarPhase === 'spin') onPowerRollClick(); }

// --- Sound System (Web Audio API) ---
let audioCtx = null;
function getAudioCtx() {
    if (!soundEnabled) return null;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playDiceHit(intensity = 0.5) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.06 + intensity * 0.04;

    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800 + intensity * 1200;
    filter.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + dur);
}

function playRollSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.8;

    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(400, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + dur);
}

function playSettleChime() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        const t = now + i * 0.08;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
    });
}

// Collision sound handler
let lastCollisionSound = 0;
function onPhysicsCollision(e) {
    const now = performance.now();
    if (now - lastCollisionSound < 40) return;
    lastCollisionSound = now;
    const impact = e.contact ? Math.min(1, e.contact.getImpactVelocityAlongNormal() / 15) : 0.3;
    if (impact > 0.05) playDiceHit(impact);
}

// --- State ---
let scene, camera, renderer, world, controls, directionalLight;
let diceMeshes = [];
let diceBodies = [];
let floorMesh, floorBody;
let walls = [];
let rolling = false;
let settleCheck = new Map();
let cameraAnimating = false;
let lastRollResults = null; // Store last results for sharing

// --- Camera Animation State ---
const cameraDefault = { pos: new THREE.Vector3(0, 20, 18), lookAt: new THREE.Vector3(0, 0, 0) };
let cameraTarget = cameraDefault;
let cameraLerpSpeed = 2.5;

// --- Physics Materials ---
const diceMaterial = new CANNON.Material('diceMaterial');
const floorMaterial = new CANNON.Material('floorMaterial');
const wallMaterial = new CANNON.Material('wallMaterial');

// --- Texture & Number Functions ---
function createFaceTexture(text, size, bgColor, textColor) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);
    const fontSize = size * 0.55;
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(4, fontSize * 0.08);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, size / 2, size / 2);
    ctx.fillStyle = textColor;
    ctx.fillText(text, size / 2, size / 2);
    return c;
}

function createNumberCanvas(text, size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const fontSize = text.length > 2 ? size * 0.5 : text.length > 1 ? size * 0.6 : size * 0.7;
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(4, fontSize * 0.12);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, size / 2, size / 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, size / 2, size / 2);

    return c;
}

// --- Texture Caches ---
const numberTextureCache = new Map();
const faceTextureCache = new Map();

function getCachedNumberTexture(label, size) {
    const key = `${label}_${size}`;
    if (!numberTextureCache.has(key)) {
        const canvas = createNumberCanvas(label, size);
        const texture = new THREE.CanvasTexture(canvas);
        numberTextureCache.set(key, texture);
    }
    return numberTextureCache.get(key);
}

function getCachedFaceTexture(text, size, bgColor, textColor) {
    const key = `${text}_${size}_${bgColor}_${textColor}`;
    if (!faceTextureCache.has(key)) {
        const canvas = createFaceTexture(text, size, bgColor, textColor);
        const texture = new THREE.CanvasTexture(canvas);
        faceTextureCache.set(key, texture);
    }
    return faceTextureCache.get(key);
}

// --- Atlas Texture Cache (merged number planes) ---
const atlasTextureCache = new Map();

function getAtlasTexture(labels, cellSize) {
    const key = labels.join('_');
    if (atlasTextureCache.has(key)) return atlasTextureCache.get(key);

    const n = labels.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);

    const canvas = document.createElement('canvas');
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        ctx.drawImage(createNumberCanvas(labels[i], cellSize), col * cellSize, row * cellSize);
    }

    const texture = new THREE.CanvasTexture(canvas);
    atlasTextureCache.set(key, texture);
    return texture;
}

function createMergedNumberMesh(faces, labels) {
    const n = Math.min(faces.length, labels.length);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const atlas = getAtlasTexture(labels, 256);

    const positions = new Float32Array(n * 4 * 3);
    const uvs = new Float32Array(n * 4 * 2);
    const indices = new Uint16Array(n * 6);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const fallback = new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
        const face = faces[i];
        const normal = face.normal;
        const halfSize = face.radius * 0.45;

        // Build local tangent frame
        right.crossVectors(worldUp, normal);
        if (right.lengthSq() < 0.001) right.crossVectors(fallback, normal);
        right.normalize();
        up.crossVectors(normal, right).normalize();

        const cx = face.center.x + normal.x * 0.03;
        const cy = face.center.y + normal.y * 0.03;
        const cz = face.center.z + normal.z * 0.03;

        // 4 vertices per quad: BL, BR, TR, TL
        const pi = i * 12;
        positions[pi]     = cx + (-right.x - up.x) * halfSize;
        positions[pi + 1] = cy + (-right.y - up.y) * halfSize;
        positions[pi + 2] = cz + (-right.z - up.z) * halfSize;
        positions[pi + 3] = cx + (right.x - up.x) * halfSize;
        positions[pi + 4] = cy + (right.y - up.y) * halfSize;
        positions[pi + 5] = cz + (right.z - up.z) * halfSize;
        positions[pi + 6] = cx + (right.x + up.x) * halfSize;
        positions[pi + 7] = cy + (right.y + up.y) * halfSize;
        positions[pi + 8] = cz + (right.z + up.z) * halfSize;
        positions[pi + 9]  = cx + (-right.x + up.x) * halfSize;
        positions[pi + 10] = cy + (-right.y + up.y) * halfSize;
        positions[pi + 11] = cz + (-right.z + up.z) * halfSize;

        // UV mapping to atlas grid cell
        const col = i % cols;
        const row = Math.floor(i / cols);
        const u0 = col / cols;
        const u1 = (col + 1) / cols;
        const v0 = 1 - (row + 1) / rows;
        const v1 = 1 - row / rows;

        const ui = i * 8;
        uvs[ui]     = u0; uvs[ui + 1] = v0;
        uvs[ui + 2] = u1; uvs[ui + 3] = v0;
        uvs[ui + 4] = u1; uvs[ui + 5] = v1;
        uvs[ui + 6] = u0; uvs[ui + 7] = v1;

        // Two triangles per quad
        const bi = i * 4;
        const ii = i * 6;
        indices[ii]     = bi;     indices[ii + 1] = bi + 1; indices[ii + 2] = bi + 2;
        indices[ii + 3] = bi;     indices[ii + 4] = bi + 2; indices[ii + 5] = bi + 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const material = new THREE.MeshBasicMaterial({
        map: atlas,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    return new THREE.Mesh(geo, material);
}

function getGeometricFaces(geometry) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = geo.getAttribute('position');
    const triangleCount = pos.count / 3;
    const groups = [];
    const eps = 0.01;

    for (let tri = 0; tri < triangleCount; tri++) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, tri * 3);
        const b = new THREE.Vector3().fromBufferAttribute(pos, tri * 3 + 1);
        const c = new THREE.Vector3().fromBufferAttribute(pos, tri * 3 + 2);
        const normal = new THREE.Vector3().crossVectors(
            new THREE.Vector3().subVectors(b, a),
            new THREE.Vector3().subVectors(c, a)
        ).normalize();

        let found = false;
        for (const g of groups) {
            if (Math.abs(normal.x - g.normal.x) < eps &&
                Math.abs(normal.y - g.normal.y) < eps &&
                Math.abs(normal.z - g.normal.z) < eps) {
                g.vertices.push(a, b, c);
                found = true;
                break;
            }
        }
        if (!found) {
            groups.push({ normal: normal.clone(), vertices: [a, b, c] });
        }
    }

    return groups.map(g => {
        const center = new THREE.Vector3();
        g.vertices.forEach(v => center.add(v));
        center.divideScalar(g.vertices.length);
        let maxDist = 0;
        g.vertices.forEach(v => {
            const d = v.distanceTo(center);
            if (d > maxDist) maxDist = d;
        });
        return { normal: g.normal, center, radius: maxDist };
    });
}

function addD4Numbers(mesh, geometry, precomputedFaces) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = geo.getAttribute('position');

    const uniqueVerts = [];
    const eps = 0.01;
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        let found = false;
        for (const uv of uniqueVerts) {
            if (v.distanceTo(uv) < eps) { found = true; break; }
        }
        if (!found) uniqueVerts.push(v.clone());
    }

    const vertexValues = uniqueVerts.map((v, i) => ({ pos: v, value: i + 1 }));
    mesh.userData.d4Vertices = vertexValues;

    const faces = precomputedFaces || getGeometricFaces(geometry);

    for (const face of faces) {
        const faceVerts = [];
        for (const vv of vertexValues) {
            const toVert = new THREE.Vector3().subVectors(vv.pos, face.center);
            const distFromPlane = Math.abs(toVert.dot(face.normal));
            if (distFromPlane < eps * 10) {
                faceVerts.push(vv);
            }
        }

        for (const fv of faceVerts) {
            const labelPos = new THREE.Vector3().lerpVectors(face.center, fv.pos, 0.6);
            const offset = face.normal.clone().multiplyScalar(0.03);
            labelPos.add(offset);

            const texture = getCachedNumberTexture(fv.value.toString(), 128);

            const size = 0.6;
            const planeGeo = new THREE.PlaneGeometry(size, size);
            const planeMat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            const plane = new THREE.Mesh(planeGeo, planeMat);
            plane.position.copy(labelPos);

            const target = labelPos.clone().add(face.normal);
            plane.lookAt(target);

            mesh.add(plane);
        }
    }
}

function readD4Value(dieMesh) {
    const verts = dieMesh.userData.d4Vertices;
    if (!verts) return 1;

    const worldQuaternion = dieMesh.getWorldQuaternion(new THREE.Quaternion());
    const worldPos = dieMesh.getWorldPosition(new THREE.Vector3());

    let highestY = -Infinity;
    let result = 1;
    for (const v of verts) {
        const worldVert = v.pos.clone().applyQuaternion(worldQuaternion).add(worldPos);
        if (worldVert.y > highestY) {
            highestY = worldVert.y;
            result = v.value;
        }
    }
    return result;
}

function addFaceNumbers(mesh, geometry, labels, precomputedFaces) {
    const faces = precomputedFaces || getGeometricFaces(geometry);
    const faceCount = labels.length;

    const faceData = [];
    for (let i = 0; i < Math.min(faces.length, faceCount); i++) {
        const face = faces[i];
        const label = labels[i];
        const numericValue = parseInt(label) || 0;
        faceData.push({ normal: face.normal.clone(), value: numericValue, label: label });
    }

    mesh.userData.faceData = faceData;
    mesh.add(createMergedNumberMesh(faces, labels));
}

function createD6Materials(baseColor) {
    const bgHex = '#' + baseColor.toString(16).padStart(6, '0');
    const faces = [4, 3, 1, 6, 2, 5];
    const materials = [];
    for (let i = 0; i < 6; i++) {
        const texture = getCachedFaceTexture(faces[i].toString(), 256, bgHex, '#111111');
        materials.push(new THREE.MeshStandardMaterial({
            map: texture, roughness: 0.4, metalness: 0.2
        }));
    }
    return materials;
}

// --- Initialization ---
function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1510);

    // Camera
    const aspect = mainContent.clientWidth / mainContent.clientHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    camera.position.set(0, 20, 18);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.enabled = false;

    // Lighting — warm tavern atmosphere
    const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.6);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xfff0dd, 0.8);
    directionalLight.position.set(8, 15, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    const shadowBounds = 15;
    directionalLight.shadow.camera.left = -shadowBounds;
    directionalLight.shadow.camera.right = shadowBounds;
    directionalLight.shadow.camera.top = shadowBounds;
    directionalLight.shadow.camera.bottom = -shadowBounds;
    scene.add(directionalLight);

    // Warm fireplace point light
    const fireplaceLight = new THREE.PointLight(0xd4a349, 0.4, 40);
    fireplaceLight.position.set(-10, 5, -8);
    scene.add(fireplaceLight);

    // Physics World
    world = new CANNON.World({
        gravity: new CANNON.Vec3(0, -35, 0)
    });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;

    const diceFloorContact = new CANNON.ContactMaterial(diceMaterial, floorMaterial, {
        friction: 0.8,
        restitution: 0.1,
    });
    world.addContactMaterial(diceFloorContact);

    const diceWallContact = new CANNON.ContactMaterial(diceMaterial, wallMaterial, {
        friction: 0.3,
        restitution: 0.4,
    });
    world.addContactMaterial(diceWallContact);

    const diceDiceContact = new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
        friction: 0.5,
        restitution: 0.15,
    });
    world.addContactMaterial(diceDiceContact);

    // Floor
    const floorGeometry = new THREE.PlaneGeometry(100, 100);
    const floorMaterial3D = new THREE.MeshStandardMaterial({
        color: config.floorColor,
        roughness: 0.92,
        metalness: 0.1,
    });
    floorMesh = new THREE.Mesh(floorGeometry, floorMaterial3D);
    floorMesh.receiveShadow = true;
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.1;
    scene.add(floorMesh);

    floorBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
        material: floorMaterial,
    });
    floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    floorBody.position.copy(floorMesh.position);
    world.addBody(floorBody);

    createWalls();

    // Event Listeners
    rollButton.addEventListener('click', () => handleRollClick());
    clearButton.addEventListener('click', clearDice);
    powerRollButton.addEventListener('click', onPowerRollClick);
    powerTrack.addEventListener('click', onPowerTrackClick);
    spinTrack.addEventListener('click', onSpinTrackClick);
    window.addEventListener('resize', onWindowResize);

    // Keyboard handlers for power bar tracks
    powerTrack.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onPowerTrackClick(); }
    });
    spinTrack.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onSpinTrackClick(); }
    });

    // Sound toggle
    soundToggle.addEventListener('click', toggleSound);

    // Share buttons
    shareRollButton.addEventListener('click', shareRoll);
    shareConfigButton.addEventListener('click', shareConfig);

    // Dice counter +/- buttons
    document.querySelectorAll('.counter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const die = btn.dataset.die;
            const dir = parseInt(btn.dataset.dir);
            const input = diceInputs[die];
            const newVal = Math.max(0, Math.min(20, parseInt(input.value) + dir));
            input.value = newVal;
            updateDiceOptionStates();
            savePreferences();
            // Bounce animation
            input.classList.remove('bounce');
            void input.offsetWidth;
            input.classList.add('bounce');
        });
    });

    // Input change listeners
    for (const key in diceInputs) {
        diceInputs[key].addEventListener('change', () => {
            updateDiceOptionStates();
            savePreferences();
        });
    }

    // Mobile drawer: collapse/expand with drag handle + swipe
    if (window.innerWidth <= 900) {
        controlsPanel.classList.add('collapsed');

        // Drag handle toggle
        const dragHandle = document.getElementById('drag-handle');
        if (dragHandle) {
            dragHandle.addEventListener('click', () => controlsPanel.classList.toggle('collapsed'));
            dragHandle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    controlsPanel.classList.toggle('collapsed');
                }
            });
        }

        // Touch swipe
        let touchStartY = 0, touchStartTime = 0;
        controlsPanel.addEventListener('touchstart', (e) => {
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
        }, { passive: true });
        controlsPanel.addEventListener('touchend', (e) => {
            const dy = e.changedTouches[0].clientY - touchStartY;
            if (Date.now() - touchStartTime > 300) return;
            if (dy > 40 && controlsPanel.scrollTop <= 0)
                controlsPanel.classList.add('collapsed');
            else if (dy < -40 && controlsPanel.classList.contains('collapsed'))
                controlsPanel.classList.remove('collapsed');
        }, { passive: true });
    }

    // Restore preferences from localStorage
    restorePreferences();

    // Parse URL params for dice presets
    parseUrlPreset();

    // Initial state
    updateDiceOptionStates();
    onWindowResize();
    animate();
}

// --- Wall Creation ---
function createWalls() {
    const wallThickness = 2;
    const wallHeight = 20;
    const halfFov = (camera.fov * Math.PI / 180) / 2;
    const distanceToFloor = camera.position.y - floorMesh.position.y;
    let viewWidth = 2 * distanceToFloor * Math.tan(halfFov) * camera.aspect;
    let viewHeight = 2 * distanceToFloor * Math.tan(halfFov);
    const wallDistX = Math.max(12, viewWidth * 0.4);
    const wallDistZ = Math.max(12, viewHeight * 0.4);

    const wallMaterial3D = new THREE.MeshBasicMaterial({ color: config.wallColor, wireframe: true, visible: config.showWallVisuals });

    const wallsData = [
        { size: [wallDistX, wallHeight / 2, wallThickness / 2], pos: [0, wallHeight / 2, wallDistZ], rot: null },
        { size: [wallDistX, wallHeight / 2, wallThickness / 2], pos: [0, wallHeight / 2, -wallDistZ], rot: null },
        { size: [wallThickness / 2, wallHeight / 2, wallDistZ], pos: [wallDistX, wallHeight / 2, 0], rot: null },
        { size: [wallThickness / 2, wallHeight / 2, wallDistZ], pos: [-wallDistX, wallHeight / 2, 0], rot: null }
    ];

    wallsData.forEach(data => {
        const wallShape = new CANNON.Box(new CANNON.Vec3(...data.size));
        const wallBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: wallMaterial });
        wallBody.addShape(wallShape);
        wallBody.position.set(...data.pos);
        if (data.rot) {
            wallBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), data.rot);
        }
        world.addBody(wallBody);
        walls.push(wallBody);

        if (config.showWallVisuals) {
            const wallGeometry = new THREE.BoxGeometry(data.size[0]*2, data.size[1]*2, data.size[2]*2);
            const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial3D);
            wallMesh.position.copy(wallBody.position);
            if (wallBody.quaternion) wallMesh.quaternion.copy(wallBody.quaternion);
            scene.add(wallMesh);
        }
    });
}

// --- Dice Geometry and Physics Shapes ---
const diceData = {
    d4: {
        geometry: () => new THREE.TetrahedronGeometry(1.5),
        shape: () => createConvexPolyhedron(new THREE.TetrahedronGeometry(1.5)),
        mass: 1,
        color: 0xff4444,
        sides: 4
    },
    d6: {
        geometry: () => new THREE.BoxGeometry(1.8, 1.8, 1.8),
        shape: () => new CANNON.Box(new CANNON.Vec3(0.9, 0.9, 0.9)),
        mass: 1.2,
        color: 0xeeeeee,
        sides: 6
    },
    d8: {
        geometry: () => new THREE.OctahedronGeometry(1.4),
        shape: () => createConvexPolyhedron(new THREE.OctahedronGeometry(1.4)),
        mass: 1.4,
        color: 0x44cc44,
        sides: 8
    },
    d10: {
        geometry: () => new THREE.DodecahedronGeometry(1.4),
        shape: () => createConvexPolyhedron(new THREE.DodecahedronGeometry(1.4)),
        mass: 1.6,
        color: 0x6666ff,
        sides: 10
    },
    d100: {
        geometry: () => new THREE.DodecahedronGeometry(1.4),
        shape: () => createConvexPolyhedron(new THREE.DodecahedronGeometry(1.4)),
        mass: 1.6,
        color: 0x9933ff,
        sides: 10
    },
    d12: {
        geometry: () => new THREE.DodecahedronGeometry(1.4),
        shape: () => createConvexPolyhedron(new THREE.DodecahedronGeometry(1.4)),
        mass: 1.8,
        color: 0xffcc00,
        sides: 12
    },
    d20: {
        geometry: () => new THREE.IcosahedronGeometry(1.5),
        shape: () => createConvexPolyhedron(new THREE.IcosahedronGeometry(1.5)),
        mass: 2.0,
        color: 0xff8800,
        sides: 20
    }
};

function createConvexPolyhedron(geometry) {
    const positionAttribute = geometry.getAttribute('position');
    const vertexMap = new Map();
    const vertices = [];
    const vertexIndices = [];

    const epsilon = 0.0001;

    for (let i = 0; i < positionAttribute.count; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
        const key = `${Math.round(vertex.x / epsilon)}_${Math.round(vertex.y / epsilon)}_${Math.round(vertex.z / epsilon)}`;

        if (!vertexMap.has(key)) {
            vertexMap.set(key, vertices.length);
            vertices.push(new CANNON.Vec3(vertex.x, vertex.y, vertex.z));
        }
        vertexIndices.push(vertexMap.get(key));
    }

    const faces = [];
    if (geometry.index) {
        const indices = geometry.index.array;
        for (let i = 0; i < indices.length; i += 3) {
            const face = [
                vertexIndices[indices[i]],
                vertexIndices[indices[i + 1]],
                vertexIndices[indices[i + 2]]
            ];
            if (face[0] !== face[1] && face[1] !== face[2] && face[0] !== face[2]) {
                faces.push(face);
            }
        }
    } else {
        for (let i = 0; i < vertexIndices.length; i += 3) {
            const face = [vertexIndices[i], vertexIndices[i + 1], vertexIndices[i + 2]];
            if (face[0] !== face[1] && face[1] !== face[2] && face[0] !== face[2]) {
                faces.push(face);
            }
        }
    }

    return new CANNON.ConvexPolyhedron({ vertices, faces });
}

// --- Dice Creation ---
function getDieLabels(type, sides, geometry) {
    const faceCount = (cachedGeometricFaces[type] || getGeometricFaces(geometry)).length;

    let values;
    if (type === 'd100') {
        values = ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'];
    } else if (type === 'd10') {
        values = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    } else {
        values = [];
        for (let i = 1; i <= sides; i++) {
            values.push(i.toString());
        }
    }

    const labels = [];
    for (let i = 0; i < faceCount; i++) {
        labels.push(values[i % values.length]);
    }
    return labels;
}

function createDie(type) {
    const data = diceData[type];
    if (!data) return null;

    const geometry = cachedGeometries[type];
    let mesh;

    if (type === 'd6') {
        const materials = createD6Materials(data.color);
        mesh = new THREE.Mesh(geometry, materials);
        mesh.userData.faceData = [
            { normal: new THREE.Vector3(1, 0, 0), value: 4 },
            { normal: new THREE.Vector3(-1, 0, 0), value: 3 },
            { normal: new THREE.Vector3(0, 1, 0), value: 1 },
            { normal: new THREE.Vector3(0, -1, 0), value: 6 },
            { normal: new THREE.Vector3(0, 0, 1), value: 2 },
            { normal: new THREE.Vector3(0, 0, -1), value: 5 },
        ];
    } else if (type === 'd4') {
        const material = new THREE.MeshStandardMaterial({
            color: data.color,
            roughness: 0.4,
            metalness: 0.2,
        });
        mesh = new THREE.Mesh(geometry, material);
        addD4Numbers(mesh, geometry, cachedGeometricFaces[type]);
    } else {
        const material = new THREE.MeshStandardMaterial({
            color: data.color,
            roughness: 0.4,
            metalness: 0.2,
        });
        mesh = new THREE.Mesh(geometry, material);
        const labels = getDieLabels(type, data.sides, geometry);
        addFaceNumbers(mesh, geometry, labels, cachedGeometricFaces[type]);
    }

    mesh.castShadow = true;
    mesh.userData.type = type;

    const body = new CANNON.Body({
        mass: data.mass,
        shape: cachedShapes[type],
        material: diceMaterial,
        angularDamping: 0.8,
        linearDamping: 0.4,
        allowSleep: true,
        sleepSpeedLimit: 0.15,
        sleepTimeLimit: 0.4
    });
    body.userData = { mesh: mesh, type: type };
    body.addEventListener('collide', onPhysicsCollision);

    return { mesh, body };
}

// --- Pre-built Caches (built once at module load) ---
const cachedGeometries = {};
const cachedShapes = {};
const cachedGeometricFaces = {};

for (const type in diceData) {
    cachedGeometries[type] = diceData[type].geometry();
    cachedShapes[type] = diceData[type].shape();
    cachedGeometricFaces[type] = getGeometricFaces(cachedGeometries[type]);
}

// Pre-bake all textures at module load
(function initTextureCache() {
    for (const type in diceData) {
        if (type === 'd6') {
            const bgHex = '#' + diceData.d6.color.toString(16).padStart(6, '0');
            [4, 3, 1, 6, 2, 5].forEach(f => getCachedFaceTexture(f.toString(), 256, bgHex, '#111111'));
            continue;
        }
        if (type === 'd4') {
            for (let i = 1; i <= 4; i++) getCachedNumberTexture(i.toString(), 128);
            continue;
        }
        const labels = getDieLabels(type, diceData[type].sides, cachedGeometries[type]);
        labels.forEach(label => getCachedNumberTexture(label, 256));
        getAtlasTexture(labels, 256);
    }
})();

// --- Object Pool ---
const dicePool = {};

function acquireDie(type) {
    if (!dicePool[type]) dicePool[type] = [];
    const pool = dicePool[type];
    const inactive = pool.find(d => !d.active);
    if (inactive) {
        inactive.active = true;
        inactive.body.velocity.setZero();
        inactive.body.angularVelocity.setZero();
        inactive.body.force.setZero();
        inactive.body.torque.setZero();
        inactive.body.wakeUp();
        return inactive;
    }
    const die = createDie(type);
    die.active = true;
    pool.push(die);
    return die;
}

// --- Rolling Logic ---
function handleRollClick(powerNorm, spinNorm) {
    if (rolling) return;

    const power = (typeof powerNorm === 'number') ? powerNorm : (0.3 + Math.random() * 0.7);
    const spin = (typeof spinNorm === 'number') ? spinNorm : (0.3 + Math.random() * 0.7);

    rollDice(power, spin);

    // Auto-collapse mobile drawer
    if (window.innerWidth <= 900) {
        controlsPanel.classList.add('collapsed');
    }
}

function rollDice(power = 0.5, spin = 0.5) {
    rolling = true;
    directionalLight.castShadow = false;
    controls.enabled = false;
    cameraAnimating = true;
    cameraTarget = cameraDefault;

    // Hide result overlay + share button
    resultOverlay.classList.remove('visible', 'critical', 'fumble');
    resultOverlay.classList.add('hidden');
    shareRollButton.classList.add('hidden');

    // Add settling vignette
    mainContent.classList.remove('settling');

    setTimeout(() => resetPowerBars(), 300);
    clearDice();
    settleCheck.clear();
    resultsTotalElement.textContent = "Total: Rolling...";
    resultsIndividualElement.textContent = "Individual: -";

    const baseForce = 8;
    const maxForce = 20;
    const baseTorque = 12;
    const maxTorque = 35;
    const rollForce = baseForce + power * (maxForce - baseForce);
    const rollTorque = baseTorque + spin * (maxTorque - baseTorque);

    let totalDiceCount = 0;
    const diceToRoll = [];

    for (const type in diceInputs) {
        const count = parseInt(diceInputs[type].value, 10);
        if (isNaN(count) || count <= 0) continue;

        if (totalDiceCount + count > config.maxDice) {
            alert(`Too many dice! Maximum is ${config.maxDice}. Reducing count of ${type}.`);
            const remainingSlots = Math.max(0, config.maxDice - totalDiceCount);
            diceInputs[type].value = remainingSlots;
            for (let i = 0; i < remainingSlots; i++) {
                diceToRoll.push(type);
            }
            totalDiceCount = config.maxDice;
            break;
        } else {
            for (let i = 0; i < count; i++) {
                diceToRoll.push(type);
            }
            totalDiceCount += count;
        }
    }

    if (totalDiceCount === 0) {
        resultsTotalElement.textContent = "Total: 0";
        rolling = false;
        return;
    }

    const spread = 8;
    const initialHeight = 10;

    playRollSound();

    // Track analytics
    trackEvent('dice_roll');

    diceToRoll.forEach((type, index) => {
        try {
            const die = acquireDie(type);
            if (!die) return;

            const angle = (index / totalDiceCount) * Math.PI * 2;
            const radius = spread * Math.sqrt(Math.random());
            die.body.position.set(
                radius * Math.cos(angle),
                initialHeight + Math.random() * 4,
                radius * Math.sin(angle)
            );

            die.body.wakeUp();

            die.body.quaternion.setFromEuler(
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2
            );

            const forceMagnitude = rollForce + Math.random() * 4;
            const torqueMagnitude = rollTorque + Math.random() * 6;

            die.body.applyImpulse(
                new CANNON.Vec3(
                    (Math.random() - 0.5) * forceMagnitude * 0.6,
                    forceMagnitude * 0.4,
                    (Math.random() - 0.5) * forceMagnitude * 0.6
                ),
                new CANNON.Vec3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).scale(0.2)
            );

            die.body.angularVelocity.set(
                (Math.random() - 0.5) * torqueMagnitude,
                (Math.random() - 0.5) * torqueMagnitude,
                (Math.random() - 0.5) * torqueMagnitude
            );

            scene.add(die.mesh);
            world.addBody(die.body);
            diceMeshes.push(die.mesh);
            diceBodies.push(die.body);
            settleCheck.set(die.body.id, 0);
        } catch (e) {
            console.error(`Error creating die ${type}:`, e);
        }
    });
}

// --- Clear Dice ---
function clearDice() {
    diceMeshes.forEach(mesh => scene.remove(mesh));
    diceBodies.forEach(body => world.removeBody(body));
    for (const type in dicePool) {
        dicePool[type].forEach(d => d.active = false);
    }
    diceMeshes = [];
    diceBodies = [];
}

// --- Animation Loop ---
let lastTime = 0;
function animate(time = 0) {
    requestAnimationFrame(animate);

    const deltaTime = time - lastTime;
    lastTime = time;

    const dt = (isNaN(deltaTime) || deltaTime <= 0) ? 1/60 : Math.min(1/30, deltaTime * 0.001);

    try {
        if (diceBodies.length > 0) {
            world.step(1/60, dt, 2);

            let allSettled = diceBodies.length > 0;

            // Add vignette as dice slow down
            let maxVelocity = 0;

            diceBodies.forEach((body, index) => {
                const mesh = diceMeshes[index];
                if (mesh && body) {
                    mesh.position.copy(body.position);
                    mesh.quaternion.copy(body.quaternion);

                    const vel = body.velocity.lengthSquared() + body.angularVelocity.lengthSquared();
                    if (vel > maxVelocity) maxVelocity = vel;

                    const isMoving = body.sleepState !== CANNON.Body.SLEEPING &&
                                     (body.velocity.lengthSquared() > config.settleThreshold * config.settleThreshold ||
                                      body.angularVelocity.lengthSquared() > config.settleThreshold * config.settleThreshold);

                    if (!isMoving) {
                        let currentSettleCount = settleCheck.get(body.id) || 0;
                        currentSettleCount++;
                        settleCheck.set(body.id, currentSettleCount);
                        if (currentSettleCount < config.settleTimeThreshold) {
                            allSettled = false;
                        }
                    } else {
                        settleCheck.set(body.id, 0);
                        body.wakeUp();
                        allSettled = false;
                    }
                } else {
                    allSettled = false;
                }
            });

            // Show vignette as dice near settling
            if (rolling && maxVelocity < 5) {
                mainContent.classList.add('settling');
            }

            if (rolling && allSettled) {
                rolling = false;
                directionalLight.castShadow = true;
                const center = new THREE.Vector3();
                diceMeshes.forEach(m => center.add(m.position));
                center.divideScalar(diceMeshes.length);
                center.y = 0;
                cameraTarget = {
                    pos: new THREE.Vector3(center.x, 25, center.z + 0.01),
                    lookAt: center
                };
                cameraAnimating = true;
                setTimeout(() => {
                    cameraAnimating = false;
                    controls.target.copy(center);
                    controls.enabled = true;
                    controls.update();
                    mainContent.classList.remove('settling');
                }, 800);
                calculateResults();
            }
        }
    } catch(e) {
        console.error('Physics error:', e);
    }

    if (cameraAnimating) {
        const lerpFactor = 1.0 - Math.exp(-cameraLerpSpeed * Math.max(dt, 0.016));
        camera.position.lerp(cameraTarget.pos, lerpFactor);
        camera.lookAt(cameraTarget.lookAt);
    } else if (controls.enabled) {
        controls.update();
    }

    renderer.render(scene, camera);
}

// --- Result Calculation ---
function calculateResults() {
    let total = 0;
    const individualResults = [];
    const resultsByType = {};

    diceBodies.forEach(body => {
        const mesh = body.userData.mesh;
        const type = body.userData.type;

        if (!mesh) return;

        const value = readDieValue(body, mesh);

        total += value;
        if (!resultsByType[type]) {
            resultsByType[type] = [];
        }
        resultsByType[type].push(value);
    });

    let individualStr = "";
    for (const type in resultsByType) {
        resultsByType[type].sort((a, b) => a - b);
        individualStr += `${type}: [${resultsByType[type].join(', ')}] `;
    }

    resultsTotalElement.textContent = `Total: ${total}`;
    resultsIndividualElement.textContent = `Individual: ${individualStr.trim()}`;

    // Store results for sharing
    lastRollResults = { total, resultsByType, individualStr: individualStr.trim() };

    playSettleChime();

    // Determine if critical or fumble (only for single d20)
    const isSingleD20 = diceBodies.length === 1 && diceBodies[0].userData.type === 'd20';
    resultOverlay.classList.remove('critical', 'fumble');
    if (isSingleD20 && total === 20) {
        resultOverlay.classList.add('critical');
    } else if (isSingleD20 && total === 1) {
        resultOverlay.classList.add('fumble');
    }

    // Show overlay
    resultOverlayTotal.textContent = total;
    resultOverlayBreakdown.textContent = individualStr.trim();
    resultOverlay.classList.remove('hidden');
    resultOverlay.classList.add('visible');
    shareRollButton.classList.remove('hidden');

    // Update URL with current roll
    updateUrlWithRoll();

    // Pulse total in sidebar
    resultsTotalElement.style.transform = 'scale(1.05)';
    setTimeout(() => { resultsTotalElement.style.transform = 'scale(1)'; }, 300);
}

function readDieValue(dieBody, dieMesh) {
    const type = dieBody.userData.type;

    if (type === 'd4') {
        return readD4Value(dieMesh);
    }

    const faceData = dieMesh?.userData?.faceData;
    if (!faceData || faceData.length === 0) {
        return Math.ceil(Math.random() * (diceData[type]?.sides || 6));
    }

    const worldUp = new THREE.Vector3(0, 1, 0);
    const worldQuaternion = dieMesh.getWorldQuaternion(new THREE.Quaternion());

    let bestDot = -Infinity;
    let bestValue = faceData[0].value;

    for (const face of faceData) {
        const worldNormal = face.normal.clone().applyQuaternion(worldQuaternion);
        const dot = worldNormal.dot(worldUp);

        if (dot > bestDot) {
            bestDot = dot;
            bestValue = face.value;
        }
    }

    return bestValue;
}

// --- Window Resize ---
function onWindowResize() {
    const width = mainContent.clientWidth;
    const height = mainContent.clientHeight;

    if (width === 0 || height === 0) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

// --- URL-Based Dice Presets ---
function parseUrlPreset() {
    const params = new URLSearchParams(window.location.search);
    const rollParam = params.get('roll');
    if (!rollParam) return;

    // Reset all dice to 0
    for (const key in diceInputs) {
        diceInputs[key].value = 0;
    }

    // Parse notation like "2d6+1d20" or "4d6"
    const regex = /(\d+)d(\d+)/g;
    let match;
    let hasAny = false;
    while ((match = regex.exec(rollParam)) !== null) {
        const count = parseInt(match[1]);
        const sides = parseInt(match[2]);
        const key = sides === 100 ? 'd100' : `d${sides}`;
        if (diceInputs[key]) {
            diceInputs[key].value = Math.min(20, parseInt(diceInputs[key].value) + count);
            hasAny = true;
        }
    }

    if (hasAny) {
        updateDiceOptionStates();
        // Auto-roll if URL has ?roll param
        setTimeout(() => handleRollClick(), 500);
    }
}

function buildShareUrl() {
    const parts = [];
    for (const key in diceInputs) {
        const count = parseInt(diceInputs[key].value);
        if (count > 0) {
            const sides = key === 'd100' ? '100' : key.slice(1);
            parts.push(`${count}d${sides}`);
        }
    }
    if (parts.length === 0) return window.location.origin + window.location.pathname;
    return window.location.origin + window.location.pathname + '?roll=' + parts.join('+');
}

function updateUrlWithRoll() {
    const url = buildShareUrl();
    history.replaceState(null, '', url);
}

// --- Share ---
function shareRoll() {
    if (!lastRollResults) return;

    const url = buildShareUrl();
    const text = `Rolled ${lastRollResults.total}! (${lastRollResults.individualStr}) \u2014 Roll yours: ${url}`;

    if (navigator.share) {
        navigator.share({ title: 'Tavern Dice Roll', text, url }).catch(() => {});
    } else {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied!');
        }).catch(() => {
            showToast('Could not copy');
        });
    }

    trackEvent('share_click');
}

function shareConfig() {
    const url = buildShareUrl();
    navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied!');
    }).catch(() => {
        showToast('Could not copy');
    });
}

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
}

// --- Sound Toggle ---
function toggleSound() {
    soundEnabled = !soundEnabled;
    document.body.classList.toggle('sound-off', !soundEnabled);
    if (!soundEnabled && audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
    savePreferences();
}

// --- localStorage Preferences ---
function savePreferences() {
    const dice = {};
    for (const key in diceInputs) {
        dice[key] = parseInt(diceInputs[key].value) || 0;
    }
    try {
        localStorage.setItem('tavernDice', JSON.stringify({
            sound: soundEnabled,
            dice,
        }));
    } catch (e) { /* ignore */ }
}

function restorePreferences() {
    try {
        const stored = localStorage.getItem('tavernDice');
        if (!stored) return;
        const prefs = JSON.parse(stored);

        if (typeof prefs.sound === 'boolean') {
            soundEnabled = prefs.sound;
            document.body.classList.toggle('sound-off', !soundEnabled);
        }

        // Only restore dice if no URL preset is active
        if (!window.location.search.includes('roll=') && prefs.dice) {
            for (const key in prefs.dice) {
                if (diceInputs[key]) {
                    diceInputs[key].value = prefs.dice[key];
                }
            }
        }
    } catch (e) { /* ignore */ }

    // Respect prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        soundEnabled = false;
        document.body.classList.add('sound-off');
    }
}

// --- Dice Option Active States ---
function updateDiceOptionStates() {
    document.querySelectorAll('.dice-option').forEach(option => {
        const die = option.dataset.die;
        const input = diceInputs[die];
        const count = parseInt(input?.value) || 0;
        option.classList.toggle('active', count > 0);
    });
    updateDiceSummary();
}

function updateDiceSummary() {
    const el = document.querySelector('.dice-summary-text');
    if (!el) return;
    const parts = [];
    for (const key in diceInputs) {
        const count = parseInt(diceInputs[key].value) || 0;
        if (count > 0) parts.push(count + (key === 'd100' ? 'd%' : key));
    }
    el.textContent = parts.join(' + ') || 'Tap + to add dice';
}

// --- Analytics (Plausible) ---
function trackEvent(name) {
    if (typeof window.plausible === 'function') {
        window.plausible(name);
    }
}

// --- Start ---
init();
