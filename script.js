import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';

// --- Configuration ---
const config = {
    maxDice: 50, // Limit total dice to prevent performance issues
    settleThreshold: 0.15, // Velocity threshold to consider a die settled (lower is stricter)
    settleTimeThreshold: 80, // Frames count threshold below settleThreshold
    baseDieColor: 0xeeeeee, // Default color before specific type coloring
    floorColor: 0x402E32, // Dark wood/stone color
    wallColor: 0x666666, // Invisible wall color (debug)
    showWallVisuals: false, // Set true to see wall boundaries (uses wallColor)
    interstitialAdFrequency: 10, // Show ad every X rolls
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
const interstitialAdElement = document.getElementById('interstitial-ad');
const closeInterstitialButton = document.getElementById('close-interstitial');
const canvasContainer = document.querySelector('.canvas-container'); // Get container for size
const resultOverlay = document.getElementById('result-overlay');
const resultOverlayTotal = resultOverlay.querySelector('.result-total');
const resultOverlayBreakdown = resultOverlay.querySelector('.result-breakdown');
const powerRollButton = document.getElementById('power-roll-button');
const powerMarker = document.getElementById('power-marker');
const spinMarker = document.getElementById('spin-marker');
const powerValueEl = document.getElementById('power-value');
const spinValueEl = document.getElementById('spin-value');
const powerTrack = document.getElementById('power-track');
const spinTrack = document.getElementById('spin-track');

// --- Power Bar State ---
let powerBarActive = false;
let powerBarPhase = 'idle'; // 'idle' | 'power' | 'spin' | 'done'
let powerVal = 0; // 0-100
let spinVal = 0;  // 0-100
let powerDir = 1;
let spinDir = 1;
let powerBarAnimId = null;
const BAR_SPEED = 2.5; // % per frame

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
        // Start power bar
        resetPowerBars();
        powerBarPhase = 'power';
        powerRollButton.textContent = 'Stop Power!';
        powerRollButton.classList.add('waiting');
        animatePowerBars();
    } else if (powerBarPhase === 'power') {
        // Lock power, start spin
        powerMarker.classList.add('stopped');
        powerBarPhase = 'spin';
        powerRollButton.textContent = 'Stop Spin!';
    } else if (powerBarPhase === 'spin') {
        // Lock spin, execute roll
        spinMarker.classList.add('stopped');
        powerBarPhase = 'done';
        powerRollButton.classList.remove('waiting');
        powerRollButton.textContent = 'Rolling...';
        if (powerBarAnimId) cancelAnimationFrame(powerBarAnimId);
        // Execute roll with power/spin values
        handleRollClick(powerVal / 100, spinVal / 100);
    }
}

// Also allow clicking the tracks to stop
function onPowerTrackClick() { if (powerBarPhase === 'power') onPowerRollClick(); }
function onSpinTrackClick() { if (powerBarPhase === 'spin') onPowerRollClick(); }

// --- Sound System (Web Audio API) ---
let audioCtx = null;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playDiceHit(intensity = 0.5) {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const dur = 0.06 + intensity * 0.04;
    
    // Noise burst for impact
    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    
    // Bandpass for woody click sound
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
    const now = ctx.currentTime;
    const dur = 0.8;
    
    // Longer filtered noise for tumbling
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
    const now = ctx.currentTime;
    
    // Short pleasant tone when results show
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

// Collision sound handler for cannon-es
let lastCollisionSound = 0;
function onPhysicsCollision(e) {
    const now = performance.now();
    if (now - lastCollisionSound < 40) return; // Throttle
    lastCollisionSound = now;
    const impact = e.contact ? Math.min(1, e.contact.getImpactVelocityAlongNormal() / 15) : 0.3;
    if (impact > 0.05) playDiceHit(impact);
}

// --- State ---
let scene, camera, renderer, world, controls;
let diceMeshes = [];
let diceBodies = [];
let floorMesh, floorBody;
let walls = []; // To keep dice contained
let rolling = false;
let settleCheck = new Map(); // Map<bodyId, consecutiveFramesBelowThreshold>
let rollCount = 0;
let rollPendingAfterAd = false; // Flag if a roll was interrupted by an ad
let cameraAnimating = false; // True while camera auto-moves to top-down

// --- Camera Animation State ---
const cameraDefault = { pos: new THREE.Vector3(0, 20, 18), lookAt: new THREE.Vector3(0, 0, 0) };
let cameraTarget = cameraDefault;
let cameraLerpSpeed = 2.5; // Speed of camera transition

// --- Physics Materials ---
const diceMaterial = new CANNON.Material('diceMaterial');
const floorMaterial = new CANNON.Material('floorMaterial');
const wallMaterial = new CANNON.Material('wallMaterial'); // For invisible walls

// --- Texture & Number Functions ---

// Creates a canvas with solid background + number (for d6 faces)
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

// Creates a canvas texture with a number (transparent background)
function createNumberCanvas(text, size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    
    // Transparent background
    ctx.clearRect(0, 0, size, size);
    
    const fontSize = text.length > 2 ? size * 0.5 : text.length > 1 ? size * 0.6 : size * 0.7;
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Dark outline for readability
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(4, fontSize * 0.12);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, size / 2, size / 2);
    
    // White fill
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, size / 2, size / 2);
    
    return c;
}

