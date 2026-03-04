// ─── office3d.js — 3D Office Page (Three.js r128, has examples/js/) ──────────
let _animId = null;
let _renderer = null;

export async function init(el) {
    el.innerHTML = renderPage();
    try {
        await loadThree();
        const agents = await window.apiFetch('/agents') || [];
        buildScene(agents, el);
    } catch (e) {
        el.querySelector('#office-canvas-wrap').innerHTML =
            `<div class="empty-state" style="height:100%;">
        <i class="fa fa-cube"></i>
        <p>3D Office could not start.<br><small style="opacity:0.6">${e.message || e}</small></p>
       </div>`;
        console.error('[3D Office]', e);
    }
}

export function refresh(el) { /* scene persists */ }

export function destroy() {
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    if (_renderer) { _renderer.dispose(); _renderer = null; }
}

function renderPage() {
    return `
  <div class="page-header">
    <div>
      <h2 class="page-heading">3D Office</h2>
      <p class="page-sub">Live visualization of your agent workspace</p>
    </div>
  </div>
  <div id="office-canvas-wrap" style="position:relative;height:calc(100vh - 160px);background:#0a0a0f;border-radius:12px;overflow:hidden;border:1px solid var(--color-border);">
    <canvas id="office-canvas" style="width:100%;height:100%;display:block;"></canvas>
    <div style="position:absolute;top:1rem;left:1rem;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);border-radius:10px;padding:0.75rem 1rem;border:1px solid rgba(255,255,255,0.08);">
      <div style="font-size:0.72rem;color:#9ca3af;margin-bottom:0.5rem;font-weight:600;letter-spacing:0.05em;">LIVE AGENTS</div>
      <div id="office-agent-list" style="display:flex;flex-direction:column;gap:0.35rem;font-size:0.82rem;color:#e2e8f0;min-width:160px;"></div>
    </div>
    <div id="office-tooltip" style="position:absolute;display:none;background:rgba(10,10,20,0.92);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:0.5rem 0.75rem;font-size:0.82rem;pointer-events:none;z-index:10;"></div>
    <div style="position:absolute;bottom:1rem;right:1rem;font-size:0.72rem;color:rgba(255,255,255,0.3);">Scroll to zoom · Drag to rotate · Hover for info</div>
  </div>`;
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`CDN load failed: ${src}`));
        document.head.appendChild(s);
    });
}

async function loadThree() {
    if (window.THREE && window.THREE.OrbitControls) return;
    // Use r128 — last version with examples/js/ UMD builds
    const base = 'https://cdn.jsdelivr.net/npm/three@0.128.0';
    await loadScript(`${base}/build/three.min.js`);
    await loadScript(`${base}/examples/js/controls/OrbitControls.js`);
}

const DESK_POSITIONS = [[0, 0, 0], [3, 0, 0], [6, 0, 0], [0, 0, 3], [3, 0, 3], [6, 0, 3]];
const AGENT_COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
const STATUS_COLORS = { active: '#10b981', standby: '#f59e0b', offline: '#ef4444', idle: '#888', busy: '#f59e0b' };

function buildScene(agents, el) {
    const THREE = window.THREE;
    const canvas = el.querySelector('#office-canvas');
    if (!canvas || !THREE) return;

    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 500;

    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    _renderer.setSize(w, h, false);
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0a0f');
    scene.fog = new THREE.Fog('#0a0a0f', 18, 32);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(5, 9, 12);

    const controls = new THREE.OrbitControls(camera, _renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 3; controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI / 2.1;

    scene.add(new THREE.AmbientLight('#ffffff', 0.5));
    const dir = new THREE.DirectionalLight('#ffffff', 1.2);
    dir.position.set(6, 10, 6); dir.castShadow = true;
    scene.add(dir);

    // Floor + grid
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 22),
        new THREE.MeshStandardMaterial({ color: '#13131a', roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.GridHelper(22, 22, '#2a2a3a', '#1a1a24'));

    const avatarMeshes = [];
    const agentHud = el.querySelector('#office-agent-list');
    if (agentHud) agentHud.innerHTML = '';

    agents.slice(0, 6).forEach((agent, i) => {
        const pos = DESK_POSITIONS[i] || [i * 3, 0, 0];
        const color = AGENT_COLORS[i % AGENT_COLORS.length];
        const statusColor = STATUS_COLORS[agent.status] || '#888';

        // Desk
        const desk = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.08, 0.85),
            new THREE.MeshStandardMaterial({ color: '#1e1e2e' })
        );
        desk.position.set(pos[0], 0.5, pos[2]); desk.castShadow = true;
        scene.add(desk);

        // Legs
        [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]].forEach(([x, z]) => {
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
            new THREE.MeshStandardMaterial({ color: '#1a1a2e', emissive: color, emissiveIntensity: 0.35 })
        );
        monitor.position.set(pos[0], 0.74, pos[2] - 0.25);
        scene.add(monitor);

        // Avatar
        const avatar = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 16, 16),
            new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4, emissive: color, emissiveIntensity: 0.25 })
        );
        avatar.position.set(pos[0], 1.1, pos[2] + 0.18);
        avatar.userData = { agent, color };
        avatar.castShadow = true;
        scene.add(avatar);
        avatarMeshes.push(avatar);

        // Status ring
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.27, 0.025, 8, 32),
            new THREE.MeshStandardMaterial({ color: statusColor, emissive: statusColor, emissiveIntensity: 0.9 })
        );
        ring.position.copy(avatar.position); ring.rotation.x = Math.PI / 2;
        scene.add(ring);

        if (agentHud) {
            agentHud.innerHTML += `<div style="display:flex;align-items:center;gap:0.5rem;">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;box-shadow:0 0 6px ${color};"></span>
        <span>${agent.name}</span>
        <span style="color:${statusColor};font-size:0.72rem;margin-left:auto;">${agent.status || 'idle'}</span>
      </div>`;
        }
    });

    if (!agents.length && agentHud) {
        agentHud.innerHTML = '<span style="color:#666;font-size:0.8rem">No agents configured</span>';
    }

    // Hover tooltip
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
            tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
            tooltip.style.top = (e.clientY - rect.top + 14) + 'px';
            tooltip.innerHTML = `<strong style="color:${color}">${agent.name}</strong><br>
        <span style="color:#9ca3af">${agent.role || 'Agent'}</span><br>
        <span style="color:#6b7280;font-size:0.72rem">${agent.model || '—'}</span>`;
            canvas.style.cursor = 'pointer';
        } else if (tooltip) {
            tooltip.style.display = 'none';
            canvas.style.cursor = '';
        }
    });

    // Animate
    let t = 0;
    function animate() {
        _animId = requestAnimationFrame(animate);
        t += 0.012;
        avatarMeshes.forEach((m, i) => { m.position.y = 1.1 + Math.sin(t + i * 1.3) * 0.045; });
        controls.update();
        _renderer.render(scene, camera);
    }
    animate();

    // Resize
    const ro = new ResizeObserver(() => {
        const nw = canvas.clientWidth, nh = canvas.clientHeight;
        if (nw > 0 && nh > 0 && _renderer) {
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            _renderer.setSize(nw, nh, false);
        }
    });
    ro.observe(canvas);
}
