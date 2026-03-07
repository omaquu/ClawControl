// ─── office3d.js — Rich 3D Office, 6 Zone Workplace ─────────────────────────
let _animId = null;
let _renderer = null;
let _ro = null;

export async function init(el) {
    el.innerHTML = renderPage();
    try {
        await loadThree();
        const agents = await window.apiFetch('/gateway/agents') || [];
        buildScene(agents, el);
    } catch (e) {
        const wrap = el.querySelector('#office-wrap');
        if (wrap) wrap.innerHTML = `<div class="empty-state" style="height:100%;">
      <i class="fa fa-cube"></i>
      <p>3D Office failed to start<br><small style="opacity:.5">${e.message || e}</small></p>
    </div>`;
        console.error('[3D Office]', e);
    }
}

export function refresh(el) { /* live — scene persists */ }

export function destroy() {
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    if (_renderer) { _renderer.dispose(); _renderer = null; }
    if (_ro) { _ro.disconnect(); _ro = null; }
}

function renderPage() {
    return `
  <div class="page-header">
    <div>
      <h2 class="page-heading">🏢 3D Office</h2>
      <p class="page-sub">Live workspace — agents placed by role &amp; status</p>
    </div>
    <div id="office-zone-legend" style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;font-size:0.75rem;color:var(--color-text-muted);"></div>
  </div>
  <div id="office-wrap" style="position:relative;height:calc(100vh - 160px);background:#0b0b14;border-radius:12px;overflow:hidden;border:1px solid var(--color-border);">
    <canvas id="office-canvas" style="width:100%;height:100%;display:block;"></canvas>
    <div id="office-hud" style="position:absolute;top:1rem;left:1rem;background:rgba(0,0,0,.7);backdrop-filter:blur(10px);border-radius:10px;padding:.75rem 1rem;border:1px solid rgba(255,255,255,.08);min-width:180px;max-width:220px;">
      <div style="font-size:.7rem;color:#9ca3af;margin-bottom:.5rem;font-weight:700;letter-spacing:.06em;">AGENTS</div>
      <div id="office-agent-list"></div>
    </div>
    <div id="office-tooltip" style="position:absolute;display:none;background:rgba(8,8,20,.92);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:.5rem .75rem;font-size:.82rem;pointer-events:none;z-index:10;max-width:200px;"></div>
    <div style="position:absolute;bottom:1rem;right:1rem;font-size:.7rem;color:rgba(255,255,255,.25);">Drag to rotate · Scroll to zoom · Hover agents</div>
  </div>`;
}

// ── CDN loader ────────────────────────────────────────────────────────────────
function loadScript(src) {
    return new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = () => rej(new Error('CDN failed: ' + src));
        document.head.appendChild(s);
    });
}
async function loadThree() {
    if (window.THREE?.OrbitControls) return;
    const B = 'https://cdn.jsdelivr.net/npm/three@0.128.0';
    await loadScript(`${B}/build/three.min.js`);
    await loadScript(`${B}/examples/js/controls/OrbitControls.js`);
}

// ── Zone definitions ──────────────────────────────────────────────────────────
const ZONES = {
    coding: { label: '💻 Coding', color: '#6366f1', cx: -6, cz: -6, roles: ['developer', 'coder', 'engineer', 'code', 'programmer'] },
    debugger: { label: '🐞 Debugger', color: '#84cc16', cx: -12, cz: 0, roles: ['qa', 'tester', 'debug', 'test'] },
    art: { label: '🎨 Art Studio', color: '#ec4899', cx: 6, cz: -6, roles: ['artist', 'creative', 'design', 'art'] },
    explorer: { label: '🔭 Explorer', color: '#06b6d4', cx: 6, cz: 6, roles: ['researcher', 'search', 'scout', 'explore'] },
    economist: { label: '📈 Economist', color: '#14b8a6', cx: 12, cz: 0, roles: ['finance', 'math', 'economist', 'analyst', 'data'] },
    writer: { label: '✍️ Writer', color: '#fb923c', cx: 12, cz: -8, roles: ['writer', 'author', 'content', 'script', 'copy'] },
    security: { label: '🔒 Security', color: '#f59e0b', cx: -6, cz: 6, roles: ['security', 'holvi', 'guard', 'audit', 'maintenance'] },
    orchestrator: { label: '📋 Management', color: '#8b5cf6', cx: 0, cz: -7, roles: ['orchestrator', 'manager', 'lead', 'boss'] },
    lounge: { label: '☕ Lounge', color: '#10b981', cx: 0, cz: 0, roles: [] }, // idle agents
    bedroom: { label: '😴 Bedroom', color: '#4b5563', cx: 0, cz: 9, roles: [] }, // offline agents
};

const STATUS_COLOR = { active: '#10b981', busy: '#f59e0b', standby: '#9ca3af', idle: '#6b7280', offline: '#374151', error: '#ef4444' };

