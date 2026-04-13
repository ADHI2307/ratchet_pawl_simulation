import { useState, useEffect, useRef, useCallback } from "react";

// ─── PHYSICS ────────────────────────────────────────────────────────────────
function calcPhysics({ mass, theta, mu_r, r_tire, r_ratchet, pawl_t_mm, pawl_w_mm, material }) {
  const g = 9.81;
  const thetaRad = (theta * Math.PI) / 180;
  const W = mass * g;
  const F_normal = W * Math.cos(thetaRad);
  const F_grade = W * Math.sin(thetaRad);
  const F_roll = mu_r * W * Math.cos(thetaRad);
  const F_net = W * (Math.sin(thetaRad) - mu_r * Math.cos(thetaRad));
  const T_axle = F_net * r_tire;
  const F_pawl = T_axle / r_ratchet;
  const A = (pawl_w_mm / 1000) * (pawl_t_mm / 1000); // m²
  const tau = F_pawl / A; // Pa
  const tau_MPa = tau / 1e6;
  const shear_strength = material === "EN8" ? 232.5 : 125; // MPa
  const FoS = shear_strength / tau_MPa;
  const status = FoS < 1.5 ? "FAIL" : FoS < 3 ? "WARNING" : "SAFE";
  return { W, F_normal, F_grade, F_roll, F_net, T_axle, F_pawl, tau_MPa, FoS, status };
}

// ─── DEFAULTS ───────────────────────────────────────────────────────────────
const DEFAULTS = {
  mass: 250, theta: 15, mu_r: 0.04, r_tire: 0.3,
  r_ratchet: 0.072, pawl_t_mm: 10, pawl_w_mm: 12.5, material: "EN8",
};

// ─── TOOLTIP ─────────────────────────────────────────────────────────────────
function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="absolute bottom-full left-0 mb-1 w-52 text-xs bg-gray-900 text-gray-100 rounded px-2 py-1 z-50 pointer-events-none border border-gray-600 shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