// Finds geometric faces by grouping triangles with the same normal
function getGeometricFaces(geometry) {
    // Work on non-indexed geometry
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = geo.getAttribute('position');
    const triangleCount = pos.count / 3;
    const groups = []; // { normal, center, triangles[] }
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
    
    // Compute center and radius of each face group
    return groups.map(g => {
        const center = new THREE.Vector3();
        g.vertices.forEach(v => center.add(v));
        center.divideScalar(g.vertices.length);
        // Compute face radius (max distance from center to any vertex)
        let maxDist = 0;
        g.vertices.forEach(v => {
            const d = v.distanceTo(center);
            if (d > maxDist) maxDist = d;
        });
        return { normal: g.normal, center, radius: maxDist };
    });
}

// Special d4 numbering: numbers at vertices, not face centers
function addD4Numbers(mesh, geometry) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = geo.getAttribute('position');
    
    // Find unique vertices of the tetrahedron
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
    
    // Assign values 1-4 to each vertex
    // Store vertex→value mapping for result reading
    const vertexValues = uniqueVerts.map((v, i) => ({ pos: v, value: i + 1 }));
    mesh.userData.d4Vertices = vertexValues;
    
    // Get geometric faces
    const faces = getGeometricFaces(geometry);
    
    // For each face, place 3 numbers (one near each vertex of that face)
    for (const face of faces) {
        // Find which 3 unique vertices belong to this face
        const faceVerts = [];
        for (const vv of vertexValues) {
            // Check if this vertex is on this face (close to the face plane)
            const toVert = new THREE.Vector3().subVectors(vv.pos, face.center);
            const distFromPlane = Math.abs(toVert.dot(face.normal));
            if (distFromPlane < eps * 10) {
                faceVerts.push(vv);
            }
        }
        
        for (const fv of faceVerts) {
            // Position: 65% from face center toward the vertex
            const labelPos = new THREE.Vector3().lerpVectors(face.center, fv.pos, 0.6);
            const offset = face.normal.clone().multiplyScalar(0.03);
            labelPos.add(offset);
            
            const numCanvas = createNumberCanvas(fv.value.toString(), 128);
            const texture = new THREE.CanvasTexture(numCanvas);
            texture.needsUpdate = true;
            
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

// Reads d4 value from the highest vertex
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

// Adds number planes to a die mesh and stores face→label mapping for result detection
function addFaceNumbers(mesh, geometry, labels) {
    const faces = getGeometricFaces(geometry);
    const faceCount = labels.length;
    
    // Store face data for result detection
    const faceData = [];
    
    for (let i = 0; i < Math.min(faces.length, faceCount); i++) {
        const face = faces[i];
        const label = labels[i];
        const numericValue = parseInt(label) || 0;
        
        faceData.push({ normal: face.normal.clone(), value: numericValue, label: label });
        
        // Size the plane to fill face without overflow
        const size = face.radius * 0.9;
        
        // Create number texture
        const numCanvas = createNumberCanvas(label, 256);
        const texture = new THREE.CanvasTexture(numCanvas);
        texture.needsUpdate = true;
        
        // Create plane sized to face
        const planeGeo = new THREE.PlaneGeometry(size, size);
        const planeMat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        
        // Position at face center, slightly above the surface
        const offset = face.normal.clone().multiplyScalar(0.03);
        plane.position.copy(face.center).add(offset);
        
        // Orient plane to face outward along face normal
        const target = face.center.clone().add(face.normal);
        plane.lookAt(target);
        
        mesh.add(plane);
    }
    
    // Store on mesh for result detection
    mesh.userData.faceData = faceData;
}

// Creates d6 materials (BoxGeometry has 6 material groups natively)
function createD6Materials(baseColor) {
    const bgHex = '#' + baseColor.toString(16).padStart(6, '0');
    const faces = [4, 3, 1, 6, 2, 5];
    const materials = [];
    for (let i = 0; i < 6; i++) {
        const faceCanvas = createFaceTexture(faces[i].toString(), 256, bgHex, '#111111');
        const texture = new THREE.CanvasTexture(faceCanvas);
        texture.needsUpdate = true;
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
    scene.background = new THREE.Color(0x3a3a3a); // Match body background

    // Camera
    const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    camera.position.set(0, 20, 18); // Positioned above looking down
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // OrbitControls (disabled during roll, enabled after settle)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.1; // Don't go below floor
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.enabled = false; // Disabled until dice settle

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Slightly brighter ambient
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9); // Slightly brighter directional
    directionalLight.position.set(8, 15, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    // Adjust shadow camera bounds to better fit the rolling area
    const shadowBounds = 15;
    directionalLight.shadow.camera.left = -shadowBounds;
    directionalLight.shadow.camera.right = shadowBounds;
    directionalLight.shadow.camera.top = shadowBounds;
    directionalLight.shadow.camera.bottom = -shadowBounds;
    scene.add(directionalLight);
    //scene.add(new THREE.CameraHelper(directionalLight.shadow.camera)); // Uncomment to debug shadow


    // Physics World
    world = new CANNON.World({
        gravity: new CANNON.Vec3(0, -35, 0) // Slightly stronger gravity
    });
    world.broadphase = new CANNON.SAPBroadphase(world); // Potentially better performance
    world.allowSleep = true; // Allow bodies to sleep when settled

    // Physics Materials Contact Behavior
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
    const floorGeometry = new THREE.PlaneGeometry(100, 100); // Larger floor plane
    const floorMaterial3D = new THREE.MeshStandardMaterial({
        color: config.floorColor,
        roughness: 0.8,
        metalness: 0.2,
    });
    floorMesh = new THREE.Mesh(floorGeometry, floorMaterial3D);
    floorMesh.receiveShadow = true;
    floorMesh.rotation.x = -Math.PI / 2; // Rotate flat
    floorMesh.position.y = -0.1; // Slightly below origin
    scene.add(floorMesh);

    // Physics Floor
    floorBody = new CANNON.Body({
        type: CANNON.Body.STATIC, // Explicitly static
        shape: new CANNON.Plane(),
        material: floorMaterial,
    });
    floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    floorBody.position.copy(floorMesh.position);
    world.addBody(floorBody);

    // Invisible Walls (adjust positions based on view)
    createWalls();

    // Event Listeners
    rollButton.addEventListener('click', () => handleRollClick());
    clearButton.addEventListener('click', clearDice);
    powerRollButton.addEventListener('click', onPowerRollClick);
    powerTrack.addEventListener('click', onPowerTrackClick);
    spinTrack.addEventListener('click', onSpinTrackClick);
    window.addEventListener('resize', onWindowResize);
    closeInterstitialButton.addEventListener('click', hideInterstitialAd);

    // Initial render & resize
    onWindowResize(); // Set initial size correctly
    animate();
}

// --- Wall Creation ---
function createWalls() {
    const wallThickness = 2; // Thicker for physics stability
    const wallHeight = 20;
    // Calculate distance based roughly on camera view at floor level
    const halfFov = (camera.fov * Math.PI / 180) / 2;
    const distanceToFloor = camera.position.y - floorMesh.position.y;
    let viewWidth = 2 * distanceToFloor * Math.tan(halfFov) * camera.aspect;
    let viewHeight = 2 * distanceToFloor * Math.tan(halfFov);
    // Use a fraction of the view size for wall distance, adjust multiplier as needed
    const wallDistX = Math.max(12, viewWidth * 0.4);
    const wallDistZ = Math.max(12, viewHeight * 0.4);


    const wallMaterial3D = new THREE.MeshBasicMaterial({ color: config.wallColor, wireframe: true, visible: config.showWallVisuals });

    const wallsData = [
        { size: [wallDistX, wallHeight / 2, wallThickness / 2], pos: [0, wallHeight / 2, wallDistZ], rot: null }, // Z+
        { size: [wallDistX, wallHeight / 2, wallThickness / 2], pos: [0, wallHeight / 2, -wallDistZ], rot: null }, // Z-
        { size: [wallThickness / 2, wallHeight / 2, wallDistZ], pos: [wallDistX, wallHeight / 2, 0], rot: null }, // X+
        { size: [wallThickness / 2, wallHeight / 2, wallDistZ], pos: [-wallDistX, wallHeight / 2, 0], rot: null } // X-
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
        walls.push(wallBody); // Keep track if needed later

        // Add visual representation if enabled
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
// Using standard Three.js geometries. d10/d100 are approximations.
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

// Helper to create Cannon ConvexPolyhedron from Three Geometry
// Assumes geometry is non-indexed or handles indices correctly if present
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
    // Count actual geometric faces so every face gets a label
    const faceCount = getGeometricFaces(geometry).length;
    
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
    
    // If geometry has more faces than labels, cycle through labels
    const labels = [];
    for (let i = 0; i < faceCount; i++) {
        labels.push(values[i % values.length]);
    }
    return labels;
}

function createDie(type) {
    const data = diceData[type];
    if (!data) return null;

    const geometry = data.geometry();
    const bgHex = `#${data.color.toString(16).padStart(6, '0')}`;
    let mesh;
    
    if (type === 'd6') {
        const materials = createD6Materials(data.color);
        mesh = new THREE.Mesh(geometry, materials);
        // Store d6 face data: +X=4, -X=3, +Y=1, -Y=6, +Z=2, -Z=5
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
        addD4Numbers(mesh, geometry);
    } else {
        const material = new THREE.MeshStandardMaterial({
            color: data.color,
            roughness: 0.4,
            metalness: 0.2,
        });
        mesh = new THREE.Mesh(geometry, material);
        // Add number planes to each face + store faceData
        const labels = getDieLabels(type, data.sides, geometry);
        addFaceNumbers(mesh, geometry, labels);
    }
    
    mesh.castShadow = true;
    mesh.userData.type = type;

    const body = new CANNON.Body({
        mass: data.mass,
        shape: data.shape(),
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

// --- Rolling Logic ---
function handleRollClick(powerNorm, spinNorm) {
    if (rolling) return; // Don't re-roll if already rolling

    // Default to random values for Quick Roll (no arguments)
    const power = (typeof powerNorm === 'number') ? powerNorm : (0.3 + Math.random() * 0.7);
    const spin = (typeof spinNorm === 'number') ? spinNorm : (0.3 + Math.random() * 0.7);

    rollPendingAfterAd = false; // Reset flag

    // Check for interstitial Ad
    rollCount++;
    if (rollCount > 0 && rollCount % config.interstitialAdFrequency === 0) {
        rollPendingAfterAd = true; // Set flag: user wants to roll after ad
        showInterstitialAd();
        // Don't proceed with roll yet
        return;
    }

    rollDice(power, spin); // Proceed with roll if no ad shown
}

function rollDice(power = 0.5, spin = 0.5) {
    rolling = true;
    controls.enabled = false; // Disable user controls during roll
    cameraAnimating = true; // Animate camera back to default
    cameraTarget = cameraDefault; // Reset camera to default angle
    // Hide result overlay
    resultOverlay.classList.remove('visible');
    resultOverlay.classList.add('hidden');
    // Reset power bars UI
    setTimeout(() => resetPowerBars(), 300);
    clearDice(); // Clear previous dice
    settleCheck.clear(); // Reset settlement check map
    resultsTotalElement.textContent = "Total: Rolling...";
    resultsIndividualElement.textContent = "Individual: -";
    
    // Scale force/torque based on power/spin (0-1)
    const baseForce = 8;
    const maxForce = 20;
    const baseTorque = 12;
    const maxTorque = 35;
    const rollForce = baseForce + power * (maxForce - baseForce);
    const rollTorque = baseTorque + spin * (maxTorque - baseTorque);

    let totalDiceCount = 0;
    const diceToRoll = [];

    // Collect dice selections from inputs
    for (const type in diceInputs) {
        const count = parseInt(diceInputs[type].value, 10);
        if (isNaN(count) || count <= 0) continue; // Skip invalid inputs

        if (totalDiceCount + count > config.maxDice) {
            alert(`Too many dice! Maximum is ${config.maxDice}. Reducing count of ${type}.`);
            const remainingSlots = Math.max(0, config.maxDice - totalDiceCount);
            diceInputs[type].value = remainingSlots; // Adjust input value
             for (let i = 0; i < remainingSlots; i++) {
                diceToRoll.push(type);
            }
            totalDiceCount = config.maxDice;
            break; // Stop adding more dice
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
        return; // Nothing to roll
    }

    // Create and position dice
    const spread = 8; // How far dice are spread initially (keep within walls)
    const initialHeight = 10; // How high dice start

    // Play initial roll sound
    playRollSound();

    diceToRoll.forEach((type, index) => {
        try {
            const die = createDie(type);
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
    diceMeshes.forEach(mesh => {
        // Dispose child number planes
        while (mesh.children.length > 0) {
            const child = mesh.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
            mesh.remove(child);
        }
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(mat => {
                    if (mat.map) mat.map.dispose();
                    mat.dispose();
                });
            } else {
                if (mesh.material.map) mesh.material.map.dispose();
                mesh.material.dispose();
            }
        }
        scene.remove(mesh);
    });
    diceBodies.forEach(body => world.removeBody(body));
    diceMeshes = [];
    diceBodies = [];
}

// --- Animation Loop ---
const clock = new THREE.Clock();
let lastTime = 0;
function animate(time = 0) {
    requestAnimationFrame(animate);

    const deltaTime = time - lastTime;
    lastTime = time;

    const dt = (isNaN(deltaTime) || deltaTime <= 0) ? 1/60 : Math.min(1/30, deltaTime * 0.001);

    try {
    // Only step physics if rolling or dice haven't fully settled
    if (diceBodies.length > 0) {
        world.step(1/60, dt, 3); // Fixed timestep with interpolation

        let allSettled = diceBodies.length > 0; // Assume settled if there are dice

        diceBodies.forEach((body, index) => {
            const mesh = diceMeshes[index]; // Assumes order is maintained
            if (mesh && body) {
                // Only update position/rotation if the body is not sleeping
                mesh.position.copy(body.position);
                mesh.quaternion.copy(body.quaternion);

                // Settlement check based on motion, not just velocity thresholds
                const isMoving = body.sleepState !== CANNON.Body.SLEEPING &&
                                 (body.velocity.lengthSquared() > config.settleThreshold * config.settleThreshold ||
                                  body.angularVelocity.lengthSquared() > config.settleThreshold * config.settleThreshold);

                if (!isMoving) {
                     let currentSettleCount = settleCheck.get(body.id) || 0;
                     currentSettleCount++;
                     settleCheck.set(body.id, currentSettleCount);
                     if (currentSettleCount < config.settleTimeThreshold) {
                         allSettled = false; // This die isn't settled long enough
                     }
                } else {
                    settleCheck.set(body.id, 0); // Reset count if moving
                    body.wakeUp(); // Ensure it's awake if moving significantly
                    allSettled = false; // At least one die is moving
                }
            } else {
                allSettled = false; // Should not happen, but safety check
            }
        });

         if (rolling && allSettled) {
            rolling = false;
            // Compute dice center for camera framing
            const center = new THREE.Vector3();
            diceMeshes.forEach(m => center.add(m.position));
            center.divideScalar(diceMeshes.length);
            center.y = 0;
            // Animate camera to top-down view centered on dice
            cameraTarget = {
                pos: new THREE.Vector3(center.x, 25, center.z + 0.01),
                lookAt: center
            };
            cameraAnimating = true;
            // Enable OrbitControls after a short delay for camera to arrive
            setTimeout(() => {
                cameraAnimating = false;
                controls.target.copy(center);
                controls.enabled = true;
                controls.update();
            }, 800);
            calculateResults();
        }
    }
    } catch(e) {
        console.error('Physics error:', e);
    }

    // Camera handling
    if (cameraAnimating) {
        // Smoothly interpolate camera to target
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

    // Format results string
    let individualStr = "";
    for (const type in resultsByType) {
        // Sort results within each type for consistency
        resultsByType[type].sort((a, b) => a - b);
        individualStr += `${type}: [${resultsByType[type].join(', ')}] `;
    }

    resultsTotalElement.textContent = `Total: ${total}`;
    resultsIndividualElement.textContent = `Individual: ${individualStr.trim()}`;

    // Play settle chime
    playSettleChime();

    // Show sleek overlay on canvas
    resultOverlayTotal.textContent = total;
    resultOverlayBreakdown.textContent = individualStr.trim();
    resultOverlay.classList.remove('hidden');
    resultOverlay.classList.add('visible');
}

// --- Get Die Value (uses stored faceData for exact match with visible numbers) ---
function readDieValue(dieBody, dieMesh) {
    const type = dieBody.userData.type;
    
    // d4: read from highest vertex (D&D convention)
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
    const width = canvasContainer.clientWidth;
    const height = canvasContainer.clientHeight;

    // Check for zero dimensions to avoid errors during layout shifts
    if (width === 0 || height === 0) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);

    // Optional: Could recalculate wall positions here if desired
    // world.removeBody(...); walls = []; createWalls(); // Example, might cause physics issues if done carelessly
}

// --- Ad Logic ---
function showInterstitialAd() {
    interstitialAdElement.classList.remove('hidden');
}

function hideInterstitialAd() {
    interstitialAdElement.classList.add('hidden');
    // IMPORTANT: After closing the ad, trigger the roll ONLY if it was pending
    if (rollPendingAfterAd) {
       rollPendingAfterAd = false; // Clear the flag
       rollDice(); // Execute the roll that was interrupted
    }
}

// --- Start ---
init();