import type { ObservationView, Unit } from './model';

export const neighborhoodName = (value: string) => value === 'none' ? 'No outage' : value.charAt(0).toUpperCase() + value.slice(1);

export function publicUnitPosition(view: ObservationView, unit: Unit): { x: number; y: number } {
  const mission = view.missions.find(m => m.id === unit.missionId && m.status !== 'completed');
  if (!mission) return unit;
  const transporting = mission.pickupAt !== null && view.minute >= mission.pickupAt;
  const route = transporting ? mission.shelterRoute : mission.route;
  if (!route) return unit;
  let elapsed = view.minute - (transporting ? mission.pickupAt! : mission.dispatchedAt);
  const nodes = new Map(view.map.nodes.map(node => [node.id, node]));
  for (const leg of route.legs) {
    const from = nodes.get(leg.from), to = nodes.get(leg.to);
    if (!from || !to) return unit;
    if (elapsed <= leg.minutes) {
      const fraction = Math.max(0, Math.min(1, elapsed / leg.minutes));
      return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
    }
    elapsed -= leg.minutes;
  }
  return nodes.get(route.nodes.at(-1) ?? '') ?? unit;
}

/** The map receives only the same public projection used by the inspector. */
export function drawTown(canvas: HTMLCanvasElement, view: ObservationView, selected: string | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = view.map.width, height = view.map.height;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  ctx.fillStyle = '#e4ecde'; ctx.fillRect(0, 0, width, height);

  // Authored park patches and tree positions contain no simulation information.
  const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  for (let i = 0; i < 32; i++) {
    const x = noise(i + 10) * width, y = noise(i + 82) * height;
    ctx.fillStyle = i % 2 ? '#d2e2c7' : '#dbe7d0';
    ctx.beginPath(); ctx.ellipse(x, y, 30 + noise(i) * 54, 20 + noise(i + 7) * 40, noise(i + 9), 0, Math.PI * 2); ctx.fill();
  }
  // Residential blocks make the street graph legible at presentation scale.
  for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) {
    const x = 103 + col * 130, y = 103 + row * 120;
    ctx.fillStyle = (row + col) % 3 ? '#e1e5df' : '#d9e1d7';
    ctx.beginPath(); ctx.roundRect(x, y, 104, 94, 15); ctx.fill();
    for (let home = 0; home < 5; home++) {
      const bx = x + 15 + (home % 3) * 29, by = y + 18 + Math.floor(home / 3) * 36;
      ctx.fillStyle = '#c8d1cb';
      ctx.beginPath(); ctx.moveTo(bx - 6, by); ctx.lineTo(bx, by - 6); ctx.lineTo(bx + 6, by); ctx.lineTo(bx + 6, by + 8); ctx.lineTo(bx - 6, by + 8); ctx.closePath(); ctx.fill();
    }
  }
  for (let i = 0; i < 145; i++) {
    const x = noise(i + 333) * width, y = noise(i + 999) * height;
    if (view.map.nodes.some(node => Math.abs(node.x - x) < 23 || Math.abs(node.y - y) < 17)) continue;
    const size = 5 + noise(i + 7) * 6;
    ctx.fillStyle = '#a8c695'; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b7d1a5'; ctx.beginPath(); ctx.arc(x - size * .3, y - size * .3, size * .65, 0, Math.PI * 2); ctx.fill();
  }

  // A fictional river, not an evolving flood or a route closure.
  const river = () => { ctx.beginPath(); ctx.moveTo(-30, 640); ctx.bezierCurveTo(220, 660, 255, 615, 475, 640); ctx.bezierCurveTo(690, 664, 820, 615, 990, 626); };
  ctx.strokeStyle = '#c1e5f2'; ctx.lineWidth = 61; river(); ctx.stroke();
  ctx.strokeStyle = '#96d2e8'; ctx.lineWidth = 36; river(); ctx.stroke();
  ctx.strokeStyle = '#b0dded'; ctx.lineWidth = 2; river(); ctx.stroke();

  const nodes = new Map(view.map.nodes.map(node => [node.id, node]));
  // The network gap is public. Its pattern avoids treating silence as safety.
  if (view.networkGap !== 'none') {
    const right = view.networkGap.endsWith('east'), bottom = view.networkGap.startsWith('south');
    const x = right ? 550 : 35, y = bottom ? 390 : 35;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, 375, 220, 22); ctx.clip();
    ctx.fillStyle = '#f4d59330'; ctx.fillRect(x, y, 375, 220);
    ctx.strokeStyle = '#b08d3c40'; ctx.lineWidth = .8;
    for (let d = -220; d < 600; d += 10) { ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + 220, y + 220); ctx.stroke(); }
    ctx.restore(); ctx.strokeStyle = '#b89b55'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.roundRect(x, y, 375, 220, 22); ctx.stroke(); ctx.setLineDash([]);
  }

  for (const edge of view.map.edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to); if (!from || !to) continue;
    ctx.lineCap = 'round'; ctx.strokeStyle = '#cbd3cc'; ctx.lineWidth = 18;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.strokeStyle = '#fffef9'; ctx.lineWidth = 13; ctx.stroke();
    if (edge.closed) {
      const x = (from.x + to.x) / 2, y = (from.y + to.y) / 2;
      ctx.strokeStyle = '#bb3a37'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
    }
  }
  const activeMissions = view.missions.filter(m => m.status !== 'completed' && (selected === null || m.householdId === selected));
  for (const mission of activeMissions) {
    const routeNodes = [...mission.route.nodes, ...(mission.shelterRoute?.nodes.slice(1) ?? [])];
    ctx.beginPath(); routeNodes.forEach((id, index) => { const point = nodes.get(id); if (point) index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y); });
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = '#bf2d3d'; ctx.lineWidth = 3; ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);
  }
}