function agentZone(agent) {
    if ((agent.status || '') === 'offline' || !agent.status) return 'bedroom';
    if ((agent.status || '') === 'idle' || (agent.status || '') === 'standby') return 'lounge';
    const role = (agent.role || agent.name || '').toLowerCase();
    for (const [key, z] of Object.entries(ZONES)) {
        if (z.roles.some(r => role.includes(r))) return key;
    }
    return 'coding'; // default working zone
}

// ── Canvas text helper (returns Texture) ────────────────────────────────────
function makeLabel(text, bg = '#1a1a2e', fg = '#a5b4fc') {
    const THREE = window.THREE;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = fg; ctx.font = 'bold 22px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    return new THREE.CanvasTexture(c);
}

// ── Main scene builder ────────────────────────────────────────────────────────
function buildScene(agents, el) {
    const THREE = window.THREE;
    const canvas = el.querySelector('#office-canvas');
    if (!canvas) return;

    const w = canvas.clientWidth || 900, h = canvas.clientHeight || 550;

    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _renderer.setSize(w, h, false);
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0b14');
    scene.fog = new THREE.FogExp2('#0b0b14', 0.022);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 120);
    camera.position.set(0, 16, 22);
    camera.lookAt(0, 0, 0);

    const controls = new THREE.OrbitControls(camera, _renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.minDistance = 6; controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI / 2.05;

    // ── Lighting ──
    scene.add(new THREE.AmbientLight('#ffffff', 0.35));
    const sun = new THREE.DirectionalLight('#fff8e1', 0.9);
    sun.position.set(8, 18, 10); sun.castShadow = true;
    sun.shadow.mapSize.width = 2048; sun.shadow.mapSize.height = 2048;
    scene.add(sun);
    // Zone accent lights
    Object.values(ZONES).forEach(z => {
        const pl = new THREE.PointLight(z.color, 0.6, 8);
        pl.position.set(z.cx, 2.5, z.cz);
        scene.add(pl);
    });

    // ── Floor ──
    const floorTex = (() => {
        const c = document.createElement('canvas'); c.width = 512; c.height = 512;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#13131a'; ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = '#1f1f2e'; ctx.lineWidth = 1;
        for (let i = 0; i <= 512; i += 32) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
        }
        return new THREE.CanvasTexture(c);
    })();
    floorTex.repeat.set(6, 6); floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(28, 24),
        new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 })
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);

    // ── Walls ──
    const wallMat = new THREE.MeshStandardMaterial({ color: '#16162a', roughness: 0.9 });
    [
        { pos: [0, 3, -12], rot: [0, 0, 0], w: 28, h: 6 },   // back
        { pos: [-14, 3, 0], rot: [0, Math.PI / 2, 0], w: 24, h: 6 }, // left
        { pos: [14, 3, 0], rot: [0, -Math.PI / 2, 0], w: 24, h: 6 }, // right
    ].forEach(({ pos, rot, w: ww, h: hh }) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), wallMat);
        m.position.set(...pos); m.rotation.set(...rot); m.receiveShadow = true;
        scene.add(m);
    });

    // ── Zone floor markings ──
    Object.entries(ZONES).forEach(([key, z]) => {
        const markMat = new THREE.MeshStandardMaterial({
            color: z.color, transparent: true, opacity: 0.08, roughness: 1
        });
        const mark = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 5.5), markMat);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(z.cx, 0.01, z.cz);
        scene.add(mark);

        // Zone label sign on wall / floor
        const labelTex = makeLabel(z.label, '#0f0f1e', z.color);
        const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(2.2, 0.55),
            new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })
        );
        sign.position.set(z.cx, 0.05, z.cz + 2.2);
        sign.rotation.x = -Math.PI / 2;
        scene.add(sign);
    });

    // ── Zone furniture builders ──
    const M = THREE.MeshStandardMaterial;
    const G = THREE.BoxGeometry;

    function box(scene, sx, sy, sz, px, py, pz, color, rx = 0, ry = 0, rz = 0, emissive) {
        const mat = new M({ color, roughness: 0.7, ...(emissive ? { emissive, emissiveIntensity: 0.4 } : {}) });
        const mesh = new THREE.Mesh(new G(sx, sy, sz), mat);
        mesh.position.set(px, py, pz);
        mesh.rotation.set(rx, ry, rz);
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh);
        return mesh;
    }

    function cylinder(scene, rt, rb, h, px, py, pz, color, seg = 8, rx = 0, ry = 0, rz = 0) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), new M({ color, roughness: 0.6 }));
        m.position.set(px, py, pz); m.rotation.set(rx, ry, rz); m.castShadow = true;
        scene.add(m);
    }

    // ─── CODING CORNER (cx:-6 cz:-6) ─────────────────────────────────────────
    {
        const cx = -6, cz = -6;
        // L-shaped standing desk
        box(scene, 2.8, 0.08, 1.1, cx + 0.2, 0.84, cz, '#1e1e32');       // main desk top
        box(scene, 1.1, 0.08, 0.9, cx - 1.1, 0.84, cz + 0.9, '#1e1e32'); // side desk
        // Legs (4)
        [[-1, cz - 0.45], [1, cz - 0.45], [-1, cz + 0.45], [1, cz + 0.45]].forEach(([x, z]) =>
            cylinder(scene, 0.04, 0.04, 0.85, cx + x * 0.6, 0.42, z, '#2a2a3a'));
        // Main monitor (wide)
        box(scene, 1.1, 0.65, 0.04, cx + 0.2, 1.22, cz - 0.4, '#0f0f1e', 0, 0, 0, '#6366f1');
        // Second monitor (side)
        box(scene, 0.7, 0.45, 0.04, cx - 1.1, 1.12, cz + 0.55, '#0f0f1e', 0, Math.PI / 6, 0, '#8b5cf6');
        // Keyboard
        box(scene, 0.6, 0.02, 0.2, cx + 0.2, 0.86, cz + 0.15, '#2a2a3a');
        // Chair
        box(scene, 0.6, 0.06, 0.6, cx + 0.2, 0.54, cz + 0.8, '#2d2d4a');   // seat
        box(scene, 0.58, 0.65, 0.06, cx + 0.2, 0.88, cz + 1.08, '#2d2d4a'); // backrest
        cylinder(scene, 0.04, 0.04, 0.5, cx + 0.2, 0.27, cz + 0.8, '#1a1a2e'); // pedestal
        // Coffee mug
        cylinder(scene, 0.055, 0.05, 0.12, cx + 0.75, 0.9, cz - 0.1, '#6366f1', 12);
        // Mini server rack on floor
        box(scene, 0.4, 0.9, 0.35, cx - 2.5, 0.45, cz - 0.8, '#111122');
        box(scene, 0.38, 0.06, 0.33, cx - 2.5, 0.65, cz - 0.8, '#1a1a3a', 0, 0, 0, '#6366f1');
        box(scene, 0.38, 0.06, 0.33, cx - 2.5, 0.78, cz - 0.8, '#1a1a3a', 0, 0, 0, '#10b981');
    }

    // ─── ART STUDIO CORNER (cx:6 cz:-6) ─────────────────────────────────────
    {
        const cx = 6, cz = -6;
        // Easel (3 legs + canvas)
        box(scene, 0.04, 1.6, 0.04, cx - 0.3, 0.8, cz, '#5c3a20', -0.15, 0, 0.15); // left
        box(scene, 0.04, 1.6, 0.04, cx + 0.3, 0.8, cz, '#5c3a20', -0.15, 0, -0.15); // right
        box(scene, 0.04, 1.2, 0.04, cx, 0.6, cz + 0.4, '#5c3a20', 0.3, 0, 0); // back leg
        // Canvas on easel
        box(scene, 0.9, 0.7, 0.03, cx, 1.35, cz - 0.1, '#f0e6d3');
        // Painting splotches (colored boxes on canvas)
        [['#ec4899', -0.2, -0.1], ['#6366f1', 0.15, 0.1], ['#f59e0b', -0.05, 0.2], ['#10b981', 0.2, -0.15]].forEach(([c, ox, oy]) =>
            box(scene, 0.18, 0.15, 0.01, cx + ox, 1.35 + oy, cz - 0.08, c));
        // Paint table
        box(scene, 1.0, 0.06, 0.55, cx + 1.2, 0.75, cz - 0.1, '#3c2415');
        [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]].forEach(([x, z]) =>
            cylinder(scene, 0.03, 0.03, 0.75, cx + 1.2 + x, 0.375, cz - 0.1 + z, '#5c3a20'));
        // Paint pots
        ['#ec4899', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#fff'].forEach((c, i) =>
            cylinder(scene, 0.04, 0.04, 0.08, cx + 0.85 + i * 0.1, 0.82, cz + 0.15, c, 10));
        // Stool
        cylinder(scene, 0.25, 0.22, 0.04, cx + 0.4, 0.5, cz + 0.8, '#5c3a20', 16);
        cylinder(scene, 0.04, 0.04, 0.5, cx + 0.4, 0.25, cz + 0.8, '#3c2415');
        // Scattered art supplies on floor
        box(scene, 0.5, 0.02, 0.3, cx + 1.8, 0.02, cz + 0.8, '#f0e6d3'); // paper
        box(scene, 0.04, 0.3, 0.04, cx + 1.9, 0.17, cz + 0.75, '#3c2415'); // brush
        // Framed art on back wall
        box(scene, 0.9, 0.7, 0.04, cx - 1.2, 2.2, cz - 0.1, '#f0e6d3');
        box(scene, 0.9, 0.7, 0.02, cx - 1.2, 2.2, cz - 0.06, '#ec4899');
    }

    // ─── EXPLORER CORNER (cx:6 cz:6) ─────────────────────────────────────────
    {
        const cx = 6, cz = 6;
        // Telescope (kaukoputki)
        cylinder(scene, 0.06, 0.12, 1.4, cx, 1.2, cz - 1.2, '#2a4a6a', 12); // body (angled)
        const telBody = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.14, 1.5, 12),
            new THREE.MeshStandardMaterial({ color: '#2a4a6a', metalness: 0.5, roughness: 0.4 })
        );
        telBody.position.set(cx, 1.5, cz - 1.0);
        telBody.rotation.set(-0.5, 0, 0.1);
        scene.add(telBody);
        // Telescope stand
        cylinder(scene, 0.04, 0.04, 1.1, cx, 0.55, cz - 1.2, '#1a2a3a');
        // Tripod legs
        [[-0.3, 0.3], [0.3, 0.3], [0, -0.4]].forEach(([x, z]) =>
            box(scene, 0.03, 0.9, 0.03, cx + x, 0.4, cz - 1.2 + z, '#1a2a3a', -0.2, 0, x > 0 ? 0.15 : x < 0 ? -0.15 : 0));
        // Globe
        const globe = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 16, 16),
            new THREE.MeshStandardMaterial({ color: '#1a4a6a', roughness: 0.5, metalness: 0.2, emissive: '#06b6d4', emissiveIntensity: 0.15 })
        );
        globe.position.set(cx + 1.5, 1.12, cz + 0.5);
        scene.add(globe);
        // Globe stand
        cylinder(scene, 0.04, 0.06, 0.5, cx + 1.5, 0.6, cz + 0.5);
        // Map table
        box(scene, 1.4, 0.06, 1.0, cx + 0.5, 0.84, cz + 0.6, '#1e2a1e');
        [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]].forEach(([x, z]) =>
            cylinder(scene, 0.04, 0.04, 0.84, cx + 0.5 + x, 0.42, cz + 0.6 + z, '#2a3a2a'));
        // Maps/papers on table
        box(scene, 1.2, 0.01, 0.8, cx + 0.5, 0.88, cz + 0.6, '#d4c9a0');
        // Lines on map
        ['#3b82f6', '#ef4444', '#10b981'].forEach((c, i) =>
            box(scene, 0.8, 0.005, 0.02, cx + 0.5, 0.895, cz + 0.4 + i * 0.16, c));
        // Bookshelf on wall
        box(scene, 0.2, 1.5, 0.7, cx + 2.5, 0.75, cz - 1.5, '#3c2415');
        ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'].forEach((c, i) =>
            box(scene, 0.04, 0.3 + i * 0.04, 0.6, cx + 2.3 + i * 0 - 0.05, 0.3 + i * 0.18, cz - 1.5, c));
    }

    // ─── SECURITY CORNER (cx:-6 cz:6) ────────────────────────────────────────
    {
        const cx = -6, cz = 6;
        // Server rack (main)
        box(scene, 0.8, 1.8, 0.55, cx - 1.0, 0.9, cz - 1.0, '#0d0d1a');
        // Server units (blinking emissive strips)
        [0.6, 0.3, -0.0, -0.3].forEach((y, i) => {
            box(scene, 0.76, 0.1, 0.5, cx - 1.0, 0.9 + y, cz - 0.73, '#111127');
            box(scene, 0.5, 0.025, 0.02, cx - 1.15, 0.9 + y, cz - 0.47, i % 2 === 0 ? '#10b981' : '#f59e0b', 0, 0, 0, i % 2 === 0 ? '#10b981' : '#f59e0b');
        });
        // HOLVI Security desk
        box(scene, 1.6, 0.06, 0.85, cx + 0.3, 0.84, cz, '#111122');
        [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]].forEach(([x, z]) =>
            cylinder(scene, 0.04, 0.04, 0.84, cx + 0.3 + x, 0.42, cz + z, '#1a1a2e'));
        // 3 security monitors in arc
        [[-0.5, 0], [0, -0.05], [0.5, 0]].forEach(([ox, roty]) =>
            box(scene, 0.55, 0.38, 0.04, cx + 0.3 + ox, 1.22, cz - 0.35, '#0a0a1a', 0, roty, 0, '#f59e0b'));
        // Security chair
        box(scene, 0.6, 0.06, 0.6, cx + 0.3, 0.54, cz + 0.7, '#1a1a2a');
        box(scene, 0.58, 0.65, 0.06, cx + 0.3, 0.88, cz + 0.98, '#1a1a2a');
        cylinder(scene, 0.04, 0.04, 0.5, cx + 0.3, 0.27, cz + 0.7, '#111122');
        // Lock icon (symbolic) attached to rack
        cylinder(scene, 0.15, 0.15, 0.04, cx - 1.0, 2.0, cz - 0.45, '#f59e0b', 16, 0, Math.PI / 2, 0);
        box(scene, 0.18, 0.15, 0.04, cx - 1.0, 1.84, cz - 0.45, '#1a1a2e', 0, Math.PI / 2, 0);
        // Security camera on rack
        box(scene, 0.22, 0.1, 0.12, cx - 1.0, 2.7, cz - 0.7, '#1a1a2e', 0, Math.PI / 4, 0);
        box(scene, 0.08, 0.08, 0.2, cx - 0.9, 2.68, cz - 0.6, '#1a1a2e', 0, Math.PI / 4, 0);
    }

    // ─── DEBUGGER ZONE (cx:-12 cz:0) ──────────────────────────────────────────
    {
        const cx = -12, cz = 0;
        // Workbench for testing
        box(scene, 2.6, 0.06, 1.0, cx + 0.3, 0.85, cz, '#2a2a2a'); // table
        [[-1.2, -0.4], [1.2, -0.4], [-1.2, 0.4], [1.2, 0.4]].forEach(([x, z]) =>
            box(scene, 0.06, 0.85, 0.06, cx + 0.3 + x, 0.425, cz + z, '#444'));
        // Oscilloscope / test equipment
        box(scene, 0.9, 0.6, 0.5, cx - 0.5, 1.15, cz - 0.2, '#1a1e1a');
        box(scene, 0.4, 0.3, 0.02, cx - 0.6, 1.2, cz + 0.06, '#0f1a0f', 0, 0, 0, '#84cc16'); // green scope screen
        // Wires and boards
        box(scene, 0.4, 0.02, 0.3, cx + 0.4, 0.89, cz + 0.1, '#155e3a'); // PCB
        ['#ef4444', '#3b82f6'].forEach((c, i) =>
            cylinder(scene, 0.01, 0.01, 0.6, cx + 0.2 + i * 0.1, 0.9, cz + 0.2, c, 4, Math.PI / 2, 0, 0)); // wires
        // Tool rack
        box(scene, 0.04, 1.5, 1.0, cx + 1.6, 1.2, cz, '#333');
        for (let i = 0; i < 4; i++) box(scene, 0.02, 0.2, 0.02, cx + 1.57, 1.4 + (i % 2) * 0.3, cz - 0.3 + i * 0.2, '#555', 0, 0, 0.2);
    }

    // ─── ECONOMIST ZONE (cx:12 cz:0) ──────────────────────────────────────────
    {
        const cx = 12, cz = 0;
        // Massive glass desk
        box(scene, 2.0, 0.04, 1.2, cx - 0.5, 0.8, cz, '#e0f2fe').material.transparent = true;
        box(scene, 2.0, 0.04, 1.2, cx - 0.5, 0.8, cz, '#e0f2fe').material.opacity = 0.5;
        [[-0.9, -0.5], [0.9, -0.5], [-0.9, 0.5], [0.9, 0.5]].forEach(([x, z]) =>
            cylinder(scene, 0.03, 0.03, 0.8, cx - 0.5 + x, 0.4, cz + z, '#a1a1aa'));
        // 4 monitors setup for trading/charts
        [[-0.6, 0, 0], [0.6, 0, 0], [-0.4, 0.4, 0], [0.4, 0.4, 0]].forEach(([x, y, roty]) => {
            box(scene, 0.6, 0.35, 0.03, cx - 0.5 + x, 1.1 + y, cz - 0.4, '#1f2937', 0, (x < 0 ? 0.2 : (x > 0 ? -0.2 : 0)), 0, '#14b8a6');
            box(scene, 0.5, 0.25, 0.03, cx - 0.5 + x, 1.1 + y, cz - 0.38, '#1e293b');
        });
        // Briefcase on floor
        box(scene, 0.6, 0.4, 0.15, cx - 1.2, 0.2, cz + 0.6, '#451a03');
        // Leather chair
        box(scene, 0.65, 0.1, 0.65, cx - 0.5, 0.5, cz + 0.7, '#78350f');
        box(scene, 0.6, 0.8, 0.1, cx - 0.5, 0.9, cz + 1.0, '#78350f');
        cylinder(scene, 0.05, 0.05, 0.45, cx - 0.5, 0.25, cz + 0.7, '#52525b');
    }

    // ─── WRITER ZONE (cx:12 cz:-8) ────────────────────────────────────────────
    {
        const cx = 12, cz = -8;
        // Antique wooden desk
        box(scene, 1.8, 0.08, 0.9, cx - 0.5, 0.78, cz, '#451a03');
        [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]].forEach(([x, z]) =>
            box(scene, 0.08, 0.78, 0.08, cx - 0.5 + x, 0.39, cz + z, '#451a03'));
        // Typewriter (retro)
        box(scene, 0.5, 0.15, 0.4, cx - 0.5, 0.85, cz + 0.1, '#1e293b');
        cylinder(scene, 0.04, 0.04, 0.6, cx - 0.5, 0.9, cz - 0.05, '#cbd5e1', 8, 0, 0, Math.PI / 2); // platen
        // Paper in typewriter
        box(scene, 0.4, 0.5, 0.01, cx - 0.5, 1.05, cz - 0.08, '#f8fafc', -0.2, 0, 0);
        // Stacks of paper/manuscripts
        for (let i = 0; i < 3; i++) box(scene, 0.3, 0.15, 0.4, cx - 1.0, 0.82 + i * 0.02, cz - 0.2, '#f8fafc', 0, 0.1 * i, 0);
        // Desk lamp
        cylinder(scene, 0.15, 0.15, 0.05, cx + 0.2, 0.82, cz - 0.25, '#ca8a04'); // base
        box(scene, 0.02, 0.4, 0.02, cx + 0.2, 1.0, cz - 0.25, '#ca8a04', 0.3, 0, 0); // arm
        cylinder(scene, 0.08, 0.15, 0.15, cx + 0.2, 1.15, cz - 0.15, '#ca8a04', 12, -0.5); // shade
        // Trash bin (overflowing)
        cylinder(scene, 0.2, 0.15, 0.4, cx + 0.2, 0.2, cz + 0.6, '#334155', 12);
        box(scene, 0.1, 0.1, 0.1, cx + 0.2, 0.45, cz + 0.6, '#f8fafc', 0.2, 0.4, 0.1); // crumpled paper
    }

    // ─── MANAGEMENT / ORCHESTRATOR CORNER (cx:0 cz:-7) ─────────────────────
    {
        const cx = 0, cz = -7;
        // Massive Whiteboard
        box(scene, 2.8, 1.4, 0.04, cx, 1.4, cz - 1.2, '#f0f4f8'); // board
        box(scene, 2.9, 1.5, 0.02, cx, 1.4, cz - 1.22, '#2a2a3a'); // frame
        // Whiteboard stand (rolling wheels style)
        cylinder(scene, 0.03, 0.03, 1.8, cx - 1.3, 0.9, cz - 1.2, '#1a1a2e');
        cylinder(scene, 0.03, 0.03, 1.8, cx + 1.3, 0.9, cz - 1.2, '#1a1a2e');
        box(scene, 0.8, 0.04, 0.04, cx - 1.3, 0.04, cz - 1.2, '#1a1a2e');
        box(scene, 0.8, 0.04, 0.04, cx + 1.3, 0.04, cz + 1.2, '#1a1a2e');
        // Markers and eraser tray
        box(scene, 2.8, 0.04, 0.1, cx, 0.7, cz - 1.15, '#2a2a3a');
        // Marker
        box(scene, 0.12, 0.02, 0.02, cx + 0.4, 0.72, cz - 1.15, '#ef4444');
        box(scene, 0.12, 0.02, 0.02, cx + 0.6, 0.72, cz - 1.15, '#06b6d4');
        // Eraser
        box(scene, 0.15, 0.04, 0.06, cx - 0.5, 0.73, cz - 1.15, '#4b5563');
        // "Hand-drawn" sticky notes on board
        [['#fef08a', -0.8, 0.3], ['#fef08a', -0.5, 0.35], ['#fbcfe8', -0.9, 0], ['#a7f3d0', 0.8, 0.2]].forEach(([c, ox, oy]) =>
            box(scene, 0.25, 0.25, 0.01, cx + ox, 1.4 + oy, cz - 1.17, c));
        // Lines/charts drawn on board
        box(scene, 0.8, 0.015, 0.01, cx + 0.2, 1.6, cz - 1.17, '#ef4444', 0, 0, 0.2);
        box(scene, 0.4, 0.015, 0.01, cx + 0.7, 1.7, cz - 1.17, '#06b6d4', 0, 0, -0.4);
        // Standing Podium / Mat
        box(scene, 1.2, 0.02, 0.8, cx, 0.01, cz - 0.2, '#1a1a2e'); // anti-fatigue mat
        box(scene, 0.6, 0.9, 0.4, cx + 1.2, 0.45, cz - 0.4, '#2d2d4a'); // small side podium/desk
        box(scene, 0.65, 0.04, 0.45, cx + 1.2, 0.9, cz - 0.4, '#1a1a2e', 0.1, 0, 0); // tilted top
    }

    // ─── LOUNGE (center, cx:0 cz:0) ──────────────────────────────────────────
    {
        // L-sofa
        box(scene, 2.4, 0.18, 0.8, -0.4, 0.45, 0, '#2d2d4a'); // seat long
        box(scene, 0.8, 0.18, 1.6, -1.2, 0.45, 0.4, '#2d2d4a'); // seat short side
        box(scene, 2.4, 0.55, 0.12, -0.4, 0.74, 0.38, '#3d3d5a'); // back long
        box(scene, 0.12, 0.55, 1.6, -2.08, 0.74, 0.4, '#3d3d5a'); // back side
        // Cushions
        [[-1.0, 0.57, -0.05], [0.1, 0.57, -0.05], [1.0, 0.57, -0.05]].forEach(([x, y, z]) =>
            box(scene, 0.65, 0.15, 0.55, x, y, z, '#4a4a6a'));
        // Coffee table
        box(scene, 1.1, 0.06, 0.65, 0.5, 0.32, -0.0, '#1a1a2e');
        [[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]].forEach(([x, z]) =>
            box(scene, 0.05, 0.32, 0.05, 0.5 + x, 0.16, z, '#1a1a2e'));
        // Coffee cups on table
        cylinder(scene, 0.05, 0.045, 0.1, 0.35, 0.37, -0.1, '#ec4899', 10);
        cylinder(scene, 0.05, 0.045, 0.1, 0.65, 0.37, 0.1, '#6366f1', 10);
        // Plant (corner)
        cylinder(scene, 0.12, 0.15, 0.25, 1.5, 0.12, -1.5, '#5c3a20', 10);
        const plant = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 10, 10),
            new THREE.MeshStandardMaterial({ color: '#1a6a1a', roughness: 0.9, emissive: '#10b981', emissiveIntensity: 0.1 })
        );
        plant.position.set(1.5, 0.55, -1.5); scene.add(plant);
        // TV / display on wall - pushed further back
        box(scene, 2.2, 1.2, 0.06, 0, 2.0, -2.5, '#050510', 0, 0, 0, '#06b6d4');
    }

    // ─── BEDROOM (cx:0 cz:9) ─────────────────────────────────────────────────
    {
        const cx = 0, cz = 9;
        // Bed frame
        box(scene, 2.2, 0.18, 1.5, cx, 0.3, cz, '#1a1021');
        // Mattress
        box(scene, 2.1, 0.14, 1.4, cx, 0.46, cz, '#3a2a4a');
        // Pillow
        box(scene, 0.7, 0.12, 0.45, cx - 0.55, 0.58, cz - 0.5, '#2a1a3e');
        box(scene, 0.7, 0.12, 0.45, cx + 0.55, 0.58, cz - 0.5, '#2a1a3e');
        // Blanket (covering lower half)
        box(scene, 2.1, 0.1, 0.8, cx, 0.56, cz + 0.35, '#1a0f2e');
        // Headboard
        box(scene, 2.2, 0.8, 0.1, cx, 0.7, cz - 0.74, '#100818');
        // Bedside tables
        box(scene, 0.4, 0.4, 0.4, cx - 1.35, 0.5, cz - 0.5, '#1a1221');
        box(scene, 0.4, 0.4, 0.4, cx + 1.35, 0.5, cz - 0.5, '#1a1221');
        // Lamps
        cylinder(scene, 0.08, 0.04, 0.35, cx - 1.35, 0.87, cz - 0.5, '#f0e6c8', 12);
        cylinder(scene, 0.08, 0.04, 0.35, cx + 1.35, 0.87, cz - 0.5, '#f0e6c8', 12);
        // Stars removed per request.
    }

    // ─── Status → body colour mapping ──────────────────────────────────────────
    // idle = yellow, sleeping/offline = grey, active/online = green, busy = amber
    function agentBodyColor(status) {
        const s = (status || '').toLowerCase();
        if (s === 'idle' || s === 'standby') return '#eab308'; // yellow
        if (s === 'offline' || s === 'sleeping' || !status) return '#4b5563'; // grey
        if (s === 'active' || s === 'online') return '#10b981'; // green
        if (s === 'busy') return '#f59e0b'; // amber
        if (s === 'error') return '#ef4444'; // red
        return '#6b7280';
    }

    // ── Humanoid figure builder ─────────────────────────────────────────────────
    // Returns a Group containing head, torso, arms, legs. Root at foot level (y=0).
    function makeHumanoid(scene, bodyCol, accentCol) {
        const M = THREE.MeshStandardMaterial;
        const mat = (c, e) => new M({ color: c, roughness: 0.5, ...(e ? { emissive: e, emissiveIntensity: 0.25 } : {}) });
        const grp = new THREE.Group();
        // Legs
        [[-0.1, 0], [0.1, 0]].forEach(([ox]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.55, 8), mat(bodyCol));
            leg.position.set(ox, 0.275, 0); leg.castShadow = true; grp.add(leg);
        });
        // Feet
        [[-0.1, 0], [0.1, 0]].forEach(([ox]) => {
            const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.16), mat(bodyCol));
            foot.position.set(ox, 0.03, 0.03); grp.add(foot);
        });
        // Torso
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.18), mat(accentCol, accentCol));
        torso.position.set(0, 0.74, 0); torso.castShadow = true; grp.add(torso);
        // Arms
        [[-0.19, 0], [0.19, 0]].forEach(([ox]) => {
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.38, 8), mat(bodyCol));
            arm.position.set(ox, 0.65, 0);
            arm.rotation.z = ox < 0 ? 0.3 : -0.3;
            arm.castShadow = true; grp.add(arm);
        });
        // Neck
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 8), mat(bodyCol));
        neck.position.set(0, 0.98, 0); grp.add(neck);
        // Head
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 12), mat(bodyCol));
        head.position.set(0, 1.12, 0); head.castShadow = true; grp.add(head);
        // Eyes
        [[-0.05, 0], [0.05, 0]].forEach(([ox]) => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), new M({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.5 }));
            eye.position.set(ox, 1.13, 0.13); grp.add(eye);
        });
        scene.add(grp);
        return grp;
    }

    // ── Place agents ───────────────────────────────────────────────────────────
    const avatarGroups = [];  // { group, head, agent }
    const avatarMeshes = [];  // flat list of ALL meshes for raycasting
    const agentHudEl = el.querySelector('#office-agent-list');
    if (agentHudEl) agentHudEl.innerHTML = '';

    const zoneOccupancy = {};

    agents.forEach((agent, i) => {
        const zoneName = agentZone(agent);
        const zone = ZONES[zoneName];
        const occ = zoneOccupancy[zoneName] = (zoneOccupancy[zoneName] || 0) + 1;

        const row = Math.floor((occ - 1) / 2), col = (occ - 1) % 2;
        const px = zone.cx + (col - 0.5) * 1.4;
        const pz = zone.cz - 1.5 + row * 1.3;

        const bodyCol = agentBodyColor(agent.status);
        const accentCol = zone.color;
        const sColor = STATUS_COLOR[agent.status] || '#888';

        const grp = makeHumanoid(scene, bodyCol, accentCol);
        grp.position.set(px, 0, pz);
        grp.userData = { agent, color: accentCol, zone: zone.label, bodyCol };

        // Collect all child meshes for raycasting, tagging them with agent data
        grp.traverse(m => { if (m.isMesh) { m.userData = grp.userData; avatarMeshes.push(m); } });
        avatarGroups.push({ grp, agent });

        // Status halo ring at waist height
        const halo = new THREE.Mesh(
            new THREE.TorusGeometry(0.22, 0.018, 8, 32),
            new THREE.MeshStandardMaterial({ color: sColor, emissive: sColor, emissiveIntensity: 1.0 })
        );
        halo.position.set(px, 0.6, pz);
        halo.rotation.x = Math.PI / 2;
        scene.add(halo);

        // Name tag floating above head
        const tagTex = makeLabel(agent.name.slice(0, 14), 'rgba(0,0,0,0)', accentCol);
        const tag = new THREE.Mesh(
            new THREE.PlaneGeometry(1.1, 0.28),
            new THREE.MeshBasicMaterial({ map: tagTex, transparent: true, depthWrite: false })
        );
        tag.position.set(px, 1.55, pz);
        tag.userData = { isNameTag: true, agentIndex: i };
        scene.add(tag);

        // HUD entry
        if (agentHudEl) {
            agentHudEl.innerHTML += `<div style="display:flex;align-items:center;gap:.5rem;padding:.2rem 0;">
        <span style="width:8px;height:8px;border-radius:50%;background:${bodyCol};box-shadow:0 0 5px ${bodyCol};flex-shrink:0;"></span>
        <span style="flex:1;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${agent.name}</span>
        <span style="font-size:.7rem;color:${sColor};">${agent.status || '?'}</span>
      </div>`;
        }
    });

    if (!agents.length && agentHudEl) {
        agentHudEl.innerHTML = '<span style="color:#4b5563;font-size:.8rem">No agents yet</span>';
    }

    // Update zone legend in topbar
    const legendEl = el.querySelector('#office-zone-legend');
    if (legendEl) {
        legendEl.innerHTML = Object.values(ZONES).map(z =>
            `<span style="display:flex;align-items:center;gap:.3rem;">
        <span style="width:8px;height:8px;border-radius:50%;background:${z.color};flex-shrink:0;"></span>${z.label}
       </span>`).join('');
    }

    // ── Tooltip (raycaster) ──
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const tooltip = el.querySelector('#office-tooltip');

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(avatarMeshes);
        if (hits.length && tooltip) {
            const { agent, color, zone } = hits[0].object.userData;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
            tooltip.style.top = (e.clientY - rect.top + 14) + 'px';
            tooltip.innerHTML = `<strong style="color:${color}">${agent.name}</strong><br>
        <span style="color:#9ca3af;font-size:.75rem">${agent.role || 'Agent'}</span><br>
        <span style="color:#6b7280;font-size:.72rem">${zone}</span><br>
        <span style="color:#6b7280;font-size:.72rem">${agent.model || ''}</span>`;
            canvas.style.cursor = 'pointer';
        } else if (tooltip) {
            tooltip.style.display = 'none';
            canvas.style.cursor = '';
        }
    });

    // ── Billboard (name tags always face camera) ──
    const nameTags = [];
    scene.traverse(obj => {
        if (obj.isMesh && obj.material?.map instanceof THREE.CanvasTexture && obj.geometry.parameters?.width > 0.8 && obj.geometry.parameters?.height < 0.4) {
            nameTags.push(obj);
        }
    });

    // ── Animation loop ──
    let t = 0;
    function animate() {
        _animId = requestAnimationFrame(animate);
        t += 0.012;
        // Bob entire humanoid groups
        avatarGroups.forEach(({ grp }, i) => {
            grp.position.y = Math.sin(t + i * 1.4) * 0.04;
        });
        // Name tags hover above head and face camera
        nameTags.forEach((tag, i) => {
            const grp = avatarGroups[i];
            if (grp) tag.position.y = grp.grp.position.y + 1.55;
            tag.lookAt(camera.position);
        });
        controls.update();
        _renderer.render(scene, camera);
    }
    animate();

    // ── Resize ──
    _ro = new ResizeObserver(() => {
        if (!_renderer) return;
        const nw = canvas.clientWidth, nh = canvas.clientHeight;
        if (nw > 0 && nh > 0) {
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            _renderer.setSize(nw, nh, false);
        }
    });
    _ro.observe(canvas);
}