// ─── ANIMATED CANVAS SIMULATION ──────────────────────────────────────────────
function RatchetCanvas({ params, physics, animRef }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ angle: 0, pawlAngle: 0, wobble: 0, brokenParts: [], failFlash: 0 });
  const rafRef = useRef(null);
  const prevStatusRef = useRef("SAFE");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const cx = W / 2 + 10, cy = H / 2 + 20;
    const R = 68; // ratchet radius px
    const TEETH = 16;

    // colors
    const colors = {
      SAFE: { gear: "#22c55e", pawl: "#4ade80", glow: "rgba(34,197,94,0.18)", text: "#86efac" },
      WARNING: { gear: "#eab308", pawl: "#fde047", glow: "rgba(234,179,8,0.18)", text: "#fde68a" },
      FAIL: { gear: "#ef4444", pawl: "#f87171", glow: "rgba(239,68,68,0.25)", text: "#fca5a5" },
    };

    const s = stateRef.current;
    let lastTime = null;

    function drawRatchetGear(ctx, cx, cy, R, teeth, angle, col, broken) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      // glow
      const grd = ctx.createRadialGradient(0, 0, R * 0.4, 0, 0, R * 1.35);
      grd.addColorStop(0, col.glow);
      grd.addColorStop(1, "transparent");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.4, 0, Math.PI * 2); ctx.fill();

      // gear body
      ctx.beginPath();
      for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2;
        const a1 = ((i + 0.45) / teeth) * Math.PI * 2;
        const a2 = ((i + 0.55) / teeth) * Math.PI * 2;
        const a3 = ((i + 1) / teeth) * Math.PI * 2;
        ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
        ctx.lineTo(Math.cos(a1) * (R + 13), Math.sin(a1) * (R + 13));
        ctx.lineTo(Math.cos(a2) * (R + 13), Math.sin(a2) * (R + 13));
        ctx.lineTo(Math.cos(a3) * R, Math.sin(a3) * R);
      }
      ctx.closePath();
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, R + 13);
      grad.addColorStop(0, "#1e293b");
      grad.addColorStop(0.6, col.gear + "88");
      grad.addColorStop(1, col.gear);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = col.gear;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // hub
      ctx.beginPath(); ctx.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = "#0f172a"; ctx.fill();
      ctx.strokeStyle = col.gear; ctx.lineWidth = 2; ctx.stroke();

      // spokes
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R * 0.31, Math.sin(a) * R * 0.31);
        ctx.lineTo(Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82);
        ctx.strokeStyle = col.gear + "99"; ctx.lineWidth = 3; ctx.stroke();
      }

      // broken crack effect
      if (broken) {
        ctx.strokeStyle = "#ff0000cc"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-R * 0.6, -R * 0.3); ctx.lineTo(R * 0.1, R * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(R * 0.3, -R * 0.6); ctx.lineTo(-R * 0.2, R * 0.3); ctx.stroke();
      }
      ctx.restore();
    }

    function drawPawl(ctx, cx, cy, pawlAngle, col, broken) {
      const px = cx + R + 38;
      const py = cy;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(pawlAngle);

      const len = 44, wide = 10;
      ctx.beginPath();
      ctx.moveTo(-wide / 2, -len * 0.6);
      ctx.lineTo(wide / 2, -len * 0.6);
      ctx.lineTo(wide * 0.4, len * 0.4);
      ctx.lineTo(-wide * 0.4, len * 0.4);
      ctx.closePath();

      if (broken) {
        ctx.fillStyle = "#ef4444cc";
        ctx.strokeStyle = "#ff0000";
      } else {
        ctx.fillStyle = col.pawl + "cc";
        ctx.strokeStyle = col.pawl;
      }
      ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();

      // pivot dot
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#94a3b8"; ctx.fill();

      if (broken) {
        ctx.strokeStyle = "#ff000099"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-wide / 2, 0); ctx.lineTo(wide * 0.4, len * 0.2); ctx.stroke();
      }
      ctx.restore();
    }

    function drawVehicle(ctx, incline) {
      const iRad = (incline * Math.PI) / 180;
      // Slope base
      const sx = 30, sy = H - 25;
      const ex = W - 30, ey = H - 25 - (W - 60) * Math.tan(iRad);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, Math.max(ey, 30));
      ctx.lineTo(W - 30, H - 25);
      ctx.closePath();
      const sgrad = ctx.createLinearGradient(0, sy, 0, sy - 60);
      sgrad.addColorStop(0, "#1e293b");
      sgrad.addColorStop(1, "#334155");
      ctx.fillStyle = sgrad;
      ctx.fill();
      ctx.strokeStyle = "#475569"; ctx.lineWidth = 1.5; ctx.stroke();

      // slope label
      ctx.fillStyle = "#64748b";
      ctx.font = "11px 'Courier New', monospace";
      ctx.fillText(`θ = ${incline}°`, sx + 14, sy - 8);

      ctx.restore();
    }

    function drawAxle(ctx, cx, cy, col) {
      ctx.save();
      const aw = 80;
      const grad = ctx.createLinearGradient(cx - aw, cy, cx + aw, cy);
      grad.addColorStop(0, "#1e293b");
      grad.addColorStop(0.5, col.gear + "66");
      grad.addColorStop(1, "#1e293b");
      ctx.fillStyle = grad;
      ctx.fillRect(cx - aw, cy - 5, aw * 2, 10);
      ctx.strokeStyle = col.gear + "55"; ctx.lineWidth = 1;
      ctx.strokeRect(cx - aw, cy - 5, aw * 2, 10);
      ctx.restore();
    }

    function drawStatusBadge(ctx, status, FoS, W, H) {
      const col = colors[status];
      ctx.save();
      // badge bg
      const bx = W / 2 - 70, by = 12, bw = 140, bh = 34;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 6);
      ctx.fillStyle = col.gear + "22"; ctx.fill();
      ctx.strokeStyle = col.gear; ctx.lineWidth = 1.5; ctx.stroke();

      ctx.fillStyle = col.text;
      ctx.font = "bold 14px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText(status === "FAIL" ? "⚠ PAWL FAILURE" : status === "WARNING" ? "⚡ WARNING" : "✓ SYSTEM SAFE", W / 2, by + 14);
      ctx.font = "11px 'Courier New', monospace";
      ctx.fillText(`FoS = ${FoS.toFixed(2)}`, W / 2, by + 27);
      ctx.restore();
    }

    function drawForceArrow(ctx, cx, cy, fx, fy, label, col, alpha = 1) {
      if (Math.abs(fx) < 0.5 && Math.abs(fy) < 0.5) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + fx, cy + fy); ctx.stroke();
      // arrowhead
      const angle = Math.atan2(fy, fx);
      const ah = 8;
      ctx.beginPath();
      ctx.moveTo(cx + fx, cy + fy);
      ctx.lineTo(cx + fx - ah * Math.cos(angle - 0.4), cy + fy - ah * Math.sin(angle - 0.4));
      ctx.lineTo(cx + fx - ah * Math.cos(angle + 0.4), cy + fy - ah * Math.sin(angle + 0.4));
      ctx.closePath(); ctx.fill();
      ctx.font = "10px 'Courier New', monospace";
      ctx.fillText(label, cx + fx + 4, cy + fy - 4);
      ctx.restore();
    }

    function drawParticleSparks(ctx, cx, cy, col) {
      if (s.brokenParts.length === 0) return;
      for (let p of s.brokenParts) {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        p.x += p.vx; p.y += p.vy; p.vy += 0.2;
        p.life -= 0.018; p.size *= 0.97;
      }
      s.brokenParts = s.brokenParts.filter(p => p.life > 0);
    }

    function spawnSparks(cx, cy) {
      for (let i = 0; i < 28; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 1;
        s.brokenParts.push({
          x: cx + R + 38 + (Math.random() - 0.5) * 20,
          y: cy + (Math.random() - 0.5) * 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1,
          life: 1, size: Math.random() * 4 + 1,
        });
      }
    }

    function loop(ts) {
      if (!lastTime) lastTime = ts;
      const dt = Math.min((ts - lastTime) / 1000, 0.05);
      lastTime = ts;

      const { status, FoS, F_net, T_axle } = physics;
      const col = colors[status];

      // Animate rotation
      const rotSpeed = status === "FAIL" ? 1.4 : status === "WARNING" ? 0.15 : 0.03;
      const backward = status === "FAIL";
      if (status !== "SAFE" || params.theta > 2) {
        s.angle += (backward ? 1 : -1) * rotSpeed * dt * Math.PI * 2;
      }

      // Pawl angle: engaged = slightly into gear, relaxed = out
      const targetPawl = status === "SAFE" ? 0.22 : status === "WARNING" ? 0.32 : (backward ? 0.65 : 0.4);
      s.pawlAngle += (targetPawl - s.pawlAngle) * 0.1;

      // Wobble on warning
      s.wobble = status === "WARNING" ? Math.sin(ts * 0.012) * 0.04 : 0;

      // Failure flash
      if (status === "FAIL") {
        s.failFlash = (ts % 800 < 400) ? 0.7 : 0.2;
      } else { s.failFlash = 0; }

      // Spawn sparks on failure transition
      if (status === "FAIL" && prevStatusRef.current !== "FAIL" && s.brokenParts.length === 0) {
        spawnSparks(cx, cy);
      }
      prevStatusRef.current = status;

      // ── DRAW ──
      ctx.clearRect(0, 0, W, H);

      // Bg
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, "#0a0f1e");
      bgGrad.addColorStop(1, "#0f172a");
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

      // Grid dots
      ctx.fillStyle = "#1e293b44";
      for (let gx = 20; gx < W; gx += 24) for (let gy = 20; gy < H; gy += 24) {
        ctx.beginPath(); ctx.arc(gx, gy, 0.8, 0, Math.PI * 2); ctx.fill();
      }

      drawVehicle(ctx, params.theta);
      drawAxle(ctx, cx, cy, col);
      drawRatchetGear(ctx, cx, cy, R, TEETH, s.angle + s.wobble, col, status === "FAIL" && s.failFlash > 0.5);
      drawPawl(ctx, cx, cy, -Math.PI / 2 + s.pawlAngle + s.wobble, col, status === "FAIL" && s.failFlash > 0.5);
      drawParticleSparks(ctx, cx, cy, col.gear);

      // Force arrows
      const scale = 0.035;
      drawForceArrow(ctx, cx, cy + R + 26, 0, Math.min(physics.F_grade * scale, 60), "Fg", "#f97316", 0.8);
      drawForceArrow(ctx, cx - 16, cy + R + 26, 0, Math.min(physics.F_net * scale, 55), "Fn", "#a78bfa", 0.7);

      // Failure overlay
      if (status === "FAIL") {
        ctx.save();
        ctx.fillStyle = `rgba(239,68,68,${s.failFlash * 0.12})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      drawStatusBadge(ctx, status, FoS, W, H);

      // Torque label
      ctx.save();
      ctx.fillStyle = col.text + "aa";
      ctx.font = "10px 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`T = ${T_axle.toFixed(1)} Nm`, 10, H - 10);
      ctx.restore();

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [physics, params]);

  return (
    <canvas
      ref={canvasRef}
      width={440}
      height={320}
      style={{ borderRadius: "10px", background: "#0a0f1e", display: "block" }}
    />
  );
}

// ─── MINI TORQUE CHART ────────────────────────────────────────────────────────
function TorqueChart({ params }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const pad = { l: 44, r: 12, t: 14, b: 28 };
    const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;

    // Generate data
    const angles = Array.from({ length: 41 }, (_, i) => i);
    const torques = angles.map(a => {
      const p = calcPhysics({ ...params, theta: a });
      return Math.max(0, p.T_axle);
    });
    const maxT = Math.max(...torques, 1);

    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a0f1e"); bg.addColorStop(1, "#0f172a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ch - (i / 4) * ch;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y);
      ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#475569"; ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText((maxT * i / 4).toFixed(0), pad.l - 4, y + 3);
    }

    // Line gradient fill
    const lineGrad = ctx.createLinearGradient(pad.l, 0, pad.l + cw, 0);
    lineGrad.addColorStop(0, "#22c55e");
    lineGrad.addColorStop(0.5, "#eab308");
    lineGrad.addColorStop(1, "#ef4444");

    ctx.beginPath();
    angles.forEach((a, i) => {
      const x = pad.l + (a / 40) * cw;
      const y = pad.t + ch - (torques[i] / maxT) * ch;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineGrad; ctx.lineWidth = 2.5; ctx.stroke();

    // Fill
    ctx.lineTo(pad.l + cw, pad.t + ch); ctx.lineTo(pad.l, pad.t + ch); ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    fillGrad.addColorStop(0, "#22c55e22"); fillGrad.addColorStop(1, "transparent");
    ctx.fillStyle = fillGrad; ctx.fill();

    // Current angle marker
    const curX = pad.l + (params.theta / 40) * cw;
    const curY = pad.t + ch - (Math.max(0, calcPhysics(params).T_axle) / maxT) * ch;
    ctx.beginPath(); ctx.arc(curX, curY, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 2; ctx.stroke();

    // Axes labels
    ctx.fillStyle = "#64748b"; ctx.font = "9px monospace"; ctx.textAlign = "center";
    ctx.fillText("Incline Angle (°)", pad.l + cw / 2, H - 4);
    ctx.save(); ctx.translate(10, pad.t + ch / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("Torque (Nm)", 0, 0); ctx.restore();

    // X-axis ticks
    [0, 10, 20, 30, 40].forEach(a => {
      const x = pad.l + (a / 40) * cw;
      ctx.fillStyle = "#475569"; ctx.textAlign = "center"; ctx.font = "9px monospace";
      ctx.fillText(a, x, pad.t + ch + 12);
    });
  }, [params]);

  return <canvas ref={canvasRef} width={440} height={140} style={{ borderRadius: "8px", display: "block" }} />;
}

// ─── SLIDER CONTROL ──────────────────────────────────────────────────────────
function Slider({ label, tooltip, value, min, max, step = 1, unit, onChange }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <Tooltip text={tooltip}>
          <span className="text-xs font-mono text-slate-300 cursor-help border-b border-dotted border-slate-500">
            {label}
          </span>
        </Tooltip>
        <span className="text-xs font-mono font-bold text-cyan-400">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: "#22d3ee" }}
      />
    </div>
  );
}

// ─── OUTPUT ROW ───────────────────────────────────────────────────────────────
function OutRow({ label, value, unit, highlight }) {
  return (
    <div className={`flex justify-between items-center py-1 px-2 rounded text-xs font-mono ${highlight ? "bg-slate-700/50" : ""}`}>
      <span className="text-slate-400">{label}</span>
      <span className="text-cyan-300 font-bold">{value} <span className="text-slate-500 font-normal">{unit}</span></span>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [p, setP] = useState({ ...DEFAULTS });
  const animRef = useRef(null);

  const set = (key) => (val) => setP(prev => ({ ...prev, [key]: val }));

  const physics = calcPhysics(p);

  const statusColor = {
    SAFE: "text-green-400 border-green-500/50 bg-green-500/10",
    WARNING: "text-yellow-400 border-yellow-500/50 bg-yellow-500/10",
    FAIL: "text-red-400 border-red-500/50 bg-red-500/10",
  }[physics.status];

  const statusIcon = { SAFE: "✓", WARNING: "⚡", FAIL: "✗" }[physics.status];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #020617 0%, #0a0f1e 50%, #020617 100%)",
        fontFamily: "'Courier New', monospace",
        color: "#e2e8f0",
      }}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/80" style={{ background: "rgba(15,23,42,0.95)", backdropFilter: "blur(8px)" }}>
        <div className="max-w-screen-xl mx-auto flex items-center gap-4">
          <div className="text-2xl">⚙</div>
          <div>
            <h1 className="text-base font-bold text-slate-100 tracking-widest uppercase">
              Ratchet–Pawl Hill Assist Simulator
            </h1>
            <p className="text-xs text-slate-500 tracking-wider">Vehicle Rollback Prevention · Real-Time Stress Analysis</p>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setP({ ...DEFAULTS })}
              className="px-3 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
            >
              ↺ Reset
            </button>
            <button
              onClick={() => setP(prev => ({ ...prev, theta: 35, mass: 250, mu_r: 0.04, pawl_t_mm: 5, material: "Mild Steel (IS 2062)" }))}
              className="px-3 py-1.5 text-xs rounded border border-orange-500/60 text-orange-400 hover:bg-orange-500/10 transition-colors"
            >
              ⚠ Worst Case (35°)
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-screen-xl mx-auto px-4 py-5 flex gap-5 flex-wrap">

        {/* ─── LEFT: Controls ─── */}
        <div className="flex-1 min-w-72 max-w-xs flex flex-col gap-3">
          <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-4" style={{ backdropFilter: "blur(4px)" }}>
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-3 pb-1 border-b border-slate-700">Parameters</div>

            <Slider label="Vehicle Mass" tooltip="Total mass of the vehicle (m). Affects weight and all forces." value={p.mass} min={50} max={800} step={10} unit=" kg" onChange={set("mass")} />
            <Slider label="Incline Angle θ" tooltip="Slope angle in degrees. Higher angles increase rollback force significantly." value={p.theta} min={0} max={40} step={0.5} unit="°" onChange={set("theta")} />
            <Slider label="Rolling Resistance μr" tooltip="Coefficient of rolling resistance. Opposes rollback slightly. Default 0.04 for car tires." value={p.mu_r} min={0.01} max={0.12} step={0.01} unit="" onChange={set("mu_r")} />
            <Slider label="Tire Radius" tooltip="Outer radius of the driven wheel. Converts linear force to axle torque." value={p.r_tire} min={0.2} max={0.5} step={0.01} unit=" m" onChange={set("r_tire")} />
            <Slider label="Ratchet Pitch Radius" tooltip="Pitch radius of ratchet wheel. Smaller radius = higher pawl force." value={p.r_ratchet} min={0.03} max={0.15} step={0.005} unit=" m" onChange={set("r_ratchet")} />
            <Slider label="Pawl Thickness" tooltip="Cross-sectional thickness of the pawl. Critical dimension for shear stress calculation." value={p.pawl_t_mm} min={5} max={15} step={0.5} unit=" mm" onChange={set("pawl_t_mm")} />
            <Slider label="Pawl Width" tooltip="Width of the pawl shear face. Larger width reduces shear stress." value={p.pawl_w_mm} min={8} max={25} step={0.5} unit=" mm" onChange={set("pawl_w_mm")} />

            <div className="mt-2">
              <div className="flex justify-between items-center mb-1">
                <Tooltip text="Material for the pawl. EN8 has higher shear strength (232.5 MPa vs 125 MPa for Mild Steel).">
                  <span className="text-xs font-mono text-slate-300 cursor-help border-b border-dotted border-slate-500">
                    Pawl Material
                  </span>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                {["Mild Steel (IS 2062)", "EN8"].map(m => (
                  <button
                    key={m}
                    onClick={() => set("material")(m)}
                    className={`flex-1 py-1.5 text-xs rounded border transition-colors ${p.material === m ? "bg-cyan-500/20 border-cyan-500/60 text-cyan-300" : "border-slate-600 text-slate-400 hover:border-slate-500"}`}
                  >
                    {m === "EN8" ? "EN8 Steel" : "Mild Steel"}
                    <div className="text-slate-500 text-[10px]">{m === "EN8" ? "232.5 MPa" : "125 MPa"}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Material reference */}
          <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-2">Material Reference</div>
            <div className="text-xs text-slate-400 space-y-1">
              <div className="flex justify-between"><span>Mild Steel (IS 2062)</span><span className="text-slate-300">τ = 125 MPa</span></div>
              <div className="flex justify-between"><span>EN8 Steel</span><span className="text-slate-300">τ = 232.5 MPa</span></div>
              <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-0.5">
                <div className="flex gap-2 items-center"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /><span>FoS &gt; 3.0 → SAFE</span></div>
                <div className="flex gap-2 items-center"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /><span>1.5 ≤ FoS ≤ 3.0 → WARNING</span></div>
                <div className="flex gap-2 items-center"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /><span>FoS &lt; 1.5 → FAILURE</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── RIGHT: Simulation ─── */}
        <div className="flex-1 min-w-72 flex flex-col gap-3">

          {/* Status Banner */}
          <div className={`rounded-lg border px-4 py-2.5 flex items-center gap-3 ${statusColor}`}>
            <span className="text-2xl font-bold">{statusIcon}</span>
            <div>
              <div className="font-bold tracking-widest text-sm">
                {physics.status === "FAIL" ? "PAWL FAILURE — ROLLBACK OCCURS" : physics.status === "WARNING" ? "APPROACHING DESIGN LIMIT" : "SYSTEM SAFE — PAWL HOLDING"}
              </div>
              <div className="text-xs opacity-70">Factor of Safety: {physics.FoS.toFixed(3)}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs opacity-60">Shear Stress</div>
              <div className="font-bold">{physics.tau_MPa.toFixed(2)} MPa</div>
            </div>
          </div>

          {/* Canvas */}
          <div className="rounded-lg border border-slate-700/70 overflow-hidden">
            <RatchetCanvas params={p} physics={physics} animRef={animRef} />
          </div>

          {/* Outputs Grid */}
          <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
            <div className="text-xs text-slate-500 uppercase tracking-widest mb-2 pb-1 border-b border-slate-700">Live Computations</div>
            <div className="grid grid-cols-2 gap-x-3">
              <OutRow label="Weight W" value={physics.W.toFixed(1)} unit="N" />
              <OutRow label="Normal Force" value={physics.F_normal.toFixed(1)} unit="N" highlight />
              <OutRow label="Grade Force Fg" value={physics.F_grade.toFixed(1)} unit="N" />
              <OutRow label="Roll Resistance Fr" value={physics.F_roll.toFixed(1)} unit="N" highlight />
              <OutRow label="Net Rollback" value={physics.F_net.toFixed(1)} unit="N" />
              <OutRow label="Axle Torque T" value={physics.T_axle.toFixed(2)} unit="Nm" highlight />
              <OutRow label="Pawl Force Fp" value={physics.F_pawl.toFixed(1)} unit="N" />
              <OutRow label="Shear Stress τ" value={physics.tau_MPa.toFixed(3)} unit="MPa" highlight />
              <OutRow label="Shear Area A" value={((p.pawl_w_mm / 1000) * (p.pawl_t_mm / 1000) * 1e6).toFixed(2)} unit="mm²" />
              <OutRow label="Factor of Safety" value={physics.FoS.toFixed(3)} unit="" highlight />
            </div>
          </div>

          {/* Torque Chart */}
          <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 overflow-hidden">
            <div className="px-3 pt-2 pb-1 text-xs text-slate-500 uppercase tracking-widest border-b border-slate-800">
              Torque vs Incline Angle — Current θ marked ●
            </div>
            <div className="p-2">
              <TorqueChart params={p} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-2 pb-4 text-center text-xs text-slate-600 font-mono tracking-wider">
        Ratchet–Pawl Hill Assist Simulator · Based on IS 2062 & EN8 Design Standards · Physics: τ = F/(w×t) · FoS = τ_s/τ
      </div>
    </div>
  );
}
