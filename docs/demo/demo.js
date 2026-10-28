const canvas = document.querySelector('#field'), context = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const palettes = {
  prism: ['#ac83f4', '#647bf4', '#61dbdd', '#a8e8c0', '#f2be85', '#df729b'],
  tide: ['#777bde', '#698dda', '#75d4e2', '#9ae7cb', '#c5edac'],
  ember: ['#8f65c0', '#bb699d', '#e5897b', '#f0b788', '#e3d0a8']
};
let palette = 'prism', paused = reduced, speed = .35, phase = 1.8, previous = 0, width = 0, height = 0, dirty = true;
function resize() {
  const box = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 1.5);
  width = box.width; height = box.height; canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  dirty = true;
}
new ResizeObserver(resize).observe(canvas);
function draw(time) {
  requestAnimationFrame(draw);
  if (!dirty && (paused || time - previous < 1000 / 30)) return;
  if (!paused && previous) phase += Math.min(time - previous, 50) * .00012 * speed;
  previous = time; dirty = false;
  context.clearRect(0, 0, width, height);
  const radius = Math.min(width * .27, height * .39), centerX = width * .58, centerY = height * .46;
  context.save(); context.translate(centerX, centerY); context.rotate(-.32);
  context.globalCompositeOperation = 'lighter';
  const colors = palettes[palette];
  const gradient = context.createLinearGradient(-radius, -radius * .6, radius, radius * .8);
  colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
  context.strokeStyle = gradient;
  for (let strand = 0; strand < 76; strand++) {
    const v = strand / 76 * Math.PI * 2;
    context.beginPath();
    for (let step = 0; step <= 120; step++) {
      const u = step / 120 * Math.PI * 2;
      const wave = Math.sin(u * 3 + phase) * .095 + Math.cos(u * 2 - phase * .7) * .07;
      const tube = .28 + wave;
      const distance = .72 + tube * Math.cos(v + Math.sin(u * 2 + phase) * .55);
      const x = radius * distance * Math.cos(u);
      const z = radius * distance * Math.sin(u);
      const y = radius * tube * Math.sin(v) + Math.sin(u * 2 + phase) * radius * .12;
      const angle = .74 + Math.sin(phase * .4) * .2;
      const projectedY = y * Math.cos(angle) + z * Math.sin(angle);
      if (step === 0) context.moveTo(x, projectedY); else context.lineTo(x, projectedY);
    }
    context.globalAlpha = .3 + Math.pow(Math.sin(v * .5), 2) * .3;
    context.lineWidth = strand % 9 === 0 ? 1.15 : .65; context.stroke();
  }
  context.restore();
}
function reflectPlayback() {
  document.querySelector('#play').setAttribute('aria-label', paused ? 'Resume motion' : 'Pause motion');
  document.querySelector('#play-icon').setAttribute('d', paused ? 'm7 4 8 6-8 6Z' : 'M7 5v10M13 5v10');
}
document.querySelector('#play').onclick = () => { paused = !paused; previous = 0; dirty = true; reflectPlayback(); };
document.querySelector('#motion').oninput = event => { speed = Number(event.target.value) / 100; };
document.querySelectorAll('[data-palette]').forEach(button => button.onclick = () => {
  palette = button.dataset.palette;
  dirty = true;
  document.querySelectorAll('[data-palette]').forEach(item => {
    item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button));
  });
  document.querySelector('#scene-name').textContent = button.getAttribute('aria-label');
});
document.querySelector('#save').onclick = () => {
  localStorage.setItem('quiet-spectrum', JSON.stringify({ palette, speed, paused }));
  document.querySelector('#result').textContent = 'Scene saved';
};
try {
  const saved = JSON.parse(localStorage.getItem('quiet-spectrum'));
  if (saved && Object.hasOwn(palettes, saved.palette) && Number.isFinite(saved.speed)) {
    document.querySelector(`[data-palette="${saved.palette}"]`).click();
    speed = Math.max(0, Math.min(1, saved.speed));
    document.querySelector('#motion').value = speed * 100;
    paused = reduced || saved.paused === true;
  }
} catch {}
reflectPlayback(); resize(); requestAnimationFrame(draw);
