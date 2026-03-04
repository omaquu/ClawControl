// ─── office3d.js — 3D Office Page (Three.js CDN, no build step) ──────────────
export const page = {
    id: 'office3d',
    title: '🏢 3D Office',
    icon: 'fa-building',
    _renderer: null,
    _animId: null,

    render() {
        return `
    <div style="position:relative;height:calc(100vh - 120px);background:#0a0a0f;border-radius:12px;overflow:hidden;">
      <canvas id="office-canvas" style="width:100%;height:100%;display:block;"></canvas>
      <!-- HUD overlay -->
      <div style="position:absolute;top:1rem;left:1rem;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);border-radius:10px;padding:0.75rem 1rem;border:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:0.78rem;color:#aaa;margin-bottom:0.4rem;font-weight:600;letter-spacing:0.05em;">OFFICE VIEW</div>
        <div id="office-agent-list" style="display:flex;flex-direction:column;gap:0.3rem;font-size:0.82rem;"></div>
      </div>
      <div id="office-tooltip" style="position:absolute;display:none;background:rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.5rem 0.75rem;font-size:0.82rem;pointer-events:none;"></div>
      <div style="position:absolute;bottom:1rem;right:1rem;font-size:0.72rem;color:rgba(255,255,255,0.3);">Scroll to zoom • Drag to rotate • Click desk for details</div>
    </div>`;
    },

    async init() {
        await this.loadThree();
        const agents = await window.api('/api/agents');
        this.buildScene(agents);
        window.addEventListener('resize', () => this.onResize(), { signal: this._abortCtrl?.signal });
    },

    async loadThree() {
        if (window.THREE) return;
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.min.js';
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/js/controls/OrbitControls.js';
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    },

    DESK_POSITIONS: [
        [0, 0, 0], [3, 0, 0], [6, 0, 0],
        [0, 0, 3], [3, 0, 3], [6, 0, 3],
    ],
    AGENT_COLORS: ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'],
    STATUS_COLORS: { active: '#10b981', standby: '#f59e0b', offline: '#ef4444', idle: '#888' },

    buildScene(agents) {
        const THREE = window.THREE;
        const canvas = document.getElementById('office-canvas');
        if (!canvas) return;

        const w = canvas.clientWidth, h = canvas.clientHeight || 600;

        const renderer = this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(w, h, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#0a0a0f');
        scene.fog = new THREE.Fog('#0a0a0f', 15, 30);

        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        camera.position.set(4, 8, 10);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; controls.dampingFactor = 0.08;
        controls.minDistance = 3; controls.maxDistance = 20;
        controls.maxPolarAngle = Math.PI / 2.1;

        // Lights
        scene.add(new THREE.AmbientLight('#ffffff', 0.4));
        const dir = new THREE.DirectionalLight('#ffffff', 1.2);
        dir.position.set(5, 10, 5); dir.castShadow = true;
        scene.add(dir);

        // Floor
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#13131a', roughness: 0.9 }));
        floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
        scene.add(floor);

        // Grid
        scene.add(new THREE.GridHelper(20, 20, '#2a2a3a', '#1a1a24'));

        // Desks & avatars
        const objects = [];
        const agentHud = document.getElementById('office-agent-list');
        agentHud.innerHTML = '';

        agents.slice(0, 6).forEach((agent, i) => {
            const pos = this.DESK_POSITIONS[i] || [i * 3, 0, 0];
            const color = this.AGENT_COLORS[i % this.AGENT_COLORS.length];

            // Desk
            const desk = new THREE.Mesh(
                new THREE.BoxGeometry(1.4, 0.08, 0.8),
                new THREE.MeshStandardMaterial({ color: '#1e1e2e' })
            );
            desk.position.set(pos[0], 0.5, pos[2]); desk.castShadow = true;
            scene.add(desk);

            // Desk legs
            [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]].forEach(([x, z]) => {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), new THREE.MeshStandardMaterial({ color: '#2a2a3a' }));
                leg.position.set(pos[0] + x, 0.25, pos[2] + z);
                scene.add(leg);
            });

            // Monitor
            const monitor = new THREE.Mesh(
                new THREE.BoxGeometry(0.6, 0.4, 0.04),
                new THREE.MeshStandardMaterial({ color: '#1a1a2e', emissive: color, emissiveIntensity: 0.3 })
            );
            monitor.position.set(pos[0], 0.74, pos[2] - 0.2);
            scene.add(monitor);

            // Avatar blob
            const avatar = new THREE.Mesh(
                new THREE.SphereGeometry(0.22, 16, 16),
                new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4, emissive: color, emissiveIntensity: 0.2 })
            );
            avatar.position.set(pos[0], 1.1, pos[2] + 0.2);
            avatar.userData = { agent, color };
            avatar.castShadow = true;
            scene.add(avatar);
            objects.push(avatar);

            // Status ring
            const statusColor = this.STATUS_COLORS[agent.status] || '#888';
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(0.26, 0.025, 8, 32),
                new THREE.MeshStandardMaterial({ color: statusColor, emissive: statusColor, emissiveIntensity: 0.8 })
            );
            ring.position.copy(avatar.position);
            ring.rotation.x = Math.PI / 2;
            scene.add(ring);

            // Name label (HUD)
            agentHud.innerHTML += `<div style="display:flex;align-items:center;gap:0.5rem;">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <span style="color:#e2e8f0;">${agent.name}</span>
        <span style="color:${statusColor};font-size:0.72rem;margin-left:auto;">${agent.status || 'idle'}</span>
      </div>`;
        });

        // Raycaster for hover tooltip
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const tooltip = document.getElementById('office-tooltip');

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const hits = raycaster.intersectObjects(objects);
            if (hits.length) {
                const { agent, color } = hits[0].object.userData;
                tooltip.style.display = 'block';
                tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                tooltip.style.top = (e.clientY - rect.top + 12) + 'px';
                tooltip.innerHTML = `<strong style="color:${color}">${agent.name}</strong><br>
          <span style="color:#aaa">${agent.role || 'Agent'}</span><br>
          <span style="color:#888;font-size:0.72rem">${agent.model || '—'}</span>`;
                canvas.style.cursor = 'pointer';
            } else {
                tooltip.style.display = 'none';
                canvas.style.cursor = '';
            }
        });

        // Animation loop
        let t = 0;
        const animate = () => {
            this._animId = requestAnimationFrame(animate);
            t += 0.01;
            objects.forEach((mesh, i) => { mesh.position.y = 1.1 + Math.sin(t + i * 1.2) * 0.04; });
            controls.update();
            renderer.render(scene, camera);
        };
        animate();
        this._scene = scene; this._camera = camera; this._controls = controls;
    },

    onResize() {
        const canvas = document.getElementById('office-canvas');
        if (!canvas || !this._renderer || !this._camera) return;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        this._camera.aspect = w / h;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(w, h, false);
    },

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        this._renderer?.dispose();
        this._renderer = null;
    }
};
