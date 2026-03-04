// ─── office3d.js — 3D Office Page (Three.js CDN, no build step) ──────────────
let _animId = null;
let _renderer = null;

export async function init(el) {
    el.innerHTML = renderPage();
    await loadThree();
    const agents = await window.apiFetch('/agents') || [];
    buildScene(agents, el);
}

export function refresh(el) { /* scene persists */ }

// Called by SPA router when navigating away
export function destroy() {
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    _renderer?.dispose();
    _renderer = null;
}

function renderPage() {
    return `
  <div style="position:relative;height:calc(100vh - 130px);background:#0a0a0f;border-radius:12px;overflow:hidden;">
    <canvas id="office-canvas" style="width:100%;height:100%;display:block;"></canvas>
    <div style="position:absolute;top:1rem;left:1rem;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);border-radius:10px;padding:0.75rem 1rem;border:1px solid rgba(255,255,255,0.08);">
      <div style="font-size:0.78rem;color:#aaa;margin-bottom:0.4rem;font-weight:600;letter-spacing:0.05em;">LIVE AGENTS</div>
      <div id="office-agent-list" style="display:flex;flex-direction:column;gap:0.3rem;font-size:0.82rem;color:#e2e8f0;"></div>
    </div>
    <div id="office-tooltip" style="position:absolute;display:none;background:rgba(0,0,0,0.85);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:0.5rem 0.75rem;font-size:0.82rem;pointer-events:none;z-index:10;"></div>
    <div style="position:absolute;bottom:1rem;right:1rem;font-size:0.72rem;color:rgba(255,255,255,0.3);">Scroll to zoom • Drag to rotate • Click for details</div>
  </div>`;
}

async function loadThree() {
    if (window.THREE) return;
    await loadScript('https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/three@0.161.0/examples/js/controls/OrbitControls.js');
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}

const DESK_POSITIONS = [[0, 0, 0], [3, 0, 0], [6, 0, 0], [0, 0, 3], [3, 0, 3], [6, 0, 3]];
const AGENT_COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
const STATUS_COLORS = { active: '#10b981', standby: '#f59e0b', offline: '#ef4444', idle: '#888', busy: '#f59e0b' };

function buildScene(agents, el) {
    const THREE = window.THREE;
    const canvas = el.querySelector('#office-canvas');
    if (!canvas || !THREE) return;

    const w = canvas.clientWidth || canvas.offsetWidth || 800;
    const h = canvas.clientHeight || canvas.offsetHeight || 500;

    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _renderer.setSize(w, h, false);
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0a0f');
    scene.fog = new THREE.Fog('#0a0a0f', 15, 30);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(4, 8, 10);

    const controls = new THREE.OrbitControls(camera, _renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 20;
    controls.maxPolarAngle = Math.PI / 2.1;

    scene.add(new THREE.AmbientLight('#ffffff', 0.4));
    const dir = new THREE.DirectionalLight('#ffffff', 1.2);
    dir.position.set(5, 10, 5);
    dir.castShadow = true;
    scene.add(dir);

    // Floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshStandardMaterial({ color: '#13131a', roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.GridHelper(20, 20, '#2a2a3a', '#1a1a24'));

    const avatarMeshes = [];
    const agentHud = el.querySelector('#office-agent-list');
    if (agentHud) agentHud.innerHTML = '';

    agents.slice(0, 6).forEach((agent, i) => {
        const pos = DESK_POSITIONS[i] || [i * 3, 0, 0];
        const color = AGENT_COLORS[i % AGENT_COLORS.length];
        const statusColor = STATUS_COLORS[agent.status] || '#888';

        // Desk surface
        const desk = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.08, 0.8),
            new THREE.MeshStandardMaterial({ color: '#1e1e2e' })
        );
        desk.position.set(pos[0], 0.5, pos[2]);
        desk.castShadow = true;
        scene.add(desk);

        // Desk legs
        [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]].forEach(([x, z]) => {
            const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6),
                new THREE.MeshStandardMaterial({ color: '#2a2a3a' })
            );
            leg.position.set(pos[0] + x, 0.25, pos[2] + z);
            scene.add(leg);
        });

        // Monitor
        const monitor = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 0.4, 0.04),
            new THREE.MeshStandardMaterial({ color: '#1a1a2e', emissive: color, emissiveIntensity: 0.3 })
        );
        monitor.position.set(pos[0], 0.74, pos[2] - 0.22);
        scene.add(monitor);

        // Avatar sphere
        const avatar = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 16, 16),
            new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4, emissive: color, emissiveIntensity: 0.2 })
        );
        avatar.position.set(pos[0], 1.1, pos[2] + 0.2);
        avatar.userData = { agent, color };
        avatar.castShadow = true;
        scene.add(avatar);
        avatarMeshes.push(avatar);

        // Status ring
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.26, 0.025, 8, 32),
            new THREE.MeshStandardMaterial({ color: statusColor, emissive: statusColor, emissiveIntensity: 0.8 })
        );
        ring.position.copy(avatar.position);
        ring.rotation.x = Math.PI / 2;
        scene.add(ring);

        // HUD entry
        if (agentHud) {
            agentHud.innerHTML += `<div style="display:flex;align-items:center;gap:0.5rem;">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <span>${agent.name}</span>
        <span style="color:${statusColor};font-size:0.72rem;margin-left:auto;">${agent.status || 'idle'}</span>
      </div>`;
        }
    });

    // Show placeholder if no agents
    if (!agents.length && agentHud) agentHud.innerHTML = '<span style="color:#666;font-size:0.8rem">No agents configured</span>';

    // Raycaster for hover tooltip
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
            const { agent, color } = hits[0].object.userData;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
            tooltip.style.top = (e.clientY - rect.top + 12) + 'px';
            tooltip.innerHTML = `<strong style="color:${color}">${agent.name}</strong><br>
        <span style="color:#aaa">${agent.role || 'Agent'}</span><br>
        <span style="color:#888;font-size:0.72rem">${agent.model || '—'}</span>`;
            canvas.style.cursor = 'pointer';
        } else if (tooltip) {
            tooltip.style.display = 'none';
            canvas.style.cursor = '';
        }
    });

    // Animation loop
    let t = 0;
    const animate = () => {
        _animId = requestAnimationFrame(animate);
        t += 0.01;
        avatarMeshes.forEach((mesh, i) => { mesh.position.y = 1.1 + Math.sin(t + i * 1.2) * 0.04; });
        controls.update();
        _renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const onResize = () => {
        const nw = canvas.clientWidth, nh = canvas.clientHeight;
        if (nw && nh) {
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            _renderer.setSize(nw, nh, false);
        }
    };
    window.addEventListener('resize', onResize);
}
