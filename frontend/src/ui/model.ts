/** Model section: accuracy table and grouped bar chart by horizon. */
import { $ } from '../core/util';
import { app } from '../state';

export function initModel(): void {
  const MODEL = app.D.model;
  const best = [0, 1, 2].map((j) => Math.min(...MODEL.map((m) => m.mae[j])));
  $('mtable').innerHTML = MODEL.map(
    (m) => '<tr class="' + (m.ours ? 'ours' : '') + '"><td>' + m.name + '</td>' + m.mae.map((v, j) => '<td class="' + (v === best[j] ? 'best' : '') + '">' + v.toFixed(1) + '</td>').join('') + '</tr>',
  ).join('');
  const W = 560, H = 300, L = 36, B = 40, Tp = 26, groups = ['1–6 h', '7–24 h', '25–72 h'], gw = (W - L - 10) / 3, bw = 22, ym = 60;
  const Y = (v: number) => Tp + (1 - v / ym) * (H - Tp - B);
  let s = '';
  for (let v = 0; v <= ym; v += 20)
    s += '<line x1="' + L + '" x2="' + (W - 6) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="rgba(220,235,210,.09)"/><text x="' + (L - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="11" fill="rgba(238,242,232,.5)" font-family="Lexend,sans-serif">' + v + '</text>';
  groups.forEach((gname, j) => {
    const gx = L + j * gw + (gw - MODEL.length * bw - (MODEL.length - 1) * 6) / 2;
    MODEL.forEach((m, k) => {
      const x = gx + k * (bw + 6), y = Y(m.mae[j]);
      s += '<rect class="bar" style="--d:' + (j * 4 + k) * 70 + 'ms" x="' + x + '" y="' + y.toFixed(1) + '" width="' + bw + '" height="' + (Y(0) - y).toFixed(1) + '" rx="3" fill="' + m.color + '" opacity="' + (m.ours ? 1 : 0.8) + '"/>';
      if (m.ours) s += '<text x="' + (x + bw / 2) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle" font-size="11" fill="#fff" font-family="Lexend,sans-serif">' + m.mae[j].toFixed(1) + '</text>';
    });
    s += '<text x="' + (L + j * gw + gw / 2) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="12" fill="rgba(238,242,232,.7)" font-family="Lexend,sans-serif">' + gname + ' ahead</text>';
  });
  let lx = L;
  MODEL.forEach((m) => {
    s += '<rect x="' + lx + '" y="4" width="10" height="10" rx="2" fill="' + m.color + '"/><text x="' + (lx + 15) + '" y="13" font-size="11" fill="rgba(238,242,232,.7)" font-family="Lexend,sans-serif">' + m.name.replace(' (last value)', '') + '</text>';
    lx += m.name.length * 5.6 + 34;
  });
  $('barSvg').innerHTML = s;
  // data-source notes in the footer
  const spans = document.querySelectorAll('footer > span');
  if (spans[1]) spans[1].textContent = app.D.footer;
}
